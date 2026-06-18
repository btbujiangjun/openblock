/* 自动生成 —— 请勿手改。源：web/src/monetization/MonetizationBus.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * 商业化事件总线（MonetizationBus）
 *
 * 核心设计：
 *   - 通过包装 game.logBehavior 实例方法（非修改 class 源码）来拦截游戏事件
 *   - 所有商业化模块订阅此总线，游戏代码无感知
 *   - 支持 attach / detach 实现热插拔
 *
 * 可观测性（v1.71 引入）：
 *   - 每事件类型计数 + 每 handler 失败计数（含连续失败窗口）
 *   - handler 连续失败 ≥ HANDLER_CIRCUIT_THRESHOLD 次：熔断，本会话不再调用，
 *     避免单个坏模块持续污染日志或阻塞 logBehavior 主路径
 *   - 失败用 lib/logger.js 上报（受 game_rules.logging 控制等级），不再用裸 console
 *   - getStats() 暴露快照，便于 debug overlay / 单测断言
 *
 * 使用：
 *   import { bus } from './MonetizationBus.mjs';
 *   bus.on('game_over', ({ data, game }) => { ... });
 *   bus.attach(game);
 */

import { createLogger } from '../lib/logger.mjs';

const log = createLogger('monBus');
const _handlers = new Map(); // eventType → Set<Function>
let _game = null;
let _origLogBehavior = null;

/* 可观测性状态（per process，不持久化；reset 走 _clearAllHandlers） */
const HANDLER_CIRCUIT_THRESHOLD = 5;    // 连续失败 N 次后熔断
const _eventCounts = new Map();          // eventType → emit 次数
const _handlerFailCounts = new WeakMap();// handler → 总失败数
const _handlerConsecutiveFail = new WeakMap(); // handler → 连续失败数（成功即清零）
const _circuitOpenHandlers = new WeakSet();    // 熔断的 handler 集合

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
 * 不抛错；任何 handler 失败被隔离，不影响其他 handler / 主路径 logBehavior。
 *
 * @param {string} eventType
 * @param {object} data
 */
export function emit(eventType, data = {}) {
    _eventCounts.set(eventType, (_eventCounts.get(eventType) || 0) + 1);
    const set = _handlers.get(eventType);
    if (!set) return;
    for (const h of set) {
        if (_circuitOpenHandlers.has(h)) continue; // 熔断
        try {
            h({ data, game: _game });
            /* 成功：清零连续失败计数 */
            if (_handlerConsecutiveFail.has(h)) _handlerConsecutiveFail.set(h, 0);
        } catch (e) {
            const totalFails = (_handlerFailCounts.get(h) || 0) + 1;
            const consecFails = (_handlerConsecutiveFail.get(h) || 0) + 1;
            _handlerFailCounts.set(h, totalFails);
            _handlerConsecutiveFail.set(h, consecFails);
            log.error('handler failed', { eventType, totalFails, consecFails }, e);
            if (consecFails >= HANDLER_CIRCUIT_THRESHOLD) {
                _circuitOpenHandlers.add(h);
                log.warn('handler circuit OPEN', { eventType, consecFails });
            }
        }
    }
}

/**
 * 可观测性快照：emit 计数 / 当前订阅 handler 数 / 熔断数。
 * 个别 handler 的失败计数因 WeakMap 不可遍历不直接暴露；模块自检若需要细节，
 * 可在 on() 时记录引用并自查 getHandlerFailCount(h)。
 */
export function getStats() {
    let totalHandlers = 0;
    let circuitOpenCount = 0;
    for (const set of _handlers.values()) {
        for (const h of set) {
            totalHandlers++;
            if (_circuitOpenHandlers.has(h)) circuitOpenCount++;
        }
    }
    return {
        events: Object.fromEntries(_eventCounts),
        eventTypes: _handlers.size,
        totalHandlers,
        circuitOpenCount,
    };
}

/**
 * 查询单个 handler 的失败计数（debug 用）。
 * @returns {{ total: number, consecutive: number, circuitOpen: boolean }}
 */
export function getHandlerFailCount(handler) {
    return {
        total: _handlerFailCounts.get(handler) || 0,
        consecutive: _handlerConsecutiveFail.get(handler) || 0,
        circuitOpen: _circuitOpenHandlers.has(handler),
    };
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
 * 测试专用：清空所有已注册的事件处理器（不影响 attach 状态）+ 清空可观测性状态。
 * WeakMap/WeakSet 内容会随 handler 引用被 GC 而消失，无法手动遍历清理；
 * 但因为 _handlers 清空后旧 handler 通常会被 GC，状态会随之失效。
 */
export function _clearAllHandlers() {
    _handlers.clear();
    _eventCounts.clear();
}

export default { on, off, emit, attach, detach, getGame, getStats, getHandlerFailCount, _clearAllHandlers };
