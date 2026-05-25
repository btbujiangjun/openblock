"""feature_io 测试 + 端到端: schema → 写样本 → 读 → 训 → 推断。

这个测试同时验证:
  - SQL schema 可加载
  - normalize_theta / denormalize_theta 互逆
  - SamplesDataset.from_sqlite 端到端读取
  - 训练一次小 epoch 不崩
"""
import json
import os
import sqlite3
import sys
import tempfile

import numpy as np
import pytest
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from rl_pytorch.spawn_tuning_v2.feature_io import (
    normalize_theta, denormalize_theta,
    THETA_KEYS, THETA_RANGES,
    SamplesDataset,
    DIFFICULTY_INDEX, GENERATOR_INDEX, BOT_INDEX, PB_BIN_INDEX, LIFECYCLE_INDEX,
)
from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector
from rl_pytorch.spawn_tuning_v2.model import build_default_model
from rl_pytorch.spawn_tuning_v2.losses import LossWeights


SCHEMA_SQL = open(
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
        "schemas", "spawn_tuning_v2.sql",
    )
).read()


# ─────────── Helpers ───────────

@pytest.fixture
def test_db():
    """临时 SQLite, 测完删除。"""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_SQL)
    conn.close()
    yield db_path
    try:
        os.unlink(db_path)
    except OSError:
        pass


def _default_theta() -> dict:
    """各参数取范围中点。"""
    return {k: (lo + hi) / 2 for k, (lo, hi) in THETA_RANGES.items()}


def _insert_sample(conn, set_id, **overrides):
    """插入一条样本到 samples 表。"""
    import time
    defaults = {
        "set_id": set_id,
        "difficulty": "normal", "generator": "budget-p2", "bot_policy": "clear-greedy",
        "pb_bin": 1500, "lifecycle_stage": "growth",
        "theta_json": json.dumps(_default_theta()),
        "d_curve_json": json.dumps(target_curve_vector()),
        "final_score": 1200, "survived_steps": 50,
        "clear_rate": 0.5, "noMove_step": -1, "pb_broke": 0, "surprise_count": 3,
        "seed": 42, "eval_ms": 1500, "evaluated_at": int(time.time() * 1000),
    }
    defaults.update(overrides)
    cols = ",".join(defaults.keys())
    ph = ",".join("?" * len(defaults))
    conn.execute(f"INSERT INTO samples ({cols}) VALUES ({ph})", tuple(defaults.values()))


# ─────────── normalize / denormalize ───────────

class TestNormalize:
    def test_inverse_identity(self):
        """normalize(denormalize(x)) ≈ x"""
        theta = _default_theta()
        normed = normalize_theta(theta)
        back = denormalize_theta(normed)
        for k in THETA_KEYS:
            assert abs(back[k] - theta[k]) < 1e-5

    def test_min_value(self):
        """每个参数取 min 时归一化应为 0。"""
        theta = {k: lo for k, (lo, _) in THETA_RANGES.items()}
        normed = normalize_theta(theta)
        assert np.allclose(normed, 0, atol=1e-6)

    def test_max_value(self):
        """每个参数取 max 时归一化应为 1。"""
        theta = {k: hi for k, (_, hi) in THETA_RANGES.items()}
        normed = normalize_theta(theta)
        assert np.allclose(normed, 1, atol=1e-6)

    def test_out_of_range_clipped(self):
        """超出范围的值应被 clip 到 [0, 1]。"""
        theta = {k: -100 for k in THETA_KEYS}
        normed = normalize_theta(theta)
        assert (normed >= 0).all() and (normed <= 1).all()

    def test_missing_key_filled(self):
        """缺失的 key 应填中点。"""
        theta = {"personalizationStrength": 0.10}  # 缺其他 8 个 (v2.2 = 9 维)
        normed = normalize_theta(theta)
        assert normed.shape == (len(THETA_KEYS),)
        # 第 0 维 (personalizationStrength=0.10) 归一化: (0.10-0.05)/(0.18-0.05) ≈ 0.3846
        assert abs(normed[0] - 0.3846) < 0.001

    def test_v22_pb_curve_keys_present(self):
        """v2.2 回归: 9 维 θ 必须含 4 个 PB 曲线参数。"""
        assert "pbTensionCenter" in THETA_KEYS
        assert "pbTensionWidth" in THETA_KEYS
        assert "pbBrakeCenter" in THETA_KEYS
        assert "pbBrakeWidth" in THETA_KEYS
        assert len(THETA_KEYS) == 9


# ─────────── SamplesDataset ───────────

class TestSamplesDataset:
    def test_from_sqlite_basic(self, test_db):
        """写 5 条样本, 读出来应能构造合法 dataset"""
        conn = sqlite3.connect(test_db)
        conn.execute("INSERT INTO sample_sets (name, status, created_at) VALUES ('test', 'completed', strftime('%s','now'))")
        set_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        for i in range(5):
            _insert_sample(conn, set_id, seed=i, final_score=1000 + i * 100)
        conn.commit()
        conn.close()

        ds = SamplesDataset.from_sqlite(test_db, [set_id])
        assert len(ds) == 5
        assert ds.theta_norm.shape == (5, len(THETA_KEYS))
        assert ds.d_curve.shape == (5, 20)

    def test_empty_set_raises(self, test_db):
        with pytest.raises(ValueError):
            SamplesDataset.from_sqlite(test_db, [999])

    def test_train_val_split(self, test_db):
        conn = sqlite3.connect(test_db)
        conn.execute("INSERT INTO sample_sets (name, status, created_at) VALUES ('test', 'completed', strftime('%s','now'))")
        set_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        for i in range(20):
            _insert_sample(conn, set_id, seed=i)
        conn.commit()
        conn.close()

        ds = SamplesDataset.from_sqlite(test_db, [set_id])
        train, val = ds.train_val_split(val_ratio=0.2, seed=0)
        assert len(train) == 16
        assert len(val) == 4

    def test_iter_batches(self, test_db):
        conn = sqlite3.connect(test_db)
        conn.execute("INSERT INTO sample_sets (name, status, created_at) VALUES ('test', 'completed', strftime('%s','now'))")
        set_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        for i in range(10):
            _insert_sample(conn, set_id, seed=i)
        conn.commit()
        conn.close()

        ds = SamplesDataset.from_sqlite(test_db, [set_id])
        batches = list(ds.iter_batches(batch_size=3, shuffle=False))
        assert len(batches) == 4  # 10 / 3 = 3 batches of 3 + 1 batch of 1
        # 每 batch 含必需 keys
        b = batches[0]
        for key in ["difficulty_idx", "theta_norm", "d_curve", "pb_broke"]:
            assert key in b


# ─────────── 端到端: SQLite → 模型 → 推断 ───────────

class TestEndToEnd:
    def test_full_pipeline_smoke(self, test_db):
        """写 30 样本 → 加载 → 模型推断 → loss 反传 (1 step)。"""
        import time as t_mod
        conn = sqlite3.connect(test_db)
        conn.execute(
            "INSERT INTO sample_sets (name, status, created_at) VALUES (?, ?, ?)",
            ("test", "completed", int(t_mod.time())),
        )
        set_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        # 用各种 ctx 组合, 避免 balance loss 为 0
        for i in range(30):
            _insert_sample(
                conn, set_id, seed=i,
                difficulty=list(DIFFICULTY_INDEX)[i % 3],
                generator=list(GENERATOR_INDEX)[i % 2],
                bot_policy=list(BOT_INDEX)[i % 3],
                pb_bin=[500, 1500, 4000, 10000, 25000][i % 5],
                lifecycle_stage=list(LIFECYCLE_INDEX)[i % 4],
                final_score=1000 + i * 50,
            )
        conn.commit()
        conn.close()

        ds = SamplesDataset.from_sqlite(test_db, [set_id])
        assert len(ds) == 30

        # 单 batch 推断 + 反传
        model = build_default_model()
        model.train()
        opt = torch.optim.Adam(model.parameters(), lr=1e-3)
        batch_np = next(ds.iter_batches(batch_size=8, shuffle=True))

        def to_tensor(v, dtype=torch.float32):
            t = torch.from_numpy(v)
            return t.long() if dtype == torch.long else t.float()

        preds = model(
            difficulty_idx=to_tensor(batch_np["difficulty_idx"], torch.long),
            generator_idx=to_tensor(batch_np["generator_idx"], torch.long),
            bot_idx=to_tensor(batch_np["bot_idx"], torch.long),
            pb_bin_idx=to_tensor(batch_np["pb_bin_idx"], torch.long),
            lifecycle_idx=to_tensor(batch_np["lifecycle_idx"], torch.long),
            log_pb=to_tensor(batch_np["log_pb"]),
            theta_norm=to_tensor(batch_np["theta_norm"]),
        )
        assert preds["curve"].shape == (8, 20)

        # 简单 loss
        target_curve = to_tensor(batch_np["d_curve"])
        loss = (preds["curve"] - target_curve).pow(2).mean()
        opt.zero_grad()
        loss.backward()
        opt.step()

        assert torch.isfinite(loss).item()
