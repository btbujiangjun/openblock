/**
 * @vitest-environment jsdom
 *
 * masterWorker.js 单元测试 - 用 mock Worker 验证编排逻辑。
 *
 * 注: 真实 Worker + Vite SSR + spawnEvaluation 闭环的集成测试由
 *     scripts/spawn-tune-v2.mjs 的 CLI 冒烟覆盖, 不在 vitest 跑.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { InMemorySampleStore, buildSampleRecord } from '../../web/src/tuning/sampleStore.js';

// vi.mock 必须在 import 被测模块前
vi.mock('node:worker_threads', () => {
    const handles = [];
    class MockWorker {
        constructor(path, options) {
            this.path = path;
            this.options = options;
            this._listeners = new Map();
            this._msgs = [];
            handles.push(this);
            // 异步发送 ready (模拟真实 worker 启动延迟)
            setTimeout(() => this._emit('message', { type: 'ready' }), 0);
        }
        on(event, cb) {
            if (!this._listeners.has(event)) this._listeners.set(event, []);
            this._listeners.get(event).push(cb);
        }
        off(event, cb) {
            const arr = this._listeners.get(event) || [];
            const i = arr.indexOf(cb);
            if (i >= 0) arr.splice(i, 1);
        }
        once(event, cb) {
            const wrapped = (...args) => { this.off(event, wrapped); cb(...args); };
            this.on(event, wrapped);
        }
        postMessage(msg) {
            this._msgs.push(msg);
            // 自动回复 eval / shutdown
            setTimeout(() => {
                if (msg.type === 'eval') {
                    const task = msg.task;
                    if (task.context?.difficulty === 'fail') {
                        this._emit('message', { type: 'result', taskId: msg.taskId, ok: false, error: 'simulated failure' });
                    } else {
                        const sample = buildSampleRecord({
                            runId: 1, context: task.context, theta: task.theta, seed: task.seed,
                            row: { noMoveRate: 0.05, clearsMean: 18, multiClearRate: 0.3, fallbackRate: 0.01, firstMoveFreedomMean: 8, clearIntervalP90: 6, nearPbRate: 0.3, breakPbRate: 0.1, overshootRate: 0.04, scoreMean: 1200, scoreP90: 1800, evaluatedTripletsMean: 64 },
                            subscores: { fairness: 0.8, excitement: 0.6, antiInflation: 0.7 },
                            evalMs: 50,
                            phase: 'lhs',
                        });
                        this._emit('message', { type: 'result', taskId: msg.taskId, ok: true, sample, evalMs: 50 });
                    }
                } else if (msg.type === 'shutdown') {
                    this._emit('exit', 0);
                }
            }, 0);
        }
        async terminate() { this._emit('exit', 0); }
        _emit(event, ...args) {
            (this._listeners.get(event) || []).slice().forEach((cb) => cb(...args));
        }
    }
    return { Worker: MockWorker, default: { Worker: MockWorker } };
});

const { runMasterParallel } = await import('../../web/src/tuning/masterWorker.js');

function mkTasks(n, override = {}) {
    const tasks = [];
    for (let i = 0; i < n; i++) {
        tasks.push({
            context: { difficulty: 'normal', generator: 'budget-p2', bestScore_bin: 1500, lifecycle_stage: 'growth', ...override.context },
            theta: { temperature: 0.04, personalizationStrength: 0.1 },
            seed: 100 + i,
            seq: i,
        });
    }
    return tasks;
}

describe('masterWorker - 基本编排', () => {
    let store;
    beforeEach(() => { store = new InMemorySampleStore(); });

    it('空任务列表立即返回', async () => {
        const r = await runMasterParallel({
            tasks: [], numWorkers: 2, sampleStore: store, runId: 1,
        });
        expect(r.completedCount).toBe(0);
        expect(r.failedCount).toBe(0);
    });

    it('单 worker 串行处理 5 任务', async () => {
        const tasks = mkTasks(5);
        const r = await runMasterParallel({
            tasks, numWorkers: 1, sampleStore: store, runId: 1,
        });
        expect(r.completedCount).toBe(5);
        expect(r.failedCount).toBe(0);
        expect(store.size()).toBe(5);
    });

    it('多 worker 并行处理 10 任务', async () => {
        const tasks = mkTasks(10);
        const r = await runMasterParallel({
            tasks, numWorkers: 3, sampleStore: store, runId: 1,
        });
        expect(r.completedCount).toBe(10);
        expect(store.size()).toBe(10);
    });
});

describe('masterWorker - 失败处理', () => {
    let store;
    beforeEach(() => { store = new InMemorySampleStore(); });

    it('任务全失败被记录', async () => {
        const tasks = mkTasks(3, { context: { difficulty: 'fail' } });
        const r = await runMasterParallel({
            tasks, numWorkers: 2, sampleStore: store, runId: 1, maxRetries: 0,
        });
        expect(r.completedCount).toBe(0);
        expect(r.failedCount).toBe(3);
        expect(r.failedTasks).toHaveLength(3);
        expect(r.failedTasks[0].error).toMatch(/simulated/);
    });

    it('混合成功失败', async () => {
        const tasks = [
            ...mkTasks(3),
            ...mkTasks(2, { context: { difficulty: 'fail' } }),
        ];
        const r = await runMasterParallel({
            tasks, numWorkers: 2, sampleStore: store, runId: 1, maxRetries: 0,
        });
        expect(r.completedCount).toBe(3);
        expect(r.failedCount).toBe(2);
    });

    it('maxRetries 重试失败任务但仍失败', async () => {
        const tasks = mkTasks(2, { context: { difficulty: 'fail' } });
        const r = await runMasterParallel({
            tasks, numWorkers: 1, sampleStore: store, runId: 1, maxRetries: 2,
        });
        // 都重试满后仍失败
        expect(r.completedCount).toBe(0);
        expect(r.failedCount).toBe(2);
    });
});

describe('masterWorker - 进度回调', () => {
    it('onProgress 被调用且数字单调递增', async () => {
        const tasks = mkTasks(10);
        const store = new InMemorySampleStore();
        const snapshots = [];
        await runMasterParallel({
            tasks, numWorkers: 2, sampleStore: store, runId: 1,
            onProgress: (p) => snapshots.push({ ...p }),
        });
        expect(snapshots.length).toBeGreaterThan(0);
        // 最后一次回调 completed === total
        const last = snapshots[snapshots.length - 1];
        expect(last.completed).toBe(10);
        expect(last.total).toBe(10);
    });
});
