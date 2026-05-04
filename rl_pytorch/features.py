"""与 web/src/bot/features.js 一致的数值特征（常数来自 shared/game_rules.json）。

v6: 内部热路径使用 fast_grid numpy 加速，外部接口不变。
"""

from __future__ import annotations


import numpy as np

from .game_rules import FEATURE_ENCODING
from . import fast_grid as _fg

_ENC = FEATURE_ENCODING
_AF = float(_ENC.get("almostFullLineRatio", 0.78))
_DOCK = float(_ENC.get("dockSlots", 3))
_AN = dict(_ENC.get("actionNorm") or {})
_MAX_GRID = int(_ENC.get("maxGridWidth", 8))
_DOCK_MASK_SIDE = int(_ENC.get("dockMaskSide", 5))
_DOCK_SLOTS = int(_ENC.get("dockSlots", 3))
_SCALAR_DIM = int(_ENC.get("stateScalarDim", 23))
_N_COLORS = int(_ENC.get("colorCount", 8))

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



def _encode_grid_occupancy(grid) -> np.ndarray:
    """行主序 flatten，棋盘置于左上角，不足 max 则右侧/下侧填 0。"""
    gnp = _fg.grid_to_np(grid)
    n = grid.size
    out = np.zeros((_MAX_GRID, _MAX_GRID), dtype=np.float32)
    m = min(n, _MAX_GRID)
    out[:m, :m] = (gnp[:m, :m] >= 0).astype(np.float32)
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
    """颜色摘要：棋盘颜色占比、同色线潜力、dock 颜色。

    网格主体仍保留 0/1 占用输入，颜色只作为标量注入，避免改 CNN 通道。
    """
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
            dock_colors[i] = float(dock[i].get("color_idx", 0)) / denom

    return np.concatenate([color_counts / area, mono_line_potential, dock_colors], axis=0)


# ---------------------------------------------------------------------------
# 棋盘结构分析 — 代理到 fast_grid numpy 实现
# ---------------------------------------------------------------------------

def _board_features_cached(grid, dock: list[dict]) -> dict:
    """一次调用返回所有棋盘结构特征 + mobility（内部缓存 grid→numpy）。"""
    gnp = _fg.grid_to_np(grid)
    bf = _fg.fast_board_features(gnp)
    bf["mobility"] = _fg.fast_dock_mobility(gnp, dock)
    bf["_grid_np"] = gnp
    return bf


# ---------------------------------------------------------------------------
# 状态特征提取
# ---------------------------------------------------------------------------

def extract_state_features(grid, dock: list[dict]) -> np.ndarray:
    n = grid.size
    area = n * n
    bf = _board_features_cached(grid, dock)

    row_fill = bf["row_fill"]
    col_fill = bf["col_fill"]
    unplaced = sum(1 for b in dock if not b["placed"]) / _DOCK

    max_holes = float(_AN.get("maxHoles", 16))
    max_trans = float(_AN.get("maxTransitions", 64))
    max_wells = float(_AN.get("maxWellDepth", 24))
    max_mob = float(_AN.get("maxMobility", 192))

    base_scalars = [
            bf["filled"] / area,
            bf["max_row"],
            bf["min_row"],
            bf["max_col"],
            bf["min_col"],
            bf["almost_full_rows"] / n,
            bf["almost_full_cols"] / n,
            unplaced,
            bf["mean_row"],
            bf["mean_col"],
            bf["std_row"],
            bf["std_col"],
            bf["max_row"] - bf["min_row"],
            bf["max_col"] - bf["min_col"],
            (bf["almost_full_rows"] + bf["almost_full_cols"]) / (2 * n),
            min(bf["holes"] / max_holes, 1.0),
            min(bf["row_trans"] / max_trans, 1.0),
            min(bf["col_trans"] / max_trans, 1.0),
            min(bf["wells"] / max_wells, 1.0),
            min(bf["close1"] / n, 1.0),
            min(bf["close2"] / n, 1.0),
            min(bf["mobility"] / max_mob, 1.0),
            bf["filled"] / area,
        ]
    scalars = np.array(base_scalars + _encode_color_summary(grid, dock).tolist(), dtype=np.float32)
    if scalars.shape[0] != _SCALAR_DIM:
        raise ValueError(f"标量段长度 {scalars.shape[0]} != stateScalarDim {_SCALAR_DIM}")

    grid_flat = _encode_grid_occupancy(grid)
    dock_flat = _encode_dock_spatial(dock)
    return np.concatenate([scalars, grid_flat, dock_flat], axis=0)


# ---------------------------------------------------------------------------
# 动作特征提取
# ---------------------------------------------------------------------------

_NF_THR = float(_AN.get("nearFullThreshold", 0.75))


def _near_full_ratio_np(occ: np.ndarray, shape_np: np.ndarray, gx: int, gy: int) -> float:
    n = occ.shape[0]
    threshold = _NF_THR * n
    row_counts = occ.sum(axis=1)
    col_counts = occ.sum(axis=0)
    cells_yx = np.argwhere(shape_np > 0)
    if len(cells_yx) == 0:
        return 0.0
    total = len(cells_yx)
    count = 0
    for sy, sx in cells_yx:
        py, px_ = gy + sy, gx + sx
        if row_counts[py] >= threshold or col_counts[px_] >= threshold:
            count += 1
    return count / total


def _adjacent_occupied_np(occ: np.ndarray, shape_np: np.ndarray, gx: int, gy: int) -> int:
    n = occ.shape[0]
    cells_yx = np.argwhere(shape_np > 0)
    if len(cells_yx) == 0:
        return 0
    block_mask = np.zeros((n, n), dtype=np.uint8)
    adj = 0
    for sy, sx in cells_yx:
        block_mask[gy + sy, gx + sx] = 1
    for sy, sx in cells_yx:
        py, px_ = gy + sy, gx + sx
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
            ny, nx = py + dy, px_ + dx
            if 0 <= ny < n and 0 <= nx < n and not block_mask[ny, nx] and occ[ny, nx]:
                adj += 1
    return adj


def _holes_after_np(grid_np: np.ndarray, shape_np: np.ndarray, gx: int, gy: int) -> int:
    after = grid_np.copy()
    cells_yx = np.argwhere(shape_np > 0)
    for sy, sx in cells_yx:
        after[gy + sy, gx + sx] = 0
    n = after.shape[0]
    occ = _fg.occupied_mask(after)
    row_full = occ.sum(axis=1) >= n
    col_full = occ.sum(axis=0) >= n
    after[row_full, :] = -1
    after[:, col_full] = -1
    return _fg.count_unfillable_cells(after)


_DIV_B = float(_AN.get("maxBlockIndex", 3))
_DIV_SH = float(_AN.get("shapeSpan", 5))
_DIV_CELLS = float(_AN.get("maxCells", 10))
_DIV_CLR = float(_AN.get("maxClearsHint", 5))
_DIV_ADJ = float(_AN.get("maxAdjacent", 20))


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
    shape_np = _fg.shape_to_np(shape)
    cells = int(shape_np.sum())
    h, w = shape_np.shape
    base = [
        block_idx / _DIV_B,
        gx / grid_size,
        gy / grid_size,
        w / _DIV_SH,
        h / _DIV_SH,
        cells / _DIV_CELLS,
        would_clear / _DIV_CLR,
    ]
    if grid is not None:
        occ = _fg.occupied_mask(_fg.grid_to_np(grid))
        nf = _near_full_ratio_np(occ, shape_np, gx, gy)
        unplaced_after = sum(1 for b in (dock or []) if not b.get("placed")) - 1
        blocks_remain = max(0, unplaced_after) / 3.0
        adj = min(_adjacent_occupied_np(occ, shape_np, gx, gy) / _DIV_ADJ, 1.0)
        max_h_after = max(gy + h, 0) / grid_size
        holes_risk = min(_holes_after_np(_fg.grid_to_np(grid), shape_np, gx, gy) / float(_AN.get("maxHoles", 16)), 1.0)
        base.extend([nf, blocks_remain, adj, max_h_after, holes_risk])
    else:
        base.extend([0.0, 0.0, 0.0, 0.0, 0.0])
    action_part = np.array(base, dtype=np.float32)
    return np.concatenate([state_feat, action_part], axis=0)


def build_phi_batch(sim, legal: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """v6: numpy 向量化批量特征提取，batch_count_clears 替代逐动作调用。"""
    state = extract_state_features(sim.grid, sim.dock)
    if not legal:
        return state, np.zeros((0, PHI_DIM), dtype=np.float32)

    clears = sim.batch_count_clears(legal)
    gnp = sim._ensure_grid_np()
    occ = _fg.occupied_mask(gnp)
    n = sim.grid.size

    row_counts = occ.sum(axis=1)
    col_counts = occ.sum(axis=0)
    nf_thr = _NF_THR * n

    rows = []
    for i, a in enumerate(legal):
        bi = a["block_idx"]
        gx, gy = a["gx"], a["gy"]
        shape = sim.dock[bi]["shape"]
        shape_np = _fg.shape_to_np(shape)
        cells_count = int(shape_np.sum())
        h, w = shape_np.shape
        wc = int(clears[i])

        cells_yx = np.argwhere(shape_np > 0)
        nf_count = 0
        adj_count = 0
        for sy, sx in cells_yx:
            py, px_ = gy + sy, gx + sx
            if row_counts[py] >= nf_thr or col_counts[px_] >= nf_thr:
                nf_count += 1
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = py + dy, px_ + dx
                if 0 <= ny < n and 0 <= nx < n and occ[ny, nx]:
                    is_block = False
                    for sy2, sx2 in cells_yx:
                        if gy + sy2 == ny and gx + sx2 == nx:
                            is_block = True
                            break
                    if not is_block:
                        adj_count += 1

        nf = nf_count / max(cells_count, 1)
        unplaced_after = sum(1 for b in sim.dock if not b.get("placed")) - 1
        blocks_remain = max(0, unplaced_after) / 3.0
        adj = min(adj_count / _DIV_ADJ, 1.0)
        max_h_after = max(gy + h, 0) / n
        holes_risk = min(_holes_after_np(gnp, shape_np, gx, gy) / float(_AN.get("maxHoles", 16)), 1.0)

        action_part = np.array([
            bi / _DIV_B, gx / n, gy / n, w / _DIV_SH, h / _DIV_SH,
            cells_count / _DIV_CELLS, wc / _DIV_CLR,
            nf, blocks_remain, adj, max_h_after, holes_risk,
        ], dtype=np.float32)
        rows.append(np.concatenate([state, action_part], axis=0))

    return state, np.stack(rows, axis=0)
