"""
Phase D — 主动学习采样。

根据训练好的代理模型,在 3 类区域追加采样:
    50%: 高 NN ensemble variance (代理不确定)
    30%: 高 EI (expected improvement: pred > current best)
    20%: 数据稀疏 context (Phase A 样本少的 context)

输出: 一个 θ 任务列表,可喂回 scripts/spawn-tune-v2.mjs 评估。

用法 (规划):
    python -m rl_pytorch.spawn_tuning.active_sampling \
        --db .cursor-stress-logs/spawn-tuning.sqlite --run-id RID \
        --surrogate checkpoints/surrogate_phase_b.pt \
        --budget 70000 \
        --output phase_d_tasks.json

    node scripts/spawn-tune-v2.mjs --tasks-from phase_d_tasks.json --run-id RID
"""

import argparse
import json
import sqlite3
from pathlib import Path

import numpy as np
import torch

from .surrogate_model import SpawnTuningSurrogate, DIFFICULTIES, GENERATORS, LIFECYCLE_STAGES
from .feature_io import PARAM_KEYS, decode_theta, encode_log_best
from .optimize_theta import latin_hypercube_starts, compute_J, BEST_SCORE_BINS, LIFECYCLE_MULTIPLIERS


def context_sample_counts(db_path: str, run_id: int) -> dict:
    """统计每 context 的样本数 (sparse 候选用)。"""
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    rows = cur.execute(
        """
        SELECT context_key, COUNT(*) as cnt
        FROM spawn_tuning_samples_v2
        WHERE run_id = ?
        GROUP BY context_key
        """,
        (run_id,),
    ).fetchall()
    conn.close()
    return {r[0]: r[1] for r in rows}


def sample_high_variance(model, n_candidates: int, n_pick: int, mc_dropout_runs: int = 10) -> list:
    """用 MC-Dropout 估计代理不确定性,挑 variance 最高的 θ。"""
    model.train()  # 开 dropout
    candidate_thetas = latin_hypercube_starts(n_candidates, dim=14)
    variances = []

    for theta in candidate_thetas:
        # 随机选 context 评估方差 (跨所有 context 求平均)
        diff_idx = torch.tensor([0], dtype=torch.long)
        gen_idx = torch.tensor([0], dtype=torch.long)
        life_idx = torch.tensor([0], dtype=torch.long)
        log_best = torch.tensor([[0.0]], dtype=torch.float32)
        theta_t = torch.tensor(theta, dtype=torch.float32).unsqueeze(0)

        preds = []
        for _ in range(mc_dropout_runs):
            with torch.no_grad():
                p = model(theta_t, diff_idx, gen_idx, life_idx, log_best).squeeze(0).numpy()
                preds.append(p)
        variances.append(np.std(preds, axis=0).mean())

    indices = np.argsort(variances)[::-1][:n_pick]
    return [candidate_thetas[i].tolist() for i in indices]


def sample_high_ei(
    model, n_candidates: int, n_pick: int, weights: dict, current_best: dict,
) -> list:
    """挑预测 J 高于 current_best 的 θ (Expected Improvement)。"""
    model.eval()
    candidate_thetas = latin_hypercube_starts(n_candidates, dim=14)
    ei_values = []

    for theta in candidate_thetas:
        # 在所有 context 上算 J 提升的均值
        improvement = 0
        count = 0
        for difficulty in DIFFICULTIES:
            for generator in GENERATORS:
                for lifecycle in LIFECYCLE_STAGES:
                    for bestScore_bin in BEST_SCORE_BINS:
                        ctx_key = f"{difficulty}:{generator}:{bestScore_bin}:{lifecycle}"
                        diff_idx = torch.tensor([DIFFICULTIES.index(difficulty)], dtype=torch.long)
                        gen_idx = torch.tensor([GENERATORS.index(generator)], dtype=torch.long)
                        life_idx = torch.tensor([LIFECYCLE_STAGES.index(lifecycle)], dtype=torch.long)
                        log_best = torch.tensor([[encode_log_best(bestScore_bin)]], dtype=torch.float32)
                        theta_t = torch.tensor(theta, dtype=torch.float32).unsqueeze(0)
                        with torch.no_grad():
                            pred = model(theta_t, diff_idx, gen_idx, life_idx, log_best).squeeze(0)
                            J = compute_J(pred, lifecycle, weights).item()
                        ctx_best = current_best.get(ctx_key, 0.0)
                        improvement += max(0, J - ctx_best)
                        count += 1
        ei_values.append(improvement / max(1, count))

    indices = np.argsort(ei_values)[::-1][:n_pick]
    return [candidate_thetas[i].tolist() for i in indices]


def build_phase_d_tasks(
    db_path: str,
    run_id: int,
    surrogate_path: str,
    budget: int,
    weights: dict,
    seeds_per_theta: int = 3,
) -> list:
    """生成 Phase D 主动采样任务。"""
    ratio_variance = 0.50
    ratio_ei = 0.30
    ratio_boundary = 0.20

    n_variance = int(budget * ratio_variance) // seeds_per_theta
    n_ei = int(budget * ratio_ei) // seeds_per_theta
    n_boundary = int(budget * ratio_boundary) // seeds_per_theta

    print(f"[active_sampling] 加载代理 from {surrogate_path}")
    ckpt = torch.load(surrogate_path, map_location="cpu")
    model = SpawnTuningSurrogate()
    model.load_state_dict(ckpt["model_state_dict"])

    print(f"  variance pool: {n_variance} θ × {seeds_per_theta} seeds")
    variance_thetas = sample_high_variance(model, n_candidates=n_variance * 5, n_pick=n_variance)

    print(f"  EI pool: {n_ei} θ × {seeds_per_theta} seeds")
    # current_best: 简化处理为各 context 当前样本最高 J
    # 实际实现应从 SQLite 读后用 compute_J 算; 这里先用 0.5 当 placeholder
    current_best = {}
    ei_thetas = sample_high_ei(model, n_candidates=n_ei * 5, n_pick=n_ei,
                                weights=weights, current_best=current_best)

    print(f"  boundary pool: {n_boundary} θ × {seeds_per_theta} seeds for sparse contexts")
    counts = context_sample_counts(db_path, run_id)
    sparse_ctxs = sorted(counts.items(), key=lambda kv: kv[1])[:20]

    # 组装任务
    tasks = []
    for ctx_key, _cnt in sparse_ctxs[:n_boundary]:
        for theta_norm in latin_hypercube_starts(1, dim=14, seed=hash(ctx_key) & 0xFFFFFFFF):
            for seed_idx in range(seeds_per_theta):
                tasks.append({
                    "context_key": ctx_key,
                    "theta_norm": theta_norm.tolist(),
                    "theta": decode_theta(theta_norm),
                    "seed_offset": seed_idx,
                    "source": "boundary",
                })

    for theta_norm in variance_thetas:
        for seed_idx in range(seeds_per_theta):
            tasks.append({
                "context_key": None,  # variance/EI θ 在所有 context 都跑
                "theta_norm": list(theta_norm),
                "theta": decode_theta(np.array(theta_norm)),
                "seed_offset": seed_idx,
                "source": "variance",
            })
    for theta_norm in ei_thetas:
        for seed_idx in range(seeds_per_theta):
            tasks.append({
                "context_key": None,
                "theta_norm": list(theta_norm),
                "theta": decode_theta(np.array(theta_norm)),
                "seed_offset": seed_idx,
                "source": "ei",
            })

    return tasks


def main():
    p = argparse.ArgumentParser(description="Phase D 主动学习采样任务生成")
    p.add_argument("--db", required=True)
    p.add_argument("--run-id", required=True, type=int)
    p.add_argument("--surrogate", required=True)
    p.add_argument("--budget", type=int, default=70000)
    p.add_argument("--seeds-per-theta", type=int, default=3)
    p.add_argument("--output", default="phase_d_tasks.json")
    p.add_argument("--weights-fairness", type=float, default=70)
    p.add_argument("--weights-excitement", type=float, default=45)
    p.add_argument("--weights-anti-inflation", type=float, default=60)
    args = p.parse_args()

    weights = {
        "fairness": args.weights_fairness,
        "excitement": args.weights_excitement,
        "antiInflation": args.weights_anti_inflation,
    }

    tasks = build_phase_d_tasks(
        args.db, args.run_id, args.surrogate, args.budget,
        weights, seeds_per_theta=args.seeds_per_theta,
    )

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump({"tasks": tasks, "budget": args.budget, "weights": weights}, f, indent=2)
    print(f"\n✓ Phase D 任务生成: {len(tasks)} 个 → {args.output}")
    print(f"\n下一步: node scripts/spawn-tune-v2.mjs --tasks-from {args.output}")


if __name__ == "__main__":
    main()
