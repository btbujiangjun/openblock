/**
 * firstWinBoost.js — v10.17 每日首胜加分（First Win of Day）
 *
 * 设计要点
 * --------
 * - 每日首局得分 ×1.5 倍率（默认）— 装饰 game.endGame 在分数最终结算前注入
 * - 仅对得分 ≥ 100 的局生效（避免几手就 game over 也算"首胜"）
 * - 倒计时显示"剩 X 小时获取首胜加成"，制造时段紧迫感
 * - 已享用今日加成后，加成 toast 不再显示
 * - localStorage：openblock_first_win_v1 = { lastBoostYmd, hoursUsed }
 *
 * 接入路径
 * --------
 *   import { initFirstWinBoost } from './daily/firstWinBoost.js';
 *   initFirstWinBoost({ game });
 */

const STORAGE_KEY = 'openblock_first_win_v1';
const BOOST_RATIO = 1.5;
const MIN_SCORE_TO_QUALIFY = 100;

let _game = null;
let _boostAppliedForRun = false;

function _ymd(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function _load() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : { lastBoostYmd: null, totalDays: 0 };
    } catch { return { lastBoostYmd: null, totalDays: 0 }; }
}
function _save(s) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

function isBoostAvailableToday() {
    const s = _load();
    return s.lastBoostYmd !== _ymd();
}

function _getBoostRatio() {
    return BOOST_RATIO;
}

export function initFirstWinBoost({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    const origStart = game.start.bind(game);
    game.start = async (...args) => {
        _boostAppliedForRun = false;
        const r = await origStart(...args);
        _maybeShowReminder();
        return r;
    };

    const origEnd = game.endGame.bind(game);
    game.endGame = async (...args) => {
        const beforeScore = game.score | 0;
        _maybeApplyBoost(beforeScore);
        const r = await origEnd(...args);
        return r;
    };

    if (typeof window !== 'undefined') {
        window.__firstWinBoost = {
            isAvailable: isBoostAvailableToday,
            reset: () => _save({ lastBoostYmd: null, totalDays: 0 }),
            ratio: BOOST_RATIO,
        };
    }
}

function _maybeShowReminder() {
    if (!isBoostAvailableToday()) return;
    const hoursLeft = 24 - new Date().getHours();
    _showInlineBanner(`今日首胜加成 ×${BOOST_RATIO} 还剩 ${hoursLeft}h — 完成本局即可触发`);
}

function _maybeApplyBoost(score) {
    if (_boostAppliedForRun) return 0;
    if (!isBoostAvailableToday()) return;
    if (score < MIN_SCORE_TO_QUALIFY) return;

    const bonus = Math.round(score * (BOOST_RATIO - 1));
    _boostAppliedForRun = true;
    if (_game) _game.score = (_game.score | 0) + bonus;
    if (_game?.gameStats) {
        _game.gameStats.score = _game.score;
        _game.gameStats.boostBonus = ((_game.gameStats.boostBonus | 0) + bonus);
    }
    _game?.updateUI?.();

    const s = _load();
    s.lastBoostYmd = _ymd();
    s.totalDays = (s.totalDays | 0) + 1;
    _save(s);

    _showCelebrate(`今日首胜 ×${BOOST_RATIO} 已生效 +${bonus}`);
    return bonus;
}

/**
 * v10.17.11：reminder 改用顶部 inline banner（注入到 .score-theme-row 下方），
 * 不再用 #easter-egg-toast 底部 fixed 浮窗，避免遮挡 dock 候选块区。
 *
 * banner 居中、跨整行 stat 胶囊宽度、淡入 3s 自动淡出，
 * 不阻挡盘面 / dock 任何主操作区。
 */
function _showInlineBanner(msg) {
    if (typeof document === 'undefined') return;
    const id = 'first-win-banner';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'first-win-banner';
        const anchor = document.querySelector('.score-theme-row');
        if (anchor && anchor.parentNode) {
            anchor.parentNode.insertBefore(el, anchor.nextSibling);
        } else {
            document.body.appendChild(el);
        }
    }
    el.textContent = '☀️ ' + msg;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
    }, 3500);
}

function _showCelebrate(msg) {
    if (typeof document === 'undefined') return;
    const id = 'easter-egg-toast';
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('div');
        el.id = id;
        document.body.appendChild(el);
    }
    el.dataset.tier = 'celebrate';
    el.innerHTML = `<div style="font-size:30px">☀️</div>
                    <div style="font-weight:700;font-size:18px;margin-top:6px">${msg}</div>`;
    el.classList.remove('is-visible');
    void el.offsetHeight;
    el.classList.add('is-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
        el.classList.remove('is-visible');
        delete el.dataset.tier;
    }, 3500);
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
    _boostAppliedForRun = false;
    if (typeof localStorage !== 'undefined') {
        try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    }
}
