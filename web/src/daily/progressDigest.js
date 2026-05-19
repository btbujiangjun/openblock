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
import { animateValueOnElement } from '../scoreAnimator.js';

let _game = null;

function _prefersReducedMotion() {
    try {
        return typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

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
    const replayAnalysis = _game._lastReplayAnalysis || stats.replayAnalysis || null;
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

    return { clears, maxCombo, placements, hitRate, duration, bestReview: _buildBestReview(replayAnalysis) };
}

function _buildBestReview(replayAnalysis) {
    const quality = replayAnalysis?.nearBestQuality;
    if (quality && Number.isFinite(Number(quality.score))) {
        return Number(quality.score) >= 0.62
            ? t('game.summary.nearBestHigh')
            : t('game.summary.nearBestLow');
    }
    const source = replayAnalysis?.bestBreakSource;
    if (source) {
        const labels = {
            skill_break: t('game.summary.bestBreakSkill'),
            payoff_break: t('game.summary.bestBreakPayoff'),
            rescue_break: t('game.summary.bestBreakRescue'),
            risk_break: t('game.summary.bestBreakRisk'),
            random_like_break: t('game.summary.bestBreakRandom'),
        };
        return labels[source] || t('game.summary.bestBreakGeneric');
    }
    return null;
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

    /* v1.60.3：每项额外携带 numeric 字段（若可数值化）→ 渲染后启动滚动入场，
     * 让战报数值与 #over-score 老虎机式滚动形成统一"滚动语言"。
     * 非数字项（用时 3:06 / 文案"差点就刷"）保持静态，仅享受 stagger 浮现。 */
    const items = [
        { label: t('game.summary.clears'),    value: t('game.summary.clearsValue', { n: facts.clears }), numeric: facts.clears },
        { label: t('game.summary.maxCombo'),  value: `${facts.maxCombo}`,                                 numeric: facts.maxCombo },
        ...(facts.hitRate != null ? [{ label: t('game.summary.hitRate'), value: `${facts.hitRate}%`, numeric: facts.hitRate }] : []),
        ...(facts.duration   ? [{ label: t('game.summary.duration'), value: facts.duration }]    : []),
        ...(facts.bestReview ? [{ label: t('game.summary.bestChallenge'), value: facts.bestReview }] : []),
    ];

    slot.hidden = false;
    slot.classList.add('progress-digest');
    slot.innerHTML = `
        <div class="pd-title">${t('game.summary.title')}</div>
        <div class="pd-grid">
            ${items.map((it, idx) => `
                <div class="pd-cell" style="--i: ${idx}">
                    <div class="pd-cell-label">${it.label}</div>
                    <div class="pd-cell-value"${
                        Number.isFinite(it.numeric)
                            ? ` data-target="${it.numeric}" data-final="${_escapeAttr(it.value)}"`
                            : ''
                    }>${it.value}</div>
                </div>
            `).join('')}
        </div>
    `;

    _animateNumericValues(slot);
}

/** 把 `9 行` / `100%` / `1,287` 拆成 [prefix, number, suffix]，方便滚动时只动 number 段。 */
function _splitNumericText(text) {
    const m = String(text).match(/^(\D*)(\d[\d,]*)(.*)$/);
    if (!m) return null;
    return { prefix: m[1], suffix: m[3] };
}

function _escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** 给 .pd-cell-value[data-target] 触发"从 0 滚到目标值"动画，保留原 value 的前后缀。 */
function _animateNumericValues(slot) {
    if (!slot || _prefersReducedMotion()) return;
    const nodes = slot.querySelectorAll('.pd-cell-value[data-target]');
    nodes.forEach((el, idx) => {
        const target = Number(el.dataset.target);
        if (!Number.isFinite(target)) return;
        const finalText = el.dataset.final || el.textContent;
        const split = _splitNumericText(finalText);
        if (!split) return;
        /* 起手归零，与老虎机分数视觉对齐 */
        el.textContent = `${split.prefix}0${split.suffix}`;
        animateValueOnElement(el, target, {
            /* stagger：与 .pd-cell 入场动画的 80+idx*90ms 节拍接近，整体感更顺 */
            duration: 760 + idx * 80,
            format: (v) => `${split.prefix}${Math.floor(v).toLocaleString()}${split.suffix}`,
            onComplete: () => { el.textContent = finalText; },
        });
    });
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
}
