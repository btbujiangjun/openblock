"""策略 ID one-hot 特征（与 shared/game_rules.json → featureEncoding.strategyIds 对齐）。"""

from __future__ import annotations

import random

import numpy as np

from .game_rules import FEATURE_ENCODING, _DATA

_STRATEGY_IDS: list[str] = list(
    FEATURE_ENCODING.get("strategyIds")
    or (_DATA.get("rlTraining") or {}).get("strategyIds")
    or ["easy", "normal", "hard"]
)
_STRATEGY_DIM = int(FEATURE_ENCODING.get("strategyDim") or len(_STRATEGY_IDS))


def rl_training_strategy_ids() -> list[str]:
    return list(_STRATEGY_IDS)


def sample_rl_training_strategy_id(rng: random.Random | None = None) -> str:
    r = rng or random
    return r.choice(_STRATEGY_IDS)


def encode_strategy_onehot(strategy_id: str | None) -> np.ndarray:
    out = np.zeros(_STRATEGY_DIM, dtype=np.float32)
    sid = strategy_id or "normal"
    try:
        out[_STRATEGY_IDS.index(sid)] = 1.0
    except ValueError:
        out[_STRATEGY_IDS.index("normal")] = 1.0
    return out
