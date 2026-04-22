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

import { getCommercialInsight, updateRealtimeSignals } from './personalization.js';
import { getFlag } from './featureFlags.js';
import { on } from './MonetizationBus.js';
import { openMonPanel } from './monPanel.js';

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
        section.open = false;
        section.innerHTML = `
<summary class="insight-section-title">
  <span>💰 商业化策略</span>
  <span id="insight-commercial-badge" class="mon-segment-badge"></span>
  <button type="button" id="mon-panel-open-btn" class="insight-mon-panel-btn" title="模型训练面板">⚙</button>
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

    if (badge) {
        badge.textContent = `${insight.segmentIcon} ${_segmentShortLabel(insight.segment)}`;
        badge.style.background = insight.segmentColor + '22';
        badge.style.color = insight.segmentColor;
        badge.style.border = `1px solid ${insight.segmentColor}66`;
    }

    body.innerHTML = _renderBody(insight);
}

function _segmentShortLabel(seg) {
    return { whale: 'Whale', dolphin: 'Dolphin', minnow: 'Minnow' }[seg] ?? seg;
}

function _renderBody(insight) {
    const { signals, actions, explain, whyLines } = insight;

    // ── 信号格 ──
    const signalHtml = signals.map(s => {
        const tip = s.tooltip ? s.tooltip.replace(/"/g, '&quot;') : s.sub;
        return `<div class="ci-signal-row" title="${tip}">` +
            `<span class="ci-signal-label">${s.label}</span>` +
            `<span class="ci-signal-value" style="color:${s.color}">${s.value}</span>` +
            `</div>`;
    }).join('');

    // ── 策略动作卡片（含 why + effect）──
    const actionHtml = actions.length === 0
        ? '<p class="insight-muted">暂无策略推荐</p>'
        : actions.map(a => {
            const activeCls = a.active ? ' ci-action--active' : '';
            const priorityCls = `ci-action--${a.priority ?? 'medium'}`;
            const whyHtml  = a.why    ? `<span class="ci-action-why">${a.why}</span>`    : '';
            const effHtml  = a.effect ? `<span class="ci-action-effect">${a.effect}</span>` : '';
            return `
<div class="ci-action-card ${priorityCls}${activeCls}">
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

function _priorityBadge(p) {
    return { high: '🔴高', medium: '🟡中', low: '⚪低' }[p] ?? '';
}

function _escHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}
