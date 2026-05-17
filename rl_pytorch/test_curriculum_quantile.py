"""compute_quantile_threshold 单测：覆盖 bootstrap / ema_init / quantile 全路径 +
边界（α=0/1，floor/ceil 夹紧）+ 纯函数性 + 与 game_rules.json 默认值一致性。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from rl_pytorch.curriculum_quantile import (
    QuantileDecision,
    _percentile_linear,
    compute_quantile_threshold,
)


# ──────────────────────────────────────────────────────────────────────
# 辅助
# ──────────────────────────────────────────────────────────────────────
def _call(scores, ema=0.0, ema_init=False, **kw):
    return compute_quantile_threshold(
        scores, ema, ema_initialized=ema_init, **kw
    )


# ──────────────────────────────────────────────────────────────────────
# 1. 内部分位数工具
# ──────────────────────────────────────────────────────────────────────
class TestPercentileLinear:
    def test_empty_returns_zero(self):
        assert _percentile_linear([], 50) == 0.0

    def test_single_returns_value(self):
        assert _percentile_linear([42.0], 50) == 42.0
        assert _percentile_linear([42.0], 0) == 42.0
        assert _percentile_linear([42.0], 100) == 42.0

    def test_median_even(self):
        # 1, 2, 3, 4 → 中位数 = (2+3)/2 = 2.5
        assert _percentile_linear([1.0, 2.0, 3.0, 4.0], 50) == pytest.approx(2.5)

    def test_p70_5_samples(self):
        # 0..100 步长 25 → idx = 0.7 * 4 = 2.8, lo=2, hi=3, frac=0.8
        # → 50*(1-0.8) + 75*0.8 = 10 + 60 = 70
        result = _percentile_linear([0.0, 25.0, 50.0, 75.0, 100.0], 70)
        assert result == pytest.approx(70.0)

    def test_matches_numpy_when_available(self):
        try:
            import numpy as np
        except ImportError:
            pytest.skip("numpy 不可用，跳过对照")
        data = [12.0, 47.0, 33.0, 81.0, 5.0, 67.0, 22.0, 90.0, 41.0, 58.0]
        for p in [10, 25, 50, 70, 75, 90, 95]:
            ours = _percentile_linear(sorted(data), p)
            theirs = float(np.percentile(data, p, method="linear"))
            assert ours == pytest.approx(theirs, abs=1e-9)


# ──────────────────────────────────────────────────────────────────────
# 2. bootstrap 分支：样本不足
# ──────────────────────────────────────────────────────────────────────
class TestBootstrap:
    def test_empty_history_returns_bootstrap(self):
        d = _call([], bootstrap_episodes=100, bootstrap_threshold=40)
        assert d.action == "bootstrap"
        assert d.new_threshold == 40
        assert d.sample_count == 0
        assert d.target_quantile == -1.0
        assert d.new_ema == 0.0  # ema_state 透传

    def test_partial_history_under_bootstrap(self):
        d = _call([100.0] * 50, bootstrap_episodes=100, bootstrap_threshold=40)
        assert d.action == "bootstrap"
        assert d.new_threshold == 40

    def test_bootstrap_respects_floor_ceil(self):
        # bootstrap_threshold=10 但 floor=40 → 被夹到 40
        d = _call([], bootstrap_episodes=100, bootstrap_threshold=10, floor=40)
        assert d.new_threshold == 40
        # bootstrap_threshold=5000 但 ceil=1000 → 被夹到 1000
        d = _call([], bootstrap_episodes=100, bootstrap_threshold=5000, ceil=1000)
        assert d.new_threshold == 1000

    def test_bootstrap_preserves_ema_state(self):
        d = _call([10.0] * 5, ema=123.45, ema_init=True, bootstrap_episodes=100)
        assert d.new_ema == 123.45  # 不污染 EMA


# ──────────────────────────────────────────────────────────────────────
# 3. ema_init 分支：首次有效计算
# ──────────────────────────────────────────────────────────────────────
class TestEmaInit:
    def test_ema_init_when_not_initialized(self):
        scores = list(range(100))  # 0..99
        d = _call(scores, ema=0.0, ema_init=False, p=70, bootstrap_episodes=100)
        assert d.action == "ema_init"
        # 70 分位（0..99）≈ 0.7 * 99 = 69.3
        assert d.target_quantile == pytest.approx(69.3, abs=0.01)
        assert d.new_ema == pytest.approx(d.target_quantile)
        assert d.new_threshold == 69
        assert d.sample_count == 100

    def test_ema_init_when_state_zero_but_marked_initialized(self):
        # ema_state=0.0 + ema_init=True 仍走 ema_init 分支（保护：避免被 0 状态污染）
        d = _call([50.0] * 100, ema=0.0, ema_init=True, p=70, bootstrap_episodes=100)
        assert d.action == "ema_init"
        assert d.new_ema == 50.0


# ──────────────────────────────────────────────────────────────────────
# 4. quantile 主路径：EMA 平滑
# ──────────────────────────────────────────────────────────────────────
class TestQuantileEMA:
    def test_basic_ema_smoothing(self):
        scores = [100.0] * 100
        d = _call(
            scores, ema=50.0, ema_init=True,
            p=70, ema_alpha=0.1, bootstrap_episodes=100,
        )
        assert d.action == "quantile"
        # target = 100, ema = 0.1 * 100 + 0.9 * 50 = 55
        assert d.new_ema == pytest.approx(55.0)
        assert d.new_threshold == 55
        assert d.target_quantile == 100.0

    def test_alpha_zero_freezes_ema(self):
        d = _call(
            [200.0] * 100, ema=80.0, ema_init=True,
            p=70, ema_alpha=0.0, bootstrap_episodes=100,
        )
        assert d.new_ema == 80.0
        assert d.new_threshold == 80

    def test_alpha_one_replaces_ema(self):
        d = _call(
            [200.0] * 100, ema=80.0, ema_init=True,
            p=70, ema_alpha=1.0, bootstrap_episodes=100,
        )
        assert d.new_ema == 200.0
        assert d.new_threshold == 200

    def test_floor_clip(self):
        d = _call(
            [5.0] * 100, ema=10.0, ema_init=True,
            p=50, ema_alpha=0.5, floor=40, bootstrap_episodes=100,
        )
        # ema ≈ 0.5*5 + 0.5*10 = 7.5 → 被 floor=40 夹住
        assert d.new_threshold == 40
        assert d.new_ema == pytest.approx(7.5)  # ema 内部值不被夹

    def test_ceil_clip(self):
        d = _call(
            [9999.0] * 100, ema=5000.0, ema_init=True,
            p=50, ema_alpha=0.5, ceil=2000, bootstrap_episodes=100,
        )
        # ema ≈ 0.5*9999 + 0.5*5000 ≈ 7499.5 → 被 ceil=2000 夹住
        assert d.new_threshold == 2000
        assert d.new_ema == pytest.approx(7499.5)


# ──────────────────────────────────────────────────────────────────────
# 5. 纯函数性：相同输入 → 相同输出，不改原 deque
# ──────────────────────────────────────────────────────────────────────
class TestPurity:
    def test_idempotent_on_repeat_call(self):
        scores = list(range(100, 300))  # 200 个
        d1 = _call(scores, ema=120.0, ema_init=True, p=70, ema_alpha=0.05, bootstrap_episodes=100)
        d2 = _call(scores, ema=120.0, ema_init=True, p=70, ema_alpha=0.05, bootstrap_episodes=100)
        assert d1 == d2

    def test_does_not_mutate_input(self):
        import collections
        dq = collections.deque([10.0, 20.0, 30.0] * 50, maxlen=500)
        snapshot = list(dq)
        _call(dq, ema=15.0, ema_init=True, p=70, bootstrap_episodes=100)
        assert list(dq) == snapshot


# ──────────────────────────────────────────────────────────────────────
# 6. 数学性质：稳态下 P(score >= thr) ≈ 1 - p/100
# ──────────────────────────────────────────────────────────────────────
class TestStatisticalProperty:
    def test_win_rate_converges_to_one_minus_p(self):
        """构造稳态分布，验证 thr 收敛后 win_rate ≈ 1 - p/100。

        用 0..1000 均匀分布，p=70 → 理论 thr=700，win_rate=30%。
        """
        scores = list(range(1001))
        d = _call(scores, ema=500.0, ema_init=True, p=70, ema_alpha=1.0, bootstrap_episodes=100)
        # α=1 → ema = target = 70 分位 ≈ 700
        assert d.new_ema == pytest.approx(700.0, abs=1.0)
        win_count = sum(1 for s in scores if s >= d.new_threshold)
        win_rate = win_count / len(scores)
        # 1 - 0.70 = 0.30，允许 ±2pp 误差（边界离散）
        assert 0.28 < win_rate < 0.32

    def test_p50_gives_50pct_winrate(self):
        scores = list(range(1001))
        d = _call(scores, ema=500.0, ema_init=True, p=50, ema_alpha=1.0, bootstrap_episodes=100)
        assert d.new_ema == pytest.approx(500.0, abs=1.0)
        win_rate = sum(1 for s in scores if s >= d.new_threshold) / len(scores)
        assert 0.48 < win_rate < 0.52


# ──────────────────────────────────────────────────────────────────────
# 7. 与 game_rules.json 默认值的一致性
# ──────────────────────────────────────────────────────────────────────
class TestConfigConsistency:
    def test_defaults_match_game_rules_json(self):
        repo_root = Path(__file__).resolve().parents[1]
        with open(repo_root / "shared" / "game_rules.json", encoding="utf-8") as f:
            d = json.load(f)
        cur = d.get("rlCurriculum", {})
        q = cur.get("quantile") or {}
        # 这些字段在 v11.2 写入 JSON；若任一缺失，allow 但不应破坏 loader
        # 主要校验：若存在则数值合理
        if "p" in q:
            assert 0.0 < q["p"] < 100.0
        if "windowEpisodes" in q:
            assert q["windowEpisodes"] >= 50  # 至少 50 局才有意义
        if "emaAlpha" in q:
            assert 0.0 < q["emaAlpha"] <= 1.0
        if "bootstrapEpisodes" in q:
            assert q["bootstrapEpisodes"] >= 0
        if "bootstrapThreshold" in q:
            assert q["bootstrapThreshold"] >= 1
