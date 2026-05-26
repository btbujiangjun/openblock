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
    loss_pb_distribution, loss_anchor, p_reach_metrics,
    loss_monotonic, loss_target_fit,
    loss_endpoint,  # v2.9.1
    compute_total_loss,
    TARGET_SURPRISE_RATE, SURPRISE_RATE_THRESHOLD,
    TARGET_REACH_PROBABILITIES, PB_DIST_GAMMA, ANCHOR_CONSTRAINTS,
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


class TestLossPbDistribution:
    """v2.4: 得分-PB 关系 — 累积到达概率拟合到业务期望分布。"""

    def test_calibrated_curve_low_loss(self):
        """构造一条接近业务目标分布的 d_curve, loss 应较小。

        计算逻辑 (gamma=2):
          P_continue(bin) = (1-d)^2
          P_reach(bin)    = cumprod(P_continue)
        想要:
          bin 5 (r=0.55) P_reach ≈ 0.85 (target r=0.5: 0.85)
          bin 10 (r=1.05) P_reach ≈ 0.18 (target r=1.0: 0.18)

        前 5 bin d=0.01 → P_cont=0.9801 → P_reach(5)=0.904 (≈ 0.85, 接近)
        bin 5-9 d=0.135 → P_cont=0.748 → P_reach(10)=0.904 × 0.748^5 ≈ 0.213 (≈ 0.18, 接近)
        bin 10-19 d=0.6 → P_cont=0.16 → P_reach(15) ≈ 0.0002 (远低 target 0.01, 略高 loss)
        """
        curve = torch.tensor([[
            0.01, 0.01, 0.01, 0.01, 0.01,    # r 0~0.5: 几乎无压
            0.135, 0.135, 0.135, 0.135, 0.135,  # r 0.5~1.0: 中度
            0.60, 0.60, 0.60, 0.60, 0.60,    # r 1.0~1.5: 高压
            0.95, 0.95, 0.95, 0.95, 0.95,    # r 1.5~2.0: 极难
        ]] * 2, dtype=torch.float32)
        loss_val = loss_pb_distribution(curve).item()
        # 接近业务目标的 d_curve → loss 应明显小于极端情况 (0.05 以下足够好)
        assert loss_val < 0.05, f"calibrated curve should give low loss, got {loss_val}"

    def test_too_easy_curve_high_loss(self):
        """全部 d=0.001 (几乎无难度) → P_reach 处处接近 1, 远超 target (尤其 r=1.5 target 1%) → loss 高。"""
        curve = torch.full((4, N_CURVE_BINS), 0.001)
        loss_val = loss_pb_distribution(curve).item()
        # 主要偏差: P(reach 1.5) ≈ 0.999 vs target 0.01 → diff² ≈ 0.98
        #          P(reach 1.0) ≈ 0.999 vs target 0.18 → diff² ≈ 0.67 等
        # 平均 mse 应 > 0.3
        assert loss_val > 0.3, f"too-easy curve should give high loss, got {loss_val}"

    def test_too_hard_curve_high_loss(self):
        """全部 d=0.95 → P_reach 处处接近 0, 远低于 target → loss 高 (主要是 r=0.5: target 85%)。"""
        curve = torch.full((4, N_CURVE_BINS), 0.95)
        loss_val = loss_pb_distribution(curve).item()
        # P_reach(0.5) ≈ 0.95^(2*5) = (0.0025)^5 ≈ 0 vs target 0.85 → diff² ≈ 0.72
        assert loss_val > 0.1, f"too-hard curve should give high loss, got {loss_val}"

    def test_empty_batch_returns_zero(self):
        curve = torch.zeros(0, N_CURVE_BINS)
        assert loss_pb_distribution(curve).item() == pytest.approx(0.0)

    def test_target_dict_used(self):
        """传自定义 target_dict 时应改变结果。"""
        curve = torch.full((4, N_CURVE_BINS), 0.5)
        default = loss_pb_distribution(curve).item()
        # 0.99 是个极端 target — 想要 99% 玩家破 PB, 但 d=0.5 让 P_reach 较低 → loss 大
        custom = loss_pb_distribution(curve, target_dict={1.0: 0.99}).item()
        assert custom > default + 0.1


class TestLossAnchor:
    """v2.6: 关键 r 点 hinge 约束。"""

    def test_satisfied_constraints_zero_loss(self):
        """构造一条满足全部 v2.7 anchor 约束的曲线 → loss = 0。

        ANCHOR_CONSTRAINTS (v2.7):
          r=0.20 D ≤ 0.32 (bin 2)   r=0.95 D ≥ 0.55 (bin 9)
          r=0.30 D ≤ 0.38 (bin 3)   r=1.00 D ≥ 0.65 (bin 10)
          r=0.50 D ≤ 0.48 (bin 5)   r=1.20 D ≥ 0.75 (bin 12)
                                    r=1.50 D ≥ 0.85 (bin 15)
        """
        curve = torch.tensor([[
            0.20, 0.25, 0.30, 0.35, 0.40,  # bin 0-4   (r=0.2 D=0.30 ≤ 0.32 ✓, r=0.3 D=0.35 ≤ 0.38 ✓)
            0.45, 0.50, 0.55, 0.60, 0.65,  # bin 5-9   (r=0.5 D=0.45 ≤ 0.48 ✓, r=0.95 D=0.65 ≥ 0.55 ✓)
            0.72, 0.78, 0.82, 0.85, 0.88,  # bin 10-14 (r=1.0 D=0.72 ≥ 0.65 ✓, r=1.2 D=0.82 ≥ 0.75 ✓)
            0.92, 0.95, 0.97, 0.98, 0.99,  # bin 15-19 (r=1.5 D=0.92 ≥ 0.85 ✓)
        ]] * 2, dtype=torch.float32)
        loss_val = loss_anchor(curve).item()
        assert loss_val == pytest.approx(0.0, abs=1e-9)

    def test_flat_curve_high_loss(self):
        """水平于 0.5 → 同时违反多个约束 → loss 显著 (v2.7 per-sample 实现)。"""
        curve = torch.full((4, N_CURVE_BINS), 0.5)
        loss_val = loss_anchor(curve).item()
        # 违规:
        #   r=0.20 D=0.5 vs upper 0.32 → 0.18² = 0.0324
        #   r=0.30 D=0.5 vs upper 0.38 → 0.12² = 0.0144
        #   r=0.50 D=0.5 vs upper 0.48 → 0.02² = 0.0004
        #   r=0.95 D=0.5 vs lower 0.55 → 0.05² = 0.0025
        #   r=1.00 D=0.5 vs lower 0.65 → 0.15² = 0.0225
        #   r=1.20 D=0.5 vs lower 0.75 → 0.25² = 0.0625
        #   r=1.50 D=0.5 vs lower 0.85 → 0.35² = 0.1225
        # 均值 ≈ 0.0510
        assert loss_val > 0.03

    def test_flat_at_06_still_high(self):
        """水平于 0.6 → 仍违反多个约束 (v2.7 per-sample 信号变强)。"""
        curve = torch.full((4, N_CURVE_BINS), 0.6)
        loss_val = loss_anchor(curve).item()
        # 主要违规: r=0.2 / 0.3 / 0.5 上界, r=1.2 / 1.5 下界
        assert loss_val > 0.02

    def test_upper_violation(self):
        """全部 D=0.5 时 r=0.3 也违反上界 (v2.7: ≤ 0.38)。"""
        curve = torch.full((4, N_CURVE_BINS), 0.5)
        loss_val = loss_anchor(curve).item()
        assert loss_val > 0

    def test_v27_per_sample_signal(self):
        """v2.7 关键修复: per-sample hinge — 不会因 batch 内均值"碰巧"满足而丢信号。

        构造 4 样本 batch: 在 r=1.0 处一半样本 D=0.3 (远低 lower 0.65),
        另一半 D=1.0 (远超). batch 均值 = 0.65 刚好满足.
        v2.6 (有 bug): batch_mean(0.65) - 0.65 = 0 → loss=0 (丢失信号)
        v2.7 (修复): 一半样本贡献 ReLU(0.65-0.3)²=0.1225, 另一半 0 → mean=0.06125 (强信号)
        """
        n_bins = N_CURVE_BINS
        curve = torch.zeros(4, n_bins)
        # 全部 bin 都满足其他约束 — 重点测 r=1.0 (bin 10)
        curve[:, :] = 0.7  # 默认满足绝大多数 lower 约束
        curve[:, :3] = 0.30  # 满足 r=0.2/0.3 upper
        curve[:, 5] = 0.45   # 满足 r=0.5 upper
        # r=1.0 (bin 10) — 一半样本 0.3, 一半 1.0 → batch_mean=0.65 刚满足
        curve[0:2, 10] = 0.30
        curve[2:4, 10] = 1.00
        # batch mean = 0.65 = lower 阈值
        loss_val = loss_anchor(curve).item()
        # v2.7 应该捕获到一半样本的违规
        assert loss_val > 0.005, f"v2.7 per-sample 应捕获 batch-mean 满足但 per-sample 违规的情况, got {loss_val}"

    def test_empty_batch_returns_zero(self):
        assert loss_anchor(torch.zeros(0, N_CURVE_BINS)).item() == pytest.approx(0.0)

    def test_custom_constraints(self):
        """传自定义 constraints → 影响 loss 值。"""
        curve = torch.full((4, N_CURVE_BINS), 0.5)
        # 自定义: r=1.0 D ≥ 0.99 — 比默认更严苛 → 更大 loss
        custom = loss_anchor(curve, constraints=[(1.0, "lower", 0.99)]).item()
        assert custom > 0.2  # ReLU(0.99-0.5)²=0.2401


class TestLossMonotonic:
    """v2.9.1: 软单调约束 — d_curve[i+1] ≥ d_curve[i] - tol (默认 tol=0.02)。"""

    def test_perfectly_monotonic_zero(self):
        """严格递增 → loss = 0。"""
        curve = torch.tensor([[i / 20 for i in range(N_CURVE_BINS)]] * 2, dtype=torch.float32)
        assert loss_monotonic(curve).item() == pytest.approx(0.0)

    def test_small_dip_within_tol(self):
        """微小倒退 (< tol=0.02) 不惩罚 — 数值噪声容忍。"""
        curve = torch.tensor([[
            0.10, 0.15, 0.20, 0.19, 0.22, 0.27, 0.32, 0.31, 0.35, 0.40,  # 0.01 倒退 < 0.02
            0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90,
        ]] * 2, dtype=torch.float32)
        loss_val = loss_monotonic(curve).item()
        assert loss_val == pytest.approx(0.0, abs=1e-6)

    def test_large_violation_high_loss(self):
        """显著倒退 (> tol) → loss 显著。"""
        curve = torch.tensor([[
            0.10, 0.20, 0.30, 0.05,  # bin 3: 0.30 → 0.05 倒退 0.25
            0.10, 0.15, 0.20, 0.25, 0.30, 0.35,
            0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75, 0.80, 0.85,
        ]] * 2, dtype=torch.float32)
        loss_val = loss_monotonic(curve).item()
        # bin 2→3 violation = (0.30-0.05) - 0.02 = 0.23, 0.23² ≈ 0.0529
        assert loss_val > 0.001

    def test_moderate_dip_now_penalized(self):
        """v2.9.1 收紧 — 0.03 倒退之前 (tol=0.05) 不惩罚, 现在 (tol=0.02) 惩罚。"""
        curve = torch.tensor([[
            0.10, 0.15, 0.20, 0.17, 0.22, 0.27, 0.32, 0.37, 0.42, 0.47,  # bin 2→3 倒退 0.03 > 0.02
            0.52, 0.57, 0.62, 0.67, 0.72, 0.77, 0.82, 0.87, 0.92, 0.97,
        ]] * 2, dtype=torch.float32)
        loss_val = loss_monotonic(curve).item()
        # violation = 0.03 - 0.02 = 0.01, 0.01² = 1e-4 / 19 ≈ 5e-6
        assert loss_val > 1e-7
        # 老 tol=0.05 时该样本是 0 loss
        loss_old = loss_monotonic(curve, tol=0.05).item()
        assert loss_old == pytest.approx(0.0, abs=1e-9)

    def test_empty_or_single_bin(self):
        assert loss_monotonic(torch.zeros(0, N_CURVE_BINS)).item() == pytest.approx(0.0)
        assert loss_monotonic(torch.zeros(2, 1)).item() == pytest.approx(0.0)


class TestLossTargetFit:
    """v2.9: 校准 target 拟合 — 让模型学到温和 S 形 (而非全集均值)。"""

    def test_zero_when_matches_calibrated(self):
        """预测 == 校准 target → loss = 0。"""
        from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_calibrated_vector
        target = torch.tensor(target_curve_calibrated_vector(), dtype=torch.float32)
        curve = target.unsqueeze(0).expand(4, -1).contiguous()
        assert loss_target_fit(curve).item() == pytest.approx(0.0, abs=1e-9)

    def test_flat_curve_high_loss(self):
        """预测水平于 0.6 → 跟校准 target 的 S 形仍有差距 → loss > 0。"""
        curve = torch.full((4, N_CURVE_BINS), 0.6)
        loss_val = loss_target_fit(curve).item()
        # 校准 target: D_BASE=0.42 → D_CAP=0.85, 跟 0.6 平均差距 ~ 0.1, MSE ~ 0.02
        assert 0.005 < loss_val < 0.05

    def test_empty_returns_zero(self):
        assert loss_target_fit(torch.zeros(0, N_CURVE_BINS)).item() == pytest.approx(0.0)


class TestLossEndpoint:
    """v2.9.1: 端点锚定 — 防止 r=0/r=R_MAX 处 d_curve 甩飞。"""

    def test_zero_when_endpoints_match(self):
        """前 2 bin 均值 ≈ 0.42, 后 2 bin 均值 ≈ 0.85 → 0 loss。"""
        curve = torch.full((4, N_CURVE_BINS), 0.6)
        curve[:, :2] = 0.42
        curve[:, -2:] = 0.85
        assert loss_endpoint(curve).item() == pytest.approx(0.0, abs=1e-6)

    def test_head_far_from_target(self):
        """头 bin 均值 = 0.30 → 偏离 head_target=0.42 共 0.12, 超出 tol=0.10
        ⇒ violation = 0.02 → loss > 0。"""
        curve = torch.full((4, N_CURVE_BINS), 0.6)
        curve[:, :2] = 0.30
        curve[:, -2:] = 0.85
        loss_val = loss_endpoint(curve).item()
        assert loss_val > 1e-5  # 0.02^2 / 2 ≈ 2e-4

    def test_tail_far_from_target(self):
        """尾 bin 均值 = 0.55 → 偏离 tail_target=0.85 共 0.30, 超 tol → loss 大。"""
        curve = torch.full((4, N_CURVE_BINS), 0.6)
        curve[:, :2] = 0.42
        curve[:, -2:] = 0.55
        loss_val = loss_endpoint(curve).item()
        # violation = 0.20, mean(0.2^2)/2 = 0.02
        assert loss_val > 0.01

    def test_within_tolerance_zero(self):
        """偏离 < tol 不惩罚。"""
        curve = torch.full((4, N_CURVE_BINS), 0.6)
        curve[:, :2] = 0.45  # 偏离 0.42 共 0.03 < tol=0.10
        curve[:, -2:] = 0.80  # 偏离 0.85 共 0.05 < tol=0.10
        assert loss_endpoint(curve).item() == pytest.approx(0.0, abs=1e-6)

    def test_empty_returns_zero(self):
        assert loss_endpoint(torch.zeros(0, N_CURVE_BINS)).item() == pytest.approx(0.0)


class TestPReachMetrics:
    """v2.5: P_reach 业务指标 (供训练日志读 — 不计入 loss)。"""

    def test_easy_curve_high_reach(self):
        """d=0.01 几乎无难度 → P_reach 都偏高 (但仍 < 1 因为累积乘积衰减)。

        实际数值 (d=0.01, gamma=2, p_cont=0.9801):
          P_reach(r=0.5)  ≈ 0.886
          P_reach(r=1.0)  ≈ 0.802
          P_reach(r=1.5)  ≈ 0.725
        """
        curve = torch.full((4, N_CURVE_BINS), 0.01)
        m = p_reach_metrics(curve)
        assert m["reach_50"] > 0.85
        assert m["reach_100"] > 0.75
        assert m["reach_150"] > 0.65

    def test_hard_curve_low_reach(self):
        """d=0.95 高压 → P_reach 接近 0。"""
        curve = torch.full((4, N_CURVE_BINS), 0.95)
        m = p_reach_metrics(curve)
        # d=0.95, p_cont=(1-0.95)^2=0.0025 → P_reach 在 bin 5 ≈ 0.0025^6 ≈ 0
        assert m["reach_50"] < 0.01
        assert m["reach_100"] < 1e-6
        assert m["reach_150"] < 1e-10

    def test_empty_batch_returns_empty(self):
        m = p_reach_metrics(torch.zeros(0, N_CURVE_BINS))
        assert m == {}

    def test_all_keys_present(self):
        """6 个 r 关键点都应出现。"""
        curve = torch.full((2, N_CURVE_BINS), 0.3)
        m = p_reach_metrics(curve)
        for k in ["reach_50", "reach_80", "reach_95", "reach_100", "reach_120", "reach_150"]:
            assert k in m
            assert 0.0 <= m[k] <= 1.0

    def test_monotonic_decrease(self):
        """P_reach 严格随 r 递减 (累积乘积特性)。"""
        curve = torch.full((2, N_CURVE_BINS), 0.2)
        m = p_reach_metrics(curve)
        assert m["reach_50"] >= m["reach_80"] >= m["reach_95"] >= m["reach_100"]
        assert m["reach_100"] >= m["reach_120"] >= m["reach_150"]





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
        """v2.10.2: target_fit 1.0 → 1.8 (强化 calibrated 拟合)。"""
        w = LossWeights()
        d = w.to_dict()
        assert d["shape"] == 2.0
        assert d["balance"] == 0.15
        assert d["smooth"] == 0.04
        assert d["pb_distribution"] == 0.0
        assert d["anchor"] == 3.0
        assert d["monotonic"] == 2.5
        assert d["target_fit"] == 1.8        # v2.10.2: 1.0 → 1.8
        assert d["endpoint"] == 1.5
        assert d["aux"] == 0.2
        assert sum(d.values()) > 0

    def test_breakdown_to_dict(self):
        b = 4
        curve = torch.full((b, N_CURVE_BINS), 0.5)
        preds = {"curve": curve.clone(), "pb_broke": torch.tensor([0.5] * b)}
        tgts = {"curve": curve, "pb_broke": torch.tensor([0.5] * b)}
        bd = compute_total_loss(preds, tgts, torch.tensor([0, 1, 2, 3]))
        d = bd.to_dict()
        for k in ["total", "shape", "balance", "surprise", "breaking", "smooth", "aux",
                  "pb_distribution", "anchor", "monotonic", "target_fit", "endpoint"]:
            assert k in d
            assert isinstance(d[k], float)

    def test_v24_pb_distribution_in_weights(self):
        """v2.4 引入 pb_distribution; v2.8.1 关闭 (公式天然饱和无 gradient)。"""
        w = LossWeights()
        d = w.to_dict()
        assert "pb_distribution" in d
        assert d["pb_distribution"] == 0.0

    def test_v281_pb_distribution_computed_but_not_in_backward(self):
        """v2.8.1: pb_distribution 默认 weight=0, 仍计算 (供日志/UI 显示), 但不进 backward。"""
        b = 4
        curve_flat = torch.full((b, N_CURVE_BINS), 0.5)
        preds = {"curve": curve_flat, "pb_broke": torch.tensor([0.5] * b)}
        tgts = {"curve": curve_flat.clone(), "pb_broke": torch.tensor([0.5] * b)}
        pb = torch.tensor([0, 1, 2, 3])
        bd_default = compute_total_loss(preds, tgts, pb)
        # 仍计算 (非零, 供 UI 显示)
        assert bd_default.pb_distribution.item() > 0.0
        # 但默认 weight=0, 跟 weight 显式设为 0 完全等价
        w_explicit_off = LossWeights(pb_distribution=0.0)
        bd_off = compute_total_loss(preds, tgts, pb, weights=w_explicit_off)
        assert bd_default.total.item() == pytest.approx(bd_off.total.item(), abs=1e-6)
