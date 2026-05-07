/**
 * 每日任务系统（OPT-03）
 *
 * 设计：
 *   - 3 个任务每日刷新（根据 date 校验，非 24h 计时）
 *   - 进度存入 localStorage，与 game 逻辑完全解耦
 *   - 通过 MonetizationBus 订阅游戏事件驱动进度
 *   - 完成任务时广播 'daily_task_complete' 事件
 */

import { getFlag } from './featureFlags.js';
import { on, emit } from './MonetizationBus.js';
import { getWallet } from '../skills/wallet.js';

const STORAGE_KEY = 'openblock_mon_daily_tasks_v1';

function _todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 任务定义 */
export const TASK_DEFS = [
    {
        id: 'clear_5',
        label: '消行 5 次',
        desc: '在任意模式下消行，累计 5 次',
        reward: { xp: 30, hintTokens: 1 },
        trackEvent: 'clear',
        trackField: 'linesCleared',
        target: 5,
        icon: '🧹',
    },
    {
        id: 'play_1',
        label: '完成 1 局',
        desc: '完成任意一局游戏',
        reward: { xp: 20 },
        trackEvent: 'game_over',
        trackCount: true,
        target: 1,
        icon: '🎮',
    },
    {
        id: 'combo_3',
        label: '一次消 3 行',
        desc: '一次落子消除 3 行或以上',
        trackEvent: 'clear',
        trackField: 'linesCleared',
        trackMinField: 3,
        trackCount: true,
        target: 1,
        reward: { xp: 40, hintTokens: 2 },
        icon: '⚡',
    },
];

function _loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return { date: '', progress: {}, completed: {} };
}

function _saveState(state) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch { /* ignore */ }
}

function _ensureToday(state) {
    const today = _todayYmd();
    if (state.date !== today) {
        state.date = today;
        state.progress = {};
        state.completed = {};
    }
    return state;
}

/** 获取今日任务进度列表 */
export function getDailyTasksStatus() {
    const state = _ensureToday(_loadState());
    return TASK_DEFS.map((def) => ({
        ...def,
        progress: state.progress[def.id] ?? 0,
        completed: Boolean(state.completed[def.id]),
    }));
}

/** 获取今日已完成数量 */
export function getDailyCompletedCount() {
    const state = _ensureToday(_loadState());
    return TASK_DEFS.filter((d) => state.completed[d.id]).length;
}

/** 内部：处理一个游戏事件，返回新完成的任务列表 */
function _processEvent(eventType, data) {
    const state = _ensureToday(_loadState());
    const newlyCompleted = [];

    for (const def of TASK_DEFS) {
        if (state.completed[def.id]) continue;
        if (def.trackEvent !== eventType) continue;

        let increment = 0;
        if (def.trackField) {
            const fieldVal = Number(data?.[def.trackField] ?? 0);
            if (def.trackMinField !== undefined) {
                // 满足最小值才计数（如 linesCleared >= 3）
                if (fieldVal >= def.trackMinField) {
                    increment = def.trackCount ? 1 : fieldVal;
                }
            } else {
                increment = fieldVal;
            }
        } else if (def.trackCount) {
            increment = 1;
        }

        if (increment > 0) {
            state.progress[def.id] = (state.progress[def.id] ?? 0) + increment;
            if (state.progress[def.id] >= def.target) {
                state.completed[def.id] = true;
                newlyCompleted.push(def);
            }
        }
    }

    _saveState(state);
    return newlyCompleted;
}

/** 初始化：订阅总线事件 */
export function initDailyTasks() {
    if (!getFlag('dailyTasks')) return;

    const TRACKED_EVENTS = new Set(TASK_DEFS.map((d) => d.trackEvent));

    for (const evt of TRACKED_EVENTS) {
        on(evt, ({ data }) => {
            const completed = _processEvent(evt, data);
            for (const def of completed) {
                /* v1.13：之前任务完成只 toast 不发钱包 —— TASK_DEFS 里写了
                 * `reward: { hintTokens: 1 }` 但从未真正入账。这里补齐发奖路径，
                 * source 用 `daily-task-${id}` 让钱包流水面板能聚类显示。
                 * xp 仍交由 progression 在 game_over 时通过其它路径累加，不重复发放。 */
                _grantDailyTaskReward(def);
                emit('daily_task_complete', { task: def });
                _showTaskCompleteToast(def);
            }
        });
    }
}

/**
 * 把 TASK_DEFS[i].reward 中的钱包类奖励发放到 wallet。
 * 仅认可 wallet KINDS 已知的 token / coin 字段，xp 不在钱包里。
 */
function _grantDailyTaskReward(def) {
    const reward = def?.reward || {};
    const source = `daily-task-${def.id}`;
    try {
        const w = getWallet();
        if (reward.hintTokens) w.addBalance('hintToken', reward.hintTokens | 0, source);
        if (reward.undoTokens) w.addBalance('undoToken', reward.undoTokens | 0, source);
        if (reward.bombTokens) w.addBalance('bombToken', reward.bombTokens | 0, source);
        if (reward.coin) w.addBalance('coin', reward.coin | 0, source);
        if (reward.fragment) w.addBalance('fragment', reward.fragment | 0, source);
    } catch (e) {
        console.warn('[dailyTasks] reward grant failed', e);
    }
}

/** 任务完成提示（轻量 Toast） */
function _showTaskCompleteToast(def) {
    if (typeof document === 'undefined') return;
    const el = document.createElement('div');
    el.className = 'mon-toast mon-task-toast';
    el.innerHTML = `
        <span class="mon-toast-icon">${def.icon}</span>
        <span>每日任务完成：${def.label}</span>
        ${def.reward?.xp ? `<span class="mon-toast-xp">+${def.reward.xp} XP</span>` : ''}`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('mon-toast-visible'), 10);
    setTimeout(() => { el.classList.remove('mon-toast-visible'); setTimeout(() => el.remove(), 400); }, 3500);
}
