/**
 * PushNotification — PWA 推送通知系统
 *
 * 功能
 * ----
 * - 在用户完成首局游戏后，礼貌地申请通知权限
 * - 记录最后活跃时间，沉默超过 N 小时后安排召回通知
 * - 通知文案根据用户分群（A/B/C/D/E）个性化
 *
 * 原理
 * ----
 * 使用 Web Notifications API（Service Worker 未就绪时退化为 document-level 通知）。
 * 仅在用户主动交互后才申请权限，符合浏览器最佳实践。
 *
 * 使用方式
 * -------
 *   import { initPushNotification } from './pushNotification.js';
 *   initPushNotification(game);
 */

const STORAGE_KEY  = 'openblock_push_prefs';
const SILENCE_THRESHOLD_H = 24;   // 沉默超过此小时数触发召回

/** 各分群个性化召回文案 */
const RECALL_COPY = {
    A: ['回来玩几局？新的挑战等着你 🎮', '今天还没玩哦，来一局放松一下吧！'],
    B: ['你的最高分还守着呢，来破它！🏆', '无尽模式新局等你挑战分数极限'],
    C: ['限时挑战即将到期，别错过专属奖励！⏰', '今天的赛季任务还没完成，冲啊！'],
    D: ['新关卡等你通关！💡', '你的关卡进度还在，继续挑战吧'],
    E: ['高分榜又有变化了，保住你的位置！', '今天有新的极限挑战上线'],
};

/** 首次游戏完成后的权限申请提示 */
const PERMISSION_ASK_DELAY_MS = 3000;

export class PushNotificationManager {
    constructor() {
        this._prefs  = this._load();
        this._game   = null;
        this._askedThisSession = false;
    }

    // ── 公开 API ──────────────────────────────────────────────────────────────

    init(game) {
        this._game = game;
        this._recordActivity();
    }

    /** 游戏结束时调用：更新最后活跃时间，酌情申请权限 */
    onGameEnd() {
        this._recordActivity();
        this._prefs.gamesPlayed = (this._prefs.gamesPlayed ?? 0) + 1;
        this._save();

        // 首局完成后延迟询问通知权限
        if (!this._askedThisSession && this._prefs.gamesPlayed === 1 && !this._prefs.permissionDenied) {
            this._askedThisSession = true;
            setTimeout(() => this._requestPermission(), PERMISSION_ASK_DELAY_MS);
        }
    }

    /** 检查是否应发送召回通知（页面重新打开时调用） */
    checkRecall() {
        if (!this._hasPermission()) return;
        const last = this._prefs.lastActiveTs ?? 0;
        const hoursAgo = (Date.now() - last) / 3_600_000;
        if (hoursAgo >= SILENCE_THRESHOLD_H) {
            this._sendRecallNotification();
        }
    }

    // ── 内部实现 ──────────────────────────────────────────────────────────────

    _recordActivity() {
        this._prefs.lastActiveTs = Date.now();
        this._save();
    }

    _hasPermission() {
        return typeof Notification !== 'undefined' && Notification.permission === 'granted';
    }

    async _requestPermission() {
        if (typeof Notification === 'undefined') return;
        if (Notification.permission === 'granted') return;
        if (Notification.permission === 'denied') {
            this._prefs.permissionDenied = true;
            this._save();
            return;
        }
        try {
            const result = await Notification.requestPermission();
            if (result === 'denied') {
                this._prefs.permissionDenied = true;
                this._save();
            }
        } catch { /* 部分浏览器不支持 */ }
    }

    _sendRecallNotification() {
        if (!this._hasPermission()) return;
        const segment = this._game?.playerProfile?.segment5 ?? 'A';
        const copies  = RECALL_COPY[segment] ?? RECALL_COPY.A;
        const body    = copies[Math.floor(Math.random() * copies.length)];
        try {
            const n = new Notification('Open Block', {
                body,
                icon: '/favicon.ico',
                badge: '/favicon.ico',
                tag: 'openblock-recall',
                renotify: false,
            });
            n.onclick = () => { window.focus(); n.close(); };
        } catch { /* 通知权限已撤销 */ }
    }

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._prefs));
        } catch { /* ignore */ }
    }
}

let _instance = null;

export function initPushNotification(game) {
    _instance = new PushNotificationManager();
    _instance.init(game);
    _instance.checkRecall();
    return _instance;
}

export function getPushNotification() { return _instance; }
