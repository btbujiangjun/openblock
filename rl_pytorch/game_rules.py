"""从仓库根 shared/game_rules.json 加载玩法与特征元数据（与 web/src/gameRules.js 同源）。"""

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
    """训练用胜利门槛爬坡是否启用（可被 RL_CURRICULUM=0 关闭）。"""
    if os.environ.get("RL_CURRICULUM", "").strip().lower() in ("0", "false", "no", "off"):
        return False
    return bool(_RL_CURRICULUM.get("enabled", False))


def rl_win_threshold_for_episode(episode_1based: int) -> int:
    """当前训练局（从 1 计）对应的「计胜」分数门槛；用于 simulator 与 collect_episode。

    未启用课程时恒为 winScoreThreshold。
    自适应课程请使用 rl_win_threshold_adaptive()。
    """
    end_cfg = int(_DATA.get("winScoreThreshold", 220))
    if not rl_curriculum_enabled():
        return end_cfg
    start = int(_RL_CURRICULUM.get("winThresholdStart", 120))
    end = int(_RL_CURRICULUM.get("winThresholdEnd", end_cfg))
    span = max(1, int(_RL_CURRICULUM.get("rampEpisodes", 40000)))
    t = min(1.0, max(0, episode_1based - 1) / span)
    v = start + (end - start) * t
    return int(round(v))


# ---------------------------------------------------------------------------
# 自适应课程配置（v8）
# ---------------------------------------------------------------------------
_RL_ADAPTIVE = dict((_DATA.get("rlRewardShaping") or {}).get("adaptiveCurriculum") or {})


def rl_adaptive_curriculum_config() -> dict:
    """读取 adaptiveCurriculum 配置；不启用时返回 {'enabled': False}。"""
    base = {
        "enabled": False,
        "window": 200,
        "targetWinRate": 0.5,
        "stepUp": 2,
        "stepDown": 0,
        "checkEvery": 50,
    }
    base.update(_RL_ADAPTIVE)
    # 环境变量覆盖
    if os.environ.get("RL_ADAPTIVE_CURRICULUM", "").strip().lower() in ("1", "true", "yes"):
        base["enabled"] = True
    elif os.environ.get("RL_ADAPTIVE_CURRICULUM", "").strip().lower() in ("0", "false", "no"):
        base["enabled"] = False
    return base


def rl_win_threshold_from_virtual_ep(virtual_ep: int) -> int:
    """与 rl_win_threshold_for_episode 相同逻辑，但使用虚拟局数（自适应课程用）。"""
    end_cfg = int(_DATA.get("winScoreThreshold", 220))
    if not rl_curriculum_enabled():
        return end_cfg
    start = int(_RL_CURRICULUM.get("winThresholdStart", 120))
    end = int(_RL_CURRICULUM.get("winThresholdEnd", end_cfg))
    span = max(1, int(_RL_CURRICULUM.get("rampEpisodes", 40000)))
    t = min(1.0, max(0, virtual_ep) / span)
    v = start + (end - start) * t
    return int(round(v))
