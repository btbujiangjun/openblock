import { describe, it, expect } from 'vitest';
import {
    FTUE_STEPS,
    computeFunnelRates,
    findBiggestDropoff,
} from '../web/src/retention/ftueFunnel.js';

describe('RT-2 FTUE 漏斗纯函数', () => {
    const counts = {
        app_open: 1000,
        game_start: 900,
        first_clear: 600,
        first_game_end: 550,
        d1_return: 220,
    };

    it('逐级转化与从顶比例正确', () => {
        const rates = computeFunnelRates(counts);
        expect(rates).toHaveLength(FTUE_STEPS.length);
        expect(rates[0].conversionFromPrev).toBe(1);
        expect(rates[0].rateFromTop).toBe(1);
        expect(rates[1].conversionFromPrev).toBeCloseTo(0.9, 5);
        expect(rates[2].conversionFromPrev).toBeCloseTo(0.6667, 3); // 600/900
        expect(rates[4].rateFromTop).toBeCloseTo(0.22, 5);
    });

    it('流失率 = 1 - 转化率', () => {
        const rates = computeFunnelRates(counts);
        expect(rates[1].dropFromPrev).toBeCloseTo(0.1, 5);
        expect(rates[2].dropFromPrev).toBeCloseTo(0.3333, 3);
    });

    it('定位最大流失断点', () => {
        const worst = findBiggestDropoff(counts);
        // game_start→first_clear 流失 0.333；first_game_end→d1_return 流失 0.6 最大
        expect(worst.step).toBe('d1_return');
    });

    it('顶层为 0 时不除零', () => {
        const rates = computeFunnelRates({});
        expect(rates.every((r) => r.rateFromTop === 0 || r.step === 'app_open')).toBe(true);
        expect(rates[0].count).toBe(0);
    });
});
