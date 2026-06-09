/**
 * @vitest-environment jsdom
 *
 * strategyAdvisor × evaluation 集成：验证 lastMoveEval 能驱动 evaluation 类别的复盘卡。
 */
import { describe, it, expect } from 'vitest';
import { generateStrategyTips } from '../../web/src/strategyAdvisor.js';

function mkProfile(over = {}) {
    return {
        flowState: 'flow', skillLevel: 0.6, momentum: 0.1,
        frustrationLevel: 0.2, sessionPhase: 'mid', isNewPlayer: false,
        isInOnboarding: false, metrics: {}, ...over,
    };
}

const INSIGHT = {
    spawnHints: {}, spawnDiagnostics: { layer1: {} }, boardFill: 0.5,
};
const GRID_INFO = { fillRatio: 0.5, holesCount: 0 };

describe('strategyAdvisor × evaluation', () => {
    it('lastMoveEval=null → 不出 evaluation 类别', () => {
        const tips = generateStrategyTips(mkProfile(), INSIGHT, GRID_INFO);
        expect(tips.some((t) => t.category === 'evaluation')).toBe(false);
    });

    it('badnessTag=created_hole + regret≥0.10 → 出 evaluation 卡', () => {
        const tips = generateStrategyTips(mkProfile(), INSIGHT, GRID_INFO, {
            badnessTag: 'created_hole', regret: 0.25, optimality: 0.6,
        });
        const evalTip = tips.find((t) => t.category === 'evaluation');
        expect(evalTip).toBeTruthy();
        expect(evalTip.title).toContain('空洞');
    });

    it('badnessTag=top_stacking → 堆叠提示', () => {
        const tips = generateStrategyTips(mkProfile(), INSIGHT, GRID_INFO, {
            badnessTag: 'top_stacking', regret: 0.18, optimality: 0.7,
        });
        const t = tips.find((x) => x.category === 'evaluation');
        expect(t?.title).toContain('堆叠');
    });

    it('badnessTag=wasted_payoff → 错过清行提示', () => {
        const tips = generateStrategyTips(mkProfile(), INSIGHT, GRID_INFO, {
            badnessTag: 'wasted_payoff', regret: 0.30, optimality: 0.5,
        });
        const t = tips.find((x) => x.category === 'evaluation');
        expect(t?.title).toContain('清行');
    });

    it('badnessTag=optimal/fine → 不出 evaluation 卡', () => {
        for (const tag of ['optimal', 'fine']) {
            const tips = generateStrategyTips(mkProfile(), INSIGHT, GRID_INFO, {
                badnessTag: tag, regret: 0.5, optimality: 1,
            });
            expect(tips.some((t) => t.category === 'evaluation')).toBe(false);
        }
    });

    it('regret < 0.10 → 抑制（避免微小失误打扰）', () => {
        const tips = generateStrategyTips(mkProfile(), INSIGHT, GRID_INFO, {
            badnessTag: 'created_hole', regret: 0.05, optimality: 0.9,
        });
        expect(tips.some((t) => t.category === 'evaluation')).toBe(false);
    });

    it('flowState=anxious → 抑制（不打扰焦虑玩家）', () => {
        const tips = generateStrategyTips(mkProfile({ flowState: 'anxious' }),
            INSIGHT, GRID_INFO, {
                badnessTag: 'created_hole', regret: 0.3, optimality: 0.5,
            });
        expect(tips.some((t) => t.category === 'evaluation')).toBe(false);
    });
});
