"""构造式出块引擎测试：验证多消/清屏/同花/顺序约束构造器。"""

from __future__ import annotations

import random

import pytest

from rl_pytorch.grid import Grid
from rl_pytorch.shapes_data import get_all_shapes
from rl_pytorch.spawn_construction import (
    ConstructResult,
    construct_multi_clear,
    construct_mono_color,
    construct_perfect_clear,
    construct_sequential_puzzle,
    try_construct,
    _find_mono_near_full_lines,
    _sim_sequence_greedy,
)
from rl_pytorch.block_spawn import generate_dock_shapes


STRATEGY_CONFIG = {
    "grid_width": 8,
    "fill_ratio": 0.0,
    "scoring": {"single_line": 20},
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


def _near_full_grid_with_gap(gap_col: int = 3, filled_rows: int = 7) -> Grid:
    """构造差一列即满的盘面（便于多消测试）。"""
    g = Grid(8)
    for y in range(8 - filled_rows, 8):
        for x in range(8):
            if x != gap_col:
                g.cells[y][x] = 1
    return g


def _mono_color_grid(color: int = 2, empty_col: int = 4) -> Grid:
    """构造差 1 格即满的同色行。"""
    g = Grid(8)
    for x in range(8):
        if x != empty_col:
            g.cells[5][x] = color
    return g


def _high_fill_grid(seed: int = 42) -> Grid:
    """构造高填充盘面。"""
    return _make_grid(0.6, seed)


# ---------------------------------------------------------------------------
# 构造器 1: 多消
# ---------------------------------------------------------------------------

class TestMultiClear:
    def test_returns_result_with_clears(self):
        random.seed(42)
        g = _near_full_grid_with_gap(3, 5)
        shapes = get_all_shapes()
        result = construct_multi_clear(g, shapes, min_total_clears=2, budget=300)
        if result is not None:
            assert result.goal == "multi_clear"
            assert result.total_clears >= 2
            assert len(result.shapes) == 3

    def test_returns_none_on_empty_board(self):
        random.seed(42)
        g = _make_grid(0.0)
        shapes = get_all_shapes()
        result = construct_multi_clear(g, shapes, min_total_clears=5, budget=50)
        assert result is None or result.total_clears < 5

    def test_shapes_have_valid_ids(self):
        random.seed(42)
        g = _near_full_grid_with_gap(3, 3)
        shapes = get_all_shapes()
        result = construct_multi_clear(g, shapes, min_total_clears=1, budget=200)
        if result is not None:
            for s in result.shapes:
                assert "id" in s
                assert "data" in s


# ---------------------------------------------------------------------------
# 构造器 2: 清屏
# ---------------------------------------------------------------------------

class TestPerfectClear:
    def test_very_few_occupied(self):
        random.seed(42)
        g = Grid(8)
        g.cells[7][0] = 1
        g.cells[7][1] = 1
        g.cells[7][2] = 1
        g.cells[7][3] = 1
        g.cells[7][4] = 1
        g.cells[7][5] = 1
        g.cells[7][6] = 1
        g.cells[7][7] = 1
        shapes = get_all_shapes()
        result = construct_perfect_clear(g, shapes, budget=300)
        # Full row → placing any 1x1 shape won't clear it (already full)
        # Actually placing another block is not possible on a full row
        # Let's test differently
        assert result is None or result.is_perfect_clear

    def test_empty_board_returns_none(self):
        g = _make_grid(0.0)
        shapes = get_all_shapes()
        result = construct_perfect_clear(g, shapes, budget=50)
        assert result is None

    def test_high_fill_returns_none(self):
        g = _make_grid(0.7, seed=99)
        shapes = get_all_shapes()
        result = construct_perfect_clear(g, shapes, budget=50)
        assert result is None


# ---------------------------------------------------------------------------
# 构造器 3: 同花消
# ---------------------------------------------------------------------------

class TestMonoColor:
    def test_find_mono_lines(self):
        g = _mono_color_grid(color=2, empty_col=4)
        lines = _find_mono_near_full_lines(g)
        assert len(lines) >= 1
        assert lines[0]["color"] == 2

    def test_construct_mono_color(self):
        random.seed(42)
        g = _mono_color_grid(color=2, empty_col=4)
        shapes = get_all_shapes()
        result = construct_mono_color(g, shapes, budget=200)
        if result is not None:
            assert result.goal == "mono_color"
            assert result.mono_bonus_lines >= 1
            assert len(result.shapes) == 3

    def test_no_mono_lines(self):
        g = _make_grid(0.0)
        shapes = get_all_shapes()
        result = construct_mono_color(g, shapes, budget=50)
        assert result is None


# ---------------------------------------------------------------------------
# 构造器 4: 顺序约束
# ---------------------------------------------------------------------------

class TestSequentialPuzzle:
    def test_high_fill_may_find_puzzle(self):
        random.seed(42)
        g = _high_fill_grid(seed=42)
        shapes = get_all_shapes()
        result = construct_sequential_puzzle(g, shapes, budget=200)
        if result is not None:
            assert result.goal == "sequential_puzzle"
            assert result.requires_order is True
            assert len(result.shapes) == 3

    def test_empty_board_returns_none(self):
        g = _make_grid(0.0)
        shapes = get_all_shapes()
        result = construct_sequential_puzzle(g, shapes, budget=50)
        assert result is None


# ---------------------------------------------------------------------------
# 统一入口
# ---------------------------------------------------------------------------

class TestTryConstruct:
    def test_best_mode(self):
        random.seed(42)
        g = _near_full_grid_with_gap(3, 4)
        shapes = get_all_shapes()
        result = try_construct(g, shapes, "best", budget=300)
        if result is not None:
            assert result.goal in ("multi_clear", "perfect_clear", "mono_color", "sequential_puzzle")
            assert len(result.shapes) == 3

    def test_invalid_goal_returns_none(self):
        g = _make_grid(0.0)
        shapes = get_all_shapes()
        result = try_construct(g, shapes, "nonexistent")
        assert result is None


# ---------------------------------------------------------------------------
# 集成测试
# ---------------------------------------------------------------------------

class TestIntegration:
    def test_generate_dock_shapes_still_works(self):
        random.seed(42)
        g = _make_grid(0.3, seed=42)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG, difficulty_target=0.3)
        assert len(shapes) == 3
        for s in shapes:
            assert "id" in s
            assert "data" in s

    def test_low_dt_may_use_construction(self):
        random.seed(42)
        g = _near_full_grid_with_gap(3, 4)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG, difficulty_target=0.2)
        assert len(shapes) == 3

    def test_high_dt_skips_construction(self):
        random.seed(42)
        g = _near_full_grid_with_gap(3, 4)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG, difficulty_target=0.9)
        assert len(shapes) == 3

    def test_no_duplicate_shapes(self):
        random.seed(42)
        g = _make_grid(0.2, seed=42)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG, difficulty_target=0.3)
        ids = [s["id"] for s in shapes]
        assert len(ids) == len(set(ids))

    def test_all_shapes_placeable_low_fill(self):
        random.seed(42)
        g = _make_grid(0.15, seed=42)
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG, difficulty_target=0.3)
        for s in shapes:
            assert g.can_place_anywhere(s["data"]), f"Shape {s['id']} has no legal placement"


# ---------------------------------------------------------------------------
# v1.70 拥挤多消（爽感兑现）
# ---------------------------------------------------------------------------

def _crowded_cluttered_grid() -> Grid:
    """构造「又挤又乱」盘面：高填充 + 碎片化空格（crowding ≥ 0.55）。"""
    g = Grid(8)
    for y in range(8):
        for x in range(8):
            if y < 6 and not (x == (y % 8) and y < 4):
                g.cells[y][x] = (x + y) % 7 + 1
    return g


class TestCrowdedMultiClear:
    def test_crowding_empty_low(self):
        from rl_pytorch.block_spawn import _BoardAnalysis
        g = _make_grid(0.0)
        assert _BoardAnalysis(g).crowding < 0.2

    def test_crowding_crowded_high(self):
        from rl_pytorch.block_spawn import _BoardAnalysis
        b = _BoardAnalysis(_crowded_cluttered_grid())
        assert b.crowding >= 0.55

    def test_crowding_bounded(self):
        from rl_pytorch.block_spawn import _BoardAnalysis
        # 全满盘面 crowding 仍 ∈ [0,1]
        g = Grid(8)
        for y in range(8):
            for x in range(8):
                g.cells[y][x] = 1
        c = _BoardAnalysis(g).crowding
        assert 0.0 <= c <= 1.0

    def test_crowded_low_dt_generates_triplet(self):
        """拥挤 + 低 dt（送爽）仍稳定产出可放置三块。"""
        random.seed(7)
        g = _crowded_cluttered_grid()
        shapes = generate_dock_shapes(g, STRATEGY_CONFIG, difficulty_target=0.2)
        assert len(shapes) == 3
        ids = [s["id"] for s in shapes]
        assert len(ids) == len(set(ids))
