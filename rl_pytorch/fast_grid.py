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
    """返回空格能否被任一合法形状覆盖的 bool 矩阵。

    向量化实现：对每个形状，positions(N×2) 与 cells(M×2) 做广播得到所有覆盖坐标
    (N·M×2)，一次性写入 coverable，避免逐行 Python 解包（旧实现三层循环在近空棋盘
    合法位置上百时会组合爆炸，单步特征提取退化到秒级）。
    """
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
        if len(cells) == 0:
            continue
        # (N,1) + (1,M) -> (N,M)，展平后批量写入；positions 来自合法枚举，gy+sy/gx+sx 必在界内
        ys = (positions[:, 0][:, None] + cells[:, 0][None, :]).ravel()
        xs = (positions[:, 1][:, None] + cells[:, 1][None, :]).ravel()
        valid = (ys >= 0) & (ys < n) & (xs >= 0) & (xs < n)
        coverable[ys[valid], xs[valid]] = True
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


def place_and_clear_np(
    grid_np: np.ndarray,
    shape_np: np.ndarray,
    gx: int,
    gy: int,
) -> tuple[np.ndarray, int]:
    """numpy 原生「放置 + 消行」，返回 (新棋盘, 消行数)。

    与 Grid.place + Grid.check_lines 语义逐位一致：先按占用计算满行/满列，
    清行数 = 满行数 + 满列数（交叉格只清一次），再把满行满列整体置空。
    替代 spawn_construction 里 clone()+place()+check_lines() 的纯 Python 热路径。
    """
    n = grid_np.shape[0]
    g = grid_np.copy()
    cells = np.argwhere(shape_np > 0)
    if len(cells):
        ys = gy + cells[:, 0]
        xs = gx + cells[:, 1]
        g[ys, xs] = 0  # 占用（颜色 0，仅占位语义）
    occ = g >= 0
    full_rows = np.where(occ.all(axis=1))[0]
    full_cols = np.where(occ.all(axis=0))[0]
    clears = int(len(full_rows) + len(full_cols))
    if clears:
        if len(full_rows):
            g[full_rows, :] = -1
        if len(full_cols):
            g[:, full_cols] = -1
    return g, clears


def best_placement_np(
    grid_np: np.ndarray,
    shape_np: np.ndarray,
) -> tuple[int, int, int] | None:
    """返回使消行数最大的放置 (gx, gy, clears)；无合法位置返回 None。

    向量化等价于旧 _find_best_placement 的 n² can_place + clone 扫描。
    tie-break：get_legal_positions 以 (gy, gx) 行主序枚举，argmax 取首个最大值，
    与旧实现「gy 外层 gx 内层、严格 > 更新」的选择一致。
    """
    positions = get_legal_positions(grid_np, shape_np)
    if len(positions) == 0:
        return None
    clears = batch_count_clears(grid_np, shape_np, positions)
    i = int(np.argmax(clears))
    return int(positions[i, 1]), int(positions[i, 0]), int(clears[i])


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

    # 暴露边（吸附/贴合约束用）：占用区朝向「界内空格」的 4-邻接边数（墙边不计 → 贴墙=吸附）。
    # = 不含墙 padding 的行列跳变；越小说明方块越贴边/贴块、悬空孤立越少。
    edge_exposure = int(
        np.sum(occ[:, :-1] != occ[:, 1:]) + np.sum(occ[:-1, :] != occ[1:, :])
    )

    # 客观难度·几何：空白连通块数 / 凹角数（与 web/src/boardTopology.js 同口径）。
    contiguous_regions = _contiguous_regions(occ_bool)
    concave_corners = _concave_corners(occ_bool)

    # 列高标准差（top-profile）：与 web/src/bot/features.js heightStd 同口径——
    # 每列从顶部数最低被占用行得到列高 (n - first_occupied_row)，空列高 0。
    col_heights = np.zeros(n, dtype=np.float32)
    for x in range(n):
        occ_rows = np.where(occ_bool[:, x])[0]
        if occ_rows.size:
            col_heights[x] = n - int(occ_rows[0])
    height_std = float((col_heights / n).std())

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
        "edge_exposure": edge_exposure,
        "contiguous_regions": contiguous_regions,
        "concave_corners": concave_corners,
        "height_std": height_std,
    }


def _contiguous_regions(occ_bool: np.ndarray) -> int:
    """空白（~occ）4-连通分量数 —— 与 boardTopology.js countEmptyRegions 同口径。"""
    n = occ_bool.shape[0]
    visited = np.zeros((n, n), dtype=bool)
    regions = 0
    stack: list[tuple[int, int]] = []
    for sy in range(n):
        for sx in range(n):
            if occ_bool[sy, sx] or visited[sy, sx]:
                continue
            regions += 1
            stack.append((sy, sx))
            visited[sy, sx] = True
            while stack:
                cy, cx = stack.pop()
                for ny, nx in ((cy - 1, cx), (cy + 1, cx), (cy, cx - 1), (cy, cx + 1)):
                    if 0 <= ny < n and 0 <= nx < n and not visited[ny, nx] and not occ_bool[ny, nx]:
                        visited[ny, nx] = True
                        stack.append((ny, nx))
    return int(regions)


def _concave_corners(occ_bool: np.ndarray) -> int:
    """凹角数 —— 与 boardTopology.js countConcaveCorners 同口径（越界视为未占用）。"""
    n = occ_bool.shape[0]

    def occ(y: int, x: int) -> bool:
        return 0 <= y < n and 0 <= x < n and bool(occ_bool[y, x])

    count = 0
    for y in range(n):
        for x in range(n):
            if occ_bool[y, x]:
                continue
            for dy, dx in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                if occ(y + dy, x) and occ(y, x + dx):
                    count += 1
    return int(count)


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
    holes, row_trans, col_trans, wells, close1, close2, mobility, fill_ratio,
    contiguous_regions, concave_corners。
    """
    n = grid_np.shape[0]
    feats = fast_board_features(grid_np)
    norm = action_norm or {}
    max_holes = float(norm.get("maxHoles", 16))
    max_trans = float(norm.get("maxTransitions", 64))
    max_wells = float(norm.get("maxWellDepth", 24))
    max_mob = float(norm.get("maxMobility", 192))
    max_regions = float(norm.get("maxEmptyRegions", 16))
    max_concave = float(norm.get("maxConcaveCorners", 32))
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
            min(float(feats["contiguous_regions"]) / max(max_regions, 1.0), 1.0),
            min(float(feats["concave_corners"]) / max(max_concave, 1.0), 1.0),
        ],
        dtype=np.float32,
    )
