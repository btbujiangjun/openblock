"""分位数自适应 winThreshold（v11.2）：让胜利门槛随模型分数分布同步进化。

设计动机
--------
v8/v11 的线性 ramp + 闭环反馈仍需手工设定 winThresholdEnd（猜模型能力上限）。
当模型升级（架构/算力/算法），旧上限被穿透 → win_rate 饱和到 90%+ → reward variance ≈ 0
→ 策略梯度信号失效。每次升级都要重新猜 End，本质是把"环境契约"留给了开发者。

v11.2 借鉴 OpenAI Five（PBT/percentile reward）与 self-play 文献的通用做法：
**不设 End，让 winThreshold 等于近 N 局分数分布的第 p 分位数**。

数学上：
    thr_t = EMA( percentile(recent_scores, p), α )
    P(win) = P(score >= thr_t) = 1 - p/100   （恒等式）

例如 p=70 → win_rate 自然收敛到 30%，与 v11 的 target=50% 相比偏保守（更稳的训练
信号）。模型能力增长 → 分布上移 → 阈值上移 → win_rate 仍是 30%，**零超参拖累**。

与 v11 闭环的关系
-----------------
- mode=adaptive (v11):  win_history → action → virtual_ep → 线性 ramp 公式 → thr
- mode=quantile (v11.2): score_history → percentile → EMA → thr （短路掉公式）
- v11 闭环可在 quantile 模式下作为"observer"运行（监控 win_rate 是否符合预期，
  触发 severe 时打 alert，但不再调 thr）；本模块只负责计算 thr，不与 v11 耦合。

冷启动策略
----------
- 前 bootstrap_episodes 局：用 bootstrap_threshold 固定值（避免单局抖动主导分位数）
- 第一次有效计算时：直接用分位数初始化 EMA（避免 EMA 长时间收敛）
- 后续：EMA 平滑（α 越小越稳，越大越灵敏）

纯函数 + 无副作用 + 不依赖训练状态，便于 pytest 单测覆盖。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

QuantileAction = Literal["bootstrap", "quantile", "ema_init"]


@dataclass(frozen=True)
class QuantileDecision:
    """单次 quantile winThreshold 决策结果。

    Attributes
    ----------
    action          'bootstrap'（样本不足，用 bootstrap_threshold）/
                    'ema_init'（首次有效计算，EMA 直接初始化为分位数）/
                    'quantile'（常规 EMA 平滑）
    new_threshold   反馈后的整数 winThreshold（已 clip 到 [floor, ceil] 且应用棘轮）
    new_ema         反馈后的 EMA 内部状态（浮点；调用方需持久化）
    new_peak        反馈后的历史最高门槛（棘轮高水位；调用方需持久化）
    target_quantile 本次分位数原始值（bootstrap 时返回 -1.0，方便日志区分）
    sample_count    本次决策使用的样本数
    ratcheted       本次是否被棘轮地板抬升（说明策略相对历史峰值在退步）
    """

    action: QuantileAction
    new_threshold: int
    new_ema: float
    new_peak: float
    target_quantile: float
    sample_count: int
    ratcheted: bool


def _percentile_linear(sorted_scores: list[float], p: float) -> float:
    """numpy-free 线性插值分位数（与 numpy.percentile(interpolation='linear') 一致）。

    用于纯 Python 单测；训练循环中样本数 ≤500，CPU 开销可忽略。
    """
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


def compute_quantile_threshold(
    score_history: Iterable[float],
    ema_state: float,
    *,
    p: float = 70.0,
    ema_alpha: float = 0.05,
    bootstrap_episodes: int = 100,
    bootstrap_threshold: int = 40,
    floor: int = 40,
    ceil: int = 9999,
    ema_initialized: bool = False,
    ratchet_peak: float = 0.0,
    ratchet_decay: float = 0.9,
) -> QuantileDecision:
    """根据近期分数分布计算 winThreshold。

    Parameters
    ----------
    score_history     近期分数序列（建议传入 collections.deque(maxlen=N)）
    ema_state         上一轮的 EMA 浮点状态；首次调用传 0.0 + ema_initialized=False
    p                 目标分位数（百分制）。p=70 → win_rate ≈ 30%
    ema_alpha         EMA 平滑系数：new_ema = α·target + (1-α)·old_ema；
                      α=0.05 表示约 ln(2)/0.05 ≈ 14 次更新衰减到一半
    bootstrap_episodes 样本不足此值时返回 bootstrap_threshold
    bootstrap_threshold 冷启动门槛（应与 v11.1 的 winThresholdStart 一致）
    floor / ceil      最终 threshold clip 边界
    ema_initialized   ema_state 是否已被首次初始化过；首次有效计算时建议设 False
                      以触发 'ema_init' 分支（避免 EMA 长时间收敛）
    ratchet_peak      历史最高门槛（棘轮高水位，调用方持久化）。门槛只允许小幅回落。
    ratchet_decay     门槛回落下限比例：new_threshold >= ratchet_decay * ratchet_peak。
                      纯分位课程会让门槛追随策略一起下跌（win_rate 恒为 1-p，无绝对进步
                      压力 → 退化反馈环）。棘轮让门槛成为"高水位线"：策略退步时门槛不跟跌，
                      win_rate 跌破 1-p 形成纠偏压力。ratchet_decay=1.0 为完全单调，
                      0.9 允许 10% 让步以免门槛过高致 reward variance 归零。

    Returns
    -------
    QuantileDecision  含 action / new_threshold / new_ema / new_peak / target_quantile / ...
    """
    history = list(score_history)
    n = len(history)
    ratchet_floor = float(ratchet_decay) * float(ratchet_peak)

    if n < max(1, bootstrap_episodes):
        thr = max(float(floor), min(float(ceil), float(bootstrap_threshold)))
        return QuantileDecision(
            action="bootstrap",
            new_threshold=int(round(thr)),
            new_ema=float(ema_state),
            new_peak=float(ratchet_peak),
            target_quantile=-1.0,
            sample_count=n,
            ratcheted=False,
        )

    sorted_scores = sorted(float(x) for x in history)
    target = _percentile_linear(sorted_scores, float(p))

    if not ema_initialized or ema_state <= 0.0:
        new_ema = target
        action: QuantileAction = "ema_init"
    else:
        alpha = float(ema_alpha)
        if alpha <= 0.0:
            new_ema = float(ema_state)
        elif alpha >= 1.0:
            new_ema = target
        else:
            new_ema = alpha * target + (1.0 - alpha) * float(ema_state)
        action = "quantile"

    thr_raw = max(float(floor), min(float(ceil), new_ema))
    # 棘轮：门槛不得低于历史峰值的 ratchet_decay 倍（仍受 ceil 约束）。
    thr_ratcheted = min(float(ceil), max(thr_raw, ratchet_floor))
    new_peak = max(float(ratchet_peak), thr_ratcheted)
    return QuantileDecision(
        action=action,
        new_threshold=int(round(thr_ratcheted)),
        new_ema=float(new_ema),
        new_peak=float(new_peak),
        target_quantile=float(target),
        sample_count=n,
        ratcheted=thr_ratcheted > thr_raw + 1e-9,
    )
