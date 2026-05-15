/**
 * SeasonPass — 赛季通行证 UI / 任务追踪层
 *
 * v1.49.x P2-1 合并归一：本文件与 `web/src/monetization/seasonPass.js` 互补，
 * 共同实现完整赛季通行证：
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  本文件 (web/src/seasonPass.js)                              │
 *   │   - UI 面板（#season-pass-panel）注入与刷新                  │
 *   │   - 任务对象（CURRENT_SEASON.tasks）追踪：clears/score/streak │
 *   │   - 任务完成 → 弹 toast、积分 +100、调后端 /api/season-pass    │
 *   │   - STORAGE_KEY = 'openblock_season_pass'（任务/积分/UI 状态）│
 *   ├─────────────────────────────────────────────────────────────┤
 *   │  monetization/seasonPass.js                                 │
 *   │   - XP / Tier 解锁后端：FREE_TIERS / PAID_TIERS              │
 *   │   - 监听 MonetizationBus 'game_over' 估算 XP，写钱包奖励       │
 *   │   - STORAGE_KEY = 'openblock_mon_season_v1'（XP/tier 状态）   │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * 数据流（合并后）：
 *   recordEvent → 任务进度更新（本文件）+ addSeasonXp（monetization 版本）
 *   game_over   → addSeasonXp（monetization 版本）+ 任务计数（本文件 _bindEvents）
 *
 * 这样两个文件不再"双源不同步"，而是各自负责一半（UI vs XP/tier）但输入对齐。
 *
 * 使用方式
 * -------
 *   import { initSeasonPass } from './seasonPass.js';
 *   initSeasonPass(game);
 */

import { addSeasonXp as addMonSeasonXp } from './monetization/seasonPass.js';

const STORAGE_KEY = 'openblock_season_pass';

/* P2-1：把任务进度增量映射成 XP 增量，喂进 monetization 版的 addSeasonXp，
 * 保证 tier 解锁不再依赖 game_over 时序。 */
const TASK_TYPE_TO_XP = Object.freeze({
    clears: 5,        // 每次消行 5 XP
    games: 30,        // 每局结束 30 XP
    levels_done: 50,  // 每完成一关 50 XP
    score_once: 0,    // 单局得分仅为里程碑，不重复发 XP（避免双重计算）
    streak_days: 0,   // 连签由专门的奖励逻辑处理
});

// ── 赛季配置（上线时替换） ───────────────────────────────────────────────────
const CURRENT_SEASON = {
    id: 'S1',
    name: '第一赛季 · 方块觉醒',
    startTs: new Date('2026-04-01').getTime(),
    endTs:   new Date('2026-06-30').getTime(),
    tasks: [
        { id: 't1', label: '累计消除 100 行',    type: 'clears',      target: 100,  reward: '金色方块皮肤' },
        { id: 't2', label: '单局得分超过 2000',   type: 'score_once',  target: 2000, reward: '额外复活 ×1' },
        { id: 't3', label: '连续游玩 7 天',       type: 'streak_days', target: 7,    reward: '赛季专属徽章' },
        { id: 't4', label: '完成 5 个关卡',       type: 'levels_done', target: 5,    reward: '彩虹皮肤解锁' },
        { id: 't5', label: '累计游玩 50 局',      type: 'games',       target: 50,   reward: '赛季点数 ×200' },
    ],
};

export class SeasonPass {
    constructor() {
        this._season  = CURRENT_SEASON;
        this._data    = this._load();
        this._game    = null;
        this._panelEl = null;
    }

    // ── 公开 API ──────────────────────────────────────────────────────────────

    init(game) {
        this._game = game;
        this._ensureData();
        this._injectPanel();
        this._bindEvents(game);
        // 异步拉取服务端进度并合并（不阻塞初始化）
        setTimeout(() => this._syncFromBackend(), 1500);
    }

    /** 是否付费通行证 */
    get isPremium() { return this._data.premium ?? false; }

    /** 当前赛季是否有效 */
    get isActive() {
        const now = Date.now();
        return now >= this._season.startTs && now <= this._season.endTs;
    }

    /** 赛季剩余天数 */
    get daysLeft() {
        return Math.max(0, Math.ceil((this._season.endTs - Date.now()) / 86_400_000));
    }

    /** 记录事件（由 game.js 在关键节点调用） */
    recordEvent(type, value = 1) {
        if (!this.isActive) return;
        const data = this._data;
        switch (type) {
            case 'clears':      data.progress.clears      = (data.progress.clears      ?? 0) + value; break;
            case 'score_once':  data.progress.score_once  = Math.max(data.progress.score_once ?? 0, value); break;
            case 'games':       data.progress.games       = (data.progress.games       ?? 0) + 1; break;
            case 'levels_done': data.progress.levels_done = (data.progress.levels_done ?? 0) + value; break;
            case 'streak_days': data.progress.streak_days = value; break;
        }
        this._checkTaskCompletion();
        this._save();
        this._refreshPanel();

        /* P2-1：把任务进度同步成 XP 给 monetization/seasonPass，让 tier 解锁
         * 不再单独依赖 game_over 估算（与 game.js 的 logBehavior 时序解耦）。 */
        try {
            const xp = (TASK_TYPE_TO_XP[type] ?? 0) * (Math.max(1, value) | 0);
            if (xp > 0) addMonSeasonXp(xp);
        } catch { /* monetization 模块不可用时静默 */ }
    }

    // ── 内部实现 ──────────────────────────────────────────────────────────────

    _ensureData() {
        const d = this._data;
        if (!d.seasonId || d.seasonId !== this._season.id) {
            // 新赛季：重置进度
            this._data = {
                seasonId: this._season.id,
                premium: d.premium ?? false,     // 保留付费状态
                progress: {},
                completed: [],
                points: d.points ?? 0,
                purchasedAt: d.purchasedAt ?? null,
            };
            this._save();
        }
    }

    _checkTaskCompletion() {
        const { tasks } = this._season;
        const { progress, completed } = this._data;
        tasks.forEach(task => {
            if (completed.includes(task.id)) return;
            const prog = progress[task.type] ?? 0;
            if (prog >= task.target) {
                completed.push(task.id);
                this._data.points = (this._data.points ?? 0) + 100;
                // 通知 game 展示奖励 Toast
                this._game?.showProgressionToast?.('赛季任务完成', `<div>${task.label} · 奖励：${task.reward}</div>`);
            }
        });
    }

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch { return {}; }
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data));
        } catch { /* ignore */ }
        // 异步同步到后端（不阻塞本地逻辑）
        this._syncToBackend();
    }

    /** 从后端拉取并与本地合并（本地优先：completed 取并集，points 取最大） */
    async _syncFromBackend() {
        try {
            const userId = this._game?.db?.userId;
            if (!userId) return;
            const res = await fetch(`/api/season-pass?user_id=${encodeURIComponent(userId)}&season_id=${this._season.id}`);
            if (!res.ok) return;
            const remote = await res.json();
            if (!remote.exists) return;
            // 合并：completed 取并集
            const localCompleted = new Set(this._data.completed ?? []);
            (remote.completed ?? []).forEach(id => localCompleted.add(id));
            this._data.completed = [...localCompleted];
            // 合并：progress 取各字段最大值
            const rp = remote.progress ?? {};
            const lp = this._data.progress ?? {};
            const merged = { ...rp };
            for (const k of Object.keys(lp)) {
                merged[k] = Math.max(merged[k] ?? 0, lp[k] ?? 0);
            }
            this._data.progress = merged;
            // 积分取最大
            this._data.points = Math.max(this._data.points ?? 0, remote.points ?? 0);
            // 付费状态以远端为准
            if (remote.premium) this._data.premium = true;
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this._data)); } catch { /* ignore */ }
            this._refreshPanel();
        } catch { /* 离线时静默 */ }
    }

    /** 将本地进度推送到后端 */
    async _syncToBackend() {
        try {
            const userId = this._game?.db?.userId;
            if (!userId) return;
            await fetch('/api/season-pass', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    ...this._data,
                }),
            });
        } catch { /* 离线时静默 */ }
    }

    _injectPanel() {
        if (document.getElementById('season-pass-panel')) return;
        this._injectStyles();

        const panel = document.createElement('div');
        panel.id = 'season-pass-panel';
        panel.className = 'season-pass-panel';
        panel.innerHTML = this._buildPanelHTML();
        document.body.appendChild(panel);

        // 关闭按钮
        panel.querySelector('.sp-close')?.addEventListener('click', () => {
            panel.classList.remove('sp-open');
        });

        // 购买付费通行证
        panel.querySelector('.sp-buy-btn')?.addEventListener('click', () => this._handlePurchase());

        this._panelEl = panel;
    }

    _buildPanelHTML() {
        const s = this._season;
        const d = this._data;
        const tasksHtml = s.tasks.map(task => {
            const done = d.completed?.includes(task.id);
            const prog = Math.min(d.progress?.[task.type] ?? 0, task.target);
            const pct  = Math.round((prog / task.target) * 100);
            return `
<div class="sp-task ${done ? 'sp-task--done' : ''}">
  <div class="sp-task-info">
    <span class="sp-task-label">${task.label}</span>
    <span class="sp-task-reward">${done ? '✓ 已完成' : task.reward}</span>
  </div>
  <div class="sp-task-bar"><div class="sp-task-fill" style="width:${pct}%"></div></div>
  <div class="sp-task-prog">${prog} / ${task.target}</div>
</div>`;
        }).join('');

        const premiumBadge = d.premium
            ? `<span class="sp-premium-badge">💎 高级通行证</span>`
            : `<button class="sp-buy-btn btn btn-primary" type="button">升级高级通行证</button>`;

        return `
<div class="sp-header">
  <div class="sp-title">
    <span class="sp-season-icon">🏆</span>
    <span>${s.name}</span>
  </div>
  <div class="sp-meta">
    <span>剩余 ${this.daysLeft} 天</span>
    <span class="sp-points">积分 ${d.points ?? 0}</span>
    ${premiumBadge}
  </div>
  <button class="sp-close" type="button" aria-label="关闭">×</button>
</div>
<div class="sp-tasks">${tasksHtml}</div>`;
    }

    _refreshPanel() {
        if (!this._panelEl) return;
        const tasksContainer = this._panelEl.querySelector('.sp-tasks');
        if (tasksContainer) {
            tasksContainer.innerHTML = this._season.tasks.map(task => {
                const done = this._data.completed?.includes(task.id);
                const prog = Math.min(this._data.progress?.[task.type] ?? 0, task.target);
                const pct  = Math.round((prog / task.target) * 100);
                return `
<div class="sp-task ${done ? 'sp-task--done' : ''}">
  <div class="sp-task-info">
    <span class="sp-task-label">${task.label}</span>
    <span class="sp-task-reward">${done ? '✓ 已完成' : task.reward}</span>
  </div>
  <div class="sp-task-bar"><div class="sp-task-fill" style="width:${pct}%"></div></div>
  <div class="sp-task-prog">${prog} / ${task.target}</div>
</div>`;
            }).join('');
        }
        // 更新积分
        const pointsEl = this._panelEl.querySelector('.sp-points');
        if (pointsEl) pointsEl.textContent = `积分 ${this._data.points ?? 0}`;
    }

    async _handlePurchase() {
        try {
            const { adAdapter } = await import('./monetization/adAdapter.js').catch(() => ({}));
            if (adAdapter?.purchaseSeasonPass) {
                const ok = await adAdapter.purchaseSeasonPass(this._season.id);
                if (ok) {
                    this._data.premium = true;
                    this._data.purchasedAt = Date.now();
                    this._save();
                    this._game?.showProgressionToast?.('高级通行证已解锁', '<div>感谢支持！专属奖励已激活</div>');
                    this._panelEl.innerHTML = this._buildPanelHTML();
                    return;
                }
            }
        } catch { /* ignore */ }
        // 未接入时给予提示
        alert('付费功能即将上线，敬请期待！');
    }

    /** 打开/关闭面板 */
    toggle() {
        this._panelEl?.classList.toggle('sp-open');
        if (this._panelEl?.classList.contains('sp-open')) {
            this._refreshPanel();
        }
    }

    _bindEvents(game) {
        // 监听游戏事件更新赛季进度
        const orig = game.endGame?.bind(game);
        if (orig) {
            game.endGame = async (opts = {}) => {
                const result = await orig(opts);
                if (opts.mode !== 'level-fail') {
                    this.recordEvent('games');
                    if (game.score > 0) this.recordEvent('score_once', game.score);
                }
                if (opts.mode === 'level') this.recordEvent('levels_done');
                return result;
            };
        }
    }

    _injectStyles() {
        if (document.getElementById('season-pass-styles')) return;
        const style = document.createElement('style');
        style.id = 'season-pass-styles';
        style.textContent = `
.season-pass-panel {
    /* v1.51 盘面居中：消费全站统一的 --game-panel-overlay-center-x/y 变量
     * （由 game.js _syncBoardOverlayMetrics() 通过 ResizeObserver + window.resize
     * 自动维护，与 .checkin-card / .chest-card / .wheel-card / .lore-card / .fdp-card
     * / .wbp-card / .rap-card / .pd-card / .yr-card / .apd-card 同口径），
     * 退化到 --board-overlay-center-* 再退化到视口 50%。不再自维护 anchor。 */
    display: none;
    position: fixed;
    top: var(--game-panel-overlay-center-y, var(--board-overlay-center-y, 50vh));
    left: var(--game-panel-overlay-center-x, var(--board-overlay-center-x, 50vw));
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px)); max-height: min(80vh, calc(100vh - 32px));
    background: var(--stat-surface, #fff);
    border: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 12%, transparent);
    border-radius: 16px;
    box-shadow: 0 12px 40px rgba(0,0,0,.22), 0 4px 12px rgba(0,0,0,.10);
    z-index: 1500; overflow-y: auto;
    flex-direction: column;
}
.season-pass-panel.sp-open { display: flex; }
.sp-header {
    padding: 14px 16px 10px;
    border-bottom: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 8%, transparent);
    position: relative;
}
.sp-title { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; margin-bottom: 6px; }
.sp-season-icon { font-size: 18px; }
.sp-meta { display: flex; align-items: center; gap: 10px; font-size: 11px; color: var(--text-secondary, #64748b); flex-wrap: wrap; }
.sp-points { font-weight: 600; color: var(--accent-color, #5B9BD5); }
.sp-premium-badge { background: linear-gradient(135deg,#f59e0b,#d97706); color:#fff; padding:2px 8px; border-radius:10px; font-size:10px; font-weight:700; }
.sp-buy-btn { font-size: 10px !important; padding: 3px 10px !important; }
.sp-close { position: absolute; top: 10px; right: 12px; background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-secondary, #64748b); }
.sp-tasks { padding: 10px 16px 20px; display: flex; flex-direction: column; gap: 10px; }
.sp-task { padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--text-primary, #1e293b) 4%, transparent); border: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 8%, transparent); }
.sp-task--done { opacity: .65; }
.sp-task-info { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 5px; }
.sp-task-label { font-size: 12px; font-weight: 600; }
.sp-task-reward { font-size: 10px; color: var(--accent-color, #5B9BD5); }
.sp-task-bar { height: 4px; background: color-mix(in srgb, var(--text-primary, #1e293b) 10%, transparent); border-radius: 2px; margin-bottom: 3px; }
.sp-task-fill { height: 100%; background: linear-gradient(90deg, var(--accent-color, #5B9BD5), var(--accent-dark, #4472C4)); border-radius: 2px; transition: width .3s; }
.sp-task-prog { font-size: 9px; color: var(--text-secondary, #64748b); text-align: right; }
`;
        document.head.appendChild(style);
    }
}

let _instance = null;

export function initSeasonPass(game) {
    _instance = new SeasonPass();
    _instance.init(game);
    return _instance;
}

function _getSeasonPass() { return _instance; }
export function toggleSeasonPass() { _instance?.toggle(); }
