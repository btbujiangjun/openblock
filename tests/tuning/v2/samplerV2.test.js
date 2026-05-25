/**
 * samplerV2.js 单元 + 集成测试。
 *
 * 验证:
 *   1. 单步难度公式与 Python extractor.py 一致
 *   2. runOneSampleV2 跑通,产出合法样本
 *   3. _extractDCurveFromSteps 与 Python extract_d_curve 同语义
 *   4. collectSamplesV2 批量调用 + POST 流程
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    runOneSampleV2, collectSamplesV2, _internal,
} from '../../../web/src/tuning/v2/samplerV2.js';

const { stepDifficulty, extractDCurveFromSteps, createRng } = _internal;


// ─────────── 单步难度公式 ───────────

describe('stepDifficulty (与 Python extractor.py 一致)', () => {
    it('noMove returns 1.0', () => {
        expect(stepDifficulty({ noMove: true, fillRate: 0.5, actionFreedom: 0.5 }, [])).toBe(1.0);
    });

    it('basic formula matches Python', () => {
        // 与 Python test_extractor.py::test_basic_formula_no_trend 相同输入
        const d = stepDifficulty({
            stepIdx: 0, score: 100, fillRate: 0.5, actionFreedom: 0.5, noMove: false, clears: 0,
        }, []);
        // 0.3*0.5 + 0.5*0.5 + 0.2*0.5 = 0.5
        expect(d).toBeCloseTo(0.5, 6);
    });

    it('high fill = high difficulty', () => {
        const d = stepDifficulty({
            fillRate: 0.95, actionFreedom: 0.1, noMove: false, clears: 0,
        }, []);
        // = 0.3*0.95 + 0.5*0.9 + 0.2*0.5 = 0.835
        expect(d).toBeCloseTo(0.835, 6);
    });

    it('surprise damping × 0.5', () => {
        const d = stepDifficulty({
            fillRate: 0.5, actionFreedom: 0.3, noMove: false, clears: 4,
        }, []);
        // base = 0.6 → surprise × 0.5 → 0.30
        expect(d).toBeCloseTo(0.30, 6);
    });
});


// ─────────── d_curve 提取 (与 policyMetricsV2 + Python 镜像) ───────────

describe('extractDCurveFromSteps', () => {
    it('produces 20-length curve', () => {
        const steps = [
            { stepIdx: 0, score: 30, fillRate: 0.3, actionFreedom: 0.7, noMove: false },
            { stepIdx: 1, score: 60, fillRate: 0.5, actionFreedom: 0.5, noMove: false },
            { stepIdx: 2, score: 90, fillRate: 0.7, actionFreedom: 0.3, noMove: false },
        ];
        const labels = extractDCurveFromSteps(steps, 100);
        expect(labels.d_curve).toHaveLength(20);
        expect(labels.final_score).toBe(90);
        expect(labels.pb_broke).toBe(false);
    });

    it('pb_broke when final > pb', () => {
        const labels = extractDCurveFromSteps(
            [{ stepIdx: 0, score: 150, fillRate: 0.3, actionFreedom: 0.7, noMove: false }],
            100,
        );
        expect(labels.pb_broke).toBe(true);
    });

    it('returns null on invalid input', () => {
        expect(extractDCurveFromSteps([], 100)).toBeNull();
        expect(extractDCurveFromSteps([{}], 0)).toBeNull();
        expect(extractDCurveFromSteps([{}], -100)).toBeNull();
    });

    it('d_curve values all in [0, 1]', () => {
        const steps = Array.from({ length: 30 }, (_, i) => ({
            stepIdx: i, score: i * 5,
            fillRate: Math.min(0.95, i * 0.04),
            actionFreedom: Math.max(0.05, 1 - i * 0.04),
            noMove: false, clears: 0,
        }));
        const labels = extractDCurveFromSteps(steps, 100);
        for (const v of labels.d_curve) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });
});


// ─────────── RNG ───────────

describe('createRng', () => {
    it('deterministic for same seed', () => {
        const r1 = createRng(42);
        const r2 = createRng(42);
        for (let i = 0; i < 10; i++) {
            expect(r1()).toBe(r2());
        }
    });

    it('values in [0, 1)', () => {
        const r = createRng(123);
        for (let i = 0; i < 100; i++) {
            const v = r();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });
});


// ─────────── 端到端 runOneSampleV2 ───────────

describe('runOneSampleV2', () => {
    const defaultContext = {
        difficulty: 'normal',
        generator: 'budget-p2',
        bot_policy: 'random',
        pb_bin: 1500,
        lifecycle_stage: 'growth',
    };
    const defaultTheta = {
        personalizationStrength: 0.1,
        temperature: 0.05,
        surpriseBudgetGain: 0.07,
        surpriseCooldown: 6,
        maxEvaluatedTriplets: 80,
    };

    it('returns a valid v2 sample row', () => {
        const sample = runOneSampleV2({
            context: defaultContext,
            theta: defaultTheta,
            seed: 12345,
            maxSteps: 30,
        });
        expect(sample).not.toBeNull();
        // context 5 维
        expect(sample.difficulty).toBe('normal');
        expect(sample.generator).toBe('budget-p2');
        expect(sample.bot_policy).toBe('random');
        expect(sample.pb_bin).toBe(1500);
        expect(sample.lifecycle_stage).toBe('growth');
        // theta + labels
        const theta = JSON.parse(sample.theta_json);
        expect(theta.personalizationStrength).toBe(0.1);
        const dCurve = JSON.parse(sample.d_curve_json);
        expect(dCurve).toHaveLength(20);
        // 数值字段
        expect(typeof sample.final_score).toBe('number');
        expect(typeof sample.survived_steps).toBe('number');
        expect(typeof sample.pb_broke).toBe('boolean');
        expect(typeof sample.evaluated_at).toBe('number');
    });

    it('returns consistent shape across runs (simulator has non-seed randomness)', () => {
        // 注: OpenBlockSimulator 内部 spawn 生成器 用 Math.random(), 不完全由 seed 决定
        // 所以这里只验证返回结构而非数值严格相等
        const s = runOneSampleV2({
            context: defaultContext, theta: defaultTheta, seed: 999, maxSteps: 30,
        });
        expect(s).not.toBeNull();
        expect(JSON.parse(s.d_curve_json)).toHaveLength(20);
        expect(s.survived_steps).toBeGreaterThan(0);
        expect(s.survived_steps).toBeLessThanOrEqual(30);
    });

    it('different bot_policy produces valid samples', () => {
        const ctxRandom = { ...defaultContext, bot_policy: 'random' };
        const ctxGreedy = { ...defaultContext, bot_policy: 'clear-greedy' };
        const sR = runOneSampleV2({ context: ctxRandom, theta: defaultTheta, seed: 555, maxSteps: 30 });
        const sG = runOneSampleV2({ context: ctxGreedy, theta: defaultTheta, seed: 556, maxSteps: 30 });
        expect(sR.bot_policy).toBe('random');
        expect(sG.bot_policy).toBe('clear-greedy');
        // 两个样本都合法
        expect(JSON.parse(sR.d_curve_json)).toHaveLength(20);
        expect(JSON.parse(sG.d_curve_json)).toHaveLength(20);
    });

    /* v2.1 回归: LHS 抽样产出的浮点数 θ 之前会在 simulator 内部
     * `cheapTop.length = maxEvaluatedTriplets` 处抛
     * `RangeError: Failed to set 'length' property on 'Array'`。
     * 修复后 sampler 在调用边界 + spawnExperiments 内部双重 round, 确保不抛。 */
    it('survives float θ.maxEvaluatedTriplets (regression: Invalid Array length)', () => {
        const floatTheta = {
            ...defaultTheta,
            maxEvaluatedTriplets: 80.7,      // LHS 抽样常见: [32, 128] 之间浮点
            surpriseCooldown: 7.4,           // 同样曾被怀疑
        };
        expect(() => runOneSampleV2({
            context: defaultContext,
            theta: floatTheta,
            seed: 4242,
            maxSteps: 30,
        })).not.toThrow();
    });

    it('throws on truly invalid pb_bin', () => {
        expect(() => runOneSampleV2({
            context: { ...defaultContext, pb_bin: 0 },
            theta: defaultTheta,
            seed: 1,
            maxSteps: 10,
        })).toThrow(/pb_bin/);
    });
});


// ─────────── 批量采样 + 上传 ───────────

describe('collectSamplesV2', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 1 }) });
    });

    const ctx = {
        difficulty: 'easy', generator: 'budget-p2', bot_policy: 'random',
        pb_bin: 500, lifecycle_stage: 'growth',
    };
    const theta = {
        personalizationStrength: 0.1, temperature: 0.05,
        surpriseBudgetGain: 0.07, surpriseCooldown: 6, maxEvaluatedTriplets: 80,
    };

    it('uploads batched samples', async () => {
        // mock: server 端逐条 echo 写入数
        globalThis.fetch = vi.fn().mockImplementation((url, opts) => {
            const body = JSON.parse(opts.body);
            return Promise.resolve({ ok: true, json: async () => ({ inserted: body.samples.length, errors: 0 }) });
        });
        const result = await collectSamplesV2({
            setId: 42,
            contexts: [ctx],
            thetas: [theta, theta],   // 2 个 θ
            seedsPerTheta: 2,          // × 2 seeds
            maxSteps: 20,
            batchSize: 5,
            apiBaseUrl: 'http://test',
        });
        // 总 = 1 × 2 × 2 = 4
        expect(result.completed + result.failed).toBe(4);
        // 至少调用一次 fetch
        expect(fetch).toHaveBeenCalled();
        // URL 含 set_id
        const url = fetch.mock.calls[0][0];
        expect(url).toContain('/sample-sets/42/samples');
    });

    it('surfaces server error via firstError on fetch failure', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false, status: 500, text: async () => 'database locked',
        });
        const result = await collectSamplesV2({
            setId: 99,
            contexts: [ctx],
            thetas: [theta],
            seedsPerTheta: 1,
            maxSteps: 15,
            batchSize: 5,
            apiBaseUrl: 'http://test',
        });
        // 服务端拒绝 → 0 completed, n failed
        expect(result.completed).toBe(0);
        expect(result.failed).toBe(1);
        expect(result.firstError).toContain('500');
    });

    it('surfaces invalid context error via firstError', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 0 }) });
        const result = await collectSamplesV2({
            setId: 7,
            contexts: [{ ...ctx, difficulty: 'NOPE' }],   // 非法 difficulty
            thetas: [theta],
            seedsPerTheta: 2,
            maxSteps: 10,
            apiBaseUrl: 'http://test',
        });
        expect(result.completed).toBe(0);
        expect(result.failed).toBe(2);
        expect(result.firstError).toMatch(/difficulty/i);
    });

    it('reports progress', async () => {
        const progressLog = [];
        await collectSamplesV2({
            setId: 1,
            contexts: [ctx],
            thetas: [theta],
            seedsPerTheta: 3,
            maxSteps: 20,
            onProgress: (p) => progressLog.push(p),
        });
        expect(progressLog.length).toBe(3);
        expect(progressLog[progressLog.length - 1].percent).toBeCloseTo(1.0, 5);
    });

    it('throws on missing setId', async () => {
        await expect(collectSamplesV2({
            setId: 0, contexts: [ctx], thetas: [theta],
        })).rejects.toThrow();
    });
});
