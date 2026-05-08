/**
 * @vitest-environment jsdom
 *
 * v1.17：strategyAdvisor 卡互斥 —— 同面板上"收获期/兑现"叙事
 * 与"提升挑战 → 多行同消（3 行+）"建议在语义上互斥，应只出其一。
 */
import { describe, it, expect } from 'vitest';
import { generateStrategyTips } from '../web/src/strategyAdvisor.js';

/** 最小桩 profile —— 只含 strategyAdvisor 实际读取的字段，避免依赖 PlayerProfile 内部启发式。*/
function makeStubProfile(overrides = {}) {
    return {
        flowState: 'bored',
        skillLevel: 0.6,
        metrics: { thinkMs: 500, missRate: 0.02, clearRate: 0.5 },
        momentum: 0.0,
        frustrationLevel: 0,
        sessionPhase: 'peak',
        needsRecovery: false,
        recentComboStreak: 0,
        hadRecentNearMiss: false,
        cognitiveLoad: 0.3,
        isInOnboarding: false,
        isNewPlayer: false,
        ...overrides
    };
}

describe('strategyAdvisor v1.17：收获期/提升挑战 互斥', () => {
    it('rhythmPhase=payoff 时不出"提升挑战"卡（避免与"收获期"叙事拉扯）', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'payoff', spawnIntent: 'harvest' },
            spawnDiagnostics: { layer1: { nearFullLines: 3, multiClearCandidates: 2 } },
            boardFill: 0.30
        };
        const tips = generateStrategyTips(makeStubProfile(), insight, {
            fillRatio: 0.30, holesCount: 0,
            liveTopology: { nearFullLines: 3 }, // v1.23：注入 live 几何让"收获期"原文案触发
            liveMultiClearCandidates: 2
        });
        // v1.23：title 可能是「收获期」或「收获期·待兑现」，统一断言收获相关卡（icon=💎/category=pace）
        expect(tips.find((t) => t.icon === '💎')).toBeDefined();
        expect(tips.find((t) => t.title === '提升挑战')).toBeUndefined();
    });

    it('rhythmPhase=neutral + 中等占用时仍可出"提升挑战"卡', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'neutral', spawnIntent: 'flow' },
            boardFill: 0.40
        };
        const tips = generateStrategyTips(makeStubProfile(), insight, {
            fillRatio: 0.40, holesCount: 0
        });
        expect(tips.find((t) => t.title === '提升挑战')).toBeDefined();
        expect(tips.find((t) => t.title === '收获期')).toBeUndefined();
    });

    it('盘面太稀（fill<0.18）不出"提升挑战 → 3 行+"建议（物理上做不到）', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'neutral', spawnIntent: 'maintain' },
            boardFill: 0.10
        };
        const tips = generateStrategyTips(makeStubProfile(), insight, {
            fillRatio: 0.10, holesCount: 0
        });
        expect(tips.find((t) => t.title === '提升挑战')).toBeUndefined();
    });

    it('spawnIntent=harvest 单独也能抑制"提升挑战"卡（即使 rhythmPhase 不是 payoff）', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'neutral', spawnIntent: 'harvest' },
            boardFill: 0.40
        };
        const tips = generateStrategyTips(makeStubProfile(), insight, {
            fillRatio: 0.40, holesCount: 0
        });
        expect(tips.find((t) => t.title === '提升挑战')).toBeUndefined();
    });
});

describe('strategyAdvisor v1.18：多消机会 / 瓶颈块', () => {
    it('nearFullLines≥3 + multiClearCands≥2 → "多消机会"原文案', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'payoff', spawnIntent: 'harvest' },
            spawnDiagnostics: { layer1: { nearFullLines: 3, multiClearCandidates: 3 } },
            boardFill: 0.55
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow' }),
            insight, { fillRatio: 0.55, holesCount: 0 });
        const card = tips.find((t) => t.title === '多消机会');
        expect(card).toBeDefined();
        expect(card.detail).toMatch(/同时完成多行/);
        expect(tips.find((t) => t.title === '逐条清理')).toBeUndefined();
    });

    it('nearFullLines≥3 + multiClearCands<2 → "逐条清理"诚实文案', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'payoff', spawnIntent: 'relief' },
            spawnDiagnostics: { layer1: { nearFullLines: 3, multiClearCandidates: 1 } },
            boardFill: 0.58
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'anxious' }),
            insight, { fillRatio: 0.58, holesCount: 0 });
        expect(tips.find((t) => t.title === '多消机会')).toBeUndefined();
        const card = tips.find((t) => t.title === '逐条清理');
        expect(card).toBeDefined();
        expect(card.detail).toMatch(/最容易消的那条|缓解压力/);
    });

    it('validPerms ≤ 2 + fill ≥ 0.4 → 弹"瓶颈块"高优先级卡', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'neutral' },
            spawnDiagnostics: { layer1: {
                solutionMetrics: { validPerms: 1, firstMoveFreedom: 4, solutionCount: 12, capped: false },
                nearFullLines: 2,
                multiClearCandidates: 0
            } },
            boardFill: 0.55
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow' }),
            insight, { fillRatio: 0.55, holesCount: 0 });
        const card = tips.find((t) => t.title === '瓶颈块');
        expect(card).toBeDefined();
        expect(card.detail).toMatch(/1\/6|瓶颈块仅 4/);
        // 瓶颈预警优先级应高于普通建议（>= 0.8）
        expect(card.priority).toBeGreaterThanOrEqual(0.8);
    });

    it('validPerms 充裕（>2）不出"瓶颈块"卡', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'neutral' },
            spawnDiagnostics: { layer1: {
                solutionMetrics: { validPerms: 5, firstMoveFreedom: 12, solutionCount: 64, capped: true },
                nearFullLines: 0
            } },
            boardFill: 0.45
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow' }),
            insight, { fillRatio: 0.45, holesCount: 0 });
        expect(tips.find((t) => t.title === '瓶颈块')).toBeUndefined();
    });

    it('fill<0.4 不报"瓶颈块"（解法度量未激活，避免冷启动误报）', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'neutral' },
            spawnDiagnostics: { layer1: {
                solutionMetrics: { validPerms: 1, firstMoveFreedom: 3, solutionCount: 4, capped: false },
                nearFullLines: 0
            } },
            boardFill: 0.30
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow' }),
            insight, { fillRatio: 0.30, holesCount: 0 });
        expect(tips.find((t) => t.title === '瓶颈块')).toBeUndefined();
    });
});

describe('strategyAdvisor v1.23：收获期卡 live 几何 mutex', () => {
    it('rhythmPhase=payoff + live 几何不支持（multiClearCands=0 + nearFullLines=0）→ 切「收获期·待兑现」诚实文案', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'payoff', spawnIntent: 'relief' },
            spawnDiagnostics: { layer1: { nearFullLines: 2, multiClearCandidates: 1 } }, // spawn 时有几何
            boardFill: 0.36
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'anxious' }),
            insight, {
                fillRatio: 0.36, holesCount: 0,
                liveTopology: { nearFullLines: 0 }, // live 几何已经掉到 0
                liveMultiClearCandidates: 0
            });
        const card = tips.find((t) => t.title === '收获期·待兑现');
        expect(card).toBeDefined();
        expect(card.detail).toMatch(/没对上消行机会|稳住手等下次/);
        expect(tips.find((t) => t.title === '收获期')).toBeUndefined();
    });

    it('rhythmPhase=payoff + live 几何支持（multiClearCands≥1）→ 仍出原「收获期」卡', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'payoff', spawnIntent: 'harvest' },
            spawnDiagnostics: { layer1: { nearFullLines: 3, multiClearCandidates: 2 } },
            boardFill: 0.55
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow' }),
            insight, {
                fillRatio: 0.55, holesCount: 0,
                liveTopology: { nearFullLines: 3 },
                liveMultiClearCandidates: 2
            });
        const card = tips.find((t) => t.title === '收获期');
        expect(card).toBeDefined();
        expect(card.detail).toMatch(/积极消除/);
        expect(tips.find((t) => t.title === '收获期·待兑现')).toBeUndefined();
    });

    it('rhythmPhase=payoff + live multiClearCands=0 但 nearFullLines≥2 → 仍出原「收获期」卡（任一条满足即可）', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'payoff', spawnIntent: 'harvest' },
            spawnDiagnostics: { layer1: { nearFullLines: 2, multiClearCandidates: 0 } },
            boardFill: 0.45
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow' }),
            insight, {
                fillRatio: 0.45, holesCount: 0,
                liveTopology: { nearFullLines: 2 },
                liveMultiClearCandidates: 0
            });
        const card = tips.find((t) => t.title === '收获期');
        expect(card).toBeDefined();
    });

    it('rhythmPhase=payoff + 未注入 live 几何（panel 没传）→ fall back 到 diag.layer1（spawn 快照）', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'payoff', spawnIntent: 'harvest' },
            spawnDiagnostics: { layer1: { nearFullLines: 3, multiClearCandidates: 2 } },
            boardFill: 0.55
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow' }),
            insight, { fillRatio: 0.55, holesCount: 0 }); // 无 liveTopology / liveMultiClearCandidates
        const card = tips.find((t) => t.title === '收获期');
        expect(card).toBeDefined(); // 兼容旧 panel：snapshot 几何还是给原文案
    });
});

describe('strategyAdvisor v1.22：规划堆叠 vs 收获期 互斥', () => {
    it('rhythmPhase=payoff + fill<0.3 + skill>0.5 时不出"规划堆叠"（避免与"收获期"叙事拉扯）', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'payoff', spawnIntent: 'flow' },
            spawnDiagnostics: { layer1: { nearFullLines: 2, multiClearCandidates: 1 } },
            boardFill: 0.28
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow', skillLevel: 0.78 }),
            insight, {
                fillRatio: 0.28, holesCount: 0,
                liveTopology: { nearFullLines: 2 }, // v1.23：注入 live 几何让"收获期"原文案触发
                liveMultiClearCandidates: 1
            });
        // v1.23：title 可能是「收获期」或「收获期·待兑现」，统一断言收获相关卡（icon=💎）
        expect(tips.find((t) => t.icon === '💎')).toBeDefined();
        expect(tips.find((t) => t.title === '规划堆叠')).toBeUndefined();
    });

    it('spawnIntent=harvest 单独也能抑制"规划堆叠"卡', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'neutral', spawnIntent: 'harvest' },
            boardFill: 0.25
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow', skillLevel: 0.7 }),
            insight, { fillRatio: 0.25, holesCount: 0 });
        expect(tips.find((t) => t.title === '规划堆叠')).toBeUndefined();
    });

    it('rhythmPhase=neutral + fill<0.3 + skill>0.5 仍可出"规划堆叠"（搭建/中性期保留长期建议）', () => {
        const insight = {
            spawnHints: { rhythmPhase: 'neutral', spawnIntent: 'flow' },
            boardFill: 0.25
        };
        const tips = generateStrategyTips(makeStubProfile({ flowState: 'flow', skillLevel: 0.75 }),
            insight, { fillRatio: 0.25, holesCount: 0 });
        expect(tips.find((t) => t.title === '规划堆叠')).toBeDefined();
    });
});
