/**
 * FTUEManager - 新手引导系统
 * 
 * 功能：
 * 1. 多阶段引导
 * 2. 引导进度保存
 * 3. 引导完成检测
 * 4. 引导奖励发放
 */
import { getWallet } from '../skills/wallet.js';
import { applyGameEndProgression } from '../progression.js';

const STORAGE_KEY = 'openblock_ftue_v1';

/**
 * 引导步骤定义
 */
export const FTUE_STEPS = [
    {
        id: 'welcome',
        title: '欢迎来到 Block Blast！',
        description: '这是一个有趣的方块拼图游戏，来试试吧！',
        type: 'modal',
        position: 'center',
        nextButton: '开始游戏',
        reward: null
    },
    {
        id: 'drag_intro',
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
        title: '放置方块',
        description: '把方块拖到棋盘上任意位置',
        type: 'game_tutorial',
        instruction: '请放置第一个方块',
        trigger: 'place_block',
        reward: { hintToken: 1 }
    },
    {
        id: 'clear_intro',
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
        title: '消除体验',
        description: '消除一行获得分数',
        type: 'game_tutorial',
        instruction: '尝试消除一行',
        trigger: 'clear_line',
        reward: { hintToken: 1 }
    },
    {
        id: 'multi_line',
        title: '多行消除',
        description: '同时消除多行可以获得更高分数！',
        type: 'modal',
        position: 'center',
        nextButton: '继续游戏',
        reward: { hintToken: 2 }
    },
    {
        id: 'difficulty',
        title: '选择难度',
        description: '有简单、普通、困难三种模式',
        type: 'tooltip',
        target: '#difficulty-select',
        position: 'bottom',
        nextButton: '知道了',
        reward: null
    },
    {
        id: 'complete',
        title: '引导完成！',
        description: '你已经掌握了基本玩法，祝你玩得开心！',
        type: 'modal',
        position: 'center',
        nextButton: '开始游戏',
        reward: { hintToken: 3, coin: 100 }
    }
];

/**
 * 引导阶段
 */
export const FTUE_STAGES = {
    NOT_STARTED: 'not_started',
    IN_PROGRESS: 'in_progress',
    COMPLETED: 'completed'
};

class FTUEManager {
    constructor() {
        this._currentStep = 0;
        this._stage = FTUE_STAGES.NOT_STARTED;
        this._completedSteps = [];
        this._onStepChange = null;
    }

    /**
     * 初始化
     */
    init() {
        this._loadProgress();
        console.log('[FTUE] Initialized, stage:', this._stage, 'step:', this._currentStep);
    }

    /**
     * 加载进度
     */
    _loadProgress() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                this._currentStep = data.currentStep || 0;
                this._stage = data.stage || FTUE_STAGES.NOT_STARTED;
                this._completedSteps = data.completedSteps || [];
            }
        } catch {}
    }

    /**
     * 保存进度
     */
    _saveProgress() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                currentStep: this._currentStep,
                stage: this._stage,
                completedSteps: this._completedSteps
            }));
        } catch {}
    }

    /**
     * 开始引导
     */
    startFTUE() {
        if (this._stage === FTUE_STAGES.COMPLETED) {
            console.log('[FTUE] Already completed');
            return null;
        }
        
        this._stage = FTUE_STAGES.IN_PROGRESS;
        this._saveProgress();
        
        return this.getCurrentStep();
    }

    /**
     * 获取当前步骤
     */
    getCurrentStep() {
        if (this._currentStep >= FTUE_STEPS.length) {
            return null;
        }
        return FTUE_STEPS[this._currentStep];
    }

    /**
     * 下一步
     */
    nextStep() {
        // 标记当前步骤完成
        const currentStep = FTUE_STEPS[this._currentStep];
        if (currentStep && !this._completedSteps.includes(currentStep.id)) {
            this._completedSteps.push(currentStep.id);
            
            // 发放奖励
            if (currentStep.reward) {
                this._giveReward(currentStep.reward);
            }
        }
        
        this._currentStep++;
        
        // 检查是否完成
        if (this._currentStep >= FTUE_STEPS.length) {
            this._stage = FTUE_STAGES.COMPLETED;
            this._saveProgress();
            console.log('[FTUE] Completed!');
            return null;
        }
        
        this._saveProgress();
        
        return this.getCurrentStep();
    }

    /**
     * 跳过当前步骤
     */
    skipStep() {
        return this.nextStep();
    }

    /**
     * 完成特定步骤（游戏事件触发）
     */
    completeStep(stepId) {
        const stepIndex = FTUE_STEPS.findIndex(s => s.id === stepId);
        
        if (stepIndex === -1 || stepIndex !== this._currentStep) {
            return false;
        }
        
        this.nextStep();
        return true;
    }

    /**
     * 发放奖励
     */
    _giveReward(reward) {
        const wallet = getWallet();
        
        if (reward.hintToken) {
            wallet.addBalance('hintToken', reward.hintToken, 'ftue_reward');
            console.log('[FTUE] Granted hintToken:', reward.hintToken);
        }
        if (reward.undoToken) {
            wallet.addBalance('undoToken', reward.undoToken, 'ftue_reward');
        }
        if (reward.coin) {
            wallet.addBalance('coin', reward.coin, 'ftue_reward');
        }
        
        // 可以添加更多奖励类型
        if (reward.xp) {
            // 借用 progression 流程发 XP 事件；这里不消费返回值，仅利用其副作用（统计 + 总线广播）。
            applyGameEndProgression({
                score: 0,
                gameStats: { clears: 0, maxLinesCleared: 0 },
                strategy: 'normal'
            });
            console.log('[FTUE] XP granted via progression');
        }
    }

    /**
     * 检查是否需要进行引导
     */
    shouldStartFTUE() {
        // 未完成过引导
        if (this._stage === FTUE_STAGES.NOT_STARTED) {
            return true;
        }
        
        // 之前已开始但未完成
        if (this._stage === FTUE_STAGES.IN_PROGRESS) {
            return true;
        }
        
        return false;
    }

    /**
     * 完成整个引导（外部调用）
     */
    completeFTUE() {
        // 跳到完成步骤
        while (this._currentStep < FTUE_STEPS.length - 1) {
            this.nextStep();
        }
        
        this._stage = FTUE_STAGES.COMPLETED;
        this._saveProgress();
        
        return true;
    }

    /**
     * 重置引导（调试用）
     */
    resetFTUE() {
        this._currentStep = 0;
        this._stage = FTUE_STAGES.NOT_STARTED;
        this._completedSteps = [];
        this._saveProgress();
        
        console.log('[FTUE] Reset');
    }

    /**
     * 获取状态
     */
    getStatus() {
        return {
            stage: this._stage,
            currentStep: this._currentStep,
            totalSteps: FTUE_STEPS.length,
            progress: this._currentStep / FTUE_STEPS.length,
            shouldStart: this.shouldStartFTUE()
        };
    }

    /**
     * 注册步骤变化回调
     */
    onStepChange(callback) {
        this._onStepChange = callback;
    }

    /**
     * 触发步骤变化
     */
    _triggerStepChange(step) {
        if (this._onStepChange) {
            this._onStepChange(step);
        }
    }
}

let _instance = null;
export function getFTUEManager() {
    if (!_instance) {
        _instance = new FTUEManager();
    }
    return _instance;
}

export function initFTUE() {
    getFTUEManager().init();
}