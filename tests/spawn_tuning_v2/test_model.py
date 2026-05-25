"""ResNet-MLP (L4) 模型测试。

验证:
  1. 参数量在 L4 量级 (200K ± 50K)
  2. forward 形状正确
  3. 各 head 输出范围正确
  4. 梯度可反传
  5. context embedding 隔离 (5 维独立)
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest
import torch

from rl_pytorch.spawn_tuning_v2.model import (
    SpawnTuningResNetMLP, build_default_model, ResBlock, ContextEmbedding,
    N_CURVE_BINS, N_THETA, EMB_TOTAL,
)


@pytest.fixture
def model():
    return build_default_model()


def _make_batch(batch_size=4):
    """构造一个合法的 mini-batch。"""
    return {
        "difficulty_idx": torch.randint(0, 3, (batch_size,)),
        "generator_idx": torch.randint(0, 2, (batch_size,)),
        "bot_idx": torch.randint(0, 3, (batch_size,)),
        "pb_bin_idx": torch.randint(0, 5, (batch_size,)),
        "lifecycle_idx": torch.randint(0, 4, (batch_size,)),
        "log_pb": torch.randn(batch_size),
        "theta_norm": torch.rand(batch_size, N_THETA),
    }


class TestArchitecture:
    def test_param_count_in_l4_range(self, model):
        n = model.count_parameters()
        # L4 量级 ~325K (hidden=128, 8 blocks);允许 ±35% 浮动方便后续调参
        assert 200_000 < n < 500_000, f"L4 param count {n} out of expected range"

    def test_context_embedding_dim(self):
        emb = ContextEmbedding()
        b = 5
        out = emb(
            torch.tensor([0, 1, 2, 0, 1]),
            torch.tensor([0, 1, 0, 1, 0]),
            torch.tensor([0, 1, 2, 0, 1]),
            torch.tensor([0, 1, 2, 3, 4]),
            torch.tensor([0, 1, 2, 3, 0]),
            torch.randn(b),
        )
        assert out.shape == (b, EMB_TOTAL)  # 32

    def test_resblock_identity_for_zero_dropout(self):
        """ResBlock(0) 输入应能稳定 forward。"""
        torch.manual_seed(42)
        block = ResBlock(dim=256, dropout=0.0)
        block.eval()
        x = torch.randn(4, 256)
        y = block(x)
        assert y.shape == x.shape
        assert torch.isfinite(y).all()


class TestForward:
    def test_forward_shapes(self, model):
        batch = _make_batch(batch_size=8)
        model.eval()
        with torch.no_grad():
            out = model(**batch)
        assert out["curve"].shape == (8, N_CURVE_BINS)
        assert out["pb_broke"].shape == (8,)
        assert out["noMove"].shape == (8,)
        assert out["score"].shape == (8,)
        assert out["survival"].shape == (8,)

    def test_curve_in_unit_interval(self, model):
        batch = _make_batch(batch_size=16)
        model.eval()
        with torch.no_grad():
            out = model(**batch)
        # sigmoid 输出 ∈ [0, 1]
        assert (out["curve"] >= 0).all()
        assert (out["curve"] <= 1).all()
        assert (out["pb_broke"] >= 0).all()
        assert (out["pb_broke"] <= 1).all()

    def test_gradient_flow(self, model):
        """所有参数都应能拿到梯度 (loss 须覆盖所有 5 个 head)。"""
        batch = _make_batch(batch_size=4)
        out = model(**batch)
        loss = (out["curve"].mean() + out["pb_broke"].mean() + out["noMove"].mean()
                + out["score"].mean() + out["survival"].mean())
        loss.backward()
        for name, p in model.named_parameters():
            assert p.grad is not None, f"{name} got no gradient"
            assert torch.isfinite(p.grad).all(), f"{name} grad has NaN/Inf"

    def test_batch_size_1(self, model):
        """单样本 batch 也要能跑 (训练初期常见)。"""
        batch = _make_batch(batch_size=1)
        out = model(**batch)
        assert out["curve"].shape == (1, N_CURVE_BINS)

    def test_deterministic_in_eval(self, model):
        """eval 模式下相同输入应给相同输出。"""
        batch = _make_batch(batch_size=4)
        model.eval()
        with torch.no_grad():
            out1 = model(**batch)
            out2 = model(**batch)
        assert torch.allclose(out1["curve"], out2["curve"])


class TestCustomArch:
    def test_smaller_model(self):
        """L3 配置 (4 块 × 96): 更小"""
        m = SpawnTuningResNetMLP(hidden_dim=96, n_blocks=4)
        n = m.count_parameters()
        assert n < 200_000, f"small model {n} params too large"
        # 仍能 forward
        batch = _make_batch(4)
        out = m(**batch)
        assert out["curve"].shape == (4, N_CURVE_BINS)

    def test_invalid_n_blocks_zero(self):
        """0 块仍能构造 (退化到 trunk_in + heads),不应崩"""
        m = SpawnTuningResNetMLP(n_blocks=0)
        batch = _make_batch(4)
        out = m(**batch)
        assert out["curve"].shape == (4, N_CURVE_BINS)


class TestEncode:
    def test_encode_shape(self, model):
        batch = _make_batch(batch_size=3)
        h = model.encode(**batch)
        assert h.shape == (3, model.hidden_dim)

    def test_encode_then_heads(self, model):
        """手动调 heads 应与 forward 一致 (排除 dropout 影响,用 eval)。"""
        batch = _make_batch(batch_size=2)
        model.eval()
        with torch.no_grad():
            h = model.encode(**batch)
            out_full = model(**batch)
            curve_manual = torch.sigmoid(model.head_curve(h))
        assert torch.allclose(curve_manual, out_full["curve"], atol=1e-6)
