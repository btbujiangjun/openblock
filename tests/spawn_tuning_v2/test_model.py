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
    SpawnParamTunerResNet, SpawnParamTunerTransformer,
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
        """所有参数都应能拿到梯度 (loss 须覆盖所有 head, v2.10.32 加 r_value).

        v3.0.11: theta_optim_raw 是联合寻参专用参数, 只在 loss_deploy 里 backprop,
        基础 head loss 不会摸到它 — 跳过这个 param.
        """
        batch = _make_batch(batch_size=4)
        out = model(**batch)
        # v2.10.32 (P2.2): 加 r_value head; v3.2: 加 curve_e / curve_f 多曲线 head
        loss = (out["curve"].mean() + out["curve_e"].mean() + out["curve_f"].mean()
                + out["pb_broke"].mean() + out["noMove"].mean()
                + out["score"].mean() + out["survival"].mean()
                + out["r_value"].mean())
        loss.backward()
        for name, p in model.named_parameters():
            if "theta_optim_raw" in name:
                continue   # v3.0.11: 联合寻参专用, 只在 loss_deploy 里 backprop
            assert p.grad is not None, f"{name} got no gradient"
            assert torch.isfinite(p.grad).all(), f"{name} grad has NaN/Inf"

    # v2.10.32 (P2.2 + P2.3): r_value head + MC Dropout uncertainty
    def test_r_value_output_range(self, model):
        """r_value 输出 ∈ [0, 2.0] (CURVE_R_MAX)."""
        batch = _make_batch(batch_size=8)
        model.eval()
        with torch.no_grad():
            out = model(**batch)
        assert "r_value" in out
        assert out["r_value"].shape == (8,)
        assert (out["r_value"] >= 0).all()
        assert (out["r_value"] <= 2.0 + 1e-5).all()

    def test_predict_with_uncertainty(self, model):
        """MC Dropout 30 次采样应给出非零 std (随机性确实生效)."""
        batch = _make_batch(batch_size=4)
        mc = model.predict_with_uncertainty(n_samples=20, **batch)
        assert "curve_mean" in mc
        assert "curve_std" in mc
        assert mc["curve_mean"].shape == (4, 20)
        assert mc["curve_std"].shape == (4, 20)
        # MC Dropout 应该至少在某些 bin 有非零 std
        assert mc["curve_std"].max().item() > 1e-4, "MC dropout 没真正生效 — std 全 0"
        assert mc["n_samples"] == 20

    # v3.0.8: ckpt embedding 维度兼容 (老 N_GEN=4 → 新 N_GEN=2 缩减; 老 N_BOT=3 → 新 N_BOT=4 扩展)
    def test_load_state_dict_compat_emb_expansion(self, model):
        """老 ckpt N_GEN=4 加载到 N_GEN=2 model 应只复制前 N 行;
        老 ckpt N_BOT=3 加载到 N_BOT=4 model 应自动 pad."""
        from rl_pytorch.spawn_tuning_v2.model import load_state_dict_compat
        sd = model.state_dict()
        emb_key = "ctx_emb.emb_gen.weight"
        full_w = sd[emb_key]
        new_dim, d = full_w.shape
        assert new_dim == 2, "前提: v3.0.8 model N_GEN=2"
        # 模拟老 ckpt N_GEN=4 — 比新 model 多, 加载时应丢弃后 2 行
        old_gen = torch.randn(4, d)
        sd_compat = dict(sd)
        sd_compat[emb_key] = old_gen
        # 也模拟老 ckpt N_BOT=3 → 新 4 (扩展)
        emb_bot_key = "ctx_emb.emb_bot.weight"
        bot_w_full = sd[emb_bot_key]
        assert bot_w_full.shape[0] == 4, "前提: 当前 model N_BOT=4"
        old_bot = torch.randn(3, d)
        sd_compat[emb_bot_key] = old_bot
        # 加载
        from rl_pytorch.spawn_tuning_v2.model import SpawnParamTunerResNet
        new_model = SpawnParamTunerResNet()
        missing, unexpected = load_state_dict_compat(new_model, sd_compat)
        # 验证: gen emb 取老权重的前 2 行
        loaded_gen = new_model.state_dict()[emb_key]
        assert loaded_gen.shape == (2, d), f"N_GEN 应为 2, 实际 {loaded_gen.shape}"
        assert torch.allclose(loaded_gen, old_gen[:2]), "N_GEN 缩减: 应复制老 ckpt 前 2 行"
        # 前 3 行 bot 也应该等老
        loaded_bot = new_model.state_dict()[emb_bot_key]
        assert torch.allclose(loaded_bot[:3], old_bot), "前 3 行 bot 应复制老 ckpt"

    def test_uncertainty_does_not_alter_eval_state(self, model):
        """predict_with_uncertainty 调用后应恢复 eval 模式 (不影响后续推理)."""
        model.eval()
        batch = _make_batch(batch_size=2)
        _ = model.predict_with_uncertainty(n_samples=5, **batch)
        # Dropout layer 应该都回到 eval 模式
        import torch.nn as nn_local
        for m in model.modules():
            if isinstance(m, nn_local.Dropout):
                assert m.training is False, "Dropout 残留 training=True"

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
        m = SpawnParamTunerResNet(hidden_dim=96, n_blocks=4)
        n = m.count_parameters()
        assert n < 200_000, f"small model {n} params too large"
        # 仍能 forward
        batch = _make_batch(4)
        out = m(**batch)
        assert out["curve"].shape == (4, N_CURVE_BINS)

    def test_invalid_n_blocks_zero(self):
        """0 块仍能构造 (退化到 trunk_in + heads),不应崩"""
        m = SpawnParamTunerResNet(n_blocks=0)
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
        assert isinstance(m, SpawnParamTunerResNet)

    def test_build_resnet_aliases(self):
        for alias in ["mlp", "resnet-mlp", "RESNET"]:
            m = build_model(alias)
            assert isinstance(m, SpawnParamTunerResNet)

    def test_build_transformer(self):
        m = build_model("transformer")
        assert isinstance(m, SpawnParamTunerTransformer)

    def test_build_invalid_raises(self):
        with pytest.raises(ValueError):
            build_model("unknown_arch")

    def test_build_resnet_with_kwargs(self):
        """G10 v2.10.9: build_model 透传 hidden_dim / n_blocks 到 ResNet。"""
        m = build_model("resnet", hidden_dim=64, n_blocks=4)
        assert m.hidden_dim == 64
        assert m.n_blocks == 4

    def test_build_transformer_with_kwargs(self):
        """G10 v2.10.9: build_model 透传 d_model / n_layers 到 Transformer。"""
        m = build_model("transformer", d_model=64, n_layers=2)
        assert m.d_model == 64
        assert m.n_layers == 2

    def test_build_model_filters_unknown_kwargs(self):
        """G10: 不相关 kwarg 应被过滤而非报错 (避免前后端 schema 漂移)。"""
        m = build_model("resnet", d_model=64, n_layers=2)  # 这俩对 resnet 无效
        assert isinstance(m, SpawnParamTunerResNet)
        m2 = build_model("transformer", hidden_dim=64, n_blocks=4)  # 这俩对 transformer 无效
        assert isinstance(m2, SpawnParamTunerTransformer)


class TestTransformer:
    """v2.9: Transformer 模型 forward / 输出 shape。"""

    def test_forward_shapes(self):
        m = SpawnParamTunerTransformer()
        m.eval()
        batch = _make_batch(batch_size=4)
        with torch.no_grad():
            out = m(**batch)
        assert out["curve"].shape == (4, N_CURVE_BINS)
        for k in ["pb_broke", "noMove", "score", "survival"]:
            assert out[k].shape == (4,)

    def test_param_count_l4_range(self):
        """Transformer 参数量 ~ 100K-500K, 与 ResNet-MLP 同量级 (L4)。"""
        m = SpawnParamTunerTransformer()
        n = m.count_parameters()
        assert 50_000 < n < 500_000, f"transformer param count {n} out of expected range"

    def test_gradient_flow(self):
        """所有可训练参数都接收梯度 (v2.10.32 加 r_value head; v3.0.11 跳过 theta_optim_raw)."""
        m = SpawnParamTunerTransformer()
        m.train()
        batch = _make_batch(batch_size=4)
        out = m(**batch)
        loss = (out["curve"].sum() + out["curve_e"].sum() + out["curve_f"].sum()
                + out["pb_broke"].sum() + out["noMove"].sum()
                + out["score"].sum() + out["survival"].sum()
                + out["r_value"].sum())
        loss.backward()
        for name, p in m.named_parameters():
            if "theta_optim_raw" in name:
                continue   # v3.0.11: 联合寻参专用, 只在 loss_deploy 里 backprop
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
        m = SpawnParamTunerResNet()
        ckpt = self._save_and_reload(m, tmp_path)
        assert ckpt["arch"]["model_type"] == "resnet"
        assert "hidden_dim" in ckpt["arch"]
        assert "n_blocks" in ckpt["arch"]
        assert ckpt["arch"]["curve_bins"] == N_CURVE_BINS

    def test_save_transformer_arch_recorded(self, tmp_path):
        """v2.9.1 修复点: Transformer 也能保存, arch 用 d_model / n_layers。"""
        m = SpawnParamTunerTransformer()
        ckpt = self._save_and_reload(m, tmp_path)
        assert ckpt["arch"]["model_type"] == "transformer"
        assert "d_model" in ckpt["arch"]
        assert "n_layers" in ckpt["arch"]
        assert ckpt["arch"]["curve_bins"] == N_CURVE_BINS
        # 不应该出现 ResNet-MLP 字段
        assert "hidden_dim" not in ckpt["arch"]
        assert "n_blocks" not in ckpt["arch"]

    def test_save_meta_version(self, tmp_path):
        m = SpawnParamTunerResNet()
        ckpt = self._save_and_reload(m, tmp_path)
        assert ckpt["meta"]["version"] == "v2.9.2"
        assert ckpt["meta"]["param_count"] == m.count_parameters()
        assert ckpt["meta"]["sample_set_ids"] == [42]

    def test_state_dict_reloadable(self, tmp_path):
        """v2.9.1: ckpt 保存的 state_dict 能完整恢复模型。"""
        m1 = SpawnParamTunerTransformer()
        ckpt = self._save_and_reload(m1, tmp_path)
        m2 = SpawnParamTunerTransformer()
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
        m = SpawnParamTunerTransformer()
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
        m = SpawnParamTunerResNet()
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
