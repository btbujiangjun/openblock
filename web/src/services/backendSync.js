/**
 * 可选的远端会话与行为同步（Flask API）。
 * SQLite 主存储模式下会话已随 `Database.saveSession` 创建，行为由 `database.saveBehaviors` 写入，此处避免重复 POST。
 */
import { getApiBaseUrl, isBackendSyncEnabled, isSqliteClientDatabase } from '../config.js';
import { APIClient } from '../api.js';

export class BackendSync {
    /**
     * @param {string} userId
     * @param {APIClient} [client]
     */
    constructor(userId, client = new APIClient()) {
        this.userId = userId;
        this.client = client;
        this.remoteSessionId = null;
        this.enabled = isBackendSyncEnabled();
    }

    /**
     * @param {string} strategy
     * @param {object} strategyConfig
     * @param {number|string|null} [localSessionId] SQLite 模式下与 `Database.saveSession` 返回的 id 一致，避免重复建会话
     */
    async startSession(strategy, strategyConfig, localSessionId = null) {
        this.client.setBaseUrl(getApiBaseUrl());
        if (isSqliteClientDatabase()) {
            this.remoteSessionId = localSessionId != null ? Number(localSessionId) : null;
            return this.remoteSessionId;
        }
        if (!this.enabled) {
            return null;
        }
        const res = await this.client.createSession(this.userId, strategy, strategyConfig);
        if (res && res.success && res.session_id != null) {
            this.remoteSessionId = res.session_id;
            return this.remoteSessionId;
        }
        return null;
    }

    /**
     * @param {Array<{ eventType: string, data?: object, gameState?: object, timestamp?: number }>} batch
     */
    async flushBatch(batch) {
        if (isSqliteClientDatabase() || !this.enabled || this.remoteSessionId == null || !batch.length) {
            return;
        }
        this.client.setBaseUrl(getApiBaseUrl());
        const behaviors = batch.map((b) => ({
            session_id: this.remoteSessionId,
            userId: this.userId,
            eventType: b.eventType,
            data: b.data ?? {},
            gameState: b.gameState ?? {},
            timestamp: b.timestamp ?? Date.now()
        }));
        await this.client.sendBehaviorBatch(behaviors);
    }

    /**
     * @param {number} score
     * @param {number} durationSec
     */
    async endSession(score, durationSec) {
        if (isSqliteClientDatabase()) {
            this.remoteSessionId = null;
            return;
        }
        if (!this.enabled || this.remoteSessionId == null) {
            return;
        }
        this.client.setBaseUrl(getApiBaseUrl());
        await this.client.endSession(this.remoteSessionId, score, Math.max(0, durationSec));
        this.remoteSessionId = null;
    }
}
