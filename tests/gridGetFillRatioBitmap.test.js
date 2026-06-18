/**
 * FF3: Grid.getFillRatio bitmap 快慢路径等价 + 行为契约。
 * dynamicLeafCap 入口每帧调用，必须 100% 与旧版本一致。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

describe('FF3 getFillRatio 行为契约', () => {
    it('空盘 → 0', () => {
        expect(new Grid(8).getFillRatio()).toBe(0);
    });

    it('满盘 → 1', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 1;
        expect(g.getFillRatio()).toBe(1);
    });

    it('半满 → 0.5', () => {
        const g = new Grid(8);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 1;
        expect(g.getFillRatio()).toBe(0.5);
    });

    it('单点 → 1/64', () => {
        const g = new Grid(8);
        g.cells[3][5] = 1;
        expect(g.getFillRatio()).toBe(1 / 64);
    });
});

describe('FF3 快慢路径等价 200 随机盘', () => {
    function randGrid(seed, n, prob = 0.5) {
        const g = new Grid(n);
        let s = seed;
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
            s = (s * 1664525 + 1013904223) >>> 0;
            if ((s & 0xff) / 256 < prob) g.cells[y][x] = 1;
        }
        return g;
    }

    it('fast === slow for 200 boards × {8,12}', () => {
        for (let seed = 1; seed <= 100; seed++) {
            for (const n of [8, 12]) {
                const g = randGrid(seed, n, 0.45);
                const fast = g.getFillRatio();
                const slow = g._getFillRatioSlow();
                if (fast !== slow) {
                    throw new Error(`mismatch seed=${seed} n=${n} fast=${fast} slow=${slow}`);
                }
            }
        }
    });
});

describe('FF3 边界', () => {
    it('n=31 走慢路径 fallback', () => {
        const g = new Grid(31);
        g.cells[0][0] = 1;
        expect(g.getFillRatio()).toBeCloseTo(1 / (31 * 31), 10);
    });

    it('零分母不会触发（n≥1 always）', () => {
        expect(Number.isFinite(new Grid(1).getFillRatio())).toBe(true);
    });
});
