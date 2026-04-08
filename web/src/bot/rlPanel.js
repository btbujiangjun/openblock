/**
 * 自博弈训练面板：启动/停止、胜率与得分统计；可选 PyTorch 后端（Flask /api/rl）
 */
import { LinearAgent } from './linearAgent.js';
import { trainSelfPlay, runSelfPlayEpisode, WIN_SCORE_THRESHOLD } from './trainer.js';
import { isRlPytorchBackendPreferred } from '../config.js';
import { fetchRlStatus, fetchTrainingLog } from './pytorchBackend.js';
import { updateRlTrainingCharts } from './rlTrainingCharts.js';

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
    const outBackendStatus = el('rl-backend-status');
    const outServerLog = el('rl-server-log');
    const btnRefreshLog = el('rl-refresh-server-log');
    const chartRoot = el('rl-chart-root');
    const chkChartAuto = el('rl-chart-auto');
    const selChartTail = el('rl-chart-tail');
    const btnRefreshCharts = el('rl-refresh-charts');
    let chartPollTimer = null;

    let agent = LinearAgent.load();
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
            void refreshTrainingCharts();
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
                outBackendStatus.textContent = `${st.device || '?'} · ${ck} · ${st.episodes ?? 0} 局 · 每${st.save_every ?? '?'}局存盘`;
            } else {
                outBackendStatus.textContent = st.reason ? `不可用：${st.reason}` : '不可用';
            }
        } catch {
            outBackendStatus.textContent = '无法连接 API';
        }
        void refreshServerTrainingLog();
    }

    function syncChartPoll() {
        if (chartPollTimer) {
            clearInterval(chartPollTimer);
            chartPollTimer = null;
        }
        if (chkChartAuto?.checked && running && readUseBackend()) {
            chartPollTimer = setInterval(() => void refreshTrainingCharts(), 5000);
        }
    }

    async function refreshTrainingCharts() {
        if (!chartRoot) {
            return;
        }
        try {
            const tail = Math.max(50, parseInt(String(selChartTail?.value || '800'), 10) || 800);
            const data = await fetchTrainingLog(tail);
            updateRlTrainingCharts(chartRoot, data.entries || []);
        } catch {
            chartRoot.replaceChildren();
            const p = document.createElement('p');
            p.className = 'rl-dash-empty';
            p.textContent = '无法加载曲线数据（请启动 Flask 并勾选 PyTorch 后端）';
            chartRoot.appendChild(p);
        }
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
            const rows = data.entries.slice(-14).map((e) => {
                const t = e.ts ? new Date(e.ts * 1000).toLocaleTimeString() : '?';
                if (e.event === 'train_episode') {
                    const lp = e.loss_policy != null && Number.isFinite(Number(e.loss_policy)) ? Number(e.loss_policy).toFixed(2) : '—';
                    const lv = e.loss_value != null && Number.isFinite(Number(e.loss_value)) ? Number(e.loss_value).toFixed(2) : '—';
                    return `[${t}]#${e.episodes}·Lπ${lp}·Lv${lv}`;
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
        return `·Lπ${lp.toFixed(3)}·Lv${lv.toFixed(3)}`;
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
        if (typeof info.serverEpisodes === 'number') {
            totalEpisodes = info.serverEpisodes;
        } else {
            // 线性模型每局 +1；后端若未带回局数则 +1 兜底，避免界面卡住
            totalEpisodes += 1;
        }
        recentScores.push(info.score);
        recentWins.push(info.won);
        if (info.score > bestScore) {
            bestScore = info.score;
        }
        const lossHint = formatLossSuffix(info);
        logLine(
            `上局·分${info.score}·步${info.steps}·消${info.clears}${info.won ? '·胜' : ''}${lossHint}`
        );
        updateStats();
        if (totalEpisodes % 10 === 0) {
            const n = Math.min(AVG_WINDOW, recentScores.length);
            const avg = n ? recentScores.slice(-AVG_WINDOW).reduce((a, b) => a + b, 0) / n : 0;
            logLine(`已${totalEpisodes}局·近${n}局均${avg.toFixed(0)}`);
        }
    }

    async function startBatch() {
        if (running) {
            return;
        }
        running = true;
        controller = new AbortController();
        const useBackend = readUseBackend();
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
                ? '开始·PyTorch后端·可随时停止'
                : '开始·浏览器线性模型·可随时停止'
        );

        if (useBackend) {
            syncChartPoll();
            void refreshTrainingCharts();
        }

        await trainSelfPlay({
            agent,
            episodes: 500000,
            signal: controller.signal,
            onEpisode,
            useBackend
        });

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
        logLine(useBackend ? '结束·服务端已存盘' : '结束·已写localStorage');
        syncChartPoll();
        void refreshBackendStatus();
        void refreshServerTrainingLog();
        void refreshTrainingCharts();
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
        btnRefreshCharts.onclick = () => void refreshTrainingCharts();
    }
    if (chkChartAuto) {
        chkChartAuto.addEventListener('change', () => syncChartPoll());
    }
    if (selChartTail) {
        selChartTail.addEventListener('change', () => void refreshTrainingCharts());
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
                    { useBackend }
                );
                logLine(
                    `评估·分${ep.score}·步${ep.steps}·消${ep.totalClears}${ep.won ? '·胜' : ''}·${ep.trajectory.length}手·${useBackend ? 'PT' : '线'}·不计入均分`
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
    void refreshTrainingCharts();
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
        `已加载${readUseBackend() ? '·PT后端' : '·线性'}·胜≥${WIN_SCORE_THRESHOLD}分`
    );
}
