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
import { resolveAdaptiveStrategy } from './adaptiveSpawn.js';
import { getLastSpawnDiagnostics } from './bot/blockSpawn.js';

let _pollTimer = null;
let _layerRefreshTimer = null;

/** 实时刷新三层参数展示（对应 blockSpawn.js 三层架构） */
function _refreshLayerParams(game) {
    if (!game) return;
    const ctx = game._spawnContext ?? {};
    const profile = game.playerProfile;

    // 从 blockSpawn.js 获取上一轮出块诊断（Layer 1 数据来源）
    const diag = getLastSpawnDiagnostics();

    // 从 resolveAdaptiveStrategy 获取 spawnHints（Layer 2/3 数据来源）
    // 注意：第 5 个参数必须传棋盘填充率，而非消行数
    let hints = {};
    try {
        const strategy = resolveAdaptiveStrategy(
            game.strategy,
            profile,
            game.score ?? 0,
            game.runStreak ?? 0,
            game.grid?.getFillRatio() ?? 0,   // 正确：棋盘填充率
            ctx
        );
        hints = strategy.spawnHints ?? {};
    } catch { /* ignore */ }

    // ── Layer 1: 盘面拓扑感知 ──────────────────────────────────────────────
    const fill = diag?.layer1?.fill ?? game.grid?.getFillRatio() ?? null;
    _set('sl-fill',    fill != null ? (fill * 100).toFixed(1) + '%' : '–');
    _set('sl-holes',   diag?.layer1?.holes ?? '–');
    _set('sl-flatness', diag?.layer1?.flatness != null
        ? diag.layer1.flatness.toFixed(2) : '–');
    const nfl = diag?.layer1?.nearFullLines ?? 0;
    // 临消行数高亮：≥4 显示清屏预警
    const nflText = nfl >= 5 ? `${nfl} 🔥清屏机会` : nfl >= 4 ? `${nfl} ⚡多消窗口` : String(nfl);
    _set('sl-nfl', nfl > 0 ? nflText : '–');
    _set('sl-mcc', diag?.layer1?.multiClearCandidates ?? '–');

    // ── Layer 2: 局内体验 ─────────────────────────────────────────────────
    _set('sl-cc', hints.comboChain != null ? hints.comboChain.toFixed(2) : '0.00');
    _set('sl-rp', hints.rhythmPhase ?? 'neutral');
    _set('sl-cg', hints.clearGuarantee ?? 0);
    _set('sl-sp', hints.sizePreference != null ? hints.sizePreference.toFixed(2) : '0.00');

    // ── Layer 3: 局间弧线 ─────────────────────────────────────────────────
    // sessionArc 存在于 spawnHints 中，不在 _spawnContext 中
    _set('sl-arc',      hints.sessionArc ?? ctx.sessionArc ?? '–');
    _set('sl-milestone', hints.scoreMilestone ? '✅ 是' : '否');
    _set('sl-rsc',      diag?.layer3?.roundsSinceClear ?? ctx.roundsSinceClear ?? 0);
    _set('sl-div',      hints.diversityBoost != null
        ? hints.diversityBoost.toFixed(2) : '0.00');
}

function _set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(val);
}

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

    // 三层参数：每 2 秒刷新一次（面板展开时有意义）
    _layerRefreshTimer = setInterval(() => _refreshLayerParams(game), 2000);
    _refreshLayerParams(game);

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
