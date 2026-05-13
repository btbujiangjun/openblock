/**
 * epsilonGreedyExplorer.js — 5–10% 探索流量包装器
 *
 * v1.49.x 算法层 P1-1：
 *   解决"模型只在自己推荐过的 action 上有标签"的选择偏差问题。
 *
 * 工作流程：
 *   原始策略 deterministicPolicy(snapshot) → action_optimal
 *
 *   wrapWithExplorer:
 *      ├─ 以概率 ε（默认 0.05）：从 actionPool 中均匀随机抽一个 action 返回
 *      │   并打 mode='explore' 标签，便于后续按 IPS 加权
 *      └─ 以概率 1-ε：返回 action_optimal，mode='exploit'
 *
 *   每次决策都额外提供 propensity（被选中 action 的抽样概率）便于 IPS：
 *      P(a|x) = (1 - ε) · 1[a == optimal] + ε / |actionPool|
 *
 * 使用：
 *   const explorer = createEpsilonGreedyExplorer({ epsilon: 0.05 });
 *   const out = explorer.choose({ snapshot, candidates: ['iap', 'rewarded', 'interstitial', 'observe'], optimal: 'iap' });
 *   //  out = { action, mode, propensity, exploredFrom }
 *
 * 设计：
 *   - 随机种子可注入（Math.random 默认）→ 单测 deterministic
 *   - 用户级冷却：每个用户一个滚动 epsilon 上限（避免连续多次都被探索打扰）
 *   - 暴露 sampleId（用于 actionOutcomeMatrix 关联）
 */

const DEFAULT_EPSILON = 0.05;
const PER_USER_EXPLORE_CAP_PER_HOUR = 6;

/** 用户级探索计数（内存即可，重启时清零；过激进会自然衰减）。 */
const _userExploreCounts = new Map();

function _bumpUserExploreCount(userId) {
    if (!userId) return 0;
    const now = Date.now();
    const list = (_userExploreCounts.get(userId) || []).filter((t) => now - t < 3600 * 1000);
    list.push(now);
    _userExploreCounts.set(userId, list);
    return list.length;
}

function _getUserExploreCount(userId) {
    if (!userId) return 0;
    const now = Date.now();
    const list = (_userExploreCounts.get(userId) || []).filter((t) => now - t < 3600 * 1000);
    _userExploreCounts.set(userId, list);
    return list.length;
}

/**
 * 创建一个 ε-greedy 探索器实例。
 *
 * @param {Object} cfg
 * @param {number} [cfg.epsilon=0.05]                探索概率
 * @param {() => number} [cfg.random=Math.random]    随机源（单测可注入 LCG）
 * @param {number} [cfg.userCapPerHour]              单用户每小时最多被探索的次数
 */
export function createEpsilonGreedyExplorer(cfg = {}) {
    const epsilon = Math.max(0, Math.min(0.5, Number(cfg.epsilon ?? DEFAULT_EPSILON)));
    const random = typeof cfg.random === 'function' ? cfg.random : Math.random;
    const userCap = Math.max(0, Number(cfg.userCapPerHour ?? PER_USER_EXPLORE_CAP_PER_HOUR));

    /**
     * @param {{ candidates: string[], optimal: string, userId?: string, sampleId?: string }} input
     * @returns {{ action: string, mode: 'explore'|'exploit', propensity: number, exploredFrom: string|null, sampleId: string|null, epsilon: number }}
     */
    function choose(input) {
        const candidates = Array.isArray(input.candidates) && input.candidates.length > 0
            ? input.candidates
            : [input.optimal].filter(Boolean);
        if (candidates.length === 0) {
            return { action: null, mode: 'exploit', propensity: 1, exploredFrom: null, sampleId: input.sampleId ?? null, epsilon };
        }
        const optimal = input.optimal && candidates.includes(input.optimal)
            ? input.optimal
            : candidates[0];

        const userOverCap = userCap > 0 && _getUserExploreCount(input.userId) >= userCap;
        const roll = random();
        const explore = !userOverCap && roll < epsilon;

        if (!explore) {
            /* exploit：propensity = 1 - ε + ε/|A|（被选中可能因为模型也可能因为随机刚好命中） */
            const propensity = (1 - epsilon) + (epsilon / candidates.length);
            return {
                action: optimal,
                mode: 'exploit',
                propensity: Math.max(1e-6, Math.min(1, propensity)),
                exploredFrom: null,
                sampleId: input.sampleId ?? null,
                epsilon,
            };
        }
        /* explore：从 candidates 均匀随机抽（包含 optimal） */
        const idx = Math.floor(random() * candidates.length) % candidates.length;
        const picked = candidates[idx];
        _bumpUserExploreCount(input.userId);
        const propensity = (epsilon / candidates.length) + (picked === optimal ? (1 - epsilon) : 0);
        return {
            action: picked,
            mode: 'explore',
            propensity: Math.max(1e-6, Math.min(1, propensity)),
            exploredFrom: optimal,
            sampleId: input.sampleId ?? null,
            epsilon,
        };
    }

    function getEpsilon() { return epsilon; }

    return { choose, getEpsilon };
}

/**
 * 便捷函数：包装一个 deterministic policy。
 *
 * 用法：
 *   const wrapped = wrapWithExplorer((snapshot) => ({ action: 'iap', candidates: [...] }), { epsilon: 0.05 });
 *   const decision = wrapped(snapshot, { userId });
 */
export function wrapWithExplorer(deterministicPolicy, cfg = {}) {
    const explorer = createEpsilonGreedyExplorer(cfg);
    return function explorerWrapped(snapshot, ctx = {}) {
        let inner;
        try {
            inner = deterministicPolicy(snapshot, ctx) || {};
        } catch {
            inner = {};
        }
        const candidates = inner.candidates || [];
        const optimal = inner.action;
        const decision = explorer.choose({
            candidates,
            optimal,
            userId: ctx.userId,
            sampleId: ctx.sampleId,
        });
        return { ...inner, ...decision };
    };
}

/** 仅供测试 reset。 */
export function _resetExplorerForTests() {
    _userExploreCounts.clear();
}

export const _EXPLORER_INTERNALS = { DEFAULT_EPSILON, PER_USER_EXPLORE_CAP_PER_HOUR };
