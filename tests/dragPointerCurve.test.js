/**
 * dragPointerCurve — 拖拽指针速度感知曲线（pointer ballistics）单测。
 *
 * 验证 v1.46「小幅拖动即可落子」改动的核心数学，无需起完整 Game 实例：
 *   - velocityFactor 在阈值边界、超界、无效输入下的归一化
 *   - effectiveGain 在 [minGain, maxGain] 之间正确插值
 *   - computeStepGain 给出的"增量增益"满足慢速精准 / 快速放大的预期形状
 *   - 对 web 端鼠标 / 触屏、小程序触屏的实际配置取值，stepGain 处于合理区间
 */
import { describe, it, expect } from 'vitest';
import { velocityFactor, effectiveGain, computeStepGain } from '../web/src/dragPointerCurve.js';

const TOUCH = { slow: 0.10, fast: 0.80, minGain: 1.05, maxGain: 1.70 };
const MOUSE = { slow: 0.30, fast: 1.50, minGain: 1.00, maxGain: 1.32 };

describe('dragPointerCurve.velocityFactor', () => {
    it('在 slow 阈值及以下应归零（精准段）', () => {
        expect(velocityFactor(0, 0.1, 0.8)).toBe(0);
        expect(velocityFactor(0.1, 0.1, 0.8)).toBe(0);
        expect(velocityFactor(0.05, 0.1, 0.8)).toBe(0);
    });

    it('在 fast 阈值及以上应饱和到 1（省力段）', () => {
        expect(velocityFactor(0.8, 0.1, 0.8)).toBe(1);
        expect(velocityFactor(2.0, 0.1, 0.8)).toBe(1);
    });

    it('中间段应严格单调插值', () => {
        const a = velocityFactor(0.2, 0.1, 0.8);
        const b = velocityFactor(0.4, 0.1, 0.8);
        const c = velocityFactor(0.6, 0.1, 0.8);
        expect(a).toBeGreaterThan(0);
        expect(c).toBeLessThan(1);
        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
    });

    it('中点速度应得到 ≈0.5', () => {
        const mid = (0.10 + 0.80) / 2;
        expect(velocityFactor(mid, 0.10, 0.80)).toBeCloseTo(0.5, 5);
    });

    it('NaN / Infinity 等非有限输入一律回退为 0（避免 ghost 跳跃）', () => {
        expect(velocityFactor(NaN, 0.1, 0.8)).toBe(0);
        expect(velocityFactor(Infinity, 0.1, 0.8)).toBe(0);
        expect(velocityFactor(-Infinity, 0.1, 0.8)).toBe(0);
    });

    it('slow >= fast 时也不应除零或抛错', () => {
        expect(() => velocityFactor(0.5, 1.0, 1.0)).not.toThrow();
        const v = velocityFactor(0.5, 1.0, 1.0);
        expect(Number.isFinite(v)).toBe(true);
    });
});

describe('dragPointerCurve.effectiveGain', () => {
    it('factor=0 → minGain（1:1 跟随，对位精准不抢跑）', () => {
        expect(effectiveGain(0, 1.0, 1.32)).toBe(1.0);
        expect(effectiveGain(0, 1.05, 1.70)).toBe(1.05);
    });

    it('factor=1 → maxGain（最大放大，长距离省力）', () => {
        expect(effectiveGain(1, 1.0, 1.32)).toBe(1.32);
        expect(effectiveGain(1, 1.05, 1.70)).toBe(1.70);
    });

    it('factor 越界应被钳制到 [0, 1]', () => {
        expect(effectiveGain(-1, 1.0, 1.5)).toBe(1.0);
        expect(effectiveGain(2, 1.0, 1.5)).toBe(1.5);
    });

    it('对触屏配置：mid factor 应处于精准与省力之间', () => {
        const g = effectiveGain(0.5, TOUCH.minGain, TOUCH.maxGain);
        expect(g).toBeGreaterThan(TOUCH.minGain);
        expect(g).toBeLessThan(TOUCH.maxGain);
        expect(g).toBeCloseTo((TOUCH.minGain + TOUCH.maxGain) / 2, 5);
    });
});

describe('dragPointerCurve.computeStepGain (触屏 v1.46)', () => {
    it('慢速对位（speed=0）应几乎不放大（≈0.05 → 100px 手指 ≈ 105px ghost）', () => {
        const s = computeStepGain(0, TOUCH);
        expect(s).toBeCloseTo(TOUCH.minGain - 1, 5);
        expect(s).toBeLessThan(0.10);
    });

    it('快速一甩（speed≥fast）应吃满 maxGain（≈0.7 → 100px 手指 ≈ 170px ghost）', () => {
        const s = computeStepGain(0.8, TOUCH);
        expect(s).toBeCloseTo(TOUCH.maxGain - 1, 5);
        expect(s).toBeGreaterThan(0.65);
    });

    it('中段速度的 stepGain 严格单调（不抖、不阶跃）', () => {
        const samples = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8].map((s) => computeStepGain(s, TOUCH));
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
        }
    });

    it('stepGain 永不为负（增量积分式累加要求单调）', () => {
        for (const speed of [0, 0.05, 0.1, 0.5, 1.0, 5.0]) {
            expect(computeStepGain(speed, TOUCH)).toBeGreaterThanOrEqual(0);
        }
    });
});

describe('dragPointerCurve.computeStepGain (鼠标 v1.46，参数与既有一致)', () => {
    it('慢速精细对位 → stepGain=0（1:1 跟随）', () => {
        expect(computeStepGain(0, MOUSE)).toBe(0);
        expect(computeStepGain(0.30, MOUSE)).toBe(0);
    });

    it('快速甩动 → stepGain=0.32（既有 DRAG_MOUSE_GAIN-1）', () => {
        expect(computeStepGain(1.50, MOUSE)).toBeCloseTo(0.32, 5);
        expect(computeStepGain(3.0, MOUSE)).toBeCloseTo(0.32, 5);
    });
});

describe('dragPointerCurve — 触屏 vs 鼠标的"省力差"', () => {
    it('同样的"快速"，触屏放大 > 鼠标（触屏物理距离更长，需要更多省力）', () => {
        const touchFast = computeStepGain(TOUCH.fast, TOUCH);
        const mouseFast = computeStepGain(MOUSE.fast, MOUSE);
        expect(touchFast).toBeGreaterThan(mouseFast);
    });

    it('同样的"慢速精准"，触屏比鼠标稍微多一点放大（避免触屏完全不响应小幅手势）', () => {
        const touchSlow = computeStepGain(0, TOUCH);
        const mouseSlow = computeStepGain(0, MOUSE);
        expect(touchSlow).toBeGreaterThan(mouseSlow);
        expect(touchSlow).toBeLessThan(0.10);
    });
});
