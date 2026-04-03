/**
 * 可选的远端会话与行为同步（Flask API）。
 * 仅当 VITE_SYNC_BACKEND=true 且 API 可达时生效；失败不影响本地游戏。
 */
import { getApiBaseUrl, isBackendSyncEnabled } from '../config.js';
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

    /** @param {string} strategy @param {object} strategyConfig */
    async startSession(strategy, strategyConfig) {
        if (!this.enabled) {
            return null;
        }
        this.client.setBaseUrl(getApiBaseUrl());
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
        if (!this.enabled || this.remoteSessionId == null || !batch.length) {
            return;
        }
        this.client.setBaseUrl(getApiBaseUrl());
        const behaviors = batch.map((b) => ({
            session_id: this.remoteSessionId,
            userId: this.userId,
            eventType: b.eventType,
            data: b.data ?? {},
            gameState: b.gameState ?? {},
            timestamp: Math.floor((b.timestamp ?? Date.now()) / 1000)
        }));
        await this.client.sendBehaviorBatch(behaviors);
    }

    /**
     * @param {number} score
     * @param {number} durationSec
     */
    async endSession(score, durationSec) {
        if (!this.enabled || this.remoteSessionId == null) {
            return;
        }
        this.client.setBaseUrl(getApiBaseUrl());
        await this.client.endSession(this.remoteSessionId, score, Math.max(0, durationSec));
        this.remoteSessionId = null;
    }
}
