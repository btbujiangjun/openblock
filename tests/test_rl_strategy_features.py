"""RL 策略 one-hot + v12 condition token 维度（201）。"""
from __future__ import annotations

import numpy as np

from rl_pytorch import features as F
from rl_pytorch.condition_token import (
    ARC_DIM,
    CONDITION_ARCS,
    CONDITION_DIM,
    CONDITION_INTENTS,
    INTENT_DIM,
    encode_condition_onehot,
    sample_condition,
)
from rl_pytorch.game_rules import FEATURE_ENCODING
from rl_pytorch.grid import Grid
from rl_pytorch.strategy_features import encode_strategy_onehot, rl_training_strategy_ids, sample_rl_training_strategy_id


def test_state_dim_matches_encoding():
    assert F.STATE_FEATURE_DIM == int(FEATURE_ENCODING["stateDim"]) == 201
    assert F.PHI_DIM == 216


def test_strategy_onehot():
    ids = rl_training_strategy_ids()
    for sid in ids:
        v = encode_strategy_onehot(sid)
        assert v.sum() == 1.0
    assert sample_rl_training_strategy_id() in ids


def test_condition_onehot_dim():
    assert CONDITION_DIM == ARC_DIM + INTENT_DIM == 11
    v = encode_condition_onehot("peak", "pressure")
    assert v.shape == (CONDITION_DIM,)
    assert v[CONDITION_ARCS.index("peak")] == 1.0
    assert v[ARC_DIM + CONDITION_INTENTS.index("pressure")] == 1.0
    assert encode_condition_onehot(None, None).sum() == 0.0


def test_extract_state_includes_strategy_and_condition():
    g = Grid(8)
    dock = [
        {"shape": [[1]], "color_idx": 0, "placed": False},
        {"shape": [[1, 1]], "color_idx": 1, "placed": False},
        {"shape": [[1], [1]], "color_idx": 2, "placed": False},
    ]
    st = F.extract_state_features(g, dock, "easy", arc="peak", intent="pressure")
    assert st.shape[0] == 201
    scalar_dim = int(FEATURE_ENCODING["stateScalarDim"])
    strat_off = scalar_dim - CONDITION_DIM - 3
    cond_off = scalar_dim - CONDITION_DIM
    np.testing.assert_array_equal(st[strat_off:strat_off + 3], encode_strategy_onehot("easy"))
    np.testing.assert_array_equal(st[cond_off:cond_off + CONDITION_DIM], encode_condition_onehot("peak", "pressure"))


def test_sample_condition_within_vocab():
    for _ in range(20):
        arc, intent = sample_condition()
        if arc is None:
            assert intent is None
        else:
            assert arc in CONDITION_ARCS
            assert intent in CONDITION_INTENTS
