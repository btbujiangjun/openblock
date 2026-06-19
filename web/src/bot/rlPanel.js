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
import {
    fetchRlStatus,
    fetchTrainingLog,
    startBackgroundTraining,
    stopBackgroundTraining,
    fetchBackgroundTrainingStatus,
} from './pytorchBackend.js';
import { appendBrowserTrainEpisode, getBrowserTrainingLog } from './browserTrainingLog.js';
import { updateRlTrainingCharts } from './rlTrainingCharts.js';
import { skipWhenDocumentHidden } from '../lib/pageVisibility.js';
import { createLogger } from '../lib/logger.js';
const log = createLogger('rlPanel');


const WIN_WINDOW = 80;
const AVG_WINDOW = 40;
/** 「训练进展」预置行数上限（含上局、批量摘要等） */
const EPISODE_LOG_MAX_LINES = 80;
const VIZ_STEP_MS = 220;
const LS_RL_PYTORCH = 'rl_use_pytorch';
/** v1.33: RL 面板收起态持久化键（与 index.html 中 inline 防闪烁脚本严格一致）。 */
const LS_RL_COLLAPSED = 'openblock_rl_panel_collapsed_v1';

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** Web 看板后台训练 batch：小 batch 更快出现首条 loss（balanced+MCTS 单局很慢）。 */
const WEB_DASHBOARD_TRAIN_BATCH = 4;

function resolveBackgroundWorkerCount(preset) {
    const rawCores = Number(
        typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0
    );
    const cores = Number.isFinite(rawCores) && rawCores > 0 ? Math.floor(rawCores) : 4;
    // 训练子进程现在把每个 worker 固定为单线程（见 train.py `_pool_worker_init`），
    // 因此 worker 数应贴近「可用核数」才能跑满 CPU；预留 2 核给主进程 GPU 更新 + 系统。
    const usable = Math.max(1, cores - (cores >= 8 ? 2 : 1));
    // quality 单局最重（MCTS sims 多 + 大 beam），略少 worker 控制内存与单局延迟
    if (preset === 'quality') {
        return Math.max(1, Math.min(usable, 6));
    }
    // balanced / performance：单线程 worker 各占 ~1 核，直接吃满可用核
    return Math.max(1, Math.min(usable, 8));
}

/**
 * 从 training.jsonl 推导当前批采集进度（bg_training_start 至下一 train_episode 之间）。
 * @param {object[]} entries
 */
function computeBatchCollectProgress(entries) {
    if (!entries?.length) {
        return null;
    }
    const lastBg = [...entries].reverse().find((e) => e.event === 'bg_training_start');
    if (!lastBg) {
        return null;
    }
    const batchSize = Number(lastBg.batch_episodes) || WEB_DASHBOARD_TRAIN_BATCH;
    const startTs = lastBg.ts || 0;
    const since = entries.filter((e) => (e.ts || 0) >= startTs);
    const lastTeInRun = [...since].reverse().find((e) => e.event === 'train_episode');
    const floorEp = typeof lastTeInRun?.episodes === 'number' ? lastTeInRun.episodes : 0;
    const prog = since.filter(
        (e) => e.event === 'train_progress'
            && typeof e.episodes === 'number'
            && e.episodes > floorEp
    );
    const epSet = new Set(prog.map((e) => e.episodes));
    const collected = epSet.size;
    if (collected >= batchSize) {
        return null;
    }
    const hasNewLoss = since.some(
        (e) => e.event === 'train_episode'
            && typeof e.episodes === 'number'
            && e.episodes > floorEp
            && e.loss_policy != null
    );
    if (hasNewLoss) {
        return null;
    }
    return {
        collected,
        batchSize,
        mcts: Number(lastBg.mcts_sims) || 0,
        preset: lastBg.preset || '',
    };
}

function shortCheckpointLabel(path) {
    if (!path || typeof path !== 'string') {
        return null;
    }
    const slash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return slash >= 0 ? path.slice(slash + 1) : path;
}

/** @param {Awaited<ReturnType<import('./pytorchBackend.js')['fetchRlStatus']>>} st */
function formatDeepModelStatusLine(st) {
    if (!st?.available) {
        return `PyTorch 深度模型不可用：${st?.reason || '无法连接训练服务端'}`;
    }
    const arch = st.meta?.arch || 'conv-shared';
    const ckPath = st.checkpoint_loaded || st.save_path;
    const ckLabel = ckPath
        ? `checkpoint ${shortCheckpointLabel(String(ckPath))}`
        : '新初始化（无 checkpoint）';
    const ep = typeof st.episodes === 'number' ? st.episodes : 0;
    const dev = st.device || '?';
    const preset = st.training_preset ? ` · 预设 ${st.training_preset}` : '';
    const bg = st.bg_training?.running ? ' · 后台训练中' : '';
    return `PyTorch 深度模型 · ${arch} · ${dev} · ${ckLabel} · 累计 ${ep} 局${preset}${bg}`;
}

function formatLinearModelStatusLine(source) {
    const winHint = `胜≥${WIN_SCORE_THRESHOLD}分`;
    if (source === 'sqlite') {
        return `浏览器线性模型 · 已从 SQLite 恢复（本用户）· ${winHint}`;
    }
    if (source === 'local-backup') {
        return `浏览器线性模型 · 已备份至 SQLite（本用户）· ${winHint}`;
    }
    if (source === 'localStorage') {
        return `浏览器线性模型 · 已从 localStorage 加载 · ${winHint}`;
    }
    return `浏览器线性模型 · 新初始化 · ${winHint}`;
}

/**
 * v1.33: RL 面板收起 / 展开控制 ——
 *   - 收起：把 .rl-collapsed 类挂到 <html>（与 index.html `<head>` 中的防闪烁脚本同根），
 *     CSS 端把 .rl-panel 收到 36px 细栏，#app 右内边距随之收到 52px；
 *     --cell-px-width-reserve / --cell-px-height-reserve / --cell-px-max 同步切换，
 *     盘面与候选区会按新的横纵上限自动放大。
 *   - 展开：移除 class，恢复 clamp(120px,…,360px) 宽度。
 *   - 状态写入 localStorage[LS_RL_COLLAPSED]，下次刷新由 inline 脚本提前打类避免闪烁。
 *   - 触发一次 'resize' 让 ResizeObserver / cell-px clamp 重算 + dock 重渲染。
 *
 * 设计原则：纯 DOM/CSS 切换，不影响 RL 训练逻辑、不读取游戏内部状态；任何模块都
 * 可独立调用 setRlPanelCollapsed(true) 强制收起（如未来「全屏游戏」模式入口）。
 *
 * @param {boolean} collapsed true=收起，false=展开
 * @param {{ persist?: boolean }} [opts] persist 为 false 时只切 UI 不写 localStorage
 */
function setRlPanelCollapsed(collapsed, { persist = true } = {}) {
    const root = document.documentElement;
    if (!root) return;
    root.classList.toggle('rl-collapsed', collapsed);
    if (persist) {
        try {
            localStorage.setItem(LS_RL_COLLAPSED, collapsed ? '1' : '0');
        } catch { /* storage 满 / 隐私模式：忽略 */ }
    }
    /* 同步 ARIA：收起/展开按钮（含竖排「展开」文字）的 aria-expanded 反映面板是否展开 */
    const collapseBtn = document.getElementById('rl-collapse-btn');
    const expandBtn = document.getElementById('rl-expand-btn');
    const expandLabel = document.getElementById('rl-expand-label');
    const expanded = collapsed ? 'false' : 'true';
    if (collapseBtn) collapseBtn.setAttribute('aria-expanded', expanded);
    if (expandBtn) expandBtn.setAttribute('aria-expanded', expanded);
    if (expandLabel) expandLabel.setAttribute('aria-expanded', expanded);
    /* 触发布局重算：游戏盘面 ResizeObserver 监听 canvas CSS 宽度，--cell-px 变化时
     * dock 会自动 refreshDockSkin。dispatch 'resize' 是兜底，确保任何 window 级监听都能感知。 */
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event('resize'));
    }
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
    const selPreset = el('rl-training-preset');
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

    /* --- 训练档位切换 --- */
    if (selPreset) {
        const LS_PRESET = 'rl_training_preset';
        const saved = localStorage.getItem(LS_PRESET);
        if (saved && selPreset.querySelector(`option[value="${saved}"]`)) {
            selPreset.value = saved;
        }
        async function syncTrainingPresetToServer(preset) {
            try {
                const res = await fetch('/api/rl/training_preset', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ preset }),
                });
                return res.ok;
            } catch {
                return false;
            }
        }
        selPreset.addEventListener('change', async () => {
            const v = selPreset.value;
            try { localStorage.setItem(LS_PRESET, v); } catch { /* */ }
            await syncTrainingPresetToServer(v);
        });
        /* 初始对齐：先 GET 服务端 active，仅与下拉不一致时才 POST（避免每次刷新刷日志） */
        void (async () => {
            try {
                const res = await fetch('/api/rl/training_preset');
                if (!res.ok) {
                    return;
                }
                const data = await res.json();
                const serverActive = data.active;
                const uiChoice = selPreset.value;
                if (serverActive && selPreset.querySelector(`option[value="${serverActive}"]`)) {
                    if (!saved) {
                        selPreset.value = serverActive;
                    }
                }
                const toSync = selPreset.value;
                if (toSync !== serverActive) {
                    await syncTrainingPresetToServer(toSync);
                }
            } catch { /* offline / no backend */ }
        })();
    }

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
    /** 线性模型来源，供日志按实际运行模型展示（PyTorch 模式下不写入进展日志）。 */
    let linearModelSource = hasSavedLinearAgentInLocalStorage() ? 'localStorage' : 'default';

    if (game?.db && isSqliteClientDatabase()) {
        setBrowserRlLinearPersistHook((payload) => {
            void game.db.putBrowserRlLinearAgent(payload).catch((err) => {
                log.warn('[RL] SQLite 同步失败', err);
            });
        });
    }

    let totalEpisodes = 0;
    const recentScores = [];
    const recentWins = [];
    let bestScore = 0;
    // 后端/看板模式下，顶部统计（均分/胜率/最佳）改由服务端日志推导填充；
    // 浏览器训练时仍优先用本机 recentScores/recentWins/bestScore。
    let serverStats = { avg: null, win: null, best: null };
    // 「最佳」需单调（历史最高单局分）。serverStats.best 只取日志窗口内最大值，高分批次
    // 滚出窗口后会缩水，故用会话级累加器保持单调。
    let serverBestEver = 0;
    // 顶部状态栏元信息缓存：使头部局数与统计行「局数」共用同一个 totalEpisodes，
    // 每次 updateStats 同步重渲染，避免两处局数因刷新时机不同而不一致。
    let backendHeaderMeta = null;
    // 「训练进展」面板内容拆为两段：上方事件消息（logLine 写入，启动/停止/异常等），
    // 下方实时采集进度（refreshServerTrainingLog 从 train_progress 逐局心跳生成）。
    // 两者合并渲染，使该面板在稳定训练时也每 ~1-2s 滚动更新（修复「进展没及时返回」）。
    const eventLogLines = [];
    let progressFeedLines = [];
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
            void logActiveModelStatus();
        });
    }

    /** 训练进展日志：按当前实际使用的模型（PyTorch 深度 / 浏览器线性）输出一行摘要。 */
    async function logActiveModelStatus() {
        if (readUseBackend()) {
            try {
                const st = await fetchRlStatus();
                logLine(formatDeepModelStatusLine(st));
            } catch {
                logLine('PyTorch 深度模型：无法连接训练服务端');
            }
            return;
        }
        logLine(formatLinearModelStatusLine(linearModelSource));
    }

    async function refreshBackendStatus() {
        if (!outBackendStatus) {
            return;
        }
        try {
            const st = await fetchRlStatus();
            if (st.available) {
                const ck = st.checkpoint_loaded ? '已热加载' : '新初始化';
                const bgTag = st.bg_training?.running ? ' ▶训练中' : '';
                // 显示实时局数：内存 episodes 停在 checkpoint，后台训练取 bg_training.episodes_done
                const liveEp = st.bg_training?.episodes_done;
                const shownEp = Math.max(
                    typeof st.episodes === 'number' ? st.episodes : 0,
                    typeof liveEp === 'number' && Number.isFinite(liveEp) ? liveEp : 0
                );
                if (shownEp > 0) {
                    totalEpisodes = Math.max(totalEpisodes, shownEp);
                }
                // 缓存元信息，头部局数统一改由 renderBackendHeader 读 totalEpisodes 渲染，
                // 与统计行「局数」共用同一数值并随每次 updateStats 同步刷新。
                backendHeaderMeta = { available: true, device: st.device || '?', ck, bgTag };
                renderBackendHeader();
                updateStats();
                // 页面刚打开时如果后台训练在跑，自动恢复"训练中"UI
                if (st.bg_training?.running && !running && readUseBackend()) {
                    void _resumeBgTrainingPoll();
                }
            } else {
                backendHeaderMeta = { available: false, reason: st.reason };
                renderBackendHeader();
            }
        } catch {
            backendHeaderMeta = { available: false, error: true };
            renderBackendHeader();
        }
        void refreshServerTrainingLog();
    }

    /** 统一渲染顶部状态栏：局数始终取全局单调的 totalEpisodes，与统计行「局数」保持一致。 */
    function renderBackendHeader() {
        if (!outBackendStatus || !backendHeaderMeta) {
            return;
        }
        const m = backendHeaderMeta;
        if (m.error) {
            outBackendStatus.textContent = '无法连接 API';
        } else if (!m.available) {
            outBackendStatus.textContent = m.reason ? `不可用：${m.reason}` : '不可用';
        } else {
            outBackendStatus.textContent = `${m.device} ${m.ck} ${totalEpisodes} 局${m.bgTag}`;
        }
    }

    /** 与 Flask 全局局数对齐（训练/空闲均可调用，刷新看板时拉齐左侧「局数」） */
    async function syncEpisodesFromServer() {
        if (!readUseBackend()) {
            return;
        }
        try {
            const st = await fetchRlStatus();
            if (st.available) {
                // 内存 episodes 停在 checkpoint；后台训练实时局数取 bg_training.episodes_done
                const liveEp = st.bg_training?.episodes_done;
                if (typeof st.episodes === 'number') {
                    totalEpisodes = Math.max(totalEpisodes, st.episodes);
                }
                if (typeof liveEp === 'number' && Number.isFinite(liveEp)) {
                    totalEpisodes = Math.max(totalEpisodes, liveEp);
                }
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
            if (!chartRoot.querySelector('.rl-chart-panel')) {
                chartRoot.replaceChildren();
                const p = document.createElement('p');
                p.className = 'rl-dash-empty';
                p.textContent = '无法加载服务端曲线（请启动 Flask 并勾选 PyTorch 后端）';
                chartRoot.appendChild(p);
            }
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
            // 拉取 400 条：train_progress 进度心跳会高频写入，需更大窗口才能保留足够的
            // train_episode 行用于统计与曲线（约 1:batch 比例）。
            const data = await fetchTrainingLog(400);
            if (data.exists === false || !data.entries?.length) {
                outServerLog.textContent =
                    data.exists === false
                        ? '尚无日志文件（启动 npm run server:rl 并训练后写入 training.jsonl）'
                        : '日志为空';
                return;
            }
            // 局数实时跳动：取最新带 episodes 的任意事件（含 train_progress 采集心跳），
            // 让顶部局数每 ~1-2s 推进，直观判断训练是否在继续。
            for (let i = data.entries.length - 1; i >= 0; i--) {
                const ev = data.entries[i].episodes;
                if (typeof ev === 'number' && Number.isFinite(ev)) {
                    totalEpisodes = Math.max(totalEpisodes, ev);
                    break;
                }
            }
            // 从服务端日志推导顶部统计（均分/胜率/最佳），供后端模式填充
            const epRows = data.entries.filter((e) => e.event === 'train_episode');
            if (epRows.length) {
                // 实时局数：Flask /api/rl/status 的 episodes 是内存加载值（停在 checkpoint），
                // 后台训练推进的是磁盘日志，需用最新 train_episode 的 episodes 同步左侧「局数」。
                const lastEp = epRows[epRows.length - 1].episodes;
                if (typeof lastEp === 'number' && Number.isFinite(lastEp)) {
                    totalEpisodes = Math.max(totalEpisodes, lastEp);
                }
                const scoreSlice = epRows.slice(-AVG_WINDOW).map((e) => e.score).filter((v) => typeof v === 'number' && Number.isFinite(v));
                const winSlice = epRows.slice(-WIN_WINDOW)
                    .map((e) => (typeof e.win_rate === 'number' ? e.win_rate : typeof e.won === 'boolean' ? (e.won ? 1 : 0) : null))
                    .filter((v) => v != null);
                // 「最佳」取历史最高单局分：窗口内 train_episode 与逐局 train_progress 的最大值，
                // 再与会话累加器取 max 保持单调（高分滚出窗口也不缩水）。
                const epScores = epRows.map((e) => e.score).filter((v) => typeof v === 'number' && Number.isFinite(v));
                const progScores = data.entries
                    .filter((e) => e.event === 'train_progress')
                    .map((e) => e.score)
                    .filter((v) => typeof v === 'number' && Number.isFinite(v));
                const windowBest = Math.max(0, ...epScores, ...progScores);
                serverBestEver = Math.max(serverBestEver, windowBest);
                serverStats = {
                    avg: scoreSlice.length ? scoreSlice.reduce((a, b) => a + b, 0) / scoreSlice.length : null,
                    win: winSlice.length ? winSlice.reduce((a, b) => a + b, 0) / winSlice.length : null,
                    best: serverBestEver > 0 ? serverBestEver : null,
                };
                updateStats();
            }
            // 采集进度心跳 → 「训练进展」面板（实时滚动，每 ~1-2s 一条）
            const progRows = data.entries.filter((e) => e.event === 'train_progress');
            progressFeedLines = [...progRows].slice(-16).reverse().map((e) => {
                const t = e.ts ? formatLogTime(e.ts) : '?';
                const ep = e.episodes ?? '?';
                const sc = typeof e.score === 'number' ? Math.round(e.score) : '?';
                const stp = typeof e.steps === 'number' ? e.steps : '?';
                return `${t}·${ep} 采集 分${sc} 步${stp}${e.won ? ' 胜' : ''}`;
            });
            const batchProg = computeBatchCollectProgress(data.entries);
            if (batchProg) {
                const mctsTag = batchProg.mcts ? ` MCTS×${batchProg.mcts}` : '';
                progressFeedLines.unshift(
                    `▶ 本批采集 ${batchProg.collected}/${batchProg.batchSize} 局${mctsTag}（攒满后 GPU 更新并显示 loss）`
                );
            }
            renderProgressPanel();
            // 「训练损失」面板：仅保留真正的 loss 行（train_episode）与结构性事件，
            // 排除采集进度心跳，避免 loss 数据被刷屏（修复「训练损失数据不对」）。
            const tail = data.entries.filter((e) => e.event !== 'train_progress').slice(-24);
            const rows = [...tail].reverse().map((e) => {
                const t = e.ts ? formatLogTime(e.ts) : '?';
                if (e.event === 'train_episode') {
                    const ep = e.episodes ?? '?';
                    const batch = e.batch_size ? `×${e.batch_size}` : '';
                    const win = typeof e.win_rate === 'number' ? `胜${(e.win_rate * 100).toFixed(0)}%` : '';
                    const extras = [
                        e.loss_topology_aux != null ? `拓${formatLogNumber(e.loss_topology_aux, 2, true)}` : '',
                        e.loss_hole_aux != null ? `洞${formatLogNumber(e.loss_hole_aux, 2, true)}` : '',
                        e.loss_clear_pred != null ? `清${formatLogNumber(e.loss_clear_pred, 2, true)}` : '',
                    ].filter(Boolean).join('');
                    return `${t}#${ep}${batch} π${formatLogNumber(e.loss_policy, 2, true)}/V${formatLogNumber(e.loss_value, 1)} ${extras}${win}`;
                }
                if (e.event === 'checkpoint_saved') {
                    return `[${t}] 已保存检查点：${e.reason || '周期保存'}，当前第 ${e.episodes ?? '?'} 局`;
                }
                if (e.event === 'server_init') {
                    return `[${t}] 后端启动：设备 ${e.device || '?'}，累计 ${e.episodes ?? 0} 局，${e.checkpoint_loaded ? '已热加载模型' : '使用新模型'}`;
                }
                if (e.event === 'load_api') {
                    return `[${t}] API 加载模型：当前第 ${e.episodes ?? '?'} 局`;
                }
                if (e.event === 'preset_changed') {
                    return `[${t}] 切换预设 → ${e.label || e.preset || '?'}`;
                }
                if (e.event === 'eval_greedy') {
                    const wr = typeof e.win_rate === 'number' ? `胜率${(e.win_rate * 100).toFixed(0)}%` : '';
                    return `[${t}] 评估：${e.games ?? '?'} 局 ${wr}`;
                }
                if (e.event === 'bg_training_start') {
                    const sims = e.mcts_sims ? ` MCTS×${e.mcts_sims}` : '';
                    return `[${t}] 后台训练启动：目标 ${e.episodes_target ?? '?'} 局 batch=${e.batch_episodes ?? '?'} workers=${e.n_workers ?? 'auto'}${sims}`;
                }
                if (e.event === 'batch_collect_start') {
                    return `[${t}] 开始采集 batch ${e.episodes_from ?? '?'}-${e.episodes_to ?? '?'}（${e.batch_size ?? '?'} 局）`;
                }
                if (e.event === 'bg_training_end') {
                    const reason = e.reason === 'completed' ? '已完成' : e.reason === 'stopped' ? '已停止' : `退出(${e.exit_code ?? '?'})`;
                    return `[${t}] 后台训练结束：${reason}`;
                }
                if (e.event === 'bg_training_error') {
                    return `[${t}] 后台训练异常：${e.error || '未知错误'}`;
                }
                return `[${t}] ${JSON.stringify(e).slice(0, 100)}`;
            });
            const hasLoss = tail.some((e) => e.event === 'train_episode' && e.loss_policy != null);
            if (batchProg) {
                const mctsHint = batchProg.mcts ? `（MCTS×${batchProg.mcts}，单局较慢）` : '';
                rows.unshift(
                    `⏳ 本批采集 ${batchProg.collected}/${batchProg.batchSize} 局${mctsHint}，攒满后 GPU 更新并显示 loss…`
                );
            } else if (!hasLoss && tail.length > 0) {
                rows.unshift('⏳ 批量训练攒批中，loss 将在攒满一批后显示…');
            }
            outServerLog.textContent = rows.join('\n');
            outServerLog.scrollTop = 0;
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            outServerLog.textContent = `无法拉取训练日志：${msg}`;
        }
    }

    function formatLogNumber(value, digits = 2, trimLeadingZero = false) {
        const n = Number(value);
        if (!Number.isFinite(n)) {
            return '—';
        }
        const text = n.toFixed(digits);
        return trimLeadingZero ? text.replace(/^(-?)0\./, '$1.') : text;
    }

    function formatLogTime(tsSeconds) {
        return new Date(tsSeconds * 1000).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    /** 避免 loss 为字符串等类型时 .toFixed 抛错导致整段 onEpisode 中断、日志空白 */
    function formatLossSuffix(info) {
        if (!info) {
            return '';
        }
        const a = info.lossPolicy;
        const b = info.lossValue;
        if (a == null || b == null) {
            if (info.buffered) {
                return `｜攒批中(${info.bufferSize ?? '?'}/${info.batchThreshold ?? '?'})`;
            }
            return '';
        }
        const lp = Number(a);
        const lv = Number(b);
        if (!Number.isFinite(lp) || !Number.isFinite(lv)) {
            return '';
        }
        return `｜策略损失 ${lp.toFixed(3)}｜价值损失 ${lv.toFixed(3)}`;
    }

    /** 合并渲染「训练进展」面板：上方保留近期事件消息，下方接实时采集进度心跳。 */
    function renderProgressPanel() {
        const node = document.getElementById('rl-progress-log');
        if (!node) {
            return;
        }
        const events = eventLogLines.slice(0, 6);
        const feed = progressFeedLines.slice(0, EPISODE_LOG_MAX_LINES - events.length);
        const lines = [...events, ...feed];
        node.textContent = lines.length ? lines.join('\n') : '等待训练数据…';
        node.scrollTop = 0;
    }

    function logLine(msg) {
        const t = new Date().toLocaleTimeString();
        eventLogLines.unshift(`[${t}] ${msg}`);
        if (eventLogLines.length > 12) {
            eventLogLines.length = 12;
        }
        renderProgressPanel();
    }

    /**
     * 训练指标自适应折叠：
     *
     * 当 .rl-panel 总可视高度 - 其它块（header/统计/进展/损失/摘要 summary 等）已占高度
     * 不足 `MIN_METRICS_CONTENT_PX` 时，主动把「训练指标」details 折叠，让用户能看到
     * 全部 details summary、并可手动重新展开。展开后内部曲线列表由 .rl-chart-root
     * 的 overflow-y:auto 提供局部滚动条。
     *
     * 触发时机：
     *   - startBatch() 展开训练日志后；
     *   - .rl-panel 容器尺寸变化（ResizeObserver）；
     *   - 任意 details toggle（用户手动展开训练日志后也可能触发）。
     *
     * v1.14：阈值从 160px 降到 90px，让训练指标在常见 vfill 下保持展开，内部滚动条
     * 由 .rl-chart-root overflow-y:auto 提供；只有当面板被严重挤压（剩余 < 一行半曲线）
     * 才主动 collapse。
     */
    const MIN_METRICS_CONTENT_PX = 0;
    let autoCollapseScheduled = false;
    /** 标记被脚本主动折叠，避免与用户主动展开形成抖动 */
    let metricsAutoCollapsedByScript = false;

    function _findMetricsDetails() {
        return chartRoot ? chartRoot.closest('details') : null;
    }

    function _evaluateMetricsCollapse() {
        autoCollapseScheduled = false;
        const metricsDet = _findMetricsDetails();
        if (!metricsDet || !panel || !chartRoot) {
            return;
        }
        const panelHeight = panel.clientHeight;
        if (panelHeight <= 0) {
            return;
        }
        // 先临时清空 chartRoot 的 maxHeight，避免上一轮值影响 panel.children 高度测量
        // （chartRoot 自己的 height 也会反向参与到 panel 总高里去）。
        chartRoot.style.maxHeight = '';
        let usedExceptMetrics = 0;
        for (const child of panel.children) {
            if (child === metricsDet) {
                continue;
            }
            usedExceptMetrics += child.getBoundingClientRect().height;
        }
        const summaryHeight = metricsDet.querySelector('summary')?.getBoundingClientRect().height ?? 24;
        // panel.children 之间还有 4px gap × n（如果有 gap）；这里粗略再留 8px buffer。
        const remaining = panelHeight - usedExceptMetrics - summaryHeight - 8;
        if (remaining < MIN_METRICS_CONTENT_PX) {
            if (metricsDet.open) {
                metricsDet.dataset.autoToggling = '1';
                metricsDet.open = false;
                metricsAutoCollapsedByScript = true;
            }
            // 折叠后不需要给 chartRoot 设高度
            return;
        }
        if (metricsAutoCollapsedByScript && !metricsDet.open) {
            metricsDet.dataset.autoToggling = '1';
            metricsDet.open = true;
            metricsAutoCollapsedByScript = false;
        }
        // 关键：浏览器对 <details> + flex 的实际表现并不可靠（不同实现下 flex:1 1 0
        // 不一定真的能压缩 details 的 content 区），导致 #rl-chart-root 高度按其内部
        // .rl-chart-panel 累加自然撑开，进而 overflow-y:auto 因为容器没限高而不出滚动条。
        // 这里直接把测算出的剩余高度作为 #rl-chart-root 的 max-height，强制其内部出条。
        if (metricsDet.open) {
            chartRoot.style.maxHeight = `${Math.max(remaining, 80)}px`;
        }
    }

    function scheduleTrainingMetricsAutoCollapse() {
        if (autoCollapseScheduled) {
            return;
        }
        autoCollapseScheduled = true;
        // 等待浏览器完成 details 展开/收起的回流，再读高度
        requestAnimationFrame(() => requestAnimationFrame(_evaluateMetricsCollapse));
    }

    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(() => scheduleTrainingMetricsAutoCollapse());
        ro.observe(panel);
    }
    panel.addEventListener('toggle', (ev) => {
        const target = ev.target;
        if (!(target instanceof HTMLDetailsElement)) {
            return;
        }
        const metricsDet = _findMetricsDetails();
        // 用 dataset.autoToggling 区分「脚本主动 toggle」与「用户主动 toggle」：
        //   - 脚本触发：清除标记，不影响 metricsAutoCollapsedByScript 状态机；
        //   - 用户主动操作：清除自动状态，避免后续误自动展开/折叠抖动。
        if (target === metricsDet) {
            if (target.dataset.autoToggling === '1') {
                delete target.dataset.autoToggling;
            } else {
                metricsAutoCollapsedByScript = false;
            }
        }
        scheduleTrainingMetricsAutoCollapse();
    }, true);

    function updateStats() {
        if (outEp) {
            outEp.textContent = String(totalEpisodes);
        }
        // 头部局数与统计行「局数」共用 totalEpisodes，同步刷新避免两处不一致
        renderBackendHeader();
        if (outAvg && recentScores.length) {
            const slice = recentScores.slice(-AVG_WINDOW);
            const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
            outAvg.textContent = avg.toFixed(1);
        } else if (outAvg) {
            outAvg.textContent = serverStats.avg != null ? serverStats.avg.toFixed(1) : '—';
        }
        if (outWin && recentWins.length) {
            const slice = recentWins.slice(-WIN_WINDOW);
            const w = slice.filter(Boolean).length / slice.length;
            outWin.textContent = `${(w * 100).toFixed(1)}%`;
        } else if (outWin) {
            outWin.textContent = serverStats.win != null ? `${(serverStats.win * 100).toFixed(1)}%` : '—';
        }
        if (outBest) {
            const best = Math.max(bestScore, serverStats.best != null ? serverStats.best : 0);
            outBest.textContent = String(best);
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
            `上局：得分 ${info.score}｜步数 ${info.steps}｜消行 ${info.clears}｜结果 ${info.won ? '胜利' : '未胜'}${lossHint}`
        );
        updateStats();
        if (totalEpisodes % 10 === 0) {
            const n = Math.min(AVG_WINDOW, recentScores.length);
            const avg = n ? recentScores.slice(-AVG_WINDOW).reduce((a, b) => a + b, 0) / n : 0;
            logLine(`累计训练 ${totalEpisodes} 局：最近 ${n} 局平均得分 ${avg.toFixed(0)}`);
        }
        scheduleDashRefresh();
    }

    async function _resumeBgTrainingPoll() {
        if (running) return;
        running = true;
        controller = new AbortController();
        if (btnStart) btnStart.disabled = true;
        if (btnEpisode) btnEpisode.disabled = true;
        if (btnStop) btnStop.disabled = false;
        syncChartPoll();
        logLine('检测到后台训练运行中，已接入监控');
        const pollInterval = 3000;
        // 需连续两次确认 running:false 才判定结束，避免服务重启瞬间的单次误判导致轮询永久停止
        let notRunningStreak = 0;
        try {
            while (!controller.signal.aborted) {
                await new Promise((r) => setTimeout(r, pollInterval));
                if (controller.signal.aborted) break;
                try {
                    const st = await fetchBackgroundTrainingStatus();
                    if (!st.running) {
                        notRunningStreak += 1;
                        if (notRunningStreak >= 2) {
                            logLine(st.error ? `后台训练异常: ${st.error}` : `后台训练已完成 (ep=${st.episodes_done})`);
                            break;
                        }
                    } else {
                        notRunningStreak = 0;
                    }
                } catch { /* 网络/重启抖动：忽略，继续轮询 */ }
                try { await refreshDashboardFull(); } catch { /* ignore */ }
            }
        } finally {
            running = false;
            if (btnStart) btnStart.disabled = false;
            if (btnEpisode) btnEpisode.disabled = false;
            if (btnStop) btnStop.disabled = true;
            syncChartPoll();
            void refreshBackendStatus();
            void refreshDashboardFull();
        }
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
        // 训练时默认展开「训练进展 / 训练损失」两个 details，方便实时观察日志输出；
        // 用户中途手动收起后下次开训仍会再次展开（行为保持简单一致）。
        for (const id of ['rl-progress-log', 'rl-server-log', 'rl-chart-root']) {
            const log = document.getElementById(id);
            const det = log?.closest('details');
            if (det && !det.open) {
                det.open = true;
            }
        }
        // 同时调用一次自适应高度调度：日志区被撑开后，若整体高度不足，
        // 触发「训练指标自动折叠」逻辑（见下方 scheduleTrainingMetricsAutoCollapse）。
        scheduleTrainingMetricsAutoCollapse();
        logLine(
            useBackend
                ? '开始 PyTorch 深度模型后台训练（服务端 rl_pytorch）· 可随时停止'
                : '开始浏览器线性模型自博弈训练 · 可随时停止'
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
                    if (st.training_preset && selPreset) {
                        selPreset.value = st.training_preset;
                    }
                } catch {
                    /* ignore */
                }
            }

            syncChartPoll();
            try {
                await refreshDashboardFull();
            } catch (err) {
                log.warn('[RL panel] refreshDashboardFull:', err);
            }

            if (useBackend) {
                try {
                    const trainingPreset = selPreset?.value || 'balanced';
                    const workerCount = resolveBackgroundWorkerCount(trainingPreset);
                    const webBatch = WEB_DASHBOARD_TRAIN_BATCH;
                    // 性能档：默认关闭每步前瞻搜索（采集瓶颈是模拟器内循环，数百次 step/restore），
                    // 退化为「每步一次策略前向」，单局快 1~2 个数量级。用户显式勾选 lookahead 时尊重其选择。
                    const fastSampling = trainingPreset === 'performance' && !useLookahead;
                    await startBackgroundTraining({
                        episodes: 500000,
                        resume: true,
                        n_workers: workerCount,
                        // 看板用小 batch：balanced+MCTS 单局可达 1–3 分钟，batch=16 首屏 loss 要等太久
                        batch_episodes: webBatch,
                        log_every: webBatch,
                        save_every: 50,
                        preset: trainingPreset,
                        eval_gate_every: 0,
                        value_coef: 1.5,
                        ...(fastSampling ? { lookahead: false } : {}),
                    });
                    if (fastSampling) {
                        logLine('⚡ 性能档：已关闭每步搜索，纯策略快速采集（弱 teacher 信号，吞吐最高）');
                    } else if (trainingPreset === 'balanced' || trainingPreset === 'quality') {
                        logLine(
                            `⚠️ ${trainingPreset === 'quality' ? '效果' : '平衡'}档含 MCTS/搜索，单局采集慢（模拟器内循环密集）；`
                            + `要最快反馈请选 ⚡性能 档并停止后重开训练`
                        );
                    }
                    logLine(
                        `后台训练已启动（${trainingPreset} / workers=${workerCount} / batch=${webBatch} / save=50 / 逐局心跳）`
                    );
                } catch (err) {
                    logLine(`后台训练启动失败: ${err.message}`);
                    return;
                }
                // 轮询后台训练状态直到停止或用户中止
                const pollInterval = 3000;
                while (!controller.signal.aborted) {
                    await new Promise((r) => setTimeout(r, pollInterval));
                    if (controller.signal.aborted) break;
                    try {
                        const st = await fetchBackgroundTrainingStatus();
                        if (!st.running) {
                            if (st.error) {
                                logLine(`后台训练异常退出: ${st.error}`);
                            } else {
                                logLine(`后台训练已完成 (ep=${st.episodes_done})`);
                            }
                            break;
                        }
                    } catch {
                        // 网络异常时继续轮询
                    }
                    // 刷新图表和日志
                    try { await refreshDashboardFull(); } catch { /* ignore */ }
                }
            } else {
                await trainSelfPlay({
                    agent,
                    episodes: 500000,
                    signal: controller.signal,
                    onEpisode,
                    useBackend: false,
                    useLookahead: false,
                });
            }

            logLine(
                useBackend
                    ? '结束 PyTorch 深度模型后台训练（权重已写入服务端 checkpoint）'
                    : (game?.db && isSqliteClientDatabase()
                        ? '结束浏览器线性模型训练 · 已写 localStorage + SQLite（本用户）'
                        : '结束浏览器线性模型训练 · 已写 localStorage')
            );
        } catch (err) {
            log.error('[RL panel] startBatch', err);
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
        btnStop.onclick = async () => {
            controller?.abort();
            logLine('已请求停止…');
            if (readUseBackend()) {
                try {
                    await stopBackgroundTraining();
                    logLine('已发送后台停止信号');
                } catch (err) {
                    logLine(`停止请求失败: ${err.message}`);
                }
            }
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
                        strategyId: game?.strategy || 'normal',
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
    // 状态心跳：每 4s 刷新一次后端状态（内部会刷新服务端日志/统计/局数，并在检测到
    // 后台训练运行但前端轮询已停时自动重启轮询）。即便实时轮询循环因服务重启/网络抖动
    // 中断，看板也能在数秒内自愈，避免「数据不更新、无法判断训练是否在继续」。
    setInterval(
        skipWhenDocumentHidden(() => {
            void refreshBackendStatus();
        }),
        4000
    );
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

    void (async () => {
        if (needRlHydrate) {
            try {
                const remote = await game.db.getBrowserRlLinearAgent();
                if (isValidLinearAgentPayload(remote)) {
                    agent = LinearAgent.fromJSON(remote);
                    agent.save();
                    linearModelSource = 'sqlite';
                } else if (hasSavedLinearAgentInLocalStorage()) {
                    const local = agent.toJSON();
                    if (isValidLinearAgentPayload(local)) {
                        await game.db.putBrowserRlLinearAgent(local);
                        linearModelSource = 'local-backup';
                    }
                }
            } catch (e) {
                log.warn('[RL] 从 SQLite 拉取/回填模型失败', e);
            } finally {
                if (btnStart && !running) {
                    btnStart.disabled = false;
                }
                if (btnEpisode && !vizBusy) {
                    btnEpisode.disabled = false;
                }
            }
        }
        await logActiveModelStatus();
    })();

    /* ====================================================================
     * v1.33: 收起 / 展开按钮绑定
     *
     * 入口（两个按钮，互为镜像）：
     *   #rl-collapse-btn  在 .rl-header-row 内，展开态时可见 → 点击收起
     *   #rl-expand-btn    在 .rl-collapsed-strip 内，收起态时可见 → 点击展开
     *
     * 同步初始 ARIA 状态：inline 脚本可能已在首屏前打 .rl-collapsed 类，
     * 此处补上按钮 aria-expanded（避免屏幕阅读器在按钮就绪后读到 stale 状态）。
     * 注意：不在 setRlPanelCollapsed 中读取 storage 再覆写，避免与 inline
     * 脚本的「优先 storage」语义冲突；这里只把当前 DOM 状态投影到按钮 ARIA。
     * ==================================================================== */
    const collapseBtn = document.getElementById('rl-collapse-btn');
    const expandBtn = document.getElementById('rl-expand-btn');
    const expandLabel = document.getElementById('rl-expand-label');
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            setRlPanelCollapsed(true);
            /* 移交焦点到展开按钮，键盘用户继续 Tab 时不会落到隐藏元素 */
            const next = document.getElementById('rl-expand-btn');
            if (next) next.focus({ preventScroll: true });
        });
    }
    const expandPanel = () => {
        setRlPanelCollapsed(false);
        const next = document.getElementById('rl-collapse-btn');
        if (next) next.focus({ preventScroll: true });
    };
    if (expandBtn) expandBtn.addEventListener('click', expandPanel);
    if (expandLabel) expandLabel.addEventListener('click', expandPanel);
    /* 把 inline 脚本提前打的 .rl-collapsed 投影到按钮初始 aria-expanded */
    const initiallyCollapsed = document.documentElement.classList.contains('rl-collapsed');
    const expanded = initiallyCollapsed ? 'false' : 'true';
    if (collapseBtn) collapseBtn.setAttribute('aria-expanded', expanded);
    if (expandBtn) expandBtn.setAttribute('aria-expanded', expanded);
    if (expandLabel) expandLabel.setAttribute('aria-expanded', expanded);
}

/** v1.33: 暴露给其它模块（例如未来的「全屏游戏」入口）以编程方式控制 RL 面板收起态。 */
export { setRlPanelCollapsed };
