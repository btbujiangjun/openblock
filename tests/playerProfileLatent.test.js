/**
 * @vitest-environment jsdom
 *
 * §4.17/§2.10 PlayerProfile θ⃗ 持久化 + 标定向量激活链。
 */
import { describe, it, expect } from 'vitest';
import { PlayerProfile } from '../web/src/playerProfile.js';

function endSession(p, stats) {
    p.startSession?.();
    p.recordSessionEnd(stats);
}

describe('PlayerProfile θ⃗ 标定器', () => {
    it('冷启动 getLatentCalibration() = null（恒等退化）', () => {
        const p = new PlayerProfile(15);
        expect(p.getLatentCalibration()).toBeNull();
    });

    it('累计足够会话后置信度跨过阈值 → 标定向量非空', () => {
        const p = new PlayerProfile(15);
        for (let i = 0; i < 15; i++) {
            p.recordSessionEnd({ score: 1000, placements: 100, clears: 30, misses: 5, maxCombo: 4,
                abilityVector: { skillScore: 0.7, controlScore: 0.7, clearEfficiency: 0.6, boardPlanning: 0.75, riskLevel: 0.25 } });
        }
        const snap = p.getLatentAbilitySnapshot();
        expect(snap.n).toBe(15);
        expect(snap.confidence).toBeGreaterThan(0.45);
        const cal = p.getLatentCalibration();
        expect(cal).not.toBeNull();
        expect(Object.keys(cal).sort()).toEqual(['clearEff', 'combo', 'order', 'recovery', 'spatial', 'tempo']);
    });

    it('θ⃗ 后验 toJSON/fromJSON 往返保真', () => {
        const p = new PlayerProfile(15);
        for (let i = 0; i < 8; i++) {
            p.recordSessionEnd({ score: 800, placements: 90, clears: 25, misses: 8, maxCombo: 3,
                abilityVector: { skillScore: 0.6, controlScore: 0.55, clearEfficiency: 0.5, boardPlanning: 0.65, riskLevel: 0.3 } });
        }
        const json = JSON.parse(JSON.stringify(p.toJSON()));
        expect(json.latentAbility).toBeTruthy();
        expect(json.latentAbility.n).toBe(8);
        const restored = PlayerProfile.fromJSON(json);
        const s1 = p.getLatentAbilitySnapshot();
        const s2 = restored.getLatentAbilitySnapshot();
        expect(s2.n).toBe(s1.n);
        for (const d of Object.keys(s1.mu)) expect(s2.mu[d]).toBeCloseTo(s1.mu[d], 9);
    });

    it('无 abilityVector 时用会话级粗代理也能累计 θ⃗', () => {
        const p = new PlayerProfile(15);
        for (let i = 0; i < 14; i++) {
            p.recordSessionEnd({ score: 500, placements: 80, clears: 20, misses: 6, maxCombo: 2 });
        }
        expect(p.getLatentAbilitySnapshot().n).toBe(14);
        expect(p.getLatentCalibration()).not.toBeNull();
    });
});
