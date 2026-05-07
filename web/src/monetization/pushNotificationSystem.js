/**
 * PushNotificationSystem - 增强版推送通知系统
 * 
 * 功能：
 * 1. 事件触发推送
 * 2. 推送内容模板化
 * 3. 推送效果追踪
 * 4. 智能调度
 */
import { getRetentionAnalyzer } from './retentionAnalyzer.js';
import { getPaymentPredictionModel } from './paymentPredictionModel.js';

const STORAGE_KEY = 'openblock_push_system_v1';

/**
 * 推送事件类型
 */
export const PUSH_TRIGGER_EVENTS = {
    // 用户行为事件
    GAME_COMPLETE: 'game_complete',
    HIGH_SCORE: 'high_score',
    ACHIEVEMENT_UNLOCK: 'achievement_unlock',
    STREAK_MILESTONE: 'streak_milestone',
    
    // 流失预警事件
    CHURN_WARNING: 'churn_warning',
    INACTIVE_3_DAYS: 'inactive_3_days',
    INACTIVE_7_DAYS: 'inactive_7_days',
    
    // 运营事件
    DAILY_BONUS: 'daily_bonus',
    WEEKLY_REWARD: 'weekly_reward',
    LIMITED_OFFER: 'limited_offer',
    NEW_SKIN: 'new_skin',
    SEASON_START: 'season_start',
    
    // 商业化事件
    FIRST_PURCHASE_WINDOW: 'first_purchase_window',
    SUBSCRIPTION_EXPIRE: 'subscription_expire',
    CART_ABANDONED: 'cart_abandoned',
    
    // 回流事件
    RETURNING_USER: 'returning_user',
    FRIEND_INVITE: 'friend_invite'
};

/**
 * 推送模板
 */
export const PUSH_TEMPLATES = {
    // 游戏完成
    [PUSH_TRIGGER_EVENTS.GAME_COMPLETE]: {
        title: '再来一局？',
        body: '你的最佳成绩 {{bestScore}} 分！再接再厉~',
        icon: '🎮',
        actions: [
            { id: 'play_again', title: '再来一局' },
            { id: 'share', title: '分享成绩' }
        ]
    },
    
    // 高分
    [PUSH_TRIGGER_EVENTS.HIGH_SCORE]: {
        title: '🎉 打破纪录！',
        body: '你创造了新的最高分：{{score}} 分！',
        icon: '🏆',
        actions: [
            { id: 'share', title: '炫耀一下' },
            { id: 'challenge', title: '发起挑战' }
        ]
    },
    
    // 成就解锁
    [PUSH_TRIGGER_EVENTS.ACHIEVEMENT_UNLOCK]: {
        title: '🏅 成就解锁',
        body: '恭喜获得「{{achievementName}}」成就！',
        icon: '🏅',
        actions: [
            { id: 'view_achievement', title: '查看成就' }
        ]
    },
    
    // 连续里程碑
    [PUSH_TRIGGER_EVENTS.STREAK_MILESTONE]: {
        title: '🔥 连续 {{streak}} 天',
        body: '你已连续登录 {{streak}} 天！太厉害了！',
        icon: '🔥',
        actions: [
            { id: 'claim', title: '领取奖励' }
        ]
    },
    
    // 流失预警
    [PUSH_TRIGGER_EVENTS.CHURN_WARNING]: {
        title: '我们想你了 💭',
        body: '已 {{days}} 天没见到你了，快回来玩吧！',
        icon: '💭',
        actions: [
            { id: 'play', title: '立即游戏' },
            { id: 'claim_bonus', title: '领取回归礼包' }
        ]
    },
    
    // 3天未活跃
    [PUSH_TRIGGER_EVENTS.INACTIVE_3_DAYS]: {
        title: '回来看看~',
        body: '我们有新皮肤上线啦！',
        icon: '👀',
        actions: [
            { id: 'view', title: '来看看' }
        ]
    },
    
    // 7天未活跃
    [PUSH_TRIGGER_EVENTS.INACTIVE_7_DAYS]: {
        title: '想念你的笑容 🥺',
        body: '7天没见了，这里有专属回归礼包等你！',
        icon: '🎁',
        actions: [
            { id: 'claim_return', title: '领取回归礼包' }
        ]
    },
    
    // 每日奖励
    [PUSH_TRIGGER_EVENTS.DAILY_BONUS]: {
        title: '🎁 每日奖励已准备好',
        body: '签到领取 {{bonus}}，连续签到更有惊喜！',
        icon: '🎁',
        actions: [
            { id: 'claim_daily', title: '立即领取' },
            { id: 'view_calendar', title: '查看日历' }
        ]
    },
    
    // 周奖励
    [PUSH_TRIGGER_EVENTS.WEEKLY_REWARD]: {
        title: '✨ 周奖励发放',
        body: '本周表现优异，奖励 {{reward}} 已发放！',
        icon: '⭐',
        actions: [
            { id: 'claim', title: '查看奖励' }
        ]
    },
    
    // 限时优惠
    [PUSH_TRIGGER_EVENTS.LIMITED_OFFER]: {
        title: '⏰ 限时特惠',
        body: '{{offerName}} 仅剩 {{hours}} 小时！',
        icon: '⚡',
        actions: [
            { id: 'view', title: '立即抢购' }
        ]
    },
    
    // 新皮肤
    [PUSH_TRIGGER_EVENTS.NEW_SKIN]: {
        title: '✨ 新皮肤上架',
        body: '{{skinName}} 皮肤来袭，快来试试！',
        icon: '✨',
        actions: [
            { id: 'preview', title: '预览' },
            { id: 'get', title: '获取' }
        ]
    },
    
    // 首充窗口
    [PUSH_TRIGGER_EVENTS.FIRST_PURCHASE_WINDOW]: {
        title: '💰 首充特惠仅剩 {{hours}} 小时',
        body: '首充 {{discount}} 折，错过不再有！',
        icon: '💰',
        actions: [
            { id: 'purchase', title: '立即购买' }
        ]
    },
    
    // 订阅即将过期
    [PUSH_TRIGGER_EVENTS.SUBSCRIPTION_EXPIRE]: {
        title: '⏰ 订阅即将过期',
        body: '{{productName}} 还有 {{days}} 天到期，续费享优惠！',
        icon: '📅',
        actions: [
            { id: 'renew', title: '立即续费' }
        ]
    },
    
    // 回归用户
    [PUSH_TRIGGER_EVENTS.RETURNING_USER]: {
        title: '🎉 欢迎回来！',
        body: '为你准备了 {{bonus}} 回归礼包！',
        icon: '🎉',
        actions: [
            { id: 'claim', title: '领取礼包' }
        ]
    },
    
    // 好友邀请
    [PUSH_TRIGGER_EVENTS.FRIEND_INVITE]: {
        title: '👥 好友邀请',
        body: '{{friendName}} 邀请你一起玩游戏！',
        icon: '👥',
        actions: [
            { id: 'accept', title: '接受邀请' }
        ]
    }
};

class PushNotificationSystem {
    constructor() {
        this._enabled = false;
        this._scheduledTasks = [];
        this._pushHistory = [];
        this._triggerHandlers = {};
    }

    /**
     * 初始化
     */
    init() {
        this._loadState();
        this._registerTriggerHandlers();
        console.log('[PushSystem] Initialized, enabled:', this._enabled);
    }

    /**
     * 加载状态
     */
    _loadState() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                this._pushHistory = data.history || [];
                this._scheduledTasks = data.tasks || [];
            }
        } catch {}
    }

    /**
     * 保存状态
     */
    _saveState() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                history: this._pushHistory.slice(-100),
                tasks: this._scheduledTasks
            }));
        } catch {}
    }

    /**
     * 注册触发处理器
     */
    _registerTriggerHandlers() {
        // 游戏完成 - 鼓励继续
        this._triggerHandlers[PUSH_TRIGGER_EVENTS.GAME_COMPLETE] = async (context) => {
            const { score, bestScore } = context;
            
            // 如果破了纪录，推送高分解锁
            if (score >= bestScore && bestScore > 0) {
                return this.trigger(PUSH_TRIGGER_EVENTS.HIGH_SCORE, { score });
            }
            
            return null;
        };

        // 成就解锁
        this._triggerHandlers[PUSH_TRIGGER_EVENTS.ACHIEVEMENT_UNLOCK] = (context) => {
            return this.trigger(PUSH_TRIGGER_EVENTS.ACHIEVEMENT_UNLOCK, context);
        };

        // 流失预警 - 基于用户阶段
        this._triggerHandlers[PUSH_TRIGGER_EVENTS.CHURN_WARNING] = (context) => {
            const retention = getRetentionAnalyzer();
            const lifecycle = retention.getUserLifecycle(context.userId);
            
            if (lifecycle === 'at_risk') {
                return this.trigger(PUSH_TRIGGER_EVENTS.INACTIVE_3_DAYS, context);
            } else if (lifecycle === 'dormant') {
                return this.trigger(PUSH_TRIGGER_EVENTS.INACTIVE_7_DAYS, context);
            }
            
            return null;
        };

        // 首充窗口 - 检查用户
        this._triggerHandlers[PUSH_TRIGGER_EVENTS.FIRST_PURCHASE_WINDOW] = (_context) => {
            try {
                const purchases = JSON.parse(localStorage.getItem('openblock_mon_purchases_v1') || '{}');
                
                // 未购买过的用户
                if (Object.keys(purchases).length === 0) {
                    return this.trigger(PUSH_TRIGGER_EVENTS.FIRST_PURCHASE_WINDOW, { hours: 24 });
                }
            } catch {}
            return null;
        };
    }

    /**
     * 触发推送
     */
    trigger(eventType, context = {}) {
        const template = PUSH_TEMPLATES[eventType];
        if (!template) {
            console.warn('[PushSystem] Unknown event type:', eventType);
            return null;
        }

        // 填充模板变量
        const content = this._fillTemplate(template, context);
        
        // 记录推送
        const pushRecord = {
            eventType,
            content,
            context,
            timestamp: Date.now(),
            status: 'sent'
        };
        
        this._pushHistory.push(pushRecord);
        this._saveState();

        // 发送通知
        this._sendNotification(content);
        
        // 触发后续处理链
        const handler = this._triggerHandlers[eventType];
        if (handler) {
            setTimeout(() => handler(context), 1000);
        }

        console.log('[PushSystem] Triggered:', eventType);
        
        return pushRecord;
    }

    /**
     * 填充模板变量
     */
    _fillTemplate(template, context) {
        const filled = { ...template };
        
        // 替换变量
        for (const [key, value] of Object.entries(context)) {
            filled.title = filled.title.replace(new RegExp(`{{${key}}}`, 'g'), value);
            filled.body = filled.body.replace(new RegExp(`{{${key}}}`, 'g'), value);
        }
        
        // 尝试从系统获取动态变量
        if (filled.body.includes('{{')) {
            filled.body = this._fillDynamicVariables(filled.body);
        }
        
        return filled;
    }

    /**
     * 填充动态变量
     */
    _fillDynamicVariables(text) {
        let result = text;
        
        // 最高分
        if (result.includes('{{bestScore}}')) {
            try {
                const stats = JSON.parse(localStorage.getItem('openblock_client_stats') || '{}');
                result = result.replace('{{bestScore}}', stats.bestScore || 0);
            } catch {}
        }
        
        // 连续天数
        if (result.includes('{{streak}}')) {
            try {
                const progress = JSON.parse(localStorage.getItem('openblock_progression_v1') || '{}');
                result = result.replace('{{streak}}', progress.dailyStreak || 0);
            } catch {}
        }
        
        return result;
    }

    /**
     * 发送通知
     */
    _sendNotification(content) {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
            console.log('[PushSystem] Notification not available');
            return;
        }

        try {
            const notification = new Notification(content.title, {
                body: content.body,
                icon: `/assets/images/icon-192.svg`,
                badge: `/assets/images/icon-192.svg`,
                tag: content.icon,
                requireInteraction: false
            });

            notification.onclick = () => {
                window.focus();
                this._trackClick(content);
            };
            
            // 自动关闭
            setTimeout(() => notification.close(), 5000);
            
        } catch (e) {
            console.warn('[PushSystem] Send failed:', e);
        }
    }

    /**
     * 追踪点击
     */
    _trackClick(_content) {
        const latest = this._pushHistory[this._pushHistory.length - 1];
        if (latest) {
            latest.status = 'clicked';
            latest.clickedAt = Date.now();
            this._saveState();
        }
    }

    /**
     * 追踪转化
     */
    trackConversion(pushEventType, conversionAction) {
        const push = this._pushHistory.find(p => p.eventType === pushEventType);
        if (push) {
            push.status = 'converted';
            push.convertedAt = Date.now();
            push.conversionAction = conversionAction;
            this._saveState();
            
            console.log('[PushSystem] Conversion tracked:', pushEventType, conversionAction);
        }
    }

    /**
     * 调度推送
     */
    schedulePush(eventType, delayMs, context = {}) {
        const task = {
            eventType,
            context,
            scheduledAt: Date.now() + delayMs,
            executed: false
        };
        
        this._scheduledTasks.push(task);
        this._saveState();
        
        // 设置定时器
        setTimeout(() => {
            this.trigger(eventType, context);
            task.executed = true;
            this._saveState();
        }, delayMs);
        
        console.log('[PushSystem] Scheduled:', eventType, 'delay:', delayMs);
        
        return task;
    }

    /**
     * 取消调度
     */
    cancelScheduled(taskId) {
        this._scheduledTasks = this._scheduledTasks.filter(t => 
            t.scheduledAt !== taskId
        );
        this._saveState();
    }

    /**
     * 获取推送历史
     */
    getHistory(limit = 20) {
        return this._pushHistory.slice(-limit);
    }

    /**
     * 获取推送统计
     */
    getStats() {
        const total = this._pushHistory.length;
        const sent = this._pushHistory.filter(p => p.status === 'sent').length;
        const clicked = this._pushHistory.filter(p => p.status === 'clicked').length;
        const converted = this._pushHistory.filter(p => p.status === 'converted').length;
        
        return {
            total,
            sent,
            clicked,
            converted,
            clickRate: sent > 0 ? (clicked / sent * 100).toFixed(1) + '%' : '0%',
            conversionRate: clicked > 0 ? (converted / clicked * 100).toFixed(1) + '%' : '0%'
        };
    }

    /**
     * 获取待执行的任务
     */
    getScheduledTasks() {
        return this._scheduledTasks.filter(t => !t.executed);
    }

    /**
     * 获取智能建议
     */
    getSmartSuggestions() {
        const suggestions = [];
        
        // 检查连续签到里程碑
        try {
            const progress = JSON.parse(localStorage.getItem('openblock_progression_v1') || '{}');
            const streak = progress.dailyStreak || 0;
            
            if ([7, 14, 30, 50, 100].includes(streak)) {
                suggestions.push({
                    eventType: PUSH_TRIGGER_EVENTS.STREAK_MILESTONE,
                    context: { streak },
                    reason: `用户连续登录 ${streak} 天`
                });
            }
        } catch {}
        
        // 检查流失风险（保留 retention 引用作为后续扩展锚点：用 retention 数据修正 prediction 权重）
        getRetentionAnalyzer();
        const prediction = getPaymentPredictionModel();

        if (prediction) {
            const pred = prediction.getPrediction();
            
            if (pred.score >= 0.6) {
                suggestions.push({
                    eventType: PUSH_TRIGGER_EVENTS.FIRST_PURCHASE_WINDOW,
                    context: { hours: 24, discount: 50 },
                    reason: '用户付费意向高'
                });
            }
            
            if (pred.score < 0.3) {
                suggestions.push({
                    eventType: PUSH_TRIGGER_EVENTS.CHURN_WARNING,
                    context: { days: 3 },
                    reason: '用户付费意向低，可能流失'
                });
            }
        }
        
        return suggestions;
    }

    /**
     * 重置
     */
    reset() {
        this._pushHistory = [];
        this._scheduledTasks = [];
        this._saveState();
        console.log('[PushSystem] Reset');
    }
}

let _pushSystemInstance = null;
export function getPushNotificationSystem() {
    if (!_pushSystemInstance) {
        _pushSystemInstance = new PushNotificationSystem();
    }
    return _pushSystemInstance;
}

export function initPushNotificationSystem() {
    getPushNotificationSystem().init();
}