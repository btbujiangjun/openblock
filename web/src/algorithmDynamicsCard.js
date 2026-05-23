/**
 * 算法决策动态卡片（Algorithm Dynamics Card） — v1.59
 *
 * 设计目标：把"出块算法当前帧 + 近 N 轮的决策动态"做成 5 个聚合可视化模块，
 * 为改进出块算法（策划调参 / RL 训练 / Bug 复盘）提供高密度 insight。
 *
 * 与 playerInsightPanel.js 的关系：
 *   - 旧 panel 70% 服务"玩家画像"叙事（6 维能力 / lifecycle / 玩家可读 _buildWhyLines）
 *   - v1.59 拆分：本卡承载"算法决策动态"主显区，旧 panel 内容降权为可折叠次显
 *
 * 5 个子模块：
 *   §A renderDecisionSnapshotCard   当前帧出块决策核心聚合（intent + 节奏 + 触发器）
 *   §B renderIntentTimeline          最近 N 轮意图切换时间线 + stress mini bar
 *   §C renderStressBreakdownStack    stressBreakdown 正负双向堆叠条
 *   §D renderDecisionReasoningCard   决策反向链路（resolveIntent trace + hint 驱动源 + conflicts）
 *   §E renderShapeWeightsDrift       shapeWeights 算法承诺 vs 实际接收偏差柱
 *   §F renderResponseSensitivityCard 玩家信号 vs 算法响应符号一致性 + Pearson 粗估
 *
 * 真理源：
 *   - 所有 chip / intent 颜色：derivation/presentationReducer.SPAWN_INTENT_COLOR
 *   - 所有 chip on 函数：derivation/presentationReducer.deriveChipsFromCtx + buildChipCtxFromInsight
 *   - resolveIntent trace：derivation/intentResolver.resolveIntent
 *   - conflicts：derivation/presentationReducer.deriveConflicts
 *   - stress 分量 label：stressMeter.SIGNAL_LABELS / summarizeContributors
 *
 * 模块输入：
 *   - insight: game._lastAdaptiveInsight（当前帧）
 *   - profile: game.playerProfile（当前帧）
 *   - history: game._insightLiveHistory（近 N 帧快照数组）
 *
 * 模块输出：HTML string；DOM 渲染由调用方（playerInsightPanel）负责挂载。
 */

import {
    SPAWN_INTENT_COLOR,
    SPAWN_INTENT_LABEL,
    deriveChipsFromCtx,
    buildChipCtxFromInsight,
    deriveConflicts,
} from './derivation/presentationReducer.js';
import { resolveIntent } from './derivation/intentResolver.js';
import { summarizeContributors } from './stressMeter.js';

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  内部工具                                                                     */
/* ═══════════════════════════════════════════════════════════════════════════ */

function _attr(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function _fmt(v, digits = 2) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    return Number(v).toFixed(digits);
}

function _signedFmt(v, digits = 2) {
    if (v == null || !Number.isFinite(Number(v))) return '—';
    const n = Number(v);
    return (n >= 0 ? '+' : '') + n.toFixed(digits);
}

function _intentColor(intent) {
    return SPAWN_INTENT_COLOR[intent] || '#94a3b8';
}

function _intentLabel(intent) {
    return SPAWN_INTENT_LABEL[intent] || intent || '—';
}

export function renderExperienceBudgetCard(insight) {
    const budget = insight?.spawnDiagnostics?.layer2?.experienceBudget;
    const diag = insight?.spawnDiagnostics || {};
    if (!budget) {
        return '';
    }
    const items = [
        ['survival', '保活', '#22d3ee', 'survival 保活预算：越高越偏向首步自由度、可解性、低空洞。'],
        ['payoff', '奖励', '#fcd34d', 'payoff 奖励预算：越高越偏向消行、多消、清屏、同花顺机会。'],
        ['pressure', '压力', '#fb923c', 'pressure 压力预算：越高越偏向复杂形状、顺序刚性、空间压力。'],
        ['novelty', '新鲜', '#a78bfa', 'novelty 新鲜预算：越高越偏向品类变化、避免重复、趣味变化。'],
    ];
    const rows = items.map(([key, label, color, tip]) => {
        const v = Math.max(0, Math.min(1, Number(budget[key]) || 0));
        return `<div class="adc-budget-cell" title="${_attr(`${tip}\n当前值 ${_fmt(v)}：${_budgetLevelText(v)}`)}">
            <span class="adc-budget-label">${label}</span>
            <span class="adc-budget-bar"><i style="width:${(v * 100).toFixed(1)}%;background:${color}"></i></span>
            <b>${_fmt(v)}</b>
        </div>`;
    }).join('');
    const meta = [
        `模式 ${diag.experimentMode || 'rule'}`,
        `扫 ${diag.evaluatedTriplets ?? 0}`,
        `深评 ${diag.deepEvaluatedTriplets ?? 0}`,
    ];
    if (Number.isFinite(Number(budget.personalizationStrength))) meta.push(`个性 ${_fmt(budget.personalizationStrength)}`);
    if (Number.isFinite(Number(budget.surpriseBudget))) meta.push(`惊喜 ${_fmt(budget.surpriseBudget)}`);
    return `
        <div class="adc-budget">
            <div class="adc-budget-head" title="${_attr('P2 体验预算：把出块意图压缩为保活/奖励/压力/新鲜四个连续目标，候选三块按预算加权评分。')}">预算 <span>${meta.join(' · ')}</span></div>
            ${rows}
        </div>
    `;
}

export function renderPbAndPersonalizationCard(insight, profile) {
    if (!insight && !profile) return '';
    const best = Number(insight?.bestScore ?? insight?.spawnContext?.bestScore ?? 0);
    const score = Number(insight?.score ?? 0);
    const ratio = best > 0 ? score / best : null;
    const pre = ratio == null ? 0 : 1 / (1 + Math.exp(-((ratio - 0.82) / 0.08)));
    const post = ratio == null ? 0 : 1 / (1 + Math.exp(-((ratio - 1.05) / 0.06)));
    const release = insight?.spawnHints?.postPbReleaseActive ? 1 : 0;
    const pref = _derivePreference(profile, insight);
    const pbRows = [
        ['张力', pre, '#fb923c', 'PB前张力：越接近个人最佳，压力按 S 曲线逐步上升。'],
        ['刹车', post, '#ef4444', 'PB后刹车：突破个人最佳后，压力快速上扬以抑制分数膨胀。'],
        ['释放', release, '#22d3ee', '突破释放：刚破 PB 后短暂降压，让玩家获得庆祝和延展空间。'],
    ].map(([label, v, color, tip]) => _miniBar(label, v, color, tip)).join('');
    const prefRows = [
        ['直消', pref.clearSeeker, '#fcd34d', '直消偏好：玩家倾向直接消行和即时奖励。'],
        ['连锁', pref.comboPlanner, '#f472b6', '连锁偏好：玩家倾向铺垫多消和连续消行。'],
        ['生存', pref.survivalist, '#22d3ee', '生存偏好：玩家更需要稳态机动性和安全落点。'],
        ['冒险', pref.riskTaker, '#fb923c', '冒险偏好：玩家能承受更高压力和复杂组合。'],
        ['新鲜', pref.noveltyLover, '#a78bfa', '新鲜偏好：玩家更需要形状变化和低重复感。'],
    ].map(([label, v, color, tip]) => _miniBar(label, v, color, tip)).join('');
    const ratioText = ratio == null ? 'PB 未知' : `PB ${(ratio * 100).toFixed(1)}%`;
    return `
        <div class="adc-budget adc-pb-personal">
            <div class="adc-budget-head" title="${_attr('PB 曲线：围绕个人最佳分控制压力。PB 前临近守门，PB 后防分数膨胀。')}">PB <span>${ratioText}</span></div>
            ${pbRows}
            <div class="adc-budget-head adc-budget-head--sub" title="${_attr('个性化偏好：根据玩家历史行为微调预算，只影响倾向，不绕过公平/可解性约束。')}">偏好 <span>预算微调</span></div>
            ${prefRows}
        </div>
    `;
}

function _miniBar(label, value, color, tip = '') {
    const v = Math.max(0, Math.min(1, Number(value) || 0));
    return `<div class="adc-budget-cell" title="${_attr(`${tip}\n当前值 ${_fmt(v)}：${_budgetLevelText(v)}`)}">
        <span class="adc-budget-label">${label}</span>
        <span class="adc-budget-bar"><i style="width:${(v * 100).toFixed(1)}%;background:${color}"></i></span>
        <b>${_fmt(v)}</b>
    </div>`;
}

function _budgetLevelText(v) {
    if (v >= 0.75) return '强烈主导当前决策';
    if (v >= 0.45) return '中等影响当前决策';
    if (v >= 0.18) return '轻微参与当前决策';
    return '当前影响较弱';
}

function _derivePreference(profile = {}, insight = {}) {
    const m = profile?.metrics || {};
    const playstyle = profile?.playstyle || 'balanced';
    const clearRate = Math.max(0, Math.min(1, Number(m.clearRate) || 0));
    const comboRate = Math.max(0, Math.min(1, Number(m.comboRate) || 0));
    const skill = Math.max(0, Math.min(1, Number(profile?.skillLevel) || 0.5));
    const frust = Math.max(0, Math.min(1, (Number(profile?.frustrationLevel) || 0) / 5));
    const rounds = Math.max(0, Math.min(1, Number(insight?.spawnDiagnostics?.layer3?.totalRounds || 0) / 80));
    return {
        clearSeeker: Math.max(0, Math.min(1, clearRate * 0.7 + (playstyle === 'multi_clear' ? 0.25 : 0.1))),
        comboPlanner: Math.max(0, Math.min(1, comboRate * 0.7 + (playstyle === 'combo' ? 0.25 : 0.1))),
        survivalist: Math.max(0, Math.min(1, frust * 0.45 + (1 - skill) * 0.25 + (playstyle === 'survival' ? 0.25 : 0.1))),
        riskTaker: Math.max(0, Math.min(1, skill * 0.5 + (playstyle === 'perfect_hunter' ? 0.25 : 0.05))),
        noveltyLover: Math.max(0, Math.min(1, rounds * 0.35 + (profile?.flowState === 'bored' ? 0.35 : 0.15))),
    };
}

/**
 * 从 history 数组按 spawnRoundIndex 聚合，每轮取最后一个快照（spawn 决策时刻）。
 * 返回最近 N 轮（按时间倒序的最新 N 轮）。
 *
 * @param {Array<object>} history game._insightLiveHistory
 * @param {number} N
 * @returns {Array<{round: number, ps: object}>}
 */
function _aggregateRounds(history, N = 20) {
    if (!Array.isArray(history) || history.length === 0) return [];
    const byRound = new Map();
    for (const ps of history) {
        const r = Number(ps?.spawnRound);
        if (!Number.isFinite(r)) continue;
        byRound.set(r, ps);
    }
    const rounds = [...byRound.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([round, ps]) => ({ round, ps }));
    return rounds.slice(-N);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §A renderDecisionSnapshotCard — 当前帧出块决策核心聚合                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 当前帧出块决策核心卡。聚合当前帧最关键的 6 类算法决策信号到一行 chip 集，
 * 让策划/研发一眼看到"算法当前帧在做什么 + 由什么触发"。
 *
 * 与 #insight-spawn 段的"spawn 决策快照"区别：本卡聚焦"算法侧主动决策的核心维度"
 * （intent + 节奏 + 触发器 + spawnSource），快照段聚焦"hint 字段参数表"。两者并存
 * 互补——本卡告诉你"算法选了什么模式"，快照告诉你"用了什么参数"。
 *
 * @param {object} insight game._lastAdaptiveInsight
 * @param {object} profile game.playerProfile
 * @returns {string} HTML
 */
export function renderDecisionSnapshotCard(insight, profile) {
    if (!insight) {
        return `<div class="adc-snapshot adc-snapshot--empty">开局后展示当前帧算法决策聚合</div>`;
    }
    const intent = insight.spawnHints?.spawnIntent ?? insight.spawnIntent ?? insight._spawnIntent ?? 'maintain';
    const rhythm = insight.spawnHints?.rhythmPhase ?? '—';
    const arc = insight.spawnHints?.sessionArc ?? '—';
    const delight = insight.spawnHints?.delightMode ?? insight._delightMode ?? null;
    const stress = Number(insight.stress);
    const stressNorm = Number.isFinite(insight._adaptiveStress) ? insight._adaptiveStress : stress;
    const source = insight.spawnSource || 'rule';
    const meta = insight.spawnModelMeta || null;
    const winback = !!insight.spawnHints?.winbackProtectionActive;
    const farFromPB = !!insight.spawnHints?.farFromPBBoostActive;
    const farExtreme = !!insight.spawnHints?.farExtremeBoostActive;
    const pbOvershoot = !!insight.spawnHints?.pbOvershootActive;

    const intentChip =
        `<span class="adc-intent-chip" style="--adc-intent-color:${_intentColor(intent)}" `
        + `title="${_attr(`spawnIntent=${intent} → ${_intentLabel(intent)}（与 stressMeter / DFV / displayContracts 同源）`)}">`
        + `<span class="adc-intent-chip__bullet"></span>`
        + `<strong>${intent}</strong>`
        + `<span class="adc-intent-chip__cn">${_intentLabel(intent)}</span>`
        + `</span>`;

    const sourceLabel = source === 'model-v3' ? 'V3 生成式' : 'rule 启发式';
    const sourceClass = source === 'model-v3' ? 'adc-source--model' : 'adc-source--rule';
    let sourceDetail = '';
    if (source === 'model-v3' && meta) {
        const parts = [];
        if (meta.modelVersion) parts.push(meta.modelVersion);
        if (meta.personalized != null) parts.push(meta.personalized ? '个性化' : '通用');
        if (Number.isFinite(meta.feasibleCount)) parts.push(`可行 ${meta.feasibleCount}`);
        sourceDetail = parts.length ? ` · ${parts.join(' / ')}` : '';
    } else if (source === 'rule-fallback' && meta) {
        sourceDetail = ` · 回退（${meta.fallbackReason || 'V3 不可用'}）`;
    }
    const sourceChip =
        `<span class="adc-source-chip ${sourceClass}" `
        + `title="${_attr(`spawnSource=${source}${sourceDetail}：当前帧出块由谁生成。V3 不可用时自动回退 rule。`)}">${sourceLabel}${sourceDetail}</span>`;

    /* 节奏 + 弧线 + delight 三 chip */
    const rhythmLabel = { setup: '搭建', payoff: '收获', neutral: '中性' }[rhythm] || rhythm;
    const arcLabel = { warmup: '热身', peak: '巅峰', cooldown: '收官' }[arc] || arc;
    const rhythmChip = `<span class="adc-mode-chip" title="${_attr(`rhythmPhase=${rhythm}：算法节奏相位`)}">节奏 ${rhythmLabel}</span>`;
    const arcChip = `<span class="adc-mode-chip" title="${_attr(`sessionArc=${arc}：会话弧线分段`)}">弧线 ${arcLabel}</span>`;
    const delightChip = delight
        ? `<span class="adc-mode-chip adc-mode-chip--delight" title="${_attr(`delightMode=${delight}：愉悦模式主动注入`)}">delight ${delight}</span>`
        : '';

    /* PB 触发器 chips */
    const trigChips = [];
    if (winback) trigChips.push(`<span class="adc-trig-chip adc-trig-chip--protect" title="${_attr('winbackProtectionActive=true：回流前 3 局保护包激活')}">回流保护</span>`);
    if (farExtreme) trigChips.push(`<span class="adc-trig-chip adc-trig-chip--protect" title="${_attr('farExtremeBoostActive=true：D0 极远段（pct<extremeThreshold）加强减压')}">PB 极远</span>`);
    else if (farFromPB) trigChips.push(`<span class="adc-trig-chip adc-trig-chip--protect" title="${_attr('farFromPBBoostActive=true：分数远低于 PB 时主动加多消')}">PB 远段</span>`);
    if (pbOvershoot) trigChips.push(`<span class="adc-trig-chip adc-trig-chip--press" title="${_attr('pbOvershootActive=true：score>PB 时抑制多消 + 抬大块，防分数膨胀')}">PB 超越</span>`);

    /* stress 标量 */
    const stressBar = `
        <div class="adc-stress-bar" title="${_attr(`stress=${_fmt(stress)} / norm=${_fmt(stressNorm)}（归一化 [0,1]，0=完全减压，1=硬顶）`)}">
            <div class="adc-stress-bar__track">
                <div class="adc-stress-bar__fill" style="width:${(Math.max(0, Math.min(1, stressNorm)) * 100).toFixed(1)}%"></div>
                <div class="adc-stress-bar__neutral" style="left:43.75%"></div>
            </div>
            <span class="adc-stress-bar__val"><strong>${_fmt(stressNorm)}</strong> / 1.00</span>
        </div>
    `;

    /* 4 个 forceRelief 上游诊断（用 v1.58.3 派生层 chip 表，与算法严格同源） */
    const chipCtx = buildChipCtxFromInsight(insight, profile);
    const intentResolved = insight._intentInputs
        ? resolveIntent({
            ...insight._intentInputs,
            geometry: {
                nearFullLines: insight.spawnDiagnostics?.layer1?.nearFullLines ?? 0,
                pcSetup: insight.spawnDiagnostics?.layer1?.pcSetup ?? 0,
                boardFill: insight.spawnDiagnostics?.layer1?.fill ?? 0,
            },
        })
        : { intent, overrides: new Set() };
    const chips = deriveChipsFromCtx(chipCtx, intentResolved);
    const upstreamChips = chips
        .filter((c) => ['forceRelief', 'lateCollapse', 'frustCritical', 'endSessionStress',
            'lifecycleLateAccel', 'playerDistressFloor', 'delightModeRelief'].includes(c.id))
        .map((c) => {
            const cls = c.on
                ? (c.kind === 'neg' ? 'adc-up-chip adc-up-chip--on adc-up-chip--neg' : 'adc-up-chip adc-up-chip--on adc-up-chip--neutral')
                : 'adc-up-chip';
            const title = c.title || c.label;
            return `<span class="${cls}" title="${_attr(title)}">${c.label}</span>`;
        })
        .join('');

    return `
        <div class="adc-snapshot">
            <div class="adc-snapshot__row adc-snapshot__row--primary">
                ${intentChip}
                ${sourceChip}
                ${rhythmChip}
                ${arcChip}
                ${delightChip}
                ${trigChips.join('')}
            </div>
            <div class="adc-snapshot__row adc-snapshot__row--stress">
                ${stressBar}
            </div>
            <div class="adc-snapshot__row adc-snapshot__row--upstream">
                <span class="adc-row-label" title="${_attr('forceRelief 上游 + 信号诊断 chip（与 v1.58.3 派生层 CHIP_DEFS 同源）')}">触发源</span>
                ${upstreamChips || '<span class="adc-muted">无诊断信号触发</span>'}
            </div>
        </div>
    `;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §B renderIntentTimeline — 最近 N 轮意图切换时间线                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 从 history 提取每轮的 spawnIntent / rhythmPhase / stress，渲染横向 chip 链。
 *
 * 关键设计：
 *   - 每个 chip = 一个 spawn 轮，颜色 = SPAWN_INTENT_COLOR
 *   - 意图切换点用左侧粗边框高亮，hover 显示"前→后 + 关键 breakdown 变化"
 *   - chip 链下方 mini stress sparkline 与 chip 对齐（同轮位置）
 *   - 让策划一眼看到"系统刚刚的意图节奏"（flow → relief 翻转频繁？sprint 持续多少轮？）
 *
 * @param {Array<object>} history
 * @param {number} N
 * @returns {string} HTML
 */
export function renderIntentTimeline(history, N = 20) {
    const rounds = _aggregateRounds(history, N);
    if (rounds.length === 0) {
        return `<div class="adc-timeline adc-timeline--empty">开局后逐轮记录算法意图变化</div>`;
    }
    /* 找出"切换点"：当前 round 的 intent 与上一 round 不同 */
    let prevIntent = null;
    /* v1.59.4：chip 加 intent 首字母大写简名（H/R/E/F/M/S/P），让 chip 不再"清一色青蓝看不出切换"，
     * 每个 chip 一眼可读到当前意图。切换点 chip 加 'changed' class（CSS 渲染黄色左边框 + 上扬）。 */
    const intentInitial = (intent) => {
        const s = String(intent || '?').toUpperCase();
        return s.charAt(0) || '?';
    };
    const chips = rounds.map(({ round, ps }) => {
        const intent = ps?.adaptive?.spawnHints?.spawnIntent
            ?? ps?.adaptive?.spawnIntent
            ?? ps?.adaptive?._spawnIntent ?? '—';
        const rhythm = ps?.adaptive?.spawnHints?.rhythmPhase ?? '—';
        const stress = Number(ps?.adaptive?.stress);
        const changed = prevIntent != null && prevIntent !== intent;
        const titleParts = [
            `R${round} · intent=${intent}（${_intentLabel(intent)}）`,
            `rhythm=${rhythm}`,
            `stress=${_fmt(stress)}`,
        ];
        if (changed) titleParts.push(`⚠ 上轮切换：${prevIntent} → ${intent}`);
        const cls = `adc-tl-chip adc-tl-chip--${intent}${changed ? ' adc-tl-chip--changed' : ''}`;
        const tip = _attr(titleParts.join('\n'));
        const html = `<span class="${cls}" style="--adc-intent-color:${_intentColor(intent)}" title="${tip}">`
            + `<span class="adc-tl-chip__initial">${intentInitial(intent)}</span>`
            + `<span class="adc-tl-chip__round">R${round}</span>`
            + `<span class="adc-tl-chip__bullet"></span>`
            + `</span>`;
        prevIntent = intent;
        return { html, stress, round };
    });

    /* mini stress bar：每个 chip 下方按 stress 高度填充 0..1 */
    const bars = chips.map((c) => {
        const h = Number.isFinite(c.stress) ? Math.max(0, Math.min(1, c.stress)) : 0;
        return `<div class="adc-tl-bar" style="height:${(h * 100).toFixed(0)}%" title="${_attr(`R${c.round} stress=${_fmt(c.stress)}`)}"></div>`;
    }).join('');

    /* 统计：N 轮内切换次数 + 平均 stress */
    let switches = 0;
    let prev = null;
    let sumStress = 0, nStress = 0;
    for (const r of rounds) {
        const i = r.ps?.adaptive?.spawnHints?.spawnIntent ?? r.ps?.adaptive?.spawnIntent;
        if (prev != null && prev !== i) switches++;
        prev = i;
        const s = Number(r.ps?.adaptive?.stress);
        if (Number.isFinite(s)) { sumStress += s; nStress++; }
    }
    const avgStress = nStress > 0 ? sumStress / nStress : null;
    const summary = `近 ${rounds.length} 轮：切换 ${switches} 次 · 均压 ${_fmt(avgStress)}`;

    return `
        <div class="adc-timeline">
            <div class="adc-timeline__head">
                <span class="adc-row-label">意图时间线</span>
                <span class="adc-timeline__summary" title="${_attr('意图切换频率反映自适应灵敏度。过多切换=反应过激（飘）、过少=反应迟钝（钝感）')}">${summary}</span>
            </div>
            <div class="adc-timeline__chips">${chips.map((c) => c.html).join('')}</div>
            <div class="adc-timeline__bars" title="${_attr('每柱 = 该轮 stress（高度对应 0..1）')}">${bars}</div>
        </div>
    `;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §C renderStressBreakdownStack — stressBreakdown 正负双向堆叠条               */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 把 stressBreakdown 的 17+ 项分量画成竖排排序条目列表（top-N 加压 + top-N 救济）。
 *
 * v1.59.4：从「左负-右正水平堆叠条」改造为「竖排排序条目列表」——
 *   - 历史水平堆叠：在窄栏（DFV 右栏 260px）下 7-8 个 seg 平均分宽，label 全被
 *     ellipsis 吃掉，只看见"平滑器 -0.24" 一个能完整显示的 seg。
 *   - 竖排条目列表：每行 1 个分量，label 完整可见 + 横向 bar（宽度 ∝ |value|）
 *     + 数值右对齐，可读性远超水平堆叠。
 *   - 默认 top-4 加压 + top-4 救济（共 ≤8 行，约 14*8=112px），覆盖 95%+ 贡献量；
 *     其余合并为 "其他 N 项 ±X.XX" 一行展示。
 *   - 顶部 summary 保留 |sumNeg|/net/sumPos 三标签；net ≠ stress 时给 ⚠ 警告。
 *
 * 这是改进出块算法的核心 insight：能直接看到"压力链路是否在按预期协作"。
 *
 * @param {object} insight
 * @param {number} [topN=4] 加压/救济各 top-N 条目
 * @returns {string} HTML
 */
export function renderStressBreakdownStack(insight, topN = 4) {
    const sb = insight?.stressBreakdown;
    if (!sb || typeof sb !== 'object') {
        return `<div class="adc-stack adc-stack--empty">开局后展示 stress 分量正负贡献</div>`;
    }
    /* 复用 summarizeContributors 的 skip 集合（已过滤 boardRisk / rawStress 等非分量字段） */
    const allContribs = summarizeContributors(sb, 999); // 全量
    if (allContribs.length === 0) {
        return `<div class="adc-stack adc-stack--empty">本帧无 stress 分量贡献</div>`;
    }
    const pos = allContribs.filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
    const neg = allContribs.filter((c) => c.value < 0).sort((a, b) => a.value - b.value);
    const sumPos = pos.reduce((s, c) => s + c.value, 0);
    const sumNegAbs = neg.reduce((s, c) => s + Math.abs(c.value), 0);
    const net = sumPos - sumNegAbs;
    const stress = Number(insight.stress);
    const matchHint = Number.isFinite(stress) && Math.abs(net - stress) > 0.10
        ? `\n⚠ net (${_fmt(net)}) 与 stress (${_fmt(stress)}) 差距 > 0.10 = clamp/平滑/封顶被踩到`
        : '';

    /* bar 宽度归一化到 max(|max_pos|, |max_neg|)，让最强项占满 bar 区，其他按比例缩 */
    const maxAbs = Math.max(
        pos.length > 0 ? pos[0].value : 0,
        neg.length > 0 ? Math.abs(neg[0].value) : 0,
        0.01,
    );

    const renderItem = (c, side) => {
        const w = (Math.abs(c.value) / maxAbs) * 100;
        const tip = `${c.label} ${_signedFmt(c.value, 3)}：${c.hint || ''}\n（key: ${c.key}）`;
        return `<div class="adc-stack-item adc-stack-item--${side}" title="${_attr(tip)}">`
            + `<span class="adc-stack-item__label">${c.label}</span>`
            + `<span class="adc-stack-item__bar"><span class="adc-stack-item__bar-fill adc-stack-item__bar-fill--${side}" style="width:${w.toFixed(1)}%"></span></span>`
            + `<span class="adc-stack-item__val adc-stack-item__val--${side}">${_signedFmt(c.value, 2)}</span>`
            + `</div>`;
    };

    const renderRest = (rest, side) => {
        if (rest.length === 0) return '';
        const restSum = rest.reduce((s, c) => s + c.value, 0);
        const label = `其他 ${rest.length} 项`;
        const tip = rest.map((c) => `${c.label} ${_signedFmt(c.value, 3)}`).join('\n');
        return `<div class="adc-stack-item adc-stack-item--${side} adc-stack-item--rest" title="${_attr(tip)}">`
            + `<span class="adc-stack-item__label adc-stack-item__label--muted">${label}</span>`
            + `<span class="adc-stack-item__bar"></span>`
            + `<span class="adc-stack-item__val adc-stack-item__val--${side}">${_signedFmt(restSum, 2)}</span>`
            + `</div>`;
    };

    const posTop = pos.slice(0, topN);
    const posRest = pos.slice(topN);
    const negTop = neg.slice(0, topN);
    const negRest = neg.slice(topN);

    const posBlock = posTop.length > 0
        ? `<div class="adc-stack-block adc-stack-block--pos">`
            + `<div class="adc-stack-block__head">加压（top ${posTop.length}）<span class="adc-stack-block__sum">+${_fmt(sumPos)}</span></div>`
            + posTop.map((c) => renderItem(c, 'pos')).join('')
            + renderRest(posRest, 'pos')
            + `</div>`
        : `<div class="adc-stack-block adc-stack-block--pos"><div class="adc-stack-block__head">加压<span class="adc-stack-block__sum">+0.00</span></div><div class="adc-muted">无加压分量</div></div>`;

    const negBlock = negTop.length > 0
        ? `<div class="adc-stack-block adc-stack-block--neg">`
            + `<div class="adc-stack-block__head">救济（top ${negTop.length}）<span class="adc-stack-block__sum">−${_fmt(sumNegAbs)}</span></div>`
            + negTop.map((c) => renderItem(c, 'neg')).join('')
            + renderRest(negRest, 'neg')
            + `</div>`
        : `<div class="adc-stack-block adc-stack-block--neg"><div class="adc-stack-block__head">救济<span class="adc-stack-block__sum">−0.00</span></div><div class="adc-muted">无救济分量</div></div>`;

    return `
        <div class="adc-stack" title="${_attr(`sumPos=${_fmt(sumPos)} / |sumNeg|=${_fmt(sumNegAbs)} / net=${_fmt(net)} / stress=${_fmt(stress)}${matchHint}`)}">
            <div class="adc-stack__head">
                <span class="adc-row-label">压力归因</span>
                <span class="adc-stack__summary">
                    <span class="adc-stack__sum adc-stack__sum--net" title="净 = 加压 − 救济（≈ stress；差距大表示 clamp/平滑/封顶被踩到）">net ${_signedFmt(net)}</span>
                </span>
            </div>
            <div class="adc-stack__cols">
                ${posBlock}
                ${negBlock}
            </div>
        </div>
    `;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §D renderDecisionReasoningCard — 决策反向链路                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 把"为什么算法选了当前 intent + 这些 hint 字段"用三个段落显式可视化：
 *   1. 意图决策路径：resolveIntent 试过哪些规则、谁胜出、未命中规则失败原因
 *   2. hint 字段驱动源：每个非默认值 hint 字段后面跟"← 由 XXX 信号 / 上游驱动"
 *   3. ⚠ 跨维度冲突：v1.58.3 派生的 conflicts 数组
 *
 * @param {object} insight
 * @param {object} profile
 * @returns {string} HTML
 */
export function renderDecisionReasoningCard(insight, profile) {
    if (!insight?._intentInputs) {
        return `<div class="adc-reasoning adc-reasoning--empty">需要 _intentInputs（v1.57.4+）才能显示决策路径</div>`;
    }
    const intentInputs = insight._intentInputs;
    const geometry = {
        nearFullLines: insight.spawnDiagnostics?.layer1?.nearFullLines ?? 0,
        pcSetup: insight.spawnDiagnostics?.layer1?.pcSetup ?? 0,
        boardFill: insight.spawnDiagnostics?.layer1?.fill ?? 0,
    };
    const resolved = resolveIntent({ ...intentInputs, geometry });
    const trace = resolved.trace || [];

    /* §1 意图决策路径 */
    const pathHtml = trace.map((t) => {
        const cls = t.hit ? 'adc-trace-row adc-trace-row--hit' : 'adc-trace-row adc-trace-row--miss';
        const winnerMark = t.id === resolved.intent ? ' 🏆' : '';
        const reasonHtml = t.hit
            ? `<span class="adc-trace-reason">${_attr(t.reason || '')}</span>`
            : `<span class="adc-trace-reason adc-trace-reason--miss" title="${_attr('guard 未通过')}">未通过 guard</span>`;
        return `<div class="${cls}" title="${_attr(`优先级 ${t.priority}`)}">`
            + `<span class="adc-trace-id">${t.id}${winnerMark}</span>`
            + `<span class="adc-trace-prio">P${t.priority}</span>`
            + reasonHtml
            + `</div>`;
    }).join('');

    /* §2 hint 字段驱动源 */
    const h = insight.spawnHints || {};
    const sb = insight.stressBreakdown || {};
    const drivers = [];

    if ((h.clearGuarantee ?? 1) >= 2) {
        const reasons = [];
        if (Number(intentInputs.frustrationLevel) >= 4) reasons.push(`frustration=${intentInputs.frustrationLevel} ≥ 4`);
        if (Number(sb.boardRiskReliefAdjust) < -0.05) reasons.push(`boardRisk救济=${_fmt(sb.boardRiskReliefAdjust, 3)}`);
        if (Number(sb.frustrationRelief) < -0.05) reasons.push(`frustration救济=${_fmt(sb.frustrationRelief, 3)}`);
        if (profile?.isInOnboarding) reasons.push('isInOnboarding=true');
        drivers.push({
            field: 'clearGuarantee',
            value: h.clearGuarantee,
            drivers: reasons.length ? reasons : ['未识别明确驱动源（可能由 stress 区间通用调整）'],
        });
    }
    if (Math.abs(h.sizePreference ?? 0) >= 0.15) {
        const reasons = [];
        if (Number(h.sizePreference) < 0) {
            if (Number(sb.recoveryAdjust) < -0.05) reasons.push(`recovery=${_fmt(sb.recoveryAdjust, 3)}`);
            if (Number(sb.frustrationRelief) < -0.05) reasons.push(`frustration救济=${_fmt(sb.frustrationRelief, 3)}`);
            if (profile?.isInOnboarding) reasons.push('isInOnboarding（偏小块）');
        } else {
            if (Number(sb.challengeBoost) > 0.05) reasons.push(`challengeBoost=${_fmt(sb.challengeBoost, 3)}`);
            if (resolved.intent === 'sprint') reasons.push('sprint 中间档 +0.10');
        }
        drivers.push({
            field: 'sizePreference',
            value: h.sizePreference,
            drivers: reasons.length ? reasons : ['未识别明确驱动源'],
        });
    }
    if ((h.multiClearBonus ?? 0) >= 0.30) {
        const reasons = [];
        if (h.farFromPBBoostActive) reasons.push('farFromPB（PB 远段加多消）');
        if (h.farExtremeBoostActive) reasons.push('farExtreme（D0 极远段额外加多消）');
        if (h.rhythmPhase === 'payoff') reasons.push('rhythmPhase=payoff');
        if (resolved.intent === 'sprint') reasons.push('sprint 中间档 floor=0.40');
        if (geometry.nearFullLines >= 2) reasons.push(`nearFullLines=${geometry.nearFullLines} ≥ 2（密集临消）`);
        drivers.push({
            field: 'multiClearBonus',
            value: h.multiClearBonus,
            drivers: reasons.length ? reasons : ['未识别明确驱动源'],
        });
    }
    if ((h.orderRigor ?? 0) >= 0.30) {
        const reasons = [];
        if (Number(insight.stress) >= 0.85) reasons.push(`stress=${_fmt(insight.stress)} ≥ 0.85 高压顺序刚性`);
        if (h.pbOvershootActive) reasons.push('pbOvershoot（D4 强顺序锁）');
        drivers.push({
            field: 'orderRigor',
            value: h.orderRigor,
            drivers: reasons.length ? reasons : ['未识别明确驱动源'],
        });
    }
    if (h.delightMode) {
        drivers.push({
            field: 'delightMode',
            value: h.delightMode,
            drivers: ['delight 模块主动注入（与 spawnIntent 联动）'],
        });
    }

    const driversHtml = drivers.length === 0
        ? `<span class="adc-muted">本帧 hint 全部为默认值（无明显驱动信号）</span>`
        : drivers.map((d) => {
            const valStr = typeof d.value === 'number' ? _fmt(d.value, 2) : String(d.value);
            return `<div class="adc-driver-row">`
                + `<span class="adc-driver-field">${d.field}=<strong>${valStr}</strong></span>`
                + `<span class="adc-driver-arrow">←</span>`
                + `<span class="adc-driver-source">${d.drivers.map(_attr).join(' · ')}</span>`
                + `</div>`;
        }).join('');

    /* §3 跨维度冲突 */
    const chipCtx = buildChipCtxFromInsight(insight, profile);
    const conflicts = deriveConflicts(chipCtx, resolved);
    const conflictsHtml = conflicts.length === 0
        ? ''
        : `<div class="adc-conflicts">`
        + conflicts.map((c) => `<div class="adc-conflict-row adc-conflict-row--${c.severity}" title="${_attr(c.tip)}">⚠ ${c.id}：${_attr(c.tip.length > 80 ? c.tip.slice(0, 80) + '…' : c.tip)}</div>`).join('')
        + `</div>`;

    return `
        <div class="adc-reasoning">
            <div class="adc-reasoning__sec">
                <div class="adc-row-label" title="${_attr('resolveIntent 表驱动优先级矩阵，命中规则即胜出（与 derivation/intentResolver.INTENT_RULES 同源）')}">意图决策路径</div>
                <div class="adc-trace">${pathHtml}</div>
            </div>
            <div class="adc-reasoning__sec">
                <div class="adc-row-label" title="${_attr('每个非默认 hint 字段后面跟"← 驱动源"——让策划/RL 直接看到"算法这次为什么这样配参"')}">hint 字段驱动源</div>
                <div class="adc-drivers">${driversHtml}</div>
            </div>
            ${conflictsHtml ? `<div class="adc-reasoning__sec"><div class="adc-row-label" title="${_attr('v1.58.3 派生层跨维度信号冲突')}">跨维度冲突</div>${conflictsHtml}</div>` : ''}
        </div>
    `;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §E renderShapeWeightsDrift — 算法承诺 vs 实际接收偏差柱                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

const _CAT_LABEL = {
    lines: '长条', rects: '矩形', squares: '方形',
    tshapes: 'T 形', zshapes: 'Z 形', lshapes: 'L 形', jshapes: 'J 形',
};

/**
 * shapeWeights 算法承诺 vs 玩家实际接收偏差柱。
 *
 * - 算法承诺：当前帧 insight.shapeWeightsTop（normalize 到比例）
 * - 实际接收：从近 N 轮 history 中的 dockCategories 字段（v1.59 新增采集）累加各 category 计数
 * - 偏差 ε = 实际 − 承诺；正值 = 实际超出承诺（抽样器偏多）；负 = 实际不足
 *
 * 这是给 RL/数据工程师看的核心 insight：**算法的抽样意图是否真的被执行了**。
 * 偏差 |ε| > 0.05 持续多轮 = 抽样器实现 bug 或权重表配置漂移。
 *
 * @param {object} insight
 * @param {Array<object>} history
 * @param {number} N 实际接收的回溯窗口
 * @returns {string} HTML
 */
export function renderShapeWeightsDrift(insight, history, N = 10) {
    const promised = Array.isArray(insight?.shapeWeightsTop) ? insight.shapeWeightsTop : [];
    if (promised.length === 0) {
        return `<div class="adc-drift adc-drift--empty">开局后展示算法承诺 vs 实际接收偏差</div>`;
    }
    /* 归一化承诺权重为比例 */
    const promisedSum = promised.reduce((s, w) => s + Math.max(0, Number(w.weight) || 0), 0) || 1;
    const promisedMap = new Map();
    for (const w of promised) {
        promisedMap.set(w.category, Math.max(0, Number(w.weight) || 0) / promisedSum);
    }

    /* 实际接收：从 history 取最近 N 轮的 dockCategories（每轮 spawn 时记录） */
    const rounds = _aggregateRounds(history, N);
    const actualCounts = new Map();
    let totalCount = 0;
    for (const r of rounds) {
        const cats = r.ps?.dockCategories;
        if (!Array.isArray(cats)) continue;
        for (const c of cats) {
            actualCounts.set(c, (actualCounts.get(c) || 0) + 1);
            totalCount++;
        }
    }
    const hasActual = totalCount > 0;

    /* 合并 category 列表（承诺 + 实际 union），按承诺比例降序 */
    const allCats = new Set([...promisedMap.keys(), ...actualCounts.keys()]);
    const rows = [...allCats].map((cat) => {
        const p = promisedMap.get(cat) || 0;
        const a = hasActual ? ((actualCounts.get(cat) || 0) / totalCount) : null;
        const eps = a != null ? (a - p) : null;
        return { cat, promised: p, actual: a, eps };
    }).sort((a, b) => b.promised - a.promised);

    const maxBar = Math.max(0.001, ...rows.map((r) => Math.max(r.promised, r.actual || 0)));
    const rowsHtml = rows.map((r) => {
        const label = _CAT_LABEL[r.cat] || r.cat;
        const pPct = (r.promised * 100).toFixed(1);
        const aPct = r.actual != null ? (r.actual * 100).toFixed(1) : '—';
        const epsStr = r.eps != null ? _signedFmt(r.eps, 2) : '—';
        const epsCls = r.eps == null
            ? 'adc-drift-eps--na'
            : (Math.abs(r.eps) < 0.03 ? 'adc-drift-eps--ok'
                : Math.abs(r.eps) < 0.07 ? 'adc-drift-eps--warn'
                : 'adc-drift-eps--bad');
        const pW = (r.promised / maxBar * 100).toFixed(1);
        const aW = r.actual != null ? (r.actual / maxBar * 100).toFixed(1) : '0';
        return `
            <div class="adc-drift-row" title="${_attr(`${label}：算法承诺 ${pPct}% / 实际接收 ${aPct}%（窗口 ${N} 轮 ${totalCount} 块）/ 偏差 ${epsStr}`)}">
                <span class="adc-drift-cat">${label}</span>
                <div class="adc-drift-bars">
                    <div class="adc-drift-bar adc-drift-bar--promised" style="width:${pW}%" title="${_attr('算法承诺权重')}"></div>
                    <div class="adc-drift-bar adc-drift-bar--actual" style="width:${aW}%" title="${_attr('实际接收比例')}"></div>
                </div>
                <span class="adc-drift-vals">
                    <span class="adc-drift-val adc-drift-val--p">${pPct}%</span>
                    <span class="adc-drift-vals-sep">vs</span>
                    <span class="adc-drift-val adc-drift-val--a">${aPct}%</span>
                </span>
                <span class="adc-drift-eps ${epsCls}">${epsStr}</span>
            </div>
        `;
    }).join('');

    const summary = hasActual
        ? `窗口 ${rounds.length} 轮 / ${totalCount} 块`
        : `等待 dockCategories 采集（首次出块后填实）`;

    return `
        <div class="adc-drift" title="${_attr('偏差 |ε|>0.07 持续多轮 → 抽样器实现 bug 或权重表漂移')}">
            <div class="adc-drift__head">
                <span class="adc-row-label">承诺 vs 实际</span>
                <span class="adc-drift__summary">${summary}</span>
            </div>
            <div class="adc-drift__rows">${rowsHtml}</div>
        </div>
    `;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  §F renderResponseSensitivityCard — 算法响应灵敏度                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Pearson 相关系数粗估（n>=4 时有意义）。返回 [-1, 1] 或 null（数据不足/方差为 0）。
 *
 * @param {Array<number>} xs
 * @param {Array<number>} ys
 * @returns {number|null}
 */
export function _pearson(xs, ys) {
    if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 4) return null;
    const n = xs.length;
    let sumX = 0, sumY = 0;
    for (let i = 0; i < n; i++) { sumX += xs[i]; sumY += ys[i]; }
    const mx = sumX / n, my = sumY / n;
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < n; i++) {
        const ex = xs[i] - mx;
        const ey = ys[i] - my;
        num += ex * ey;
        dx2 += ex * ex;
        dy2 += ey * ey;
    }
    const denom = Math.sqrt(dx2 * dy2);
    if (denom < 1e-9) return null;
    const r = num / denom;
    if (!Number.isFinite(r)) return null;
    return Math.max(-1, Math.min(1, r));
}

/**
 * 把 history 中最近 N 帧的"玩家信号 ΔclearRate / missRate / momentum"
 * 与"算法信号 Δstress / clearGuarantee / sizePreference"做相关性粗估。
 *
 * 输出对：
 *   - playerClearRate ⇄ algStress      （正常应负相关：玩家消行↑→算法 stress↓）
 *   - playerMissRate  ⇄ algClearGuarantee（正常应正相关：玩家失误↑→算法保消↑）
 *   - playerMomentum  ⇄ algStress       （正常应正相关：玩家动量↑→算法 stress↑加压）
 *
 * 偏离正常方向 = 算法响应延迟/反向，是改进出块算法的重要 insight。
 *
 * @param {Array<object>} history
 * @param {number} N
 * @returns {string} HTML
 */
export function renderResponseSensitivityCard(history, N = 12) {
    const tail = (Array.isArray(history) ? history : []).slice(-N);
    /* v1.59.5：minN 4→8。
     *   n=4 时 Pearson r 即便偶发 ±0.8 都不具任何置信度，等于"看心情判方向"，
     *   只会制造误报红色警告。提到 8 帧后噪声方差才进入可读区。 */
    const MIN_N = 8;
    if (tail.length < MIN_N) {
        return `<div class="adc-sens adc-sens--empty">需要 ≥${MIN_N} 帧样本（${tail.length}/${MIN_N}）才能估计响应灵敏度</div>`;
    }
    /* 提取序列 — v1.59.10 配对全重做 ——
     *
     * 旧版 3 对（v1.59.6/9）系统性缺陷：clearRate⇄clearG 是 confounder 伪反向（clearG 由
     * 30+ Math.max 路径累加，与 clearRate 无直接因果，score/combo 共变让 r=+0.50 反向红警
     * 误报）；missRate⇄clearG 高玩家段 missRate=0 持续→方差守卫触发；momentum⇄救济仅
     * cooldown/late 触发→peak 阶段恒 0。
     *
     * 重做思路：审视 adaptiveSpawn.js 所有 stressBreakdown 分量的驱动方程，挑出**单一
     * 玩家信号的纯响应**分量（无 score 共变、无聚合累加）作为 y，配对该信号 x。
     * 仅 3 个分量满足：
     *   - skillAdjust       L951: (skill-0.5)×0.3×confGate          全线性纯响应
     *   - frustRelief       L974: frust≥4 → -0.18 阶跃              阈值纯响应
     *   - sessionArc+endDistress L1000-1015: momentum<-0.2 → 减压   阈值纯响应
     * 详见本文件下方 pairs 数组。 */
    const playerSkill = tail.map((s) => Number(s?.skill)).filter(Number.isFinite);
    const playerFrust = tail.map((s) => Number(s?.frustration ?? s?.frust)).filter(Number.isFinite);
    const playerMomentum = tail.map((s) => Number(s?.momentum)).filter(Number.isFinite);
    const algSkillAdjust = tail
        .map((s) => Number(s?.adaptive?.stressBreakdown?.skillAdjust ?? 0))
        .filter((v) => Number.isFinite(v));
    const algFrustRelief = tail
        .map((s) => Number(s?.adaptive?.stressBreakdown?.frustrationRelief ?? 0))
        .filter((v) => Number.isFinite(v));
    const algMomentumRelief = tail
        .map((s) => Number(s?.adaptive?.stressBreakdown?.sessionArcAdjust ?? 0)
                  + Number(s?.adaptive?.stressBreakdown?.endSessionDistress ?? 0))
        .filter((v) => Number.isFinite(v));

    /* 三对相关性（必须等长才能算；这里按 min 长度对齐 tail 末段） */
    const _alignTail = (a, b) => {
        const n = Math.min(a.length, b.length);
        return [a.slice(-n), b.slice(-n)];
    };
    const _variance = (xs) => {
        if (xs.length < 2) return 0;
        const m = xs.reduce((s, v) => s + v, 0) / xs.length;
        return xs.reduce((s, v) => s + (v - m) ** 2, 0) / xs.length;
    };

    /* v1.59.10 3 对配对全重做（机制纯净度优先）——
     *
     * 弃用 v1.59.6/9 的 3 对原因：clearRate⇄clearG 是 confounder 伪反向（clearG 由 30+ 路径
     * 累加，与 clearRate 无直接因果链）；missRate⇄clearG 高玩家段 missRate 恒为 0；
     * momentum⇄救济仅 cooldown/late 触发，peak/early 永远无数据。
     *
     * 新 3 对选自 adaptiveSpawn.js 唯一的"单一玩家信号纯响应"分量：
     *   - skillAdjust   (L951)     全线性: (skill-0.5)×0.3×confGate    机制最纯
     *   - frustRelief   (L974)     阈值:   frust≥4 → -0.18
     *   - 救济通道       (L1000-1015) 阈值:   momentum<-0.2 → 减压（v1.59.9 复用） */
    const pairs = [
        {
            id: 'skillVsSkillAdjust',
            label: 'skill ⇄ skillAdjust',
            expected: 'pos',
            x: playerSkill, y: algSkillAdjust,
            expHint: '算法对高手是否在加压？\n机制：skillAdjust = (skill-0.5)×0.3×confGate（adaptiveSpawn.js L951）。skill>0.5 → skillAdjust>0 加压；skill<0.5 → <0 减压。**唯一全线性纯响应分量**，无任何 score/clearRate 共变干扰。\n期望：正相关（玩家技能↑ → 算法加压↑）；强负相关 = 算法对高手反向减压（异常）。',
        },
        {
            id: 'frustVsFrustRelief',
            label: 'frust ⇄ frustRelief',
            expected: 'neg',
            x: playerFrust, y: algFrustRelief,
            expHint: '算法对挫败玩家是否在救济？\n机制：frustRelief = (frustLevel≥4 ? -0.18 : 0)（adaptiveSpawn.js L974）。阶跃响应，frust 整数 0-8。\n期望：负相关（玩家挫败↑ → 算法减压救济，frustRelief↓）；正相关 = 算法对挫败玩家反向加压（异常）。',
        },
        {
            id: 'momentumVsRelief',
            label: 'momentum ⇄ 救济',
            expected: 'pos',
            x: playerMomentum, y: algMomentumRelief,
            expHint: '算法对动量崩盘玩家是否在救济？\n机制：救济通道 = sessionArcAdjust + endSessionDistress（adaptiveSpawn.js L1000-1015）。仅 cooldown+momentum<-0.2 或 late+momentum≤-0.30 触发。\n期望：正相关（玩家动量↑→救济通道接近 0；动量崩盘↓→救济通道更负）；peak/early 阶段救济=0 属正常（"算法这项无调整"）。',
        },
    ];

    /* v1.59.5：判定三档阈值——
     *   - WEAK_R (0.30)：弱相关阈，|r| < WEAK_R 全部判"迟钝"
     *   - STRONG_R (0.50)：强相关阈，仅 |r| ≥ STRONG_R 才出"灵敏/反向"红绿断言
     *   - 中间档 [WEAK_R, STRONG_R)：方向倾向（灰/绿弱），不报红色"请查算法"
     *   - 方差 < VAR_FLAT (1e-5)：信号几乎恒定，Pearson 不稳定，直接判"信号稳定"
     * 这套阈值与 n=8~12 下 Pearson 双侧 5% 显著阈 (n=8≈0.71, n=12≈0.576) 之间留有余地，
     * 避免噪声/共变误报红色"建议查算法"。 */
    const WEAK_R = 0.30;
    const STRONG_R = 0.50;
    const VAR_FLAT = 1e-5;

    /* v1.59.8 verdict 文案口语化——
     *   旧文案"信号稳定，无法测算"/"反向倾向 r=0.30（弱信号，多为窗口噪声/上游共变）"
     *   读起来像统计学术语，玩家/策划秒看不懂。新文案按"6 档"统一为短句 + 符号：
     *     ⏳ 数据攒中 N/8           样本不足
     *     · 玩家无变化              数据方差为 0（玩家这项指标本窗口不变）
     *     · 算法无调整              算法响应方差为 0（算法这一档没变）
     *     · 关联弱（迟钝）          |r| < WEAK_R
     *     ✓ 方向对（弱）            WEAK_R ≤ |r| < STRONG_R 且 sign 匹配
     *     ~ 方向反（弱）            WEAK_R ≤ |r| < STRONG_R 且 sign 不匹配（不报红，"~"中性）
     *     ✓✓ 灵敏                  |r| ≥ STRONG_R 且 sign 匹配
     *     ⚠ 反向，请查算法          |r| ≥ STRONG_R 且 sign 不匹配（仅此一档才报红） */
    const rowsHtml = pairs.map((p) => {
        const [xa, ya] = _alignTail(p.x, p.y);
        const r = _pearson(xa, ya);
        const varX = _variance(xa);
        const varY = _variance(ya);
        let verdict = 'idle';
        let verdictLabel = `⏳ 数据攒中 ${xa.length}/${MIN_N}`;
        let cls = 'adc-sens-row--idle';

        if (xa.length < MIN_N) {
            // 某对单独样本不足（filter NaN 后）→ idle
        } else if (varX < VAR_FLAT) {
            verdict = 'dull';
            verdictLabel = '· 玩家这项无变化';
            cls = 'adc-sens-row--dull';
        } else if (varY < VAR_FLAT) {
            verdict = 'dull';
            verdictLabel = '· 算法这项无调整';
            cls = 'adc-sens-row--dull';
        } else if (r != null) {
            const absR = Math.abs(r);
            const sign = r > 0 ? 'pos' : 'neg';
            const matchExpected = sign === p.expected;
            const rStr = r.toFixed(2);
            if (absR < WEAK_R) {
                verdict = 'dull';
                verdictLabel = `· 关联弱（迟钝）`;
                cls = 'adc-sens-row--dull';
            } else if (absR >= STRONG_R) {
                if (matchExpected) {
                    verdict = 'good';
                    verdictLabel = `✓✓ 灵敏 r=${rStr}`;
                    cls = 'adc-sens-row--good';
                } else {
                    verdict = 'bad';
                    verdictLabel = `⚠ 反向 r=${rStr}，请查算法`;
                    cls = 'adc-sens-row--bad';
                }
            } else {
                if (matchExpected) {
                    verdict = 'good';
                    verdictLabel = `✓ 方向对（弱 r=${rStr}）`;
                    cls = 'adc-sens-row--good';
                } else {
                    verdict = 'dull';
                    verdictLabel = `~ 方向反（弱 r=${rStr}，多为噪声）`;
                    cls = 'adc-sens-row--dull';
                }
            }
        }
        const rStr = r != null ? r.toFixed(2) : '—';
        return `
            <div class="adc-sens-row ${cls}" title="${_attr(p.expHint + '\nn=' + xa.length + ' / var_x=' + varX.toExponential(2) + ' / var_y=' + varY.toExponential(2))}">
                <span class="adc-sens-pair">${p.label}</span>
                <span class="adc-sens-r" title="${_attr(`Pearson r = ${rStr}（n=${xa.length}）\n阈值：|r|<${WEAK_R} 迟钝 / [${WEAK_R},${STRONG_R}) 倾向 / ≥${STRONG_R} 强信号`)}">r=${rStr}</span>
                <span class="adc-sens-verdict adc-sens-verdict--${verdict}">${verdictLabel}</span>
            </div>
        `;
    }).join('');

    return `
        <div class="adc-sens">
            <div class="adc-sens__head">
                <span class="adc-row-label" title="${_attr('近 N 帧玩家信号与算法响应的 Pearson 相关性粗估，n=' + tail.length)}">响应灵敏度<span class="adc-sens__subtitle">算法是否在跟着玩家变？</span></span>
                <span class="adc-sens__hint">窗口 ${tail.length} 帧</span>
            </div>
            <div class="adc-sens__rows">${rowsHtml}</div>
        </div>
    `;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  入口：renderAlgorithmDynamicsCard — 聚合 5 个子模块                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 算法决策动态卡片主入口。返回完整 HTML 字符串，由调用方挂载到 DOM。
 *
 * @param {object} model 输入模型
 * @param {object} model.insight  game._lastAdaptiveInsight
 * @param {object} model.profile  game.playerProfile
 * @param {Array<object>} model.history game._insightLiveHistory
 * @param {object} [opts]
 * @param {number} [opts.timelineN=20] 意图时间线回溯轮数
 * @param {number} [opts.driftN=10]    shape weights 偏差柱回溯轮数
 * @param {number} [opts.sensN=12]     响应灵敏度回溯帧数
 * @returns {string} HTML
 */
export function renderAlgorithmDynamicsCard(model, opts = {}) {
    const { insight, profile, history } = model || {};
    const timelineN = opts.timelineN ?? 20;
    const driftN = opts.driftN ?? 10;
    const sensN = opts.sensN ?? 12;
    return `
        <div class="algo-dynamics-card">
            <div class="adc-section adc-section--snapshot">
                ${renderDecisionSnapshotCard(insight, profile)}
            </div>
            <div class="adc-section adc-section--timeline">
                ${renderIntentTimeline(history, timelineN)}
            </div>
            <div class="adc-section adc-section--stack">
                ${renderStressBreakdownStack(insight)}
            </div>
            <div class="adc-section adc-section--reasoning">
                ${renderDecisionReasoningCard(insight, profile)}
            </div>
            <div class="adc-section adc-section--drift">
                ${renderShapeWeightsDrift(insight, history, driftN)}
            </div>
            <div class="adc-section adc-section--sens">
                ${renderResponseSensitivityCard(history, sensN)}
            </div>
        </div>
    `;
}
