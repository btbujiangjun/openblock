/**
 * Enhanced FTUE System - 新手引导系统增强版
 * 
 * 功能：
 * 1. 多阶段引导（操作→策略→商业化）
 * 2. 逐步解锁功能
 * 3. 完成率与转化关联分析
 * 4. 智能引导调度
 */
import { getWallet } from '../skills/wallet.js';
import { getAnalyticsTracker } from '../monetization/analyticsTracker.js';
// applyGameEndProgression / getFeatureFlag 由 ftueManager 负责调度，本模块只定义阶段/步骤元数据。

const FTUE_STORAGE_KEY = 'openblock_ftue_v2';

/**
 * 引导阶段定义
 */
export const FTUE_STAGES = {
    // 阶段1：操作学习
    OPERATION: {
        id: 'operation',
        name: '基础操作',
        description: '学习游戏基本操作',
        unlockFeatures: [],
        priority: 1
    },
    // 阶段2：策略理解
    STRATEGY: {
        id: 'strategy',
        name: '游戏策略',
        description: '理解游戏策略和技巧',
        unlockFeatures: ['skill_bar', 'preview', 'hint'],
        priority: 2
    },
    // 阶段3：商业化入门
    MONETIZATION: {
        id: 'monetization',
        name: '游戏体验',
        description: '了解游戏内购和奖励',
        unlockFeatures: ['shop', 'season_pass', 'daily_tasks', 'checkin'],
        priority: 3
    },
    // 阶段4：社交与进阶
    SOCIAL: {
        id: 'social',
        name: '社交功能',
        description: '体验社交和竞技功能',
        unlockFeatures: ['leaderboard', 'invite', 'share'],
        priority: 4
    }
};

/**
 * 增强引导步骤定义（按阶段分组）
 */
export const FTUE_STEPS_V2 = {
    // 阶段1：操作学习
    operation: [
        {
            id: 'welcome',
            stage: 'operation',
            title: '欢迎来到 Block Blast！',
            description: '这是一个有趣的方块拼图游戏，来试试吧！',
            type: 'modal',
            position: 'center',
            nextButton: '开始游戏',
            reward: null
        },
        {
            id: 'drag_intro',
            stage: 'operation',
            title: '拖拽操作',
            description: '从底部拖拽方块到棋盘上',
            type: 'tooltip',
            target: '#dock-container',
            position: 'top',
            highlight: true,
            nextButton: '下一步',
            reward: null
        },
        {
            id: 'place_first',
            stage: 'operation',
            title: '放置方块',
            description: '把方块拖到棋盘上任意位置',
            type: 'game_tutorial',
            instruction: '请放置第一个方块',
            trigger: 'place_block',
            reward: { hintToken: 1 }
        },
        {
            id: 'clear_intro',
            stage: 'operation',
            title: '消除原理',
            description: '当一行或一列充满时会被消除',
            type: 'tooltip',
            target: '#game-grid',
            position: 'center',
            highlight: true,
            nextButton: '明白了',
            reward: null
        },
        {
            id: 'clear_first',
            stage: 'operation',
            title: '消除体验',
            description: '消除一行获得分数',
            type: 'game_tutorial',
            instruction: '尝试消除一行',
            trigger: 'clear_lines',
            reward: { hintToken: 1 }
        }
    ],
    
    // 阶段2：策略理解
    strategy: [
        {
            id: 'multi_line',
            stage: 'strategy',
            title: '多行消除',
            description: '同时消除多行可以获得更高分数！',
            type: 'modal',
            position: 'center',
            nextButton: '继续',
            reward: { hintToken: 2 }
        },
        {
            id: 'difficulty',
            stage: 'strategy',
            title: '选择难度',
            description: '有简单、普通、困难三种模式',
            type: 'tooltip',
            target: '#difficulty-select',
            position: 'bottom',
            nextButton: '知道了',
            reward: null
        },
        {
            id: 'hint_intro',
            stage: 'strategy',
            title: '提示功能',
            description: '遇到困难时可以使用提示',
            type: 'tooltip',
            target: '#hint-button',
            position: 'left',
            nextButton: '了解了',
            reward: { hintToken: 3 },
            unlockFeature: 'hint'
        },
        {
            id: 'preview_intro',
            stage: 'strategy',
            title: '预览功能',
            description: '长按方块可以看到预览',
            type: 'tooltip',
            target: '#preview-button',
            position: 'left',
            nextButton: '记住啦',
            reward: null,
            unlockFeature: 'preview'
        }
    ],
    
    // 阶段3：商业化入门
    monetization: [
        {
            id: 'shop_intro',
            stage: 'monetization',
            title: '商店系统',
            description: '这里可以购买提示、道具和特权',
            type: 'modal',
            position: 'center',
            nextButton: '去看看',
            reward: { coin: 50 },
            unlockFeature: 'shop'
        },
        {
            id: 'checkin_intro',
            stage: 'monetization',
            title: '每日签到',
            description: '每日签到可以领取丰富奖励',
            type: 'tooltip',
            target: '#checkin-button',
            position: 'right',
            nextButton: '知道了',
            reward: null,
            unlockFeature: 'checkin'
        },
        {
            id: 'daily_tasks_intro',
            stage: 'monetization',
            title: '每日任务',
            description: '完成任务获得额外奖励',
            type: 'tooltip',
            target: '#tasks-button',
            position: 'right',
            nextButton: '明白了',
            reward: null,
            unlockFeature: 'daily_tasks'
        },
        {
            id: 'first_purchase_hint',
            stage: 'monetization',
            title: '首充特惠',
            description: '首次购买享受超值优惠！',
            type: 'modal',
            position: 'center',
            nextButton: '考虑一下',
            reward: null,
            unlockFeature: 'shop'
        }
    ],
    
    // 阶段4：社交与进阶
    social: [
        {
            id: 'leaderboard_intro',
            stage: 'social',
            title: '排行榜',
            description: '和全球玩家比一比谁更强！',
            type: 'tooltip',
            target: '#leaderboard-button',
            position: 'top',
            nextButton: '去看看',
            reward: null,
            unlockFeature: 'leaderboard'
        },
        {
            id: 'invite_intro',
            stage: 'social',
            title: '邀请好友',
            description: '邀请好友一起玩，双方都有奖励',
            type: 'modal',
            position: 'center',
            nextButton: '邀请',
            reward: { coin: 100 },
            unlockFeature: 'invite'
        },
        {
            id: 'share_intro',
            stage: 'social',
            title: '分享战绩',
            description: '分享你的成绩到社交平台',
            type: 'tooltip',
            target: '#share-button',
            position: 'top',
            nextButton: '炫耀一下',
            reward: null,
            unlockFeature: 'share'
        },
        {
            id: 'complete',
            stage: 'social',
            title: '引导完成！',
            description: '你已经掌握游戏全部功能，祝你玩得开心！',
            type: 'modal',
            position: 'center',
            nextButton: '开始游戏',
            reward: { hintToken: 5, coin: 200 }
        }
    ]
};

/**
 * 转化目标映射
 */
const CONVERSION_GOALS = {
    'operation': ['game_complete', 'first_clear'],
    'strategy': ['use_hint', 'use_preview', 'complete_daily'],
    'monetization': ['view_shop', 'view_checkin', 'first_purchase'],
    'social': ['view_leaderboard', 'invite_friend', 'share_score']
};

class EnhancedFTUE {
    constructor() {
        this._currentStage = 'operation';
        this._currentStepIndex = 0;
        this._completedSteps = [];
        this._unlockedFeatures = new Set();
        this._stageProgress = {};
        this._onStepChange = null;
        this._analytics = null;
    }

    /**
     * 初始化
     */
    init() {
        this._loadProgress();
        this._initAnalytics();
        console.log('[FTUE] Enhanced FTUE initialized, stage:', this._currentStage);
    }

    /**
     * 加载进度
     */
    _loadProgress() {
        try {
            const stored = localStorage.getItem(FTUE_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                this._currentStage = data.currentStage || 'operation';
                this._currentStepIndex = data.currentStepIndex || 0;
                this._completedSteps = data.completedSteps || [];
                this._unlockedFeatures = new Set(data.unlockedFeatures || []);
                this._stageProgress = data.stageProgress || {};
            }
        } catch {}
    }

    /**
     * 保存进度
     */
    _saveProgress() {
        try {
            localStorage.setItem(FTUE_STORAGE_KEY, JSON.stringify({
                currentStage: this._currentStage,
                currentStepIndex: this._currentStepIndex,
                completedSteps: this._completedSteps,
                unlockedFeatures: Array.from(this._unlockedFeatures),
                stageProgress: this._stageProgress
            }));
        } catch {}
    }

    /**
     * 初始化分析
     */
    _initAnalytics() {
        try {
            this._analytics = getAnalyticsTracker();
        } catch {}
    }

    /**
     * 获取当前阶段的步骤
     */
    _getCurrentStageSteps() {
        return FTUE_STEPS_V2[this._currentStage] || [];
    }

    /**
     * 获取当前步骤
     */
    getCurrentStep() {
        const steps = this._getCurrentStageSteps();
        if (this._currentStepIndex >= steps.length) {
            return null;
        }
        return steps[this._currentStepIndex];
    }

    /**
     * 开始/继续引导
     */
    startFTUE() {
        if (this.isCompleted()) {
            console.log('[FTUE] Already completed');
            return null;
        }

        const step = this.getCurrentStep();
        
        // 记录开始事件
        this._trackEvent('ftue_start', {
            stage: this._currentStage,
            step: step?.id
        });

        return step;
    }

    /**
     * 下一步
     */
    nextStep() {
        const currentStep = this.getCurrentStep();
        
        // 记录完成事件
        if (currentStep) {
            this._completedSteps.push(currentStep.id);
            
            // 发放奖励
            if (currentStep.reward) {
                this._giveReward(currentStep.reward);
            }
            
            // 解锁功能
            if (currentStep.unlockFeature) {
                this._unlockFeature(currentStep.unlockFeature);
            }
            
            // 记录阶段进度
            this._stageProgress[this._currentStage] = 
                (this._stageProgress[this._currentStage] || 0) + 1;
            
            // 跟踪转化
            this._trackConversion(currentStep.stage, currentStep.id);
        }

        this._currentStepIndex++;
        
        // 检查是否需要切换阶段
        if (this._currentStepIndex >= this._getCurrentStageSteps().length) {
            this._moveToNextStage();
        }

        this._saveProgress();

        // 触发下一步或返回null（完成）
        const nextStep = this.getCurrentStep();
        
        // 通知回调
        if (this._onStepChange) {
            this._onStepChange(nextStep);
        }
        
        return nextStep;
    }

    /**
     * 切换到下一阶段
     */
    _moveToNextStage() {
        const stageOrder = ['operation', 'strategy', 'monetization', 'social'];
        const currentIndex = stageOrder.indexOf(this._currentStage);
        
        if (currentIndex < stageOrder.length - 1) {
            this._currentStage = stageOrder[currentIndex + 1];
            this._currentStepIndex = 0;
            
            // 记录阶段完成
            this._trackEvent('ftue_stage_complete', {
                stage: stageOrder[currentIndex],
                completedSteps: this._stageProgress[stageOrder[currentIndex]]
            });
            
            console.log('[FTUE] Moving to stage:', this._currentStage);
        }
    }

    /**
     * 解锁功能
     */
    _unlockFeature(featureId) {
        if (!this._unlockedFeatures.has(featureId)) {
            this._unlockedFeatures.add(featureId);
            
            // 通过 featureFlags 或事件通知系统
            try {
                // 触发功能解锁事件
                const event = new CustomEvent('ftue_feature_unlock', {
                    detail: { featureId }
                });
                window.dispatchEvent(event);
            } catch {}
            
            console.log('[FTUE] Feature unlocked:', featureId);
        }
    }

    /**
     * 发放奖励
     */
    _giveReward(reward) {
        const wallet = getWallet();
        
        if (reward.hintToken) {
            wallet.addBalance('hintToken', reward.hintToken, 'ftue_reward');
        }
        if (reward.coin) {
            wallet.addBalance('coin', reward.coin, 'ftue_reward');
        }
        
        console.log('[FTUE] Reward given:', reward);
    }

    /**
     * 跟踪事件
     */
    _trackEvent(eventName, properties = {}) {
        if (this._analytics) {
            this._analytics.trackEvent(eventName, {
                ...properties,
                ftue_stage: this._currentStage,
                ftue_step: this._currentStepIndex
            });
        }
    }

    /**
     * 跟踪转化
     */
    _trackConversion(stage, stepId) {
        const goals = CONVERSION_GOALS[stage] || [];
        if (goals.length > 0) {
            // 记录转化目标达成
            this._trackEvent('ftue_goal_reached', {
                stage,
                stepId,
                goal: goals[Math.floor(this._currentStepIndex / 2)]
            });
        }
    }

    /**
     * 完成特定步骤（游戏事件触发）
     */
    completeStep(stepId) {
        const steps = this._getCurrentStageSteps();
        const stepIndex = steps.findIndex(s => s.id === stepId);
        
        // 如果是当前步骤或之前的步骤，记录完成
        if (stepIndex !== -1 && stepIndex <= this._currentStepIndex) {
            // 跳到该步骤的下一位
            while (this._currentStepIndex <= stepIndex) {
                this.nextStep();
            }
            return true;
        }
        
        return false;
    }

    /**
     * 检查是否已完成
     */
    isCompleted() {
        return this._currentStage === 'social' && 
               this._currentStepIndex >= FTUE_STEPS_V2.social.length;
    }

    /**
     * 获取已解锁功能列表
     */
    getUnlockedFeatures() {
        return Array.from(this._unlockedFeatures);
    }

    /**
     * 检查功能是否已解锁
     */
    isFeatureUnlocked(featureId) {
        return this._unlockedFeatures.has(featureId);
    }

    /**
     * 获取当前阶段信息
     */
    getStageInfo() {
        const stage = FTUE_STAGES[this._currentStage];
        const steps = this._getCurrentStageSteps();
        
        return {
            ...stage,
            currentStep: this._currentStepIndex + 1,
            totalSteps: steps.length,
            progress: ((this._currentStepIndex + 1) / steps.length * 100).toFixed(0) + '%'
        };
    }

    /**
     * 获取所有阶段进度
     */
    getAllStageProgress() {
        const progress = [];
        
        for (const [stageId, stage] of Object.entries(FTUE_STAGES)) {
            const steps = FTUE_STEPS_V2[stageId] || [];
            const completed = (this._stageProgress[stageId] || 0);
            
            progress.push({
                id: stageId,
                name: stage.name,
                completed,
                total: steps.length,
                unlocked: this._currentStage === stageId || 
                         Object.keys(FTUE_STAGES).indexOf(stageId) < Object.keys(FTUE_STAGES).indexOf(this._currentStage)
            });
        }
        
        return progress;
    }

    /**
     * 获取分析数据
     */
    getAnalytics() {
        const completedSteps = this._completedSteps.length;
        const totalSteps = Object.values(FTUE_STEPS_V2).reduce((sum, arr) => sum + arr.length, 0);
        
        // 计算各阶段转化
        const stageConversions = {};
        for (const [stageId, goals] of Object.entries(CONVERSION_GOALS)) {
            stageConversions[stageId] = {
                goals: goals.length,
                completed: this._stageProgress[stageId] || 0,
                rate: ((this._stageProgress[stageId] || 0) / Math.max(1, goals.length) * 100).toFixed(0) + '%'
            };
        }
        
        return {
            overallProgress: ((completedSteps / totalSteps) * 100).toFixed(0) + '%',
            completedSteps,
            totalSteps,
            currentStage: this._currentStage,
            unlockedFeatures: this._unlockedFeatures.size,
            stageConversions
        };
    }

    /**
     * 重置引导（调试用）
     */
    resetFTUE() {
        this._currentStage = 'operation';
        this._currentStepIndex = 0;
        this._completedSteps = [];
        this._unlockedFeatures = new Set();
        this._stageProgress = {};
        this._saveProgress();
        
        this._trackEvent('ftue_reset');
        
        console.log('[FTUE] Reset');
    }

    /**
     * 注册步骤变化回调
     */
    onStepChange(callback) {
        this._onStepChange = callback;
    }

    /**
     * 获取状态
     */
    getStatus() {
        return {
            currentStage: this._currentStage,
            currentStep: this._currentStepIndex,
            completedSteps: this._completedSteps.length,
            totalSteps: Object.values(FTUE_STEPS_V2).reduce((sum, arr) => sum + arr.length, 0),
            isCompleted: this.isCompleted(),
            unlockedFeatures: Array.from(this._unlockedFeatures)
        };
    }
}

let _ftueInstance = null;
export function getEnhancedFTUE() {
    if (!_ftueInstance) {
        _ftueInstance = new EnhancedFTUE();
    }
    return _ftueInstance;
}

export function initEnhancedFTUE() {
    getEnhancedFTUE().init();
}

// FTUE_STAGES、FTUE_STEPS_V2 已在文件顶部声明时直接 export，此处仅补充 CONVERSION_GOALS 的导出
export { CONVERSION_GOALS };