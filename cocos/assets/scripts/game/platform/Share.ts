/**
 * 分享（Phase P2）。
 *
 * 优先级：
 *  1) 微信小游戏 wx.shareAppMessage
 *  2) 原生/宿主桥：`__openblockShare(text)` 或 `__openblockNative.postMessage({ action:'share' })`
 *  3) Web Share API `navigator.share`
 *  4) 剪贴板降级：Cocos `sys.copyTextToClipboard` / Clipboard API
 *  5) 无能力时返回 unavailable，由调用方给可见提示
 */
import { sys } from 'cc';
import { t } from '../../core';

interface WxShareApi {
    shareAppMessage?: (opts: { title: string; imageUrl?: string }) => void;
    onShareAppMessage?: (cb: () => { title: string; imageUrl?: string }) => void;
}

export type ShareResult = 'shared' | 'copied' | 'unavailable';

function wx(): WxShareApi | null {
    return (globalThis as unknown as { wx?: WxShareApi }).wx ?? null;
}

function nativeShare(text: string): boolean {
    const g = globalThis as unknown as {
        __openblockShare?: (text: string) => void;
        __openblockNative?: { postMessage?: (json: string) => void };
    };
    if (typeof g.__openblockShare === 'function') {
        try { g.__openblockShare(text); return true; } catch { /* ignore */ }
    }
    if (typeof g.__openblockNative?.postMessage === 'function') {
        try {
            g.__openblockNative.postMessage(JSON.stringify({ action: 'share', args: { text } }));
            return true;
        } catch { /* ignore */ }
    }
    return false;
}

function copyText(text: string): boolean {
    try {
        const s = sys as unknown as { copyTextToClipboard?: (text: string) => void };
        if (typeof s.copyTextToClipboard === 'function') {
            s.copyTextToClipboard(text);
            return true;
        }
    } catch { /* ignore */ }
    try {
        const nav = (globalThis as unknown as {
            navigator?: { clipboard?: { writeText?: (text: string) => Promise<void> } };
        }).navigator;
        if (typeof nav?.clipboard?.writeText === 'function') {
            void nav.clipboard.writeText(text).catch(() => { /* ignore */ });
            return true;
        }
    } catch { /* ignore */ }
    return false;
}

export const Share = {
    /** 主动分享当前战绩。 */
    shareScore(score: number, imageUrl?: string): ShareResult {
        const title = t('share.text', { n: score });
        const api = wx();
        if (api?.shareAppMessage) {
            try { api.shareAppMessage({ title, imageUrl }); return 'shared'; } catch { /* ignore */ }
        }
        if (nativeShare(title)) {
            return 'shared';
        }
        const nav = (globalThis as unknown as { navigator?: { share?: (d: { text: string }) => Promise<void> } }).navigator;
        if (nav?.share) {
            void nav.share({ text: title }).catch(() => { /* ignore */ });
            return 'shared';
        }
        if (copyText(title)) {
            return 'copied';
        }
        // eslint-disable-next-line no-console
        console.log('[share]', title);
        return 'unavailable';
    },

    /** 注册「转发」回调（微信右上角菜单/主动转发统一文案）。 */
    registerShareMenu(getScore: () => number): void {
        const api = wx();
        if (api?.onShareAppMessage) {
            try { api.onShareAppMessage(() => ({ title: t('share.text', { n: getScore() }) })); } catch { /* ignore */ }
        }
    },
};
