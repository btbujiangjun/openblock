/**
 * HTTP 客户端：与 Flask 后端通信。
 */
import { getApiBaseUrl } from './config.js';

export class APIClient {
    constructor() {
        this.baseUrl = getApiBaseUrl();
        this.pendingBehaviors = [];
        this.syncInterval = null;
        this.batchSize = 10;
    }

    async request(endpoint, options = {}) {
        try {
            const response = await fetch(`${this.baseUrl}${endpoint}`, {
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });
            const text = await response.text();
            if (!text) {
                return { success: response.ok };
            }
            try {
                return JSON.parse(text);
            } catch {
                return { success: false, error: 'invalid_json', raw: text.slice(0, 200) };
            }
        } catch (error) {
            console.warn('API request failed:', error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    /**
     * @param {string} userId
     * @param {string} strategy
     * @param {object} [strategyConfig]
     */
    async createSession(userId, strategy, strategyConfig = {}) {
        return this.request('/api/session', {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId,
                strategy,
                strategyConfig
            })
        });
    }

    async endSession(sessionId, score, duration) {
        return this.request(`/api/session/${sessionId}`, {
            method: 'PUT',
            body: JSON.stringify({ score, duration })
        });
    }

    async recordBehavior(behavior) {
        this.pendingBehaviors.push({
            ...behavior,
            timestamp: Date.now()
        });

        if (this.pendingBehaviors.length >= this.batchSize) {
            await this.flushBehaviors();
        }
    }

    async flushBehaviors() {
        if (this.pendingBehaviors.length === 0) {
            return;
        }

        const behaviors = [...this.pendingBehaviors];
        this.pendingBehaviors = [];

        try {
            await this.sendBehaviorBatch(behaviors);
        } catch {
            this.pendingBehaviors = [...behaviors, ...this.pendingBehaviors];
        }
    }

    /** @param {object[]} behaviors 已符合后端 batch 字段约定 */
    async sendBehaviorBatch(behaviors) {
        return this.request('/api/behavior/batch', {
            method: 'POST',
            body: JSON.stringify({ behaviors })
        });
    }

    async recordScore(userId, score, strategy) {
        return this.request('/api/score', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, score, strategy })
        });
    }

    async saveAchievement(userId, achievementId) {
        return this.request('/api/achievement', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, achievement_id: achievementId })
        });
    }

    async getAchievements(userId) {
        return this.request(`/api/achievements/${encodeURIComponent(userId)}`);
    }

    async getStats(userId) {
        return this.request(`/api/stats?user_id=${encodeURIComponent(userId)}`);
    }

    async getLeaderboard(limit = 10) {
        return this.request(`/api/leaderboard?limit=${limit}`);
    }

    async getBehaviorAnalytics(params = {}) {
        const queryString = new URLSearchParams(params).toString();
        return this.request(`/api/analytics/behaviors?${queryString}`);
    }

    async getSessionReplay(sessionId) {
        return this.request(`/api/replay/${sessionId}`);
    }

    startSync(intervalMs = 30000) {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        this.syncInterval = setInterval(() => {
            void this.flushBehaviors();
        }, intervalMs);
    }

    stopSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        void this.flushBehaviors();
    }

    setBaseUrl(url) {
        this.baseUrl = url.replace(/\/+$/, '');
        try {
            localStorage.setItem('api_url', this.baseUrl);
        } catch {
            /* ignore */
        }
    }
}

export const api = new APIClient();
