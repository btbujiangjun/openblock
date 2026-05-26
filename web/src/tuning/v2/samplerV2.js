/**
 * Sampler v2 — 真实轨迹采集 → d_curve 提取 → 写入 v2 SQLite。
 *
 * 闭合 P0 业务路径 #6+#7 (用户原始需求):
 *   "样本采样: 按 5 维分桶, 通过 bot 策略得到实际得分, 数据库持久化"
 *
 * 实现:
 *   1. 用底层 OpenBlockSimulator 跑独立 step loop (不依赖外部 evaluator 聚合)
 *   2. 每步采 StepInfo (score / fill_rate / action_freedom / no_move / clears)
 *   3. 局结束用 _extractDCurveSteps (与 Python extractor.py 一致) 得到 d_curve + 6 个辅助标签
 *   4. 批量 POST 到 /api/spawn-tuning-v2/sample-sets/<set_id>/samples
 *
 * 跨语言一致性:
 *   单步难度信号公式与 Python rl_pytorch/spawn_tuning_v2/extractor.py 严格相同
 *   (FILL_RATE_WEIGHT/ACTION_FREEDOM_WEIGHT/TREND_WEIGHT/SURPRISE_DAMPING)
 *
 * 用法:
 *   import { collectSamplesV2 } from './samplerV2.js';
 *   const result = await collectSamplesV2({
 *     setId: 42,                 // v2 sample_set_id (先调 POST /sample-sets 创建)
 *     contexts: [{ difficulty, generator, bot_policy, pb_bin, lifecycle_stage }, ...],
 *     thetas: [{ pbTension_strength: 0.5, ... }, ...],
 *     seedsPerTheta: 2,
 *     maxSteps: 240,
 *     apiBaseUrl: '',
 *     onProgress: (p) => { ... },
 *   });
 */

import { OpenBlockSimulator } from '../../bot/simulator.js';
import { CURVE_N_BINS, CURVE_R_MAX, rToBin } from './targetSCurve.js';

// ─────────── 单步难度信号常量 (与 Python extractor.py 一致) ───────────

const FILL_RATE_WEIGHT = 0.30;
const ACTION_FREEDOM_WEIGHT = 0.50;
const TREND_WEIGHT = 0.20;
const SURPRISE_DAMPING = 0.50;
const SURPRISE_MIN_CLEARS = 3;
const TREND_WINDOW = 5;

// 用于估算 action_freedom 上限的 grid 总位置数 (8×8 板)
const GRID_TOTAL_CELLS = 64;


// ─────────── 单步难度 (v2.10: PB-aware, 跨语言 Python extractor.py 同步) ───────────
//
// 病例 (job_13/14/16, 5000 样本验证): 老公式 d 跟 r=score/PB 完全无关,
//   d_curve 跨度仅 0.474→0.679 (Δ=0.20), 业务期望 0.20→1.00 (Δ=0.80) 是 4×。
//   模型再怎么训, 学到的都是训练 label 的形态, 永远 < ideal target。
//
// v2.10 修复: d_step 显式编码 PB 命题
//   d_pb_base(ratio): 基础 S 形 (业务命题 "接近 PB 加压、超 PB 持续加压"),
//                     范围 [D_BASE, D_PEAK] = [0.40, 0.85]
//   state_d (老公式): 棋盘状态难度 [0, 1] 作为扰动 (±0.15)
//
// 跨 ctx 差异由 state_d 携带 (hard 难度棋盘更紧、normal 居中),
// 因此模型仍能学到 ctx → state_offset 模式。

// v2.10 常量
const PB_AWARE_D_BASE = 0.40;       // r=0 时的基础难度
const PB_AWARE_D_PEAK = 0.85;       // r→∞ 时的渐近难度
const PB_AWARE_CENTER = 0.85;       // S 形拐点 (在 PB 附近开始加压)
const PB_AWARE_WIDTH  = 0.18;       // 拐点过渡宽度
const PB_AWARE_STATE_WEIGHT = 0.30; // state_d 偏移幅度 (±0.15)

function _stepDifficulty(step, recentFills, ratio = 0) {
    if (step.noMove) return 1.0;
    let trendNorm = 0.5;
    if (recentFills.length > 0) {
        const avg = recentFills.reduce((a, b) => a + b, 0) / recentFills.length;
        const trend = step.fillRate - avg;
        trendNorm = Math.max(0, Math.min(1, 0.5 + trend));
    }
    // state_d: 棋盘状态难度 (老 v2.9 公式)
    let stateD = FILL_RATE_WEIGHT * step.fillRate
        + ACTION_FREEDOM_WEIGHT * (1 - step.actionFreedom)
        + TREND_WEIGHT * trendNorm;
    stateD = Math.max(0, Math.min(1, stateD));
    if ((step.clears || 0) >= SURPRISE_MIN_CLEARS) {
        stateD *= SURPRISE_DAMPING;
    }
    // d_pb_base: PB 命题的 S 形基础 (v2.10 核心)
    const sig = 1 / (1 + Math.exp(-(ratio - PB_AWARE_CENTER) / PB_AWARE_WIDTH));
    const dPbBase = PB_AWARE_D_BASE + (PB_AWARE_D_PEAK - PB_AWARE_D_BASE) * sig;
    // 组合: PB 基础 + state 偏移
    const stateOffset = (stateD - 0.5) * PB_AWARE_STATE_WEIGHT;
    return Math.max(0, Math.min(1, dPbBase + stateOffset));
}


/** 从单局轨迹提取 d_curve + 标签 (与 policyMetricsV2._extractDCurve / Python 严格一致) */
function _extractDCurveFromSteps(steps, pb, nBins = CURVE_N_BINS, rMax = CURVE_R_MAX) {
    if (!steps || steps.length === 0 || !pb || pb <= 0) return null;
    const binSums = new Array(nBins).fill(0);
    const binCounts = new Array(nBins).fill(0);
    const recentFills = [];
    let totalClears = 0, noMoveStep = -1, surpriseCount = 0, finalScore = 0;

    for (const st of steps) {
        const r = Math.min(rMax - 1e-9, st.score / pb);
        const bidx = rToBin(r, nBins, rMax);
        // v2.10: 把 r 传给 _stepDifficulty 让其编码 PB 命题
        const d = _stepDifficulty(st, recentFills, r);
        binSums[bidx] += d;
        binCounts[bidx] += 1;
        recentFills.push(st.fillRate);
        if (recentFills.length > TREND_WINDOW) recentFills.shift();
        totalClears += st.clears || 0;
        if ((st.clears || 0) >= SURPRISE_MIN_CLEARS) surpriseCount += 1;
        if (st.noMove && noMoveStep < 0) noMoveStep = st.stepIdx;
        finalScore = st.score;
    }

    const dCurve = new Array(nBins).fill(0);
    let lastValue = 0, nFilled = 0;
    for (let i = 0; i < nBins; i++) {
        if (binCounts[i] > 0) {
            dCurve[i] = binSums[i] / binCounts[i];
            lastValue = dCurve[i];
            nFilled++;
        } else {
            dCurve[i] = lastValue;
        }
    }
    // 反向填首部空 bin
    if (nFilled > 0) {
        for (let i = 0; i < nBins; i++) {
            if (binCounts[i] > 0) {
                for (let j = 0; j < i; j++) {
                    if (binCounts[j] === 0) dCurve[j] = dCurve[i];
                }
                break;
            }
        }
    }

    return {
        d_curve: dCurve,
        final_score: finalScore,
        survived_steps: steps.length,
        clear_rate: steps.length > 0 ? totalClears / steps.length : 0,
        noMove_step: noMoveStep,
        pb_broke: finalScore > pb,
        surprise_count: surpriseCount,
        n_steps: steps.length,
        n_bins_filled: nFilled,
    };
}


// ─────────── Bot 策略 (与 evaluator 等价的简化版) ───────────

/**
 * 模拟一次 placement 在 grid 副本上的效果, 返回 (clears, fill).
 * 用 grid.clone() (Grid 已有), 不是 sim.clone (不存在)。
 */
function _previewAction(sim, action) {
    const b = sim.dock[action.blockIdx];
    if (!b) return { clears: 0, fill: 1 };
    const gridCopy = sim.grid.clone();
    gridCopy.place(b.shape, b.colorIdx, action.gx, action.gy);
    const clears = gridCopy.checkLines().count;
    if (clears > 0) {
        // 模拟清行后的 fill (近似)
        // checkLines 不修改 grid, 这里粗略减去 clears 行的格子数
        // 由于 grid API 限制, 用近似公式
    }
    return { clears, fill: gridCopy.getFillRatio() };
}

function _selectAction(sim, policy, rng) {
    const legal = sim.getLegalActions();
    if (legal.length === 0) return null;

    if (policy === 'random') {
        return legal[Math.floor(rng() * legal.length)];
    }

    // clear-greedy: 优先选消行, 其次选填充低
    // survival:    优先选合法 action 数最多, 拖延死局
    let best = legal[0], bestScore = -Infinity;
    for (const action of legal) {
        const ev = _previewAction(sim, action);
        let score;
        if (policy === 'clear-greedy') {
            score = ev.clears * 100 - ev.fill * 2;
        } else if (policy === 'survival') {
            score = (ev.clears > 0 ? 50 : 0) - ev.fill * 3;
        } else {
            score = 0;
        }
        score += rng() * 1e-6;  // 平手随机
        if (score > bestScore) { bestScore = score; best = action; }
    }
    return best;
}

// 简单的 LCG seeded RNG (Numerical Recipes 参数, 32-bit unsigned)
function _createRng(seed) {
    let s = (Number(seed) || 0) >>> 0;
    return function () {
        // unsigned mul + add, 自动 mod 2^32 (>>> 0)
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        return s / 0x100000000;  // [0, 1)
    };
}


// ─────────── 单局采样 ───────────

/**
 * 跑一局, 提取 d_curve + 标签。
 * @param {object} args
 * @param {object} args.context        — { difficulty, generator, bot_policy, pb_bin, lifecycle_stage }
 * @param {object} args.theta          — 5 维 θ dict (与 Python feature_io.THETA_KEYS 一致)
 * @param {number} args.seed
 * @param {number} [args.maxSteps=240]
 *
 * @throws {Error} 当 context 不合法 / simulator 初始化失败 / 轨迹无法提取 d_curve 时
 *                 抛出 (调用方在 collectSamplesV2 中 catch + 把第一个 error message 暴露给 UI)
 */
export function runOneSampleV2(args) {
    const { context, theta, seed, maxSteps = 240 } = args;
    if (!context || typeof context !== 'object') {
        throw new Error('context required');
    }
    const pb = Number(context.pb_bin);
    if (!Number.isFinite(pb) || pb <= 0) {
        throw new Error(`invalid pb_bin: ${context.pb_bin}`);
    }
    if (!['easy', 'normal', 'hard'].includes(context.difficulty)) {
        throw new Error(`invalid difficulty: ${context.difficulty}`);
    }
    if (!['triplet-p1', 'budget-p2'].includes(context.generator)) {
        throw new Error(`invalid generator: ${context.generator}`);
    }
    if (!['random', 'clear-greedy', 'survival'].includes(context.bot_policy)) {
        throw new Error(`invalid bot_policy: ${context.bot_policy}`);
    }

    // v2.1: 5 维 θ 全部都是 simulator/adaptiveSpawn 真实消费的参数;
    // 训练样本 ⇄ Phase C 优化 ⇄ 客户端部署三处的 θ 维度严格对齐。
    // v2.1 关键: LHS 抽样产出的是浮点数, 但 simulator 内部某些路径会用
    // `cheapTop.length = maxEvaluatedTriplets` 直接设数组长度, 浮点数会
    // 抛 RangeError("Failed to set 'length' property on 'Array'")。
    // 这里把整数型 θ 统一在调用边界做归正, 避免下游每个消费点都防御一遍。
    const maxTriplets = Math.max(8, Math.min(256,
        Math.round(Number(theta.maxEvaluatedTriplets) || 80)
    ));
    let sim;
    try {
        sim = new OpenBlockSimulator(context.difficulty, {
            spawnGenerator: context.generator,
            maxEvaluatedTriplets: maxTriplets,
            bestScore: pb,
            modelConfig: {
                personalizationStrength: Number(theta.personalizationStrength) || 0.10,
                temperature: Number(theta.temperature) || 0.05,
                surpriseBudgetGain: Number(theta.surpriseBudgetGain) || 0.07,
                surpriseCooldown: Math.round(Number(theta.surpriseCooldown) || 6),
                // v2.2: PB 曲线参数 — simulator → derivePbCurve(options) → 真实生效
                pbTensionCenter: Number(theta.pbTensionCenter) || undefined,
                pbTensionWidth: Number(theta.pbTensionWidth) || undefined,
                pbBrakeCenter: Number(theta.pbBrakeCenter) || undefined,
                pbBrakeWidth: Number(theta.pbBrakeWidth) || undefined,
            },
        });
    } catch (e) {
        throw new Error(`OpenBlockSimulator init failed: ${e?.message || e}`);
    }
    const rng = _createRng(seed);
    const steps = [];

    for (let stepIdx = 0; stepIdx < maxSteps; stepIdx++) {
        if (sim.isTerminal()) {
            steps.push({
                stepIdx, score: sim.score,
                fillRate: sim.grid.getFillRatio(),
                actionFreedom: 0,    // 死局
                noMove: true,
                clears: 0,
            });
            break;
        }
        const action = _selectAction(sim, context.bot_policy, rng);
        if (!action) {
            steps.push({
                stepIdx, score: sim.score,
                fillRate: sim.grid.getFillRatio(),
                actionFreedom: 0,
                noMove: true,
                clears: 0,
            });
            break;
        }

        // action_freedom: 当前合法 action 数 / 估算上限
        const legal = sim.getLegalActions();
        const freedom = Math.min(1, legal.length / GRID_TOTAL_CELLS);

        sim.step(action.blockIdx, action.gx, action.gy);
        steps.push({
            stepIdx,
            score: sim.score,
            fillRate: sim.grid.getFillRatio(),
            actionFreedom: freedom,
            noMove: false,
            clears: sim._lastClears || 0,
        });
    }

    const labels = _extractDCurveFromSteps(steps, pb);
    if (!labels) {
        throw new Error(`d_curve extract failed (steps=${steps.length}, pb=${pb})`);
    }

    return {
        // context 5 维
        difficulty: context.difficulty,
        generator: context.generator,
        bot_policy: context.bot_policy,
        pb_bin: context.pb_bin,
        lifecycle_stage: context.lifecycle_stage,
        // theta 14 维 (JSON 字符串, server 端会反序列化)
        theta_json: JSON.stringify(theta),
        // labels
        d_curve_json: JSON.stringify(labels.d_curve),
        final_score: labels.final_score,
        survived_steps: labels.survived_steps,
        clear_rate: labels.clear_rate,
        noMove_step: labels.noMove_step,
        pb_broke: labels.pb_broke,
        surprise_count: labels.surprise_count,
        // 元信息
        seed,
        eval_ms: 0,           // sampler 自己也算耗时,由调用方填
        evaluated_at: Date.now(),
        algo_version: 'v2.10',   // v2.10: PB-aware d_step
    };
}


// ─────────── 批量采样 + 上传 v2 API ───────────

/**
 * 批量采样并写入 v2 sample_set。
 *
 * @param {object} args
 * @param {number} args.setId               — v2 sample_sets.set_id (先建)
 * @param {Array<object>} args.contexts     — 5 维 context 列表
 * @param {Array<object>} args.thetas       — 14 维 θ 列表
 * @param {number} [args.seedsPerTheta=2]
 * @param {number} [args.maxSteps=240]
 * @param {string} [args.apiBaseUrl='']
 * @param {number} [args.batchSize=20]      — 每多少 sample flush 一次
 * @param {function} [args.onProgress]      — ({completed, total, lastSample}) => void
 */
export async function collectSamplesV2(args) {
    const {
        setId, contexts, thetas,
        seedsPerTheta = 2, maxSteps = 240,
        apiBaseUrl = '', batchSize = 20, onProgress,
    } = args;
    if (!setId) throw new Error('setId required');
    if (!Array.isArray(contexts) || contexts.length === 0) throw new Error('contexts required');
    if (!Array.isArray(thetas) || thetas.length === 0) throw new Error('thetas required');

    const baseUrl = (apiBaseUrl || '').replace(/\/+$/, '');
    const total = contexts.length * thetas.length * seedsPerTheta;
    let generated = 0;   // 本地生成成功 (待 flush)
    let written = 0;     // 已写入 DB
    let failed = 0;
    let firstError = '';
    let batch = [];

    async function flush() {
        if (batch.length === 0) return;
        const payload = { samples: batch };
        const sentCount = batch.length;
        batch = [];
        let r;
        try {
            r = await fetch(`${baseUrl}/api/spawn-tuning-v2/sample-sets/${setId}/samples`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (e) {
            failed += sentCount;
            firstError = firstError || `flush network error: ${e?.message || e}`;
            return;
        }
        if (!r.ok) {
            failed += sentCount;
            let body = '';
            try { body = (await r.text()).slice(0, 200); } catch { /* ignore */ }
            firstError = firstError || `flush HTTP ${r.status}: ${body}`;
            return;
        }
        try {
            const j = await r.json();
            const ins = Number(j.inserted) || 0;
            const errs = Number(j.errors) || 0;
            written += ins;
            failed += errs;
            if (errs > 0 && !firstError) firstError = `server insert errors: ${errs}/${sentCount}`;
        } catch {
            written += sentCount; // 兜底: 没 json 但 r.ok, 视为成功
        }
    }

    for (const ctx of contexts) {
        for (const theta of thetas) {
            for (let s = 0; s < seedsPerTheta; s++) {
                const seed = (Date.now() & 0xFFFF_FFFF) ^ (generated * 7919);
                try {
                    const t0 = performance.now();
                    const sample = runOneSampleV2({ context: ctx, theta, seed, maxSteps });
                    sample.eval_ms = Math.round(performance.now() - t0);
                    batch.push(sample);
                    generated++;
                } catch (e) {
                    failed++;
                    const msg = e?.message || String(e);
                    if (!firstError) firstError = msg;
                    if (typeof console !== 'undefined') {
                        console.error('[samplerV2] error:', msg, e);
                    }
                }
                if (batch.length >= batchSize) {
                    await flush();
                }
                if (onProgress) {
                    onProgress({
                        completed: written + batch.length, // 本地包含 in-flight batch 作为乐观估算
                        failed, total,
                        percent: (written + batch.length + failed) / total,
                        firstError,
                    });
                }
            }
        }
    }
    await flush();
    return { completed: written, failed, total, firstError };
}


// 测试导出 (内部函数)
export const _internal = {
    stepDifficulty: _stepDifficulty,
    extractDCurveFromSteps: _extractDCurveFromSteps,
    createRng: _createRng,
};
