"""与 web/src/bot/simulator.js 对齐的无头对局。"""

from __future__ import annotations

import copy
from .game_rules import RL_REWARD_SHAPING, WIN_SCORE_THRESHOLD, strategy_python
from .block_spawn import generate_blocks_for_grid, generate_dock_shapes
from .grid import Grid
from .dock_color_bias import mono_near_full_line_color_weights, pick_three_dock_colors
from .shapes_data import get_all_shapes

__all__ = ["OpenBlockSimulator", "generate_blocks_for_grid", "generate_dock_shapes"]

_ICON_BONUS_LINE_MULT = 5


def _clear_score_gain(scoring: dict, clear_count: int, bonus_line_count: int) -> float:
    if clear_count <= 0:
        return 0.0
    base_unit = float(scoring.get("single_line") or 20)
    base_score = base_unit * clear_count * clear_count
    b = min(int(bonus_line_count), int(clear_count))
    if b <= 0:
        return base_score
    line_score = base_unit * clear_count
    icon_bonus = line_score * b * (_ICON_BONUS_LINE_MULT - 1)
    return base_score + icon_bonus


class OpenBlockSimulator:
    def __init__(self, strategy_id: str = "normal"):
        self.strategy_id = strategy_id
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
        self._spawn_dock()

    def _spawn_dock(self) -> None:
        shapes = generate_blocks_for_grid(self.grid, self.strategy_config)
        n_colors = int(self.strategy_config.get("color_count", 8))
        bias = mono_near_full_line_color_weights(self.grid)
        dock_colors = pick_three_dock_colors(bias, n_colors=n_colors)
        self.dock: list[dict] = []
        all_shapes = get_all_shapes()
        for i in range(3):
            shape = shapes[i] if i < len(shapes) else all_shapes[0]
            self.dock.append(
                {
                    "id": shape["id"],
                    "shape": copy.deepcopy(shape["data"]),
                    "color_idx": dock_colors[i],
                    "placed": False,
                }
            )

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
        sim = self.grid.clone()
        sim.place(b["shape"], b["color_idx"], gx, gy)
        return sim.check_lines()["count"]

    def is_terminal(self) -> bool:
        remaining = [b for b in self.dock if not b["placed"]]
        if not remaining:
            return False
        return not self.grid.has_any_move(self.dock)

    def step(self, block_idx: int, gx: int, gy: int) -> float:
        b = self.dock[block_idx]
        if b["placed"] or not self.grid.can_place(b["shape"], gx, gy):
            return 0.0

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
            bonus_n = len(result.get("bonus_lines") or [])
            gain = _clear_score_gain(self.scoring, c, bonus_n)
            self.score += gain

        b["placed"] = True
        if all(x["placed"] for x in self.dock):
            self._spawn_dock()

        r = gain
        rs = RL_REWARD_SHAPING
        pb = float(rs.get("placeBonus") or 0.0)
        if pb:
            r += pb
        dc = float(rs.get("densePerClear") or 0.0)
        if dc and clears > 0:
            r += dc * clears
        wb = float(rs.get("winBonus") or 0.0)
        thr = getattr(self, "win_score_threshold", WIN_SCORE_THRESHOLD)
        if wb and self.score >= thr and prev_score < thr:
            r += wb
        return r
