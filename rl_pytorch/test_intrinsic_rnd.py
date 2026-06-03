"""RND 模块单测：触发条件 / Welford 归一化 / 双 MLP 结构 / intrinsic reward 计算。

torch 相关测试会自动 skip 如果未安装。
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from rl_pytorch.intrinsic_rnd import (
    RNDConfig,
    RNDRewardNormalizer,
    RNDTriggerDecision,
    compute_rnd_trigger,
)


# ──────────────────────────────────────────────────────────────────────
# 1. 触发条件检测
# ──────────────────────────────────────────────────────────────────────
class TestTriggerCondition:
    def test_manual_force_overrides_everything(self):
        d = compute_rnd_trigger(
            episode=0,  # 远未到 min_episode
            avg_score_history=[100.0],
            entropy_history=[5.0],  # 高熵
            manual_force=True,
        )
        assert d.should_enable is True
        assert d.reason == "manual"

    def test_below_min_episode_returns_not_triggered(self):
        d = compute_rnd_trigger(
            episode=10_000,
            avg_score_history=[100.0] * 100,
            entropy_history=[0.1] * 100,  # 即使条件全满足
            min_episode=50_000,
        )
        assert d.should_enable is False
        assert d.reason == "not_triggered"

    def test_score_stall_triggers(self):
        # 100 个数据点全是 50.0 → slope=0
        d = compute_rnd_trigger(
            episode=60_000,
            avg_score_history=[50.0] * 100,
            entropy_history=[2.0],  # 高熵，排除熵塌
            min_episode=50_000,
            score_slope_threshold=1e-3,
        )
        assert d.should_enable is True
        assert d.reason == "score_stall"
        assert abs(d.metric_value) < 1e-3

    def test_entropy_collapse_triggers_when_score_low(self):
        d = compute_rnd_trigger(
            episode=60_000,
            avg_score_history=[300.0],  # 看似已经增长但熵塌了
            entropy_history=[0.05],
            min_episode=50_000,
            entropy_collapse_threshold=0.2,
            expected_score_at_collapse=500.0,
            score_collapse_ratio=0.8,
        )
        # 300 < 500 × 0.8 = 400 → 触发
        assert d.should_enable is True
        assert d.reason == "entropy_collapse"

    def test_entropy_collapse_skipped_if_score_at_ceiling(self):
        d = compute_rnd_trigger(
            episode=60_000,
            avg_score_history=[600.0],  # 已超过期望
            entropy_history=[0.05],
            min_episode=50_000,
            entropy_collapse_threshold=0.2,
            expected_score_at_collapse=500.0,
            score_collapse_ratio=0.8,
        )
        # 600 > 500 × 0.8 → 算"健康收敛"不触发
        # 但 score 有大变化导致 slope 异常，可能仍触发 score_stall。验证：
        # avg_score_history 只 1 个点 → score_stall 检测被 len(recent)>=2 排除
        # entropy_collapse 由于 score 超过阈值被排除 → not_triggered
        assert d.should_enable is False
        assert d.reason == "not_triggered"

    def test_score_growing_does_not_trigger(self):
        scores = list(range(100, 200))  # 持续增长
        d = compute_rnd_trigger(
            episode=60_000,
            avg_score_history=scores,
            entropy_history=[1.5],
            min_episode=50_000,
            score_slope_threshold=1e-3,
        )
        # 斜率 = 1，远大于 1e-3
        assert d.should_enable is False


# ──────────────────────────────────────────────────────────────────────
# 2. Welford 归一化
# ──────────────────────────────────────────────────────────────────────
class TestRNDRewardNormalizer:
    def test_initial_state(self):
        nm = RNDRewardNormalizer()
        assert nm.count == 0
        assert nm.mean == 0.0
        # std fallback to 1.0 当 count < 2
        assert nm.std == 1.0

    def test_single_value_keeps_std_1(self):
        nm = RNDRewardNormalizer()
        nm.update(5.0)
        assert nm.mean == 5.0
        assert nm.std == 1.0  # 仍然是 fallback

    def test_running_mean_variance_correct(self):
        nm = RNDRewardNormalizer()
        values = [1.0, 2.0, 3.0, 4.0, 5.0]
        for v in values:
            nm.update(v)
        # 期望 mean=3.0, sample variance = 2.5, std=√2.5 ≈ 1.581
        assert nm.mean == pytest.approx(3.0, abs=1e-9)
        assert nm.std == pytest.approx(math.sqrt(2.5), abs=1e-6)

    def test_batch_update_matches_single(self):
        nm1 = RNDRewardNormalizer()
        nm2 = RNDRewardNormalizer()
        vs = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        for v in vs:
            nm1.update(v)
        nm2.update_batch(vs)
        assert nm1.mean == pytest.approx(nm2.mean)
        assert nm1.std == pytest.approx(nm2.std)

    def test_normalize_divides_by_std(self):
        nm = RNDRewardNormalizer()
        nm.update_batch([1.0, 2.0, 3.0, 4.0, 5.0])
        s = nm.std
        assert nm.normalize(10.0) == pytest.approx(10.0 / s)

    def test_eps_protects_against_zero_std(self):
        nm = RNDRewardNormalizer(eps=1e-3)
        nm.update_batch([5.0, 5.0, 5.0])  # 全一样 → variance=0
        # eps 保护 std ≥ 1e-3
        assert nm.std >= 1e-3


# ──────────────────────────────────────────────────────────────────────
# 3. RND 双 MLP（需 torch）
# ──────────────────────────────────────────────────────────────────────
torch = pytest.importorskip("torch")


class TestRNDNetworks:
    def test_build_networks(self):
        from rl_pytorch.intrinsic_rnd import build_rnd_networks
        # 与 game_rules.json 默认值对齐（STATE_FEATURE_DIM=187）
        cfg = RNDConfig(enabled=True, state_dim=187, hidden_dim=64, output_dim=32)
        target, predictor, opt = build_rnd_networks(cfg)
        # target 应被 freeze
        for p in target.parameters():
            assert not p.requires_grad
        # predictor 应可训练
        for p in predictor.parameters():
            assert p.requires_grad

    def test_target_frozen_after_update(self):
        from rl_pytorch.intrinsic_rnd import build_rnd_networks, compute_intrinsic_reward
        cfg = RNDConfig(enabled=True, state_dim=187, hidden_dim=64, output_dim=32)
        target, predictor, opt = build_rnd_networks(cfg)
        target_sd_before = {k: v.clone() for k, v in target.state_dict().items()}
        states = torch.randn(16, 187)
        _, loss = compute_intrinsic_reward(target, predictor, states)
        loss.backward()
        opt.step()
        for k, v in target.state_dict().items():
            assert torch.equal(v, target_sd_before[k]), f"target param {k} 被更新了！"

    def test_predictor_loss_decreases_with_training(self):
        from rl_pytorch.intrinsic_rnd import build_rnd_networks, compute_intrinsic_reward
        cfg = RNDConfig(enabled=True, state_dim=10, hidden_dim=16, output_dim=8, learning_rate=1e-2)
        target, predictor, opt = build_rnd_networks(cfg)
        # 固定一组 state，反复训练 → loss 应下降
        states = torch.randn(32, 10)
        _, loss0 = compute_intrinsic_reward(target, predictor, states)
        loss0_val = float(loss0.item())
        for _ in range(50):
            _, loss = compute_intrinsic_reward(target, predictor, states)
            opt.zero_grad()
            loss.backward()
            opt.step()
        _, loss_final = compute_intrinsic_reward(target, predictor, states)
        assert float(loss_final.item()) < loss0_val * 0.5, (
            f"50 步训练后 loss 没显著下降：{loss0_val:.4f} → {float(loss_final.item()):.4f}"
        )

    def test_intrinsic_reward_shape(self):
        from rl_pytorch.intrinsic_rnd import build_rnd_networks, compute_intrinsic_reward
        cfg = RNDConfig(enabled=True, state_dim=187, hidden_dim=64, output_dim=32)
        target, predictor, _ = build_rnd_networks(cfg)
        states = torch.randn(8, 187)
        rewards, loss = compute_intrinsic_reward(target, predictor, states)
        assert rewards.shape == (8,)
        assert loss.dim() == 0  # 标量
        assert not rewards.requires_grad
        assert loss.requires_grad


# ──────────────────────────────────────────────────────────────────────
# 4. 与 game_rules.json 默认值一致
# ──────────────────────────────────────────────────────────────────────
class TestConfigConsistency:
    def test_defaults_match_game_rules_json(self):
        repo_root = Path(__file__).resolve().parents[1]
        with open(repo_root / "shared" / "game_rules.json", encoding="utf-8") as f:
            d = json.load(f)
        rs = d.get("rlRewardShaping", {})
        cfg = rs.get("rndCuriosity") or {}
        # rndCuriosity 在 v11.2 之后写入；缺失时本测试 vacuous pass
        if "enabled" in cfg:
            assert isinstance(cfg["enabled"], bool)
            assert cfg["enabled"] is False, "默认应为 off"
        if "beta" in cfg:
            assert 0.0 < cfg["beta"] < 10.0
        if "hiddenDim" in cfg:
            assert cfg["hiddenDim"] >= 8
        if "minEpisode" in cfg:
            assert cfg["minEpisode"] >= 0
