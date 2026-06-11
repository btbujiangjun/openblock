/**
 * spawnTuning.ts —— Cocos 端接通「出块寻参 v2」(SpawnParamTuner / clientPolicyV2)。
 *
 * 背景：θ 寻参的纯逻辑闭包 engine/tuning/v2/clientPolicyV2.mjs 与 web/小程序完全同源，
 * 但它需要运行期：(1) 加载 360 条 ctx 的 θ bundle；(2) 把模块挂到 globalThis，让底层
 * adaptiveSpawn.resolveAdaptiveStrategy 内的 resolveThetaV2 能取到。Web 走 fetch
 * /spawn-tuning-v2/policies.json，小程序 require 内联 bundle —— Cocos 原生/各打包平台
 * 无后端可 fetch，故此处 import 由 scripts/sync-spawn-bundle.mjs 内联生成的 ESM bundle，
 * 启动时 initClientPolicyV2({ bundleData }) 安装，使 Cocos/各 mobile 端 θ 与 web 同源生效。
 *
 * 防御性：任何 import / install 失败都软失败回退 DEFAULT_THETA_V2（与未部署寻参时一致），
 * 绝不阻塞出块主路径。
 */

// @ts-ignore 生成的纯逻辑引擎（未类型化）；.mjs 以保证 Cocos 按 ESM 打包。
import * as clientPolicyV2 from '../engine/tuning/v2/clientPolicyV2.mjs';
// @ts-ignore 由 sync-spawn-bundle.mjs 内联的离线 θ bundle（export default）。
import spawnPoliciesV2 from '../engine/tuning/v2/spawnPoliciesV2.mjs';
// @ts-ignore 真实玩家画像（与 web/小程序同源）；resolveAdaptiveStrategy 的 !profile 早退依赖它非空。
import { PlayerProfile } from '../engine/playerProfile.mjs';

/** resolveAdaptiveStrategy 所需的真实 PlayerProfile（仅列出 Cocos 游戏层驱动的方法）。 */
export interface AdaptiveProfile {
    recordNewGame?(): void;
    recordSpawn?(): void;
    recordPickup?(): void;
    recordPlace?(cleared: boolean, linesCleared: number, boardFill: number): void;
    recordMiss?(): void;
    recordDelight?(kind: 'multiClear' | 'pcClear' | 'comboHigh' | 'monoFlush'): void;
    tickRoundForDelight?(): void;
    save?(): void;
}

/**
 * 创建真实 PlayerProfile（优先 load 复用跨局技能/会话历史，失败回退新实例，再失败回退空骨架）。
 * 返回对象直接传入 resolveAdaptiveStrategy，并由 GameController 在落子/消行处驱动。
 */
export function createPlayerProfile(): AdaptiveProfile {
    try {
        return (PlayerProfile as { load: () => AdaptiveProfile }).load();
    } catch {
        try {
            return new (PlayerProfile as unknown as new () => AdaptiveProfile)();
        } catch {
            return {};
        }
    }
}

interface ClientPolicyV2Module {
    initClientPolicyV2: (opts?: Record<string, unknown>) => unknown;
    resolveThetaV2: (ctx: Record<string, unknown>) => { theta: Record<string, number>; source: string; contextKey: string | null };
    getStatsV2?: () => Record<string, unknown>;
}

let _installed = false;

/** SpawnParamTuner v2 的玩家 context（5 维 + userId），口径与 web game.js / 小程序 gameController 一致。 */
export interface TuningV2Context {
    difficulty: 'easy' | 'normal' | 'hard';
    generator: 'rule' | 'generative';
    bot_policy: string;
    pb_bin: number;
    lifecycle_stage: 'onboarding' | 'growth' | 'mature' | 'plateau';
    userId: string;
}

/** 暴露 clientPolicyV2 模块（调试 / dashboard / stats 用）。 */
export function getClientPolicyV2(): ClientPolicyV2Module | null {
    return (clientPolicyV2 as unknown as ClientPolicyV2Module) ?? null;
}

/** 寻参是否已成功安装（>0 条策略）。 */
export function isSpawnTuningInstalled(): boolean {
    return _installed;
}

/**
 * 启动时调用一次：把寻参模块挂到 globalThis 并安装离线 bundle。
 * 幂等：重复调用只安装一次。返回安装到的策略条数（0 = 失败/空，自动回退 DEFAULT θ）。
 */
export function initSpawnTuningV2(): number {
    try {
        const mod = clientPolicyV2 as unknown as ClientPolicyV2Module;
        // adaptiveSpawn.resolveThetaV2 通过 globalThis.__openblockClientPolicyV2 取模块（避免循环 import）。
        (globalThis as unknown as Record<string, unknown>).__openblockClientPolicyV2 = mod;
        // initClientPolicyV2 是 async function，但传 bundleData 时 installPoliciesV2 是同步执行的。
        // 不能直接读返回值（Promise 对象无 .installed 属性），须先同步验证 resolveThetaV2 是否可用。
        mod.initClientPolicyV2({ bundleData: spawnPoliciesV2, pollMetaUrl: false });
        // 直接用 resolveThetaV2 + 一个已知的 context 做 probe，确认策略确实已装入内存。
        let installed = 0;
        try {
            const probe = mod.resolveThetaV2({ difficulty: 'easy', generator: 'rule', bot_policy: 'clear-greedy', pb_bin: 500, lifecycle_stage: 'onboarding', userId: '__probe__' });
            installed = (probe && probe.source !== 'default') ? (spawnPoliciesV2 as { n_contexts?: number }).n_contexts ?? 360 : 0;
        } catch { /* probe 失败 = 未安装 */ }
        // 兜底：检查 getStatsV2 是否报告命中。
        if (installed === 0 && mod.getStatsV2) {
            try {
                const stats = mod.getStatsV2() as { policyCount?: number } | undefined;
                installed = Number(stats?.policyCount ?? 0);
            } catch { /* ignore */ }
        }
        _installed = installed > 0;
        console.log(`[spawn-tuning-v2] cocos installed ${installed} policies (rollout=${(spawnPoliciesV2 as { rollout_pct?: number })?.rollout_pct ?? 100}%)`);
        return installed;
    } catch (e) {
        console.warn('[spawn-tuning-v2] cocos init failed (fallback DEFAULT theta)', e);
        _installed = false;
        return 0;
    }
}

/** 个人最佳分 → pb_bin（5 档，取最近 ≤ 档），与 web/小程序严格一致。 */
function pbBinOf(bestScore: number): number {
    const b = Number(bestScore) || 0;
    return b < 500 ? 500 : b < 1500 ? 1500 : b < 4000 ? 4000 : b < 10000 ? 10000 : 25000;
}

/** 累计出块轮数 → 生命周期阶段，与 web/小程序严格一致。 */
function lifecycleOf(totalRounds: number): TuningV2Context['lifecycle_stage'] {
    const n = Number(totalRounds) || 0;
    return n < 5 ? 'onboarding' : n < 30 ? 'growth' : n < 100 ? 'mature' : 'plateau';
}

/**
 * 构造 SpawnParamTuner v2 玩家 context。
 *
 * 维度取值必须命中 bundle 的 context_key（difficulty:generator:bot:pb_bin:lifecycle）：
 *   - generator 固定 'rule'（Cocos 走规则引擎 generateDockShapes，非 model-v3 生成）；
 *     口径与 web getSpawnPolicyMode()→'rule' 一致，避免历史「triplet-p1/budget-p2」误用导致全 miss。
 *   - bot_policy 固定 'clear-greedy'（真实玩家近似），bundle 内存在该档。
 */
export function buildTuningV2Context(opts: {
    strategyId?: string;
    bestScore?: number;
    totalRounds?: number;
    userId?: string;
}): TuningV2Context {
    const sid = opts.strategyId;
    const difficulty: TuningV2Context['difficulty'] = (sid === 'hard' || sid === 'normal') ? sid : 'easy';
    return {
        difficulty,
        generator: 'rule',
        bot_policy: 'clear-greedy',
        pb_bin: pbBinOf(opts.bestScore ?? 0),
        lifecycle_stage: lifecycleOf(opts.totalRounds ?? 0),
        userId: opts.userId || '',
    };
}
