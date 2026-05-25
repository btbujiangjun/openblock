"""Flask v2 backend 端到端 API 测试。

策略: 用 Flask test_client + 临时 SQLite, 不依赖真实 server。
"""
import json
import os
import sys
import tempfile

import pytest
from flask import Flask

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


@pytest.fixture
def app():
    """构造独立 Flask app + 临时 SQLite。"""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    os.environ["SPAWN_TUNING_V2_DB"] = db_path

    # 强制 reimport (因为 module-level 读取 DB_PATH)
    import importlib
    import spawn_tuning_v2_backend as mod
    importlib.reload(mod)

    flask_app = Flask(__name__)
    mod.register_v2_routes(flask_app)
    flask_app.config["TESTING"] = True

    yield flask_app

    try:
        os.unlink(db_path)
    except OSError:
        pass


@pytest.fixture
def client(app):
    return app.test_client()


# ─────────── 样本集 CRUD ───────────

class TestSampleSetsCRUD:
    def test_list_empty(self, client):
        r = client.get("/api/spawn-tuning-v2/sample-sets")
        assert r.status_code == 200
        data = r.get_json()
        assert data["count"] == 0
        assert data["sample_sets"] == []

    def test_create_minimal(self, client):
        r = client.post(
            "/api/spawn-tuning-v2/sample-sets",
            json={"name": "test_set"},
        )
        assert r.status_code == 201
        data = r.get_json()
        assert data["ok"] is True
        assert data["set_id"] > 0

    def test_create_missing_name(self, client):
        r = client.post("/api/spawn-tuning-v2/sample-sets", json={})
        assert r.status_code == 400

    def test_get_details(self, client):
        # 先建
        cr = client.post("/api/spawn-tuning-v2/sample-sets",
                         json={"name": "x", "description": "yo", "tags": "v2,test"})
        sid = cr.get_json()["set_id"]
        # 再查
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}")
        assert r.status_code == 200
        data = r.get_json()
        assert data["name"] == "x"
        assert data["description"] == "yo"
        assert data["tags"] == "v2,test"
        assert data["actual_sample_count"] == 0

    def test_get_not_found(self, client):
        r = client.get("/api/spawn-tuning-v2/sample-sets/99999")
        assert r.status_code == 404

    def test_patch_update_fields(self, client):
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "old"})
        sid = cr.get_json()["set_id"]
        r = client.patch(
            f"/api/spawn-tuning-v2/sample-sets/{sid}",
            json={"name": "renamed", "tags": "v2,important"},
        )
        assert r.status_code == 200
        # 验证
        g = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}").get_json()
        assert g["name"] == "renamed"
        assert g["tags"] == "v2,important"

    def test_delete(self, client):
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "tmp"})
        sid = cr.get_json()["set_id"]
        r = client.delete(f"/api/spawn-tuning-v2/sample-sets/{sid}")
        assert r.status_code == 200
        # 已删
        assert client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}").status_code == 404

    def test_status_filter(self, client):
        client.post("/api/spawn-tuning-v2/sample-sets",
                    json={"name": "a", "status": "completed"})
        client.post("/api/spawn-tuning-v2/sample-sets",
                    json={"name": "b", "status": "collecting"})
        r = client.get("/api/spawn-tuning-v2/sample-sets?status=completed")
        data = r.get_json()
        assert data["count"] == 1
        assert data["sample_sets"][0]["name"] == "a"


# ─────────── 样本批量写入 + 聚合 ───────────

class TestSamplesBulk:
    def _make_sample(self):
        from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector
        return {
            "difficulty": "normal", "generator": "budget-p2", "bot_policy": "clear-greedy",
            "pb_bin": 1500, "lifecycle_stage": "growth",
            "theta_json": {"pbTension_strength": 0.5},
            "d_curve_json": target_curve_vector(),
            "final_score": 1200, "survived_steps": 50,
            "clear_rate": 0.5, "noMove_step": -1, "pb_broke": False,
            "surprise_count": 2, "seed": 42,
        }

    def test_bulk_insert(self, client):
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "test"})
        sid = cr.get_json()["set_id"]
        samples = [self._make_sample() for _ in range(5)]
        r = client.post(
            f"/api/spawn-tuning-v2/sample-sets/{sid}/samples",
            json={"samples": samples},
        )
        assert r.status_code == 200
        data = r.get_json()
        assert data["inserted"] == 5
        assert data["errors"] == 0
        # sample_count 自增
        g = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}").get_json()
        assert g["actual_sample_count"] == 5

    def test_bulk_insert_invalid(self, client):
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "test"})
        sid = cr.get_json()["set_id"]
        # 缺必填字段
        r = client.post(
            f"/api/spawn-tuning-v2/sample-sets/{sid}/samples",
            json={"samples": [{"difficulty": "normal"}]},  # 缺很多字段
        )
        data = r.get_json()
        assert data["inserted"] == 0
        assert data["errors"] >= 1

    def test_aggregate_no_grouping(self, client):
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "agg"})
        sid = cr.get_json()["set_id"]
        client.post(
            f"/api/spawn-tuning-v2/sample-sets/{sid}/samples",
            json={"samples": [self._make_sample() for _ in range(3)]},
        )
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/aggregate")
        assert r.status_code == 200
        data = r.get_json()
        assert len(data["buckets"]) == 1
        assert data["buckets"][0]["n_samples"] == 3
        assert len(data["buckets"][0]["d_curve_avg"]) == 20


# ─────────── 模型 + 部署 + 回滚 ───────────

class TestModelsLifecycle:
    def _create_model(self, client, conn_path):
        """直接写 SQLite, 跳过 API。"""
        import sqlite3
        import time
        conn = sqlite3.connect(conn_path)
        conn.execute(
            "INSERT INTO models (name, model_type, status, created_at) VALUES (?, ?, ?, ?)",
            ("m", "resnet", "staging", int(time.time())),
        )
        mid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()
        conn.close()
        return mid

    def test_deploy_model(self, client, app):
        # 用 API 创建 (通过 jobs 间接) ... 简化: 直接 SQL
        db_path = os.environ["SPAWN_TUNING_V2_DB"]
        mid = self._create_model(client, db_path)

        r = client.post(f"/api/spawn-tuning-v2/models/{mid}/deploy")
        assert r.status_code == 200
        # 检查 status
        g = client.get(f"/api/spawn-tuning-v2/models/{mid}").get_json()
        assert g["status"] == "deployed"
        assert g["deployed_at"] is not None

    def test_deploy_archives_previous(self, client, app):
        """新 deploy 应把旧 deployed 改成 archived。"""
        db_path = os.environ["SPAWN_TUNING_V2_DB"]
        m1 = self._create_model(client, db_path)
        m2 = self._create_model(client, db_path)
        client.post(f"/api/spawn-tuning-v2/models/{m1}/deploy")
        client.post(f"/api/spawn-tuning-v2/models/{m2}/deploy")

        g1 = client.get(f"/api/spawn-tuning-v2/models/{m1}").get_json()
        g2 = client.get(f"/api/spawn-tuning-v2/models/{m2}").get_json()
        assert g1["status"] == "archived"
        assert g2["status"] == "deployed"

    def test_rollback_to_previous(self, client, app):
        """回滚当前 deployed → 上一个 archived/deployed 重新激活。"""
        db_path = os.environ["SPAWN_TUNING_V2_DB"]
        m1 = self._create_model(client, db_path)
        m2 = self._create_model(client, db_path)
        client.post(f"/api/spawn-tuning-v2/models/{m1}/deploy")
        client.post(f"/api/spawn-tuning-v2/models/{m2}/deploy")  # 现 m2 = deployed
        # 回滚 m2
        r = client.post(f"/api/spawn-tuning-v2/models/{m2}/rollback")
        assert r.status_code == 200
        data = r.get_json()
        assert data["rollbacked"] == m2
        assert data["now_deployed"] == m1

        g1 = client.get(f"/api/spawn-tuning-v2/models/{m1}").get_json()
        g2 = client.get(f"/api/spawn-tuning-v2/models/{m2}").get_json()
        assert g1["status"] == "deployed"
        assert g2["status"] == "rollbacked"


# ─────────── 训练任务 ───────────

class TestJobs:
    def test_create_job(self, client):
        r = client.post(
            "/api/spawn-tuning-v2/jobs",
            json={
                "name": "test_job",
                "sample_set_ids": [1, 2],
                "model_type": "resnet",
                "arch": {"hidden_dim": 128, "n_blocks": 8},
                "loss_weights": {"shape": 1.0, "balance": 0.5},
            },
        )
        assert r.status_code == 201
        data = r.get_json()
        assert data["job_id"] > 0
        assert data["status"] == "queued"

    def test_patch_job_progress(self, client):
        cr = client.post(
            "/api/spawn-tuning-v2/jobs",
            json={"sample_set_ids": [1]},
        )
        jid = cr.get_json()["job_id"]
        # 模拟训练中
        client.patch(
            f"/api/spawn-tuning-v2/jobs/{jid}",
            json={"status": "running", "epochs_done": 5, "train_loss": 0.08},
        )
        g = client.get(f"/api/spawn-tuning-v2/jobs/{jid}").get_json()
        assert g["status"] == "running"
        assert g["epochs_done"] == 5
        assert g["train_loss"] == pytest.approx(0.08)


# ─────────── 真实玩家 field_metrics 上报 ───────────

class TestFieldMetrics:
    def _make_episode(self, ctx_key="normal:budget-p2:clear-greedy:1500:growth", pb=1500):
        return {
            "context_key": ctx_key, "pb": pb,
            "model_id": "v2-001", "theta_hash": "abc123",
            "d_curve": [0.2 + i * 0.04 for i in range(20)],
            "final_score": 1300, "survived_steps": 80,
            "clear_rate": 0.4, "noMove_step": -1, "pb_broke": False,
            "surprise_count": 3,
            "ts": int(__import__("time").time() * 1000),
        }

    def test_submit_basic(self, client):
        eps = [self._make_episode() for _ in range(5)]
        r = client.post("/api/spawn-tuning-v2/field-metrics", json={"episodes": eps})
        assert r.status_code == 200
        data = r.get_json()
        assert data["inserted"] == 5
        assert data["received"] == 5

    def test_submit_empty(self, client):
        r = client.post("/api/spawn-tuning-v2/field-metrics", json={"episodes": []})
        assert r.status_code == 400

    def test_aggregate_empty(self, client):
        r = client.get("/api/spawn-tuning-v2/field-metrics/aggregate?hours=24")
        assert r.status_code == 200
        data = r.get_json()
        assert data["n_episodes"] == 0
        assert data["d_curve_avg"] is None

    def test_submit_then_aggregate(self, client):
        eps = [self._make_episode(pb=1500 + i * 100) for i in range(10)]
        client.post("/api/spawn-tuning-v2/field-metrics", json={"episodes": eps})
        r = client.get("/api/spawn-tuning-v2/field-metrics/aggregate?hours=24")
        data = r.get_json()
        assert data["n_episodes"] == 10
        assert len(data["d_curve_avg"]) == 20
        # 我们插入的 curve 都是 [0.2, 0.24, ..., 0.96], 平均应一致
        assert data["d_curve_avg"][0] == pytest.approx(0.2, abs=1e-6)
        assert data["d_curve_avg"][19] == pytest.approx(0.96, abs=1e-6)
        assert data["pb_broke_rate"] == 0.0  # 都没破 PB
        assert data["noMove_rate"] == 0.0    # 都没死局

    def test_aggregate_filter_by_context(self, client):
        # 写 5 个 ctx1, 3 个 ctx2
        eps1 = [self._make_episode("easy:budget-p2:random:500:growth") for _ in range(5)]
        eps2 = [self._make_episode("hard:triplet-p1:survival:25000:plateau") for _ in range(3)]
        client.post("/api/spawn-tuning-v2/field-metrics", json={"episodes": eps1 + eps2})
        r = client.get(
            "/api/spawn-tuning-v2/field-metrics/aggregate?"
            "hours=24&context_key=hard:triplet-p1:survival:25000:plateau"
        )
        assert r.get_json()["n_episodes"] == 3


# ─────────── 工具 endpoint ───────────

class TestUtilityEndpoints:
    def test_target_curve(self, client):
        r = client.get("/api/spawn-tuning-v2/target-curve")
        assert r.status_code == 200
        data = r.get_json()
        assert "curve" in data
        assert len(data["curve"]) == 20
        # 单调性已验证, 这里检查首尾值
        assert data["curve"][0] < 0.3
        assert data["curve"][-1] > 0.85
        assert data["metadata"]["version"] == "v2.0.0"

    def test_active_policies_none(self, client):
        r = client.get("/api/spawn-tuning-v2/policies/active")
        assert r.status_code == 200
        assert r.get_json()["deployed"] is None
