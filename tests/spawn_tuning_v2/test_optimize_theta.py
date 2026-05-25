"""Phase C 寻参单元 + 集成测试。

测试覆盖:
  - context 枚举 (360 个)
  - 单 context 优化收敛性
  - 全集寻参 (用 mini 配置, 跑得快)
  - policies.json 格式正确性
"""
import json
import os
import sys
import tempfile

import numpy as np
import pytest
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rl_pytorch.spawn_tuning_v2.optimize_theta import (
    enumerate_all_contexts, context_to_indices,
    optimize_one_context, optimize_all_contexts,
    DIFFICULTY_VALUES, GENERATOR_VALUES, BOT_VALUES, PB_BIN_VALUES, LIFECYCLE_VALUES,
)
from rl_pytorch.spawn_tuning_v2.model import build_default_model, N_THETA
from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector
from rl_pytorch.spawn_tuning_v2.losses import LossWeights


# ─────────── Context 枚举 ───────────

class TestContextEnum:
    def test_total_count_is_360(self):
        ctxs = enumerate_all_contexts()
        assert len(ctxs) == 3 * 2 * 3 * 5 * 4
        assert len(ctxs) == 360

    def test_keys_unique(self):
        ctxs = enumerate_all_contexts()
        keys = [c["context_key"] for c in ctxs]
        assert len(set(keys)) == 360

    def test_first_context_format(self):
        ctxs = enumerate_all_contexts()
        c0 = ctxs[0]
        for k in ("difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage", "context_key"):
            assert k in c0
        # context_key 用 ':' 分隔
        assert c0["context_key"].count(":") == 4

    def test_context_to_indices(self):
        ctx = enumerate_all_contexts()[0]
        idx = context_to_indices(ctx)
        for k in ("difficulty_idx", "generator_idx", "bot_idx", "pb_bin_idx", "lifecycle_idx", "log_pb"):
            assert k in idx
        assert idx["difficulty_idx"] == 0  # easy
        assert isinstance(idx["log_pb"], float)


# ─────────── 单 context 优化 ───────────

class TestOptimizeOneContext:
    def test_basic_smoke(self):
        """模型未训练, 但优化器应能跑 + 输出合法 theta。"""
        model = build_default_model()
        ctx = enumerate_all_contexts()[0]
        target = torch.tensor(target_curve_vector(), dtype=torch.float32)
        result = optimize_one_context(
            model=model, ctx=ctx, target_curve=target,
            n_starts=2, steps=10, lr=0.1,
            device=torch.device("cpu"), seed=42,
        )
        assert "theta_norm" in result
        assert len(result["theta_norm"]) == N_THETA
        # theta_norm 应在 [0, 1] (clamp 后)
        for v in result["theta_norm"]:
            assert 0.0 <= v <= 1.0

        assert "theta" in result  # 去归一化后的字典
        assert len(result["theta"]) == N_THETA
        assert "predicted_curve" in result
        assert len(result["predicted_curve"]) == 20
        assert isinstance(result["shape_loss"], float)
        assert isinstance(result["predicted_curve_mae_to_target"], float)
        for k in ("pb_broke", "noMove", "score", "survival"):
            assert k in result["expected"]

    def test_multiple_starts_picks_best(self):
        """多起点应取 best (最低 shape_loss)"""
        model = build_default_model()
        ctx = enumerate_all_contexts()[100]
        target = torch.tensor(target_curve_vector(), dtype=torch.float32)
        r1 = optimize_one_context(model, ctx, target, n_starts=1, steps=5, seed=1)
        r4 = optimize_one_context(model, ctx, target, n_starts=4, steps=5, seed=1)
        # n_starts=4 的结果 shape_loss 应 ≤ n_starts=1
        assert r4["shape_loss"] <= r1["shape_loss"] + 1e-6


# ─────────── 全集优化 (集成) ───────────

class TestOptimizeAll:
    @pytest.fixture
    def trained_checkpoint(self, tmp_path):
        """构造一个最简 checkpoint (model 未真训, 但格式合法可加载)。"""
        model = build_default_model()
        ck_path = tmp_path / "model.pt"
        torch.save({
            "model_state_dict": model.state_dict(),
            "arch": {"hidden_dim": 128, "n_blocks": 8, "curve_bins": 20},
            "metrics": {"val_curve_mae": 0.05},
            "meta": {"version": "v2.0.0", "param_count": model.count_parameters()},
        }, str(ck_path))
        return str(ck_path)

    def test_run_minimal(self, trained_checkpoint, tmp_path):
        """跑 10 个 context, 验证 policies.json 格式。"""
        output = tmp_path / "policies.json"
        # 只跑前 10 个 context, 减少耗时
        ctxs = enumerate_all_contexts()[:10]
        result = optimize_all_contexts(
            checkpoint_path=trained_checkpoint,
            output_path=str(output),
            n_starts=2, steps=5,
            device_str="cpu",
            contexts=ctxs,
        )
        # 内存结果
        assert result["format"] == "openblock-spawn-tuning-v2-policies"
        assert result["n_contexts"] == 10
        assert len(result["policies"]) == 10

        # 落盘 JSON
        assert output.exists()
        with open(output) as f:
            on_disk = json.load(f)
        assert on_disk["n_contexts"] == 10
        assert "model_sha256" in on_disk
        assert len(on_disk["model_sha256"]) == 64

        # 单条 policy 完整性
        p0 = on_disk["policies"][0]
        assert "context_key" in p0
        assert "theta" in p0
        assert len(p0["theta"]) == N_THETA
        assert "predicted_curve" in p0
        assert len(p0["predicted_curve"]) == 20
        assert "predicted_curve_mae_to_target" in p0

    def test_average_mae_computed(self, trained_checkpoint, tmp_path):
        output = tmp_path / "p.json"
        ctxs = enumerate_all_contexts()[:5]
        result = optimize_all_contexts(
            checkpoint_path=trained_checkpoint, output_path=str(output),
            n_starts=1, steps=3, contexts=ctxs,
        )
        # 平均 MAE 应是所有 policies MAE 的均值
        expected = np.mean([p["predicted_curve_mae_to_target"] for p in result["policies"]])
        assert result["average_curve_mae"] == pytest.approx(expected, abs=1e-9)

    def test_custom_weights(self, trained_checkpoint, tmp_path):
        """自定义 weights 不影响 schema, 只影响优化目标。"""
        output = tmp_path / "p.json"
        w = LossWeights(shape=2.0, breaking=1.0, surprise=0.5)
        result = optimize_all_contexts(
            checkpoint_path=trained_checkpoint, output_path=str(output),
            n_starts=1, steps=3, weights=w,
            contexts=enumerate_all_contexts()[:3],
        )
        assert result["weights"]["shape"] == 2.0
        assert result["weights"]["breaking"] == 1.0
