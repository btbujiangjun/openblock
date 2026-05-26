"""
d_curve 标签提取 — 从单局游戏轨迹生成 20 维难度向量。

输入: 一局游戏的步骤序列 (每步含状态指标)
输出:
  - d_curve: 长度 20 的 float 数组, 每 bin 对应 r ∈ [0, 1.5] 区间的平均单步难度
  - 辅助标签: final_score, survived_steps, clear_rate, noMove_step, pb_broke, surprise_count

v2.10: PB-aware d_step (与 web/src/tuning/v2/samplerV2.js 跨语言一致)
  老公式 (v2.9) 跟 r=score/PB 完全无关 → d_curve 几乎水平 (跨度仅 0.20)。
  模型再怎么训, 永远学不到 S 形 (因为训练 label 没 S 形)。

  v2.10 修复: d_step 显式编码 PB 命题
    state_d = 0.3*fill_rate + 0.5*(1-action_freedom) + 0.2*trend   # 棋盘状态
    d_pb_base(ratio) = 0.40 + 0.45 * sigmoid((ratio - 0.85) / 0.18) # S 形基础
    d_step = clip(d_pb_base + 0.30 * (state_d - 0.5), 0, 1)

  noMove 步: D_step = 1.0 (硬死局, 仍优先)
  Surprise 步 (clears >= 3): state_d *= 0.5 (惊喜降难, 仅作用于 state 部分)
"""
from __future__ import annotations
import math
from typing import Iterable, List, Optional, Sequence
from dataclasses import dataclass, field, asdict
from .target_curve import CURVE_N_BINS, CURVE_R_MAX, r_to_bin

# ─────────── 单步信号常量 ───────────

FILL_RATE_WEIGHT = 0.30
ACTION_FREEDOM_WEIGHT = 0.50
TREND_WEIGHT = 0.20
SURPRISE_DAMPING = 0.50            # 惊喜步的难度乘子
SURPRISE_MIN_CLEARS = 3            # ≥ 3 行触发惊喜
TREND_WINDOW = 5                   # 短期填充率趋势窗口

# v2.10: PB-aware d_step 常量 (跨语言: samplerV2.js 同步)
PB_AWARE_D_BASE = 0.40       # r=0 时的基础难度
PB_AWARE_D_PEAK = 0.85       # r→∞ 时的渐近难度
PB_AWARE_CENTER = 0.85       # S 形拐点 (在 PB 附近开始加压)
PB_AWARE_WIDTH = 0.18        # 拐点过渡宽度
PB_AWARE_STATE_WEIGHT = 0.30 # state_d 偏移幅度 (±0.15)


@dataclass
class StepInfo:
    """单步轨迹信息 (评估器输出的最小子集)。"""
    step_idx: int
    score: int                     # 累计得分
    fill_rate: float               # 盘面填充率 [0, 1]
    action_freedom: float          # 可放置 / 总位置数 [0, 1]
    no_move: bool                  # 是否硬死局
    clears: int = 0                # 该步消行数

    def step_difficulty(self, prev_fills: Sequence[float], ratio: float = 0.0) -> float:
        """计算单步难度信号 D_step ∈ [0, 1]。

        v2.10: 引入 PB 命题 (ratio = score/PB)
          d_pb_base(ratio): 基础 S 形, 范围 [0.40, 0.85]
          state_d:          老公式产出 [0, 1]
          d_step = clip(d_pb_base + 0.30*(state_d - 0.5), 0, 1)
        """
        if self.no_move:
            return 1.0
        # state_d (老公式): 棋盘状态难度
        if prev_fills:
            trend = self.fill_rate - (sum(prev_fills) / len(prev_fills))
        else:
            trend = 0.0
        trend_norm = max(0.0, min(1.0, 0.5 + trend))
        state_d = (FILL_RATE_WEIGHT * self.fill_rate
                   + ACTION_FREEDOM_WEIGHT * (1.0 - self.action_freedom)
                   + TREND_WEIGHT * trend_norm)
        state_d = max(0.0, min(1.0, state_d))
        if self.clears >= SURPRISE_MIN_CLEARS:
            state_d *= SURPRISE_DAMPING

        # v2.10: PB 命题的 S 形基础
        sig = 1.0 / (1.0 + math.exp(-(ratio - PB_AWARE_CENTER) / PB_AWARE_WIDTH))
        d_pb_base = PB_AWARE_D_BASE + (PB_AWARE_D_PEAK - PB_AWARE_D_BASE) * sig
        # 组合: PB 基础 + state 偏移
        state_offset = (state_d - 0.5) * PB_AWARE_STATE_WEIGHT
        return max(0.0, min(1.0, d_pb_base + state_offset))


@dataclass
class EpisodeLabels:
    """单局提取出的全部标签。"""
    d_curve: List[float]                   # 长度 CURVE_N_BINS
    final_score: int = 0
    survived_steps: int = 0
    clear_rate: float = 0.0
    noMove_step: int = -1                  # -1 = 未死局
    pb_broke: bool = False
    surprise_count: int = 0
    # 元信息
    n_steps_used: int = 0
    n_bins_filled: int = 0                 # 有数据的 bin 数 (≤ CURVE_N_BINS)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["d_curve"] = list(self.d_curve)
        d["pb_broke"] = bool(self.pb_broke)
        return d


def extract_d_curve(
    steps: Iterable[StepInfo],
    pb: int,
    n_bins: int = CURVE_N_BINS,
    r_max: float = CURVE_R_MAX,
) -> EpisodeLabels:
    """从单局轨迹提取 d_curve + 全部辅助标签。

    Args:
        steps:    单局所有步骤 (按 step_idx 升序)
        pb:       该玩家的个人最佳分 (用于归一化 r = score/PB)
        n_bins:   d_curve 维度 (默认 20)
        r_max:    r 上限 (默认 1.5)

    Returns:
        EpisodeLabels 含 d_curve 与全部辅助标签

    Raises:
        ValueError: pb <= 0 或 steps 为空
    """
    if pb <= 0:
        raise ValueError(f"pb must be positive, got {pb}")
    steps_list = list(steps)
    if not steps_list:
        raise ValueError("steps cannot be empty")

    # 累积单步难度到对应 bin
    bin_sums = [0.0] * n_bins
    bin_counts = [0] * n_bins
    recent_fills: List[float] = []

    final_score = steps_list[-1].score
    survived_steps = steps_list[-1].step_idx + 1
    total_clears = 0
    noMove_step = -1
    surprise_count = 0

    for st in steps_list:
        r = st.score / pb
        if r > r_max:
            r = r_max - 1e-9  # 防 r=r_max 时 r_to_bin 溢出
        bidx = r_to_bin(r, n_bins=n_bins, r_max=r_max)

        # v2.10: 传 ratio 让 step_difficulty 编码 PB 命题
        d = st.step_difficulty(recent_fills, ratio=r)
        bin_sums[bidx] += d
        bin_counts[bidx] += 1

        # 更新 trend window
        recent_fills.append(st.fill_rate)
        if len(recent_fills) > TREND_WINDOW:
            recent_fills.pop(0)

        total_clears += st.clears
        if st.clears >= SURPRISE_MIN_CLEARS:
            surprise_count += 1
        if st.no_move and noMove_step < 0:
            noMove_step = st.step_idx

    # 转 bin 均值 (空 bin 用线性插值填充, 末尾用最后一个非空值)
    d_curve = [0.0] * n_bins
    last_value = 0.0
    n_filled = 0
    for i in range(n_bins):
        if bin_counts[i] > 0:
            d_curve[i] = bin_sums[i] / bin_counts[i]
            last_value = d_curve[i]
            n_filled += 1
        else:
            d_curve[i] = last_value  # 后续插值

    # 反向填空 bin (开头如果是空)
    if n_filled > 0:
        for i in range(n_bins):
            if bin_counts[i] > 0:
                # 用第一个非空 bin 反填前面
                for j in range(i):
                    if bin_counts[j] == 0:
                        d_curve[j] = d_curve[i]
                break

    return EpisodeLabels(
        d_curve=d_curve,
        final_score=final_score,
        survived_steps=survived_steps,
        clear_rate=(total_clears / survived_steps) if survived_steps > 0 else 0.0,
        noMove_step=noMove_step,
        pb_broke=(final_score > pb),
        surprise_count=surprise_count,
        n_steps_used=len(steps_list),
        n_bins_filled=n_filled,
    )


def aggregate_d_curves(curves: Sequence[Sequence[float]]) -> List[float]:
    """对多局 d_curve 求均值 (用于场景级聚合)。"""
    if not curves:
        return []
    n_bins = len(curves[0])
    if not all(len(c) == n_bins for c in curves):
        raise ValueError("All curves must have same length")
    out = [0.0] * n_bins
    for c in curves:
        for i, v in enumerate(c):
            out[i] += float(v)
    n = len(curves)
    return [v / n for v in out]
