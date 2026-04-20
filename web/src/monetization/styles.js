/**
 * 商业化 UI 样式注入（所有 mon-* 组件共用）
 * 通过 JS 动态注入，避免修改现有 CSS 文件
 */

const MON_CSS = `
/* ===== 商业化组件基础样式 ===== */

/* Toast 通知 */
.mon-toast {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%) translateY(20px);
    background: rgba(15, 20, 35, 0.95);
    color: #e8eef4;
    border: 1px solid rgba(56, 189, 248, 0.3);
    border-radius: 12px;
    padding: 10px 18px;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 14px;
    z-index: 10000;
    opacity: 0;
    transition: opacity 0.3s ease, transform 0.3s ease;
    pointer-events: none;
    max-width: 360px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
}
.mon-toast.mon-toast-visible {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
}
.mon-toast-icon { font-size: 18px; }
.mon-toast-xp { margin-left: auto; color: #38bdf8; font-weight: bold; }
.mon-toast-desc { font-size: 12px; color: #94a3b8; }

/* 广告覆盖层 */
.mon-ad-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.75);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 20000;
}
.mon-ad-box {
    background: #1e293b;
    border: 1px solid rgba(56,189,248,0.3);
    border-radius: 16px;
    padding: 32px;
    text-align: center;
    min-width: 260px;
    color: #e8eef4;
}
.mon-ad-label { font-size: 12px; color: #94a3b8; margin-bottom: 8px; }
.mon-ad-reason { font-size: 16px; font-weight: bold; margin-bottom: 16px; }
.mon-ad-timer {
    font-size: 36px;
    font-weight: bold;
    color: #38bdf8;
    margin-bottom: 12px;
    min-height: 44px;
}
.mon-ad-skip, .mon-ad-close {
    background: #38bdf8;
    color: #0f172a;
    border: none;
    border-radius: 8px;
    padding: 10px 24px;
    font-size: 15px;
    cursor: pointer;
    transition: opacity 0.2s;
}
.mon-ad-skip:disabled { opacity: 0.4; cursor: not-allowed; }

/* 排行榜面板 */
.mon-panel {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(15, 20, 35, 0.97);
    border: 1px solid rgba(56, 189, 248, 0.25);
    border-radius: 16px;
    width: min(380px, 90vw);
    max-height: 80vh;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    z-index: 15000;
    box-shadow: 0 8px 40px rgba(0,0,0,0.5);
    color: #e8eef4;
}
.mon-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    font-weight: bold;
    font-size: 16px;
}
.mon-panel-close {
    background: none;
    border: none;
    color: #94a3b8;
    font-size: 20px;
    cursor: pointer;
    padding: 0 4px;
}
.mon-lb-body {
    overflow-y: auto;
    padding: 8px 0;
    flex: 1;
}
.mon-lb-loading, .mon-lb-empty {
    text-align: center;
    padding: 32px;
    color: #94a3b8;
}
.mon-lb-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.05);
}
.mon-lb-row.mon-lb-me {
    background: rgba(56, 189, 248, 0.08);
    border-left: 3px solid #38bdf8;
}
.mon-lb-rank { width: 32px; color: #94a3b8; font-size: 13px; }
.mon-lb-uid { flex: 1; font-size: 13px; color: #94a3b8; }
.mon-lb-score { font-weight: bold; color: #38bdf8; }

/* 分享按钮 */
.mon-share-container {
    display: flex;
    justify-content: center;
    margin-top: 12px;
}
.mon-share-btn {
    background: rgba(56, 189, 248, 0.15);
    border: 1px solid rgba(56, 189, 248, 0.4);
    color: #38bdf8;
    border-radius: 10px;
    padding: 10px 22px;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.2s;
}
.mon-share-btn:hover { background: rgba(56, 189, 248, 0.25); }

/* ===== 商业化策略解释区（#insight-commercial）===== */
/* 完全复用 panel-section / insight-* 的设计语言，用 CSS 变量保持一致 */

.insight-commercial-section {
    /* 继承 .panel-section 结构，但额外挂商业化色 */
    border: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 10%, transparent);
    border-radius: 4px;
    margin: 2px 0;
    background: color-mix(in srgb, var(--text-primary, #1e293b) 3%, transparent);
    overflow: hidden;
}
.insight-commercial-section > summary {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    font-size: 8.5px;
    font-weight: 600;
    padding: 3px 6px;
    user-select: none;
    color: var(--text-secondary, #3d5266);
    list-style: none;
}
.insight-commercial-section > summary::-webkit-details-marker { display: none; }
.insight-commercial-section > summary::before {
    content: '▶';
    display: inline-block;
    font-size: 7px;
    margin-right: 5px;
    transition: transform 0.15s ease;
    flex-shrink: 0;
}
.insight-commercial-section[open] > summary::before { transform: rotate(90deg); }
.insight-commercial-section > summary:hover {
    background: color-mix(in srgb, var(--text-primary, #1e293b) 6%, transparent);
}

/* 分群徽章：复用 insight-tag 语言 */
.mon-segment-badge {
    margin-left: auto;
    font-size: 8px;
    padding: 2px 6px;
    border-radius: 4px;
    font-weight: 700;
    white-space: nowrap;
    line-height: 1.3;
    /* 颜色由 JS 内联 style 注入（随分群变化） */
    background: color-mix(in srgb, var(--accent-color, #5B9BD5) 14%, transparent);
    color: var(--accent-dark, #4472C4);
    border: 1px solid color-mix(in srgb, var(--accent-color, #5B9BD5) 22%, transparent);
}

.insight-commercial-body {
    padding: 4px 6px 5px;
    animation: panelSlideDown 0.15s ease;
}

/* 信号网格：3 列 × 2 行，复用 insight-metric pill 风格 */
.ci-signals {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 3px;
    margin-bottom: 5px;
}
/* 复用 .insight-metric 横排：标签左对齐，值右对齐，不换行 */
.ci-signal-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 4px;
    min-width: 0;
    padding: 4px 6px;
    font-size: 8.5px;
    line-height: 1.2;
    background: color-mix(in srgb, var(--text-primary, #4a5f73) 7%, transparent);
    border: 1px solid color-mix(in srgb, var(--text-primary, #4a5f73) 12%, transparent);
    border-radius: 4px;
    overflow: hidden;
    cursor: help;
}
.ci-signal-row:hover {
    background: color-mix(in srgb, var(--text-primary, #4a5f73) 11%, transparent);
}
.ci-signal-label {
    flex-shrink: 0;
    color: var(--text-secondary, #3d5266);
    opacity: 0.92;
    white-space: nowrap;
}
.ci-signal-value {
    flex: 1 1 auto;
    min-width: 0;
    text-align: right;
    font-size: 8.5px;
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    /* 颜色由 JS 内联 style 注入 */
}
.ci-signal-sub { display: none; }

/* 分隔标题行：复用 panel-section-head 的字重/色 */
.ci-actions-title {
    font-size: 8px;
    font-weight: 600;
    color: var(--text-secondary, #5d7a96);
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 3px 0 2px;
    opacity: 0.85;
}

/* 策略动作卡片：复用 strategy-tip 布局，扩展 why / effect 说明行 */
.ci-actions { display: flex; flex-direction: column; }
.ci-action-card {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    padding: 5px 0 4px;
    border-top: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 6%, transparent);
}
.ci-action-card:first-child { border-top: none; }

/* 优先级左边框，复用 strategy-tip 的类别色逻辑 */
.ci-action--high   .ci-action-icon { color: #e67e22; }
.ci-action--medium .ci-action-icon { color: var(--accent-dark, #4472C4); }
.ci-action--low    .ci-action-icon { color: var(--text-secondary, #6b7c8c); }
.ci-action--active { background: color-mix(in srgb, #e67e22 5%, transparent); border-radius: 4px; padding-left: 3px; }

.ci-action-icon {
    flex: 0 0 auto;
    font-size: 11px;
    line-height: 1;
    margin-top: 2px;
}
.ci-action-body  {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
}
/* 第一行：标签 + 品类 + 触发标记 + 优先级 */
.ci-action-head {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 3px;
}
.ci-action-label {
    font-size: 9px;
    font-weight: 700;
    color: var(--text-primary, #1e293b);
}
.ci-action-product {
    font-size: 8.5px;
    color: var(--text-secondary, #5d7a96);
}
.ci-action-live {
    font-size: 8px;
    color: #e67e22;
    font-weight: 700;
}
.ci-action-priority {
    font-size: 8px;
    color: var(--text-secondary, #8a9bab);
    opacity: 0.8;
    margin-left: auto;
}
/* 触发原因（why）：用 insight-kv 风格 */
.ci-action-why {
    font-size: 8px;
    line-height: 1.4;
    color: var(--text-secondary, #5d7a96);
    padding-left: 1px;
}
.ci-action-why::before {
    content: '◎ ';
    opacity: 0.6;
}
/* 预期效果（effect）：突出显示 */
.ci-action-effect {
    font-size: 8px;
    line-height: 1.4;
    color: var(--accent-dark, #4472C4);
    font-weight: 600;
    padding-left: 1px;
}
.ci-action-effect::before {
    content: '→ ';
    opacity: 0.7;
}

/* 推理摘要：复用 #insight-why 的 ul/li 风格 */
.ci-why-list {
    margin: 6px 0 0;
    padding: 5px 6px 5px 18px;
    border-left: 2px solid color-mix(in srgb, var(--accent-color, #5B9BD5) 30%, transparent);
    background: color-mix(in srgb, var(--text-primary, #1e293b) 3%, transparent);
    border-radius: 0 4px 4px 0;
    list-style: disc;
}
.ci-why-list li {
    font-size: 8px;
    line-height: 1.5;
    color: var(--text-secondary, #5d7a96);
    margin-bottom: 2px;
}
.ci-why-list li:last-child { margin-bottom: 0; }

/* 兼容旧 ci-explain（保留供降级） */
.ci-explain {
    margin-top: 5px;
    font-size: 8px;
    line-height: 1.45;
    color: var(--text-secondary, #8a9bab);
    opacity: 0.85;
    border-left: 2px solid color-mix(in srgb, var(--accent-color, #5B9BD5) 30%, transparent);
    padding-left: 6px;
}
`;

let _injected = false;

export function injectMonStyles() {
    if (_injected || typeof document === 'undefined') return;
    _injected = true;
    const style = document.createElement('style');
    style.id = 'openblock-mon-styles';
    style.textContent = MON_CSS;
    document.head.appendChild(style);
}
