/**
 * RemoteConfigManager - 远程配置与 Feature Flags 管理
 * 
 * 功能：
 * 1. 远程配置下发
 * 2. Feature Flags 控制
 * 3. 配置版本管理
 * 4. 灰度发布
 */
/* v1.49.x P0-5：原 import 写成 './cohortManager.js'，但这俩函数实际定义在
 * '../config.js'（cohortManager 仅消费它们、不再 re-export）。结果：
 *   - import 解析为 undefined → fetchRemoteConfig 内 fetch(`${undefined}/...`) 报错
 *   - 整个 RemoteConfig.init() 被异常吞掉，DEFAULT_CONFIG 永远生效
 *   - 配套的 ExperimentPlatform.initRemoteConfig() 静默失败 → A/B 配置永挂初始值
 * 修正后远程配置通道才能在 initExperimentPlatform 接入时真正打通（P2 阶段）。 */
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';

const CONFIG_STORAGE_KEY = 'openblock_remote_config_v1';

/**
 * 默认配置
 */
const DEFAULT_CONFIG = {
    version: '1.0.0',
    lastUpdated: 0,
    features: {
        adsRewarded: true,
        adsInterstitial: true,
        iap: true,
        dailyTasks: true,
        leaderboard: true,
        seasonPass: true,
        pushNotifications: false,
        replayShare: true,
        insightPanel: true,
        rlPanel: true,
        newSkinUnlock: true,
        inviteSystem: true
    },
    monetization: {
        adFrequency: {
            rewardedPerGame: 3,
            interstitialPerGame: 1,
            minInterval: 60
        },
        iapPrices: {
            removeAds: 18,
            hintPack: 6,
            weeklyPass: 12,
            monthlyPass: 28,
            annualPass: 88
        },
        firstPurchaseDiscount: 50
    },
    difficulty: {
        defaultStrategy: 'normal',
        adaptiveEnabled: true
    },
    content: {
        newSkinsEnabled: true,
        seasonalEventsEnabled: true
    }
};

/**
 * Feature Flag 定义
 */
export const FEATURE_FLAGS = {
    ADS_REWARDED: 'adsRewarded',
    ADS_INTERSTITIAL: 'adsInterstitial',
    IAP: 'iap',
    DAILY_TASKS: 'dailyTasks',
    LEADERBOARD: 'leaderboard',
    SEASON_PASS: 'seasonPass',
    PUSH_NOTIFICATIONS: 'pushNotifications',
    REPLAY_SHARE: 'replayShare',
    INSIGHT_PANEL: 'insightPanel',
    RL_PANEL: 'rlPanel',
    NEW_SKIN_UNLOCK: 'newSkinUnlock',
    INVITE_SYSTEM: 'inviteSystem'
};

class RemoteConfigManager {
    constructor() {
        this._config = { ...DEFAULT_CONFIG };
        this._localOverrides = {};
        this._listeners = [];
        this._pollingTimer = null;
    }

    /**
     * 初始化
     */
    async init() {
        this._loadLocalConfig();
        await this._fetchRemoteConfig();
        this._startPolling();
        console.log('[RemoteConfig] Initialized, version:', this._config.version);
    }

    /**
     * 加载本地配置
     */
    _loadLocalConfig() {
        try {
            const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                this._config = { ...DEFAULT_CONFIG, ...data.config };
                this._localOverrides = data.overrides || {};
            }
        } catch {}
    }

    /**
     * 保存本地配置
     */
    _saveLocalConfig() {
        try {
            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({
                config: this._config,
                overrides: this._localOverrides,
                lastSaved: Date.now()
            }));
        } catch {}
    }

    /**
     * 获取远程配置
     */
    async _fetchRemoteConfig() {
        if (!isSqliteClientDatabase()) {
            console.log('[RemoteConfig] Using local config (no server)');
            return;
        }
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            const response = await fetch(`${base}/api/config?version=${this._config.version}`);
            
            if (response.ok) {
                const data = await response.json();
                
                if (data.config && data.version !== this._config.version) {
                    this._config = { ...this._config, ...data.config };
                    this._saveLocalConfig();
                    
                    this._notifyListeners('config_updated', this._config);
                    console.log('[RemoteConfig] Updated to version:', this._config.version);
                }
            }
        } catch (e) {
            console.log('[RemoteConfig] Remote fetch failed:', e.message);
        }
    }

    /**
     * 启动配置轮询（每 5 分钟）
     */
    _startPolling() {
        this._pollingTimer = setInterval(() => {
            this._fetchRemoteConfig();
        }, 5 * 60 * 1000);
    }

    /**
     * 停止轮询
     */
    stopPolling() {
        if (this._pollingTimer) {
            clearInterval(this._pollingTimer);
            this._pollingTimer = null;
        }
    }

    /**
     * 获取 Feature Flag
     */
    getFeatureFlag(flagName) {
        // 优先使用本地覆盖
        if (this._localOverrides[flagName] !== undefined) {
            return this._localOverrides[flagName];
        }
        
        // 返回配置中的值
        return this._config.features[flagName] ?? false;
    }

    /**
     * 设置 Feature Flag（本地覆盖）
     */
    setFeatureFlag(flagName, value) {
        this._localOverrides[flagName] = value;
        this._saveLocalConfig();
        
        this._notifyListeners('flag_changed', { flag: flagName, value });
        console.log('[RemoteConfig] Flag overridden:', flagName, '=', value);
    }

    /**
     * 重置 Feature Flag
     */
    resetFeatureFlag(flagName) {
        delete this._localOverrides[flagName];
        this._saveLocalConfig();
    }

    /**
     * 获取所有 Feature Flags
     */
    getAllFeatureFlags() {
        const flags = { ...this._config.features };
        
        for (const [key, value] of Object.entries(this._localOverrides)) {
            flags[key] = value;
        }
        
        return flags;
    }

    /**
     * 获取配置项
     */
    getConfig(path) {
        const keys = path.split('.');
        let value = this._config;
        
        for (const key of keys) {
            if (value && typeof value === 'object') {
                value = value[key];
            } else {
                return undefined;
            }
        }
        
        return value;
    }

    /**
     * 设置配置项（本地覆盖）
     */
    setConfig(path, value) {
        const keys = path.split('.');
        let target = this._localOverrides;
        
        for (let i = 0; i < keys.length - 1; i++) {
            if (!target[keys[i]]) {
                target[keys[i]] = {};
            }
            target = target[keys[i]];
        }
        
        target[keys[keys.length - 1]] = value;
        this._saveLocalConfig();
        
        this._notifyListeners('config_changed', { path, value });
    }

    /**
     * 获取配置版本
     */
    getVersion() {
        return this._config.version;
    }

    /**
     * 检查更新
     */
    async checkForUpdates() {
        await this._fetchRemoteConfig();
        
        // 检查强制更新
        const minVersion = this._config.minAppVersion;
        if (minVersion) {
            const currentVersion = this._config.appVersion || '1.0.0';
            if (this._compareVersions(currentVersion, minVersion) < 0) {
                return {
                    updateAvailable: true,
                    required: true,
                    minVersion
                };
            }
        }
        
        return {
            updateAvailable: false
        };
    }

    /**
     * 比较版本
     */
    _compareVersions(v1, v2) {
        const parts1 = v1.split('.').map(Number);
        const parts2 = v2.split('.').map(Number);
        
        for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
            const p1 = parts1[i] || 0;
            const p2 = parts2[i] || 0;
            
            if (p1 > p2) return 1;
            if (p1 < p2) return -1;
        }
        
        return 0;
    }

    /**
     * 灰度发布检查
     */
    isInRollout(featureName, userId) {
        const rollout = this._config.rollout?.[featureName];
        
        if (!rollout || rollout.percentage === 100) {
            return true;
        }
        
        if (rollout.percentage === 0) {
            return false;
        }
        
        // 基于用户 ID 的一致性哈希
        const hash = this._hashUserId(userId, featureName);
        return (hash % 100) < rollout.percentage;
    }

    /**
     * 用户 ID 哈希
     */
    _hashUserId(userId, salt) {
        const str = `${userId}:${salt}`;
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    /**
     * 注册监听
     */
    addListener(callback) {
        this._listeners.push(callback);
        return () => {
            const idx = this._listeners.indexOf(callback);
            if (idx >= 0) this._listeners.splice(idx, 1);
        };
    }

    /**
     * 通知监听器
     */
    _notifyListeners(event, data) {
        for (const callback of this._listeners) {
            try {
                callback(event, data);
            } catch (e) {
                console.warn('[RemoteConfig] Listener error:', e);
            }
        }
    }

    /**
     * 获取完整配置
     */
    getFullConfig() {
        return { ...this._config };
    }

    /**
     * 获取状态
     */
    getStatus() {
        return {
            version: this._config.version,
            features: this.getAllFeatureFlags(),
            overrides: { ...this._localOverrides },
            lastUpdated: this._config.lastUpdated
        };
    }

    /**
     * 重置所有覆盖
     */
    resetAllOverrides() {
        this._localOverrides = {};
        this._saveLocalConfig();
        console.log('[RemoteConfig] All overrides reset');
    }
}

let _configInstance = null;
export function getRemoteConfigManager() {
    if (!_configInstance) {
        _configInstance = new RemoteConfigManager();
    }
    return _configInstance;
}

export async function initRemoteConfig() {
    await getRemoteConfigManager().init();
}