/**
 * derivation/intentResolver.js — v1.58 优先级矩阵 + 决策 Trace
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计动机
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * v1.57.4 的 `deriveSpawnIntent` 是一连串 `if-else`：
 *
 *     if (playerDistress < -0.10) return 'relief';
 *     if (afkEngageActive) return 'engage';
 *     if (harvestable) return 'harvest';
 *     ...
 *
 * 这种实现有 3 个**隐性代价**：
 *
 * 1. **优先级隐式**：调用方（DFV chip / stressMeter）想知道"AFK 信号被 relief
 *    覆盖了"必须自己重新写 `(intent === 'relief') && afkEngage`，规则散落。
 *    v1.57.5 §D 的修复就是手写了这一条副本。
 *
 * 2. **决策不可追溯**：返回 'relief' 但不知道"为什么是 relief"——是 distress
 *    主导？还是 forceReliefIntent？还是 delightMode='relief'？日志/诊断面板
 *    必须自己反推。
 *
 * 3. **新增规则成本高**：加一个 'sprint' 中间档要在 deriveSpawnIntent / DFV
 *    chip / stressMeter narrative / spawnHints 4 处同步改动。
 *
 * v1.58 把规则抽成**显式表 + 表驱动 resolver**：
 *
 *     INTENT_RULES = [
 *         { id: 'relief',  priority: 100, guard: (s) => ..., reason: (s) => '...' },
 *         { id: 'engage',  priority:  90, guard: (s) => ..., reason: (s) => '...' },
 *         ...
 *     ]
 *
 * `resolveIntent(inputs)` 返回：
 *
 *     {
 *         intent: 'relief',
 *         trace: [
 *             { id: 'relief',  priority: 100, passed: true,  reason: 'distress=-0.18<-0.10' },
 *             { id: 'engage',  priority:  90, passed: true,  reason: 'afkEngageActive=true' },
 *             { id: 'harvest', priority:  80, passed: false, reason: null },
 *             ...
 *         ],
 *         overrides: Set('engage'),  // 通过 guard 但优先级更低、被本次 winner 覆盖
 *     }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 与 adaptiveSpawn.deriveSpawnIntent 的关系
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * - **行为完全等价**（输入相同 → 输出 intent 完全一致），由 contract test 强制锁定
 * - adaptiveSpawn.deriveSpawnIntent 保留作算法层入口（不破坏 1707 既有测试 + miniprogram 镜像）
 * - 派生层 / UI 层全部改用 resolveIntent，享受 trace + overrides 元信息
 * - v1.58 之后可考虑让 deriveSpawnIntent 内部调 resolveIntent + 丢弃 trace，
 *   彻底单源化（本次保留双路，避免一次性改动太大）
 *
 * @file
 */

/* PC_SETUP_MIN_FILL 与 adaptiveSpawn.js 完全同源——本文件复刻常量值而不 import，
 * 是为了让 derivation/ 层成为"无外部算法依赖"的纯派生层。值变更时由
 * tests/derivationContracts.test.js 的 "与 adaptiveSpawn 同源" 断言强制锁定。 */
export const PC_SETUP_MIN_FILL = 0.45;
export const SPRINT_MIN_DEFAULT = 0.45;
export const SPRINT_MAX_DEFAULT = 0.55;

/**
 * Intent 优先级规则表。
 *
 * **不变式**（由 contract test 锁定）：
 *   - 数字越大 = 优先级越高
 *   - guard 都通过时，最高 priority 胜出；通过但 priority 更低者进 overrides
 *   - 'maintain' 必须是 fallback（priority=0 + guard 恒真）
 *   - 与 adaptiveSpawn.deriveSpawnIntent 行为完全等价
 *
 * 每条规则的字段：
 *   - id:        intent id（与 SPAWN_INTENT_NARRATIVE / SPAWN_INTENT_COLOR 同源）
 *   - priority:  整数优先级（数值越大越优先）
 *   - guard:     (inputs) => boolean，决定是否激活
 *   - reason:    (inputs) => string，当激活时返回人类可读的"为什么"
 *
 * @type {Array<{id: string, priority: number, guard: Function, reason: Function}>}
 */
export const INTENT_RULES = [
    {
        /* v1.61 pb_chase_pressure（priority 102，高于 relief=100）：
         * 接近/超越 PB 且 B 类挑战条件满足时，出块意图强制转为 'pressure'，
         * 通过增加难度激发玩家斗志，避免临 PB 段用减压块导致分数快速膨胀。
         *
         * 安全门（同 adaptiveSpawn.js pbChasePressureActive 计算逻辑）：
         *   - !forceReliefIntent：临终救济（fill>0.82）/ 高挫败 / 复活救济不可被压制
         *   - 仅在 pbChasePressureActive=true 时激活（已含 fill<0.72、非 onboarding 等门）
         *
         * 与 'pressure' 规则（priority=70）的区别：
         *   - 'pressure' 由 challengeBoost>0 触发，但被 relief(100) 优先覆盖
         *   - 'pb_chase_pressure' 优先级高于 relief，主动打断普通救济路径
         *   - 两者 spawnIntent 均为 'pressure'，_tryInjectSpecial 路径一致（制造空洞）
         *
         * spawnIntent 显式声明为 'pressure'，与 intentResolver resolveIntent 返回机制
         * `winner.spawnIntent ?? winner.id` 一致。 */
        id: 'pb_chase_pressure',
        priority: 102,
        spawnIntent: 'pressure',
        guard: (s) => !!s.pbChasePressureActive,
        reason: (s) => {
            const boost = Number(s.challengeBoost ?? 0).toFixed(2);
            return `pbChasePressureActive=true（challengeBoost=${boost}，接近/超越 PB，加压激发斗志）`;
        },
    },
    {
        id: 'relief',
        priority: 100,
        guard: (s) => Number(s.playerDistress) < -0.10
            || s.delightMode === 'relief'
            || !!s.forceReliefIntent,
        reason: (s) => {
            if (s.forceReliefIntent) return 'forceReliefIntent=true（末段崩盘 / 高挫败）';
            if (s.delightMode === 'relief') return 'delightMode=relief';
            return `playerDistress=${Number(s.playerDistress).toFixed(2)} < -0.10`;
        },
    },
    {
        /* v1.60.45：爽感饥渴 → 强制 relief（rule id 是 'delight_starved'，
         * spawnIntent 映射为 'relief'，让下游 adaptiveSpawn / blockSpawn 按 relief 出块）。
         *
         * **设计动机**（docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.5）：
         *   adaptiveSpawn 输出爽感候选，但对玩家"是否真触爽"无闭环监控。本规则补齐：
         *   连续 N 轮（Android 5 / iOS 7）无 multiClear / pcClear / monoFlush 命中 →
         *   playerProfile.isDelightStarved() === true → 强制 relief 让位多消/小块。
         *
         * **与 'relief' 主规则关系**：
         *   - 'relief'         基于"挫败信号"（playerDistress / forceReliefIntent）
         *   - 'delight_starved' 基于"长期无爽感"的运营观测
         *   - 两者都映射到 spawnIntent='relief'，但 rule id 不同——trace 可区分归因
         *
         * priority=95 介于 relief(100) 与 engage(90) 之间：挫败信号优先于爽感饥渴；
         * 爽感饥渴优先于 AFK 召回（爽感缺失比"暂时没操作"更重要）。 */
        id: 'delight_starved',
        priority: 95,
        spawnIntent: 'relief',
        guard: (s) => !!s.delightStarved,
        reason: (s) => {
            const n = Number(s.roundsSinceLastDelight) || 0;
            return `delightStarved=true（连续 ${n} 轮无 multiClear/pcClear/monoFlush）`;
        },
    },
    {
        id: 'engage',
        priority: 90,
        guard: (s) => !!s.afkEngageActive,
        reason: () => 'afkEngageActive=true（玩家停顿 + 状态尚可）',
    },
    {
        id: 'harvest',
        priority: 80,
        guard: (s) => {
            const nfl = Number(s.geometry?.nearFullLines) || 0;
            const pc = Number(s.geometry?.pcSetup) || 0;
            const fill = Number(s.geometry?.boardFill) || 0;
            const pcMin = Number.isFinite(s.pcSetupMinFill) ? s.pcSetupMinFill : PC_SETUP_MIN_FILL;
            return nfl >= 2 || (pc >= 1 && fill >= pcMin);
        },
        reason: (s) => {
            const nfl = Number(s.geometry?.nearFullLines) || 0;
            const pc = Number(s.geometry?.pcSetup) || 0;
            const fill = Number(s.geometry?.boardFill) || 0;
            if (nfl >= 2) return `nearFullLines=${nfl} ≥ 2`;
            return `pcSetup=${pc} ≥ 1 且 fill=${fill.toFixed(2)} ≥ ${(s.pcSetupMinFill ?? PC_SETUP_MIN_FILL).toFixed(2)}`;
        },
    },
    {
        id: 'pressure',
        priority: 70,
        guard: (s) => Number(s.challengeBoost) > 0
            || (s.delightMode === 'challenge_payoff' && Number(s.stress) >= 0.55),
        reason: (s) => {
            const cb = Number(s.challengeBoost) || 0;
            if (cb > 0) return `challengeBoost=${cb.toFixed(2)} > 0`;
            return `delightMode=challenge_payoff 且 stress=${Number(s.stress).toFixed(2)} ≥ 0.55`;
        },
    },
    {
        id: 'sprint',
        priority: 60,
        guard: (s) => {
            const enabled = s.sprintCfg?.enabled !== false;
            if (!enabled) return false;
            const stress = Number(s.stress) || 0;
            const min = Number.isFinite(s.sprintCfg?.minStress) ? s.sprintCfg.minStress : SPRINT_MIN_DEFAULT;
            const max = Number.isFinite(s.sprintCfg?.maxStress) ? s.sprintCfg.maxStress : SPRINT_MAX_DEFAULT;
            return stress >= min && stress < max;
        },
        reason: (s) => {
            const min = s.sprintCfg?.minStress ?? SPRINT_MIN_DEFAULT;
            const max = s.sprintCfg?.maxStress ?? SPRINT_MAX_DEFAULT;
            return `stress=${Number(s.stress).toFixed(2)} ∈ [${min.toFixed(2)}, ${max.toFixed(2)}) 渐紧过渡带`;
        },
    },
    {
        id: 'flow',
        priority: 50,
        guard: (s) => s.delightMode === 'flow_payoff' || s.rhythmPhase === 'payoff',
        reason: (s) => s.delightMode === 'flow_payoff'
            ? 'delightMode=flow_payoff'
            : `rhythmPhase=${s.rhythmPhase}`,
    },
    {
        id: 'maintain',
        priority: 0,
        guard: () => true,
        reason: () => '默认中性（所有上层规则未触发）',
    },
];

/* Intent id 集合，供 chip 渲染等场景做 in-set 校验。 */
export const INTENT_IDS = Object.freeze(INTENT_RULES.map((r) => r.id));

/* Intent → priority 反查表。 */
export const INTENT_PRIORITY = Object.freeze(
    INTENT_RULES.reduce((acc, r) => { acc[r.id] = r.priority; return acc; }, {}),
);

/**
 * 表驱动 intent resolver，返回 winner + 完整 trace + overrides。
 *
 * @param {object} inputs 来自 _intentInputs 或 selectors.selectReducerInputs.intentInputs
 *   字段：playerDistress / forceReliefIntent / afkEngageActive / challengeBoost
 *   / delightMode / rhythmPhase / stress / sprintCfg / geometry / pcSetupMinFill
 * @returns {{intent: string, trace: Array, overrides: Set<string>}}
 */
export function resolveIntent(inputs = {}) {
    const trace = [];
    let winner = null;
    for (const rule of INTENT_RULES) {
        const passed = !!rule.guard(inputs);
        const reason = passed ? rule.reason(inputs) : null;
        trace.push({
            id: rule.id,
            priority: rule.priority,
            passed,
            reason,
            isWinner: false,
        });
        if (passed && !winner) winner = rule;
    }
    if (winner) {
        const winnerEntry = trace.find((t) => t.id === winner.id);
        if (winnerEntry) winnerEntry.isWinner = true;
    }

    /* 计算 overrides：guard 通过但优先级低于 winner 的所有规则。
     * 这是 DFV chip 显示"被覆盖"状态的唯一数据源——下游不再手写
     * `(intent === 'relief') && afkEngage`。 */
    const winnerPriority = winner?.priority ?? -Infinity;
    const overrides = new Set();
    for (const t of trace) {
        if (t.passed && t.priority < winnerPriority) overrides.add(t.id);
    }

    return {
        intent: winner ? winner.id : 'maintain',
        /* v1.60.45：spawnIntent 是下游 adaptiveSpawn / blockSpawn 真正消费的
         * 意图字段。多数规则 spawnIntent = rule.id（默认行为不变）；少数规则
         * （如 'delight_starved' → 'relief'）走映射后值，避免在下游每个消费方
         * 都重复写 `intent === 'delight_starved' || intent === 'relief'`。 */
        spawnIntent: winner ? (winner.spawnIntent ?? winner.id) : 'maintain',
        trace,
        overrides,
    };
}

/**
 * 把 trace 渲染为单行人类可读字符串，供日志 / Sentry 上报 / 诊断面板使用。
 *
 * 例：
 *   "relief(100, distress=-0.18<-0.10) ← overrides[engage(90)]"
 *
 * @param {{intent: string, trace: Array, overrides: Set}} resolved
 * @returns {string}
 */
export function formatIntentTrace(resolved) {
    if (!resolved) return '';
    const winner = resolved.trace.find((t) => t.isWinner);
    if (!winner) return 'no-winner';
    const head = `${winner.id}(${winner.priority}, ${winner.reason})`;
    if (!resolved.overrides || resolved.overrides.size === 0) return head;
    const ov = [...resolved.overrides]
        .map((id) => `${id}(${INTENT_PRIORITY[id] ?? '?'})`)
        .join(', ');
    return `${head} ← overrides[${ov}]`;
}

/**
 * 判断某个 signal flag 是否被当前 intent 覆盖。
 *
 * 把 v1.57.5 §D 散落在 DFV `_renderDetails` 里的硬编码
 * `(intent === 'relief') && afkEngage` 抽成数据驱动查询。
 *
 * 标志 → intent 映射（与 INTENT_RULES.guard 同源语义）：
 *   - afkEngage      → engage    （被 relief 覆盖）
 *   - harvestable    → harvest   （被 relief / engage 覆盖）
 *   - sprintWindow   → sprint    （被 relief / engage / harvest / pressure 覆盖）
 *
 * @param {string} signalId 标志 id（如 'afkEngage'）
 * @param {{intent: string, overrides: Set}} resolved resolveIntent 返回值
 * @returns {boolean}
 */
const SIGNAL_TO_INTENT = {
    afkEngage:    'engage',
    harvestable:  'harvest',
    sprintWindow: 'sprint',
};

export function isSignalOverridden(signalId, resolved) {
    if (!resolved) return false;
    const targetIntent = SIGNAL_TO_INTENT[signalId];
    if (!targetIntent) return false;
    return resolved.overrides.has(targetIntent);
}
