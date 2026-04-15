/**
 * Spawn Model Panel: 出块算法切换 + 模型训练入口
 *
 * 增量设计：独立模块，通过 initSpawnModelPanel(game) 挂载，
 * 不修改现有 game/adaptiveSpawn 核心逻辑。
 */

import {
    getSpawnMode,
    setSpawnMode,
    getModelStatus,
    startTraining,
    stopTraining,
    reloadModel,
} from './spawnModel.js';

let _pollTimer = null;

export function initSpawnModelPanel(game) {
    const radios = document.querySelectorAll('input[name="spawn-mode"]');
    const badge = document.getElementById('spawn-model-badge');
    const btnStart = document.getElementById('spawn-train-start');
    const btnStop = document.getElementById('spawn-train-stop');
    const btnReload = document.getElementById('spawn-model-reload');
    const progressWrap = document.getElementById('spawn-train-progress');
    const progressFill = document.getElementById('spawn-train-fill');
    const progressMsg = document.getElementById('spawn-train-msg');
    const epochsInput = document.getElementById('spawn-train-epochs');
    const minScoreInput = document.getElementById('spawn-train-min-score');
    const maxSessionsInput = document.getElementById('spawn-train-max-sessions');

    if (!radios.length || !badge) return;

    const currentMode = getSpawnMode();
    radios.forEach((r) => {
        if (r.value === currentMode) r.checked = true;
    });

    radios.forEach((r) => {
        r.addEventListener('change', () => {
            if (r.checked) {
                setSpawnMode(r.value);
                _refreshBadge();
                if (typeof game._playerInsightRefresh === 'function') {
                    game._playerInsightRefresh();
                }
            }
        });
    });

    if (btnStart) {
        btnStart.addEventListener('click', async () => {
            btnStart.disabled = true;
            try {
                await startTraining({
                    epochs: parseInt(epochsInput?.value) || 50,
                    minScore: parseInt(minScoreInput?.value) || 0,
                    maxSessions: parseInt(maxSessionsInput?.value) || 500,
                });
                _startPolling();
            } catch (e) {
                if (progressMsg) progressMsg.textContent = '启动失败: ' + (e.message || e);
                btnStart.disabled = false;
            }
        });
    }

    if (btnStop) {
        btnStop.addEventListener('click', async () => {
            try {
                await stopTraining();
            } catch { /* ignore */ }
            _refreshBadge();
        });
    }

    if (btnReload) {
        btnReload.addEventListener('click', async () => {
            try {
                const res = await reloadModel();
                if (res?.success && badge) {
                    badge.textContent = `模型已加载 (${(res.params / 1000).toFixed(0)}K)`;
                    badge.className = 'spawn-model-status available';
                }
            } catch (e) {
                if (badge) {
                    badge.textContent = '加载失败';
                    badge.className = 'spawn-model-status';
                }
            }
        });
    }

    _refreshBadge();

    async function _refreshBadge() {
        try {
            const st = await getModelStatus();
            _updateUI(st);
        } catch {
            if (badge) {
                badge.textContent = '服务不可用';
                badge.className = 'spawn-model-status';
            }
        }
    }

    function _updateUI(st) {
        if (!badge) return;

        if (st.trainingRunning) {
            badge.textContent = `训练中 ${st.progress ?? 0}%`;
            badge.className = 'spawn-model-status training';
            if (btnStart) btnStart.disabled = true;
            if (btnStop) btnStop.disabled = false;
            if (progressWrap) progressWrap.hidden = false;
            if (progressFill) progressFill.style.width = `${st.progress ?? 0}%`;
            if (progressMsg) progressMsg.textContent = st.message || '';
        } else if (st.modelAvailable) {
            badge.textContent = '模型可用';
            badge.className = 'spawn-model-status available';
            if (btnStart) btnStart.disabled = false;
            if (btnStop) btnStop.disabled = true;
            if (st.phase === 'done') {
                if (progressWrap) progressWrap.hidden = false;
                if (progressFill) progressFill.style.width = '100%';
                if (progressMsg) progressMsg.textContent = st.message || '训练完成';
            }
        } else {
            badge.textContent = '模型未训练';
            badge.className = 'spawn-model-status';
            if (btnStart) btnStart.disabled = false;
            if (btnStop) btnStop.disabled = true;
        }

        const modelRadio = document.querySelector('input[name="spawn-mode"][value="model"]');
        if (modelRadio) {
            const label = modelRadio.closest('.spawn-mode-label');
            if (label) {
                label.style.opacity = st.modelAvailable ? '1' : '0.5';
            }
        }
    }

    function _startPolling() {
        if (_pollTimer) clearInterval(_pollTimer);
        _pollTimer = setInterval(async () => {
            try {
                const st = await getModelStatus();
                _updateUI(st);
                if (!st.trainingRunning) {
                    clearInterval(_pollTimer);
                    _pollTimer = null;
                    if (st.phase === 'done') {
                        try { await reloadModel(); } catch { /* ignore */ }
                        _refreshBadge();
                    }
                }
            } catch {
                clearInterval(_pollTimer);
                _pollTimer = null;
            }
        }, 3000);
    }
}
