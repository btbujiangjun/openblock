"""与 web/src/bot/features.js 一致的数值特征（常数来自 shared/game_rules.json）。

v6: 内部热路径使用 fast_grid numpy 加速，外部接口不变。
v1.67：state=204（含 4 单步难度 + 3 空间规划 + 3 策略 one-hot + 11 condition token）。
"""

from __future__ import annotations


import os
from collections import OrderedDict

import numpy as np

from .game_rules import FEATURE_ENCODING, rl_bonus_block_icons
from . import fast_grid as _fg
from .spawn_step_difficulty import spawn_step_difficulty_features
from .spatial_planning import spatial_planning_features
from .strategy_features import encode_strategy_onehot
from .condition_token import encode_condition_onehot

try:
    from numba import njit as _njit
except Exception:  # pragma: no cover - numba 缺失时走 Python 回退
    _njit = None

_ENC = FEATURE_ENCODING
_AF = float(_ENC.get("almostFullLineRatio", 0.78))
_DOCK = float(_ENC.get("dockSlots", 3))
_AN = dict(_ENC.get("actionNorm") or {})
_MAX_GRID = int(_ENC.get("maxGridWidth", 8))
_DOCK_MASK_SIDE = int(_ENC.get("dockMaskSide", 5))
_DOCK_SLOTS = int(_ENC.get("dockSlots", 3))
_SCALAR_DIM = int(_ENC.get("stateScalarDim", 23))
_N_COLORS = int(_ENC.get("colorCount", 8))
_RL_BONUS_ICONS = rl_bonus_block_icons()


if _njit is not None:

    @_njit(cache=True)
    def _nf_adj_kernel(occ, shape_np, row_counts, col_counts, gx: int, gy: int, nf_thr: float):
        n = occ.shape[0]
        h = shape_np.shape[0]
        w = shape_np.shape[1]
        cells_count = 0
        nf_count = 0
        adj_count = 0
        for sy in range(h):
            for sx in range(w):
                if shape_np[sy, sx] == 0:
                    continue
                cells_count += 1
                py = gy + sy
                px = gx + sx
                if row_counts[py] >= nf_thr or col_counts[px] >= nf_thr:
                    nf_count += 1
                for k in range(4):
                    dy = -1 if k == 0 else (1 if k == 1 else 0)
                    dx = -1 if k == 2 else (1 if k == 3 else 0)
                    ny = py + dy
                    nx = px + dx
                    if ny < 0 or ny >= n or nx < 0 or nx >= n or occ[ny, nx] == 0:
                        continue
                    in_block = False
                    by = ny - gy
                    bx = nx - gx
                    if 0 <= by < h and 0 <= bx < w and shape_np[by, bx] != 0:
                        in_block = True
                    if not in_block:
                        adj_count += 1
        nf = 0.0 if cells_count <= 0 else nf_count / cells_count
        return nf, adj_count, cells_count

    @_njit(cache=True)
    def _holes_after_kernel(grid_np, shape_np, gx: int, gy: int):
        n = grid_np.shape[0]
        h = shape_np.shape[0]
        w = shape_np.shape[1]
        after = np.empty((n, n), np.int32)
        for y in range(n):
            for x in range(n):
                after[y, x] = int(grid_np[y, x])
        for sy in range(h):
            for sx in range(w):
                if shape_np[sy, sx] != 0:
                    after[gy + sy, gx + sx] = 0

        row_full = np.zeros(n, np.uint8)
        col_full = np.zeros(n, np.uint8)
        for y in range(n):
            full = True
            for x in range(n):
                if after[y, x] < 0:
                    full = False
                    break
            if full:
                row_full[y] = 1
        for x in range(n):
            full = True
            for y in range(n):
                if after[y, x] < 0:
                    full = False
                    break
            if full:
                col_full[x] = 1
        for y in range(n):
            if row_full[y]:
                for x in range(n):
                    after[y, x] = -1
        for x in range(n):
            if col_full[x]:
                for y in range(n):
                    after[y, x] = -1

        holes = 0
        for y in range(n):
            for x in range(n):
                if after[y, x] >= 0:
                    continue
                neighbor_empty = False
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dy == 0 and dx == 0:
                            continue
                        ny = y + dy
                        nx = x + dx
                        if 0 <= ny < n and 0 <= nx < n and after[ny, nx] < 0:
                            neighbor_empty = True
                if not neighbor_empty:
                    holes += 1
        return holes
else:
    _nf_adj_kernel = None
    _holes_after_kernel = None

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

def extract_state_features(
    grid,
    dock: list[dict],
    strategy_id: str = "normal",
    arc: str | None = None,
    intent: str | None = None,
) -> np.ndarray:
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
    max_regions = float(_AN.get("maxEmptyRegions", 16))
    max_concave = float(_AN.get("maxConcaveCorners", 32))

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
            bf["height_std"],
            min(bf["contiguous_regions"] / max_regions, 1.0),
            min(bf["concave_corners"] / max_concave, 1.0),
        ]
    # 单步难度子向量（scdNorm/comboCellsNorm/comboKillerNorm/comboLongBarNorm）——
    # SSOT 来自 spawn_step_difficulty.py，与 web/src/bot/features.js 逐位一致。
    unplaced_shapes = [b["shape"] for b in dock if not b.get("placed")]
    diff_scalars = spawn_step_difficulty_features(unplaced_shapes, int(bf["filled"]))

    # 空间规划廉价 3 维（regionEntropy/largestRegionRatio/smallRegionCellRatio）——
    # SSOT 来自 spatial_planning.py，与 web/src/bot/features.js 逐位一致。
    spatial_scalars = spatial_planning_features(_fg.grid_to_np(grid))

    strategy_vec = encode_strategy_onehot(strategy_id)
    condition_vec = encode_condition_onehot(arc, intent)
    scalars = np.array(
        base_scalars
        + _encode_color_summary(grid, dock).tolist()
        + diff_scalars
        + spatial_scalars
        + strategy_vec.tolist()
        + condition_vec.tolist(),
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

_NF_THR = float(_AN.get("nearFullThreshold", 0.75))


def _near_full_ratio_np(occ: np.ndarray, shape_np: np.ndarray, gx: int, gy: int) -> float:
    if _nf_adj_kernel is not None:
        row_counts = occ.sum(axis=1).astype(np.int32)
        col_counts = occ.sum(axis=0).astype(np.int32)
        nf, _adj, _cells = _nf_adj_kernel(
            np.ascontiguousarray(occ, dtype=np.uint8),
            np.ascontiguousarray(shape_np, dtype=np.uint8),
            row_counts,
            col_counts,
            int(gx),
            int(gy),
            float(_NF_THR * occ.shape[0]),
        )
        return float(nf)
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
    if _nf_adj_kernel is not None:
        row_counts = occ.sum(axis=1).astype(np.int32)
        col_counts = occ.sum(axis=0).astype(np.int32)
        _nf, adj, _cells = _nf_adj_kernel(
            np.ascontiguousarray(occ, dtype=np.uint8),
            np.ascontiguousarray(shape_np, dtype=np.uint8),
            row_counts,
            col_counts,
            int(gx),
            int(gy),
            float(_NF_THR * occ.shape[0]),
        )
        return int(adj)
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
    if _holes_after_kernel is not None:
        return int(_holes_after_kernel(
            np.ascontiguousarray(grid_np, dtype=np.int32),
            np.ascontiguousarray(shape_np, dtype=np.uint8),
            int(gx),
            int(gy),
        ))
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


def _line_is_bonus(vals: np.ndarray) -> bool:
    if vals.size == 0 or np.any(vals < 0):
        return False
    first = int(vals[0])
    if _RL_BONUS_ICONS:
        icon0 = _RL_BONUS_ICONS[first % len(_RL_BONUS_ICONS)]
        return all(_RL_BONUS_ICONS[int(v) % len(_RL_BONUS_ICONS)] == icon0 for v in vals)
    return bool(np.all(vals == first))


def _clear_payoff_features_np(
    grid_np: np.ndarray,
    shape_np: np.ndarray,
    gx: int,
    gy: int,
    color_idx: int,
) -> tuple[float, float, float]:
    after = grid_np.copy()
    cells_yx = np.argwhere(shape_np > 0)
    for sy, sx in cells_yx:
        after[gy + sy, gx + sx] = int(color_idx)

    n = after.shape[0]
    occ = _fg.occupied_mask(after)
    row_full = occ.sum(axis=1) >= n
    col_full = occ.sum(axis=0) >= n
    clears = int(row_full.sum() + col_full.sum())
    if clears <= 0:
        return 0.0, 0.0, 0.0

    bonus = 0
    for y in np.where(row_full)[0]:
        if _line_is_bonus(after[int(y), :]):
            bonus += 1
    for x in np.where(col_full)[0]:
        if _line_is_bonus(after[:, int(x)]):
            bonus += 1

    after[row_full, :] = -1
    after[:, col_full] = -1
    multi = min(max(clears - 1, 0) / max(_DIV_CLR - 1.0, 1.0), 1.0)
    bonus_norm = min(bonus / max(_DIV_CLR, 1.0), 1.0)
    perfect = 1.0 if not bool(_fg.occupied_mask(after).any()) else 0.0
    return float(multi), float(bonus_norm), float(perfect)


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
    """15 维动作特征：原 12 + 多消、同 icon/同色 bonus、清屏潜力。"""
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
        grid_np = _fg.grid_to_np(grid)
        occ = _fg.occupied_mask(grid_np)
        nf = _near_full_ratio_np(occ, shape_np, gx, gy)
        unplaced_after = sum(1 for b in (dock or []) if not b.get("placed")) - 1
        blocks_remain = max(0, unplaced_after) / 3.0
        adj = min(_adjacent_occupied_np(occ, shape_np, gx, gy) / _DIV_ADJ, 1.0)
        max_h_after = max(gy + h, 0) / grid_size
        holes_risk = min(_holes_after_np(grid_np, shape_np, gx, gy) / float(_AN.get("maxHoles", 16)), 1.0)
        multi, bonus, perfect = _clear_payoff_features_np(grid_np, shape_np, gx, gy, color_idx)
        base.extend([nf, blocks_remain, adj, max_h_after, holes_risk, multi, bonus, perfect])
    else:
        base.extend([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    action_part = np.array(base, dtype=np.float32)
    if action_part.shape[0] != ACTION_FEATURE_DIM:
        raise ValueError(f"动作特征长度 {action_part.shape[0]} != actionDim {ACTION_FEATURE_DIM}")
    return np.concatenate([state_feat, action_part], axis=0)


# ---------------------------------------------------------------------------
# 局内 state→phi 精确缓存（E）：同一 (grid, dock, sid, arc, intent) 在一局内被
# 多次 build_phi_batch（agent policy 前向 + MCTS 根展开 + 树复用边界）重复计算。
# 用精确键（含颜色与 dock 形状，非有损 zobrist）做 LRU 缓存：命中返回拷贝、未命中
# 存拷贝，保证调用方始终持有私有数组（无别名风险），且与重算逐字段等价。
# RL_PHI_CACHE=0 可关闭。
# ---------------------------------------------------------------------------

_PHI_CACHE_ENABLED: bool = False
_PHI_CACHE: "OrderedDict[tuple, tuple[np.ndarray, np.ndarray]]" = OrderedDict()
_PHI_CACHE_MAX: int = 256
_phi_cache_hits: int = 0
_phi_cache_misses: int = 0


def phi_cache_begin_episode() -> None:
    """局首调用：按 RL_PHI_CACHE 启用并清空缓存与计数。"""
    global _PHI_CACHE_ENABLED, _phi_cache_hits, _phi_cache_misses
    if os.environ.get("RL_PHI_CACHE", "1").strip().lower() in ("0", "false", "no", "off"):
        _PHI_CACHE_ENABLED = False
        _PHI_CACHE.clear()
        return
    _PHI_CACHE_ENABLED = True
    _PHI_CACHE.clear()
    _phi_cache_hits = 0
    _phi_cache_misses = 0


def phi_cache_stats() -> tuple[int, int]:
    """返回 (hits, misses)。"""
    return _phi_cache_hits, _phi_cache_misses


def _phi_cache_key(sim) -> tuple:
    cells = sim.grid.cells
    grid_key = tuple(tuple(row) for row in cells)
    dock_key = tuple(
        (
            b["id"],
            bool(b["placed"]),
            int(b.get("color_idx", b.get("colorIdx", 0))),
            tuple(tuple(r) for r in b["shape"]),
        )
        for b in sim.dock
    )
    return (
        grid_key,
        dock_key,
        getattr(sim, "strategy_id", "normal"),
        getattr(sim, "condition_arc", None),
        getattr(sim, "condition_intent", None),
    )


def build_phi_batch(sim, legal: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """缓存包装：命中精确键时直接返回拷贝，否则计算并缓存。"""
    global _phi_cache_hits, _phi_cache_misses
    if _PHI_CACHE_ENABLED and legal:
        key = (_phi_cache_key(sim), len(legal))
        hit = _PHI_CACHE.get(key)
        if hit is not None:
            _phi_cache_hits += 1
            _PHI_CACHE.move_to_end(key)
            s, p = hit
            return s.copy(), p.copy()
        state, phi = _build_phi_batch_impl(sim, legal)
        _phi_cache_misses += 1
        _PHI_CACHE[key] = (state.copy(), phi.copy())
        if len(_PHI_CACHE) > _PHI_CACHE_MAX:
            _PHI_CACHE.popitem(last=False)
        return state, phi
    return _build_phi_batch_impl(sim, legal)


def _build_phi_batch_impl(sim, legal: list[dict]) -> tuple[np.ndarray, np.ndarray]:
    """v6: numpy 向量化批量特征提取，batch_count_clears 替代逐动作调用。"""
    sid = getattr(sim, "strategy_id", "normal")
    state = extract_state_features(
        sim.grid, sim.dock, sid,
        arc=getattr(sim, "condition_arc", None),
        intent=getattr(sim, "condition_intent", None),
    )
    if not legal:
        return state, np.zeros((0, PHI_DIM), dtype=np.float32)

    clears = sim.batch_count_clears(legal)
    gnp = sim._ensure_grid_np()
    occ = _fg.occupied_mask(gnp)
    n = sim.grid.size

    row_counts = occ.sum(axis=1, dtype=np.int32)
    col_counts = occ.sum(axis=0, dtype=np.int32)
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

        if _nf_adj_kernel is not None:
            nf, adj_count, _cells_count = _nf_adj_kernel(
                np.ascontiguousarray(occ, dtype=np.uint8),
                np.ascontiguousarray(shape_np, dtype=np.uint8),
                row_counts,
                col_counts,
                int(gx),
                int(gy),
                float(nf_thr),
            )
        else:
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
        color_idx = int(sim.dock[bi].get("color_idx", sim.dock[bi].get("colorIdx", 0)))
        multi, bonus, perfect = _clear_payoff_features_np(gnp, shape_np, gx, gy, color_idx)

        action_part = np.array([
            bi / _DIV_B, gx / n, gy / n, w / _DIV_SH, h / _DIV_SH,
            cells_count / _DIV_CELLS, wc / _DIV_CLR,
            nf, blocks_remain, adj, max_h_after, holes_risk, multi, bonus, perfect,
        ], dtype=np.float32)
        rows.append(np.concatenate([state, action_part], axis=0))

    return state, np.stack(rows, axis=0)
