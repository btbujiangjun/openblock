/**
 * miniGoals 连消计数：局内/局末须读 maxComboChain（时间维度），不能误用 maxCombo（单手多消）。
 */
import { describe, expect, it } from 'vitest';

/** 与 web/src/miniGoals.js `_measureProgress` combo 分支同口径 */
function comboProgressFromStats(gameStats) {
    return gameStats.maxComboChain ?? gameStats.combo ?? 0;
}

describe('miniGoals combo progress', () => {
    it('combo 目标读 maxComboChain，忽略 maxCombo（空间多消）', () => {
        expect(comboProgressFromStats({ maxCombo: 4, maxComboChain: 2 })).toBe(2);
        expect(comboProgressFromStats({ maxCombo: 4, maxComboChain: 5 })).toBe(5);
    });

    it('combo 目标不回退到 maxCombo', () => {
        expect(comboProgressFromStats({ maxCombo: 3 })).toBe(0);
    });
});
