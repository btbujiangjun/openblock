/**
 * JS 端 targetSCurve.test.js — 与 Python 端测试 1:1 对应。
 *
 * 跨语言一致性测试: 关键点上 JS 与 Python 输出必须严格相等。
 */
import { describe, it, expect } from 'vitest';
import {
    targetSCurve, targetCurveVector, rToBin,
    isMonotonicNonDecreasing, getTargetMetadata,
    targetSCurveByArc, getArcModifier, ARC_MODIFIERS,
    CURVE_N_BINS, CURVE_R_MAX,
    SEG_GENTLE_END, SEG_MID_END, SEG_BRAKE_END,
    D_BASE, D_GENTLE_END, D_MID_END, D_BRAKE_END, D_CAP,
    targetECurve, targetFCurve, targetEVector, targetFVector,
    E_BASE, E_PEAK, F_BASE, F_CAP,
} from '../../../web/src/tuning/v2/targetSCurve.js';

describe('targetSCurve', () => {
    it('origin returns D_BASE', () => {
        expect(targetSCurve(0)).toBeCloseTo(D_BASE, 9);
    });

    it('segment boundaries 1 and 2 match design', () => {
        expect(targetSCurve(SEG_GENTLE_END)).toBeCloseTo(D_GENTLE_END, 9);
        expect(targetSCurve(SEG_MID_END)).toBeCloseTo(D_MID_END, 9);
    });

    it('brake segment continuity (重缩放 logistic sigmoid)', () => {
        // v2.6: brake 段 [0.65, 1.15), 重缩放后端点严格 0/1
        // 端点对齐: r=0.65 → D=0.18, r=1.15 → D=0.98
        const eps = 1e-6;
        expect(targetSCurve(SEG_MID_END)).toBeCloseTo(D_MID_END, 6);
        expect(targetSCurve(SEG_BRAKE_END - eps)).toBeCloseTo(D_BRAKE_END, 3);
        expect(targetSCurve(SEG_BRAKE_END + eps)).toBeCloseTo(D_BRAKE_END, 3);
        // 中点 t=0.5 → s 严格 = 0.5, D = D_MID_END + 0.5 * (D_BRAKE_END - D_MID_END)
        const midR = (SEG_MID_END + SEG_BRAKE_END) / 2;
        expect(targetSCurve(midR)).toBeCloseTo((D_MID_END + D_BRAKE_END) / 2, 3);
    });

    it('non-decreasing throughout [0, CURVE_R_MAX]', () => {
        const n = Math.round(CURVE_R_MAX * 100) + 1;
        const rs = Array.from({ length: n }, (_, i) => i / 100);
        const ds = rs.map(targetSCurve);
        expect(isMonotonicNonDecreasing(ds, 1e-4)).toBe(true);
    });

    it('clips at r > rMax', () => {
        expect(targetSCurve(CURVE_R_MAX + 1)).toBe(targetSCurve(CURVE_R_MAX));
    });

    it('clips negative r to 0', () => {
        expect(targetSCurve(-1.0)).toBe(targetSCurve(0));
    });

    it('v2.3 overshoot 段 r=1.5 时 D > 0.99', () => {
        expect(targetSCurve(1.5)).toBeGreaterThan(0.99);
        // r=r_max 时基本到 D_CAP
        expect(targetSCurve(CURVE_R_MAX)).toBeGreaterThan(0.999);
        expect(targetSCurve(CURVE_R_MAX)).toBeLessThan(D_CAP + 1e-9);
    });
});

describe('targetCurveVector', () => {
    it('default length is 20', () => {
        expect(targetCurveVector()).toHaveLength(CURVE_N_BINS);
    });

    it('custom length', () => {
        expect(targetCurveVector(10)).toHaveLength(10);
    });

    it('invalid nBins throws', () => {
        expect(() => targetCurveVector(0)).toThrow();
        expect(() => targetCurveVector(-3)).toThrow();
    });

    it('monotonic', () => {
        expect(isMonotonicNonDecreasing(targetCurveVector(), 1e-4)).toBe(true);
    });

    it('matches Python reference at key bins (v2.6, r_max=2.0)', () => {
        // v2.6: bin_width = 2.0/20 = 0.1
        // bin 0 中点 r=0.05: low plateau D ≈ 0.1011
        // bin 5 中点 r=0.55: gentle lift D ≈ 0.145
        // bin 19 (last) 中点 r=1.95: overshoot 段, 应 > 0.999
        const v = targetCurveVector();
        expect(v[0]).toBeCloseTo(0.1011, 4);
        expect(v[5]).toBeCloseTo(0.145, 4);
        expect(targetSCurve(1.0)).toBeCloseTo(0.896, 3);
        expect(v[19]).toBeGreaterThan(0.999);
    });
});

describe('rToBin', () => {
    it('zero returns 0', () => {
        expect(rToBin(0)).toBe(0);
    });

    it('rMax clips to last bin', () => {
        expect(rToBin(CURVE_R_MAX)).toBe(CURVE_N_BINS - 1);
        expect(rToBin(99)).toBe(CURVE_N_BINS - 1);
    });

    it('mid value matches formula (v2.3 r_max=2.0)', () => {
        // r=1.0, n=20, rMax=2.0 → width=0.1 → 1.0/0.1=10
        expect(rToBin(1.0)).toBe(10);
        // r=0.5 → idx=5
        expect(rToBin(0.5)).toBe(5);
    });

    it('negative clipped to 0', () => {
        expect(rToBin(-1)).toBe(0);
    });
});

describe('getTargetMetadata', () => {
    it('has expected structure', () => {
        const m = getTargetMetadata();
        expect(m.version).toBe('v2.6.0');
        expect(m.n_bins).toBe(20);
        expect(m.r_max).toBe(2.0);
        expect(m.segments).toHaveLength(4);
    });

    it('segments cover [0, rMax] contiguously', () => {
        const m = getTargetMetadata();
        let prev = 0;
        for (const seg of m.segments) {
            expect(seg.r_range[0]).toBeCloseTo(prev, 9);
            prev = seg.r_range[1];
        }
        expect(prev).toBeCloseTo(CURVE_R_MAX, 9);
    });
});

// ─────────── v1.68 PR3：arc-aware 形变曲线 ───────────
describe('targetSCurveByArc（局间难度弧线形变）', () => {
    it('五档常量与文档锚点一致', () => {
        expect(Object.keys(ARC_MODIFIERS).sort()).toEqual(
            ['cooldown', 'fatigue', 'momentum', 'opener', 'peak'].sort(),
        );
        expect(ARC_MODIFIERS.opener.dScale).toBeCloseTo(0.90, 6);
        expect(ARC_MODIFIERS.fatigue.brakeShift).toBeCloseTo(0.15, 6);
        expect(ARC_MODIFIERS.cooldown.dShift).toBeCloseTo(-0.05, 6);
    });

    it('momentum / peak / null → 与基线 targetSCurve 恒等', () => {
        for (let r = 0; r <= CURVE_R_MAX; r += 0.07) {
            expect(targetSCurveByArc(r, 'momentum')).toBeCloseTo(targetSCurve(r), 9);
            expect(targetSCurveByArc(r, 'peak')).toBeCloseTo(targetSCurve(r), 9);
            expect(targetSCurveByArc(r, null)).toBeCloseTo(targetSCurve(r), 9);
            expect(targetSCurveByArc(r, 'unknown_arc')).toBeCloseTo(targetSCurve(r), 9);
        }
    });

    it('opener 在所有 r 上 ≤ 基线（封顶 ~0.9）', () => {
        for (let r = 0.1; r <= CURVE_R_MAX; r += 0.1) {
            const base = targetSCurve(r);
            const o = targetSCurveByArc(r, 'opener');
            expect(o).toBeLessThanOrEqual(base + 1e-9);
        }
        // 顶部封顶接近 0.9
        expect(targetSCurveByArc(CURVE_R_MAX, 'opener')).toBeLessThanOrEqual(0.9 + 1e-9);
    });

    it('fatigue / cooldown 严格压低基线，且 cooldown ≤ fatigue ≤ 基线', () => {
        for (let r = 0.3; r <= 1.5; r += 0.1) {
            const base = targetSCurve(r);
            const f = targetSCurveByArc(r, 'fatigue');
            const c = targetSCurveByArc(r, 'cooldown');
            expect(f).toBeLessThanOrEqual(base + 1e-9);
            expect(c).toBeLessThanOrEqual(f + 1e-9);
        }
    });

    it('fatigue/cooldown 的 brakeShift 让"接近 PB 才陡升"', () => {
        // r=0.85 时基线已进入 brake 段（≈ 0.6+），fatigue 应仍在 mid 段（≤0.3）
        const baseAtPB = targetSCurve(0.85);
        const fatigueAtPB = targetSCurveByArc(0.85, 'fatigue');
        expect(fatigueAtPB).toBeLessThan(baseAtPB * 0.6);
        // r=1.3（已在右移后的 brake 段）fatigue 应明显上升超过 0.6
        expect(targetSCurveByArc(1.3, 'fatigue')).toBeGreaterThan(0.6);
    });

    it('所有 arc 的输出仍 ∈ [0, D_CAP]', () => {
        for (const arc of Object.keys(ARC_MODIFIERS)) {
            for (let r = -0.5; r <= CURVE_R_MAX + 0.5; r += 0.05) {
                const v = targetSCurveByArc(r, arc);
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(D_CAP + 1e-9);
            }
        }
    });

    it('所有 arc 的曲线单调非降', () => {
        for (const arc of Object.keys(ARC_MODIFIERS)) {
            const n = Math.round(CURVE_R_MAX * 100) + 1;
            const ds = Array.from({ length: n }, (_, i) => targetSCurveByArc(i / 100, arc));
            expect(isMonotonicNonDecreasing(ds, 1e-4)).toBe(true);
        }
    });

    it('getArcModifier 兜底未知 arc / null', () => {
        const id = getArcModifier(null);
        expect(id.dScale).toBe(1);
        expect(id.dShift).toBe(0);
        expect(id.brakeShift).toBe(0);
    });
});

// ─────────── v3.2 多曲线: 爽感 E(r) / 挫败 F(r) (与 Python target_curve.py 1:1) ───────────

describe('targetECurve (爽感)', () => {
    it('PB 处 (r=1) 达到峰值 E_PEAK', () => {
        expect(targetECurve(1.0)).toBeCloseTo(E_PEAK, 9);
    });
    it('远离 PB 趋向基线 E_BASE', () => {
        expect(targetECurve(0)).toBeGreaterThanOrEqual(E_BASE - 1e-9);
        expect(targetECurve(0)).toBeLessThan(E_PEAK);
        // r 远大于 PB 时回落接近基线
        expect(targetECurve(2.0)).toBeLessThan(targetECurve(1.0));
    });
    it('全程 ∈ [E_BASE, E_PEAK]', () => {
        for (let r = 0; r <= CURVE_R_MAX; r += 0.05) {
            const v = targetECurve(r);
            expect(v).toBeGreaterThanOrEqual(E_BASE - 1e-9);
            expect(v).toBeLessThanOrEqual(E_PEAK + 1e-9);
        }
    });
    it('targetEVector 长度 20 且每项有界', () => {
        const vec = targetEVector();
        expect(vec).toHaveLength(CURVE_N_BINS);
        for (const v of vec) {
            expect(v).toBeGreaterThanOrEqual(E_BASE - 1e-9);
            expect(v).toBeLessThanOrEqual(E_PEAK + 1e-9);
        }
    });
});

describe('targetFCurve (挫败)', () => {
    it('r=0 等于基线 F_BASE', () => {
        expect(targetFCurve(0)).toBeCloseTo(F_BASE, 9);
    });
    it('单调非降 + 永不超过硬上限 F_CAP', () => {
        let prev = -1;
        for (let r = 0; r <= CURVE_R_MAX; r += 0.05) {
            const v = targetFCurve(r);
            expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
            expect(v).toBeLessThanOrEqual(F_CAP + 1e-9);
            prev = v;
        }
    });
    it('高超 PB 段逼近 cap', () => {
        expect(targetFCurve(2.0)).toBeCloseTo(F_CAP, 6);
    });
    it('targetFVector 长度 20 且每项 ≤ F_CAP', () => {
        const vec = targetFVector();
        expect(vec).toHaveLength(CURVE_N_BINS);
        for (const v of vec) expect(v).toBeLessThanOrEqual(F_CAP + 1e-9);
    });
});
