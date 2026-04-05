/**
 * 自博弈回合 + REINFORCE 更新（同一策略与自己对局，沿轨迹更新）
 */
import { BlockBlastSimulator } from './simulator.js';
import { extractStateFeatures, extractActionFeatures } from './features.js';
import { LinearAgent } from './linearAgent.js';
import {
    fetchRlStatus,
    saveRemoteCheckpoint,
    selectActionRemote,
    trainEpisodeRemote
} from './pytorchBackend.js';

/** 视为「胜局」的最低得分（用于界面胜率） */
export const WIN_SCORE_THRESHOLD = 220;

/**
 * 跑完一局自博弈，返回统计与轨迹（用于学习）
 * @param {LinearAgent} agent
 * @param {number} temperature
 * @param {{ onEpisodeStart?: (sim: import('./simulator.js').BlockBlastSimulator) => void | Promise<void>, onAfterStep?: (sim: import('./simulator.js').BlockBlastSimulator, meta: { reward: number, action: { blockIdx: number, gx: number, gy: number }, stepIndex: number }) => void | Promise<void> }} [hooks] 可选：逐步同步到盘面等
 * @param {{ useBackend?: boolean }} [opts] useBackend 时由服务端策略选步，agent 可传 null
 */
export async function runSelfPlayEpisode(agent, temperature = 1, hooks = {}, opts = {}) {
    const useBackend = Boolean(opts.useBackend);
    const sim = new BlockBlastSimulator('normal');
    const trajectory = [];

    if (hooks.onEpisodeStart) {
        await hooks.onEpisodeStart(sim);
    }

    while (true) {
        if (sim.isTerminal()) {
            break;
        }

        const legal = sim.getLegalActions();
        if (legal.length === 0) {
            break;
        }

        const stateFeat = extractStateFeatures(sim.grid, sim.dock);
        const phiList = [];
        for (const a of legal) {
            const wouldClear = sim.countClearsIfPlaced(a.blockIdx, a.gx, a.gy);
            phiList.push(
                extractActionFeatures(
                    stateFeat,
                    a.blockIdx,
                    a.gx,
                    a.gy,
                    sim.dock[a.blockIdx].shape,
                    wouldClear,
                    sim.grid.size
                )
            );
        }

        let choice;
        if (useBackend) {
            const idx = await selectActionRemote(phiList, stateFeat, temperature);
            choice = {
                stateFeat: new Float32Array(stateFeat),
                phiList,
                probs: null,
                chosenIdx: idx,
                idx
            };
        } else {
            const c = agent.selectAction(phiList, stateFeat, temperature);
            if (!c) {
                break;
            }
            choice = {
                stateFeat: c.stateFeat,
                phiList: c.phiList,
                probs: c.probs,
                chosenIdx: c.idx,
                idx: c.idx
            };
        }

        const action = legal[choice.idx];
        const reward = sim.step(action.blockIdx, action.gx, action.gy);

        trajectory.push({
            stateFeat: choice.stateFeat,
            phiList: choice.phiList,
            probs: choice.probs,
            chosenIdx: choice.chosenIdx,
            reward
        });

        if (hooks.onAfterStep) {
            await hooks.onAfterStep(sim, {
                reward,
                action,
                stepIndex: trajectory.length
            });
        }
    }

    const won = sim.score >= WIN_SCORE_THRESHOLD;
    return {
        score: sim.score,
        steps: sim.steps,
        placements: sim.placements,
        totalClears: sim.totalClears,
        won,
        trajectory
    };
}

/**
 * 对一局轨迹做蒙特卡洛回报并更新 agent
 * @param {LinearAgent} agent
 * @param {object[]} trajectory
 * @param {{ policyLr?: number, valueLr?: number }} opts
 */
export function reinforceUpdate(agent, trajectory, opts = {}) {
    const policyLr = opts.policyLr ?? 0.02;
    const valueLr = opts.valueLr ?? 0.05;
    const T = trajectory.length;
    if (T === 0) {
        return;
    }

    const returns = new Float32Array(T);
    let G = 0;
    const gamma = 0.99;
    for (let t = T - 1; t >= 0; t--) {
        G = trajectory[t].reward + gamma * G;
        returns[t] = G;
    }

    for (let t = 0; t < T; t++) {
        const tr = trajectory[t];
        const Gt = returns[t];
        const v = agent.value(tr.stateFeat);
        const advantage = Gt - v;

        const pg = agent.policyGradient(tr.phiList, tr.probs, tr.chosenIdx);
        agent.applyPolicyUpdate(pg, advantage, policyLr);
        agent.applyValueUpdate(tr.stateFeat, advantage, valueLr);
    }
}

/**
 * @param {object} opts
 * @param {LinearAgent} opts.agent
 * @param {number} opts.episodes
 * @param {boolean} [opts.useBackend] 使用 Flask rl_pytorch 训练
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
        try {
            const st = await fetchRlStatus();
            if (st.available && typeof st.episodes === 'number') {
                baseEp = st.episodes;
            }
        } catch {
            /* ignore */
        }
        for (let e = 0; e < episodes; e++) {
            if (signal?.aborted) {
                break;
            }

            // 与 rl_pytorch.train 一致：按「全局局数」衰减温度，续训时不会回到高温
            const globalEp = baseEp + e;
            const temp = Math.max(0.35, 1.0 - globalEp * 0.002);
            const ep = await runSelfPlayEpisode(null, temp, {}, { useBackend: true });
            let serverEpisodes = null;
            let lossPi = null;
            let lossV = null;
            if (ep.trajectory.length > 0) {
                try {
                    const res = await trainEpisodeRemote(ep.trajectory, {
                        score: ep.score,
                        won: ep.won,
                        gameSteps: ep.steps
                    });
                    serverEpisodes = res.episodes;
                    lossPi = res.loss_policy;
                    lossV = res.loss_value;
                } catch (err) {
                    console.warn('[RL backend] train_episode failed:', err);
                }
            }
            // 以服务端 /api/rl/status 为准同步局数，避免请求失败或空轨迹时界面卡住
            try {
                const st = await fetchRlStatus();
                if (st.available && typeof st.episodes === 'number') {
                    serverEpisodes = st.episodes;
                }
            } catch (err) {
                console.warn('[RL backend] status sync failed:', err);
            }

            onEpisode?.({
                episodeIndex: e,
                score: ep.score,
                steps: ep.steps,
                clears: ep.totalClears,
                won: ep.won,
                trajLen: ep.trajectory.length,
                policySteps: ep.trajectory.length,
                serverEpisodes,
                lossPolicy: lossPi,
                lossValue: lossV,
                fromBackend: true
            });

            if (e % 3 === 0) {
                await new Promise((r) => setTimeout(r, 0));
            }
        }

        try {
            await saveRemoteCheckpoint();
        } catch {
            /* ignore */
        }
        return;
    }

    for (let e = 0; e < episodes; e++) {
        if (signal?.aborted) {
            break;
        }

        const temp = Math.max(0.4, 1 - e * 0.002);
        const ep = await runSelfPlayEpisode(agent, temp);
        reinforceUpdate(agent, ep.trajectory);

        if (e % 5 === 0) {
            agent.save();
        }

        onEpisode?.({
            episodeIndex: e,
            score: ep.score,
            steps: ep.steps,
            clears: ep.totalClears,
            won: ep.won,
            trajLen: ep.trajectory.length,
            policySteps: ep.trajectory.length,
            fromBackend: false
        });

        if (e % 3 === 0) {
            await new Promise((r) => setTimeout(r, 0));
        }
    }

    agent.save();
}
