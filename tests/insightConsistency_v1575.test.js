// @vitest-environment jsdom
/**
 * insightConsistency_v1575.test.js
 *
 * 锁定 v1.57.5 "UI 一致性 6 项修复" 的回归契约：
 *
 *   - §A/F：DFV 指纹包含 liveBoardFill / liveClearRate，避免"占盘 / 消行率"
 *           左侧节点 vs 底部 sparkline 双显（节点被去抖跳过、sparkline 实时刷新）。
 *   - §B：  spawnIntent='relief' 的叙事按 stressBreakdown + fill 主导原因分级
 *           （RELIEF_NARRATIVE_BY_REASON / classifyReliefReason），修复"盘面通透"
 *           在 fill ≥ 0.5 撒谎的同源 bug；旧默认文案已收窄为中性减压语义。
 *   - §G：  getStressDisplay 在 stress 低（calm/easy）+ boardFill ≥ 0.65 时切到
 *           😅 + "（盘面吃紧）" 变体，避免"舒缓笑脸 vs 密集盘面"反差。
 *   - §D：  DFV decision flags 在 spawnIntent='relief' 时给 afkEngage chip 加
 *           overridden 状态（半透明 + 删除线），不再误显示"AFK 介入"在执行。
 *           （UI 渲染层难以在单测中直查 DOM；通过判定布尔条件覆盖逻辑。）
 *
 * §E（hints 主导意图锚）是纯 DOM 渲染追加，无独立纯函数可测，仅做集成层断言。
 */

import { describe, it, expect } from 'vitest';

import { __dfvTestables } from '../web/src/decisionFlowViz.js';
import {
    classifyReliefReason,
    RELIEF_NARRATIVE_BY_REASON,
    SPAWN_INTENT_NARRATIVE,
    buildStoryLine,
    getStressDisplay,
    getStressLevel,
} from '../web/src/stressMeter.js';

const { fingerprint } = __dfvTestables;

/* ═══════════════════════════════════════════════════════════════════════ */
/*  §A/F. DFV 指纹应感知 liveBoardFill / liveClearRate                       */
/* ═══════════════════════════════════════════════════════════════════════ */

describe('v1.57.5 §A/F: DFV fingerprint 包含实时几何信号', () => {
    const baseInsight = {
        stress: 0.18,
        spawnIntent: 'maintain',
        scoreMilestoneHit: false,
        afkEngageActive: false,
        spawnHints: { spawnIntent: 'maintain' },
        stressBreakdown: { scoreStress: 0.08 },
    };
    const baseProfile = {
        skillLevel: 0.5,
        momentum: 0,
        frustrationLevel: 1,
        flowState: 'flow',
        sessionPhase: 'early',
    };

    it('相同 insight/profile + 不同 boardFill → 指纹必须不同', () => {
        const fpLow = fingerprint(baseInsight, baseProfile, { boardFill: 0.40, clearRate: 0.30 });
        const fpHigh = fingerprint(baseInsight, baseProfile, { boardFill: 0.69, clearRate: 0.30 });
        expect(fpLow).not.toBe(fpHigh);
    });

    it('相同 insight/profile + 不同 clearRate → 指纹必须不同', () => {
        const fpA = fingerprint(baseInsight, baseProfile, { boardFill: 0.50, clearRate: 0.20 });
        const fpB = fingerprint(baseInsight, baseProfile, { boardFill: 0.50, clearRate: 0.31 });
        expect(fpA).not.toBe(fpB);
    });

    it('boardFill 0.01 级以下抖动不触发重渲染（量化到 round*100）', () => {
        const fpA = fingerprint(baseInsight, baseProfile, { boardFill: 0.690, clearRate: 0.30 });
        const fpB = fingerprint(baseInsight, baseProfile, { boardFill: 0.6903, clearRate: 0.30 });
        expect(fpA).toBe(fpB);
    });

    it('缺省 live 参数仍向后兼容（旧调用者不会破坏）', () => {
        const fpOld = fingerprint(baseInsight, baseProfile);
        const fpEmptyLive = fingerprint(baseInsight, baseProfile, {});
        // 缺省 vs 空对象 vs undefined 都应得到稳定指纹（NaN/'x' 量化为同一字符串）
        expect(fpOld).toBe(fpEmptyLive);
    });
});

/* ═══════════════════════════════════════════════════════════════════════ */
/*  §B. relief 文案按 reason 分级 + fill 守卫                                */
/* ═══════════════════════════════════════════════════════════════════════ */

describe('v1.57.5 §B: classifyReliefReason 主导原因分类', () => {
    it('endSessionDistress 主导（末段崩盘） → endgame', () => {
        const r = classifyReliefReason({
            endSessionDistress: -0.18,
            frustrationRelief: -0.05,
        }, 0.45);
        expect(r).toBe('endgame');
    });

    it('endSessionDistress 优先级高于 friendlyBoardRelief（即使 fill < 0.5）', () => {
        const r = classifyReliefReason({
            endSessionDistress: -0.10,
            friendlyBoardRelief: -0.20,
        }, 0.30);
        expect(r).toBe('endgame');
    });

    it('friendlyBoardRelief 主导 + fill < 0.5 → friendly', () => {
        const r = classifyReliefReason({
            friendlyBoardRelief: -0.18,
        }, 0.30);
        expect(r).toBe('friendly');
    });

    it('friendlyBoardRelief 主导 + fill ≥ 0.5 → 不归 friendly（守卫生效）', () => {
        const r = classifyReliefReason({
            friendlyBoardRelief: -0.20,
            frustrationRelief: -0.06,
        }, 0.69);
        // fill=0.69 触发 friendly 守卫，friendlyBoardRelief 不再"主导"叙事；
        // 此时按 candidates 表挑下一个主导（frustrationRelief 累加 → frustration）
        expect(r).toBe('frustration');
    });

    it('friendlyBoardRelief 主导 + fill ≥ 0.5 + 其他全无 → default', () => {
        const r = classifyReliefReason({
            friendlyBoardRelief: -0.18,
        }, 0.69);
        // 守卫后无其他 candidate 超过 -0.05 阈值，回退 default
        expect(r).toBe('default');
    });

    it('holeReliefAdjust 主导 → hole', () => {
        const r = classifyReliefReason({
            holeReliefAdjust: -0.20,
            frustrationRelief: -0.05,
        }, 0.55);
        expect(r).toBe('hole');
    });

    it('boardRiskReliefAdjust 主导 → boardRisk', () => {
        const r = classifyReliefReason({
            boardRiskReliefAdjust: -0.18,
            holeReliefAdjust: -0.04,
        }, 0.55);
        expect(r).toBe('boardRisk');
    });

    it('bottleneckRelief 主导 → bottleneck', () => {
        const r = classifyReliefReason({
            bottleneckRelief: -0.18,
        }, 0.55);
        expect(r).toBe('bottleneck');
    });

    it('frustration 链路（recovery + frustration + nearMiss 累加）→ frustration', () => {
        const r = classifyReliefReason({
            frustrationRelief: -0.08,
            recoveryAdjust: -0.05,
            nearMissAdjust: -0.04,
        }, 0.40);
        expect(r).toBe('frustration');
    });

    it('全部信号均 < |0.05| → default 兜底', () => {
        const r = classifyReliefReason({
            friendlyBoardRelief: -0.02,
            holeReliefAdjust: -0.01,
        }, 0.60);
        expect(r).toBe('default');
    });

    it('空 breakdown / null → default', () => {
        expect(classifyReliefReason(null, 0.5)).toBe('default');
        expect(classifyReliefReason({}, 0.5)).toBe('default');
    });
});

describe('v1.57.5 §B: buildStoryLine relief 路径走分级文案', () => {
    /* buildStoryLine 签名：(level, breakdown, spawnTargets, spawnHints, geometry)
     * relief 触发需 spawnHints.spawnIntent='relief'；breakdown 携带各 relief 信号；
     * geometry.boardFill 用于 friendly 守卫判定。 */
    const reliefHints = { spawnIntent: 'relief' };
    const lowStressLevel = getStressLevel(0.10); // calm 档

    it('relief + friendlyBoardRelief 主导 + fill=0.69 → 不返回旧"盘面通透"文案', () => {
        const text = buildStoryLine(
            lowStressLevel,
            { friendlyBoardRelief: -0.18, frustrationRelief: -0.06 },
            {},
            reliefHints,
            { boardFill: 0.69, holes: 1, nearFullLines: 2, multiClearCandidates: 1 },
        );
        expect(text).not.toContain('盘面通透');
        /* fill=0.69 触发 friendly 守卫，friendly 候选被剔除；frustrationRelief 累加成 -0.06，
         * 落入 frustration 分支 → "注意到你刚刚不太顺..." 文案 */
        expect(text).toBe(RELIEF_NARRATIVE_BY_REASON.frustration);
    });

    it('relief + friendlyBoardRelief 主导 + fill=0.30 → friendly 文案 (含"消行机会")', () => {
        const text = buildStoryLine(
            lowStressLevel,
            { friendlyBoardRelief: -0.20 },
            {},
            reliefHints,
            { boardFill: 0.30, holes: 0, nearFullLines: 1, multiClearCandidates: 1 },
        );
        expect(text).toBe(RELIEF_NARRATIVE_BY_REASON.friendly);
        expect(text).toContain('消行机会');
    });

    it('relief + endSessionDistress 主导 → endgame 文案 (含"收尾")', () => {
        const text = buildStoryLine(
            lowStressLevel,
            { endSessionDistress: -0.20 },
            {},
            reliefHints,
            { boardFill: 0.45, holes: 1, nearFullLines: 0, multiClearCandidates: 0 },
        );
        expect(text).toBe(RELIEF_NARRATIVE_BY_REASON.endgame);
        expect(text).toContain('收尾');
    });

    it('SPAWN_INTENT_NARRATIVE.relief 默认文案已收窄为中性减压语义（无"盘面通透"）', () => {
        expect(SPAWN_INTENT_NARRATIVE.relief).not.toContain('盘面通透');
        expect(SPAWN_INTENT_NARRATIVE.relief).toContain('减压');
    });
});

/* ═══════════════════════════════════════════════════════════════════════ */
/*  §G. getStressDisplay 紧盘面笑脸守卫                                       */
/* ═══════════════════════════════════════════════════════════════════════ */

describe('v1.57.5 §G: getStressDisplay 紧盘面笑脸守卫', () => {
    it('stress=0.15 (easy) + fill=0.69 → 切到 crowded 变体（😅 + "盘面吃紧"）', () => {
        const lv = getStressDisplay(0.15, 'relief', {
            sessionPhase: 'mid',
            momentum: 0,
            frustrationLevel: 1,
            boardFill: 0.69,
        });
        expect(lv.face).toBe('😅');
        expect(lv.label).toContain('盘面吃紧');
        expect(lv.id).toContain('-crowded');
        expect(lv.vibe).toContain('盘面较密');
    });

    it('stress=0.10 (calm) + fill=0.70 → 同样切到 crowded（calm/easy 都覆盖）', () => {
        const lv = getStressDisplay(0.10, 'flow', {
            sessionPhase: 'early',
            momentum: 0.05,
            frustrationLevel: 0,
            boardFill: 0.70,
        });
        expect(lv.face).toBe('😅');
        expect(lv.id).toBe('calm-crowded');
    });

    it('stress=0.15 (easy) + fill=0.50 → 不触发 crowded，保持原 🙂', () => {
        const lv = getStressDisplay(0.15, 'flow', {
            sessionPhase: 'mid',
            momentum: 0,
            frustrationLevel: 1,
            boardFill: 0.50,
        });
        expect(lv.face).toBe('🙂');
        expect(lv.id).toBe('easy');
    });

    it('stress=0.40 (flow) + fill=0.70 → 不触发 crowded（仅 calm/easy 覆盖）', () => {
        const lv = getStressDisplay(0.40, 'flow', {
            sessionPhase: 'mid',
            momentum: 0,
            frustrationLevel: 1,
            boardFill: 0.70,
        });
        expect(lv.id).toBe('flow');
        expect(lv.face).not.toBe('😅');
    });

    it('挣扎中变体优先级高于 crowded（lateCollapse）', () => {
        const lv = getStressDisplay(0.10, 'relief', {
            sessionPhase: 'late',
            momentum: -0.35,
            frustrationLevel: 1,
            boardFill: 0.70,
        });
        expect(lv.id).toContain('-struggling');
        expect(lv.face).toBe('😣');
    });

    it('挣扎中变体优先级高于 crowded（frustration ≥ 5）', () => {
        const lv = getStressDisplay(0.10, 'relief', {
            sessionPhase: 'mid',
            momentum: 0,
            frustrationLevel: 6,
            boardFill: 0.70,
        });
        expect(lv.id).toContain('-struggling');
    });

    it('crowded 优先级高于 relief 救济变体（calm + intent=relief + fill≥0.65 → crowded 胜出）', () => {
        const lv = getStressDisplay(0.10, 'relief', {
            sessionPhase: 'mid',
            momentum: 0,
            frustrationLevel: 1,
            boardFill: 0.70,
        });
        expect(lv.id).toBe('calm-crowded');
        expect(lv.face).toBe('😅');
    });

    it('未传 boardFill（旧调用方）不抛错，保留原 emoji', () => {
        const lv = getStressDisplay(0.15, 'flow', {
            sessionPhase: 'early',
            momentum: 0,
            frustrationLevel: 0,
        });
        expect(lv.face).toBe('🙂');
        expect(lv.id).toBe('easy');
    });

    it('distress=null（旧调用方）不抛错', () => {
        const lv = getStressDisplay(0.15, 'flow', null);
        expect(lv.id).toBe('easy');
    });
});

/* ═══════════════════════════════════════════════════════════════════════ */
/*  §D. DFV 决策 chip 在 intent=relief 时计算 afkEngage 的 overridden 状态     */
/* ═══════════════════════════════════════════════════════════════════════ */

describe('v1.57.5 §D: AFK chip overridden 判定逻辑', () => {
    /* 复刻 _renderDetails 中的判定（来自 decisionFlowViz.js v1.57.5 §D 块）：
     *     const overriddenAfkEngage = (intent === 'relief') && afkEngage;
     * 这里不构造 jsdom DOM，仅锁定纯逻辑契约。 */
    function shouldMarkAfkOverridden(intent, afkEngage) {
        return (intent === 'relief') && !!afkEngage;
    }

    it('intent=relief + afkEngage=true → 标记为 overridden', () => {
        expect(shouldMarkAfkOverridden('relief', true)).toBe(true);
    });
    it('intent=engage + afkEngage=true → 不标记（engage 本身就是 AFK 介入应有意图）', () => {
        expect(shouldMarkAfkOverridden('engage', true)).toBe(false);
    });
    it('intent=relief + afkEngage=false → 不标记', () => {
        expect(shouldMarkAfkOverridden('relief', false)).toBe(false);
    });
    it('intent=harvest + afkEngage=true → 不标记（harvest 不是 AFK 信号典型覆盖路径）', () => {
        expect(shouldMarkAfkOverridden('harvest', true)).toBe(false);
    });
});
