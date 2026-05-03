"""与 web/src/bot/simulator.js 对齐的无头对局（v6：numpy 加速 + 精简奖励 + 直接监督信号）。"""

from __future__ import annotations

import copy
import numpy as np

from .game_rules import RL_REWARD_SHAPING, WIN_SCORE_THRESHOLD, strategy_python
from .block_spawn import generate_blocks_for_grid, generate_dock_shapes
from .grid import Grid
from .dock_color_bias import mono_near_full_line_color_weights, pick_three_dock_colors
from .shapes_data import get_all_shapes
from . import fast_grid as _fg

__all__ = ["OpenBlockSimulator", "board_potential", "generate_blocks_for_grid", "generate_dock_shapes"]

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

_ICON_BONUS_LINE_MULT = 5


def _clear_score_gain(scoring: dict, clear_count: int, bonus_line_count: int) -> float:
    """与 web/src/clearScoring.js computeClearScore 一致（bonus 为同色整线）。"""
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


def board_potential(grid: Grid, dock: list[dict]) -> float:
    """势函数 Φ(s)：加权盘面结构质量，用于 Δ 塑形。值域约 [-30, +10]。"""
    gnp = _fg.grid_to_np(grid)
    feats = _fg.fast_board_features(gnp)
    mob = _fg.fast_dock_mobility(gnp, dock)
    return (
        _POT_W_HOLE * feats["holes"]
        + _POT_W_TRANS * (feats["row_trans"] + feats["col_trans"])
        + _POT_W_WELL * feats["wells"]
        + _POT_W_CLOSE * (feats["close1"] + feats["close2"])
        + _POT_W_MOB * (mob / 10.0)
    )


def board_potential_np(grid_np: np.ndarray, dock: list[dict]) -> float:
    """势函数（直接接受 numpy grid，避免重复转换）。"""
    feats = _fg.fast_board_features(grid_np)
    mob = _fg.fast_dock_mobility(grid_np, dock)
    return (
        _POT_W_HOLE * feats["holes"]
        + _POT_W_TRANS * (feats["row_trans"] + feats["col_trans"])
        + _POT_W_WELL * feats["wells"]
        + _POT_W_CLOSE * (feats["close1"] + feats["close2"])
        + _POT_W_MOB * (mob / 10.0)
    )


class OpenBlockSimulator:
    def __init__(self, strategy_id: str = "normal"):
        self.strategy_id = strategy_id
        self._holes_cache: int | None = None
        self._grid_np: np.ndarray | None = None
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
        self._grid_np = None
        self._last_clears = 0
        self._spawn_dock()

    def save_state(self) -> dict:
        """Snapshot for 1-step lookahead (no deep copy of Grid internals, just cells)."""
        return {
            "cells": [row[:] for row in self.grid.cells],
            "dock": [
                {
                    "id": b["id"],
                    "shape": [r[:] for r in b["shape"]],
                    "color_idx": b["color_idx"],
                    "placed": b["placed"],
                }
                for b in self.dock
            ],
            "score": self.score,
            "total_clears": self.total_clears,
            "steps": self.steps,
            "placements": self.placements,
        }

    def restore_state(self, s: dict) -> None:
        n = self.grid.size
        for y in range(n):
            for x in range(n):
                self.grid.cells[y][x] = s["cells"][y][x]
        self.dock = [
            {
                "id": b["id"],
                "shape": [r[:] for r in b["shape"]],
                "color_idx": b["color_idx"],
                "placed": b["placed"],
            }
            for b in s["dock"]
        ]
        self.score = s["score"]
        self.total_clears = s["total_clears"]
        self.steps = s["steps"]
        self.placements = s["placements"]
        self._holes_cache = None
        self._grid_np = None

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

    def _ensure_grid_np(self) -> np.ndarray:
        if self._grid_np is None:
            self._grid_np = _fg.grid_to_np(self.grid)
        return self._grid_np

    def _invalidate_grid_np(self) -> None:
        self._grid_np = None
        self._holes_cache = None

    def _get_holes(self) -> int:
        if self._holes_cache is None:
            gnp = self._ensure_grid_np()
            self._holes_cache = _fg.fast_board_features(gnp)["holes"]
        return self._holes_cache

    def count_holes(self) -> int:
        """当前盘面空洞格数（与即时奖励塑形、训练辅助损失一致）。"""
        return self._get_holes()

    def get_legal_actions(self) -> list[dict[str, int]]:
        gnp = self._ensure_grid_np()
        return _fg.get_all_legal_actions(gnp, self.dock)

    def count_clears_if_placed(self, block_idx: int, gx: int, gy: int) -> int:
        b = self.dock[block_idx]
        return _fg.count_clears_single(self._ensure_grid_np(), _fg.shape_to_np(b["shape"]), gx, gy)

    def batch_count_clears(self, actions: list[dict]) -> np.ndarray:
        """批量消行预测：同一 shape 走 numpy 向量化，不同 shape 分组。"""
        gnp = self._ensure_grid_np()
        groups: dict[int, list[int]] = {}
        for i, a in enumerate(actions):
            groups.setdefault(a["block_idx"], []).append(i)

        result = np.zeros(len(actions), dtype=np.int32)
        for bi, indices in groups.items():
            shape_np = _fg.shape_to_np(self.dock[bi]["shape"])
            positions = np.array([[actions[i]["gy"], actions[i]["gx"]] for i in indices], dtype=np.int32)
            result[indices] = _fg.batch_count_clears(gnp, shape_np, positions)
        return result

    def is_terminal(self) -> bool:
        remaining = [b for b in self.dock if not b["placed"]]
        if not remaining:
            return False
        gnp = self._ensure_grid_np()
        for b in remaining:
            positions = _fg.get_legal_positions(gnp, _fg.shape_to_np(b["shape"]))
            if len(positions) > 0:
                return False
        return True

    def check_feasibility(self) -> float:
        """1.0 if ALL remaining dock blocks can be placed (at least one legal move each), else 0.0."""
        gnp = self._ensure_grid_np()
        for b in self.dock:
            if b["placed"]:
                continue
            positions = _fg.get_legal_positions(gnp, _fg.shape_to_np(b["shape"]))
            if len(positions) == 0:
                return 0.0
        return 1.0

    def count_sequential_solution_leaves(self, leaf_cap: int = 64, node_budget: int = 2000) -> int:
        """统计当前 dock 剩余块是否存在可全部放完的顺序。

        `check_feasibility()` 只看每块单独有无位置；这里枚举真实放置顺序，
        更贴近训练时需要规避的“三块序贯死局”。
        """
        remaining_depth = sum(1 for b in self.dock if not b.get("placed"))
        if remaining_depth <= 0:
            return 1

        saved_root = self.save_state()
        nodes = 0

        def dfs(depth: int) -> int:
            nonlocal nodes
            if depth >= remaining_depth:
                return 1
            if nodes >= node_budget:
                return 0
            legal = self.get_legal_actions()
            if not legal:
                return 0
            subtotal = 0
            state = self.save_state()
            for a in legal:
                if nodes >= node_budget or subtotal >= leaf_cap:
                    break
                nodes += 1
                self.step(a["block_idx"], a["gx"], a["gy"])
                subtotal += dfs(depth + 1)
                self.restore_state(state)
            return min(subtotal, leaf_cap)

        leaves = dfs(0)
        self.restore_state(saved_root)
        return int(min(leaves, leaf_cap))

    def check_sequential_feasibility(self) -> float:
        return 1.0 if self.count_sequential_solution_leaves(leaf_cap=1, node_budget=1200) > 0 else 0.0

    def get_supervision_signals(self) -> dict[str, float]:
        """一次调用返回所有直接监督目标值（board_quality / feasibility）。"""
        return {
            "board_quality": board_potential_np(self._ensure_grid_np(), self.dock) / _BOARD_POT_NORM,
            "feasibility": self.check_sequential_feasibility(),
        }

    def step(self, block_idx: int, gx: int, gy: int) -> float:
        b = self.dock[block_idx]
        if b["placed"] or not self.grid.can_place(b["shape"], gx, gy):
            return 0.0

        holes_before = self._get_holes()
        pot_before = board_potential_np(self._ensure_grid_np(), self.dock) if _POT_ENABLED else 0.0
        prev_score = self.score
        self.grid.place(b["shape"], b["color_idx"], gx, gy)
        self._invalidate_grid_np()
        self.placements += 1
        self.steps += 1

        result = self.grid.check_lines()
        gain = 0.0
        self._last_clears = 0
        if result["count"] > 0:
            self._last_clears = int(result["count"])
            c = self._last_clears
            self.total_clears += c
            bonus_n = len(result.get("bonus_lines") or [])
            gain = _clear_score_gain(self.scoring, c, bonus_n)
            self.score += gain

        b["placed"] = True
        if all(x["placed"] for x in self.dock):
            self._spawn_dock()

        self._invalidate_grid_np()

        # v5: 精简奖励 = 得分增量 + 势函数塑形 + 胜利奖励
        # 其余「每步放置质量」由直接监督头学习，不注入奖励
        r = gain

        if _POT_ENABLED:
            pot_after = board_potential_np(self._ensure_grid_np(), self.dock)
            r += _POT_COEF * (pot_after - pot_before)

        rs = RL_REWARD_SHAPING
        wb = float(rs.get("winBonus") or 0.0)
        thr = getattr(self, "win_score_threshold", WIN_SCORE_THRESHOLD)
        if wb and self.score >= thr and prev_score < thr:
            r += wb
        return r
