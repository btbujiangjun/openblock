/**
 * v2 客户端策略解析 — 离线 bundle + 灰度切量 + 4 层 fallback。
 *
 * PR6 (离线 bundle):
 *   启动时优先 fetch /spawn-tuning-v2/policies.json (Web/Android/iOS bundle)
 *   微信小程序由打包时 require miniprogram/core/tuning/spawnPoliciesV2.js
 *
 * PR7 (灰度切量):
 *   bundle 含 rollout_pct ∈ [0, 100]
 *   用户 hash 到 bucket ∈ [0, 100), bucket < rollout_pct → 吃 v2 模型
 *   否则走 default θ (= 当前线上 baseline)
 *
 * 4 层 fallback (查 context_key 时):
 *   0. exact 完全匹配                 difficulty:generator:bot:pb_bin:lifecycle
 *   1. 同 ctx 不限 lifecycle           difficulty:generator:bot:pb_bin:*
 *   2. 仅同 difficulty + generator     difficulty:generator:*:*:*
 *   3. 默认 θ (= baseline)
 *
 * 防御性: 所有错误都 fallback default, 绝不让玩家因 server/网络故障玩到坏出块。
 */

// ─────────── 默认 θ (与 baseline 一致, 当所有 fallback 失败时用) ───────────

export const DEFAULT_THETA_V2 = Object.freeze({
    pbTension_strength: 0.55,
    pbBrake_slope: 5.0,
    pbBrake_center: 0.95,
    pbOvershoot_decay: 0.25,
    pbSurprise_rate: 0.07,
    personalizationStrength: 0.10,
    temperature: 0.05,
    surpriseBudgetGain: 0.07,
    surpriseCooldown: 6,
    maxEvaluatedTriplets: 80,
    tripletBaseTemp: 1.0,
    floorBoost: 0.1,
    cornerPenalty: 0.15,
    lineBonusWeight: 1.0,
});


// ─────────── 模块状态 ───────────

let _policiesByCtx = null;     // Map<context_key, policy>
let _fuzzyIndex = null;        // Map<"d:g:b:pb:*", first policy>
let _coarseIndex = null;       // Map<"d:g:*:*:*", first policy>
let _rolloutPct = 100;
let _modelSha = '';
let _generatedAt = 0;
let _loadedFrom = '';          // 'bundle' / 'server' / 'none'
let _stats = { hits: 0, fuzzy: 0, coarse: 0, gateOut: 0, fallback: 0 };


// ─────────── Public API ───────────

/**
 * 把策略数组装到内存。
 * @param {object} bundle - { policies: [...], rollout_pct, model_sha256, generated_at }
 */
export function installPoliciesV2(bundle) {
    if (!bundle || !Array.isArray(bundle.policies)) {
        _policiesByCtx = null;
        return { installed: 0 };
    }
    _policiesByCtx = new Map();
    _fuzzyIndex = new Map();
    _coarseIndex = new Map();
    _rolloutPct = clampInt(bundle.rollout_pct ?? 100, 0, 100);
    _modelSha = bundle.model_sha256 || '';
    _generatedAt = bundle.generated_at || 0;
    _stats = { hits: 0, fuzzy: 0, coarse: 0, gateOut: 0, fallback: 0 };

    for (const p of bundle.policies) {
        if (!p?.context_key || !p?.theta) continue;
        _policiesByCtx.set(p.context_key, p);
        const parts = p.context_key.split(':');
        if (parts.length >= 4) {
            const fuzzy = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:*`;
            if (!_fuzzyIndex.has(fuzzy)) _fuzzyIndex.set(fuzzy, p);
            const coarse = `${parts[0]}:${parts[1]}:*:*:*`;
            if (!_coarseIndex.has(coarse)) _coarseIndex.set(coarse, p);
        }
    }
    return {
        installed: _policiesByCtx.size,
        rollout_pct: _rolloutPct,
        model_sha: _modelSha,
    };
}


/** 卸载 (回滚到 DEFAULT_THETA_V2)。 */
export function uninstallPoliciesV2() {
    _policiesByCtx = null;
    _fuzzyIndex = null;
    _coarseIndex = null;
    _rolloutPct = 100;
}


/**
 * 解析玩家 context → 应使用的 θ。
 *
 * @param {object} playerCtx
 *   difficulty / generator / bot_policy / pb_bin / lifecycle_stage / userId
 * @returns {{ theta: object, source: string, contextKey: string|null }}
 *   source ∈ 'exact' / 'fuzzy-lifecycle' / 'coarse-gen' / 'gate-out' / 'no-policies' / 'fallback'
 */
export function resolveThetaV2(playerCtx = {}) {
    // 0. 没装策略 → default
    if (!_policiesByCtx) {
        _stats.fallback++;
        return { theta: { ...DEFAULT_THETA_V2 }, source: 'no-policies', contextKey: null };
    }

    // 1. 灰度门: bucket < rollout_pct 才吃 v2
    if (_rolloutPct < 100) {
        const bucket = hashUserToBucket(playerCtx.userId || '');
        if (bucket >= _rolloutPct) {
            _stats.gateOut++;
            return { theta: { ...DEFAULT_THETA_V2 }, source: 'gate-out', contextKey: null };
        }
    }

    // 2. exact 匹配
    const key = buildContextKeyV2(playerCtx);
    if (_policiesByCtx.has(key)) {
        _stats.hits++;
        const p = _policiesByCtx.get(key);
        return { theta: { ...DEFAULT_THETA_V2, ...p.theta }, source: 'exact', contextKey: key };
    }

    // 3. fuzzy: 同 lifecycle 之外的维度
    const parts = key.split(':');
    if (parts.length >= 4) {
        const fuzzy = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:*`;
        if (_fuzzyIndex.has(fuzzy)) {
            _stats.fuzzy++;
            const p = _fuzzyIndex.get(fuzzy);
            return { theta: { ...DEFAULT_THETA_V2, ...p.theta }, source: 'fuzzy-lifecycle', contextKey: p.context_key };
        }

        // 4. coarse: 仅 difficulty + generator
        const coarse = `${parts[0]}:${parts[1]}:*:*:*`;
        if (_coarseIndex.has(coarse)) {
            _stats.coarse++;
            const p = _coarseIndex.get(coarse);
            return { theta: { ...DEFAULT_THETA_V2, ...p.theta }, source: 'coarse-gen', contextKey: p.context_key };
        }
    }

    // 5. 全失败 → default
    _stats.fallback++;
    return { theta: { ...DEFAULT_THETA_V2 }, source: 'fallback', contextKey: null };
}


/** 加载离线 bundle (Web/Android/iOS 走 fetch)。 */
export async function loadPoliciesFromBundleV2(url = '/spawn-tuning-v2/policies.json') {
    try {
        const r = await fetch(url, { cache: 'force-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bundle = await r.json();
        if (bundle?.format !== 'openblock-spawn-tuning-v2-bundle') {
            throw new Error('unsupported bundle format');
        }
        const result = installPoliciesV2(bundle);
        _loadedFrom = 'bundle';
        return { ...result, source: 'bundle' };
    } catch (e) {
        return { installed: 0, source: 'bundle', error: String(e && e.message || e) };
    }
}


/** 加载 server-side bundle (优先, 拿最新灰度比例)。 */
export async function loadPoliciesFromServerV2(apiBaseUrl = '') {
    try {
        const base = (apiBaseUrl || '').replace(/\/+$/, '');
        const r = await fetch(`${base}/api/spawn-tuning-v2/policies/active`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        if (!data.deployed) return { installed: 0, source: 'server', reason: 'no deployed' };

        // server 不直接返回 policies 内容 (太大), 仅返回 model 元数据;
        // 真实 policies 仍由 bundle 提供 — 这里只更新 rollout_pct (若有)
        return { installed: 0, source: 'server', deployedMeta: data.deployed };
    } catch (e) {
        return { installed: 0, source: 'server', error: String(e && e.message || e) };
    }
}


/**
 * 启动初始化: 优先 bundle, 失败再尝试 server (拿元数据)。
 *
 * @param {object} opts
 *   bundleUrl? — 默认 '/spawn-tuning-v2/policies.json' (Vite 自动 serve dist/)
 *   bundleData? — 微信小程序 require 进来的对象 (优先级最高)
 *   apiBaseUrl? — server fetch 基址
 */
export async function initClientPolicyV2(opts = {}) {
    // 1. 小程序场景: 直接 install 传入的 bundleData
    if (opts.bundleData) {
        return { ...installPoliciesV2(opts.bundleData), source: 'inline' };
    }
    // 2. Web/Capacitor: fetch bundle
    if (typeof fetch !== 'undefined') {
        return await loadPoliciesFromBundleV2(opts.bundleUrl);
    }
    // 3. 无 fetch (Node 老版) — 跳过
    return { installed: 0, source: 'none' };
}


// ─────────── 工具 ───────────

/** 用户 ID hash 到 [0, 100) 的 bucket。同一用户每次结果一致。 */
export function hashUserToBucket(userId) {
    if (!userId) return 50; // 匿名用户落中段
    let h = 5381;
    for (let i = 0; i < userId.length; i++) {
        h = ((h << 5) + h) + userId.charCodeAt(i);
        h = h | 0; // 32-bit
    }
    return Math.abs(h) % 100;
}


/** 把 5 维 context → "d:g:b:pb:l" key (与 server 端一致)。 */
export function buildContextKeyV2(ctx) {
    return [
        ctx.difficulty || 'normal',
        ctx.generator || 'budget-p2',
        ctx.bot_policy || 'clear-greedy',
        String(ctx.pb_bin ?? 1500),
        ctx.lifecycle_stage || 'growth',
    ].join(':');
}


function clampInt(v, lo, hi) {
    v = Number(v);
    if (!Number.isFinite(v)) return lo;
    return Math.max(lo, Math.min(hi, Math.round(v)));
}


/** 获取统计 (用于 dashboard / 调试)。 */
export function getStatsV2() {
    return {
        loaded: _policiesByCtx !== null,
        count: _policiesByCtx?.size ?? 0,
        rollout_pct: _rolloutPct,
        model_sha: _modelSha,
        generated_at: _generatedAt,
        loaded_from: _loadedFrom,
        ..._stats,
    };
}
