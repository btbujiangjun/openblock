/**
 * 寻参样本存储 - 双层架构。
 *
 * 层 1: 内存 (Map / Array) - 高速,所有 Phase B/C/D 算法在这里读
 * 层 2: SQLite 持久化 - 后台异步批量 flush,断电不丢
 *
 * 设计依据: docs/algorithms/SPAWN_AUTO_TUNING.md §7
 *
 * 设计取舍:
 *   - 写入仅追加 (append-only),不覆盖既有样本 → 历史完整
 *   - SQLite 写入用 transaction 批处理 (基线 240K rows/s)
 *   - 浏览器环境没有 better-sqlite3, 提供内存-only 兜底
 *   - 关键: storage backend 通过 IoC (constructor 注入) 而非直接 import
 *           → 同一个 store 类既能在 Node CLI 跑也能在浏览器跑
 */

import { validateContext, makeContextKey } from './contextSpace.js';
import { validateTheta } from './paramSpace.js';

/**
 * 一行样本的字段约定 (与 SQLite spawn_tuning_samples_v2 schema 对齐).
 */
const SAMPLE_FIELDS = Object.freeze([
    'run_id', 'context_key', 'difficulty', 'generator', 'bestScore_bin', 'lifecycle_stage',
    'theta_json', 'seed',
    // 13 列指标
    'noMoveRate', 'clearsMean', 'multiClearRate', 'fallbackRate',
    'firstMoveFreedomMean', 'clearIntervalP90', 'nearPbRate', 'breakPbRate',
    'overshootRate', 'scoreMean', 'scoreP90', 'evaluatedTripletsMean',
    // 3 子分数 (未应用 lifecycle 乘子)
    'fairness_score', 'excitement_score', 'antiInflation_score',
    // 元数据
    'eval_ms', 'evaluated_at', 'sample_phase',
]);

/**
 * 把评估行 + 上下文 + 子分数 整合为标准 sample 记录。
 */
export function buildSampleRecord({ runId, context, theta, seed, row, subscores, evalMs, phase }) {
    const ctxKey = makeContextKey(context);
    return {
        run_id: Number(runId) || 0,
        context_key: ctxKey,
        difficulty: context.difficulty,
        generator: context.generator,
        bestScore_bin: context.bestScore_bin,
        lifecycle_stage: context.lifecycle_stage,
        theta_json: JSON.stringify(theta),
        seed: Number(seed) || 0,
        noMoveRate: row.noMoveRate ?? null,
        clearsMean: row.clearsMean ?? null,
        multiClearRate: row.multiClearRate ?? null,
        fallbackRate: row.fallbackRate ?? null,
        firstMoveFreedomMean: row.firstMoveFreedomMean ?? null,
        clearIntervalP90: row.clearIntervalP90 ?? null,
        nearPbRate: row.nearPbRate ?? null,
        breakPbRate: row.breakPbRate ?? null,
        overshootRate: row.overshootRate ?? null,
        scoreMean: row.scoreMean ?? null,
        scoreP90: row.scoreP90 ?? null,
        evaluatedTripletsMean: row.evaluatedTripletsMean ?? null,
        fairness_score: subscores.fairness,
        excitement_score: subscores.excitement,
        antiInflation_score: subscores.antiInflation,
        eval_ms: Number(evalMs) || 0,
        evaluated_at: Date.now(),
        sample_phase: phase || 'lhs',
    };
}

/**
 * 内存层 sampleStore - 浏览器 + CLI 通用。
 *
 * 内部数据结构:
 *   - samples: Array<sample> - append-only 全量样本
 *   - byContextKey: Map<contextKey, sample[]> - O(1) 按 context 取
 *   - byRunId: Map<runId, sample[]> - O(1) 按 run 取
 *
 * 不用 SQLite 时也能完整跑寻参 (适合 MVP Phase A)。
 */
export class InMemorySampleStore {
    constructor() {
        this.samples = [];
        this.byContextKey = new Map();
        this.byRunId = new Map();
    }

    /**
     * 追加单个样本。
     */
    append(sample) {
        this._verifySample(sample);
        this.samples.push(sample);

        if (!this.byContextKey.has(sample.context_key)) {
            this.byContextKey.set(sample.context_key, []);
        }
        this.byContextKey.get(sample.context_key).push(sample);

        if (!this.byRunId.has(sample.run_id)) {
            this.byRunId.set(sample.run_id, []);
        }
        this.byRunId.get(sample.run_id).push(sample);
    }

    /**
     * 批量追加 (用于 batch flush)。
     */
    appendMany(samples) {
        for (const s of samples) this.append(s);
    }

    /**
     * 按 context_key 取所有样本。
     */
    getByContext(contextKey) {
        return this.byContextKey.get(contextKey) ?? [];
    }

    /**
     * 按 run_id 取所有样本。
     */
    getByRun(runId) {
        return this.byRunId.get(runId) ?? [];
    }

    /**
     * 总样本数。
     */
    size() {
        return this.samples.length;
    }

    /**
     * 计算每个 context 的样本数 (用于 active learning 找数据稀疏的 context).
     */
    sampleCountByContext() {
        const out = new Map();
        for (const [key, arr] of this.byContextKey) out.set(key, arr.length);
        return out;
    }

    /**
     * 取所有样本 (谨慎: O(N) 内存复制)。
     */
    all() {
        return this.samples.slice();
    }

    /**
     * 清空 (仅测试 / reset)。
     */
    clear() {
        this.samples = [];
        this.byContextKey.clear();
        this.byRunId.clear();
    }

    _verifySample(sample) {
        if (!sample || typeof sample !== 'object') {
            throw new Error('sample must be an object');
        }
        for (const field of SAMPLE_FIELDS) {
            if (!(field in sample)) {
                throw new Error(`sample missing field: ${field}`);
            }
        }
    }
}

/**
 * SQLite 持久化层 - 仅 Node CLI (better-sqlite3 不能在浏览器跑)。
 *
 * 用法:
 *   const store = new SqliteSampleStore(db);
 *   store.ensureSchema();
 *   store.appendMany(records);  // 内部用 transaction
 *
 * @param {Database} db - better-sqlite3 Database 实例 (注入)
 */
export class SqliteSampleStore {
    constructor(db) {
        if (!db || typeof db.prepare !== 'function') {
            throw new Error('SqliteSampleStore requires a better-sqlite3 Database instance');
        }
        this.db = db;
        this._insertStmt = null;
    }

    ensureSchema() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS spawn_tuning_samples_v2 (
                sample_id INTEGER PRIMARY KEY AUTOINCREMENT,
                run_id INTEGER NOT NULL,
                context_key TEXT NOT NULL,
                difficulty TEXT NOT NULL,
                generator TEXT NOT NULL,
                bestScore_bin INTEGER NOT NULL,
                lifecycle_stage TEXT NOT NULL,
                theta_json TEXT NOT NULL,
                seed INTEGER NOT NULL,
                noMoveRate REAL, clearsMean REAL, multiClearRate REAL,
                fallbackRate REAL, firstMoveFreedomMean REAL,
                clearIntervalP90 REAL, nearPbRate REAL, breakPbRate REAL,
                overshootRate REAL, scoreMean REAL, scoreP90 REAL,
                evaluatedTripletsMean REAL,
                fairness_score REAL, excitement_score REAL, antiInflation_score REAL,
                eval_ms INTEGER, evaluated_at INTEGER, sample_phase TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_samples_v2_ctx
                ON spawn_tuning_samples_v2(run_id, context_key);
        `);
    }

    _getInsertStmt() {
        if (!this._insertStmt) {
            this._insertStmt = this.db.prepare(`
                INSERT INTO spawn_tuning_samples_v2 (
                    run_id, context_key, difficulty, generator, bestScore_bin, lifecycle_stage,
                    theta_json, seed,
                    noMoveRate, clearsMean, multiClearRate, fallbackRate,
                    firstMoveFreedomMean, clearIntervalP90, nearPbRate, breakPbRate,
                    overshootRate, scoreMean, scoreP90, evaluatedTripletsMean,
                    fairness_score, excitement_score, antiInflation_score,
                    eval_ms, evaluated_at, sample_phase
                ) VALUES (
                    @run_id, @context_key, @difficulty, @generator, @bestScore_bin, @lifecycle_stage,
                    @theta_json, @seed,
                    @noMoveRate, @clearsMean, @multiClearRate, @fallbackRate,
                    @firstMoveFreedomMean, @clearIntervalP90, @nearPbRate, @breakPbRate,
                    @overshootRate, @scoreMean, @scoreP90, @evaluatedTripletsMean,
                    @fairness_score, @excitement_score, @antiInflation_score,
                    @eval_ms, @evaluated_at, @sample_phase
                )
            `);
        }
        return this._insertStmt;
    }

    append(sample) {
        this._getInsertStmt().run(sample);
    }

    appendMany(samples) {
        const stmt = this._getInsertStmt();
        const tx = this.db.transaction((items) => {
            for (const s of items) stmt.run(s);
        });
        tx(samples);
    }

    countByRun(runId) {
        const row = this.db.prepare(
            'SELECT COUNT(*) as cnt FROM spawn_tuning_samples_v2 WHERE run_id = ?'
        ).get(runId);
        return row?.cnt || 0;
    }

    fetchByRun(runId, { limit = 100000, offset = 0 } = {}) {
        return this.db.prepare(
            'SELECT * FROM spawn_tuning_samples_v2 WHERE run_id = ? LIMIT ? OFFSET ?'
        ).all(runId, limit, offset);
    }
}

/**
 * 双层存储 - 内存优先 + 异步 SQLite flush (生产推荐)。
 *
 * 写入路径:
 *   append(sample) → 立即写内存 → 队列追加 → flushTimer 触发批量 SQLite 写
 *
 * 读取路径:
 *   优先内存; SQLite 仅用于恢复 / 跨进程查询
 */
export class HybridSampleStore {
    constructor({ sqliteStore = null, flushIntervalMs = 1000, flushBatchSize = 500 } = {}) {
        this.memory = new InMemorySampleStore();
        this.sqlite = sqliteStore;
        this._pendingFlush = [];
        this._flushIntervalMs = flushIntervalMs;
        this._flushBatchSize = flushBatchSize;
        this._flushTimer = null;
    }

    /** 由外部 (CLI) 调用,启动后台 flush 定时器。浏览器场景可不启动。 */
    startBackgroundFlush() {
        if (!this.sqlite || this._flushTimer) return;
        this._flushTimer = setInterval(() => {
            this._flushNow().catch(() => {});  // 静默错误,避免淹没日志
        }, this._flushIntervalMs);
    }

    stopBackgroundFlush() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
    }

    append(sample) {
        this.memory.append(sample);
        if (this.sqlite) {
            this._pendingFlush.push(sample);
            if (this._pendingFlush.length >= this._flushBatchSize) {
                this._flushNow().catch(() => {});
            }
        }
    }

    appendMany(samples) {
        for (const s of samples) this.append(s);
    }

    async _flushNow() {
        if (!this.sqlite || this._pendingFlush.length === 0) return;
        const batch = this._pendingFlush;
        this._pendingFlush = [];
        this.sqlite.appendMany(batch);
    }

    async flush() {
        await this._flushNow();
    }

    getByContext(contextKey) {
        return this.memory.getByContext(contextKey);
    }

    getByRun(runId) {
        return this.memory.getByRun(runId);
    }

    size() {
        return this.memory.size();
    }

    sampleCountByContext() {
        return this.memory.sampleCountByContext();
    }

    all() {
        return this.memory.all();
    }

    /** 优雅关闭: stop timer + final flush */
    async close() {
        this.stopBackgroundFlush();
        await this._flushNow();
    }
}
