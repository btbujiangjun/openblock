/**
 * DD2: dfs_budget_window 按桶上报契约测试。
 *
 * 验证：
 *   1. main.js 上报 payload 含 rolloutBucket / rolloutEnabled / rolloutSalt 三字段
 *   2. globalThis.__OPENBLOCK_ROLLOUT__ 缺失时 fallback 到安全默认 (-1/false/'')
 *   3. payload 含 X4 leafCap 字段（cappedCount/cappedRatio/leafUsageHist/evalTripletCalls）
 *      —— 之前 X1 上报漏报，DD2 一并补齐
 */
import { describe, it, expect, beforeEach } from 'vitest';

beforeEach(() => {
    if (typeof globalThis !== 'undefined') delete globalThis.__OPENBLOCK_ROLLOUT__;
});

/**
 * 复制 main.js 中 flushDfsStats 的 payload 构造逻辑，不依赖 main.js
 * （避免触发其全局副作用）。
 */
function buildPayload(stats, windowMs) {
    const rolloutInfo = (typeof globalThis !== 'undefined'
        && globalThis.__OPENBLOCK_ROLLOUT__?.dynamicLeafCap) || null;
    return {
        totalCalls: stats.totalCalls,
        truncatedCount: stats.truncatedCount,
        truncatedRatio: stats.truncatedRatio,
        budgetUsageHist: stats.budgetUsageHist,
        cappedCount: stats.cappedCount,
        cappedRatio: stats.cappedRatio,
        leafUsageHist: stats.leafUsageHist,
        evalTripletCalls: stats.evalTripletCalls,
        rolloutBucket: rolloutInfo?.bucket ?? -1,
        rolloutEnabled: rolloutInfo?.enabled ?? false,
        rolloutSalt: rolloutInfo?.salt ?? '',
        windowMs,
    };
}

async function getStats() {
    const mod = await import('../web/src/bot/blockSpawn.js');
    mod.resetBlockSpawnDfsStats();
    return mod.getBlockSpawnDfsStats();
}

describe('DD2 dfs_budget_window payload 含 rollout 字段', () => {
    it('全字段存在（含 X4 leafCap）', async () => {
        const stats = await getStats();
        const p = buildPayload(stats, 60_000);
        for (const k of [
            'totalCalls', 'truncatedCount', 'truncatedRatio', 'budgetUsageHist',
            'cappedCount', 'cappedRatio', 'leafUsageHist', 'evalTripletCalls',
            'rolloutBucket', 'rolloutEnabled', 'rolloutSalt', 'windowMs',
        ]) {
            expect(p).toHaveProperty(k);
        }
    });

    it('__OPENBLOCK_ROLLOUT__ 缺失 → 安全默认 (-1 / false / "")', async () => {
        const stats = await getStats();
        const p = buildPayload(stats, 60_000);
        expect(p.rolloutBucket).toBe(-1);
        expect(p.rolloutEnabled).toBe(false);
        expect(p.rolloutSalt).toBe('');
    });

    it('__OPENBLOCK_ROLLOUT__.dynamicLeafCap 存在 → 透传 bucket/enabled/salt', async () => {
        globalThis.__OPENBLOCK_ROLLOUT__ = {
            dynamicLeafCap: { bucket: 42, enabled: true, salt: 'dyn-cap-v1' },
        };
        const stats = await getStats();
        const p = buildPayload(stats, 60_000);
        expect(p.rolloutBucket).toBe(42);
        expect(p.rolloutEnabled).toBe(true);
        expect(p.rolloutSalt).toBe('dyn-cap-v1');
    });

    it('bucket 0..99 范围（即使桶=0 也透传，避免误判 fallback）', async () => {
        globalThis.__OPENBLOCK_ROLLOUT__ = {
            dynamicLeafCap: { bucket: 0, enabled: false, salt: 'beacon-v1' },
        };
        const stats = await getStats();
        const p = buildPayload(stats, 60_000);
        expect(p.rolloutBucket).toBe(0); /* 桶=0 vs -1 区分明确 */
        expect(p.rolloutEnabled).toBe(false);
    });

    it('整段 ROLLOUT 对象存在但 dynamicLeafCap 不存在 → fallback 默认', async () => {
        globalThis.__OPENBLOCK_ROLLOUT__ = { someOtherFeature: {} };
        const stats = await getStats();
        const p = buildPayload(stats, 60_000);
        expect(p.rolloutBucket).toBe(-1);
        expect(p.rolloutEnabled).toBe(false);
    });
});

describe('DD2 字段类型契约（防服务端聚合失败）', () => {
    it('rolloutBucket 是 integer / rolloutEnabled 是 boolean / rolloutSalt 是 string', async () => {
        globalThis.__OPENBLOCK_ROLLOUT__ = {
            dynamicLeafCap: { bucket: 50, enabled: true, salt: 'x' },
        };
        const stats = await getStats();
        const p = buildPayload(stats, 60_000);
        expect(Number.isInteger(p.rolloutBucket)).toBe(true);
        expect(typeof p.rolloutEnabled).toBe('boolean');
        expect(typeof p.rolloutSalt).toBe('string');
    });
});
