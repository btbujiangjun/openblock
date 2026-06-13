"""block_spawn v2 出块算法测试：验证盘面拓扑感知 + 消行得分潜力 + 产品目标对齐。"""

from __future__ import annotations

import random

import pytest

from rl_pytorch.grid import Grid
from rl_pytorch.block_spawn import (
    _BoardAnalysis,
    _best_clear_count,
    _clear_position_ratio,
    _near_full_delta,
    _scoring_potential,
    generate_dock_shapes,
    generate_blocks_for_grid,
)
from rl_pytorch import fast_grid as _fg


STRATEGY_CONFIG = {
    "grid_width": 8,
    "fill_ratio": 0.0,
    "scoring": {"single_line": 20, "multi_line": 60, "combo": 100},
    "shape_weights": {
        "lines": 2.15, "rects": 1.55, "squares": 1.35,
        "tshapes": 1.12, "zshapes": 1.12, "lshapes": 1.2, "jshapes": 1.12,
    },
}


def _make_grid(fill_ratio: float = 0.0, seed: int = 42) -> Grid:
    g = Grid(8)
    if fill_ratio > 0:
        random.seed(seed)
        g.init_board(fill_ratio, STRATEGY_CONFIG.get("shape_weights"))
    return g


def _nearly_full_grid(rows_to_leave: int = 1) -> Grid:
    """构造差 rows_to_leave 行即满的盘面。"""
    g = Grid(8)
    for y in range(8 - rows_to_leave):
        for x in range(8):
            g.cells[y][x] = random.randint(0, 7)
    return g


def _grid_with_near_full_row(empty_cols: list[int] | None = None) -> Grid:
    """构造某行差 1~2 格满的盘面。"""
    g = Grid(8)
    if empty_cols is None:
        empty_cols = [3]
    for x in range(8):
        if x not in empty_cols:
            g.cells[4][x] = 1
    return g


class TestBoardAnalysis:
    def test_empty_board(self):
        g = _make_grid(0.0)
        ba = _BoardAnalysis(g)
        assert ba.fill == 0.0
        assert ba.holes == 0
        assert ba.near_full_total == 0
        assert ba.board_quality > 0.5

    def test_partial_fill(self):
        g = _make_grid(0.3, seed=123)
        ba = _BoardAnalysis(g)
        assert 0.1 < ba.fill < 0.5
        assert ba.occupied > 0

    def test_near_full_row(self):
        g = _grid_with_near_full_row([3])
        ba = _BoardAnalysis(g)
        assert ba.near_full_rows >= 1


class TestClearAnalysis:
    def test_best_clear_count_empty(self):
        g = _make_grid(0.0)
        grid_np = _fg.grid_to_np(g)
        shape_1x1 = [[1]]
        assert _best_clear_count(grid_np, shape_1x1) == 0

    def test_best_clear_count_near_full_row(self):
        g = _grid_with_near_full_row([3])
        grid_np = _fg.grid_to_np(g)
        shape_1x1 = [[1]]
        clears = _best_clear_count(grid_np, shape_1x1)
        assert clears >= 1

    def test_scoring_potential(self):
        g = _grid_with_near_full_row([3])
        grid_np = _fg.grid_to_np(g)
        shape_1x1 = [[1]]
        scoring = {"single_line": 20}
        pot = _scoring_potential(grid_np, shape_1x1, scoring)
        assert pot >= 20.0

    def test_clear_position_ratio(self):
        g = _grid_with_near_full_row([3])
        grid_np = _fg.grid_to_np(g)
        shape_1x1 = [[1]]
        ratio = _clear_position_ratio(grid_np, shape_1x1)
        assert 0.0 < ratio <= 1.0

    def test_near_full_delta_empty(self):
        g = _make_grid(0.0)
        grid_np = _fg.grid_to_np(g)
        shape_bar = [[1, 1, 1, 1]]
        delta = _near_full_delta(g, grid_np, shape_bar)
        assert isinstance(delta, float)


class TestGenerateDockShapes:
    def test_returns_three_shapes(self):
        g = _make_grid(0.2, seed=42)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG)
        assert len(shapes) == 3
        for s in shapes:
            assert "id" in s
            assert "data" in s

    def test_empty_board(self):
        g = _make_grid(0.0)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG)
        assert len(shapes) == 3

    def test_high_fill(self):
        g = _make_grid(0.5, seed=99)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG)
        assert len(shapes) == 3
        for s in shapes:
            assert g.can_place_anywhere(s["data"])

    def test_difficulty_target_low_prefers_clearable(self):
        """低 difficulty_target（送爽）的三块序贯协同消行不低于高 dt。

        v3 构造式出块优化了序贯协同消行能力，因此衡量指标为三块按
        最优顺序放置的总消行数（而非单块在原始盘面上的独立消行数）。
        """
        g = _grid_with_near_full_row([3])

        relief_seq_clears = 0
        pressure_seq_clears = 0
        n_trials = 30

        def _greedy_total_clears(grid: Grid, shapes: list[dict]) -> int:
            from rl_pytorch.spawn_construction import _sim_sequence_greedy
            datas = [s["data"] for s in shapes]
            best = 0
            for perm in [(0,1,2),(0,2,1),(1,0,2),(1,2,0),(2,0,1),(2,1,0)]:
                total, _, ok = _sim_sequence_greedy(grid, datas, list(perm))
                if ok and total > best:
                    best = total
            return best

        for i in range(n_trials):
            random.seed(i + 3000)
            shapes_relief = generate_dock_shapes(
                g, STRATEGY_CONFIG, difficulty_target=0.1,
            )
            relief_seq_clears += _greedy_total_clears(g, shapes_relief)

            random.seed(i + 4000)
            shapes_pressure = generate_dock_shapes(
                g, STRATEGY_CONFIG, difficulty_target=0.9,
            )
            pressure_seq_clears += _greedy_total_clears(g, shapes_pressure)

        assert relief_seq_clears >= pressure_seq_clears

    def test_backward_compatible_api(self):
        """generate_blocks_for_grid 保持向后兼容。"""
        g = _make_grid(0.2, seed=42)
        shapes = generate_blocks_for_grid(g, STRATEGY_CONFIG)
        assert len(shapes) == 3

    def test_difficulty_target_param(self):
        """verify difficulty_target kwarg accepted."""
        g = _make_grid(0.2, seed=42)
        shapes = generate_blocks_for_grid(g, STRATEGY_CONFIG, difficulty_target=0.7)
        assert len(shapes) == 3

    def test_no_duplicate_shapes(self):
        """同一 dock 内应无重复形状 ID（除非形状池已耗尽）。"""
        g = _make_grid(0.2, seed=42)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG)
        ids = [s["id"] for s in shapes]
        assert len(ids) == len(set(ids))

    def test_all_shapes_placeable(self):
        """返回的每个形状至少有一个合法放置位置。"""
        g = _make_grid(0.3, seed=55)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG)
        for s in shapes:
            assert g.can_place_anywhere(s["data"]), f"Shape {s['id']} has no legal placement"
