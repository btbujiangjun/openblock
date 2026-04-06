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

    if (!menuReplayBtn || !listScreen || !viewScreen || !slider) {
        return;
    }

    let playTimer = null;

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
                    const score = s.score != null ? s.score : '—';
                    li.innerHTML = `
                        <label class="replay-item-check">
                            <input type="checkbox" class="replay-select-cb" data-session-id="${sid}" aria-label="选择本条回放" />
                        </label>
                        <div class="replay-item-main" role="button" tabindex="0" aria-label="打开回放">
                            <span class="replay-item-meta">${t.toLocaleString()}</span>
                            <span class="replay-item-strategy">${s.strategy || '?'}</span>
                            <span class="replay-item-score">${score} 分</span>
                            <span class="replay-item-steps">${frames.length} 帧</span>
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

    function openView(session, frames) {
        stopPlay();
        if (!game.beginReplayFromFrames(frames)) {
            return;
        }
        const maxIdx = game.getReplayMaxIndex();
        slider.min = '0';
        slider.max = String(maxIdx);
        slider.value = '0';
        if (titleEl) {
            titleEl.textContent = `回放 · ${session.strategy || '?'} · ${session.score != null ? session.score + ' 分' : ''}`;
        }
        updateLabel(0, maxIdx);
        show(viewScreen);
    }

    function updateLabel(idx, maxIdx) {
        if (label) {
            label.textContent = `帧 ${idx} / ${maxIdx}`;
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
        playTimer = setInterval(() => {
            let v = Number(slider.value);
            const mx = Number(slider.max);
            if (v >= mx) {
                stopPlay();
                return;
            }
            v += 1;
            slider.value = String(v);
            game.applyReplayFrameIndex(v);
            updateLabel(v, mx);
        }, 550);
    });

    pauseBtn?.addEventListener('click', () => stopPlay());

    menuReplayBtn.addEventListener('click', () => void openList());
    listBack?.addEventListener('click', () => {
        show(document.getElementById('menu'));
    });
    viewBack?.addEventListener('click', () => {
        stopPlay();
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
