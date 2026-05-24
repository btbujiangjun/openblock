/**
 * 寻参上下文空间 — 定义 (难度, 生成器, bestScore档, 生命周期阶段) 4 维 context。
 *
 * 设计依据：docs/algorithms/SPAWN_AUTO_TUNING.md §2
 *
 * 关键约定：
 *   - 难度: 'easy' | 'normal' | 'hard'  (与 spawnEvaluation SPAWN_EVAL_STRATEGIES 对齐)
 *   - 生成器: 'triplet-p1' | 'budget-p2'  (baseline 作为对照基线,不在寻参空间)
 *   - bestScore 档: 500 | 1500 | 4000 | 10000 | 25000  (log-uniform 覆盖)
 *   - 生命周期: 'onboarding' | 'growth' | 'mature' | 'plateau'
 *
 * 总 context 数: 3 × 2 × 5 × 4 = 120
 */

export const DIFFICULTIES = Object.freeze(['easy', 'normal', 'hard']);
export const GENERATORS = Object.freeze(['triplet-p1', 'budget-p2']);
export const BEST_SCORE_BINS = Object.freeze([500, 1500, 4000, 10000, 25000]);
export const LIFECYCLE_STAGES = Object.freeze(['onboarding', 'growth', 'mature', 'plateau']);

/**
 * 生命周期判定阈值 (与 docs §2.2 一致)
 */
export const LIFECYCLE_THRESHOLDS = Object.freeze({
    onboardingMaxRounds: 20,
    growthMaxRounds: 200,
    matureMaxRounds: 1000,
    plateauDaysSincePb: 7,
});

/**
 * bestScore 分档边界 (与 docs §2.3 一致)
 *
 * 分档逻辑: 落在 [边界_i, 边界_{i+1}) 内归到 bin BEST_SCORE_BINS[i]
 */
const BEST_SCORE_BOUNDS = Object.freeze([0, 750, 2500, 7000, 17000, Infinity]);

/**
 * 把原始 bestScore 映射到 5 档 (log-uniform)。
 *
 * @param {number} bestScore - 原始 PB 分数
 * @returns {number} 5 个 bin 之一
 */
export function getBestScoreBin(bestScore) {
    const v = Number(bestScore) || 0;
    for (let i = 0; i < BEST_SCORE_BINS.length; i++) {
        if (v < BEST_SCORE_BOUNDS[i + 1]) return BEST_SCORE_BINS[i];
    }
    return BEST_SCORE_BINS[BEST_SCORE_BINS.length - 1];
}

/**
 * 把 (totalRounds, daysSincePb) 映射到 4 阶段。
 *
 * 优先级 (从前到后):
 *   1. totalRounds < 20         → 'onboarding'
 *   2. totalRounds < 200        → 'growth'
 *   3. daysSincePb > 7 (任何 rounds 数) → 'plateau'
 *   4. totalRounds < 1000       → 'mature'
 *   5. else                     → 'mature'
 *
 * 注意 plateau 优先级高于 mature: 玩家 PB 7+ 天没破即视为平台期,不论局数。
 *
 * @param {number} totalRounds - 累计游戏局数
 * @param {number} daysSincePb - 距上次破 PB 的天数 (无 PB 则传 0 或 NaN)
 * @returns {string} 4 个阶段之一
 */
export function getLifecycleStage(totalRounds, daysSincePb) {
    const rounds = Math.max(0, Number(totalRounds) || 0);
    const days = Math.max(0, Number(daysSincePb) || 0);
    if (rounds < LIFECYCLE_THRESHOLDS.onboardingMaxRounds) return 'onboarding';
    if (rounds < LIFECYCLE_THRESHOLDS.growthMaxRounds) return 'growth';
    if (days > LIFECYCLE_THRESHOLDS.plateauDaysSincePb) return 'plateau';
    return 'mature';
}

/**
 * 把 context 拼成稳定的字符串 key (用于 SQLite UNIQUE 索引 / 查表 Map 键)。
 *
 * 格式: '<difficulty>:<generator>:<bestScore_bin>:<lifecycle_stage>'
 * 示例: 'normal:budget-p2:1500:growth'
 *
 * @param {object} context - { difficulty, generator, bestScore_bin, lifecycle_stage }
 * @returns {string}
 */
export function makeContextKey(context) {
    if (!context) throw new Error('makeContextKey: context required');
    const diff = String(context.difficulty);
    const gen = String(context.generator);
    const bin = Number(context.bestScore_bin);
    const life = String(context.lifecycle_stage);
    return `${diff}:${gen}:${bin}:${life}`;
}

/**
 * 解析 context key 回结构体 (用于读 SQLite 行)。
 *
 * @param {string} key
 * @returns {{ difficulty, generator, bestScore_bin, lifecycle_stage }}
 */
export function parseContextKey(key) {
    if (typeof key !== 'string') throw new Error('parseContextKey: key must be string');
    const parts = key.split(':');
    if (parts.length !== 4) throw new Error(`parseContextKey: malformed key ${key}`);
    const [difficulty, generator, binStr, lifecycle_stage] = parts;
    const bestScore_bin = Number(binStr);
    if (!Number.isFinite(bestScore_bin)) throw new Error(`parseContextKey: bad bin ${binStr}`);
    return { difficulty, generator, bestScore_bin, lifecycle_stage };
}

/**
 * 校验 context 是否在合法空间内 (用于 sampleStore 写入前验证)。
 *
 * @returns {{ ok: boolean, error?: string }}
 */
export function validateContext(context) {
    if (!context) return { ok: false, error: 'context is null' };
    if (!DIFFICULTIES.includes(context.difficulty)) {
        return { ok: false, error: `invalid difficulty: ${context.difficulty}` };
    }
    if (!GENERATORS.includes(context.generator)) {
        return { ok: false, error: `invalid generator: ${context.generator}` };
    }
    if (!BEST_SCORE_BINS.includes(Number(context.bestScore_bin))) {
        return { ok: false, error: `invalid bestScore_bin: ${context.bestScore_bin}` };
    }
    if (!LIFECYCLE_STAGES.includes(context.lifecycle_stage)) {
        return { ok: false, error: `invalid lifecycle_stage: ${context.lifecycle_stage}` };
    }
    return { ok: true };
}

/**
 * 枚举所有合法 context (返回 120 个的笛卡尔积)。
 *
 * @returns {Array<{difficulty, generator, bestScore_bin, lifecycle_stage}>}
 */
export function enumerateAllContexts() {
    const all = [];
    for (const difficulty of DIFFICULTIES) {
        for (const generator of GENERATORS) {
            for (const bestScore_bin of BEST_SCORE_BINS) {
                for (const lifecycle_stage of LIFECYCLE_STAGES) {
                    all.push({ difficulty, generator, bestScore_bin, lifecycle_stage });
                }
            }
        }
    }
    return all;
}

/**
 * 取出 context 中"实际用来评估"的字段:
 * - difficulty / generator 直接传给 spawnEvaluation
 * - bestScore_bin 作为评估时的 bestScore 输入
 * - lifecycle_stage 不传给评估器 (它只影响目标函数加权)
 *
 * @returns {{strategy, spawnGenerator, bestScore}}
 */
export function contextToEvalParams(context) {
    return {
        strategy: context.difficulty,
        spawnGenerator: context.generator,
        bestScore: context.bestScore_bin,
    };
}

/**
 * Context 空间总数 (常量但留接口便于后续扩展)
 */
export function getContextSpaceSize() {
    return DIFFICULTIES.length * GENERATORS.length * BEST_SCORE_BINS.length * LIFECYCLE_STAGES.length;
}
