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
    getV3Status,
    startV3Training,
    stopTraining,
    reloadV3Model,
    SPAWN_MODE_MODEL_V3,
} from './spawnModel.js';
import { getLastSpawnDiagnostics } from './bot/blockSpawn.js';
import { skipWhenDocumentHidden } from './lib/pageVisibility.js';
import { getAllShapes } from './shapes.js';
import { analyzeBoardTopology } from './boardTopology.js';

let _pollTimer = null;
let _layerRefreshTimer = null;

function _bestMultiClearPotential(grid, shapeData) {
    if (!grid || !shapeData) return 0;
    let best = 0;
    for (let y = 0; y < grid.size; y++) {
        for (let x = 0; x < grid.size; x++) {
            const outcome = grid.previewClearOutcome?.(shapeData, x, y, 0);
            if (!outcome) continue;
            best = Math.max(best, (outcome.rows?.length ?? 0) + (outcome.cols?.length ?? 0));
            if (best >= 2) return best;
        }
    }
    return best;
}

function _countLiveMultiClearCandidates(grid) {
    if (!grid) return null;
    let count = 0;
    for (const shape of getAllShapes()) {
        if (_bestMultiClearPotential(grid, shape.data) >= 2) count++;
    }
    return count;
}

/** 实时刷新三层参数展示（对应 blockSpawn.js 三层架构） */
function _refreshLayerParams(game) {
    if (!game) return;
    const ctx = game._spawnContext ?? {};
    const profile = game.playerProfile;

    // 从 blockSpawn.js 获取上一轮出块诊断（Layer 1 数据来源）
    const diag = getLastSpawnDiagnostics();
    const hints = game._lastAdaptiveInsight?.spawnHints ?? {};
    const liveTopo = game.grid ? analyzeBoardTopology(game.grid) : null;

    // ── Layer 1: 盘面拓扑感知 ──────────────────────────────────────────────
    const fill = game.grid?.getFillRatio?.() ?? diag?.layer1?.fill ?? null;
    _set('sl-fill',    fill != null ? (fill * 100).toFixed(1) + '%' : '–');
    _set('sl-holes',   liveTopo?.holes ?? diag?.layer1?.holes ?? '–');
    const flatness = liveTopo?.flatness ?? diag?.layer1?.flatness;
    _set('sl-flatness', flatness != null ? flatness.toFixed(2) : '–');
    const nfl = liveTopo?.nearFullLines ?? diag?.layer1?.nearFullLines ?? 0;
    // 临消行数高亮：≥4 显示清屏预警
    const nflText = nfl >= 5 ? `${nfl} 🔥清屏机会` : nfl >= 4 ? `${nfl} ⚡多消窗口` : String(nfl);
    _set('sl-nfl', nfl > 0 ? nflText : '–');
    _set('sl-mcc', _countLiveMultiClearCandidates(game.grid) ?? diag?.layer1?.multiClearCandidates ?? '–');

    // ── Layer 2: 局内体验 ─────────────────────────────────────────────────
    _set('sl-cc', hints.comboChain != null ? hints.comboChain.toFixed(2) : '0.00');
    _set('sl-rp', hints.rhythmPhase ?? 'neutral');
    _set('sl-cg', hints.clearGuarantee ?? 0);
    _set('sl-sp', hints.sizePreference != null ? hints.sizePreference.toFixed(2) : '0.00');
    // 玩法偏好：直接从 profile 读取，中文化标签
    const playstyleMap = {
        perfect_hunter: '清屏', multi_clear: '多消',
        combo: '连消', survival: '生存', balanced: '均衡'
    };
    const psRaw = profile?.playstyle ?? 'balanced';
    _set('sl-playstyle', playstyleMap[psRaw] ?? psRaw);
    const meta = game._lastAdaptiveInsight?.spawnModelMeta;
    const source = game._lastAdaptiveInsight?.spawnSource ?? getSpawnMode();
    if (meta) {
        const parts = [
            meta.modelVersion || 'v3',
            meta.personalized ? '个性化' : '通用',
        ];
        if (meta.feasibleCount != null) parts.push(`可行${meta.feasibleCount}`);
        if (meta.fallbackReason) parts.push(`回退:${meta.fallbackReason}`);
        _set('sl-v3meta', parts.join(' / '));
    } else {
        _set('sl-v3meta', source === SPAWN_MODE_MODEL_V3 ? '等待 V3 推理' : '规则轨');
    }

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
            game._playerInsightRefresh?.();
            game._spawnModelLayerRefresh?.();
            }
        });
    });

    if (btnStart) {
        btnStart.addEventListener('click', async () => {
            btnStart.disabled = true;
            try {
                await startV3Training({
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
                const res = await reloadV3Model();
                if (res?.success && badge) {
                    badge.textContent = res.baseAvailable ? 'V3 已重载' : 'V3 未训练';
                    badge.className = res.baseAvailable ? 'spawn-model-status available' : 'spawn-model-status';
                }
            } catch {
                if (badge) {
                    badge.textContent = '加载失败';
                    badge.className = 'spawn-model-status';
                }
            }
        });
    }

    _refreshBadge();

    // 三层参数展示的是“上一轮出块快照”，不能后台轮询重算；
    // 否则无操作时 resolveAdaptiveStrategy 的节奏/反馈信号会让数字持续漂移。
    if (_layerRefreshTimer) {
        clearInterval(_layerRefreshTimer);
        _layerRefreshTimer = null;
    }
    game._spawnModelLayerRefresh = () => _refreshLayerParams(game);
    _refreshLayerParams(game);

    async function _refreshBadge() {
        try {
            const [trainSt, v3St] = await Promise.all([getModelStatus(), getV3Status()]);
            _updateUI({ ...trainSt, ...v3St, modelAvailable: !!v3St.baseAvailable });
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
            const personalizedCount = Array.isArray(st.personalizedUsers) ? st.personalizedUsers.length : 0;
            badge.textContent = personalizedCount > 0 ? `V3 可用 / 个性化 ${personalizedCount}` : 'V3 可用';
            badge.className = 'spawn-model-status available';
            if (btnStart) btnStart.disabled = false;
            if (btnStop) btnStop.disabled = true;
            if (st.phase === 'done') {
                if (progressWrap) progressWrap.hidden = false;
                if (progressFill) progressFill.style.width = '100%';
                if (progressMsg) progressMsg.textContent = st.message || '训练完成';
            }
        } else {
            badge.textContent = 'V3 未训练';
            badge.className = 'spawn-model-status';
            if (btnStart) btnStart.disabled = false;
            if (btnStop) btnStop.disabled = true;
        }

        const modelRadio = document.querySelector(`input[name="spawn-mode"][value="${SPAWN_MODE_MODEL_V3}"]`);
        if (modelRadio) {
            const label = modelRadio.closest('.spawn-mode-label');
            if (label) {
                label.style.opacity = st.modelAvailable ? '1' : '0.5';
            }
        }
    }

    function _startPolling() {
        if (_pollTimer) clearInterval(_pollTimer);
        _pollTimer = setInterval(
            skipWhenDocumentHidden(async () => {
                try {
                    const [trainSt, v3St] = await Promise.all([getModelStatus(), getV3Status()]);
                    const st = { ...trainSt, ...v3St, modelAvailable: !!v3St.baseAvailable };
                    _updateUI(st);
                    if (!st.trainingRunning) {
                        clearInterval(_pollTimer);
                        _pollTimer = null;
                        if (st.phase === 'done') {
                            try { await reloadV3Model(); } catch { /* ignore */ }
                            _refreshBadge();
                        }
                    }
                } catch {
                    clearInterval(_pollTimer);
                    _pollTimer = null;
                }
            }),
            3000
        );
    }
}
