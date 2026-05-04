/**
 * Open Block - Main Game Controller
 * Full game logic with behavior tracking
 */
import { CONFIG, getStrategy, GAME_EVENTS, ACHIEVEMENTS_BY_ID } from './config.js';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from './adaptiveSpawn.js';
import { PlayerProfile } from './playerProfile.js';
import { GAME_RULES } from './gameRules.js';
import {
    applyGameEndProgression,
    loadProgress,
    getLevelProgress,
    titleForLevel
} from './progression.js';
import { t, tSkinName } from './i18n/i18n.js';
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
import { generateDockShapes, resetSpawnMemory, getLastSpawnDiagnostics } from './bot/blockSpawn.js';
import { getSpawnMode, predictShapes } from './spawnModel.js';
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
import { LevelManager } from './level/levelManager.js';
import { ClearRuleEngine, RowColRule } from './clearRules.js';
import { notePopupShown } from './popupCoordinator.js';
import {
    detectBonusLines,
    computeClearScore,
    ICON_BONUS_LINE_MULT,
    bonusEffectHoldMs,
    monoNearFullLineColorWeights,
    pickThreeDockColors
} from './clearScoring.js';

export {
    detectBonusLines,
    computeClearScore,
    ICON_BONUS_LINE_MULT,
    bonusEffectHoldMs,
    monoNearFullLineColorWeights,
    pickThreeDockColors
};

function _topShapeWeightEntries(shapeWeights, n) {
    if (!shapeWeights || typeof shapeWeights !== 'object') return [];
    return Object.entries(shapeWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([category, weight]) => ({ category, weight: Number(weight) }));
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
        this._spawnContext = { lastClearCount: 0, roundsSinceClear: 0, recentCategories: [], totalRounds: 0, scoreMilestone: false };

        this.behaviors = [];
        this.backendSync = new BackendSync(this.db.userId);
        /** @type {ReturnType<typeof setTimeout> | null} */
        this._noMovesTimer = null;
        /** 模型异步出块进行中，跳过 game over 检查 */
        this._spawnPending = false;

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
            stress: layered._adaptiveStress,
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
            sessionArc: layered._sessionArc,
            comboChain: layered._comboChain,
            rhythmPhase: layered._rhythmPhase,
            milestoneHit: layered._milestoneHit,
            spawnHints: layered.spawnHints ? { ...layered.spawnHints } : null,
            spawnDiagnostics: getLastSpawnDiagnostics(),
            fillRatio: layered.fillRatio,
            shapeWeightsTop: _topShapeWeightEntries(layered.shapeWeights, 5)
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
            recentComboStreak: p.recentComboStreak,
            spawnRound: p.spawnRoundIndex
        };
    }

    async init() {
        try {
            await this.db.init();
            const { hydrateWalletFromApi } = await import('./skills/wallet.js');
            await hydrateWalletFromApi(this.db.userId);
            this.bestScore = await this.db.getBestScore();
            const stats = await this.db.getStats();
            this.playerProfile.ingestHistoricalStats(stats);
        } catch (err) {
            console.error('SQLite API 初始化失败:', err);
            this.bestScore = 0;
        }
        this.bindEvents();
        this.updateShellVisibility();
        this.updateUI();
        this.render();
        this._startAmbientFxLoop();
    }

    _startAmbientFxLoop() {
        if (typeof window === 'undefined' || this._ambientFxTimer != null) return;

        const draw = () => {
            this._ambientFxRaf = null;
            if (!this._shouldDrawAmbientFxFrame()) {
                return;
            }
            this.renderer.renderAmbientFxFrame();
        };

        const tick = () => {
            this._ambientFxTimer = null;
            const active = this._shouldDrawAmbientFxFrame();
            if (active && this._ambientFxRaf == null && typeof requestAnimationFrame === 'function') {
                this._ambientFxRaf = requestAnimationFrame(draw);
            }
            const delay = active
                ? this.renderer.getAmbientFrameIntervalMs()
                : 1000;
            this._ambientFxTimer = window.setTimeout(tick, delay);
        };

        this._ambientFxTimer = window.setTimeout(tick, 250);
    }

    _shouldDrawAmbientFxFrame() {
        if (!this.renderer?.hasAmbientMotion?.()) return false;
        if (typeof document !== 'undefined') {
            if (document.visibilityState === 'hidden') return false;
            const menu = document.getElementById('menu');
            if (menu?.classList.contains('active')) return false;
        }
        return !this.isAnimating && !this.drag && !this.previewPos && this._renderRaf == null;
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
        document.addEventListener('mouseup', () => this.onEnd());
        document.addEventListener('touchend', () => this.onEnd());

        // 盘面 CSS 显示尺寸变化（窗口缩放、侧栏挤压等）→ --cell-px 变化 → dock 候选区
        // 必须重新按新 --cell-px 渲染，否则 canvas buffer (CONFIG.CELL_SIZE) 与 CSS 显示尺寸
        // 不一致，浏览器插值把 bevel3d 斜切边缘"洗软"，导致候选区与盘面方块视觉不一致。
        if (typeof ResizeObserver !== 'undefined' && this.canvas) {
            let lastDockCellPx = this._getDockCellPx();
            const dockReflow = () => {
                const next = this._getDockCellPx();
                if (next !== lastDockCellPx) {
                    lastDockCellPx = next;
                    this.refreshDockSkin();
                }
            };
            this._dockResizeObs = new ResizeObserver(dockReflow);
            this._dockResizeObs.observe(this.canvas);
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
            el.textContent = `连战第 ${this.runStreak} 局：初始更挤、出块略难（回菜单重置）`;
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
            this._bestScoreAtRunStart = this.bestScore || 0;
            this._newBestCelebrated = false;
            this.isGameOver = false;
            this._endGameInFlight = null;
            document.body.classList.remove('game-over-active');
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
            this._spawnContext = { lastClearCount: 0, roundsSinceClear: 0, recentCategories: [], totalRounds: 0, scoreMilestone: false, bestScore: this.bestScore ?? 0 };
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

            const baseStrategy = getStrategy(this.strategy);
            const layeredOpen = resolveAdaptiveStrategy(this.strategy, this.playerProfile, 0, this.runStreak, 0, this._spawnContext);
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
                this.startDrag(idx, touch.clientX, touch.clientY);
            };

            canvas.addEventListener('mousedown', startDrag);
            canvas.addEventListener('touchstart', startDrag, { passive: false });
            div.appendChild(canvas);
            dock.appendChild(div);
        }
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

    /** 读取盘面单格的 CSS 实际显示尺寸（`--cell-px`）。
     *  候选区 canvas 用此值作为逻辑绘制单位，使 buffer 像素 = 显示像素，
     *  消除浏览器 CSS 缩放插值（v3 之前 dock 用 CONFIG.CELL_SIZE=38 绘制，
     *  CSS 拉伸到 5×--cell-px ≈ 5×50px 显示导致斜切边发软）。
     */
    _getDockCellPx() {
        if (typeof document === 'undefined') return CONFIG.CELL_SIZE;
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
            this.grid.getFillRatio(), this._spawnContext
        );
        this._captureAdaptiveInsight(layered);

        const mode = getSpawnMode();
        if (mode === 'model') {
            this._spawnBlocksWithModel(layered, opts);
            return;
        }

        this._commitSpawn(generateDockShapes(this.grid, layered, this._spawnContext), layered, opts, 'rule');
        if (opts.checkGameOver !== false) {
            this.checkGameOver();
        }
    }

    /**
     * 模型模式：异步请求推理，失败则回退规则算法
     * @private
     */
    _spawnBlocksWithModel(layered, opts) {
        this._spawnPending = true;

        const history = (this._spawnContext.recentModelHistory || []).slice(-3);
        while (history.length < 3) history.unshift([0, 0, 0]);

        const finish = (shapes, source) => {
            this._commitSpawn(shapes, layered, opts, source);
            this._spawnPending = false;
            if (opts.checkGameOver !== false) {
                this.checkGameOver();
            }
        };

        predictShapes(this.grid, this.playerProfile, history, this._lastAdaptiveInsight).then((modelShapes) => {
            if (modelShapes && modelShapes.length >= 3) {
                const ids = modelShapes.map(s => {
                    const vocab = ['1x4','4x1','1x5','5x1','2x3','3x2','2x2','3x3','t-up','t-down','t-left','t-right','z-h','z-h2','z-v','z-v2','l-1','l-2','l-3','l-4','l5-a','l5-b','l5-c','l5-d','j-1','j-2','j-3','j-4'];
                    return vocab.indexOf(s.id);
                });
                if (!this._spawnContext.recentModelHistory) this._spawnContext.recentModelHistory = [];
                this._spawnContext.recentModelHistory.push(ids);
                if (this._spawnContext.recentModelHistory.length > 5) this._spawnContext.recentModelHistory.shift();

                finish(modelShapes, 'model');
            } else {
                finish(generateDockShapes(this.grid, layered, this._spawnContext), 'rule-fallback');
            }
        }).catch(() => {
            finish(generateDockShapes(this.grid, layered, this._spawnContext), 'rule-fallback');
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
        this._spawnContext.scoreMilestone = false;
        const logSpawn = opts.logSpawn !== false;
        this.playerProfile.recordSpawn();

        const bonusBias = monoNearFullLineColorWeights(this.grid, getActiveSkin());
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

        this._pushSpawnToSequence(descriptors);

        this.populateDockUI(descriptors, {
            logSpawn,
            spawnShapeIds: shapes.map((s) => s.id)
        });

        // 将本轮临消行数和清屏准备信号回写到 _spawnContext，供下一轮 adaptiveSpawn 使用
        const _diag = getLastSpawnDiagnostics();
        this._spawnContext.nearFullLines = _diag?.layer1?.nearFullLines ?? 0;
        this._spawnContext.pcSetup       = _diag?.layer1?.pcSetup       ?? 0;

        this._refreshPlayerInsightPanel();
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

    startDrag(index, x, y) {
        if (this.rlPreviewLocked || this.replayPlaybackLocked) {
            return;
        }
        const block = this.dockBlocks[index];
        if (!block || block.placed) return;

        this.drag = { index };
        this.dragBlock = block;
        this._resetGhostDomStyles();
        const ghostDpr = Math.round(window.devicePixelRatio || 1) || 1;
        // 用盘面实际显示像素绘制 ghost，避免 CSS 缩放插值导致 bevel3d 斜切边变软
        const cellDisp = this._boardDisplayCellSize();
        const ghostCell = Math.round(cellDisp) || CONFIG.CELL_SIZE;
        const ghostLogW = block.width  * ghostCell;
        const ghostLogH = block.height * ghostCell;
        this.ghostCanvas.width  = ghostLogW * ghostDpr;
        this.ghostCanvas.height = ghostLogH * ghostDpr;
        this.ghostCtx = this.ghostCanvas.getContext('2d');
        this.ghostCtx.scale(ghostDpr, ghostDpr);
        this.ghostCanvas.style.width  = `${block.width  * cellDisp}px`;
        this.ghostCanvas.style.height = `${block.height * cellDisp}px`;
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

    updateGhostPosition(x, y) {
        const gw = this.ghostCanvas.offsetWidth || this.ghostCanvas.width;
        const gh = this.ghostCanvas.offsetHeight || this.ghostCanvas.height;
        this.ghostCanvas.style.left = `${x - gw / 2}px`;
        this.ghostCanvas.style.top = `${y - gh / 2}px`;
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

    onMove(e) {
        if (this.rlPreviewLocked || this.replayPlaybackLocked || !this.drag || !this.dragBlock || this.isAnimating) {
            return;
        }
        e.preventDefault();

        const touch = e.touches ? e.touches[0] : e;
        this.updateGhostPosition(touch.clientX, touch.clientY);
        this.renderGhost();

        const { aimCx, aimCy, overBoard } = this.ghostAimOnGrid();

        if (!overBoard) {
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
        const best = this.grid.pickNearestLocalPlacement(
            this.dragBlock.shape,
            aimCx,
            aimCy,
            anchorX,
            anchorY,
            CONFIG.PLACE_SNAP_RADIUS
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

        this._cancelPreviewClearAnim();

        const { aimCx, aimCy, overBoard } = this.ghostAimOnGrid();
        let placedPos = null;
        if (overBoard) {
            const { anchorX, anchorY } = this.naiveAnchorFromAim(
                this.dragBlock.shape,
                aimCx,
                aimCy
            );
            placedPos = this.grid.pickNearestLocalPlacement(
                this.dragBlock.shape,
                aimCx,
                aimCy,
                anchorX,
                anchorY,
                CONFIG.PLACE_SNAP_RADIUS
            );
        }

        this._resetGhostDomStyles();
        this.ghostCanvas.style.display = 'none';
        document.body.classList.remove('block-drag-active');
        const _eDpr = Math.round(window.devicePixelRatio || 1) || 1;
        this.ghostCtx.clearRect(0, 0,
            this.ghostCanvas.width / _eDpr, this.ghostCanvas.height / _eDpr);

        const dockCanvas = document.querySelector(`.dock-block[data-index="${this.drag.index}"] canvas`);
        if (dockCanvas) dockCanvas.style.opacity = '1';

        if (placedPos) {
            const fillBefore = this.grid.getFillRatio();
            const validsBefore = this.grid.countValidPlacements(this.dragBlock.shape);
            this.grid.place(this.dragBlock.shape, this.dragBlock.colorIdx, placedPos.x, placedPos.y);
            this.gameStats.placements++;

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
            this.playerProfile.recordPlace(result.count > 0, result.count, this.grid.getFillRatio());
            this._refreshPlayerInsightPanel();

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

                this._checkToughPlacement(this.dragBlock, fillBefore, validsBefore);

                this.dragBlock.placed = true;
                const dockBlock = document.querySelector(`.dock-block[data-index="${this.drag.index}"]`);
                if (dockBlock) dockBlock.style.visibility = 'hidden';

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
        const dockSlot = this.dockBlocks[dockIndex];

        this.isAnimating = true;
        this._clearStreak++;

        const bonusLines = result.bonusLines || [];
        const bonusCount = bonusLines.length;
        const { clearScore, iconBonusScore } = computeClearScore(this.strategy, result);

        const perfectClear = this.grid.getFillRatio() === 0;

        const scoreBeforeClear = this.score;
        this.score += clearScore;
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

        const madeNewBest = this._maybeCelebrateNewBest(scoreBeforeClear);

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

                if (dockSlot) {
                    dockSlot.placed = true;
                }
                const dockEl = document.querySelector(`.dock-block[data-index="${dockIndex}"]`);
                if (dockEl) {
                    dockEl.style.visibility = 'hidden';
                }

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

    _showStreakBadge(streak) {
        const el = document.createElement('div');
        el.className = 'streak-badge';
        const fires = streak >= 5 ? '🔥🔥🔥' : streak >= 4 ? '🔥🔥' : '🔥';
        el.textContent = `${fires} ${streak} 连消`;
        el.style.left = '50%';
        el.style.top = '14%';
        el.style.transform = 'translateX(-50%)';
        document.body.appendChild(el);
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
        // 兼容旧实现可能残留的浮层
        document.querySelectorAll('.no-moves-overlay').forEach((el) => el.remove());
        if (this.isGameOver || this._endGameInFlight) return;
        // 给最后一次粒子收尾留 250ms，再进入内嵌结算
        this._noMovesTimer = setTimeout(() => {
            this._noMovesTimer = null;
            void this.endGame({ noMovesLoss: true });
        }, 250);
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

                await this.saveSession();

                const persistedBestBase = this._bestScoreAtRunStart ?? this.bestScore;
                if (this.score > persistedBestBase) {
                    this.bestScore = this.score;
                    await this.db.saveScore(this.score, this.strategy);
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
                if (overScore) overScore.textContent = this.score;
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
                }
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
            adaptiveInsight: null
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
            adaptiveInsight: this._lastAdaptiveInsight
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
            adaptiveInsight: this._lastAdaptiveInsight
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
            el.innerHTML = `<div class="title">🏆 Achievement Unlocked!</div>${achievement.icon} ${achievement.name}<div style="font-size:12px;color:#666">${achievement.desc}</div>`;
            return el;
        }, 3000);
    }

    _maybeCelebrateNewBest(scoreBeforeClear) {
        if (this._newBestCelebrated) return false;
        const previousBest = this.bestScore || 0;
        if (this.score <= previousBest || this.score <= scoreBeforeClear) return false;

        this._newBestCelebrated = true;
        this.bestScore = this.score;
        this.updateUI();

        this.renderer.triggerBonusMatchFlash(3);
        this.renderer.triggerPerfectFlash();
        this.renderer.setShake(18, 900);

        const el = document.createElement('div');
        el.className = 'new-best-popup';
        el.innerHTML = `<div class="new-best-title">NEW BEST</div><div class="new-best-score">${this.score}</div>`;
        document.body.appendChild(el);
        notePopupShown(2300, 900);
        setTimeout(() => el.remove(), 2300);
        return true;
    }

    /**
     * @param {number} [bonusUiHoldMs=0]  有同色 bonus 时传入与粒子阶段相同的 hold（ms），用于顶栏分数与粒子同步消失
     */
    showFloatScore(score, type, linesCleared = 0, iconBonus = 0, bonusUiHoldMs = 0) {
        const el = document.createElement('div');
        const isNewBest = type === 'new-best';
        const isCombo = type === 'combo';
        const isPerfect = type === 'perfect';
        const hasIconBonus = iconBonus > 0;

        if (hasIconBonus) {
            el.className = 'float-score float-icon-bonus';
            if (bonusUiHoldMs > 0) {
                el.style.setProperty('--icon-bonus-pop-ms', `${Math.round(bonusUiHoldMs)}ms`);
            }
            el.innerHTML =
                `<span class="float-bonus-art" role="status">` +
                `<span class="float-bonus-num">${score}</span>` +
                `<span class="float-bonus-mult-wrap">(${ICON_BONUS_LINE_MULT}x)</span>` +
                `</span>`;
            el.style.left = '50%';
            el.style.top = isPerfect ? '18%' : isCombo ? '22%' : '28%';
            el.style.transform = 'translateX(-50%)';
            document.body.appendChild(el);
            const floatHoldMs = bonusUiHoldMs > 0 ? Math.round(bonusUiHoldMs) : 4000;
            setTimeout(() => el.remove(), floatHoldMs);
            return;
        }

        const cls = isNewBest ? ' float-new-best' : isPerfect ? ' float-perfect' : isCombo ? ' float-combo' : type === 'multi' ? ' float-multi' : '';
        el.className = 'float-score' + cls;

        if (isNewBest) {
            el.innerHTML = `<span class="float-label">NEW RECORD</span><span class="float-pts">+${score}</span>`;
        } else if (isPerfect) {
            el.innerHTML = `<span class="float-label">PERFECT</span><span class="float-pts">+${score}</span>`;
        } else if (isCombo && linesCleared >= 3) {
            el.innerHTML = `<span class="float-label">COMBO ×${linesCleared}</span><span class="float-pts">+${score}</span>`;
        } else if (type === 'multi') {
            el.innerHTML = `<span class="float-label">DOUBLE</span><span class="float-pts">+${score}</span>`;
        } else {
            el.textContent = '+' + score;
        }

        el.style.left = '50%';
        el.style.top = isNewBest ? '16%' : isPerfect ? '18%' : isCombo ? '22%' : '25%';
        el.style.transform = 'translateX(-50%)';
        document.body.appendChild(el);
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
            el.classList.add('active');
        }
        // 离开 game-over 内嵌结算时清理棋盘柔化滤镜
        if (id !== 'game-over') {
            document.body.classList.remove('game-over-active');
        }
        this.updateShellVisibility();
    }

    updateUI() {
        document.getElementById('score').textContent = this.score;
        document.getElementById('best').textContent = this.bestScore;
        // 最高分差距提示（无尽模式 + 尚未超越时显示）
        const gapEl = document.getElementById('best-gap');
        if (gapEl) {
            const gap = this.bestScore - this.score;
            if (this._levelMode === 'endless' && gap > 0 && this.bestScore > 0) {
                gapEl.textContent = t('best.gap', { gap });
                gapEl.hidden = false;
                // 接近最高分时高亮
                gapEl.className = 'best-gap' + (gap <= this.bestScore * 0.1 ? ' best-gap--close' : '');
            } else {
                gapEl.hidden = true;
            }
        }
        this._updateProgressionHud();
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

        const hints = [
            '尝试先放置较小的方块，为后续大块留出空间',
            '优先消除边角区域，保持中央灵活度',
            '遇到 L/T 型块时，尽量靠边放置',
            '保持棋盘整洁比追求一次消多行更重要',
        ];
        const hint = hints[Math.min(streak - 1, hints.length - 1)];
        textEl.textContent = streak >= 2
            ? `已连续失败 ${streak + 1} 次 · ${hint}`
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
