/**
 * RealTimeDashboard - 实时数据大屏
 * 
 * 功能：
 * 1. 实时核心指标展示
 * 2. 趋势图表
 * 3. 关键指标告警
 * 4. 多维度数据聚合
 */
// 当前 dashboard 仅消费本地存储与事件总线产出的快照；后续接服务端时再放开 config 引用。

const DASHBOARD_CONFIG = {
    refreshInterval: 10000, // 10秒刷新
    maxDataPoints: 60,      // 最多60个数据点
    alertThresholds: {
        retention_d1: { warning: 30, critical: 20 },
        arpu: { warning: 0.3, critical: 0.1 },
        churn_risk: { warning: 0.5, critical: 0.7 },
        ad_fatigue: { warning: 0.5, critical: 0.7 }
    }
};

class RealTimeDashboard {
    constructor() {
        this._metrics = {
            current: {},
            historical: {},
            alerts: []
        };
        this._listeners = [];
        this._pollingTimer = null;
    }

    /**
     * 初始化
     */
    init() {
        this._startPolling();
        console.log('[Dashboard] Initialized');
    }

    /**
     * 启动轮询
     */
    _startPolling() {
        // 立即获取一次数据
        this._fetchMetrics();
        
        // 定期刷新
        this._pollingTimer = setInterval(() => {
            this._fetchMetrics();
        }, DASHBOARD_CONFIG.refreshInterval);
    }

    /**
     * 停止轮询
     */
    stop() {
        if (this._pollingTimer) {
            clearInterval(this._pollingTimer);
            this._pollingTimer = null;
        }
    }

    /**
     * 获取指标数据
     */
    async _fetchMetrics() {
        const metrics = {
            timestamp: Date.now(),
            user: await this._getUserMetrics(),
            session: await this._getSessionMetrics(),
            revenue: await this._getRevenueMetrics(),
            engagement: await this._getEngagementMetrics(),
            ads: await this._getAdsMetrics()
        };
        
        this._metrics.current = metrics;
        this._updateHistorical(metrics);
        this._checkAlerts(metrics);
        
        this._notifyListeners(metrics);
        
        return metrics;
    }

    /**
     * 获取用户指标
     */
    async _getUserMetrics() {
        try {
            const progress = JSON.parse(localStorage.getItem('openblock_progression_v1') || '{}');
            const stats = JSON.parse(localStorage.getItem('openblock_client_stats') || '{}');
            
            return {
                totalXp: progress.totalXp || 0,
                level: Math.floor(Math.sqrt((progress.totalXp || 0) / 100)) + 1,
                dailyStreak: progress.dailyStreak || 0,
                totalGames: stats.totalGames || 0,
                bestScore: stats.bestScore || 0
            };
        } catch {
            return { totalXp: 0, level: 1, dailyStreak: 0, totalGames: 0, bestScore: 0 };
        }
    }

    /**
     * 获取会话指标
     */
    async _getSessionMetrics() {
        // 从 analyticsTracker 获取
        try {
            const analytics = window.__analyticsTracker;
            if (analytics) {
                const sessionStats = analytics.getSessionStats();
                return {
                    sessions: sessionStats.totalSessions,
                    avgDuration: Math.round(sessionStats.avgSessionDuration / 1000), // 秒
                    avgEvents: Math.round(sessionStats.avgEventsPerSession)
                };
            }
        } catch {}
        
        return { sessions: 0, avgDuration: 0, avgEvents: 0 };
    }

    /**
     * 获取收入指标
     */
    async _getRevenueMetrics() {
        try {
            const purchases = JSON.parse(localStorage.getItem('openblock_mon_purchases_v1') || '{}');
            
            let totalRevenue = 0;
            let purchaseCount = 0;
            let activeSubs = 0;
            
            for (const [, p] of Object.entries(purchases)) {
                if (p.priceNum) {
                    totalRevenue += p.priceNum;
                    purchaseCount++;
                }
                if ((p.type === 'subscription' || p.type === 'limited_time') && p.expiresAt > Date.now()) {
                    activeSubs++;
                }
            }
            
            return {
                totalRevenue,
                purchaseCount,
                arpu: purchaseCount > 0 ? (totalRevenue / purchaseCount).toFixed(2) : 0,
                activeSubs
            };
        } catch {
            return { totalRevenue: 0, purchaseCount: 0, arpu: 0, activeSubs: 0 };
        }
    }

    /**
     * 获取活跃指标
     */
    async _getEngagementMetrics() {
        try {
            const analytics = window.__analyticsTracker;
            const eventStats = analytics?.getEventStats(24 * 60 * 60 * 1000) || {};
            
            const gameStarts = eventStats['game_start']?.count || 0;
            const places = eventStats['place_block']?.count || 0;
            const clears = eventStats['clear_lines']?.count || 0;
            
            return {
                gameStarts,
                placements: places,
                clears,
                avgClearsPerGame: gameStarts > 0 ? (clears / gameStarts).toFixed(1) : 0
            };
        } catch {
            return { gameStarts: 0, placements: 0, clears: 0, avgClearsPerGame: 0 };
        }
    }

    /**
     * 获取广告指标
     */
    async _getAdsMetrics() {
        try {
            const adCounts = JSON.parse(localStorage.getItem('openblock_ad_counts_v1') || '{}');
            const counts = adCounts.counts || {};
            
            return {
                rewardedToday: counts.rewarded || 0,
                interstitialToday: counts.interstitial || 0,
                maxRewarded: 12,
                maxInterstitial: 6
            };
        } catch {
            return { rewardedToday: 0, interstitialToday: 0, maxRewarded: 12, maxInterstitial: 6 };
        }
    }

    /**
     * 更新历史数据
     */
    _updateHistorical(metrics) {
        const key = 'core';
        
        if (!this._metrics.historical[key]) {
            this._metrics.historical[key] = [];
        }
        
        this._metrics.historical[key].push({
            timestamp: metrics.timestamp,
            games: metrics.engagement.gameStarts,
            score: metrics.user.bestScore,
            clears: metrics.engagement.clears
        });
        
        // 限制数据点数量
        if (this._metrics.historical[key].length > DASHBOARD_CONFIG.maxDataPoints) {
            this._metrics.historical[key] = this._metrics.historical[key].slice(-DASHBOARD_CONFIG.maxDataPoints);
        }
    }

    /**
     * 检查告警
     */
    _checkAlerts(metrics) {
        const alerts = [];
        // alertThresholds 当前仅在文档中描述给运营参考；服务端接入后会替换为真实阈值比对。

        // 示例告警（实际应根据服务端数据）
        // 这里简化为基于本地数据的判断
        
        if (metrics.engagement.gameStarts > 0 && metrics.engagement.avgClearsPerGame < 2) {
            alerts.push({
                type: 'warning',
                metric: 'engagement',
                message: '游戏活跃但消除率偏低'
            });
        }
        
        if (metrics.revenue.purchaseCount === 0 && metrics.session.sessions > 5) {
            alerts.push({
                type: 'info',
                metric: 'monetization',
                message: '活跃用户尚未转化'
            });
        }
        
        this._metrics.alerts = alerts;
    }

    /**
     * 获取当前指标
     */
    getCurrentMetrics() {
        return this._metrics.current;
    }

    /**
     * 获取历史数据
     */
    getHistoricalData(points = 30) {
        const data = this._metrics.historical['core'] || [];
        return data.slice(-points);
    }

    /**
     * 获取告警
     */
    getAlerts() {
        return this._metrics.alerts;
    }

    /**
     * 获取汇总卡片数据
     */
    getSummaryCards() {
        const m = this._metrics.current;
        
        return [
            {
                id: 'games',
                title: '游戏次数',
                value: m.engagement?.gameStarts || 0,
                trend: 'up',
                icon: '🎮'
            },
            {
                id: 'score',
                title: '最高分',
                value: m.user?.bestScore || 0,
                trend: 'up',
                icon: '⭐'
            },
            {
                id: 'clears',
                title: '消除次数',
                value: m.engagement?.clears || 0,
                trend: 'up',
                icon: '🧹'
            },
            {
                id: 'revenue',
                title: '总收入',
                value: `¥${m.revenue?.totalRevenue || 0}`,
                trend: 'neutral',
                icon: '💰'
            },
            {
                id: 'streak',
                title: '连续天数',
                value: m.user?.dailyStreak || 0,
                trend: 'up',
                icon: '🔥'
            }
        ];
    }

    /**
     * 注册监听
     */
    onUpdate(callback) {
        this._listeners.push(callback);
        return () => {
            const idx = this._listeners.indexOf(callback);
            if (idx >= 0) this._listeners.splice(idx, 1);
        };
    }

    /**
     * 通知监听器
     */
    _notifyListeners(metrics) {
        for (const callback of this._listeners) {
            try {
                callback(metrics);
            } catch (e) {
                console.warn('[Dashboard] Listener error:', e);
            }
        }
    }
}

let _dashboardInstance = null;
export function getRealTimeDashboard() {
    if (!_dashboardInstance) {
        _dashboardInstance = new RealTimeDashboard();
    }
    return _dashboardInstance;
}

export function initRealTimeDashboard() {
    getRealTimeDashboard().init();
}