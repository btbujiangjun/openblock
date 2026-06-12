/**
 * 玩家能力·偏好分析 — Web 主端可视化应用。
 *
 * 数据源：Flask + SQLite 的 `/api/replay-sessions`（经 Database.listReplaySessions），
 * 喂入纯函数 analysis/playerAnalytics.analyzePlayer，渲染能力雷达 / 风格分布 /
 * 风险·节奏·动机 / 形状·颜色亲和 / 可解释洞察。
 *
 * 无后端 / 无回放数据时，可用「载入演示数据」用合成 frames 跑通，数据不离开浏览器。
 *
 * 仅 web 主端；不引入图表库，雷达与条形均用内联 SVG / DOM 绘制（与仓库 sparkline 风格一致）。
 */
import { Database } from './database.js';
import { isSqliteClientDatabase, COLORS } from './config.js';
import { analyzePlayer, classifyShape, ANALYTICS_GLOSSARY, buildSpawnPrior } from './analysis/playerAnalytics.js';

const DIM_META = [
    { key: 'topology', label: '拓扑规划' },
    { key: 'scoring', label: '计分掌控' },
    { key: 'execution', label: '执行质量' },
    { key: 'reaction', label: '反应节奏' },
    { key: 'survival', label: '生存韧性' },
    { key: 'consistency', label: '稳定性' },
];

const DIM_PART_LABEL = {
    holeBurden: '空洞负担', holeGrowth: '空洞增长', flatness: '平整度',
    concaveControl: '凹角控制', regionCohesion: '空间连贯', holeRepair: '空洞修复', nearClearConversion: '近满转化',
    leverage: '分数杠杆', combo: 'Combo 利用', multiLine: '多消比', bonus: '清屏/Bonus',
    moveQuality: '方块质量', miss: '低失误',
    speed: '反应速度', decisiveness: '果断度', apm: '操作密度',
    survivedSteps: '存活步数', recovery: '高压恢复', lockAvoidance: '避死局',
    scoreCv: '局间稳定', moveQualityStd: '质量稳定',
};

const STYLE_LABEL = {
    perfect_hunter: '清屏猎人', multi_clear: '多消流', combo: '连消流', survival: '生存流', balanced: '均衡',
};

const SHAPE_LABEL = {
    line: '直线', square: '方块', rect: '矩形', corner: '拐角', lshape: 'L 型', tzshape: 'T/Z 型', poly: '多元', dot: '单格', unknown: '未知',
};

/* ------------------------------------------------------------------ utils */

function el(id) {
    return document.getElementById(id);
}

function setStatus(msg, kind = 'info') {
    const node = el('pa-status');
    if (!node) return;
    const color = kind === 'error' ? 'var(--bad)' : kind === 'good' ? 'var(--good)' : 'var(--muted)';
    node.style.color = color;
    node.textContent = msg;
}

function pct(v) {
    return Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100);
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function colorHex(idx) {
    const i = ((Number(idx) % COLORS.length) + COLORS.length) % COLORS.length;
    return COLORS[i] || '#888';
}

/** 由词典生成 title tooltip 属性（提升可读性：鼠标悬停看“这是什么/怎么读”）。 */
function tip(key) {
    const t = ANALYTICS_GLOSSARY[key];
    return t ? ` title="${esc(t)}"` : '';
}

function bar(value, color = 'var(--accent)') {
    const w = pct(value);
    return `<div class="pa-bar"><span style="width:${w}%;background:${color}"></span></div>`;
}

/* --------------------------------------------------------------- 能力雷达 */

function renderRadar(dims) {
    const cx = 0;
    const cy = 0;
    const R = 100;
    // 给文字标签预留四周空白，避免被裁切（左右更宽，竖向略小）
    const padX = 96;
    const padY = 40;
    const vbW = R * 2 + padX * 2;
    const vbH = R * 2 + padY * 2;
    const n = DIM_META.length;
    const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const ptAt = (i, r) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))];

    let grid = '';
    for (const ring of [0.25, 0.5, 0.75, 1]) {
        const pts = DIM_META.map((_, i) => ptAt(i, R * ring).map((x) => x.toFixed(1)).join(',')).join(' ');
        grid += `<polygon points="${pts}" fill="none" stroke="var(--line)" stroke-width="1" />`;
    }
    let axes = '';
    let labels = '';
    DIM_META.forEach((d, i) => {
        const [ax, ay] = ptAt(i, R);
        axes += `<line x1="${cx}" y1="${cy}" x2="${ax.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="var(--line)" stroke-width="1" />`;
        const [lx, ly] = ptAt(i, R + 18);
        const anchor = Math.abs(lx - cx) < 2 ? 'middle' : lx > cx ? 'start' : 'end';
        const v = pct(dims[d.key]?.value);
        labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" fill="var(--text)" font-size="12" text-anchor="${anchor}" dominant-baseline="middle">${d.label} <tspan fill="var(--accent)" font-weight="700">${v}</tspan></text>`;
    });
    const dataPts = DIM_META.map((d, i) => ptAt(i, R * Math.max(0, Math.min(1, dims[d.key]?.value || 0))).map((x) => x.toFixed(1)).join(',')).join(' ');

    return `<svg viewBox="${(-vbW / 2).toFixed(1)} ${(-vbH / 2).toFixed(1)} ${vbW} ${vbH}" width="100%" style="max-width:${vbW}px" preserveAspectRatio="xMidYMid meet" class="pa-radar">
        ${grid}${axes}
        <polygon points="${dataPts}" fill="rgba(96,165,250,0.25)" stroke="var(--accent)" stroke-width="2" />
        ${labels}
    </svg>`;
}

/* --------------------------------------------------------------- 渲染主体 */

function renderDimList(dims) {
    return DIM_META.map((d) => {
        const dim = dims[d.key] || {};
        const parts = Object.entries(dim.parts || {})
            .filter(([, v]) => v != null)
            .map(([k, v]) => `<div class="pa-part"><span>${DIM_PART_LABEL[k] || k}</span>${bar(v, 'var(--muted-bar)')}<em>${pct(v)}</em></div>`)
            .join('');
        return `<details class="pa-dim">
            <summary>
                <span class="pa-dim-name"${tip(d.key)}>${d.label}</span>
                ${bar(dim.value)}
                <span class="pa-dim-val">${pct(dim.value)}</span>
                <span class="pa-conf" title="该维度置信度（样本量驱动），越低表示样本不足、解读需谨慎">conf ${pct(dim.confidence)}</span>
            </summary>
            <div class="pa-parts">${parts || '<p class="pa-empty">无子项</p>'}</div>
        </details>`;
    }).join('');
}

function renderPlaystyle(playstyle) {
    const dist = playstyle.distribution || {};
    const rows = Object.entries(dist)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => {
            const isDom = k === playstyle.dominant;
            return `<div class="pa-style-row ${isDom ? 'is-dom' : ''}">
                <span class="pa-style-name">${STYLE_LABEL[k] || k}${isDom ? ' ★' : ''}</span>
                ${bar(v, isDom ? 'var(--good)' : 'var(--muted-bar)')}
                <em>${pct(v)}%</em>
            </div>`;
        }).join('');
    return `<div class="pa-card">
        <h3>风格分布（软概率）</h3>
        <p class="pa-sub">主导：<b>${STYLE_LABEL[playstyle.dominant] || playstyle.dominant}</b> · 承诺度 ${pct(playstyle.commitment)}%</p>
        ${rows}
    </div>`;
}

function renderRiskTempo(pref) {
    const r = pref.riskAppetite;
    const t = pref.tempo;
    const BAND_LABEL = { aggressive: '激进', balanced: '均衡', conservative: '稳健' };
    const TEMPO_LABEL = { snappy: '速断', measured: '从容', deliberate: '深思' };
    return `<div class="pa-card">
        <h3>风险偏好 & 节奏</h3>
        <div class="pa-kv"><span>风险偏好</span>${bar(r.value, 'var(--warn)')}<em>${pct(r.value)} · ${BAND_LABEL[r.band] || r.band}</em></div>
        <div class="pa-kv"><span>节奏速度</span>${bar(t.value)}<em>${pct(t.value)} · ${TEMPO_LABEL[t.label] || t.label}</em></div>
        <p class="pa-sub">落子前均填充 ${r.raw ? pct(r.raw.fillBeforePlace) : '—'}% · 思考 ${t.meanThinkMs ?? '—'}ms · 反应 ${t.meanReactionMs ?? '—'}ms</p>
    </div>`;
}

function renderMotivation(mot) {
    const rows = Object.entries(mot.scores || {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => {
            const LBL = { competence: '胜任成长', challenge: '挑战征服', relaxation: '休闲放松', collection: '收集完美', social: '社交竞争' };
            const isP = k === mot.primary;
            return `<div class="pa-kv"><span>${LBL[k] || k}${isP ? ' ★' : ''}</span>${bar(v, isP ? 'var(--good)' : 'var(--muted-bar)')}<em>${pct(v)}</em></div>`;
        }).join('');
    return `<div class="pa-card"><h3>核心动机</h3><p class="pa-sub">主导：<b>${esc(mot.label)}</b></p>${rows}</div>`;
}

function renderAffinity(pref) {
    const shapes = (pref.shapeAffinity || []).map((s) =>
        `<span class="pa-chip">${SHAPE_LABEL[s.key] || s.key}<em>${pct(s.share)}%</em><i title="平均得分增量">+${s.avgGain}</i></span>`
    ).join('') || '<p class="pa-empty">无数据</p>';
    const colors = (pref.colorAffinity || []).map((c) =>
        `<span class="pa-chip"><i class="pa-swatch" style="background:${colorHex(c.key)}"></i>色#${esc(c.key)}<em>${pct(c.share)}%</em></span>`
    ).join('') || '<p class="pa-empty">无数据</p>';
    return `<div class="pa-card">
        <h3>方块 & 颜色亲和（成功加权）</h3>
        <div class="pa-affinity-group"><span class="pa-affinity-title">偏好形状</span><div class="pa-chips">${shapes}</div></div>
        <div class="pa-affinity-group"><span class="pa-affinity-title">偏好颜色</span><div class="pa-chips">${colors}</div></div>
    </div>`;
}

function trendIndicator(trait) {
    const LABEL = { improving: '↑ 进步中', stable: '→ 稳定', declining: '↓ 下滑中' };
    const color = trait.label === 'improving' ? 'var(--good)' : trait.label === 'declining' ? 'var(--bad)' : 'var(--muted)';
    return `<b style="color:${color}">${LABEL[trait.label] || trait.label}</b> <em>${trait.value > 0 ? '+' : ''}${trait.value}</em>`;
}

function renderTraits(traits) {
    return `<div class="pa-card">
        <h3>时序特质（随时间/局内的动态）</h3>
        <div class="pa-kv"><span${tip('trend')}>成长趋势</span><div class="pa-trend">${trendIndicator(traits.trend)}</div></div>
        <div class="pa-kv"><span${tip('endurance')}>局内耐力</span>${bar(traits.endurance.value, traits.endurance.fatigue ? 'var(--warn)' : 'var(--good)')}<em>${pct(traits.endurance.value)}${traits.endurance.fatigue ? ' · 后程疲劳' : ''}</em></div>
        <div class="pa-kv"><span${tip('clutch')}>高压表现</span>${bar(traits.clutch.value)}<em>${pct(traits.clutch.value)}</em></div>
    </div>`;
}

function renderSpawnAdvice(adv) {
    const DIFF = { easy: '简单', normal: '普通', hard: '困难' };
    const STRESS = { high: '偏高', mid: '适中', low: '偏低' };
    const cf = adv.comfortFillBand;
    const shapeRows = (adv.shapeCompetence || []).map((s) =>
        `<tr><td>${SHAPE_LABEL[s.category] || s.category}</td><td>${s.attempts}</td><td>${pct(s.clearRate)}%</td><td style="min-width:80px">${bar(s.competence, s.competence < 0.4 ? 'var(--bad)' : s.competence > 0.7 ? 'var(--good)' : 'var(--muted-bar)')}</td><td>${pct(s.competence)}</td></tr>`
    ).join('') || '<tr><td colspan="5" class="pa-empty">样本不足</td></tr>';
    const colorChips = (adv.colorPriors || []).map((c) =>
        `<span class="pa-chip"><i class="pa-swatch" style="background:${colorHex(c.colorIdx)}"></i>#${c.colorIdx}<em>${pct(c.share)}%</em></span>`
    ).join('') || '<span class="pa-empty">无</span>';

    return `<div class="pa-card pa-card--advice">
        <h3>🎯 出块算法建议（供 adaptiveSpawn / 寻参消费）</h3>
        <div class="pa-advice-grid">
            <div class="pa-advice-item"${tip('recommendedDifficulty')}><span>推荐难度</span><b>${DIFF[adv.recommendedDifficulty] || adv.recommendedDifficulty}</b></div>
            <div class="pa-advice-item"${tip('targetStress')}><span>目标压力</span><b>${adv.targetStress.value} · ${STRESS[adv.targetStress.band]}</b></div>
            <div class="pa-advice-item"${tip('personalizationStrength')}><span>个性化强度</span><b>${pct(adv.personalizationStrength)}%</b></div>
            <div class="pa-advice-item"${tip('reliefAfterRounds')}><span>救济节奏</span><b>≤${adv.relief.reliefAfterRounds} 轮/次</b></div>
            <div class="pa-advice-item"${tip('delightCadence')}><span>爽感节奏</span><b>${adv.delight.cadenceRounds != null ? `每 ${adv.delight.cadenceRounds} 轮` : '—'}</b></div>
            <div class="pa-advice-item"${tip('comfortFillBand')}><span>舒适填充带</span><b>${cf ? `${pct(cf.low)}–${pct(cf.high)}%` : '—'}</b></div>
            <div class="pa-advice-item" title="拓扑形态最薄弱的子项，spawn 可定向施压（训练）或规避（救济）"><span>拓扑短板</span><b>${adv.topologyForm && adv.topologyForm.weakness ? (DIM_PART_LABEL[adv.topologyForm.weakness] || adv.topologyForm.weakness) : '—'}</b></div>
        </div>
        <div class="pa-advice-sub">
            <h4${tip('shapeCompetence')}>形状胜任度（低=救济少投/训练多投，高=可作爽感兑现块）</h4>
            <table class="pa-table">
                <thead><tr><th>形状</th><th>落子</th><th>消行率</th><th>胜任</th><th></th></tr></thead>
                <tbody>${shapeRows}</tbody>
            </table>
            <div class="pa-affinity-group"><span class="pa-affinity-title">颜色染色先验</span><div class="pa-chips">${colorChips}</div></div>
        </div>
    </div>`;
}

function renderProfile(result) {
    const root = el('pa-report');
    if (!root) return;
    const a = result.ability;
    const p = result.preference;
    const bandLabel = { expert: '专家', advanced: '进阶', developing: '成长', beginner: '入门' }[a.band] || a.band;
    const mix = Object.entries(result.meta.strategyMix || {}).map(([k, v]) => `${k}×${v}`).join(' · ') || '—';

    root.innerHTML = `
        <div class="pa-hero">
            <div class="pa-score"${tip('skillScore')}>
                <div class="pa-score-num">${pct(a.skillScore)}</div>
                <div class="pa-score-lbl">综合能力 · ${bandLabel}</div>
                <div class="pa-score-conf">置信度 ${pct(result.confidence)}%</div>
            </div>
            <div class="pa-meta">
                <div><span>会话</span><b>${result.meta.sessions}</b></div>
                <div><span>观测落子</span><b>${result.meta.observations}</b></div>
                <div><span>总放置</span><b>${result.meta.totalPlacements}</b></div>
                <div><span>策略分布</span><b>${esc(mix)}</b></div>
                <div><span>数据充足</span><b>${result.meta.sufficientData ? '是' : '否（样本不足）'}</b></div>
            </div>
        </div>

        ${result.summary ? `<div class="pa-summary"><span class="pa-summary-tag">一句话画像</span>${esc(result.summary)}</div>` : ''}
        ${result.meta.sufficientData ? '' : '<div class="pa-warn-banner">⚠️ 观测样本不足，画像置信度较低，仅供参考。建议累计更多对局后再解读。</div>'}

        <div class="pa-grid">
            <div class="pa-card pa-card--radar">
                <h3>能力雷达（6 维）</h3>
                <div class="pa-radar-wrap">${renderRadar(a.dims)}</div>
            </div>
            <div class="pa-card">
                <h3>能力维度拆解（点开看子项 · 悬停看释义）</h3>
                ${renderDimList(a.dims)}
            </div>
        </div>

        <div class="pa-grid">
            ${renderTraits(result.traits)}
            ${renderPlaystyle(p.playstyle)}
        </div>

        <div class="pa-grid">
            ${renderRiskTempo(p)}
            ${renderMotivation(p.motivation)}
        </div>

        ${renderSpawnAdvice(result.spawnAdvice)}

        ${renderAffinity(p)}

        <div class="pa-card">
            <h3>可解释洞察</h3>
            <ul class="pa-insights">${(result.explain || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        </div>
    `;
}

/* ----------------------------------------------------------- 数据源接入 */

async function loadUsers(db) {
    const sel = el('pa-user');
    if (!sel) return;
    try {
        const users = await db.listReplayUsers();
        sel.innerHTML = '';
        const selfOpt = document.createElement('option');
        selfOpt.value = db.userId;
        selfOpt.textContent = `我（${db.userId.slice(0, 12)}…）`;
        sel.appendChild(selfOpt);
        for (const u of users) {
            const uid = u.user_id ?? u.userId;
            if (!uid || uid === db.userId) continue;
            const opt = document.createElement('option');
            opt.value = uid;
            const sessions = u.session_count ?? u.sessions ?? '?';
            opt.textContent = `${uid.slice(0, 14)}… (${sessions} 局)`;
            sel.appendChild(opt);
        }
        setStatus(`用户列表已加载（${sel.options.length} 个）。私域模式下仅显示自己。`);
    } catch (e) {
        sel.innerHTML = `<option value="${esc(db.userId)}">我</option>`;
        setStatus(`用户列表不可用（私域模式或服务端未开 debug）：${e.message}`, 'info');
    }
}

async function run(db) {
    const userId = el('pa-user')?.value || db.userId;
    const limit = Math.max(1, Math.min(500, Number(el('pa-limit')?.value) || 80));
    setStatus(`拉取 ${userId.slice(0, 14)}… 的近 ${limit} 局回放…`);
    try {
        const sessions = await db.listReplaySessions(limit, userId);
        if (!sessions.length) {
            setStatus('该用户暂无可回放对局（move_sequences 为空）。可点「载入演示数据」预览。', 'info');
            el('pa-report').innerHTML = '';
            return;
        }
        const result = analyzePlayer(sessions);
        renderProfile(result);
        let extra = '';
        // 仅当分析的是「本人」时，把先验写入端侧（供出块算法 _loadSpawnPrior 消费）。
        if (userId === db.userId) {
            extra = persistSpawnPrior(db.userId, result);
        }
        setStatus(`分析完成：${result.meta.sessions} 局 / ${result.meta.observations} 次落子观测。${extra}`, 'good');
    } catch (e) {
        setStatus(`分析失败：${e.message}`, 'error');
    }
}

/**
 * 把分析结果精简为出块先验并写入 localStorage（端侧资产）。
 * 返回一段状态后缀文案；数据不足或失败时静默（不抛错、不影响主流程）。
 */
function persistSpawnPrior(userId, result) {
    try {
        if (typeof localStorage === 'undefined') return '';
        const prior = buildSpawnPrior(result);
        if (!prior) return '（样本不足，未生成出块先验）';
        localStorage.setItem(`openblock_spawn_prior:${userId}`, JSON.stringify(prior));
        return `已写入出块先验（强度 ${(prior.strength * 100).toFixed(0)}%，下局生效）`;
    } catch {
        return '';
    }
}

/* ----------------------------------------------------------- 演示数据 */

const DEMO_SHAPES = [
    [[1, 1, 1, 1]], [[1, 1], [1, 1]], [[1, 1, 1]], [[1, 0], [1, 1]], [[1, 1, 1], [0, 1, 0]],
];

function buildDemoSessions() {
    const sessions = [];
    for (let g = 0; g < 6; g++) {
        const n = 18 + g * 2;
        const frames = [];
        let score = 0;
        let fill = 0.3;
        for (let i = 0; i < n; i++) {
            const willClear = i % 2 === 0;
            score += willClear ? 60 + g * 10 : 0;
            const prevFill = fill;
            fill = willClear ? Math.max(0.1, fill - 0.15) : Math.min(0.92, fill + 0.06);
            const shape = DEMO_SHAPES[(i + g) % DEMO_SHAPES.length];
            frames.push({ t: 'spawn', dock: [{ id: `b${i}`, shape, colorIdx: (i + g) % 8, placed: false }] });
            frames.push({
                t: 'place', i: 0, x: 0, y: 0,
                ps: {
                    pv: 4, score, boardFill: fill,
                    spawnGeo: { holes: Math.max(0, 2 - g % 3), flatness: 0.55 + (g % 3) * 0.12, nearFullLines: willClear ? 1 : 0, contiguousRegions: 2 + (i % 3), concaveCorners: 3 + (i % 4) },
                    metrics: { pickToPlaceMs: 700 + g * 250 + (i % 4) * 120, thinkMs: 1500 + g * 400, missRate: 0.04 + (g % 3) * 0.03, comboRate: 0.15 + (g % 3) * 0.08 },
                    multiClearRate: g % 2 === 0 ? 0.55 : 0.15,
                    comboRate: 0.15 + (g % 3) * 0.08,
                    ability: { features: { lockRisk: prevFill > 0.85 ? 0.4 : 0.05 } },
                },
            });
        }
        sessions.push({
            id: `demo-${g}`, score, strategy: g % 2 ? 'hard' : 'normal',
            game_stats: { placements: n, clears: Math.floor(n / 2), misses: 1, maxCombo: 2 + g },
            analysis: { rating: 3, tags: ['demo'] }, frames,
        });
    }
    return sessions;
}

function runDemo() {
    setStatus('已载入合成演示数据（不写库 / 不离开浏览器）。', 'good');
    const result = analyzePlayer(buildDemoSessions());
    renderProfile(result);
}

/* ----------------------------------------------------------- 入口 */

function wantsAutorun() {
    try {
        return new URLSearchParams(window.location.search).get('autorun') === '1';
    } catch {
        return false;
    }
}

export function initPlayerAnalyticsApp() {
    el('pa-demo-btn')?.addEventListener('click', runDemo);

    if (!isSqliteClientDatabase()) {
        setStatus('当前构建未启用 SQLite 后端（VITE_USE_SQLITE_DB）。可用「载入演示数据」预览，或启用后端 + npm run server 接入真实回放。', 'info');
        return;
    }

    const db = new Database();
    el('pa-run-btn')?.addEventListener('click', () => run(db));
    el('pa-reload-users')?.addEventListener('click', () => loadUsers(db));

    db.init()
        .then(async () => {
            setStatus('已连接 SQLite 后端。选择用户后点「分析」。');
            await loadUsers(db);
            // 从主页面入口（?autorun=1）进入时，直接对当前玩家发起分析，无需再点按钮
            if (wantsAutorun()) await run(db);
        })
        .catch((e) => {
            setStatus(`后端不可用（请先 npm run server）：${e.message}。可改用「载入演示数据」预览。`, 'error');
        });
}

/* 形状分类导出复用（与核心模块同口径，便于页面/调试引用） */
export { classifyShape };
