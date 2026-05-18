/**
 * derivation/displayContracts.js — v1.58 显示契约 DSL
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计动机
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * v1.57.5 治理后，stressMeter 的 RELIEF_NARRATIVE_BY_REASON / classifyReliefReason
 * 让 relief 文案按 reason 分级，避免"盘面通透"在 fill=0.69 时撒谎。但这种
 * **守卫散落在 if-else** 的实现方式有 3 个隐性代价：
 *
 * 1. **守卫漏写**：B 类 bug 的修复在 `classifyReliefReason` 里加了 `fill < 0.5`
 *    守卫，但 endgame 守卫缺失（endSessionDistress 主导时不看 fill）；新加
 *    文案变体时容易再次漏写。
 *
 * 2. **降级链不显式**：守卫不通过时 fallback 到什么？现在是返回 'default'
 *    再查 RELIEF_NARRATIVE_BY_REASON 表——逻辑分散，缺少自动校验。
 *
 * 3. **不可静态分析**：lint / typecheck 无法发现"某个文案预设了 fill<0.5
 *    但调用方没传 fill"，必须靠运行时 bug + 截图反馈才能修。
 *
 * v1.58 引入**契约 DSL**：每段文案 / emoji / chip 都用结构化字段声明
 * "我需要什么 / 我的守卫是什么 / 我的降级目标是谁"，运行时统一校验 +
 * 自动降级，编译期可由 lint 规则做静态检查。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 契约结构
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   contract = {
 *       id: 'relief.friendly',           // 全局唯一
 *       requires: {                       // 必须满足的前置条件
 *           intent: 'relief',
 *           breakdown: { friendlyBoardRelief: { lt: -0.05 } },
 *           geometry:  { boardFill: { lt: 0.5 } },
 *       },
 *       output: '盘面有可消行机会，悄悄给你减压享受多消。',
 *       fallback: 'relief.default',       // 不满足时跳转
 *       _meta: { priority: 50, since: 'v1.57.5', reason: 'friendly 守卫 fill<0.5' },
 *   }
 *
 * 谓词 DSL 支持：
 *   - { lt: x }, { lte: x }, { gt: x }, { gte: x }, { eq: x }, { neq: x }
 *   - { in: [a, b, c] }, { not: pred }
 *   - 嵌套对象（递归校验）
 *   - 字面量（=== 比较）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 与 stressMeter.js 的关系
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * v1.58 之后，stressMeter.js 的 SPAWN_INTENT_NARRATIVE / RELIEF_NARRATIVE_BY_REASON
 * / FLOW_NARRATIVE_BY_PHASE / HARVEST_NARRATIVE_BY_DENSITY 这些散表保持作为
 * **常量字符串库**（兼容 + i18n 索引），运行期选择逻辑全部走 displayContracts：
 *
 *   - 旧：buildStoryLine 内部 if-else + classifyReliefReason
 *   - 新：buildStoryLine 调 selectNarrative('relief', ctx) → contract DSL 自动匹配
 *
 * 渐进迁移：本次先把 contract DSL 与 selectNarrative 工具落地 + 完整单测；
 * stressMeter.buildStoryLine 通过 reducer 桥接，老 if-else 保留为兼容路径
 * （后续 v1.58.x 可逐步迁移）。
 *
 * @file
 */

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  谓词 DSL                                                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 计算单个谓词是否对实际值成立。
 *
 * 支持谓词形态：
 *   - 字面量 v        → strictEquals(actual, v)
 *   - { lt: x }       → actual < x
 *   - { lte: x }      → actual <= x
 *   - { gt: x }       → actual > x
 *   - { gte: x }      → actual >= x
 *   - { eq: x }       → actual === x
 *   - { neq: x }      → actual !== x
 *   - { in: [...] }   → arr.includes(actual)
 *   - { not: pred }   → !evalPredicate(actual, pred)
 *   - 嵌套对象        → 递归校验每个 key
 *
 * @param {*} actual
 * @param {*} predicate
 * @returns {boolean}
 */
/** 操作符 keys（用于区分"复合操作符谓词" vs "嵌套对象谓词"） */
const PREDICATE_OPS = ['lt', 'lte', 'gt', 'gte', 'eq', 'neq', 'in', 'not'];

export function evalPredicate(actual, predicate) {
    /* null/undefined 谓词视作"无要求" */
    if (predicate === null || predicate === undefined) return true;

    /* 字面量谓词：基本类型 + 字符串严格相等 */
    if (typeof predicate !== 'object' || Array.isArray(predicate)) {
        return actual === predicate;
    }

    /* 复合操作符谓词：所有出现的操作符必须 AND 通过。
     * 关键修复：旧实现只用 if/return 链——`{ gte: 0.125, lt: 0.333 }` 会在
     * 第一个 'lt' 分支提前返回，忽略 'gte'，造成区间守卫失效（v1.58 自测发现）。 */
    let hasOp = false;
    for (const op of PREDICATE_OPS) {
        if (!(op in predicate)) continue;
        hasOp = true;
        switch (op) {
            case 'lt':  if (!(Number.isFinite(actual) && actual <  predicate.lt))  return false; break;
            case 'lte': if (!(Number.isFinite(actual) && actual <= predicate.lte)) return false; break;
            case 'gt':  if (!(Number.isFinite(actual) && actual >  predicate.gt))  return false; break;
            case 'gte': if (!(Number.isFinite(actual) && actual >= predicate.gte)) return false; break;
            case 'eq':  if (actual !== predicate.eq) return false; break;
            case 'neq': if (actual === predicate.neq) return false; break;
            case 'in':  if (!Array.isArray(predicate.in) || !predicate.in.includes(actual)) return false; break;
            case 'not': if (evalPredicate(actual, predicate.not)) return false; break;
            default: break;
        }
    }
    if (hasOp) return true;

    /* 嵌套对象：递归 */
    for (const key of Object.keys(predicate)) {
        if (!evalPredicate(actual?.[key], predicate[key])) return false;
    }
    return true;
}

/**
 * 校验一个 requires 对象在给定 ctx 下是否完全满足。
 *
 * ctx 顶层结构（与 selectReducerInputs 同源）：
 *   { intent, stress, geometry, breakdown, hints, intentInputs, distress, ... }
 *
 * @param {object} requires
 * @param {object} ctx
 * @returns {{ok: boolean, failures: Array<{path: string, expected: *, actual: *}>}}
 */
export function evalRequires(requires, ctx) {
    const failures = [];
    if (!requires || typeof requires !== 'object') return { ok: true, failures };

    function walk(reqNode, ctxNode, pathPrefix) {
        if (reqNode === null || reqNode === undefined) return;
        /* 叶子节点判定（与 evalPredicate 同源）：
         * - 字面量类型（非 object 或 array）
         * - 含任一操作符 key（可复合，如 { gte: 0.125, lt: 0.333 }） */
        const isLeaf = typeof reqNode !== 'object' || Array.isArray(reqNode)
            || PREDICATE_OPS.some((op) => op in reqNode);
        if (isLeaf) {
            const ok = evalPredicate(ctxNode, reqNode);
            if (!ok) failures.push({ path: pathPrefix || '<root>', expected: reqNode, actual: ctxNode });
            return;
        }
        /* 嵌套对象 */
        for (const key of Object.keys(reqNode)) {
            walk(reqNode[key], ctxNode?.[key], pathPrefix ? `${pathPrefix}.${key}` : key);
        }
    }

    walk(requires, ctx, '');
    return { ok: failures.length === 0, failures };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  叙事文案契约：spawnIntent → 分级文案                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 叙事契约清单。runtime selectNarrative 按 contract 顺序逐条匹配，
 * 首个 requires 全通过的 contract 胜出。
 *
 * 与 web/src/stressMeter.js 的关系：
 *   - text 内容与 SPAWN_INTENT_NARRATIVE / RELIEF_NARRATIVE_BY_REASON /
 *     FLOW_NARRATIVE_BY_PHASE / HARVEST_NARRATIVE_BY_DENSITY 完全同源；
 *     由 tests/derivationContracts.test.js 的"同源锁定"断言强制 sync。
 *   - v1.58 之后，stressMeter.buildStoryLine 通过本契约表选择文案。
 *
 * @type {Array<{id: string, requires: object, output: string, fallback?: string, _meta?: object}>}
 */
export const NARRATIVE_CONTRACTS = [
    /* ── boardRisk 极高时的"保活"抢占（最高优先级，跨 intent 抢占） ── */
    {
        id: 'boardRisk.critical',
        requires: { breakdown: { boardRisk: { gte: 0.6 } } },
        output: '盘面很紧张，系统正在为你保活，候选块更易消行。',
        _meta: { priority: 200, since: 'v1.13', reason: '极端保活信号最高优先' },
    },

    /* ── relief 七档分级（v1.57.5 §B；v1.58.2 endgame 拆 critical/soft） ── */
    {
        id: 'relief.endgame',
        requires: {
            intent: 'relief',
            breakdown: { endSessionDistress: { lt: -0.05 } },
            geometry: { boardFill: { gte: 0.45 } },
        },
        output: '本局接近收尾，正投放更稳的组合让你顺利收官。',
        fallback: 'relief.endgame.soft',
        _meta: {
            priority: 95,
            since: 'v1.57.5',
            updatedIn: 'v1.58.2',
            reason: 'v1.58.2 加 boardFill>=0.45 几何守卫；fall through 到 endgame.soft 而非 default',
        },
    },
    {
        id: 'relief.endgame.soft',
        requires: {
            intent: 'relief',
            breakdown: { endSessionDistress: { lt: -0.05 } },
        },
        output: '临近收尾，系统已悄悄为你切到更稳节奏——盘面仍从容，继续稳住即可。',
        fallback: 'relief.default',
        _meta: { priority: 78, since: 'v1.58.2', reason: 'endSessionDistress 触发但盘面通透时的诚实降级' },
    },
    {
        id: 'relief.friendly',
        requires: {
            intent: 'relief',
            breakdown: { friendlyBoardRelief: { lt: -0.05 } },
            geometry: { boardFill: { lt: 0.5 }, harvestReady: true },
        },
        output: '盘面有可消行机会，悄悄给你减压享受多消。',
        fallback: 'relief.default',
        _meta: {
            priority: 90,
            since: 'v1.57.5',
            reason: 'v1.57.5 加 fill<0.5 守卫；v1.58.1 再加 harvestReady 守卫，与 I12 跨 contract 不变式对齐',
        },
    },
    {
        id: 'relief.hole',
        requires: {
            intent: 'relief',
            breakdown: { holeReliefAdjust: { lt: -0.05 } },
            geometry: { holes: { gte: 1 } },
        },
        output: '盘面空洞偏多，正在投放更友好的组合帮你慢慢回正。',
        fallback: 'relief.default',
        _meta: {
            priority: 80, since: 'v1.57.5', updatedIn: 'v1.58.4',
            reason: 'v1.58.4 自查 E1：加 holes>=1 几何守卫，避免 "空洞偏多" 在 holes=0 时撒谎',
        },
    },
    {
        id: 'relief.boardRisk',
        requires: {
            intent: 'relief',
            breakdown: { boardRiskReliefAdjust: { lt: -0.05 } },
            geometry: { boardFill: { gte: 0.45 } },
        },
        output: '盘面压力较高，正在投放更易消行的组合。',
        fallback: 'relief.default',
        _meta: {
            priority: 75, since: 'v1.57.5', updatedIn: 'v1.58.4',
            reason: 'v1.58.4 自查 E2：加 boardFill>=0.45 几何守卫，避免 "盘面压力较高" 在通透盘面撒谎',
        },
    },
    {
        id: 'relief.bottleneck',
        requires: { intent: 'relief', breakdown: { bottleneckRelief: { lt: -0.05 } } },
        output: '注意到你刚刚停顿较多，给你一个更可解的组合。',
        fallback: 'relief.default',
        _meta: { priority: 70, since: 'v1.57.5' },
    },
    {
        id: 'relief.frustration',
        requires: {
            intent: 'relief',
            /* frustration 组合判定：3 个分量之和需达到阈值。
             * 用自定义函数式守卫（这是 DSL 的能力上限——更复杂的合取由 reducer 预派生）。 */
            breakdown: {
                /* 简化策略：任一分量 < -0.05 即视为 frustration 类救济触发。
                 * 与 stressMeter.classifyReliefReason 中 "三者求和" 等价的合取由 reducer 预算 */
            },
        },
        /* 这里没有强守卫，由优先级排序保证只在前面四档 fallback 后才命中。 */
        output: '注意到你刚刚不太顺，正在投放更友好的形状。',
        fallback: 'relief.default',
        _meta: { priority: 60, since: 'v1.57.5', reason: 'frustration/recovery/nearMiss 链路' },
    },
    {
        id: 'relief.default',
        requires: { intent: 'relief' },
        output: '正在投放更友好的组合，悄悄给你减压。',
        _meta: { priority: 50, since: 'v1.57.5', reason: '兜底中性文案，无"盘面通透"假设' },
    },

    /* ── flow 三档（v1.24/v1.27；v1.58.4 高压档加几何守卫 + 软降级） ── */
    {
        id: 'flow.intense',
        requires: {
            intent: 'flow',
            stress: { gte: 0.833 },
            geometry: { boardFill: { gte: 0.45 } },
        },
        output: '进入高压区，系统会优先保活，先确保可落位与基础消行。',
        fallback: 'flow.intense.soft',
        _meta: {
            priority: 88, since: 'v1.27', updatedIn: 'v1.58.4',
            reason: 'v1.58.4 自查 E4：加 boardFill>=0.45 几何守卫，避免 "高压区" 在通透盘面撒谎',
        },
    },
    {
        id: 'flow.intense.soft',
        requires: { intent: 'flow', stress: { gte: 0.833 } },
        output: '算法侧压力指标偏高（来自多维信号叠加），但盘面尚通透——先稳住关键落点。',
        _meta: { priority: 86, since: 'v1.58.4', reason: 'stress 高但盘面通透时的诚实降级' },
    },
    {
        id: 'flow.tense',
        requires: {
            intent: 'flow',
            stress: { gte: 0.708, lt: 0.833 },
            geometry: { boardFill: { gte: 0.40 } },
        },
        output: '压力正在抬升，优先保留可消行通道，避免高列继续堆积。',
        fallback: 'flow.tense.soft',
        _meta: {
            priority: 87, since: 'v1.27', updatedIn: 'v1.58.4',
            reason: 'v1.58.4 自查 E5：加 boardFill>=0.40 几何守卫',
        },
    },
    {
        id: 'flow.tense.soft',
        requires: { intent: 'flow', stress: { gte: 0.708, lt: 0.833 } },
        output: '算法侧压力指标在抬升，盘面暂还从容——可以小心扩展消行窗口。',
        _meta: { priority: 85, since: 'v1.58.4', reason: 'stress tense 但盘面通透时的诚实降级' },
    },
    {
        id: 'flow.engaged',
        requires: { intent: 'flow', stress: { gte: 0.542, lt: 0.708 } },
        output: '需要更多专注，先稳住关键落点，再逐步扩大消行窗口。',
        _meta: { priority: 86, since: 'v1.27' },
    },
    /* v1.58.1：flow.payoff 拆 ready / waiting 两档。
     * 截图 bug 复盘（v1.58.1 §A）：rhythmPhase='payoff' 只代表算法层进入收获节奏，
     * 但当前 dock + 盘面是否真有可兑现路径是另一回事——节奏锁定 ≠ 现在能消。
     * 旧 flow.payoff contract 没有几何守卫，让"享受多消快感"在 nearFullLines=0 +
     * mcc=0 + pcSetup=0 的稀疏盘面也照说不误。修复：拆两档，ready 必须 harvestReady。 */
    {
        id: 'flow.payoff.ready',
        requires: {
            intent: 'flow',
            hints: { rhythmPhase: 'payoff' },
            geometry: { harvestReady: true },
        },
        output: '心流稳定，节奏进入收获期，准备享受多消快感。',
        _meta: { priority: 62, since: 'v1.58.1', reason: '兑现窗口已就位，承诺可兑现' },
    },
    {
        id: 'flow.payoff.waiting',
        requires: { intent: 'flow', hints: { rhythmPhase: 'payoff' } },
        /* v1.58.4 自查：原文案含"收获期"字样，与 I12（任何含"收获期"必 harvestReady>=1）冲突。
         * 改写：去掉"收获期"，明确说"还在等"——既反映 rhythmPhase=payoff 的事实，
         * 又避免与几何承诺类文案的措辞耦合。 */
        output: '心流稳定，节奏已切到等待消行窗口的状态——dock 在留通道，先稳住手。',
        _meta: {
            priority: 60, since: 'v1.58.1', updatedIn: 'v1.58.4',
            reason: 'v1.58.4 自查：去掉"收获期"字样，避免与 I12 跨 contract 不变式冲突',
        },
    },
    {
        id: 'flow.setup',
        requires: { intent: 'flow', hints: { rhythmPhase: 'setup' } },
        output: '心流稳定，节奏稳步搭建，先留好通道等下一波兑现。',
        _meta: { priority: 59, since: 'v1.24' },
    },
    {
        id: 'flow.neutral',
        requires: { intent: 'flow', hints: { rhythmPhase: 'neutral' } },
        output: '心流稳定，节奏自然流畅，系统继续维持当前出块。',
        _meta: { priority: 58, since: 'v1.24' },
    },
    {
        id: 'flow.default',
        requires: { intent: 'flow' },
        output: '心流稳定，系统继续维持流畅的出块节奏。',
        _meta: { priority: 50, since: 'v1.24' },
    },

    /* ── harvest 三档密度分级（v1.31） ── */
    {
        id: 'harvest.intense',
        requires: { intent: 'harvest', stress: { gte: 0.833 } },
        output: '高压下仍有消行机会，系统优先促清形状，先稳住落点再逐步解压。',
        _meta: { priority: 88, since: 'v1.29' },
    },
    {
        id: 'harvest.tense',
        requires: { intent: 'harvest', stress: { gte: 0.708, lt: 0.833 } },
        output: '盘面吃紧，但已识别可消行窗口，正投放促清组合帮你逐步降压。',
        _meta: { priority: 87, since: 'v1.29' },
    },
    {
        id: 'harvest.engaged',
        requires: { intent: 'harvest', stress: { gte: 0.542, lt: 0.708 } },
        output: '局面需要专注，已识别可消行窗口，正投放更易兑现的组合。',
        _meta: { priority: 86, since: 'v1.29' },
    },
    {
        id: 'harvest.dense',
        requires: {
            intent: 'harvest',
            geometry: { nearFullLines: { gte: 3 } },
        },
        output: '识别到密集消行机会，正在投放促清的形状。',
        _meta: { priority: 65, since: 'v1.31', reason: 'nearFullLines≥3 = 密集' },
    },
    {
        id: 'harvest.visible',
        requires: {
            intent: 'harvest',
            geometry: { nearFullLines: { gte: 2 } },
        },
        output: '已识别清晰的消行通道，正在投放更易兑现的组合。',
        _meta: { priority: 60, since: 'v1.31' },
    },
    {
        id: 'harvest.edge',
        requires: {
            intent: 'harvest',
            geometry: { nearFullLines: { gte: 1 } },
        },
        output: '出现首个消行窗口，先把握这一手试试看。',
        _meta: { priority: 55, since: 'v1.31' },
    },
    {
        id: 'harvest.default',
        requires: { intent: 'harvest' },
        /* v1.58.4 自查 E3：改写文案——不再撒谎"已识别密集机会"，而是说"系统已切到 harvest 节奏"。
         * 因为 default 是兜底分支（前三档 nearFullLines>=N 都没通过），不能再假装已识别"密集"。 */
        output: '系统已切到 harvest 节奏，正在寻找下一个消行窗口。',
        _meta: {
            priority: 50, since: 'v1.16', updatedIn: 'v1.58.4',
            reason: 'v1.58.4 自查 E3：原文案 "识别到密集消行机会" 在 nearFullLines=0 兜底分支下撒谎',
        },
    },

    /* ── 其它 intent 默认文案 ── */
    {
        id: 'engage.default',
        requires: { intent: 'engage' },
        output: '注意到你停顿了一下，给你一个明显得分目标 + 友好开局。',
        _meta: { priority: 50, since: 'v1.16' },
    },
    {
        id: 'pressure.default',
        requires: { intent: 'pressure' },
        output: '正在挑战自我！系统略加压让收尾更有仪式感。',
        _meta: { priority: 50, since: 'v1.16' },
    },
    {
        id: 'sprint.default',
        requires: { intent: 'sprint' },
        output: '节奏渐紧，逐步收束。',
        _meta: { priority: 50, since: 'v1.57.1' },
    },
    {
        id: 'maintain.default',
        requires: { intent: 'maintain' },
        output: '看起来比较轻松，悄悄加点料维持新鲜感。',
        _meta: { priority: 50, since: 'v1.16' },
    },
];

/**
 * 按契约表挑选叙事文案。
 *
 * 算法：
 *   1. 按 _meta.priority 降序遍历（同优先级按声明顺序）
 *   2. 首个 requires 全通过的 contract 胜出 → 返回 contract.output
 *   3. 若胜出 contract 有 fallback 但 requires 不通过，会跳到 fallback 重试（防御性）
 *   4. 全部不通过 → 返回 null（调用方决定显示 '—' 或硬编码兜底）
 *
 * 返回的 trace 字段供诊断面板可视化"为什么是这段文案"。
 *
 * @param {object} ctx selectReducerInputs 返回的完整上下文
 * @param {Array} [contracts=NARRATIVE_CONTRACTS] 可注入自定义契约表
 * @returns {{contract: object|null, text: string|null, trace: Array<{id: string, ok: boolean, failures: Array}>}}
 */
export function selectNarrative(ctx, contracts = NARRATIVE_CONTRACTS) {
    /* 按优先级降序排序的稳定快照（每次调用都重新排，便于热更新） */
    const sorted = [...contracts].sort((a, b) => {
        const ap = a._meta?.priority ?? 0;
        const bp = b._meta?.priority ?? 0;
        return bp - ap;
    });
    const trace = [];
    for (const c of sorted) {
        const { ok, failures } = evalRequires(c.requires, ctx);
        trace.push({ id: c.id, ok, failures });
        if (ok) {
            return { contract: c, text: c.output, trace };
        }
    }
    return { contract: null, text: null, trace };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Emoji 契约：stress + intent + geometry → face/label/vibe                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Emoji 契约。优先级越高越先匹配。
 * 与 web/src/stressMeter.js STRESS_LEVELS / getStressDisplay 完全同源。
 *
 * @type {Array<{id: string, requires: object, output: object, _meta?: object}>}
 */
export const EMOJI_CONTRACTS = [
    /* ── struggling（最高优先级，挣扎中变体）──
     * v1.58.2 截图复盘：原守卫只看算法侧信号（sessionPhase / momentum / frustration），
     * 没有任何"盘面真的接近死局"的几何确证。结果：盘面 fill=0.31 / 解法=63 时仍显示
     * 😣 "挣扎中"，玩家视觉看到的是通透盘面——形成 v1.57.5 §G 同款视觉反差。
     *
     * v1.58.2 修复：加 distress.boardFill>=0.45 守卫——盘面真有压力时才显示挣扎；
     * 不通过时自然 fall through 到下面新增的 concerned.softRescue.* 中间档，
     * 既不撒谎"挣扎"，又不丢失"动量下行/挫败累积"的算法侧信号反映。 */
    {
        id: 'struggling.lateCollapse',
        requires: {
            stress: { lt: 0.333 },
            distress: { sessionPhase: 'late', momentum: { lte: -0.30 }, boardFill: { gte: 0.45 } },
        },
        output: { id: 'struggling', face: '😣', label: '挣扎中（救济中）',
            vibe: '动量持续下行 + 盘面也吃紧，系统已强制 relief 出块抢救节奏。' },
        _meta: { priority: 100, since: 'v1.51', updatedIn: 'v1.58.2', reason: '加 boardFill>=0.45 几何守卫' },
    },
    {
        id: 'struggling.frustCritical',
        requires: {
            stress: { lt: 0.333 },
            distress: { frustrationLevel: { gte: 5 }, boardFill: { gte: 0.45 } },
        },
        output: { id: 'struggling', face: '😣', label: '挣扎中（救济中）',
            vibe: '挫败累积偏高 + 盘面也吃紧，系统已切 relief 节奏，候选块更小、更易消。' },
        _meta: { priority: 95, since: 'v1.51', updatedIn: 'v1.58.2', reason: '加 boardFill>=0.45 几何守卫' },
    },

    /* ── concerned（v1.58.2 新增中间档）──
     * 当算法侧信号（lateCollapse 或 frustCritical 条件）触发了 forceReliefIntent，
     * 但盘面仍很通透（boardFill<0.45）时，既不能假装 "挣扎中"（与盘面矛盾），
     * 也不能直接显示 calm 笑脸（与算法 relief 矛盾）——用 "稍专注（系统已减压）"
     * 中间档 emoji 诚实承认"算法在减压，但你盘面尚可，先稳住"。
     *
     * 优先级 78/77（介于 crowded=80 与 relief calm 变体=70 之间）。 */
    {
        id: 'concerned.softRescue.late',
        requires: {
            stress: { lt: 0.333 },
            distress: { sessionPhase: 'late', momentum: { lte: -0.30 } },
        },
        output: { id: 'concerned', face: '😟', label: '稍专注（系统已减压）',
            vibe: '动量稍弱 + 临近末段，节奏已为你切到 relief——盘面尚通透，先稳住当前消行机会慢慢回正。' },
        _meta: { priority: 78, since: 'v1.58.2', reason: 'lateCollapse 信号但 boardFill<0.45 的中间档' },
    },
    {
        id: 'concerned.softRescue.frust',
        requires: {
            stress: { lt: 0.333 },
            distress: { frustrationLevel: { gte: 5 } },
        },
        output: { id: 'concerned', face: '😟', label: '稍专注（系统已减压）',
            vibe: '挫败累积偏高 + 盘面尚通透，节奏已为你切到 relief——候选块会更友好，慢慢回正即可。' },
        _meta: { priority: 77, since: 'v1.58.2', reason: 'frustCritical 信号但 boardFill<0.45 的中间档' },
    },

    /* ── crowded 紧盘面守卫（v1.57.5 §G）── */
    {
        id: 'easy.crowded',
        requires: {
            stress: { gte: 0.125, lt: 0.333 },
            distress: { boardFill: { gte: 0.65 } },
        },
        output: { id: 'easy-crowded', face: '😅', label: '舒缓（盘面吃紧）',
            vibe: '系统已在帮你减压，但盘面较密——先把消行通道留好，避免列继续堆高。' },
        _meta: { priority: 80, since: 'v1.57.5' },
    },
    {
        id: 'calm.crowded',
        requires: {
            stress: { lt: 0.125 },
            distress: { boardFill: { gte: 0.65 } },
        },
        output: { id: 'calm-crowded', face: '😅', label: '放松（盘面吃紧）',
            vibe: '系统已在帮你减压，但盘面较密——先把消行通道留好，避免列继续堆高。' },
        _meta: { priority: 80, since: 'v1.57.5' },
    },

    /* ── relief 救济中变体（v1.18）── */
    {
        id: 'calm.relief',
        requires: {
            stress: { lte: 0.125 },
            intent: 'relief',
        },
        output: { id: 'calm', face: '🤗', label: '放松（救济中）',
            vibe: '系统正在为你减压：候选块更小、更友好，找一条最容易消的行先恢复节奏。' },
        _meta: { priority: 70, since: 'v1.18' },
    },

    /* ── 6 档基础映射（与 STRESS_LEVELS 同源）── */
    {
        id: 'intense',
        requires: { stress: { gte: 0.833 } },
        output: { id: 'intense', face: '🥵', label: '高压', vibe: '高强度对局，系统会优先保活。' },
        _meta: { priority: 10, since: 'v1.0' },
    },
    {
        id: 'tense',
        requires: { stress: { gte: 0.708, lt: 0.833 } },
        output: { id: 'tense', face: '😰', label: '紧张', vibe: '盘面吃紧，留意可消行机会。' },
        _meta: { priority: 10, since: 'v1.0' },
    },
    {
        id: 'engaged',
        requires: { stress: { gte: 0.542, lt: 0.708 } },
        output: { id: 'engaged', face: '🤔', label: '投入', vibe: '需要思考，节奏开始拉紧。' },
        _meta: { priority: 10, since: 'v1.0' },
    },
    {
        id: 'flow',
        requires: { stress: { gte: 0.333, lt: 0.542 } },
        output: { id: 'flow', face: '😀', label: '心流', vibe: '挑战与能力匹配，正爽快。' },
        _meta: { priority: 10, since: 'v1.0' },
    },
    {
        id: 'easy',
        requires: { stress: { gte: 0.125, lt: 0.333 } },
        output: { id: 'easy', face: '🙂', label: '舒缓', vibe: '操作轻松，节奏从容。' },
        _meta: { priority: 10, since: 'v1.0' },
    },
    {
        id: 'calm',
        requires: { stress: { lt: 0.125 } },
        output: { id: 'calm', face: '😌', label: '放松', vibe: '盘面整洁，心情舒缓。' },
        _meta: { priority: 10, since: 'v1.0' },
    },
];

/**
 * 按契约表挑选 emoji 显示。
 *
 * @param {object} ctx selectReducerInputs 返回的完整上下文
 * @returns {{contract: object|null, output: object|null, trace: Array}}
 */
export function selectEmoji(ctx, contracts = EMOJI_CONTRACTS) {
    const sorted = [...contracts].sort((a, b) => (b._meta?.priority ?? 0) - (a._meta?.priority ?? 0));
    const trace = [];
    for (const c of sorted) {
        const { ok, failures } = evalRequires(c.requires, ctx);
        trace.push({ id: c.id, ok, failures });
        if (ok) return { contract: c, output: c.output, trace };
    }
    return { contract: null, output: null, trace };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  内部不变式校验：用于 Phase 1 lint-style check                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 校验单张契约表的全局不变式：
 *   1. id 全局唯一
 *   2. fallback 必须指向已存在的 id
 *   3. 至少一条 requires 为 {} 的"默认兜底"覆盖每个枚举值（warning）
 *
 * 主要被 tests/derivationContracts.test.js 调用。
 *
 * @param {Array} contracts
 * @returns {{ok: boolean, errors: Array<string>, warnings: Array<string>}}
 */
export function validateContractTable(contracts) {
    const errors = [];
    const warnings = [];
    const ids = new Set();
    for (const c of contracts) {
        if (!c.id) { errors.push('contract without id'); continue; }
        if (ids.has(c.id)) errors.push(`duplicate id: ${c.id}`);
        ids.add(c.id);
    }
    for (const c of contracts) {
        if (c.fallback && !ids.has(c.fallback)) {
            errors.push(`contract ${c.id} fallback to missing id: ${c.fallback}`);
        }
    }
    return { ok: errors.length === 0, errors, warnings };
}
