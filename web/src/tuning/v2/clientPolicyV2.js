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

// ─────────── 默认 θ (9 维, 与 baseline 一致, 当所有 fallback 失败时用) ───────────
//
// v2.2: 与 Python feature_io.THETA_KEYS / samplerV2 严格一致;
//       这里只暴露 simulator/adaptiveSpawn 真正消费的 9 维 (5 个个性化 + 4 个 PB 曲线)。
//
export const DEFAULT_THETA_V2 = Object.freeze({
    personalizationStrength: 0.10,
    temperature: 0.05,
    surpriseBudgetGain: 0.07,
    surpriseCooldown: 6,
    maxEvaluatedTriplets: 80,
    // v2.2: PB 曲线参数 (= adaptiveSpawn.DEFAULT_SPAWN_PARAMS_PB_CURVE)
    pbTensionCenter: 0.82,
    pbTensionWidth: 0.08,
    pbBrakeCenter: 1.05,
    pbBrakeWidth: 0.06,
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

// 与 rl_pytorch/spawn_tuning_v2/feature_io.THETA_KEYS 严格同序；
// 用于兼容老 bundle（theta 字段是 normalized [0,1] 数组而非 dict）。
const THETA_KEYS_ORDER = [
    'personalizationStrength',
    'temperature',
    'surpriseBudgetGain',
    'surpriseCooldown',
    'maxEvaluatedTriplets',
    'pbTensionCenter',
    'pbTensionWidth',
    'pbBrakeCenter',
    'pbBrakeWidth',
];
// 反归一化范围，必须与 feature_io.THETA_RANGES 严格一致。
const THETA_RANGES = Object.freeze({
    personalizationStrength: [0.05, 0.18],
    temperature: [0.03, 0.08],
    surpriseBudgetGain: [0.05, 0.10],
    surpriseCooldown: [4, 10],
    maxEvaluatedTriplets: [32, 128],
    pbTensionCenter: [0.70, 0.92],
    pbTensionWidth: [0.04, 0.15],
    pbBrakeCenter: [0.98, 1.15],
    pbBrakeWidth: [0.03, 0.12],
});

/**
 * 兼容老 bundle：把 normalized [0,1] 数组反归一化为 dict。
 * 新 bundle 直接是 dict 时原样返回。
 */
function _normalizeThetaShape(theta) {
    if (!theta) return null;
    if (Array.isArray(theta)) {
        const out = {};
        for (let i = 0; i < THETA_KEYS_ORDER.length; i++) {
            const k = THETA_KEYS_ORDER[i];
            const [lo, hi] = THETA_RANGES[k];
            const norm = Number.isFinite(theta[i]) ? theta[i] : 0.5;
            out[k] = norm * (hi - lo) + lo;
        }
        return out;
    }
    return theta;
}


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
        // 兼容老 bundle 的 normalized 数组：反归一化为 dict 后存储。
        // 新 bundle 已经是 dict，原样保留。
        const normalized = { ...p, theta: _normalizeThetaShape(p.theta) };
        _policiesByCtx.set(p.context_key, normalized);
        const parts = p.context_key.split(':');
        if (parts.length >= 4) {
            const fuzzy = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:*`;
            if (!_fuzzyIndex.has(fuzzy)) _fuzzyIndex.set(fuzzy, normalized);
            const coarse = `${parts[0]}:${parts[1]}:*:*:*`;
            if (!_coarseIndex.has(coarse)) _coarseIndex.set(coarse, normalized);
        }
    }
    const result = {
        installed: _policiesByCtx.size,
        rollout_pct: _rolloutPct,
        model_sha: _modelSha,
    };
    // 异步加载完成事件：spawnModelPanel 等 UI 订阅以即时刷新「规则/寻参」badge。
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent('openblock:spawn-param-tuner-installed', { detail: result }));
        } catch { /* ignore CustomEvent unavailable */ }
    }
    return result;
}


/** 卸载 (回滚到 DEFAULT_THETA_V2)。
 *
 * 复用 ``openblock:spawn-param-tuner-installed`` 事件（detail.installed=0）通知 UI
 * 重绘 badge —— spawnModelPanel.js 的 ``_refreshPolicySourceBadge`` 已按
 * ``stats.loaded && stats.count > 0`` 判断，卸载后会自动翻回「规则」，无需新增 listener。
 */
export function uninstallPoliciesV2() {
    const wasLoaded = _policiesByCtx !== null;
    _policiesByCtx = null;
    _fuzzyIndex = null;
    _coarseIndex = null;
    _rolloutPct = 100;
    _modelSha = '';
    _generatedAt = 0;
    _loadedFrom = '';
    if (!wasLoaded) return;
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent('openblock:spawn-param-tuner-installed', {
                detail: { installed: 0, rollout_pct: 100, model_sha: '', uninstalled: true },
            }));
        } catch { /* ignore CustomEvent unavailable */ }
    }
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


/** 加载离线 bundle (Web/Android/iOS 走 fetch)。
 *
 * cache 策略说明：用 'no-cache' 而非 'force-cache'——后者会让浏览器在不发请求的情况下
 * 直接返回旧 bundle，导致后端重新部署 policies.json 后客户端继续吃老数据，
 * 表现为「dashboard 已显示 100% rollout 但启发式 badge 仍显示规则」的状态不一致。
 * 'no-cache' 强制 revalidate（带 If-None-Match，命中走 304，开销很小）。
 */
export async function loadPoliciesFromBundleV2(url = '/spawn-tuning-v2/policies.json') {
    try {
        const r = await fetch(url, { cache: 'no-cache' });
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
    // v2.10.10: 订阅跨 tab BroadcastChannel — dashboard D.1 导出 bundle 后
    // 立即重新 fetch + install，让游戏页 badge 实时翻为「寻参」，无需手工刷新。
    // 兼容 fallback：旧浏览器无 BroadcastChannel 时跳过（用户刷新页面仍能拉到新 bundle）。
    _subscribeBundleUpdates(opts.bundleUrl);

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

let _bundleUpdateChannel = null;

/**
 * 订阅 dashboard 的 bundle 更新 / 移除广播，自动 install / uninstall。
 * 多次调用幂等（重复 init 不会创建多个 channel）。
 *
 * 支持两种消息（均由 dashboardV2.js 在用户操作完成后 postMessage）：
 *   { type: 'bundle-updated' } — D.1 导出 bundle 后，re-fetch + install
 *   { type: 'bundle-removed' } — ① 移除部署 / rollback 到无 deployed 后，uninstall
 *
 * 设计取舍：bundle-removed 不再 fetch policies.json（文件已被后端删除，fetch 必然 404
 * 且会触发 SW 缓存读取）；直接走 uninstallPoliciesV2 让内存状态与 DB 一致。
 */
function _subscribeBundleUpdates(bundleUrl) {
    if (_bundleUpdateChannel) return;
    if (typeof BroadcastChannel !== 'function') return;
    try {
        const ch = new BroadcastChannel('openblock:spawn-param-tuner');
        ch.addEventListener('message', async (e) => {
            const type = e?.data?.type;
            if (type === 'bundle-updated') {
                try {
                    await loadPoliciesFromBundleV2(bundleUrl);
                    // installPoliciesV2 内部已 dispatch openblock:spawn-param-tuner-installed
                    // → spawnModelPanel.js 的 listener 自动刷新 badge 为「寻参」。
                } catch { /* ignore — 下次主动刷新仍能恢复 */ }
            } else if (type === 'bundle-removed') {
                // uninstallPoliciesV2 内部也 dispatch 同一事件（detail.uninstalled=true）
                // → spawnModelPanel.js 的 listener 自动把 badge 翻回「规则」。
                uninstallPoliciesV2();
            }
        });
        _bundleUpdateChannel = ch;
    } catch { /* ignore */ }
}

/** 仅供测试使用：拆除 BroadcastChannel 订阅。 */
export function _uninstallBundleUpdateChannelForTest() {
    if (_bundleUpdateChannel) {
        try { _bundleUpdateChannel.close(); } catch { /* ignore */ }
        _bundleUpdateChannel = null;
    }
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
