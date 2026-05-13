/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P0-3 — actionOutcomeMatrix 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    _resetActionOutcomeForTests,
    attachActionOutcomeMatrix,
    detachActionOutcomeMatrix,
    getMatrix,
    getPolicyGain,
    isActionOutcomeMatrixAttached,
    recordOutcome,
    recordRecommendation,
} from '../web/src/monetization/quality/actionOutcomeMatrix.js';
import { emit } from '../web/src/monetization/MonetizationBus.js';

beforeEach(() => _resetActionOutcomeForTests());
afterEach(() => _resetActionOutcomeForTests());

describe('recordRecommendation / recordOutcome', () => {
    it('recommend → outcome 正确累计', () => {
        recordRecommendation('iap_offer', { snapshotDigest: 'abc' });
        recordOutcome('buy', { snapshotDigest: 'abc' });
        const m = getMatrix();
        expect(m.cells.iap_offer.recommended).toBe(1);
        expect(m.cells.iap_offer.buy).toBe(1);
    });

    it('未匹配 digest 时使用最近一条 recommendation', () => {
        recordRecommendation('rewarded_ad', { snapshotDigest: 'a' });
        recordRecommendation('iap_offer', { snapshotDigest: 'b' });
        recordOutcome('buy'); // 应当 attribute 到最近的 'iap_offer'
        const m = getMatrix();
        expect(m.cells.iap_offer.buy).toBe(1);
        expect(m.cells.rewarded_ad?.buy).toBeUndefined();
    });

    it('outcome 无关联推荐时 → action="unrecommended"', () => {
        recordOutcome('buy');
        const m = getMatrix();
        expect(m.cells.unrecommended?.buy).toBe(1);
    });
});

describe('getPolicyGain', () => {
    it('计算转化率', () => {
        recordRecommendation('iap_offer', { snapshotDigest: 'a' });
        recordRecommendation('iap_offer', { snapshotDigest: 'b' });
        recordOutcome('buy', { snapshotDigest: 'a' });
        // 第二次 recommendation 没有 outcome
        const gain = getPolicyGain();
        expect(gain.iap_offer.buy).toBe(0.5); // 1 / 2
    });
});

describe('总线接线', () => {
    it('attach 后监听 purchase_completed', () => {
        attachActionOutcomeMatrix();
        recordRecommendation('iap_offer', { snapshotDigest: 'x' });
        emit('purchase_completed', { product: 'gem_pack', snapshotDigest: 'x' });
        const m = getMatrix();
        expect(m.cells.iap_offer.buy).toBe(1);
    });

    it('attach 是幂等的', () => {
        attachActionOutcomeMatrix();
        attachActionOutcomeMatrix();
        expect(isActionOutcomeMatrixAttached()).toBe(true);
    });

    it('detach 后停止监听', () => {
        attachActionOutcomeMatrix();
        detachActionOutcomeMatrix();
        recordRecommendation('iap_offer', { snapshotDigest: 'y' });
        emit('purchase_completed', { snapshotDigest: 'y' });
        const m = getMatrix();
        expect(m.cells.iap_offer?.buy).toBeUndefined();
    });
});
