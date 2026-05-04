"""Numpy-accelerated grid operations — 替代 Python 逐格循环，加速 RL 采集。

核心加速点（按耗时排序）：
  1. get_legal_positions    : sliding_window_view + einsum 替代 192 次 can_place
  2. batch_count_clears     : 向量化行列满判定替代逐动作 clone+check
  3. fast_board_features    : 向量化空洞/跳变/井/近满统计
  4. grid_to_np / np_to_grid: Grid ↔ numpy 零拷贝桥接
"""

from __future__ import annotations

import numpy as np
from numpy.lib.stride_tricks import sliding_window_view

from .shapes_data import get_all_shapes


def grid_to_np(grid) -> np.ndarray:
    """Grid.cells → int8 numpy array。occupied ≥ 0，empty = -1。"""
    n = grid.size
    arr = np.full((n, n), -1, dtype=np.int8)
    for y in range(n):
        row = grid.cells[y]
        for x in range(n):
            if row[x] is not None:
                arr[y, x] = row[x]
    return arr


def occupied_mask(grid_np: np.ndarray) -> np.ndarray:
    return (grid_np >= 0).view(np.uint8)


def shape_to_np(shape_data: list[list[int]]) -> np.ndarray:
    return np.asarray(shape_data, dtype=np.uint8)


def count_unfillable_cells(grid_np: np.ndarray, shapes: list[dict] | None = None) -> int:
    """统计没有任何可用形状能合法覆盖的空格数。

    OpenBlock 的块可从任意位置落下，因此空洞定义不采用“上方有块、下方为空”的列高口径。
    只有结合完整形状库仍无法触达的空格，才计为真实空洞。
    """
    coverable = coverable_cells(grid_np, shapes)
    return int(((grid_np < 0) & ~coverable).sum())


def coverable_cells(grid_np: np.ndarray, shapes: list[dict] | None = None) -> np.ndarray:
    """返回空格能否被任一合法形状覆盖的 bool 矩阵。"""
    n = grid_np.shape[0]
    coverable = np.zeros((n, n), dtype=bool)
    for shape in shapes or get_all_shapes():
        data = shape.get("data") if isinstance(shape, dict) else shape
        if data is None:
            continue
        shp = shape_to_np(data)
        positions = get_legal_positions(grid_np, shp)
        if len(positions) == 0:
            continue
        cells = np.argwhere(shp > 0)
        for gy, gx in positions:
            for sy, sx in cells:
                y = int(gy + sy)
                x = int(gx + sx)
                if 0 <= y < n and 0 <= x < n:
                    coverable[y, x] = True
    return coverable


# ---------------------------------------------------------------------------
# 合法动作枚举  — sliding_window_view 一次算完所有 can_place
# ---------------------------------------------------------------------------

def get_legal_positions(grid_np: np.ndarray, shape_np: np.ndarray) -> np.ndarray:
    """返回 shape 在 grid 上所有可放位置 (gy, gx) 的 Nx2 int32 数组。

    原理：occupied[gy:gy+h, gx:gx+w] 与 shape 逐元素乘积求和 == 0 即无重叠。
    sliding_window_view 把所有窗口拉成 4D 张量，einsum 一次算完。
    """
    n = grid_np.shape[0]
    h, w = shape_np.shape
    if h > n or w > n or h == 0 or w == 0:
        return np.empty((0, 2), dtype=np.int32)

    occ = occupied_mask(grid_np)
    windows = sliding_window_view(occ, (h, w))
    overlaps = np.einsum("ijkl,kl->ij", windows, shape_np)
    return np.argwhere(overlaps == 0).astype(np.int32)


def get_all_legal_actions(grid_np: np.ndarray, dock: list[dict]) -> list[dict]:
    """替代 OpenBlockSimulator.get_legal_actions 的向量化版本。"""
    actions: list[dict] = []
    for bi, b in enumerate(dock):
        if b.get("placed"):
            continue
        shape_np = shape_to_np(b["shape"])
        positions = get_legal_positions(grid_np, shape_np)
        for gy, gx in positions:
            actions.append({"block_idx": bi, "gx": int(gx), "gy": int(gy)})
    return actions


# ---------------------------------------------------------------------------
# 批量消行预测  — 向量化替代 N 次 _count_clears_fast
# ---------------------------------------------------------------------------

def batch_count_clears(
    grid_np: np.ndarray,
    shape_np: np.ndarray,
    positions: np.ndarray,
) -> np.ndarray:
    """对同一 shape 的多个放置位置，一次计算各自的消行数。

    positions: Mx2 array of (gy, gx)
    返回: M 长度 int32 数组
    """
    n = grid_np.shape[0]
    P = len(positions)
    if P == 0:
        return np.array([], dtype=np.int32)

    occ = occupied_mask(grid_np)
    row_counts = occ.sum(axis=1, dtype=np.int32)
    col_counts = occ.sum(axis=0, dtype=np.int32)

    shape_cells = np.argwhere(shape_np > 0)
    k = len(shape_cells)
    if k == 0:
        return np.zeros(P, dtype=np.int32)
    sy = shape_cells[:, 0]
    sx = shape_cells[:, 1]

    gy = positions[:, 0]
    gx = positions[:, 1]
    py = gy[:, None] + sy[None, :]  # [P, k]
    px = gx[:, None] + sx[None, :]  # [P, k]

    is_new = (occ[py.ravel(), px.ravel()] == 0).reshape(P, k)

    row_delta = np.zeros((P, n), dtype=np.int32)
    col_delta = np.zeros((P, n), dtype=np.int32)
    for j in range(k):
        idx = np.where(is_new[:, j])[0]
        if len(idx) > 0:
            np.add.at(row_delta, (idx, py[idx, j]), 1)
            np.add.at(col_delta, (idx, px[idx, j]), 1)

    new_rows = row_counts[None, :] + row_delta
    new_cols = col_counts[None, :] + col_delta
    full_rows = (new_rows >= n).sum(axis=1)
    full_cols = (new_cols >= n).sum(axis=1)
    return (full_rows + full_cols).astype(np.int32)


def count_clears_single(
    grid_np: np.ndarray,
    shape_np: np.ndarray,
    gx: int,
    gy: int,
) -> int:
    """单次消行计算（无需 clone grid）。"""
    n = grid_np.shape[0]
    occ = occupied_mask(grid_np)
    h, w = shape_np.shape

    row_counts = occ.sum(axis=1, dtype=np.int32)
    col_counts = occ.sum(axis=0, dtype=np.int32)

    clears = 0
    for sy in range(h):
        for sx in range(w):
            if shape_np[sy, sx] == 0:
                continue
            py, px_ = gy + sy, gx + sx
            if occ[py, px_] == 0:
                row_counts[py] += 1
                col_counts[px_] += 1

    for r in range(n):
        if row_counts[r] >= n:
            clears += 1
    for c in range(n):
        if col_counts[c] >= n:
            clears += 1
    return clears


# ---------------------------------------------------------------------------
# 向量化棋盘分析特征  — 替代 features.py 中的 Python 循环
# ---------------------------------------------------------------------------

def fast_board_features(grid_np: np.ndarray) -> dict:
    """一次 numpy 调用返回所有棋盘结构特征。"""
    n = grid_np.shape[0]
    occ = occupied_mask(grid_np)
    area = n * n

    filled = int(occ.sum())
    row_fill = occ.sum(axis=1).astype(np.float32) / n
    col_fill = occ.sum(axis=0).astype(np.float32) / n

    max_row = float(row_fill.max())
    min_row = float(row_fill.min())
    max_col = float(col_fill.max())
    min_col = float(col_fill.min())
    mean_row = float(row_fill.mean())
    mean_col = float(col_fill.mean())
    std_row = float(row_fill.std())
    std_col = float(col_fill.std())

    occ_bool = occ.astype(bool)

    # 空洞：结合完整形状库，统计没有任何合法放置能覆盖的空格。
    coverable = coverable_cells(grid_np)
    holes = int(((grid_np < 0) & ~coverable).sum())

    # 行列跳变（向量化）：pad 边界为 occupied，统计相邻差异
    padded_h = np.pad(occ, ((0, 0), (1, 1)), constant_values=1)
    row_trans = int(np.sum(padded_h[:, :-1] != padded_h[:, 1:]))
    padded_v = np.pad(occ, ((1, 1), (0, 0)), constant_values=1)
    col_trans = int(np.sum(padded_v[:-1, :] != padded_v[1:, :]))

    # 井深（向量化）：空格且左右邻居（或边界）均为 occupied
    left_nb = np.pad(occ, ((0, 0), (1, 0)), constant_values=1)[:, :-1].astype(bool)
    right_nb = np.pad(occ, ((0, 0), (0, 1)), constant_values=1)[:, 1:].astype(bool)
    wells = int((~occ_bool & left_nb & right_nb).sum())

    # 差 1/2 格满
    af = 0.78
    almost_full_rows = 0
    almost_full_cols = 0
    close1 = 0
    close2 = 0

    for y in range(n):
        empty = np.where(grid_np[y, :] < 0)[0]
        empty_count = len(empty)
        fillable = empty_count > 0 and bool(coverable[y, empty].all())
        if fillable and row_fill[y] >= af and row_fill[y] < 1.0:
            almost_full_rows += 1
        if fillable and empty_count == 1:
            close1 += 1
        elif fillable and empty_count == 2:
            close2 += 1

    for x in range(n):
        empty = np.where(grid_np[:, x] < 0)[0]
        empty_count = len(empty)
        fillable = empty_count > 0 and bool(coverable[empty, x].all())
        if fillable and col_fill[x] >= af and col_fill[x] < 1.0:
            almost_full_cols += 1
        if fillable and empty_count == 1:
            close1 += 1
        elif fillable and empty_count == 2:
            close2 += 1

    return {
        "filled": filled,
        "area": area,
        "row_fill": row_fill,
        "col_fill": col_fill,
        "max_row": max_row,
        "min_row": min_row,
        "max_col": max_col,
        "min_col": min_col,
        "mean_row": mean_row,
        "mean_col": mean_col,
        "std_row": std_row,
        "std_col": std_col,
        "almost_full_rows": almost_full_rows,
        "almost_full_cols": almost_full_cols,
        "holes": holes,
        "row_trans": row_trans,
        "col_trans": col_trans,
        "wells": wells,
        "close1": close1,
        "close2": close2,
    }


def fast_dock_mobility(grid_np: np.ndarray, dock: list[dict]) -> int:
    """向量化 dock 机动性计算。"""
    total = 0
    for b in dock:
        if b.get("placed"):
            continue
        positions = get_legal_positions(grid_np, shape_to_np(b["shape"]))
        total += len(positions)
    return total


def topology_aux_targets(grid_np: np.ndarray, dock: list[dict], action_norm: dict | None = None) -> np.ndarray:
    """归一化拓扑分量，作为动作后辅助监督目标。

    顺序固定为：
    holes, row_trans, col_trans, wells, close1, close2, mobility, fill_ratio。
    """
    n = grid_np.shape[0]
    feats = fast_board_features(grid_np)
    norm = action_norm or {}
    max_holes = float(norm.get("maxHoles", 16))
    max_trans = float(norm.get("maxTransitions", 64))
    max_wells = float(norm.get("maxWellDepth", 24))
    max_mob = float(norm.get("maxMobility", 192))
    return np.asarray(
        [
            min(float(feats["holes"]) / max(max_holes, 1.0), 1.0),
            min(float(feats["row_trans"]) / max(max_trans, 1.0), 1.0),
            min(float(feats["col_trans"]) / max(max_trans, 1.0), 1.0),
            min(float(feats["wells"]) / max(max_wells, 1.0), 1.0),
            min(float(feats["close1"]) / max(float(n), 1.0), 1.0),
            min(float(feats["close2"]) / max(float(n), 1.0), 1.0),
            min(float(fast_dock_mobility(grid_np, dock)) / max(max_mob, 1.0), 1.0),
            min(float(feats["filled"]) / max(float(feats["area"]), 1.0), 1.0),
        ],
        dtype=np.float32,
    )
