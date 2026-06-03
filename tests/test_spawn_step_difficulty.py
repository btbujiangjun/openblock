"""单步出块难度 Python 镜像测试 + 与 JS 实现的跨语言契约。

跨语言契约：tests/fixtures/spawnStepDifficulty.cases.json 由 JS 实现
(web/src/spawnStepDifficulty.js) 生成；本测试断言 Python 实现
(rl_pytorch/spawn_step_difficulty.py) 在相同输入下产出一致结果。
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from rl_pytorch.spawn_step_difficulty import (
    compute_spawn_step_difficulty,
    classify_triplet,
    scd_score,
    scd_level,
    is_long_bar,
    is_killer_shape,
    shape_cell_count,
    difficulty_bucket,
    spawn_step_difficulty_features,
    SPAWN_STEP_DIFFICULTY_FEATURE_DIM,
    DIFFICULTY_BUCKETS,
    SPAWN_STEP_DIFFICULTY_VERSION,
)

S1 = [[1]]
BAR = [[1, 1, 1, 1]]
COL = [[1], [1], [1], [1]]
SQ2 = [[1, 1], [1, 1]]
SQ3 = [[1, 1, 1], [1, 1, 1], [1, 1, 1]]
L3 = [[1, 0], [1, 0], [1, 1]]

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "spawnStepDifficulty.cases.json")


def test_shape_cell_count():
    assert shape_cell_count(S1) == 1
    assert shape_cell_count(BAR) == 4
    assert shape_cell_count(SQ3) == 9
    assert shape_cell_count(None) == 0


def test_is_long_bar():
    assert is_long_bar(BAR) is True
    assert is_long_bar(COL) is True
    assert is_long_bar(SQ2) is False
    assert is_long_bar(SQ3) is False
    assert is_long_bar(L3) is False
    assert is_long_bar([[1, 1, 1]]) is False


def test_is_killer_shape():
    assert is_killer_shape(SQ3, None) is True
    assert is_killer_shape(BAR, None) is True
    assert is_killer_shape(SQ2, None) is False
    assert is_killer_shape(SQ3, lambda d: 30) is False
    assert is_killer_shape(SQ3, lambda d: 3) is True


def test_classify_triplet():
    r = classify_triplet([SQ3, BAR, SQ2])
    assert r["comboTotalCells"] == 17
    assert r["comboLongBarCnt"] == 1
    assert r["comboKillerCnt"] == 2
    assert r["isHomogeneousFamily"] is False
    assert classify_triplet([SQ2, SQ2, SQ2])["isHomogeneousFamily"] is True


def test_scd():
    assert scd_score(8, 0) == pytest.approx(8 / 64.001, abs=1e-4)
    assert scd_level(0.1) == "ample"
    assert scd_level(0.4) == "tight"
    assert scd_level(0.9) == "scarce"


def test_difficulty_bucket_boundaries():
    assert difficulty_bucket(0.0) == "trivial"
    assert difficulty_bucket(0.2) == "trivial"
    assert difficulty_bucket(0.21) == "easy"
    assert difficulty_bucket(0.6) == "standard"
    assert difficulty_bucket(0.81) == "extreme"
    assert difficulty_bucket(1.5) == "extreme"


def test_monotonicity():
    easy = compute_spawn_step_difficulty(
        [S1, S1, SQ2], occupied_count=0, board_difficulty=0,
        solution_metrics={"solutionCount": 40},
    )
    hard = compute_spawn_step_difficulty(
        [SQ3, BAR, SQ2], occupied_count=50, board_difficulty=0.85,
        solution_metrics={"solutionCount": 2},
    )
    assert hard["stepDifficulty"] > easy["stepDifficulty"]
    assert hard["bucket"] == "extreme"
    assert easy["bucket"] == "trivial"
    assert hard["version"] == SPAWN_STEP_DIFFICULTY_VERSION
    assert hard["bucket"] in DIFFICULTY_BUCKETS


@pytest.mark.parametrize("case", json.load(open(FIXTURE, encoding="utf-8")))
def test_cross_lang_contract(case):
    inp = case["input"]
    expected = case["expected"]
    got = compute_spawn_step_difficulty(
        inp["shapes"],
        occupied_count=inp["occupiedCount"],
        board_difficulty=inp["boardDifficulty"],
        solution_metrics=inp["solutionMetrics"],
    )
    assert got["stepDifficulty"] == pytest.approx(expected["stepDifficulty"], abs=1e-6)
    assert got["bucket"] == expected["bucket"]
    assert got["comboKillerCnt"] == expected["comboKillerCnt"]
    assert got["comboLongBarCnt"] == expected["comboLongBarCnt"]
    assert got["scdScore"] == pytest.approx(expected["scdScore"], abs=1e-6)

    feats = spawn_step_difficulty_features(inp["shapes"], inp["occupiedCount"])
    assert len(feats) == SPAWN_STEP_DIFFICULTY_FEATURE_DIM
    for got_v, exp_v in zip(feats, expected["features"]):
        assert got_v == pytest.approx(exp_v, abs=1e-6)


def test_rl_feature_subvector_range():
    f = spawn_step_difficulty_features([SQ3, BAR, SQ2], 50)
    assert len(f) == SPAWN_STEP_DIFFICULTY_FEATURE_DIM
    assert all(0.0 <= v <= 1.0 for v in f)
