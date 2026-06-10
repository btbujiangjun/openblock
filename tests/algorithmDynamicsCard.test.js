/**
 * algorithmDynamicsCard.test.js — v1.59 算法决策动态卡片单测
 *
 * 锁定 6 个纯函数渲染模块的行为契约：
 *   §A renderDecisionSnapshotCard
 *   §B renderIntentTimeline
 *   §C renderStressBreakdownStack
 *   §D renderDecisionReasoningCard
 *   §E renderShapeWeightsDrift
 *   §F renderResponseSensitivityCard + _pearson
 *
 * 设计：每个模块独立测试 (1) 空数据降级 (2) 典型 happy path (3) 关键边界。
 * 不测 DOM 挂载（由 panel 接入测试覆盖），只测渲染函数输出 HTML 字符串的关键标记。
 */

import { describe, it, expect } from 'vitest';
import {
    renderDecisionSnapshotCard,
    renderIntentTimeline,
    renderStressBreakdownStack,
    renderDecisionReasoningCard,
    renderShapeWeightsDrift,
    renderResponseSensitivityCard,
    renderAlgorithmDynamicsCard,
    _pearson,
} from '../web/src/algorithmDynamicsCard.js';

const _baseIntentInputs = {
    flowState: 'flow',
    spawnRound: 5,
    sessionPhase: 'peak',
    pacingPhase: 'tension',
    momentum: 0.1,
    frustrationLevel: 0,
    stress: 0.5,
    skillLevel: 0.6,
    feedbackBias: 0,
    forceReliefIntent: false,
    playerDistress: 0,
    delightMode: null,
    flowDeviation: 0.2,
    hadRecentNearMiss: false,
    needsRecovery: false,
};

function _makeInsight(over = {}) {
    return {
        stress: 0.55,
        _adaptiveStress: 0.55,
        spawnIntent: 'flow',
        spawnSource: 'rule',
        spawnHints: {
            spawnIntent: 'flow',
            rhythmPhase: 'neutral',
            sessionArc: 'peak',
            clearGuarantee: 1,
            sizePreference: 0,
            multiClearBonus: 0.1,
            orderRigor: 0,
        },
        stressBreakdown: {
            scoreStress: 0.30,
            flowAdjust: 0.05,
            frustrationRelief: -0.08,
            recoveryAdjust: -0.05,
            sessionArcAdjust: 0.10,
        },
        spawnDiagnostics: { layer1: { fill: 0.40, nearFullLines: 0, pcSetup: 0 } },
        _intentInputs: { ..._baseIntentInputs },
        shapeWeightsTop: [
            { category: 'squares', weight: 1.0, probability: 0.25 },
            { category: 'lines', weight: 0.8, probability: 0.20 },
            { category: 'rects', weight: 0.6, probability: 0.15 },
        ],
        ...over,
    };
}

function _makeProfile(over = {}) {
    return {
        flowState: 'flow',
        flowDeviation: 0.2,
        spawnRoundIndex: 5,
        momentum: 0.1,
        ...over,
    };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §A renderDecisionSnapshotCard                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('§A renderDecisionSnapshotCard', () => {
    it('空 insight → 降级 empty 提示', () => {
        const html = renderDecisionSnapshotCard(null, null);
        expect(html).toContain('adc-snapshot--empty');
    });

    it('典型 insight → 输出 intent chip + sourceChip + stress bar + upstream 段', () => {
        const html = renderDecisionSnapshotCard(_makeInsight(), _makeProfile());
        expect(html).toContain('adc-intent-chip');
        expect(html).toContain('flow');
        expect(html).toContain('rule 决策AI');
        expect(html).toContain('adc-stress-bar');
        expect(html).toContain('adc-snapshot__row--upstream');
    });

    it('spawnSource=model-v3 + meta → 输出 V3 生成式标签 + 个性化 / 可行数', () => {
        const ins = _makeInsight({
            spawnSource: 'model-v3',
            spawnModelMeta: { modelVersion: 'v3.2', personalized: true, feasibleCount: 12 },
        });
        const html = renderDecisionSnapshotCard(ins, _makeProfile());
        expect(html).toContain('V3 生成式AI');
        expect(html).toContain('v3.2');
        expect(html).toContain('个性化');
        expect(html).toContain('可行 12');
    });

    it('pbOvershootActive=true → 输出 PB 超越 trigger chip', () => {
        const ins = _makeInsight({
            spawnHints: {
                spawnIntent: 'pressure', rhythmPhase: 'neutral', sessionArc: 'peak',
                pbOvershootActive: true,
            },
        });
        const html = renderDecisionSnapshotCard(ins, _makeProfile());
        expect(html).toContain('PB 超越');
        expect(html).toContain('adc-trig-chip--press');
    });

    it('winbackProtectionActive=true → 输出回流保护 chip', () => {
        const ins = _makeInsight({
            spawnHints: { spawnIntent: 'flow', rhythmPhase: 'neutral', sessionArc: 'warmup', winbackProtectionActive: true },
        });
        const html = renderDecisionSnapshotCard(ins, _makeProfile());
        expect(html).toContain('回流保护');
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §B renderIntentTimeline                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('§B renderIntentTimeline', () => {
    it('空 history → 降级 empty', () => {
        expect(renderIntentTimeline([], 20)).toContain('adc-timeline--empty');
        expect(renderIntentTimeline(null, 20)).toContain('adc-timeline--empty');
    });

    it('3 轮历史 → 输出 3 个 chip', () => {
        const history = [
            { spawnRound: 1, adaptive: { stress: 0.3, spawnHints: { spawnIntent: 'flow' } } },
            { spawnRound: 2, adaptive: { stress: 0.5, spawnHints: { spawnIntent: 'flow' } } },
            { spawnRound: 3, adaptive: { stress: 0.7, spawnHints: { spawnIntent: 'pressure' } } },
        ];
        const html = renderIntentTimeline(history, 20);
        expect(html).toContain('R1');
        expect(html).toContain('R2');
        expect(html).toContain('R3');
        expect(html).toContain('adc-tl-chip--changed'); // R3 切换
    });

    it('意图切换次数统计正确（4 轮内切换 2 次）', () => {
        const history = [
            { spawnRound: 1, adaptive: { stress: 0.3, spawnHints: { spawnIntent: 'flow' } } },
            { spawnRound: 2, adaptive: { stress: 0.5, spawnHints: { spawnIntent: 'pressure' } } },
            { spawnRound: 3, adaptive: { stress: 0.5, spawnHints: { spawnIntent: 'pressure' } } },
            { spawnRound: 4, adaptive: { stress: 0.3, spawnHints: { spawnIntent: 'flow' } } },
        ];
        const html = renderIntentTimeline(history, 20);
        expect(html).toContain('切换 2 次');
    });

    it('N 截断：history 30 轮，N=5 → 只渲染 5 个 chip', () => {
        const history = Array.from({ length: 30 }, (_, i) => ({
            spawnRound: i + 1,
            adaptive: { stress: 0.5, spawnHints: { spawnIntent: 'flow' } },
        }));
        const html = renderIntentTimeline(history, 5);
        const chipCount = (html.match(/adc-tl-chip--flow/g) || []).length;
        expect(chipCount).toBe(5);
    });

    it('同 round 多帧 → 聚合为 1 个 chip（取最后快照）', () => {
        const history = [
            { spawnRound: 1, adaptive: { stress: 0.3, spawnHints: { spawnIntent: 'flow' } } },
            { spawnRound: 1, adaptive: { stress: 0.4, spawnHints: { spawnIntent: 'flow' } } },
            { spawnRound: 1, adaptive: { stress: 0.5, spawnHints: { spawnIntent: 'relief' } } },
        ];
        const html = renderIntentTimeline(history, 20);
        const chipCount = (html.match(/R1<\/span>/g) || []).length;
        expect(chipCount).toBe(1);
        expect(html).toContain('adc-tl-chip--relief'); // 最后一个快照是 relief
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §C renderStressBreakdownStack                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('§C renderStressBreakdownStack', () => {
    it('空 breakdown → 降级 empty', () => {
        expect(renderStressBreakdownStack({ stressBreakdown: null })).toContain('adc-stack--empty');
        expect(renderStressBreakdownStack({})).toContain('adc-stack--empty');
    });

    it('全部小于阈值（|v| < 0.005）→ 空贡献提示', () => {
        const html = renderStressBreakdownStack({
            stressBreakdown: { scoreStress: 0.001, flowAdjust: -0.002 },
        });
        expect(html).toContain('本帧无 stress 分量贡献');
    });

    it('混合正负分量 → 顶部 net summary + 左右双栏 top 条目 + label 完整可见（v1.59.4 重做）', () => {
        const html = renderStressBreakdownStack({
            stress: 0.32,
            stressBreakdown: {
                scoreStress: 0.30,
                flowAdjust: 0.10,
                frustrationRelief: -0.08,
                recoveryAdjust: -0.05,
                sessionArcAdjust: 0.05,
            },
        });
        // 顶部 summary 只保留 net
        expect(html).toContain('adc-stack__sum--net');
        // 双栏布局
        expect(html).toContain('adc-stack__cols');
        expect(html).toContain('adc-stack-block--pos');
        expect(html).toContain('adc-stack-block--neg');
        // 排序条目（label 完整可见）
        expect(html).toContain('adc-stack-item');
        expect(html).toContain('adc-stack-item__label');
        expect(html).toContain('adc-stack-item__bar-fill--pos');
        expect(html).toContain('adc-stack-item__bar-fill--neg');
        expect(html).toContain('分数档');
        expect(html).toContain('挫败救济');
    });

    it('net 与 stress 差距 > 0.10 → tooltip 提示 clamp/平滑/封顶被踩到', () => {
        const html = renderStressBreakdownStack({
            stress: 0.20,
            stressBreakdown: { scoreStress: 0.80, flowAdjust: 0.10 }, // sum=0.90 但 stress=0.20
        });
        expect(html).toContain('clamp/平滑/封顶被踩到');
    });

    it('只有正分量 → 救济栏显示无救济提示', () => {
        const html = renderStressBreakdownStack({
            stress: 0.5,
            stressBreakdown: { scoreStress: 0.30, flowAdjust: 0.20 },
        });
        expect(html).toContain('无救济分量');
    });

    it('超过 top-N (默认 4) 的分量合并为 "其他 N 项" 行（v1.59.4）', () => {
        const html = renderStressBreakdownStack({
            stress: 0.6,
            stressBreakdown: {
                scoreStress: 0.30,
                flowAdjust: 0.10,
                sessionArcAdjust: 0.08,
                pacingAdjust: 0.06,
                trendAdjust: 0.04,     // 第 5 项 → 进入 "其他"
                comboAdjust: 0.03,     // 第 6 项 → 进入 "其他"
                challengeBoost: 0.02,  // 第 7 项 → 进入 "其他"
            },
        });
        expect(html).toContain('adc-stack-item--rest');
        expect(html).toContain('其他 3 项');
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §D renderDecisionReasoningCard                                               */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('§D renderDecisionReasoningCard', () => {
    it('缺 _intentInputs → 降级 empty 提示', () => {
        const html = renderDecisionReasoningCard({}, _makeProfile());
        expect(html).toContain('adc-reasoning--empty');
    });

    it('典型 insight → 三段都渲染（trace / drivers / 可选 conflicts）', () => {
        const html = renderDecisionReasoningCard(_makeInsight(), _makeProfile());
        expect(html).toContain('意图决策路径');
        expect(html).toContain('hint 字段驱动源');
        // trace 至少包含 flow 规则
        expect(html).toContain('flow');
    });

    it('胜出规则带 🏆 标记', () => {
        const html = renderDecisionReasoningCard(_makeInsight(), _makeProfile());
        expect(html).toContain('🏆');
    });

    it('clearGuarantee=3 + frustration=5 → 输出 frustration ≥ 4 驱动源', () => {
        const ins = _makeInsight({
            spawnHints: { spawnIntent: 'relief', rhythmPhase: 'payoff', sessionArc: 'peak', clearGuarantee: 3 },
            stressBreakdown: { scoreStress: 0.3, frustrationRelief: -0.10 },
            _intentInputs: { ..._baseIntentInputs, frustrationLevel: 5, forceReliefIntent: true },
        });
        const html = renderDecisionReasoningCard(ins, _makeProfile());
        expect(html).toContain('clearGuarantee');
        expect(html).toContain('frustration=5');
    });

    it('hint 全部默认 → 显示"无明显驱动信号"', () => {
        const ins = _makeInsight({
            spawnHints: { spawnIntent: 'flow', rhythmPhase: 'neutral', sessionArc: 'peak', clearGuarantee: 1, sizePreference: 0, multiClearBonus: 0 },
        });
        const html = renderDecisionReasoningCard(ins, _makeProfile());
        expect(html).toContain('无明显驱动信号');
    });

    it('bored + relief 触发 → conflicts 段可见 flowVsIntent', () => {
        const ins = _makeInsight({
            spawnHints: { spawnIntent: 'relief', rhythmPhase: 'payoff', sessionArc: 'peak' },
            _intentInputs: { ..._baseIntentInputs, flowState: 'bored', forceReliefIntent: true },
        });
        const html = renderDecisionReasoningCard(ins, _makeProfile({ flowState: 'bored' }));
        expect(html).toContain('跨维度冲突');
        expect(html).toContain('flowVsIntent');
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §E renderShapeWeightsDrift                                                   */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('§E renderShapeWeightsDrift', () => {
    it('空 shapeWeightsTop → 降级 empty', () => {
        expect(renderShapeWeightsDrift({}, [])).toContain('adc-drift--empty');
    });

    it('有承诺、无实际 → 输出"等待 dockCategories 采集" + 中文化 category 标签', () => {
        const html = renderShapeWeightsDrift(_makeInsight(), []);
        expect(html).toContain('等待 dockCategories 采集');
        expect(html).toContain('方形'); // squares → "方形"（_CAT_LABEL 中文化）
        expect(html).toContain('adc-drift-eps--na'); // 无实际数据 → ε=NA
    });

    it('有承诺 + 历史 dockCategories → 计算偏差 ε', () => {
        const history = [
            { spawnRound: 1, dockCategories: ['squares', 'squares', 'lines'] },
            { spawnRound: 2, dockCategories: ['lines', 'rects', 'squares'] },
        ];
        const html = renderShapeWeightsDrift(_makeInsight(), history, 10);
        expect(html).toContain('窗口 2 轮 / 6 块');
        expect(html).toContain('adc-drift-eps');
    });

    it('|ε| < 0.03 → eps--ok 类', () => {
        // 承诺各 1/3，实际各 1/3 → ε=0
        const insight = {
            shapeWeightsTop: [
                { category: 'squares', weight: 1 },
                { category: 'lines', weight: 1 },
                { category: 'rects', weight: 1 },
            ],
        };
        const history = [
            { spawnRound: 1, dockCategories: ['squares', 'lines', 'rects'] },
            { spawnRound: 2, dockCategories: ['squares', 'lines', 'rects'] },
            { spawnRound: 3, dockCategories: ['squares', 'lines', 'rects'] },
        ];
        const html = renderShapeWeightsDrift(insight, history, 10);
        expect(html).toContain('adc-drift-eps--ok');
    });

    it('|ε| > 0.07 → eps--bad 类', () => {
        // 承诺只有 squares，实际只出 lines → 严重偏差
        const insight = {
            shapeWeightsTop: [
                { category: 'squares', weight: 10 },
                { category: 'lines', weight: 0.01 },
            ],
        };
        const history = [
            { spawnRound: 1, dockCategories: ['lines', 'lines', 'lines'] },
        ];
        const html = renderShapeWeightsDrift(insight, history, 10);
        expect(html).toContain('adc-drift-eps--bad');
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §F renderResponseSensitivityCard + _pearson                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('§F renderResponseSensitivityCard', () => {
    it('样本不足（<8 帧）→ empty 降级（v1.59.5：MIN_N 4→8）', () => {
        expect(renderResponseSensitivityCard([], 12)).toContain('adc-sens--empty');
        expect(renderResponseSensitivityCard([{}, {}, {}], 12)).toContain('adc-sens--empty');
        // 4~7 帧也降级
        const seven = Array.from({ length: 7 }, () => ({
            metrics: { clearRate: 0.3, missRate: 0.3 },
            momentum: 0,
            adaptive: { stress: 0.5, spawnHints: { clearGuarantee: 2 } },
        }));
        expect(renderResponseSensitivityCard(seven, 12)).toContain('adc-sens--empty');
    });

    it('v1.59.10：3 对 label 全替换为 skill⇄skillAdjust / frust⇄frustRelief / momentum⇄救济', () => {
        const history = Array.from({ length: 10 }, (_, i) => ({
            skill: 0.4 + 0.04 * i,
            frustration: 1,
            momentum: 0.1 * i,
            adaptive: {
                stressBreakdown: { skillAdjust: -0.03 + 0.01 * i, frustrationRelief: 0, sessionArcAdjust: 0, endSessionDistress: 0 },
            },
        }));
        const html = renderResponseSensitivityCard(history, 12);
        expect(html).toContain('skill ⇄ skillAdjust');
        expect(html).toContain('frust ⇄ frustRelief');
        expect(html).toContain('momentum ⇄ 救济');
        // 旧 label 完全消失
        expect(html).not.toContain('clearRate ⇄ clearG');
        expect(html).not.toContain('missRate ⇄ clearG');
        expect(html).not.toContain('momentum ⇄ stress');
    });

    it('skill⇄skillAdjust 完美正相关（机制纯响应）→ good 灵敏', () => {
        // 玩家 skill 单调↑，算法 skillAdjust 同步↑（线性纯响应）
        const history = Array.from({ length: 8 }, (_, i) => ({
            skill: 0.2 + i * 0.08,
            frustration: 0,
            momentum: 0,
            adaptive: {
                stressBreakdown: { skillAdjust: -0.05 + i * 0.02, frustrationRelief: 0, sessionArcAdjust: 0, endSessionDistress: 0 },
            },
        }));
        const html = renderResponseSensitivityCard(history, 12);
        expect(html).toContain('skill ⇄ skillAdjust');
        expect(html).toContain('adc-sens-row--good');
        expect(html).toContain('灵敏');
    });

    it('frust⇄frustRelief 完美负相关（挫败救济）→ good 灵敏', () => {
        // 玩家挫败↑（0→7），算法救济同步↓（0→-0.18 阶跃，这里线性近似）
        const history = Array.from({ length: 8 }, (_, i) => ({
            skill: 0.5,
            frustration: i,
            momentum: 0,
            adaptive: {
                stressBreakdown: { skillAdjust: 0, frustrationRelief: -i * 0.025, sessionArcAdjust: 0, endSessionDistress: 0 },
            },
        }));
        const html = renderResponseSensitivityCard(history, 12);
        expect(html).toContain('adc-sens-row--good');
    });

    it('frust⇄frustRelief 反向（挫败↑算法却加压）→ bad 反向红警', () => {
        const history = Array.from({ length: 8 }, (_, i) => ({
            skill: 0.5,
            frustration: i,
            momentum: 0,
            adaptive: {
                stressBreakdown: { skillAdjust: 0, frustrationRelief: i * 0.03, sessionArcAdjust: 0, endSessionDistress: 0 },
            },
        }));
        const html = renderResponseSensitivityCard(history, 12);
        expect(html).toContain('adc-sens-row--bad');
        expect(html).toContain('请查算法');
    });

    it('信号方差极小（恒定值）→ dull "玩家这项无变化"（v1.59.8 文案口语化）', () => {
        const history = Array.from({ length: 10 }, () => ({
            skill: 0.5,
            frustration: 1,
            momentum: 0,
            adaptive: {
                stressBreakdown: { skillAdjust: 0, frustrationRelief: 0, sessionArcAdjust: 0, endSessionDistress: 0 },
            },
        }));
        const html = renderResponseSensitivityCard(history, 12);
        expect(html).toContain('adc-sens-row--dull');
        // v1.59.8：文案改为口语化"玩家这项无变化"/"算法这项无调整"
        expect(html).toMatch(/玩家这项无变化|算法这项无调整/);
    });

    it('|r| < 0.30 → dull 迟钝（v1.59.5：弱阈值 0.20→0.30）', () => {
        // 玩家 skill 与算法 skillAdjust 几乎随机 → 低相关
        const history = Array.from({ length: 8 }, (_, i) => ({
            skill: [0.3, 0.4, 0.35, 0.5, 0.45, 0.4, 0.55, 0.5][i],
            frustration: 1,
            momentum: 0,
            adaptive: {
                stressBreakdown: {
                    skillAdjust: [-0.02, 0.01, -0.01, 0.02, -0.015, 0.005, 0.0, -0.005][i],
                    frustrationRelief: 0, sessionArcAdjust: 0, endSessionDistress: 0,
                },
            },
        }));
        const html = renderResponseSensitivityCard(history, 12);
        expect(html).toContain('adc-sens-row--dull');
    });
});

describe('§F _pearson 纯函数边界', () => {
    it('完美正相关 → r=1', () => {
        expect(_pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 5);
    });
    it('完美负相关 → r=-1', () => {
        expect(_pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 5);
    });
    it('无相关 → 接近 0', () => {
        const r = _pearson([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
        expect(r != null && Math.abs(r) < 0.5).toBe(true);
    });
    it('长度不一致 → null', () => {
        expect(_pearson([1, 2, 3], [1, 2])).toBeNull();
    });
    it('样本太少（<4）→ null', () => {
        expect(_pearson([1, 2, 3], [1, 2, 3])).toBeNull();
    });
    it('方差为 0（恒定值）→ null', () => {
        expect(_pearson([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
    });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  入口聚合测试                                                                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe('renderAlgorithmDynamicsCard 聚合入口', () => {
    it('完整 model → 输出 6 个 section', () => {
        const html = renderAlgorithmDynamicsCard({
            insight: _makeInsight(),
            profile: _makeProfile(),
            history: [
                { spawnRound: 1, adaptive: { stress: 0.5, spawnHints: { spawnIntent: 'flow' } } },
            ],
        });
        expect(html).toContain('adc-section--snapshot');
        expect(html).toContain('adc-section--timeline');
        expect(html).toContain('adc-section--stack');
        expect(html).toContain('adc-section--reasoning');
        expect(html).toContain('adc-section--drift');
        expect(html).toContain('adc-section--sens');
    });

    it('空 model → 全部子模块降级 empty，不抛错', () => {
        const html = renderAlgorithmDynamicsCard({});
        expect(html).toContain('adc-snapshot--empty');
        expect(html).toContain('adc-timeline--empty');
        expect(html).toContain('adc-stack--empty');
        expect(html).toContain('adc-reasoning--empty');
        expect(html).toContain('adc-drift--empty');
        expect(html).toContain('adc-sens--empty');
    });

    it('opts 自定义 N → 透传给子模块（timeline 截断生效）', () => {
        const history = Array.from({ length: 20 }, (_, i) => ({
            spawnRound: i + 1, adaptive: { stress: 0.5, spawnHints: { spawnIntent: 'flow' } },
        }));
        const html = renderAlgorithmDynamicsCard({ history }, { timelineN: 3 });
        const chipCount = (html.match(/adc-tl-chip--flow/g) || []).length;
        expect(chipCount).toBe(3);
    });
});
