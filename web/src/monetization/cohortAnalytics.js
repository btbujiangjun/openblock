/**
 * cohortAnalytics.js — 飞轮度量纯函数（Cohort LTV / ROAS / Payback / ARPDAU / 留存）
 *
 * 目标
 * ----
 * 把「① 买量 → ② 承接 → ③ 变现 → ④ 回流」闭环里需要的核心度量，收敛为一组
 * 与数据源无关的纯函数：服务端 SQL 聚合后喂入原始数组，这里只做口径统一的计算。
 *
 *   - computeArpdau          ARPDAU = 当日真实流水 / DAU（替换估算口径，MO-3）
 *   - computeRoas            ROAS   = cohort 累计真实回收 / cohort 花费（UA-3）
 *   - computeCohortLtvCurve  渠道×素材 cohort 的累计 ARPU 曲线（UA-2）
 *   - computePaybackDay      回本日：累计 ARPU 首次 ≥ CPI 的天数
 *   - computeRetentionCurve  Dn 留存曲线
 *   - aggregateChannelRoi    按 utm_source/utm_content 聚合 CPI/留存/LTV/ROAS（UA-5）
 *
 * 约束：纯函数、无副作用、无 import。货币单位「元」(CNY)。
 */

function _num(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/** ARPDAU = 真实流水 / 活跃用户数。 */
export function computeArpdau({ revenue, dau } = {}) {
    const d = Math.max(0, _num(dau));
    if (d === 0) return 0;
    return +(Math.max(0, _num(revenue)) / d).toFixed(4);
}

/** ROAS = cohort 累计真实回收 / cohort 投放花费。 */
export function computeRoas({ revenue, spend } = {}) {
    const s = Math.max(0, _num(spend));
    if (s === 0) return null; // 无花费时 ROAS 无意义
    return +(Math.max(0, _num(revenue)) / s).toFixed(4);
}

/**
 * cohort 累计 ARPU 曲线。
 * @param {Array<{ dayIndex:number, amount:number }>} revenueEvents 安装后第 dayIndex 天的回收事件
 * @param {number} cohortSize cohort 用户数
 * @param {number} [horizon=90] 曲线长度（天）
 * @returns {number[]} index d = 安装后第 d 天的累计人均回收（元），长度 horizon+1
 */
export function computeCohortLtvCurve(revenueEvents, cohortSize, horizon = 90) {
    const n = Math.max(0, _num(cohortSize));
    const h = Math.max(0, Math.floor(horizon));
    const daily = new Array(h + 1).fill(0);
    for (const ev of revenueEvents ?? []) {
        const d = Math.floor(_num(ev?.dayIndex, -1));
        if (d < 0 || d > h) continue;
        daily[d] += Math.max(0, _num(ev?.amount));
    }
    const curve = new Array(h + 1).fill(0);
    let cum = 0;
    for (let d = 0; d <= h; d++) {
        cum += daily[d];
        curve[d] = n > 0 ? +(cum / n).toFixed(4) : 0;
    }
    return curve;
}

/**
 * 回本日：累计 ARPU 曲线首次 ≥ CPI 的天数；永不回本返回 null。
 * @param {number[]} ltvCurve computeCohortLtvCurve 输出
 * @param {number} cpi 单用户获取成本（元）
 */
export function computePaybackDay(ltvCurve, cpi) {
    const c = Math.max(0, _num(cpi));
    if (!Array.isArray(ltvCurve)) return null;
    for (let d = 0; d < ltvCurve.length; d++) {
        if (ltvCurve[d] >= c) return d;
    }
    return null;
}

/**
 * Dn 留存曲线。
 * @param {Record<number, number>|Array<{ dayIndex:number, activeUsers:number }>} activeByDay
 * @param {number} cohortSize
 * @param {number[]} [days=[1,3,7,14,30]]
 * @returns {Record<string, number>} { D1, D3, ... } 比例（0..1）
 */
export function computeRetentionCurve(activeByDay, cohortSize, days = [1, 3, 7, 14, 30]) {
    const n = Math.max(0, _num(cohortSize));
    const lookup = new Map();
    if (Array.isArray(activeByDay)) {
        for (const r of activeByDay) lookup.set(Math.floor(_num(r?.dayIndex, -1)), _num(r?.activeUsers));
    } else if (activeByDay && typeof activeByDay === 'object') {
        for (const [k, v] of Object.entries(activeByDay)) lookup.set(Math.floor(_num(k, -1)), _num(v));
    }
    const out = {};
    for (const d of days) {
        const active = lookup.get(d) ?? 0;
        out[`D${d}`] = n > 0 ? +(active / n).toFixed(4) : 0;
    }
    return out;
}

/**
 * 按渠道/素材聚合 ROI（UA-5）。
 * @param {Array<{ key:string, installs:number, spend:number, revenue:number, retainedD1?:number }>} rows
 * @returns {Array<{ key:string, installs:number, cpi:number, arpu:number, roas:number|null, d1:number|null }>}
 */
export function aggregateChannelRoi(rows) {
    const acc = new Map();
    for (const r of rows ?? []) {
        const key = String(r?.key ?? 'unknown');
        const cur = acc.get(key) ?? { key, installs: 0, spend: 0, revenue: 0, retainedD1: 0 };
        cur.installs += Math.max(0, _num(r?.installs));
        cur.spend += Math.max(0, _num(r?.spend));
        cur.revenue += Math.max(0, _num(r?.revenue));
        cur.retainedD1 += Math.max(0, _num(r?.retainedD1));
        acc.set(key, cur);
    }
    return [...acc.values()].map((c) => ({
        key: c.key,
        installs: c.installs,
        cpi: c.installs > 0 ? +(c.spend / c.installs).toFixed(4) : 0,
        arpu: c.installs > 0 ? +(c.revenue / c.installs).toFixed(4) : 0,
        roas: computeRoas({ revenue: c.revenue, spend: c.spend }),
        d1: c.installs > 0 ? +(c.retainedD1 / c.installs).toFixed(4) : null,
    })).sort((a, b) => (b.roas ?? -1) - (a.roas ?? -1));
}
