/**
 * seasonPassEntry.js — v10.17 战令入口加强
 *
 * 现状
 * ----
 * `seasonPass.js` 322 行后端逻辑已实装（SeasonPass class）+ 服务端同步 +
 * `_injectPanel()` 注入 #season-pass-panel + 主菜单 button hook
 * (document.getElementById('season-pass-btn').addEventListener)。
 *
 * `index.html` 技能栏内置 `#season-pass-btn`；若缺失则回退注入到 header/body。
 *
 * 接入路径
 * --------
 *   import { initSeasonPassEntry } from './daily/seasonPassEntry.js';
 *   initSeasonPassEntry({ seasonPass, toggleSeasonPass });
 */

import { skipWhenDocumentHidden } from '../lib/pageVisibility.js';

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

    const bar = document.querySelector('#skill-bar');
    const restart = document.getElementById('insight-restart');
    const btn = document.createElement('button');
    btn.id = 'season-pass-btn';
    btn.type = 'button';
    btn.className = 'skill-btn skill-btn--season-pass season-pass-btn';
    btn.title = '赛季通行证 — 任务进度与奖励';
    btn.innerHTML = '🏆';
    if (bar && restart) {
        bar.insertBefore(btn, restart);
    } else {
        (bar || document.querySelector('header') || document.body).appendChild(btn);
    }

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
    setInterval(skipWhenDocumentHidden(refresh), 4000);
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
