"""RL 风格条件 token（v12）—— RoR arc + spawnIntent 的 one-hot 编码。

与 web/src/bot/conditionToken.js 逐位对齐。顺序唯一数据源：
shared/game_rules.json → rlRewardShaping.conditionToken。

不泄漏论证：token 在 step 开始前已知（自博弈时由 simulator 随机采样，推理时由调用方
显式指定）；其语义是"假设玩家此刻处于该节奏档"，不依赖未来 dock。simulator 自身在
_spawn_dock 时按 token 调整轻量 stress（同 RoR 设计意图），训练完成的是一族风格策略。
"""
from __future__ import annotations

import random

import numpy as np

from .game_rules import FEATURE_ENCODING, RL_REWARD_SHAPING

_CT_CFG = dict((RL_REWARD_SHAPING.get("conditionToken") or {}))
CONDITION_ARCS: list[str] = list(_CT_CFG.get("arcs") or ["opener", "momentum", "peak", "fatigue", "cooldown"])
CONDITION_INTENTS: list[str] = list(
    _CT_CFG.get("intents") or ["relief", "engage", "pressure", "flow", "harvest", "maintain"]
)
CONDITION_ENABLED: bool = bool(_CT_CFG.get("enabled", True))
CONDITION_SAMPLING_PROB: float = float(_CT_CFG.get("samplingProb", 0.6))

ARC_DIM = int(FEATURE_ENCODING.get("conditionArcDim") or len(CONDITION_ARCS))
INTENT_DIM = int(FEATURE_ENCODING.get("conditionIntentDim") or len(CONDITION_INTENTS))
CONDITION_DIM = ARC_DIM + INTENT_DIM

if ARC_DIM != len(CONDITION_ARCS):
    raise ValueError(f"conditionArcDim={ARC_DIM} 与 arcs 数量 {len(CONDITION_ARCS)} 不一致")
if INTENT_DIM != len(CONDITION_INTENTS):
    raise ValueError(f"conditionIntentDim={INTENT_DIM} 与 intents 数量 {len(CONDITION_INTENTS)} 不一致")


def encode_condition_onehot(arc: str | None, intent: str | None) -> np.ndarray:
    """One-hot 编码 (arc, intent)。任一为 None 或未识别 → 该段全零（"无条件"）。"""
    out = np.zeros(CONDITION_DIM, dtype=np.float32)
    if not CONDITION_ENABLED:
        return out
    if arc in CONDITION_ARCS:
        out[CONDITION_ARCS.index(arc)] = 1.0
    if intent in CONDITION_INTENTS:
        out[ARC_DIM + CONDITION_INTENTS.index(intent)] = 1.0
    return out


def sample_condition(rng: random.Random | None = None) -> tuple[str | None, str | None]:
    """自博弈训练时按 samplingProb 决定是否采样一组 (arc, intent)；否则返回 (None, None)。"""
    r = rng or random
    if not CONDITION_ENABLED or r.random() >= CONDITION_SAMPLING_PROB:
        return None, None
    return r.choice(CONDITION_ARCS), r.choice(CONDITION_INTENTS)
