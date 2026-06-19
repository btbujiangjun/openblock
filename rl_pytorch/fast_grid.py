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

# scipy.ndimage.label 用于空白连通分量计数（_contiguous_regions），不可用时回退纯 Python DFS。
try:
    from scipy.ndimage import label as _ndimage_label
except Exception:  # pragma: no cover - scipy 缺失时优雅降级
    _ndimage_label = None

# Numba JIT：8×8 小数组上 numpy 单次派发开销就是地板（实测纯 numpy 向量化仅 ~1.08×），
# 唯有把热核编译成原生循环才能拿到数量级提升（消除 ufunc/argwhere/add.at 的 Python 派发）。
# 不可用时所有热核都有等价 numpy 回退（见各函数 else 分支），保证零依赖可运行。
import os as _os

if _os.environ.get("RL_NO_NUMBA", "").strip().lower() in ("1", "true", "yes", "on"):
    _HAS_NUMBA = False  # 显式关闭（A/B 对比或排障逃生口）
else:
    try:
        from numba import njit as _njit
        _HAS_NUMBA = True
    except Exception:  # pragma: no cover - numba 缺失时优雅降级到 numpy
        _HAS_NUMBA = False

if not _HAS_NUMBA:

    def _njit(*args, **kwargs):  # type: ignore
        def _deco(fn):
            return fn
        if args and callable(args[0]):
            return args[0]
        return _deco


if _HAS_NUMBA:

    @_njit(cache=True)
    def _legal_positions_kernel(occ, shape):  # occ:uint8[n,n], shape:uint8[h,w]
        """枚举 shape 所有无重叠放置 (gy,gx)，行优先（gy 外 gx 内）与 np.argwhere 同序。"""
        n = occ.shape[0]
        h = shape.shape[0]
        w = shape.shape[1]
        out = np.empty((n * n, 2), np.int32)
        cnt = 0
        for gy in range(n - h + 1):
            for gx in range(n - w + 1):
                ok = True
                for sy in range(h):
                    for sx in range(w):
                        if shape[sy, sx] and occ[gy + sy, gx + sx]:
                            ok = False
                            break
                    if not ok:
                        break
                if ok:
                    out[cnt, 0] = gy
                    out[cnt, 1] = gx
                    cnt += 1
        return out[:cnt].copy()

    @_njit(cache=True)
    def _batch_count_clears_kernel(occ, sy, sx, positions, row_counts, col_counts):
        """对同一 shape 的 P 个放置位置逐个算消行数（满行数+满列数），与 numpy 版逐元素等价。"""
        n = occ.shape[0]
        k = sy.shape[0]
        P = positions.shape[0]
        out = np.empty(P, np.int32)
        rd = np.zeros(n, np.int32)
        cd = np.zeros(n, np.int32)
        for p in range(P):
            gy = positions[p, 0]
            gx = positions[p, 1]
            for i in range(n):
                rd[i] = 0
                cd[i] = 0
            for j in range(k):
                py = gy + sy[j]
                px = gx + sx[j]
                if occ[py, px] == 0:  # 仅新增占用格计入增量（与 is_new 掩码一致）
                    rd[py] += 1
                    cd[px] += 1
            fr = 0
            fc = 0
            for i in range(n):
                if row_counts[i] + rd[i] >= n:
                    fr += 1
                if col_counts[i] + cd[i] >= n:
                    fc += 1
            out[p] = fr + fc
        return out

    @_njit(cache=True)
    def _board_features_kernel(grid, coverable):
        """一次原生遍历算出 fast_board_features 的全部结构特征。

        grid:int32[n,n]（occupied≥0,empty<0），coverable:uint8[n,n]（空格可被覆盖标记）。
        返回与 numpy 版逐字段对齐的元组（整数特征精确等价，浮点特征数值等价）。
        """
        n = grid.shape[0]
        af = 0.78
        # 占用/空格 + 行列计数
        row_sum = np.zeros(n, np.int32)
        col_sum = np.zeros(n, np.int32)
        filled = 0
        holes = 0
        for y in range(n):
            for x in range(n):
                if grid[y, x] >= 0:
                    row_sum[y] += 1
                    col_sum[x] += 1
                    filled += 1
                else:
                    if coverable[y, x] == 0:
                        holes += 1
        row_fill = np.empty(n, np.float32)
        col_fill = np.empty(n, np.float32)
        for i in range(n):
            row_fill[i] = row_sum[i] / n
            col_fill[i] = col_sum[i] / n
        # 行列 min/max/mean/std（总体方差 ddof=0）
        max_row = row_fill[0]; min_row = row_fill[0]
        max_col = col_fill[0]; min_col = col_fill[0]
        srow = 0.0; scol = 0.0
        for i in range(n):
            if row_fill[i] > max_row: max_row = row_fill[i]
            if row_fill[i] < min_row: min_row = row_fill[i]
            if col_fill[i] > max_col: max_col = col_fill[i]
            if col_fill[i] < min_col: min_col = col_fill[i]
            srow += row_fill[i]; scol += col_fill[i]
        mean_row = srow / n; mean_col = scol / n
        vrow = 0.0; vcol = 0.0
        for i in range(n):
            dr = row_fill[i] - mean_row; vrow += dr * dr
            dc = col_fill[i] - mean_col; vcol += dc * dc
        std_row = (vrow / n) ** 0.5
        std_col = (vcol / n) ** 0.5

        # 行列跳变（边界视为 occupied）+ 井深 + 暴露边 + 凹角 + 列高 + 近满，单次/少次遍历
        row_trans = 0; col_trans = 0; wells = 0; edge_exposure = 0; concave = 0
        for y in range(n):
            for x in range(n):
                occ_yx = grid[y, x] >= 0
                # 行内相邻 + 右边界
                if x + 1 < n:
                    if occ_yx != (grid[y, x + 1] >= 0):
                        row_trans += 1
                        edge_exposure += 1
                else:
                    if not occ_yx:
                        row_trans += 1  # 与右边界(occupied)不同
                # 列内相邻 + 下边界
                if y + 1 < n:
                    if occ_yx != (grid[y + 1, x] >= 0):
                        col_trans += 1
                        edge_exposure += 1
                else:
                    if not occ_yx:
                        col_trans += 1
                # 左边界（x==0 且为空 → 与左边界 occupied 不同）
                if x == 0 and not occ_yx:
                    row_trans += 1
                if y == 0 and not occ_yx:
                    col_trans += 1
                if not occ_yx:
                    # 井：左右邻（或边界）均 occupied
                    left_occ = (x == 0) or (grid[y, x - 1] >= 0)
                    right_occ = (x == n - 1) or (grid[y, x + 1] >= 0)
                    if left_occ and right_occ:
                        wells += 1
                    # 凹角：4 个对角，正交两邻格均 occupied（越界=未占用）
                    up = (y > 0) and (grid[y - 1, x] >= 0)
                    down = (y < n - 1) and (grid[y + 1, x] >= 0)
                    lf = (x > 0) and (grid[y, x - 1] >= 0)
                    rt = (x < n - 1) and (grid[y, x + 1] >= 0)
                    if up and lf: concave += 1
                    if up and rt: concave += 1
                    if down and lf: concave += 1
                    if down and rt: concave += 1

        # 列高 + height_std（每列首个被占用行；空列高 0）
        col_h = np.zeros(n, np.float32)
        for x in range(n):
            for y in range(n):
                if grid[y, x] >= 0:
                    col_h[x] = (n - y) / n
                    break
        mh = 0.0
        for x in range(n):
            mh += col_h[x]
        mh /= n
        vh = 0.0
        for x in range(n):
            d = col_h[x] - mh; vh += d * d
        height_std = (vh / n) ** 0.5

        # 近满行/列 + close1/close2：fillable = 有空格且所有空格可覆盖
        almost_full_rows = 0; almost_full_cols = 0; close1 = 0; close2 = 0
        for y in range(n):
            empty_cnt = 0; uncover = False
            for x in range(n):
                if grid[y, x] < 0:
                    empty_cnt += 1
                    if coverable[y, x] == 0:
                        uncover = True
            fillable = (empty_cnt > 0) and (not uncover)
            if fillable:
                if row_fill[y] >= af and row_fill[y] < 1.0:
                    almost_full_rows += 1
                if empty_cnt == 1:
                    close1 += 1
                elif empty_cnt == 2:
                    close2 += 1
        for x in range(n):
            empty_cnt = 0; uncover = False
            for y in range(n):
                if grid[y, x] < 0:
                    empty_cnt += 1
                    if coverable[y, x] == 0:
                        uncover = True
            fillable = (empty_cnt > 0) and (not uncover)
            if fillable:
                if col_fill[x] >= af and col_fill[x] < 1.0:
                    almost_full_cols += 1
                if empty_cnt == 1:
                    close1 += 1
                elif empty_cnt == 2:
                    close2 += 1

        # 空白 4-连通分量数（flood fill，显式栈）
        visited = np.zeros((n, n), np.uint8)
        sy_st = np.empty(n * n, np.int32)
        sx_st = np.empty(n * n, np.int32)
        regions = 0
        for y0 in range(n):
            for x0 in range(n):
                if grid[y0, x0] >= 0 or visited[y0, x0]:
                    continue
                regions += 1
                sp = 0
                sy_st[0] = y0; sx_st[0] = x0; visited[y0, x0] = 1; sp = 1
                while sp > 0:
                    sp -= 1
                    cy = sy_st[sp]; cx = sx_st[sp]
                    if cy > 0 and not visited[cy - 1, cx] and grid[cy - 1, cx] < 0:
                        visited[cy - 1, cx] = 1; sy_st[sp] = cy - 1; sx_st[sp] = cx; sp += 1
                    if cy + 1 < n and not visited[cy + 1, cx] and grid[cy + 1, cx] < 0:
                        visited[cy + 1, cx] = 1; sy_st[sp] = cy + 1; sx_st[sp] = cx; sp += 1
                    if cx > 0 and not visited[cy, cx - 1] and grid[cy, cx - 1] < 0:
                        visited[cy, cx - 1] = 1; sy_st[sp] = cy; sx_st[sp] = cx - 1; sp += 1
                    if cx + 1 < n and not visited[cy, cx + 1] and grid[cy, cx + 1] < 0:
                        visited[cy, cx + 1] = 1; sy_st[sp] = cy; sx_st[sp] = cx + 1; sp += 1

        return (
            filled, row_fill, col_fill,
            float(max_row), float(min_row), float(max_col), float(min_col),
            float(mean_row), float(mean_col), float(std_row), float(std_col),
            holes, row_trans, col_trans, wells, edge_exposure,
            regions, concave, float(height_std),
            almost_full_rows, almost_full_cols, close1, close2,
        )

    @_njit(cache=True)
    def _place_and_clear_kernel(grid, shape, gx, gy):
        """放置 shape（占用置 0）后整行/整列消除，返回 (新棋盘 int32, 消行数)。

        与 numpy 版 place_and_clear_np 逐位等价：occupied = (值≥0)，满行/满列各计一次，
        交叉格只清一次，最后整体置 -1。形状逐格在原生代码内遍历，免去 wrapper 的 argwhere。
        """
        n = grid.shape[0]
        g = grid.copy()
        h = shape.shape[0]
        w = shape.shape[1]
        for sy in range(h):
            for sx in range(w):
                if shape[sy, sx]:
                    g[gy + sy, gx + sx] = 0
        row_full = np.zeros(n, np.uint8)
        col_full = np.zeros(n, np.uint8)
        clears = 0
        for y in range(n):
            full = True
            for x in range(n):
                if g[y, x] < 0:
                    full = False
                    break
            if full:
                row_full[y] = 1
                clears += 1
        for x in range(n):
            full = True
            for y in range(n):
                if g[y, x] < 0:
                    full = False
                    break
            if full:
                col_full[x] = 1
                clears += 1
        if clears:
            for y in range(n):
                if row_full[y]:
                    for x in range(n):
                        g[y, x] = -1
            for x in range(n):
                if col_full[x]:
                    for y in range(n):
                        g[y, x] = -1
        return g, clears

else:
    _place_and_clear_kernel = None


def warmup_numba_kernels() -> bool:
    """在父进程中预触发 numba 热核编译并写入磁盘缓存（cache=True）。

    多进程 spawn 采集时若 8 个 worker 同时首次调用会并发冷编译（受文件锁串行化、拖慢首批）。
    采集前在父进程调用本函数一次，worker 启动后直接命中 .nbc/.nbi 缓存、无需重编译。
    numba 不可用时为 no-op，返回 False。
    """
    if not _HAS_NUMBA:
        return False
    dummy = np.full((8, 8), -1, dtype=np.int32)
    dummy[0, 0] = 0
    shp = np.ones((1, 2), dtype=np.uint8)
    pos = get_legal_positions(dummy, shp)
    batch_count_clears(dummy, shp, pos)
    fast_board_features(dummy)
    place_and_clear_np(dummy, shp, 0, 0)
    return True


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

    **shapes 为 None（默认全量形状库）时的精确捷径**：形状库包含全部 2 格块
    （1x2 / 2x1 / diag-2a / diag-2b，含特殊块），它们合起来覆盖 8 个邻接方向。
    因此「空格 c 能被某形状覆盖」⟺「c 为空且其 8-邻域内至少有一个空格」——
    孤立空格（8 邻域全满）无任何形状可覆盖；只要有一个空邻格，对应 2 格块即可覆盖 c。
    更大的块约束更强，不会覆盖到 2 格块覆盖不到的孤立空格，故该判据精确等价于
    遍历全部 40 个形状。这把曾占采集 ~49% CPU 的「40 形状 × sliding_window_view」
    降为一次 8-邻域 OR。（已用暴力实现做随机盘等价校验。）

    传入自定义 shapes 子集时，回退到通用的逐形状向量化枚举。
    """
    n = grid_np.shape[0]
    if shapes is None:
        empty = grid_np < 0
        padded = np.zeros((n + 2, n + 2), dtype=bool)
        padded[1:-1, 1:-1] = empty
        neighbor_empty = (
            padded[0:n, 0:n] | padded[0:n, 1:n + 1] | padded[0:n, 2:n + 2]
            | padded[1:n + 1, 0:n] | padded[1:n + 1, 2:n + 2]
            | padded[2:n + 2, 0:n] | padded[2:n + 2, 1:n + 1] | padded[2:n + 2, 2:n + 2]
        )
        return empty & neighbor_empty
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

    if _HAS_NUMBA:
        occ = np.ascontiguousarray(grid_np >= 0, dtype=np.uint8)
        shp = np.ascontiguousarray(shape_np, dtype=np.uint8)
        return _legal_positions_kernel(occ, shp)

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

    if _HAS_NUMBA:
        return _batch_count_clears_kernel(
            np.ascontiguousarray(occ, dtype=np.uint8),
            np.ascontiguousarray(sy, dtype=np.int32),
            np.ascontiguousarray(sx, dtype=np.int32),
            np.ascontiguousarray(positions, dtype=np.int32),
            row_counts,
            col_counts,
        )

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
    if _place_and_clear_kernel is not None:
        g_out, clears = _place_and_clear_kernel(
            np.ascontiguousarray(grid_np, dtype=np.int32),
            np.ascontiguousarray(shape_np, dtype=np.uint8),
            int(gx),
            int(gy),
        )
        return g_out.astype(grid_np.dtype, copy=False), int(clears)

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
    """返回所有棋盘结构特征。numba 可用时走单次原生遍历的编译热核，否则走 numpy 向量化回退。"""
    n = grid_np.shape[0]
    area = n * n

    if _HAS_NUMBA:
        # coverable 已是廉价的一次 8-邻域 OR，保留 numpy；其余结构特征交给编译热核。
        coverable = coverable_cells(grid_np)
        (
            filled, row_fill, col_fill,
            max_row, min_row, max_col, min_col,
            mean_row, mean_col, std_row, std_col,
            holes, row_trans, col_trans, wells, edge_exposure,
            contiguous_regions, concave_corners, height_std,
            almost_full_rows, almost_full_cols, close1, close2,
        ) = _board_features_kernel(
            np.ascontiguousarray(grid_np, dtype=np.int32),
            np.ascontiguousarray(coverable, dtype=np.uint8),
        )
        return {
            "filled": int(filled), "area": area,
            "row_fill": row_fill, "col_fill": col_fill,
            "max_row": max_row, "min_row": min_row,
            "max_col": max_col, "min_col": min_col,
            "mean_row": mean_row, "mean_col": mean_col,
            "std_row": std_row, "std_col": std_col,
            "almost_full_rows": int(almost_full_rows),
            "almost_full_cols": int(almost_full_cols),
            "holes": int(holes), "row_trans": int(row_trans),
            "col_trans": int(col_trans), "wells": int(wells),
            "close1": int(close1), "close2": int(close2),
            "edge_exposure": int(edge_exposure),
            "contiguous_regions": int(contiguous_regions),
            "concave_corners": int(concave_corners),
            "height_std": height_std,
        }

    occ = occupied_mask(grid_np)

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

    # 行列跳变（向量化）：边界视为 occupied。np.pad 每次新建数组开销大（实测占本函数 ~32%
    # cumtime），改为「内部相邻差异 + 两端边界差异」直接切片求和，结果逐字段等价：
    #   边界(1) 与首/尾格不同 ⟺ 该格为空(occ==0)，故两端贡献 = 首/尾行列的空格数。
    row_trans = int(
        np.sum(occ[:, :-1] != occ[:, 1:])
        + np.count_nonzero(occ[:, 0] == 0)
        + np.count_nonzero(occ[:, -1] == 0)
    )
    col_trans = int(
        np.sum(occ[:-1, :] != occ[1:, :])
        + np.count_nonzero(occ[0, :] == 0)
        + np.count_nonzero(occ[-1, :] == 0)
    )

    # 井深（向量化）：空格且左右邻居（或边界）均为 occupied。用切片构造邻接掩码替代 np.pad。
    left_nb = np.ones_like(occ_bool)
    left_nb[:, 1:] = occ_bool[:, :-1]
    right_nb = np.ones_like(occ_bool)
    right_nb[:, :-1] = occ_bool[:, 1:]
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
    # 向量化：argmax 取每列首个被占用行（空列 any_occ=False → 高 0），替代 Python 循环。
    any_occ_col = occ_bool.any(axis=0)
    first_occ_row = occ_bool.argmax(axis=0)  # 无占用时为 0，由 any_occ_col 掩码归零
    col_heights = np.where(any_occ_col, n - first_occ_row, 0).astype(np.float32)
    height_std = float((col_heights / n).std())

    # 差 1/2 格满（向量化，与逐行/列循环逐字段等价）：
    #   fillable(行) = 该行有空格 且 所有空格均可被覆盖（即无「空且不可覆盖」格）。
    af = 0.78
    empty_mask = grid_np < 0
    uncoverable_empty = empty_mask & ~coverable
    empty_per_row = empty_mask.sum(axis=1)
    empty_per_col = empty_mask.sum(axis=0)
    row_fillable = (empty_per_row > 0) & ~uncoverable_empty.any(axis=1)
    col_fillable = (empty_per_col > 0) & ~uncoverable_empty.any(axis=0)

    almost_full_rows = int(np.sum(row_fillable & (row_fill >= af) & (row_fill < 1.0)))
    almost_full_cols = int(np.sum(col_fillable & (col_fill >= af) & (col_fill < 1.0)))
    close1 = int(
        np.sum(row_fillable & (empty_per_row == 1))
        + np.sum(col_fillable & (empty_per_col == 1))
    )
    close2 = int(
        np.sum(row_fillable & (empty_per_row == 2))
        + np.sum(col_fillable & (empty_per_col == 2))
    )

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
    """空白（~occ）4-连通分量数 —— 与 boardTopology.js countEmptyRegions 同口径。

    优先用 scipy.ndimage.label（4-邻接结构元）做连通分量计数，等价于原 Python DFS 但更快；
    scipy 不可用时回退到纯 Python flood-fill DFS（保持零依赖可运行）。
    """
    if _ndimage_label is not None:
        # structure 默认即 4-连通（十字结构），label 返回分量数；对全占用盘返回 0，与 DFS 一致。
        _, num = _ndimage_label(~occ_bool)
        return int(num)
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
    """凹角数 —— 与 boardTopology.js countConcaveCorners 同口径（越界视为未占用）。

    向量化：对每个空格 (y,x)，4 个对角各计一次「正交两邻格均被占用」。用越界=False 的
    平移掩码 up/down/left/right 替代逐格 Python 双循环，逐项与原实现等价。
    """
    n = occ_bool.shape[0]
    empty = ~occ_bool
    # 平移：up[y,x]=occ(y-1,x)，down=occ(y+1,x)，left=occ(y,x-1)，right=occ(y,x+1)；越界补 False。
    up = np.zeros_like(occ_bool); up[1:, :] = occ_bool[:-1, :]
    down = np.zeros_like(occ_bool); down[:-1, :] = occ_bool[1:, :]
    left = np.zeros_like(occ_bool); left[:, 1:] = occ_bool[:, :-1]
    right = np.zeros_like(occ_bool); right[:, :-1] = occ_bool[:, 1:]
    count = (
        np.sum(empty & up & left)
        + np.sum(empty & up & right)
        + np.sum(empty & down & left)
        + np.sum(empty & down & right)
    )
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
