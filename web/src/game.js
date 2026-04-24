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
import {
    getActiveSkinId,
    getBlockColors,
    setActiveSkinId,
    SKIN_LIST,
    applySkinToDocument,
    getActiveSkin,
    SKINS,
    DEFAULT_SKIN_ID
} from './skins.js';
import { Grid } from './grid.js';
import { generateDockShapes, resetSpawnMemory, getLastSpawnDiagnostics } from './bot/blockSpawn.js';
import { getSpawnMode, predictShapes } from './spawnModel.js';
import {
    buildInitFrame,
    buildPlaceFrame,
    buildPlayerStateSnapshot,
    buildSpawnFrame,
    MIN_PERSIST_MOVE_FRAMES,
    replayStateAt
} from './moveSequence.js';
import { Database } from './database.js';
import { Renderer, syncGridDisplayPx } from './renderer.js';
import { BackendSync } from './services/backendSync.js';
import { LevelManager } from './level/levelManager.js';
import { ClearRuleEngine, RowColRule } from './clearRules.js';

function _topShapeWeightEntries(shapeWeights, n) {
    if (!shapeWeights || typeof shapeWeights !== 'object') return [];
    return Object.entries(shapeWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([category, weight]) => ({ category, weight: Number(weight) }));
}

export class Game {
    constructor() {
        this.grid = new Grid(CONFIG.GRID_SIZE);
        this.canvas = document.getElementById('game-grid');
        this.ghostCanvas = document.getElementById('drag-ghost');
        this.ghostCtx = this.ghostCanvas.getContext('2d');
        this.renderer = new Renderer(this.canvas);
        this.db = new Database();

        this.score = 0;
        this.bestScore = 0;
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
            const oc = this.grid.previewClearOutcome(
                this.previewBlock.shape,
                this.previewPos.x,
                this.previewPos.y,
                this.previewBlock.colorIdx
            );
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
                    this.refreshDockSkin();
                    this.markDirty();
                }
            });
        }

        document.addEventListener('mousemove', e => this.onMove(e));
        document.addEventListener('touchmove', e => this.onMove(e), { passive: false });
        document.addEventListener('mouseup', () => this.onEnd());
        document.addEventListener('touchend', () => this.onEnd());
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
        skinSelect.innerHTML = SKIN_LIST.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
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
                elStreak.textContent = `连续 ${st.dailyStreak} 天`;
            } else {
                elStreak.hidden = true;
                elStreak.textContent = '';
            }
        }
        if (elTrack) {
            elTrack.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
        }
    }

    showProgressionToast(title, bodyHtml) {
        const el = document.createElement('div');
        el.className = 'achievement-popup progression-toast';
        el.innerHTML = `<div class="title">${title}</div>${bodyHtml}`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3200);
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
            this.isGameOver = false;
            this._endGameInFlight = null;
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
                this.spawnBlocks({ logSpawn: false, spawnShapeIds: spawnHints?.forceIds });
            } else {
                const maxOpeningTries = 48;
                let openingPlayable = false;
                for (let k = 0; k < maxOpeningTries; k++) {
                    clearTimeout(this._movePersistTimer);
                    this._movePersistTimer = null;
                    this.grid.initBoard(layeredOpen.fillRatio, layeredOpen.shapeWeights);
                    this._captureInitFrame(baseStrategy);
                    this.spawnBlocks({ logSpawn: false });
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
                    this.spawnBlocks({ logSpawn: false });
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

            const cell = CONFIG.CELL_SIZE;
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
        requestAnimationFrame(() => syncGridDisplayPx(this.canvas));
    }

    /** 用当前皮肤重绘候选区所有方块 canvas，保持与棋盘渲染风格一致 */
    refreshDockSkin() {
        if (!this.dockBlocks) return;
        const cell = CONFIG.CELL_SIZE;
        const slotPx = CONFIG.DOCK_PREVIEW_MAX_CELLS * cell;
        const blocks = document.querySelectorAll('.dock-block');
        blocks.forEach((div) => {
            const idx = Number(div.dataset.index);
            const block = this.dockBlocks[idx];
            if (!block) return;
            const cvs = div.querySelector('canvas');
            if (!cvs) return;
            const ctx = cvs.getContext('2d');
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
     * @param {{ logSpawn?: boolean }} [opts] logSpawn 默认 true；开局重试时 false，由 start 末尾统一记一条 spawn
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
            this.checkGameOver();
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
        this._spawnContext.scoreMilestone = false;
        const logSpawn = opts.logSpawn !== false;
        this.playerProfile.recordSpawn();

        const colors = [0, 1, 2, 3, 4, 5, 6, 7];
        for (let i = colors.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [colors[i], colors[j]] = [colors[j], colors[i]];
        }

        const descriptors = [];
        for (let i = 0; i < 3; i++) {
            const shape = shapes[i];
            descriptors.push({
                id: shape.id,
                shape: shape.data,
                colorIdx: colors[i % colors.length],
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
        const ghostLogW = block.width  * CONFIG.CELL_SIZE;
        const ghostLogH = block.height * CONFIG.CELL_SIZE;
        this.ghostCanvas.width  = ghostLogW * ghostDpr;
        this.ghostCanvas.height = ghostLogH * ghostDpr;
        this.ghostCtx = this.ghostCanvas.getContext('2d');
        this.ghostCtx.scale(ghostDpr, ghostDpr);
        const cellDisp = this._boardDisplayCellSize();
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

        for (let y = 0; y < block.height; y++) {
            for (let x = 0; x < block.width; x++) {
                if (block.shape[y][x]) {
                    this.renderer.drawDockBlock(this.ghostCtx, x, y, getBlockColors()[block.colorIdx], CONFIG.CELL_SIZE);
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

            // 消除检测：始终通过 ClearRuleEngine（普通模式用 RowColRule，关卡模式用自定义规则）
            // 结果包含 { count, cells, bonusLines }，bonusLines 用于同色行/列双倍加分
            const result = this._clearEngine
                ? this._clearEngine.apply(this.grid)
                : this.grid.checkLines();
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

        const strategyConfig = getStrategy(this.strategy);
        const scoring = strategyConfig.scoring;

        let clearScore = scoring.singleLine * result.count;
        if (result.count === 2) clearScore = scoring.multiLine;
        else if (result.count >= 3) clearScore = scoring.combo + (result.count - 2) * scoring.multiLine;

        // 同 icon 行/列加成：每条全同icon的行或列额外翻倍该行分数
        const bonusLines = result.bonusLines || [];
        const bonusCount = bonusLines.length;
        let iconBonusScore = 0;
        if (bonusCount > 0) {
            const perLine = Math.round(clearScore / result.count);
            iconBonusScore = perLine * bonusCount;
            clearScore += iconBonusScore;
        }

        const perfectClear = this.grid.getFillRatio() === 0;

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

        const isCombo = result.count >= 3;
        const isDouble = result.count === 2;

        this.renderer.addParticles(result.cells, {
            lines: result.count,
            perfectClear
        });
        this.renderer.setClearCells(result.cells);

        // 同 icon 行/列：触发飘字特效
        if (bonusCount > 0) {
            const skin = getActiveSkin();
            const icons = skin.blockIcons;
            for (const bl of bonusLines) {
                const icon = icons && icons.length
                    ? icons[bl.colorIdx % icons.length]
                    : null;
                if (icon) {
                    this.renderer.addIconParticles(bl, icon, 10);
                }
            }
        }

        if (perfectClear) {
            this.renderer.triggerPerfectFlash();
            this.renderer.setShake(16, 720);
        } else if (isCombo) {
            this.renderer.triggerComboFlash(result.count);
            this.renderer.setShake(11, 520);
        } else if (isDouble) {
            const waveRows = [...new Set(result.cells.map(c => c.y))];
            this.renderer.triggerDoubleWave(waveRows);
            this.renderer.setShake(8, 400);
        } else {
            this.renderer.setShake(5, 280);
        }

        let effectType = '';
        if (perfectClear) effectType = 'perfect';
        else if (isCombo) effectType = 'combo';
        else if (isDouble) effectType = 'multi';

        this.showFloatScore(clearScore, effectType, result.count, bonusCount > 0 ? iconBonusScore : 0);

        if (this._clearStreak >= 3) {
            this._showStreakBadge(this._clearStreak);
        }

        const animDuration = perfectClear ? 1050 : isCombo ? 780 : isDouble ? 620 : 500;
        const animStart = Date.now();

        const animate = () => {
            self.renderer.updateShake();
            self.renderer.updateParticles();
            self.renderer.updateIconParticles();
            self.markDirty();

            if (Date.now() - animStart < animDuration) {
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
     * 判断本次非消行放置是否属于"解决难题"：
     * - 盘面占用率 ≥ 50%
     * - 放置前合法位 ≤ 3
     * - 方块 ≥ 3 格
     */
    _checkToughPlacement(block, fillBefore, validsBefore) {
        const blockCells = block.shape.flat().filter(Boolean).length;
        if (blockCells >= 3 && fillBefore >= 0.50 && validsBefore <= 3) {
            this._showThumbsUp();
        }
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

    showNoMovesWarning() {
        clearTimeout(this._noMovesTimer);
        this._noMovesTimer = null;
        document.querySelectorAll('.no-moves-overlay').forEach((el) => el.remove());

        const wrap = document.createElement('div');
        wrap.className = 'no-moves-overlay';
        wrap.setAttribute('role', 'alertdialog');
        wrap.setAttribute('aria-live', 'assertive');

        const msg = document.createElement('div');
        msg.className = 'no-moves-overlay-msg';
        msg.textContent = '没可用空间';
        wrap.appendChild(msg);

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-primary no-moves-restart-btn';
        btn.textContent = '再来一局';
        btn.onclick = () => {
            btn.disabled = true;
            clearTimeout(this._noMovesTimer);
            this._noMovesTimer = null;
            void (async () => {
                try {
                    await this.endGame();
                    wrap.remove();
                    await this.start({ fromChain: true });
                } catch (e) {
                    console.error(e);
                    wrap.remove();
                    const overScore = document.getElementById('over-score');
                    if (overScore) overScore.textContent = this.score;
                    this.showScreen('game-over');
                }
            })();
        };
        wrap.appendChild(btn);

        document.body.appendChild(wrap);

        this._noMovesTimer = setTimeout(() => {
            this._noMovesTimer = null;
            void (async () => {
                try {
                    await this.endGame();
                } finally {
                    wrap.remove();
                }
            })();
        }, 2500);
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
        this.isGameOver = true;
        // 写入结算模式，供结算界面读取
        const gameOverEl = document.getElementById('game-over');
        const mode = opts.mode ?? 'endless';
        if (gameOverEl) gameOverEl.dataset.gameMode = mode;
        // 更新模式标签文字
        const labelEl = document.getElementById('over-label');
        if (labelEl) {
            labelEl.textContent = mode === 'level' ? '关卡完成' :
                                  mode === 'level-fail' ? '关卡失败' : '游戏结束';
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

                if (this.score > this.bestScore) {
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
                        let t = `+${progressionResult.xpGained} 经验`;
                        if (progressionResult.leveledUp) {
                            t += ` · 升至 Lv.${progressionResult.newLevel}`;
                        }
                        overXp.textContent = t;
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

        if (this.moveSequence.length < MIN_PERSIST_MOVE_FRAMES) {
            try {
                await this.db.deleteReplaySessions([this.sessionId]);
            } catch (e) {
                console.warn('删除过短对局记录失败:', e);
            }
            this.playerProfile.save();
            return;
        }

        await this._flushMoveSequence();

        await this.db.updateSession(this.sessionId, {
            endTime: Date.now(),
            score: this.score,
            status: 'completed',
            gameStats: this.gameStats
        });

        if (this.behaviors.length > 0) {
            const tail = [...this.behaviors];
            this.behaviors = [];
            await this.db.saveBehaviors(tail);
            await this.backendSync.flushBatch(tail);
            await this.db.saveReplay(this.sessionId, tail);
        }

        const durationSec = Math.max(1, Math.floor((Date.now() - this.gameStats.startTime) / 1000));
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
        const scoring = getStrategy(this.strategy).scoring;
        const c = lineResult?.count ?? 0;
        let lineScore = 0;
        if (c === 1) lineScore = scoring.singleLine;
        else if (c === 2) lineScore = scoring.multiLine;
        else if (c >= 3) lineScore = scoring.combo + (c - 2) * scoring.multiLine;
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
        if (this.moveSequence.length < MIN_PERSIST_MOVE_FRAMES) {
            return;
        }
        clearTimeout(this._movePersistTimer);
        this._movePersistTimer = setTimeout(() => {
            this._movePersistTimer = null;
            if (this.moveSequence.length < MIN_PERSIST_MOVE_FRAMES) {
                return;
            }
            void this.db.upsertMoveSequence(this.sessionId, this.moveSequence).catch((err) => {
                console.warn('upsertMoveSequence:', err);
            });
        }, 500);
    }

    async _flushMoveSequence() {
        if (!this.sessionId || this.moveSequence.length === 0) {
            return;
        }
        if (this.moveSequence.length < MIN_PERSIST_MOVE_FRAMES) {
            return;
        }
        clearTimeout(this._movePersistTimer);
        this._movePersistTimer = null;
        await this.db.upsertMoveSequence(this.sessionId, this.moveSequence);
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
        this._replayFrames = frames.map((f) => JSON.parse(JSON.stringify(f)));
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
        const el = document.createElement('div');
        el.className = 'achievement-popup';
        el.innerHTML = `<div class="title">🏆 Achievement Unlocked!</div>${achievement.icon} ${achievement.name}<div style="font-size:12px;color:#666">${achievement.desc}</div>`;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 3000);
    }

    showFloatScore(score, type, linesCleared = 0, iconBonus = 0) {
        const el = document.createElement('div');
        const isCombo = type === 'combo';
        const isPerfect = type === 'perfect';
        const hasIconBonus = iconBonus > 0;
        const cls = isPerfect ? ' float-perfect' : isCombo ? ' float-combo' : type === 'multi' ? ' float-multi' : '';
        el.className = 'float-score' + cls + (hasIconBonus ? ' float-icon-bonus' : '');

        if (isPerfect) {
            el.innerHTML = `<span class="float-label">PERFECT</span><span class="float-pts">+${score}</span>`;
        } else if (isCombo && linesCleared >= 3) {
            const bonusTag = hasIconBonus ? ` <span class="float-icon-tag">×2</span>` : '';
            el.innerHTML = `<span class="float-label">COMBO ×${linesCleared}${bonusTag}</span><span class="float-pts">+${score}</span>`;
        } else if (type === 'multi') {
            const bonusTag = hasIconBonus ? ` <span class="float-icon-tag">×2</span>` : '';
            el.innerHTML = `<span class="float-label">DOUBLE${bonusTag}</span><span class="float-pts">+${score}</span>`;
        } else if (hasIconBonus) {
            el.innerHTML = `<span class="float-label"><span class="float-icon-tag">同色 ×2</span></span><span class="float-pts">+${score}</span>`;
        } else {
            el.textContent = '+' + score;
        }

        el.style.left = '50%';
        el.style.top = isPerfect ? '18%' : isCombo ? '22%' : hasIconBonus ? '28%' : '25%';
        el.style.transform = 'translateX(-50%)';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), isPerfect ? 2200 : isCombo ? 1450 : hasIconBonus ? 900 : 600);
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
                gapEl.textContent = `差 ${gap} 分`;
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
        this.render();
    }

    /** 整帧重绘（含消除高亮与粒子）；与 markDirty 等价，避免漏画 clearCells 导致闪烁 */
    render() {
        this.renderer.decayComboFlash();
        this.renderer.decayPerfectFlash();
        this.renderer.decayDoubleWave();
        this.renderer.clear();
        this.renderer.renderBackground();
        this.renderer.renderGrid(this.grid);
        let previewClearCells = null;
        if (this.previewPos && this.previewBlock) {
            previewClearCells = this.grid.previewClearOutcome(
                this.previewBlock.shape,
                this.previewPos.x,
                this.previewPos.y,
                this.previewBlock.colorIdx
            );
        }
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
        this.renderer.renderPerfectFlash();
        this.renderer.renderParticles();
        this.renderer.renderIconParticles();
    }
}
