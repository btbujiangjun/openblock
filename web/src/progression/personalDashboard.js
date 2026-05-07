/**
 * personalDashboard.js — v10.17 个人数据 dashboard + 年终回顾
 *
 * 设计要点
 * --------
 * 主菜单按钮"📊 个人数据" → 弹出 dashboard 面板，展示：
 *   1. 总览 stats：累计局数 / 总分 / 总消行 / 总时长 / 最高 combo
 *   2. 12 张图（简化为文本卡）：
 *      - 各皮肤偏好排行（前 5）
 *      - 单日最高分日期
 *      - 累计连消榜（perfect / 5+ combo / bonus 次数）
 *      - 当前段位
 *      - 当前赛季任务进度
 *      - 钱包余额
 *      - 复盘相册数量
 *      - 注册天数
 *   3. 注册满 365 天 / 当前年份生日时弹"年报"
 *
 * 数据源：聚合 localStorage 多 key + window.* 全局
 *
 * 接入路径
 * --------
 *   import { initPersonalDashboard } from './progression/personalDashboard.js';
 *   initPersonalDashboard();
 */

const STORAGE_KEY = 'openblock_personal_stats_v1';
const REGISTRATION_KEY = 'openblock_registration_v1';

let _initialized = false;

function _getOrCreateRegistration() {
    try {
        const raw = localStorage.getItem(REGISTRATION_KEY);
        if (raw) return JSON.parse(raw);
        const created = { ts: Date.now(), ymd: new Date().toISOString().slice(0, 10) };
        localStorage.setItem(REGISTRATION_KEY, JSON.stringify(created));
        return created;
    } catch { return { ts: Date.now(), ymd: new Date().toISOString().slice(0, 10) }; }
}

export function initPersonalDashboard() {
    if (_initialized) return;
    _initialized = true;
    _getOrCreateRegistration();

    /* 主菜单入口：#menu-personal-data-btn（main.js）；亦可 window.__personalDashboard?.open() */

    if (typeof window !== 'undefined') {
        window.__personalDashboard = { open: openDashboard, getStats: collectStats };
    }

    /* 检查是否需要弹年报 */
    setTimeout(_maybeShowYearReview, 4000);
}

export function collectStats() {
    const reg = _getOrCreateRegistration();
    const days = Math.max(1, Math.floor((Date.now() - (reg.ts || Date.now())) / 86_400_000));

    /* 复盘相册 */
    let albumCount = 0, milestones = 0;
    try {
        albumCount = (JSON.parse(localStorage.getItem('openblock_replay_album_v1') || '[]') || []).length;
        const ms = JSON.parse(localStorage.getItem('openblock_replay_milestones_v1') || '{"locked":[]}');
        milestones = (ms.locked || []).length;
    } catch { /* ignore */ }

    /* 段位 */
    const rank = (typeof window !== 'undefined' && window.__rankSystem?.getCurrent?.()) || null;

    /* 钱包 */
    let walletBalance = {};
    /* v1.13：钱包流水明细 —— 让玩家在面板看到「我刚刚领过的 +1 提示券」之类的入账记录，
     * 而不只是聚合余额。getLedger 返回最新 N 条（环形缓冲，已截断旧记录）。 */
    let walletLedger = [];
    try {
        const w = window.__wallet;
        if (w) {
            walletBalance = {
                hint: w.getBalance('hintToken'),
                undo: w.getBalance('undoToken'),
                bomb: w.getBalance('bombToken'),
                rainbow: w.getBalance('rainbowToken'),
                coin: w.getBalance('coin'),
                fragment: w.getBalance('fragment'),
            };
            if (typeof w.getLedger === 'function') {
                walletLedger = w.getLedger({ limit: 12 }).slice().reverse();
            }
        }
    } catch { /* ignore */ }

    /* 偏好皮肤 — 简单实现：只读取当前皮肤 + Top 10 中皮肤分布 */
    const skinFreq = {};
    try {
        const album = JSON.parse(localStorage.getItem('openblock_replay_album_v1') || '[]');
        for (const e of album) {
            skinFreq[e.skinId] = (skinFreq[e.skinId] || 0) + 1;
        }
    } catch { /* ignore */ }
    const topSkins = Object.entries(skinFreq).sort((a, b) => b[1] - a[1]).slice(0, 5);

    /* 累计 — 这部分依赖运行时统计聚合（粗略实现） */
    const totalGames = (() => {
        try {
            const ms = JSON.parse(localStorage.getItem('openblock_replay_milestones_v1') || '{"games":0}');
            return ms.games | 0;
        } catch { return 0; }
    })();

    return {
        registrationDays: days,
        totalGames,
        albumCount,
        milestones,
        rank,
        walletBalance,
        walletLedger,
        topSkins,
        currentSkin: (typeof localStorage !== 'undefined' && localStorage.getItem('openblock_skin')) || 'classic',
    };
}

/* v1.13：流水来源 → 中文 / emoji 友好标签。未匹配时按 source 原值显示，避免硬编码遗漏。
 * 规则：前缀匹配优先，覆盖一族 source（如 chest-* / season-chest-* / lucky-wheel-* / checkin-day-*）。 */
const _LEDGER_SOURCE_PREFIX = [
    ['chest-',           '🎁 局末宝箱'],
    ['season-chest-',    '🏆 赛季宝箱'],
    ['lucky-wheel-',     '🎡 周末转盘'],
    ['checkin-day-',     '📅 每日签到'],
    ['login-streak-',    '🔥 连签里程碑'],
    ['monthly-',         '📆 月度签到'],
    ['ftue_',            '🌱 新手引导'],
    ['ach-',             '🏅 成就奖励'],
    ['invite_',          '🤝 邀请奖励'],
    ['invitee_',         '🤝 受邀奖励'],
    ['tier_',            '🤝 邀请阶梯'],
    ['daily-task-',      '📋 每日任务'],
    ['mini-goal-',       '🎯 小目标'],
    ['season-pass-',     '🎫 赛季通行证'],
    ['first-purchase-',  '💎 首充奖励'],
    ['rainbow-refund',   '🌈 彩虹退款'],
    ['undo-refund',      '↩️ 撤销退款'],
    ['skin-fragment-earn','🔧 皮肤碎片'],
    ['birthday',         '🎂 生日礼物'],
    ['first-day-pack',   '🎁 首日大礼包'],
    ['welcome-back',     '👋 回归礼包'],
    ['trial-',           '👕 皮肤试穿'],
    ['hint_pack',        '💎 IAP 提示包'],
];

function _formatLedgerSource(source) {
    const s = String(source || '');
    for (const [prefix, label] of _LEDGER_SOURCE_PREFIX) {
        if (s.startsWith(prefix)) return label;
    }
    return s || '未知';
}

const _LEDGER_KIND_LABEL = {
    hintToken: '提示券',
    undoToken: '撤销券',
    bombToken: '炸弹券',
    rainbowToken: '彩虹券',
    freezeToken: '冻结券',
    previewToken: '预览券',
    rerollToken: '重抽券',
    coin: '金币',
    trialPass: '试穿券',
    fragment: '碎片',
};

function _formatLedgerEntry(row) {
    const t = new Date(row.ts || Date.now());
    const ts = `${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
    const kindLabel = _LEDGER_KIND_LABEL[row.kind] || row.kind || '?';
    const amount = Number(row.amount) || 0;
    const sign = amount > 0 ? '+' : (amount < 0 ? '−' : '·');
    const cls = amount > 0 ? 'pd-ledger--add' : (amount < 0 ? 'pd-ledger--spend' : 'pd-ledger--cap');
    const sourceLabel = _formatLedgerSource(row.source);
    let amountText = `${sign}${Math.abs(amount)} ${kindLabel}`;
    if (row.action === 'cap') {
        amountText = `已达上限（请求 ${row.cappedFrom ?? '?'}）`;
    } else if (row.cappedFrom && row.cappedFrom > Math.abs(amount)) {
        amountText += `（截断自 ${row.cappedFrom}）`;
    }
    return `<div class="pd-ledger-row ${cls}">
        <span class="pd-ledger-ts">${ts}</span>
        <span class="pd-ledger-amount">${amountText}</span>
        <span class="pd-ledger-source">${sourceLabel}</span>
    </div>`;
}

export function openDashboard() {
    if (typeof document === 'undefined') return;
    document.getElementById('personal-dashboard')?.remove();
    const s = collectStats();

    const el = document.createElement('div');
    el.id = 'personal-dashboard';
    el.className = 'personal-dashboard';
    el.innerHTML = `
        <div class="pd-card">
            <div class="pd-head">
                <h2>个人数据</h2>
                <span class="pd-meta">注册 ${s.registrationDays} 天 · 累计 ${s.totalGames} 局</span>
                <button class="pd-close" type="button" aria-label="关闭">×</button>
            </div>
            <div class="pd-body">
                <div class="pd-stats-grid">
                    ${_statCard('总游戏局数', s.totalGames)}
                    ${_statCard('Top 10 收录', s.albumCount)}
                    ${_statCard('里程碑', s.milestones)}
                    ${_statCard('当前段位', s.rank?.name || '青铜 III', s.rank?.icon)}
                </div>
                <h3>偏好皮肤</h3>
                <div class="pd-skin-list">
                    <div class="pd-current-skin">当前：<b>${s.currentSkin}</b></div>
                    ${s.topSkins.length === 0 ? '<div class="pd-empty">完成更多 200+ 局解锁数据</div>'
                        : s.topSkins.map(([skin, n]) => `
                            <div class="pd-skin-row">
                                <span>${skin}</span>
                                <span class="pd-skin-count">${n} 局</span>
                            </div>
                        `).join('')}
                </div>
                <h3>钱包余额</h3>
                <div class="pd-wallet">
                    <span>🎯 ${s.walletBalance.hint | 0}</span>
                    <span>↩ ${s.walletBalance.undo | 0}</span>
                    <span>💣 ${s.walletBalance.bomb | 0}</span>
                    <span>🌈 ${s.walletBalance.rainbow | 0}</span>
                    <span>💰 ${s.walletBalance.coin | 0}</span>
                    <span>🔧 ${s.walletBalance.fragment | 0}</span>
                </div>
                <h3>最近入账 <span class="pd-ledger-hint">（来源 · 金额 · 时间）</span></h3>
                <div class="pd-ledger">
                    ${(s.walletLedger || []).length === 0
                        ? '<div class="pd-empty">暂无流水（领取过宝箱/签到/任务后这里会出现）</div>'
                        : s.walletLedger.map(_formatLedgerEntry).join('')}
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    el.querySelector('.pd-close').addEventListener('click', () => {
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 280);
    });
}

function _statCard(label, value, icon) {
    return `<div class="pd-stat"><div class="pd-stat__val">${icon || ''} ${value || 0}</div><div class="pd-stat__label">${label}</div></div>`;
}

function _maybeShowYearReview() {
    const reg = _getOrCreateRegistration();
    const days = Math.floor((Date.now() - reg.ts) / 86_400_000);
    if (days < 365) return;
    const lastReview = (() => {
        try { return JSON.parse(localStorage.getItem('openblock_year_review_v1') || '{}').lastYear; }
        catch { return null; }
    })();
    const thisYear = new Date().getFullYear();
    if (lastReview === thisYear) return;
    /* 记录已弹 */
    try { localStorage.setItem('openblock_year_review_v1', JSON.stringify({ lastYear: thisYear })); }
    catch { /* ignore */ }
    /* 通过 personalDashboard 路径弹（精简版） */
    const s = collectStats();
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'year-review';
    el.innerHTML = `
        <div class="yr-card">
            <h2>年终回顾</h2>
            <p>这一年，你与 OpenBlock 共同走过：</p>
            <div class="yr-stats">
                <div><b>${s.registrationDays}</b> 天的相伴</div>
                <div>累计 <b>${s.totalGames}</b> 局</div>
                <div>${s.milestones} 个里程碑</div>
                <div>${s.albumCount} 局进入榜单</div>
            </div>
            <button class="yr-close" type="button">收下回忆</button>
        </div>
    `;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-visible'));
    el.querySelector('.yr-close').addEventListener('click', () => {
        el.classList.remove('is-visible');
        setTimeout(() => el.remove(), 280);
    });
}

/** 测试用 */
export function __resetForTest() {
    _initialized = false;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(REGISTRATION_KEY); } catch { /* ignore */ }
    }
}
