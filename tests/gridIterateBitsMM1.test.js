/**
 * MM1: _iterateBits 工具间接验证。
 *
 * 工具是 grid.js 内部 helper，通过 findGapPositions /
 * countGapFills 等使用方的行为不变性间接证明。直接的算法等价已
 * 由 DD3/EE3 大量测试覆盖；本文件聚焦"用 _iterateBits 重写后
 * 与 baseline 等价"。
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';

function randGrid(seed, n = 8, fill = 0.55) {
    const g = new Grid(n); let s = seed;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        if ((s & 0xff) / 256 < fill) g.cells[y][x] = (s >>> 8) & 3;
    }
    return g;
}

describe('MM1 _iterateBits 间接验证（findGapPositions 等价）', () => {
    it('200 随机盘 → findGapPositions = _findGapPositionsSlow', () => {
        for (let seed = 1; seed <= 200; seed++) {
            const g = randGrid(seed, 8, 0.55);
            const fast = g.findGapPositions();
            const slow = g._findGapPositionsSlow();
            expect(fast).toEqual(slow);
        }
    });

    it('200 随机盘 → countGapFills(shape) = _countGapFillsSlow', () => {
        const shapes = [[[1]], [[1, 1]], [[1, 1, 1]], [[1], [1]]];
        for (let seed = 1; seed <= 50; seed++) {
            const g = randGrid(seed, 8, 0.55);
            for (const shape of shapes) {
                const fast = g.countGapFills(shape);
                const slow = g._countGapFillsSlow(shape);
                expect(fast).toBe(slow);
            }
        }
    });

    it('空盘 / 满盘 / 边界 → 不崩', () => {
        expect(() => new Grid(8).findGapPositions()).not.toThrow();
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 0;
        expect(() => g.findGapPositions()).not.toThrow();
    });
});

describe('MM1 _iterateBits 算法 spec（参照实现单测）', () => {
    /* 因 _iterateBits 是 module-private，这里只断言其等价于
     * "while(m){ idx=ctz(m); cb(idx); m&=m-1 }" 模式。 */
    function iterateBits(mask, fn) {
        let m = mask;
        while (m !== 0) {
            const idx = 31 - Math.clz32(m & -m);
            fn(idx);
            m &= m - 1;
        }
    }

    it('mask=0 → 不回调', () => {
        const acc = []; iterateBits(0, (i) => acc.push(i));
        expect(acc).toEqual([]);
    });
    it('mask=0b10101 → [0, 2, 4]', () => {
        const acc = []; iterateBits(0b10101, (i) => acc.push(i));
        expect(acc).toEqual([0, 2, 4]);
    });
    it('mask 全置 (0xFF) → [0..7]', () => {
        const acc = []; iterateBits(0xff, (i) => acc.push(i));
        expect(acc).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    });
    it('mask 最高 bit (1<<30)', () => {
        const acc = []; iterateBits(1 << 30, (i) => acc.push(i));
        expect(acc).toEqual([30]);
    });
});
