/**
 * difficultyPredictor.js — 基于玩家行为信号的 ML 难度预测模型
 * 
 * 使用简化版线性回归 + 特征工程预测最佳难度等级
 * 在客户端运行，实时输出 difficulty recommendation
 * 
 * 特征维度：
 * - performanceFeatures: 最近 N 局的得分、消除、存活率
 * - behaviorFeatures: 操作速度、决策模式、风险偏好
 * - temporalFeatures: 游玩时段、时长、间隔
 * - contextualFeatures: 连续失败次数、心流状态、挫败度
 */

const MODEL_VERSION = '1.0.0';
const FEATURE_WINDOW = 5;

const FEATURE_CONFIG = {
    performance: {
        avgScore: { weight: 0.15, transform: 'log' },
        avgClears: { weight: 0.12, transform: 'linear' },
        winRate: { weight: 0.18, transform: 'linear' },
        scoreVariance: { weight: -0.08, transform: 'linear' },
        clearEfficiency: { weight: 0.10, transform: 'linear' },
    },
    behavior: {
        avgPlacementTime: { weight: 0.05, transform: 'linear' },
        quickDecisionRate: { weight: 0.06, transform: 'linear' },
        undoUsage: { weight: -0.04, transform: 'linear' },
        hintUsage: { weight: -0.03, transform: 'linear' },
    },
    temporal: {
        sessionsToday: { weight: 0.04, transform: 'linear' },
        avgSessionLength: { weight: 0.05, transform: 'log' },
        daysSinceInstall: { weight: 0.08, transform: 'log' },
        timeOfDay: { weight: 0.02, transform: 'categorical' },
    },
    contextual: {
        consecutiveFails: { weight: -0.12, transform: 'linear' },
        flowState: { weight: 0.10, transform: 'categorical' },
        frustrationLevel: { weight: -0.08, transform: 'linear' },
        momentum: { weight: 0.08, transform: 'linear' },
    }
};

const DIFFICULTY_LEVELS = ['easy', 'normal', 'hard', 'expert'];
const DIFFICULTY_THRESHOLDS = [
    { max: 0.25, level: 'easy' },
    { max: 0.50, level: 'normal' },
    { max: 0.75, level: 'hard' },
    { max: 1.00, level: 'expert' }
];

let _instance = null;
let _featureBuffer = [];
let _modelTrained = false;
let _coefficients = null;

function clamp01(v) {
    return Math.max(0, Math.min(1, v));
}

function transformValue(value, transform) {
    switch (transform) {
        case 'log':
            return Math.log1p(Math.max(0, value)) / 10;
        case 'linear':
            return clamp01(value);
        case 'categorical':
            return value;
        default:
            return value;
    }
}

function extractFeatures(gameStats, playerProfile) {
    const features = {};
    
    const recentGames = _featureBuffer.slice(-FEATURE_WINDOW);
    
    if (recentGames.length > 0) {
        const scores = recentGames.map(g => g.score || 0);
        const clears = recentGames.map(g => g.clears || 0);
        
        features.avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
        features.avgClears = clears.reduce((a, b) => a + b, 0) / clears.length;
        features.scoreVariance = computeVariance(scores);
        features.clearEfficiency = features.avgClears / Math.max(1, features.avgScore / 100);
        
        const wins = recentGames.filter(g => g.achieved).length;
        features.winRate = wins / recentGames.length;
    } else {
        features.avgScore = 0;
        features.avgClears = 0;
        features.scoreVariance = 0;
        features.clearEfficiency = 0;
        features.winRate = 0.5;
    }
    
    features.avgPlacementTime = playerProfile?.avgPlacementTime ?? 2.0;
    features.quickDecisionRate = playerProfile?.quickDecisionRate ?? 0.3;
    features.undoUsage = playerProfile?.undoUsage ?? 0;
    features.hintUsage = playerProfile?.hintUsage ?? 0;
    
    const now = new Date();
    features.sessionsToday = playerProfile?.sessionsToday ?? 1;
    features.avgSessionLength = playerProfile?.avgSessionLength ?? 5;
    features.daysSinceInstall = playerProfile?.daysSinceInstall ?? 1;
    features.timeOfDay = now.getHours() < 12 ? 0 : now.getHours() < 18 ? 0.5 : 1;
    
    features.consecutiveFails = playerProfile?.consecutiveFails ?? 0;
    features.flowState = { flow: 0.8, bored: 0.1, anxious: 0.1 }[playerProfile?.flowState] ?? 0.5;
    features.frustrationLevel = playerProfile?.frustrationLevel ?? 0;
    features.momentum = playerProfile?.momentum ?? 0;
    
    return features;
}

function computeVariance(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const squaredDiffs = arr.map(x => Math.pow(x - mean, 2));
    return squaredDiffs.reduce((a, b) => a + b, 0) / arr.length;
}

function computeWeightedScore(features) {
    let score = 0.5;

    for (const [, configs] of Object.entries(FEATURE_CONFIG)) {
        for (const [featureName, config] of Object.entries(configs)) {
            const rawValue = features[featureName] ?? 0;
            const transformed = transformValue(rawValue, config.transform);
            score += transformed * config.weight;
        }
    }

    return clamp01(score);
}

/**
 * 在加权分基础上叠加“安全网”与“个性化”启发式调整。
 *
 * 设计原则：
 * 1. 当玩家明显挣扎（连续失败 / 焦虑 / 需要恢复）时必须降难度，且 **优先级高于** 夜间增难等通用偏置。
 * 2. 连续失败按阶梯惩罚，避免阈值边界处出现 1 局之差就跳两个等级的尖刺。
 * 3. 极端情形（onboarding / recovery / survival）使用上限钳制保证下限明确。
 */
function applyHeuristics(baseScore, features, playerProfile) {
    let adjustedScore = baseScore;

    // 1. 连续失败：阶梯式惩罚（≥3 -0.15；≥5 -0.25；≥7 -0.35）
    if (features.consecutiveFails >= 7) {
        adjustedScore -= 0.35;
    } else if (features.consecutiveFails >= 5) {
        adjustedScore -= 0.25;
    } else if (features.consecutiveFails >= 3) {
        adjustedScore -= 0.15;
    }

    // 2. 焦虑情绪：再压低 0.1，并保证不超过 0.5
    const isAnxious = playerProfile?.flowState === 'anxious';
    if (isAnxious) {
        adjustedScore = Math.min(adjustedScore, 0.5) - 0.1;
    }

    // 3. 强约束：新手 / 需要恢复 / 求生型，使用上限钳制
    if (playerProfile?.isInOnboarding) {
        adjustedScore = Math.min(adjustedScore, 0.3);
    }
    if (playerProfile?.needsRecovery) {
        adjustedScore = Math.min(adjustedScore, 0.4);
    }
    if (playerProfile?.playstyle === 'survival') {
        adjustedScore = Math.min(adjustedScore, 0.5);
    }

    // 4. 完美猎人：保证最低难度下限
    if (playerProfile?.playstyle === 'perfect_hunter') {
        adjustedScore = Math.max(adjustedScore, 0.6);
    }

    // 5. 夜间小幅加难度——但若玩家已处于安全网（连败 / 焦虑），跳过此偏置
    const timeOfDay = features.timeOfDay;
    const inSafetyNet = (features.consecutiveFails >= 3) || isAnxious
        || playerProfile?.needsRecovery || playerProfile?.isInOnboarding;
    if (timeOfDay > 0.8 && !inSafetyNet) {
        adjustedScore += 0.05;
    }

    return clamp01(adjustedScore);
}

function scoreToLevel(score) {
    for (const threshold of DIFFICULTY_THRESHOLDS) {
        if (score <= threshold.max) {
            return threshold.level;
        }
    }
    return 'expert';
}

export function initDifficultyPredictor() {
    _featureBuffer = [];
    _modelTrained = true;
    _coefficients = {};
    
    for (const category of Object.keys(FEATURE_CONFIG)) {
        for (const feature of Object.keys(FEATURE_CONFIG[category])) {
            _coefficients[feature] = FEATURE_CONFIG[category][feature].weight;
        }
    }
}

export function recordGameResult(gameStats) {
    _featureBuffer.push({
        score: gameStats.score ?? 0,
        clears: gameStats.clears ?? 0,
        achieved: gameStats.achieved ?? false,
        timestamp: Date.now()
    });
    
    if (_featureBuffer.length > 50) {
        _featureBuffer.shift();
    }
}

export function predictDifficulty(playerProfile) {
    const features = extractFeatures(null, playerProfile);
    
    let baseScore = computeWeightedScore(features);
    
    baseScore = applyHeuristics(baseScore, features, playerProfile);
    
    const recommendedLevel = scoreToLevel(baseScore);
    
    const confidence = Math.min(1, _featureBuffer.length / 3);
    
    const alternatives = DIFFICULTY_LEVELS.map(level => ({
        level,
        score: level === recommendedLevel ? baseScore : baseScore + (Math.random() - 0.5) * 0.2
    })).sort((a, b) => b.score - a.score);
    
    return {
        recommended: recommendedLevel,
        score: baseScore,
        confidence,
        alternatives,
        features,
        modelVersion: MODEL_VERSION
    };
}

function getDifficultyAdjustment(currentLevel, playerProfile) {
    const prediction = predictDifficulty(playerProfile);
    
    const currentIndex = DIFFICULTY_LEVELS.indexOf(currentLevel);
    const recommendedIndex = DIFFICULTY_LEVELS.indexOf(prediction.recommended);
    
    const adjustment = recommendedIndex - currentIndex;
    
    return {
        adjustment,
        reason: generateReason(prediction, playerProfile),
        prediction
    };
}

function generateReason(prediction, playerProfile) {
    const reasons = [];
    
    if (prediction.features.winRate > 0.7) {
        reasons.push('胜率高，建议提升难度');
    }
    
    if (prediction.features.consecutiveFails >= 3) {
        reasons.push('连续失败，降低难度');
    }
    
    if (playerProfile?.needsRecovery) {
        reasons.push('需要恢复，降低难度');
    }
    
    if (playerProfile?.playstyle === 'perfect_hunter') {
        reasons.push('清屏型玩家，增加挑战');
    }
    
    if (reasons.length === 0) {
        reasons.push('基于表现动态调整');
    }
    
    return reasons;
}

function getRetentionMetrics() {
    if (_featureBuffer.length < 2) {
        return { trend: 'unknown', improvement: 0 };
    }
    
    const recent = _featureBuffer.slice(-3);
    const older = _featureBuffer.slice(-6, -3);
    
    if (older.length === 0) {
        return { trend: 'improving', improvement: 0 };
    }
    
    const recentAvg = recent.reduce((s, g) => s + g.score, 0) / recent.length;
    const olderAvg = older.reduce((s, g) => s + g.score, 0) / older.length;
    
    const improvement = (recentAvg - olderAvg) / Math.max(1, olderAvg);
    
    let trend = 'stable';
    if (improvement > 0.1) trend = 'improving';
    else if (improvement < -0.1) trend = 'declining';
    
    return { trend, improvement };
}

export function getDifficultyPredictor() {
    if (!_instance) {
        _instance = {
            predict: predictDifficulty,
            record: recordGameResult,
            adjust: getDifficultyAdjustment,
            metrics: getRetentionMetrics,
            init: initDifficultyPredictor
        };
    }
    return _instance;
}

function _getDifficultyPredictorInstance() {
    return getDifficultyPredictor();
}