"""与 web/src/bot/features.js 一致的数值特征（常数来自 shared/game_rules.json）。"""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np

from .game_rules import FEATURE_ENCODING, rl_bonus_block_icons
from .shapes_data import get_all_shapes

_ENC = FEATURE_ENCODING
_AF = float(_ENC.get("almostFullLineRatio", 0.78))
_DOCK = float(_ENC.get("dockSlots", 3))
_AN = dict(_ENC.get("actionNorm") or {})
_MAX_GRID = int(_ENC.get("maxGridWidth", 8))
_DOCK_MASK_SIDE = int(_ENC.get("dockMaskSide", 5))
_DOCK_SLOTS = int(_ENC.get("dockSlots", 3))
_SCALAR_DIM = int(_ENC.get("stateScalarDim", 15))
_N_COLORS = int(_ENC.get("colorCount", 8))
_RL_BONUS_ICONS = rl_bonus_block_icons()

STATE_FEATURE_DIM = int(_ENC["stateDim"])
ACTION_FEATURE_DIM = int(_ENC["actionDim"])
PHI_DIM = int(_ENC.get("phiDim") or STATE_FEATURE_DIM + ACTION_FEATURE_DIM)

_GRID_FLAT = _MAX_GRID * _MAX_GRID
_DOCK_FLAT = _DOCK_SLOTS * _DOCK_MASK_SIDE * _DOCK_MASK_SIDE
_expected_state = _SCALAR_DIM + _GRID_FLAT + _DOCK_FLAT
if STATE_FEATURE_DIM != _expected_state:
    raise ValueError(
        f"game_rules featureEncoding.stateDim={STATE_FEATURE_DIM} 与 "
        f"stateScalarDim+grid²+dock 期望 {_expected_state} 不一致"
    )


def _std_dev(arr: Sequence[float]) -> float:
    if not arr:
        return 0.0
    m = sum(arr) / len(arr)
    v = sum((x - m) ** 2 for x in arr) / len(arr)
    return math.sqrt(v)


def _can_place_shape_at(grid, shape: list[list[int]], gx: int, gy: int) -> bool:
    for y, row in enumerate(shape):
        for x, v in enumerate(row):
            if not v:
                continue
            px, py = gx + x, gy + y
            if px < 0 or px >= grid.size or py < 0 or py >= grid.size:
                return False
            if grid.cells[py][px] is not None:
                return False
    return True


def count_unfillable_cells(grid, shapes: list[dict] | None = None) -> int:
    n = grid.size
    coverable = [[False] * n for _ in range(n)]
    for shape_info in shapes or get_all_shapes():
        shape = shape_info.get("data") if isinstance(shape_info, dict) else shape_info
        if not shape:
            continue
        h = len(shape)
        w = len(shape[0]) if h else 0
        for gy in range(0, n - h + 1):
            for gx in range(0, n - w + 1):
                if not _can_place_shape_at(grid, shape, gx, gy):
                    continue
                for sy, row in enumerate(shape):
                    for sx, v in enumerate(row):
                        if v:
                            coverable[gy + sy][gx + sx] = True
    return sum(
        1
        for y in range(n)
        for x in range(n)
        if grid.cells[y][x] is None and not coverable[y][x]
    )


def _encode_grid_occupancy(grid) -> np.ndarray:
    """行主序 flatten，棋盘置于左上角，不足 max 则右侧/下侧填 0。"""
    n = grid.size
    out = np.zeros((_MAX_GRID, _MAX_GRID), dtype=np.float32)
    for y in range(min(n, _MAX_GRID)):
        row = grid.cells[y]
        for x in range(min(n, _MAX_GRID)):
            out[y, x] = 1.0 if row[x] is not None else 0.0
    return out.reshape(-1)


def _encode_shape_mask(shape: list[list[int]]) -> np.ndarray:
    """将多连块置于 dockMaskSide×dockMaskSide 画布中心，行主序 1/0。"""
    h = len(shape)
    w = len(shape[0]) if h else 0
    side = _DOCK_MASK_SIDE
    canvas = np.zeros((side, side), dtype=np.float32)
    if h == 0 or w == 0:
        return canvas.reshape(-1)
    off_y = max(0, (side - h) // 2)
    off_x = max(0, (side - w) // 2)
    for py in range(h):
        for px in range(w):
            if shape[py][px]:
                cy, cx = off_y + py, off_x + px
                if 0 <= cy < side and 0 <= cx < side:
                    canvas[cy, cx] = 1.0
    return canvas.reshape(-1)


def _encode_dock_spatial(dock: list[dict]) -> np.ndarray:
    parts: list[np.ndarray] = []
    for i in range(_DOCK_SLOTS):
        if i < len(dock) and not dock[i].get("placed"):
            parts.append(_encode_shape_mask(dock[i]["shape"]))
        else:
            parts.append(np.zeros(_DOCK_MASK_SIDE * _DOCK_MASK_SIDE, dtype=np.float32))
    return np.concatenate(parts, axis=0)


def _encode_color_summary(grid, dock: list[dict]) -> np.ndarray:
    n = grid.size
    area = max(n * n, 1)
    color_counts = np.zeros(_N_COLORS, dtype=np.float32)
    mono_line_potential = np.zeros(_N_COLORS, dtype=np.float32)
    for y in range(n):
        for x in range(n):
            c = grid.cells[y][x]
            if c is not None and 0 <= int(c) < _N_COLORS:
                color_counts[int(c)] += 1.0
    for c in range(_N_COLORS):
        best = 0
        for y in range(n):
            row = grid.cells[y]
            if all(v is None or v == c for v in row):
                best = max(best, sum(1 for v in row if v == c))
        for x in range(n):
            col = [grid.cells[y][x] for y in range(n)]
            if all(v is None or v == c for v in col):
                best = max(best, sum(1 for v in col if v == c))
        mono_line_potential[c] = best / max(n, 1)
    dock_colors = np.zeros(_DOCK_SLOTS, dtype=np.float32)
    denom = max(_N_COLORS - 1, 1)
    for i in range(_DOCK_SLOTS):
        if i < len(dock) and not dock[i].get("placed"):
            dock_colors[i] = float(dock[i].get("color_idx", dock[i].get("colorIdx", 0))) / denom
    return np.concatenate([color_counts / area, mono_line_potential, dock_colors], axis=0)


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

    almost_full_rows = sum(1 for rf in row_fill if _AF <= rf < 1)
    almost_full_cols = sum(1 for cf in col_fill if _AF <= cf < 1)
    unplaced = sum(1 for b in dock if not b["placed"]) / _DOCK

    base_scalars = [
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
            min(count_unfillable_cells(grid) / float(_AN.get("maxHoles", 16)), 1.0),
            0.0,  # row transitions placeholder
            0.0,  # col transitions placeholder
            0.0,  # wells placeholder
            0.0,  # close1 placeholder
            0.0,  # close2 placeholder
            0.0,  # mobility placeholder
            filled / area,
        ]
    scalars = np.array(base_scalars + _encode_color_summary(grid, dock).tolist(), dtype=np.float32)
    if scalars.shape[0] != _SCALAR_DIM:
        raise ValueError(f"标量段长度 {scalars.shape[0]} != stateScalarDim {_SCALAR_DIM}")

    grid_flat = _encode_grid_occupancy(grid)
    dock_flat = _encode_dock_spatial(dock)
    return np.concatenate([scalars, grid_flat, dock_flat], axis=0)


def extract_action_features(
    state_feat: np.ndarray,
    block_idx: int,
    gx: int,
    gy: int,
    shape: list[list[int]],
    would_clear: int,
    grid_size: int,
    grid=None,
    dock: list[dict] | None = None,
    color_idx: int = 0,
) -> np.ndarray:
    cells = sum(1 for row in shape for c in row if c)
    h = len(shape)
    w = len(shape[0])
    div_b = float(_AN.get("maxBlockIndex", 3))
    div_sh = float(_AN.get("shapeSpan", 5))
    div_cells = float(_AN.get("maxCells", 10))
    div_clr = float(_AN.get("maxClearsHint", 5))
    unplaced_after = sum(1 for b in (dock or []) if not b.get("placed")) - 1
    multi_clear, bonus_line, perfect_clear = _clear_payoff_features(grid, shape, gx, gy, color_idx, div_clr)
    action_part = np.array(
        [
            block_idx / div_b,
            gx / grid_size,
            gy / grid_size,
            w / div_sh,
            h / div_sh,
            cells / div_cells,
            would_clear / div_clr,
            0.0,
            max(0, unplaced_after) / 3.0,
            0.0,
            max(gy + h, 0) / grid_size,
            0.0,
            multi_clear,
            bonus_line,
            perfect_clear,
        ],
        dtype=np.float32,
    )
    if action_part.shape[0] != ACTION_FEATURE_DIM:
        raise ValueError(f"动作特征长度 {action_part.shape[0]} != actionDim {ACTION_FEATURE_DIM}")
    return np.concatenate([state_feat, action_part], axis=0)


def _line_is_bonus(vals: list[int | None]) -> bool:
    if not vals or vals[0] is None:
        return False
    first = int(vals[0])
    if _RL_BONUS_ICONS:
        icon0 = _RL_BONUS_ICONS[first % len(_RL_BONUS_ICONS)]
        return all(v is not None and _RL_BONUS_ICONS[int(v) % len(_RL_BONUS_ICONS)] == icon0 for v in vals)
    return all(v == first for v in vals)


def _clear_payoff_features(
    grid,
    shape: list[list[int]],
    gx: int,
    gy: int,
    color_idx: int,
    div_clr: float,
) -> tuple[float, float, float]:
    if grid is None:
        return 0.0, 0.0, 0.0
    cells = [row[:] for row in grid.cells]
    for sy, row in enumerate(shape):
        for sx, v in enumerate(row):
            if v:
                cells[gy + sy][gx + sx] = int(color_idx)
    n = grid.size
    full_rows = [y for y in range(n) if all(c is not None for c in cells[y])]
    full_cols = [x for x in range(n) if all(cells[y][x] is not None for y in range(n))]
    clears = len(full_rows) + len(full_cols)
    if clears <= 0:
        return 0.0, 0.0, 0.0
    bonus = 0
    for y in full_rows:
        if _line_is_bonus(cells[y]):
            bonus += 1
    for x in full_cols:
        if _line_is_bonus([cells[y][x] for y in range(n)]):
            bonus += 1
    for y in full_rows:
        for x in range(n):
            cells[y][x] = None
    for x in full_cols:
        for y in range(n):
            cells[y][x] = None
    perfect = 1.0 if all(c is None for row in cells for c in row) else 0.0
    multi = min(max(clears - 1, 0) / max(div_clr - 1.0, 1.0), 1.0)
    return float(multi), float(min(bonus / max(div_clr, 1.0), 1.0)), perfect


def build_phi_batch(sim, legal: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """would_clear 与 web 端 countClearsIfPlaced 一致。sim: OpenBlockSimulator。"""
    state = extract_state_features(sim.grid, sim.dock)
    rows = []
    for a in legal:
        bi = a["block_idx"]
        wc = sim.count_clears_if_placed(bi, a["gx"], a["gy"])
        phi = extract_action_features(
            state,
            bi,
            a["gx"],
            a["gy"],
            sim.dock[bi]["shape"],
            wc,
            sim.grid.size,
            sim.grid,
            sim.dock,
            int(sim.dock[bi].get("color_idx", sim.dock[bi].get("colorIdx", 0))),
        )
        rows.append(phi)
    return state, np.stack(rows, axis=0) if rows else (state, np.zeros((0, PHI_DIM), dtype=np.float32))
