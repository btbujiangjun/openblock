/**
 * Master 编排 — 把 N 个 Node worker_threads 当作并行采样池。
 *
 * 设计依据：docs/algorithms/SPAWN_AUTO_TUNING.md §5.6
 *
 * 用法 (Node CLI):
 *   import { runMasterParallel } from './web/src/tuning/masterWorker.js';
 *   const result = await runMasterParallel({
 *       tasks,          // Phase A 任务列表 (buildPhaseATasks 输出)
 *       numWorkers: 8,
 *       runId: 1,
 *       onProgress: (p) => { ... },  // 进度回调
 *       sampleStore,    // HybridSampleStore 实例
 *       samplesConfig: { sessions: 30, maxSteps: 120 },
 *   });
 *
 * 协议:
 *   - master → worker: { type: 'eval', task, taskId }
 *   - worker → master: { type: 'result', taskId, ok, sample, evalMs } | { type: 'ready' } | { type: 'error' }
 *
 * 容错:
 *   - worker crash → 重启 worker,该任务标记失败但不阻塞其他
 *   - 任务失败 → 记录到 failedTasks,可选重试
 */

import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';

/**
 * 单个 worker 的封装,跟踪状态与当前任务。
 */
class WorkerHandle {
    constructor(id, workerPath, workerData) {
        this.id = id;
        this.busy = false;
        this.ready = false;
        this.currentTaskId = null;
        this.workerPath = workerPath;
        this.workerData = workerData;
        this.worker = null;
    }

    async start() {
        this.worker = new Worker(this.workerPath, {
            workerData: this.workerData,
        });
        await new Promise((resolveReady, rejectReady) => {
            const onMessage = (msg) => {
                if (msg?.type === 'ready') {
                    this.ready = true;
                    this.worker.off('message', onMessage);
                    resolveReady();
                } else if (msg?.type === 'error') {
                    this.worker.off('message', onMessage);
                    rejectReady(new Error(msg.error));
                }
            };
            this.worker.on('message', onMessage);
            this.worker.once('error', rejectReady);
            this.worker.once('exit', (code) => {
                if (!this.ready) rejectReady(new Error(`worker ${this.id} exited ${code} before ready`));
            });
        });
    }

    dispatch(task, taskId) {
        if (this.busy) throw new Error(`worker ${this.id} is busy`);
        this.busy = true;
        this.currentTaskId = taskId;
        this.worker.postMessage({ type: 'eval', task, taskId });
    }

    async shutdown() {
        try {
            this.worker?.postMessage({ type: 'shutdown' });
        } catch {}
        await new Promise((res) => {
            const timer = setTimeout(() => res(), 2000);
            this.worker?.once('exit', () => { clearTimeout(timer); res(); });
        });
        try { await this.worker?.terminate(); } catch {}
    }
}

/**
 * 并行执行任务列表。
 *
 * @param {object} opts
 * @param {Array} opts.tasks - 任务列表,每个 { context, theta, seed, seq }
 * @param {number} opts.numWorkers - 并发 worker 数
 * @param {number} opts.runId - 寻参任务 ID (写入 sample 记录)
 * @param {object} opts.sampleStore - HybridSampleStore 实例
 * @param {object} [opts.samplesConfig] - 评估配置 (传给 evalWorker)
 * @param {(progress: object) => void} [opts.onProgress] - 进度回调
 * @param {number} [opts.maxRetries=1] - 任务失败重试次数
 * @returns {Promise<{completedCount, failedCount, durationMs, failedTasks}>}
 */
export async function runMasterParallel(opts) {
    const {
        tasks,
        numWorkers = 4,
        runId = 1,
        sampleStore,
        samplesConfig = {},
        onProgress = () => {},
        maxRetries = 1,
    } = opts;

    if (!Array.isArray(tasks) || tasks.length === 0) {
        return { completedCount: 0, failedCount: 0, durationMs: 0, failedTasks: [] };
    }

    // 计算 worker 脚本路径; 在测试环境 (jsdom + http:// scheme) 下 fileURLToPath 会失败,
    // 但此时 new Worker 被 mock 拦截,路径具体值不重要 — 给一个占位即可。
    const workerScriptUrl = new URL('./evalWorker.js', import.meta.url);
    let workerPath;
    try {
        workerPath = fileURLToPath(workerScriptUrl);
    } catch {
        workerPath = workerScriptUrl;  // Node Worker 也接受 URL 对象
    }

    // 启动 N 个 worker (并行)
    const workers = Array.from({ length: numWorkers }, (_, i) =>
        new WorkerHandle(i, workerPath, { runId, samplesConfig })
    );
    await Promise.all(workers.map((w) => w.start()));

    // 注册信号处理: SIGINT (Ctrl-C) / SIGTERM 时优雅关闭所有 worker_threads,
    // 避免主进程退出后 worker 继续占 CPU (历史问题: 400% CPU 残留)。
    let _shuttingDown = false;
    const _signalCleanup = async (signal) => {
        if (_shuttingDown) return;
        _shuttingDown = true;
        process.stderr.write(`\n[masterWorker] 收到 ${signal},终止 ${workers.length} 个 worker_threads...\n`);
        await Promise.all(workers.map((w) => w.shutdown().catch(() => {})));
        process.stderr.write('[masterWorker] worker_threads 已清理\n');
        // 用对应的标准退出码: SIGINT=130, SIGTERM=143
        process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    // 只在 Node 环境 (有 process.on) 注册
    const _hasProcessHooks = typeof process !== 'undefined' && typeof process.on === 'function';
    const _onSigint = () => _signalCleanup('SIGINT');
    const _onSigterm = () => _signalCleanup('SIGTERM');
    if (_hasProcessHooks) {
        process.on('SIGINT', _onSigint);
        process.on('SIGTERM', _onSigterm);
    }

    const t0 = performance.now();
    const pendingQueue = tasks.map((task, idx) => ({ task, taskId: idx, attempts: 0 }));
    let queueIdx = 0;
    let completedCount = 0;
    let failedCount = 0;
    const failedTasks = [];
    const retryQueue = [];
    let lastProgressEmit = 0;

    function tryDispatchNext(worker) {
        // 优先把重试任务排进去
        let next = null;
        if (retryQueue.length > 0) {
            next = retryQueue.shift();
        } else if (queueIdx < pendingQueue.length) {
            next = pendingQueue[queueIdx++];
        }
        if (!next) return false;
        worker.dispatch(next.task, next.taskId);
        worker._lastTask = next;
        return true;
    }

    const allDone = new Promise((resolveDone, rejectDone) => {
        workers.forEach((handle) => {
            handle.worker.on('message', (msg) => {
                if (msg.type !== 'result') return;
                handle.busy = false;

                if (msg.ok) {
                    sampleStore.append(msg.sample);
                    completedCount++;
                } else {
                    const taskState = handle._lastTask;
                    taskState.attempts += 1;
                    if (taskState.attempts <= maxRetries) {
                        retryQueue.push(taskState);
                    } else {
                        failedCount++;
                        failedTasks.push({ taskId: msg.taskId, error: msg.error });
                    }
                }

                // 节流进度回调 (避免高频卡 UI)
                const now = performance.now();
                if (now - lastProgressEmit > 250 || completedCount + failedCount >= tasks.length) {
                    lastProgressEmit = now;
                    const elapsedMs = now - t0;
                    const samplesPerSec = (completedCount / elapsedMs) * 1000;
                    onProgress({
                        completed: completedCount,
                        failed: failedCount,
                        total: tasks.length,
                        elapsedMs,
                        samplesPerSec,
                        etaMs: samplesPerSec > 0 ? (tasks.length - completedCount) / samplesPerSec * 1000 : null,
                    });
                }

                // 派下一个任务,或检查全部完成
                if (!tryDispatchNext(handle)) {
                    if (completedCount + failedCount >= tasks.length) {
                        resolveDone();
                    }
                }
            });

            handle.worker.on('error', (err) => {
                if (handle._lastTask) {
                    const ts = handle._lastTask;
                    ts.attempts += 1;
                    if (ts.attempts <= maxRetries) retryQueue.push(ts);
                    else { failedCount++; failedTasks.push({ taskId: ts.taskId, error: err.message }); }
                }
                handle.busy = false;
                // 重启 worker
                handle.start().then(() => tryDispatchNext(handle)).catch(rejectDone);
            });
        });

        // 启动所有 worker 第一轮分派
        workers.forEach((w) => tryDispatchNext(w));
    });

    await allDone;
    const durationMs = performance.now() - t0;

    // 优雅关闭
    await Promise.all(workers.map((w) => w.shutdown()));
    await sampleStore.flush?.();

    // 解除信号监听 (避免后续 run 共享同一 process 时多次触发)
    if (_hasProcessHooks) {
        process.off('SIGINT', _onSigint);
        process.off('SIGTERM', _onSigterm);
    }

    return { completedCount, failedCount, durationMs, failedTasks };
}
