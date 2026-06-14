"""空间规划廉价 3 维跨语言契约：rl_pytorch/spatial_planning.py ↔ web/src/spatialPlanning.js。

共享 fixtures：tests/fixtures/spatialPlanning.cases.json（由 JS SSOT 生成 / 手工核验）。
rows 中 1=占用、0=空格；Python 侧转 grid_np（占用 ≥0、空格 -1）后比对。
"""
import json
import os

import numpy as np
import pytest

from rl_pytorch.spatial_planning import (
    SPATIAL_PLANNING_FEATURE_DIM,
    spatial_planning_features,
)

_FIX = os.path.join(os.path.dirname(__file__), "fixtures", "spatialPlanning.cases.json")
with open(_FIX, encoding="utf-8") as fh:
    _CASES = json.load(fh)


def _grid_np(rows):
    arr = np.full((len(rows), len(rows[0])), -1, dtype=np.int8)
    for y, row in enumerate(rows):
        for x, v in enumerate(row):
            if v:
                arr[y, x] = 0
    return arr


@pytest.mark.parametrize("case", _CASES, ids=[c["name"] for c in _CASES])
def test_spatial_planning_features_parity(case):
    got = spatial_planning_features(_grid_np(case["rows"]))
    assert len(got) == SPATIAL_PLANNING_FEATURE_DIM
    for g, exp in zip(got, case["features"]):
        assert g == pytest.approx(exp, abs=1e-6)
