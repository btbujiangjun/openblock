import { sys } from 'cc';

/**
 * 运行环境检测（Phase 4）。用于在启动时选择合适的广告/支付/存档适配器。
 */
export type PlatformName = 'wechat' | 'bytedance' | 'web-mobile' | 'web-desktop' | 'native' | 'unknown';

function hasGlobal(name: string): boolean {
    return typeof (globalThis as Record<string, unknown>)[name] !== 'undefined';
}

export const Platform = {
    name(): PlatformName {
        if (hasGlobal('wx') && (sys.platform === sys.Platform.WECHAT_GAME || hasGlobal('__wxConfig'))) return 'wechat';
        if (hasGlobal('tt')) return 'bytedance';
        if (sys.isNative) return 'native';
        if (sys.isMobile) return 'web-mobile';
        if (sys.isBrowser) return 'web-desktop';
        return 'unknown';
    },

    isWechat(): boolean {
        return this.name() === 'wechat';
    },

    isNative(): boolean {
        return sys.isNative;
    },

    isTouch(): boolean {
        return sys.isMobile || this.isWechat() || this.name() === 'bytedance';
    },
};
