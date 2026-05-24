/**
 * Game.js 集成钩子 — 把寻参 θ 接入主路径,但保持「可选 / 不破坏现有逻辑」。
 *
 * 设计依据: docs/algorithms/SPAWN_AUTO_TUNING.md §8 / §15.8
 *
 * 接入模式 (最小侵入):
 *   1. game.js 启动时调 initSpawnTuningHook() — 异步加载 policies,失败不阻塞游戏
 *   2. game.js 每次 spawn 前调 augmentSpawnContext(ctx, player) — 注入 modelConfig 到 ctx
 *   3. simulator/generateExperimentalDockShapes 自动读 ctx.modelConfig (无需改)
 *
 * 失败兜底:
 *   - 任何加载失败 → uninstall → 后续 augment 返回原 ctx (零侵入)
 *   - 服务端不可达 → uninstall → 等价于 baseline 行为
 *   - HMAC 验签失败的 policy 被丢弃,但其他正常 policy 仍生效
 *
 * 关键约定:
 *   - augmentSpawnContext 只追加字段,不修改任何 ctx 原有字段
 *   - 如果 player 走 gate-out 桶,augment 仍返回原 ctx (等价 baseline)
 *   - 主路径默认 spawnGenerator='baseline',θ 只在选 P2 时生效
 */

import {
    DEFAULT_THETA,
    installPolicies,
    uninstallPolicies,
    resolveSpawnTheta,
    loadPoliciesFromServer,
    loadPoliciesFromBundle,
    getPolicyStats,
} from './clientPolicy.js';
import {
    verifyPoliciesBatch,
    setVerifyMode,
    setSharedSecret,
    fetchAndCacheSecret,
    getVerifyStatus,
} from './hmacVerify.js';
import { recordPolicyResolve } from './policyMetrics.js';

let _hookEnabled = false;
let _loadPromise = null;
let _verifySecret = null;
let _lastReload = 0;
let _bundleResult = null;  // 启动时 bundle 加载结果 (用于 status 报告)
let _serverResult = null;  // 最近一次 server reload 结果
const RELOAD_INTERVAL_MS = 5 * 60 * 1000;  // 5 分钟自动刷新一次 (灰度比例可能后台调)
const DEFAULT_BUNDLE_URL = '/spawn-tuning/policies.json';

/**
 * 初始化集成钩子 — 在游戏启动时调一次。
 *
 * 启动顺序 (offline-first, v0.3.7):
 *   1. 立即 (同步等待) 加载 bundle (/spawn-tuning/policies.json) — 零延迟、断网可用
 *   2. 异步 fetch server /policies/active — 拿到最新灰度比例和 policies, 覆盖 bundle
 *   3. server 失败 — bundle 保留生效 (不会降级到 DEFAULT_THETA)
 *   4. server / bundle 都失败 — uninstall, 走 DEFAULT_THETA (= 当前 baseline)
 *
 * @param {object} opts
 * @param {string} [opts.apiBaseUrl=''] - API 基址
 * @param {string} [opts.hmacSecret=null] - HMAC 密钥 (模式 A: 编译期注入,开发用)
 * @param {string} [opts.authToken=null] - 模式 B: 启动时拉取 secret 的 Bearer token
 * @param {boolean} [opts.autoReload=true] - 是否每 5 分钟自动刷新 policies
 * @param {'auto'|'none'|'structural'|'hmac-shared'} [opts.verifyMode='auto'] - 验签强度
 * @param {string|false} [opts.bundleUrl='/spawn-tuning/policies.json'] - 离线 bundle URL,
 *                                                                       false = 禁用 bundle 优先加载
 * @returns {Promise<{installed: number, verifyMode: string, source: string, ...}>}
 */
export async function initSpawnTuningHook(opts = {}) {
    _verifySecret = opts.hmacSecret || null;
    _hookEnabled = true;

    // 1. 配置验签模式
    // 'auto' 策略: 优先编译期 secret (强)、其次 server fetch (强)、最后 structural (零信任 baseline)
    const mode = opts.verifyMode || 'auto';
    if (mode === 'auto') {
        if (opts.hmacSecret) {
            setSharedSecret(opts.hmacSecret);
        } else if (opts.authToken) {
            await fetchAndCacheSecret(opts.apiBaseUrl || '', { authToken: opts.authToken });
        } else {
            setVerifyMode('structural');
        }
    } else {
        setVerifyMode(mode);
        if (mode === 'hmac-shared' && opts.hmacSecret) {
            setSharedSecret(opts.hmacSecret);
        }
    }

    // 2. Bundle first — 读静态资源立即 install (即使后面网络全断也保住寻参生效)
    if (opts.bundleUrl !== false) {
        try {
            _bundleResult = await loadPoliciesFromBundle(opts.bundleUrl || DEFAULT_BUNDLE_URL);
        } catch (e) {
            _bundleResult = { installed: 0, source: 'bundle', error: String(e) };
        }
    }

    // 3. Server next — 异步覆盖 bundle (拿最新灰度比例 + 最新 policies)
    _serverResult = await reloadPolicies(opts.apiBaseUrl || '');

    // 4. 决定最终状态
    //    - server 成功 → install 已被 server 数据替换
    //    - server 失败 但 bundle 已 install → 保持 bundle
    //    - 两者都失败 → uninstall (走 DEFAULT_THETA)
    let finalSource = 'none';
    if (_serverResult?.installed > 0) {
        finalSource = 'server';
    } else if (_bundleResult?.installed > 0) {
        finalSource = 'bundle';
    } else {
        uninstallPolicies();
    }

    // 5. 定时刷新 — 仅刷 server (bundle 是构建期产物,不会变)
    if (opts.autoReload !== false) {
        setInterval(() => {
            // server 成功就替换, 失败保留之前 install 的(可能是 bundle 或上次 server)
            reloadPolicies(opts.apiBaseUrl || '').catch(() => {});
        }, RELOAD_INTERVAL_MS);
    }

    return {
        installed: _serverResult?.installed || _bundleResult?.installed || 0,
        source: finalSource,
        bundle: _bundleResult,
        server: _serverResult,
        verifyMode: getVerifyStatus().mode,
    };
}

/**
 * 主动 reload (用于 UI 触发的手动刷新)。
 *
 * 注: 失败时 loadPoliciesFromServer 不会 uninstall (保留已装的 bundle / 上次 server)。
 *     这与 initSpawnTuningHook 的 bundle-first 策略一致。
 */
export async function reloadPolicies(apiBaseUrl = '') {
    if (_loadPromise) return _loadPromise;
    _loadPromise = (async () => {
        try {
            const result = await loadPoliciesFromServer(apiBaseUrl, {
                verifySignature: _verifySecret
                    ? (p) => Boolean(p?.signature && p.signature.length >= 40)
                    : undefined,
            });
            _lastReload = Date.now();
            return result;
        } finally {
            _loadPromise = null;
        }
    })();
    return _loadPromise;
}

/**
 * 强 HMAC 验签版 reload (生产推荐)。
 *
 * 等价于 reloadPolicies + verifyPoliciesBatch 异步两步。
 */
export async function reloadPoliciesWithHmac(apiBaseUrl = '', secret) {
    if (!secret) {
        return reloadPolicies(apiBaseUrl);
    }
    try {
        const url = `${(apiBaseUrl || '').replace(/\/+$/, '')}/api/spawn-tuning/v2/policies/active`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        const policies = data.policies || [];
        const verified = await verifyPoliciesBatch(policies, secret);
        const meta = {
            rolloutPct: data.rollout_pct ?? 100,
            runId: data.run_id ?? null,
        };
        const installResult = installPolicies(verified, meta);
        _lastReload = Date.now();
        return { ...installResult, verifiedCount: verified.length, totalReceived: policies.length };
    } catch (e) {
        uninstallPolicies();
        return { installed: 0, error: e?.message || String(e) };
    }
}

/**
 * 给 spawnContext 注入 θ 的 modelConfig 字段 (game.js 在 spawn 前调用)。
 *
 * 不修改 ctx 原有任何字段,只 spread θ 字段到结果上。
 * 失败/未启用/未加载 — 都返回 ctx 自身,不影响主路径。
 *
 * @param {object} ctx - 原 spawnContext
 * @param {object} player - { difficulty, bestScore, totalRounds, daysSincePb, userId }
 * @returns {object} - augmented ctx (新对象,不修改原 ctx)
 */
export function augmentSpawnContext(ctx, player = {}) {
    if (!_hookEnabled) return ctx;

    try {
        const { theta, source, contextKey } = resolveSpawnTheta({
            difficulty: player.difficulty || ctx?.difficulty || 'normal',
            generator: player.spawnGenerator || ctx?.spawnGenerator || 'budget-p2',
            bestScore: player.bestScore || ctx?.bestScore || 1000,
            totalRounds: player.totalRounds || ctx?.totalRounds || 0,
            daysSincePb: player.daysSincePb || ctx?.daysSincePb || 0,
            userId: player.userId || ctx?.userId || '',
        });

        // 上报到 policyMetrics (无论命中与否,失败不报错)
        try { recordPolicyResolve(source, contextKey, theta); } catch {}

        if (source === 'no-policies' || source === 'gate-out' || source === 'fallback') {
            // 不注入,保持 baseline
            return ctx;
        }

        // 把 θ 拆成 modelConfig + 其他字段注入
        return {
            ...ctx,
            modelConfig: {
                personalizationStrength: theta.personalizationStrength,
                temperature: theta.temperature,
                surpriseBudgetGain: theta.surpriseBudgetGain,
                surpriseCooldown: theta.surpriseCooldown,
            },
            // 其余 10 个参数当前 simulator 暂未消费, 先存在 ctx 备用 (将来 adaptiveSpawn.js
            // 接入时直接读 ctx.tuningTheta 即可,不需要再改 game.js)
            tuningTheta: theta,
            tuningSource: source,
        };
    } catch (e) {
        // 任何异常都退回原 ctx
        if (typeof console !== 'undefined') console.warn('[gameIntegration] augment failed:', e);
        return ctx;
    }
}

/**
 * 获取当前 hook 统计 (用于 dashboard / 调试)。
 */
export function getHookStatus() {
    return {
        enabled: _hookEnabled,
        lastReload: _lastReload,
        secretConfigured: _verifySecret !== null,
        bundleResult: _bundleResult,
        serverResult: _serverResult,
        ...getPolicyStats(),
    };
}

/**
 * 禁用钩子 (回滚到完全无 θ 状态)。
 */
export function disableSpawnTuningHook() {
    _hookEnabled = false;
    uninstallPolicies();
}
