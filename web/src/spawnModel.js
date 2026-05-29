/**
 * SpawnPolicyNet 前端客户端（角色：L1 · SpawnPolicyNet，神经版出块决策）。
 * 详见 docs/algorithms/SPAWN_OVERVIEW.md。
 *
 * 提供：
 *   - 训练状态轮询
 *   - 启动/停止训练
 *   - 推理请求（给定盘面返回推荐形状）
 *   - 出块模式管理：getSpawnPolicyMode / setSpawnPolicyMode（'rule' / 'model-v3' 是 localStorage 持久化字面值）
 *
 * 不影响 SpawnPolicyRules（generateDockShapes）主路径；仅在 mode='model-v3'
 * 时替代出块来源，推理失败自动回退到 SpawnPolicyRules。
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
/* v1.57.1：56 → 57，spawnIntent one-hot 6 → 7 维（新增 'sprint'）。
 * v1.61.0：57 → 61，尾部追加 4 维归一化 PB 曲线 θ 显式条件（见 SPAWN_PB_THETA_RANGES）。
 * 必须与 rl_pytorch/spawn_model/dataset.py `BEHAVIOR_CONTEXT_DIM` 保持一致，
 * 否则 model-v3 推理时前端拼接维度与后端 `board_proj.in_features`（64+61=125）不符。 */
export const SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM = 61;

/* v1.61.0：4 维 PB 曲线 θ 的归一化区间与默认值（必须与 dataset.py `_PB_THETA_RANGES` 严格一致）。
 * 顺序固定：pbTensionCenter / pbTensionWidth / pbBrakeCenter / pbBrakeWidth。
 * 把 L2 SpawnParamTuner → L1 SpawnPolicyNet 的隐式耦合转成显式条件输入。 */
export const SPAWN_PB_THETA_RANGES = Object.freeze({
    pbTensionCenter: [0.70, 0.92],
    pbTensionWidth: [0.04, 0.15],
    pbBrakeCenter: [0.98, 1.15],
    pbBrakeWidth: [0.03, 0.12],
});
const _PB_THETA_KEYS = ['pbTensionCenter', 'pbTensionWidth', 'pbBrakeCenter', 'pbBrakeWidth'];
const _PB_THETA_DEFAULTS = { pbTensionCenter: 0.82, pbTensionWidth: 0.08, pbBrakeCenter: 1.05, pbBrakeWidth: 0.06 };

function _normPbTheta(params) {
    const p = (params && typeof params === 'object') ? params : {};
    return _PB_THETA_KEYS.map((k) => {
        const [lo, hi] = SPAWN_PB_THETA_RANGES[k];
        const v = _finiteNumber(p[k], _PB_THETA_DEFAULTS[k]);
        return _clamp01((v - lo) / (hi - lo));
    });
}

/* v1.60.0 形状池扩展（28 → 40）：
 *   - lines +4：超小直线（1x2/2x1/1x3/3x1）—— 前期减压
 *   - zshapes +4：斜线（diag-2a/b / diag-3a/b）—— diag-2 中性、diag-3 加压（散点造孤岛）
 *   - lshapes +4：3 格 L 形（l3-a/b/c/d）—— 中性·角落补缝
 * 顺序约定（**必须**与 rl_pytorch/spawn_model/dataset.py 的 SHAPE_VOCAB 严格一致）：
 *   先追加在各 category 末尾（保持原 28 个 idx 不变 → 旧推理路径仍兼容），新 12 个紧随其 category。
 *
 * ⚠ 重要：SpawnTransformer / model-v3 checkpoint 的输出维 NUM_SHAPES = 28 → 40 后失效，
 * 必须重训后才能在 SPAWN_MODE_MODEL_V3 下生效；rule 模式（默认）不受影响。
 */
export const SHAPE_VOCAB = [
    '1x4', '4x1', '1x5', '5x1',
    '2x3', '3x2', '2x2', '3x3',
    't-up', 't-down', 't-left', 't-right',
    'z-h', 'z-h2', 'z-v', 'z-v2',
    'l-1', 'l-2', 'l-3', 'l-4',
    'l5-a', 'l5-b', 'l5-c', 'l5-d',
    'j-1', 'j-2', 'j-3', 'j-4',
    /* v1.60.0 新增 12（按 category 顺序追加，保持原 0-27 idx 兼容） */
    '1x2', '2x1', '1x3', '3x1',
    'diag-2a', 'diag-2b', 'diag-3a', 'diag-3b',
    'l3-a', 'l3-b', 'l3-c', 'l3-d',
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

export function normalizeSpawnPolicyMode(mode) {
    if (mode === 'model' || mode === SPAWN_MODE_MODEL_V3) return SPAWN_MODE_MODEL_V3;
    return SPAWN_MODE_RULE;
}

/** @returns {'rule'|'model-v3'} */
export function getSpawnPolicyMode() {
    if (typeof localStorage === 'undefined') return SPAWN_MODE_RULE;
    return normalizeSpawnPolicyMode(localStorage.getItem(SPAWN_MODE_KEY));
}

/** @param {'rule'|'model'|'model-v3'} mode */
export function setSpawnPolicyMode(mode) {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(SPAWN_MODE_KEY, normalizeSpawnPolicyMode(mode));
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
/* v1.57.1：spawnIntent one-hot 6 → 7 维，新增 'sprint' 中间档（stress ∈ [0.45, 0.55) 渐紧过渡带）。
 * 顺序必须与 rl_pytorch/spawn_model/dataset.py `_SPAWN_INTENTS` 严格一致（sprint 追加在末尾，
 * idx 0~5 与旧版保持兼容；未知 intent 回退 'maintain'）。 */
export const SPAWN_INTENT_VOCAB = ['relief', 'engage', 'harvest', 'pressure', 'flow', 'maintain', 'sprint'];
const _SPAWN_INTENTS = SPAWN_INTENT_VOCAB;
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
        /* v1.55.17：ML 上下文用 raw 域 [-0.2, 1] 的 stressRaw，保持训练时特征分布不变；
         * 不用 a.stress（v1.55.17 起为 norm 域 [0, 1]，会破坏模型权重的尺度假设）。
         * 详见 web/src/adaptiveSpawn.js 顶部 normalizeStress JSDoc。 */
        Math.max(-0.5, Math.min(1.5, a.stressRaw ?? a.stress ?? 0)),
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
        // [48-54] spawnIntent one-hot（v1.57.1：6 → 7 维，含 sprint）
        ..._spawnIntentOneHot(hints.spawnIntent ?? a.spawnIntent),
        // [55-56] 额外策略上下文
        _scaleUnit(hints.multiLineTarget, 2),
        _SESSION_MAP[sessionArc] ?? 0.5,
        // [57-60] PB 曲线 θ（v1.61.0 显式条件，归一化；缺省 → 默认域）
        ..._normPbTheta(stressBreakdown.pbCurveParams),
    ].slice(0, SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM);
}

export function computeSpawnTargetDifficulty(profile, adaptiveInsight, topology = null) {
    const skill = profile.skillLevel ?? 0.5;
    const frustration = profile.frustrationLevel ?? 0;
    /* v1.55.17：targetDifficulty 公式的 `0.15 * stress` 权重按 raw 域校准（系数来自模型
     * 早期回归），改用 stressRaw 保持向后兼容；fallback 到 stress（norm）仅用于尚未升级的
     * 调用方，行为略不同但量纲一致。详见 adaptiveSpawn.js 顶部 normalizeStress JSDoc。 */
    const stress = (adaptiveInsight || {}).stressRaw ?? (adaptiveInsight || {}).stress ?? 0;
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
    /* v1.60.1：Spawn 模型的特征上下文走"玩家失误评估"口径——boardRisk / nearClear
     * 等下游计算不应被独立库散点孤岛干扰。 */
    const topology = opts.topology || (grid ? analyzeBoardTopology(grid, { skipSpecialCells: true }) : null);
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
        mode: getSpawnPolicyMode(),
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
    /* v1.60.1：spawn 难度目标走"玩家失误评估"口径 */
    const targetDifficulty = computeSpawnTargetDifficulty(profile, adaptiveInsight, analyzeBoardTopology(grid, { skipSpecialCells: true }));

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
 * 调用 SpawnPolicyNet 推理（带可解性硬约束）。
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
        console.warn('SpawnPolicyNet predict failed:', e);
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
