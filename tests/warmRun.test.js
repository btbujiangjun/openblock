/**
 * @vitest-environment jsdom
 *
 * v1.70 温暖局（Warm Run）单元测试。
 *
 * 覆盖：
 *   - 触发器矩阵（T1~T7）
 *   - 强度合并（rescue > strong > mild）
 *   - 预算管理（build / consume / phase 推进）
 *   - 退出条件（minSpawns / multiClear / perfectClear / hintIgnore）
 *   - applyWarmRun 钳制器（shapeWeights / spawnHints / stress 上限）
 *   - 与 adaptiveSpawn.resolveAdaptiveStrategy 的端到端集成
 *   - constructiveSpawn 新增 3 个 API（multi/perfect/large）
 *   - intentResolver warm_run 规则的优先级（高于 pb_chase_pressure / relief）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    evaluateWarmTriggers,
    buildWarmBudget,
    consumeWarmBudget,
    getWarmPhase,
    shouldExitWarmRun,
    applyWarmRun,
    pickWarmTarget,
    formatWarmRunTrace,
    WARM_TARGETS,
    WARM_RUN_PRIORITY,
} from '../web/src/spawn/warmRun.js';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone, normalizeStress } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { Grid } from '../web/src/grid.js';
import { getAllShapes } from '../web/src/shapes.js';
import {
    findMultiClearCompleter,
    findPerfectClearTriplet,
    findLargeBlockCompleter,
} from '../web/src/bot/constructiveSpawn.js';
import { resolveIntent, INTENT_RULES } from '../web/src/derivation/intentResolver.js';

function makeProfile(overrides = {}) {
    const p = new PlayerProfile(15);
    if (overrides.lifetimePlacements != null) p._totalLifetimePlacements = overrides.lifetimePlacements;
    if (overrides.lifetimeGames != null) p._totalLifetimeGames = overrides.lifetimeGames;
    if (overrides.consecutiveNonClears != null) p._consecutiveNonClears = overrides.consecutiveNonClears;
    if (overrides.sessionHistory) p._sessionHistory = overrides.sessionHistory;
    if (overrides.installTs != null) p._installTs = overrides.installTs;
    if (overrides.lastSessionEndTs != null) p._lastSessionEndTs = overrides.lastSessionEndTs;
    return p;
}

describe('warmRun · 触发器矩阵', () => {
    it('T1 新手命中 → warm_strong', () => {
        const p = makeProfile({ lifetimePlacements: 10, lifetimeGames: 1 });
        const r = evaluateWarmTriggers(p, {});
        expect(r.hits.some((h) => h.id === 'T1_newbie')).toBe(true);
        expect(r.intensity).toBe('warm_strong');
    });

    it('T8 买量分流承接（isPaidChannel 首会话）命中 → warm_rescue', () => {
        const p = makeProfile({ lifetimePlacements: 500, lifetimeGames: 1 });
        const r = evaluateWarmTriggers(p, { isPaidChannel: true });
        expect(r.hits.some((h) => h.id === 'T8_paid_acquisition')).toBe(true);
        expect(r.intensity).toBe('warm_rescue');
    });

    it('T8 自然量（isPaidChannel=false）不命中', () => {
        const p = makeProfile({ lifetimePlacements: 500, lifetimeGames: 1 });
        const r = evaluateWarmTriggers(p, { isPaidChannel: false });
        expect(r.hits.some((h) => h.id === 'T8_paid_acquisition')).toBe(false);
    });

    it('T8 付费但已过保护局数（lifetimeGames≥maxRunsProtected）不命中', () => {
        const p = makeProfile({ lifetimePlacements: 500, lifetimeGames: 10 });
        const r = evaluateWarmTriggers(p, { isPaidChannel: true });
        expect(r.hits.some((h) => h.id === 'T8_paid_acquisition')).toBe(false);
    });

    it('T3 单局连挫（consecutiveNonClears≥6）命中 → warm_strong', () => {
        const p = makeProfile({ lifetimePlacements: 500, lifetimeGames: 50, consecutiveNonClears: 6 });
        const r = evaluateWarmTriggers(p, {});
        expect(r.hits.some((h) => h.id === 'T3_frustration_run')).toBe(true);
        expect(r.intensity).toBe('warm_strong');
    });

    it('T2 回流（≥3 天未玩）+ T6 winback 同时命中时取 rescue', () => {
        const p = makeProfile({
            lifetimePlacements: 500,
            lifetimeGames: 50,
            lastSessionEndTs: Date.now() - 5 * 86_400_000,
        });
        const r = evaluateWarmTriggers(p, { runsAfterReturn: 0, winbackActive: true });
        expect(r.hits.some((h) => h.id === 'T2_returning')).toBe(true);
        expect(r.hits.some((h) => h.id === 'T6_winback_pack')).toBe(true);
        expect(r.intensity).toBe('warm_rescue');
    });

    it('T5 流失高危单独命中 → warm_mild', () => {
        const p = makeProfile({ lifetimePlacements: 500, lifetimeGames: 50 });
        const r = evaluateWarmTriggers(p, { churnRisk: 0.8 });
        expect(r.hits.some((h) => h.id === 'T5_churn_imminent')).toBe(true);
        expect(r.intensity).toBe('warm_mild');
    });

    it('高熟玩家无触发器命中 → intensity=null', () => {
        const p = makeProfile({ lifetimePlacements: 5000, lifetimeGames: 200, consecutiveNonClears: 0 });
        const r = evaluateWarmTriggers(p, {});
        expect(r.intensity).toBe(null);
        expect(r.hits.length).toBe(0);
    });

    it('多触发器合并取最高强度（mild < strong < rescue）', () => {
        const p = makeProfile({
            lifetimePlacements: 10,        // T1 strong
            lifetimeGames: 1,
            lastSessionEndTs: Date.now() - 5 * 86_400_000, // T2 rescue
        });
        const r = evaluateWarmTriggers(p, { runsAfterReturn: 0, churnRisk: 0.9 });
        expect(r.intensity).toBe('warm_rescue');
    });
});

describe('warmRun · 预算管理', () => {
    it('buildWarmBudget 返回合理结构', () => {
        const b = buildWarmBudget('warm_strong');
        expect(b.intensity).toBe('warm_strong');
        expect(b.maxSpawns).toBeGreaterThan(0);
        expect(b.phaseSplit).toHaveLength(3);
        expect(b.consumedDelights).toEqual({ multiClear: 0, monoFlush: 0, perfectClear: 0 });
        expect(b.guaranteedDelights.multiClear).toBeGreaterThanOrEqual(1);
    });

    it('getWarmPhase 按 spawnsUsed/maxSpawns 比例返回 early/mid/late', () => {
        const b = buildWarmBudget('warm_strong');
        b.spawnsUsed = 0;
        expect(getWarmPhase(b)).toBe('early');
        b.spawnsUsed = Math.ceil(b.maxSpawns * 0.5);
        expect(getWarmPhase(b)).toBe('mid');
        b.spawnsUsed = Math.ceil(b.maxSpawns * 0.95);
        expect(getWarmPhase(b)).toBe('late');
        b.spawnsUsed = b.maxSpawns + 1;
        expect(getWarmPhase(b)).toBe('expired');
    });

    /* v1.70.1 拆分：spawnsUsed 仅由 { countSpawn: true } 推进；delights/hintIgnored
     * 与 spawn 解耦（onPlace 三次落子可在同一组 spawn 内累加多次 delight）。 */
    it('consumeWarmBudget(countSpawn) 推进 spawnsUsed；delights/hintIgnored 独立累加', () => {
        const b = buildWarmBudget('warm_mild');
        consumeWarmBudget(b, { countSpawn: true });
        consumeWarmBudget(b, { countSpawn: true });
        consumeWarmBudget(b, { multiClear: true });
        consumeWarmBudget(b, { perfectClear: true });
        consumeWarmBudget(b, { hintIgnored: true });
        expect(b.spawnsUsed).toBe(2);
        expect(b.consumedDelights.multiClear).toBe(1);
        expect(b.consumedDelights.perfectClear).toBe(1);
        expect(b.hintIgnoreStreak).toBe(1);
        consumeWarmBudget(b, { hintIgnored: false });
        expect(b.hintIgnoreStreak).toBe(0);
    });

    it('落子事件（不带 countSpawn）不动 spawnsUsed', () => {
        const b = buildWarmBudget('warm_strong');
        b.spawnsUsed = 5;
        consumeWarmBudget(b, { multiClear: true });
        consumeWarmBudget(b, { hintIgnored: true });
        consumeWarmBudget(b, { hintIgnored: true });
        expect(b.spawnsUsed).toBe(5);
        expect(b.consumedDelights.multiClear).toBe(1);
        expect(b.hintIgnoreStreak).toBe(2);
    });
});

describe('warmRun · 退出条件', () => {
    it('minSpawnsBeforeExit 前不退出，即使 perfectClear 已达标', () => {
        const b = buildWarmBudget('warm_strong');
        b.spawnsUsed = 2; // < minSpawnsBeforeExit(6)
        b.consumedDelights.perfectClear = 5;
        expect(shouldExitWarmRun(b, {}).exit).toBe(false);
    });

    it('perfectClear ≥ 1 且 spawnsUsed ≥ 6 时退出', () => {
        const b = buildWarmBudget('warm_strong');
        b.spawnsUsed = 8;
        b.consumedDelights.perfectClear = 1;
        const r = shouldExitWarmRun(b, {});
        expect(r.exit).toBe(true);
        expect(r.reason).toBe('perfect-clear-hit');
    });

    it('budget 用尽时退出', () => {
        const b = buildWarmBudget('warm_mild');
        b.spawnsUsed = b.maxSpawns;
        const r = shouldExitWarmRun(b, {});
        expect(r.exit).toBe(true);
        expect(r.reason).toBe('budget-exhausted');
    });

    it('hintIgnoreStreak ≥ 3 时降级退出', () => {
        const b = buildWarmBudget('warm_strong');
        b.hintIgnoreStreak = 3;
        b.spawnsUsed = 4;
        const r = shouldExitWarmRun(b, {});
        expect(r.exit).toBe(true);
        expect(r.reason).toBe('hint-ignored');
    });
});

describe('warmRun · applyWarmRun 钳制器', () => {
    function makeBaseConfig() {
        return {
            shapeWeights: { lines: 2.0, rects: 1.5, squares: 1.4, tshapes: 1.2, zshapes: 1.2, lshapes: 1.2, jshapes: 1.2 },
            spawnHints: {
                clearGuarantee: 0,
                sizePreference: 0,
                multiClearBonus: 0.1,
                iconBonusTarget: 0.1,
                perfectClearBoost: 0.05,
                delightBoost: 0.0,
                reliefUrgent: false,
                spawnIntent: 'maintain',
            },
            _adaptiveStress: 0.5,
            _adaptiveStressRaw: 0.4,
            _stressBreakdown: {},
        };
    }

    it('未激活时透传（不 mutate）', () => {
        const cfg = makeBaseConfig();
        const out = applyWarmRun(cfg, { warmRunState: null });
        expect(out).toBe(cfg);
    });

    it('warm_strong 激活时 stress 被钳到 ≤ -0.10', () => {
        const cfg = makeBaseConfig();
        const state = { active: true, intensity: 'warm_strong', budget: buildWarmBudget('warm_strong'), triggerIds: ['T1_newbie'] };
        const out = applyWarmRun(cfg, { warmRunState: state });
        expect(out._adaptiveStressRaw).toBeLessThanOrEqual(-0.10 + 1e-9);
        expect(out._adaptiveStress).toBeLessThanOrEqual(normalizeStress(-0.10) + 1e-9);
    });

    it('warm_rescue 把 T/Z 权重压到 0（forbidJagged）', () => {
        const cfg = makeBaseConfig();
        const state = { active: true, intensity: 'warm_rescue', budget: buildWarmBudget('warm_rescue'), triggerIds: ['T2_returning'] };
        const out = applyWarmRun(cfg, { warmRunState: state });
        expect(out.shapeWeights.tshapes).toBeLessThanOrEqual(0.05);
        expect(out.shapeWeights.zshapes).toBeLessThanOrEqual(0.05);
        expect(out.shapeWeights.lines).toBeGreaterThanOrEqual(3.5);
    });

    it('spawnHints 被抬到强度下限', () => {
        const cfg = makeBaseConfig();
        const state = { active: true, intensity: 'warm_strong', budget: buildWarmBudget('warm_strong'), triggerIds: ['T3_frustration_run'] };
        const out = applyWarmRun(cfg, { warmRunState: state });
        expect(out.spawnHints.clearGuarantee).toBeGreaterThanOrEqual(1);
        expect(out.spawnHints.multiClearBonus).toBeGreaterThan(0.1);
        expect(out.spawnHints.spawnIntent).toBe('warm');
        expect(out.spawnHints.warmRun.active).toBe(true);
        expect(out.spawnHints.warmRun.intensity).toBe('warm_strong');
    });

    it('返回新对象，不 mutate 输入', () => {
        const cfg = makeBaseConfig();
        const origWeights = JSON.stringify(cfg.shapeWeights);
        const state = { active: true, intensity: 'warm_strong', budget: buildWarmBudget('warm_strong'), triggerIds: [] };
        applyWarmRun(cfg, { warmRunState: state });
        expect(JSON.stringify(cfg.shapeWeights)).toBe(origWeights);
    });
});

describe('warmRun · pickWarmTarget', () => {
    it('棋盘只剩少量空格（≤ 15）+ 预算需要 perfectClear → PERFECT_CLEAR', () => {
        const g = new Grid(8);
        /* 填满 52 格，留 12 格空 → 满足 remainingEmpty ≤ 15 */
        let filled = 0;
        for (let y = 0; y < 8 && filled < 52; y++) {
            for (let x = 0; x < 8 && filled < 52; x++) {
                g.cells[y][x] = { icon: 'r' };
                filled++;
            }
        }
        const b = buildWarmBudget('warm_strong');
        b.guaranteedDelights.perfectClear = 1;
        b.consumedDelights.perfectClear = 0;
        const t = pickWarmTarget(g, b);
        expect(t).toBe(WARM_TARGETS.PERFECT_CLEAR);
    });

    it('低填充 + early phase → SETUP_FOR_MULTI', () => {
        const g = new Grid(8);
        for (let i = 0; i < 6; i++) g.cells[7][i] = { icon: 'r' };
        const b = buildWarmBudget('warm_mild');
        b.consumedDelights.perfectClear = 999;
        const t = pickWarmTarget(g, b);
        expect([WARM_TARGETS.SETUP_FOR_MULTI, WARM_TARGETS.COMFORT_FLOW]).toContain(t);
    });
});

describe('warmRun · intentResolver 集成', () => {
    it('warm_run 规则优先级最高（115 > pb_chase_pressure 102 > relief 100）', () => {
        const warmRule = INTENT_RULES.find((r) => r.id === 'warm_run');
        expect(warmRule).toBeDefined();
        expect(warmRule.priority).toBe(WARM_RUN_PRIORITY);
        expect(warmRule.priority).toBeGreaterThan(102);
    });

    it('warmRunActive=true 时 intent → warm，覆盖 relief 与 pressure', () => {
        const r = resolveIntent({
            warmRunActive: true,
            warmRunIntensity: 'warm_strong',
            warmRunPhase: 'early',
            warmRunTriggers: ['T1_newbie'],
            playerDistress: -0.5,          // 同时会触发 relief
            pbChasePressureActive: true,   // 同时会触发 pb_chase_pressure
        });
        expect(r.intent).toBe('warm_run');
        expect(r.spawnIntent).toBe('warm');
    });

    it('warmRunActive=false 时不影响其他规则', () => {
        const r = resolveIntent({
            warmRunActive: false,
            playerDistress: -0.5,
        });
        expect(r.intent).toBe('relief');
    });
});

describe('warmRun · constructiveSpawn 三个新 API', () => {
    const allShapes = getAllShapes();

    it('findLargeBlockCompleter 在空棋盘上能返回多个大块放置', () => {
        const g = new Grid(8);
        const r = findLargeBlockCompleter(g, allShapes, { minSize: 4, maxResults: 5 });
        expect(r.length).toBeGreaterThan(0);
        for (const x of r) {
            expect(x.size).toBeGreaterThanOrEqual(4);
        }
    });

    it('findMultiClearCompleter 找出能补满 ≥2 行的形状', () => {
        const g = new Grid(8);
        for (let x = 0; x < 7; x++) g.cells[0][x] = { icon: 'r' };
        for (let x = 0; x < 7; x++) g.cells[1][x] = { icon: 'r' };
        const r = findMultiClearCompleter(g, allShapes, { minClears: 2, maxResults: 3 });
        expect(r.length).toBeGreaterThan(0);
        expect(r[0].clears).toBeGreaterThanOrEqual(2);
    });

    it('findPerfectClearTriplet 在棋盘几近空时能找到清屏三连', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = { icon: 'r' };
        for (let i = 0; i < 6; i++) g.cells[0][i] = null;
        const r = findPerfectClearTriplet(g, allShapes, { maxRemaining: 6, budget: 5000, topK: 15 });
        expect(Array.isArray(r)).toBe(true);
    });
});

describe('warmRun · 端到端集成 resolveAdaptiveStrategy', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('T1 新手命中后 enhancedConfig.spawnHints.warmRun.active=true', () => {
        const p = makeProfile({ lifetimePlacements: 5, lifetimeGames: 0 });
        const budget = buildWarmBudget('warm_strong');
        const out = resolveAdaptiveStrategy('normal', p, 0, 0, 0, {
            warmRunState: { active: true, intensity: 'warm_strong', budget, triggerIds: ['T1_newbie'] },
        });
        expect(out.spawnHints?.warmRun?.active).toBe(true);
        expect(out.spawnHints?.spawnIntent).toBe('warm');
        expect(out._warmRunActive).toBe(true);
    });

    it('未激活温暖局时 spawnHints.warmRun 缺省', () => {
        const p = makeProfile({ lifetimePlacements: 5000, lifetimeGames: 200 });
        const out = resolveAdaptiveStrategy('normal', p, 100, 0, 0, {});
        expect(out.spawnHints?.warmRun).toBeFalsy();
        expect(out._warmRunActive).toBe(false);
    });
});

describe('warmRun · 工具函数', () => {
    it('formatWarmRunTrace 输出包含 intensity / phase / delights', () => {
        const b = buildWarmBudget('warm_strong');
        b.spawnsUsed = 4;
        b.consumedDelights = { multiClear: 1, monoFlush: 0, perfectClear: 0 };
        const s = formatWarmRunTrace({ active: true, intensity: 'warm_strong', budget: b, triggerIds: ['T1_newbie'] });
        expect(s).toContain('warm_strong');
        expect(s).toContain('mc1');
    });
});
