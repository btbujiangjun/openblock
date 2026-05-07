/**
 * ModuleLazyLoader - 模块按需加载器
 * 实现商业化模块的 Code Splitting
 */
const _moduleCache = new Map();
const _loadingPromises = new Map();

/**
 * 按需加载模块
 * @param {string} modulePath 模块路径
 * @returns {Promise<object>} 模块导出
 */
export async function lazyLoadModule(modulePath) {
    // 检查缓存
    if (_moduleCache.has(modulePath)) {
        return _moduleCache.get(modulePath);
    }
    
    // 检查正在加载中
    if (_loadingPromises.has(modulePath)) {
        return _loadingPromises.get(modulePath);
    }
    
    // 开始加载
    const loadPromise = import(modulePath).then(module => {
        _moduleCache.set(modulePath, module);
        _loadingPromises.delete(modulePath);
        console.log('[LazyLoad] Loaded:', modulePath);
        return module;
    }).catch(err => {
        console.error('[LazyLoad] Failed to load:', modulePath, err);
        _loadingPromises.delete(modulePath);
        throw err;
    });
    
    _loadingPromises.set(modulePath, loadPromise);
    return loadPromise;
}

/**
 * 预加载模块（不阻塞）
 * @param {string[]} modulePaths 模块路径数组
 */
export function preloadModules(modulePaths) {
    for (const path of modulePaths) {
        if (!_moduleCache.has(path) && !_loadingPromises.has(path)) {
            lazyLoadModule(path).catch(() => {}); // 不阻塞
        }
    }
}

/**
 * 商业化模块映射
 */
export const MONETIZATION_MODULES = {
    // 广告模块
    adAdapter: './monetization/adAdapter.js',
    adDecisionEngine: './monetization/ad/adDecisionEngine.js',
    adTrigger: './monetization/adTrigger.js',
    
    // IAP 模块
    iapAdapter: './monetization/iapAdapter.js',
    
    // 社交模块
    leaderboard: './monetization/leaderboard.js',
    replayShare: './monetization/replayShare.js',
    
    // 运营模块
    dailyTasks: './monetization/dailyTasks.js',
    seasonPass: './monetization/seasonPass.js',
    checkInPanel: './checkin/checkInPanel.js',
    
    // 高级功能
    commercialModel: './monetization/commercialModel.js',
    playerAbilityModel: './playerAbilityModel.js',
    pushNotifications: './monetization/pushNotifications.js'
};

/**
 * 场景化模块加载策略
 */
export const SCENE_LOAD_STRATEGY = {
    // 游戏结束时加载
    game_over: [
        'leaderboard',
        'replayShare',
        'seasonPass'
    ],
    
    // 商店场景
    shop: [
        'iapAdapter'
    ],
    
    // 主菜单
    main_menu: [
        'checkInPanel',
        'dailyTasks'
    ],
    
    // 设置页面
    settings: [
        'pushNotifications'
    ]
};

/**
 * 根据场景加载相关模块
 * @param {string} scene 场景名称
 * @returns {Promise<object>} 加载的模块映射
 */
export async function loadModulesForScene(scene) {
    const modules = SCENE_LOAD_STRATEGY[scene] || [];
    const results = {};
    
    await Promise.all(
        modules.map(async (name) => {
            const path = MONETIZATION_MODULES[name];
            if (path) {
                try {
                    results[name] = await lazyLoadModule(path);
                } catch (e) {
                    console.warn('[LazyLoad] Scene module load failed:', name, e);
                }
            }
        })
    );
    
    return results;
}

/**
 * 获取模块缓存状态
 */
export function getModuleStats() {
    return {
        cached: _moduleCache.size,
        loading: _loadingPromises.size,
        total: MONETIZATION_MODULES.size
    };
}

/**
 * 清理模块缓存
 */
export function clearModuleCache() {
    _moduleCache.clear();
    console.log('[LazyLoad] Cache cleared');
}