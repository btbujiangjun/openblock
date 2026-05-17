"""平滑奖励整形（v11.2 方案 B，opt-in）：把 sparse winBonus 替换为 tanh 连续过渡。

设计动机
--------
v8-v11.2 的 `winBonus`（默认 35）是整局唯一离散正反馈：
    r_terminal = winBonus if prev_score < thr <= score_t else 0

问题：阈值附近 reward 跳变 → V 头难拟合阈值附近的非线性形态，长期表现为
`Lv` 高位震荡（典型 20-26，远高于 dense 项预期）。

方案 B 把 0/1 触发替换为连续函数：

    r_terminal = winBonus · tanh((final_score - target) / span)

其中：
    target = score 分布 p50（中位数）
    span   = IQR (p75 - p25)

数学性质
--------
- score = target          → r = 0          （处于中位的局，无 bias）
- score = target + span   → r ≈ 0.76·wb    （比中位高 1 个 IQR，强正反馈）
- score = target + 2·span → r ≈ 0.96·wb    （远超中位，几乎饱和）
- score = target - span   → r ≈ -0.76·wb   （比中位低 1 个 IQR，强负反馈）

关键差异（vs 原 sparse 版本）
-----------------------------
1. **永远有梯度信号**：score=target±ε 时仍有非零 reward → 阈值附近 V 头可学到
2. **自然嵌入分位数**：target/span 由 score 分布动态计算 → 无需手工 winThreshold
3. **正负对称**：低于中位会被惩罚（不只是"没拿到 winBonus"），更强的"avoid bad"信号
4. **量级保持**：tanh 在 ±1 内饱和，最大 reward = ±winBonus，不破坏现有量纲

与 quantile 课程的关系
----------------------
- A (quantile) 解决"`winBonus` 触发阈值是否合理"
- B (smooth)   解决"`winBonus` 跳变本身是否会破坏 V 拟合"
- 二者正交可叠加：A 控触发，B 控形状

OOD 风险
--------
- B 改变 reward 量级 → 旧 checkpoint 的 V 头会失配，建议从头训或长 warmup
- 因此本模块默认 off（`rlRewardShaping.smoothWinBonus.enabled = false`）
- 启用前请先在小规模实验上验证 V 拟合曲线（看板图 6）改善

纯函数 + 无副作用，便于 pytest 单测覆盖。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Iterable, Literal

SmoothAction = Literal["sparse_fallback", "bootstrap", "smooth"]


@dataclass(frozen=True)
class SmoothRewardDecision:
    """终局 reward 整形决策结果。

    Attributes
    ----------
    action          'sparse_fallback'（禁用或样本不足，退化为原 sparse 行为）/
                    'bootstrap'（启用但仍在 bootstrap 阶段，用固定 sparse + 固定 target/span）/
                    'smooth'  （正式生效）
    reward          本次终局应注入的额外 reward（注意：调用方需把 _原_ winBonus 替换为本值）
    target          本次使用的 target（p50）
    span            本次使用的 span（IQR）
    sample_count    score_history 当前样本数
    """

    action: SmoothAction
    reward: float
    target: float
    span: float
    sample_count: int


def _percentile_linear(sorted_scores: list[float], p: float) -> float:
    """numpy-free 线性插值分位数（与 numpy.percentile(interpolation='linear') 一致）。"""
    n = len(sorted_scores)
    if n == 0:
        return 0.0
    if n == 1:
        return float(sorted_scores[0])
    idx = (p / 100.0) * (n - 1)
    lo = int(idx)
    hi = min(lo + 1, n - 1)
    frac = idx - lo
    return float(sorted_scores[lo] * (1.0 - frac) + sorted_scores[hi] * frac)


def compute_smooth_terminal_reward(
    final_score: float,
    score_history: Iterable[float],
    *,
    enabled: bool = False,
    win_bonus: float = 35.0,
    target_percentile: float = 50.0,
    span_low_percentile: float = 25.0,
    span_high_percentile: float = 75.0,
    bootstrap_episodes: int = 200,
    bootstrap_target: float = 100.0,
    bootstrap_span: float = 60.0,
    span_floor: float = 1.0,
    saturation_clip: float = 1.0,
) -> SmoothRewardDecision:
    """计算 tanh 平滑后的终局奖励，替代原 sparse `winBonus`。

    Parameters
    ----------
    final_score        本局结束时的最终分数
    score_history      近 N 局分数序列（建议 deque(maxlen=windowEpisodes)）
    enabled            False 时返回 sparse_fallback（reward=0，由调用方走原 sparse 路径）
    win_bonus          振幅上限，与 game_rules.rlRewardShaping.winBonus 一致
    target_percentile  作为"中性局"的分位（默认 p50 = 中位数）
    span_low / high    构成 span 的两个分位（默认 p25 / p75 → IQR）
    bootstrap_episodes 样本不足此值时用 bootstrap_target / bootstrap_span 兜底
    bootstrap_target   冷启动时的 target 值
    bootstrap_span     冷启动时的 span 值
    span_floor         span 下限（避免初期分布过窄导致 reward 爆裂）
    saturation_clip    tanh 输入的 clip（默认 ±1，对应 |reward| ≤ tanh(1)·win_bonus ≈ 0.76·win_bonus
                       的"软饱和"；改 2 可让 ±2σ 进入 ±0.96·win_bonus 接近完全饱和；改 ≥5 实际无限制）

    Returns
    -------
    SmoothRewardDecision  含 action / reward / target / span / sample_count

    Notes
    -----
    - 当 action='sparse_fallback' 时 reward=0，调用方仍应执行原 sparse `winBonus` 触发逻辑。
    - 当 action ∈ ('bootstrap', 'smooth') 时调用方应**完全替换**原 sparse 触发，
      使用本函数返回的 reward。
    """
    if not enabled:
        return SmoothRewardDecision(
            action="sparse_fallback",
            reward=0.0,
            target=0.0,
            span=0.0,
            sample_count=0,
        )

    history = list(score_history)
    n = len(history)

    if n < max(1, bootstrap_episodes):
        target = float(bootstrap_target)
        span = max(float(span_floor), float(bootstrap_span))
        action: SmoothAction = "bootstrap"
    else:
        sorted_scores = sorted(float(x) for x in history)
        target = _percentile_linear(sorted_scores, float(target_percentile))
        hi = _percentile_linear(sorted_scores, float(span_high_percentile))
        lo = _percentile_linear(sorted_scores, float(span_low_percentile))
        span = max(float(span_floor), hi - lo)
        action = "smooth"

    raw = (float(final_score) - target) / span
    clipped = max(-float(saturation_clip), min(float(saturation_clip), raw))
    reward = float(win_bonus) * math.tanh(clipped)

    return SmoothRewardDecision(
        action=action,
        reward=reward,
        target=target,
        span=span,
        sample_count=n,
    )
