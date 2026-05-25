"""
7 项加权损失函数 — 把 OpenBlock 业务命题量化到训练目标。

  业务命题: "玩家应能接近 PB, 但难以超越; 偶尔可破; 破后持续加压"
  ↓ 量化拆解 ↓

L_total = α · L_shape           # MSE on d_curve, 主损失 (曲线整体形状)
        + β · L_balance         # PB bin 间 d_curve 均值的方差 (避免某段偏差大)
        + γ · L_surprise        # 惊喜频率拟合 (目标 ~ 7%)
        + δ · L_breaking        # 超越 PB 后单调加压 (ReLU hinge)
        + ε · L_smooth          # ∂D/∂θ 平滑正则
        + ζ · L_aux             # 辅助标签 (pb_broke / noMove / score / survival)
        + η · L_pb_distribution # 得分与 PB 关系 (v2.4 累积概率约束)
        + κ · L_anchor          # ⭐ v2.6: 关键 r 点 hinge — 强力打破"全集均值"陷阱

默认权重: α=1.5  β=0.15  γ=0.3  δ=0.5  ε=0.01  ζ=0.2  η=1.2  κ=2.0

v2.5 → v2.6 演进:
  job_6 训练 27 epoch 后 val_pb_distribution 完全不动 (0.1916 → 0.1916),
  预测 d_curve 仍水平于 0.6 → 模型陷入"预测全集均值"的稳定 minima。
  问题: L_pb_distribution 的 P_continue=(1-d)² 在 d≈0.6 时 ∂L/∂d 衰减剧烈,
        梯度信号被 L_balance / L_smooth 淹没。
  解法: 新增 L_anchor — 直接对关键 r 点施加上下界 hinge:
          r=0.30 时 D ≤ 0.35   (远 PB 必须易)
          r=1.00 时 D ≥ 0.70   (接近 PB 必须难)
          r=1.50 时 D ≥ 0.85   (超 PB 持续高难)
        ReLU hinge 在违规时 gradient 为常数, 不会衰减, 强力推模型放弃水平线。

v2.4 设计回顾:
  shape  = 逐 bin MSE 拟合
  pb_dist = 累积分布约束 (P_reach)
  anchor = 关键点 hinge 约束 (v2.6 新)
  三者互补且 gradient 衰减特性不同:
    shape gradient ~ 线性 (curve - target)
    pb_dist gradient 在 d 中段衰减 (sigmoid-like)
    anchor gradient 是 hard constant — 修正欠拟合最有效
"""
from __future__ import annotations
from dataclasses import dataclass, field
from typing import Dict, Optional, Sequence

import torch
import torch.nn.functional as F


@dataclass
class LossWeights:
    """v2.5 权重重新平衡 — 让模型真正学到 S 形而非"水平线":

    诊断 (v2.4 截图):
      job_5 预测 MAE=0.31 > 实测 MAE=0.28, 预测曲线水平于 0.6 → 严重欠拟合。
      根因: L_balance + L_smooth 联合压平预测; L_shape 权重不足以反推 S 形;
            L_pb_distribution 占总 loss 不足 5%。

    v2.5 调整 (按"业务约束 > 平滑正则"重新加权):
      α  shape          1.0 → 1.5  (主损失加权)
      β  balance        0.5 → 0.15 (松绑 — 不再过分压平)
      γ  surprise       0.3 不变
      δ  breaking       0.5 不变
      ε  smooth         0.05 → 0.01 (松绑 — 允许对 θ 敏感)
      ζ  aux            0.2 不变
      η  pb_distribution 0.6 → 1.2 (业务约束加权)
    """
    shape: float = 2.0           # α
    balance: float = 0.15        # β
    surprise: float = 0.3        # γ
    breaking: float = 0.5        # δ
    # v2.9.1: smooth 0.01 → 0.04 — 让 d_curve 对 θ 微小变化平滑响应, 减少锯齿
    smooth: float = 0.04         # ε
    aux: float = 0.2             # ζ
    pb_distribution: float = 0.0
    anchor: float = 3.0          # κ
    monotonic: float = 2.5       # μ  v2.9.1: 1.5 → 2.5
    target_fit: float = 1.0      # ν
    endpoint: float = 1.5        # ξ  v2.9.1 新: 锁定头尾 bin 防甩飞

    def to_dict(self) -> Dict[str, float]:
        return {
            "shape": self.shape, "balance": self.balance, "surprise": self.surprise,
            "breaking": self.breaking, "smooth": self.smooth, "aux": self.aux,
            "pb_distribution": self.pb_distribution, "anchor": self.anchor,
            "monotonic": self.monotonic, "target_fit": self.target_fit,
            "endpoint": self.endpoint,  # v2.9.1
        }


# ─────────── 业务参数 ───────────

TARGET_SURPRISE_RATE = 0.07            # 期望惊喜频率
N_CURVE_BINS = 20
R_MAX = 2.0                            # v2.3: 1.5 → 2.0 (target_curve.CURVE_R_MAX 对齐)
BREAKING_R_LOW = 0.9                   # "破 PB 前" 区间起点 (接近 PB 临门一脚)
BREAKING_R_HIGH = 1.0                  # 破 PB 临界 (r=1.0 = 玩家分数 = PB)
SURPRISE_RATE_THRESHOLD = 0.3          # d_step < 该值视为"惊喜步" (轻松一步)

# v2.4: 得分-PB 业务期望分布 — 玩家到达 r=X 的累积概率
# 设计依据: OpenBlock 玩家行为分析 + 类似休闲游戏的"甜区"研究 (10-25% 破 PB 率)
TARGET_REACH_PROBABILITIES: Dict[float, float] = {
    0.50:  0.85,    # 85% 玩家至少到 1/2 PB (新手关都过得了)
    0.80:  0.55,    # 55% 玩家能到 80% PB
    0.95:  0.30,    # 30% 玩家接近 PB (有挑战感)
    1.00:  0.18,    # ⭐ 18% 玩家破 PB (核心业务目标)
    1.20:  0.05,    # 5% 玩家超 PB 20% (高手区)
    1.50:  0.01,    # 1% 玩家超 PB 50% (神级)
}
# v2.8.1: P_continue 公式从 (1-d)^2 改为 exp(-d * scale) (log-domain)
#         旧公式当 d ≥ 0.5 时 P_continue^10 ≈ 0 → P_reach 数值饱和到 ~ 1e-9
#         → loss=(1e-9 - target)² ≈ target² 是个常数, gradient 完全消失
#         新公式: P_continue = exp(-d * scale), 在 log 域累加, 数值不饱和
#         scale=1.6 让 d=0.5 时 P_cont = exp(-0.8) ≈ 0.45, 累积 10 个 bin → 0.45^10 ≈ 3e-4
#         gradient 在所有 d 区域都有效
PB_DIST_SCALE = 1.6
PB_DIST_GAMMA = 2.0  # 旧版兼容 (loss_pb_distribution 仍支持但不推荐)

# v2.6: 关键 r 锚点 — 强力 hinge 约束让模型放弃"全集均值"水平线解
# 设计依据: 关键 r 点的 D 必须落在业务可接受区间, 否则 ReLU 惩罚
# 区别于 L_shape 的"逐 bin MSE", anchor 是"业务关键点的 hard hinge"
#
# v2.7 更新: 增加中段 r 点 (0.5, 1.2) 给模型更连续的 gradient 信号, 避免锯齿;
#           r=1.0 lower 0.70 → 0.65 (稍微让步, 适配 bot 数据 baseline)
ANCHOR_CONSTRAINTS = [
    # (r, "upper" / "lower", target_value)
    (0.20, "upper", 0.32),   # r=0.20: 极远 PB, D 必须 ≤ 0.32
    (0.30, "upper", 0.38),   # r=0.30: 远 PB, D 必须 ≤ 0.38
    (0.50, "upper", 0.48),   # r=0.50: 半程, D 必须 ≤ 0.48 (中段过渡)
    (0.95, "lower", 0.55),   # r=0.95: 临近 PB, D 必须 ≥ 0.55 (有挑战)
    (1.00, "lower", 0.65),   # r=1.00: 破 PB 临界, D 必须 ≥ 0.65 (适配数据 baseline)
    (1.20, "lower", 0.75),   # r=1.20: 超 PB 20%, D 必须 ≥ 0.75 (持续加压)
    (1.50, "lower", 0.85),   # r=1.50: 超 PB 50%, D 必须 ≥ 0.85
]


# ─────────── 单项 loss ───────────

# v2.7: bin 权重 — 关键 r 区间 (临近 PB / 超 PB) 加权, 强制模型精确拟合 S 形拐点
# r_max=2.0, n_bins=20 → bin_width=0.1
# bin 8 (r=0.85): brake 段中部     → 3x
# bin 9 (r=0.95): 临近 PB ⭐        → 4x
# bin 10 (r=1.05): 破 PB 临界 ⭐    → 4x
# bin 11 (r=1.15): overshoot 初段   → 3x
# bin 15 (r=1.55): 高超 PB         → 2x
# 其他 bin                          → 1x
_SHAPE_BIN_WEIGHTS_DEFAULT: Optional[torch.Tensor] = None  # 懒初始化, 与 device 解耦

def _get_shape_bin_weights(n_bins: int, device) -> torch.Tensor:
    """返回 weighted MSE 用的 bin 权重 (1D tensor, len=n_bins)。"""
    w = torch.ones(n_bins, device=device)
    overrides = {7: 2.0, 8: 3.0, 9: 4.0, 10: 4.0, 11: 3.0, 12: 2.5, 15: 2.0}
    for i, val in overrides.items():
        if i < n_bins:
            w[i] = val
    return w


def loss_shape(curve_pred: torch.Tensor, curve_target: torch.Tensor) -> torch.Tensor:
    """v2.7 — Weighted MSE: 关键 r 区间 (临近 PB / 超 PB) 加权拟合。

    旧版 (v2.6 及之前): 普通 MSE — 每个 bin 等权, 模型可以 "牺牲" 拐点
                       精度换平坦区域的低误差, 学到水平线均值解。
    新版 (v2.7): 拐点区域 (bin 8-12, r ∈ [0.85, 1.25]) 权重 3-4x,
                强制模型精确拟合 S 形拐点。

    Args:
        curve_pred:   (B, n_bins) ∈ [0, 1]
        curve_target: (B, n_bins) ∈ [0, 1]
    Returns:
        scalar tensor (weighted MSE, 归一化后与普通 MSE 同量级)
    """
    if curve_pred.size(1) == 0:
        return torch.tensor(0.0, device=curve_pred.device)
    weights = _get_shape_bin_weights(curve_pred.size(1), curve_pred.device)   # (n_bins,)
    sq_err = (curve_pred - curve_target) ** 2                                  # (B, n_bins)
    weighted = sq_err * weights[None, :]                                       # (B, n_bins)
    # 归一化: 用 weights.sum() 而不是 numel(), 保持与普通 MSE 同量级
    return weighted.sum() / (curve_pred.size(0) * weights.sum())


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


def loss_pb_distribution(
    curve_pred: torch.Tensor,
    r_max: float = R_MAX,
    n_bins: int = N_CURVE_BINS,
    target_dict: Optional[Dict[float, float]] = None,
    scale: float = PB_DIST_SCALE,
) -> torch.Tensor:
    """v2.8.1 重写 — 得分与 PB 关系的分布约束 (log-domain, 不饱和)。

    业务命题:
      OpenBlock 核心 = "接近 PB 加压、破 PB 持续加压"。
      → 玩家"到达 r = score/PB"的累积概率应满足业务期望分布:
         P(reach r=0.5)  ≈ 85%   (新手关都过得了)
         P(reach r=0.95) ≈ 30%   (有挑战感)
         P(reach r=1.0)  ≈ 18%   ⭐ 18% 玩家破 PB (核心目标)
         P(reach r=1.5)  ≈ 1%    (神级)

    v2.8.1 数学修复:
      旧公式 P_cont=(1-d)^2 在 d≥0.5 区域累积乘积迅速饱和到 ~ 1e-9,
      loss=(1e-9 - target)² 退化为常数 ≈ target², gradient 消失。
      → 实测 job_10 训练 27 epoch, val_pb_distribution 从 0.1916 完全不动。

      新公式 (log-domain):
        log_p_cont(d) = -d * scale         # scale=1.6
        log_p_reach   = cumsum(log_p_cont)
        p_reach       = exp(log_p_reach)
      关键性质:
        - 数值不饱和: 即使 d=1.0, 累积 20 个 bin → log_p_reach = -32, exp ≈ 1e-14 但 gradient 仍清晰
        - 单调性保留: d 越大, log_p_cont 越负, p_reach 越小
        - gradient 对每个 d_i 是 -scale * p_reach * (chain rule), 永不消失

    Args:
        curve_pred: (B, n_bins) ∈ [0, 1]
        target_dict: 业务期望 {r: target_P_reach}; 默认 TARGET_REACH_PROBABILITIES
        scale:      log_p_cont 的衰减强度 (1.6 = 中等, 让 d=0.5 时 P_cont≈0.45)
    Returns:
        scalar tensor (MSE on P_reach vs target)
    """
    if curve_pred.size(0) == 0 or curve_pred.size(1) == 0:
        return torch.tensor(0.0, device=curve_pred.device)

    targets = target_dict or TARGET_REACH_PROBABILITIES
    # v2.8.1: log-domain 公式, 避免数值饱和
    clamped = curve_pred.clamp(1e-4, 1.0 - 1e-4)
    log_p_cont = -clamped * scale                                    # (B, n_bins)
    log_p_reach = torch.cumsum(log_p_cont, dim=1)                    # (B, n_bins)
    p_reach = torch.exp(log_p_reach)                                 # (B, n_bins) ∈ (0, 1]

    bin_width = r_max / n_bins
    losses = []
    for r_val, target_p in targets.items():
        bin_idx = max(0, min(n_bins - 1, int(r_val / bin_width)))
        observed_p = p_reach[:, bin_idx].mean()
        losses.append((observed_p - target_p) ** 2)
    if not losses:
        return torch.tensor(0.0, device=curve_pred.device)
    return torch.stack(losses).mean()


def loss_anchor(
    curve_pred: torch.Tensor,
    r_max: float = R_MAX,
    n_bins: int = N_CURVE_BINS,
    constraints: Optional[list] = None,
) -> torch.Tensor:
    """v2.6 — 关键 r 锚点 hinge 约束。

    业务命题最直白翻译: "r=0 时易、r=1 时难、r=1.5 时非常难"。
    用 ReLU hinge 直接对关键 r 点的 D 施加上下界约束 — gradient 不会像
    L_pb_distribution 那样在 d 中段衰减, 是修正欠拟合最有效的信号。

    constraints: [(r, kind, target)] kind ∈ {"upper", "lower"}
      "upper": D 必须 ≤ target, 否则惩罚 (D - target)²
      "lower": D 必须 ≥ target, 否则惩罚 (target - D)²

    默认约束 (ANCHOR_CONSTRAINTS):
      r=0.30 upper 0.35    远 PB → D 不超 0.35 (轻松)
      r=0.95 lower 0.55    临近 PB → D 不低 0.55 (有挑战)
      r=1.00 lower 0.70    破 PB → D 不低 0.70 (高难)
      r=1.50 lower 0.85    超 PB → D 不低 0.85 (持续高难)

    与 L_shape / L_pb_distribution 的分工:
      L_shape:   逐 bin MSE — gradient 线性, 在均值附近可"作弊"
      L_pb_dist: 累积分布   — gradient 在 d 中段衰减
      L_anchor:  关键点 hinge — gradient 在违规时是 constant, 强力修正
    """
    if curve_pred.size(0) == 0:
        return torch.tensor(0.0, device=curve_pred.device)

    cs = constraints if constraints is not None else ANCHOR_CONSTRAINTS
    if not cs:
        return torch.tensor(0.0, device=curve_pred.device)

    bin_width = r_max / n_bins
    losses = []
    for r_val, kind, target in cs:
        bin_idx = max(0, min(n_bins - 1, int(r_val / bin_width)))
        # v2.7 修复 bug: per-sample 计算 hinge, 然后 mean over batch
        # 旧版 (v2.6) 先 batch-mean 再 hinge — 当 batch 内一半样本超界另一半欠界时
        # 平均后可能"刚好满足", 完全丢失 gradient 信号
        d_at_r = curve_pred[:, bin_idx]                # (B,) per-sample
        if kind == "upper":
            violation = F.relu(d_at_r - target)        # (B,) per-sample violation
        elif kind == "lower":
            violation = F.relu(target - d_at_r)        # (B,) per-sample violation
        else:
            continue
        losses.append(violation.pow(2).mean())          # mean over batch
    if not losses:
        return torch.tensor(0.0, device=curve_pred.device)
    return torch.stack(losses).mean()


def p_reach_metrics(
    curve_pred: torch.Tensor,
    r_max: float = R_MAX,
    n_bins: int = N_CURVE_BINS,
    scale: float = PB_DIST_SCALE,
) -> Dict[str, float]:
    """v2.8.1 业务级指标 — 模型预测的"玩家到达 r 累积概率"分布 (log-domain)。

    与 L_pb_distribution 同源数学 (log-domain, 不饱和), 但不计入 loss:
      reach_50    : P(玩家到达 r=0.5)   — 期望 ~ 85%
      reach_80    : P(玩家到达 r=0.8)   — 期望 ~ 55%
      reach_95    : P(玩家到达 r=0.95)  — 期望 ~ 30%
      reach_100   : P(玩家到达 r=1.0)   — ⭐ 期望 ~ 18% (破 PB 率甜区)
      reach_120   : P(玩家到达 r=1.2)   — 期望 ~ 5%
      reach_150   : P(玩家到达 r=1.5)   — 期望 ~ 1%
    """
    if curve_pred.size(0) == 0:
        return {}
    with torch.no_grad():
        clamped = curve_pred.clamp(1e-4, 1.0 - 1e-4)
        log_p_cont = -clamped * scale
        log_p_reach = torch.cumsum(log_p_cont, dim=1)
        p_reach = torch.exp(log_p_reach)
        bin_width = r_max / n_bins
        out = {}
        for r_val, key in [(0.50, "reach_50"), (0.80, "reach_80"), (0.95, "reach_95"),
                           (1.00, "reach_100"), (1.20, "reach_120"), (1.50, "reach_150")]:
            bin_idx = max(0, min(n_bins - 1, int(r_val / bin_width)))
            out[key] = float(p_reach[:, bin_idx].mean().item())
        return out


def loss_monotonic(curve_pred: torch.Tensor, tol: float = 0.02) -> torch.Tensor:
    """v2.9.1 — 软单调约束: d_curve[i+1] ≥ d_curve[i] - tol。

    业务依据: "接近 PB 时难度递增, 超 PB 后持续高位" — d_curve 应该整体非降。
    v2.9 → v2.9.1: tol 默认 0.05 → 0.02 (job_13 实测 0.05 容忍度过大,
    模型仍能产生 0.05 内的锯齿; 收紧到 0.02 让单调更严格)。

    Args:
        curve_pred: (B, n_bins) ∈ [0, 1]
        tol: 容差 (默认 0.05) — 反向降幅小于该值不惩罚
    Returns:
        scalar tensor
    """
    if curve_pred.size(0) == 0 or curve_pred.size(1) < 2:
        return torch.tensor(0.0, device=curve_pred.device)
    # diff[i] = d[i] - d[i+1]; 期望 ≤ 0 (即 d[i+1] ≥ d[i])
    diff = curve_pred[:, :-1] - curve_pred[:, 1:]   # (B, n_bins - 1)
    # 超过容差的违规才惩罚
    violation = F.relu(diff - tol)                   # (B, n_bins - 1)
    return violation.pow(2).mean()


# v2.9: 校准 target curve (用于 loss_target_fit) — 与 target_curve.target_curve_calibrated 同步
# 缓存避免每次 forward 重算 (按 device 缓存)
_CALIBRATED_TARGET_CACHE: Dict[str, torch.Tensor] = {}


def _get_calibrated_target(n_bins: int, device) -> torch.Tensor:
    """从 target_curve.target_curve_calibrated_vector() 取校准 d_curve, 缓存。"""
    key = f"{n_bins}_{device}"
    if key not in _CALIBRATED_TARGET_CACHE:
        from .target_curve import target_curve_calibrated_vector
        vec = target_curve_calibrated_vector(n_bins=n_bins)
        _CALIBRATED_TARGET_CACHE[key] = torch.tensor(vec, dtype=torch.float32, device=device)
    return _CALIBRATED_TARGET_CACHE[key]


def loss_endpoint(
    curve_pred: torch.Tensor,
    head_target: float = 0.42,   # D_BASE_CAL — r ≈ 0 时的 D
    tail_target: float = 0.85,   # D_CAP_CAL  — r ≈ R_MAX 时的 D
    head_tol: float = 0.10,      # 允许 ±0.10 浮动
    tail_tol: float = 0.10,
    n_head_bins: int = 2,
    n_tail_bins: int = 2,
) -> torch.Tensor:
    """v2.9.1 — 端点锚定: 防止 d_curve 头尾甩飞导致锯齿。

    问题:
      job_13 截图中 r=0.25 处预测 D≈0.30 (远低于校准 target 0.46),
      r=1.55 处尖刺到 0.78 (远高于 r=1.45 邻居 0.65)。
      这是 anchor 在单点强 hinge + 邻居无约束的 side effect。

    解法:
      对最前 n_head_bins 个 bin (r ∈ [0, 0.2]) 整体均值钉在 head_target ± head_tol;
      对最后 n_tail_bins 个 bin (r ∈ [1.8, 2.0]) 整体均值钉在 tail_target ± tail_tol。
      用 hinge 不硬等于, 给模型自由度。
    """
    if curve_pred.size(0) == 0 or curve_pred.size(1) < n_head_bins + n_tail_bins:
        return torch.tensor(0.0, device=curve_pred.device)
    head_mean = curve_pred[:, :n_head_bins].mean(dim=-1)         # (B,)
    tail_mean = curve_pred[:, -n_tail_bins:].mean(dim=-1)        # (B,)
    head_viol = F.relu(torch.abs(head_mean - head_target) - head_tol)
    tail_viol = F.relu(torch.abs(tail_mean - tail_target) - tail_tol)
    return (head_viol.pow(2).mean() + tail_viol.pow(2).mean()) / 2.0


def loss_target_fit(curve_pred: torch.Tensor) -> torch.Tensor:
    """v2.9 — 拟合校准 target curve (温和 S 形锚)。

    与 loss_shape 互补:
      L_shape:      跟 sample 的实测 d_curve 做 MSE (跟随数据)
      L_target_fit: 跟固定的 calibrated target 做 MSE (引导 S 形)
    两项加权后, 模型在"实测分布"与"业务 S 形"之间妥协, 落在中间。

    Args:
        curve_pred: (B, n_bins) ∈ [0, 1]
    Returns:
        scalar tensor
    """
    if curve_pred.size(0) == 0 or curve_pred.size(1) == 0:
        return torch.tensor(0.0, device=curve_pred.device)
    target = _get_calibrated_target(curve_pred.size(1), curve_pred.device)   # (n_bins,)
    # broadcast 比较: (B, n_bins) vs (1, n_bins)
    sq_err = (curve_pred - target.unsqueeze(0)) ** 2
    return sq_err.mean()


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
    pb_distribution: torch.Tensor
    anchor: torch.Tensor          # v2.6
    monotonic: torch.Tensor       # v2.9
    target_fit: torch.Tensor      # v2.9
    endpoint: torch.Tensor        # v2.9.1

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
            "pb_distribution": _to(self.pb_distribution),
            "anchor": _to(self.anchor),
            "monotonic": _to(self.monotonic),
            "target_fit": _to(self.target_fit),
            "endpoint": _to(self.endpoint),
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
        theta_norm:  (B, 9) θ 归一化 (需 requires_grad=True 才能算 smooth; v2.2=9 维)
        weights:     LossWeights 实例 (含 v2.4 新加的 pb_distribution 权重)
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
    l_pb_dist = loss_pb_distribution(predictions["curve"])
    l_anchor = loss_anchor(predictions["curve"])
    # v2.9 / v2.9.1 新加
    l_monotonic = loss_monotonic(predictions["curve"])
    l_target_fit = loss_target_fit(predictions["curve"])
    l_endpoint = loss_endpoint(predictions["curve"])

    total = (w.shape * l_shape
             + w.balance * l_balance
             + w.surprise * l_surprise
             + w.breaking * l_breaking
             + w.smooth * l_smooth
             + w.aux * l_aux
             + w.pb_distribution * l_pb_dist
             + w.anchor * l_anchor
             + w.monotonic * l_monotonic
             + w.target_fit * l_target_fit
             + w.endpoint * l_endpoint)

    return LossBreakdown(
        total=total,
        shape=l_shape,
        balance=l_balance,
        surprise=l_surprise,
        breaking=l_breaking,
        smooth=l_smooth,
        aux=l_aux,
        pb_distribution=l_pb_dist,
        anchor=l_anchor,
        monotonic=l_monotonic,
        target_fit=l_target_fit,
        endpoint=l_endpoint,
    )
