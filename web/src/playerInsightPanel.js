/**
 * 左侧「玩家画像 · 自适应」面板：实时能力指标 + 上一轮出块的可解释摘要。
 * 供策划/开发根据信号持续调 game_rules.json 与 adaptiveSpawn 逻辑。
 */
import { GAME_RULES } from './gameRules.js';
import { computeHints } from './hintEngine.js';
import { generateStrategyTips } from './strategyAdvisor.js';
import {
    collectSeriesFromSnapshots,
    getMetricFromPS,
    formatMetricValue,
    REPLAY_METRICS
} from './moveSequence.js';
import {
    sparklineSvg,
    SPARK_W,
    METRIC_GROUP_COLORS,
    getMetricLabelColor
} from './sparkline.js';
import { getSpawnMode, SPAWN_MODE_MODEL_V3 } from './spawnModel.js';
import { renderStressMeter, summarizeContributors } from './stressMeter.js';
import { UI_ICONS } from './uiIcons.js';
import { analyzeBoardTopology, countUnfillableCells } from './boardTopology.js';
import { buildPlayerAbilityVector } from './playerAbilityModel.js';
import { getAllShapes } from './shapes.js';
import { computeCandidatePlacementMetric } from './bot/blockSpawn.js';
import { getLifecycleMaturitySnapshot } from './retention/playerLifecycleDashboard.js';

/** 与 Game.getCandidatePlacementSolutionSnapshot 一致；无 game 实例时直算 */
function _placementSolutionForGame(game) {
    if (game && typeof game.getCandidatePlacementSolutionSnapshot === 'function') {
        return game.getCandidatePlacementSolutionSnapshot();
    }
    return computeCandidatePlacementMetric(game?.grid, game?.dockBlocks || []);
}

/** 模型化能力指标区：统一 AbilityVector 的 6 个核心维度 */
const ABILITY_METRIC_ROWS = [
    { key: 'skillScore', label: '能力', tooltip: '综合能力：融合局内技能 EMA、历史基线与模型化长期能力校准。' },
    { key: 'controlScore', label: '操作', tooltip: '操作稳定性：由失误率、认知负荷、AFK 和操作频率综合得到。' },
    { key: 'clearEfficiency', label: '消行', tooltip: '消行效率：由消行率、多消率、每次消行条数综合得到。' },
    { key: 'boardPlanning', label: '规划', tooltip: '盘面规划：由空洞、填充压力、可落位空间和临消机会综合得到。' },
    { key: 'riskLevel', label: '风险', tooltip: '短期风险：高填充、空洞、连续未消行和操作不稳会抬高该值。' },
    { key: 'confidence', label: '置信', tooltip: '数据置信度：历史局数、终身落子数和本局采样越多越高。' }
];

const _METRIC_TOOLTIP_BY_KEY = Object.fromEntries(
    REPLAY_METRICS.map((m) => [m.key, m.tooltip || ''])
);

const CHARTED_STRESS_BREAKDOWN_KEYS = new Set([
    'difficultyBias',
    'flowAdjust',
    'pacingAdjust',
    'friendlyBoardRelief',
    'sessionArcAdjust',
    'challengeBoost',
]);

/** 实时状态顶栏标签（心流 / 节奏 / 会话阶段 / 出块轮） */
const LIVE_TAG_TITLE = {
    flow: {
        bored: '心流三态·无聊：挑战相对偏低，系统可略加压以增加趣味与投入。',
        flow: '心流三态·心流：挑战与能力较匹配，维持当前难度与反馈节奏。',
        anxious: '心流三态·焦虑：挑战偏高或失误偏多，系统倾向减压与消行友好投放。'
    },
    pacing: {
        /* v1.17：原标签「节奏相位」与 spawnHints.rhythmPhase（setup/payoff/neutral）
         * 在 UI 上同名异义。改为「Session 张弛」专指 PlayerProfile.pacingPhase
         * （tension/release 在 session 周期内的张弛位置）。 */
        tension: 'Session 张弛·紧张期：与释放期交替，略提高张力，形成起伏感。',
        release: 'Session 张弛·释放期：略降低压力，给玩家喘息与正反馈空间。'
    },
    session: {
        early: '会话阶段·热身：开局不久，整体可更友好，帮助建立节奏。',
        peak: '会话阶段·巅峰：主要对局时段，难度按常规定义执行。',
        late: '会话阶段·疲劳：连续游玩较久，可略放缓压力以降低疲劳挫败。'
    }
};

function _tooltipForLiveTag(tagText) {
    if (tagText == null || tagText === '—') {
        return '本项暂无有效采样（开局或未记录）。';
    }
    const s = String(tagText);
    if (/^R\d+$/.test(s)) {
        return '本局已完成的出块轮次：每刷新一轮候选块（dock）计数 +1，用于观察进程与策略弧线。';
    }
    if (s === 'R—' || /^R[^0-9]/.test(s)) {
        return '出块轮次：尚未计数或本局未刷新候选块。';
    }
    if (LIVE_TAG_TITLE.flow[s]) return LIVE_TAG_TITLE.flow[s];
    if (LIVE_TAG_TITLE.pacing[s]) return LIVE_TAG_TITLE.pacing[s];
    if (LIVE_TAG_TITLE.session[s]) return LIVE_TAG_TITLE.session[s];
    return '实时状态标签：与玩家画像快照同步。';
}

const LIVE_FLAG_TITLE = {
    AFK: '在最近统计窗口内，单次停顿超过阈值（如 15s）记为一次 AFK；该时段常从部分指标中排除，避免拖垮均值。',
    近失: '上一步在较满板面上落子但未消行，形成「差一点就消」的局面；可触发近失策略（略降压、提高消行保证）。',
    恢复: '盘面曾处于高填充后的短期恢复模式：更倾向小格、易落子、易消行的投放，帮助脱困。',
    新手: '处于新手或首局保护窗口：整体压力上限压低，形状更规整易学，降低上手挫败。'
};

function _tooltipForLiveFlag(text) {
    const t = String(text).trim();
    if (t.startsWith('AFK')) return LIVE_FLAG_TITLE.AFK;
    if (t === '近失') return LIVE_FLAG_TITLE['近失'];
    if (t === '恢复') return LIVE_FLAG_TITLE['恢复'];
    if (t === '新手') return LIVE_FLAG_TITLE['新手'];
    /* P0-5：S?·M? 标签的 tooltip，让画像面板与运营蓝图字典同源。 */
    if (/^S[0-4]\+?·M[0-4]$/.test(t)) {
        return '运营标签：S? 为生命周期阶段（S0 新入场 / S1 激活 / S2 习惯 / S3 稳定 / S4 回流）、M? 为成熟度 band（M0 新手 / M1 成长 / M2 熟练 / M3 资深 / M4 核心）。详见 docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md。';
    }
    return '本局实时状态标志。';
}

const CAT_LABEL = {
    lines: '长条',
    rects: '矩形',
    squares: '方形',
    tshapes: 'T 形',
    zshapes: 'Z 形',
    lshapes: 'L 形',
    jshapes: 'J 形'
};

const CAT_SHORT_LABEL = {
    lines: '长',
    rects: '矩',
    squares: '方',
    tshapes: 'T',
    zshapes: 'Z',
    lshapes: 'L',
    jshapes: 'J'
};

function _shapeWeightChartHtml(shapeWeightsTop = []) {
    const rows = (Array.isArray(shapeWeightsTop) ? shapeWeightsTop : [])
        .filter((w) => w && Number.isFinite(Number(w.weight)))
        .slice(0, 5);
    if (!rows.length) return '';
    const total = rows.reduce((sum, w) => sum + Math.max(0, Number(w.weight) || 0), 0) || 1;
    const tip = `${SPAWN_TOOLTIP.shapeW} 出块概率 = 当前块型权重 ÷ 全量块型权重总和；它是本轮 spawn 决策快照中的相对抽样倾向，不是最终三块的确定结果。`;
    const items = rows.map((w) => {
        const weight = Math.max(0, Number(w.weight) || 0);
        const probability = Number.isFinite(Number(w.probability))
            ? Number(w.probability)
            : (weight / total);
        const pct = Math.max(0, Math.min(100, probability * 100));
        const label = CAT_LABEL[w.category] || w.category || '未知';
        const shortLabel = CAT_SHORT_LABEL[w.category] || label;
        const title = `${label}：出块概率 ${pct.toFixed(0)}%，原始权重 ${weight.toFixed(2)}。${tip}`;
        return (
            `<div class="shape-weight-item" title="${_attrTitle(title)}">` +
                `<span class="shape-weight-label">${shortLabel}</span>` +
                `<span class="shape-weight-pct">${pct.toFixed(0)}%</span>` +
            `</div>`
        );
    }).join('');
    return (
        `<div class="shape-weight-chart" title="${_attrTitle(tip)}">` +
            `<div class="shape-weight-chart__head">` +
                `<span>出块</span>` +
            `</div>` +
            `<div class="shape-weight-grid">${items}</div>` +
        `</div>`
    );
}

function _decisionCell(label, value, tooltip) {
    return (
        `<span class="spawn-decision-cell" title="${_attrTitle(tooltip || '')}">` +
            `<span class="spawn-decision-label">${label}</span>` +
            `<strong>${value}</strong>` +
        `</span>`
    );
}

/** 投放区指标悬停说明 */
/** 玩法风格标签（中文化） */
const PLAYSTYLE_LABEL = {
    perfect_hunter: '清屏猎人',
    multi_clear: '多消流',
    combo: '连消流',
    survival: '生存流',
    balanced: '均衡',
};

/** 玩法风格 tooltip */
const PLAYSTYLE_TOOLTIP = {
    perfect_hunter: '频繁清屏（消行后 fill=0 占比≥5%）：追求一次性消空棋盘，系统提升多消块权重与消行保障。',
    multi_clear: '多消玩家（多消率≥40% 或平均消除条数≥2.5）：偏好同时消多行，系统切入 payoff 节奏并提升多消鼓励。',
    combo: '连消型玩家（连续 combo streak≥3）：连续触发多行消除，系统额外保障 2 个消行槽位供续链。',
    survival: '生存型玩家（消行率<25%）：以保活为主，系统减压、偏向小块、保障最低可放置性。',
    balanced: '均衡型：无明显单一偏好，系统按常规自适应策略投放，不做额外风格调整。',
};

/** spawnIntent 标签：与 stressMeter.SPAWN_INTENT_NARRATIVE / 商业化文案同源 */
const SPAWN_INTENT_LABEL = {
    relief:   '救济',
    engage:   '召回',
    pressure: '加压',
    flow:     '心流',
    harvest:  '兑现',
    maintain: '维持',
};

const MOTIVATION_INTENT_LABEL = {
    competence: '胜任',
    challenge: '挑战',
    relaxation: '减压',
    collection: '收集',
    social: '社交',
    balanced: '均衡',
};

const BEHAVIOR_SEGMENT_LABEL = {
    newcomer_protection: '新手保护',
    challenge_seeker: '高手挑战',
    relaxation: '减压玩家',
    collector: '收集完成',
    social_competitor: '社交比较',
    balanced: '均衡',
};

const SPAWN_TOOLTIP = {
    stress:
        '综合压力（约 −0.2～1）。由分数档、连战、技能、心流、节奏、恢复、挫败、combo、近失、闭环反馈等叠加后钳制，用于在配置的多档形状权重间插值。',
    flowDev:
        '心流偏移 F(t)：挑战与能力匹配的偏离程度；参与无聊/焦虑方向的 stress 微调。',
    feedback:
        '闭环反馈（reward bias）：每轮新出块后，在若干步放置窗口内统计消行表现，对 stress 做小幅偏移（正≈好于预期可略加压，负≈不及预期减压）。⚠ 与「近满 N」「多消候选」不同——它衡量的是"近期奖励是否高于预期"，不是"盘面几何上还有几条临消行"。',
    boardFill: '当前棋盘占用率（已占格÷总格），不是开局预填比例 fillRatio。',
    spawnIntent: '出块意图（spawnIntent）：本轮自适应出块对外的单一口径——relief/engage/pressure/flow/harvest/maintain。压力表叙事、商业化策略文案与回放标签都读这一字段，避免文案与实际出块不一致。',
    motivationIntent: '动机意图（motivationIntent）：由实时行为和明示偏好推断的中长期个性化目标，如胜任、挑战、减压、收集、社交；不使用年龄/性别/种族/宗教等敏感属性。',
    behaviorSegment: '行为分群：只由清行、思考、失误、分享、挑战、收集等行为信号推断，用于解释个性化策略，不做敏感属性定向。',
    accessibilityLoad: '操作负担：低画质/低动态偏好、误触率、长思考等信号合成；越高越倾向偏小块、保消和低压力。',
    returningWarmup: '回归暖启动：沉默 1/3/7 天后回归时短期减压，避免直接沿用历史高技能造成首局挫败。',
    socialFairChallenge: '公平挑战模式：异步挑战/固定 seed 场景关闭个体化难度，保证不同玩家面对同一规则。',
    /* v1.18：让玩家直接看到"这一帧 stress 是被哪个救济信号压下去的"，
     * 不必从故事线里倒推 ——」救济 / 恢复 / 近失 三条最常出力的负向信号。 */
    frustrationRelief: '挫败救济（stressBreakdown.frustrationRelief）：连续若干步无消行触发的强制减压。负值越大表示挫败越重，系统出块也会更友好。',
    recoveryAdjust: '恢复调整（stressBreakdown.recoveryAdjust）：近一段挫败/卡顿后系统压低难度，给你"喘一口气"的窗口。负值代表正在恢复中。',
    nearMissAdjust: '近失救济（stressBreakdown.nearMissAdjust）：上一步差一点就消行（near miss）的局面，给予的小额减压，避免你连续吃挫败。',
    clearG:
        '目标保消（1～3）：三连候选中目标至少要有几块具备「落下即可促成消行」的潜力；挫败/恢复/近失/新手等会抬高。',
    sizePref:
        '尺寸偏好（约 −1～1）：负值偏向小块便于腾挪，正值偏向大块；挫败/恢复/新手等常为负。',
    diversity: '品类多样（0～1）：越高三连块越倾向不同品类；无聊心流时常略提高新鲜感。',
    shapeW: '当前综合压力下，该形状类别的相对抽样权重（数值越大越容易被抽到）。',
    comboChain: 'Combo 链强度（0～1）：越高越偏好续链消行块。受连续消行状态驱动。',
    multiClear: '多消鼓励（0～1）：越高越偏好能同时消多行的块。受盘面和轮空状态驱动。',
    multiLineTarget:
        '多线目标（0～2）：显式要求 shapes 阶段偏好 multiClear≥2 的强度；2 时与 multiClearBonus 叠加，强化「双行以上同时兑现」。来自 pcSetup / 近满行 / 刚多消后的短窗口及局间热身。',
    perfectClearCandidates: '清屏候选：当前棋盘上存在“一手放下并消除后盘面清空”的形状数量。该值按实时棋盘重算。',
    rhythm: '节奏相位：setup=搭建蓄力期 / payoff=收获消行期 / neutral=中性。',
    sessionArc: 'Session 弧线：warmup=热身 / peak=巅峰 / cooldown=收官。',
    holes: '盘面空洞数：当前所有可出形状在任何合法位置都无法覆盖的空格数；越多表示越难被后续块修复。',
    flatness: '表面平整度（0~1）：列高度方差越小越平整，1=完全平整。',
    nearFull:
        '近满行/列数：距离整行或整列填满仅差 1～2 格的条数，越多表示越容易通过少量放置触发多消，是 Layer1 多消潜力的重要信号。',
    solutionCount:
        '解法（展示）：当前各未放置候选块在盘面上可独立落下的合法位置数之和；数值越大通常操作空间越宽裕。新一波三块出现时、每落下一子后都会随候选与盘面重算。',
    validPerms:
        '合法序（v9）：本轮生成时，6 种放置顺序里“至少有 1 条完整解”的顺序数（0–6）。数值越低越容易卡手。',
    firstMoveFreedom:
        '首手自由度（v9）：三块各自单独放置时合法位置数的最小值（瓶颈块）。数值越小，玩家选错位置后越容易卡死。',
    targetSolutionRange:
        '解法区间（v9）：根据综合 stress 在 game_rules.solutionDifficulty.ranges 中选择的目标解空间区间。三连块通过 sequentiallySolvable 后，若解法数量超出区间则在前 60% attempt 内重抽。',
    v3Meta:
        '生成式元信息：上一轮 V3 的模型版本、是否命中个性化 LoRA、feasibility mask 可行候选数量，以及护栏失败时的回退原因。'
};

function _attrTitle(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 策略解释等窄栏文案：去掉句末标点以省宽 */
function _stripTrailingSentencePunct(s) {
    let t = String(s).trimEnd();
    while (t.length > 0) {
        const last = t[t.length - 1];
        if (last === '。' || last === '．' || last === '.') {
            t = t.slice(0, -1).trimEnd();
            continue;
        }
        break;
    }
    return t;
}

function _spawnPill(text, title) {
    return `<span class="insight-weight" title="${_attrTitle(title)}">${text}</span>`;
}

function _pct(x) {
    if (x == null || Number.isNaN(x)) return '—';
    return `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
}

function _gridMaxHeight(grid) {
    const n = grid.size;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (grid.cells[y][x] !== null) return n - y;
        }
    }
    return 0;
}

function _gridHoles(grid) {
    return countUnfillableCells(grid);
}

function _bestMultiClearPotential(grid, shapeData) {
    if (!grid || !shapeData) return 0;
    let best = 0;
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            const outcome = grid.previewClearOutcome?.(shapeData, x, y, 0);
            if (!outcome) continue;
            best = Math.max(best, (outcome.rows?.length ?? 0) + (outcome.cols?.length ?? 0));
            if (best >= 2) return best;
        }
    }
    return best;
}

/**
 * 统计“当前可见候选块”里可做多消（>=2）的块数。
 *
 * v1.25：优先按 dock 三块做匹配，避免“策略说多消机会很多，但当前候选块根本打不中”的错觉。
 * - 新口径（优先）：仅统计 `game.dockBlocks` 未放置块（玩家当下真能用的 3 块）
 * - 兜底口径：dock 不可用时退回全形状库（兼容开局/测试桩）
 *
 * @param {any} grid
 * @param {Array<{ shape?: number[][], placed?: boolean }>} [dockBlocks]
 * @returns {number|null}
 */
function _countLiveMultiClearCandidates(grid, dockBlocks) {
    if (!grid) return null;
    const liveDockShapes = Array.isArray(dockBlocks)
        ? dockBlocks
            .filter((b) => b && b.placed !== true && Array.isArray(b.shape))
            .map((b) => ({ data: b.shape }))
        : [];
    const shapePool = liveDockShapes.length > 0 ? liveDockShapes : getAllShapes();
    let count = 0;
    for (const shape of shapePool) {
        if (_bestMultiClearPotential(grid, shape.data) >= 2) count++;
    }
    return count;
}

function _isGridEmpty(grid) {
    return grid?.cells?.every((row) => row.every((cell) => cell === null)) ?? false;
}

function _bestPerfectClearPotential(grid, shapeData) {
    if (!grid || !shapeData) return 0;
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            if (!grid.canPlace(shapeData, x, y)) continue;
            const g = grid.clone();
            g.place(shapeData, 0, x, y);
            g.checkLines();
            if (_isGridEmpty(g)) return 2;
        }
    }
    return 0;
}

function _countLivePerfectClearCandidates(grid, topology) {
    if (!grid) return null;
    const fill = topology?.fillRatio ?? grid.getFillRatio?.() ?? 0;
    const occupied = topology?.occupiedCount
        ?? grid.cells.reduce((sum, row) => sum + row.filter((cell) => cell !== null).length, 0);
    if (occupied > 22 && fill > 0.46) return 0;
    let count = 0;
    for (const shape of getAllShapes()) {
        if (_bestPerfectClearPotential(grid, shape.data) === 2) count++;
    }
    return count;
}

function _flowExplain(flow) {
    if (flow === 'bored') return '操作快、失误少 → 系统略提高挑战（加压）。';
    if (flow === 'anxious') return '失误多或思考过久 → 系统减压、倾向消行友好块。';
    return '节奏与能力较匹配 → 维持当前难度曲线。';
}

function _pacingExplain(phase) {
    /* v1.17：与 spawnHints.rhythmPhase（出块节奏：setup/payoff/neutral）拆开
     * 命名口径，避免在策略解释段同时出现「节奏相位：紧张期」+ 紧凑 pill「节奏 收获」时
     * 看似自相矛盾。这里改读「Session 张弛」专指 PlayerProfile.pacingPhase。 */
    return phase === 'release'
        ? 'Session 张弛：松弛期（略降低压力，给喘息）。'
        : 'Session 张弛：紧张期（略提高张力）。';
}

function _hintsExplain(h) {
    if (!h) return [];
    const out = [];
    const cg = h.clearGuarantee ?? 1;
    if (cg >= 2) {
        out.push(`目标保消 ≥${cg}：优先从「能填缺口」的形状里抽样，降低死局感。`);
    }
    const sp = h.sizePreference ?? 0;
    if (sp < -0.15) {
        out.push(`尺寸偏好 偏小（${sp.toFixed(2)}）：更倾向小格数块，便于腾挪。`);
    } else if (sp > 0.15) {
        out.push(`尺寸偏好 偏大（${sp.toFixed(2)}）：略倾向大块，增加挑战或清板机会。`);
    }
    const db = h.diversityBoost ?? 0;
    if (db > 0.05) {
        out.push(`新鲜感 +${db.toFixed(2)}：三连块品类惩罚重复，增加变化。`);
    }
    const cc = h.comboChain ?? 0;
    if (cc > 0.2) {
        out.push(`Combo 催化 ${cc.toFixed(2)}：偏好能续链消行的块型。`);
    }
    const mc = h.multiClearBonus ?? 0;
    if (mc > 0.2) {
        out.push(`多消鼓励 ${mc.toFixed(2)}：偏好能同时消多行的块型。`);
    }
    const ml = h.multiLineTarget ?? 0;
    if (ml >= 1) {
        out.push(`多线目标 ${ml}：${ml >= 2 ? '强' : '中'}制导向 multiClear≥2 的块型抽样（清屏准备 / 密集临消 / 多消后续航）。`);
    }
    if (h.rhythmPhase === 'payoff') {
        out.push('节奏相位：收获期——出块偏向消行友好。');
    } else if (h.rhythmPhase === 'setup') {
        out.push('节奏相位：搭建期——出块偏向中等构型块。');
    }
    if (h.sessionArc === 'warmup') {
        out.push('Session 弧线：热身——出块友好，帮助建立节奏。');
    } else if (h.sessionArc === 'cooldown') {
        out.push('Session 弧线：收官——适度放缓压力。');
    }
    if (h.scoreMilestone) {
        out.push('🎉 里程碑达成！本轮出块特别友好。');
    }
    const tsr = h.targetSolutionRange;
    if (tsr && (tsr.min != null || tsr.max != null)) {
        const label = tsr.label ? `「${tsr.label}」` : '';
        if (tsr.max != null) {
            out.push(`解法上限${label}：解空间叶子数 ≤${tsr.max}，限制可行序列数量以提升精算挑战`);
        } else if (tsr.min != null && tsr.min > 1) {
            out.push(`解法下限${label}：候选三块至少要有 ${tsr.min} 种放置顺序可完整下完，避免唯一解卡顿`);
        }
    }
    if (out.length === 0) {
        out.push('本轮无额外 spawnHints（默认随机权重内抽样）。');
    }
    return out;
}

/** 顶栏与 flow/R49 同行：当前出块算法（与侧栏单选项联动） */
function _spawnModePrimaryChipHtml() {
    const mode = getSpawnMode();
    const primary =
        mode === SPAWN_MODE_MODEL_V3
            ? {
                  text: `${UI_ICONS.generativeRecommend} 生成式`,
                  title: '侧栏已选「生成式」：下轮起块将请求 SpawnTransformerV3，并通过前端护栏校验；不可用或未通过则自动回退启发式。',
              }
            : {
                  text: `${UI_ICONS.ruleAlgorithm} 启发式`,
                  title: '侧栏已选「启发式」：下轮起块由启发式规则引擎生成。',
              };
    return (
        `<span class="insight-weight insight-weight--mode-primary insight-spawn-mode-chip" title="${_attrTitle(primary.title)}">` +
        `${primary.text}</span>`
    );
}

/** 仅「上轮回退」提示行（主模式 chip 已上移到实时状态顶栏） */
function _spawnModeFallbackRowHtml(ins) {
    const meta = ins?.spawnModelMeta;
    if (ins?.spawnSource !== 'rule-fallback' && !meta) {
        return '';
    }
    if (meta && ins?.spawnSource !== 'rule-fallback') {
        const parts = [
            meta.modelVersion || 'v3',
            meta.personalized ? '个性化' : '通用',
        ];
        if (meta.feasibleCount != null) parts.push(`可行 ${meta.feasibleCount}`);
        return (
            `<div class="insight-weights">` +
            `<span class="insight-weight insight-weight--spawn-note" title="${_attrTitle(SPAWN_TOOLTIP.v3Meta)}">V3 ${parts.join(' / ')}</span>` +
            `</div>`
        );
    }
    const reason = meta?.fallbackReason ? `，原因：${meta.fallbackReason}` : '';
    return (
        `<div class="insight-weights">` +
        `<span class="insight-weight insight-weight--spawn-note" title="上一轮 V3 推荐未通过或请求失败，实际使用了规则出块${_attrTitle(reason)}">${UI_ICONS.spawnFallback} 上轮已回退规则${reason}</span>` +
        `</div>`
    );
}

const LIVE_HISTORY_MAX = 160;

/**
 * 与 `buildPlayerStateSnapshot` / 回放 `ps` 对齐，供 `REPLAY_METRICS` 抽取
 * @param {import('./game.js').Game} game
 */
function _buildLiveSnapshotForSeries(game) {
    const p = game.playerProfile;
    const ins = game._lastAdaptiveInsight;
    const m = p.metrics;
    const ability = ins?.abilityVector || buildPlayerAbilityVector(p, {
        grid: game.grid,
        boardFill: game.grid?.getFillRatio?.() ?? 0,
        gameStats: game.gameStats,
        spawnContext: game._spawnContext,
        adaptiveInsight: ins,
    });
    /* v1.13：冷启动隔离 —— PlayerProfile.metrics 在 recent.length=0 时返回硬编码占位值
     * （3000ms / 30% / 10% / 10%）以便内部 stress / skill 计算不至于除零或抖到极端，
     * 但 UI 层应展示「—」而非这些占位数字，否则玩家会误以为「我还没下任何块系统就
     * 测出我消行率 30% / 失误 10%」。这里在塞入 ps.metrics 时按 samples / activeSamples
     * 把无效字段置 null；formatMetricValue(null) 已经返回「—」，UI 层零改动。
     */
    const samples = Number(m.samples ?? 0) || 0;
    const activeSamples = Number(m.activeSamples ?? 0) || 0;
    const hasAnySample = samples > 0;
    const hasActiveSample = activeSamples > 0;
    const cognitiveLoadHasData = !!p.cognitiveLoadHasData;
    const coldStart = samples === 0;
    const metricsSlim = {
        thinkMs: hasActiveSample ? m.thinkMs : null,
        clearRate: hasActiveSample ? m.clearRate : null,
        comboRate: hasActiveSample ? m.comboRate : null,
        missRate: hasAnySample ? m.missRate : null,
        afkCount: m.afkCount,
        samples,
        activeSamples
    };
    /** @type {Record<string, unknown>} */
    const slim = {
        // pv=2 与 buildPlayerStateSnapshot 保持一致，便于 collectSeriesFromSnapshots
        // 与 collectReplayMetricsSeries 共用同一访问器、共享冷启动语义。
        pv: 2,
        phase: 'live',
        score: game.score,
        boardFill: game.grid?.getFillRatio?.() ?? 0,
        skill: p.skillLevel,
        momentum: p.momentum,
        cognitiveLoad: cognitiveLoadHasData ? p.cognitiveLoad : null,
        cognitiveLoadHasData,
        coldStart,
        engagementAPM: p.engagementAPM,
        flowDeviation: p.flowDeviation,
        flowState: p.flowState,
        pacingPhase: p.pacingPhase,
        frustration: p.frustrationLevel,
        sessionPhase: p.sessionPhase,
        spawnRound: p.spawnRoundIndex,
        feedbackBias: p.feedbackBias,
        ability,
        metrics: metricsSlim
    };
    if (ins && typeof ins === 'object') {
        slim.adaptive = {
            stress: ins.stress,
            flowDeviation: ins.flowDeviation,
            feedbackBias: ins.feedbackBias,
            skillLevel: ins.skillLevel,
            fillRatio: ins.fillRatio,
            flowState: ins.flowState,
            pacingPhase: ins.pacingPhase,
            momentum: ins.momentum,
            frustration: ins.frustration,
            sessionPhase: ins.sessionPhase,
            spawnHints: ins.spawnHints ?? null,
            stressBreakdown: ins.stressBreakdown ?? null,
            spawnTargets: ins.spawnTargets ?? null,
            shapeWeightsTop: ins.shapeWeightsTop ?? null
        };
    }
    if (game.grid) {
        try {
            const holes = analyzeBoardTopology(game.grid).holes;
            const liveSm = _placementSolutionForGame(game);
            const solutionCount =
                liveSm != null && Number.isFinite(Number(liveSm.solutionCount))
                    ? Number(liveSm.solutionCount)
                    : null;
            slim.spawnGeo = { holes, solutionCount };
        } catch {
            /* ignore */
        }
    }
    return slim;
}

function _appendLiveInsightSample(game) {
    if (game.replayPlaybackLocked) {
        return;
    }
    if (!Array.isArray(game._insightLiveHistory)) {
        game._insightLiveHistory = [];
    }
    game._insightLiveHistory.push(_buildLiveSnapshotForSeries(game));
    while (game._insightLiveHistory.length > LIVE_HISTORY_MAX) {
        game._insightLiveHistory.shift();
    }
}

/**
 * 实时状态：与回放面板同款指标 sparkline。
 *
 * 仅 LIVE 调用；回放期间由 enterInsightReplay 一次性画完整曲线、
 * updateInsightReplayFrame 仅按 step 滑游标 + 改右侧数值（不重绘曲线本身）。
 */
function _renderInsightStateSeries(game, elState) {
    _appendLiveInsightSample(game);
    const hist = game?._insightLiveHistory || [];
    const data = collectSeriesFromSnapshots(hist);
    if (!data || hist.length === 0) {
        elState.className = 'insight-state-row insight-state-series';
        elState.innerHTML =
            '<div class="replay-series-header insight-live-series-head" id="insight-live-series-head"></div>' +
            '<span class="insight-muted">开局后随出块/落子刷新，与回放同款指标曲线。</span>';
        const headEmpty = document.getElementById('insight-live-series-head');
        if (headEmpty) {
            headEmpty.innerHTML =
                '<div class="insight-live-head-tags"></div>' + _spawnModePrimaryChipHtml();
        }
        return;
    }
    const lastIdx = hist.length - 1;
    const lastPs = hist[lastIdx];
    const maxIdx = Math.max(data.totalFrames - 1, 1);
    const cx = (lastIdx / maxIdx) * SPARK_W;

    let html =
        '<div class="replay-series-header insight-live-series-head" id="insight-live-series-head"></div>';
    html += '<div class="replay-series-grid insight-live-series-grid">';
    for (let i = 0; i < data.metrics.length; i++) {
        const m = data.metrics[i];
        const s = data.series[m.key];
        const color = METRIC_GROUP_COLORS[m.group] || '#5b9bd5';
        const labelColor = getMetricLabelColor(m.key, color, i);
        const cellTip = _METRIC_TOOLTIP_BY_KEY[m.key] || '';
        html +=
            `<div class="replay-series-cell" data-key="${m.key}" title="${_attrTitle(cellTip)}">` +
            `<span class="series-label series-label--metric" style="--series-label-color:${labelColor}">${m.label}</span>` +
            `<div class="series-spark-wrap">${sparklineSvg(s.points, data.totalFrames, color)}</div>` +
            `<span class="series-value">${formatMetricValue(getMetricFromPS(lastPs, m.key), m.fmt)}</span></div>`;
    }
    html += '</div>';
    elState.innerHTML = html;
    elState.className = 'insight-state-row insight-state-series';

    const head = document.getElementById('insight-live-series-head');
    if (head && lastPs) {
        const tags = [
            lastPs.flowState || '—',
            lastPs.pacingPhase || '—',
            lastPs.sessionPhase || '—',
            'R' + (lastPs.spawnRound ?? '—')
        ];
        const tagsHtml = tags
            .map(
                (t) =>
                    `<span class="series-tag" title="${_attrTitle(_tooltipForLiveTag(t))}">${t}</span>`
            )
            .join('');
        head.innerHTML =
            `<div class="insight-live-head-tags">${tagsHtml}</div>` + _spawnModePrimaryChipHtml();
    }

    elState.querySelectorAll('.replay-sparkline .spark-cursor').forEach((line) => {
        line.setAttribute('x1', cx.toFixed(1));
        line.setAttribute('x2', cx.toFixed(1));
    });
}

/**
 * v1.21：双参签名 —— 让纯 live 量（flowDeviation / feedbackBias / flowState）
 * 与右侧 pill / 左侧 sparkline 末点同源（都来自 PlayerProfile），消除上次截图
 * 出现的"sparkline F(t)=0.82 / pill 0.82 / 解释 F(t)=0.78（snapshot）"三态打架。
 * spawn 决策类字段（spawnIntent / spawnHints.* / stressBreakdown / strategyId / 
 * difficultyBias 等）继续读 insight，与 spawn 时的决策一致（这是它们的"为什么"）。
 * 第二参缺省 / null 时退化到旧行为（保持向后兼容）。
 * @param {object} insight  game._lastAdaptiveInsight
 * @param {import('./playerProfile.js').PlayerProfile} [profile]
 */
function _buildWhyLines(insight, profile) {
    const lines = [];
    if (!insight?.adaptiveEnabled) {
        lines.push('自适应出块未开启：仅按基础难度 + 分数档出块（见 dynamicDifficulty）。');
        return lines;
    }
    const s = insight.stress;
    if (typeof s === 'number') {
        const diffLabel = insight.strategyId === 'easy' ? '简单' : insight.strategyId === 'hard' ? '困难' : '普通';
        const biasStr = insight.difficultyBias ? ` 难度偏移${insight.difficultyBias > 0 ? '+' : ''}${insight.difficultyBias.toFixed(2)}` : '';
        lines.push(
            `综合压力 stress=${s.toFixed(2)}（${diffLabel}模式${biasStr}；含分数、连战、心流、节奏等信号）`
        );
    }
    if (insight.skillLevel != null) {
        lines.push(
            `技能估计 ${_pct(insight.skillLevel)}：偏高时略加压、偏低时略减压。`
        );
    }
    if (insight.abilityVector) {
        for (const line of insight.abilityVector.explain || []) {
            lines.push(`能力模型：${line}。`);
        }
    }
    /* v1.21：F(t) / flowState / feedbackBias 与 pill / sparkline 同源（live 优先） */
    const liveFd = Number.isFinite(profile?.flowDeviation)
        ? profile.flowDeviation : insight.flowDeviation;
    const liveFlowState = profile?.flowState ?? insight.flowState;
    if (liveFd != null) {
        const fdDesc = liveFd < 0.25 ? '沉浸区' : liveFd < 0.5 ? '轻度偏移' : '显著偏移';
        lines.push(`心流偏移 F(t)=${liveFd.toFixed(2)}（${fdDesc}）→ ${liveFlowState} 方向修正幅度随偏移放大。`);
    } else {
        lines.push(_flowExplain(liveFlowState));
    }
    lines.push(_pacingExplain(insight.pacingPhase));
    const liveFb = Number.isFinite(profile?.feedbackBias)
        ? profile.feedbackBias : insight.feedbackBias;
    if (liveFb != null && Math.abs(liveFb) > 0.005) {
        const dir = liveFb > 0 ? '消行好于预期→微加压' : '消行不足→微减压';
        lines.push(`闭环反馈 ${liveFb > 0 ? '+' : ''}${liveFb.toFixed(3)}：出块后 4 步${dir}。`);
    }
    if (insight.stressBreakdown?.boardRisk != null && insight.stressBreakdown.boardRisk > 0.35) {
        const br = insight.stressBreakdown.boardRisk;
        const relief = insight.stressBreakdown.boardRiskReliefAdjust ?? 0;
        lines.push(`盘面风险 ${br.toFixed(2)}：综合填充、空洞和能力风险，stress 风险救济 ${relief.toFixed(3)}。`);
    }
    if (insight.spawnTargets) {
        const t = insight.spawnTargets;
        lines.push(`多轴目标：复杂${_pct(t.shapeComplexity)}、解空间压力${_pct(t.solutionSpacePressure)}、消行机会${_pct(t.clearOpportunity)}、payoff${_pct(t.payoffIntensity)}。`);
    }
    if (insight.frustration >= (GAME_RULES.adaptiveSpawn?.engagement?.frustrationThreshold ?? 4)) {
        lines.push('连续多步未消行 → 触发挫败救济（降压 + 消行友好 + 偏小快）。');
    }
    if (insight.profileAtSpawn?.hadRecentNearMiss) {
        lines.push('上一步「差一点」满行未消 → near-miss 策略：降压并提高消行保证。');
    }
    if (insight.profileAtSpawn?.needsRecovery) {
        lines.push('板面曾处于高填充 → 短期恢复模式：更小、更易消行的投放。');
    }
    if (insight.profileAtSpawn?.isInOnboarding) {
        lines.push('新手保护窗口：stress 上限压低，形状更规整易学。');
    }
    if (insight.momentum > 0.25) {
        lines.push('近期消行率上升 → 轻微 combo 奖励加压（正反馈）。');
    }
    if (insight.profileAtSpawn?.afkCount > 0) {
        lines.push(`窗口内 ${insight.profileAtSpawn.afkCount} 次 AFK（>15s）已排除出指标计算。`);
    }
    return lines;
}

function _render(game) {
    const root = document.getElementById('player-insight-panel');
    if (!root) return;

    const p = game.playerProfile;
    const ins = game._lastAdaptiveInsight;
    const liveTopology = game.grid ? analyzeBoardTopology(game.grid) : null;
    const liveBoardFill = liveTopology?.fillRatio ?? game.grid?.getFillRatio?.() ?? 0;
    const ability = buildPlayerAbilityVector(p, {
        grid: game.grid,
        topology: liveTopology,
        boardFill: liveBoardFill,
        gameStats: game.gameStats,
        spawnContext: game._spawnContext,
        adaptiveInsight: ins,
    });

    const elAbility = document.getElementById('insight-ability');
    const elState = document.getElementById('insight-state');
    const elSpawn = document.getElementById('insight-spawn');
    const elWhy = document.getElementById('insight-why');
    const elStressMeter = document.getElementById('stress-meter-host');

    if (elStressMeter) {
        // 历史 stress 序列：从 _insightLiveHistory 抽取，已包含本帧（_renderInsightStateSeries 会 append）
        const hist = Array.isArray(game._insightLiveHistory)
            ? game._insightLiveHistory.map((s) => s?.adaptive?.stress).filter((v) => Number.isFinite(v))
            : [];
        renderStressMeter(elStressMeter, ins, hist);
    }

    if (elAbility) {
        /* v1.13：冷启动隔离 ——
         * controlScore 依赖 missRate（recent.length），clearEfficiency 依赖
         * clearRate/comboRate（active.length），冷启动时这些来自 PlayerProfile.metrics
         * 的占位值（missRate=0.1 / clearRate=0.3 / comboRate=0.1），ability 计算结果约
         * 0.69 / 0.36 — 与玩家「我还没下任何块」的真实状态严重不符。
         * 这两项在冷启动时改显「—」（保留 hover 解释），其它依赖盘面/历史的指标维持原值。
         */
        const mm = p.metrics || {};
        const samples = Number(mm.samples ?? 0) || 0;
        const activeSamples = Number(mm.activeSamples ?? 0) || 0;
        const COLD_HINT = '\n（开局尚未采集到落子样本，该指标暂为「—」，下手后立即填实。）';
        const controlCold = samples < 1;
        const clearCold = activeSamples < 1;
        const abilityHtml = ABILITY_METRIC_ROWS.map((row) => {
            let cold = false;
            if (row.key === 'controlScore') cold = controlCold;
            else if (row.key === 'clearEfficiency') cold = clearCold;
            const tt = (row.tooltip || '') + (cold ? COLD_HINT : '');
            const val = cold ? '—' : _pct(ability[row.key]);
            return `<div class="insight-metric${cold ? ' insight-metric--cold' : ''}" title="${_attrTitle(tt)}"><span>${row.label}</span><strong>${val}</strong></div>`;
        }).join('');

        elAbility.innerHTML = abilityHtml;
    }

    if (elState) {
        _renderInsightStateSeries(game, elState);
        const afk = p.metrics.afkCount;
        const flags = [];
        /* 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P0-5：把生命周期阶段（S0–S4）与
         * 成熟度 band（M0–M4）做成单一标签，与 AFK/近失/恢复/新手 同屏展示，让局内
         * 策略与运营标签同源。snapshot 内部直接读 playerMaturity / playerLifecycleDashboard
         * 单例，对未初始化的开发模式（无 localStorage 历史）退化为 S0·M0，不阻塞渲染。 */
        try {
            const snap = getLifecycleMaturitySnapshot({
                daysSinceInstall: p?.profile?.daysSinceInstall
                    ?? game?.gameStats?.daysSinceInstall
                    ?? 0,
                totalSessions: p?.profile?.totalSessions
                    ?? game?.gameStats?.totalSessions
                    ?? 0,
                daysSinceLastActive: p?.profile?.daysSinceLastActive
                    ?? game?.gameStats?.daysSinceLastActive
                    ?? 0,
            });
            if (snap?.shortLabel) {
                flags.push(snap.shortLabel);
            }
        } catch { /* lifecycle 数据缺失不应阻塞画像面板 */ }
        if (afk > 0) flags.push(`AFK ${afk}`);
        if (p.hadRecentNearMiss) flags.push('近失');
        if (p.needsRecovery) flags.push('恢复');
        if (p.isInOnboarding) flags.push('新手');
        if (flags.length) {
            const note = document.createElement('div');
            note.className = 'insight-live-flags';
            note.innerHTML = flags
                .map(
                    (t) =>
                        `<span class="insight-signal insight-signal--warn" title="${_attrTitle(_tooltipForLiveFlag(t))}">${t}</span>`
                )
                .join(' ');
            if (!elState.querySelector('.insight-live-flags')) {
                elState.appendChild(note);
            } else {
                elState.querySelector('.insight-live-flags').replaceWith(note);
            }
        } else {
            elState.querySelector('.insight-live-flags')?.remove();
        }
    }

    if (elSpawn && ins) {
        const shapeWeightChart = _shapeWeightChartHtml(ins.shapeWeightsTop);
        const h = ins.spawnHints;
        const metricPills = [];

        /* v1.19：救济 pill 自动化 —— 替代 v1.18 硬编码 frustrationRelief /
         * recoveryAdjust / nearMissAdjust 三件套。改为自动挑出当前帧
         * stressBreakdown 里贡献最大的 top-2 负向分量（≥ 0.04），覆盖：
         *   - 挫败/恢复/近失（v1.18 已支持）
         *   - flowAdjust / pacingAdjust / boardRiskRelief / friendlyBoardRelief 等
         *     "广义救济"（v1.18 无法显示）
         * 解决场景：spawnIntent='relief'（来自 delight.mode）但 frustration/recovery
         * /nearMiss 三件套都为 0，玩家看不出"是谁在救济我"。
         * 复用 stressMeter.summarizeContributors，标签和 hint 已在 SIGNAL_LABELS 同源。
         */
        const sb = ins?.stressBreakdown;
        if (sb) {
            const _fmtSigned = (v) => {
                const sign = v >= 0 ? '+' : '−';
                return `${sign}${Math.abs(v).toFixed(2)}`;
            };
            const negativeContribs = summarizeContributors(sb, 12)
                .filter((c) => c.value < 0 && Math.abs(c.value) >= 0.04)
                .filter((c) => !CHARTED_STRESS_BREAKDOWN_KEYS.has(c.key))
                .slice(0, 2);
            for (const c of negativeContribs) {
                const label = c.label || c.key;
                const hint = c.hint || `${label}：当前对综合 stress 的负向贡献 ${_fmtSigned(c.value)}。`;
                metricPills.push(_spawnPill(`${label} ${_fmtSigned(c.value)}`, hint));
            }
        }
        let spawnDecisionCard = '';
        if (h) {
            /* v1.21：spawn 决策类 pill 之前插入"📷 R{n} spawn 快照"分隔 marker —— 
             * 让玩家明白下面这串 pill（意图/目标保消/节奏/弧线/连击/多消/多线×/形状权重）
             * 是【上一次 spawn 时的决策】，spawn 后保持不变；与上方 live pill 
             * （压力/F(t)/闭环反馈/占用/救济通路）和下方 live 几何 pill（多消候选/
             * 近满/空洞/平整/解法/合法序）分开理解，避免"决策说兑现 + live 几何 0 多消候选"
             * 看起来像撞墙（其实只是时序错位）。 */
            const round = Number.isFinite(p?.spawnRoundIndex) ? p.spawnRoundIndex : null;
            const roundLabel = round != null ? `R${round}` : '—';
            const snapshotTip = `这是 ${roundLabel} 候选块生成时锁定的出块决策快照；spawn 后保持不变，直到下一轮候选块刷新。它解释“系统当时为什么这样出块”，与实时盘面指标不同步是预期行为。`;
            const decisionCells = [];

            const intent = ins?.spawnIntent ?? h.spawnIntent ?? null;
            if (intent) {
                const intentLabel = SPAWN_INTENT_LABEL[intent] ?? intent;
                decisionCells.push(_decisionCell('意图', intentLabel, SPAWN_TOOLTIP.spawnIntent));
            }
            const motivation = h.motivationIntent ?? ins?._motivationIntent;
            if (motivation && motivation !== 'balanced') {
                decisionCells.push(_decisionCell('动机', MOTIVATION_INTENT_LABEL[motivation] ?? motivation, SPAWN_TOOLTIP.motivationIntent));
            }
            const segment = h.behaviorSegment ?? ins?._behaviorSegment;
            if (segment && segment !== 'balanced') {
                decisionCells.push(_decisionCell('画像', BEHAVIOR_SEGMENT_LABEL[segment] ?? segment, SPAWN_TOOLTIP.behaviorSegment));
            }
            if ((h.returningWarmupStrength ?? 0) >= 0.35) {
                decisionCells.push(_decisionCell('回归', `${Math.round(h.returningWarmupStrength * 100)}%`, SPAWN_TOOLTIP.returningWarmup));
            }
            if ((h.accessibilityLoad ?? 0) >= 0.35) {
                decisionCells.push(_decisionCell('负担', `${Math.round(h.accessibilityLoad * 100)}%`, SPAWN_TOOLTIP.accessibilityLoad));
            }
            if (h.socialFairChallenge) {
                decisionCells.push(_decisionCell('公平', '固定', SPAWN_TOOLTIP.socialFairChallenge));
            }
            decisionCells.push(
                _decisionCell('保消', h.clearGuarantee, SPAWN_TOOLTIP.clearG),
                _decisionCell('尺寸', (h.sizePreference ?? 0).toFixed(1), SPAWN_TOOLTIP.sizePref),
                _decisionCell('多样', (h.diversityBoost ?? 0).toFixed(1), SPAWN_TOOLTIP.diversity)
            );
            if (h.rhythmPhase && h.rhythmPhase !== 'neutral') {
                const phaseLabel = h.rhythmPhase === 'payoff' ? '收获' : '搭建';
                decisionCells.push(_decisionCell('节奏', phaseLabel, SPAWN_TOOLTIP.rhythm));
            }
            if (h.sessionArc) {
                const arcLabel = { warmup: '热身', peak: '巅峰', cooldown: '收官' }[h.sessionArc] ?? h.sessionArc;
                decisionCells.push(_decisionCell('弧线', arcLabel, SPAWN_TOOLTIP.sessionArc));
            }
            const cc = h.comboChain ?? 0;
            if (cc > 0.1) decisionCells.push(_decisionCell('连击', cc.toFixed(2), SPAWN_TOOLTIP.comboChain));
            const mc = h.multiClearBonus ?? 0;
            if (mc > 0.1) decisionCells.push(_decisionCell('多消', mc.toFixed(2), SPAWN_TOOLTIP.multiClear));
            const ml = h.multiLineTarget ?? 0;
            if (ml >= 1) decisionCells.push(_decisionCell('多线', `×${ml}`, SPAWN_TOOLTIP.multiLineTarget));
            const ps = game.playerProfile?.playstyle ?? 'balanced';
            const psLabel = PLAYSTYLE_LABEL[ps] ?? ps;
            const psTip = PLAYSTYLE_TOOLTIP[ps] ?? '';
            decisionCells.push(_decisionCell('偏好', psLabel, psTip));

            spawnDecisionCard =
                `<div class="spawn-decision-card" style="text-align:left" title="${_attrTitle(snapshotTip)}">` +
                    `<div class="spawn-decision-card__head" style="text-align:left">` +
                        `<span>📷 ${roundLabel} spawn 决策快照</span>` +
                    `</div>` +
                    `<div class="spawn-decision-grid">${decisionCells.join('')}</div>` +
                `</div>`;
        }

        const diagPills = [];
        const diag = ins.spawnDiagnostics;
        if (liveTopology || diag?.layer1) {
            const l1 = diag?.layer1 || {};
            const flatness = liveTopology?.flatness ?? l1.flatness;
            const nearFullLines = liveTopology?.nearFullLines ?? l1.nearFullLines ?? 0;
            /* 「空洞」已并入上方实时状态 sparkline（topologyHoles），此处不再重复 pill */
            if (flatness != null) diagPills.push(_spawnPill(`平整 ${flatness.toFixed(2)}`, SPAWN_TOOLTIP.flatness));
            if (nearFullLines > 0) diagPills.push(_spawnPill(`近满 ${nearFullLines}`, SPAWN_TOOLTIP.nearFull));
            const liveMultiCandidates = _countLiveMultiClearCandidates(game.grid, game.dockBlocks);
            if (liveMultiCandidates != null) {
                diagPills.push(_spawnPill(`多消候选 ${liveMultiCandidates}`, SPAWN_TOOLTIP.multiClear));
            }
            const livePerfectCandidates = _countLivePerfectClearCandidates(game.grid, liveTopology);
            if (livePerfectCandidates > 0) {
                diagPills.push(_spawnPill(`清屏候选 ${livePerfectCandidates}`, SPAWN_TOOLTIP.perfectClearCandidates));
            }
            // 解法 = 未放置候选可落子数之和（Game 侧按 dock 签名缓存）；无则回退 spawn 时 DFS 口径
            const liveSm = _placementSolutionForGame(game);
            const sm = liveSm ?? l1.solutionMetrics;
            if (sm) {
                /* 「解法」已在上方曲线 tripletSolutionCount 展示；这里仅保留曲线未覆盖的瓶颈首手自由度。 */
                if (Number.isFinite(sm.firstMoveFreedom)) {
                    diagPills.push(_spawnPill(`首手 ${sm.firstMoveFreedom}`, SPAWN_TOOLTIP.firstMoveFreedom));
                }
            }
            const tsr = l1.targetSolutionRange;
            if (tsr && (tsr.min != null || tsr.max != null)) {
                const minStr = tsr.min != null ? tsr.min : '—';
                const maxStr = tsr.max != null ? tsr.max : '∞';
                const label = tsr.label ? `${tsr.label} ` : '';
                diagPills.push(_spawnPill(`区间 ${label}[${minStr}, ${maxStr}]`, SPAWN_TOOLTIP.targetSolutionRange));
            }
        }

        const fallbackRow = _spawnModeFallbackRowHtml(ins);

        const allPills = [
            ...metricPills,
            ...diagPills
        ];
        const allRows = [
            fallbackRow,
            allPills.length ? `<div class="insight-weights insight-weights--compact">${allPills.join('')}</div>` : '',
            spawnDecisionCard,
            shapeWeightChart
        ].filter(Boolean).join('');

        elSpawn.innerHTML = `<div class="insight-spawn-stack" style="text-align:left">${allRows}</div>`;
    } else if (elSpawn) {
        elSpawn.innerHTML =
            `<div class="insight-spawn-stack">` +
            `<span class="insight-muted">开局后显示投放参数（出块模式见上方实时状态顶栏）</span>` +
            `</div>`;
    }

    const elStrategy = document.getElementById('insight-strategy');
    const gridInfo = game.grid ? {
        fillRatio: game.grid.getFillRatio(),
        maxHeight: _gridMaxHeight(game.grid),
        holesCount: _gridHoles(game.grid),
        liveTopology,
        liveMultiClearCandidates: _countLiveMultiClearCandidates(game.grid, game.dockBlocks),
        liveSolutionMetrics: _placementSolutionForGame(game)
    } : undefined;
    const tips = generateStrategyTips(p, ins, gridInfo);

    if (elStrategy) {
        elStrategy.style.textAlign = 'left';
        /* v1.20：把 live 几何（liveTopology + liveMultiClearCandidates）注入
         * gridInfo，让 strategyAdvisor 多消机会卡 / 瓶颈块卡读 live、不再走
         * spawn-time snapshot，消除"卡说有 4 多消、面板 pill 显示 0"的撞墙。
         * liveTopology 上方已经算过（用于 ability 与 diagPills），这里直接复用。 */
        if (tips.length > 0) {
            const cards = tips.map(t => {
                const catCls = `strategy-tip--${t.category}`;
                return `<div class="strategy-tip ${catCls}">` +
                    `<span class="strategy-tip-icon">${t.icon}</span>` +
                    `<div class="strategy-tip-body">` +
                    `<strong class="strategy-tip-title">${t.title}</strong>` +
                    `<span class="strategy-tip-detail">${t.detail}</span>` +
                    `</div></div>`;
            }).join('');
            elStrategy.innerHTML = cards;
        } else {
            elStrategy.innerHTML = '';
        }
    }

    if (elWhy) {
        elWhy.style.textAlign = 'left';
        const adaptiveBullets = ins ? _buildWhyLines(ins, p) : [];
        const spawnBullets = ins?.spawnHints ? _hintsExplain(ins.spawnHints) : [];
        const lifecycleBullets = [];
        if (tips?.length > 0) {
            const lifecycleTip = tips.find(t => t.category === 'lifecycle');
            if (lifecycleTip) {
                lifecycleBullets.push(`${lifecycleTip.title}：${lifecycleTip.detail}`);
            }
        }

        const htmlParts = [];
        if (adaptiveBullets.length) {
            htmlParts.push(`<div class="why-group"><div class="why-group-label">📊 自适应出块</div><ul class="insight-why-list">${adaptiveBullets.map(t => `<li>${_stripTrailingSentencePunct(t)}</li>`).join('')}</ul></div>`);
        }
        if (spawnBullets.length) {
            htmlParts.push(`<div class="why-group"><div class="why-group-label">🎯 出块决策</div><ul class="insight-why-list">${spawnBullets.map(t => `<li>${_stripTrailingSentencePunct(t)}</li>`).join('')}</ul></div>`);
        }
        if (lifecycleBullets.length) {
            htmlParts.push(`<div class="why-group"><div class="why-group-label">📱 生命周期</div><ul class="insight-why-list">${lifecycleBullets.map(t => `<li>${_stripTrailingSentencePunct(t)}</li>`).join('')}</ul></div>`);
        }

        elWhy.innerHTML = htmlParts.length ? htmlParts.join('') : '';
    }
}

function _blockLabel(idx) {
    return ['左', '中', '右'][idx] ?? `#${idx}`;
}

function _renderHints(game) {
    const section = document.getElementById('insight-hints-section');
    const list = document.getElementById('insight-hints-list');
    if (!section || !list) return;

    const blocks = game.dockBlocks;
    if (!blocks || blocks.length === 0 || game.isGameOver) {
        section.hidden = true;
        return;
    }

    const hints = computeHints(game.grid, blocks, 3);
    if (hints.length === 0) {
        section.hidden = false;
        section.open = true;
        list.innerHTML = '<p class="insight-muted">无合法落子可用。</p>';
        return;
    }

    section.hidden = false;
    section.open = true;
    const items = hints.map((h, rank) => {
        const medal = ['🥇', '🥈', '🥉'][rank] ?? `${rank + 1}.`;
        const label = _blockLabel(h.blockIdx);
        const pos = `(${h.gx}, ${h.gy})`;
        const score = h.totalScore.toFixed(1);
        const bullets = h.explain.map(e => `<li>${e}</li>`).join('');
        const survCls = h.scores.survivalScore > 0 ? 'hint-safe' : 'hint-danger';
        return `
            <div class="hint-card hint-card--rank${rank}" data-bx="${h.blockIdx}" data-gx="${h.gx}" data-gy="${h.gy}">
                <div class="hint-header">
                    <span class="hint-medal">${medal}</span>
                    <span class="hint-block">${label}块</span>
                    <span class="hint-pos">→ ${pos}</span>
                    <span class="hint-score ${survCls}">${score} pt</span>
                </div>
                <ul class="hint-reasons">${bullets}</ul>
            </div>`;
    }).join('');
    list.innerHTML = items;

    list.querySelectorAll('.hint-card').forEach(card => {
        card.onmouseenter = () => {
            const bi = parseInt(card.dataset.bx);
            const gx = parseInt(card.dataset.gx);
            const gy = parseInt(card.dataset.gy);
            const b = game.dockBlocks[bi];
            if (b && !b.placed && game.grid.canPlace(b.shape, gx, gy)) {
                game.previewBlock = b;
                game.previewPos = { x: gx, y: gy };
                game.markDirty();
                const oc = game.grid.previewClearOutcome(b.shape, gx, gy, b.colorIdx);
                if (oc?.cells?.length) {
                    game._ensurePreviewClearAnim();
                }
            }
        };
        card.onmouseleave = () => {
            game._cancelPreviewClearAnim();
            game.previewBlock = null;
            game.previewPos = null;
            game.markDirty();
        };
    });
}

function _clearHints(game) {
    const section = document.getElementById('insight-hints-section');
    const list = document.getElementById('insight-hints-list');
    if (!section || !list) return;

    section.open = false;
    section.hidden = true;
    list.innerHTML = '';
    game?._cancelPreviewClearAnim?.();
    if (game) {
        game.previewBlock = null;
        game.previewPos = null;
        game.markDirty?.();
    }
}

/**
 * 回放专用：把 frames[idx] 的 ps 快照投射回画像面板顶部的「实时状态」拟人化压力表。
 *
 * 触发场景：用户拉动 #replay-slider / 点击播放后，replayUI 每推进一帧会调用本函数，
 * 让蓝色框出的「实时状态」卡（stress meter）随回放帧实时变化。
 *
 * 设计取舍：
 *   - v1.13 起帧 ps 同时持久化 `adaptive.{stress, stressBreakdown, spawnTargets, spawnHints}`，
 *     stressMeter 在回放期间能完整复现「主要构成 · 当前帧」分量与节奏叙事；老回放（无
 *     breakdown / targets 字段）会自动降级到 vibe + 「本帧无明显信号偏移」。
 *   - history 来源于 `frames[0..idx].ps.adaptive.stress`，与 LIVE 时 `_insightLiveHistory`
 *     语义一致，可直接喂给 `renderStressMeter` 计算趋势箭头。
 *
 * @param {object[]} frames 回放帧序列（与 replayUI 内 replayFramesRef 同源）
 * @param {number}   idx    当前帧下标
 */
function renderStressMeterReplay(frames, idx) {
    const host = document.getElementById('stress-meter-host');
    if (!host || !Array.isArray(frames) || frames.length === 0) return;

    const cap = Math.min(Math.max(0, idx | 0), frames.length - 1);

    // 1) 累积 stress 历史：仅取真实写入了 adaptive.stress 的帧（避免 NaN 把趋势带歪）
    const history = [];
    for (let i = 0; i <= cap; i++) {
        const s = frames[i]?.ps?.adaptive?.stress;
        if (Number.isFinite(s)) history.push(s);
    }

    // 2) 取当前帧 ps；若为 spawn/place 帧但 ps 缺失，向前回找最近的 ps（与 sparkline 一致）
    let curPs = null;
    for (let i = cap; i >= 0; i--) {
        if (frames[i]?.ps) { curPs = frames[i].ps; break; }
    }
    const adaptive = curPs?.adaptive || {};

    // 3) 合成 stressMeter 期望的 insight 形态；breakdown/targets 在 v1.13 起已持久化，
    //    老回放（pv=2 早期没有这两个字段）取到 undefined 时 stressMeter 会自动降级。
    const insight = {
        adaptiveEnabled: true,
        stress: Number.isFinite(adaptive.stress) ? adaptive.stress : 0,
        stressBreakdown: adaptive.stressBreakdown ?? null,
        spawnTargets: adaptive.spawnTargets ?? null,
        spawnHints: adaptive.spawnHints ?? null
    };
    renderStressMeter(host, insight, history);
}

/* v1.13：上方"实时状态"面板的回放模式状态 ——
 *   replayUI 在 openView 时调用 enterInsightReplay(frames)：一次性画完整 sparkline 曲线，
 *   缓存每个 cell 的游标线 + 数值文本节点引用；推进帧时 updateInsightReplayFrame(idx) 只
 *   平移游标 + 更新数值文本 + 更新 head tag 行（不重绘曲线本身），与回放面板旧版
 *   _initSeries / _updateSeries 同款行为；返回列表时 exitInsightReplay() 清空状态。
 *
 * 这种「曲线静止 / 游标滑动」语义比"按 idx 切片重绘"更符合心智模型：曲线代表整局走势，
 * 滑块决定当前帧位置，能直观判断"现在在曲线哪个位置"。
 */
let _insightReplayFrames = null;
/** @type {{ key:string, fmt:string, cursorLine:Element|null, valueEl:Element|null }[]} */
let _insightReplayCells = [];
let _insightReplayTotalFrames = 0;

/** 是否处于"实时状态"回放模式（外部调试用） */
function _isInsightReplayMode() {
    return _insightReplayFrames !== null;
}

/**
 * 进入实时状态回放模式：一次性把上方 sparkline 网格按 frames 全量画完，
 * 缓存每个 cell 的游标 + 数值节点；后续 updateInsightReplayFrame 只挪游标。
 *
 * @param {object[]} frames 回放帧序列（与 replayUI 内 replayFramesRef 同源）
 */
export function enterInsightReplay(frames) {
    _insightReplayCells = [];
    _insightReplayTotalFrames = 0;
    if (!Array.isArray(frames) || frames.length === 0) {
        _insightReplayFrames = null;
        return;
    }
    _insightReplayFrames = frames;

    const elState = document.getElementById('insight-state');
    if (!elState) return;

    // 用 frames 全部 ps 作为完整 history（注意：ps 帧可能稀疏，collectSeriesFromSnapshots
    // 内部会按 PS_VERSION / pv 自动跳过空帧），曲线一次性画完，永不重绘。
    const hist = [];
    for (const f of frames) {
        if (f?.ps && typeof f.ps === 'object') hist.push(f.ps);
    }
    const data = collectSeriesFromSnapshots(hist);

    const headChipHtml =
        '<span class="insight-weight insight-weight--mode-primary insight-spawn-mode-chip" ' +
        'title="回放模式：曲线为整局完整走势；游标随下方滑块/播放按钮按 step 滑动。">📼 回放</span>';

    if (!data || hist.length === 0) {
        elState.className = 'insight-state-row insight-state-series';
        elState.innerHTML =
            '<div class="replay-series-header insight-live-series-head" id="insight-live-series-head"></div>' +
            '<span class="insight-muted">回放数据不含指标快照，无法绘制曲线。</span>';
        const headEmpty = document.getElementById('insight-live-series-head');
        if (headEmpty) {
            headEmpty.innerHTML = '<div class="insight-live-head-tags"></div>' + headChipHtml;
        }
        return;
    }

    let html =
        '<div class="replay-series-header insight-live-series-head" id="insight-live-series-head"></div>';
    html += '<div class="replay-series-grid insight-live-series-grid">';
    for (let i = 0; i < data.metrics.length; i++) {
        const m = data.metrics[i];
        const s = data.series[m.key];
        const color = METRIC_GROUP_COLORS[m.group] || '#5b9bd5';
        const labelColor = getMetricLabelColor(m.key, color, i);
        const cellTip = _METRIC_TOOLTIP_BY_KEY[m.key] || '';
        html +=
            `<div class="replay-series-cell" data-key="${m.key}" title="${_attrTitle(cellTip)}">` +
            `<span class="series-label series-label--metric" style="--series-label-color:${labelColor}">${m.label}</span>` +
            `<div class="series-spark-wrap">${sparklineSvg(s.points, data.totalFrames, color)}</div>` +
            `<span class="series-value">—</span></div>`;
    }
    html += '</div>';
    elState.innerHTML = html;
    elState.className = 'insight-state-row insight-state-series';

    const head = document.getElementById('insight-live-series-head');
    if (head) {
        head.innerHTML = '<div class="insight-live-head-tags"></div>' + headChipHtml;
    }

    // 缓存每个 cell 的游标 + 数值节点，update 阶段只对它们操作（与 replayUI 旧 _initSeries 同款）。
    _insightReplayTotalFrames = data.totalFrames;
    for (const m of data.metrics) {
        const cell = elState.querySelector(`.replay-series-cell[data-key="${m.key}"]`);
        if (!cell) continue;
        const svg = cell.querySelector('.replay-sparkline');
        const cursorLine = svg?.querySelector('.spark-cursor') ?? null;
        const valueEl = cell.querySelector('.series-value');
        _insightReplayCells.push({
            key: m.key,
            fmt: m.fmt,
            cursorLine,
            valueEl
        });
    }
}

/**
 * 退出回放模式，清空缓存。下次 game._playerInsightRefresh() 即由 LIVE 接管。
 */
export function exitInsightReplay() {
    _insightReplayFrames = null;
    _insightReplayCells = [];
    _insightReplayTotalFrames = 0;
}

/**
 * 推进回放当前帧（只滑游标 + 改数值 + 改 tag 行 + 刷新 stressMeter，不重绘曲线本身）。
 * 仅在 enterInsightReplay 已调用且画出曲线后才会工作；否则空转。
 *
 * @param {number} idx 当前帧下标（基于 frames 全长，0 ≤ idx ≤ frames.length-1）
 */
export function updateInsightReplayFrame(idx) {
    if (!_insightReplayFrames) return;
    const frames = _insightReplayFrames;
    renderStressMeterReplay(frames, idx);

    if (_insightReplayCells.length === 0) return;

    const cap = Math.min(Math.max(0, idx | 0), frames.length - 1);
    // 取当前帧 ps（spawn / place 帧无 ps 时回退到最近的 ps，与 stressMeter 行为一致）
    let curPs = null;
    for (let i = cap; i >= 0; i--) {
        if (frames[i]?.ps) { curPs = frames[i].ps; break; }
    }

    const maxIdx = Math.max(_insightReplayTotalFrames - 1, 1);
    const cx = (cap / maxIdx) * SPARK_W;

    for (const c of _insightReplayCells) {
        if (c.cursorLine) {
            c.cursorLine.setAttribute('x1', cx.toFixed(1));
            c.cursorLine.setAttribute('x2', cx.toFixed(1));
        }
        const val = curPs ? getMetricFromPS(curPs, c.key) : null;
        if (c.valueEl) c.valueEl.textContent = formatMetricValue(val, c.fmt);
    }

    // tag 行（flow/release/peak/R{n}）随当前帧切换
    const headTags = document.querySelector('#insight-live-series-head .insight-live-head-tags');
    if (headTags && curPs) {
        const tags = [
            curPs.flowState || '—',
            curPs.pacingPhase || '—',
            curPs.sessionPhase || '—',
            'R' + (curPs.spawnRound ?? '—')
        ];
        headTags.innerHTML = tags
            .map(
                (t) =>
                    `<span class="series-tag" title="${_attrTitle(_tooltipForLiveTag(t))}">${t}</span>`
            )
            .join('');
    }
}

export function initPlayerInsightPanel(game) {
    game._playerInsightRefresh = () => _render(game);
    game.clearInsightHints = () => _clearHints(game);

    const btnNew = document.getElementById('insight-new-game');
    const btnRestart = document.getElementById('insight-restart');
    const btnHint = document.getElementById('insight-hint');

    if (btnNew) {
        btnNew.onclick = () => {
            game.runStreak = 0;
            const menu = document.getElementById('menu');
            if (menu) {
                menu.classList.add('active');
                game.updateShellVisibility();
            }
        };
    }
    if (btnRestart) {
        btnRestart.onclick = () => void game.start({ fromChain: true });
    }
    if (btnHint) {
        btnHint.onclick = () => _renderHints(game);
    }

    _render(game);
}
