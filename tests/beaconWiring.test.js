/**
 * CC4: main.js beacon 接入契约测试。
 *
 * 不直接执行 main.js（启动副作用大），而是验证两件事：
 *   1. game_rules.logging 字段结构含 remoteUrl / remoteRolloutPercent / remoteRolloutSalt
 *   2. createBatchSink + createBeaconSender 串联签名兼容（行为已在 BB5 / U3 单测覆盖）
 *   3. 双通道并行（tracker + beacon）：其中一个失败不影响另一个
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

beforeEach(() => {
    vi.unstubAllGlobals();
});

describe('CC4 game_rules.logging schema 新增字段', () => {
    let rules;
    beforeEach(async () => {
        const mod = await import('../shared/game_rules.json', { with: { type: 'json' } });
        rules = mod.default;
    });

    it('logging 段含 remoteUrl / remoteRolloutPercent / remoteRolloutSalt', () => {
        expect(rules.logging).toHaveProperty('remoteUrl');
        expect(rules.logging).toHaveProperty('remoteRolloutPercent');
        expect(rules.logging).toHaveProperty('remoteRolloutSalt');
    });

    it('阶段 0 默认配置：remoteUrl 空 + percent=0（行为零变化）', () => {
        expect(rules.logging.remoteUrl).toBe('');
        expect(rules.logging.remoteRolloutPercent).toBe(0);
    });

    it('salt 命名约定：含版本号（beacon-v1）', () => {
        expect(rules.logging.remoteRolloutSalt).toMatch(/^beacon-v\d+$/);
    });
});

describe('CC4 batchSink + beaconSender 双通道集成', () => {
    it('tracker 失败 → beacon 仍执行（双通道隔离）', async () => {
        const beacon = vi.fn(() => true);
        vi.stubGlobal('navigator', { sendBeacon: beacon });
        vi.stubGlobal('Blob', class { constructor(arr) { this.size = arr[0].length; } });

        const { createBatchSink } = await import('../web/src/lib/loggerBatchSink.js');
        const { createBeaconSender } = await import('../web/src/lib/beaconSender.js');
        const beaconSender = createBeaconSender('https://api.test/logs');

        const trackerFail = vi.fn(() => { throw new Error('tracker down'); });
        const sink = createBatchSink((batch) => {
            try { trackerFail(batch); } catch { /* swallow */ }
            try { beaconSender.send(batch); } catch { /* swallow */ }
        }, { maxBatch: 2, maxDelayMs: 100 });

        sink.sink({ ts: 1, level: 'error', tag: 't', args: ['a'] });
        sink.sink({ ts: 2, level: 'error', tag: 't', args: ['b'] });
        sink.flush();

        expect(trackerFail).toHaveBeenCalled();
        expect(beacon).toHaveBeenCalled();
    });

    it('beacon 失败 → tracker 仍执行（反向隔离）', async () => {
        /* 让 beacon 不可用 */
        vi.stubGlobal('navigator', undefined);
        vi.stubGlobal('fetch', undefined);

        const { createBatchSink } = await import('../web/src/lib/loggerBatchSink.js');
        const { createBeaconSender } = await import('../web/src/lib/beaconSender.js');
        const beaconSender = createBeaconSender('https://api.test/logs', { maxRetries: 0 });

        const tracker = vi.fn();
        const sink = createBatchSink((batch) => {
            try { tracker(batch); } catch { /* swallow */ }
            try { beaconSender.send(batch); } catch { /* swallow */ }
        }, { maxBatch: 2, maxDelayMs: 100 });

        sink.sink({ ts: 1, level: 'error', tag: 't', args: ['a'] });
        sink.sink({ ts: 2, level: 'error', tag: 't', args: ['b'] });
        sink.flush();

        expect(tracker).toHaveBeenCalled();
        expect(beaconSender.getStats().failed).toBeGreaterThan(0); /* beacon 失败但 tracker 不受影响 */
    });
});

describe('CC4 灰度灰度灰度（remoteRolloutPercent 决策）', () => {
    it('percent=0 → 所有用户都不走 beacon', async () => {
        const { resolveRolloutFeature } = await import('../web/src/lib/userBucketing.js');
        const cfg = { enabled: true, percent: 0, salt: 'beacon-v1' };
        for (let i = 0; i < 100; i++) {
            expect(resolveRolloutFeature(`u-${i}`, cfg)).toBe(false);
        }
    });

    it('percent=5 → 大约 5% 用户走 beacon（5000 样本）', async () => {
        const { resolveRolloutFeature } = await import('../web/src/lib/userBucketing.js');
        const cfg = { enabled: true, percent: 5, salt: 'beacon-v1' };
        let hit = 0;
        for (let i = 0; i < 5000; i++) {
            if (resolveRolloutFeature(`u-${i}`, cfg)) hit++;
        }
        expect(hit).toBeGreaterThanOrEqual(150);
        expect(hit).toBeLessThanOrEqual(400);
    });
});
