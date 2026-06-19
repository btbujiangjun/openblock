"""构造式出块引擎 v1：通过前向模拟搜索满足特定产品目标的三块组合。

业界算法融合
-----------
- **反向构造** (Block Blast / Reverse Construction)：从目标状态（清屏/多消）反推所需形状
- **前向协同模拟** (Tetris AI)：模拟三块最佳放置序列，评估协同消行能力
- **约束满足** (Sturgeon / CSP)：将构造目标编码为硬约束，搜索满足所有约束的组合
- **路径依赖** (Path Dependency)：构造必须按特定顺序放置才能成功的组合

四个构造器
---------
1. MultiClearConstructor  — 构造三块协同多消（总消行 ≥ 阈值）
2. PerfectClearConstructor — 构造三块序贯清屏（全放完后盘面为空）
3. MonoColorConstructor   — 构造同花消（选择形状使近满同色线能触发 bonus）
4. SequentialPuzzleConstructor — 构造顺序约束（必须先消行才能放下后续块）
"""

from __future__ import annotations

import random
from dataclasses import dataclass

from .grid import Grid
from .shapes_data import get_all_shapes
from . import fast_grid as _fg


@dataclass(slots=True)
class ConstructResult:
    """构造器搜索结果。"""
    goal: str
    shapes: list[dict]
    total_clears: int
    is_perfect_clear: bool
    mono_bonus_lines: int
    requires_order: bool
    best_sequence: list[int] | None = None
    score_estimate: float = 0.0


# ---------------------------------------------------------------------------
# 共用前向模拟核心
# ---------------------------------------------------------------------------

def _sim_place_and_clear(grid: Grid, shape_data: list[list[int]], gx: int, gy: int) -> tuple[Grid, int]:
    """放置 + 消行，返回新盘面和消行数。"""
    g = grid.clone()
    g.place(shape_data, 0, gx, gy)
    result = g.check_lines()
    return g, int(result["count"])


def _is_board_empty(grid: Grid) -> bool:
    return all(cell is None for row in grid.cells for cell in row)


def _find_best_placement(grid: Grid, shape_data: list[list[int]]) -> tuple[int, int, int] | None:
    """找到使消行数最大的放置位置。返回 (gx, gy, clears) 或 None。

    numpy 向量化：get_legal_positions + batch_count_clears 一次算完，
    替代旧版 n² 次 can_place + clone()+check_lines()（profile 热点）。
    """
    grid_np = _fg.grid_to_np(grid)
    shape_np = _fg.shape_to_np(shape_data)
    return _fg.best_placement_np(grid_np, shape_np)


def _sim_sequence_greedy(
    grid: Grid, datas: list[list[list[int]]], order: list[int]
) -> tuple[int, bool, bool]:
    """贪心模拟：每步选消行最多的位置。返回 (总消行, 是否清屏, 是否全部放完)。

    全程在 numpy int8 棋盘上推进，零 Grid.clone()/check_lines()——这是 dock 构造
    spawner 的最热内循环（旧实现占采集总耗时一半以上）。
    """
    grid_np = _fg.grid_to_np(grid)
    shapes_np = [_fg.shape_to_np(d) for d in datas]
    total = 0
    for idx in order:
        shape_np = shapes_np[idx]
        placement = _fg.best_placement_np(grid_np, shape_np)
        if placement is None:
            return total, False, False
        gx, gy, clears = placement
        grid_np, _ = _fg.place_and_clear_np(grid_np, shape_np, gx, gy)
        total += clears
    is_pc = bool((grid_np < 0).all())
    return total, is_pc, True


# ---------------------------------------------------------------------------
# 构造器 1: 多消构造
# ---------------------------------------------------------------------------

def construct_multi_clear(
    grid: Grid,
    all_shapes: list[dict],
    *,
    min_total_clears: int = 3,
    budget: int = 200,
    weights: dict[str, float] | None = None,
) -> ConstructResult | None:
    """搜索三块组合，使得按最优顺序放置的总消行数 >= min_total_clears。

    算法：
    1. 预筛选：只保留能放置且有消行潜力（或补洞能力）的形状
    2. 随机采样三块组合，模拟 6 种放置顺序
    3. 取总消行最大的组合和顺序
    """
    placeable = [
        s for s in all_shapes
        if grid.can_place_anywhere(s["data"])
    ]
    if len(placeable) < 3:
        return None

    grid_np = _fg.grid_to_np(grid)

    scored: list[tuple[dict, int]] = []
    for s in placeable:
        shape_np = _fg.shape_to_np(s["data"])
        positions = _fg.get_legal_positions(grid_np, shape_np)
        if len(positions) == 0:
            continue
        clears = _fg.batch_count_clears(grid_np, shape_np, positions)
        scored.append((s, int(clears.max())))

    scored.sort(key=lambda x: x[1], reverse=True)
    can_clear = [s for s, c in scored if c > 0]

    best_result: ConstructResult | None = None
    best_total = 0

    perms_3 = [(0, 1, 2), (0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0)]

    for _ in range(budget):
        if len(can_clear) >= 1 and len(placeable) >= 3:
            first = random.choice(can_clear[:min(6, len(can_clear))])
            remaining_pool = [s for s in placeable if s["id"] != first["id"]]
            if len(remaining_pool) < 2:
                continue
            rest = random.sample(remaining_pool[:min(12, len(remaining_pool))], 2)
            triplet = [first, rest[0], rest[1]]
        else:
            triplet = random.sample(placeable[:min(15, len(placeable))], min(3, len(placeable)))
            if len(triplet) < 3:
                continue

        datas = [t["data"] for t in triplet]

        for perm in perms_3:
            total, is_pc, all_placed = _sim_sequence_greedy(grid, datas, list(perm))
            if not all_placed:
                continue
            if total > best_total:
                best_total = total
                best_result = ConstructResult(
                    goal="multi_clear",
                    shapes=list(triplet),
                    total_clears=total,
                    is_perfect_clear=is_pc,
                    mono_bonus_lines=0,
                    requires_order=False,
                    best_sequence=list(perm),
                    score_estimate=20.0 * total * total,
                )
            if total >= min_total_clears and is_pc:
                best_result.is_perfect_clear = True
                return best_result

    if best_result and best_result.total_clears >= min_total_clears:
        return best_result
    return None


# ---------------------------------------------------------------------------
# 构造器 2: 清屏构造（反向构造 + 前向验证）
# ---------------------------------------------------------------------------

def construct_perfect_clear(
    grid: Grid,
    all_shapes: list[dict],
    *,
    budget: int = 300,
) -> ConstructResult | None:
    """搜索三块组合使三块全放完后盘面为空。

    算法（反向构造启发）：
    1. 计算盘面剩余占用格数 → 需要消行清除的总格数
    2. 候选筛选：偏好能大量消行的形状
    3. 模拟：对每个候选三元组的 6 种排列做贪心搜索
    """
    n = grid.size
    occupied = sum(1 for row in grid.cells for c in row if c is not None)
    if occupied == 0:
        return None
    if occupied > n * n * 0.6:
        return None

    placeable = [s for s in all_shapes if grid.can_place_anywhere(s["data"])]
    if len(placeable) < 3:
        return None

    grid_np = _fg.grid_to_np(grid)
    with_clears: list[tuple[dict, int]] = []
    for s in placeable:
        shape_np = _fg.shape_to_np(s["data"])
        positions = _fg.get_legal_positions(grid_np, shape_np)
        if len(positions) == 0:
            continue
        clears = _fg.batch_count_clears(grid_np, shape_np, positions)
        mc = int(clears.max())
        with_clears.append((s, mc))

    with_clears.sort(key=lambda x: x[1], reverse=True)
    top_clearers = [s for s, c in with_clears if c > 0][:10]
    others = [s for s, c in with_clears][:15]

    perms_3 = [(0, 1, 2), (0, 2, 1), (1, 0, 2), (1, 2, 0), (2, 0, 1), (2, 1, 0)]

    for _ in range(budget):
        if top_clearers and len(others) >= 2:
            a = random.choice(top_clearers)
            pool = [s for s in others if s["id"] != a["id"]]
            if len(pool) < 2:
                continue
            bc = random.sample(pool[:10], 2)
            triplet = [a, bc[0], bc[1]]
        else:
            if len(placeable) < 3:
                continue
            triplet = random.sample(placeable[:12], 3)

        datas = [t["data"] for t in triplet]
        for perm in perms_3:
            total, is_pc, all_placed = _sim_sequence_greedy(grid, datas, list(perm))
            if is_pc and all_placed:
                return ConstructResult(
                    goal="perfect_clear",
                    shapes=list(triplet),
                    total_clears=total,
                    is_perfect_clear=True,
                    mono_bonus_lines=0,
                    requires_order=False,
                    best_sequence=list(perm),
                    score_estimate=20.0 * total * total * 10.0,
                )
    return None


# ---------------------------------------------------------------------------
# 构造器 3: 同花消构造
# ---------------------------------------------------------------------------

def _find_mono_near_full_lines(grid: Grid) -> list[dict]:
    """找到差 1~2 格即满且已填充格同色的行/列。"""
    n = grid.size
    lines: list[dict] = []

    for y in range(n):
        filled_colors: list[int] = []
        empty_positions: list[tuple[int, int]] = []
        for x in range(n):
            c = grid.cells[y][x]
            if c is not None:
                filled_colors.append(int(c))
            else:
                empty_positions.append((x, y))
        if 1 <= len(empty_positions) <= 2 and filled_colors:
            if all(c == filled_colors[0] for c in filled_colors):
                lines.append({
                    "type": "row",
                    "idx": y,
                    "color": filled_colors[0],
                    "empty": empty_positions,
                    "empty_count": len(empty_positions),
                })

    for x in range(n):
        filled_colors = []
        empty_positions = []
        for y in range(n):
            c = grid.cells[y][x]
            if c is not None:
                filled_colors.append(int(c))
            else:
                empty_positions.append((x, y))
        if 1 <= len(empty_positions) <= 2 and filled_colors:
            if all(c == filled_colors[0] for c in filled_colors):
                lines.append({
                    "type": "col",
                    "idx": x,
                    "color": filled_colors[0],
                    "empty": empty_positions,
                    "empty_count": len(empty_positions),
                })

    return lines


def _shape_covers_positions(
    shape_data: list[list[int]], gx: int, gy: int, targets: list[tuple[int, int]]
) -> bool:
    """检查形状在 (gx, gy) 放置后是否覆盖所有目标位置。"""
    covered: set[tuple[int, int]] = set()
    for sy, row in enumerate(shape_data):
        for sx, v in enumerate(row):
            if v:
                covered.add((gx + sx, gy + sy))
    return all(t in covered for t in targets)


def construct_mono_color(
    grid: Grid,
    all_shapes: list[dict],
    *,
    budget: int = 150,
) -> ConstructResult | None:
    """构造三块使近满同色线能通过同色块完成 bonus 消行。

    算法：
    1. 找到所有差 1~2 格的同色近满线
    2. 对每条线，搜索能精确填补空位的形状（约束满足）
    3. 组合其余两块，确保三元组可全部放完
    """
    mono_lines = _find_mono_near_full_lines(grid)
    if not mono_lines:
        return None

    placeable = [s for s in all_shapes if grid.can_place_anywhere(s["data"])]
    if len(placeable) < 3:
        return None

    n = grid.size
    mono_lines.sort(key=lambda l: l["empty_count"])

    for line in mono_lines:
        target_color = line["color"]
        empty_pos = line["empty"]

        filler_shapes: list[tuple[dict, int, int]] = []
        for s in placeable:
            data = s["data"]
            for gy in range(n):
                for gx in range(n):
                    if not grid.can_place(data, gx, gy):
                        continue
                    if _shape_covers_positions(data, gx, gy, empty_pos):
                        g2, clears = _sim_place_and_clear(grid, data, gx, gy)
                        if clears > 0:
                            filler_shapes.append((s, gx, gy))
                            break
                else:
                    continue
                break

        if not filler_shapes:
            continue

        for filler, fx, fy in filler_shapes[:5]:
            g_after, _ = _sim_place_and_clear(grid, filler["data"], fx, fy)
            remaining_pool = [
                s for s in placeable
                if s["id"] != filler["id"] and g_after.can_place_anywhere(s["data"])
            ]
            if len(remaining_pool) < 2:
                continue

            for _ in range(min(budget, 50)):
                rest = random.sample(
                    remaining_pool[:min(10, len(remaining_pool))], 2
                )
                triplet = [filler, rest[0], rest[1]]
                datas = [t["data"] for t in triplet]

                perms_3 = [
                    (0, 1, 2), (0, 2, 1), (1, 0, 2),
                    (1, 2, 0), (2, 0, 1), (2, 1, 0),
                ]
                for perm in perms_3:
                    total, is_pc, all_placed = _sim_sequence_greedy(
                        grid, datas, list(perm)
                    )
                    if all_placed and total > 0:
                        return ConstructResult(
                            goal="mono_color",
                            shapes=list(triplet),
                            total_clears=total,
                            is_perfect_clear=is_pc,
                            mono_bonus_lines=1,
                            requires_order=False,
                            best_sequence=list(perm),
                            score_estimate=20.0 * total * total * 5.0,
                            # mono bonus multiplied
                        )
    return None


# ---------------------------------------------------------------------------
# 构造器 4: 顺序约束构造
# ---------------------------------------------------------------------------

def construct_sequential_puzzle(
    grid: Grid,
    all_shapes: list[dict],
    *,
    budget: int = 200,
) -> ConstructResult | None:
    """构造三块使得只有特定放置顺序才能成功（需先消行腾空间）。

    算法（路径依赖构造）：
    1. 找一个大块 A 当前无法放置
    2. 找一个块 B 能消行腾出空间
    3. 验证 B→消行→A 可行、但 A 单独不可放
    4. 补第三块 C，确保三块可全部放完
    """
    n = grid.size
    placeable = [s for s in all_shapes if grid.can_place_anywhere(s["data"])]
    unplaceable = [s for s in all_shapes if not grid.can_place_anywhere(s["data"])]

    if not unplaceable or len(placeable) < 2:
        return None

    grid_np = _fg.grid_to_np(grid)
    clearers: list[tuple[dict, int, int, int, Grid]] = []
    for s in placeable:
        data = s["data"]
        for gy in range(n):
            for gx in range(n):
                if not grid.can_place(data, gx, gy):
                    continue
                g2, clears = _sim_place_and_clear(grid, data, gx, gy)
                if clears >= 1:
                    clearers.append((s, gx, gy, clears, g2))
                    break
            else:
                continue
            break

    if not clearers:
        return None

    clearers.sort(key=lambda x: x[3], reverse=True)

    for _ in range(budget):
        clearer, cx, cy, c_clears, g_after_clear = random.choice(
            clearers[:min(8, len(clearers))]
        )

        newly_placeable = [
            s for s in unplaceable
            if g_after_clear.can_place_anywhere(s["data"])
        ]
        if not newly_placeable:
            continue

        unlocked = random.choice(newly_placeable[:min(5, len(newly_placeable))])

        placement_after = _find_best_placement(g_after_clear, unlocked["data"])
        if placement_after is None:
            continue
        ux, uy, u_clears = placement_after

        g_after_unlock, _ = _sim_place_and_clear(
            g_after_clear, unlocked["data"], ux, uy
        )

        third_pool = [
            s for s in placeable
            if s["id"] != clearer["id"]
            and s["id"] != unlocked["id"]
            and g_after_unlock.can_place_anywhere(s["data"])
        ]
        if not third_pool:
            third_pool = [
                s for s in all_shapes
                if s["id"] != clearer["id"]
                and s["id"] != unlocked["id"]
                and g_after_unlock.can_place_anywhere(s["data"])
            ]
        if not third_pool:
            continue

        third = random.choice(third_pool[:min(8, len(third_pool))])

        total_clears = c_clears + u_clears
        tp = _find_best_placement(g_after_unlock, third["data"])
        if tp:
            g_final, final_clears = _sim_place_and_clear(
                g_after_unlock, third["data"], tp[0], tp[1]
            )
            total_clears += final_clears

        triplet = [clearer, unlocked, third]
        return ConstructResult(
            goal="sequential_puzzle",
            shapes=triplet,
            total_clears=total_clears,
            is_perfect_clear=False,
            mono_bonus_lines=0,
            requires_order=True,
            best_sequence=[0, 1, 2],
            score_estimate=20.0 * total_clears * total_clears,
        )
    return None


# ---------------------------------------------------------------------------
# 统一入口
# ---------------------------------------------------------------------------

def try_construct(
    grid: Grid,
    all_shapes: list[dict],
    goal: str,
    *,
    budget: int = 200,
    weights: dict[str, float] | None = None,
    min_total_clears: int = 3,
) -> ConstructResult | None:
    """尝试按指定目标构造三块组合。

    Parameters
    ----------
    goal : str
        "multi_clear" | "perfect_clear" | "mono_color" | "sequential_puzzle" | "best"
        "best" 模式按优先级依次尝试所有构造器。
    """
    if goal == "perfect_clear":
        return construct_perfect_clear(grid, all_shapes, budget=budget)
    elif goal == "multi_clear":
        return construct_multi_clear(
            grid, all_shapes, min_total_clears=min_total_clears,
            budget=budget, weights=weights,
        )
    elif goal == "mono_color":
        return construct_mono_color(grid, all_shapes, budget=budget)
    elif goal == "sequential_puzzle":
        return construct_sequential_puzzle(grid, all_shapes, budget=budget)
    elif goal == "best":
        pc = construct_perfect_clear(grid, all_shapes, budget=budget // 4)
        if pc:
            return pc
        mc = construct_multi_clear(
            grid, all_shapes, min_total_clears=min_total_clears,
            budget=budget // 3, weights=weights,
        )
        mono = construct_mono_color(grid, all_shapes, budget=budget // 4)
        seq = construct_sequential_puzzle(grid, all_shapes, budget=budget // 4)

        candidates = [r for r in (mc, mono, seq) if r is not None]
        if not candidates:
            return None
        candidates.sort(key=lambda r: r.score_estimate, reverse=True)
        return candidates[0]
    return None
