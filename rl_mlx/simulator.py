"""与 web/src/bot/simulator.js 对齐的无头对局。"""

from __future__ import annotations

import copy
from .game_rules import CLEAR_SCORING, RL_REWARD_SHAPING, WIN_SCORE_THRESHOLD, rl_bonus_block_icons, strategy_python
from .block_spawn import generate_blocks_for_grid, generate_dock_shapes
from .grid import Grid
from .dock_color_bias import mono_near_full_line_color_weights, pick_three_dock_colors
from .shapes_data import get_all_shapes

__all__ = ["OpenBlockSimulator", "generate_blocks_for_grid", "generate_dock_shapes"]

_ICON_BONUS_LINE_MULT = float(CLEAR_SCORING.get("iconBonusLineMult") or 5)
_PERFECT_CLEAR_MULT = float(CLEAR_SCORING.get("perfectClearMult") or 10)
_RL_BONUS_ICONS: list[str] | None = rl_bonus_block_icons()

# Combo 倍数 + grace 窗口（与 shared/game_rules.json → clearScoring.comboMultiplier 同源）
_COMBO_CFG_RAW = CLEAR_SCORING.get("comboMultiplier") or {}
_COMBO_ENABLED = bool(_COMBO_CFG_RAW.get("enabled", True))
_COMBO_GRACE = max(1, int(_COMBO_CFG_RAW.get("gracePlacements") or 3))
_COMBO_ACTIVATION = max(
    1, int(_COMBO_CFG_RAW.get("activationCount") or _COMBO_CFG_RAW.get("activationStreak") or 3)
)
_COMBO_STEP = max(0.0, float(_COMBO_CFG_RAW.get("stepBonus") or 0.0))
_COMBO_MAX = max(1.0, float(_COMBO_CFG_RAW.get("maxMultiplier") or 1.0))


def _derive_combo_multiplier(combo_count: int) -> float:
    if not _COMBO_ENABLED:
        return 1.0
    n = max(0, int(combo_count or 0))
    if n < _COMBO_ACTIVATION:
        return 1.0
    raw = 1.0 + (n - _COMBO_ACTIVATION + 1) * _COMBO_STEP
    return min(_COMBO_MAX, max(1.0, raw))


def _derive_next_combo_count(
    prev_combo_count: int, rounds_since_last_clear: float, cleared_this_placement: bool
) -> int:
    if not _COMBO_ENABLED:
        return 0
    if not cleared_this_placement:
        return max(0, int(prev_combo_count or 0))
    prev = max(0, int(prev_combo_count or 0))
    if prev == 0:
        return 1
    if rounds_since_last_clear is None or rounds_since_last_clear == float("inf"):
        return 1
    gap = max(0, int(rounds_since_last_clear or 0))
    return 1 if gap >= _COMBO_GRACE else prev + 1


def _clear_score_gain(
    scoring: dict,
    clear_count: int,
    bonus_line_count: int,
    perfect_clear: bool = False,
    combo_count: int = 0,
) -> float:
    if clear_count <= 0:
        return 0.0
    base_unit = float(scoring.get("single_line") or 20)
    base_score = base_unit * clear_count * clear_count
    b = min(int(bonus_line_count), int(clear_count))
    if b <= 0:
        subtotal = base_score
    else:
        line_score = base_unit * clear_count
        icon_bonus = line_score * b * (_ICON_BONUS_LINE_MULT - 1)
        subtotal = base_score + icon_bonus
    perfect_mult = _PERFECT_CLEAR_MULT if perfect_clear else 1.0
    combo_mult = _derive_combo_multiplier(combo_count)
    return subtotal * perfect_mult * combo_mult


def _is_perfect_clear(grid: Grid) -> bool:
    return all(cell is None for row in grid.cells for cell in row)


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
        # Combo 链（grace 窗口）—— 与 web 主局 _comboCount / _roundsSinceLastClear 同口径
        self._combo_count = 0
        self._rounds_since_last_clear: float = float("inf")
        self._spawn_dock()

    def _difficulty_target_for_spawn(self) -> float:
        """将当前局面状态映射为出块难度目标 [0, 1]（与 rl_pytorch 版同口径）。"""
        base = max(0.0, min(1.0, getattr(self, "max_scd", 0.5)))
        n = self.grid.size
        fill = sum(
            1 for row in self.grid.cells for c in row if c is not None
        ) / max(n * n, 1)
        if fill >= 0.75:
            base = max(0.0, base - 0.2 * (fill - 0.75) / 0.25)
        thr = WIN_SCORE_THRESHOLD
        if thr > 0 and self.score > 0:
            progress = min(1.0, self.score / thr)
            if progress > 0.7:
                base = min(1.0, base + 0.1 * (progress - 0.7) / 0.3)
        return max(0.0, min(1.0, base))

    def _spawn_dock(self) -> None:
        dt = self._difficulty_target_for_spawn()
        shapes = generate_blocks_for_grid(self.grid, self.strategy_config, difficulty_target=dt)
        n_colors = int(self.strategy_config.get("color_count", 8))
        bias = mono_near_full_line_color_weights(self.grid, _RL_BONUS_ICONS)
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
        return sim.check_lines(bonus_block_icons=_RL_BONUS_ICONS)["count"]

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

        result = self.grid.check_lines(bonus_block_icons=_RL_BONUS_ICONS)
        gain = 0.0
        clears = 0
        if result["count"] > 0:
            clears = int(result["count"])
            self.total_clears += clears
            c = clears
            bonus_n = len(result.get("bonus_lines") or [])
            self._combo_count = _derive_next_combo_count(
                self._combo_count, self._rounds_since_last_clear, True
            )
            self._rounds_since_last_clear = 0
            gain = _clear_score_gain(
                self.scoring,
                c,
                bonus_n,
                _is_perfect_clear(self.grid),
                combo_count=self._combo_count,
            )
            self.score += gain
        else:
            if self._rounds_since_last_clear != float("inf"):
                self._rounds_since_last_clear += 1

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
