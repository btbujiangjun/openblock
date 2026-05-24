/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
    latinHypercube,
    lhsThetas,
    buildPhaseATasks,
} from '../../web/src/tuning/lhsSampler.js';
import * as paramSpace from '../../web/src/tuning/paramSpace.js';
import { enumerateAllContexts } from '../../web/src/tuning/contextSpace.js';

describe('lhsSampler — latinHypercube', () => {
    it('生成正确的尺寸', () => {
        const s = latinHypercube(10, 5);
        expect(s).toHaveLength(10);
        for (const row of s) {
            expect(row).toHaveLength(5);
        }
    });

    it('所有值在 [0, 1] 内', () => {
        const s = latinHypercube(20, 14);
        for (const row of s) {
            for (const v of row) {
                expect(v).toBeGreaterThanOrEqual(0);
                expect(v).toBeLessThanOrEqual(1);
            }
        }
    });

    it('每维度都覆盖 n 个 bins (这是 LHS 的核心保证)', () => {
        const n = 50;
        const dim = 4;
        const s = latinHypercube(n, dim);
        // 对每个维度,统计 n 个样本落在 [k/n, (k+1)/n) 哪个 bin
        for (let d = 0; d < dim; d++) {
            const bins = new Set();
            for (const row of s) {
                const bin = Math.floor(row[d] * n);
                bins.add(Math.min(bin, n - 1));
            }
            // LHS 保证: n 个样本恰好分布在 n 个不同的 bin 里
            expect(bins.size).toBe(n);
        }
    });

    it('固定 seed → 可复现', () => {
        const a = latinHypercube(20, 5, { seed: 42 });
        const b = latinHypercube(20, 5, { seed: 42 });
        expect(a).toEqual(b);
    });

    it('不同 seed → 不同样本', () => {
        const a = latinHypercube(20, 5, { seed: 1 });
        const b = latinHypercube(20, 5, { seed: 2 });
        // 至少有几个样本不同 (理论上完全相同的概率极低)
        let differingRows = 0;
        for (let i = 0; i < a.length; i++) {
            if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) differingRows++;
        }
        expect(differingRows).toBeGreaterThan(0);
    });

    it('center=true → 用区间中点 (确定性)', () => {
        const a = latinHypercube(10, 3, { seed: 42, center: true });
        const b = latinHypercube(10, 3, { seed: 42, center: true });
        expect(a).toEqual(b);
        // 中点 = (k + 0.5) / n,所以每个值应该形如 (整数 + 0.5) / 10
        for (const row of a) {
            for (const v of row) {
                const k = v * 10 - 0.5;
                expect(k).toBeCloseTo(Math.round(k), 5);
            }
        }
    });

    it('拒绝非法参数', () => {
        expect(() => latinHypercube(0, 5)).toThrow();
        expect(() => latinHypercube(5, 0)).toThrow();
        expect(() => latinHypercube(-1, 5)).toThrow();
        expect(() => latinHypercube(NaN, 5)).toThrow();
    });
});

describe('lhsSampler — lhsThetas', () => {
    it('返回 n 个合法 theta', () => {
        const thetas = lhsThetas(30, paramSpace, { seed: 7 });
        expect(thetas).toHaveLength(30);
        for (const theta of thetas) {
            const r = paramSpace.validateTheta(theta);
            if (!r.ok) console.error('invalid theta:', theta, r.errors);
            expect(r.ok).toBe(true);
        }
    });

    it('LHS 性质保留: 每维度均匀覆盖', () => {
        const n = 50;
        const thetas = lhsThetas(n, paramSpace, { seed: 7 });
        // 检验 personalizationStrength (float) 覆盖均匀
        const values = thetas.map((t) => t.personalizationStrength);
        const min = Math.min(...values);
        const max = Math.max(...values);
        expect(min).toBeLessThan(0.07);  // 接近 low=0.05
        expect(max).toBeGreaterThan(0.16); // 接近 high=0.18
    });

    it('每个 theta 通过 validateTheta', () => {
        const thetas = lhsThetas(20, paramSpace, { seed: 99 });
        for (const theta of thetas) {
            expect(paramSpace.validateTheta(theta).ok).toBe(true);
        }
    });

    it('固定 seed → 可复现', () => {
        const a = lhsThetas(15, paramSpace, { seed: 100 });
        const b = lhsThetas(15, paramSpace, { seed: 100 });
        expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
    });
});

describe('lhsSampler — buildPhaseATasks', () => {
    it('为每 context 生成 thetas×seeds 个任务', () => {
        const ctxs = enumerateAllContexts().slice(0, 3); // 取前 3 个 context
        const tasks = buildPhaseATasks(ctxs, 5, 2, paramSpace);
        // 3 ctx × 5 theta × 2 seeds = 30
        expect(tasks).toHaveLength(30);
    });

    it('每 context 内 theta 唯一', () => {
        const ctxs = enumerateAllContexts().slice(0, 1);
        const tasks = buildPhaseATasks(ctxs, 10, 1, paramSpace);
        const sigs = new Set(tasks.map((t) => JSON.stringify(t.theta)));
        // 10 个唯一 theta
        expect(sigs.size).toBe(10);
    });

    it('不同 context 用不同的 LHS 集合', () => {
        const ctxs = enumerateAllContexts().slice(0, 2);
        const tasks = buildPhaseATasks(ctxs, 10, 1, paramSpace);
        const ctx0Thetas = tasks.filter((t) => t.context === ctxs[0]).map((t) => JSON.stringify(t.theta));
        const ctx1Thetas = tasks.filter((t) => t.context === ctxs[1]).map((t) => JSON.stringify(t.theta));
        const overlap = ctx0Thetas.filter((s) => ctx1Thetas.includes(s));
        expect(overlap.length).toBeLessThan(3);  // 极少重合
    });

    it('seq 单调递增,无重复', () => {
        const ctxs = enumerateAllContexts().slice(0, 5);
        const tasks = buildPhaseATasks(ctxs, 4, 2, paramSpace);
        for (let i = 0; i < tasks.length; i++) {
            expect(tasks[i].seq).toBe(i);
        }
    });

    it('120 个 context 全规模冷启动任务数正确', () => {
        const ctxs = enumerateAllContexts();
        expect(ctxs).toHaveLength(120);
        const tasks = buildPhaseATasks(ctxs, 97, 3, paramSpace);  // 与文档 §5.2 数字对齐
        expect(tasks).toHaveLength(120 * 97 * 3);
        // 与文档 §5.2 Phase A 总样本 ~35K 一致 (±5% 容差)
        expect(tasks.length).toBeGreaterThan(34000);
        expect(tasks.length).toBeLessThan(36000);
    });
});
