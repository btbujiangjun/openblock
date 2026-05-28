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

# v3.1 (G5 物理侧 θ 接入): θ 通过 PB-aware sigmoid 影响 d_step
#   背景: v3.0 起 d_step = state_d, 仅靠 fillRate/freedom/trend, 跟 r 无关.
#         → 启发式物理上跑不出 S 形 d_curve, 实测 vs ideal MAE 长期 0.25 锁死.
#
#   v3.1 修复 (受控):
#     d_step = (1 - θ_blend) * state_d + θ_blend * pb_aware_lift(r, θ_center, θ_width)
#   其中 pb_aware_lift = sigmoid((r - center) / width) ∈ [0, 1]
#
#   核心差异 vs v2.x PB-aware:
#     v2.x: PB_AWARE_CENTER/WIDTH 写死 ideal target 端点 → data leakage
#     v3.1: center/width 来自 θ.pbTensionCenter/pbTensionWidth (trainable, 寻参产物)
#           → 不是 leakage, 是受 θ 控制的物理因果 (闭环可学)
#
#   PB_AWARE_BLEND 控制混合强度:
#     0.0: 纯 state_d (=v3.0 行为)
#     0.4: 物理 60% + PB-aware 40% (推荐, 撬动 ~30%)
#     0.7: PB-aware 主导 (回到 v2.x leakage 边缘, 不推荐)
PB_AWARE_BLEND = 0.40
PB_AWARE_TENSION_CENTER_DEFAULT = 0.82   # 跟 DEFAULT_SPAWN_PARAMS_PB_CURVE 一致
PB_AWARE_TENSION_WIDTH_DEFAULT = 0.08

# PB-aware d_step 常量 (跨语言: samplerV2.js + policyMetricsV2.js 严格同步)
# v2.12 起 d_pb_base 直接复用 target_S_curve (ideal 4 段分段函数),
#   sample 形态 ≈ ideal target, model 学到的就是 ideal.
# 以下 4 个常量仅供跨语言一致性测试断言镜像 + 文档说明用, 不再参与计算.
PB_AWARE_D_BASE = 0.20       # = D_BASE   (ideal)
PB_AWARE_D_PEAK = 1.00       # = D_CAP    (ideal)
PB_AWARE_CENTER = 0.85       # legacy 单段 sigmoid 拐点 (新公式用 4 段分段不再依赖)
PB_AWARE_WIDTH = 0.18        # legacy 单段 sigmoid 宽度
# state_d 偏移幅度: state_offset = (state_d - 0.5) * STATE_WEIGHT ∈ ±0.10
# 给 ctx 差异性, 跨度 0.20 (从 0.25 收紧, 避免中段 sample 系统性偏正)
PB_AWARE_STATE_WEIGHT = 0.20

# v2.10.1: 贝叶斯先验平滑 (跨语言: samplerV2.js 同步)
#   病例: bot 太弱, 51% 样本 final_r < 0.2, 高 r bin (r>1) 几乎无数据。
#   老的 lastValue 填充会把空 bin 都填成低 r 的值, 让 d_curve 末尾被压低,
#   导致跨度 0.167 (业务期望 0.45)。
#   修法: 空 bin 用业务理论 d_pb_base(bin_center) 填; 稀疏 bin (<MIN_OBS)
#   用观察 + 先验的加权平均, 让数据丰富区保留 ctx 信息, 稀疏区回归 S 形先验。
PB_AWARE_PRIOR_STRENGTH = 3  # 需要 ≥3 观察才完全覆盖先验
PB_AWARE_MIN_OBS = 1         # bin 至少有 1 观察才用观察, 否则纯先验


def pb_aware_d_pb_base(ratio: float) -> float:
    """v3.0: legacy 函数, 已不参与 d_step 计算 (sample 回归真实状态).

    保留供跨语言一致性测试 + 兼容老 algo_version='v2.11'/'v2.12' 样本.
    新 sample (algo_version='v3.0') d_step 仅基于 state_d, 不调此函数.
    """
    from .target_curve import target_S_curve
    return target_S_curve(ratio)


@dataclass
class StepInfo:
    """单步轨迹信息 (评估器输出的最小子集)。"""
    step_idx: int
    score: int                     # 累计得分
    fill_rate: float               # 盘面填充率 [0, 1]
    action_freedom: float          # 可放置 / 总位置数 [0, 1]
    no_move: bool                  # 是否硬死局
    clears: int = 0                # 该步消行数

    def step_difficulty(
        self,
        prev_fills: Sequence[float],
        ratio: float = 0.0,
        theta_pb_tension_center: float = PB_AWARE_TENSION_CENTER_DEFAULT,
        theta_pb_tension_width: float = PB_AWARE_TENSION_WIDTH_DEFAULT,
    ) -> float:
        """计算单步难度信号 D_step ∈ [0, 1].

        v3.0: d_step = state_d (无 r 信号), 启发式物理跑不出 S 形.
        v3.1 (G5): d_step = (1-BLEND)*state_d + BLEND*pb_aware_lift(r, θ_center, θ_width)
              θ 通过 PB-aware sigmoid 显式调制 d_step → 启发式具备 PB 物理感知
              不同 θ 让同一棋盘状态对应不同 d_step → ctx/θ 信号强 → model 寻参更有效

        Args:
            prev_fills: 最近 N 步 fillRate, 用于算 trend
            ratio: score / pb ∈ [0, 2.0] — v3.1 起 PB-aware 项使用
            theta_pb_tension_center: θ.pbTensionCenter (默认 0.82)
            theta_pb_tension_width: θ.pbTensionWidth (默认 0.08)
        """
        if self.no_move:
            return 1.0   # 死局 = 最高难度
        # state_d: 真实棋盘压力 (无 target 泄露)
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
            state_d *= SURPRISE_DAMPING   # 大消行 → 棋盘压力骤降 (惊喜事件)

        # v3.1 (G5): PB-aware lift 项 — θ 控制的物理调制
        #   pb_lift = sigmoid((r - center) / width); width=0 时退化为阶跃 (clamp)
        if PB_AWARE_BLEND > 0 and theta_pb_tension_width > 1e-6:
            x = (ratio - theta_pb_tension_center) / theta_pb_tension_width
            pb_lift = 1.0 / (1.0 + math.exp(-x))   # ∈ (0, 1)
            d_step = (1.0 - PB_AWARE_BLEND) * state_d + PB_AWARE_BLEND * pb_lift
        else:
            d_step = state_d
        return max(0.0, min(1.0, d_step))


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
    # v3.1 (G5): θ 控制 PB-aware d_step lift
    theta_pb_tension_center: float = PB_AWARE_TENSION_CENTER_DEFAULT,
    theta_pb_tension_width: float = PB_AWARE_TENSION_WIDTH_DEFAULT,
) -> EpisodeLabels:
    """从单局轨迹提取 d_curve + 全部辅助标签。

    Args:
        steps:    单局所有步骤 (按 step_idx 升序)
        pb:       该玩家的个人最佳分 (用于归一化 r = score/PB)
        n_bins:   d_curve 维度 (默认 20)
        r_max:    r 上限 (默认 1.5)
        theta_pb_tension_center: v3.1 (G5) θ 控制 PB-aware sigmoid 拐点
        theta_pb_tension_width:  v3.1 (G5) θ 控制 PB-aware sigmoid 斜率宽度

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

        # v3.1 (G5): 传 θ 让 step_difficulty 物理上感知 PB
        d = st.step_difficulty(
            recent_fills, ratio=r,
            theta_pb_tension_center=theta_pb_tension_center,
            theta_pb_tension_width=theta_pb_tension_width,
        )
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

    # v3.0: 空 bin 用 lastValue 填充 (前一个有数据 bin 的值, 防止 d_curve 断裂)
    #   注意: bin_counts[i] = 0 时, 训练 L_shape confidence-weighted 会 mask 该 bin
    #         所以填什么不影响训练, 仅用于 chart 显示连续性
    #   完全无数据时填 0.5 (中性)
    d_curve = [0.0] * n_bins
    n_filled = 0
    last_value = 0.5   # 兜底初值, 跨度中点
    for i in range(n_bins):
        if bin_counts[i] >= PB_AWARE_MIN_OBS:
            obs = bin_sums[i] / bin_counts[i]
            d_curve[i] = obs   # 真实观察, 不再混合 prior
            last_value = obs
            n_filled += 1
        else:
            d_curve[i] = last_value   # fallback to previous observed bin

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
