/* 自动生成 —— 请勿手改。源：web/src/monetization/analyticsTracker.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
import { DAY_MS } from '../lib/dateUtils.mjs';
import { createLogger } from '../lib/logger.mjs';
import { loadAnalyticsSnapshotSync, queueAnalyticsSave } from '../lib/analyticsStore.mjs';
const log = createLogger('analyticsTracker');

/**
 * AnalyticsTracker - 指标埋点与漏斗分析
 * 
 * 功能：
 * 1. 事件埋点
 * 2. 漏斗配置
 * 3. 转化分析
 * 4. 用户旅程追踪
 */
/* v1.71 V2：原 ANALYTICS_STORAGE_KEY 常量已迁至 lib/analyticsStore.js (LS_KEY)。
 * 这里删除避免双源真相；analyticsStore 保留同样的 'openblock_analytics_v1' 兼容
 * 历史数据无缝读取。 */

/**
 * 预定义事件类型
 */
export const ANALYTICS_EVENTS = {
    // 游戏事件
    GAME_START: { category: 'game', name: 'game_start' },
    GAME_END: { category: 'game', name: 'game_end' },
    PLACE_BLOCK: { category: 'game', name: 'place_block' },
    CLEAR_LINES: { category: 'game', name: 'clear_lines' },
    SCORE_UPDATE: { category: 'game', name: 'score_update' },
    
    // 商业化事件
    AD_SHOW: { category: 'monetization', name: 'ad_show' },
    AD_CLICK: { category: 'monetization', name: 'ad_click' },
    AD_COMPLETE: { category: 'monetization', name: 'ad_complete' },
    IAP_PURCHASE: { category: 'monetization', name: 'iap_purchase' },
    
    // 用户事件
    REGISTER: { category: 'user', name: 'register' },
    LOGIN: { category: 'user', name: 'login' },
    SHARE: { category: 'user', name: 'share' },
    INVITE: { category: 'user', name: 'invite' },
    
    // 留存事件
    SESSION_START: { category: 'retention', name: 'session_start' },
    SESSION_END: { category: 'retention', name: 'session_end' },
    DAILY_RETURN: { category: 'retention', name: 'daily_return' },

    /* PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P0-4 新增：让生命周期/成熟度看板可重放。
     * 命名遵循 GOLDEN_EVENTS.md 的 snake_case 约定；触发位见各 trackEvent 调用方。 */
    FTUE_STEP_COMPLETE: { category: 'lifecycle', name: 'ftue_step_complete' },
    INTENT_EXPOSED: { category: 'lifecycle', name: 'intent_exposed' },
    INTENT_FOLLOWED: { category: 'lifecycle', name: 'intent_followed' },
    BOTTLENECK_HIT: { category: 'lifecycle', name: 'bottleneck_hit' },
    RECOVERY_SUCCESS: { category: 'lifecycle', name: 'recovery_success' },
    MATURITY_MILESTONE_COMPLETE: { category: 'lifecycle', name: 'maturity_milestone_complete' },
    WEEKLY_CHALLENGE_JOIN: { category: 'lifecycle', name: 'weekly_challenge_join' },
    WEEKLY_CHALLENGE_COMPLETE: { category: 'lifecycle', name: 'weekly_challenge_complete' },
    WINBACK_SESSION_STARTED: { category: 'lifecycle', name: 'winback_session_started' },
    WINBACK_SESSION_COMPLETED: { category: 'lifecycle', name: 'winback_session_completed' },
};

/**
 * 预定义漏斗
 */
export const ANALYTICS_FUNNELS = {
    ONBOARDING: {
        id: 'onboarding',
        name: '新手引导流程',
        steps: [
            { id: 'app_open', name: '打开应用', event: 'app_open' },
            { id: 'ftue_start', name: '开始引导', event: 'ftue_start' },
            { id: 'first_place', name: '首次放置', event: 'place_block' },
            { id: 'first_clear', name: '首次消除', event: 'clear_lines' },
            { id: 'ftue_complete', name: '引导完成', event: 'ftue_complete' }
        ]
    },
    
    PURCHASE: {
        id: 'purchase',
        name: '付费转化流程',
        steps: [
            { id: 'game_start', name: '开始游戏', event: 'game_start' },
            { id: 'shop_view', name: '进入商店', event: 'shop_view' },
            { id: 'product_select', name: '选择商品', event: 'product_select' },
            { id: 'checkout', name: '开始支付', event: 'checkout_start' },
            { id: 'purchase_complete', name: '支付完成', event: 'iap_purchase' }
        ]
    },
    
    AD_WATCH: {
        id: 'ad_watch',
        name: '激励广告流程',
        steps: [
            { id: 'ad_trigger', name: '广告触发', event: 'ad_trigger' },
            { id: 'ad_show', name: '广告展示', event: 'ad_show' },
            { id: 'ad_click', name: '广告点击', event: 'ad_click' },
            { id: 'ad_complete', name: '广告完成', event: 'ad_complete' }
        ]
    },
    
    INVITE: {
        id: 'invite',
        name: '邀请流程',
        steps: [
            { id: 'invite_view', name: '查看邀请', event: 'invite_view' },
            { id: 'invite_click', name: '点击邀请', event: 'invite_click' },
            { id: 'invite_share', name: '分享邀请', event: 'invite_share' },
            { id: 'invite_register', name: '被邀请注册', event: 'invite_register' },
            { id: 'invite_complete', name: '邀请完成', event: 'invite_complete' }
        ]
    },
    
    RETENTION: {
        id: 'retention',
        name: '留存流程',
        steps: [
            { id: 'day_1', name: '第1天', event: 'daily_return' },
            { id: 'day_3', name: '第3天', event: 'daily_return' },
            { id: 'day_7', name: '第7天', event: 'daily_return' },
            { id: 'day_14', name: '第14天', event: 'daily_return' },
            { id: 'day_30', name: '第30天', event: 'daily_return' }
        ]
    }
};

class AnalyticsTracker {
    constructor() {
        this._userId = null;
        this._events = [];
        this._funnelData = {};
        this._sessionId = null;
    }

    /**
     * 初始化
     */
    init(userId) {
        this._userId = userId;
        this._sessionId = this._generateSessionId();
        this._loadEvents();
        
        log.log('[Analytics] Initialized for user:', userId);
    }

    /**
     * 生成会话 ID
     */
    _generateSessionId() {
        return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 加载事件（v1.71 V2：走 analyticsStore，与旧 localStorage 路径无缝兼容）
     */
    _loadEvents() {
        try {
            const data = loadAnalyticsSnapshotSync();
            if (data) {
                this._events = data.events || [];
                this._funnelData = data.funnels || {};
                if (this._events.length > 1000) {
                    this._events = this._events.slice(-1000);
                }
            }
        } catch { /* persistence failure must never break analytics consumer */ }
    }

    /**
     * 保存事件
     *
     * v1.71 V2：原版每条 event 都 stringify + localStorage.setItem，
     * 高频游戏事件（place_block 每局上百次）下会写穿主线程；
     * 现在走 analyticsStore.queueAnalyticsSave —— 节流到 800ms（IDB 异步）
     * + 5s 强 flush + pagehide 同步 flush。
     */
    _saveEvents() {
        try {
            queueAnalyticsSave({ events: this._events, funnels: this._funnelData });
        } catch { /* persistence failure must never break analytics consumer */ }
    }

    /**
     * 追踪事件
     */
    trackEvent(eventType, properties = {}) {
        const event = {
            type: eventType,
            userId: this._userId,
            sessionId: this._sessionId,
            timestamp: Date.now(),
            properties,
            // 自动添加上下文
            url: window?.location?.href || '',
            referrer: document?.referrer || ''
        };
        
        this._events.push(event);
        
        // 更新漏斗数据
        this._updateFunnelProgress(eventType);
        
        // 如果事件太多，清理旧事件
        if (this._events.length > 1000) {
            this._events = this._events.slice(-500);
        }
        
        this._saveEvents();
        
        // 入发件箱（无网络本地缓存 + 联网批量上报；去重靠 event_id）。
        this._reportEvent(event);
        
        log.log('[Analytics] Tracked:', eventType, properties);
    }

    /**
     * 把单条事件投递到上报发件箱（reportingOutbox）。
     * 经 globalThis hook 解耦，跨端安全：mp/cocos 无 outbox 时为 no-op。
     */
    _reportEvent(event) {
        const outbox = (typeof globalThis !== 'undefined') ? globalThis.__reportingOutbox : null;
        if (!outbox?.enqueue) return;
        try {
            outbox.enqueue('behavior', {
                event_type: event.type,
                user_id: event.userId,
                session_id: event.sessionId,
                data: event.properties || {},
                timestamp: event.timestamp,
            });
        } catch { /* 不阻塞主流程 */ }
    }

    /**
     * 更新漏斗进度
     */
    _updateFunnelProgress(eventType) {
        for (const [funnelId, funnel] of Object.entries(ANALYTICS_FUNNELS)) {
            if (!this._funnelData[funnelId]) {
                this._funnelData[funnelId] = {
                    currentStep: 0,
                    completed: false,
                    startedAt: null,
                    completedAt: null
                };
            }
            
            const funnelProgress = this._funnelData[funnelId];
            const currentStep = funnel.steps[funnelProgress.currentStep];
            
            if (currentStep && currentStep.event === eventType) {
                // 进入下一步
                funnelProgress.currentStep++;
                
                if (funnelProgress.currentStep === 1) {
                    funnelProgress.startedAt = Date.now();
                }
                
                if (funnelProgress.currentStep >= funnel.steps.length) {
                    funnelProgress.completed = true;
                    funnelProgress.completedAt = Date.now();
                }
            }
        }
    }

    /**
     * 获取漏斗分析
     */
    getFunnelAnalysis(funnelId) {
        const funnel = ANALYTICS_FUNNELS[funnelId];
        if (!funnel) return null;
        
        const progress = this._funnelData[funnelId] || {
            currentStep: 0,
            completed: false
        };
        
        // 计算每个步骤的转化率
        const stepStats = [];
        let previousCount = 1;
        
        for (let i = 0; i < funnel.steps.length; i++) {
            const step = funnel.steps[i];
            const stepEvents = this._events.filter(e => e.type === step.event);
            const stepCount = stepEvents.length;
            
            stepStats.push({
                stepId: step.id,
                name: step.name,
                count: stepCount,
                conversionRate: previousCount > 0 ? (stepCount / previousCount * 100).toFixed(1) + '%' : '0%',
                reached: i < progress.currentStep
            });
            
            previousCount = stepCount;
        }
        
        return {
            funnel: funnel.name,
            currentStep: progress.currentStep,
            completed: progress.completed,
            startedAt: progress.startedAt,
            completedAt: progress.completedAt,
            steps: stepStats,
            overallConversion: progress.completed 
                ? (stepStats[stepStats.length - 1].count / stepStats[0].count * 100).toFixed(1) + '%'
                : null
        };
    }

    /**
     * 获取用户事件统计
     */
    getEventStats(timeRange = 7 * DAY_MS) {
        const now = Date.now();
        const recentEvents = this._events.filter(e => now - e.timestamp < timeRange);
        
        const stats = {};
        
        for (const event of recentEvents) {
            if (!stats[event.type]) {
                stats[event.type] = { count: 0, first: event.timestamp, last: event.timestamp };
            }
            
            stats[event.type].count++;
            stats[event.type].first = Math.min(stats[event.type].first, event.timestamp);
            stats[event.type].last = Math.max(stats[event.type].last, event.timestamp);
        }
        
        return stats;
    }

    /**
     * 获取用户旅程
     */
    getUserJourney(limit = 50) {
        return this._events.slice(-limit).map(e => ({
            type: e.type,
            timestamp: e.timestamp,
            properties: e.properties
        }));
    }

    /**
     * 获取会话统计
     */
    getSessionStats() {
        const sessions = {};
        
        for (const event of this._events) {
            if (!sessions[event.sessionId]) {
                sessions[event.sessionId] = {
                    start: event.timestamp,
                    end: event.timestamp,
                    events: 0
                };
            }
            
            sessions[event.sessionId].end = Math.max(sessions[event.sessionId].end, event.timestamp);
            sessions[event.sessionId].events++;
        }
        
        const sessionList = Object.values(sessions).map(s => ({
            ...s,
            duration: s.end - s.start
        }));
        
        return {
            totalSessions: sessionList.length,
            avgSessionDuration: sessionList.reduce((sum, s) => sum + s.duration, 0) / sessionList.length || 0,
            avgEventsPerSession: sessionList.reduce((sum, s) => sum + s.events, 0) / sessionList.length || 0
        };
    }

    /**
     * 获取所有漏斗状态
     */
    getAllFunnelStatus() {
        const status = {};
        
        for (const [funnelId, funnel] of Object.entries(ANALYTICS_FUNNELS)) {
            const progress = this._funnelData[funnelId] || { currentStep: 0, completed: false };
            
            status[funnelId] = {
                name: funnel.name,
                currentStep: progress.currentStep,
                totalSteps: funnel.steps.length,
                completed: progress.completed
            };
        }
        
        return status;
    }

    /**
     * 重置分析数据（调试用）
     */
    resetAnalytics() {
        this._events = [];
        this._funnelData = {};
        this._saveEvents();
        log.log('[Analytics] Reset');
    }

    /**
     * 获取状态
     */
    getStatus() {
        return {
            userId: this._userId,
            sessionId: this._sessionId,
            totalEvents: this._events.length,
            funnels: this.getAllFunnelStatus()
        };
    }
}

let _analyticsInstance = null;
export function getAnalyticsTracker() {
    if (!_analyticsInstance) {
        _analyticsInstance = new AnalyticsTracker();
    }
    return _analyticsInstance;
}

export function initAnalyticsTracker(userId) {
    getAnalyticsTracker().init(userId);
}