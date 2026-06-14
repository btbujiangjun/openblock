/**
 * DA-4 埋点质量监控单测（纯函数）。
 */
import { describe, it, expect } from 'vitest';
import {
    percentile,
    computeTelemetryQuality,
    evaluateTelemetryAlerts,
    DEFAULT_TELEMETRY_THRESHOLDS,
} from '../web/src/telemetry/telemetryQuality.js';

describe('telemetryQuality · percentile', () => {
    it('空数组返回 0', () => {
        expect(percentile([], 0.5)).toBe(0);
    });
    it('线性插值分位', () => {
        expect(percentile([10, 20, 30, 40], 0.5)).toBeCloseTo(25, 5);
        expect(percentile([10, 20, 30, 40], 0)).toBe(10);
        expect(percentile([10, 20, 30, 40], 1)).toBe(40);
    });
});

describe('telemetryQuality · computeTelemetryQuality', () => {
    it('丢失计入：lost 标记 / 无 ack / ack<=sent', () => {
        const q = computeTelemetryQuality([
            { sentTs: 0, ackTs: 100 },
            { sentTs: 0, ackTs: 200 },
            { sentTs: 0, lost: true },
            { sentTs: 0 },
            { sentTs: 100, ackTs: 50 },
        ]);
        expect(q.total).toBe(5);
        expect(q.lost).toBe(3);
        expect(q.delivered).toBe(2);
        expect(q.lossRate).toBeCloseTo(0.6, 5);
        expect(q.latencyP50).toBeCloseTo(150, 0);
    });

    it('全空返回零值', () => {
        const q = computeTelemetryQuality([]);
        expect(q.total).toBe(0);
        expect(q.lossRate).toBe(0);
        expect(q.latencyP95).toBe(0);
    });
});

describe('telemetryQuality · evaluateTelemetryAlerts', () => {
    it('高丢失率 → error 告警', () => {
        const q = computeTelemetryQuality(
            Array.from({ length: 100 }, (_, i) => (i < 10
                ? { sentTs: 0, lost: true }
                : { sentTs: 0, ackTs: 50 })),
        );
        const r = evaluateTelemetryAlerts(q);
        expect(r.alerts.some((a) => a.code === 'HIGH_LOSS_RATE')).toBe(true);
        expect(r.healthy).toBe(false);
    });

    it('p95 超阈值 → warn 告警', () => {
        // 90 条低延迟 + 10 条高延迟 → p95 落在高延迟区间
        const events = Array.from({ length: 90 }, () => ({ sentTs: 0, ackTs: 50 }));
        for (let i = 0; i < 10; i++) events.push({ sentTs: 0, ackTs: 9000 });
        const q = computeTelemetryQuality(events);
        expect(q.latencyP95).toBeGreaterThan(2000);
        const r = evaluateTelemetryAlerts(q, { ...DEFAULT_TELEMETRY_THRESHOLDS, maxLatencyP95: 2000 });
        expect(r.alerts.some((a) => a.code === 'HIGH_LATENCY_P95')).toBe(true);
    });

    it('样本不足 → lowSample + info', () => {
        const q = computeTelemetryQuality([{ sentTs: 0, ackTs: 10 }]);
        const r = evaluateTelemetryAlerts(q);
        expect(r.lowSample).toBe(true);
        expect(r.alerts.some((a) => a.code === 'LOW_SAMPLE')).toBe(true);
    });

    it('健康样本无 error/warn → healthy', () => {
        const q = computeTelemetryQuality(
            Array.from({ length: 100 }, () => ({ sentTs: 0, ackTs: 100 })),
        );
        const r = evaluateTelemetryAlerts(q);
        expect(r.healthy).toBe(true);
        expect(r.alerts.length).toBe(0);
    });
});
