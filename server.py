#!/usr/bin/env python3
"""
Block Blast Backend - Flask + SQLite
Complete user behavior tracking and analytics
"""

import os
import sqlite3
import json
import time
from datetime import datetime
from flask import Flask, request, jsonify, g
from flask_cors import CORS

_DEFAULT_DB = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'blockblast.db')
DATABASE = os.environ.get('BLOCKBLAST_DB_PATH', _DEFAULT_DB)

app = Flask(__name__)
CORS(app)


def get_db():
    """Get database connection for current request"""
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(DATABASE)
        db.row_factory = sqlite3.Row
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
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                unlocked_at INTEGER DEFAULT (strftime('%s', 'now')),
                UNIQUE(id, user_id)
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
    """Create a new game session"""
    data = request.get_json() or {}
    user_id = data.get('user_id', '')
    strategy = data.get('strategy', 'normal')
    strategy_config = json.dumps(data.get('strategyConfig', {}))

    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        INSERT INTO sessions (user_id, strategy, strategy_config, start_time)
        VALUES (?, ?, ?, ?)
    ''', (user_id, strategy, strategy_config, int(time.time())))

    db.commit()
    session_id = cursor.lastrowid

    cursor.execute('''
        INSERT OR IGNORE INTO user_stats (user_id) VALUES (?)
    ''', (user_id,))
    cursor.execute('''
        UPDATE user_stats SET total_games = total_games + 1, last_seen = ?
        WHERE user_id = ?
    ''', (int(time.time()), user_id))
    db.commit()

    return jsonify({'success': True, 'session_id': session_id})


@app.route('/api/session/<int:session_id>', methods=['PUT'])
def end_session(session_id):
    """End a game session"""
    data = request.get_json() or {}
    score = data.get('score', 0)
    duration = data.get('duration', 0)

    db = get_db()
    cursor = db.cursor()

    end_time = int(time.time())
    cursor.execute('''
        SELECT start_time, user_id, strategy FROM sessions WHERE id = ?
    ''', (session_id,))
    row = cursor.fetchone()

    if row:
        actual_duration = end_time - row['start_time']
        cursor.execute('''
            UPDATE sessions SET score = ?, end_time = ?, duration = ?, status = 'completed'
            WHERE id = ?
        ''', (score, end_time, actual_duration or duration, session_id))

        cursor.execute('''
            UPDATE user_stats SET
                total_score = total_score + ?,
                best_score = MAX(best_score, ?),
                total_play_time = total_play_time + ?,
                last_seen = ?
            WHERE user_id = ?
        ''', (score, score, actual_duration or duration, end_time, row['user_id']))

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
        cursor.execute('''
            INSERT INTO behaviors (session_id, user_id, event_type, event_data, game_state, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (
            b.get('session_id'),
            b.get('userId', ''),
            b.get('eventType', ''),
            json.dumps(b.get('data', {})),
            json.dumps(b.get('gameState', {})),
            b.get('timestamp', int(time.time()))
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
        INSERT OR IGNORE INTO achievements (id, user_id) VALUES (?, ?)
    ''', (achievement_id, user_id))

    db.commit()

    return jsonify({'success': True})


@app.route('/api/achievements/<user_id>', methods=['GET'])
def get_achievements(user_id):
    """Get all achievements for a user"""
    db = get_db()
    cursor = db.cursor()

    cursor.execute('''
        SELECT id, unlocked_at FROM achievements WHERE user_id = ?
    ''', (user_id,))

    return jsonify([{'id': row['id'], 'unlocked_at': row['unlocked_at']} for row in cursor.fetchall()])


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
        sessions.append({
            'id': row['id'],
            'user_id': row['user_id'],
            'strategy': row['strategy'],
            'score': row['score'],
            'start_time': row['start_time'],
            'end_time': row['end_time'],
            'duration': row['duration'],
            'status': row['status']
        })

    return jsonify(sessions)


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


init_db()


def create_app():
    """WSGI 工厂函数，供 gunicorn 等使用：``gunicorn 'server:create_app()'``。"""
    return app


if __name__ == '__main__':
    _port = int(os.environ.get('PORT', '5000'))
    _debug = os.environ.get('FLASK_DEBUG', '1') == '1'
    print(f'Block Blast API — http://0.0.0.0:{_port}  (db: {DATABASE})')
    app.run(host='0.0.0.0', port=_port, debug=_debug)
