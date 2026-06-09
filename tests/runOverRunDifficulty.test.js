/**
 * @vitest-environment jsdom
 *
 * PR2: runDifficulty humped 曲线 + lifecycleStressCapMap arc 调制 联合单测。
 * 覆盖：
 *   - humped 表查表（含越界裁剪）
 *   - linear 路径向后兼容（旧字段仍生效）
 *   - resolveLayeredStrategy 在 humped 负值场景下的 [0, 0.36] fillRatio 夹紧
 *   - resolveArcLifecycleModifier + getLifecycleStressCap 三参数 overload
 */
import { describe, it, expect } from 'vitest';
import {
    getRunDifficultyModifiers,
    resolveLayeredStrategy,
} from '../web/src/difficulty.js';
import {
    getLifecycleStressCap,
    resolveArcLifecycleModifier,
    LIFECYCLE_STRESS_CAP_MAP,
} from '../web/src/lifecycle/lifecycleStressCapMap.js';
import { GAME_RULES } from '../web/src/gameRules.js';

describe('runDifficulty humped 曲线', () => {
    it('生产配置已切到 humped', () => {
        const rd = GAME_RULES.runDifficulty;
        expect(rd.curve).toBe('humped');
        expect(rd.stressBonusByStreak).toEqual([0, 0.03, 0.05, 0.05, 0.02, -0.05, -0.10]);
        expect(rd.fillBonusByStreak).toEqual([0, 0.01, 0.02, 0.02, 0.01, -0.01, -0.03]);
    });

    it('runStreak=0 → 无修饰', () => {
        const m = getRunDifficultyModifiers(0);
        expect(m.stressBonus).toBe(0);
        expect(m.fillDelta).toBe(0);
        expect(m.curve).toBe('humped');
    });

    it('runStreak=2/3 达峰', () => {
        const m2 = getRunDifficultyModifiers(2);
        const m3 = getRunDifficultyModifiers(3);
        expect(m2.stressBonus).toBeGreaterThan(0);
        expect(m3.stressBonus).toBeGreaterThanOrEqual(m2.stressBonus);
    });

    it('runStreak=5 后转负（breather）', () => {
        const m5 = getRunDifficultyModifiers(5);
        const m6 = getRunDifficultyModifiers(6);
        expect(m5.stressBonus).toBeLessThan(0);
        expect(m6.stressBonus).toBeLessThanOrEqual(m5.stressBonus);
        expect(m5.fillDelta).toBeLessThan(0);
    });

    it('runStreak 越界（=99）裁剪到末档', () => {
        const m99 = getRunDifficultyModifiers(99);
        const mLast = getRunDifficultyModifiers(6);
        expect(m99.stressBonus).toBe(mLast.stressBonus);
        expect(m99.fillDelta).toBe(mLast.fillDelta);
    });

    it('humped 曲线整体应"先升后降"（单调性约束）', () => {
        const arr = [];
        for (let s = 0; s <= 6; s++) arr.push(getRunDifficultyModifiers(s).stressBonus);
        const peakIdx = arr.indexOf(Math.max(...arr));
        // 峰值应在 1..4 之间；之后单调非升
        expect(peakIdx).toBeGreaterThanOrEqual(1);
        expect(peakIdx).toBeLessThanOrEqual(4);
        for (let i = peakIdx + 1; i < arr.length; i++) {
            expect(arr[i]).toBeLessThanOrEqual(arr[i - 1] + 1e-9);
        }
    });
});

describe('resolveLayeredStrategy 在 humped 负值场景的 fillRatio 夹紧', () => {
    it('normal + runStreak=6 时 fillRatio ≥ 0', () => {
        const s = resolveLayeredStrategy('normal', 0, 6);
        expect(s.fillRatio).toBeGreaterThanOrEqual(0);
        expect(s.fillRatio).toBeLessThanOrEqual(0.36);
    });

    it('easy 模式（baseFill=0）即便 humped 负 fillDelta 也保持 0', () => {
        const s = resolveLayeredStrategy('easy', 0, 6);
        expect(s.fillRatio).toBe(0);
    });

    it('humped 第 5 局 fillRatio 比第 3 局更低（breather）', () => {
        const s3 = resolveLayeredStrategy('normal', 0, 3);
        const s5 = resolveLayeredStrategy('normal', 0, 5);
        const s6 = resolveLayeredStrategy('normal', 0, 6);
        expect(s5.fillRatio).toBeLessThan(s3.fillRatio);
        expect(s6.fillRatio).toBeLessThanOrEqual(s5.fillRatio);
    });
});

describe('resolveArcLifecycleModifier', () => {
    it('五档 arc 都能解析出有效 modifier', () => {
        const cfg = GAME_RULES.runOverRunArc;
        for (const arc of ['opener', 'momentum', 'peak', 'fatigue', 'cooldown']) {
            const mod = resolveArcLifecycleModifier(arc, cfg);
            expect(mod).not.toBeNull();
            expect(Number.isFinite(mod.capScale)).toBe(true);
            expect(Number.isFinite(mod.adjustDelta)).toBe(true);
        }
    });

    it('未知 arc / 空配置 → null（不调制）', () => {
        const cfg = GAME_RULES.runOverRunArc;
        expect(resolveArcLifecycleModifier('unknown', cfg)).toBeNull();
        expect(resolveArcLifecycleModifier(null, cfg)).toBeNull();
        expect(resolveArcLifecycleModifier('opener', null)).toBeNull();
        expect(resolveArcLifecycleModifier('opener', {})).toBeNull();
    });

    it('cooldown 的 capScale < fatigue < momentum/peak（保护强度单调）', () => {
        const cfg = GAME_RULES.runOverRunArc;
        const c = resolveArcLifecycleModifier('cooldown', cfg);
        const f = resolveArcLifecycleModifier('fatigue', cfg);
        const p = resolveArcLifecycleModifier('peak', cfg);
        expect(c.capScale).toBeLessThan(f.capScale);
        expect(f.capScale).toBeLessThan(p.capScale);
        expect(c.adjustDelta).toBeLessThan(f.adjustDelta);
        expect(f.adjustDelta).toBeLessThanOrEqual(p.adjustDelta);
    });
});

describe('getLifecycleStressCap 三参数 overload（arc modifier）', () => {
    it('无 arcModifier 时返回原 cap/adjust（向后兼容）', () => {
        const raw = LIFECYCLE_STRESS_CAP_MAP['S3·M3'];
        expect(getLifecycleStressCap('S3', 'M3')).toEqual(raw);
        expect(getLifecycleStressCap('S3', 'M3', null)).toEqual(raw);
    });

    it('cooldown modifier 把 S3·M3 cap 从 0.85 压到 ≤ 0.65', () => {
        const cfg = GAME_RULES.runOverRunArc;
        const arcMod = resolveArcLifecycleModifier('cooldown', cfg);
        const out = getLifecycleStressCap('S3', 'M3', arcMod);
        const raw = LIFECYCLE_STRESS_CAP_MAP['S3·M3'];
        expect(out.cap).toBeLessThan(raw.cap);
        // capScale=0.70 → 0.85·0.70 = 0.595
        expect(out.cap).toBeCloseTo(0.595, 3);
        // adjustDelta=-0.15 → 0.10-0.15 = -0.05
        expect(out.adjust).toBeCloseTo(-0.05, 3);
    });

    it('opener modifier 让 S0·M0（新人）cap 进一步收紧', () => {
        const cfg = GAME_RULES.runOverRunArc;
        const arcMod = resolveArcLifecycleModifier('opener', cfg);
        const out = getLifecycleStressCap('S0', 'M0', arcMod);
        const raw = LIFECYCLE_STRESS_CAP_MAP['S0·M0'];
        expect(out.cap).toBeLessThan(raw.cap);
        expect(out.adjust).toBeLessThan(raw.adjust);
    });

    it('momentum modifier（capScale=1, adjustDelta=0）→ 不调制', () => {
        const cfg = GAME_RULES.runOverRunArc;
        const arcMod = resolveArcLifecycleModifier('momentum', cfg);
        const out = getLifecycleStressCap('S2·M2'.split('·')[0], 'M2', arcMod);
        const raw = LIFECYCLE_STRESS_CAP_MAP['S2·M2'];
        expect(out).toEqual(raw);
    });

    it('非法 stage/band 返回 null（不会因 arc 而抛错）', () => {
        const cfg = GAME_RULES.runOverRunArc;
        const arcMod = resolveArcLifecycleModifier('cooldown', cfg);
        expect(getLifecycleStressCap('S9', 'M0', arcMod)).toBeNull();
        expect(getLifecycleStressCap('S0', 'MZ', arcMod)).toBeNull();
    });

    it('5×5×5 立方语义全覆盖（每格 cap ∈ [0,1], adjust ∈ [-0.3, 0.3]）', () => {
        const cfg = GAME_RULES.runOverRunArc;
        const stages = ['S0', 'S1', 'S2', 'S3', 'S4'];
        const bands = ['M0', 'M1', 'M2', 'M3', 'M4'];
        const arcs = ['opener', 'momentum', 'peak', 'fatigue', 'cooldown'];
        let count = 0;
        for (const s of stages) for (const b of bands) for (const a of arcs) {
            const out = getLifecycleStressCap(s, b, resolveArcLifecycleModifier(a, cfg));
            expect(out).not.toBeNull();
            expect(out.cap).toBeGreaterThanOrEqual(0);
            expect(out.cap).toBeLessThanOrEqual(1);
            expect(out.adjust).toBeGreaterThanOrEqual(-0.3);
            expect(out.adjust).toBeLessThanOrEqual(0.3);
            count++;
        }
        expect(count).toBe(125);
    });
});
