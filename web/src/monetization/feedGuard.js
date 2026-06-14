/**
 * feedGuard.js — 喂分透明度守卫（EX-2）
 *
 * "喂分"（spawn 偏置助力）必须可审计、可解释，且**跨平台不可差异化喂分**（防止
 * 对某平台用户隐性加重/减轻）。本模块：
 *   1) 把一次助力决策转成透明记录（reason + 强度 + 来源信号）；
 *   2) 守护强度在 [0, maxAssist] 内；
 *   3) 校验同一玩家画像在不同平台得到的喂分强度差异不超过 maxPlatformDivergence。
 * 纯函数。
 */

export const DEFAULT_FEED_LIMITS = {
    maxAssist: 0.35,             // 单次助力强度上限
    maxPlatformDivergence: 0.05, // 跨平台同画像喂分强度最大允许差
};

/** 生成透明助力记录（强度被夹紧到上限内）。 */
export function makeFeedRecord({ playerId, platform, assist, reason, signals = {} }, limits = {}) {
    const c = { ...DEFAULT_FEED_LIMITS, ...limits };
    const clamped = Math.min(c.maxAssist, Math.max(0, Number(assist) || 0));
    return {
        playerId,
        platform: platform || 'web',
        assist: +clamped.toFixed(4),
        clamped: clamped !== (Number(assist) || 0),
        reason: reason || 'unspecified',
        signals,
        ts: Date.now(),
    };
}

/**
 * 跨平台喂分一致性审计。
 * @param {Array<{platform:string, assist:number}>} samples 同画像在各平台的喂分
 * @returns {{ ok:boolean, divergence:number, max:number, min:number }}
 */
export function auditPlatformDivergence(samples, limits = {}) {
    const c = { ...DEFAULT_FEED_LIMITS, ...limits };
    const vals = (samples || []).map((s) => Number(s.assist) || 0);
    if (vals.length < 2) return { ok: true, divergence: 0, max: vals[0] || 0, min: vals[0] || 0 };
    const max = Math.max(...vals);
    const min = Math.min(...vals);
    const divergence = +(max - min).toFixed(4);
    return { ok: divergence <= c.maxPlatformDivergence, divergence, max, min };
}
