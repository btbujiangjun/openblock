"""Phase C — 在训好的 NN 代理上, 对每个 context 跑梯度上升找最优 θ*。

业务目标:
  对每个 context (5 维场景) c, 找 θ 使得预测的 d_curve(c, θ) 最贴近目标 S 曲线。
  以"shape loss + 业务约束"作为优化目标,每个 context 独立跑梯度上升。

输入:
  - 训好的 SpawnTuningResNetMLP checkpoint
  - context 枚举 (360 个) + 权重 (LossWeights)
  - 每 context 起点数 (n_starts), 每起点步数 (steps)

输出 policies.json:
  {
    "format": "openblock-spawn-tuning-v2-policies",
    "model_id": 42,
    "model_sha256": "...",
    "context_count": 360,
    "policies": [
      {
        "context_key": "easy:budget-p2:random:1500:growth",
        "context_indices": {difficulty: 0, ...},
        "theta": { "pbTension_strength": 0.42, ... },   # 14 个参数(去归一化)
        "predicted_curve": [0.21, 0.23, ...],            # 20 维
        "predicted_curve_mae_to_target": 0.034,
        "expected": {"pb_broke": 0.12, "noMove": 0.08, ...}
      },
      ...
    ]
  }

CLI:
  python -m rl_pytorch.spawn_tuning_v2.optimize_theta \
      --checkpoint checkpoints/v2/run_001.pt \
      --output checkpoints/v2/policies-run_001.json \
      --n-starts 8 --steps 300 --device cpu
"""
from __future__ import annotations
import argparse
import hashlib
import itertools
import json
import math
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn

from .model import SpawnTuningResNetMLP, N_THETA, N_CURVE_BINS, build_default_model
from .feature_io import (
    DIFFICULTY_INDEX, GENERATOR_INDEX, BOT_INDEX, PB_BIN_INDEX, LIFECYCLE_INDEX,
    THETA_KEYS, denormalize_theta,
)
from .target_curve import target_curve_vector
from .losses import LossWeights, loss_shape, loss_breaking, loss_surprise


# ─────────── Context 枚举 ───────────

DIFFICULTY_VALUES = list(DIFFICULTY_INDEX.keys())
GENERATOR_VALUES = list(GENERATOR_INDEX.keys())
BOT_VALUES = list(BOT_INDEX.keys())
PB_BIN_VALUES = list(PB_BIN_INDEX.keys())
LIFECYCLE_VALUES = list(LIFECYCLE_INDEX.keys())


def enumerate_all_contexts() -> List[Dict]:
    """枚举全部 3×2×3×5×4 = 360 个 context。"""
    out = []
    for d, g, b, p, l in itertools.product(
        DIFFICULTY_VALUES, GENERATOR_VALUES, BOT_VALUES, PB_BIN_VALUES, LIFECYCLE_VALUES,
    ):
        out.append({
            "difficulty": d,
            "generator": g,
            "bot_policy": b,
            "pb_bin": p,
            "lifecycle_stage": l,
            "context_key": f"{d}:{g}:{b}:{p}:{l}",
        })
    return out


def context_to_indices(ctx: Dict) -> Dict[str, int]:
    """context dict → embedding 索引。"""
    return {
        "difficulty_idx": DIFFICULTY_INDEX[ctx["difficulty"]],
        "generator_idx": GENERATOR_INDEX[ctx["generator"]],
        "bot_idx": BOT_INDEX[ctx["bot_policy"]],
        "pb_bin_idx": PB_BIN_INDEX[ctx["pb_bin"]],
        "lifecycle_idx": LIFECYCLE_INDEX[ctx["lifecycle_stage"]],
        "log_pb": math.log10(max(1.0, float(ctx["pb_bin"]))),
    }


# ─────────── 单 context 优化 ───────────

def optimize_one_context(
    model: SpawnTuningResNetMLP,
    ctx: Dict,
    target_curve: torch.Tensor,        # (n_bins,)
    n_starts: int = 8,
    steps: int = 300,
    lr: float = 0.05,
    weights: Optional[LossWeights] = None,
    device: torch.device = torch.device("cpu"),
    seed: int = 42,
) -> Dict:
    """对单个 context 跑 n_starts 个起点 × steps 步, 选 best。

    优化目标 = L_shape (对该 ctx 的预测 curve 与目标 curve 的 MSE)
              + δ · L_breaking + γ · L_surprise (单 sample 上有意义)

    L_balance 在单 sample 上没意义 (只能在 batch 计算) — 这里跳过。
    L_smooth 也跳过 (∂y/∂θ 对单点没意义)。
    """
    w = weights or LossWeights()
    torch.manual_seed(seed)
    np.random.seed(seed)

    indices = context_to_indices(ctx)
    diff_t = torch.tensor([indices["difficulty_idx"]], device=device, dtype=torch.long)
    gen_t = torch.tensor([indices["generator_idx"]], device=device, dtype=torch.long)
    bot_t = torch.tensor([indices["bot_idx"]], device=device, dtype=torch.long)
    pb_t = torch.tensor([indices["pb_bin_idx"]], device=device, dtype=torch.long)
    life_t = torch.tensor([indices["lifecycle_idx"]], device=device, dtype=torch.long)
    log_pb_t = torch.tensor([indices["log_pb"]], device=device, dtype=torch.float32)

    target_b = target_curve.unsqueeze(0).to(device)  # (1, n_bins)

    best_loss = float("inf")
    best_theta = None
    best_pred = None
    best_other = None

    model.eval()
    for start_idx in range(n_starts):
        # LHS 风格起点: 不同 start 用不同 seed 撒不同初值
        torch.manual_seed(seed + start_idx * 17)
        theta = torch.rand(1, N_THETA, device=device, requires_grad=True)

        optimizer = torch.optim.Adam([theta], lr=lr)
        for step in range(steps):
            optimizer.zero_grad()
            preds = model(
                difficulty_idx=diff_t, generator_idx=gen_t, bot_idx=bot_t,
                pb_bin_idx=pb_t, lifecycle_idx=life_t,
                log_pb=log_pb_t, theta_norm=theta,
            )
            curve_pred = preds["curve"]  # (1, n_bins)

            loss = w.shape * loss_shape(curve_pred, target_b)
            loss = loss + w.breaking * loss_breaking(curve_pred)
            loss = loss + w.surprise * loss_surprise(curve_pred)

            loss.backward()
            optimizer.step()
            # 投影到 [0, 1]
            with torch.no_grad():
                theta.data.clamp_(0.0, 1.0)

        # 最终评估
        with torch.no_grad():
            preds = model(
                difficulty_idx=diff_t, generator_idx=gen_t, bot_idx=bot_t,
                pb_bin_idx=pb_t, lifecycle_idx=life_t,
                log_pb=log_pb_t, theta_norm=theta,
            )
            final_loss = float(loss_shape(preds["curve"], target_b).item())

        if final_loss < best_loss:
            best_loss = final_loss
            best_theta = theta.detach().cpu().numpy()[0]
            best_pred = preds["curve"].detach().cpu().numpy()[0]
            best_other = {
                "pb_broke": float(preds["pb_broke"].item()),
                "noMove": float(preds["noMove"].item()),
                "score": float(preds["score"].item()),
                "survival": float(preds["survival"].item()),
            }

    # ↓ 计算 MAE (业务可读指标)
    target_np = target_curve.cpu().numpy()
    curve_mae = float(np.mean(np.abs(best_pred - target_np)))

    return {
        "theta_norm": best_theta.tolist(),
        "theta": denormalize_theta(best_theta),
        "predicted_curve": best_pred.tolist(),
        "shape_loss": best_loss,
        "predicted_curve_mae_to_target": curve_mae,
        "expected": best_other,
    }


# ─────────── 全 contexts 优化 ───────────

def optimize_all_contexts(
    checkpoint_path: str,
    output_path: str,
    n_starts: int = 8,
    steps: int = 300,
    lr: float = 0.05,
    weights: Optional[LossWeights] = None,
    device_str: str = "cpu",
    seed: int = 42,
    contexts: Optional[List[Dict]] = None,
    log_every: int = 20,
) -> Dict:
    """对全部(或指定的) contexts 跑 Phase C 寻参。

    Returns:
        policies dict (与写入 output_path 内容一致)
    """
    device = torch.device(device_str)
    weights = weights or LossWeights()

    # 加载模型
    ck = torch.load(checkpoint_path, map_location=device, weights_only=False)
    arch = ck.get("arch", {})
    model = SpawnTuningResNetMLP(
        hidden_dim=arch.get("hidden_dim", 128),
        n_blocks=arch.get("n_blocks", 8),
        curve_bins=arch.get("curve_bins", N_CURVE_BINS),
    ).to(device)
    model.load_state_dict(ck["model_state_dict"])

    # 文件 sha256 (供 policy 元数据)
    bin_bytes = Path(checkpoint_path).read_bytes()
    sha256 = hashlib.sha256(bin_bytes).hexdigest()

    # 目标曲线
    target = torch.tensor(target_curve_vector(), dtype=torch.float32)

    # contexts (默认 360)
    ctxs = contexts if contexts is not None else enumerate_all_contexts()
    print(f"[optimize_theta_v2] 对 {len(ctxs)} 个 contexts 跑梯度上升 (n_starts={n_starts}, steps={steps})…")

    t0 = time.time()
    policies = []
    for i, ctx in enumerate(ctxs):
        result = optimize_one_context(
            model=model, ctx=ctx, target_curve=target,
            n_starts=n_starts, steps=steps, lr=lr,
            weights=weights, device=device, seed=seed + i * 13,
        )
        policies.append({
            "context_key": ctx["context_key"],
            "context": {k: ctx[k] for k in ["difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage"]},
            "context_indices": context_to_indices(ctx),
            **result,
        })
        if (i + 1) % log_every == 0:
            elapsed = time.time() - t0
            rate = (i + 1) / elapsed
            eta = (len(ctxs) - (i + 1)) / rate if rate > 0 else 0
            avg_mae = sum(p["predicted_curve_mae_to_target"] for p in policies) / len(policies)
            print(f"[optimize_theta_v2] [{i + 1}/{len(ctxs)}] avg_mae={avg_mae:.4f} "
                  f"rate={rate:.1f}/s eta={eta:.0f}s")

    elapsed_total = time.time() - t0
    avg_mae = sum(p["predicted_curve_mae_to_target"] for p in policies) / len(policies)
    print(f"[optimize_theta_v2] ✓ 完成 {len(policies)} 个 policies · 平均 MAE={avg_mae:.4f} · 耗时 {elapsed_total:.1f}s")

    # ─── 输出 ───
    output = {
        "format": "openblock-spawn-tuning-v2-policies",
        "version": "2.0.0",
        "model_checkpoint": str(checkpoint_path),
        "model_sha256": sha256,
        "n_contexts": len(policies),
        "n_starts": n_starts,
        "steps": steps,
        "lr": lr,
        "weights": weights.to_dict(),
        "average_curve_mae": avg_mae,
        "elapsed_s": elapsed_total,
        "generated_at": int(time.time()),
        "policies": policies,
    }
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
    print(f"[optimize_theta_v2] policies → {output_path}")

    return output


# ─────────── CLI ───────────

def main():
    p = argparse.ArgumentParser(description="Phase C — v2 在 NN 代理上找最优 θ")
    p.add_argument("--checkpoint", required=True, help="训好的 .pt 模型路径")
    p.add_argument("--output", required=True, help="输出 policies.json 路径")
    p.add_argument("--n-starts", type=int, default=8)
    p.add_argument("--steps", type=int, default=300)
    p.add_argument("--lr", type=float, default=0.05)
    p.add_argument("--device", default="cpu")
    p.add_argument("--seed", type=int, default=42)
    # 权重
    p.add_argument("--w-shape", type=float, default=1.0)
    p.add_argument("--w-breaking", type=float, default=0.5)
    p.add_argument("--w-surprise", type=float, default=0.3)
    # 调试用: 只跑部分 ctx
    p.add_argument("--max-contexts", type=int, default=None, help="只跑前 N 个 (调试)")
    args = p.parse_args()

    weights = LossWeights(shape=args.w_shape, breaking=args.w_breaking, surprise=args.w_surprise)
    contexts = None
    if args.max_contexts:
        contexts = enumerate_all_contexts()[: args.max_contexts]

    optimize_all_contexts(
        checkpoint_path=args.checkpoint,
        output_path=args.output,
        n_starts=args.n_starts,
        steps=args.steps,
        lr=args.lr,
        weights=weights,
        device_str=args.device,
        seed=args.seed,
        contexts=contexts,
    )


if __name__ == "__main__":
    main()
