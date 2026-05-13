/**
 * @vitest-environment jsdom
 *
 * v1.49.x 算法层 P0-2 — modelQualityMonitor 单测
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    _resetModelQualityForTests,
    flushModelQuality,
    getModelQualityReport,
    getTaskQuality,
    recordSample,
} from '../web/src/monetization/quality/modelQualityMonitor.js';

beforeEach(() => _resetModelQualityForTests());
afterEach(() => _resetModelQualityForTests());

describe('recordSample + getTaskQuality', () => {
    it('无样本：getTaskQuality 返回 null', () => {
        expect(getTaskQuality('iap')).toBeNull();
    });

    it('Brier 全对：误差 0', () => {
        recordSample('iap', 1, 1, 1);
        recordSample('iap', 0, 0, 0);
        const q = getTaskQuality('iap');
        expect(q.brier).toBeCloseTo(0, 5);
        expect(q.n).toBe(2);
    });

    it('Brier 全反：误差 1', () => {
        recordSample('iap', 1, 1, 0);
        recordSample('iap', 0, 0, 1);
        const q = getTaskQuality('iap');
        expect(q.brier).toBeCloseTo(1, 5);
    });

    it('positiveRate 计算正确', () => {
        for (let i = 0; i < 8; i++) recordSample('iap', 0.5, 0.5, i % 4 === 0 ? 1 : 0);
        const q = getTaskQuality('iap');
        expect(q.positiveRate).toBeCloseTo(0.25, 5);
    });

    it('PR-AUC：完美排序 → AUC = 1', () => {
        // 4 个正样本 score 高于 4 个负样本
        for (let i = 0; i < 4; i++) recordSample('iap', 0.9, 0.9, 1);
        for (let i = 0; i < 4; i++) recordSample('iap', 0.1, 0.1, 0);
        const q = getTaskQuality('iap');
        expect(q.prAuc).toBeCloseTo(1, 3);
    });

    it('hitAt10：top 10% 命中率', () => {
        for (let i = 0; i < 10; i++) recordSample('iap', i / 10, i / 10, i >= 8 ? 1 : 0);
        const q = getTaskQuality('iap');
        expect(q.hitAt10).toBe(1); // top 1 score=0.9 是正样本
    });

    it('raw 与 calibrated 同时计算', () => {
        recordSample('iap', 0.9, 0.5, 0);
        recordSample('iap', 0.1, 0.5, 1);
        const q = getTaskQuality('iap');
        expect(q.brier).toBeGreaterThanOrEqual(0);
        expect(q.raw.brier).toBeGreaterThanOrEqual(0);
        // calibrated 全 0.5：Brier = 0.25
        expect(q.brier).toBeCloseTo(0.25, 5);
    });
});

describe('getModelQualityReport', () => {
    it('多任务汇总', () => {
        recordSample('iap', 0.5, 0.5, 1);
        recordSample('rewarded', 0.6, 0.6, 0);
        const report = getModelQualityReport();
        expect(report.tasks.length).toBe(2);
        const tasks = report.tasks.map((t) => t.task).sort();
        expect(tasks).toEqual(['iap', 'rewarded']);
    });
});

describe('flushModelQuality', () => {
    it('调用不抛异常', () => {
        recordSample('iap', 0.5, 0.5, 1);
        expect(() => flushModelQuality()).not.toThrow();
    });
});
