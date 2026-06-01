/**
 * Web Push 通知（OPT-07）
 *
 * 设计：
 *   - 基于 Web Notifications API（浏览器端）+ 可选 Service Worker（PWA）
 *   - 当前实现为「浏览器内定时提醒」（不需要 SW 或推送服务器）
 *   - 真正的后台推送需要 SW + VAPID 服务端，本模块提供接口框架
 *   - 通过 featureFlags 控制，默认关闭
 */

import { getFlag } from './featureFlags.js';
import { loadProgress } from '../progression.js';

const STORAGE_KEY = 'openblock_mon_push_v1';

/** 检查通知权限 */
export function getNotificationPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
}

/**
 * 请求通知权限
 * @returns {Promise<'granted' | 'denied' | 'default' | 'unsupported'>}
 */
export async function requestPermission() {
    if (typeof Notification === 'undefined') return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    const result = await Notification.requestPermission();
    return result;
}

/**
 * 发送浏览器通知（需已授权）
 * @param {string} title
 * @param {object} options  - body, icon, tag
 */
export function sendNotification(title, options = {}) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    try {
        new Notification(title, {
            icon: '/favicon.ico',
            badge: '/favicon.ico',
            ...options,
        });
    } catch (e) {
        console.warn('[Push]', e);
    }
}

/** 注册「连签断线提醒」（下次访问时检查）*/
export function scheduleStreakReminder() {
    if (!getFlag('pushNotifications')) return;
    const { dailyStreak, streakYmd } = loadProgress();
    if (!dailyStreak) return;

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            lastPlayed: new Date().toISOString(),
            streak: dailyStreak,
            streakYmd,
        }));
    } catch { /* ignore */ }
}

/** 启动时检查是否需要发连签提醒（在 initPushNotifications 中调用） */
function _checkStreakOnStart() {
    if (typeof document === 'undefined') return;
    if (Notification?.permission !== 'granted') return;

    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const { lastPlayed, streak } = JSON.parse(raw);
        if (!lastPlayed || !streak) return;

        const msSinceLast = Date.now() - new Date(lastPlayed).getTime();
        const hoursSince = msSinceLast / 3_600_000;

        if (hoursSince >= 20 && hoursSince < 48) {
            sendNotification('Open Block 连签提醒', {
                body: `你已连续 ${streak} 天登录！今天来一局保住连签 🔥`,
                tag: 'streak-reminder',
            });
        }
    } catch { /* ignore */ }
}

/** 初始化推送模块 */
export function initPushNotifications() {
    if (!getFlag('pushNotifications')) return;
    _checkStreakOnStart();
}

/**
 * 触发「每日挑战已刷新」通知
 */
export function notifyDailyChallenge() {
    if (!getFlag('pushNotifications')) return;
    sendNotification('每日挑战已刷新', {
        body: '今日挑战已开放，快来上榜！🏆',
        tag: 'daily-challenge',
    });
}
