"""候选块出块算法：与 web/src/bot/blockSpawn.js、rl_pytorch/block_spawn.py 对齐。"""

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


def generate_dock_shapes(grid: Grid, strategy_config: dict) -> list[dict]:
    weights = strategy_config.get("shape_weights") or {}
    fill = _fill_ratio(grid)

    scored: list[dict[str, Any]] = []
    occupied = sum(1 for y in range(grid.size) for x in range(grid.size) if grid.cells[y][x] is not None)
    eval_perfect_clear = occupied <= 22 or fill <= 0.46
    for shape in get_all_shapes():
        data = shape["data"]
        can = grid.can_place_anywhere(data)
        gap_fills = grid.count_gap_fills(data) if can else 0
        cat = shape_category(shape["id"])
        w = float(weights.get(cat, 1.0))
        placements = _count_legal_placements(grid, data) if can else 0
        pc_potential = _best_perfect_clear_potential(grid, data) if can and eval_perfect_clear else 0
        scored.append(
            {
                "shape": shape,
                "can_place": can,
                "gap_fills": gap_fills,
                "weight": w,
                "category": cat,
                "placements": placements,
                "pc_potential": pc_potential,
            }
        )

    scored = [s for s in scored if s["can_place"]]
    if not scored:
        return []

    scored.sort(key=lambda s: (s["pc_potential"], s["gap_fills"]), reverse=True)

    def pick_weighted(pool: list[tuple[dict[str, Any], float]]) -> dict[str, Any]:
        total_w = sum(w for _, w in pool)
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

        clear_candidates = [s for s in scored if s["gap_fills"] > 0 or s["pc_potential"] == 2]
        if clear_candidates:
            k = min(3, len(clear_candidates))
            perfect_candidates = [s for s in clear_candidates if s["pc_potential"] == 2]
            first = random.choice(perfect_candidates[:3]) if perfect_candidates else clear_candidates[random.randint(0, k - 1)]
            blocks.append(first["shape"])
            used_ids.add(first["shape"]["id"])
            chosen_meta.append({"shape": first["shape"], "placements": first["placements"]})

        def augment_pool(lst: list[dict[str, Any]]) -> list[tuple[dict[str, Any], float]]:
            bulky = sum(_shape_cell_count(m["shape"]["data"]) for m in chosen_meta)
            want_small = fill > 0.52 and bulky >= 10
            out: list[tuple[dict[str, Any], float]] = []
            for s in lst:
                w = float(s["weight"])
                pc = int(s["placements"])
                w *= 1 + math.log1p(pc) * (0.35 + fill * 0.55)
                if fill > 0.45 and _min_placements_of(chosen_meta) < mob_target + 2:
                    w *= 1 + pc / (8 + fill * 24)
                if int(s.get("pc_potential") or 0) == 2:
                    w *= 18.0
                if want_small:
                    cells = _shape_cell_count(s["shape"]["data"])
                    if cells <= 4:
                        w *= 1.65
                    elif cells >= 8:
                        w *= 0.72
                out.append((s, w))
            return out

        remaining = [s for s in scored if s["shape"]["id"] not in used_ids]

        while len(blocks) < 3 and remaining:
            pool = augment_pool(remaining)
            pick = pick_weighted(pool)
            used_ids.add(pick["shape"]["id"])
            blocks.append(pick["shape"])
            chosen_meta.append({"shape": pick["shape"], "placements": pick["placements"]})
            remaining = [s for s in scored if s["shape"]["id"] not in used_ids]

        while len(blocks) < 3:
            p = pick_random_shape_weighted(weights)
            blocks.append(p)
            chosen_meta.append({"shape": p, "placements": _count_legal_placements(grid, p["data"])})

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

    blocks = []
    used_ids: set[str] = set()
    clear_candidates = [s for s in scored if s["gap_fills"] > 0 or s["pc_potential"] == 2]
    if clear_candidates:
        blocks.append(clear_candidates[0]["shape"])
        used_ids.add(clear_candidates[0]["shape"]["id"])
    rem = [s for s in scored if s["shape"]["id"] not in used_ids]
    while len(blocks) < 3 and rem:
        pool = [(s, float(s["weight"]) * (1 + math.log1p(s["placements"]))) for s in rem]
        pick = pick_weighted(pool)
        blocks.append(pick["shape"])
        used_ids.add(pick["shape"]["id"])
        rem = [s for s in scored if s["shape"]["id"] not in used_ids]
    while len(blocks) < 3:
        blocks.append(pick_random_shape_weighted(weights))
    return blocks[:3]


def generate_blocks_for_grid(grid: Grid, strategy_config: dict) -> list[dict]:
    return generate_dock_shapes(grid, strategy_config)
