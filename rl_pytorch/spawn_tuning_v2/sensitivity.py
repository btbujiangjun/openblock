"""θ 敏感性审计 (P2) — 量化每个 θ 维度对 D/E/F 预测曲线的撬动力。

业务动机
  36 维 θ 不是每维都同样"有用"。寻参/采样资源有限, 需要知道:
    - 哪些 θ 真正撬动难度 D / 爽感 E / 挫败 F (高敏感 → 值得寻优 + 采样覆盖)
    - 哪些 θ 几乎无影响 (低敏感 → 可固定为默认, 给搜索空间瘦身)
  这也是"所有 θ 必须真实消费"契约的事后体检: 若某 θ 在模型上敏感度恒为 0,
  说明它要么没接进出块管线, 要么训练样本未覆盖其变化。

方法 (单点数值梯度)
  对给定 context, 以 θ_norm = 0.5 (各维中点) 为基准, 对每一维 k 做 ±delta 扰动,
  测预测曲线的平均绝对变化:
      sens_D[k] = mean(|D(θ+δe_k) − D(θ−δe_k)|) / (2δ)
  E/F 同理。不依赖任何真实样本 / target, 纯粹探测模型对 θ 的局部响应,
  因此与 rl-bot no-peek 无关 (只问"模型学到 θ 的边际效应有多大")。

用法
  python -m rl_pytorch.spawn_tuning_v2.sensitivity \
      --checkpoint checkpoints/v2/model.pt [--top 12]
"""
from __future__ import annotations

import argparse
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch

from .feature_io import THETA_KEYS
from .model import SpawnParamTunerResNet, N_THETA, N_CURVE_BINS
from .optimize_theta import context_to_indices, enumerate_all_contexts


def load_model_from_checkpoint(
    checkpoint_path: str | Path,
    device: torch.device = torch.device("cpu"),
) -> SpawnParamTunerResNet:
    """加载 ResNet 寻参代理 (与 optimize_theta.build_bundle 同样的兼容加载)。"""
    ck = torch.load(checkpoint_path, map_location=device, weights_only=False)
    arch = ck.get("arch", {})
    model = SpawnParamTunerResNet(
        hidden_dim=arch.get("hidden_dim", 128),
        n_blocks=arch.get("n_blocks", 8),
        curve_bins=arch.get("curve_bins", N_CURVE_BINS),
    ).to(device)
    from .model import load_state_dict_compat
    load_state_dict_compat(model, ck["model_state_dict"])
    model.eval()
    return model


def _forward_curves(model, ctx_t: Dict, theta: torch.Tensor) -> Dict[str, np.ndarray]:
    """单次前向, 返回 D/E/F 曲线 (numpy, (n_bins,))。E/F 缺失时返回 None。"""
    with torch.no_grad():
        preds = model(
            difficulty_idx=ctx_t["difficulty_idx"], generator_idx=ctx_t["generator_idx"],
            bot_idx=ctx_t["bot_idx"], pb_bin_idx=ctx_t["pb_bin_idx"],
            lifecycle_idx=ctx_t["lifecycle_idx"], log_pb=ctx_t["log_pb"], theta_norm=theta,
        )
    out = {"curve": preds["curve"][0].cpu().numpy()}
    out["curve_e"] = preds["curve_e"][0].cpu().numpy() if "curve_e" in preds else None
    out["curve_f"] = preds["curve_f"][0].cpu().numpy() if "curve_f" in preds else None
    return out


def theta_sensitivity_one_context(
    model: SpawnParamTunerResNet,
    ctx: Dict,
    device: torch.device = torch.device("cpu"),
    delta: float = 0.1,
    base: float = 0.5,
) -> List[Dict]:
    """对单 context 算 36 维 θ 的 D/E/F 敏感度, 按 D 敏感度降序返回。

    返回 [{theta_key, sens_d, sens_e, sens_f}, ...]。
    """
    idx = context_to_indices(ctx)
    ctx_t = {
        "difficulty_idx": torch.tensor([idx["difficulty_idx"]], device=device, dtype=torch.long),
        "generator_idx": torch.tensor([idx["generator_idx"]], device=device, dtype=torch.long),
        "bot_idx": torch.tensor([idx["bot_idx"]], device=device, dtype=torch.long),
        "pb_bin_idx": torch.tensor([idx["pb_bin_idx"]], device=device, dtype=torch.long),
        "lifecycle_idx": torch.tensor([idx["lifecycle_idx"]], device=device, dtype=torch.long),
        "log_pb": torch.tensor([idx["log_pb"]], device=device, dtype=torch.float32),
    }

    def _sens(curve_key: str) -> List[float]:
        out = []
        for k in range(N_THETA):
            hi = torch.full((1, N_THETA), base, device=device)
            lo = torch.full((1, N_THETA), base, device=device)
            hi[0, k] = min(1.0, base + delta)
            lo[0, k] = max(0.0, base - delta)
            span = float(hi[0, k] - lo[0, k]) or 1e-9
            c_hi = _forward_curves(model, ctx_t, hi)[curve_key]
            c_lo = _forward_curves(model, ctx_t, lo)[curve_key]
            if c_hi is None or c_lo is None:
                out.append(0.0)
            else:
                out.append(float(np.mean(np.abs(c_hi - c_lo)) / span))
        return out

    sd = _sens("curve")
    se = _sens("curve_e")
    sf = _sens("curve_f")
    rows = [
        {"theta_key": THETA_KEYS[k], "sens_d": sd[k], "sens_e": se[k], "sens_f": sf[k]}
        for k in range(N_THETA)
    ]
    rows.sort(key=lambda r: r["sens_d"], reverse=True)
    return rows


def theta_sensitivity(
    model: SpawnParamTunerResNet,
    contexts: Optional[List[Dict]] = None,
    device: torch.device = torch.device("cpu"),
    delta: float = 0.1,
) -> List[Dict]:
    """跨多 context 平均的 θ 敏感度审计, 按平均 D 敏感度降序返回。"""
    ctxs = contexts if contexts is not None else enumerate_all_contexts()
    acc = {k: {"sens_d": 0.0, "sens_e": 0.0, "sens_f": 0.0} for k in THETA_KEYS}
    for ctx in ctxs:
        for r in theta_sensitivity_one_context(model, ctx, device=device, delta=delta):
            a = acc[r["theta_key"]]
            a["sens_d"] += r["sens_d"]
            a["sens_e"] += r["sens_e"]
            a["sens_f"] += r["sens_f"]
    n = max(1, len(ctxs))
    rows = [
        {"theta_key": k, "sens_d": v["sens_d"] / n, "sens_e": v["sens_e"] / n, "sens_f": v["sens_f"] / n}
        for k, v in acc.items()
    ]
    rows.sort(key=lambda r: r["sens_d"], reverse=True)
    return rows


def main():
    ap = argparse.ArgumentParser(description="θ 敏感性审计 (D/E/F 撬动力)")
    ap.add_argument("--checkpoint", required=True, help="ResNet 寻参代理 ckpt 路径")
    ap.add_argument("--delta", type=float, default=0.1, help="θ_norm 扰动半径 (默认 0.1)")
    ap.add_argument("--max-contexts", type=int, default=0, help=">0 时只取前 N 个 ctx (加速)")
    ap.add_argument("--top", type=int, default=0, help=">0 时只打印 top-N (默认全 36 维)")
    args = ap.parse_args()

    device = torch.device("cpu")
    model = load_model_from_checkpoint(args.checkpoint, device=device)
    ctxs = enumerate_all_contexts()
    if args.max_contexts > 0:
        ctxs = ctxs[: args.max_contexts]
    rows = theta_sensitivity(model, contexts=ctxs, device=device, delta=args.delta)
    if args.top > 0:
        rows = rows[: args.top]

    print(f"\n=== θ 敏感性审计 ({len(ctxs)} ctx, δ={args.delta}) — 按对难度 D 的撬动力降序 ===")
    print(f"{'rank':>4}  {'theta_key':<32}  {'sens_D':>8}  {'sens_E':>8}  {'sens_F':>8}")
    for i, r in enumerate(rows):
        print(f"{i + 1:>4}  {r['theta_key']:<32}  {r['sens_d']:>8.4f}  {r['sens_e']:>8.4f}  {r['sens_f']:>8.4f}")
    dead = [r["theta_key"] for r in rows if max(r["sens_d"], r["sens_e"], r["sens_f"]) < 1e-4]
    if dead:
        print(f"\n⚠ 近零敏感 (D/E/F 全 < 1e-4) θ: {dead}  — 检查是否真实接入出块管线或样本是否覆盖其变化")


if __name__ == "__main__":
    main()
