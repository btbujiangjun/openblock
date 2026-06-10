"""客观几何难度（contiguous_regions / concave_corners / height_std）测试。

与 web/src/boardTopology.js countEmptyRegions / countConcaveCorners 跨语言同口径，
并校验 fast_board_features 暴露新键、extract_state_features 维度 = 187。
"""
import numpy as np

import rl_pytorch.fast_grid as fg
from rl_pytorch import features as F
from rl_pytorch.simulator import OpenBlockSimulator


def _occ(rows):
    arr = np.array([[0 if v else -1 for v in r] for r in rows], dtype=np.int8)
    return (arr >= 0)


def test_empty_board_one_region_zero_concave():
    occ = np.zeros((8, 8), dtype=bool)
    assert fg._contiguous_regions(occ) == 1
    assert fg._concave_corners(occ) == 0


def test_full_board_zero_region():
    occ = np.ones((8, 8), dtype=bool)
    assert fg._contiguous_regions(occ) == 0
    assert fg._concave_corners(occ) == 0


def test_wall_splits_into_two_regions():
    occ = np.zeros((8, 8), dtype=bool)
    occ[:, 4] = True
    assert fg._contiguous_regions(occ) == 2


def test_surrounded_hole_concave_corners():
    occ = np.zeros((8, 8), dtype=bool)
    occ[2, 3] = occ[4, 3] = occ[3, 2] = occ[3, 4] = True  # 围住 (3,3) 的「+」形
    # 中心 (3,3) 贡献 4 个凹角，4 个对角空格 (2,2)/(2,4)/(4,2)/(4,4) 各贡献 1 → 共 8。
    assert fg._concave_corners(occ) == 8


def test_cross_language_parity_fixed_board():
    """与 JS 内联实现在同一 8×8 棋盘上的已知答案（regions=1, concave=11）。"""
    rows = [
        [1, 1, 0, 0, 0, 0, 1, 0],
        [1, 0, 0, 1, 1, 0, 0, 0],
        [0, 0, 1, 1, 0, 0, 1, 1],
        [0, 1, 0, 0, 0, 1, 0, 0],
        [0, 0, 0, 1, 1, 0, 0, 0],
        [1, 0, 0, 0, 0, 0, 1, 0],
        [0, 0, 1, 0, 1, 0, 0, 0],
        [0, 1, 0, 0, 0, 0, 0, 1],
    ]
    occ = _occ(rows)
    assert fg._contiguous_regions(occ) == 1
    assert fg._concave_corners(occ) == 11


def test_fast_board_features_exposes_new_keys():
    sim = OpenBlockSimulator("normal")
    gnp = fg.grid_to_np(sim.grid)
    bf = fg.fast_board_features(gnp)
    for k in ("contiguous_regions", "concave_corners", "height_std"):
        assert k in bf


def test_state_dim_matches_encoding():
    # v12：state = 25 结构 + 19 颜色 + 4 spawn_diff + 3 strategy + 11 condition + 64 grid + 75 dock = 201
    assert F.STATE_FEATURE_DIM == 201
    assert F.PHI_DIM == 216
    sim = OpenBlockSimulator("normal")
    st = F.extract_state_features(sim.grid, sim.dock)
    assert st.shape[0] == 201
