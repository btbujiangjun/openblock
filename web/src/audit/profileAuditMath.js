/**
 * profileAuditMath.js — 玩家画像指标自评估系统的纯数学工具
 *
 * 设计原则：
 *   - 零依赖、纯函数、可在 Web / Node 同源调用
 *   - 所有函数对 null / NaN / 空数组宽容：返回 null 或合理零值，永不抛错
 *   - 算法用最小可读实现，不引入数值库；样本量典型 < 1000，性能足够
 *
 * 这里只放"数据 → 数字"的转换，绝不挂载业务语义；语义层在
 * profileAudit / profileAuditContracts / profileAuditHints。
 */

/**
 * 把任意可迭代值过滤为有限数字数组。
 * @param {Iterable<unknown>} xs
 * @returns {number[]}
 */
export function finiteNumbers(xs) {
    if (xs == null) return [];
    const out = [];
    for (const v of xs) {
        // 显式拒绝 null/undefined，避免 Number(null)===0 / Number(undefined)===NaN 的 JS 陷阱
        if (v == null) continue;
        const n = Number(v);
        if (Number.isFinite(n)) out.push(n);
    }
    return out;
}

/**
 * 平均值；空数组返回 null。
 */
export function mean(xs) {
    const arr = finiteNumbers(xs);
    if (arr.length === 0) return null;
    let s = 0;
    for (const x of arr) s += x;
    return s / arr.length;
}

/**
 * 中位数；空数组返回 null。
 */
export function median(xs) {
    const arr = finiteNumbers(xs).slice().sort((a, b) => a - b);
    const n = arr.length;
    if (n === 0) return null;
    return n % 2 === 1 ? arr[(n - 1) >> 1] : (arr[n / 2 - 1] + arr[n / 2]) / 2;
}

/**
 * 总体方差（除以 n，不除 n-1）；样本量 ≤ 1 返回 0。
 */
export function variance(xs) {
    const arr = finiteNumbers(xs);
    if (arr.length <= 1) return 0;
    const mu = mean(arr);
    let s = 0;
    for (const x of arr) {
        const d = x - mu;
        s += d * d;
    }
    return s / arr.length;
}

export function stddev(xs) {
    return Math.sqrt(variance(xs));
}

/**
 * 分位数（线性插值）；空数组返回 null。
 * @param {Iterable<number>} xs
 * @param {number} q [0,1]
 */
export function quantile(xs, q) {
    const arr = finiteNumbers(xs).slice().sort((a, b) => a - b);
    if (arr.length === 0) return null;
    const t = Math.min(1, Math.max(0, q)) * (arr.length - 1);
    const lo = Math.floor(t);
    const hi = Math.ceil(t);
    if (lo === hi) return arr[lo];
    return arr[lo] * (hi - t) + arr[hi] * (t - lo);
}

/**
 * 基础统计五件套：min / max / mean / median / stddev。
 */
export function basicStats(xs) {
    const arr = finiteNumbers(xs);
    if (arr.length === 0) {
        return { count: 0, min: null, max: null, mean: null, median: null, stddev: null };
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const x of arr) {
        if (x < lo) lo = x;
        if (x > hi) hi = x;
    }
    return {
        count: arr.length,
        min: lo,
        max: hi,
        mean: mean(arr),
        median: median(arr),
        stddev: stddev(arr),
    };
}

/**
 * 跳变指标：相邻样本差的绝对值的中位数 + 最大值。
 * 用于评估"噪声"——稳定指标 medianAbsDiff 应该 ≪ stddev；过大说明逐帧抖动剧烈。
 *
 * @param {number[]} xs 时序值
 * @returns {{ medianAbsDiff:number|null, maxAbsDiff:number|null }}
 */
export function jitterStats(xs) {
    const arr = finiteNumbers(xs);
    if (arr.length < 2) return { medianAbsDiff: null, maxAbsDiff: null };
    const diffs = [];
    let maxAbs = 0;
    for (let i = 1; i < arr.length; i++) {
        const d = Math.abs(arr[i] - arr[i - 1]);
        diffs.push(d);
        if (d > maxAbs) maxAbs = d;
    }
    return { medianAbsDiff: median(diffs), maxAbsDiff: maxAbs };
}

/**
 * Pearson 相关系数（线性相关）；样本量 < 2 或方差 0 返回 null。
 * 自动两两对齐：对配对中任一为非有限值的位置跳过，再算。
 *
 * @returns {{ r:number|null, n:number }}
 */
export function pearson(xsRaw, ysRaw) {
    const xs = Array.from(xsRaw ?? []);
    const ys = Array.from(ysRaw ?? []);
    const n0 = Math.min(xs.length, ys.length);
    const xs2 = [];
    const ys2 = [];
    for (let i = 0; i < n0; i++) {
        const xn = Number(xs[i]);
        const yn = Number(ys[i]);
        if (Number.isFinite(xn) && Number.isFinite(yn)) {
            xs2.push(xn);
            ys2.push(yn);
        }
    }
    const n = xs2.length;
    if (n < 2) return { r: null, n };
    const mx = mean(xs2);
    const my = mean(ys2);
    let sxy = 0;
    let sxx = 0;
    let syy = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs2[i] - mx;
        const dy = ys2[i] - my;
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return { r: null, n };
    return { r: sxy / Math.sqrt(sxx * syy), n };
}

/**
 * Spearman 秩相关：对原始值取秩后再做 Pearson；衡量单调关系（不要求线性）。
 *
 * 对自然有 ordinal 关系但非线性的画像指标（比如 stress 与 boardFill）比 Pearson 更稳健。
 */
export function spearman(xsRaw, ysRaw) {
    const xs = Array.from(xsRaw ?? []);
    const ys = Array.from(ysRaw ?? []);
    const n0 = Math.min(xs.length, ys.length);
    const pairs = [];
    for (let i = 0; i < n0; i++) {
        const xn = Number(xs[i]);
        const yn = Number(ys[i]);
        if (Number.isFinite(xn) && Number.isFinite(yn)) pairs.push([xn, yn]);
    }
    if (pairs.length < 2) return { rho: null, n: pairs.length };
    const ranks = (arr) => {
        const indexed = arr.map((v, i) => ({ v, i }));
        indexed.sort((a, b) => a.v - b.v);
        const out = new Array(arr.length);
        // 平均秩处理 tie
        let i = 0;
        while (i < indexed.length) {
            let j = i;
            while (j + 1 < indexed.length && indexed[j + 1].v === indexed[i].v) j++;
            const avgRank = (i + j) / 2 + 1;
            for (let k = i; k <= j; k++) out[indexed[k].i] = avgRank;
            i = j + 1;
        }
        return out;
    };
    const rx = ranks(pairs.map((p) => p[0]));
    const ry = ranks(pairs.map((p) => p[1]));
    const { r } = pearson(rx, ry);
    return { rho: r, n: pairs.length };
}

/**
 * 一阶 lag-k 自相关（衡量周期性 / 惯性）；样本量 ≤ k 返回 null。
 *
 * 解读：
 *   - 接近 1 = 强惯性（如累积量 score）
 *   - 接近 0 = 白噪声
 *   - 负值 = 振荡（少见，可能是阈值翻转）
 */
export function autocorrelation(xsRaw, lag = 1) {
    const xs = finiteNumbers(xsRaw);
    const n = xs.length;
    if (n <= lag) return null;
    const mu = mean(xs);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
        const d = xs[i] - mu;
        den += d * d;
    }
    if (den === 0) return null;
    for (let i = 0; i < n - lag; i++) {
        num += (xs[i] - mu) * (xs[i + lag] - mu);
    }
    return num / den;
}

/**
 * 简单线性趋势：返回斜率 k 与截距 b（最小二乘）；样本量 < 2 返回 null。
 *
 * X 默认用样本 idx；用于判断"是否上升 / 下降趋势"——结合 Mann-Kendall 更稳，但本工具
 * 关注的是"指标是否单向漂移"，斜率 + 起末差就够用了。
 */
export function linearTrend(xsRaw) {
    const ys = finiteNumbers(xsRaw);
    const n = ys.length;
    if (n < 2) return { slope: null, intercept: null, n };
    const mx = (n - 1) / 2;
    const my = mean(ys);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
        num += (i - mx) * (ys[i] - my);
        den += (i - mx) * (i - mx);
    }
    if (den === 0) return { slope: 0, intercept: my, n };
    const slope = num / den;
    return { slope, intercept: my - slope * mx, n };
}

/**
 * 取序列前后两半的均值，返回"末段 - 首段"差；用于回答"指标整体在升 / 降 / 平"。
 * 比 linearTrend 更鲁棒于局部尖刺，体感更接近"看图说话"。
 */
export function halvesMeanDiff(xsRaw) {
    const xs = finiteNumbers(xsRaw);
    if (xs.length < 4) return null;
    const half = xs.length >> 1;
    const m1 = mean(xs.slice(0, half));
    const m2 = mean(xs.slice(half));
    if (m1 == null || m2 == null) return null;
    return m2 - m1;
}

/**
 * 范围越界检查：返回越界次数与首次越界 idx。
 *
 * @param {number[]} xsRaw
 * @param {{ min?:number, max?:number }} range
 */
export function outOfRangeCount(xsRaw, range) {
    if (!range || (range.min == null && range.max == null)) {
        return { count: 0, firstIdx: null };
    }
    let count = 0;
    let firstIdx = null;
    const arr = Array.from(xsRaw ?? []);
    for (let i = 0; i < arr.length; i++) {
        const v = Number(arr[i]);
        if (!Number.isFinite(v)) continue;
        const lo = range.min;
        const hi = range.max;
        if ((lo != null && v < lo) || (hi != null && v > hi)) {
            count++;
            if (firstIdx == null) firstIdx = i;
        }
    }
    return { count, firstIdx };
}

/**
 * 给定两条时序（同长度），统计"上升 / 下降"方向异号（即"反向"）的步数比例。
 *
 * 用于评估"应该反向走的指标对"是否真的反向，例如：
 *   clearRate ↑ ↔ boardFill ↓ 应当 ≥ 0.6 才算契约通过
 *
 * @returns {{ oppositeRate:number|null, samples:number }}  -1 ≤ rate ≤ 1
 *   1 → 完全反向；0 → 无关；-1 → 同向
 */
export function oppositeStepRate(aRaw, bRaw) {
    const a = Array.from(aRaw ?? []);
    const b = Array.from(bRaw ?? []);
    const n = Math.min(a.length, b.length);
    if (n < 3) return { oppositeRate: null, samples: 0 };
    let same = 0;
    let opp = 0;
    let valid = 0;
    for (let i = 1; i < n; i++) {
        const da = Number(a[i]) - Number(a[i - 1]);
        const db = Number(b[i]) - Number(b[i - 1]);
        if (!Number.isFinite(da) || !Number.isFinite(db)) continue;
        if (Math.abs(da) < 1e-9 || Math.abs(db) < 1e-9) continue; // 平段跳过
        valid++;
        if ((da > 0 && db < 0) || (da < 0 && db > 0)) opp++;
        else same++;
    }
    if (valid === 0) return { oppositeRate: null, samples: 0 };
    return { oppositeRate: (opp - same) / valid, samples: valid };
}

/**
 * 滞后相关：a[t] 与 b[t+lag] 的 Pearson 相关；用于评估"信号→响应"的滞后强度。
 *
 * 例如 feedbackBias[t] 应该在 ~3 步后体现在 stress[t+3] 的变化上。
 *
 * @returns {{ r:number|null, n:number, lag:number }}
 */
export function laggedPearson(aRaw, bRaw, lag) {
    const a = Array.from(aRaw ?? []);
    const b = Array.from(bRaw ?? []);
    const n0 = Math.min(a.length, b.length);
    if (n0 <= Math.abs(lag) + 1) return { r: null, n: 0, lag };
    const xs = [];
    const ys = [];
    if (lag >= 0) {
        for (let i = 0; i + lag < n0; i++) {
            xs.push(Number(a[i]));
            ys.push(Number(b[i + lag]));
        }
    } else {
        for (let i = -lag; i < n0; i++) {
            xs.push(Number(a[i]));
            ys.push(Number(b[i + lag]));
        }
    }
    const { r, n } = pearson(xs, ys);
    return { r, n, lag };
}
