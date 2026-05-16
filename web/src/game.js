/**
 * Open Block - Main Game Controller
 * Full game logic with behavior tracking
 */
import { CONFIG, getStrategy, GAME_EVENTS, ACHIEVEMENTS_BY_ID } from './config.js';
import { initScoreAnimator, animateScore, setScoreImmediate, stopScoreAnimation, syncHudScoreElement } from './scoreAnimator.js';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from './adaptiveSpawn.js';
import { PlayerProfile } from './playerProfile.js';
import { GAME_RULES } from './gameRules.js';
/* v1.48 (2026-05) — 生命周期编排层接线员，把 churnPredictor / winbackProtection /
 * shouldTriggerIntervention 等孤立模块通过 startGame / endGame 钩子接到主流程。 */
import { onSessionStart, onSessionEnd } from './lifecycle/lifecycleOrchestrator.js';
/* v1.50.x：把每局结束时的 lifecycle snapshot（stage / band / skillScore /
 * confidence）注入 sessions.game_stats.lifecycle，让后端 PATCH 可同步到
 * user_stats 的 lifecycle_stage / maturity_band / skill_score / lifecycle_updated_at
 * 4 列；运营从 SQL 即可按"阶段·成熟度"分群查留存 / ARPU。 */
import { getCachedLifecycleSnapshot } from './lifecycle/lifecycleSignals.js';
import { getLifecycleMaturitySnapshot } from './retention/playerLifecycleDashboard.js';
import {
    applyGameEndProgression,
    loadProgress,
    getLevelProgress,
    titleForLevel
} from './progression.js';
import { t, tSkinName } from './i18n/i18n.js';
import { shouldShowNearMissPlaceFeedback, getNearMissPlaceFeedbackCfg } from './nearMissPlaceFeedback.js';
import {
    getActiveSkinId,
    getBlockColors,
    setActiveSkinId,
    SKIN_LIST,
    applySkinToDocument,
    getActiveSkin,
    SKINS,
    DEFAULT_SKIN_ID,
    onSkinAfterApply,
    normalizeSkinPickerLabel
} from './skins.js';
import { Grid } from './grid.js';
import { analyzeBoardTopology } from './boardTopology.js';
import { computeStepGain } from './dragPointerCurve.js';
import {
    generateDockShapes,
    resetSpawnMemory,
    getLastSpawnDiagnostics,
    validateSpawnTriplet,
    computeCandidatePlacementMetric
} from './bot/blockSpawn.js';
import {
    buildSpawnModelContext,
    getSpawnMode,
    predictShapesV3,
    shapeIdsToHistoryRow,
    SPAWN_MODE_MODEL_V3
} from './spawnModel.js';
import {
    buildInitFrame,
    buildPlaceFrame,
    buildPlayerStateSnapshot,
    buildReplayAnalysis,
    buildSpawnFrame,
    countPlaceStepsInFrames,
    MIN_PERSIST_PLACE_STEPS,
    replayStateAt
} from './moveSequence.js';
import { Database } from './database.js';
import { Renderer, syncGridDisplayPx } from './renderer.js';
import { BackendSync } from './services/backendSync.js';
import { emit as emitMonetizationEvent } from './monetization/MonetizationBus.js';
import {
    getBestByStrategy,
    submitScoreToBucket,
    submitPeriodBest,
    getPeriodBest,
} from './bestScoreBuckets.js';
import { LevelManager } from './level/levelManager.js';
import { ClearRuleEngine, RowColRule } from './clearRules.js';
import { notePopupShown } from './popupCoordinator.js';
import {
    detectBonusLines,
    computeClearScore,
    ICON_BONUS_LINE_MULT,
    PERFECT_CLEAR_MULT,
    bonusEffectHoldMs,
    monoNearFullLineColorWeights,
    pickThreeDockColors
} from './clearScoring.js';

export {
    detectBonusLines,
    computeClearScore,
    ICON_BONUS_LINE_MULT,
    PERFECT_CLEAR_MULT,
    bonusEffectHoldMs,
    monoNearFullLineColorWeights,
    pickThreeDockColors
};

function _topShapeWeightEntries(shapeWeights, n) {
    if (!shapeWeights || typeof shapeWeights !== 'object') return [];
    const totalWeight = Object.values(shapeWeights)
        .reduce((sum, weight) => sum + Math.max(0, Number(weight) || 0), 0);
    return Object.entries(shapeWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([category, weight]) => {
            const w = Math.max(0, Number(weight) || 0);
            return {
                category,
                weight: w,
                probability: totalWeight > 0 ? w / totalWeight : 0,
            };
        });
}

/** 回放帧深拷贝：优先 structuredClone，失败时回退 JSON（见 PERFORMANCE.md） */
function _cloneReplayFrames(frames) {
    try {
        if (typeof structuredClone === 'function') {
            return frames.map((f) => structuredClone(f));
        }
    } catch {
        /* ignore */
    }
    return frames.map((f) => JSON.parse(JSON.stringify(f)));
}

export class Game {
    constructor() {
        this.grid = new Grid(CONFIG.GRID_SIZE);
        this.canvas = document.getElementById('game-grid');
        this.ghostCanvas = document.getElementById('drag-ghost');
        this.ghostCtx = this.ghostCanvas.getContext('2d');
        // v10.12: 特效叠加层 — 粒子/闪光独立绘制，可溢出盘面增强立体感。
        // 当 #game-grid-fx 不存在时（如旧 HTML / 测试环境），Renderer 自动退回为单画布行为。
        this.fxCanvas = document.getElementById('game-grid-fx');
        this.renderer = new Renderer(this.canvas, { fxCanvas: this.fxCanvas });
        /* canvas 物理像素重置（resize / setQualityMode 改 DPR）会清空 canvas 内容。
         * high 画质有 watermark idle 动画掩盖该空帧；balanced/low 没有任何驱动，
         * 切 RL 面板等触发 resize 后盘面会停留在空白上。registry 一个 markDirty 回调
         * 保证下一帧立刻补画。 */
        this.renderer.onCanvasReset?.(() => this.markDirty());
        this.db = new Database();

        this.score = 0;
        this.bestScore = 0;
        this._bestScoreAtRunStart = 0;
        this._newBestCelebrated = false;
        this.dockBlocks = [];
        this.sessionId = null;
        this.strategy = localStorage.getItem('openblock_strategy') || 'normal';
        /** 连战计数：主菜单「开始游戏」清零；再来一局 / 死局重开 +1 */
        this.runStreak = 0;

        this.drag = null;
        this.dragBlock = null;
        this.previewPos = null;
        this.previewBlock = null;
        this.isAnimating = false;
        this.isGameOver = false;
        /** 自博弈盘面演示时禁止玩家操作 */
        this.rlPreviewLocked = false;
        /** 回放播放中禁止玩家操作 */
        this.replayPlaybackLocked = false;

        /** @type {object[]} 本局 init → spawn → place… 序列，写入 moveSequences */
        this.moveSequence = [];
        this._movePersistTimer = null;
        /** @type {object[] | null} 当前回放用的帧副本 */
        this._replayFrames = null;

        this.gameStats = {
            score: 0,
            clears: 0,
            maxLinesCleared: 0,
            maxCombo: 0,
            placements: 0,
            misses: 0,
            startTime: 0
        };
        /** 连续消行落子计数，未消行的落子重置为 0 */
        this._clearStreak = 0;

        /** 跨轮出块上下文：传给 adaptiveSpawn + blockSpawn 的三层信号 */
        this._spawnContext = {
            lastClearCount: 0, roundsSinceClear: 0, recentCategories: [], totalRounds: 0, scoreMilestone: false,
            bottleneckTrough: Infinity, bottleneckSolutionTrough: Infinity, bottleneckSamples: 0
        };

        this.behaviors = [];
        this.backendSync = new BackendSync(this.db.userId);
        /** @type {ReturnType<typeof setTimeout> | null} */
        this._noMovesTimer = null;
        /** v1.50：几何近失 toast 控频（单局次数 / 落子间隔 / 时间冷却） */
        this._nearMissPlaceToastCount = 0;
        this._nearMissPlaceLastAt = null;
        this._nearMissPlaceLastPlacement = null;
        /** 模型异步出块进行中，跳过 game over 检查 */
        this._spawnPending = false;
        this._spawnRequestId = 0;

        /** 玩家实时能力画像（跨局持久化） */
        this.playerProfile = PlayerProfile.load();

        /** @type {object | null} 上一轮出块时自适应引擎快照（可解释性面板） */
        this._lastAdaptiveInsight = null;
        /** @type {(() => void) | null} 由 playerInsightPanel 注入 */
        this._playerInsightRefresh = null;
        /** 本局「实时状态」序列快照（与 move_sequence 中 ps 结构一致），供左侧 sparkline */
        this._insightLiveHistory = [];
        /** 悬浮预览将消行时，驱动描边脉冲的 rAF */
        this._previewClearRaf = null;
        /** 皮肤环境动效低频 fxCanvas 循环：只重绘特效层，不触发整盘 render */
        this._ambientFxTimer = null;
        this._ambientFxRaf = null;
        this._popupToastQueue = Promise.resolve();
        this._lastPopupToastAt = 0;
        /** markDirty 合并到单帧一次 render（见 PERFORMANCE.md） */
        this._renderRaf = null;
        this._renderDirty = false;
        /** 预览消行 outcome 缓存键 */
        this._lastPreviewClearKey = null;
        this._lastPreviewClearCells = null;
        /** 拖拽输入合帧：高频 move 事件只保留最后一个点，下一帧统一计算 */
        this._dragMoveRaf = null;
        this._pendingDragPoint = null;
        /** 候选块「可落子数」缓存：仅在 dock 签名（id+placed）变化时重算 */
        this._dockPlacementSolutionCache = { key: null, solutionCount: null, firstMoveFreedom: null };
    }

    /** dock 槽位候选签名：新一波三块或任一块落子后都会变 */
    _dockCandidateSignature() {
        if (!Array.isArray(this.dockBlocks) || this.dockBlocks.length === 0) {
            return '__empty__';
        }
        return this.dockBlocks.map((b) => `${b?.id ?? '?'}:${b?.placed ? 1 : 0}`).join('|');
    }

    /**
     * 展示用解法：未放置候选块在当前盘面的合法落子数之和（及瓶颈块最少落子数）。
     * 与 {@link computeCandidatePlacementMetric} 一致，带签名缓存。
     */
    getCandidatePlacementSolutionSnapshot() {
        const key = this._dockCandidateSignature();
        const c = this._dockPlacementSolutionCache;
        if (c.key === key && Number.isFinite(c.solutionCount)) {
            return { solutionCount: c.solutionCount, firstMoveFreedom: c.firstMoveFreedom };
        }
        const m = computeCandidatePlacementMetric(this.grid, this.dockBlocks || []);
        if (!m) {
            this._dockPlacementSolutionCache = { key, solutionCount: null, firstMoveFreedom: null };
            return null;
        }
        const row = { solutionCount: m.solutionCount, firstMoveFreedom: m.firstMoveFreedom };
        this._dockPlacementSolutionCache = { key, ...row };
        return row;
    }

    _cancelPreviewClearAnim() {
        if (this._previewClearRaf != null) {
            cancelAnimationFrame(this._previewClearRaf);
            this._previewClearRaf = null;
        }
    }

    /** 在拖拽且预览位会触发消行时，持续重绘以播放待消除高亮 */
    _ensurePreviewClearAnim() {
        if (this._previewClearRaf != null) {
            return;
        }
        const loop = () => {
            this._previewClearRaf = null;
            if (!this.drag || !this.previewPos || !this.previewBlock) {
                return;
            }
            const oc = this._getPreviewClearCells();
            if (!oc?.cells?.length) {
                return;
            }
            this.markDirty();
            this._previewClearRaf = requestAnimationFrame(loop);
        };
        this._previewClearRaf = requestAnimationFrame(loop);
    }

    _refreshPlayerInsightPanel() {
        if (typeof this._playerInsightRefresh === 'function') {
            this._playerInsightRefresh();
        }
    }

    /**
     * 写入 move_sequence 帧快照：盘面空洞（实时拓扑）+ 候选块可落子数之和（见 getCandidatePlacementSolutionSnapshot）。
     * @returns {{ holes: number, solutionCount: number | null } | null}
     */
    _spawnGeoForSnapshot() {
        if (!this.grid) return null;
        let topo;
        try {
            topo = analyzeBoardTopology(this.grid);
        } catch {
            return null;
        }
        const snap = this.getCandidatePlacementSolutionSnapshot();
        const solutionCount =
            snap != null && Number.isFinite(Number(snap.solutionCount))
                ? Number(snap.solutionCount)
                : null;
        /* v1.46：把"平整"与"首手自由度"也纳入 ps.spawnGeo，与回放/数据库一并持久化。
         * - flatness：1/(1+heightVariance)，1=完全平整；空盘约 1.0；单根孤柱在 9×9
         *   通常 0.15~0.30，截图里 8×8 + 高度 3 的孤柱就是 0.50（数学上无误）。
         * - firstMoveFreedom：当前各候选块独立放置时的最小合法点数（"瓶颈块自由度"），
         *   ≤2 时下一轮 spawn 触发 bottleneckRelief 减压（详见 adaptiveSpawn.js）。 */
        const sm = snap ?? computeCandidatePlacementMetric(this.grid, this.dockBlocks || []);
        const firstMoveFreedom = sm != null && Number.isFinite(Number(sm.firstMoveFreedom))
            ? Number(sm.firstMoveFreedom)
            : null;
        return {
            holes: topo.holes,
            flatness: Number.isFinite(topo.flatness) ? topo.flatness : null,
            firstMoveFreedom,
            solutionCount
        };
    }

    /**
     * v1.30：追踪 dock 周期内 firstMoveFreedom 的最低点（"瓶颈低谷"）。
     *
     * 物理含义：当前 dock 三块在玩家陆续放置过程中，剩余未放置候选的最少合法落子数。
     * trough = `min(firstMoveFreedom)`（dock 周期内所有快照的最小值）。trough 越小说
     * 明这一轮玩家越接近"被困"。下次 spawnBlocks 时由 adaptiveSpawn.js 读取，
     * 转换为 `bottleneckRelief`（负向 stress）+ 提升 `clearGuarantee/sizePreference`。
     *
     * 实施细节：
     *   - 在每次 placement 后调用，仅在仍有未放置块时更新（snap≠null）
     *   - `_captureAdaptiveInsight` 透传当前 trough 至 `_lastAdaptiveInsight`，便于面板查看
     *   - `_commitSpawn` 末尾调用 `_resetBottleneckTrough` 让新一轮从 +Infinity 重新计数
     *
     * 与现有 `getCandidatePlacementSolutionSnapshot()` 共享缓存（依赖 dock 签名变化）。
     */
    _updateBottleneckTrough() {
        if (!this._spawnContext) return;
        const snap = this.getCandidatePlacementSolutionSnapshot();
        if (!snap) return;
        const fmf = Number(snap.firstMoveFreedom);
        const sc = Number(snap.solutionCount);
        const prev = Number(this._spawnContext.bottleneckTrough);
        if (Number.isFinite(fmf)) {
            this._spawnContext.bottleneckTrough =
                Number.isFinite(prev) ? Math.min(prev, fmf) : fmf;
        }
        const prevSc = Number(this._spawnContext.bottleneckSolutionTrough);
        if (Number.isFinite(sc)) {
            this._spawnContext.bottleneckSolutionTrough =
                Number.isFinite(prevSc) ? Math.min(prevSc, sc) : sc;
        }
        this._spawnContext.bottleneckSamples =
            (Number(this._spawnContext.bottleneckSamples) || 0) + 1;
    }

    /** 在 _commitSpawn 末尾重置：新 dock 周期开始计数 */
    _resetBottleneckTrough() {
        if (!this._spawnContext) return;
        this._spawnContext.bottleneckTrough = Infinity;
        this._spawnContext.bottleneckSolutionTrough = Infinity;
        this._spawnContext.bottleneckSamples = 0;
    }

    /**
     * 在 recordSpawn 之前调用，记录决策瞬间的 stress / hints（与投放一致）
     * @param {object} layered resolveAdaptiveStrategy 返回值
     */
    _captureAdaptiveInsight(layered) {
        const p = this.playerProfile;
        this._lastAdaptiveInsight = {
            adaptiveEnabled: Boolean(GAME_RULES.adaptiveSpawn?.enabled),
            score: this.score,
            boardFill: this.grid.getFillRatio(),
            runStreak: this.runStreak,
            strategyId: this.strategy,
            /* v1.55.17：stress 对外统一 [0,1] 归一化口径（layered._adaptiveStress 已是
             * norm 域，由 adaptiveSpawn.js 末尾通过 normalizeStress() 翻译；详见
             * web/src/adaptiveSpawn.js 顶部「stress 对外归一化」JSDoc）。
             * 中性锚 fallback 0.4375 = normalizeStress(0.325)（即原 raw 中性锚 0.325 的
             * 对外口径）。stressRaw 用于必须保持训练分布或与内部数学链路对齐的下游。 */
            stress: layered._adaptiveStress,
            stressRaw: layered._adaptiveStressRaw,
            stressTarget: layered._stressTarget ?? 0.4375,
            difficultyBias: layered._difficultyBias,
            flowState: layered._flowState,
            flowDeviation: layered._flowDeviation,
            feedbackBias: layered._feedbackBias,
            skillLevel: layered._skillLevel,
            pacingPhase: layered._pacingPhase,
            momentum: layered._momentum,
            frustration: layered._frustration,
            sessionPhase: layered._sessionPhase,
            trend: layered._trend,
            confidence: layered._confidence,
            historicalSkill: layered._historicalSkill,
            abilityVector: layered._abilityVector ?? null,
            abilityRiskAdjust: layered._abilityRiskAdjust ?? 0,
            boardRisk: layered._boardRisk ?? 0,
            stressBreakdown: layered._stressBreakdown ? { ...layered._stressBreakdown } : null,
            spawnTargets: layered._spawnTargets ? { ...layered._spawnTargets } : null,
            sessionArc: layered._sessionArc,
            comboChain: layered._comboChain,
            rhythmPhase: layered._rhythmPhase,
            /* v1.49：字段更名 milestoneHit → scoreMilestoneHit；同时记录跨过的具体分数档 */
            scoreMilestoneHit: layered._scoreMilestoneHit,
            scoreMilestoneValue: layered._scoreMilestoneValue,
            spawnHints: layered.spawnHints ? { ...layered.spawnHints } : null,
            spawnDiagnostics: getLastSpawnDiagnostics(),
            fillRatio: layered.fillRatio,
            shapeWeightsTop: _topShapeWeightEntries(layered.shapeWeights, 5),
            spawnIntent: layered._spawnIntent ?? layered.spawnHints?.spawnIntent ?? null,
            motivationIntent: layered._motivationIntent ?? layered.spawnHints?.motivationIntent ?? null,
            behaviorSegment: layered._behaviorSegment ?? layered.spawnHints?.behaviorSegment ?? null,
            personalizationApplied: layered._personalizationApplied === true,
            accessibilityLoad: layered._accessibilityLoad ?? layered.spawnHints?.accessibilityLoad ?? 0,
            returningWarmupStrength: layered._returningWarmupStrength ?? layered.spawnHints?.returningWarmupStrength ?? 0,
            socialFairChallenge: layered._socialFairChallenge === true,
            afkEngageActive: layered._afkEngageActive === true
        };
        const m = p.metrics;
        this._lastAdaptiveInsight.profileAtSpawn = {
            thinkMs: m.thinkMs,
            clearRate: m.clearRate,
            missRate: m.missRate,
            afkCount: m.afkCount,
            cognitiveLoad: p.cognitiveLoad,
            engagementAPM: p.engagementAPM,
            hadRecentNearMiss: p.hadRecentNearMiss,
            needsRecovery: p.needsRecovery,
            isInOnboarding: p.isInOnboarding,
            behaviorSegment: p.behaviorSegment,
            motivationIntent: p.motivationIntent,
            accessibilityLoad: p.accessibilityLoad,
            returningWarmupStrength: p.returningWarmupStrength,
            recentComboStreak: p.recentComboStreak,
            spawnRound: p.spawnRoundIndex
        };
        if (Number.isFinite(layered._occupancyFillAnchor)) {
            this._spawnContext._occupancyFillAnchor = layered._occupancyFillAnchor;
        }
        /* v1.30：把上一周期的瓶颈低谷透传到 insight 面板，便于排障与回放对照。
         * trough 已被 adaptiveSpawn 消费成 stressBreakdown.bottleneckRelief，但原始数值
         * 单独留在 insight 上比从 breakdown 反推更直观。 */
        const _bt = Number(this._spawnContext.bottleneckTrough);
        const _bs = Number(this._spawnContext.bottleneckSolutionTrough);
        this._lastAdaptiveInsight.bottleneckTrough = Number.isFinite(_bt) ? _bt : null;
        this._lastAdaptiveInsight.bottleneckSolutionTrough = Number.isFinite(_bs) ? _bs : null;
        this._lastAdaptiveInsight.bottleneckSamples = Number(this._spawnContext.bottleneckSamples) || 0;
    }

    async init() {
        try {
            await this.db.init();
            const { hydrateWalletFromApi } = await import('./skills/wallet.js');
            await hydrateWalletFromApi(this.db.userId);
            this.bestScore = await this.db.getBestScore();
            this._bestScoreAtRunStart = this.bestScore || 0;
            /* v1.55 §4.4：读当前难度档对应的分桶 PB；优先展示分桶 PB（更精确，
             * 反映"在此难度下的个人最佳"）；服务器全账号 PB 仍作为 fallback。
             * 分桶 PB 若高于服务器 PB，沿用服务器值不覆盖（避免本地客户端外挂）。 */
            const bucketPb = getBestByStrategy(this.strategy);
            this._bestScoreByStrategy = bucketPb;
            if (bucketPb > 0 && bucketPb <= this.bestScore) {
                /* 分桶 PB 是合法子集（≤ 总 PB），用它作为本难度档 HUD 展示。 */
                this.bestScore = bucketPb;
                this._bestScoreAtRunStart = bucketPb;
            }
            const stats = await this.db.getStats();
            this.playerProfile.ingestHistoricalStats(stats);
        } catch (err) {
            console.error('SQLite API 初始化失败:', err);
            this.bestScore = 0;
            this._bestScoreAtRunStart = 0;
        }
        this.bindEvents();
        this.updateShellVisibility();
        this.updateUI();
        this.render();
        this._startAmbientFxLoop();
    }

    /**
     * v1.55.10 修复 PB 风险 1：解决"init 早于 hydrate"导致跨设备首次加载分桶 PB 为 0 的问题。
     *
     * 链路：main.js 中 `game.init()` 在 `initLocalStorageStateSync()` 之前调用，
     * 而 hydrate 只把"本地缺失"的 key 从远端 bundle 写入 localStorage——
     * 因此换设备首次打开时，init 读到 `getBestByStrategy=0`（本地空），用全账号 PB 兜底；
     * 等 hydrate 把远端分桶值写入 localStorage 后，`Game` 实例上的 `bestScore` 不会自动重算。
     *
     * 调用契约：main.js 在 `await initLocalStorageStateSync()` 之后调用本方法一次；
     * 内部仅在分桶 PB 合法且 ≤ 总账号 PB 时才采用（同 init 时的取舍规则），
     * 并刷新 HUD（updateUI）让"最佳"数字立即对齐。
     */
    refreshBestScoreFromBucket() {
        try {
            const bucketPb = getBestByStrategy(this.strategy);
            if (!Number.isFinite(bucketPb) || bucketPb <= 0) return false;
            /* 仅在分桶 PB ≤ 总账号 PB 且与当前内存值不同时才采用。
             * 注意：_bestScoreAtRunStart 已被 init() / start() 写入；这里同步更新它，
             * 让本局接下来的"新纪录判定基线"也对齐到分桶 PB。 */
            const accountPb = Math.max(Number(this.bestScore) || 0, Number(this._bestScoreByStrategy) || 0);
            if (bucketPb > accountPb) return false;
            if (bucketPb === this.bestScore) return false;
            this._bestScoreByStrategy = bucketPb;
            this.bestScore = bucketPb;
            if (!this.isGameOver && this.score === 0) {
                /* 仅在尚未开始打分的"准备态"才更新 runStart 基线，避免改动正在进行的局的判定。 */
                this._bestScoreAtRunStart = bucketPb;
            }
            this.updateUI();
            return true;
        } catch (err) {
            console.warn('[refreshBestScoreFromBucket] failed:', err?.message || err);
            return false;
        }
    }

    _startAmbientFxLoop() {
        if (typeof window === 'undefined' || this._ambientFxTimer != null) return;

        const draw = () => {
            this._ambientFxRaf = null;
            if (this._shouldDrawAmbientFxFrame()) {
                this.renderer.renderAmbientFxFrame();
            }
            if (this._shouldDrawBoardWatermarkMotionFrame()) {
                this.markDirty();
            }
        };

        const tick = () => {
            this._ambientFxTimer = null;
            const active = this._shouldDrawAmbientFxFrame() || this._shouldDrawBoardWatermarkMotionFrame();
            if (active && this._ambientFxRaf == null && typeof requestAnimationFrame === 'function') {
                this._ambientFxRaf = requestAnimationFrame(draw);
            }
            const delay = active ? this._idleDynamicFrameIntervalMs() : 1000;
            this._ambientFxTimer = window.setTimeout(tick, delay);
        };

        this._ambientFxTimer = window.setTimeout(tick, 250);
    }

    _shouldDrawIdleDynamicFrame() {
        if (typeof document !== 'undefined') {
            if (document.visibilityState === 'hidden') return false;
            const menu = document.getElementById('menu');
            if (menu?.classList.contains('active')) return false;
        }
        return !this.isAnimating && !this.drag && !this.previewPos && this._renderRaf == null;
    }

    _shouldDrawAmbientFxFrame() {
        if (!this.renderer?.hasAmbientMotion?.()) return false;
        return this._shouldDrawIdleDynamicFrame();
    }

    _shouldDrawBoardWatermarkMotionFrame() {
        if (!this.renderer?.hasBoardWatermarkMotion?.()) return false;
        return this._shouldDrawIdleDynamicFrame();
    }

    _idleDynamicFrameIntervalMs() {
        const intervals = [];
        if (this.renderer?.hasAmbientMotion?.()) {
            intervals.push(this.renderer.getAmbientFrameIntervalMs());
        }
        if (this.renderer?.hasBoardWatermarkMotion?.()) {
            intervals.push(this.renderer.getBoardWatermarkFrameIntervalMs?.() ?? 100);
        }
        return Math.max(16, Math.min(...intervals, 1000));
    }

    /**
     * 盘面语境浮层锚点：所有游戏内浮层（结算卡、复活、无步数、奖励 toast 等）
     * 都应围绕棋盘居中，而不是围绕视口居中。RL 面板收起后棋盘会变大并右移，
     * 这里把 #game-wrapper 的实际屏幕矩形写入 CSS 变量，CSS 端统一消费。
     */
    _syncBoardOverlayMetrics() {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        const board = document.getElementById('game-wrapper') || this.canvas;
        if (!root || !board) return;
        const rect = board.getBoundingClientRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) return;
        root.style.setProperty('--board-overlay-left', `${rect.left}px`);
        root.style.setProperty('--board-overlay-top', `${rect.top}px`);
        root.style.setProperty('--board-overlay-width', `${rect.width}px`);
        root.style.setProperty('--board-overlay-height', `${rect.height}px`);
        root.style.setProperty('--board-overlay-right', `${rect.right}px`);
        root.style.setProperty('--board-overlay-bottom', `${rect.bottom}px`);
        root.style.setProperty('--board-overlay-center-x', `${rect.left + rect.width / 2}px`);
        root.style.setProperty('--board-overlay-center-y', `${rect.top + rect.height / 2}px`);

        const panel = document.querySelector('.play-stack');
        const panelRect = panel?.getBoundingClientRect?.();
        if (panelRect && panelRect.width > 0 && panelRect.height > 0) {
            root.style.setProperty('--game-panel-overlay-center-x', `${panelRect.left + panelRect.width / 2}px`);
            root.style.setProperty('--game-panel-overlay-center-y', `${panelRect.top + panelRect.height / 2}px`);
        }
    }

    /** 主菜单打开时隐藏主界面与难度条；game-over 浮层保留棋盘可见 */
    updateShellVisibility() {
        const menu = document.getElementById('menu');
        const menuOpen = Boolean(menu?.classList.contains('active'));
        document.body.classList.toggle('game-shell-hidden', menuOpen);
    }

    bindEvents() {
        const startBtn = document.getElementById('start-btn');
        const retryBtn = document.getElementById('retry-btn');
        const menuBtn = document.getElementById('menu-btn');
        if (startBtn) {
            startBtn.onclick = () => void this.start({ fromChain: false });
        }
        if (retryBtn) {
            retryBtn.onclick = () => void this.start({ fromChain: true });
        }
        if (menuBtn) {
            menuBtn.onclick = () => {
                this.runStreak = 0;
                this._updateRunStreakHint();
                this.showScreen('menu');
            };
        }

        const inGameMenuBtn = document.getElementById('in-game-menu-btn');
        if (inGameMenuBtn) {
            inGameMenuBtn.onclick = () => {
                this.runStreak = 0;
                this._updateRunStreakHint();
                this.showScreen('menu');
            };
        }

        document.querySelectorAll('.strategy-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.strategy-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.strategy = btn.dataset.level;
                localStorage.setItem('openblock_strategy', this.strategy);
                this.runStreak = 0;
                this._updateRunStreakHint();
            };
        });
        /* 恢复上次选中的难度按钮 */
        const saved = this.strategy;
        if (saved !== 'normal') {
            document.querySelectorAll('.strategy-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.level === saved);
            });
        }

        const skinSelect = document.getElementById('skin-select');
        if (skinSelect) {
            this.refreshSkinSelectOptions();
            skinSelect.addEventListener('change', () => {
                if (setActiveSkinId(skinSelect.value)) {
                    // v10.15: 标记用户已主动选过皮肤，关闭 seasonalSkin 时段动态切换
                    try {
                        const m = window.__seasonalSkin;
                        if (m && typeof m.markSkinUserChosen === 'function') {
                            m.markSkinUserChosen();
                        }
                    } catch { /* ignore */ }
                }
            });
        }

        /* v10.17.5: dock / 环境层 / EffectLayer 等"被动随皮肤变化"的副作用统一挂到全局 hook，
         * 让任何入口（#skin-select / 皮肤图鉴 lore / 节日 seasonalSkin / Konami / cheat）
         * 切换皮肤后都能自动同步 dock 候选区方块外观。
         * 修复：从图鉴卡片"试用"或时段推荐切换时，dock 仍保留旧皮肤方块的 bug。
         */
        onSkinAfterApply((id) => {
            try { window.__ambientParticles?.applySkin?.(id); } catch { /* ignore */ }
            try { window.__effectLayer?.setRenderer?.(this.renderer); } catch { /* ignore */ }
            try {
                const sel = document.getElementById('skin-select');
                if (sel && sel.value !== id) sel.value = id;
            } catch { /* ignore */ }
            this.refreshDockSkin();
            this._normalizeDockState('skin-change');
            this.markDirty();
        });

        document.addEventListener('mousemove', e => this.onMove(e));
        document.addEventListener('touchmove', e => this.onMove(e), { passive: false });
        document.addEventListener('pointermove', e => this.onMove(e));
        document.addEventListener('mouseup', () => this.onEnd());
        document.addEventListener('touchend', () => this.onEnd());
        document.addEventListener('pointerup', () => this.onEnd());
        document.addEventListener('pointercancel', () => this.onEnd());

        // 盘面 CSS 显示尺寸变化（窗口缩放、侧栏挤压等）→ --cell-px 变化 → dock 候选区
        // 必须重新按新 --cell-px 渲染，否则 canvas buffer (CONFIG.CELL_SIZE) 与 CSS 显示尺寸
        // 不一致，浏览器插值把 bevel3d 斜切边缘"洗软"，导致候选区与盘面方块视觉不一致。
        if (typeof ResizeObserver !== 'undefined' && this.canvas) {
            let lastDockCellPx = this._getDockCellPx();
            const dockReflow = () => {
                this._syncBoardOverlayMetrics();
                const next = this._getDockCellPx();
                if (next !== lastDockCellPx) {
                    lastDockCellPx = next;
                    this.refreshDockSkin();
                }
            };
            this._dockResizeObs = new ResizeObserver(dockReflow);
            this._dockResizeObs.observe(this.canvas);
        }
        if (typeof ResizeObserver !== 'undefined') {
            const board = document.getElementById('game-wrapper');
            if (board) {
                this._boardOverlayResizeObs = new ResizeObserver(() => this._syncBoardOverlayMetrics());
                this._boardOverlayResizeObs.observe(board);
            }
        }
        if (typeof window !== 'undefined') {
            window.addEventListener('resize', () => requestAnimationFrame(() => this._syncBoardOverlayMetrics()));
            requestAnimationFrame(() => this._syncBoardOverlayMetrics());
        }

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', () => {
                document.body.classList.toggle(
                    'doc-visibility-hidden',
                    document.visibilityState === 'hidden',
                );
            });
        }
    }

    _updateRunStreakHint() {
        const el = document.getElementById('strategy-run-hint');
        if (!el) return;
        const rd = GAME_RULES.runDifficulty;
        if (rd?.enabled && this.runStreak > 0) {
            el.hidden = false;
            el.textContent = t('effect.runStreakHint', { n: this.runStreak });
        } else {
            el.hidden = true;
            el.textContent = '';
        }
    }

    refreshSkinSelectOptions() {
        const skinSelect = document.getElementById('skin-select');
        if (!skinSelect) {
            return;
        }
        skinSelect.innerHTML = SKIN_LIST.map((s) => {
            const raw = tSkinName(s);
            const label = normalizeSkinPickerLabel(raw).replace(/&/g, '&amp;').replace(/</g, '&lt;');
            return `<option value="${s.id}">${label}</option>`;
        }).join('');
        let current = getActiveSkinId();
        if (!SKINS[current]) {
            setActiveSkinId(DEFAULT_SKIN_ID);
            current = DEFAULT_SKIN_ID;
            applySkinToDocument(getActiveSkin());
        }
        skinSelect.value = current;
    }

    _updateProgressionHud() {
        const st = loadProgress();
        const xp = st.totalXp;
        const { level, frac, levelStartXp, nextLevelXp } = getLevelProgress(xp);
        const title = titleForLevel(level);
        const span = Math.max(1, nextLevelXp - levelStartXp);
        const cur = xp - levelStartXp;

        const elLv = document.getElementById('prog-level');
        const elTitle = document.getElementById('prog-title');
        const elFill = document.getElementById('prog-fill');
        const elXp = document.getElementById('prog-xp-text');
        const elStreak = document.getElementById('prog-streak');
        const elTrack = document.getElementById('prog-track');
        if (elLv) elLv.textContent = `Lv.${level}`;
        if (elTitle) elTitle.textContent = title;
        if (elFill) elFill.style.width = `${Math.round(frac * 10000) / 100}%`;
        if (elXp) elXp.textContent = `${cur} / ${span} XP`;
        if (elStreak) {
            if (st.dailyStreak > 0) {
                elStreak.hidden = false;
                elStreak.textContent = t('progress.streakDays', { n: st.dailyStreak });
            } else {
                elStreak.hidden = true;
                elStreak.textContent = '';
            }
        }
        if (elTrack) {
            elTrack.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
        }
    }

    _enqueuePopupToast(createEl, holdMs = 3000) {
        // v10.18.6：结算卡（#game-over.active）显示期间不再叠任何 toast 浮层。
        // 这些信息（升级 / 解锁 / 成就）会通过卡片本身（+经验/Lv.x）或下一局首屏继续触达，
        // 避免「卡片 + toast」并存造成的"两次浮层"割裂感。
        if (typeof document !== 'undefined') {
            const gameOverEl = document.getElementById('game-over');
            if (gameOverEl?.classList.contains('active')) return;
            // endGame 进行中（即将切到 game-over），同样跳过
            if (this._endGameInFlight) return;
        }

        const gapMs = 550;
        this._popupToastQueue = this._popupToastQueue
            .catch(() => {})
            .then(async () => {
                const waitMs = Math.max(0, this._lastPopupToastAt + gapMs - Date.now());
                if (waitMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, waitMs));
                }

                const el = createEl();
                document.body.appendChild(el);
                notePopupShown(holdMs, gapMs);
                this._lastPopupToastAt = Date.now() + holdMs;

                await new Promise((resolve) => setTimeout(resolve, holdMs));
                el.remove();
            });
    }

    showProgressionToast(title, bodyHtml) {
        this._enqueuePopupToast(() => {
            const el = document.createElement('div');
            el.className = 'achievement-popup progression-toast';
            el.innerHTML = `<div class="title">${title}</div>${bodyHtml}`;
            return el;
        }, 3200);
    }

    async start(opts = {}) {
        try {
            if (opts.fromChain) {
                this.runStreak = (this.runStreak || 0) + 1;
            } else {
                this.runStreak = 0;
            }

            this.grid.clear();
            this.score = 0;
            // 重开局：清理上一局滚动基线，避免新局首次 updateUI() 出现"老分数→0"的反向动画
            this._lastDisplayedScore = null;
            this._bestScoreAtRunStart = this.bestScore || 0;
            this._newBestCelebrated = false;
            /* v1.55.10 修复跨局状态泄漏：同标签页连续多局（不刷新页面）时，
             * 这些计数器原本只递增/置 true，导致：
             *   - _newBestCelebrationCount 累计跨过 3 次上限 → 第 4 局起破 PB 静默
             *   - _nearPbEmittedThisRun 整段会话只 emit 一次
             *   - _postPbReleaseUsed 整段会话只启动一次友好出块
             *   - _tiedBestCelebratedThisRun（v1.55.10 新）整段会话只追平一次
             *   - _bestScoreSanityFlagged 上一局可疑 PB 残留 → 影响本局结算皇冠 */
            this._newBestCelebrationCount = 0;
            this._nearPbEmittedThisRun = false;
            this._postPbReleaseUsed = false;
            this._tiedBestCelebratedThisRun = false;
            this._bestScoreSanityFlagged = false;
            this.isGameOver = false;
            this._endGameInFlight = null;
            document.body.classList.remove('game-over-active');
            // v10.18.6：清理游戏结束浮层中的皇冠图标
            const _crown = document.querySelector('.new-best-crown');
            if (_crown) _crown.remove();
            // v10.18：仅复位每局重新渲染的内嵌进度；分享/海报按钮一次注入后跨局复用，不在这里清空
            const _digest = document.getElementById('over-digest');
            if (_digest) { _digest.innerHTML = ''; _digest.hidden = true; }
            // 关卡模式：同一关卡连续失败计数（用于失败提示）
            const prevLevelKey = this._currentLevelKey;
            const newLevelKey = opts.levelConfig ? JSON.stringify(opts.levelConfig?.id ?? opts.levelConfig?.objective) : null;
            if (newLevelKey && newLevelKey === prevLevelKey) {
                this._levelFailStreak = (this._levelFailStreak ?? 0) + 1;
            } else {
                this._levelFailStreak = 0;
            }
            this._currentLevelKey = newLevelKey;
            this._levelManager = opts.levelConfig ? new LevelManager(opts.levelConfig) : null;
            this._levelMode = opts.levelConfig ? 'level' : 'endless';
            const customRules = this._levelManager?.getAllowedClearRules();
            this._clearEngine = new ClearRuleEngine(customRules ?? [RowColRule]);
            this.behaviors = [];
            this.moveSequence = [];
            this._replayFrames = null;
            this.replayPlaybackLocked = false;
            this._insightLiveHistory = [];
            this.gameStats = {
                score: 0,
                clears: 0,
                maxLinesCleared: 0,
                maxCombo: 0,
                placements: 0,
                misses: 0,
                startTime: Date.now()
            };
            this._clearStreak = 0;
            this._nearMissPlaceToastCount = 0;
            this._nearMissPlaceLastAt = null;
            this._nearMissPlaceLastPlacement = null;
            /* bestScore 在此处一次性灌入作为「开局快照」：本局后续即使破 PB（this.bestScore 被
             * 抬高），_spawnContext.bestScore 也不会自动同步——这是有意的工程取舍，避免在每次
             * spawn 里重读 DB/localStorage；其下游消费方包括 difficulty.js getSpawnStressFromScore
             * 与 adaptiveSpawn.js challengeBoost / deriveScoreMilestones（均通过 ctx.bestScore 读取）。
             * 契约写在 docs/player/BEST_SCORE_CHASE_STRATEGY.md 的「开局快照」一节。 */
            this._spawnContext = {
                lastClearCount: 0, roundsSinceClear: 0, recentCategories: [], totalRounds: 0, scoreMilestone: false,
                bestScore: this.bestScore ?? 0,
                bottleneckTrough: Infinity, bottleneckSolutionTrough: Infinity, bottleneckSamples: 0
            };
            try {
                if (typeof localStorage !== 'undefined') {
                    const raw = localStorage.getItem('openblock_spawn_warmup_v1');
                    if (raw) {
                        const o = JSON.parse(raw);
                        const maxAge = 48 * 3600 * 1000;
                        if (o && typeof o.ts === 'number' && Date.now() - o.ts < maxAge) {
                            const rounds = Math.min(5, Math.max(1, Number(o.rounds) || 3));
                            const clearBoost = Math.min(2, Math.max(0, Number(o.clearBoost) || 0));
                            this._spawnContext.warmupRemaining = rounds;
                            this._spawnContext.warmupClearBoost = clearBoost;
                        }
                        localStorage.removeItem('openblock_spawn_warmup_v1');
                    }
                }
            } catch { /* ignore */ }
            resetSpawnMemory();
            resetAdaptiveMilestone();

            this.playerProfile.recordNewGame();

            /* v1.48：生命周期编排会话开始钩子 —— 检查 winback 触发（≥7 天未活跃则
             * 自动激活保护包）+ 广播 lifecycle:session_start 让商业化 / 推送等订阅。 */
            try { onSessionStart(this.playerProfile, { tracker: this.analyticsTracker || null }); } catch (e) {
                console.warn('[lifecycle] onSessionStart failed:', e?.message || e);
            }

            const baseStrategy = getStrategy(this.strategy);
            const layeredOpen = resolveAdaptiveStrategy(this.strategy, this.playerProfile, 0, this.runStreak, 0, {
                ...this._spawnContext,
                _gridRef: this.grid,
                _dockShapePool: (this.dockBlocks || [])
                    .filter((b) => b && !b.placed && Array.isArray(b.shape))
                    .map((b) => ({ data: b.shape }))
            });
            this.grid.size = layeredOpen.gridWidth || CONFIG.GRID_SIZE;
            this.renderer.setGridSize(this.grid.size);

            try {
                this.sessionId = await this.db.saveSession({
                    startTime: Date.now(),
                    score: 0,
                    strategy: this.strategy,
                    strategyConfig: baseStrategy
                });
            } catch (e) {
                console.warn('会话未写入 SQLite API（请确认已启动 server.py 且 VITE_API_BASE_URL 正确）:', e);
                this.sessionId = null;
            }

            await this.backendSync.startSession(this.strategy, baseStrategy, this.sessionId);

            try {
                const stats = await this.db.getStats();
                await this.db.updateStats({ totalGames: stats.totalGames + 1 });
            } catch (e) {
                console.warn('统计未更新:', e);
            }

            if (this._levelManager) {
                // 关卡模式：应用关卡初始盘面
                this._levelManager.applyInitialBoard(this.grid);
                this._captureInitFrame(baseStrategy);
                const spawnHints = this._levelManager.getSpawnHints();
                this.spawnBlocks({ logSpawn: false, spawnShapeIds: spawnHints?.forceIds, checkGameOver: false });
            } else {
                const maxOpeningTries = 48;
                let openingPlayable = false;
                for (let k = 0; k < maxOpeningTries; k++) {
                    clearTimeout(this._movePersistTimer);
                    this._movePersistTimer = null;
                    this.grid.initBoard(layeredOpen.fillRatio, layeredOpen.shapeWeights);
                    this._captureInitFrame(baseStrategy);
                    this.spawnBlocks({ logSpawn: false, checkGameOver: false });
                    const rem = this.dockBlocks.filter((b) => !b.placed);
                    if (this.grid.hasAnyMove(rem)) {
                        openingPlayable = true;
                        break;
                    }
                }
                if (!openingPlayable) {
                    // 用 ?? 而非 ||：避免 fillRatio=0（简单模式空盘）被误判为 falsy
                    const fillBase = layeredOpen.fillRatio ?? 0.2;
                    const softFill = fillBase === 0
                        ? 0
                        : Math.min(0.12, Math.max(0.06, fillBase * 0.45));
                    clearTimeout(this._movePersistTimer);
                    this._movePersistTimer = null;
                    this.grid.initBoard(softFill, layeredOpen.shapeWeights);
                    this._captureInitFrame(baseStrategy);
                    this.spawnBlocks({ logSpawn: false, checkGameOver: false });
                }
            }
            if (this.sessionId && this.dockBlocks.length) {
                this.logBehavior(GAME_EVENTS.SPAWN_BLOCKS, {
                    shapes: this.dockBlocks.map((b) => b.id)
                });
            }

            this.hideScreens();
            this.endReplay();
            this._updateRunStreakHint();
            this.updateUI();
            this.markDirty();
            this.checkGameOver();
        } catch (err) {
            console.error('开始游戏失败:', err);
            const banner = document.getElementById('boot-error');
            if (banner) {
                banner.hidden = false;
                banner.textContent =
                    '无法进入对局：' + (err instanceof Error ? err.message : String(err)) +
                    '。请使用 npm run dev，并另开终端运行 npm run server（SQLite 持久化）。';
            }
        }
    }

    /**
     * @param {Array<{ id: string, shape: number[][], colorIdx: number, placed: boolean }>} descriptors
     * @param {{ logSpawn?: boolean, spawnShapeIds?: string[] }} [opts]
     */
    populateDockUI(descriptors, opts = {}) {
        const dock = document.getElementById('dock');
        if (!dock) {
            return;
        }

        dock.innerHTML = '';
        this.dockBlocks = [];

        if (opts.logSpawn && opts.spawnShapeIds) {
            this.logBehavior(GAME_EVENTS.SPAWN_BLOCKS, {
                shapes: opts.spawnShapeIds
            });
        }

        for (let i = 0; i < descriptors.length; i++) {
            const d = descriptors[i];
            const block = {
                id: d.id,
                shape: d.shape,
                colorIdx: d.colorIdx,
                width: d.shape[0].length,
                height: d.shape.length,
                placed: d.placed
            };
            this.dockBlocks[i] = block;

            const div = document.createElement('div');
            div.className = 'dock-block';
            div.dataset.index = String(i);

            const cell = this._getDockCellPx();
            const slotCells = CONFIG.DOCK_PREVIEW_MAX_CELLS;
            const slotPx = slotCells * cell;
            const canvas = document.createElement('canvas');
            const dockDpr = Math.round(window.devicePixelRatio || 1) || 1;
            canvas.width  = slotPx * dockDpr;
            canvas.height = slotPx * dockDpr;
            // 不设置 inline width/height：由 CSS(.block-dock canvas) 控制显示尺寸
            // 以确保 flex 压缩时宽高同步收缩（aspect-ratio:1/1 生效），不出现变形。
            const ctx = canvas.getContext('2d');
            ctx.scale(dockDpr, dockDpr);   // 坐标系仍用逻辑像素
            const ox = (slotPx - block.width * cell) / 2;
            const oy = (slotPx - block.height * cell) / 2;
            ctx.save();
            ctx.translate(ox, oy);
            for (let y = 0; y < block.height; y++) {
                for (let x = 0; x < block.width; x++) {
                    if (block.shape[y][x]) {
                        this.renderer.drawDockBlock(ctx, x, y, getBlockColors()[block.colorIdx], cell);
                    }
                }
            }
            ctx.restore();

            if (block.placed) {
                div.style.visibility = 'hidden';
            }

            const idx = i;
            const blk = block;
            const startDrag = (e) => {
                e.preventDefault();
                if (this.rlPreviewLocked || this.replayPlaybackLocked || blk.placed || this.isAnimating || this.isGameOver) {
                    return;
                }
                const touch = e.touches ? e.touches[0] : e;
                const inputType = e.pointerType === 'touch' || e.touches ? 'touch' : 'mouse';
                if (e.pointerId != null && canvas.setPointerCapture) {
                    try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
                }
                this.startDrag(idx, touch.clientX, touch.clientY, inputType);
            };

            if (typeof window !== 'undefined' && window.PointerEvent) {
                canvas.addEventListener('pointerdown', startDrag);
            } else {
                canvas.addEventListener('mousedown', startDrag);
                canvas.addEventListener('touchstart', startDrag, { passive: false });
            }
            div.appendChild(canvas);
            dock.appendChild(div);
        }
        this._dockPlacementSolutionCache = { key: null, solutionCount: null, firstMoveFreedom: null };
        this._normalizeDockState('populate');
        requestAnimationFrame(() => syncGridDisplayPx(this.canvas));
    }

    /**
     * 自愈候选区状态，避免出现“数量缺失 / 误隐藏 / 半透明残留”：
     * - DOM 数量与 this.dockBlocks 不一致时，按当前描述符重建 dock
     * - 每个槽位强制按 placed 同步 visibility
     * - 还原 canvas opacity，避免拖拽中断后残留 0.3
     * @param {string} [reason]
     */
    _normalizeDockState(reason = '') {
        void reason;
        const dock = document.getElementById('dock');
        if (!dock || !Array.isArray(this.dockBlocks)) return;

        const expected = this.dockBlocks.length;
        if (expected <= 0) return;

        const domBlocks = Array.from(dock.querySelectorAll('.dock-block'));
        if (domBlocks.length !== expected) {
            const descriptors = this.dockBlocks.map((b) => ({
                id: b.id,
                shape: b.shape,
                colorIdx: b.colorIdx,
                placed: Boolean(b.placed)
            }));
            // 仅在结构不一致时重建；避免数量缺失在切肤/开局后持续存在
            this.populateDockUI(descriptors, { logSpawn: false });
            return;
        }

        domBlocks.forEach((div, idx) => {
            const block = this.dockBlocks[idx];
            if (!block) return;
            div.style.visibility = block.placed ? 'hidden' : 'visible';
            const cvs = div.querySelector('canvas');
            if (cvs) {
                cvs.style.opacity = '1';
            }
        });
    }

    _markDockBlockPlaced(index) {
        const block = this.dockBlocks?.[index];
        if (block) {
            block.placed = true;
        }
        const dockBlock = document.querySelector(`.dock-block[data-index="${index}"]`);
        if (dockBlock) {
            dockBlock.style.visibility = 'hidden';
        }
    }

    /** 读取候选区 / ghost 共用的逻辑像素单位。
     *
     *  关键：**优先用盘面 canvas 的实际显示尺寸**（`_boardDisplayCellSize`），
     *  退回到 `--cell-px`，最后才退到 CONFIG.CELL_SIZE。
     *
     *  历史教训：旧实现只读 `--cell-px`，而盘面 canvas 在 `width: min(100%, ...)` 约束下
     *  实际显示尺寸可能略小于 `--cell-px`，导致 dock 用更大的单位渲染、再被 CSS 缩放回去，
     *  形成「未激活时方块发糊 / 比盘面格略小」的观感。
     *  现在 dock 与 ghost 共用 `_boardDisplayCellSize`，候选块视觉与盘面 1:1 严格对齐。
     */
    _getDockCellPx() {
        if (typeof document === 'undefined') return CONFIG.CELL_SIZE;
        // 优先用盘面 canvas 的实际渲染尺寸；只有当 canvas 已经完成 layout（width > 0）才采用，
        // 否则退回 CSS 变量，避免首屏初始化阶段 getBoundingClientRect 返回 0 导致 fallback 到 38
        if (this.canvas) {
            const rect = this.canvas.getBoundingClientRect();
            if (rect && rect.width > 0) {
                return Math.round(rect.width / Math.max(1, this.grid.size));
            }
        }
        try {
            const raw = getComputedStyle(document.documentElement).getPropertyValue('--cell-px');
            const v = parseFloat(raw);
            if (Number.isFinite(v) && v > 0) return Math.round(v);
        } catch { /* ignore */ }
        return CONFIG.CELL_SIZE;
    }

    /** 用当前皮肤重绘候选区所有方块 canvas，保持与棋盘渲染风格一致 */
    refreshDockSkin() {
        if (!this.dockBlocks) return;
        const cell = this._getDockCellPx();
        const slotPx = CONFIG.DOCK_PREVIEW_MAX_CELLS * cell;
        const dockDpr = (typeof window !== 'undefined')
            ? (Math.round(window.devicePixelRatio || 1) || 1)
            : 1;
        const expectedBufPx = slotPx * dockDpr;
        this._normalizeDockState('refresh-skin');
        const blocks = document.querySelectorAll('.dock-block');
        blocks.forEach((div) => {
            const idx = Number(div.dataset.index);
            const block = this.dockBlocks[idx];
            if (!block) return;
            const cvs = div.querySelector('canvas');
            if (!cvs) return;
            // 当 --cell-px 变化（窗口尺寸调整）时，画布 buffer 也需重置以保持像素精确
            if (cvs.width !== expectedBufPx || cvs.height !== expectedBufPx) {
                cvs.width = expectedBufPx;
                cvs.height = expectedBufPx;
            }
            const ctx = cvs.getContext('2d');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.scale(dockDpr, dockDpr);
            ctx.clearRect(0, 0, slotPx, slotPx);
            const ox = (slotPx - block.width * cell) / 2;
            const oy = (slotPx - block.height * cell) / 2;
            ctx.save();
            ctx.translate(ox, oy);
            for (let y = 0; y < block.height; y++) {
                for (let x = 0; x < block.width; x++) {
                    if (block.shape[y][x]) {
                        this.renderer.drawDockBlock(ctx, x, y, getBlockColors()[block.colorIdx], cell);
                    }
                }
            }
            ctx.restore();
        });
    }

    /**
     * @param {{ logSpawn?: boolean, checkGameOver?: boolean }} [opts] logSpawn 默认 true；开局重试时 false，由 start 末尾统一记一条 spawn
     */
    spawnBlocks(opts = {}) {
        const layered = resolveAdaptiveStrategy(
            this.strategy, this.playerProfile, this.score, this.runStreak,
            this.grid.getFillRatio(), {
                ...this._spawnContext,
                _gridRef: this.grid,
                _dockShapePool: (this.dockBlocks || [])
                    .filter((b) => b && !b.placed && Array.isArray(b.shape))
                    .map((b) => ({ data: b.shape }))
            }
        );
        this._captureAdaptiveInsight(layered);

        /* v1.55.16：桥接 spawnHints.scoreMilestone → _spawnContext.scoreMilestone。
         * adaptiveSpawn 把里程碑命中信号写在 layered.spawnHints.scoreMilestone（权威源），
         * blockSpawn (web/src/bot/blockSpawn.js: line 870-872 `if (ctx.scoreMilestone && s.gapFills > 0) w *= 1.3;`)
         * 却读 ctx.scoreMilestone（即 _spawnContext），而 _commitSpawn 只在每轮末把它清为 false、
         * 从不置 true —— 历史上这条 1.3 倍加权在主路径上从未触发（dead branch）。
         * 在传 ctx 给 generateDockShapes / 模型 fallback 之前同步一次，让 hints 成为唯一权威输入：
         *   - 命中里程碑 → _spawnContext.scoreMilestone = true，本轮 blockSpawn 加权生效
         *   - _commitSpawn 末尾再清为 false（栈底重置），下一轮重新按 hints 决定 */
        this._spawnContext.scoreMilestone = layered?.spawnHints?.scoreMilestone === true;

        const mode = getSpawnMode();
        if (mode === SPAWN_MODE_MODEL_V3) {
            this._spawnBlocksWithModel(layered, opts);
            return;
        }

        this._commitSpawn(generateDockShapes(this.grid, layered, this._spawnContext), layered, opts, 'rule');
        if (opts.checkGameOver !== false) {
            this.checkGameOver();
        }
    }

    /**
     * 模型模式：异步请求推理，失败则回退启发式
     * @private
     */
    _spawnBlocksWithModel(layered, opts) {
        this._spawnPending = true;
        const requestId = ++this._spawnRequestId;

        const history = (this._spawnContext.recentModelHistory || []).slice(-3);
        while (history.length < 3) history.unshift([0, 0, 0]);
        const fallbackShapes = generateDockShapes(this.grid, layered, this._spawnContext);

        const finish = (shapes, source, meta = null) => {
            if (requestId !== this._spawnRequestId || this.isGameOver) return;
            this._lastAdaptiveInsight = this._lastAdaptiveInsight || {};
            this._lastAdaptiveInsight.spawnModelMeta = meta;
            /* v1.55.17：prevAdaptiveStress 用 raw 域 [-0.2, 1]，与 adaptiveSpawn.js
             * smoothStress(current, ctx, ...) 的 current（raw 域）保持单位一致；
             * 详见 adaptiveSpawn.js 顶部 normalizeStress 注释里的 _adaptiveStressRaw 用途。 */
            const prevStress = this._spawnContext.prevAdaptiveStress ?? layered._adaptiveStressRaw;
            const currStress = layered._adaptiveStressRaw ?? 0;
            const smoothDelta = Math.max(-0.15, Math.min(0.15, currStress - prevStress));
            this._commitSpawn(shapes, layered, opts, source);
            this._spawnContext.prevAdaptiveStress = (this._spawnContext.prevAdaptiveStress ?? 0) + smoothDelta;
            this._spawnPending = false;
            if (opts.checkGameOver !== false) {
                this.checkGameOver();
            }
        };

        const modelContext = buildSpawnModelContext(this.grid, this.playerProfile, this._lastAdaptiveInsight, {
            gameStats: this.gameStats,
            spawnContext: this._spawnContext,
            playstyle: this.playerProfile?.playstyle,
        });

        predictShapesV3(this.grid, this.playerProfile, history, this._lastAdaptiveInsight, {
            modelContext,
            playstyle: modelContext.playstyle,
            userId: this.db?.userId || null,
            topK: 8,
            enforceFeasibility: true,
        }).then((result) => {
            const modelShapes = result?.shapes || null;
            const validation = modelShapes ? validateSpawnTriplet(this.grid, modelShapes) : { ok: false, reason: 'no-model-result' };
            if (modelShapes && validation.ok) {
                const ids = shapeIdsToHistoryRow(modelShapes);
                if (!this._spawnContext.recentModelHistory) this._spawnContext.recentModelHistory = [];
                this._spawnContext.recentModelHistory.push(ids);
                if (this._spawnContext.recentModelHistory.length > 5) this._spawnContext.recentModelHistory.shift();

                finish(modelShapes, 'model-v3', { ...(result.meta || {}), fallbackReason: null });
            } else {
                const fallbackReason = validation.reason || 'model-unavailable';
                finish(
                    fallbackShapes,
                    'rule-fallback',
                    { ...(result?.meta || {}), modelVersion: result?.meta?.modelVersion || 'v3', fallbackReason }
                );
            }
        }).catch((err) => {
            finish(
                fallbackShapes,
                'rule-fallback',
                { modelVersion: 'v3', fallbackReason: err?.message || 'predict-error' }
            );
        });
    }

    /**
     * 共用出块提交逻辑
     * @private
     */
    _commitSpawn(shapes, layered, opts, source) {
        this._spawnContext.totalRounds++;
        if ((this._spawnContext.warmupRemaining ?? 0) > 0) {
            this._spawnContext.warmupRemaining--;
        }
        /* v1.55.16：栈底重置 —— spawnBlocks() 顶部已根据 layered.spawnHints.scoreMilestone
         * 把本轮的命中信号桥接到 _spawnContext.scoreMilestone（详见 spawnBlocks 注释），
         * 这里在本轮使用完后清为 false，保证下一轮重新由 hints 决定，不留隔轮残留。 */
        this._spawnContext.scoreMilestone = false;
        const logSpawn = opts.logSpawn !== false;
        this.playerProfile.recordSpawn();
        /* v1.55.17：用 raw 域写入，保持 smoothStress 步长（maxStepUp/Down）单位一致 */
        this._spawnContext.prevAdaptiveStress = layered._adaptiveStressRaw;
        /* v1.30：新一波 dock 起始，重置上一周期的瓶颈低谷统计 */
        this._resetBottleneckTrough();

        const iconBonusTarget = Math.max(0, Math.min(1, layered.spawnHints?.iconBonusTarget ?? 0));
        const bonusBias = monoNearFullLineColorWeights(this.grid, getActiveSkin())
            .map(w => w * (1 + iconBonusTarget * 2.5));
        const dockColors = pickThreeDockColors(bonusBias);

        const descriptors = [];
        for (let i = 0; i < 3; i++) {
            const shape = shapes[i];
            descriptors.push({
                id: shape.id,
                shape: shape.data,
                colorIdx: dockColors[i],
                placed: false
            });
        }

        this._lastAdaptiveInsight = this._lastAdaptiveInsight || {};
        this._lastAdaptiveInsight.spawnSource = source || 'rule';
        this._lastAdaptiveInsight.spawnDiagnostics = getLastSpawnDiagnostics();

        this._pushSpawnToSequence(descriptors);

        this.populateDockUI(descriptors, {
            logSpawn,
            spawnShapeIds: shapes.map((s) => s.id)
        });

        // 将本轮临消行数和清屏准备信号回写到 _spawnContext，供下一轮 adaptiveSpawn 使用
        // v1.13：增加 multiClearCandidates / perfectClearCandidates，用于 friendlyBoardRelief 判定
        const _diag = getLastSpawnDiagnostics();
        this._spawnContext.nearFullLines           = _diag?.layer1?.nearFullLines           ?? 0;
        this._spawnContext.pcSetup                 = _diag?.layer1?.pcSetup                 ?? 0;
        this._spawnContext.holes                   = _diag?.layer1?.holes                   ?? 0;
        this._spawnContext.multiClearCandidates    = _diag?.layer1?.multiClearCandidates    ?? 0;
        this._spawnContext.perfectClearCandidates  = _diag?.layer1?.perfectClearCandidates  ?? 0;

        /* v1.55 §4.9：postPbReleaseWindow 计数衰减 —— 本轮使用完后扣 1；
         * 归零时清除 active flag，让下次 spawn 回到正常 stress 路径。 */
        if ((this._spawnContext.postPbReleaseRemaining ?? 0) > 0) {
            this._spawnContext.postPbReleaseRemaining--;
            if (this._spawnContext.postPbReleaseRemaining <= 0) {
                this._spawnContext.postPbReleaseActive = false;
            }
        }

        this._refreshPlayerInsightPanel();
        this._spawnModelLayerRefresh?.();
    }

    /**
     * 将无头模拟器状态同步到主画布与底部待选块（用于 RL 盘面演示）
     * @param {import('./bot/simulator.js').OpenBlockSimulator} sim
     */
    syncFromSimulator(sim) {
        const j = sim.grid.toJSON();
        this.grid.size = j.size;
        this.renderer.setGridSize(this.grid.size);
        this.grid.fromJSON(j);
        // RL 演示路径：分数瞬移到模拟器值，不要走 HUD 滚动动画（避免与训练帧抢节拍）。
        // v1.49.x：updateUI() 内"DOM 文本不一致兜底分支"会负责把 #score DOM 真正写到目标值。
        this._lastDisplayedScore = sim.score;
        this.score = sim.score;
        this.isGameOver = false;

        const descriptors = sim.dock.map((b) => ({
            id: b.id,
            shape: b.shape,
            colorIdx: b.colorIdx,
            placed: b.placed
        }));
        this.populateDockUI(descriptors);

        this.previewPos = null;
        this.previewBlock = null;
        this.drag = null;
        this.dragBlock = null;
        this._resetGhostDomStyles();
        document.body.classList.remove('block-drag-active');
        this.ghostCanvas.style.display = 'none';
        this.renderer.clearParticles();
        this.renderer.setClearCells([]);
        this.isAnimating = false;
        this.updateUI();
        this.markDirty();
    }

    setRLPreviewLocked(on) {
        this.rlPreviewLocked = Boolean(on);
        document.body.classList.toggle('game-rl-preview', this.rlPreviewLocked);
    }

    /** 棋盘上每一格在屏幕上的像素边长（#game-grid 可能被 CSS 缩放） */
    _boardDisplayCellSize() {
        const rect = this.canvas.getBoundingClientRect();
        const n = Math.max(1, this.grid.size);
        const w = rect.width;
        if (!(w > 0)) {
            return CONFIG.CELL_SIZE;
        }
        return w / n;
    }

    /** 清除幽灵画布的内联宽高，避免与 bitmap 尺寸不一致 */
    _resetGhostDomStyles() {
        this.ghostCanvas.style.width = '';
        this.ghostCanvas.style.height = '';
    }

    startDrag(index, x, y, inputType = 'mouse') {
        if (this.rlPreviewLocked || this.replayPlaybackLocked) {
            return;
        }
        const block = this.dockBlocks[index];
        if (!block || block.placed) return;
        if (this._dragMoveRaf != null) {
            cancelAnimationFrame(this._dragMoveRaf);
            this._dragMoveRaf = null;
        }
        this._pendingDragPoint = null;

        // v1.46「反应」指标：记录玩家激活候选块的时刻，下一次 recordPlace/recordMiss 与之相减得到 pickToPlaceMs。
        // 重选另一块（多次 startDrag）安全：以最后一次为准。
        this.playerProfile?.recordPickup?.();

        // 上一次失败落子触发的"抖动 + 延迟隐藏 ghost"还未结束 → 立刻取消，由本次拖拽重新接管 ghost
        if (this._ghostHideTimer) {
            clearTimeout(this._ghostHideTimer);
            this._ghostHideTimer = null;
            this.ghostCanvas.classList.remove('is-rejected');
        }

        /* v1.46 触屏起手 boost：抓起候选块时给 ghost 一次性向上偏移 N 格，
         * 把"dock→盘面下缘"这段固定物理距离免掉，让玩家只需要在盘面内做最后定位。
         * 仅触屏路径生效；鼠标依靠 pointer ballistics 自身就能省力（且玩家有可视参考）。 */
        const initialBoostY = (inputType === 'touch')
            ? -1 * (Number(CONFIG.DRAG_TOUCH_BOOST_CELLS) || 0) * this._boardDisplayCellSize()
            : 0;

        this.drag = {
            index,
            inputType,
            startX: x,
            startY: y,
            hasEnteredBoard: false,
            // 增量积分式增益：每帧把"本帧位移 × (gain-1)"累加进 _extraOffset，
            // ghost 位置 = 鼠标位置 + _extraOffset。即时增益变化只影响"下一段"的累加，
            // 不会把累积位移整体重算，从而消除帧间跳跃。
            _extraOffset: { x: 0, y: initialBoostY },
        };
        this.dragBlock = block;
        this._resetGhostDomStyles();
        const ghostDpr = Math.round(window.devicePixelRatio || 1) || 1;
        // 用盘面实际显示像素绘制 ghost，避免 CSS 缩放插值导致 bevel3d 斜切边变软
        const cellDisp = this._boardDisplayCellSize();
        const ghostCell = Math.round(cellDisp) || CONFIG.CELL_SIZE;
        const ghostLogW = block.width  * ghostCell;
        const ghostLogH = block.height * ghostCell;
        const ghostCssW = block.width * cellDisp;
        const ghostCssH = block.height * cellDisp;
        this.ghostCanvas.width  = ghostLogW * ghostDpr;
        this.ghostCanvas.height = ghostLogH * ghostDpr;
        this.ghostCtx = this.ghostCanvas.getContext('2d');
        this.ghostCtx.scale(ghostDpr, ghostDpr);
        this.drag._ghostW = ghostCssW;
        this.drag._ghostH = ghostCssH;
        this.ghostCanvas.style.width  = `${ghostCssW}px`;
        this.ghostCanvas.style.height = `${ghostCssH}px`;
        this.ghostCanvas.style.display = 'block';
        document.body.classList.add('block-drag-active');
        this.updateGhostPosition(x, y);
        this.renderGhost();

        const dockCanvas = document.querySelector(`.dock-block[data-index="${index}"] canvas`);
        if (dockCanvas) dockCanvas.style.opacity = '0.3';

        this.logBehavior(GAME_EVENTS.DRAG_START, {
            blockIndex: index,
            blockId: block.id
        });
    }

    /**
     * 拖拽虚拟指针：鼠标按"速度感知"动态增益（慢速 1:1 精准、快速放大省力，
     * 类似桌面操作系统的 pointer ballistics）；触屏使用固定轻量增益并把幽灵
     * 块抬到手指上方，避免手指压住候选块中心。
     *
     * 关键不变量：ghost = 鼠标位置 + _extraOffset，_extraOffset 单调累加而不重算。
     * 即"已经被加速的部分"不会因后续慢速回调而被退回，避免 ghost 在屏幕上跳跃。
     *
     * 鼠标增益曲线（仅基于瞬时帧间速度）：
     *   speed ≤ SLOW  → DRAG_MOUSE_GAIN_MIN（1.0）  → 本帧增量按原值累加（_extraOffset 不增）
     *   speed ≥ FAST  → DRAG_MOUSE_GAIN（1.32）     → 本帧增量额外贡献 32% 到 _extraOffset
     *   中间段在二者之间线性插值
     */
    _applyDragPointerGain(x, y) {
        if (!this.drag) {
            return { x, y };
        }
        const isTouch = this.drag.inputType === 'touch';

        if (!this.drag._extraOffset) {
            this.drag._extraOffset = { x: 0, y: 0 };
        }
        const last = this.drag._lastPointer;
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

        /* v1.46：鼠标 / 触屏共用同一套"速度感知"曲线（参考桌面 OS pointer ballistics），
         * 由 dragPointerCurve.computeStepGain 实现。两端只是参数取值不同：
         *   - 鼠标：MIN=1.0 / MAX=1.32 / SLOW=0.30 / FAST=1.50（精细对位）
         *   - 触屏：MIN=1.05 / MAX=1.7 / SLOW=0.10 / FAST=0.80（指尖滑动整体偏慢、距离偏长）
         *
         * 触屏首帧无 last 时按高速处理（velocityFactor=1）——抓起后立即抬手必然是位移意图，
         * 让起手就吃到放大；鼠标首帧按低速（factor=0）避免点击瞬间 ghost 抢跑。 */
        const cfg = isTouch
            ? {
                slow: Number(CONFIG.DRAG_TOUCH_SPEED_SLOW_PX_MS) || 0.1,
                fast: Number(CONFIG.DRAG_TOUCH_SPEED_FAST_PX_MS) || 0.8,
                minGain: Number(CONFIG.DRAG_TOUCH_GAIN_MIN) || 1,
                maxGain: Number(CONFIG.DRAG_TOUCH_GAIN) || 1,
            }
            : {
                slow: Number(CONFIG.DRAG_MOUSE_SPEED_SLOW_PX_MS) || 0.3,
                fast: Number(CONFIG.DRAG_MOUSE_SPEED_FAST_PX_MS) || 1.5,
                minGain: Number(CONFIG.DRAG_MOUSE_GAIN_MIN) || 1,
                maxGain: Number(CONFIG.DRAG_MOUSE_GAIN) || 1,
            };
        let speedPxMs;
        if (last) {
            const dt = Math.max(1, now - last.t);
            speedPxMs = Math.hypot(x - last.x, y - last.y) / dt;
        } else {
            speedPxMs = isTouch ? cfg.fast : 0;
        }
        const stepGain = computeStepGain(speedPxMs, cfg);

        if (last && stepGain > 0) {
            this.drag._extraOffset.x += (x - last.x) * stepGain;
            this.drag._extraOffset.y += (y - last.y) * stepGain;
        }
        this.drag._lastPointer = { x, y, t: now };

        const maxExtra = Math.max(
            0,
            (Number(CONFIG.DRAG_GAIN_MAX_OFFSET_CELLS) || 0) * this._boardDisplayCellSize()
        );
        if (maxExtra > 0) {
            const len = Math.hypot(this.drag._extraOffset.x, this.drag._extraOffset.y);
            if (len > maxExtra) {
                const clamp = maxExtra / len;
                this.drag._extraOffset.x *= clamp;
                this.drag._extraOffset.y *= clamp;
            }
        }

        return {
            x: x + this.drag._extraOffset.x,
            y: y + this.drag._extraOffset.y - (isTouch ? this._touchDragLiftPx() : 0),
        };
    }

    _touchDragLiftPx() {
        if (!this.dragBlock) return 0;
        const cell = this._boardDisplayCellSize();
        const blockHalf = Math.max(0, this.dragBlock.height || 0) * cell / 2;
        const gap = (Number(CONFIG.DRAG_TOUCH_LIFT_GAP_CELLS) || 0) * cell;
        const maxLift = Math.max(0, (Number(CONFIG.DRAG_TOUCH_LIFT_MAX_CELLS) || 0) * cell);
        const lift = blockHalf + gap;
        return maxLift > 0 ? Math.min(lift, maxLift) : lift;
    }

    _pointInsideBoard(x, y) {
        if (!this.canvas) return false;
        const rect = this.canvas.getBoundingClientRect();
        return rect && rect.width > 0 && rect.height > 0
            && x >= rect.left
            && x <= rect.right
            && y >= rect.top
            && y <= rect.bottom;
    }

    _dragMoveAreaRect() {
        const area = document.querySelector('.play-stack') || this.canvas;
        return area?.getBoundingClientRect?.() || null;
    }

    _clampDragPointToMoveArea(x, y, ghostW, ghostH) {
        const rect = this._dragMoveAreaRect();
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            return { x, y };
        }
        const minX = rect.left + ghostW / 2;
        const maxX = rect.right - ghostW / 2;
        const minY = rect.top + ghostH / 2;
        const maxY = rect.bottom - ghostH / 2;
        return {
            x: minX <= maxX ? Math.max(minX, Math.min(maxX, x)) : rect.left + rect.width / 2,
            y: minY <= maxY ? Math.max(minY, Math.min(maxY, y)) : rect.top + rect.height / 2,
        };
    }

    updateGhostPosition(x, y) {
        const p = this._applyDragPointerGain(x, y);
        if (this.drag && this._pointInsideBoard(p.x, p.y)) {
            this.drag.hasEnteredBoard = true;
        }
        const gw = this.drag?._ghostW || parseFloat(this.ghostCanvas.style.width) || this.ghostCanvas.width;
        const gh = this.drag?._ghostH || parseFloat(this.ghostCanvas.style.height) || this.ghostCanvas.height;
        const clamped = this._clampDragPointToMoveArea(p.x, p.y, gw, gh);
        this.ghostCanvas.style.left = `${clamped.x - gw / 2}px`;
        this.ghostCanvas.style.top = `${clamped.y - gh / 2}px`;
    }

    renderGhost() {
        const block = this.dragBlock;
        if (!block) return;
        const _gDpr = Math.round(window.devicePixelRatio || 1) || 1;
        this.ghostCtx.clearRect(0, 0,
            this.ghostCanvas.width / _gDpr, this.ghostCanvas.height / _gDpr);

        // 用盘面实际显示像素绘制，与 startDrag 中 ghostCell 一致；保证 ghost 与 board 1:1 同质感
        const ghostCell = Math.round(this._boardDisplayCellSize()) || CONFIG.CELL_SIZE;
        for (let y = 0; y < block.height; y++) {
            for (let x = 0; x < block.width; x++) {
                if (block.shape[y][x]) {
                    this.renderer.drawDockBlock(this.ghostCtx, x, y, getBlockColors()[block.colorIdx], ghostCell);
                }
            }
        }
    }

    /**
     * 幽灵中心在棋盘格坐标中的位置，及是否在棋盘附近（松判，便于吸附）
     */
    ghostAimOnGrid() {
        const ghostRect = this.ghostCanvas.getBoundingClientRect();
        const rect = this.canvas.getBoundingClientRect();
        const cellDisp = this._boardDisplayCellSize();
        const relX = ghostRect.left + ghostRect.width / 2 - rect.left;
        const relY = ghostRect.top + ghostRect.height / 2 - rect.top;
        const pad = cellDisp;
        return {
            aimCx: relX / cellDisp,
            aimCy: relY / cellDisp,
            overBoard: relX >= -pad && relY >= -pad && relX <= rect.width + pad && relY <= rect.height + pad
        };
    }

    /** 由指针格坐标粗算形状左上角锚点（与原先「中心对齐」一致） */
    naiveAnchorFromAim(shape, aimCx, aimCy) {
        const gridXi = Math.floor(aimCx);
        const gridYi = Math.floor(aimCy);
        const w = shape[0].length;
        const h = shape.length;
        const offsetX = Math.floor(w / 2);
        const offsetY = Math.floor(h / 2);
        return {
            anchorX: gridXi - offsetX,
            anchorY: gridYi - offsetY
        };
    }

    _dragPointFromEvent(e) {
        if (!e) return null;
        const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
        const last = list && list.length ? list[list.length - 1] : null;
        const point = e.touches ? e.touches[0] : (last || e);
        if (!point || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) {
            return null;
        }
        return { x: point.clientX, y: point.clientY };
    }

    _scheduleDragMove(point) {
        this._pendingDragPoint = point;
        if (this._dragMoveRaf != null) return;
        this._dragMoveRaf = requestAnimationFrame(() => {
            this._dragMoveRaf = null;
            const p = this._pendingDragPoint;
            this._pendingDragPoint = null;
            if (p) this._applyDragMoveFrame(p.x, p.y);
        });
    }

    onMove(e) {
        if (this.rlPreviewLocked || this.replayPlaybackLocked || !this.drag || !this.dragBlock || this.isAnimating) {
            return;
        }
        e.preventDefault();

        const point = this._dragPointFromEvent(e);
        if (!point) return;
        this._scheduleDragMove(point);
    }

    _applyDragMoveFrame(clientX, clientY) {
        if (this.rlPreviewLocked || this.replayPlaybackLocked || !this.drag || !this.dragBlock || this.isAnimating) {
            return;
        }
        this.updateGhostPosition(clientX, clientY);
        const { aimCx, aimCy, overBoard } = this.ghostAimOnGrid();

        if (!overBoard || !this.drag.hasEnteredBoard) {
            this._cancelPreviewClearAnim();
            if (this.previewPos) {
                this.previewPos = null;
                this.previewBlock = null;
                this.markDirty();
            }
            return;
        }

        const { anchorX, anchorY } = this.naiveAnchorFromAim(
            this.dragBlock.shape,
            aimCx,
            aimCy
        );
        const best = this.grid.pickSmartHoverPlacement(
            this.dragBlock.shape,
            aimCx,
            aimCy,
            anchorX,
            anchorY,
            CONFIG.PLACE_SNAP_RADIUS,
            {
                colorIdx: this.dragBlock.colorIdx,
                previous: this.previewPos,
                clearLineBonus: CONFIG.HOVER_CLEAR_LINE_BONUS,
                clearCellBonus: CONFIG.HOVER_CLEAR_CELL_BONUS,
                clearAssistWindow: CONFIG.HOVER_CLEAR_ASSIST_WINDOW,
                stickyBonus: (Number(CONFIG.HOVER_STICKY_BONUS) || 0) * 0.35,
                stickyWindow: (Number(CONFIG.HOVER_STICKY_WINDOW) || 0) * 0.55,
            }
        );

        if (best) {
            if (!this.previewPos || this.previewPos.x !== best.x || this.previewPos.y !== best.y) {
                this.previewPos = { x: best.x, y: best.y };
                this.previewBlock = this.dragBlock;
                this.markDirty();
            }
            const oc = this.grid.previewClearOutcome(
                this.dragBlock.shape,
                best.x,
                best.y,
                this.dragBlock.colorIdx
            );
            if (oc?.cells?.length) {
                this._ensurePreviewClearAnim();
            } else {
                this._cancelPreviewClearAnim();
            }
        } else {
            this._cancelPreviewClearAnim();
            if (this.previewPos) {
                this.previewPos = null;
                this.previewBlock = null;
                this.markDirty();
            }
        }
    }

    onEnd() {
        if (this.rlPreviewLocked || this.replayPlaybackLocked || !this.drag || !this.dragBlock || this.isAnimating) {
            return;
        }

        if (this._dragMoveRaf != null) {
            cancelAnimationFrame(this._dragMoveRaf);
            this._dragMoveRaf = null;
        }
        if (this._pendingDragPoint) {
            const p = this._pendingDragPoint;
            this._pendingDragPoint = null;
            this._applyDragMoveFrame(p.x, p.y);
        }
        this._cancelPreviewClearAnim();

        const { aimCx, aimCy, overBoard } = this.ghostAimOnGrid();
        let placedPos = null;
        if (overBoard && this.drag.hasEnteredBoard) {
            const { anchorX, anchorY } = this.naiveAnchorFromAim(
                this.dragBlock.shape,
                aimCx,
                aimCy
            );
            // 释放时使用更宽的 snap 半径（PLACE_RELEASE_SNAP_RADIUS），让"差一点点"的释放也能放成功，
            // 避免玩家盘面区域内大幅快速拖拽时偶尔的"鸽子掉地"——只要用户表达了"我要放在这附近"，就尽量挽救。
            const releaseRadius = Number(CONFIG.PLACE_RELEASE_SNAP_RADIUS) || CONFIG.PLACE_SNAP_RADIUS;
            placedPos = this.grid.pickSmartHoverPlacement(
                this.dragBlock.shape,
                aimCx,
                aimCy,
                anchorX,
                anchorY,
                releaseRadius,
                {
                    colorIdx: this.dragBlock.colorIdx,
                    previous: this.previewPos,
                    clearLineBonus: CONFIG.HOVER_CLEAR_LINE_BONUS,
                    clearCellBonus: CONFIG.HOVER_CLEAR_CELL_BONUS,
                    clearAssistWindow: CONFIG.HOVER_CLEAR_ASSIST_WINDOW,
                    stickyBonus: 0,
                    stickyWindow: 0,
                }
            );
        }

        document.body.classList.remove('block-drag-active');
        const _eDpr = Math.round(window.devicePixelRatio || 1) || 1;

        const dockCanvas = document.querySelector(`.dock-block[data-index="${this.drag.index}"] canvas`);
        if (dockCanvas) dockCanvas.style.opacity = '1';

        if (placedPos) {
            // 成功：立即收掉 ghost，让消行/震屏特效成为视觉焦点
            this._resetGhostDomStyles();
            this.ghostCanvas.style.display = 'none';
            this.ghostCtx.clearRect(0, 0,
                this.ghostCanvas.width / _eDpr, this.ghostCanvas.height / _eDpr);
            // 「咬合」反馈：极轻量震屏 + place 短促音 + 8ms 触感（audioFx 已注册但此前从未被调用，
            // 接入后能让"我已经放下了"这件事在听感/触觉上得到确认，区分于纯视觉的方块出现）
            try { window.__audioFx?.play?.('place'); } catch { /* ignore */ }
            try { window.__audioFx?.vibrate?.([8]); } catch { /* ignore */ }
            this.renderer?.setShake?.(2.5, 90);
        } else {
            // 失败：ghost 在原位"抖动+淡出"，并配 tick 音 + 较强触感作为负反馈
            // —— 让玩家立刻明白"刚刚那个位置不行"，而不是疑惑"游戏出 bug 了"
            const ghost = this.ghostCanvas;
            const ctx = this.ghostCtx;
            if (this._ghostHideTimer) {
                clearTimeout(this._ghostHideTimer);
                this._ghostHideTimer = null;
            }
            ghost.classList.add('is-rejected');
            this._ghostHideTimer = setTimeout(() => {
                this._ghostHideTimer = null;
                if (this.drag) return;   // 240ms 内用户已开始下一次拖拽 → 由新 startDrag 接管
                ghost.classList.remove('is-rejected');
                ghost.style.display = 'none';
                ghost.style.width = '';
                ghost.style.height = '';
                ctx.clearRect(0, 0, ghost.width / _eDpr, ghost.height / _eDpr);
            }, 240);
            try { window.__audioFx?.play?.('tick', { force: true }); } catch { /* ignore */ }
            try { window.__audioFx?.vibrate?.([20, 30, 20]); } catch { /* ignore */ }
        }

        if (placedPos) {
            const fillBefore = this.grid.getFillRatio();
            const validsBefore = this.grid.countValidPlacements(this.dragBlock.shape);
            this.grid.place(this.dragBlock.shape, this.dragBlock.colorIdx, placedPos.x, placedPos.y);
            this.gameStats.placements++;
            this._markDockBlockPlaced(this.drag.index);

            this.logBehavior(GAME_EVENTS.PLACE, {
                blockIndex: this.drag.index,
                blockId: this.dragBlock.id,
                x: placedPos.x,
                y: placedPos.y
            });
            this.clearInsightHints?.();

            // Bonus 检测必须在 apply/checkLines 之前，此时格子尚未被置 null
            const _bonusLinesSnap = detectBonusLines(this.grid, getActiveSkin());

            // 消除检测：关卡模式使用注入的 ClearRuleEngine，普通模式走 grid.checkLines()
            const result = this._clearEngine
                ? this._clearEngine.apply(this.grid)
                : this.grid.checkLines();

            // 将 snap 到的 bonus 信息合并进 result（只在真正有消除时生效）
            result.bonusLines = result.count > 0 ? _bonusLinesSnap : [];
            result.perfectClear = result.count > 0 && this.grid.getFillRatio() === 0;
            this.playerProfile.recordPlace(result.count > 0, result.count, this.grid.getFillRatio());
            this._updateBottleneckTrough();
            this._refreshPlayerInsightPanel();
            this._spawnModelLayerRefresh?.();

            this._pushPlaceToSequence(this.drag.index, placedPos.x, placedPos.y, result);

            // 关卡统计回调
            this._levelManager?.recordPlacement();
            if (result.count > 0) {
                this._levelManager?.recordClear(result.count);
                // 小目标：上报消行和 combo
                try { window.__miniGoals?.onClear(result.count, this.gameStats?.maxCombo ?? 0); } catch { /* ignore */ }
            }

            if (result.count > 0) {
                this._spawnContext.lastClearCount = result.count;
                this._spawnContext.roundsSinceClear = 0;
                this.playClearEffect(result);
            } else {
                this._spawnContext.lastClearCount = 0;
                this._clearStreak = 0;
                this.logBehavior(GAME_EVENTS.NO_CLEAR, {
                    blockIndex: this.drag.index,
                    blockId: this.dragBlock.id
                });

                /* v1.50：几何近失 toast — 仅救场/提振士气，严格控频（见 nearMissPlaceFeedback.js）。
                 * 文案说明「整行/整列差 1 格满、再落一块即可消行」，避免抽象「差一格」；
                 * 需连续未消行/焦虑心流等门槛，顺风光头与高频盘面不打扰。
                 * v1.51.1：传入 placedCells + nearFullLines，确保 toast 与玩家本次落子绑定，
                 *         避免"瞬时触发→延时显示"在玩家继续操作后与盘面脱节。 */
                const nearFullSnap = this.grid.getMaxLineFillLines(0.875);
                const placedCells = [];
                {
                    const shape = this.dragBlock.shape;
                    for (let _sy = 0; _sy < shape.length; _sy++) {
                        for (let _sx = 0; _sx < shape[_sy].length; _sx++) {
                            if (shape[_sy][_sx]) {
                                placedCells.push({ x: placedPos.x + _sx, y: placedPos.y + _sy });
                            }
                        }
                    }
                }
                const nearMissDecision = shouldShowNearMissPlaceFeedback({
                    maxLineFill: nearFullSnap.maxFill,
                    pendingNoMovesEnd: !!this._pendingNoMovesEnd,
                    frustrationLevel: this.playerProfile.frustrationLevel,
                    flowState: this._lastAdaptiveInsight?.flowState ?? this.playerProfile.flowState,
                    momentum: this._lastAdaptiveInsight?.momentum ?? this.playerProfile.momentum,
                    clearRate: this.playerProfile.metrics?.clearRate ?? 0,
                    toastCount: this._nearMissPlaceToastCount,
                    lastPlacementIndex: this._nearMissPlaceLastPlacement,
                    currentPlacementIndex: this.gameStats.placements,
                    lastShownAt: this._nearMissPlaceLastAt,
                    placedCells,
                    nearFullLines: nearFullSnap.lines,
                });
                if (nearMissDecision.show) {
                    this._triggerNearMissFeedback(nearMissDecision.line);
                }

                this._checkToughPlacement(this.dragBlock, fillBefore, validsBefore);

                if (this.dockBlocks.every(b => b.placed)) {
                    if (this._spawnContext.lastClearCount === 0) {
                        this._spawnContext.roundsSinceClear++;
                    }
                    this._levelManager?.recordRound();
                    this.spawnBlocks();
                }

                this.updateUI();
                // 关卡目标检测
                if (this._levelManager) {
                    const objResult = this._levelManager.checkObjective(this);
                    if (objResult.achieved) {
                        const levelResult = this._levelManager.getResult(this);
                        this.endGame({ mode: 'level', levelResult });
                        return;
                    }
                }
                this.checkGameOver();
            }
        } else {
            this.gameStats.misses++;
            this.playerProfile.recordMiss();
            this._refreshPlayerInsightPanel();
            this.logBehavior(GAME_EVENTS.PLACE_FAILED, {
                blockIndex: this.drag.index,
                blockId: this.dragBlock.id
            });
        }

        this.drag = null;
        this.dragBlock = null;
        this.previewPos = null;
        this.previewBlock = null;
        this.markDirty();
    }

    playClearEffect(result) {
        const self = this;
        const dockIndex = this.drag.index;

        this.isAnimating = true;
        this._clearStreak++;

        const bonusLines = result.bonusLines || [];
        const bonusCount = bonusLines.length;
        const perfectClear = this.grid.getFillRatio() === 0;
        result.perfectClear = perfectClear;
        const { clearScore, iconBonusScore } = computeClearScore(this.strategy, result);

        this.score += clearScore;
        /* v1.49：字段更名 milestoneHit → scoreMilestoneHit，把跨过的具体分数档传给下游。
         * v1.55.11（用户反馈："已达最佳 N% 不触发特效"）：取消局内的"百分比里程碑"toast 渲染，
         * 只保留 _lastAdaptiveInsight.scoreMilestoneHit 数据流（DFV 调试面板仍可见，分析侧仍有事件
         * 记录），消化"局内激励语莫名其妙"+"局内特效只出现一次"反馈后，最终只保留"破 PB 烟花"
         * 这一种激励信号；50% / 75% / 90% 的"接近感"由 HUD 的 best.gap.* 文案承担。
         * 仍把 flag 复位以避免下游订阅看到 stale=true。 */
        if (this._lastAdaptiveInsight?.scoreMilestoneHit === true) {
            this._lastAdaptiveInsight.scoreMilestoneHit = false;
        }
        this.gameStats.score = this.score;
        this.gameStats.clears += result.count;
        this.gameStats.maxLinesCleared = Math.max(this.gameStats.maxLinesCleared, result.count);
        this.gameStats.maxCombo = Math.max(this.gameStats.maxCombo, result.count);

        this.logBehavior(GAME_EVENTS.CLEAR, {
            blockIndex: this.drag.index,
            blockId: this.dragBlock.id,
            linesCleared: result.count,
            scoreGain: clearScore
        });

        const madeNewBest = this._maybeCelebrateNewBest();

        const isCombo = result.count >= 3;
        const isDouble = result.count === 2;
        const baseDuration = perfectClear ? 1050 : isCombo ? 780 : isDouble ? 620 : 500;
        const bonusHoldMs = bonusEffectHoldMs(bonusCount);
        const animDuration = bonusCount > 0 ? Math.max(baseDuration, bonusHoldMs) : baseDuration;
        const bonusShakeMs = bonusCount > 0 ? baseDuration : 0;

        this.renderer.addParticles(result.cells, {
            lines: result.count,
            perfectClear
        });
        this.renderer.setClearCells(result.cells, { mode: bonusCount > 0 ? 'bonus' : 'normal' });

        // 同 icon/同色 行/列：全屏光晕 + 更密粒子 + 更长展示
        if (bonusCount > 0) {
            const palette = getBlockColors();
            this.renderer.triggerBonusMatchFlash(bonusCount);
            const iconLineSpecs = bonusLines
                .filter(bl => bl.icon)
                .map(bl => ({ bonusLine: bl, icon: bl.icon }));
            if (iconLineSpecs.length) {
                this.renderer.beginBonusIconGush(iconLineSpecs, animDuration);
            }
            const colorLineSpecs = bonusLines.map(bl => ({
                bonusLine: bl,
                cssColor: palette[bl.colorIdx] || '#FFD700'
            }));
            this.renderer.beginBonusColorGush(colorLineSpecs, animDuration);
            for (const bl of bonusLines) {
                const cssColor = palette[bl.colorIdx] || '#FFD700';
                this.renderer.addBonusLineBurst(bl, cssColor, 64);
            }
        }

        if (perfectClear) {
            this.renderer.triggerPerfectFlash();
            this.renderer.setShake(24, bonusCount > 0 ? Math.max(bonusShakeMs, 1150) : 1150);
        } else if (isCombo) {
            this.renderer.triggerComboFlash(result.count);
            this.renderer.setShake(bonusCount > 0 ? 15 : 11, bonusCount > 0 ? bonusShakeMs : 520);
        } else if (isDouble) {
            const waveRows = [...new Set(result.cells.map(c => c.y))];
            this.renderer.triggerDoubleWave(waveRows);
            this.renderer.setShake(bonusCount > 0 ? 13 : 8, bonusCount > 0 ? bonusShakeMs : 400);
        } else {
            this.renderer.setShake(bonusCount > 0 ? 11 : 5, bonusCount > 0 ? bonusShakeMs : 280);
        }

        let effectType = '';
        if (perfectClear) effectType = 'perfect';
        else if (isCombo) effectType = 'combo';
        else if (isDouble) effectType = 'multi';

        this.showFloatScore(
            clearScore,
            madeNewBest ? 'new-best' : effectType,
            result.count,
            bonusCount > 0 ? iconBonusScore : 0,
            bonusCount > 0 ? animDuration : 0
        );

        if (this._clearStreak >= 3) {
            this._showStreakBadge(this._clearStreak);
        }

        const animStart = Date.now();
        let clearFlashEnded = false;

        const animate = () => {
            const elapsed = Date.now() - animStart;
            self.renderer.updateShake();
            self.renderer.updateParticles();
            self.renderer.updateIconParticles();
            if (!clearFlashEnded && elapsed >= baseDuration) {
                clearFlashEnded = true;
                self.renderer.setClearCells([]);
            }
            self.markDirty();

            if (elapsed < animDuration) {
                requestAnimationFrame(animate);
            } else {
                self.isAnimating = false;
                self.renderer.clearParticles();
                self.renderer.setClearCells([]);
                self.markDirty();

                self._markDockBlockPlaced(dockIndex);

                if (self.dockBlocks.every(b => b.placed)) {
                    self._levelManager?.recordRound();
                    self.spawnBlocks();
                }

                self.updateUI();

                // 关卡目标检测（消除后）
                if (self._levelManager) {
                    const objResult = self._levelManager.checkObjective(self);
                    if (objResult.achieved) {
                        const levelResult = self._levelManager.getResult(self);
                        self.endGame({ mode: 'level', levelResult });
                        return;
                    }
                }

                self.checkGameOver();
            }
        };

        animate();
    }

    /**
     * 把一个 fixed 元素锚定到「盘面（#game-grid）几何中心」上。
     *
     * 替代旧的 `el.style.left = '50%'; el.style.top = '14%'; transform: translateX(-50%)`，
     * 后者基于「视口」居中——在窄屏 / 侧栏 / 不同纵横比下飘字会偏到盘面之外（见 v1.45 截图反馈：
     * 「+20」出现在盘面左上方，而非盘面正中）。统一改为基于盘面 rect 计算精确像素坐标。
     *
     * @param {HTMLElement} el                目标元素（应当 position: fixed）
     * @param {object}      [opts]
     * @param {number}      [opts.dyRatio=0]  垂直偏移 = boardHeight × dyRatio
     *                                        - 0     ：盘面正中（默认；满足"在盘面居中位置显示"诉求）
     *                                        - -0.18 ：盘面顶部 1/5 区
     *                                        - +0.20 ：盘面下部
     */
    _anchorOnBoard(el, { dyRatio = 0 } = {}) {
        const rect = this.canvas?.getBoundingClientRect?.();
        if (!rect || rect.width === 0 || rect.height === 0) {
            // 兜底：保留旧的 viewport 居中行为，避免特效完全消失
            el.style.left = '50%';
            el.style.top = '25%';
            el.style.transform = 'translate(-50%, -50%)';
            return;
        }
        const cx = rect.left + rect.width / 2;
        const cy = rect.top  + rect.height / 2 + rect.height * dyRatio;
        el.style.left = `${cx}px`;
        el.style.top  = `${cy}px`;
        el.style.transform = 'translate(-50%, -50%)';
    }

    _showStreakBadge(streak) {
        const el = document.createElement('div');
        el.className = 'streak-badge';
        const fires = streak >= 5 ? '🔥🔥🔥' : streak >= 4 ? '🔥🔥' : '🔥';
        el.textContent = t('effect.streakCombo', { fires, n: streak });
        document.body.appendChild(el);
        this._anchorOnBoard(el);
        setTimeout(() => el.remove(), 1600);
    }

    /**
     * 判断本次非消行放置是否值得点赞（复杂盘面 + 妙手，且非走进死局）：
     * - 复杂：放置前占用率较高，且该形状全棋盘合法落点很少（≤3）
     * - 妙局：合法落点 ≤2；或在极高占用下仍 ≤3 格可选（窄位抉择）
     * - 死局排除：若 dock 里还有别的未落块，本手后它们必须仍能在当前盘面上至少走一步；
     *   若本手是本轮最后一块则视为即将刷新三枚，不按「无步可走」判死（由 spawn 承接）
     */
    _checkToughPlacement(block, fillBefore, validsBefore) {
        const blockCells = block.shape.flat().filter(Boolean).length;
        if (blockCells < 3) return;
        if (fillBefore < 0.55 || validsBefore > 3) return;
        const brilliant = validsBefore <= 2 || (fillBefore >= 0.68 && validsBefore <= 3);
        if (!brilliant) return;

        const others = this.dockBlocks.filter((b) => !b.placed && b !== block);
        if (others.length > 0 && !this.grid.hasAnyMove(others)) return;

        this._showThumbsUp();
    }

    _showThumbsUp() {
        const wrapper = document.getElementById('game-wrapper');
        if (!wrapper) return;
        const el = document.createElement('div');
        el.className = 'thumbs-up-toast';
        el.textContent = '👍';
        wrapper.appendChild(el);
        setTimeout(() => el.remove(), 1500);
    }

    checkGameOver() {
        if (this.isGameOver) return;
        if (this._spawnPending) return;
        if (document.querySelector('.no-moves-overlay')) return;
        const remaining = this.dockBlocks.filter(b => !b.placed);
        if (remaining.length === 0) return;
        if (!this.grid.hasAnyMove(remaining)) {
            this.showNoMovesWarning();
        }
    }

    /**
     * v10.18：取消独立的「没可用空间」浮层，直接进入内嵌结算卡片，避免「先弹中间提示再弹结算」的双弹窗割裂感。
     * `revive.js` 仍然以装饰模式拦截本方法（在玩家未用完复活时优先弹复活面板），无影响。
     */
    showNoMovesWarning() {
        clearTimeout(this._noMovesTimer);
        this._noMovesTimer = null;
        document.querySelectorAll('.no-moves-overlay').forEach((el) => el.remove());
        if (this.isGameOver || this._endGameInFlight) return;

        /* v1.49：game over 前的鼓励语
         * - 旧版：判定条件 `nearMissCount > 0 || roundsSinceClear >= 3`，但 nearMissCount 字段从未在
         *   _lastAdaptiveInsight 中被写入（死字段引用），实际只剩 roundsSinceClear>=3 起作用，
         *   语义跟"差一点"无关——是濒死安抚，而非几何近失。
         * - 新版：无条件触发"棋盘填满，再来一局！"安抚语；同时设置 _pendingNoMovesEnd 互斥锁，
         *   抑制同一帧内 _triggerNearMissFeedback 的重复 toast；v1.50.2 起 toast hold 2400ms 略短于
         *   endGame 延迟 2600ms，确保先看完安抚语再进 game over 弹窗。
         * - i18n：effect.noMovesEnd（"棋盘填满，再来一局！" / "Board's full — try again!"）
         */
        this._pendingNoMovesEnd = true;
        const tipEl = document.createElement('div');
        tipEl.className = 'float-score float-no-moves';
        tipEl.innerHTML = `<span class="float-label">${t('effect.noMovesEnd')}</span><span class="float-pts">💪</span>`;
        document.body.appendChild(tipEl);
        this._anchorOnBoard(tipEl);
        /* v1.50.2：toast hold 从 1100ms 提到 2400ms，与 .float-no-moves 2.4s 动画对齐 */
        setTimeout(() => tipEl.remove(), 2400);

        this._noMovesTimer = setTimeout(() => {
            this._noMovesTimer = null;
            this._pendingNoMovesEnd = false;
            void this.endGame({ noMovesLoss: true });
        }, 2600); /* v1.50.2：从 1200ms 拉到 2600ms，确保安抚语完整显示后再进 game over 弹窗 */
    }

    /**
     * @param {object} [opts]
     * @param {'endless'|'level'|'level-fail'} [opts.mode='endless'] 结算模式
     * @param {object} [opts.levelResult]  关卡结算数据（stars、objective 等）
     */
    async endGame(opts = {}) {
        if (this._endGameInFlight) {
            return this._endGameInFlight;
        }
        /* v10.33：无步可走结算 → 下一局前几轮出块热身（局间闭环），写入 localStorage 由 start() 消费 */
        if (opts.noMovesLoss && typeof localStorage !== 'undefined') {
            try {
                const rsc = this._spawnContext?.roundsSinceClear ?? 0;
                const fill = typeof this.grid?.getFillRatio === 'function' ? this.grid.getFillRatio() : 0;
                let rounds = 3;
                let clearBoost = 1;
                if (rsc >= 4 || fill >= 0.72) {
                    rounds = 4;
                    clearBoost = 2;
                } else if (rsc >= 2 || fill >= 0.52) {
                    rounds = 3;
                    clearBoost = 1;
                } else {
                    rounds = 2;
                    clearBoost = 0;
                }
                localStorage.setItem('openblock_spawn_warmup_v1', JSON.stringify({
                    rounds,
                    clearBoost,
                    ts: Date.now()
                }));
            } catch { /* ignore */ }
        }
        this.isGameOver = true;
        try {
            window.__audioFx?.play?.('gameOver');
            window.__audioFx?.vibrate?.([35, 55, 25]);
        } catch { /* ignore */ }
        // 内嵌结算（v10.18）：保留棋盘可见，给 body 加 .game-over-active 让 CSS 做柔化处理
        document.body.classList.add('game-over-active');
        // 写入结算模式，供结算界面读取
        const gameOverEl = document.getElementById('game-over');
        const mode = opts.mode ?? 'endless';
        if (gameOverEl) gameOverEl.dataset.gameMode = mode;
        // 更新模式标签文字
        const labelEl = document.getElementById('over-label');
        if (labelEl) {
            labelEl.textContent = mode === 'level' ? t('game.over.levelClear') :
                mode === 'level-fail' ? t('game.over.levelFail') : t('game.over.endless');
        }
        // 关卡额外信息
        const levelInfoEl = document.getElementById('over-level-info');
        if (levelInfoEl) {
            if (opts.levelResult) {
                levelInfoEl.hidden = false;
                const starsEl = document.getElementById('over-stars');
                if (starsEl && opts.levelResult.stars !== undefined) {
                    starsEl.textContent = '⭐'.repeat(Math.max(0, Math.min(3, opts.levelResult.stars)));
                }
                const objEl = document.getElementById('over-objective');
                if (objEl && opts.levelResult.objective) {
                    objEl.textContent = opts.levelResult.objective;
                }
            } else {
                levelInfoEl.hidden = true;
            }
        }

        this._endGameInFlight = (async () => {
            /** @type {ReturnType<typeof applyGameEndProgression> | null} */
            let progressionResult = null;
            try {
                this.logBehavior(GAME_EVENTS.GAME_OVER, {
                    finalScore: this.score,
                    totalClears: this.gameStats.clears,
                    maxCombo: this.gameStats.maxCombo,
                    duration: Date.now() - this.gameStats.startTime
                });

                this.playerProfile.recordSessionEnd({
                    score: this.score,
                    ...this.gameStats,
                    mode: this._levelMode ?? 'endless',
                });

                /* v1.48：生命周期编排会话结束钩子 —— 写入 churnPredictor 让流失风险
                 * 评估有数据；消耗一轮 winback 保护；命中 dashboard 干预条件时
                 * 通过 MonetizationBus 广播 lifecycle:intervention，让推送 / 弹窗订阅。
                 *
                 * 关键修复：此前 churnPredictor.recordSessionMetrics 在生产代码中
                 * 无任何调用方，导致整个流失风险评估退化为常量；本钩子是该模块
                 * 第一个真实数据写入点。 */
                try {
                    onSessionEnd(this.playerProfile, {
                        score: this.score,
                        durationMs: Date.now() - this.gameStats.startTime,
                        clears: this.gameStats.clears,
                        placements: this.gameStats.placements,
                        misses: this.gameStats.misses,
                        gameOver: !!opts.noMovesLoss,
                    }, { tracker: this.analyticsTracker || null });
                } catch (e) {
                    console.warn('[lifecycle] onSessionEnd failed:', e?.message || e);
                }

                await this.saveSession();

                const persistedBestBase = this._bestScoreAtRunStart ?? this.bestScore;
                if (this.score > persistedBestBase) {
                    /* v1.55 §4.10 异常分守卫：单局分数 > previousBest × SANITY_MULTIPLIER 时
                     * 视为可疑（自动外挂 / 时钟偏移 / 数据回放注入等）。
                     *
                     * 决策：仅在本机 bestScore 仍指向当前会话内可见的进度（不持久化到后端，
                     * 不参与排行榜），同时把可疑事件 emit 到 MonetizationBus，让运营
                     * 看板能在 24h 内人工核对。新玩家（previousBest < 50）不触发守卫，
                     * 因为缺乏锚点，少量真实首杀很容易超过 5×。
                     *
                     * SANITY_MULTIPLIER=5：高于"普通玩家在原 PB 基础上单局提升 80% 极值"的
                     * 经验上界，可压制 99.9% 真实玩家误伤；阈值由 GAME_RULES.bestScoreSanity
                     * 接管以便运营动态调整。 */
                    const sanityCfg = GAME_RULES.bestScoreSanity ?? {};
                    const SANITY_MULTIPLIER = Number(sanityCfg.multiplier) || 5;
                    const SANITY_MIN_BASE = Number(sanityCfg.minBase) || 50;
                    const suspicious = persistedBestBase >= SANITY_MIN_BASE
                        && this.score > persistedBestBase * SANITY_MULTIPLIER;
                    if (suspicious) {
                        /* 软隔离：仅更新内存 bestScore（让本局 UI 正常展示），
                         * 不写后端持久化、不参与排行榜。同时 emit lifecycle:suspicious_pb 让
                         * 风控订阅方接力。 */
                        this.bestScore = this.score;
                        this._bestScoreSanityFlagged = true;
                        try {
                            const event = {
                                previousBest: persistedBestBase,
                                claimedBest: this.score,
                                multiplier: this.score / persistedBestBase,
                                strategy: this.strategy,
                                sessionPlacements: this.gameStats?.placements ?? 0,
                                durationMs: Date.now() - this.gameStats.startTime,
                                ts: Date.now(),
                            };
                            if (this._monetizationBus && typeof this._monetizationBus.emit === 'function') {
                                this._monetizationBus.emit('lifecycle:suspicious_pb', event);
                            } else {
                                emitMonetizationEvent('lifecycle:suspicious_pb', event);
                            }
                        } catch { /* ignore */ }
                        // eslint-disable-next-line no-console
                        console.warn('[bestScoreSanity] suspicious PB blocked from persistence:',
                            { previousBest: persistedBestBase, claimedBest: this.score });
                    } else {
                        this.bestScore = this.score;
                        await this.db.saveScore(this.score, this.strategy);
                        /* v1.55.10 修复 PB 风险 5（双源同步）：破全账号 PB 时同步更新
                         * legacy `openblock_best_score`，保证：
                         *   1) socialLeaderboard.getMyBestScore 的兜底分支可用；
                         *   2) server.py 的 CORE_KEYS 跨设备同步包含该 key（避免 hydrate
                         *      给新设备一个 0）。
                         * 注意：分桶 PB（openblock_best_by_strategy_v1）由下方 submitScoreToBucket
                         * 单独维护；这里只补 legacy key，不创造新的真理源。 */
                        try {
                            if (typeof localStorage !== 'undefined') {
                                const cur = parseInt(localStorage.getItem('openblock_best_score') || '0', 10) || 0;
                                if (this.score > cur) {
                                    localStorage.setItem('openblock_best_score', String(this.score));
                                }
                            }
                        } catch { /* ignore privacy mode */ }
                    }
                }

                /* v1.55 §4.4 + §4.7：无论是否破全账号 PB，本局得分都尝试更新
                 *   1) 当前难度档的分桶 PB（bestByStrategy）
                 *   2) 本周 / 本月的周期 PB（weeklyBest / monthlyBest）
                 * 这两条与全账号 PB 解耦：玩家可以在 hard 模式刷新 hard PB 而
                 * 不影响 normal PB；同时即便没破账号 PB 也可能破"周冠"。
                 * 写入失败（localStorage 不可用）被 bestScoreBuckets 模块吞掉。 */
                try {
                    submitScoreToBucket(this.strategy, this.score);
                    const periodResult = submitPeriodBest(this.score);
                    if (periodResult.weeklyUpdated || periodResult.monthlyUpdated) {
                        try {
                            const event = {
                                weeklyUpdated: periodResult.weeklyUpdated,
                                monthlyUpdated: periodResult.monthlyUpdated,
                                score: this.score,
                                strategy: this.strategy,
                                ts: Date.now(),
                            };
                            if (this._monetizationBus && typeof this._monetizationBus.emit === 'function') {
                                this._monetizationBus.emit('lifecycle:period_best', event);
                            } else {
                                emitMonetizationEvent('lifecycle:period_best', event);
                            }
                        } catch { /* ignore */ }
                    }
                } catch (e) {
                    console.warn('[bestScoreBuckets] submit failed:', e?.message || e);
                }

                const stats = await this.db.getStats();
                await this.db.updateStats({
                    totalScore: stats.totalScore + this.score,
                    totalClears: stats.totalClears + this.gameStats.clears,
                    maxCombo: Math.max(stats.maxCombo || 0, this.gameStats.maxCombo),
                    totalPlacements: (stats.totalPlacements || 0) + this.gameStats.placements,
                    totalMisses: (stats.totalMisses || 0) + this.gameStats.misses
                });

                const durationMs = Date.now() - this.gameStats.startTime;
                const unlocked = await this.db.checkAndUnlockAchievements(this.gameStats, { durationMs });
                unlocked.forEach((a) => this.showAchievement(a));
            } catch (e) {
                console.error('endGame', e);
            }

            try {
                progressionResult = applyGameEndProgression({
                    score: this.score,
                    gameStats: this.gameStats,
                    strategy: this.strategy,
                    runStreak: this.runStreak ?? 0
                });
                for (const aid of progressionResult.achievementIds) {
                    const meta = ACHIEVEMENTS_BY_ID[aid];
                    if (!meta) continue;
                    try {
                        if (await this.db.unlockAchievement(aid)) {
                            this.showAchievement(meta);
                        }
                    } catch (ae) {
                        console.warn('unlock level achievement', ae);
                    }
                }
                if (progressionResult.leveledUp && progressionResult.achievementIds.length === 0) {
                    this.showProgressionToast(
                        '等级提升',
                        `<div>Lv.${progressionResult.oldLevel} → Lv.${progressionResult.newLevel} · ${titleForLevel(progressionResult.newLevel)}</div>`
                    );
                }
                for (const sid of progressionResult.newlyUnlockedSkins) {
                    const skin = SKINS[sid];
                    if (skin) {
                        this.showProgressionToast(
                            '主题解锁',
                            `<div>${skin.name} · 在标题下「主题」中切换</div>`
                        );
                    }
                }
                this.refreshSkinSelectOptions();
            } catch (pe) {
                console.error('progression', pe);
            } finally {
                const overScore = document.getElementById('over-score');
                if (overScore) {
                    const persistedBestBase = this._bestScoreAtRunStart ?? this.bestScore;
                    /* v1.55.10 修复：可疑 PB（_bestScoreSanityFlagged=true）已被软隔离，
                     * 没有写入后端持久化；结算页若仍显示皇冠会形成"UI 像新纪录但下次启动该分不存在"
                     * 的不一致。这里增加 sanity flag 守卫，可疑 PB 不显示皇冠。 */
                    const isNewBest = this.score > persistedBestBase && !this._bestScoreSanityFlagged;
                    if (isNewBest) {
                        const crown = document.createElement('span');
                        crown.className = 'new-best-crown';
                        crown.textContent = t('game.over.crown');
                        overScore.parentNode.insertBefore(crown, overScore);
                    }
                    initScoreAnimator();
                    if (this.score > 0) {
                        animateScore(this.score);
                    } else {
                        setScoreImmediate(this.score);
                    }
                }
                const overXp = document.getElementById('over-xp');
                if (overXp) {
                    if (progressionResult) {
                        overXp.hidden = false;
                        let xpText = t('game.xpGained', { n: progressionResult.xpGained });
                        if (progressionResult.leveledUp) {
                            xpText += ' · ' + t('game.xpLevelUp', { level: progressionResult.newLevel });
                        }
                        overXp.textContent = xpText;
                    } else {
                        overXp.hidden = true;
                        overXp.textContent = '';
                    }
                }
                this._updateProgressionHud();
                // 关卡失败多次：触发差异化提示
                this._updateLevelFailHint(mode);
                // 小目标系统：局末上报（由 main.js 通过 window.__miniGoals 代理）
                try {
                    window.__miniGoals?.onGameEnd({
                        score: this.score,
                        clears: this.gameStats?.clears ?? 0,
                        placements: this.gameStats?.placements ?? 0,
                        maxCombo: this.gameStats?.maxCombo ?? 0,
                        rounds: this.gameStats?.rounds ?? 0,
                    });
                } catch { /* ignore */ }
                this.showScreen('game-over');
            }
        })();

        try {
            await this._endGameInFlight;
        } finally {
            this._endGameInFlight = null;
        }
    }

    async saveSession() {
        if (!this.sessionId) {
            return;
        }

        clearTimeout(this._movePersistTimer);
        this._movePersistTimer = null;

        if (countPlaceStepsInFrames(this.moveSequence) < MIN_PERSIST_PLACE_STEPS) {
            try {
                await this.db.deleteReplaySessions([this.sessionId]);
            } catch (e) {
                console.warn('删除过短对局记录失败:', e);
            }
            this.playerProfile.save();
            return;
        }

        const durationMs = Math.max(0, Date.now() - this.gameStats.startTime);
        const replayAnalysis = buildReplayAnalysis(this.moveSequence, {
            score: this.score,
            gameStats: this.gameStats,
            durationMs
        });
        await this._flushMoveSequence(replayAnalysis);

        /* v1.50.x：lifecycle 子对象注入。流程上紧跟 onSessionEnd（已 invalidate
         * cache + updateMaturity），所以这里读到的 snapshot 就是"本局结束后"的
         * 最新 stage / band。failure-soft：localStorage 不可用 / 数据初始化中
         * → 走 null，不阻塞 saveSession 主流程。
         *
         * 字段对齐：与 server.py PATCH /api/session 中 _extract_lifecycle_payload
         * 解析的字段一一对应 ⟹ 后端无需做容错。 */
        const lifecyclePayload = (() => {
            try {
                const cached = getCachedLifecycleSnapshot(this.playerProfile);
                if (cached?.stage?.code) {
                    return {
                        stage: cached.stage.code,
                        band: cached.maturity?.band || 'M0',
                        skillScore: Number.isFinite(cached.maturity?.skillScore)
                            ? cached.maturity.skillScore
                            : (cached.maturity?.score ?? null),
                        confidence: cached.stage.confidence ?? null,
                        isWinbackCandidate: !!cached.isWinbackCandidate || cached.stage.code === 'S4',
                        ts: Date.now(),
                    };
                }
                const direct = getLifecycleMaturitySnapshot({
                    daysSinceInstall: this.playerProfile?.daysSinceInstall ?? 0,
                    totalSessions: this.playerProfile?.totalSessions ?? 0,
                    daysSinceLastActive: this.playerProfile?.daysSinceLastActive ?? 0,
                });
                return direct?.stageCode ? {
                    stage: direct.stageCode,
                    band: direct.band || 'M0',
                    skillScore: direct.skillScore ?? direct.score ?? null,
                    confidence: direct.confidence ?? null,
                    isWinbackCandidate: !!direct.isWinbackCandidate,
                    ts: Date.now(),
                } : null;
            } catch (e) {
                console.warn('[lifecycle] saveSession snapshot failed:', e?.message || e);
                return null;
            }
        })();

        await this.db.updateSession(this.sessionId, {
            endTime: Date.now(),
            score: this.score,
            status: 'completed',
            gameStats: {
                ...this.gameStats,
                replayAnalysis: {
                    rating: replayAnalysis.rating,
                    tags: replayAnalysis.tags,
                    summary: replayAnalysis.summary
                },
                ...(lifecyclePayload ? { lifecycle: lifecyclePayload } : {}),
            }
        });

        if (this.behaviors.length > 0) {
            const tail = [...this.behaviors];
            this.behaviors = [];
            await this.db.saveBehaviors(tail);
            await this.backendSync.flushBatch(tail);
            await this.db.saveReplay(this.sessionId, tail);
        }

        const durationSec = Math.max(1, Math.floor(durationMs / 1000));
        await this.backendSync.endSession(this.score, durationSec);

        this.playerProfile.save();
    }

    _captureInitFrame(strategyConfig) {
        if (!this.sessionId) {
            this.moveSequence = [];
            return;
        }
        const ps = buildPlayerStateSnapshot(this.playerProfile, {
            score: this.score,
            boardFill: this.grid.getFillRatio(),
            runStreak: this.runStreak,
            strategyId: this.strategy,
            phase: 'init',
            adaptiveInsight: null,
            spawnGeo: this._spawnGeoForSnapshot()
        });
        this.moveSequence = [buildInitFrame(this.strategy, this.grid, strategyConfig.scoring, ps)];
        this._schedulePersistMoves();
    }

    _pushSpawnToSequence(descriptors) {
        if (!this.sessionId) {
            return;
        }
        const ps = buildPlayerStateSnapshot(this.playerProfile, {
            score: this.score,
            boardFill: this.grid.getFillRatio(),
            runStreak: this.runStreak,
            strategyId: this.strategy,
            phase: 'spawn',
            adaptiveInsight: this._lastAdaptiveInsight,
            spawnGeo: this._spawnGeoForSnapshot()
        });
        this.moveSequence.push(buildSpawnFrame(descriptors, ps));
        this._schedulePersistMoves();
    }

    /**
     * @param {number} dockIndex
     * @param {number} gx
     * @param {number} gy
     * @param {{ count: number }} lineResult `grid.checkLines()` 返回值
     */
    _pushPlaceToSequence(dockIndex, gx, gy, lineResult) {
        if (!this.sessionId) {
            return;
        }
        const c = lineResult?.count ?? 0;
        const { clearScore: lineScore } = computeClearScore(this.strategy, lineResult);
        const scoreAfterStep = this.score + lineScore;

        const ps = buildPlayerStateSnapshot(this.playerProfile, {
            score: scoreAfterStep,
            boardFill: this.grid.getFillRatio(),
            runStreak: this.runStreak,
            strategyId: this.strategy,
            phase: 'place',
            adaptiveInsight: this._lastAdaptiveInsight,
            spawnGeo: this._spawnGeoForSnapshot()
        });
        ps.linesCleared = c;

        this.moveSequence.push(buildPlaceFrame(dockIndex, gx, gy, ps));
        this._schedulePersistMoves();
    }

    _schedulePersistMoves() {
        if (!this.sessionId) {
            return;
        }
        if (countPlaceStepsInFrames(this.moveSequence) < MIN_PERSIST_PLACE_STEPS) {
            return;
        }
        clearTimeout(this._movePersistTimer);
        this._movePersistTimer = setTimeout(() => {
            this._movePersistTimer = null;
            if (countPlaceStepsInFrames(this.moveSequence) < MIN_PERSIST_PLACE_STEPS) {
                return;
            }
            void this.db.upsertMoveSequence(this.sessionId, this.moveSequence).catch((err) => {
                console.warn('upsertMoveSequence:', err);
            });
        }, 500);
    }

    async _flushMoveSequence(analysis = null) {
        if (!this.sessionId || this.moveSequence.length === 0) {
            return;
        }
        if (countPlaceStepsInFrames(this.moveSequence) < MIN_PERSIST_PLACE_STEPS) {
            return;
        }
        clearTimeout(this._movePersistTimer);
        this._movePersistTimer = null;
        await this.db.upsertMoveSequence(this.sessionId, this.moveSequence, analysis);
    }

    /**
     * @param {object[]} frames 深拷贝后的序列
     */
    /** @returns {boolean} 是否已进入回放（首帧合法且已应用） */
    beginReplayFromFrames(frames) {
        if (!Array.isArray(frames) || frames.length === 0) {
            console.warn('beginReplayFromFrames: 需要非空 frames 数组');
            return false;
        }
        const first = frames[0];
        if (!first || first.t !== 'init' || !first.grid) {
            console.warn('beginReplayFromFrames: 首帧须为含 grid 的 init');
            return false;
        }
        this._replayFrames = _cloneReplayFrames(frames);
        this.replayPlaybackLocked = true;
        this.isGameOver = false;
        this.isAnimating = false;
        document.body.classList.add('game-replay-mode');
        this.applyReplayFrameIndex(0);
        return true;
    }

    endReplay() {
        this._replayFrames = null;
        this.replayPlaybackLocked = false;
        document.body.classList.remove('game-replay-mode');
    }

    /**
     * @param {number} lastInclusive 应用到 frames[0..lastInclusive]
     */
    applyReplayFrameIndex(lastInclusive) {
        if (!this._replayFrames?.length) {
            return;
        }
        const st = replayStateAt(this._replayFrames, lastInclusive);
        if (!st) {
            return;
        }
        this.strategy = st.strategy;
        this.grid.size = st.gridJSON.size;
        this.renderer.setGridSize(this.grid.size);
        this.grid.fromJSON(st.gridJSON);
        // 回放跳帧：分数瞬移到该帧值，不要触发 HUD 滚动 / 飘字（拖时间轴会狂闪）。
        // v1.49.x：把 _lastDisplayedScore 与 score 同时设为目标值压制滚动；
        // updateUI() 内"DOM 文本不一致兜底分支"会负责把 #score DOM 真正写到目标值。
        this._lastDisplayedScore = st.score;
        this.score = st.score;
        this.previewPos = null;
        this.previewBlock = null;
        this.drag = null;
        this.dragBlock = null;
        this._resetGhostDomStyles();
        document.body.classList.remove('block-drag-active');
        this.ghostCanvas.style.display = 'none';
        this.renderer.clearParticles();
        this.renderer.setClearCells([]);
        this.populateDockUI(st.dockDescriptors, { logSpawn: false });
        this.updateUI();
        this.markDirty();
    }

    /** @returns {number} 最后一帧下标（含） */
    getReplayMaxIndex() {
        return Math.max(0, (this._replayFrames?.length ?? 1) - 1);
    }

    logBehavior(eventType, data) {
        const behavior = {
            sessionId: this.sessionId,
            eventType,
            data,
            timestamp: Date.now(),
            gameState: {
                score: this.score,
                clears: this.gameStats.clears
            }
        };
        this.behaviors.push(behavior);

        if (this.behaviors.length >= 10) {
            const batch = this.behaviors.splice(0, 10);
            void this.db.saveBehaviors(batch);
            void this.backendSync.flushBatch(batch);
        }
    }

    showAchievement(achievement) {
        this._enqueuePopupToast(() => {
            const el = document.createElement('div');
            el.className = 'achievement-popup';
            el.innerHTML = `<div class="title">${t('effect.achievementUnlocked')}</div>${achievement.icon} ${achievement.name}<div style="font-size:12px;color:#666">${achievement.desc}</div>`;
            return el;
        }, 3000);
    }

    /**
     * 严格大于本局开始时的历史最佳即触发"新纪录"庆祝。
     *
     * v1.55.11（用户反馈："刷新最佳单局内只触发一次"）：
     *   - 单局只放一次完整烟花 + new-best-popup（CELEBRATIONS_PER_RUN_CAP=1）；
     *   - 之后即使分数继续上涨刷新 PB，只静默更新 `this.bestScore` 而不再展示庆祝 UI；
     *   - 旧 v1.55 §4.6 的"二度 / 三度纪录"轻量庆祝逻辑保留代码骨架（`isFirst` 分支
     *     仍存在），但实际不会被触发——保留以便未来按运营策略灰度恢复多次庆祝。
     *
     * 同时（§4.12）：每次触发都通过 MonetizationBus emit
     * `lifecycle:new_personal_best`，让商业化 / 留存模块能在 PB 黄金窗口接力。
     */
    _maybeCelebrateNewBest() {
        /* v1.55.11：3 → 1。单局只一次破 PB 庆祝；超出阈值后只静默更新 bestScore。 */
        const CELEBRATIONS_PER_RUN_CAP = 1;
        const runStartBest = Number(this._bestScoreAtRunStart);
        const previousBestRaw = Number.isFinite(runStartBest) && runStartBest > 0
            ? runStartBest
            : (Number.isFinite(this.bestScore) ? this.bestScore : 0);
        /* 二度 / 三度判定：当前 bestScore（已被首次烟花更新过）作为新比较基线。
         * 若 _newBestCelebrated=true，则比较对象是 this.bestScore 而非 runStartBest，
         * 否则同一局内连续 score 增长会反复触发"首次"庆祝。 */
        const compareBase = this._newBestCelebrated
            ? Number(this.bestScore)
            : previousBestRaw;
        const EPSILON = 1e-9;
        if (!(Number.isFinite(this.score) && this.score > compareBase + EPSILON)) return false;

        const celebrations = (this._newBestCelebrationCount ?? 0);
        if (celebrations >= CELEBRATIONS_PER_RUN_CAP) {
            /* 超出上限：只静默更新 bestScore，不再展示庆祝 UI。 */
            this.bestScore = this.score;
            return false;
        }

        const delta = this.score - compareBase;
        const isFirst = !this._newBestCelebrated;
        this._newBestCelebrated = true;
        this._newBestCelebrationCount = celebrations + 1;
        this.bestScore = this.score;
        this.updateUI();

        /* v1.55 §4.13：hard 模式破 PB 时烟花强度 +30%（更耀眼的金色烟火）；
         * easy 模式保持原值；normal 默认。
         * v1.55.11：CELEBRATIONS_PER_RUN_CAP=1 后 isFirst 实际上恒为 true（保留旧分支
         * 以便未来灰度恢复多次庆祝时无需重写）。 */
        const isHard = this.strategy === 'hard';
        const hardScale = isHard ? 1.3 : 1.0;
        if (isFirst) {
            this.renderer.triggerBonusMatchFlash(isHard ? 4 : 3);
            this.renderer.triggerPerfectFlash();
            this.renderer.setShake(Math.round(18 * hardScale), Math.round(900 * hardScale));
        } else {
            /* v1.55.11 后不可达；保留以备灰度恢复。 */
            this.renderer.triggerBonusMatchFlash(isHard ? 2 : 1);
            this.renderer.setShake(Math.round(9 * hardScale), Math.round(450 * hardScale));
        }

        const el = document.createElement('div');
        el.className = 'new-best-popup' + (isFirst ? '' : ' new-best-popup--second');
        const titleText = isFirst
            ? t('effect.newRecord')
            : t('effect.newRecord.second', { delta });
        el.innerHTML = `<div class="new-best-title">${titleText}</div><div class="new-best-score">${this.score}</div>`;
        document.body.appendChild(el);
        const holdMs = isFirst ? 2300 : 1500;
        notePopupShown(holdMs, isFirst ? 900 : 450);
        setTimeout(() => el.remove(), holdMs);

        /* v1.55 §4.12：emit lifecycle:new_personal_best 事件，让商业化 /
         * 留存订阅方在 PB 高情绪窗口接力（推送 / 分享卡 / 任务完成等）。 */
        try {
            this._emitPersonalBestEvent({
                previousBest: compareBase,
                newBest: this.score,
                delta,
                celebrationIndex: this._newBestCelebrationCount,
                isFirst,
            });
        } catch { /* event bus 失败不应阻塞庆祝 UI */ }
        /* v1.55 §4.9：启动 postPbReleaseWindow，让接下来若干 spawn 内 stress×0.7 +
         * clearGuarantee+1，给玩家"破纪录后短暂的'我赢了'情绪"留出释放空间。 */
        this._startPostPbReleaseWindow();
        return true;
    }

    /**
     * v1.55 §4.12：向 MonetizationBus emit lifecycle:new_personal_best。
     * 订阅方契约见 docs/architecture/MONETIZATION_EVENT_BUS_CONTRACT.md。
     * 测试时若注入 this._monetizationBus（带 emit() 的对象），优先发到该 bus，
     * 不调用全局 MonetizationBus（避免污染其他订阅方）。
     * @param {{previousBest:number,newBest:number,delta:number,celebrationIndex:number,isFirst:boolean}} payload
     */
    _emitPersonalBestEvent(payload) {
        const event = {
            previousBest: Number(payload.previousBest) || 0,
            newBest: Number(payload.newBest) || 0,
            delta: Number(payload.delta) || 0,
            celebrationIndex: Math.max(1, Math.floor(payload.celebrationIndex)) || 1,
            isFirst: !!payload.isFirst,
            strategy: this.strategy,
            sessionPlacements: this.gameStats?.placements ?? 0,
            ts: Date.now(),
        };
        /* 测试注入的 bus 优先；生产环境走全局 MonetizationBus.emit。 */
        if (this._monetizationBus && typeof this._monetizationBus.emit === 'function') {
            this._monetizationBus.emit('lifecycle:new_personal_best', event);
        } else {
            try { emitMonetizationEvent('lifecycle:new_personal_best', event); }
            catch { /* bus 故障不应影响 UI 庆祝 */ }
        }
    }

    /**
     * v1.55 §4.12：D3 决战段（pct ≥ 0.95）首次达到时 emit 一次
     * lifecycle:near_personal_best；本局每个 D3 进入只触发一次（exit + 重入不再 emit），
     * 用于商业化推荐 / 冲分推送 / 分享卡草稿。
     */
    _maybeEmitNearPersonalBest() {
        if (this._nearPbEmittedThisRun) return;
        const best = Number(this._bestScoreAtRunStart ?? this.bestScore);
        if (!Number.isFinite(best) || best <= 0) return;
        const pct = this.score / best;
        if (!(pct >= 0.95)) return;
        this._nearPbEmittedThisRun = true;
        const event = {
            bestScore: best,
            score: Number(this.score) || 0,
            pct,
            strategy: this.strategy,
            sessionPlacements: this.gameStats?.placements ?? 0,
            ts: Date.now(),
        };
        if (this._monetizationBus && typeof this._monetizationBus.emit === 'function') {
            this._monetizationBus.emit('lifecycle:near_personal_best', event);
        } else {
            try { emitMonetizationEvent('lifecycle:near_personal_best', event); }
            catch { /* ignore */ }
        }
    }

    /**
     * v1.55.11（用户反馈："追平不触发特效"）：本方法保留为 no-op，更新 UI 不会再调用它。
     *
     * 历史：v1.55.10 曾在 score === bestScore 时触发轻量绿色 "🏁 追平最佳！" toast，
     * 但产品评审认为"追平 / 接近"信号会稀释"破 PB"这一唯一激励事件，与"只保留刷新最佳
     * 烟花作为唯一情绪锚点"的最新策划取舍冲突，因此撤销。
     *
     * 保留方法本体（始终 return false 且不触发任何副作用）作为：
     *   1. 单元测试可独立验证"追平不触发"契约（防止回归）；
     *   2. 未来若按运营策略灰度恢复"追平"事件，只需删除本方法首行的 early return 即可。
     */
    _maybeCelebrateTiePersonalBest() {
        return false;
    }

    /**
     * v1.55 §4.9：postPbReleaseWindow —— 破纪录后释放窗口。
     *
     * 触发后接下来 POST_PB_RELEASE_SPAWNS（默认 3）次 spawn 内：
     *   - 出块 stress 按 POST_PB_RELEASE_STRESS_FACTOR=0.7 衰减
     *   - clearGuarantee 至少为 1（友好出块）
     *   - challengeBoost 完全禁用（由 _spawnContext.postPbReleaseActive 透传到 adaptiveSpawn）
     *
     * 同一局内即使再次触发（连续刷新 PB），释放窗口只生效一次（cooldown）：
     * 已激活过的本局不会重置；若已结束（_remaining=0）也不再启动。
     */
    _startPostPbReleaseWindow() {
        if (this._postPbReleaseUsed) return;
        const ctx = this._spawnContext;
        if (!ctx) return;
        const POST_PB_RELEASE_SPAWNS = 3;
        ctx.postPbReleaseRemaining = POST_PB_RELEASE_SPAWNS;
        ctx.postPbReleaseActive = true;
        this._postPbReleaseUsed = true;
    }

    /**
     * v1.50：几何近失救场鼓励（调用方须先通过 shouldShowNearMissPlaceFeedback）。
     * i18n：effect.nearMissPlace — 整行/整列差 1 格满，再落一块即可消行；单局控频见 game_rules.nearMissPlaceFeedback。
     *
     * v1.51.1：toast 显示期间持续校验几何条件，若目标 line 已被消除/被破坏则提前淡出，
     *          避免"toast 显示中玩家把那行消掉/盘面被洗"导致文案与画面不一致。
     *
     * @param {{type:'row'|'col',index:number,fill:number}|null} [targetLine]
     *        触发瞬间命中的 row/col；为 null 时仅做 maxLineFill 全局校验（向后兼容）。
     */
    _triggerNearMissFeedback(targetLine = null) {
        this._nearMissPlaceToastCount = (this._nearMissPlaceToastCount ?? 0) + 1;
        this._nearMissPlaceLastAt = Date.now();
        this._nearMissPlaceLastPlacement = this.gameStats.placements ?? 0;

        const nearMissEl = document.createElement('div');
        nearMissEl.className = 'float-score float-near-miss';
        nearMissEl.innerHTML = `<span class="float-label">${t('effect.nearMissPlace')}</span><span class="float-pts">🎯</span>`;
        document.body.appendChild(nearMissEl);
        this._anchorOnBoard(nearMissEl);

        /* v1.50.2：从 1500ms 提到 2800ms，与 .float-near-miss 动画时长对齐，确保玩家看清。 */
        const HOLD_MS = 2800;
        const FADE_MS = 220;
        const POLL_MS = 100;
        const minLineFill = (getNearMissPlaceFeedbackCfg().minLineFill) ?? 0.875;
        const startedAt = Date.now();
        let removed = false;
        let pollTimer = null;

        const cleanup = () => {
            if (removed) return;
            removed = true;
            if (pollTimer != null) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            nearMissEl.classList.add('float-near-miss--fading');
            setTimeout(() => { try { nearMissEl.remove(); } catch { /* ignore */ } }, FADE_MS);
        };
        const removeImmediate = () => {
            if (removed) return;
            removed = true;
            if (pollTimer != null) {
                clearInterval(pollTimer);
                pollTimer = null;
            }
            try { nearMissEl.remove(); } catch { /* ignore */ }
        };

        pollTimer = setInterval(() => {
            if (removed) return;
            if (Date.now() - startedAt >= HOLD_MS) {
                cleanup();
                return;
            }

            /* 几何破坏校验：
             *   1) 全局 maxLineFill 跌破阈值 → 整盘已无近失线，文案完全失效；
             *   2) targetLine 提供时进一步校验该具体行/列是否仍 ≥ 阈值（被消行/被旋洗都算破坏）。 */
            let snap;
            try { snap = this.grid.getMaxLineFillLines(minLineFill); } catch { snap = null; }
            if (!snap || snap.maxFill < minLineFill) {
                cleanup();
                return;
            }
            if (targetLine && Array.isArray(snap.lines)) {
                const stillHot = snap.lines.some(
                    (l) => l.type === targetLine.type && l.index === targetLine.index,
                );
                if (!stillHot) {
                    cleanup();
                    return;
                }
            }
        }, POLL_MS);

        /* 兜底：HOLD_MS 后无论 poll 是否触发都强制清理（含淡出阶段） */
        setTimeout(removeImmediate, HOLD_MS + FADE_MS + 50);
    }

    /**
     * @param {number} [bonusUiHoldMs=0]  有同色 bonus 时传入与粒子阶段相同的 hold（ms），用于顶栏分数与粒子同步消失
     */
    showFloatScore(score, type, linesCleared = 0, iconBonus = 0, bonusUiHoldMs = 0) {
        const el = document.createElement('div');
        const isNewBest = type === 'new-best';
        const isCombo = type === 'combo';
        const isPerfect = type === 'perfect';
        /* v1.49：'milestone' 视为 'scoreMilestone' 的别名（向后兼容），
         * 新代码统一传 'scoreMilestone'，区别于跨局的"成熟度里程碑"。 */
        const isScoreMilestone = type === 'scoreMilestone' || type === 'milestone';
        const hasIconBonus = iconBonus > 0;

        if (hasIconBonus) {
            el.className = 'float-score float-icon-bonus';
            if (bonusUiHoldMs > 0) {
                el.style.setProperty('--icon-bonus-pop-ms', `${Math.round(bonusUiHoldMs)}ms`);
            }
            const label = isPerfect
                ? t('effect.perfectClear')
                : isCombo
                    ? t('effect.multiClear', { n: linesCleared })
                    : t('effect.iconBonus');
            const mult = isPerfect ? ` ×${PERFECT_CLEAR_MULT}` : '';
            el.innerHTML =
                `<span class="float-bonus-art" role="status">` +
                `<span class="float-label">${label}${mult}</span>` +
                `<span class="float-bonus-score-row">` +
                `<span class="float-bonus-num">${score}</span>` +
                `<span class="float-bonus-mult-wrap">(${ICON_BONUS_LINE_MULT}x)</span>` +
                `</span>` +
                `</span>`;
            document.body.appendChild(el);
            this._anchorOnBoard(el);
            const floatHoldMs = bonusUiHoldMs > 0 ? Math.round(bonusUiHoldMs) : 4000;
            setTimeout(() => el.remove(), floatHoldMs);
            return;
        }

        const cls = isNewBest ? ' float-new-best' : isPerfect ? ' float-perfect' : isCombo ? ' float-combo' : type === 'multi' ? ' float-multi' : '';
        el.className = 'float-score' + cls;

        if (isNewBest) {
            el.innerHTML = `<span class="float-label">${t('effect.newRecord')}</span><span class="float-pts">+${score}</span>`;
        } else if (isPerfect) {
            el.innerHTML = `<span class="float-label">${t('effect.perfectClear')} ×${PERFECT_CLEAR_MULT}</span><span class="float-pts">+${score}</span>`;
        } else if (isCombo && linesCleared >= 3) {
            el.innerHTML = `<span class="float-label">${t('effect.multiClear', { n: linesCleared })}</span><span class="float-pts">+${score}</span>`;
        } else if (type === 'multi') {
            el.innerHTML = `<span class="float-label">${t('effect.doubleClear')}</span><span class="float-pts">+${score}</span>`;
        } else if (isScoreMilestone) {
            /* v1.55.11（用户反馈："已达最佳 N% 不触发特效"）：分数里程碑 toast 已撤销渲染。
             * 调用方 playClearEffect（line 2037 一带）已不再以 'scoreMilestone' / 'milestone' type
             * 调用 showFloatScore，但保留本分支作为防御性 no-op（外部入口或旧脚本仍可能传入这两个
             * type，做到不抛错且不显示）。 */
            return;
        } else {
            el.textContent = '+' + score;
        }

        document.body.appendChild(el);
        this._anchorOnBoard(el);
        /* v1.55.11：isScoreMilestone 分支已在上方提前 return，此处的 2800ms 留位不再生效；
         * 保留旧三档时长选择以维持其他 type 的行为不变。 */
        const floatHoldMs = isNewBest ? 2300 : isPerfect ? 2200 : isCombo ? 1450 : 600;
        setTimeout(() => el.remove(), floatHoldMs);
    }

    hideScreens() {
        document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
        const overXp = document.getElementById('over-xp');
        if (overXp) {
            overXp.hidden = true;
            overXp.textContent = '';
        }
        this.updateShellVisibility();
    }

    showScreen(id) {
        document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
        const el = document.getElementById(id);
        if (el) {
            this._syncBoardOverlayMetrics();
            el.classList.add('active');
        }
        // 离开 game-over 内嵌结算时清理棋盘柔化滤镜
        if (id !== 'game-over') {
            document.body.classList.remove('game-over-active');
        }
        this.updateShellVisibility();
    }

    updateUI() {
        /* v1.46 实时分数滚动 / v1.49.x 回放瞬移兜底：决策表统一委托给 syncHudScoreElement
         * （决策矩阵 init / animate / sync / noop / no-element 见 scoreAnimator.js）。
         * `_lastDisplayedScore` 是"上次写入 DOM 的值"；瞬移路径（applyReplayFrameIndex /
         * syncFromSimulator）通过把它和 score 同时设为目标值来压制滚动/飘字，
         * 由 syncHudScoreElement 的 'sync' 分支负责把 DOM textContent 真正写到目标值。 */
        const scoreEl = document.getElementById('score');
        if (scoreEl) {
            syncHudScoreElement(scoreEl, this.score, this._lastDisplayedScore);
            this._lastDisplayedScore = this.score;
        }
        document.getElementById('best').textContent = this.bestScore;
        /* v1.55 §4.13：在 best 数字下方加难度标签（仅当玩家在 easy/hard 时显示，
         * normal 默认不显示以减少视觉噪音）。Hard 时显示金色烟火，配合 §4.4 PB 分桶。 */
        const badgeEl = document.getElementById('best-strategy-badge');
        if (badgeEl) {
            const s = this.strategy;
            if (s === 'hard') {
                badgeEl.textContent = '🔥 HARD';
                badgeEl.hidden = false;
                badgeEl.className = 'best-strategy-badge best-strategy-badge--hard';
            } else if (s === 'easy') {
                badgeEl.textContent = '🌱 EASY';
                badgeEl.hidden = false;
                badgeEl.className = 'best-strategy-badge best-strategy-badge--easy';
            } else {
                badgeEl.hidden = true;
            }
        }
        // 最高分差距提示（无尽模式 + 尚未超越时显示）
        const gapEl = document.getElementById('best-gap');
        if (gapEl) {
            const gap = this.bestScore - this.score;
            /* v1.55（BEST_SCORE_CHASE_STRATEGY §4.5）warmup gate：
             * 本局前 3 个出块属于 warmup 段（与 adaptiveSpawn.deriveSessionArc 同口径），
             * 此时显示"差 N 分"会与 runStreakHint / 新手 toast 拥堵；
             * 显式 hide 等本局正式进入 peak 后再展示。 */
            const inWarmup = (this.gameStats?.placements ?? 0) < 3;
            if (this._levelMode === 'endless' && gap > 0 && this.bestScore > 0 && !inWarmup) {
                const ratio = gap / this.bestScore;
                /* v1.49：原 ratio<=0 分支永不可达（外层已强制 gap>0），best.gap.victory 文案因此从未显示。
                 * 改为 ratio<=0.02（距 best 不到 2%）触发，对应"即将刷新最佳"。
                 *
                 * v1.55（BEST_SCORE_CHASE_STRATEGY §4.3）远征陪伴：
                 * 旧版 ratio>0.15 仍走 best.gap.far，但触发面较窄；新版 ratio>0.50（pct<0.50，D0 远征段）
                 * 启用陪伴文案，并按本局轮数 round-robin 三选一（far.* 文案池）避免单调；
                 * 0.15<ratio≤0.50 段仍用 neutral（数字距离感）。 */
                let msg;
                if (ratio <= 0.02) {
                    msg = t('best.gap.victory');
                } else if (ratio <= 0.05) {
                    msg = t('best.gap.close');
                } else if (ratio <= 0.50) {
                    msg = t('best.gap.neutral', { gap });
                } else {
                    const variants = ['best.gap.far', 'best.gap.far.alt1', 'best.gap.far.alt2'];
                    const idx = ((this.gameStats?.placements ?? 0) >>> 0) % variants.length;
                    msg = t(variants[idx], { best: this.bestScore });
                }
                gapEl.textContent = msg;
                gapEl.hidden = false;
                gapEl.className = 'best-gap' + (ratio <= 0.05 ? ' best-gap--close' : '');
            } else {
                gapEl.hidden = true;
            }
        }
        this._updateProgressionHud();
        // 通用入口：任何渠道导致的 score 增长（消行、daily 加成、奖励兑现等）只要
        // 跨过本局开始时的历史最佳即触发新纪录庆祝。_newBestCelebrated flag 保证一局
        // 只触发一次；庆祝路径内部会再调 updateUI()，但因 flag 已置位会被自然短路。
        this._maybeCelebrateNewBest();
        /* v1.55.11（用户反馈："追平不触发特效"）：撤销 _maybeCelebrateTiePersonalBest 调用。
         * 方法本体仍保留为 no-op（return false），以便单元测试 / 灰度回归时可独立验证；
         * 真实游戏链路完全不再触发追平 toast。 */
        /* v1.55 §4.12：D3 段（pct ≥ 0.95）首次达到时 emit lifecycle:near_personal_best
         * 让推送 / 弹窗 / 分享卡草稿在"决战段"接力。
         * 与 _maybeCelebrateNewBest 互补：前者负责"破纪录瞬间"，后者负责"接近瞬间"。 */
        this._maybeEmitNearPersonalBest();
    }

    /** 关卡失败多次后，在结算界面展示有针对性的提示 */
    _updateLevelFailHint(mode) {
        const hintEl = document.getElementById('level-fail-hint');
        const textEl = document.getElementById('level-fail-hint-text');
        if (!hintEl || !textEl) return;

        const streak = this._levelFailStreak ?? 0;
        if (mode !== 'level-fail' || streak < 1) {
            hintEl.hidden = true;
            return;
        }

        const hintIdx = Math.min(streak, 4);
        const hint = t(`effect.levelFailHint.${hintIdx}`);
        textEl.textContent = streak >= 2
            ? t('effect.levelFailHintWithStreak', { n: streak + 1, hint })
            : hint;
        hintEl.hidden = false;
    }

    markDirty() {
        this._renderDirty = true;
        if (this._renderRaf != null) {
            return;
        }
        if (typeof requestAnimationFrame !== 'function') {
            this._renderDirty = false;
            this.render();
            return;
        }
        this._renderRaf = requestAnimationFrame(() => {
            this._renderRaf = null;
            if (!this._renderDirty) {
                return;
            }
            this._renderDirty = false;
            this.render();
        });
    }

    /**
     * 取消待合并的 rAF 并立即绘制（init、需与 DOM 同步的少数路径）。
     */
    flushRender() {
        if (this._renderRaf != null && typeof cancelAnimationFrame === 'function') {
            cancelAnimationFrame(this._renderRaf);
        }
        this._renderRaf = null;
        this._renderDirty = false;
        this.render();
    }

    _shapeKey(shape) {
        if (!shape || !Array.isArray(shape)) {
            return '';
        }
        return shape.map((row) => (Array.isArray(row) ? row.join(',') : String(row))).join('/');
    }

    /** 拖拽预览消行演算：位姿未变则复用上次数值 */
    _getPreviewClearCells() {
        if (!this.previewPos || !this.previewBlock) {
            this._lastPreviewClearKey = null;
            this._lastPreviewClearCells = null;
            return null;
        }
        const { x, y } = this.previewPos;
        const b = this.previewBlock;
        const key = `${b.colorIdx}:${x},${y}:${this._shapeKey(b.shape)}`;
        if (key === this._lastPreviewClearKey && this._lastPreviewClearCells != null) {
            return this._lastPreviewClearCells;
        }
        this._lastPreviewClearKey = key;
        this._lastPreviewClearCells = this.grid.previewClearOutcome(
            b.shape,
            x,
            y,
            b.colorIdx
        );
        return this._lastPreviewClearCells;
    }

    /** 整帧重绘（含消除高亮与粒子）；与 markDirty 等价，避免漏画 clearCells 导致闪烁 */
    /**
     * 高分辨率盘面快照：用于分享海报等场景，避免直接采样屏幕 #game-grid 因
     * 设备 DPR 限制而失真。返回离屏 canvas（物理像素 ≥ targetPhysicalSize），
     * 失败回退 null，调用方自行降级到 `this.canvas`。
     */
    captureBoardSnapshot(targetPhysicalSize) {
        if (!this.renderer?.captureHighResSnapshot) return null;
        return this.renderer.captureHighResSnapshot(targetPhysicalSize, () => this.render());
    }

    render() {
        this.renderer.decayComboFlash();
        this.renderer.decayBonusMatchFlash();
        this.renderer.decayPerfectFlash();
        this.renderer.decayDoubleWave();
        this.renderer.clear();
        this.renderer.renderBackground();
        // 外围过渡光晕会在拖拽/落子重绘时改变 dash 外区配色；统一盘面布局后不再绘制。
        // v10.15: 皮肤环境粒子层（樱花 / 落叶 / 气泡 / 萤火虫 / 流星等），仅 5 款示范皮肤激活
        this.renderer.renderAmbient();
        this.renderer.renderGrid(this.grid);
        const previewClearCells = this._getPreviewClearCells();
        if (previewClearCells?.cells?.length) {
            this.renderer.renderPreviewClearHint(previewClearCells.cells, 'under');
        }
        if (this.previewPos && this.previewBlock) {
            this.renderer.renderPreview(this.previewPos.x, this.previewPos.y, this.previewBlock);
        }
        if (previewClearCells?.cells?.length) {
            this.renderer.renderPreviewClearHint(previewClearCells.cells, 'over');
        }
        this.renderer.renderClearCells(this.renderer.clearCells);
        this.renderer.renderDoubleWave();
        this.renderer.renderComboFlash();
        this.renderer.renderBonusMatchFlash();
        this.renderer.renderPerfectFlash();
        this.renderer.renderParticles();
        this.renderer.renderIconParticles();
    }
}
