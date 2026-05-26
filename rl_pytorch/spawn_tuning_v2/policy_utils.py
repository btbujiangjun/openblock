"""v2.10.7: policy 后处理工具 — 让导出的 policies 满足业务硬约束。

模型预测的 d_curve 已经接近 S 形, 但因数据噪声 + 训练随机性,
可能有局部小违规 (例如 r=1.4 → 1.5 下降 0.07)。
客户端策略需要"严格单调", 否则玩家在 PB 附近会感到"难度反向跳变"。

本模块提供 inference-time 后处理, 在 build-and-export 阶段调用,
让 bundle 中的 policies 100% 满足业务硬约束:
  1. 单调非降 (接近 PB 加压, 超 PB 持续高位)
  2. 头尾 clip 到合理区间

跨语言: web/src/tuning/v2 暂不复制 (这里只在 backend bundle 生成时调用)
"""
from __future__ import annotations
from typing import List, Tuple


def isotonic_regression_pava(values: List[float], weights: List[float] = None) -> List[float]:
    """Pool Adjacent Violators 算法 — 最优单调非降回归。

    给定 (values, weights), 找出最接近的单调非降序列 (L2 意义最小)。
    比简单 cummax 更平滑 — 它平均化违规区域而不是"硬压"。

    复杂度: O(n)
    引用: Wikipedia "Isotonic regression"

    Args:
        values: 待回归的序列, e.g. [0.3, 0.5, 0.45, 0.6, 0.55]
        weights: 每个点的权重 (默认全 1)
    Returns:
        单调非降序列, e.g. [0.3, 0.475, 0.475, 0.575, 0.575]
    """
    n = len(values)
    if n == 0:
        return []
    if weights is None:
        weights = [1.0] * n
    elif len(weights) != n:
        raise ValueError("weights length must match values")

    # 栈式 PAVA: 每个"池"含 (val, weight)
    stack_vals: List[float] = []
    stack_wts: List[float] = []
    for v, w in zip(values, weights):
        cur_v, cur_w = float(v), float(w)
        # 跟栈顶比较, 违规则合并
        while stack_vals and stack_vals[-1] > cur_v:
            top_v = stack_vals.pop()
            top_w = stack_wts.pop()
            new_w = top_w + cur_w
            cur_v = (top_v * top_w + cur_v * cur_w) / new_w
            cur_w = new_w
        stack_vals.append(cur_v)
        stack_wts.append(cur_w)

    # 展开栈到原长度
    out: List[float] = []
    for v, w in zip(stack_vals, stack_wts):
        out.extend([v] * int(round(w)))
    # 长度安全 (浮点 weights 可能导致少 1 个)
    if len(out) < n:
        out.extend([stack_vals[-1]] * (n - len(out)))
    return out[:n]


def monotonic_project_curve(curve: List[float], clip_min: float = 0.0, clip_max: float = 1.0) -> Tuple[List[float], int]:
    """v2.10.7: 让 d_curve 严格单调非降, 同时 clip 到 [clip_min, clip_max]。

    Args:
        curve: 长度 20 的 d_curve
        clip_min/max: 限制范围 (默认 [0, 1])
    Returns:
        (修正后的 curve, 违规 bin 数)

    使用:
      在 build-and-export 中对每个 predicted_curve 调用, 保证导出 bundle
      满足客户端 "S 形难度递增" 硬约束。
    """
    if not curve:
        return [], 0
    # 1. clip
    clipped = [max(clip_min, min(clip_max, float(v))) for v in curve]
    # 2. PAVA 单调投影
    fixed = isotonic_regression_pava(clipped)
    # 3. 统计违规数 (跟原 curve 差距 > 1e-6 的 bin)
    n_violations = sum(1 for a, b in zip(clipped, fixed) if abs(a - b) > 1e-6)
    return fixed, n_violations


def max_monotonic_violation(curve: List[float]) -> float:
    """计算最大相邻倒退幅度 (curve[i] - curve[i+1] 的最大正值, 全单调时返回 0)。"""
    if len(curve) < 2:
        return 0.0
    return max(
        (max(0.0, curve[i] - curve[i + 1]) for i in range(len(curve) - 1)),
        default=0.0,
    )
