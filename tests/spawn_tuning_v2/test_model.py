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
    SpawnTuningResNetMLP, SpawnTuningTransformer,
    build_default_model, build_model,
    ResBlock, ContextEmbedding,
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


class TestBuildModel:
    """v2.9: build_model 工厂 — 支持 resnet / transformer。"""

    def test_build_resnet(self):
        m = build_model("resnet")
        assert isinstance(m, SpawnTuningResNetMLP)

    def test_build_resnet_aliases(self):
        for alias in ["mlp", "resnet-mlp", "RESNET"]:
            m = build_model(alias)
            assert isinstance(m, SpawnTuningResNetMLP)

    def test_build_transformer(self):
        m = build_model("transformer")
        assert isinstance(m, SpawnTuningTransformer)

    def test_build_invalid_raises(self):
        with pytest.raises(ValueError):
            build_model("unknown_arch")


class TestTransformer:
    """v2.9: Transformer 模型 forward / 输出 shape。"""

    def test_forward_shapes(self):
        m = SpawnTuningTransformer()
        m.eval()
        batch = _make_batch(batch_size=4)
        with torch.no_grad():
            out = m(**batch)
        assert out["curve"].shape == (4, N_CURVE_BINS)
        for k in ["pb_broke", "noMove", "score", "survival"]:
            assert out[k].shape == (4,)

    def test_param_count_l4_range(self):
        """Transformer 参数量 ~ 100K-500K, 与 ResNet-MLP 同量级 (L4)。"""
        m = SpawnTuningTransformer()
        n = m.count_parameters()
        assert 50_000 < n < 500_000, f"transformer param count {n} out of expected range"

    def test_gradient_flow(self):
        """所有可训练参数都接收梯度。"""
        m = SpawnTuningTransformer()
        m.train()
        batch = _make_batch(batch_size=4)
        out = m(**batch)
        # 综合 loss (5 个 head 都参与)
        loss = (out["curve"].sum() + out["pb_broke"].sum() + out["noMove"].sum()
                + out["score"].sum() + out["survival"].sum())
        loss.backward()
        for name, p in m.named_parameters():
            if p.requires_grad:
                assert p.grad is not None, f"{name} has no gradient"


class TestSaveCheckpoint:
    """v2.9.1: _save_checkpoint 必须同时兼容 ResNet 和 Transformer。

    回归覆盖: transformer 训练首次 fail 的根因 — _save_checkpoint 硬编码访问
    model.hidden_dim (ResNet-MLP 特有), Transformer 无此属性 → AttributeError。
    """

    def _save_and_reload(self, model, tmp_path):
        from rl_pytorch.spawn_tuning_v2.train import _save_checkpoint
        out = tmp_path / "ckpt.pt"
        _save_checkpoint(
            model=model,
            path=str(out),
            metrics={"val_curve_mae": 0.1, "best_epoch": 1},
            base_model_path=None,
            sample_set_ids=[42],
        )
        assert out.exists()
        ckpt = torch.load(str(out), weights_only=False)
        return ckpt

    def test_save_resnet_arch_recorded(self, tmp_path):
        m = SpawnTuningResNetMLP()
        ckpt = self._save_and_reload(m, tmp_path)
        assert ckpt["arch"]["model_type"] == "resnet"
        assert "hidden_dim" in ckpt["arch"]
        assert "n_blocks" in ckpt["arch"]
        assert ckpt["arch"]["curve_bins"] == N_CURVE_BINS

    def test_save_transformer_arch_recorded(self, tmp_path):
        """v2.9.1 修复点: Transformer 也能保存, arch 用 d_model / n_layers。"""
        m = SpawnTuningTransformer()
        ckpt = self._save_and_reload(m, tmp_path)
        assert ckpt["arch"]["model_type"] == "transformer"
        assert "d_model" in ckpt["arch"]
        assert "n_layers" in ckpt["arch"]
        assert ckpt["arch"]["curve_bins"] == N_CURVE_BINS
        # 不应该出现 ResNet-MLP 字段
        assert "hidden_dim" not in ckpt["arch"]
        assert "n_blocks" not in ckpt["arch"]

    def test_save_meta_version(self, tmp_path):
        m = SpawnTuningResNetMLP()
        ckpt = self._save_and_reload(m, tmp_path)
        assert ckpt["meta"]["version"] == "v2.9.2"
        assert ckpt["meta"]["param_count"] == m.count_parameters()
        assert ckpt["meta"]["sample_set_ids"] == [42]

    def test_state_dict_reloadable(self, tmp_path):
        """v2.9.1: ckpt 保存的 state_dict 能完整恢复模型。"""
        m1 = SpawnTuningTransformer()
        ckpt = self._save_and_reload(m1, tmp_path)
        m2 = SpawnTuningTransformer()
        m2.load_state_dict(ckpt["model_state_dict"])
        # 参数完全一致
        for (n1, p1), (n2, p2) in zip(m1.named_parameters(), m2.named_parameters()):
            assert n1 == n2
            assert torch.allclose(p1, p2)

    def test_sidecar_json_written(self, tmp_path):
        """v2.9.2: 同时写 .meta.json sidecar, 让 job_executor 不依赖 torch.load。

        回归覆盖: job_16 卡死根因 — job_executor 在 daemon thread 内调 torch.load
        加载 mps ckpt 时 hang, 持着 SQLite 写锁导致整个 backend 卡死。
        """
        import json as _json
        from rl_pytorch.spawn_tuning_v2.train import _save_checkpoint
        out = tmp_path / "ckpt.pt"
        m = SpawnTuningTransformer()
        _save_checkpoint(
            model=m, path=str(out),
            metrics={"val_curve_mae": 0.1, "best_epoch": 3, "reach_100": 0.18},
            base_model_path=None, sample_set_ids=[1, 2],
        )
        sidecar = tmp_path / "ckpt.pt.meta.json"
        assert sidecar.exists()
        data = _json.loads(sidecar.read_text())
        # 三大部分齐全, 内容跟 ckpt 一致
        assert data["arch"]["model_type"] == "transformer"
        assert data["arch"]["d_model"] in (64, 128)  # DEFAULT_TRANSFORMER_DIM 可能调整
        assert data["metrics"]["val_curve_mae"] == 0.1
        assert data["metrics"]["best_epoch"] == 3
        assert data["metrics"]["reach_100"] == 0.18
        assert data["meta"]["version"] == "v2.9.2"
        assert data["meta"]["sample_set_ids"] == [1, 2]

    def test_read_metrics_sidecar_prefers_json(self, tmp_path):
        """v2.9.2: _read_metrics_sidecar 优先读 sidecar JSON, 不需要 torch。"""
        from rl_pytorch.spawn_tuning_v2.train import _save_checkpoint
        from rl_pytorch.spawn_tuning_v2.job_executor import _read_metrics_sidecar
        out = tmp_path / "ckpt.pt"
        m = SpawnTuningResNetMLP()
        _save_checkpoint(
            model=m, path=str(out),
            metrics={"val_curve_mae": 0.05, "anchor": 0.001},
            base_model_path=None, sample_set_ids=[42],
        )
        metrics = _read_metrics_sidecar(out)
        assert metrics["val_curve_mae"] == 0.05
        assert metrics["anchor"] == 0.001

    def test_read_metrics_sidecar_fallback_to_jsonl(self, tmp_path):
        """v2.9.2: 无 sidecar 时 fallback 到 .pt.log JSONL 找最佳 epoch (兼容老 ckpt)。"""
        import json as _json
        from rl_pytorch.spawn_tuning_v2.job_executor import _read_metrics_sidecar
        out = tmp_path / "old_ckpt.pt"
        out.write_bytes(b"fake")  # 没真实 ckpt, 也没 sidecar
        # 写一个 train.py 风格的 JSONL
        jsonl = tmp_path / "old_ckpt.pt.log"
        jsonl.write_text("\n".join([
            _json.dumps({"type": "epoch", "epoch": 0, "val_curve_mae": 0.20}),
            _json.dumps({"type": "epoch", "epoch": 1, "val_curve_mae": 0.10}),
            _json.dumps({"type": "epoch", "epoch": 2, "val_curve_mae": 0.15}),
        ]))
        metrics = _read_metrics_sidecar(out)
        assert metrics["val_curve_mae"] == 0.10  # 最佳
        assert metrics["best_epoch"] == 1

    def test_read_metrics_sidecar_empty_when_nothing(self, tmp_path):
        """无 sidecar 无 JSONL → 返回空 dict (不抛异常, job_executor 仍能写 INSERT)。"""
        from rl_pytorch.spawn_tuning_v2.job_executor import _read_metrics_sidecar
        out = tmp_path / "missing.pt"
        out.write_bytes(b"fake")
        assert _read_metrics_sidecar(out) == {}
