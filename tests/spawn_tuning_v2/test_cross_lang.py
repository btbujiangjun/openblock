"""跨语言一致性测试 — Python target_S_curve 与 JS targetSCurve 同结果。

通过比对预先算好的关键点(JS 端测试同样验证), 确保两端实现等价。
任何一端修改都要让本测试 + 对应 JS 测试同时通过。
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest
from rl_pytorch.spawn_tuning_v2.target_curve import (
    target_S_curve, target_curve_vector,
)


# v2.3 参考点 — 与 JS targetSCurve.test.js 同步; 修改任一端必须更新两端
REFERENCE_POINTS = [
    # (r, expected_D, comment)
    (0.0,    0.20,   "origin = D_BASE"),
    (0.5,    0.30,   "gentle_end = D_GENTLE_END"),
    (0.70,   0.50,   "mid_end = D_MID_END (brake 起点)"),
    (0.90,   0.71,   "brake 中点 (重缩放 sigmoid t=0.5): D = 0.5 + 0.5*0.42"),
    (1.10,   0.92,   "brake_end = D_BRAKE_END (overshoot 起点)"),
    (1.5,    None,   "overshoot 接近 D_CAP=1.0"),
    (2.0,    None,   "r_max, 应几乎等于 D_CAP"),
]


class TestCrossLangReferenceValues:
    """与 JS targetSCurve.test.js 严格对应的固定参考值。"""

    @pytest.mark.parametrize("r,expected,comment", REFERENCE_POINTS)
    def test_point(self, r, expected, comment):
        v = target_S_curve(r)
        if expected is not None:
            assert v == pytest.approx(expected, abs=2e-3), f"{comment}: r={r} → expected {expected}, got {v}"
        else:
            # overshoot 段, 仅验证范围
            assert 0.9 < v <= 1.0, f"{comment}: r={r} should be in overshoot range, got {v}"
            if r >= 1.5:
                assert v > 0.99, f"{comment}: r={r} should be very close to 1.0, got {v}"

    def test_bin_0_value(self):
        """v2.3 bin 0 中点 r=0.05, 段 1: D = 0.2 + 0.2*0.05 = 0.21"""
        v = target_curve_vector()
        assert v[0] == pytest.approx(0.21, abs=1e-4)

    def test_bin_5_value(self):
        """v2.3 bin 5 中点 r=0.55, mid 段 slope = (0.5-0.3)/(0.7-0.5) = 1.0
        D = 0.3 + 1.0 * (0.55 - 0.5) = 0.35"""
        v = target_curve_vector()
        assert v[5] == pytest.approx(0.35, abs=1e-3)

    def test_bin_last_close_to_cap(self):
        """v2.3 最后 bin r=1.95, 应非常接近 D_CAP=1.0"""
        v = target_curve_vector()
        assert v[-1] > 0.999
