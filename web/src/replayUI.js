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
import {
    sparklineSvg,
    SPARK_W,
    METRIC_GROUP_COLORS,
    getMetricLabelColor
} from './sparkline.js';
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
    const userFilterWrap = document.getElementById('replay-user-filter-wrap');
    const userFilterSel = document.getElementById('replay-user-filter');

    /* 用户筛选：'__all_users__' = admin 全库；其余 = 具体 user_id（含"自己"）。
     * 仅在 OPENBLOCK_DB_DEBUG=1（listReplayUsers 返回非空）时显示下拉，
     * 否则维持"仅自己"私域行为。 */
    const ALL_USERS_SENTINEL = '__all_users__';
    let _usersPopulated = false;
    let _adminMode = false;   // 下拉可用（DB_DEBUG 开）

    if (!menuReplayBtn || !listScreen || !viewScreen || !slider) {
        return;
    }

    let playTimer = null;
    /** @type {object[] | null} 当前打开的回放帧（供玩家状态同步展示） */
    let replayFramesRef = null;
    let replayAnalysisRef = null;
    /** 退出回放屏后的目标：'list'（默认，返回回放列表）| 'game-over'（返回结算面板）。
     *  结算面板的「本局回放」入口会传 'game-over'，让用户回放后无缝回到结算页继续操作。 */
    let _viewExitTarget = 'list';

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
        for (let i = 0; i < data.metrics.length; i++) {
            const m = data.metrics[i];
            const s = data.series[m.key];
            const color = METRIC_GROUP_COLORS[m.group] || '#5b9bd5';
            const labelColor = getMetricLabelColor(m.key, color, i);
            const tip = m.tooltip || '';
            html += `<div class="replay-series-cell" data-key="${m.key}" title="${_attrTitle(tip)}">` +
                `<span class="series-label series-label--metric" style="--series-label-color:${labelColor}">${m.label}</span>` +
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
            _seriesCells.push({
                key: m.key, fmt: m.fmt, cursorLine, valueEl
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

    /** 当前选择要加载哪个用户：返回 '' = admin 全库，否则具体 user_id。 */
    function _targetUserId() {
        if (!_adminMode || !userFilterSel) return undefined;   // 私域：用 db 默认（自己）
        const v = (userFilterSel.value || '').trim();
        if (v === ALL_USERS_SENTINEL) return '';               // 全库
        return v || undefined;
    }

    /** 当前是否处于"全库聚合"视图（影响是否展示每行用户、禁用按用户删 0 分）。 */
    function _isAllUsersView() {
        return _adminMode && userFilterSel && userFilterSel.value === ALL_USERS_SENTINEL;
    }

    function _shortId(id) {
        const s = String(id || '');
        return s.length > 18 ? s.slice(0, 16) + '…' : s;
    }

    /**
     * 填充用户筛选下拉（仅首次）。
     *   - listReplayUsers 返回非空 → DB_DEBUG 开，进入 admin 模式：
     *       置顶"🌐 所有用户" + "👤 自己" + 其他用户（按活跃度）
     *   - 返回空 → 私域模式：隐藏下拉，维持"仅自己"
     */
    async function populateUserFilter() {
        if (_usersPopulated || !userFilterSel) return;
        let users = [];
        try {
            users = await game.db.listReplayUsers();
        } catch {
            users = [];
        }
        const myId = game.db.currentUserId || '';
        if (!Array.isArray(users) || users.length === 0) {
            // 私域模式：不显示下拉
            _adminMode = false;
            if (userFilterWrap) userFilterWrap.hidden = true;
            _usersPopulated = true;
            return;
        }
        _adminMode = true;
        if (userFilterWrap) userFilterWrap.hidden = false;

        const ordered = [];
        const seen = new Set();
        const me = users.find((u) => u.userId === myId);
        if (myId) {
            ordered.push(me || { userId: myId, sessionCount: 0 });
            seen.add(myId);
        }
        for (const u of users) {
            if (!seen.has(u.userId)) { ordered.push(u); seen.add(u.userId); }
        }
        const fmt = (u) => {
            const tag = u.userId === myId ? '👤 自己 · ' : '';
            const sess = u.sessionCount > 0 ? ` · ${u.sessionCount} 局` : '';
            return `${tag}${_shortId(u.userId)}${sess}`;
        };
        const opts = [
            `<option value="${ALL_USERS_SENTINEL}">🌐 所有用户（${users.length}）</option>`,
            ...ordered.map((u) =>
                `<option value="${_html(u.userId)}"${u.userId === myId ? ' selected' : ''}>${_html(fmt(u))}</option>`
            ),
        ];
        userFilterSel.innerHTML = opts.join('');
        // 默认选中"自己"（保持原有默认行为）；若无 myId 则退到全库
        if (myId && seen.has(myId)) {
            userFilterSel.value = myId;
        } else {
            userFilterSel.value = ALL_USERS_SENTINEL;
        }
        _usersPopulated = true;
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
        await populateUserFilter();
        const allUsersView = _isAllUsersView();
        if (deleteZeroScoreBtn) {
            // "删除得分为0" 是按单一用户作用的；全库聚合视图下禁用避免歧义
            deleteZeroScoreBtn.disabled = allUsersView;
            deleteZeroScoreBtn.title = allUsersView
                ? '全库视图下不可用——请先在上方选择具体用户再删其 0 分对局'
                : '删除列表中展示为 0 分的对局记录';
        }
        try {
            let rows = [];
            try {
                rows = await game.db.listReplaySessions(80, _targetUserId());
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
                    const rowUserId = s.userId ?? s.user_id ?? '';
                    const userTag = allUsersView && rowUserId
                        ? `<span class="replay-item-user" title="${_attrTitle(rowUserId)}">👤 ${_html(_shortId(rowUserId))}</span>`
                        : '';
                    li.innerHTML = `
                        <label class="replay-item-check">
                            <input type="checkbox" class="replay-select-cb" data-session-id="${sid}" data-user-id="${_attrTitle(rowUserId)}" aria-label="选择本条回放" />
                        </label>
                        <div class="replay-item-main" role="button" tabindex="0" aria-label="打开回放">
                            <span class="replay-item-meta">${t.toLocaleString()}</span>
                            ${userTag}
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
        /* 按行所属 user 分组：单用户视图整组同一 user；全库视图可能跨用户，
         * 分组后逐用户调用，确保服务端 user_id 归属校验通过。空 user_id（私域）→ 用默认。 */
        const groups = new Map();
        let total = 0;
        sessionListEl.querySelectorAll('.replay-select-cb:checked').forEach((cb) => {
            const id = Number(cb.getAttribute('data-session-id'));
            if (!Number.isFinite(id)) return;
            const uid = cb.getAttribute('data-user-id') || '';
            if (!groups.has(uid)) groups.set(uid, []);
            groups.get(uid).push(id);
            total += 1;
        });
        if (total === 0) return;
        const crossUser = groups.size > 1;
        const ok = await _showConfirmDialog(
            `确定删除选中的 ${total} 条对局记录${crossUser ? `（涉及 ${groups.size} 个用户）` : ''}？此操作不可恢复。`
        );
        if (!ok) return;
        try {
            let deleted = 0;
            for (const [uid, ids] of groups) {
                const res = await game.db.deleteReplaySessions(ids, uid || undefined);
                deleted += res?.count ?? ids.length;
            }
            await openList();
            if (crossUser) _showAlert(`已删除 ${deleted} 条（跨 ${groups.size} 用户）。`, 'success');
        } catch (err) {
            console.error(err);
            _showAlert(err?.message || String(err), 'error');
        }
    });

    deleteZeroScoreBtn?.addEventListener('click', async () => {
        const ok = await _showConfirmDialog(
            '确定删除所有「展示得分为 0」的可回放对局？与列表中 0 分判定一致（优先帧内快照分）。此操作不可恢复。'
        );
        if (!ok) return;
        try {
            const res = await game.db.deleteZeroScoreReplaySessions(_targetUserId());
            const n = res?.count ?? res?.deleted?.length ?? 0;
            await openList();
            _showAlert(n > 0 ? `已删除 ${n} 条。` : '没有符合「得分为 0」的记录。', 'success');
        } catch (err) {
            console.error(err);
            _showAlert(err?.message || String(err), 'error');
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

    userFilterSel?.addEventListener('change', () => void openList());

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
        if (_viewExitTarget === 'game-over') {
            const gameOver = document.getElementById('game-over');
            if (gameOver) {
                /* beginReplayFromFrames 把 isGameOver 设为 false，结算页路径要还原回 true，
                 * 避免回到浮层后底层 dock 的输入门控被意外解开。 */
                game.isGameOver = true;
                show(gameOver);
                _viewExitTarget = 'list';
                return;
            }
        }
        _viewExitTarget = 'list';
        show(listScreen);
        void openList();
    });

    /**
     * 一键打开"指定帧序列"的回放（不经过列表）。供结算面板「本局回放」按钮使用。
     *
     * 与列表入口相比，本路径直接复用调用方传入的 frames（通常是 game.moveSequence
     * 内存版本，无需查询 SQLite），并在退出回放屏时根据 exitTarget 决定回到结算页
     * 还是回到回放列表。失败返回 false，调用方自行降级（toast 等）。
     *
     * @param {object[]} frames 帧数组（首帧需为含 grid 的 init）
     * @param {{ score?: number, exitTarget?: 'list' | 'game-over' }} [meta]
     * @returns {boolean} 是否成功进入回放屏
     */
    function openFromFrames(frames, meta = {}) {
        if (!Array.isArray(frames) || frames.length === 0) return false;
        _viewExitTarget = meta.exitTarget === 'game-over' ? 'game-over' : 'list';
        const session = {
            score: meta.score,
            startTime: meta.startTime ?? Date.now(),
            analysis: meta.analysis ?? null,
        };
        try {
            openView(session, frames);
            return true;
        } catch (e) {
            console.warn('[replay] openFromFrames failed', e);
            _viewExitTarget = 'list';
            return false;
        }
    }

    /* 暴露给结算面板等外部入口；仅 view-replay 流程，不影响 menu-replay-btn 与列表逻辑。 */
    if (typeof window !== 'undefined') {
        window.__replayUI = Object.assign(window.__replayUI || {}, { openFromFrames });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPlay();
        }
    });
}

/* ── 美化通知 / 确认弹窗 ── */
(function _injectReplayModalStyle() {
    if (document.getElementById('__openblock_replay_modal_style')) return;
    const s = document.createElement('style');
    s.id = '__openblock_replay_modal_style';
    s.textContent = `
    .replay-modal-backdrop {
        position: fixed; inset:0; z-index: 99998;
        background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(3px); animation: fadeIn .2s ease;
    }
    .replay-modal-box {
        background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
        border: 1px solid #334155; border-radius: 14px;
        padding: 28px 30px 22px; max-width: 440px; width: 90%;
        box-shadow: 0 24px 64px rgba(0,0,0,.55);
        animation: modalSlide .25s cubic-bezier(.22,1,.36,1);
    }
    .replay-modal-box .modal-header {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 16px; font-size: 15px; font-weight: 600; color: #f1f5f9;
    }
    .replay-modal-box .modal-header .icon { font-size: 20px; }
    .replay-modal-box .msg {
        color: #cbd5e1; font-size: 13.5px; line-height: 1.6;
        margin-bottom: 20px; white-space: pre-wrap;
    }
    .replay-modal-box .actions {
        display: flex; gap: 10px; justify-content: flex-end;
        border-top: 1px solid #1e293b; padding-top: 16px;
    }
    .replay-modal-box .actions button {
        padding: 8px 22px; border-radius: 8px; font-size: 13px; font-weight: 500;
        cursor: pointer; border: 1px solid transparent;
        transition: all .18s; text-align: center; display: inline-flex;
        align-items: center; justify-content: center; min-width: 80px;
        line-height: 1; letter-spacing: .3px;
    }
    .replay-modal-box .actions .btn-cancel {
        background: transparent; border-color: #334155; color: #94a3b8;
    }
    .replay-modal-box .actions .btn-cancel:hover {
        background: #1e293b; border-color: #475569; color: #e2e8f0;
    }
    .replay-modal-box .actions .btn-confirm {
        background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
        color: #fff; border-color: #ef4444; box-shadow: 0 2px 8px rgba(239,68,68,.25);
    }
    .replay-modal-box .actions .btn-confirm:hover {
        background: linear-gradient(135deg, #f87171 0%, #ef4446 100%);
        box-shadow: 0 4px 14px rgba(239,68,68,.35); transform: translateY(-1px);
    }
    @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
    @keyframes modalSlide { from { opacity: 0; transform: scale(.94) translateY(12px); } to { opacity: 1; transform: scale(1) translateY(0); } }
    `;
    document.head.appendChild(s);
})();

function _showConfirmDialog(msg) {
    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.className = 'replay-modal-backdrop';
        backdrop.innerHTML = `<div class="replay-modal-box">
            <div class="modal-header"><span class="icon">⚠</span><span>确认操作</span></div>
            <div class="msg">${_escapeHtml(msg)}</div>
            <div class="actions">
                <button class="btn-cancel" data-action="cancel">取消</button>
                <button class="btn-confirm" data-action="confirm">确认</button>
            </div>
        </div>`;
        document.body.appendChild(backdrop);
        backdrop.querySelector('.btn-cancel').onclick = () => { backdrop.remove(); resolve(false); };
        backdrop.querySelector('.btn-confirm').onclick = () => { backdrop.remove(); resolve(true); };
        backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { backdrop.remove(); resolve(false); } });
    });
}

function _escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _showAlert(msg, type = 'info') {
    const map = { success: '#22c55e', error: '#ef4444', warn: '#eab308', info: '#38bdf8' };
    const el = document.createElement('div');
    Object.assign(el.style, {
        position:'fixed', top:'80px', left:'50%', transform:'translateX(-50%)', zIndex:99999,
        background:'#1e293b', border:`1px solid ${map[type] || map.info}`, borderRadius:'10px',
        padding:'14px 28px', color:'#e2e8f0', fontSize:'14px', lineHeight:'1.4',
        boxShadow:'0 8px 32px rgba(0,0,0,.45)', opacity:'0', transition:'opacity .3s ease',
    });
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.style.opacity = '1'));
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 350); }, 3000);
}
