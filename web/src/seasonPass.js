/**
 * SeasonPass — 赛季通行证框架
 *
 * 功能
 * ----
 * - 维护当前赛季信息（名称、开始/结束时间）
 * - 追踪赛季任务进度与积分
 * - 提供 UI 面板（注入到玩家画像面板旁）
 * - 为 C 类鲸鱼用户提供持续价值供给
 *
 * 商业化接入点
 * -----------
 * - seasonPass.isPremium：区分免费/付费通行证
 * - 付费通行证解锁：调用 adAdapter.purchaseSeasonPass()
 * - 任务完成奖励：皮肤/复活次数/徽章（通过 featureFlags 控制）
 *
 * 使用方式
 * -------
 *   import { initSeasonPass } from './seasonPass.js';
 *   initSeasonPass(game);
 */

const STORAGE_KEY = 'openblock_season_pass';

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
    display: none;
    position: fixed; bottom: 0; left: 50%; transform: translateX(-50%);
    width: min(420px, 100vw); max-height: 70vh;
    background: var(--stat-surface, #fff);
    border: 1px solid color-mix(in srgb, var(--text-primary, #1e293b) 12%, transparent);
    border-bottom: none; border-radius: 16px 16px 0 0;
    box-shadow: 0 -4px 24px rgba(0,0,0,.12);
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

export function getSeasonPass() { return _instance; }
export function toggleSeasonPass() { _instance?.toggle(); }
