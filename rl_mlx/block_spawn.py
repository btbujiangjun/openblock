"""候选块出块算法 v2-lite：不依赖 fast_grid 的轻量版 v2 升级。

v1 → v2-lite 升级（与 rl_pytorch/block_spawn.py v2 对齐，无 numpy 依赖）：
1. difficulty_target ∈ [0,1] 参数支持（产品目标对齐）
2. pick_weighted 边界修复（空池 + 非正权重）
3. 消行潜力评估（_best_clear_count_pure：纯 Python，无 fast_grid）
4. 消行得分感知加权（_compute_shape_score 简化版）

NOTE: rl_pytorch/block_spawn.py v2+v3 具有完整的盘面拓扑分析（_BoardAnalysis via fast_grid）
和构造式出块引擎（spawn_construction.py），MLX 侧因缺少 fast_grid 采用轻量替代。
"""

from __future__ import annotations

import copy
import math
import random
from typing import Any

from .grid import Grid
from .shapes_data import get_all_shapes, pick_random_shape_weighted, shape_category

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
# v2-lite: 纯 Python 消行潜力评估（无 fast_grid 依赖）
# ---------------------------------------------------------------------------

def _count_clears_at(grid: Grid, shape_data: list[list[int]], gx: int, gy: int) -> int:
    """模拟放置并计算消行数（不修改原 grid）。"""
    n = grid.size
    row_counts = [0] * n
    col_counts = [0] * n
    for y in range(n):
        for x in range(n):
            if grid.cells[y][x] is not None:
                row_counts[y] += 1
                col_counts[x] += 1
    for sy, row in enumerate(shape_data):
        for sx, v in enumerate(row):
            if v:
                py, px = gy + sy, gx + sx
                if 0 <= py < n and 0 <= px < n and grid.cells[py][px] is None:
                    row_counts[py] += 1
                    col_counts[px] += 1
    clears = sum(1 for r in row_counts if r >= n) + sum(1 for c in col_counts if c >= n)
    return clears


def _best_clear_count_pure(grid: Grid, shape_data: list[list[int]]) -> int:
    """纯 Python 版：该形状在所有合法位置的最大消行数。"""
    n = grid.size
    best = 0
    for gy in range(n):
        for gx in range(n):
            if not grid.can_place(shape_data, gx, gy):
                continue
            c = _count_clears_at(grid, shape_data, gx, gy)
            if c > best:
                best = c
    return best


def _scoring_potential_lite(best_clears: int, scoring: dict) -> float:
    """由最大消行数估算得分潜力（与 rl_pytorch 版一致）。"""
    if best_clears <= 0:
        return 0.0
    base_unit = float(scoring.get("single_line", 20))
    return base_unit * best_clears * best_clears


# ---------------------------------------------------------------------------
# v2-lite: 综合权重计算
# ---------------------------------------------------------------------------

def _compute_shape_score(
    entry: dict[str, Any],
    scoring: dict,
    difficulty_target: float,
    chosen_meta: list[dict[str, Any]],
    fill: float,
    mob_target: int,
) -> float:
    """v2-lite 综合权重（与 rl_pytorch 版逻辑对齐，无拓扑因子）。"""
    w = float(entry["weight"])
    pc = int(entry["placements"])
    shape_data = entry["shape"]["data"]
    cells = _shape_cell_count(shape_data)

    mobility_factor = 1.0 + math.log1p(pc) * (0.35 + fill * 0.55)
    if fill > 0.45 and _min_placements_of(chosen_meta) < mob_target + 2:
        mobility_factor *= 1.0 + pc / (8.0 + fill * 24.0)

    if int(entry.get("pc_potential") or 0) == 2:
        w *= 18.0

    max_clears = int(entry.get("best_clears", 0))
    score_pot = float(entry.get("scoring_potential", 0))

    clear_factor = 1.0
    if max_clears > 0:
        clear_factor += 0.5 * max_clears
        if max_clears >= 2:
            clear_factor += 0.8 * (max_clears - 1)

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
        w * mobility_factor * clear_factor
        * size_mod * clear_emphasis * gap_fill_bonus * complement_factor
    )
    return max(0.001, total)


def generate_dock_shapes(
    grid: Grid,
    strategy_config: dict,
    *,
    difficulty_target: float = 0.5,
) -> list[dict]:
    """返回最多 3 个形状（v2-lite：支持 difficulty_target）。"""
    weights = strategy_config.get("shape_weights") or {}
    fill = _fill_ratio(grid)
    scoring = strategy_config.get("scoring") or {"single_line": 20}

    scored: list[dict[str, Any]] = []
    occupied = sum(1 for y in range(grid.size) for x in range(grid.size) if grid.cells[y][x] is not None)
    eval_perfect_clear = occupied <= 22 or fill <= 0.46
    for shape in get_all_shapes(include_special=False):
        data = shape["data"]
        can = grid.can_place_anywhere(data)
        gap_fills = grid.count_gap_fills(data) if can else 0
        cat = shape_category(shape["id"])
        w = float(weights.get(cat, 1.0))
        placements = _count_legal_placements(grid, data) if can else 0
        pc_potential = _best_perfect_clear_potential(grid, data) if can and eval_perfect_clear else 0
        best_clears = _best_clear_count_pure(grid, data) if can else 0
        entry: dict[str, Any] = {
            "shape": shape,
            "can_place": can,
            "gap_fills": gap_fills,
            "weight": w,
            "category": cat,
            "placements": placements,
            "pc_potential": pc_potential,
            "best_clears": best_clears,
            "scoring_potential": _scoring_potential_lite(best_clears, scoring),
        }
        scored.append(entry)

    scored = [s for s in scored if s["can_place"]]
    if not scored:
        return []

    scored.sort(
        key=lambda s: (s["pc_potential"], s["best_clears"], s["gap_fills"], s["scoring_potential"]),
        reverse=True,
    )

    dt = max(0.0, min(1.0, difficulty_target))

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
                (s, _compute_shape_score(s, scoring, dt, chosen_meta, fill, mob_target))
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

    # Fallback
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
            (s, _compute_shape_score(s, scoring, dt, [], fill, 1))
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
