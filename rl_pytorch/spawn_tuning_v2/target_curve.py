"""
目标 S 曲线 (业务目标量化的数学表达)。

核心命题: 让玩家"接近 PB 但难以超越,偶有惊喜"。
对应到 r = score/PB 的归一化进度上, 目标难度 D(r) 应满足:

  r < 0.5        : D 在 [0.20, 0.30],  线性轻微上升 (远离 PB, 简单)
  r ∈ [0.5, 0.95): D 在 [0.30, 0.50],  线性中速上升 (接近 PB, 加压)
  r ∈ [0.95, 1.0): D 在 [0.50, 0.90],  sigmoid 急升  (临近 PB, 刹车)
  r ≥ 1.0        : D 在 [0.90, 1.00],  指数加压收敛 (超越 PB, 持续加压)

设计哲学:
  - 4 段分段函数, 各段连续 (D(0.5-)=D(0.5+)=0.30, ...)
  - 单调非降 (除 surprise 噪声, 数学曲线本身严格非降)
  - 全部参数有业务含义,可解释
"""
from __future__ import annotations
import math
from typing import List

# ─────────── 常量 ───────────

CURVE_N_BINS = 20             # d_curve 离散化点数
CURVE_R_MAX = 1.5             # r ∈ [0, R_MAX]

# 4 段拐点 (r 值)
SEG_GENTLE_END = 0.5          # 平缓段结束
SEG_MID_END = 0.95            # 中速段结束
SEG_BRAKE_END = 1.0           # 刹车段结束 (= 破 PB 临界)

# 各段难度值边界
D_BASE = 0.20                 # r=0 时的最低难度
D_GENTLE_END = 0.30           # r=0.5
D_MID_END = 0.50              # r=0.95
D_BRAKE_END = 0.90            # r=1.0
D_CAP = 1.00                  # r→∞ 的渐近上界

# 刹车段 sigmoid 参数
BRAKE_SIGMOID_SLOPE = 40.0
BRAKE_SIGMOID_CENTER = 0.97   # 拐点在 r=0.97

# 超越 PB 段衰减
OVERSHOOT_DECAY = 3.0


def target_S_curve(r: float) -> float:
    """计算单点目标难度 D(r) ∈ [0, 1]。

    Args:
        r: 归一化进度 = score / PB,可为负或大于 1.5;函数会 clip。

    Returns:
        D ∈ [D_BASE, D_CAP] (主要在 [0.20, 1.00])
    """
    r = max(0.0, min(CURVE_R_MAX, float(r)))

    if r < SEG_GENTLE_END:
        # 平缓上升: D_BASE + slope·r
        slope = (D_GENTLE_END - D_BASE) / SEG_GENTLE_END
        return D_BASE + slope * r

    if r < SEG_MID_END:
        # 中速上升: D_GENTLE_END + slope·(r - 0.5)
        slope = (D_MID_END - D_GENTLE_END) / (SEG_MID_END - SEG_GENTLE_END)
        return D_GENTLE_END + slope * (r - SEG_GENTLE_END)

    if r < SEG_BRAKE_END:
        # 刹车段: smoothstep 平滑过渡 (端点严格 0/1, 保证分段连续)
        # smoothstep(t) = 3t² - 2t³, 在 t∈[0,1] 上从 0 平滑到 1
        t = (r - SEG_MID_END) / (SEG_BRAKE_END - SEG_MID_END)
        s = t * t * (3.0 - 2.0 * t)
        return D_MID_END + s * (D_BRAKE_END - D_MID_END)

    # 超越 PB: 指数收敛到 D_CAP
    extra = D_CAP - D_BRAKE_END
    return D_BRAKE_END + extra * (1.0 - math.exp(-OVERSHOOT_DECAY * (r - SEG_BRAKE_END)))


def target_curve_vector(n_bins: int = CURVE_N_BINS, r_max: float = CURVE_R_MAX) -> List[float]:
    """返回 d_curve 离散化后的 20 维目标向量。

    bin_i 对应 r 区间 [i/n_bins · r_max, (i+1)/n_bins · r_max),
    取区间中点作为代表 r 计算 D。
    """
    if n_bins <= 0:
        raise ValueError("n_bins must be positive")
    width = r_max / n_bins
    out = []
    for i in range(n_bins):
        r_mid = (i + 0.5) * width
        out.append(target_S_curve(r_mid))
    return out


def r_to_bin(r: float, n_bins: int = CURVE_N_BINS, r_max: float = CURVE_R_MAX) -> int:
    """把 r 值映射到 [0, n_bins-1] 的整数 bin index。

    r >= r_max 时返回 n_bins - 1 (最后一个 bin)。
    """
    r = max(0.0, float(r))
    width = r_max / n_bins
    idx = int(r / width)
    return min(idx, n_bins - 1)


def is_monotonic_non_decreasing(curve: List[float], tol: float = 1e-6) -> bool:
    """验证曲线是否单调非降 (用于测试)。"""
    for i in range(1, len(curve)):
        if curve[i] < curve[i - 1] - tol:
            return False
    return True


def get_target_metadata() -> dict:
    """返回曲线元信息 (用于日志/dashboard)。"""
    return {
        "version": "v2.0.0",
        "n_bins": CURVE_N_BINS,
        "r_max": CURVE_R_MAX,
        "segments": [
            {"name": "gentle", "r_range": [0.0, SEG_GENTLE_END], "d_range": [D_BASE, D_GENTLE_END]},
            {"name": "mid", "r_range": [SEG_GENTLE_END, SEG_MID_END], "d_range": [D_GENTLE_END, D_MID_END]},
            {"name": "brake", "r_range": [SEG_MID_END, SEG_BRAKE_END], "d_range": [D_MID_END, D_BRAKE_END]},
            {"name": "overshoot", "r_range": [SEG_BRAKE_END, CURVE_R_MAX], "d_range": [D_BRAKE_END, D_CAP]},
        ],
    }
