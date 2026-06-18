/**
 * @vitest-environment jsdom
 *
 * Z4：observability *_window 事件 schema 契约单测。
 *
 * 这是**契约测试**（contract testing），不是行为测试——
 * 锁定 X1 / Y3 / Y4 三个观测窗口事件的字段名 / 类型 / 范围，
 * 服务端 dashboard 依赖这些字段做聚合，重命名会静默断裂。
 *
 * 参考：docs/engineering/OBSERVABILITY_WINDOW_SCHEMA.md
 *
 * 校验维度：
 *   - 必备字段名一律存在（防止误删 / 重命名）
 *   - 类型正确（number / array / object）
 *   - ratio 字段值域 [0, 1]
 *   - 派生字段公式正确（如 truncatedRatio = truncatedCount/totalCalls）
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/* ============ X1: dfs_budget_window ============ */
describe('Z4 dfs_budget_window schema 契约', () => {
    let mod;
    beforeEach(async () => {
        vi.resetModules();
        mod = await import('../web/src/bot/blockSpawn.js');
        mod.resetBlockSpawnDfsStats();
    });

    it('getBlockSpawnDfsStats 返回所有必备字段（X1 + X4）', () => {
        const s = mod.getBlockSpawnDfsStats();
        /* 字段名锁定（重命名即测试失败） */
        expect(s).toHaveProperty('totalCalls');
        expect(s).toHaveProperty('truncatedCount');
        expect(s).toHaveProperty('truncatedRatio');
        expect(s).toHaveProperty('budgetUsageHist');
        expect(s).toHaveProperty('cappedCount');
        expect(s).toHaveProperty('cappedRatio');
        expect(s).toHaveProperty('leafUsageHist');
        expect(s).toHaveProperty('evalTripletCalls');
    });

    it('类型正确：number 计数 / array 直方图', () => {
        const s = mod.getBlockSpawnDfsStats();
        expect(typeof s.totalCalls).toBe('number');
        expect(typeof s.truncatedCount).toBe('number');
        expect(typeof s.truncatedRatio).toBe('number');
        expect(Array.isArray(s.budgetUsageHist)).toBe(true);
        expect(s.budgetUsageHist).toHaveLength(4);
        expect(Array.isArray(s.leafUsageHist)).toBe(true);
        expect(s.leafUsageHist).toHaveLength(4);
    });

    it('ratio ∈ [0, 1]', () => {
        const s = mod.getBlockSpawnDfsStats();
        expect(s.truncatedRatio).toBeGreaterThanOrEqual(0);
        expect(s.truncatedRatio).toBeLessThanOrEqual(1);
        expect(s.cappedRatio).toBeGreaterThanOrEqual(0);
        expect(s.cappedRatio).toBeLessThanOrEqual(1);
    });

    it('hist 各桶 ≥ 0', () => {
        const s = mod.getBlockSpawnDfsStats();
        for (const n of s.budgetUsageHist) expect(n).toBeGreaterThanOrEqual(0);
        for (const n of s.leafUsageHist) expect(n).toBeGreaterThanOrEqual(0);
    });
});

/* ============ Y3: analytics_store_window ============ */
describe('Z4 analytics_store_window schema 契约', () => {
    let mod;
    beforeEach(async () => {
        globalThis.indexedDB = undefined;
        const lsStub = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
        vi.stubGlobal('localStorage', lsStub);
        vi.resetModules();
        mod = await import('../web/src/lib/analyticsStore.js');
        mod._resetAnalyticsStoreForTests();
    });
    afterEach(() => { vi.unstubAllGlobals(); });

    it('getAnalyticsStoreStats 返回所有必备字段（Y3）', () => {
        const s = mod.getAnalyticsStoreStats();
        expect(s).toHaveProperty('idbPutOk');
        expect(s).toHaveProperty('idbPutFail');
        expect(s).toHaveProperty('idbWriteSuccessRate');
        expect(s).toHaveProperty('idbGetOk');
        expect(s).toHaveProperty('idbGetMiss');
        expect(s).toHaveProperty('idbAvgLatencyMs');
        expect(s).toHaveProperty('idbMaxLatencyMs');
        expect(s).toHaveProperty('lsPutFallback');
        expect(s).toHaveProperty('lsPutFailCount');
    });

    it('类型正确：所有字段均为 number', () => {
        const s = mod.getAnalyticsStoreStats();
        for (const k of Object.keys(s)) {
            expect(typeof s[k]).toBe('number');
        }
    });

    it('successRate ∈ [0, 1]；latency ≥ 0', () => {
        const s = mod.getAnalyticsStoreStats();
        expect(s.idbWriteSuccessRate).toBeGreaterThanOrEqual(0);
        expect(s.idbWriteSuccessRate).toBeLessThanOrEqual(1);
        expect(s.idbAvgLatencyMs).toBeGreaterThanOrEqual(0);
        expect(s.idbMaxLatencyMs).toBeGreaterThanOrEqual(0);
    });

    it('无操作时 successRate = 1（默认健康）', () => {
        const s = mod.getAnalyticsStoreStats();
        expect(s.idbWriteSuccessRate).toBe(1); /* 不除零 */
    });
});

/* ============ Y4: monetization_bus_window ============ */
describe('Z4 monetization_bus_window schema 契约', () => {
    let mod;
    beforeEach(async () => {
        vi.resetModules();
        mod = await import('../web/src/monetization/MonetizationBus.js');
        mod._clearAllHandlers();
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('getStats 返回所有必备字段（Y4）', () => {
        const s = mod.getStats();
        expect(s).toHaveProperty('events');
        expect(s).toHaveProperty('eventsFailed');
        expect(s).toHaveProperty('eventTypes');
        expect(s).toHaveProperty('totalHandlers');
        expect(s).toHaveProperty('totalEmits');
        expect(s).toHaveProperty('circuitOpenCount');
        expect(s).toHaveProperty('totalCircuitTrips');
        expect(s).toHaveProperty('totalHandlerFails');
        expect(s).toHaveProperty('handlerFailRate');
    });

    it('类型正确：events/eventsFailed 是 object，其余 number', () => {
        const s = mod.getStats();
        expect(typeof s.events).toBe('object');
        expect(typeof s.eventsFailed).toBe('object');
        expect(typeof s.eventTypes).toBe('number');
        expect(typeof s.totalHandlers).toBe('number');
        expect(typeof s.totalEmits).toBe('number');
        expect(typeof s.handlerFailRate).toBe('number');
    });

    it('handlerFailRate ∈ [0, 1]', () => {
        const s = mod.getStats();
        expect(s.handlerFailRate).toBeGreaterThanOrEqual(0);
        expect(s.handlerFailRate).toBeLessThanOrEqual(1);
    });

    it('零 emit → handlerFailRate = 0（不除零）', () => {
        expect(mod.getStats().handlerFailRate).toBe(0);
    });

    it('派生公式正确：handlerFailRate = fails / emits', () => {
        const bad = () => { throw new Error('e'); };
        mod.on('a', bad);
        mod.emit('a'); mod.emit('a'); mod.emit('a');
        const s = mod.getStats();
        expect(s.totalEmits).toBe(3);
        expect(s.totalHandlerFails).toBe(3);
        expect(s.handlerFailRate).toBeCloseTo(s.totalHandlerFails / s.totalEmits);
    });
});

/* ============ 跨事件契约：上报路径 sanity ============ */
describe('Z4 *_window 事件名注册一致性', () => {
    it('analyticsTracker ANALYTICS_EVENTS 含三个 *_window 事件', async () => {
        const mod = await import('../web/src/monetization/analyticsTracker.js');
        /* 重命名 ANALYTICS_EVENTS 字段会让 main.js trackEvent 调用对不上服务端 schema */
        expect(mod.ANALYTICS_EVENTS).toBeDefined();
        expect(mod.ANALYTICS_EVENTS.DFS_BUDGET_WINDOW?.name).toBe('dfs_budget_window');
        expect(mod.ANALYTICS_EVENTS.ANALYTICS_STORE_WINDOW?.name).toBe('analytics_store_window');
        expect(mod.ANALYTICS_EVENTS.MONETIZATION_BUS_WINDOW?.name).toBe('monetization_bus_window');
    });

    it('三事件均属 performance category', async () => {
        const mod = await import('../web/src/monetization/analyticsTracker.js');
        expect(mod.ANALYTICS_EVENTS.DFS_BUDGET_WINDOW.category).toBe('performance');
        expect(mod.ANALYTICS_EVENTS.ANALYTICS_STORE_WINDOW.category).toBe('performance');
        expect(mod.ANALYTICS_EVENTS.MONETIZATION_BUS_WINDOW.category).toBe('performance');
    });
});
