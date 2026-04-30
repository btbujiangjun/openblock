"""
与 web/src/clearScoring.js 对齐：近满同色的 dock 颜色软偏置（无放回抽三色）。

仅实现「无 blockIcons」路径（与 RL 网格一致）；用于 PyTorch 模拟器出块与主游戏统计一致。
"""

from __future__ import annotations

import random
from typing import List

from .grid import Grid

MONO_NEAR_FULL_COLOR_WEIGHT = 0.55


def _dock_slot(ci: int) -> int:
    return ((int(ci) % 8) + 8) % 8


def mono_near_full_line_color_weights(grid: Grid) -> List[float]:
    w: List[float] = [0.0] * 8
    n = grid.size
    for y in range(n):
        filled: list[int] = []
        for x in range(n):
            c = grid.cells[y][x]
            if c is not None:
                filled.append(int(c))
        empty = n - len(filled)
        if 1 <= empty <= 2 and filled and all(c == filled[0] for c in filled):
            w[_dock_slot(filled[0])] += MONO_NEAR_FULL_COLOR_WEIGHT
    for x in range(n):
        filled = []
        for y in range(n):
            c = grid.cells[y][x]
            if c is not None:
                filled.append(int(c))
        empty = n - len(filled)
        if 1 <= empty <= 2 and filled and all(c == filled[0] for c in filled):
            w[_dock_slot(filled[0])] += MONO_NEAR_FULL_COLOR_WEIGHT
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
