/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P1-2 — multiTaskEncoder 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    MTL_LATENT_DIM,
    MTL_SCHEMA_VERSION,
    _resetMultiTaskForTests,
    encodeFeatures,
    getMultiTaskMeta,
    predictAllTasks,
    predictTask,
    setMultiTaskWeights,
} from '../web/src/monetization/ml/multiTaskEncoder.js';
import { FEATURE_SCHEMA_SIZE } from '../web/src/monetization/commercialFeatureSnapshot.js';

beforeEach(() => _resetMultiTaskForTests());
afterEach(() => _resetMultiTaskForTests());

describe('encodeFeatures', () => {
    it('输出 latent 长度 = MTL_LATENT_DIM', () => {
        const f = new Array(FEATURE_SCHEMA_SIZE).fill(0.5);
        const h = encodeFeatures(f);
        expect(h.length).toBe(MTL_LATENT_DIM);
    });

    it('全 0 输入 → 全 0 latent（identity encoder）', () => {
        const f = new Array(FEATURE_SCHEMA_SIZE).fill(0);
        const h = encodeFeatures(f);
        expect(h.every((v) => v === 0)).toBe(true);
    });

    it('relu：负值被裁掉', () => {
        // 注入一个 encoder 让某 latent 输出负值
        setMultiTaskWeights({
            schemaVersion: MTL_SCHEMA_VERSION,
            encoder: {
                W: Array.from({ length: MTL_LATENT_DIM }, () => new Array(FEATURE_SCHEMA_SIZE).fill(-1)),
                b: new Array(MTL_LATENT_DIM).fill(0),
            },
            heads: {
                iap: { w: new Array(MTL_LATENT_DIM).fill(0), b: 0 },
                rewarded: { w: new Array(MTL_LATENT_DIM).fill(0), b: 0 },
                interstitial: { w: new Array(MTL_LATENT_DIM).fill(0), b: 0 },
                churn: { w: new Array(MTL_LATENT_DIM).fill(0), b: 0 },
            },
        });
        const f = new Array(FEATURE_SCHEMA_SIZE).fill(0.5);
        const h = encodeFeatures(f);
        // 全负输入 + ReLU → 全 0
        expect(h.every((v) => v === 0)).toBe(true);
    });
});

describe('predictTask + predictAllTasks', () => {
    it('默认：未注入 weights → predictAllTasks 输出 [0, 1] 概率', () => {
        const f = new Array(FEATURE_SCHEMA_SIZE).fill(0.5);
        const out = predictAllTasks(f);
        expect(out.iap).toBeGreaterThan(0);
        expect(out.iap).toBeLessThan(1);
        expect(out.rewarded).toBeGreaterThan(0);
        expect(out.churn).toBeGreaterThan(0);
        expect(out.latent.length).toBe(MTL_LATENT_DIM);
    });

    it('未知 task → predictTask 返回 0', () => {
        const h = new Array(MTL_LATENT_DIM).fill(0.1);
        expect(predictTask(h, 'unknown')).toBe(0);
    });
});

describe('setMultiTaskWeights', () => {
    it('schema 版本不一致 → false', () => {
        expect(setMultiTaskWeights({ schemaVersion: 999, encoder: {}, heads: {} })).toBe(false);
    });

    it('正确权重生效，meta 标 isDefault=false', () => {
        const ok = setMultiTaskWeights({
            schemaVersion: MTL_SCHEMA_VERSION,
            encoder: {
                W: Array.from({ length: MTL_LATENT_DIM }, () => new Array(FEATURE_SCHEMA_SIZE).fill(0)),
                b: new Array(MTL_LATENT_DIM).fill(0),
            },
            heads: {
                iap: { w: new Array(MTL_LATENT_DIM).fill(1), b: 0 },
                rewarded: { w: new Array(MTL_LATENT_DIM).fill(0), b: 0 },
                interstitial: { w: new Array(MTL_LATENT_DIM).fill(0), b: 0 },
                churn: { w: new Array(MTL_LATENT_DIM).fill(0), b: 0 },
            },
            fittedAt: 12345,
            source: 'test',
        });
        expect(ok).toBe(true);
        expect(getMultiTaskMeta().isDefault).toBe(false);
        expect(getMultiTaskMeta().source).toBe('test');
    });
});
