/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 snapshot — 单测
 */
import { describe, expect, it } from 'vitest';
import {
    FEATURE_SCHEMA,
    FEATURE_SCHEMA_SIZE,
    SCHEMA_VERSION,
    buildCommercialFeatureSnapshot,
    featureSnapshotDigest,
    featureSnapshotToVector,
    getFeatureSpec,
} from '../web/src/monetization/commercialFeatureSnapshot.js';

describe('FEATURE_SCHEMA 完整性', () => {
    it('字段名唯一', () => {
        const keys = FEATURE_SCHEMA.map((s) => s.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('SCHEMA_VERSION ≥ 1，且 size 与 array 长度一致', () => {
        expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
        expect(FEATURE_SCHEMA_SIZE).toBe(FEATURE_SCHEMA.length);
    });

    it('每个 spec 都有 default ∈ [0, 1]', () => {
        for (const spec of FEATURE_SCHEMA) {
            expect(spec.default).toBeGreaterThanOrEqual(0);
            expect(spec.default).toBeLessThanOrEqual(1);
        }
    });

    it('getFeatureSpec 命中 / 不命中', () => {
        expect(getFeatureSpec('whaleScore')?.key).toBe('whaleScore');
        expect(getFeatureSpec('not_exist')).toBeNull();
    });
});

describe('buildCommercialFeatureSnapshot', () => {
    it('空输入：vector 长度对齐 schema；persona 类字段计入 _missing', () => {
        const snap = buildCommercialFeatureSnapshot({});
        expect(snap.vector.length).toBe(FEATURE_SCHEMA_SIZE);
        /* persona / lifecycle / ltv / ability 段都没有原值，应当全部进 _missing；
         * 但 flowFlow / hadNearMiss / inRecoveryPeriod 等 one-hot/布尔派生项默认 0，
         * 是合法的 present 值，不计入 _missing。 */
        expect(snap._missing).toContain('whaleScore');
        expect(snap._missing).toContain('skillScore');
        expect(snap._missing.length).toBeGreaterThan(0);
        expect(snap._missing.length).toBeLessThan(FEATURE_SCHEMA_SIZE);
        for (const v of snap.vector) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });

    it('flowState=anxious one-hot 正确', () => {
        const snap = buildCommercialFeatureSnapshot({ realtime: { flowState: 'anxious' } });
        expect(snap.features.flowAnxious).toBe(1);
        expect(snap.features.flowFlow).toBe(0);
        expect(snap.features.flowBored).toBe(0);
    });

    it('归一：daysSinceInstall=180 → ≥ 90 → clamp 到 1', () => {
        const snap = buildCommercialFeatureSnapshot({ lifecycle: { daysSinceInstall: 180 } });
        expect(snap.features.daysSinceInstall).toBe(1);
    });

    it('归一：rewardedToday=6 / 12 = 0.5', () => {
        const snap = buildCommercialFeatureSnapshot({ adFreq: { rewardedCount: 6 } });
        expect(snap.features.rewardedToday).toBeCloseTo(0.5, 5);
    });

    it('snapshot 是 Object.freeze 的（不可变）', () => {
        const snap = buildCommercialFeatureSnapshot({});
        expect(Object.isFrozen(snap)).toBe(true);
        expect(Object.isFrozen(snap.features)).toBe(true);
    });

    it('featureSnapshotToVector 输出 Float32Array 与 vector 等价', () => {
        const snap = buildCommercialFeatureSnapshot({ persona: { whaleScore: 0.4 } });
        const f32 = featureSnapshotToVector(snap);
        expect(f32).toBeInstanceOf(Float32Array);
        expect(f32.length).toBe(FEATURE_SCHEMA_SIZE);
        expect(f32[0]).toBeCloseTo(snap.vector[0], 5);
    });

    it('featureSnapshotDigest 同输入同输出，不同输入不同输出', () => {
        const a = buildCommercialFeatureSnapshot({ persona: { whaleScore: 0.4 } });
        const b = buildCommercialFeatureSnapshot({ persona: { whaleScore: 0.4 } });
        const c = buildCommercialFeatureSnapshot({ persona: { whaleScore: 0.5 } });
        expect(featureSnapshotDigest(a)).toBe(featureSnapshotDigest(b));
        expect(featureSnapshotDigest(a)).not.toBe(featureSnapshotDigest(c));
        expect(featureSnapshotDigest(a)).toMatch(/^[0-9a-f]{8}$/);
    });
});
