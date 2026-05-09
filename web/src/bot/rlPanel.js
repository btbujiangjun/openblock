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
/** v1.33: RL 面板收起态持久化键（与 index.html 中 inline 防闪烁脚本严格一致）。 */
const LS_RL_COLLAPSED = 'openblock_rl_panel_collapsed_v1';

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
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
    /* 同步 ARIA：两端按钮的 aria-expanded 反映「面板是否展开」 */
    const collapseBtn = document.getElementById('rl-collapse-btn');
    const expandBtn = document.getElementById('rl-expand-btn');
    if (collapseBtn) collapseBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    if (expandBtn) expandBtn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
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
                return `[${t}] ${JSON.stringify(e).slice(0, 100)}`;
            });
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
            return '';
        }
        const lp = Number(a);
        const lv = Number(b);
        if (!Number.isFinite(lp) || !Number.isFinite(lv)) {
            return '';
        }
        return `｜策略损失 ${lp.toFixed(3)}｜价值损失 ${lv.toFixed(3)}`;
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
    const MIN_METRICS_CONTENT_PX = 90;
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
        for (const id of ['rl-progress-log', 'rl-server-log']) {
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
    if (collapseBtn) {
        collapseBtn.addEventListener('click', () => {
            setRlPanelCollapsed(true);
            /* 移交焦点到展开按钮，键盘用户继续 Tab 时不会落到隐藏元素 */
            const next = document.getElementById('rl-expand-btn');
            if (next) next.focus({ preventScroll: true });
        });
    }
    if (expandBtn) {
        expandBtn.addEventListener('click', () => {
            setRlPanelCollapsed(false);
            const next = document.getElementById('rl-collapse-btn');
            if (next) next.focus({ preventScroll: true });
        });
    }
    /* 把 inline 脚本提前打的 .rl-collapsed 投影到按钮初始 aria-expanded */
    const initiallyCollapsed = document.documentElement.classList.contains('rl-collapsed');
    if (collapseBtn) collapseBtn.setAttribute('aria-expanded', initiallyCollapsed ? 'false' : 'true');
    if (expandBtn) expandBtn.setAttribute('aria-expanded', initiallyCollapsed ? 'false' : 'true');
}

/** v1.33: 暴露给其它模块（例如未来的「全屏游戏」入口）以编程方式控制 RL 面板收起态。 */
export { setRlPanelCollapsed };
