/**
 * Block Blast - Main Game Controller
 * Full game logic with behavior tracking
 */
import { CONFIG, COLORS, getStrategy, GAME_EVENTS } from './config.js';
import { getAllShapes, getShapeCategory } from './shapes.js';
import { Grid } from './grid.js';
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
            console.error('IndexedDB 初始化失败（无痕模式或权限受限时常见）:', err);
            this.bestScore = 0;
        }
        this.bindEvents();
        this.updateShellVisibility();
        this.updateUI();
        this.render();
    }

    /** 全屏菜单打开时隐藏主界面与难度条，避免半透明叠层导致发灰、误触 */
    updateShellVisibility() {
        const overlayOpen = Boolean(document.querySelector('.screen.active'));
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
                console.warn('本地会话未写入（IndexedDB 不可用）:', e);
                this.sessionId = null;
            }

            await this.backendSync.startSession(this.strategy, strategyConfig);

            try {
                const stats = await this.db.getStats();
                await this.db.updateStats({ totalGames: stats.totalGames + 1 });
            } catch (e) {
                console.warn('统计未更新:', e);
            }

            this.spawnBlocks();
            this.hideScreens();
            this.updateUI();
            this.markDirty();
            this.render();
            this.checkGameOver();
        } catch (err) {
            console.error('开始游戏失败:', err);
            const banner = document.getElementById('boot-error');
            if (banner) {
                banner.hidden = false;
                banner.textContent =
                    '无法进入对局：' + (err instanceof Error ? err.message : String(err)) +
                    '。若使用 file:// 打开，请改用 npm run dev。';
            }
        }
    }

    generateBlocks(strategyConfig) {
        const blocks = [];
        const usedIds = {};
        const allShapes = getAllShapes();
        const weights = strategyConfig.shapeWeights;

        const scored = allShapes.map(shape => {
            const canPlace = this.grid.canPlaceAnywhere(shape.data);
            const gapFills = canPlace ? this.grid.countGapFills(shape.data) : 0;
            const category = getShapeCategory(shape.id);
            const weight = weights[category] || 1;
            return { shape, canPlace, gapFills, weight, category };
        }).filter(s => s.canPlace);

        if (scored.length === 0) return [];

        scored.sort((a, b) => b.gapFills - a.gapFills);

        const clearCandidates = scored.filter(s => s.gapFills > 0);
        if (clearCandidates.length > 0) {
            const idx = Math.floor(Math.random() * Math.min(3, clearCandidates.length));
            blocks.push(clearCandidates[idx].shape);
            usedIds[clearCandidates[idx].shape.id] = true;
        }

        const remaining = scored.filter(s => !usedIds[s.shape.id]);

        while (blocks.length < 3 && remaining.length > 0) {
            const totalWeight = remaining.reduce((sum, s) => sum + s.weight, 0);
            let rand = Math.random() * totalWeight;
            let selectedIdx = 0;

            for (let i = 0; i < remaining.length; i++) {
                rand -= remaining[i].weight;
                if (rand <= 0) {
                    selectedIdx = i;
                    break;
                }
            }

            blocks.push(remaining[selectedIdx].shape);
            usedIds[remaining[selectedIdx].shape.id] = true;
            remaining.splice(selectedIdx, 1);
        }

        for (let i = blocks.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
        }

        while (blocks.length < 3) {
            blocks.push(allShapes[Math.floor(Math.random() * allShapes.length)]);
        }

        return blocks.slice(0, 3);
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

            const canvas = document.createElement('canvas');
            canvas.width = block.width * CONFIG.CELL_SIZE;
            canvas.height = block.height * CONFIG.CELL_SIZE;
            const ctx = canvas.getContext('2d');

            for (let y = 0; y < block.height; y++) {
                for (let x = 0; x < block.width; x++) {
                    if (block.shape[y][x]) {
                        this.renderer.drawDockBlock(ctx, x, y, COLORS[block.colorIdx], CONFIG.CELL_SIZE);
                    }
                }
            }

            if (block.placed) {
                div.style.visibility = 'hidden';
            }

            const idx = i;
            const blk = block;
            const startDrag = (e) => {
                e.preventDefault();
                if (this.rlPreviewLocked || blk.placed || this.isAnimating || this.isGameOver) {
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
        const shapes = this.generateBlocks(strategyConfig);

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
        if (this.rlPreviewLocked) {
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
                    this.renderer.drawDockBlock(this.ghostCtx, x, y, COLORS[block.colorIdx], CONFIG.CELL_SIZE);
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
        if (this.rlPreviewLocked || !this.drag || !this.dragBlock || this.isAnimating) {
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
        if (this.rlPreviewLocked || !this.drag || !this.dragBlock || this.isAnimating) {
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
        this.renderer.setShake(8, 300);

        const wrapper = document.getElementById('game-wrapper');
        wrapper.classList.add('shake');
        setTimeout(() => wrapper.classList.remove('shake'), 300);

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

                self.dragBlock.placed = true;
                const dockBlock = document.querySelector(`.dock-block[data-index="${self.drag.index}"]`);
                if (dockBlock) dockBlock.style.visibility = 'hidden';

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
        this.renderer.clear();
        this.renderer.renderBackground();
        this.renderer.renderGrid(this.grid);
        if (this.previewPos && this.previewBlock) {
            this.renderer.renderPreview(this.previewPos.x, this.previewPos.y, this.previewBlock);
        }
        this.renderer.renderClearCells(this.renderer.clearCells);
        this.renderer.renderParticles();
    }

    render() {
        this.renderer.clear();
        this.renderer.renderBackground();
        this.renderer.renderGrid(this.grid);
        if (this.previewPos && this.previewBlock) {
            this.renderer.renderPreview(this.previewPos.x, this.previewPos.y, this.previewBlock);
        }
        this.renderer.renderParticles();
    }
}
