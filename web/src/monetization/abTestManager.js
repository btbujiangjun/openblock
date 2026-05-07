/**
 * ABTestManager - A/B 测试框架
 * 
 * 功能：
 * 1. 用户分组
 * 2. 实验配置
 * 3. 指标追踪
 * 4. 远程配置下发
 */
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';

const STORAGE_KEY = 'openblock_ab_test_v1';

/**
 * 内置实验配置
 */
export const BUILT_IN_EXPERIMENTS = {
    // 广告展示频率实验
    ad_frequency: {
        id: 'ad_frequency',
        name: '广告展示频率',
        description: '测试不同广告频率对收入的影响',
        variants: {
            control: { weight: 33, label: '对照组', config: { rewardedPerDay: 12, interstitialPerDay: 6 } },
            low: { weight: 33, label: '低频', config: { rewardedPerDay: 8, interstitialPerDay: 4 } },
            high: { weight: 34, label: '高频', config: { rewardedPerDay: 16, interstitialPerDay: 8 } }
        },
        defaultVariant: 'control',
        metrics: ['adRevenue', 'arpu', 'retention_d1', 'retention_d7']
    },
    
    // 难度曲线实验
    difficulty_curve: {
        id: 'difficulty_curve',
        name: '难度曲线',
        description: '测试不同难度曲线对留存的影响',
        variants: {
            control: { weight: 50, label: '标准', config: { difficulty: 'normal' } },
            easier: { weight: 25, label: '简单', config: { difficulty: 'easy' } },
            harder: { weight: 25, label: '困难', config: { difficulty: 'hard' } }
        },
        defaultVariant: 'control',
        metrics: ['sessionLength', 'retention_d1', 'retention_d7', 'score']
    },
    
    // 首充优惠实验
    first_purchase_offer: {
        id: 'first_purchase_offer',
        name: '首充优惠',
        description: '测试不同首充优惠力度',
        variants: {
            control: { weight: 50, label: '5折', config: { discount: 50, bonus: 3 } },
            high: { weight: 50, label: '3折', config: { discount: 70, bonus: 5 } }
        },
        defaultVariant: 'control',
        metrics: ['conversionRate', 'arpu', 'revenue']
    },
    
    // 签到奖励实验
    checkin_rewards: {
        id: 'checkin_rewards',
        name: '签到奖励',
        description: '测试不同签到奖励对活跃的影响',
        variants: {
            control: { weight: 50, label: '标准', config: { bonus: 1.0 } },
            generous: { weight: 50, label: '丰厚', config: { bonus: 1.5 } }
        },
        defaultVariant: 'control',
        metrics: ['dau', 'retention_d7', 'checkinRate']
    },
    
    // 皮肤解锁实验
    skin_unlock: {
        id: 'skin_unlock',
        name: '皮肤解锁',
        description: '测试不同皮肤解锁难度',
        variants: {
            control: { weight: 50, label: '标准', config: { levelRequired: 10 } },
            easy: { weight: 50, label: '简单', config: { levelRequired: 5 } }
        },
        defaultVariant: 'control',
        metrics: ['skinUsage', 'retention_d7', 'monetization']
    }
};

/**
 * 用户分桶算法
 */
function hashUser(userId, experimentId, salt = '') {
    const str = `${userId}:${experimentId}:${salt}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

class ABTestManager {
    constructor() {
        this._experiments = { ...BUILT_IN_EXPERIMENTS };
        this._userVariantCache = {};
        this._metrics = {};
        this._remoteConfig = null;
        this._initialized = false;
    }

    /**
     * 初始化
     */
    async init(userId) {
        this._userId = userId;
        this._loadVariantCache();
        
        // 尝试从远程获取实验配置
        await this._fetchRemoteConfig();
        
        this._initialized = true;
        console.log('[ABTest] Initialized for user:', userId);
    }

    /**
     * 从远程获取实验配置
     */
    async _fetchRemoteConfig() {
        if (!isSqliteClientDatabase()) return;
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            const response = await fetch(`${base}/api/ab-tests?user_id=${this._userId}`);
            if (response.ok) {
                const data = await response.json();
                // 合并远程配置
                if (data.experiments) {
                    for (const [id, config] of Object.entries(data.experiments)) {
                        if (config.enabled !== false) {
                            this._experiments[id] = { ...this._experiments[id], ...config };
                        }
                    }
                }
                this._remoteConfig = data;
                console.log('[ABTest] Remote config loaded');
            }
        } catch (e) {
            console.log('[ABTest] Remote config not available:', e.message);
        }
    }

    /**
     * 加载变体缓存
     */
    _loadVariantCache() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                this._userVariantCache = JSON.parse(stored);
            }
        } catch {}
    }

    /**
     * 保存变体缓存
     */
    _saveVariantCache() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._userVariantCache));
        } catch {}
    }

    /**
     * 获取用户的实验变体
     */
    getVariant(experimentId) {
        if (!this._initialized) {
            console.warn('[ABTest] Not initialized');
            return null;
        }
        
        const experiment = this._experiments[experimentId];
        if (!experiment) {
            console.warn('[ABTest] Unknown experiment:', experimentId);
            return null;
        }
        
        // 检查缓存
        if (this._userVariantCache[experimentId]) {
            return this._userVariantCache[experimentId];
        }
        
        // 计算分桶
        const hash = hashUser(this._userId, experimentId);
        const totalWeight = Object.values(experiment.variants).reduce((sum, v) => sum + v.weight, 0);
        let currentWeight = hash % totalWeight;
        
        let selectedVariant = experiment.defaultVariant;
        for (const [variantId, variant] of Object.entries(experiment.variants)) {
            currentWeight -= variant.weight;
            if (currentWeight <= 0) {
                selectedVariant = variantId;
                break;
            }
        }
        
        // 缓存结果
        this._userVariantCache[experimentId] = {
            variant: selectedVariant,
            config: experiment.variants[selectedVariant].config,
            label: experiment.variants[selectedVariant].label
        };
        this._saveVariantCache();
        
        console.log('[ABTest] Assigned variant:', experimentId, '=', selectedVariant);
        return this._userVariantCache[experimentId];
    }

    /**
     * 获取实验配置
     */
    getExperimentConfig(experimentId) {
        const variant = this.getVariant(experimentId);
        return variant?.config || null;
    }

    /**
     * 记录指标
     */
    recordMetric(experimentId, metricName, value, metadata = {}) {
        if (!this._metrics[experimentId]) {
            this._metrics[experimentId] = {};
        }
        if (!this._metrics[experimentId][metricName]) {
            this._metrics[experimentId][metricName] = [];
        }
        
        this._metrics[experimentId][metricName].push({
            value,
            timestamp: Date.now(),
            variant: this.getVariant(experimentId)?.variant,
            ...metadata
        });
        
        // 尝试同步到服务端
        this._syncMetricToServer(experimentId, metricName, value);
    }

    /**
     * 同步指标到服务端
     */
    async _syncMetricToServer(experimentId, metricName, value) {
        if (!isSqliteClientDatabase()) return;
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            await fetch(`${base}/api/ab-tests/metrics`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this._userId,
                    experiment_id: experimentId,
                    metric_name: metricName,
                    value: value,
                    variant: this.getVariant(experimentId)?.variant
                })
            });
        } catch {}
    }

    /**
     * 获取实验列表
     */
    getActiveExperiments() {
        return Object.entries(this._experiments)
            .filter(([_, exp]) => exp.enabled !== false)
            .map(([id, exp]) => ({
                id,
                name: exp.name,
                description: exp.description,
                variant: this.getVariant(id)
            }));
    }

    /**
     * 获取用户指标
     */
    getUserMetrics(experimentId) {
        return this._metrics[experimentId] || {};
    }

    /**
     * 强制分配到特定变体（调试用）
     */
    forceVariant(experimentId, variantId) {
        const experiment = this._experiments[experimentId];
        if (!experiment || !experiment.variants[variantId]) {
            console.warn('[ABTest] Invalid experiment or variant');
            return false;
        }
        
        this._userVariantCache[experimentId] = {
            variant: variantId,
            config: experiment.variants[variantId].config,
            label: experiment.variants[variantId].label
        };
        this._saveVariantCache();
        
        return true;
    }

    /**
     * 重置实验分配（调试用）
     */
    resetExperiment(experimentId) {
        delete this._userVariantCache[experimentId];
        delete this._metrics[experimentId];
        this._saveVariantCache();
    }

    /**
     * 获取实验状态
     */
    getStatus() {
        return {
            userId: this._userId,
            experiments: this.getActiveExperiments(),
            hasRemoteConfig: this._remoteConfig !== null
        };
    }
}

let _instance = null;
export function getABTestManager() {
    if (!_instance) {
        _instance = new ABTestManager();
    }
    return _instance;
}

export async function initABTest(userId) {
    await getABTestManager().init(userId);
}