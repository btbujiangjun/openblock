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
import { CURVE_N_BINS, CURVE_R_MAX, rToBin, targetSCurve } from './targetSCurve.js';
// v2.10.35: generative — 调 SpawnPolicyNet V3 拿 dock (async HTTP, 失败 fallback 规则)
import { predictShapesV3 } from '../../spawnModel.js';
// v2.10.36: rl-bot — 调 PyTorch RL 服务选 action (HTTP, 失败 fallback clear-greedy)
import { buildDecisionBatch } from '../../bot/features.js';
import { selectActionRemote } from '../../bot/pytorchBackend.js';
// v3.2 严格 no-peek: θ 白名单 (与 Python feature_io.THETA_KEYS 同源), modelConfig 只收这些 key。
//   用 DEFAULT_THETA_V2 的 key 集 (= 36 维 θ 全集) 做白名单单一真源。
import { DEFAULT_THETA_V2 } from './clientPolicyV2.js';
import { createLogger } from '../../lib/logger.js';
const log = createLogger('samplerV2');


const THETA_KEY_SET = new Set(Object.keys(DEFAULT_THETA_V2));

// v3.2: RL bot 默认采样温度 (与 spawn θ 无关; 仅控制 action 采样的探索强度)。
const RL_BOT_DEFAULT_TEMPERATURE = 0.8;

// v3.2 高 r 定向采样: pb_bin 从低到高 (与 feature_io.PB_BIN_INDEX 同序)。
//   高 pb 档 bot 难触达 r=score/pb≈1, 高 r bin 样本稀疏; 给高 pb ctx 多跑几个 seed
//   以补齐"接近/突破 PB"段的观测, 这正是业务命题最关心的难度段。
const PB_BIN_ORDER = [500, 1500, 4000, 10000, 25000];

/**
 * 按 pb_bin 给"高 r 稀疏"的 ctx 分配更多 seed。
 *   highRBoost=0 → 恒等 (= baseSeeds, 完全向后兼容);
 *   highRBoost=b → seeds = round(baseSeeds × (1 + b × rank)), rank ∈ [0,1] 随 pb 升高。
 * 纯函数, 便于单测。
 */
function highRSeedCount(baseSeeds, pbBin, highRBoost = 0) {
    const base = Math.max(1, Math.round(Number(baseSeeds) || 1));
    const boost = Math.max(0, Number(highRBoost) || 0);
    if (boost === 0) return base;
    const i = PB_BIN_ORDER.indexOf(Number(pbBin));
    const rank = i < 0 ? 0 : i / (PB_BIN_ORDER.length - 1);
    return Math.max(base, Math.round(base * (1 + boost * rank)));
}

/**
 * v3.2 严格 no-peek 白名单: θ → simulator.modelConfig。
 *   只放行 THETA_KEYS_ORDER 中的真实 spawn θ; 任何非白名单字段 (历史 bot flag /
 *   伪装的"未来块"等) 一律丢弃, 从源头杜绝非 θ 信息泄漏进出块管线。
 *   纯函数, 便于单测 (samplerV2.test.js no-peek 守卫)。
 */
function buildSpawnModelConfig(theta) {
    const modelConfig = {};
    for (const [k, v] of Object.entries(theta || {})) {
        if (!THETA_KEY_SET.has(k)) continue;
        const n = Number(v);
        if (Number.isFinite(n)) modelConfig[k] = (k === 'surpriseCooldown') ? Math.round(n) : n;
    }
    return modelConfig;
}

// v3.0.8: generator 与 game.js getSpawnPolicyMode() 严格 1:1 (无 alias / 无历史枚举)
//   'rule'       — 启发式: sampler 内部 simulator.spawnGenerator='budget-p2' (game.js rule 模式 default)
//                  并把 θ 注入 modelConfig, 跟 game.js 通过 resolveThetaV2 拿 θ 后调
//                  derivePbCurve/adaptiveSpawn 的链路 1:1 对齐.
//   'generative' — 生成式: sampler 主 loop 通过 HTTP 调 predictShapesV3 (SpawnPolicyNet),
//                  与 game.js _spawnBlocksWithModel 同一接口.
export const VALID_GENERATORS_SAMPLER = ['rule', 'generative'];

// ─────────── v3.2 lifecycle-in-sim: 让 context.lifecycle_stage 真正驱动模拟 ───────────
//
// 背景: 此前 lifecycle_stage 只被原样写进样本 (一个"死标签"), 对模拟轨迹零影响 →
//   model 无从学到 lifecycle-conditioned θ, 部署表里 4 个 lifecycle 档拿到的曲线几乎同质。
//
// 修复: 把 4 个训练态 lifecycle stage 映射到 PlayerProfile 的"三大裸字段"
//   (_daysSinceInstall / _totalSessions / _daysSinceLastActive)。adaptiveSpawn 的
//   computeStress 读这三字段 → getLifecycleMaturitySnapshot 派生 S0..S4 stage + M-band
//   → 查 lifecycleStressCapMap (S0/S4 强保护低 cap、S2/S3 高 cap) → 不同 lifecycle 拿到
//   不同 stress cap/adjust → 出块决策分化 → d/e/f 曲线随 lifecycle 真实分层。
//
// 非循环性: lifecycle 是"开局前已知的玩家画像", 不是局内 outcome, 作为 context 注入无泄漏。
//   (对比: pressurePhase/spawnIntent 是局内涌现量, 作为 model 输入会造成 outcome leakage,
//    故 context-dims 维持取消; 其经验语义已被 Phase 2 的 E/F 多曲线以 20-bin 形式覆盖。)
//
// 映射依据见 retention/playerLifecycleDashboard.js 的 LIFECYCLE_THRESHOLDS 与
//   lifecycle/lifecycleStressCapMap.js 的 S0..S4 cap 表。
const LIFECYCLE_SIM_PROFILE = Object.freeze({
    onboarding: { daysSinceInstall: 1, totalSessions: 3, daysSinceLastActive: 0 },     // → S0 新入场 (强保护)
    growth: { daysSinceInstall: 20, totalSessions: 120, daysSinceLastActive: 0 },      // → S2 成长 (PB 主战场)
    mature: { daysSinceInstall: 60, totalSessions: 350, daysSinceLastActive: 0 },      // → S3 稳定 (高 cap)
    plateau: { daysSinceInstall: 120, totalSessions: 600, daysSinceLastActive: 10 },   // → S4 回流/veteran
});

/**
 * v3.2: 把 context.lifecycle_stage 注入 simulator 的 PlayerProfile, 使其真实驱动出块。
 *   直接写"三大裸字段" (adaptiveSpawn 优先读 profile?._daysSinceInstall ?? ...), 不触碰
 *   _installTs 等派生源, 保证 snapshot stage 完全由本映射决定。未知 stage → 回退 onboarding。
 *   纯函数 (原地 mutate + return), 便于单测。
 * @param {object} profile  OpenBlockSimulator.playerProfile
 * @param {string} lifecycleStage  'onboarding' | 'growth' | 'mature' | 'plateau'
 * @returns {object} 同一 profile (便于链式)
 */
export function applyLifecycleStageToProfile(profile, lifecycleStage) {
    if (!profile) return profile;
    const cfg = LIFECYCLE_SIM_PROFILE[lifecycleStage] || LIFECYCLE_SIM_PROFILE.onboarding;
    profile._daysSinceInstall = cfg.daysSinceInstall;
    profile._totalSessions = cfg.totalSessions;
    profile._daysSinceLastActive = cfg.daysSinceLastActive;
    return profile;
}

// ─────────── 单步难度信号常量 (与 Python extractor.py 一致) ───────────

const FILL_RATE_WEIGHT = 0.30;
const ACTION_FREEDOM_WEIGHT = 0.50;
const TREND_WEIGHT = 0.20;
const SURPRISE_DAMPING = 0.50;
const SURPRISE_MIN_CLEARS = 3;
const TREND_WINDOW = 5;

// ─── v3.2 多曲线: 单步爽感 e_step / 挫败 f_step (与 Python extractor.py 严格一致) ───
const DELIGHT_PER_CLEAR = 0.45;
const FRUSTRATION_STUCK_WEIGHT = 0.60;
const FRUSTRATION_CROWD_WEIGHT = 0.40;
const FRUSTRATION_CROWD_FILL_FLOOR = 0.70;
const FRUSTRATION_RELIEF_WEIGHT = 0.50;

/** 单步爽感 ∈ [0,1] — clears 驱动 (跨语言: extractor.delight_step)。 */
function _stepDelight(step) {
    if (step.noMove) return 0.0;
    return Math.max(0, Math.min(1, DELIGHT_PER_CLEAR * (step.clears || 0)));
}

/** 单步挫败 ∈ [0,1] — 卡顿+拥挤-清行救济 (跨语言: extractor.frustration_step)。 */
function _stepFrustration(step) {
    if (step.noMove) return 1.0;
    const stuck = 1.0 - Math.max(0, Math.min(1, step.actionFreedom));
    const crowd = Math.max(0, Math.min(1, (step.fillRate - FRUSTRATION_CROWD_FILL_FLOOR) / 0.30));
    const relief = (step.clears || 0) > 0 ? 1.0 : 0.0;
    const f = FRUSTRATION_STUCK_WEIGHT * stuck
        + FRUSTRATION_CROWD_WEIGHT * crowd
        - FRUSTRATION_RELIEF_WEIGHT * relief;
    return Math.max(0, Math.min(1, f));
}

// 用于估算 action_freedom 上限的 grid 总位置数 (8×8 板)
const GRID_TOTAL_CELLS = 64;


// ─────────── 单步难度 (v2.10: PB-aware, 跨语言 Python extractor.py 同步) ───────────
//
// 病例 (job_13/14/16, 5000 样本验证): 老公式 d 跟 r=score/PB 完全无关,
//   d_curve 跨度仅 0.474→0.679 (Δ=0.20), 当前业务期望 0.10→1.00 (Δ=0.90) 是 4×+。
//   模型再怎么训, 学到的都是训练 label 的形态, 永远 < ideal target。
//
// v2.10 修复: d_step 显式编码 PB 命题
//   d_pb_base(ratio): 基础 S 形 (业务命题 "接近 PB 加压、超 PB 持续加压"),
//                     范围 [D_BASE, D_PEAK] = [0.40, 0.85]
//   state_d (老公式): 棋盘状态难度 [0, 1] 作为扰动 (±0.15)
//
// 跨 ctx 差异由 state_d 携带 (hard 难度棋盘更紧、normal 居中),
// 因此模型仍能学到 ctx → state_offset 模式。

// PB-aware 常量 (跨语言: extractor.py + policyMetricsV2.js 严格同步)
// v2.12 起 d_pb_base 直接复用 targetSCurve (legacy, 不参与 v3.x 计算).
/* eslint-disable no-unused-vars -- legacy 跨语言镜像常量，保留原名与 extractor.py 对齐 */
const PB_AWARE_D_BASE = 0.10;       // legacy
const PB_AWARE_D_PEAK = 1.00;       // legacy
const PB_AWARE_CENTER = 0.85;       // legacy
const PB_AWARE_WIDTH  = 0.18;       // legacy
const PB_AWARE_STATE_WEIGHT = 0.20; // legacy
// 贝叶斯先验平滑
const PB_AWARE_PRIOR_STRENGTH = 3;
/* eslint-enable no-unused-vars */
const PB_AWARE_MIN_OBS = 1;

// v3.1 (G5 物理侧 θ 接入): θ 通过 PB-aware sigmoid 影响 d_step
//   d_step = (1-BLEND)*state_d + BLEND*sigmoid((r - θ_center) / θ_width)
//   BLEND=0.40 → 物理 60% + PB-aware 40%, 启发式实测 d_curve 自然有 r 依赖
const PB_AWARE_BLEND = 0.40;
const PB_AWARE_TENSION_CENTER_DEFAULT = 0.82;
const PB_AWARE_TENSION_WIDTH_DEFAULT = 0.08;

function _pbAwareDPbBase(ratio) {
    // v3.0: legacy 函数 — 已不参与 d_step 计算 (sample 回归真实状态).
    //   保留供跨语言一致性测试. 调用方应改用 state_d.
    return targetSCurve(ratio);
}

function _stepDifficulty(
    step,
    recentFills,
    ratio = 0,
    thetaPbTensionCenter = PB_AWARE_TENSION_CENTER_DEFAULT,
    thetaPbTensionWidth = PB_AWARE_TENSION_WIDTH_DEFAULT,
) {
    // v3.1 (G5): d_step = (1-BLEND)*state_d + BLEND*pb_aware_lift(r, θ_center, θ_width)
    //   θ 让 d_step 物理上感知 PB → 启发式实测 d_curve 自然有 S 形 r 依赖.
    //   不同 θ 让同一棋盘状态对应不同 d_step → ctx/θ 信号强 → 寻参更有效.
    if (step.noMove) return 1.0;
    let trendNorm = 0.5;
    if (recentFills.length > 0) {
        const avg = recentFills.reduce((a, b) => a + b, 0) / recentFills.length;
        const trend = step.fillRate - avg;
        trendNorm = Math.max(0, Math.min(1, 0.5 + trend));
    }
    let stateD = FILL_RATE_WEIGHT * step.fillRate
        + ACTION_FREEDOM_WEIGHT * (1 - step.actionFreedom)
        + TREND_WEIGHT * trendNorm;
    stateD = Math.max(0, Math.min(1, stateD));
    if ((step.clears || 0) >= SURPRISE_MIN_CLEARS) {
        stateD *= SURPRISE_DAMPING;
    }
    // v3.1 (G5): PB-aware lift 项 — θ 控制的物理调制
    if (PB_AWARE_BLEND > 0 && thetaPbTensionWidth > 1e-6) {
        const x = (ratio - thetaPbTensionCenter) / thetaPbTensionWidth;
        const pbLift = 1.0 / (1.0 + Math.exp(-x));   // ∈ (0, 1)
        const dStep = (1.0 - PB_AWARE_BLEND) * stateD + PB_AWARE_BLEND * pbLift;
        return Math.max(0, Math.min(1, dStep));
    }
    return stateD;
}


/** 从单局轨迹提取 d_curve + 标签 (与 policyMetricsV2._extractDCurve / Python 严格一致)
 *  v3.1 (G5): 接收 theta 让 PB-aware d_step 用 θ 控制的 sigmoid 而非默认值 */
function _extractDCurveFromSteps(
    steps, pb,
    nBins = CURVE_N_BINS, rMax = CURVE_R_MAX,
    theta = null,
) {
    if (!steps || steps.length === 0 || !pb || pb <= 0) return null;
    const thetaCenter = (theta && Number.isFinite(theta.pbTensionCenter))
        ? theta.pbTensionCenter : PB_AWARE_TENSION_CENTER_DEFAULT;
    const thetaWidth = (theta && Number.isFinite(theta.pbTensionWidth))
        ? theta.pbTensionWidth : PB_AWARE_TENSION_WIDTH_DEFAULT;
    const binSums = new Array(nBins).fill(0);
    const binCounts = new Array(nBins).fill(0);
    // v3.2 多曲线: 爽感 / 挫败 共用 binning + binCounts
    const eBinSums = new Array(nBins).fill(0);
    const fBinSums = new Array(nBins).fill(0);
    const recentFills = [];
    let totalClears = 0, noMoveStep = -1, surpriseCount = 0, finalScore = 0;

    for (const st of steps) {
        const r = Math.min(rMax - 1e-9, st.score / pb);
        const bidx = rToBin(r, nBins, rMax);
        // v3.1 (G5): 把 θ 传给 _stepDifficulty 用 PB-aware sigmoid 调制
        const d = _stepDifficulty(st, recentFills, r, thetaCenter, thetaWidth);
        binSums[bidx] += d;
        binCounts[bidx] += 1;
        // v3.2 多曲线: 同步累积爽感 / 挫败
        eBinSums[bidx] += _stepDelight(st);
        fBinSums[bidx] += _stepFrustration(st);
        recentFills.push(st.fillRate);
        if (recentFills.length > TREND_WINDOW) recentFills.shift();
        totalClears += st.clears || 0;
        if ((st.clears || 0) >= SURPRISE_MIN_CLEARS) surpriseCount += 1;
        if (st.noMove && noMoveStep < 0) noMoveStep = st.stepIdx;
        finalScore = st.score;
    }

    // v3.0: 空 bin 用 lastValue 填充 (前一个有数据 bin 的值, 防止 d_curve 断裂)
    //   注意: bin_counts[i] = 0 时, 训练 L_shape confidence-weighted 会 mask 该 bin
    //         所以填什么不影响训练, 仅用于 chart 显示连续性
    const dCurve = new Array(nBins).fill(0);
    const eCurve = new Array(nBins).fill(0);
    const fCurve = new Array(nBins).fill(0);
    let nFilled = 0;
    let lastValue = 0.5;   // 兜底初值
    let lastE = 0.0, lastF = 0.0;
    for (let i = 0; i < nBins; i++) {
        if (binCounts[i] >= PB_AWARE_MIN_OBS) {
            dCurve[i] = binSums[i] / binCounts[i];
            lastValue = dCurve[i];
            eCurve[i] = eBinSums[i] / binCounts[i];
            fCurve[i] = fBinSums[i] / binCounts[i];
            lastE = eCurve[i];
            lastF = fCurve[i];
            nFilled++;
        } else {
            dCurve[i] = lastValue;
            eCurve[i] = lastE;
            fCurve[i] = lastF;
        }
    }

    return {
        d_curve: dCurve,
        e_curve: eCurve,
        f_curve: fCurve,
        final_score: finalScore,
        survived_steps: steps.length,
        clear_rate: steps.length > 0 ? totalClears / steps.length : 0,
        noMove_step: noMoveStep,
        pb_broke: finalScore > pb,
        surprise_count: surpriseCount,
        n_steps: steps.length,
        n_bins_filled: nFilled,
        // v2.10.32 (P0.1+P0.2): 逐 bin 真实观察样本数, 0 表示该 bin 完全靠先验
        // 训练时按 confidence = n / (n + PRIOR_STRENGTH) 加权 loss 避免学 prior
        bin_counts: binCounts.slice(),
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

// v2.10.32 (P1.2 + v2.10.33 fix): 2-step lookahead
//   原 v2.10.32 假设 sim.clone() 存在 — 实际 simulator 没 clone 方法 — 退化 return 0
//   v2.10.33 修复: 用 sim.saveState() / restoreState() 替代 (这俩已存在), 让 2-step 真正生效
function _evalWith2StepLookahead(sim, a1, ev1, rng, policy) {
    if (!sim.saveState || !sim.restoreState) return 0;
    const state = sim.saveState();
    let best2 = -Infinity;
    try {
        sim.step(a1.blockIdx, a1.gx, a1.gy);
        if (sim.isTerminal && sim.isTerminal()) {
            best2 = -100;   // a1 导致死局 → 强烈避免
        } else {
            const legal2 = sim.getLegalActions();
            if (legal2.length === 0) {
                best2 = -50;
            } else {
                const sampleCount = Math.min(20, legal2.length);
                for (let i = 0; i < sampleCount; i++) {
                    const idx = (i * 17 + Math.floor(rng() * 13)) % legal2.length;
                    const a2 = legal2[idx];
                    const ev2 = _previewAction(sim, a2);
                    let s2;
                    if (policy === 'clear-greedy') {
                        s2 = ev2.clears * 100 - ev2.fill * 2;
                    } else {
                        s2 = (ev2.clears > 0 ? 50 : 0) - ev2.fill * 3;
                    }
                    if (s2 > best2) best2 = s2;
                }
            }
        }
    } finally {
        sim.restoreState(state);   // 关键: 不管成功失败都恢复 sim 状态
    }
    return best2;
}


// v2.10.33 (P2.1): MCTS bot — N 次随机 rollout 评估每个候选 action
//   思路: 对每个 a1, 用 saveState/restoreState 在 sim 上做:
//     1. step(a1)
//     2. 从 a1 后状态做 R 次 random rollout 到终止或 maxRolloutSteps 步
//     3. 取 R 次的平均 final_score (或 score 增量)
//   选 score 最高的 a1
//
//   复杂度: K legal × R rollouts × L steps ≈ 50 × 30 × 30 = 45000 step/选 action
//   比 lookahead-2 (~100 ops/选) 慢 ~500x — 但 bot 强度提升 +100%~150%
//   实测: clear-greedy 1step ~15 score/step → MCTS 30 rollout × 30 step ~40 score/step
//
//   注: 因开销大, 默认只 MCTS 评 top-K=10 (按 1-step score 预筛), 其余直接 1-step
// v2.10.38 → v3.0.5: MCTS 改为 async, 每 MCTS_YIELD_EVERY_ROLLOUT 让一次主线程
// 避免 "页面无响应": 单 action 在 top-K=10 × 30 rollout × 30 step ≈ 9000 sim.step
// 同步跑会独占主线程 5-10s; 现在每 5 rollout (≈1500 step) yield 一次, 浏览器仍可响应
const MCTS_YIELD_EVERY_ROLLOUT = 5;

async function _evalWithMCTS(sim, a1, rng, policy, nRollouts, maxRolloutSteps) {
    if (!sim.saveState || !sim.restoreState) return 0;
    const state = sim.saveState();
    let totalReturn = 0;
    let validRollouts = 0;
    try {
        for (let r = 0; r < nRollouts; r++) {
            if (r > 0 && r % MCTS_YIELD_EVERY_ROLLOUT === 0) {
                await new Promise((res) => setTimeout(res, 0));
            }
            sim.restoreState(state);
            try {
                sim.step(a1.blockIdx, a1.gx, a1.gy);
            } catch (_) {
                continue;
            }
            // Random rollout 到终止或最大步数
            let rolloutSteps = 0;
            while (rolloutSteps < maxRolloutSteps) {
                if (sim.isTerminal && sim.isTerminal()) break;
                const legal = sim.getLegalActions();
                if (legal.length === 0) break;
                // ε-greedy rollout: 30% random, 70% clear-greedy 启发式 (轻量)
                let chosen;
                if (rng() < 0.30) {
                    chosen = legal[Math.floor(rng() * legal.length)];
                } else {
                    // 简化 greedy: 估 5 个 random 候选, 选 clears 最多的
                    let bestEv = -Infinity;
                    chosen = legal[0];
                    const probe = Math.min(5, legal.length);
                    for (let k = 0; k < probe; k++) {
                        const cand = legal[Math.floor(rng() * legal.length)];
                        const ev = _previewAction(sim, cand);
                        const sc = ev.clears * 100 - ev.fill * 2;
                        if (sc > bestEv) { bestEv = sc; chosen = cand; }
                    }
                }
                try {
                    sim.step(chosen.blockIdx, chosen.gx, chosen.gy);
                } catch (_) { break; }
                rolloutSteps++;
            }
            // return = 从 a1 起 rollout 期间累积 score (含 a1 本身得到的分)
            totalReturn += (sim.score - state.score);
            validRollouts++;
        }
    } finally {
        sim.restoreState(state);
    }
    return validRollouts > 0 ? totalReturn / validRollouts : 0;
}

async function _selectAction(sim, policy, rng, opts = {}) {
    const legal = sim.getLegalActions();
    if (legal.length === 0) return null;

    if (policy === 'random') {
        return legal[Math.floor(rng() * legal.length)];
    }

    // G8 v2.10.9: 1-step lookahead 通过 opts.lookahead=true 切换
    // v2.10.32 (P1.2): 2-step lookahead 通过 opts.lookahead2=true 切换 (隐含 lookahead)
    // v2.10.33 (P2.1): MCTS rollout 通过 opts.mcts=true 切换 (最强 bot, 慢)
    const useLookahead = !!opts.lookahead || !!opts.lookahead2 || !!opts.mcts;
    const useLookahead2 = !!opts.lookahead2;
    const useMCTS = !!opts.mcts;
    const mctsRollouts = Math.max(5, Math.min(100, opts.mctsRollouts || 30));
    const mctsRolloutSteps = Math.max(5, Math.min(50, opts.mctsRolloutSteps || 30));

    // 1-step 评分 — 所有模式共用
    const scored = legal.map((action) => {
        const ev = _previewAction(sim, action);
        let score;
        if (policy === 'clear-greedy') {
            score = ev.clears * (useLookahead ? 200 : 100) - ev.fill * 2;
            if (useLookahead && ev.clears >= 3) score += 50;
        } else if (policy === 'survival') {
            score = (ev.clears > 0 ? 50 : 0) - ev.fill * 3;
        } else {
            score = 0;
        }
        if (useLookahead) {
            const survivalProxy = 1.0 - ev.fill;
            score += survivalProxy * 30;
        }
        score += rng() * 1e-6;
        return { action, ev, score };
    });

    if (!useLookahead2 && !useMCTS) {
        let best = scored[0];
        for (const s of scored) if (s.score > best.score) best = s;
        return best.action;
    }

    // top-K 预筛 (避免对所有 legal 都跑昂贵的二级评估)
    scored.sort((a, b) => b.score - a.score);

    if (useMCTS) {
        // v2.10.33 (P2.1): MCTS — top-K=10 候选上跑 N rollout
        const K = Math.min(10, scored.length);
        let best = scored[0];
        let bestTotal = -Infinity;
        for (let i = 0; i < K; i++) {
            const s = scored[i];
            const mctsValue = await _evalWithMCTS(sim, s.action, rng, policy, mctsRollouts, mctsRolloutSteps);
            // MCTS 期望回报 = rollout 期间累积 score 增量
            // 跟 1-step heuristic score 比例不一致, 给 mctsValue 设标准化系数
            const total = s.score * 0.1 + mctsValue * 1.0;   // MCTS 占主导, 1-step 仅打破并列
            if (total > bestTotal) { bestTotal = total; best = s; }
        }
        return best.action;
    }

    // v2.10.32 (P1.2): 2-step — 在 top-K=5 候选上做二级 lookahead
    const K = Math.min(5, scored.length);
    let best = scored[0];
    let bestTotal = -Infinity;
    for (let i = 0; i < K; i++) {
        const s = scored[i];
        const score2 = _evalWith2StepLookahead(sim, s.action, s.ev, rng, policy);
        const total = s.score + score2 * 0.5;
        if (total > bestTotal) { bestTotal = total; best = s; }
    }
    return best.action;
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
 * @param {number} [args.maxSteps=500]   v2.10.32 (P1.3): 240 → 500
 *
 * @throws {Error} 当 context 不合法 / simulator 初始化失败 / 轨迹无法提取 d_curve 时
 *                 抛出 (调用方在 collectSamplesV2 中 catch + 把第一个 error message 暴露给 UI)
 *
 * v2.10.35: 改成 async — generative 模式下需 await `predictShapesV3` (HTTP).
 *           其他模式仍同步执行 (Promise.resolve 包装), 性能跟原同步版一致.
 */
export async function runOneSampleV2(args) {
    // v3.2 严格 no-peek: bot 行为只由 botConfig + 当前局面决定, 与 spawn θ 完全解耦。
    //   botConfig 是与 θ 物理隔离的独立对象 (采集脚本/面板显式传入), bot 决策代码
    //   绝不读取 args.theta 任何字段, 从结构上杜绝 "RL/启发式 bot 偷看出块策略参数"。
    const { context, theta, seed, maxSteps = 500, botConfig = {} } = args;
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
    // v3.0.8: generator 与 game.js getSpawnPolicyMode() 严格 1:1
    if (!VALID_GENERATORS_SAMPLER.includes(context.generator)) {
        throw new Error(`invalid generator: ${context.generator} (期望 rule / generative)`);
    }
    const isGenerative = context.generator === 'generative';
    // v2.10.34/36: 4 个 bot_policy 都可用 (rl-bot 通过 HTTP 调 /api/rl/select_action, 失败 fallback clear-greedy)
    if (!['random', 'clear-greedy', 'survival', 'rl-bot'].includes(context.bot_policy)) {
        throw new Error(`invalid bot_policy: ${context.bot_policy}`);
    }
    const isRLBot = context.bot_policy === 'rl-bot';

    // v2.1: 5 维 θ 全部都是 simulator/adaptiveSpawn 真实消费的参数;
    // 训练样本 ⇄ Phase C 优化 ⇄ 客户端部署三处的 θ 维度严格对齐。
    // v2.1 关键: LHS 抽样产出的是浮点数, 但 simulator 内部某些路径会用
    // `cheapTop.length = maxEvaluatedTriplets` 直接设数组长度, 浮点数会
    // 抛 RangeError("Failed to set 'length' property on 'Array'")。
    // 这里把整数型 θ 统一在调用边界做归正, 避免下游每个消费点都防御一遍。
    const maxTriplets = Math.max(8, Math.min(256,
        Math.round(Number(theta.maxEvaluatedTriplets) || 80)
    ));
    // v3.0.8: generator → simulator.spawnGenerator 映射 (与 game.js 严格 1:1)
    //   'rule'       → 'baseline' (即 SPAWN_POLICY_RULES) — simulator._spawnDock 走
    //                  `generateDockShapes(grid, layered, spawnContext)`, 跟 game.js
    //                  `_commitSpawn(generateDockShapes(...), 'rule')` 是同一函数同一参数.
    //                  θ 通过 modelConfig 注入, 等价于 game.js 通过 resolveThetaV2 → derivePbCurve.
    //                  注: 老版本 v3.0.7 用 'budget-p2' 是错的 (那条路径走 generateExperimentalDockShapes,
    //                      游戏页面 rule 模式不会调到, 等价于"采集跑实验算法 ≠ 部署跑规则算法").
    //   'generative' → 'baseline' (sim 启动占位, 主 loop 调 predictShapesV3 mutate dock,
    //                  跟 game.js `_spawnBlocksWithModel` 同一 SpawnPolicyNet 接口)
    const simSpawnGenerator = 'baseline';
    // 把 θ 全部 27 维透传给 simulator → simulator 注入 ctx.modelConfig → 各 derive*/augmentPool 消费.
    // 跟 game.js 通过 resolveThetaV2 → derivePbCurve / generateDockShapes 完全等价.
    // v3.2: modelConfig 只接收真实 spawn θ (THETA_KEYS_ORDER 白名单), 任何非 θ 字段一律
    //   不进 modelConfig — bot 控制项现在走独立 botConfig, 不会再混进 θ 对象。
    const modelConfig = buildSpawnModelConfig(theta);
    let sim;
    try {
        sim = new OpenBlockSimulator(context.difficulty, {
            spawnGenerator: simSpawnGenerator,
            maxEvaluatedTriplets: Number(theta?.maxEvaluatedTriplets) || maxTriplets,
            bestScore: pb,
            modelConfig,
        });
    } catch (e) {
        throw new Error(`OpenBlockSimulator init failed: ${e?.message || e}`);
    }
    // v3.2 lifecycle-in-sim: 注入 lifecycle_stage → profile, 让 adaptiveSpawn 的 lifecycle
    //   stress cap 真实生效 (此前 lifecycle 是死标签, 对轨迹零影响)。
    applyLifecycleStageToProfile(sim.playerProfile, context.lifecycle_stage);
    const rng = _createRng(seed);
    const steps = [];
    // v2.10.35: generative 模式 — 跟踪 sim.placements, dock 重新生成时 await V3 替换
    let lastGenerativeReplaceAt = -1;
    const recentHistory = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];   // V3 需要的 history (此处简化, 不维护精确)

    // v3.0.5: MCTS / lookahead2 单 step 极贵 (MCTS ≈ 9000 sim.step / action),
    //         必须每 step 都 yield, 否则单 sample 长达分钟级 → "页面无响应"
    const useHeavyBot = !!(botConfig.useMcts || botConfig.useLookahead2);
    const STEP_YIELD_EVERY = useHeavyBot ? 1 : 100;
    for (let stepIdx = 0; stepIdx < maxSteps; stepIdx++) {
        if (stepIdx > 0 && stepIdx % STEP_YIELD_EVERY === 0) {
            await new Promise((r) => setTimeout(r, 0));
        }
        if (sim.isTerminal()) {
            steps.push({
                stepIdx, score: sim.score,
                fillRate: sim.grid.getFillRatio(),
                actionFreedom: 0,
                noMove: true,
                clears: 0,
            });
            break;
        }
        // v2.10.35: generative — 检测 dock 是否刚被 sim 重新生成 (全部 placed=false)
        //   sim._spawnDock 在 init + 每次 dock 用尽后被调; placements 是不变量
        if (isGenerative && sim.placements !== lastGenerativeReplaceAt
                && sim.dock.every((b) => !b.placed)) {
            try {
                const v3 = await predictShapesV3(
                    sim.grid, sim.playerProfile, recentHistory, sim._lastAdaptiveInsight,
                    { temperature: 0.8, enforceFeasibility: true },
                );
                if (v3 && Array.isArray(v3.shapes) && v3.shapes.length === 3) {
                    // mutate sim.dock 用 V3 shape 替换 (保留 colorIdx)
                    for (let i = 0; i < 3; i++) {
                        const s = v3.shapes[i];
                        if (s && s.data) {
                            sim.dock[i].shape = s.data;
                            sim.dock[i].id = s.id;
                        }
                    }
                }
                // V3 失败时 fallback 保留 sim 原生 baseline dock (不影响采样继续)
            } catch (e) {
                // 静默 fallback (网络抖动不应阻断整局采样)
                if (typeof console !== 'undefined') {
                    log.warn('[samplerV2 generative] V3 predict failed, fallback baseline:', e?.message);
                }
            }
            lastGenerativeReplaceAt = sim.placements;
        }
        // v2.10.36: rl-bot — 调 PyTorch RL 服务选 action; 失败 fallback clear-greedy
        let action = null;
        if (isRLBot) {
            try {
                const { legal, stateFeat, phiList } = buildDecisionBatch(sim);
                if (legal.length > 0) {
                    const temperature = Number(botConfig.rlTemperature) || RL_BOT_DEFAULT_TEMPERATURE;
                    const idx = await selectActionRemote(phiList, stateFeat, temperature);
                    if (Number.isInteger(idx) && idx >= 0 && idx < legal.length) {
                        action = legal[idx];
                    }
                }
            } catch (e) {
                if (typeof console !== 'undefined') {
                    log.warn('[samplerV2 rl-bot] RL HTTP failed, fallback clear-greedy:', e?.message);
                }
            }
            // fallback: clear-greedy (跟 rl-bot 同级 strong bot, RL 不可用时数据仍可用)
            if (!action) {
                action = await _selectAction(sim, 'clear-greedy', rng, {});
            }
        } else {
            action = await _selectAction(sim, context.bot_policy, rng, {
                lookahead: !!botConfig.useLookahead,
                lookahead2: !!botConfig.useLookahead2,
                mcts: !!botConfig.useMcts,
                mctsRollouts: botConfig.mctsRollouts || 30,
                mctsRolloutSteps: botConfig.mctsRolloutSteps || 30,
            });
        }
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

    // v3.1 (G5): 传 θ 让 d_step PB-aware sigmoid 用 θ.pbTensionCenter/Width
    const labels = _extractDCurveFromSteps(steps, pb, CURVE_N_BINS, CURVE_R_MAX, theta);
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
        // v3.2 多曲线: 爽感 / 挫败 (server 端写入 e_curve_json / f_curve_json 列)
        e_curve_json: JSON.stringify(labels.e_curve),
        f_curve_json: JSON.stringify(labels.f_curve),
        final_score: labels.final_score,
        survived_steps: labels.survived_steps,
        clear_rate: labels.clear_rate,
        noMove_step: labels.noMove_step,
        pb_broke: labels.pb_broke,
        surprise_count: labels.surprise_count,
        // v2.10.32 (P0): bin 真实观察元数据 (用于 UI 透明化 + 训练 confidence loss)
        n_bins_filled: labels.n_bins_filled,
        bin_counts: labels.bin_counts,
        // 元信息
        seed,
        eval_ms: 0,
        evaluated_at: Date.now(),
        algo_version: 'v3.1',    // v3.1 (G5): d_step = (1-BLEND)*state_d + BLEND*pb_aware_lift(r, θ)
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
 * @param {number} [args.maxSteps=500]   v2.10.32 (P1.3): 240 → 500
 * @param {string} [args.apiBaseUrl='']
 * @param {number} [args.batchSize=20]      — 每多少 sample flush 一次
 * @param {function} [args.onProgress]      — ({completed, total, lastSample}) => void
 */
export async function collectSamplesV2(args) {
    const {
        setId, contexts, thetas,
        // v2.10.32 (P1.3): 240 → 500 — 配合强 bot, 高 PB 档 r=1 触达率 +
        seedsPerTheta = 2, maxSteps = 500,
        apiBaseUrl = '', batchSize = 20, onProgress,
        // v3.0.6 (G2): nThetas 当 thetas 是 function 时由调用方指定每 ctx 抽几个 θ
        nThetas,
        // v3.2 严格 no-peek: bot 控制项独立于 θ, 统一从这里透传给 runOneSampleV2。
        botConfig = {},
        // v3.2 高 r 定向采样: >0 时高 pb_bin ctx 按 rank 放大 seed 数 (补齐高 r 稀疏段)。
        highRBoost = 0,
    } = args;
    if (!setId) throw new Error('setId required');
    if (!Array.isArray(contexts) || contexts.length === 0) throw new Error('contexts required');
    // v3.0.6 (G2): thetas 支持两种形态
    //   - Array<theta>: 全 ctx 共用 (LHS 模式)
    //   - (ctx) => Array<theta>: per-ctx 生成 (bundle / bundle-perturb 模式)
    const isThetasFn = typeof thetas === 'function';
    if (!isThetasFn && (!Array.isArray(thetas) || thetas.length === 0)) {
        throw new Error('thetas required (array or function)');
    }
    if (isThetasFn && !(nThetas > 0)) {
        throw new Error('nThetas required when thetas is a function');
    }

    const baseUrl = (apiBaseUrl || '').replace(/\/+$/, '');
    const thetasPerCtx = isThetasFn ? nThetas : thetas.length;
    // v3.2 高 r 定向: 每 ctx 的 seed 数可随 pb_bin 放大, total 按各 ctx 求和。
    const seedsForCtx = (ctx) => highRSeedCount(seedsPerTheta, ctx?.pb_bin, highRBoost);
    const total = contexts.reduce((acc, ctx) => acc + thetasPerCtx * seedsForCtx(ctx), 0);
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
            // v2.10.37: 透传 server first_error 详情, 不止显示数字
            if (errs > 0 && !firstError) {
                const serverHint = j.first_error ? ` (${j.first_error})` : '';
                firstError = `server insert errors: ${errs}/${sentCount}${serverHint} — 请查看后端日志确认 CHECK / 字段问题`;
            }
        } catch {
            written += sentCount;
        }
    }

    // v2.10.38: 主 loop 让出主线程 + onProgress 节流
    //   病例 (Chrome Helper 100% CPU + 页面无响应): sampler 同步跑 7680 sample,
    //   每个 sample 30-300ms (含 bot 决策 + sim.step), 主线程被独占, paint/input 完全阻塞.
    //   修复:
    //     1. 每 PROGRESS_YIELD_EVERY 个 sample setTimeout(0) → 让浏览器 paint/响应 click
    //     2. onProgress 节流: 200ms 间隔 + sample 数节流 (每 50 / 200 个) 二选一最近触发
    const PROGRESS_YIELD_EVERY = 8;     // 每 8 sample 让一次主线程
    const PROGRESS_THROTTLE_MS = 200;   // onProgress 至少间隔 200ms
    let lastProgressAt = 0;
    let sampleSinceLastProgress = 0;

    // v3.0.5: 重型 bot (MCTS/lookahead2) 单 sample 可达 60-120s, 期间 onProgress 不会触发,
    //         UI 看着像 "卡住"; 增加 inFlight 心跳, 让 UI 知道正在跑哪个 sample 以及单 sample 已耗时.
    let inFlightStartedAt = 0;
    let inFlightIdx = 0;

    const _maybeReportProgress = (force = false) => {
        if (!onProgress) return;
        const now = performance.now();
        const shouldReport = force
            || (now - lastProgressAt >= PROGRESS_THROTTLE_MS)
            || (sampleSinceLastProgress >= 50);
        if (!shouldReport) return;
        onProgress({
            completed: written + batch.length,
            failed, total,
            percent: (written + batch.length + failed) / total,
            firstError,
            // v3.0.5: 心跳信息（即便没有新 sample 完成）
            inFlight: inFlightStartedAt > 0 ? {
                idx: inFlightIdx,
                elapsedMs: Math.round(now - inFlightStartedAt),
            } : null,
        });
        lastProgressAt = now;
        sampleSinceLastProgress = 0;
    };

    for (const ctx of contexts) {
        // v3.2 高 r 定向: 本 ctx 实际 seed 数 (高 pb 档放大, 默认 = seedsPerTheta)
        const ctxSeeds = seedsForCtx(ctx);
        // v3.0.6 (G2): per-ctx 生成 thetas, 用于 bundle / bundle-perturb 等闭环策略
        const ctxThetas = isThetasFn ? thetas(ctx) : thetas;
        if (!Array.isArray(ctxThetas) || ctxThetas.length === 0) {
            failed += thetasPerCtx * ctxSeeds;
            firstError = firstError || `thetas factory returned empty for ctx ${ctx.context_key || JSON.stringify(ctx)}`;
            continue;
        }
        for (const theta of ctxThetas) {
            for (let s = 0; s < ctxSeeds; s++) {
                const seed = (Date.now() & 0xFFFF_FFFF) ^ (generated * 7919);
                inFlightIdx = generated + failed + 1;
                inFlightStartedAt = performance.now();
                _maybeReportProgress(true);   // 单 sample 开始即报心跳
                try {
                    const t0 = performance.now();
                    const sample = await runOneSampleV2({ context: ctx, theta, seed, maxSteps, botConfig });
                    sample.eval_ms = Math.round(performance.now() - t0);
                    batch.push(sample);
                    generated++;
                } catch (e) {
                    failed++;
                    const msg = e?.message || String(e);
                    if (!firstError) firstError = msg;
                    if (typeof console !== 'undefined') {
                        log.error('[samplerV2] error:', msg, e);
                    }
                }
                sampleSinceLastProgress++;
                if (batch.length >= batchSize) {
                    await flush();
                }
                _maybeReportProgress();
                // v2.10.38: 每 N 个 sample yield 主线程 (避免 100% CPU + 页面无响应)
                if (generated % PROGRESS_YIELD_EVERY === 0) {
                    await new Promise((r) => setTimeout(r, 0));
                }
            }
        }
    }
    _maybeReportProgress(true);   // 收尾必报一次 (在 flush 前: completed=written+batch, percent 反映生成全量)
    await flush();
    return { completed: written, failed, total, firstError };
}


// 测试导出 (内部函数)
export const _internal = {
    stepDifficulty: _stepDifficulty,
    stepDelight: _stepDelight,
    stepFrustration: _stepFrustration,
    extractDCurveFromSteps: _extractDCurveFromSteps,
    createRng: _createRng,
    buildSpawnModelConfig,
    highRSeedCount,
    applyLifecycleStageToProfile,
};
