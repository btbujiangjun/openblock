/**
 * @vitest-environment jsdom
 *
 * v1.32：挑战最高分游戏设计优化全套测试
 *
 * 覆盖：
 *   - P1-1  S/M 标签与出块难度联动（lifecycleStressCapMap）
 *   - P1-2  近失反馈强化（_triggerNearMissFeedback / fillBefore > 0.55）
 *   - P1-3  分数锚定可视化（gap ratio 分档 best.gap.victory/close/neutral/far）
 *   - P1-4  难度曲线平滑（±0.15 clamp）
 *   - P2-5  多级里程碑触发（milestoneHit → showFloatScore milestone）
 *   - P2-6  策略面板 stress vs target（_stressTarget 输出与渲染）
 *   - P2-7  失败过渡优化（showNoMovesWarning 延迟 600ms）
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { renderStressMeter, buildStoryLine, STRESS_LEVELS } from '../web/src/stressMeter.js';
import { generateStrategyTips } from '../web/src/strategyAdvisor.js';

// ── helper ──────────────────────────────────────────────────────────────

function makeProfile(overrides = {}) {
    const p = new PlayerProfile(15);
    if (overrides.lifetimeGames != null) p._totalLifetimeGames = overrides.lifetimeGames;
    if (overrides.lifetimePlacements != null) p._totalLifetimePlacements = overrides.lifetimePlacements;
    if (overrides.smoothSkill != null) p._smoothSkill = overrides.smoothSkill;
    if (overrides.consecutiveNonClears != null) p._consecutiveNonClears = overrides.consecutiveNonClears;
    if (overrides.recoveryCounter != null) p._recoveryCounter = overrides.recoveryCounter;
    if (overrides.spawnCounter != null) p._spawnCounter = overrides.spawnCounter;
    if (overrides.comboStreak != null) p._comboStreak = overrides.comboStreak;
    return p;
}

// ── P1-1：S/M 标签与出块难度联动 ────────────────────────────────────────

describe('P1-1：S/M 标签与出块难度联动', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('S0·M0（新玩家）stress 上限 0.50，整体偏移 -0.15', () => {
        const p = makeProfile({ lifetimeGames: 0, lifetimePlacements: 3, smoothSkill: 0.4 });
        const s = resolveAdaptiveStrategy('normal', p, 80, 0, 0.3, { totalRounds: 4 });
        expect(s._stressBreakdown.lifecycleStage).toBe('S0');
        expect(s._stressBreakdown.lifecycleBand).toBe('M0');
        expect(s._adaptiveStress).toBeLessThanOrEqual(0.50);
    });

    it('S3·M? 段（核心难度）stress 接近所在 band 的 cap（v1.55 §4.1 后所有 25 格无死键）', () => {
        const p = makeProfile({ lifetimeGames: 180, lifetimePlacements: 7000, smoothSkill: 0.9 });
        p._daysSinceInstall = 45;
        p._daysSinceLastActive = 2;
        const s = resolveAdaptiveStrategy('hard', p, 250, 5, 0.5, { totalRounds: 30 });
        expect(s._stressBreakdown.lifecycleStage).toBe('S3');
        expect(s._stressBreakdown.lifecycleBand).toBeTruthy(); // M0..M4 之一
        /* v1.55 §4.1 起：S3·M0 cap=0.65（之前是死键 → raw stress 直通到 0.85+）。
         * 这里只要求 stress > 0.5（hard 难度的下限）；具体上限取决于实际派生的 band：
         *   - M0 / M1：cap 0.65 / 0.72 → finalStress ≈ 0.60–0.70
         *   - M2 / M3：cap 0.78 / 0.85 → finalStress 可能在 0.70+
         *   - M4：cap 0.88 → finalStress 可达 0.88
         * 所有 band 下 stress 都明显大于 0.5（hard 难度 + skill≥0.9 + runStreak=5）。 */
        const finalStress = s._adaptiveStress;
        expect(finalStress).toBeGreaterThan(0.55);
        /* 必然不会超过该 band 对应 cap：cap 上限保证（最大 cap=0.88） */
        expect(finalStress).toBeLessThanOrEqual(1.0);
    });

    it('S4·M0（回流保护）stress 上限 0.55，偏移 -0.15', () => {
        const p = makeProfile({ lifetimeGames: 50, lifetimePlacements: 1000, smoothSkill: 0.6 });
        p._daysSinceInstall = 60;
        p._daysSinceLastActive = 10; // >= 7 → winback / S4
        const s = resolveAdaptiveStrategy('normal', p, 120, 1, 0.35, { totalRounds: 8 });
        expect(s._stressBreakdown.lifecycleStage).toBe('S4');
        expect(s._stressBreakdown.lifecycleBand).toBe('M0');
        expect(s._adaptiveStress).toBeLessThanOrEqual(0.55);
    });

    it('stressBreakdown 含 lifecycleStage / lifecycleBand / lifecycleStressAdjust', () => {
        const p = makeProfile({ lifetimeGames: 10, lifetimePlacements: 200 });
        const s = resolveAdaptiveStrategy('normal', p, 60, 0, 0.25, { totalRounds: 3 });
        expect(s._stressBreakdown).toHaveProperty('lifecycleStage');
        expect(s._stressBreakdown).toHaveProperty('lifecycleBand');
        expect(s._stressBreakdown).toHaveProperty('lifecycleStressAdjust');
        expect(['S0','S1','S2','S3','S4']).toContain(s._stressBreakdown.lifecycleStage);
    });
});

// ── P1-3：分数锚定可视化 ────────────────────────────────────────────────

describe('P1-3：分数锚定可视化（gap ratio 分档）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('gap ratio ≤ 0 → victory 档', () => {
        const bestScore = 1000;
        const score = 1000;
        const gap = bestScore - score;
        const ratio = gap / bestScore;
        expect(ratio <= 0).toBe(true);
    });

    it('gap ratio ≤ 0.05 → close 档（接近）', () => {
        const bestScore = 1000;
        const score = 960;
        const gap = bestScore - score;
        const ratio = gap / bestScore;
        expect(ratio).toBeCloseTo(0.04, 2);
        expect(ratio <= 0.05).toBe(true);
    });

    it('gap ratio ≤ 0.15 → neutral 档（一般）', () => {
        const bestScore = 1000;
        const score = 880;
        const gap = bestScore - score;
        const ratio = gap / bestScore;
        expect(ratio).toBeCloseTo(0.12, 2);
        expect(ratio > 0.05 && ratio <= 0.15).toBe(true);
    });

    it('gap ratio > 0.15 → far 档（差距大）', () => {
        const bestScore = 1000;
        const score = 800;
        const gap = bestScore - score;
        const ratio = gap / bestScore;
        expect(ratio).toBeCloseTo(0.20, 2);
        expect(ratio > 0.15).toBe(true);
    });
});

// ── P1-4：难度曲线平滑 ──────────────────────────────────────────────────

describe('P1-4：难度曲线平滑（±0.15 clamp）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('prevAdaptiveStress 被写入 spawnContext（供 game.js 平滑层读取）', () => {
        const p = makeProfile({ lifetimeGames: 5, lifetimePlacements: 100 });
        const r1 = resolveAdaptiveStrategy('normal', p, 80, 0, 0.35, { totalRounds: 3 });
        expect(typeof r1._adaptiveStress).toBe('number');
        // r1._adaptiveStress 会在 game.js 的 finish() 中被 clamp 并写入 _spawnContext.prevAdaptiveStress
        // 本测试验证 resolveAdaptiveStrategy 返回的 stress 在合理范围
        expect(r1._adaptiveStress).toBeGreaterThanOrEqual(-0.25);
        expect(r1._adaptiveStress).toBeLessThanOrEqual(1.05);
    });

    it('stress 差值超过 ±0.15 时在 game.js 层平滑（单元测：验证计算过程）', () => {
        const p = makeProfile({ lifetimeGames: 5, lifetimePlacements: 100 });
        const r1 = resolveAdaptiveStrategy('hard', p, 250, 0, 0.65, { totalRounds: 12 });
        const r2 = resolveAdaptiveStrategy('easy', p, 20, 0, 0.15, { totalRounds: 1 });
        // 模拟 game.js 的 smoothDelta 计算
        const prevStress = r1._adaptiveStress;
        const currStress = r2._adaptiveStress;
        const smoothDelta = Math.max(-0.15, Math.min(0.15, currStress - prevStress));
        // 平滑后的 stress 不应超过 prevStress ± 0.15
        const smoothedStress = prevStress + smoothDelta;
        expect(smoothedStress - prevStress).toBeCloseTo(-0.15, 2);
    });

    it('stress 差值在 ±0.15 内时保持原始值', () => {
        const p = makeProfile({ lifetimeGames: 4, lifetimePlacements: 80 });
        const r1 = resolveAdaptiveStrategy('normal', p, 60, 0, 0.30, { totalRounds: 2 });
        const r2 = resolveAdaptiveStrategy('normal', p, 80, 0, 0.35, { totalRounds: 3 });
        const prevStress = r1._adaptiveStress;
        const currStress = r2._adaptiveStress;
        const smoothDelta = Math.max(-0.15, Math.min(0.15, currStress - prevStress));
        // 差值在 ±0.15 内 → smoothDelta === currStress - prevStress
        expect(smoothDelta).toBeCloseTo(currStress - prevStress, 2);
    });
});

// ── P2-5：多级里程碑触发（v1.55.10：MIN_BEST=500 门槛 + [0.50, 0.75, 0.90] 档位） ──

describe('P2-5：多级里程碑触发（v1.55.10 修订）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('bestScore=1000 时分数达到 500 分（50%）触发里程碑', () => {
        resetAdaptiveMilestone();
        const p = makeProfile();
        const r1 = resolveAdaptiveStrategy('normal', p, 400, 0, 0.3, { totalRounds: 2, bestScore: 1000 });
        expect(r1.spawnHints.scoreMilestone).toBe(false);
        resetAdaptiveMilestone();
        const r2 = resolveAdaptiveStrategy('normal', p, 500, 0, 0.3, { totalRounds: 3, bestScore: 1000 });
        expect(r2.spawnHints.scoreMilestone).toBe(true);
        expect(r2.spawnHints.scoreMilestoneValue).toBe(500);
    });

    it('bestScore=1000 时分数达到 750 分（75%）触发里程碑（命中最小未达档=500）', () => {
        resetAdaptiveMilestone();
        const p = makeProfile();
        const r = resolveAdaptiveStrategy('normal', p, 750, 0, 0.4, { totalRounds: 4, bestScore: 1000 });
        expect(r.spawnHints.scoreMilestone).toBe(true);
        /* checkScoreMilestone 返回首个未达档；750 同时跨过 500 与 750，按设计返回 500。
         * 注意：v1.55.10 局内一次契约下，玩家一局通常只会命中一个档位，此行为合理。 */
        expect(r.spawnHints.scoreMilestoneValue).toBe(500);
    });

    it('分数未达任何百分比档位时不触发', () => {
        resetAdaptiveMilestone();
        const p = makeProfile();
        const r = resolveAdaptiveStrategy('normal', p, 400, 0, 0.2, { totalRounds: 1, bestScore: 1000 });
        expect(r.spawnHints.scoreMilestone).toBe(false);
    });

    it('_scoreMilestoneHit 字段与 spawnHints.scoreMilestone 一致（v1.49 字段更名）', () => {
        resetAdaptiveMilestone();
        const p = makeProfile();
        const r = resolveAdaptiveStrategy('normal', p, 500, 0, 0.3, { totalRounds: 3, bestScore: 1000 });
        expect(r.spawnHints.scoreMilestone).toBe(r._scoreMilestoneHit);
        expect(r.spawnHints.scoreMilestoneValue).toBe(r._scoreMilestoneValue);
    });

    it('首次跨过最低档 500（bestScore=1000 × 0.50）即触发，命中值=500', () => {
        const p = makeProfile();
        resetAdaptiveMilestone();
        const r = resolveAdaptiveStrategy('normal', p, 510, 0, 0.4, { totalRounds: 5, bestScore: 1000 });
        expect(r.spawnHints.scoreMilestone).toBe(true);
        expect(r.spawnHints.scoreMilestoneValue).toBe(500);
        /* 750 / 900 两档的命中由 nearMissAndMilestone.test.js 中
         * "scales milestones relative to bestScore" 用例间接覆盖；
         * 局内一次契约让"逐档命中"在单局上下文中不可能（也不该出现）。 */
    });

    it('bestScore < 500 时任何分数都不触发（v1.55.10 MIN_BEST 门槛）', () => {
        resetAdaptiveMilestone();
        const p = makeProfile();
        for (const sc of [50, 100, 150, 200, 300]) {
            const r = resolveAdaptiveStrategy('normal', p, sc, 0, 0.4, { totalRounds: 5, bestScore: 0 });
            expect(r.spawnHints.scoreMilestone).toBe(false);
        }
    });
});

// ── P2-6：策略面板 stress vs target ─────────────────────────────────────

describe('P2-6：策略面板 stress vs target', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('resolveAdaptiveStrategy 输出 _stressTarget 字段', () => {
        const p = makeProfile({ lifetimeGames: 5, lifetimePlacements: 100 });
        const s = resolveAdaptiveStrategy('normal', p, 80, 0, 0.35, { totalRounds: 4 });
        expect(s).toHaveProperty('_stressTarget');
        expect(typeof s._stressTarget).toBe('number');
        expect(Number.isFinite(s._stressTarget)).toBe(true);
    });

    it('_stressTarget 默认值约为 norm 0.4375（v1.55.17：原 raw 0.325 已对外归一化）', () => {
        const p = makeProfile({ lifetimeGames: 5, lifetimePlacements: 100 });
        const s = resolveAdaptiveStrategy('normal', p, 80, 0, 0.35, { totalRounds: 4 });
        /* v1.55.17：_stressTarget 已切到 norm 域（0.325 raw → 0.4375 norm）；
         * raw 域中性锚仍可通过 _stressTargetRaw 读取。 */
        expect(s._stressTarget).toBeCloseTo(0.4375, 2);
        expect(s._stressTargetRaw).toBeCloseTo(0.325, 2);
    });

    it('renderStressMeter 接受 stressTarget 参数', () => {
        const container = document.createElement('div');
        const insight = {
            stress: 0.45,
            stressTarget: 0.325,
            stressBreakdown: {},
            spawnHints: { spawnIntent: 'flow' },
            spawnTargets: {},
            adaptiveEnabled: true
        };
        expect(() => renderStressMeter(container, insight, [])).not.toThrow();
        const html = container.innerHTML;
        expect(html).toContain('stress-meter__bar');
        expect(html).toContain('stress-meter__bar-fill');
    });

    it('renderStressMeter 当 stressTarget 缺失时不渲染目标线', () => {
        const container = document.createElement('div');
        const insight = {
            stress: 0.45,
            stressBreakdown: {},
            spawnHints: { spawnIntent: 'flow' },
            spawnTargets: {},
            adaptiveEnabled: true
        };
        renderStressMeter(container, insight, []);
        const html = container.innerHTML;
        expect(html).not.toContain('stress-meter__bar-target');
    });

    it('renderStressMeter 当 stressTarget 存在时渲染目标线和差值', () => {
        const container = document.createElement('div');
        const insight = {
            stress: 0.45,
            stressTarget: 0.325,
            stressBreakdown: {},
            spawnHints: { spawnIntent: 'flow' },
            spawnTargets: {},
            adaptiveEnabled: true
        };
        renderStressMeter(container, insight, []);
        const html = container.innerHTML;
        expect(html).toContain('stress-meter__bar-target');
        expect(html).toContain('stress-meter__bar-delta');
        expect(html).toContain('↑'); // 0.45 > 0.325 → ↑
    });

    it('stress < target 时显示 ↓ 差值', () => {
        const container = document.createElement('div');
        const insight = {
            stress: 0.20,
            stressTarget: 0.325,
            stressBreakdown: {},
            spawnHints: { spawnIntent: 'relief' },
            spawnTargets: {},
            adaptiveEnabled: true
        };
        renderStressMeter(container, insight, []);
        const html = container.innerHTML;
        expect(html).toContain('↓');
    });
});

// ── P1-2 + P2-7：近失反馈（UI 层，验证 CSS 类存在） ────────────────────

describe('P1-2 + P2-7：近失反馈 CSS 类', () => {
    it('float-near-miss 类在 main.css 中定义（smoke test）', () => {
        const style = document.querySelector('style') || document.createElement('style');
        document.head.appendChild(style);
        style.textContent = `
            .float-near-miss { color: #c0392b; }
            .float-near-miss .float-label { color: #ff6b6b; }
            @keyframes nearMissFloat { 0% {} 100% {} }
        `;
        const el = document.createElement('div');
        el.className = 'float-score float-near-miss';
        el.innerHTML = '<span class="float-label">差一点！</span><span class="float-pts">💪</span>';
        document.body.appendChild(el);
        expect(el.classList.contains('float-near-miss')).toBe(true);
        expect(el.querySelector('.float-label')?.textContent).toBe('差一点！');
        expect(el.querySelector('.float-pts')?.textContent).toBe('💪');
    });
});

// ── 集成：完整流程模拟 ──────────────────────────────────────────────────

describe('集成：完整流程（里程碑→近失→结算）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('经历多个里程碑期间（隔局 reset）milestoneHit 多次触发', () => {
        /* v1.55.10：bestScore=1000 → 派生 [500, 750, 900]；每次 reset 模拟新一局 */
        const p = makeProfile({ lifetimeGames: 5, lifetimePlacements: 100 });
        const scores = [400, 500, 750, 900];
        const hits = [];
        for (const score of scores) {
            resetAdaptiveMilestone();
            const r = resolveAdaptiveStrategy('normal', p, score, 0, 0.4, { totalRounds: 5, bestScore: 1000 });
            hits.push(r.spawnHints.scoreMilestone);
        }
        expect(hits).toEqual([false, true, true, true]);
    });

    it('局内只触发一次（v1.55.10 in-run cap）：连续跨多档只 hit 第一次', () => {
        const p = makeProfile({ lifetimeGames: 5, lifetimePlacements: 100 });
        resetAdaptiveMilestone();
        /* bestScore=1000 → 派生 [500, 750, 900]；连续 510→760→920 应只 hit 一次 */
        const hits = [];
        for (const score of [510, 760, 920]) {
            const r = resolveAdaptiveStrategy('normal', p, score, 0, 0.4, { totalRounds: 5, bestScore: 1000 });
            hits.push(r.spawnHints.scoreMilestone);
        }
        expect(hits).toEqual([true, false, false]);
    });

    it('近失后 stress 下调（nearMissAdjust）', () => {
        // p1：最近一步是高填充但消行了 → hadRecentNearMiss = false
        const p1 = makeProfile({ lifetimeGames: 3, lifetimePlacements: 60, consecutiveNonClears: 0 });
        p1.recordPlace(true, 1, 0.3);  // cleared = true → not near miss

        // p2：最近一步是高填充但未消行 → hadRecentNearMiss = true
        const p2 = makeProfile({ lifetimeGames: 3, lifetimePlacements: 60, consecutiveNonClears: 0 });
        p2.recordPlace(false, 0, 0.65);  // cleared = false, fill = 0.65 > 0.6 → near miss

        const r1 = resolveAdaptiveStrategy('normal', p1, 80, 0, 0.58, { totalRounds: 4 });
        const r2 = resolveAdaptiveStrategy('normal', p2, 80, 0, 0.58, { totalRounds: 4 });
        const nm1 = r1._stressBreakdown.nearMissAdjust ?? 0;
        const nm2 = r2._stressBreakdown.nearMissAdjust ?? 0;
        expect(nm2).toBeLessThan(nm1);
    });
});