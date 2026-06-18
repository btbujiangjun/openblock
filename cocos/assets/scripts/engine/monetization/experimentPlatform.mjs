/* 自动生成 —— 请勿手改。源：web/src/monetization/experimentPlatform.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * ExperimentPlatform - A/B 测试基础设施统一入口
 * 
 * 整合：
 * 1. 用户分群 (CohortManager)
 * 2. 远程配置 (RemoteConfigManager)
 * 3. 指标追踪 (AnalyticsTracker)
 * 4. A/B 测试 (ABTestManager)
 */
import { getABTestManager, initABTest } from './abTestManager.mjs';
import { getCohortManager, initCohortManager } from './cohortManager.mjs';
import { getRemoteConfigManager, initRemoteConfig } from './remoteConfigManager.mjs';
import { getAnalyticsTracker, initAnalyticsTracker } from './analyticsTracker.mjs';

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
            log.log('[ExperimentPlatform] Already initialized');
            return;
        }
        
        this._userId = userId;
        
        log.log('[ExperimentPlatform] Initializing...');
        
        // 按顺序初始化各模块
        await initRemoteConfig();
        initCohortManager(userId);
        initAnalyticsTracker(userId);
        await initABTest(userId);
        
        // 同步用户分群
        const cohortManager = getCohortManager();
        cohortManager.syncFromSystem();
        
        this._initialized = true;
        log.log('[ExperimentPlatform] Initialization complete');
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

// 导出所有子模块（每个 getter 走真实定义所在的模块，避免 rollup 解析失败）
export { getABTestManager } from './abTestManager.mjs';
export { getCohortManager } from './cohortManager.mjs';
export { getRemoteConfigManager } from './remoteConfigManager.mjs';
export { getAnalyticsTracker } from './analyticsTracker.mjs';
import { createLogger } from '../lib/logger.mjs';
const log = createLogger('experimentPlatform');

// 历史问题：原本 `} from './index.mjs'` 想再导出这四个 getter，但 ./index.js 实际只导出
// initMonetization/shutdownMonetization，目标 export 完全错位。Vite 对未匹配再导出宽松（构建仅警告），
// 所以 web 不挂；cocos Creator 3.8 的 rollup-plugin-mod-lo 严格解析，会因目标缺失中断整包脚本构建
// （结果是 APK 一直在用旧 JS，本地 .ts/.mjs 任何改动都无法到设备）。
// 修复：直接从各 manager 模块按名再导出，行为与原意一致，且 Web/Cocos 都能严格解析。