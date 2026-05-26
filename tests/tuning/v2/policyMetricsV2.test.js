/**
 * policyMetricsV2 SDK 单元测试。
 *
 * 验证:
 *   - d_curve 提取与 Python 端 extractor.py 一致
 *   - recordStep / reportEpisode / flushNow 流程
 *   - sessionStorage 持久化
 *   - 失败重试不丢数据
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    initPolicyMetricsV2, recordStep, reportEpisode, flushNow,
    getStats, disable, extractDCurveJS,
} from '../../../web/src/tuning/v2/policyMetricsV2.js';

// ─────────── Mock sessionStorage + fetch ───────────

beforeEach(() => {
    if (typeof globalThis.sessionStorage === 'undefined') {
        let _store = {};
        globalThis.sessionStorage = {
            getItem: (k) => _store[k] || null,
            setItem: (k, v) => { _store[k] = String(v); },
            removeItem: (k) => { delete _store[k]; },
            clear: () => { _store = {}; },
        };
    } else {
        sessionStorage.clear();
    }
    globalThis.fetch = vi.fn();
});


// ─────────── d_curve 提取 ───────────

describe('extractDCurveJS', () => {
    it('basic episode produces 20-length d_curve', () => {
        const steps = [
            { stepIdx: 0, score: 30, fillRate: 0.3, actionFreedom: 0.7, noMove: false, clears: 0 },
            { stepIdx: 1, score: 60, fillRate: 0.5, actionFreedom: 0.5, noMove: false, clears: 0 },
            { stepIdx: 2, score: 90, fillRate: 0.7, actionFreedom: 0.3, noMove: false, clears: 0 },
        ];
        const labels = extractDCurveJS(steps, 100);
        expect(labels).not.toBeNull();
        expect(labels.d_curve).toHaveLength(20);
        expect(labels.final_score).toBe(90);
        expect(labels.survived_steps).toBe(3);
        expect(labels.pb_broke).toBe(false);
        expect(labels.noMove_step).toBe(-1);
    });

    it('pb_broke when final > pb', () => {
        const steps = [
            { stepIdx: 0, score: 50, fillRate: 0.3, actionFreedom: 0.7, noMove: false },
            { stepIdx: 1, score: 110, fillRate: 0.5, actionFreedom: 0.5, noMove: false },
        ];
        const labels = extractDCurveJS(steps, 100);
        expect(labels.pb_broke).toBe(true);
    });

    it('noMove records first occurrence', () => {
        const steps = [
            { stepIdx: 0, score: 30, fillRate: 0.3, actionFreedom: 0.7, noMove: false },
            { stepIdx: 1, score: 50, fillRate: 0.9, actionFreedom: 0.0, noMove: true },
            { stepIdx: 2, score: 50, fillRate: 0.9, actionFreedom: 0.0, noMove: true },
        ];
        const labels = extractDCurveJS(steps, 100);
        expect(labels.noMove_step).toBe(1);
    });

    it('surprise damping at clears >= 3', () => {
        // v2.10: surprise 衰减只作用在 state_d 部分, 不衰减 PB 基础
        //   state_d_raw  = 0.3*0.5 + 0.5*0.7 + 0.2*0.5 = 0.60
        //   state_d_damp = 0.60 * 0.50 = 0.30 (surprise × 0.5)
        //   d_pb_base(0.3) = 0.40 + 0.45 * sigmoid(-3.056) ≈ 0.4203
        //   offset = (0.30 - 0.50) * 0.30 = -0.060
        //   d_step ≈ 0.4203 - 0.060 = 0.3603
        const steps = [
            { stepIdx: 0, score: 30, fillRate: 0.5, actionFreedom: 0.3, noMove: false, clears: 4 },
        ];
        const labels = extractDCurveJS(steps, 100);
        const bin = Math.floor(0.3 / (2.0 / 20));  // CURVE_R_MAX=2.0
        expect(labels.d_curve[bin]).toBeCloseTo(0.360, 2);
        expect(labels.surprise_count).toBe(1);
    });

    it('all d_curve values in [0, 1]', () => {
        const steps = Array.from({ length: 20 }, (_, i) => ({
            stepIdx: i, score: i * 5,
            fillRate: Math.min(0.95, i * 0.05),
            actionFreedom: Math.max(0.05, 1 - i * 0.05),
            noMove: false, clears: 0,
        }));
        const labels = extractDCurveJS(steps, 100);
        for (const v of labels.d_curve) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });

    it('returns null on empty steps', () => {
        expect(extractDCurveJS([], 100)).toBeNull();
        expect(extractDCurveJS([{}], 0)).toBeNull();
        expect(extractDCurveJS([{}], -1)).toBeNull();
    });
});


// ─────────── recordStep + reportEpisode 流程 ───────────

describe('SDK flow', () => {
    beforeEach(() => {
        initPolicyMetricsV2({ apiBaseUrl: 'http://test', flushIntervalMs: 999_999 });
    });

    it('recordStep accumulates', () => {
        recordStep({ stepIdx: 0, score: 10, fillRate: 0.3, actionFreedom: 0.7, noMove: false });
        recordStep({ stepIdx: 1, score: 20, fillRate: 0.4, actionFreedom: 0.6, noMove: false });
        expect(getStats().steps_recorded).toBe(2);
        expect(getStats().current_steps).toBe(2);
    });

    it('reportEpisode extracts and buffers', () => {
        for (let i = 0; i < 5; i++) {
            recordStep({ stepIdx: i, score: i * 20, fillRate: 0.3 + i * 0.05, actionFreedom: 0.7, noMove: false });
        }
        reportEpisode({ pb: 100, contextKey: 'easy:budget-p2:random:500:growth' });
        const s = getStats();
        expect(s.episodes_reported).toBe(1);
        expect(s.buffer_size).toBe(1);
        expect(s.current_steps).toBe(0);  // 局结束清空
    });

    it('reportEpisode ignores invalid pb', () => {
        recordStep({ stepIdx: 0, score: 50, fillRate: 0.5, actionFreedom: 0.5, noMove: false });
        reportEpisode({ pb: 0 });
        expect(getStats().episodes_reported).toBe(0);
    });

    it('flushNow sends batch when fetch succeeds', async () => {
        fetch.mockResolvedValue({ ok: true });
        for (let i = 0; i < 3; i++) {
            recordStep({ stepIdx: i, score: i * 10, fillRate: 0.3, actionFreedom: 0.7, noMove: false });
        }
        reportEpisode({ pb: 100 });
        reportEpisode({ pb: 100 });

        const r = await flushNow();
        expect(r.sent).toBeGreaterThanOrEqual(1);  // 至少 1 个 episode
        expect(getStats().flushed_batches).toBe(1);
        expect(getStats().buffer_size).toBe(0);
    });

    it('flush failure keeps buffer', async () => {
        fetch.mockResolvedValue({ ok: false, status: 500 });
        recordStep({ stepIdx: 0, score: 50, fillRate: 0.5, actionFreedom: 0.5, noMove: false });
        reportEpisode({ pb: 100 });
        const r = await flushNow();
        expect(r.error).toBeTruthy();
        expect(getStats().flush_errors).toBe(1);
        expect(getStats().buffer_size).toBeGreaterThan(0);  // 保留
    });

    it('disabled SDK is no-op', () => {
        disable();
        recordStep({ stepIdx: 0, score: 50, fillRate: 0.5, actionFreedom: 0.5, noMove: false });
        expect(getStats().steps_recorded).toBe(0);
    });
});
