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
                r.setShake?.(16, 720);
                break;
            case 'combo':
                r.triggerComboFlash?.(count);
                r.setShake?.(11, 520);
                break;
            case 'multi':
                r.triggerDoubleWave?.(cells.map(c => c.y).filter((v, i, a) => a.indexOf(v) === i));
                r.setShake?.(8, 400);
                break;
            default:
                r.setShake?.(5, 280);
                break;
        }
    }

    /**
     * 连击效果（独立于消行的连续消行奖励）
     * @param {{ streak }} data
     */
    _onCombo({ streak = 0 } = {}) {
        if (!this._renderer || streak < 2) return;
        // combo 强度随 streak 递增，上限 20
        const intensity = Math.min(streak * 3, 20);
        this._renderer.setShake?.(intensity, 300 + streak * 50);
    }

    /**
     * 落子效果（轻微反馈）
     * @param {{ x, y }} data
     */
    _onPlace({ x, y } = {}) {
        if (!this._renderer || this._reducedMotion) return;
        // 极小震动，给予触觉感
        this._renderer.setShake?.(2, 80);
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
        this._renderer.setShake?.(4, 300);
    }

    /**
     * 关卡通关效果
     * @param {{ stars }} data
     */
    _onLevelWin({ stars = 1 } = {}) {
        if (!this._renderer || this._reducedMotion) return;
        this._renderer.triggerPerfectFlash?.();
        this._renderer.setShake?.(stars * 6, stars * 300);
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
