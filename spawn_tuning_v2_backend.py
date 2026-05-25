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

    @bp.route("/api/spawn-tuning-v2/sample-sets/<int:set_id>/preview", methods=["GET"])
    def preview_sample_set(set_id):
        """样本集快速预览 — 5 维 context 分布 + θ/标签摘要 + 前 N 条原型样本。

        Args (query):
          limit: 返回多少条原型样本 (默认 20, 上限 100)
          difficulty / generator / bot_policy / pb_bin / lifecycle_stage:
                 维度筛选, 逗号分隔多选 (例: difficulty=easy,normal); 缺省 = 全集

        Returns:
          set:             样本集元数据
          dim_coverage_all:全集 5 维分布 (用于筛选 chip 选项渲染)
          dim_coverage:    当前筛选下的 5 维分布
          filters:         实际生效的筛选条件 (server 端清洗后)
          label_summary:   筛选子集的 final_score / survived_steps / clear_rate ... 均值与分位数
          theta_summary:   θ 9 维的 min/mean/max 直方
          d_curve_avg:     筛选子集平均 d_curve (20 维)
          samples:         筛选子集中最近 N 条原型 (含 ctx + theta + 关键标签)
        """
        limit = max(1, min(100, int(request.args.get("limit", 20))))
        db = get_db()
        set_row = db.execute("SELECT * FROM sample_sets WHERE set_id = ?", (set_id,)).fetchone()
        if not set_row:
            db.close()
            return jsonify({"error": "sample_set not found"}), 404

        # ─ 解析维度筛选 (容错: 未知值会在 WHERE 时不命中, 不抛错)
        DIM_NAMES = ["difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage"]
        filters = {}
        for dim in DIM_NAMES:
            raw = request.args.get(dim, "").strip()
            if raw:
                vals = [x.strip() for x in raw.split(",") if x.strip()]
                if vals:
                    filters[dim] = vals

        # ─ 构造筛选 WHERE 子句 (供后续所有 query 复用)
        where_parts = ["set_id = ?"]
        where_args = [set_id]
        for dim, vals in filters.items():
            placeholders = ",".join("?" * len(vals))
            where_parts.append(f"{dim} IN ({placeholders})")
            where_args.extend(vals if dim != "pb_bin" else [int(v) for v in vals if v.isdigit()])
        where_sql = " AND ".join(where_parts)
        where_args_t = tuple(where_args)

        # 1) 维度分布 — 全集 (供 chip 选项渲染) + 筛选子集 (当前 view)
        from collections import defaultdict, Counter
        dim_coverage_all = {}
        dim_coverage = {}
        for dim in DIM_NAMES:
            # 全集
            all_rows = db.execute(
                f"SELECT {dim} AS k, COUNT(*) AS n FROM samples "
                f"WHERE set_id = ? GROUP BY {dim} ORDER BY {dim}",
                (set_id,),
            ).fetchall()
            dim_coverage_all[dim] = {str(r["k"]): r["n"] for r in all_rows}
            # 筛选子集
            sub_rows = db.execute(
                f"SELECT {dim} AS k, COUNT(*) AS n FROM samples "
                f"WHERE {where_sql} GROUP BY {dim} ORDER BY n DESC",
                where_args_t,
            ).fetchall()
            dim_coverage[dim] = {str(r["k"]): r["n"] for r in sub_rows}

        # 2) 标签摘要 (用 where_sql 替代 set_id = ?)
        label_row = db.execute(
            f"""
            SELECT
              COUNT(*)               AS n,
              AVG(final_score)       AS score_mean,
              MIN(final_score)       AS score_min,
              MAX(final_score)       AS score_max,
              AVG(survived_steps)    AS steps_mean,
              AVG(clear_rate)        AS clear_rate_mean,
              SUM(pb_broke)          AS pb_broke_count,
              SUM(CASE WHEN noMove_step >= 0 THEN 1 ELSE 0 END) AS noMove_count,
              AVG(surprise_count)    AS surprise_mean
            FROM samples WHERE {where_sql}
            """,
            where_args_t,
        ).fetchone()
        n_samples = label_row["n"] or 0
        # p50 / p90 单独 query
        p50_row = None
        p90_row = None
        if n_samples > 0:
            offset_50 = max(0, n_samples // 2)
            offset_90 = max(0, int(n_samples * 0.9) - 1)
            p50_row = db.execute(
                f"SELECT final_score FROM samples WHERE {where_sql} "
                f"ORDER BY final_score LIMIT 1 OFFSET ?",
                where_args_t + (offset_50,),
            ).fetchone()
            p90_row = db.execute(
                f"SELECT final_score FROM samples WHERE {where_sql} "
                f"ORDER BY final_score LIMIT 1 OFFSET ?",
                where_args_t + (offset_90,),
            ).fetchone()
        label_summary = {
            "n": n_samples,
            "final_score": {
                "mean": round(label_row["score_mean"] or 0, 1),
                "min": label_row["score_min"] or 0,
                "max": label_row["score_max"] or 0,
                "p50": (p50_row["final_score"] if p50_row else None),
                "p90": (p90_row["final_score"] if p90_row else None),
            },
            "survived_steps_mean": round(label_row["steps_mean"] or 0, 1),
            "clear_rate_mean": round(label_row["clear_rate_mean"] or 0, 4),
            "pb_broke_rate": round((label_row["pb_broke_count"] or 0) / max(1, n_samples), 4),
            "noMove_rate": round((label_row["noMove_count"] or 0) / max(1, n_samples), 4),
            "surprise_mean": round(label_row["surprise_mean"] or 0, 2),
        }

        # 3) θ 9 维直方 (扫筛选后的 theta_json, 计算 min/mean/max)
        theta_rows = db.execute(
            f"SELECT theta_json FROM samples WHERE {where_sql} LIMIT 5000",  # 防 OOM
            where_args_t,
        ).fetchall()
        theta_stats = defaultdict(lambda: {"sum": 0.0, "min": float("inf"), "max": float("-inf"), "n": 0})
        for r in theta_rows:
            try:
                d = json.loads(r["theta_json"])
                for k, v in d.items():
                    fv = float(v)
                    s = theta_stats[k]
                    s["sum"] += fv
                    s["n"] += 1
                    if fv < s["min"]:
                        s["min"] = fv
                    if fv > s["max"]:
                        s["max"] = fv
            except (ValueError, TypeError):
                continue
        theta_summary = {}
        for k, s in theta_stats.items():
            if s["n"] > 0:
                theta_summary[k] = {
                    "min": round(s["min"], 4),
                    "mean": round(s["sum"] / s["n"], 4),
                    "max": round(s["max"], 4),
                    "n": s["n"],
                }

        # 4) 筛选子集平均 d_curve
        d_rows = db.execute(
            f"SELECT d_curve_json FROM samples WHERE {where_sql} LIMIT 5000",
            where_args_t,
        ).fetchall()
        d_sum = [0.0] * 20
        d_n = 0
        for r in d_rows:
            try:
                c = json.loads(r["d_curve_json"])
                if len(c) == 20:
                    for i in range(20):
                        d_sum[i] += float(c[i])
                    d_n += 1
            except (ValueError, TypeError):
                continue
        d_curve_avg = [round(s / d_n, 4) for s in d_sum] if d_n > 0 else None

        # 5) 筛选子集中前 N 条样本原型
        sample_rows = db.execute(
            f"""
            SELECT sample_id, difficulty, generator, bot_policy, pb_bin, lifecycle_stage,
                   theta_json, final_score, survived_steps, clear_rate, noMove_step,
                   pb_broke, surprise_count, seed, eval_ms, evaluated_at
            FROM samples WHERE {where_sql}
            ORDER BY sample_id DESC LIMIT ?
            """,
            where_args_t + (limit,),
        ).fetchall()
        samples = []
        for r in sample_rows:
            d = dict(r)
            try:
                d["theta"] = json.loads(d.pop("theta_json"))
            except (ValueError, TypeError):
                d["theta"] = {}
                d.pop("theta_json", None)
            samples.append(d)

        db.close()
        total_in_set = sum(dim_coverage_all["difficulty"].values()) if dim_coverage_all["difficulty"] else 0
        return jsonify({
            "set": dict(set_row),
            "dim_coverage_all": dim_coverage_all,
            "dim_coverage": dim_coverage,
            "filters": filters,
            "n_filtered": n_samples,
            "n_total": total_in_set,
            "label_summary": label_summary,
            "theta_summary": theta_summary,
            "d_curve_avg": d_curve_avg,
            "samples": samples,
            "sample_limit": limit,
        })

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

    @bp.route("/api/spawn-tuning-v2/models/<int:model_id>", methods=["DELETE"])
    def delete_model(model_id):
        """删除模型记录 + 关联文件 (.pt 权重 + .pt.log 训练日志)。

        安全约束:
          - status='deployed' 的模型不允许删 (避免误删生产模型)
          - 必须先 rollback 或 deploy 别的模型

        参数:
          - force=1: 跳过 deployed 保护 (用于明确知道在做什么的场景)
        """
        from pathlib import Path
        force = request.args.get("force") == "1"

        db = get_db()
        row = db.execute(
            "SELECT model_id, name, status, weights_path FROM models WHERE model_id = ?",
            (model_id,),
        ).fetchone()
        if not row:
            db.close()
            return jsonify({"error": "not found"}), 404

        if row["status"] == "deployed" and not force:
            db.close()
            return jsonify({
                "error": "cannot delete deployed model — rollback first or pass ?force=1",
                "status": row["status"],
            }), 409

        # 删除文件 (best-effort, 删失败不阻塞 DB 删除)
        deleted_files = []
        failed_files = []
        wp = row["weights_path"]
        if wp:
            for cand in [Path(wp), Path(wp + ".log")]:
                if cand.exists() and cand.is_file():
                    try:
                        cand.unlink()
                        deleted_files.append(str(cand))
                    except OSError as e:
                        failed_files.append({"path": str(cand), "error": str(e)})

        # 删 DB 记录 (training_jobs.output_model_id 已 ON DELETE SET NULL, 不阻塞)
        db.execute("DELETE FROM models WHERE model_id = ?", (model_id,))
        db.commit()
        db.close()
        return jsonify({
            "ok": True,
            "deleted_model_id": model_id,
            "deleted_files": deleted_files,
            "failed_files": failed_files,
        })

    @bp.route("/api/spawn-tuning-v2/models/<int:model_id>/predict-curve", methods=["POST"])
    def predict_curve(model_id):
        """加载模型, 对一组 contexts × theta_norm 推断 d_curve。

        body: {
          contexts: [{difficulty, generator, bot_policy, pb_bin, lifecycle_stage}, ...],
          theta_norm: [0.5, 0.5, 0.5, 0.5, 0.5]   # (N_THETA,) 缺省 = 全 0.5 (即 ranges 中点)
        }
        return: { curves: [[20 floats], ...], n_contexts: ... }
        """
        try:
            import torch
            from rl_pytorch.spawn_tuning_v2.model import SpawnTuningResNetMLP, N_THETA, N_CURVE_BINS
            from rl_pytorch.spawn_tuning_v2.feature_io import (
                DIFFICULTY_INDEX, GENERATOR_INDEX, BOT_INDEX, PB_BIN_INDEX, LIFECYCLE_INDEX,
            )
        except Exception as e:
            return jsonify({"error": f"torch/model not available: {e}"}), 503

        body = request.get_json() or {}
        contexts = body.get("contexts") or []
        if not contexts:
            return jsonify({"error": "contexts required"}), 400
        theta_norm = body.get("theta_norm")
        if theta_norm is None:
            theta_norm = [0.5] * N_THETA
        if len(theta_norm) != N_THETA:
            return jsonify({"error": f"theta_norm must have length {N_THETA}"}), 400

        db = get_db()
        row = db.execute("SELECT weights_path FROM models WHERE model_id = ?", (model_id,)).fetchone()
        db.close()
        if not row or not row["weights_path"]:
            return jsonify({"error": "model not found or has no weights_path"}), 404

        try:
            ck = torch.load(row["weights_path"], map_location="cpu", weights_only=False)
            arch = ck.get("arch", {})
            model = SpawnTuningResNetMLP(
                hidden_dim=arch.get("hidden_dim", 128),
                n_blocks=arch.get("n_blocks", 8),
                curve_bins=arch.get("curve_bins", N_CURVE_BINS),
            )
            model.load_state_dict(ck["model_state_dict"])
            model.eval()
        except Exception as e:
            return jsonify({"error": f"load model failed: {e}"}), 500

        import math
        diffs, gens, bots, pbs, lifes, log_pbs = [], [], [], [], [], []
        for c in contexts:
            try:
                diffs.append(DIFFICULTY_INDEX[c["difficulty"]])
                gens.append(GENERATOR_INDEX[c["generator"]])
                bots.append(BOT_INDEX[c["bot_policy"]])
                pbs.append(PB_BIN_INDEX[int(c["pb_bin"])])
                lifes.append(LIFECYCLE_INDEX[c["lifecycle_stage"]])
                log_pbs.append(math.log10(max(1.0, float(c["pb_bin"]))))
            except (KeyError, ValueError, TypeError) as e:
                return jsonify({"error": f"invalid context {c}: {e}"}), 400

        with torch.no_grad():
            theta_t = torch.tensor([theta_norm] * len(contexts), dtype=torch.float32)
            preds = model(
                difficulty_idx=torch.tensor(diffs, dtype=torch.long),
                generator_idx=torch.tensor(gens, dtype=torch.long),
                bot_idx=torch.tensor(bots, dtype=torch.long),
                pb_bin_idx=torch.tensor(pbs, dtype=torch.long),
                lifecycle_idx=torch.tensor(lifes, dtype=torch.long),
                log_pb=torch.tensor(log_pbs, dtype=torch.float32),
                theta_norm=theta_t,
            )
            curves = preds["curve"].cpu().numpy().tolist()

        return jsonify({
            "model_id": model_id,
            "n_contexts": len(contexts),
            "curves": curves,
        })

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

    @bp.route("/api/spawn-tuning-v2/jobs/<int:job_id>/metrics-history", methods=["GET"])
    def get_job_metrics_history(job_id):
        """读 train.py 写的 JSONL 训练日志, 返回 per-epoch metrics 数组。

        train.py 把 JSONL 写到 `<weights_path>.log`; job_executor 也把
        log_path 写到 jobs 表 (stdout 混合日志)。这里优先解析 .pt.log,
        失败时退回扫 log_path (兼容旧任务)。
        """
        from pathlib import Path
        db = get_db()
        row = db.execute(
            "SELECT job_id, status, output_model_id, log_path FROM training_jobs WHERE job_id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            db.close()
            return jsonify({"error": "not found"}), 404
        weights_path = None
        if row["output_model_id"]:
            m = db.execute(
                "SELECT weights_path FROM models WHERE model_id = ?",
                (row["output_model_id"],),
            ).fetchone()
            if m:
                weights_path = m["weights_path"]
        db.close()

        # 候选日志路径 — 按优先级:
        #   1) <weights_path>.log     (job 已完成, 模型已写入 → 路径已知)
        #   2) 扫 CHECKPOINTS_DIR     (job 在跑, 还没写 models 表 → 按命名约定 job_<id>_*.pt.log)
        #   3) jobs.log_path          (混合 stdout, 兜底)
        candidates = []
        if weights_path:
            candidates.append(Path(weights_path + ".log"))
        else:
            # 训练中的 job — 直接扫 CHECKPOINTS_DIR 找匹配的 .pt.log
            try:
                from rl_pytorch.spawn_tuning_v2.job_executor import CHECKPOINTS_DIR
            except Exception:
                CHECKPOINTS_DIR = Path(os.environ.get("SPAWN_TUNING_V2_CHECKPOINTS", "checkpoints/v2"))
            try:
                matches = sorted(
                    CHECKPOINTS_DIR.glob(f"job_{job_id}_*.pt.log"),
                    key=lambda p: p.stat().st_mtime, reverse=True,
                )
                if matches:
                    candidates.append(matches[0])
            except OSError:
                pass
        if row["log_path"]:
            candidates.append(Path(row["log_path"]))

        epochs = []   # epoch-end metrics
        batches = []  # batch-level train_loss (高密度, 让用户看到 epoch 内部 loss 趋势)
        for p in candidates:
            if not p.exists():
                continue
            try:
                with open(p, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        line = line.strip()
                        if not line or not line.startswith("{"):
                            continue
                        try:
                            d = json.loads(line)
                        except (ValueError, KeyError):
                            continue
                        rec_type = d.get("type")
                        # 兼容旧 JSONL (没有 type 字段, 全部当 epoch end)
                        if rec_type == "batch":
                            batches.append({
                                "step": int(d.get("step", 0)),
                                "epoch": int(d.get("epoch", 0)),
                                "batch": int(d.get("batch", 0)),
                                "train_loss_batch": float(d.get("train_loss_batch", 0)),
                            })
                        elif "epoch" in d and "train_loss" in d:
                            epochs.append({
                                "step": int(d.get("step", 0)),
                                "epoch": int(d["epoch"]),
                                "train_loss": float(d.get("train_loss", 0)),
                                "val_loss": float(d.get("val_loss", 0)),
                                "val_curve_mae": float(d.get("val_curve_mae", 0)),
                                "val_balance": float(d.get("val_balance", 0)),
                                "val_surprise": float(d.get("val_surprise", 0)),
                                "val_breaking": float(d.get("val_breaking", 0)),
                                # v2.4: 得分-PB 分布 loss
                                "val_pb_distribution": float(d.get("val_pb_distribution", 0)),
                                # v2.6: anchor 关键 r 点 hinge 约束
                                "val_anchor": float(d.get("val_anchor", 0)),
                                # v2.9 / v2.9.1: 形状约束指标
                                "val_monotonic": float(d.get("val_monotonic", 0)),
                                "val_target_fit": float(d.get("val_target_fit", 0)),
                                "val_endpoint": float(d.get("val_endpoint", 0)),
                                # v2.5: 业务级 P_reach 指标 (玩家到达 r=X 累积概率)
                                "reach_50":  float(d.get("reach_50",  0)),
                                "reach_80":  float(d.get("reach_80",  0)),
                                "reach_95":  float(d.get("reach_95",  0)),
                                "reach_100": float(d.get("reach_100", 0)),
                                "reach_120": float(d.get("reach_120", 0)),
                                "reach_150": float(d.get("reach_150", 0)),
                                "lr": float(d.get("lr", 0)),
                                "elapsed_s": float(d.get("elapsed_s", 0)),
                            })
                if epochs or batches:
                    break  # 第一个成功解析的就够了
            except IOError:
                continue

        return jsonify({
            "job_id": job_id,
            "status": row["status"],
            "n_epochs": len(epochs),
            "n_batches": len(batches),
            "epochs": epochs,
            "batches": batches,
            "log_paths_tried": [str(p) for p in candidates],
        })

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

    @bp.route("/api/spawn-tuning-v2/jobs/<int:job_id>", methods=["DELETE"])
    def delete_job(job_id):
        """删除训练任务记录 + 关联日志文件。

        v2.8.4: 支持 running/queued 任务 — 会先 SIGTERM kill 子进程 (3 秒超时 SIGKILL)。

        删除内容:
          - 训练子进程 (running 时, 通过 job_executor.kill_job 触发 SIGTERM→SIGKILL)
          - jobs 表记录
          - log_path 文件 (.log)
          - 关联 model (output_model_id) 不会被删 — model 独立管理 (在 C.3 模型库)
        """
        from pathlib import Path

        db = get_db()
        row = db.execute(
            "SELECT job_id, name, status, log_path FROM training_jobs WHERE job_id = ?",
            (job_id,),
        ).fetchone()
        if not row:
            db.close()
            return jsonify({"error": "not found"}), 404

        kill_info = None
        # v2.8.4: running 状态 → 先尝试 kill 子进程
        if row["status"] == "running":
            try:
                from rl_pytorch.spawn_tuning_v2.job_executor import kill_job
                kill_info = kill_job(job_id, timeout=3.0)
            except Exception as e:
                kill_info = {"ok": False, "action": "import_failed", "msg": str(e)}

        # 删除日志文件 (best-effort)
        deleted_files = []
        failed_files = []
        if row["log_path"]:
            log_p = Path(row["log_path"])
            if log_p.exists() and log_p.is_file():
                try:
                    log_p.unlink()
                    deleted_files.append(str(log_p))
                except OSError as e:
                    failed_files.append({"path": str(log_p), "error": str(e)})

        db.execute("DELETE FROM training_jobs WHERE job_id = ?", (job_id,))
        db.commit()
        db.close()
        return jsonify({
            "ok": True,
            "deleted_job_id": job_id,
            "prev_status": row["status"],
            "kill_info": kill_info,
            "deleted_files": deleted_files,
            "failed_files": failed_files,
        })

    # ─── 工具 ────────────────────────────────────────────

    @bp.route("/api/spawn-tuning-v2/stats/overview", methods=["GET"])
    def stats_overview():
        """① 概览页用的聚合统计 (用一次性 query 替代前端 3 次 list 请求)。

        返回:
          - n_sample_sets / n_samples (总样本数, 含已删 set 之外)
          - n_models (按 status 分组)
          - n_jobs   (按 status 分组)
          - total_training_seconds (所有 done jobs 的 completed - started 累加)
          - last_7d_field_d_mae    (最近 7 日真人玩家 d_curve vs target 平均 MAE, 无数据时 null)
        """
        import time
        from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector
        db = get_db()

        sets_row = db.execute("SELECT COUNT(*) AS n FROM sample_sets").fetchone()
        samples_row = db.execute("SELECT COUNT(*) AS n FROM samples").fetchone()
        models_rows = db.execute(
            "SELECT status, COUNT(*) AS n FROM models GROUP BY status"
        ).fetchall()
        jobs_rows = db.execute(
            "SELECT status, COUNT(*) AS n FROM training_jobs GROUP BY status"
        ).fetchall()
        train_sec = db.execute(
            "SELECT COALESCE(SUM(completed_at - started_at), 0) AS s "
            "FROM training_jobs WHERE status = 'done' AND completed_at IS NOT NULL "
            "  AND started_at IS NOT NULL"
        ).fetchone()

        # 最近 7 日 field d_curve MAE (有 d_curve_json 才算)
        last_7d_mae = None
        try:
            cutoff = int(time.time()) - 7 * 24 * 3600
            field_rows = db.execute(
                "SELECT d_curve_json FROM field_metrics_v2 "
                "WHERE received_at >= ? AND d_curve_json IS NOT NULL LIMIT 500",
                (cutoff,),
            ).fetchall()
            if field_rows:
                target = target_curve_vector()
                sumMae = 0.0
                n = 0
                for r in field_rows:
                    try:
                        curve = json.loads(r["d_curve_json"])
                        if len(curve) == len(target):
                            sumMae += sum(abs(curve[i] - target[i]) for i in range(len(target))) / len(target)
                            n += 1
                    except (ValueError, TypeError):
                        continue
                if n > 0:
                    last_7d_mae = round(sumMae / n, 4)
        except sqlite3.OperationalError:
            # field_metrics_v2 表可能尚未创建 (干净环境)
            pass

        db.close()
        return jsonify({
            "n_sample_sets": sets_row["n"],
            "n_samples": samples_row["n"],
            "models_by_status": {r["status"]: r["n"] for r in models_rows},
            "jobs_by_status": {r["status"]: r["n"] for r in jobs_rows},
            "total_training_seconds": int(train_sec["s"] or 0),
            "last_7d_field_d_mae": last_7d_mae,
        })

    @bp.route("/api/spawn-tuning-v2/system/devices", methods=["GET"])
    def list_system_devices():
        """检测 server 端 torch 可用的设备 (cuda / mps / cpu) 并给出推荐默认。

        优先级 (与训练吞吐量正相关): cuda > mps > cpu

        Returns:
          devices:     [{ id, available, label }, ...] 三个 device 的可用状态
          recommended: "cuda" / "mps" / "cpu" — 前端默认应当选中的设备
        """
        cuda = False
        mps = False
        cuda_name = None
        try:
            import torch
            cuda = bool(torch.cuda.is_available())
            if cuda:
                try:
                    cuda_name = torch.cuda.get_device_name(0)
                except Exception:
                    cuda_name = "cuda"
            # mps 仅 macOS + PyTorch ≥ 1.12
            mps_backend = getattr(torch.backends, "mps", None)
            if mps_backend is not None:
                mps = bool(mps_backend.is_available()) and bool(mps_backend.is_built())
        except Exception:
            pass

        devices = [
            {
                "id": "cuda",
                "available": cuda,
                "label": f"cuda ({cuda_name})" if cuda else "cuda (未检测到 GPU)",
            },
            {
                "id": "mps",
                "available": mps,
                "label": "mps (Apple Silicon)" if mps else "mps (未检测到)",
            },
            {
                "id": "cpu",
                "available": True,
                "label": "cpu",
            },
        ]
        recommended = "cuda" if cuda else ("mps" if mps else "cpu")
        return jsonify({"devices": devices, "recommended": recommended})

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


    # ─── 离线 Bundle (PR6) ─────────────────────────────────

    @bp.route("/api/spawn-tuning-v2/policies/bundle/export", methods=["POST"])
    def export_bundle():
        """从 policies-{model_id}.json 文件导出 (export) 到客户端 bundle。

        POST body: { source: <path>, include_miniprogram: true }

        写出 3 个文件:
          web/public/spawn-tuning-v2/policies.json         (Web/Android/iOS)
          web/public/spawn-tuning-v2/policies.meta.json    (SHA-256 / model_id / 时间)
          miniprogram/core/tuning/spawnPoliciesV2.js       (微信小程序 CJS)
        """
        import hashlib
        data = request.get_json() or {}
        src = data.get("source")
        include_mp = bool(data.get("include_miniprogram", True))

        if not src:
            return jsonify({"error": "source path required"}), 400
        src_path = Path(src)
        if not src_path.exists():
            return jsonify({"error": f"source file not found: {src}"}), 404

        try:
            content = json.loads(src_path.read_text(encoding="utf-8"))
        except Exception as e:
            return jsonify({"error": f"parse failed: {e}"}), 400
        if content.get("format") != "openblock-spawn-tuning-v2-policies":
            return jsonify({"error": "unsupported format (expect v2-policies)"}), 400

        policies = content.get("policies", [])
        if not policies:
            return jsonify({"error": "empty policies"}), 400

        # 构造 bundle (与 client 期望结构一致)
        bundle = {
            "format": "openblock-spawn-tuning-v2-bundle",
            "version": "2.0.0",
            "n_contexts": len(policies),
            "generated_at": now_unix(),
            "model_sha256": content.get("model_sha256", ""),
            "rollout_pct": int(data.get("rollout_pct", 100)),
            "policies": [
                {
                    "context_key": p["context_key"],
                    "context": p.get("context", {}),
                    "theta": p.get("theta", {}),
                    "predicted_curve": p.get("predicted_curve", []),
                    "expected": p.get("expected", {}),
                }
                for p in policies
            ],
        }
        bundle_json = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
        sha = hashlib.sha256(bundle_json.encode("utf-8")).hexdigest()

        # 写文件
        results = {"written": [], "errors": []}
        bundle_dir = Path("web/public/spawn-tuning-v2")
        bundle_dir.mkdir(parents=True, exist_ok=True)

        try:
            (bundle_dir / "policies.json").write_text(bundle_json, encoding="utf-8")
            results["written"].append(str(bundle_dir / "policies.json"))
            meta = {
                "version": "2.0.0",
                "n_contexts": len(policies),
                "generated_at": bundle["generated_at"],
                "generated_at_iso": time.strftime(
                    "%Y-%m-%dT%H:%M:%S", time.localtime(bundle["generated_at"])
                ),
                "model_sha256": content.get("model_sha256", ""),
                "rollout_pct": bundle["rollout_pct"],
                "sha256": sha,
                "average_curve_mae": content.get("average_curve_mae"),
            }
            (bundle_dir / "policies.meta.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
            )
            results["written"].append(str(bundle_dir / "policies.meta.json"))
        except Exception as e:
            results["errors"].append(f"web bundle write failed: {e}")
            return jsonify(results), 500

        if include_mp:
            try:
                mp_dir = Path("miniprogram/core/tuning")
                mp_dir.mkdir(parents=True, exist_ok=True)
                mp_path = mp_dir / "spawnPoliciesV2.js"
                mp_body = (
                    "/**\n"
                    " * 小程序运行时数据模块 — 出块寻参 v2 策略 (离线包)\n"
                    f" * 自动生成于: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                    f" * 模型 SHA-256: {content.get('model_sha256','')}\n"
                    f" * 策略数: {len(policies)}\n"
                    f" * 灰度比例: {bundle['rollout_pct']}%\n"
                    " *\n"
                    " * 来源: spawn_tuning_v2_backend.export_bundle()\n"
                    " * 同步脚本: scripts/sync-core.sh (复制到小程序包)\n"
                    " */\n"
                    "module.exports = " + json.dumps(bundle, ensure_ascii=False, indent=2) + ";\n"
                )
                mp_path.write_text(mp_body, encoding="utf-8")
                results["written"].append(str(mp_path))
            except Exception as e:
                results["errors"].append(f"miniprogram write failed: {e}")

        return jsonify({
            "ok": True,
            "policies_count": len(policies),
            "sha256": sha,
            "bundle_size_bytes": len(bundle_json),
            "generated_at": bundle["generated_at"],
            **results,
        })


    @bp.route("/api/spawn-tuning-v2/policies/bundle/status", methods=["GET"])
    def bundle_status():
        """查询当前已导出 bundle 的元数据。"""
        bundle_dir = Path("web/public/spawn-tuning-v2")
        bundle_file = bundle_dir / "policies.json"
        meta_file = bundle_dir / "policies.meta.json"
        if not bundle_file.exists() or not meta_file.exists():
            return jsonify({"exists": False, "bundle_dir": str(bundle_dir)})
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except Exception:
            meta = {}
        return jsonify({
            "exists": True,
            "bundle_path": str(bundle_file),
            "bundle_size_bytes": bundle_file.stat().st_size,
            "modified_at": int(bundle_file.stat().st_mtime),
            "meta": meta,
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

    # 启动后台 job 执行器 (可通过环境变量禁用, 例如测试时)
    if os.environ.get("SPAWN_TUNING_V2_DISABLE_EXECUTOR") != "1":
        try:
            from rl_pytorch.spawn_tuning_v2.job_executor import start_job_executor
            start_job_executor(DB_PATH)
        except Exception as e:
            print(f"[spawn_tuning_v2] job executor 未启动: {e}")
