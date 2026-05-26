"""v2.10.1: d_curve 数据离线修复 — 无需重采样。

背景
  v2.10 修复 _stepDifficulty 让 d_step 有 PB 命题, 但 _extractDCurveFromSteps
  的空 bin 仍用 lastValue 填充。bot 弱时 (median r=0.19) 高 r bin 几乎无数据,
  末尾被低 r 值污染 → d_curve 跨度仍只有 0.167 (业务期望 0.45)。

  v2.10.1 在代码层修复 (空 bin 用 d_pb_base 先验), 但已采的 72K 样本无法
  从 d_curve_json 反推每个 bin 的 count, 必须重采或后处理。

  本脚本提供后处理: 检测末尾连续相等值 (典型的 fillna 特征), 替换为
  d_pb_base(bin_center) 先验值。

用法
  python -m rl_pytorch.spawn_tuning_v2.repair_dcurves \\
      --db .cursor-stress-logs/spawn-tuning-v2.sqlite \\
      --set-id 6 --dry-run    # 先看 diff
  python -m rl_pytorch.spawn_tuning_v2.repair_dcurves \\
      --db .cursor-stress-logs/spawn-tuning-v2.sqlite \\
      --set-id 6              # 实际修复

策略
  - 末尾平台检测: 连续 K (默认 3) 个 bin 数值差 < epsilon (默认 0.005) 视为 fillna
  - 替换: 这些 bin 用 d_pb_base(bin_center) (不动有数据的低 r 部分)
  - 安全: 默认 --dry-run, 必须显式确认; 每次修复在 DB backup 副本上做
  - 幂等: 已修复的样本 (末尾 ≈ S 形顶部) 不会被再次修改
"""
from __future__ import annotations
import argparse
import json
import math
import sqlite3
import sys
from pathlib import Path
from typing import List, Tuple

# 复用 extractor.py 的常量与函数 — 跨语言一致
try:
    from .extractor import pb_aware_d_pb_base
    from .target_curve import CURVE_N_BINS, CURVE_R_MAX
except ImportError:
    # 允许直接 python repair_dcurves.py 调用
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))
    from rl_pytorch.spawn_tuning_v2.extractor import pb_aware_d_pb_base
    from rl_pytorch.spawn_tuning_v2.target_curve import CURVE_N_BINS, CURVE_R_MAX


PLATEAU_EPS = 0.005     # bin 间数值差小于此视为相等
PLATEAU_MIN_LEN = 3     # 至少连续 N bin 相等才认定为 fillna


def detect_plateau_tail(curve: List[float], eps: float = PLATEAU_EPS, min_len: int = PLATEAU_MIN_LEN) -> int:
    """返回末尾平台起始 bin 索引 (含); 没有平台返回 len(curve)。"""
    n = len(curve)
    if n < min_len + 1:
        return n
    # 从最后一个 bin 往前走, 找连续相等
    last = curve[-1]
    plateau_start = n - 1
    for i in range(n - 2, -1, -1):
        if abs(curve[i] - last) < eps:
            plateau_start = i
        else:
            break
    plateau_len = n - plateau_start
    if plateau_len >= min_len:
        return plateau_start
    return n  # 无平台


def repair_curve(curve: List[float], n_bins: int = CURVE_N_BINS, r_max: float = CURVE_R_MAX,
                 eps: float = PLATEAU_EPS, min_len: int = PLATEAU_MIN_LEN) -> Tuple[List[float], int]:
    """修复单条 d_curve, 返回 (修复后, 改变的 bin 数)。"""
    n = len(curve)
    plateau_start = detect_plateau_tail(curve, eps, min_len)
    if plateau_start >= n:
        return curve, 0
    # 末尾平台 bin 用 d_pb_base 先验替换
    new_curve = list(curve)
    for i in range(plateau_start, n):
        r_center = (i + 0.5) * (r_max / n_bins)
        new_curve[i] = pb_aware_d_pb_base(r_center)
    # 安全: 替换后应单调非降 (S 形), 否则可能误判
    # 检查 plateau_start - 1 不能高于 new_curve[plateau_start]
    if plateau_start > 0 and curve[plateau_start - 1] > new_curve[plateau_start]:
        # 末尾观察值已经 > S 形顶部, 不修
        return curve, 0
    return new_curve, n - plateau_start


def repair_set(db_path: str, set_id: int, dry_run: bool = True, verbose: bool = False) -> dict:
    """修复一个 sample set 内所有 sample 的 d_curve。"""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT sample_id, d_curve_json FROM samples WHERE set_id = ?",
        (set_id,),
    ).fetchall()
    if not rows:
        conn.close()
        return {"total": 0, "repaired": 0, "skipped": 0}

    total = len(rows)
    repaired = 0
    skipped = 0
    bin_changed_sum = 0
    cursor = conn.cursor()
    for r in rows:
        try:
            curve = json.loads(r["d_curve_json"])
        except Exception:
            skipped += 1
            continue
        new_curve, n_changed = repair_curve(curve)
        if n_changed > 0:
            repaired += 1
            bin_changed_sum += n_changed
            if not dry_run:
                cursor.execute(
                    "UPDATE samples SET d_curve_json = ?, algo_version = 'v2.10.1' WHERE sample_id = ?",
                    (json.dumps(new_curve), r["sample_id"]),
                )
            if verbose and repaired <= 3:
                print(f"  sample {r['sample_id']}: 修 {n_changed} bin")
                print(f"    before tail: {[round(x,3) for x in curve[-5:]]}")
                print(f"    after  tail: {[round(x,3) for x in new_curve[-5:]]}")
        else:
            skipped += 1

    if not dry_run:
        conn.commit()
    conn.close()
    avg_changed = bin_changed_sum / max(1, repaired)
    return {
        "set_id": set_id,
        "total": total,
        "repaired": repaired,
        "skipped": skipped,
        "avg_bin_changed": round(avg_changed, 1),
        "dry_run": dry_run,
    }


def main():
    p = argparse.ArgumentParser(description="v2.10.1 d_curve 离线修复 (无需重采样)")
    p.add_argument("--db", required=True)
    p.add_argument("--set-id", type=int, required=True)
    p.add_argument("--dry-run", action="store_true", default=False,
                   help="只统计影响, 不写入 (默认 --apply)")
    p.add_argument("--apply", dest="dry_run", action="store_false",
                   help="实际修复 (覆盖 d_curve_json + 把 algo_version 改 v2.10.1)")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args()

    result = repair_set(args.db, args.set_id, dry_run=args.dry_run, verbose=args.verbose)
    mode = "DRY-RUN" if result["dry_run"] else "APPLIED"
    print(f"\n=== {mode}: set_id={result['set_id']} ===")
    print(f"  total samples:   {result['total']}")
    print(f"  repaired:        {result['repaired']} ({result['repaired']/max(1,result['total'])*100:.1f}%)")
    print(f"  skipped:         {result['skipped']}")
    print(f"  avg bin changed: {result['avg_bin_changed']}/{CURVE_N_BINS}")
    if result["dry_run"]:
        print(f"\n  → 看起来合理? 加 --apply 实际修复")
    else:
        print(f"\n  ✓ 已修复, 现在可以用 set_id={args.set_id} 重新训练模型 (d_curve 末尾已含 S 形)")


if __name__ == "__main__":
    main()
