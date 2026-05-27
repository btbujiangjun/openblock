"""v2.10.20 G20: EarlyStop composite 加 calibrated_mae 测试.

业务背景
  v2.9.4 原 composite = curve_mae + 0.5*anchor + 0.4*target_fit
  实测 (model #22): ep=4 后 10 epoch 不动, 但 calibrated_mae 仍在下降 —
  best 只看 curve_mae 错过 calibrated 更优解。

v2.10.20 修复后:
  composite = curve_mae + 0.5*anchor + 0.4*target_fit + 0.6*calibrated_mae
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest


def _composite_v2_10_20(val_m):
    """v2.10.20 composite 公式 — 同 train.py 内, 单独提取供测试."""
    return (
        val_m["curve_mae"]
        + 0.5 * val_m.get("anchor", 0.0)
        + 0.4 * val_m.get("target_fit", 0.0)
        + 0.6 * val_m.get("calibrated_mae", 0.0)
    )


class TestCompositeFormula:
    """v2.10.20 composite 公式: 4 项加权."""

    def test_zero_metrics(self):
        m = {"curve_mae": 0, "anchor": 0, "target_fit": 0, "calibrated_mae": 0}
        assert _composite_v2_10_20(m) == 0

    def test_only_curve_mae(self):
        m = {"curve_mae": 0.1}
        assert _composite_v2_10_20(m) == pytest.approx(0.1)

    def test_calibrated_mae_dominates(self):
        """calibrated_mae=0.05 时贡献 0.030, 让 composite 显著."""
        m = {"curve_mae": 0.07, "calibrated_mae": 0.05}
        # 0.07 + 0.6 * 0.05 = 0.10
        assert _composite_v2_10_20(m) == pytest.approx(0.10)

    def test_all_dimensions(self):
        m = {
            "curve_mae": 0.07,
            "anchor": 0.001,
            "target_fit": 0.003,
            "calibrated_mae": 0.045,
        }
        # 0.07 + 0.5*0.001 + 0.4*0.003 + 0.6*0.045
        # = 0.07 + 0.0005 + 0.0012 + 0.027
        # = 0.0987
        assert _composite_v2_10_20(m) == pytest.approx(0.0987)


class TestCompositeImpactOnBestSelection:
    """验证新 composite 会让 best epoch 选择倾向 calibrated 更低的 epoch."""

    def test_calibrated_break_tie(self):
        """两个 epoch curve_mae 相同, calibrated_mae 低的应当选中."""
        ep4 = {"curve_mae": 0.075, "anchor": 0.001, "target_fit": 0.003, "calibrated_mae": 0.060}
        ep10 = {"curve_mae": 0.075, "anchor": 0.001, "target_fit": 0.003, "calibrated_mae": 0.045}
        # ep10 calibrated 更低 → composite 更低 → 应选 ep10
        assert _composite_v2_10_20(ep10) < _composite_v2_10_20(ep4)

    def test_v294_vs_v21020_selection(self):
        """v2.9.4 公式选 ep4 (curve 低), v2.10.20 公式选 ep10 (calibrated 低).

        ep4:  curve=0.0675, calibrated=0.090
        ep10: curve=0.0780, calibrated=0.050   (curve 略高但 calibrated 大降)
        """
        ep4 = {"curve_mae": 0.0675, "calibrated_mae": 0.090}
        ep10 = {"curve_mae": 0.0780, "calibrated_mae": 0.050}
        # v2.9.4 公式 (无 calibrated): ep4 winner
        v294 = lambda m: m["curve_mae"]  # 简化
        assert v294(ep4) < v294(ep10)
        # v2.10.20 (含 calibrated 0.6): ep10 winner
        # ep4:  0.0675 + 0.6*0.090 = 0.1215
        # ep10: 0.0780 + 0.6*0.050 = 0.1080
        assert _composite_v2_10_20(ep10) < _composite_v2_10_20(ep4)
