/**
 * retentionManager.js — 留存与难度曲线集成管理器
 * 
 * 整合以下模块：
 * - difficultyPredictor.js: ML 难度预测
 * - goalSystem.js: 目标系统
 * - levelProgression.js: 关卡进度
 * - adaptiveSpawn.js: 自适应出块
 * 
 * 提供统一的留存优化 API
 */

import { getDifficultyPredictor, initDifficultyPredictor, predictDifficulty, recordGameResult } from './difficultyPredictor.js';
import { getGoalSystem, initGoalSystem } from './goalSystem.js';
import { initLevelProgression, getLevelProgression } from './levelProgression.js';

let _instance = null;
let _initialized = false;
let _userId = null;

export function initRetentionManager(userId) {
    if (_initialized) return;
    
    _userId = userId;
    
    initDifficultyPredictor();
    initGoalSystem();
    initLevelProgression();
    
    _initialized = true;
}

export function getRetentionManager() {
    if (!_instance) {
        _instance = {
            init: initRetentionManager,
            
            afterGameEnd: function(gameResult) {
                recordGameResult({
                    score: gameResult.score,
                    clears: gameResult.clears,
                    achieved: gameResult.achieved,
                    perfectClears: gameResult.perfectClears
                });
                
                const goalSystem = getGoalSystem();
                goalSystem.updateProgress({
                    score: gameResult.score,
                    clears: gameResult.clears,
                    achieved: gameResult.achieved,
                    perfectClears: gameResult.perfectClears
                });
                
                const newlyCompleted = goalSystem.checkGoals();
                
                return {
                    completedGoals: newlyCompleted,
                    canClaim: newlyCompleted.length > 0
                };
            },
            
            getDifficultyRecommendation: function(playerProfile) {
                return predictDifficulty(playerProfile);
            },
            
            getActiveGoals: function() {
                const goalSystem = getGoalSystem();
                return {
                    shortTerm: goalSystem.generateShortTerm(
                        getLevelProgression().getSummary()
                    ),
                    longTerm: goalSystem.getActiveLongTerm()
                };
            },
            
            getGoalProgress: function() {
                return getGoalSystem().getSummary();
            },
            
            claimGoalReward: function(goalId) {
                return getGoalSystem().claimReward(goalId);
            },
            
            getLevelSummary: function() {
                return getLevelProgression().getSummary();
            },
            
            getChapterProgress: function() {
                return getLevelProgression().getChapters();
            },
            
            getRetentionInsights: function() {
                const difficultyPredictor = getDifficultyPredictor();
                const levelProgression = getLevelProgression();
                const goalSystem = getGoalSystem();
                
                const retention = difficultyPredictor.metrics();
                const summary = levelProgression.getSummary();
                const goalProgress = goalSystem.getSummary();
                
                return {
                    retention,
                    levelProgress: {
                        completed: summary.completedLevels,
                        total: summary.totalLevels,
                        percent: summary.completionPercent.toFixed(1)
                    },
                    stars: {
                        current: summary.totalStars,
                        max: summary.maxPossibleStars,
                        percent: summary.starPercent.toFixed(1)
                    },
                    goals: {
                        active: goalProgress.longTerm.active,
                        completed: goalProgress.longTerm.completed
                    },
                    recommendations: generateRecommendations(retention, summary, goalProgress)
                };
            },
            
            startLevel: function(levelId) {
                return getLevelProgression().startLevel(levelId);
            },
            
            completeLevel: function(levelId, result) {
                const progression = getLevelProgression();
                const completion = progression.completeLevel(levelId, result);
                
                getGoalSystem().updateLevelProgress(
                    levelId,
                    result.stars,
                    result.achieved
                );
                
                getGoalSystem().checkGoals();
                
                return completion;
            },
            
            getLevelStatus: function(levelId) {
                return getLevelProgression().getLevelStatus(levelId);
            }
        };
    }
    return _instance;
}

function generateRecommendations(retention, levelSummary, goalProgress) {
    const recommendations = [];
    
    if (retention.trend === 'declining') {
        recommendations.push({
            type: 'retention',
            priority: 'high',
            message: '玩家表现下滑，建议降低难度或提供帮助',
            action: 'difficulty_adjust'
        });
    }
    
    if (levelSummary.completionPercent < 30) {
        recommendations.push({
            type: 'progression',
            priority: 'medium',
            message: '关卡进度较慢，建议增加短期目标激励',
            action: 'add_milestone_rewards'
        });
    }
    
    if (goalProgress.longTerm.active > 5) {
        recommendations.push({
            type: 'engagement',
            priority: 'low',
            message: '长期目标较多，考虑添加阶段奖励',
            action: 'add_tier_rewards'
        });
    }
    
    if (retention.trend === 'improving' && levelSummary.completionPercent > 60) {
        recommendations.push({
            type: 'challenge',
            priority: 'medium',
            message: '玩家成长良好，可以适当提升挑战',
            action: 'increase_difficulty'
        });
    }
    
    return recommendations;
}

function _getRetentionManagerInstance() {
    return getRetentionManager();
}