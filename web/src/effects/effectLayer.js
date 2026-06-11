/**
 * effectLayer.js — 视觉效果层（UI 解耦插件）
 *
 * 解决"UI 层耦合"问题：原 game.js 直接调用 renderer.triggerComboFlash/
 * setShake/triggerPerfectFlash 等，导致游戏逻辑与渲染紧密耦合。
 *
 * 设计原则
 * --------
 * - 事件驱动：game.js 通过 emit(event, data) 发布语义事件，不再直接调用渲染方法
 * - 解耦但不重写：EffectLayer 内部仍调用 renderer 的方法，只是将调用点集中在此
 * - 渐进迁移：game.js 中的 renderer.* 调用可逐步替换，存量代码正常工作
 * - 可插拔：不传 renderer 时所有 emit 静默忽略（测试、SSR 友好）
 * - 可扩展：新效果类型只需在 EffectLayer 内部添加 handler，game.js 无需改动
 *
 * 事件类型（Event Type）
 * ----------------------
 *   'clear'       消行触发: { cells, count, type: 'single'|'multi'|'combo'|'perfect' }
 *   'place'       落子触发: { shape, x, y }
 *   'combo'       连击触发: { streak }
 *   'game_over'   游戏结束: { score, clears }
 *   'revive'      复活触发: { clearedCells }
 *   'level_win'   关卡通关: { stars, score }
 *
 * game.js 集成示例（渐进替换，不破坏现有代码）
 * -----------------------------------------------
 *   // 初始化（initMonetization 之后）：
 *   import { EffectLayer } from './effects/effectLayer.js';
 *   const effects = new EffectLayer(game.renderer);
 *   game._effects = effects;
 *
 *   // 在落子逻辑中替换原有直接调用：
 *   // 原来：this.renderer.triggerComboFlash(count); this.renderer.setShake(11, 520);
 *   // 替换：this._effects?.emit('clear', { cells, count, type: 'combo' });
 */

export class EffectLayer {
    /**
     * @param {object|null} [renderer]  Renderer 实例（为 null 时静默模式）
     * @param {object} [opts]
     * @param {boolean} [opts.reducedMotion]  系统无障碍：减少动效
     */
    constructor(renderer = null, opts = {}) {
        this._renderer = renderer;
        this._reducedMotion = opts.reducedMotion ?? this._detectReducedMotion();
        /** @type {Map<string, Function[]>} 事件 → 处理器列表 */
        this._handlers = new Map();

        // 注册默认处理器
        this._registerDefaults();
    }

    // ------------------------------------------------------------------
    // 公开 API
    // ------------------------------------------------------------------

    /**
     * 发布效果事件（game.js 调用）
     * @param {string} event  事件名
     * @param {object} [data] 事件数据
     */
    emit(event, data = {}) {
        const handlers = this._handlers.get(event);
        if (!handlers) return;
        for (const fn of handlers) {
            try { fn(data); } catch (e) { console.warn('[EffectLayer]', event, e); }
        }
    }

    /**
     * 注册自定义事件处理器（覆盖或扩展默认行为）
     * @param {string}   event
     * @param {Function} handler
     */
    on(event, handler) {
        if (!this._handlers.has(event)) this._handlers.set(event, []);
        this._handlers.get(event).push(handler);
        return this;
    }

    /**
     * 移除某事件的所有自定义处理器（恢复默认）
     * @param {string} event
     */
    off(event) {
        this._handlers.delete(event);
        this._registerDefault(event);
        return this;
    }

    /** 更换 Renderer 实例（皮肤切换时用） */
    setRenderer(renderer) {
        this._renderer = renderer;
    }

    // ------------------------------------------------------------------
    // 内部：默认处理器注册
    // ------------------------------------------------------------------

    _registerDefaults() {
        this._registerDefault('clear');
        this._registerDefault('combo');
        this._registerDefault('place');
        this._registerDefault('revive');
        this._registerDefault('level_win');
        this._registerDefault('game_over');
    }

    _registerDefault(event) {
        // 移除旧处理器（如有）
        this._handlers.delete(event);
        const fn = this._defaultHandler(event);
        if (fn) this.on(event, fn);
    }

    _defaultHandler(event) {
        switch (event) {
            case 'clear': return (data) => this._onClear(data);
            case 'combo': return (data) => this._onCombo(data);
            case 'place': return (data) => this._onPlace(data);
            case 'revive': return (data) => this._onRevive(data);
            case 'level_win': return (data) => this._onLevelWin(data);
            case 'game_over': return (data) => this._onGameOver(data);
            default: return null;
        }
    }

    // ------------------------------------------------------------------
    // 默认效果实现
    // ------------------------------------------------------------------

    /**
     * 消行效果
     * @param {{ cells, count, type }} data
     */
    _onClear({ cells = [], count = 0, type = 'single' } = {}) {
        const r = this._renderer;
        if (!r) return;

        // 设置消行格子闪光
        if (typeof r.setClearCells === 'function') {
            r.setClearCells(cells);
        }

        if (this._reducedMotion) {
            // 无障碍：仅刷新，无抖动/粒子
            if (typeof r.render === 'function') r.render();
            return;
        }

        switch (type) {
            case 'perfect':
                r.triggerPerfectFlash?.();
                r.setShake?.(10, 600);
                break;
            case 'combo':
                r.triggerComboFlash?.(count);
                r.setShake?.(5, 350);
                break;
            case 'multi':
                r.triggerDoubleWave?.(cells.map(c => c.y).filter((v, i, a) => a.indexOf(v) === i));
                r.setShake?.(3, 280);
                break;
            default:
                r.setShake?.(2, 200);
                break;
        }
    }

    /**
     * 连击效果（独立于消行的连续消行奖励）
     * @param {{ streak }} data
     */
    _onCombo({ streak = 0 } = {}) {
        if (!this._renderer || streak < 2) return;
        // combo 强度随 streak 递增，上限 12
        const intensity = Math.min(streak * 1.5, 12);
        this._renderer.setShake?.(intensity, 300 + streak * 40);
    }

    /**
     * 落子效果（轻微反馈）
     * @param {{ x, y }} data
     */
    _onPlace({ x: _x, y: _y } = {}) {
        if (!this._renderer || this._reducedMotion) return;
        // 极小震动，给予触觉感
        this._renderer.setShake?.(1, 60);
    }

    /**
     * 复活效果（格子清除后的视觉反馈）
     * @param {{ clearedCells }} data
     */
    _onRevive({ clearedCells = [] } = {}) {
        if (!this._renderer) return;
        // 复活用柔和闪光代替剧烈抖动
        if (typeof this._renderer.setClearCells === 'function') {
            this._renderer.setClearCells(clearedCells);
        }
        this._renderer.setShake?.(2, 200);
    }

    /**
     * 关卡通关效果
     * @param {{ stars }} data
     */
    _onLevelWin({ stars = 1 } = {}) {
        if (!this._renderer || this._reducedMotion) return;
        this._renderer.triggerPerfectFlash?.();
        this._renderer.setShake?.(stars * 3, stars * 200);
    }

    _onGameOver() {}

    /**
     * 棋盘方块涌入：逐行从底到顶，每行空格的方块从盘面底部（候选区方向）飞入。
     * 方块先写入 grid 再重绘，通过逐行 offset 偏移实现"从下方滑入"的视觉。
     * @returns {Promise<void>}
     */
    boardFlood({ grid, palette, skin, gridSize } = {}) {
        const r = this._renderer;
        if (!r || !grid || !palette || this._reducedMotion) return Promise.resolve();

        const n = gridSize || r.gridSize || 8;
        const cs = r.cellSize || 38;
        const gold = '#FFD700';

        const gridEl = r.canvas;
        const dockEl = document.getElementById('dock');
        if (!gridEl || !dockEl) return Promise.resolve();

        const gridRect = gridEl.getBoundingClientRect();
        const dockRect = dockEl.getBoundingClientRect();
        const dockCenterX = dockRect.left + dockRect.width / 2;
        const dockCenterY = dockRect.top + dockRect.height / 2;

        const cssPxPerCell = gridRect.width / n;

        const rows = [];
        for (let gy = n - 1; gy >= 0; gy--) {
            const cells = [];
            for (let gx = 0; gx < n; gx++) {
                if (grid.cells[gy][gx] === null) {
                    const _sx = dockCenterX + (Math.random() - 0.5) * dockRect.width * 0.6;
                    cells.push({ gx, gy, colorIdx: Math.floor(Math.random() * palette.length), _sx });
                }
            }
            if (cells.length) rows.push({ cells, gy, startTime: 0, done: false });
        }
        if (!rows.length) {
            try { window.__audioFx?.play('bonus'); } catch { /* ignore */ }
            return new Promise((resolve) => {
                this._rowFlipWave(r, grid, n, cs, palette, skin, resolve);
            });
        }

        const overlay = document.createElement('canvas');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;pointer-events:none;z-index:8000';
        const dpr = window.devicePixelRatio || 1;
        overlay.width = Math.round(window.innerWidth * dpr);
        overlay.height = Math.round(window.innerHeight * dpr);
        const octx = overlay.getContext('2d');
        octx.scale(dpr, dpr);
        document.body.appendChild(overlay);

        const SLIDE_MS = 500;
        const ROW_DELAY = Math.min(140, 3000 / Math.max(rows.length, 1));
        const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

        return new Promise((resolve) => {
            const start = performance.now();
            let rowIdx = 0;
            let lastRowTime = start;
            let doneCount = 0;

            const tick = (now) => {
                if (rowIdx < rows.length && now - lastRowTime >= ROW_DELAY) {
                    const row = rows[rowIdx];
                    row.startTime = now;
                    rowIdx++;
                    lastRowTime = now;
                }

                for (let ri = 0; ri < rowIdx; ri++) {
                    const row = rows[ri];
                    if (row.done) continue;
                    const t = (now - row.startTime) / SLIDE_MS;
                    if (t >= 1 && !row.done) {
                        row.done = true;
                        doneCount++;
                        for (const c of row.cells) {
                            grid.cells[c.gy][c.gx] = c.colorIdx;
                        }
                        for (const c of row.cells) {
                            const cx = c.gx * cs + cs / 2;
                            const cy = c.gy * cs + cs / 2;
                            const color = palette[c.colorIdx] || gold;
                            for (let j = 0; j < 3; j++) {
                                const ang = Math.random() * Math.PI * 2;
                                const sp = 1.5 + Math.random() * 3;
                                r.particles.push({
                                    x: cx, y: cy,
                                    vx: Math.cos(ang) * sp,
                                    vy: Math.sin(ang) * sp - 2,
                                    color: j === 0 ? gold : color,
                                    life: 0.4 + Math.random() * 0.2,
                                    lifeDecay: 0.028,
                                    size: 1.5 + Math.random() * 2,
                                    gravityMul: 0.3,
                                });
                            }
                        }
                        try { r.renderGrid(grid); } catch { /* ignore */ }
                        try { window.__audioFx?.play('place'); } catch { /* ignore */ }
                    }
                }

                octx.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);

                const savedCtx = r.ctx;
                const savedCellSize = r.cellSize;
                r.ctx = octx;
                r.cellSize = cssPxPerCell;

                for (let ri = 0; ri < rowIdx; ri++) {
                    const row = rows[ri];
                    if (row.done) continue;
                    const t = (now - row.startTime) / SLIDE_MS;
                    const p = easeOutCubic(t);
                    for (const c of row.cells) {
                        const destX = gridRect.left + c.gx * cssPxPerCell;
                        const destY = gridRect.top + c.gy * cssPxPerCell;
                        const curX = c._sx + (destX - c._sx) * p;
                        const curY = dockCenterY + (destY - dockCenterY) * p;
                        const color = palette[c.colorIdx] || gold;
                        r.drawBlock(curX / cssPxPerCell, curY / cssPxPerCell, color, skin);
                    }
                }

                r.ctx = savedCtx;
                r.cellSize = savedCellSize;

                r.updateParticles?.();
                r.renderParticles?.();
                r.syncFxCanvasVisibility?.();

                const allDone = rowIdx >= rows.length && doneCount >= rows.length;
                if (!allDone) {
                    requestAnimationFrame(tick);
                } else {
                    overlay.remove();
                    try { r.renderGrid(grid); } catch { /* ignore */ }
                    try { window.__audioFx?.play('bonus'); } catch { /* ignore */ }
                    this._rowFlipWave(r, grid, n, cs, palette, skin, resolve);
                }
            };

            requestAnimationFrame(tick);
        });
    }

    _rowFlipWave(r, grid, n, cs, palette, skin, resolve) {
        const TOTAL_MS = 2000;
        const FLIP_MS = 300;
        const ROW_STAGGER = Math.min(180, (TOTAL_MS - FLIP_MS) / Math.max(n - 1, 1));
        const flipStart = performance.now();

        const newColors = [];
        for (let gy = 0; gy < n; gy++) {
            const row = [];
            for (let gx = 0; gx < n; gx++) {
                const cur = grid.cells[gy][gx];
                if (cur === null) { row.push(null); continue; }
                let nc;
                do { nc = Math.floor(Math.random() * palette.length); } while (nc === cur && palette.length > 1);
                row.push(nc);
            }
            newColors.push(row);
        }

        const flipped = new Array(n).fill(false);

        const flipTick = (now) => {
            const elapsed = now - flipStart;

            r.clear?.();
            r.renderBackground?.();

            const ctx = r.ctx;
            ctx.save();
            if (r.shakeOffset) ctx.translate(r.shakeOffset.x, r.shakeOffset.y);

            for (let gy = 0; gy < n; gy++) {
                const rowStart = gy * ROW_STAGGER;
                const t = Math.max(0, Math.min(1, (elapsed - rowStart) / FLIP_MS));

                if (t >= 1 && !flipped[gy]) {
                    flipped[gy] = true;
                    for (let gx = 0; gx < n; gx++) {
                        if (newColors[gy][gx] !== null) {
                            grid.cells[gy][gx] = newColors[gy][gx];
                        }
                    }
                    try { window.__audioFx?.play('tick'); } catch { /* ignore */ }
                }

                const scaleY = t < 0.5
                    ? 1 - t * 2
                    : (t - 0.5) * 2;

                const rowCenterY = gy * cs + cs / 2;

                for (let gx = 0; gx < n; gx++) {
                    const v = grid.cells[gy][gx];
                    if (v === null) continue;
                    const color = palette[v];
                    if (!color) continue;

                    ctx.save();
                    ctx.translate(gx * cs + cs / 2, rowCenterY);
                    ctx.scale(1, scaleY);
                    ctx.translate(-(gx * cs + cs / 2), -rowCenterY);
                    r.drawBlock(gx, gy, color, skin);
                    ctx.restore();
                }
            }

            ctx.restore();

            r.updateParticles?.();
            r.renderParticles?.();
            r.syncFxCanvasVisibility?.();

            const allFlipped = elapsed >= (n - 1) * ROW_STAGGER + FLIP_MS;
            if (!allFlipped) {
                requestAnimationFrame(flipTick);
            } else {
                try { r.renderGrid(grid); } catch { /* ignore */ }
                resolve();
            }
        };
        requestAnimationFrame(flipTick);
    }

    // ------------------------------------------------------------------
    // 工具
    // ------------------------------------------------------------------

    _detectReducedMotion() {
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    }
}

/** 工厂函数：创建并绑定到 game 实例（供 main.js 使用）
 * @param {object} game  Game 实例
 * @returns {EffectLayer}
 */
export function createEffectLayer(game) {
    const layer = new EffectLayer(game.renderer);
    game._effects = layer;
    return layer;
}
