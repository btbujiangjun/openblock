import { describe, it, expect } from 'vitest';
import {
    computeArpdau,
    computeRoas,
    computeCohortLtvCurve,
    computePaybackDay,
    computeRetentionCurve,
    aggregateChannelRoi,
} from '../web/src/monetization/cohortAnalytics.js';

describe('cohortAnalytics — ARPDAU / ROAS', () => {
    it('ARPDAU = revenue/dau', () => {
        expect(computeArpdau({ revenue: 1000, dau: 2000 })).toBeCloseTo(0.5, 5);
        expect(computeArpdau({ revenue: 100, dau: 0 })).toBe(0);
    });
    it('ROAS = revenue/spend, 无花费返回 null', () => {
        expect(computeRoas({ revenue: 1200, spend: 1000 })).toBeCloseTo(1.2, 5);
        expect(computeRoas({ revenue: 100, spend: 0 })).toBeNull();
    });
});

describe('cohortAnalytics — cohort LTV curve & payback', () => {
    const events = [
        { dayIndex: 0, amount: 300 },
        { dayIndex: 1, amount: 200 },
        { dayIndex: 7, amount: 500 },
        { dayIndex: 90, amount: 100 },
        { dayIndex: 999, amount: 9999 }, // 越界忽略
    ];
    it('累计 ARPU 单调不减', () => {
        const curve = computeCohortLtvCurve(events, 100, 90);
        expect(curve.length).toBe(91);
        expect(curve[0]).toBeCloseTo(3, 5);   // 300/100
        expect(curve[1]).toBeCloseTo(5, 5);   // 500/100
        expect(curve[7]).toBeCloseTo(10, 5);  // 1000/100
        expect(curve[90]).toBeCloseTo(11, 5); // 1100/100
        for (let i = 1; i < curve.length; i++) {
            expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
        }
    });
    it('payback day = 累计 ARPU 首次 >= CPI', () => {
        const curve = computeCohortLtvCurve(events, 100, 90);
        expect(computePaybackDay(curve, 5)).toBe(1);
        expect(computePaybackDay(curve, 10)).toBe(7);
        expect(computePaybackDay(curve, 999)).toBeNull();
        expect(computePaybackDay(curve, 0)).toBe(0);
    });
    it('cohortSize=0 时曲线全 0', () => {
        const curve = computeCohortLtvCurve(events, 0, 10);
        expect(curve.every((v) => v === 0)).toBe(true);
    });
});

describe('cohortAnalytics — retention curve', () => {
    it('支持对象与数组两种输入', () => {
        const r1 = computeRetentionCurve({ 1: 600, 7: 300, 30: 100 }, 1000);
        expect(r1.D1).toBeCloseTo(0.6, 5);
        expect(r1.D7).toBeCloseTo(0.3, 5);
        expect(r1.D30).toBeCloseTo(0.1, 5);
        const r2 = computeRetentionCurve([{ dayIndex: 1, activeUsers: 500 }], 1000, [1]);
        expect(r2.D1).toBeCloseTo(0.5, 5);
    });
});

describe('cohortAnalytics — channel ROI aggregation (UA-5)', () => {
    it('按 key 聚合并按 ROAS 降序', () => {
        const out = aggregateChannelRoi([
            { key: 'applovin/creativeA', installs: 100, spend: 500, revenue: 800, retainedD1: 40 },
            { key: 'applovin/creativeA', installs: 100, spend: 500, revenue: 700, retainedD1: 35 },
            { key: 'unity/creativeB', installs: 50, spend: 400, revenue: 200, retainedD1: 10 },
        ]);
        expect(out).toHaveLength(2);
        expect(out[0].key).toBe('applovin/creativeA');
        expect(out[0].installs).toBe(200);
        expect(out[0].cpi).toBeCloseTo(5, 5);     // 1000/200
        expect(out[0].arpu).toBeCloseTo(7.5, 5);  // 1500/200
        expect(out[0].roas).toBeCloseTo(1.5, 5);  // 1500/1000
        expect(out[0].d1).toBeCloseTo(0.375, 5);  // 75/200
        expect(out[1].roas).toBeCloseTo(0.5, 5);  // 200/400
    });
});
