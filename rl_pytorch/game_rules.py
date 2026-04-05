"""从仓库根 shared/game_rules.json 加载玩法与特征元数据（与 web/src/gameRules.js 同源）。"""

from __future__ import annotations

import json
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_SHARED_RULES = _ROOT / "shared" / "game_rules.json"


def _load_rules() -> dict:
    with open(_SHARED_RULES, encoding="utf-8") as f:
        return json.load(f)


_DATA = _load_rules()


def training_strategy_id() -> str:
    return str(_DATA.get("rlTrainingStrategyId") or _DATA.get("defaultStrategyId") or "normal")


def strategy_python(strategy_id: str | None = None) -> dict:
    sid = strategy_id or training_strategy_id()
    raw = _DATA["strategies"][sid]
    return {
        "fill_ratio": float(raw["fillRatio"]),
        "grid_width": int(raw["gridWidth"]),
        "scoring": {
            "single_line": float(raw["scoring"]["singleLine"]),
            "multi_line": float(raw["scoring"]["multiLine"]),
            "combo": float(raw["scoring"]["combo"]),
        },
        "shape_weights": {k: float(v) for k, v in raw["shapeWeights"].items()},
        "color_count": int(raw.get("colorCount", 8)),
    }


NORMAL_STRATEGY = strategy_python()
WIN_SCORE_THRESHOLD = int(_DATA["winScoreThreshold"])
FEATURE_ENCODING = dict(_DATA["featureEncoding"])
RL_REWARD_SHAPING = dict(_DATA.get("rlRewardShaping") or {})
