"""
企业级扩展：支付订单占位、远程配置、实验配置表、合规同意、导出与漏斗聚合。
与真实广告/IAP SDK 对接时在此模块补充校验逻辑；勿在业务代码硬编码密钥。
"""

from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import time
from functools import wraps
from pathlib import Path

from flask import Response, jsonify, request

_REPO_ROOT = Path(__file__).resolve().parent


def migrate_enterprise_schema(cursor: sqlite3.Cursor) -> None:
    """扩表与补列；由 server.init_db 在 _migrate_schema 之后调用。"""
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
    if cursor.fetchone():
        cursor.execute("PRAGMA table_info(sessions)")
        sess_cols = {row[1] for row in cursor.fetchall()}
        if "attribution" not in sess_cols:
            try:
                cursor.execute("ALTER TABLE sessions ADD COLUMN attribution TEXT DEFAULT '{}'")
            except sqlite3.OperationalError:
                pass

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS iap_orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            sku TEXT NOT NULL,
            provider TEXT NOT NULL DEFAULT 'stub',
            provider_ref TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            amount_minor INTEGER DEFAULT 0,
            currency TEXT DEFAULT 'CNY',
            idempotency_key TEXT UNIQUE,
            expires_at INTEGER,
            payload_json TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
        """
    )
    cursor.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_iap_provider_ref ON iap_orders(provider, provider_ref)'
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS experiment_configs (
            experiment TEXT PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'draft',
            buckets_json TEXT NOT NULL DEFAULT '[]',
            payload_json TEXT DEFAULT '{}',
            guardrail_json TEXT DEFAULT '{}',
            starts_at INTEGER,
            ends_at INTEGER,
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS user_consents (
            user_id TEXT PRIMARY KEY,
            consent_json TEXT NOT NULL DEFAULT '{}',
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS live_ops_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            entry_key TEXT NOT NULL UNIQUE,
            payload_json TEXT NOT NULL DEFAULT '{}',
            tz TEXT DEFAULT 'UTC',
            starts_at INTEGER NOT NULL,
            ends_at INTEGER NOT NULL,
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
        """
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS ad_impressions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL DEFAULT '',
            session_id INTEGER,
            kind TEXT NOT NULL,
            filled INTEGER NOT NULL DEFAULT 0,
            revenue_minor INTEGER DEFAULT 0,
            meta_json TEXT DEFAULT '{}',
            ts INTEGER NOT NULL
        )
        """
    )
    cursor.execute(
        'CREATE INDEX IF NOT EXISTS idx_ad_imp_user_ts ON ad_impressions(user_id, ts)'
    )

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS analytics_mirror_dlq (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            event_name TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        )
        """
    )


def _ops_token_ok() -> bool:
    tok = os.environ.get('OPENBLOCK_OPS_TOKEN', '').strip()
    if not tok:
        return True
    return request.headers.get('X-Ops-Token', '') == tok


def require_ops_token(f):
    @wraps(f)
    def wrapped(*args, **kwargs):
        if not _ops_token_ok():
            return jsonify({'error': 'unauthorized'}), 401
        return f(*args, **kwargs)

    return wrapped


_RL: dict[tuple[str, str], list[float]] = {}


def _rate_limit_hit(path_key: str) -> bool:
    lim = int(os.environ.get('OPENBLOCK_RATE_LIMIT_PER_MIN', '0') or '0')
    if lim <= 0:
        return False
    ip = request.remote_addr or 'unknown'
    now = time.time()
    window = 60.0
    k = (ip, path_key)
    hist = _RL.setdefault(k, [])
    hist[:] = [t for t in hist if now - t < window]
    if len(hist) >= lim:
        return True
    hist.append(now)
    return False


def rate_limit(path_key: str):
    def deco(f):
        @wraps(f)
        def wrapped(*args, **kwargs):
            if _rate_limit_hit(path_key):
                return jsonify({'error': 'rate_limited'}), 429
            return f(*args, **kwargs)

        return wrapped

    return deco


def _load_remote_config_merged() -> dict:
    base_path = _REPO_ROOT / 'shared' / 'remote_config.default.json'
    out = {}
    if base_path.is_file():
        try:
            out = json.loads(base_path.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            out = {}
    override = os.environ.get('OPENBLOCK_REMOTE_CONFIG_JSON', '').strip()
    if override:
        try:
            extra = json.loads(override)
            if isinstance(extra, dict):
                out = {**out, **extra}
        except json.JSONDecodeError:
            pass
    out.setdefault('version', int(time.time()))
    return out


def register_enterprise_routes(app, get_db):
    """挂载 /api/enterprise/*、/api/payment/verify、合规与广告占位接口。"""

    @app.route('/api/enterprise/remote-config', methods=['GET'])
    @rate_limit('remote-config')
    def enterprise_remote_config():
        """远程配置（JSON）；可被 OPENBLOCK_REMOTE_CONFIG_JSON 覆盖合并。"""
        return jsonify(_load_remote_config_merged())

    @app.route('/api/enterprise/strategy-registry', methods=['GET'])
    def enterprise_strategy_registry():
        """出块 / RL 策略版本注册表（文件）；线上切换走 env OPENBLOCK_ACTIVE_STRATEGY_VERSION。"""
        p = _REPO_ROOT / 'shared' / 'strategy_registry.json'
        if not p.is_file():
            return jsonify({'versions': [], 'active': os.environ.get('OPENBLOCK_ACTIVE_STRATEGY_VERSION', '')})
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            data = {}
        data = data if isinstance(data, dict) else {}
        data['active'] = os.environ.get('OPENBLOCK_ACTIVE_STRATEGY_VERSION', data.get('active', ''))
        return jsonify(data)

    @app.route('/api/enterprise/experiments', methods=['GET'])
    def enterprise_experiments_list():
        db = get_db()
        migrate_enterprise_schema(db.cursor())
        db.commit()
        rows = db.execute('SELECT * FROM experiment_configs ORDER BY experiment').fetchall()
        return jsonify([dict(r) for r in rows])

    @app.route('/api/enterprise/experiments', methods=['POST'])
    @require_ops_token
    def enterprise_experiments_upsert():
        data = request.get_json(silent=True) or {}
        exp = (data.get('experiment') or '').strip()
        if not exp:
            return jsonify({'error': 'experiment required'}), 400
        db = get_db()
        migrate_enterprise_schema(db.cursor())
        db.execute(
            """
            INSERT INTO experiment_configs (experiment, status, buckets_json, payload_json, guardrail_json, starts_at, ends_at, updated_at)
            VALUES (?,?,?,?,?,?,?,strftime('%s','now'))
            ON CONFLICT(experiment) DO UPDATE SET
              status=excluded.status,
              buckets_json=excluded.buckets_json,
              payload_json=excluded.payload_json,
              guardrail_json=excluded.guardrail_json,
              starts_at=excluded.starts_at,
              ends_at=excluded.ends_at,
              updated_at=strftime('%s','now')
            """,
            (
                exp,
                data.get('status', 'running'),
                json.dumps(data.get('buckets', []), ensure_ascii=False),
                json.dumps(data.get('payload', {}), ensure_ascii=False),
                json.dumps(data.get('guardrails', {}), ensure_ascii=False),
                data.get('starts_at'),
                data.get('ends_at'),
            ),
        )
        db.commit()
        return jsonify({'ok': True})

    @app.route('/api/payment/verify', methods=['POST'])
    @rate_limit('payment-verify')
    def payment_verify():
        """
        支付收据占位入库（幂等键 idempotency_key）。
        生产环境应在服务端调用 Stripe/微信/Apple verify API 后再写入。
        """
        data = request.get_json(silent=True) or {}
        user_id = (data.get('user_id') or data.get('userId') or '').strip()
        sku = (data.get('sku') or '').strip()
        provider = (data.get('provider') or 'stub').strip()
        provider_ref = (data.get('provider_ref') or data.get('providerRef') or '').strip()
        idem = (data.get('idempotency_key') or data.get('idempotencyKey') or '').strip()
        if not user_id or not sku:
            return jsonify({'error': 'user_id and sku required'}), 400
        if not idem:
            idem = hashlib.sha256(f'{user_id}:{sku}:{provider}:{provider_ref}:{time.time()}'.encode()).hexdigest()[:32]

        db = get_db()
        migrate_enterprise_schema(db.cursor())
        try:
            db.execute(
                """
                INSERT INTO iap_orders (user_id, sku, provider, provider_ref, status, amount_minor, currency,
                  idempotency_key, expires_at, payload_json)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    user_id,
                    sku,
                    provider,
                    provider_ref or None,
                    data.get('status', 'completed'),
                    int(data.get('amount_minor', data.get('amountMinor', 0))),
                    (data.get('currency') or 'CNY')[:8],
                    idem,
                    data.get('expires_at'),
                    json.dumps({k: v for k, v in data.items()
                                if k not in ('user_id', 'userId')}, ensure_ascii=False),
                ),
            )
            db.commit()
        except sqlite3.IntegrityError:
            db.rollback()
            row = db.execute(
                'SELECT * FROM iap_orders WHERE idempotency_key = ?', (idem,)
            ).fetchone()
            return jsonify({'ok': True, 'duplicate': True, 'order': dict(row) if row else None})

        row = db.execute('SELECT * FROM iap_orders WHERE idempotency_key = ?', (idem,)).fetchone()
        return jsonify({'ok': True, 'order': dict(row)})

    @app.route('/api/enterprise/ad-impression', methods=['POST'])
    @rate_limit('ad-imp')
    def ad_impression():
        """广告展示/收益占位埋点（items 1–4 的数据落库入口）。"""
        data = request.get_json(silent=True) or {}
        db = get_db()
        migrate_enterprise_schema(db.cursor())
        db.execute(
            """
            INSERT INTO ad_impressions (user_id, session_id, kind, filled, revenue_minor, meta_json, ts)
            VALUES (?,?,?,?,?,?,?)
            """,
            (
                data.get('user_id', ''),
                data.get('session_id'),
                data.get('kind', 'unknown'),
                1 if data.get('filled') else 0,
                int(data.get('revenue_minor', 0)),
                json.dumps(data.get('meta', {}), ensure_ascii=False),
                int(data.get('ts', time.time() * 1000)),
            ),
        )
        db.commit()
        return jsonify({'ok': True})

    @app.route('/api/enterprise/funnel', methods=['GET'])
    @require_ops_token
    def enterprise_funnel():
        """简易漏斗：按 behaviors.event_type 计数（需运营 token）。"""
        days = int(request.args.get('days', 7))
        since = int(time.time() - days * 86400)
        db = get_db()
        rows = db.execute(
            """
            SELECT event_type, COUNT(*) AS cnt FROM behaviors
            WHERE timestamp >= ? GROUP BY event_type ORDER BY cnt DESC
            """,
            (since,),
        ).fetchall()
        return jsonify({'days': days, 'steps': [dict(r) for r in rows]})

    @app.route('/api/enterprise/analytics-export.ndjson', methods=['GET'])
    @require_ops_token
    def analytics_export_ndjson():
        """ behaviors 行导出为 NDJSON（小规模 SQLite 用；大体量请接仓库文档中的管道方案）。"""
        days = int(request.args.get('days', 1))
        cap = min(int(request.args.get('limit', 50000)), 200000)
        since = int(time.time() - days * 86400)
        db = get_db()

        def gen():
            cur = db.execute(
                """
                SELECT id, session_id, user_id, event_type, event_data, timestamp
                FROM behaviors WHERE timestamp >= ? ORDER BY id ASC LIMIT ?
                """,
                (since, cap),
            )
            for row in cur:
                d = dict(row)
                yield json.dumps(d, ensure_ascii=False) + '\n'

        return Response(gen(), mimetype='application/x-ndjson')

    @app.route('/api/compliance/consent', methods=['POST'])
    @rate_limit('consent')
    def compliance_consent():
        data = request.get_json(silent=True) or {}
        uid = (data.get('user_id') or data.get('userId') or '').strip()
        if not uid:
            return jsonify({'error': 'user_id required'}), 400
        db = get_db()
        migrate_enterprise_schema(db.cursor())
        db.execute(
            """
            INSERT INTO user_consents (user_id, consent_json, updated_at)
            VALUES (?,?,strftime('%s','now'))
            ON CONFLICT(user_id) DO UPDATE SET
              consent_json=excluded.consent_json,
              updated_at=strftime('%s','now')
            """,
            (uid, json.dumps(data.get('consents', data), ensure_ascii=False)),
        )
        db.commit()
        return jsonify({'ok': True})

    @app.route('/api/compliance/export-user', methods=['GET'])
    @require_ops_token
    def compliance_export_user():
        uid = request.args.get('user_id', '').strip()
        if not uid:
            return jsonify({'error': 'user_id required'}), 400
        db = get_db()
        out = {'user_id': uid, 'sessions': [], 'behaviors': [], 'scores': [], 'consents': None}
        out['sessions'] = [dict(r) for r in db.execute(
            'SELECT * FROM sessions WHERE user_id=? ORDER BY id DESC LIMIT 500', (uid,)
        ).fetchall()]
        out['behaviors'] = [dict(r) for r in db.execute(
            'SELECT * FROM behaviors WHERE user_id=? ORDER BY id DESC LIMIT 2000', (uid,)
        ).fetchall()]
        out['scores'] = [dict(r) for r in db.execute(
            'SELECT * FROM scores WHERE user_id=? ORDER BY id DESC LIMIT 500', (uid,)
        ).fetchall()]
        c = db.execute('SELECT * FROM user_consents WHERE user_id=?', (uid,)).fetchone()
        out['consents'] = dict(c) if c else None
        return jsonify(out)

    @app.route('/api/compliance/delete-user', methods=['POST'])
    @require_ops_token
    def compliance_delete_user():
        data = request.get_json(silent=True) or {}
        uid = (data.get('user_id') or data.get('userId') or '').strip()
        if not uid:
            return jsonify({'error': 'user_id required'}), 400
        db = get_db()
        db.execute('DELETE FROM behaviors WHERE user_id=?', (uid,))
        db.execute('DELETE FROM scores WHERE user_id=?', (uid,))
        db.execute('DELETE FROM sessions WHERE user_id=?', (uid,))
        db.execute('DELETE FROM user_consents WHERE user_id=?', (uid,))
        db.execute('DELETE FROM user_stats WHERE user_id=?', (uid,))
        try:
            db.execute('DELETE FROM browser_rl_linear_agents WHERE user_id=?', (uid,))
        except sqlite3.OperationalError:
            pass
        db.commit()
        return jsonify({'ok': True})

    @app.route('/api/enterprise/live-ops', methods=['GET'])
    def enterprise_live_ops():
        """当前生效中的 Live Ops 条目（服务端编排占位）。"""
        now = int(time.time())
        db = get_db()
        migrate_enterprise_schema(db.cursor())
        rows = db.execute(
            'SELECT * FROM live_ops_entries WHERE starts_at <= ? AND ends_at >= ? ORDER BY starts_at',
            (now, now),
        ).fetchall()
        return jsonify({'active': [dict(r) for r in rows]})

    @app.route('/api/enterprise/live-ops', methods=['POST'])
    @require_ops_token
    def enterprise_live_ops_upsert():
        data = request.get_json(silent=True) or {}
        key = (data.get('entry_key') or data.get('key') or '').strip()
        if not key:
            return jsonify({'error': 'entry_key required'}), 400
        db = get_db()
        migrate_enterprise_schema(db.cursor())
        db.execute(
            """
            INSERT INTO live_ops_entries (entry_key, payload_json, tz, starts_at, ends_at, updated_at)
            VALUES (?,?,?,?,?,strftime('%s','now'))
            ON CONFLICT(entry_key) DO UPDATE SET
              payload_json=excluded.payload_json,
              tz=excluded.tz,
              starts_at=excluded.starts_at,
              ends_at=excluded.ends_at,
              updated_at=strftime('%s','now')
            """,
            (
                key,
                json.dumps(data.get('payload', {}), ensure_ascii=False),
                data.get('tz', 'UTC'),
                int(data['starts_at']),
                int(data['ends_at']),
            ),
        )
        db.commit()
        return jsonify({'ok': True})

    @app.route('/api/enterprise/analytics-mirror', methods=['POST'])
    @rate_limit('mirror')
    def analytics_mirror_dlq():
        """第三方分析镜像失败时的 DLQ 占位（items 19–20）。"""
        data = request.get_json(silent=True) or {}
        db = get_db()
        migrate_enterprise_schema(db.cursor())
        db.execute(
            'INSERT INTO analytics_mirror_dlq (provider, event_name, payload_json) VALUES (?,?,?)',
            (
                data.get('provider', 'unknown'),
                data.get('event', ''),
                json.dumps(data.get('payload', {}), ensure_ascii=False),
            ),
        )
        db.commit()
        return jsonify({'ok': True})
