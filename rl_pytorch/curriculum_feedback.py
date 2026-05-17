"""闭环课程反馈：基于滑动胜率四档分级响应。

设计动机
---------
v8 的 adaptiveCurriculum 仅 `stepUp` 单向推进、`stepDown=0` 默认，导致：
  - 训练 win_threshold 被推到高位后塌缩时 `virtual_ep` 永远不下降 → 策略陷入"全 lose"
    阶段无反馈出口，"得分太低"问题恶化。

v11 借鉴 search-contempt（arXiv:2504.07757 §4.2 + Figure 6）的训练 schedule 范式：
  把"保持 (w+l)/d ≈ 1"翻译到 1-player 随机环境的等价物——保持 win_rate 在
  [target-holdBand, target+accelBand] 区间，超出后双向反馈。

四档分级
---------
| win_rate 区间                                    | 动作        | virtual_ep 变化              |
| ----------------------------------------------- | ----------- | ---------------------------- |
| wr ≥ target + accelBand                         | "accel"     | +stepUp × checkEvery         |
| wr ∈ [target − holdBand, target + accelBand)    | "hold"      | +checkEvery                  |
| wr ∈ [target − lowWinRateBand, target − holdBand) | "pause"   | 0                            |
| wr ∈ [target − severeWinRateBand, target − lowWinRateBand) | "rollback" | -stepDown × checkEvery |
| wr < target − severeWinRateBand                 | "severe"    | virtual_ep × severeRollbackFactor |

样本不足（win_history 长度 < minSamplesForAction）时返回 "warmup"，按 +checkEvery 推进。

纯函数 + 不依赖训练状态，便于 pytest 单测覆盖。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Literal

CurriculumAction = Literal["accel", "hold", "pause", "rollback", "severe", "warmup"]


@dataclass(frozen=True)
class CurriculumDecision:
    """单次课程反馈决策结果。

    Attributes
    ----------
    action          四档（含 warmup）之一
    new_virtual_ep  反馈后的虚拟局数（已应用 floor / rollback）
    win_rate        本次决策使用的滑动胜率（warmup 时返回 NaN 等价值 = -1.0）
    delta_virtual_ep  本次推进的虚拟局数增量（severe 时为负，反映回退绝对量）
    """

    action: CurriculumAction
    new_virtual_ep: float
    win_rate: float
    delta_virtual_ep: float


def compute_curriculum_action(
    win_history: Iterable[int | bool],
    virtual_ep: float,
    *,
    target_win_rate: float = 0.5,
    accel_band: float = 0.1,
    hold_band: float = 0.1,
    low_win_rate_band: float = 0.2,
    severe_win_rate_band: float = 0.4,
    step_up: float = 2.0,
    step_down: float = 1.0,
    check_every: int = 50,
    min_virtual_ep: float = 0.0,
    rollback_on_severe_drop: bool = True,
    severe_rollback_factor: float = 0.5,
    min_samples_for_action: int = 10,
) -> CurriculumDecision:
    """根据滑动胜率计算课程推进决策。

    Parameters
    ----------
    win_history     近期胜负序列（1/True=win, 0/False=lose）。建议传入 collections.deque
    virtual_ep      当前虚拟局数（用于反馈调节）

    其余参数对应 shared/game_rules.json `rlRewardShaping.adaptiveCurriculum` 字段；
    详见模块 docstring 的四档分级表。

    Returns
    -------
    CurriculumDecision  含 action / new_virtual_ep / win_rate / delta_virtual_ep
    """
    history = list(win_history)
    n = len(history)
    if n < max(1, min_samples_for_action):
        delta = float(check_every)
        new_vep = max(min_virtual_ep, virtual_ep + delta)
        return CurriculumDecision(
            action="warmup",
            new_virtual_ep=new_vep,
            win_rate=-1.0,
            delta_virtual_ep=delta,
        )

    win_rate = sum(1 for x in history if x) / n

    severe_lower = target_win_rate - severe_win_rate_band
    low_lower = target_win_rate - low_win_rate_band
    hold_lower = target_win_rate - hold_band
    accel_lower = target_win_rate + accel_band

    if win_rate < severe_lower and rollback_on_severe_drop:
        new_vep = max(min_virtual_ep, virtual_ep * severe_rollback_factor)
        return CurriculumDecision(
            action="severe",
            new_virtual_ep=new_vep,
            win_rate=win_rate,
            delta_virtual_ep=new_vep - virtual_ep,
        )

    if win_rate < low_lower:
        delta = -step_down * check_every
        new_vep = max(min_virtual_ep, virtual_ep + delta)
        return CurriculumDecision(
            action="rollback",
            new_virtual_ep=new_vep,
            win_rate=win_rate,
            delta_virtual_ep=new_vep - virtual_ep,
        )

    if win_rate < hold_lower:
        return CurriculumDecision(
            action="pause",
            new_virtual_ep=max(min_virtual_ep, virtual_ep),
            win_rate=win_rate,
            delta_virtual_ep=0.0,
        )

    if win_rate >= accel_lower:
        delta = step_up * check_every
        new_vep = max(min_virtual_ep, virtual_ep + delta)
        return CurriculumDecision(
            action="accel",
            new_virtual_ep=new_vep,
            win_rate=win_rate,
            delta_virtual_ep=delta,
        )

    delta = float(check_every)
    new_vep = max(min_virtual_ep, virtual_ep + delta)
    return CurriculumDecision(
        action="hold",
        new_virtual_ep=new_vep,
        win_rate=win_rate,
        delta_virtual_ep=delta,
    )
