/**
 * derivation/presentationReducer.js — v1.58 展示层 Reducer
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 设计动机
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 把"算法状态 + 实时几何 → UI 可显示量"的派生集中到一处。
 * UI 层（DFV / stressMeter / playerInsightPanel）只读 PresentationModel，
 * 不再各自拼装、各自守卫、各自降级。
 *
 * **关键设计**：
 *   - **纯函数**：输入 game 状态 → 输出 PresentationModel，无副作用
 *   - **可独立测试**：传任意 mock game 都能产出稳定 PresentationModel
 *   - **trace 永远附带**：每个派生量都有 trace 字段，诊断面板 / Sentry 可读
 *   - **降级安全**：任一子派生失败不会让整个 reducer 抛错，只让对应字段为 null
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * PresentationModel 结构（UI 唯一消费源）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   {
 *     // === 几何（实时） ===
 *     liveGeometry: { fill, holes, nearFullLines, multiClearCandidates, pcSetup },
 *     liveBoardFill: 0.69,
 *     liveClearRate: 0.31,
 *     liveMissRate: 0.02,
 *
 *     // === 意图（trace 化） ===
 *     intent: { id: 'relief', trace: [...], overrides: Set('engage') },
 *     intentLabel: '救济节奏',
 *     intentColor: '#22d3ee',
 *
 *     // === 叙事 ===
 *     narrative: { text: '盘面有可消行机会...', contractId: 'relief.friendly', trace: [...] },
 *
 *     // === 头像 ===
 *     emoji: { face: '😅', label: '舒缓（盘面吃紧）', vibe: '...', id: 'easy-crowded', contractId: 'easy.crowded' },
 *
 *     // === Decision Chips（含 overridden 标记）===
 *     chips: [
 *       { id: 'forceRelief', label: '强制救济', kind: 'neg', on: false, overridden: false, title: null },
 *       { id: 'afkEngage',   label: 'AFK 介入', kind: 'pos', on: true,  overridden: true,  title: '信号已激活，但本帧被更高优先级意图（relief）覆盖' },
 *       ...
 *     ],
 *
 *     // === 原始 insight 直通（兼容旧调用方）===
 *     rawInsight: { ... },
 *     rawProfile: { ... },
 *   }
 *
 * @file
 */

import {
    selectInsightWithLiveGeometry,
    selectLiveBoardFill,
    selectLiveClearRate,
    selectLiveMissRate,
    selectLiveGeometry,
    selectProfileForPresentation,
    selectReducerInputs,
} from './selectors.js';
import { resolveIntent, isSignalOverridden, formatIntentTrace } from './intentResolver.js';
import { selectNarrative, selectEmoji } from './displayContracts.js';

/* 与 stressMeter / decisionFlowViz 同源（避免循环依赖，复刻常量） */
export const SPAWN_INTENT_COLOR = Object.freeze({
    relief:   '#22d3ee',
    engage:   '#a78bfa',
    flow:     '#10b981',
    maintain: '#94a3b8',
    sprint:   '#0ea5e9',
    pressure: '#f59e0b',
    harvest:  '#f472b6',
});
export const SPAWN_INTENT_LABEL = Object.freeze({
    relief:   '救济节奏',
    engage:   '挑战参与',
    flow:     '维持心流',
    maintain: '保持节奏',
    sprint:   '渐紧过渡',
    pressure: '提升压力',
    harvest:  '收获机会',
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  Chip 定义表                                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Decision flag chip 定义。
 * 与 decisionFlowViz.js `_renderDetails` 内 flags 数组同源。
 *
 * 每条：
 *   - id:       chip 内部 id（与 i18n key 对应）
 *   - label:    fallback 标签
 *   - kind:     视觉 kind（pos / neg / neutral）
 *   - on:       (ctx) => boolean，是否激活
 *   - reason:   (ctx) => string，chip 高亮时显示的"为什么激活 + 数值"（v1.58.3）
 *               未提供则用 label 作 title；提供后 DFV chip title 显示完整 reason，
 *               消除 v1.58.3 截图发现的"灯亮但无来源"问题。
 *   - overrideSignal: 与 intentResolver.SIGNAL_TO_INTENT 对应的 signal id
 *                     —— 用于查 overridden 状态。null 表示不参与覆盖检查。
 *   - forceReliefUpstream: true 表示本 chip 是 forceReliefIntent 的合法上游
 *                          触发器之一（用于性质 I15 强制"forceRelief 亮 →
 *                          至少一个上游 chip 亮"）。
 *
 * v1.58.3 新增 4 个 chip（endSessionStress / lifecycleLateAccel /
 * playerDistressFloor / delightModeRelief）—— 把 forceReliefIntent 的全部触发器
 * 都暴露到 UI，避免 v1.58.3 截图发现的"强制救济亮但其它 chip 全暗"问题。
 */
export const CHIP_DEFS = Object.freeze([
    { id: 'forceRelief',     label: '强制救济', kind: 'neg',
      on: (c) => !!(c.intentInputs?.forceReliefIntent),
      reason: () => 'forceReliefIntent=true（由 lateCollapse 或 frustCritical 上游触发，见 adaptiveSpawn.js:2235）',
      overrideSignal: null },

    /* —— forceRelief 真实上游触发器（与 adaptiveSpawn.js:2235 严格同源）—— */
    { id: 'lateCollapse',    label: '末段崩盘', kind: 'neg',
      on: (c) => (c.distress?.sessionPhase === 'late')
              && (Number(c.distress?.momentum) <= -0.30)
              && !c.intentInputs?.abovePb,          // v1.60.37：已破 PB 豁免
      reason: (c) => {
          const mom = Number(c.distress?.momentum).toFixed(2);
          if (c.intentInputs?.abovePb) return `sessionPhase=late + momentum=${mom} ≤ -0.30，但 score > bestScore（已破 PB），末段崩盘豁免，不触发 forceRelief`;
          return `sessionPhase=late + momentum=${mom} ≤ -0.30（末段+动量持续下行 → forceRelief 上游 #1）`;
      },
      overrideSignal: null, forceReliefUpstream: true },
    { id: 'frustCritical',   label: '挫败临界', kind: 'neg',
      on: (c) => Number(c.distress?.frustrationLevel) >= 5,
      reason: (c) => `frustrationLevel=${Number(c.distress?.frustrationLevel)} ≥ 5（挫败累积偏高 → forceRelief 上游 #2）`,
      overrideSignal: null, forceReliefUpstream: true },

    /* —— 信号诊断 chip（v1.58.3 新加）：独立反映其它压力链路信号，
     * 不是 forceReliefIntent 的上游，但帮玩家从 DFV 直观看到"为什么 stress 是这个值"。
     * 与 forceRelief chip 分两类语义：决策强制 vs 信号诊断。 */
    { id: 'endSessionStress', label: '末段压力', kind: 'neutral',
      on: (c) => Number(c.breakdown?.endSessionDistress) < -0.05,
      reason: (c) => `endSessionDistress=${Number(c.breakdown?.endSessionDistress).toFixed(3)} < -0.05（会话维度压力，影响 stress 标量与 relief.endgame 文案）`,
      overrideSignal: null },
    { id: 'lifecycleLateAccel', label: '生命周期末段加速', kind: 'neutral',
      on: (c) => Number(c.breakdown?.lifecycleBias) < -0.04,
      reason: (c) => `lifecycleBias=${Number(c.breakdown?.lifecycleBias).toFixed(3)} < -0.04（生命周期偏移加速救济，影响 stress 标量）`,
      overrideSignal: null },
    { id: 'playerDistressFloor', label: 'distress 浮标', kind: 'neutral',
      on: (c) => Number(c.intentInputs?.playerDistress) < -0.10,
      reason: (c) => `playerDistress=${Number(c.intentInputs?.playerDistress).toFixed(2)} < -0.10（distress 浮标，影响 spawnIntent 优先级，relief 规则触发）`,
      overrideSignal: null },
    { id: 'delightModeRelief', label: '愉悦模式·救济', kind: 'neutral',
      on: (c) => c.intentInputs?.delightMode === 'relief',
      reason: () => 'delightMode=relief（愉悦模式主动救济，影响 spawnIntent 优先级）',
      overrideSignal: null },

    /* —— pos / neutral chips —— */
    { id: 'onboarding',      label: '新手保护', kind: 'pos',
      on: (c) => !!c.onboarding,
      reason: () => 'playerProfile.isInOnboarding=true（前 N 局新手保护）',
      overrideSignal: null },
    { id: 'milestone',       label: '里程碑',   kind: 'pos',
      on: (c) => !!c.scoreMilestoneHit,
      reason: () => 'scoreMilestoneHit=true（命中分数里程碑）',
      overrideSignal: null },
    { id: 'afkEngage',       label: 'AFK 介入', kind: 'pos',
      on: (c) => !!c.afkEngageActive,
      reason: () => 'afkEngageActive=true（检测到 AFK 后系统主动介入）',
      overrideSignal: 'afkEngage' },
    { id: 'winback',         label: '回流保护', kind: 'pos',
      on: (c) => !!(c.hints?.winbackProtectionActive),
      reason: () => 'spawnHints.winbackProtectionActive=true（回流玩家保护）',
      overrideSignal: null },
    { id: 'personalization', label: '个性化',   kind: 'neutral',
      on: (c) => !!c.personalizationApplied,
      reason: () => 'personalizationApplied=true（应用了个性化策略层）',
      overrideSignal: null },
    { id: 'pbChase', label: 'PB追击', kind: 'pos',
      on: (c) => !!c.intentInputs?.pbChasePressureActive,
      reason: (c) => {
          const boost = Number(c.intentInputs?.challengeBoost ?? 0).toFixed(2);
          return `pbChasePressureActive=true（challengeBoost=${boost}，接近/超越 PB）`;
      },
      overrideSignal: 'relief' },
    { id: 'delightStarved', label: '爽感饥渴', kind: 'neg',
      on: (c) => !!c.intentInputs?.delightStarved,
      reason: (c) => {
          const n = Number(c.intentInputs?.roundsSinceLastDelight) || 0;
          return `delightStarved=true（连续 ${n} 轮无 multiClear/pcClear/monoFlush）`;
      },
      overrideSignal: null },
]);

const CHIP_OVERRIDE_TITLE = '信号已激活，但本帧被更高优先级意图覆盖';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  主 reducer 入口                                                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 把 game 状态 reduce 成 UI 唯一消费的 PresentationModel。
 *
 * @param {object} game game 实例（含 grid / playerProfile / _lastAdaptiveInsight）
 * @returns {object} PresentationModel
 */
export function reducePresentation(game) {
    if (!game) return emptyModel();

    /* ── 1. SSOT：从 selectors 取所有数据 ────────────────────────────── */
    const ctx = selectReducerInputs(game);
    const insight = selectInsightWithLiveGeometry(game);
    const profile = selectProfileForPresentation(game);
    const liveBoardFill = selectLiveBoardFill(game);
    const liveClearRate = selectLiveClearRate(game);
    const liveMissRate = selectLiveMissRate(game);
    const liveGeometry = selectLiveGeometry(game);

    /* ── 2. Intent：表驱动 resolveIntent ───────────────────────────── */
    /* 若 _intentInputs 缺失（旧回放 / mock），回退到 hints.spawnIntent。
     * 这是 v1.58 引入派生层的"温和过渡策略"——_intentInputs 推荐有，没有也不崩。 */
    const intentInputs = ctx.intentInputs ?? null;
    let intentResolved;
    if (intentInputs) {
        intentResolved = resolveIntent({
            ...intentInputs,
            geometry: ctx.geometry,
        });
    } else {
        /* 没有 _intentInputs 时，凭 hints.spawnIntent 重建一条 trace 单条记录。
         * 这种降级路径下 overrides 为空（无法重判）。 */
        const intentId = ctx.intent || 'maintain';
        intentResolved = {
            intent: intentId,
            trace: [{ id: intentId, priority: 0, passed: true, isWinner: true,
                reason: '来自 spawnHints.spawnIntent（无 _intentInputs 可重判）' }],
            overrides: new Set(),
        };
    }

    /* ── 3. Narrative：表驱动 selectNarrative ───────────────────────── */
    const narrativeCtx = {
        intent: intentResolved.intent,
        stress: ctx.stress,
        geometry: ctx.geometry,
        breakdown: ctx.breakdown,
        hints: ctx.hints,
        distress: ctx.distress,
    };
    const narrativeResult = selectNarrative(narrativeCtx);

    /* ── 4. Emoji：表驱动 selectEmoji ──────────────────────────────── */
    const emojiCtx = {
        intent: intentResolved.intent,
        stress: ctx.stress,
        distress: ctx.distress,
    };
    const emojiResult = selectEmoji(emojiCtx);

    /* ── 5. Chips：数据驱动 + overridden 自动派生 + reason 自描述 (v1.58.3) ─── */
    const chips = deriveChipsFromCtx(ctx, intentResolved);

    /* ── 5.5 conflicts：跨维度信号冲突可视化（v1.58.3）──
     * 当中长期心流估测（flowState）与即时意图（intent）/ delightMode 互斥时，
     * 输出 conflicts 数组让 DFV / 上层 UI 显式承认"我知道有冲突，但选了当前优先级"。
     * 比假装一致更可信，也是 v1.58.3 截图发现的 bored vs relief 矛盾的根因治理。 */
    const conflicts = _deriveConflicts(ctx, intentResolved);

    /* ── 6. 输出 PresentationModel ─────────────────────────────────── */
    return {
        liveGeometry,
        liveBoardFill,
        liveClearRate,
        liveMissRate,
        intent: intentResolved,
        intentLabel: SPAWN_INTENT_LABEL[intentResolved.intent] || intentResolved.intent,
        intentColor: SPAWN_INTENT_COLOR[intentResolved.intent] || '#94a3b8',
        intentTraceText: formatIntentTrace(intentResolved),
        narrative: {
            text: narrativeResult.text,
            contractId: narrativeResult.contract?.id ?? null,
            trace: narrativeResult.trace,
        },
        emoji: emojiResult.output
            ? { ...emojiResult.output, contractId: emojiResult.contract?.id ?? null }
            : null,
        emojiTrace: emojiResult.trace,
        chips,
        conflicts,
        /* 兼容旧调用方：原始 insight / profile 直通 */
        rawInsight: insight,
        rawProfile: profile,
        rawCtx: ctx,
    };
}

/**
 * 派生跨维度信号冲突列表（v1.58.3）。
 *
 * 识别 N 类典型"两个独立信号源同时正确但语义对掐"的情况，输出 conflicts 数组
 * 供 DFV 在 chip 区底部渲染"⚠ 本帧识别到 N 处状态冲突（点击展开）"。
 *
 * 这不是 bug 修复——是承认架构事实：playerProfile.flowState 是中长期估测，
 * adaptiveSpawn.spawnIntent 是即时会话弧线判定，两者本就可以独立矛盾。
 * v1.58.3 之前我们假装一致；v1.58.3 起，让 UI 显式承认冲突，比撒谎更可信。
 *
 * 同时导出为 deriveConflicts（不带下划线前缀），供 DFV 等外部调用。
 *
 * @param {object} ctx selectReducerInputs 返回的完整上下文
 * @param {{intent: string, trace: Array, overrides: Set}} intentResolved
 * @returns {Array<{id: string, severity: 'info'|'warn', tip: string}>}
 */
export function deriveConflicts(ctx, intentResolved) {
    return _deriveConflicts(ctx, intentResolved);
}

function _deriveConflicts(ctx, intentResolved) {
    const out = [];
    const flowState = ctx.distress?.flowState;
    const intent = intentResolved?.intent;

    /* flowVsIntent：中长期"无聊/被挑战"的心流估测 vs 即时救济/加压意图 */
    if (flowState === 'bored' && intent === 'relief') {
        out.push({
            id: 'flowVsIntent',
            severity: 'info',
            tip: 'flowState=bored（中长期玩家偏强 → 算法本应加压）vs intent=relief（当前末段救济）。本帧以末段优先级胜出，长期"加挑战"会留到下一局/下次推荐档调整。',
        });
    }
    if (flowState === 'challenged' && intent === 'engage') {
        out.push({
            id: 'flowVsIntent',
            severity: 'info',
            tip: 'flowState=challenged（中长期玩家被挑战 → 算法本应放松）vs intent=engage（当前 AFK 介入要重启节奏）。本帧以 AFK 介入优先级胜出。',
        });
    }

    /* pressureVsForce：压力贡献正向主导 vs forceReliefIntent 绕过 stress 标量 */
    const forceRelief = !!ctx.intentInputs?.forceReliefIntent;
    if (forceRelief && intent === 'relief') {
        /* 算 Top 4 是否净正向（粗判：sum>0 的分量 > sum<0 的分量数） */
        const br = ctx.breakdown || {};
        const posSum = Object.values(br).filter((v) => Number(v) > 0.10).length;
        const negSum = Object.values(br).filter((v) => Number(v) < -0.10).length;
        if (posSum > negSum) {
            out.push({
                id: 'pressureVsForce',
                severity: 'info',
                tip: '压力贡献 Top 项以"正向加压"为主，但本帧 forceReliefIntent=true 通过抢占线路（绕过 stress 标量求和）触发救济。这是算法本意，与正向压力分量不矛盾。',
            });
        }
    }

    /* v1.58.4 §自查 E6：stressVsBoardFill —— stress 标量 vs 几何盘面强烈不一致。
     * 典型场景：playerDistress / sessionPhase / lifecycleBias 等多维信号把 stress 标量推高，
     * 但几何盘面（boardFill）很低；玩家视觉看到通透盘面，但 emoji/文案显示"高压"——撒谎风险。
     * 单点 contract 守卫只能让 contract 自己降级（如 flow.intense.soft），
     * 显式 conflicts 可以让 DFV/上层 UI 一眼看出"这不是 bug，是多维信号 vs 几何的真实不一致"。 */
    const stress = Number(ctx.stress) || 0;
    const boardFill = Number(ctx.geometry?.boardFill) || 0;
    if (stress >= 0.65 && boardFill < 0.30) {
        out.push({
            id: 'stressVsBoardFill',
            severity: 'info',
            tip: `stress=${stress.toFixed(2)}（多维信号叠加偏高）vs boardFill=${boardFill.toFixed(2)}（几何盘面通透）。算法侧压力来自非几何源（如末段/挫败/distress 浮标/lifecycle 偏移），不是盘面真实危险。`,
        });
    }

    return out;
}

/**
 * 派生 chips 数组（v1.58.3 抽出，供 DFV 直接调用，避免 chip 渲染逻辑漂移）。
 *
 * 输入 ctx 即 selectReducerInputs(game) 的返回；intentResolved 即 resolveIntent(...) 的返回。
 * 对于无 game 实例的渲染场景（如 DFV 已经持有 insight + profile），调用方可以
 * 手动构造 ctx + intentResolved，或用 buildChipCtxFromInsight 辅助函数。
 *
 * 输出每条 chip：
 *   { id, label, kind, on, overridden, reason, title }
 *
 * - on:         本帧是否激活
 * - overridden: 激活但被更高优先级 intent 覆盖（仅 overrideSignal 配置过的 chip）
 * - reason:     chip 高亮时 reason 函数输出（带具体数值）
 * - title:      自动组合的 tooltip 文本（reason 或 override 提示），未激活时为 null
 *
 * @param {object} ctx selectReducerInputs(game) 返回值
 * @param {{intent: string, overrides: Set}} intentResolved resolveIntent 返回值
 * @returns {Array<object>}
 */
export function deriveChipsFromCtx(ctx, intentResolved) {
    return CHIP_DEFS.map((def) => {
        let on = false;
        try { on = !!def.on(ctx); } catch { on = false; }
        const overridden = on && def.overrideSignal
            ? isSignalOverridden(def.overrideSignal, intentResolved)
            : false;
        let reasonText = null;
        if (on && typeof def.reason === 'function') {
            try { reasonText = def.reason(ctx); } catch { reasonText = null; }
        }
        let title = null;
        if (overridden) {
            title = `${CHIP_OVERRIDE_TITLE}（${intentResolved?.intent}）`
                + (reasonText ? `\n触发源：${reasonText}` : '');
        } else if (on && reasonText) {
            title = `触发源：${reasonText}`;
        } else if (on) {
            title = def.label; // 兜底：至少有 label 不是 null
        }
        return {
            id: def.id,
            label: def.label,
            kind: def.kind,
            on,
            overridden,
            reason: reasonText,
            title,
        };
    });
}

/**
 * 不依赖 game 实例，从已有 insight + profile 构造 chip 派生上下文（v1.58.3 DFV 用）。
 *
 * 与 selectReducerInputs(game) 的 ctx 字段子集对齐——仅暴露 chip on 函数需要的字段。
 *
 * @param {object} insight game._lastAdaptiveInsight
 * @param {object} profile game.playerProfile
 * @returns {object}
 */
export function buildChipCtxFromInsight(insight, profile) {
    if (!insight) return { intentInputs: null, distress: null, breakdown: null, hints: null };
    const layer1 = insight.spawnDiagnostics?.layer1 ?? {};
    return {
        intentInputs: insight._intentInputs ?? null,
        distress: {
            sessionPhase: insight.sessionPhase ?? profile?.sessionPhase,
            momentum: insight.momentum ?? profile?.momentum,
            frustrationLevel: insight.frustration ?? insight.frustrationLevel ?? profile?.frustrationLevel ?? 0,
            boardFill: Number.isFinite(layer1.fill) ? layer1.fill : Number(insight.boardFill) || 0,
            flowState: profile?.flowState ?? null,
        },
        breakdown: insight.stressBreakdown ?? {},
        hints: insight.spawnHints ?? {},
        afkEngageActive: !!insight.afkEngageActive,
        scoreMilestoneHit: !!insight.scoreMilestoneHit,
        personalizationApplied: !!insight.personalizationApplied,
        onboarding: !!profile?.isInOnboarding,
    };
}

function emptyModel() {
    return {
        liveGeometry: { fill: 0, holes: 0, nearFullLines: 0, multiClearCandidates: 0, pcSetup: 0 },
        liveBoardFill: 0,
        liveClearRate: 0,
        liveMissRate: 0,
        intent: { intent: 'maintain', trace: [], overrides: new Set() },
        intentLabel: SPAWN_INTENT_LABEL.maintain,
        intentColor: SPAWN_INTENT_COLOR.maintain,
        intentTraceText: 'no-game',
        narrative: { text: null, contractId: null, trace: [] },
        emoji: null,
        emojiTrace: [],
        chips: CHIP_DEFS.map((d) => ({ id: d.id, label: d.label, kind: d.kind, on: false, overridden: false, reason: null, title: null })),
        conflicts: [],
        rawInsight: null,
        rawProfile: null,
        rawCtx: null,
    };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  v1.58 暴露的派生层公共 API（UI 应优先使用这些）                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

export {
    selectLiveBoardFill,
    selectLiveClearRate,
    selectLiveMissRate,
    selectLiveGeometry,
    selectInsightWithLiveGeometry,
    selectReducerInputs,
    selectProfileForPresentation,
    resolveIntent,
    formatIntentTrace,
    isSignalOverridden,
    selectNarrative,
    selectEmoji,
};
