/**
 * goalSystem.js — 短期与长期目标系统
 * 
 * 短期目标：每局内可达成的里程碑（分数、消行、存活轮数）
 * 长期目标：跨局累积目标（关卡进度、成就、数据里程碑）
 * 
 * 设计：
 * - 自动追踪游戏事件并生成目标
 * - 完成后自动发放奖励
 * - 支持进度可视化
 * - 支持目标过期机制
 */

const GOAL_TYPES = {
    SHORT_TERM: 'short_term',
    LONG_TERM: 'long_term'
};

const SHORT_TERM_MILESTONES = [
    { type: 'score', thresholds: [100, 250, 500, 1000, 2000, 5000], name: '得分里程碑' },
    { type: 'clear', thresholds: [3, 5, 10, 15, 25, 50], name: '消行里程碑' },
    { type: 'survival', thresholds: [10, 20, 30, 50, 75, 100], name: '存活里程碑' },
    { type: 'combo', thresholds: [3, 5, 10, 15, 20, 30], name: '连消里程碑' },
    { type: 'streak', thresholds: [3, 5, 10, 15, 20], name: '连胜里程碑' }
];

const LONG_TERM_CATEGORIES = {
    PROGRESSION: {
        id: 'progression',
        name: '关卡进度',
        icon: '🎯',
        goals: [
            { id: 'complete_5_levels', target: 5, reward: { coin: 100, gem: 10 } },
            { id: 'complete_10_levels', target: 10, reward: { coin: 200, gem: 25 } },
            { id: 'complete_20_levels', target: 20, reward: { coin: 500, gem: 50 } },
            { id: 'all_stars_10', target: 10, reward: { coin: 300, gem: 30 } },
            { id: 'all_stars_20', target: 20, reward: { coin: 800, gem: 80 } },
            { id: 'perfect_clear_5', target: 5, reward: { coin: 200, gem: 20 } },
            { id: 'no_hint_level', target: 1, reward: { coin: 150, gem: 15 } },
        ]
    },
    COLLECTION: {
        id: 'collection',
        name: '收集成就',
        icon: '🏆',
        goals: [
            { id: 'score_10k', target: 10000, reward: { coin: 500, gem: 50 } },
            { id: 'score_50k', target: 50000, reward: { coin: 1000, gem: 100 } },
            { id: 'score_100k', target: 100000, reward: { coin: 2000, gem: 200 } },
            { id: 'clear_100', target: 100, reward: { coin: 300, gem: 30 } },
            { id: 'clear_500', target: 500, reward: { coin: 800, gem: 80 } },
            { id: 'games_50', target: 50, reward: { coin: 200, gem: 20 } },
            { id: 'games_200', target: 200, reward: { coin: 500, gem: 50 } },
            { id: 'perfect_clears_10', target: 10, reward: { coin: 400, gem: 40 } },
        ]
    },
    STREAK: {
        id: 'streak',
        name: '连续挑战',
        icon: '🔥',
        goals: [
            { id: 'daily_3', target: 3, reward: { coin: 100, gem: 10 } },
            { id: 'daily_7', target: 7, reward: { coin: 300, gem: 30 } },
            { id: 'daily_30', target: 30, reward: { coin: 1000, gem: 100 } },
            { id: 'win_streak_5', target: 5, reward: { coin: 200, gem: 20 } },
            { id: 'win_streak_10', target: 10, reward: { coin: 500, gem: 50 } },
        ]
    },
    MASTERY: {
        id: 'mastery',
        name: '精通挑战',
        icon: '⭐',
        goals: [
            { id: 'hard_complete', target: 1, reward: { coin: 500, gem: 50 } },
            { id: 'expert_complete', target: 1, reward: { coin: 1000, gem: 100 } },
            { id: 'score_5k_single', target: 5000, reward: { coin: 300, gem: 30 } },
            { id: 'clear_20_single', target: 20, reward: { coin: 400, gem: 40 } },
            { id: 'survive_30_rounds', target: 30, reward: { coin: 500, gem: 50 } },
        ]
    }
};

let _instance = null;
let _shortTermGoals = [];
let _longTermGoals = [];
let _progress = {
    totalScore: 0,
    totalClears: 0,
    totalGames: 0,
    perfectClears: 0,
    levelsCompleted: 0,
    totalStars: 0,
    dailyStreak: 0,
    winStreak: 0,
    lastPlayedDate: null
};

function initGoals() {
    _shortTermGoals = [];
    _longTermGoals = [];
    
    for (const category of Object.values(LONG_TERM_CATEGORIES)) {
        for (const goal of category.goals) {
            _longTermGoals.push({
                ...goal,
                category: category.id,
                categoryName: category.name,
                icon: category.icon,
                current: 0,
                completed: false,
                claimed: false
            });
        }
    }
}

function updateProgress(gameResult) {
    _progress.totalScore += gameResult.score ?? 0;
    _progress.totalClears += gameResult.clears ?? 0;
    _progress.totalGames += 1;
    _progress.perfectClears += gameResult.perfectClears ? 1 : 0;
    
    if (gameResult.achieved) {
        _progress.winStreak += 1;
    } else {
        _progress.winStreak = 0;
    }
    
    const today = new Date().toDateString();
    if (_progress.lastPlayedDate !== today) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        if (_progress.lastPlayedDate === yesterday.toDateString()) {
            _progress.dailyStreak += 1;
        } else {
            _progress.dailyStreak = 1;
        }
        _progress.lastPlayedDate = today;
    }
}

function checkLongTermGoals() {
    const newlyCompleted = [];
    
    for (const goal of _longTermGoals) {
        if (goal.completed || goal.claimed) continue;
        
        let current = 0;
        switch (goal.id) {
            case 'complete_5_levels':
            case 'complete_10_levels':
            case 'complete_20_levels':
                current = _progress.levelsCompleted;
                break;
            case 'all_stars_10':
            case 'all_stars_20':
                current = _progress.totalStars;
                break;
            case 'perfect_clear_5':
                current = _progress.perfectClears;
                break;
            case 'score_10k':
            case 'score_50k':
            case 'score_100k':
                current = _progress.totalScore;
                break;
            case 'clear_100':
            case 'clear_500':
                current = _progress.totalClears;
                break;
            case 'games_50':
            case 'games_200':
                current = _progress.totalGames;
                break;
            case 'daily_3':
            case 'daily_7':
            case 'daily_30':
                current = _progress.dailyStreak;
                break;
            case 'win_streak_5':
            case 'win_streak_10':
                current = _progress.winStreak;
                break;
            default:
                current = 0;
        }
        
        goal.current = current;
        
        if (current >= goal.target) {
            goal.completed = true;
            newlyCompleted.push(goal);
        }
    }
    
    return newlyCompleted;
}

function generateShortTermGoals(gameStats) {
    _shortTermGoals = [];
    
    for (const milestone of SHORT_TERM_MILESTONES) {
        const currentValue = gameStats[milestone.type] ?? 0;
        
        for (const threshold of milestone.thresholds) {
            if (currentValue >= threshold) continue;
            
            _shortTermGoals.push({
                id: `${milestone.type}_${threshold}`,
                type: GOAL_TYPES.SHORT_TERM,
                category: milestone.type,
                target: threshold,
                current: currentValue,
                progress: currentValue / threshold,
                name: `${milestone.name} ${threshold}`,
                claimed: false
            });
            
            break;
        }
    }
    
    _shortTermGoals.sort((a, b) => a.target - b.target);
    return _shortTermGoals;
}

function getActiveLongTermGoals() {
    return _longTermGoals.filter(g => !g.claimed);
}

function getCompletedLongTermGoals() {
    return _longTermGoals.filter(g => g.completed && !g.claimed);
}

function claimReward(goalId) {
    const goal = _longTermGoals.find(g => g.id === goalId);
    if (!goal || !goal.completed || goal.claimed) {
        return null;
    }
    
    goal.claimed = true;
    return goal.reward;
}

function getProgressSummary() {
    const byCategory = {};
    for (const category of Object.values(LONG_TERM_CATEGORIES)) {
        const goals = _longTermGoals.filter(g => g.category === category.id);
        const completed = goals.filter(g => g.completed).length;
        byCategory[category.id] = {
            name: category.name,
            icon: category.icon,
            completed,
            total: goals.length
        };
    }
    
    return {
        shortTerm: _shortTermGoals,
        longTerm: {
            active: getActiveLongTermGoals().length,
            completed: getCompletedLongTermGoals().length,
            byCategory
        },
        stats: _progress
    };
}

function updateLevelProgress(levelId, stars, achieved) {
    if (achieved) {
        _progress.levelsCompleted += 1;
        _progress.totalStars += stars;
    }
}

export function getGoalSystem() {
    if (!_instance) {
        _instance = {
            init: initGoals,
            updateProgress,
            checkGoals: checkLongTermGoals,
            generateShortTerm: generateShortTermGoals,
            getActiveLongTerm: getActiveLongTermGoals,
            getCompletedLongTerm: getCompletedLongTermGoals,
            claimReward,
            getSummary: getProgressSummary,
            updateLevelProgress,
            getProgress: () => _progress
        };
    }
    return _instance;
}

export function initGoalSystem() {
    const system = getGoalSystem();
    system.init();
    return system;
}

export function getGoalSystemInstance() {
    return getGoalSystem();
}