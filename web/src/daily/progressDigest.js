/**
 * progressDigest.js — v10.18.7 本局战报（事实型 / 同步注入 / i18n）
 *
 * 关键变更
 * --------
 * v10.18.2：内容从「成就目标值」改为「本局事实」。
 * v10.18.7：
 *   - 渲染时机：原本通过装饰 `endGame` + setTimeout(600ms) 注入，会让玩家先看到一张
 *     不带战报的卡片，0.6s 后再"长出来"——用户体验为「先后弹两次」。本版改为装饰
 *     `showScreen('game-over')`，在结算卡变 active 之前就同步注入 DOM，卡片只出现一次。
 *   - 文案：title / 4 项标签 / value 后缀全部走 `i18n.t()`，与英文/中文环境对齐。
 */
import { t } from '../i18n/i18n.js';

let _game = null;

export function initProgressDigest({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    const origShowScreen = game.showScreen.bind(game);
    game.showScreen = (id) => {
        if (id === 'game-over') {
            try { _renderDigest(); } catch (e) { console.warn('[digest]', e); }
        }
        return origShowScreen(id);
    };
}

/**
 * 采集本局事实数据。
 * 仅返回当局可观测量；不混入跨局/目标值，避免与玩家体感脱钩。
 */
function _collectFacts() {
    if (!_game) return null;
    const stats = _game.gameStats || {};
    const clears = stats.clears | 0;
    const maxCombo = stats.maxCombo | 0;
    const placements = stats.placements | 0;
    const misses = stats.misses | 0;

    // 命中率：成功落子 / 总尝试。无落子时返回 null（不展示）
    const totalTries = placements + misses;
    const hitRate = totalTries > 0
        ? Math.round((placements / totalTries) * 100)
        : null;

    // 用时：startTime 由 startGame 写入；缺失则不展示
    let duration = null;
    if (stats.startTime) {
        const ms = Date.now() - stats.startTime;
        const sec = Math.max(0, Math.floor(ms / 1000));
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        duration = `${m}:${String(s).padStart(2, '0')}`;
    }

    return { clears, maxCombo, placements, hitRate, duration };
}

function _renderDigest() {
    if (typeof document === 'undefined') return;
    const slot = document.getElementById('over-digest')
        || document.querySelector('#game-over .game-over-card');
    if (!slot) return;

    const facts = _collectFacts();
    slot.innerHTML = '';
    if (!facts || (facts.clears === 0 && facts.placements === 0)) {
        slot.hidden = true;
        return;
    }

    const items = [
        { label: t('game.summary.clears'),    value: t('game.summary.clearsValue', { n: facts.clears }) },
        { label: t('game.summary.maxCombo'),  value: `${facts.maxCombo}` },
        ...(facts.hitRate != null ? [{ label: t('game.summary.hitRate'), value: `${facts.hitRate}%` }] : []),
        ...(facts.duration   ? [{ label: t('game.summary.duration'), value: facts.duration }]    : []),
    ];

    slot.hidden = false;
    slot.classList.add('progress-digest');
    slot.innerHTML = `
        <div class="pd-title">${t('game.summary.title')}</div>
        <div class="pd-grid">
            ${items.map(it => `
                <div class="pd-cell">
                    <div class="pd-cell-label">${it.label}</div>
                    <div class="pd-cell-value">${it.value}</div>
                </div>
            `).join('')}
        </div>
    `;
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
}
