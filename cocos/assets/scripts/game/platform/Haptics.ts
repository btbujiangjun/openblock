/**
 * 震动反馈适配（Phase 2/4）。优先微信小游戏 wx.vibrateShort，其次 navigator.vibrate，
 * 原生端可在此接 JSB。无能力时静默。
 */
type WxLike = { vibrateShort?: (opts: { type?: 'heavy' | 'medium' | 'light' }) => void; vibrateLong?: () => void };

function getWx(): WxLike | null {
    const g = globalThis as unknown as { wx?: WxLike };
    return g.wx ?? null;
}

export const Haptics = {
    enabled: true,

    light(): void {
        if (!this.enabled) return;
        const wx = getWx();
        if (wx?.vibrateShort) {
            wx.vibrateShort({ type: 'light' });
            return;
        }
        this.web(15);
    },

    medium(): void {
        if (!this.enabled) return;
        const wx = getWx();
        if (wx?.vibrateShort) {
            wx.vibrateShort({ type: 'medium' });
            return;
        }
        this.web(30);
    },

    heavy(): void {
        if (!this.enabled) return;
        const wx = getWx();
        if (wx?.vibrateLong) {
            wx.vibrateLong();
            return;
        }
        this.web(60);
    },

    web(ms: number): void {
        try {
            const nav = globalThis as unknown as { navigator?: { vibrate?: (p: number) => void } };
            nav.navigator?.vibrate?.(ms);
        } catch {
            /* ignore */
        }
    },
};
