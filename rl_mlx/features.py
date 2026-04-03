"""与 web/src/bot/features.js 一致的数值特征。"""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np

# 与 web 端 extractStateFeatures 实际长度一致（features.js 中 STATE_FEATURE_DIM 常量曾误为 14）
STATE_FEATURE_DIM = 15
ACTION_FEATURE_DIM = 7
PHI_DIM = STATE_FEATURE_DIM + ACTION_FEATURE_DIM


def _std_dev(arr: Sequence[float]) -> float:
    if not arr:
        return 0.0
    m = sum(arr) / len(arr)
    v = sum((x - m) ** 2 for x in arr) / len(arr)
    return math.sqrt(v)


def extract_state_features(grid, dock: list[dict]) -> np.ndarray:
    n = grid.size
    area = n * n
    filled = 0
    row_fill: list[float] = []
    for y in range(n):
        r = sum(1 for x in range(n) if grid.cells[y][x] is not None)
        filled += int(r)
        row_fill.append(r / n)

    col_fill: list[float] = []
    for x in range(n):
        c = sum(1 for y in range(n) if grid.cells[y][x] is not None)
        col_fill.append(c / n)

    max_row = max(row_fill) if row_fill else 0.0
    min_row = min(row_fill) if row_fill else 0.0
    max_col = max(col_fill) if col_fill else 0.0
    min_col = min(col_fill) if col_fill else 0.0

    almost_full_rows = sum(1 for rf in row_fill if 0.78 <= rf < 1)
    almost_full_cols = sum(1 for cf in col_fill if 0.78 <= cf < 1)
    unplaced = sum(1 for b in dock if not b["placed"]) / 3.0

    return np.array(
        [
            filled / area,
            max_row,
            min_row,
            max_col,
            min_col,
            almost_full_rows / n,
            almost_full_cols / n,
            unplaced,
            sum(row_fill) / n,
            sum(col_fill) / n,
            _std_dev(row_fill),
            _std_dev(col_fill),
            max_row - min_row,
            max_col - min_col,
            (almost_full_rows + almost_full_cols) / (2 * n),
        ],
        dtype=np.float32,
    )


def extract_action_features(
    state_feat: np.ndarray,
    block_idx: int,
    gx: int,
    gy: int,
    shape: list[list[int]],
    would_clear: int,
    grid_size: int,
) -> np.ndarray:
    cells = sum(1 for row in shape for c in row if c)
    h = len(shape)
    w = len(shape[0])
    action_part = np.array(
        [
            block_idx / 3.0,
            gx / grid_size,
            gy / grid_size,
            w / 5.0,
            h / 5.0,
            cells / 10.0,
            would_clear / 5.0,
        ],
        dtype=np.float32,
    )
    return np.concatenate([state_feat, action_part], axis=0)


def build_phi_batch(sim, legal: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """would_clear 与 web 端 countClearsIfPlaced 一致。sim: BlockBlastSimulator。"""
    state = extract_state_features(sim.grid, sim.dock)
    rows = []
    for a in legal:
        bi = a["block_idx"]
        wc = sim.count_clears_if_placed(bi, a["gx"], a["gy"])
        phi = extract_action_features(
            state, bi, a["gx"], a["gy"], sim.dock[bi]["shape"], wc, sim.grid.size
        )
        rows.append(phi)
    return state, np.stack(rows, axis=0) if rows else (state, np.zeros((0, PHI_DIM), dtype=np.float32))
