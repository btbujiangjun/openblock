/**
 * RetentionAnalyzer — 用户留存与转化漏斗分析
 *
 * 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P0-3：修复 cohort/funnel/趋势三处口径偏差。
 *
 *   1) `_conversionData[event].users` 持久化用 Set 不可序列化，重启后 .add 成 undefined。
 *      → 内部仍用 Set 计算唯一用户，序列化时转 Array、反序列化时还原 Set。
 *   2) `_calculateRetention` 旧实现以 _userSessions[0]（"第一个曾出现过的用户"）当 cohort
 *      起点，把所有用户硬归到同一 cohort，结果失真。
 *      → 改为 per-user cohort：每名用户以自身 firstSeen 为锚，独立判断 D{n} 是否回访，
 *        再聚合所有用户算分阶段留存率。
 *   3) `calculateFunnel` 取 `stepData?.uniqueUsers`，但 _conversionData 里只有 users(Set) /
 *      count，没有 uniqueUsers 字段，永远拿到 0。
 *      → 直接以 users.size 为唯一用户数计算转化率。
 *   4) `getRetentionTrend` 旧实现用随机模拟值充当趋势线，对线上看板有误导性。
 *      → 改为按"过去 7 天"重算每天的 D1/D7/D30 留存率；无足够数据时返回空数组。
 *
 * 详见 docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md §3 / §4.1 P0-3。
 */

const RETENTION_PERIODS = [1, 3, 7, 14, 30, 60, 90];
const STORAGE_KEY = 'openblock_retention_v1';
const DAY_MS = 24 * 60 * 60 * 1000;

class RetentionAnalyzer {
    constructor() {
        this._retentionData = {};
        this._conversionData = {};
        this._userSessions = [];
    }

    init() {
        this._loadData();
        console.log('[Retention] Initialized');
    }

    _loadData() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (!stored) return;
            const data = JSON.parse(stored);
            this._retentionData = data.retention || {};
            this._userSessions = data.sessions || [];
            /* P0-3 修复 1：把序列化时存为 Array 的 users 还原为 Set，否则 add() 会
             * 变成 undefined.add()。同时兼容历史 v1 没有 users 字段的存档。 */
            const conv = data.conversion || {};
            const restored = {};
            for (const [event, payload] of Object.entries(conv)) {
                const userArr = Array.isArray(payload.users)
                    ? payload.users
                    : (payload.users && typeof payload.users === 'object'
                        ? Object.keys(payload.users)
                        : []);
                restored[event] = {
                    event,
                    users: new Set(userArr),
                    count: payload.count || 0,
                    totalValue: payload.totalValue || 0,
                };
            }
            this._conversionData = restored;
        } catch {
            /* 静默失败：保持构造器默认值 */
        }
    }

    _saveData() {
        try {
            const conversion = {};
            for (const [event, payload] of Object.entries(this._conversionData)) {
                conversion[event] = {
                    event,
                    users: Array.from(payload.users || []),
                    count: payload.count || 0,
                    totalValue: payload.totalValue || 0,
                };
            }
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                retention: this._retentionData,
                conversion,
                sessions: this._userSessions,
            }));
        } catch {}
    }

    /** 记录用户会话（每次打开应用时调用） */
    recordSession(userId) {
        const now = Date.now();
        const today = new Date().toISOString().slice(0, 10);

        let userSession = this._userSessions.find((s) => s.userId === userId);

        if (!userSession) {
            userSession = {
                userId,
                firstSeen: now,
                lastSeen: now,
                sessions: [],
            };
            this._userSessions.push(userSession);
        }

        const todaySession = userSession.sessions.find((s) => s.date === today);

        if (!todaySession) {
            userSession.sessions.push({
                date: today,
                timestamp: now,
            });
        }

        userSession.lastSeen = now;

        this._calculateRetention();
        this._saveData();

        return userSession;
    }

    /** 计算留存率（per-user cohort 聚合） */
    _calculateRetention() {
        if (this._userSessions.length === 0) {
            for (const period of RETENTION_PERIODS) {
                this._retentionData[`d${period}`] = { period, retained: 0, total: 0, rate: 0 };
            }
            return;
        }

        for (const period of RETENTION_PERIODS) {
            let eligible = 0;
            let retained = 0;
            const periodMs = period * DAY_MS;

            for (const user of this._userSessions) {
                /* eligible：必须装机至少 period 天，否则该用户当前 cohort 还未进入观测窗。 */
                const ageMs = Date.now() - user.firstSeen;
                if (ageMs < periodMs) continue;
                eligible++;

                const targetTimestamp = user.firstSeen + periodMs;
                const targetDate = new Date(targetTimestamp).toISOString().slice(0, 10);
                /* "在 D{n} 当天或之后是否回访"——抗时区误差与同日多次会话。 */
                const hasReturn = user.sessions.some((s) => s.date >= targetDate);
                if (hasReturn) retained++;
            }

            const rate = eligible > 0 ? Number(((retained / eligible) * 100).toFixed(1)) : 0;
            this._retentionData[`d${period}`] = {
                period,
                retained,
                total: eligible,
                rate,
            };
        }
    }

    getRetentionRate(period) {
        const key = `d${period}`;
        return this._retentionData[key] || { period, rate: 0, retained: 0, total: 0 };
    }

    getAllRetentionRates() {
        return RETENTION_PERIODS.map((p) => this.getRetentionRate(p));
    }

    /** 记录转化事件 */
    recordConversion(eventName, userId, properties = {}) {
        if (!this._conversionData[eventName]) {
            this._conversionData[eventName] = {
                event: eventName,
                users: new Set(),
                count: 0,
                totalValue: 0,
            };
        }

        const entry = this._conversionData[eventName];
        /* 防御：如果某次反序列化失败 users 不是 Set（例如外部直写存档），现场补救。 */
        if (!(entry.users instanceof Set)) {
            entry.users = new Set(Array.isArray(entry.users) ? entry.users : []);
        }
        entry.users.add(userId);
        entry.count++;

        if (properties.value) {
            entry.totalValue += properties.value;
        }

        this._saveData();
    }

    getConversionData() {
        const result = {};

        for (const [event, data] of Object.entries(this._conversionData)) {
            const uniqueUsers = data.users instanceof Set ? data.users.size : 0;
            result[event] = {
                event,
                uniqueUsers,
                totalCount: data.count,
                avgValue: data.count > 0 ? Number((data.totalValue / data.count).toFixed(2)) : 0,
            };
        }

        return result;
    }

    /** 计算漏斗转化率（uniqueUsers 直接来自 users Set） */
    calculateFunnel(funnelSteps) {
        if (!funnelSteps || funnelSteps.length === 0) return null;

        const results = [];
        let previousCount = 0;

        for (let i = 0; i < funnelSteps.length; i++) {
            const step = funnelSteps[i];
            const stepData = this._conversionData[step.event];
            /* P0-3 修复 3：直接从 Set 取 size，不再读不存在的 uniqueUsers 字段。 */
            const currentCount = stepData?.users instanceof Set ? stepData.users.size : 0;

            if (i === 0) {
                previousCount = Math.max(currentCount, 1);
            }

            const conversionRate = previousCount > 0
                ? Number(((currentCount / previousCount) * 100).toFixed(1))
                : 0;

            results.push({
                step: i + 1,
                name: step.name,
                event: step.event,
                users: currentCount,
                conversionRate,
                dropOff: i > 0 ? Number((100 - conversionRate).toFixed(1)) : 0,
            });

            previousCount = currentCount;
        }

        const firstStep = results[0]?.users || 1;
        const lastStep = results[results.length - 1]?.users || 0;
        const overallRate = Number(((lastStep / firstStep) * 100).toFixed(1));

        return {
            steps: results,
            overall: overallRate,
            totalDropOff: Number((100 - overallRate).toFixed(1)),
        };
    }

    getPresetFunnels() {
        return {
            monetization: this.calculateFunnel([
                { name: '新用户注册', event: 'register' },
                { name: '首次游戏', event: 'game_start' },
                { name: '进入商店', event: 'shop_view' },
                { name: '选择商品', event: 'product_select' },
                { name: '完成购买', event: 'iap_purchase' },
            ]),

            engagement: this.calculateFunnel([
                { name: '打开应用', event: 'app_open' },
                { name: '开始游戏', event: 'game_start' },
                { name: '完成游戏', event: 'game_end' },
                { name: '分享成绩', event: 'share' },
            ]),

            retention: this.calculateFunnel([
                { name: '第1天', event: 'daily_return_d1' },
                { name: '第3天', event: 'daily_return_d3' },
                { name: '第7天', event: 'daily_return_d7' },
                { name: '第14天', event: 'daily_return_d14' },
                { name: '第30天', event: 'daily_return_d30' },
            ]),
        };
    }

    /** 获取用户生命周期阶段（基于 RetentionAnalyzer 内部数据，仅用于报告） */
    getUserLifecycle(userId) {
        const user = this._userSessions.find((u) => u.userId === userId);

        if (!user) return 'new';

        const now = Date.now();
        const daysSinceFirst = Math.floor((now - user.firstSeen) / DAY_MS);
        const daysSinceLast = Math.floor((now - user.lastSeen) / DAY_MS);
        const sessionCount = user.sessions.length;

        if (daysSinceFirst <= 1) return 'new';
        if (daysSinceFirst <= 7 && sessionCount >= 3) return 'active';
        if (daysSinceFirst > 7 && daysSinceLast <= 3) return 'engaged';
        if (daysSinceLast <= 7) return 'at_risk';
        if (daysSinceLast > 14) return 'dormant';
        if (daysSinceLast > 30) return 'churned';

        return 'active';
    }

    /**
     * 留存趋势：过去 7 天每天的 D1/D7/D30 留存率（基于真实数据，不再返回随机值）。
     *
     * 算法：对每个 day d ∈ [today-6, today]，把"在 day-{period} 当天或之前首装机"的用户
     * 作为 cohort，看他们在 day 当天或之后是否还有会话。无足够数据时返回空数组。
     */
    getRetentionTrend() {
        if (this._userSessions.length === 0) return [];

        const now = Date.now();
        const trend = [];
        for (let i = 6; i >= 0; i--) {
            const dayTimestamp = now - i * DAY_MS;
            const dayDateStr = new Date(dayTimestamp).toISOString().slice(0, 10);
            const point = { date: dayDateStr };
            for (const period of [1, 7, 30]) {
                const cohortAnchor = dayTimestamp - period * DAY_MS;
                const cohort = this._userSessions.filter((u) => u.firstSeen <= cohortAnchor);
                if (cohort.length === 0) {
                    point[`d${period}`] = 0;
                    continue;
                }
                const retainedCount = cohort.filter((u) => u.sessions.some((s) => s.date >= dayDateStr)).length;
                point[`d${period}`] = Number(((retainedCount / cohort.length) * 100).toFixed(1));
            }
            trend.push(point);
        }
        return trend;
    }

    getReport() {
        const retention = this.getAllRetentionRates();
        const conversions = this.getConversionData();
        const funnels = this.getPresetFunnels();
        const lifecycle = {};

        for (const user of this._userSessions) {
            const stage = this.getUserLifecycle(user.userId);
            lifecycle[stage] = (lifecycle[stage] || 0) + 1;
        }

        return {
            generatedAt: new Date().toISOString(),
            retention: {
                periods: retention,
                trend: this.getRetentionTrend(),
            },
            conversion: conversions,
            funnels,
            lifecycle,
            summary: {
                totalUsers: this._userSessions.length,
                activeUsers: this._userSessions.filter((u) =>
                    this.getUserLifecycle(u.userId) === 'active'
                ).length,
                atRiskUsers: this._userSessions.filter((u) =>
                    this.getUserLifecycle(u.userId) === 'at_risk'
                ).length,
            },
        };
    }

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

/** 仅供测试使用：重置单例，避免不同测试用例间数据污染。 */
export function _resetRetentionAnalyzerForTests() {
    _retentionInstance = null;
}
