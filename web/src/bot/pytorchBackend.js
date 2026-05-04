/**
 * 对接 Flask /api/rl/* 与 rl_pytorch：推理选步、回合训练、保存、状态。
 */
import { getApiBaseUrl } from '../config.js';

function base() {
    return getApiBaseUrl().replace(/\/+$/, '');
}

async function postJson(path, body) {
    const res = await fetch(`${base()}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || data.reason || `HTTP ${res.status}`);
    }
    return data;
}

/**
 * @returns {Promise<{ available: boolean, device?: string, episodes?: number, checkpoint_loaded?: string | null, save_path?: string, reason?: string }>}
 */
export async function fetchRlStatus() {
    const res = await fetch(`${base()}/api/rl/status`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        return { available: false, reason: data.reason || data.error || `HTTP ${res.status}` };
    }
    return data;
}

/**
 * @param {Float32Array[]} phiList
 * @param {Float32Array} stateFeat
 * @param {number} temperature
 */
export async function selectActionRemote(phiList, stateFeat, temperature) {
    const phi = phiList.map((p) => Array.from(p));
    const state = Array.from(stateFeat);
    const data = await postJson('/api/rl/select_action', {
        phi,
        state,
        temperature
    });
    return data.index;
}

/**
 * @param {object[]} trajectory trainer 中每步对象（含 phiList, stateFeat, chosenIdx, reward）
 * @param {{ score?: number, won?: boolean, gameSteps?: number }} [meta] 写入 training.jsonl 供看板
 */
export async function trainEpisodeRemote(trajectory, meta = {}) {
    const steps = trajectory.map((tr) => {
        const row = {
            phi: tr.phiList.map((row) => Array.from(row)),
            state: Array.from(tr.stateFeat),
            idx: tr.chosenIdx,
            reward: tr.reward
        };
        if (typeof tr.holes_after === 'number' && Number.isFinite(tr.holes_after)) {
            row.holes_after = tr.holes_after;
        }
        if (typeof tr.clears === 'number') row.clears = tr.clears;
        if (typeof tr.board_quality === 'number') row.board_quality = tr.board_quality;
        if (typeof tr.feasibility === 'number') row.feasibility = tr.feasibility;
        if (Array.isArray(tr.topology_after)) {
            row.topology_after = tr.topology_after.map((x) => Number(x));
        }
        if (typeof tr.steps_to_end === 'number') row.steps_to_end = tr.steps_to_end;
        if (Array.isArray(tr.qTeacher) && tr.qTeacher.length === tr.phiList.length) {
            row.q_teacher = tr.qTeacher.map((x) => Number(x));
        }
        return row;
    });
    const body = { steps };
    if (typeof meta.score === 'number' && Number.isFinite(meta.score)) {
        body.score = meta.score;
    }
    if (typeof meta.won === 'boolean') {
        body.won = meta.won;
    }
    if (typeof meta.gameSteps === 'number' && Number.isFinite(meta.gameSteps)) {
        body.game_steps = meta.gameSteps;
    }
    return postJson('/api/rl/train_episode', body);
}

/**
 * 批量评估 V(s) — 供 1-step lookahead 使用。
 * @param {Float32Array[]|number[][]} states 一组 state feature vectors
 * @returns {Promise<number[]>} 对应的 V(s) 值
 */
export async function evalValuesRemote(states) {
    const n = states?.length ?? 0;
    if (n === 0) {
        return [];
    }
    const payload = states.map((s) => {
        if (s == null || typeof s[Symbol.iterator] !== 'function') {
            throw new Error('eval_values: invalid state vector');
        }
        return Array.from(s);
    });
    const data = await postJson('/api/rl/eval_values', { states: payload });
    const values = data?.values;
    if (!Array.isArray(values) || values.length !== n) {
        throw new Error(
            `eval_values: expected values length ${n}, got ${values == null ? 'missing' : values.length}`
        );
    }
    return values.map((v) => {
        let x = v;
        while (Array.isArray(x) && x.length === 1) {
            x = x[0];
        }
        return Number(x);
    });
}

/**
 * 手动触发 replay buffer 的批量 PPO 更新。
 */
export async function flushBufferRemote() {
    return postJson('/api/rl/flush_buffer', {});
}

/**
 * 贪心评估当前服务端 checkpoint（不写权重），结果写入 training.jsonl（event: eval_greedy）。
 * @param {{ nGames?: number, rounds?: number, temperature?: number, winThreshold?: number, seedBase?: number }} [opts]
 */
export async function evalGreedyRemote(opts = {}) {
    const body = {};
    if (typeof opts.nGames === 'number' && Number.isFinite(opts.nGames)) {
        body.n_games = opts.nGames;
    }
    if (typeof opts.rounds === 'number' && Number.isFinite(opts.rounds)) {
        body.rounds = opts.rounds;
    }
    if (typeof opts.temperature === 'number' && Number.isFinite(opts.temperature)) {
        body.temperature = opts.temperature;
    }
    if (typeof opts.winThreshold === 'number' && Number.isFinite(opts.winThreshold)) {
        body.win_threshold = opts.winThreshold;
    }
    if (typeof opts.seedBase === 'number' && Number.isFinite(opts.seedBase)) {
        body.seed_base = opts.seedBase;
    }
    return postJson('/api/rl/eval_greedy', body);
}

export async function saveRemoteCheckpoint(path) {
    return postJson('/api/rl/save', path ? { path } : {});
}

export async function loadRemoteCheckpoint(path) {
    return postJson('/api/rl/load', { path });
}

/**
 * @param {number} [tail]
 * @returns {Promise<{ path: string, entries: object[], exists?: boolean }>}
 */
export async function fetchTrainingLog(tail = 80) {
    const res = await fetch(`${base()}/api/rl/training_log?tail=${tail}`, {
        cache: 'no-store'
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}
