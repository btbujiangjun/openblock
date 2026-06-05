/**
 * 分享（Phase P2）。微信小游戏走 wx.shareAppMessage；其它端尝试 navigator.share，
 * 都不可用时降级为复制文案 / 控制台。引擎无关调用，文案由 i18n 提供。
 */
import { t } from '../../core';

interface WxShareApi {
    shareAppMessage?: (opts: { title: string; imageUrl?: string }) => void;
    onShareAppMessage?: (cb: () => { title: string; imageUrl?: string }) => void;
}

function wx(): WxShareApi | null {
    return (globalThis as unknown as { wx?: WxShareApi }).wx ?? null;
}

export const Share = {
    /** 主动分享当前战绩。 */
    shareScore(score: number, imageUrl?: string): void {
        const title = t('share.text', { n: score });
        const api = wx();
        if (api?.shareAppMessage) {
            try { api.shareAppMessage({ title, imageUrl }); return; } catch { /* ignore */ }
        }
        const nav = (globalThis as unknown as { navigator?: { share?: (d: { text: string }) => Promise<void> } }).navigator;
        if (nav?.share) {
            void nav.share({ text: title }).catch(() => { /* ignore */ });
            return;
        }
        // eslint-disable-next-line no-console
        console.log('[share]', title);
    },

    /** 注册「转发」回调（微信右上角菜单/主动转发统一文案）。 */
    registerShareMenu(getScore: () => number): void {
        const api = wx();
        if (api?.onShareAppMessage) {
            try { api.onShareAppMessage(() => ({ title: t('share.text', { n: getScore() }) })); } catch { /* ignore */ }
        }
    },
};
