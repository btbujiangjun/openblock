"""rl_pytorch/curriculum_feedback.py 单元测试。

四档闭环反馈契约（v11，borrow search-contempt §4.2 idea）：
  - wr ≥ target + accelBand                                 → "accel"     虚拟局数 +stepUp×checkEvery
  - wr ∈ [target − holdBand, target + accelBand)            → "hold"      +checkEvery
  - wr ∈ [target − lowWinRateBand, target − holdBand)       → "pause"     不变
  - wr ∈ [target − severeWinRateBand, target − lowWinRateBand) → "rollback" -stepDown×checkEvery
  - wr <  target − severeWinRateBand                        → "severe"    virtual_ep × severeRollbackFactor
  - 样本数 < minSamplesForAction                            → "warmup"    +checkEvery
"""

from __future__ import annotations

import collections

import pytest

from .curriculum_feedback import CurriculumDecision, compute_curriculum_action


def _hist(wins: int, total: int):
    """构造一个 win_history deque：前 wins 个为 1，其余为 0。"""
    d = collections.deque(maxlen=max(total, 1))
    for _ in range(wins):
        d.append(1)
    for _ in range(total - wins):
        d.append(0)
    return d


def _default_kwargs(**override):
    kw = dict(
        target_win_rate=0.5,
        accel_band=0.1,
        hold_band=0.1,
        low_win_rate_band=0.2,
        severe_win_rate_band=0.4,
        step_up=2.0,
        step_down=1.0,
        check_every=50,
        min_virtual_ep=0.0,
        rollback_on_severe_drop=True,
        severe_rollback_factor=0.5,
        min_samples_for_action=10,
    )
    kw.update(override)
    return kw


# ---------------------------------------------------------------------------
# 五档常规反应
# ---------------------------------------------------------------------------

def test_high_wr_accelerates():
    """wr=0.8 > 0.5+0.1=0.6 → accel；vep += stepUp × checkEvery = 2 × 50 = 100。"""
    d = compute_curriculum_action(
        win_history=_hist(80, 100),
        virtual_ep=1000.0,
        **_default_kwargs(),
    )
    assert d.action == "accel"
    assert d.win_rate == pytest.approx(0.8)
    assert d.new_virtual_ep == pytest.approx(1100.0)
    assert d.delta_virtual_ep == pytest.approx(100.0)


def test_at_accel_boundary_inclusive():
    """wr 恰等于 target+accelBand=0.6 → accel（区间为 [accel_lower, +∞)）。"""
    d = compute_curriculum_action(
        win_history=_hist(60, 100),
        virtual_ep=500.0,
        **_default_kwargs(),
    )
    assert d.action == "accel"


def test_target_wr_hold():
    """wr=0.5（恰等 target）→ hold；vep += checkEvery。"""
    d = compute_curriculum_action(
        win_history=_hist(50, 100),
        virtual_ep=200.0,
        **_default_kwargs(),
    )
    assert d.action == "hold"
    assert d.win_rate == pytest.approx(0.5)
    assert d.new_virtual_ep == pytest.approx(250.0)
    assert d.delta_virtual_ep == pytest.approx(50.0)


def test_slightly_below_target_still_hold():
    """wr=0.45 仍在 [target-holdBand=0.4, target+accelBand=0.6) → hold。"""
    d = compute_curriculum_action(
        win_history=_hist(45, 100),
        virtual_ep=200.0,
        **_default_kwargs(),
    )
    assert d.action == "hold"


def test_low_wr_pauses():
    """wr=0.35 ∈ [target-lowWinRateBand=0.3, target-holdBand=0.4) → pause；vep 不变。"""
    d = compute_curriculum_action(
        win_history=_hist(35, 100),
        virtual_ep=800.0,
        **_default_kwargs(),
    )
    assert d.action == "pause"
    assert d.new_virtual_ep == pytest.approx(800.0)
    assert d.delta_virtual_ep == pytest.approx(0.0)


def test_significant_drop_rolls_back():
    """wr=0.2 ∈ [target-severeWinRateBand=0.1, target-lowWinRateBand=0.3) → rollback；vep -= 50。"""
    d = compute_curriculum_action(
        win_history=_hist(20, 100),
        virtual_ep=800.0,
        **_default_kwargs(),
    )
    assert d.action == "rollback"
    assert d.new_virtual_ep == pytest.approx(750.0)
    assert d.delta_virtual_ep == pytest.approx(-50.0)


def test_severe_drop_triggers_rollback_factor():
    """wr=0.05 < target-severeWinRateBand=0.1 → severe；virtual_ep × 0.5。"""
    d = compute_curriculum_action(
        win_history=_hist(5, 100),
        virtual_ep=800.0,
        **_default_kwargs(),
    )
    assert d.action == "severe"
    assert d.new_virtual_ep == pytest.approx(400.0)
    assert d.delta_virtual_ep == pytest.approx(-400.0)


# ---------------------------------------------------------------------------
# 边界 / 安全性
# ---------------------------------------------------------------------------

def test_warmup_when_insufficient_samples():
    """样本数 < minSamplesForAction=10 → warmup 强制按 +checkEvery 推进。"""
    d = compute_curriculum_action(
        win_history=_hist(3, 5),
        virtual_ep=100.0,
        **_default_kwargs(),
    )
    assert d.action == "warmup"
    assert d.win_rate == -1.0
    assert d.new_virtual_ep == pytest.approx(150.0)


def test_empty_history_warmup():
    """空 deque → warmup。"""
    d = compute_curriculum_action(
        win_history=collections.deque(),
        virtual_ep=0.0,
        **_default_kwargs(),
    )
    assert d.action == "warmup"
    assert d.new_virtual_ep == pytest.approx(50.0)


def test_rollback_respects_min_virtual_ep_floor():
    """rollback 不会让 virtual_ep 穿越 minVirtualEp=0 下界。"""
    d = compute_curriculum_action(
        win_history=_hist(20, 100),
        virtual_ep=30.0,
        **_default_kwargs(min_virtual_ep=0.0),
    )
    assert d.action == "rollback"
    assert d.new_virtual_ep == pytest.approx(0.0)


def test_severe_rollback_respects_min_virtual_ep_floor():
    """severe 在低 virtual_ep 时也不会穿底。"""
    d = compute_curriculum_action(
        win_history=_hist(2, 100),
        virtual_ep=10.0,
        **_default_kwargs(min_virtual_ep=5.0),
    )
    assert d.action == "severe"
    assert d.new_virtual_ep == pytest.approx(5.0)  # 10 × 0.5 = 5 ≥ floor


def test_severe_disabled_falls_through_to_rollback():
    """rollback_on_severe_drop=False 时，严重低胜率走 rollback 分支而非 severe。"""
    d = compute_curriculum_action(
        win_history=_hist(5, 100),
        virtual_ep=1000.0,
        **_default_kwargs(rollback_on_severe_drop=False),
    )
    assert d.action == "rollback"
    assert d.new_virtual_ep == pytest.approx(950.0)


def test_zero_step_down_emulates_v8_behavior():
    """step_down=0 → rollback 分支退化为 'pause 等效'（vep 不变），与 v8 旧行为一致。"""
    d = compute_curriculum_action(
        win_history=_hist(20, 100),
        virtual_ep=1000.0,
        **_default_kwargs(step_down=0.0),
    )
    assert d.action == "rollback"  # action 仍是 rollback（语义上承认低胜率）
    assert d.new_virtual_ep == pytest.approx(1000.0)  # 但 vep 不变（向后兼容）


def test_decision_is_pure_does_not_mutate_history():
    """纯函数：调用前后 win_history 应保持不变。"""
    hist = _hist(80, 100)
    hist_snapshot = list(hist)
    compute_curriculum_action(
        win_history=hist,
        virtual_ep=500.0,
        **_default_kwargs(),
    )
    assert list(hist) == hist_snapshot


def test_returns_curriculum_decision_dataclass():
    """返回值类型契约。"""
    d = compute_curriculum_action(
        win_history=_hist(50, 100),
        virtual_ep=0.0,
        **_default_kwargs(),
    )
    assert isinstance(d, CurriculumDecision)
    assert hasattr(d, "action")
    assert hasattr(d, "new_virtual_ep")
    assert hasattr(d, "win_rate")
    assert hasattr(d, "delta_virtual_ep")


# ---------------------------------------------------------------------------
# 与 shared/game_rules.json 默认值的一致性回归
# ---------------------------------------------------------------------------

def test_game_rules_json_defaults_load_correctly():
    """shared/game_rules.json adaptiveCurriculum 默认值应被 rl_adaptive_curriculum_config 正确解析。"""
    from .game_rules import rl_adaptive_curriculum_config

    cfg = rl_adaptive_curriculum_config()
    assert cfg["enabled"] is True
    assert cfg["targetWinRate"] == pytest.approx(0.5)
    assert cfg["stepDown"] == pytest.approx(1.0)  # v11 关键修复：默认 1.0 而非 0
    assert cfg["accelBand"] == pytest.approx(0.1)
    assert cfg["holdBand"] == pytest.approx(0.1)
    assert cfg["lowWinRateBand"] == pytest.approx(0.2)
    assert cfg["severeWinRateBand"] == pytest.approx(0.4)
    assert cfg["rollbackOnSevereDrop"] is True
    assert cfg["severeRollbackFactor"] == pytest.approx(0.5)
    assert cfg["minSamplesForAction"] == 10
