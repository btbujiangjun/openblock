"""Random Network Distillation 内在动机（v11.2 方案 C，opt-in）。

设计动机
--------
高 ep（典型 > 50k）后，extrinsic reward 信号衰减（熵→0、得分增长停滞），策略陷入
"短而稳"的局部最优。RND（Burda et al. 2018, arXiv:1810.12894）通过预测误差
作为内在好奇心奖励，鼓励访问新颖状态：

    r_intrinsic(s) = β · || f_target(s) - f_predictor(s) ||²

其中：
- f_target   : 随机初始化的小 MLP，参数永远冻结
- f_predictor: 在线学习预测 f_target 的输出
- 新颖状态 → predictor 误差大 → r_intrinsic 高

与 quantile / smooth 方案的协同
------------------------------
- A (quantile) : 解决"reward signal 失真"（thr 错误）
- B (smooth)   : 解决"reward 跳变"（V 拟合困难）
- C (RND)      : 解决"explore 失败"（熵衰减后无法跳出局部最优）

三者解决不同病症，可独立 / 叠加启用。

触发条件
--------
当满足以下任一时启用：
- 训练 > 50k ep 且 mean_score 增长曲线斜率连续 5k ep < 1e-3
- entropy 下降到 < 0.2 但策略表现仍未达天花板（avg_score < 期望值 80%）

实现要点
--------
- 双 MLP（target + predictor），共享 state 特征空间（STATE_FEATURE_DIM=42）
- 内在 reward 标准化（running mean/std 归一化）—— Burda 原论文做法
- predictor 训练每 N 步做一次梯度更新（与策略训练同步）
- 默认 off；环境变量 RL_RND=1 / config rndCuriosity.enabled=true 启用

骨架接口契约
------------
- IntrinsicRNDHead       : 双网络容器，提供 .compute_intrinsic() 与 .update()
- RNDRewardNormalizer    : running mean/std 标准化，纯 Python，无需 torch
- compute_rnd_trigger    : 检测是否满足启用条件（纯函数，便于 alerting）
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Iterable, Literal, Optional

# torch 仅在实际启用 RND 时导入（避免 cold path 的导入开销）
TYPE_CHECKING = False
if TYPE_CHECKING:
    import torch  # noqa: F401


# ---------------------------------------------------------------------------
# 1. 触发条件检测（纯函数，无 torch 依赖）
# ---------------------------------------------------------------------------
TriggerReason = Literal["score_stall", "entropy_collapse", "manual", "not_triggered"]


@dataclass(frozen=True)
class RNDTriggerDecision:
    """RND 启用建议（仅 alerting / 自动启用判定，不强制操作）。

    Attributes
    ----------
    should_enable    是否建议立即启用 RND
    reason           触发原因
    metric_value     触发依据的核心指标值（slope / entropy / 1.0 for manual）
    explanation      人类可读的判断说明
    """

    should_enable: bool
    reason: TriggerReason
    metric_value: float
    explanation: str


def compute_rnd_trigger(
    episode: int,
    avg_score_history: Iterable[float],
    entropy_history: Iterable[float],
    *,
    min_episode: int = 50_000,
    score_slope_window: int = 5_000,
    score_slope_threshold: float = 1e-3,
    entropy_collapse_threshold: float = 0.2,
    expected_score_at_collapse: Optional[float] = None,
    score_collapse_ratio: float = 0.8,
    manual_force: bool = False,
) -> RNDTriggerDecision:
    """检测是否满足 RND 启用条件。

    Parameters
    ----------
    episode                     当前训练局数
    avg_score_history           近期 mean_score 序列（每 log 段一个点）
    entropy_history             近期策略熵序列（每 log 段一个点）
    min_episode                 最小启用 ep（< 此值不建议启用）
    score_slope_window          slope 计算窗口（局）
    score_slope_threshold       slope < 此值视为 stall
    entropy_collapse_threshold  entropy < 此值视为 collapsed
    expected_score_at_collapse  熵塌时期望的最低分数（用于排除"已收敛到高分"的健康情况）
    score_collapse_ratio        实际分数 < expected × ratio 才算"未达天花板"
    manual_force                外部强制启用（绕过所有自动判定）

    Returns
    -------
    RNDTriggerDecision  四种情况：score_stall / entropy_collapse / manual / not_triggered
    """
    if manual_force:
        return RNDTriggerDecision(
            should_enable=True,
            reason="manual",
            metric_value=1.0,
            explanation="manual_force=True：人工强制启用",
        )

    if episode < min_episode:
        return RNDTriggerDecision(
            should_enable=False,
            reason="not_triggered",
            metric_value=float(episode),
            explanation=f"ep={episode} < min_episode={min_episode}",
        )

    scores = list(avg_score_history)
    entropies = list(entropy_history)

    # 条件 1：score stall
    if len(scores) >= 2:
        recent = scores[-min(len(scores), max(2, score_slope_window // 50)):]
        if len(recent) >= 2:
            slope = (recent[-1] - recent[0]) / max(1, len(recent) - 1)
            if abs(slope) < score_slope_threshold:
                return RNDTriggerDecision(
                    should_enable=True,
                    reason="score_stall",
                    metric_value=float(slope),
                    explanation=(
                        f"近 {len(recent)} log 段 mean_score 斜率 |{slope:.5f}| "
                        f"< {score_slope_threshold}（窗口约 {score_slope_window} ep）"
                    ),
                )

    # 条件 2：entropy collapse + score 未达天花板
    if entropies and entropies[-1] < entropy_collapse_threshold:
        h = float(entropies[-1])
        if expected_score_at_collapse is not None and scores:
            actual = float(scores[-1])
            if actual < float(expected_score_at_collapse) * float(score_collapse_ratio):
                return RNDTriggerDecision(
                    should_enable=True,
                    reason="entropy_collapse",
                    metric_value=h,
                    explanation=(
                        f"entropy {h:.3f} < {entropy_collapse_threshold} 且 "
                        f"avg_score {actual:.1f} < expected×{score_collapse_ratio} = "
                        f"{expected_score_at_collapse * score_collapse_ratio:.1f}"
                    ),
                )
        else:
            return RNDTriggerDecision(
                should_enable=True,
                reason="entropy_collapse",
                metric_value=h,
                explanation=(
                    f"entropy {h:.3f} < {entropy_collapse_threshold}（未提供"
                    "expected_score_at_collapse，不排除健康收敛情况）"
                ),
            )

    return RNDTriggerDecision(
        should_enable=False,
        reason="not_triggered",
        metric_value=0.0,
        explanation="尚未满足任何触发条件",
    )


# ---------------------------------------------------------------------------
# 2. 内在 reward 归一化（纯 Python，避免 torch 依赖）
# ---------------------------------------------------------------------------
@dataclass
class RNDRewardNormalizer:
    """Welford running mean/std，对内在 reward 做 / std 归一化（Burda 2018 §2.4）。

    标准化的目的：让 β 在不同任务/模型上有可比性（否则 raw r_int 量级随 state 维度变化）。

    Attributes
    ----------
    count   累计样本数
    mean    running mean
    m2      running second moment（用于稳定的 std 计算）
    eps     std 下限，避免除 0
    """

    count: int = 0
    mean: float = 0.0
    m2: float = 0.0
    eps: float = 1e-8

    def update(self, value: float) -> None:
        """Welford 单值在线更新。"""
        self.count += 1
        delta = value - self.mean
        self.mean += delta / self.count
        delta2 = value - self.mean
        self.m2 += delta * delta2

    def update_batch(self, values: Iterable[float]) -> None:
        for v in values:
            self.update(float(v))

    @property
    def std(self) -> float:
        if self.count < 2:
            return 1.0
        return max(self.eps, math.sqrt(self.m2 / (self.count - 1)))

    def normalize(self, value: float) -> float:
        return float(value) / self.std

    def normalize_many(self, values: Iterable[float]) -> list[float]:
        s = self.std
        return [float(v) / s for v in values]


# ---------------------------------------------------------------------------
# 3. RND 双 MLP 头（lazy torch import；仅启用时实例化）
# ---------------------------------------------------------------------------
@dataclass
class RNDConfig:
    """RND 训练超参（与 game_rules.json -> rlRewardShaping.rndCuriosity 对齐）。"""

    enabled: bool = False
    state_dim: int = 204  # = rl_pytorch.features.STATE_FEATURE_DIM（v1.67：+3 空间规划）
    hidden_dim: int = 64
    output_dim: int = 32
    beta: float = 0.1                 # 内在奖励权重
    learning_rate: float = 1e-4
    update_every_steps: int = 1       # 每 N 个采集 step 做一次 predictor 更新
    normalize_intrinsic: bool = True
    grad_clip: float = 5.0


def build_rnd_networks(cfg: RNDConfig, device=None):
    """惰性构造双 MLP（target 冻结 + predictor 训练）。

    Returns
    -------
    (target_net, predictor_net, optimizer)  target_net 已 eval() 且参数 requires_grad=False
    """
    import torch
    import torch.nn as nn

    def _mlp(in_dim: int, hidden: int, out_dim: int) -> nn.Module:
        return nn.Sequential(
            nn.Linear(in_dim, hidden),
            nn.ReLU(inplace=True),
            nn.Linear(hidden, hidden),
            nn.ReLU(inplace=True),
            nn.Linear(hidden, out_dim),
        )

    target = _mlp(cfg.state_dim, cfg.hidden_dim, cfg.output_dim)
    predictor = _mlp(cfg.state_dim, cfg.hidden_dim, cfg.output_dim)
    if device is not None:
        target = target.to(device)
        predictor = predictor.to(device)
    target.eval()
    for p in target.parameters():
        p.requires_grad_(False)
    opt = torch.optim.Adam(predictor.parameters(), lr=cfg.learning_rate)
    return target, predictor, opt


def compute_intrinsic_reward(target_net, predictor_net, states_tensor):
    """计算单步 / 批量 intrinsic reward = ||target - predictor||² 沿 output 维求和。

    Parameters
    ----------
    states_tensor  shape (N, state_dim) 的 float tensor

    Returns
    -------
    (rewards_tensor, predictor_loss_tensor)
        rewards_tensor : shape (N,) 的 float tensor（无梯度）
        predictor_loss : 标量 tensor（含梯度，用于 backward）
    """
    import torch
    with torch.no_grad():
        target_out = target_net(states_tensor)
    pred_out = predictor_net(states_tensor)
    sq_err = (target_out - pred_out).pow(2).sum(dim=-1)
    predictor_loss = sq_err.mean()
    rewards = sq_err.detach()
    return rewards, predictor_loss


@dataclass
class RNDStep:
    """单次 RND 训练 + 内在 reward 计算的输出（用于日志与 jsonl 写入）。"""

    intrinsic_mean: float
    intrinsic_max: float
    predictor_loss: float
    normalized_mean: float
    normalizer_std: float
    grad_norm: float
    skipped: bool = False
    skip_reason: Optional[str] = None
