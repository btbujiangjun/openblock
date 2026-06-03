"""behavior_import: 玩家真实对局 → v2 寻参样本 转换器单测。

不依赖 Flask / DB, 纯函数测试。校验:
  - 输出 schema 与 bulk_insert_samples 一致 (5维ctx + θ + 20维d_curve + 辅助标签)
  - d_curve / bin_counts 长度 = 20, 值域 [0,1]
  - action_freedom 由盘面回放(满盘→0→难度高), context 推导(generator/pb_bin/lifecycle)
  - 边界: 空帧 / 无 place 帧 → None
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rl_pytorch.spawn_tuning_v2.behavior_import import (  # noqa: E402
    session_to_v2_sample, _v2_pb_bin, _legal_count, _parse_cells,
    _lifecycle_from_s_stage, GRID_SIZE, ALGO_VERSION,
)


def _empty_grid():
    return {"cells": [[None] * GRID_SIZE for _ in range(GRID_SIZE)]}


def _grid_after(filled_rows):
    """前 filled_rows 行全填满, 其余空。"""
    cells = []
    for y in range(GRID_SIZE):
        cells.append([1] * GRID_SIZE if y < filled_rows else [None] * GRID_SIZE)
    return {"cells": cells}


def _make_session(n_place=5, base_score=100, pb=2000, gen="rule",
                  s_stage="S1", died=False):
    frames = [{"t": "init", "grid": _empty_grid()}]
    frames.append({
        "t": "spawn",
        "dock": [{"id": "1x2"}, {"id": "2x2"}, {"id": "t-up"}],
        "ps": {
            "score": 0, "boardFill": 0.0, "bestScore": pb,
            "provenance": {"spawnSource": "model-v3" if gen == "generative" else "rule"},
            "adaptive": {"stressBreakdown": {
                "pbCurveParams": {"pbTensionCenter": 0.8, "pbTensionWidth": 0.07},
                "lifecycleStage": s_stage,
            }},
        },
    })
    for i in range(n_place):
        frames.append({
            "t": "place",
            "gridAfter": _grid_after(min(GRID_SIZE, i)),
            "ps": {
                "score": base_score * (i + 1),
                "boardFill": min(1.0, 0.1 * (i + 1)),
                "linesCleared": 0,
            },
        })
    return frames


class TestConverterBasic:
    def test_schema_and_lengths(self):
        s = session_to_v2_sample(_make_session(), {"pb_baseline": 2000})
        assert s is not None
        for k in ("difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage",
                  "theta_json", "d_curve_json", "final_score", "survived_steps",
                  "clear_rate", "noMove_step", "pb_broke", "surprise_count",
                  "n_bins_filled", "bin_counts", "algo_version"):
            assert k in s, f"missing {k}"
        dc = json.loads(s["d_curve_json"])
        assert len(dc) == 20
        assert all(0.0 <= v <= 1.0 for v in dc)
        assert len(s["bin_counts"]) == 20
        assert sum(s["bin_counts"]) >= 1
        assert s["algo_version"] == ALGO_VERSION
        # theta_json 是合法 27 维 dict
        theta = json.loads(s["theta_json"])
        assert "pbTensionCenter" in theta and theta["pbTensionCenter"] == 0.8

    def test_context_enums_valid(self):
        s = session_to_v2_sample(_make_session(gen="generative", s_stage="S3"),
                                 {"pb_baseline": 2000})
        assert s["difficulty"] in ("easy", "normal", "hard")
        assert s["generator"] == "generative"          # provenance model-v3
        assert s["bot_policy"] in ("random", "clear-greedy", "survival", "rl-bot")
        assert s["pb_bin"] in (500, 1500, 4000, 10000, 25000)
        assert s["lifecycle_stage"] == "plateau"        # S3 → plateau

    def test_meta_overrides(self):
        s = session_to_v2_sample(_make_session(),
                                 {"pb_baseline": 2000, "difficulty": "hard",
                                  "bot_policy": "survival", "lifecycle_stage": "mature"})
        assert s["difficulty"] == "hard"
        assert s["bot_policy"] == "survival"
        assert s["lifecycle_stage"] == "mature"

    def test_died_appends_nomove_step(self):
        frames = _make_session(n_place=4)
        s_alive = session_to_v2_sample(frames, {"pb_baseline": 2000})
        s_died = session_to_v2_sample(frames, {"pb_baseline": 2000, "died": True})
        # 死局多一步 no_move
        assert s_died["survived_steps"] == s_alive["survived_steps"] + 1
        assert s_died["noMove_step"] >= 0

    def test_pb_broke_flag(self):
        # final_score 远超 pb → pb_broke
        frames = _make_session(n_place=5, base_score=1000, pb=1000)
        s = session_to_v2_sample(frames, {"pb_baseline": 1000})
        assert s["pb_broke"] is True


class TestConverterEdgeCases:
    def test_empty_frames_none(self):
        assert session_to_v2_sample([], {}) is None
        assert session_to_v2_sample(None, {}) is None

    def test_no_place_frames_none(self):
        frames = [{"t": "init", "grid": _empty_grid()},
                  {"t": "spawn", "dock": [{"id": "1x2"}], "ps": {"score": 0}}]
        assert session_to_v2_sample(frames, {}) is None

    def test_pb_fallback_when_missing(self):
        # 无 pb_baseline / bestScore → 用 final_score / 500 floor, 不崩
        frames = _make_session(n_place=3, base_score=50, pb=0)
        for f in frames:
            if f["t"] == "spawn":
                f["ps"].pop("bestScore", None)
        s = session_to_v2_sample(frames, {})
        assert s is not None
        assert s["pb_bin"] in (500, 1500, 4000, 10000, 25000)


class TestHelpers:
    def test_pb_bin_nearest(self):
        assert _v2_pb_bin(0) == 500
        assert _v2_pb_bin(900) == 500
        assert _v2_pb_bin(1200) == 1500
        assert _v2_pb_bin(3000) == 4000
        assert _v2_pb_bin(99999) == 25000

    def test_lifecycle_s_stage_map(self):
        assert _lifecycle_from_s_stage("S0") == "onboarding"
        assert _lifecycle_from_s_stage("S2") == "mature"
        assert _lifecycle_from_s_stage("S4") == "plateau"
        assert _lifecycle_from_s_stage("bogus") is None

    def test_legal_count_full_board_zero(self):
        full = [[True] * GRID_SIZE for _ in range(GRID_SIZE)]
        empty = [[False] * GRID_SIZE for _ in range(GRID_SIZE)]
        mats = [[[1, 1]]]   # 1x2
        assert _legal_count(full, mats) == 0
        assert _legal_count(empty, mats) > 0

    def test_parse_cells(self):
        g = {"cells": [[1, None, 2], [None, None, None]]}
        b = _parse_cells(g)
        assert b[0][0] is True and b[0][1] is False and b[0][2] is True
        assert b[1][0] is False


class TestUnifiedDifficultySameSource:
    """v1.66: spawn 帧落库统一难度分 → 经 StepInfo.state_difficulty 用作 state_d(同源化)。"""

    def _single_bin_session(self, scd):
        """所有 place 步同 score(同 r → 同 bin), 该 bin 观测充足(≥先验强度) → 反映纯观测 d_step,
        从而隔离先验平滑, 让 scd 对该 bin 的影响可断言。"""
        frames = [{"t": "init", "grid": _empty_grid()}]
        frames.append({
            "t": "spawn",
            "dock": [{"id": "1x2"}, {"id": "2x2"}, {"id": "t-up"}],
            "spawnMeta": {"stepDifficulty": {"stepDifficulty": scd}},
            "ps": {"score": 0, "boardFill": 0.0, "bestScore": 1500,
                   "adaptive": {"stressBreakdown": {"lifecycleStage": "S1"}}},
        })
        for _ in range(6):  # 6 obs 同 bin ≥ PB_AWARE_PRIOR_STRENGTH(3) → 纯观测
            frames.append({
                "t": "place",
                "gridAfter": _empty_grid(),
                "ps": {"score": 750, "boardFill": 0.3, "linesCleared": 0},  # r=750/1500=0.5
            })
        return frames

    def test_scd_drives_bin_when_observation_dominates(self):
        """同盘面信号、观测充足的 bin 上, 高 scd 局 d 值显著高于低 scd 局(同源化生效)。"""
        s_lo = session_to_v2_sample(self._single_bin_session(0.1), {"pb_baseline": 1500})
        s_hi = session_to_v2_sample(self._single_bin_session(0.9), {"pb_baseline": 1500})
        dc_lo = json.loads(s_lo["d_curve_json"])
        dc_hi = json.loads(s_hi["d_curve_json"])
        # r=0.5 → bin 6 (bin 宽 1.5/20=0.075); 该 bin 观测充足
        assert dc_hi[6] > dc_lo[6] + 0.3

    def test_missing_scd_falls_back_to_proxy(self):
        """无 spawnMeta.stepDifficulty → 回退 fillRate/freedom/trend 代理, 仍产出有效 d_curve。"""
        s = session_to_v2_sample(_make_session(n_place=5), {"pb_baseline": 2000})
        dc = json.loads(s["d_curve_json"])
        assert len(dc) == 20 and all(0.0 <= v <= 1.0 for v in dc)


class TestActionFreedomAffectsDifficulty:
    def test_tight_board_higher_difficulty(self):
        """盘面越满(action_freedom 越低) → d_step state 部分越高。"""
        # 宽松盘: gridAfter 一直近空
        loose = _make_session(n_place=5)
        for i, f in enumerate(loose):
            if f["t"] == "place":
                f["gridAfter"] = _empty_grid()
                f["ps"]["boardFill"] = 0.1
        # 紧张盘: gridAfter 逐步填满
        tight = _make_session(n_place=5)
        for i, f in enumerate(tight):
            if f["t"] == "place":
                f["ps"]["boardFill"] = 0.9
        s_loose = session_to_v2_sample(loose, {"pb_baseline": 2000})
        s_tight = session_to_v2_sample(tight, {"pb_baseline": 2000})
        avg_loose = sum(json.loads(s_loose["d_curve_json"])) / 20
        avg_tight = sum(json.loads(s_tight["d_curve_json"])) / 20
        assert avg_tight > avg_loose
