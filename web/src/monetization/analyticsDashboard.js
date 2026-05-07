/**
 * AnalyticsDashboard - 运营数据分析面板
 * 
 * 功能：
 * 1. 实时指标展示
 * 2. 漏斗分析
 * 3. 趋势图表
 * 4. 用户分群
 */
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';
import { getPlayerAbilityModel } from '../playerAbilityModel.js';
import { getABTestManager } from './abTestManager.js';
import { getPaymentManager } from './paymentManager.js';

class AnalyticsDashboard {
    constructor() {
        this._metrics = {
            daily: {},
            weekly: {},
            monthly: {}
        };
        this._listeners = [];
    }

    /**
     * 初始化
     */
    init() {
        // 定期刷新数据
        this._startPolling(60000); // 1分钟
        console.log('[Analytics] Dashboard initialized');
    }

    /**
     * 定期拉取数据
     */
    _startPolling(interval) {
        this._pollingTimer = setInterval(() => {
            this.refreshAll();
        }, interval);
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
     * 刷新所有数据
     */
    async refreshAll() {
        await Promise.all([
            this.refreshUserStats(),
            this.refreshRevenue(),
            this.refreshRetention(),
            this.refreshBehavior()
        ]);
        this._notifyListeners();
    }

    /**
     * 获取用户统计数据
     */
    async refreshUserStats() {
        if (!isSqliteClientDatabase()) return;
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            const userId = localStorage.getItem('bb_user_id');
            
            const response = await fetch(`${base}/api/client/stats?user_id=${userId}`);
            if (response.ok) {
                const data = await response.json();
                this._metrics.daily.userStats = data;
            }
        } catch (e) {
            console.warn('[Analytics] Failed to fetch user stats:', e);
        }
    }

    /**
     * 获取收入数据
     */
    async refreshRevenue() {
        if (!isSqliteClientDatabase()) return;
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            const userId = localStorage.getItem('bb_user_id');
            
            const response = await fetch(`${base}/api/payments?user_id=${userId}`);
            if (response.ok) {
                const payments = await response.json();
                
                // 计算收入指标
                const revenue = payments.reduce((sum, p) => sum + (p.amount_minor || 0) / 100, 0);
                const purchaseCount = payments.length;
                const arpu = purchaseCount > 0 ? revenue / purchaseCount : 0;
                
                this._metrics.daily.revenue = {
                    total: revenue,
                    purchases: purchaseCount,
                    arpu
                };
            }
        } catch (e) {
            console.warn('[Analytics] Failed to fetch revenue:', e);
        }
    }

    /**
     * 获取留存数据
     */
    async refreshRetention() {
        if (!isSqliteClientDatabase()) return;
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            const userId = localStorage.getItem('bb_user_id');
            
            const response = await fetch(`${base}/api/analytics/behaviors?user_id=${userId}`);
            if (response.ok) {
                const data = await response.json();
                this._metrics.daily.behavior = data;
            }
        } catch (e) {
            console.warn('[Analytics] Failed to fetch retention:', e);
        }
    }

    /**
     * 获取行为分析
     */
    async refreshBehavior() {
        try {
            const abilityModel = getPlayerAbilityModel();
            const persona = abilityModel.getPersona();
            
            this._metrics.daily.persona = persona;
        } catch (e) {
            console.warn('[Analytics] Failed to fetch behavior:', e);
        }
    }

    /**
     * 获取核心指标
     */
    getCoreMetrics() {
        const userStats = this._metrics.daily.userStats || {};
        const revenue = this._metrics.daily.revenue || {};
        const persona = this._metrics.daily.persona || {};
        
        return {
            // 用户指标
            totalGames: userStats.totalGames || 0,
            totalScore: userStats.totalScore || 0,
            bestScore: userStats.bestScore || 0,
            
            // 收入指标
            revenue: revenue.total || 0,
            purchases: revenue.purchases || 0,
            arpu: revenue.arpu || 0,
            
            // 活跃指标
            clears: userStats.totalClears || 0,
            maxCombo: userStats.maxCombo || 0,
            
            // 能力画像
            skillLevel: persona.skillLevel || 0,
            flowState: persona.flowState || 'unknown',
            frustration: persona.frustration || 0
        };
    }

    /**
     * 获取漏斗数据
     */
    getFunnelData() {
        const behavior = this._metrics.daily.behavior || {};
        
        return {
            impressions: behavior.total_sessions || 0,
            gameStarts: behavior.total_sessions || 0,
            placements: behavior.place_count || 0,
            clears: behavior.clear_count || 0,
            purchases: this._metrics.daily.revenue?.purchases || 0,
            
            // 计算转化率
            startToPlay: 1.0,
            playToClear: behavior.place_count ? behavior.clear_count / behavior.place_count : 0,
            clearToPurchase: this._metrics.daily.revenue?.purchases ? 
                this._metrics.daily.revenue.purchases / (behavior.clear_count || 1) : 0
        };
    }

    /**
     * 获取趋势数据
     */
    getTrendData(days = 7) {
        // 简化版：返回最近 N 天的模拟数据
        const trends = [];
        const now = Date.now();
        
        for (let i = days - 1; i >= 0; i--) {
            const date = new Date(now - i * 24 * 60 * 60 * 1000);
            trends.push({
                date: date.toISOString().slice(0, 10),
                games: Math.floor(Math.random() * 10) + 1,
                score: Math.floor(Math.random() * 500) + 100,
                clears: Math.floor(Math.random() * 50) + 10
            });
        }
        
        return trends;
    }

    /**
     * 获取实验数据
     */
    getExperimentData() {
        const abTest = getABTestManager();
        return abTest.getActiveExperiments();
    }

    /**
     * 获取支付数据
     */
    getPaymentData() {
        const pm = getPaymentManager();
        return pm.getPaymentStatus();
    }

    /**
     * 注册数据变化监听
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
    _notifyListeners() {
        for (const callback of this._listeners) {
            try {
                callback(this.getCoreMetrics());
            } catch (e) {
                console.warn('[Analytics] Listener error:', e);
            }
        }
    }

    /**
     * 生成报告
     */
    generateReport() {
        const metrics = this.getCoreMetrics();
        const funnel = this.getFunnelData();
        const trends = this.getTrendData();
        
        return {
            generatedAt: new Date().toISOString(),
            metrics,
            funnel,
            trends,
            experiments: this.getExperimentData(),
            payment: this.getPaymentData()
        };
    }
}

let _instance = null;
export function getAnalyticsDashboard() {
    if (!_instance) {
        _instance = new AnalyticsDashboard();
    }
    return _instance;
}

export function initAnalyticsDashboard() {
    getAnalyticsDashboard().init();
}