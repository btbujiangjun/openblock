/**
 * @vitest-environment node
 *
 * tests/profileAudit.test.js
 *
 * 校验玩家画像指标自评估系统：
 *   1) profileAuditMath：纯数学工具的边界与正确性
 *   2) profileAuditContracts：契约判定（正向 / 反向 / 求和 / 滞后 / 漂移）
 *   3) profileAuditHints：rule-based 优化建议的触发与严重度
 *   4) profileAudit：端到端 auditProfile(frames)
 */

import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    buildInitFrame,
    buildSpawnFrame,
    buildPlaceFrame,
} from '../web/src/moveSequence.js';
import {
    mean,
    median,
    variance,
    stddev,
    quantile,
    basicStats,
    jitterStats,
    pearson,
    spearman,
    autocorrelation,
    linearTrend,
    halvesMeanDiff,
    outOfRangeCount,
    oppositeStepRate,
    laggedPearson,
} from '../web/src/audit/profileAuditMath.js';
import {
    CONTRACTS,
    applicableContracts,
} from '../web/src/audit/profileAuditContracts.js';
import {
    buildHints,
    summarizeHealthScore,
} from '../web/src/audit/profileAuditHints.js';
import {
    auditProfile,
    aggregateAuditReports,
    summarizeOptimizationActions,
    PROFILE_AUDIT_SCHEMA,
} from '../web/src/audit/profileAudit.js';

const scoring = { singleLine: 10, multiLine: 30, combo: 50 };

/* ============================================================
 * 1) 纯数学工具
 * ============================================================ */
describe('profileAuditMath — 基础统计', () => {
    it('mean/median/variance/stddev 对空集合返回安全值', () => {
        expect(mean([])).toBeNull();
        expect(median([])).toBeNull();
        expect(variance([])).toBe(0);
        expect(stddev([])).toBe(0);
        expect(quantile([], 0.5)).toBeNull();
    });

    it('mean 跳过 NaN / null / undefined', () => {
        expect(mean([1, NaN, 2, null, 3, undefined])).toBeCloseTo(2);
    });

    it('median 处理偶数和奇数长度', () => {
        expect(median([1, 2, 3])).toBe(2);
        expect(median([1, 2, 3, 4])).toBe(2.5);
    });

    it('quantile 线性插值', () => {
        expect(quantile([1, 2, 3, 4, 5], 0)).toBe(1);
        expect(quantile([1, 2, 3, 4, 5], 1)).toBe(5);
        expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    });

    it('basicStats 返回 count/min/max/mean/median/stddev', () => {
        const s = basicStats([1, 2, 3, 4, 5]);
        expect(s).toMatchObject({ count: 5, min: 1, max: 5, mean: 3, median: 3 });
        expect(s.stddev).toBeGreaterThan(0);
    });
});

describe('profileAuditMath — jitter / autocorr', () => {
    it('jitterStats: 平稳序列接近 0，跳变序列偏大', () => {
        const flat = jitterStats([1, 1, 1, 1, 1]);
        expect(flat.medianAbsDiff).toBe(0);
        expect(flat.maxAbsDiff).toBe(0);

        const jumpy = jitterStats([0, 5, 0, 5, 0]);
        expect(jumpy.medianAbsDiff).toBe(5);
        expect(jumpy.maxAbsDiff).toBe(5);
    });

    it('autocorrelation lag=1：线性递增接近 1', () => {
        const r = autocorrelation([1, 2, 3, 4, 5, 6, 7, 8], 1);
        expect(r).toBeGreaterThan(0.5);
    });

    it('autocorrelation lag=1：交替 ±1 应接近 -1', () => {
        const r = autocorrelation([1, -1, 1, -1, 1, -1, 1, -1], 1);
        expect(r).toBeLessThan(-0.5);
    });

    it('linearTrend：递增序列斜率 > 0', () => {
        const t = linearTrend([1, 2, 3, 4, 5]);
        expect(t.slope).toBeGreaterThan(0.9);
    });

    it('halvesMeanDiff：上升序列 > 0；下降 < 0', () => {
        expect(halvesMeanDiff([1, 1, 1, 5, 5, 5])).toBeGreaterThan(0);
        expect(halvesMeanDiff([5, 5, 5, 1, 1, 1])).toBeLessThan(0);
    });
});

describe('profileAuditMath — 相关性', () => {
    it('pearson: 完美正相关 = 1', () => {
        const { r } = pearson([1, 2, 3, 4], [2, 4, 6, 8]);
        expect(r).toBeCloseTo(1);
    });

    it('pearson: 完美反相关 = -1', () => {
        const { r } = pearson([1, 2, 3, 4], [8, 6, 4, 2]);
        expect(r).toBeCloseTo(-1);
    });

    it('pearson: 自动跳过 NaN 对', () => {
        const { r, n } = pearson([1, 2, NaN, 4], [2, 4, 6, 8]);
        expect(n).toBe(3);
        expect(r).toBeCloseTo(1);
    });

    it('pearson: 方差为 0 → 返回 null', () => {
        const { r } = pearson([1, 1, 1], [2, 3, 4]);
        expect(r).toBeNull();
    });

    it('spearman: 单调（但非线性）→ rho ≈ 1', () => {
        const { rho } = spearman([1, 2, 3, 4], [1, 4, 9, 16]); // y=x^2 单调
        expect(rho).toBeCloseTo(1);
    });

    it('laggedPearson: 完美滞后 = 1', () => {
        const a = [0, 1, 2, 3, 4, 5, 6, 7];
        const b = [0, 0, 0, 1, 2, 3, 4, 5]; // b[t+3] = a[t]
        const { r } = laggedPearson(a, b, 3);
        expect(r).toBeCloseTo(1);
    });
});

describe('profileAuditMath — outOfRangeCount / oppositeStepRate', () => {
    it('outOfRangeCount: 计数 + 首次越界 idx', () => {
        const r = outOfRangeCount([0.1, 0.5, 1.2, 0.3, -0.1], { min: 0, max: 1 });
        expect(r.count).toBe(2);
        expect(r.firstIdx).toBe(2);
    });

    it('outOfRangeCount: 无 range 返回 0', () => {
        const r = outOfRangeCount([100, -100], {});
        expect(r.count).toBe(0);
    });

    it('oppositeStepRate: 完全反向 → 接近 1', () => {
        const a = [1, 2, 3, 4, 5];
        const b = [5, 4, 3, 2, 1];
        const r = oppositeStepRate(a, b);
        expect(r.oppositeRate).toBe(1);
    });

    it('oppositeStepRate: 完全同向 → 接近 -1', () => {
        const a = [1, 2, 3, 4, 5];
        const b = [10, 20, 30, 40, 50];
        const r = oppositeStepRate(a, b);
        expect(r.oppositeRate).toBe(-1);
    });

    it('oppositeStepRate: 样本不足 → null', () => {
        const r = oppositeStepRate([1, 2], [3, 4]);
        expect(r.oppositeRate).toBeNull();
    });
});

/* ============================================================
 * 2) 契约
 * ============================================================ */
describe('profileAuditContracts', () => {
    it('CONTRACTS 列表稳定（不会无意被改）', () => {
        const ids = CONTRACTS.map((c) => c.id);
        expect(ids).toEqual(expect.arrayContaining([
            'clearRate-vs-boardFill',
            'frustration-vs-momentum',
            'stress-equals-sum-breakdown',
            'stress-is-clamped-rawStress',    // v1.62.6 新增
            'flowAdjust-tracks-flowDeviation',
            'feedbackBias-leads-stress',
            'score-monotone-increasing',
            'boardFill-bounded-0-1',
            'session-arc-warm-to-cool',
            'skill-not-drift-too-fast',
            'spawn-intent-no-thrashing',     // v1.62.3 新增
            'feedback-loop-effective',        // v1.62.5 新增
        ]));
    });

    it('applicableContracts 跳过指标缺失的契约', () => {
        const empty = applicableContracts({});
        expect(empty.length).toBe(0);
        const onlyClear = applicableContracts({ clearRate: [0.1, 0.2], boardFill: [0.5, 0.4] });
        expect(onlyClear.map((c) => c.id)).toContain('clearRate-vs-boardFill');
        // 没有 stress 数据 → stress-equals-sum-breakdown 不适用
        expect(onlyClear.map((c) => c.id)).not.toContain('stress-equals-sum-breakdown');
        // 有 stress（即便没 stressBreakdown 字段）→ 契约会被纳入但 eval 内自处理"无数据"
        const withStress = applicableContracts({ stress: [0.3, 0.4] });
        expect(withStress.map((c) => c.id)).toContain('stress-equals-sum-breakdown');
    });

    it('clearRate-vs-boardFill: 反向数据 → 通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'clearRate-vs-boardFill');
        const r = c.eval({
            clearRate: [0.1, 0.4, 0.1, 0.5, 0.2],
            boardFill: [0.6, 0.3, 0.6, 0.2, 0.5],
        });
        expect(r.passed).toBe(true);
        expect(r.evidence).toBeGreaterThan(0);
    });

    it('clearRate-vs-boardFill: 同向数据 → 不通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'clearRate-vs-boardFill');
        const r = c.eval({
            clearRate: [0.1, 0.4, 0.6, 0.7, 0.8],
            boardFill: [0.2, 0.3, 0.4, 0.5, 0.6],
        });
        expect(r.passed).toBe(false);
        expect(r.evidence).toBeLessThan(0);
    });

    it('stress-equals-sum-breakdown: rawStress 与 Σ 一致 → 通过（v1.62.6）', () => {
        const c = CONTRACTS.find((x) => x.id === 'stress-equals-sum-breakdown');
        const N = 10;
        // v1.62.6：契约改对比 __rawStressSeries vs __stressBreakdownTotal
        // 真实 adaptiveSpawn 里 rawStress 是分量求和后的快照，两者应严格相等（浮点误差）
        const sum = new Array(N).fill(0).map((_, i) => 0.22 + i * 0.01);
        const r = c.eval({
            stress: new Array(N).fill(0.5),
            __rawStressSeries: sum.slice(),
            __stressBreakdownTotal: sum.slice(),
        });
        expect(r.passed).toBe(true);
        expect(r.evidence).toBeLessThan(0.01);
        expect(r.reason).toMatch(/rawStress vs Σ/);
    });

    it('stress-equals-sum-breakdown: rawStress 与 Σ 失配 → 不通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'stress-equals-sum-breakdown');
        const r = c.eval({
            stress: new Array(10).fill(0.5),
            __rawStressSeries: new Array(10).fill(0.1),
            __stressBreakdownTotal: new Array(10).fill(5.0),
        });
        expect(r.passed).toBe(false);
        expect(r.evidence).toBeGreaterThan(1.0);
    });

    it('stress-equals-sum-breakdown: 无 rawStress / Σ → 跳过判定', () => {
        const c = CONTRACTS.find((x) => x.id === 'stress-equals-sum-breakdown');
        const r = c.eval({ stress: new Array(10).fill(0.5) });
        expect(r.passed).toBe(true);
        expect(r.reason).toMatch(/无 stressBreakdown.*rawStress/);
    });

    it('stress-is-clamped-rawStress: rawStress∈[0,1] 时 stress 应贴近 rawStress → 通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'stress-is-clamped-rawStress');
        const raw = [0.1, 0.3, 0.5, 0.7, 0.9, 0.2, 0.4, 0.6, 0.8, 0.5];
        const r = c.eval({ stress: raw.slice(), __rawStressSeries: raw.slice() });
        expect(r.passed).toBe(true);
        expect(r.evidence).toBeLessThan(0.05);
    });

    it('stress-is-clamped-rawStress: rawStress>1 时 stress=1 → 通过（clamp 行为）', () => {
        const c = CONTRACTS.find((x) => x.id === 'stress-is-clamped-rawStress');
        const raw = [1.5, 2.0, 1.2, 1.8, 5.0, 1.1, 1.3, 1.4, 1.6, 1.9];   // rawStress 远超 1
        const stress = new Array(10).fill(1.0);                            // 顶层 stress 被 clamp 到 1
        const r = c.eval({ stress, __rawStressSeries: raw });
        expect(r.passed).toBe(true);
        expect(r.evidence).toBeLessThan(0.30);
    });

    it('stress-is-clamped-rawStress: stress 越界 [0,1] → 不通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'stress-is-clamped-rawStress');
        const r = c.eval({
            stress: new Array(10).fill(1.5),    // 越界
            __rawStressSeries: new Array(10).fill(0.5),
        });
        expect(r.passed).toBe(false);
        expect(r.evidence).toBeGreaterThan(0.5);
    });

    /* ============================================================
     * v1.62.3 新增：session-arc 豁免 + spawn-intent-no-thrashing
     * ============================================================ */

    it('session-arc-warm-to-cool: 长 session（≥150 帧）→ 豁免判定', () => {
        const c = CONTRACTS.find((x) => x.id === 'session-arc-warm-to-cool');
        const N = 200;
        const xs = new Array(N).fill(0).map((_, i) => -0.05 - 0.001 * i); // 全程负向，正常会判失败
        const r = c.eval({
            sessionArcAdjust: xs,
            __sessionLength: [N],
            __sustainedReliefRatio: [0],
        });
        expect(r.passed).toBe(true);
        expect(r.reason).toContain('长 session');
        expect(r.details?.exempted).toBe('long-session');
    });

    it('session-arc-warm-to-cool: 持续救济期 ≥30% → 豁免判定', () => {
        const c = CONTRACTS.find((x) => x.id === 'session-arc-warm-to-cool');
        const N = 50;
        const xs = new Array(N).fill(0).map((_, i) => -0.04 - 0.001 * i); // 全负，正常会失败
        const r = c.eval({
            sessionArcAdjust: xs,
            __sessionLength: [N],
            __sustainedReliefRatio: [0.45],   // 45% 帧在救济期
        });
        expect(r.passed).toBe(true);
        expect(r.reason).toContain('救济');
        expect(r.details?.exempted).toBe('sustained-relief');
    });

    it('session-arc-warm-to-cool: 短 session + 无救济 + 非半圆弧 → 仍然判失败', () => {
        const c = CONTRACTS.find((x) => x.id === 'session-arc-warm-to-cool');
        const N = 30;
        const xs = new Array(N).fill(0).map((_, i) => -0.04 - 0.001 * i);
        const r = c.eval({
            sessionArcAdjust: xs,
            __sessionLength: [N],
            __sustainedReliefRatio: [0.10],
        });
        expect(r.passed).toBe(false);  // peak 不高于两端
    });

    it('session-arc-warm-to-cool: 短 session + 标准半圆弧 → 通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'session-arc-warm-to-cool');
        // 30 帧：early 段负、peak 段正、late 段略负
        const xs = [];
        for (let i = 0; i < 10; i++) xs.push(-0.04);
        for (let i = 0; i < 10; i++) xs.push(0.06);
        for (let i = 0; i < 10; i++) xs.push(-0.02);
        const r = c.eval({
            sessionArcAdjust: xs,
            __sessionLength: [30],
            __sustainedReliefRatio: [0],
        });
        expect(r.passed).toBe(true);
    });

    it('spawn-intent-no-thrashing: 切换率 ≤10% → 通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'spawn-intent-no-thrashing');
        // 50 帧，前 25 帧 flow、后 25 帧 pressure → 1 次切换 / 50 = 2%
        const series = [...new Array(25).fill('flow'), ...new Array(25).fill('pressure')];
        const r = c.eval({ stress: new Array(50).fill(0.4), __spawnIntentSeries: series });
        expect(r.passed).toBe(true);
        expect(r.reason).toMatch(/1 次/);
    });

    it('spawn-intent-no-thrashing: 切换率 >10% → 不通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'spawn-intent-no-thrashing');
        // 30 帧，每 2 帧切一次 → ~50% 切换率
        const series = [];
        for (let i = 0; i < 30; i++) series.push(i % 2 === 0 ? 'flow' : 'pressure');
        const r = c.eval({ stress: new Array(30).fill(0.4), __spawnIntentSeries: series });
        expect(r.passed).toBe(false);
        expect(r.evidence).toBeGreaterThan(0.1);
    });

    it('spawn-intent-no-thrashing: 全 null intent → 跳过判定', () => {
        const c = CONTRACTS.find((x) => x.id === 'spawn-intent-no-thrashing');
        const r = c.eval({
            stress: new Array(20).fill(0.4),
            __spawnIntentSeries: new Array(20).fill(null),
        });
        expect(r.passed).toBe(true);
        expect(r.reason).toMatch(/不足/);
    });

    /* ============================================================
     * v1.62.5 新增：metricRelationships + profileMeta + feedback-loop
     * ============================================================ */

    it('metricRelationships: skill ↔ historicalSkill 被标为豁免', async () => {
        const { isRedundantPairExempt, findRelationship } =
            await import('../web/src/audit/metricRelationships.js');
        expect(isRedundantPairExempt('skill', 'historicalSkill')).toBe(true);
        expect(isRedundantPairExempt('historicalSkill', 'skill')).toBe(true);  // 顺序无关
        const rel = findRelationship('skill', 'historicalSkill');
        expect(rel?.relation).toBe('fusion');
    });

    it('metricRelationships: 未登记的对应返回 null/false', async () => {
        const { isRedundantPairExempt, findRelationship } =
            await import('../web/src/audit/metricRelationships.js');
        expect(isRedundantPairExempt('foo', 'bar')).toBe(false);
        expect(findRelationship('foo', 'bar')).toBeNull();
    });

    it('summarizeOptimizationActions: 豁免对不计入 REDUNDANT_METRIC_PAIRS', () => {
        const agg = {
            sessionsCount: 10,
            redundantPairTop: [
                // skill ↔ historicalSkill 已被 metricRelationships 豁免 → 不应触发 action
                { a: 'skill', b: 'historicalSkill', count: 8, avgPearson: 0.97 },
            ],
            contractStats: [], hintCounts: [], stressDominatorCounts: [],
            healthScore: null,
        };
        const actions = summarizeOptimizationActions(agg);
        const dup = actions.find((a) => a.code === 'REDUNDANT_METRIC_PAIRS');
        expect(dup).toBeUndefined();
    });

    it('summarizeOptimizationActions: 真冗余 + 豁免对混合 → 只为真冗余建 action 并提示豁免数', () => {
        const agg = {
            sessionsCount: 10,
            redundantPairTop: [
                { a: 'skill', b: 'historicalSkill', count: 8, avgPearson: 0.97 },  // 豁免
                { a: 'foo', b: 'bar', count: 5, avgPearson: 0.96 },                // 真冗余
            ],
            contractStats: [], hintCounts: [], stressDominatorCounts: [],
            healthScore: null,
        };
        const actions = summarizeOptimizationActions(agg);
        const dup = actions.find((a) => a.code === 'REDUNDANT_METRIC_PAIRS');
        expect(dup).toBeDefined();
        expect(dup.evidence).toContain('foo ↔ bar');
        expect(dup.evidence).toContain('1 对在 metricRelationships 标记为"预期相关"已豁免');
    });

    it('feedback-loop-effective: 样本不足 → 跳过判定', () => {
        const c = CONTRACTS.find((x) => x.id === 'feedback-loop-effective');
        const r = c.eval({
            clearRate: new Array(10).fill(0.5),
            __spawnIntentSeries: new Array(10).fill('flow'),
        });
        expect(r.passed).toBe(true);
        expect(r.reason).toMatch(/不足/);
    });

    it('feedback-loop-effective: relief 切换后 clearRate 上升 ≥ 50% → 通过（v1.62.6 窗口 10/阈值 0.02）', () => {
        const c = CONTRACTS.find((x) => x.id === 'feedback-loop-effective');
        const N = 80;
        const intents = new Array(N).fill('flow');
        const clears = new Array(N).fill(0);
        // 在 idx 15, 35, 55 切到 relief，让切换后 10 帧 clearRate 显著上升
        for (const i of [15, 35, 55]) {
            intents[i] = 'relief';
            intents[i + 1] = 'relief';
            intents[i + 2] = 'relief';
            for (let j = i; j < i + 10; j++) clears[j] = 0.8;   // after window=10
            for (let j = i - 10; j < i; j++) clears[j] = 0.2;   // before window=10
        }
        const r = c.eval({ clearRate: clears, __spawnIntentSeries: intents });
        expect(r.passed).toBe(true);
        expect(r.evidence).toBeGreaterThan(0.5);
    });

    it('feedback-loop-effective: relief 切换后 clearRate 不变 → 不通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'feedback-loop-effective');
        const N = 80;
        const intents = new Array(N).fill('flow');
        const clears = new Array(N).fill(0.5);   // 始终 0.5，relief 无效
        for (const i of [15, 35, 55]) {
            intents[i] = 'relief';
            intents[i + 1] = 'relief';
        }
        const r = c.eval({ clearRate: clears, __spawnIntentSeries: intents });
        expect(r.passed).toBe(false);
    });

    it('frustration-vs-momentum: reason 用 toFixed(3) 避免显示 0.10 实际未通过的歧义', () => {
        const c = CONTRACTS.find((x) => x.id === 'frustration-vs-momentum');
        // 构造完全反向数据 → oppositeRate=1.0；主要验证 reason 文案精度
        const r = c.eval({
            frustration: [0, 1, 2, 3, 4, 5, 6, 7],
            momentum:    [0.5, 0.4, 0.3, 0.2, 0.1, 0.0, -0.1, -0.2],
        });
        expect(r.passed).toBe(true);
        expect(r.reason).toMatch(/\.\d{3}/);          // 3 位小数精度
        expect(r.reason).toMatch(/通过/);
        // 显式区分"通过"/"未通过"
        const rFail = c.eval({
            frustration: [0, 1, 2, 3, 4, 5, 6, 7],
            momentum:    [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8], // 同向
        });
        expect(rFail.passed).toBe(false);
        expect(rFail.reason).toMatch(/未通过/);
    });

    it('score-monotone-increasing: 单调递增 → 通过；任何下降 → 不通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'score-monotone-increasing');
        expect(c.eval({ score: [0, 10, 20, 30] }).passed).toBe(true);
        expect(c.eval({ score: [0, 10, 5, 30] }).passed).toBe(false);
    });

    it('boardFill-bounded-0-1: 越界 → 不通过', () => {
        const c = CONTRACTS.find((x) => x.id === 'boardFill-bounded-0-1');
        expect(c.eval({ boardFill: [0.1, 0.5, 0.8] }).passed).toBe(true);
        expect(c.eval({ boardFill: [0.1, 1.2, 0.8] }).passed).toBe(false);
    });
});

/* ============================================================
 * 3) Hints
 * ============================================================ */
describe('profileAuditHints', () => {
    it('低覆盖率 → COVERAGE_TOO_LOW (error)', () => {
        const hints = buildHints({
            metrics: { clearRate: { coverage: 0.05, count: 5, stats: { stddev: 0.1 }, jitter: {} } },
        });
        const h = hints.find((x) => x.code === 'COVERAGE_TOO_LOW');
        expect(h).toBeDefined();
        expect(h.severity).toBe('error');
        expect(h.metrics).toContain('clearRate');
    });

    it('中等覆盖率 → COVERAGE_LOW (warn)', () => {
        const hints = buildHints({
            metrics: { clearRate: { coverage: 0.2, count: 20, stats: { stddev: 0.1 }, jitter: {} } },
        });
        const h = hints.find((x) => x.code === 'COVERAGE_LOW');
        expect(h?.severity).toBe('warn');
    });

    it('强相关指标对 → REDUNDANT_PAIR', () => {
        const hints = buildHints({
            metrics: {},
            pairs: [{ a: 'skill', b: 'historicalSkill', pearson: 0.99, n: 50 }],
        });
        const h = hints.find((x) => x.code === 'REDUNDANT_PAIR');
        expect(h).toBeDefined();
        expect(h.metrics).toEqual(['skill', 'historicalSkill']);
    });

    it('契约失败 → CONTRACT_VIOLATION (error)', () => {
        const hints = buildHints({
            contracts: [{
                id: 'clearRate-vs-boardFill',
                desc: '消行率上升时板面应下降',
                metrics: ['clearRate', 'boardFill'],
                passed: false,
                evidence: -0.3,
                reason: '反向步占比 -0.30',
            }],
        });
        const h = hints.find((x) => x.code === 'CONTRACT_VIOLATION');
        expect(h?.severity).toBe('error');
        expect(h.contract).toBe('clearRate-vs-boardFill');
    });

    it('stress 单一分量主导 → STRESS_SINGLE_DOMINATOR', () => {
        const hints = buildHints({
            metrics: {},
            linkages: {
                stressDominator: { key: 'difficultyBias', shareOfAbs: 0.95 },
            },
        });
        const h = hints.find((x) => x.code === 'STRESS_SINGLE_DOMINATOR');
        expect(h?.severity).toBe('warn');
    });

    it('hints 按严重度稳定排序：error > warn > info', () => {
        const hints = buildHints({
            metrics: { x: { coverage: 0.2, count: 20, stats: { stddev: 1 }, jitter: {} } }, // warn
            pairs: [{ a: 'x', b: 'y', pearson: 0.99 }],                                      // warn
            contracts: [{ id: 'c1', desc: 'd', metrics: ['x'], passed: false, reason: 'r' }], // error
            linkages: {},
        });
        const sevs = hints.map((h) => h.severity);
        const errs = sevs.filter((s) => s === 'error').length;
        // 第一条一定是 error
        expect(sevs[0]).toBe('error');
        expect(errs).toBeGreaterThan(0);
    });

    it('summarizeHealthScore: error 比 warn 扣更多', () => {
        const scoreErr = summarizeHealthScore([{ severity: 'error' }]);
        const scoreWarn = summarizeHealthScore([{ severity: 'warn' }]);
        const scoreInfo = summarizeHealthScore([{ severity: 'info' }]);
        expect(scoreErr).toBeLessThan(scoreWarn);
        expect(scoreWarn).toBeLessThan(scoreInfo);
        expect(scoreErr).toBe(88);
        expect(scoreWarn).toBe(96);
        expect(scoreInfo).toBe(99);
    });

    it('summarizeHealthScore: 大量扣分有下限 0', () => {
        const many = new Array(50).fill({ severity: 'error' });
        expect(summarizeHealthScore(many)).toBe(0);
    });
});

/* ============================================================
 * 4) 主入口 auditProfile 端到端
 * ============================================================ */
describe('auditProfile — 端到端', () => {
    function _buildSamplePs(overrides = {}) {
        return {
            pv: 2,
            phase: 'place',
            score: 100,
            boardFill: 0.3,
            skill: 0.6,
            momentum: 0.1,
            flowDeviation: 0.2,
            flowState: 'flow',
            frustration: 0,
            cognitiveLoad: 0.3,
            /* 与 buildPlayerStateSnapshot 一致：feedbackBias 写顶层（不在 adaptive 下） */
            feedbackBias: 0.01,
            metrics: {
                samples: 5,
                activeSamples: 5,
                thinkMs: 1500,
                pickToPlaceMs: 1200,
                reactionSamples: 5,
                clearRate: 0.5,
                comboRate: 0.2,
                missRate: 0.05,
            },
            spawnGeo: {
                holes: 1,
                flatness: 0.7,
                firstMoveFreedom: 12,
                solutionCount: 30,
            },
            adaptive: {
                stress: 0.45,
                flowDeviation: 0.2,
                spawnHints: { spawnIntent: 'flow' },
                stressBreakdown: {
                    difficultyBias: 0.20,
                    flowAdjust: 0.10,
                    reactionAdjust: 0.05,
                    pacingAdjust: 0.05,
                    friendlyBoardRelief: -0.02,
                    sessionArcAdjust: 0.04,
                    challengeBoost: 0.03,
                },
            },
            ...overrides,
        };
    }

    function _healthyFrames() {
        const grid = new Grid(8);
        const frames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
        let score = 0;
        for (let i = 0; i < 30; i++) {
            const ts = (i + 1) * 1500;
            const cleared = i % 3 === 0 ? 1 : 0;
            score += cleared ? 20 : 5;
            const ps = _buildSamplePs({
                score,
                boardFill: 0.3 + 0.005 * i - (cleared ? 0.05 : 0),
                feedbackBias: 0.01 + (i % 5) * 0.002,
                metrics: {
                    samples: 5 + i, activeSamples: 5 + i,
                    thinkMs: 1500 + (i % 4) * 100,
                    pickToPlaceMs: 1100 + (i % 5) * 50,
                    reactionSamples: 5 + i,
                    clearRate: 0.4 + (cleared ? 0.1 : -0.05),
                    comboRate: 0.2, missRate: 0.05,
                },
            });
            frames.push(buildSpawnFrame([], ps, { ts: ts - 50 }));
            frames.push(buildPlaceFrame(0, i % 8, i % 8, ps, { ts }));
        }
        return frames;
    }

    it('auditProfile 返回结构稳定 + schema 标签', () => {
        const report = auditProfile(_healthyFrames());
        expect(report.schema).toBe(PROFILE_AUDIT_SCHEMA);
        expect(report.metrics).toBeDefined();
        expect(report.pairs).toBeDefined();
        expect(report.contracts).toBeDefined();
        expect(report.linkages).toBeDefined();
        expect(report.summary).toBeDefined();
        expect(Array.isArray(report.hints)).toBe(true);
        expect(typeof report.healthScore).toBe('number');
    });

    it('健康对局：契约通过率高、healthScore 不低', () => {
        const report = auditProfile(_healthyFrames());
        const total = report.summary.passedContracts + report.summary.failedContracts;
        expect(total).toBeGreaterThan(0);
        // 大部分契约应当通过
        expect(report.summary.passedContracts).toBeGreaterThan(report.summary.failedContracts);
        // healthScore 不应被大量扣穿
        expect(report.healthScore).toBeGreaterThan(60);
    });

    it('boardFill 越界 → 触发 OUT_OF_RANGE error hint + 契约失败', () => {
        const grid = new Grid(8);
        const psBad = _buildSamplePs({ boardFill: 1.5 });
        const frames = [
            buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 }),
        ];
        for (let i = 0; i < 10; i++) {
            frames.push(buildPlaceFrame(0, 0, 0, psBad, { ts: (i + 1) * 1000 }));
        }
        const report = auditProfile(frames);
        const oor = report.hints.find((h) => h.code === 'OUT_OF_RANGE' && h.metrics?.[0] === 'boardFill');
        expect(oor).toBeDefined();
        const contractFail = report.contracts.find((c) => c.id === 'boardFill-bounded-0-1');
        expect(contractFail?.passed).toBe(false);
    });

    it('score 出现回退 → score-monotone-increasing 契约失败', () => {
        const grid = new Grid(8);
        const frames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ score: 0, phase: 'init' }), { ts: 0 })];
        const scores = [10, 20, 30, 25, 40]; // 第四步回退
        for (let i = 0; i < scores.length; i++) {
            frames.push(buildPlaceFrame(0, 0, 0, _buildSamplePs({ score: scores[i] }), { ts: (i + 1) * 1000 }));
        }
        const report = auditProfile(frames);
        const c = report.contracts.find((x) => x.id === 'score-monotone-increasing');
        expect(c?.passed).toBe(false);
        const h = report.hints.find((x) => x.contract === 'score-monotone-increasing');
        expect(h?.severity).toBe('error');
    });

    it('多局聚合：传入 [{frames},{frames}] 等价于单局 audit 拼接', () => {
        const a = _healthyFrames();
        const b = _healthyFrames();
        const reportSingle = auditProfile([...a, ...b]);
        const reportMulti = auditProfile([{ frames: a }, { frames: b }]);
        // sessions 数不同；但帧总数和指标 coverage 应该一致
        expect(reportMulti.summary.sessionsCount).toBe(2);
        expect(reportSingle.summary.sessionsCount).toBe(1);
        expect(reportMulti.summary.totalFrames).toBe(reportSingle.summary.totalFrames);
    });

    it('空输入 / null 不抛错，返回最小报告', () => {
        const r1 = auditProfile([]);
        expect(r1.summary.totalFrames).toBe(0);
        expect(r1.contracts.length).toBe(0);
        const r2 = auditProfile(null);
        expect(r2.summary.totalFrames).toBe(0);
    });

    it('auditProfile: linkages.profileMeta 计算 intentStability / stressBalance / signalConsistency', () => {
        const report = auditProfile(_healthyFrames());
        const meta = report.linkages?.profileMeta;
        expect(meta).toBeDefined();
        expect(meta.intentStability).toBeGreaterThanOrEqual(0);
        expect(meta.intentStability).toBeLessThanOrEqual(1);
        expect(meta.signalConsistency).toBeGreaterThanOrEqual(0);
        expect(meta.signalConsistency).toBeLessThanOrEqual(1);
        expect(meta.stressBalance).not.toBeNull();
    });

    it('auditProfile: 报告自带 engineVersion 字段', () => {
        const report = auditProfile(_healthyFrames());
        expect(report.engineVersion).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('stress-equals-sum-breakdown（端到端）: rawStress = Σ(全字段) → 自动通过（v1.62.8）', () => {
        const grid = new Grid(8);
        /* v1.62.8：用 ALLOWLIST 内的 stress 分量构造合成 stressBreakdown。
         * lifecycleStressAdjust / challengeBoost 是"后置 adjust"，不参与 rawStress 求和。
         * 故意混入 beforeClamp/afterClamp/lifecycleStage 等"诊断字段"，验证 ALLOWLIST
         * 能正确忽略它们而不破坏求和。 */
        const _withBigBreakdown = (i) => {
            const br = {
                difficultyBias: 0.20,
                flowAdjust: 0.05,
                reactionAdjust: 0.01,
                pacingAdjust: i % 2 === 0 ? -0.12 : 0.04,
                friendlyBoardRelief: -0.02,
                sessionArcAdjust: -0.04 + (i / 30) * 0.10,
                recoveryAdjust: i % 5 === 0 ? -0.20 : 0,
                frustrationRelief: i % 7 === 0 ? -0.15 : 0,
                nearMissAdjust: i % 4 === 0 ? -0.05 : 0,
                boardRiskReliefAdjust: -0.01,
                comboAdjust: i % 3 === 0 ? 0.05 : 0,
                trendAdjust: 0,
                endSessionDistress: 0,
            };
            const sumAll = Object.values(br).reduce((s, v) => s + v, 0);
            br.rawStress = sumAll;
            // v1.62.8：模拟 adaptiveSpawn 之后写入的诊断字段（ALLOWLIST 应该忽略它们）
            br.lifecycleCapAdjust = 0.05;
            br.lifecycleBandAdjust = -0.02;
            br.beforeClamp = sumAll;       // stress 中间快照 — 之前 BLOCKLIST 漏掉
            br.afterClamp = Math.max(0, Math.min(1, sumAll));
            br.afterSmoothing = br.afterClamp;
            br.occupancyDamping = 0.85;
            br.lifecycleStage = 'S2';      // 字符串
            br.lifecycleBand = 'M1';
            return { br, stress: br.afterClamp };
        };
        const frames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
        for (let i = 0; i < 20; i++) {
            const { br, stress } = _withBigBreakdown(i);
            const ps = _buildSamplePs({
                score: 10 + i * 5,
                adaptive: {
                    stress, flowDeviation: 0.2,
                    spawnHints: { spawnIntent: 'flow' },
                    stressBreakdown: br,
                },
            });
            frames.push(buildPlaceFrame(0, 0, 0, ps, { ts: (i + 1) * 1000 }));
        }
        const report = auditProfile(frames);
        const c = report.contracts.find((x) => x.id === 'stress-equals-sum-breakdown');
        expect(c).toBeDefined();
        expect(c.passed).toBe(true);     // v1.62.6：rawStress 等于 Σ，残差应近 0
        expect(c.evidence).toBeLessThan(0.01);
    });

    it('pacingAdjust ±0.12 (release 期默认值) 不再触发 OUT_OF_RANGE', () => {
        const grid = new Grid(8);
        const frames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
        for (let i = 0; i < 20; i++) {
            const ps = _buildSamplePs({
                score: 10 + i * 5,
                adaptive: {
                    stress: 0.3,
                    spawnHints: { spawnIntent: 'flow' },
                    stressBreakdown: {
                        difficultyBias: 0.2,
                        // adaptiveSpawn 真实 release 期默认 -0.12，旧 audit range±0.10 会判为越界
                        pacingAdjust: -0.12,
                        flowAdjust: 0, reactionAdjust: 0,
                        friendlyBoardRelief: 0, sessionArcAdjust: 0, challengeBoost: 0,
                    },
                },
            });
            frames.push(buildPlaceFrame(0, 0, 0, ps, { ts: (i + 1) * 1000 }));
        }
        const report = auditProfile(frames);
        const oor = report.hints.find((h) => h.code === 'OUT_OF_RANGE' && h.metrics?.[0] === 'pacingAdjust');
        expect(oor).toBeUndefined();     // 放宽后不再触发越界 hint
    });

    it('stressDominator: 当某一分量绝对值占比超 90% 时触发 STRESS_SINGLE_DOMINATOR', () => {
        const grid = new Grid(8);
        const frames = [buildInitFrame('normal', grid, scoring, undefined, { ts: 0 })];
        for (let i = 0; i < 10; i++) {
            const ps = _buildSamplePs({
                adaptive: {
                    stress: 0.5,
                    stressBreakdown: {
                        // 0.60 / (0.60 + 0.005×6 = 0.03) ≈ 95% 单一支配
                        difficultyBias: 0.60,
                        flowAdjust: 0.005,
                        reactionAdjust: 0.005,
                        pacingAdjust: 0.005,
                        friendlyBoardRelief: -0.005,
                        sessionArcAdjust: 0.005,
                        challengeBoost: 0.005,
                    },
                    spawnHints: { spawnIntent: 'flow' },
                },
            });
            frames.push(buildPlaceFrame(0, 0, 0, ps, { ts: (i + 1) * 1000 }));
        }
        const report = auditProfile(frames);
        expect(report.linkages.stressDominator.key).toBe('difficultyBias');
        expect(report.linkages.stressDominator.shareOfAbs).toBeGreaterThan(0.9);
        const h = report.hints.find((x) => x.code === 'STRESS_SINGLE_DOMINATOR');
        expect(h).toBeDefined();
        expect(h.severity).toBe('warn');
    });

    it('baseline 对照：契约从通过变失败 → REGRESSION_CONTRACT error hint', () => {
        const grid = new Grid(8);
        // baseline: 健康 frames（所有契约应通过）
        const baselineFrames = _healthyFrames();
        // current: 把 score 改成回退（破坏 score-monotone-increasing 契约）
        const currentFrames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
        const scores = [10, 20, 30, 25, 40, 50, 60, 70, 80];
        for (let i = 0; i < scores.length; i++) {
            currentFrames.push(buildPlaceFrame(0, 0, 0, _buildSamplePs({ score: scores[i] }), { ts: (i + 1) * 1000 }));
        }
        const report = auditProfile(currentFrames, { baseline: baselineFrames });
        expect(report.comparison).toBeDefined();
        expect(report.baselineHealthScore).toBeGreaterThan(0);
        const regress = report.hints.find((h) => h.code === 'REGRESSION_CONTRACT' && h.contract === 'score-monotone-increasing');
        expect(regress).toBeDefined();
        expect(regress.severity).toBe('error');
        // comparison.contracts 里 score-monotone 应当 regressed=true
        const cMonotone = report.comparison.contracts.find((c) => c.id === 'score-monotone-increasing');
        expect(cMonotone?.regressed).toBe(true);
        expect(cMonotone?.improved).toBe(false);
    });

    it('baseline 对照：契约从失败变通过 → IMPROVEMENT_CONTRACT info hint', () => {
        const grid = new Grid(8);
        // baseline: score 回退 → 契约失败
        const baselineFrames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
        const badScores = [10, 20, 30, 25, 40];
        for (let i = 0; i < badScores.length; i++) {
            baselineFrames.push(buildPlaceFrame(0, 0, 0, _buildSamplePs({ score: badScores[i] }), { ts: (i + 1) * 1000 }));
        }
        // current: 修复后单调
        const currentFrames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
        const goodScores = [10, 20, 30, 40, 50];
        for (let i = 0; i < goodScores.length; i++) {
            currentFrames.push(buildPlaceFrame(0, 0, 0, _buildSamplePs({ score: goodScores[i] }), { ts: (i + 1) * 1000 }));
        }
        const report = auditProfile(currentFrames, { baseline: baselineFrames });
        const improvement = report.hints.find((h) => h.code === 'IMPROVEMENT_CONTRACT' && h.contract === 'score-monotone-increasing');
        expect(improvement).toBeDefined();
        expect(improvement.severity).toBe('info');
        const cMonotone = report.comparison.contracts.find((c) => c.id === 'score-monotone-increasing');
        expect(cMonotone?.improved).toBe(true);
        expect(cMonotone?.regressed).toBe(false);
    });

    it('baseline 对照：覆盖率显著下降 → COVERAGE_REGRESSION warn hint', () => {
        const grid = new Grid(8);
        // baseline: 健康 frames（pickToPlaceMs coverage ≈ 1.0）
        const baselineFrames = _healthyFrames();
        // current: pickToPlaceMs 全 null → coverage 0
        const currentFrames = [buildInitFrame('normal', grid, scoring,
            _buildSamplePs({ phase: 'init', score: 0, metrics: { samples: 0, activeSamples: 0, thinkMs: null, pickToPlaceMs: null, reactionSamples: 0, clearRate: null, missRate: null, comboRate: null } }),
            { ts: 0 })];
        for (let i = 0; i < 30; i++) {
            const ps = _buildSamplePs({
                score: 100 + i * 5,
                metrics: { samples: 5 + i, activeSamples: 5 + i, thinkMs: 1500, pickToPlaceMs: null, reactionSamples: 0, clearRate: 0.5, missRate: 0.05, comboRate: 0.2 },
            });
            currentFrames.push(buildPlaceFrame(0, 0, 0, ps, { ts: (i + 1) * 1000 }));
        }
        const report = auditProfile(currentFrames, { baseline: baselineFrames });
        const covReg = report.hints.find((h) => h.code === 'COVERAGE_REGRESSION' && h.metrics?.includes('pickToPlaceMs'));
        expect(covReg).toBeDefined();
        expect(covReg.severity).toBe('warn');
    });

    it('baseline 对照：健康分大幅下降 → HEALTH_SCORE_REGRESSION error hint', () => {
        const grid = new Grid(8);
        const baselineFrames = _healthyFrames();
        // current: 短样本 + 多项越界，健康分会暴跌
        const currentFrames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
        for (let i = 0; i < 5; i++) {
            currentFrames.push(buildPlaceFrame(0, 0, 0, _buildSamplePs({ boardFill: 1.5, score: -1 }), { ts: (i + 1) * 1000 }));
        }
        const report = auditProfile(currentFrames, { baseline: baselineFrames });
        expect(report.comparison.healthScoreDelta).toBeLessThan(-10);
        const hsReg = report.hints.find((h) => h.code === 'HEALTH_SCORE_REGRESSION');
        expect(hsReg).toBeDefined();
        expect(hsReg.severity).toBe('error');
    });

    it('baseline 对照：stress 主导分量切换 → STRESS_DOMINATOR_CHANGED info hint', () => {
        const grid = new Grid(8);
        const _withDominator = (key, amount) => {
            const frames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
            for (let i = 0; i < 10; i++) {
                const breakdown = {
                    difficultyBias: 0, flowAdjust: 0, reactionAdjust: 0,
                    pacingAdjust: 0, friendlyBoardRelief: 0, sessionArcAdjust: 0, challengeBoost: 0,
                };
                breakdown[key] = amount;
                const ps = _buildSamplePs({
                    score: 10 + i * 5,
                    adaptive: {
                        stress: amount + 0.1,
                        spawnHints: { spawnIntent: 'flow' },
                        stressBreakdown: breakdown,
                    },
                });
                frames.push(buildPlaceFrame(0, 0, 0, ps, { ts: (i + 1) * 1000 }));
            }
            return frames;
        };
        const baselineFrames = _withDominator('difficultyBias', 0.5);
        const currentFrames = _withDominator('flowAdjust', 0.5);
        const report = auditProfile(currentFrames, { baseline: baselineFrames });
        expect(report.comparison.linkages.stressDominatorChanged).toBe(true);
        const h = report.hints.find((x) => x.code === 'STRESS_DOMINATOR_CHANGED');
        expect(h).toBeDefined();
        expect(h.severity).toBe('info');
    });

    it('baseline 对照：comparison 字段结构稳定', () => {
        const a = _healthyFrames();
        const b = _healthyFrames();
        const report = auditProfile(a, { baseline: b });
        expect(report.comparison.healthScoreDelta).toBeDefined();
        expect(Array.isArray(report.comparison.contracts)).toBe(true);
        expect(report.comparison.coverage).toBeDefined();
        expect(report.comparison.linkages).toBeDefined();
        expect(report.comparison.baselineSummary).toBeDefined();
        expect(typeof report.baselineHealthScore).toBe('number');
        // 健康对局 vs 健康对局 → 没有 regression/improvement
        const regress = report.hints.find((h) => h.code === 'REGRESSION_CONTRACT');
        expect(regress).toBeUndefined();
    });

    it('aggregateAuditReports 空入参 → 最小骨架', () => {
        const r = aggregateAuditReports([]);
        expect(r.sessionsCount).toBe(0);
        expect(r.framesTotal).toBe(0);
        expect(r.healthScore).toBeNull();
        expect(r.contractStats).toEqual([]);
        expect(r.hintCounts).toEqual([]);
    });

    it('aggregateAuditReports: 聚合多局，按违规率排序契约', () => {
        const grid = new Grid(8);
        // 3 局都让 score 回退 → score-monotone 违规
        const buildBadScore = () => {
            const frames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
            const scores = [10, 20, 5, 30, 40]; // 回退
            for (let i = 0; i < scores.length; i++) {
                frames.push(buildPlaceFrame(0, 0, 0, _buildSamplePs({ score: scores[i] }), { ts: (i + 1) * 1000 }));
            }
            return frames;
        };
        const reports = [
            auditProfile(buildBadScore()),
            auditProfile(buildBadScore()),
            auditProfile(buildBadScore()),
            auditProfile(_healthyFrames()), // 健康对局，score-monotone 通过
        ];
        const agg = aggregateAuditReports(reports);
        expect(agg.sessionsCount).toBe(4);
        expect(agg.framesTotal).toBeGreaterThan(0);
        expect(agg.healthScore).not.toBeNull();
        expect(agg.healthScore.count).toBe(4);

        const monotone = agg.contractStats.find((c) => c.id === 'score-monotone-increasing');
        expect(monotone).toBeDefined();
        expect(monotone.appeared).toBe(4);
        expect(monotone.failed).toBe(3);
        expect(monotone.violationRate).toBe(0.75);
        // topRegressions 包含违规率 ≥ 25% 的契约
        expect(agg.topRegressions.find((c) => c.id === 'score-monotone-increasing')).toBeDefined();
    });

    it('aggregateAuditReports: hintCounts 按 severity × count 排序，error 优先', () => {
        const grid = new Grid(8);
        const buildBoardFillBad = () => {
            const frames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
            for (let i = 0; i < 6; i++) {
                frames.push(buildPlaceFrame(0, 0, 0, _buildSamplePs({ boardFill: 1.5 }), { ts: (i + 1) * 1000 }));
            }
            return frames;
        };
        const reports = [auditProfile(buildBoardFillBad()), auditProfile(buildBoardFillBad())];
        const agg = aggregateAuditReports(reports);
        // OUT_OF_RANGE 多次出现，应排在前面
        const oor = agg.hintCounts.find((h) => h.code === 'OUT_OF_RANGE');
        expect(oor).toBeDefined();
        expect(oor.count).toBeGreaterThanOrEqual(2);
        // 第一项一定是 error 严重度（不会被 info / warn 抢位）
        expect(agg.hintCounts[0].severity).toBe('error');
    });

    it('aggregateAuditReports: 接受 { sessionId, report } 结构', () => {
        const reports = [
            { sessionId: 1, report: auditProfile(_healthyFrames()) },
            { sessionId: 2, report: auditProfile(_healthyFrames()) },
        ];
        const agg = aggregateAuditReports(reports);
        expect(agg.sessionsCount).toBe(2);
    });

    it('summarizeOptimizationActions: 空 aggregate → 空数组', () => {
        expect(summarizeOptimizationActions(null)).toEqual([]);
        expect(summarizeOptimizationActions({ sessionsCount: 0 })).toEqual([]);
    });

    it('summarizeOptimizationActions: 契约高违规率 → 优先级 1-2 的 contract action', () => {
        const agg = {
            sessionsCount: 10,
            contractStats: [
                { id: 'score-monotone-increasing', desc: 'score 应单调', appeared: 10, failed: 9, violationRate: 0.9 },
                { id: 'stress-equals-sum-breakdown', desc: 'stress = Σ', appeared: 10, failed: 5, violationRate: 0.5 },
                { id: 'clearRate-vs-boardFill', desc: '反向', appeared: 10, failed: 1, violationRate: 0.1 }, // 太低不入
            ],
            hintCounts: [],
            healthScore: null,
            stressDominatorCounts: [],
        };
        const actions = summarizeOptimizationActions(agg);
        // 只有两条违规率 ≥ 25% 的契约入选
        const contractActions = actions.filter((a) => a.category === 'contract');
        expect(contractActions.length).toBe(2);
        // 违规率 90% → 优先级 1（最严重）
        const top = contractActions[0];
        expect(top.affected[0]).toBe('score-monotone-increasing');
        expect(top.priority).toBe(1);
        expect(top.suggestedActions.length).toBeGreaterThan(0);
        expect(top.rootCauseHints.length).toBeGreaterThan(0);
        // 50% 是优先级 2
        const second = contractActions[1];
        expect(second.affected[0]).toBe('stress-equals-sum-breakdown');
        expect(second.priority).toBe(2);
    });

    it('summarizeOptimizationActions: 多 hint 覆盖率系统性低 → METRIC_COVERAGE_SYSTEMIC', () => {
        const agg = {
            sessionsCount: 10,
            contractStats: [],
            hintCounts: [
                { code: 'COVERAGE_TOO_LOW', count: 4, severity: 'error' },
                { code: 'COVERAGE_LOW', count: 3, severity: 'warn' },
            ],
            healthScore: null,
            stressDominatorCounts: [],
        };
        const actions = summarizeOptimizationActions(agg);
        const cov = actions.find((a) => a.code === 'METRIC_COVERAGE_SYSTEMIC');
        expect(cov).toBeDefined();
        // 7/10 = 70% → 优先级 1
        expect(cov.priority).toBe(1);
        expect(cov.evidence).toContain('7/10');
        expect(cov.suggestedActions.length).toBeGreaterThan(0);
    });

    it('summarizeOptimizationActions: STRESS_SINGLE_DOMINATOR + INTENT_THRASHING → 复合 action', () => {
        const agg = {
            sessionsCount: 10,
            contractStats: [],
            hintCounts: [
                { code: 'STRESS_SINGLE_DOMINATOR', count: 6, severity: 'warn' },
                { code: 'INTENT_THRASHING', count: 5, severity: 'warn' },
            ],
            healthScore: null,
            stressDominatorCounts: [{ key: 'pacingAdjust', count: 8, share: 0.8 }],
        };
        const actions = summarizeOptimizationActions(agg);
        const insta = actions.find((a) => a.code === 'ADAPTIVE_OUTPUT_INSTABILITY');
        expect(insta).toBeDefined();
        // 60% / 50% 都 ≥ 50% → 优先级 1
        expect(insta.priority).toBe(1);
        expect(insta.affected).toContain('pacingAdjust');
        expect(insta.evidence).toContain('pacingAdjust');
    });

    it('summarizeOptimizationActions: 健康分中位数 < 60 → HEALTH_SCORE_OVERALL_LOW', () => {
        const agg = {
            sessionsCount: 10,
            contractStats: [],
            hintCounts: [],
            healthScore: { count: 10, min: 20, max: 80, mean: 45, p10: 25, p50: 45, p90: 75 },
            stressDominatorCounts: [],
        };
        const actions = summarizeOptimizationActions(agg);
        const meta = actions.find((a) => a.code === 'HEALTH_SCORE_OVERALL_LOW');
        expect(meta).toBeDefined();
        // p50=45 < 40 否定 → priority=2；改成 p50=30 验证 priority=1
        expect(meta.priority).toBe(2);
        const agg2 = { ...agg, healthScore: { ...agg.healthScore, p50: 30 } };
        const actions2 = summarizeOptimizationActions(agg2);
        expect(actions2.find((a) => a.code === 'HEALTH_SCORE_OVERALL_LOW').priority).toBe(1);
    });

    it('summarizeOptimizationActions: action 按优先级升序排序', () => {
        const agg = {
            sessionsCount: 10,
            contractStats: [
                // 优先级 4（低）
                { id: 'frustration-vs-momentum', desc: '反向', appeared: 10, failed: 3, violationRate: 0.3 },
                // 优先级 1（最高）
                { id: 'score-monotone-increasing', desc: 'score 应单调', appeared: 10, failed: 9, violationRate: 0.9 },
            ],
            hintCounts: [],
            healthScore: null,
            stressDominatorCounts: [],
        };
        const actions = summarizeOptimizationActions(agg);
        // 严重的 (priority=1) 应该排前面
        for (let i = 1; i < actions.length; i++) {
            expect(actions[i].priority).toBeGreaterThanOrEqual(actions[i - 1].priority);
        }
        expect(actions[0].affected[0]).toBe('score-monotone-increasing');
    });

    /* v1.62.4：engineVersion + redundantPairTop 聚合 */
    it('aggregateAuditReports: engineVersionStats 标记当前与过期版本分布', () => {
        const a1 = auditProfile(_healthyFrames());
        const a2 = auditProfile(_healthyFrames());
        // 模拟一份"旧版本报告"
        const old = { ...a2, engineVersion: '1.62.0' };
        const agg = aggregateAuditReports([a1, old]);
        expect(agg.engineVersionStats).toBeDefined();
        expect(agg.engineVersionStats.current).toMatch(/^\d/);
        expect(agg.engineVersionStats.mismatchCount).toBe(1);
        expect(agg.engineVersionStats.perVersion['1.62.0']).toBe(1);
    });

    it('aggregateAuditReports: redundantPairTop 按出现次数收集具体 pair', () => {
        const mkReport = (pair) => ({
            schema: 1, engineVersion: '1.62.4',
            healthScore: 80,
            summary: { totalFrames: 30, passedContracts: 8, failedContracts: 1 },
            contracts: [],
            linkages: {},
            hints: [
                { severity: 'warn', code: 'REDUNDANT_PAIR', metrics: pair, evidence: 0.98 },
            ],
        });
        const agg = aggregateAuditReports([
            mkReport(['skill', 'historicalSkill']),
            mkReport(['skill', 'historicalSkill']),
            mkReport(['stress', 'flowDeviation']),
        ]);
        expect(agg.redundantPairTop).toBeDefined();
        // (skill, historicalSkill) 出现 2 次排前面
        expect(agg.redundantPairTop[0]).toMatchObject({
            a: expect.any(String), b: expect.any(String), count: 2,
        });
        expect(new Set([agg.redundantPairTop[0].a, agg.redundantPairTop[0].b]))
            .toEqual(new Set(['skill', 'historicalSkill']));
        expect(agg.redundantPairTop[0].avgPearson).toBeCloseTo(0.98);
    });

    it('summarizeOptimizationActions: 旧版本报告残留 → STALE_AUDIT_REPORTS P1 action', () => {
        const agg = {
            sessionsCount: 6,
            engineVersionStats: { current: '1.62.4', mismatchCount: 3, perVersion: { '1.62.4': 3, '1.62.1': 3 } },
            contractStats: [], hintCounts: [], stressDominatorCounts: [],
            healthScore: null,
        };
        const actions = summarizeOptimizationActions(agg);
        const stale = actions.find((a) => a.code === 'STALE_AUDIT_REPORTS');
        expect(stale).toBeDefined();
        expect(stale.priority).toBe(1);
        expect(stale.evidence).toContain('1.62.1');
        expect(stale.suggestedActions[0]).toContain('强制重跑');
    });

    it('summarizeOptimizationActions: 高频冗余指标对（未豁免） → REDUNDANT_METRIC_PAIRS', () => {
        // v1.62.5：用 metricRelationships 未登记的对（不会被豁免），如自造 foo/bar/baz
        const agg = {
            sessionsCount: 10,
            redundantPairTop: [
                { a: 'foo', b: 'bar', count: 7, avgPearson: 0.98 },
                { a: 'baz', b: 'qux', count: 4, avgPearson: 0.94 },
            ],
            contractStats: [], hintCounts: [], stressDominatorCounts: [],
            healthScore: null,
        };
        const actions = summarizeOptimizationActions(agg);
        const dup = actions.find((a) => a.code === 'REDUNDANT_METRIC_PAIRS');
        expect(dup).toBeDefined();
        expect(dup.priority).toBe(3);
        expect(dup.evidence).toContain('foo ↔ bar: ×7');
        expect(dup.affected).toContain('foo');
    });

    it('summarizeOptimizationActions: 单分量 stress 长期主导 ≥50% 局 → STRESS_DOMINATOR_PERSISTENT', () => {
        const agg = {
            sessionsCount: 6,
            stressDominatorCounts: [
                { key: 'pacingAdjust', count: 4, share: 0.67 },
                { key: 'flowAdjust', count: 1, share: 0.17 },
            ],
            contractStats: [], hintCounts: [],
            healthScore: null,
        };
        const actions = summarizeOptimizationActions(agg);
        const dom = actions.find((a) => a.code === 'STRESS_DOMINATOR_PERSISTENT');
        expect(dom).toBeDefined();
        // 67% → priority 3
        expect(dom.priority).toBe(3);
        expect(dom.title).toContain('pacingAdjust');
        expect(dom.affected).toContain('pacingAdjust');
    });

    it('aggregateAuditReports: stressDominatorCounts 按出现次数降序', () => {
        const grid = new Grid(8);
        const _withDominator = (key) => {
            const frames = [buildInitFrame('normal', grid, scoring, _buildSamplePs({ phase: 'init', score: 0 }), { ts: 0 })];
            for (let i = 0; i < 10; i++) {
                const breakdown = {
                    difficultyBias: 0, flowAdjust: 0, reactionAdjust: 0,
                    pacingAdjust: 0, friendlyBoardRelief: 0, sessionArcAdjust: 0, challengeBoost: 0,
                };
                breakdown[key] = 0.5;
                frames.push(buildPlaceFrame(0, 0, 0, _buildSamplePs({
                    score: 10 + i * 5,
                    adaptive: { stress: 0.6, spawnHints: { spawnIntent: 'flow' }, stressBreakdown: breakdown },
                }), { ts: (i + 1) * 1000 }));
            }
            return frames;
        };
        const reports = [
            auditProfile(_withDominator('difficultyBias')),
            auditProfile(_withDominator('difficultyBias')),
            auditProfile(_withDominator('flowAdjust')),
        ];
        const agg = aggregateAuditReports(reports);
        expect(agg.stressDominatorCounts[0].key).toBe('difficultyBias');
        expect(agg.stressDominatorCounts[0].count).toBe(2);
        expect(agg.stressDominatorCounts[1].key).toBe('flowAdjust');
    });

    it('spawnIntent 频繁切换 → INTENT_THRASHING hint', () => {
        const grid = new Grid(8);
        const frames = [buildInitFrame('normal', grid, scoring, undefined, { ts: 0 })];
        const intents = ['flow', 'relief', 'pressure', 'flow', 'relief', 'pressure', 'flow', 'relief',
                         'pressure', 'flow', 'relief', 'pressure', 'flow', 'relief', 'pressure',
                         'flow', 'relief', 'pressure', 'flow', 'relief', 'pressure',
                         'flow', 'relief', 'pressure', 'flow', 'relief', 'pressure',
                         'flow', 'relief', 'pressure', 'flow'];
        for (let i = 0; i < intents.length; i++) {
            const ps = _buildSamplePs({
                adaptive: { stress: 0.5, spawnHints: { spawnIntent: intents[i] } },
            });
            frames.push(buildPlaceFrame(0, 0, 0, ps, { ts: (i + 1) * 500 }));
        }
        const report = auditProfile(frames);
        expect(report.linkages.intentSwitches).toBeGreaterThanOrEqual(intents.length - 1);
        const h = report.hints.find((x) => x.code === 'INTENT_THRASHING');
        expect(h?.severity).toBe('warn');
    });
});
