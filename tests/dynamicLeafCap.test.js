/**
 * Y1: dynamic leafCap by fill — 自适应解析单测。
 *
 * resolveDynamicLeafCap 未导出（内部 helper），直接复制 reference 实现
 * 验证决策表语义；blockSpawn 集成路径靠 spawnGolden 端到端守护。
 */
import { describe, it, expect } from 'vitest';

function resolveDynamicLeafCapRef(fill, cfg) {
    if (!cfg.dynamicLeafCap) return cfg.leafCap;
    if (!Number.isFinite(fill)) return cfg.leafCap;
    if (fill < cfg.leafCapLowFillThreshold) return cfg.leafCapLowFill;
    if (fill >= cfg.leafCapHighFillThreshold) return cfg.leafCapHighFill;
    return cfg.leafCap;
}

const baseCfg = {
    dynamicLeafCap: true,
    leafCap: 64,
    leafCapLowFillThreshold: 0.45,
    leafCapHighFillThreshold: 0.65,
    leafCapLowFill: 32,
    leafCapHighFill: 96,
};

describe('Y1 resolveDynamicLeafCap — 三档自适应', () => {
    it('未启用 → 始终返回 baseCap（向后兼容）', () => {
        const cfg = { ...baseCfg, dynamicLeafCap: false };
        expect(resolveDynamicLeafCapRef(0.20, cfg)).toBe(64);
        expect(resolveDynamicLeafCapRef(0.50, cfg)).toBe(64);
        expect(resolveDynamicLeafCapRef(0.80, cfg)).toBe(64);
    });

    it('低 fill (< 0.45) → leafCapLowFill (32)', () => {
        expect(resolveDynamicLeafCapRef(0.10, baseCfg)).toBe(32);
        expect(resolveDynamicLeafCapRef(0.30, baseCfg)).toBe(32);
        expect(resolveDynamicLeafCapRef(0.44, baseCfg)).toBe(32);
    });

    it('中 fill [0.45, 0.65) → baseCap (64)', () => {
        expect(resolveDynamicLeafCapRef(0.45, baseCfg)).toBe(64);
        expect(resolveDynamicLeafCapRef(0.55, baseCfg)).toBe(64);
        expect(resolveDynamicLeafCapRef(0.64, baseCfg)).toBe(64);
    });

    it('高 fill (≥ 0.65) → leafCapHighFill (96)', () => {
        expect(resolveDynamicLeafCapRef(0.65, baseCfg)).toBe(96);
        expect(resolveDynamicLeafCapRef(0.80, baseCfg)).toBe(96);
        expect(resolveDynamicLeafCapRef(0.95, baseCfg)).toBe(96);
    });

    it('非有限 fill → 回退到 baseCap（鲁棒性）', () => {
        expect(resolveDynamicLeafCapRef(NaN, baseCfg)).toBe(64);
        expect(resolveDynamicLeafCapRef(Infinity, baseCfg)).toBe(64);
        expect(resolveDynamicLeafCapRef(undefined, baseCfg)).toBe(64);
    });

    it('阈值边界精确：0.45 进中档，0.65 进高档（半开区间约定）', () => {
        expect(resolveDynamicLeafCapRef(0.4499, baseCfg)).toBe(32);
        expect(resolveDynamicLeafCapRef(0.45, baseCfg)).toBe(64);
        expect(resolveDynamicLeafCapRef(0.6499, baseCfg)).toBe(64);
        expect(resolveDynamicLeafCapRef(0.65, baseCfg)).toBe(96);
    });

    it('自定义档位可独立覆盖（不冻结 32/64/96）', () => {
        const cfg = { ...baseCfg, leafCapLowFill: 16, leafCapHighFill: 128 };
        expect(resolveDynamicLeafCapRef(0.20, cfg)).toBe(16);
        expect(resolveDynamicLeafCapRef(0.80, cfg)).toBe(128);
    });
});
