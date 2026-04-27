/**
 * 商业化策略决策引擎（L2 - 规则引擎层）
 *
 * 输入：(persona, realtime) 上下文 → 输出：rankedActions[] / whyLines[]
 *
 * 设计：纯函数 + 配置驱动，**零副作用**：
 *   - 不读 localStorage / 不发请求 / 不操作 DOM
 *   - 仅依赖 strategyConfig.js 提供的规则与阈值
 *   - 业务模块（personalization / adTrigger / iapAdapter）调用此引擎做决策
 *
 * 单元可测试性：
 *   ```js
 *   import { evaluate } from './strategyEngine.js';
 *   const result = evaluate({
 *     persona:  { segment: 'dolphin', activityScore: 0.5, whaleScore: 0.42 },
 *     realtime: { frustration: 6, hadNearMiss: true, flowState: 'anxious' }
 *   });
 *   expect(result.actions[0].action.format).toBe('rewarded');
 *   ```
 */

import { getStrategyConfig } from './strategyConfig.js';

/**
 * @typedef {Object} EvaluationContext
 * @property {object} persona      持久画像（segment / whaleScore / activityScore / skillScore / nearMissRate / frustrationAvg）
 * @property {object} realtime     实时信号（frustration / hadNearMiss / flowState / momentum / sessionPhase）
 * @property {object} [config]     可选覆盖配置（默认走 getStrategyConfig）
 */

/**
 * @typedef {Object} EvaluatedAction
 * @property {string} ruleId
 * @property {{ type: string, [key: string]: any }} action
 * @property {'high'|'medium'|'low'} priority
 * @property {string} why     触发原因（已渲染好的人类可读文案）
 * @property {string} effect  预期效果
 * @property {boolean} active 实时信号命中 → 强提示「⚡ 触发中」
 */

/** 优先级权重（用于排序） */
const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };

/**
 * 评估当前上下文，返回命中的规则列表（已排序、已渲染文案）。
 *
 * @param {EvaluationContext} ctx
 * @returns {{ segment: string, actions: EvaluatedAction[], whyLines: string[] }}
 */
export function evaluate(ctx) {
    const config = ctx?.config ?? getStrategyConfig();
    const persona  = ctx?.persona  ?? {};
    const realtime = ctx?.realtime ?? {};
    const segment  = persona.segment ?? 'minnow';

    const evalCtx = { persona, realtime, config, segment };

    // 1. 过滤命中规则（分群匹配 + when 条件）
    const matched = (config.rules ?? []).filter(r => {
        if (Array.isArray(r.segments) && r.segments.length > 0
            && !r.segments.includes(segment)) {
            return false;
        }
        if (typeof r.when === 'function') {
            try { return Boolean(r.when(evalCtx)); }
            catch (err) {
                console.warn(`[strategyEngine] rule ${r.id} when() threw:`, err);
                return false;
            }
        }
        return true;
    });

    // 2. 渲染每条规则的 why/effect/active
    const evaluated = matched.map(r => _renderAction(r, evalCtx));

    // 3. 按优先级降序、active 优先排序
    evaluated.sort((a, b) => {
        if (a.active !== b.active) return a.active ? -1 : 1;
        return (PRIORITY_WEIGHT[b.priority] ?? 0) - (PRIORITY_WEIGHT[a.priority] ?? 0);
    });

    // 4. 推理摘要（参考玩家画像面板风格）
    const whyLines = buildWhyLines(evalCtx);

    return { segment, actions: evaluated, whyLines };
}

function _renderAction(rule, evalCtx) {
    let why = rule.why ?? '';
    let effect = rule.effect ?? '';
    if (typeof rule.explain === 'function') {
        try {
            const dyn = rule.explain(evalCtx) ?? {};
            if (dyn.why) why = dyn.why;
            if (dyn.effect) effect = dyn.effect;
        } catch (err) {
            console.warn(`[strategyEngine] rule ${rule.id} explain() threw:`, err);
        }
    }

    return {
        ruleId: rule.id,
        action: rule.action,
        priority: rule.priority ?? 'medium',
        why,
        effect,
        active: _isActive(rule, evalCtx),
    };
}

/**
 * 判定规则是否处于「实时触发中」状态（用于面板高亮 ⚡）。
 * 默认规则：若规则有 when() 且当前命中，则视为 active；否则按动作类型 + 信号判断。
 */
function _isActive(rule, evalCtx) {
    const { realtime, config } = evalCtx;

    // 显式带 when 的规则视为 active
    if (typeof rule.when === 'function') return true;

    const t = config.thresholds ?? {};
    const a = rule.action ?? {};
    if (a.type === 'ads' && a.format === 'rewarded' && realtime.hadNearMiss) return true;
    if (a.type === 'ads' && a.trigger === 'game_over') return true;
    if (a.type === 'iap' && Number(realtime.frustration ?? 0) >= (t.frustrationIapHint ?? 4)) return true;
    return false;
}

/**
 * 生成推理摘要（whyLines bullets）— 与原 personalization.buildCommercialWhyLines 等价，
 * 但所有阈值改读 strategyConfig.thresholds。
 */
export function buildWhyLines(evalCtx) {
    const { persona, realtime, config } = evalCtx;
    const t = config.thresholds ?? {};
    const lines = [];

    // 分群依据
    const segDef = (config.segments ?? []).find(s => s.id === persona.segment);
    const segLabel = segDef?.id ? segDef.id.charAt(0).toUpperCase() + segDef.id.slice(1) : persona.segment;
    const w = config.segmentWeights ?? {};
    lines.push(
        `分群 ${segLabel}：鲸鱼分 ${(persona.whaleScore * 100).toFixed(0)}%（最高分×${w.best_score_norm}` +
        ` + 局数×${w.total_games_norm} + 时长×${w.session_time_norm}）`
    );

    // 活跃度
    if (persona.activityScore >= (t.activityHigh ?? 0.7)) {
        lines.push(`活跃度高（${(persona.activityScore * 100).toFixed(0)}%）→ IAP 转化窗口良好`);
    } else if (persona.activityScore < (t.activityLow ?? 0.35)) {
        lines.push(`活跃度低（${(persona.activityScore * 100).toFixed(0)}%）→ 触发唤回推送，D7 +15%`);
    }

    // 挫败感
    const frust = Number(realtime.frustration ?? 0);
    if (frust >= (t.frustrationRescue ?? 5)) {
        lines.push(`未消行 ${frust} 次 → 已达救济阈值，激励广告/提示包转化率最高`);
    } else if (frust >= (t.frustrationWarning ?? 3)) {
        lines.push(`未消行 ${frust} 次 → 接近阈值，准备触发救济策略`);
    }

    // 近失
    if (realtime.hadNearMiss) {
        lines.push('⚡ 近失触发 → 激励广告转化率 +40%，立即展示最佳');
    } else if ((persona.nearMissRate ?? 0) > (t.nearMissRateHigh ?? 0.30)) {
        lines.push(`历史近失率 ${(persona.nearMissRate * 100).toFixed(0)}% → 激励广告收益优于插屏`);
    }

    // 心流
    const flowMeta = (config.copy?.flow ?? {})[realtime.flowState];
    if (flowMeta && realtime.flowState === 'flow') {
        lines.push('心流中 → 抑制插屏广告，流失率峰值');
    } else if (flowMeta && realtime.flowState === 'anxious') {
        lines.push('略焦虑 → 激励广告/提示包接受度↑');
    } else if (flowMeta && realtime.flowState === 'bored') {
        lines.push('略无聊 → 展示皮肤/新内容预告引导付费');
    }

    // 晋升路径
    const segs = config.segments ?? [];
    const sorted = [...segs].sort((a, b) => (b.minWhaleScore ?? 0) - (a.minWhaleScore ?? 0));
    const curIdx = sorted.findIndex(s => s.id === persona.segment);
    if (curIdx > 0) {
        const next = sorted[curIdx - 1];
        const gap = (next.minWhaleScore ?? 0) - (persona.whaleScore ?? 0);
        if (gap > 0 && gap < 0.20) {
            lines.push(`距晋升 ${next.id} 差 ${(gap * 100).toFixed(0)} 分 → 提升最高分或时长`);
        }
    }

    return lines;
}

/**
 * 业务模块通用入口：判断「指定 ruleId 当前是否应该触发」。
 * adTrigger / iapAdapter / pushNotifications 调用此函数前置筛选，避免在 trigger 内
 * 重复判断分群与信号。
 *
 * @example
 *   if (shouldTriggerRule('dolphin_rewarded_near_miss', { persona, realtime })) {
 *       showRewardedAd('near_miss');
 *   }
 */
export function shouldTriggerRule(ruleId, ctx) {
    const config = ctx?.config ?? getStrategyConfig();
    const rule = (config.rules ?? []).find(r => r.id === ruleId);
    if (!rule) return false;

    const segment  = ctx?.persona?.segment ?? 'minnow';
    if (Array.isArray(rule.segments) && rule.segments.length > 0
        && !rule.segments.includes(segment)) {
        return false;
    }
    if (typeof rule.when === 'function') {
        try {
            return Boolean(rule.when({
                persona:  ctx.persona ?? {},
                realtime: ctx.realtime ?? {},
                config,
                segment,
            }));
        } catch { return false; }
    }
    return true;
}
