/**
 * 灰度上线监控 SDK — 客户端记录 resolveSpawnTheta 的真实使用情况 + 局后回写关键指标。
 *
 * 设计依据: docs/algorithms/SPAWN_AUTO_TUNING.md §15.8 灰度发布
 *
 * 流程:
 *   1. 玩家每次 spawn,调 recordPolicyResolve(source, contextKey, theta)
 *   2. 玩家每局结束,调 reportGameOutcome({score, noMove, clears, ...})
 *      → 累加到内存缓冲
 *   3. 每隔 flushIntervalMs (默认 60s) 或缓冲满 (默认 50 条),flush 到 server
 *
 * 服务端聚合:
 *   - 把每个 (context_key, source) 的 N 局指标聚合,存入 spawn_tuning_field_metrics
 *   - 看板可对比 'exact' 命中 vs 'fallback' 退化的真实玩家差距
 *
 * 隐私:
 *   - 不上报 userId (server 端按聚合 key 累加,只能看到分布)
 *   - 客户端缓冲在 sessionStorage,失败重试时不丢
 */

const FLUSH_INTERVAL_MS = 60000;     // 1 分钟
const MAX_BUFFER_SIZE = 50;
const STORAGE_KEY = 'openblock_policy_metrics_buffer_v1';

let _config = {
    apiBaseUrl: '',
    enabled: false,
    flushIntervalMs: FLUSH_INTERVAL_MS,
    maxBufferSize: MAX_BUFFER_SIZE,
};

let _resolveBuffer = [];       // 记录 spawn 时的 source / contextKey
let _outcomeBuffer = [];       // 记录局后指标
let _flushTimer = null;
let _currentResolves = [];     // 当局内的 resolves (局结束时归 outcome)
let _stats = { resolves: 0, outcomes: 0, flushedBatches: 0, flushErrors: 0 };

/**
 * 初始化 — 在 game 启动后调一次。
 * 注: 重复 init 会重置内部状态 (清空 stats 和 currentResolves,outcomeBuffer 从 sessionStorage 恢复)。
 */
export function initPolicyMetrics(opts = {}) {
    _config = {
        apiBaseUrl: opts.apiBaseUrl || '',
        enabled: opts.enabled !== false,
        flushIntervalMs: opts.flushIntervalMs ?? FLUSH_INTERVAL_MS,
        maxBufferSize: opts.maxBufferSize ?? MAX_BUFFER_SIZE,
    };
    // 重置内部缓冲 (避免会话间污染 / 测试间污染)
    _resolveBuffer = [];
    _outcomeBuffer = [];
    _currentResolves = [];
    _stats = { resolves: 0, outcomes: 0, flushedBatches: 0, flushErrors: 0 };
    if (_flushTimer) {
        clearInterval(_flushTimer);
        _flushTimer = null;
    }
    // 恢复未上报的缓冲 (上次崩溃 / 关浏览器)
    try {
        const saved = typeof sessionStorage !== 'undefined'
            ? sessionStorage.getItem(STORAGE_KEY) : null;
        if (saved) {
            const { resolveBuffer, outcomeBuffer } = JSON.parse(saved);
            if (Array.isArray(resolveBuffer)) _resolveBuffer.push(...resolveBuffer);
            if (Array.isArray(outcomeBuffer)) _outcomeBuffer.push(...outcomeBuffer);
        }
    } catch {}

    if (_config.enabled && _flushTimer === null && typeof setInterval !== 'undefined') {
        _flushTimer = setInterval(() => flushNow().catch(() => {}), _config.flushIntervalMs);
    }
}

/**
 * 记录一次 spawn 解析 (game.js 调 resolveSpawnTheta 之后调它)。
 */
export function recordPolicyResolve(source, contextKey, theta) {
    if (!_config.enabled) return;
    _currentResolves.push({
        source: source || 'unknown',
        contextKey: contextKey || null,
        theta_hash: theta ? hashTheta(theta) : null,
        ts: Date.now(),
    });
    _stats.resolves++;
}

/**
 * 记录一局结束的指标 (game.js 在 game over 时调)。
 *
 * @param {object} outcome - { score, totalRounds, clears, noMove, ... }
 */
export function reportGameOutcome(outcome) {
    if (!_config.enabled) return;
    // 当局共消费过哪些 (source, contextKey)? 取最常见的
    const dominant = pickDominantContext(_currentResolves);
    _outcomeBuffer.push({
        context_key: dominant?.contextKey || null,
        source: dominant?.source || 'no-policy',
        theta_hash: dominant?.theta_hash || null,
        score: Number(outcome?.score) || 0,
        rounds: Number(outcome?.totalRounds) || 0,
        clears: Number(outcome?.clears) || 0,
        noMove: outcome?.noMove === true ? 1 : 0,
        ts: Date.now(),
    });
    _currentResolves = [];
    _stats.outcomes++;
    persistBuffer();
    if (_outcomeBuffer.length >= _config.maxBufferSize) {
        flushNow().catch(() => {});
    }
}

function pickDominantContext(resolves) {
    if (!Array.isArray(resolves) || resolves.length === 0) return null;
    const counts = new Map();
    for (const r of resolves) {
        const key = `${r.source}|${r.contextKey || ''}|${r.theta_hash || ''}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bestKey = null, bestCount = 0;
    for (const [k, c] of counts) if (c > bestCount) { bestKey = k; bestCount = c; }
    if (!bestKey) return null;
    const [source, contextKey, theta_hash] = bestKey.split('|');
    return { source, contextKey: contextKey || null, theta_hash: theta_hash || null };
}

function hashTheta(theta) {
    // 简易 32-bit 哈希,只用于区分不同 θ 版本,无加密需求
    let h = 5381;
    const s = JSON.stringify(theta);
    for (let i = 0; i < s.length; i++) {
        h = ((h << 5) + h) + s.charCodeAt(i);
        h = h | 0;
    }
    return (h >>> 0).toString(16);
}

function persistBuffer() {
    try {
        if (typeof sessionStorage !== 'undefined') {
            sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
                resolveBuffer: _resolveBuffer.slice(-200),  // 保最近 200
                outcomeBuffer: _outcomeBuffer.slice(-200),
            }));
        }
    } catch {}
}

/**
 * 立即 flush 当前缓冲到 server (失败保留缓冲,下次重试)。
 */
export async function flushNow() {
    if (!_config.enabled || _outcomeBuffer.length === 0) return { sent: 0 };
    const batch = _outcomeBuffer.slice();
    try {
        const url = `${(_config.apiBaseUrl || '').replace(/\/+$/, '')}/api/spawn-tuning/v2/metrics/sample`;
        const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ outcomes: batch }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        // 成功才清空
        _outcomeBuffer = _outcomeBuffer.slice(batch.length);
        persistBuffer();
        _stats.flushedBatches++;
        return { sent: batch.length };
    } catch (e) {
        _stats.flushErrors++;
        return { error: e?.message || String(e), kept: batch.length };
    }
}

/**
 * 当前统计 (dashboard 用)。
 */
export function getMetricsStats() {
    return {
        ..._stats,
        bufferSize: _outcomeBuffer.length,
        currentResolves: _currentResolves.length,
        enabled: _config.enabled,
    };
}

/**
 * 关闭/暂停采集 (运维需要时用)。
 */
export function disablePolicyMetrics() {
    _config.enabled = false;
    if (_flushTimer) {
        clearInterval(_flushTimer);
        _flushTimer = null;
    }
}
