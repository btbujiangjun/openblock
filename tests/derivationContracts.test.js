/**
 * derivationContracts.test.js — v1.58 派生层四模块独立单测
 *
 * 锁定:
 *   §1. selectors.js: SSOT 一致性、降级安全、字段口径
 *   §2. intentResolver.js: 与 adaptiveSpawn.deriveSpawnIntent 行为完全等价 + trace + overrides
 *   §3. displayContracts.js: 谓词 DSL 边界 + 契约表完整性 + selectNarrative/selectEmoji 优先级
 *   §4. presentationReducer.js: 端到端流水线 + chip overridden 自动派生 + 空 game 降级
 */

import { describe, it, expect } from 'vitest';

import {
    selectLiveBoardFill,
    selectLiveClearRate,
    selectLiveGeometry,
    selectInsightWithLiveGeometry,
    selectSpawnIntent,
    selectReducerInputs,
} from '../web/src/derivation/selectors.js';
import {
    resolveIntent,
    formatIntentTrace,
    isSignalOverridden,
    INTENT_RULES,
    INTENT_IDS,
    PC_SETUP_MIN_FILL,
} from '../web/src/derivation/intentResolver.js';
import {
    evalPredicate,
    evalRequires,
    selectNarrative,
    selectEmoji,
    NARRATIVE_CONTRACTS,
    EMOJI_CONTRACTS,
    validateContractTable,
} from '../web/src/derivation/displayContracts.js';
import {
    reducePresentation,
    CHIP_DEFS,
    SPAWN_INTENT_COLOR,
} from '../web/src/derivation/presentationReducer.js';

import { deriveSpawnIntent } from '../web/src/adaptiveSpawn.js';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §1. selectors —— SSOT 与降级安全                                           */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58 §1 selectors: SSOT 一致性与降级安全', () => {
    function mockGame({ fill = 0.5, clearRate = 0.2, missRate = 0.05, insight = null } = {}) {
        return {
            grid: { getFillRatio: () => fill },
            playerProfile: {
                metrics: { clearRate, missRate },
                skillLevel: 0.5,
                momentum: 0.1,
                frustrationLevel: 2,
                flowState: 'flow',
                sessionPhase: 'early',
                cognitiveLoad: 0.3,
                isInOnboarding: false,
            },
            _lastAdaptiveInsight: insight,
        };
    }

    it('selectLiveBoardFill 优先取 grid.getFillRatio()', () => {
        const game = mockGame({ fill: 0.69 });
        expect(selectLiveBoardFill(game)).toBe(0.69);
    });

    it('selectLiveBoardFill grid 异常时降级到 insight.boardFill', () => {
        const game = {
            grid: { getFillRatio: () => { throw new Error('boom'); } },
            _lastAdaptiveInsight: { boardFill: 0.42 },
        };
        expect(selectLiveBoardFill(game)).toBe(0.42);
    });

    it('selectLiveBoardFill 全部缺失返回 0', () => {
        expect(selectLiveBoardFill(null)).toBe(0);
        expect(selectLiveBoardFill({})).toBe(0);
    });

    it('selectLiveClearRate 走 profile.metrics.clearRate（实时 EMA 源）', () => {
        const game = mockGame({ clearRate: 0.31 });
        expect(selectLiveClearRate(game)).toBe(0.31);
    });

    it('selectLiveGeometry 优先 spawnDiagnostics.layer1', () => {
        const insight = {
            spawnDiagnostics: { layer1: { fill: 0.69, holes: 2, nearFullLines: 1, multiClearCandidates: 3, pcSetup: 1 } },
        };
        const game = mockGame({ fill: 0.69, insight });
        const geom = selectLiveGeometry(game);
        expect(geom).toEqual({ fill: 0.69, holes: 2, nearFullLines: 1, multiClearCandidates: 3, pcSetup: 1 });
    });

    it('selectLiveGeometry layer1 缺失时降级到 grid.fill 兜底', () => {
        const game = mockGame({ fill: 0.40, insight: {} });
        const geom = selectLiveGeometry(game);
        expect(geom.fill).toBe(0.40);
        expect(geom.holes).toBe(0);
    });

    it('selectInsightWithLiveGeometry 把实时几何注入 insight 顶层 boardFill', () => {
        const insight = {
            stress: 0.3, boardFill: 0.10, // 旧值
            spawnDiagnostics: { layer1: { fill: 0.69 } },
        };
        const game = mockGame({ fill: 0.69, insight });
        const merged = selectInsightWithLiveGeometry(game);
        expect(merged.boardFill).toBe(0.69); // 已被实时值覆盖
        expect(merged.spawnDiagnostics.layer1.fill).toBe(0.69);
    });

    it('selectSpawnIntent 优先取 spawnHints.spawnIntent', () => {
        const game = mockGame({ insight: { spawnHints: { spawnIntent: 'relief' }, spawnIntent: 'maintain' } });
        expect(selectSpawnIntent(game)).toBe('relief');
    });

    it('selectReducerInputs 返回完整上下文（含 intentInputs / distress / geometry）', () => {
        const insight = {
            stress: 0.2,
            spawnIntent: 'relief',
            spawnHints: { spawnIntent: 'relief' },
            spawnDiagnostics: { layer1: { fill: 0.69, holes: 1, nearFullLines: 2, multiClearCandidates: 1, pcSetup: 0 } },
            stressBreakdown: { friendlyBoardRelief: -0.18 },
            _intentInputs: { playerDistress: -0.12, afkEngageActive: false },
            afkEngageActive: false,
            scoreMilestoneHit: false,
            personalizationApplied: false,
            sessionPhase: 'mid',
            momentum: -0.1,
            frustrationLevel: 2,
        };
        const game = mockGame({ fill: 0.69, insight });
        const ctx = selectReducerInputs(game);
        expect(ctx.intent).toBe('relief');
        expect(ctx.stress).toBe(0.2);
        expect(ctx.geometry.boardFill).toBe(0.69);
        expect(ctx.geometry.nearFullLines).toBe(2);
        expect(ctx.breakdown.friendlyBoardRelief).toBe(-0.18);
        expect(ctx.intentInputs).toEqual({ playerDistress: -0.12, afkEngageActive: false });
        expect(ctx.distress.boardFill).toBe(0.69);
    });

    it('selectReducerInputs 在 insight 缺失时返回安全默认值', () => {
        const ctx = selectReducerInputs({ grid: { getFillRatio: () => 0.5 }, playerProfile: { sessionPhase: 'early' } });
        expect(ctx.intent).toBe(null);
        expect(ctx.stress).toBe(0);
        expect(ctx.geometry.fill).toBe(0.5); // grid 兜底
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §2. intentResolver —— 矩阵表驱动 + trace + overrides + 同源等价              */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58 §2 intentResolver: 矩阵 + trace + overrides', () => {
    it('INTENT_RULES 按 priority 严格降序排列（matrix 一致性）', () => {
        let lastP = Infinity;
        for (const r of INTENT_RULES) {
            expect(r.priority).toBeLessThanOrEqual(lastP);
            lastP = r.priority;
        }
    });

    it('每条 INTENT_RULES 都暴露 id / priority / guard / reason', () => {
        for (const r of INTENT_RULES) {
            expect(r.id).toBeTruthy();
            expect(typeof r.priority).toBe('number');
            expect(typeof r.guard).toBe('function');
            expect(typeof r.reason).toBe('function');
        }
    });

    it('maintain 是 priority=0 的 fallback 且 guard 恒真', () => {
        const maintain = INTENT_RULES.find((r) => r.id === 'maintain');
        expect(maintain.priority).toBe(0);
        expect(maintain.guard({})).toBe(true);
    });

    it('PC_SETUP_MIN_FILL 与 adaptiveSpawn 同源（0.45）', () => {
        // 文档+同源锁定：adaptiveSpawn.js 内部 PC_SETUP_MIN_FILL 同值
        expect(PC_SETUP_MIN_FILL).toBe(0.45);
    });

    /* ── 与 adaptiveSpawn.deriveSpawnIntent 行为完全等价（核心契约） ── */
    const samples = [
        // relief 优先：distress 主导
        { playerDistress: -0.15, afkEngageActive: false, geometry: {} },
        // relief：delightMode
        { playerDistress: 0, delightMode: 'relief', geometry: {} },
        // engage：afkEngage
        { playerDistress: 0, afkEngageActive: true, geometry: {} },
        // harvest：nearFullLines 主导
        { playerDistress: 0, geometry: { nearFullLines: 3, boardFill: 0.4 } },
        // harvest：pcSetup + fill 主导
        { playerDistress: 0, geometry: { pcSetup: 1, boardFill: 0.5 } },
        // pressure：challengeBoost
        { playerDistress: 0, challengeBoost: 0.1, geometry: {} },
        // sprint
        { playerDistress: 0, stress: 0.50, sprintCfg: {}, geometry: {} },
        // flow：rhythmPhase
        { playerDistress: 0, rhythmPhase: 'payoff', geometry: {} },
        // maintain：兜底
        { playerDistress: 0, geometry: {} },
    ];
    for (const inp of samples) {
        it(`等价性：resolveIntent vs deriveSpawnIntent，sample=${JSON.stringify(inp).slice(0, 80)}`, () => {
            expect(resolveIntent(inp).intent).toBe(deriveSpawnIntent(inp));
        });
    }

    it('trace 包含全部规则，winner 唯一', () => {
        const r = resolveIntent({ playerDistress: -0.15, afkEngageActive: true });
        expect(r.trace.length).toBe(INTENT_RULES.length);
        const winners = r.trace.filter((t) => t.isWinner);
        expect(winners.length).toBe(1);
        expect(winners[0].id).toBe('relief');
    });

    it('overrides 包含通过 guard 但被 winner 覆盖的规则', () => {
        const r = resolveIntent({ playerDistress: -0.15, afkEngageActive: true });
        expect(r.intent).toBe('relief');
        expect(r.overrides.has('engage')).toBe(true);
        expect(r.overrides.has('maintain')).toBe(true); // maintain 恒真，永远在 overrides
    });

    it('overrides 不包含 winner 本身', () => {
        const r = resolveIntent({ playerDistress: -0.15 });
        expect(r.overrides.has('relief')).toBe(false);
    });

    it('isSignalOverridden 把 afkEngage 信号正确映射到 engage intent', () => {
        const r = resolveIntent({ playerDistress: -0.15, afkEngageActive: true });
        expect(isSignalOverridden('afkEngage', r)).toBe(true);
    });

    it('isSignalOverridden 对未知 signal 返回 false', () => {
        const r = resolveIntent({ playerDistress: -0.15 });
        expect(isSignalOverridden('unknownSignal', r)).toBe(false);
    });

    it('formatIntentTrace 渲染 winner + overrides', () => {
        const r = resolveIntent({ playerDistress: -0.15, afkEngageActive: true });
        const text = formatIntentTrace(r);
        expect(text).toContain('relief');
        expect(text).toMatch(/overrides/);
        expect(text).toContain('engage');
    });

    it('INTENT_IDS 与 stressMeter.SPAWN_INTENT_NARRATIVE 同源 7 项', () => {
        const expected = ['relief', 'engage', 'harvest', 'pressure', 'sprint', 'flow', 'maintain'];
        expect(INTENT_IDS.slice().sort()).toEqual(expected.sort());
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §3. displayContracts —— 谓词 DSL + 契约表完整性 + 优先级匹配                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58 §3a displayContracts: 谓词 DSL', () => {
    it('字面量谓词 strict equals', () => {
        expect(evalPredicate('relief', 'relief')).toBe(true);
        expect(evalPredicate('relief', 'engage')).toBe(false);
        expect(evalPredicate(5, 5)).toBe(true);
    });
    it('lt / lte / gt / gte 数值比较', () => {
        expect(evalPredicate(0.4, { lt: 0.5 })).toBe(true);
        expect(evalPredicate(0.5, { lt: 0.5 })).toBe(false);
        expect(evalPredicate(0.5, { lte: 0.5 })).toBe(true);
        expect(evalPredicate(0.6, { gt: 0.5 })).toBe(true);
        expect(evalPredicate(0.5, { gte: 0.5 })).toBe(true);
    });
    it('eq / neq', () => {
        expect(evalPredicate(5, { eq: 5 })).toBe(true);
        expect(evalPredicate(5, { neq: 4 })).toBe(true);
    });
    it('in 集合谓词', () => {
        expect(evalPredicate('relief', { in: ['relief', 'engage'] })).toBe(true);
        expect(evalPredicate('harvest', { in: ['relief', 'engage'] })).toBe(false);
    });
    it('not 否定谓词', () => {
        expect(evalPredicate(0.6, { not: { lt: 0.5 } })).toBe(true);
        expect(evalPredicate(0.4, { not: { lt: 0.5 } })).toBe(false);
    });
    it('嵌套对象递归校验', () => {
        const ctx = { geometry: { boardFill: 0.4, nearFullLines: 2 } };
        expect(evalRequires({ geometry: { boardFill: { lt: 0.5 }, nearFullLines: { gte: 2 } } }, ctx)).toEqual({ ok: true, failures: [] });
    });
    it('evalRequires 返回 failures 列表（含 path）', () => {
        const ctx = { geometry: { boardFill: 0.69 } };
        const r = evalRequires({ geometry: { boardFill: { lt: 0.5 } } }, ctx);
        expect(r.ok).toBe(false);
        expect(r.failures).toHaveLength(1);
        expect(r.failures[0].path).toBe('geometry.boardFill');
        expect(r.failures[0].actual).toBe(0.69);
    });
    it('NaN/undefined actual 与数值谓词永远 false（防御性）', () => {
        expect(evalPredicate(undefined, { lt: 0.5 })).toBe(false);
        expect(evalPredicate(NaN, { gte: 0 })).toBe(false);
    });
});

describe('v1.58 §3b displayContracts: 契约表完整性', () => {
    it('NARRATIVE_CONTRACTS 全局 id 唯一 + fallback 指向有效 id', () => {
        const r = validateContractTable(NARRATIVE_CONTRACTS);
        expect(r.ok).toBe(true);
        if (!r.ok) console.error(r.errors);
    });
    it('EMOJI_CONTRACTS 全局 id 唯一', () => {
        const r = validateContractTable(EMOJI_CONTRACTS);
        expect(r.ok).toBe(true);
    });
    it('NARRATIVE_CONTRACTS 必覆盖全部 7 个 intent', () => {
        const intentsCovered = new Set();
        for (const c of NARRATIVE_CONTRACTS) {
            const it = c.requires?.intent;
            if (typeof it === 'string') intentsCovered.add(it);
        }
        for (const id of ['relief', 'engage', 'harvest', 'pressure', 'sprint', 'flow', 'maintain']) {
            expect(intentsCovered.has(id)).toBe(true);
        }
    });
    it('EMOJI_CONTRACTS 覆盖 6 个 stress 档（calm/easy/flow/engaged/tense/intense）', () => {
        const ids = EMOJI_CONTRACTS.map((c) => c.output?.id);
        for (const id of ['calm', 'easy', 'flow', 'engaged', 'tense', 'intense']) {
            expect(ids).toContain(id);
        }
    });
});

describe('v1.58 §3c displayContracts: selectNarrative 优先级匹配', () => {
    it('relief + friendly + fill=0.30 + harvestReady → friendly 文案', () => {
        const r = selectNarrative({
            intent: 'relief',
            breakdown: { friendlyBoardRelief: -0.18 },
            geometry: { boardFill: 0.30, harvestReady: true, nearFullLines: 2 },
            stress: 0.10,
            hints: {},
        });
        expect(r.contract?.id).toBe('relief.friendly');
        expect(r.text).toContain('可消行机会');
    });

    it('relief + friendly + fill=0.69 → friendly 守卫不通过，降级到下一档', () => {
        const r = selectNarrative({
            intent: 'relief',
            breakdown: { friendlyBoardRelief: -0.18 },
            geometry: { boardFill: 0.69, harvestReady: true },
            stress: 0.10,
            hints: {},
        });
        expect(r.contract?.id).not.toBe('relief.friendly');
        expect(r.text).not.toContain('盘面通透');
    });

    it('v1.58.1 §B：relief + friendly 但 harvestReady=false → 降级（不撒谎"享受多消"）', () => {
        const r = selectNarrative({
            intent: 'relief',
            breakdown: { friendlyBoardRelief: -0.18 },
            geometry: { boardFill: 0.30, harvestReady: false, nearFullLines: 0, multiClearCandidates: 0, pcSetup: 0 },
            stress: 0.10,
            hints: {},
        });
        expect(r.contract?.id).not.toBe('relief.friendly');
        expect(r.text).not.toContain('享受多消');
    });

    it('relief + endSessionDistress + boardFill=0.55 → relief.endgame（优先级最高，盘面真有压力）', () => {
        const r = selectNarrative({
            intent: 'relief',
            breakdown: { endSessionDistress: -0.18, friendlyBoardRelief: -0.10 },
            geometry: { boardFill: 0.55, harvestReady: true },
            stress: 0.10,
            hints: {},
        });
        expect(r.contract?.id).toBe('relief.endgame');
        expect(r.text).toContain('收尾');
    });

    it('v1.58.4 §自查E1：relief + holeReliefAdjust<-0.05 + holes=0 → 不命中 relief.hole（fall through）', () => {
        const r = selectNarrative({
            intent: 'relief',
            breakdown: { holeReliefAdjust: -0.10 },
            geometry: { boardFill: 0.40, holes: 0, harvestReady: false },
            stress: 0.10,
            hints: {},
        });
        expect(r.contract?.id).not.toBe('relief.hole');
    });

    it('v1.58.4 §自查E1：relief + holeReliefAdjust<-0.05 + holes=3 → 命中 relief.hole', () => {
        const r = selectNarrative({
            intent: 'relief',
            breakdown: { holeReliefAdjust: -0.10 },
            geometry: { boardFill: 0.40, holes: 3, harvestReady: false },
            stress: 0.10,
            hints: {},
        });
        expect(r.contract?.id).toBe('relief.hole');
    });

    it('v1.58.4 §自查E2：relief + boardRiskReliefAdjust<-0.05 + boardFill=0.30 → 不命中 relief.boardRisk', () => {
        const r = selectNarrative({
            intent: 'relief',
            breakdown: { boardRiskReliefAdjust: -0.10 },
            geometry: { boardFill: 0.30, holes: 0, harvestReady: false },
            stress: 0.10,
            hints: {},
        });
        expect(r.contract?.id).not.toBe('relief.boardRisk');
    });

    it('v1.58.4 §自查E3：intent=harvest + nearFullLines=0 → harvest.default 文案不含 "密集" / "已识别"', () => {
        const r = selectNarrative({
            intent: 'harvest',
            breakdown: {},
            geometry: { boardFill: 0.40, holes: 0, nearFullLines: 0, multiClearCandidates: 0, pcSetup: 0, harvestReady: false },
            stress: 0.40,
            hints: {},
        });
        expect(r.contract?.id).toBe('harvest.default');
        expect(r.text).not.toContain('密集');
        expect(r.text).not.toContain('已识别');
        expect(r.text).toMatch(/寻找|节奏/);
    });

    it('v1.58.4 §自查E4：intent=flow + stress=0.90 + boardFill=0.20 → flow.intense.soft（不撒谎"高压区"）', () => {
        const r = selectNarrative({
            intent: 'flow',
            breakdown: {},
            geometry: { boardFill: 0.20, holes: 0, harvestReady: false },
            stress: 0.90,
            hints: { rhythmPhase: 'neutral' },
        });
        expect(r.contract?.id).toBe('flow.intense.soft');
        expect(r.text).not.toContain('高压区');
        expect(r.text).toMatch(/盘面尚通透|稳住关键落点/);
    });

    it('v1.58.4 §自查E4：intent=flow + stress=0.90 + boardFill=0.50 → flow.intense（盘面真有压力）', () => {
        const r = selectNarrative({
            intent: 'flow',
            breakdown: {},
            geometry: { boardFill: 0.50, holes: 0, harvestReady: false },
            stress: 0.90,
            hints: { rhythmPhase: 'neutral' },
        });
        expect(r.contract?.id).toBe('flow.intense');
        expect(r.text).toContain('高压区');
    });

    it('v1.58.2 §截图2-narrative：relief + endSessionDistress + boardFill=0.30 → relief.endgame.soft（盘面通透时诚实降级）', () => {
        const r = selectNarrative({
            intent: 'relief',
            breakdown: { endSessionDistress: -0.18 },
            geometry: { boardFill: 0.30, harvestReady: true },
            stress: 0.10,
            hints: {},
        });
        expect(r.contract?.id).toBe('relief.endgame.soft');
        expect(r.text).not.toContain('本局接近收尾');
        expect(r.text).toMatch(/盘面仍从容|稳住/);
    });

    it('boardRisk≥0.6 抢占所有 intent 文案', () => {
        const r = selectNarrative({
            intent: 'flow',
            breakdown: { boardRisk: 0.7 },
            geometry: { boardFill: 0.8, harvestReady: false },
            stress: 0.7,
            hints: {},
        });
        expect(r.contract?.id).toBe('boardRisk.critical');
        expect(r.text).toContain('保活');
    });

    it('flow + rhythmPhase=payoff + harvestReady → flow.payoff.ready 文案（兑现窗口已就位）', () => {
        const r = selectNarrative({
            intent: 'flow',
            breakdown: {},
            geometry: { boardFill: 0.4, harvestReady: true, nearFullLines: 2 },
            stress: 0.4,
            hints: { rhythmPhase: 'payoff' },
        });
        expect(r.contract?.id).toBe('flow.payoff.ready');
        expect(r.text).toContain('享受多消');
    });

    it('v1.58.1 §A：flow + rhythmPhase=payoff + harvestReady=false → flow.payoff.waiting（诚实降级）', () => {
        const r = selectNarrative({
            intent: 'flow',
            breakdown: {},
            geometry: { boardFill: 0.30, harvestReady: false, nearFullLines: 0, multiClearCandidates: 0, pcSetup: 0 },
            stress: 0.4,
            hints: { rhythmPhase: 'payoff' },
        });
        expect(r.contract?.id).toBe('flow.payoff.waiting');
        expect(r.text).not.toContain('享受多消');
        expect(r.text).not.toContain('收获期');
        expect(r.text).toMatch(/等待|留通道|稳住手/);
    });

    it('flow + stress=0.85 + boardFill=0.50 → flow.intense 文案（高压守卫优先 rhythmPhase；v1.58.4 加 boardFill 守卫）', () => {
        const r = selectNarrative({
            intent: 'flow',
            breakdown: {},
            geometry: { boardFill: 0.50, harvestReady: true },
            stress: 0.85,
            hints: { rhythmPhase: 'payoff' },
        });
        expect(r.contract?.id).toBe('flow.intense');
    });

    it('未匹配任何 contract 时返回 null', () => {
        const r = selectNarrative({ intent: 'unknown', breakdown: {}, geometry: {}, stress: 0, hints: {} });
        expect(r.contract).toBe(null);
        expect(r.text).toBe(null);
    });
});

describe('v1.58 §3d displayContracts: selectEmoji 优先级矩阵', () => {
    it('lateCollapse + boardFill=0.7 → struggling（最高）', () => {
        const r = selectEmoji({
            stress: 0.10, intent: 'relief',
            distress: { sessionPhase: 'late', momentum: -0.35, boardFill: 0.7 },
        });
        expect(r.output.id).toBe('struggling');
        expect(r.output.face).toBe('😣');
    });

    it('frustCritical + boardFill=0.7 → struggling', () => {
        const r = selectEmoji({
            stress: 0.10, intent: 'flow',
            distress: { frustrationLevel: 6, boardFill: 0.7 },
        });
        expect(r.output.id).toBe('struggling');
    });

    it('v1.58.2 §截图2-emoji：lateCollapse + boardFill=0.31 → concerned.softRescue.late（中间档，不撒谎挣扎）', () => {
        const r = selectEmoji({
            stress: 0.15, intent: 'relief',
            distress: { sessionPhase: 'late', momentum: -0.47, boardFill: 0.31, frustrationLevel: 1 },
        });
        expect(r.output.id).toBe('concerned');
        expect(r.output.face).toBe('😟');
        expect(r.output.label).toContain('稍专注');
    });

    it('v1.58.2 §截图2-emoji：frustCritical + boardFill=0.30 → concerned.softRescue.frust', () => {
        const r = selectEmoji({
            stress: 0.10, intent: 'relief',
            distress: { frustrationLevel: 6, boardFill: 0.30 },
        });
        expect(r.output.id).toBe('concerned');
    });

    it('crowded（v1.57.5 §G）触发：stress 低 + fill≥0.65', () => {
        const r = selectEmoji({
            stress: 0.15, intent: 'flow',
            distress: { boardFill: 0.69 },
        });
        expect(r.output.id).toBe('easy-crowded');
        expect(r.output.face).toBe('😅');
    });

    it('crowded 在 calm 档触发 calm-crowded', () => {
        const r = selectEmoji({
            stress: 0.10, intent: 'flow',
            distress: { boardFill: 0.70 },
        });
        expect(r.output.id).toBe('calm-crowded');
    });

    it('relief 救济中变体（calm 档 + intent=relief + fill<0.65）', () => {
        const r = selectEmoji({
            stress: 0.05, intent: 'relief',
            distress: { boardFill: 0.30 },
        });
        expect(r.output.face).toBe('🤗');
    });

    it('fill 缺失（旧调用）走基础档', () => {
        const r = selectEmoji({ stress: 0.15, intent: 'flow', distress: {} });
        expect(r.output.id).toBe('easy');
        expect(r.output.face).toBe('🙂');
    });

    it('stress=0.7 → tense', () => {
        const r = selectEmoji({ stress: 0.72, intent: 'flow', distress: {} });
        expect(r.output.id).toBe('tense');
    });

    it('stress=0.9 → intense', () => {
        const r = selectEmoji({ stress: 0.9, intent: 'flow', distress: {} });
        expect(r.output.id).toBe('intense');
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §4. presentationReducer —— 端到端 + 空 game 降级                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('v1.58 §4 presentationReducer: 端到端流水线', () => {
    function buildGame({
        fill = 0.69,
        intent = 'relief',
        intentInputs = { playerDistress: -0.15, afkEngageActive: true },
        breakdown = { friendlyBoardRelief: -0.18 },
        stress = 0.15,
        distress = { sessionPhase: 'mid', momentum: 0, frustrationLevel: 2 },
    } = {}) {
        return {
            grid: { getFillRatio: () => fill },
            playerProfile: {
                metrics: { clearRate: 0.31, missRate: 0.05 },
                sessionPhase: distress.sessionPhase,
                momentum: distress.momentum,
                frustrationLevel: distress.frustrationLevel,
                isInOnboarding: false,
            },
            _lastAdaptiveInsight: {
                stress,
                spawnIntent: intent,
                spawnHints: { spawnIntent: intent },
                spawnDiagnostics: { layer1: { fill, holes: 1, nearFullLines: 2, multiClearCandidates: 1, pcSetup: 0 } },
                stressBreakdown: breakdown,
                _intentInputs: intentInputs,
                afkEngageActive: !!intentInputs.afkEngageActive,
                scoreMilestoneHit: false,
                personalizationApplied: false,
                sessionPhase: distress.sessionPhase,
                momentum: distress.momentum,
                frustrationLevel: distress.frustrationLevel,
            },
        };
    }

    it('端到端：relief + afkEngage + fill=0.69 → intent=relief，afkEngage chip=overridden，emoji=crowded，narrative≠通透', () => {
        const model = reducePresentation(buildGame({}));
        expect(model.intent.intent).toBe('relief');
        expect(model.intent.overrides.has('engage')).toBe(true);
        const afk = model.chips.find((c) => c.id === 'afkEngage');
        expect(afk.on).toBe(true);
        expect(afk.overridden).toBe(true);
        expect(afk.title).toMatch(/优先级/);
        expect(model.emoji.id).toBe('easy-crowded');
        expect(model.emoji.face).toBe('😅');
        expect(model.narrative.text).not.toContain('盘面通透');
    });

    it('端到端：relief + endSessionDistress → narrative 走 endgame', () => {
        const model = reducePresentation(buildGame({
            breakdown: { endSessionDistress: -0.20, friendlyBoardRelief: -0.10 },
            intentInputs: { playerDistress: -0.15, afkEngageActive: false },
        }));
        expect(model.narrative.contractId).toBe('relief.endgame');
        expect(model.narrative.text).toContain('收尾');
    });

    it('端到端：null game → 安全空模型，chips 全 off，无抛错', () => {
        const model = reducePresentation(null);
        expect(model.intent.intent).toBe('maintain');
        expect(model.chips.every((c) => c.on === false)).toBe(true);
        expect(model.emoji).toBe(null);
        expect(model.narrative.text).toBe(null);
    });

    it('端到端：缺 _intentInputs（旧回放）→ 降级单条 trace，overrides 为空', () => {
        const g = buildGame({});
        g._lastAdaptiveInsight._intentInputs = null;
        const model = reducePresentation(g);
        expect(model.intent.intent).toBe('relief'); // 来自 hints.spawnIntent 兜底
        expect(model.intent.trace.length).toBe(1);
        expect(model.intent.overrides.size).toBe(0);
    });

    it('CHIP_DEFS 数量 (v1.58.3: 12 项 = 8 旧 + 4 forceRelief 上游)', () => {
        expect(CHIP_DEFS.length).toBe(12);
        const ids = CHIP_DEFS.map((c) => c.id);
        for (const id of ['forceRelief', 'lateCollapse', 'frustCritical', 'onboarding',
            'milestone', 'afkEngage', 'winback', 'personalization',
            'endSessionStress', 'lifecycleLateAccel', 'playerDistressFloor', 'delightModeRelief']) {
            expect(ids).toContain(id);
        }
    });

    it('v1.58.3 chip 都暴露 reason 函数（自描述化）', () => {
        for (const c of CHIP_DEFS) {
            expect(typeof c.reason).toBe('function');
        }
    });

    it('v1.58.3 chip 高亮时 title 自动写 reason + 数值', () => {
        const g = {
            grid: { getFillRatio: () => 0.5 },
            playerProfile: { metrics: {}, sessionPhase: 'late', momentum: -0.50, frustrationLevel: 2, isInOnboarding: false },
            _lastAdaptiveInsight: {
                stress: 0.2,
                spawnIntent: 'relief', spawnHints: { spawnIntent: 'relief' },
                spawnDiagnostics: { layer1: { fill: 0.5, holes: 0, nearFullLines: 1, multiClearCandidates: 0, pcSetup: 0 } },
                stressBreakdown: { endSessionDistress: -0.13, lifecycleBias: -0.05 },
                _intentInputs: { playerDistress: -0.12, afkEngageActive: false, forceReliefIntent: true, delightMode: 'relief' },
                afkEngageActive: false, sessionPhase: 'late', momentum: -0.50, frustrationLevel: 2,
            },
        };
        const model = reducePresentation(g);
        const force = model.chips.find((c) => c.id === 'forceRelief');
        expect(force.on).toBe(true);
        expect(force.title).toMatch(/触发源/);

        /* 上游 chip 全部应亮且 title 包含具体触发数值 */
        const lateChip = model.chips.find((c) => c.id === 'lateCollapse');
        expect(lateChip.on).toBe(true);
        expect(lateChip.title).toContain('-0.50');

        const endSessChip = model.chips.find((c) => c.id === 'endSessionStress');
        expect(endSessChip.on).toBe(true);
        expect(endSessChip.title).toContain('-0.130');

        const lcChip = model.chips.find((c) => c.id === 'lifecycleLateAccel');
        expect(lcChip.on).toBe(true);

        const pdChip = model.chips.find((c) => c.id === 'playerDistressFloor');
        expect(pdChip.on).toBe(true);

        const dmChip = model.chips.find((c) => c.id === 'delightModeRelief');
        expect(dmChip.on).toBe(true);
    });

    it('v1.58.3 §截图3：bored + relief → conflicts 含 flowVsIntent', () => {
        const g = {
            grid: { getFillRatio: () => 0.56 },
            playerProfile: { metrics: { clearRate: 0.5 }, flowState: 'bored', sessionPhase: 'late', momentum: 0, frustrationLevel: 1, isInOnboarding: false },
            _lastAdaptiveInsight: {
                stress: 0.46,
                spawnIntent: 'relief', spawnHints: { spawnIntent: 'relief' },
                spawnDiagnostics: { layer1: { fill: 0.56, holes: 0, nearFullLines: 1, multiClearCandidates: 0, pcSetup: 0 } },
                stressBreakdown: { endSessionDistress: -0.13, scoreStress: 0.402, feedbackLoop: 0.205 },
                _intentInputs: { playerDistress: -0.05, afkEngageActive: false, forceReliefIntent: true, delightMode: null },
                afkEngageActive: false, sessionPhase: 'late', momentum: 0, frustrationLevel: 1,
            },
        };
        const model = reducePresentation(g);
        const flowConflict = model.conflicts.find((c) => c.id === 'flowVsIntent');
        expect(flowConflict).toBeTruthy();
        expect(flowConflict.tip).toContain('bored');
        expect(flowConflict.tip).toContain('relief');
    });

    it('v1.58.4 §自查E6：stress=0.75 + boardFill=0.20 → conflicts 含 stressVsBoardFill', () => {
        const g = {
            grid: { getFillRatio: () => 0.20 },
            playerProfile: { metrics: {}, isInOnboarding: false },
            _lastAdaptiveInsight: {
                stress: 0.75,
                spawnIntent: 'flow', spawnHints: { spawnIntent: 'flow' },
                spawnDiagnostics: { layer1: { fill: 0.20, holes: 0, nearFullLines: 0, multiClearCandidates: 0, pcSetup: 0 } },
                stressBreakdown: { lifecycleBias: -0.08, endSessionDistress: -0.08 },
                _intentInputs: { playerDistress: -0.05, afkEngageActive: false, forceReliefIntent: false, delightMode: null, stress: 0.75 },
                afkEngageActive: false,
            },
        };
        const model = reducePresentation(g);
        const conflict = model.conflicts.find((c) => c.id === 'stressVsBoardFill');
        expect(conflict).toBeTruthy();
        expect(conflict.tip).toContain('0.75');
        expect(conflict.tip).toContain('0.20');
    });

    it('v1.58.3 §截图3：forceRelief + 压力贡献净正向 → conflicts 含 pressureVsForce', () => {
        const g = {
            grid: { getFillRatio: () => 0.56 },
            playerProfile: { metrics: {}, flowState: 'flow', isInOnboarding: false },
            _lastAdaptiveInsight: {
                stress: 0.46,
                spawnIntent: 'relief', spawnHints: { spawnIntent: 'relief' },
                spawnDiagnostics: { layer1: { fill: 0.56, holes: 0, nearFullLines: 1, multiClearCandidates: 0, pcSetup: 0 } },
                stressBreakdown: { scoreStress: 0.402, feedbackLoop: 0.205, tension: -0.12 }, // 2 pos vs 1 neg
                _intentInputs: { playerDistress: 0, afkEngageActive: false, forceReliefIntent: true, delightMode: null },
                afkEngageActive: false,
            },
        };
        const model = reducePresentation(g);
        const presConflict = model.conflicts.find((c) => c.id === 'pressureVsForce');
        expect(presConflict).toBeTruthy();
        expect(presConflict.tip).toContain('抢占');
    });

    it('SPAWN_INTENT_COLOR 覆盖全部 7 个 intent', () => {
        for (const id of ['relief', 'engage', 'flow', 'maintain', 'sprint', 'pressure', 'harvest']) {
            expect(SPAWN_INTENT_COLOR[id]).toMatch(/^#/);
        }
    });
});
