/**
 * Spawn Model Panel: 出块算法切换 + 模型训练入口
 *
 * 增量设计：独立模块，通过 initSpawnModelPanel(game) 挂载，
 * 不修改现有 game/adaptiveSpawn 核心逻辑。
 */

import {
    getSpawnPolicyMode,
    setSpawnPolicyMode,
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
import { getStatsV2 as getSpawnParamTunerStats } from './tuning/v2/clientPolicyV2.js';

/**
 * 刷新启发式 θ 来源 badge（详见 SPAWN_OVERVIEW.md §6 切换矩阵）：
 *   - 'rule'   = HandTuned       默认 θ / policies.json 未加载 / 灰度未命中
 *   - 'tuner'  = SpawnParamTuner policies.json 已加载且解析命中
 */
function _refreshPolicySourceBadge() {
    const el = document.getElementById('spawn-policy-source-badge');
    if (!el) return;
    let stats = null;
    try { stats = getSpawnParamTunerStats(); } catch { /* not loaded yet */ }
    const tunerActive = !!(stats?.loaded && stats?.count > 0);
    el.textContent = tunerActive ? '寻参' : '规则';
    el.className = tunerActive ? 'spawn-policy-source-badge tuner' : 'spawn-policy-source-badge';

    // v3.0.26: 展开 policies.meta.json 完整模型信息 (hover 即时看到当前生效模型详情)
    //   meta 字段: model_id / model_sha256 / generated_at_iso / n_contexts /
    //              average_curve_mae / build_mode / version / rollout_pct
    const m = stats?.meta || null;
    const modelLines = tunerActive
        ? [
            `  · 模型 ID：#${m?.model_id ?? '?'}${m?.build_mode === 'model-joint-trained-theta' ? '  · 联合训练 θ (v3.0.11+)' : ''}`,
            `  · 已加载策略：${stats.count} 条${m?.n_contexts != null ? ` / 全量 ${m.n_contexts}` : ''}`,
            `  · 灰度比例：rollout ${stats.rollout_pct}%`,
            `  · 模型 SHA：${(stats.model_sha || '').slice(0, 8)}…`,
            ...(m?.average_curve_mae != null ? [`  · 平均 d_curve MAE：${m.average_curve_mae.toFixed(4)}（越小越贴 ideal）`] : []),
            ...(m?.generated_at_iso ? [`  · 部署时间：${m.generated_at_iso}`] : []),
            ...(m?.version ? [`  · Bundle 版本：${m.version}`] : []),
            '  · 场景维度：difficulty × generator × bot × PB × lifecycle',
        ]
        : [];
    el.title = tunerActive
        ? [
            '🤖 寻参版 = L2 · SpawnParamTuner 模型已生效',
            '',
            '本模型不直接产 3 块，而是给启发式（L1 · SpawnPolicyRules）的 9 维 θ',
            '参数寻优，让启发式按你所在场景自动选最佳 θ：',
            ...modelLines,
            '',
            '— 模型架构（ResNet-MLP, L4 量级 ~325K 参数）—',
            '  输入 41 维 = ctx_embedding(32) ⊕ θ_normalized(9)',
            '    ctx_embedding = Embedding(diff:3→4) ⊕ (gen:2→4) ⊕ (bot:3→4)',
            '                  ⊕ (pb_bin:5→8) ⊕ (lifecycle:4→8) ⊕ proj(log_pb→4)',
            '  trunk_in : Linear(41→256) + LayerNorm + GELU',
            '  ResBlock × 8 : Linear(256→256)×2 + LayerNorm×2 + Dropout(0.1) + residual + GELU',
            '  5 输出头（接 CLS 256d）:',
            '    · head_curve     256→128→20  Sigmoid  ← 主：d_curve 20 bin 难度曲线',
            '    · head_pb        256→64→1    Sigmoid  ← 辅：pb_broke 概率',
            '    · head_noMove    256→64→1    Sigmoid  ← 辅：归一化 noMove_step',
            '    · head_score     256→64→1    Linear   ← 辅：log_score',
            '    · head_survival  256→64→1    Sigmoid  ← 辅：存活率',
            '',
            '— 训练（10 项加权损失, v2.9.1）—',
            '  L = 2.0·L_shape + 0.15·L_balance + 0.3·L_surprise + 0.5·L_breaking',
            '    + 0.04·L_smooth + 0.2·L_aux + 3.0·L_anchor + 2.5·L_monotonic',
            '    + 1.0·L_target_fit + 1.5·L_endpoint',
            '  优化器: AdamW (lr=1e-3, wd=1e-5) + CosineAnnealing + grad clip 1.0',
            '  90/10 train-val split + EarlyStopping(patience=10) on val_curve_mae',
            '',
            '— 部署管线（Phase C → 灰度）—',
            '  样本采集 → ResNet-MLP 训练 → Phase C 梯度上升搜 θ*（360 场景 × 8 起点 × 300 步）',
            '  → policies.json bundle (~235KB, 9 维 θ × 360 ctx) → shadow → 10% → 100% rollout',
            '',
            '⤳ 切换到「生成式」时，仅其中 4 个 PB 曲线参数会被 SpawnPolicyNet',
            '   的 target_difficulty 公式消费；其余 5 个个性化/选拔参数仅作用于规则轨。',
            '⤳ 详见 docs/algorithms/SPAWN_TUNING_V2.md',
        ].join('\n')
        : [
            '📐 规则版 = HandTuned 默认参数',
            '',
            'L2 · SpawnParamTuner 模型当前未生效（policies.json 未加载 / 灰度未命中 /',
            '加载失败），启发式（L1 · SpawnPolicyRules）使用 shared/game_rules.json',
            '与 DEFAULT_SPAWN_PARAMS_PB_CURVE 的默认 9 维 θ 跑全场景。',
            '',
            '— SpawnParamTuner 模型架构（未生效时仍可参考）—',
            '  ResNet-MLP (L4, ~325K 参数)：',
            '    输入 41 维 (32 ctx_embedding + 9 θ_normalized)',
            '    trunk Linear(41→256) + 8×ResBlock(256→256) + 5 输出头',
            '  主头 head_curve 预测 20 bin d_curve；4 个辅助头',
            '  10 项加权损失（L_shape/L_balance/L_surprise/L_breaking 等）',
            '',
            '⤳ 要切换到「寻参」：在 spawn-tuning-v2 看板点 D.1 导出 Bundle，',
            '   硬刷新（Cmd/Ctrl+Shift+R）游戏页后 badge 会自动翻为「寻参」。',
            '⤳ 详见 docs/algorithms/SPAWN_TUNING_V2.md',
        ].join('\n');
}

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
    /* v1.60.1：spawn 模型面板走"玩家失误评估"口径 */
    const liveTopo = game.grid ? analyzeBoardTopology(game.grid, { skipSpecialCells: true }) : null;

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
    const source = game._lastAdaptiveInsight?.spawnSource ?? getSpawnPolicyMode();
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

    // ── 启发式 θ 来源 badge ────────────────────────────────────────────────
    // policies.json 异步加载完成后才有 stats，跟随主刷新节奏同步更新最稳。
    _refreshPolicySourceBadge();
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

    const currentMode = getSpawnPolicyMode();
    radios.forEach((r) => {
        if (r.value === currentMode) r.checked = true;
    });

    // 初始化时立即刷新一次 θ 来源 badge。
    _refreshPolicySourceBadge();
    // spawnModelPanel 是延迟加载模块（initDeferredPanels 异步），install 事件
    // 可能在本面板挂载之前已 dispatch，listener 会漏掉。所以同时用两种机制：
    //   (1) 订阅 install 事件——install 晚于本面板时即时刷新；
    //   (2) 延迟轮询兜底——install 早于本面板时由轮询补上。
    // 详见 web/src/tuning/v2/clientPolicyV2.js · installPoliciesV2 末尾的 dispatch。
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('openblock:spawn-param-tuner-installed', _refreshPolicySourceBadge);
        // v3.0.26: meta-updated 事件 — meta.json 拉到/变化时刷新 tooltip 完整模型信息
        window.addEventListener('openblock:spawn-param-tuner-meta-updated', _refreshPolicySourceBadge);
    }
    // 兜底：bundle fetch 通常 < 1s，500ms / 2000ms 两次轮询基本覆盖所有时序。
    setTimeout(_refreshPolicySourceBadge, 500);
    setTimeout(_refreshPolicySourceBadge, 2000);

    radios.forEach((r) => {
        r.addEventListener('change', () => {
            if (r.checked) {
                setSpawnPolicyMode(r.value);
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
                    badge.title = res.baseAvailable
                        ? '🔁 L1 · SpawnPolicyNet 已从磁盘热重载最新权重（无需刷新页面即可在「生成式」模式生效）。'
                        : '⚠️ 磁盘上无 SpawnPolicyNet 权重文件，请先「开始训练」。';
                }
            } catch {
                if (badge) {
                    badge.textContent = '加载失败';
                    badge.className = 'spawn-model-status';
                    badge.title = '❌ L1 · SpawnPolicyNet 权重重载失败（服务端异常或权重文件损坏），可重试或重新训练。';
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
                badge.title = [
                    '🔌 模型训练 / 推理后端 (Flask) 不可达',
                    '',
                    'L1 · SpawnPolicyNet 的训练与推理依赖 server.py（/api/spawn-model/*）。',
                    '当前后端无响应——可能未启动、网络阻塞或 CORS 失败。',
                    '',
                    '⤳ 不影响「启发式」运行；「生成式」在此状态下也会自动回退到启发式。',
                    '⤳ 启动后端：python server.py 或 npm run server',
                ].join('\n');
            }
        }
    }

    function _updateUI(st) {
        if (!badge) return;

        if (st.trainingRunning) {
            badge.textContent = `训练中 ${st.progress ?? 0}%`;
            badge.className = 'spawn-model-status training';
            badge.title = [
                '⏳ L1 · SpawnPolicyNet 正在训练',
                '',
                '神经版出块决策模型（Transformer V3.1）正在用 SQLite 历史对局训练：',
                `  · 进度：${st.progress ?? 0}%`,
                st.message ? `  · 阶段：${st.message}` : '',
                '',
                '训练完成后会自动 reload，「V3 可用」徽章会亮起，可在「生成式」模式启用。',
            ].filter(Boolean).join('\n');
            if (btnStart) btnStart.disabled = true;
            if (btnStop) btnStop.disabled = false;
            if (progressWrap) progressWrap.hidden = false;
            if (progressFill) progressFill.style.width = `${st.progress ?? 0}%`;
            if (progressMsg) progressMsg.textContent = st.message || '';
        } else if (st.modelAvailable) {
            const personalizedCount = Array.isArray(st.personalizedUsers) ? st.personalizedUsers.length : 0;
            badge.textContent = personalizedCount > 0 ? `V3 可用 / 个性化 ${personalizedCount}` : 'V3 可用';
            badge.className = 'spawn-model-status available';
            badge.title = [
                '✨ V3 可用 = L1 · SpawnPolicyNet 模型已加载',
                '',
                '神经版出块决策模型（Transformer V3.1, ~317K 参数）已准备就绪。',
                '切换到「生成式」时，下一轮起本模型按盘面 + 56 维行为上下文 + 历史 3 轮',
                '条件分布 P(s₁,s₂,s₃|…) 直接产 3 块；前端护栏失败或服务不可用时自动',
                '回退到启发式（SpawnPolicyRules）。',
                '',
                personalizedCount > 0
                    ? `  · 已为 ${personalizedCount} 位玩家训练 LoRA 个性化权重`
                    : '  · 当前所有玩家使用通用权重（可在训练面板按玩家训练 LoRA）',
                '',
                '⤳ 与「启发式」的「寻参/规则」badge 完全独立：',
                '   前者决定「谁产 3 块」（L1 决策模型），',
                '   后者决定「启发式吃哪套 θ」（L2 参数寻优器）。',
            ].join('\n');
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
            badge.title = [
                '⚪ V3 未训练 = L1 · SpawnPolicyNet 模型不可用',
                '',
                '神经版出块决策模型（Transformer V3.1）尚未训练或权重缺失，',
                '「生成式」radio 会半透明禁用。',
                '',
                '⤳ 点「开始训练」用 SQLite 历史对局训练；训练完成后切换到「生成式」即可启用。',
                '⤳ 与「启发式」当前的 θ 来源 badge 无关——即使 V3 未训练，',
                '   启发式仍可正常运行（用规则版或寻参版 θ）。',
            ].join('\n');
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
