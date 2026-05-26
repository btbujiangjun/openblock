"""Flask v2 backend 端到端 API 测试。

策略: 用 Flask test_client + 临时 SQLite, 不依赖真实 server。
"""
import json
import os
import sys
import tempfile
from pathlib import Path

import pytest
from flask import Flask

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))


@pytest.fixture
def app():
    """构造独立 Flask app + 临时 SQLite。"""
    with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
        db_path = f.name
    os.environ["SPAWN_TUNING_V2_DB"] = db_path
    os.environ["SPAWN_TUNING_V2_DISABLE_EXECUTOR"] = "1"   # 测试时禁掉后台 worker

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
            "theta_json": {"personalizationStrength": 0.10, "temperature": 0.05},
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

    def test_preview_basic(self, client):
        """/preview: 维度覆盖 + 标签摘要 + θ 直方 + 样本原型。"""
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "pv"})
        sid = cr.get_json()["set_id"]
        # 混 5 条不同 ctx 的样本, 验证维度覆盖能区分
        mix = [
            {**self._make_sample(), "difficulty": "easy", "final_score": 800, "pb_broke": False},
            {**self._make_sample(), "difficulty": "easy", "final_score": 900, "pb_broke": False},
            {**self._make_sample(), "difficulty": "normal", "final_score": 1500, "pb_broke": True},
            {**self._make_sample(), "difficulty": "hard", "final_score": 2000, "pb_broke": True},
            {**self._make_sample(), "difficulty": "hard", "final_score": 1200, "noMove_step": 30},
        ]
        client.post(
            f"/api/spawn-tuning-v2/sample-sets/{sid}/samples",
            json={"samples": mix},
        )
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/preview?limit=10")
        assert r.status_code == 200
        data = r.get_json()

        # set 元数据
        assert data["set"]["set_id"] == sid

        # 维度覆盖 — easy 2, normal 1, hard 2
        assert data["dim_coverage"]["difficulty"]["easy"] == 2
        assert data["dim_coverage"]["difficulty"]["normal"] == 1
        assert data["dim_coverage"]["difficulty"]["hard"] == 2

        # 标签摘要
        lbl = data["label_summary"]
        assert lbl["n"] == 5
        assert lbl["final_score"]["min"] == 800
        assert lbl["final_score"]["max"] == 2000
        assert lbl["final_score"]["mean"] == 1280.0  # (800+900+1500+2000+1200)/5
        assert abs(lbl["pb_broke_rate"] - 0.4) < 1e-3  # 2/5
        assert abs(lbl["noMove_rate"] - 0.2) < 1e-3   # 1/5

        # θ 直方 — _make_sample 用同样 θ, 所以 mean=min=max
        assert "personalizationStrength" in data["theta_summary"]
        assert data["theta_summary"]["personalizationStrength"]["n"] == 5

        # d_curve_avg 长度 20
        assert data["d_curve_avg"] is not None
        assert len(data["d_curve_avg"]) == 20

        # 样本原型
        assert len(data["samples"]) == 5
        assert "theta" in data["samples"][0]
        assert "final_score" in data["samples"][0]

    def test_preview_empty_set(self, client):
        """空 set 不应崩, 字段类型保持一致。"""
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "empty"})
        sid = cr.get_json()["set_id"]
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/preview")
        assert r.status_code == 200
        data = r.get_json()
        assert data["label_summary"]["n"] == 0
        assert data["samples"] == []
        assert data["d_curve_avg"] is None

    def test_preview_not_found(self, client):
        r = client.get("/api/spawn-tuning-v2/sample-sets/99999/preview")
        assert r.status_code == 404

    def test_preview_with_filter(self, client):
        """/preview 支持按 5 维度筛选 — 测试 difficulty + bot_policy 联合筛选。"""
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "pvf"})
        sid = cr.get_json()["set_id"]
        mix = [
            {**self._make_sample(), "difficulty": "easy", "bot_policy": "random", "final_score": 800},
            {**self._make_sample(), "difficulty": "easy", "bot_policy": "clear-greedy", "final_score": 900},
            {**self._make_sample(), "difficulty": "normal", "bot_policy": "random", "final_score": 1500},
            {**self._make_sample(), "difficulty": "hard", "bot_policy": "survival", "final_score": 2000},
            {**self._make_sample(), "difficulty": "hard", "bot_policy": "random", "final_score": 2200},
        ]
        client.post(
            f"/api/spawn-tuning-v2/sample-sets/{sid}/samples",
            json={"samples": mix},
        )

        # 1) 无筛选 → 5 条
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/preview")
        data = r.get_json()
        assert data["n_filtered"] == 5
        assert data["n_total"] == 5
        assert data["filters"] == {}

        # 2) 按 difficulty=easy → 2 条 (800 + 900)
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/preview?difficulty=easy")
        data = r.get_json()
        assert data["n_filtered"] == 2
        assert data["n_total"] == 5
        assert data["filters"] == {"difficulty": ["easy"]}
        assert data["label_summary"]["final_score"]["mean"] == 850.0
        assert data["label_summary"]["final_score"]["max"] == 900

        # 3) 多值筛选: difficulty=easy,hard → 4 条 (800/900/2000/2200)
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/preview?difficulty=easy,hard")
        data = r.get_json()
        assert data["n_filtered"] == 4
        assert sorted(data["filters"]["difficulty"]) == ["easy", "hard"]

        # 4) 多维联合: difficulty=hard AND bot_policy=random → 1 条 (2200)
        r = client.get(
            f"/api/spawn-tuning-v2/sample-sets/{sid}/preview"
            "?difficulty=hard&bot_policy=random"
        )
        data = r.get_json()
        assert data["n_filtered"] == 1
        assert data["label_summary"]["final_score"]["mean"] == 2200.0
        assert data["samples"][0]["final_score"] == 2200

        # 5) 全集分布 dim_coverage_all 不随筛选变化
        assert data["dim_coverage_all"]["difficulty"] == {"easy": 2, "normal": 1, "hard": 2}
        # 当前 view 分布 dim_coverage 仅含筛选后
        assert data["dim_coverage"]["difficulty"] == {"hard": 1}

        # 6) 不存在的值 → 0 条不抛错
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/preview?difficulty=nothing")
        assert r.status_code == 200
        assert r.get_json()["n_filtered"] == 0


# ─────────── 系统能力检测 ───────────

class TestSystemDevices:
    """v2.7: device 自动检测 + 推荐 (cuda > mps > cpu)。"""

    def test_devices_endpoint_basic(self, client):
        r = client.get("/api/spawn-tuning-v2/system/devices")
        assert r.status_code == 200
        data = r.get_json()
        assert "devices" in data
        assert "recommended" in data
        # 3 个 device 都返回 (id 固定, 但 available 不同)
        ids = [d["id"] for d in data["devices"]]
        assert ids == ["cuda", "mps", "cpu"]
        # cpu 永远 available
        cpu_dev = next(d for d in data["devices"] if d["id"] == "cpu")
        assert cpu_dev["available"] is True

    def test_recommended_follows_priority(self, client):
        """推荐优先级 cuda > mps > cpu, 实际值取决于运行机器。"""
        data = client.get("/api/spawn-tuning-v2/system/devices").get_json()
        rec = data["recommended"]
        assert rec in ("cuda", "mps", "cpu")
        # recommended 必须是 available 的 device
        rec_dev = next(d for d in data["devices"] if d["id"] == rec)
        assert rec_dev["available"] is True

    def test_label_present(self, client):
        """每个 device 都应有 label, 含可读说明。"""
        data = client.get("/api/spawn-tuning-v2/system/devices").get_json()
        for d in data["devices"]:
            assert "label" in d and len(d["label"]) > 0


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

    def test_delete_model_with_files(self, client, app, tmp_path):
        """v2.8.2: 删除模型 — DB 记录 + .pt + .pt.log 都被删。"""
        db_path = os.environ["SPAWN_TUNING_V2_DB"]
        # 直接写一个含 weights_path 的 staging model
        import sqlite3
        import time
        pt_file = tmp_path / "test_model.pt"
        log_file = tmp_path / "test_model.pt.log"
        pt_file.write_bytes(b"fake weights")
        log_file.write_text('{"epoch":0,"train_loss":0.1}')
        conn = sqlite3.connect(db_path)
        conn.execute(
            "INSERT INTO models (name, model_type, status, weights_path, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            ("del_test", "resnet", "staging", str(pt_file), int(time.time())),
        )
        mid = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()
        conn.close()

        # 调 DELETE
        r = client.delete(f"/api/spawn-tuning-v2/models/{mid}")
        assert r.status_code == 200
        data = r.get_json()
        assert data["ok"] is True
        assert data["deleted_model_id"] == mid
        # 文件应被物理删除
        assert not pt_file.exists()
        assert not log_file.exists()
        assert len(data["deleted_files"]) == 2
        # DB 记录消失
        g = client.get(f"/api/spawn-tuning-v2/models/{mid}")
        assert g.status_code == 404

    def test_delete_deployed_model_blocked(self, client, app):
        """v2.8.2: deployed 模型受保护, 不允许删 (需先 rollback 或 force=1)。"""
        db_path = os.environ["SPAWN_TUNING_V2_DB"]
        mid = self._create_model(client, db_path)
        client.post(f"/api/spawn-tuning-v2/models/{mid}/deploy")
        r = client.delete(f"/api/spawn-tuning-v2/models/{mid}")
        assert r.status_code == 409
        assert "cannot delete" in r.get_json()["error"]
        # force=1 应能强制删
        r2 = client.delete(f"/api/spawn-tuning-v2/models/{mid}?force=1")
        assert r2.status_code == 200

    def test_delete_not_found(self, client):
        r = client.delete("/api/spawn-tuning-v2/models/99999")
        assert r.status_code == 404

    def test_delete_no_weights_file_ok(self, client, app):
        """模型没 weights_path 也不应崩 (deleted_files 空数组)。"""
        db_path = os.environ["SPAWN_TUNING_V2_DB"]
        mid = self._create_model(client, db_path)  # _create_model 不写 weights_path
        r = client.delete(f"/api/spawn-tuning-v2/models/{mid}")
        assert r.status_code == 200
        assert r.get_json()["deleted_files"] == []

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

    def test_delete_job_done(self, client, tmp_path):
        """v2.8.3: 删除 done 任务 — DB 记录 + log 文件都被删。"""
        cr = client.post("/api/spawn-tuning-v2/jobs", json={"sample_set_ids": [1]})
        jid = cr.get_json()["job_id"]
        # 写一个假 log 文件并 PATCH 进 job
        log_file = tmp_path / f"job_{jid}.log"
        log_file.write_text("[fake log]")
        client.patch(f"/api/spawn-tuning-v2/jobs/{jid}",
                     json={"status": "done", "log_path": str(log_file)})

        r = client.delete(f"/api/spawn-tuning-v2/jobs/{jid}")
        assert r.status_code == 200
        data = r.get_json()
        assert data["ok"] is True
        assert data["deleted_job_id"] == jid
        # log 文件应被删除
        assert not log_file.exists()
        # DB 记录消失
        g = client.get(f"/api/spawn-tuning-v2/jobs/{jid}")
        assert g.status_code == 404

    def test_delete_queued_job_ok(self, client):
        """v2.8.4: queued 任务可直接删 (取消排队 — executor 不会再 pick)。"""
        cr = client.post("/api/spawn-tuning-v2/jobs", json={"sample_set_ids": [1]})
        jid = cr.get_json()["job_id"]
        r = client.delete(f"/api/spawn-tuning-v2/jobs/{jid}")
        assert r.status_code == 200
        data = r.get_json()
        assert data["ok"] is True
        assert data["prev_status"] == "queued"
        # 无 running 进程 → kill_info 为 None (没触发 kill)
        assert data["kill_info"] is None

    def test_delete_running_job_attempts_kill(self, client):
        """v2.8.4: running 任务删除时尝试 kill 子进程 (注册表里无该 job → not_running)。"""
        cr = client.post("/api/spawn-tuning-v2/jobs", json={"sample_set_ids": [1]})
        jid = cr.get_json()["job_id"]
        client.patch(f"/api/spawn-tuning-v2/jobs/{jid}", json={"status": "running"})
        r = client.delete(f"/api/spawn-tuning-v2/jobs/{jid}")
        assert r.status_code == 200
        data = r.get_json()
        assert data["prev_status"] == "running"
        # 因为本测试中 executor 未真正启动 (subprocess), 注册表里没有该 job → kill_info 报 not_running
        assert data["kill_info"] is not None
        assert data["kill_info"]["action"] in ("not_running", "already_exited")

    def test_delete_job_not_found(self, client):
        r = client.delete("/api/spawn-tuning-v2/jobs/99999")
        assert r.status_code == 404

    def test_delete_failed_job_ok(self, client):
        """failed 状态可以删 (无 log_path 也不应崩)。"""
        cr = client.post("/api/spawn-tuning-v2/jobs", json={"sample_set_ids": [1]})
        jid = cr.get_json()["job_id"]
        client.patch(f"/api/spawn-tuning-v2/jobs/{jid}",
                     json={"status": "failed", "error_message": "OOM"})
        r = client.delete(f"/api/spawn-tuning-v2/jobs/{jid}")
        assert r.status_code == 200
        assert r.get_json()["deleted_files"] == []


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


# ─────────── PR6: 离线 Bundle Export ───────────

class TestBundleExport:
    def _make_policies_file(self, tmp_path):
        """构造一个最简 policies-*.json (来自 optimize_theta.py 的输出格式)"""
        p = tmp_path / "policies.json"
        p.write_text(json.dumps({
            "format": "openblock-spawn-tuning-v2-policies",
            "version": "2.0.0",
            "model_sha256": "x" * 64,
            "n_contexts": 2,
            "policies": [
                {
                    "context_key": "easy:budget-p2:random:500:growth",
                    "context": {"difficulty": "easy"},
                    "theta": {"personalizationStrength": 0.10},
                    "predicted_curve": [0.2] * 20,
                    "expected": {"pb_broke": 0.1},
                },
                {
                    "context_key": "hard:budget-p2:survival:25000:plateau",
                    "context": {"difficulty": "hard"},
                    "theta": {"personalizationStrength": 0.15},
                    "predicted_curve": [0.5] * 20,
                    "expected": {"pb_broke": 0.4},
                },
            ],
        }))
        return p

    def test_export_basic(self, client, tmp_path):
        src = self._make_policies_file(tmp_path)
        r = client.post(
            "/api/spawn-tuning-v2/policies/bundle/export",
            json={"source": str(src), "rollout_pct": 50, "include_miniprogram": False},
        )
        assert r.status_code == 200
        data = r.get_json()
        assert data["ok"] is True
        assert data["policies_count"] == 2
        assert len(data["sha256"]) == 64
        # 文件落地
        assert any("web/public/spawn-tuning-v2/policies.json" in w for w in data["written"])
        # 清理
        from pathlib import Path
        Path("web/public/spawn-tuning-v2/policies.json").unlink(missing_ok=True)
        Path("web/public/spawn-tuning-v2/policies.meta.json").unlink(missing_ok=True)

    def test_export_invalid_format(self, client, tmp_path):
        bad = tmp_path / "bad.json"
        bad.write_text('{"format": "wrong"}')
        r = client.post(
            "/api/spawn-tuning-v2/policies/bundle/export",
            json={"source": str(bad)},
        )
        assert r.status_code == 400
        assert "unsupported format" in r.get_json()["error"]

    def test_export_missing_source(self, client):
        r = client.post("/api/spawn-tuning-v2/policies/bundle/export", json={})
        assert r.status_code == 400

    def test_bundle_status_no_bundle(self, client):
        # 清理可能残留的 bundle
        from pathlib import Path
        Path("web/public/spawn-tuning-v2/policies.json").unlink(missing_ok=True)
        Path("web/public/spawn-tuning-v2/policies.meta.json").unlink(missing_ok=True)
        r = client.get("/api/spawn-tuning-v2/policies/bundle/status")
        assert r.status_code == 200
        assert r.get_json()["exists"] is False


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
        assert data["metadata"]["version"] == "v2.3.0"

    def test_active_policies_none(self, client):
        r = client.get("/api/spawn-tuning-v2/policies/active")
        assert r.status_code == 200
        assert r.get_json()["deployed"] is None


# ─────────── predict-curve (v2.9.2 双架构修复) ───────────

class TestPredictCurve:
    """v2.9.2: predict_curve 端点必须按 arch.model_type 选模型构造,
    transformer ckpt 不能再走 SpawnParamTunerResNet() → load_state_dict 抛异常的死路。

    回归覆盖: image-4c5e0c28 截图中的 "模型推断失败: HTTP 500" 根因。
    """

    def _save_real_ckpt(self, tmp_path, model_type: str):
        """构造一个真实 ckpt + sidecar 文件用于 backend 加载。"""
        import torch
        from rl_pytorch.spawn_tuning_v2.model import (
            SpawnParamTunerResNet, SpawnParamTunerTransformer,
        )
        from rl_pytorch.spawn_tuning_v2.train import _save_checkpoint
        m = SpawnParamTunerTransformer() if model_type == "transformer" else SpawnParamTunerResNet()
        out = tmp_path / f"{model_type}.pt"
        _save_checkpoint(
            model=m, path=str(out),
            metrics={"val_curve_mae": 0.1},
            base_model_path=None, sample_set_ids=[1],
        )
        return out

    def _insert_model_row(self, client, weights_path: str, model_type: str) -> int:
        """直接 SQLite INSERT 一个 models 记录, 跳过 jobs 流程。"""
        import spawn_tuning_v2_backend as mod
        db = mod.get_db()
        cur = db.execute(
            """INSERT INTO models (
                name, version, model_type, weights_path, sha256, size_bytes,
                metrics_json, status, created_at
            ) VALUES (?, 'v0.0.1', ?, ?, '', 0, '{}', 'staging', strftime('%s','now'))""",
            (f"test-{model_type}", model_type, weights_path),
        )
        db.commit()
        mid = cur.lastrowid
        db.close()
        return mid

    def _ctx(self):
        return {
            "difficulty": "normal",
            "generator": "triplet-p1",
            "bot_policy": "clear-greedy",
            "pb_bin": 1500,
            "lifecycle_stage": "growth",
        }

    def test_predict_resnet_model(self, client, tmp_path):
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, str(ckpt), "resnet")
        r = client.post(
            f"/api/spawn-tuning-v2/models/{mid}/predict-curve",
            json={"contexts": [self._ctx()]},
        )
        assert r.status_code == 200, r.get_json()
        data = r.get_json()
        assert data["n_contexts"] == 1
        assert len(data["curves"]) == 1
        assert len(data["curves"][0]) == 20  # N_CURVE_BINS
        for v in data["curves"][0]:
            assert 0.0 <= v <= 1.0

    def test_predict_transformer_model(self, client, tmp_path):
        """v2.9.2 核心: transformer ckpt 推断不能再 500。"""
        ckpt = self._save_real_ckpt(tmp_path, "transformer")
        mid = self._insert_model_row(client, str(ckpt), "transformer")
        r = client.post(
            f"/api/spawn-tuning-v2/models/{mid}/predict-curve",
            json={"contexts": [self._ctx()]},
        )
        assert r.status_code == 200, r.get_json()
        data = r.get_json()
        assert data["n_contexts"] == 1
        assert len(data["curves"]) == 1
        assert len(data["curves"][0]) == 20

    def test_predict_multi_contexts(self, client, tmp_path):
        ckpt = self._save_real_ckpt(tmp_path, "transformer")
        mid = self._insert_model_row(client, str(ckpt), "transformer")
        ctxs = [self._ctx() for _ in range(4)]
        r = client.post(
            f"/api/spawn-tuning-v2/models/{mid}/predict-curve",
            json={"contexts": ctxs},
        )
        assert r.status_code == 200
        assert r.get_json()["n_contexts"] == 4
        assert len(r.get_json()["curves"]) == 4

    def test_predict_missing_contexts(self, client, tmp_path):
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, str(ckpt), "resnet")
        r = client.post(
            f"/api/spawn-tuning-v2/models/{mid}/predict-curve",
            json={},
        )
        assert r.status_code == 400
        assert "contexts" in r.get_json()["error"]

    def test_predict_invalid_context(self, client, tmp_path):
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, str(ckpt), "resnet")
        bad = self._ctx()
        bad["bot_policy"] = "non-existent-bot"
        r = client.post(
            f"/api/spawn-tuning-v2/models/{mid}/predict-curve",
            json={"contexts": [bad]},
        )
        assert r.status_code == 400
        assert "invalid context" in r.get_json()["error"]

    def test_predict_model_not_found(self, client):
        r = client.post(
            "/api/spawn-tuning-v2/models/99999/predict-curve",
            json={"contexts": [self._ctx()]},
        )
        assert r.status_code == 404


# ─────────── build-and-export (v2.10.4 一键导出) ───────────

class TestBuildAndExport:
    """v2.10.4: 一键构建 policies.json + 导出 bundle。

    回归覆盖: image-a077e1b3 截图 HTTP 404 根因 —
    老 export_bundle 要求 source 文件先存在, 前端没暴露生成 policies.json
    的步骤 → 用户点导出按钮永远 404。
    """

    def _save_real_ckpt(self, tmp_path, model_type="resnet"):
        from rl_pytorch.spawn_tuning_v2.model import SpawnParamTunerResNet, SpawnParamTunerTransformer
        from rl_pytorch.spawn_tuning_v2.train import _save_checkpoint
        m = SpawnParamTunerTransformer() if model_type == "transformer" else SpawnParamTunerResNet()
        out = tmp_path / f"{model_type}_test.pt"
        _save_checkpoint(
            model=m, path=str(out),
            metrics={"val_curve_mae": 0.1},
            base_model_path=None, sample_set_ids=[1],
        )
        return out

    def _insert_model_row(self, client, weights_path, model_type="resnet"):
        import spawn_tuning_v2_backend as mod
        db = mod.get_db()
        cur = db.execute(
            """INSERT INTO models (
                name, version, model_type, weights_path, sha256, size_bytes,
                metrics_json, status, created_at
            ) VALUES (?, 'v0.0.1', ?, ?, 'abc123', 1024, '{}', 'staging', strftime('%s','now'))""",
            (f"test-{model_type}", model_type, str(weights_path)),
        )
        db.commit()
        mid = cur.lastrowid
        db.close()
        return mid

    def test_build_and_export_resnet(self, client, tmp_path, monkeypatch):
        """ResNet 模型一键导出 — 360 policies, web/miniprogram bundle 都写出。"""
        # 切换工作目录避免污染真实 web/public
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 50, "include_miniprogram": True},
        )
        assert r.status_code == 200, r.get_json()
        d = r.get_json()
        assert d["ok"] is True
        assert d["policies_count"] == 360  # 3 difficulty × 2 generator × 3 bot × 5 pb × 4 lifecycle
        assert d["rollout_pct"] == 50
        assert d["bundle_size_bytes"] > 1000
        # 三类文件都写了
        written = d["written"]
        assert any(p.endswith(".policies.json") for p in written)
        assert any("policies.json" in p and "spawn-tuning-v2" in p for p in written)
        assert any(p.endswith("spawnPoliciesV2.js") for p in written)
        # 文件确实在硬盘上
        for p in written:
            assert Path(p).exists(), f"missing: {p}"

    def test_build_and_export_transformer(self, client, tmp_path, monkeypatch):
        """Transformer 也能正常推断 + 导出 (双架构兼容)。"""
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "transformer")
        mid = self._insert_model_row(client, ckpt, "transformer")
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 100},
        )
        assert r.status_code == 200, r.get_json()
        assert r.get_json()["policies_count"] == 360

    def test_build_and_export_model_not_found(self, client, tmp_path, monkeypatch):
        monkeypatch.chdir(tmp_path)
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": 99999, "rollout_pct": 10},
        )
        assert r.status_code == 404

    def test_build_and_export_skip_miniprogram(self, client, tmp_path, monkeypatch):
        """include_miniprogram=false 时不写 miniprogram 文件。"""
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 10, "include_miniprogram": False},
        )
        assert r.status_code == 200
        written = r.get_json()["written"]
        # 不应有 miniprogram 文件
        assert not any("spawnPoliciesV2.js" in p for p in written)
        # web bundle 必须有
        assert any("policies.json" in p and "spawn-tuning-v2" in p for p in written)

    def test_build_and_export_missing_model_id(self, client):
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={},
        )
        assert r.status_code == 400
        assert "model_id" in r.get_json()["error"]

    def test_build_and_export_monotonic_projection(self, client, tmp_path, monkeypatch):
        """v2.10.7: 默认应用 PAVA 单调投影 — bundle 中所有 predicted_curve 严格单调。"""
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 10},
        )
        assert r.status_code == 200
        d = r.get_json()
        assert d["monotonic_projection_applied"] is True
        # 读 bundle, 验证每个 curve 都单调
        bundle_path = tmp_path / "web/public/spawn-tuning-v2/policies.json"
        bundle = json.loads(bundle_path.read_text())
        for p in bundle["policies"]:
            curve = p["predicted_curve"]
            for i in range(1, len(curve)):
                assert curve[i] >= curve[i-1] - 1e-9, \
                    f"non-monotonic at bin {i} in {p['context_key']}: {curve}"

    def test_build_and_export_skip_monotonic(self, client, tmp_path, monkeypatch):
        """monotonic_projection=false 时不强制单调 (允许原始预测)。"""
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 10, "monotonic_projection": False},
        )
        assert r.status_code == 200
        assert r.get_json()["monotonic_projection_applied"] is False
