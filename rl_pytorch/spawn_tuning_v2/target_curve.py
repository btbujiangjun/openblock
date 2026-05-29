"""
目标 S 曲线 (业务目标量化的数学表达)。

核心命题: 让玩家"接近 PB 但难以超越,偶有惊喜"。
对应到 r = score/PB 的归一化进度上, 目标难度 D(r) 应满足:

  r < 0.45         : D 在 [0.10, 0.11],  近似平台 (远离 PB, 低压力)
  r ∈ [0.45, 0.65) : D 在 [0.11, 0.18],  轻缓抬升 (开始进入节奏)
  r ∈ [0.65, 1.15): D 在 [0.18, 0.98],  重缩放 sigmoid (r=1≈0.90, PB 两侧陡升)
  r ≥ 1.15         : D 在 [0.98, 1.00],  指数加压收敛 (超越 PB, 顶部平滑饱和)

v2.3 改进 (相对 v2.0):
  - r_max 从 1.5 提升到 2.0 (支持高超越场景)
  - brake 段拓宽 0.05 → 0.25, 让 20-bin 离散化能展开 3 个 bin, 视觉平滑
  - brake 段用"端点重缩放的 logistic sigmoid"代替 smoothstep, C∞ 光滑
  - OVERSHOOT_DECAY 3.0 → 6.0, r=1.5 时 D ≈ 0.995, r=2.0 时 D ≈ 1.0
v2.4 改进:
  - 低 r 阶段整体下移 (0.20→0.14, 0.30→0.24), 让远离 PB 的早期体验更轻
  - 中段端点 0.50→0.46, 保持低段到刹车段的过渡尽量平滑
v2.5 改进:
  - 参考红线形态: 低 r 长平台 + 延后启动 + 接近 PB 前后快速上冲
  - 顶部保持 1.0 收敛, 但主要跃迁窗口右移到 [0.75, 1.30]
v2.6 改进:
  - 按红线约束 r=1 时 D≈0.9
  - 陡升窗口调整为 [0.65, 1.15], 提高 r=1 两侧斜率, 增加突破 PB 难度

设计哲学:
  - 4 段分段函数, 各段端点严格连续
  - 单调非降 (除 surprise 噪声, 数学曲线本身严格非降)
  - 全部参数有业务含义,可解释
"""
from __future__ import annotations
import math
from typing import List

# ─────────── 常量 ───────────

CURVE_N_BINS = 20             # d_curve 离散化点数
CURVE_R_MAX = 2.0             # r ∈ [0, R_MAX]; v2.3: 1.5 → 2.0 支持高超越场景

# 4 段拐点 (r 值)
SEG_GENTLE_END = 0.45         # 低压平台结束; v2.5 参考红线延后启动
SEG_MID_END = 0.65            # 轻缓抬升结束; v2.6 让 PB 前进入陡升
SEG_BRAKE_END = 1.15          # 快速加压段结束; v2.6 让 r=1 位于陡升高位

# 各段难度值边界
D_BASE = 0.10                 # r=0 时的最低难度; v2.5: 红线低平台
D_GENTLE_END = 0.11           # r=0.45; 低压阶段近似水平
D_MID_END = 0.18              # r=0.65; 陡升前保持较低
D_BRAKE_END = 0.98            # r=1.15; 接近顶部
D_CAP = 1.00                  # r→∞ 的渐近上界

# 刹车段重缩放 logistic sigmoid 斜率 (k 越大越陡; v2.6 要求 r=1≈0.9 且两侧陡峭)
BRAKE_SIGMOID_K = 10.5

# 超越 PB 段衰减; v2.3: 3.0 → 6.0 让 r=1.5 时 D 已接近 1.0
OVERSHOOT_DECAY = 6.0


def _brake_smooth(r: float) -> float:
    """重缩放的 logistic sigmoid: 在 [SEG_MID_END, SEG_BRAKE_END] 上严格端点 0/1。

    比 smoothstep (3t² - 2t³) 更光滑 (C∞ vs C¹), 视觉更柔和。
    """
    t = (r - SEG_MID_END) / (SEG_BRAKE_END - SEG_MID_END)  # t ∈ [0, 1]
    k = BRAKE_SIGMOID_K
    raw = 1.0 / (1.0 + math.exp(-k * (t - 0.5)))
    # 边界值 (raw 在 t=0 / t=1 时的值, 用于重缩放)
    s0 = 1.0 / (1.0 + math.exp(k * 0.5))
    s1 = 1.0 / (1.0 + math.exp(-k * 0.5))
    return (raw - s0) / (s1 - s0)


def target_S_curve(r: float) -> float:
    """计算单点目标难度 D(r) ∈ [0, 1]。

    Args:
        r: 归一化进度 = score / PB; 函数会 clip 到 [0, CURVE_R_MAX]。

    Returns:
        D ∈ [D_BASE, D_CAP] (主要在 [0.10, 1.00])
    """
    r = max(0.0, min(CURVE_R_MAX, float(r)))

    if r < SEG_GENTLE_END:
        # 平缓上升: D_BASE + slope·r
        slope = (D_GENTLE_END - D_BASE) / SEG_GENTLE_END
        return D_BASE + slope * r

    if r < SEG_MID_END:
        # 中速上升
        slope = (D_MID_END - D_GENTLE_END) / (SEG_MID_END - SEG_GENTLE_END)
        return D_GENTLE_END + slope * (r - SEG_GENTLE_END)

    if r < SEG_BRAKE_END:
        # 刹车段: 重缩放 logistic sigmoid 平滑过渡
        s = _brake_smooth(r)
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
        "version": "v2.6.0",
        "n_bins": CURVE_N_BINS,
        "r_max": CURVE_R_MAX,
        "segments": [
            {"name": "gentle", "r_range": [0.0, SEG_GENTLE_END], "d_range": [D_BASE, D_GENTLE_END]},
            {"name": "mid", "r_range": [SEG_GENTLE_END, SEG_MID_END], "d_range": [D_GENTLE_END, D_MID_END]},
            {"name": "brake", "r_range": [SEG_MID_END, SEG_BRAKE_END], "d_range": [D_MID_END, D_BRAKE_END]},
            {"name": "overshoot", "r_range": [SEG_BRAKE_END, CURVE_R_MAX], "d_range": [D_BRAKE_END, D_CAP]},
        ],
    }
