/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P2-3 — distributionDriftMonitor 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    DRIFT_SCHEMA_VERSION,
    _resetDriftForTests,
    getDriftReport,
    recordSnapshotForDrift,
    setTrainingDistribution,
} from '../web/src/monetization/quality/distributionDriftMonitor.js';
import { FEATURE_SCHEMA, buildCommercialFeatureSnapshot } from '../web/src/monetization/commercialFeatureSnapshot.js';

beforeEach(() => _resetDriftForTests());
afterEach(() => _resetDriftForTests());

describe('recordSnapshotForDrift + getDriftReport', () => {
    it('无样本：getDriftReport 返回 totalSamples=0，所有 KL=0', () => {
        const r = getDriftReport();
        expect(r.totalSamples).toBe(0);
        expect(r.perFeature.length).toBe(FEATURE_SCHEMA.length);
        // 默认 train 是均匀分布，live counts 为 0 → live 也均匀 → KL = 0
        expect(r.perFeature.every((p) => p.kl === 0)).toBe(true);
    });

    it('累计样本后 KL 可计算', () => {
        for (let i = 0; i < 50; i++) {
            const snap = buildCommercialFeatureSnapshot({
                persona: { whaleScore: 0.9, activityScore: 0.9 },
            });
            recordSnapshotForDrift(snap);
        }
        const r = getDriftReport();
        expect(r.totalSamples).toBe(50);
        // whaleScore 集中在 0.9 → 与均匀分布显著不同
        const ws = r.perFeature.find((p) => p.key === 'whaleScore');
        expect(ws.kl).toBeGreaterThan(0);
    });

    it('注入 train 分布后 KL 反映与之比较', () => {
        // 训练分布全部集中在 bin 9（0.9-1.0）
        const probsConcentrated = new Array(10).fill(0);
        probsConcentrated[9] = 1;
        setTrainingDistribution({
            schemaVersion: DRIFT_SCHEMA_VERSION,
            bins: { whaleScore: { probs: probsConcentrated } },
        });
        // 线上观察：所有样本 whaleScore=0.9（同样集中在 bin 9）→ KL 接近 0
        for (let i = 0; i < 50; i++) {
            recordSnapshotForDrift(buildCommercialFeatureSnapshot({ persona: { whaleScore: 0.9 } }));
        }
        const r = getDriftReport();
        const ws = r.perFeature.find((p) => p.key === 'whaleScore');
        expect(ws.kl).toBeLessThan(0.01);
        expect(r.hasTrainBaseline).toBe(true);
    });
});

describe('setTrainingDistribution 校验', () => {
    it('schema 错误 → false', () => {
        expect(setTrainingDistribution({ schemaVersion: 999 })).toBe(false);
    });

    it('bins 缺失 → false', () => {
        expect(setTrainingDistribution({ schemaVersion: DRIFT_SCHEMA_VERSION })).toBe(false);
    });
});
