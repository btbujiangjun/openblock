/**
 * Block Blast - Main Game Controller
 * Full game logic with behavior tracking
 */
import { CONFIG, getStrategy, GAME_EVENTS } from './config.js';
import { getActiveSkinId, getBlockColors, setActiveSkinId, SKIN_LIST, applySkinToDocument, getActiveSkin } from './skins.js';
import { Grid } from './grid.js';
import { generateDockShapes } from './bot/blockSpawn.js';
import { buildInitFrame, buildPlaceFrame, buildSpawnFrame, replayStateAt } from './moveSequence.js';
import { Database } from './database.js';
import { Renderer } from './renderer.js';
import { BackendSync } from './services/backendSync.js';

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
        this.strategy = 'normal';

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

        this.behaviors = [];
        this.backendSync = new BackendSync(this.db.userId);
    }

    async init() {
        try {
            await this.db.init();
            this.bestScore = await this.db.getBestScore();
        } catch (err) {
            console.error('SQLite API 初始化失败:', err);
            this.bestScore = 0;
        }
        this.bindEvents();
        this.updateShellVisibility();
        this.updateUI();
        this.render();
    }

    /** 主菜单 / 结束页打开时隐藏主界面与难度条；回放页需看到棋盘，不计入 */
    updateShellVisibility() {
        const menu = document.getElementById('menu');
        const over = document.getElementById('game-over');
        const overlayOpen =
            Boolean(menu?.classList.contains('active')) || Boolean(over?.classList.contains('active'));
        document.body.classList.toggle('game-shell-hidden', overlayOpen);
    }

    bindEvents() {
        const startBtn = document.getElementById('start-btn');
        const retryBtn = document.getElementById('retry-btn');
        const menuBtn = document.getElementById('menu-btn');
        if (startBtn) {
            startBtn.onclick = () => void this.start();
        }
        if (retryBtn) {
            retryBtn.onclick = () => void this.start();
        }
        if (menuBtn) {
            menuBtn.onclick = () => this.showScreen('menu');
        }

        document.querySelectorAll('.strategy-btn').forEach(btn => {
            btn.onclick = () => {
                document.querySelectorAll('.strategy-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.strategy = btn.dataset.level;
            };
        });

        const skinSelect = document.getElementById('skin-select');
        if (skinSelect) {
            skinSelect.innerHTML = SKIN_LIST.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
            skinSelect.value = getActiveSkinId();
            skinSelect.addEventListener('change', () => {
                if (setActiveSkinId(skinSelect.value)) {
                    applySkinToDocument(getActiveSkin());
                    this.markDirty();
                }
            });
        }

        document.addEventListener('mousemove', e => this.onMove(e));
        document.addEventListener('touchmove', e => this.onMove(e), { passive: false });
        document.addEventListener('mouseup', () => this.onEnd());
        document.addEventListener('touchend', () => this.onEnd());
    }

    async start() {
        try {
            this.grid.clear();
            this.score = 0;
            this.isGameOver = false;
            this.behaviors = [];
            this.moveSequence = [];
            this._replayFrames = null;
            this.replayPlaybackLocked = false;
            this.gameStats = {
                score: 0,
                clears: 0,
                maxLinesCleared: 0,
                maxCombo: 0,
                placements: 0,
                misses: 0,
                startTime: Date.now()
            };

            const strategyConfig = getStrategy(this.strategy);
            this.grid.size = strategyConfig.gridWidth || CONFIG.GRID_SIZE;
            this.renderer.setGridSize(this.grid.size);
            this.grid.initBoard(strategyConfig.fillRatio, strategyConfig.shapeWeights);

            try {
                this.sessionId = await this.db.saveSession({
                    startTime: Date.now(),
                    score: 0,
                    strategy: this.strategy,
                    strategyConfig: strategyConfig
                });
            } catch (e) {
                console.warn('会话未写入 SQLite API（请确认已启动 server.py 且 VITE_API_BASE_URL 正确）:', e);
                this.sessionId = null;
            }

            this._captureInitFrame(strategyConfig);

            await this.backendSync.startSession(this.strategy, strategyConfig, this.sessionId);

            try {
                const stats = await this.db.getStats();
                await this.db.updateStats({ totalGames: stats.totalGames + 1 });
            } catch (e) {
                console.warn('统计未更新:', e);
            }

            this.spawnBlocks();
            this.hideScreens();
            this.endReplay();
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
            canvas.width = slotPx;
            canvas.height = slotPx;
            const ctx = canvas.getContext('2d');
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
    }

    spawnBlocks() {
        const strategyConfig = getStrategy(this.strategy);
        const shapes = generateDockShapes(this.grid, strategyConfig);

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

        this._pushSpawnToSequence(descriptors);

        this.populateDockUI(descriptors, {
            logSpawn: true,
            spawnShapeIds: shapes.map((s) => s.id)
        });
    }

    /**
     * 将无头模拟器状态同步到主画布与底部待选块（用于 RL 盘面演示）
     * @param {import('./bot/simulator.js').BlockBlastSimulator} sim
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

    startDrag(index, x, y) {
        if (this.rlPreviewLocked || this.replayPlaybackLocked) {
            return;
        }
        const block = this.dockBlocks[index];
        if (!block || block.placed) return;

        this.drag = { index };
        this.dragBlock = block;
        this.ghostCanvas.width = block.width * CONFIG.CELL_SIZE;
        this.ghostCanvas.height = block.height * CONFIG.CELL_SIZE;
        this.ghostCanvas.style.display = 'block';
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
        this.ghostCanvas.style.left = (x - this.ghostCanvas.width / 2) + 'px';
        this.ghostCanvas.style.top = (y - this.ghostCanvas.height / 2) + 'px';
    }

    renderGhost() {
        const block = this.dragBlock;
        if (!block) return;

        this.ghostCtx.clearRect(0, 0, this.ghostCanvas.width, this.ghostCanvas.height);

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
        const relX = ghostRect.left + ghostRect.width / 2 - rect.left;
        const relY = ghostRect.top + ghostRect.height / 2 - rect.top;
        const pad = CONFIG.CELL_SIZE;
        return {
            aimCx: relX / CONFIG.CELL_SIZE,
            aimCy: relY / CONFIG.CELL_SIZE,
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
        } else if (this.previewPos) {
            this.previewPos = null;
            this.previewBlock = null;
            this.markDirty();
        }
    }

    onEnd() {
        if (this.rlPreviewLocked || this.replayPlaybackLocked || !this.drag || !this.dragBlock || this.isAnimating) {
            return;
        }

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

        this.ghostCanvas.style.display = 'none';
        this.ghostCtx.clearRect(0, 0, this.ghostCanvas.width, this.ghostCanvas.height);

        const dockCanvas = document.querySelector(`.dock-block[data-index="${this.drag.index}"] canvas`);
        if (dockCanvas) dockCanvas.style.opacity = '1';

        if (placedPos) {
            this.grid.place(this.dragBlock.shape, this.dragBlock.colorIdx, placedPos.x, placedPos.y);
            this._pushPlaceToSequence(this.drag.index, placedPos.x, placedPos.y);
            this.gameStats.placements++;

            this.logBehavior(GAME_EVENTS.PLACE, {
                blockIndex: this.drag.index,
                blockId: this.dragBlock.id,
                x: placedPos.x,
                y: placedPos.y
            });

            const result = this.grid.checkLines();
            if (result.count > 0) {
                this.playClearEffect(result);
            } else {
                this.logBehavior(GAME_EVENTS.NO_CLEAR, {
                    blockIndex: this.drag.index,
                    blockId: this.dragBlock.id
                });

                this.dragBlock.placed = true;
                const dockBlock = document.querySelector(`.dock-block[data-index="${this.drag.index}"]`);
                if (dockBlock) dockBlock.style.visibility = 'hidden';

                if (this.dockBlocks.every(b => b.placed)) {
                    this.spawnBlocks();
                }

                this.updateUI();
                this.checkGameOver();
            }
        } else {
            this.gameStats.misses++;
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
        /** onEnd 会在本函数返回后立刻清空 drag/dragBlock，动画结束回调须用此处快照 */
        const dockIndex = this.drag.index;
        const dockSlot = this.dockBlocks[dockIndex];

        this.isAnimating = true;

        const strategyConfig = getStrategy(this.strategy);
        const scoring = strategyConfig.scoring;

        let clearScore = scoring.singleLine * result.count;
        if (result.count === 2) clearScore = scoring.multiLine;
        else if (result.count >= 3) clearScore = scoring.combo + (result.count - 2) * scoring.multiLine;

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

        this.renderer.addParticles(result.cells);
        this.renderer.setClearCells(result.cells);
        // 仅使用画布内 shakeOffset，避免与 #game-wrapper CSS 动画叠加造成跳跃/闪烁
        this.renderer.setShake(6, 320);

        this.showFloatScore(clearScore, result.count >= 3 ? 'combo' : result.count >= 2 ? 'multi' : '');

        const animStart = Date.now();
        const animDuration = 400;

        const animate = () => {
            self.renderer.updateShake();
            self.renderer.updateParticles();
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
                    self.spawnBlocks();
                }

                self.updateUI();
                self.checkGameOver();
            }
        };

        animate();
    }

    checkGameOver() {
        const remaining = this.dockBlocks.filter(b => !b.placed);
        if (!this.grid.hasAnyMove(remaining)) {
            this.showNoMovesWarning();
        }
    }

    showNoMovesWarning() {
        const warning = document.createElement('div');
        warning.className = 'no-moves-overlay';
        warning.setAttribute('role', 'alert');
        warning.textContent = '没有可用步数';
        document.body.appendChild(warning);

        setTimeout(() => {
            warning.remove();
            void this.endGame();
        }, 1500);
    }

    async endGame() {
        this.isGameOver = true;

        this.logBehavior(GAME_EVENTS.GAME_OVER, {
            finalScore: this.score,
            totalClears: this.gameStats.clears,
            maxCombo: this.gameStats.maxCombo,
            duration: Date.now() - this.gameStats.startTime
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

        document.getElementById('over-score').textContent = `得分：${this.score}`;
        this.showScreen('game-over');
    }

    async saveSession() {
        if (!this.sessionId) {
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
    }

    _captureInitFrame(strategyConfig) {
        if (!this.sessionId) {
            this.moveSequence = [];
            return;
        }
        this.moveSequence = [buildInitFrame(this.strategy, this.grid, strategyConfig.scoring)];
        this._schedulePersistMoves();
    }

    _pushSpawnToSequence(descriptors) {
        if (!this.sessionId) {
            return;
        }
        this.moveSequence.push(buildSpawnFrame(descriptors));
        this._schedulePersistMoves();
    }

    _pushPlaceToSequence(dockIndex, gx, gy) {
        if (!this.sessionId) {
            return;
        }
        this.moveSequence.push(buildPlaceFrame(dockIndex, gx, gy));
        this._schedulePersistMoves();
    }

    _schedulePersistMoves() {
        if (!this.sessionId) {
            return;
        }
        clearTimeout(this._movePersistTimer);
        this._movePersistTimer = setTimeout(() => {
            this._movePersistTimer = null;
            void this.db.upsertMoveSequence(this.sessionId, this.moveSequence).catch((err) => {
                console.warn('upsertMoveSequence:', err);
            });
        }, 500);
    }

    async _flushMoveSequence() {
        if (!this.sessionId || this.moveSequence.length === 0) {
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

    showFloatScore(score, type) {
        const el = document.createElement('div');
        el.className = 'float-score' + (type === 'combo' ? ' float-combo' : '');
        el.textContent = type === 'combo' ? 'COMBO +' + score : type === 'multi' ? 'DOUBLE +' + score : '+' + score;
        el.style.left = '50%';
        el.style.top = '25%';
        el.style.transform = 'translateX(-50%)';
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 600);
    }

    hideScreens() {
        document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
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
    }

    markDirty() {
        this.render();
    }

    /** 整帧重绘（含消除高亮与粒子）；与 markDirty 等价，避免漏画 clearCells 导致闪烁 */
    render() {
        this.renderer.clear();
        this.renderer.renderBackground();
        this.renderer.renderGrid(this.grid);
        if (this.previewPos && this.previewBlock) {
            this.renderer.renderPreview(this.previewPos.x, this.previewPos.y, this.previewBlock);
        }
        this.renderer.renderClearCells(this.renderer.clearCells);
        this.renderer.renderParticles();
    }
}
