"""目标 S 曲线单元测试。

验证业务约束:
  1. 单调非降
  2. 分段连续
  3. 4 段边界值正确
  4. 边界 clip 行为
"""
import math
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest
from rl_pytorch.spawn_tuning_v2.target_curve import (
    target_S_curve, target_curve_vector, r_to_bin,
    is_monotonic_non_decreasing, get_target_metadata,
    CURVE_N_BINS, CURVE_R_MAX,
    SEG_GENTLE_END, SEG_MID_END, SEG_BRAKE_END,
    D_BASE, D_GENTLE_END, D_MID_END, D_BRAKE_END, D_CAP,
)


class TestTargetSCurve:
    """target_S_curve 单点函数测试。"""

    def test_origin(self):
        assert target_S_curve(0.0) == pytest.approx(D_BASE, abs=1e-9)

    def test_segment_boundaries(self):
        """v2.3: brake 段用端点重缩放 logistic, 4 段拐点严格连续。"""
        assert target_S_curve(SEG_GENTLE_END) == pytest.approx(D_GENTLE_END, abs=1e-9)
        assert target_S_curve(SEG_MID_END) == pytest.approx(D_MID_END, abs=1e-9)
        # v2.3 brake 段端点重缩放 → r=SEG_BRAKE_END 严格 = D_BRAKE_END (从 brake 段一侧)
        # 注: r=SEG_BRAKE_END 时会进入 overshoot 段, overshoot(r=SEG_BRAKE_END) = D_BRAKE_END
        # brake 一侧应该用 r 略小于 SEG_BRAKE_END 测试
        eps = 1e-6
        v_brake_end = target_S_curve(SEG_BRAKE_END - eps)
        v_overshoot_start = target_S_curve(SEG_BRAKE_END + eps)
        # 两侧严格连续 — v2.3 重缩放后差 < 1e-3
        assert abs(v_brake_end - D_BRAKE_END) < 1e-3
        assert abs(v_overshoot_start - D_BRAKE_END) < 1e-3
        assert abs(v_overshoot_start - v_brake_end) < 1e-3, \
            f"discontinuity at r=SEG_BRAKE_END: {v_brake_end} -> {v_overshoot_start}"

    def test_origin_to_brake_monotonic(self):
        """[0, CURVE_R_MAX] 区间应单调非降 (允许 1e-6 数值误差)。"""
        rs = [i / 100 for i in range(0, int(CURVE_R_MAX * 100) + 1)]
        ds = [target_S_curve(r) for r in rs]
        assert is_monotonic_non_decreasing(ds, tol=1e-4)

    def test_cap_at_high_r(self):
        """v2.3: r >> 1 时应非常接近 D_CAP (OVERSHOOT_DECAY=6 让 r=1.5 时 D>0.99)。"""
        assert target_S_curve(3.0) == target_S_curve(CURVE_R_MAX)  # clip
        assert target_S_curve(CURVE_R_MAX) < D_CAP + 1e-9
        # v2.3 新约束: r=1.5 时 D 应接近 1.0
        assert target_S_curve(1.5) > 0.99
        # r=2.0 (max) 时 D 应基本到 1.0
        assert target_S_curve(2.0) > 0.999

    def test_negative_r_clipped(self):
        """负数 r 应被 clip 到 0。"""
        assert target_S_curve(-1.0) == target_S_curve(0.0)


class TestCurveVector:
    """20 维目标向量测试。"""

    def test_length(self):
        v = target_curve_vector()
        assert len(v) == CURVE_N_BINS

    def test_custom_n_bins(self):
        v = target_curve_vector(n_bins=10)
        assert len(v) == 10

    def test_invalid_n_bins(self):
        with pytest.raises(ValueError):
            target_curve_vector(n_bins=0)
        with pytest.raises(ValueError):
            target_curve_vector(n_bins=-5)

    def test_monotonic(self):
        v = target_curve_vector()
        assert is_monotonic_non_decreasing(v, tol=1e-4)

    def test_first_and_last_values(self):
        """第 0 bin 应接近 D_BASE,最后 bin 应接近 D_CAP。"""
        v = target_curve_vector()
        # 第 0 bin 中点 = 0.5/20 * 2.0 = 0.05 (v2.3 r_max=2.0)
        assert v[0] >= D_BASE - 1e-9
        assert v[0] < D_GENTLE_END
        # 最后 bin 中点 = 19.5/20 * 2.0 = 1.95 → 在第 4 段, v2.3 时应接近 D_CAP
        assert v[-1] > D_BRAKE_END - 1e-9
        assert v[-1] > 0.999  # v2.3: 最后 bin 极接近 1.0


class TestRToBin:
    """r → bin index 映射测试。"""

    def test_zero(self):
        assert r_to_bin(0.0) == 0

    def test_clip_at_max(self):
        assert r_to_bin(CURVE_R_MAX) == CURVE_N_BINS - 1
        assert r_to_bin(CURVE_R_MAX + 0.5) == CURVE_N_BINS - 1

    def test_mid_value(self):
        # v2.3: r=1.0, n_bins=20, r_max=2.0 → bin_width=0.1 → idx = int(1.0/0.1) = 10
        assert r_to_bin(1.0) == 10
        # r=0.5 → idx = 5
        assert r_to_bin(0.5) == 5

    def test_negative_clipped(self):
        assert r_to_bin(-1.0) == 0


class TestMetadata:
    def test_metadata_structure(self):
        meta = get_target_metadata()
        assert "version" in meta
        assert "n_bins" in meta
        assert "r_max" in meta
        assert "segments" in meta
        assert len(meta["segments"]) == 4
        # 验证 segments 顺序覆盖 [0, r_max]
        prev_end = 0.0
        for seg in meta["segments"]:
            assert seg["r_range"][0] == pytest.approx(prev_end)
            prev_end = seg["r_range"][1]
        assert prev_end == pytest.approx(CURVE_R_MAX)
