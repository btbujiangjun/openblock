/**
 * @vitest-environment jsdom
 *
 * v1.71 PEOG（PB 早期超越守卫）单元测试。
 *
 * 覆盖：
 *   - buildPeogState 12 路 bypass（6 路开局期 + 6 路实时）的判定与永久关闭
 *   - 强度升级（peog_mild → peog_strong）的累计触发与单向性
 *   - estimateConstructiveYield 与 CLEAR_SCORING 公式同源
 *   - applyPeogYieldCap 过滤 / 全拒后降级
 *   - applyPeogSpawnHintsCap 的 min(cap) / max(floor) 语义
 *   - 与 expertEarlyBoost 冲突时 PEOG cap 优先
 *   - 配置缺失退化（disabled / rolloutPercent / 节缺失）
 *   - pickWarmTarget 在 PEOG active 时 PERFECT_CLEAR → MULTI_CLEAR_NOW 映射
 *   - buildWarmBudget 在 peogIntensity 注入时改写 guaranteedDelights
 *   - 跨端镜像同源（miniprogram/core/spawn/peog.js）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, it, expect, beforeEach } from 'vitest';
import {
    buildPeogState,
    evaluatePeogActive,
    consumePeogOnPlace,
    applyPeogSpawnHintsCap,
    applyPeogYieldCap,
    estimateConstructiveYield,
    shouldShortCircuitConstructive,
    formatPeogTrace,
    PEOG_BYPASS_REASONS,
    PEOG_INTENSITY_RANK,
} from '../web/src/spawn/peog.js';
import { buildWarmBudget, pickWarmTarget, WARM_TARGETS } from '../web/src/spawn/warmRun.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { Grid } from '../web/src/grid.js';
import { GAME_RULES } from '../web/src/gameRules.js';

function makeProfile(overrides = {}) {
    const p = new PlayerProfile(15);
    if (overrides.needsRecovery != null) p.needsRecovery = overrides.needsRecovery;
    if (overrides.userId) p.userId = overrides.userId;
    return p;
}

/** 在中高 PB 段（≥1200）的标准 ctx。 */
function midHighCtx(overrides = {}) {
    return {
        bestScoreAtRunStart: 1500,
        score: 0,
        warmRunState: null,
        ...overrides,
    };
}

describe('PEOG · buildPeogState 开局期 bypass（6 路）', () => {
    it('disabled：配置 enabled=false 返回 bypass=disabled', () => {
        const orig = GAME_RULES.adaptiveSpawn.pbChase.earlyOvershootGuard.enabled;
        GAME_RULES.adaptiveSpawn.pbChase.earlyOvershootGuard.enabled = false;
        try {
            const s = buildPeogState(makeProfile(), midHighCtx(), null);
            expect(s.active).toBe(false);
            expect(s.bypass).toBe('disabled');
        } finally {
            GAME_RULES.adaptiveSpawn.pbChase.earlyOvershootGuard.enabled = orig;
        }
    });

    it('low_pb：bestScoreAtRunStart < midHighFloor 时 bypass=low_pb', () => {
        const s = buildPeogState(makeProfile(), midHighCtx({ bestScoreAtRunStart: 500 }), null);
        expect(s.active).toBe(false);
        expect(s.bypass).toBe('low_pb');
    });

    it('t1_newbie：温暖局 T1 触发时 bypass=t1_newbie', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), { triggerIds: ['T1_newbie'] });
        expect(s.active).toBe(false);
        expect(s.bypass).toBe('t1_newbie');
    });

    it('winback_first_run：T2 回流 + runsAfterReturn=0 时 bypass=winback_first_run', () => {
        const s = buildPeogState(
            makeProfile(),
            midHighCtx({ runsAfterReturn: 0 }),
            { triggerIds: ['T2_returning'] },
        );
        expect(s.active).toBe(false);
        expect(s.bypass).toBe('winback_first_run');
    });

    it('T2 回流 + runsAfterReturn≥1 时不 bypass（让"已熟悉"的回流玩家也受守卫）', () => {
        const s = buildPeogState(
            makeProfile(),
            midHighCtx({ runsAfterReturn: 1 }),
            { triggerIds: ['T2_returning'] },
        );
        expect(s.active).toBe(true);
        expect(s.bypass).toBeNull();
    });

    it('manual_remote_force：T7 远端强制时 bypass=manual_remote_force', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), { triggerIds: ['T7_manual_remote'] });
        expect(s.active).toBe(false);
        expect(s.bypass).toBe('manual_remote_force');
    });

    it('rollout_out：rolloutPercent=0 时 100% 灰度未命中', () => {
        const orig = GAME_RULES.adaptiveSpawn.pbChase.earlyOvershootGuard.rolloutPercent;
        GAME_RULES.adaptiveSpawn.pbChase.earlyOvershootGuard.rolloutPercent = 0;
        try {
            const s = buildPeogState(makeProfile({ userId: 'test-user-1' }), midHighCtx(), null);
            expect(s.active).toBe(false);
            expect(s.bypass).toBe('rollout_out');
        } finally {
            GAME_RULES.adaptiveSpawn.pbChase.earlyOvershootGuard.rolloutPercent = orig;
        }
    });

    it('中高 PB + 无 warm trigger 干扰 → active=true, intensity=peog_mild', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        expect(s.active).toBe(true);
        expect(s.intensity).toBe('peog_mild');
        expect(s.bypass).toBeNull();
        expect(s.guardSpawns).toBe(8);
        expect(s.pbApproachCeiling).toBeCloseTo(0.85);
    });
});

describe('PEOG · evaluatePeogActive 实时 bypass（6 路）', () => {
    it('recovery：profile.needsRecovery=true 时永久 bypass=recovery', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        expect(s.active).toBe(true);
        const after = evaluatePeogActive(s, midHighCtx(), { needsRecovery: true });
        expect(after.active).toBe(false);
        expect(after.bypass).toBe('recovery');
    });

    it('near_miss：连续 nearMissYieldHits 帧才让位（§O3 持续阈值）', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        /* nearMissYieldHits=2 (默认)：第 1 帧仍 active，第 2 帧才 bypass。 */
        const after1 = evaluatePeogActive(s, { ...midHighCtx(), hadRecentNearMiss: true }, makeProfile());
        expect(after1.active).toBe(true);
        expect(after1._nearMissHits).toBe(1);
        const after2 = evaluatePeogActive(after1, { ...midHighCtx(), hadRecentNearMiss: true }, makeProfile());
        expect(after2.active).toBe(false);
        expect(after2.bypass).toBe('near_miss');
    });

    it('bottleneck：连续 bottleneckYieldHits 帧才让位（§O3 持续阈值）', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        const after1 = evaluatePeogActive(s, { ...midHighCtx(), hasBottleneckSignal: true }, makeProfile());
        expect(after1.active).toBe(true);
        expect(after1._bottleneckHits).toBe(1);
        const after2 = evaluatePeogActive(after1, { ...midHighCtx(), hasBottleneckSignal: true }, makeProfile());
        expect(after2.active).toBe(false);
        expect(after2.bypass).toBe('bottleneck');
    });

    it('§O3 bottleneck 瞬时谷值不触发让位（hits 计数器被信号消失重置）', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        const a1 = evaluatePeogActive(s, { ...midHighCtx(), hasBottleneckSignal: true }, makeProfile());
        expect(a1.active).toBe(true);
        expect(a1._bottleneckHits).toBe(1);
        /* 信号消失：hits 重置为 0，PEOG 不让位。 */
        const a2 = evaluatePeogActive(a1, { ...midHighCtx(), hasBottleneckSignal: false }, makeProfile());
        expect(a2.active).toBe(true);
        expect(a2._bottleneckHits).toBe(0);
        /* 再次出现单帧信号：从 0 重新计数，仍 active。 */
        const a3 = evaluatePeogActive(a2, { ...midHighCtx(), hasBottleneckSignal: true }, makeProfile());
        expect(a3.active).toBe(true);
        expect(a3._bottleneckHits).toBe(1);
    });

    it('post_pb_release：ctx.postPbReleaseActive=true 时 bypass=post_pb_release', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        const after = evaluatePeogActive(s, { ...midHighCtx(), postPbReleaseActive: true }, makeProfile());
        expect(after.active).toBe(false);
        expect(after.bypass).toBe('post_pb_release');
    });

    it('late_phase：warmRunState.budget.spawnsUsed≥guardSpawns 时自然到期', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        const after = evaluatePeogActive(
            s,
            { ...midHighCtx(), warmRunState: { budget: { spawnsUsed: 8 } } },
            makeProfile(),
        );
        expect(after.active).toBe(false);
        expect(after.bypass).toBe('late_phase');
    });

    it('approach_handoff：pct≥ceiling 时移交给 challengeBoost', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        const after = evaluatePeogActive(s, { ...midHighCtx(), score: 1300 }, makeProfile()); // 1300/1500 ≈ 0.867 > 0.85
        expect(after.active).toBe(false);
        expect(after.bypass).toBe('approach_handoff');
    });

    it('Bypass 是单调永久的（active=false 后再调用不恢复）', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        evaluatePeogActive(s, midHighCtx(), { needsRecovery: true });
        expect(s.active).toBe(false);
        /* 即便 needsRecovery 解除，bypass 也不会恢复。 */
        evaluatePeogActive(s, midHighCtx(), { needsRecovery: false });
        expect(s.active).toBe(false);
        expect(s.bypass).toBe('recovery');
    });

    it('PEOG_BYPASS_REASONS 列出全部 12 路', () => {
        expect(PEOG_BYPASS_REASONS).toHaveLength(12);
        expect(PEOG_BYPASS_REASONS).toContain('disabled');
        expect(PEOG_BYPASS_REASONS).toContain('approach_handoff');
    });
});

describe('PEOG · 强度升级（mild → strong）', () => {
    it('approachCount 累计达 escalateAfterApproachCount(3) 时升级到 peog_strong', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        expect(s.intensity).toBe('peog_mild');
        /* pct ≥ ceiling × 0.95 = 0.8075 → score≥1211（1500×0.8075）。 */
        const ctx = midHighCtx({ score: 1220 });
        consumePeogOnPlace(s, ctx, 100);
        consumePeogOnPlace(s, ctx, 100);
        expect(s.intensity).toBe('peog_mild'); // approachCount=2，未达 3
        consumePeogOnPlace(s, ctx, 100);
        expect(s.intensity).toBe('peog_strong');
    });

    it('升级单向：strong 后即便 pct 回落也不降级', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        const ctx = midHighCtx({ score: 1220 });
        for (let i = 0; i < 3; i++) consumePeogOnPlace(s, ctx, 100);
        expect(s.intensity).toBe('peog_strong');
        consumePeogOnPlace(s, midHighCtx({ score: 100 }), 0);
        expect(s.intensity).toBe('peog_strong');
    });

    it('consumePeogOnPlace 累计 consumedYield 即便 bypass 后仍累加（供看板）', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        evaluatePeogActive(s, midHighCtx(), { needsRecovery: true });
        expect(s.active).toBe(false);
        consumePeogOnPlace(s, midHighCtx({ score: 50 }), 50);
        expect(s.consumedYield).toBe(50);
    });

    it('PEOG_INTENSITY_RANK：strong > mild', () => {
        expect(PEOG_INTENSITY_RANK.peog_strong).toBeGreaterThan(PEOG_INTENSITY_RANK.peog_mild);
    });
});

describe('PEOG · estimateConstructiveYield 公式（与 CLEAR_SCORING 同源）', () => {
    it('Completer 单线 = baseUnit (默认 20)', () => {
        expect(estimateConstructiveYield({ exact: true, extra: 0 })).toBe(20);
    });

    it('MultiClear n 线 = baseUnit × n²（2 线=80, 3 线=180）', () => {
        expect(estimateConstructiveYield({ clears: 2, lineKeys: ['r0', 'c0'] })).toBe(80);
        expect(estimateConstructiveYield({ clears: 3, lineKeys: ['r0', 'c0', 'r1'] })).toBe(180);
    });

    it('PerfectClearTriplet ≫ MultiClear（保守估算 baseUnit × 64 × 10 = 12800）', () => {
        const y = estimateConstructiveYield({ shapeIds: ['a', 'b', 'c'], placements: [{}, {}, {}] });
        expect(y).toBe(12800);
        const mc = estimateConstructiveYield({ clears: 3, lineKeys: ['r0', 'c0', 'r1'] });
        expect(y).toBeGreaterThan(mc * 10);
    });

    it('LargeBlock size=9 ≈ 9×20×0.3 = 54', () => {
        expect(estimateConstructiveYield({ size: 9, shapeId: 's9' })).toBeCloseTo(54);
    });

    it('Setup ≈ 10（baseUnit × 0.5）', () => {
        expect(estimateConstructiveYield({ target: { type: 'row', index: 0, emptyCells: [] }, shapeId: 'x' })).toBe(10);
    });

    it('未知形态 → 退化为 Completer（baseUnit）', () => {
        expect(estimateConstructiveYield({})).toBe(20);
        expect(estimateConstructiveYield(null)).toBe(0);
    });
});

describe('PEOG · applyPeogYieldCap 累计预算（局初放行 / 临近 ceiling 收紧）', () => {
    it('局初额度充裕 → 大爆点照常放行（不再逐帧限速）', () => {
        /* 累计预算：consumedYield=0 → remaining = 1500×0.85 = 1275 ≫ floor(1500×0.16=240)；
         * cap = max(240, 1275) = 1275，180/320 两个爆点全部放行（恢复高 PB 局初得分率）。 */
        const s = buildPeogState(makeProfile(), midHighCtx({ bestScoreAtRunStart: 1500 }), null);
        const cands = [
            { clears: 3, lineKeys: ['r0', 'c0', 'r1'] },        // yield=180 ✅
            { clears: 4, lineKeys: ['r0', 'c0', 'r1', 'c1'] },  // yield=320 ✅
        ];
        const out = applyPeogYieldCap(cands, s);
        expect(out).toHaveLength(2);
        expect(out.every(c => c._peogPassed)).toBe(true);
        expect(s.yieldCapHits).toBe(0);
    });

    it('临近 ceiling（consumedYield 高）→ 单帧 cap 收紧到 floor=PB×0.16=240，超出者被拒', () => {
        const s = buildPeogState(makeProfile(), midHighCtx({ bestScoreAtRunStart: 1500 }), null);
        s.consumedYield = 1275; // remaining=0 → cap = max(240, 0) = 240
        const cands = [
            { clears: 2, lineKeys: ['r0', 'c0'] },              // yield=80  ≤240 ✅
            { clears: 4, lineKeys: ['r0', 'c0', 'r1', 'c1'] },  // yield=320 >240 ❌
        ];
        const out = applyPeogYieldCap(cands, s);
        expect(out).toHaveLength(1);
        expect(out[0].clears).toBe(2);
        expect(out[0]._peogPassed).toBe(true);
        expect(s.yieldCapHits).toBe(1);
    });

    it('临近 ceiling 且全部超 floor 时降级为最低 yield 的一个（避免空 dock）', () => {
        const s = buildPeogState(makeProfile(), midHighCtx({ bestScoreAtRunStart: 1500 }), null);
        s.consumedYield = 1275; // cap = floor = 240
        const cands = [
            { clears: 4, lineKeys: ['r0', 'c0', 'r1', 'c1'] },       // yield=320
            { clears: 5, lineKeys: ['r0', 'c0', 'r1', 'c1', 'r2'] }, // yield=500
        ];
        const out = applyPeogYieldCap(cands, s);
        expect(out).toHaveLength(1);
        expect(out[0]._peogDowngraded).toBe(true);
        expect(out[0].clears).toBe(4); // 最小 yield 优先
    });

    it('inactive 时直接透传（含 bypass 状态）', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        evaluatePeogActive(s, midHighCtx(), { needsRecovery: true });
        const cands = [{ clears: 3 }, { clears: 4 }];
        expect(applyPeogYieldCap(cands, s)).toEqual(cands);
    });
});

describe('PEOG · applyPeogSpawnHintsCap（仅临近 ceiling 才封顶机会面）', () => {
    it('局初额度充裕 → 透传 multiClear/perfectClear/sizePreference（不封顶）；温暖 floor 仍生效', () => {
        const s = buildPeogState(makeProfile(), midHighCtx({ bestScoreAtRunStart: 1500 }), null);
        /* consumedYield=0 → remaining=1275 ≥ PB×hintsCapHeadroomRatio(0.25)=375 → 非临近 → 透传。 */
        const inCfg = {
            spawnHints: { multiClearBonus: 0.6, perfectClearBoost: 0.4, iconBonusTarget: 0, sizePreference: 0.7 },
        };
        const out = applyPeogSpawnHintsCap(inCfg, s);
        expect(out.spawnHints.multiClearBonus).toBeCloseTo(0.6);
        expect(out.spawnHints.perfectClearBoost).toBeCloseTo(0.4);
        expect(out.spawnHints.sizePreference).toBeCloseTo(0.7);
        expect(out.spawnHints.iconBonusTarget).toBeCloseTo(0.55); // max(0, floor=0.55)
        expect(out.spawnHints.peog.active).toBe(true);
        expect(out.spawnHints.peog.nearCeiling).toBe(false);
    });

    it('临近 ceiling → mild 封顶：multiClearBonus min(0.8,0.60)、perfectClearBoost min(0.5,0.35)、sizePreference min(0.7,0.60)', () => {
        const s = buildPeogState(makeProfile(), midHighCtx({ bestScoreAtRunStart: 1500 }), null);
        s.consumedYield = 1275; // remaining=0 < 375 → 临近 ceiling
        const inCfg = {
            spawnHints: { multiClearBonus: 0.8, perfectClearBoost: 0.5, iconBonusTarget: 0, sizePreference: 0.7 },
        };
        const out = applyPeogSpawnHintsCap(inCfg, s);
        expect(out.spawnHints.multiClearBonus).toBeCloseTo(0.60);
        expect(out.spawnHints.perfectClearBoost).toBeCloseTo(0.35);
        expect(out.spawnHints.sizePreference).toBeCloseTo(0.60);
        expect(out.spawnHints.iconBonusTarget).toBeCloseTo(0.55);
        expect(out.spawnHints.peog.nearCeiling).toBe(true);
        expect(out.spawnHints.peog.intensity).toBe('peog_mild');
    });

    it('strong + 临近 ceiling：perfectClearBoost 被钳为 0.15', () => {
        const s = buildPeogState(makeProfile(), midHighCtx({ bestScoreAtRunStart: 1500 }), null);
        s.intensity = 'peog_strong';
        s.consumedYield = 1275;
        const inCfg = { spawnHints: { perfectClearBoost: 0.8 } };
        const out = applyPeogSpawnHintsCap(inCfg, s);
        expect(out.spawnHints.perfectClearBoost).toBeCloseTo(0.15);
    });

    it('inactive 时直接透传输入', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        evaluatePeogActive(s, midHighCtx(), { needsRecovery: true });
        const inCfg = { spawnHints: { multiClearBonus: 0.6 } };
        expect(applyPeogSpawnHintsCap(inCfg, s)).toBe(inCfg);
    });

    it('临近 ceiling 时与 expertEarlyBoost 冲突：perfectClearBoost floor=0.5 被 PEOG cap=0.35 收紧', () => {
        const s = buildPeogState(makeProfile(), midHighCtx({ bestScoreAtRunStart: 1500 }), null);
        s.consumedYield = 1275; // 临近 ceiling 才施加封顶
        /* 模拟 expertEarlyBoost 已写入 floor=0.5；mild multiClearBonusCap(0.60) 不咬 0.5，
         * 但 perfectClearBoostCap(0.35) 会把 0.5 收到 0.35（PEOG cap 优先）。 */
        const inCfg = { spawnHints: { multiClearBonus: 0.5, perfectClearBoost: 0.5 } };
        const out = applyPeogSpawnHintsCap(inCfg, s);
        expect(out.spawnHints.multiClearBonus).toBe(0.5);          // min(0.5, 0.60) 未收紧
        expect(out.spawnHints.perfectClearBoost).toBeCloseTo(0.35); // min(0.5, 0.35)
    });
});

describe('PEOG · shouldShortCircuitConstructive', () => {
    it('peog_strong + kind=perfectClearTriplet → true', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        s.intensity = 'peog_strong';
        expect(shouldShortCircuitConstructive(s, 'perfectClearTriplet')).toBe(true);
    });

    it('peog_mild + kind=perfectClearTriplet → false（允许）', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        expect(shouldShortCircuitConstructive(s, 'perfectClearTriplet')).toBe(false);
    });

    it('inactive → false', () => {
        const s = { active: false };
        expect(shouldShortCircuitConstructive(s, 'perfectClearTriplet')).toBe(false);
    });
});

describe('PEOG · pickWarmTarget 在守卫 active 时的目标映射', () => {
    let grid;
    beforeEach(() => { grid = new Grid(); });

    it('近满线≥2 时：peog active → SETUP_FOR_MULTI（推迟一拍）；inactive → MULTI_CLEAR_NOW', () => {
        /* 构造两条近满线（差 1 格满）。 */
        for (let x = 0; x < 7; x++) grid.cells[0][x] = { colorIdx: 1 };
        for (let x = 0; x < 7; x++) grid.cells[1][x] = { colorIdx: 1 };
        const budget = buildWarmBudget('warm_strong');
        const peogState = { active: true, intensity: 'peog_mild' };
        const t1 = pickWarmTarget(grid, budget, { peogState });
        expect(t1).toBe(WARM_TARGETS.SETUP_FOR_MULTI);
        const t2 = pickWarmTarget(grid, budget, { peogState: null });
        expect(t2).toBe(WARM_TARGETS.MULTI_CLEAR_NOW);
    });

    it('PerfectClear 触发条件下：peog active → MULTI_CLEAR_NOW（不让 PerfectClear 一次性爆分）', () => {
        /* 填满除最后 10 格的盘面（remainingEmpty ≤ pcMaxCells=15 触发 PC 候选）。 */
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) grid.cells[y][x] = { colorIdx: 1 };
        }
        /* 留 10 个空格 */
        for (let i = 0; i < 10; i++) {
            const y = 7 - Math.floor(i / 8);
            const x = (8 - i % 8) % 8;
            grid.cells[y][x] = null;
        }
        const budget = buildWarmBudget('warm_rescue');
        const peogState = { active: true, intensity: 'peog_mild' };
        const t = pickWarmTarget(grid, budget, { peogState });
        expect(t).toBe(WARM_TARGETS.MULTI_CLEAR_NOW);
    });
});

describe('PEOG · buildWarmBudget 在 peogIntensity 注入时改写 guaranteedDelights', () => {
    it('peog_mild 注入 → multiClear:1, monoFlush:2, perfectClear:0', () => {
        const budget = buildWarmBudget('warm_strong', { peogIntensity: 'peog_mild' });
        expect(budget.guaranteedDelights).toEqual({ multiClear: 1, monoFlush: 2, perfectClear: 0 });
        expect(budget.peogIntensity).toBe('peog_mild');
    });

    it('peog_strong 注入 → multiClear:1, monoFlush:1, perfectClear:0', () => {
        const budget = buildWarmBudget('warm_strong', { peogIntensity: 'peog_strong' });
        expect(budget.guaranteedDelights).toEqual({ multiClear: 1, monoFlush: 1, perfectClear: 0 });
    });

    it('不注入 peogIntensity → 走原 warm_strong 配比', () => {
        const budget = buildWarmBudget('warm_strong');
        expect(budget.guaranteedDelights.perfectClear ?? 0).toBeGreaterThan(0);
        expect(budget.peogIntensity).toBeNull();
    });
});

describe('PEOG · Telemetry', () => {
    it('formatPeogTrace 区分 active / bypass 两态', () => {
        const s = buildPeogState(makeProfile(), midHighCtx(), null);
        expect(formatPeogTrace(s)).toMatch(/^peog:peog_mild/);
        evaluatePeogActive(s, midHighCtx(), { needsRecovery: true });
        expect(formatPeogTrace(s)).toBe('peog:bypass=recovery');
    });
});

/* ----- 跨端镜像（CJS 加载小程序源） -----
 * 模式同 tests/miniprogramCore.test.js：避开 ESM/CJS 互操作问题，用 vm 直接跑 CJS 源。 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const _cjsCache = new Map();
function _resolveCjs(request, basedir) {
    if (!request.startsWith('.')) return request;
    const base = path.resolve(basedir, request);
    const candidates = [`${base}.js`, `${base}.json`, base, path.join(base, 'index.js')];
    const match = candidates.find((p) => {
        try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
    });
    if (!match) throw new Error(`Cannot resolve ${request} from ${basedir}`);
    return match;
}
function _requireCjs(request, basedir = __dirname) {
    const filename = _resolveCjs(request, basedir);
    if (!path.isAbsolute(filename)) return nodeRequire(filename);
    if (_cjsCache.has(filename)) return _cjsCache.get(filename).exports;
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    const m = { exports: {} };
    _cjsCache.set(filename, m);
    const dir = path.dirname(filename);
    const localRequire = (n) => _requireCjs(n, dir);
    const src = fs.readFileSync(filename, 'utf8');
    const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${src}\n})`;
    vm.runInThisContext(wrapped, { filename })(m.exports, localRequire, m, filename, dir);
    return m.exports;
}

describe('PEOG · 跨端镜像同源（miniprogram/core/spawn/peog.js）', () => {
    it('mini 端 buildPeogState 与 web 同口径', () => {
        const mini = _requireCjs('../miniprogram/core/spawn/peog.js');
        const sMini = mini.buildPeogState(makeProfile(), midHighCtx(), null);
        const sWeb = buildPeogState(makeProfile(), midHighCtx(), null);
        expect(sMini.active).toBe(sWeb.active);
        expect(sMini.intensity).toBe(sWeb.intensity);
        expect(sMini.guardSpawns).toBe(sWeb.guardSpawns);
    });

    it('mini 端 estimateConstructiveYield 与 web 同公式', () => {
        const mini = _requireCjs('../miniprogram/core/spawn/peog.js');
        const cand = { clears: 3, lineKeys: ['r0', 'c0', 'r1'] };
        expect(mini.estimateConstructiveYield(cand)).toBe(estimateConstructiveYield(cand));
    });

    it('mini 端 PEOG_BYPASS_REASONS 与 web 一致（12 路）', () => {
        const mini = _requireCjs('../miniprogram/core/spawn/peog.js');
        expect(mini.PEOG_BYPASS_REASONS).toEqual(PEOG_BYPASS_REASONS);
    });
});
