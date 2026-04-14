"""与 web/src/bot/simulator.js 对齐的无头对局（v5：精简奖励 + 直接监督信号）。"""

from __future__ import annotations

import copy
import random
from .game_rules import RL_REWARD_SHAPING, WIN_SCORE_THRESHOLD, strategy_python
from .block_spawn import generate_blocks_for_grid, generate_dock_shapes
from .grid import Grid
from .shapes_data import get_all_shapes

__all__ = ["BlockBlastSimulator", "board_potential", "generate_blocks_for_grid", "generate_dock_shapes"]

_BOARD_POT_NORM = 30.0   # board_potential 归一化分母
_SURVIVAL_NORM  = 30.0   # 生存步数归一化分母

_POT_CFG = dict((RL_REWARD_SHAPING.get("potentialShaping") or {}))
_POT_ENABLED = bool(_POT_CFG.get("enabled", False))
_POT_COEF = float(_POT_CFG.get("coef", 0.5))
_POT_W_HOLE = float(_POT_CFG.get("holeWeight", -0.4))
_POT_W_TRANS = float(_POT_CFG.get("transitionWeight", -0.08))
_POT_W_WELL = float(_POT_CFG.get("wellWeight", -0.15))
_POT_W_CLOSE = float(_POT_CFG.get("closeToFullWeight", 0.35))
_POT_W_MOB = float(_POT_CFG.get("mobilityWeight", 0.12))


def _count_holes(grid: Grid) -> int:
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


def _count_transitions(grid: Grid) -> int:
    n = grid.size
    total = 0
    for y in range(n):
        prev = True
        for x in range(n):
            cur = grid.cells[y][x] is not None
            if cur != prev:
                total += 1
            prev = cur
        if not prev:
            total += 1
    for x in range(n):
        prev = True
        for y in range(n):
            cur = grid.cells[y][x] is not None
            if cur != prev:
                total += 1
            prev = cur
        if not prev:
            total += 1
    return total


def _well_depth_sum(grid: Grid) -> int:
    n = grid.size
    total = 0
    for x in range(n):
        for y in range(n):
            if grid.cells[y][x] is not None:
                continue
            left = x == 0 or grid.cells[y][x - 1] is not None
            right = x == n - 1 or grid.cells[y][x + 1] is not None
            if left and right:
                total += 1
    return total


def _close_to_full_count(grid: Grid) -> int:
    n = grid.size
    count = 0
    for y in range(n):
        f = sum(1 for x in range(n) if grid.cells[y][x] is not None)
        if f >= n - 2:
            count += 1
    for x in range(n):
        f = sum(1 for y in range(n) if grid.cells[y][x] is not None)
        if f >= n - 2:
            count += 1
    return count


def _dock_mobility(grid: Grid, dock: list[dict]) -> int:
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


def board_potential(grid: Grid, dock: list[dict]) -> float:
    """势函数 Φ(s)：加权盘面结构质量，用于 Δ 塑形。值域约 [-30, +10]。"""
    holes = _count_holes(grid)
    trans = _count_transitions(grid)
    wells = _well_depth_sum(grid)
    close = _close_to_full_count(grid)
    mob = _dock_mobility(grid, dock)
    return (
        _POT_W_HOLE * holes
        + _POT_W_TRANS * trans
        + _POT_W_WELL * wells
        + _POT_W_CLOSE * close
        + _POT_W_MOB * (mob / 10.0)
    )


def _max_column_height(grid: Grid) -> int:
    """最高列的高度（从底部算起有格子的行数）。"""
    n = grid.size
    max_h = 0
    for x in range(n):
        for y in range(n):
            if grid.cells[y][x] is not None:
                h = n - y
                if h > max_h:
                    max_h = h
                break
    return max_h


def _count_clears_fast(grid: Grid, shape: list[list[int]], gx: int, gy: int) -> int:
    """就地计算放置后的消除行列数，不做完整 clone。"""
    n = grid.size
    cells = grid.cells
    affected_rows: set[int] = set()
    affected_cols: set[int] = set()
    for y, row in enumerate(shape):
        for x, v in enumerate(row):
            if v:
                affected_rows.add(gy + y)
                affected_cols.add(gx + x)

    count = 0
    for ry in affected_rows:
        full = True
        for cx in range(n):
            if cells[ry][cx] is None:
                is_shape_cell = False
                for sy, sr in enumerate(shape):
                    for sx, sv in enumerate(sr):
                        if sv and gx + sx == cx and gy + sy == ry:
                            is_shape_cell = True
                            break
                    if is_shape_cell:
                        break
                if not is_shape_cell:
                    full = False
                    break
        if full:
            count += 1

    for rx in affected_cols:
        full = True
        for cy in range(n):
            if cells[cy][rx] is None:
                is_shape_cell = False
                for sy, sr in enumerate(shape):
                    for sx, sv in enumerate(sr):
                        if sv and gx + sx == rx and gy + sy == cy:
                            is_shape_cell = True
                            break
                    if is_shape_cell:
                        break
                if not is_shape_cell:
                    full = False
                    break
        if full:
            count += 1

    return count


class BlockBlastSimulator:
    def __init__(self, strategy_id: str = "normal"):
        self.strategy_id = strategy_id
        self._holes_cache: int | None = None
        self._last_clears: int = 0
        self.reset()

    def reset(self) -> None:
        cfg = strategy_python(self.strategy_id)
        self.win_score_threshold = WIN_SCORE_THRESHOLD
        self.strategy_config = cfg
        self.scoring = cfg["scoring"]
        self.grid = Grid(cfg["grid_width"])
        self.grid.init_board(cfg["fill_ratio"], cfg.get("shape_weights"))
        self.score = 0
        self.total_clears = 0
        self.steps = 0
        self.placements = 0
        self._holes_cache = None
        self._last_clears = 0
        self._spawn_dock()

    def _spawn_dock(self) -> None:
        shapes = generate_blocks_for_grid(self.grid, self.strategy_config)
        colors = list(range(int(self.strategy_config.get("color_count", 8))))
        random.shuffle(colors)
        self.dock: list[dict] = []
        all_shapes = get_all_shapes()
        for i in range(3):
            shape = shapes[i] if i < len(shapes) else all_shapes[0]
            self.dock.append(
                {
                    "id": shape["id"],
                    "shape": copy.deepcopy(shape["data"]),
                    "color_idx": colors[i % len(colors)],
                    "placed": False,
                }
            )

    def _get_holes(self) -> int:
        if self._holes_cache is None:
            self._holes_cache = _count_holes(self.grid)
        return self._holes_cache

    def count_holes(self) -> int:
        """当前盘面空洞格数（与即时奖励塑形、训练辅助损失一致）。"""
        return self._get_holes()

    def get_legal_actions(self) -> list[dict[str, int]]:
        actions = []
        for bi, b in enumerate(self.dock):
            if b["placed"]:
                continue
            for gy in range(self.grid.size):
                for gx in range(self.grid.size):
                    if self.grid.can_place(b["shape"], gx, gy):
                        actions.append({"block_idx": bi, "gx": gx, "gy": gy})
        return actions

    def count_clears_if_placed(self, block_idx: int, gx: int, gy: int) -> int:
        b = self.dock[block_idx]
        return _count_clears_fast(self.grid, b["shape"], gx, gy)

    def is_terminal(self) -> bool:
        remaining = [b for b in self.dock if not b["placed"]]
        if not remaining:
            return False
        return not self.grid.has_any_move(self.dock)

    def check_feasibility(self) -> float:
        """1.0 if ALL remaining dock blocks can be placed (at least one legal move each), else 0.0."""
        for b in self.dock:
            if b["placed"]:
                continue
            has_move = False
            for gy in range(self.grid.size):
                for gx in range(self.grid.size):
                    if self.grid.can_place(b["shape"], gx, gy):
                        has_move = True
                        break
                if has_move:
                    break
            if not has_move:
                return 0.0
        return 1.0

    def get_supervision_signals(self) -> dict[str, float]:
        """一次调用返回所有直接监督目标值（board_quality / feasibility）。"""
        return {
            "board_quality": board_potential(self.grid, self.dock) / _BOARD_POT_NORM,
            "feasibility": self.check_feasibility(),
        }

    def step(self, block_idx: int, gx: int, gy: int) -> float:
        b = self.dock[block_idx]
        if b["placed"] or not self.grid.can_place(b["shape"], gx, gy):
            return 0.0

        holes_before = self._get_holes()
        pot_before = board_potential(self.grid, self.dock) if _POT_ENABLED else 0.0
        prev_score = self.score
        self.grid.place(b["shape"], b["color_idx"], gx, gy)
        self.placements += 1
        self.steps += 1

        result = self.grid.check_lines()
        gain = 0.0
        self._last_clears = 0
        if result["count"] > 0:
            self._last_clears = int(result["count"])
            c = self._last_clears
            self.total_clears += c
            s = self.scoring
            if c == 1:
                gain = float(s["single_line"])
            elif c == 2:
                gain = float(s["multi_line"])
            else:
                gain = float(s["combo"] + (c - 2) * s["multi_line"])
            self.score += gain

        b["placed"] = True
        if all(x["placed"] for x in self.dock):
            self._spawn_dock()

        self._holes_cache = None

        # v5: 精简奖励 = 得分增量 + 势函数塑形 + 胜利奖励
        # 其余「每步放置质量」由直接监督头学习，不注入奖励
        r = gain

        if _POT_ENABLED:
            pot_after = board_potential(self.grid, self.dock)
            r += _POT_COEF * (pot_after - pot_before)

        rs = RL_REWARD_SHAPING
        wb = float(rs.get("winBonus") or 0.0)
        thr = getattr(self, "win_score_threshold", WIN_SCORE_THRESHOLD)
        if wb and self.score >= thr and prev_score < thr:
            r += wb
        return r
