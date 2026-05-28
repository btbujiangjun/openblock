"""v2.10.9 G7: e2e 验证单元测试。"""
import sys
import os
import json
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

import pytest
import sqlite3

from rl_pytorch.spawn_tuning_v2.validate_e2e import (
    load_bundle, aggregate_sample_set_curves, validate,
)


def _make_bundle(tmp_path, policies):
    """构造 minimal v2 bundle file。"""
    p = tmp_path / "policies.json"
    p.write_text(json.dumps({
        "format": "openblock-spawn-tuning-v2-bundle",
        "version": "2.0.0",
        "n_contexts": len(policies),
        "policies": policies,
    }), encoding="utf-8")
    return str(p)


def _make_db_with_set(tmp_path, set_id=1, samples=None):
    """构造 minimal SQLite 含 sample_sets + samples。"""
    db_path = str(tmp_path / "test.sqlite")
    conn = sqlite3.connect(db_path)
    conn.executescript("""
        CREATE TABLE sample_sets (set_id INTEGER PRIMARY KEY, name TEXT, sample_count INTEGER DEFAULT 0);
        CREATE TABLE samples (
            sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
            set_id INTEGER, difficulty TEXT, generator TEXT, bot_policy TEXT,
            pb_bin INTEGER, lifecycle_stage TEXT, d_curve_json TEXT
        );
    """)
    conn.execute("INSERT INTO sample_sets (set_id, name) VALUES (?, ?)", (set_id, f"test-{set_id}"))
    for s in (samples or []):
        conn.execute(
            "INSERT INTO samples (set_id, difficulty, generator, bot_policy, pb_bin, lifecycle_stage, d_curve_json) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (set_id, s["difficulty"], s["generator"], s["bot_policy"], s["pb_bin"],
             s["lifecycle_stage"], json.dumps(s["d_curve"])),
        )
    conn.commit()
    conn.close()
    return db_path


class TestLoadBundle:
    def test_valid_bundle(self, tmp_path):
        path = _make_bundle(tmp_path, [{"context_key": "x", "predicted_curve": [0.5] * 20}])
        b = load_bundle(path)
        assert b["format"] == "openblock-spawn-tuning-v2-bundle"

    def test_invalid_format_raises(self, tmp_path):
        p = tmp_path / "bad.json"
        p.write_text('{"format": "wrong"}', encoding="utf-8")
        with pytest.raises(ValueError):
            load_bundle(str(p))


class TestAggregateSamples:
    def test_groups_by_ctx(self, tmp_path):
        db = _make_db_with_set(tmp_path, samples=[
            {"difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
             "pb_bin": 4000, "lifecycle_stage": "mature", "d_curve": [0.3] * 20},
            {"difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
             "pb_bin": 4000, "lifecycle_stage": "mature", "d_curve": [0.5] * 20},
            {"difficulty": "hard", "generator": "rule", "bot_policy": "clear-greedy",
             "pb_bin": 4000, "lifecycle_stage": "mature", "d_curve": [0.7] * 20},
        ])
        result = aggregate_sample_set_curves(db, set_id=1)
        # 两个 ctx (normal vs hard)
        assert len(result) == 2
        normal_key = "normal:rule:clear-greedy:4000:mature"
        assert result[normal_key]["n"] == 2
        # 平均: (0.3 + 0.5) / 2 = 0.4
        assert all(abs(v - 0.4) < 1e-9 for v in result[normal_key]["mean"])

    def test_empty_set_returns_empty(self, tmp_path):
        db = _make_db_with_set(tmp_path, samples=[])
        assert aggregate_sample_set_curves(db, set_id=1) == {}


class TestValidate:
    def test_match_and_grade(self, tmp_path):
        """模型预测 [0.3]*20, 数据实测 [0.35]*20 → mae=0.05 → excellent."""
        ctx_key = "normal:rule:clear-greedy:4000:mature"
        # 准备数据 (10 个 sample, mean 0.35)
        samples = [
            {"difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
             "pb_bin": 4000, "lifecycle_stage": "mature", "d_curve": [0.35] * 20}
            for _ in range(10)
        ]
        db = _make_db_with_set(tmp_path, samples=samples)
        # 准备 bundle (1 policy)
        bundle = _make_bundle(tmp_path, [{
            "context_key": ctx_key,
            "context": {
                "difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
                "pb_bin": 4000, "lifecycle_stage": "mature",
            },
            "predicted_curve": [0.30] * 20,
        }])
        result = validate(db, bundle, set_id=1, min_samples_per_ctx=3)
        assert result["status"] == "ready"
        assert result["matched"] == 1
        # mae = |0.30 - 0.35| = 0.05
        assert result["summary"]["avg_mae"] == pytest.approx(0.05, abs=1e-6)
        assert result["summary"]["grade"] == "excellent"

    def test_skip_few_samples(self, tmp_path):
        """min_samples=5 时, 只 2 sample 的 ctx 应被跳过。"""
        samples = [
            {"difficulty": "easy", "generator": "rule", "bot_policy": "clear-greedy",
             "pb_bin": 500, "lifecycle_stage": "onboarding", "d_curve": [0.4] * 20}
            for _ in range(2)
        ]
        db = _make_db_with_set(tmp_path, samples=samples)
        bundle = _make_bundle(tmp_path, [{
            "context_key": "easy:rule:clear-greedy:500:onboarding",
            "context": {
                "difficulty": "easy", "generator": "rule", "bot_policy": "clear-greedy",
                "pb_bin": 500, "lifecycle_stage": "onboarding",
            },
            "predicted_curve": [0.40] * 20,
        }])
        result = validate(db, bundle, set_id=1, min_samples_per_ctx=5)
        assert result["status"] == "no-match"
        assert result["skipped_few"] == 1

    def test_grade_thresholds(self, tmp_path):
        """mae 0.15 → fair grade."""
        ctx_key = "normal:rule:clear-greedy:4000:mature"
        samples = [
            {"difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
             "pb_bin": 4000, "lifecycle_stage": "mature", "d_curve": [0.45] * 20}
            for _ in range(10)
        ]
        db = _make_db_with_set(tmp_path, samples=samples)
        bundle = _make_bundle(tmp_path, [{
            "context_key": ctx_key,
            "context": {
                "difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
                "pb_bin": 4000, "lifecycle_stage": "mature",
            },
            "predicted_curve": [0.30] * 20,  # 跟 0.45 差 0.15
        }])
        result = validate(db, bundle, set_id=1, min_samples_per_ctx=3)
        assert result["summary"]["avg_mae"] == pytest.approx(0.15, abs=1e-6)
        assert result["summary"]["grade"] == "fair"

    def test_no_data_returns_error(self, tmp_path):
        db = _make_db_with_set(tmp_path, samples=[])
        bundle = _make_bundle(tmp_path, [])
        # bundle 没 policies 应抛 ValueError
        with pytest.raises(ValueError):
            validate(db, bundle, set_id=1)
