/**
 * OO5 / NN-F3.1: Spawn Rules DSL Runtime（PoC 骨架）
 *
 * 声明式规则数组运行器，规则形如：
 *   {
 *     id: 'unique-string',
 *     when: (ctx) => boolean,          // 命中条件
 *     apply: (state, ctx) => newState, // 命中时变换 state
 *     priority?: number,               // 默认 0，从大到小执行
 *     abTestKey?: string,              // 可被 disabled[] 关掉
 *     since?: string,                  // 版本元数据
 *     owner?: string,                  // 责任人
 *     comment?: string,                // 文档化用
 *   }
 *
 * 设计原则（ADR-008）：
 *   - 纯函数，无副作用（state 不就地改）
 *   - 执行顺序稳定（priority 降序，相同 priority 按数组声明顺序）
 *   - 单条 apply 抛错 → 跳过该规则，不影响其他（容错）
 *   - 提供 dryRun 选项用于 A/B / 调试，返回每条规则命中与否
 *
 * 这是 PoC：当前 adaptiveSpawn.js 的 helper 仍是单一真源，
 * DSL 仅供平行验证 + 后续逐条迁移参考。
 */

/**
 * 校验规则集（启动期可调用）。
 * @returns {string[]} 错误列表（空数组表示通过）
 */
export function validateRules(rules) {
    const errs = [];
    if (!Array.isArray(rules)) {
        errs.push('rules must be an array');
        return errs;
    }
    const ids = new Set();
    for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        if (!r || typeof r !== 'object') {
            errs.push(`rule[${i}] not an object`); continue;
        }
        if (typeof r.id !== 'string' || !r.id) errs.push(`rule[${i}] missing id`);
        if (typeof r.when !== 'function') errs.push(`rule[${r.id || i}] when not fn`);
        if (typeof r.apply !== 'function') errs.push(`rule[${r.id || i}] apply not fn`);
        if (r.priority != null && typeof r.priority !== 'number') {
            errs.push(`rule[${r.id || i}] priority not number`);
        }
        if (ids.has(r.id)) errs.push(`rule[${r.id}] duplicate id`);
        ids.add(r.id);
    }
    return errs;
}

/**
 * 排序：priority 降序，priority 相同时保持声明顺序（稳定排序）。
 */
function _sortRules(rules) {
    return rules
        .map((r, i) => ({ r, i }))
        .sort((a, b) => {
            const pa = a.r.priority ?? 0;
            const pb = b.r.priority ?? 0;
            if (pa !== pb) return pb - pa;
            return a.i - b.i;
        })
        .map(x => x.r);
}

/**
 * 执行规则链。
 * @param {object[]} rules
 * @param {object} initialState
 * @param {object} ctx
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.disabled] - abTestKey 或 id 在此集合内则跳过
 * @param {boolean} [opts.dryRun] - true 时不修改 state，仅返回 trace
 * @param {Function} [opts.onError] - (err, rule) → void
 * @returns {{state:object, trace:Array<{id:string,matched:boolean,error?:string}>}}
 */
export function runSpawnRules(rules, initialState, ctx, opts = {}) {
    const disabled = opts.disabled instanceof Set
        ? opts.disabled
        : new Set(opts.disabled || []);
    const sorted = _sortRules(rules);
    let state = initialState;
    const trace = [];

    for (const rule of sorted) {
        if (disabled.has(rule.id) || (rule.abTestKey && disabled.has(rule.abTestKey))) {
            trace.push({ id: rule.id, matched: false, skipped: 'disabled' });
            continue;
        }
        let matched = false;
        try {
            matched = !!rule.when(ctx);
        } catch (e) {
            trace.push({ id: rule.id, matched: false, error: `when:${e.message}` });
            opts.onError?.(e, rule);
            continue;
        }
        if (!matched) {
            trace.push({ id: rule.id, matched: false });
            continue;
        }
        if (opts.dryRun) {
            trace.push({ id: rule.id, matched: true, dryRun: true });
            continue;
        }
        try {
            const next = rule.apply(state, ctx);
            if (next !== undefined) state = next;
            trace.push({ id: rule.id, matched: true });
        } catch (e) {
            trace.push({ id: rule.id, matched: true, error: `apply:${e.message}` });
            opts.onError?.(e, rule);
            /* 不更新 state，继续下一条 */
        }
    }
    return { state, trace };
}

/**
 * PoC 规则示例：把 adaptiveSpawn 中 holesRule 的核心 clearGuarantee 提升逻辑
 * 用 DSL 重写。仅用于参考与测试，不替换 adaptiveSpawn 主路径。
 *
 * 行为契约（与 _applySpawnHintsHolesRule 等价）：
 *   - ctx.topoCfg.holeClearGuarantee（默认 2）
 *   - ctx.holesSeverity ≥ 阈值时把 state.clearGuarantee 至少抬到该值
 */
export const POC_HOLES_RULE = {
    id: 'holes-clear-guarantee',
    abTestKey: 'holesV1',
    priority: 100,
    since: 'NN-F3.1',
    owner: 'gameplay',
    comment: 'PoC：holes 严重度高时强保 clearGuarantee。与 adaptiveSpawn._applySpawnHintsHolesRule 等价。',
    when: (ctx) => (ctx?.holesSeverity ?? 0) > 0.5,
    apply: (state, ctx) => {
        const guarantee = ctx?.topoCfg?.holeClearGuarantee ?? 2;
        if ((state.clearGuarantee ?? 0) >= guarantee) return state;
        return { ...state, clearGuarantee: guarantee };
    },
};

export const _internal = { _sortRules };
