/**
 * 自博弈训练面板：启动/停止、胜率与得分统计；可选 PyTorch 后端（Flask /api/rl）
 */
import { LinearAgent } from './linearAgent.js';
import { trainSelfPlay, runSelfPlayEpisode, WIN_SCORE_THRESHOLD } from './trainer.js';
import { isRlPytorchBackendPreferred } from '../config.js';
import { fetchRlStatus } from './pytorchBackend.js';

const WIN_WINDOW = 80;
const AVG_WINDOW = 40;
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
    const outLast = el('rl-last');
    const outLog = el('rl-log');
    const chkPytorch = el('rl-use-pytorch');
    const outBackendStatus = el('rl-backend-status');

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
        });
    }

    async function refreshBackendStatus() {
        if (!outBackendStatus) {
            return;
        }
        try {
            const st = await fetchRlStatus();
            if (st.available) {
                outBackendStatus.textContent = `${st.device || '?'} · 已训 ${st.episodes ?? 0} 局`;
            } else {
                outBackendStatus.textContent = st.reason ? `不可用：${st.reason}` : '不可用';
            }
        } catch (e) {
            outBackendStatus.textContent = '无法连接 API';
        }
    }

    function logLine(msg) {
        if (!outLog) {
            return;
        }
        const t = new Date().toLocaleTimeString();
        outLog.textContent = `[${t}] ${msg}\n` + outLog.textContent.split('\n').slice(0, 12).join('\n');
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
        } else if (!info.fromBackend) {
            totalEpisodes++;
        }
        recentScores.push(info.score);
        recentWins.push(info.won);
        if (info.score > bestScore) {
            bestScore = info.score;
        }
        if (outLast) {
            const lossHint =
                info.lossPolicy != null && info.lossValue != null
                    ? ` · Lπ ${info.lossPolicy.toFixed(3)} Lv ${info.lossValue.toFixed(3)}`
                    : '';
            outLast.textContent = `得分 ${info.score} · 步数 ${info.steps} · 消除 ${info.clears}${info.won ? ' · 胜' : ''}${lossHint}`;
        }
        updateStats();
        if (totalEpisodes % 10 === 0) {
            const n = Math.min(AVG_WINDOW, recentScores.length);
            const avg = n ? recentScores.slice(-AVG_WINDOW).reduce((a, b) => a + b, 0) / n : 0;
            logLine(`已训练 ${totalEpisodes} 局 · 近${n}局均分 ${avg.toFixed(0)}`);
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
                ? '开始自博弈（PyTorch 后端 REINFORCE + 价值头），可随时停止'
                : '开始自博弈（浏览器线性模型 + localStorage），可随时停止'
        );

        await trainSelfPlay({
            agent,
            episodes: 5000,
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
        logLine(
            useBackend
                ? '本轮训练结束或已停止，权重已由服务端保存（见 RL_CHECKPOINT_SAVE）'
                : '本轮训练结束或已停止，权重已写入 localStorage'
        );
        void refreshBackendStatus();
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
                if (outLast) {
                    outLast.textContent = `评估：得分 ${ep.score} · 步数 ${ep.steps} · 消除 ${ep.totalClears}${ep.won ? ' · 胜' : ''}`;
                }
                logLine(
                    `单局评估：${ep.score} 分 · ${ep.trajectory.length} 次决策（${useBackend ? 'PyTorch 推理' : '线性模型'}；不写入滑动均分/胜率）`
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
        `已加载${readUseBackend() ? '（将尝试 PyTorch 后端）' : '线性策略'}（阈值≥${WIN_SCORE_THRESHOLD} 分计为胜）。`
    );
}
