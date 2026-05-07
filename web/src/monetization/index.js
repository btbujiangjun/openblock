/**
 * 商业化插件主入口（按需加载版）
 * 
 * 使用（main.js 中仅需两行）：
 *   import { initMonetization } from './monetization/index.js';
 *   initMonetization(game);  // game 实例创建后调用
 *
 * 热插拔：
 *   import { shutdownMonetization } from './monetization/index.js';
 *   shutdownMonetization();
 */
import { attach, detach } from './MonetizationBus.js';
import { getFlag } from './featureFlags.js';
import { injectMonStyles } from './styles.js';

let _initialized = false;
let _cleanups = [];
let _lazyModules = {};

/**
 * 延迟加载模块清单（按需 import）
 *
 * 说明：每个模块都通过 feature flag 控制是否启用，避免无相关功能的玩家加载冗余代码。
 * 在 {@link initMonetization} 中按声明顺序串行/并行加载，未列出的模块走兜底的硬编码加载逻辑。
 */
const LAZY_MODULES = [
    { name: 'adAdapter', path: './adAdapter.js', flag: 'adsRewarded' },
    { name: 'adTrigger', path: './adTrigger.js', flag: 'adsInterstitial' },
    { name: 'dailyTasks', path: './dailyTasks.js', flag: 'dailyTasks' },
    { name: 'leaderboard', path: './leaderboard.js', flag: 'leaderboard' },
    { name: 'seasonPass', path: './seasonPass.js', flag: 'seasonPass' },
    { name: 'pushNotifications', path: './pushNotifications.js', flag: 'pushNotifications' },
    { name: 'replayShare', path: './replayShare.js', flag: 'replayShare' },
    { name: 'commercialInsight', path: './commercialInsight.js', flag: 'insightPanel' },
    { name: 'monPanel', path: './monPanel.js', flag: 'rlPanel' }
];

/**
 * 加载单个延迟模块（受 feature flag 控制）
 * @returns {Promise<object|null>} 模块对象；当 flag 未开启或 import 失败时返回 null
 */
async function _loadModule(moduleDef) {
    const { name, path, flag } = moduleDef;

    if (flag && !getFlag(flag)) {
        console.log(`[Monetization] Skipping ${name} (flag: ${flag} = false)`);
        return null;
    }

    try {
        const module = await import(path);
        _lazyModules[name] = module;
        return module;
    } catch (e) {
        console.warn(`[Monetization] Failed to load ${name}:`, e);
        return null;
    }
}

/**
 * 调用模块的初始化入口；优先匹配 `init<Name>`，回退到 `init`。
 * 部分模块需要 game 实例（如 adTrigger / commercialInsight），通过 needsGame 注入。
 */
async function _invokeInit(module, def, game) {
    if (!module) return;
    const candidateNames = [
        `init${def.name.charAt(0).toUpperCase()}${def.name.slice(1)}`,
        'init'
    ];
    const initFn = candidateNames.map(n => module[n]).find(f => typeof f === 'function');
    if (!initFn) return;

    const needsGame = ['adTrigger', 'commercialInsight'].includes(def.name);
    await (needsGame ? initFn(game) : initFn());

    if (typeof module.shutdown === 'function') {
        _cleanups.push(module.shutdown);
    }
}

/**
 * 初始化商业化插件系统
 * @param {object} game  Game 实例
 */
export async function initMonetization(game) {
    if (_initialized) return;
    _initialized = true;

    console.log('[Monetization] Initializing...');

    // 1. 注入 CSS（核心样式，静态导入避免抖动）
    injectMonStyles();

    // 2. 附加事件总线
    attach(game);

    // 3. 按 LAZY_MODULES 清单加载受 flag 控制的模块
    for (const def of LAZY_MODULES) {
        const module = await _loadModule(def);
        await _invokeInit(module, def, game);
    }

    // 4. 个性化引擎（延迟到主流程稳定后再连服务端）
    try {
        const personalization = await import('./personalization.js');
        const userId = game?.db?.userId ?? null;
        if (userId) {
            setTimeout(() => personalization.fetchPersonaFromServer(userId), 2000);
        }
    } catch (e) {
        console.warn('[Monetization] personalization unavailable:', e);
    }

    console.log('[Monetization] Initialized');
}

/**
 * 关闭商业化插件（热插拔）
 */
export function shutdownMonetization() {
    // 执行所有 cleanup
    for (const cleanup of _cleanups) {
        try {
            cleanup();
        } catch (e) {
            console.warn('[Monetization] Cleanup error:', e);
        }
    }
    _cleanups = [];
    
    // 分离事件总线
    detach();
    
    // 清理模块缓存
    _lazyModules = {};
    
    _initialized = false;
    console.log('[Monetization] Shutdown');
}

/**
 * 获取已加载模块
 */
export function getLoadedModules() {
    return { ..._lazyModules };
}