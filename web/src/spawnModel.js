/**
 * SpawnTransformer 前端客户端
 *
 * 提供：
 *   - 训练状态轮询
 *   - 启动/停止训练
 *   - 推理请求（给定盘面返回推荐形状）
 *   - 出块模式管理（rule / model-v3）
 *
 * 增量设计：不影响现有 generateDockShapes 流程，仅在 mode='model-v3' 时替代出块来源。
 */

import { getApiBaseUrl } from './config.js';
import { getShapeById } from './shapes.js';
import { analyzeBoardTopology } from './boardTopology.js';
import { buildPlayerAbilityVector } from './playerAbilityModel.js';

const SPAWN_MODE_KEY = 'ob_spawn_mode';
export const SPAWN_MODE_RULE = 'rule';
export const SPAWN_MODE_MODEL_V3 = 'model-v3';
export const SPAWN_MODES = [SPAWN_MODE_RULE, SPAWN_MODE_MODEL_V3];

export const SHAPE_VOCAB = [
    '1x4', '4x1', '1x5', '5x1',
    '2x3', '3x2', '2x2', '3x3',
    't-up', 't-down', 't-left', 't-right',
    'z-h', 'z-h2', 'z-v', 'z-v2',
    'l-1', 'l-2', 'l-3', 'l-4',
    'l5-a', 'l5-b', 'l5-c', 'l5-d',
    'j-1', 'j-2', 'j-3', 'j-4'
];

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

export function normalizeSpawnMode(mode) {
    if (mode === 'model' || mode === SPAWN_MODE_MODEL_V3) return SPAWN_MODE_MODEL_V3;
    return SPAWN_MODE_RULE;
}

/** @returns {'rule'|'model-v3'} */
export function getSpawnMode() {
    if (typeof localStorage === 'undefined') return SPAWN_MODE_RULE;
    return normalizeSpawnMode(localStorage.getItem(SPAWN_MODE_KEY));
}

/** @param {'rule'|'model'|'model-v3'} mode */
export function setSpawnMode(mode) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SPAWN_MODE_KEY, normalizeSpawnMode(mode));
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

function _gridToBoard(grid) {
    const board = [];
    for (let y = 0; y < grid.size; y++) {
        const row = [];
        for (let x = 0; x < grid.size; x++) {
            row.push(grid.cells[y][x] !== null ? 1 : 0);
        }
        board.push(row);
    }
    return board;
}

export function shapeIdToIndex(id) {
    const idx = SHAPE_VOCAB.indexOf(id);
    return idx >= 0 ? idx : 0;
}

export function shapeIdsToHistoryRow(shapes) {
    const ids = Array.isArray(shapes) ? shapes.slice(0, 3).map((s) => s?.id || s) : [];
    while (ids.length < 3) ids.push(SHAPE_VOCAB[0]);
    return ids.map(shapeIdToIndex);
}

function _buildContext24(grid, profile, adaptiveInsight) {
    const m = profile.metrics || {};
    const a = adaptiveInsight || {};
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

export function computeSpawnTargetDifficulty(profile, adaptiveInsight, topology = null) {
    const skill = profile.skillLevel ?? 0.5;
    const frustration = profile.frustrationLevel ?? 0;
    const stress = (adaptiveInsight || {}).stress ?? 0;
    const fill = topology?.fillRatio ?? (adaptiveInsight || {}).fillRatio ?? 0.3;
    const holes = Math.min(1, Math.max(0, Number(topology?.holes ?? 0) || 0) / 10);
    const nearClear = Math.min(1, ((topology?.close1 ?? 0) + (topology?.close2 ?? 0)) / 6);
    return Math.max(0, Math.min(
        1,
        0.3 + 0.5 * skill - 0.2 * frustration - 0.15 * stress + 0.1 * fill - 0.08 * holes + 0.06 * nearClear
    ));
}

export function buildSpawnModelContext(grid, profile, adaptiveInsight, opts = {}) {
    const topology = opts.topology || (grid ? analyzeBoardTopology(grid) : null);
    const ability = opts.ability || buildPlayerAbilityVector(profile, {
        grid,
        topology,
        boardFill: topology?.fillRatio ?? grid?.getFillRatio?.() ?? 0,
        gameStats: opts.gameStats,
        spawnContext: opts.spawnContext,
        adaptiveInsight,
    });
    return {
        board: _gridToBoard(grid),
        context: _buildContext24(grid, profile, adaptiveInsight),
        topology,
        ability,
        playstyle: opts.playstyle ?? profile?.playstyle ?? 'balanced',
        targetDifficulty: opts.targetDifficulty ?? computeSpawnTargetDifficulty(profile, adaptiveInsight, topology),
        hints: adaptiveInsight?.spawnHints || {},
        mode: getSpawnMode(),
    };
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
    const targetDifficulty = computeSpawnTargetDifficulty(profile, adaptiveInsight);

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

/* ================================================================== */
/*  V3 推理 API（autoregressive + feasibility + playstyle + 个性化）   */
/* ================================================================== */

/**
 * 调用 SpawnTransformerV3 推理（带可解性硬约束）。
 *
 * 与 V2 的差异：
 *   - 后端会主动用 `board` 计算 feasibility mask 屏蔽不可放形状
 *   - 支持 `playstyle` / `userId` 参数（后者会触发 LoRA 个性化路径）
 *   - 输出携带 `modelVersion`、`personalized`、`feasibleCount` 等元信息
 *
 * @param {import('./grid.js').Grid} grid
 * @param {object} profile
 * @param {number[][]} recentHistory
 * @param {object} [adaptiveInsight]
 * @param {object} [opts] 额外参数：playstyle / userId / temperature / topK / enforceFeasibility
 * @returns {Promise<{shapes:Array,meta:object}|null>}
 */
export async function predictShapesV3(grid, profile, recentHistory, adaptiveInsight, opts = {}) {
    const modelContext = opts.modelContext || buildSpawnModelContext(grid, profile, adaptiveInsight, opts);
    const board = modelContext.board;
    const context = modelContext.context;
    const targetDifficulty = opts.targetDifficulty ?? modelContext.targetDifficulty;
    const playstyle = opts.playstyle ?? modelContext.playstyle ?? null;

    try {
        const data = await _api('/api/spawn-model/v3/predict', {
            method: 'POST',
            body: JSON.stringify({
                board,
                context,
                history: recentHistory || [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
                temperature: opts.temperature ?? 0.8,
                topK: opts.topK ?? 8,
                targetDifficulty,
                playstyle,
                userId: opts.userId || null,
                enforceFeasibility: opts.enforceFeasibility !== false,
            }),
        });

        if (!data?.success || !Array.isArray(data.shapes)) return null;

        const shapes = data.shapes.map((id) => {
            const s = getShapeById(id);
            return s || getShapeById('2x2');
        }).filter(Boolean);

        if (shapes.length < 3) return null;

        return {
            shapes: shapes.slice(0, 3),
            meta: {
                modelVersion: data.modelVersion || 'v3',
                personalized: !!data.personalized,
                feasibleCount: data.feasibleCount ?? null,
                targetDifficulty,
                playstyle,
            },
        };
    } catch (e) {
        console.warn('SpawnTransformerV3 predict failed:', e);
        return null;
    }
}

export async function getV3Status() {
    try {
        return await _api('/api/spawn-model/v3/status');
    } catch {
        return { baseAvailable: false, personalizedUsers: [] };
    }
}

export async function reloadV3Model() {
    return _api('/api/spawn-model/v3/reload', { method: 'POST' });
}

export async function startV3Training(opts = {}) {
    return _api('/api/spawn-model/v3/train', {
        method: 'POST',
        body: JSON.stringify({
            epochs: opts.epochs ?? 50,
            minScore: opts.minScore ?? 0,
            maxSessions: opts.maxSessions ?? 500,
            wFeas: opts.wFeas,
            wSi: opts.wSi,
            wSt: opts.wSt,
        }),
    });
}

export async function startPersonalize(userId, opts = {}) {
    return _api('/api/spawn-model/v3/personalize', {
        method: 'POST',
        body: JSON.stringify({
            userId,
            epochs: opts.epochs ?? 10,
            maxSessions: opts.maxSessions ?? 200,
            lr: opts.lr ?? 1e-3,
            loraR: opts.loraR ?? 4,
            loraAlpha: opts.loraAlpha ?? 8,
        }),
    });
}

export async function proposeShapes(opts = {}) {
    return _api('/api/spawn-model/v3/propose-shapes', {
        method: 'POST',
        body: JSON.stringify({
            n: opts.n ?? 8,
            nCellsDist: opts.nCellsDist || { 3: 0.2, 4: 0.5, 5: 0.3 },
            seed: opts.seed ?? null,
        }),
    });
}
