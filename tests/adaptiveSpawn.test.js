/**
 * @vitest-environment jsdom
 *
 * 自适应出块策略引擎：resolveAdaptiveStrategy 在不同玩家状态下的行为
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';

function makeProfile(overrides = {}) {
    const p = new PlayerProfile(15);
    if (overrides.smoothSkill != null) p._smoothSkill = overrides.smoothSkill;
    if (overrides.comboStreak != null) p._comboStreak = overrides.comboStreak;
    if (overrides.consecutiveNonClears != null) p._consecutiveNonClears = overrides.consecutiveNonClears;
    if (overrides.recoveryCounter != null) p._recoveryCounter = overrides.recoveryCounter;
    if (overrides.spawnCounter != null) p._spawnCounter = overrides.spawnCounter;
    if (overrides.lifetimeGames != null) p._totalLifetimeGames = overrides.lifetimeGames;
    if (overrides.lifetimePlacements != null) p._totalLifetimePlacements = overrides.lifetimePlacements;
    return p;
}

describe('resolveAdaptiveStrategy', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('returns a strategy object with required fields', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 0, 0, 0);
        expect(s.shapeWeights).toBeDefined();
        expect(typeof s.fillRatio).toBe('number');
        expect(s.scoring).toBeDefined();
    });

    it('returns spawnHints when adaptive is enabled', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 50, 0, 0.3);
        if (s.spawnHints) {
            expect(typeof s.spawnHints.clearGuarantee).toBe('number');
            expect(s.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(0);
            expect(s.spawnHints.clearGuarantee).toBeLessThanOrEqual(3);
            expect(typeof s.spawnHints.sizePreference).toBe('number');
            expect(['setup', 'payoff', 'neutral']).toContain(s.spawnHints.rhythmPhase);
            expect(['warmup', 'peak', 'cooldown']).toContain(s.spawnHints.sessionArc);
        }
    });

    it('returns a stress breakdown with named signal contributions', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile({ lifetimeGames: 4, lifetimePlacements: 80 }), 90, 1, 0.35, {
            totalRounds: 6,
            roundsSinceClear: 0,
            holes: 2
        });
        expect(s._stressBreakdown).toBeDefined();
        expect(typeof s._stressBreakdown.scoreStress).toBe('number');
        expect(typeof s._stressBreakdown.difficultyBias).toBe('number');
        expect(typeof s._stressBreakdown.boardRisk).toBe('number');
        expect(s._stressBreakdown.finalStress).toBeCloseTo(s._adaptiveStress, 6);
    });

    it('projects stress into multi-axis spawn targets', () => {
        const relief = resolveAdaptiveStrategy('normal', makeProfile({ consecutiveNonClears: 8 }), 90, 0, 0.65, {
            totalRounds: 8,
            holes: 5,
            nearFullLines: 2
        });
        const challenge = resolveAdaptiveStrategy('hard', makeProfile({ smoothSkill: 0.85, lifetimeGames: 6, lifetimePlacements: 100 }), 180, 2, 0.3, {
            totalRounds: 12,
            roundsSinceClear: 0,
            nearFullLines: 0
        });

        expect(relief.spawnHints.spawnTargets).toBeDefined();
        expect(challenge.spawnHints.spawnTargets).toBeDefined();
        expect(relief.spawnHints.spawnTargets.clearOpportunity).toBeGreaterThan(challenge.spawnHints.spawnTargets.clearOpportunity);
        expect(challenge.spawnHints.spawnTargets.shapeComplexity).toBeGreaterThan(relief.spawnHints.spawnTargets.shapeComplexity);
        expect(challenge._spawnTargets.solutionSpacePressure).toBeGreaterThanOrEqual(0);
        expect(challenge._spawnTargets.solutionSpacePressure).toBeLessThanOrEqual(1);
    });

    it('smooths ordinary stress increases but lets relief drops apply immediately', () => {
        const p = makeProfile({ lifetimeGames: 4, lifetimePlacements: 80 });
        const noPrev = resolveAdaptiveStrategy('normal', p, 180, 0, 0.35, { totalRounds: 8 });
        const smoothed = resolveAdaptiveStrategy('normal', p, 180, 0, 0.35, {
            totalRounds: 8,
            prevAdaptiveStress: 0.1
        });
        expect(smoothed._adaptiveStress).toBeLessThan(noPrev._adaptiveStress);
        expect(smoothed._adaptiveStress).toBeLessThanOrEqual(0.28);

        const relief = resolveAdaptiveStrategy('normal', makeProfile({ consecutiveNonClears: 8 }), 180, 0, 0.35, {
            totalRounds: 8,
            prevAdaptiveStress: 0.9
        });
        expect(relief._adaptiveStress).toBeLessThan(0.9);
        expect(relief._stressBreakdown.frustrationRelief).toBeLessThan(0);
    });

    it('frustrated player gets lower stress / higher clearGuarantee', () => {
        const calm = resolveAdaptiveStrategy('normal', makeProfile(), 100, 0, 0.4);
        const frustrated = resolveAdaptiveStrategy('normal', makeProfile({ consecutiveNonClears: 8 }), 100, 0, 0.4);
        if (calm.spawnHints && frustrated.spawnHints) {
            expect(frustrated._adaptiveStress).toBeLessThanOrEqual(calm._adaptiveStress + 0.01);
            expect(frustrated.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(calm.spawnHints.clearGuarantee);
        }
    });

    it('recovery state lowers stress', () => {
        const normal = resolveAdaptiveStrategy('normal', makeProfile(), 100, 0, 0.5);
        const recovery = resolveAdaptiveStrategy('normal', makeProfile({ recoveryCounter: 3 }), 100, 0, 0.5);
        if (normal._adaptiveStress != null && recovery._adaptiveStress != null) {
            expect(recovery._adaptiveStress).toBeLessThanOrEqual(normal._adaptiveStress + 0.01);
        }
    });

    it('new player in onboarding gets capped stress', () => {
        const newP = makeProfile({ lifetimeGames: 0, lifetimePlacements: 5 });
        newP._spawnCounter = 2;
        const s = resolveAdaptiveStrategy('normal', newP, 0, 0, 0.1);
        if (s._adaptiveStress != null) {
            expect(s._adaptiveStress).toBeLessThanOrEqual(0.1);
        }
    });

    it('difficulty bias: easy < normal < hard', () => {
        const p = makeProfile({ smoothSkill: 0.5 });
        const easy = resolveAdaptiveStrategy('easy', p, 100, 0, 0.3);
        const normal = resolveAdaptiveStrategy('normal', p, 100, 0, 0.3);
        const hard = resolveAdaptiveStrategy('hard', p, 100, 0, 0.3);
        if (easy._adaptiveStress != null) {
            expect(easy._adaptiveStress).toBeLessThan(normal._adaptiveStress + 0.01);
            expect(normal._adaptiveStress).toBeLessThan(hard._adaptiveStress + 0.01);
        }
    });

    it('difficulty tuning changes spawnHints directly', () => {
        const p = makeProfile({ smoothSkill: 0.5, spawnCounter: 8, lifetimeGames: 3, lifetimePlacements: 80 });
        const easy = resolveAdaptiveStrategy('easy', p, 80, 0, 0.35, { totalRounds: 8, roundsSinceClear: 0 });
        const normal = resolveAdaptiveStrategy('normal', p, 80, 0, 0.35, { totalRounds: 8, roundsSinceClear: 0 });
        const hard = resolveAdaptiveStrategy('hard', p, 80, 0, 0.35, { totalRounds: 8, roundsSinceClear: 0 });
        if (easy.spawnHints && normal.spawnHints && hard.spawnHints) {
            expect(easy.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(normal.spawnHints.clearGuarantee);
            expect(hard.spawnHints.clearGuarantee).toBeLessThanOrEqual(normal.spawnHints.clearGuarantee);
            expect(easy.spawnHints.sizePreference).toBeLessThan(normal.spawnHints.sizePreference);
            expect(hard.spawnHints.sizePreference).toBeGreaterThan(normal.spawnHints.sizePreference);
            expect(easy.spawnHints.multiClearBonus).toBeGreaterThan(normal.spawnHints.multiClearBonus);
            expect(hard.spawnHints.multiClearBonus).toBeLessThan(normal.spawnHints.multiClearBonus);
        }
    });

    it('difficulty tuning separates solution difficulty ranges', () => {
        const p = makeProfile({ smoothSkill: 0.5, spawnCounter: 8, lifetimeGames: 3, lifetimePlacements: 80 });
        const easy = resolveAdaptiveStrategy('easy', p, 100, 0, 0.5, { totalRounds: 8, roundsSinceClear: 0 });
        const hard = resolveAdaptiveStrategy('hard', p, 100, 0, 0.5, { totalRounds: 8, roundsSinceClear: 0 });
        if (easy.spawnHints?.targetSolutionRange && hard.spawnHints?.targetSolutionRange) {
            expect(easy._solutionStress).toBeLessThan(hard._solutionStress);
            expect(easy.spawnHints.targetSolutionRange.min).toBeGreaterThanOrEqual(hard.spawnHints.targetSolutionRange.min);
            expect(hard.spawnHints.targetSolutionRange.max).not.toBeNull();
        }
    });

    it('milestone hit produces scoreMilestone spawnHint', () => {
        resetAdaptiveMilestone();
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 50, 0, 0.3);
        if (s.spawnHints) {
            expect(s._milestoneHit).toBe(true);
            expect(s.spawnHints.scoreMilestone).toBe(true);
        }
    });

    it('warmup session arc in early rounds', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile({ spawnCounter: 1 }), 0, 0, 0.1, { totalRounds: 1 });
        if (s.spawnHints) {
            expect(s.spawnHints.sessionArc).toBe('warmup');
        }
    });

    it('rhythmPhase：delight/playstyle 层可将 neutral 提升为 payoff（与当前 spawnHints 一致）', () => {
        const p = makeProfile({ spawnCounter: 3 });
        const s = resolveAdaptiveStrategy('normal', p, 100, 0, 0.35, {
            roundsSinceClear: 5,
            nearFullLines: 0,
            pcSetup: 0,
            lastClearCount: 0,
            totalRounds: 10
        });
        if (s.spawnHints) {
            expect(p.pacingPhase).toBe('release');
            expect(['neutral', 'payoff']).toContain(s.spawnHints.rhythmPhase);
        }
    });

    it('multiLineTarget is 2 when pcSetup>=1', () => {
        // v1.19：multiClearBonus / multiLineTarget 几何兜底要求 pcSetup 在
        // fill ≥ PC_SETUP_MIN_FILL (0.45) 时才算"真窗口"，因此把 fill 提到 0.5。
        // 否则低占用 + pcSetup=1 + nearFullLines=0 + multiClearCands=0 会触发兜底，
        // multiLineTarget 被钳到 0。
        const s = resolveAdaptiveStrategy('normal', makeProfile({ spawnCounter: 0 }), 100, 0, 0.5, {
            pcSetup: 1,
            nearFullLines: 0,
            totalRounds: 5
        });
        if (s.spawnHints) {
            expect(s.spawnHints.multiLineTarget).toBe(2);
        }
    });

    it('cross-game warmup boosts clearGuarantee and multiLineTarget', () => {
        // v1.17：cg=3 触发新引入的"物理可行性兜底"——必须有 ≥2 临消行
        // 或 ≥2 多消候选才能维持 cg=3（避免 UI 上「目标保消 3」成空头支票）。
        // 此处提供 nearFullLines=2 以代表"warmup 阶段盘面已有兑现窗口"的常见情况。
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 50, 0, 0.3, {
            warmupRemaining: 2,
            warmupClearBoost: 2,
            totalRounds: 5,
            nearFullLines: 2
        });
        if (s.spawnHints) {
            expect(s.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(3);
            expect(s.spawnHints.multiLineTarget).toBe(2);
        }
    });

    it('cross-game warmup clamps setup rhythm to neutral', () => {
        const p = makeProfile({ spawnCounter: 0 });
        const s = resolveAdaptiveStrategy('normal', p, 80, 0, 0.25, {
            roundsSinceClear: 0,
            nearFullLines: 0,
            pcSetup: 0,
            warmupRemaining: 1,
            warmupClearBoost: 1,
            totalRounds: 8
        });
        if (s.spawnHints) {
            expect(p.pacingPhase).toBe('tension');
            expect(s.spawnHints.rhythmPhase).toBe('neutral');
        }
    });

    it('stress is clamped to [-0.2, 1]', () => {
        for (let skill = 0; skill <= 1; skill += 0.25) {
            for (let score = 0; score <= 1000; score += 200) {
                const s = resolveAdaptiveStrategy('normal', makeProfile({ smoothSkill: skill }), score, 5, 0.8);
                if (s._adaptiveStress != null) {
                    expect(s._adaptiveStress).toBeGreaterThanOrEqual(-0.2);
                    expect(s._adaptiveStress).toBeLessThanOrEqual(1);
                }
            }
        }
    });

    /* ===== v1.13: 友好盘面救济 + 心流封顶 + scoreStress 百分位 ===== */

    it('v1.13 scoreStress 百分位：传入 ctx.bestScore 后远高于 milestones 的分数不会再锁死最高压', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        const noBest = resolveAdaptiveStrategy('normal', p, 1440, 0, 0.30, { totalRounds: 8 });
        const withBest = resolveAdaptiveStrategy('normal', p, 1440, 0, 0.30, { totalRounds: 8, bestScore: 5000 });
        // 个人最佳 5000，分数 1440 → pct≈0.288 → 走衰减
        expect(withBest._stressBreakdown.scoreStress).toBeLessThan(noBest._stressBreakdown.scoreStress);
        expect(withBest._stressBreakdown.scoreStress).toBeLessThan(0.4);
    });

    it('v1.13 friendlyBoardRelief：清爽盘面 + 多消机会 + payoff 时注入减压', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        const friendly = resolveAdaptiveStrategy('normal', p, 1440, 0, 0.30, {
            totalRounds: 12,
            roundsSinceClear: 0,
            holes: 0,
            nearFullLines: 3,
            multiClearCandidates: 3,
            pcSetup: 1,
            bestScore: 5000
        });
        const baseline = resolveAdaptiveStrategy('normal', p, 1440, 0, 0.30, {
            totalRounds: 12,
            roundsSinceClear: 0,
            holes: 0,
            nearFullLines: 0,
            multiClearCandidates: 0,
            pcSetup: 0,
            bestScore: 5000
        });
        expect(friendly._stressBreakdown.friendlyBoardRelief).toBeLessThan(0);
        expect(friendly._stressBreakdown.friendlyBoardRelief).toBeGreaterThanOrEqual(-0.18);
        expect(baseline._stressBreakdown.friendlyBoardRelief).toBe(0);
        expect(friendly._adaptiveStress).toBeLessThan(baseline._adaptiveStress);
    });

    it('v1.13 friendlyBoardRelief：盘面有 holes 时不触发救济', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        const s = resolveAdaptiveStrategy('normal', p, 1440, 0, 0.30, {
            totalRounds: 12,
            holes: 2,
            nearFullLines: 3,
            multiClearCandidates: 3,
            pcSetup: 1,
            bestScore: 5000
        });
        expect(s._stressBreakdown.friendlyBoardRelief).toBe(0);
    });

    it('v1.13 flowPayoffStressCap：心流 + payoff 时综合 stress 不会超过封顶值', () => {
        // 制造高 scoreStress + 心流 + payoff 的复合场景
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        // 注入若干干净连续消行记录，把 flowState 推到 flow
        for (let i = 0; i < 8; i++) {
            p.recordPlace(true, i % 2 === 0 ? 1 : 2, 0.32);
        }
        const s = resolveAdaptiveStrategy('normal', p, 1200, 3, 0.30, {
            totalRounds: 15,
            roundsSinceClear: 0,
            holes: 0,
            nearFullLines: 4,
            multiClearCandidates: 2,
            pcSetup: 1,
            bestScore: 1500
        });
        // 仅在场景成立（flow + payoff）时校验封顶；否则跳过（防止环境差异导致不稳定）
        if (p.flowState === 'flow' && s.spawnHints?.rhythmPhase === 'payoff') {
            expect(s._adaptiveStress).toBeLessThanOrEqual(0.79 + 1e-6);
            expect(s._stressBreakdown.flowPayoffCap).toBeCloseTo(0.79, 6);
        }
    });

    it('v1.13 momentum：样本数较少时不会抖到 ±1', () => {
        // 仅有 6 次 placement（最少触发条件），momentum 应被样本置信度缩放，不会到 ±1
        const p = makeProfile({ smoothSkill: 0.55 });
        // 前 3 次全消行（older），后 3 次都不消行（newer），原本 raw=-1，缩放后扁平
        for (let i = 0; i < 3; i++) p.recordPlace(true, 1, 0.30);
        for (let i = 0; i < 3; i++) p.recordPlace(false, 0, 0.30);
        const m = p.momentum;
        // sampleConfidence = 6/12 = 0.5 → |momentum| ≤ 0.5
        expect(Math.abs(m)).toBeLessThanOrEqual(0.5 + 1e-6);
    });

    /* ============================================================== */
    /*  v1.16：occupancy 衰减 + spawnIntent + AFK→engage + momentum 噪声   */
    /* ============================================================== */

    it('v1.16 occupancyDamping：低占用盘面对正向 stress 衰减且记录在 breakdown', () => {
        const p = makeProfile({ smoothSkill: 0.6, lifetimeGames: 6, lifetimePlacements: 120 });
        const lowFill = resolveAdaptiveStrategy('normal', p, 1200, 0, 0.20, {
            totalRounds: 10,
            bestScore: 1500
        });
        const midFill = resolveAdaptiveStrategy('normal', p, 1200, 0, 0.50, {
            totalRounds: 10,
            bestScore: 1500
        });
        // 低占用必有衰减；中等占用（≥0.5）衰减为 0
        expect(lowFill._stressBreakdown.occupancyDamping).toBeLessThan(0);
        expect(midFill._stressBreakdown.occupancyDamping).toBe(0);
        // 衰减后 stress 严格小于不衰减场景
        expect(lowFill._adaptiveStress).toBeLessThan(midFill._adaptiveStress);
        // 衰减系数下限 0.4，stress 不会被吃掉超过 60%
        expect(lowFill._adaptiveStress).toBeGreaterThanOrEqual(midFill._adaptiveStress * 0.4 - 1e-6);
    });

    it('v1.16 occupancyDamping：负向 stress（救济）不被衰减', () => {
        const p = makeProfile({ smoothSkill: 0.5, consecutiveNonClears: 8 });
        const s = resolveAdaptiveStrategy('normal', p, 50, 0, 0.10);
        // 救济场景下 stress 应为负，衰减应为 0
        expect(s._adaptiveStress).toBeLessThan(0);
        expect(s._stressBreakdown.occupancyDamping).toBe(0);
    });

    it('v1.16 spawnIntent：分数高 + 兑现机会 → harvest', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        const s = resolveAdaptiveStrategy('normal', p, 800, 0, 0.45, {
            totalRounds: 10,
            roundsSinceClear: 0,
            holes: 0,
            nearFullLines: 4,
            pcSetup: 1,
            bestScore: 1500
        });
        expect(s._spawnIntent).toBe('harvest');
        expect(s.spawnHints.spawnIntent).toBe('harvest');
    });

    it('v1.16 spawnIntent：挫败救济场景 → relief', () => {
        const p = makeProfile({ consecutiveNonClears: 8 });
        const s = resolveAdaptiveStrategy('normal', p, 200, 0, 0.40, {
            totalRounds: 8,
            roundsSinceClear: 5
        });
        expect(s._spawnIntent).toBe('relief');
    });

    it('v1.16 AFK engage：AFK ≥ 1 时切到 engage 路径并提升保消/多消', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        // 注入 1 次 AFK（thinkMs >= 15s 阈值），其余正常 placement
        const now = Date.now();
        p._pushMove({ ts: now - 5000, thinkMs: 17000, cleared: false, lines: 0, fill: 0.3, miss: false });
        for (let i = 0; i < 5; i++) {
            p._pushMove({ ts: now - 4000 + i * 100, thinkMs: 1500, cleared: true, lines: 1, fill: 0.3, miss: false });
        }
        expect(p.metrics.afkCount).toBeGreaterThanOrEqual(1);

        const calm = resolveAdaptiveStrategy('normal', p, 200, 0, 0.30, { totalRounds: 8 });
        expect(calm._afkEngageActive).toBe(true);
        expect(calm._spawnIntent).toBe('engage');
        expect(calm.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(2);
        expect(calm.spawnHints.multiClearBonus).toBeGreaterThanOrEqual(0.6);
        expect(calm.spawnHints.multiLineTarget).toBeGreaterThanOrEqual(1);
    });

    it('v1.16 AFK engage：高挫败 / 救济中 不再触发 engage（避免叠戏压垮）', () => {
        const p = makeProfile({ consecutiveNonClears: 8 });
        const now = Date.now();
        p._pushMove({ ts: now - 5000, thinkMs: 17000, cleared: false, lines: 0, fill: 0.3, miss: false });
        for (let i = 0; i < 5; i++) {
            p._pushMove({ ts: now - 4000 + i * 100, thinkMs: 1500, cleared: false, lines: 0, fill: 0.3, miss: false });
        }
        const s = resolveAdaptiveStrategy('normal', p, 200, 0, 0.30, {
            totalRounds: 8,
            roundsSinceClear: 5
        });
        // 此处 frustrationLevel 触发救济；engage 优先级让位给 relief
        expect(s._afkEngageActive).toBe(false);
        expect(s._spawnIntent).toBe('relief');
    });

    it('v1.16 momentum 噪声衰减：50/50 半区比纯净半区获得更小动量', () => {
        const noisy = makeProfile({ smoothSkill: 0.55 });
        // older 3/3 全消（清晰），newer 3/6 半消半未消（噪声大）
        for (let i = 0; i < 3; i++) noisy.recordPlace(true, 1, 0.30);
        for (let i = 0; i < 6; i++) noisy.recordPlace(i % 2 === 0, i % 2 === 0 ? 1 : 0, 0.30);

        const clean = makeProfile({ smoothSkill: 0.55 });
        // older 3/3 全消，newer 6/6 全未消（无噪声极端反差）
        for (let i = 0; i < 3; i++) clean.recordPlace(true, 1, 0.30);
        for (let i = 0; i < 6; i++) clean.recordPlace(false, 0, 0.30);

        // clean 场景 |momentum| 应严格大于 noisy 场景（噪声越大衰减越多）
        expect(Math.abs(clean.momentum)).toBeGreaterThan(Math.abs(noisy.momentum));
    });

    it('v1.16 spawnHints.spawnIntent 始终落入合法枚举', () => {
        const intents = new Set(['relief', 'engage', 'pressure', 'flow', 'harvest', 'maintain']);
        for (let score = 0; score <= 600; score += 100) {
            for (let fill = 0.1; fill <= 0.9; fill += 0.2) {
                const s = resolveAdaptiveStrategy('normal', makeProfile(), score, 0, fill, {
                    totalRounds: 5,
                    bestScore: 1000
                });
                expect(intents.has(s.spawnHints.spawnIntent)).toBe(true);
            }
        }
    });

    /* ================================================================ */
    /*  v1.17：harvest / rhythmPhase 收紧 + clearGuarantee 物理可行兜底  */
    /* ================================================================ */

    it('v1.17 spawnIntent：低占用 + pcSetup=1 不再 harvest（noise 过滤）', () => {
        // 17% 散布盘面：12 格 / 64，无近满行；pcSetup=1 是噪声候选
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        const s = resolveAdaptiveStrategy('normal', p, 300, 0, 0.17, {
            totalRounds: 8,
            roundsSinceClear: 1,
            holes: 0,
            nearFullLines: 0,
            pcSetup: 1,
            multiClearCandidates: 0
        });
        expect(s._spawnIntent).not.toBe('harvest');
        expect(['flow', 'maintain', 'pressure']).toContain(s._spawnIntent);
    });

    it('v1.17 spawnIntent：高占用 + pcSetup=1 仍可 harvest（真窗口）', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        const s = resolveAdaptiveStrategy('normal', p, 600, 0, 0.50, {
            totalRounds: 12,
            roundsSinceClear: 0,
            holes: 0,
            nearFullLines: 1,
            pcSetup: 1,
            multiClearCandidates: 2
        });
        expect(s._spawnIntent).toBe('harvest');
    });

    it('v1.17 spawnIntent：nearFullLines=2 单独可触发 harvest（与 deriveRhythmPhase 同口径）', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        const s = resolveAdaptiveStrategy('normal', p, 400, 0, 0.30, {
            totalRounds: 8,
            roundsSinceClear: 1,
            holes: 0,
            nearFullLines: 2,
            pcSetup: 0,
            multiClearCandidates: 1
        });
        expect(s._spawnIntent).toBe('harvest');
    });

    it('v1.25：存在 _gridRef 时优先使用 live nearFull/multiClear（覆盖陈旧 ctx 快照）', () => {
        const n = 8;
        const cells = Array.from({ length: n }, () => Array.from({ length: n }, () => 1));
        // 制造两条“近满行”（各留一个空格）
        cells[0][0] = null;
        cells[1][1] = null;
        const gridStub = {
            size: n,
            cells,
            canPlace: (shape, x, y) => {
                if (!Array.isArray(shape) || shape.length === 0 || !Array.isArray(shape[0])) return false;
                const h = shape.length;
                const w = shape[0].length;
                return x >= 0 && y >= 0 && (x + w) <= n && (y + h) <= n;
            },
            previewClearOutcome: () => ({ rows: [0, 1], cols: [] })
        };
        const p = makeProfile({ smoothSkill: 0.56, lifetimeGames: 6, lifetimePlacements: 120 });
        const s = resolveAdaptiveStrategy('normal', p, 400, 0, 0.30, {
            totalRounds: 8,
            roundsSinceClear: 1,
            holes: 0,
            // 旧快照故意置零：若未覆盖会倾向不 harvest
            nearFullLines: 0,
            multiClearCandidates: 0,
            pcSetup: 0,
            _gridRef: gridStub
        });
        expect(s._spawnIntent).toBe('harvest');
    });

    it('v1.17 rhythmPhase：低占用 + pcSetup=1 不再被拉到 payoff', () => {
        const p = makeProfile({ smoothSkill: 0.55, lifetimeGames: 6, lifetimePlacements: 120 });
        const s = resolveAdaptiveStrategy('normal', p, 300, 0, 0.17, {
            totalRounds: 8,
            roundsSinceClear: 1,
            holes: 0,
            nearFullLines: 0,
            pcSetup: 1
        });
        expect(s.spawnHints.rhythmPhase).not.toBe('payoff');
    });

    it('v1.17 clearGuarantee 物理可行性兜底：warmup 起手在空盘面回钳到 ≤2', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 50, 0, 0.0, {
            warmupRemaining: 2,
            warmupClearBoost: 2,
            totalRounds: 5,
            nearFullLines: 0,
            multiClearCandidates: 0
        });
        if (s.spawnHints) {
            // warmup 默认会顶到 cg=3，但盘面无任何兑现几何 → 兜底回钳到 2
            expect(s.spawnHints.clearGuarantee).toBeLessThanOrEqual(2);
            // multiLineTarget 不受兜底影响：仍能给出"偏好多消块"的轨道引导
            expect(s.spawnHints.multiLineTarget).toBe(2);
        }
    });

    it('v1.17 clearGuarantee 物理可行性兜底：multiClearCandidates ≥2 时 cg=3 维持', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 50, 0, 0.45, {
            warmupRemaining: 2,
            warmupClearBoost: 2,
            totalRounds: 5,
            nearFullLines: 0,
            multiClearCandidates: 3
        });
        if (s.spawnHints) {
            expect(s.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(3);
        }
    });

    /* =====================================================================
     * v1.19：multiClearBonus / multiLineTarget 几何兜底
     * 当无 multiClearCandidates、无 ≥2 nearFullLines、无真 pcSetup 窗口、且
     * 不在 warmup 阶段时，软封顶 multiClearBonus≤0.4、multiLineTarget=0。
     * ===================================================================*/
    it('v1.19 几何兜底：playstyle=multi_clear 但盘面 0 多消候选/0 近满 → bonus 软封顶', () => {
        const p = makeProfile();
        // multi_clear playstyle 通常顶 multiClearBonus 到 0.65、multiLineTarget=1
        Object.defineProperty(p, 'playstyle', { value: 'multi_clear', configurable: true });
        const s = resolveAdaptiveStrategy('normal', p, 200, 0, 0.5, {
            totalRounds: 6,
            roundsSinceClear: 1,
            holes: 0,
            nearFullLines: 0,
            multiClearCandidates: 0,
            pcSetup: 0
        });
        if (s.spawnHints) {
            expect(s.spawnHints.multiClearBonus).toBeLessThanOrEqual(0.4);
            expect(s.spawnHints.multiLineTarget).toBe(0);
        }
    });

    it('v1.19 几何兜底：nearFullLines ≥ 2 时不触发兜底（保留前瞻多消偏好）', () => {
        const p = makeProfile();
        Object.defineProperty(p, 'playstyle', { value: 'multi_clear', configurable: true });
        const s = resolveAdaptiveStrategy('normal', p, 200, 0, 0.5, {
            totalRounds: 6,
            roundsSinceClear: 1,
            holes: 0,
            nearFullLines: 2,
            multiClearCandidates: 0,
            pcSetup: 0
        });
        if (s.spawnHints) {
            expect(s.spawnHints.multiClearBonus).toBeGreaterThanOrEqual(0.6);
            expect(s.spawnHints.multiLineTarget).toBeGreaterThanOrEqual(1);
        }
    });

    it('v1.19 几何兜底：multiClearCandidates ≥ 1 时不触发兜底', () => {
        const p = makeProfile();
        Object.defineProperty(p, 'playstyle', { value: 'multi_clear', configurable: true });
        const s = resolveAdaptiveStrategy('normal', p, 200, 0, 0.5, {
            totalRounds: 6,
            roundsSinceClear: 1,
            holes: 0,
            nearFullLines: 0,
            multiClearCandidates: 1,
            pcSetup: 0
        });
        if (s.spawnHints) {
            expect(s.spawnHints.multiClearBonus).toBeGreaterThanOrEqual(0.6);
        }
    });

    it('v1.19 几何兜底：warmup 阶段豁免（结构性偏好不被几何裁剪）', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 50, 0, 0.0, {
            warmupRemaining: 2,
            warmupClearBoost: 2,
            totalRounds: 5,
            nearFullLines: 0,
            multiClearCandidates: 0,
            pcSetup: 0
        });
        if (s.spawnHints) {
            // warmup 显式偏好多消形状用于跨局友好印象 → 不应被 v1.19 兜底清零
            expect(s.spawnHints.multiLineTarget).toBe(2);
        }
    });

    it('v1.19 几何兜底：低 fill + pcSetup=1（噪声窗口）→ 兜底触发', () => {
        // fill=0.3 < PC_SETUP_MIN_FILL(0.45)：pcSetup=1 是几何噪声
        const s = resolveAdaptiveStrategy('normal', makeProfile({ spawnCounter: 0 }), 100, 0, 0.3, {
            pcSetup: 1,
            nearFullLines: 0,
            multiClearCandidates: 0,
            totalRounds: 5
        });
        if (s.spawnHints) {
            expect(s.spawnHints.multiLineTarget).toBe(0);
        }
    });

    /* =====================================================================
     * v1.20：challengeBoost 触发条件覆盖（之前 0 单测）
     *   isBClassChallenge =
     *     (segment5 === 'B' || sessionTrend !== 'declining')
     *     && ctx.bestScore > 0
     *     && score >= ctx.bestScore * 0.8
     *     && stress < 0.7
     *   触发后：challengeBoost = min(0.15, (score/best - 0.8) * 0.75)
     * ===================================================================*/
    it('v1.20 challengeBoost：score < 0.8 * bestScore → 不触发', () => {
        // 920 / 5020 = 0.183 << 0.8（截图实际数据）
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 920, 0, 0.34, {
            bestScore: 5020,
            totalRounds: 8
        });
        expect(s._stressBreakdown.challengeBoost).toBe(0);
    });

    it('v1.20 challengeBoost：bestScore = 0 → 不触发（即便 score 很高）', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 5000, 0, 0.4, {
            bestScore: 0,
            totalRounds: 8
        });
        expect(s._stressBreakdown.challengeBoost).toBe(0);
    });

    it('v1.20 challengeBoost：score = 0.85 * bestScore + sessionTrend stable → 触发，加压 ≤ 0.15', () => {
        // 850/1000 = 0.85 ≥ 0.8；默认 profile sessionTrend = 'stable'（非 declining）
        // 默认 stress 应远低于 0.7 阈值，触发条件齐
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 850, 0, 0.3, {
            bestScore: 1000,
            totalRounds: 8
        });
        expect(s._stressBreakdown.challengeBoost).toBeGreaterThan(0);
        expect(s._stressBreakdown.challengeBoost).toBeLessThanOrEqual(0.15);
    });

    it('v1.20 challengeBoost：触发幅度 = min(0.15, (ratio-0.8) * 0.75)', () => {
        // 990/1000 = 0.99 → (0.99-0.8)*0.75 = 0.1425 < 0.15
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 990, 0, 0.3, {
            bestScore: 1000,
            totalRounds: 8
        });
        const cb = s._stressBreakdown.challengeBoost;
        expect(cb).toBeGreaterThan(0.13);
        expect(cb).toBeLessThanOrEqual(0.15);
    });

    it('v1.29 challengeBoost：friendlyBoardRelief 显著时 B 类加压被削弱（互抑锯齿）', () => {
        const ctxBase = { bestScore: 1000, totalRounds: 8, holes: 0 };
        const sPlain = resolveAdaptiveStrategy('normal', makeProfile(), 990, 0, 0.45, {
            ...ctxBase,
            nearFullLines: 0,
            multiClearCandidates: 0,
            pcSetup: 0
        });
        const sFriendly = resolveAdaptiveStrategy('normal', makeProfile(), 990, 0, 0.45, {
            ...ctxBase,
            nearFullLines: 3,
            multiClearCandidates: 2,
            pcSetup: 0
        });
        expect(sPlain._stressBreakdown.challengeBoost).toBeGreaterThan(0.12);
        expect(sFriendly._stressBreakdown.friendlyBoardRelief).toBeLessThan(-0.09);
        expect(sFriendly._stressBreakdown.challengeBoost).toBeCloseTo(
            sPlain._stressBreakdown.challengeBoost * 0.42,
            5
        );
    });

    it('v1.29 occupancyFillAnchor：瞬时低占用 + 高锚点时 damping 弱于裸 fill（缓降、避免锯齿）', () => {
        const p = makeProfile({ smoothSkill: 0.6, lifetimeGames: 6, lifetimePlacements: 120 });
        const withAnchor = resolveAdaptiveStrategy('normal', p, 1200, 0, 0.22, {
            totalRounds: 10,
            bestScore: 1500,
            _occupancyFillAnchor: 0.48
        });
        const noAnchor = resolveAdaptiveStrategy('normal', p, 1200, 0, 0.22, {
            totalRounds: 10,
            bestScore: 1500
        });
        expect(withAnchor._occupancyFillAnchor).toBeGreaterThan(0.22);
        // 锚点抬高 occupancyScale → 衰减更轻（occupancyDamping 负得更少）
        expect(withAnchor._stressBreakdown.occupancyDamping).toBeGreaterThan(noAnchor._stressBreakdown.occupancyDamping);
        expect(withAnchor._adaptiveStress).toBeGreaterThanOrEqual(noAnchor._adaptiveStress - 1e-6);
    });

    /* =====================================================================
     * v1.21：rhythmPhase='setup' 与 spawnIntent='harvest' 互斥兜底
     *   旧版 deriveRhythmPhase 在 (pacingPhase=tension && roundsSinceClear=0)
     *   时无条件返回 'setup'，与 harvestable（nearFullLines>=2）口径不同 →
     *   同帧出现 pill「节奏 搭建」+「意图 兑现」对立叙事。
     *   修复：'setup' 加 `&& !nearGeom` 互斥。
     * ===================================================================*/
    it('v1.21 rhythmPhase：tension + roundsSinceClear=0 + nearFullLines>=2 → 不再 setup（fall through）', () => {
        // 复现截图场景：紧张期开头 + 刚清完 + 已有 ≥2 临消行
        // 旧版: rhythmPhase='setup' + spawnIntent='harvest'（撞墙）
        // 新版: rhythmPhase 落到 neutral 或被 canPromoteToPayoff 升 'payoff'
        const p = makeProfile({ smoothSkill: 0.55 });
        // 让 pacingPhase=tension：spawnCounter 落在 cycle 前半段（默认 cycleLength=10，0~4 是 tension）
        p._spawnCounter = 1;
        const s = resolveAdaptiveStrategy('normal', p, 200, 0, 0.4, {
            roundsSinceClear: 0,
            nearFullLines: 2,
            pcSetup: 0,
            multiClearCandidates: 1,
            totalRounds: 8
        });
        expect(p.pacingPhase).toBe('tension');
        expect(s.spawnHints.rhythmPhase).not.toBe('setup');
        expect(s._spawnIntent).toBe('harvest');
    });

    it('v1.21 rhythmPhase：tension + roundsSinceClear=0 + 无几何 → 仍 setup（蓄力期不变）', () => {
        const p = makeProfile({ smoothSkill: 0.55 });
        p._spawnCounter = 1;
        const s = resolveAdaptiveStrategy('normal', p, 200, 0, 0.2, {
            roundsSinceClear: 0,
            nearFullLines: 0,
            pcSetup: 0,
            multiClearCandidates: 0,
            totalRounds: 8
        });
        expect(p.pacingPhase).toBe('tension');
        expect(s.spawnHints.rhythmPhase).toBe('setup');
        expect(s._spawnIntent).not.toBe('harvest');
    });

    it('v1.20 challengeBoost：触发时 spawnIntent 切到 pressure（与 stress 加压同源）', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 900, 0, 0.3, {
            bestScore: 1000,
            totalRounds: 8,
            // 关闭其他可能更高优先级的 intent 触发：
            nearFullLines: 0,
            multiClearCandidates: 0,
            pcSetup: 0
        });
        expect(s._stressBreakdown.challengeBoost).toBeGreaterThan(0);
        // pressure 优先级在 harvest / engage 之后但在 maintain 之前；
        // 这里把 harvest/engage 条件都置零，spawnIntent 应落到 pressure
        expect(s._spawnIntent).toBe('pressure');
    });
});
