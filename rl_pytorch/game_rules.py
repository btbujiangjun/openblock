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


def rl_training_strategy_ids() -> list[str]:
    enc = _DATA.get("featureEncoding") or {}
    rt = _DATA.get("rlTraining") or {}
    raw = enc.get("strategyIds") or rt.get("strategyIds") or ["easy", "normal", "hard"]
    return [str(x) for x in raw]


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
CLEAR_SCORING = dict(_DATA.get("clearScoring") or {})
RL_REWARD_SHAPING = dict(_DATA.get("rlRewardShaping") or {})
_RL_CURRICULUM = dict(_DATA.get("rlCurriculum") or {})
_RL_BONUS_SCORING = dict(_DATA.get("rlBonusScoring") or {})


def rl_bonus_block_icons() -> list[str] | None:
    """RL bonus icon 的唯一来源：shared/game_rules.json -> rlBonusScoring.blockIcons。"""
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
    """读取 adaptiveCurriculum 配置；不启用时返回 {'enabled': False}。

    v11 闭环化新增字段（向后兼容，缺省走默认值）：
      - stepDown          (默认 1.0)  低胜率时虚拟局数退步幅度（v8 默认 0 即只升不降）
      - accelBand         (默认 0.1)  wr > target + accelBand 触发加速
      - holdBand          (默认 0.1)  wr ∈ [target - holdBand, target + accelBand) 正常推进
      - lowWinRateBand    (默认 0.2)  wr < target - lowWinRateBand 触发主动回退
      - severeWinRateBand (默认 0.4)  wr < target - severeWinRateBand 触发 rollback
      - minVirtualEp      (默认 0)   virtual_ep 下界
      - rollbackOnSevereDrop (默认 True)
      - severeRollbackFactor (默认 0.5)  severe 触发时 virtual_ep × factor
      - minSamplesForAction  (默认 10)   win_history < 此值时走 warmup（按 +checkEvery 推进）
    """
    base = {
        "enabled": False,
        "window": 200,
        "targetWinRate": 0.5,
        "stepUp": 2,
        "stepDown": 1.0,
        "checkEvery": 50,
        "accelBand": 0.1,
        "holdBand": 0.1,
        "lowWinRateBand": 0.2,
        "severeWinRateBand": 0.4,
        "minVirtualEp": 0,
        "rollbackOnSevereDrop": True,
        "severeRollbackFactor": 0.5,
        "minSamplesForAction": 10,
    }
    base.update(_RL_ADAPTIVE)
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


# ---------------------------------------------------------------------------
# v11.2 课程模式三选一（linear / adaptive / quantile）
# ---------------------------------------------------------------------------
_VALID_CURRICULUM_MODES = ("linear", "adaptive", "quantile")


def rl_curriculum_mode() -> str:
    """返回当前生效的课程模式：'linear' | 'adaptive' | 'quantile'。

    优先级（高 → 低）：
      1. 环境变量 RL_CURRICULUM_MODE（覆盖一切，方便 A/B 与 hotfix）
      2. shared/game_rules.json -> rlCurriculum.mode 字段
      3. 自动推断：rlRewardShaping.adaptiveCurriculum.enabled=true → 'adaptive'，否则 'linear'

    与 rl_curriculum_enabled() 的关系：本函数不检查 enabled；调用方需自行先调
    rl_curriculum_enabled()，再决定是否走 mode 分支（enabled=false 时不应启用任何课程）。
    """
    env = os.environ.get("RL_CURRICULUM_MODE", "").strip().lower()
    if env in _VALID_CURRICULUM_MODES:
        return env
    cfg_mode = str(_RL_CURRICULUM.get("mode", "")).strip().lower()
    if cfg_mode in _VALID_CURRICULUM_MODES:
        return cfg_mode
    adap_cfg = (_DATA.get("rlRewardShaping") or {}).get("adaptiveCurriculum") or {}
    if bool(adap_cfg.get("enabled", False)):
        return "adaptive"
    return "linear"


def rl_quantile_config() -> dict:
    """读取 v11.2 quantile 子节配置；缺失字段走代码默认值。

    Returns
    -------
    dict containing: p, windowEpisodes, emaAlpha, bootstrapEpisodes,
                     bootstrapThreshold, floor, ceil
    """
    base = {
        "p": 70.0,
        "windowEpisodes": 500,
        "emaAlpha": 0.05,
        "bootstrapEpisodes": 100,
        "bootstrapThreshold": 40,
        "floor": 40,
        "ceil": 9999,
        # 棘轮：门槛回落下限 = ratchetDecay * 历史峰值。<1.0 启用单调高水位，
        # 让策略退化时 win_rate 跌破 1-p 形成纠偏压力（消除纯分位课程的退化反馈环）。
        "ratchetDecay": 0.9,
    }
    user = dict(_RL_CURRICULUM.get("quantile") or {})
    user.pop("comment", None)
    for k, v in user.items():
        if k in base:
            base[k] = v
    return base


# ---------------------------------------------------------------------------
# v11.2 方案 B：平滑奖励整形（opt-in）
# ---------------------------------------------------------------------------
def rl_smooth_win_bonus_config() -> dict:
    """读取 rlRewardShaping.smoothWinBonus 子节；缺失字段走代码默认值。

    环境变量 RL_SMOOTH_WIN_BONUS=1/0 可强制开关，便于快速 A/B。

    Returns
    -------
    dict containing: enabled, windowEpisodes, targetPercentile,
                     spanLowPercentile, spanHighPercentile,
                     bootstrapEpisodes, bootstrapTarget, bootstrapSpan,
                     spanFloor, saturationClip
    """
    base = {
        "enabled": False,
        "windowEpisodes": 500,
        "targetPercentile": 50.0,
        "spanLowPercentile": 25.0,
        "spanHighPercentile": 75.0,
        "bootstrapEpisodes": 200,
        "bootstrapTarget": 100.0,
        "bootstrapSpan": 60.0,
        "spanFloor": 5.0,
        "saturationClip": 1.5,
    }
    user = dict((_DATA.get("rlRewardShaping") or {}).get("smoothWinBonus") or {})
    user.pop("comment", None)
    for k, v in user.items():
        if k in base:
            base[k] = v
    env = os.environ.get("RL_SMOOTH_WIN_BONUS", "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        base["enabled"] = True
    elif env in ("0", "false", "no", "off"):
        base["enabled"] = False
    return base


# ---------------------------------------------------------------------------
# v11.2 方案 C：RND Curiosity（opt-in）
# ---------------------------------------------------------------------------
def rl_rnd_curiosity_config() -> dict:
    """读取 rlRewardShaping.rndCuriosity 子节；缺失字段走代码默认值。

    环境变量 RL_RND=1/0 可强制开关。

    Returns
    -------
    dict containing: enabled, stateDim, hiddenDim, outputDim, beta,
                     learningRate, updateEverySteps, normalizeIntrinsic, gradClip,
                     minEpisode, scoreSlopeWindow, scoreSlopeThreshold,
                     entropyCollapseThreshold, expectedScoreAtCollapse,
                     scoreCollapseRatio, triggerCheckEvery
    """
    base = {
        "enabled": False,
        "stateDim": 201,
        "hiddenDim": 64,
        "outputDim": 32,
        "beta": 0.1,
        "learningRate": 1e-4,
        "updateEverySteps": 1,
        "normalizeIntrinsic": True,
        "gradClip": 5.0,
        "minEpisode": 50000,
        "scoreSlopeWindow": 5000,
        "scoreSlopeThreshold": 1e-3,
        "entropyCollapseThreshold": 0.2,
        "expectedScoreAtCollapse": None,
        "scoreCollapseRatio": 0.8,
        "triggerCheckEvery": 2000,
    }
    user = dict((_DATA.get("rlRewardShaping") or {}).get("rndCuriosity") or {})
    user.pop("comment", None)
    for k, v in user.items():
        if k in base:
            base[k] = v
    env = os.environ.get("RL_RND", "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        base["enabled"] = True
    elif env in ("0", "false", "no", "off"):
        base["enabled"] = False
    return base


# ---------------------------------------------------------------------------
# 训练预设（performance / balanced / quality）
# ---------------------------------------------------------------------------
_TRAINING_PRESETS: dict = dict(
    (RL_REWARD_SHAPING.get("trainingPresets") or {})
)

# 运行时可被 rl_backend 热切换的活跃预设名
_active_preset: str = os.environ.get("RL_TRAINING_PRESET", "balanced")


def rl_training_presets() -> dict:
    """返回所有预设定义（给前端枚举用）。"""
    return dict(_TRAINING_PRESETS)


def rl_active_training_preset() -> str:
    return _active_preset


def rl_set_training_preset(name: str) -> dict | None:
    """切换活跃预设并返回其配置；无效名称返回 None。"""
    global _active_preset
    cfg = _TRAINING_PRESETS.get(name)
    if cfg is None:
        return None
    _active_preset = name
    return dict(cfg)


def rl_active_preset_config() -> dict:
    """返回当前活跃预设的完整配置字典（含 mcts/beam 覆盖值）。"""
    return dict(_TRAINING_PRESETS.get(_active_preset) or {})
