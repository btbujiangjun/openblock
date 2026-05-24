/**
 * 拉丁超立方采样 (Latin Hypercube Sampling)。
 *
 * 用于 Phase A 冷启动: 在 [0, 1]^d 立方体内生成 n 个均匀分布的点,
 * 保证每个维度上 n 个点恰好覆盖 n 个分箱 (远比纯随机均匀)。
 *
 * 算法:
 *   1. 对每个维度 d_i:
 *      把 [0, 1] 切成 n 个等长子区间 [k/n, (k+1)/n)
 *      在每个子区间内取一个随机点 → n 个候选值
 *      把这 n 个值打乱
 *   2. 第 j 个样本 = (打乱后 dim 0 的第 j 个值, dim 1 的第 j 个值, ...)
 *
 * 设计依据: McKay, Beckman & Conover, 1979.
 */

/**
 * 确定性 Fisher-Yates shuffle (固定种子可复现)。
 */
function shuffleSeeded(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

/**
 * Mulberry32 PRNG - 32-bit 确定性,固定种子重现.
 */
function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) | 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * 生成 n 个 LHS 样本,每个样本是 [0, 1]^dim 中的一个点。
 *
 * @param {number} n - 样本数 (≥ 1)
 * @param {number} dim - 维度数 (≥ 1)
 * @param {object} [options]
 * @param {number} [options.seed=42] - 随机种子 (固定 → 可复现)
 * @param {boolean} [options.center=false] - true: 用区间中心点 (确定性); false: 区间内均匀随机
 * @returns {number[][]} - n × dim 的 0~1 矩阵
 */
export function latinHypercube(n, dim, options = {}) {
    if (!Number.isFinite(n) || n < 1) throw new Error(`latinHypercube: invalid n=${n}`);
    if (!Number.isFinite(dim) || dim < 1) throw new Error(`latinHypercube: invalid dim=${dim}`);
    const seed = options.seed ?? 42;
    const center = options.center === true;
    const rng = mulberry32(seed >>> 0);

    // 对每个维度: 生成 n 个分箱内的候选值,然后打乱
    const cols = [];
    for (let d = 0; d < dim; d++) {
        const values = [];
        for (let k = 0; k < n; k++) {
            const u = center ? 0.5 : rng();
            values.push((k + u) / n);
        }
        cols.push(shuffleSeeded(values, rng));
    }

    // 转置: rows[j] = (cols[0][j], cols[1][j], ..., cols[dim-1][j])
    const samples = [];
    for (let j = 0; j < n; j++) {
        const row = new Array(dim);
        for (let d = 0; d < dim; d++) row[d] = cols[d][j];
        samples.push(row);
    }
    return samples;
}

/**
 * 用 LHS 生成 n 个 θ (字典形式),每维度按 paramSpace 反归一化。
 * 调用 paramSpace.vectorToTheta 转换,避免重复实现归一化逻辑。
 *
 * @param {number} n
 * @param {{vectorToTheta:(v:number[])=>object, getParamSpaceDim:()=>number}} paramSpace
 * @param {object} [options] - 同 latinHypercube
 * @returns {object[]} - n 个 theta 对象
 */
export function lhsThetas(n, paramSpace, options = {}) {
    const dim = paramSpace.getParamSpaceDim();
    const vectors = latinHypercube(n, dim, options);
    return vectors.map((v) => paramSpace.vectorToTheta(v));
}

/**
 * Phase A: 为多个 context 各自生成 thetasPerContext 个 LHS 样本。
 *
 * 返回展开后的 (context, theta, seedIdx) 任务列表,可直接喂给采样队列。
 *
 * @param {Array<object>} contexts - 待覆盖的 context 列表 (来自 enumerateAllContexts())
 * @param {number} thetasPerContext - 每个 context 内的唯一 θ 数
 * @param {number} seedsPerTheta - 每个 θ 重复评估的种子数 (减噪)
 * @param {object} paramSpace
 * @param {number} [baseSeed=42]
 * @returns {Array<{context, theta, seed, seq}>}
 */
export function buildPhaseATasks(contexts, thetasPerContext, seedsPerTheta, paramSpace, baseSeed = 42) {
    const tasks = [];
    let seq = 0;
    for (let cIdx = 0; cIdx < contexts.length; cIdx++) {
        const context = contexts[cIdx];
        // 每 context 用独立子种子,保证不同 context 用不同 LHS 集合
        const ctxSeed = (baseSeed + cIdx * 7919) >>> 0;  // 7919 是素数,避免周期性
        const thetas = lhsThetas(thetasPerContext, paramSpace, { seed: ctxSeed });
        for (let tIdx = 0; tIdx < thetas.length; tIdx++) {
            for (let s = 0; s < seedsPerTheta; s++) {
                tasks.push({
                    context,
                    theta: thetas[tIdx],
                    seed: (ctxSeed + tIdx * 31 + s) >>> 0,
                    seq: seq++,
                });
            }
        }
    }
    return tasks;
}
