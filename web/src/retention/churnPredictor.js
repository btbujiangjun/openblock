/**
 * churnPredictor.js - 流失预警模型
 *
 * 基于玩家行为数据预测流失风险，提供早期干预触发点
 * 与 playerMaturity.js 互补，聚焦短期流失预测
 */

const STORAGE_KEY = 'openblock_churn_data_v1';

const CHURN_WEIGHTS = {
    sessionDecline: 0.25,
    scoreDecline: 0.20,
    durationDecline: 0.15,
    engagementDrop: 0.20,
    featureAbandonment: 0.10,
    paymentDrop: 0.10
};

const _CHURN_SIGNAL_KEY = 'openblock_churn_signals_v1';
let _churnDataCache = null;

function _todayYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export function getChurnData() {
    if (_churnDataCache) {
        return { ..._churnDataCache };
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            _churnDataCache = JSON.parse(raw);
            return { ..._churnDataCache };
        }
    } catch {}

    _churnDataCache = {
        lastUpdated: _todayYmd(),
        signals: [],
        riskHistory: []
    };
    return { ..._churnDataCache };
}

function _saveChurnData(data) {
    _churnDataCache = data;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {}
}

function _daysBetween(ymd1, ymd2) {
    const [y1, m1, d1] = ymd1.split('-').map(Number);
    const [y2, m2, d2] = ymd2.split('-').map(Number);
    const date1 = new Date(y1, m1 - 1, d1);
    const date2 = new Date(y2, m2 - 1, d2);
    return Math.floor((date2 - date1) / (1000 * 60 * 60 * 24));
}

export function recordSessionMetrics(sessionData) {
    const today = _todayYmd();
    const current = getChurnData();

    const sessionEntry = {
        date: today,
        sessionCount: sessionData.sessionCount || 1,
        avgDuration: sessionData.avgDuration || sessionData.duration || 0,
        avgScore: sessionData.avgScore || sessionData.score || 0,
        engagement: sessionData.engagement || 0.5
    };

    const updatedSignals = [...current.signals, sessionEntry].slice(-14);

    const riskHistoryEntry = {
        date: today,
        risk: calculateChurnRisk(updatedSignals)
    };

    const updatedRiskHistory = [...current.riskHistory, riskHistoryEntry].slice(-30);

    const updated = {
        lastUpdated: today,
        signals: updatedSignals,
        riskHistory: updatedRiskHistory,
        lastRisk: riskHistoryEntry.risk
    };

    _saveChurnData(updated);

    return {
        risk: riskHistoryEntry.risk,
        signals: analyzeSignals(updatedSignals)
    };
}

function calculateChurnRisk(signals) {
    if (signals.length < 3) {
        return 0;
    }

    const recentSignals = signals.slice(-7);
    const olderSignals = signals.slice(-14, -7);

    if (olderSignals.length === 0) {
        return 0;
    }

    const recentAvgSessions = recentSignals.reduce((s, x) => s + x.sessionCount, 0) / recentSignals.length;
    const olderAvgSessions = olderSignals.reduce((s, x) => s + x.sessionCount, 0) / olderSignals.length;
    const sessionDecline = olderAvgSessions > 0 ? Math.max(0, 1 - recentAvgSessions / olderAvgSessions) : 0;

    const recentAvgScore = recentSignals.reduce((s, x) => s + x.avgScore, 0) / recentSignals.length;
    const olderAvgScore = olderSignals.reduce((s, x) => s + x.avgScore, 0) / olderSignals.length;
    const scoreDecline = olderAvgScore > 0 ? Math.max(0, 1 - recentAvgScore / olderAvgScore) : 0;

    const recentAvgDuration = recentSignals.reduce((s, x) => s + x.avgDuration, 0) / recentSignals.length;
    const olderAvgDuration = olderSignals.reduce((s, x) => s + x.avgDuration, 0) / olderSignals.length;
    const durationDecline = olderAvgDuration > 0 ? Math.max(0, 1 - recentAvgDuration / olderAvgDuration) : 0;

    const recentAvgEngagement = recentSignals.reduce((s, x) => s + x.engagement, 0) / recentSignals.length;
    const olderAvgEngagement = olderSignals.reduce((s, x) => s + x.engagement, 0) / olderSignals.length;
    const engagementDrop = olderAvgEngagement > 0 ? Math.max(0, 1 - recentAvgEngagement / olderAvgEngagement) : 0;

    const risk = (
        sessionDecline * CHURN_WEIGHTS.sessionDecline +
        scoreDecline * CHURN_WEIGHTS.scoreDecline +
        durationDecline * CHURN_WEIGHTS.durationDecline +
        engagementDrop * CHURN_WEIGHTS.engagementDrop
    ) * 100;

    return Math.min(100, Math.round(risk));
}

function analyzeSignals(signals) {
    const recent = signals.slice(-3);
    const issues = [];

    if (recent.length >= 3) {
        const scoreTrend = recent[recent.length - 1].avgScore - recent[0].avgScore;
        if (scoreTrend < -50) {
            issues.push({ type: 'score_declining', severity: 'medium', message: '得分持续下滑' });
        }
    }

    if (recent.length >= 3) {
        const sessionTrend = recent.reduce((s, x) => s + x.sessionCount, 0);
        if (sessionTrend < 5) {
            issues.push({ type: 'low_activity', severity: 'high', message: '活跃度较低' });
        }
    }

    const avgEngagement = recent.reduce((s, x) => s + x.engagement, 0) / recent.length;
    if (avgEngagement < 0.3) {
        issues.push({ type: 'low_engagement', severity: 'high', message: '参与度不足' });
    }

    return issues;
}

export function getChurnRiskLevel(risk) {
    if (risk >= 70) return 'critical';
    if (risk >= 50) return 'high';
    if (risk >= 30) return 'medium';
    if (risk >= 15) return 'low';
    return 'stable';
}

export function getChurnPrediction() {
    const data = getChurnData();
    const currentRisk = data.lastRisk || 0;
    const riskLevel = getChurnRiskLevel(currentRisk);

    const recentHistory = data.riskHistory?.slice(-7) || [];
    const riskTrend = recentHistory.length >= 2
        ? recentHistory[recentHistory.length - 1].risk - recentHistory[0].risk
        : 0;

    return {
        risk: currentRisk,
        level: riskLevel,
        trend: riskTrend,
        isImproving: riskTrend < -5,
        isWorsening: riskTrend > 5,
        lastUpdated: data.lastUpdated,
        signals: data.signals?.slice(-3) || []
    };
}

export function shouldSendChurnAlert(playerData) {
    const prediction = getChurnPrediction();
    const stage = playerData?.stage || 'unknown';

    if (prediction.level === 'critical') {
        return { shouldAlert: true, priority: 'critical', reason: '流失风险极高' };
    }

    if (prediction.level === 'high' && prediction.isWorsening) {
        return { shouldAlert: true, priority: 'high', reason: '流失风险上升中' };
    }

    if (stage === 'exploration' && prediction.level !== 'stable') {
        return { shouldAlert: true, priority: 'medium', reason: '探索期流失风险' };
    }

    if (stage === 'growth' && prediction.level === 'high') {
        return { shouldAlert: true, priority: 'high', reason: '成长期高价值用户流失风险' };
    }

    return { shouldAlert: false, priority: null, reason: null };
}

export function getChurnIntervention(playerData) {
    const prediction = getChurnPrediction();
    const stage = playerData?.stage || 'exploration';

    const interventions = {
        critical: {
            type: 'urgent召回',
            reward: ['提示券 x5', '撤销券 x3', '钻石 x50'],
            message: '您有一份专属回归礼包待领取，点击立即领取！'
        },
        high: {
            type: '激励召回',
            reward: ['提示券 x3', '金币 x500'],
            message: '我们想念您了！回来继续游戏有惊喜奖励。'
        },
        medium: {
            type: '温和触达',
            reward: ['提示券 x2'],
            message: '新内容已上线，快来看看吧！'
        },
        low: {
            type: '常规唤醒',
            reward: [],
            message: '今日登录奖励已准备好~'
        },
        stable: {
            type: '保持',
            reward: [],
            message: null
        }
    };

    if (stage === 'onboarding') {
        return {
            ...interventions[prediction.level],
            reward: [...(interventions[prediction.level]?.reward || []), '首日大礼包'],
            message: '完成新手任务获得额外奖励！'
        };
    }

    return interventions[prediction.level] || interventions.stable;
}

export function invalidateChurnCache() {
    _churnDataCache = null;
}