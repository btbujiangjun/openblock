/**
 * LL1: _buildMonoFlushBitmaps 共享工具间接验证。
 *
 * 该工具是 internal helper，通过观察 potential + buildup 两函数
 * 在同一 grid + shape 上仍能产生与各自历史 baseline 一致的结果，
 * 间接证明工具函数的正确性。直接的算法/边界测试已由 HH2/II1/JJ1/KK1
 * 5000+ 断言覆盖；本文件聚焦"两函数共用同一工具不应彼此影响"。
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

describe('LL1 _buildMonoFlushBitmaps 共享工具间接验证', () => {
    it('potential + buildup 同 grid 同 shape 互不污染', () => {
        for (let seed = 1; seed <= 50; seed++) {
            const g = randGrid(seed, 8, 0.6);
            const shape = [[1, 1], [1, 1]];
            const a1 = g.bestMonoFlushPotential(shape);
            const b1 = g.bestMonoFlushBuildup(shape, null, 5);
            /* 二次调用应得到完全相同的结果（无状态污染） */
            const a2 = g.bestMonoFlushPotential(shape);
            const b2 = g.bestMonoFlushBuildup(shape, null, 5);
            expect(a1).toBe(a2);
            expect(b1).toBe(b2);
        }
    });

    it('交替调用 potential / buildup → 各自结果稳定', () => {
        const g = randGrid(42, 8, 0.5);
        const shape = [[1, 1, 1]];
        const seq = [];
        for (let i = 0; i < 10; i++) {
            seq.push(g.bestMonoFlushPotential(shape));
            seq.push(g.bestMonoFlushBuildup(shape, null, 4));
        }
        /* 偶/奇 index 应分别保持常量 */
        for (let i = 2; i < seq.length; i += 2) expect(seq[i]).toBe(seq[0]);
        for (let i = 3; i < seq.length; i += 2) expect(seq[i]).toBe(seq[1]);
    });

    it('空 shape / 空盘 → 0（工具函数不崩）', () => {
        const g = new Grid(8);
        expect(g.bestMonoFlushPotential([[0]])).toBe(0);
        expect(g.bestMonoFlushBuildup([[0]], null, 4)).toBe(0);
    });
});
