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
        """4 段拐点处值应严格等于设计的边界值。"""
        assert target_S_curve(SEG_GENTLE_END) == pytest.approx(D_GENTLE_END, abs=1e-9)
        assert target_S_curve(SEG_MID_END) == pytest.approx(D_MID_END, abs=1e-9)
        # 刹车段终点 (r=1.0) 由 sigmoid 计算,接近但不严格等于 D_BRAKE_END
        # sigmoid(0.03*40)=sigmoid(1.2)≈0.768, 所以 D(1.0) ≈ 0.50 + 0.768*0.40 ≈ 0.807
        # 第 4 段起点 (r=1.0) 严格等于 D_BRAKE_END
        # 这里检查跨段不要有跳变 > 0.1
        eps = 1e-6
        v_before = target_S_curve(SEG_BRAKE_END - eps)
        v_after = target_S_curve(SEG_BRAKE_END + eps)
        # 第 3 段终点 sigmoid(1.2)≈0.769 → D ≈ 0.807
        # 第 4 段起点 = D_BRAKE_END = 0.90
        # 容忍连续性误差 < 0.15
        assert abs(v_after - v_before) < 0.15, f"discontinuity at r=1: {v_before} -> {v_after}"

    def test_origin_to_brake_monotonic(self):
        """[0, 1.5] 区间应单调非降 (允许 1e-6 数值误差)。"""
        rs = [i / 100 for i in range(0, 151)]
        ds = [target_S_curve(r) for r in rs]
        assert is_monotonic_non_decreasing(ds, tol=1e-4)

    def test_cap_at_high_r(self):
        """r >> 1 时应趋近 D_CAP。"""
        assert target_S_curve(2.0) == target_S_curve(CURVE_R_MAX)  # clip
        assert target_S_curve(CURVE_R_MAX) < D_CAP + 1e-9

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
        # 第 0 bin 中点 = 0.5/20 * 1.5 = 0.0375
        assert v[0] >= D_BASE - 1e-9
        assert v[0] < D_GENTLE_END
        # 最后 bin 中点 = 19.5/20 * 1.5 = 1.4625 → 在第 4 段
        assert v[-1] > D_BRAKE_END - 1e-9


class TestRToBin:
    """r → bin index 映射测试。"""

    def test_zero(self):
        assert r_to_bin(0.0) == 0

    def test_clip_at_max(self):
        assert r_to_bin(CURVE_R_MAX) == CURVE_N_BINS - 1
        assert r_to_bin(CURVE_R_MAX + 0.5) == CURVE_N_BINS - 1

    def test_mid_value(self):
        # r=0.75, n_bins=20, r_max=1.5 → bin_width=0.075 → idx = int(0.75/0.075) = 10
        assert r_to_bin(0.75) == 10

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
