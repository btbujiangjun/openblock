/**
 * JS 端 targetSCurve.test.js — 与 Python 端测试 1:1 对应。
 *
 * 跨语言一致性测试: 关键点上 JS 与 Python 输出必须严格相等。
 */
import { describe, it, expect } from 'vitest';
import {
    targetSCurve, targetCurveVector, rToBin,
    isMonotonicNonDecreasing, getTargetMetadata,
    CURVE_N_BINS, CURVE_R_MAX,
    SEG_GENTLE_END, SEG_MID_END, SEG_BRAKE_END,
    D_BASE, D_GENTLE_END, D_MID_END, D_BRAKE_END, D_CAP,
} from '../../../web/src/tuning/v2/targetSCurve.js';

describe('targetSCurve', () => {
    it('origin returns D_BASE', () => {
        expect(targetSCurve(0)).toBeCloseTo(D_BASE, 9);
    });

    it('segment boundaries 1 and 2 match design', () => {
        expect(targetSCurve(SEG_GENTLE_END)).toBeCloseTo(D_GENTLE_END, 9);
        expect(targetSCurve(SEG_MID_END)).toBeCloseTo(D_MID_END, 9);
    });

    it('brake segment continuity (smoothstep)', () => {
        // r=0.95: D=D_MID_END=0.5 (smoothstep t=0)
        // r=1.0: D=D_BRAKE_END=0.9 (smoothstep t=1)
        // r=0.975: D=0.7 (中点 t=0.5)
        expect(targetSCurve(0.975)).toBeCloseTo((D_MID_END + D_BRAKE_END) / 2, 6);
    });

    it('non-decreasing throughout [0, 1.5]', () => {
        const rs = Array.from({ length: 151 }, (_, i) => i / 100);
        const ds = rs.map(targetSCurve);
        expect(isMonotonicNonDecreasing(ds, 1e-4)).toBe(true);
    });

    it('clips at r > rMax', () => {
        expect(targetSCurve(2.0)).toBe(targetSCurve(CURVE_R_MAX));
    });

    it('clips negative r to 0', () => {
        expect(targetSCurve(-1.0)).toBe(targetSCurve(0));
    });

    it('overshoot segment approaches D_CAP', () => {
        expect(targetSCurve(CURVE_R_MAX)).toBeLessThan(D_CAP + 1e-9);
        expect(targetSCurve(CURVE_R_MAX)).toBeGreaterThan(D_BRAKE_END);
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

    it('matches Python reference at key bins', () => {
        // 段 1 公式: D = D_BASE + slope * r, slope = (0.3-0.2)/0.5 = 0.2
        // bin 0 中点 r=0.0375: D = 0.2 + 0.2 * 0.0375 = 0.2075
        // bin 5 中点 r=0.4125: D = 0.2 + 0.2 * 0.4125 = 0.2825
        // bin 7 中点 r=0.5625: 进入段 2, slope = (0.5-0.3)/(0.95-0.5) = 0.4444
        //   D = 0.3 + 0.4444 * (0.5625-0.5) = 0.3 + 0.0278 = 0.3278
        const v = targetCurveVector();
        expect(v[0]).toBeCloseTo(0.2075, 4);
        expect(v[5]).toBeCloseTo(0.2825, 4);
        expect(v[7]).toBeCloseTo(0.3278, 3);
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

    it('mid value matches formula', () => {
        // r=0.75, n=20, rMax=1.5 → width=0.075 → 0.75/0.075=10
        expect(rToBin(0.75)).toBe(10);
    });

    it('negative clipped to 0', () => {
        expect(rToBin(-1)).toBe(0);
    });
});

describe('getTargetMetadata', () => {
    it('has expected structure', () => {
        const m = getTargetMetadata();
        expect(m.version).toBe('v2.0.0');
        expect(m.n_bins).toBe(20);
        expect(m.r_max).toBe(1.5);
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
