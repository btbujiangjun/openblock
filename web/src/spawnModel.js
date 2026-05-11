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
const _SPAWN_MODES = [SPAWN_MODE_RULE, SPAWN_MODE_MODEL_V3];
export const SPAWN_MODEL_V3_VERSION = 'v3.1-behavior';
export const SPAWN_MODEL_CONTEXT_DIM = 24;
export const SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM = 56;

export const SHAPE_VOCAB = [
    '1x4', '4x1', '1x5', '5x1',
    '2x3', '3x2', '2x2', '3x3',
    't-up', 't-down', 't-left', 't-right',
    'z-h', 'z-h2', 'z-v', 'z-v2',
    'l-1', 'l-2', 'l-3', 'l-4',
    'l5-a', 'l5-b', 'l5-c', 'l5-d',
    'j-1', 'j-2', 'j-3', 'j-4'
];

function _clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function _finiteNumber(v, fallback = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _scaleUnit(v, max, fallback = 0) {
    return _clamp01(_finiteNumber(v, fallback) / Math.max(1, max));
}

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

async function _startTraining(opts = {}) {
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

async function _reloadModel() {
    return _api('/api/spawn-model/reload', { method: 'POST' });
}

/* ================================================================== */
/*  推理 API                                                           */
/* ================================================================== */

const _FLOW_MAP = { bored: -1, flow: 0, anxious: 1 };
const _PACING_MAP = { early: 0, tension: 0.5, release: 1 };
const _SESSION_MAP = { warmup: 0, peak: 0.5, cooldown: 1 };
const _SPAWN_INTENTS = ['relief', 'engage', 'harvest', 'pressure', 'flow', 'maintain'];
const _HOLE_PRESSURE_MAX = 8;

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

function shapeIdToIndex(id) {
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

function _spawnIntentOneHot(intent) {
    const out = new Array(_SPAWN_INTENTS.length).fill(0);
    const idx = _SPAWN_INTENTS.indexOf(intent || 'maintain');
    out[idx >= 0 ? idx : _SPAWN_INTENTS.indexOf('maintain')] = 1;
    return out;
}

function _buildBehaviorContext(grid, profile, adaptiveInsight, topology, ability) {
    const base = _buildContext24(grid, profile, adaptiveInsight);
    const metrics = profile.metrics || {};
    const a = adaptiveInsight || {};
    const hints = a.spawnHints || {};
    const targets = hints.spawnTargets || a.spawnTargets || {};
    const stressBreakdown = a.stressBreakdown || {};
    const topo = topology || {};
    const activeSamples = _finiteNumber(metrics.activeSamples, 0);
    const samples = _finiteNumber(metrics.samples, activeSamples);
    const holes = _finiteNumber(topo.holes ?? a.spawnDiagnostics?.layer1?.holes, 0);
    const fill = _finiteNumber(topo.fillRatio ?? a.boardFill ?? a.fillRatio ?? grid?.getFillRatio?.(), 0);
    const holePressure = _clamp01(holes / _HOLE_PRESSURE_MAX);
    const boardDifficulty = _clamp01(_finiteNumber(a.boardDifficulty, fill + holePressure * 0.8));
    const boardRisk = _clamp01(_finiteNumber(stressBreakdown.boardRisk ?? a.boardRisk, 0));
    const sessionArc = hints.sessionArc ?? a.sessionPhase;

    return [
        ...base,
        // [24-31] 数据可信度与盘面拓扑
        samples <= 0 ? 1 : 0,
        _scaleUnit(activeSamples || samples, 20),
        boardDifficulty,
        _scaleUnit(holes, 10),
        _scaleUnit(topo.nearFullLines ?? a.spawnDiagnostics?.layer1?.nearFullLines, 8),
        _scaleUnit(topo.close1, 8),
        _scaleUnit(topo.close2, 8),
        _scaleUnit(a.spawnDiagnostics?.solutionCount ?? a.spawnGeo?.solutionCount, 64),
        // [32-37] AbilityVector
        _clamp01(_finiteNumber(ability?.skillScore, profile.skillLevel ?? 0.5)),
        _clamp01(_finiteNumber(ability?.controlScore, 0.5)),
        _clamp01(_finiteNumber(ability?.clearEfficiency, 0.5)),
        _clamp01(_finiteNumber(ability?.boardPlanning, 0.5)),
        _clamp01(_finiteNumber(ability?.riskTolerance, 0.5)),
        _clamp01(_finiteNumber(ability?.riskLevel, boardRisk)),
        // [38-47] 策略目标与出块提示
        _clamp01(_finiteNumber(targets.shapeComplexity, 0)),
        _clamp01(_finiteNumber(targets.solutionSpacePressure, 0)),
        _clamp01(_finiteNumber(targets.clearOpportunity, 0)),
        _clamp01(_finiteNumber(targets.spatialPressure, 0)),
        _clamp01(_finiteNumber(targets.payoffIntensity, 0)),
        _clamp01(_finiteNumber(targets.novelty, 0)),
        _scaleUnit(hints.clearGuarantee, 3),
        _clamp01((_finiteNumber(hints.sizePreference, 0) + 1) / 2),
        _clamp01(_finiteNumber(hints.multiClearBonus, 0)),
        _clamp01(_finiteNumber(hints.orderRigor, 0)),
        // [48-53] spawnIntent one-hot
        ..._spawnIntentOneHot(hints.spawnIntent ?? a.spawnIntent),
        // [54-55] 额外策略上下文
        _scaleUnit(hints.multiLineTarget, 2),
        _SESSION_MAP[sessionArc] ?? 0.5,
    ].slice(0, SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM);
}

export function computeSpawnTargetDifficulty(profile, adaptiveInsight, topology = null) {
    const skill = profile.skillLevel ?? 0.5;
    const frustration = profile.frustrationLevel ?? 0;
    const stress = (adaptiveInsight || {}).stress ?? 0;
    const fill = topology?.fillRatio
        ?? adaptiveInsight?.fillRatio
        ?? adaptiveInsight?.boardFill
        ?? adaptiveInsight?.spawnDiagnostics?.layer1?.fill
        ?? 0.3;
    const holes = topology?.holes
        ?? adaptiveInsight?.holes
        ?? adaptiveInsight?.spawnDiagnostics?.layer1?.holes
        ?? 0;
    const holePressure = _clamp01((Number(holes) || 0) / _HOLE_PRESSURE_MAX);
    const boardDifficulty = _clamp01(fill + holePressure * 0.8);
    const nearClear = _clamp01(((topology?.close1 ?? 0) + (topology?.close2 ?? 0)) / 6);
    const boardRisk = _clamp01(Number(adaptiveInsight?.stressBreakdown?.boardRisk ?? 0) || 0);
    return _clamp01(
        0.3 + 0.5 * skill - 0.2 * frustration + 0.15 * stress + 0.08 * boardDifficulty - 0.1 * boardRisk + 0.06 * nearClear
    );
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
        behaviorContext: _buildBehaviorContext(grid, profile, adaptiveInsight, topology, ability),
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
async function _predictShapes(grid, profile, recentHistory, adaptiveInsight, temperature = 0.8) {
    const board = [];
    for (let y = 0; y < grid.size; y++) {
        const row = [];
        for (let x = 0; x < grid.size; x++) {
            row.push(grid.cells[y][x] !== null ? 1 : 0);
        }
        board.push(row);
    }

    const context = _buildContext24(grid, profile, adaptiveInsight);
    const targetDifficulty = computeSpawnTargetDifficulty(profile, adaptiveInsight, analyzeBoardTopology(grid));

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
    const behaviorContext = modelContext.behaviorContext;
    const targetDifficulty = opts.targetDifficulty ?? modelContext.targetDifficulty;
    const playstyle = opts.playstyle ?? modelContext.playstyle ?? null;

    try {
        const data = await _api('/api/spawn-model/v3/predict', {
            method: 'POST',
            body: JSON.stringify({
                board,
                context,
                behaviorContext,
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
                modelVersion: data.modelVersion || SPAWN_MODEL_V3_VERSION,
                personalized: !!data.personalized,
                feasibleCount: data.feasibleCount ?? null,
                behaviorContextDim: behaviorContext?.length ?? null,
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
