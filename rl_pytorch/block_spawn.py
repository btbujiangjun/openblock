"""候选块出块算法 v2：融合盘面拓扑分析与消行得分规则，驱动产品目标达成。

v1 局限
-------
- 只看 gap_fills（能否消行）和 placements（合法位置数），不分析盘面拓扑
- 不考虑 combo 倍数、多消加分、bonus line 等得分机制
- 无法感知当前产品阶段（送爽 vs 加压），与难度曲线脱节

v2 升级
-------
1. **盘面拓扑感知**：利用 fast_grid 向量化特征（空洞、近满行列、连通区域、
   凹角、列高标准差），评估每个候选块对盘面结构的改善/恶化效果。
2. **消行得分潜力评估**：模拟每个候选块在最佳位置的消行数、多消加分系数、
   近满行造势（为下轮消行铺路），量化得分产出潜力。
3. **产品目标对齐**：通过 difficulty_target ∈ [0,1] 参数，在"送爽"和"加压"
   两端连续插值出块偏好：低值偏好消行友好块、小块、高得分潜力；高值偏好
   大块、不规则块、低机动性约束。
"""

from __future__ import annotations

import copy
import math
import random
from typing import Any

import numpy as np

from .grid import Grid
from .shapes_data import get_all_shapes, pick_random_shape_weighted, shape_category
from . import fast_grid as _fg
from .spawn_construction import try_construct, ConstructResult

MAX_SPAWN_ATTEMPTS = 18
FILL_SURVIVABILITY_ON = 0.52
SURVIVE_SEARCH_BUDGET = 14000


def _shape_cell_count(data: list[list[int]]) -> int:
    return sum(sum(1 for v in row if v) for row in data)


def _count_legal_placements(grid: Grid, shape_data: list[list[int]]) -> int:
    c = 0
    n = grid.size
    for gy in range(n):
        for gx in range(n):
            if grid.can_place(shape_data, gx, gy):
                c += 1
    return c


def _fill_ratio(grid: Grid) -> float:
    n = grid.size
    filled = sum(1 for y in range(n) for x in range(n) if grid.cells[y][x] is not None)
    return filled / (n * n) if n else 0.0


def _is_empty(grid: Grid) -> bool:
    return all(cell is None for row in grid.cells for cell in row)


def _best_perfect_clear_potential(grid: Grid, shape_data: list[list[int]]) -> int:
    n = grid.size
    for gy in range(n):
        for gx in range(n):
            if not grid.can_place(shape_data, gx, gy):
                continue
            g = grid.clone()
            g.place(shape_data, 0, gx, gy)
            g.check_lines()
            if _is_empty(g):
                return 2
    return 0


def _permutations3(a: list[list[int]], b: list[list[int]], c: list[list[int]]):
    return (
        (a, b, c),
        (a, c, b),
        (b, a, c),
        (b, c, a),
        (c, a, b),
        (c, b, a),
    )


def _place_and_clear(grid: Grid, shape_data: list[list[int]], gx: int, gy: int) -> Grid:
    g = grid.clone()
    g.place(shape_data, 0, gx, gy)
    g.check_lines()
    return g


def _dfs_place_order(
    grid: Grid, ordered: list[list[list[int]]], depth: int, budget: list[int]
) -> bool:
    if depth >= len(ordered):
        return True
    s = ordered[depth]
    n = grid.size
    for gy in range(n):
        for gx in range(n):
            if not grid.can_place(s, gx, gy):
                continue
            if budget[0] <= 0:
                return True
            budget[0] -= 1
            nxt = _place_and_clear(grid, s, gx, gy)
            if _dfs_place_order(nxt, ordered, depth + 1, budget):
                return True
    return False


def _triplet_sequentially_solvable(grid: Grid, three: list[list[list[int]]]) -> bool:
    if len(three) != 3:
        return True
    a, b, c = three
    budget = [SURVIVE_SEARCH_BUDGET]
    for perm in _permutations3(a, b, c):
        if _dfs_place_order(grid, list(perm), 0, budget):
            return True
        if budget[0] <= 0:
            return True
    return False


def _min_mobility_target(fill: float, attempt: int) -> int:
    relax = attempt // 5
    if fill >= 0.88:
        t = 8
    elif fill >= 0.75:
        t = 5
    elif fill >= 0.62:
        t = 3
    elif fill >= 0.48:
        t = 2
    else:
        t = 1
    return max(1, t - relax)


def _min_placements_of(chosen: list[dict[str, Any]]) -> int:
    if not chosen:
        return 999
    return min(c["placements"] for c in chosen)


# ---------------------------------------------------------------------------
# v2: 盘面拓扑分析
# ---------------------------------------------------------------------------

class _BoardAnalysis:
    """缓存当前盘面的拓扑特征，避免重复计算。"""

    __slots__ = (
        "grid_np", "feats", "fill", "occupied", "n",
        "near_full_rows", "near_full_cols", "holes",
        "row_fill", "col_fill", "edge_exposure",
        "contiguous_regions", "concave_corners", "height_std",
    )

    def __init__(self, grid: Grid):
        self.grid_np = _fg.grid_to_np(grid)
        self.n = grid.size
        self.feats = _fg.fast_board_features(self.grid_np)
        self.fill = float(self.feats["filled"]) / max(self.feats["area"], 1)
        self.occupied = int(self.feats["filled"])
        self.near_full_rows = int(self.feats.get("almost_full_rows", 0))
        self.near_full_cols = int(self.feats.get("almost_full_cols", 0))
        self.holes = int(self.feats["holes"])
        self.row_fill = self.feats["row_fill"]
        self.col_fill = self.feats["col_fill"]
        self.edge_exposure = int(self.feats["edge_exposure"])
        self.contiguous_regions = int(self.feats["contiguous_regions"])
        self.concave_corners = int(self.feats["concave_corners"])
        self.height_std = float(self.feats["height_std"])

    @property
    def near_full_total(self) -> int:
        return self.near_full_rows + self.near_full_cols

    @property
    def crowding(self) -> float:
        """v1.70 盘面「拥挤 + 杂乱」复合分 ∈ [0,1]（与 web computeBoardCrowding 同口径意图）。

        表征玩家视角「又挤又乱、快撑不住」的紧张时刻——偶发投放多消、让盘面清爽的最佳兑现点。
        web 用 fill/contiguousRegions/enclosedVoidCells/transitions；Python 侧用可达的等价信号
        fill（密度）+ contiguous_regions（碎片化）+ concave_corners（凹角陷阱）+ holes（死腔）。
        """
        f = max(0.0, min(1.0, self.fill))
        regions = min(1.0, max(0, self.contiguous_regions - 1) / 7.0)
        concave = min(1.0, self.concave_corners / 12.0)
        holes = min(1.0, self.holes / 8.0)
        score = f * 0.45 + regions * 0.25 + concave * 0.20 + holes * 0.10
        return max(0.0, min(1.0, score))

    @property
    def board_quality(self) -> float:
        """综合盘面质量 [0,1]：越高越"健康"，适合消行。"""
        hole_penalty = min(1.0, self.holes / 8.0)
        region_penalty = min(1.0, max(0, self.contiguous_regions - 1) / 6.0)
        concave_penalty = min(1.0, self.concave_corners / 16.0)
        height_penalty = min(1.0, self.height_std / 0.4)
        near_full_bonus = min(1.0, self.near_full_total / 6.0)
        quality = (
            1.0
            - 0.30 * hole_penalty
            - 0.15 * region_penalty
            - 0.10 * concave_penalty
            - 0.10 * height_penalty
            + 0.20 * near_full_bonus
        )
        return max(0.0, min(1.0, quality))


def _best_clear_count(grid_np: np.ndarray, shape_data: list[list[int]]) -> int:
    """该形状在盘面上所有合法位置的最大消行数。"""
    shape_np = _fg.shape_to_np(shape_data)
    positions = _fg.get_legal_positions(grid_np, shape_np)
    if len(positions) == 0:
        return 0
    clears = _fg.batch_count_clears(grid_np, shape_np, positions)
    return int(clears.max())


def _avg_clear_count(grid_np: np.ndarray, shape_data: list[list[int]]) -> float:
    """该形状在能消行的位置上的平均消行数（不含不消行位置）。"""
    shape_np = _fg.shape_to_np(shape_data)
    positions = _fg.get_legal_positions(grid_np, shape_np)
    if len(positions) == 0:
        return 0.0
    clears = _fg.batch_count_clears(grid_np, shape_np, positions)
    clearing = clears[clears > 0]
    if len(clearing) == 0:
        return 0.0
    return float(clearing.mean())


def _clear_position_ratio(grid_np: np.ndarray, shape_data: list[list[int]]) -> float:
    """能消行位置占所有合法位置的比例。"""
    shape_np = _fg.shape_to_np(shape_data)
    positions = _fg.get_legal_positions(grid_np, shape_np)
    if len(positions) == 0:
        return 0.0
    clears = _fg.batch_count_clears(grid_np, shape_np, positions)
    return float((clears > 0).sum()) / len(positions)


def _near_full_delta(grid: Grid, grid_np: np.ndarray, shape_data: list[list[int]]) -> float:
    """放置后近满行列数的最大增量（造势能力）。取所有合法位置中最好的结果。"""
    shape_np = _fg.shape_to_np(shape_data)
    positions = _fg.get_legal_positions(grid_np, shape_np)
    if len(positions) == 0:
        return 0.0
    n = grid.size
    base_nf = 0
    occ = _fg.occupied_mask(grid_np)
    row_counts = occ.sum(axis=1, dtype=np.int32)
    col_counts = occ.sum(axis=0, dtype=np.int32)
    threshold = int(n * 0.78)
    for r in range(n):
        if threshold <= row_counts[r] < n:
            base_nf += 1
    for c in range(n):
        if threshold <= col_counts[c] < n:
            base_nf += 1

    shape_cells = np.argwhere(shape_np > 0)
    if len(shape_cells) == 0:
        return 0.0

    best_delta = 0.0
    sample_count = min(len(positions), 12)
    if len(positions) > sample_count:
        indices = np.random.choice(len(positions), sample_count, replace=False)
        sampled = positions[indices]
    else:
        sampled = positions

    for pos in sampled:
        gy, gx = int(pos[0]), int(pos[1])
        new_row_counts = row_counts.copy()
        new_col_counts = col_counts.copy()
        for sc in shape_cells:
            sy, sx = int(sc[0]), int(sc[1])
            py, px = gy + sy, gx + sx
            if 0 <= py < n and 0 <= px < n and occ[py, px] == 0:
                new_row_counts[py] += 1
                new_col_counts[px] += 1
        new_nf = 0
        for r in range(n):
            if new_row_counts[r] >= n:
                continue
            if new_row_counts[r] >= threshold:
                new_nf += 1
        for c in range(n):
            if new_col_counts[c] >= n:
                continue
            if new_col_counts[c] >= threshold:
                new_nf += 1
        delta = new_nf - base_nf
        if delta > best_delta:
            best_delta = delta

    return best_delta


def _scoring_potential_from_clears(
    best_clears: int,
    scoring: dict,
) -> float:
    """由已知最大消行数估算得分潜力（不含 combo/bonus）。

    得分公式：base_unit × clears²（与 simulator._clear_score_gain 一致）。
    """
    if best_clears <= 0:
        return 0.0
    base_unit = float(scoring.get("single_line", 20))
    return base_unit * best_clears * best_clears


def _scoring_potential(
    grid_np: np.ndarray,
    shape_data: list[list[int]],
    scoring: dict,
) -> float:
    """估算该形状单独放置的最大得分潜力（不含 combo/bonus）。"""
    return _scoring_potential_from_clears(_best_clear_count(grid_np, shape_data), scoring)


# ---------------------------------------------------------------------------
# v2: 产品目标对齐的权重调制
# ---------------------------------------------------------------------------

def _compute_shape_score(
    entry: dict[str, Any],
    board: _BoardAnalysis,
    scoring: dict,
    difficulty_target: float,
    chosen_meta: list[dict[str, Any]],
    fill: float,
    mob_target: int,
) -> float:
    """为候选形状计算综合权重，融合盘面布局、得分规则和产品目标。

    difficulty_target ∈ [0, 1]:
      - 0.0 = 最大送爽：偏好消行友好块、小块、高得分
      - 0.5 = 标准均衡
      - 1.0 = 最大加压：偏好大块、不规则块、约束空间

    权重 = base_weight × mobility_factor × clear_factor × topology_factor
           × scoring_factor × difficulty_modulation
    """
    w = float(entry["weight"])
    pc = int(entry["placements"])
    shape_data = entry["shape"]["data"]
    cells = _shape_cell_count(shape_data)

    # ---- 1. 机动性因子（保留 v1 逻辑，提供生存保障）----
    mobility_factor = 1.0 + math.log1p(pc) * (0.35 + fill * 0.55)
    if fill > 0.45 and _min_placements_of(chosen_meta) < mob_target + 2:
        mobility_factor *= 1.0 + pc / (8.0 + fill * 24.0)

    # ---- 2. 完美清屏加成（保留 v1）----
    if int(entry.get("pc_potential") or 0) == 2:
        w *= 18.0

    # ---- 3. 消行得分潜力因子 ----
    max_clears = int(entry.get("best_clears", 0))
    score_pot = float(entry.get("scoring_potential", 0))
    clear_ratio = float(entry.get("clear_pos_ratio", 0))

    clear_factor = 1.0
    if max_clears > 0:
        clear_factor += 0.5 * max_clears
        if max_clears >= 2:
            clear_factor += 0.8 * (max_clears - 1)
    if clear_ratio > 0:
        clear_factor += 0.3 * clear_ratio
    if score_pot > 0:
        clear_factor += 0.15 * math.log1p(score_pot / 20.0)

    # ---- 4. 盘面拓扑匹配因子 ----
    topology_factor = 1.0
    nf_delta = float(entry.get("near_full_delta", 0))

    if board.holes >= 2:
        if cells <= 3:
            topology_factor *= 1.3
        elif cells >= 6:
            topology_factor *= 0.8

    if board.near_full_total >= 2 and max_clears > 0:
        topology_factor *= 1.0 + 0.2 * min(max_clears, 3)

    if nf_delta > 0:
        topology_factor *= 1.0 + 0.15 * nf_delta

    if board.contiguous_regions >= 3 and cells <= 3:
        topology_factor *= 1.15

    if board.height_std > 0.25 and max_clears > 0:
        topology_factor *= 1.1

    # ---- 5. 产品目标调制 ----
    dt = max(0.0, min(1.0, difficulty_target))
    relief = 1.0 - dt
    pressure = dt

    size_mod = 1.0
    if relief > 0.5:
        if cells <= 4:
            size_mod = 1.0 + 0.4 * (relief - 0.5)
        elif cells >= 7:
            size_mod = 1.0 - 0.3 * (relief - 0.5)
    elif pressure > 0.5:
        if cells >= 5:
            size_mod = 1.0 + 0.25 * (pressure - 0.5)
        elif cells <= 2:
            size_mod = 1.0 - 0.2 * (pressure - 0.5)

    clear_emphasis = 1.0
    if relief > 0.3:
        clear_emphasis = 1.0 + 0.6 * relief * min(max_clears, 3)
    elif pressure > 0.6:
        if max_clears == 0 and fill < 0.7:
            clear_emphasis = 1.0 + 0.3 * pressure

    gap_fill_bonus = 1.0
    gap_fills = int(entry.get("gap_fills", 0))
    if gap_fills > 0 and relief > 0.2:
        gap_fill_bonus = 1.0 + 0.2 * gap_fills * relief

    # ---- 6. dock 已选块互补 ----
    complement_factor = 1.0
    if chosen_meta:
        bulky = sum(_shape_cell_count(m["shape"]["data"]) for m in chosen_meta)
        want_small = fill > 0.52 and bulky >= 10
        if want_small:
            if cells <= 4:
                complement_factor *= 1.65
            elif cells >= 8:
                complement_factor *= 0.72

        chosen_has_clear = any(m.get("best_clears", 0) > 0 for m in chosen_meta)
        if not chosen_has_clear and max_clears > 0 and relief > 0.3:
            complement_factor *= 1.4

    total = (
        w
        * mobility_factor
        * clear_factor
        * topology_factor
        * size_mod
        * clear_emphasis
        * gap_fill_bonus
        * complement_factor
    )
    return max(0.001, total)


# ---------------------------------------------------------------------------
# v2: 预计算形状得分特征
# ---------------------------------------------------------------------------

def _enrich_shape_entry(
    entry: dict[str, Any],
    grid: Grid,
    board: _BoardAnalysis,
    scoring: dict,
) -> None:
    """为形状条目追加 v2 特征字段（就地修改）。"""
    if not entry["can_place"]:
        return
    data = entry["shape"]["data"]
    grid_np = board.grid_np

    best_clears = _best_clear_count(grid_np, data)
    entry["best_clears"] = best_clears
    entry["scoring_potential"] = _scoring_potential_from_clears(best_clears, scoring)
    entry["clear_pos_ratio"] = _clear_position_ratio(grid_np, data)
    entry["near_full_delta"] = _near_full_delta(grid, grid_np, data)


# ---------------------------------------------------------------------------
# v3: 构造式出块策略选择
# ---------------------------------------------------------------------------

_CONSTRUCT_BUDGET_BASE = 120

def _try_constructive_spawn(
    grid: Grid,
    fill: float,
    board: _BoardAnalysis,
    dt: float,
    scoring: dict,
) -> ConstructResult | None:
    """根据盘面状态选择最合适的构造目标并尝试构造。

    策略逻辑：
    - 低填充 + 低难度 → 尝试清屏构造（高分爆发）
    - 有近满同色线 → 尝试同花消构造（bonus 加分）
    - 高填充 → 尝试顺序约束构造（先消行腾空间）
    - 通用 → 尝试多消构造（稳定高分）
    """
    all_shapes = get_all_shapes(include_special=False)
    relief = 1.0 - dt
    budget = int(_CONSTRUCT_BUDGET_BASE * (0.6 + 0.8 * relief))

    if fill <= 0.35 and board.occupied <= 20 and relief > 0.4:
        pc = try_construct(grid, all_shapes, "perfect_clear", budget=budget // 2)
        if pc:
            return pc

    if board.near_full_total >= 1 and relief > 0.3:
        from .spawn_construction import _find_mono_near_full_lines
        mono_lines = _find_mono_near_full_lines(grid)
        if mono_lines:
            mono = try_construct(grid, all_shapes, "mono_color", budget=budget // 2)
            if mono:
                return mono

    # v1.70 拥挤多消（爽感兑现）：盘面又挤又乱时，优先构造多消让盘面清爽（与 web
    # crowdMcFired 同语义——优先级高于 sequential_puzzle 难度构造）。仅在送爽向（relief 充分）
    # 触发，dt<0.7 已是外层门控；min_total_clears=2 保证「一手多消」的关键性爽感。
    if board.crowding >= 0.55 and relief > 0.2:
        mc_crowd = try_construct(
            grid, all_shapes, "multi_clear",
            budget=budget, min_total_clears=2,
        )
        if mc_crowd:
            return mc_crowd

    if fill >= 0.55 and relief > 0.2:
        seq = try_construct(grid, all_shapes, "sequential_puzzle", budget=budget // 3)
        if seq and seq.total_clears >= 2:
            return seq

    min_clears = 3 if relief > 0.5 else 2
    mc = try_construct(
        grid, all_shapes, "multi_clear",
        budget=budget, min_total_clears=min_clears,
    )
    return mc


# ---------------------------------------------------------------------------
# 主入口
# ---------------------------------------------------------------------------

def generate_dock_shapes(
    grid: Grid,
    strategy_config: dict,
    *,
    difficulty_target: float = 0.5,
    scoring: dict | None = None,
) -> list[dict]:
    """返回最多 3 个形状 dict（与 shapes_data 条目同结构：id, category, data）。

    Parameters
    ----------
    grid : Grid
        当前棋盘状态。
    strategy_config : dict
        策略配置（含 shape_weights, scoring 等）。
    difficulty_target : float
        产品目标难度 [0, 1]。0=送爽，0.5=标准，1=加压。
        由 simulator / adaptiveSpawn 根据玩家状态传入。
    scoring : dict | None
        消行得分规则。None 时从 strategy_config 读取。
    """
    weights = strategy_config.get("shape_weights") or {}
    fill = _fill_ratio(grid)
    if scoring is None:
        scoring = strategy_config.get("scoring") or {"single_line": 20}

    board = _BoardAnalysis(grid)

    scored: list[dict[str, Any]] = []
    eval_perfect_clear = board.occupied <= 22 or fill <= 0.46
    for shape in get_all_shapes(include_special=False):
        data = shape["data"]
        can = grid.can_place_anywhere(data)
        gap_fills = grid.count_gap_fills(data) if can else 0
        cat = shape_category(shape["id"])
        w = float(weights.get(cat, 1.0))
        placements = _count_legal_placements(grid, data) if can else 0
        pc_potential = _best_perfect_clear_potential(grid, data) if can and eval_perfect_clear else 0
        entry: dict[str, Any] = {
            "shape": shape,
            "can_place": can,
            "gap_fills": gap_fills,
            "weight": w,
            "category": cat,
            "placements": placements,
            "pc_potential": pc_potential,
            "best_clears": 0,
            "scoring_potential": 0.0,
            "clear_pos_ratio": 0.0,
            "near_full_delta": 0.0,
        }
        if can:
            _enrich_shape_entry(entry, grid, board, scoring)
        scored.append(entry)

    scored = [s for s in scored if s["can_place"]]
    if not scored:
        return []

    scored.sort(
        key=lambda s: (s["pc_potential"], s["best_clears"], s["gap_fills"], s["scoring_potential"]),
        reverse=True,
    )

    dt = max(0.0, min(1.0, difficulty_target))

    # v3: 构造式出块——在常规加权采样之前，尝试构造满足特定产品目标的三块组合
    # 使用独立 RNG 避免构造器搜索消耗影响后续加权采样的随机性
    if dt < 0.7:
        rng_state = random.getstate()
        construct_result = _try_constructive_spawn(
            grid, fill, board, dt, scoring,
        )
        if construct_result is not None:
            triplet = construct_result.shapes
            if (
                len(triplet) == 3
                and all(grid.can_place_anywhere(s["data"]) or construct_result.requires_order for s in triplet)
            ):
                if not construct_result.requires_order:
                    for i in range(len(triplet) - 1, 0, -1):
                        j = random.randint(0, i)
                        triplet[i], triplet[j] = triplet[j], triplet[i]
                return triplet
        random.setstate(rng_state)

    def pick_weighted(pool: list[tuple[dict[str, Any], float]]) -> dict[str, Any]:
        if not pool:
            raise ValueError("pick_weighted called with empty pool")
        total_w = sum(w for _, w in pool)
        if total_w <= 0:
            return pool[0][0]
        r = random.random() * total_w
        sel = pool[0][0]
        for entry, w in pool:
            r -= w
            if r <= 0:
                sel = entry
                break
        return sel

    for attempt in range(MAX_SPAWN_ATTEMPTS):
        blocks: list[dict] = []
        used_ids: set[str] = set()
        chosen_meta: list[dict[str, Any]] = []
        mob_target = _min_mobility_target(fill, attempt)

        # v2: 首块选择——优先消行/得分最优候选（受 difficulty_target 调制）
        clear_candidates = [
            s for s in scored
            if s["gap_fills"] > 0 or s["pc_potential"] == 2 or s["best_clears"] >= 1
        ]
        if clear_candidates and dt < 0.8:
            perfect_candidates = [s for s in clear_candidates if s["pc_potential"] == 2]
            multi_clear = [s for s in clear_candidates if s["best_clears"] >= 2]
            if perfect_candidates:
                first = random.choice(perfect_candidates[:3])
            elif multi_clear and dt < 0.6:
                multi_clear.sort(key=lambda s: s["scoring_potential"], reverse=True)
                first = random.choice(multi_clear[:3])
            else:
                k = min(3, len(clear_candidates))
                first = clear_candidates[random.randint(0, k - 1)]
            blocks.append(first["shape"])
            used_ids.add(first["shape"]["id"])
            chosen_meta.append({
                "shape": first["shape"],
                "placements": first["placements"],
                "best_clears": first.get("best_clears", 0),
            })
        elif clear_candidates:
            k = min(3, len(clear_candidates))
            first = clear_candidates[random.randint(0, k - 1)]
            blocks.append(first["shape"])
            used_ids.add(first["shape"]["id"])
            chosen_meta.append({
                "shape": first["shape"],
                "placements": first["placements"],
                "best_clears": first.get("best_clears", 0),
            })

        remaining = [s for s in scored if s["shape"]["id"] not in used_ids]

        while len(blocks) < 3 and remaining:
            pool = [
                (s, _compute_shape_score(s, board, scoring, dt, chosen_meta, fill, mob_target))
                for s in remaining
            ]
            pick = pick_weighted(pool)
            used_ids.add(pick["shape"]["id"])
            blocks.append(pick["shape"])
            chosen_meta.append({
                "shape": pick["shape"],
                "placements": pick["placements"],
                "best_clears": pick.get("best_clears", 0),
            })
            remaining = [s for s in scored if s["shape"]["id"] not in used_ids]

        while len(blocks) < 3:
            p = pick_random_shape_weighted(weights)
            blocks.append(p)
            chosen_meta.append({
                "shape": p,
                "placements": _count_legal_placements(grid, p["data"]),
                "best_clears": 0,
            })

        triplet = blocks[:3]
        if len(triplet) < 3:
            continue

        min_pc = min(
            _count_legal_placements(grid, triplet[0]["data"]),
            _count_legal_placements(grid, triplet[1]["data"]),
            _count_legal_placements(grid, triplet[2]["data"]),
        )
        if min_pc < mob_target:
            continue

        if fill >= FILL_SURVIVABILITY_ON:
            datas = [copy.deepcopy(s["data"]) for s in triplet]
            if not _triplet_sequentially_solvable(grid, datas):
                continue

        for i in range(len(triplet) - 1, 0, -1):
            j = random.randint(0, i)
            triplet[i], triplet[j] = triplet[j], triplet[i]

        return triplet

    # Fallback（与 v1 一致）
    blocks = []
    used_ids_fb: set[str] = set()
    clear_candidates = [
        s for s in scored
        if s["gap_fills"] > 0 or s["pc_potential"] == 2 or s["best_clears"] >= 1
    ]
    if clear_candidates:
        clear_candidates.sort(
            key=lambda s: (s["pc_potential"], s["best_clears"], s["scoring_potential"]),
            reverse=True,
        )
        blocks.append(clear_candidates[0]["shape"])
        used_ids_fb.add(clear_candidates[0]["shape"]["id"])
    rem = [s for s in scored if s["shape"]["id"] not in used_ids_fb]
    while len(blocks) < 3 and rem:
        pool = [
            (s, _compute_shape_score(s, board, scoring, dt, [], fill, 1))
            for s in rem
        ]
        pick = pick_weighted(pool)
        blocks.append(pick["shape"])
        used_ids_fb.add(pick["shape"]["id"])
        rem = [s for s in scored if s["shape"]["id"] not in used_ids_fb]
    while len(blocks) < 3:
        blocks.append(pick_random_shape_weighted(weights))
    return blocks[:3]


def generate_blocks_for_grid(
    grid: Grid,
    strategy_config: dict,
    *,
    difficulty_target: float = 0.5,
) -> list[dict]:
    return generate_dock_shapes(grid, strategy_config, difficulty_target=difficulty_target)
