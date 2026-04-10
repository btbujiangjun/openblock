"""与 web/src/bot/simulator.js 对齐的无头对局。"""

from __future__ import annotations

import copy
import random
from .game_rules import RL_REWARD_SHAPING, WIN_SCORE_THRESHOLD, strategy_python
from .block_spawn import generate_blocks_for_grid, generate_dock_shapes
from .grid import Grid
from .shapes_data import get_all_shapes

__all__ = ["BlockBlastSimulator", "generate_blocks_for_grid", "generate_dock_shapes"]


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

    def step(self, block_idx: int, gx: int, gy: int) -> float:
        b = self.dock[block_idx]
        if b["placed"] or not self.grid.can_place(b["shape"], gx, gy):
            return 0.0

        holes_before = self._get_holes()
        prev_score = self.score
        self.grid.place(b["shape"], b["color_idx"], gx, gy)
        self.placements += 1
        self.steps += 1

        result = self.grid.check_lines()
        gain = 0.0
        clears = 0
        if result["count"] > 0:
            clears = int(result["count"])
            self.total_clears += clears
            c = clears
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
        holes_after = self._get_holes()
        delta_holes = holes_after - holes_before

        r = gain
        rs = RL_REWARD_SHAPING

        pb = float(rs.get("placeBonus") or 0.0)
        if pb:
            r += pb

        dc = float(rs.get("densePerClear") or 0.0)
        if dc and clears > 0:
            r += dc * clears

        mcb = float(rs.get("multiClearBonus") or 0.0)
        if mcb and clears >= 2:
            r += mcb * (clears - 1)

        svl = float(rs.get("survivalPerStep") or 0.0)
        if svl:
            r += svl

        hp = float(rs.get("holePenaltyPerCell") or 0.0)
        if hp and delta_holes > 0:
            r += hp * delta_holes

        grb = float(rs.get("gapReductionBonus") or 0.0)
        if grb and delta_holes < 0:
            r += grb * abs(delta_holes)

        hp_h = float(rs.get("heightPenalty") or 0.0)
        if hp_h:
            r += hp_h * (_max_column_height(self.grid) / self.grid.size)

        wb = float(rs.get("winBonus") or 0.0)
        thr = getattr(self, "win_score_threshold", WIN_SCORE_THRESHOLD)
        if wb and self.score >= thr and prev_score < thr:
            r += wb
        return r
