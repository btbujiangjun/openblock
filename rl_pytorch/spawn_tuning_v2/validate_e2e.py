"""v2.10.9 G7 MVP: 部署 bundle 端到端验证 (本地仿真).

业务问题
  部署后, 模型预测的 d_curve 跟真实环境产出的 d_curve 是否一致?
  完整 e2e 需要真实玩家流量 + 数周 A/B 测试期, 但有两种 MVP 方式:

  方式 A (本脚本): 用现有 SQLite 样本集作为"真实环境数据集"
    - 不需要重跑 simulator (快, < 5s)
    - 用部署 bundle 中 360 ctx 的 predicted_curve
    - 跟 sample set 同 ctx 的 d_curve_json 实测均值对比
    - mae per ctx 揭示哪些场景模型表现差

  方式 B (未实现): 用 simulator 实际跑 episodes
    - 需要 theta-aware simulator (当前 OpenBlockSimulator 不支持 θ 注入)
    - 留待 v3 RL bot 落地后

用法 CLI
  # 用 set #6 验证当前部署的 bundle
  python -m rl_pytorch.spawn_tuning_v2.validate_e2e \\
      --db .cursor-stress-logs/spawn-tuning-v2.sqlite \\
      --bundle web/public/spawn-tuning-v2/policies.json \\
      --set-id 6

  # 输出: 每个 ctx 的预测 vs 实测 mae + 整体摘要
"""
from __future__ import annotations
import argparse
import json
import math
import sqlite3
from pathlib import Path
from typing import Dict, List, Optional


def load_bundle(bundle_path: str) -> Dict:
    """加载 deployed bundle。"""
    bundle = json.loads(Path(bundle_path).read_text(encoding="utf-8"))
    if bundle.get("format") != "openblock-spawn-tuning-v2-bundle":
        raise ValueError(f"not a v2 bundle (format={bundle.get('format')})")
    return bundle


def aggregate_sample_set_curves(db_path: str, set_id: int) -> Dict[str, Dict]:
    """从 SQLite 按 ctx 聚合实测 d_curve, 返回 {ctx_key: {mean: [..], n: int, std: [..]}}."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    rows = conn.execute(
        "SELECT difficulty, generator, bot_policy, pb_bin, lifecycle_stage, d_curve_json "
        "FROM samples WHERE set_id = ? LIMIT 20000",
        (set_id,),
    ).fetchall()
    conn.close()

    n_bins = 20
    groups: Dict[str, List[List[float]]] = {}
    for r in rows:
        key = f"{r['difficulty']}:{r['generator']}:{r['bot_policy']}:{r['pb_bin']}:{r['lifecycle_stage']}"
        try:
            c = json.loads(r["d_curve_json"])
            if len(c) == n_bins:
                groups.setdefault(key, []).append(c)
        except Exception:
            continue

    out: Dict[str, Dict] = {}
    for key, curves in groups.items():
        avg = [sum(c[i] for c in curves) / len(curves) for i in range(n_bins)]
        var = [
            sum((c[i] - avg[i]) ** 2 for c in curves) / len(curves) for i in range(n_bins)
        ]
        std = [math.sqrt(v) for v in var]
        out[key] = {"mean": avg, "std": std, "n": len(curves)}
    return out


def validate(db_path: str, bundle_path: str, set_id: int,
             min_samples_per_ctx: int = 5) -> Dict:
    """主验证函数 — 返回 e2e gap 报告。"""
    bundle = load_bundle(bundle_path)
    policies = bundle.get("policies", [])
    if not policies:
        raise ValueError("bundle has no policies")

    actuals = aggregate_sample_set_curves(db_path, set_id)
    if not actuals:
        raise ValueError(f"sample set {set_id} has no valid samples")

    per_ctx_results: List[Dict] = []
    matched = 0
    skipped_few = 0
    skipped_no_data = 0

    for policy in policies:
        key = policy["context_key"]
        actual = actuals.get(key)
        if actual is None:
            skipped_no_data += 1
            continue
        if actual["n"] < min_samples_per_ctx:
            skipped_few += 1
            continue
        predicted = policy.get("predicted_curve", [])
        if len(predicted) != 20:
            continue

        mae = sum(abs(p - a) for p, a in zip(predicted, actual["mean"])) / 20
        # 形态匹配: 跨度差
        pred_spread = predicted[-1] - predicted[0]
        actual_spread = actual["mean"][-1] - actual["mean"][0]
        spread_diff = pred_spread - actual_spread

        per_ctx_results.append({
            "ctx": key,
            "mae": round(mae, 4),
            "n_samples": actual["n"],
            "predicted_spread": round(pred_spread, 4),
            "actual_spread": round(actual_spread, 4),
            "spread_diff": round(spread_diff, 4),
        })
        matched += 1

    per_ctx_results.sort(key=lambda r: r["mae"])
    if not per_ctx_results:
        return {
            "status": "no-match",
            "matched": 0,
            "skipped_few": skipped_few,
            "skipped_no_data": skipped_no_data,
        }

    avg_mae = sum(r["mae"] for r in per_ctx_results) / len(per_ctx_results)
    best = per_ctx_results[:3]    # mae 最低 (拟合最好)
    worst = per_ctx_results[-3:]  # mae 最高 (拟合最差)
    # 评级
    if avg_mae < 0.08:
        grade = "excellent"
    elif avg_mae < 0.12:
        grade = "good"
    elif avg_mae < 0.18:
        grade = "fair"
    else:
        grade = "poor"

    return {
        "status": "ready",
        "bundle": {
            "model_id": bundle.get("model_id"),
            "n_contexts": bundle.get("n_contexts"),
            "generated_at": bundle.get("generated_at"),
            "model_sha256": bundle.get("model_sha256", "")[:16],
        },
        "set_id": set_id,
        "matched": matched,
        "skipped_few_samples": skipped_few,
        "skipped_no_data": skipped_no_data,
        "summary": {
            "avg_mae": round(avg_mae, 4),
            "grade": grade,
            "best_3": best,
            "worst_3": worst,
        },
        "per_ctx": per_ctx_results,
    }


def main():
    p = argparse.ArgumentParser(description="v2.10.9 G7: e2e bundle 验证")
    p.add_argument("--db", required=True)
    p.add_argument("--bundle", default="web/public/spawn-tuning-v2/policies.json")
    p.add_argument("--set-id", type=int, required=True)
    p.add_argument("--min-samples", type=int, default=5, help="ctx 至少这么多样本才参与对比")
    p.add_argument("--out", default=None, help="可选: 把详细结果写到 JSON 文件")
    args = p.parse_args()

    result = validate(args.db, args.bundle, args.set_id, args.min_samples)
    if result["status"] != "ready":
        print(f"[validate_e2e] {result['status']}: matched={result.get('matched')} "
              f"skipped_few={result.get('skipped_few')} skipped_no_data={result.get('skipped_no_data')}")
        return

    s = result["summary"]
    print(f"\n=== E2E Validation Report ===")
    print(f"Bundle: model_id={result['bundle']['model_id']} · sha={result['bundle']['model_sha256']}")
    print(f"Sample set: #{result['set_id']}")
    print(f"Matched ctx: {result['matched']}/360 "
          f"(skipped: few_samples={result['skipped_few_samples']}, no_data={result['skipped_no_data']})")
    print(f"\nOverall: avg_mae = {s['avg_mae']} · grade = {s['grade'].upper()}\n")
    print(f"Top 3 best (closest to reality):")
    for r in s["best_3"]:
        print(f"  {r['ctx']}: mae={r['mae']} · spread(pred/actual)={r['predicted_spread']}/{r['actual_spread']}")
    print(f"\nTop 3 worst (largest gap):")
    for r in s["worst_3"]:
        print(f"  {r['ctx']}: mae={r['mae']} · spread(pred/actual)={r['predicted_spread']}/{r['actual_spread']}")

    if args.out:
        Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n→ 详细报告写到 {args.out}")


if __name__ == "__main__":
    main()
