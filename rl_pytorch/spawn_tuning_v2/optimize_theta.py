"""Phase C — 在训好的 NN 代理上, 对每个 context 跑梯度上升找最优 θ*。

业务目标:
  对每个 context (5 维场景) c, 找 θ 使得预测的 d_curve(c, θ) 最贴近目标 S 曲线。
  以"shape loss + 业务约束"作为优化目标,每个 context 独立跑梯度上升。

输入:
  - 训好的 SpawnParamTunerResNet checkpoint
  - context 枚举 (480 个, v3.2 含 rl-bot) + 权重 (LossWeights)
  - 每 context 起点数 (n_starts), 每起点步数 (steps)

输出 policies.json:
  {
    "format": "openblock-spawn-tuning-v2-policies",
    "model_id": 42,
    "model_sha256": "...",
    "context_count": 480,
    "policies": [
      {
        "context_key": "easy:budget-p2:random:1500:growth",
        "context_indices": {difficulty: 0, ...},
        "theta": { "personalizationStrength": 0.12, ... },   # 5 个参数(去归一化)
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

from .model import SpawnParamTunerResNet, N_THETA, N_CURVE_BINS, build_default_model
from .feature_io import (
    DIFFICULTY_INDEX, GENERATOR_INDEX, BOT_INDEX, PB_BIN_INDEX, LIFECYCLE_INDEX,
    THETA_KEYS, denormalize_theta,
)
from .target_curve import target_curve_vector, target_E_vector, target_F_vector
from .losses import (
    LossWeights, loss_shape, loss_breaking, loss_surprise,
    loss_curve_e, loss_curve_f, loss_frustration_cap,
)


# ─────────── Context 枚举 ───────────
# v3.0.8: GENERATOR 与 game.js getSpawnPolicyMode() 严格 1:1 — 仅 rule / generative (2 个).
#   v3.2: 480 ctx = 3 difficulty × 2 generator × 4 bot (含 rl-bot) × 5 pb × 4 lifecycle.
DIFFICULTY_VALUES = list(DIFFICULTY_INDEX.keys())
GENERATOR_VALUES = list(GENERATOR_INDEX.keys())
BOT_VALUES = list(BOT_INDEX.keys())
PB_BIN_VALUES = list(PB_BIN_INDEX.keys())
LIFECYCLE_VALUES = list(LIFECYCLE_INDEX.keys())

# v3.0.8: 部署/枚举 = 全部 GENERATOR_VALUES (rule / generative, 已与游戏页面 1:1)
DEPLOYABLE_GENERATORS = list(GENERATOR_INDEX.keys())   # ['rule', 'generative']
# v3.2: rl-bot 正式纳入部署枚举。rl-bot 采样严格 no-peek (samplerV2.js: 决策仅看
#   棋盘 + 可见 dock + strategy/arc/intent, 绝不读 spawn θ / 未来块), 故其 (ctx, θ) → 曲线
#   映射与其它 bot 同构, 可安全寻参。需训练集含 rl-bot 样本 (否则模型靠 embedding 外插)。
DEPLOYABLE_BOTS = ["random", "clear-greedy", "survival", "rl-bot"]


def enumerate_all_contexts() -> List[Dict]:
    """枚举全部 3×2×4×5×4 = 480 个可部署 context (v3.2: bot 含 rl-bot)。"""
    out = []
    for d, g, b, p, l in itertools.product(
        DIFFICULTY_VALUES, DEPLOYABLE_GENERATORS, DEPLOYABLE_BOTS, PB_BIN_VALUES, LIFECYCLE_VALUES,
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
    model: SpawnParamTunerResNet,
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

    v3.2 多曲线目标 = L_shape (难度 D 贴 ideal S)
              + δ · L_breaking + γ · L_surprise (单 sample 上有意义)
              + curve_e · (-E 朝 ideal E, 即多爽感)
              + curve_f · (F 朝 ideal F) + frustration_cap · (F 不超 cap)

    best 仍以难度 shape_loss 为主排序 (难度是主轴), E/F 作为联合塑形项参与梯度,
    保证寻出的 θ* 在贴合难度曲线的同时, 爽感不塌、挫败不破上限。

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
    # v3.2 多曲线: ideal E/F 目标 (单 sample 的 mask=1, 让 loss_curve_e/f 的 sample 项生效)
    n_bins = target_curve.size(0)
    ideal_e_b = torch.tensor(target_E_vector(n_bins=n_bins), dtype=torch.float32, device=device).unsqueeze(0)
    ideal_f_b = torch.tensor(target_F_vector(n_bins=n_bins), dtype=torch.float32, device=device).unsqueeze(0)
    ef_mask_one = torch.ones(1, device=device)

    best_loss = float("inf")
    best_theta = None
    best_pred = None
    best_pred_e = None
    best_pred_f = None
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
            # v3.2 多曲线: 爽感朝 ideal E (多爽感), 挫败朝 ideal F + 不破 cap
            if "curve_e" in preds:
                loss = loss + w.curve_e * loss_curve_e(preds["curve_e"], ideal_e_b, ef_mask_one)
            if "curve_f" in preds:
                loss = loss + w.curve_f * loss_curve_f(preds["curve_f"], ideal_f_b, ef_mask_one)
                loss = loss + w.frustration_cap * loss_frustration_cap(preds["curve_f"])

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
            best_pred_e = preds["curve_e"].detach().cpu().numpy()[0] if "curve_e" in preds else None
            best_pred_f = preds["curve_f"].detach().cpu().numpy()[0] if "curve_f" in preds else None
            best_other = {
                "pb_broke": float(preds["pb_broke"].item()),
                "noMove": float(preds["noMove"].item()),
                "score": float(preds["score"].item()),
                "survival": float(preds["survival"].item()),
            }

    # ↓ 计算 MAE (业务可读指标)
    target_np = target_curve.cpu().numpy()
    curve_mae = float(np.mean(np.abs(best_pred - target_np)))

    out = {
        "theta_norm": best_theta.tolist(),
        "theta": denormalize_theta(best_theta),
        "predicted_curve": best_pred.tolist(),
        "shape_loss": best_loss,
        "predicted_curve_mae_to_target": curve_mae,
        "expected": best_other,
    }
    # v3.2 多曲线: 输出爽感 / 挫败预测曲线 + 朝 ideal 的 MAE (供面板 / fact_eval)
    if best_pred_e is not None:
        out["predicted_curve_e"] = best_pred_e.tolist()
        out["predicted_curve_e_mae_to_ideal"] = float(np.mean(np.abs(best_pred_e - ideal_e_b.cpu().numpy()[0])))
    if best_pred_f is not None:
        out["predicted_curve_f"] = best_pred_f.tolist()
        out["predicted_curve_f_mae_to_ideal"] = float(np.mean(np.abs(best_pred_f - ideal_f_b.cpu().numpy()[0])))
        out["predicted_frustration_max"] = float(np.max(best_pred_f))
    return out


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
    model = SpawnParamTunerResNet(
        hidden_dim=arch.get("hidden_dim", 128),
        n_blocks=arch.get("n_blocks", 8),
        curve_bins=arch.get("curve_bins", N_CURVE_BINS),
    ).to(device)
    # v2.10.33 (P2.2 兼容): strict=False 让老 ckpt (无 head_r) 也能 bundle 部署
    # v2.10.34: + load_state_dict_compat 处理 emb 维度扩展
    from .model import load_state_dict_compat
    missing, unexpected = load_state_dict_compat(model, ck["model_state_dict"])
    if missing or unexpected:
        print(f"[optimize_theta] ckpt warn — missing: {missing[:3]} unexpected: {unexpected[:3]}")

    # 文件 sha256 (供 policy 元数据)
    bin_bytes = Path(checkpoint_path).read_bytes()
    sha256 = hashlib.sha256(bin_bytes).hexdigest()

    # 目标曲线
    target = torch.tensor(target_curve_vector(), dtype=torch.float32)

    # contexts (默认 480, v3.2 含 rl-bot)
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
