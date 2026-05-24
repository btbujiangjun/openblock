/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    initPolicyMetrics,
    recordPolicyResolve,
    reportGameOutcome,
    flushNow,
    getMetricsStats,
    disablePolicyMetrics,
} from '../../web/src/tuning/policyMetrics.js';

beforeEach(() => {
    disablePolicyMetrics();
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear();
    global.fetch = vi.fn();
});

describe('policyMetrics — init / disable', () => {
    it('未 init 时 record/report 是 no-op', () => {
        recordPolicyResolve('exact', 'normal:budget-p2:1500:growth', { temperature: 0.05 });
        reportGameOutcome({ score: 1000 });
        const s = getMetricsStats();
        expect(s.enabled).toBe(false);
        expect(s.resolves).toBe(0);
        expect(s.outcomes).toBe(0);
    });

    it('init 后 enabled=true', () => {
        initPolicyMetrics({ apiBaseUrl: 'http://localhost' });
        expect(getMetricsStats().enabled).toBe(true);
    });

    it('disable 后 record 不再统计', () => {
        initPolicyMetrics();
        recordPolicyResolve('exact', 'x:y:1:z', {});
        disablePolicyMetrics();
        recordPolicyResolve('exact', 'x:y:1:z', {});
        expect(getMetricsStats().resolves).toBe(1);
    });
});

describe('policyMetrics — record + report', () => {
    it('record 累加, report 归零并加入 outcome', () => {
        initPolicyMetrics();
        recordPolicyResolve('exact', 'normal:budget-p2:1500:growth', { temperature: 0.05 });
        recordPolicyResolve('exact', 'normal:budget-p2:1500:growth', { temperature: 0.05 });
        expect(getMetricsStats().resolves).toBe(2);
        expect(getMetricsStats().currentResolves).toBe(2);

        reportGameOutcome({ score: 1500, totalRounds: 50, clears: 10 });
        const s = getMetricsStats();
        expect(s.outcomes).toBe(1);
        expect(s.currentResolves).toBe(0);  // 局结束归零
        expect(s.bufferSize).toBe(1);
    });

    it('多 source 共存 → 取 dominant', () => {
        initPolicyMetrics();
        // 3 次 exact, 1 次 fallback → dominant 应是 exact
        recordPolicyResolve('exact', 'a:b:1:c', {});
        recordPolicyResolve('exact', 'a:b:1:c', {});
        recordPolicyResolve('exact', 'a:b:1:c', {});
        recordPolicyResolve('fallback', null, null);
        reportGameOutcome({ score: 2000 });

        const s = getMetricsStats();
        expect(s.bufferSize).toBe(1);
    });
});

describe('policyMetrics — flush', () => {
    it('flush 上报缓冲并清空', async () => {
        initPolicyMetrics({ apiBaseUrl: 'http://test' });
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: 1 }) }));

        recordPolicyResolve('exact', 'a:b:1:c', { temperature: 0.05 });
        reportGameOutcome({ score: 1500, totalRounds: 40, clears: 8 });
        expect(getMetricsStats().bufferSize).toBe(1);

        const r = await flushNow();
        expect(r.sent).toBe(1);
        expect(global.fetch).toHaveBeenCalledOnce();
        expect(getMetricsStats().bufferSize).toBe(0);
        expect(getMetricsStats().flushedBatches).toBe(1);
    });

    it('flush 失败保留缓冲', async () => {
        initPolicyMetrics({ apiBaseUrl: 'http://test' });
        global.fetch = vi.fn(() => Promise.reject(new Error('net err')));

        reportGameOutcome({ score: 1000 });
        const r = await flushNow();
        expect(r.error).toBeTruthy();
        expect(getMetricsStats().bufferSize).toBe(1);  // 保留
        expect(getMetricsStats().flushErrors).toBe(1);
    });

    it('空缓冲 flush 不报错', async () => {
        initPolicyMetrics({ apiBaseUrl: 'http://test' });
        const r = await flushNow();
        expect(r.sent).toBe(0);
    });
});

describe('policyMetrics — sessionStorage 持久化', () => {
    it('init 时从 sessionStorage 恢复缓冲', () => {
        sessionStorage.setItem('openblock_policy_metrics_buffer_v1', JSON.stringify({
            resolveBuffer: [],
            outcomeBuffer: [
                { context_key: 'a:b:1:c', source: 'exact', score: 500, ts: 1000 },
            ],
        }));
        initPolicyMetrics({ apiBaseUrl: 'http://test' });
        expect(getMetricsStats().bufferSize).toBe(1);
    });

    it('reportGameOutcome 持久化到 sessionStorage', () => {
        initPolicyMetrics({ apiBaseUrl: 'http://test' });
        recordPolicyResolve('exact', 'x:y:1:z', {});
        reportGameOutcome({ score: 1000 });
        const saved = JSON.parse(sessionStorage.getItem('openblock_policy_metrics_buffer_v1'));
        expect(saved.outcomeBuffer).toHaveLength(1);
    });
});

describe('policyMetrics — buffer 满自动 flush', () => {
    it('达到 maxBufferSize 触发 flush', async () => {
        initPolicyMetrics({ apiBaseUrl: 'http://test', maxBufferSize: 3 });
        global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

        reportGameOutcome({ score: 100 });
        reportGameOutcome({ score: 200 });
        expect(global.fetch).not.toHaveBeenCalled();

        reportGameOutcome({ score: 300 });
        // 同步 schedule, 等微任务
        await new Promise((r) => setTimeout(r, 10));
        expect(global.fetch).toHaveBeenCalledOnce();
    });
});
