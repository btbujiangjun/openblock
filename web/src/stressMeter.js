/**
 * stressMeter.js — 拟人化压力表
 *
 * 把出块算法的核心信号 `stress`（约 −0.2 ~ 1）转译成玩家可感知的「情绪状态」：
 *   1. **面谱头像**：emoji 反映当下情绪（放松 / 心流 / 投入 / 紧张 / 高压）
 *   2. **色带 + 呼吸**：背景色随等级渐变（蓝→绿→琥珀→红），CSS 呼吸节奏随等级加快
 *   3. **趋势箭头**：与最近 N 帧基线对比，给出 ↗ / → / ↘
 *   4. **一句话叙事**：把压力来源（盘面/失误/连胜/挫败）翻译成自然语言
 *   5. **构成详情**：折叠区列出 `stressBreakdown` 中绝对值最大的 5 项，正负分色
 *
 * 数据来源：
 *   - `insight.stress`、`insight.stressBreakdown`、`insight.spawnTargets`
 *   - `history`（最近若干帧 stress，用于计算趋势 / 速度）
 *
 * 设计取舍：
 *   - 完全只读，不 emit 事件、不维护额外缓存；上层每次 render 重新塞数据
 *   - 通过 `data-level` 属性切换主题，避免在 JS 里写 inline style 大量颜色
 *   - 呼吸 / 渐变全部用 CSS 实现，停止刷新时不会拉高 GPU 占用
 */

/**
 * 压力等级阈值（按综合 stress 经验值划分；可在调参时改）
 */
export const STRESS_LEVELS = [
    { id: 'calm',      label: '放松',     min: -Infinity, max: -0.05, face: '😌', vibe: '盘面整洁，心情舒缓。' },
    { id: 'easy',      label: '舒缓',     min: -0.05,     max: 0.20,  face: '🙂', vibe: '操作轻松，节奏从容。' },
    { id: 'flow',      label: '心流',     min: 0.20,      max: 0.45,  face: '😀', vibe: '挑战与能力匹配，正爽快。' },
    { id: 'engaged',   label: '投入',     min: 0.45,      max: 0.65,  face: '🤔', vibe: '需要思考，节奏开始拉紧。' },
    { id: 'tense',     label: '紧张',     min: 0.65,      max: 0.80,  face: '😰', vibe: '盘面吃紧，留意可消行机会。' },
    { id: 'intense',   label: '高压',     min: 0.80,      max: Infinity, face: '🥵', vibe: '高强度对局，系统会优先保活。' }
];

/**
 * 把任意 stress 数值映射到 STRESS_LEVELS 之一；超出范围按首/末档兜底。
 */
export function getStressLevel(stress) {
    if (!Number.isFinite(stress)) return STRESS_LEVELS[2];
    for (const lv of STRESS_LEVELS) {
        if (stress >= lv.min && stress < lv.max) return lv;
    }
    return STRESS_LEVELS[STRESS_LEVELS.length - 1];
}

/**
 * v1.18：被动救济变体 —— 当系统因玩家挫败/恢复信号而把 stress 压到很低时，
 * 单纯显示「😌 放松」与底下"挫败感偏高，正在主动减压"叙事并列容易让玩家
 * 误以为系统自相矛盾。这里给 calm/easy 两个低压档加一个"救济中"的变体：
 * 头像换成 🤗（被照顾），label 在原档位后追加"（救济中）"，让玩家理解
 * "我现在轻松，是因为系统正在帮我，而不是我状态本来就很好"。
 *
 * 仅在 spawnIntent === 'relief' 且实际 stress ≤ -0.05（落入 calm 档，
 * 是真正的"被压低"区间）时启用；easy 档（−0.05 ~ 0.20）已是温和挑战区，
 * "舒缓 + 主动减压"读起来不冲突，无需切变体。
 */
export function getStressDisplay(stress, spawnIntent) {
    const base = getStressLevel(stress);
    if (spawnIntent === 'relief'
        && Number.isFinite(stress)
        && stress <= -0.05
        && base.id === 'calm') {
        return {
            ...base,
            face: '🤗',
            label: `${base.label}（救济中）`,
            vibe: '系统正在为你减压：候选块更小、更友好，找一条最容易消的行先恢复节奏。'
        };
    }
    return base;
}

/**
 * 信号 key → 中文人类可读标签 / 解读语
 *
 * 与 `adaptiveSpawn.js` 中 `stressBreakdown` 的 key 一一对应。
 * 注意：保留 key 的英文形式作为 tooltip data-attr，便于策划在调参时回查。
 */
export const SIGNAL_LABELS = {
    scoreStress:           { label: '分数档',     hint: '当前分数所在档位的基线压力（高分段更紧张）' },
    runStreakStress:       { label: '连战',       hint: '连胜越久越加压，连败时减压' },
    difficultyBias:        { label: '难度模式',   hint: '玩家选的简单/普通/困难带来的整体偏移' },
    skillAdjust:           { label: '技能',       hint: '技能估计偏高时略加压、偏低时略减压' },
    flowAdjust:            { label: '心流',       hint: '心流偏移：无聊→加压、焦虑→减压' },
    pacingAdjust:          { label: '松紧',       hint: '紧张/释放期交替造成的微调（与 rhythmPhase「节奏 收获/中性/搭建」pill 不同——那是相位枚举，本项是数值偏移）' },
    recoveryAdjust:        { label: '恢复',       hint: '近一段挫败/卡顿后压低难度' },
    frustrationRelief:     { label: '挫败救济',   hint: '挫败感超阈值时的强制减压' },
    comboAdjust:           { label: '连击',       hint: 'combo 活跃时的小幅加压' },
    nearMissAdjust:        { label: '近失',       hint: '差一点就消行的局面，给予救济' },
    feedbackBias:          { label: '闭环反馈',   hint: '出块后实际表现与预期的偏差' },
    trendAdjust:           { label: '趋势',       hint: '近期消行率上升/下降的连续偏移' },
    sessionArcAdjust:      { label: '会话弧线',   hint: '热身/巅峰/收官三段的整体节奏' },
    holeReliefAdjust:      { label: '空洞救济',   hint: '盘面空洞过多时减压' },
    boardRiskReliefAdjust: { label: '盘面风险',   hint: '高填充 + 空洞 + 玩家风险的综合救济' },
    abilityRiskAdjust:     { label: '能力风险',   hint: '玩家能力风险偏高时降难度护栏' },
    delightStressAdjust:   { label: '里程碑',     hint: '接近里程碑时的甜点/挑战微调' },
    challengeBoost:        { label: 'B 类挑战',   hint: '逼近历史最佳分时的额外加压' },
    friendlyBoardRelief:   { label: '友好盘面',   hint: '盘面整洁且有兑现机会时主动减压，让你享受多消爽点' },
    flowPayoffCap:         { label: '心流上限',   hint: '心流 + 兑现期会把综合压力软封顶，避免「享受多消」与「高压」冲突' },
    occupancyDamping:      { label: '占用衰减',   hint: '盘面占用率 <50% 时按比例衰减正向 stress，避免空盘上 0.89 的伪高压' }
};

/**
 * 把 stressBreakdown 转换成「带正负方向 + 标签」的数组，按贡献绝对值排序。
 * @param {object} breakdown
 * @param {number} [topN=5]
 */
export function summarizeContributors(breakdown, topN = 5) {
    if (!breakdown || typeof breakdown !== 'object') return [];
    const skip = new Set([
        'boardRisk', 'rawStress', 'beforeClamp', 'afterClamp',
        'afterOccupancy', 'afterSmoothing', 'finalStress',
        'flowPayoffCap' // 派生标记，不是独立的加减分量
    ]);
    const entries = Object.entries(breakdown)
        .filter(([k, v]) => !skip.has(k) && Number.isFinite(v) && Math.abs(v) >= 0.005)
        .map(([k, v]) => ({
            key: k,
            value: v,
            label: SIGNAL_LABELS[k]?.label ?? k,
            hint: SIGNAL_LABELS[k]?.hint ?? '',
            sign: v >= 0 ? 'pos' : 'neg'
        }));
    entries.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    return entries.slice(0, topN);
}

/**
 * 趋势计算：当前值 vs 最近 baselineN 帧均值。
 * @returns {{ delta: number, direction: 'up'|'down'|'flat', icon: string }}
 */
export function computeTrend(history, current, baselineN = 6) {
    if (!Array.isArray(history) || history.length < 2 || !Number.isFinite(current)) {
        return { delta: 0, direction: 'flat', icon: '→' };
    }
    const slice = history.slice(-baselineN - 1, -1).filter((v) => Number.isFinite(v));
    if (slice.length === 0) return { delta: 0, direction: 'flat', icon: '→' };
    const avg = slice.reduce((s, v) => s + v, 0) / slice.length;
    const delta = current - avg;
    if (Math.abs(delta) < 0.04) return { delta, direction: 'flat', icon: '→' };
    return delta > 0
        ? { delta, direction: 'up', icon: '↗' }
        : { delta, direction: 'down', icon: '↘' };
}

/**
 * spawnIntent → 玩家可读叙事的单一映射。
 *
 * v1.16：用作 `buildStoryLine` 的最高优先级——只要 `adaptiveSpawn` 给出明确的
 * `spawnIntent`，叙事文案就直接读它，避免出现「实际给了 4 个单格泄压块、文案却说
 * 悄悄加点料维持新鲜感」之类的认知冲突。
 *
 * v1.24：`flow` 文案不再硬编码"节奏进入收获期" —— spawnIntent='flow' 既可由
 *   `delight.mode==='flow_payoff'` 触发，也可由 `rhythmPhase==='payoff'` 触发；
 *   delight.mode='flow_payoff' 在 R1 空盘 + 无 nearGeom 时也会成立，此时实际
 *   `rhythmPhase` 会 fall through 到 'setup'（v1.21 的 nearGeom mutex）。旧版硬编码
 *   "收获期"会与 pill「节奏 搭建」+ strategyAdvisor「搭建期」三方对立（截图复现）。
 *   `flow` 改为按实际 rhythmPhase 选变体；`SPAWN_INTENT_NARRATIVE.flow` 保留作兜底。
 */
export const SPAWN_INTENT_NARRATIVE = {
    relief:   '盘面通透又是兑现窗口，悄悄给你减压享受多消。',
    engage:   '注意到你停顿了一下，给你一个明显得分目标 + 友好开局。',
    pressure: '正在挑战自我！系统略加压让收尾更有仪式感。',
    flow:     '心流稳定，系统继续维持流畅的出块节奏。', // v1.24：去"收获期"硬编码，作 rhythmPhase 缺失时的兜底
    harvest:  '识别到密集消行机会，正在投放促清的形状。',
    maintain: '看起来比较轻松，悄悄加点料维持新鲜感。'
};

/**
 * v1.24：`flow` 意图按实际 rhythmPhase 选变体文案，与 pill / strategyAdvisor 同口径。
 *   payoff  → 既心流又有兑现几何，可写"收获期"爽点叙事
 *   setup   → 心流稳定但还在搭建期，叙事改为"留通道、等下一波"
 *   neutral → 心流稳定但 rhythmPhase 中性，叙事用"维持出块"
 */
export const FLOW_NARRATIVE_BY_PHASE = {
    payoff:  '心流稳定，节奏进入收获期，准备享受多消快感。',
    setup:   '心流稳定，节奏稳步搭建，先留好通道等下一波兑现。',
    neutral: '心流稳定，节奏自然流畅，系统继续维持当前出块。'
};

/**
 * v1.27：高压档下的 flow 意图叙事守卫。
 * 当 stress level 已到 tense/intense 时，继续说“心流稳定”会与头像/等级冲突。
 * 这里按 level 兜底到“紧张/高压”语义，保持主标题与正文同口径。
 */
const FLOW_HIGH_STRESS_NARRATIVE_BY_LEVEL = {
    engaged: '需要更多专注，先稳住关键落点，再逐步扩大消行窗口。',
    tense: '压力正在抬升，优先保留可消行通道，避免高列继续堆积。',
    intense: '进入高压区，系统会优先保活，先确保可落位与基础消行。'
};

/**
 * 从 spawnTargets / spawnHints / breakdown 拼一个「一句话叙事」：
 * 优先级：boardRisk 极高 > spawnIntent（唯一对外口径） > 老回放兜底
 */
export function buildStoryLine(level, breakdown, spawnTargets, spawnHints) {
    if (!breakdown) return level.vibe;
    const br = breakdown.boardRisk ?? 0;
    const recovery = breakdown.recoveryAdjust ?? 0;
    const frust = breakdown.frustrationRelief ?? 0;
    const flow = breakdown.flowAdjust ?? 0;
    const challenge = breakdown.challengeBoost ?? 0;
    const combo = breakdown.comboAdjust ?? 0;
    const friendly = breakdown.friendlyBoardRelief ?? 0;

    /* v1.23：spawnIntent 是出块意图的唯一对外口径，永远优先 ——
     * 旧版 v1.16 加了 gating `frust > -0.08 && recovery > -0.08`，意图是"挫败救济强烈时
     * 让硬信号文案抢占叙事位"。但 v1.18 已经把 stressMeter label/vibe 诚实化为
     * 「放松（救济中）」+「系统正在为你减压」，这条 gating 反而会让 frustRelief 触发时
     * 绕过 SPAWN_INTENT_NARRATIVE.relief（"盘面通透又是兑现窗口…"），退回老严厉文案
     * "检测到挫败感偏高"，与 stressMeter 友好叙事三方拉扯（截图复现）。
     * 改为：spawnIntent 永远优先（前提：br < 0.6，board 极紧张时让"保活"文案抢占）；
     * 老严厉文案降级为"老回放无 spawnIntent 时的 fallback"。
     *
     * v1.24：spawnIntent='flow' 时按实际 rhythmPhase 选变体，避免叙事说"收获期"
     * 与 pill「节奏 搭建」+ strategyAdvisor「搭建期」三方对立（R1 空盘 + delight.mode=
     * flow_payoff 时常见）。其他 intent 仍走单一映射。 */
    if (br >= 0.6) return '盘面很紧张，系统正在为你保活，候选块更易消行。';
    const intent = spawnHints?.spawnIntent;
    if (intent === 'flow') {
        const highStressFlow = FLOW_HIGH_STRESS_NARRATIVE_BY_LEVEL[level?.id];
        if (highStressFlow) return highStressFlow;
        const phase = spawnHints?.rhythmPhase;
        return FLOW_NARRATIVE_BY_PHASE[phase] ?? SPAWN_INTENT_NARRATIVE.flow;
    }
    const narrative = intent && SPAWN_INTENT_NARRATIVE[intent];
    if (narrative) return narrative;

    /* spawnIntent 缺失（pv=2 早期回放等）兜底链 —— 保持与 v1.16 一致以确保向后兼容 */
    if (frust < -0.05) return '检测到挫败感偏高，正在主动减压并送出可消块。';
    if (recovery < -0.05) return '处在恢复窗口，候选块会更小、更友好。';
    if (friendly < -0.05) return '盘面通透又有兑现窗口，悄悄给你减压享受多消。';
    if (challenge >= 0.05) return '正在挑战历史最佳！系统略加压让收尾更有仪式感。';
    if (combo >= 0.04) return 'combo 还在燃烧，给你预留了续链空位。';
    if (flow >= 0.04) return '看起来比较轻松，悄悄加点料维持新鲜感。';
    if (flow <= -0.04) return '稍有焦虑，正在切到更稳的节奏。';
    if (spawnHints?.rhythmPhase === 'payoff') return '节奏进入收获期，准备享受多消快感。';
    if (spawnTargets?.clearOpportunity >= 0.55) return '识别到消行良机，正在投放促清的形状。';
    return level.vibe;
}

/* v1.13：「主要构成」details 展开状态持久化 ——
 * playerInsightPanel._render 在每次落子/出块刷新时都会调用 renderStressMeter，
 * 而 renderStressMeter 内部用 root.innerHTML 整段替换，导致用户手动展开的
 * <details class="stress-meter__details"> 状态在下一帧丢失（HTML 模板默认无 open）。
 * 这里把 open 状态记忆到模块级变量 + localStorage（轻量持久化，跨刷新生效）：
 *   - render 前优先读模块 memo；若 memo 还没初始化就读 localStorage
 *   - render 同时也读取 root 内现有 details 的 open，回写 memo（处理首次手动展开）
 *   - render 后给新生成的 details 绑定 'toggle' 监听器，将变化写回 memo + localStorage
 */
const STRESS_DETAILS_OPEN_KEY = 'openblock_stress_breakdown_open_v1';
let _stressDetailsOpenMemo = null;

function _readStressDetailsOpen() {
    if (_stressDetailsOpenMemo !== null) return _stressDetailsOpenMemo;
    try {
        _stressDetailsOpenMemo = localStorage.getItem(STRESS_DETAILS_OPEN_KEY) === '1';
    } catch {
        _stressDetailsOpenMemo = false;
    }
    return _stressDetailsOpenMemo;
}

function _writeStressDetailsOpen(open) {
    const v = !!open;
    _stressDetailsOpenMemo = v;
    try {
        localStorage.setItem(STRESS_DETAILS_OPEN_KEY, v ? '1' : '0');
    } catch { /* ignore */ }
}

/** 测试用：清除 memo（不动 localStorage） */
export function __resetStressDetailsOpenForTest() {
    _stressDetailsOpenMemo = null;
}

/**
 * 把 stress 映射到 0~100 的进度（用于 vibe bar 宽度）
 */
function _stressToBar(stress) {
    if (!Number.isFinite(stress)) return 50;
    const clamped = Math.max(-0.2, Math.min(1, stress));
    return Math.round(((clamped + 0.2) / 1.2) * 100);
}

function _attrText(s) {
    return String(s).replace(/"/g, '&quot;');
}

function _fmtSigned(v) {
    if (!Number.isFinite(v)) return '—';
    const abs = Math.abs(v).toFixed(2);
    return v >= 0 ? `+${abs}` : `−${abs}`;
}

/**
 * 渲染压力表 HTML 到指定容器。
 *
 * @param {HTMLElement} root 目标容器（必须存在）
 * @param {{
 *   stress?: number,
 *   stressBreakdown?: object,
 *   spawnTargets?: object,
 *   spawnHints?: object,
 *   adaptiveEnabled?: boolean
 * }} insight 当前快照（来自 game._lastAdaptiveInsight）
 * @param {number[]} [stressHistory] 历史 stress 数组（用于趋势）
 */
export function renderStressMeter(root, insight, stressHistory = []) {
    if (!root) return;
    if (!insight || insight.adaptiveEnabled === false) {
        root.innerHTML =
            `<div class="stress-meter stress-meter--disabled" data-level="flow">` +
            `<div class="stress-meter__main">` +
            `<div class="stress-meter__avatar"><span class="stress-meter__face">🌙</span></div>` +
            `<div class="stress-meter__body">` +
            `<div class="stress-meter__head"><span class="stress-meter__label">未启用</span></div>` +
            `<div class="stress-meter__story">自适应出块未开启，压力信号不参与决策。</div>` +
            `</div></div></div>`;
        return;
    }

    const stress = Number.isFinite(insight.stress) ? insight.stress : 0;
    /* v1.18：用 getStressDisplay 替代裸的 getStressLevel —— 当 spawnIntent='relief'
     * 且 stress 已被压到 ≤ −0.05 时，face/label/vibe 切到"被照顾"变体，
     * 与故事线"系统正在主动减压"对齐，避免"😌 放松"+"挫败感偏高"看起来打架。 */
    const intent = insight.spawnHints?.spawnIntent ?? insight.spawnIntent ?? null;
    const level = getStressDisplay(stress, intent);
    const trend = computeTrend(stressHistory, stress, 6);
    const story = buildStoryLine(level, insight.stressBreakdown, insight.spawnTargets, insight.spawnHints);
    const barPct = _stressToBar(stress);

    const trendTitle = trend.direction === 'up'
        ? `比近 ${6} 帧平均高 ${trend.delta.toFixed(2)}`
        : trend.direction === 'down'
            ? `比近 ${6} 帧平均低 ${Math.abs(trend.delta).toFixed(2)}`
            : '与近期均值持平';

    // 主体 HTML：data-level 给 CSS 切换主题；--breath-ms / --bar-pct 让 CSS 直接消费
    const breathMs = Math.round(2400 - barPct * 14); // bar=0 → 2.4s；bar=100 → ~1.0s
    const num = stress.toFixed(2);

    /* v1.13：原"主要构成 · 当前帧"折叠区移除 ——
     * 列表里展示的 5 个 top-N 分量（难度模式 / 心流 / 节奏 / 友好盘面 / 会话弧线 …）
     * 已作为 stress 组曲线（pink）整合进下方 sparkline 网格，与综合 stress + 12 项指标
     * 在同一时间轴上对照。曲线比 top-N 文字列表能更直观地呈现「这个分量在何时启动、
     * 持续多久」。summarizeContributors / SIGNAL_LABELS 仍保留导出供其它代码（统计、
     * 调试面板、复盘报告）使用，仅去掉本面板的 details 渲染。
     */
    root.innerHTML =
        `<div class="stress-meter" data-level="${level.id}" ` +
        `style="--stress-bar-pct:${barPct}%;--stress-breath-ms:${breathMs}ms;">` +
            `<div class="stress-meter__main">` +
                `<div class="stress-meter__avatar" title="${_attrText(level.vibe)}" aria-live="polite">` +
                    `<span class="stress-meter__pulse" aria-hidden="true"></span>` +
                    `<span class="stress-meter__face">${level.face}</span>` +
                `</div>` +
                `<div class="stress-meter__body">` +
                    `<div class="stress-meter__head">` +
                        `<span class="stress-meter__label">${level.label}</span>` +
                        `<span class="stress-meter__num" title="综合压力 stress（约 −0.2~1）；细分构成见下方 sparkline 中的「难度/心流/节奏/友好盘面/会话弧线/挑战」曲线。">` +
                            `${num} <span class="stress-meter__delta" data-dir="${trend.direction}" title="${_attrText(trendTitle)}">${trend.icon}</span>` +
                        `</span>` +
                    `</div>` +
                    `<div class="stress-meter__bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${barPct}">` +
                        `<div class="stress-meter__bar-fill"></div>` +
                    `</div>` +
                    `<div class="stress-meter__story">${_attrText(story)}</div>` +
                `</div>` +
            `</div>` +
        `</div>`;
}
