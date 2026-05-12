/**
 * playerLifecycleDashboard.js — 玩家生命周期分层指标面板
 *
 * 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P0-2：阶段判定从单一 OR 改为
 *   "(days AND session) + recency 修正" 的门槛 + 置信模型。
 *
 *   - days/session 都达标才算"未跨过该阶段窗口"，避免高频回访玩家被锁在 onboarding；
 *   - daysSinceLastActive 用作 recency 修正，最近活跃越近置信越高；
 *   - getPlayerLifecycleStageDetail 返回 { stage, confidence }，旧 getPlayerLifecycleStage
 *     仅返回 stage 字符串，向后兼容。
 *
 * 与 playerInsightPanel 形成互补：后者聚焦局内能力，前者聚焦生命周期价值。
 */

import {
    getMaturityInsights,
    getRecommendedActions,
    getMaturityBand,
} from './playerMaturity.js';
import { getRetentionManager } from './retentionManager.js';

/**
 * 阶段窗口：days 与 session 共同界定该阶段"上界"，超出任一项即跨入下一阶段。
 * 增加 minSession 用于"S0 不能因为玩了一局但 days=10 就被锁住"——只有 days 与 sessions
 * 同时小于阈值才算 onboarding；任一突破即视为已跨过。
 */
const LIFECYCLE_THRESHOLDS = {
    onboarding: { days: 3, maxSession: 10 },
    exploration: { days: 14, maxSession: 50 },
    growth: { days: 30, maxSession: 200 },
    stability: { days: 90, maxSession: 500 },
};

/** stage 的 cohort 定义；置信由"距阈值距离 + recency 衰减"两个量合成。 */
function _computeStageConfidence(stage, days, sessions, daysSinceLastActive) {
    const rule = LIFECYCLE_THRESHOLDS[stage];
    if (!rule) return 0.5;
    const dayHeadroom = Math.max(0, 1 - days / rule.days);
    const sessionHeadroom = Math.max(0, 1 - sessions / rule.maxSession);
    const recencyDecay = Number.isFinite(daysSinceLastActive)
        ? Math.max(0, 1 - daysSinceLastActive / 14)
        : 1;
    /* 三项均 [0,1]；用平均合成既稳定又便于解释。最低 0.2 避免冷启动直接 0。 */
    return Math.max(0.2, Math.min(1, (dayHeadroom + sessionHeadroom + recencyDecay) / 3));
}

/** 兼容旧 API：仅返回 stage 字符串（onboarding/exploration/growth/stability/veteran）。 */
export function getPlayerLifecycleStage(playerData) {
    return getPlayerLifecycleStageDetail(playerData).stage;
}

/**
 * 新 API：返回 { stage, confidence, hits }。
 *   - stage：5 段中的一个
 *   - confidence：0–1，越高代表 days/session/recency 越确定属于该 stage
 *   - hits：本次判定时哪条规则被触发，便于运营/QA 排查
 */
export function getPlayerLifecycleStageDetail(playerData) {
    const days = playerData?.daysSinceInstall || 0;
    const sessions = playerData?.totalSessions || 0;
    const daysSinceLastActive = playerData?.daysSinceLastActive ?? 0;

    /* P0-2 关键修复：原实现 days OR session 任意一项命中即落入低阶段，
     * 高频玩家（days=2, sessions=100）会被锁在 onboarding。改为 AND，
     * 任一项突破即跨阶段。 */
    if (days <= LIFECYCLE_THRESHOLDS.onboarding.days
        && sessions <= LIFECYCLE_THRESHOLDS.onboarding.maxSession) {
        return {
            stage: 'onboarding',
            confidence: _computeStageConfidence('onboarding', days, sessions, daysSinceLastActive),
            hits: { days, sessions, daysSinceLastActive },
        };
    }
    if (days <= LIFECYCLE_THRESHOLDS.exploration.days
        && sessions <= LIFECYCLE_THRESHOLDS.exploration.maxSession) {
        return {
            stage: 'exploration',
            confidence: _computeStageConfidence('exploration', days, sessions, daysSinceLastActive),
            hits: { days, sessions, daysSinceLastActive },
        };
    }
    if (days <= LIFECYCLE_THRESHOLDS.growth.days
        && sessions <= LIFECYCLE_THRESHOLDS.growth.maxSession) {
        return {
            stage: 'growth',
            confidence: _computeStageConfidence('growth', days, sessions, daysSinceLastActive),
            hits: { days, sessions, daysSinceLastActive },
        };
    }
    if (days <= LIFECYCLE_THRESHOLDS.stability.days
        && sessions <= LIFECYCLE_THRESHOLDS.stability.maxSession) {
        return {
            stage: 'stability',
            confidence: _computeStageConfidence('stability', days, sessions, daysSinceLastActive),
            hits: { days, sessions, daysSinceLastActive },
        };
    }
    /* veteran：days/sessions 任一突破 stability 上界都视为核心期；recency
     * 仍参与置信，长期未活跃的核心玩家置信会被压低，提示运营需要走 winback 路径。 */
    const dayHeadroom = Math.max(0, days / LIFECYCLE_THRESHOLDS.stability.days - 1);
    const sessionHeadroom = Math.max(0, sessions / LIFECYCLE_THRESHOLDS.stability.maxSession - 1);
    const recencyDecay = Number.isFinite(daysSinceLastActive)
        ? Math.max(0, 1 - daysSinceLastActive / 14)
        : 1;
    return {
        stage: 'veteran',
        confidence: Math.max(0.2, Math.min(1, (Math.min(1, dayHeadroom + sessionHeadroom) + recencyDecay) / 2)),
        hits: { days, sessions, daysSinceLastActive },
    };
}

export function getLifecycleConfig(stage) {
    const configs = {
        onboarding: {
            stageName: '导入期',
            stageColor: '#4CAF50',
            keyMetrics: ['d1Retention', 'ftueCompletion', 'firstGameScore'],
            focus: '新手引导与首日体验',
            recommendations: [
                '简化操作流程',
                '快速提供正反馈',
                '降低初期挫败感',
            ],
        },
        exploration: {
            stageName: '探索期',
            stageColor: '#2196F3',
            keyMetrics: ['d7Retention', 'taskCompletion', 'featureAdoption'],
            focus: '玩法探索与习惯养成',
            recommendations: [
                '引导完成每日任务',
                '推荐社交功能',
                '推送首充优惠',
            ],
        },
        growth: {
            stageName: '成长期',
            stageColor: '#9C27B0',
            keyMetrics: ['d30Retention', 'spendingRate', 'socialConnections'],
            focus: '深度参与与付费转化',
            recommendations: [
                '推动段位冲刺',
                '引导加入公会',
                '解锁高级内容',
            ],
        },
        stability: {
            stageName: '稳定期',
            stageColor: '#FF9800',
            keyMetrics: ['ltv', 'arpu', 'churnRisk'],
            focus: '长期价值维护',
            recommendations: [
                '提供专属VIP权益',
                '邀请参与赛事',
                '社区领袖培养',
            ],
        },
        veteran: {
            stageName: '核心期',
            stageColor: '#F44336',
            keyMetrics: ['ltv', 'socialInfluence', 'contentCreation'],
            focus: '核心价值与生态贡献',
            recommendations: [
                '专属客服通道',
                '线下活动邀请',
                'UGC内容激励',
            ],
        },
    };
    return configs[stage] || configs.onboarding;
}

export function getLifecycleDashboardData(playerData) {
    const maturityInsights = getMaturityInsights();
    const detail = getPlayerLifecycleStageDetail(playerData);
    const stage = detail.stage;
    const config = getLifecycleConfig(stage);
    const actions = getRecommendedActions(maturityInsights.level);

    const retentionManager = getRetentionManager();
    let retentionData = null;
    if (retentionManager && retentionManager.getRetentionInsights) {
        try {
            retentionData = retentionManager.getRetentionInsights();
        } catch {}
    }

    return {
        stage,
        stageName: config.stageName,
        stageColor: config.stageColor,
        stageConfidence: detail.confidence,
        maturityLevel: maturityInsights.level,
        maturityBand: maturityInsights.band,
        maturityScore: maturityInsights.score,
        skillScore: maturityInsights.skillScore,
        valueScore: maturityInsights.valueScore,
        matureIndex: maturityInsights.matureIndex,
        churnRisk: maturityInsights.churnRisk,
        keyMetrics: config.keyMetrics,
        focus: config.focus,
        recommendedActions: actions.slice(0, 3),
        retentionMetrics: retentionData,
        stats: {
            totalSessions: maturityInsights.totalSessions,
            totalScore: maturityInsights.totalScore,
            totalSpend: maturityInsights.totalSpend,
            maxLevel: maturityInsights.maxLevel,
            daysAsPlayer: maturityInsights.daysAsPlayer,
        },
    };
}

export function shouldTriggerIntervention(playerData) {
    const insights = getMaturityInsights();
    const stage = getPlayerLifecycleStage(playerData);

    const triggers = [];

    if (insights.churnRisk === 'high') {
        triggers.push({ type: 'churn_prevention', priority: 'high', reason: '流失风险高' });
    }

    if (stage === 'onboarding' && insights.totalSessions < 3) {
        triggers.push({ type: 'onboarding_help', priority: 'high', reason: '新手引导中' });
    }

    if (stage === 'exploration' && insights.daysAsPlayer >= 7 && insights.totalSpend === 0) {
        triggers.push({ type: 'first_purchase', priority: 'medium', reason: '探索期未付费' });
    }

    if (stage === 'growth' && insights.totalSpend > 0 && insights.totalSpend < 10) {
        triggers.push({ type: 'spending_upgrade', priority: 'medium', reason: '付费升级机会' });
    }

    return triggers;
}

export function getInterventionContent(triggerType, _playerData) {
    const contents = {
        churn_prevention: {
            title: '回归有礼',
            content: '您有一份专属回归礼包待领取',
            items: ['提示券 x3', '撤销券 x2'],
            cta: '立即领取',
        },
        onboarding_help: {
            title: '新手指南',
            content: '完成引导获得额外奖励',
            items: ['首日大礼包'],
            cta: '开始体验',
        },
        first_purchase: {
            title: '首充特惠',
            content: '1元解锁超值礼包',
            items: ['提示券 x10', '限定皮肤', 'VIP 3天'],
            cta: '立即充值',
        },
        spending_upgrade: {
            title: '升级礼包',
            content: '充值优惠正在进行中',
            items: ['额外50%金币', '限定道具'],
            cta: '查看详情',
        },
    };

    return contents[triggerType] || null;
}

export function renderLifecycleBadge(playerData) {
    const stage = getPlayerLifecycleStage(playerData);
    const config = getLifecycleConfig(stage);
    const insights = getMaturityInsights();

    return {
        stage: config.stageName,
        color: config.stageColor,
        maturity: insights.level,
        band: insights.band,
        churnRisk: insights.churnRisk,
        label: `${config.stageName} · ${insights.level}`,
    };
}

/**
 * 落地 P0-5：给 playerInsightPanel 与开发者面板提供单一数据源。
 *
 * 输入 playerData（daysSinceInstall/totalSessions/daysSinceLastActive 至少其一），
 * 输出"运营标签 + 局内能力 band"双标签 + 颜色 + 置信，供 UI 直接渲染。
 *
 * 与 renderLifecycleBadge 的区别：renderLifecycleBadge 兼容旧 UI 的 L1–L4，
 * getLifecycleMaturitySnapshot 同时返回 M0–M4 band 与 stage code，便于 dev panel
 * 把蓝图字典直接打到屏上。
 */
export function getLifecycleMaturitySnapshot(playerData) {
    const detail = getPlayerLifecycleStageDetail(playerData);
    const config = getLifecycleConfig(detail.stage);
    const insights = getMaturityInsights();
    const band = insights.band || getMaturityBand(insights.skillScore ?? insights.score ?? 0);

    /* shortLabel：S0/S1/.../S4 与 M0–M4 同屏，UI 不需要两份字符串拼接 */
    const stageCode = ({
        onboarding: 'S0',
        exploration: 'S1',
        growth: 'S2',
        stability: 'S3',
        veteran: 'S3+', /* veteran 由 winback/Stability 共享，UI 不再拆 S4：S4 由 daysSinceLastActive 派生 */
    })[detail.stage] || 'S0';

    /* daysSinceLastActive ≥ 7：进入 winback 视角（蓝图 S4），与 getPlayerLifecycleStage 解耦。 */
    const isWinbackCandidate = (playerData?.daysSinceLastActive ?? 0) >= 7;

    return {
        stage: detail.stage,
        stageCode: isWinbackCandidate ? 'S4' : stageCode,
        stageName: config.stageName,
        stageColor: config.stageColor,
        confidence: detail.confidence,
        band,
        maturityLevel: insights.level,
        churnRisk: insights.churnRisk,
        skillScore: insights.skillScore,
        valueScore: insights.valueScore,
        matureIndex: insights.matureIndex,
        isWinbackCandidate,
        shortLabel: `${isWinbackCandidate ? 'S4' : stageCode}·${band}`,
    };
}

export { LIFECYCLE_THRESHOLDS };
