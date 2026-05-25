/**
 * Spawn Tuning v2 真实玩家指标 SDK。
 *
 * 与 v1 policyMetrics.js 的差异:
 *   v1: 上报 final_score / noMove / clears / rounds (4 个标量)
 *   v2: 上报完整 20 维 d_curve (从客户端单局轨迹提取)
 *
 * 流程:
 *   1. game.js 单步钩子调 recordStep(step) — 收集轨迹
 *   2. game.js gameOver 时调 reportEpisode({pb}) — 提取 d_curve + flush 到 buffer
 *   3. 每 60 秒 (或 buffer 满 50 条) flush 到 server
 *
 * 隐私:
 *   - 不上报 userId, server 端按 (context_key, model_id) 聚合
 *   - 上报包前用 sessionStorage 持久化, 失败重试不丢数据
 *
 * 跨语言一致性: d_curve 提取算法与 Python extractor.py 严格对应。
 */

import { rToBin, CURVE_N_BINS, CURVE_R_MAX } from './targetSCurve.js';

// ─────────── 配置 ───────────

const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_MAX_BUFFER = 50;
const STORAGE_KEY = 'openblock_spawn_tuning_v2_buffer';

// 单步难度信号常量 (与 Python extractor.py 严格一致)
const FILL_RATE_WEIGHT = 0.30;
const ACTION_FREEDOM_WEIGHT = 0.50;
const TREND_WEIGHT = 0.20;
const SURPRISE_DAMPING = 0.50;
const SURPRISE_MIN_CLEARS = 3;
const TREND_WINDOW = 5;


// ─────────── 模块状态 ───────────

let _config = {
    apiBaseUrl: '',
    enabled: false,
    flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
    maxBufferSize: DEFAULT_MAX_BUFFER,
};

let _currentSteps = [];    // 当前局轨迹
let _buffer = [];          // 待上报的 episodes
let _flushTimer = null;
let _stats = { steps_recorded: 0, episodes_reported: 0, flushed_batches: 0, flush_errors: 0 };


// ─────────── d_curve 提取 (与 Python 一致) ───────────

function _stepDifficulty(step, recentFills) {
    if (step.noMove) return 1.0;
    let trendNorm = 0.5;
    if (recentFills.length > 0) {
        const avg = recentFills.reduce((a, b) => a + b, 0) / recentFills.length;
        const trend = step.fillRate - avg;
        trendNorm = Math.max(0, Math.min(1, 0.5 + trend));
    }
    let base = FILL_RATE_WEIGHT * step.fillRate
             + ACTION_FREEDOM_WEIGHT * (1 - step.actionFreedom)
             + TREND_WEIGHT * trendNorm;
    base = Math.max(0, Math.min(1, base));
    if ((step.clears || 0) >= SURPRISE_MIN_CLEARS) {
        base *= SURPRISE_DAMPING;
    }
    return base;
}


function _extractDCurve(steps, pb, nBins = CURVE_N_BINS, rMax = CURVE_R_MAX) {
    if (!steps || steps.length === 0 || !pb || pb <= 0) return null;

    const binSums = new Array(nBins).fill(0);
    const binCounts = new Array(nBins).fill(0);
    const recentFills = [];

    let totalClears = 0;
    let noMoveStep = -1;
    let surpriseCount = 0;
    let finalScore = 0;

    for (const st of steps) {
        const r = Math.min(rMax - 1e-9, st.score / pb);
        const bidx = rToBin(r, nBins, rMax);
        const d = _stepDifficulty(st, recentFills);
        binSums[bidx] += d;
        binCounts[bidx] += 1;

        recentFills.push(st.fillRate);
        if (recentFills.length > TREND_WINDOW) recentFills.shift();

        totalClears += st.clears || 0;
        if ((st.clears || 0) >= SURPRISE_MIN_CLEARS) surpriseCount += 1;
        if (st.noMove && noMoveStep < 0) noMoveStep = st.stepIdx;
        finalScore = st.score;
    }

    // bin 均值 + 空 bin 线性填充
    const dCurve = new Array(nBins).fill(0);
    let lastValue = 0;
    let nFilled = 0;
    for (let i = 0; i < nBins; i++) {
        if (binCounts[i] > 0) {
            dCurve[i] = binSums[i] / binCounts[i];
            lastValue = dCurve[i];
            nFilled++;
        } else {
            dCurve[i] = lastValue;
        }
    }
    // 反向填首部空 bin
    if (nFilled > 0) {
        for (let i = 0; i < nBins; i++) {
            if (binCounts[i] > 0) {
                for (let j = 0; j < i; j++) {
                    if (binCounts[j] === 0) dCurve[j] = dCurve[i];
                }
                break;
            }
        }
    }

    return {
        d_curve: dCurve,
        final_score: finalScore,
        survived_steps: steps.length,
        clear_rate: steps.length > 0 ? totalClears / steps.length : 0,
        noMove_step: noMoveStep,
        pb_broke: finalScore > pb,
        surprise_count: surpriseCount,
    };
}


// ─────────── Public API ───────────

/**
 * 初始化 SDK (game 启动时调一次)。
 * @param {object} opts
 * @param {string} [opts.apiBaseUrl=''] - API 基址
 * @param {boolean} [opts.enabled=true]
 * @param {number} [opts.flushIntervalMs=60000]
 */
export function initPolicyMetricsV2(opts = {}) {
    _config = {
        apiBaseUrl: (opts.apiBaseUrl || '').replace(/\/+$/, ''),
        enabled: opts.enabled !== false,
        flushIntervalMs: opts.flushIntervalMs || DEFAULT_FLUSH_INTERVAL_MS,
        maxBufferSize: opts.maxBufferSize || DEFAULT_MAX_BUFFER,
    };
    _currentSteps = [];
    _buffer = [];
    _stats = { steps_recorded: 0, episodes_reported: 0, flushed_batches: 0, flush_errors: 0 };

    // 恢复未上报的 buffer
    try {
        if (typeof sessionStorage !== 'undefined') {
            const saved = sessionStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) _buffer.push(...parsed);
            }
        }
    } catch (_) { /* ignore */ }

    // 定时 flush
    if (_config.enabled && _flushTimer === null && typeof setInterval !== 'undefined') {
        _flushTimer = setInterval(() => flushNow().catch(() => { }), _config.flushIntervalMs);
    }
}


/**
 * 单步钩子 — game.js 每次落块后调。
 * @param {object} step
 * @param {number} step.stepIdx
 * @param {number} step.score
 * @param {number} step.fillRate    — 盘面填充率 [0, 1]
 * @param {number} step.actionFreedom — 可放置 / 总位置 [0, 1]
 * @param {boolean} step.noMove
 * @param {number} [step.clears=0]
 */
export function recordStep(step) {
    if (!_config.enabled) return;
    _currentSteps.push({
        stepIdx: step.stepIdx | 0,
        score: Number(step.score) | 0,
        fillRate: Math.max(0, Math.min(1, Number(step.fillRate) || 0)),
        actionFreedom: Math.max(0, Math.min(1, Number(step.actionFreedom) || 0)),
        noMove: Boolean(step.noMove),
        clears: step.clears | 0,
    });
    _stats.steps_recorded++;
}


/**
 * 局结束 — game.js 在 gameOver 时调。
 * 自动从轨迹提取 d_curve + 标签, 放进 buffer (待 flush)。
 *
 * @param {object} ctx
 * @param {number} ctx.pb - 玩家 PB
 * @param {string} ctx.contextKey - "difficulty:generator:bot:pbBin:lifecycle"
 * @param {string} [ctx.modelId] - 当前生效模型 ID (供 server 关联)
 * @param {string} [ctx.thetaHash] - θ 的 hash (区分不同策略)
 */
export function reportEpisode(ctx) {
    if (!_config.enabled) return;
    if (!ctx || !ctx.pb || ctx.pb <= 0) {
        _currentSteps = [];
        return;
    }
    const labels = _extractDCurve(_currentSteps, ctx.pb);
    _currentSteps = [];
    if (!labels) return;

    _buffer.push({
        ts: Date.now(),
        context_key: ctx.contextKey || '',
        pb: ctx.pb,
        model_id: ctx.modelId || null,
        theta_hash: ctx.thetaHash || null,
        ...labels,
    });
    _stats.episodes_reported++;

    _persistBuffer();
    if (_buffer.length >= _config.maxBufferSize) {
        flushNow().catch(() => { });
    }
}


/**
 * 立即 flush 当前 buffer 到 server。
 * 成功才清空; 失败保留供下次重试。
 */
export async function flushNow() {
    if (!_config.enabled || _buffer.length === 0) return { sent: 0 };
    const batch = _buffer.slice();
    try {
        const r = await fetch(`${_config.apiBaseUrl}/api/spawn-tuning-v2/field-metrics`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ episodes: batch }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // 成功才清空
        _buffer = _buffer.slice(batch.length);
        _persistBuffer();
        _stats.flushed_batches++;
        return { sent: batch.length };
    } catch (e) {
        _stats.flush_errors++;
        return { error: String(e && e.message || e), kept: batch.length };
    }
}


function _persistBuffer() {
    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify(_buffer.slice(-200)));
        }
    } catch (_) { /* ignore */ }
}


export function getStats() {
    return {
        ..._stats,
        buffer_size: _buffer.length,
        current_steps: _currentSteps.length,
        enabled: _config.enabled,
    };
}


export function disable() {
    _config.enabled = false;
    if (_flushTimer) {
        clearInterval(_flushTimer);
        _flushTimer = null;
    }
}


// 导出 d_curve 提取供测试或离线分析复用
export { _extractDCurve as extractDCurveJS };
