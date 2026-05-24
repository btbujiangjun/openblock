"""
Phase C — 用训练好的代理模型对每个 context 跑梯度上升找 θ*(context)。

算法 (per context):
    1. LHS 在 [0, 1]^14 生成 N_starts (默认 10) 个起点
    2. 每个起点用 Adam 优化 max compute_J(surrogate(θ, c), weights)
    3. 每步把 θ.data 钳到 [0, 1]^14
    4. 取所有起点中 J 最高的为该 context 的 θ*

用法:
    python -m rl_pytorch.spawn_tuning.optimize_theta \
        --surrogate checkpoints/surrogate_phase_b.pt \
        --weights-fairness 70 --weights-excitement 45 --weights-anti-inflation 60 \
        --n-starts 10 --steps 300 \
        --output policies.json

输出 policies.json:
    [
        {
            "context_key": "normal:budget-p2:1500:growth",
            "difficulty": "...", "generator": "...", ...
            "theta": { ...14 dims... },
            "expected_fairness": 0.82, ...
            "expected_composite": 0.74
        },
        ... 120 行 ...
    ]
    可直接 POST 到 /api/spawn-tuning/v2/policies/deploy
"""

import argparse
import json
import math
from pathlib import Path

import numpy as np
import torch

from .surrogate_model import (
    SpawnTuningSurrogate,
    DIFFICULTIES, GENERATORS, LIFECYCLE_STAGES,
)
from .feature_io import (
    PARAM_KEYS, LOG_BEST_MEAN, LOG_BEST_STD,
    decode_theta, encode_log_best,
)


BEST_SCORE_BINS = [500, 1500, 4000, 10000, 25000]
LIFECYCLE_MULTIPLIERS = {
    "onboarding": {"fairness": 1.5, "excitement": 1.2, "antiInflation": 0.5},
    "growth":     {"fairness": 1.0, "excitement": 1.0, "antiInflation": 1.0},
    "mature":     {"fairness": 0.8, "excitement": 0.9, "antiInflation": 1.5},
    "plateau":    {"fairness": 0.7, "excitement": 1.5, "antiInflation": 0.8},
}


def compute_J(pred: torch.Tensor, lifecycle: str, weights: dict) -> torch.Tensor:
    """计算上下文条件化目标。与 objective.js computeObjective 等价。

    pred: [3] = (fairness, excitement, antiInflation)
    return: 标量 composite ∈ [0, 1]
    """
    w = torch.tensor([
        max(0.0, weights.get("fairness", 0.0)),
        max(0.0, weights.get("excitement", 0.0)),
        max(0.0, weights.get("antiInflation", 0.0)),
    ], device=pred.device)
    total_w = w.sum() + 1e-9
    w = w / total_w

    m = LIFECYCLE_MULTIPLIERS.get(lifecycle, LIFECYCLE_MULTIPLIERS["growth"])
    m_t = torch.tensor([m["fairness"], m["excitement"], m["antiInflation"]], device=pred.device)

    wm = w * m_t
    numerator = (wm * pred).sum()
    denominator = wm.sum() + 1e-9
    return numerator / denominator


def latin_hypercube_starts(n: int, dim: int = 14, seed: int = 42) -> np.ndarray:
    """生成 n 个 LHS 起点。"""
    rng = np.random.default_rng(seed)
    cols = []
    for d in range(dim):
        values = (np.arange(n) + rng.random(n)) / n
        rng.shuffle(values)
        cols.append(values)
    return np.stack(cols, axis=1)  # [n, dim]


def optimize_for_context(
    model: SpawnTuningSurrogate,
    difficulty: str, generator: str, bestScore_bin: int, lifecycle: str,
    weights: dict,
    n_starts: int = 10,
    steps: int = 300,
    lr: float = 0.01,
    seed: int = 42,
    device: str = "cpu",
) -> dict:
    """对单个 context 跑梯度上升,返回最优 θ。"""
    diff_idx = torch.tensor([DIFFICULTIES.index(difficulty)], device=device, dtype=torch.long)
    gen_idx = torch.tensor([GENERATORS.index(generator)], device=device, dtype=torch.long)
    life_idx = torch.tensor([LIFECYCLE_STAGES.index(lifecycle)], device=device, dtype=torch.long)
    log_best = torch.tensor([[encode_log_best(bestScore_bin)]], device=device, dtype=torch.float32)

    starts = latin_hypercube_starts(n_starts, dim=14, seed=seed)
    best_J = -float("inf")
    best_theta = None
    best_pred = None

    model.eval()
    for start_idx, start in enumerate(starts):
        theta = torch.tensor(start, device=device, dtype=torch.float32, requires_grad=True)
        opt = torch.optim.Adam([theta], lr=lr)

        for step in range(steps):
            opt.zero_grad()
            pred = model(theta.unsqueeze(0), diff_idx, gen_idx, life_idx, log_best).squeeze(0)
            J = compute_J(pred, lifecycle, weights)
            loss = -J  # maximize J = minimize -J
            loss.backward()
            opt.step()
            with torch.no_grad():
                theta.data.clamp_(0, 1)

        with torch.no_grad():
            final_pred = model(theta.unsqueeze(0), diff_idx, gen_idx, life_idx, log_best).squeeze(0)
            final_J = compute_J(final_pred, lifecycle, weights).item()

        if final_J > best_J:
            best_J = final_J
            best_theta = theta.detach().cpu().numpy()
            best_pred = final_pred.detach().cpu().numpy()

    return {
        "theta": decode_theta(best_theta),
        "composite": best_J,
        "fairness": float(best_pred[0]),
        "excitement": float(best_pred[1]),
        "antiInflation": float(best_pred[2]),
    }


def make_context_key(difficulty, generator, bestScore_bin, lifecycle):
    return f"{difficulty}:{generator}:{bestScore_bin}:{lifecycle}"


def optimize_all_contexts(
    surrogate_path: str,
    weights: dict,
    n_starts: int = 10,
    steps: int = 300,
    device: str = "cpu",
) -> list:
    """枚举所有 120 个 context,各自找最优 θ。"""
    print(f"[optimize_theta] 加载代理 from {surrogate_path}")
    ckpt = torch.load(surrogate_path, map_location=device)
    model = SpawnTuningSurrogate().to(device)
    model.load_state_dict(ckpt["model_state_dict"])

    policies = []
    total = len(DIFFICULTIES) * len(GENERATORS) * len(BEST_SCORE_BINS) * len(LIFECYCLE_STAGES)
    i = 0
    for difficulty in DIFFICULTIES:
        for generator in GENERATORS:
            for bestScore_bin in BEST_SCORE_BINS:
                for lifecycle in LIFECYCLE_STAGES:
                    i += 1
                    result = optimize_for_context(
                        model, difficulty, generator, bestScore_bin, lifecycle,
                        weights, n_starts=n_starts, steps=steps,
                        seed=42 + i, device=device,
                    )
                    ctx_key = make_context_key(difficulty, generator, bestScore_bin, lifecycle)
                    policies.append({
                        "context_key": ctx_key,
                        "difficulty": difficulty,
                        "generator": generator,
                        "bestScore_bin": bestScore_bin,
                        "lifecycle_stage": lifecycle,
                        "theta": result["theta"],
                        "expected_fairness": result["fairness"],
                        "expected_excitement": result["excitement"],
                        "expected_antiInflation": result["antiInflation"],
                        "expected_composite": result["composite"],
                    })
                    if i % 10 == 0:
                        print(f"  [{i}/{total}] {ctx_key}  composite={result['composite']:.3f}")

    return policies


def main():
    p = argparse.ArgumentParser(description="Per-context gradient ascent on trained surrogate (Phase C)")
    p.add_argument("--surrogate", required=True, help="trained surrogate .pt checkpoint")
    p.add_argument("--weights-fairness", type=float, default=70)
    p.add_argument("--weights-excitement", type=float, default=45)
    p.add_argument("--weights-anti-inflation", type=float, default=60)
    p.add_argument("--n-starts", type=int, default=10)
    p.add_argument("--steps", type=int, default=300)
    p.add_argument("--output", default="policies.json")
    p.add_argument("--device", default="cpu")
    args = p.parse_args()

    weights = {
        "fairness": args.weights_fairness,
        "excitement": args.weights_excitement,
        "antiInflation": args.weights_anti_inflation,
    }
    policies = optimize_all_contexts(
        args.surrogate, weights,
        n_starts=args.n_starts, steps=args.steps, device=args.device,
    )

    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w") as f:
        json.dump({"policies": policies, "weights": weights}, f, indent=2)
    print(f"\n✓ 完成 120 contexts → {args.output}")
    print(f"\n部署到生产: curl -X POST .../api/spawn-tuning/v2/policies/deploy -d @{args.output}")


if __name__ == "__main__":
    main()
