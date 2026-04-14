"""与 web/src/bot/features.js 一致的数值特征（常数来自 shared/game_rules.json）。"""

from __future__ import annotations

import math
from typing import Sequence

import numpy as np

from .game_rules import FEATURE_ENCODING

_ENC = FEATURE_ENCODING
_AF = float(_ENC.get("almostFullLineRatio", 0.78))
_DOCK = float(_ENC.get("dockSlots", 3))
_AN = dict(_ENC.get("actionNorm") or {})
_MAX_GRID = int(_ENC.get("maxGridWidth", 8))
_DOCK_MASK_SIDE = int(_ENC.get("dockMaskSide", 5))
_DOCK_SLOTS = int(_ENC.get("dockSlots", 3))
_SCALAR_DIM = int(_ENC.get("stateScalarDim", 23))

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


# ---------------------------------------------------------------------------
# 棋盘结构分析辅助函数
# ---------------------------------------------------------------------------

def _count_holes(grid) -> int:
    """空洞 = 上方（同列）有已占格子的空格数。"""
    n = grid.size
    holes = 0
    for x in range(n):
        block_found = False
        for y in range(n):
            if grid.cells[y][x] is not None:
                block_found = True
            elif block_found:
                holes += 1
    return holes


def _count_transitions(grid) -> tuple[int, int]:
    """行跳变 = 行内 occupied ↔ empty 的边界数；列跳变同理。"""
    n = grid.size
    row_trans = 0
    col_trans = 0
    for y in range(n):
        prev = True  # 边界视为 occupied
        for x in range(n):
            cur = grid.cells[y][x] is not None
            if cur != prev:
                row_trans += 1
            prev = cur
        if not prev:
            row_trans += 1
    for x in range(n):
        prev = True
        for y in range(n):
            cur = grid.cells[y][x] is not None
            if cur != prev:
                col_trans += 1
            prev = cur
        if not prev:
            col_trans += 1
    return row_trans, col_trans


def _well_depth_sum(grid) -> int:
    """各列 "井" 深度之和：连续空格且两侧（或墙壁）都被占用。"""
    n = grid.size
    total = 0
    for x in range(n):
        for y in range(n):
            if grid.cells[y][x] is not None:
                continue
            left_blocked = x == 0 or grid.cells[y][x - 1] is not None
            right_blocked = x == n - 1 or grid.cells[y][x + 1] is not None
            if left_blocked and right_blocked:
                total += 1
    return total


def _lines_close_to_clear(grid) -> tuple[int, int]:
    """差 1 格和差 2 格就满的行/列数。"""
    n = grid.size
    close1 = 0
    close2 = 0
    for y in range(n):
        filled = sum(1 for x in range(n) if grid.cells[y][x] is not None)
        if filled == n - 1:
            close1 += 1
        elif filled == n - 2:
            close2 += 1
    for x in range(n):
        filled = sum(1 for y in range(n) if grid.cells[y][x] is not None)
        if filled == n - 1:
            close1 += 1
        elif filled == n - 2:
            close2 += 1
    return close1, close2


def _dock_mobility(grid, dock: list[dict]) -> int:
    """三个待选块的总合法放置位置数。"""
    n = grid.size
    total = 0
    for b in dock:
        if b.get("placed"):
            continue
        shape = b["shape"]
        for gy in range(n):
            for gx in range(n):
                if grid.can_place(shape, gx, gy):
                    total += 1
    return total


# ---------------------------------------------------------------------------
# 状态特征提取
# ---------------------------------------------------------------------------

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

    holes = _count_holes(grid)
    row_trans, col_trans = _count_transitions(grid)
    wells = _well_depth_sum(grid)
    close1, close2 = _lines_close_to_clear(grid)
    mobility = _dock_mobility(grid, dock)

    max_holes = float(_AN.get("maxHoles", 16))
    max_trans = float(_AN.get("maxTransitions", 64))
    max_wells = float(_AN.get("maxWellDepth", 24))
    max_mob = float(_AN.get("maxMobility", 192))

    scalars = np.array(
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
            # --- 8 new features ---
            min(holes / max_holes, 1.0),
            min(row_trans / max_trans, 1.0),
            min(col_trans / max_trans, 1.0),
            min(wells / max_wells, 1.0),
            min(close1 / n, 1.0),
            min(close2 / n, 1.0),
            min(mobility / max_mob, 1.0),
            filled / area,  # max_height proxy: reuse fill ratio (cheap)
        ],
        dtype=np.float32,
    )
    if scalars.shape[0] != _SCALAR_DIM:
        raise ValueError(f"标量段长度 {scalars.shape[0]} != stateScalarDim {_SCALAR_DIM}")

    grid_flat = _encode_grid_occupancy(grid)
    dock_flat = _encode_dock_spatial(dock)
    return np.concatenate([scalars, grid_flat, dock_flat], axis=0)


# ---------------------------------------------------------------------------
# 动作特征提取
# ---------------------------------------------------------------------------

def _near_full_ratio(grid, shape: list[list[int]], gx: int, gy: int) -> float:
    """放块后有多少格子落在填充率 ≥ 0.75 的行/列上（占 block cells 比例）。"""
    n = grid.size
    threshold = float(_AN.get("nearFullThreshold", 0.75)) * n
    cells = grid.cells
    count = 0
    total = 0
    for sy, row in enumerate(shape):
        for sx, v in enumerate(row):
            if not v:
                continue
            total += 1
            py, px = gy + sy, gx + sx
            row_fill = sum(1 for x2 in range(n) if cells[py][x2] is not None)
            col_fill = sum(1 for y2 in range(n) if cells[y2][px] is not None)
            if row_fill >= threshold or col_fill >= threshold:
                count += 1
    return count / max(total, 1)


def _adjacent_occupied(grid, shape: list[list[int]], gx: int, gy: int) -> int:
    """放块后各 cell 四邻中已被占据的数量合计。"""
    n = grid.size
    cells = grid.cells
    adj = 0
    block_set: set[tuple[int, int]] = set()
    for sy, row in enumerate(shape):
        for sx, v in enumerate(row):
            if v:
                block_set.add((gy + sy, gx + sx))
    for (py, px) in block_set:
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = py + dy, px + dx
            if 0 <= ny < n and 0 <= nx < n and (ny, nx) not in block_set and cells[ny][nx] is not None:
                adj += 1
    return adj


def _covers_holes(grid, shape: list[list[int]], gx: int, gy: int) -> int:
    """放块格子下方（同列）有空洞的数量。"""
    n = grid.size
    cells = grid.cells
    count = 0
    for sy, row in enumerate(shape):
        for sx, v in enumerate(row):
            if not v:
                continue
            px = gx + sx
            py = gy + sy
            for below in range(py + 1, n):
                if cells[below][px] is None:
                    count += 1
                    break
    return count


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
) -> np.ndarray:
    """12 维动作特征（v4）：原 7 + 5 棋盘交互特征。grid/dock 可选，传入时才计算后 5 维。"""
    cells = sum(1 for row in shape for c in row if c)
    h = len(shape)
    w = len(shape[0])
    div_b = float(_AN.get("maxBlockIndex", 3))
    div_sh = float(_AN.get("shapeSpan", 5))
    div_cells = float(_AN.get("maxCells", 10))
    div_clr = float(_AN.get("maxClearsHint", 5))
    div_adj = float(_AN.get("maxAdjacent", 20))
    base = [
        block_idx / div_b,
        gx / grid_size,
        gy / grid_size,
        w / div_sh,
        h / div_sh,
        cells / div_cells,
        would_clear / div_clr,
    ]
    if grid is not None:
        nf = _near_full_ratio(grid, shape, gx, gy)
        unplaced_after = sum(1 for b in (dock or []) if not b.get("placed")) - 1
        blocks_remain = max(0, unplaced_after) / 3.0
        adj = min(_adjacent_occupied(grid, shape, gx, gy) / div_adj, 1.0)
        max_h_after = max(gy + h, 0) / grid_size
        holes_risk = min(_covers_holes(grid, shape, gx, gy) / max(cells, 1), 1.0)
        base.extend([nf, blocks_remain, adj, max_h_after, holes_risk])
    else:
        base.extend([0.0, 0.0, 0.0, 0.0, 0.0])
    action_part = np.array(base, dtype=np.float32)
    return np.concatenate([state_feat, action_part], axis=0)


def build_phi_batch(sim, legal: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """v4: 传入 grid/dock 计算棋盘交互特征（无 grid.clone）。"""
    state = extract_state_features(sim.grid, sim.dock)
    rows = []
    for a in legal:
        bi = a["block_idx"]
        wc = sim.count_clears_if_placed(bi, a["gx"], a["gy"])
        phi = extract_action_features(
            state, bi, a["gx"], a["gy"], sim.dock[bi]["shape"], wc, sim.grid.size,
            grid=sim.grid, dock=sim.dock,
        )
        rows.append(phi)
    if rows:
        return state, np.stack(rows, axis=0)
    return state, np.zeros((0, PHI_DIM), dtype=np.float32)
