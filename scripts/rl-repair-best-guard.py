#!/usr/bin/env python3
"""离线修复 BestGuard 持久化的 best_avg 污染。

背景
----
v1 BestGuard 在 200 局滚动均值的"运气峰值"时刻锁定 best_avg。右偏长尾分数下
（实测 CV≈100%）该峰值远高于真实模型能力，于是后续训练被反复判为"严重回撤"，
触发回滚 + Adam 重置 + lr 衰减 → 形成自我实现的衰减循环。

本脚本：
  1. 读取 rl_checkpoints/training.jsonl，重算 200 局滚动均值的真实分布。
  2. 用 BestGuard v2 的 assess_best_avg_pollution() 判定 ckpt 中 guard_best_avg
     是否被污染。
  3. 自动备份原 ckpt 并写入修复后的版本（默认 `--dry-run`，需 `--apply` 才生效）。

使用
----
  # 评估（默认 dry-run）
  python scripts/rl-repair-best-guard.py --ckpt rl_checkpoints/bb_policy.pt

  # 实际写入
  python scripts/rl-repair-best-guard.py --ckpt rl_checkpoints/bb_policy.pt \
      --jsonl rl_checkpoints/training.jsonl --apply

  # 指定重置值（覆盖自动推荐）
  python scripts/rl-repair-best-guard.py --ckpt rl_checkpoints/bb_policy.pt \
      --reset-to 6200 --apply
"""

from __future__ import annotations

import argparse
import collections
import json
import shutil
import sys
import time
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from rl_pytorch.best_guard import (  # noqa: E402
    BestGuardConfig,
    assess_best_avg_pollution,
)


def _rolling_window_means(scores: Iterable[float], window: int) -> list[float]:
    """模拟 BestGuard 的 200 局滚动均值序列。"""
    means: list[float] = []
    buf: collections.deque[float] = collections.deque(maxlen=window)
    for s in scores:
        buf.append(float(s))
        if len(buf) == window:
            means.append(sum(buf) / window)
    return means


def _extract_scores_from_jsonl(jsonl_path: Path) -> tuple[list[float], int]:
    """从 training.jsonl 抽取 train_progress.score 序列与最大 episodes。"""
    scores: list[float] = []
    max_ep = 0
    with jsonl_path.open(encoding="utf-8") as f:
        for line in f:
            if "train_progress" not in line:
                continue
            try:
                d = json.loads(line)
            except json.JSONDecodeError:
                continue
            if d.get("event") != "train_progress":
                continue
            sc = d.get("score")
            if isinstance(sc, (int, float)):
                scores.append(float(sc))
                ep = d.get("episodes")
                if isinstance(ep, int) and ep > max_ep:
                    max_ep = ep
    return scores, max_ep


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--ckpt", type=Path, default=Path("rl_checkpoints/bb_policy.pt"),
                        help="目标 checkpoint 路径")
    parser.add_argument("--jsonl", type=Path, default=Path("rl_checkpoints/training.jsonl"),
                        help="训练 jsonl 路径，用于重算合理 best_avg")
    parser.add_argument("--window", type=int, default=200,
                        help="滚动窗口大小（与 BestGuard 配置一致，默认 200）")
    parser.add_argument("--pollution-margin", type=float, default=0.10,
                        help="允许 best_avg 高出观测峰值的比例（默认 0.10 = 10%%）")
    parser.add_argument("--reset-to", type=float, default=None,
                        help="手动指定 best_avg 重置值（覆盖自动推荐）")
    parser.add_argument("--apply", action="store_true",
                        help="实际写入（默认 dry-run，仅诊断）")
    parser.add_argument("--no-backup", action="store_true",
                        help="跳过备份原 ckpt（默认在同目录写 .bak.ts 文件）")
    args = parser.parse_args()

    if not args.ckpt.exists():
        print(f"[ERROR] checkpoint 不存在: {args.ckpt}", file=sys.stderr)
        return 2

    print(f"[1/4] 加载 checkpoint: {args.ckpt}")
    try:
        import torch
    except ImportError:
        print("[ERROR] 需要 PyTorch；先 pip install -r requirements-rl.txt", file=sys.stderr)
        return 2
    ckpt = torch.load(args.ckpt, map_location="cpu", weights_only=False)
    meta = ckpt.get("meta") or {}
    ts = ckpt.get("training_state") or {}
    bg_state = ts.get("best_guard") or {}
    current_best_avg = float(
        bg_state.get("best_avg")
        or meta.get("guard_best_avg")
        or 0.0
    )
    current_rollbacks = int(
        bg_state.get("rollbacks")
        if bg_state.get("rollbacks") is not None
        else meta.get("guard_rollbacks") or 0
    )
    print(f"  - 当前 guard_best_avg = {current_best_avg:.1f}")
    print(f"  - 当前 guard_rollbacks = {current_rollbacks}")

    print(f"\n[2/4] 重算 training.jsonl 窗口均值（window={args.window}）")
    if not args.jsonl.exists():
        print(f"[WARN] jsonl 不存在，跳过统计重算: {args.jsonl}")
        observed: list[float] = list(bg_state.get("observed_means") or [])
    else:
        scores, max_ep = _extract_scores_from_jsonl(args.jsonl)
        if not scores:
            print(f"[WARN] jsonl 中无 train_progress 记录")
            observed = list(bg_state.get("observed_means") or [])
        else:
            observed = _rolling_window_means(scores, args.window)
            print(f"  - 解析 {len(scores)} 局得分，最大 episode={max_ep}")
            print(f"  - {args.window} 局滚动均值序列长度 = {len(observed)}")
            if observed:
                obs_sorted = sorted(observed)
                print(f"  - 窗口均值统计："
                      f"max={max(observed):.1f}, "
                      f"p99={obs_sorted[int(0.99 * len(obs_sorted))]:.1f}, "
                      f"p95={obs_sorted[int(0.95 * len(obs_sorted))]:.1f}, "
                      f"p90={obs_sorted[int(0.90 * len(obs_sorted))]:.1f}, "
                      f"median={obs_sorted[len(obs_sorted) // 2]:.1f}")

    print(f"\n[3/4] 污染评估（pollution_margin={args.pollution_margin}）")
    cfg = BestGuardConfig(
        window=args.window,
        max_pollution_margin=args.pollution_margin,
    )
    assessment = assess_best_avg_pollution(current_best_avg, observed, cfg)
    print(f"  - polluted        = {assessment.polluted}")
    print(f"  - best_avg        = {assessment.best_avg:.1f}")
    print(f"  - observed_max    = {assessment.observed_max:.1f}")
    print(f"  - pollution_ratio = {assessment.pollution_ratio:.3f}")
    print(f"  - suggested_reset = {assessment.suggested_reset_to:.1f}")
    print(f"  - reason          : {assessment.reason}")

    reset_to: float | None = None
    if assessment.polluted:
        reset_to = float(args.reset_to) if args.reset_to is not None else assessment.suggested_reset_to
    elif args.reset_to is not None:
        print("\n[INFO] 未检测到污染，但 --reset-to 已显式指定，将强制重置。")
        reset_to = float(args.reset_to)
    else:
        print("\n[OK] 未检测到 best_avg 污染，无需修复。")
        return 0

    print(f"\n[4/4] 修复方案: best_avg {current_best_avg:.1f} → {reset_to:.1f}")
    if not args.apply:
        print("  [DRY-RUN] 未指定 --apply，未写入；加上 --apply 真正执行修复。")
        return 0

    if not args.no_backup:
        ts_tag = time.strftime("%Y%m%d_%H%M%S")
        backup = args.ckpt.with_suffix(args.ckpt.suffix + f".bak_{ts_tag}")
        print(f"  - 备份原 ckpt → {backup}")
        shutil.copy2(args.ckpt, backup)

    # 写回 meta 与 training_state.best_guard 同步重置
    meta["guard_best_avg"] = float(reset_to)
    meta["guard_rollbacks"] = 0
    ckpt["meta"] = meta
    if bg_state:
        bg_state["best_avg"] = float(reset_to)
        bg_state["rollbacks"] = 0
        # 同步刷新 best_stats（保留 std/n，仅替换 avg/median）
        bs = bg_state.get("best_stats") or {}
        bs["avg"] = float(reset_to)
        bs["median"] = float(reset_to)
        bs.setdefault("std", max(1.0, float(reset_to) * 0.3))  # 估一个合理 std
        bs.setdefault("n", args.window)
        bg_state["best_stats"] = bs
        # 清空健康度状态，避免延续 rollback 风暴
        bg_state["health"] = {
            "rollback_events": [],
            "suspended_until_ep": -1,
            "last_alert_ep": -(10 ** 9),
            "consecutive_severe": 0,
        }
        ts["best_guard"] = bg_state
        ckpt["training_state"] = ts

    torch.save(ckpt, args.ckpt)
    print(f"  ✓ checkpoint 已更新: {args.ckpt}")
    print("\n请重启训练以使修复生效。下次启动时 BestGuard 将从干净状态开始。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
