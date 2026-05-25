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


# 与 JS 测试相同的"参考点", 修改时必须 JS / Python 同步
REFERENCE_POINTS = [
    # (r, expected_D, comment)
    (0.0,    0.20,   "origin = D_BASE"),
    (0.5,    0.30,   "gentle_end = D_GENTLE_END"),
    (0.95,   0.50,   "mid_end = D_MID_END (smoothstep start)"),
    (0.975,  0.70,   "brake mid (smoothstep t=0.5)"),
    (1.0,    0.90,   "brake_end = D_BRAKE_END (smoothstep t=1)"),
    (1.5,    None,   "overshoot end, close to D_CAP=1.0"),
]


class TestCrossLangReferenceValues:
    """与 JS targetSCurve.test.js 严格对应的固定参考值。"""

    @pytest.mark.parametrize("r,expected,comment", REFERENCE_POINTS)
    def test_point(self, r, expected, comment):
        v = target_S_curve(r)
        if expected is not None:
            assert v == pytest.approx(expected, abs=1e-9), f"{comment}: r={r} → expected {expected}, got {v}"
        else:
            # overshoot 段, 仅验证范围
            assert 0.9 < v < 1.0, f"{comment}: r={r} should be in overshoot range, got {v}"

    def test_bin_0_value(self):
        """bin 0 中点 r=0.0375, 段 1: D = 0.2 + 0.2*0.0375 = 0.2075"""
        v = target_curve_vector()
        assert v[0] == pytest.approx(0.2075, abs=1e-4)

    def test_bin_5_value(self):
        """bin 5 中点 r=0.4125, 段 1: D = 0.2 + 0.2*0.4125 = 0.2825"""
        v = target_curve_vector()
        assert v[5] == pytest.approx(0.2825, abs=1e-4)

    def test_bin_7_value(self):
        """bin 7 中点 r=0.5625, 段 2: D = 0.3 + 0.4444*(0.5625-0.5) = 0.3278"""
        v = target_curve_vector()
        assert v[7] == pytest.approx(0.3278, abs=1e-3)
