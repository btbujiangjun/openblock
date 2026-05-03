"""与 rl_pytorch/game_rules.py 相同：从 shared/game_rules.json 加载。"""

from __future__ import annotations

import json
import os
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
_RL_CURRICULUM = dict(_DATA.get("rlCurriculum") or {})
_RL_BONUS_SCORING = dict(_DATA.get("rlBonusScoring") or {})


def rl_bonus_block_icons() -> list[str] | None:
    """与网页 canonical bonus 对齐：仅当 JSON 提供非空 blockIcons 时启用 icon 整线判定。"""
    if _RL_BONUS_SCORING.get("useGameplayBonusRules") is False:
        return None
    raw = _RL_BONUS_SCORING.get("blockIcons")
    if isinstance(raw, list) and len(raw) > 0:
        return [str(x) for x in raw]
    return None


def rl_curriculum_enabled() -> bool:
    if os.environ.get("RL_CURRICULUM", "").strip().lower() in ("0", "false", "no", "off"):
        return False
    return bool(_RL_CURRICULUM.get("enabled", False))


def rl_win_threshold_for_episode(episode_1based: int) -> int:
    end_cfg = int(_DATA.get("winScoreThreshold", 220))
    if not rl_curriculum_enabled():
        return end_cfg
    start = int(_RL_CURRICULUM.get("winThresholdStart", 120))
    end = int(_RL_CURRICULUM.get("winThresholdEnd", end_cfg))
    span = max(1, int(_RL_CURRICULUM.get("rampEpisodes", 40000)))
    t = min(1.0, max(0, episode_1based - 1) / span)
    v = start + (end - start) * t
    return int(round(v))
