/**
 * 原生 iOS/Android 广告 & IAP 桥接（Phase P0 变现上架链路脚手架）。
 *
 * 契约：原生壳（iOS Swift / Android Kotlin，对接 AdMob/AppLovin、StoreKit/Google Billing）在 WebView/JSB
 * 注入全局 `globalThis.__openblockNative`：
 *   {
 *     ready?: boolean,
 *     postMessage(json: string): void   // 收到 { id, action, args }，处理后回调下面的 resolve
 *   }
 * 原生处理完成后调用 `globalThis.__openblockNativeResolve(id, resultJson)` 回传结果。
 *
 * 本文件提供 JS 侧的 AdsAdapter / IapAdapter 实现 + 注册入口；未注入原生接口时**不安装**，
 * 业务层继续走 Noop（开发期/纯 web 可玩）。真正的广告/计费 SDK 由原生壳实现，JS 端零 SDK 依赖。
 */
import { Monetization, AdsAdapter, IapAdapter, RewardedResult, PurchaseResult } from './Monetization';

interface NativeInterface {
    ready?: boolean;
    postMessage(json: string): void;
}

type Pending = (result: unknown) => void;

const _pending = new Map<string, Pending>();
let _seq = 0;
let _resolverInstalled = false;

function nativeIface(): NativeInterface | null {
    const g = globalThis as Record<string, unknown>;
    const ni = g.__openblockNative as NativeInterface | undefined;
    return ni && typeof ni.postMessage === 'function' ? ni : null;
}

/** 是否存在可用的原生变现桥。 */
export function hasNativeMonetization(): boolean {
    return nativeIface() !== null;
}

function installResolver(): void {
    if (_resolverInstalled) return;
    _resolverInstalled = true;
    (globalThis as Record<string, unknown>).__openblockNativeResolve = (id: string, resultJson?: string): void => {
        const cb = _pending.get(id);
        if (!cb) return;
        _pending.delete(id);
        let parsed: unknown = null;
        try { parsed = resultJson ? JSON.parse(resultJson) : null; } catch { parsed = null; }
        cb(parsed);
    };
}

/** 向原生发起一次请求，超时（默认 60s）按失败处理，避免悬挂的奖励流程。 */
function request<T>(action: string, args: Record<string, unknown>, timeoutMs = 60000): Promise<T | null> {
    const iface = nativeIface();
    if (!iface) return Promise.resolve(null);
    installResolver();
    const id = `ob_${Date.now()}_${++_seq}`;
    return new Promise<T | null>((resolve) => {
        let done = false;
        const finish = (v: T | null): void => { if (!done) { done = true; resolve(v); } };
        _pending.set(id, (r) => finish(r as T));
        try {
            iface.postMessage(JSON.stringify({ id, action, args }));
        } catch {
            _pending.delete(id);
            finish(null);
        }
        setTimeout(() => { if (_pending.has(id)) { _pending.delete(id); finish(null); } }, timeoutMs);
    });
}

class NativeAds implements AdsAdapter {
    private _readyMap: Record<string, boolean> = {};

    isReady(placement: string): boolean {
        // 乐观就绪：真实就绪态可由原生通过 __openblockNativeResolve 的事件回填（此处保守返回缓存）。
        return this._readyMap[placement] !== false;
    }

    async showRewarded(placement: string): Promise<RewardedResult> {
        const res = await request<{ completed?: boolean }>('showRewarded', { placement });
        return { completed: !!res?.completed };
    }

    async showInterstitial(placement: string): Promise<void> {
        await request<unknown>('showInterstitial', { placement });
    }
}

class NativeIap implements IapAdapter {
    async purchase(productId: string): Promise<PurchaseResult> {
        const res = await request<{ success?: boolean; error?: string }>('purchase', { productId });
        return { success: !!res?.success, productId, error: res?.error };
    }

    async restore(): Promise<string[]> {
        const res = await request<{ productIds?: string[] }>('restore', {});
        return Array.isArray(res?.productIds) ? res!.productIds! : [];
    }
}

/**
 * 注入原生变现适配器（仅当检测到原生桥时）。返回是否成功安装。
 * 在 Bootstrap.detectPlatform 内、原生端调用。
 */
export function registerNativeMonetization(): boolean {
    if (!hasNativeMonetization()) return false;
    Monetization.useAds(new NativeAds());
    Monetization.useIap(new NativeIap());
    return true;
}
