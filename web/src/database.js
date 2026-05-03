/**
 * 持久化：通过 Flask 后端写入仓库根目录 SQLite（openblock.db，见 server.py）。
 * 需先启动 `npm run server` 或 `python3 server.py`，并配置 VITE_API_BASE_URL。
 */
import { getApiBaseUrl, isSqliteClientDatabase, ACHIEVEMENTS_BY_ID } from './config.js';
import { getSessionAttributionSnapshot } from './channelAttribution.js';

async function apiJson(path, options = {}) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options
    });
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { _raw: text };
        }
    }
    if (!res.ok) {
        const err = new Error(data?.error || `HTTP ${res.status} ${path}`);
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

export class Database {
    constructor() {
        this._ready = false;
        this.userId = this.getUserId();
    }

    getUserId() {
        let userId = localStorage.getItem('bb_user_id');
        if (!userId) {
            userId = 'u' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('bb_user_id', userId);
        }
        return userId;
    }

    async init() {
        if (!isSqliteClientDatabase()) {
            throw new Error(
                'VITE_USE_SQLITE_DB 已禁用或未配置；当前构建仅支持 SQLite 后端持久化，请先启用并启动 Flask（npm run server）。'
            );
        }
        try {
            await apiJson('/api/health');
        } catch (e) {
            console.error('SQLite API 不可用（请先启动 server.py 并检查 VITE_API_BASE_URL）:', e);
            throw e;
        }
        this._ready = true;
    }

    async saveSession(session) {
        const attribution =
            session.attribution && typeof session.attribution === 'object'
                ? session.attribution
                : getSessionAttributionSnapshot();
        const data = await apiJson('/api/session', {
            method: 'POST',
            body: JSON.stringify({
                user_id: this.userId,
                startTime: session.startTime || Date.now(),
                score: session.score ?? 0,
                strategy: session.strategy,
                strategyConfig: session.strategyConfig || {},
                attribution,
            }),
        });
        const id = data.session_id ?? data.id;
        if (id == null) {
            throw new Error('saveSession: 未返回 session_id');
        }
        return id;
    }

    async updateSession(sessionId, updates) {
        return apiJson(`/api/session/${sessionId}`, {
            method: 'PATCH',
            body: JSON.stringify(updates)
        });
    }

    async getSession(sessionId) {
        return apiJson(`/api/session/${sessionId}`);
    }

    async getSessionsByUser(limit = 100) {
        const list = await apiJson(
            `/api/sessions?user_id=${encodeURIComponent(this.userId)}&limit=${limit}`
        );
        return Array.isArray(list) ? list : [];
    }

    /**
     * 可回放对局：带 frames，按开局时间倒序（服务端已排序）。
     * 每项为会话 API 字段 + frames；与 GET /api/replay-sessions 一致。
     */
    async listReplaySessions(limit = 80) {
        const rows = await apiJson(
            `/api/replay-sessions?user_id=${encodeURIComponent(this.userId)}&limit=${limit}`
        );
        return Array.isArray(rows) ? rows : [];
    }

    /**
     * 删除对局及关联 move_sequences / behaviors / replays（须为本用户 session id）。
     * @param {number[]} sessionIds
     */
    async deleteReplaySessions(sessionIds) {
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
            return { success: true, deleted: [], count: 0 };
        }
        return apiJson('/api/replay-sessions/delete', {
            method: 'POST',
            body: JSON.stringify({ user_id: this.userId, session_ids: sessionIds })
        });
    }

    /** 删除展示得分为 0 的可回放对局（与列表分数判定一致，服务端筛选）。 */
    async deleteZeroScoreReplaySessions() {
        return apiJson('/api/replay-sessions/delete-zero-score', {
            method: 'POST',
            body: JSON.stringify({ user_id: this.userId })
        });
    }

    async saveBehavior(behavior) {
        await apiJson('/api/behavior/batch', {
            method: 'POST',
            body: JSON.stringify({
                behaviors: [
                    {
                        session_id: behavior.sessionId,
                        userId: this.userId,
                        eventType: behavior.eventType,
                        data: behavior.data ?? {},
                        gameState: behavior.gameState ?? {},
                        timestamp: behavior.timestamp ?? Date.now()
                    }
                ]
            })
        });
    }

    async saveBehaviors(behaviors) {
        if (!behaviors.length) {
            return;
        }
        const batch = behaviors.map((b) => ({
            session_id: b.sessionId,
            userId: this.userId,
            eventType: b.eventType,
            data: b.data ?? {},
            gameState: b.gameState ?? {},
            timestamp: b.timestamp ?? Date.now()
        }));
        await apiJson('/api/behavior/batch', {
            method: 'POST',
            body: JSON.stringify({ behaviors: batch })
        });
    }

    async getBehaviorsBySession(sessionId) {
        return apiJson(`/api/behaviors/${sessionId}`);
    }

    async getBehaviorsByType(eventType, limit = 1000) {
        const q = new URLSearchParams({
            user_id: this.userId,
            event_type: eventType,
            limit: String(limit)
        });
        return apiJson(`/api/behaviors?${q}`);
    }

    async saveScore(score, strategy) {
        await apiJson('/api/score', {
            method: 'POST',
            body: JSON.stringify({
                user_id: this.userId,
                score,
                strategy
            })
        });
    }

    async getBestScore() {
        const data = await apiJson(`/api/scores/best?user_id=${encodeURIComponent(this.userId)}`);
        return Number(data?.best ?? 0);
    }

    async getStats() {
        const data = await apiJson(`/api/client/stats?user_id=${encodeURIComponent(this.userId)}`);
        return {
            key: 'global',
            totalGames: data.totalGames ?? 0,
            totalScore: data.totalScore ?? 0,
            totalClears: data.totalClears ?? 0,
            maxCombo: data.maxCombo ?? 0,
            perfectPlacements: data.perfectPlacements ?? 0,
            totalPlacements: data.totalPlacements ?? 0,
            totalMisses: data.totalMisses ?? 0
        };
    }

    getDefaultStats() {
        return {
            key: 'global',
            totalGames: 0,
            totalScore: 0,
            totalClears: 0,
            maxCombo: 0,
            perfectPlacements: 0,
            totalPlacements: 0,
            totalMisses: 0
        };
    }

    async updateStats(updates) {
        const body = { user_id: this.userId, ...updates };
        await apiJson('/api/client/stats', {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        return this.getStats();
    }

    async getAchievements() {
        const rows = await apiJson(`/api/achievements/${encodeURIComponent(this.userId)}`);
        if (!Array.isArray(rows)) {
            return [];
        }
        return rows.map((r) => r.id).filter(Boolean);
    }

    async unlockAchievement(id) {
        const earned = await this.getAchievements();
        if (earned.includes(id)) {
            return false;
        }
        await apiJson('/api/achievement', {
            method: 'POST',
            body: JSON.stringify({
                user_id: this.userId,
                achievement_id: id
            })
        });
        return true;
    }

    async checkAndUnlockAchievements(gameStats, options = {}) {
        const unlocked = [];
        const earned = await this.getAchievements();
        const durationMs = options.durationMs ?? 0;

        const checks = [
            { id: 'first_clear', condition: gameStats.clears > 0 },
            { id: 'score_100', condition: gameStats.score >= 100 },
            { id: 'score_500', condition: gameStats.score >= 500 },
            { id: 'score_1000', condition: gameStats.score >= 1000 },
            { id: 'triple_clear', condition: gameStats.maxLinesCleared >= 3 },
            { id: 'five_clear', condition: gameStats.maxLinesCleared >= 5 },
            { id: 'combo', condition: gameStats.clears >= 10 },
            { id: 'perfect_game', condition: gameStats.score > 500 },
            {
                id: 'speed_runner',
                condition: durationMs > 0 && durationMs < 120_000 && gameStats.score > 0
            }
        ];

        for (const check of checks) {
            if (!earned.includes(check.id) && check.condition) {
                if (await this.unlockAchievement(check.id)) {
                    const meta = ACHIEVEMENTS_BY_ID[check.id];
                    if (meta) {
                        unlocked.push(meta);
                    }
                }
            }
        }

        const stats = await this.getStats();
        if (!earned.includes('ten_games') && stats.totalGames >= 10) {
            if (await this.unlockAchievement('ten_games')) {
                const meta = ACHIEVEMENTS_BY_ID.ten_games;
                if (meta) {
                    unlocked.push(meta);
                }
            }
        }

        return unlocked;
    }

    async saveStrategy(strategy) {
        await apiJson('/api/client/strategies', {
            method: 'PUT',
            body: JSON.stringify({
                user_id: this.userId,
                id: strategy.id,
                payload: strategy
            })
        });
    }

    async getStrategies() {
        return apiJson(`/api/client/strategies?user_id=${encodeURIComponent(this.userId)}`);
    }

    async upsertMoveSequence(sessionId, frames, analysis = null) {
        if (sessionId == null) {
            return;
        }
        const body = {
            user_id: this.userId,
            frames
        };
        if (analysis && typeof analysis === 'object') {
            body.analysis = analysis;
        }
        await apiJson(`/api/move-sequence/${sessionId}`, {
            method: 'PUT',
            body: JSON.stringify(body)
        });
    }

    async getMoveSequence(sessionId) {
        if (sessionId == null) {
            return null;
        }
        try {
            const data = await apiJson(`/api/move-sequence/${sessionId}`);
            const f = data?.frames;
            if (!Array.isArray(f) || f.length === 0) {
                return null;
            }
            return f;
        } catch (e) {
            console.warn('getMoveSequence failed:', sessionId, e);
            return null;
        }
    }

    async saveReplay(sessionId, events) {
        await apiJson('/api/replays', {
            method: 'POST',
            body: JSON.stringify({
                session_id: sessionId,
                user_id: this.userId,
                events
            })
        });
    }

    async getReplaysBySession(sessionId) {
        try {
            const data = await apiJson(`/api/replay/${sessionId}`);
            return Array.isArray(data?.events) ? data.events : [];
        } catch (e) {
            if (e.status === 404) {
                return [];
            }
            throw e;
        }
    }

    async getAllReplays(limit = 50) {
        return apiJson(
            `/api/replays?user_id=${encodeURIComponent(this.userId)}&limit=${limit}`
        );
    }

    async clearAllData() {
        await apiJson('/api/client/clear', {
            method: 'POST',
            body: JSON.stringify({ user_id: this.userId })
        });
    }
}
