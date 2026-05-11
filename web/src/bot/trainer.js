/**
 * 自博弈回合 + REINFORCE 更新（v2：回报标准化 + 熵正则 + 梯度裁剪 + 课程门槛）。
 * 对局循环只通过 RlGameplayEnvironment，与具体棋盘规则解耦。
 */
import { RlGameplayEnvironment } from './gameEnvironment.js';
import { countHoles } from './features.js';
import { GAME_RULES, RL_TRAINING_STRATEGY_ID } from '../gameRules.js';
import { rlWinThresholdForEpisode } from './rlCurriculum.js';
import {
    fetchRlStatus,
    saveRemoteCheckpoint,
    selectActionRemote,
    trainEpisodeRemote,
    evalValuesRemote,
    flushBufferRemote
} from './pytorchBackend.js';

import { extractStateFeatures } from './features.js';

export { WIN_SCORE_THRESHOLD } from '../gameRules.js';

function _finiteNum(v, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

/** 读取 `shared/game_rules.json` → `browserRlTraining`（缺省字段用内置默认）。 */
export function resolveBrowserRlTrainingConfig() {
    const br = GAME_RULES.browserRlTraining || {};
    const tl = br.temperatureLocal || {};
    const tb = br.temperatureBackend || {};
    return {
        gamma: Math.min(1, Math.max(0, _finiteNum(br.gamma, 0.99))),
        maxGradNorm: Math.max(1e-6, _finiteNum(br.maxGradNorm, 5.0)),
        policyLr: Math.max(0, _finiteNum(br.policyLr, 0.02)),
        valueLr: Math.max(0, _finiteNum(br.valueLr, 0.05)),
        entropyCoef: Math.max(0, _finiteNum(br.entropyCoef, 0.012)),
        tempLocal: {
            start: _finiteNum(tl.start, 1.0),
            min: _finiteNum(tl.min, 0.4),
            decay: Math.max(0, _finiteNum(tl.decayPerEpisode, 0.0015)),
        },
        tempBackend: {
            start: _finiteNum(tb.start, 1.0),
            min: _finiteNum(tb.min, 0.35),
            decay: Math.max(0, _finiteNum(tb.decayPerGlobalEpisode, 0.002)),
        },
    };
}

function temperatureForLocalEpisode(episodeIndex, cfg = resolveBrowserRlTrainingConfig()) {
    const { start, min, decay } = cfg.tempLocal;
    const e = Math.max(0, episodeIndex);
    return Math.max(min, start - e * decay);
}

function temperatureForBackendEpisode(globalEpisode, cfg = resolveBrowserRlTrainingConfig()) {
    const { start, min, decay } = cfg.tempBackend;
    const e = Math.max(0, globalEpisode);
    return Math.max(min, start - e * decay);
}

/* ================================================================== */
/*  1-step lookahead：用 V(s') 评估动作质量                            */
/* ================================================================== */

/**
 * 对每个合法动作模拟一步，提取后继状态，批量评估 V(s')，
 * 返回 Q(s,a) = r(s,a) + γ * V(s') 最高的动作（带温度采样）。
 */
/**
 * @returns {Promise<{ index: number, qTeacher: number[] | null }>}
 *   qTeacher 与合法动作一一对应，供服务端 Q 蒸馏（非 MCTS teacher）。
 */
async function _selectWithLookahead(env, legal, stateFeat, phiList, temperature) {
    const GAMMA = resolveBrowserRlTrainingConfig().gamma;
    const sim = env.simulator;
    const savedState = sim.saveState();

    const nextStates = [];
    const rewards = [];

    for (const action of legal) {
        sim.restoreState(savedState);
        const r = sim.step(action.blockIdx, action.gx, action.gy);
        rewards.push(r);
        const sf = extractStateFeatures(sim.grid, sim.dock);
        nextStates.push(sf);
        sim.restoreState(savedState);
    }

    let values;
    try {
        values = await evalValuesRemote(nextStates);
    } catch {
        const index = await selectActionRemote(phiList, stateFeat, temperature);
        return { index, qTeacher: null };
    }
    if (!Array.isArray(values) || values.length !== legal.length) {
        const index = await selectActionRemote(phiList, stateFeat, temperature);
        return { index, qTeacher: null };
    }

    const qValues = legal.map((_, i) => rewards[i] + GAMMA * (Number(values[i]) || 0));
    const qTeacher = qValues.map((q) => Number(q));

    if (temperature < 0.01) {
        let bestIdx = 0, bestQ = -Infinity;
        for (let i = 0; i < qValues.length; i++) {
            if (qValues[i] > bestQ) { bestQ = qValues[i]; bestIdx = i; }
        }
        return { index: bestIdx, qTeacher };
    }

    const maxQ = Math.max(...qValues);
    const logits = qValues.map(q => (q - maxQ) / Math.max(temperature, 0.01));
    const expL = logits.map(Math.exp);
    const sumExp = expL.reduce((a, b) => a + b, 0);
    const probs = expL.map(e => e / sumExp);

    const r = Math.random();
    let cum = 0;
    for (let i = 0; i < probs.length; i++) {
        cum += probs[i];
        if (r <= cum) return { index: i, qTeacher };
    }
    return { index: probs.length - 1, qTeacher };
}

/* ================================================================== */
/*  回报标准化（在线 Welford 算法）                                     */
/* ================================================================== */

const _returnStats = { n: 0, mean: 0, m2: 0 };

function _updateReturnStats(G) {
    _returnStats.n++;
    const d1 = G - _returnStats.mean;
    _returnStats.mean += d1 / _returnStats.n;
    const d2 = G - _returnStats.mean;
    _returnStats.m2 += d1 * d2;
}

function _normalizeReturn(G) {
    if (_returnStats.n < 20) return G;
    const variance = _returnStats.m2 / _returnStats.n;
    const std = Math.sqrt(variance + 1e-8);
    return (G - _returnStats.mean) / std;
}

/* ================================================================== */
/*  单局自博弈                                                         */
/* ================================================================== */

/**
 * @param {import('./linearAgent.js').LinearAgent} agent
 * @param {number} temperature
 * @param {object} [hooks]
 * @param {object} [opts]
 */
export async function runSelfPlayEpisode(agent, temperature = 1, hooks = {}, opts = {}) {
    const useBackend = Boolean(opts.useBackend);
    const wOpt = opts.winScoreThreshold;
    const winScoreThreshold = typeof wOpt === 'number' && Number.isFinite(wOpt)
        ? Math.max(1, Math.round(wOpt))
        : undefined;
    const env = new RlGameplayEnvironment(RL_TRAINING_STRATEGY_ID, { winScoreThreshold });
    const trajectory = [];

    if (hooks.onEpisodeStart) await hooks.onEpisodeStart(env.simulator);

    while (true) {
        if (env.isTerminal()) break;

        const { legal, stateFeat, phiList } = env.buildDecisionBatch();
        if (legal.length === 0) break;

        let choice;
        if (useBackend) {
            const useLookahead = (opts.useLookahead !== undefined
                ? Boolean(opts.useLookahead)
                : false) && legal.length <= 120;
            let idx;
            /** @type {number[] | null} */
            let qTeacher = null;
            if (useLookahead) {
                const lk = await _selectWithLookahead(env, legal, stateFeat, phiList, temperature);
                idx = lk.index;
                qTeacher = lk.qTeacher;
            } else {
                idx = await selectActionRemote(phiList, stateFeat, temperature);
            }
            choice = {
                stateFeat: new Float32Array(stateFeat),
                phiList, probs: null, chosenIdx: idx, idx, qTeacher
            };
        } else {
            const c = agent.selectAction(phiList, stateFeat, temperature);
            if (!c) break;
            choice = {
                stateFeat: c.stateFeat, phiList: c.phiList,
                probs: c.probs, chosenIdx: c.idx, idx: c.idx
            };
        }

        const action = legal[choice.idx];
        const reward = env.step(action.blockIdx, action.gx, action.gy);

        const sup = env.simulator.getSupervisionSignals();
        const stepRow = {
            stateFeat: choice.stateFeat,
            phiList: choice.phiList,
            probs: choice.probs,
            chosenIdx: choice.chosenIdx,
            reward,
            holes_after: countHoles(env.simulator.grid),
            clears: Math.min(env.simulator._lastClears || 0, 3),
            board_quality: sup.board_quality,
            feasibility: sup.feasibility,
            topology_after: sup.topology_after,
        };
        if (choice.qTeacher != null && choice.qTeacher.length === choice.phiList.length) {
            stepRow.qTeacher = choice.qTeacher;
        }
        trajectory.push(stepRow);

        if (hooks.onAfterStep) {
            await hooks.onAfterStep(env.simulator, {
                reward, action, stepIndex: trajectory.length
            });
        }
    }

    const sp = Number(GAME_RULES.rlRewardShaping?.stuckPenalty);
    if (trajectory.length > 0 && !env.won && env.isTerminal() && Number.isFinite(sp) && sp !== 0) {
        trajectory[trajectory.length - 1].reward += sp;
    }

    const total = trajectory.length;
    for (let i = 0; i < total; i++) trajectory[i].steps_to_end = total - i - 1;

    return {
        score: env.score,
        steps: env.steps,
        placements: env.simulator.placements,
        totalClears: env.totalClears,
        won: env.won,
        trajectory
    };
}

/* ================================================================== */
/*  REINFORCE 更新（v2：标准化 + 熵 + 裁剪）                           */
/* ================================================================== */

/**
 * @param {import('./linearAgent.js').LinearAgent} agent
 * @param {object[]} trajectory
 * @param {{ policyLr?: number, valueLr?: number, gamma?: number, entropyCoef?: number, maxGradNorm?: number }} opts
 * @returns {{ lossPolicy: number, lossValue: number, entropy: number, stepCount: number } | null}
 */
export function reinforceUpdate(agent, trajectory, opts = {}) {
    const cfg = resolveBrowserRlTrainingConfig();
    const policyLr = opts.policyLr ?? cfg.policyLr;
    const valueLr = opts.valueLr ?? cfg.valueLr;
    const gamma = opts.gamma ?? cfg.gamma;
    const entropyCoef = opts.entropyCoef ?? cfg.entropyCoef;
    const maxGN = opts.maxGradNorm ?? cfg.maxGradNorm;
    const T = trajectory.length;
    if (T === 0) return null;

    const returns = new Float32Array(T);
    let G = 0;
    for (let t = T - 1; t >= 0; t--) {
        G = trajectory[t].reward + gamma * G;
        returns[t] = G;
    }

    for (let t = 0; t < T; t++) _updateReturnStats(returns[t]);

    const normReturns = new Float32Array(T);
    for (let t = 0; t < T; t++) normReturns[t] = _normalizeReturn(returns[t]);

    let advSum = 0, advSumSq = 0;
    const rawAdv = new Float32Array(T);
    for (let t = 0; t < T; t++) {
        const v = agent.value(trajectory[t].stateFeat);
        rawAdv[t] = normReturns[t] - v;
        advSum += rawAdv[t];
        advSumSq += rawAdv[t] * rawAdv[t];
    }
    const advMean = advSum / T;
    const advStd = Math.sqrt(advSumSq / T - advMean * advMean + 1e-8);

    /** 与右侧看板字段对齐：Lv≈优势平方均；Lπ≈−log π(a)·A（标准化后） */
    let lossValue = 0;
    for (let t = 0; t < T; t++) {
        lossValue += rawAdv[t] * rawAdv[t];
    }
    lossValue /= T;

    let polAcc = 0;
    let entAcc = 0;
    let polN = 0;
    for (let t = 0; t < T; t++) {
        const tr = trajectory[t];
        if (!tr.probs) continue;
        const advantage = Math.max(-maxGN, Math.min(maxGN,
            (rawAdv[t] - advMean) / advStd
        ));
        const logp = Math.log(tr.probs[tr.chosenIdx] + 1e-12);
        polAcc += -logp * advantage;
        polN++;
        let ent = 0;
        for (let k = 0; k < tr.probs.length; k++) {
            const p = tr.probs[k];
            if (p > 1e-12) ent -= p * Math.log(p);
        }
        entAcc += ent;
    }
    const lossPolicy = polN > 0 ? polAcc / polN : 0;
    const entropy = polN > 0 ? entAcc / polN : 0;

    for (let t = 0; t < T; t++) {
        const tr = trajectory[t];
        if (!tr.probs) continue;

        const advantage = Math.max(-maxGN, Math.min(maxGN,
            (rawAdv[t] - advMean) / advStd
        ));

        const pg = agent.policyGradient(tr.phiList, tr.probs, tr.chosenIdx);
        const eg = entropyCoef > 0 ? agent.entropyPolicyGradient(tr.phiList, tr.probs) : null;
        agent.applyPolicyUpdateCombined(pg, advantage, eg, entropyCoef, policyLr);

        const valueDelta = Math.max(-maxGN, Math.min(maxGN, rawAdv[t]));
        agent.applyValueUpdate(tr.stateFeat, valueDelta, valueLr);
    }

    return {
        lossPolicy,
        lossValue,
        entropy,
        stepCount: T
    };
}

/* ================================================================== */
/*  训练主循环                                                         */
/* ================================================================== */

/**
 * @param {object} opts
 * @param {import('./linearAgent.js').LinearAgent} opts.agent
 * @param {number} opts.episodes
 * @param {boolean} [opts.useBackend]
 * @param {boolean} [opts.useLookahead] 与 useBackend 连用时：未传默认 **false**（仅远端策略采样，首局快）；传 true 启用 1-step Q + 上报 q_teacher（利于 Q 蒸馏，但极慢）
 * @param {(info: object) => void} [opts.onEpisode]
 * @param {AbortSignal} [opts.signal]
 */
export async function trainSelfPlay(opts) {
    const agent = opts.agent;
    const episodes = opts.episodes ?? 1;
    const onEpisode = opts.onEpisode;
    const signal = opts.signal;
    const useBackend = Boolean(opts.useBackend);

    if (useBackend) {
        let baseEp = 0;
        const useLookahead = opts.useLookahead !== undefined
            ? Boolean(opts.useLookahead)
            : false;
        try {
            const st = await fetchRlStatus();
            if (st.available && typeof st.episodes === 'number') baseEp = st.episodes;
        } catch { /* ignore */ }

        const tempCfg = resolveBrowserRlTrainingConfig();
        for (let e = 0; e < episodes; e++) {
            if (signal?.aborted) break;
            const globalEp = baseEp + e;
            const temp = temperatureForBackendEpisode(globalEp, tempCfg);
            const winThr = rlWinThresholdForEpisode(globalEp + 1);
            const ep = await runSelfPlayEpisode(null, temp, {}, {
                useBackend: true,
                useLookahead,
                winScoreThreshold: winThr,
            });

            let serverEpisodes = null, lossPi = null, lossV = null;
            let buffered = false;
            if (ep.trajectory.length > 0) {
                try {
                    const res = await trainEpisodeRemote(ep.trajectory, {
                        score: ep.score, won: ep.won, gameSteps: ep.steps
                    });
                    serverEpisodes = res.episodes;
                    lossPi = res.loss_policy;
                    lossV = res.loss_value;
                    buffered = Boolean(res.buffered);
                } catch (err) {
                    console.warn('[RL backend] train_episode failed:', err);
                }
            }
            if (!buffered) {
                try {
                    const st = await fetchRlStatus();
                    if (st.available && typeof st.episodes === 'number') serverEpisodes = st.episodes;
                } catch (err) {
                    console.warn('[RL backend] status sync failed:', err);
                }
            }

            onEpisode?.({
                episodeIndex: e, score: ep.score, steps: ep.steps,
                clears: ep.totalClears, won: ep.won, trajLen: ep.trajectory.length,
                policySteps: ep.trajectory.length, serverEpisodes,
                lossPolicy: lossPi, lossValue: lossV, fromBackend: true,
                buffered,
            });

            if (e % 3 === 0) await new Promise(r => setTimeout(r, 0));
        }
        try { await flushBufferRemote(); } catch { /* ignore */ }
        try { await saveRemoteCheckpoint(); } catch { /* ignore */ }
        return;
    }

    /* ── 浏览器本地训练 ── */

    let totalEpisodes = 0;
    const tempCfg = resolveBrowserRlTrainingConfig();

    for (let e = 0; e < episodes; e++) {
        if (signal?.aborted) break;

        const temp = temperatureForLocalEpisode(e, tempCfg);

        const winThr = rlWinThresholdForEpisode(totalEpisodes + 1);
        const ep = await runSelfPlayEpisode(agent, temp, {}, { winScoreThreshold: winThr });
        const trainMetrics = reinforceUpdate(agent, ep.trajectory);
        totalEpisodes++;

        if (e % 5 === 0) agent.save();

        onEpisode?.({
            episodeIndex: e, score: ep.score, steps: ep.steps,
            clears: ep.totalClears, won: ep.won,
            trajLen: ep.trajectory.length, policySteps: ep.trajectory.length,
            fromBackend: false,
            curriculumThreshold: winThr,
            trainMetrics,
            lossPolicy: trainMetrics?.lossPolicy,
            lossValue: trainMetrics?.lossValue,
            entropy: trainMetrics?.entropy,
            stepCount: trainMetrics?.stepCount ?? ep.trajectory.length
        });

        if (e % 3 === 0) await new Promise(r => setTimeout(r, 0));
    }

    agent.save();
}
