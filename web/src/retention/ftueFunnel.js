/**
 * ftueFunnel.js — 首次用户体验（FTUE）漏斗度量
 *
 * 目标（RT-2）
 * -----------
 * 度量买量承接最关键的冷启动漏斗：
 *   app_open → game_start → first_clear → first_game_end → d1_return
 * 任一步骤的陡降即为承接断点（CPI 烧了却没承接住）。
 *
 * 设计
 * ----
 *   - 客户端：recordStep(step) 幂等打点（每步首次到达记一次 + 时间戳），持久化到
 *     localStorage；上报后端聚合成跨用户漏斗。
 *   - 服务端/看板：computeFunnelRates(stepCounts) 纯函数算出逐级转化与流失。
 * 约束：纯函数部分无副作用、无 import；持久化部分对无 localStorage 的端软失败。
 */

/** 漏斗步骤顺序（唯一真源）。 */
export const FTUE_STEPS = Object.freeze([
    'app_open',
    'game_start',
    'first_clear',
    'first_game_end',
    'd1_return',
]);

const FTUE_LABELS = Object.freeze({
    app_open: '打开应用',
    game_start: '开始首局',
    first_clear: '首次消行',
    first_game_end: '首局结束',
    d1_return: '次日回访',
});

const STORAGE_KEY = 'openblock_ftue_funnel_v1';

function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : { steps: {}, firstOpenTs: Date.now() };
    } catch {
        return { steps: {}, firstOpenTs: Date.now() };
    }
}

function _save(data) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
        /* 无 localStorage 的端软失败 */
    }
}

/**
 * 幂等记录到达某步骤。d1_return 仅在跨自然日回访时记。
 * @param {string} step FTUE_STEPS 之一
 * @returns {{ step:string, firstTime:boolean }|null}
 */
export function recordStep(step) {
    if (!FTUE_STEPS.includes(step)) return null;
    const data = _load();
    data.steps = data.steps || {};
    if (data.steps[step]) return { step, firstTime: false };
    data.steps[step] = { ts: Date.now() };
    _save(data);
    return { step, firstTime: true };
}

/** 应用打开时调用：登记 app_open，并在跨日回访时补 d1_return。 */
export function markAppOpen() {
    const data = _load();
    const now = Date.now();
    const firstOpen = data.firstOpenTs ?? now;
    if (!data.firstOpenTs) {
        data.firstOpenTs = now;
        _save(data);
    }
    const r = recordStep('app_open');
    // 跨自然日（≥1 天）回访 → d1_return
    const dayMs = 86400_000;
    if (now - firstOpen >= dayMs) recordStep('d1_return');
    return r;
}

/** 当前用户漏斗进度快照。 */
export function getFunnelProgress() {
    const data = _load();
    const steps = data.steps || {};
    return FTUE_STEPS.map((s) => ({
        step: s,
        label: FTUE_LABELS[s],
        reached: !!steps[s],
        ts: steps[s]?.ts ?? null,
    }));
}

/**
 * 纯函数：由跨用户的各步骤计数算出逐级转化率与流失（看板/服务端用）。
 * @param {Record<string, number>} stepCounts 各步骤到达人数
 * @param {string[]} [order=FTUE_STEPS]
 * @returns {Array<{ step:string, label:string, count:number, rateFromTop:number, conversionFromPrev:number, dropFromPrev:number }>}
 */
export function computeFunnelRates(stepCounts, order = FTUE_STEPS) {
    const top = Math.max(0, Number(stepCounts?.[order[0]]) || 0);
    let prev = top;
    return order.map((step, i) => {
        const count = Math.max(0, Number(stepCounts?.[step]) || 0);
        const conversionFromPrev = i === 0 ? 1 : (prev > 0 ? +(count / prev).toFixed(4) : 0);
        const rateFromTop = top > 0 ? +(count / top).toFixed(4) : 0;
        const dropFromPrev = i === 0 ? 0 : +(1 - conversionFromPrev).toFixed(4);
        prev = count;
        return {
            step,
            label: FTUE_LABELS[step] ?? step,
            count,
            rateFromTop,
            conversionFromPrev,
            dropFromPrev,
        };
    });
}

/** 找出流失最严重的一步（承接断点定位）。 */
export function findBiggestDropoff(stepCounts, order = FTUE_STEPS) {
    const rates = computeFunnelRates(stepCounts, order);
    let worst = null;
    for (let i = 1; i < rates.length; i++) {
        if (!worst || rates[i].dropFromPrev > worst.dropFromPrev) worst = rates[i];
    }
    return worst;
}
