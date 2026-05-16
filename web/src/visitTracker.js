/**
 * visitTracker.js
 *
 * 记录玩家访问会话（start/ping/end）：
 * - start：页面初始化后上报一条访问
 * - ping：周期心跳刷新 last_seen_at
 * - end：页面关闭/隐藏时尽量上报结束与访问时长
 */
import { getApiBaseUrl, isSqliteClientDatabase } from './config.js';

const VISIT_SESSION_KEY = 'openblock_visit_session_v1';
const PING_INTERVAL_MS = 20000;
const END_DEBOUNCE_MS = 500;

let _timer = null;
let _visitId = '';
let _startedAtSec = 0;
let _ending = false;
let _endTimer = null;

function _nowSec() {
    return Math.floor(Date.now() / 1000);
}

function _api(path, options = {}) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    return fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
        ...options,
    }).then(async (res) => {
        const text = await res.text();
        let data = null;
        if (text) {
            try { data = JSON.parse(text); } catch { data = { _raw: text }; }
        }
        if (!res.ok) {
            const err = new Error(data?.error || `HTTP ${res.status} ${path}`);
            err.status = res.status;
            throw err;
        }
        return data;
    });
}

function _getUserId() {
    let userId = localStorage.getItem('bb_user_id');
    if (!userId) {
        userId = `u${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        localStorage.setItem('bb_user_id', userId);
    }
    return userId;
}

function _safeJson(key, fallback = {}) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        const o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : fallback;
    } catch {
        return fallback;
    }
}

function _buildPlayerInfo() {
    const progress = _safeJson('openblock_progression_v1', {});
    const profile = _safeJson('openblock_player_profile', {});
    const rank = _safeJson('openblock_rank_v1', {});
    const checkin = _safeJson('openblock_checkin_v1', {});
    return {
        level: Number(progress?.level || progress?.currentLevel || 0) || 0,
        totalXp: Number(progress?.totalXp || 0) || 0,
        dailyStreak: Number(progress?.dailyStreak || 0) || 0,
        segment: profile?.segment5 || profile?.segment || '',
        flowState: profile?.flowState || '',
        sessionPhase: profile?.sessionPhase || '',
        rank: rank?.name || rank?.tier || '',
        checkinStreak: Number(checkin?.streak || 0) || 0,
        strategy: localStorage.getItem('openblock_strategy') || 'normal',
        skin: localStorage.getItem('openblock_skin') || 'classic',
    };
}

async function _startVisit() {
    const userId = _getUserId();
    _startedAtSec = _nowSec();
    const persisted = sessionStorage.getItem(VISIT_SESSION_KEY);
    if (persisted) _visitId = persisted;
    const payload = {
        user_id: userId,
        visit_id: _visitId || undefined,
        started_at: _startedAtSec,
        page: (typeof location !== 'undefined' ? location.pathname : '/') || '/',
        player_info: _buildPlayerInfo(),
    };
    const data = await _api('/api/visit/start', {
        method: 'POST',
        body: JSON.stringify(payload),
    });
    _visitId = data?.visitId || _visitId;
    if (_visitId) sessionStorage.setItem(VISIT_SESSION_KEY, _visitId);
}

async function _pingVisit() {
    if (!_visitId) return;
    await _api('/api/visit/ping', {
        method: 'POST',
        body: JSON.stringify({
            visit_id: _visitId,
            player_info: _buildPlayerInfo(),
        }),
        keepalive: true,
    });
}

async function _endVisit(reason = 'unload') {
    if (_ending || !_visitId) return;
    _ending = true;
    const endedAt = _nowSec();
    try {
        await _api('/api/visit/end', {
            method: 'POST',
            body: JSON.stringify({
                visit_id: _visitId,
                ended_at: endedAt,
                reason,
            }),
            keepalive: true,
        });
    } catch {
        // ignore
    } finally {
        sessionStorage.removeItem(VISIT_SESSION_KEY);
        _visitId = '';
        _ending = false;
    }
}

function _bindLifecycle() {
    window.addEventListener('beforeunload', () => {
        void _endVisit('beforeunload');
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            if (_endTimer) clearTimeout(_endTimer);
            _endTimer = setTimeout(() => { void _endVisit('hidden'); }, END_DEBOUNCE_MS);
        } else if (document.visibilityState === 'visible') {
            if (_endTimer) {
                clearTimeout(_endTimer);
                _endTimer = null;
            }
            void _pingVisit();
        }
    });
}

export async function initVisitTracker() {
    if (typeof window === 'undefined' || !isSqliteClientDatabase()) return;
    try {
        await _startVisit();
    } catch (e) {
        console.warn('[visitTracker] start failed:', e);
    }
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => { void _pingVisit(); }, PING_INTERVAL_MS);
    _bindLifecycle();
}

