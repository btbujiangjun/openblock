/**
 * progressDigest.js — v10.17 局末进度齐刷条
 *
 * 设计要点
 * --------
 * 把目前散在 5 个模块（任务 / 迷你目标 / 战令 / 连登 / 段位）的进度条聚合到
 * game over 弹窗内的一个面板，逐条动画推进，给玩家"我有 5 项进度都涨了"的成就感。
 *
 * 实现：
 * 1. 装饰 game.endGame：endGame 完成后采集各模块当前进度
 * 2. 在 #game-over 弹窗（如果存在）下方注入 .progress-digest 容器
 * 3. 每条进度延迟 200ms 依次动画填充（CSS transition）
 *
 * 数据源：
 *   - 每日任务: window.__dailyTasks?.getState?.() （若存在）
 *   - 迷你目标: window.__miniGoals?.getCurrentGoal?.()
 *   - 赛季通行证: window.__seasonPass?._data?.progress
 *   - 连登天数:  localStorage openblock_login_streak_v1
 *   - 段位：    window.__rankSystem?.getCurrent?.()
 *
 * 接入路径
 * --------
 *   import { initProgressDigest } from './daily/progressDigest.js';
 *   initProgressDigest({ game });
 */

let _game = null;

export function initProgressDigest({ game } = {}) {
    if (!game || _game) return;
    _game = game;

    const orig = game.endGame.bind(game);
    game.endGame = async (...args) => {
        const r = await orig(...args);
        setTimeout(() => _renderDigest(), 600);
        return r;
    };
}

function _collectRows() {
    const rows = [];

    // 1) 每日任务
    try {
        const dt = window.__dailyTasks?.getState?.();
        if (dt?.tasks) {
            for (const t of dt.tasks.slice(0, 2)) {
                if (t.completed) continue;
                rows.push({
                    icon: t.icon || '✅',
                    label: t.label,
                    cur: t.progress | 0,
                    max: t.target | 0,
                });
            }
        }
    } catch { /* ignore */ }

    // 2) 迷你目标
    try {
        const mg = window.__miniGoals?.getCurrentGoal?.();
        if (mg && !mg.completed) {
            rows.push({
                icon: mg.icon || '🎯',
                label: mg.label || '迷你目标',
                cur: mg.progress | 0,
                max: mg.target | 0,
            });
        }
    } catch { /* ignore */ }

    // 3) 赛季通行证（取前 2 个未完成任务）
    try {
        const sp = window.__seasonPass;
        if (sp && sp._season && sp._data) {
            for (const task of sp._season.tasks.slice(0, 2)) {
                if (sp._data.completed?.includes(task.id)) continue;
                const cur = sp._data.progress?.[task.type] | 0;
                rows.push({
                    icon: '🏆',
                    label: task.label,
                    cur: Math.min(cur, task.target),
                    max: task.target,
                });
            }
        }
    } catch { /* ignore */ }

    // 4) 段位（如果接入）
    try {
        const rk = window.__rankSystem?.getCurrent?.();
        if (rk) {
            rows.push({
                icon: rk.icon || '🎖️',
                label: `段位 · ${rk.name}`,
                cur: rk.exp | 0,
                max: rk.maxExp | 0,
            });
        }
    } catch { /* ignore */ }

    // 5) 连登天数
    try {
        const raw = localStorage.getItem('openblock_login_streak_v1');
        if (raw) {
            const s = JSON.parse(raw);
            if (s.currentStreak >= 1) {
                rows.push({
                    icon: '📅',
                    label: '连续登录',
                    cur: s.currentStreak | 0,
                    max: 7,
                });
            }
        }
    } catch { /* ignore */ }

    return rows.slice(0, 5);   // 最多 5 条避免太长
}

function _renderDigest() {
    const rows = _collectRows();
    if (rows.length === 0) return;
    if (typeof document === 'undefined') return;

    const gameOver = document.getElementById('game-over');
    if (!gameOver) return;

    let host = gameOver.querySelector('.progress-digest');
    if (host) host.remove();
    host = document.createElement('div');
    host.className = 'progress-digest';
    host.innerHTML = `
        <div class="pd-title">本局进度</div>
        ${rows.map((row, i) => `
            <div class="pd-row" style="--pd-i:${i}">
                <span class="pd-icon">${row.icon}</span>
                <span class="pd-label">${row.label}</span>
                <span class="pd-bar"><span class="pd-fill" data-cur="${row.cur}" data-max="${row.max}"></span></span>
                <span class="pd-num">${row.cur}/${row.max}</span>
            </div>
        `).join('')}
    `;
    gameOver.appendChild(host);

    // 动画推进：依次 200ms 填充 fill 宽度
    const fills = host.querySelectorAll('.pd-fill');
    fills.forEach((f, i) => {
        const cur = parseInt(f.dataset.cur, 10) | 0;
        const max = parseInt(f.dataset.max, 10) | 0;
        const pct = max > 0 ? Math.min(100, Math.round(cur / max * 100)) : 0;
        f.style.width = '0%';
        setTimeout(() => { f.style.width = pct + '%'; }, 220 + i * 220);
    });
}

/** 测试用 */
export function __resetForTest() {
    _game = null;
}
