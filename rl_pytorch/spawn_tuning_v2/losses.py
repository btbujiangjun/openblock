"""
5 项加权损失函数 — 把业务目标量化到训练目标。

L_total = α · L_shape       # MSE on d_curve, 主损失
        + β · L_balance     # PB bin 间 d_curve 均值的方差 (避免某段偏差大)
        + γ · L_surprise    # 惊喜频率拟合 (目标 ~ 7%)
        + δ · L_breaking    # 超越 PB 后单调加压 (ReLU hinge)
        + ε · L_smooth      # ∂D/∂θ 平滑正则
        + ζ · L_aux         # 辅助标签 (pb_broke / noMove / score / survival)

默认权重: α=1.0  β=0.5  γ=0.3  δ=0.5  ε=0.05  ζ=0.2
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Optional, Sequence

import torch
import torch.nn.functional as F


@dataclass
class LossWeights:
    shape: float = 1.0       # α
    balance: float = 0.5     # β
    surprise: float = 0.3    # γ
    breaking: float = 0.5    # δ
    smooth: float = 0.05     # ε
    aux: float = 0.2         # ζ

    def to_dict(self) -> Dict[str, float]:
        return {
            "shape": self.shape, "balance": self.balance, "surprise": self.surprise,
            "breaking": self.breaking, "smooth": self.smooth, "aux": self.aux,
        }


# ─────────── 业务参数 ───────────

TARGET_SURPRISE_RATE = 0.07            # 期望惊喜频率
N_CURVE_BINS = 20
R_MAX = 1.5
BREAKING_R_LOW = 0.9                   # "超越前" 区间
BREAKING_R_HIGH = 1.0                  # 超越临界
SURPRISE_RATE_THRESHOLD = 0.3          # d_step < 这个值视为"惊喜步"


# ─────────── 单项 loss ───────────

def loss_shape(curve_pred: torch.Tensor, curve_target: torch.Tensor) -> torch.Tensor:
    """L_shape = MSE(预测 d_curve, 实测 d_curve)。

    Args:
        curve_pred:   (B, n_bins) ∈ [0, 1]
        curve_target: (B, n_bins) ∈ [0, 1]
    Returns:
        scalar tensor
    """
    return F.mse_loss(curve_pred, curve_target)


def loss_balance(
    curve_pred: torch.Tensor,
    pb_bin_idx: torch.Tensor,
    n_pb_bins: int = 5,
) -> torch.Tensor:
    """L_balance = Var(mean(D_curve) per PB_bin)。

    希望不同 PB 段的难度均值差异小, 否则某档玩家体验明显异于其他档。

    Args:
        curve_pred: (B, n_bins)
        pb_bin_idx: (B,) ∈ [0, n_pb_bins)
        n_pb_bins:  5
    """
    if curve_pred.size(0) == 0:
        return torch.tensor(0.0, device=curve_pred.device)
    per_sample_mean = curve_pred.mean(dim=-1)            # (B,)
    bin_means = []
    for b in range(n_pb_bins):
        mask = (pb_bin_idx == b)
        if mask.any():
            bin_means.append(per_sample_mean[mask].mean())
    if len(bin_means) <= 1:
        return torch.tensor(0.0, device=curve_pred.device)
    bin_means_t = torch.stack(bin_means)
    return bin_means_t.var()


def loss_surprise(
    curve_pred: torch.Tensor,
    target_rate: float = TARGET_SURPRISE_RATE,
    threshold: float = SURPRISE_RATE_THRESHOLD,
) -> torch.Tensor:
    """L_surprise = (observed_surprise_rate − target_rate)²

    预测曲线中"低于阈值"的 bin 比例视为惊喜频率, 拟合到目标 ~7%。
    用 sigmoid 软阈值保持可微。
    """
    soft_below = torch.sigmoid((threshold - curve_pred) * 10.0)  # (B, n_bins)
    observed = soft_below.mean()
    return (observed - target_rate) ** 2


def loss_breaking(
    curve_pred: torch.Tensor,
    n_bins: int = N_CURVE_BINS,
    r_max: float = R_MAX,
    r_low: float = BREAKING_R_LOW,
    r_high: float = BREAKING_R_HIGH,
) -> torch.Tensor:
    """L_breaking = ReLU(D̄[r∈[0.9, 1)] − D̄[r ≥ 1.0])²

    超越 PB 后难度必须 ≥ 接近 PB 时的难度 (否则就是"破 PB 反而变简单",违背业务)。
    """
    width = r_max / n_bins
    # bin 索引范围
    low_start = int(r_low / width)
    low_end = int(r_high / width)
    high_start = low_end  # = int(1.0 / width)

    if low_start >= curve_pred.size(1) or high_start >= curve_pred.size(1):
        return torch.tensor(0.0, device=curve_pred.device)

    pre = curve_pred[:, low_start:low_end].mean(dim=-1) if low_end > low_start else curve_pred[:, low_start]
    post = curve_pred[:, high_start:].mean(dim=-1)
    diff = pre - post  # 应 ≤ 0 (后段 ≥ 前段)
    return F.relu(diff).pow(2).mean()


def loss_smooth(curve_pred: torch.Tensor, theta_norm: torch.Tensor) -> torch.Tensor:
    """L_smooth = ‖∂D/∂θ‖²

    要求模型对 θ 的微小扰动产生平滑响应, 不应剧烈变化。
    用 autograd 求 d(mean(curve)) / d(theta) 然后求 squared norm。

    注: 要求 theta_norm.requires_grad == True 才能算梯度;
    在训练 loop 里需要 theta_norm = theta_norm.detach().requires_grad_(True)。
    """
    if not theta_norm.requires_grad:
        return torch.tensor(0.0, device=curve_pred.device)
    obj = curve_pred.mean(dim=-1).sum()
    grad = torch.autograd.grad(
        outputs=obj,
        inputs=theta_norm,
        create_graph=True,
        retain_graph=True,
        allow_unused=True,
    )[0]
    if grad is None:
        return torch.tensor(0.0, device=curve_pred.device)
    return grad.pow(2).mean()


def loss_aux(predictions: Dict[str, torch.Tensor], targets: Dict[str, torch.Tensor]) -> torch.Tensor:
    """辅助标签 loss (pb_broke / noMove / score / survival)。

    pb_broke: BCE
    noMove:   MSE (归一化到 [0, 1])
    score:    MSE on log_score
    survival: BCE (是否生存到预设长度,或 normalize)
    """
    total = torch.tensor(0.0, device=next(iter(predictions.values())).device)
    n = 0
    if "pb_broke" in targets and "pb_broke" in predictions:
        total = total + F.binary_cross_entropy(
            predictions["pb_broke"].clamp(1e-7, 1 - 1e-7), targets["pb_broke"].float()
        )
        n += 1
    if "noMove" in targets and "noMove" in predictions:
        total = total + F.mse_loss(predictions["noMove"], targets["noMove"].float())
        n += 1
    if "score" in targets and "score" in predictions:
        total = total + F.mse_loss(predictions["score"], targets["score"].float())
        n += 1
    if "survival" in targets and "survival" in predictions:
        total = total + F.binary_cross_entropy(
            predictions["survival"].clamp(1e-7, 1 - 1e-7), targets["survival"].float()
        )
        n += 1
    return total / max(1, n)


# ─────────── 综合 loss ───────────

@dataclass
class LossBreakdown:
    """单次 forward 的 loss 拆解,用于 logging 和 dashboard。"""
    total: torch.Tensor
    shape: torch.Tensor
    balance: torch.Tensor
    surprise: torch.Tensor
    breaking: torch.Tensor
    smooth: torch.Tensor
    aux: torch.Tensor

    def to_dict(self, keep_grad: bool = False) -> Dict[str, float]:
        def _to(v: torch.Tensor) -> float:
            return float(v.item()) if isinstance(v, torch.Tensor) else float(v)
        return {
            "total": _to(self.total),
            "shape": _to(self.shape),
            "balance": _to(self.balance),
            "surprise": _to(self.surprise),
            "breaking": _to(self.breaking),
            "smooth": _to(self.smooth),
            "aux": _to(self.aux),
        }


def compute_total_loss(
    predictions: Dict[str, torch.Tensor],
    targets: Dict[str, torch.Tensor],
    pb_bin_idx: torch.Tensor,
    theta_norm: Optional[torch.Tensor] = None,
    weights: Optional[LossWeights] = None,
) -> LossBreakdown:
    """计算综合 loss 并返回拆解。

    Args:
        predictions: model.forward() 的输出 dict (含 "curve", "pb_broke", ...)
        targets:     训练样本标签 dict (含 "curve", "pb_broke", ...)
        pb_bin_idx:  (B,) PB bin 索引, 用于 balance loss
        theta_norm:  (B, 14) θ 归一化 (需 requires_grad=True 才能算 smooth)
        weights:     LossWeights 实例
    """
    w = weights or LossWeights()
    device = predictions["curve"].device
    zero = torch.tensor(0.0, device=device)

    l_shape = loss_shape(predictions["curve"], targets["curve"])
    l_balance = loss_balance(predictions["curve"], pb_bin_idx)
    l_surprise = loss_surprise(predictions["curve"])
    l_breaking = loss_breaking(predictions["curve"])
    l_smooth = loss_smooth(predictions["curve"], theta_norm) if theta_norm is not None else zero
    l_aux = loss_aux(predictions, targets) if any(k in targets for k in ("pb_broke", "noMove", "score", "survival")) else zero

    total = (w.shape * l_shape
             + w.balance * l_balance
             + w.surprise * l_surprise
             + w.breaking * l_breaking
             + w.smooth * l_smooth
             + w.aux * l_aux)

    return LossBreakdown(
        total=total,
        shape=l_shape,
        balance=l_balance,
        surprise=l_surprise,
        breaking=l_breaking,
        smooth=l_smooth,
        aux=l_aux,
    )
