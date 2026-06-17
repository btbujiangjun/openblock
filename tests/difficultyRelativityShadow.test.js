/**
 * @vitest-environment jsdom
 *
 * §4.17/§2.10 难度相对论：resolveAdaptiveStrategy 影子反解 b* 验证。
 * 关键：enabled=false ⇒ bypass=disabled、b*=null、stress 主线不变（行为=现状）；
 *       默认已全量开启（enabled=true/rollout=100），低置信/warmup 仍恒等退化。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone, normalizeStress } from '../web/src/adaptiveSpawn.js';
import { GAME_RULES } from '../web/src/gameRules.js';
import { PlayerProfile } from '../web/src/playerProfile.js';

function makeProfile() { return new PlayerProfile(15); }

const CAL = { spatial: 0.8, combo: 0.7, order: 0.6, recovery: 0.3, tempo: 0.55, clearEff: 0.65 };

describe('难度相对论影子层（resolveAdaptiveStrategy）', () => {
    let dr;
    beforeEach(() => {
        resetAdaptiveMilestone();
        dr = GAME_RULES.adaptiveSpawn.difficultyRelativity;
    });
    afterEach(() => {
        // 恢复 game_rules.json 的理想态默认值（全量开启）。
        dr.enabled = true;
        dr.rolloutPercent = 100;
        dr.personalizationStrength = 0.3;
    });

    it('enabled=false ⇒ bypass=disabled，b*=null，对外 λ=0', () => {
        dr.enabled = false; dr.rolloutPercent = 0;
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 120, 1, 0.4, { latentCalibration: CAL });
        expect(s._relativityBypass).toBe('disabled');
        expect(s._objectiveTarget).toBeNull();
        expect(s._stressBreakdown.objectiveTarget).toBeNull();
        /* 信号字典 dr_lambda 口径：bypass/disabled 时对外有效 λ 归零（即便配置 personalizationStrength>0）。 */
        expect(s._relativityLambda).toBe(0);
        expect(s._stressBreakdown.relativityLambda).toBe(0);
    });

    it('默认已全量开启（enabled=true/rollout=100）', () => {
        // game_rules.json 默认值：理想态全量开启，不灰度。
        expect(GAME_RULES.adaptiveSpawn.difficultyRelativity.enabled).toBe(true);
        expect(GAME_RULES.adaptiveSpawn.difficultyRelativity.rolloutPercent).toBe(100);
    });

    it('开启但无 θ⃗ 标定 ⇒ low_conf bypass，b*=null', () => {
        dr.enabled = true; dr.rolloutPercent = 100;
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 120, 1, 0.4, { latentCalibration: null, totalRounds: 30 });
        expect(s._relativityBypass).toBe('low_conf');
        expect(s._objectiveTarget).toBeNull();
    });

    it('开启 + 有 θ⃗ ⇒ 产出 6 维 b*，stress 主线与关时完全一致', () => {
        const ctx = { latentCalibration: CAL, userId: 'expert-1', totalRounds: 30 };
        // 基线：关
        dr.enabled = false;
        const off = resolveAdaptiveStrategy('normal', makeProfile(), 120, 1, 0.4, { ...ctx });
        // 开
        dr.enabled = true; dr.rolloutPercent = 100; dr.personalizationStrength = 0.5;
        const on = resolveAdaptiveStrategy('normal', makeProfile(), 120, 1, 0.4, { ...ctx });

        expect(on._relativityBypass).toBeNull();
        expect(on._objectiveTarget).not.toBeNull();
        expect(Object.keys(on._objectiveTarget).sort())
            .toEqual(['clearEff', 'combo', 'order', 'recovery', 'spatial', 'tempo']);
        // S 曲线主线不被相对论改写：finalStress 开/关相同
        expect(on._stressBreakdown.finalStress).toBeCloseTo(off._stressBreakdown.finalStress, 9);
        // 高能力维 spatial(θ=0.8) 客观目标应高于弱项 recovery(θ=0.3)
        expect(on._objectiveTarget.spatial).toBeGreaterThan(on._objectiveTarget.recovery);
        // 未 bypass 时对外有效 λ = personalizationStrength（与信号字典 dr_lambda 一致）。
        expect(on._relativityLambda).toBeCloseTo(0.5, 9);
    });

    it('relativityDStar == normalizeStress(finalStress)（d* 来自 S 曲线主线）', () => {
        dr.enabled = true; dr.rolloutPercent = 100;
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 120, 1, 0.4, { latentCalibration: CAL, totalRounds: 30 });
        expect(s._stressBreakdown.relativityDStar).toBeCloseTo(normalizeStress(s._stressBreakdown.finalStress), 9);
    });
});
