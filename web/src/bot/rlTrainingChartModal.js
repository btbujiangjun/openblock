/**
 * rlTrainingChartModal.js — RL 训练指标「放大详读」浮层
 *
 * 触发：点击侧栏任一训练曲线 canvas → 弹出居中卡片，展示放大版多序列折线图 +
 * 指标说明 / 当前解读 / 各序列摘要。交互与玩家洞察面板的 openInsightMetricModal 对齐。
 */

import { ensureInsightMetricModalStyles } from '../insightMetricModal.js';
import { paintRlChartCanvas, splitRlPanelHelp, summarizeSeriesValues } from './rlTrainingCharts.js';

const MODAL_CHART_H = 280;
const MODAL_CHART_W = 760;

let _overlay = null;
let _onKey = null;

function _escape(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _formatSeriesValue(v, yTick) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '—';
    if (typeof yTick === 'function') return yTick(v);
    const a = Math.abs(v);
    if (a >= 1e6) return v.toExponential(1);
    if (a >= 100) return v.toFixed(0);
    return v.toFixed(2);
}

const CHART_GUIDES = {
    loss_policy: {
        plain: '策略网络（actor）在学习“这一步该选哪个动作”。Lπ 不是越接近 0 就一定越好，它主要用来观察 PPO 更新是否仍在产生有效梯度。',
        read: [
            '优先看粗线 MA：它比逐局细线更能反映趋势。',
            '缓慢靠近 0 或窄幅波动通常是健康的；突然大幅震荡要结合 KL、熵、得分一起看。',
            '数值为负很常见，表示当前 batch 的 advantage 与策略更新方向组合后的结果，不代表“损失坏了”。',
        ],
        warning: [
            '长期显示 0 或 N/A：通常是训练日志字段缺失、MPS reduction 异常，或该 batch 没有有效 PG 步。',
            '持续大幅上升且得分/胜率同步下降：策略更新可能过猛，先查 target_kl、ppo_epochs_run 和 approx_kl。',
        ],
        action: '先看 PPO 健康面板：如果 KL 频繁早停，调高 target_kl 或增大 batch；如果熵过低，抬高 entropy floor。',
    },
    loss_value: {
        plain: '价值网络（critic）在学习“当前局面未来大概能拿多少回报”。Lv 是预测误差，常比策略损失更吵。',
        read: [
            '单点尖峰很正常，优先看 MA 是否持续下降或横盘。',
            '只要得分/胜率在涨，Lv 稍高不一定是坏事，可能是课程门槛变难导致目标分布变了。',
            'Lv 的量级会受 reward scale、valueReturnScale、win_threshold 改动影响，跨配置比较要小心。',
        ],
        warning: [
            'MA 阶跃上升且长期不回落：价值目标尺度可能过大，或 returns/GAE 出现异常。',
            'Lv 下降但得分不涨：critic 学会了预测，但 actor 没学到更好的动作，需要看 Lπ 与 teacher/replay。',
        ],
        action: '优先检查 valueReturnScale、returns clip、value target clip；再对照 score 和 win_rate 是否同向改善。',
    },
    entropy: {
        plain: '策略熵 H(π) 表示策略有多“犹豫”。高熵=多个动作概率接近，低熵=模型几乎只选一个动作。',
        read: [
            '训练早期熵高是好事，说明在探索；中后期缓慢下降也正常，说明策略开始利用已学经验。',
            '本项目当前 1.5～2.5 大多属于可用区间，具体要结合动作数和胜率。',
            '熵不是越高越好：过高会随机，过低会过早收敛。',
        ],
        warning: [
            '接近 0 且得分停滞：策略塌缩，可能陷入局部最优。',
            '长期很高且得分不涨：策略不够果断，entropy_coef 可能偏大或 teacher 信号太弱。',
        ],
        action: '熵塌缩时提高 RL_ENTROPY_COEF_MIN；熵过高时降低 entropy_coef 或加强 teacher/replay 信号。',
    },
    step_count: {
        plain: 'step_count 是一局里模型实际走了多少步。它近似表示存活长度，也会影响得分上限。',
        read: [
            '步数和得分通常正相关，但不是完全等价：短局也可能高效清分，长局也可能只是拖延。',
            '批量训练时该值可能是 batch 的代表值或均值，重点看趋势。',
            '课程变难时步数短期下降是正常现象。',
        ],
        warning: [
            '突然大幅变短：策略可能崩盘、课程过难，或环境提前终止。',
            '异常变长但得分不涨：可能出现低效拖局，需要检查奖励是否鼓励无效存活。',
        ],
        action: '和 score、win_rate 一起看：三者同升通常健康；步数升但分数不升要查奖励 shaping。',
    },
    win_rate: {
        plain: '胜率表示近期有多少局达到当前 win_threshold。它衡量“是否过关”，不是直接衡量“分数多高”。',
        read: [
            'quantile 课程下胜率会被设计成围绕目标区间波动，因此不是越高越好。',
            '如果 win_threshold 同时上涨，胜率小幅回落也可能代表课程正在变难。',
            '胜率和得分要一起读：只看胜率可能误判“刷过关但不提分”的策略。',
        ],
        warning: [
            '胜率长期低于 20%：课程可能过难或策略退化。',
            '胜率很高但 threshold 不涨：课程推进逻辑可能卡住，或日志字段没有更新。',
        ],
        action: '看课程面板的 threshold/quantile target；若 threshold 不动，检查 curriculum_mode 与 quantile_* 字段。',
    },
    score: {
        plain: 'score 是每局最终得分，是最接近业务目标的指标。粗线 MA 比逐局细线更重要。',
        read: [
            '训练曲线通常会有大尖峰，说明模型偶尔找到高分打法；后续要看 MA 能否跟上。',
            'p90/最高分上涨代表上限打开，MA 上涨代表打法变稳定。',
            'score 会受局长、课程门槛、奖励 shaping、出块分布共同影响。',
        ],
        warning: [
            '最高分涨但 MA 不涨：高分打法不稳定，可能需要 replay/BC 固化。',
            'score 涨但 win_rate 跌：可能在“刷分但不过关”，检查胜利阈值和奖励目标是否一致。',
        ],
        action: '高分尖峰出现后，观察 replay ratio 和 BC 是否把高分局吸收进去；必要时提高 high-score replay 保留率。',
    },
    teacher: {
        plain: 'Teacher 是搜索算法（如 MCTS/beam）给策略网络的“参考答案”。本图回答：老师有没有参与、老师的答案清不清楚。',
        read: [
            'coverage 接近 1：多数训练步都有 teacher；接近 0：主要靠 PPO 自己学。',
            'q entropy 高：老师觉得多个动作差不多；低：老师有明确偏好。',
            'q top margin 越大，说明第一名动作比第二名更明显，蒸馏信号更强。',
        ],
        warning: [
            'coverage 长期为 0：MCTS/beam 没进训练数据，蒸馏损失参考价值下降。',
            'coverage 高但 margin 很小：老师虽然参与，但答案太平，学生学不到强偏好。',
        ],
        action: '先确认 mcts_sims、lookahead、beam 是否启用；再看 Q distill/visit_pi distill 是否同步下降。',
    },
    replay: {
        plain: 'Replay 是把旧的高价值/困难样本重新拿来训练。蒸馏损失表示学生和 teacher 之间还有多大差距。',
        read: [
            'Q distill / visit_pi distill 下降：学生正在吸收老师信号。',
            'replay ratio 表示旧样本占比，0.2～0.5 常较稳；过高会压低新鲜 on-policy 样本。',
            '蒸馏损失和 replay ratio 量纲不同，不能直接比较谁更大。',
        ],
        warning: [
            'replay ratio 长期过高：模型可能被旧策略锁住，探索变慢。',
            '蒸馏损失长期高位且 teacher coverage 足够：teacher 与当前策略冲突，或蒸馏权重/温度不合适。',
        ],
        action: '高分平台期可适度增加 replay；策略僵住时降低 sampleRatio 或加快 bcCoef 退火。',
    },
    curriculum: {
        plain: '课程门槛控制“多少分算赢”。它会随模型变强而变难，避免模型只学会低难度打法。',
        read: [
            'win threshold 上涨：训练系统认为模型能力提升，正在加难度。',
            'quantile target 是近期分数分位数；EMA 是平滑后的内部状态；threshold 通常跟随 EMA。',
            'target 与 EMA 接近，说明课程响应平稳；长期偏离说明课程反应太慢或太快。',
        ],
        warning: [
            'threshold 长期不动：课程卡住，模型可能在固定难度上刷分。',
            'threshold 暴涨后胜率断崖：课程推进太激进，需要调低 emaAlpha 或加保护。',
        ],
        action: '看 win_rate 是否围绕目标区间；若门槛追不上 score，提高 emaAlpha；若太激进，降低 quantile p 或加回撤保护。',
    },
};

function _guideFor(chartId) {
    return CHART_GUIDES[String(chartId || '')] || {
        plain: '这是一个 RL 训练诊断图。先看粗线或窗口均值，再结合得分、胜率、熵和 PPO 健康一起判断。',
        read: ['不要孤立看单个尖峰；训练曲线有噪声，趋势比单点重要。'],
        warning: ['字段长期为空、为 0 或突然跳到极大值，通常先怀疑日志口径或数值稳定性。'],
        action: '从最近一次超参变更、日志字段是否齐全、以及训练进程是否重启开始排查。',
    };
}

function _listHtml(items) {
    return (items || []).map((item) => `<li>${_escape(item)}</li>`).join('');
}

function _guideHtml(chartId) {
    const g = _guideFor(chartId);
    return `
        <section class="imm-section rtcm-guide">
            <h4 class="imm-section-title">新手读图指南</h4>
            <div class="rtcm-guide-grid">
                <div class="rtcm-guide-card rtcm-guide-card--wide">
                    <b>一句话理解</b>
                    <p>${_escape(g.plain)}</p>
                </div>
                <div class="rtcm-guide-card">
                    <b>怎么看</b>
                    <ul>${_listHtml(g.read)}</ul>
                </div>
                <div class="rtcm-guide-card">
                    <b>常见异常</b>
                    <ul>${_listHtml(g.warning)}</ul>
                </div>
                <div class="rtcm-guide-card rtcm-guide-card--wide">
                    <b>排查动作</b>
                    <p>${_escape(g.action)}</p>
                </div>
            </div>
        </section>`;
}

/**
 * @param {object} plotMeta
 * @param {number} offsetX
 * @param {number[]} x
 * @param {object[]} series
 * @returns {{ index: number, episode: number } | null}
 */
function _nearestIndexFromX(plotMeta, offsetX, x) {
    if (!plotMeta || !x?.length) return null;
    const { padL, plotW, xmin, xmax } = plotMeta;
    const rel = Math.max(0, Math.min(1, (offsetX - padL) / Math.max(plotW, 1)));
    const ep = xmin + rel * ((xmax - xmin) || 1);
    let best = 0;
    let bestDist = Math.abs(x[0] - ep);
    for (let i = 1; i < x.length; i++) {
        const d = Math.abs(x[i] - ep);
        if (d < bestDist) {
            best = i;
            bestDist = d;
        }
    }
    return { index: best, episode: x[best] };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} plotMeta
 * @param {number[]} x
 * @param {object[]} series
 * @param {{ yTick?: (v:number)=>string }} chartOpts
 * @param {HTMLElement} readoutEl
 */
function _wirePlotHover(canvas, plotMeta, x, series, chartOpts, readoutEl) {
    if (!canvas || !plotMeta || !readoutEl) return;

    const render = (idx) => {
        const ep = x[idx];
        const parts = series.map((s) => {
            const v = s.y?.[idx];
            return `<span style="color:${s.color}">${_escape(s.label)} ${_escape(_formatSeriesValue(v, chartOpts?.yTick))}</span>`;
        });
        readoutEl.innerHTML = `<span class="rtcm-readout-ep">局 ${ep}</span> · ${parts.join(' · ')}`;
    };

    render(x.length - 1);

    canvas.addEventListener('mousemove', (ev) => {
        const hit = _nearestIndexFromX(plotMeta, ev.offsetX, x);
        if (hit) render(hit.index);
    });
    canvas.addEventListener('mouseleave', () => {
        render(x.length - 1);
    });
}

/**
 * @param {object} cfg
 * @param {string} cfg.chartId
 * @param {string} cfg.title
 * @param {number[]} cfg.x
 * @param {object[]} cfg.series
 * @param {object} [cfg.chartOpts]
 * @param {string} [cfg.hint]
 * @returns {{ close: () => void } | null}
 */
export function openRlTrainingChartModal(cfg) {
    if (typeof document === 'undefined' || !cfg || !Array.isArray(cfg.x) || cfg.x.length < 2) {
        return null;
    }
    if (cfg.chartOpts?.emptyMessage) {
        return null;
    }

    closeRlTrainingChartModal();
    ensureInsightMetricModalStyles();

    const { chartId, title, x, series, chartOpts = {}, hint = '' } = cfg;
    const { meaning, analysis } = splitRlPanelHelp(hint);
    const primaryColor = series?.[0]?.color || '#5b9bd5';

    const overlay = document.createElement('div');
    overlay.className = 'insight-metric-modal-backdrop rtcm-backdrop';
    overlay.setAttribute('data-chart-id', String(chartId || ''));

    const seriesSummaryHtml = (series || []).map((s) => {
        const summary = summarizeSeriesValues(s.y || []);
        const yTick = chartOpts?.yTick;
        return `<div class="imm-summary-row" style="--imm-row-color:${s.color}">
            <div class="imm-summary-row-head">
                <span class="imm-summary-row-dot" style="background:${s.color}"></span>
                <span class="imm-summary-row-label">${_escape(s.label)}</span>
            </div>
            <ul class="imm-summary">
                <li><span>最小</span><b>${_escape(_formatSeriesValue(summary.min, yTick))}</b></li>
                <li><span>最大</span><b>${_escape(_formatSeriesValue(summary.max, yTick))}</b></li>
                <li><span>平均</span><b>${_escape(_formatSeriesValue(summary.avg, yTick))}</b></li>
                <li><span>最新</span><b>${_escape(_formatSeriesValue(summary.last, yTick))}</b></li>
                <li><span>样本</span><b>${summary.count} / ${x.length}</b></li>
            </ul>
        </div>`;
    }).join('');

    overlay.innerHTML = `
        <div class="insight-metric-modal rtcm-modal" role="dialog" aria-modal="true" aria-labelledby="rtcm-title">
            <header class="imm-head">
                <span class="imm-color-dot" style="background:${primaryColor}"></span>
                <h3 class="imm-title" id="rtcm-title">${_escape(title)}</h3>
                <span class="imm-key" title="图表 id">${_escape(chartId || '')}</span>
                <button type="button" class="imm-close" aria-label="关闭">×</button>
            </header>
            <section class="imm-section imm-section--meaning">
                <h4 class="imm-section-title">指标说明</h4>
                <p class="imm-section-body">${_escape(meaning) || '<i class="imm-empty">该图暂无说明。</i>'}</p>
            </section>
            ${_guideHtml(chartId)}
            <div class="imm-readout rtcm-readout">
                <span class="imm-readout-hint">横坐标：训练局数（episodes）；鼠标移到曲线上读取各序列数值</span>
                <div class="rtcm-readout-body" data-role="readout"></div>
            </div>
            <div class="rtcm-plot-wrap">
                <canvas class="rtcm-plot-canvas" aria-label="${_escape(title)} 放大曲线"></canvas>
            </div>
            <section class="imm-section imm-section--analysis">
                <h4 class="imm-section-title">当前解读</h4>
                <p class="imm-section-body imm-section-body--analysis">${_escape(analysis) || '<i class="imm-empty">暂无动态解读；继续训练或刷新后会更新。</i>'}</p>
            </section>
            <div class="imm-summary-wrap rtcm-summary-wrap">${seriesSummaryHtml}</div>
        </div>
    `;
    document.body.appendChild(overlay);

    const canvas = overlay.querySelector('.rtcm-plot-canvas');
    const readout = overlay.querySelector('[data-role="readout"]');
    const modalChartOpts = {
        ...chartOpts,
        cssH: MODAL_CHART_H,
        showCanvasTitle: false,
    };
    const { plotMeta } = paintRlChartCanvas(canvas, title, x, series, modalChartOpts, hint, MODAL_CHART_W);
    _wirePlotHover(canvas, plotMeta, x, series, chartOpts, readout);

    const close = () => closeRlTrainingChartModal();
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) close();
    });
    overlay.querySelector('.imm-close')?.addEventListener('click', close);
    _onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', _onKey);

    _overlay = overlay;
    return { close };
}

export function closeRlTrainingChartModal() {
    if (_onKey) {
        document.removeEventListener('keydown', _onKey);
        _onKey = null;
    }
    if (_overlay) {
        _overlay.remove();
        _overlay = null;
    }
}
