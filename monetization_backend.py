"""
商业化后端 Blueprint

路由：
    GET  /api/mon/status
    GET  /api/mon/leaderboard/daily?limit=20&date=YYYY-MM-DD
    POST /api/mon/leaderboard/submit
    GET  /api/mon/user-profile/<user_id>   — 个性化商业画像（从 SQLite 计算）
    GET  /api/mon/aggregate                — 全局聚合指标（用于训练面板）
    GET  /api/mon/model/config             — 个性化模型参数配置
    PUT  /api/mon/model/config             — 更新模型配置
    POST /api/mon/strategy/log             — 记录策略曝光事件

Schema（与 server.py 同数据库）：
    mon_daily_scores   — 每日排行榜得分
    mon_user_segments  — 用户分群快照缓存
    mon_model_config   — 个性化模型配置 JSON
    mon_strategy_log   — 策略曝光/转化日志
"""

from __future__ import annotations

import json
import math
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path

from flask import Blueprint, jsonify, request, g


# ─── DB 工具 ──────────────────────────────────────────────────────────────────

def _db_path() -> Path:
    import os
    default = Path(__file__).resolve().parent / 'openblock.db'
    return Path(os.environ.get('OPENBLOCK_DB_PATH', str(default)))


def _get_db():
    db = getattr(g, '_mon_db', None)
    if db is None:
        db = g._mon_db = sqlite3.connect(str(_db_path()))
        db.row_factory = sqlite3.Row
        try:
            db.execute('PRAGMA journal_mode=WAL')
            db.execute('PRAGMA busy_timeout=5000')
        except sqlite3.OperationalError:
            pass
    return db


def _ensure_schema(db):
    """建表（幂等）。所有商业化表前缀 mon_。"""
    db.executescript("""
        CREATE TABLE IF NOT EXISTS mon_daily_scores (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      TEXT    NOT NULL,
            score        INTEGER NOT NULL,
            strategy     TEXT    DEFAULT 'normal',
            date_ymd     TEXT    NOT NULL,
            submitted_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_mon_daily_scores_date
            ON mon_daily_scores(date_ymd, score DESC);

        CREATE TABLE IF NOT EXISTS mon_user_segments (
            user_id          TEXT    PRIMARY KEY,
            segment          TEXT    DEFAULT 'minnow',
            whale_score      REAL    DEFAULT 0,
            activity_score   REAL    DEFAULT 0,
            skill_score      REAL    DEFAULT 0,
            frustration_avg  REAL    DEFAULT 0,
            near_miss_rate   REAL    DEFAULT 0,
            last_computed    INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS mon_model_config (
            id         TEXT    PRIMARY KEY DEFAULT 'default',
            config     TEXT    NOT NULL    DEFAULT '{}',
            updated_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS mon_strategy_log (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id      TEXT    NOT NULL,
            strategy     TEXT    NOT NULL,
            action       TEXT    NOT NULL,
            converted    INTEGER DEFAULT 0,
            logged_at    INTEGER DEFAULT (strftime('%s', 'now'))
        );
    """)
    db.commit()

    # 写入默认模型配置（如果不存在）
    existing = db.execute(
        "SELECT id FROM mon_model_config WHERE id='default'"
    ).fetchone()
    if not existing:
        default_cfg = json.dumps({
            "version": 1,
            "segmentWeights": {
                "best_score_norm":  0.40,
                "total_games_norm": 0.30,
                "session_time_norm": 0.30
            },
            "segmentThresholds": {"whale": 0.60, "dolphin": 0.30},
            "adTrigger": {
                "frustrationThreshold": 5,
                "nearMissEnabled": True,
                "maxRewardedPerGame": 3
            },
            "iapTrigger": {
                "showStarterPackHours": 24,
                "showWeeklyPassAfterGames": 5,
                "showMonthlyPassAfterGames": 15
            },
            "taskWeights": {
                "xpPerClear": 1.5,
                "xpPerGame": 20,
                "xpPerCombo3": 40
            }
        })
        db.execute(
            "INSERT OR IGNORE INTO mon_model_config(id, config) VALUES('default', ?)",
            (default_cfg,)
        )
        db.commit()


def _today_ymd() -> str:
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def _model_cfg(db) -> dict:
    row = db.execute(
        "SELECT config FROM mon_model_config WHERE id='default'"
    ).fetchone()
    if not row:
        return {}
    try:
        return json.loads(row['config'])
    except (json.JSONDecodeError, TypeError):
        return {}


# ─── 用户分群计算 ─────────────────────────────────────────────────────────────

def _compute_user_profile(db, user_id: str) -> dict:
    """
    从 SQLite 聚合用户商业画像。

    分群指标：
      whale_score = best_score/1000 * w0 + total_games/50 * w1 + avg_session_min/10 * w2
      activity_score = recent_7d_games/7 * 0.6 + (streak > 0) * 0.4
      segment = whale(>0.60) | dolphin(0.30-0.60) | minnow(<0.30)
    """
    cfg = _model_cfg(db)
    seg_w = cfg.get('segmentWeights', {})
    w0 = seg_w.get('best_score_norm', 0.40)
    w1 = seg_w.get('total_games_norm', 0.30)
    w2 = seg_w.get('session_time_norm', 0.30)

    thresholds = cfg.get('segmentThresholds', {'whale': 0.60, 'dolphin': 0.30})

    # — user_stats 全量聚合 —
    stats_row = db.execute("""
        SELECT total_games, best_score, total_score, total_play_time,
               total_clears, max_combo, total_placements, total_misses
        FROM user_stats WHERE user_id = ?
    """, (user_id,)).fetchone()
    if not stats_row:
        return _empty_profile(user_id)

    total_games = int(stats_row['total_games'] or 0)
    best_score = int(stats_row['best_score'] or 0)
    total_play_time = int(stats_row['total_play_time'] or 0)
    total_clears = int(stats_row['total_clears'] or 0)
    total_placements = int(stats_row['total_placements'] or 0)
    total_misses = int(stats_row['total_misses'] or 0)
    max_combo = int(stats_row['max_combo'] or 0)

    # — 近 7 天活跃局数 —
    seven_days_ago = int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp())
    recent_row = db.execute("""
        SELECT COUNT(*) AS cnt FROM sessions
        WHERE user_id=? AND status='completed' AND start_time >= ?
    """, (user_id, seven_days_ago)).fetchone()
    recent_7d = int(recent_row['cnt'] or 0) if recent_row else 0

    # — 近 30 天平均每局时长（秒）—
    avg_dur_row = db.execute("""
        SELECT AVG(duration) AS avg_dur FROM sessions
        WHERE user_id=? AND status='completed' AND duration IS NOT NULL
        ORDER BY start_time DESC LIMIT 30
    """, (user_id,)).fetchone()
    avg_session_sec = float(avg_dur_row['avg_dur'] or 0) if avg_dur_row else 0

    # — 行为信号：near-miss（no_clear 次数 / place 次数）—
    beh_row = db.execute("""
        SELECT
            COUNT(CASE WHEN event_type='no_clear' THEN 1 END) AS no_clears,
            COUNT(CASE WHEN event_type='place'    THEN 1 END) AS places
        FROM behaviors WHERE user_id=?
    """, (user_id,)).fetchone()
    no_clears = int(beh_row['no_clears'] or 0) if beh_row else 0
    places    = int(beh_row['places']    or 0) if beh_row else 0
    near_miss_rate = no_clears / max(places, 1)

    # — 指标标准化 —
    best_score_norm  = min(1.0, best_score / 2000.0)
    total_games_norm = min(1.0, total_games / 50.0)
    avg_session_norm = min(1.0, avg_session_sec / 600.0)  # 10 分钟为满

    whale_score = (
        w0 * best_score_norm +
        w1 * total_games_norm +
        w2 * avg_session_norm
    )
    activity_score = min(1.0,
        0.60 * min(1.0, recent_7d / 7.0) +
        0.40 * (1 if recent_7d > 0 else 0)
    )
    skill_score = min(1.0, total_clears / max(total_placements, 1))
    frustration_avg = min(1.0, total_misses / max(total_placements, 1) * 2)

    # — 分群判定 —
    if whale_score >= thresholds.get('whale', 0.60):
        segment = 'whale'
    elif whale_score >= thresholds.get('dolphin', 0.30):
        segment = 'dolphin'
    else:
        segment = 'minnow'

    # — 持久化缓存到 mon_user_segments —
    db.execute("""
        INSERT INTO mon_user_segments
          (user_id, segment, whale_score, activity_score, skill_score,
           frustration_avg, near_miss_rate, last_computed)
        VALUES (?,?,?,?,?,?,?, strftime('%s','now'))
        ON CONFLICT(user_id) DO UPDATE SET
          segment=excluded.segment,
          whale_score=excluded.whale_score,
          activity_score=excluded.activity_score,
          skill_score=excluded.skill_score,
          frustration_avg=excluded.frustration_avg,
          near_miss_rate=excluded.near_miss_rate,
          last_computed=excluded.last_computed
    """, (user_id, segment, round(whale_score, 4), round(activity_score, 4),
          round(skill_score, 4), round(frustration_avg, 4), round(near_miss_rate, 4)))
    db.commit()

    # — 商业化策略推荐 —
    strategy = _build_strategy(segment, activity_score, frustration_avg, near_miss_rate, cfg)

    return {
        'user_id':          user_id,
        'segment':          segment,
        'whale_score':      round(whale_score, 4),
        'activity_score':   round(activity_score, 4),
        'skill_score':      round(skill_score, 4),
        'frustration_avg':  round(frustration_avg, 4),
        'near_miss_rate':   round(near_miss_rate, 4),
        'recent_7d_games':  recent_7d,
        'total_games':      total_games,
        'best_score':       best_score,
        'avg_session_sec':  round(avg_session_sec, 1),
        'max_combo':        max_combo,
        'strategy':         strategy,
    }


def _empty_profile(user_id: str) -> dict:
    return {
        'user_id': user_id, 'segment': 'minnow',
        'whale_score': 0, 'activity_score': 0, 'skill_score': 0,
        'frustration_avg': 0, 'near_miss_rate': 0,
        'recent_7d_games': 0, 'total_games': 0, 'best_score': 0,
        'avg_session_sec': 0, 'max_combo': 0,
        'strategy': {'actions': [], 'explain': '用户无历史记录，采用新手默认策略。'},
    }


def _build_strategy(segment: str, activity: float, frustration: float,
                    near_miss: float, cfg: dict) -> dict:
    """根据分群与实时信号生成商业化策略建议。"""
    actions = []
    reasons = []

    iap_cfg = cfg.get('iapTrigger', {})

    if segment == 'whale':
        actions.append({'type': 'iap', 'product': 'monthly_pass', 'priority': 'high'})
        reasons.append('高价值用户（Whale），优先展示月卡/高端皮肤')
        if frustration > 0.4:
            actions.append({'type': 'iap', 'product': 'hint_pack_5', 'priority': 'medium'})
            reasons.append('挫败感较高，推送提示包降低流失风险')
        actions.append({'type': 'ads', 'format': 'none', 'reason': '高价值用户不打断广告'})

    elif segment == 'dolphin':
        actions.append({'type': 'iap', 'product': 'weekly_pass', 'priority': 'medium'})
        reasons.append('中等用户（Dolphin），周卡 ROI 最高')
        if near_miss > 0.3:
            actions.append({'type': 'ads', 'format': 'rewarded', 'trigger': 'near_miss',
                            'priority': 'high'})
            reasons.append(f'近失率 {near_miss:.0%}，激励广告在 near-miss 时转化率高')
        if activity < 0.4:
            actions.append({'type': 'push', 'template': 'streak_reminder'})
            reasons.append('近期活跃度低，推送连签提醒以提升 D7 留存')

    else:  # minnow
        actions.append({'type': 'ads', 'format': 'interstitial', 'trigger': 'game_over',
                        'priority': 'high'})
        reasons.append('轻度用户（Minnow），游戏结束插屏广告 eCPM 最高')
        if frustration > 0.5:
            actions.append({'type': 'iap', 'product': 'starter_pack', 'priority': 'medium'})
            reasons.append('高挫败感，限时新手礼包可激活首次付费')
        actions.append({'type': 'task', 'template': 'daily_tasks'})
        reasons.append('每日任务提升 D1 留存，为潜在付费转化蓄力')

    return {
        'segment': segment,
        'actions': actions,
        'explain': '；'.join(reasons),
    }


# ─── Blueprint ────────────────────────────────────────────────────────────────

def create_mon_blueprint() -> Blueprint:
    bp = Blueprint('monetization', __name__)

    @bp.route('/api/mon/status', methods=['GET'])
    def mon_status():
        return jsonify({'ok': True, 'module': 'monetization'})

    # ── 排行榜 ──────────────────────────────────────────────────────────────

    @bp.route('/api/mon/leaderboard/daily', methods=['GET'])
    def lb_daily():
        try:
            limit = max(1, min(100, int(request.args.get('limit', 20))))
        except (TypeError, ValueError):
            limit = 20
        date_ymd = request.args.get('date', _today_ymd())
        db = _get_db()
        rows = db.execute("""
            SELECT user_id, MAX(score) AS score, strategy
            FROM mon_daily_scores WHERE date_ymd=?
            GROUP BY user_id ORDER BY score DESC LIMIT ?
        """, (date_ymd, limit)).fetchall()
        entries = [{'user_id': r['user_id'], 'score': r['score'],
                    'strategy': r['strategy']} for r in rows]
        return jsonify({'date': date_ymd, 'entries': entries})

    @bp.route('/api/mon/leaderboard/submit', methods=['POST'])
    def lb_submit():
        data = request.get_json(force=True, silent=True) or {}
        user_id = str(data.get('userId') or data.get('user_id') or '').strip()
        try:
            score = int(data.get('score', 0))
        except (TypeError, ValueError):
            score = 0
        strategy = str(data.get('strategy', 'normal'))[:32]
        if not user_id or score <= 0:
            return jsonify({'ok': False, 'error': 'user_id and score required'}), 400
        db = _get_db()
        db.execute(
            "INSERT INTO mon_daily_scores (user_id, score, strategy, date_ymd) VALUES (?,?,?,?)",
            (user_id, score, strategy, _today_ymd())
        )
        db.commit()
        return jsonify({'ok': True, 'date': _today_ymd(), 'score': score})

    # ── 用户商业画像 ─────────────────────────────────────────────────────────

    @bp.route('/api/mon/user-profile/<user_id>', methods=['GET'])
    def mon_user_profile(user_id):
        """
        计算并返回用户商业画像（分群 + 信号 + 策略推荐）。
        结果缓存到 mon_user_segments；?force=1 强制重新计算。
        """
        db = _get_db()
        force = request.args.get('force', '0') in ('1', 'true')

        if not force:
            # 检查是否有 1 小时内的缓存
            cached = db.execute("""
                SELECT * FROM mon_user_segments
                WHERE user_id=? AND last_computed > strftime('%s','now') - 3600
            """, (user_id,)).fetchone()
            if cached:
                cfg = _model_cfg(db)
                seg = cached['segment']
                strategy = _build_strategy(
                    seg,
                    float(cached['activity_score'] or 0),
                    float(cached['frustration_avg'] or 0),
                    float(cached['near_miss_rate'] or 0),
                    cfg
                )
                return jsonify({
                    'user_id':         user_id,
                    'segment':         seg,
                    'whale_score':     float(cached['whale_score'] or 0),
                    'activity_score':  float(cached['activity_score'] or 0),
                    'skill_score':     float(cached['skill_score'] or 0),
                    'frustration_avg': float(cached['frustration_avg'] or 0),
                    'near_miss_rate':  float(cached['near_miss_rate'] or 0),
                    'strategy':        strategy,
                    'cached':          True,
                })

        profile = _compute_user_profile(db, user_id)
        return jsonify({**profile, 'cached': False})

    # ── 全局聚合（训练面板用）───────────────────────────────────────────────

    @bp.route('/api/mon/aggregate', methods=['GET'])
    def mon_aggregate():
        """
        返回全局商业化聚合指标（用于商业化模型训练面板）。
        """
        db = _get_db()
        seven_ago = int((datetime.now(timezone.utc) - timedelta(days=7)).timestamp())
        thirty_ago = int((datetime.now(timezone.utc) - timedelta(days=30)).timestamp())

        # 用户总数
        total_users = db.execute(
            "SELECT COUNT(*) AS cnt FROM user_stats"
        ).fetchone()['cnt'] or 0

        # 近 7 日活跃用户
        dau7 = db.execute(
            "SELECT COUNT(DISTINCT user_id) AS cnt FROM sessions WHERE start_time >= ?",
            (seven_ago,)
        ).fetchone()['cnt'] or 0

        # 近 7 日总局数
        games7 = db.execute(
            "SELECT COUNT(*) AS cnt FROM sessions WHERE start_time >= ? AND status='completed'",
            (seven_ago,)
        ).fetchone()['cnt'] or 0

        # 平均得分（近 30 日）
        avg_score = db.execute(
            "SELECT AVG(score) AS avg FROM sessions WHERE start_time >= ? AND score > 0",
            (thirty_ago,)
        ).fetchone()['avg'] or 0

        # 分群分布（来自缓存表）
        segs = db.execute("""
            SELECT segment, COUNT(*) AS cnt FROM mon_user_segments GROUP BY segment
        """).fetchall()
        seg_dist = {row['segment']: row['cnt'] for row in segs}

        # 今日榜排行榜参与人数
        lb_today = db.execute(
            "SELECT COUNT(DISTINCT user_id) AS cnt FROM mon_daily_scores WHERE date_ymd=?",
            (_today_ymd(),)
        ).fetchone()['cnt'] or 0

        # 行为事件分布（近 7 日）
        beh_dist = db.execute("""
            SELECT event_type, COUNT(*) AS cnt FROM behaviors
            WHERE created_at >= ? GROUP BY event_type ORDER BY cnt DESC LIMIT 10
        """, (seven_ago,)).fetchall()
        beh_data = [{'event': r['event_type'], 'count': r['cnt']} for r in beh_dist]

        # 平均会话时长（近 30 日，有效局）
        avg_dur = db.execute("""
            SELECT AVG(duration) AS avg FROM sessions
            WHERE start_time >= ? AND duration IS NOT NULL AND duration > 0
        """, (thirty_ago,)).fetchone()['avg'] or 0

        return jsonify({
            'total_users':    total_users,
            'dau_7d':         dau7,
            'games_7d':       games7,
            'avg_score_30d':  round(float(avg_score), 1),
            'avg_session_sec_30d': round(float(avg_dur), 1),
            'segment_dist':   seg_dist,
            'lb_participants_today': lb_today,
            'behavior_dist':  beh_data,
            'computed_at':    _today_ymd(),
        })

    # ── 模型配置 ─────────────────────────────────────────────────────────────

    @bp.route('/api/mon/model/config', methods=['GET'])
    def mon_model_config_get():
        db = _get_db()
        return jsonify(_model_cfg(db))

    @bp.route('/api/mon/model/config', methods=['PUT'])
    def mon_model_config_put():
        data = request.get_json(force=True, silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'ok': False, 'error': 'expected JSON object'}), 400
        db = _get_db()
        current = _model_cfg(db)
        # 深合并（仅顶层键）
        merged = {**current, **data}
        db.execute("""
            INSERT INTO mon_model_config(id, config, updated_at)
            VALUES('default', ?, strftime('%s','now'))
            ON CONFLICT(id) DO UPDATE SET config=excluded.config,
                                          updated_at=excluded.updated_at
        """, (json.dumps(merged),))
        db.commit()
        return jsonify({'ok': True, 'config': merged})

    # ── 策略曝光日志 ─────────────────────────────────────────────────────────

    @bp.route('/api/mon/strategy/log', methods=['POST'])
    def mon_strategy_log():
        data = request.get_json(force=True, silent=True) or {}
        user_id  = str(data.get('userId') or data.get('user_id') or '').strip()
        strategy = str(data.get('strategy', ''))[:64]
        action   = str(data.get('action', ''))[:64]
        converted = 1 if data.get('converted') else 0
        if not user_id:
            return jsonify({'ok': False, 'error': 'user_id required'}), 400
        db = _get_db()
        db.execute("""
            INSERT INTO mon_strategy_log(user_id, strategy, action, converted)
            VALUES(?,?,?,?)
        """, (user_id, strategy, action, converted))
        db.commit()
        return jsonify({'ok': True})

    return bp


def init_mon_db():
    """供 server.py 在 app context 内调用，建表（幂等）。"""
    db = sqlite3.connect(str(_db_path()))
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA journal_mode=WAL')
    except sqlite3.OperationalError:
        pass
    _ensure_schema(db)
    db.close()
