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


# ─────────── v1.68 (PR3) arc-aware 形变常量 ───────────
#
# 把"局间 RunOverRunArc"作为乘性形变层叠加在基线 S 曲线之上。
# 每档 arc 给 (dScale, dShift, brakeShift) 三元组：
#   dScale     ：基线 D 的乘性因子（≤1 整体压低）
#   dShift     ：在 dScale 之后的加性偏移
#   brakeShift ：brake 段拐点 r 的右移量（让"接近 PB 才感到压力"语义生效）
#
# 与 web/src/tuning/v2/targetSCurve.js 的 ARC_MODIFIERS 1:1 对齐；
# 任何修改必须同步更新两端 + 跨语言测试 test_cross_lang_dcurve.py。
ARC_MODIFIERS = {
    "opener":   {"dScale": 0.90, "dShift":  0.00, "brakeShift": 0.00},
    "momentum": {"dScale": 1.00, "dShift":  0.00, "brakeShift": 0.00},
    "peak":     {"dScale": 1.00, "dShift":  0.00, "brakeShift": 0.00},
    "fatigue":  {"dScale": 0.85, "dShift": -0.03, "brakeShift": 0.15},
    "cooldown": {"dScale": 0.75, "dShift": -0.05, "brakeShift": 0.20},
}
_IDENTITY_MOD = {"dScale": 1.0, "dShift": 0.0, "brakeShift": 0.0}


def get_arc_modifier(arc):
    """取出某档 arc 的修饰；未知 arc 返回恒等修饰（向后兼容）。"""
    if not arc:
        return _IDENTITY_MOD
    return ARC_MODIFIERS.get(arc, _IDENTITY_MOD)


def _brake_smooth_at(r: float, mid_end: float, brake_end: float) -> float:
    """重缩放的 logistic sigmoid: 在 [mid_end, brake_end] 上严格端点 0/1。

    比 smoothstep (3t² - 2t³) 更光滑 (C∞ vs C¹), 视觉更柔和。
    """
    t = (r - mid_end) / (brake_end - mid_end)
    k = BRAKE_SIGMOID_K
    raw = 1.0 / (1.0 + math.exp(-k * (t - 0.5)))
    s0 = 1.0 / (1.0 + math.exp(k * 0.5))
    s1 = 1.0 / (1.0 + math.exp(-k * 0.5))
    return (raw - s0) / (s1 - s0)


def _brake_smooth(r: float) -> float:
    """旧接口保留：基线 brake 平滑函数（无 brakeShift），供历史调用方使用。"""
    return _brake_smooth_at(r, SEG_MID_END, SEG_BRAKE_END)


def _target_S_curve_base(r: float) -> float:
    """基线 D 曲线（不带 arc 形变）；v1.68 之前为 target_S_curve 的唯一实现。"""
    r = max(0.0, min(CURVE_R_MAX, float(r)))
    if r < SEG_GENTLE_END:
        slope = (D_GENTLE_END - D_BASE) / SEG_GENTLE_END
        return D_BASE + slope * r
    if r < SEG_MID_END:
        slope = (D_MID_END - D_GENTLE_END) / (SEG_MID_END - SEG_GENTLE_END)
        return D_GENTLE_END + slope * (r - SEG_GENTLE_END)
    if r < SEG_BRAKE_END:
        s = _brake_smooth_at(r, SEG_MID_END, SEG_BRAKE_END)
        return D_MID_END + s * (D_BRAKE_END - D_MID_END)
    extra = D_CAP - D_BRAKE_END
    return D_BRAKE_END + extra * (1.0 - math.exp(-OVERSHOOT_DECAY * (r - SEG_BRAKE_END)))


def target_S_curve(r: float) -> float:
    """计算单点目标难度 D(r) ∈ [0, 1]。

    v1.68 保持完全的语义稳定：对原 target_S_curve(r) 的调用方完全透明，不会因
    RunOverRunArc 注入而产生静默漂移；需要 arc 行为时显式走 target_S_curve_by_arc。

    Args:
        r: 归一化进度 = score / PB; 函数会 clip 到 [0, CURVE_R_MAX]。

    Returns:
        D ∈ [D_BASE, D_CAP] (主要在 [0.10, 1.00])
    """
    return _target_S_curve_base(r)


def target_S_curve_by_arc(r: float, arc) -> float:
    """v1.68 arc-aware 形变 D 曲线（与 web/src/tuning/v2/targetSCurve.js 1:1 一致）。

    把基线 S 曲线套上 (dScale, dShift, brakeShift) 三参数：
      1. brakeShift 把 SEG_MID_END / SEG_BRAKE_END 同步右移，让 fatigue/cooldown 下
         "接近 PB 才感到压力"语义生效；左侧 gentle 段端点保持不变，brake 段被压缩
         在更窄的 r 区间内，斜率自然变陡（与设计意图一致）。
      2. dScale 乘性压低输出（fatigue ×0.85 / cooldown ×0.75）。
      3. dShift 加性下移并最终 clip 到 [0, D_CAP]。

    出现 brakeEnd > CURVE_R_MAX 时直接 clip 到 CURVE_R_MAX，让顶部仍收敛。
    """
    mod = get_arc_modifier(arc)
    if (mod is _IDENTITY_MOD) or (mod["dScale"] == 1 and mod["dShift"] == 0 and mod["brakeShift"] == 0):
        return _target_S_curve_base(r)

    r = max(0.0, min(CURVE_R_MAX, float(r)))
    mid_end = min(CURVE_R_MAX, SEG_MID_END + mod["brakeShift"])
    brake_end = min(CURVE_R_MAX, SEG_BRAKE_END + mod["brakeShift"])

    if r < SEG_GENTLE_END:
        slope = (D_GENTLE_END - D_BASE) / SEG_GENTLE_END
        d = D_BASE + slope * r
    elif r < mid_end:
        slope = (D_MID_END - D_GENTLE_END) / max(1e-9, mid_end - SEG_GENTLE_END)
        d = D_GENTLE_END + slope * (r - SEG_GENTLE_END)
    elif r < brake_end:
        s = _brake_smooth_at(r, mid_end, brake_end)
        d = D_MID_END + s * (D_BRAKE_END - D_MID_END)
    else:
        extra = D_CAP - D_BRAKE_END
        d = D_BRAKE_END + extra * (1.0 - math.exp(-OVERSHOOT_DECAY * (r - brake_end)))

    out = d * mod["dScale"] + mod["dShift"]
    return max(0.0, min(D_CAP, out))


# ═════════════════════════════════════════════════════════════════════
# v3.2 多曲线 (multi-head): 难度 D(r) 之外的爽感 E(r) 与挫败 F(r)。
#
# 业务命题拆成三条正交体验曲线 (都是 r = score/PB 上的 20-bin 目标):
#   D(r) 难度  —— "接近 PB 难超越" (上面的 S 曲线, 主轴)
#   E(r) 爽感  —— "全程有适度爽感, 接近/突破 PB 时达到峰值" (PB 处高斯凸起)
#   F(r) 挫败  —— "挫败始终低且有硬上限" (低基线 + 缓升 + cap)
#
# 与 web/src/tuning/v2/targetSCurve.js 的 target_e/f 1:1 对齐;
# 任何修改必须同步两端 + 跨语言测试 test_cross_lang_dcurve.py。
# ═════════════════════════════════════════════════════════════════════

# E 爽感: 基线 + PB 处高斯凸起
E_BASE = 0.20            # 全程基线爽感率
E_PEAK = 0.40            # 接近/突破 PB 的峰值爽感率
E_BUMP_CENTER = 1.00     # 峰值位置 (r=1 = 玩家分数 = PB)
E_BUMP_WIDTH = 0.40      # 高斯宽度

# F 挫败: 低基线 + 缓升 + 硬上限
F_BASE = 0.08            # r=0 的最低挫败
F_RISE = 0.22            # 缓升幅度 (F_BASE + F_RISE = 0.30 = cap)
F_CAP = 0.30             # 挫败硬上限 (业务红线: "挫败有上限")
F_RISE_START = 0.80      # 缓升起点 (接近 PB 才开始累积挫败)
F_RISE_END = 1.60        # 缓升终点 (高超 PB 段挫败到顶)


def _smoothstep01(t: float) -> float:
    """clamp 到 [0,1] 后的 smoothstep 3t²-2t³。"""
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def target_E_curve(r: float) -> float:
    """爽感目标 E(r) ∈ [E_BASE, E_PEAK]: 基线 + PB 处高斯凸起。"""
    r = max(0.0, min(CURVE_R_MAX, float(r)))
    bump = math.exp(-((r - E_BUMP_CENTER) / E_BUMP_WIDTH) ** 2)
    return E_BASE + (E_PEAK - E_BASE) * bump


def target_F_curve(r: float) -> float:
    """挫败目标 F(r) ∈ [F_BASE, F_CAP]: 低基线 + 缓升, 硬 clip 到 cap。"""
    r = max(0.0, min(CURVE_R_MAX, float(r)))
    t = (r - F_RISE_START) / max(1e-9, F_RISE_END - F_RISE_START)
    return min(F_CAP, F_BASE + F_RISE * _smoothstep01(t))


def target_E_vector(n_bins: int = CURVE_N_BINS, r_max: float = CURVE_R_MAX) -> List[float]:
    """E(r) 离散化为 20 维目标向量 (bin 中点取值)。"""
    width = r_max / n_bins
    return [target_E_curve((i + 0.5) * width) for i in range(n_bins)]


def target_F_vector(n_bins: int = CURVE_N_BINS, r_max: float = CURVE_R_MAX) -> List[float]:
    """F(r) 离散化为 20 维目标向量 (bin 中点取值)。"""
    width = r_max / n_bins
    return [target_F_curve((i + 0.5) * width) for i in range(n_bins)]


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
