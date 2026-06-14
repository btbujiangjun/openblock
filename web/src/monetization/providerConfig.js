/**
 * providerConfig.js — 商业化 Provider 配置 SSOT（A 类外部接入的配置化层）
 *
 * 设计目标：把「广告 / IAP / 归因」三类外部 SDK 的**选型与凭据**全部收敛到配置，
 * 默认走 `stub`（配置化桩数据，无需任何外部账号即可端到端跑通管线）；
 * 一旦拿到真实凭据，只需把对应 provider 的 `type` 改为 `admob/applovin/wechat/
 * alipay/stripe/appsflyer/adjust` 并填入 key，无需改业务代码。
 *
 * 配置优先级（后者覆盖前者）：
 *   1. 本文件 DEFAULT_PROVIDER_CONFIG
 *   2. 构建期注入 globalThis.__OPENBLOCK_PROVIDERS__（如打包时按环境注入）
 *   3. 运行期 localStorage['openblock_provider_config']（便于灰度 / QA 切换）
 */

const LS_KEY = 'openblock_provider_config';

/** 全部默认走桩；stub.* 为可调的仿真参数。 */
export const DEFAULT_PROVIDER_CONFIG = {
    ad: {
        type: 'stub', // stub | admob | applovin
        stub: {
            fillRate: 0.92, // 填充率（无填充→无收益）
            // 按「每次展示」计费（元/次）：激励 0.05、插屏 0.02、Banner 0.002。
            revenuePerShowCny: { rewarded: 0.05, interstitial: 0.02, banner: 0.002 },
            latencyMs: 600, // 模拟加载耗时
        },
        admob: { appId: '', rewardedUnitId: '', interstitialUnitId: '' },
        applovin: { sdkKey: '', rewardedUnitId: '', interstitialUnitId: '' },
    },
    // 买量获取成本（用于花费模拟 / ROAS 口径），统一按 2 元/安装计。
    acquisition: { cpiCny: 2 },
    iap: {
        type: 'stub', // stub | wechat | alipay | stripe
        // stub 不需要凭据：服务端用共享密钥对回执签名后校验（见 server_payments.py）
        stub: { autoConfirm: false },
        wechat: { appId: '', mchId: '' },
        alipay: { appId: '' },
        stripe: { publishableKey: '' },
    },
    attribution: {
        type: 'stub', // stub | appsflyer | adjust
        stub: {
            // 无 UTM 时，按权重随机分配一个买量渠道，模拟 MMP 归因解析结果
            channelMix: [
                { source: 'organic', medium: 'organic', weight: 0.45 },
                { source: 'applovin', medium: 'cpi', weight: 0.22, campaign: 'al_global_roas', content: 'cr_video_01' },
                { source: 'unity', medium: 'cpi', weight: 0.15, campaign: 'unity_ww', content: 'cr_playable_02' },
                { source: 'google_uac', medium: 'cpi', weight: 0.12, campaign: 'uac_install', content: 'cr_html_03' },
                { source: 'facebook', medium: 'cpi', weight: 0.06, campaign: 'fb_aaa', content: 'cr_carousel_04' },
            ],
        },
        appsflyer: { devKey: '', appId: '' },
        adjust: { appToken: '', environment: 'sandbox' },
    },
};

function _deepMerge(base, override) {
    if (!override || typeof override !== 'object') return base;
    const out = Array.isArray(base) ? [...base] : { ...base };
    for (const [k, v] of Object.entries(override)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
            out[k] = _deepMerge(out[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

let _cache = null;

/** 读取合并后的完整配置（带缓存）。 */
export function getProviderConfig() {
    if (_cache) return _cache;
    let cfg = DEFAULT_PROVIDER_CONFIG;
    try {
        if (typeof globalThis !== 'undefined' && globalThis.__OPENBLOCK_PROVIDERS__) {
            cfg = _deepMerge(cfg, globalThis.__OPENBLOCK_PROVIDERS__);
        }
    } catch { /* ignore */ }
    try {
        const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_KEY) : null;
        if (raw) cfg = _deepMerge(cfg, JSON.parse(raw));
    } catch { /* ignore */ }
    _cache = cfg;
    return cfg;
}

/** 取某一类（ad/iap/attribution）的配置。 */
export function getProviderSection(name) {
    return getProviderConfig()[name] || {};
}

/** 运行期覆盖配置（写 localStorage 并清缓存；用于灰度 / QA）。 */
export function setProviderConfigOverride(partial) {
    try {
        const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(LS_KEY) : null;
        const cur = raw ? JSON.parse(raw) : {};
        const next = _deepMerge(cur, partial);
        if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
    _cache = null;
}

/** 测试用：清缓存。 */
export function __clearProviderConfigCache() { _cache = null; }
