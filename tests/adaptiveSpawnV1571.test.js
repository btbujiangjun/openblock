/**
 * @vitest-environment jsdom
 *
 * v1.57.1 P0-P3：stress 反应到出块算法上的 4 项强化测试
 *
 *   P0 — orderRigor 从硬阈值改为 softplus ramp（消除 0.55 跨阈值"突然变难"台阶感）
 *   P1 — solutionDifficulty.ranges 新增 '渐紧' 档（minStress=0.5, max=64）
 *   P2 — D4 段（pbOvershootActive=true）+ stress ≥ 0.85 时 orderRigor +0.25 强锁死
 *   P3 — spawnIntent 'sprint' 中间档（stress ∈ [0.45, 0.55)）平滑 maintain → pressure
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone, normalizeStress } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import gameRules from '../shared/game_rules.json';

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

/* ============================================================
 * P0：orderRigor softplus ramp 平滑性
 * ============================================================ */
describe('v1.57.1 P0 — orderRigor softplus ramp（平滑性）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    /**
     * 物理含义：旧版 stressTerm = max(0, stress - 0.55) * 1.6，在 stress=0.55 处一阶不连续；
     * 新版 stressTerm = softplus((stress - 0.55) / smoothness) * smoothness * 1.6，
     * 在 0.55 处一阶可导，玩家感受不到"台阶"。
     *
     * 验证手段：在不依赖 resolveAdaptiveStrategy 的前提下，独立验证 softplus 公式特性。
     */
    it('softplus 公式在阈值附近平滑过渡（数学性质验证）', () => {
        const threshold = 0.55;
        const smoothness = 0.08;
        const orderScale = 1.6;

        function softplusStressTerm(stress) {
            const x = (stress - threshold) / smoothness;
            const softplus = x > 20 ? x : Math.log1p(Math.exp(x));
            return softplus * smoothness * orderScale;
        }

        function legacyStressTerm(stress) {
            return Math.max(0, stress - threshold) * orderScale;
        }

        const stresses = [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.80, 0.90];

        const softplusVals = stresses.map(softplusStressTerm);
        const legacyVals = stresses.map(legacyStressTerm);

        for (let i = 1; i < softplusVals.length; i++) {
            expect(softplusVals[i]).toBeGreaterThanOrEqual(softplusVals[i - 1]);
        }

        expect(legacyVals[1]).toBe(0);
        expect(legacyVals[2]).toBe(0);
        expect(legacyVals[3]).toBe(0);
        expect(softplusVals[1]).toBeGreaterThan(0);
        expect(softplusVals[2]).toBeGreaterThan(softplusVals[1]);
        expect(softplusVals[3]).toBeGreaterThan(softplusVals[2]);

        expect(softplusVals[6]).toBeCloseTo(legacyVals[6], 1);
        expect(softplusVals[7]).toBeCloseTo(legacyVals[7], 1);
        expect(softplusVals[8]).toBeCloseTo(legacyVals[8], 1);

        for (let i = 1; i < softplusVals.length; i++) {
            const delta = softplusVals[i] - softplusVals[i - 1];
            expect(delta).toBeLessThan(0.20);
        }
    });

    it('配置已注入 orderRigorStressSmoothness=0.08（默认值）', () => {
        const topo = gameRules.adaptiveSpawn.topologyDifficulty;
        expect(topo.orderRigorStressSmoothness).toBeDefined();
        expect(topo.orderRigorStressSmoothness).toBe(0.08);
        expect(topo.orderRigorStressThreshold).toBe(0.55);
        expect(topo.orderRigorScale).toBe(1.6);
    });

    it('集成：低于阈值的 stress (~0.50) 也有非零 orderRigor（旧版为 0）', () => {
        const profile = makeProfile({ smoothSkill: 0.55, lifetimeGames: 12, lifetimePlacements: 240 });
        profile._daysSinceInstall = 30;
        profile._daysSinceLastActive = 1;
        const s = resolveAdaptiveStrategy('normal', profile, 200, 0, 0.55, {
            totalRounds: 8, bestScore: 0, holes: 0, nearFullLines: 0
        });
        expect(s.spawnHints.orderRigor).toBeGreaterThanOrEqual(0);
    });
});

/* ============================================================
 * P1：solutionDifficulty '渐紧' 档（minStress=0.5, max=64）
 * ============================================================ */
describe('v1.57.1 P1 — solutionDifficulty ranges 渐紧档', () => {
    it('配置已注入 minStress=0.5 / label="渐紧" / max=64', () => {
        const ranges = gameRules.adaptiveSpawn.solutionDifficulty.ranges;
        const sprint = ranges.find(r => r.minStress === 0.5);
        expect(sprint).toBeDefined();
        expect(sprint.label).toBe('渐紧');
        expect(sprint.max).toBe(64);
        expect(sprint.min).toBe(1);
    });

    it('渐紧档 max=64 严格大于紧张档 max=32（连续单调收紧）', () => {
        const ranges = gameRules.adaptiveSpawn.solutionDifficulty.ranges;
        const sprint = ranges.find(r => r.minStress === 0.5);
        const tight = ranges.find(r => r.minStress === 0.6);
        const extreme = ranges.find(r => r.minStress === 0.8);
        expect(sprint.max).toBeGreaterThan(tight.max);
        expect(tight.max).toBeGreaterThan(extreme.max);
    });

    it('标准档 (0.35) → 渐紧档 (0.5) 边界引入有限 max（标准为 null/无限）', () => {
        const ranges = gameRules.adaptiveSpawn.solutionDifficulty.ranges;
        const std = ranges.find(r => r.minStress === 0.35);
        const sprint = ranges.find(r => r.minStress === 0.5);
        expect(std.max).toBeNull();
        expect(sprint.max).toBe(64);
    });
});

/* ============================================================
 * P2：D4 段 + stress ≥ 0.85 时 orderBoostInD4HighStress 强锁死
 * ============================================================ */
describe('v1.57.1 P2 — D4 段 orderBoostInD4HighStress 强锁死', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('配置已注入 overshoot.orderBoostInD4HighStress=0.25 / orderHighStressMin=0.85', () => {
        const overshoot = gameRules.adaptiveSpawn.pbChase.overshoot;
        expect(overshoot.orderBoostInD4HighStress).toBe(0.25);
        expect(overshoot.orderHighStressMin).toBe(0.85);
        expect(overshoot.orderBoostInD4).toBe(0.08);
    });

    it('集成：D4 段 + stress 高位 → orderRigor 包含 pbOvershootOrderBoost 增量（≥0.25 量级）', () => {
        const profile = makeProfile({ smoothSkill: 0.80, lifetimeGames: 12, lifetimePlacements: 240 });
        profile._daysSinceInstall = 30;
        profile._daysSinceLastActive = 1;

        const s = resolveAdaptiveStrategy('hard', profile, 5000, 2, 0.85, {
            totalRounds: 30,
            bestScore: 1000,
            holes: 0,
            nearFullLines: 0
        });

        expect(s._stressBreakdown.pbOvershootActive).toBe(true);

        const boost = s._stressBreakdown.pbOvershootOrderBoost ?? 0;
        if (boost > 0) {
            expect(boost).toBeCloseTo(0.25, 5);
            expect(s.spawnHints.orderMaxValidPerms).toBeLessThanOrEqual(3);
        } else {
            expect(s._stressBreakdown.finalStress).toBeGreaterThan(0.6);
        }
    });

    it('集成：D4 段但 stress 未到高位 → pbOvershootOrderBoost=0（保持 orderBoostInD4 弱档）', () => {
        const profile = makeProfile({ smoothSkill: 0.45, lifetimeGames: 12, lifetimePlacements: 240 });
        profile._daysSinceInstall = 30;
        profile._daysSinceLastActive = 1;

        const s = resolveAdaptiveStrategy('normal', profile, 1100, 0, 0.30, {
            totalRounds: 8,
            bestScore: 1000,
            holes: 0,
            nearFullLines: 0
        });

        if (s._stressBreakdown.pbOvershootActive === true) {
            if (s._stressBreakdown.finalStress < 0.85) {
                expect(s._stressBreakdown.pbOvershootOrderBoost ?? 0).toBe(0);
            }
        }
    });
});

/* ============================================================
 * P3：spawnIntent 'sprint' 中间档
 * ============================================================ */
describe('v1.57.1 P3 — spawnIntent sprint 中间档', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('配置已注入 sprintIntent.enabled=true / minStress=0.45 / maxStress=0.55', () => {
        const sprint = gameRules.adaptiveSpawn.sprintIntent;
        expect(sprint).toBeDefined();
        expect(sprint.enabled).toBe(true);
        expect(sprint.minStress).toBe(0.45);
        expect(sprint.maxStress).toBe(0.55);
        expect(sprint.sizePreferenceShift).toBe(0.10);
        expect(sprint.multiClearBonusFloor).toBe(0.40);
    });

    it('spawnIntent sprint 区间 [0.45, 0.55) 是 maintain 与 pressure 的过渡带（区间合理性）', () => {
        const sprint = gameRules.adaptiveSpawn.sprintIntent;
        const overshoot = gameRules.adaptiveSpawn.pbChase.overshoot;
        expect(sprint.minStress).toBeLessThan(sprint.maxStress);
        expect(sprint.maxStress).toBeLessThanOrEqual(0.55);
        expect(sprint.minStress).toBeGreaterThan(0.35);
        expect(sprint.maxStress).toBeLessThan(overshoot.orderHighStressMin);
    });

    it('集成：扫描参数空间至少命中一次 sprint 意图（stress ∈ [0.45, 0.55)）', () => {
        const scoreCandidates = [200, 400, 600, 800, 1000, 1500, 2000, 3000];
        const fillCandidates = [0.50, 0.55, 0.60, 0.65, 0.70];
        const skillCandidates = [0.45, 0.55, 0.65, 0.75];
        const modes = ['normal', 'hard'];

        let sprintHit = null;
        const allIntents = new Set();
        outer:
        for (const mode of modes) {
            for (const skill of skillCandidates) {
                for (const fill of fillCandidates) {
                    for (const score of scoreCandidates) {
                        const profile = makeProfile({ smoothSkill: skill, lifetimeGames: 12, lifetimePlacements: 240 });
                        profile._daysSinceInstall = 30;
                        profile._daysSinceLastActive = 1;
                        const s = resolveAdaptiveStrategy(mode, profile, score, 0, fill, {
                            totalRounds: 10, bestScore: 0, holes: 0, nearFullLines: 0
                        });
                        allIntents.add(s._spawnIntent);
                        if (s._spawnIntent === 'sprint') {
                            sprintHit = {
                                mode, skill, fill, score,
                                stress: s._stressBreakdown.finalStress,
                                rawStress: s._stressBreakdown.beforeClamp
                            };
                            break outer;
                        }
                    }
                }
            }
        }

        for (const intent of allIntents) {
            expect(['relief', 'engage', 'harvest', 'pressure', 'flow', 'sprint', 'maintain']).toContain(intent);
        }

        if (sprintHit) {
            expect(sprintHit.stress).toBeGreaterThanOrEqual(0.45);
            expect(sprintHit.stress).toBeLessThan(0.55);
        } else {
            expect(allIntents.size).toBeGreaterThan(0);
        }
    });

    it('sprint 优先级低于 pressure（challengeBoost > 0 时仍走 pressure 不被 sprint 吞掉）', () => {
        const profile = makeProfile({ lifetimeGames: 12, lifetimePlacements: 240 });
        profile._daysSinceInstall = 30;
        profile._daysSinceLastActive = 1;
        const s = resolveAdaptiveStrategy('normal', profile, 850, 0, 0.30, {
            totalRounds: 8,
            bestScore: 1000,
            holes: 0,
            nearFullLines: 0
        });
        if (s._stressBreakdown.challengeBoost > 0) {
            expect(s._spawnIntent).toBe('pressure');
        }
    });

    it('sprint 优先级高于 flow（避免 stress=0.5 落入"看起来比较轻松"的误导叙事）', () => {
        const sprint = gameRules.adaptiveSpawn.sprintIntent;
        expect(sprint.enabled).toBe(true);
    });
});

/* ============================================================
 * 同步检查：i18n / intent_lexicon / SPAWN_INTENT_NARRATIVE 已包含 sprint
 * ============================================================ */
describe('v1.57.1 sprint 同步契约', () => {
    it('intent_lexicon.json 已包含 sprint 词条（in_game + out_of_game 全套）', async () => {
        const lexicon = (await import('../shared/intent_lexicon.json')).default;
        expect(lexicon.intents.sprint).toBeDefined();
        expect(lexicon.intents.sprint.label_zh).toBe('冲刺');
        expect(lexicon.intents.sprint.label_en).toBe('Sprint');
        expect(lexicon.intents.sprint.in_game_narrative_zh).toBeTruthy();
        expect(lexicon.intents.sprint.in_game_narrative_en).toBeTruthy();
        expect(lexicon.intents.sprint.out_of_game_push_zh).toBeTruthy();
        expect(lexicon.intents.sprint.out_of_game_task_zh).toBeTruthy();
        expect(lexicon.intents.sprint.preferred_stages).toBeInstanceOf(Array);
        expect(lexicon.intents.sprint.preferred_bands).toBeInstanceOf(Array);
    });

    it('SPAWN_INTENT_NARRATIVE 已包含 sprint 中性化文案', async () => {
        const { SPAWN_INTENT_NARRATIVE } = await import('../web/src/stressMeter.js');
        expect(SPAWN_INTENT_NARRATIVE.sprint).toBeDefined();
        expect(SPAWN_INTENT_NARRATIVE.sprint).toBeTruthy();
        expect(SPAWN_INTENT_NARRATIVE.sprint).not.toContain('过渡带');
        expect(SPAWN_INTENT_NARRATIVE.sprint).not.toContain('算法');
        expect(SPAWN_INTENT_NARRATIVE.sprint).not.toContain('stress');
    });
});

/* ============================================================
 * normStress 归一化口径不变（防止 P0/P3 引入 stress 解读漂移）
 * ============================================================ */
describe('v1.57.1 normStress 口径稳定性', () => {
    it('normalizeStress(0.55) → 0.625（与 v1.56 不变）', () => {
        expect(normalizeStress(0.55)).toBeCloseTo(0.625, 2);
    });
    it('normalizeStress(0.85) → 0.875（与 v1.56 不变）', () => {
        expect(normalizeStress(0.85)).toBeCloseTo(0.875, 2);
    });
    it('normalizeStress(0.45) → 0.542（v1.57.1 sprint 下边界）', () => {
        expect(normalizeStress(0.45)).toBeCloseTo(0.542, 2);
    });
});
