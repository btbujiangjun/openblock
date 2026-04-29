/**
 * seasonPassEntry.js — v10.17 战令入口加强
 *
 * 现状
 * ----
 * `seasonPass.js` 322 行后端逻辑已实装（SeasonPass class）+ 服务端同步 +
 * `_injectPanel()` 注入 #season-pass-panel + 主菜单 button hook
 * (document.getElementById('season-pass-btn').addEventListener)。
 *
 * 但 index.html 中的 `season-pass-btn` 不一定存在；如果没有，本模块
 * 自动注入一个入口 + 红点提示（有未完成任务 / 新任务时）。
 *
 * 接入路径
 * --------
 *   import { initSeasonPassEntry } from './daily/seasonPassEntry.js';
 *   initSeasonPassEntry({ seasonPass, toggleSeasonPass });
 */

let _seasonPass = null;
let _toggleFn = null;

export function initSeasonPassEntry({ seasonPass, toggleSeasonPass }) {
    if (!seasonPass) return;
    _seasonPass = seasonPass;
    _toggleFn = toggleSeasonPass;

    if (typeof document === 'undefined') return;
    if (document.getElementById('season-pass-btn')) {
        _bindRedDot(document.getElementById('season-pass-btn'));
        return;
    }

    /* 注入到右上角浮动按钮组（如果存在 .top-actions） */
    const host = document.querySelector('.top-actions') || document.querySelector('header') || document.body;
    const btn = document.createElement('button');
    btn.id = 'season-pass-btn';
    btn.type = 'button';
    btn.className = 'season-pass-btn';
    btn.title = '赛季通行证 — 任务进度与奖励';
    btn.innerHTML = `<span class="sp-btn__icon">🏆</span><span class="sp-btn__label">战令</span><span class="sp-btn__dot" hidden></span>`;
    host.appendChild(btn);

    btn.addEventListener('click', () => _toggleFn?.());
    _bindRedDot(btn);
}

function _bindRedDot(btn) {
    const dot = btn.querySelector('.sp-btn__dot') || (() => {
        const d = document.createElement('span');
        d.className = 'sp-btn__dot';
        d.hidden = true;
        btn.appendChild(d);
        return d;
    })();

    const refresh = () => {
        const sp = _seasonPass;
        if (!sp || !sp._data) { dot.hidden = true; return; }
        const tasks = sp._season?.tasks || [];
        const done = sp._data.completed || [];
        const pending = tasks.length - done.length;
        const hasNewProgress = _hasRecentProgress();
        if (pending > 0 && hasNewProgress) {
            dot.hidden = false;
            dot.title = `还有 ${pending} 个任务未完成`;
        } else {
            dot.hidden = true;
        }
    };

    refresh();
    setInterval(refresh, 4000);
}

/**
 * 简单判定：localStorage openblock_season_pass 中 progress 字段近 2 分钟有更新
 */
let _lastSnapshot = '';
let _lastUpdateTs = 0;
function _hasRecentProgress() {
    try {
        const raw = localStorage.getItem('openblock_season_pass') || '';
        if (raw !== _lastSnapshot) {
            _lastSnapshot = raw;
            _lastUpdateTs = Date.now();
        }
        return Date.now() - _lastUpdateTs < 120_000;
    } catch { return false; }
}
