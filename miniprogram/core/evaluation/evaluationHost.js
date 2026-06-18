/**
 * evaluationHost.js — 端无关的 evaluation 钩子集合
 *
 * 把"创建 ledger / 处理 spawn / 处理 place / 处理轮结束 / 局结束聚合 + 上报"
 * 封装为一组接收 host 对象的纯函数，让 Web Game、miniprogram GameController、
 * Cocos GameController 共用同一套接入代码，避免散落 try/catch。
 *
 * **host 契约**（最小必需字段；具体端按自身命名映射）：
 *
 *   {
 *     // 状态字段（host 自己持有）
 *     evalLedger, evalActiveSpawnIdx, evalRoundStartCells, evalRoundMoves,
 *     evalRoundDockShapes, evalRoundLines, evalRoundStressAtSpawn,
 *     lastMoveEvalMetrics, lastRoundEvalMetrics, lastMoveEvalSnapshot,
 *
 *     // 必备 getters
 *     getGridCells():  number[][]                  // null=空格，非 null=占用
 *     getDockBlocks(): Array<{ shape, placed }>
 *     getAdaptiveInsight(): { spawnHints, flowState, ... } | null
 *     getSpawnDiagnostics(): { layer1, attempt, solutionRejects } | null
 *     getStress(): number                          // 当前 normalized stress [0,1]
 *     getRulesConfig(section, fallback): object    // 读 game_rules.json 子树
 *
 *     // 可选 getters
 *     getUserId?(): string|null
 *     getDailyRunIndex?(): number|null
 *     getRunOverRunArc?(): string|null
 *     getStrategy?(): string|null
 *     getPlayerProfileSnapshot?(): { lifecycleStage?, maturityBand?, flowState? }
 *
 *     // 上报：返回 Promise，host 根据端能力实现 fetch / wx.request / cocos http
 *     postSessionEvalRecord(record): Promise<void>
 *   }
 *
 * 任何 host 上的钩子失败都会被本模块 try/catch 兜底——evaluation 是侧支信号，
 * 不应影响主玩法。
 */

const { evaluatePlacement } = require('./placementQuality');
const { evaluateRound } = require('./roundQuality');
const { buildSessionEvalRecord } = require('./sessionEvaluator');
const { createLogger } = require('../lib/logger');

const log = createLogger('evaluation');
const {
    createEvaluationLedger,
    recordStressSample,
    recordFlowSample,
    recordBoardSample,
    recordMoveQuality,
    recordRoundQuality,
    recordSpawnEvent,
    finalizeSpawnEvent,
    setLedgerOutcome,
    patchLedgerMeta,
} = require('./evaluationLedger');

function evalOnSessionStart(host, meta = {}) {
    const profile = host.getPlayerProfileSnapshot?.() || {};
    host.evalLedger = createEvaluationLedger({
        userId: host.getUserId?.() || null,
        strategy: host.getStrategy?.() || null,
        dailyRunIndex: host.getDailyRunIndex?.() ?? null,
        runOverRunArc: host.getRunOverRunArc?.() ?? null,
        lifecycleStage: profile.lifecycleStage || null,
        maturityBand: profile.maturityBand || null,
        ...meta,
    });
    host.evalActiveSpawnIdx = -1;
    host.evalRoundStartCells = null;
    host.evalRoundMoves = [];
    host.evalRoundDockShapes = null;
    host.evalRoundLines = 0;
    host.evalRoundStressAtSpawn = 0;
    host.lastMoveEvalMetrics = null;
    host.lastRoundEvalMetrics = null;
    host.lastMoveEvalSnapshot = null;
}

function evalOnSpawn(host, shapes) {
    const led = host.evalLedger;
    if (!led) return;
    if (host.evalActiveSpawnIdx >= 0) evalCloseRound(host);
    try {
        const insight = host.getAdaptiveInsight?.() || {};
        const hints = insight.spawnHints || {};
        const stress = host.getStress?.() || 0;
        host.evalRoundStressAtSpawn = stress;
        const diag = host.getSpawnDiagnostics?.() || {};
        const solutionMetrics = diag.layer1?.solutionMetrics || null;
        const rejects = diag.solutionRejects || {};
        const rejectTotal = Object.values(rejects)
            .reduce((s, v) => s + (Number(v) || 0), 0);
        host.evalActiveSpawnIdx = recordSpawnEvent(led, {
            ts: Date.now(),
            spawnIntent: hints.spawnIntent || 'maintain',
            clearGuarantee: hints.clearGuarantee || 0,
            payoffIntensity: hints.spawnTargets?.payoffIntensity ?? 0,
            solutionCount: Number.isFinite(solutionMetrics?.solutionCount)
                ? solutionMetrics.solutionCount : null,
            targetSolutionRange: hints.targetSolutionRange || null,
            softFilterRejects: rejectTotal,
            softFilterResamples: Number(diag.attempt) || 0,
            stressAtSpawn: stress,
        });
        host.evalRoundStartCells = cloneCells(host.getGridCells?.());
        host.evalRoundDockShapes = Array.isArray(shapes)
            ? shapes.map((s) => (s && s.data ? s.data : s?.shape || null))
            : null;
        host.evalRoundMoves = [];
        host.evalRoundLines = 0;
        recordStressSample(led, stress, Date.now());
        recordFlowSample(led, insight.flowState || null);
        const layer1 = diag.layer1 || {};
        recordBoardSample(led, {
            holes: layer1.holes ?? 0,
            flatness: layer1.flatness ?? 1,
            firstMoveFreedom: solutionMetrics?.firstMoveFreedom ?? 0,
        });
    } catch (e) {
        log.warn('onSpawn failed:', e?.message || e);
    }
}

function evalOnPlace(host, dockIndex, pos, linesCleared) {
    const led = host.evalLedger;
    if (!led) return;
    try {
        const shape = host.evalRoundDockShapes?.[dockIndex];
        if (!shape || !pos) return;
        const board = host.getGridCells?.();
        if (!board) return;
        // 我们需要的是"放置前"盘面：caller 必须在调用 evalOnPlace 之前传入快照。
        // host 端简化：在 grid.place() 前调用 setPendingBoardBefore(snapshot)。
        const before = host.evalPendingBoardBefore || board;
        host.evalPendingBoardBefore = null;
        const remaining = remainingDockShapes(host, dockIndex);
        const cfg = host.getRulesConfig?.('placementEvaluation', {}) || {};
        const mq = evaluatePlacement({
            boardBefore: before,
            shape,
            pos: { x: pos.x | 0, y: pos.y | 0 },
            remainingShapes: remaining,
            config: cfg,
        });
        recordMoveQuality(led, mq);
        /* v1.69.2：回灌 host 的 playerProfile.recordMoveQuality（若实现），
         * 让 adaptiveSpawn 等下游能实时读 profile.evalMetrics。host 没实现
         * 此 API 时静默跳过（小程序/Cocos 端逐步接入）。 */
        try { host.getPlayerProfileRef?.()?.recordMoveQuality?.(mq); } catch (_e) { /* ignore */ }
        host.evalRoundMoves.push({
            dockIndex,
            pos: { x: pos.x | 0, y: pos.y | 0 },
            linesCleared: Number(linesCleared) || 0,
            ts: Date.now(),
        });
        host.evalRoundLines += Number(linesCleared) || 0;
        const snap = {
            absScore: mq.absScore, regret: mq.regret, optimality: mq.optimality,
            badnessTag: mq.badnessTag, components: mq.components,
            optimalPos: mq.optimalPos,
        };
        host.lastMoveEvalMetrics = snap;
        host.lastMoveEvalSnapshot = snap;
        recordStressSample(led, host.getStress?.() || 0, Date.now());
        const ins = host.getAdaptiveInsight?.() || {};
        recordFlowSample(led, ins.flowState || null);
    } catch (e) {
        log.warn('onPlace failed:', e?.message || e);
    }
}

function evalCloseRound(host) {
    const led = host.evalLedger;
    if (!led) return;
    try {
        if (host.evalRoundStartCells && host.evalRoundDockShapes
            && host.evalRoundMoves.length === 3) {
            const cfg = host.getRulesConfig?.('roundEvaluation', {}) || {};
            const rq = evaluateRound({
                boardBefore: host.evalRoundStartCells,
                dockShapes: host.evalRoundDockShapes,
                moves: host.evalRoundMoves,
                config: cfg,
            });
            recordRoundQuality(led, rq);
            try { host.getPlayerProfileRef?.()?.recordRoundQuality?.(rq); } catch (_e) { /* ignore */ }
            host.lastRoundEvalMetrics = {
                absScore: rq.absScore, classification: rq.classification,
                regrets: rq.regrets, bestRoundAbs: rq.bestRoundAbs,
                payoffRealized: rq.components?.payoffRealized || 0,
            };
            if (host.evalActiveSpawnIdx >= 0) {
                finalizeSpawnEvent(led, host.evalActiveSpawnIdx, {
                    stressAfter: host.getStress?.() || 0,
                    linesInRound: host.evalRoundLines,
                    dockPermUsed: host.evalRoundMoves.map((m) => m.dockIndex),
                });
            }
        }
    } catch (e) {
        log.warn('closeRound failed:', e?.message || e);
    }
    host.evalActiveSpawnIdx = -1;
    host.evalRoundStartCells = null;
    host.evalRoundDockShapes = null;
    host.evalRoundMoves = [];
    host.evalRoundLines = 0;
}

async function evalOnGameOver(host, outcome) {
    const led = host.evalLedger;
    if (!led) return;
    try {
        if (host.evalActiveSpawnIdx >= 0) {
            finalizeSpawnEvent(led, host.evalActiveSpawnIdx, {
                stressAfter: host.getStress?.() || 0,
                linesInRound: host.evalRoundLines,
                dockPermUsed: host.evalRoundMoves.map((m) => m.dockIndex),
            });
        }
        patchLedgerMeta(led, {
            pbAfter: Number(outcome?.pbAfter) || 0,
            runId: outcome?.runId || null,
        });
        setLedgerOutcome(led, {
            finalScore: Number(outcome?.finalScore) || 0,
            survivedSteps: Number(outcome?.survivedSteps) || 0,
            placedCount: Number(outcome?.placedCount) || 0,
            linesCleared: Number(outcome?.linesCleared) || 0,
            multiClears: Number(outcome?.multiClears) || 0,
            perfectClears: Number(outcome?.perfectClears) || 0,
            maxCombo: Number(outcome?.maxCombo) || 0,
            runDurationMs: Number(outcome?.runDurationMs) || 0,
            endCause: String(outcome?.endCause || 'normal'),
        });
        const record = buildSessionEvalRecord(led);
        await host.postSessionEvalRecord?.(record);
    } catch (e) {
        log.warn('onGameOver failed:', e?.message || e);
    } finally {
        host.evalLedger = null;
    }
}

/* ─────────────────────────── 内部工具 ─────────────────────────── */

function cloneCells(cells) {
    if (!Array.isArray(cells)) return null;
    return cells.map((row) => row.slice());
}

function remainingDockShapes(host, currentIdx) {
    const arr = host.evalRoundDockShapes || [];
    const blocks = host.getDockBlocks?.() || [];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
        if (i === currentIdx) continue;
        if (blocks[i]?.placed) continue;
        const s = arr[i];
        if (s) out.push(s);
    }
    return out;
}

module.exports = { evalCloseRound, evalOnGameOver, evalOnPlace, evalOnSessionStart, evalOnSpawn };
