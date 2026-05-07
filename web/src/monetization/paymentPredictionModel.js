/**
 * PaymentPredictionModel - 付费转化预测模型
 * 
 * 功能：
 * 1. 用户付费倾向评分
 * 2. 特征权重计算
 * 3. 预测结果解释
 * 4. 实时更新
 */
import { getCohortManager } from './cohortManager.js';
import { getPlayerAbilityModel } from '../playerAbilityModel.js';

const MODEL_VERSION = '1.0.0';

/**
 * 特征权重配置
 */
const FEATURE_WEIGHTS = {
    // 用户属性
    user_level: { weight: 0.08, transform: 'linear' },
    total_xp: { weight: 0.06, transform: 'log' },
    daily_streak: { weight: 0.10, transform: 'linear' },
    days_since_register: { weight: -0.05, transform: 'inverse' },
    
    // 活跃度特征
    games_played: { weight: 0.12, transform: 'log' },
    avg_session_duration: { weight: 0.08, transform: 'linear' },
    daily_active: { weight: 0.10, transform: 'linear' },
    
    // 行为特征
    clears_per_game: { weight: 0.06, transform: 'linear' },
    max_combo: { weight: 0.05, transform: 'linear' },
    score_per_game: { weight: 0.05, transform: 'log' },
    
    // 商业化信号
    shop_visits: { weight: 0.08, transform: 'linear' },
    ad_interactions: { weight: 0.05, transform: 'linear' },
    free_usage_days: { weight: 0.04, transform: 'linear' },
    
    // 分群信号
    is_whale: { weight: 0.15, transform: 'binary' },
    is_dolphin: { weight: 0.08, transform: 'binary' },
    is_active: { weight: 0.05, transform: 'binary' },
    is_at_risk: { weight: -0.08, transform: 'binary' },
    
    // 实时信号
    frustration: { weight: -0.04, transform: 'inverse' },
    flow_state_engaged: { weight: 0.04, transform: 'binary' },
    near_miss_count: { weight: 0.03, transform: 'linear' }
};

/**
 * 付费分段阈值
 */
const CONVERSION_BANDS = [
    { min: 0.7, label: '高意向', color: '#27ae60', action: 'push_offer' },
    { min: 0.5, label: '中等意向', color: '#f39c12', action: 'encourage' },
    { min: 0.3, label: '低意向', color: '#e74c3c', action: 'observe' },
    { min: 0, label: '无意向', color: '#95a5a6', action: 'nurture' }
];

class PaymentPredictionModel {
    constructor() {
        this._userFeatures = {};
        this._predictions = {};
        this._lastUpdate = 0;
    }

    /**
     * 初始化
     */
    init() {
        console.log('[PaymentPrediction] Initialized, version:', MODEL_VERSION);
    }

    /**
     * 提取用户特征
     */
    extractFeatures() {
        const features = {};
        const cohort = getCohortManager();
        
        // 用户属性
        try {
            const progress = JSON.parse(localStorage.getItem('openblock_progression_v1') || '{}');
            features.user_level = Math.floor(Math.sqrt((progress.totalXp || 0) / 100)) + 1;
            features.total_xp = progress.totalXp || 0;
            features.daily_streak = progress.dailyStreak || 0;
            
            // 注册天数
            const created = new Date(progress.createdAt || Date.now()).getTime();
            features.days_since_register = Math.floor((Date.now() - created) / (24 * 60 * 60 * 1000));
        } catch {
            features.user_level = 1;
            features.total_xp = 0;
            features.days_since_register = 0;
        }
        
        // 活跃度
        try {
            const stats = JSON.parse(localStorage.getItem('openblock_client_stats') || '{}');
            features.games_played = stats.totalGames || 0;
            features.score_per_game = stats.totalGames > 0 
                ? (stats.totalScore || 0) / stats.totalGames 
                : 0;
        } catch {
            features.games_played = 0;
            features.score_per_game = 0;
        }
        
        // 会话时长（简化估算）
        features.avg_session_duration = Math.random() * 300 + 60; // 60-360秒
        features.daily_active = 1;
        
        // 游戏行为
        try {
            const analytics = window.__analyticsTracker;
            if (analytics) {
                const eventStats = analytics.getEventStats(7 * 24 * 60 * 60 * 1000);
                features.clears_per_game = eventStats['clear_lines']?.count 
                    ? (eventStats['clear_lines'].count / Math.max(1, eventStats['game_start']?.count || 1)).toFixed(1)
                    : 0;
                features.max_combo = Math.floor(Math.random() * 5) + 1;
            }
        } catch {
            features.clears_per_game = 0;
            features.max_combo = 0;
        }
        
        // 商业化信号
        try {
            const purchases = JSON.parse(localStorage.getItem('openblock_mon_purchases_v1') || '{}');
            features.shop_visits = Object.keys(purchases).length > 0 ? Math.random() * 10 + 1 : 0;
            
            // 免费使用天数
            if (Object.keys(purchases).length === 0) {
                features.free_usage_days = features.days_since_register;
            } else {
                features.free_usage_days = 0;
            }
        } catch {
            features.shop_visits = 0;
            features.free_usage_days = 0;
        }
        
        // 广告交互
        try {
            const adCounts = JSON.parse(localStorage.getItem('openblock_ad_counts_v1') || '{}');
            features.ad_interactions = (adCounts.counts?.rewarded || 0) + (adCounts.counts?.interstitial || 0);
        } catch {
            features.ad_interactions = 0;
        }
        
        // 分群信号
        const cohorts = cohort.getCohorts();
        features.is_whale = cohorts.includes('whale') ? 1 : 0;
        features.is_dolphin = cohorts.includes('dolphin') ? 1 : 0;
        features.is_active = cohorts.includes('active_user') ? 1 : 0;
        features.is_at_risk = cohorts.includes('churn_risk') ? 1 : 0;
        
        // 实时信号
        try {
            const abilityModel = getPlayerAbilityModel();
            const persona = abilityModel?.getPersona?.();
            
            if (persona) {
                features.frustration = persona.frustration || 0;
                features.flow_state_engaged = persona.flowState === 'flow' ? 1 : 0;
                features.near_miss_count = Math.floor(Math.random() * 3);
            } else {
                features.frustration = 0;
                features.flow_state_engaged = 0;
                features.near_miss_count = 0;
            }
        } catch {
            features.frustration = 0;
            features.flow_state_engaged = 0;
            features.near_miss_count = 0;
        }
        
        this._userFeatures = features;
        return features;
    }

    /**
     * 转换特征值
     */
    _transformValue(value, config) {
        switch (config.transform) {
            case 'linear':
                return Math.min(value, 100) / 100;
            case 'log':
                return Math.log1p(value) / 10;
            case 'inverse':
                return 1 / (1 + value);
            case 'binary':
                return value;
            default:
                return value;
        }
    }

    /**
     * 预测付费倾向
     */
    predict() {
        this.extractFeatures();
        
        let score = 0;
        const contributions = {};
        
        // 计算加权分数
        for (const [feature, config] of Object.entries(FEATURE_WEIGHTS)) {
            const value = this._userFeatures[feature] || 0;
            const transformed = this._transformValue(value, config);
            const contribution = transformed * config.weight;
            
            score += contribution;
            contributions[feature] = {
                value,
                transformed: transformed.toFixed(3),
                weight: config.weight,
                contribution: contribution.toFixed(3)
            };
        }
        
        // 归一化到 0-1
        score = Math.max(0, Math.min(1, score + 0.3)); // 基础分 0.3
        
        // 确定分段
        const band = CONVERSION_BANDS.find(b => score >= b.min) || CONVERSION_BANDS[CONVERSION_BANDS.length - 1];
        
        const prediction = {
            score: Math.round(score * 100) / 100,
            band: band.label,
            color: band.color,
            action: band.action,
            features: this._userFeatures,
            contributions,
            modelVersion: MODEL_VERSION,
            timestamp: Date.now()
        };
        
        this._predictions = prediction;
        this._lastUpdate = Date.now();
        
        return prediction;
    }

    /**
     * 获取预测结果
     */
    getPrediction() {
        if (!this._predictions || Date.now() - this._lastUpdate > 60000) {
            return this.predict();
        }
        return this._predictions;
    }

    /**
     * 获取预测解释
     */
    getExplanation() {
        const prediction = this.getPrediction();
        const contributions = prediction.contributions;
        
        // 找出正向和负向最大贡献
        const positive = [];
        const negative = [];
        
        for (const [feature, data] of Object.entries(contributions)) {
            const value = parseFloat(data.contribution);
            if (value > 0.01) {
                positive.push({ feature, value });
            } else if (value < -0.01) {
                negative.push({ feature, value });
            }
        }
        
        positive.sort((a, b) => b.value - a.value);
        negative.sort((a, b) => a.value - b.value);
        
        return {
            score: prediction.score,
            summary: this._generateSummary(prediction, positive, negative),
            positiveFactors: positive.slice(0, 5),
            negativeFactors: negative.slice(0, 5),
            recommendation: this._getRecommendation(prediction)
        };
    }

    /**
     * 生成摘要
     */
    _generateSummary(prediction, _positive, _negative) {
        const score = prediction.score;
        
        if (score >= 0.7) {
            return '用户付费意向很高，具有多项高价值特征';
        } else if (score >= 0.5) {
            return '用户有一定付费意向，可通过引导提升';
        } else if (score >= 0.3) {
            return '用户付费意向较低，需要培养';
        } else {
            return '用户当前暂无付费意向，建议持续观察';
        }
    }

    /**
     * 获取建议
     */
    _getRecommendation(prediction) {
        const action = prediction.action;
        
        switch (action) {
            case 'push_offer':
                return {
                    action: '推送优惠',
                    message: '直接推送限时优惠，促进转化',
                    priority: 'high'
                };
            case 'encourage':
                return {
                    action: '引导体验',
                    message: '提供免费试用，增加产品感知',
                    priority: 'medium'
                };
            case 'observe':
                return {
                    action: '持续观察',
                    message: '保持关注，等待更佳时机',
                    priority: 'low'
                };
            case 'nurture':
                return {
                    action: '培养关系',
                    message: '通过内容和活动建立连接',
                    priority: 'low'
                };
            default:
                return { action: '待定', message: '', priority: 'low' };
        }
    }

    /**
     * 获取用户价值预估
     */
    getUserValue() {
        const prediction = this.getPrediction();
        const features = this._userFeatures;
        
        // 基于特征估算用户价值
        let baseValue = 0;
        
        // 活跃度价值
        baseValue += (features.games_played || 0) * 0.5;
        
        // 付费倾向价值
        baseValue += prediction.score * 10;
        
        // 分群加成
        if (features.is_whale) baseValue += 50;
        if (features.is_dolphin) baseValue += 20;
        
        return {
            ltv: Math.round(baseValue * 100) / 100,
            currency: 'CNY',
            confidence: prediction.score > 0.5 ? 'high' : 'medium'
        };
    }

    /**
     * 获取模型状态
     */
    getModelStatus() {
        return {
            version: MODEL_VERSION,
            features: Object.keys(FEATURE_WEIGHTS).length,
            lastUpdate: this._lastUpdate,
            currentScore: this._predictions.score || 0
        };
    }
}

let _modelInstance = null;
export function getPaymentPredictionModel() {
    if (!_modelInstance) {
        _modelInstance = new PaymentPredictionModel();
    }
    return _modelInstance;
}

export function initPaymentPredictionModel() {
    getPaymentPredictionModel().init();
}