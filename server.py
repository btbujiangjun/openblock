#!/usr/bin/env python3
"""
Open Block Backend - Flask + SQLite
Complete user behavior tracking and analytics
"""

import os
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

_DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'blockblast.db')
DATABASE = os.environ.get('BLOCKBLAST_DB_PATH', _DEFAULT_DB)

app = Flask(__name__)
CORS(app)


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
            updated_at INTEGER DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (session_id) REFERENCES sessions(id)
        )
        """
    )

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

        _migrate_behaviors_columns(cursor)
        _migrate_schema(cursor)

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
    start_ms = data.get('startTime') or data.get('start_time')
    if start_ms is None:
        start_ms = int(time.time() * 1000)
    else:
        start_ms = int(start_ms)

    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        INSERT INTO sessions (user_id, strategy, strategy_config, start_time, score, status)
        VALUES (?, ?, ?, ?, ?, 'active')
    ''', (user_id, strategy, strategy_config, start_ms, int(data.get('score', 0))))

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
    cur.execute(
        """
        UPDATE sessions SET score = ?, status = ?, end_time = ?, game_stats = ?, strategy_config = ?
        WHERE id = ?
        """,
        (
            u.get("score", row["score"]),
            u.get("status", row["status"]),
            u.get("end_time", row["end_time"]),
            u.get("game_stats", row["game_stats"] if "game_stats" in row.keys() else None),
            u.get("strategy_config", row["strategy_config"]),
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
    if frames is None:
        return jsonify({"success": False, "error": "frames required"}), 400
    if not isinstance(frames, list) or len(frames) < _MIN_MOVE_FRAMES:
        return jsonify(
            {
                "success": False,
                "error": f"frames must have at least {_MIN_MOVE_FRAMES} entries",
            }
        ), 400
    db = get_db()
    cur = db.cursor()
    cur.execute(
        """
        INSERT INTO move_sequences (session_id, user_id, frames, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
            frames = excluded.frames,
            updated_at = excluded.updated_at,
            user_id = excluded.user_id
        """,
        (session_id, user_id, json.dumps(frames, ensure_ascii=False), int(time.time())),
    )
    db.commit()
    return jsonify({"success": True})


@app.route("/api/move-sequence/<int:session_id>", methods=["GET"])
def get_move_sequence(session_id):
    db = get_db()
    cur = db.cursor()
    cur.execute("SELECT frames FROM move_sequences WHERE session_id = ?", (session_id,))
    row = cur.fetchone()
    if not row:
        return jsonify({"frames": None})
    try:
        return jsonify({"frames": json.loads(row["frames"] or "[]")})
    except json.JSONDecodeError:
        return jsonify({"frames": None})


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
               s.end_time, s.duration, s.status, s.game_stats, m.frames AS move_frames
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
        rd = {k: row[k] for k in row.keys() if k != "move_frames"}
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


init_db()


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
