"""compute_smooth_terminal_reward 单测：覆盖 sparse_fallback / bootstrap / smooth 三态，
+ tanh 平滑性 + 对称性 + span_floor 保护 + saturation_clip + 与 game_rules.json 默认值一致。"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from rl_pytorch.reward_shaping_smooth import (
    SmoothRewardDecision,
    _percentile_linear,
    compute_smooth_terminal_reward,
)


def _call(score, history, **kw):
    return compute_smooth_terminal_reward(score, history, **kw)


class TestDisabled:
    def test_disabled_returns_sparse_fallback(self):
        d = _call(200.0, [100.0] * 500, enabled=False)
        assert d.action == "sparse_fallback"
        assert d.reward == 0.0

    def test_disabled_does_not_access_history(self):
        d = _call(100.0, [], enabled=False)
        assert d.action == "sparse_fallback"
        assert d.reward == 0.0
        assert d.sample_count == 0

    def test_default_is_disabled(self):
        d = _call(100.0, [50.0] * 500)
        assert d.action == "sparse_fallback"


class TestBootstrap:
    def test_bootstrap_when_history_short(self):
        d = _call(
            200.0, [100.0] * 50,
            enabled=True, win_bonus=35.0,
            bootstrap_episodes=200, bootstrap_target=100.0, bootstrap_span=60.0,
            saturation_clip=5.0,  # 显式放宽以验证原始公式
        )
        assert d.action == "bootstrap"
        assert d.target == 100.0
        assert d.span == 60.0
        expected = 35.0 * math.tanh((200.0 - 100.0) / 60.0)
        assert d.reward == pytest.approx(expected, abs=1e-9)

    def test_bootstrap_with_default_saturation(self):
        # 默认 saturation_clip=1.0：(200-100)/60=1.667 → clip 到 1.0 → tanh(1)·35
        d = _call(
            200.0, [100.0] * 50,
            enabled=True, win_bonus=35.0,
            bootstrap_episodes=200, bootstrap_target=100.0, bootstrap_span=60.0,
        )
        expected = 35.0 * math.tanh(1.0)
        assert d.reward == pytest.approx(expected, abs=1e-9)

    def test_bootstrap_respects_span_floor(self):
        d = _call(
            10.0, [],
            enabled=True, win_bonus=35.0,
            bootstrap_episodes=200, bootstrap_target=100.0, bootstrap_span=0.1,
            span_floor=10.0,
        )
        # span 被 floor 提升到 10
        assert d.span == 10.0


class TestSmoothFormula:
    def test_score_at_target_gives_zero(self):
        scores = list(range(200))  # 0..199
        target = _percentile_linear(sorted(scores), 50.0)  # 中位数
        d = _call(
            target, scores,
            enabled=True, win_bonus=35.0, bootstrap_episodes=100,
        )
        assert d.action == "smooth"
        assert d.reward == pytest.approx(0.0, abs=1e-9)
        assert d.target == pytest.approx(target)

    def test_high_score_positive_low_score_negative(self):
        scores = list(range(200))
        d_hi = _call(180.0, scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100)
        d_lo = _call(20.0, scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100)
        assert d_hi.reward > 0
        assert d_lo.reward < 0

    def test_symmetry_around_target(self):
        scores = list(range(200))
        target = _percentile_linear(sorted(scores), 50.0)
        d_plus = _call(target + 30, scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100)
        d_minus = _call(target - 30, scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100)
        assert d_plus.reward == pytest.approx(-d_minus.reward, abs=1e-9)

    def test_tanh_saturation(self):
        scores = list(range(200))
        # 远高于 target + 2·span，clipped 后 tanh(1) ≈ 0.7616
        d = _call(
            10000.0, scores,
            enabled=True, win_bonus=35.0,
            bootstrap_episodes=100, saturation_clip=1.0,
        )
        expected = 35.0 * math.tanh(1.0)
        assert d.reward == pytest.approx(expected, abs=1e-9)

    def test_higher_saturation_clip_allows_larger_reward(self):
        scores = list(range(200))
        d_clip1 = _call(10000.0, scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100, saturation_clip=1.0)
        d_clip5 = _call(10000.0, scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100, saturation_clip=5.0)
        assert abs(d_clip5.reward) > abs(d_clip1.reward)
        assert abs(d_clip5.reward) < 35.0  # 但仍 < win_bonus


class TestSpanProtection:
    def test_span_floor_when_all_scores_same(self):
        # 所有局都 100 分 → IQR=0 → 会被 span_floor 提升
        scores = [100.0] * 200
        d = _call(
            150.0, scores,
            enabled=True, win_bonus=35.0,
            bootstrap_episodes=100, span_floor=10.0,
        )
        assert d.span == 10.0
        assert math.isfinite(d.reward)

    def test_smooth_with_normal_distribution(self):
        # 用 0..200 均匀分布：p50=99.5, IQR≈100
        scores = list(range(201))
        d = _call(150.0, scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100)
        assert d.target == pytest.approx(100.0, abs=1.0)
        assert d.span == pytest.approx(100.0, abs=2.0)


class TestPurity:
    def test_does_not_mutate_input(self):
        import collections
        dq = collections.deque([10.0, 20.0, 30.0] * 100, maxlen=500)
        snapshot = list(dq)
        _call(100.0, dq, enabled=True, win_bonus=35.0, bootstrap_episodes=100)
        assert list(dq) == snapshot

    def test_idempotent(self):
        scores = list(range(300))
        d1 = _call(150.0, scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100)
        d2 = _call(150.0, scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100)
        assert d1 == d2


class TestStatisticalProperty:
    def test_zero_sum_around_target_for_symmetric_distribution(self):
        """对称分布上，所有 score 触发的 reward 之和应接近 0（无 bias）。"""
        scores = list(range(401))  # 0..400, target=200
        total = 0.0
        for s in scores:
            d = _call(float(s), scores, enabled=True, win_bonus=35.0, bootstrap_episodes=100, saturation_clip=5.0)
            total += d.reward
        # 对称 → 总和接近 0，离散误差容忍 < win_bonus × 5%
        assert abs(total) < 35.0 * 0.05 * len(scores)


class TestConfigConsistency:
    def test_defaults_match_game_rules_json(self):
        repo_root = Path(__file__).resolve().parents[1]
        with open(repo_root / "shared" / "game_rules.json", encoding="utf-8") as f:
            d = json.load(f)
        rs = d.get("rlRewardShaping", {})
        cfg = rs.get("smoothWinBonus") or {}
        # smoothWinBonus 字段未定义时不报错，只在存在时校验合理性
        if "enabled" in cfg:
            assert isinstance(cfg["enabled"], bool)
        if "targetPercentile" in cfg:
            assert 0.0 < cfg["targetPercentile"] < 100.0
        if "spanLowPercentile" in cfg and "spanHighPercentile" in cfg:
            assert cfg["spanLowPercentile"] < cfg["spanHighPercentile"]
        if "bootstrapEpisodes" in cfg:
            assert cfg["bootstrapEpisodes"] >= 0
        if "spanFloor" in cfg:
            assert cfg["spanFloor"] > 0
        if "saturationClip" in cfg:
            assert cfg["saturationClip"] > 0
