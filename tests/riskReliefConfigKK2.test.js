/**
 * KK2: riskRelief table 数值外移到 game_rules.json 契约。
 *
 * 验证：
 *   - game_rules.json 含 riskReliefTable + 5 条规则配置
 *   - 默认值与 adaptiveSpawn.js 历史硬编码一致（防漂移）
 *   - 文档化的 5 条 rule name 不缺
 */
import { describe, it, expect } from 'vitest';
import gameRules from '../shared/game_rules.json' with { type: 'json' };

describe('KK2 riskReliefTable 配置外移', () => {
    const cfg = gameRules.adaptiveSpawn?.riskReliefTable;

    it('game_rules.json 含 adaptiveSpawn.riskReliefTable 段', () => {
        expect(cfg).toBeDefined();
        expect(cfg.comment).toMatch(/KK2/);
    });

    it('5 条规则齐全', () => {
        for (const name of [
            'high-risk-guard',
            'expert-low-risk-payoff',
            'pre-frustration-relief',
            'board-frustration-relief',
            'decision-load-relief',
        ]) {
            expect(cfg[name], `缺规则 ${name}`).toBeDefined();
        }
    });

    it('high-risk-guard 默认值与历史一致', () => {
        expect(cfg['high-risk-guard'].thresholds.confidenceMin).toBe(0.25);
        expect(cfg['high-risk-guard'].thresholds.riskLevelMin).toBe(0.62);
        expect(cfg['high-risk-guard'].apply.clearGuarantee).toBe(2);
        expect(cfg['high-risk-guard'].apply.sizePreference).toBe(-0.22);
        expect(cfg['high-risk-guard'].apply.multiClearBonus).toBe(0.45);
    });

    it('expert-low-risk-payoff 默认值与历史一致', () => {
        expect(cfg['expert-low-risk-payoff'].thresholds.confidenceMin).toBe(0.45);
        expect(cfg['expert-low-risk-payoff'].thresholds.skillScoreMin).toBe(0.72);
        expect(cfg['expert-low-risk-payoff'].thresholds.riskLevelMax).toBe(0.38);
        expect(cfg['expert-low-risk-payoff'].apply.diversityBoost).toBe(0.12);
        expect(cfg['expert-low-risk-payoff'].apply.multiClearBonus).toBe(0.5);
    });

    it('pre/board-frustration-relief apply 值', () => {
        expect(cfg['pre-frustration-relief'].apply.sizePreference).toBe(-0.18);
        expect(cfg['board-frustration-relief'].apply.sizePreference).toBe(-0.28);
    });

    it('decision-load-relief 默认值', () => {
        expect(cfg['decision-load-relief'].apply.clearGuarantee).toBe(2);
        expect(cfg['decision-load-relief'].apply.diversityBoost).toBe(0.08);
    });
});
