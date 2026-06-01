/**
 * PushNotificationManager - 推送通知管理器
 * 
 * 功能：
 * 1. 事件触发通知
 * 2. 定时提醒
 * 3. 流失预警
 * 4. 个性化推送
 */
import { getFlag } from './featureFlags.js';
import { loadProgress } from '../progression.js';
import { getPlayerAbilityModel } from '../playerAbilityModel.js';

const STORAGE_KEY = 'openblock_push_v1';

/**
 * 通知类型配置
 */
export const NOTIFICATION_TYPES = {
    // 日常提醒
    DAILY_BONUS: {
        id: 'daily_bonus',
        title: '每日奖励已准备好！',
        body: '登录领取今日签到奖励',
        icon: '🎁',
        trigger: 'time',
        time: '09:00',
        cooldown: 24 * 60 * 60 * 1000 // 24小时
    },
    
    STREAK_REMINDER: {
        id: 'streak_reminder',
        title: '连续签到别断开！',
        body: '再玩一局保持你的连续记录',
        icon: '🔥',
        trigger: 'inactivity',
        inactiveHours: 24,
        cooldown: 12 * 60 * 60 * 1000
    },
    
    // 流失预警
    CHURN_WARNING: {
        id: 'churn_warning',
        title: '想你了！回来看看',
        body: '我们有新皮肤和活动等你',
        icon: '👋',
        trigger: 'churn_risk',
        riskThreshold: 0.6,
        cooldown: 48 * 60 * 60 * 1000
    },
    
    // 付费相关
    FIRST_PURCHASE: {
        id: 'first_purchase',
        title: '限时首充优惠',
        body: '首充立享5折优惠',
        icon: '💰',
        trigger: 'first_purchase_available',
        cooldown: 72 * 60 * 60 * 1000
    },
    
    LIMITED_OFFER: {
        id: 'limited_offer',
        title: '限时特惠！',
        body: '热门商品限时折扣中',
        icon: '⚡',
        trigger: 'limited_offer_available',
        cooldown: 12 * 60 * 60 * 1000
    },
    
    // 社交相关
    FRIEND_PLAYING: {
        id: 'friend_playing',
        title: '好友正在游戏',
        body: '一起PK吧！',
        icon: '👥',
        trigger: 'friend_online',
        cooldown: 6 * 60 * 60 * 1000
    },
    
    // 内容更新
    NEW_SKIN: {
        id: 'new_skin',
        title: '新皮肤上架',
        body: '来看看有哪些炫酷皮肤',
        icon: '✨',
        trigger: 'content_update',
        cooldown: 24 * 60 * 60 * 1000
    },
    
    // 回归用户
    RETURNING_USER: {
        id: 'returning_user',
        title: '欢迎回来！',
        body: '为你准备了回归礼包',
        icon: '🎉',
        trigger: 'return',
        cooldown: 24 * 60 * 60 * 1000
    }
};

class PushNotificationManager {
    constructor() {
        this._permission = 'default';
        this._scheduled = new Map();
        this._lastSent = {};
        this._enabled = false;
    }

    /**
     * 初始化
     */
    async init() {
        this._enabled = getFlag('pushNotifications');
        if (!this._enabled) {
            console.log('[Push] Disabled via feature flag');
            return;
        }
        
        this._permission = this._getPermission();
        this._loadLastSent();
        
        // 请求权限（如果是首次）
        if (this._permission === 'default') {
            await this.requestPermission();
        }
        
        // 启动定时检查
        this._startScheduledCheck();
        
        console.log('[Push] Initialized, permission:', this._permission);
    }

    /**
     * 获取权限状态
     */
    _getPermission() {
        if (typeof Notification === 'undefined') return 'unsupported';
        return Notification.permission;
    }

    /**
     * 请求权限
     */
    async requestPermission() {
        if (typeof Notification === 'undefined') return 'unsupported';
        
        if (this._permission === 'granted') return 'granted';
        
        const result = await Notification.requestPermission();
        this._permission = result;
        return result;
    }

    /**
     * 加载上次发送时间
     */
    _loadLastSent() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                this._lastSent = JSON.parse(stored);
            }
        } catch {}
    }

    /**
     * 保存发送时间
     */
    _saveLastSent() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._lastSent));
        } catch {}
    }

    /**
     * 检查冷却时间
     */
    _canSend(typeId) {
        const config = Object.values(NOTIFICATION_TYPES).find(n => n.id === typeId);
        if (!config) return false;
        
        const lastSent = this._lastSent[typeId] || 0;
        const cooldown = config.cooldown || 24 * 60 * 60 * 1000;
        
        return Date.now() - lastSent > cooldown;
    }

    /**
     * 发送通知
     */
    send(typeId, data = {}) {
        if (!this._enabled || this._permission !== 'granted') {
            console.log('[Push] Cannot send, permission:', this._permission);
            return false;
        }
        
        if (!this._canSend(typeId)) {
            console.log('[Push] In cooldown:', typeId);
            return false;
        }
        
        const config = Object.values(NOTIFICATION_TYPES).find(n => n.id === typeId);
        if (!config) {
            console.warn('[Push] Unknown type:', typeId);
            return false;
        }
        
        try {
            const notification = new Notification(
                data.title || config.title,
                {
                    body: data.body || config.body,
                    icon: `/assets/images/icon-192.svg`,
                    badge: `/assets/images/icon-192.svg`,
                    tag: typeId,
                    requireInteraction: false,
                    ...data.options
                }
            );
            
            // 记录发送时间
            this._lastSent[typeId] = Date.now();
            this._saveLastSent();
            
            // 点击处理
            notification.onclick = () => {
                window.focus();
                notification.close();
                if (data.onClick) data.onClick();
            };
            
            console.log('[Push] Sent:', typeId);
            return true;
        } catch (e) {
            console.warn('[Push] Send failed:', e);
            return false;
        }
    }

    /**
     * 事件触发通知
     */
    triggerEvent(eventType, data = {}) {
        switch (eventType) {
            case 'first_purchase_available':
                this.send('first_purchase', data);
                break;
                
            case 'limited_offer_available':
                this.send('limited_offer', data);
                break;
                
            case 'content_update':
                this.send('new_skin', data);
                break;
                
            case 'return':
                this.send('returning_user', data);
                break;
                
            case 'churn_risk':
                this._checkChurnRisk(data);
                break;
                
            default:
                console.log('[Push] Unknown event:', eventType);
        }
    }

    /**
     * 检查流失风险并发送通知
     */
    _checkChurnRisk(_data) {
        try {
            const abilityModel = getPlayerAbilityModel();
            const persona = abilityModel.getPersona();
            
            if (persona.churnRisk >= 0.6) {
                this.send('churn_warning', {
                    body: `你的流失风险较高，我们想念你！`
                });
            }
        } catch {}
    }

    /**
     * 启动定时检查
     */
    _startScheduledCheck() {
        // 每小时检查一次
        this._scheduleTimer = setInterval(() => {
            this._checkScheduled();
        }, 60 * 60 * 1000);
        
        // 立即检查一次
        this._checkScheduled();
    }

    /**
     * 检查定时通知
     */
    _checkScheduled() {
        const now = new Date();
        
        // 检查每日奖励
        const hour = now.getHours();
        if (hour === 9) { // 早上9点
            this.send('daily_bonus');
        }
        
        // 检查连签提醒
        this._checkStreakReminder();
    }

    /**
     * 检查连签提醒
     */
    _checkStreakReminder() {
        try {
            const progress = loadProgress();
            const { dailyStreak, streakYmd } = progress;
            
            if (dailyStreak > 0) {
                const lastPlayed = new Date(streakYmd);
                const daysSince = Math.floor((Date.now() - lastPlayed.getTime()) / (24 * 60 * 60 * 1000));
                
                if (daysSince >= 1) {
                    this.send('streak_reminder');
                }
            }
        } catch {}
    }

    /**
     * 获取通知状态
     */
    getStatus() {
        return {
            enabled: this._enabled,
            permission: this._permission,
            lastSent: this._lastSent
        };
    }

    /**
     * 停止
     */
    shutdown() {
        if (this._scheduleTimer) {
            clearInterval(this._scheduleTimer);
            this._scheduleTimer = null;
        }
    }
}

let _instance = null;
export function getPushNotificationManager() {
    if (!_instance) {
        _instance = new PushNotificationManager();
    }
    return _instance;
}

export async function initPushNotificationManager() {
    await getPushNotificationManager().init();
}