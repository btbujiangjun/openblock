/**
 * bot/liveGeometrySignals.js — spawn 决策前盘面几何信号实时回灌（v1.71 从 adaptiveSpawn.js 抽出）
 *
 * 单一职责：以"当前盘面"重算 spawnContext 的几何字段，减少 ctx 快照时序滞后。
 *
 * 回灌字段：
 *   - nearFullLines / holes / close1 / close2 — 来自 analyzeBoardTopology(grid)
 *   - multiClearCandidates                     — 优先按当前 dock 三块；dock 不可用时回退全形状库
 *   - mobility / firstMoveFreedom / placementSolutionScore — 来自 computeCandidatePlacementMetric
 *   - pcSetup                                  — 来自 analyzePerfectClearSetup(grid)
 *
 * 设计原则：纯函数，不就地改入参；以 immutable spread 重建 ctx。
 *
 * **行为契约**：与抽出前严格一致（adaptiveSpawn.test.js + spawnIntentSnapshot.test.js 守护）。
 */

import { GAME_RULES } from '../gameRules.js';
import { analyzeBoardTopology } from '../boardTopology.js';
import { getAllShapes } from '../shapes.js';
import { analyzePerfectClearSetup, computeCandidatePlacementMetric } from './blockSpawn.js';

function _bestMultiClearPotential(grid, shapeData) {
    if (!grid || !shapeData) return 0;
    /* 性能：只需消行条数 → 优先走轻量 countClearLines（无整盘 temp 分配）；旧 grid 兜底 previewClearOutcome。 */
    const fast = typeof grid.countClearLines === 'function';
    let best = 0;
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            let lines;
            if (fast) {
                lines = grid.countClearLines(shapeData, x, y);
            } else {
                const outcome = grid.previewClearOutcome?.(shapeData, x, y, 0);
                lines = outcome ? (outcome.rows?.length ?? 0) + (outcome.cols?.length ?? 0) : 0;
            }
            if (lines > best) best = lines;
            if (best >= 2) return best;
        }
    }
    return best;
}

export function _countMultiClearCandidatesFromShapePool(grid, shapePool) {
    if (!grid || !Array.isArray(shapePool) || shapePool.length === 0) return null;
    let count = 0;
    for (const shape of shapePool) {
        if (_bestMultiClearPotential(grid, shape.data) >= 2) count++;
    }
    return count;
}

/**
 * v1.25：spawn 决策前优先用"当前盘面"重算几何信号，减少 ctx 快照时序滞后。
 * - nearFullLines：来自 analyzeBoardTopology(grid)
 * - multiClearCandidates：优先按当前 dock 三块；dock 不可用时回退全形状库
 * - pcSetup（v1.57.4 补漏）：来自 analyzePerfectClearSetup(grid)；旧实现只刷新 nfl/mcc
 *   把 pcSetup 留在快照上，导致 17% 散布盘面玩家消行后 spawnIntent='harvest' 仍命中
 *   `pcSetup ≥1 && fill ≥ 0.45` 分支（fill 也只有 mergeLiveGeometrySignals 没刷新）。
 *
 * @param {object} ctx
 * @returns {object}
 */
export function _mergeLiveGeometrySignals(ctx) {
    const grid = ctx?._gridRef;
    if (!grid?.cells?.length || !Number.isFinite(grid.size)) return ctx;
    let next = ctx;
    /* v1.60.1：adaptiveSpawn 是"玩家失误评估"链路，独立库块产生的孤岛豁免 */
    const topo = analyzeBoardTopology(grid, { skipSpecialCells: true });
    if (Number.isFinite(topo?.nearFullLines)) {
        next = { ...next, nearFullLines: topo.nearFullLines };
    }
    /* 回灌 holes / close1 / close2：复用上面这份 topo（零额外算力）。
     * 历史缺陷修复 —— spawnContext 从未注入这三个几何字段，导致下游
     * buildPlayerAbilityVector 的 boardPlanning(holePenalty / nearClear) 与
     * riskLevel(holes 项) 恒读到 0，holeReliefAdjust / deriveBoardDifficulty /
     * deriveFriendlyBoardRelief(`holes>0` 守卫) 也随之失真。 */
    if (Number.isFinite(topo?.holes)) next = { ...next, holes: topo.holes };
    if (Number.isFinite(topo?.close1)) next = { ...next, close1: topo.close1 };
    if (Number.isFinite(topo?.close2)) next = { ...next, close2: topo.close2 };
    const dockPool = Array.isArray(ctx?._dockShapePool)
        ? ctx._dockShapePool
            .filter((s) => Array.isArray(s?.data))
            .map((s) => ({ data: s.data }))
        : [];
    const shapePool = dockPool.length > 0 ? dockPool : getAllShapes();
    const liveMcc = _countMultiClearCandidatesFromShapePool(grid, shapePool);
    if (Number.isFinite(liveMcc)) {
        next = { ...next, multiClearCandidates: liveMcc };
    }
    /* 回灌 mobility(Σ各未放置块合法落点) 与 firstMoveFreedom(瓶颈块最小落点)：
     * 复用 computeCandidatePlacementMetric（与 game.js _spawnGeoForSnapshot / blockSpawn 同口径 SSOT）。
     * 修复历史死输入 —— 二者 spawnContext 从未注入：mobility 让 boardPlanning 走 fallback 0.55 常量，
     * firstMoveFreedom 让 riskLevel 的 lockRisk 项恒不参与。仅在真实 dock 池可用时计算。 */
    if (dockPool.length > 0) {
        const placement = computeCandidatePlacementMetric(grid, dockPool.map((s) => ({ shape: s.data })));
        if (placement) {
            if (Number.isFinite(placement.solutionCount)) next = { ...next, mobility: placement.solutionCount };
            if (Number.isFinite(placement.firstMoveFreedom)) next = { ...next, firstMoveFreedom: placement.firstMoveFreedom };
            /* placementSolutionScore：整盘 dock「平均每块安全度」∈[0,1]，与 game.js _updateBottleneckTrough
             * 同口径（lockRisk 主分支输入）。本分支服务 bot/simulator（dockPool 非空）路径，玩家路径由
             * game.js 实时回灌。归一尺度复用 playerAbilityModel.risk.firstMoveFreedomSafe（默认 8）。 */
            if (Number.isFinite(placement.solutionCount)) {
                const safe = Number(GAME_RULES.playerAbilityModel?.risk?.firstMoveFreedomSafe) || 8;
                next = { ...next, placementSolutionScore: Math.max(0, Math.min(1, (placement.solutionCount / dockPool.length) / safe)) };
            }
        }
    }
    /* v1.57.4：pcSetup 也实时重算。它进入两个口径：
     *   (a) deriveSpawnIntent 的 harvestable 判定（与 nfl 并列）
     *   (b) deriveSpawnTargets 的 perfectClearOpportunity 加权
     * 不重算会让"上次 spawn 时 pcSetup=1"的快照一直驻留，玩家消行后 fill < 0.45
     * 仍可能误命中 harvest 分支（虽被 PC_SETUP_MIN_FILL 拦住一部分，但 fill 自身
     * 是 _boardFill 入参的实时值，pcSetup 不重算就让两者口径不对齐）。 */
    try {
        const livePc = analyzePerfectClearSetup(grid);
        if (Number.isFinite(livePc)) {
            next = { ...next, pcSetup: livePc };
        }
    } catch {
        // pcSetup 重算失败不影响主流程（旧 ctx.pcSetup 兜底）
    }
    return next;
}
