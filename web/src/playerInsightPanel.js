/**
 * 左侧「玩家画像 · 自适应」面板：实时能力指标 + 上一轮出块的可解释摘要。
 * 供策划/开发根据信号持续调 game_rules.json 与 adaptiveSpawn 逻辑。
 */
import { GAME_RULES } from './gameRules.js';
import { computeHints } from './hintEngine.js';

const CAT_LABEL = {
    lines: '长条',
    rects: '矩形',
    squares: '方形',
    tshapes: 'T 形',
    zshapes: 'Z 形',
    lshapes: 'L 形',
    jshapes: 'J 形'
};

function _pct(x) {
    if (x == null || Number.isNaN(x)) return '—';
    return `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
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
            `技能估计 ${_pct(insight.skillLevel)}：偏高时略加压、偏低时略减压（见 flowZone.skillAdjustScale）。`
        );
    }
    lines.push(_flowExplain(insight.flowState));
    lines.push(_pacingExplain(insight.pacingPhase));
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
    return lines;
}

function _render(game) {
    const root = document.getElementById('player-insight-panel');
    if (!root) return;

    const p = game.playerProfile;
    const ins = game._lastAdaptiveInsight;
    const liveFlow = p.flowState;
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
        const flowIcon = liveFlow === 'flow' ? '●' : liveFlow === 'bored' ? '▲' : '▼';
        const parts = [
            `<span class="insight-tag insight-tag--${liveFlow}">${flowIcon} ${liveFlow}</span>`,
            `<span class="insight-tag">${p.pacingPhase}</span>`,
            `<span class="insight-tag">${p.sessionPhase}</span>`,
        ];
        const mom = p.momentum;
        const momCls = mom > 0.15 ? 'ok' : mom < -0.15 ? 'danger' : 'warn';
        parts.push(`<span class="insight-signal insight-signal--${momCls}">动量 ${mom.toFixed(2)}</span>`);

        const fr = p.frustrationLevel;
        const frCls = fr >= 4 ? 'danger' : fr >= 2 ? 'warn' : 'ok';
        parts.push(`<span class="insight-signal insight-signal--${frCls}">未消 ${fr}</span>`);

        parts.push(`<span class="insight-kv">轮次 <strong>${p.spawnRoundIndex}</strong></span>`);

        if (p.hadRecentNearMiss) parts.push('<span class="insight-signal insight-signal--warn">⚡ 近失</span>');
        if (p.needsRecovery) parts.push('<span class="insight-signal insight-signal--danger">↻ 恢复</span>');
        if (p.isInOnboarding) parts.push('<span class="insight-signal insight-signal--ok">✦ 新手</span>');
        elState.innerHTML = parts.join('');
    }

    if (elSpawn && ins) {
        const s = ins.stress;
        const weights = (ins.shapeWeightsTop || [])
            .map((w) => `<span class="insight-weight">${CAT_LABEL[w.category] || w.category} ${w.weight.toFixed(1)}</span>`)
            .join('');
        const h = ins.spawnHints;
        const hintLine = h
            ? `清${h.clearGuarantee} 尺${(h.sizePreference ?? 0).toFixed(1)} 多${(h.diversityBoost ?? 0).toFixed(1)}`
            : '';
        elSpawn.innerHTML = `
            <p>stress <strong class="insight-stress-val">${typeof s === 'number' ? s.toFixed(2) : '—'}</strong>
               fill <strong>${(ins.boardFill * 100).toFixed(0)}%</strong>
               ${hintLine ? `<span class="insight-kv">${hintLine}</span>` : ''}</p>
            <div class="insight-weights">${weights}</div>`;
    } else if (elSpawn) {
        elSpawn.innerHTML = '<span class="insight-muted">开局后显示</span>';
    }

    if (elWhy) {
        const bullets = ins ? _buildWhyLines(ins) : [];
        const hintBullets = ins?.spawnHints ? _hintsExplain(ins.spawnHints) : [];
        const all = [...bullets, ...hintBullets];
        if (all.length) {
            elWhy.innerHTML =
                `<p class="insight-why-title">策略解释</p>` +
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
            }
        };
        card.onmouseleave = () => {
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
