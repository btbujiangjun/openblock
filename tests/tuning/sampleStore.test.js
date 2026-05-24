/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
    InMemorySampleStore,
    HybridSampleStore,
    buildSampleRecord,
    SqliteSampleStore,
} from '../../web/src/tuning/sampleStore.js';

function mkContext(overrides = {}) {
    return {
        difficulty: 'normal',
        generator: 'budget-p2',
        bestScore_bin: 1500,
        lifecycle_stage: 'growth',
        ...overrides,
    };
}

function mkRow(overrides = {}) {
    return {
        noMoveRate: 0.05, clearsMean: 18, multiClearRate: 0.30,
        fallbackRate: 0.01, firstMoveFreedomMean: 8,
        clearIntervalP90: 6, nearPbRate: 0.30, breakPbRate: 0.10,
        overshootRate: 0.05, scoreMean: 1200, scoreP90: 1800,
        evaluatedTripletsMean: 64,
        ...overrides,
    };
}

function mkRecord(overrides = {}) {
    return buildSampleRecord({
        runId: 1,
        context: mkContext(),
        theta: { temperature: 0.04 },
        seed: 7,
        row: mkRow(),
        subscores: { fairness: 0.8, excitement: 0.7, antiInflation: 0.6 },
        evalMs: 120,
        phase: 'lhs',
        ...overrides,
    });
}

describe('sampleStore — buildSampleRecord', () => {
    it('整合所有字段', () => {
        const rec = mkRecord();
        expect(rec.context_key).toBe('normal:budget-p2:1500:growth');
        expect(rec.difficulty).toBe('normal');
        expect(rec.generator).toBe('budget-p2');
        expect(rec.bestScore_bin).toBe(1500);
        expect(rec.lifecycle_stage).toBe('growth');
        expect(rec.fairness_score).toBe(0.8);
        expect(rec.excitement_score).toBe(0.7);
        expect(rec.antiInflation_score).toBe(0.6);
        expect(rec.run_id).toBe(1);
        expect(rec.seed).toBe(7);
        expect(rec.eval_ms).toBe(120);
        expect(rec.sample_phase).toBe('lhs');
        expect(typeof rec.theta_json).toBe('string');
        expect(JSON.parse(rec.theta_json)).toEqual({ temperature: 0.04 });
    });

    it('指标字段从 row 复制', () => {
        const rec = mkRecord({ row: mkRow({ noMoveRate: 0.20, overshootRate: 0.45 }) });
        expect(rec.noMoveRate).toBe(0.20);
        expect(rec.overshootRate).toBe(0.45);
    });

    it('evaluated_at 自动填充', () => {
        const before = Date.now();
        const rec = mkRecord();
        const after = Date.now();
        expect(rec.evaluated_at).toBeGreaterThanOrEqual(before);
        expect(rec.evaluated_at).toBeLessThanOrEqual(after);
    });
});

describe('InMemorySampleStore', () => {
    let store;
    beforeEach(() => { store = new InMemorySampleStore(); });

    it('append 单条', () => {
        store.append(mkRecord());
        expect(store.size()).toBe(1);
    });

    it('appendMany 批量', () => {
        const recs = Array.from({ length: 5 }, () => mkRecord());
        store.appendMany(recs);
        expect(store.size()).toBe(5);
    });

    it('按 context_key 索引', () => {
        const rec1 = mkRecord({ context: mkContext({ difficulty: 'normal' }) });
        const rec2 = mkRecord({ context: mkContext({ difficulty: 'hard' }) });
        store.append(rec1);
        store.append(rec2);
        expect(store.getByContext('normal:budget-p2:1500:growth')).toHaveLength(1);
        expect(store.getByContext('hard:budget-p2:1500:growth')).toHaveLength(1);
        expect(store.getByContext('not:exist:key:onboarding')).toHaveLength(0);
    });

    it('按 run_id 索引', () => {
        store.append(mkRecord({ runId: 1 }));
        store.append(mkRecord({ runId: 1 }));
        store.append(mkRecord({ runId: 2 }));
        expect(store.getByRun(1)).toHaveLength(2);
        expect(store.getByRun(2)).toHaveLength(1);
    });

    it('sampleCountByContext 统计每 context 样本数', () => {
        for (let i = 0; i < 3; i++) store.append(mkRecord({ context: mkContext({ difficulty: 'normal' }) }));
        for (let i = 0; i < 2; i++) store.append(mkRecord({ context: mkContext({ difficulty: 'hard' }) }));
        const counts = store.sampleCountByContext();
        expect(counts.get('normal:budget-p2:1500:growth')).toBe(3);
        expect(counts.get('hard:budget-p2:1500:growth')).toBe(2);
    });

    it('append 拒绝缺字段', () => {
        const bad = { run_id: 1 };  // 大量缺字段
        expect(() => store.append(bad)).toThrow();
    });

    it('clear 清空', () => {
        store.append(mkRecord());
        store.clear();
        expect(store.size()).toBe(0);
        expect(store.getByContext('normal:budget-p2:1500:growth')).toHaveLength(0);
    });
});

describe('HybridSampleStore — 无 SQLite (兜底)', () => {
    it('没有 sqlite 时纯内存运行', () => {
        const store = new HybridSampleStore({ sqliteStore: null });
        for (let i = 0; i < 10; i++) store.append(mkRecord());
        expect(store.size()).toBe(10);
        expect(store.all()).toHaveLength(10);
    });

    it('startBackgroundFlush 在无 sqlite 时是 no-op', () => {
        const store = new HybridSampleStore({ sqliteStore: null });
        expect(() => store.startBackgroundFlush()).not.toThrow();
        expect(() => store.stopBackgroundFlush()).not.toThrow();
    });

    it('close 是 idempotent', async () => {
        const store = new HybridSampleStore({ sqliteStore: null });
        await store.close();
        await store.close();
    });
});

describe('HybridSampleStore — 带 mock SQLite', () => {
    it('append 同时写内存和 sqlite 缓冲', async () => {
        const mockSqlite = { appendMany: vi.fn() };
        const store = new HybridSampleStore({
            sqliteStore: mockSqlite,
            flushBatchSize: 3,
        });

        store.append(mkRecord());
        store.append(mkRecord());
        expect(mockSqlite.appendMany).not.toHaveBeenCalled();  // 还没到 batch size

        store.append(mkRecord());
        // 达到 batch size,触发 flush
        await new Promise((r) => setTimeout(r, 10));
        expect(mockSqlite.appendMany).toHaveBeenCalledTimes(1);
        expect(mockSqlite.appendMany.mock.calls[0][0]).toHaveLength(3);

        await store.close();
    });

    it('close 把 pending 全部 flush', async () => {
        const mockSqlite = { appendMany: vi.fn() };
        const store = new HybridSampleStore({
            sqliteStore: mockSqlite,
            flushBatchSize: 100,
        });
        for (let i = 0; i < 5; i++) store.append(mkRecord());
        expect(mockSqlite.appendMany).not.toHaveBeenCalled();
        await store.close();
        expect(mockSqlite.appendMany).toHaveBeenCalledTimes(1);
        expect(mockSqlite.appendMany.mock.calls[0][0]).toHaveLength(5);
    });

    it('内存层始终可读 (不等待 sqlite flush)', () => {
        const mockSqlite = { appendMany: vi.fn() };
        const store = new HybridSampleStore({ sqliteStore: mockSqlite });
        store.append(mkRecord());
        // 即使 sqlite 还没 flush,内存读已经可用
        expect(store.size()).toBe(1);
        expect(store.getByRun(1)).toHaveLength(1);
    });
});

describe('SqliteSampleStore — 构造校验', () => {
    it('拒绝非 Database 对象', () => {
        expect(() => new SqliteSampleStore(null)).toThrow();
        expect(() => new SqliteSampleStore({})).toThrow();
        expect(() => new SqliteSampleStore('hello')).toThrow();
    });

    it('接受 mock Database (有 prepare 方法)', () => {
        const mockDb = {
            prepare: vi.fn(() => ({ run: vi.fn() })),
            exec: vi.fn(),
            transaction: vi.fn((fn) => fn),
        };
        const store = new SqliteSampleStore(mockDb);
        expect(store).toBeInstanceOf(SqliteSampleStore);
    });

    it('ensureSchema 调用 exec 创建表', () => {
        const mockDb = {
            prepare: vi.fn(() => ({ run: vi.fn() })),
            exec: vi.fn(),
            transaction: vi.fn((fn) => fn),
        };
        const store = new SqliteSampleStore(mockDb);
        store.ensureSchema();
        expect(mockDb.exec).toHaveBeenCalled();
        const sql = mockDb.exec.mock.calls[0][0];
        expect(sql).toContain('spawn_tuning_samples_v2');
        expect(sql).toContain('idx_samples_v2_ctx');
    });
});
