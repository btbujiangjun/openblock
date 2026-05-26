"""v2.10.7: policy_utils 单元测试 — PAVA 单调投影 + 端点 clip。"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest

from rl_pytorch.spawn_tuning_v2.policy_utils import (
    isotonic_regression_pava,
    monotonic_project_curve,
    max_monotonic_violation,
)


class TestIsotonicPAVA:
    def test_already_monotonic_no_change(self):
        x = [0.1, 0.3, 0.5, 0.7, 0.9]
        y = isotonic_regression_pava(x)
        for a, b in zip(x, y):
            assert abs(a - b) < 1e-9

    def test_single_violation_averaged(self):
        # 0.5 > 0.4 违规, 应平均为 0.45
        x = [0.1, 0.3, 0.5, 0.4, 0.7]
        y = isotonic_regression_pava(x)
        assert y[0] == pytest.approx(0.1)
        assert y[1] == pytest.approx(0.3)
        assert y[2] == pytest.approx(0.45)
        assert y[3] == pytest.approx(0.45)
        assert y[4] == pytest.approx(0.7)

    def test_multiple_violations_cascade(self):
        # 全降序 → 平均到 0.3
        x = [0.5, 0.4, 0.3, 0.2, 0.1]
        y = isotonic_regression_pava(x)
        # 应该全相等 = 0.3
        for v in y:
            assert v == pytest.approx(0.3)

    def test_output_strictly_monotonic_non_decreasing(self):
        x = [0.2, 0.5, 0.3, 0.6, 0.4, 0.7, 0.5]
        y = isotonic_regression_pava(x)
        for i in range(1, len(y)):
            assert y[i] >= y[i - 1] - 1e-9, f"violates monotonicity at {i}: {y}"

    def test_empty_returns_empty(self):
        assert isotonic_regression_pava([]) == []

    def test_singleton(self):
        assert isotonic_regression_pava([0.5]) == [0.5]


class TestMonotonicProjectCurve:
    def test_d_curve_typical_use(self):
        """实例: model #21 在 r=1.4 处局部下降 0.07。"""
        curve = [0.30, 0.32, 0.35, 0.38, 0.42, 0.46, 0.50, 0.54, 0.58, 0.62,
                 0.66, 0.71, 0.76, 0.80, 0.85, 0.92, 0.88, 0.90, 0.92, 0.92]
        # bin 15 (0.92) → bin 16 (0.88) 违规 0.04
        fixed, n_viol = monotonic_project_curve(curve)
        assert n_viol > 0
        # 修复后严格单调
        for i in range(1, len(fixed)):
            assert fixed[i] >= fixed[i - 1] - 1e-9

    def test_clip_to_range(self):
        curve = [-0.1, 0.5, 0.8, 1.5]
        fixed, _ = monotonic_project_curve(curve, clip_min=0.0, clip_max=1.0)
        for v in fixed:
            assert 0.0 <= v <= 1.0

    def test_already_perfect_no_violations(self):
        curve = [0.30, 0.35, 0.40, 0.50, 0.60, 0.70, 0.80, 0.90]
        fixed, n_viol = monotonic_project_curve(curve)
        assert n_viol == 0
        for a, b in zip(curve, fixed):
            assert abs(a - b) < 1e-9

    def test_violation_count(self):
        curve = [0.3, 0.5, 0.4, 0.7, 0.6, 0.9]  # 两处违规
        fixed, n_viol = monotonic_project_curve(curve)
        assert n_viol >= 2


class TestMaxViolation:
    def test_no_violation(self):
        assert max_monotonic_violation([0.1, 0.3, 0.5]) == 0.0

    def test_single_violation(self):
        # 0.5 → 0.3 倒退 0.2
        assert max_monotonic_violation([0.1, 0.5, 0.3, 0.7]) == pytest.approx(0.2)

    def test_largest_violation_returned(self):
        # 多处倒退, 取最大: 0.6 - 0.1 = 0.5
        assert max_monotonic_violation([0.6, 0.1, 0.4, 0.3]) == pytest.approx(0.5)

    def test_short_curve(self):
        assert max_monotonic_violation([]) == 0.0
        assert max_monotonic_violation([0.5]) == 0.0
