/**
 * RetentionAnalyzer - 用户留存与转化漏斗分析
 * 
 * 功能：
 * 1. 留存率计算
 * 2. 转化漏斗分析
 * 3. 用户生命周期追踪
 * 4. cohort 分析
 */
// analyticsTracker 由 RetentionManager 注入数据，此处不直接耦合，便于无 tracker 环境也能复用统计逻辑。

const RETENTION_PERIODS = [1, 3, 7, 14, 30, 60, 90];

class RetentionAnalyzer {
    constructor() {
        this._retentionData = {};
        this._conversionData = {};
        this._userSessions = [];
    }

    /**
     * 初始化
     */
    init() {
        this._loadData();
        console.log('[Retention] Initialized');
    }

    /**
     * 加载数据
     */
    _loadData() {
        try {
            const stored = localStorage.getItem('openblock_retention_v1');
            if (stored) {
                const data = JSON.parse(stored);
                this._retentionData = data.retention || {};
                this._conversionData = data.conversion || {};
                this._userSessions = data.sessions || [];
            }
        } catch {}
    }

    /**
     * 保存数据
     */
    _saveData() {
        try {
            localStorage.setItem('openblock_retention_v1', JSON.stringify({
                retention: this._retentionData,
                conversion: this._conversionData,
                sessions: this._userSessions
            }));
        } catch {}
    }

    /**
     * 记录用户会话（每次打开应用时调用）
     */
    recordSession(userId) {
        const now = Date.now();
        const today = new Date().toISOString().slice(0, 10);
        
        // 查找用户会话
        let userSession = this._userSessions.find(s => s.userId === userId);
        
        if (!userSession) {
            userSession = {
                userId,
                firstSeen: now,
                lastSeen: now,
                sessions: []
            };
            this._userSessions.push(userSession);
        }
        
        // 检查今天是否已记录
        const todaySession = userSession.sessions.find(s => s.date === today);
        
        if (!todaySession) {
            userSession.sessions.push({
                date: today,
                timestamp: now
            });
        }
        
        userSession.lastSeen = now;
        
        this._calculateRetention();
        this._saveData();
        
        return userSession;
    }

    /**
     * 计算留存率
     */
    _calculateRetention() {
        if (this._userSessions.length === 0) return;
        
        const firstUser = this._userSessions[0];
        // firstDate 仍可用于按 cohort 切片的扩展统计；当前实现按 firstSeen + period 计算。

        // 按日期统计留存
        for (const period of RETENTION_PERIODS) {
            const periodMs = period * 24 * 60 * 60 * 1000;
            const targetDate = new Date(firstUser.firstSeen + periodMs).toISOString().slice(0, 10);
            
            // 计算该日期的回访用户数
            const retained = this._userSessions.filter(u => {
                return u.sessions.some(s => s.date >= targetDate);
            }).length;
            
            const total = this._userSessions.length;
            const rate = total > 0 ? (retained / total * 100).toFixed(1) : 0;
            
            this._retentionData[`d${period}`] = {
                period,
                retained,
                total,
                rate: parseFloat(rate)
            };
        }
    }

    /**
     * 获取留存率
     */
    getRetentionRate(period) {
        const key = `d${period}`;
        return this._retentionData[key] || { period, rate: 0, retained: 0, total: 0 };
    }

    /**
     * 获取所有留存率
     */
    getAllRetentionRates() {
        return RETENTION_PERIODS.map(p => this.getRetentionRate(p));
    }

    /**
     * 记录转化事件
     */
    recordConversion(eventName, userId, properties = {}) {
        if (!this._conversionData[eventName]) {
            this._conversionData[eventName] = {
                event: eventName,
                users: new Set(),
                count: 0,
                totalValue: 0
            };
        }
        
        this._conversionData[eventName].users.add(userId);
        this._conversionData[eventName].count++;
        
        if (properties.value) {
            this._conversionData[eventName].totalValue += properties.value;
        }
        
        this._saveData();
    }

    /**
     * 获取转化数据
     */
    getConversionData() {
        const result = {};
        
        for (const [event, data] of Object.entries(this._conversionData)) {
            result[event] = {
                event,
                uniqueUsers: data.users.size,
                totalCount: data.count,
                avgValue: data.count > 0 ? (data.totalValue / data.count).toFixed(2) : 0
            };
        }
        
        return result;
    }

    /**
     * 计算漏斗转化率
     */
    calculateFunnel(funnelSteps) {
        if (!funnelSteps || funnelSteps.length === 0) return null;
        
        const results = [];
        let previousCount = 0;
        
        for (let i = 0; i < funnelSteps.length; i++) {
            const step = funnelSteps[i];
            const stepData = this._conversionData[step.event];
            
            const currentCount = stepData?.uniqueUsers || 0;
            
            // 第一个步骤以总用户数为基准
            if (i === 0) {
                previousCount = Math.max(currentCount, 1);
            }
            
            const conversionRate = previousCount > 0 
                ? (currentCount / previousCount * 100).toFixed(1) 
                : 0;
            
            results.push({
                step: i + 1,
                name: step.name,
                event: step.event,
                users: currentCount,
                conversionRate: parseFloat(conversionRate),
                dropOff: i > 0 ? (100 - parseFloat(conversionRate)).toFixed(1) : 0
            });
            
            previousCount = currentCount;
        }
        
        // 计算整体转化率
        const firstStep = results[0]?.users || 1;
        const lastStep = results[results.length - 1]?.users || 0;
        const overallRate = (lastStep / firstStep * 100).toFixed(1);
        
        return {
            steps: results,
            overall: parseFloat(overallRate),
            totalDropOff: (100 - parseFloat(overallRate)).toFixed(1)
        };
    }

    /**
     * 获取预设漏斗
     */
    getPresetFunnels() {
        return {
            monetization: this.calculateFunnel([
                { name: '新用户注册', event: 'register' },
                { name: '首次游戏', event: 'game_start' },
                { name: '进入商店', event: 'shop_view' },
                { name: '选择商品', event: 'product_select' },
                { name: '完成购买', event: 'iap_purchase' }
            ]),
            
            engagement: this.calculateFunnel([
                { name: '打开应用', event: 'app_open' },
                { name: '开始游戏', event: 'game_start' },
                { name: '完成游戏', event: 'game_end' },
                { name: '分享成绩', event: 'share' }
            ]),
            
            retention: this.calculateFunnel([
                { name: '第1天', event: 'daily_return_d1' },
                { name: '第3天', event: 'daily_return_d3' },
                { name: '第7天', event: 'daily_return_d7' },
                { name: '第14天', event: 'daily_return_d14' },
                { name: '第30天', event: 'daily_return_d30' }
            ])
        };
    }

    /**
     * 获取用户生命周期阶段
     */
    getUserLifecycle(userId) {
        const user = this._userSessions.find(u => u.userId === userId);
        
        if (!user) return 'new';
        
        const now = Date.now();
        const daysSinceFirst = Math.floor((now - user.firstSeen) / (24 * 60 * 60 * 1000));
        const daysSinceLast = Math.floor((now - user.lastSeen) / (24 * 60 * 60 * 1000));
        const sessionCount = user.sessions.length;
        
        // 生命周期判断
        if (daysSinceFirst <= 1) return 'new';
        if (daysSinceFirst <= 7 && sessionCount >= 3) return 'active';
        if (daysSinceFirst > 7 && daysSinceLast <= 3) return 'engaged';
        if (daysSinceLast <= 7) return 'at_risk';
        if (daysSinceLast > 14) return 'dormant';
        if (daysSinceLast > 30) return 'churned';
        
        return 'active';
    }

    /**
     * 获取留存趋势
     */
    getRetentionTrend() {
        // 返回模拟数据（实际应从服务端获取）
        const trend = [];
        
        for (let i = 6; i >= 0; i--) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            trend.push({
                date,
                d1: 40 + Math.random() * 10,
                d7: 20 + Math.random() * 10,
                d30: 10 + Math.random() * 5
            });
        }
        
        return trend;
    }

    /**
     * 获取分析报告
     */
    getReport() {
        const retention = this.getAllRetentionRates();
        const conversions = this.getConversionData();
        const funnels = this.getPresetFunnels();
        const lifecycle = {};
        
        // 统计各生命周期用户数
        for (const user of this._userSessions) {
            const stage = this.getUserLifecycle(user.userId);
            lifecycle[stage] = (lifecycle[stage] || 0) + 1;
        }
        
        return {
            generatedAt: new Date().toISOString(),
            retention: {
                periods: retention,
                trend: this.getRetentionTrend()
            },
            conversion: conversions,
            funnels,
            lifecycle,
            summary: {
                totalUsers: this._userSessions.length,
                activeUsers: this._userSessions.filter(u => 
                    this.getUserLifecycle(u.userId) === 'active'
                ).length,
                atRiskUsers: this._userSessions.filter(u => 
                    this.getUserLifecycle(u.userId) === 'at_risk'
                ).length
            }
        };
    }

    /**
     * 重置数据
     */
    reset() {
        this._retentionData = {};
        this._conversionData = {};
        this._userSessions = [];
        this._saveData();
        console.log('[Retention] Reset');
    }
}

let _retentionInstance = null;
export function getRetentionAnalyzer() {
    if (!_retentionInstance) {
        _retentionInstance = new RetentionAnalyzer();
    }
    return _retentionInstance;
}

export function initRetentionAnalyzer() {
    getRetentionAnalyzer().init();
}