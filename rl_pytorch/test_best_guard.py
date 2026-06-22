"""BestGuard v2 单元测试：覆盖显著性检验判定 / 启动自检 / 健康度跟踪 +
端到端复现 8834 污染场景。"""

from __future__ import annotations

import random

import pytest

from rl_pytorch.best_guard import (
    BestGuardConfig,
    BestGuardStats,
    HealthState,
    assess_best_avg_pollution,
    decide_best_guard_action,
    update_health_state,
)


# ──────────────────────────────────────────────────────────────────────
# 辅助：模拟真实训练得分（右偏长尾，与 jsonl 实测分布对齐）
# ──────────────────────────────────────────────────────────────────────


def _skewed_scores(n: int, base: float, seed: int = 0) -> list[float]:
    """生成右偏长尾分数：80% 局在 0~base，20% 局是 2~8x 的长局。"""
    rng = random.Random(seed)
    out = []
    for _ in range(n):
        if rng.random() < 0.8:
            out.append(rng.gauss(base * 0.6, base * 0.35))
        else:
            out.append(base * (2 + rng.expovariate(0.5)))
    return [max(0.0, x) for x in out]


def _empty_best() -> BestGuardStats:
    return BestGuardStats(avg=0.0, std=0.0, n=0, median=0.0)


# ──────────────────────────────────────────────────────────────────────
# 1. 基本动作判定
# ──────────────────────────────────────────────────────────────────────


class TestBestGuardDecision:
    def test_empty_best_returns_init(self):
        cfg = BestGuardConfig(window=10)
        cur = [100.0] * 10
        d = decide_best_guard_action(cfg, _empty_best(), cur)
        assert d.action == "init"
        assert d.cur_stats.n == 10

    def test_clear_upgrade_when_significantly_higher(self):
        cfg = BestGuardConfig(window=200, k_upgrade=1.5)
        # best mean=100 std=5 n=200 → SE ≈ 0.5；cur mean=130 std=5 → z = +30/0.7 ≈ 42
        best = BestGuardStats(avg=100.0, std=5.0, n=200, median=100.0)
        cur = [130.0] * 200
        d = decide_best_guard_action(cfg, best, cur)
        assert d.action == "upgrade"
        assert d.z_score > 1.5

    def test_hold_when_within_noise(self):
        cfg = BestGuardConfig(window=200, k_upgrade=1.5, k_regress=2.0)
        best = BestGuardStats(avg=5000.0, std=4000.0, n=200, median=4000.0)
        # cur 跟 best 同分布 → 接近 best，z≈0
        cur = _skewed_scores(200, 4000, seed=2)
        d = decide_best_guard_action(cfg, best, cur)
        assert d.action == "hold"
        assert abs(d.z_score) < 2.0

    def test_pending_then_confirmed_regress(self):
        # SE_pooled ≈ √(2000²/200 + 0²/200) ≈ 141.4
        # k_regress=1.0 → regress_thr = 5000 - 141.4 = 4858.6
        # k_severe=50.0  → severe_thr  = 5000 - 7071  = -2071  (实际上 cur=4500 永远不会触发)
        cfg = BestGuardConfig(window=200, k_regress=1.0, k_severe=50.0, confirm=2)
        best = BestGuardStats(avg=5000.0, std=2000.0, n=200, median=5000.0)
        cur = [4500.0] * 200  # z ≈ -3.5σ，触发 regress 但远未到 severe（k=50）
        d1 = decide_best_guard_action(cfg, best, cur, pending_count=0)
        assert d1.action == "regress_pending"
        assert d1.pending_count == 1
        d2 = decide_best_guard_action(cfg, best, cur, pending_count=1)
        assert d2.action == "regress_confirmed"

    def test_severe_regress_skips_confirm(self):
        cfg = BestGuardConfig(window=200, k_regress=1.0, k_severe=3.0, confirm=5)
        best = BestGuardStats(avg=5000.0, std=500.0, n=200, median=5000.0)
        # SE≈√(500²/200 + std²/200)，cur=2000 距 5000 远超 3σ
        cur = [2000.0] * 200
        d = decide_best_guard_action(cfg, best, cur, pending_count=0)
        assert d.action == "regress_severe"
        # severe 无需 confirm 累计
        assert d.pending_count == 0


# ──────────────────────────────────────────────────────────────────────
# 2. 启动自检：复现 8834 污染场景
# ──────────────────────────────────────────────────────────────────────


class TestPollutionAssessment:
    def test_no_pollution_within_margin(self):
        cfg = BestGuardConfig(max_pollution_margin=0.10)
        obs = [6000.0, 6500.0, 7000.0, 7500.0, 7600.0]
        # best=7800 < 7600 × 1.10 = 8360 → 不算污染
        a = assess_best_avg_pollution(7800.0, obs, cfg)
        assert a.polluted is False

    def test_8834_pollution_detected_against_observed_max_7636(self):
        """复现实测：best_avg=8834，但 200 局滚动均值历史最大才 7636。"""
        cfg = BestGuardConfig(max_pollution_margin=0.10)
        # 模拟训练史上 200 局滚动均值序列
        obs = [3000.0, 4000.0, 5000.0, 6000.0, 6500.0, 7000.0, 7500.0, 7636.2]
        a = assess_best_avg_pollution(8834.0, obs, cfg)
        assert a.polluted is True
        assert a.observed_max == pytest.approx(7636.2)
        # 推荐值是 observed p95，应远低于 8834
        assert a.suggested_reset_to < 8834.0
        assert a.pollution_ratio > 1.15

    def test_empty_history_returns_not_polluted(self):
        cfg = BestGuardConfig()
        a = assess_best_avg_pollution(8834.0, [], cfg)
        assert a.polluted is False
        assert "无观测历史" in a.reason

    def test_reset_value_is_p95_when_polluted(self):
        cfg = BestGuardConfig(max_pollution_margin=0.10)
        obs = list(range(1000, 5001, 100))  # 1000..5000 step 100
        a = assess_best_avg_pollution(8000.0, obs, cfg)
        assert a.polluted is True
        # p95 应当远低于污染值
        assert 4500 <= a.suggested_reset_to <= 5000


# ──────────────────────────────────────────────────────────────────────
# 3. 健康度跟踪：速率限制 + 自动暂停
# ──────────────────────────────────────────────────────────────────────


class TestHealthState:
    def test_no_alert_when_rollbacks_sparse(self):
        cfg = BestGuardConfig(rate_limit_window=1000, rate_limit_threshold=5)
        state = HealthState()
        # 200 ep 间隔触发一次 confirmed
        cur = [100.0] * 200
        best = BestGuardStats(avg=500.0, std=50.0, n=200, median=500.0)
        d = decide_best_guard_action(cfg, best, cur)
        # decision 是 severe（差距很大）
        assert d.action == "regress_severe"
        state, alert = update_health_state(state, d, ep_cursor=1000, cfg=cfg)
        assert alert is None  # 仅一次，未达 rate limit
        assert state.consecutive_severe == 1

    def test_alert_and_suspend_when_rate_limit_exceeded(self):
        cfg = BestGuardConfig(
            rate_limit_window=1000,
            rate_limit_threshold=3,
            suspend_episodes=500,
        )
        state = HealthState()
        cur = [100.0] * 200
        best = BestGuardStats(avg=500.0, std=50.0, n=200, median=500.0)
        d = decide_best_guard_action(cfg, best, cur)
        # 在 1000 ep 内连续 3 次 severe
        state, alert1 = update_health_state(state, d, ep_cursor=100, cfg=cfg)
        state, alert2 = update_health_state(state, d, ep_cursor=300, cfg=cfg)
        state, alert3 = update_health_state(state, d, ep_cursor=500, cfg=cfg)
        # 第 3 次达到阈值 → 触发 critical alert
        assert alert3 is not None
        assert "CRITICAL" in alert3
        assert state.suspended_until_ep == 500 + 500

    def test_suspended_action_during_pause(self):
        cfg = BestGuardConfig(rate_limit_window=1000, rate_limit_threshold=2, suspend_episodes=1000)
        cur = [100.0] * 200
        best = BestGuardStats(avg=500.0, std=50.0, n=200, median=500.0)
        d = decide_best_guard_action(cfg, best, cur)
        state = HealthState()
        state, _ = update_health_state(state, d, ep_cursor=100, cfg=cfg)
        state, _ = update_health_state(state, d, ep_cursor=300, cfg=cfg)
        # 此时已暂停
        assert state.is_suspended(ep_cursor=500)
        d2 = decide_best_guard_action(cfg, best, cur, health=state, ep_cursor=500)
        assert d2.action == "suspended"


# ──────────────────────────────────────────────────────────────────────
# 4. 端到端：模拟 8834 污染下的训练动力学
# ──────────────────────────────────────────────────────────────────────


class TestRegressionScenario8834:
    """模拟 v1 BestGuard 的缺陷场景：

    - 真实模型能力 mean≈6000、std≈5000（与实测一致）
    - best_avg 被一次右尾运气锁定为 8834
    - 持续训练 → 每个 200 局窗口都会跌破 v1 的 0.7×8834 = 6184 严重阈值
    """

    def _build(self):
        cfg = BestGuardConfig(
            window=200,
            k_upgrade=1.5,
            k_regress=2.0,
            k_severe=3.5,
            confirm=2,
            rate_limit_window=1000,
            rate_limit_threshold=5,
        )
        return cfg

    def test_v2_does_not_misfire_on_8834_pollution(self):
        """v2 修复后：纯统计判定下，正常水平不再被误判为 severe regress。"""
        cfg = self._build()
        # 真实窗口均值=6000、std=5000，n=200 → SE≈√(5000²/200 + 5000²/200) = 500
        # best=6000 → severe_thr = 6000 - 3.5 × √(...) ≈ 4250
        # 即使再有一次 cur mean=5500 也不会触发 severe
        best = BestGuardStats(avg=6000.0, std=5000.0, n=200, median=4500.0)
        cur = _skewed_scores(200, 4000, seed=42)
        d = decide_best_guard_action(cfg, best, cur)
        # 应当处于 hold 或 pending，不可能 severe
        assert d.action in ("hold", "regress_pending")

    def test_pollution_self_check_catches_8834(self):
        """启动自检发现 best_avg=8834 远高于历史观测，应判定为污染。

        用真实实测得到的观测窗口均值（jsonl 重算最大 7636.2），手工列举若干样本。
        """
        cfg = self._build()
        # 取实测 200 局滚动均值的代表性样本（包含历史最高 7636）
        observed = [
            3000.0, 3500.0, 4000.0, 4500.0, 5000.0, 5500.0, 5800.0,
            6000.0, 6200.0, 6400.0, 6600.0, 6800.0, 7000.0, 7300.0,
            7500.0, 7636.2,
        ]
        a = assess_best_avg_pollution(8834.0, observed, cfg)
        assert a.polluted is True
        # 推荐值应当落在 p95 附近（≈ 7500），远低于 8834
        assert 5000 < a.suggested_reset_to < 8000
        # ratio 应当显著大于 1+margin
        assert a.pollution_ratio > 1.10


# ──────────────────────────────────────────────────────────────────────
# 5. 纯函数 / 不变性
# ──────────────────────────────────────────────────────────────────────


class TestPurity:
    def test_decision_does_not_mutate_inputs(self):
        cfg = BestGuardConfig(window=100)
        best = BestGuardStats(avg=100.0, std=10.0, n=100, median=100.0)
        cur = [80.0] * 100
        d1 = decide_best_guard_action(cfg, best, list(cur))
        d2 = decide_best_guard_action(cfg, best, list(cur))
        assert d1.action == d2.action
        assert d1.z_score == d2.z_score

    def test_trimmed_mean_clips_outliers(self):
        cfg = BestGuardConfig(use_trimmed_mean=True, trim_ratio=0.05)
        # 100 个 normal=100，一个极端 outlier=10000
        xs = [100.0] * 99 + [10000.0]
        stats = BestGuardStats.from_window(xs, cfg)
        # trim 后的均值应当接近 100（裁掉 outlier）
        assert stats.avg < 200.0
