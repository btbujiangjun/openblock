/**
 * MiniGoals — 局间小目标系统
 *
 * 设计目标
 * --------
 * 主要服务于 A 类轻度休闲玩家（sessionTrend 不稳定，无明确目标感）。
 * 每完成 3–5 局后生成一个新的短期目标，提供明确的「下一步做什么」锚点，
 * 从而改善首周留存。
 *
 * 目标类型
 * --------
 *   score_target   单局得分超过 N
 *   clear_lines    单局消除 N 行
 *   combo          单局达成 N 连消
 *   survival       单局撑过 N 轮
 *   place_shapes   单局放置 N 个方块
 *
 * 难度自适应
 * ----------
 * 目标难度根据 PlayerProfile.skillLevel 动态调整：
 *   skillLevel < 0.35  → easy 难度参数
 *   skillLevel 0.35~0.65 → normal
 *   skillLevel > 0.65  → hard（自动降频，不干扰高技能玩家）
 *
 * 使用方式
 * --------
 *   import { initMiniGoals } from './miniGoals.js';
 *   initMiniGoals(game);
 */

const STORAGE_KEY = 'openblock_mini_goals';

/* v1.13：每档难度对应的钱包奖励包（之前 GOAL_TEMPLATES 没有 reward，
 * 完成只是弹一个 toast，玩家拿不到任何实际激励）。
 * 难度阶梯：easy → 1 hint；normal → 1 hint + 50 coin；hard → 2 hint + 100 coin。
 * 数额刻意压低，避免与签到/宝箱叠加触发 wallet 的每日发放上限。 */
const GOAL_REWARDS_BY_TIER = {
    easy:   { hintToken: 1 },
    normal: { hintToken: 1, coin: 50 },
    hard:   { hintToken: 2, coin: 100 },
};

// ── 目标模板（按难度分组） ──────────────────────────────────────────────────
const GOAL_TEMPLATES = {
    easy: [
        { type: 'score_target',  label: '单局得分 {n} 分',   n: 300,  icon: '🎯' },
        { type: 'clear_lines',   label: '消除 {n} 行',       n: 3,    icon: '✨' },
        { type: 'place_shapes',  label: '放置 {n} 个方块',   n: 20,   icon: '🧩' },
        { type: 'survival',      label: '撑过 {n} 轮',       n: 8,    icon: '🛡️' },
    ],
    normal: [
        { type: 'score_target',  label: '单局得分 {n} 分',   n: 800,  icon: '🎯' },
        { type: 'clear_lines',   label: '消除 {n} 行',       n: 8,    icon: '✨' },
        { type: 'combo',         label: '达成 {n} 连消',     n: 2,    icon: '🔥' },
        { type: 'place_shapes',  label: '放置 {n} 个方块',   n: 40,   icon: '🧩' },
        { type: 'survival',      label: '撑过 {n} 轮',       n: 15,   icon: '🛡️' },
    ],
    hard: [
        { type: 'score_target',  label: '单局得分 {n} 分',   n: 1800, icon: '🎯' },
        { type: 'clear_lines',   label: '消除 {n} 行',       n: 18,   icon: '✨' },
        { type: 'combo',         label: '达成 {n} 连消',     n: 3,    icon: '🔥' },
        { type: 'survival',      label: '撑过 {n} 轮',       n: 25,   icon: '🛡️' },
    ],
};

// 每 N 局刷新一次目标
const REFRESH_EVERY_MIN = 3;
const REFRESH_EVERY_MAX = 5;

class MiniGoalManager {
    constructor() {
        this._data   = this._load();
        this._game   = null;
        this._badgeEl = null;
        this._currentGoal = null;
    }

    // ── 公开 API ──────────────────────────────────────────────────────────────

    init(game) {
        this._game = game;
        this._injectUI();
        this._maybeRefreshGoal();
        this._refreshUI();
    }

    /** 局末调用：记录进度，判断完成，可能刷新目标 */
    onGameEnd(gameStats) {
        const goal = this._currentGoal;
        if (!goal || goal.done) return;

        const prog = this._measureProgress(goal, gameStats);
        if (prog >= goal.target) {
            goal.done = true;
            goal.completedAt = Date.now();
            this._data.completed = (this._data.completed ?? 0) + 1;
            this._data.gamesThisCycle = 0;   // 立即可能刷新下一个
            // v1.13：之前小目标完成只 toast，不发任何东西。
            // 现在按 goal.tier 把 hint/coin 真正写入钱包，source 用 mini-goal-${type} 便于流水回溯。
            this._grantReward(goal);
            this._showCompletionToast(goal);
            this._save();
            // 下一局给新目标
            setTimeout(() => this._maybeRefreshGoal(), 200);
        } else {
            this._data.gamesThisCycle = (this._data.gamesThisCycle ?? 0) + 1;
            this._save();
            this._maybeRefreshGoal();
        }
        this._refreshUI();
    }

    /** 局内实时更新（消行、combo 等事件触发） */
    onClear(linesCleared, comboCount) {
        const goal = this._currentGoal;
        if (!goal || goal.done) return;
        if (goal.type === 'clear_lines') {
            goal._sessionProgress = (goal._sessionProgress ?? 0) + linesCleared;
        } else if (goal.type === 'combo' && comboCount >= goal.target) {
            goal._sessionProgress = comboCount;
        }
        this._refreshUI();
    }

    // ── 内部实现 ──────────────────────────────────────────────────────────────

    _maybeRefreshGoal() {
        const cycles = this._data.gamesThisCycle ?? 0;
        const threshold = this._data.nextRefreshAt ?? REFRESH_EVERY_MIN;

        // 高技能玩家（B/C/E 类）不强制推小目标
        const seg = this._game?.playerProfile?.segment5 ?? 'A';
        if (seg === 'B' || seg === 'C' || seg === 'E') return;

        if (!this._currentGoal || this._currentGoal.done || cycles >= threshold) {
            this._data.gamesThisCycle = 0;
            this._data.nextRefreshAt = REFRESH_EVERY_MIN + Math.floor(Math.random() * (REFRESH_EVERY_MAX - REFRESH_EVERY_MIN + 1));
            this._currentGoal = this._generateGoal();
            this._data.current = this._currentGoal;
            this._save();
        }
    }

    _generateGoal() {
        const skill = this._game?.playerProfile?.skillLevel ?? 0.3;
        const tier = skill < 0.35 ? 'easy' : skill < 0.65 ? 'normal' : 'hard';
        const pool = GOAL_TEMPLATES[tier];
        const tpl  = pool[Math.floor(Math.random() * pool.length)];
        return {
            ...tpl,
            label: tpl.label.replace('{n}', tpl.n),
            target: tpl.n,
            tier,                                                // v1.13：保存到 goal，发奖按 tier 取对应 reward
            reward: { ...(GOAL_REWARDS_BY_TIER[tier] ?? {}) },
            _sessionProgress: 0,
            done: false,
            createdAt: Date.now(),
        };
    }

    /**
     * v1.13：把 goal.reward 中的钱包奖励真正写入 wallet。
     * 兼容老存档（无 tier/reward 字段时按 normal 兜底，避免老用户突然收不到）。
     */
    _grantReward(goal) {
        const tier = goal?.tier || 'normal';
        const reward = goal?.reward ?? GOAL_REWARDS_BY_TIER[tier] ?? {};
        if (!reward || typeof window === 'undefined' || !window.__wallet) return;
        const w = window.__wallet;
        const source = `mini-goal-${goal?.type || 'unknown'}`;
        try {
            for (const [kind, amount] of Object.entries(reward)) {
                if (!amount) continue;
                w.addBalance(kind, amount | 0, source);
            }
        } catch (e) {
            console.warn('[miniGoals] reward grant failed', e);
        }
    }

    _measureProgress(goal, gameStats) {
        switch (goal.type) {
            case 'score_target':  return gameStats.score     ?? 0;
            case 'clear_lines':   return gameStats.clears    ?? 0;
            case 'place_shapes':  return gameStats.placements ?? 0;
            case 'survival':      return gameStats.rounds    ?? gameStats.placements / 3 | 0;
            case 'combo':         return gameStats.maxCombo  ?? 0;
            default:              return 0;
        }
    }

    _showCompletionToast(goal) {
        this._game?.showProgressionToast?.(
            '小目标完成！',
            `<div>${goal.icon} ${goal.label} · 连续完成 ${this._data.completed} 个</div>`
        );
    }

    // ── UI 注入 ───────────────────────────────────────────────────────────────

    _injectUI() {
        if (document.getElementById('mini-goal-badge')) return;
        this._injectStyles();

        const badge = document.createElement('div');
        badge.id = 'mini-goal-badge';
        badge.className = 'mini-goal-badge';
        badge.setAttribute('role', 'status');
        badge.setAttribute('aria-live', 'polite');

        // 插入到 progression-hud 之后
        const hud = document.getElementById('progression-hud');
        if (hud?.parentNode) {
            hud.parentNode.insertBefore(badge, hud.nextSibling);
        } else {
            document.getElementById('app')?.appendChild(badge);
        }
        this._badgeEl = badge;
    }

    _refreshUI() {
        if (!this._badgeEl) return;
        const goal = this._currentGoal;
        if (!goal) { this._badgeEl.hidden = true; return; }

        // 高技能用户不显示
        const seg = this._game?.playerProfile?.segment5 ?? 'A';
        if (seg === 'B' || seg === 'C' || seg === 'E') {
            this._badgeEl.hidden = true;
            return;
        }

        const pct = Math.min(100, Math.round(((goal._sessionProgress ?? 0) / goal.target) * 100));
        this._badgeEl.hidden = false;
        this._badgeEl.innerHTML = `
<span class="mg-icon">${goal.icon}</span>
<span class="mg-label">${goal.label}</span>
${goal.done
    ? `<span class="mg-done">✓</span>`
    : `<span class="mg-bar"><span class="mg-fill" style="width:${pct}%"></span></span>`
}`;
    }

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            const d = raw ? JSON.parse(raw) : {};
            return d;
        } catch { return {}; }
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                ...this._data,
                current: this._currentGoal,
            }));
        } catch { /* ignore */ }
    }

    _injectStyles() {
        if (document.getElementById('mini-goal-styles')) return;
        const s = document.createElement('style');
        s.id = 'mini-goal-styles';
        s.textContent = `
.mini-goal-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 auto 4px;
    padding: 4px 12px;
    width: fit-content;
    max-width: min(320px, calc(100vw - 24px));
    background: color-mix(in srgb, var(--accent-color, #5B9BD5) 9%, var(--stat-surface, #fff));
    border: 1px solid color-mix(in srgb, var(--accent-color, #5B9BD5) 22%, transparent);
    border-radius: 20px;
    font-size: 10px;
    font-weight: 500;
    color: var(--text-primary, #1e293b);
    box-shadow: 0 1px 3px rgba(0,0,0,.06);
    transition: opacity .2s;
}
.mg-icon { font-size: 12px; flex-shrink: 0; }
.mg-label { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mg-bar {
    flex-shrink: 0;
    width: 48px; height: 4px;
    background: color-mix(in srgb, var(--text-primary, #1e293b) 10%, transparent);
    border-radius: 2px; overflow: hidden;
}
.mg-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent-color, #5B9BD5), var(--accent-dark, #4472C4));
    border-radius: 2px;
    transition: width .3s;
}
.mg-done { color: var(--accent-color, #5B9BD5); font-size: 12px; font-weight: 700; flex-shrink: 0; }
`;
        document.head.appendChild(s);
    }
}

let _instance = null;

export function initMiniGoals(game) {
    _instance = new MiniGoalManager();
    _instance.init(game);
    return _instance;
}

function _getMiniGoals() { return _instance; }
