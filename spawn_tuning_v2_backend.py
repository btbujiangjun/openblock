"""Spawn Tuning v2 后端 — Flask blueprint。

API 前缀: /api/spawn-tuning-v2/*

主要 endpoint:
  样本集 (sample_sets):
    GET    /sample-sets                     列表 + 筛选
    POST   /sample-sets                     创建
    GET    /sample-sets/<id>                详情
    PATCH  /sample-sets/<id>                改 name/tags/description
    DELETE /sample-sets/<id>                删除 (级联 samples)

  样本 (samples):
    POST   /sample-sets/<id>/samples        批量写入
    GET    /sample-sets/<id>/aggregate      d_curve 聚合 (按 5 维)

  模型 (models):
    GET    /models                          列表
    GET    /models/<id>                     详情 (含 metrics_json 解析)
    PATCH  /models/<id>                     改 status/tags
    POST   /models/<id>/deploy              部署 (status='deployed')
    POST   /models/<id>/rollback            回滚 (status='rollbacked')

  训练任务 (training_jobs):
    POST   /jobs                            创建训练任务 (status='queued')
    GET    /jobs                            列表
    GET    /jobs/<id>                       详情
    PATCH  /jobs/<id>                       更新 (status/metrics)

  导出/工具:
    GET    /policies/active                 当前生效 policies (含 d_curve 元数据)
    GET    /target-curve                    返回目标 S 曲线 (20 维)

注册方式 (server.py):
    from spawn_tuning_v2_backend import register_v2_routes
    register_v2_routes(app)
"""
from __future__ import annotations
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Dict, List, Optional

from flask import Blueprint, current_app, jsonify, request


# ─────────── 配置 ───────────

DB_PATH = os.environ.get("SPAWN_TUNING_V2_DB", ".cursor-stress-logs/spawn-tuning-v2.sqlite")
SCHEMA_PATH = Path(__file__).resolve().parent / "schemas" / "spawn_tuning_v2.sql"

# field_metrics 表 (v2 真实玩家上报) — 不在主 schema.sql 里, 因为它由 PR4 引入
_FIELD_METRICS_DDL = """
CREATE TABLE IF NOT EXISTS field_metrics (
    metric_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    context_key    TEXT NOT NULL,
    pb             INTEGER NOT NULL,
    model_id       INTEGER,
    theta_hash     TEXT,
    d_curve_json   TEXT NOT NULL,
    final_score    INTEGER,
    survived_steps INTEGER,
    clear_rate     REAL,
    noMove_step    INTEGER,
    pb_broke       INTEGER NOT NULL DEFAULT 0,
    surprise_count INTEGER NOT NULL DEFAULT 0,
    client_ts      INTEGER NOT NULL,
    received_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_field_metrics_ctx ON field_metrics(context_key, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_field_metrics_model ON field_metrics(model_id, received_at DESC);
"""


def get_db():
    """获取 SQLite 连接 (每个请求一次)。"""
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def ensure_schema():
    """启动时确保 schema 存在 (幂等)。"""
    db_dir = Path(DB_PATH).parent
    db_dir.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    if SCHEMA_PATH.exists():
        conn.executescript(SCHEMA_PATH.read_text())
    conn.executescript(_FIELD_METRICS_DDL)
    conn.close()


def row_to_dict(row) -> dict:
    return {k: row[k] for k in row.keys()} if row else None


def now_unix() -> int:
    return int(time.time())


# ─────────── Blueprint ───────────

def register_v2_routes(app):
    """把 v2 API 注册到主 Flask app。"""
    ensure_schema()
    bp = Blueprint("spawn_tuning_v2", __name__)

    # ─── 样本集 ───────────────────────────────────────────

    @bp.route("/api/spawn-tuning-v2/sample-sets", methods=["GET"])
    def list_sample_sets():
        """列出样本集 (按 created_at 倒序)。
        Query: status, tag, limit (default 50), offset (default 0)
        """
        try:
            limit = max(1, min(500, int(request.args.get("limit", 50))))
            offset = max(0, int(request.args.get("offset", 0)))
        except ValueError:
            return jsonify({"error": "invalid limit/offset"}), 400
        status = request.args.get("status")
        tag = request.args.get("tag")

        db = get_db()
        sql = "SELECT * FROM sample_sets WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        if tag:
            sql += " AND tags LIKE ?"
            params.append(f"%{tag}%")
        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params += [limit, offset]

        rows = db.execute(sql, params).fetchall()
        total = db.execute("SELECT COUNT(*) FROM sample_sets").fetchone()[0]
        db.close()
        return jsonify({
            "sample_sets": [row_to_dict(r) for r in rows],
            "count": len(rows),
            "total": total,
            "limit": limit,
            "offset": offset,
        })

    @bp.route("/api/spawn-tuning-v2/sample-sets", methods=["POST"])
    def create_sample_set():
        data = request.get_json() or {}
        name = data.get("name", "").strip()
        if not name:
            return jsonify({"error": "name required"}), 400

        db = get_db()
        cur = db.execute(
            "INSERT INTO sample_sets (name, description, config_json, status, tags, parent_set_id, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                name,
                data.get("description", ""),
                json.dumps(data.get("config", {})),
                data.get("status", "collecting"),
                data.get("tags", ""),
                data.get("parent_set_id"),
                now_unix(),
            ),
        )
        set_id = cur.lastrowid
        db.commit()
        db.close()
        return jsonify({"set_id": set_id, "ok": True}), 201

    @bp.route("/api/spawn-tuning-v2/sample-sets/<int:set_id>", methods=["GET"])
    def get_sample_set(set_id):
        db = get_db()
        row = db.execute("SELECT * FROM sample_sets WHERE set_id = ?", (set_id,)).fetchone()
        if not row:
            db.close()
            return jsonify({"error": "not found"}), 404
        out = row_to_dict(row)
        # 实时统计 samples
        cnt = db.execute("SELECT COUNT(*) FROM samples WHERE set_id = ?", (set_id,)).fetchone()[0]
        out["actual_sample_count"] = cnt
        db.close()
        return jsonify(out)

    @bp.route("/api/spawn-tuning-v2/sample-sets/<int:set_id>", methods=["PATCH"])
    def patch_sample_set(set_id):
        data = request.get_json() or {}
        allowed = ("name", "description", "tags", "status")
        updates = {k: v for k, v in data.items() if k in allowed}
        if not updates:
            return jsonify({"error": "no valid fields"}), 400

        db = get_db()
        if not db.execute("SELECT 1 FROM sample_sets WHERE set_id = ?", (set_id,)).fetchone():
            db.close()
            return jsonify({"error": "not found"}), 404
        sets = ", ".join(f"{k} = ?" for k in updates)
        db.execute(f"UPDATE sample_sets SET {sets} WHERE set_id = ?",
                   tuple(updates.values()) + (set_id,))
        db.commit()
        db.close()
        return jsonify({"ok": True, "updated": list(updates.keys())})

    @bp.route("/api/spawn-tuning-v2/sample-sets/<int:set_id>", methods=["DELETE"])
    def delete_sample_set(set_id):
        db = get_db()
        # ON DELETE CASCADE 会自动清 samples
        cur = db.execute("DELETE FROM sample_sets WHERE set_id = ?", (set_id,))
        db.commit()
        rc = cur.rowcount
        db.close()
        if rc == 0:
            return jsonify({"error": "not found"}), 404
        return jsonify({"ok": True, "deleted": rc})

    # ─── 样本批量写入 ─────────────────────────────────────

    @bp.route("/api/spawn-tuning-v2/sample-sets/<int:set_id>/samples", methods=["POST"])
    def bulk_insert_samples(set_id):
        """批量写入样本到指定 sample_set。
        POST body: { samples: [{difficulty, generator, ..., theta_json, d_curve_json, ...}, ...] }
        """
        data = request.get_json() or {}
        samples = data.get("samples", [])
        if not isinstance(samples, list) or not samples:
            return jsonify({"error": "samples must be non-empty list"}), 400

        db = get_db()
        # 验证 set 存在
        if not db.execute("SELECT 1 FROM sample_sets WHERE set_id = ?", (set_id,)).fetchone():
            db.close()
            return jsonify({"error": "sample_set not found"}), 404

        fields = [
            "set_id", "difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage",
            "theta_json", "d_curve_json", "final_score", "survived_steps",
            "clear_rate", "noMove_step", "pb_broke", "surprise_count",
            "seed", "eval_ms", "evaluated_at",
        ]
        placeholders = ",".join(["?"] * len(fields))
        sql = f"INSERT INTO samples ({','.join(fields)}) VALUES ({placeholders})"

        inserted = 0
        errors = 0
        for s in samples:
            try:
                row = (
                    set_id,
                    s["difficulty"], s["generator"], s["bot_policy"],
                    int(s["pb_bin"]), s["lifecycle_stage"],
                    s["theta_json"] if isinstance(s["theta_json"], str) else json.dumps(s["theta_json"]),
                    s["d_curve_json"] if isinstance(s["d_curve_json"], str) else json.dumps(s["d_curve_json"]),
                    s.get("final_score"), s.get("survived_steps"),
                    s.get("clear_rate"), s.get("noMove_step", -1),
                    int(bool(s.get("pb_broke", False))), s.get("surprise_count", 0),
                    s.get("seed"), s.get("eval_ms"),
                    s.get("evaluated_at", int(time.time() * 1000)),
                )
                db.execute(sql, row)
                inserted += 1
            except (KeyError, ValueError, sqlite3.IntegrityError):
                errors += 1
                continue

        # 更新 sample_count
        db.execute(
            "UPDATE sample_sets SET sample_count = sample_count + ? WHERE set_id = ?",
            (inserted, set_id),
        )
        db.commit()
        db.close()
        return jsonify({"inserted": inserted, "errors": errors, "received": len(samples)})

    @bp.route("/api/spawn-tuning-v2/sample-sets/<int:set_id>/aggregate", methods=["GET"])
    def aggregate_curves(set_id):
        """按 5 维场景聚合 d_curve (avg)。可选 group_by 参数。"""
        group_by = request.args.get("group_by", "")  # 例: "difficulty,bot_policy"
        valid_dims = ["difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage"]
        groups = [g.strip() for g in group_by.split(",") if g.strip() in valid_dims]

        db = get_db()
        if not db.execute("SELECT 1 FROM sample_sets WHERE set_id = ?", (set_id,)).fetchone():
            db.close()
            return jsonify({"error": "sample_set not found"}), 404

        if groups:
            group_cols = ", ".join(groups)
            rows = db.execute(
                f"SELECT {group_cols}, d_curve_json FROM samples WHERE set_id = ?",
                (set_id,),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT d_curve_json FROM samples WHERE set_id = ?", (set_id,)
            ).fetchall()
        db.close()

        # 按分组聚合
        from collections import defaultdict
        bucket = defaultdict(list)
        for r in rows:
            curve = json.loads(r["d_curve_json"])
            if len(curve) != 20:
                continue
            if groups:
                key = tuple(r[g] for g in groups)
            else:
                key = ()
            bucket[key].append(curve)

        results = []
        for key, curves in bucket.items():
            arr = [[c[i] for c in curves] for i in range(20)]
            avg = [sum(col) / len(col) for col in arr]
            entry = {"d_curve_avg": avg, "n_samples": len(curves)}
            for i, g in enumerate(groups):
                entry[g] = key[i]
            results.append(entry)
        return jsonify({"set_id": set_id, "groups": groups, "buckets": results})

    # ─── 模型 ────────────────────────────────────────────

    @bp.route("/api/spawn-tuning-v2/models", methods=["GET"])
    def list_models():
        status = request.args.get("status")
        limit = int(request.args.get("limit", 50))
        db = get_db()
        sql = "SELECT * FROM models WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = db.execute(sql, params).fetchall()
        db.close()
        out = []
        for r in rows:
            d = row_to_dict(r)
            try:
                d["metrics"] = json.loads(d.get("metrics_json") or "{}")
            except Exception:
                d["metrics"] = {}
            out.append(d)
        return jsonify({"models": out, "count": len(out)})

    @bp.route("/api/spawn-tuning-v2/models/<int:model_id>", methods=["GET"])
    def get_model(model_id):
        db = get_db()
        row = db.execute("SELECT * FROM models WHERE model_id = ?", (model_id,)).fetchone()
        db.close()
        if not row:
            return jsonify({"error": "not found"}), 404
        d = row_to_dict(row)
        try:
            d["metrics"] = json.loads(d.get("metrics_json") or "{}")
        except Exception:
            d["metrics"] = {}
        return jsonify(d)

    @bp.route("/api/spawn-tuning-v2/models/<int:model_id>", methods=["PATCH"])
    def patch_model(model_id):
        data = request.get_json() or {}
        allowed = ("name", "version", "tags", "status")
        updates = {k: v for k, v in data.items() if k in allowed}
        if not updates:
            return jsonify({"error": "no valid fields"}), 400
        db = get_db()
        if not db.execute("SELECT 1 FROM models WHERE model_id = ?", (model_id,)).fetchone():
            db.close()
            return jsonify({"error": "not found"}), 404
        sets = ", ".join(f"{k} = ?" for k in updates)
        db.execute(f"UPDATE models SET {sets} WHERE model_id = ?",
                   tuple(updates.values()) + (model_id,))
        db.commit()
        db.close()
        return jsonify({"ok": True})

    @bp.route("/api/spawn-tuning-v2/models/<int:model_id>/deploy", methods=["POST"])
    def deploy_model(model_id):
        """部署模型: 先把当前 deployed 模型置为 archived, 再激活新模型。"""
        db = get_db()
        if not db.execute("SELECT 1 FROM models WHERE model_id = ?", (model_id,)).fetchone():
            db.close()
            return jsonify({"error": "not found"}), 404
        db.execute("UPDATE models SET status = 'archived' WHERE status = 'deployed'")
        db.execute(
            "UPDATE models SET status = 'deployed', deployed_at = ? WHERE model_id = ?",
            (now_unix(), model_id),
        )
        db.commit()
        db.close()
        return jsonify({"ok": True, "deployed_model_id": model_id})

    @bp.route("/api/spawn-tuning-v2/models/<int:model_id>/rollback", methods=["POST"])
    def rollback_model(model_id):
        """回滚: 把当前 deployed 改成 rollbacked, 把传入 model_id 改成 deployed。
        如果 model_id 是当前 deployed, 则只是标记 rollbacked → 启用上一个 deployed。"""
        db = get_db()
        current = db.execute("SELECT model_id FROM models WHERE status='deployed' LIMIT 1").fetchone()
        if current and current["model_id"] == model_id:
            # 当前就是要回滚的, 找上一个 deployed
            prev = db.execute(
                "SELECT model_id FROM models WHERE status IN ('archived','deployed') "
                "AND model_id != ? ORDER BY deployed_at DESC LIMIT 1",
                (model_id,),
            ).fetchone()
            db.execute("UPDATE models SET status = 'rollbacked' WHERE model_id = ?", (model_id,))
            if prev:
                db.execute(
                    "UPDATE models SET status = 'deployed', deployed_at = ? WHERE model_id = ?",
                    (now_unix(), prev["model_id"]),
                )
            db.commit()
            db.close()
            return jsonify({"ok": True, "rollbacked": model_id, "now_deployed": prev["model_id"] if prev else None})

        # 直接把指定 model 标记为 rollbacked
        db.execute("UPDATE models SET status = 'rollbacked' WHERE model_id = ?", (model_id,))
        db.commit()
        db.close()
        return jsonify({"ok": True, "rollbacked": model_id})

    # ─── 训练任务 ─────────────────────────────────────────

    @bp.route("/api/spawn-tuning-v2/jobs", methods=["GET"])
    def list_jobs():
        status = request.args.get("status")
        limit = int(request.args.get("limit", 50))
        db = get_db()
        sql = "SELECT * FROM training_jobs WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        rows = db.execute(sql, params).fetchall()
        db.close()
        return jsonify({"jobs": [row_to_dict(r) for r in rows], "count": len(rows)})

    @bp.route("/api/spawn-tuning-v2/jobs", methods=["POST"])
    def create_job():
        data = request.get_json() or {}
        if not data.get("sample_set_ids"):
            return jsonify({"error": "sample_set_ids required"}), 400
        db = get_db()
        cur = db.execute(
            """INSERT INTO training_jobs
               (name, status, model_type, arch_json, loss_weights,
                sample_set_ids, base_model_id, created_at)
               VALUES (?, 'queued', ?, ?, ?, ?, ?, ?)""",
            (
                data.get("name", f"job-{now_unix()}"),
                data.get("model_type", "resnet"),
                json.dumps(data.get("arch", {})),
                json.dumps(data.get("loss_weights", {})),
                json.dumps(data["sample_set_ids"]),
                data.get("base_model_id"),
                now_unix(),
            ),
        )
        job_id = cur.lastrowid
        db.commit()
        db.close()
        return jsonify({"job_id": job_id, "status": "queued"}), 201

    @bp.route("/api/spawn-tuning-v2/jobs/<int:job_id>", methods=["GET"])
    def get_job(job_id):
        db = get_db()
        row = db.execute("SELECT * FROM training_jobs WHERE job_id = ?", (job_id,)).fetchone()
        db.close()
        if not row:
            return jsonify({"error": "not found"}), 404
        return jsonify(row_to_dict(row))

    @bp.route("/api/spawn-tuning-v2/jobs/<int:job_id>", methods=["PATCH"])
    def patch_job(job_id):
        data = request.get_json() or {}
        allowed = (
            "status", "train_loss", "val_loss", "val_curve_mae",
            "val_balance", "val_surprise_rate", "val_breaking",
            "epochs_done", "log_path", "error_message",
            "started_at", "completed_at", "output_model_id",
        )
        updates = {k: v for k, v in data.items() if k in allowed}
        if not updates:
            return jsonify({"error": "no valid fields"}), 400
        db = get_db()
        if not db.execute("SELECT 1 FROM training_jobs WHERE job_id = ?", (job_id,)).fetchone():
            db.close()
            return jsonify({"error": "not found"}), 404
        sets = ", ".join(f"{k} = ?" for k in updates)
        db.execute(f"UPDATE training_jobs SET {sets} WHERE job_id = ?",
                   tuple(updates.values()) + (job_id,))
        db.commit()
        db.close()
        return jsonify({"ok": True, "updated": list(updates.keys())})

    # ─── 工具 ────────────────────────────────────────────

    @bp.route("/api/spawn-tuning-v2/target-curve", methods=["GET"])
    def get_target_curve():
        """返回目标 S 曲线 (20 维)。"""
        from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector, get_target_metadata
        return jsonify({
            "curve": target_curve_vector(),
            "metadata": get_target_metadata(),
        })

    # ─── 真实玩家 d_curve 上报 ─────────────────────────────

    @bp.route("/api/spawn-tuning-v2/field-metrics", methods=["POST"])
    def submit_field_metrics():
        """客户端 SDK 批量上报 episode d_curve。

        POST body: { episodes: [{context_key, pb, model_id, theta_hash,
                                 d_curve, final_score, survived_steps,
                                 clear_rate, noMove_step, pb_broke,
                                 surprise_count, ts}, ...] }
        """
        data = request.get_json() or {}
        eps = data.get("episodes", [])
        if not isinstance(eps, list) or not eps:
            return jsonify({"error": "episodes must be non-empty list"}), 400

        db = get_db()
        # 表已在 schema 创建过, 这里仅 INSERT
        inserted = 0
        # 确保表存在 (单次开销可忽略)
        db.executescript(_FIELD_METRICS_DDL)
        for e in eps:
            try:
                db.execute(
                    """INSERT INTO field_metrics (
                        context_key, pb, model_id, theta_hash,
                        d_curve_json, final_score, survived_steps,
                        clear_rate, noMove_step, pb_broke, surprise_count,
                        client_ts, received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                    (
                        e.get("context_key", ""),
                        int(e.get("pb", 0)),
                        e.get("model_id"),
                        e.get("theta_hash"),
                        json.dumps(e.get("d_curve", [])),
                        int(e.get("final_score", 0)),
                        int(e.get("survived_steps", 0)),
                        float(e.get("clear_rate", 0)),
                        int(e.get("noMove_step", -1)),
                        int(bool(e.get("pb_broke", False))),
                        int(e.get("surprise_count", 0)),
                        int(e.get("ts", time.time() * 1000)),
                        now_unix(),
                    ),
                )
                inserted += 1
            except (KeyError, ValueError, sqlite3.OperationalError):
                continue
        db.commit()
        db.close()
        return jsonify({"inserted": inserted, "received": len(eps)})


    @bp.route("/api/spawn-tuning-v2/field-metrics/aggregate", methods=["GET"])
    def aggregate_field_metrics():
        """聚合真实玩家 d_curve, 用于 ⑤ 监控 tab。

        Query: hours (default 24), context_key (筛选, 可选), model_id (筛选, 可选)
        """
        try:
            hours = max(1, min(720, int(request.args.get("hours", 24))))
        except ValueError:
            hours = 24
        ctx = request.args.get("context_key")
        model_id = request.args.get("model_id")

        cutoff = now_unix() - hours * 3600
        db = get_db()
        # 确保表存在
        db.executescript(_FIELD_METRICS_DDL)

        sql = "SELECT * FROM field_metrics WHERE received_at >= ?"
        params = [cutoff]
        if ctx:
            sql += " AND context_key = ?"
            params.append(ctx)
        if model_id:
            sql += " AND model_id = ?"
            params.append(model_id)
        rows = db.execute(sql, params).fetchall()
        db.close()

        if not rows:
            return jsonify({
                "hours": hours, "n_episodes": 0,
                "d_curve_avg": None, "pb_broke_rate": 0,
                "noMove_rate": 0, "mean_score": 0,
            })

        # 聚合
        n = len(rows)
        d_sum = [0.0] * 20
        pb_broke_sum = 0
        noMove_sum = 0
        score_sum = 0
        for r in rows:
            curve = json.loads(r["d_curve_json"])
            if len(curve) == 20:
                for i in range(20):
                    d_sum[i] += curve[i]
            pb_broke_sum += int(r["pb_broke"] or 0)
            noMove_sum += 1 if (r["noMove_step"] or -1) >= 0 else 0
            score_sum += int(r["final_score"] or 0)

        return jsonify({
            "hours": hours,
            "n_episodes": n,
            "d_curve_avg": [v / n for v in d_sum],
            "pb_broke_rate": pb_broke_sum / n,
            "noMove_rate": noMove_sum / n,
            "mean_score": score_sum / n,
        })


    @bp.route("/api/spawn-tuning-v2/policies/active", methods=["GET"])
    def active_policies():
        """返回当前 deployed 模型的元数据 (不返回 policies 内容本身;
        实际 policies 通过文件系统或离线 bundle 分发)。"""
        db = get_db()
        row = db.execute("SELECT * FROM models WHERE status='deployed' LIMIT 1").fetchone()
        db.close()
        if not row:
            return jsonify({"deployed": None})
        d = row_to_dict(row)
        try:
            d["metrics"] = json.loads(d.get("metrics_json") or "{}")
        except Exception:
            d["metrics"] = {}
        return jsonify({"deployed": d})

    # ─── 注册 ────────────────────────────────────────────

    app.register_blueprint(bp)
