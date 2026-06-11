/* 自动生成 —— 请勿手改。源：web/src/pbGrowthTracker.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * pbGrowthTracker.js — v1.56 §2.4 PB 增长率追踪与节流判定
 *
 * 用途：
 *   配合 `adaptiveSpawn.js farFromPBBoost`（§2.1 远征送爽）使用，
 *   当玩家最近 K 次破 PB 的"每局增长率"超过阈值时，把
 *   `ctx.pbGrowthFast = true` 写入 spawn 上下文，让 farFromPBBoost
 *   节流（bypass='pb_growth_throttled'），避免 PB 在远征段被
 *   "送爽过度"地反复抬升 → 透支生命周期。
 *
 * 数据流：
 *   game.js _emitPersonalBestEvent → recordPersonalBest(newBest)
 *     → localStorage 'openblock_pb_history_v1' = [{value, ts}, ...]
 *   game.js start() → readPbGrowthRate() → isPbGrowthFast()
 *     → this._spawnContext.pbGrowthFast = true/false
 *
 * 与 _bestScoreAtRunStart / persistedBest 的区别：
 *   - _bestScoreAtRunStart：本局开始时的 PB 快照（单值）
 *   - pb_history_v1：跨局 PB 演进历史（最近 K=10 条，含时间戳）
 *   仅当跨局 PB 的"分数增长率"显著（默认 ≥ 0.10 / 局）时才节流；
 *   本模块完全不读 score，不参与单局难度感知。
 *
 * 设计原则：
 *   - 完全幂等：recordPersonalBest 多次写同一值不会重复 push
 *   - 单调非降：只接受比上一次大的 newBest（防止可疑 PB 注入）
 *   - 容错：localStorage 不可用时退化为内存数组（同进程内仍生效）
 *
 * 详见 docs/player/BEST_SCORE_CHASE_STRATEGY.md §5.α v1.56。
 */

const STORAGE_KEY = 'openblock_pb_history_v1';
const MAX_ENTRIES = 10;

/** @type {Array<{value:number, ts:number}>} 内存兜底（无 localStorage 时） */
let _memoryFallback = null;

/**
 * 安全读取 PB 历史；返回数组（可能为空），永远不抛异常。
 * @returns {Array<{value:number, ts:number}>}
 */
export function readPbHistory() {
    try {
        if (typeof localStorage === 'undefined') {
            return _memoryFallback ? [..._memoryFallback] : [];
        }
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter((e) =>
            e && Number.isFinite(e.value) && Number.isFinite(e.ts) && e.value > 0
        );
    } catch {
        return _memoryFallback ? [..._memoryFallback] : [];
    }
}

function _writePbHistory(arr) {
    const clean = arr.slice(-MAX_ENTRIES);
    _memoryFallback = clean;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
        }
    } catch { /* ignore */ }
}

/**
 * 记录一次新 PB；幂等 + 单调（仅在 newBest > 已有 PB 时入栈）。
 * 同一时间戳同一数值的重复调用不会被推入。
 * @param {number} newBest
 * @param {number} [now=Date.now()]
 * @returns {boolean} true=本次写入；false=跳过
 */
export function recordPersonalBest(newBest, now = Date.now()) {
    if (!Number.isFinite(newBest) || newBest <= 0) return false;
    const history = readPbHistory();
    const lastValue = history.length ? history[history.length - 1].value : 0;
    if (newBest <= lastValue) return false;
    history.push({ value: newBest, ts: now });
    _writePbHistory(history);
    return true;
}

/**
 * 计算最近 K 次 PB 的"每局平均增长率"。
 *
 * 公式：geometricMeanGrowth = (lastPB / firstPB) ^ (1 / (n-1))
 *   - 比算术平均更稳健：单次大跳不会主导
 *   - n=1 时返回 0（无法计算增长率）
 *   - n<2 时返回 0（同上）
 *
 * @param {Array<{value:number, ts:number}>} [history=readPbHistory()]
 * @param {number} [windowSize=5] 取最近 K 条
 * @returns {number} 每局平均增长率（如 0.10 = 每局涨 10%）；无数据返回 0
 */
export function computePbGrowthRate(history = readPbHistory(), windowSize = 5) {
    if (!Array.isArray(history) || history.length < 2) return 0;
    const window = history.slice(-Math.max(2, windowSize));
    const first = window[0].value;
    const last = window[window.length - 1].value;
    if (first <= 0 || last <= first) return 0;
    const steps = window.length - 1;
    const ratio = last / first;
    return Math.pow(ratio, 1 / steps) - 1;
}

/**
 * 判断 PB 增长率是否过快（用于 farFromPBBoost 节流）。
 *
 * 默认阈值 0.10：每局 PB 平均涨 10% 以上视为"快"。
 * 配合 ctx.pbGrowthFast → adaptiveSpawn.js §2.1 farFromPBBoost
 * bypass='pb_growth_throttled' 跳过送爽，避免 PB 通胀。
 *
 * @param {number} [threshold=0.10]
 * @param {Array<{value:number, ts:number}>} [history]
 * @param {number} [windowSize=5]
 * @returns {boolean}
 */
export function isPbGrowthFast(threshold = 0.10, history = readPbHistory(), windowSize = 5) {
    const rate = computePbGrowthRate(history, windowSize);
    return rate >= threshold;
}

/**
 * 计算"连续突破段"长度：从 history 末尾倒推，相邻两次 PB 时间间隔 ≤ windowMs 即视为
 * 连续，直到出现首次大于 windowMs 的断点。
 *
 * 默认 windowMs = 7 * 24 * 3600 * 1000（7 天）。
 *
 * @param {Array<{value:number, ts:number}>} [history]
 * @param {number} [windowMs]
 * @returns {number} 连续突破次数（>=0）；history 为空时返回 0；单条记录返回 1
 */
export function computePbStreakCount(history = readPbHistory(), windowMs = 7 * 24 * 3600 * 1000) {
    if (!Array.isArray(history) || history.length === 0) return 0;
    let count = 1;
    for (let i = history.length - 1; i > 0; i--) {
        const cur = history[i];
        const prev = history[i - 1];
        if (!Number.isFinite(cur?.ts) || !Number.isFinite(prev?.ts)) break;
        if (cur.ts - prev.ts > windowMs) break;
        count++;
    }
    return count;
}

/** 测试用：清除 PB 历史（localStorage + 内存兜底） */
export function __clearPbHistoryForTest() {
    _memoryFallback = null;
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(STORAGE_KEY);
        }
    } catch { /* ignore */ }
}
