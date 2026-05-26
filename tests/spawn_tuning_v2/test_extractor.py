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
    """v2.10.6: d_step = d_pb_base(ratio) + 0.30 * (state_d - 0.5), clipped [0,1].
       d_pb_base = 0.30 + 0.62 * sigmoid((ratio - 0.85) / 0.18)
       端点拉宽: 0.30 → 0.92 (跨度 0.62)
    """

    def test_no_move_returns_1(self):
        st = make_step(0, 100, fill=0.5, freedom=0.3, no_move=True)
        assert st.step_difficulty([], ratio=0.5) == 1.0

    def test_ratio_zero_low_base(self):
        """ratio=0 时 d_pb_base ≈ 0.30 (S 形底部)。"""
        st = make_step(0, 100, fill=0.5, freedom=0.5)
        # state_d=0.5 → state_offset=0
        # d_pb_base(0) = 0.30 + 0.62 * sigmoid(-0.85/0.18) ≈ 0.303
        d = st.step_difficulty([], ratio=0.0)
        assert d == pytest.approx(0.303, abs=0.01)

    def test_ratio_peak_high_base(self):
        """ratio>>1 时 d_pb_base ≈ 0.92 (S 形顶部)。"""
        st = make_step(0, 100, fill=0.5, freedom=0.5)
        d = st.step_difficulty([], ratio=2.0)
        # d_pb_base(2.0) = 0.30 + 0.62 * sigmoid(1.15/0.18) ≈ 0.918
        assert d == pytest.approx(0.918, abs=0.01)

    def test_ratio_monotonic(self):
        """同 state, ratio 越大 d 越大 (业务命题 '接近 PB 加压')。"""
        st = make_step(0, 100, fill=0.5, freedom=0.5)
        ds = [st.step_difficulty([], ratio=r) for r in [0.0, 0.5, 0.85, 1.0, 1.5, 2.0]]
        for i in range(1, len(ds)):
            assert ds[i] >= ds[i-1] - 1e-9, f"non-monotonic at i={i}: {ds}"
        # 跨度应明显 (≥ 0.4)
        assert ds[-1] - ds[0] > 0.4

    def test_state_offset_magnitude(self):
        """同 ratio, state_d=1.0 比 state_d=0 高 ≈ 0.30 (state_weight)。"""
        st_low = make_step(0, 100, fill=0.0, freedom=1.0)  # state_d ≈ 0.1
        st_high = make_step(0, 100, fill=1.0, freedom=0.0) # state_d ≈ 1.0
        d_low = st_low.step_difficulty([], ratio=0.5)
        d_high = st_high.step_difficulty([], ratio=0.5)
        # diff ≈ (1.0 - 0.1) * 0.30 ≈ 0.27
        assert 0.20 < (d_high - d_low) < 0.35

    def test_surprise_damping_on_state(self):
        """≥3 行消行只衰减 state_d, 不影响 PB 基础。"""
        st_no_clear = make_step(0, 100, fill=0.5, freedom=0.5, clears=0)
        st_surprise = make_step(0, 100, fill=0.5, freedom=0.5, clears=4)
        d_no = st_no_clear.step_difficulty([], ratio=0.5)
        d_su = st_surprise.step_difficulty([], ratio=0.5)
        # state_d 从 0.5 → 0.25, offset 从 0 → -0.075
        # 但 d_pb_base 不变, 所以 d_no ≈ d_su 但 d_su 略低
        assert d_su < d_no
        assert (d_no - d_su) < 0.10

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

    def test_v210_d_curve_has_s_shape(self):
        """v2.10 关键: 即使棋盘状态恒定, d_curve 也应有 S 形 (因为 d_pb_base 随 r 升)。

        修复前 (v2.9): 状态恒定 → 所有 bin d_step 一样 → d_curve 几乎水平。
        修复后 (v2.10): 状态恒定 → d_pb_base 随 ratio 升 → d_curve 有明显 S 形。
        """
        # 20 步均匀分布 r=0.05→1.95, 棋盘状态完全恒定 (state_d=0.5)
        steps = [
            make_step(i, int((i + 0.5) * 0.1 * 100), fill=0.5, freedom=0.5)
            for i in range(20)
        ]
        labels = extract_d_curve(steps, pb=100)
        c = labels.d_curve
        # 头几 bin (低 r) 应比尾几 bin (高 r) 低显著差距
        head = sum(c[:3]) / 3
        tail = sum(c[-3:]) / 3
        assert tail - head > 0.30, f"v2.10 应有 S 形跨度 > 0.3, got head={head:.3f} tail={tail:.3f}"
        # 大致单调
        diffs = [c[i+1] - c[i] for i in range(len(c) - 1)]
        n_rises = sum(1 for d in diffs if d >= -0.01)
        assert n_rises >= 15, f"大部分 bin 应递增, got {n_rises}/19"

    def test_v2101_sparse_bins_use_prior(self):
        """v2.10.6: bot 弱时高 r bin 无数据, 空 bin 应填 d_pb_base 而非 lastValue。
        端点 0.30 → 0.92 (拉宽后跨度 0.62)。
        """
        steps = [
            make_step(i, int(i * 5), fill=0.5, freedom=0.5)
            for i in range(20)
        ]
        labels = extract_d_curve(steps, pb=1000)
        c = labels.d_curve
        # 末尾 bin 应接近 d_pb_base(1.95) ≈ 0.92
        assert c[-1] > 0.85, f"末尾应回归 S 形顶部 (~0.92), got {c[-1]:.3f}"
        # 前面有数据的 bin 应在 d_pb_base 附近 (低 r 区 ≈ 0.30)
        assert c[0] < 0.45, f"头部应接近 S 形底部 (~0.30), got {c[0]:.3f}"
        # 跨度 ≥ 0.50
        assert c[-1] - c[0] > 0.50, f"跨度应 > 0.5, got {c[-1] - c[0]:.3f}"

    def test_v2101_dense_bins_keep_observation(self):
        """v2.10.6: 数据丰富 bin (count >> PRIOR_STRENGTH=3) 应主要保留观察值。
           端点 0.30, state_d=0.1 低 → d_step ≈ 0.30 + 0.30*(0.1-0.5) = 0.18
        """
        steps = [
            make_step(i, 5, fill=0.0, freedom=1.0)   # state_d ≈ 0.1
            for i in range(50)
        ]
        labels = extract_d_curve(steps, pb=100)
        # d_step ≈ d_pb_base(0.025) + 0.30*(0.1-0.5) ≈ 0.30 - 0.12 = 0.18
        # 加权 w=0.943, d_curve[0] ≈ 0.943*0.18 + 0.057*0.30 ≈ 0.19
        assert 0.14 < labels.d_curve[0] < 0.24, f"丰富 bin 应保留观察, got {labels.d_curve[0]:.3f}"


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
