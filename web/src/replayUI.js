import {
    buildReplayAnalysis,
    countPlaceStepsInFrames,
    displayScoreFromReplayFrames,
    formatPlayerStateForReplay,
    getPlayerStateAtFrameIndex,
    nextDistinctReplayFrameIndex,
    collectReplayMetricsSeries,
    getMetricFromPS,
    formatMetricValue
} from './moveSequence.js';

/**
 * 列表/详情统一用：优先 SQLite 中的 analysis；缺失时用帧本地补算（与局末 buildReplayAnalysis 一致）。
 * 缺失常见于：关页前未完成结算写入、或旧数据仅有 frames。
 */
function resolvedReplayAnalysis(row, frames) {
    const persisted = row?.analysis;
    if (persisted && typeof persisted === 'object' && Number.isFinite(Number(persisted.rating))) {
        return { analysis: persisted, derived: false };
    }
    if (!Array.isArray(frames) || frames.length === 0) {
        return { analysis: null, derived: false };
    }
    try {
        const fromFrames = displayScoreFromReplayFrames(frames);
        const scoreNum = Number.isFinite(Number(fromFrames))
            ? Number(fromFrames)
            : Number(row?.score);
        const analysis = buildReplayAnalysis(frames, {
            score: Number.isFinite(scoreNum) ? scoreNum : undefined,
            durationMs: row?.duration != null ? Number(row.duration) : undefined
        });
        return { analysis, derived: true };
    } catch {
        return { analysis: null, derived: false };
    }
}
import { sparklineSvg, SPARK_W, METRIC_GROUP_COLORS } from './sparkline.js';
import {
    enterInsightReplay,
    exitInsightReplay,
    updateInsightReplayFrame
} from './playerInsightPanel.js';

function _attrTitle(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function _html(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _pct(v) {
    return v == null || Number.isNaN(Number(v)) ? '—' : `${(Number(v) * 100).toFixed(1)}%`;
}

function _num(v, d = 1) {
    if (v == null || Number.isNaN(Number(v))) return '—';
    const n = Number(v);
    return Number.isInteger(n) ? String(n) : n.toFixed(d);
}

function formatReplayAnalysisHtml(analysis) {
    if (!analysis || typeof analysis !== 'object') {
        return '';
    }
    const m = analysis.metrics || {};
    const tags = Array.isArray(analysis.tags) && analysis.tags.length
        ? `<div class="replay-analysis-tags">${analysis.tags.map((t) => `<span>${_html(t)}</span>`).join('')}</div>`
        : '';
    const abstract = Array.isArray(analysis.interpretation?.abstract) && analysis.interpretation.abstract.length
        ? `<div class="replay-analysis-abstract">${analysis.interpretation.abstract.slice(0, 5).map((t) => `<p>${_html(t)}</p>`).join('')}</div>`
        : '';
    const designRead = Array.isArray(analysis.interpretation?.designRead) && analysis.interpretation.designRead.length
        ? `<div class="replay-analysis-design">${analysis.interpretation.designRead.slice(0, 4).map((t) => `<p>${_html(t)}</p>`).join('')}</div>`
        : '';
    const recs = Array.isArray(analysis.recommendations) && analysis.recommendations.length
        ? `<ul>${analysis.recommendations.slice(0, 3).map((r) => `<li>${_html(r)}</li>`).join('')}</ul>`
        : '';
    return `<section class="replay-analysis-summary" title="整局评价与过程分析，随 move_sequences 写入 SQLite，供设计复盘。">` +
        `<div class="replay-analysis-head">整局评价 <strong>${_html(analysis.rating ?? '—')}/5</strong></div>` +
        `<p>${_html(analysis.summary || '暂无整局评价。')}</p>` +
        `<div class="replay-analysis-metrics">` +
        `<span>清线 <strong>${_pct(m.clearRate)}</strong></span><span>峰值填充 <strong>${_pct(m.peakFill)}</strong></span>` +
        `<span>最长未清 <strong>${_html(m.longestNoClear ?? '—')}</strong> 步</span><span>思考 <strong>${_html(_num(m.avgThinkMs, 0))}</strong>ms</span>` +
        `<span>恢复需求 <strong>${_pct(m.recoveryRatio)}</strong></span>` +
        `</div>${tags}${abstract}${designRead}${recs}</section>`;
}

/**
 * 对局序列回放 UI（帧数据来自 SQLite / move_sequences）
 * @param {import('./game.js').Game} game
 */
export function initReplayUI(game) {
    const menuReplayBtn = document.getElementById('menu-replay-btn');
    const listScreen = document.getElementById('replay-list-screen');
    const viewScreen = document.getElementById('replay-view-screen');
    const listBack = document.getElementById('replay-list-back');
    const viewBack = document.getElementById('replay-view-back');
    const sessionListEl = document.getElementById('replay-session-list');
    const slider = document.getElementById('replay-slider');
    const label = document.getElementById('replay-frame-label');
    const playBtn = document.getElementById('replay-play');
    const pauseBtn = document.getElementById('replay-pause');
    const titleEl = document.getElementById('replay-view-title');
    const listToolbar = document.getElementById('replay-list-toolbar');
    const selectAllCb = document.getElementById('replay-select-all');
    const selectedCountEl = document.getElementById('replay-selected-count');
    const deleteSelectedBtn = document.getElementById('replay-delete-selected');
    const deleteZeroScoreBtn = document.getElementById('replay-delete-zero-score');
    const playerStateEl = document.getElementById('replay-player-state');

    if (!menuReplayBtn || !listScreen || !viewScreen || !slider) {
        return;
    }

    let playTimer = null;
    /** @type {object[] | null} 当前打开的回放帧（供玩家状态同步展示） */
    let replayFramesRef = null;
    let replayAnalysisRef = null;

    /* ── Series view state ── */
    let _seriesData = null;
    /** @type {{ key:string, fmt:string, cursorLine:SVGLineElement|null, valueEl:HTMLElement|null, points:{idx:number,value:number}[], lo:number, range:number }[]} */
    let _seriesCells = [];

    function _clearSeries() {
        _seriesData = null;
        _seriesCells = [];
        if (playerStateEl) {
            playerStateEl.innerHTML = '';
            playerStateEl.classList.remove('replay-series-mode');
        }
    }

    /**
     * 从 frames 构建 sparkline 序列面板；成功返回 true，无数据返回 false（调用方降级为文本）。
     */
    function _initSeries(frames) {
        const data = collectReplayMetricsSeries(frames);
        if (!data || !playerStateEl) {
            _seriesData = null;
            _seriesCells = [];
            return false;
        }
        _seriesData = data;
        _seriesCells = [];

        let html = formatReplayAnalysisHtml(replayAnalysisRef);
        html += '<div class="replay-series-header" id="replay-series-header"></div>';
        html += '<div class="replay-series-grid">';
        for (const m of data.metrics) {
            const s = data.series[m.key];
            const color = METRIC_GROUP_COLORS[m.group] || '#5b9bd5';
            const tip = m.tooltip || '';
            html += `<div class="replay-series-cell" data-key="${m.key}" title="${_attrTitle(tip)}">` +
                `<span class="series-label" style="color:${color}">${m.label}</span>` +
                `<div class="series-spark-wrap">${sparklineSvg(s.points, data.totalFrames, color)}</div>` +
                `<span class="series-value">—</span></div>`;
        }
        html += '</div>';
        playerStateEl.innerHTML = html;
        playerStateEl.classList.add('replay-series-mode');

        for (const m of data.metrics) {
            const cell = playerStateEl.querySelector(`.replay-series-cell[data-key="${m.key}"]`);
            if (!cell) continue;
            const svg = cell.querySelector('.replay-sparkline');
            const cursorLine = svg?.querySelector('.spark-cursor') ?? null;
            const valueEl = cell.querySelector('.series-value');
            const pts = data.series[m.key].points;
            let lo = Infinity, hi = -Infinity;
            for (const p of pts) { if (p.value < lo) lo = p.value; if (p.value > hi) hi = p.value; }
            _seriesCells.push({
                key: m.key, fmt: m.fmt, cursorLine, valueEl,
                points: pts, lo, range: hi === lo ? 1 : hi - lo
            });
        }
        return true;
    }

    function _updateSeries(frameIdx) {
        if (!_seriesData || _seriesCells.length === 0) return;
        const maxIdx = Math.max(_seriesData.totalFrames - 1, 1);
        const cx = (frameIdx / maxIdx) * SPARK_W;
        const ps = getPlayerStateAtFrameIndex(replayFramesRef, frameIdx);

        const headerEl = document.getElementById('replay-series-header');
        if (headerEl && ps) {
            const tags = [
                ps.flowState || '—',
                ps.pacingPhase || '—',
                ps.sessionPhase || '—',
                'R' + (ps.spawnRound ?? '—')
            ];
            headerEl.innerHTML = tags.map(t => `<span class="series-tag">${t}</span>`).join('');
        }

        for (const c of _seriesCells) {
            if (c.cursorLine) {
                c.cursorLine.setAttribute('x1', cx.toFixed(1));
                c.cursorLine.setAttribute('x2', cx.toFixed(1));
            }
            const val = ps ? getMetricFromPS(ps, c.key) : null;
            if (c.valueEl) c.valueEl.textContent = formatMetricValue(val, c.fmt);
        }
    }

    function show(el) {
        document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
        el.classList.add('active');
        game.updateShellVisibility?.();
    }

    function stopPlay() {
        if (playTimer) {
            clearInterval(playTimer);
            playTimer = null;
        }
    }

    function sessionFromRow(row) {
        const { frames: _f, analysis: _a, ...rest } = row;
        return rest;
    }

    function sessionIdFromRow(row) {
        const id = row.id ?? row.sessionId ?? row.session_id;
        return id != null ? Number(id) : NaN;
    }

    function updateSelectionUi() {
        const cbs = sessionListEl.querySelectorAll('.replay-select-cb');
        const n = cbs.length;
        let checked = 0;
        cbs.forEach((cb) => {
            if (cb.checked) checked += 1;
        });
        if (selectedCountEl) {
            selectedCountEl.textContent = `已选 ${checked} 条`;
        }
        if (deleteSelectedBtn) {
            deleteSelectedBtn.disabled = checked === 0;
        }
        if (selectAllCb && n > 0) {
            selectAllCb.disabled = false;
            selectAllCb.checked = checked === n;
            selectAllCb.indeterminate = checked > 0 && checked < n;
        } else if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = false;
            selectAllCb.disabled = n === 0;
        }
    }

    /** 后端不可用时逐条拉 move_sequence（较慢，易漏） */
    async function loadReplayRowsLegacy() {
        const sessions = await game.db.getSessionsByUser(120);
        const rows = [];
        for (const s of sessions) {
            const sid = s.id ?? s.sessionId ?? s.session_id;
            if (sid == null) {
                continue;
            }
            const frames = await game.db.getMoveSequence(sid);
            if (!frames || frames.length < 1 || frames[0]?.t !== 'init' || !frames[0]?.grid) {
                continue;
            }
            rows.push({ ...s, frames });
        }
        rows.sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));
        return rows;
    }

    async function openList() {
        stopPlay();
        replayFramesRef = null;
        replayAnalysisRef = null;
        _clearSeries();
        game.endReplay?.();
        sessionListEl.innerHTML = '';
        if (selectAllCb) {
            selectAllCb.checked = false;
            selectAllCb.indeterminate = false;
        }
        try {
            let rows = [];
            try {
                rows = await game.db.listReplaySessions(80);
            } catch {
                rows = await loadReplayRowsLegacy();
            }
            if (rows.length === 0) {
                if (listToolbar) listToolbar.hidden = true;
                sessionListEl.innerHTML =
                    '<li class="replay-empty">暂无可回放对局。请确认已运行 Flask（npm run server）、本机已完整打完至少一局，且开局后序列会写入 SQLite。</li>';
            } else {
                if (listToolbar) listToolbar.hidden = false;
                rows.sort((a, b) => Number(b.startTime || 0) - Number(a.startTime || 0));
                for (const row of rows) {
                    const frames = row.frames;
                    if (!Array.isArray(frames)) {
                        continue;
                    }
                    const s = sessionFromRow(row);
                    const sid = sessionIdFromRow(row);
                    if (!Number.isFinite(sid)) {
                        continue;
                    }
                    const li = document.createElement('li');
                    li.className = 'replay-list-item';
                    const t = new Date(s.startTime || s.endTime || Date.now());
                    const derived = displayScoreFromReplayFrames(frames);
                    const score =
                        derived != null ? derived : s.score != null && s.score !== '' ? s.score : '—';
                    const placeSteps = countPlaceStepsInFrames(frames);
                    const stepsText = `${placeSteps} 帧`;
                    li.innerHTML = `
                        <label class="replay-item-check">
                            <input type="checkbox" class="replay-select-cb" data-session-id="${sid}" aria-label="选择本条回放" />
                        </label>
                        <div class="replay-item-main" role="button" tabindex="0" aria-label="打开回放">
                            <span class="replay-item-meta">${t.toLocaleString()}</span>
                            <span class="replay-item-steps" title="帧数按成功落子统计；开局盘面与每轮出块只用于回放重建，不计入帧数">${stepsText}</span>
                            <span class="replay-item-score">${score} 分</span>
                        </div>`;
                    const mainEl = li.querySelector('.replay-item-main');
                    const cb = li.querySelector('.replay-select-cb');
                    cb?.addEventListener('change', () => updateSelectionUi());
                    const resolved = resolvedReplayAnalysis(row, frames);
                    const listAnalysis = resolved.analysis;
                    if (listAnalysis && Number.isFinite(Number(listAnalysis.rating))) {
                        const tag = document.createElement('span');
                        tag.className = 'replay-item-analysis';
                        if (resolved.derived) tag.classList.add('replay-item-analysis--derived');
                        tag.textContent = `评价 ${listAnalysis.rating}/5`;
                        tag.title = resolved.derived
                            ? `${listAnalysis.summary || ''}\n（根据回放帧本地补算；局末成功写入库后应与之一致）`.trim()
                            : (listAnalysis.summary || '');
                        mainEl?.appendChild(tag);
                    }
                    const open = () => openView({ ...s, analysis: listAnalysis }, frames);
                    mainEl?.addEventListener('click', open);
                    mainEl?.addEventListener('keydown', (ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                            ev.preventDefault();
                            open();
                        }
                    });
                    sessionListEl.appendChild(li);
                }
                updateSelectionUi();
            }
        } catch (e) {
            console.error(e);
            if (listToolbar) listToolbar.hidden = true;
            sessionListEl.innerHTML =
                '<li class="replay-empty">读取失败（请检查 VITE_API_BASE_URL 与后端是否运行）。</li>';
        }
        show(listScreen);
    }

    selectAllCb?.addEventListener('change', () => {
        const on = selectAllCb.checked;
        sessionListEl.querySelectorAll('.replay-select-cb').forEach((cb) => {
            cb.checked = on;
        });
        updateSelectionUi();
    });

    deleteSelectedBtn?.addEventListener('click', async () => {
        const ids = [];
        sessionListEl.querySelectorAll('.replay-select-cb:checked').forEach((cb) => {
            const id = Number(cb.getAttribute('data-session-id'));
            if (Number.isFinite(id)) ids.push(id);
        });
        if (ids.length === 0) return;
        const ok = window.confirm(`确定删除选中的 ${ids.length} 条对局记录？此操作不可恢复。`);
        if (!ok) return;
        try {
            await game.db.deleteReplaySessions(ids);
            await openList();
        } catch (err) {
            console.error(err);
            window.alert(err?.message || String(err));
        }
    });

    deleteZeroScoreBtn?.addEventListener('click', async () => {
        const ok = window.confirm(
            '确定删除所有「展示得分为 0」的可回放对局？与列表中 0 分判定一致（优先帧内快照分）。此操作不可恢复。'
        );
        if (!ok) return;
        try {
            const res = await game.db.deleteZeroScoreReplaySessions();
            const n = res?.count ?? res?.deleted?.length ?? 0;
            await openList();
            window.alert(n > 0 ? `已删除 ${n} 条。` : '没有符合「得分为 0」的记录。');
        } catch (err) {
            console.error(err);
            window.alert(err?.message || String(err));
        }
    });

    function openView(session, frames) {
        stopPlay();
        if (!game.beginReplayFromFrames(frames)) {
            return;
        }
        replayFramesRef = frames;
        replayAnalysisRef = session.analysis || null;
        // v1.13：通知上方"实时状态"面板切换为只读回放数据源（stressMeter + sparkline 网格）。
        // 必须先于 _initSeries / updateLabel 调用，否则首帧 updateInsightReplayFrame(0) 不会渲染。
        enterInsightReplay(frames);
        const maxIdx = game.getReplayMaxIndex();
        slider.min = '0';
        slider.max = String(maxIdx);
        slider.value = '0';
        if (titleEl) {
            const derived = displayScoreFromReplayFrames(frames);
            const sc =
                derived != null
                    ? derived
                    : session.score != null && session.score !== ''
                      ? session.score
                      : '—';
            titleEl.textContent = sc === '—' ? '回放' : `回放 · ${sc} 分`;
        }
        if (playerStateEl && !_initSeries(frames)) {
            const ps = getPlayerStateAtFrameIndex(frames, 0);
            const analysisHtml = formatReplayAnalysisHtml(replayAnalysisRef);
            if (analysisHtml) {
                playerStateEl.innerHTML = `${analysisHtml}<pre>${_html(formatPlayerStateForReplay(ps))}</pre>`;
            } else {
                playerStateEl.textContent = formatPlayerStateForReplay(ps);
            }
        }
        updateLabel(0, maxIdx);
        show(viewScreen);
    }

    function frameTypeLabel(frames, idx) {
        const t = frames?.[idx]?.t;
        if (t === 'init') return '开局';
        if (t === 'spawn') return '出块';
        if (t === 'place') return '落子';
        return t || '—';
    }

    function updateLabel(idx, maxIdx) {
        if (label) {
            const ft = frameTypeLabel(replayFramesRef, idx);
            label.textContent = `帧 ${idx} / ${maxIdx} · ${ft}`;
        }
        if (_seriesData) {
            _updateSeries(idx);
        } else if (playerStateEl) {
            const ps = getPlayerStateAtFrameIndex(replayFramesRef, idx);
            const analysisHtml = formatReplayAnalysisHtml(replayAnalysisRef);
            if (analysisHtml) {
                playerStateEl.innerHTML = `${analysisHtml}<pre>${_html(formatPlayerStateForReplay(ps))}</pre>`;
            } else {
                playerStateEl.textContent = formatPlayerStateForReplay(ps);
            }
        }
        // v1.13：把当前帧投射回左侧画像里的「实时状态」卡 ——
        //   1) stressMeter（情绪头像 + bar + 数值 + 趋势箭头 + "主要构成"分量）；
        //   2) 12 指标 sparkline 网格 + 顶部 flow/release/peak/R{n} tags + 📼 回放 chip。
        // 上方实时状态区因此承载完整回放数据，不再需要下方 #replay-player-state 内重复的
        // sparkline 网格（避免视觉冗余 —— 由 CSS 把下方 grid + header 隐藏）。
        // playerInsightPanel 在回放期间不会主动 _render，这里是它在回放期间的唯一更新源；
        // 返回 LIVE 后 viewBack 调用 exitInsightReplay() + 触发一次 _refreshPlayerInsightPanel
        // 由 LIVE 接管。
        updateInsightReplayFrame(idx);
    }

    slider.addEventListener('input', () => {
        stopPlay();
        const idx = Number(slider.value);
        game.applyReplayFrameIndex(idx);
        updateLabel(idx, Number(slider.max));
    });

    playBtn?.addEventListener('click', () => {
        if (playTimer) {
            return;
        }
        const mx = Number(slider.max);
        let v = Number(slider.value);
        if (v >= mx) {
            v = 0;
            slider.value = '0';
            game.applyReplayFrameIndex(0);
            updateLabel(0, mx);
        }
        playTimer = setInterval(() => {
            const cur = Number(slider.value);
            if (cur >= mx) {
                stopPlay();
                return;
            }
            if (!replayFramesRef?.length) {
                stopPlay();
                return;
            }
            /* 跳过 replayStateAt 中无效 place 等导致的「连续相同画面」，避免长时间停在同一帧 */
            const nextIdx = nextDistinctReplayFrameIndex(replayFramesRef, cur, mx);
            slider.value = String(nextIdx);
            game.applyReplayFrameIndex(nextIdx);
            updateLabel(nextIdx, mx);
        }, 550);
    });

    pauseBtn?.addEventListener('click', () => stopPlay());

    menuReplayBtn.addEventListener('click', () => void openList());
    listBack?.addEventListener('click', () => {
        show(document.getElementById('menu'));
    });
    viewBack?.addEventListener('click', () => {
        stopPlay();
        replayFramesRef = null;
        replayAnalysisRef = null;
        _clearSeries();
        game.endReplay();
        // v1.13：退出回放模式 —— 上方面板下次落子/出块时自然回到 LIVE 数据源。
        // 这里立刻调一次 _refreshPlayerInsightPanel，避免菜单里"重玩"或"新游戏"前
        // 短暂残留回放最后一帧的 stressMeter / sparkline 状态让玩家困惑。
        exitInsightReplay();
        game._refreshPlayerInsightPanel?.();
        show(listScreen);
        void openList();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPlay();
        }
    });
}
