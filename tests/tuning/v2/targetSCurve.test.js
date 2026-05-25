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

    it('brake segment continuity (重缩放 logistic sigmoid)', () => {
        // v2.3: brake 段 [0.80, 1.05), 重缩放后端点严格 0/1
        // 端点对齐: r=0.80 → D=0.50, r=1.05 → D=0.92
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

    it('matches Python reference at key bins (v2.3, r_max=2.0)', () => {
        // v2.3: bin_width = 2.0/20 = 0.1
        // bin 0 中点 r=0.05: gentle 段 D = 0.20 + 0.2*0.05 = 0.21
        // bin 5 中点 r=0.55: mid 段 slope=1.0 → D = 0.30 + 1.0*0.05 = 0.35
        // bin 19 (last) 中点 r=1.95: overshoot 段, 应 > 0.999
        const v = targetCurveVector();
        expect(v[0]).toBeCloseTo(0.21, 4);
        expect(v[5]).toBeCloseTo(0.35, 3);
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
        expect(m.version).toBe('v2.3.0');
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
