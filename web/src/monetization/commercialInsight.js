/**
 * 商业化策略解释区（OPT-09）
 *
 * 将个性化商业策略可视化，非侵入式注入到「玩家画像」面板（#player-insight-panel）。
 *
 * 挂载方式：
 *   1. initCommercialInsight(game) 调用后，在 #player-insight-panel 末尾追加
 *      #insight-commercial 区块（仅追加，不修改现有 DOM）。
 *   2. 链式 patch game._playerInsightRefresh，确保每次画像刷新后同步更新商业信号。
 *   3. 监听 MonetizationBus 的 game_over / no_clear / spawn_blocks 事件触发增量刷新。
 *
 * 依赖：
 *   - web/src/monetization/personalization.js
 *   - MonetizationBus（事件订阅）
 */

import { getCommercialInsight, getCommercialModelContext, updateRealtimeSignals } from './personalization.js';
import { on } from './MonetizationBus.js';
import { openMonPanel } from './monPanel.js';
import { getLTVEstimate, renderLTVCard } from './ltvPredictor.js';
import { getAdFreqSnapshot } from './adTrigger.js';
import { buildCommercialModelVector } from './commercialModel.js';
import { getHelpText } from './strategy/index.js';

const SECTION_ID = 'insight-commercial';

/** 初始化并挂载商业化策略区 */
export function initCommercialInsight(game) {
    if (!game) return;

    // 找到父面板
    const panel = document.getElementById('player-insight-panel');
    if (!panel) return;

    // 创建/复用 section
    let section = document.getElementById(SECTION_ID);
    if (!section) {
        section = document.createElement('details');
        section.id = SECTION_ID;
        section.className = 'insight-section insight-commercial-section';
        // v1.14：默认展开，使左侧画像栏在大多数视口下能填满高度，避免底部留白；
        // 用户手动收起后由浏览器 details 原生行为接管，不强制再展开。
        section.open = true;
        section.innerHTML = `
<summary class="insight-section-title">
  <span>💰 商业化策略</span>
  <span id="insight-commercial-badge" class="mon-segment-badge mon-help"
        title="${_attrText(getHelpText('signal.segment'))}"></span>
  <button type="button" id="mon-panel-open-btn"
          class="insight-mon-panel-btn mon-help"
          title="${_attrText(getHelpText('panel.entry'))}"
          data-help-key="panel.entry">⚙</button>
</summary>
<div id="insight-commercial-body" class="insight-commercial-body">
  <p class="insight-muted">正在分析…</p>
</div>`;
        panel.appendChild(section);

        // 绑定模型训练面板入口（阻止冒泡，防止触发 details 展开/折叠）
        document.getElementById('mon-panel-open-btn')
            ?.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); openMonPanel(); });
    }

    // 链式 patch _playerInsightRefresh
    const origRefresh = game._playerInsightRefresh;
    game._playerInsightRefresh = () => {
        origRefresh?.();
        _refreshCommercialSection(game);
    };

    // 事件订阅：实时信号更新（出块/未消行）
    on('spawn_blocks', ({ game: g }) => {
        updateRealtimeSignals(g?.playerProfile ?? game.playerProfile);
        _refreshCommercialSection(game);
    });
    on('no_clear', ({ game: g }) => {
        updateRealtimeSignals(g?.playerProfile ?? game.playerProfile);
        _refreshCommercialSection(game);
    });
    on('game_over', () => {
        setTimeout(() => _refreshCommercialSection(game), 200);
    });

    // 初次渲染
    updateRealtimeSignals(game.playerProfile);
    _refreshCommercialSection(game);
}

function _refreshCommercialSection(game) {
    const body  = document.getElementById('insight-commercial-body');
    const badge = document.getElementById('insight-commercial-badge');
    if (!body) return;

    // 每次刷新时同步实时信号
    if (game?.playerProfile) updateRealtimeSignals(game.playerProfile);

    const insight = getCommercialInsight();
    let commercialModel = null;
    let ltv = null;
    try {
        ltv = getLTVEstimate(game?.playerProfile);
        commercialModel = buildCommercialModelVector({
            ...getCommercialModelContext(),
            profile: game?.playerProfile,
            ltv,
            adFreq: getAdFreqSnapshot(),
        });
        insight.model = commercialModel;
        insight.whyLines = [
            ...(insight.whyLines || []),
            ...(commercialModel.explain || []).map((line) => `模型化：${line}`)
        ];
    } catch { /* ignore */ }

    if (badge) {
        badge.textContent = `${insight.segmentIcon} ${_segmentShortLabel(insight.segment)}`;
        badge.style.background = insight.segmentColor + '22';
        badge.style.color = insight.segmentColor;
        badge.style.border = `1px solid ${insight.segmentColor}66`;
    }

    // LTV 预测卡片（仅对 D 类/买量用户始终显示，其他用户数据足够时显示）
    let ltvHtml = '';
    try {
        if (ltv.segment === 'D' || ltv.confidence !== 'low') {
            ltvHtml = renderLTVCard(ltv);
        }
    } catch { /* ignore */ }

    body.innerHTML = _renderBody(insight) + _renderModelCard(commercialModel) + ltvHtml;
}

function _segmentShortLabel(seg) {
    return { whale: 'Whale', dolphin: 'Dolphin', minnow: 'Minnow' }[seg] ?? seg;
}

function _renderBody(insight) {
    const { signals, actions, whyLines } = insight;

    // ── 信号格（每格 cursor:help + 详细 tooltip）──
    const signalHtml = signals.map(s => {
        // 优先用规则中心的统一文案；缺失时降级到 _state 自带 tooltip
        const helpKey = `signal.${s.key}`;
        const helpText = getHelpText(helpKey) || s.tooltip || s.sub;
        const tip = _attrText(helpText);
        return `<div class="ci-signal-row mon-help" title="${tip}" data-help-key="${helpKey}">` +
            `<span class="ci-signal-label">${s.label}</span>` +
            `<span class="ci-signal-value" style="color:${s.color}">${s.value}</span>` +
            `</div>`;
    }).join('');

    // ── 策略动作卡片（含 why + effect）──
    const ruleTip = _attrText(getHelpText('rule.title'));
    const actionHtml = actions.length === 0
        ? '<p class="insight-muted">暂无策略推荐</p>'
        : actions.map(a => {
            const activeCls = a.active ? ' ci-action--active' : '';
            const priorityCls = `ci-action--${a.priority ?? 'medium'}`;
            const whyHtml  = a.why    ? `<span class="ci-action-why">${a.why}</span>`    : '';
            const effHtml  = a.effect ? `<span class="ci-action-effect">${a.effect}</span>` : '';
            const ruleId = a.ruleId ? ` data-rule-id="${a.ruleId}"` : '';
            return `
<div class="ci-action-card ${priorityCls}${activeCls} mon-help" title="${ruleTip}"${ruleId}>
  <span class="ci-action-icon">${a.icon}</span>
  <div class="ci-action-body">
    <div class="ci-action-head">
      <span class="ci-action-label">${a.label}</span>
      <span class="ci-action-product">${a.product}</span>
      ${a.active ? '<span class="ci-action-live">⚡ 触发中</span>' : ''}
      <span class="ci-action-priority">${_priorityBadge(a.priority)}</span>
    </div>
    ${whyHtml}
    ${effHtml}
  </div>
</div>`;
        }).join('');

    // ── 推理摘要（why bullets，参考 #insight-why）──
    const whyHtml = (whyLines ?? []).length > 0
        ? `<ul class="ci-why-list">${
            whyLines.map(l => `<li>${_escHtml(l)}</li>`).join('')
          }</ul>`
        : '';

    return `
<div class="ci-signals">${signalHtml}</div>
<div class="ci-actions-title">推荐策略</div>
<div class="ci-actions">${actionHtml}</div>
${whyHtml}`;
}

function _renderModelCard(model) {
    if (!model) return '';
    const pct = (v) => `${Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 100)}%`;
    const rows = [
        ['付费', 'payerScore', model.payerScore],
        ['IAP', 'iapPropensity', model.iapPropensity],
        ['激励', 'rewardedAdPropensity', model.rewardedAdPropensity],
        ['插屏', 'interstitialPropensity', model.interstitialPropensity],
        ['流失', 'churnRisk', model.churnRisk],
        ['疲劳', 'adFatigueRisk', model.adFatigueRisk],
    ].map(([label, key, value]) =>
        `<span class="ci-model-pill mon-help" data-help-key="model.${key}" title="${_attrText(getHelpText(`model.${key}`))}">${label} ${pct(value)}</span>`
    ).join('');
    return `
<div class="ci-model-card">
  <div class="ci-model-head">
    <span>模型化决策</span>
    <strong>${_escHtml(model.recommendedAction)}</strong>
  </div>
  <div class="ci-model-pills">${rows}</div>
</div>`;
}

function _priorityBadge(p) {
    return { high: '🔴高', medium: '🟡中', low: '⚪低' }[p] ?? '';
}

function _escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/** 把任意文本转成 HTML 属性可用的字符串（转义双引号 + 删除换行干扰） */
function _attrText(s) {
    return String(s ?? '').replace(/"/g, '&quot;');
}
