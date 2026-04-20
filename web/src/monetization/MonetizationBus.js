/**
 * 商业化事件总线（MonetizationBus）
 *
 * 核心设计：
 *   - 通过包装 game.logBehavior 实例方法（非修改 class 源码）来拦截游戏事件
 *   - 所有商业化模块订阅此总线，游戏代码无感知
 *   - 支持 attach / detach 实现热插拔
 *
 * 使用：
 *   import { bus } from './MonetizationBus.js';
 *   bus.on('game_over', ({ data, game }) => { ... });
 *   bus.attach(game);   // 在 game 实例创建后调用
 */

const _handlers = new Map(); // eventType → Set<Function>
let _game = null;
let _origLogBehavior = null;

/**
 * 订阅游戏事件
 * @param {string} eventType
 * @param {(payload: { data: object, game: object }) => void} handler
 * @returns {() => void} unsubscribe function
 */
export function on(eventType, handler) {
    if (!_handlers.has(eventType)) {
        _handlers.set(eventType, new Set());
    }
    _handlers.get(eventType).add(handler);
    return () => off(eventType, handler);
}

/**
 * 取消订阅
 */
export function off(eventType, handler) {
    _handlers.get(eventType)?.delete(handler);
}

/**
 * 广播（供内部模块互发事件）
 * @param {string} eventType
 * @param {object} data
 */
export function emit(eventType, data = {}) {
    const set = _handlers.get(eventType);
    if (!set) return;
    for (const h of set) {
        try { h({ data, game: _game }); } catch (e) { console.error('[MonBus]', eventType, e); }
    }
}

/**
 * 将总线附加到 game 实例：包装 logBehavior 方法（非侵入 class 源码）
 * @param {object} game
 */
export function attach(game) {
    if (_game === game) return; // 避免重复附加
    detach();
    _game = game;
    // 保存原始函数引用（不 bind，以保持 === 相等性，detach 时可精确恢复）
    _origLogBehavior = game.logBehavior ?? null;

    game.logBehavior = (eventType, data) => {
        // 原始逻辑不变（使用 .call 保持 this 上下文）
        _origLogBehavior?.call(game, eventType, data);
        // 广播到商业化总线
        emit(eventType, data ?? {});
    };
}

/**
 * 从 game 实例卸载（恢复原始方法）
 */
export function detach() {
    if (_game && _origLogBehavior) {
        _game.logBehavior = _origLogBehavior;
    }
    _game = null;
    _origLogBehavior = null;
}

/**
 * 当前附加的 game 实例（只读引用，供模块读取游戏状态）
 */
export function getGame() {
    return _game;
}

/**
 * 测试专用：清空所有已注册的事件处理器（不影响 attach 状态）
 */
export function _clearAllHandlers() {
    _handlers.clear();
}

export default { on, off, emit, attach, detach, getGame, _clearAllHandlers };
