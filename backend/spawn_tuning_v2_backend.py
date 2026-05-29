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
    from backend.spawn_tuning_v2_backend import register_v2_routes
    register_v2_routes(app)
"""
from __future__ import annotations
import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Dict, List, Optional

from flask import Blueprint, Response, current_app, jsonify, request


# ─────────── 配置 ───────────

DB_PATH = os.environ.get("SPAWN_TUNING_V2_DB", ".cursor-stress-logs/spawn-tuning-v2.sqlite")
SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "spawn_tuning_v2.sql"

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
    # v2.10.32 (P0): 历史 DB 没有 n_bins_filled / bin_counts_json 列, 启动时补
    _existing_cols = {r[1] for r in conn.execute("PRAGMA table_info(samples)").fetchall()}
    if "n_bins_filled" not in _existing_cols:
        conn.execute("ALTER TABLE samples ADD COLUMN n_bins_filled INTEGER")
    if "bin_counts_json" not in _existing_cols:
        conn.execute("ALTER TABLE samples ADD COLUMN bin_counts_json TEXT")
    # v2.10.37: 检测 samples CHECK 约束是否过时 (v2.10.34/35 加了 heuristic-rule / generative / rl-bot)
    #   SQLite 不支持 ALTER TABLE 改 CHECK, 必须重建表
    _migrate_samples_check_constraints(conn)
    # θ 维度变化时 purge 老样本 (旧 θ 只有 9 维, 跟新 27 维 不兼容)
    _purge_legacy_theta_samples(conn)
    conn.commit()
    conn.close()


def _purge_legacy_theta_samples(conn):
    """检查首条 samples.theta_json key 数, 若 < 当前 THETA_KEYS 数则全部 purge.

    避免:
      - 老 θ (9 维) 跟新 θ (27 维) 混训
      - 模型读到缺字段的 theta_dict 时静默 fallback 中点, 导致 ctx → θ 映射失真
    清空 samples 表 + 重置 sample_sets.sample_count.
    """
    try:
        from rl_pytorch.spawn_tuning_v2.feature_io import THETA_KEYS
    except Exception:
        return
    expected = len(THETA_KEYS)
    row = conn.execute(
        "SELECT theta_json FROM samples WHERE theta_json IS NOT NULL LIMIT 1"
    ).fetchone()
    if not row:
        return   # 空表, 无需操作
    try:
        theta = json.loads(row[0])
        actual = len(theta) if isinstance(theta, dict) else 0
    except (ValueError, TypeError):
        actual = 0
    if actual >= expected:
        return
    n = conn.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
    print(f"[ensure_schema] θ 维度从 {actual} 升级到 {expected}, 清空 {n} 条老样本 ...")
    conn.execute("DELETE FROM samples")
    conn.execute("UPDATE sample_sets SET sample_count = 0")
    conn.commit()


def _migrate_samples_check_constraints(conn):
    """v3.0.8: GENERATOR 与游戏页面 1:1 严格对齐 ('rule' / 'generative').

    迁移逻辑:
      1. 检测 samples CHECK 约束: 若不是 ['rule', 'generative'] 唯二, 需要重建
      2. **删除** 所有 generator NOT IN ('rule', 'generative') 的老样本
         (旧枚举 triplet-p1 / budget-p2 / heuristic-rule / model-v3 / generative-* 全部 purge)
      3. 用新 schema 重建 samples 表 (CHECK 收紧)
    """
    row = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='samples'").fetchone()
    if not row or not row[0]:
        return
    table_sql = row[0]
    # v3.0.8 严格 CHECK: 仅含 'rule' / 'generative', 且 token 总数恰好 2 个
    forbidden_old_tokens = [
        "'triplet-p1'", "'budget-p2'", "'heuristic-rule'", "'model-v3'",
    ]
    has_strict_check = (
        "'rule'" in table_sql
        and "'generative'" in table_sql
        and not any(tok in table_sql for tok in forbidden_old_tokens)
    )
    if has_strict_check:
        return   # CHECK 已是 v3.0.8 严格枚举
    print("[ensure_schema] v3.0.8 migrate: 收紧 samples CHECK 为 (rule / generative), 删除老 generator 样本 ...")
    # 用 schema.sql 完整定义重建. 但 schema.sql 里 CREATE TABLE IF NOT EXISTS 不会重建,
    # 所以这里手动 DROP 老表 + 用 schema.sql 重建 + 把老数据 copy 回来.
    conn.execute("BEGIN")
    try:
        # 1. snapshot 老数据到 temp 表 (含老 generator 的样本)
        conn.execute("CREATE TABLE samples_backup AS SELECT * FROM samples")
        purged = conn.execute(
            "SELECT COUNT(*) FROM samples_backup WHERE generator NOT IN ('rule', 'generative')"
        ).fetchone()[0]
        # 2. 老表 DROP
        conn.execute("DROP TABLE samples")
        # 3. 用 schema.sql 重建 (新 CHECK 严格)
        if SCHEMA_PATH.exists():
            conn.executescript(SCHEMA_PATH.read_text())
        # 4. 只 copy 符合新 CHECK 的样本 (即 generator IN ('rule', 'generative')) 回来
        old_cols_row = conn.execute("PRAGMA table_info(samples_backup)").fetchall()
        old_cols = [r[1] for r in old_cols_row]
        new_cols_row = conn.execute("PRAGMA table_info(samples)").fetchall()
        new_cols = {r[1] for r in new_cols_row}
        common = [c for c in old_cols if c in new_cols]
        col_list = ", ".join(common)
        conn.execute(
            f"INSERT INTO samples ({col_list}) SELECT {col_list} FROM samples_backup "
            f"WHERE generator IN ('rule', 'generative')"
        )
        conn.execute("DROP TABLE samples_backup")
        # 5. 同步 sample_sets.sample_count (老 set 的 count 含已 purge 的样本, 需重算)
        conn.execute(
            "UPDATE sample_sets SET sample_count = "
            "(SELECT COUNT(*) FROM samples WHERE samples.set_id = sample_sets.set_id)"
        )
        conn.execute("COMMIT")
        print(f"[ensure_schema] v3.0.8 migrate: 完成, 已 purge {purged} 条老 generator 样本; samples CHECK 收紧为 (rule / generative)")
    except Exception as e:
        conn.execute("ROLLBACK")
        print(f"[ensure_schema] v3.0.8 migrate 失败, 回滚: {e}")
        raise


def row_to_dict(row) -> dict:
    return {k: row[k] for k in row.keys()} if row else None


def now_unix() -> int:
    return int(time.time())


# ─────────── 主库 (openblock.db) 访问 ───────────
# import-behavior 把主库 spawn_dataset_samples (真实对局, append-only/WORM 原始档)
# 转换成 v2 寻参样本写入普通 sample_set; 主库只读。


def _main_db_path() -> str:
    """主库路径解析, 与 server.py 一致 (OPENBLOCK_DB_PATH > BLOCKBLAST_DB_PATH > 默认)。"""
    return (
        os.environ.get("OPENBLOCK_DB_PATH")
        or os.environ.get("BLOCKBLAST_DB_PATH")
        or str(Path(__file__).resolve().parent.parent / "openblock.db")
    )


def _main_db_conn():
    conn = sqlite3.connect(_main_db_path())
    conn.row_factory = sqlite3.Row
    return conn


# ─────────── Blueprint ───────────

def register_v2_routes(app):
    """把 v2 API 注册到主 Flask app。"""
    ensure_schema()
    bp = Blueprint("spawn_tuning_v2", __name__)

    # v2.9.5: 清洗 Infinity/NaN → None (非标准 JSON 会导致前端 JSON.parse 崩溃)
    def _sanitize_metrics(m):
        if isinstance(m, dict):
            return {k: _sanitize_metrics(v) for k, v in m.items()}
        if isinstance(m, float):
            import math
            if math.isnan(m) or math.isinf(m):
                return None
        return m

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
        # v2.10: 每个 sample_set 报告其样本主导算法版本 (供 UI 区分老 v2.9 vs 新 v2.10)
        sets = []
        for r in rows:
            d = row_to_dict(r)
            sid = d["set_id"]
            algo_row = db.execute(
                "SELECT algo_version, COUNT(*) AS n FROM samples WHERE set_id = ? "
                "GROUP BY algo_version ORDER BY n DESC LIMIT 1",
                (sid,),
            ).fetchone()
            d["algo_version"] = algo_row["algo_version"] if algo_row else None
            sets.append(d)
        db.close()

        return jsonify({
            "sample_sets": sets,
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
            "algo_version",   # v2.10
            # v2.10.32 (P0): bin 真实观察数据透明化
            "n_bins_filled", "bin_counts_json",
        ]
        placeholders = ",".join(["?"] * len(fields))
        sql = f"INSERT INTO samples ({','.join(fields)}) VALUES ({placeholders})"

        inserted = 0
        errors = 0
        for s in samples:
            try:
                _bc = s.get("bin_counts")
                _bc_json = json.dumps(_bc) if isinstance(_bc, list) else (
                    _bc if isinstance(_bc, str) else None
                )
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
                    s.get("algo_version", "v3.1"),    # v3.1 (G5): PB-aware d_step + θ 物理调制
                    s.get("n_bins_filled"),
                    _bc_json,
                )
                db.execute(sql, row)
                inserted += 1
            except (KeyError, ValueError, sqlite3.IntegrityError) as _err:
                errors += 1
                # v2.10.37: 暴露第一条具体错误信息 (sqlite CHECK 失败/类型不匹配/etc), 帮助 user 定位
                if errors <= 3:  # 只记前 3 条避免日志爆炸
                    print(f"[samples insert error #{errors}] {type(_err).__name__}: {_err} | sample ctx={s.get('difficulty')}/{s.get('generator')}/{s.get('bot_policy')}/{s.get('pb_bin')}/{s.get('lifecycle_stage')}")
                continue

        # 更新 sample_count
        db.execute(
            "UPDATE sample_sets SET sample_count = sample_count + ? WHERE set_id = ?",
            (inserted, set_id),
        )
        db.commit()
        db.close()
        # v2.10.37: 返回 first_error 给 UI, 不只是数字
        return jsonify({
            "inserted": inserted,
            "errors": errors,
            "received": len(samples),
            "first_error": None if errors == 0 else f"see server log for sqlite errors (first {min(errors, 3)} printed)",
        })

    @bp.route("/api/spawn-tuning-v2/import-behavior", methods=["POST"])
    def import_behavior_samples():
        """把主库玩家真实对局(spawn_dataset_samples)整理成 v2 寻参样本, 写入一个普通
        sample_set(tag=real,field,behavior), 之后与构造样本无差别地参与训练/评估。

        增量同步: 每条样本把来源 session_id 存进 samples.seed, 重复 sync 只转换
        新增的对局(已导入的 session_id 直接跳过), 首次后很快 → 可被前端自动调用。

        body(可选):
          name        样本集名(默认 '用户行为样本集 (寻参)')
          bot_policy  真人占位 policy(默认 'clear-greedy')
          difficulty  缺省难度(默认 'normal')
          limit       仅扫描最近 N 局(默认全部)
          rebuild     true=清空该集后全量重建(默认 false, 增量同步)
        """
        from rl_pytorch.spawn_tuning_v2.behavior_import import (
            session_to_v2_sample, is_valid_real_sample, REAL_QUALITY_DEFAULTS,
        )

        data = request.get_json(silent=True) or {}
        name = (data.get("name") or "用户行为样本集 (寻参可训)").strip()
        bot_policy = data.get("bot_policy") or "clear-greedy"
        difficulty = data.get("difficulty") or "normal"
        limit = data.get("limit")
        rebuild = bool(data.get("rebuild", False))
        # 「无效数据」质量门 (导入过滤 + 已入库清理); 传 min_steps=0&min_bins=0&min_score=0 可关闭
        q_steps = int(data.get("min_steps", REAL_QUALITY_DEFAULTS["min_steps"]))
        q_bins = int(data.get("min_bins", REAL_QUALITY_DEFAULTS["min_bins"]))
        q_score = int(data.get("min_score", REAL_QUALITY_DEFAULTS["min_score"]))

        # 1) 读主库真实对局(先于建集, 避免出错时残留空集)
        try:
            mconn = _main_db_conn()
        except Exception as e:
            return jsonify({"error": f"main db open failed: {e}"}), 500
        try:
            sql = ("SELECT session_id, user_id, score, pb_baseline, game_over_reason, payload "
                   "FROM spawn_dataset_samples ORDER BY packed_at DESC")
            if isinstance(limit, int) and limit > 0:
                sql += f" LIMIT {int(limit)}"
            rows = mconn.execute(sql).fetchall()
        except sqlite3.OperationalError:
            return jsonify({"error": "主库无 spawn_dataset_samples — 先打 /api/spawn-dataset/sync 回填"}), 400
        finally:
            try:
                mconn.close()
            except Exception:
                pass

        if not rows:
            return jsonify({"error": "无可导入的真实对局"}), 400

        # 2) 找/建样本集(按 name 复用)
        db = get_db()
        existing = db.execute(
            "SELECT set_id FROM sample_sets WHERE name = ? ORDER BY set_id LIMIT 1", (name,),
        ).fetchone()
        if existing:
            set_id = existing["set_id"]
            if rebuild:
                db.execute("DELETE FROM samples WHERE set_id = ?", (set_id,))
                db.execute("UPDATE sample_sets SET sample_count = 0 WHERE set_id = ?", (set_id,))
        else:
            cur = db.execute(
                "INSERT INTO sample_sets (name, description, config_json, status, tags, created_at) "
                "VALUES (?, ?, ?, 'collecting', 'real,field,behavior', ?)",
                (name, "玩家真实对局整理成的 v2 寻参样本(behavior_import, 增量同步)",
                 json.dumps({"source": "spawn_dataset_samples", "bot_policy": bot_policy}),
                 now_unix()),
            )
            set_id = cur.lastrowid

        # 清理已入库的「无效数据」(质量门收紧 / 旧数据): 删掉低于阈值的样本。
        # #37 是普通可变集(非 WORM), 可删; 删后其 session_id 退出 done_ids,
        # 下次同步重转时仍会被质量门挡住 → 不会被重新拉回。
        _cnt_before = db.execute(
            "SELECT COUNT(*) FROM samples WHERE set_id = ?", (set_id,)).fetchone()[0]
        db.execute(
            "DELETE FROM samples WHERE set_id = ? AND "
            "(survived_steps < ? OR n_bins_filled < ? OR final_score < ?)",
            (set_id, q_steps, q_bins, q_score),
        )
        cleaned = _cnt_before - db.execute(
            "SELECT COUNT(*) FROM samples WHERE set_id = ?", (set_id,)).fetchone()[0]

        # 已导入的 session_id(存在 samples.seed)→ 增量去重
        done_ids = set()
        if not rebuild:
            for row in db.execute(
                "SELECT seed FROM samples WHERE set_id = ? AND seed IS NOT NULL", (set_id,),
            ):
                done_ids.add(row["seed"])

        # 3) 转换 + 增量插入(seed=session_id)
        fields = [
            "set_id", "difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage",
            "theta_json", "d_curve_json", "final_score", "survived_steps",
            "clear_rate", "noMove_step", "pb_broke", "surprise_count",
            "seed", "evaluated_at", "algo_version", "n_bins_filled", "bin_counts_json",
        ]
        sql_ins = f"INSERT INTO samples ({','.join(fields)}) VALUES ({','.join(['?'] * len(fields))})"
        inserted = 0
        errors = 0
        skipped = 0
        already = 0
        invalid = 0
        now_ms = int(time.time() * 1000)
        for r in rows:
            sid = r["session_id"]
            if sid in done_ids:
                already += 1
                continue
            try:
                parsed = json.loads(r["payload"]) if r["payload"] else None
            except (ValueError, TypeError):
                parsed = None
            # payload 形如 {"frames": [...]}(server.py sync); 兼容裸 frames 数组
            frames = parsed.get("frames") if isinstance(parsed, dict) else parsed
            if not frames:
                skipped += 1
                continue
            meta = {
                "pb_baseline": r["pb_baseline"], "score": r["score"],
                "game_over_reason": r["game_over_reason"],
                "bot_policy": bot_policy, "difficulty": difficulty,
            }
            try:
                s = session_to_v2_sample(frames, meta)
            except Exception:
                s = None
            if s is None:
                skipped += 1
                continue
            # 「无效数据」质量门: 废局/无难度信号的不入库(自动同步下一致跳过, 不会复活)
            if not is_valid_real_sample(s, q_steps, q_bins, q_score):
                invalid += 1
                continue
            try:
                db.execute(sql_ins, (
                    set_id, s["difficulty"], s["generator"], s["bot_policy"],
                    int(s["pb_bin"]), s["lifecycle_stage"],
                    s["theta_json"], s["d_curve_json"], s.get("final_score"),
                    s.get("survived_steps"), s.get("clear_rate"), s.get("noMove_step", -1),
                    int(bool(s.get("pb_broke", False))), s.get("surprise_count", 0),
                    sid, now_ms, s.get("algo_version", "real-v1"),
                    s.get("n_bins_filled"), json.dumps(s.get("bin_counts")),
                ))
                inserted += 1
            except (sqlite3.IntegrityError, ValueError, KeyError) as e:
                errors += 1
                if errors <= 3:
                    print(f"[import-behavior insert error #{errors}] {type(e).__name__}: {e}")

        db.execute(
            "UPDATE sample_sets SET sample_count = "
            "(SELECT COUNT(*) FROM samples WHERE samples.set_id = ?) WHERE set_id = ?",
            (set_id, set_id),
        )
        total = db.execute("SELECT COUNT(*) FROM samples WHERE set_id = ?", (set_id,)).fetchone()[0]
        db.commit()
        db.close()
        return jsonify({
            "ok": True, "set_id": set_id, "name": name,
            "scanned": len(rows), "inserted": inserted, "already": already,
            "invalid": invalid, "cleaned": cleaned,
            "errors": errors, "skipped": skipped, "total": total,
            "quality": {"min_steps": q_steps, "min_bins": q_bins, "min_score": q_score},
        })

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
              AVG(surprise_count)    AS surprise_mean,
              AVG(n_bins_filled)     AS bins_filled_mean,
              MIN(n_bins_filled)     AS bins_filled_min,
              MAX(n_bins_filled)     AS bins_filled_max,
              AVG(final_score * 1.0 / pb_bin)  AS r_mean
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
            # v2.10.32 (P0.1): 真实观察 bin 数透明化
            #   高 PB 桶 (e.g. pb=25000) bot 打不到, n_bins_filled 通常很低,
            #   d_curve 在 r>1 段大部分是 _pbAwareDPbBase 先验填充,
            #   user 看到 bins_filled_mean << 20 时就知道该子集后段不真实。
            "bins_filled_mean": round(label_row["bins_filled_mean"] or 0, 1),
            "bins_filled_min": label_row["bins_filled_min"] or 0,
            "bins_filled_max": label_row["bins_filled_max"] or 0,
            # avg(score/pb): 反映 bot 实际触达的 r 区间
            "r_mean": round(label_row["r_mean"] or 0, 3),
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
                   pb_broke, surprise_count, seed, eval_ms, evaluated_at,
                   n_bins_filled
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

    @bp.route("/api/spawn-tuning-v2/sample-sets/<int:set_id>/quality", methods=["GET"])
    def sample_set_quality(set_id):
        """v2.10.8 G1: 数据质量分析视图 — 让用户知道数据决定的模型上限。

        返回:
          r_distribution:  final_score/pb 分布 (10 bin), 反映 bot 表现
          d_curve_stats:   平均 d_curve + 各 bin std, 反映数据 S 形质量
          bot_performance: avg_final_r, pb_break_rate, median_survived_steps
          quality_score:   0-1 综合分 (跨度/单调性/分布广度加权)
          warnings:        发现的数据问题列表
        """
        db = get_db()
        meta = db.execute(
            "SELECT * FROM sample_sets WHERE set_id = ?", (set_id,),
        ).fetchone()
        if not meta:
            db.close()
            return jsonify({"error": "sample_set not found"}), 404

        # 限制 5000 行采样 (大数据集避免阻塞)
        rows = db.execute(
            "SELECT pb_bin, final_score, survived_steps, pb_broke, "
            "       clear_rate, noMove_step, d_curve_json "
            "FROM samples WHERE set_id = ? LIMIT 5000",
            (set_id,),
        ).fetchall()
        db.close()

        if not rows:
            return jsonify({"set_id": set_id, "error": "empty sample set"}), 200

        # ─── r = final_score / pb 分布 ───
        ratios = [r["final_score"] / max(1, r["pb_bin"]) for r in rows]
        ratios_sorted = sorted(ratios)
        median_r = ratios_sorted[len(ratios_sorted) // 2]
        mean_r = sum(ratios) / len(ratios)
        max_r = ratios_sorted[-1]
        # 10 个 bin (0-0.2, 0.2-0.4, ..., 1.8-2.0)
        bin_edges = [i * 0.2 for i in range(11)]
        bin_counts = [0] * 10
        for r in ratios:
            b = min(9, int(r * 5))
            bin_counts[b] += 1
        # 关键比例
        ratio_low = sum(1 for r in ratios if r < 0.2) / len(ratios)
        ratio_above_pb = sum(1 for r in ratios if r >= 1.0) / len(ratios)

        # ─── d_curve 平均 + std ───
        import json as _json
        n_bins = 20
        col_sums = [0.0] * n_bins
        col_sq = [0.0] * n_bins
        n_curves = 0
        for r in rows:
            try:
                c = _json.loads(r["d_curve_json"])
                if len(c) != n_bins:
                    continue
                for i, v in enumerate(c):
                    col_sums[i] += v
                    col_sq[i] += v * v
                n_curves += 1
            except Exception:
                continue
        if n_curves == 0:
            return jsonify({"set_id": set_id, "error": "no valid d_curve"}), 200
        avg_curve = [col_sums[i] / n_curves for i in range(n_bins)]
        std_curve = [
            max(0.0, (col_sq[i] / n_curves - avg_curve[i] ** 2)) ** 0.5
            for i in range(n_bins)
        ]
        spread = avg_curve[-1] - avg_curve[0]
        # 跟 ★ ideal S 形比 (业务期望, v3.0.4 移除 calibrated 之后唯一参考)
        try:
            from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector, D_BASE, D_CAP
            ideal = target_curve_vector()
            ideal_spread = D_CAP - D_BASE
            ideal_mae = sum(abs(a - c) for a, c in zip(avg_curve, ideal)) / n_bins
        except Exception:
            ideal_spread = 0.90
            ideal_mae = None
        # 单调性 (相邻倒退 bin 数)
        n_decreasing = sum(1 for i in range(n_bins - 1) if avg_curve[i + 1] < avg_curve[i] - 0.005)

        # ─── bot 表现 ───
        pb_broke_rate = sum(1 for r in rows if r["pb_broke"]) / len(rows)
        survived = sorted(r["survived_steps"] or 0 for r in rows)
        median_survived = survived[len(survived) // 2]
        avg_clear_rate = sum(r["clear_rate"] or 0 for r in rows) / len(rows)
        no_move_rate = sum(1 for r in rows if (r["noMove_step"] or -1) >= 0) / len(rows)

        # ─── 综合质量评分 (0-1) ───
        score_spread = min(1.0, spread / 0.45)            # 0.45 = 理想跨度
        score_distribution = min(1.0, ratio_above_pb / 0.15)  # 15% 破 PB 是健康指标
        score_monotonic = 1.0 - n_decreasing / max(1, n_bins - 1)
        quality_score = round(0.4 * score_spread + 0.3 * score_distribution + 0.3 * score_monotonic, 2)

        # ─── 警告 ───
        warnings_list = []
        if ratio_low > 0.40:
            warnings_list.append(
                f"低 r 区样本占比 {ratio_low*100:.1f}% 偏高 (>40%), bot 偏弱 → 高 r bin 数据稀疏需先验填充"
            )
        if spread < 0.30:
            warnings_list.append(
                f"d_curve 跨度仅 {spread:.3f} (业务期望 ≥ 0.45) → 模型最多学到这个跨度, 预测 MAE vs ideal 下界 ≈ {0.50 - spread / 2:.3f}"
            )
        if pb_broke_rate < 0.05:
            warnings_list.append(
                f"破 PB 率仅 {pb_broke_rate*100:.1f}% (健康 10-20%) → 数据缺少 r>1 区域信号"
            )
        if no_move_rate < 0.01:
            warnings_list.append(
                "no_move 率 ≈ 0 → 数据没有 D=1.0 样本, 模型预测无法到达 ideal 顶部"
            )
        if n_decreasing > 3:
            warnings_list.append(
                f"d_curve 在 {n_decreasing} 个 bin 处倒退 → 形态不健康, 检查 d_step 算法"
            )

        return jsonify({
            "set_id": set_id,
            "name": meta["name"] if "name" in meta.keys() else None,
            "n_samples_total": meta["sample_count"] if "sample_count" in meta.keys() else len(rows),
            "n_samples_analyzed": len(rows),
            "r_distribution": {
                "bin_edges": bin_edges,
                "counts": bin_counts,
                "median_r": round(median_r, 4),
                "mean_r": round(mean_r, 4),
                "max_r": round(max_r, 4),
                "ratio_low_pct": round(ratio_low * 100, 1),    # < 0.2
                "ratio_above_pb_pct": round(ratio_above_pb * 100, 1),   # ≥ 1.0
            },
            "d_curve_stats": {
                "avg": [round(v, 4) for v in avg_curve],
                "std": [round(v, 4) for v in std_curve],
                "spread": round(spread, 4),
                "spread_vs_ideal": round(ideal_spread - spread, 4),  # gap to ideal S 跨度
                "ideal_mae": round(ideal_mae, 4) if ideal_mae is not None else None,
                "n_decreasing_bins": n_decreasing,
            },
            "bot_performance": {
                "pb_break_rate": round(pb_broke_rate, 4),
                "median_survived_steps": median_survived,
                "avg_clear_rate": round(avg_clear_rate, 4),
                "no_move_rate": round(no_move_rate, 4),
            },
            "quality_score": quality_score,
            "warnings": warnings_list,
        })

    @bp.route("/api/spawn-tuning-v2/sample-sets/<int:set_id>/download", methods=["GET"])
    def download_sample_set(set_id):
        """v2.10.16: 下载样本集 — 流式 JSONL (避免大集内存爆)。

        Query:
          format: 'jsonl' (default, 流式, 每行一个 sample) / 'json' (单一对象, 含 meta)
          gzip:   '1' 启用 gzip 压缩 (减小 70%+ 体积)
          limit:  整数, 仅前 N 条 (调试)

        Response: download as attachment, filename 含 set_id + set name + 时间戳
        """
        fmt = request.args.get("format", "jsonl").lower()
        if fmt not in ("jsonl", "json"):
            return jsonify({"error": "format must be 'jsonl' or 'json'"}), 400
        try:
            limit = int(request.args.get("limit", 0))
        except ValueError:
            return jsonify({"error": "invalid limit"}), 400
        use_gzip = request.args.get("gzip") == "1"

        db = get_db()
        meta = db.execute("SELECT * FROM sample_sets WHERE set_id = ?", (set_id,)).fetchone()
        if not meta:
            db.close()
            return jsonify({"error": "sample_set not found"}), 404
        meta_d = row_to_dict(meta)
        # 安全文件名 (去除特殊字符)
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in (meta["name"] or "sample-set"))
        ext = "json" if fmt == "json" else "jsonl"
        ext_full = ext + (".gz" if use_gzip else "")
        ts = time.strftime("%Y%m%d-%H%M%S")
        filename = f"sample-set-{set_id}-{safe_name}-{ts}.{ext_full}"

        # 流式 generator (不一次加载全部 samples 到内存)
        sql = "SELECT * FROM samples WHERE set_id = ? ORDER BY sample_id"
        params = [set_id]
        if limit > 0:
            sql += " LIMIT ?"
            params.append(limit)
        cursor = db.execute(sql, params)

        def _row_to_json(row):
            d = row_to_dict(row)
            # d_curve_json / theta_json 是字符串, 保持原状 (用户解析时再 json.loads)
            return json.dumps(d, ensure_ascii=False, separators=(",", ":"))

        def gen_jsonl():
            try:
                # JSONL 模式: 第 1 行是 meta header (type=meta), 后续每行 sample (type=sample)
                yield json.dumps({"type": "meta", "set": meta_d, "format_version": "v2.10.16"}, ensure_ascii=False) + "\n"
                for row in cursor:
                    yield _row_to_json(row) + "\n"
            finally:
                db.close()

        def gen_json():
            try:
                # JSON 模式: 单个对象, samples 数组流式拼接 (兼容标准 JSON 解析)
                yield '{"format_version":"v2.10.16","set":'
                yield json.dumps(meta_d, ensure_ascii=False, separators=(",", ":"))
                yield ',"samples":['
                first = True
                for row in cursor:
                    if first:
                        yield _row_to_json(row); first = False
                    else:
                        yield "," + _row_to_json(row)
                yield "]}"
            finally:
                db.close()

        raw_gen = gen_jsonl() if fmt == "jsonl" else gen_json()

        if use_gzip:
            import gzip
            import io

            def gen_gz():
                buf = io.BytesIO()
                gz = gzip.GzipFile(fileobj=buf, mode="wb", compresslevel=6)
                for chunk in raw_gen:
                    gz.write(chunk.encode("utf-8"))
                    if buf.tell() > 64 * 1024:  # 每 64KB flush
                        gz.flush()
                        yield buf.getvalue()
                        buf.seek(0); buf.truncate()
                gz.close()
                yield buf.getvalue()

            resp = Response(gen_gz(), mimetype="application/gzip")
        else:
            mime = "application/json" if fmt == "json" else "application/x-ndjson"
            resp = Response(raw_gen, mimetype=mime)

        resp.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
        # 不需要 X-Content-Type-Options 类的额外头 (Flask 默认会加 Connection: close)
        return resp

    @bp.route("/api/spawn-tuning-v2/sample-sets/<int:set_id>/scatter", methods=["GET"])
    def sample_set_scatter(set_id):
        """v3.0.16 (严格): 逐 sample 打点 — 每条 sample 1 个实测点 + (可选) 1 个预测点.

        每个 sample 产生:
          - r = final_score / pb (该 sample 跑完时的 r)
          - d_observed = sample.d_curve[final_bin]    (真实 bin 才算, 填充段跳过)
          - d_predicted = model(ctx, theta).curve[final_bin]   (model_id 提供时)

        Returns: { points: [[r, d_obs, d_pred_or_null, dim_key], ...] }
          v3.0.22: 固定 4 元组, d_pred 缺失时为 null. dim_key = "diff|gen|bot|pb|life",
              供前端按 group_by 维度分组散点 (替代以前的 group mean 折线).

        Query:
          model_id: optional — 提供时增加 d_predicted 列 (用 sample 的真实 ctx+θ 推断)
          difficulty/generator/bot_policy/pb_bin/lifecycle_stage: optional filter
          limit_samples: 0=全量 (上限 100k), N=最多 N (防 OOM)
        """
        # 全量默认, 0 = 不限制. 上限 100k 防 OOM.
        try:
            raw_limit = int(request.args.get("limit_samples", 0))
        except ValueError:
            return jsonify({"error": "invalid limit_samples"}), 400
        limit_samples = 100000 if raw_limit <= 0 else max(1, min(100000, raw_limit))
        model_id_arg = request.args.get("model_id")

        # 可选维度筛选
        where_parts = ["set_id = ?"]
        params: list = [set_id]
        for dim in ("difficulty", "generator", "bot_policy", "lifecycle_stage"):
            v = request.args.get(dim)
            if v:
                where_parts.append(f"{dim} = ?")
                params.append(v)
        pb_v = request.args.get("pb_bin")
        if pb_v:
            try:
                where_parts.append("pb_bin = ?")
                params.append(int(pb_v))
            except ValueError:
                pass

        where_sql = " AND ".join(where_parts)
        db = get_db()
        if not db.execute("SELECT 1 FROM sample_sets WHERE set_id = ?", (set_id,)).fetchone():
            db.close()
            return jsonify({"error": "sample_set not found"}), 404
        rows = db.execute(
            f"SELECT sample_id, difficulty, generator, bot_policy, pb_bin, lifecycle_stage, "
            f"final_score, d_curve_json, bin_counts_json, theta_json "
            f"FROM samples WHERE {where_sql} LIMIT ?",
            (*params, limit_samples),
        ).fetchall()
        db.close()

        import math
        try:
            from rl_pytorch.spawn_tuning_v2.target_curve import CURVE_N_BINS, CURVE_R_MAX
            from rl_pytorch.spawn_tuning_v2.feature_io import (
                DIFFICULTY_INDEX, GENERATOR_INDEX, BOT_INDEX, PB_BIN_INDEX, LIFECYCLE_INDEX,
                normalize_theta,
            )
        except Exception:
            return jsonify({"error": "spawn_tuning_v2 module unavailable"}), 503
        bin_width = CURVE_R_MAX / CURVE_N_BINS

        # ─── 第 1 步: 收集每 sample 的实测点 (final_r, final_bin, d_observed) ───
        # 同时记录 ctx 索引 + theta_norm (用于后续 batch predict)
        sample_entries = []   # [{r_final, final_bin, d_obs, ctx_idx_dict, theta_norm}]
        for r in rows:
            pb = r["pb_bin"]
            score = r["final_score"]
            if not pb or pb <= 0 or score is None:
                continue
            r_final = min(CURVE_R_MAX - 1e-9, score / pb)
            final_bin = int(r_final / bin_width)
            try:
                curve = json.loads(r["d_curve_json"])
                bc = json.loads(r["bin_counts_json"]) if r["bin_counts_json"] else None
            except (TypeError, ValueError):
                continue
            if not isinstance(curve, list) or len(curve) != CURVE_N_BINS:
                continue
            # 只取真实观察 bin (bin_counts[final_bin] > 0); 否则该 sample 跳过 (填充段不算)
            if not bc or len(bc) != CURVE_N_BINS or (bc[final_bin] or 0) == 0:
                continue
            d_obs = curve[final_bin]
            # v3.0.22: dim_key = "diff|gen|bot|pb|life" 供前端按 group_by 维度散点分组
            #   (pb_bin 是 int, 转 str 才能拼接; lifecycle_stage 可能为 None → "?")
            dim_key = "|".join([
                str(r["difficulty"] or "?"),
                str(r["generator"] or "?"),
                str(r["bot_policy"] or "?"),
                str(r["pb_bin"] or "?"),
                str(r["lifecycle_stage"] or "?"),
            ])
            entry = {
                "r": round(r_final, 4), "d_obs": round(d_obs, 4),
                "final_bin": final_bin, "dim_key": dim_key,
            }
            if model_id_arg:
                try:
                    entry["ctx_idx"] = {
                        "difficulty_idx": DIFFICULTY_INDEX[r["difficulty"]],
                        "generator_idx": GENERATOR_INDEX[r["generator"]],
                        "bot_idx": BOT_INDEX[r["bot_policy"]],
                        "pb_bin_idx": PB_BIN_INDEX[int(r["pb_bin"])],
                        "lifecycle_idx": LIFECYCLE_INDEX[r["lifecycle_stage"]],
                        "log_pb": math.log10(max(1.0, float(r["pb_bin"]))),
                    }
                    if r["theta_json"]:
                        theta_dict = json.loads(r["theta_json"])
                        entry["theta_norm"] = normalize_theta(theta_dict).tolist()
                except (KeyError, ValueError, TypeError):
                    pass
            sample_entries.append(entry)

        # ─── 第 2 步: 若提供 model_id, batch forward 拿每 sample 的 d_predicted ───
        if model_id_arg and sample_entries:
            try:
                model_id = int(model_id_arg)
            except ValueError:
                model_id = None
            if model_id:
                # 加载 model (同 predict-curve 路径)
                try:
                    import torch
                    from rl_pytorch.spawn_tuning_v2.model import (
                        SpawnParamTunerResNet, SpawnParamTunerTransformer,
                        N_THETA, N_CURVE_BINS as _NCB, load_state_dict_compat,
                    )
                except Exception as e:
                    return jsonify({"error": f"torch unavailable: {e}"}), 503
                db = get_db()
                row = db.execute(
                    "SELECT weights_path, model_type FROM models WHERE model_id = ?",
                    (model_id,),
                ).fetchone()
                db.close()
                if row and row["weights_path"] and Path(row["weights_path"]).exists():
                    try:
                        ck = torch.load(row["weights_path"], map_location="cpu", weights_only=False)
                        arch = ck.get("arch", {}) or {}
                        mt = (arch.get("model_type") or row["model_type"] or "resnet").lower()
                        if mt == "transformer":
                            model = SpawnParamTunerTransformer(
                                d_model=arch.get("d_model", 64),
                                n_layers=arch.get("n_layers", 3),
                                curve_bins=arch.get("curve_bins", _NCB),
                            )
                        else:
                            model = SpawnParamTunerResNet(
                                hidden_dim=arch.get("hidden_dim", 128),
                                n_blocks=arch.get("n_blocks", 8),
                                curve_bins=arch.get("curve_bins", _NCB),
                            )
                        load_state_dict_compat(model, ck["model_state_dict"])
                        model.eval()

                        # 过滤出有 ctx_idx 的 entries 做 batch forward
                        predictable = [e for e in sample_entries if "ctx_idx" in e]
                        if predictable:
                            N = len(predictable)
                            diff_t = torch.tensor([e["ctx_idx"]["difficulty_idx"] for e in predictable], dtype=torch.long)
                            gen_t = torch.tensor([e["ctx_idx"]["generator_idx"] for e in predictable], dtype=torch.long)
                            bot_t = torch.tensor([e["ctx_idx"]["bot_idx"] for e in predictable], dtype=torch.long)
                            pb_t = torch.tensor([e["ctx_idx"]["pb_bin_idx"] for e in predictable], dtype=torch.long)
                            life_t = torch.tensor([e["ctx_idx"]["lifecycle_idx"] for e in predictable], dtype=torch.long)
                            log_pb_t = torch.tensor([e["ctx_idx"]["log_pb"] for e in predictable], dtype=torch.float32)
                            # theta: 缺失的用 0.5 中点 fallback
                            theta_list = [
                                e.get("theta_norm") if isinstance(e.get("theta_norm"), list) and len(e["theta_norm"]) == N_THETA
                                else [0.5] * N_THETA
                                for e in predictable
                            ]
                            theta_t = torch.tensor(theta_list, dtype=torch.float32)
                            with torch.no_grad():
                                preds = model(
                                    difficulty_idx=diff_t, generator_idx=gen_t, bot_idx=bot_t,
                                    pb_bin_idx=pb_t, lifecycle_idx=life_t, log_pb=log_pb_t,
                                    theta_norm=theta_t,
                                )
                                curves = preds["curve"].cpu().numpy()
                            for i, e in enumerate(predictable):
                                e["d_pred"] = round(float(curves[i][e["final_bin"]]), 4)
                    except Exception as e:
                        # model 加载/推断失败 — 静默, 只返回实测点
                        pass

        # ─── 第 3 步: 输出 points 数组 ───
        # v3.0.22: 固定 4 元组 [r, d_obs, d_pred_or_null, dim_key], 简化前端处理
        #   dim_key = "diff|gen|bot|pb|life", 让前端按 group_by 维度分组散点
        points = []
        for e in sample_entries:
            d_pred = e.get("d_pred")
            points.append([e["r"], e["d_obs"], d_pred, e["dim_key"]])

        return jsonify({
            "set_id": set_id,
            "n_samples_used": len(rows),
            "n_points": len(points),
            "r_max": CURVE_R_MAX,
            "with_prediction": bool(model_id_arg),
            # v3.0.22: schema 标识, 客户端可据此识别是否带 dim_key
            "schema": "v3.0.22",
            "points": points,
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

        # v2.10.32 (P0.1): 同时拿 n_bins_filled 透明化
        # v3.0.12: 同时拿 theta_json 用于"模型预测" 的实时推理 (用 sample 的真实 θ 而非 0.5)
        # v3.0.14 (A): 拿 bin_counts_json 算每个 bin 的真实观察数, 区分 mean 是真实统计还是 lastValue 填充
        if groups:
            group_cols = ", ".join(groups)
            rows = db.execute(
                f"SELECT {group_cols}, d_curve_json, n_bins_filled, final_score, pb_bin, theta_json, bin_counts_json "
                f"FROM samples WHERE set_id = ?",
                (set_id,),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT d_curve_json, n_bins_filled, final_score, pb_bin, theta_json, bin_counts_json FROM samples WHERE set_id = ?",
                (set_id,),
            ).fetchall()
        db.close()

        # 拿 THETA_KEYS 用于解析 + 排序
        try:
            from rl_pytorch.spawn_tuning_v2.feature_io import THETA_KEYS, THETA_RANGES, normalize_theta
            theta_keys = list(THETA_KEYS)
        except Exception:
            theta_keys = []
            normalize_theta = None

        # 按分组聚合
        from collections import defaultdict
        bucket = defaultdict(lambda: {"curves": [], "filled": [], "rs": [], "thetas_norm": [], "bin_counts_sum": [0] * 20})
        for r in rows:
            try:
                curve = json.loads(r["d_curve_json"])
            except (TypeError, ValueError):
                continue
            if len(curve) != 20:
                continue
            key = tuple(r[g] for g in groups) if groups else ()
            bucket[key]["curves"].append(curve)
            if r["n_bins_filled"] is not None:
                bucket[key]["filled"].append(int(r["n_bins_filled"]))
            pb = r["pb_bin"]
            score = r["final_score"]
            if pb and pb > 0 and score is not None:
                bucket[key]["rs"].append(score / pb)
            # v3.0.12: θ normalized 用于"模型预测"实时推理
            if normalize_theta is not None and r["theta_json"]:
                try:
                    theta_dict = json.loads(r["theta_json"])
                    theta_norm = normalize_theta(theta_dict).tolist()
                    bucket[key]["thetas_norm"].append(theta_norm)
                except (TypeError, ValueError, KeyError):
                    pass
            # v3.0.14 (A): 累加 bin_counts → 算每 bin 真实观察数
            if r["bin_counts_json"]:
                try:
                    bc = json.loads(r["bin_counts_json"])
                    if isinstance(bc, list) and len(bc) == 20:
                        for i, c in enumerate(bc):
                            bucket[key]["bin_counts_sum"][i] += int(c or 0)
                except (TypeError, ValueError):
                    pass

        results = []
        for key, data in bucket.items():
            curves = data["curves"]
            arr = [[c[i] for c in curves] for i in range(20)]
            avg = [sum(col) / len(col) for col in arr]
            filled = data["filled"]
            rs = data["rs"]
            thetas = data["thetas_norm"]
            # v3.0.14 (A): 真实观察占比 = 该 bin 真实观察数 / 总 sample 数
            #   1.0 = 所有 sample 都在该 bin 有真实数据
            #   0.0 = 所有 sample 在该 bin 都是 lastValue 填充 (mean 是假的)
            bcs = data["bin_counts_sum"]
            n_total = len(curves)
            bin_real_ratio = [round(c / max(1, n_total), 4) for c in bcs] if n_total else [0.0] * 20
            entry = {
                "d_curve_avg": avg,
                "n_samples": n_total,
                # v2.10.32 (P0.1): 真实观察比例 — UI 显示告知 user 后段是 prior 填充
                "bins_filled_mean": round(sum(filled) / len(filled), 1) if filled else None,
                "r_mean": round(sum(rs) / len(rs), 3) if rs else None,
                # v3.0.12: per-ctx 平均 θ_norm — 供"模型预测"实时推理用 (与实测对齐)
                "theta_norm_avg": (
                    [round(sum(col) / len(col), 6) for col in [[t[i] for t in thetas] for i in range(len(thetas[0]))]]
                    if thetas else None
                ),
                # v3.0.14 (A): 每 bin 真实观察占比 (0~1), chart 渲染时用作"真实/填充"视觉区分
                "bin_real_ratio": bin_real_ratio,
            }
            for i, g in enumerate(groups):
                entry[g] = key[i]
            results.append(entry)
        return jsonify({"set_id": set_id, "groups": groups, "buckets": results})

    # ─── 模型 ────────────────────────────────────────────

    @bp.route("/api/spawn-tuning-v2/models", methods=["GET"])
    def list_models():
        """v2.10.12: 加 offset / total 分页支持."""
        status = request.args.get("status")
        try:
            limit = max(1, min(500, int(request.args.get("limit", 50))))
            offset = max(0, int(request.args.get("offset", 0)))
        except ValueError:
            return jsonify({"error": "invalid limit/offset"}), 400
        db = get_db()
        # 总数 (用于前端分页器)
        count_sql = "SELECT COUNT(*) FROM models WHERE 1=1"
        count_params = []
        if status:
            count_sql += " AND status = ?"
            count_params.append(status)
        total = db.execute(count_sql, count_params).fetchone()[0]
        # 实际数据
        sql = "SELECT * FROM models WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = db.execute(sql, params).fetchall()
        db.close()
        out = []
        for r in rows:
            d = row_to_dict(r)
            try:
                d["metrics"] = _sanitize_metrics(json.loads(d.get("metrics_json") or "{}"))
            except Exception:
                d["metrics"] = {}
            out.append(d)
        return jsonify({
            "models": out,
            "count": len(out),
            "total": total,
            "limit": limit,
            "offset": offset,
        })

    @bp.route("/api/spawn-tuning-v2/models/<int:model_id>", methods=["GET"])
    def get_model(model_id):
        db = get_db()
        row = db.execute("SELECT * FROM models WHERE model_id = ?", (model_id,)).fetchone()
        db.close()
        if not row:
            return jsonify({"error": "not found"}), 404
        d = row_to_dict(row)
        try:
            d["metrics"] = _sanitize_metrics(json.loads(d.get("metrics_json") or "{}"))
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
          theta_norm: [9 floats]                    # 单 θ, 全 ctx 共用 (老 mode)
          # OR
          theta_norm_per_ctx: [[9 floats], ...]    # v3.0.12: 每 ctx 用不同 θ
                                                    # 长度需 == len(contexts)
                                                    # 跟"实测均值"对齐评估时用
        }
        return: { curves: [[20 floats], ...], n_contexts: ... }
        """
        try:
            import torch
            from rl_pytorch.spawn_tuning_v2.model import (
                SpawnParamTunerResNet, SpawnParamTunerTransformer,
                N_THETA, N_CURVE_BINS,
            )
            from rl_pytorch.spawn_tuning_v2.feature_io import (
                DIFFICULTY_INDEX, GENERATOR_INDEX, BOT_INDEX, PB_BIN_INDEX, LIFECYCLE_INDEX,
            )
        except Exception as e:
            return jsonify({"error": f"torch/model not available: {e}"}), 503

        body = request.get_json() or {}
        contexts = body.get("contexts") or []
        if not contexts:
            return jsonify({"error": "contexts required"}), 400
        # v3.0.12: 优先用 per-ctx θ (来自 sample set aggregate.theta_norm_avg), 否则 fallback 单 θ
        theta_norm_per_ctx = body.get("theta_norm_per_ctx")
        theta_norm = body.get("theta_norm")
        if theta_norm_per_ctx is not None:
            if len(theta_norm_per_ctx) != len(contexts):
                return jsonify({"error": "theta_norm_per_ctx length must match contexts"}), 400
            if any((t is None or len(t) != N_THETA) for t in theta_norm_per_ctx):
                return jsonify({"error": f"each theta_norm_per_ctx[i] must have length {N_THETA}"}), 400
        else:
            if theta_norm is None:
                theta_norm = [0.5] * N_THETA
            if len(theta_norm) != N_THETA:
                return jsonify({"error": f"theta_norm must have length {N_THETA}"}), 400

        db = get_db()
        row = db.execute(
            "SELECT weights_path, model_type FROM models WHERE model_id = ?",
            (model_id,),
        ).fetchone()
        db.close()
        if not row or not row["weights_path"]:
            return jsonify({"error": "model not found or has no weights_path"}), 404

        try:
            ck = torch.load(row["weights_path"], map_location="cpu", weights_only=False)
            arch = ck.get("arch", {}) or {}
            # v2.9.2: 按 arch.model_type 选模型类构造 — 修复 transformer 推断 500
            #   优先级: arch.model_type (训练时记录) > models.model_type 列 > "resnet" 兜底
            mt = (arch.get("model_type") or row["model_type"] or "resnet").lower()
            if mt == "transformer":
                model = SpawnParamTunerTransformer(
                    d_model=arch.get("d_model", 64),
                    n_layers=arch.get("n_layers", 3),
                    curve_bins=arch.get("curve_bins", N_CURVE_BINS),
                )
            else:
                model = SpawnParamTunerResNet(
                    hidden_dim=arch.get("hidden_dim", 128),
                    n_blocks=arch.get("n_blocks", 8),
                    curve_bins=arch.get("curve_bins", N_CURVE_BINS),
                )
            # v2.10.33 (P2.2 兼容): strict=False 让老 ckpt (无 head_r) 也能加载
            # v2.10.34: + load_state_dict_compat — embedding 维度变了 (N_GEN/BOT 扩) 也能加载
            from rl_pytorch.spawn_tuning_v2.model import load_state_dict_compat
            missing, unexpected = load_state_dict_compat(model, ck["model_state_dict"])
            if missing or unexpected:
                print(f"[load-model #{model_id}] warn — missing: {missing[:3]} unexpected: {unexpected[:3]}")
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

        # v2.10.32 (P2.3): 可选 MC Dropout uncertainty (body.uncertainty=true)
        want_uncertainty = bool(body.get("uncertainty"))
        n_mc_samples = max(5, min(100, int(body.get("n_mc_samples", 30))))

        # v3.0.12: 优先 per-ctx θ
        if theta_norm_per_ctx is not None:
            theta_t = torch.tensor(theta_norm_per_ctx, dtype=torch.float32)
        else:
            theta_t = torch.tensor([theta_norm] * len(contexts), dtype=torch.float32)
        kwargs = dict(
            difficulty_idx=torch.tensor(diffs, dtype=torch.long),
            generator_idx=torch.tensor(gens, dtype=torch.long),
            bot_idx=torch.tensor(bots, dtype=torch.long),
            pb_bin_idx=torch.tensor(pbs, dtype=torch.long),
            lifecycle_idx=torch.tensor(lifes, dtype=torch.long),
            log_pb=torch.tensor(log_pbs, dtype=torch.float32),
            theta_norm=theta_t,
        )

        resp = {
            "model_id": model_id,
            "n_contexts": len(contexts),
        }
        if want_uncertainty and hasattr(model, "predict_with_uncertainty"):
            mc = model.predict_with_uncertainty(n_samples=n_mc_samples, **kwargs)
            resp["curves"] = mc["curve_mean"].cpu().numpy().tolist()
            resp["curves_std"] = mc["curve_std"].cpu().numpy().tolist()
            resp["r_pred"] = mc["r_mean"].cpu().numpy().tolist() if "r_mean" in mc else None
            resp["r_std"] = mc["r_std"].cpu().numpy().tolist() if "r_std" in mc else None
            resp["mc_samples"] = mc["n_samples"]
        else:
            with torch.no_grad():
                preds = model(**kwargs)
                resp["curves"] = preds["curve"].cpu().numpy().tolist()
                # v2.10.32 (P2.2): 暴露 r_value head (model 实际触达 r 估计)
                if "r_value" in preds:
                    resp["r_pred"] = preds["r_value"].cpu().numpy().tolist()
        return jsonify(resp)

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
        """v2.10.12: 加 offset / total 分页支持."""
        status = request.args.get("status")
        try:
            limit = max(1, min(500, int(request.args.get("limit", 50))))
            offset = max(0, int(request.args.get("offset", 0)))
        except ValueError:
            return jsonify({"error": "invalid limit/offset"}), 400
        db = get_db()
        count_sql = "SELECT COUNT(*) FROM training_jobs WHERE 1=1"
        count_params = []
        if status:
            count_sql += " AND status = ?"
            count_params.append(status)
        total = db.execute(count_sql, count_params).fetchone()[0]
        sql = "SELECT * FROM training_jobs WHERE 1=1"
        params = []
        if status:
            sql += " AND status = ?"
            params.append(status)
        sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])
        rows = db.execute(sql, params).fetchall()
        db.close()
        return jsonify({
            "jobs": [row_to_dict(r) for r in rows],
            "count": len(rows),
            "total": total,
            "limit": limit,
            "offset": offset,
        })

    @bp.route("/api/spawn-tuning-v2/jobs", methods=["POST"])
    def create_job():
        data = request.get_json() or {}
        if not data.get("sample_set_ids"):
            return jsonify({"error": "sample_set_ids required"}), 400
        # v2.10.10: 增量训练架构兼容检查 (fail-fast, 不到 train.py 才报错)
        model_type = data.get("model_type", "resnet")
        base_model_id = data.get("base_model_id")
        if base_model_id:
            db_check = get_db()
            base = db_check.execute(
                "SELECT model_type FROM models WHERE model_id = ?", (base_model_id,),
            ).fetchone()
            db_check.close()
            if not base:
                return jsonify({"error": f"base_model_id={base_model_id} not found"}), 404
            base_mt = base["model_type"] or "resnet"
            if base_mt != model_type:
                return jsonify({
                    "error": f"架构不匹配: base_model #{base_model_id} 是 {base_mt}, "
                             f"当前选了 {model_type}。增量训练只能加载同架构 ckpt。"
                             f"\n→ 改 model_type={base_mt} 或选其他 base_model"
                }), 400
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

    @bp.route("/api/spawn-tuning-v2/jobs/<int:job_id>/log", methods=["GET"])
    def get_job_log(job_id):
        """任务关键日志 — 供 C.2 队列展开行展示失败/进度的根因。

        返回:
          status / error_message: jobs 表字段
          key_lines:  从日志里抽取的"关键问题"行 (Traceback / Error / raise / ✗ failed / rc= ...)
          tail:       日志尾部最多 tail_lines 行 (默认 120, 上限 500)
          exists / log_path / lines_total: 元信息
        """
        from pathlib import Path
        try:
            tail_lines = max(1, min(500, int(request.args.get("tail", 120))))
        except ValueError:
            tail_lines = 120

        db = get_db()
        row = db.execute(
            "SELECT job_id, status, error_message, output_model_id, log_path "
            "FROM training_jobs WHERE job_id = ?",
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

        # 候选日志路径 (同 metrics-history 优先级): <weights>.log → CHECKPOINTS_DIR glob → jobs.log_path
        candidates = []
        if weights_path:
            candidates.append(Path(weights_path + ".log"))
        else:
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

        log_file = next((p for p in candidates if p.exists()), None)
        lines = []
        if log_file:
            try:
                with open(log_file, "r", encoding="utf-8", errors="ignore") as f:
                    lines = f.read().splitlines()
            except OSError:
                lines = []

        # "关键问题"抽取 — 命中错误/失败相关关键词的行 (大小写不敏感)
        KEY_PAT = (
            "traceback", "error", "exception", "raise ", "✗ failed",
            "rc=", "no samples", "valueerror", "runtimeerror", "assert",
            "cuda", "out of memory", "oom", "failed", "fatal",
        )
        key_lines = []
        for i, ln in enumerate(lines):
            low = ln.lower()
            if any(k in low for k in KEY_PAT):
                key_lines.append({"n": i + 1, "text": ln})
        # 限制关键行数量, 保留首尾 (根因通常在 Traceback 末行)
        if len(key_lines) > 40:
            key_lines = key_lines[:8] + [{"n": -1, "text": "… (省略 %d 行) …" % (len(key_lines) - 28)}] + key_lines[-20:]

        return jsonify({
            "job_id": job_id,
            "status": row["status"],
            "error_message": row["error_message"],
            "log_path": str(log_file) if log_file else (row["log_path"] or None),
            "exists": log_file is not None,
            "lines_total": len(lines),
            "key_lines": key_lines,
            "tail": "\n".join(lines[-tail_lines:]),
        })

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
            "SELECT job_id, status, output_model_id, log_path, arch_json FROM training_jobs WHERE job_id = ?",
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
                                # v2.9.4: 退化解检测
                                "val_curve_var": float(d.get("val_curve_var", 0)),
                                # v3.0.2 / v3.0.4: 预测 vs ★ ideal target_S_curve MAE
                                "val_ideal_mae": float(d.get("val_ideal_mae", 0)),
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

        # G18 v2.10.19: 暴露 total_epochs 让前端算 ETA
        total_epochs = 50  # default
        try:
            arch = json.loads(row["arch_json"] or "{}")
            total_epochs = int(arch.get("epochs", 50))
        except Exception:
            pass
        return jsonify({
            "job_id": job_id,
            "status": row["status"],
            "total_epochs": total_epochs,
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


    @bp.route("/api/spawn-tuning-v2/models/<int:model_id>/biz-scorecard", methods=["GET"])
    def biz_scorecard(model_id):
        """G15 v2.10.19: 业务命题达成度仪表盘 — 把模型表现折成 4 项业务命题评分.

        业务命题 (用户原诉求, 2026-05-25 16:08 / 11:32):
          1. 公平: 不同 ctx 间模型预测均匀 → 用 cross-ctx variance 算
          2. 爽点: 接近 PB 时确实加压 → 用 d_pb_base 在 r=0.85-1.0 的梯度算
          3. 平衡: 整体形态贴合 ★ ideal S → 用 val_ideal_mae (v3.0.4 起)
          4. 惊喜: 模型不退化 (输出有形态变化) → 用 val_curve_var

        返回:
          overall_score (0-100, 4 项加权平均)
          dimensions: { fairness, tension, balance, surprise } 各 0-100
          grade: 'A' (≥85) / 'B' (≥70) / 'C' (≥55) / 'D' (<55)
          hints: 改进建议列表
        """
        try:
            import torch
            from rl_pytorch.spawn_tuning_v2.model import (
                SpawnParamTunerResNet, SpawnParamTunerTransformer,
                N_THETA, N_CURVE_BINS,
            )
            from rl_pytorch.spawn_tuning_v2.optimize_theta import enumerate_all_contexts, context_to_indices
            from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector
        except Exception as e:
            return jsonify({"error": f"torch/model unavailable: {e}"}), 503

        db = get_db()
        row = db.execute(
            "SELECT weights_path, model_type, metrics_json FROM models WHERE model_id = ?",
            (model_id,),
        ).fetchone()
        db.close()
        if not row or not row["weights_path"]:
            return jsonify({"error": "model not found"}), 404

        # 加载模型 + 360 ctx 推断 (复用 build-and-export 同样逻辑, 已 PAVA 项目内)
        try:
            ck = torch.load(row["weights_path"], map_location="cpu", weights_only=False)
            arch = ck.get("arch", {}) or {}
            mt = (arch.get("model_type") or row["model_type"] or "resnet").lower()
            if mt == "transformer":
                model = SpawnParamTunerTransformer(
                    d_model=arch.get("d_model", 128),
                    n_layers=arch.get("n_layers", 3),
                    curve_bins=arch.get("curve_bins", N_CURVE_BINS),
                )
            else:
                model = SpawnParamTunerResNet(
                    hidden_dim=arch.get("hidden_dim", 128),
                    n_blocks=arch.get("n_blocks", 8),
                    curve_bins=arch.get("curve_bins", N_CURVE_BINS),
                )
            # v2.10.33 (P2.2 兼容): strict=False 让老 ckpt (无 head_r) 也能加载
            # v2.10.34: + load_state_dict_compat — embedding 维度变了 (N_GEN/BOT 扩) 也能加载
            from rl_pytorch.spawn_tuning_v2.model import load_state_dict_compat
            missing, unexpected = load_state_dict_compat(model, ck["model_state_dict"])
            if missing or unexpected:
                print(f"[load-model #{model_id}] warn — missing: {missing[:3]} unexpected: {unexpected[:3]}")
            model.eval()
        except Exception as e:
            return jsonify({"error": f"load model failed: {e}"}), 500

        ctxs = enumerate_all_contexts()
        idx_lists = [context_to_indices(c) for c in ctxs]
        target = target_curve_vector()   # v3.0.4: ★ ideal target
        with torch.no_grad():
            preds = model(
                difficulty_idx=torch.tensor([i["difficulty_idx"] for i in idx_lists], dtype=torch.long),
                generator_idx=torch.tensor([i["generator_idx"] for i in idx_lists], dtype=torch.long),
                bot_idx=torch.tensor([i["bot_idx"] for i in idx_lists], dtype=torch.long),
                pb_bin_idx=torch.tensor([i["pb_bin_idx"] for i in idx_lists], dtype=torch.long),
                lifecycle_idx=torch.tensor([i["lifecycle_idx"] for i in idx_lists], dtype=torch.long),
                log_pb=torch.tensor([i["log_pb"] for i in idx_lists], dtype=torch.float32),
                theta_norm=torch.full((len(ctxs), N_THETA), 0.5, dtype=torch.float32),
            )
            # cast 到 Python list (避免 numpy float32 JSON 不可序列化)
            curves = preds["curve"].cpu().numpy().tolist()  # (360, 20)

        # ── 1. 平衡 (balance) — 整体贴合 ★ ideal S 形 (v3.0.4) ──
        # MAE vs ideal, mae ≤ 0.05 = 100 分 / mae ≥ 0.20 = 0 分
        import math
        per_ctx_mae = [
            sum(abs(c[i] - target[i]) for i in range(20)) / 20
            for c in curves
        ]
        mean_mae = sum(per_ctx_mae) / len(per_ctx_mae)
        balance_score = max(0.0, min(100.0, 100 * (0.20 - mean_mae) / 0.15))

        # ── 2. 爽点 (tension) — 接近 PB 区 (r=0.85-1.0) 加压充分 ──
        # bin r=0.85 对应 idx 8 (r_max=2.0, 20 bins), bin r=1.0 对应 idx 9
        # 加压 = curves[:, 9] - curves[:, 4] (中段 → PB 边缘的差)
        # 期望 ≥ 0.20 = 100 分, ≤ 0 = 0 分
        tension_diffs = [c[9] - c[4] for c in curves]
        mean_tension = sum(tension_diffs) / len(tension_diffs)
        tension_score = max(0.0, min(100.0, 100 * mean_tension / 0.20))

        # ── 3. 公平 (fairness) — 跨 ctx 预测一致, 不同场景差异不应过大 ──
        # 用 per-ctx mae 的标准差衡量, std ≤ 0.02 = 100 分 / std ≥ 0.10 = 0 分
        mae_mean = sum(per_ctx_mae) / len(per_ctx_mae)
        mae_std = math.sqrt(sum((m - mae_mean) ** 2 for m in per_ctx_mae) / len(per_ctx_mae))
        fairness_score = max(0.0, min(100.0, 100 * (0.10 - mae_std) / 0.08))

        # ── 4. 惊喜 (surprise) — 模型不退化, 各 ctx 预测形态有变化 ──
        # 用 curve_var (跨 bin std 跨 ctx mean), 越大越好
        # var ≥ 0.15 = 100 分 / var ≤ 0.05 = 0 分
        curve_vars = [
            math.sqrt(sum((c[i] - sum(c)/len(c)) ** 2 for i in range(20)) / 20)
            for c in curves
        ]
        mean_var = sum(curve_vars) / len(curve_vars)
        surprise_score = max(0.0, min(100.0, 100 * (mean_var - 0.05) / 0.10))

        # 综合分: 加权 (balance 40% + tension 30% + fairness 20% + surprise 10%)
        overall = (
            0.40 * balance_score + 0.30 * tension_score
            + 0.20 * fairness_score + 0.10 * surprise_score
        )
        if overall >= 85: grade = "A"
        elif overall >= 70: grade = "B"
        elif overall >= 55: grade = "C"
        else: grade = "D"

        # 改进建议
        hints = []
        if balance_score < 60:
            hints.append(f"平衡分 {balance_score:.0f}/100 偏低 (mae={mean_mae:.3f}) — 训练数据 d_curve 跟 ideal 差距大, 检查 algo_version 或重训")
        if tension_score < 60:
            hints.append(f"爽点分 {tension_score:.0f}/100 偏低 (r=0.85-1.0 加压 {mean_tension:.3f}, 期望 ≥0.2) — 模型未学到 PB 命题, 拉大 anchor loss weight")
        if fairness_score < 60:
            hints.append(f"公平分 {fairness_score:.0f}/100 偏低 (mae 标准差 {mae_std:.3f}) — 不同 ctx 间表现差异大, 增加 balance loss weight")
        if surprise_score < 60:
            hints.append(f"惊喜分 {surprise_score:.0f}/100 偏低 (curve_var {mean_var:.3f}) — 模型趋向退化解, 检查 lr/data quality")
        if not hints:
            hints.append("✓ 业务命题全部达成, 模型可部署")

        return jsonify({
            "model_id": model_id,
            "overall_score": round(overall, 1),
            "grade": grade,
            "dimensions": {
                "balance":  {"score": round(balance_score, 1),  "raw": round(mean_mae, 4),   "metric": "mean_ideal_mae"},
                "tension":  {"score": round(tension_score, 1),  "raw": round(mean_tension, 4), "metric": "d_curve[r=1.0] - d_curve[r=0.5]"},
                "fairness": {"score": round(fairness_score, 1), "raw": round(mae_std, 4),    "metric": "std(per_ctx_mae)"},
                "surprise": {"score": round(surprise_score, 1), "raw": round(mean_var, 4),   "metric": "mean(per_ctx_curve_std)"},
            },
            "n_contexts_evaluated": len(ctxs),
            "hints": hints,
        })

    @bp.route("/api/spawn-tuning-v2/policies/validate-e2e", methods=["POST"])
    def validate_deployed_e2e():
        """G7 v2.10.9: e2e 验证 — 部署 bundle vs 真实样本集 d_curve 差异。

        Body: { set_id: <int>, bundle_path: <optional, default 当前部署> }
        Return: validate_e2e.validate() 的结果
        """
        try:
            from rl_pytorch.spawn_tuning_v2.validate_e2e import validate
        except Exception as e:
            return jsonify({"error": f"validate_e2e module not available: {e}"}), 503

        data = request.get_json() or {}
        set_id = data.get("set_id")
        if not set_id:
            return jsonify({"error": "set_id required"}), 400
        bundle_path = data.get("bundle_path") or "web/public/spawn-tuning-v2/policies.json"
        min_samples = int(data.get("min_samples", 5))
        if not Path(bundle_path).exists():
            return jsonify({"error": f"bundle not found: {bundle_path}. 先在 ⑤ 部署 tab 导出 bundle"}), 404

        try:
            result = validate(DB_PATH, bundle_path, int(set_id), min_samples)
            return jsonify(result)
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        except Exception as e:
            return jsonify({"error": f"validation failed: {e}"}), 500

    @bp.route("/api/spawn-tuning-v2/field-metrics/ab-compare", methods=["GET"])
    def ab_compare_models():
        """G5 v2.10.8: A/B 对比 staging vs deployed 模型的线上效果。

        Query: hours (default 168 = 7 天)
        Return:
          deployed: { model_id, n_episodes, avg_curve_mae, pb_break_rate, avg_score, surprise_rate }
          staging:  [{ model_id, ...同上 }, ...] (按 model_id 分组)
          status:   "ready" (有数据) / "no-deployed" / "no-staging" / "no-data"

        当前 (v2.10.8): field_metrics_v2 表已实现, 但需要客户端真实玩家数据上报后
        才有可对比内容。若表为空, 返回 status="no-data" 让前端显示占位。
        """
        try:
            hours = max(1, min(720, int(request.args.get("hours", 168))))
        except ValueError:
            hours = 168

        cutoff = now_unix() - hours * 3600
        db = get_db()
        # 确保表存在 (干净环境)
        try:
            db.executescript(_FIELD_METRICS_DDL)
        except sqlite3.OperationalError:
            pass

        # 找 deployed model
        deployed_row = db.execute(
            "SELECT model_id, name FROM models WHERE status = 'deployed' LIMIT 1",
        ).fetchone()
        # 找最近活跃 staging models (status='staging' 且最近 N 天有训练)
        staging_rows = db.execute(
            "SELECT model_id, name FROM models WHERE status = 'staging' "
            "AND created_at >= ? ORDER BY created_at DESC LIMIT 10",
            (cutoff,),
        ).fetchall()

        # 检查表是否有任何数据
        any_data = db.execute(
            "SELECT 1 FROM field_metrics WHERE received_at >= ? LIMIT 1", (cutoff,),
        ).fetchone()
        if not any_data:
            db.close()
            return jsonify({
                "status": "no-data",
                "message": f"过去 {hours} 小时内没有真实玩家上报数据",
                "deployed": dict(deployed_row) if deployed_row else None,
                "staging_candidates": [dict(r) for r in staging_rows],
                "next_step": "需客户端集成 policyMetricsV2.reportEpisode() 跑起来",
            })

        # 聚合每个 model 的 metric
        def _agg_model(mid):
            r = db.execute(
                "SELECT COUNT(*) AS n, "
                "       AVG(curve_mae) AS avg_curve_mae, "
                "       AVG(CASE WHEN pb_broke THEN 1.0 ELSE 0.0 END) AS pb_break_rate, "
                "       AVG(final_score) AS avg_score, "
                "       AVG(surprise_count) AS avg_surprise "
                "FROM field_metrics WHERE received_at >= ? AND model_id = ?",
                (cutoff, mid),
            ).fetchone()
            if not r or r["n"] == 0:
                return None
            return {
                "model_id": mid,
                "n_episodes": r["n"],
                "avg_curve_mae": round(r["avg_curve_mae"] or 0, 4),
                "pb_break_rate": round(r["pb_break_rate"] or 0, 4),
                "avg_score": round(r["avg_score"] or 0, 1),
                "avg_surprise": round(r["avg_surprise"] or 0, 2),
            }

        deployed_metrics = _agg_model(deployed_row["model_id"]) if deployed_row else None
        staging_metrics = []
        for r in staging_rows:
            m = _agg_model(r["model_id"])
            if m:
                m["name"] = r["name"]
                staging_metrics.append(m)
        db.close()
        return jsonify({
            "status": "ready" if (deployed_metrics or staging_metrics) else "no-data",
            "hours": hours,
            "deployed": {**(deployed_metrics or {}), "name": deployed_row["name"]} if deployed_metrics and deployed_row else None,
            "staging": staging_metrics,
        })

    @bp.route("/api/spawn-tuning-v2/field-metrics/aggregate", methods=["GET"])
    def aggregate_field_metrics():
        """聚合真实玩家 d_curve, 用于 ⑤ 监控 tab。

        Query:
          hours (default 24)
          context_key (筛选, 可选)
          model_id (筛选, 可选)
          group_by (v2.10.19 G19): difficulty / generator / bot_policy / pb_bin / lifecycle_stage
                                   按该维度返回 {value: {pb_broke_rate, noMove_rate, n_episodes, ...}}
        """
        try:
            hours = max(1, min(720, int(request.args.get("hours", 24))))
        except ValueError:
            hours = 24
        ctx = request.args.get("context_key")
        model_id = request.args.get("model_id")
        group_by = request.args.get("group_by")
        if group_by and group_by not in ("difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage"):
            return jsonify({"error": f"group_by must be one of difficulty/generator/bot_policy/pb_bin/lifecycle_stage"}), 400

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
                "noMove_rate": 0, "mean_score": 0, "mean_curve_mae": 0,
            })

        # 聚合
        n = len(rows)
        d_sum = [0.0] * 20
        pb_broke_sum = 0
        noMove_sum = 0
        score_sum = 0
        curve_mae_sum = 0.0
        curve_mae_count = 0
        for r in rows:
            curve = json.loads(r["d_curve_json"])
            if len(curve) == 20:
                for i in range(20):
                    d_sum[i] += curve[i]
            pb_broke_sum += int(r["pb_broke"] or 0)
            noMove_sum += 1 if (r["noMove_step"] or -1) >= 0 else 0
            score_sum += int(r["final_score"] or 0)
            # v2.10.18 (G14): 客户端可能上报 curve_mae 字段 (vs 部署模型 predicted_curve)
            cmae = r["curve_mae"] if "curve_mae" in r.keys() else None
            if cmae is not None and cmae >= 0:
                curve_mae_sum += float(cmae)
                curve_mae_count += 1

        result = {
            "hours": hours,
            "n_episodes": n,
            "d_curve_avg": [v / n for v in d_sum],
            "pb_broke_rate": pb_broke_sum / n,
            "noMove_rate": noMove_sum / n,
            "mean_score": score_sum / n,
            "mean_curve_mae": curve_mae_sum / curve_mae_count if curve_mae_count > 0 else 0,
        }

        # G19 v2.10.19: 按维度拆解
        if group_by:
            # 注: field_metrics 表存的是 context_key (e.g. "normal:triplet-p1:clear-greedy:4000:mature"),
            # 解析出对应位置的值再分组
            DIM_POS = {
                "difficulty": 0, "generator": 1, "bot_policy": 2, "pb_bin": 3, "lifecycle_stage": 4,
            }
            pos = DIM_POS[group_by]
            groups: dict = {}
            for r in rows:
                ck = r["context_key"] or ""
                parts = ck.split(":")
                if len(parts) <= pos:
                    continue
                key = parts[pos]
                g = groups.setdefault(key, {"n": 0, "pb_broke": 0, "noMove": 0, "score": 0, "curve_mae_sum": 0.0, "curve_mae_count": 0})
                g["n"] += 1
                g["pb_broke"] += int(r["pb_broke"] or 0)
                g["noMove"] += 1 if (r["noMove_step"] or -1) >= 0 else 0
                g["score"] += int(r["final_score"] or 0)
                cm = r["curve_mae"] if "curve_mae" in r.keys() else None
                if cm is not None and cm >= 0:
                    g["curve_mae_sum"] += float(cm)
                    g["curve_mae_count"] += 1
            result["group_by"] = group_by
            result["groups"] = {
                k: {
                    "n_episodes": g["n"],
                    "pb_broke_rate": g["pb_broke"] / max(1, g["n"]),
                    "noMove_rate": g["noMove"] / max(1, g["n"]),
                    "mean_score": g["score"] / max(1, g["n"]),
                    "mean_curve_mae": g["curve_mae_sum"] / max(1, g["curve_mae_count"]) if g["curve_mae_count"] > 0 else 0,
                }
                for k, g in groups.items()
            }
        return jsonify(result)


    # ─── 离线 Bundle (PR6) ─────────────────────────────────

    @bp.route("/api/spawn-tuning-v2/policies/build-and-export", methods=["POST"])
    def build_and_export_bundle():
        """v2.10.4: 一键构建 policies.json + 导出 bundle (前端 UI 默认路径)。

        旧版需要先 CLI 跑 optimize_theta 生成 policies.json, 再 POST export_bundle。
        前端不暴露第 1 步 → 用户点导出按钮永远 HTTP 404。

        本端点合并两步:
          1) 加载 model_id 的 ckpt
          2) 对 360 个 context 跑模型推断 (default theta_norm=0.5)
          3) 构造 policies.json (写到 ckpt 同目录, 命名 <basename>.policies.json)
          4) 复用 export_bundle 逻辑写 web/public + miniprogram bundle

        body: { model_id, rollout_pct (1-100), include_miniprogram (default true),
                auto_deploy (default true) — 写盘成功后是否自动把目标 model_id 标记
                为 deployed（并 archive 旧 deployed），让 ① 概览的「当前生效模型」、
                /policies/active API 与客户端 badge 三方同步 }
        """
        import hashlib
        try:
            import torch
            from rl_pytorch.spawn_tuning_v2.model import (
                SpawnParamTunerResNet, SpawnParamTunerTransformer,
                N_THETA, N_CURVE_BINS,
            )
            from rl_pytorch.spawn_tuning_v2.optimize_theta import (
                enumerate_all_contexts, context_to_indices,
                optimize_one_context,
            )
            from rl_pytorch.spawn_tuning_v2.target_curve import target_curve_vector
            from rl_pytorch.spawn_tuning_v2.policy_utils import monotonic_project_curve, max_monotonic_violation
        except Exception as e:
            return jsonify({"error": f"torch/model not available: {e}"}), 503

        data = request.get_json() or {}
        model_id = data.get("model_id")
        if not model_id:
            return jsonify({"error": "model_id required"}), 400
        rollout_pct = max(1, min(100, int(data.get("rollout_pct", 100))))
        include_mp = bool(data.get("include_miniprogram", True))
        auto_deploy = bool(data.get("auto_deploy", True))
        # v3.0.6 (G1) / v3.0.10: 启用 θ 寻参 (Surrogate Optimization)
        #   API 默认 False (兼容老 caller / 单测), UI 通过部署按钮主动传 True
        #   - True: 每 ctx 跑 Adam 在 model 上找 argmin ‖curve(ctx,θ) − ideal‖
        #           bundle 写最优 θ*, build_mode = "model-inference-best-theta"
        #   - False: 兼容旧行为, theta_norm=0.5, build_mode = "model-inference-default-theta"
        # v3.0.10: 默认 n_starts=4 / steps=150 (≈ 90-150s 总耗时, 单 ctx ≈ 0.3-0.4s)
        #   老默认 8/300 实测 ~5-7 分钟, 严重慢于 UI 预期 60-90s. 实测 4/150 vs 8/300 MAE 差异 < 0.005, 可接受
        optimize_theta_flag = bool(data.get("optimize_theta", False))
        opt_n_starts = max(1, min(32, int(data.get("opt_n_starts", 4))))
        opt_steps = max(20, min(2000, int(data.get("opt_steps", 150))))

        db = get_db()
        row = db.execute(
            "SELECT weights_path, model_type, sha256, name FROM models WHERE model_id = ?",
            (model_id,),
        ).fetchone()
        db.close()
        if not row or not row["weights_path"]:
            return jsonify({"error": "model not found or has no weights_path"}), 404
        weights_path = row["weights_path"]
        if not Path(weights_path).exists():
            return jsonify({"error": f"weights file missing on disk: {weights_path}"}), 404

        # 1) 加载模型 (跟 predict_curve 同样的双架构兼容)
        try:
            ck = torch.load(weights_path, map_location="cpu", weights_only=False)
            arch = ck.get("arch", {}) or {}
            mt = (arch.get("model_type") or row["model_type"] or "resnet").lower()
            if mt == "transformer":
                model = SpawnParamTunerTransformer(
                    d_model=arch.get("d_model", 128),
                    n_layers=arch.get("n_layers", 3),
                    curve_bins=arch.get("curve_bins", N_CURVE_BINS),
                )
            else:
                model = SpawnParamTunerResNet(
                    hidden_dim=arch.get("hidden_dim", 128),
                    n_blocks=arch.get("n_blocks", 8),
                    curve_bins=arch.get("curve_bins", N_CURVE_BINS),
                )
            # v2.10.33 (P2.2 兼容): strict=False 让老 ckpt (无 head_r) 也能加载
            # v2.10.34: + load_state_dict_compat — embedding 维度变了 (N_GEN/BOT 扩) 也能加载
            from rl_pytorch.spawn_tuning_v2.model import load_state_dict_compat
            missing, unexpected = load_state_dict_compat(model, ck["model_state_dict"])
            if missing or unexpected:
                print(f"[load-model #{model_id}] warn — missing: {missing[:3]} unexpected: {unexpected[:3]}")
            model.eval()
        except Exception as e:
            return jsonify({"error": f"load model failed: {e}"}), 500

        # 2) 枚举 360 context, 决定 θ 来源
        ctxs = enumerate_all_contexts()
        target = target_curve_vector()   # v3.0.4: ★ ideal target
        target_t = torch.tensor(target, dtype=torch.float32)
        idx_lists = [context_to_indices(c) for c in ctxs]

        if optimize_theta_flag:
            # v3.0.11 (G6 联合寻参): 优先读 ckpt 内训练时 backprop 出来的 theta_optim 表 (< 1s)
            # Fallback (老 ckpt 无 theta_optim): 跑 surrogate optimize_one_context (~90-180s)
            theta_optim_param = None
            if hasattr(model, "theta_optim_raw") and isinstance(model.theta_optim_raw, torch.nn.Parameter):
                # 检查表的 ctx 数对得上 (防止 ckpt 是别的 enumerate_all_contexts 版本)
                if model.theta_optim_raw.shape[0] == len(ctxs):
                    theta_optim_param = model.theta_optim()   # sigmoid → [0,1]
            if theta_optim_param is not None:
                t_opt = time.time()
                with torch.no_grad():
                    preds = model(
                        difficulty_idx=torch.tensor([i["difficulty_idx"] for i in idx_lists], dtype=torch.long),
                        generator_idx=torch.tensor([i["generator_idx"] for i in idx_lists], dtype=torch.long),
                        bot_idx=torch.tensor([i["bot_idx"] for i in idx_lists], dtype=torch.long),
                        pb_bin_idx=torch.tensor([i["pb_bin_idx"] for i in idx_lists], dtype=torch.long),
                        lifecycle_idx=torch.tensor([i["lifecycle_idx"] for i in idx_lists], dtype=torch.long),
                        log_pb=torch.tensor([i["log_pb"] for i in idx_lists], dtype=torch.float32),
                        theta_norm=theta_optim_param,
                    )
                    curves = preds["curve"].cpu().numpy().tolist()
                best_theta_norm = theta_optim_param.detach().cpu().numpy().tolist()
                build_mode = "model-joint-trained-theta"
                print(f"[build-and-export] 读 ckpt theta_optim 表 (v3.0.11 联合寻参), 耗时 {time.time()-t_opt:.2f}s")
            else:
                # v3.0.6 (G1) fallback: 老 ckpt 无 theta_optim, 跑 surrogate
                print(f"[build-and-export] ckpt 无 theta_optim, fallback surrogate · {len(ctxs)} ctx × {opt_n_starts} starts × {opt_steps} steps")
                t_opt = time.time()
                opt_results = []
                for i, ctx in enumerate(ctxs):
                    r = optimize_one_context(
                        model=model, ctx=ctx, target_curve=target_t,
                        n_starts=opt_n_starts, steps=opt_steps, lr=0.05,
                        seed=42 + i * 13,
                    )
                    opt_results.append(r)
                    if (i + 1) % 60 == 0:
                        avg = sum(x["predicted_curve_mae_to_target"] for x in opt_results) / len(opt_results)
                        print(f"  [{i+1}/{len(ctxs)}] avg_mae={avg:.4f}")
                print(f"[build-and-export] surrogate 完成, 耗时 {time.time()-t_opt:.1f}s")
                best_theta_norm = [r["theta_norm"] for r in opt_results]
                curves = [r["predicted_curve"] for r in opt_results]
                build_mode = "model-inference-best-theta"
        else:
            # 兼容旧行为: default theta_norm = 0.5
            with torch.no_grad():
                preds = model(
                    difficulty_idx=torch.tensor([i["difficulty_idx"] for i in idx_lists], dtype=torch.long),
                    generator_idx=torch.tensor([i["generator_idx"] for i in idx_lists], dtype=torch.long),
                    bot_idx=torch.tensor([i["bot_idx"] for i in idx_lists], dtype=torch.long),
                    pb_bin_idx=torch.tensor([i["pb_bin_idx"] for i in idx_lists], dtype=torch.long),
                    lifecycle_idx=torch.tensor([i["lifecycle_idx"] for i in idx_lists], dtype=torch.long),
                    log_pb=torch.tensor([i["log_pb"] for i in idx_lists], dtype=torch.float32),
                    theta_norm=torch.full((len(ctxs), N_THETA), 0.5, dtype=torch.float32),
                )
                curves = preds["curve"].cpu().numpy().tolist()
            best_theta_norm = [[0.5] * N_THETA] * len(ctxs)
            build_mode = "model-inference-default-theta"

        # 3) 构造 policies
        # v2.10.7: 强制单调非降 + clip [0,1] - 保证客户端策略 "S 形难度严格递增"
        apply_monotonic = bool(data.get("monotonic_projection", True))   # 默认开
        policies = []
        total_violations = 0
        max_raw_violation = 0.0
        for ctx, raw_curve, theta_n in zip(ctxs, curves, best_theta_norm):
            if apply_monotonic:
                # 记录原始最大单调违规, 给用户看
                max_raw_violation = max(max_raw_violation, max_monotonic_violation(raw_curve))
                curve, n_viol = monotonic_project_curve(raw_curve, clip_min=0.0, clip_max=1.0)
                total_violations += n_viol
            else:
                curve = raw_curve
            mae = sum(abs(c - t) for c, t in zip(curve, target)) / len(target)
            policies.append({
                "context_key": ctx["context_key"],
                "context": {k: ctx[k] for k in ["difficulty", "generator", "bot_policy", "pb_bin", "lifecycle_stage"]},
                "theta_norm": list(theta_n),
                "predicted_curve": curve,
                "predicted_curve_mae_to_target": round(mae, 6),
                "expected": {"ideal_mae": round(mae, 6)},
            })

        avg_mae = sum(p["predicted_curve_mae_to_target"] for p in policies) / max(1, len(policies))

        # 写 policies.json sidecar (方便下次直接用 source 路径)
        policies_path = Path(weights_path).with_suffix(".policies.json")
        policies_doc = {
            "format": "openblock-spawn-tuning-v2-policies",
            "version": "2.0.0",
            "model_id": int(model_id),
            "model_checkpoint": weights_path,
            "model_sha256": row["sha256"] or "",
            "n_contexts": len(policies),
            "average_curve_mae": avg_mae,
            "build_mode": build_mode,
            "generated_at": now_unix(),
            "policies": policies,
        }
        try:
            policies_path.write_text(
                json.dumps(policies_doc, ensure_ascii=False, indent=2), encoding="utf-8",
            )
        except Exception as e:
            return jsonify({"error": f"failed to write policies.json: {e}"}), 500

        # 4) 复用 export_bundle 写 web/public + miniprogram
        # 注意：bundle.theta 必须写成「dict」形式（按 THETA_KEYS 反归一化），
        # 而非 normalized [0,1] 数组——客户端 clientPolicyV2.resolveThetaV2
        # 用 `{ ...DEFAULT_THETA_V2, ...p.theta }` spread 模式覆盖默认值；
        # 若 p.theta 是数组，spread 后只会得到 {0: ..., 1: ...} 键，无法覆盖 DEFAULT_THETA_V2 的字段名，
        # 导致灰度部署不生效（badge 显示「规则」而非「寻参」）。
        try:
            from rl_pytorch.spawn_tuning_v2.feature_io import (
                denormalize_theta as _denorm,
            )
        except Exception:
            _denorm = None
        bundle = {
            "format": "openblock-spawn-tuning-v2-bundle",
            "version": "2.0.0",
            "n_contexts": len(policies),
            "generated_at": now_unix(),
            "model_id": int(model_id),
            "model_sha256": row["sha256"] or "",
            "rollout_pct": rollout_pct,
            "policies": [
                {
                    "context_key": p["context_key"],
                    "context": p["context"],
                    "theta": (_denorm(p["theta_norm"]) if _denorm else p["theta_norm"]),
                    "predicted_curve": p["predicted_curve"],
                    "expected": p["expected"],
                }
                for p in policies
            ],
        }
        bundle_json = json.dumps(bundle, ensure_ascii=False, separators=(",", ":"))
        sha = hashlib.sha256(bundle_json.encode("utf-8")).hexdigest()

        # v1.62.0 事实门禁：以目标 S 曲线为准，判定「预估口径是否比实测口径更逼近目标」。
        #   覆盖率 / 高分段覆盖 / 提升量 Δ 任一不达标 → 默认拒绝写盘+部署。
        #   require_fact_eval=false 仅用于明确的 shadow 试验（不部署也可显式跳过）。
        require_fact_eval = bool(data.get("require_fact_eval", True))
        fact_report = None
        try:
            from rl_pytorch.spawn_tuning_v2.fact_eval import (
                evaluate_policies, aggregate_metrics, gate, coverage_caveats, DEFAULT_THRESHOLDS,
            )
            thresholds = {**DEFAULT_THRESHOLDS, **(data.get("fact_eval_thresholds") or {})}
            per_ctx = evaluate_policies(DB_PATH, bundle["policies"])
            metrics = aggregate_metrics(per_ctx)
            passed, fails = gate(metrics, thresholds)
            # 覆盖率仅为告警（标注提升被验证到的 r 区间），不影响 passed。
            fact_report = {"passed": passed, "fails": fails,
                           "caveats": coverage_caveats(metrics, thresholds),
                           "metrics": {k: (round(v, 4) if isinstance(v, float) else v)
                                       for k, v in metrics.items()}}
        except Exception as e:
            # 评估自身出错 → indeterminate（不静默通过，也不误伤无样本环境）。
            fact_report = {"passed": None, "error": str(e)}

        # 仅在"有充分实测且明确不达标"(passed is False) 时拦截；
        # indeterminate(None，实测不足) 放行但回报，避免冷启动环境无法部署。
        if require_fact_eval and (fact_report or {}).get("passed") is False:
            return jsonify({
                "error": "fact-eval 门禁未通过 — 以目标 S 为准，预估口径未比实测更逼近目标（提升量 Δ≤0），拒绝部署",
                "fact_eval": fact_report,
                "hint": "Δ≤0 说明预估未比实测更逼近目标，需调参/重训；覆盖不足只是告警（不阻断），"
                        "但建议补足高分段采样以扩大验证范围。亦可显式传 require_fact_eval=false 仅做 shadow（不部署）。",
            }), 422

        bundle_dir = Path("web/public/spawn-tuning-v2")
        bundle_dir.mkdir(parents=True, exist_ok=True)
        results = {"written": [str(policies_path)]}
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
                "model_id": int(model_id),
                "model_sha256": row["sha256"] or "",
                "rollout_pct": rollout_pct,
                "sha256": sha,
                "average_curve_mae": avg_mae,
                "build_mode": build_mode,
            }
            (bundle_dir / "policies.meta.json").write_text(
                json.dumps(meta, ensure_ascii=False, indent=2) + "\n", encoding="utf-8",
            )
            results["written"].append(str(bundle_dir / "policies.meta.json"))
        except Exception as e:
            return jsonify({"error": f"bundle write failed: {e}", **results}), 500

        if include_mp:
            try:
                mp_dir = Path("miniprogram/core/tuning")
                mp_dir.mkdir(parents=True, exist_ok=True)
                mp_path = mp_dir / "spawnPoliciesV2.js"
                mp_body = (
                    "/**\n"
                    " * 小程序运行时数据模块 — 出块寻参 v2 策略 (离线包)\n"
                    f" * 自动生成于: {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                    f" * 模型 ID: {model_id} · SHA-256: {row['sha256'] or ''}\n"
                    f" * 策略数: {len(policies)} · 灰度: {rollout_pct}%\n"
                    f" * 构建模式: {build_mode}\n"
                    f" * 平均 ideal MAE: {avg_mae:.4f}\n"
                    " */\n"
                    "module.exports = " + json.dumps(bundle, ensure_ascii=False, indent=2) + ";\n"
                )
                mp_path.write_text(mp_body, encoding="utf-8")
                results["written"].append(str(mp_path))
            except Exception as e:
                results.setdefault("errors", []).append(f"miniprogram write failed: {e}")

        # v2.10.9: bundle 写盘成功 → 自动 mark deployed，让 ① 概览「当前生效模型」、
        # /policies/active API 与客户端「寻参」badge 三方同步。
        # 用户视角"D.1 导出 = 上线生效"——若仅写 bundle 文件而不改 models.status，
        # dashboard 仍显示"无 / 当前未部署模型"，造成状态分裂。
        # 可通过 body.auto_deploy=false 显式跳过（如需先 shadow 测试再手动 deploy）。
        deploy_info = {"auto_deploy": auto_deploy, "deployed": False}
        if auto_deploy:
            try:
                db = get_db()
                # 先把旧 deployed 改 archived（与 /models/<id>/deploy 同语义）
                db.execute("UPDATE models SET status = 'archived' WHERE status = 'deployed'")
                db.execute(
                    "UPDATE models SET status = 'deployed', deployed_at = ? WHERE model_id = ?",
                    (now_unix(), model_id),
                )
                db.commit()
                db.close()
                deploy_info["deployed"] = True
                deploy_info["deployed_at"] = now_unix()
            except Exception as e:
                deploy_info["error"] = f"auto deploy failed: {e}"

        return jsonify({
            "ok": True,
            "model_id": int(model_id),
            "policies_count": len(policies),
            "average_curve_mae": round(avg_mae, 4),
            "bundle_size_bytes": len(bundle_json),
            "sha256": sha,
            "generated_at": bundle["generated_at"],
            "policies_source": str(policies_path),
            "rollout_pct": rollout_pct,
            # v2.10.7: 单调投影统计
            "monotonic_projection_applied": apply_monotonic,
            "monotonic_violations_fixed": total_violations,
            "max_raw_violation": round(max_raw_violation, 4),
            # v2.10.9: 自动 deploy 结果
            "deploy": deploy_info,
            # v1.62.0: 事实门禁报告（覆盖/实测口径误差/预估口径误差/提升量 Δ；R 为诊断）
            "fact_eval": fact_report,
            **results,
        })

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


    @bp.route("/api/spawn-tuning-v2/policies/bundle/remove", methods=["POST"])
    def remove_bundle():
        """物理移除已部署的 v2 离线 bundle，让游戏端回到规则版 (HandTuned θ)。

        与 ``rollback`` 不同：rollback 仅改 DB 的 ``models.status``，而 bundle 文件
        仍然挂在 ``web/public/spawn-tuning-v2/policies.json``，因此前端只要刷新还会
        重新加载旧 bundle，导致「dashboard 显示无 deployed」与「游戏页 badge 仍显示
        寻参」状态分裂。本 API 是「卸载部署」的唯一权威入口。

        POST body (全部可选):
          include_miniprogram (default true)  — 同时移除 miniprogram/core/tuning/spawnPoliciesV2.js
          include_dist        (default true)  — 同时移除 dist/spawn-tuning-v2/* 镜像
          rollback_db         (default true)  — 同时把当前 deployed model 置为 'rollbacked'

        客户端在拿到 ok=true 后应通过 BroadcastChannel('openblock:spawn-param-tuner')
        广播 ``{type: 'bundle-removed'}``，让同 origin 的游戏页即时 uninstallPoliciesV2。
        """
        data = request.get_json(silent=True) or {}
        include_mp = bool(data.get("include_miniprogram", True))
        include_dist = bool(data.get("include_dist", True))
        rollback_db = bool(data.get("rollback_db", True))

        removed: list[str] = []
        errors: list[str] = []
        candidates: list[Path] = [
            Path("web/public/spawn-tuning-v2/policies.json"),
            Path("web/public/spawn-tuning-v2/policies.meta.json"),
        ]
        if include_dist:
            candidates.extend([
                Path("dist/spawn-tuning-v2/policies.json"),
                Path("dist/spawn-tuning-v2/policies.meta.json"),
            ])
        if include_mp:
            candidates.append(Path("miniprogram/core/tuning/spawnPoliciesV2.js"))

        for p in candidates:
            try:
                if p.exists():
                    p.unlink()
                    removed.append(str(p))
            except Exception as e:
                errors.append(f"{p}: {e}")

        rolled_back_model_id: int | None = None
        if rollback_db:
            db = get_db()
            row = db.execute(
                "SELECT model_id FROM models WHERE status='deployed' LIMIT 1",
            ).fetchone()
            if row:
                rolled_back_model_id = int(row["model_id"])
                db.execute(
                    "UPDATE models SET status = 'rollbacked' WHERE model_id = ?",
                    (rolled_back_model_id,),
                )
                db.commit()
            db.close()

        return jsonify({
            "ok": True,
            "removed": removed,
            "errors": errors,
            "rolled_back_model_id": rolled_back_model_id,
        })


    @bp.route("/api/spawn-tuning-v2/policies/bundle/status", methods=["GET"])
    def bundle_status():
        """查询当前已导出 bundle 的元数据 + 与 DB 部署状态的一致性诊断。

        v2.10.10 新增 ``consistency`` 字段，揭示「bundle 文件存在性」与
        「models.status='deployed' 记录」之间的三种状态组合，让 dashboard
        能给出明确诊断而不是显示分裂的「未导出 + 当前生效 #N」。

        consistency.state ∈ {
            'in-sync'                : bundle 文件 == DB deployed 模型 ID
            'no-deployment'          : 都没有（首次或全清）
            'deployed-but-no-bundle' : DB 有 deployed 但 bundle 文件缺失 ← 状态不一致
            'bundle-but-not-deployed': bundle 文件存在但 DB 无 deployed（手动 rollback 后未清盘）
            'mismatch'               : bundle 中 model_id != DB deployed 模型（罕见）
        }
        """
        bundle_dir = Path("web/public/spawn-tuning-v2")
        bundle_file = bundle_dir / "policies.json"
        meta_file = bundle_dir / "policies.meta.json"

        bundle_exists = bundle_file.exists() and meta_file.exists()
        meta = {}
        if bundle_exists:
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                meta = {}

        # 查 DB deployed model
        db = get_db()
        deployed_row = db.execute(
            "SELECT model_id, name, model_type, version, train_job_id FROM models "
            "WHERE status='deployed' LIMIT 1",
        ).fetchone()
        deployed_id = deployed_row["model_id"] if deployed_row else None
        bundle_model_id = meta.get("model_id") if isinstance(meta, dict) else None
        # v2.10.17: 同时拿 train job 名字 (供 UI 显示 "job-xxx")
        deployed_job_name = None
        if deployed_row and deployed_row["train_job_id"]:
            j = db.execute(
                "SELECT name FROM training_jobs WHERE job_id = ?",
                (deployed_row["train_job_id"],),
            ).fetchone()
            if j:
                deployed_job_name = j["name"]
        db.close()

        if not bundle_exists and not deployed_id:
            state, hint = "no-deployment", "未部署任何模型，点击上方按钮训练 + 导出"
        elif bundle_exists and deployed_id and bundle_model_id == deployed_id:
            state, hint = "in-sync", ""
        elif not bundle_exists and deployed_id:
            state, hint = (
                "deployed-but-no-bundle",
                f"⚠ DB 中 model #{deployed_id} 已部署，但 bundle 文件缺失。"
                f"点击 D.1 重新导出 Bundle 即可恢复一致（auto_deploy=True 不会改 DB 状态）。",
            )
        elif bundle_exists and not deployed_id:
            state, hint = (
                "bundle-but-not-deployed",
                f"⚠ Bundle 文件指向 model #{bundle_model_id}，但 DB 中无 deployed 模型"
                f"（可能 rollback 后未清盘）。可重新点 D.1 让 auto_deploy 把 DB 同步过来。",
            )
        else:  # bundle_exists and deployed_id and mismatch
            state, hint = (
                "mismatch",
                f"⚠ Bundle 文件是 model #{bundle_model_id}，但 DB 中 deployed 是 model #{deployed_id}。"
                f"请重新点 D.1 用 #{deployed_id} 导出，或部署 #{bundle_model_id} 让两者匹配。",
            )

        # v2.10.17: 把 deployed model 详细信息暴露给 UI
        deployed_info = None
        if deployed_row:
            deployed_info = {
                "model_id": deployed_row["model_id"],
                "name": deployed_row["name"],
                "model_type": deployed_row["model_type"],
                "version": deployed_row["version"],
                "train_job_id": deployed_row["train_job_id"],
                "train_job_name": deployed_job_name,
            }
        resp = {
            "exists": bundle_exists,
            "bundle_dir": str(bundle_dir),
            "consistency": {
                "state": state,
                "hint": hint,
                "bundle_model_id": bundle_model_id,
                "deployed_model_id": deployed_id,
            },
            "deployed_model": deployed_info,
        }
        if bundle_exists:
            resp.update({
                "bundle_path": str(bundle_file),
                "bundle_size_bytes": bundle_file.stat().st_size,
                "modified_at": int(bundle_file.stat().st_mtime),
                "meta": meta,
            })
        return jsonify(resp)


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
            d["metrics"] = _sanitize_metrics(json.loads(d.get("metrics_json") or "{}"))
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
