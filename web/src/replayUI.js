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

    if (!menuReplayBtn || !listScreen || !viewScreen || !slider) {
        return;
    }

    let playTimer = null;
    let currentFrames = null;

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

    async function openList() {
        stopPlay();
        game.endReplay?.();
        sessionListEl.innerHTML = '';
        try {
            const sessions = await game.db.getSessionsByUser(80);
            const rows = [];
            for (const s of sessions) {
                if (s.status !== 'completed' && s.status !== 'active') {
                    continue;
                }
                const sid = s.id ?? s.sessionId ?? s.session_id;
                if (sid == null) {
                    continue;
                }
                const frames = await game.db.getMoveSequence(sid);
                /* 至少 init + 一条后续帧（spawn 或 place）才有可播内容 */
                if (!frames || frames.length < 2 || frames[0]?.t !== 'init') {
                    continue;
                }
                rows.push({ session: s, frames });
            }
            if (rows.length === 0) {
                sessionListEl.innerHTML =
                    '<li class="replay-empty">暂无带落子序列的对局（需本版本开局后产生）。</li>';
            } else {
                for (const { session: s, frames } of rows) {
                    const li = document.createElement('li');
                    li.className = 'replay-list-item';
                    const t = new Date(s.startTime || s.endTime || Date.now());
                    const score = s.score != null ? s.score : '—';
                    li.innerHTML = `<span class="replay-item-meta">${t.toLocaleString()}</span><span class="replay-item-strategy">${s.strategy || '?'}</span><span class="replay-item-score">${score} 分</span><span class="replay-item-steps">${frames.length} 帧</span>`;
                    li.addEventListener('click', () => openView(s, frames));
                    sessionListEl.appendChild(li);
                }
            }
        } catch (e) {
            console.error(e);
            sessionListEl.innerHTML = '<li class="replay-empty">读取失败</li>';
        }
        show(listScreen);
    }

    function openView(session, frames) {
        stopPlay();
        currentFrames = frames;
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
