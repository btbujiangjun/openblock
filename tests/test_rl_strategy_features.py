"""RL 策略 one-hot 与 state 维度（190）。"""
from __future__ import annotations

import numpy as np

from rl_pytorch import features as F
from rl_pytorch.grid import Grid
from rl_pytorch.strategy_features import encode_strategy_onehot, rl_training_strategy_ids, sample_rl_training_strategy_id


def test_state_dim_190():
    assert F.STATE_FEATURE_DIM == 190


def test_strategy_onehot():
    ids = rl_training_strategy_ids()
    for sid in ids:
        v = encode_strategy_onehot(sid)
        assert v.sum() == 1.0
    assert sample_rl_training_strategy_id() in ids


def test_extract_state_includes_strategy():
    g = Grid(8)
    dock = [
        {"shape": [[1]], "color_idx": 0, "placed": False},
        {"shape": [[1, 1]], "color_idx": 1, "placed": False},
        {"shape": [[1], [1]], "color_idx": 2, "placed": False},
    ]
    st = F.extract_state_features(g, dock, "easy")
    assert st.shape[0] == 190
    strat = encode_strategy_onehot("easy")
    np.testing.assert_array_equal(st[48:51], strat)
