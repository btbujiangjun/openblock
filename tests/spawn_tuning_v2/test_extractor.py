"""d_curve 提取器单元测试。

验证:
  1. 单步难度公式正确性
  2. 完整 episode → 20 维 d_curve
  3. 空 bin 插值行为
  4. 边界情况 (PB=0, 空 steps, 全死局)
  5. 聚合函数
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest
from rl_pytorch.spawn_tuning_v2.extractor import (
    StepInfo, EpisodeLabels, extract_d_curve, aggregate_d_curves,
    FILL_RATE_WEIGHT, ACTION_FREEDOM_WEIGHT, TREND_WEIGHT,
    SURPRISE_DAMPING, SURPRISE_MIN_CLEARS,
)


def make_step(idx, score, fill, freedom, no_move=False, clears=0):
    return StepInfo(
        step_idx=idx, score=score,
        fill_rate=fill, action_freedom=freedom,
        no_move=no_move, clears=clears,
    )


class TestStepDifficulty:
    def test_no_move_returns_1(self):
        st = make_step(0, 100, fill=0.5, freedom=0.3, no_move=True)
        assert st.step_difficulty([]) == 1.0

    def test_basic_formula_no_trend(self):
        st = make_step(0, 100, fill=0.5, freedom=0.5)
        # trend_norm = 0.5 (没历史 fills, 中性)
        # = 0.3*0.5 + 0.5*(1-0.5) + 0.2*0.5 = 0.15 + 0.25 + 0.10 = 0.50
        assert st.step_difficulty([]) == pytest.approx(0.50, abs=1e-6)

    def test_high_fill_high_difficulty(self):
        st = make_step(0, 100, fill=0.95, freedom=0.1)
        d = st.step_difficulty([])
        # = 0.3*0.95 + 0.5*0.9 + 0.2*0.5 = 0.285 + 0.45 + 0.1 = 0.835
        assert d > 0.80

    def test_low_fill_low_difficulty(self):
        st = make_step(0, 100, fill=0.1, freedom=0.95)
        d = st.step_difficulty([])
        # = 0.3*0.1 + 0.5*0.05 + 0.2*0.5 = 0.03 + 0.025 + 0.1 = 0.155
        assert d < 0.20

    def test_surprise_damping(self):
        """≥ 3 行消行触发惊喜降难。"""
        st = make_step(0, 100, fill=0.5, freedom=0.3, clears=4)
        d = st.step_difficulty([])
        # base = 0.3*0.5 + 0.5*0.7 + 0.2*0.5 = 0.15 + 0.35 + 0.1 = 0.60
        # surprise damping × 0.5 → 0.30
        assert d == pytest.approx(0.30, abs=1e-6)

    def test_trend_upward(self):
        """填充率上升趋势会让 trend_norm > 0.5,提高难度。"""
        st = make_step(0, 100, fill=0.6, freedom=0.5)
        d_no_trend = st.step_difficulty([])
        d_upward = st.step_difficulty([0.3, 0.4, 0.45])  # 历史均值 0.383, 当前 0.6
        # trend = 0.6 - 0.383 = +0.217, trend_norm ≈ 0.717
        assert d_upward > d_no_trend


class TestExtractDCurve:
    """提取整局 d_curve 的端到端测试。"""

    def test_simple_episode(self):
        """3 步玩家逐步逼近 PB=100, score 从 0 → 30 → 60 → 90"""
        steps = [
            make_step(0, 30, fill=0.3, freedom=0.7),
            make_step(1, 60, fill=0.5, freedom=0.5),
            make_step(2, 90, fill=0.7, freedom=0.3),
        ]
        labels = extract_d_curve(steps, pb=100)
        assert len(labels.d_curve) == 20
        assert labels.final_score == 90
        assert labels.survived_steps == 3
        assert labels.pb_broke is False
        assert labels.noMove_step == -1
        assert labels.surprise_count == 0

    def test_pb_break(self):
        """玩家破 PB"""
        steps = [
            make_step(0, 50, fill=0.3, freedom=0.7),
            make_step(1, 110, fill=0.5, freedom=0.5),
        ]
        labels = extract_d_curve(steps, pb=100)
        assert labels.pb_broke is True

    def test_no_move_record(self):
        """记录首次 noMove"""
        steps = [
            make_step(0, 30, fill=0.3, freedom=0.7),
            make_step(1, 50, fill=0.9, freedom=0.0, no_move=True),
            make_step(2, 50, fill=0.9, freedom=0.0, no_move=True),
        ]
        labels = extract_d_curve(steps, pb=100)
        assert labels.noMove_step == 1  # 首次

    def test_clear_rate(self):
        steps = [
            make_step(0, 30, fill=0.3, freedom=0.7, clears=1),
            make_step(1, 60, fill=0.5, freedom=0.5, clears=2),
            make_step(2, 90, fill=0.7, freedom=0.3, clears=0),
        ]
        labels = extract_d_curve(steps, pb=100)
        # 总消行 3, 总步数 3 → clear_rate = 1.0
        assert labels.clear_rate == pytest.approx(1.0)

    def test_surprise_count(self):
        steps = [
            make_step(0, 30, fill=0.3, freedom=0.7, clears=3),  # surprise
            make_step(1, 60, fill=0.5, freedom=0.5, clears=4),  # surprise
            make_step(2, 90, fill=0.7, freedom=0.3, clears=1),  # 不是
        ]
        labels = extract_d_curve(steps, pb=100)
        assert labels.surprise_count == 2

    def test_invalid_pb(self):
        steps = [make_step(0, 30, fill=0.3, freedom=0.7)]
        with pytest.raises(ValueError):
            extract_d_curve(steps, pb=0)
        with pytest.raises(ValueError):
            extract_d_curve(steps, pb=-100)

    def test_empty_steps(self):
        with pytest.raises(ValueError):
            extract_d_curve([], pb=100)

    def test_d_curve_in_unit_interval(self):
        """所有 d_curve 值应在 [0, 1] 区间。"""
        steps = [
            make_step(i, i * 5, fill=min(0.95, i * 0.05),
                      freedom=max(0.05, 1 - i * 0.05))
            for i in range(20)
        ]
        labels = extract_d_curve(steps, pb=100)
        for v in labels.d_curve:
            assert 0.0 <= v <= 1.0, f"d_curve value {v} out of [0,1]"

    def test_overshoot_clamped(self):
        """score >> pb 时 r 应 clip 到最后 bin"""
        steps = [make_step(0, 1000, fill=0.5, freedom=0.5)]
        labels = extract_d_curve(steps, pb=100)
        # r = 10.0 → clipped to 1.5- → 最后 bin
        assert labels.n_bins_filled == 1

    def test_bin_filling(self):
        """覆盖多个 r bins 时,应填到对应 bin"""
        # PB=100, r=0.05/0.55/1.05 → bin 0, 7, 14
        steps = [
            make_step(0, 5, fill=0.1, freedom=0.9),     # r=0.05
            make_step(1, 55, fill=0.5, freedom=0.5),    # r=0.55
            make_step(2, 105, fill=0.7, freedom=0.3),   # r=1.05
        ]
        labels = extract_d_curve(steps, pb=100)
        # 至少 3 个 bin 有数据
        assert labels.n_bins_filled >= 3


class TestAggregate:
    def test_aggregate_simple(self):
        curves = [
            [0.1, 0.2, 0.3],
            [0.3, 0.4, 0.5],
            [0.2, 0.3, 0.4],
        ]
        avg = aggregate_d_curves(curves)
        assert len(avg) == 3
        assert avg[0] == pytest.approx(0.2, abs=1e-9)
        assert avg[1] == pytest.approx(0.3, abs=1e-9)
        assert avg[2] == pytest.approx(0.4, abs=1e-9)

    def test_aggregate_empty(self):
        assert aggregate_d_curves([]) == []

    def test_aggregate_length_mismatch(self):
        with pytest.raises(ValueError):
            aggregate_d_curves([[0.1, 0.2], [0.3, 0.4, 0.5]])
