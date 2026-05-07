/**
 * ExperimentPlatform - A/B 测试基础设施统一入口
 * 
 * 整合：
 * 1. 用户分群 (CohortManager)
 * 2. 远程配置 (RemoteConfigManager)
 * 3. 指标追踪 (AnalyticsTracker)
 * 4. A/B 测试 (ABTestManager)
 */
import { getABTestManager, initABTest } from './abTestManager.js';
import { getCohortManager, initCohortManager } from './cohortManager.js';
import { getRemoteConfigManager, initRemoteConfig } from './remoteConfigManager.js';
import { getAnalyticsTracker, initAnalyticsTracker } from './analyticsTracker.js';

class ExperimentPlatform {
    constructor() {
        this._initialized = false;
        this._userId = null;
    }

    /**
     * 初始化整个平台
     */
    async init(userId) {
        if (this._initialized) {
            console.log('[ExperimentPlatform] Already initialized');
            return;
        }
        
        this._userId = userId;
        
        console.log('[ExperimentPlatform] Initializing...');
        
        // 按顺序初始化各模块
        await initRemoteConfig();
        initCohortManager(userId);
        initAnalyticsTracker(userId);
        await initABTest(userId);
        
        // 同步用户分群
        const cohortManager = getCohortManager();
        cohortManager.syncFromSystem();
        
        this._initialized = true;
        console.log('[ExperimentPlatform] Initialization complete');
    }

    /**
     * 获取 AB 测试管理器
     */
    getABTest() {
        return getABTestManager();
    }

    /**
     * 获取分群管理器
     */
    getCohort() {
        return getCohortManager();
    }

    /**
     * 获取配置管理器
     */
    getConfig() {
        return getRemoteConfigManager();
    }

    /**
     * 获取分析追踪器
     */
    getAnalytics() {
        return getAnalyticsTracker();
    }

    /**
     * 追踪事件
     */
    track(eventType, properties = {}) {
        this.getAnalytics().trackEvent(eventType, properties);
    }

    /**
     * 获取实验配置
     */
    getExperimentConfig(experimentId) {
        const abTest = this.getABTest();
        return abTest.getExperimentConfig(experimentId);
    }

    /**
     * 获取 Feature Flag
     */
    getFeatureFlag(flagName) {
        return this.getConfig().getFeatureFlag(flagName);
    }

    /**
     * 获取用户分群
     */
    getUserCohorts() {
        return this.getCohort().getCohorts();
    }

    /**
     * 获取漏斗分析
     */
    getFunnelAnalysis(funnelId) {
        return this.getAnalytics().getFunnelAnalysis(funnelId);
    }

    /**
     * 获取完整报告
     */
    getFullReport() {
        return {
            user: {
                id: this._userId,
                cohorts: this.getUserCohorts(),
                properties: this.getCohort().getUserProperties()
            },
            experiments: this.getABTest().getActiveExperiments(),
            features: this.getConfig().getAllFeatureFlags(),
            funnels: this.getAnalytics().getAllFunnelStatus(),
            session: this.getAnalytics().getSessionStats(),
            eventStats: this.getAnalytics().getEventStats()
        };
    }

    /**
     * 检查特定实验并记录指标
     */
    trackExperimentMetric(experimentId, metricName, value) {
        const abTest = this.getABTest();
        
        // 记录指标
        abTest.recordMetric(experimentId, metricName, value);
        
        // 同时追踪到分析系统
        this.track(`experiment_${metricName}`, {
            experimentId,
            value,
            variant: abTest.getVariant(experimentId)?.variant
        });
    }

    /**
     * 获取状态
     */
    getStatus() {
        if (!this._initialized) {
            return { initialized: false };
        }
        
        return {
            initialized: true,
            userId: this._userId,
            abTest: this.getABTest().getStatus(),
            cohort: this.getCohort().getStatus(),
            config: this.getConfig().getStatus(),
            analytics: this.getAnalytics().getStatus()
        };
    }
}

let _platformInstance = null;
export function getExperimentPlatform() {
    if (!_platformInstance) {
        _platformInstance = new ExperimentPlatform();
    }
    return _platformInstance;
}

export async function initExperimentPlatform(userId) {
    await getExperimentPlatform().init(userId);
}

// 导出所有子模块
export {
    getABTestManager,
    getCohortManager,
    getRemoteConfigManager,
    getAnalyticsTracker
} from './index.js';