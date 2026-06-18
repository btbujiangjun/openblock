/**
 * decisionTable — 通用「幂等叠加」决策表执行器（v1.71 V5）
 *
 * 适用场景：N 条独立 if 规则，每条规则在 state 上做 max/min 字段更新
 * （无顺序依赖、无直接赋值覆盖）。adaptiveSpawn 里 V1 抽出的
 * _applySpawnHintsRiskReliefRules 就是典型例子。
 *
 * **不适用**于含直接赋值顺序覆盖的场景（如 U1 base rules 的 frust=-0.3 路径），
 * 那种语义必须保留为命令式代码，强行表化会把顺序陷阱藏得更深。
 *
 * 规则形态：
 *   {
 *     name: 'high-risk',                       // 调试用
 *     when: (s) => s.confidence >= 0.25 && s.risk >= 0.62,
 *     apply: [
 *       { field: 'clearGuarantee', op: 'max', value: 2 },
 *       { field: 'sizePreference', op: 'min', value: -0.22 },
 *       { field: 'rhythmPhase',    op: 'set', value: 'neutral', when: (s) => s.rhythmPhase === 'setup' },
 *     ],
 *   }
 *
 * 支持 op：max / min / set / setIf（带条件赋值）
 *   - max: state[field] = Math.max(state[field], value)
 *   - min: state[field] = Math.min(state[field], value)
 *   - set: state[field] = value  （这里 set 默认无条件，需谨慎使用——见上文不适用场景）
 *
 * value 可以是常量或 (state) => value 函数（动态值，例如读 config）。
 */

/**
 * 按规则表叠加更新 state。原地修改并返回（方便链式）。
 * @param {Array<{name?:string, when:(s:object)=>boolean, apply:Array<object>}>} rules
 * @param {object} state
 * @returns {object} 同一 state 引用
 */
function applyDecisionTable(rules, state) {
    if (!Array.isArray(rules) || !state || typeof state !== 'object') return state;
    for (const rule of rules) {
        if (!rule || typeof rule.when !== 'function') continue;
        let triggered;
        try { triggered = rule.when(state); } catch { triggered = false; }
        if (!triggered) continue;
        if (!Array.isArray(rule.apply)) continue;
        for (const step of rule.apply) {
            if (!step || typeof step.field !== 'string') continue;
            if (typeof step.when === 'function') {
                let stepOk;
                try { stepOk = step.when(state); } catch { stepOk = false; }
                if (!stepOk) continue;
            }
            const v = typeof step.value === 'function' ? step.value(state) : step.value;
            const cur = state[step.field];
            switch (step.op) {
                case 'max':
                    if (typeof cur === 'number' && typeof v === 'number') state[step.field] = Math.max(cur, v);
                    break;
                case 'min':
                    if (typeof cur === 'number' && typeof v === 'number') state[step.field] = Math.min(cur, v);
                    break;
                case 'set':
                    state[step.field] = v;
                    break;
                /* 任何未知 op 静默跳过——表是数据，新版本表如带未来 op 不应拖垮老 runtime */
                default: break;
            }
        }
    }
    return state;
}

module.exports = { applyDecisionTable };
