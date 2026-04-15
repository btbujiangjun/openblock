/**
 * SpawnTransformer 前端客户端
 *
 * 提供：
 *   - 训练状态轮询
 *   - 启动/停止训练
 *   - 推理请求（给定盘面返回推荐形状）
 *   - 出块模式管理（rule / model）
 *
 * 增量设计：不影响现有 generateDockShapes 流程，仅在 mode='model' 时替代出块来源。
 */

import { getApiBaseUrl } from './config.js';
import { getShapeById } from './shapes.js';

const SPAWN_MODE_KEY = 'ob_spawn_mode';

async function _api(path, options = {}) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    const text = await res.text();
    let data = null;
    if (text) {
        try { data = JSON.parse(text); } catch { data = { _raw: text }; }
    }
    if (!res.ok) {
        const err = new Error(data?.error || `HTTP ${res.status} ${path}`);
        err.status = res.status;
        err.body = data;
        throw err;
    }
    return data;
}

/* ================================================================== */
/*  出块模式管理                                                       */
/* ================================================================== */

/** @returns {'rule'|'model'} */
export function getSpawnMode() {
    return localStorage.getItem(SPAWN_MODE_KEY) === 'model' ? 'model' : 'rule';
}

/** @param {'rule'|'model'} mode */
export function setSpawnMode(mode) {
    localStorage.setItem(SPAWN_MODE_KEY, mode === 'model' ? 'model' : 'rule');
}

/* ================================================================== */
/*  训练 API                                                           */
/* ================================================================== */

export async function getModelStatus() {
    try {
        return await _api('/api/spawn-model/status');
    } catch {
        return { modelAvailable: false, trainingRunning: false, phase: 'unknown' };
    }
}

export async function startTraining(opts = {}) {
    return _api('/api/spawn-model/train', {
        method: 'POST',
        body: JSON.stringify({
            epochs: opts.epochs ?? 50,
            minScore: opts.minScore ?? 0,
            maxSessions: opts.maxSessions ?? 500,
        }),
    });
}

export async function stopTraining() {
    return _api('/api/spawn-model/stop', { method: 'POST' });
}

export async function reloadModel() {
    return _api('/api/spawn-model/reload', { method: 'POST' });
}

/* ================================================================== */
/*  推理 API                                                           */
/* ================================================================== */

const _FLOW_MAP = { bored: -1, flow: 0, anxious: 1 };
const _PACING_MAP = { early: 0, tension: 0.5, release: 1 };
const _SESSION_MAP = { warmup: 0, peak: 0.5, cooldown: 1 };

function _buildContext24(grid, profile, adaptiveInsight) {
    const m = profile.metrics || {};
    const a = adaptiveInsight || {};
    const hints = a.spawnHints || {};
    return [
        // [0-3] 基础状态
        Math.min(1, (profile._score ?? 0) / 500),
        grid.getFillRatio(),
        profile.skillLevel ?? 0.5,
        profile.momentum ?? 0,
        // [4-7] 情绪与认知
        profile.frustrationLevel ?? 0,
        profile.cognitiveLoad ?? 0,
        (profile.engagementAPM ?? 0) / 30,
        profile.flowDeviation ?? 0,
        // [8-11] 标志位
        profile.needsRecovery ? 1 : 0,
        profile.hadRecentNearMiss ? 1 : 0,
        profile.isNewPlayer ? 1 : 0,
        Math.min(1, (profile.recentComboStreak ?? 0) / 5),
        // [12-16] 统计指标
        Math.min(1, m.clearRate ?? 0),
        Math.min(1, m.missRate ?? 0),
        Math.min(1, m.comboRate ?? 0),
        Math.min((m.thinkMs ?? 3000) / 10000, 1),
        Math.min((m.afkCount ?? 0) / 5, 1),
        // [17-19] 长周期能力
        profile.historicalSkill ?? 0.5,
        Math.max(-1, Math.min(1, profile.trend ?? 0)),
        profile.confidence ?? 0,
        // [20-23] 自适应策略信号
        Math.max(-0.5, Math.min(1.5, a.stress ?? 0)),
        _FLOW_MAP[profile.flowState] ?? 0,
        _PACING_MAP[profile.pacingPhase] ?? 0.5,
        _SESSION_MAP[a.sessionPhase] ?? 0.5,
    ];
}

function _computeTargetDifficulty(profile, adaptiveInsight) {
    const skill = profile.skillLevel ?? 0.5;
    const frustration = profile.frustrationLevel ?? 0;
    const stress = (adaptiveInsight || {}).stress ?? 0;
    const fill = (adaptiveInsight || {}).fillRatio ?? 0.3;
    return Math.max(0, Math.min(1, 0.3 + 0.5 * skill - 0.2 * frustration - 0.15 * stress + 0.1 * fill));
}

/**
 * 调用 SpawnTransformerV2 推理，返回 3 个 shape 对象。
 * @param {import('./grid.js').Grid} grid 当前盘面
 * @param {object} profile PlayerProfile（提取 context 向量）
 * @param {number[][]} recentHistory 最近 3 轮出块的 shape index（3×3）
 * @param {object} [adaptiveInsight] 当前自适应策略计算结果
 * @param {number} [temperature=0.8]
 * @returns {Promise<Array<{id: string, data: number[][], category: string}> | null>} null = 模型不可用
 */
export async function predictShapes(grid, profile, recentHistory, adaptiveInsight, temperature = 0.8) {
    const board = [];
    for (let y = 0; y < grid.size; y++) {
        const row = [];
        for (let x = 0; x < grid.size; x++) {
            row.push(grid.cells[y][x] !== null ? 1 : 0);
        }
        board.push(row);
    }

    const context = _buildContext24(grid, profile, adaptiveInsight);
    const targetDifficulty = _computeTargetDifficulty(profile, adaptiveInsight);

    try {
        const data = await _api('/api/spawn-model/predict', {
            method: 'POST',
            body: JSON.stringify({
                board,
                context,
                history: recentHistory || [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
                temperature,
                targetDifficulty,
            }),
        });

        if (!data?.success || !Array.isArray(data.shapes)) return null;

        const shapes = data.shapes.map((id) => {
            const s = getShapeById(id);
            return s || getShapeById('2x2');
        }).filter(Boolean);

        return shapes.length >= 3 ? shapes.slice(0, 3) : null;
    } catch (e) {
        console.warn('SpawnTransformerV2 predict failed:', e);
        return null;
    }
}
