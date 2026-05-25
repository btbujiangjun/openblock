"""5 项 loss 单元测试。

验证:
  1. 单项 loss 数学正确性
  2. 综合 loss 加权正确
  3. smooth loss 在 requires_grad 时才生效
  4. balance loss 对单 PB bin 输入返回 0
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest
import torch

from rl_pytorch.spawn_tuning_v2.losses import (
    LossWeights, LossBreakdown,
    loss_shape, loss_balance, loss_surprise, loss_breaking, loss_smooth, loss_aux,
    compute_total_loss,
    TARGET_SURPRISE_RATE, SURPRISE_RATE_THRESHOLD,
    N_CURVE_BINS,
)


# ─────────── 单项 ───────────

class TestLossShape:
    def test_perfect_prediction(self):
        target = torch.tensor([[0.2, 0.5, 0.8]])
        pred = target.clone()
        assert loss_shape(pred, target).item() == pytest.approx(0.0)

    def test_constant_offset(self):
        target = torch.tensor([[0.0, 0.0, 0.0]])
        pred = torch.tensor([[0.5, 0.5, 0.5]])
        # MSE = 0.25
        assert loss_shape(pred, target).item() == pytest.approx(0.25)


class TestLossBalance:
    def test_single_bin_zero(self):
        """所有样本同一 PB bin → balance 必然 0。"""
        curve = torch.rand(8, N_CURVE_BINS)
        pb = torch.zeros(8, dtype=torch.long)
        assert loss_balance(curve, pb).item() == pytest.approx(0.0)

    def test_uniform_curves_low_balance(self):
        """所有 bin 的 curve 均值都一样 → balance 应为 0。"""
        curve = torch.full((10, N_CURVE_BINS), 0.5)
        pb = torch.tensor([0, 1, 2, 3, 4, 0, 1, 2, 3, 4])
        assert loss_balance(curve, pb).item() < 1e-6

    def test_imbalanced_curves(self):
        """某 PB bin 平均显著高于其他 → balance 应较大。"""
        curve = torch.zeros(10, N_CURVE_BINS)
        # bin 0 的样本曲线均值是 0, bin 4 的样本曲线均值是 0.8
        curve[5:] = 0.8
        pb = torch.tensor([0, 0, 0, 0, 0, 4, 4, 4, 4, 4])
        assert loss_balance(curve, pb).item() > 0.1


class TestLossSurprise:
    def test_low_curve_high_surprise(self):
        """全部 curve 低于阈值 → 惊喜率接近 100%, 偏离目标。"""
        curve = torch.zeros(4, N_CURVE_BINS)
        # observed_rate 接近 1, target=0.07 → diff² ≈ 0.86
        loss_val = loss_surprise(curve).item()
        assert loss_val > 0.5

    def test_high_curve_no_surprise(self):
        """全部 curve 远高于阈值 → 惊喜率 ≈ 0, 偏离目标 0.07。"""
        curve = torch.full((4, N_CURVE_BINS), 0.9)
        loss_val = loss_surprise(curve).item()
        # observed ≈ 0, diff² ≈ 0.005
        assert loss_val < 0.02

    def test_target_rate_matches(self):
        """大约 7% 的 bin 低于阈值时, loss 应较小。"""
        torch.manual_seed(0)
        curve = torch.full((100, N_CURVE_BINS), 0.5)
        # 在每行随机选 ~7% bin 设为低值
        n_low = max(1, int(N_CURVE_BINS * TARGET_SURPRISE_RATE))
        for i in range(100):
            idxs = torch.randperm(N_CURVE_BINS)[:n_low]
            curve[i, idxs] = 0.1
        loss_val = loss_surprise(curve).item()
        assert loss_val < 0.05


class TestLossBreaking:
    def test_no_breaking_violation(self):
        """超越后难度 ≥ 临近,符合业务 → loss ≈ 0。"""
        curve = torch.zeros(4, N_CURVE_BINS)
        curve[:, :13] = 0.5  # r < 0.97
        curve[:, 13:14] = 0.6  # r ≈ 1.0 临界
        curve[:, 14:] = 0.9  # r > 1, 加压
        assert loss_breaking(curve).item() < 0.01

    def test_breaking_violation(self):
        """超越后反而变简单 → loss > 0。"""
        curve = torch.zeros(4, N_CURVE_BINS)
        curve[:, :13] = 0.9   # 临近 PB 很难
        curve[:, 14:] = 0.2   # 超越后反而简单 (违背)
        assert loss_breaking(curve).item() > 0.1


class TestLossSmooth:
    def test_no_grad_returns_zero(self):
        curve = torch.rand(4, N_CURVE_BINS)
        theta = torch.rand(4, 14)  # no requires_grad
        assert loss_smooth(curve, theta).item() == 0.0

    def test_smooth_with_grad(self):
        """θ.requires_grad=True 时应能算梯度并返回标量。"""
        theta = torch.rand(4, 14, requires_grad=True)
        # 用一个能反传到 theta 的简单 forward
        w = torch.rand(14, N_CURVE_BINS)
        curve = torch.sigmoid(theta @ w)  # (4, N_CURVE_BINS)
        out = loss_smooth(curve, theta)
        assert out.dim() == 0  # scalar
        assert out.item() >= 0


class TestLossAux:
    def test_all_correct(self):
        b = 4
        preds = {
            "pb_broke": torch.tensor([0.95, 0.05, 0.95, 0.05]),
            "noMove": torch.tensor([0.5, 0.5, 0.5, 0.5]),
            "score": torch.tensor([1.0, 2.0, 3.0, 4.0]),
            "survival": torch.tensor([0.99, 0.01, 0.99, 0.01]),
        }
        tgts = {
            "pb_broke": torch.tensor([1.0, 0.0, 1.0, 0.0]),
            "noMove": torch.tensor([0.5, 0.5, 0.5, 0.5]),
            "score": torch.tensor([1.0, 2.0, 3.0, 4.0]),
            "survival": torch.tensor([1.0, 0.0, 1.0, 0.0]),
        }
        # 预测都接近真实, loss 应较小
        l = loss_aux(preds, tgts).item()
        assert l < 0.1

    def test_missing_keys_ok(self):
        """部分 head 缺失时不应崩。"""
        preds = {"pb_broke": torch.tensor([0.5, 0.5])}
        tgts = {"pb_broke": torch.tensor([1.0, 0.0])}
        l = loss_aux(preds, tgts)
        assert torch.isfinite(l)


# ─────────── 综合 ───────────

class TestComputeTotal:
    def test_perfect_prediction_low_total(self):
        b = 4
        curve_target = torch.full((b, N_CURVE_BINS), 0.5)
        preds = {
            "curve": curve_target.clone(),
            "pb_broke": torch.tensor([0.9, 0.1, 0.9, 0.1]),
            "noMove": torch.tensor([0.0, 0.0, 0.0, 0.0]),
            "score": torch.tensor([1.0, 2.0, 3.0, 4.0]),
            "survival": torch.tensor([0.9, 0.1, 0.9, 0.1]),
        }
        tgts = {
            "curve": curve_target,
            "pb_broke": torch.tensor([1.0, 0.0, 1.0, 0.0]),
            "noMove": torch.tensor([0.0, 0.0, 0.0, 0.0]),
            "score": torch.tensor([1.0, 2.0, 3.0, 4.0]),
            "survival": torch.tensor([1.0, 0.0, 1.0, 0.0]),
        }
        pb_bin = torch.tensor([0, 1, 2, 3])
        breakdown = compute_total_loss(preds, tgts, pb_bin)
        assert breakdown.shape.item() == pytest.approx(0.0, abs=1e-6)
        assert breakdown.total.item() < 0.5

    def test_loss_weights_dict(self):
        w = LossWeights()
        d = w.to_dict()
        assert d["shape"] == 1.0
        assert d["aux"] == 0.2
        assert sum(d.values()) > 0

    def test_breakdown_to_dict(self):
        b = 4
        curve = torch.full((b, N_CURVE_BINS), 0.5)
        preds = {"curve": curve.clone(), "pb_broke": torch.tensor([0.5] * b)}
        tgts = {"curve": curve, "pb_broke": torch.tensor([0.5] * b)}
        bd = compute_total_loss(preds, tgts, torch.tensor([0, 1, 2, 3]))
        d = bd.to_dict()
        for k in ["total", "shape", "balance", "surprise", "breaking", "smooth", "aux"]:
            assert k in d
            assert isinstance(d[k], float)
