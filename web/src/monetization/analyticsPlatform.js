/**
 * AnalyticsPlatform - 运营分析统一平台
 * 
 * 整合：
 * 1. 实时数据大屏 (RealTimeDashboard)
 * 2. 用户留存/转化分析 (RetentionAnalyzer)
 * 3. 付费转化预测 (PaymentPredictionModel)
 * 4. 事件追踪 (AnalyticsTracker)
 */
import { getRealTimeDashboard, initRealTimeDashboard } from './realTimeDashboard.js';
import { getRetentionAnalyzer, initRetentionAnalyzer } from './retentionAnalyzer.js';
import { getPaymentPredictionModel, initPaymentPredictionModel } from './paymentPredictionModel.js';
import { getAnalyticsTracker, initAnalyticsTracker } from './analyticsTracker.js';

class AnalyticsPlatform {
    constructor() {
        this._initialized = false;
        this._userId = null;
    }

    /**
     * 初始化
     */
    init(userId) {
        if (this._initialized) return;
        
        this._userId = userId;
        
        console.log('[AnalyticsPlatform] Initializing...');
        
        // 初始化各模块
        initRealTimeDashboard();
        initRetentionAnalyzer();
        initPaymentPredictionModel();
        initAnalyticsTracker(userId);
        
        // 记录当前会话
        getRetentionAnalyzer().recordSession(userId);
        
        this._initialized = true;
        console.log('[AnalyticsPlatform] Ready');
    }

    /**
     * 获取实时大屏
     */
    getDashboard() {
        return getRealTimeDashboard();
    }

    /**
     * 获取留存分析
     */
    getRetention() {
        return getRetentionAnalyzer();
    }

    /**
     * 获取转化预测
     */
    getPrediction() {
        return getPaymentPredictionModel();
    }

    /**
     * 获取事件追踪
     */
    getTracker() {
        return getAnalyticsTracker();
    }

    /**
     * 追踪事件
     */
    track(eventType, properties = {}) {
        const tracker = this.getTracker();
        tracker.trackEvent(eventType, properties);
        
        // 自动记录转化事件
        if (eventType === 'iap_purchase') {
            getRetentionAnalyzer().recordConversion('iap_purchase', this._userId, properties);
        }
    }

    /**
     * 获取完整分析报告
     */
    getFullReport() {
        const dashboard = this.getDashboard();
        const retention = this.getRetention();
        const prediction = this.getPrediction();
        
        return {
            timestamp: new Date().toISOString(),
            
            // 实时指标
            realtime: {
                summaryCards: dashboard.getSummaryCards(),
                alerts: dashboard.getAlerts(),
                historical: dashboard.getHistoricalData(30)
            },
            
            // 留存分析
            retention: {
                rates: retention.getAllRetentionRates(),
                funnels: retention.getPresetFunnels(),
                lifecycle: retention.getReport().lifecycle
            },
            
            // 转化预测
            prediction: {
                score: prediction.getPrediction(),
                explanation: prediction.getExplanation(),
                userValue: prediction.getUserValue()
            },
            
            // 事件统计
            events: {
                stats: this.getTracker().getEventStats(7 * 24 * 60 * 60 * 1000),
                session: this.getTracker().getSessionStats(),
                funnels: this.getTracker().getAllFunnelStatus()
            },
            
            // 模型状态
            models: {
                dashboard: dashboard.getStatus?.() || {},
                prediction: prediction.getModelStatus()
            }
        };
    }

    /**
     * 获取关键指标摘要
     */
    getKeyMetrics() {
        const dashboard = this.getDashboard();
        const prediction = this.getPrediction();
        const retention = this.getRetention();
        
        const metrics = dashboard.getSummaryCards();
        const pred = prediction.getPrediction();
        const ret = retention.getReport();
        
        return {
            // 核心指标
            games: metrics.find(m => m.id === 'games')?.value || 0,
            score: metrics.find(m => m.id === 'score')?.value || 0,
            streak: metrics.find(m => m.id === 'streak')?.value || 0,
            
            // 预测指标
            conversionScore: pred.score,
            conversionBand: pred.band,
            userValue: prediction.getUserValue().ltv,
            
            // 留存指标
            d1Retention: ret.retention.periods.find(p => p.period === 1)?.rate || 0,
            d7Retention: ret.retention.periods.find(p => p.period === 7)?.rate || 0,
            
            // 用户状态
            atRiskCount: ret.summary.atRiskUsers,
            activeCount: ret.summary.activeUsers
        };
    }

    /**
     * 获取告警列表
     */
    getAlerts() {
        const dashboard = this.getDashboard();
        const alerts = [...dashboard.getAlerts()];
        
        // 添加预测告警
        const prediction = this.getPrediction().getPrediction();
        if (prediction.score >= 0.7) {
            alerts.push({
                type: 'opportunity',
                metric: 'conversion',
                message: `高付费意向用户 (${prediction.score.toFixed(2)})`
            });
        }
        
        return alerts;
    }

    /**
     * 导出数据（用于分析）
     */
    exportData() {
        const report = this.getFullReport();
        
        return {
            exportTime: new Date().toISOString(),
            userId: this._userId,
            data: report
        };
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
            components: {
                dashboard: true,
                retention: true,
                prediction: true,
                tracker: true
            }
        };
    }
}

let _platformInstance = null;
export function getAnalyticsPlatform() {
    if (!_platformInstance) {
        _platformInstance = new AnalyticsPlatform();
    }
    return _platformInstance;
}

export function initAnalyticsPlatform(userId) {
    getAnalyticsPlatform().init(userId);
}