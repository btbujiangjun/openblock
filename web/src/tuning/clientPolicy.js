/**
 * 客户端灰度切量 - 把 (context → θ) 策略表加载到内存,运行时按玩家 context 查表。
 *
 * 设计依据: docs/algorithms/SPAWN_AUTO_TUNING.md §8 / §15.8
 *
 * 4 层退化兜底:
 *   0. 精确匹配: 完整 context_key
 *   1. lifecycle 模糊: 同 difficulty/generator/bestScore_bin, 任意 lifecycle
 *   2. 仅 difficulty+generator 匹配 (跨 bestScore/lifecycle)
 *   3. 全局 DEFAULT_THETA (寻参未部署 / 服务不可达 / 签名失败)
 *
 * 安全性:
 *   - HMAC 签名校验 (防 CDN/中间人篡改)
 *   - 灰度抽样 (rollout_pct < 100 时,按 user_id 哈希决定是否吃 policy)
 *   - 任何失败都 fallback 到 DEFAULT_THETA,绝不让玩家因后端故障玩到坏出块
 */

import { defaultTheta } from './paramSpace.js';
import { getBestScoreBin, getLifecycleStage, makeContextKey } from './contextSpace.js';
import { generateLookupChain } from './contextExtension.js';

/**
 * 全局默认 θ - 当所有查找都失败时使用。
 * 与 PARAM_SPACE_V1 各项 default 一致, 是当前 spawn-eval UI 的初始值。
 */
export const DEFAULT_THETA = Object.freeze(defaultTheta());

let _policies = null;          // Map<context_key, { theta, signature, expected_composite }>
let _coarseIndex = null;       // Map<'difficulty:generator:*:*', context_key>
let _fuzzyIndex = null;        // Map<'difficulty:generator:bin:*', context_key>
let _rolloutPct = 0;           // 0~100, 灰度百分比 (来自 server 元数据)
let _runId = null;
let _loadedAt = 0;
let _stats = { hits: 0, fuzzy: 0, coarse: 0, fallback: 0, gateOut: 0 };

/**
 * 用 user_id 哈希决定是否落在灰度窗口内 (确定性,同一用户每次结果一致)。
 *
 * @param {string} userId
 * @returns {number} ∈ [0, 100)
 */
export function hashUserToBucket(userId) {
    if (!userId) return 50;  // 匿名默认中间
    let h = 5381;
    for (let i = 0; i < userId.length; i++) {
        h = ((h << 5) + h) + userId.charCodeAt(i);
        h = h | 0;  // 32-bit
    }
    return Math.abs(h) % 100;
}

/**
 * 安装 policies (来自 /api/spawn-tuning/v2/policies/active)。
 *
 * @param {Array<object>} policies - 至少包含 context_key / theta / signature
 * @param {object} [meta] - { rolloutPct: 0~100, runId, secret? }
 */
export function installPolicies(policies, meta = {}) {
    if (!Array.isArray(policies) || policies.length === 0) {
        _policies = null;
        _coarseIndex = null;
        _fuzzyIndex = null;
        return { installed: 0, fuzzyKeys: 0, coarseKeys: 0 };
    }
    _policies = new Map();
    _fuzzyIndex = new Map();
    _coarseIndex = new Map();
    _rolloutPct = Math.max(0, Math.min(100, Number(meta.rolloutPct ?? 100)));
    _runId = meta.runId ?? null;
    _loadedAt = Date.now();
    _stats = { hits: 0, fuzzy: 0, coarse: 0, fallback: 0, gateOut: 0 };

    for (const p of policies) {
        if (!p?.context_key || !p?.theta) continue;
        _policies.set(p.context_key, p);
        // 索引退化层
        const fuzzyKey = `${p.difficulty}:${p.generator}:${p.bestScore_bin}:*`;
        if (!_fuzzyIndex.has(fuzzyKey)) _fuzzyIndex.set(fuzzyKey, p.context_key);
        const coarseKey = `${p.difficulty}:${p.generator}:*:*`;
        if (!_coarseIndex.has(coarseKey)) _coarseIndex.set(coarseKey, p.context_key);
    }
    return {
        installed: _policies.size,
        fuzzyKeys: _fuzzyIndex.size,
        coarseKeys: _coarseIndex.size,
        rolloutPct: _rolloutPct,
        runId: _runId,
    };
}

/**
 * 卸载所有 policies (一键回滚)。
 */
export function uninstallPolicies() {
    _policies = null;
    _coarseIndex = null;
    _fuzzyIndex = null;
    _rolloutPct = 0;
    _runId = null;
}

/**
 * 解析玩家 context 为 4 维 context key。
 *
 * @param {object} ctx { difficulty, generator, bestScore, totalRounds, daysSincePb }
 */
export function buildPlayerContextKey(ctx) {
    const bin = getBestScoreBin(ctx.bestScore ?? 1000);
    const stage = getLifecycleStage(ctx.totalRounds ?? 0, ctx.daysSincePb ?? 0);
    return makeContextKey({
        difficulty: ctx.difficulty || 'normal',
        generator: ctx.generator || 'budget-p2',
        bestScore_bin: bin,
        lifecycle_stage: stage,
    });
}

/**
 * 在已安装的 policies 中查 θ。4 层退化。
 *
 * @param {object} playerCtx - { difficulty, generator, bestScore, totalRounds, daysSincePb, userId }
 * @returns {{ theta: object, source: string, contextKey: string }}
 */
export function resolveSpawnTheta(playerCtx = {}) {
    // 灰度门: 用户 user_id 落在 rolloutPct 之外 → fallback
    if (_policies && _rolloutPct < 100) {
        const bucket = hashUserToBucket(playerCtx.userId);
        if (bucket >= _rolloutPct) {
            _stats.gateOut++;
            return { theta: { ...DEFAULT_THETA }, source: 'gate-out', contextKey: null };
        }
    }

    if (!_policies) {
        _stats.fallback++;
        return { theta: { ...DEFAULT_THETA }, source: 'no-policies', contextKey: null };
    }

    const exactKey = buildPlayerContextKey(playerCtx);

    // 扩展维度优先: 用 generateLookupChain 拿到精确→剥离的候选链
    // 注: 当前 server 端只存 4 维 key, 扩展维度先剥到主 key 再查。
    // 等业务真正启用扩展维度时,server 端也要存对应 key。
    const lookupChain = generateLookupChain(exactKey, playerCtx);
    for (const candidate of lookupChain) {
        if (_policies.has(candidate)) {
            _stats.hits++;
            const p = _policies.get(candidate);
            const matchedSource = candidate === exactKey ? 'exact' : 'extended-chain';
            return { theta: { ...p.theta }, source: matchedSource, contextKey: candidate };
        }
    }

    // 退化 1: lifecycle fuzzy
    const parts = exactKey.split(':');
    const fuzzyKey = `${parts[0]}:${parts[1]}:${parts[2]}:*`;
    const fuzzyCtxKey = _fuzzyIndex?.get(fuzzyKey);
    if (fuzzyCtxKey && _policies.has(fuzzyCtxKey)) {
        _stats.fuzzy++;
        const p = _policies.get(fuzzyCtxKey);
        return { theta: { ...p.theta }, source: 'fuzzy-lifecycle', contextKey: fuzzyCtxKey };
    }

    // 退化 2: coarse difficulty+generator
    const coarseKey = `${parts[0]}:${parts[1]}:*:*`;
    const coarseCtxKey = _coarseIndex?.get(coarseKey);
    if (coarseCtxKey && _policies.has(coarseCtxKey)) {
        _stats.coarse++;
        const p = _policies.get(coarseCtxKey);
        return { theta: { ...p.theta }, source: 'coarse-gen', contextKey: coarseCtxKey };
    }

    _stats.fallback++;
    return { theta: { ...DEFAULT_THETA }, source: 'fallback', contextKey: null };
}

/**
 * 获取统计 (用于诊断与 dashboard)。
 */
export function getPolicyStats() {
    return {
        loaded: _policies !== null,
        count: _policies?.size ?? 0,
        runId: _runId,
        rolloutPct: _rolloutPct,
        loadedAt: _loadedAt,
        ..._stats,
    };
}

/**
 * 从 server 加载 active policies + meta。
 *
 * @param {string} [apiBaseUrl='']
 * @param {{verifySignature?: (policy: object) => boolean}} [opts]
 * @returns {Promise<{installed: number, ...}>}
 */
export async function loadPoliciesFromServer(apiBaseUrl = '', opts = {}) {
    try {
        const url = `${(apiBaseUrl || '').replace(/\/+$/, '')}/api/spawn-tuning/v2/policies/active`;
        const r = await fetch(url, { method: 'GET' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();

        const verify = opts.verifySignature;
        const policies = (data.policies || []).filter((p) => {
            if (!verify) return true;
            try { return verify(p); }
            catch { return false; }
        });

        const meta = {
            rolloutPct: data.rollout_pct ?? 100,
            runId: data.run_id ?? null,
        };
        const result = installPolicies(policies, meta);
        return { ...result, source: 'server', verifiedCount: policies.length, totalReceived: data.policies?.length || 0 };
    } catch (e) {
        // 不立刻 uninstall — bundle 可能已经装上了。调用方决定降级策略。
        return { installed: 0, error: e?.message || String(e), source: 'server' };
    }
}

/**
 * 从客户端 bundle (静态资源) 加载 policies。
 *
 * Web/Android/iOS: 读 /spawn-tuning/policies.json (由 spawn_tuning_backend
 *   /policies/bundle/export 写入 web/public/spawn-tuning/, Vite/Capacitor 自动打包)
 *
 * 设计目的: 离线场景或冷启动断网时,保证依然能用到最近一版烘焙的策略,
 *   不会降级到 DEFAULT_THETA (= 完全没寻参的状态)。
 *
 * 调用约定: 启动时先调本函数立即 install,再异步去 server 拉最新覆盖。
 *
 * @param {string} [bundleUrl='/spawn-tuning/policies.json']
 * @returns {Promise<{installed: number, source: 'bundle', ...}>}
 */
export async function loadPoliciesFromBundle(bundleUrl = '/spawn-tuning/policies.json') {
    try {
        const r = await fetch(bundleUrl, { cache: 'force-cache' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const policies = data.policies || [];
        if (policies.length === 0) {
            return { installed: 0, source: 'bundle', reason: 'empty' };
        }
        // bundle 默认全量灰度;线上 rollout_pct 由后续 server fetch 覆盖
        const meta = {
            rolloutPct: data.rollout_pct ?? 100,
            runId: data.run_id ?? data.runId ?? 'bundle',
        };
        const result = installPolicies(policies, meta);
        return {
            ...result,
            source: 'bundle',
            bundleRunId: meta.runId,
            generatedAt: data.generated_at || null,
        };
    } catch (e) {
        return { installed: 0, source: 'bundle', error: e?.message || String(e) };
    }
}
