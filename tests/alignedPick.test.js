/**
 * @vitest-environment jsdom
 *
 * bot/alignedPick.js 行为契约（v1.70 抽出自 blockSpawn）：
 *   - argmax/argmin 纯函数
 *   - 无 rng → 退回 argmax（确定性回放保证）
 *   - burstProb 命中 → argmin
 *   - temperature>0 → softmax 采样且尊重权重
 *   - 单元素/空数组兜底
 */
import { describe, it, expect } from 'vitest';
import { argmaxAlign, argminAlign, pickBestAligned } from '../web/src/bot/alignedPick.js';
import { createMulberry32 } from '../web/src/lib/seededRng.js';

describe('alignedPick', () => {
    const sample = [
        { id: 'a', align: 0.1 },
        { id: 'b', align: 0.9 },
        { id: 'c', align: 0.5 },
    ];

    it('argmaxAlign 取最大 align', () => {
        expect(argmaxAlign(sample).id).toBe('b');
    });

    it('argminAlign 取最小 align', () => {
        expect(argminAlign(sample).id).toBe('a');
    });

    it('无 rng → 退回 argmax（确定性）', () => {
        expect(pickBestAligned(sample).id).toBe('b');
        expect(pickBestAligned(sample, {}).id).toBe('b');
        expect(pickBestAligned(sample, { rng: null }).id).toBe('b');
    });

    it('burstProb=1 → 必然命中 argmin', () => {
        const rng = createMulberry32(1);
        const out = pickBestAligned(sample, { rng, burstProb: 1.0, temperature: 0.5 });
        expect(out.id).toBe('a');
    });

    it('burstProb=0 & temperature=0 → argmax', () => {
        const rng = createMulberry32(2);
        const out = pickBestAligned(sample, { rng, burstProb: 0, temperature: 0 });
        expect(out.id).toBe('b');
    });

    it('temperature>0 → softmax 倾向高 align（同 seed 可复现）', () => {
        const counts = { a: 0, b: 0, c: 0 };
        const rng = createMulberry32(0xDEAD);
        for (let i = 0; i < 500; i++) {
            const pick = pickBestAligned(sample, { rng, burstProb: 0, temperature: 0.3 });
            counts[pick.id]++;
        }
        // b（align=0.9）应占多数；a（0.1）最少
        expect(counts.b).toBeGreaterThan(counts.c);
        expect(counts.c).toBeGreaterThan(counts.a);
    });

    it('空/单元素兜底', () => {
        expect(pickBestAligned([])).toBeUndefined();
        const one = [{ id: 'only', align: 0 }];
        expect(pickBestAligned(one).id).toBe('only');
    });

    it('相同 seed 产出相同采样序列', () => {
        const rng1 = createMulberry32(42);
        const rng2 = createMulberry32(42);
        const seq1 = Array.from({ length: 20 }, () => pickBestAligned(sample, { rng: rng1, temperature: 0.5 }).id);
        const seq2 = Array.from({ length: 20 }, () => pickBestAligned(sample, { rng: rng2, temperature: 0.5 }).id);
        expect(seq1).toEqual(seq2);
    });
});
