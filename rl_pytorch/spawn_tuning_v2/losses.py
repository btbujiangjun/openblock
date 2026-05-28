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
    # v3.0.13: 大幅平衡 — 朝 ideal 总合力 34→10, 朝 sample 力 1→5, 比例 34:1 → 2:1
    #   v3.0.12 (34:1) 让 model 学到"输出 ≈ ideal_S 的近似常数函数", 无视 ctx/θ 差异.
    #   后果: predict-curve 永远贴 ideal, 寻参 θ* 信号弱, 实测撬动~0%.
    #
    # v3.0.13 调整: 让 sample 真正参与训练, model 学到 (ctx, θ) → real_curve 的映射:
    #   shape:       1.0 → 5.0  (sample 主导)
    #   target_fit:  2.5 → 0.5  (ideal 仅作弱锚)
    #   anchor:     15.0 → 3.0  (仅保 0.05/0.15/1.50 等少数关键 r 点)
    #   endpoint:   12.0 → 2.0  (端点不再死锁, 只是 hint)
    #   monotonic / deploy / 其他 不变
    # 预期收益:
    #   model 预测 vs ideal MAE 从 0.008 升到 0.05-0.10 (不再"完美")
    #   model 预测 vs 实测 MAE 从 0.25 降到 0.05-0.10 (真实拟合)
    #   寻参 θ* 信号从弱变强, 实测撬动 +10-20%
    # v3.0.19: "绿点线段化"诊断 — 同 ctx 不同 θ 的 model 输出几乎相同 ⇒ θ 输入被忽略
    #   根因: v3.0.13 之后 ideal 拉力 (target_fit+anchor+endpoint+deploy=7.5) 仍 ≥ shape 5,
    #         model 学到 "无视 θ, 输出 ≈ ctx-条件 ideal 近似" 的近似常数函数.
    #   v3.0.19 调整:
    #     target_fit:   0.5 → 0.0  (ideal 移除, 完全交给 anchor+endpoint 弱约束)
    #     anchor:       3.0 → 1.0  (仅保业务红线)
    #     endpoint:     2.0 → 1.0  (端点 hint)
    #     monotonic:    2.5 → 1.0  (允许 plateau)
    #     deploy:       2.0 → 1.0  (寻参信号保留但弱)
    #     + theta_diversity 1.0: 强制 same-ctx batch 内 model 输出有最低方差, 防常数化
    #   合力: ideal 方向 ~3, sample 方向 5, diversity 1, 比例 3:5:1 ⇒ model 必须真的用 θ.
    shape: float = 5.0           # α  v3.0.13: 1.0 → 5.0 (sample 主导)
    balance: float = 0.15        # β
    surprise: float = 0.3        # γ
    breaking: float = 0.5        # δ
    smooth: float = 0.04         # ε
    aux: float = 0.2             # ζ
    pb_distribution: float = 0.0
    anchor: float = 1.0          # κ  v3.0.19: 3.0 → 1.0
    monotonic: float = 1.0       # μ  v3.0.19: 2.5 → 1.0
    target_fit: float = 0.0      # ν  v3.0.19: 0.5 → 0.0 (移除 ideal 拉力)
    endpoint: float = 1.0        # ξ  v3.0.19: 2.0 → 1.0
    r_value: float = 0.5
    # v3.0.11 (G6 联合寻参): trainable theta_optim 表的部署 loss
    deploy: float = 1.0          # v3.0.19: 2.0 → 1.0
    # v3.0.19 新增: same-ctx batch 内 model 输出方差最低惩罚, 防"绿点线段化"
    theta_diversity: float = 1.0

    def to_dict(self) -> Dict[str, float]:
        return {
            "shape": self.shape, "balance": self.balance, "surprise": self.surprise,
            "breaking": self.breaking, "smooth": self.smooth, "aux": self.aux,
            "pb_distribution": self.pb_distribution, "anchor": self.anchor,
            "monotonic": self.monotonic, "target_fit": self.target_fit,
            "endpoint": self.endpoint, "r_value": self.r_value, "deploy": self.deploy,
            "theta_diversity": self.theta_diversity,
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
    # v3.0.3: 22 个 r 点, 中段加 lower 形成双向夹紧, 高 r 收紧到 ideal-0.02
    # ─── 低 r 双向 (玩家初期, 业务关键) ───
    (0.05, "lower", 0.18), (0.05, "upper", 0.24),     # ideal 0.21
    (0.15, "lower", 0.20), (0.15, "upper", 0.28),     # ideal 0.23
    # ─── 远 PB 上界 (单向, 防止 model 过高) ───
    (0.20, "upper", 0.28),                            # ideal 0.24
    (0.30, "upper", 0.32),                            # ideal 0.27
    # ─── 中段双向 (v3.0.3 新增 lower, 在 ideal ± 0.03 范围夹紧) ───
    (0.40, "lower", 0.25), (0.40, "upper", 0.31),    # ideal 0.28
    (0.50, "lower", 0.27), (0.50, "upper", 0.33),    # ideal 0.30
    (0.60, "lower", 0.37), (0.60, "upper", 0.43),    # ideal 0.40
    (0.70, "lower", 0.47), (0.70, "upper", 0.53),    # ideal 0.50
    # ─── 临近 PB ───
    (0.95, "lower", 0.55),
    # ─── 破/超 PB 下界 (v3.0.3 全部收紧到 ideal - 0.02) ───
    (1.00, "lower", 0.78),                            # 老 0.70 → 0.78, ideal 0.80
    (1.20, "lower", 0.92),                            # 老 0.85 → 0.92, ideal 0.94
    (1.50, "lower", 0.97),                            # 老 0.92 → 0.97, ideal 0.99
    (1.80, "lower", 0.98),                            # 老 0.96 → 0.98, ideal 1.00
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
    """返回 weighted MSE 用的 bin 权重 (1D tensor, len=n_bins).

    v3.0.1: shape 在低 r 段权重削弱 (让 anchor + endpoint 主导拉向 ideal),
    sample 在低 r 平均 ~0.55 而 ideal 在 0.20-0.30, shape 加权拉 sample 反而把 model 推高.
    保留拐点段加权 (S 形结构精度).

      - 低 r 段 (bin 0-3): 权重 0.5 (削弱, 让 anchor 主导)
      - 中段 (bin 4-6, 13-14, 16-19): 默认 1.0
      - 拐点段 (bin 7-12): 权重 2.0-4.0 (S 形拐点精度)
      - 高超 PB (bin 15): 1.5
    """
    w = torch.ones(n_bins, device=device)
    overrides = {
        # v3.0.1: 低 r 段削弱 shape (让 anchor + endpoint + target_fit 拉向 ideal)
        0: 0.5, 1: 0.5, 2: 0.7, 3: 0.7,
        # 拐点 (S 形精度)
        7: 2.0, 8: 3.0, 9: 4.0, 10: 4.0, 11: 3.0, 12: 2.0,
        # 高超 PB
        15: 1.5,
    }
    for i, val in overrides.items():
        if i < n_bins:
            w[i] = val
    return w


def loss_shape(
    curve_pred: torch.Tensor,
    curve_target: torch.Tensor,
    bin_counts: torch.Tensor | None = None,
    prior_strength: float = 3.0,
) -> torch.Tensor:
    """v2.7 / v2.10.32 (P0.2) — Weighted MSE: 拐点区加权 + 真实观察 confidence 加权。

    v2.7: 拐点区域 (bin 8-12) 权重 3-4x。
    v2.10.32 (P0.2): 进一步乘 confidence = n_obs / (n_obs + prior_strength)
      让 model 不学贝叶斯先验填充的 bin (这些 bin curve_target 来自 _pb_aware_d_pb_base
      而非真实样本均值, 学了等于复刻 prior, 阻碍 model 在该 bin 学到真实信号).
      当 bin_counts=None 或全 0 时退化为 v2.7 行为 (老样本兼容).

    Args:
        curve_pred:    (B, n_bins) ∈ [0, 1]
        curve_target:  (B, n_bins) ∈ [0, 1]
        bin_counts:    (B, n_bins) — 该 sample 每个 bin 的真实观察样本数
                       0 表示完全靠先验; >=PRIOR_STRENGTH 表示主要靠观察
        prior_strength: 跟 sampler 的 PB_AWARE_PRIOR_STRENGTH 对应 (默认 3)
    """
    if curve_pred.size(1) == 0:
        return torch.tensor(0.0, device=curve_pred.device)
    weights = _get_shape_bin_weights(curve_pred.size(1), curve_pred.device)   # (n_bins,)
    sq_err = (curve_pred - curve_target) ** 2                                  # (B, n_bins)
    weighted = sq_err * weights[None, :]                                       # (B, n_bins)
    # v2.10.32 (P0.2): confidence 加权
    if bin_counts is not None:
        # confidence = n / (n + prior_strength) — 同 sampler 公式
        conf = bin_counts / (bin_counts + prior_strength + 1e-6)               # (B, n_bins) ∈ [0, 1)
        # 退化保护: 若整 batch 都是老样本 (bin_counts 全 0), conf 全 0 会让 loss=0
        # 此时用全 1 (跟 v2.7 行为一致)
        if conf.sum() < 1e-6:
            return weighted.sum() / (curve_pred.size(0) * weights.sum())
        weighted = weighted * conf                                              # (B, n_bins)
        # 归一化: 用 weighted_sum / weight_sum (含 conf) 才同量级
        denom = (weights[None, :] * conf).sum() + 1e-6
        return weighted.sum() / denom
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
        bin_idx = max(0, min(n_bins - 1, int(r_val / bin_width + 1e-9)))
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
        bin_idx = max(0, min(n_bins - 1, int(r_val / bin_width + 1e-9)))
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
            bin_idx = max(0, min(n_bins - 1, int(r_val / bin_width + 1e-9)))
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


# v3.0.4: ideal target curve 缓存 (按 device 缓存, 避免每次 forward 重算)
_IDEAL_TARGET_CACHE: Dict[str, torch.Tensor] = {}


def _get_ideal_target(n_bins: int, device) -> torch.Tensor:
    """v3.0.4: 唯一 target — ideal target_S_curve 向量 (业务期望). loss_target_fit 用它."""
    key = f"{n_bins}_{device}"
    if key not in _IDEAL_TARGET_CACHE:
        from .target_curve import target_curve_vector
        vec = target_curve_vector(n_bins=n_bins)
        _IDEAL_TARGET_CACHE[key] = torch.tensor(vec, dtype=torch.float32, device=device)
    return _IDEAL_TARGET_CACHE[key]


def loss_endpoint(
    curve_pred: torch.Tensor,
    # v3.0.2: tol 0.025 + weight 12.0 — 端点死锁在 ideal ±0.025
    head_target: float = 0.20,
    tail_target: float = 1.00,
    head_tol: float = 0.025,
    tail_tol: float = 0.025,
    n_head_bins: int = 2,
    n_tail_bins: int = 2,
) -> torch.Tensor:
    """v2.9.1 / v2.10.39 — 端点锚定到 ideal target.

    问题:
      job_13 截图中 r=0.25 处预测 D≈0.30 (远低于校准 target 0.46),
      r=1.55 处尖刺到 0.78 (远高于 r=1.45 邻居 0.65)。
    解法:
      最前 2 bin 均值钉到 head_target ± head_tol;
      最后 2 bin 均值钉到 tail_target ± tail_tol。
      v2.10.39: 锚到 ideal (0.20, 1.00) 而非 calibrated (0.30, 0.92), 拉宽跨度。
    """
    if curve_pred.size(0) == 0 or curve_pred.size(1) < n_head_bins + n_tail_bins:
        return torch.tensor(0.0, device=curve_pred.device)
    head_mean = curve_pred[:, :n_head_bins].mean(dim=-1)         # (B,)
    tail_mean = curve_pred[:, -n_tail_bins:].mean(dim=-1)        # (B,)
    head_viol = F.relu(torch.abs(head_mean - head_target) - head_tol)
    tail_viol = F.relu(torch.abs(tail_mean - tail_target) - tail_tol)
    return (head_viol.pow(2).mean() + tail_viol.pow(2).mean()) / 2.0


def loss_r_value(r_pred: torch.Tensor, r_target: torch.Tensor) -> torch.Tensor:
    """v2.10.32 (P2.2) — multi-task r_value MSE.

    让 model 显式学到"该 ctx 下 bot 实际能触达的 r = score/PB"。
    用途:
      - 推理时若 user 选了 r > r_pred 太多, 说明该区域是 prior 主导, 不可信
      - 训练时辅助 curve head 的学习, 借 ctx → bot 能力 信号
    """
    if r_pred.size(0) == 0:
        return torch.tensor(0.0, device=r_pred.device)
    # 用 smooth_l1 (huber) 而非 MSE, r 可能是离群值 (random bot 偶尔超 PB) 鲁棒
    return F.smooth_l1_loss(r_pred, r_target)


def loss_target_fit(curve_pred: torch.Tensor) -> torch.Tensor:
    """v3.0.4 — 拟合 ★ ideal target_S_curve (业务 S 形, 跨度 0.80).

    与 loss_shape 互补:
      L_shape:      跟 sample 的实测 d_curve 做 MSE (跟随真实算法)
      L_target_fit: 跟固定的 ideal target 做 MSE (引导 S 形, ★ 主导拉力)
    """
    if curve_pred.size(0) == 0 or curve_pred.size(1) == 0:
        return torch.tensor(0.0, device=curve_pred.device)
    target = _get_ideal_target(curve_pred.size(1), curve_pred.device)   # ★ ideal (跨度 0.80)
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
    r_value: torch.Tensor         # v2.10.32 (P2.2)
    deploy: torch.Tensor          # v3.0.11 (G6 联合寻参)
    theta_diversity: torch.Tensor # v3.0.19 (same-ctx 方差最低惩罚)

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
            "r_value": _to(self.r_value),
            "deploy": _to(self.deploy),
            "theta_diversity": _to(self.theta_diversity),
        }


def loss_theta_diversity(
    model_curves: torch.Tensor,
    ctx_ids: torch.Tensor,
    target_var: float = 0.005,
) -> torch.Tensor:
    """v3.0.19: 同 ctx 不同 θ 的 model 输出方差必须 ≥ target_var, 防止"绿点线段化".

    问题: 同一 ctx 下 batch 内有多条 sample (不同 θ), 但 model.forward(ctx, θ) 输出几乎相同
        ⇒ θ 输入被忽略 ⇒ 寻参 θ* 无意义 ⇒ 部署不撬动启发式行为
    解药: 显式惩罚 "同 ctx 同 batch 内 model 输出方差 < target_var" 的情况
        — 不限制方差上限 (鼓励 model 探索 θ 多样性)
        — 只在 var 太小时反向梯度, 推 model 用 θ 区分输出

    Args:
        model_curves: (B, n_bins) batch model.forward 输出
        ctx_ids:      (B,) 每条 sample 的 ctx hash (相同 ctx 同 id)
        target_var:   期望最小方差 (across same-ctx samples per bin), 0.005 → 平均跨度 ~0.07

    Returns: scalar loss
        same-ctx-group 内 ReLU(target_var - actual_var)^2, 跨 group 平均
    """
    if model_curves.size(0) == 0 or ctx_ids.size(0) != model_curves.size(0):
        return torch.tensor(0.0, device=model_curves.device)
    # batch 内每个 ctx group
    unique_ids, counts = torch.unique(ctx_ids, return_counts=True)
    mask_multi = counts >= 2
    if not mask_multi.any():
        return torch.tensor(0.0, device=model_curves.device)

    losses = []
    for cid in unique_ids[mask_multi]:
        rows_mask = (ctx_ids == cid)
        same_ctx_curves = model_curves[rows_mask]   # (k, n_bins), k ≥ 2
        # 每 bin 的方差 (across k samples)
        var_per_bin = same_ctx_curves.var(dim=0, unbiased=False)   # (n_bins,)
        mean_var = var_per_bin.mean()
        # 只惩罚太小 (常数化), 不限制太大
        violation = F.relu(target_var - mean_var)
        losses.append(violation.pow(2))
    return torch.stack(losses).mean()


def loss_deploy(
    model: "nn.Module",
    deploy_ctx_indices: Optional[Dict[str, torch.Tensor]] = None,
    target_ideal: Optional[torch.Tensor] = None,
) -> torch.Tensor:
    """v3.0.11 (G6 联合寻参): trainable theta_optim 表的 ideal MSE loss.

    每个 batch step 末尾追加: 用 model.theta_optim() 对所有 deploy ctx forward, 算跟 ideal_S 的 MSE.
    backward 同时更新 model 权重和 theta_optim_raw, 训练结束 theta_optim 即为 best θ*.

    Args:
        model: 已实现 .theta_optim() 方法的 SpawnParamTuner (Resnet/Transformer 都行)
        deploy_ctx_indices: 预计算的 (N_CTX, ...) tensor dict, 含 difficulty_idx/generator_idx/bot_idx/pb_bin_idx/lifecycle_idx/log_pb
        target_ideal: (n_bins,) ideal target_S_curve tensor

    Returns: scalar loss
    """
    if deploy_ctx_indices is None or target_ideal is None:
        return torch.tensor(0.0)
    if not hasattr(model, "theta_optim"):
        return torch.tensor(0.0, device=target_ideal.device)
    theta = model.theta_optim()   # (N_CTX, 9) ∈ [0,1] sigmoid
    preds = model(
        difficulty_idx=deploy_ctx_indices["difficulty_idx"],
        generator_idx=deploy_ctx_indices["generator_idx"],
        bot_idx=deploy_ctx_indices["bot_idx"],
        pb_bin_idx=deploy_ctx_indices["pb_bin_idx"],
        lifecycle_idx=deploy_ctx_indices["lifecycle_idx"],
        log_pb=deploy_ctx_indices["log_pb"],
        theta_norm=theta,
    )
    curve = preds["curve"]   # (N_CTX, n_bins)
    target = target_ideal.unsqueeze(0).expand_as(curve)
    return F.mse_loss(curve, target)


def compute_total_loss(
    predictions: Dict[str, torch.Tensor],
    targets: Dict[str, torch.Tensor],
    pb_bin_idx: torch.Tensor,
    theta_norm: Optional[torch.Tensor] = None,
    weights: Optional[LossWeights] = None,
    # v3.0.11 (G6): 联合寻参 loss 所需的"全 deploy ctx batch" 上下文; None 时 deploy loss = 0
    model: Optional["nn.Module"] = None,
    deploy_ctx_indices: Optional[Dict[str, torch.Tensor]] = None,
    target_ideal: Optional[torch.Tensor] = None,
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

    # v2.10.32 (P0.2): 把 bin_counts (来自 targets) 透传给 loss_shape, confidence 加权
    l_shape = loss_shape(
        predictions["curve"], targets["curve"],
        bin_counts=targets.get("bin_counts"),
    )
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
    # v2.10.32 (P2.2): multi-task r_value head
    if "r_value" in predictions and "r_value" in targets:
        l_r_value = loss_r_value(predictions["r_value"], targets["r_value"])
    else:
        l_r_value = zero

    # v3.0.11 (G6): 联合寻参 loss — 当 model + deploy_ctx 都提供时算
    if model is not None and deploy_ctx_indices is not None and target_ideal is not None:
        l_deploy = loss_deploy(model, deploy_ctx_indices, target_ideal)
    else:
        l_deploy = zero

    # v3.0.19: same-ctx batch 内 model 输出方差最低惩罚, 防"绿点线段化"
    ctx_ids = targets.get("ctx_id")
    if ctx_ids is not None:
        l_theta_div = loss_theta_diversity(predictions["curve"], ctx_ids)
    else:
        l_theta_div = zero

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
             + w.endpoint * l_endpoint
             + w.r_value * l_r_value
             + w.deploy * l_deploy
             + w.theta_diversity * l_theta_div)

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
        r_value=l_r_value,
        deploy=l_deploy,
        theta_diversity=l_theta_div,
    )
