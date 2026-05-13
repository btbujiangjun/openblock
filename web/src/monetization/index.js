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
// progression / skinUnlock 通过 dynamic import 在 init 内引入，避免顶层循环依赖

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
    { name: 'adAdapter', loader: () => import('./adAdapter.js'), flag: 'adsRewarded' },
    { name: 'adTrigger', loader: () => import('./adTrigger.js'), flag: 'adsInterstitial' },
    { name: 'dailyTasks', loader: () => import('./dailyTasks.js'), flag: 'dailyTasks' },
    { name: 'leaderboard', loader: () => import('./leaderboard.js'), flag: 'leaderboard' },
    { name: 'seasonPass', loader: () => import('./seasonPass.js'), flag: 'seasonPass' },
    { name: 'pushNotifications', loader: () => import('./pushNotifications.js'), flag: 'pushNotifications' },
    { name: 'replayShare', loader: () => import('./replayShare.js'), flag: 'replayShare' },
    { name: 'commercialInsight', loader: () => import('./commercialInsight.js'), flag: 'insightPanel' },
    { name: 'monPanel', loader: () => import('./monPanel.js'), flag: 'rlPanel' }
];

/**
 * 加载单个延迟模块（受 feature flag 控制）
 * @returns {Promise<object|null>} 模块对象；当 flag 未开启或 import 失败时返回 null
 */
async function _loadModule(moduleDef) {
    const { name, loader, flag } = moduleDef;

    if (flag && !getFlag(flag)) {
        console.log(`[Monetization] Skipping ${name} (flag: ${flag} = false)`);
        return null;
    }

    try {
        // 直接调用 loader()，Vite 能够静态分析这里的 import()
        const module = await loader();
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

    /* 5. v1.48：生命周期感知商业化层 —— 订阅 lifecycle:session_start/end，把
     *    firstPurchaseFunnel / vipSystem 等"已实装但孤立"的模块接到主流程。
     *    与 commercialModel 的实时报价决策互补：前者管"现在能不能弹"，
     *    后者管"会话结束后该不该送优惠券 / 累计 VIP 分"。 */
    try {
        const lifecycleAware = await import('./lifecycleAwareOffers.js');
        const detach = lifecycleAware.attachLifecycleAwareOffers();
        if (typeof detach === 'function') _cleanups.push(detach);
    } catch (e) {
        console.warn('[Monetization] lifecycleAwareOffers unavailable:', e);
    }

    /* 6. v1.49.x P0-7：lifecycle 事件 → UI Toast 接线。
     *    lifecycleAwareOffers emit 的 `lifecycle:offer_available` /
     *    `lifecycle:first_purchase` / `lifecycle:churn_high` 之前没有任何 UI 订阅方，
     *    玩家完全感知不到回流券 / 首充祝贺；offerToast 是最小可行 UI 接线。 */
    try {
        const offerToast = await import('./offerToast.js');
        const detach = offerToast.attachOfferToast();
        if (typeof detach === 'function') _cleanups.push(detach);
    } catch (e) {
        console.warn('[Monetization] offerToast unavailable:', e);
    }

    /* 7a. v1.49.x P2-2：lifecycle 事件 → push/share/invite 孤儿模块接线。
     *     之前 pushNotificationSystem / shareCardGenerator 全仓 0 调用，
     *     这里在 lifecycle:churn_high / first_purchase / offer_available 时触发，
     *     把"已实装但孤立"的运营能力真正用起来。 */
    try {
        const outreach = await import('./lifecycleOutreach.js');
        const detach = outreach.attachLifecycleOutreach();
        if (typeof detach === 'function') _cleanups.push(detach);
    } catch (e) {
        console.warn('[Monetization] lifecycleOutreach unavailable:', e);
    }

    /* 6b. v1.49.x 算法层 P0-3：actionOutcomeMatrix 总线接线。
     *     监听 purchase_completed / ad_complete / lifecycle:session_end 自动累积
     *     "推荐 action × 实际 outcome"矩阵，看板调 getMatrix() 拿数据。
     *     默认 on（feature flag `actionOutcomeMatrix`）。 */
    if (getFlag('actionOutcomeMatrix')) {
        try {
            const aom = await import('./quality/actionOutcomeMatrix.js');
            const detach = aom.attachActionOutcomeMatrix();
            if (typeof detach === 'function') _cleanups.push(detach);
        } catch (e) {
            console.warn('[Monetization] actionOutcomeMatrix unavailable:', e);
        }
    }

    /* 7. v1.49.x P1-5：把 progression.isSkinUnlocked 委托给 monetization/skinUnlock。
     *    历史问题：progression.isSkinUnlocked() 始终 return true，
     *    monetization/skinUnlock.isSkinUnlocked() 已实现完整解锁逻辑但从未生效。
     *    这里通过反向控制（progression.setSkinUnlockProvider）打通。
     *    feature flag `skinUnlockBridge` 控制是否启用（默认 on）。 */
    if (getFlag('skinUnlockBridge')) {
        try {
            const skinUnlock = await import('./skinUnlock.js');
            const progression = await import('../progression.js');
            progression.setSkinUnlockProvider(skinUnlock.isSkinUnlocked);
            _cleanups.push(() => progression.resetSkinUnlockProvider());
        } catch (e) {
            console.warn('[Monetization] skinUnlock bridge unavailable:', e);
        }
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
function _getLoadedModules() {
    return { ..._lazyModules };
}
