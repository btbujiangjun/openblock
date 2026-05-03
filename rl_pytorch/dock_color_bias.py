"""
与 web/src/clearScoring.js monoNearFullLineColorWeights 对齐：近满线 dock 颜色软偏置。

block_icons 非空时走「同 icon」判定（与 detectBonusLines 一致）；否则同色（默认 RL=titanium 无 icon）。
"""

from __future__ import annotations

import random
from typing import List

from .grid import Grid

MONO_NEAR_FULL_COLOR_WEIGHT = 0.55


def _dock_slot(ci: int) -> int:
    return ((int(ci) % 8) + 8) % 8


def mono_near_full_line_color_weights(grid: Grid, block_icons: list[str] | None = None) -> List[float]:
    w: List[float] = [0.0] * 8
    n = grid.size

    def get_icon(ci: int) -> str | None:
        if not block_icons:
            return None
        bi = block_icons
        return str(bi[int(ci) % len(bi)])

    def add_weights_for_near_full_line(filled_vals: list[int]) -> None:
        if not filled_vals:
            return
        icon0 = get_icon(filled_vals[0])
        mono_icon = icon0 is not None and all(get_icon(c) == icon0 for c in filled_vals)
        mono_color = icon0 is None and all(c == filled_vals[0] for c in filled_vals)
        if not mono_icon and not mono_color:
            return
        if mono_icon:
            distinct = sorted({ _dock_slot(c) for c in filled_vals })
            share = MONO_NEAR_FULL_COLOR_WEIGHT / max(len(distinct), 1)
            for s in distinct:
                w[s] += share
        else:
            w[_dock_slot(filled_vals[0])] += MONO_NEAR_FULL_COLOR_WEIGHT

    for y in range(n):
        filled: list[int] = []
        for x in range(n):
            c = grid.cells[y][x]
            if c is not None:
                filled.append(int(c))
        empty = n - len(filled)
        if 1 <= empty <= 2:
            add_weights_for_near_full_line(filled)
    for x in range(n):
        filled = []
        for y in range(n):
            c = grid.cells[y][x]
            if c is not None:
                filled.append(int(c))
        empty = n - len(filled)
        if 1 <= empty <= 2:
            add_weights_for_near_full_line(filled)
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
