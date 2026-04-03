/**
 * Block Blast - Database Layer
 * IndexedDB wrapper for local storage with complete behavior tracking
 */
import { CONFIG, ACHIEVEMENTS_BY_ID } from './config.js';

export class Database {
    constructor() {
        this.db = null;
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
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                if (!db.objectStoreNames.contains('sessions')) {
                    const sessions = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
                    sessions.createIndex('userId', 'userId', { unique: false });
                    sessions.createIndex('strategy', 'strategy', { unique: false });
                    sessions.createIndex('startTime', 'startTime', { unique: false });
                }

                if (!db.objectStoreNames.contains('behaviors')) {
                    const behaviors = db.createObjectStore('behaviors', { keyPath: 'id', autoIncrement: true });
                    behaviors.createIndex('sessionId', 'sessionId', { unique: false });
                    behaviors.createIndex('userId', 'userId', { unique: false });
                    behaviors.createIndex('timestamp', 'timestamp', { unique: false });
                    behaviors.createIndex('eventType', 'eventType', { unique: false });
                }

                if (!db.objectStoreNames.contains('scores')) {
                    const scores = db.createObjectStore('scores', { keyPath: 'id', autoIncrement: true });
                    scores.createIndex('userId', 'userId', { unique: false });
                    scores.createIndex('timestamp', 'timestamp', { unique: false });
                }

                if (!db.objectStoreNames.contains('achievements')) {
                    db.createObjectStore('achievements', { keyPath: 'id' });
                }

                if (!db.objectStoreNames.contains('stats')) {
                    db.createObjectStore('stats', { keyPath: 'key' });
                }

                if (!db.objectStoreNames.contains('strategies')) {
                    db.createObjectStore('strategies', { keyPath: 'id' });
                }

                if (!db.objectStoreNames.contains('replays')) {
                    const replays = db.createObjectStore('replays', { keyPath: 'id', autoIncrement: true });
                    replays.createIndex('sessionId', 'sessionId', { unique: false });
                    replays.createIndex('userId', 'userId', { unique: false });
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async saveSession(session) {
        const tx = this.db.transaction(['sessions'], 'readwrite');
        const store = tx.objectStore('sessions');
        return new Promise((resolve, reject) => {
            const data = {
                ...session,
                userId: this.userId,
                startTime: session.startTime || Date.now(),
                status: 'active'
            };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async updateSession(sessionId, updates) {
        const tx = this.db.transaction(['sessions'], 'readwrite');
        const store = tx.objectStore('sessions');
        return new Promise((resolve, reject) => {
            const getRequest = store.get(sessionId);
            getRequest.onsuccess = () => {
                const session = { ...getRequest.result, ...updates };
                const putRequest = store.put(session);
                putRequest.onsuccess = () => resolve(session);
                putRequest.onerror = () => reject(putRequest.error);
            };
        });
    }

    async getSession(sessionId) {
        const tx = this.db.transaction(['sessions'], 'readonly');
        const store = tx.objectStore('sessions');
        return new Promise((resolve, reject) => {
            const request = store.get(sessionId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getSessionsByUser(limit = 100) {
        const tx = this.db.transaction(['sessions'], 'readonly');
        const store = tx.objectStore('sessions');
        const index = store.index('userId');
        return new Promise((resolve, reject) => {
            const request = index.getAll(this.userId);
            request.onsuccess = () => {
                const results = request.result.sort((a, b) => b.startTime - a.startTime).slice(0, limit);
                resolve(results);
            };
            request.onerror = () => reject(request.error);
        });
    }

    async saveBehavior(behavior) {
        const tx = this.db.transaction(['behaviors'], 'readwrite');
        const store = tx.objectStore('behaviors');
        return new Promise((resolve, reject) => {
            const data = {
                ...behavior,
                userId: this.userId,
                timestamp: Date.now()
            };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveBehaviors(behaviors) {
        const tx = this.db.transaction(['behaviors'], 'readwrite');
        const store = tx.objectStore('behaviors');
        const promises = behaviors.map(b => {
            return new Promise((resolve, reject) => {
                const data = { ...b, userId: this.userId, timestamp: Date.now() };
                const request = store.add(data);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        });
        return Promise.all(promises);
    }

    async getBehaviorsBySession(sessionId) {
        const tx = this.db.transaction(['behaviors'], 'readonly');
        const store = tx.objectStore('behaviors');
        const index = store.index('sessionId');
        return new Promise((resolve, reject) => {
            const request = index.getAll(sessionId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getBehaviorsByType(eventType, limit = 1000) {
        const tx = this.db.transaction(['behaviors'], 'readonly');
        const store = tx.objectStore('behaviors');
        const index = store.index('eventType');
        return new Promise((resolve, reject) => {
            const request = index.getAll(eventType);
            request.onsuccess = () => {
                resolve(request.result.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit));
            };
            request.onerror = () => reject(request.error);
        });
    }

    async saveScore(score, strategy) {
        const tx = this.db.transaction(['scores'], 'readwrite');
        const store = tx.objectStore('scores');
        return new Promise((resolve, reject) => {
            const data = {
                userId: this.userId,
                score,
                strategy,
                timestamp: Date.now()
            };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getBestScore() {
        const tx = this.db.transaction(['scores'], 'readonly');
        const store = tx.objectStore('scores');
        const index = store.index('userId');
        return new Promise((resolve) => {
            const request = index.getAll(this.userId);
            request.onsuccess = () => {
                if (request.result.length === 0) {
                    resolve(0);
                } else {
                    resolve(Math.max(...request.result.map(x => x.score)));
                }
            };
            request.onerror = () => resolve(0);
        });
    }

    async getStats() {
        const tx = this.db.transaction(['stats'], 'readonly');
        const store = tx.objectStore('stats');
        return new Promise((resolve) => {
            const request = store.get('global');
            request.onsuccess = () => resolve(request.result || this.getDefaultStats());
            request.onerror = () => resolve(this.getDefaultStats());
        });
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
        const tx = this.db.transaction(['stats'], 'readwrite');
        const store = tx.objectStore('stats');
        const current = await this.getStats();
        const newStats = { ...current, ...updates, key: 'global' };
        return new Promise((resolve) => {
            store.put(newStats);
            resolve(newStats);
        });
    }

    async getAchievements() {
        const tx = this.db.transaction(['achievements'], 'readonly');
        const store = tx.objectStore('achievements');
        return new Promise((resolve) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result.map(a => a.id));
            request.onerror = () => resolve([]);
        });
    }

    async unlockAchievement(id) {
        const unlocked = await this.getAchievements();
        if (!unlocked.includes(id)) {
            const tx = this.db.transaction(['achievements'], 'readwrite');
            const store = tx.objectStore('achievements');
            return new Promise((resolve) => {
                store.add({ id, unlockedAt: Date.now() });
                resolve(true);
            });
        }
        return false;
    }

    /**
     * @param {object} gameStats
     * @param {{ durationMs?: number }} [options]
     */
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
        const tx = this.db.transaction(['strategies'], 'readwrite');
        const store = tx.objectStore('strategies');
        return new Promise((resolve, reject) => {
            const request = store.put({ ...strategy, updatedAt: Date.now() });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getStrategies() {
        const tx = this.db.transaction(['strategies'], 'readonly');
        const store = tx.objectStore('strategies');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async saveReplay(sessionId, events) {
        const tx = this.db.transaction(['replays'], 'readwrite');
        const store = tx.objectStore('replays');
        return new Promise((resolve, reject) => {
            const data = {
                sessionId,
                userId: this.userId,
                events: JSON.stringify(events),
                createdAt: Date.now()
            };
            const request = store.add(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getReplaysBySession(sessionId) {
        const tx = this.db.transaction(['replays'], 'readonly');
        const store = tx.objectStore('replays');
        const index = store.index('sessionId');
        return new Promise((resolve, reject) => {
            const request = index.getAll(sessionId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getAllReplays(limit = 50) {
        const tx = this.db.transaction(['replays'], 'readonly');
        const store = tx.objectStore('replays');
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => {
                resolve(request.result.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit));
            };
            request.onerror = () => reject(request.error);
        });
    }

    async clearAllData() {
        const stores = ['sessions', 'behaviors', 'scores', 'achievements', 'stats', 'strategies', 'replays'];
        for (const storeName of stores) {
            const tx = this.db.transaction([storeName], 'readwrite');
            const store = tx.objectStore(storeName);
            store.clear();
        }
    }
}
