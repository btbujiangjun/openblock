"""吸附/贴合约束：fast_grid.edge_exposure 口径 + board_potential 单调性。

edge_exposure = 占用区朝向「界内空格」的 4-邻接边数（墙边不计 → 贴墙=吸附）。
与 web/src/bot/simulator.js _edgeExposure 同口径。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np

from rl_pytorch import fast_grid as fg
from rl_pytorch.grid import Grid
from rl_pytorch.simulator import board_potential


def _grid_from_cells(filled):
    """filled: 集合 of (y, x) → 8×8 Grid。"""
    g = Grid(8)
    for y in range(8):
        for x in range(8):
            g.cells[y][x] = None
    for (y, x) in filled:
        g.cells[y][x] = 0
    return g


def _edge_exposure(filled):
    g = _grid_from_cells(filled)
    return fg.fast_board_features(fg.grid_to_np(g))["edge_exposure"]


def test_empty_and_full_have_zero_exposure():
    assert _edge_exposure(set()) == 0
    full = {(y, x) for y in range(8) for x in range(8)}
    assert _edge_exposure(full) == 0


def test_single_cell_corner_vs_center():
    # 角格：仅 2 个界内空邻（两面贴墙不计）
    assert _edge_exposure({(0, 0)}) == 2
    # 中心格：4 个界内空邻
    assert _edge_exposure({(3, 3)}) == 4


def test_2x2_corner_vs_center():
    corner = {(0, 0), (0, 1), (1, 0), (1, 1)}
    center = {(3, 3), (3, 4), (4, 3), (4, 4)}
    # 角落 2×2：仅右/下两条边暴露 = 4；居中 2×2：四周暴露 = 8
    assert _edge_exposure(corner) == 4
    assert _edge_exposure(center) == 8


def test_board_potential_rewards_adhesion():
    corner = _grid_from_cells({(0, 0), (0, 1), (1, 0), (1, 1)})
    center = _grid_from_cells({(3, 3), (3, 4), (4, 3), (4, 4)})
    # dock=[] 关闭机动性项，凸显吸附差异
    assert board_potential(corner, []) > board_potential(center, [])


def test_js_python_edge_exposure_parity_formula():
    # 与 JS _edgeExposure 等价：界内相邻占用不同的对数（行+列）
    g = _grid_from_cells({(2, 2), (2, 3), (5, 5)})
    occ = fg.occupied_mask(fg.grid_to_np(g)).astype(int)
    expected = int(np.sum(occ[:, :-1] != occ[:, 1:]) + np.sum(occ[:-1, :] != occ[1:, :]))
    assert fg.fast_board_features(fg.grid_to_np(g))["edge_exposure"] == expected
