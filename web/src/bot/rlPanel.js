/**
 * 自博弈训练面板：启动/停止、胜率与得分统计；可选 PyTorch 后端（Flask /api/rl）
 */
import {
    LinearAgent,
    setBrowserRlLinearPersistHook,
    isValidLinearAgentPayload,
    hasSavedLinearAgentInLocalStorage
} from './linearAgent.js';
import { trainSelfPlay, runSelfPlayEpisode, WIN_SCORE_THRESHOLD } from './trainer.js';
import { rlWinThresholdForEpisode } from './rlCurriculum.js';
import { isRlPytorchBackendPreferred, isSqliteClientDatabase } from '../config.js';
import { fetchRlStatus, fetchTrainingLog } from './pytorchBackend.js';
import { appendBrowserTrainEpisode, getBrowserTrainingLog } from './browserTrainingLog.js';
import { updateRlTrainingCharts } from './rlTrainingCharts.js';
import { skipWhenDocumentHidden } from '../lib/pageVisibility.js';

const WIN_WINDOW = 80;
const AVG_WINDOW = 40;
/** 「训练进展」预置行数上限（含上局、批量摘要等） */
const EPISODE_LOG_MAX_LINES = 80;
const VIZ_STEP_MS = 220;
const LS_RL_PYTORCH = 'rl_use_pytorch';

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/**
 * @param {import('../game.js').Game | null | undefined} game 用于「评估一局」时把自博弈同步到主盘面
 */
export function initRLPanel(game) {
    const panel = document.getElementById('rl-panel');
    if (!panel) {
        return;
    }

    const el = (id) => document.getElementById(id);
    const btnStart = el('rl-start');
    const btnStop = el('rl-stop');
    const btnEpisode = el('rl-one-episode');
    const outEp = el('rl-episodes');
    const outAvg = el('rl-avg-score');
    const outWin = el('rl-winrate');
    const outBest = el('rl-best');
    const chkPytorch = el('rl-use-pytorch');
    const chkLookahead = el('rl-lookahead');
    const outBackendStatus = el('rl-backend-status');
    const outServerLog = el('rl-server-log');
    const btnRefreshLog = el('rl-refresh-server-log');
    const chartRoot = el('rl-chart-root');
    const dashSummary = el('rl-dash-summary');
    const chkChartAuto = el('rl-chart-auto');
    const selChartTail = el('rl-chart-tail');
    const btnRefreshCharts = el('rl-refresh-charts');
    let chartPollTimer = null;
    /** 局结束后合并刷新看板曲线 + 服务端损失日志，避免每局多次请求 */
    let dashRefreshTimer = null;

    const needRlHydrate = Boolean(game?.db && isSqliteClientDatabase());
    if (needRlHydrate) {
        if (btnStart) {
            btnStart.disabled = true;
        }
        if (btnEpisode) {
            btnEpisode.disabled = true;
        }
    }

    let agent = LinearAgent.load();

    if (game?.db && isSqliteClientDatabase()) {
        setBrowserRlLinearPersistHook((payload) => {
            void game.db.putBrowserRlLinearAgent(payload).catch((err) => {
                console.warn('[RL] SQLite 同步失败', err);
            });
        });
    }

    let totalEpisodes = 0;
    const recentScores = [];
    const recentWins = [];
    let bestScore = 0;
    let controller = null;
    let running = false;
    let vizBusy = false;

    function readUseBackend() {
        if (chkPytorch) {
            return chkPytorch.checked;
        }
        return isRlPytorchBackendPreferred();
    }

    function persistPytorchToggle() {
        if (!chkPytorch) {
            return;
        }
        try {
            localStorage.setItem(LS_RL_PYTORCH, chkPytorch.checked ? '1' : '0');
        } catch {
            /* ignore */
        }
    }

    if (chkPytorch) {
        try {
            const v = localStorage.getItem(LS_RL_PYTORCH);
            if (v === '1' || (v === null && isRlPytorchBackendPreferred())) {
                chkPytorch.checked = true;
            }
        } catch {
            chkPytorch.checked = isRlPytorchBackendPreferred();
        }
        chkPytorch.addEventListener('change', () => {
            persistPytorchToggle();
            void refreshBackendStatus();
            void refreshDashboardFull();
        });
    }

    async function refreshBackendStatus() {
        if (!outBackendStatus) {
            return;
        }
        try {
            const st = await fetchRlStatus();
            if (st.available) {
                const ck = st.checkpoint_loaded ? '已热加载' : '新初始化';
                outBackendStatus.textContent = `${st.device || '?'} ${ck} ${st.episodes ?? 0} 局`;
                if (typeof st.episodes === 'number') {
                    totalEpisodes = Math.max(totalEpisodes, st.episodes);
                    updateStats();
                }
            } else {
                outBackendStatus.textContent = st.reason ? `不可用：${st.reason}` : '不可用';
            }
        } catch {
            outBackendStatus.textContent = '无法连接 API';
        }
        void refreshServerTrainingLog();
    }

    /** 与 Flask 全局局数对齐（训练/空闲均可调用，刷新看板时拉齐左侧「局数」） */
    async function syncEpisodesFromServer() {
        if (!readUseBackend()) {
            return;
        }
        try {
            const st = await fetchRlStatus();
            if (st.available && typeof st.episodes === 'number') {
                totalEpisodes = Math.max(totalEpisodes, st.episodes);
                updateStats();
            }
        } catch {
            /* ignore */
        }
    }

    function scheduleDashRefresh() {
        if (!chkChartAuto?.checked || !running) {
            return;
        }
        if (dashRefreshTimer != null) {
            clearTimeout(dashRefreshTimer);
        }
        dashRefreshTimer = setTimeout(() => {
            dashRefreshTimer = null;
            if (!chkChartAuto?.checked || !running) {
                return;
            }
            void refreshDashboardFull();
        }, 350);
    }

    function syncChartPoll() {
        if (chartPollTimer) {
            clearInterval(chartPollTimer);
            chartPollTimer = null;
        }
        if (dashRefreshTimer != null) {
            clearTimeout(dashRefreshTimer);
            dashRefreshTimer = null;
        }
        if (chkChartAuto?.checked && running) {
            const ms = readUseBackend() ? 1800 : 1200;
            chartPollTimer = setInterval(
                skipWhenDocumentHidden(() => {
                    if (!chkChartAuto?.checked || !running) {
                        return;
                    }
                    void refreshDashboardFull();
                }),
                ms
            );
        }
    }

    async function refreshTrainingCharts() {
        if (!chartRoot) {
            return;
        }
        const maxEpisodes = parseInt(String(selChartTail?.value || '0'), 10) || 0;
        const fetchLines = 5000;
        if (!readUseBackend()) {
            const data = getBrowserTrainingLog(fetchLines);
            updateRlTrainingCharts(chartRoot, data.entries || [], null, maxEpisodes, { path: data.path });
            return;
        }
        try {
            const data = await fetchTrainingLog(fetchLines);
            updateRlTrainingCharts(chartRoot, data.entries || [], null, maxEpisodes, { path: data.path });
        } catch {
            chartRoot.replaceChildren();
            const p = document.createElement('p');
            p.className = 'rl-dash-empty';
            p.textContent = '无法加载服务端曲线（请启动 Flask 并勾选 PyTorch 后端）';
            chartRoot.appendChild(p);
            if (dashSummary) {
                dashSummary.textContent = '运行状态：本次刷新未拉到服务端训练日志；请确认 Flask 后端可用，恢复后本卡片会随下一次刷新更新。';
            }
        }
    }

    /**
     * 训练看板完整刷新：曲线 + 摘要（updateRlTrainingCharts）；
     * 勾选 PyTorch 时顺带更新「训练损失」预读与左侧局数与服务端一致。
     */
    async function refreshDashboardFull() {
        await refreshTrainingCharts();
        if (!readUseBackend()) {
            return;
        }
        await refreshServerTrainingLog();
        await syncEpisodesFromServer();
    }

    async function refreshServerTrainingLog() {
        if (!outServerLog) {
            return;
        }
        try {
            const data = await fetchTrainingLog(60);
            if (data.exists === false || !data.entries?.length) {
                outServerLog.textContent =
                    data.exists === false
                        ? '尚无日志文件（启动 npm run server:rl 并训练后写入 training.jsonl）'
                        : '日志为空';
                return;
            }
            const tail = data.entries.slice(-24);
            const rows = [...tail].reverse().map((e) => {
                const t = e.ts ? new Date(e.ts * 1000).toLocaleTimeString() : '?';
                if (e.event === 'train_episode') {
                    const lp = e.loss_policy != null && Number.isFinite(Number(e.loss_policy)) ? Number(e.loss_policy).toFixed(2) : '—';
                    const lv = e.loss_value != null && Number.isFinite(Number(e.loss_value)) ? Number(e.loss_value).toFixed(2) : '—';
                    const batchTag = e.batch_size ? `×${e.batch_size}` : '';
                    const sc = typeof e.score === 'number' ? ` sc${Math.round(e.score)}` : '';
                    return `[${t}]#${e.episodes}${batchTag} Lπ${lp} Lv${lv}${sc}`;
                }
                if (e.event === 'checkpoint_saved') {
                    return `[${t}] 已保存 ${e.reason || ''} ep${e.episodes}`;
                }
                if (e.event === 'server_init') {
                    return `[${t}] 启动 ${e.device} 局数${e.episodes} ${e.checkpoint_loaded ? '热加载' : '新模型'}`;
                }
                if (e.event === 'load_api') {
                    return `[${t}] API 加载 ep${e.episodes}`;
                }
                return `[${t}] ${JSON.stringify(e).slice(0, 100)}`;
            });
            outServerLog.textContent = rows.join('\n');
            outServerLog.scrollTop = 0;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outServerLog.textContent = `无法拉取训练日志：${msg}`;
        }
    }

    /** 避免 loss 为字符串等类型时 .toFixed 抛错导致整段 onEpisode 中断、日志空白 */
    function formatLossSuffix(info) {
        if (!info) {
            return '';
        }
        const a = info.lossPolicy;
        const b = info.lossValue;
        if (a == null || b == null) {
            return '';
        }
        const lp = Number(a);
        const lv = Number(b);
        if (!Number.isFinite(lp) || !Number.isFinite(lv)) {
            return '';
        }
        return ` Lπ${lp.toFixed(3)} Lv${lv.toFixed(3)}`;
    }

    function logLine(msg) {
        const node = document.getElementById('rl-progress-log');
        if (!node) {
            return;
        }
        const t = new Date().toLocaleTimeString();
        const line = `[${t}] ${msg}`;
        const prev = node.textContent.split('\n').filter((s) => s.length > 0);
        node.textContent = [line, ...prev.slice(0, EPISODE_LOG_MAX_LINES - 1)].join('\n');
        node.scrollTop = 0;
    }

    function updateStats() {
        if (outEp) {
            outEp.textContent = String(totalEpisodes);
        }
        if (outAvg && recentScores.length) {
            const slice = recentScores.slice(-AVG_WINDOW);
            const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
            outAvg.textContent = avg.toFixed(1);
        } else if (outAvg) {
            outAvg.textContent = '—';
        }
        if (outWin && recentWins.length) {
            const slice = recentWins.slice(-WIN_WINDOW);
            const w = slice.filter(Boolean).length / slice.length;
            outWin.textContent = `${(w * 100).toFixed(1)}%`;
        } else if (outWin) {
            outWin.textContent = '—';
        }
        if (outBest) {
            outBest.textContent = String(bestScore);
        }
    }

    function onEpisode(info) {
        const prev = totalEpisodes;
        let next = prev + 1;
        if (typeof info.serverEpisodes === 'number' && Number.isFinite(info.serverEpisodes)) {
            next = Math.max(next, info.serverEpisodes);
        }
        totalEpisodes = next;
        if (!info.fromBackend && info.trainMetrics) {
            appendBrowserTrainEpisode({
                episodes: totalEpisodes,
                loss_policy: info.trainMetrics.lossPolicy,
                loss_value: info.trainMetrics.lossValue,
                entropy: info.trainMetrics.entropy,
                step_count: info.trainMetrics.stepCount,
                score: info.score,
                won: info.won === true
            });
        }
        recentScores.push(info.score);
        recentWins.push(info.won);
        if (info.score > bestScore) {
            bestScore = info.score;
        }
        const lossHint = formatLossSuffix(info);
        logLine(
            `上局 分${info.score} 步${info.steps} 消${info.clears}${info.won ? ' 胜' : ''}${lossHint}`
        );
        updateStats();
        if (totalEpisodes % 10 === 0) {
            const n = Math.min(AVG_WINDOW, recentScores.length);
            const avg = n ? recentScores.slice(-AVG_WINDOW).reduce((a, b) => a + b, 0) / n : 0;
            logLine(`已${totalEpisodes}局 近${n}局均${avg.toFixed(0)}`);
        }
        scheduleDashRefresh();
    }

    async function startBatch() {
        if (running) {
            return;
        }
        running = true;
        controller = new AbortController();
        const useBackend = readUseBackend();
        const useLookahead = Boolean(chkLookahead?.checked);
        if (btnStart) {
            btnStart.disabled = true;
        }
        if (btnEpisode) {
            btnEpisode.disabled = true;
        }
        if (btnStop) {
            btnStop.disabled = false;
        }
        logLine(
            useBackend
                ? '开始 PyTorch后端 可随时停止'
                : '开始 浏览器线性模型 可随时停止'
        );
        if (useBackend && useLookahead) {
            logLine('已开启 1-step lookahead（首局较慢）；不需要 Q 蒸馏时请取消勾选');
        }

        try {
            if (useBackend) {
                try {
                    const st = await fetchRlStatus();
                    if (st.available && typeof st.episodes === 'number') {
                        totalEpisodes = st.episodes;
                        updateStats();
                    }
                } catch {
                    /* ignore */
                }
            }

            syncChartPoll();
            try {
                await refreshDashboardFull();
            } catch (err) {
                console.warn('[RL panel] refreshDashboardFull:', err);
            }

            await trainSelfPlay({
                agent,
                episodes: 500000,
                signal: controller.signal,
                onEpisode,
                useBackend,
                useLookahead,
            });

            logLine(
                useBackend
                    ? '结束 服务端'
                    : (game?.db && isSqliteClientDatabase()
                        ? '结束 已写 localStorage + SQLite（按用户）'
                        : '结束 已写 localStorage')
            );
        } catch (err) {
            console.error('[RL panel] startBatch', err);
            const msg = err instanceof Error ? err.message : String(err);
            logLine(`训练异常退出：${msg}`);
        } finally {
            running = false;
            if (btnStart) {
                btnStart.disabled = false;
            }
            if (btnEpisode && !vizBusy) {
                btnEpisode.disabled = false;
            }
            if (btnStop) {
                btnStop.disabled = true;
            }
            syncChartPoll();
            void refreshBackendStatus();
            void refreshDashboardFull();
        }
    }

    if (btnStart) {
        btnStart.onclick = () => void startBatch();
    }
    if (btnStop) {
        btnStop.onclick = () => {
            controller?.abort();
            logLine('已请求停止…');
        };
    }
    if (btnRefreshLog) {
        btnRefreshLog.onclick = () => void refreshServerTrainingLog();
    }
    if (btnRefreshCharts) {
        /* 「刷新图表」始终可点：拉取最新 training.jsonl 重绘曲线/摘要，并同步服务端局数与损失预读。 */
        btnRefreshCharts.disabled = false;
        btnRefreshCharts.onclick = () => void refreshDashboardFull();
    }
    if (chkChartAuto) {
        chkChartAuto.addEventListener('change', () => syncChartPoll());
    }
    if (selChartTail) {
        selChartTail.addEventListener('change', () => void refreshDashboardFull());
    }
    if (btnEpisode) {
        btnEpisode.onclick = async () => {
            if (vizBusy || running) {
                return;
            }
            vizBusy = true;
            const useBackend = readUseBackend();
            if (btnEpisode) {
                btnEpisode.disabled = true;
            }
            try {
                if (game) {
                    game.setRLPreviewLocked(true);
                    game.hideScreens();
                }
                let winThr = rlWinThresholdForEpisode(totalEpisodes + 1);
                if (useBackend) {
                    try {
                        const st = await fetchRlStatus();
                        if (st.available && typeof st.episodes === 'number') {
                            winThr = rlWinThresholdForEpisode(st.episodes + 1);
                        }
                    } catch {
                        /* 保持 totalEpisodes+1 的门槛 */
                    }
                }
                const ep = await runSelfPlayEpisode(
                    useBackend ? null : agent,
                    0.85,
                    {
                        onEpisodeStart: async (sim) => {
                            if (game) {
                                game.syncFromSimulator(sim);
                            }
                            await sleep(VIZ_STEP_MS);
                        },
                        onAfterStep: async (sim) => {
                            if (game) {
                                game.syncFromSimulator(sim);
                            }
                            await sleep(VIZ_STEP_MS);
                        }
                    },
                    {
                        useBackend,
                        useLookahead: Boolean(chkLookahead?.checked),
                        winScoreThreshold: winThr,
                    }
                );
                logLine(
                    `评估 分${ep.score} 步${ep.steps} 消${ep.totalClears}${ep.won ? ' 胜' : ''} ${ep.trajectory.length}手 ${useBackend ? 'PT' : '线'} 不计入均分`
                );
            } finally {
                if (game) {
                    game.setRLPreviewLocked(false);
                }
                vizBusy = false;
                if (btnEpisode) {
                    btnEpisode.disabled = false;
                }
            }
        };
    }

    updateStats();
    void refreshBackendStatus();
    void refreshDashboardFull();
    void (async () => {
        try {
            const st = await fetchRlStatus();
            if (st.available && typeof st.episodes === 'number') {
                totalEpisodes = st.episodes;
                updateStats();
            }
        } catch {
            /* ignore */
        }
    })();
    logLine(
        `已加载${readUseBackend() ? ' PT后端' : ' 线性'} 胜≥${WIN_SCORE_THRESHOLD}分`
    );

    void (async () => {
        if (!needRlHydrate) {
            return;
        }
        try {
            const remote = await game.db.getBrowserRlLinearAgent();
            if (isValidLinearAgentPayload(remote)) {
                agent = LinearAgent.fromJSON(remote);
                agent.save();
                logLine('已从 SQLite 恢复本用户线性模型');
                return;
            }
            if (hasSavedLinearAgentInLocalStorage()) {
                const local = agent.toJSON();
                if (isValidLinearAgentPayload(local)) {
                    await game.db.putBrowserRlLinearAgent(local);
                    logLine('已将本地线性模型备份到 SQLite（本用户）');
                }
            }
        } catch (e) {
            console.warn('[RL] 从 SQLite 拉取/回填模型失败', e);
        } finally {
            if (btnStart && !running) {
                btnStart.disabled = false;
            }
            if (btnEpisode && !vizBusy) {
                btnEpisode.disabled = false;
            }
        }
    })();
}
