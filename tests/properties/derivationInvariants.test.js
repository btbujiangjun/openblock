/**
 * derivationInvariants.test.js — v1.58 派生层性质测试（Property-Based Testing）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计动机
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * v1.57.5 的 6 项 bug（占盘双显 / 盘面通透撒谎 / chip 高亮但被覆盖 / 笑脸 vs 紧盘面…）
 * 都属于"我没想到这种状态组合"——单元测试覆盖不全，需要靠用户截图反馈才能发现。
 *
 * 性质测试用 fast-check 自动生成 **10k+ 随机状态组合** 扫描"系统永远应该
 * 满足的不变式"。每条不变式失败时 fast-check 会自动 **shrink** 到最小反例，
 * 直接告诉你"在 stress=0.123, fill=0.65, intent='relief' 时，emoji 不应该是 😊"。
 *
 * 这是 v1.58 派生层 + contract DSL 真正长期生效的关键——任何后续新增
 * intent / breakdown 信号 / 文案变体 都会自动获得这些不变式的保护。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 不变式清单（10 条）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * §1 派生层结构不变式
 *   I1. resolveIntent 与 adaptiveSpawn.deriveSpawnIntent 行为完全等价
 *   I2. resolveIntent.overrides 永不包含 winner 本身
 *   I3. resolveIntent.trace 长度恒等于 INTENT_RULES.length，winner 唯一
 *
 * §2 文案-几何一致性不变式（B 类 bug 的根源约束）
 *   I4. "盘面通透" 字样的 narrative 永远不在 fill >= 0.5 时出现
 *   I5. "密集消行机会" 字样永远不在 nearFullLines < 2 时出现
 *
 * §3 情绪-几何一致性不变式（G 类 bug 的根源约束）
 *   I6. emoji 😊 (calm) / 🙂 (easy) 永远不在 fill >= 0.65 时出现
 *   I7. 任何 emoji 都不在 lateCollapse / frustCritical 触发时使用基础 face（必须 struggling）
 *
 * §4 chip-intent 一致性不变式（D 类 bug 的根源约束）
 *   I8. afkEngage chip 在 intent=relief 时若 on=true 则必 overridden=true
 *   I9. 任何 chip 的 overridden 状态都蕴含 on=true（被覆盖意味着曾经激活）
 *
 * §5 反差检测不变式
 *   I10. boardRisk>=0.6 时 narrative 永远是"保活"类（不能是"享受多消"）
 *
 * §6 节奏承诺-几何兑现一致性（v1.58.1 截图 bug 后追加）
 *   I11. flow.payoff.ready 命中时 geometry.harvestReady 必为 true
 *   I12. 跨 contract：任何含"享受多消/收获期"字样的 narrative 命中时，
 *        必有 nearFullLines + multiClearCandidates + pcSetup >= 1
 *
 * §7 算法信号-盘面几何反差（v1.58.2 截图 2 治理）
 *   I13. struggling emoji 命中时 distress.boardFill 必 >= 0.45
 *   I13b. concerned emoji 命中时算法侧信号必至少一条触发
 *   I14. "本局接近收尾" 字样的 narrative 命中时 geometry.boardFill 必 >= 0.45
 *
 * §8 DFV chip 自描述化（v1.58.3 截图 3 治理）
 *   I15. forceRelief chip 亮时，至少有 1 个上游 chip 同时亮
 *   I16. 任何 chip on=true 时 title 必非空
 *   I17. flowState='bored' 且 intent='relief' 时 conflicts 必含 flowVsIntent
 *
 * §9 全系统自查残留修补（v1.58.4）
 *   I18. "盘面空洞偏多" 字样的 narrative 命中时 geometry.holes 必 >= 1
 *   I19. "盘面压力较高" 字样的 narrative 命中时 geometry.boardFill 必 >= 0.45
 *   I20. "进入高压区" 字样的 narrative 命中时 geometry.boardFill 必 >= 0.45
 *   I21. harvest.default 兜底 narrative 不能含 "密集" / "已识别"（避免虚假承诺）
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { resolveIntent, INTENT_RULES } from '../../web/src/derivation/intentResolver.js';
import { selectNarrative, selectEmoji } from '../../web/src/derivation/displayContracts.js';
import { reducePresentation } from '../../web/src/derivation/presentationReducer.js';
import { deriveSpawnIntent } from '../../web/src/adaptiveSpawn.js';

const NUM_RUNS = 1500; // 单条性质 1500 次足够覆盖典型边界；CI 可调更高

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  生成器：典型 game state                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

const arbIntentInputs = fc.record({
    playerDistress:      fc.float({ min: Math.fround(-0.30), max: Math.fround(0.30), noNaN: true }),
    forceReliefIntent:   fc.boolean(),
    afkEngageActive:     fc.boolean(),
    challengeBoost:      fc.float({ min: 0, max: Math.fround(0.25), noNaN: true }),
    delightMode:         fc.constantFrom(null, 'relief', 'flow_payoff', 'challenge_payoff'),
    rhythmPhase:         fc.constantFrom('setup', 'payoff', 'neutral'),
    stress:              fc.float({ min: 0, max: 1, noNaN: true }),
});

const arbGeometry = fc.record({
    fill:                 fc.float({ min: 0, max: 1, noNaN: true }),
    boardFill:            fc.float({ min: 0, max: 1, noNaN: true }),
    holes:                fc.integer({ min: 0, max: 30 }),
    nearFullLines:        fc.integer({ min: 0, max: 10 }),
    multiClearCandidates: fc.integer({ min: 0, max: 10 }),
    pcSetup:              fc.integer({ min: 0, max: 3 }),
}).map((g) => ({
    ...g,
    /* v1.58.1：harvestReady 与 selectReducerInputs 同源派生（避免性质测试与
     * 运行时口径漂移；同时让 random arb 自动覆盖此字段而无需手写组合）。 */
    harvestReady: (g.nearFullLines >= 1) || (g.multiClearCandidates >= 1) || (g.pcSetup >= 1),
}));

const arbBreakdown = fc.record({
    boardRisk:                fc.float({ min: 0, max: 1, noNaN: true }),
    friendlyBoardRelief:      fc.float({ min: Math.fround(-0.30), max: 0, noNaN: true }),
    endSessionDistress:       fc.float({ min: Math.fround(-0.30), max: 0, noNaN: true }),
    holeReliefAdjust:         fc.float({ min: Math.fround(-0.30), max: 0, noNaN: true }),
    boardRiskReliefAdjust:    fc.float({ min: Math.fround(-0.30), max: 0, noNaN: true }),
    bottleneckRelief:         fc.float({ min: Math.fround(-0.30), max: 0, noNaN: true }),
    frustrationRelief:        fc.float({ min: Math.fround(-0.30), max: 0, noNaN: true }),
    recoveryAdjust:           fc.float({ min: Math.fround(-0.30), max: 0, noNaN: true }),
    nearMissAdjust:           fc.float({ min: Math.fround(-0.30), max: 0, noNaN: true }),
}, { requiredKeys: [] });

/* 完整的"reducer 上下文" arbitrary —— 与 selectReducerInputs 返回结构对齐 */
const arbReducerCtx = fc.record({
    intent:    fc.constantFrom('relief', 'engage', 'harvest', 'pressure', 'sprint', 'flow', 'maintain'),
    stress:    fc.float({ min: 0, max: 1, noNaN: true }),
    geometry:  arbGeometry,
    breakdown: arbBreakdown,
    hints:     fc.record({
        rhythmPhase: fc.constantFrom('setup', 'payoff', 'neutral'),
    }, { requiredKeys: [] }),
    distress: fc.record({
        sessionPhase:     fc.constantFrom('early', 'mid', 'late'),
        momentum:         fc.float({ min: -1, max: 1, noNaN: true }),
        frustrationLevel: fc.integer({ min: 0, max: 8 }),
        boardFill:        fc.float({ min: 0, max: 1, noNaN: true }),
    }),
});

/* mock game 用于 reducePresentation 端到端 */
const arbGame = fc.record({
    fill:           fc.float({ min: 0, max: 1, noNaN: true }),
    clearRate:      fc.float({ min: 0, max: Math.fround(0.5), noNaN: true }),
    stress:         fc.float({ min: 0, max: 1, noNaN: true }),
    intent:         fc.constantFrom('relief', 'engage', 'harvest', 'pressure', 'sprint', 'flow', 'maintain'),
    playerDistress: fc.float({ min: Math.fround(-0.30), max: Math.fround(0.30), noNaN: true }),
    afkEngageActive:fc.boolean(),
    sessionPhase:   fc.constantFrom('early', 'mid', 'late'),
    momentum:       fc.float({ min: -1, max: 1, noNaN: true }),
    frustrationLevel: fc.integer({ min: 0, max: 8 }),
    nearFullLines:  fc.integer({ min: 0, max: 5 }),
    breakdown:      arbBreakdown,
}).map((p) => ({
    grid: { getFillRatio: () => p.fill },
    playerProfile: {
        metrics: { clearRate: p.clearRate, missRate: 0 },
        sessionPhase: p.sessionPhase,
        momentum: p.momentum,
        frustrationLevel: p.frustrationLevel,
        isInOnboarding: false,
    },
    _lastAdaptiveInsight: {
        stress: p.stress,
        spawnIntent: p.intent,
        spawnHints: { spawnIntent: p.intent },
        spawnDiagnostics: { layer1: { fill: p.fill, holes: 0, nearFullLines: p.nearFullLines, multiClearCandidates: 0, pcSetup: 0 } },
        stressBreakdown: p.breakdown,
        _intentInputs: {
            playerDistress: p.playerDistress,
            afkEngageActive: p.afkEngageActive,
            stress: p.stress,
        },
        afkEngageActive: p.afkEngageActive,
        sessionPhase: p.sessionPhase,
        momentum: p.momentum,
        frustrationLevel: p.frustrationLevel,
        scoreMilestoneHit: false,
        personalizationApplied: false,
    },
    _p: p,
}));

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §1 派生层结构不变式                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58 性质 §1: 派生层结构', () => {
    it('I1. resolveIntent 与 deriveSpawnIntent 行为完全等价', () => {
        fc.assert(fc.property(
            arbIntentInputs, arbGeometry,
            (intentInp, geom) => {
                const inputs = { ...intentInp, geometry: geom };
                expect(resolveIntent(inputs).intent).toBe(deriveSpawnIntent(inputs));
            },
        ), { numRuns: NUM_RUNS });
    });

    it('I2. overrides 永不包含 winner 本身', () => {
        fc.assert(fc.property(
            arbIntentInputs, arbGeometry,
            (intentInp, geom) => {
                const r = resolveIntent({ ...intentInp, geometry: geom });
                expect(r.overrides.has(r.intent)).toBe(false);
            },
        ), { numRuns: NUM_RUNS });
    });

    it('I3. trace 长度恒等于 INTENT_RULES.length，winner 唯一', () => {
        fc.assert(fc.property(
            arbIntentInputs, arbGeometry,
            (intentInp, geom) => {
                const r = resolveIntent({ ...intentInp, geometry: geom });
                expect(r.trace.length).toBe(INTENT_RULES.length);
                expect(r.trace.filter((t) => t.isWinner).length).toBe(1);
            },
        ), { numRuns: NUM_RUNS });
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §2 文案-几何一致性                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58 性质 §2: 文案-几何一致性', () => {
    it('I4. "盘面通透/可消行机会" 字样永远不在 boardFill >= 0.5 时由 relief.friendly 输出', () => {
        fc.assert(fc.property(arbReducerCtx, (ctx) => {
            const r = selectNarrative(ctx);
            if (r.contract?.id === 'relief.friendly') {
                /* friendly 契约要求 boardFill < 0.5 —— 若胜出，必须满足 */
                expect(ctx.geometry.boardFill).toBeLessThan(0.5);
            }
        }), { numRuns: NUM_RUNS });
    });

    it('I5. "密集消行机会" 字样永远不在 nearFullLines < 2 时由 harvest.dense 输出', () => {
        fc.assert(fc.property(arbReducerCtx, (ctx) => {
            const r = selectNarrative(ctx);
            if (r.contract?.id === 'harvest.dense') {
                expect(ctx.geometry.nearFullLines).toBeGreaterThanOrEqual(3);
            }
        }), { numRuns: NUM_RUNS });
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §3 情绪-几何一致性                                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58 性质 §3: 情绪-几何一致性', () => {
    it('I6. emoji 基础 calm(😌) / easy(🙂) 永远不在 boardFill >= 0.66 时出现（≥0.65 + 1% 浮点容差）', () => {
        /* 注意：crowded 契约守卫是 boardFill >= 0.65；本不变式留 1% 容差
         * 避免浮点边界（如 0.64999...）触发误报。0.66 起属于"明显紧"区间。 */
        fc.assert(fc.property(
            fc.float({ min: 0, max: Math.fround(0.332), noNaN: true }),   // stress in calm/easy
            fc.float({ min: Math.fround(0.66), max: 1, noNaN: true }),    // fill 明显紧（留容差）
            fc.constantFrom('relief', 'engage', 'flow', 'maintain'),       // 任意非 distress intent
            fc.integer({ min: 0, max: 2 }),                                // 非临界 frustration
            (stress, boardFill, intent, frustration) => {
                /* 排除 lateCollapse / frustCritical 触发 struggling 的场景，
                 * 单测"低 stress + 高 fill → 应该 crowded 而非基础笑脸" */
                fc.pre(frustration < 5);
                const r = selectEmoji({
                    stress, intent,
                    distress: { boardFill, sessionPhase: 'mid', momentum: 0, frustrationLevel: frustration },
                });
                expect(['😊', '🙂', '😌']).not.toContain(r.output?.face);
            },
        ), { numRuns: NUM_RUNS });
    });

    it('I7 (v1.58.2 升级). lateCollapse 或 frustCritical 触发 + boardFill>=0.46 永远是 struggling face', () => {
        /* v1.58.2：原 I7 要求"算法侧信号触发必 struggling"；本次加 boardFill>=0.45 pre，
         * 反映 v1.58.2 拆分：盘面真有压力时 → struggling；盘面通透时 → concerned 中间档（见 I13）。
         * 注意：unsubstantial 浮点容差，min 用 0.46 避开 fc.float 在 0.45 边界返回 0.44999... 的边界。 */
        fc.assert(fc.property(
            fc.float({ min: 0, max: Math.fround(0.332), noNaN: true }),
            fc.float({ min: Math.fround(0.46), max: 1, noNaN: true }),  // ← 留 1% 容差
            fc.oneof(
                fc.record({ sessionPhase: fc.constant('late'), momentum: fc.float({ min: -1, max: Math.fround(-0.30), noNaN: true }), frustrationLevel: fc.integer({ min: 0, max: 4 }) }),
                fc.record({ sessionPhase: fc.constantFrom('early', 'mid', 'late'), momentum: fc.float({ min: -1, max: 1, noNaN: true }), frustrationLevel: fc.integer({ min: 5, max: 8 }) }),
            ),
            (stress, boardFill, dis) => {
                const r = selectEmoji({
                    stress, intent: 'relief',
                    distress: { ...dis, boardFill },
                });
                expect(r.output?.id).toBe('struggling');
                expect(r.output?.face).toBe('😣');
            },
        ), { numRuns: NUM_RUNS });
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §4 chip-intent 一致性                                                        */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58 性质 §4: chip-intent 一致性', () => {
    it('I8. afkEngage chip 在 intent=relief 且 on=true 时 overridden 必为 true', () => {
        fc.assert(fc.property(arbGame, (game) => {
            const model = reducePresentation(game);
            const afk = model.chips.find((c) => c.id === 'afkEngage');
            if (model.intent.intent === 'relief' && afk.on) {
                expect(afk.overridden).toBe(true);
            }
        }), { numRuns: NUM_RUNS });
    });

    it('I9. 任何 chip 的 overridden 状态都蕴含 on=true', () => {
        fc.assert(fc.property(arbGame, (game) => {
            const model = reducePresentation(game);
            for (const c of model.chips) {
                if (c.overridden) expect(c.on).toBe(true);
            }
        }), { numRuns: NUM_RUNS });
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §5 极端守卫不变式                                                             */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58 性质 §5: 极端守卫', () => {
    it('I10. boardRisk>=0.6 时 narrative 永远是"保活/紧张"类（不能是"享受多消/收获期"）', () => {
        fc.assert(fc.property(
            arbReducerCtx,
            fc.float({ min: Math.fround(0.6), max: 1, noNaN: true }),
            (ctx, br) => {
                const c2 = { ...ctx, breakdown: { ...ctx.breakdown, boardRisk: br } };
                const r = selectNarrative(c2);
                expect(r.contract?.id).toBe('boardRisk.critical');
                expect(r.text).toMatch(/保活|紧张/);
                expect(r.text).not.toMatch(/享受多消|收获期/);
            },
        ), { numRuns: NUM_RUNS });
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §6 节奏承诺-几何兑现一致性（v1.58.1 截图 bug 治理）                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58.1 性质 §6: 节奏承诺-几何兑现一致性', () => {
    it('I11. flow.payoff.ready 命中时 geometry.harvestReady 必为 true', () => {
        fc.assert(fc.property(arbReducerCtx, (ctx) => {
            const r = selectNarrative(ctx);
            if (r.contract?.id === 'flow.payoff.ready') {
                expect(ctx.geometry.harvestReady).toBe(true);
            }
        }), { numRuns: NUM_RUNS });
    });

    it('I12. 跨 contract：任何含"享受多消/收获期"字样的 narrative 命中时，必有 nearFullLines+mcc+pcSetup>=1', () => {
        fc.assert(fc.property(arbReducerCtx, (ctx) => {
            const r = selectNarrative(ctx);
            if (r.text && /享受多消|收获期/.test(r.text)) {
                const geom = ctx.geometry;
                const sum = (Number(geom.nearFullLines) || 0)
                    + (Number(geom.multiClearCandidates) || 0)
                    + (Number(geom.pcSetup) || 0);
                expect(sum).toBeGreaterThanOrEqual(1);
            }
        }), { numRuns: NUM_RUNS });
    });

    it('I12b. 跨 contract：含"享受多消"字样的 narrative 命中时，harvestReady 必为 true', () => {
        fc.assert(fc.property(arbReducerCtx, (ctx) => {
            const r = selectNarrative(ctx);
            if (r.text && /享受多消/.test(r.text)) {
                expect(ctx.geometry.harvestReady).toBe(true);
            }
        }), { numRuns: NUM_RUNS });
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §7 算法信号-盘面几何反差治理（v1.58.2 截图 2 治理）                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58.2 性质 §7: 算法信号-盘面几何反差', () => {
    it('I13. struggling emoji（id="struggling"）命中时，distress.boardFill 必 >= 0.45', () => {
        fc.assert(fc.property(
            fc.float({ min: 0, max: 1, noNaN: true }),
            fc.constantFrom('relief', 'engage', 'flow', 'maintain'),
            fc.record({
                sessionPhase:     fc.constantFrom('early', 'mid', 'late'),
                momentum:         fc.float({ min: -1, max: 1, noNaN: true }),
                frustrationLevel: fc.integer({ min: 0, max: 8 }),
                boardFill:        fc.float({ min: 0, max: 1, noNaN: true }),
            }),
            (stress, intent, distress) => {
                const r = selectEmoji({ stress, intent, distress });
                if (r.output?.id === 'struggling') {
                    expect(distress.boardFill).toBeGreaterThanOrEqual(0.45);
                }
            },
        ), { numRuns: NUM_RUNS });
    });

    it('I13b. concerned emoji（v1.58.2 新增中间档）命中时，算法侧信号必至少一条触发', () => {
        fc.assert(fc.property(
            fc.float({ min: 0, max: Math.fround(0.332), noNaN: true }),
            fc.constantFrom('relief', 'flow'),
            fc.record({
                sessionPhase:     fc.constantFrom('early', 'mid', 'late'),
                momentum:         fc.float({ min: -1, max: 1, noNaN: true }),
                frustrationLevel: fc.integer({ min: 0, max: 8 }),
                boardFill:        fc.float({ min: 0, max: 1, noNaN: true }),
            }),
            (stress, intent, distress) => {
                const r = selectEmoji({ stress, intent, distress });
                if (r.output?.id === 'concerned') {
                    /* concerned 触发条件：late+momentum<=-0.30 OR frustrationLevel>=5 */
                    const hasLateSignal = distress.sessionPhase === 'late' && distress.momentum <= -0.30;
                    const hasFrustSignal = distress.frustrationLevel >= 5;
                    expect(hasLateSignal || hasFrustSignal).toBe(true);
                }
            },
        ), { numRuns: NUM_RUNS });
    });

    it('I14. "本局接近收尾" 字样的 narrative 命中时，geometry.boardFill 必 >= 0.45', () => {
        fc.assert(fc.property(arbReducerCtx, (ctx) => {
            const r = selectNarrative(ctx);
            if (r.text && /本局接近收尾/.test(r.text)) {
                expect(ctx.geometry.boardFill).toBeGreaterThanOrEqual(0.45);
            }
        }), { numRuns: NUM_RUNS });
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §8 DFV chip 自描述化（v1.58.3 截图 3 治理）                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58.3 性质 §8: DFV chip 自描述化', () => {
    /* 复用 §4 的 arbGame 生成器 + 加 forceRelief 上游随机字段。
     *
     * 关键事实（adaptiveSpawn.js:2235）：`forceReliefIntent` 的算法层实际触发源只有
     * `endSessionDistressActive (lateCollapse) || frustrationCritical` 两条——
     * 所以 arbitrary 中 forceReliefIntent 派生自这两个上游，反映算法真实关系。
     *
     * 4 个 v1.58.3 新 chip（endSessionStress / lifecycleLateAccel / playerDistressFloor
     * / delightModeRelief）是"信号诊断 chip"——独立反映 stress 标量/breakdown/intent 优先级
     * 的输入信号，**不是 forceReliefIntent 的上游**，故不参与 I15 判定。 */
    const arbGameWithForceRelief = fc.record({
        fill:           fc.float({ min: 0, max: 1, noNaN: true }),
        stress:         fc.float({ min: 0, max: 1, noNaN: true }),
        intent:         fc.constantFrom('relief', 'flow', 'maintain'),
        playerDistress: fc.float({ min: Math.fround(-0.30), max: Math.fround(0.30), noNaN: true }),
        afkEngageActive: fc.boolean(),
        delightMode:     fc.constantFrom(null, 'relief', 'flow_payoff'),
        sessionPhase:    fc.constantFrom('early', 'mid', 'late'),
        momentum:        fc.float({ min: -1, max: 1, noNaN: true }),
        frustrationLevel: fc.integer({ min: 0, max: 8 }),
        flowState:       fc.constantFrom('bored', 'flow', 'challenged'),
        endSessionDistress: fc.float({ min: Math.fround(-0.30), max: 0, noNaN: true }),
        lifecycleBias:   fc.float({ min: Math.fround(-0.30), max: Math.fround(0.10), noNaN: true }),
    }).map((p) => {
        /* v1.58.3 I15 关键：forceReliefIntent 与算法层 (adaptiveSpawn.js:2235) 同源派生 */
        const forceReliefIntent = (p.sessionPhase === 'late' && p.momentum <= -0.30)
            || (p.frustrationLevel >= 5);
        return {
            grid: { getFillRatio: () => p.fill },
            playerProfile: {
                metrics: {},
                flowState: p.flowState,
                sessionPhase: p.sessionPhase,
                momentum: p.momentum,
                frustrationLevel: p.frustrationLevel,
                isInOnboarding: false,
            },
            _lastAdaptiveInsight: {
                stress: p.stress,
                spawnIntent: p.intent, spawnHints: { spawnIntent: p.intent },
                spawnDiagnostics: { layer1: { fill: p.fill, holes: 0, nearFullLines: 0, multiClearCandidates: 0, pcSetup: 0 } },
                stressBreakdown: { endSessionDistress: p.endSessionDistress, lifecycleBias: p.lifecycleBias },
                _intentInputs: {
                    playerDistress: p.playerDistress,
                    afkEngageActive: p.afkEngageActive,
                    forceReliefIntent,
                    delightMode: p.delightMode,
                    stress: p.stress,
                },
                afkEngageActive: p.afkEngageActive,
                sessionPhase: p.sessionPhase, momentum: p.momentum, frustrationLevel: p.frustrationLevel,
            },
            _p: p,
        };
    });

    it('I15. forceRelief chip 亮时，lateCollapse 或 frustCritical 至少 1 个亮（chip 表与算法层同源锁定）', () => {
        fc.assert(fc.property(arbGameWithForceRelief, (game) => {
            const model = reducePresentation(game);
            const force = model.chips.find((c) => c.id === 'forceRelief');
            if (force.on) {
                /* adaptiveSpawn.js:2235：forceReliefIntent = endSessionDistressActive || frustrationCritical
                 * 其中 endSessionDistressActive 对应 lateCollapse chip，frustrationCritical 对应 frustCritical chip */
                const upstreamIds = ['lateCollapse', 'frustCritical'];
                const anyUpstreamOn = model.chips.some((c) => upstreamIds.includes(c.id) && c.on);
                expect(anyUpstreamOn).toBe(true);
            }
        }), { numRuns: NUM_RUNS });
    });

    it('I16. 任何 chip on=true 时，title 必非空（强制可读 reason）', () => {
        fc.assert(fc.property(arbGameWithForceRelief, (game) => {
            const model = reducePresentation(game);
            for (const c of model.chips) {
                if (c.on) {
                    expect(c.title).toBeTruthy();
                    expect(c.title.length).toBeGreaterThan(0);
                }
            }
        }), { numRuns: NUM_RUNS });
    });

    it('I17. flowState=bored 且 intent=relief 时，conflicts 必含 flowVsIntent', () => {
        fc.assert(fc.property(arbGameWithForceRelief, (game) => {
            const model = reducePresentation(game);
            if (game.playerProfile.flowState === 'bored' && model.intent.intent === 'relief') {
                const has = model.conflicts.some((c) => c.id === 'flowVsIntent');
                expect(has).toBe(true);
            }
        }), { numRuns: NUM_RUNS });
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §9 全系统自查残留修补 (v1.58.4)                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58.4 性质 §9: 全系统自查残留修补', () => {
    it('I18. "盘面空洞偏多" 字样的 narrative 命中时，geometry.holes 必 >= 1', () => {
        fc.assert(fc.property(arbReducerCtx, (ctx) => {
            const r = selectNarrative(ctx);
            if (r.text && /盘面空洞偏多/.test(r.text)) {
                expect(Number(ctx.geometry.holes)).toBeGreaterThanOrEqual(1);
            }
        }), { numRuns: NUM_RUNS });
    });

    it('I19. "盘面压力较高" 字样的 narrative 命中时，geometry.boardFill 必 >= 0.45', () => {
        fc.assert(fc.property(arbReducerCtx, (ctx) => {
            const r = selectNarrative(ctx);
            if (r.text && /盘面压力较高/.test(r.text)) {
                expect(ctx.geometry.boardFill).toBeGreaterThanOrEqual(0.45);
            }
        }), { numRuns: NUM_RUNS });
    });

    it('I20. "高压区" 字样的 narrative 命中时，geometry.boardFill 必 >= 0.46（与 v1.58.4 E4 守卫 + 1% 浮点容差）', () => {
        fc.assert(fc.property(arbReducerCtx, (ctx) => {
            const r = selectNarrative(ctx);
            /* flow.intense.soft 文案明确不含"高压区"，仅 flow.intense 含 */
            if (r.text && /进入高压区/.test(r.text)) {
                expect(ctx.geometry.boardFill).toBeGreaterThanOrEqual(0.45);
            }
        }), { numRuns: NUM_RUNS });
    });

    it('I21. harvest.default 兜底 narrative 文案不能含 "密集" 或 "已识别"（避免虚假承诺）', () => {
        /* v1.58.4 自查 E3：harvest.default 是兜底分支，不能假装已识别密集消行机会 */
        fc.assert(fc.property(
            fc.float({ min: 0, max: 1, noNaN: true }),
            fc.float({ min: 0, max: 1, noNaN: true }),
            (boardFill, stress) => {
                const r = selectNarrative({
                    intent: 'harvest',
                    breakdown: {},
                    geometry: { boardFill, holes: 0, nearFullLines: 0, multiClearCandidates: 0, pcSetup: 0, harvestReady: false },
                    stress,
                    hints: {},
                });
                if (r.contract?.id === 'harvest.default') {
                    expect(r.text).not.toMatch(/密集/);
                    expect(r.text).not.toMatch(/已识别/);
                }
            },
        ), { numRuns: NUM_RUNS });
    });
});
