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
    const res = await fetch(`${base()}/api/rl/training_log?tail=${tail}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
    }
    return data;
}
