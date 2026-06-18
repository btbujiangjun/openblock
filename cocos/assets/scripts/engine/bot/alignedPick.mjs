/* 自动生成 —— 请勿手改。源：web/src/bot/alignedPick.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * bot/alignedPick.js — 难度相对论 best-of-K 选块（v1.70 从 blockSpawn.js 抽出）
 *
 * 单一职责：从一组候选 `{ align: number, ...payload }` 中按"对齐 b* 的程度"挑一个。
 *   3 种策略：
 *     - argmax：最对齐（行为=历史确定性）
 *     - argmin：最偏离（爽点预算 burst release，释放被压制的最大爆点）
 *     - softmax(align / 温度) 采样：保留次优候选入选概率，恢复难度方差
 *
 * 何时退回 argmax（保证零行为变化）：
 *   - 无 rng（确定性回放缺省）
 *   - rng 命中 burstProb 时改走 argmin；否则按 temperature 决定
 *   - temperature ≤ 0 → 强制 argmax
 *
 * 拆分动因：
 *   这 3 个函数在 generateDockShapes 内是**纯函数闭包**（仅依赖 rng + 数值参数），
 *   抽出后可独立单测、不影响主管线；剩余的 `_candidateVec` 因强依赖 8+ 个闭包变量，
 *   留在主函数内不动。
 */

/** 取 align 最大者。`buf[0]` 作为兜底（buf 为空时由调用方负责）。 */
export function argmaxAlign(buf) {
    return buf.reduce((a, b) => (b.align > a.align ? b : a), buf[0]);
}

/** 取 align 最小者（burst release 用）。 */
export function argminAlign(buf) {
    return buf.reduce((a, b) => (b.align < a.align ? b : a), buf[0]);
}

/**
 * 综合策略选块。
 *
 * @template T
 * @param {Array<T & { align: number }>} buf  候选数组；每项必须含 numeric `align`
 * @param {object} [opts]
 * @param {(() => number) | null} [opts.rng]   随机源；null/undefined → 退回 argmax
 * @param {number} [opts.burstProb=0]          burst release 触发概率 [0,1]
 * @param {number} [opts.temperature=0]        softmax 温度；≤0 表示禁用
 * @returns {T} 选中的候选；buf 空时返回 `buf[0]`（undefined）
 */
export function pickBestAligned(buf, opts) {
    if (!Array.isArray(buf) || buf.length === 0) return buf && buf[0];
    if (buf.length === 1) return buf[0];

    const rng = (opts && typeof opts.rng === 'function') ? opts.rng : null;
    if (!rng) return argmaxAlign(buf);

    const burstProb = Math.max(0, Math.min(1, Number(opts && opts.burstProb) || 0));
    if (burstProb > 0 && rng() < burstProb) return argminAlign(buf);

    const temperature = Number(opts && opts.temperature) > 0 ? Number(opts.temperature) : 0;
    if (temperature > 0) {
        let max = -Infinity;
        for (const b of buf) { if (b.align > max) max = b.align; }
        const w = new Array(buf.length);
        let total = 0;
        for (let i = 0; i < buf.length; i++) {
            const e = Math.exp((buf[i].align - max) / temperature);
            w[i] = e;
            total += e;
        }
        if (total > 0) {
            let r = rng() * total;
            for (let i = 0; i < buf.length; i++) { r -= w[i]; if (r <= 0) return buf[i]; }
            return buf[buf.length - 1];
        }
    }
    return argmaxAlign(buf);
}
