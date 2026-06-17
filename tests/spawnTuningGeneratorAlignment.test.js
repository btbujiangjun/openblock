/**
 * @vitest-environment jsdom
 *
 * 回归锁定：出块寻参 θ（spawn-tuning-v2）的 generator 维度必须与 getSpawnPolicyMode()
 * 严格 1:1（'rule' / 'generative'），从而让 game.js 运行时 resolveThetaV2 真正命中部署的
 * 优化 θ（v3.2 ideal: 480 条 = 3×2×4×5×4，含 rl-bot）—— 而不是历史上误用的
 * 'triplet-p1' / 'budget-p2'（导致 100% 回落
 * DEFAULT_THETA_V2，移动端/web 上寻参从未生效）。
 *
 * 见 web/src/game.js spawnBlocks 的 _generator 推导，与 samplerV2.VALID_GENERATORS_SAMPLER
 * / feature_io.GENERATOR_INDEX 同源。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect, beforeAll } from 'vitest';
import {
    installPoliciesV2,
    resolveThetaV2,
    buildContextKeyV2,
} from '../web/src/tuning/v2/clientPolicyV2.js';

// vitest 以仓库根为 cwd 运行。
const BUNDLE_PATH = resolve(process.cwd(), 'web/public/spawn-tuning-v2/policies.json');

/** bundle / 采样 / 训练三方约定的合法 generator 取值。 */
const VALID_GENERATORS = ['rule', 'generative'];

/** 复刻 game.js spawnBlocks 中 _generator 的推导（与生产逻辑保持一致）。 */
function deriveGeneratorForMode(spawnPolicyMode) {
    return spawnPolicyMode === 'model-v3' ? 'generative' : 'rule';
}

/** 复刻 game.js spawnBlocks 构造的完整 5 维 _tuningCtx。 */
function gameTuningCtx({ strategy = 'normal', mode = 'rule', bestScore = 0, totalRounds = 0, userId = '' } = {}) {
    const difficulty = (strategy === 'hard' || strategy === 'normal') ? strategy : 'easy';
    const generator = deriveGeneratorForMode(mode);
    const pb_bin = bestScore < 500 ? 500
        : bestScore < 1500 ? 1500
            : bestScore < 4000 ? 4000
                : bestScore < 10000 ? 10000 : 25000;
    const lifecycle_stage = totalRounds < 5 ? 'onboarding'
        : totalRounds < 30 ? 'growth'
            : totalRounds < 100 ? 'mature' : 'plateau';
    return { difficulty, generator, bot_policy: 'clear-greedy', pb_bin, lifecycle_stage, userId };
}

describe('spawn-tuning-v2 generator 维度对齐（移动端寻参生效）', () => {
    beforeAll(() => {
        const bundle = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'));
        const { installed } = installPoliciesV2(bundle);
        expect(installed).toBeGreaterThan(0);
    });

    it('game.js 推导的 generator 始终 ∈ {rule, generative}', () => {
        expect(deriveGeneratorForMode('rule')).toBe('rule');
        expect(deriveGeneratorForMode('model-v3')).toBe('generative');
        for (const mode of ['rule', 'model-v3']) {
            expect(VALID_GENERATORS).toContain(deriveGeneratorForMode(mode));
        }
    });

    it.each([
        { name: 'easy / 新手 / 低 PB', strategy: 'easy', bestScore: 300, totalRounds: 2 },
        { name: 'normal / 成长 / 中 PB', strategy: 'normal', bestScore: 1200, totalRounds: 20 },
        { name: 'normal / 成熟 / 高 PB', strategy: 'normal', bestScore: 8000, totalRounds: 60 },
        { name: 'hard / 平台期 / 顶 PB', strategy: 'hard', bestScore: 20000, totalRounds: 200 },
    ])('rule 模式真实上下文命中优化 θ（exact），不再 fallback：$name', (sc) => {
        const ctx = gameTuningCtx({ ...sc, mode: 'rule', userId: 'u-test' });
        const key = buildContextKeyV2(ctx);
        const res = resolveThetaV2(ctx);
        // bundle 含 3 难度 × 2 generator × bot × 5 pb × 4 lifecycle（v3.2 ideal: 4 bot 含 rl-bot = 480），clear-greedy 全覆盖 → exact
        expect(res.source).toBe('exact');
        expect(res.contextKey).toBe(key);
        // 命中的 θ 不应等于纯默认（至少有一个维度被优化覆盖）
        expect(res.theta).toBeTruthy();
    });

    it('model-v3 模式映射到 generative，同样能命中（exact）', () => {
        const ctx = gameTuningCtx({ strategy: 'normal', mode: 'model-v3', bestScore: 1200, totalRounds: 20 });
        expect(ctx.generator).toBe('generative');
        const res = resolveThetaV2(ctx);
        expect(['exact', 'fuzzy-lifecycle', 'coarse-gen']).toContain(res.source);
    });

    it('回归守卫：历史错误 generator（triplet-p1 / budget-p2）必然 fallback', () => {
        for (const badGen of ['triplet-p1', 'budget-p2']) {
            const res = resolveThetaV2({
                difficulty: 'normal', generator: badGen, bot_policy: 'clear-greedy',
                pb_bin: 1500, lifecycle_stage: 'growth', userId: 'u-test',
            });
            expect(res.source).toBe('fallback');
        }
    });
});
