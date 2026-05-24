/**
 * 寻参目标函数 — 把评估指标转换为带 bestScore / 生命周期条件化的标量 J(θ|c)。
 *
 * 设计依据：docs/algorithms/SPAWN_AUTO_TUNING.md §3
 *
 * 输入：
 *   - row: 单次评估产出的指标行 (至少含 noMoveRate / firstMoveFreedomMean / fallbackRate /
 *          clearsMean / multiClearRate / clearIntervalP90 / overshootRate / breakPbRate)
 *   - context: { difficulty, generator, bestScore, lifecycle }  bestScore 用原始值不分档
 *   - weights: { fairness, excitement, antiInflation } 任意比例,内部自动归一化
 *
 * 输出：
 *   - { fairness, excitement, antiInflation, composite, breakdown }
 *
 * 关键不变量（被测试覆盖）：
 *   - 子分数 ∈ [0, 1]
 *   - composite ∈ [0, 1] (权重归一化后)
 *   - 全 0 权重时回退到等权 (避免 NaN)
 *   - bestScore 单调递增 → overshoot_tolerance 单调递减
 *   - lifecycle multiplier 与 §3.3 表完全一致
 */

const EPS = 1e-9;

/**
 * 把任意值钳制到 [0, 1]。
 */
export function clamp01(v) {
    if (!Number.isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
}

/**
 * 数值安全的 sigmoid。
 */
export function sigmoid(x) {
    if (x >= 0) {
        const z = Math.exp(-x);
        return 1 / (1 + z);
    }
    const z = Math.exp(x);
    return z / (1 + z);
}

/**
 * 公式参数定型 (Phase B locked values)
 * 这是整个寻参系统的"业务先验"，改动需经评审。
 */
export const OBJECTIVE_CONFIG = Object.freeze({
    /** PB 容忍度 sigmoid
     *
     * 设计目标 (见 docs §3.2 表):
     *   bestScore=500   → tolerance ≈ 0.42
     *   bestScore=1500  → tolerance ≈ 0.30
     *   bestScore=4000  → tolerance ≈ 0.14
     *   bestScore=10000 → tolerance ≈ 0.07
     *   bestScore=25000 → tolerance ≈ 0.05
     *
     * slope=0.24 是反推自 best=500 → 0.42 这一锚点;
     * 其他 4 档自动落在 ±0.02 文档目标内。
     */
    overshoot: Object.freeze({
        toleranceMin: 0.05,         // 顶尖玩家底线
        toleranceMax: 0.45,         // 新手玩家上限 (容忍度 = min + max-min × sigmoid)
        centerLogBest: Math.log10(2000),  // sigmoid 中心 log10
        slope: 0.24,                // sigmoid 斜率 (越小越陡)
    }),

    /** 生命周期权重乘子 (与 §3.3 表对应) */
    lifecycle: Object.freeze({
        onboarding: Object.freeze({ fairness: 1.5, excitement: 1.2, antiInflation: 0.5 }),
        growth:     Object.freeze({ fairness: 1.0, excitement: 1.0, antiInflation: 1.0 }),
        mature:     Object.freeze({ fairness: 0.8, excitement: 0.9, antiInflation: 1.5 }),
        plateau:    Object.freeze({ fairness: 0.7, excitement: 1.5, antiInflation: 0.8 }),
    }),

    /** 子分数内部权重 (固定,不暴露给 UI) */
    subscoreWeights: Object.freeze({
        fairness: Object.freeze({
            noMove: 0.55,           // (1 - noMoveRate)
            skill: 0.25,            // firstMoveFreedom / 12, 钳到 [0,1]
            fallback: 0.20,         // (1 - 8 × fallbackRate)
        }),
        excitement: Object.freeze({
            clears: 0.50,           // clearsMean / 40
            multiClear: 0.30,       // multiClearRate × 2
            pacing: 0.20,           // 1 - (clearIntervalP90 - 5) / 10  (钳到 [0,1])
        }),
        antiInflation: Object.freeze({
            overshoot: 0.70,        // 主导项 (与 PB 容忍度联动)
            breakHealth: 0.30,      // breakPbRate 在 [8%, 15%] 健康区
        }),
    }),

    /** breakHealth 健康区间 */
    breakHealth: Object.freeze({
        idealLow: 0.08,
        idealHigh: 0.15,
        outerHigh: 0.45,            // 超过此值线性归零
    }),
});

const VALID_LIFECYCLES = ['onboarding', 'growth', 'mature', 'plateau'];

/**
 * 计算 overshoot 容忍度: tolerance(bestScore) ∈ [0.05, 0.45]
 *
 * 公式: tolerance = min + (max - min) × sigmoid((center - log10(b)) / slope)
 * 即 bestScore 越大,容忍度越小 (单调递减)。
 *
 * @param {number} bestScore - 原始 PB 分数 (> 0)
 * @returns {number} 容忍度 ∈ [toleranceMin, toleranceMax]
 */
export function overshootTolerance(bestScore) {
    const cfg = OBJECTIVE_CONFIG.overshoot;
    const safeBest = Math.max(1, Number(bestScore) || 1);
    const logBest = Math.log10(safeBest);
    const x = (cfg.centerLogBest - logBest) / cfg.slope;
    return cfg.toleranceMin + (cfg.toleranceMax - cfg.toleranceMin) * sigmoid(x);
}

/**
 * 计算 breakPbRate 健康分数 (1 = 完美健康, 0 = 显著偏离)。
 *
 * 在 [idealLow, idealHigh] 区间内 → 1.0
 * 低于 idealLow → 线性下降 (太少破 PB 也不好)
 * 高于 idealHigh → 线性下降至 outerHigh 时归零
 *
 * @param {number} rate - breakPbRate (0~1)
 */
export function breakHealthScore(rate) {
    const cfg = OBJECTIVE_CONFIG.breakHealth;
    const r = clamp01(Number(rate) || 0);
    if (r >= cfg.idealLow && r <= cfg.idealHigh) return 1;
    if (r < cfg.idealLow) return Math.max(0, r / cfg.idealLow);
    if (r >= cfg.outerHigh) return 0;
    return Math.max(0, 1 - (r - cfg.idealHigh) / (cfg.outerHigh - cfg.idealHigh));
}

/**
 * 公平性子分数 ∈ [0, 1]
 */
export function fairnessSubscore(row) {
    if (!row) return 0;
    const w = OBJECTIVE_CONFIG.subscoreWeights.fairness;
    const noMoveScore = 1 - clamp01(row.noMoveRate);
    const skillScore = clamp01((Number(row.firstMoveFreedomMean) || 0) / 12);
    const fallbackScore = 1 - clamp01((Number(row.fallbackRate) || 0) * 8);
    return clamp01(noMoveScore * w.noMove + skillScore * w.skill + fallbackScore * w.fallback);
}

/**
 * 爽点子分数 ∈ [0, 1]
 */
export function excitementSubscore(row) {
    if (!row) return 0;
    const w = OBJECTIVE_CONFIG.subscoreWeights.excitement;
    const clearsScore = clamp01((Number(row.clearsMean) || 0) / 40);
    const multiClearScore = clamp01((Number(row.multiClearRate) || 0) * 2);
    const pacingP90 = Number(row.clearIntervalP90) || 0;
    const pacingScore = 1 - clamp01(Math.max(0, pacingP90 - 5) / 10);
    return clamp01(clearsScore * w.clears + multiClearScore * w.multiClear + pacingScore * w.pacing);
}

/**
 * 抑制膨胀子分数 ∈ [0, 1]，与 bestScore 联动 (新手宽松,顶尖严格)。
 *
 * @param {object} row 评估行
 * @param {number} bestScore 上下文 bestScore
 */
export function antiInflationSubscore(row, bestScore) {
    if (!row) return 0;
    const w = OBJECTIVE_CONFIG.subscoreWeights.antiInflation;
    const tolerance = overshootTolerance(bestScore);
    const overshootRate = clamp01(Number(row.overshootRate) || 0);
    // 二次衰减: 在容忍度内 = 1, 严重超过 = 0
    const ratio = overshootRate / Math.max(tolerance, EPS);
    const overshootScore = Math.max(0, 1 - ratio * ratio);
    const breakScore = breakHealthScore(row.breakPbRate);
    return clamp01(overshootScore * w.overshoot + breakScore * w.breakHealth);
}

/**
 * 归一化权重: 全 0 时回退到等权
 */
function normalizeWeights(weights) {
    const f = Math.max(0, Number(weights?.fairness) || 0);
    const e = Math.max(0, Number(weights?.excitement) || 0);
    const a = Math.max(0, Number(weights?.antiInflation) || 0);
    const total = f + e + a;
    if (total <= EPS) {
        return { fairness: 1 / 3, excitement: 1 / 3, antiInflation: 1 / 3 };
    }
    return { fairness: f / total, excitement: e / total, antiInflation: a / total };
}

/**
 * 获取生命周期权重乘子。未知阶段回退到 growth (中性)。
 */
export function lifecycleMultiplier(lifecycle) {
    if (VALID_LIFECYCLES.includes(lifecycle)) {
        return OBJECTIVE_CONFIG.lifecycle[lifecycle];
    }
    return OBJECTIVE_CONFIG.lifecycle.growth;
}

/**
 * 计算上下文条件化目标 J(θ|c)。
 *
 * @param {object} row - 单次评估输出
 * @param {object} context - { difficulty, generator, bestScore, lifecycle }
 * @param {object} weights - { fairness, excitement, antiInflation }
 * @returns {{
 *   fairness: number,
 *   excitement: number,
 *   antiInflation: number,
 *   composite: number,
 *   breakdown: {
 *     normalizedWeights: object,
 *     lifecycleMultipliers: object,
 *     subscoreContributions: object,
 *     overshootTolerance: number,
 *   }
 * }}
 */
export function computeObjective(row, context, weights) {
    const bestScore = Number(context?.bestScore) || 1000;
    const lifecycle = context?.lifecycle || 'growth';

    const fairness = fairnessSubscore(row);
    const excitement = excitementSubscore(row);
    const antiInflation = antiInflationSubscore(row, bestScore);

    const w = normalizeWeights(weights);
    const m = lifecycleMultiplier(lifecycle);

    // 复合分数 = w_i × m_i × subscore_i (各分量乘子 × 权重 × 子分)
    // 再除以 Σ(w_i × m_i) 保证 composite ∈ [0, 1]
    const numerator = (
        w.fairness * m.fairness * fairness
        + w.excitement * m.excitement * excitement
        + w.antiInflation * m.antiInflation * antiInflation
    );
    const denominator = (
        w.fairness * m.fairness
        + w.excitement * m.excitement
        + w.antiInflation * m.antiInflation
    );
    const composite = denominator > EPS ? numerator / denominator : 0;

    return {
        fairness: Number(fairness.toFixed(6)),
        excitement: Number(excitement.toFixed(6)),
        antiInflation: Number(antiInflation.toFixed(6)),
        composite: Number(clamp01(composite).toFixed(6)),
        breakdown: {
            normalizedWeights: w,
            lifecycleMultipliers: m,
            subscoreContributions: {
                fairness: Number((w.fairness * m.fairness * fairness).toFixed(6)),
                excitement: Number((w.excitement * m.excitement * excitement).toFixed(6)),
                antiInflation: Number((w.antiInflation * m.antiInflation * antiInflation).toFixed(6)),
            },
            overshootTolerance: Number(overshootTolerance(bestScore).toFixed(6)),
        },
    };
}
