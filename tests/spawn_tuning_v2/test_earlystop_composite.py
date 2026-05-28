"""v3.0.4: EarlyStop composite 公式 — 以 ideal_mae 为主导 (业务核心指标).

业务背景
  v3.0.4 起 calibrated target 已彻底移除, composite 简化为:
    composite = ideal_mae + 0.3 * endpoint + 0.2 * anchor

  ideal_mae 是 ★ 业务核心指标 — model 预测跟 ideal target_S_curve 的 MAE,
  直接量化 "model 跟业务期望 S 曲线" 的距离, 取代历史 calibrated_mae。
"""
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest


def _composite(val_m):
    """v3.0.4 composite 公式 — 同 train.py 内, 单独提取供测试."""
    return (
        val_m.get("ideal_mae", 0.0)
        + 0.3 * val_m.get("endpoint", 0.0)
        + 0.2 * val_m.get("anchor", 0.0)
    )


class TestCompositeFormula:
    """v3.0.4 composite 公式: 3 项加权."""

    def test_zero_metrics(self):
        m = {"ideal_mae": 0, "endpoint": 0, "anchor": 0}
        assert _composite(m) == 0

    def test_only_ideal_mae(self):
        m = {"ideal_mae": 0.1}
        assert _composite(m) == pytest.approx(0.1)

    def test_endpoint_dominates_second(self):
        """endpoint=0.05 贡献 0.015, ideal_mae=0.07 贡献 0.07 → 总 0.085."""
        m = {"ideal_mae": 0.07, "endpoint": 0.05}
        assert _composite(m) == pytest.approx(0.085)

    def test_all_dimensions(self):
        m = {"ideal_mae": 0.05, "endpoint": 0.02, "anchor": 0.01}
        # 0.05 + 0.3*0.02 + 0.2*0.01 = 0.05 + 0.006 + 0.002 = 0.058
        assert _composite(m) == pytest.approx(0.058)


class TestCompositeImpactOnBestSelection:
    """验证 composite 让 best epoch 选择倾向 ideal_mae 更低的 epoch."""

    def test_ideal_break_tie(self):
        """ideal_mae 更低的 epoch 应当 composite 更低 → 被选中."""
        ep_a = {"ideal_mae": 0.060, "endpoint": 0.01, "anchor": 0.005}
        ep_b = {"ideal_mae": 0.045, "endpoint": 0.01, "anchor": 0.005}
        assert _composite(ep_b) < _composite(ep_a)

    def test_endpoint_weighted_below_ideal(self):
        """endpoint 权重 0.3 远小于 ideal_mae 主权重 — 一个 ideal 下降 0.01 抵掉 endpoint 涨 0.033."""
        ep_a = {"ideal_mae": 0.05, "endpoint": 0.02}
        ep_b = {"ideal_mae": 0.04, "endpoint": 0.05}    # ideal -0.01, endpoint +0.03
        # ep_a: 0.05 + 0.3*0.02 = 0.056
        # ep_b: 0.04 + 0.3*0.05 = 0.055 → ep_b 更优
        assert _composite(ep_b) < _composite(ep_a)
