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
import { sparklineSvg, SPARK_W, METRIC_GROUP_COLORS } from './sparkline.js';
import { getSpawnMode, SPAWN_MODE_MODEL_V3 } from './spawnModel.js';
import { UI_ICONS } from './uiIcons.js';
import { analyzeBoardTopology, countUnfillableCells } from './boardTopology.js';
import { buildPlayerAbilityVector } from './playerAbilityModel.js';
import { getAllShapes } from './shapes.js';

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

/** 实时状态顶栏标签（心流 / 节奏 / 会话阶段 / 出块轮） */
const LIVE_TAG_TITLE = {
    flow: {
        bored: '心流三态·无聊：挑战相对偏低，系统可略加压以增加趣味与投入。',
        flow: '心流三态·心流：挑战与能力较匹配，维持当前难度与反馈节奏。',
        anxious: '心流三态·焦虑：挑战偏高或失误偏多，系统倾向减压与消行友好投放。'
    },
    pacing: {
        tension: '节奏相位·紧张期：与释放期交替，略提高张力，形成起伏感。',
        release: '节奏相位·释放期：略降低压力，给玩家喘息与正反馈空间。'
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

const SPAWN_TOOLTIP = {
    stress:
        '综合压力（约 −0.2～1）。由分数档、连战、技能、心流、节奏、恢复、挫败、combo、近失、闭环反馈等叠加后钳制，用于在配置的多档形状权重间插值。',
    flowDev:
        '心流偏移 F(t)：挑战与能力匹配的偏离程度；参与无聊/焦虑方向的 stress 微调。',
    feedback:
        '闭环反馈：每轮新出块后，在若干步放置窗口内统计消行表现，对 stress 做小幅偏移（正≈好于预期可略加压，负≈不及预期减压）。',
    boardFill: '当前棋盘占用率（已占格÷总格），不是开局预填比例 fillRatio。',
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
        '解法数量（v9）：当前盘面下，三连块所有 6 种放置顺序中能完整放下的「不同放置位置组合」总数。带 + 表示已截断到 leafCap，实际更多。数字越大→局面越宽松；越小→玩家需要精算。仅在 fill ≥ activationFill 时评估。',
    validPerms:
        '合法排列数（v9）：三连块在 6 种放置顺序中至少存在 1 个完整放置方案的顺序数（0–6）。1 表示只有唯一一条解链；6 表示任意顺序都能下完——解链越多越宽松。',
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

function _countLiveMultiClearCandidates(grid) {
    if (!grid) return null;
    let count = 0;
    for (const shape of getAllShapes()) {
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
    return phase === 'release'
        ? '节奏相位：松弛期（略降低压力，给喘息）。'
        : '节奏相位：紧张期（略提高张力）。';
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
    /** @type {Record<string, unknown>} */
    const slim = {
        pv: 1,
        phase: 'live',
        score: game.score,
        boardFill: game.grid?.getFillRatio?.() ?? 0,
        skill: p.skillLevel,
        momentum: p.momentum,
        cognitiveLoad: p.cognitiveLoad,
        engagementAPM: p.engagementAPM,
        flowDeviation: p.flowDeviation,
        flowState: p.flowState,
        pacingPhase: p.pacingPhase,
        frustration: p.frustrationLevel,
        sessionPhase: p.sessionPhase,
        spawnRound: p.spawnRoundIndex,
        feedbackBias: p.feedbackBias,
        ability,
        metrics: {
            thinkMs: m.thinkMs,
            clearRate: m.clearRate,
            comboRate: m.comboRate,
            missRate: m.missRate,
            afkCount: m.afkCount
        }
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
            shapeWeightsTop: ins.shapeWeightsTop ?? null
        };
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
 * 实时状态：与回放面板同款指标 sparkline，游标始终在本局最新样本
 */
function _renderInsightStateSeries(game, elState) {
    _appendLiveInsightSample(game);
    const hist = game._insightLiveHistory || [];
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
    for (const m of data.metrics) {
        const s = data.series[m.key];
        const color = METRIC_GROUP_COLORS[m.group] || '#5b9bd5';
        const cellTip = _METRIC_TOOLTIP_BY_KEY[m.key] || '';
        html +=
            `<div class="replay-series-cell" data-key="${m.key}" title="${_attrTitle(cellTip)}">` +
            `<span class="series-label" style="color:${color}">${m.label}</span>` +
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

function _buildWhyLines(insight) {
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
    if (insight.flowDeviation != null) {
        const fd = insight.flowDeviation;
        const fdDesc = fd < 0.25 ? '沉浸区' : fd < 0.5 ? '轻度偏移' : '显著偏移';
        lines.push(`心流偏移 F(t)=${fd.toFixed(2)}（${fdDesc}）→ ${insight.flowState} 方向修正幅度随偏移放大。`);
    } else {
        lines.push(_flowExplain(insight.flowState));
    }
    lines.push(_pacingExplain(insight.pacingPhase));
    if (insight.feedbackBias != null && Math.abs(insight.feedbackBias) > 0.005) {
        const fb = insight.feedbackBias;
        const dir = fb > 0 ? '消行好于预期→微加压' : '消行不足→微减压';
        lines.push(`闭环反馈 ${fb > 0 ? '+' : ''}${fb.toFixed(3)}：出块后 4 步${dir}。`);
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

    if (elAbility) {
        const abilityHtml = ABILITY_METRIC_ROWS.map((row) => {
            const tt = row.tooltip || '';
            const val = _pct(ability[row.key]);
            return `<div class="insight-metric" title="${_attrTitle(tt)}"><span>${row.label}</span><strong>${val}</strong></div>`;
        }).join('');

        elAbility.innerHTML = abilityHtml;
    }

    if (elState) {
        _renderInsightStateSeries(game, elState);
        const afk = p.metrics.afkCount;
        const flags = [];
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
        const s = ins.stress;
        const weightPills = (ins.shapeWeightsTop || [])
            .map(
                (w) =>
                    `<span class="insight-weight" title="${_attrTitle(SPAWN_TOOLTIP.shapeW)}">` +
                    `${CAT_LABEL[w.category] || w.category} ${w.weight.toFixed(1)}</span>`
            );
        const h = ins.spawnHints;
        const stressStr = typeof s === 'number' ? s.toFixed(2) : '—';
        const fillStr = `${(liveBoardFill * 100).toFixed(0)}%`;
        const fdStr = ins.flowDeviation != null ? ins.flowDeviation.toFixed(2) : '—';
        const fbStr = ins.feedbackBias != null ? (ins.feedbackBias >= 0 ? '+' : '') + ins.feedbackBias.toFixed(3) : '—';
        const metricPills = [
            _spawnPill(`压力 ${stressStr}`, SPAWN_TOOLTIP.stress),
            _spawnPill(`F(t) ${fdStr}`, SPAWN_TOOLTIP.flowDev),
            _spawnPill(`闭环 ${fbStr}`, SPAWN_TOOLTIP.feedback),
            _spawnPill(`占用 ${fillStr}`, SPAWN_TOOLTIP.boardFill)
        ];
        if (h) {
            metricPills.push(
                _spawnPill(`目标保消 ${h.clearGuarantee}`, SPAWN_TOOLTIP.clearG),
                _spawnPill(`尺寸 ${(h.sizePreference ?? 0).toFixed(1)}`, SPAWN_TOOLTIP.sizePref),
                _spawnPill(`多样 ${(h.diversityBoost ?? 0).toFixed(1)}`, SPAWN_TOOLTIP.diversity)
            );
            if (h.rhythmPhase && h.rhythmPhase !== 'neutral') {
                const phaseLabel = h.rhythmPhase === 'payoff' ? '收获' : '搭建';
                metricPills.push(_spawnPill(`节奏 ${phaseLabel}`, SPAWN_TOOLTIP.rhythm));
            }
            if (h.sessionArc) {
                const arcLabel = { warmup: '热身', peak: '巅峰', cooldown: '收官' }[h.sessionArc] ?? h.sessionArc;
                metricPills.push(_spawnPill(`弧线 ${arcLabel}`, SPAWN_TOOLTIP.sessionArc));
            }
        }

        const layer2Pills = [];
        if (h) {
            const cc = h.comboChain ?? 0;
            if (cc > 0.1) layer2Pills.push(_spawnPill(`连击 ${cc.toFixed(2)}`, SPAWN_TOOLTIP.comboChain));
            const mc = h.multiClearBonus ?? 0;
            if (mc > 0.1) layer2Pills.push(_spawnPill(`多消 ${mc.toFixed(2)}`, SPAWN_TOOLTIP.multiClear));
            const ml = h.multiLineTarget ?? 0;
            if (ml >= 1) layer2Pills.push(_spawnPill(`多线×${ml}`, SPAWN_TOOLTIP.multiLineTarget));
        }
        // 玩法偏好 pill（始终展示，让开发者快速感知当前玩家风格对出块的影响）
        {
            const ps = game.playerProfile?.playstyle ?? 'balanced';
            const psLabel = PLAYSTYLE_LABEL[ps] ?? ps;
            const psTip = PLAYSTYLE_TOOLTIP[ps] ?? '';
            layer2Pills.push(_spawnPill(`偏好 ${psLabel}`, psTip));
        }

        const diagPills = [];
        const diag = ins.spawnDiagnostics;
        if (liveTopology || diag?.layer1) {
            const l1 = diag?.layer1 || {};
            const holes = liveTopology?.holes ?? l1.holes;
            const flatness = liveTopology?.flatness ?? l1.flatness;
            const nearFullLines = liveTopology?.nearFullLines ?? l1.nearFullLines ?? 0;
            diagPills.push(_spawnPill(`空洞 ${holes ?? '—'}`, SPAWN_TOOLTIP.holes));
            if (flatness != null) diagPills.push(_spawnPill(`平整 ${flatness.toFixed(2)}`, SPAWN_TOOLTIP.flatness));
            if (nearFullLines > 0) diagPills.push(_spawnPill(`近满 ${nearFullLines}`, SPAWN_TOOLTIP.nearFull));
            const liveMultiCandidates = _countLiveMultiClearCandidates(game.grid);
            if (liveMultiCandidates != null) {
                diagPills.push(_spawnPill(`多消候选 ${liveMultiCandidates}`, SPAWN_TOOLTIP.multiClear));
            }
            const livePerfectCandidates = _countLivePerfectClearCandidates(game.grid, liveTopology);
            if (livePerfectCandidates > 0) {
                diagPills.push(_spawnPill(`清屏候选 ${livePerfectCandidates}`, SPAWN_TOOLTIP.perfectClearCandidates));
            }
            // v9: 解法数量 Pills（仅在 fill ≥ activationFill 时有数据）
            const sm = l1.solutionMetrics;
            if (sm) {
                const cntLabel = sm.capped ? `${sm.solutionCount}+` : `${sm.solutionCount}`;
                const truncLabel = sm.truncated ? ' · 截断' : '';
                diagPills.push(_spawnPill(`解法 ${cntLabel}${truncLabel}`, SPAWN_TOOLTIP.solutionCount));
                diagPills.push(_spawnPill(`合法序 ${sm.validPerms}/6`, SPAWN_TOOLTIP.validPerms));
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
            ...layer2Pills,
            ...diagPills,
            ...weightPills
        ];
        const allRows = [
            fallbackRow,
            allPills.length ? `<div class="insight-weights insight-weights--compact">${allPills.join('')}</div>` : ''
        ].filter(Boolean).join('');

        elSpawn.innerHTML = `<div class="insight-spawn-stack">${allRows}</div>`;
    } else if (elSpawn) {
        elSpawn.innerHTML =
            `<div class="insight-spawn-stack">` +
            `<span class="insight-muted">开局后显示投放参数（出块模式见上方实时状态顶栏）</span>` +
            `</div>`;
    }

    const elStrategy = document.getElementById('insight-strategy');
    if (elStrategy) {
        const gridInfo = game.grid ? {
            fillRatio: game.grid.getFillRatio(),
            maxHeight: _gridMaxHeight(game.grid),
            holesCount: _gridHoles(game.grid)
        } : undefined;
        const tips = generateStrategyTips(p, ins, gridInfo);
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
        const bullets = ins ? _buildWhyLines(ins) : [];
        const hintBullets = ins?.spawnHints ? _hintsExplain(ins.spawnHints) : [];
        const all = [...bullets, ...hintBullets];
        if (all.length) {
            elWhy.innerHTML =
                `<ul class="insight-why-list">${all.map((t) => `<li>${_stripTrailingSentencePunct(t)}</li>`).join('')}</ul>`;
        } else {
            elWhy.innerHTML = '';
        }
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
