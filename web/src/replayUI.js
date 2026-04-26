import {
    countPlaceStepsInFrames,
    displayScoreFromReplayFrames,
    formatPlayerStateForReplay,
    getPlayerStateAtFrameIndex,
    nextDistinctReplayFrameIndex,
    collectReplayMetricsSeries,
    getMetricFromPS,
    formatMetricValue
} from './moveSequence.js';
import { sparklineSvg, SPARK_W, METRIC_GROUP_COLORS } from './sparkline.js';

function _attrTitle(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
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

        let html = '<div class="replay-series-header" id="replay-series-header"></div>';
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
        const { frames: _f, ...rest } = row;
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
                    const open = () => openView(s, frames);
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
            playerStateEl.textContent = formatPlayerStateForReplay(ps);
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
            playerStateEl.textContent = formatPlayerStateForReplay(ps);
        }
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
        _clearSeries();
        game.endReplay();
        show(listScreen);
        void openList();
    });

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            stopPlay();
        }
    });
}
