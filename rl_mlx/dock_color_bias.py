"""与 web/src/clearScoring.js / rl_pytorch/dock_color_bias.py 对齐（MLX 包独立副本）。

v1.60.26 拓宽（与 web 同步）：
  - 旧版：仅 empty ∈ [1, 2] 时加 bias（"立即兑现期"）
  - 新版：empty ∈ [1, n-2] 且已填部分全同 icon 时加 bias
  - bias 衰减：empty 越大权重越低；empty=1/2 维持 0.55，empty 增大时按线性递减到 0.15
"""

from __future__ import annotations

import random
from typing import List

from .grid import Grid

MONO_NEAR_FULL_COLOR_WEIGHT = 0.55


def _dock_slot(ci: int) -> int:
    return ((int(ci) % 8) + 8) % 8


def _bias_for_empty(empty: int, n: int) -> float:
    """v1.60.26 同步：根据 empty 数计算 bias 权重。"""
    if empty < 1 or empty > n - 2:
        return 0.0
    if empty <= 2:
        return MONO_NEAR_FULL_COLOR_WEIGHT
    buildup_max = 0.40
    buildup_min = 0.15
    t = (empty - 3) / max(1, n - 5)
    t = max(0.0, min(1.0, t))
    return buildup_max - (buildup_max - buildup_min) * t


def mono_near_full_line_color_weights(grid: Grid, block_icons: list[str] | None = None) -> List[float]:
    w: List[float] = [0.0] * 8
    n = grid.size

    def get_icon(ci: int) -> str | None:
        if not block_icons:
            return None
        bi = block_icons
        return str(bi[int(ci) % len(bi)])

    def add_weights_for_line(filled_vals: list[int], bias_weight: float) -> None:
        if not filled_vals or bias_weight <= 0:
            return
        icon0 = get_icon(filled_vals[0])
        mono_icon = icon0 is not None and all(get_icon(c) == icon0 for c in filled_vals)
        mono_color = icon0 is None and all(c == filled_vals[0] for c in filled_vals)
        if not mono_icon and not mono_color:
            return
        if mono_icon:
            distinct = sorted({_dock_slot(c) for c in filled_vals})
            share = bias_weight / max(len(distinct), 1)
            for s in distinct:
                w[s] += share
        else:
            w[_dock_slot(filled_vals[0])] += bias_weight

    for y in range(n):
        filled: list[int] = []
        for x in range(n):
            c = grid.cells[y][x]
            if c is not None:
                filled.append(int(c))
        empty = n - len(filled)
        if 1 <= empty <= n - 2:
            add_weights_for_line(filled, _bias_for_empty(empty, n))
    for x in range(n):
        filled = []
        for y in range(n):
            c = grid.cells[y][x]
            if c is not None:
                filled.append(int(c))
        empty = n - len(filled)
        if 1 <= empty <= n - 2:
            add_weights_for_line(filled, _bias_for_empty(empty, n))
    return w


def pick_three_dock_colors(
    bias: List[float],
    n_colors: int = 8,
    rng: random.Random | None = None,
) -> List[int]:
    rnd = (rng or random).random
    pool = list(range(int(n_colors)))
    out: List[int] = []
    for _ in range(3):
        total = 0.0
        for c in pool:
            b = float(bias[c]) if c < len(bias) else 0.0
            total += 1.0 + b
        r = rnd() * total
        chosen = pool[0]
        for c in pool:
            b = float(bias[c]) if c < len(bias) else 0.0
            r -= 1.0 + b
            if r <= 0:
                chosen = c
                break
        out.append(chosen)
        pool.remove(chosen)
    return out
