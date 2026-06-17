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
import { getLifecycleMaturitySnapshot } from '../../../web/src/retention/playerLifecycleDashboard.js';

const { stepDifficulty, extractDCurveFromSteps, createRng, highRSeedCount, applyLifecycleStageToProfile } = _internal;


// ─────────── v3.2 lifecycle-in-sim: lifecycle_stage 真实驱动模拟 ───────────

describe('applyLifecycleStageToProfile (lifecycle-in-sim)', () => {
    // adaptiveSpawn 读 profile?._daysSinceInstall ?? ... → getLifecycleMaturitySnapshot 派生 stage。
    //   这里复刻同一读取路径, 验证 4 个训练态 stage 映射到正确的 S0..S4 cap 档。
    const stageOf = (profile) => getLifecycleMaturitySnapshot({
        daysSinceInstall: profile._daysSinceInstall,
        totalSessions: profile._totalSessions,
        daysSinceLastActive: profile._daysSinceLastActive,
    }).stageCode;

    it('写入三大裸字段 (adaptiveSpawn 优先读取的私有字段)', () => {
        const p = {};
        applyLifecycleStageToProfile(p, 'growth');
        expect(p._daysSinceInstall).toBe(20);
        expect(p._totalSessions).toBe(120);
        expect(p._daysSinceLastActive).toBe(0);
    });

    it('4 个训练态 stage → 不同 adaptiveSpawn lifecycle 档 (S0/S2/S3/S4)', () => {
        const mk = (stage) => applyLifecycleStageToProfile({}, stage);
        expect(stageOf(mk('onboarding'))).toBe('S0');   // 新入场强保护
        expect(stageOf(mk('growth'))).toBe('S2');       // 成长期 PB 主战场
        expect(stageOf(mk('mature'))).toBe('S3');       // 稳定期高 cap
        expect(stageOf(mk('plateau'))).toBe('S4');      // 回流/winback
        // 4 档互不相同 → lifecycle 维度真正可分 (此前是死标签, 全部同质)
        const codes = ['onboarding', 'growth', 'mature', 'plateau'].map((s) => stageOf(mk(s)));
        expect(new Set(codes).size).toBe(4);
    });

    it('未知 / 缺失 stage → 安全回退 onboarding', () => {
        expect(stageOf(applyLifecycleStageToProfile({}, 'bogus'))).toBe('S0');
        expect(stageOf(applyLifecycleStageToProfile({}, undefined))).toBe('S0');
    });

    it('null profile → 不抛异常', () => {
        expect(() => applyLifecycleStageToProfile(null, 'growth')).not.toThrow();
    });
});


// ─────────── v3.2 高 r 定向采样: pb_bin seed 加权 ───────────

describe('highRSeedCount (高 r 定向)', () => {
    it('highRBoost=0 → 恒等 (向后兼容)', () => {
        for (const pb of [500, 1500, 4000, 10000, 25000]) {
            expect(highRSeedCount(2, pb, 0)).toBe(2);
        }
    });
    it('boost>0 → 高 pb 档分配更多 seed, 低 pb 不变', () => {
        expect(highRSeedCount(2, 500, 1.0)).toBe(2);   // rank=0
        expect(highRSeedCount(2, 25000, 1.0)).toBe(4); // rank=1 → 2×(1+1)=4
        // 单调非降
        const seeds = [500, 1500, 4000, 10000, 25000].map((pb) => highRSeedCount(2, pb, 1.0));
        for (let i = 1; i < seeds.length; i++) expect(seeds[i]).toBeGreaterThanOrEqual(seeds[i - 1]);
    });
    it('未知 pb / 非法输入 → 安全回退到 base', () => {
        expect(highRSeedCount(3, 99999, 1.0)).toBe(3);
        expect(highRSeedCount(0, 25000, 1.0)).toBe(2); // base clamp 到 ≥1 → 1×2
    });
});


// ─────────── 单步难度公式 ───────────

describe('stepDifficulty v3.1 (G5: PB-aware d_step 物理调制, 与 Python extractor.py 一致)', () => {
    // v3.1: d_step = 0.6*state_d + 0.4*sigmoid((r - 0.82) / 0.08)
    it('noMove returns 1.0', () => {
        expect(stepDifficulty({ noMove: true, fillRate: 0.5, actionFreedom: 0.5 }, [], 0.5)).toBe(1.0);
    });

    it('v3.1: d_step 显式依赖 ratio (PB-aware lift 项)', () => {
        const ctx = { fillRate: 0.5, actionFreedom: 0.5, noMove: false, clears: 0 };
        const d0 = stepDifficulty(ctx, [], 0.0);
        const d2 = stepDifficulty(ctx, [], 2.0);
        // r=0 远小 center=0.82 → lift~0; r=2 远大 → lift~1
        expect(d2 - d0).toBeGreaterThan(0.30);
    });

    it('v3.1: state_d=0.5 + r=0 → d ≈ 0.30 (0.6*0.5 + 0.4*0)', () => {
        const d = stepDifficulty({
            fillRate: 0.5, actionFreedom: 0.5, noMove: false, clears: 0,
        }, [], 0.0);
        expect(d).toBeCloseTo(0.30, 1);
    });

    it('v3.1: state_d=0.5 + r=1.5 → d ≈ 0.70 (0.6*0.5 + 0.4*1)', () => {
        const d = stepDifficulty({
            fillRate: 0.5, actionFreedom: 0.5, noMove: false, clears: 0,
        }, [], 1.5);
        expect(d).toBeCloseTo(0.70, 1);
    });

    it('v3.1: 高压 (fill=1, freedom=0) + r=2 → d ≈ 0.94 (0.6*0.9 + 0.4*1)', () => {
        const d = stepDifficulty({
            fillRate: 1.0, actionFreedom: 0.0, noMove: false, clears: 0,
        }, [], 2.0);
        expect(d).toBeCloseTo(0.94, 1);
    });

    it('v3.1: 低压 (fill=0, freedom=1) + r=0 → d ≈ 0.06 (0.6*0.1 + 0.4*0)', () => {
        const d = stepDifficulty({
            fillRate: 0.0, actionFreedom: 1.0, noMove: false, clears: 0,
        }, [], 0.0);
        expect(d).toBeCloseTo(0.06, 1);
    });

    it('v3.1: θ 自定义 (center=0.30) → r=0.5 时 lift 已 ~1', () => {
        const ctx = { fillRate: 0.5, actionFreedom: 0.5, noMove: false, clears: 0 };
        const dDefault = stepDifficulty(ctx, [], 0.5);   // default center=0.82
        const dEarly = stepDifficulty(ctx, [], 0.5, 0.30, 0.08);   // center 提前到 0.30
        expect(dEarly - dDefault).toBeGreaterThan(0.20);
    });

    it('v3.1: surprise damping (clears>=3) 减压 state_d ~50% (lift 不受影响)', () => {
        const dNormal = stepDifficulty({ fillRate: 0.6, actionFreedom: 0.3, noMove: false, clears: 0 }, [], 0.5);
        const dSurprise = stepDifficulty({ fillRate: 0.6, actionFreedom: 0.3, noMove: false, clears: 4 }, [], 0.5);
        expect(dSurprise).toBeLessThan(dNormal * 0.6);
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
        generator: 'rule',
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

    it('returns a valid v2 sample row', async () => {
        const sample = await runOneSampleV2({
            context: defaultContext,
            theta: defaultTheta,
            seed: 12345,
            maxSteps: 30,
        });
        expect(sample).not.toBeNull();
        // context 5 维
        expect(sample.difficulty).toBe('normal');
        expect(sample.generator).toBe('rule');
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

    it('returns consistent shape across runs (simulator has non-seed randomness)', async () => {
        const s = await runOneSampleV2({
            context: defaultContext, theta: defaultTheta, seed: 999, maxSteps: 30,
        });
        expect(s).not.toBeNull();
        expect(JSON.parse(s.d_curve_json)).toHaveLength(20);
        expect(s.survived_steps).toBeGreaterThan(0);
        expect(s.survived_steps).toBeLessThanOrEqual(30);
    });

    it('different bot_policy produces valid samples', async () => {
        const ctxRandom = { ...defaultContext, bot_policy: 'random' };
        const ctxGreedy = { ...defaultContext, bot_policy: 'clear-greedy' };
        const sR = await runOneSampleV2({ context: ctxRandom, theta: defaultTheta, seed: 555, maxSteps: 30 });
        const sG = await runOneSampleV2({ context: ctxGreedy, theta: defaultTheta, seed: 556, maxSteps: 30 });
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
    it('survives float θ.maxEvaluatedTriplets (regression: Invalid Array length)', async () => {
        const floatTheta = {
            ...defaultTheta,
            maxEvaluatedTriplets: 80.7,
            surpriseCooldown: 7.4,
        };
        await expect(runOneSampleV2({
            context: defaultContext,
            theta: floatTheta,
            seed: 4242,
            maxSteps: 30,
        })).resolves.not.toBeNull();
    });

    it('throws on truly invalid pb_bin', async () => {
        await expect(runOneSampleV2({
            context: { ...defaultContext, pb_bin: 0 },
            theta: defaultTheta,
            seed: 1,
            maxSteps: 10,
        })).rejects.toThrow(/pb_bin/);
    });

    // v2.10.33 (P2.1): MCTS bot 测试 — 主要验证不崩 + 输出合法
    it('MCTS bot (use_mcts_bot=true) produces valid sample', async () => {
        const thetaMCTS = {
            ...defaultTheta,
            use_mcts_bot: true,
            mcts_rollouts: 5,
            mcts_rollout_steps: 5,
        };
        const s = await runOneSampleV2({
            context: { ...defaultContext, bot_policy: 'clear-greedy' },
            theta: thetaMCTS,
            seed: 4243,
            maxSteps: 15,
        });
        expect(s).not.toBeNull();
        expect(JSON.parse(s.d_curve_json)).toHaveLength(20);
        expect(s.survived_steps).toBeGreaterThan(0);
        // MCTS 应该比 random 强 — 至少不应该 0 分
        expect(s.final_score).toBeGreaterThan(0);
    }, 20000); // MCTS 真实 rollout 较重，隔离 ~3s，全量并行 CPU 争用下会超默认 5s → 显式放宽（同 C/D/E 组惯例）

    // v2.10.33 (P1.2 修复): 2-step lookahead 之前因 sim.clone 不存在退化 return 0
    // 修复后使用 saveState/restoreState 真正生效, 应给出比 1-step 不弱的 sample
    it('lookahead2 bot produces valid sample (regression: saveState path)', async () => {
        const theta2 = { ...defaultTheta, use_lookahead_bot: true, use_lookahead2_bot: true };
        const s = await runOneSampleV2({
            context: { ...defaultContext, bot_policy: 'clear-greedy' },
            theta: theta2,
            seed: 1234,
            maxSteps: 20,
        });
        expect(s).not.toBeNull();
        expect(JSON.parse(s.d_curve_json)).toHaveLength(20);
        expect(s.final_score).toBeGreaterThan(0);
    }, 20000); // 2-step lookahead 真实 saveState/restore 较重，同上放宽超时防并行 flaky

    // v2.10.35: generative — sampler 通过 HTTP 调 SpawnPolicyNet V3
    //   测试环境 fetch 失败 → fallback baseline; 重点验证不崩 + 输出合法
    it('generative generator falls back gracefully when V3 API unavailable', async () => {
        const s = await runOneSampleV2({
            context: { ...defaultContext, generator: 'generative', bot_policy: 'clear-greedy' },
            theta: defaultTheta,
            seed: 9090,
            maxSteps: 10,
        });
        expect(s).not.toBeNull();
        expect(s.generator).toBe('generative');
        expect(JSON.parse(s.d_curve_json)).toHaveLength(20);
        // V3 失败时 fallback baseline, sample 应该照常产出
    });

    // v2.10.36: rl-bot — sampler 通过 HTTP 调 /api/rl/select_action
    //   测试环境 fetch 失败 → fallback clear-greedy; 重点验证不崩 + 输出合法
    it('rl-bot bot_policy falls back gracefully when RL API unavailable', async () => {
        const s = await runOneSampleV2({
            context: { ...defaultContext, bot_policy: 'rl-bot' },
            theta: defaultTheta,
            seed: 7070,
            maxSteps: 10,
        });
        expect(s).not.toBeNull();
        expect(s.bot_policy).toBe('rl-bot');
        expect(JSON.parse(s.d_curve_json)).toHaveLength(20);
        // RL 失败时 fallback clear-greedy → 仍能跑通, final_score > 0
        expect(s.final_score).toBeGreaterThanOrEqual(0);
    });
});


// ─────────── 批量采样 + 上传 ───────────

describe('collectSamplesV2', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 1 }) });
    });

    const ctx = {
        difficulty: 'easy', generator: 'rule', bot_policy: 'random',
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
        // v2.10.38: 节流后 N 个 sample 内可能只触发少量 onProgress, 但最后必报一次
        const progressLog = [];
        await collectSamplesV2({
            setId: 1,
            contexts: [ctx],
            thetas: [theta],
            seedsPerTheta: 3,
            maxSteps: 20,
            onProgress: (p) => progressLog.push(p),
        });
        expect(progressLog.length).toBeGreaterThanOrEqual(1);
        expect(progressLog[progressLog.length - 1].percent).toBeCloseTo(1.0, 5);
    });

    it('throws on missing setId', async () => {
        await expect(collectSamplesV2({
            setId: 0, contexts: [ctx], thetas: [theta],
        })).rejects.toThrow();
    });

    // ─── v3.0.6 (G2 闭环): thetas 支持 (ctx) => theta[] 工厂函数 ───
    it('v3.0.6: thetas factory function — per-ctx 动态生成 θ', async () => {
        globalThis.fetch = vi.fn().mockImplementation((url, opts) => {
            const body = JSON.parse(opts.body);
            return Promise.resolve({ ok: true, json: async () => ({ inserted: body.samples.length, errors: 0 }) });
        });
        const ctxA = { ...ctx, difficulty: 'easy' };
        const ctxB = { ...ctx, difficulty: 'normal' };
        const seenCtx = [];
        const factory = (c) => {
            seenCtx.push(c.difficulty);
            return [theta, theta];   // 每 ctx 2 个 θ
        };
        const result = await collectSamplesV2({
            setId: 100,
            contexts: [ctxA, ctxB],
            thetas: factory,
            nThetas: 2,
            seedsPerTheta: 1,
            maxSteps: 15,
            batchSize: 5,
            apiBaseUrl: 'http://test',
        });
        // 2 ctx × 2 θ × 1 seed = 4
        expect(result.completed + result.failed).toBe(4);
        expect(seenCtx).toEqual(['easy', 'normal']);
    });

    it('v3.0.6: throws when thetas is function but nThetas missing', async () => {
        await expect(collectSamplesV2({
            setId: 1, contexts: [ctx], thetas: () => [theta],
        })).rejects.toThrow(/nThetas/);
    });

    it('v3.0.8: 新 generator enum (rule / generative) 校验通过', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 1, errors: 0 }) });
        for (const g of ['rule', 'generative']) {
            const r = await collectSamplesV2({
                setId: 200,
                contexts: [{ ...ctx, generator: g }],
                thetas: [theta],
                seedsPerTheta: 1,
                maxSteps: 10,
                apiBaseUrl: 'http://test',
            });
            expect(r.firstError || '').not.toMatch(/invalid generator/);
        }
    });

    it('v3.0.8: 老 generator enum (budget-p2 / triplet-p1 / heuristic-rule / model-v3) 应被严格拒绝', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 0 }) });
        // 注: 这里故意写明老 enum 字符串, 验证它们被拒绝
        for (const old_g of ['budget-p2', 'triplet-p1', 'heuristic-rule', 'model-v3']) {
            const r = await collectSamplesV2({
                setId: 201,
                contexts: [{ ...ctx, generator: old_g }],
                thetas: [theta],
                seedsPerTheta: 1,
                maxSteps: 10,
                apiBaseUrl: 'http://test',
            });
            expect(r.firstError).toMatch(/invalid generator/);
        }
    });

    it('v3.0.8: 完全非法 generator 也报错', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 0 }) });
        const result = await collectSamplesV2({
            setId: 202,
            contexts: [{ ...ctx, generator: 'NOPE' }],
            thetas: [theta],
            seedsPerTheta: 1,
            maxSteps: 10,
            apiBaseUrl: 'http://test',
        });
        expect(result.firstError).toMatch(/invalid generator/);
    });

    it('v3.0.6: thetas factory returns empty → ctx 整体标记失败', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ inserted: 0 }) });
        const result = await collectSamplesV2({
            setId: 1,
            contexts: [ctx],
            thetas: () => [],   // 工厂返回空
            nThetas: 3,
            seedsPerTheta: 2,
            maxSteps: 10,
            apiBaseUrl: 'http://test',
        });
        // 整 ctx 跳过, failed = 3 × 2 = 6
        expect(result.completed).toBe(0);
        expect(result.failed).toBe(6);
        expect(result.firstError).toMatch(/empty/i);
    });
});


// ─────────── 36 维 θ 端到端: 新引入参数确实撬动 d_curve ───────────

describe('36-dim θ end-to-end: 新 27 维 (C/D/E/F/G/H/I) 真实作用于 simulator', () => {
    const baseContext = {
        difficulty: 'normal', generator: 'rule', bot_policy: 'clear-greedy',
        pb_bin: 1500, lifecycle_stage: 'growth',
    };
    // 全 36 维都给值, 默认值 (= 历史硬编码)
    const defaultsAll = {
        // A
        personalizationStrength: 0.10, temperature: 0.05,
        surpriseBudgetGain: 0.07, surpriseCooldown: 6, maxEvaluatedTriplets: 80,
        // B
        pbTensionCenter: 0.82, pbTensionWidth: 0.08,
        pbBrakeCenter: 1.05, pbBrakeWidth: 0.06,
        // C augmentPool
        perfectClearWeight: 25.0, multiClearBaseFactor: 0.6, nearFullFactor: 2.0,
        exactFitBonus: 1.5, monoFlushBoost: 0.4, payoffWeight: 1.7,
        sizePreferenceGain: 1.5, diversityPenalty: 1.0,
        // D
        complexityFromStress: 0.75, complexityRiskRelief: -0.45,
        solutionFromStress: 0.7, pbTensionTargetWeight: 0.10, pbBrakeTargetWeight: 0.10,
        // E
        challengeBoostSlope: 0.75, challengeBoostCap: 0.18, pbOvershootMax: 0.16,
        releaseFactor: 0.7, farFromPBBoost: 0.45,
        // F 顺序难度 (v3.2)
        orderRigorGain: 1.0, orderSolutionBudgetGain: 1.0,
        // G 构造式 (v3.2)
        constructiveCompleterGain: 1.0, crowdedMultiClearThresholdGain: 1.0,
        // H 解空间 (v3.2)
        shapeComplexityGain: 1.0, solutionSpacePressureGain: 1.0,
        // I 节奏/special (v3.2)
        specialReliefQuotaGain: 1.0, specialPressureQuotaGain: 1.0, monoFlushCapGain: 1.0,
    };

    /** 同 seed 同 ctx 跑两份样本, 验证 θ 差异确实让 d_curve 不同. */
    async function runPair(thetaA, thetaB, seed = 7777, maxSteps = 40) {
        const sA = await runOneSampleV2({ context: baseContext, theta: thetaA, seed, maxSteps });
        const sB = await runOneSampleV2({ context: baseContext, theta: thetaB, seed, maxSteps });
        return {
            curveA: JSON.parse(sA.d_curve_json),
            curveB: JSON.parse(sB.d_curve_json),
            eA: JSON.parse(sA.e_curve_json), eB: JSON.parse(sB.e_curve_json),
            fA: JSON.parse(sA.f_curve_json), fB: JSON.parse(sB.f_curve_json),
            scoreA: sA.final_score,
            scoreB: sB.final_score,
        };
    }

    /** L1 距离 (跨 bin 平均绝对差) - 越大说明 θ 撬动越明显. */
    function l1(a, b) {
        let s = 0;
        const n = Math.min(a.length, b.length);
        for (let i = 0; i < n; i++) s += Math.abs((a[i] || 0) - (b[i] || 0));
        return s / n;
    }

    it('C 组 (augmentPool): perfectClearWeight 15 vs 40 → d_curve 不同', async () => {
        const lo = { ...defaultsAll, perfectClearWeight: 15.0 };
        const hi = { ...defaultsAll, perfectClearWeight: 40.0 };
        const { curveA, curveB } = await runPair(lo, hi);
        expect(l1(curveA, curveB)).toBeGreaterThan(0.005);
    }, 20000);

    it('C 组 (augmentPool): payoffWeight 1.2 vs 2.0 → d_curve 不同', async () => {
        const lo = { ...defaultsAll, payoffWeight: 1.2 };
        const hi = { ...defaultsAll, payoffWeight: 2.0 };
        const { curveA, curveB } = await runPair(lo, hi, 8888);
        expect(l1(curveA, curveB)).toBeGreaterThan(0.005);
    }, 20000);

    it('D 组 (targets 翻译): complexityFromStress 0.5 vs 1.0 → d_curve 不同', async () => {
        const lo = { ...defaultsAll, complexityFromStress: 0.5 };
        const hi = { ...defaultsAll, complexityFromStress: 1.0 };
        const { curveA, curveB } = await runPair(lo, hi, 9999);
        expect(l1(curveA, curveB)).toBeGreaterThan(0.005);
    }, 20000);

    it('E 组 (PB 段细节): challengeBoostCap 0.12 vs 0.25 → d_curve 不同', async () => {
        const lo = { ...defaultsAll, challengeBoostCap: 0.12 };
        const hi = { ...defaultsAll, challengeBoostCap: 0.25 };
        const { curveA, curveB } = await runPair(lo, hi, 12345);
        expect(l1(curveA, curveB)).toBeGreaterThan(0.005);
    }, 20000);

    it('F 组 (顺序难度): orderRigorGain 0.6 vs 1.6 → d_curve 不同', async () => {
        const lo = { ...defaultsAll, orderRigorGain: 0.6 };
        const hi = { ...defaultsAll, orderRigorGain: 1.6 };
        const { curveA, curveB } = await runPair(lo, hi, 24680);
        expect(l1(curveA, curveB)).toBeGreaterThan(0.005);
    }, 20000);

    it('G 组 (构造式): constructiveCompleterGain 0.6 vs 1.5 → d_curve 不同', async () => {
        const lo = { ...defaultsAll, constructiveCompleterGain: 0.6 };
        const hi = { ...defaultsAll, constructiveCompleterGain: 1.5 };
        const { curveA, curveB } = await runPair(lo, hi, 13579);
        expect(l1(curveA, curveB)).toBeGreaterThan(0.005);
    }, 20000);

    it('H 组 (解空间): solutionSpacePressureGain 0.7 vs 1.4 → d_curve 不同', async () => {
        const lo = { ...defaultsAll, solutionSpacePressureGain: 0.7 };
        const hi = { ...defaultsAll, solutionSpacePressureGain: 1.4 };
        const { curveA, curveB } = await runPair(lo, hi, 11223);
        expect(l1(curveA, curveB)).toBeGreaterThan(0.005);
    }, 20000);

    it('I 组 (节奏/special): specialReliefQuotaGain 0.6 vs 1.8 → d/e/f 至少一条不同', async () => {
        const lo = { ...defaultsAll, specialReliefQuotaGain: 0.6 };
        const hi = { ...defaultsAll, specialReliefQuotaGain: 1.8 };
        const { curveA, curveB, eA, eB, fA, fB } = await runPair(lo, hi, 33445, 60);
        const delta = l1(curveA, curveB) + l1(eA, eB) + l1(fA, fB);
        expect(delta).toBeGreaterThan(0.001);
    }, 20000);

    // v3.2 多曲线: e_curve / f_curve 形态合理 + 取值有界
    it('多曲线: runOneSampleV2 输出 e_curve / f_curve 各 20 维且 ∈ [0,1]', async () => {
        const s = await runOneSampleV2({ context: baseContext, theta: defaultsAll, seed: 4242, maxSteps: 60 });
        const e = JSON.parse(s.e_curve_json);
        const f = JSON.parse(s.f_curve_json);
        expect(e).toHaveLength(20);
        expect(f).toHaveLength(20);
        for (const v of e) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
        for (const v of f) expect(v).toBeGreaterThanOrEqual(0), expect(v).toBeLessThanOrEqual(1);
    }, 20000);

    it('全 36 维"两极端"对比 (lo=全部 min / hi=全部 max) → d_curve 差异显著', async () => {
        // 取 THETA_RANGES 的 (lo, hi) 两端
        const { DEFAULT_THETA_V2 } = await import('../../../web/src/tuning/v2/clientPolicyV2.js');
        // lo: 每个 θ 取 (默认值 × 0.6); hi: × 1.4. 大于 0 的近似两极, 负值的反向.
        const lo = { ...defaultsAll };
        const hi = { ...defaultsAll };
        for (const k of Object.keys(DEFAULT_THETA_V2)) {
            const d = DEFAULT_THETA_V2[k];
            if (k === 'surpriseCooldown') { lo[k] = 4; hi[k] = 10; continue; }
            if (k === 'maxEvaluatedTriplets') { lo[k] = 32; hi[k] = 128; continue; }
            if (d < 0) { lo[k] = d * 1.4; hi[k] = d * 0.6; }
            else        { lo[k] = d * 0.6; hi[k] = d * 1.4; }
        }
        const { curveA, curveB } = await runPair(lo, hi, 31415);
        // 两极端应该让 d_curve 差异远大于 noise 阈值 0.01
        expect(l1(curveA, curveB)).toBeGreaterThan(0.015);
    }, 30000);

    it('samplerV2 透传全部 36 维 θ 到 simulator.modelConfig (回归: v3.0.26 之前只传 9 维)', async () => {
        // 验证 sampler 把所有 36 维 θ 都注入 modelConfig — 通过 single-step "改一个 D 组 θ → 输出变化"
        // 旧 bug: samplerV2 只透传 9 维, 改 D 组 θ 时 simulator 看不到 → curve 完全相同.
        const lo = { ...defaultsAll, complexityRiskRelief: -0.7, solutionFromStress: 0.5 };
        const hi = { ...defaultsAll, complexityRiskRelief: -0.2, solutionFromStress: 1.0 };
        const { curveA, curveB } = await runPair(lo, hi, 17171);
        // 如果 sampler 没透传, curveA === curveB (l1=0). 透传后必须 > 0.
        expect(l1(curveA, curveB)).toBeGreaterThan(0.001);
    }, 20000);

    // v3.2 严格 no-peek: θ 对象里的"非 θ 字段"绝不进 modelConfig (出块管线唯一的 θ 入口)。
    //   出块路径含全局 Math.random, 无法用行为等价断言; 改测纯函数白名单 (结构性守卫)。
    it('no-peek: buildSpawnModelConfig 只放行 36 维白名单 θ, 丢弃所有非 θ 字段', () => {
        const { buildSpawnModelConfig } = _internal;
        const poisoned = {
            ...defaultsAll,
            // 历史上被混进 θ 的 bot 控制项 + 任意伪装 spawn 字段
            use_mcts_bot: true, use_lookahead2_bot: true, use_lookahead_bot: true,
            mcts_rollouts: 999, rl_temperature: 5.0,
            __peek_canary: 123456, secretFutureBlock: 'I',
        };
        const mc = buildSpawnModelConfig(poisoned);
        // 36 维 θ 全部保留
        for (const k of Object.keys(defaultsAll)) {
            expect(mc[k]).toBe(k === 'surpriseCooldown' ? Math.round(defaultsAll[k]) : defaultsAll[k]);
        }
        // 任何非白名单字段一律不存在
        for (const k of ['use_mcts_bot', 'use_lookahead2_bot', 'use_lookahead_bot',
            'mcts_rollouts', 'rl_temperature', '__peek_canary', 'secretFutureBlock']) {
            expect(k in mc).toBe(false);
        }
        // modelConfig 维度恰好 = 白名单大小
        expect(Object.keys(mc)).toHaveLength(Object.keys(defaultsAll).length);
    });
});
