/* 自动生成 —— 请勿手改。源：web/src/retention/runOverRunArc.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * runOverRunArc.js — 局间难度弧线推导（Run-over-Run Arc, RoR）
 *
 * 设计动机
 * ─────────────────────────────────────────────────────────
 * 现状只有「单局内 S 曲线（r = score/PB）」 + 「runStreak 线性加压」+ 「S×M 表」三
 * 套旋钮，把今天第 N 局玩家的疲劳/赌气/首局兴奋当成同一档难度处理。
 *
 * 业界共识（Candy Crush A/B、RMH 2025 predictive DDA、EDDA 2025）：
 *   - 当日首局必须易（"opener"）
 *   - 第 2~3 局是黄金挑战窗口（"momentum"/"peak"）
 *   - 第 ≥6 局或连败必须给"breather"（"fatigue"）
 *   - 60 秒内赌气重开 → 必须保护（"cooldown"）
 *
 * 本模块只负责"派生"五档 arc，不直接施压；难度调制由：
 *   - PR2：difficulty.js getRunDifficultyModifiers 读 humped 曲线
 *   - PR2：lifecycleStressCapMap.getLifecycleStressCap(stage,band,dailyArc) 应用乘性 modifier
 *   - PR3：tuning/v2/targetSCurve.targetSCurveByArc(r, arc) 形变 D 曲线
 *
 * 完全无状态：所有输入显式传入；调用方持久化 dailyRunIndex / lastGameOver 等。
 *
 * @module web/src/retention/runOverRunArc
 */

/** @typedef {'opener'|'momentum'|'peak'|'fatigue'|'cooldown'} RunOverRunArc */

/**
 * 五档常量；与 lifecycleStressCapMap 的 modifier 维度、targetSCurveByArc 的形变档
 * 一一对应（任何新增/删除需同步三处 + 跨语言 Python）。
 */
export const RUN_OVER_RUN_ARCS = Object.freeze(['opener', 'momentum', 'peak', 'fatigue', 'cooldown']);

/**
 * 每档 arc 的中文短名（playerInsightPanel / advisor 直读）。
 */
export const RUN_OVER_RUN_ARC_LABEL = Object.freeze({
    opener: '今日首局',
    momentum: '黄金窗口',
    peak: '挑战巅峰',
    fatigue: '疲劳缓冲',
    cooldown: '赌气保护',
});

/**
 * 默认派生阈值；可被 GAME_RULES.runOverRunArc 覆盖（PR2 启用）。
 *
 * 各阈值含义：
 *   - openerIdleMs        与上局结束相隔 >= 该值即视为今日首局（默认 30 min）
 *   - openerMaxDailyIndex 今日第几局以内总视为 opener（默认 1）
 *   - momentumRange       今日第几局视为 momentum（默认 [2,3]）
 *   - peakRange           今日第几局视为 peak（默认 [4,5]）
 *   - fatigueMinIndex     今日第几局之后总视为 fatigue（默认 6）
 *   - fatigueLossStreak   连续 N 局 score < lossRatio·PB 也强制 fatigue（默认 3）
 *   - fatigueLossRatio    "失利"门槛比例（默认 0.6）
 *   - rageRestartMs       上局结束到本局开始 <= 该值视为赌气重开（默认 60000，即 60s；
 *                          5s 太短无法覆盖结算动画 + 复盘按钮交互，60s 才能真正捕获
 *                          "看一眼分数就重来" 的赌气行为）
 *   - rageMinChainLen     连续多少次"短重开+低分崩盘"才进 cooldown（默认 2）
 *   - rageLowScoreRatio   "崩盘"门槛比例（默认 0.3）
 *   - resetOnIdleMs       空闲多久 dailyRunIndex 当作新一天软重置（默认 30 min）
 */
export const DEFAULT_ARC_THRESHOLDS = Object.freeze({
    openerIdleMs: 30 * 60 * 1000,
    openerMaxDailyIndex: 1,
    momentumMin: 2,
    momentumMax: 3,
    peakMin: 4,
    peakMax: 5,
    fatigueMinIndex: 6,
    fatigueLossStreak: 3,
    fatigueLossRatio: 0.6,
    rageRestartMs: 60000,
    rageMinChainLen: 2,
    rageLowScoreRatio: 0.3,
    resetOnIdleMs: 30 * 60 * 1000,
});

/**
 * 用 GAME_RULES.runOverRunArc.* 覆盖默认阈值，缺失字段回落默认。
 * @param {object|undefined} cfg
 * @returns {typeof DEFAULT_ARC_THRESHOLDS}
 */
export function resolveArcThresholds(cfg) {
    if (!cfg || typeof cfg !== 'object') return DEFAULT_ARC_THRESHOLDS;
    const merged = { ...DEFAULT_ARC_THRESHOLDS };
    for (const k of Object.keys(DEFAULT_ARC_THRESHOLDS)) {
        const v = cfg[k];
        if (Number.isFinite(v) && v >= 0) merged[k] = v;
    }
    return Object.freeze(merged);
}

/**
 * 主推导函数：根据玩家本地时间 + 历史"局尾快照"派生 arc。
 *
 * 输入约定：
 *   - context.dailyRunIndex: 今日已开始的第几局（含当前；从 1 起）
 *   - context.now: 本次推导时间戳（ms；默认 Date.now()）
 *   - context.lastGameOver: { ts, score } 上一局结束快照（可空）
 *   - context.recentScores: 最近 N 局得分数组（按时间升序，可含当局以前；默认空）
 *   - context.bestScore: 玩家个人最佳分（用于 fatigue/cooldown 失利比例判定）
 *   - context.rageChainLen: 连续赌气重开链长（外部累加，跨进程持久化更准）
 *   - context.thresholds: 已 resolve 的阈值（可空）
 *
 * 输出：{ arc, reason, sinceLastBreakMs, debug }
 *   - arc: 'opener' / 'momentum' / 'peak' / 'fatigue' / 'cooldown'
 *   - reason: 命中规则名（用于埋点）
 *   - sinceLastBreakMs: 距离上次 >= openerIdleMs 的时长（用于 fatigue 软重置）
 *   - debug: 内部判定中间值（仅 dev / 单测）
 *
 * 优先级（高 → 低）：cooldown > fatigue (loss streak) > opener > fatigue (index) > peak > momentum > momentum（兜底）
 *   说明：cooldown 永远最高（保护玩家情绪），fatigueLossStreak 高于 opener，
 *         因为"今日首局也可能是昨晚连败的延续"，仍需 breather。
 *
 * @param {object} context
 * @returns {{arc: RunOverRunArc, reason: string, sinceLastBreakMs: number, debug: object}}
 */
export function deriveRunOverRunArc(context) {
    const ctx = context || {};
    const th = ctx.thresholds && Object.isFrozen(ctx.thresholds)
        ? ctx.thresholds
        : resolveArcThresholds(ctx.thresholds);
    const now = Number.isFinite(ctx.now) ? ctx.now : Date.now();
    const idx = Math.max(1, Math.floor(Number(ctx.dailyRunIndex) || 1));
    const lastGo = ctx.lastGameOver || null;
    const sinceLastBreakMs = (lastGo?.ts && now > lastGo.ts) ? (now - lastGo.ts) : Infinity;
    const best = Math.max(0, Number(ctx.bestScore) || 0);

    const debug = { idx, sinceLastBreakMs, lastScore: lastGo?.score ?? null, best };

    /* 1) cooldown：赌气重开链（60s 内重开且崩盘）
     *
     * best <= 0（新手无 PB）时整个判定无意义：既无法判断"崩盘"，也避免新手前几局
     * 因极短重开被误判为赌气；此时直接放弃 cooldown 路径，让下游 fatigue/opener 接管。 */
    let rageChainLen = 0;
    if (best > 0) {
        const ragePrevShort = Number.isFinite(sinceLastBreakMs) && sinceLastBreakMs <= th.rageRestartMs;
        const ragePrevLow = lastGo && (Number(lastGo.score) || 0) < th.rageLowScoreRatio * best;
        rageChainLen = Math.max(0, Math.floor(Number(ctx.rageChainLen) || 0))
            + (ragePrevShort && ragePrevLow ? 1 : 0);
        debug.rageChainLen = rageChainLen;
        if (rageChainLen >= th.rageMinChainLen) {
            return { arc: 'cooldown', reason: 'rage_restart_chain', sinceLastBreakMs, debug };
        }
    } else {
        debug.rageChainLen = 0;
    }

    /* 2) fatigueLossStreak：连续 N 局失利 */
    const recent = Array.isArray(ctx.recentScores) ? ctx.recentScores : [];
    let lossStreak = 0;
    if (best > 0) {
        for (let i = recent.length - 1; i >= 0; i--) {
            const s = Number(recent[i]) || 0;
            if (s < th.fatigueLossRatio * best) lossStreak++;
            else break;
        }
    }
    debug.lossStreak = lossStreak;
    if (lossStreak >= th.fatigueLossStreak) {
        return { arc: 'fatigue', reason: 'loss_streak', sinceLastBreakMs, debug };
    }

    /* 3) opener：空闲足够长 或 今日第 1 局 */
    const isIdleOpener = !Number.isFinite(sinceLastBreakMs) || sinceLastBreakMs >= th.openerIdleMs;
    const isFirstOfDay = idx <= th.openerMaxDailyIndex;
    if (isIdleOpener || isFirstOfDay) {
        return {
            arc: 'opener',
            reason: isFirstOfDay ? 'first_of_day' : 'idle_reset',
            sinceLastBreakMs,
            debug,
        };
    }

    /* 4) fatigue by index：今日第 N 局后 */
    if (idx >= th.fatigueMinIndex) {
        return { arc: 'fatigue', reason: 'daily_index', sinceLastBreakMs, debug };
    }

    /* 5) peak：第 4~5 局 */
    if (idx >= th.peakMin && idx <= th.peakMax) {
        return { arc: 'peak', reason: 'peak_range', sinceLastBreakMs, debug };
    }

    /* 6) momentum：第 2~3 局（兜底） */
    return { arc: 'momentum', reason: 'momentum_range', sinceLastBreakMs, debug };
}

/**
 * 一句话摘要（中文，供 advisor / insight panel 直读）。
 * @param {{arc: RunOverRunArc, reason: string}} info
 * @returns {string}
 */
export function describeRunOverRunArc(info) {
    if (!info || !info.arc) return '局间弧线：未派生';
    const label = RUN_OVER_RUN_ARC_LABEL[info.arc] || info.arc;
    return `局间弧线：${label}（${info.reason}）`;
}
