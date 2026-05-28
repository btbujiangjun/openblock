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
    """v3.1 (G5): d_step = (1-BLEND)*state_d + BLEND*pb_aware_lift(r, θ_center, θ_width).
       BLEND=0.40, default θ_center=0.82, θ_width=0.08.
       state_d = 0.30*fillRate + 0.50*(1-action_freedom) + 0.20*trend_norm.
       pb_aware_lift = sigmoid((r - θ_center) / θ_width) ∈ (0, 1).
    """

    def test_no_move_returns_1(self):
        st = make_step(0, 100, fill=0.5, freedom=0.3, no_move=True)
        assert st.step_difficulty([], ratio=0.5) == 1.0

    def test_v31_d_step_depends_on_ratio(self):
        """v3.1 (G5): d_step 显式依赖 ratio — PB-aware lift 项让 r 影响 d_step."""
        st = make_step(0, 100, fill=0.5, freedom=0.5)
        d_low = st.step_difficulty([], ratio=0.0)    # r << center → lift ≈ 0
        d_high = st.step_difficulty([], ratio=2.0)   # r >> center → lift ≈ 1
        assert d_high > d_low + 0.30, "v3.1 PB-aware lift 应让 r 高时 d_step 显著升高"

    def test_v31_state_d_neutral_low_ratio(self):
        """state_d=0.5, r=0 (远小 center=0.82) → d_step ≈ 0.6*0.5 + 0.4*0 ≈ 0.30."""
        st = make_step(0, 100, fill=0.5, freedom=0.5)
        d = st.step_difficulty([], ratio=0.0)
        # lift(r=0, c=0.82, w=0.08) ≈ sigmoid(-10.25) ≈ 0
        # d = 0.6 * 0.5 + 0.4 * 0 = 0.30
        assert d == pytest.approx(0.30, abs=0.02)

    def test_v31_state_d_neutral_high_ratio(self):
        """state_d=0.5, r=1.5 (远大 center=0.82) → d_step ≈ 0.6*0.5 + 0.4*1 = 0.70."""
        st = make_step(0, 100, fill=0.5, freedom=0.5)
        d = st.step_difficulty([], ratio=1.5)
        # lift(r=1.5, c=0.82, w=0.08) ≈ sigmoid(8.5) ≈ 1
        assert d == pytest.approx(0.70, abs=0.02)

    def test_v31_state_d_high_pressure_high_ratio(self):
        """棋盘满 (state_d=0.90) + r=2.0 → d_step ≈ 0.6*0.90 + 0.4*1 = 0.94."""
        st = make_step(0, 100, fill=1.0, freedom=0.0)
        d = st.step_difficulty([], ratio=2.0)
        assert d == pytest.approx(0.94, abs=0.03)

    def test_v31_state_d_low_pressure_low_ratio(self):
        """棋盘空 (state_d=0.10) + r=0 → d_step ≈ 0.6*0.10 + 0.4*0 = 0.06."""
        st = make_step(0, 100, fill=0.0, freedom=1.0)
        d = st.step_difficulty([], ratio=0.0)
        assert d == pytest.approx(0.06, abs=0.02)

    def test_v31_theta_overrides_default(self):
        """θ_center / θ_width 显式传入应能改变 lift 形状."""
        st = make_step(0, 100, fill=0.5, freedom=0.5)
        # 用 default θ (center=0.82, width=0.08): r=0.5 远小 center, lift ~ 0
        d_default = st.step_difficulty([], ratio=0.5)
        # 移 center 到 0.30 (PB 张力提前激活), r=0.5 大于 center → lift ~ 1
        d_early = st.step_difficulty(
            [], ratio=0.5,
            theta_pb_tension_center=0.30, theta_pb_tension_width=0.08,
        )
        assert d_early > d_default + 0.20, "θ_center 早激活时同 ratio 下 d_step 应更高"

    def test_surprise_damping_on_state(self):
        """clears >= 3 时 state_d *= 0.5 (惊喜事件减压).
        normal: state_d = 0.30*0.6 + 0.50*0.7 + 0.20*0.5 = 0.18+0.35+0.10 = 0.63
        surprise: 0.63 * 0.5 = 0.315
        """
        st_normal = make_step(0, 100, fill=0.6, freedom=0.3, clears=0)
        st_surprise = make_step(0, 100, fill=0.6, freedom=0.3, clears=4)
        d_normal = st_normal.step_difficulty([], ratio=0.5)
        d_surprise = st_surprise.step_difficulty([], ratio=0.5)
        # surprise 应该减压约一半
        assert d_surprise == pytest.approx(d_normal * 0.5, abs=0.02)

    def test_trend_upward(self):
        """填充率上升趋势会让 state_d 升高 → d 升高。"""
        st = make_step(0, 100, fill=0.6, freedom=0.5)
        d_no_trend = st.step_difficulty([], ratio=0.5)
        d_upward = st.step_difficulty([0.3, 0.4, 0.45], ratio=0.5)
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

    def test_v31_d_curve_has_s_shape_via_pb_aware(self):
        """v3.1 (G5): 即便 state_d 恒定, PB-aware lift 也会让 d_curve 自带 S 形 r 依赖.

        d_step = 0.6*state_d + 0.4*sigmoid((r - 0.82) / 0.08).
        state_d=0.5 时 head (r≈0.05) ≈ 0.30, tail (r≈1.45) ≈ 0.70 → 跨度 ≈ 0.40.
        这是 v3.1 G5 核心收益: 启发式实测 d_curve 物理上有 S 形.
        """
        steps = [
            make_step(i, int((i + 0.5) * 0.1 * 100), fill=0.5, freedom=0.5)
            for i in range(20)
        ]
        labels = extract_d_curve(steps, pb=100)
        c = labels.d_curve
        head = sum(c[:3]) / 3
        tail = sum(c[-3:]) / 3
        # v3.1: 跨度应明显 (PB-aware 贡献 ~0.40)
        assert tail - head > 0.25, f"v3.1 PB-aware 应让 d_curve 有跨度, got head={head:.3f} tail={tail:.3f}"

    def test_sparse_bins_use_last_value(self):
        """v3.0: 空 bin 用 lastValue 填充 (前一个有数据 bin 的值).
        训练时 bin_counts=0 → loss mask, 填什么不影响.
        仅验证 chart 显示连续性 (尾段 = 最后真实观察).
        """
        steps = [
            make_step(i, int(i * 5), fill=0.5, freedom=0.5)
            for i in range(20)
        ]
        # 这些 sample 跑下来 r=0.0→0.0095, 全在 bin 0, 后续 bin 全空 → 用 lastValue 填
        labels = extract_d_curve(steps, pb=10000)
        c = labels.d_curve
        # 全部 bin 应相等 (lastValue 传播)
        assert all(abs(c[i] - c[0]) < 1e-9 for i in range(20))

    def test_v31_dense_bins_pure_observation(self):
        """v3.1: 数据丰富 bin 是纯观察 (无 prior).
        state_d = 0.30*0 + 0.50*0 + 0.20*0.5 = 0.10, r ≈ 0.05 → lift ≈ 0
        d_step = 0.6*0.10 + 0.4*0 ≈ 0.06
        """
        steps = [
            make_step(i, 5, fill=0.0, freedom=1.0)
            for i in range(50)
        ]
        labels = extract_d_curve(steps, pb=100)
        assert labels.d_curve[0] == pytest.approx(0.06, abs=0.02)


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
