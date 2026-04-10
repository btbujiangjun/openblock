/**
 * 左侧「玩家画像 · 自适应」面板：实时能力指标 + 上一轮出块的可解释摘要。
 * 供策划/开发根据信号持续调 game_rules.json 与 adaptiveSpawn 逻辑。
 */
import { GAME_RULES } from './gameRules.js';
import { computeHints } from './hintEngine.js';
import { generateStrategyTips } from './strategyAdvisor.js';
import { collectSeriesFromSnapshots, getMetricFromPS, formatMetricValue } from './moveSequence.js';
import { sparklineSvg, SPARK_W, METRIC_GROUP_COLORS } from './sparkline.js';

const CAT_LABEL = {
    lines: '长条',
    rects: '矩形',
    squares: '方形',
    tshapes: 'T 形',
    zshapes: 'Z 形',
    lshapes: 'L 形',
    jshapes: 'J 形'
};

/** 投放区指标悬停说明，与 docs/PANEL_PARAMETERS.md §4 一致 */
const SPAWN_TOOLTIP = {
    stress:
        '综合压力（约 −0.2～1）。由分数档、连战、技能、心流、节奏、恢复、挫败、combo、近失、闭环反馈等叠加后钳制，用于在配置的多档形状权重间插值。',
    flowDev:
        '心流偏移 F(t)：挑战与能力匹配的偏离程度；参与无聊/焦虑方向的 stress 微调。',
    feedback:
        '闭环反馈：每轮新出块后，在若干步放置窗口内统计消行表现，对 stress 做小幅偏移（正≈好于预期可略加压，负≈不及预期减压）。',
    boardFill: '当前棋盘占用率（已占格÷总格），不是开局预填比例 fillRatio。',
    clearG:
        '消行保证（1～3）：三连候选中至少要有几块具备「落下即可促成消行」的潜力；挫败/恢复/近失/新手等会抬高。',
    sizePref:
        '尺寸偏好（约 −1～1）：负值偏向小块便于腾挪，正值偏向大块；挫败/恢复/新手等常为负。',
    diversity: '品类多样（0～1）：越高三连块越倾向不同品类；无聊心流时常略提高新鲜感。',
    shapeW: '当前综合压力下，该形状类别的相对抽样权重（数值越大越容易被抽到）。'
};

function _attrTitle(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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
            if (grid.cells[y][x] !== 0) return n - y;
        }
    }
    return 0;
}

function _gridHoles(grid) {
    const n = grid.size;
    let holes = 0;
    for (let x = 0; x < n; x++) {
        let blocked = false;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== 0) {
                blocked = true;
            } else if (blocked) {
                holes++;
            }
        }
    }
    return holes;
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
        out.push(`消行保证 ≥${cg}：优先从「能填缺口」的形状里抽样，降低死局感。`);
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
    if (out.length === 0) {
        out.push('本轮无额外 spawnHints（默认随机权重内抽样）。');
    }
    return out;
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
        elState.className = 'insight-state-row';
        elState.innerHTML =
            '<span class="insight-muted">开局后随出块/落子刷新，与回放同款指标曲线。</span>';
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
        html +=
            `<div class="replay-series-cell" data-key="${m.key}">` +
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
        head.innerHTML = tags.map((t) => `<span class="series-tag">${t}</span>`).join('');
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
        lines.push(
            `综合压力 stress=${s.toFixed(2)}（0~1 越高越接近「困难」形权重档；含分数、连战、心流、节奏等信号）。`
        );
    }
    if (insight.skillLevel != null) {
        lines.push(
            `技能估计 ${_pct(insight.skillLevel)}：偏高时略加压、偏低时略减压。`
        );
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
    const liveSkill = p.skillLevel;

    const elAbility = document.getElementById('insight-ability');
    const elState = document.getElementById('insight-state');
    const elSpawn = document.getElementById('insight-spawn');
    const elWhy = document.getElementById('insight-why');

    if (elAbility) {
        const m = p.metrics;
        elAbility.innerHTML = `
            <div class="insight-metric"><span>技能</span><strong>${_pct(liveSkill)}</strong></div>
            <div class="insight-metric"><span>消行</span><strong>${(m.clearRate * 100).toFixed(0)}%</strong></div>
            <div class="insight-metric"><span>失误</span><strong>${(m.missRate * 100).toFixed(0)}%</strong></div>
            <div class="insight-metric"><span>思考</span><strong>${Math.round(m.thinkMs)}ms</strong></div>
            <div class="insight-metric"><span>负荷</span><strong>${_pct(p.cognitiveLoad)}</strong></div>
            <div class="insight-metric"><span>APM</span><strong>${p.engagementAPM.toFixed(1)}</strong></div>
            <div class="insight-bar"><div class="insight-bar-fill"></div></div>
        `;
        const fill = elAbility.querySelector('.insight-bar-fill');
        if (fill && liveSkill != null && !Number.isNaN(liveSkill)) {
            fill.style.width = `${Math.round(Math.max(0, Math.min(1, liveSkill)) * 100)}%`;
        }
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
                .map((t) => `<span class="insight-signal insight-signal--warn">${t}</span>`)
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
        const weights = (ins.shapeWeightsTop || [])
            .map(
                (w) =>
                    `<span class="insight-weight" title="${_attrTitle(SPAWN_TOOLTIP.shapeW)}">` +
                    `${CAT_LABEL[w.category] || w.category} ${w.weight.toFixed(1)}</span>`
            )
            .join('');
        const h = ins.spawnHints;
        const stressStr = typeof s === 'number' ? s.toFixed(2) : '—';
        const fillStr = `${(ins.boardFill * 100).toFixed(0)}%`;
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
                _spawnPill(`保消 ${h.clearGuarantee}`, SPAWN_TOOLTIP.clearG),
                _spawnPill(`尺寸 ${(h.sizePreference ?? 0).toFixed(1)}`, SPAWN_TOOLTIP.sizePref),
                _spawnPill(`多样 ${(h.diversityBoost ?? 0).toFixed(1)}`, SPAWN_TOOLTIP.diversity)
            );
        }
        elSpawn.innerHTML = `
            <div class="insight-spawn-stack">
                <div class="insight-weights">${metricPills.join('')}</div>
                <div class="insight-weights">${weights}</div>
            </div>`;
    } else if (elSpawn) {
        elSpawn.innerHTML = '<span class="insight-muted">开局后显示</span>';
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
                `<ul class="insight-why-list">${all.map((t) => `<li>${t}</li>`).join('')}</ul>`;
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
        list.innerHTML = '<p class="insight-muted">无合法落子可用。</p>';
        return;
    }

    section.hidden = false;
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

export function initPlayerInsightPanel(game) {
    game._playerInsightRefresh = () => _render(game);

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
