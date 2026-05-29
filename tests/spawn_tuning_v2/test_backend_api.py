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
    # 行为样本集 (list 注入) 读主库 OPENBLOCK_DB_PATH — 隔离到独立空库, 让 v2 测试确定性,
    # 不受仓库 openblock.db 是否已回填行为样本影响。fact-eval 读 v2 samples 表, 与此无关。
    with tempfile.NamedTemporaryFile(suffix=".main.db", delete=False) as f2:
        main_db_path = f2.name
    os.unlink(main_db_path)
    _prev_main = os.environ.get("OPENBLOCK_DB_PATH")
    os.environ["SPAWN_TUNING_V2_DB"] = db_path
    os.environ["OPENBLOCK_DB_PATH"] = main_db_path
    os.environ["SPAWN_TUNING_V2_DISABLE_EXECUTOR"] = "1"   # 测试时禁掉后台 worker

    # 强制 reimport (因为 module-level 读取 DB_PATH)
    import importlib
    from backend import spawn_tuning_v2_backend as mod
    importlib.reload(mod)

    flask_app = Flask(__name__)
    mod.register_v2_routes(flask_app)
    flask_app.config["TESTING"] = True

    yield flask_app

    if _prev_main is None:
        os.environ.pop("OPENBLOCK_DB_PATH", None)
    else:
        os.environ["OPENBLOCK_DB_PATH"] = _prev_main
    for _p in (db_path, main_db_path):
        try:
            os.unlink(_p)
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
            "difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
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

    def test_scatter_schema_v3022(self, client):
        """v3.0.22: /scatter 返回固定 4 元组 [r, d_obs, d_pred_or_null, dim_key] + schema 字段."""
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "scatter"})
        sid = cr.get_json()["set_id"]
        # 准备 bin_counts_json 让 sample 真实可被打点 (final_bin 需有真实观察)
        from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector
        sample = {
            "difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
            "pb_bin": 1500, "lifecycle_stage": "growth",
            "theta_json": {"personalizationStrength": 0.10, "temperature": 0.05},
            "d_curve_json": target_curve_vector(),
            "bin_counts": [1] * 20,   # 每 bin 都有真实观察 ⇒ final_bin 不被过滤
            "final_score": 1200, "survived_steps": 50,
            "clear_rate": 0.5, "noMove_step": -1, "pb_broke": False,
            "surprise_count": 2, "seed": 42,
        }
        client.post(
            f"/api/spawn-tuning-v2/sample-sets/{sid}/samples",
            json={"samples": [sample, sample, sample]},
        )
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/scatter")
        assert r.status_code == 200
        data = r.get_json()
        assert data["schema"] == "v3.0.22"
        assert data["with_prediction"] is False
        assert len(data["points"]) == 3
        for p in data["points"]:
            # v3.0.22 固定 4 元组: [r, d_obs, d_pred_or_null, dim_key]
            assert len(p) == 4
            assert isinstance(p[0], (int, float))   # r
            assert isinstance(p[1], (int, float))   # d_obs
            assert p[2] is None                       # d_pred = null (无 model_id)
            assert isinstance(p[3], str) and p[3].count("|") == 4   # dim_key
            # dim_key 格式校验
            parts = p[3].split("|")
            assert parts[0] == "normal"
            assert parts[1] == "rule"
            assert parts[2] == "clear-greedy"
            assert parts[3] == "1500"
            assert parts[4] == "growth"

    def test_scatter_dim_filter(self, client):
        """v3.0.22: /scatter 支持 difficulty / generator 等维度筛选."""
        cr = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "scatter_filter"})
        sid = cr.get_json()["set_id"]
        from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector
        base = {
            "generator": "rule", "bot_policy": "clear-greedy",
            "pb_bin": 1500, "lifecycle_stage": "growth",
            "theta_json": {"personalizationStrength": 0.10},
            "d_curve_json": target_curve_vector(),
            "bin_counts": [1] * 20,
            "final_score": 1200, "survived_steps": 50,
            "clear_rate": 0.5, "noMove_step": -1, "pb_broke": False,
            "surprise_count": 2, "seed": 42,
        }
        mix = [
            {**base, "difficulty": "easy"},
            {**base, "difficulty": "normal"},
            {**base, "difficulty": "hard"},
            {**base, "difficulty": "hard"},
        ]
        client.post(
            f"/api/spawn-tuning-v2/sample-sets/{sid}/samples",
            json={"samples": mix},
        )
        # 全量
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/scatter")
        assert len(r.get_json()["points"]) == 4
        # 仅 hard
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{sid}/scatter?difficulty=hard")
        data = r.get_json()
        assert len(data["points"]) == 2
        for p in data["points"]:
            assert p[3].split("|")[0] == "hard"

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

    def test_list_models_pagination(self, client):
        """v2.10.12: list_models 支持 offset / total."""
        db_path = os.environ["SPAWN_TUNING_V2_DB"]
        for _ in range(4):
            self._create_model(client, db_path)
        r1 = client.get("/api/spawn-tuning-v2/models?limit=2&offset=0")
        d1 = r1.get_json()
        assert d1["total"] >= 4
        assert d1["count"] == 2
        assert d1["limit"] == 2
        assert d1["offset"] == 0
        r2 = client.get("/api/spawn-tuning-v2/models?limit=2&offset=2")
        d2 = r2.get_json()
        assert d2["count"] == 2
        ids1 = {m["model_id"] for m in d1["models"]}
        ids2 = {m["model_id"] for m in d2["models"]}
        assert ids1.isdisjoint(ids2)

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
    def test_list_jobs_pagination(self, client):
        """v2.10.12: list_jobs 支持 offset / total 分页。"""
        # 创建 5 个 job
        for i in range(5):
            client.post(
                "/api/spawn-tuning-v2/jobs",
                json={"name": f"j{i}", "sample_set_ids": [1], "model_type": "resnet"},
            )
        # 第 1 页, 每页 2 个
        r1 = client.get("/api/spawn-tuning-v2/jobs?limit=2&offset=0")
        d1 = r1.get_json()
        assert d1["total"] >= 5
        assert d1["count"] == 2
        assert d1["limit"] == 2
        assert d1["offset"] == 0
        # 第 2 页
        r2 = client.get("/api/spawn-tuning-v2/jobs?limit=2&offset=2")
        d2 = r2.get_json()
        assert d2["count"] == 2
        assert d2["offset"] == 2
        # 第 2 页跟第 1 页 job_id 不同
        ids1 = {j["job_id"] for j in d1["jobs"]}
        ids2 = {j["job_id"] for j in d2["jobs"]}
        assert ids1.isdisjoint(ids2)

    def test_list_jobs_invalid_limit(self, client):
        r = client.get("/api/spawn-tuning-v2/jobs?limit=abc")
        assert r.status_code == 400

    def test_list_jobs_offset_negative_clamped(self, client):
        """offset < 0 应被 clamp 到 0, 不报错."""
        r = client.get("/api/spawn-tuning-v2/jobs?offset=-5")
        # max(0, -5) = 0 → 不报错
        assert r.status_code == 200
        assert r.get_json()["offset"] == 0

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
    def _make_episode(self, ctx_key="normal:rule:clear-greedy:1500:growth", pb=1500):
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
        eps1 = [self._make_episode("easy:rule:random:500:growth") for _ in range(5)]
        eps2 = [self._make_episode("hard:rule:survival:25000:plateau") for _ in range(3)]
        client.post("/api/spawn-tuning-v2/field-metrics", json={"episodes": eps1 + eps2})
        r = client.get(
            "/api/spawn-tuning-v2/field-metrics/aggregate?"
            "hours=24&context_key=hard:rule:survival:25000:plateau"
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
                    "context_key": "easy:rule:random:500:growth",
                    "context": {"difficulty": "easy"},
                    "theta": {"personalizationStrength": 0.10},
                    "predicted_curve": [0.2] * 20,
                    "expected": {"pb_broke": 0.1},
                },
                {
                    "context_key": "hard:rule:survival:25000:plateau",
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
        assert data["metadata"]["version"] == "v2.6.0"

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
        from backend import spawn_tuning_v2_backend as mod
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
            "generator": "rule",
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
        from backend import spawn_tuning_v2_backend as mod
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

    def test_build_and_export_optimize_theta_writes_best_theta(self, client, tmp_path, monkeypatch):
        """v3.0.6 (G1): optimize_theta=true 时, bundle 每个 policy 的 theta_norm 不是默认 0.5,
        而是 surrogate 寻参得到的 best θ*; build_mode 标记为 model-inference-best-theta."""
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={
                "model_id": mid,
                "rollout_pct": 50,
                "include_miniprogram": False,
                "optimize_theta": True,
                # 用最小配置保证测试不超时 (1 starts × 20 steps, 360 ctx ≈ 2-5s)
                "opt_n_starts": 1,
                "opt_steps": 20,
            },
        )
        assert r.status_code == 200, r.get_json()
        d = r.get_json()
        assert d["ok"] is True
        # 读 policies.json sidecar 检查 theta_norm 不是全 0.5
        policies_path = next(Path(p) for p in d["written"] if p.endswith(".policies.json"))
        doc = json.loads(policies_path.read_text(encoding="utf-8"))
        # v3.0.11: 新 ckpt 含 theta_optim 表 → 走联合寻参快速路径; 老 ckpt fallback surrogate
        assert doc["build_mode"] in ("model-joint-trained-theta", "model-inference-best-theta")
        # build_mode = joint-trained 时, theta_norm 是 sigmoid(0) = 0.5 的初始值 (因 fixture model 未训过)
        # build_mode = best-theta (surrogate) 时, Adam 会让 θ 偏离 0.5. 两种情况都能 pass.
        if doc["build_mode"] == "model-inference-best-theta":
            n_non_default = sum(
                1 for p in doc["policies"]
                if any(abs(t - 0.5) > 0.01 for t in p["theta_norm"])
            )
            assert n_non_default > 0, "surrogate 模式应至少有 1 个 policy 的 θ 偏离默认 0.5"

    def test_build_and_export_default_uses_default_theta(self, client, tmp_path, monkeypatch):
        """v3.0.6 (G1): 不传 optimize_theta 时默认为 False (兼容老 caller),
        bundle 的 theta_norm 全部 = 0.5, build_mode = model-inference-default-theta."""
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 50, "include_miniprogram": False},
        )
        assert r.status_code == 200, r.get_json()
        d = r.get_json()
        policies_path = next(Path(p) for p in d["written"] if p.endswith(".policies.json"))
        doc = json.loads(policies_path.read_text(encoding="utf-8"))
        assert doc["build_mode"] == "model-inference-default-theta"
        from rl_pytorch.spawn_tuning_v2.model import N_THETA
        for p in doc["policies"]:
            assert p["theta_norm"] == [0.5] * N_THETA

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

    def test_build_and_export_auto_deploys_and_active_api_returns_it(
        self, client, tmp_path, monkeypatch,
    ):
        """v2.10.9: D.1 导出 bundle 默认 auto_deploy=True →
        models.status='deployed' → /policies/active 立即返回该 model。

        修复"状态不同步：模型已部署，但 dashboard 显示无部署"用户截图问题。
        """
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")

        # 导出前：active = None
        r0 = client.get("/api/spawn-tuning-v2/policies/active")
        assert r0.get_json()["deployed"] is None

        # 导出 (默认 auto_deploy=True)
        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 100},
        )
        assert r.status_code == 200
        deploy = r.get_json()["deploy"]
        assert deploy["auto_deploy"] is True
        assert deploy["deployed"] is True
        assert "deployed_at" in deploy

        # 导出后：active 立即返回该 model
        r2 = client.get("/api/spawn-tuning-v2/policies/active")
        active = r2.get_json()["deployed"]
        assert active is not None, "/policies/active 应在 build-and-export 后立即返回 deployed model"
        assert active["model_id"] == mid
        assert active["status"] == "deployed"

    def test_build_and_export_with_auto_deploy_false_keeps_status(
        self, client, tmp_path, monkeypatch,
    ):
        """v2.10.9: 显式 auto_deploy=False 时 bundle 写盘但 status 不变 → /active 仍为 None
        (用于先 shadow 验证后再手动 deploy 的高级流程)。
        """
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")

        r = client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 100, "auto_deploy": False},
        )
        assert r.status_code == 200
        deploy = r.get_json()["deploy"]
        assert deploy["auto_deploy"] is False
        assert deploy["deployed"] is False

        # /active 仍返回 None
        r2 = client.get("/api/spawn-tuning-v2/policies/active")
        assert r2.get_json()["deployed"] is None

    def test_bundle_status_consistency_no_deployment(
        self, client, tmp_path, monkeypatch,
    ):
        """v2.10.10: bundle 文件不存在 + DB 无 deployed → state='no-deployment'。"""
        monkeypatch.chdir(tmp_path)
        r = client.get("/api/spawn-tuning-v2/policies/bundle/status")
        assert r.status_code == 200
        body = r.get_json()
        assert body["exists"] is False
        assert body["consistency"]["state"] == "no-deployment"

    def test_bundle_status_consistency_in_sync_after_export(
        self, client, tmp_path, monkeypatch,
    ):
        """v2.10.10: D.1 export 后 bundle_model_id == deployed_model_id → state='in-sync'。"""
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")
        client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 100},
        )
        r = client.get("/api/spawn-tuning-v2/policies/bundle/status")
        body = r.get_json()
        assert body["exists"] is True
        cons = body["consistency"]
        assert cons["state"] == "in-sync"
        assert cons["bundle_model_id"] == mid
        assert cons["deployed_model_id"] == mid

    def test_bundle_status_consistency_deployed_but_no_bundle(
        self, client, tmp_path, monkeypatch,
    ):
        """v2.10.10: bundle 文件被删但 DB 仍 deployed → state='deployed-but-no-bundle' + hint。

        这正是用户截图场景（"未导出"卡片 vs "当前生效模型 #22"卡片分裂）。
        """
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")
        client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 100},
        )
        # 模拟"bundle 被外部清理"：删除 bundle 文件，但不动 DB
        import shutil
        bundle_dir = tmp_path / "web/public/spawn-tuning-v2"
        if bundle_dir.exists():
            shutil.rmtree(bundle_dir)

        r = client.get("/api/spawn-tuning-v2/policies/bundle/status")
        body = r.get_json()
        assert body["exists"] is False
        cons = body["consistency"]
        assert cons["state"] == "deployed-but-no-bundle"
        assert cons["deployed_model_id"] == mid
        assert cons["bundle_model_id"] is None
        assert "已部署" in cons["hint"] and "缺失" in cons["hint"]

    def test_bundle_status_consistency_bundle_but_not_deployed(
        self, client, tmp_path, monkeypatch,
    ):
        """v2.10.10: bundle 存在但 DB 无 deployed（rollback 后未清盘）→ state='bundle-but-not-deployed'。"""
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid = self._insert_model_row(client, ckpt, "resnet")
        client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid, "rollout_pct": 100},
        )
        # rollback：把 deployed 改 rollbacked，但 bundle 文件保留
        client.post(f"/api/spawn-tuning-v2/models/{mid}/rollback")

        r = client.get("/api/spawn-tuning-v2/policies/bundle/status")
        body = r.get_json()
        assert body["exists"] is True
        cons = body["consistency"]
        assert cons["state"] == "bundle-but-not-deployed"
        assert cons["bundle_model_id"] == mid
        assert cons["deployed_model_id"] is None

    def test_build_and_export_archives_previous_deployed(
        self, client, tmp_path, monkeypatch,
    ):
        """v2.10.9: 部署新 model 时旧 deployed model 应被自动 archive
        (与 /models/<id>/deploy 同语义，确保单 deployed 不变)。
        """
        monkeypatch.chdir(tmp_path)
        ckpt = self._save_real_ckpt(tmp_path, "resnet")
        mid_a = self._insert_model_row(client, ckpt, "resnet")
        mid_b = self._insert_model_row(client, ckpt, "resnet")

        # 先 deploy A
        client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid_a, "rollout_pct": 100},
        )
        # 再 deploy B（触发 auto_deploy）
        client.post(
            "/api/spawn-tuning-v2/policies/build-and-export",
            json={"model_id": mid_b, "rollout_pct": 100},
        )

        # active 应是 B，A 被 archive
        r = client.get("/api/spawn-tuning-v2/policies/active")
        active = r.get_json()["deployed"]
        assert active["model_id"] == mid_b

        # 直接查 A 的 status
        ra = client.get(f"/api/spawn-tuning-v2/models/{mid_a}")
        assert ra.get_json()["status"] == "archived"


# ─────────── 业务评分 / 多 ctx 对比 / group_by (v2.10.19) ───────────

class TestBizScorecard:
    """G15: 业务命题达成度评分 - 4 维度 (balance/tension/fairness/surprise) + 总分."""

    def _setup_model(self, client, tmp_path, model_type="resnet"):
        from rl_pytorch.spawn_tuning_v2.model import SpawnParamTunerResNet, SpawnParamTunerTransformer
        from rl_pytorch.spawn_tuning_v2.train import _save_checkpoint
        m = SpawnParamTunerTransformer() if model_type == "transformer" else SpawnParamTunerResNet()
        out = tmp_path / f"{model_type}_biz.pt"
        _save_checkpoint(
            model=m, path=str(out),
            metrics={"val_curve_mae": 0.1},
            base_model_path=None, sample_set_ids=[1],
        )
        from backend import spawn_tuning_v2_backend as mod
        db = mod.get_db()
        cur = db.execute(
            """INSERT INTO models (
                name, version, model_type, weights_path, sha256, size_bytes,
                metrics_json, status, created_at
            ) VALUES (?, 'v0.0.1', ?, ?, '', 1024, '{}', 'staging', strftime('%s','now'))""",
            (f"test-{model_type}", model_type, str(out)),
        )
        db.commit()
        mid = cur.lastrowid
        db.close()
        return mid

    def test_biz_scorecard_resnet(self, client, tmp_path):
        mid = self._setup_model(client, tmp_path, "resnet")
        r = client.get(f"/api/spawn-tuning-v2/models/{mid}/biz-scorecard")
        assert r.status_code == 200
        d = r.get_json()
        assert "overall_score" in d
        assert d["grade"] in ("A", "B", "C", "D")
        # 四维必有
        for k in ("balance", "tension", "fairness", "surprise"):
            assert k in d["dimensions"]
            assert 0 <= d["dimensions"][k]["score"] <= 100
        assert d["n_contexts_evaluated"] == 360
        assert isinstance(d["hints"], list) and len(d["hints"]) > 0

    def test_biz_scorecard_transformer(self, client, tmp_path):
        mid = self._setup_model(client, tmp_path, "transformer")
        r = client.get(f"/api/spawn-tuning-v2/models/{mid}/biz-scorecard")
        assert r.status_code == 200

    def test_biz_scorecard_model_not_found(self, client):
        r = client.get("/api/spawn-tuning-v2/models/99999/biz-scorecard")
        assert r.status_code == 404

    def test_biz_scorecard_score_in_range(self, client, tmp_path):
        """所有维度评分应在 [0, 100], 总分跟权重一致."""
        mid = self._setup_model(client, tmp_path, "resnet")
        r = client.get(f"/api/spawn-tuning-v2/models/{mid}/biz-scorecard")
        d = r.get_json()
        # 总分 = 0.4*balance + 0.3*tension + 0.2*fairness + 0.1*surprise
        expected = (
            0.40 * d["dimensions"]["balance"]["score"]
            + 0.30 * d["dimensions"]["tension"]["score"]
            + 0.20 * d["dimensions"]["fairness"]["score"]
            + 0.10 * d["dimensions"]["surprise"]["score"]
        )
        assert abs(d["overall_score"] - expected) < 0.5


class TestFieldMetricsGroupBy:
    """G19: field-metrics 按 ctx 维度拆解."""

    def test_group_by_invalid_dim(self, client):
        r = client.get("/api/spawn-tuning-v2/field-metrics/aggregate?group_by=invalid")
        assert r.status_code == 400
        assert "group_by" in r.get_json()["error"]

    def test_group_by_no_data(self, client):
        """无数据时返回 n_episodes=0, 不报错."""
        r = client.get("/api/spawn-tuning-v2/field-metrics/aggregate?group_by=difficulty")
        assert r.status_code == 200
        d = r.get_json()
        assert d["n_episodes"] == 0

    def test_group_by_valid_dims(self, client):
        for dim in ["difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage"]:
            r = client.get(f"/api/spawn-tuning-v2/field-metrics/aggregate?group_by={dim}")
            assert r.status_code == 200


# ─────────── jobs 创建架构兼容检查 (v2.10.10) ───────────

class TestJobArchCheck:
    """v2.10.10: 增量训练 base_model 跟 model_type 必须匹配 (fail-fast)。"""

    def _insert_model(self, client, model_type):
        from backend import spawn_tuning_v2_backend as mod
        db = mod.get_db()
        cur = db.execute(
            """INSERT INTO models (
                name, version, model_type, weights_path, sha256, size_bytes,
                metrics_json, status, created_at
            ) VALUES (?, 'v0.0.1', ?, '/tmp/fake.pt', 'abc', 1024, '{}', 'staging', strftime('%s','now'))""",
            (f"test-{model_type}", model_type),
        )
        db.commit()
        mid = cur.lastrowid
        db.close()
        return mid

    def test_same_arch_ok(self, client):
        """ResNet base_model + resnet model_type → 201 OK."""
        mid = self._insert_model(client, "resnet")
        r = client.post(
            "/api/spawn-tuning-v2/jobs",
            json={"sample_set_ids": [1], "model_type": "resnet", "base_model_id": mid},
        )
        assert r.status_code == 201

    def test_transformer_to_resnet_rejected(self, client):
        """Transformer base_model + resnet model_type → 400 拒绝."""
        mid = self._insert_model(client, "transformer")
        r = client.post(
            "/api/spawn-tuning-v2/jobs",
            json={"sample_set_ids": [1], "model_type": "resnet", "base_model_id": mid},
        )
        assert r.status_code == 400
        err = r.get_json()["error"]
        assert "transformer" in err.lower()
        assert "resnet" in err.lower()

    def test_resnet_to_transformer_rejected(self, client):
        """ResNet base_model + transformer model_type → 400."""
        mid = self._insert_model(client, "resnet")
        r = client.post(
            "/api/spawn-tuning-v2/jobs",
            json={"sample_set_ids": [1], "model_type": "transformer", "base_model_id": mid},
        )
        assert r.status_code == 400

    def test_no_base_model_no_check(self, client):
        """没选 base_model 时不做架构检查 (从头训练任何架构都行)。"""
        r = client.post(
            "/api/spawn-tuning-v2/jobs",
            json={"sample_set_ids": [1], "model_type": "transformer"},
        )
        assert r.status_code == 201

    def test_unknown_base_model_404(self, client):
        r = client.post(
            "/api/spawn-tuning-v2/jobs",
            json={"sample_set_ids": [1], "model_type": "resnet", "base_model_id": 99999},
        )
        assert r.status_code == 404


# ─────────── 样本集下载 (v2.10.16) ───────────

class TestSampleSetDownload:
    """v2.10.16: GET /sample-sets/<id>/download — JSONL / JSON, 可选 gzip."""

    def _setup_set_with_samples(self, client, n_samples=5):
        # 创建样本集
        r = client.post("/api/spawn-tuning-v2/sample-sets", json={"name": "dl-test"})
        set_id = r.get_json()["set_id"]
        # 注入样本
        samples = [{
            "difficulty": "normal", "generator": "rule", "bot_policy": "clear-greedy",
            "pb_bin": 4000, "lifecycle_stage": "mature",
            "theta_json": json.dumps({"pbTensionCenter": 0.5}),
            "d_curve_json": json.dumps([0.4] * 20),
            "final_score": 2000, "pb_broke": False, "survived_steps": 50,
        } for _ in range(n_samples)]
        client.post(f"/api/spawn-tuning-v2/sample-sets/{set_id}/samples", json={"samples": samples})
        return set_id

    def test_download_jsonl_basic(self, client):
        set_id = self._setup_set_with_samples(client, n_samples=3)
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{set_id}/download?format=jsonl")
        assert r.status_code == 200
        assert "attachment" in r.headers["Content-Disposition"]
        assert "application/x-ndjson" in r.content_type
        lines = r.data.decode("utf-8").strip().split("\n")
        # 第 1 行 = meta, 后续 = sample
        assert len(lines) == 4   # 1 meta + 3 samples
        first = json.loads(lines[0])
        assert first["type"] == "meta"
        assert first["set"]["set_id"] == set_id
        # 第 2 行 = sample
        s0 = json.loads(lines[1])
        assert s0["difficulty"] == "normal"
        assert s0["pb_bin"] == 4000

    def test_download_json_basic(self, client):
        set_id = self._setup_set_with_samples(client, n_samples=2)
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{set_id}/download?format=json")
        assert r.status_code == 200
        d = json.loads(r.data.decode("utf-8"))
        assert d["set"]["set_id"] == set_id
        assert len(d["samples"]) == 2
        assert d["samples"][0]["difficulty"] == "normal"

    def test_download_gzip(self, client):
        set_id = self._setup_set_with_samples(client, n_samples=10)
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{set_id}/download?format=jsonl&gzip=1")
        assert r.status_code == 200
        assert "application/gzip" in r.content_type
        # gzip 解压后应是 11 行 (1 meta + 10 samples)
        import gzip
        text = gzip.decompress(r.data).decode("utf-8")
        lines = text.strip().split("\n")
        assert len(lines) == 11

    def test_download_with_limit(self, client):
        set_id = self._setup_set_with_samples(client, n_samples=10)
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{set_id}/download?format=jsonl&limit=3")
        assert r.status_code == 200
        lines = r.data.decode("utf-8").strip().split("\n")
        assert len(lines) == 4   # 1 meta + 3 samples

    def test_download_not_found(self, client):
        r = client.get("/api/spawn-tuning-v2/sample-sets/99999/download")
        assert r.status_code == 404

    def test_download_invalid_format(self, client):
        set_id = self._setup_set_with_samples(client, n_samples=1)
        r = client.get(f"/api/spawn-tuning-v2/sample-sets/{set_id}/download?format=xml")
        assert r.status_code == 400


# ─────────── 用户行为样本集 (跨库注入 B.2 样本集库) ───────────

# ─────────── 任务日志 (C.2 队列展开行) ───────────

class TestJobLog:
    """GET /jobs/<id>/log — 抽取关键问题行 + 日志尾部, 供队列展开行展示。"""

    def test_log_not_found(self, client):
        r = client.get("/api/spawn-tuning-v2/jobs/99999/log")
        assert r.status_code == 404

    def test_log_no_file(self, client):
        # 新建 job, 未写日志 → exists=False, key_lines 空
        r = client.post(
            "/api/spawn-tuning-v2/jobs",
            json={"sample_set_ids": [1], "model_type": "resnet"},
        )
        job_id = r.get_json()["job_id"]
        r = client.get(f"/api/spawn-tuning-v2/jobs/{job_id}/log")
        assert r.status_code == 200
        d = r.get_json()
        assert d["exists"] is False
        assert d["key_lines"] == []

    def test_log_key_lines_extracted(self, client, tmp_path):
        r = client.post(
            "/api/spawn-tuning-v2/jobs",
            json={"sample_set_ids": [1], "model_type": "resnet"},
        )
        job_id = r.get_json()["job_id"]
        # 写一个含 traceback 的日志文件, 并把 log_path 挂到 job
        log_file = tmp_path / f"job_{job_id}.log"
        log_file.write_text(
            "[train_v2] device=mps sets=[1]\n"
            "epoch 1 loss=0.5\n"
            "Traceback (most recent call last):\n"
            '  File "train.py", line 284, in train\n'
            "    raise ValueError(\"no samples found in sets [1]\")\n"
            "ValueError: no samples found in sets [1]\n"
            "[job_executor] failed, rc=1\n",
            encoding="utf-8",
        )
        client.patch(
            f"/api/spawn-tuning-v2/jobs/{job_id}",
            json={"log_path": str(log_file), "error_message": "subprocess exit code 1"},
        )
        r = client.get(f"/api/spawn-tuning-v2/jobs/{job_id}/log")
        assert r.status_code == 200
        d = r.get_json()
        assert d["exists"] is True
        assert d["error_message"] == "subprocess exit code 1"
        texts = " ".join(k["text"] for k in d["key_lines"])
        assert "Traceback" in texts
        assert "ValueError: no samples found" in texts
        assert "no samples found" in d["tail"]


# ─────────── 真实行为导入 (玩家对局 → v2 寻参样本) ───────────

def _seed_behavior_sessions(n_sessions=3, n_place=6):
    """在隔离主库 (OPENBLOCK_DB_PATH) 建 spawn_dataset_samples 并塞几局。"""
    import sqlite3
    main_db = os.environ["OPENBLOCK_DB_PATH"]
    conn = sqlite3.connect(main_db)
    conn.execute(
        """CREATE TABLE IF NOT EXISTS spawn_dataset_samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id INTEGER NOT NULL UNIQUE, user_id TEXT NOT NULL,
            score INTEGER, pb_baseline INTEGER, game_over_reason TEXT,
            sample_count INTEGER DEFAULT 0, payload TEXT NOT NULL,
            schema_version INTEGER DEFAULT 1,
            packed_at INTEGER DEFAULT (strftime('%s','now')),
            updated_at INTEGER DEFAULT (strftime('%s','now')))"""
    )
    grid = {"cells": [[None] * 8 for _ in range(8)]}
    for sid in range(1, n_sessions + 1):
        frames = [
            {"t": "init", "grid": grid},
            {"t": "spawn", "dock": [{"id": "1x2"}, {"id": "2x2"}, {"id": "t-up"}],
             "ps": {"score": 0, "boardFill": 0.0, "bestScore": 2000,
                    "provenance": {"spawnSource": "rule"},
                    "adaptive": {"stressBreakdown": {
                        "pbCurveParams": {"pbTensionCenter": 0.8, "pbTensionWidth": 0.07},
                        "lifecycleStage": "S1"}}}},
        ]
        for i in range(n_place):
            frames.append({"t": "place", "gridAfter": grid,
                           "ps": {"score": 100 * (i + 1), "boardFill": 0.1 * (i + 1),
                                  "linesCleared": 0}})
        payload = json.dumps({"frames": frames})
        conn.execute(
            "INSERT OR IGNORE INTO spawn_dataset_samples (session_id, user_id, score, pb_baseline, "
            "game_over_reason, sample_count, payload, packed_at) VALUES (?,?,?,?,?,?,?,?)",
            (sid, f"u{sid}", 100 * n_place, 2000, "jam", n_place, payload, 1000 + sid),
        )
    conn.commit()
    conn.close()


class TestImportBehavior:
    def test_import_no_main_table(self, client):
        # 主库无 spawn_dataset_samples → 400 友好提示
        r = client.post("/api/spawn-tuning-v2/import-behavior", json={})
        assert r.status_code == 400
        assert "spawn_dataset_samples" in r.get_json()["error"]

    def test_import_creates_trainable_set(self, client):
        _seed_behavior_sessions(n_sessions=3, n_place=6)
        r = client.post("/api/spawn-tuning-v2/import-behavior", json={})
        assert r.status_code == 200, r.get_json()
        d = r.get_json()
        assert d["ok"] is True
        assert d["scanned"] == 3
        assert d["inserted"] == 3
        assert d["total"] == 3
        set_id = d["set_id"]

        # 出现在样本集列表里 (普通集, 非 behavior kind)
        lst = client.get("/api/spawn-tuning-v2/sample-sets?limit=100").get_json()
        match = [s for s in lst["sample_sets"] if s["set_id"] == set_id]
        assert match, "imported set not in list"
        assert match[0].get("kind") != "behavior"
        assert "real" in (match[0].get("tags") or "")
        assert match[0]["sample_count"] == 3

        # 样本字段可被训练加载器读取 (preview 不报错)
        pv = client.get(f"/api/spawn-tuning-v2/sample-sets/{set_id}/preview").get_json()
        assert pv.get("kind") != "behavior"

    def test_import_incremental_dedup(self, client):
        # 首次同步 2 局
        _seed_behavior_sessions(n_sessions=2, n_place=5)
        r1 = client.post("/api/spawn-tuning-v2/import-behavior", json={}).get_json()
        assert r1["inserted"] == 2 and r1["total"] == 2
        # 再次同步 (无新增) → 全部 already, 不翻倍
        r2 = client.post("/api/spawn-tuning-v2/import-behavior", json={}).get_json()
        assert r2["set_id"] == r1["set_id"]
        assert r2["inserted"] == 0
        assert r2["already"] == 2
        assert r2["total"] == 2
        # 新增 1 局 (session_id=3) → 增量只入库新的那条
        _seed_behavior_sessions(n_sessions=3, n_place=5)
        r3 = client.post("/api/spawn-tuning-v2/import-behavior", json={}).get_json()
        assert r3["inserted"] == 1
        assert r3["already"] == 2
        assert r3["total"] == 3

    def test_import_quality_gate_filters_invalid(self, client):
        # 2 局正常 (6 步) + 1 局废局 (1 步, n_bins_filled 低) → 质量门滤掉废局
        _seed_behavior_sessions(n_sessions=2, n_place=6)
        import sqlite3
        conn = sqlite3.connect(os.environ["OPENBLOCK_DB_PATH"])
        bad = json.dumps({"frames": [
            {"t": "init", "grid": {"cells": [[None] * 8 for _ in range(8)]}},
            {"t": "spawn", "dock": [{"id": "1x2"}], "ps": {"score": 0, "boardFill": 0.0, "bestScore": 2000}},
            {"t": "place", "gridAfter": {"cells": [[None] * 8 for _ in range(8)]},
             "ps": {"score": 0, "boardFill": 0.0, "linesCleared": 0}},
        ]})
        conn.execute(
            "INSERT OR IGNORE INTO spawn_dataset_samples (session_id, user_id, score, pb_baseline, "
            "game_over_reason, sample_count, payload, packed_at) VALUES (?,?,?,?,?,?,?,?)",
            (99, "ubad", 0, 2000, "jam", 1, bad, 999),
        )
        conn.commit()
        conn.close()
        r = client.post("/api/spawn-tuning-v2/import-behavior", json={}).get_json()
        assert r["scanned"] == 3
        assert r["inserted"] == 2       # 2 局正常入库
        assert r["invalid"] >= 1        # 废局被质量门挡下
        assert r["total"] == 2

    def test_import_quality_gate_can_disable(self, client):
        _seed_behavior_sessions(n_sessions=1, n_place=1)  # 1 步, 默认会被滤
        r_on = client.post("/api/spawn-tuning-v2/import-behavior", json={}).get_json()
        assert r_on["total"] == 0 and r_on["invalid"] >= 1
        # 关闭质量门 (阈值全 0) → 入库
        r_off = client.post("/api/spawn-tuning-v2/import-behavior",
                            json={"min_steps": 0, "min_bins": 0, "min_score": 0}).get_json()
        assert r_off["total"] >= 1

    def test_import_rebuild_resets(self, client):
        _seed_behavior_sessions(n_sessions=2, n_place=5)
        r1 = client.post("/api/spawn-tuning-v2/import-behavior", json={}).get_json()
        r2 = client.post("/api/spawn-tuning-v2/import-behavior", json={"rebuild": True}).get_json()
        assert r1["set_id"] == r2["set_id"]
        assert r2["inserted"] == 2  # rebuild 清空后重新全量
        got = client.get(f"/api/spawn-tuning-v2/sample-sets/{r2['set_id']}").get_json()
        assert got["actual_sample_count"] == 2
