#!/usr/bin/env python3
"""
Open Block Backend - Flask + SQLite
Complete user behavior tracking and analytics
"""

import os
import re
import sys
import sqlite3
import json
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from flask import Flask, request, jsonify, g
from flask_cors import CORS


def _load_repo_dotenv():
    """将仓库根目录 `.env` / `.env.local` 载入 os.environ（先 .env 不覆盖已有环境变量，再 .env.local 强制覆盖）。"""
    root = Path(__file__).resolve().parent

    def _apply(path: Path, override: bool):
        if not path.is_file():
            return
        try:
            raw = path.read_text(encoding='utf-8')
        except OSError:
            return
        for line in raw.splitlines():
            s = line.strip()
            if not s or s.startswith('#') or '=' not in s:
                continue
            k, _, v = s.partition('=')
            k, v = k.strip(), v.strip()
            if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
                v = v[1:-1]
            if not k:
                continue
            if override:
                os.environ[k] = v
            else:
                os.environ.setdefault(k, v)

    _apply(root / '.env', False)
    _apply(root / '.env.local', True)


_load_repo_dotenv()

# 在进程内首次 import torch 之前设置 NNPACK 等（Spawn 模型加载 / 推理）
try:
    import rl_pytorch.torch_env  # noqa: F401
except ImportError:
    pass

_DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'openblock.db')
# BLOCKBLAST_DB_PATH 作为旧版向后兼容；优先使用 OPENBLOCK_DB_PATH
DATABASE = os.environ.get('OPENBLOCK_DB_PATH') or os.environ.get('BLOCKBLAST_DB_PATH', _DEFAULT_DB)

app = Flask(__name__)
CORS(app)

import enterprise_extensions  # noqa: E402  — 企业扩展路由与迁移（支付占位、远程配置、合规）


def _configure_sqlite_connection(db):
    """每连接一次：WAL 提升读写并发；busy_timeout 降低「database is locked」概率。"""
    try:
        db.execute('PRAGMA journal_mode=WAL')
    except sqlite3.OperationalError:
        pass
    try:
        db.execute('PRAGMA busy_timeout=5000')
    except sqlite3.OperationalError:
        pass


def get_db():
    """Get database connection for current request"""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
        _configure_sqlite_connection(db)
    return db


@app.teardown_appcontext
def close_connection(exception):
    """Close database connection at end of request"""
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()


def _migrate_behaviors_columns(cursor):
    """旧版库可能缺少 behaviors 字段，补列后再建索引。"""
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='behaviors'")
    if not cursor.fetchone():
        return
    cursor.execute('PRAGMA table_info(behaviors)')
    existing = {row[1] for row in cursor.fetchall()}
    additions = [
        ('session_id', 'INTEGER'),
        ('user_id', "TEXT NOT NULL DEFAULT ''"),
        ('event_type', "TEXT NOT NULL DEFAULT ''"),
        ('event_data', 'TEXT'),
        ('game_state', 'TEXT'),
        ('timestamp', "INTEGER DEFAULT (strftime('%s', 'now'))"),
        ('created_at', "INTEGER DEFAULT (strftime('%s', 'now'))"),
    ]
    for col_name, col_decl in additions:
        if col_name not in existing:
            try:
                cursor.execute(f'ALTER TABLE behaviors ADD COLUMN {col_name} {col_decl}')
            except sqlite3.OperationalError:
                pass


def _migrate_schema(cursor):
    """补列、迁移成就表结构、建 move_sequences / client_strategies。"""
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'")
    if cursor.fetchone():
        cursor.execute("PRAGMA table_info(sessions)")
        sess_cols = {row[1] for row in cursor.fetchall()}
        for col_name, decl in (
            ("game_stats", "TEXT"),
            ("strategy_config", "TEXT"),
            ("status", "TEXT DEFAULT 'active'"),
            ("end_time", "INTEGER"),
            ("duration", "INTEGER"),
            ("created_at", "INTEGER DEFAULT (strftime('%s', 'now'))"),
            ("strategy", "TEXT DEFAULT 'normal'"),
            ("score", "INTEGER DEFAULT 0"),
        ):
            if col_name not in sess_cols:
                try:
                    cursor.execute(f"ALTER TABLE sessions ADD COLUMN {col_name} {decl}")
                except sqlite3.OperationalError:
                    pass

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='achievements'")
    if cursor.fetchone():
        cursor.execute("PRAGMA table_info(achievements)")
        ach_cols = {row[1] for row in cursor.fetchall()}
        if "achievement_id" not in ach_cols:
            cursor.execute("ALTER TABLE achievements RENAME TO achievements_legacy")
            cursor.execute(
                """
                CREATE TABLE achievements (
                    user_id TEXT NOT NULL,
                    achievement_id TEXT NOT NULL,
                    unlocked_at INTEGER DEFAULT (strftime('%s', 'now')),
                    PRIMARY KEY (user_id, achievement_id)
                )
                """
            )
            try:
                cursor.execute(
                    """
                    INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at)
                    SELECT user_id, id, unlocked_at FROM achievements_legacy
                    """
                )
            except sqlite3.OperationalError:
                pass
            cursor.execute("DROP TABLE IF EXISTS achievements_legacy")

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS move_sequences (
            session_id INTEGER PRIMARY KEY,
            user_id TEXT NOT NULL,
            frames TEXT NOT NULL,
            analysis TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        )
        """
    )
    cursor.execute("PRAGMA table_info(move_sequences)")
    move_cols = {row[1] for row in cursor.fetchall()}
    if "analysis" not in move_cols:
        try:
            cursor.execute("ALTER TABLE move_sequences ADD COLUMN analysis TEXT")
        except sqlite3.OperationalError:
            pass

    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS client_strategies (
            id TEXT NOT NULL,
            user_id TEXT NOT NULL,
            payload TEXT NOT NULL,
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            PRIMARY KEY (id, user_id)
        )
        """
    )

    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='user_stats'")
    if cursor.fetchone():
        cursor.execute("PRAGMA table_info(user_stats)")
        st_cols = {row[1] for row in cursor.fetchall()}
        if "perfect_placements" not in st_cols:
            cursor.execute(
                "ALTER TABLE user_stats ADD COLUMN perfect_placements INTEGER DEFAULT 0"
            )
        for col_name, decl in (
            ("total_clears", "INTEGER DEFAULT 0"),
            ("max_combo", "INTEGER DEFAULT 0"),
            ("total_placements", "INTEGER DEFAULT 0"),
            ("total_misses", "INTEGER DEFAULT 0"),
        ):
            if col_name not in st_cols:
                try:
                    cursor.execute(f"ALTER TABLE user_stats ADD COLUMN {col_name} {decl}")
                except sqlite3.OperationalError:
                    pass


def init_db():
    """Initialize database schema"""
    with app.app_context():
        db = get_db()
        cursor = db.cursor()

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                strategy TEXT DEFAULT 'normal',
                strategy_config TEXT,
                score INTEGER DEFAULT 0,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                duration INTEGER,
                status TEXT DEFAULT 'active',
                game_stats TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS behaviors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                user_id TEXT NOT NULL,
                event_type TEXT NOT NULL,
                event_data TEXT,
                game_state TEXT,
                timestamp INTEGER DEFAULT (strftime('%s', 'now')),
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                score INTEGER NOT NULL,
                strategy TEXT DEFAULT 'normal',
                timestamp INTEGER DEFAULT (strftime('%s', 'now'))
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS user_stats (
                user_id TEXT PRIMARY KEY,
                total_games INTEGER DEFAULT 0,
                total_score INTEGER DEFAULT 0,
                best_score INTEGER DEFAULT 0,
                total_play_time INTEGER DEFAULT 0,
                total_clears INTEGER DEFAULT 0,
                max_combo INTEGER DEFAULT 0,
                total_placements INTEGER DEFAULT 0,
                total_misses INTEGER DEFAULT 0,
                last_seen INTEGER DEFAULT (strftime('%s', 'now'))
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS achievements (
                user_id TEXT NOT NULL,
                achievement_id TEXT NOT NULL,
                unlocked_at INTEGER DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (user_id, achievement_id)
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS replays (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER,
                user_id TEXT NOT NULL,
                events TEXT,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        ''')

        cursor.execute('''
            CREATE TABLE IF NOT EXISTS skill_wallets (
                user_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        ''')

        _migrate_behaviors_columns(cursor)
        _migrate_schema(cursor)

        enterprise_extensions.migrate_enterprise_schema(cursor)

        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_behaviors_session ON behaviors(session_id)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_behaviors_user ON behaviors(user_id)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_behaviors_type ON behaviors(event_type)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_behaviors_timestamp ON behaviors(timestamp)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)
        ''')
        cursor.execute('''
            CREATE INDEX IF NOT EXISTS idx_replays_session ON replays(session_id)
        ''')

        db.commit()


@app.route('/api/session', methods=['POST'])
def create_session():
    """Create a new game session（start_time 毫秒，与浏览器 Date.now() 一致）"""
    data = request.get_json() or {}
    user_id = data.get('user_id', '') or data.get('userId', '')
    strategy = data.get('strategy', 'normal')
    strategy_config = json.dumps(data.get('strategyConfig', data.get('strategy_config', {})))
    attr = data.get('attribution') or data.get('attributionJson')
    attribution = json.dumps(attr if isinstance(attr, dict) else {}, ensure_ascii=False)
    start_ms = data.get('startTime') or data.get('start_time')
    if start_ms is None:
        start_ms = int(time.time() * 1000)
    else:
        start_ms = int(start_ms)

    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        INSERT INTO sessions (user_id, strategy, strategy_config, start_time, score, status, attribution)
        VALUES (?, ?, ?, ?, ?, 'active', ?)
    ''', (user_id, strategy, strategy_config, start_ms, int(data.get('score', 0)), attribution))

    db.commit()
    session_id = cursor.lastrowid

    cursor.execute('''
        INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)
    ''', (user_id,))
    cursor.execute('''
        UPDATE user_stats SET last_seen = ? WHERE user_id = ?
    ''', (int(time.time()), user_id))
    db.commit()

    return jsonify({'success': True, 'session_id': session_id, 'id': session_id})


def _row_session_api(row) -> dict:
    if row is None:
        return {}
    sc = row["strategy_config"] if "strategy_config" in row.keys() else None
    gs = row["game_stats"] if "game_stats" in row.keys() else None
    at = row["attribution"] if "attribution" in row.keys() else None
    st = row["start_time"]
    if st is not None and st < 10**11:
        st = int(st * 1000)
    et = row["end_time"]
    if et is not None and et < 10**11:
        et = int(et * 1000)
    return {
        "id": row["id"],
        "userId": row["user_id"],
        "strategy": row["strategy"],
        "strategyConfig": json.loads(sc or "{}"),
        "score": row["score"],
        "startTime": st,
        "endTime": et,
        "duration": row["duration"],
        "status": row["status"],
        "gameStats": json.loads(gs or "null") if gs else None,
        "attribution": json.loads(at or "{}") if at else {},
    }


@app.route("/api/session/<int:session_id>", methods=["GET"])
def get_session(session_id):
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
    row = cur.fetchone()
    if not row:
        return jsonify({"error": "not_found"}), 404
    return jsonify(_row_session_api(row))


@app.route("/api/session/<int:session_id>", methods=["PATCH"])
def patch_session(session_id):
    """部分更新会话（前端 IndexedDB updateSession 的替代）"""
    data = request.get_json() or {}
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
    row = cur.fetchone()
    if not row:
        return jsonify({"error": "not_found"}), 404
    u = dict(row)
    if "score" in data:
        u["score"] = int(data["score"])
    if "status" in data:
        u["status"] = str(data["status"])
    if data.get("endTime") is not None:
        et = int(data["endTime"])
        if et < 10**11:
            et = int(et * 1000)
        u["end_time"] = et
    if data.get("gameStats") is not None:
        u["game_stats"] = json.dumps(data["gameStats"], ensure_ascii=False)
    if data.get("strategyConfig") is not None:
        u["strategy_config"] = json.dumps(data["strategyConfig"], ensure_ascii=False)
    if data.get("attribution") is not None:
        u["attribution"] = json.dumps(data["attribution"], ensure_ascii=False)
    cur.execute(
        """
        UPDATE sessions SET score = ?, status = ?, end_time = ?, game_stats = ?, strategy_config = ?, attribution = ?
        WHERE id = ?
        """,
        (
            u.get("score", row["score"]),
            u.get("status", row["status"]),
            u.get("end_time", row["end_time"]),
            u.get("game_stats", row["game_stats"] if "game_stats" in row.keys() else None),
            u.get("strategy_config", row["strategy_config"]),
            u.get(
                "attribution",
                row["attribution"] if "attribution" in row.keys() else "{}",
            ),
            session_id,
        ),
    )
    db.commit()
    cur.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
    return jsonify(_row_session_api(cur.fetchone()))


@app.route('/api/session/<int:session_id>', methods=['PUT'])
def end_session(session_id):
    """结束会话（可选同步）；毫秒时间戳"""
    data = request.get_json() or {}
    score = data.get('score', 0)
    duration = data.get('duration', 0)

    db = get_db()
    cursor = db.cursor()

    end_time = int(time.time() * 1000)
    cursor.execute('''
        SELECT start_time, user_id, strategy FROM sessions WHERE id = ?
    ''', (session_id,))
    row = cursor.fetchone()

    if row:
        st = row['start_time']
        if st is not None and st < 10**11:
            st = int(st * 1000)
        actual_duration_ms = max(0, end_time - st)
        actual_duration_sec = max(1, actual_duration_ms // 1000) if duration == 0 else int(duration)
        cursor.execute('''
            UPDATE sessions SET score = ?, end_time = ?, duration = ?, status = 'completed'
            WHERE id = ?
        ''', (score, end_time, actual_duration_sec, session_id))

        cursor.execute('''
            UPDATE user_stats SET
                total_score = total_score + ?,
                best_score = MAX(best_score, ?),
                total_play_time = total_play_time + ?,
                last_seen = ?
            WHERE user_id = ?
        ''', (score, score, actual_duration_sec, end_time // 1000, row['user_id']))

        cursor.execute('''
            INSERT INTO scores (user_id, score, strategy) VALUES (?, ?, ?)
        ''', (row['user_id'], score, row['strategy']))

        db.commit()

    return jsonify({'success': True})


@app.route('/api/behavior', methods=['POST'])
def record_behavior():
    """Record a single behavior event"""
    data = request.get_json() or {}
    session_id = data.get('session_id')
    user_id = data.get('user_id', '')
    event_type = data.get('event_type', '')
    event_data = json.dumps(data.get('data', {}))
    game_state = json.dumps(data.get('gameState', {}))

    if not event_type:
        return jsonify({'success': False, 'error': 'event_type required'}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        INSERT INTO behaviors (session_id, user_id, event_type, event_data, game_state, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (session_id, user_id, event_type, event_data, game_state, int(time.time())))

    db.commit()

    return jsonify({'success': True, 'id': cursor.lastrowid})


@app.route('/api/behavior/batch', methods=['POST'])
def record_behaviors_batch():
    """Record multiple behavior events at once"""
    data = request.get_json() or {}
    behaviors = data.get('behaviors', [])

    if not behaviors:
        return jsonify({'success': False, 'error': 'behaviors required'}), 400

    db = get_db()
    cursor = db.cursor()

    for b in behaviors:
        sid = b.get('session_id') if b.get('session_id') is not None else b.get('sessionId')
        ts = b.get('timestamp')
        if ts is None:
            ts = int(time.time() * 1000)
        else:
            ts = int(ts)
            if ts < 10**12:
                ts *= 1000
        cursor.execute('''
            INSERT INTO behaviors (session_id, user_id, event_type, event_data, game_state, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            sid,
            b.get('userId', ''),
            b.get('eventType', ''),
            json.dumps(b.get('data', {})),
            json.dumps(b.get('gameState', {})),
            ts,
        ))

    db.commit()

    return jsonify({'success': True, 'count': len(behaviors)})


@app.route('/api/behaviors/<int:session_id>', methods=['GET'])
def get_behaviors_by_session(session_id):
    """Get all behaviors for a session"""
    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        SELECT * FROM behaviors WHERE session_id = ? ORDER BY timestamp ASC
    ''', (session_id,))

    behaviors = []
    for row in cursor.fetchall():
        behaviors.append({
            'id': row['id'],
            'event_type': row['event_type'],
            'data': json.loads(row['event_data'] or '{}'),
            'game_state': json.loads(row['game_state'] or '{}'),
            'timestamp': row['timestamp']
        })

    return jsonify(behaviors)


@app.route('/api/behaviors', methods=['GET'])
def get_behaviors():
    """Get behaviors with filters"""
    user_id = request.args.get('user_id')
    event_type = request.args.get('event_type')
    limit = request.args.get('limit', 100, type=int)
    offset = request.args.get('offset', 0, type=int)

    db = get_db()
    cursor = db.cursor()

    query = 'SELECT * FROM behaviors WHERE 1=1'
    params = []

    if user_id:
        query += ' AND user_id = ?'
        params.append(user_id)

    if event_type:
        query += ' AND event_type = ?'
        params.append(event_type)

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    params.extend([limit, offset])

    cursor.execute(query, params)

    behaviors = []
    for row in cursor.fetchall():
        behaviors.append({
            'id': row['id'],
            'session_id': row['session_id'],
            'user_id': row['user_id'],
            'event_type': row['event_type'],
            'data': json.loads(row['event_data'] or '{}'),
            'game_state': json.loads(row['game_state'] or '{}'),
            'timestamp': row['timestamp']
        })

    return jsonify(behaviors)


@app.route('/api/score', methods=['POST'])
def record_score():
    """Record a score"""
    data = request.get_json() or {}
    user_id = data.get('user_id', '')
    score = data.get('score', 0)
    strategy = data.get('strategy', 'normal')

    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        INSERT INTO scores (user_id, score, strategy) VALUES (?, ?, ?)
    ''', (user_id, score, strategy))

    db.commit()

    return jsonify({'success': True})


@app.route('/api/stats', methods=['GET'])
def get_stats():
    """Get user or global stats"""
    user_id = request.args.get('user_id')

    db = get_db()
    cursor = db.cursor()

    if user_id:
        cursor.execute('SELECT * FROM user_stats WHERE user_id = ?', (user_id,))
        row = cursor.fetchone()

        if row:
            return jsonify({
                'user_id': row['user_id'],
                'total_games': row['total_games'],
                'total_score': row['total_score'],
                'best_score': row['best_score'],
                'total_play_time': row['total_play_time'],
                'total_clears': row['total_clears'],
                'max_combo': row['max_combo'],
                'total_placements': row['total_placements'],
                'total_misses': row['total_misses'],
                'accuracy': row['total_placements'] / (row['total_placements'] + row['total_misses']) * 100 if (row['total_placements'] + row['total_misses']) > 0 else 0
            })

        return jsonify({
            'user_id': user_id,
            'total_games': 0,
            'total_score': 0,
            'best_score': 0,
            'total_play_time': 0
        })

    cursor.execute('SELECT COUNT(*) as cnt FROM sessions')
    total_games = cursor.fetchone()['cnt']

    cursor.execute('SELECT MAX(score) as best FROM scores')
    best = cursor.fetchone()['best'] or 0

    cursor.execute('SELECT SUM(score) as total FROM scores')
    total = cursor.fetchone()['total'] or 0

    cursor.execute('SELECT SUM(total_clears) as clears FROM user_stats')
    clears = cursor.fetchone()['clears'] or 0

    cursor.execute('SELECT AVG(best_score) as avg_score FROM (SELECT best_score FROM user_stats WHERE best_score > 0)')
    avg_score = cursor.fetchone()['avg_score'] or 0

    return jsonify({
        'total_games': total_games,
        'total_score': total,
        'best_score': best,
        'total_clears': clears,
        'avg_score': round(avg_score, 2)
    })


@app.route('/api/leaderboard', methods=['GET'])
def get_leaderboard():
    """Get top scores"""
    limit = request.args.get('limit', 10, type=int)
    strategy = request.args.get('strategy')

    db = get_db()
    cursor = db.cursor()

    if strategy:
        cursor.execute('''
            SELECT user_id, MAX(score) as best_score, COUNT(*) as games
            FROM scores WHERE strategy = ?
            GROUP BY user_id ORDER BY best_score DESC LIMIT ?
        ''', (strategy, limit))
    else:
        cursor.execute('''
            SELECT user_id, MAX(score) as best_score, COUNT(*) as games
            FROM scores GROUP BY user_id ORDER BY best_score DESC LIMIT ?
        ''', (limit,))

    results = []
    for row in cursor.fetchall():
        results.append({
            'user_id': row['user_id'],
            'best_score': row['best_score'],
            'games': row['games']
        })

    return jsonify(results)


@app.route('/api/achievement', methods=['POST'])
def save_achievement():
    """Save an achievement"""
    data = request.get_json() or {}
    user_id = data.get('user_id', '')
    achievement_id = data.get('achievement_id', '')

    if not user_id or not achievement_id:
        return jsonify({'success': False, 'error': 'Missing fields'}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        INSERT OR IGNORE INTO achievements (user_id, achievement_id, unlocked_at)
        VALUES (?, ?, ?)
    ''', (user_id, achievement_id, int(time.time())))

    db.commit()

    return jsonify({'success': True})


@app.route('/api/achievements/<user_id>', methods=['GET'])
def get_achievements(user_id):
    """Get all achievements for a user"""
    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        SELECT achievement_id, unlocked_at FROM achievements WHERE user_id = ?
    ''', (user_id,))

    return jsonify(
        [{'id': row['achievement_id'], 'unlocked_at': row['unlocked_at']} for row in cursor.fetchall()]
    )


@app.route('/api/analytics/behaviors', methods=['GET'])
def get_behavior_analytics():
    """Get behavior analytics"""
    user_id = request.args.get('user_id')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    db = get_db()
    cursor = db.cursor()

    conditions = []
    params = []

    if user_id:
        conditions.append('user_id = ?')
        params.append(user_id)

    if start_date:
        conditions.append('timestamp >= ?')
        params.append(int(datetime.fromisoformat(start_date).timestamp()))

    if end_date:
        conditions.append('timestamp <= ?')
        params.append(int(datetime.fromisoformat(end_date).timestamp()))

    where_clause = ' AND '.join(conditions) if conditions else '1=1'

    cursor.execute(f'''
        SELECT event_type, COUNT(*) as count
        FROM behaviors
        WHERE {where_clause}
        GROUP BY event_type
    ''', params)

    event_counts = {row['event_type']: row['count'] for row in cursor.fetchall()}

    cursor.execute(f'''
        SELECT COUNT(DISTINCT session_id) as sessions
        FROM behaviors
        WHERE {where_clause}
    ''', params)
    sessions = cursor.fetchone()['sessions']

    cursor.execute(f'''
        SELECT AVG(score) as avg_score
        FROM sessions
        WHERE status = 'completed' AND {where_clause.replace('user_id', 'sessions.user_id').replace('timestamp', 'start_time')}
    ''', params)
    avg_score = cursor.fetchone()['avg_score'] or 0

    return jsonify({
        'event_counts': event_counts,
        'total_sessions': sessions,
        'avg_score': round(avg_score, 2),
        'place_count': event_counts.get('place', 0),
        'clear_count': event_counts.get('clear', 0),
        'fail_count': event_counts.get('place_failed', 0),
        'accuracy': event_counts.get('place', 0) / (event_counts.get('place', 0) + event_counts.get('place_failed', 0)) * 100 if (event_counts.get('place', 0) + event_counts.get('place_failed', 0)) > 0 else 0
    })


@app.route('/api/replay/<int:session_id>', methods=['GET'])
def get_replay(session_id):
    """Get replay data for a session"""
    db = get_db()
    cursor = db.cursor()

    cursor.execute('SELECT * FROM replays WHERE session_id = ?', (session_id,))
    row = cursor.fetchone()

    if row:
        return jsonify({
            'id': row['id'],
            'session_id': row['session_id'],
            'events': json.loads(row['events'] or '[]'),
            'created_at': row['created_at']
        })

    return jsonify({'error': 'Replay not found'}), 404


@app.route('/api/sessions', methods=['GET'])
def get_sessions():
    """Get recent sessions"""
    user_id = request.args.get('user_id')
    limit = request.args.get('limit', 50, type=int)
    status = request.args.get('status')

    db = get_db()
    cursor = db.cursor()

    conditions = []
    params = []

    if user_id:
        conditions.append('user_id = ?')
        params.append(user_id)

    if status:
        conditions.append('status = ?')
        params.append(status)

    where_clause = ' AND '.join(conditions) if conditions else '1=1'

    cursor.execute(f'''
        SELECT * FROM sessions
        WHERE {where_clause}
        ORDER BY start_time DESC
        LIMIT ?
    ''', params + [limit])

    sessions = []
    for row in cursor.fetchall():
        sessions.append(_row_session_api(row))

    return jsonify(sessions)


# 与 web/src/moveSequence.js MIN_PERSIST_MOVE_FRAMES 一致：过短序列不写入，避免回放列表垃圾数据
_MIN_MOVE_FRAMES = 5


def _display_score_from_frames(frames):
    """与 web/src/moveSequence.js displayScoreFromReplayFrames 一致：自末帧向前取 ps.score。"""
    if not isinstance(frames, list) or len(frames) == 0:
        return None
    for i in range(len(frames) - 1, -1, -1):
        f = frames[i]
        if not isinstance(f, dict):
            continue
        ps = f.get("ps")
        if isinstance(ps, dict):
            s = ps.get("score")
            if isinstance(s, (int, float)) and not isinstance(s, bool):
                if isinstance(s, float) and s != s:  # NaN
                    continue
                return int(s)
    return None


def _effective_list_score(frames, session_score):
    """回放列表展示用分数：优先帧快照，否则 sessions.score；无法判定则 None。"""
    d = _display_score_from_frames(frames)
    if d is not None:
        return d
    if session_score is not None:
        try:
            return int(session_score)
        except (TypeError, ValueError):
            return None
    return None


@app.route("/api/move-sequence/<int:session_id>", methods=["PUT"])
def put_move_sequence(session_id):
    data = request.get_json() or {}
    user_id = data.get("user_id", "") or data.get("userId", "")
    frames = data.get("frames")
    analysis = data.get("analysis")
    if frames is None:
        return jsonify({"success": False, "error": "frames required"}), 400
    if not isinstance(frames, list) or len(frames) < _MIN_MOVE_FRAMES:
        return jsonify(
            {
                "success": False,
                "error": f"frames must have at least {_MIN_MOVE_FRAMES} entries",
            }
        ), 400
    if analysis is not None and not isinstance(analysis, dict):
        return jsonify({"success": False, "error": "analysis must be an object"}), 400
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO move_sequences (session_id, user_id, frames, analysis, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            frames = excluded.frames,
            analysis = COALESCE(excluded.analysis, move_sequences.analysis),
            updated_at = excluded.updated_at,
            user_id = excluded.user_id
        """,
        (
            session_id,
            user_id,
            json.dumps(frames, ensure_ascii=False),
            json.dumps(analysis, ensure_ascii=False) if analysis is not None else None,
            int(time.time()),
        ),
    )
    db.commit()
    return jsonify({"success": True})


@app.route("/api/move-sequence/<int:session_id>", methods=["GET"])
def get_move_sequence(session_id):
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT frames, analysis FROM move_sequences WHERE session_id = ?", (session_id,))
    row = cur.fetchone()
    if not row:
        return jsonify({"frames": None, "analysis": None})
    try:
        analysis = None
        if "analysis" in row.keys() and row["analysis"]:
            try:
                analysis = json.loads(row["analysis"])
            except json.JSONDecodeError:
                analysis = None
        return jsonify({"frames": json.loads(row["frames"] or "[]"), "analysis": analysis})
    except json.JSONDecodeError:
        return jsonify({"frames": None, "analysis": None})


@app.route("/api/replay-sessions", methods=["GET"])
def list_replay_sessions():
    """
    当前用户的对局回放列表（仅含已有 move_sequences 且首帧为 init 的局）。
    按 start_time 降序，一次返回会话字段 + frames，避免前端 N+1 请求漏列。
    """
    user_id = request.args.get("user_id", "")
    lim = max(1, min(200, request.args.get("limit", 80, type=int)))
    if not user_id:
        return jsonify([])
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        SELECT s.id, s.user_id, s.strategy, s.strategy_config, s.score, s.start_time,
               s.end_time, s.duration, s.status, s.game_stats,
               m.frames AS move_frames, m.analysis AS move_analysis
        FROM sessions s
        INNER JOIN move_sequences m ON m.session_id = s.id AND m.user_id = s.user_id
        WHERE s.user_id = ?
        ORDER BY s.start_time DESC
        LIMIT ?
        """,
        (user_id, lim * 4),
    )
    out = []
    for row in cur.fetchall():
        rd = {k: row[k] for k in row.keys() if k not in ("move_frames", "move_analysis")}
        try:
            frames = json.loads(row["move_frames"] or "[]")
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(frames, list) or len(frames) < _MIN_MOVE_FRAMES:
            continue
        fst = frames[0]
        if not isinstance(fst, dict) or fst.get("t") != "init" or not fst.get("grid"):
            continue
        item = _row_session_api(rd)
        item["frames"] = frames
        if row["move_analysis"]:
            try:
                item["analysis"] = json.loads(row["move_analysis"])
            except (json.JSONDecodeError, TypeError):
                item["analysis"] = None
        else:
            item["analysis"] = None
        out.append(item)
        if len(out) >= lim:
            break
    return jsonify(out)


@app.route("/api/replay-sessions/delete", methods=["POST"])
def delete_replay_sessions_batch():
    """
    批量删除当前用户的对局及关联数据（move_sequences、behaviors、replays、sessions）。
    body: { "user_id": string, "session_ids": number[] }
    """
    data = request.get_json(force=True, silent=True) or {}
    user_id = (data.get("user_id") or "").strip()
    raw_ids = data.get("session_ids") or data.get("ids") or []
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({"error": "session_ids required"}), 400
    clean_ids = []
    for x in raw_ids[:80]:
        try:
            clean_ids.append(int(x))
        except (TypeError, ValueError):
            continue
    if not clean_ids:
        return jsonify({"error": "no valid session ids"}), 400
    db = get_db()
    cur = db.cursor()
    deleted = []
    for sid in clean_ids:
        cur.execute("SELECT id FROM sessions WHERE id = ? AND user_id = ?", (sid, user_id))
        if not cur.fetchone():
            continue
        cur.execute("DELETE FROM behaviors WHERE session_id = ?", (sid,))
        cur.execute("DELETE FROM replays WHERE session_id = ?", (sid,))
        cur.execute("DELETE FROM move_sequences WHERE session_id = ?", (sid,))
        cur.execute("DELETE FROM sessions WHERE id = ? AND user_id = ?", (sid, user_id))
        deleted.append(sid)
    db.commit()
    return jsonify({"success": True, "deleted": deleted, "count": len(deleted)})


@app.route("/api/replay-sessions/delete-zero-score", methods=["POST"])
def delete_replay_sessions_zero_score():
    """
    删除当前用户下「展示得分为 0」且具备可回放序列的对局（sessions + move_sequences 等），
    判定规则与回放列表一致（见 _effective_list_score）。
    """
    data = request.get_json(force=True, silent=True) or {}
    user_id = (data.get("user_id") or "").strip()
    if not user_id:
        return jsonify({"error": "user_id required"}), 400

    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        SELECT s.id, s.score, m.frames AS move_frames
        FROM sessions s
        INNER JOIN move_sequences m ON m.session_id = s.id AND m.user_id = s.user_id
        WHERE s.user_id = ?
        """,
        (user_id,),
    )
    delete_ids = []
    for row in cur.fetchall():
        try:
            frames = json.loads(row["move_frames"] or "[]")
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(frames, list) or len(frames) < _MIN_MOVE_FRAMES:
            continue
        fst = frames[0]
        if not isinstance(fst, dict) or fst.get("t") != "init" or not fst.get("grid"):
            continue
        eff = _effective_list_score(frames, row["score"])
        if eff is None:
            continue
        if eff == 0:
            delete_ids.append(int(row["id"]))

    deleted = []
    for sid in delete_ids:
        cur.execute("SELECT id FROM sessions WHERE id = ? AND user_id = ?", (sid, user_id))
        if not cur.fetchone():
            continue
        cur.execute("DELETE FROM behaviors WHERE session_id = ?", (sid,))
        cur.execute("DELETE FROM replays WHERE session_id = ?", (sid,))
        cur.execute("DELETE FROM move_sequences WHERE session_id = ?", (sid,))
        cur.execute("DELETE FROM sessions WHERE id = ? AND user_id = ?", (sid, user_id))
        deleted.append(sid)
    db.commit()
    return jsonify({"success": True, "deleted": deleted, "count": len(deleted)})


@app.route("/api/client/stats", methods=["GET"])
def get_client_stats():
    user_id = request.args.get("user_id", "")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT * FROM user_stats WHERE user_id = ?", (user_id,))
    row = cur.fetchone()
    if not row:
        return jsonify(
            {
                "key": "global",
                "totalGames": 0,
                "totalScore": 0,
                "totalClears": 0,
                "maxCombo": 0,
                "perfectPlacements": 0,
                "totalPlacements": 0,
                "totalMisses": 0,
            }
        )
    keys = row.keys()

    def _col(name: str, default=0):
        if name not in keys:
            return default
        v = row[name]
        return default if v is None else v

    return jsonify(
        {
            "key": "global",
            "totalGames": _col("total_games"),
            "totalScore": _col("total_score"),
            "totalClears": _col("total_clears"),
            "maxCombo": _col("max_combo"),
            "perfectPlacements": _col("perfect_placements"),
            "totalPlacements": _col("total_placements"),
            "totalMisses": _col("total_misses"),
        }
    )


@app.route("/api/wallet", methods=["GET"])
def get_skill_wallet():
    user_id = request.args.get("user_id", "") or request.args.get("userId", "")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    db = get_db()
    cur = db.cursor()
    cur.execute(
        "SELECT payload FROM skill_wallets WHERE user_id = ?",
        (user_id,),
    )
    row = cur.fetchone()
    if not row or not row["payload"]:
        return jsonify({"wallet": None})
    try:
        return jsonify({"wallet": json.loads(row["payload"])})
    except json.JSONDecodeError:
        return jsonify({"wallet": None})


@app.route("/api/wallet", methods=["PUT"])
def put_skill_wallet():
    data = request.get_json() or {}
    user_id = data.get("user_id", "") or data.get("userId", "")
    wallet = data.get("wallet")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    if wallet is None or not isinstance(wallet, dict):
        return jsonify({"error": "wallet object required"}), 400
    payload = json.dumps(wallet, ensure_ascii=False)
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO skill_wallets (user_id, payload, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
        """,
        (user_id, payload, int(time.time())),
    )
    db.commit()
    return jsonify({"success": True})


@app.route("/api/client/stats", methods=["PUT"])
def put_client_stats():
    data = request.get_json() or {}
    user_id = data.get("user_id", "") or data.get("userId", "")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    db = get_db()
    cur = db.cursor()
    cur.execute("INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)", (user_id,))
    mapping = [
        ("totalGames", "total_games"),
        ("totalScore", "total_score"),
        ("totalClears", "total_clears"),
        ("maxCombo", "max_combo"),
        ("perfectPlacements", "perfect_placements"),
        ("totalPlacements", "total_placements"),
        ("totalMisses", "total_misses"),
    ]
    sets = []
    vals = []
    for js_key, col in mapping:
        if js_key in data:
            sets.append(f"{col} = ?")
            vals.append(int(data[js_key]))
    if not sets:
        return jsonify({"success": True})
    vals.append(int(time.time()))
    vals.append(user_id)
    cur.execute(
        f"UPDATE user_stats SET {', '.join(sets)}, last_seen = ? WHERE user_id = ?",
        vals,
    )
    db.commit()
    return jsonify({"success": True})


@app.route("/api/scores/best", methods=["GET"])
def get_best_score():
    user_id = request.args.get("user_id", "")
    if not user_id:
        return jsonify({"best": 0})
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT MAX(score) AS m FROM scores WHERE user_id = ?", (user_id,))
    row = cur.fetchone()
    return jsonify({"best": int(row["m"] or 0)})


@app.route("/api/replays", methods=["GET"])
def list_replays():
    user_id = request.args.get("user_id", "")
    limit = request.args.get("limit", 50, type=int)
    if not user_id:
        return jsonify([])
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        SELECT id, session_id, user_id, events, created_at FROM replays
        WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
        """,
        (user_id, limit),
    )
    out = []
    for row in cur.fetchall():
        try:
            ev = json.loads(row["events"] or "[]")
        except json.JSONDecodeError:
            ev = []
        out.append(
            {
                "id": row["id"],
                "sessionId": row["session_id"],
                "userId": row["user_id"],
                "events": ev,
                "createdAt": row["created_at"],
            }
        )
    return jsonify(out)


@app.route("/api/replays", methods=["POST"])
def post_replay():
    data = request.get_json() or {}
    session_id = data.get("session_id") or data.get("sessionId")
    user_id = data.get("user_id", "") or data.get("userId", "")
    events = data.get("events", [])
    if session_id is None:
        return jsonify({"success": False, "error": "session_id required"}), 400
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO replays (session_id, user_id, events, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (session_id, user_id, json.dumps(events, ensure_ascii=False), int(time.time())),
    )
    db.commit()
    return jsonify({"success": True, "id": cur.lastrowid})


@app.route("/api/client/strategies", methods=["GET"])
def get_client_strategies():
    user_id = request.args.get("user_id", "")
    if not user_id:
        return jsonify([])
    db = get_db()
    cur = db.cursor()
    cur.execute(
        "SELECT id, payload, updated_at FROM client_strategies WHERE user_id = ?",
        (user_id,),
    )
    out = []
    for row in cur.fetchall():
        try:
            out.append(json.loads(row["payload"] or "{}"))
        except json.JSONDecodeError:
            pass
    return jsonify(out)


@app.route("/api/client/clear", methods=["POST"])
def clear_user_data():
    data = request.get_json() or {}
    user_id = data.get("user_id", "") or data.get("userId", "")
    if not user_id:
        return jsonify({"error": "user_id required"}), 400
    db = get_db()
    cur = db.cursor()
    for table, col in (
        ("behaviors", "user_id"),
        ("sessions", "user_id"),
        ("scores", "user_id"),
        ("achievements", "user_id"),
        ("replays", "user_id"),
        ("client_strategies", "user_id"),
        ("user_stats", "user_id"),
        ("skill_wallets", "user_id"),
    ):
        cur.execute(f"DELETE FROM {table} WHERE {col} = ?", (user_id,))
    cur.execute("DELETE FROM move_sequences WHERE user_id = ?", (user_id,))
    db.commit()
    return jsonify({"success": True})


@app.route("/api/client/strategies", methods=["PUT"])
def put_client_strategy():
    data = request.get_json() or {}
    user_id = data.get("user_id", "") or data.get("userId", "")
    sid = data.get("id", "")
    if not user_id or not sid:
        return jsonify({"error": "user_id and id required"}), 400
    payload = json.dumps(data.get("payload") or data, ensure_ascii=False)
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO client_strategies (id, user_id, payload, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(id, user_id) DO UPDATE SET
            payload = excluded.payload,
            updated_at = excluded.updated_at
        """,
        (sid, user_id, payload, int(time.time())),
    )
    db.commit()
    return jsonify({"success": True})


@app.route('/api/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'ok',
        'timestamp': int(time.time())
    })


def _db_debug_enabled() -> bool:
    """SQLite 调试 API 默认开启；公网/生产请显式设置 OPENBLOCK_DB_DEBUG=0（或 false/no/off）关闭。"""
    v = os.environ.get('OPENBLOCK_DB_DEBUG', '').strip().lower()
    if v in ('0', 'false', 'no', 'off'):
        return False
    return True


def _json_sql_cell(v):
    if v is None:
        return None
    if isinstance(v, (bytes, bytearray)):
        try:
            return v.decode('utf-8')
        except Exception:
            return repr(v)
    if isinstance(v, float):
        if v != v or abs(v) > 1e308:
            return str(v)
    return v


@app.route('/api/db-debug/enabled', methods=['GET'])
def db_debug_enabled():
    return jsonify({'enabled': _db_debug_enabled()})


@app.route('/api/db-debug/tables', methods=['GET'])
def db_debug_tables():
    """从 sqlite_master 读取表/视图元数据，供下拉框展示。"""
    if not _db_debug_enabled():
        return jsonify({'error': 'SQLite 调试已关闭（OPENBLOCK_DB_DEBUG=0）'}), 403
    try:
        db = get_db()
        rows = db.execute(
            """
            SELECT type, name, tbl_name, rootpage
            FROM sqlite_master
            WHERE type IN ('table', 'view')
              AND name NOT LIKE 'sqlite_%'
            ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 ELSE 2 END, name
            """
        ).fetchall()
        items = [
            {
                'name': r['name'],
                'type': r['type'],
                'tbl_name': r['tbl_name'],
                'rootpage': r['rootpage'],
            }
            for r in rows
        ]
        return jsonify({'items': items})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/db-debug/exec', methods=['POST'])
def db_debug_exec():
    """执行单条 SQL。sql 为空且提供合法 table 时默认 SELECT * LIMIT。"""
    if not _db_debug_enabled():
        return jsonify({'error': 'SQLite 调试已关闭（OPENBLOCK_DB_DEBUG=0）'}), 403
    data = request.get_json(silent=True) or {}
    sql = (data.get('sql') or '').strip()
    table = (data.get('table') or '').strip()
    try:
        limit = int(data.get('limit') or 500)
    except (TypeError, ValueError):
        limit = 500
    limit = max(1, min(limit, 5000))

    db = get_db()

    if not sql:
        if not table or not re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', table):
            return jsonify({'error': '请选择数据表，或输入 SQL'}), 400
        chk = db.execute(
            "SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=? LIMIT 1",
            (table,),
        ).fetchone()
        if not chk:
            return jsonify({'error': f'表或视图不存在: {table}'}), 400
        sql = f'SELECT * FROM "{table.replace(chr(34), "")}" LIMIT {limit}'
    else:
        sql = sql.rstrip(';')
        if ';' in sql:
            return jsonify({'error': '仅允许单条 SQL（不能包含多个分号语句）'}), 400

    try:
        cur = db.execute(sql)
        if cur.description:
            cols = [d[0] for d in cur.description]
            out_rows = []
            for row in cur.fetchall():
                out_rows.append([_json_sql_cell(x) for x in row])
            return jsonify({'ok': True, 'kind': 'rows', 'columns': cols, 'rows': out_rows})
        db.commit()
        return jsonify({
            'ok': True,
            'kind': 'mutate',
            'rowcount': cur.rowcount,
            'lastrowid': int(cur.lastrowid) if cur.lastrowid is not None else None,
        })
    except Exception as e:
        db.rollback()
        return jsonify({'error': str(e)}), 400


# ── A/B 测试上报 ──────────────────────────────────────────────────────────────

def _ensure_ab_table():
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS ab_events (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    TEXT NOT NULL,
            experiment TEXT NOT NULL,
            bucket     INTEGER NOT NULL,
            event      TEXT NOT NULL,
            ts         INTEGER NOT NULL,
            meta       TEXT DEFAULT '{}'
        )
    """)
    db.commit()


@app.route('/api/ab/report', methods=['POST'])
def ab_report():
    """接收 A/B 实验转化事件"""
    data = request.get_json(silent=True) or {}
    try:
        _ensure_ab_table()
        db = get_db()
        db.execute(
            'INSERT INTO ab_events (user_id, experiment, bucket, event, ts, meta) VALUES (?,?,?,?,?,?)',
            (data.get('userId', ''), data.get('experiment', ''),
             int(data.get('bucket', 0)), data.get('event', ''),
             int(data.get('ts', time.time() * 1000)),
             json.dumps({k: v for k, v in data.items()
                         if k not in ('userId', 'experiment', 'bucket', 'event', 'ts')}))
        )
        db.commit()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/ab/results', methods=['GET'])
def ab_results():
    """汇总 A/B 实验结果（按实验+桶聚合事件数）"""
    experiment = request.args.get('experiment', '')
    try:
        _ensure_ab_table()
        db = get_db()
        if experiment:
            rows = db.execute(
                'SELECT experiment, bucket, event, COUNT(*) as cnt FROM ab_events WHERE experiment=? GROUP BY experiment, bucket, event',
                (experiment,)
            ).fetchall()
        else:
            rows = db.execute(
                'SELECT experiment, bucket, event, COUNT(*) as cnt FROM ab_events GROUP BY experiment, bucket, event'
            ).fetchall()
        return jsonify([dict(r) for r in rows])
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── 运营看板 API ──────────────────────────────────────────────────────────────

@app.route('/api/ops/dashboard', methods=['GET'])
def ops_dashboard():
    """
    运营看板聚合接口

    参数：
      days   int   时间窗口（天数，默认7）

    返回：
      {
        retention: { d1, d7, d30 },
        activity:  { dau, avgSessionsPerUser, avgDuration },
        segments:  { A, B, C, D, E, unknown },
        tasks:     { miniGoal, daily, seasonPass },
        adFreq:    { avgRewardedPerUser, avgInterstitialPerUser },
        topScores: [...],
        trend:     [...],  # 按天的 DAU 趋势
      }
    """
    days = int(request.args.get('days', 7))
    since_ms = int((time.time() - days * 86400) * 1000)
    since_ts = int(time.time() - days * 86400)
    db = get_db()

    try:
        # ── 活跃度 ──
        active_users = db.execute(
            'SELECT COUNT(DISTINCT user_id) as cnt FROM sessions WHERE start_time >= ?', (since_ms,)
        ).fetchone()['cnt']

        total_sessions = db.execute(
            'SELECT COUNT(*) as cnt FROM sessions WHERE start_time >= ?', (since_ms,)
        ).fetchone()['cnt']

        avg_duration = db.execute(
            'SELECT AVG(duration) as avg FROM sessions WHERE start_time >= ? AND duration IS NOT NULL AND duration > 0',
            (since_ms,)
        ).fetchone()['avg'] or 0

        avg_sessions = round(total_sessions / max(active_users, 1), 2)

        # ── 留存（近7日注册用户在第N天是否再次活跃） ──
        def _retention(delta_min, delta_max):
            # 找 delta_min~delta_max 天前首次登录的用户，计算其后是否有 session
            base_since = int(time.time() - (delta_max + days) * 86400)
            base_until = int(time.time() - delta_min * 86400)
            cohort = db.execute(
                'SELECT user_id, MIN(start_time)/1000 as first_ts FROM sessions GROUP BY user_id HAVING first_ts BETWEEN ? AND ?',
                (base_since, base_until)
            ).fetchall()
            if not cohort:
                return 0.0
            retained = 0
            for row in cohort:
                uid = row['user_id']
                # 在 first_ts + delta_min*86400 ~ first_ts + delta_max*86400 之间是否有 session
                check_since = row['first_ts'] + delta_min * 86400
                check_until = row['first_ts'] + (delta_max + 1) * 86400
                found = db.execute(
                    'SELECT 1 FROM sessions WHERE user_id=? AND start_time/1000 BETWEEN ? AND ? LIMIT 1',
                    (uid, check_since, check_until)
                ).fetchone()
                if found:
                    retained += 1
            return round(retained / len(cohort), 3)

        d1 = _retention(1, 1)
        # 口径：与历史字段一致，D7 使用 6–8 日宽松窗口（非严格的「第 7 自然日」）
        d7 = _retention(6, 8)
        d30 = _retention(29, 31)

        # ── 用户分群分布（基于 user_stats） ──
        segment_rows = db.execute(
            'SELECT user_id, best_score, total_games FROM user_stats WHERE last_seen >= ?', (since_ts,)
        ).fetchall()
        seg_counts = {'A': 0, 'B': 0, 'C': 0, 'D': 0, 'E': 0, 'unknown': 0}
        for row in segment_rows:
            score = row['best_score'] or 0
            games = row['total_games'] or 0
            # 简化分群（与 playerProfile.segment5 逻辑对齐）
            if games >= 200 and score >= 3000:
                seg = 'C'
            elif games >= 100 and score >= 2000:
                seg = 'D'
            elif score >= 1500 or games >= 80:
                seg = 'B'
            elif score < 200 and games < 5:
                seg = 'E' if score > 1000 else 'A'
            else:
                seg = 'A'
            seg_counts[seg] = seg_counts.get(seg, 0) + 1

        # ── 每日趋势 ──
        trend = []
        for i in range(days):
            day_since = int((time.time() - (i + 1) * 86400) * 1000)
            day_until = int((time.time() - i * 86400) * 1000)
            cnt = db.execute(
                'SELECT COUNT(DISTINCT user_id) as cnt FROM sessions WHERE start_time BETWEEN ? AND ?',
                (day_since, day_until)
            ).fetchone()['cnt']
            import datetime
            day_label = (datetime.datetime.now() - datetime.timedelta(days=i)).strftime('%m-%d')
            trend.insert(0, {'date': day_label, 'dau': cnt})

        # ── Top 分数 ──
        top_scores = db.execute(
            'SELECT user_id, best_score FROM user_stats WHERE last_seen >= ? ORDER BY best_score DESC LIMIT 10',
            (since_ts,)
        ).fetchall()

        return jsonify({
            'days': days,
            'activity': {
                'dau': active_users,
                'totalSessions': total_sessions,
                'avgSessionsPerUser': avg_sessions,
                'avgDurationSec': round(avg_duration / 1000, 1) if avg_duration > 1000 else round(avg_duration, 1),
            },
            'retention': {'d1': d1, 'd7': d7, 'd30': d30},
            'segments': seg_counts,
            'trend': trend,
            'topScores': [{'userId': r['user_id'][:8] + '...', 'score': r['best_score']} for r in top_scores],
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ── 赛季通行证 API ────────────────────────────────────────────────────────────

def _ensure_season_pass_table():
    """确保 season_pass 表存在"""
    db = get_db()
    db.execute("""
        CREATE TABLE IF NOT EXISTS season_pass (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    TEXT NOT NULL,
            season_id  TEXT NOT NULL,
            premium    INTEGER NOT NULL DEFAULT 0,
            progress   TEXT NOT NULL DEFAULT '{}',
            completed  TEXT NOT NULL DEFAULT '[]',
            points     INTEGER NOT NULL DEFAULT 0,
            purchased_at INTEGER,
            updated_at INTEGER NOT NULL,
            UNIQUE(user_id, season_id)
        )
    """)
    db.commit()


@app.route('/api/season-pass', methods=['GET'])
def get_season_pass():
    """获取当前用户赛季通行证进度"""
    user_id = request.args.get('user_id', '')
    season_id = request.args.get('season_id', 'S1')
    if not user_id:
        return jsonify({'error': 'user_id required'}), 400
    try:
        _ensure_season_pass_table()
        db = get_db()
        row = db.execute(
            'SELECT * FROM season_pass WHERE user_id=? AND season_id=?',
            (user_id, season_id)
        ).fetchone()
        if not row:
            return jsonify({'exists': False})
        import json as _json
        return jsonify({
            'exists': True,
            'seasonId': row['season_id'],
            'premium': bool(row['premium']),
            'progress': _json.loads(row['progress']),
            'completed': _json.loads(row['completed']),
            'points': row['points'],
            'purchasedAt': row['purchased_at'],
            'updatedAt': row['updated_at'],
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/season-pass', methods=['POST', 'PUT'])
def upsert_season_pass():
    """上传/同步赛季通行证进度"""
    data = request.get_json(silent=True) or {}
    user_id = data.get('user_id', '')
    season_id = data.get('seasonId', 'S1')
    if not user_id:
        return jsonify({'error': 'user_id required'}), 400
    try:
        _ensure_season_pass_table()
        import json as _json
        db = get_db()
        now = int(time.time() * 1000)
        db.execute("""
            INSERT INTO season_pass (user_id, season_id, premium, progress, completed, points, purchased_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, season_id) DO UPDATE SET
                premium      = excluded.premium,
                progress     = excluded.progress,
                completed    = excluded.completed,
                points       = excluded.points,
                purchased_at = excluded.purchased_at,
                updated_at   = excluded.updated_at
        """, (
            user_id, season_id,
            int(bool(data.get('premium', False))),
            _json.dumps(data.get('progress', {})),
            _json.dumps(data.get('completed', [])),
            int(data.get('points', 0)),
            data.get('purchasedAt'),
            now,
        ))
        db.commit()
        return jsonify({'success': True, 'updatedAt': now})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/export', methods=['GET'])
def export_data():
    """Export all data for a user"""
    user_id = request.args.get('user_id')

    if not user_id:
        return jsonify({'error': 'user_id required'}), 400

    db = get_db()
    cursor = db.cursor()

    cursor.execute('SELECT * FROM user_stats WHERE user_id = ?', (user_id,))
    stats_row = cursor.fetchone()
    stats = dict(stats_row) if stats_row else {}

    cursor.execute('SELECT * FROM achievements WHERE user_id = ?', (user_id,))
    achievements = [dict(row) for row in cursor.fetchall()]

    cursor.execute('SELECT * FROM sessions WHERE user_id = ? ORDER BY start_time DESC LIMIT 100', (user_id,))
    sessions = [dict(row) for row in cursor.fetchall()]

    return jsonify({
        'user_id': user_id,
        'stats': stats,
        'achievements': achievements,
        'sessions': sessions,
        'exported_at': int(time.time())
    })


try:
    from rl_backend import register_rl_routes

    register_rl_routes(app)
except Exception as _rl_ex:
    print('RL API (/api/rl/*) 未启用:', _rl_ex)

try:
    from monetization_backend import create_mon_blueprint, init_mon_db

    app.register_blueprint(create_mon_blueprint())
    with app.app_context():
        init_mon_db()
except Exception as _mon_ex:
    print('商业化 API (/api/mon/*) 未启用:', _mon_ex)


# =====================================================================
#  Spawn Transformer: 训练 / 推理 / 状态 API
# =====================================================================

_MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'models')
_SPAWN_MODEL_PATH = os.path.join(_MODELS_DIR, 'spawn_transformer.pt')
_SPAWN_STATUS_PATH = os.path.join(_MODELS_DIR, 'spawn_train_status.json')
_spawn_train_proc = None  # background training subprocess
_spawn_model_cache = None  # loaded model for inference


@app.route('/api/spawn-model/status', methods=['GET'])
def spawn_model_status():
    """查询训练状态和模型是否可用。"""
    status = {}
    if os.path.exists(_SPAWN_STATUS_PATH):
        try:
            with open(_SPAWN_STATUS_PATH) as f:
                status = json.load(f)
        except Exception:
            pass

    model_available = os.path.exists(_SPAWN_MODEL_PATH)
    global _spawn_train_proc
    running = _spawn_train_proc is not None and _spawn_train_proc.poll() is None

    return jsonify({
        'modelAvailable': model_available,
        'trainingRunning': running,
        **status,
    })


@app.route('/api/spawn-model/train', methods=['POST'])
def spawn_model_train():
    """启动后台训练进程。"""
    import subprocess
    global _spawn_train_proc

    if _spawn_train_proc is not None and _spawn_train_proc.poll() is None:
        return jsonify({'success': False, 'error': '训练已在运行中'}), 409

    data = request.get_json() or {}
    epochs = int(data.get('epochs', 50))
    min_score = int(data.get('minScore', 0))
    max_sessions = int(data.get('maxSessions', 500))

    os.makedirs(_MODELS_DIR, exist_ok=True)
    with open(_SPAWN_STATUS_PATH, 'w') as f:
        json.dump({'phase': 'starting', 'progress': 0, 'message': '启动训练进程…'}, f)

    cmd = [
        sys.executable, '-m', 'rl_pytorch.spawn_model.train',
        '--db', DATABASE,
        '--epochs', str(epochs),
        '--min-score', str(min_score),
        '--max-sessions', str(max_sessions),
    ]
    _spawn_train_proc = subprocess.Popen(
        cmd,
        cwd=os.path.dirname(os.path.abspath(__file__)),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )

    return jsonify({'success': True, 'pid': _spawn_train_proc.pid})


@app.route('/api/spawn-model/stop', methods=['POST'])
def spawn_model_stop():
    """停止训练进程。"""
    global _spawn_train_proc
    if _spawn_train_proc is None or _spawn_train_proc.poll() is not None:
        return jsonify({'success': False, 'error': '无运行中的训练'}), 404

    _spawn_train_proc.terminate()
    _spawn_train_proc = None
    return jsonify({'success': True})


def _load_spawn_model():
    """延迟加载模型（自动兼容 v1/v2）。"""
    global _spawn_model_cache
    if _spawn_model_cache is not None:
        return _spawn_model_cache

    if not os.path.exists(_SPAWN_MODEL_PATH):
        return None

    try:
        import torch
        from rl_pytorch.spawn_model.model import SpawnTransformerV2

        checkpoint = torch.load(_SPAWN_MODEL_PATH, map_location='cpu', weights_only=False)
        cfg = checkpoint.get('config', {})
        model = SpawnTransformerV2(
            d_model=cfg.get('d_model', 128),
            nhead=cfg.get('nhead', 4),
            num_layers=cfg.get('num_layers', 2),
            dim_ff=cfg.get('dim_ff', 256),
            dropout=0,
        )
        model.load_state_dict(checkpoint['model_state_dict'])
        model.eval()
        _spawn_model_cache = model
        return model
    except Exception as e:
        print(f'SpawnTransformer 加载失败: {e}')
        return None


@app.route('/api/spawn-model/reload', methods=['POST'])
def spawn_model_reload():
    """重新加载模型（训练完成后调用）。"""
    global _spawn_model_cache
    _spawn_model_cache = None
    model = _load_spawn_model()
    if model is None:
        return jsonify({'success': False, 'error': '模型文件不存在或加载失败'}), 404
    return jsonify({'success': True, 'params': model.count_params()})


@app.route('/api/spawn-model/predict', methods=['POST'])
def spawn_model_predict():
    """
    推理：给定盘面状态，返回推荐的 3 个形状 ID（v2：支持 24 维 context + 目标难度）。
    body: { board, context, history, temperature?, targetDifficulty? }
    """
    model = _load_spawn_model()
    if model is None:
        return jsonify({'success': False, 'error': '模型未加载'}), 503

    try:
        import torch
        import numpy as np
        from rl_pytorch.spawn_model.dataset import SHAPE_VOCAB, CONTEXT_DIM

        data = request.get_json() or {}
        board_raw = data.get('board', [])
        context_raw = data.get('context', [])
        history_raw = data.get('history', [])
        temperature = float(data.get('temperature', 0.8))
        target_diff = data.get('targetDifficulty')

        board = np.zeros((1, 8, 8), dtype=np.float32)
        for y in range(min(8, len(board_raw))):
            row = board_raw[y] if y < len(board_raw) else []
            for x in range(min(8, len(row))):
                if row[x] is not None and row[x] != 0:
                    board[0][y][x] = 1.0

        context = np.zeros((1, CONTEXT_DIM), dtype=np.float32)
        for i in range(min(CONTEXT_DIM, len(context_raw))):
            context[0][i] = float(context_raw[i] or 0)

        history = np.zeros((1, 3, 3), dtype=np.int64)
        for i in range(min(3, len(history_raw))):
            row = history_raw[i] if i < len(history_raw) else []
            for j in range(min(3, len(row))):
                history[0][i][j] = int(row[j] or 0)

        board_t = torch.from_numpy(board)
        context_t = torch.from_numpy(context)
        history_t = torch.from_numpy(history)

        td = float(target_diff) if target_diff is not None else None
        indices = model.predict(board_t, context_t, history_t,
                                target_difficulty=td, temperature=temperature)
        shape_ids = [SHAPE_VOCAB[idx] if idx < len(SHAPE_VOCAB) else SHAPE_VOCAB[0] for idx in indices]

        return jsonify({
            'success': True,
            'shapes': shape_ids,
            'indices': indices,
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


# =====================================================================
#  Spawn Transformer V3: autoregressive + feasibility + playstyle + LoRA
#  详见 docs/ALGORITHMS_SPAWN.md §11
# =====================================================================

_SPAWN_V3_MODEL_PATH = os.path.join(_MODELS_DIR, 'spawn_transformer_v3.pt')
_spawn_v3_cache = None
_spawn_v3_lora_cache = {}  # user_id → (model_with_lora, ckpt_mtime)


def _load_spawn_v3_model(user_id: str | None = None):
    """加载 V3 基模型；若 user_id 指定且对应 LoRA 存在，则注入并加载 adapter。"""
    global _spawn_v3_cache
    if not os.path.exists(_SPAWN_V3_MODEL_PATH):
        return None

    try:
        import torch
        from rl_pytorch.spawn_model.model_v3 import SpawnTransformerV3

        if _spawn_v3_cache is None:
            checkpoint = torch.load(
                _SPAWN_V3_MODEL_PATH, map_location='cpu', weights_only=False
            )
            cfg = checkpoint.get('config', {}) or {}
            model = SpawnTransformerV3(
                d_model=cfg.get('d_model', 128),
                nhead=cfg.get('nhead', 4),
                num_layers=cfg.get('num_layers', 2),
                dim_ff=cfg.get('dim_ff', 256),
                dropout=cfg.get('dropout', 0.1),
            )
            sd = checkpoint.get('model_state_dict') or checkpoint
            model.load_state_dict(sd, strict=False)
            model.eval()
            _spawn_v3_cache = model

        if not user_id:
            return _spawn_v3_cache

        lora_path = os.path.join(_MODELS_DIR, f'lora_{user_id}.pt')
        if not os.path.exists(lora_path):
            return _spawn_v3_cache

        from rl_pytorch.spawn_model.lora import (
            inject_lora_into_model, load_lora_state_dict,
        )

        cached = _spawn_v3_lora_cache.get(user_id)
        mtime = os.path.getmtime(lora_path)
        if cached and cached[1] == mtime:
            return cached[0]

        import copy
        from rl_pytorch.spawn_model.model_v3 import SpawnTransformerV3
        personalized = copy.deepcopy(_spawn_v3_cache)
        cfg_l = torch.load(lora_path, map_location='cpu', weights_only=False)
        l_cfg = cfg_l.get('config', {}) or {}
        inject_lora_into_model(
            personalized,
            r=l_cfg.get('r', 4),
            alpha=l_cfg.get('alpha', 8.0),
            dropout=l_cfg.get('dropout', 0.0),
        )
        load_lora_state_dict(personalized, cfg_l.get('lora', {}), strict=False)
        personalized.eval()
        _spawn_v3_lora_cache[user_id] = (personalized, mtime)
        return personalized
    except Exception as e:
        print(f'[spawn-v3] 加载失败: {e}')
        return None


@app.route('/api/spawn-model/v3/status', methods=['GET'])
def spawn_v3_status():
    """V3 模型状态：基础模型可用性 + 已注册 LoRA adapter 列表。"""
    base_available = os.path.exists(_SPAWN_V3_MODEL_PATH)
    loras = []
    if os.path.isdir(_MODELS_DIR):
        for fname in os.listdir(_MODELS_DIR):
            if fname.startswith('lora_') and fname.endswith('.pt'):
                loras.append(fname[len('lora_'):-len('.pt')])
    return jsonify({
        'baseAvailable': base_available,
        'baseModelPath': _SPAWN_V3_MODEL_PATH if base_available else None,
        'personalizedUsers': sorted(loras),
    })


@app.route('/api/spawn-model/v3/predict', methods=['POST'])
def spawn_v3_predict():
    """V3 推理：autoregressive + feasibility + playstyle + 个性化。

    body:
      board: 8×8 0/1 矩阵（必填）
      context: 24 维向量（可选，缺失补零）
      history: 3×3 shape ID 矩阵（可选）
      playstyle: 'balanced'/'perfect_hunter'/... 或 null
      targetDifficulty: 0~1（可选）
      temperature: 采样温度（默认 0.8）
      topK: top-k 采样（默认 8）
      enforceFeasibility: bool，硬约束 mask（默认 true）
      userId: 玩家 ID（用于加载 LoRA；可空）
    """
    try:
        import torch
        import numpy as np
        from rl_pytorch.spawn_model.dataset import SHAPE_VOCAB, CONTEXT_DIM
        from rl_pytorch.spawn_model.feasibility import build_feasibility_mask
        from rl_pytorch.shapes_data import get_all_shapes

        data = request.get_json() or {}
        user_id = (data.get('userId') or '').strip() or None

        model = _load_spawn_v3_model(user_id)
        if model is None:
            return jsonify({'success': False, 'error': 'V3 模型未训练'}), 503

        board_raw = data.get('board') or []
        ctx_raw = data.get('context') or []
        hist_raw = data.get('history') or []
        playstyle = data.get('playstyle')
        target_diff = data.get('targetDifficulty')
        temperature = float(data.get('temperature', 0.8))
        top_k = int(data.get('topK', 8))
        enforce = bool(data.get('enforceFeasibility', True))

        board = np.zeros((8, 8), dtype=np.float32)
        for y in range(min(8, len(board_raw))):
            row = board_raw[y] if y < len(board_raw) else []
            for x in range(min(8, len(row))):
                if row[x] is not None and row[x] != 0:
                    board[y][x] = 1.0

        ctx = np.zeros(CONTEXT_DIM, dtype=np.float32)
        for i in range(min(CONTEXT_DIM, len(ctx_raw))):
            ctx[i] = float(ctx_raw[i] or 0)

        hist = np.zeros((3, 3), dtype=np.int64)
        for i in range(min(3, len(hist_raw))):
            row = hist_raw[i] if i < len(hist_raw) else []
            for j in range(min(3, len(row))):
                hist[i][j] = int(row[j] or 0)

        feas_mask = None
        if enforce:
            shape_map = {s['id']: s['data'] for s in get_all_shapes()}
            feas_mask = build_feasibility_mask(board, SHAPE_VOCAB, shape_map)
            if float(feas_mask.sum()) < 3.0:
                return jsonify({
                    'success': False,
                    'error': '当前盘面可放形状不足 3 种',
                    'feasibleCount': int(feas_mask.sum()),
                }), 422

        board_t = torch.from_numpy(board).unsqueeze(0)
        ctx_t = torch.from_numpy(ctx).unsqueeze(0)
        hist_t = torch.from_numpy(hist).unsqueeze(0)

        td = float(target_diff) if target_diff is not None else None
        triplet = model.sample(
            board_t, ctx_t, hist_t,
            target_difficulty=td,
            playstyle=playstyle,
            feasibility_mask=feas_mask,
            temperature=temperature,
            top_k=top_k,
        )

        shape_ids = [
            SHAPE_VOCAB[idx] if 0 <= idx < len(SHAPE_VOCAB) else SHAPE_VOCAB[0]
            for idx in triplet
        ]
        return jsonify({
            'success': True,
            'shapes': shape_ids,
            'indices': triplet,
            'modelVersion': 'v3',
            'personalized': bool(user_id and user_id in _spawn_v3_lora_cache),
            'feasibleCount': int(feas_mask.sum()) if feas_mask is not None else None,
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@app.route('/api/spawn-model/v3/train', methods=['POST'])
def spawn_v3_train():
    """启动 V3 训练（与 V2 train 共享多任务损失，外加 feasibility / playstyle）。"""
    import subprocess
    global _spawn_train_proc

    if _spawn_train_proc is not None and _spawn_train_proc.poll() is None:
        return jsonify({'success': False, 'error': '已有训练进程在运行'}), 409

    data = request.get_json() or {}
    cmd = [
        sys.executable, '-m', 'rl_pytorch.spawn_model.train_v3',
        '--db', DATABASE,
        '--epochs', str(int(data.get('epochs', 50))),
        '--min-score', str(int(data.get('minScore', 0))),
        '--max-sessions', str(int(data.get('maxSessions', 500))),
    ]
    if 'wFeas' in data:
        cmd += ['--w-feas', str(float(data['wFeas']))]
    if 'wSi' in data:
        cmd += ['--w-si', str(float(data['wSi']))]
    if 'wSt' in data:
        cmd += ['--w-st', str(float(data['wSt']))]

    os.makedirs(_MODELS_DIR, exist_ok=True)
    with open(_SPAWN_STATUS_PATH, 'w') as f:
        json.dump({'phase': 'starting', 'progress': 0, 'message': '启动 V3 训练…'}, f)
    _spawn_train_proc = subprocess.Popen(
        cmd, cwd=os.path.dirname(os.path.abspath(__file__)),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    return jsonify({'success': True, 'pid': _spawn_train_proc.pid, 'modelVersion': 'v3'})


@app.route('/api/spawn-model/v3/personalize', methods=['POST'])
def spawn_v3_personalize():
    """启动 LoRA 个性化微调进程。需 V3 基础模型已训练完成。

    body: { userId, epochs?, maxSessions?, lr?, loraR?, loraAlpha? }
    """
    import subprocess
    global _spawn_train_proc

    if not os.path.exists(_SPAWN_V3_MODEL_PATH):
        return jsonify({'success': False, 'error': 'V3 基础模型未训练'}), 412

    if _spawn_train_proc is not None and _spawn_train_proc.poll() is None:
        return jsonify({'success': False, 'error': '已有训练进程在运行'}), 409

    data = request.get_json() or {}
    user_id = (data.get('userId') or '').strip()
    if not user_id:
        return jsonify({'success': False, 'error': '缺少 userId'}), 400

    cmd = [
        sys.executable, '-m', 'rl_pytorch.spawn_model.personalize',
        '--user-id', user_id,
        '--db', DATABASE,
        '--base-ckpt', _SPAWN_V3_MODEL_PATH,
        '--epochs', str(int(data.get('epochs', 10))),
        '--max-sessions', str(int(data.get('maxSessions', 200))),
        '--lr', str(float(data.get('lr', 1e-3))),
        '--lora-r', str(int(data.get('loraR', 4))),
        '--lora-alpha', str(float(data.get('loraAlpha', 8.0))),
    ]

    os.makedirs(_MODELS_DIR, exist_ok=True)
    with open(_SPAWN_STATUS_PATH, 'w') as f:
        json.dump({'phase': 'starting', 'progress': 0,
                   'message': f'启动 {user_id} 的 LoRA 微调…'}, f)
    _spawn_train_proc = subprocess.Popen(
        cmd, cwd=os.path.dirname(os.path.abspath(__file__)),
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
    )
    return jsonify({'success': True, 'pid': _spawn_train_proc.pid, 'userId': user_id})


@app.route('/api/spawn-model/v3/propose-shapes', methods=['POST'])
def spawn_v3_propose_shapes():
    """PCGRL 雏形：程序化生成新形状候选（不替换主形状池，仅作为研究/编辑器入口）。

    body: { n?, nCellsDist?, seed? }
    """
    try:
        from rl_pytorch.spawn_model.shape_proposer import (
            propose_unique_batch, shape_pool_signatures,
        )
        from rl_pytorch.shapes_data import get_all_shapes

        data = request.get_json() or {}
        n = int(data.get('n', 8))
        seed = data.get('seed')
        seed = int(seed) if seed is not None else None
        dist_in = data.get('nCellsDist') or {3: 0.2, 4: 0.5, 5: 0.3}
        dist = {int(k): float(v) for k, v in dist_in.items()}

        existing = shape_pool_signatures(get_all_shapes())
        batch = propose_unique_batch(
            n=n, n_cells_dist=dist, existing_signatures=existing, seed=seed,
        )
        return jsonify({'success': True, 'count': len(batch), 'shapes': batch})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


_spawn_v3_lora_cache.clear()  # 防止热重载时残留


enterprise_extensions.register_enterprise_routes(app, get_db)

init_db()


# =====================================================================
#  文档门户：/docs  /docs/list  /docs/raw/<filename>
# =====================================================================

_DOCS_DIR = Path(__file__).resolve().parent / 'docs'
_WEB_PUBLIC_DIR = Path(__file__).resolve().parent / 'web' / 'public'

_DOC_CATEGORIES = [
    # 与 docs/ 目录结构一致（子目录 + 相对路径），供 /docs/list 与 docs.html 侧栏使用
    {'name': '文档中心',
     'docs': ['README.md']},
    {'name': '工程与扩展',
     'docs': ['engineering/PROJECT.md', 'engineering/SQLITE_SCHEMA.md', 'engineering/DEV_GUIDE.md',
              'engineering/TESTING.md', 'engineering/I18N.md', 'engineering/STRATEGY_GUIDE.md',
              'engineering/GOLDEN_EVENTS.md', 'engineering/CASUAL_GAME_BUILD_SKILL.md',
              'engineering/CURSOR_SKILLS.md']},
    {'name': '领域与竞品',
     'docs': ['domain/DOMAIN_KNOWLEDGE.md', 'domain/CASUAL_GAME_ANALYSIS.md',
              'domain/COMPETITOR_USER_ANALYSIS.md', 'domain/ARCHITECTURE_COMPARISON.md']},
    {'name': '玩法与产品',
     'docs': ['product/DIFFICULTY_MODES.md', 'product/CLEAR_SCORING.md',
              'product/RETENTION_ROADMAP_V10_17.md', 'product/EASTER_EGGS_AND_DELIGHT.md',
              'product/SKINS_CATALOG.md', 'product/SKIN_ICON_SEMANTIC_POOL.md']},
    {'name': '玩家系统',
     'docs': ['player/PLAYER_ABILITY_EVALUATION.md', 'player/PANEL_PARAMETERS.md',
              'player/REALTIME_STRATEGY.md', 'player/PLAYSTYLE_DETECTION.md']},
    {'name': '算法与模型',
     'docs': ['algorithms/ALGORITHMS_HANDBOOK.md', 'algorithms/ALGORITHMS_SPAWN.md',
              'algorithms/ALGORITHMS_PLAYER_MODEL.md', 'algorithms/ALGORITHMS_RL.md',
              'algorithms/ALGORITHMS_MONETIZATION.md']},
    {'name': '出块算法',
     'docs': ['algorithms/SPAWN_ALGORITHM.md', 'algorithms/ADAPTIVE_SPAWN.md',
              'algorithms/SPAWN_BLOCK_MODELING.md', 'algorithms/SPAWN_SOLUTION_DIFFICULTY.md']},
    {'name': '强化学习',
     'docs': ['algorithms/RL_AND_GAMEPLAY.md', 'algorithms/RL_ANALYSIS.md',
              'algorithms/RL_ALPHAZERO_OPTIMIZATION.md', 'algorithms/RL_BROWSER_OPTIMIZATION.md',
              'algorithms/RL_TRAINING_OPTIMIZATION.md', 'algorithms/RL_TRAINING_NUMERICAL_STABILITY.md',
              'algorithms/RL_TRAINING_DASHBOARD_FLOW.md', 'algorithms/RL_TRAINING_DASHBOARD_TRENDS.md']},
    {'name': '商业化与运营',
     'docs': ['operations/MONETIZATION.md', 'operations/MONETIZATION_CUSTOMIZATION.md',
              'operations/MONETIZATION_TRAINING_PANEL.md', 'operations/COMMERCIAL_OPERATIONS.md',
              'operations/COMMERCIAL_IMPROVEMENTS_CHECKLIST.md', 'operations/COMPLIANCE_AND_SOPS.md']},
    {'name': '外部集成',
     'docs': ['integrations/ADS_IAP_SETUP.md', 'integrations/ENTERPRISE_EXTENSIONS.md']},
    {'name': '平台扩展',
     'docs': ['platform/WECHAT_MINIPROGRAM.md', 'platform/WECHAT_RELEASE.md', 'platform/SYNC_CONTRACT.md']},
    {'name': '归档',
     'docs': ['archive/MONETIZATION_OPTIMIZATION.md', 'archive/MONETIZATION_PERSONALIZATION.md']},
]


def _resolve_under_docs(rel: str):
    """解析 docs/ 下 Markdown 路径，禁止跳出目录；返回 Path 或 None。"""
    if not rel or '..' in rel or rel.startswith('/'):
        return None
    base = _DOCS_DIR.resolve()
    cand = (base / rel).resolve()
    try:
        cand.relative_to(base)
    except ValueError:
        return None
    return cand if cand.is_file() else None


def _resolve_docs_markdown(rel: str):
    """在 docs/ 下解析文档：先精确路径，再按文件名在子树中唯一匹配。"""
    p = _resolve_under_docs(rel)
    if p is not None:
        return p
    name = Path(rel).name
    if '/' in rel or not name.endswith('.md'):
        return None
    base = _DOCS_DIR.resolve()
    matches = [x for x in base.rglob(name) if x.is_file()]
    if len(matches) == 1:
        return matches[0]
    return None


@app.route('/ops')
@app.route('/ops/')
def ops_portal():
    """运营看板入口"""
    from flask import send_from_directory
    page = _WEB_PUBLIC_DIR / 'ops-dashboard.html'
    if page.exists():
        return send_from_directory(str(_WEB_PUBLIC_DIR), 'ops-dashboard.html')
    return '<h1>ops-dashboard.html not found</h1>', 404


@app.route('/docs')
@app.route('/docs/')
def docs_portal():
    """文档门户首页。"""
    from flask import send_from_directory
    portal = _WEB_PUBLIC_DIR / 'docs.html'
    if portal.exists():
        return send_from_directory(str(_WEB_PUBLIC_DIR), 'docs.html')
    return '<h1>docs.html not found</h1>', 404


@app.route('/docs/list')
def docs_list():
    """返回所有文档的分类列表及元信息。"""
    result = []
    for cat in _DOC_CATEGORIES:
        items = []
        for fname in cat['docs']:
            path = _DOCS_DIR / fname
            if path.exists():
                text = path.read_text('utf-8', errors='replace')
                # 从第一个 # 标题提取文档标题
                title = fname
                for line in text.splitlines():
                    stripped = line.strip()
                    if stripped.startswith('# '):
                        title = stripped[2:].strip()
                        break
                items.append({'file': fname, 'title': title})
        result.append({'category': cat['name'], 'docs': items})
    return jsonify(result)


_ROOT_DIR = Path(__file__).resolve().parent


@app.route('/docs/raw/<path:filename>')
def docs_raw(filename):
    """返回指定文档的原始 Markdown 内容。

    查找顺序：
      1. docs/ 下精确路径或唯一 basename（见 _resolve_docs_markdown）
      2. 仓库根目录下扁平文件名（ARCHITECTURE.md / CONTRIBUTING.md 等）
    """
    import re
    if '..' in filename or filename.startswith('/'):
        return jsonify({'error': 'invalid filename'}), 400
    if not re.match(r'^[\w\-/]+\.md$', filename, re.ASCII):
        return jsonify({'error': 'invalid filename'}), 400

    path = _resolve_docs_markdown(filename)
    if path is None and '/' not in filename:
        root_path = (_ROOT_DIR / filename).resolve()
        try:
            root_path.relative_to(_ROOT_DIR.resolve())
        except ValueError:
            root_path = None
        if root_path and root_path.is_file():
            path = root_path

    if path is None:
        return jsonify({'error': 'not found'}), 404

    content = path.read_text('utf-8', errors='replace')
    return content, 200, {'Content-Type': 'text/plain; charset=utf-8',
                          'Cache-Control': 'no-cache'}


def create_app():
    """WSGI 工厂函数，供 gunicorn 等使用：``gunicorn 'server:create_app()'``。"""
    return app


def _flask_port():
    """与前端 OPENBLOCK_API_ORIGIN / VITE_API_BASE_URL 中的端口一致；显式 PORT 优先。"""
    if os.environ.get('PORT'):
        return int(os.environ['PORT'])
    base = os.environ.get('OPENBLOCK_API_ORIGIN') or os.environ.get('VITE_API_BASE_URL')
    if base:
        u = urlparse(base.strip())
        if u.port is not None:
            return u.port
    return 5000


if __name__ == '__main__':
    _port = _flask_port()
    _debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    print(f'Open Block API — http://0.0.0.0:{_port}  (db: {DATABASE})')
    app.run(host='0.0.0.0', port=_port, debug=_debug)
