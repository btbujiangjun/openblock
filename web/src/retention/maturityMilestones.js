/**
 * maturityMilestones.js — 成熟度晋升里程碑
 *
 * 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P2-1：
 *   M0→M1→M2 的三个可解释里程碑（首多消、连续 3 天回访、首活动完成），用于在
 *   UI 上给玩家"我从 X 升到 Y"的明确反馈，并触发 maturity_milestone_complete 事件。
 *
 *   - 不直接计算 SkillScore（那是 playerMaturity 的职责）。
 *   - 只记录"是否已达成"+"何时达成"，幂等可序列化。
 */
import { ANALYTICS_EVENTS } from '../monetization/analyticsTracker.js';

const STORAGE_KEY = 'openblock_maturity_milestones_v1';

/**
 * 三个 M 升级里程碑；id 与 GOLDEN_EVENTS.md 中 maturity_milestone_complete.properties.milestoneId 对齐。
 *   - check 由调用方传入 player snapshot；返回 boolean。
 *   - 顺序固定：M0→M1→M2。M2→M3、M3→M4 留待后续 sprint 扩展。
 */
const MILESTONES = [
    {
        id: 'm0_to_m1_first_multi_clear',
        from: 'M0',
        to: 'M1',
        title_zh: '首次多消',
        description_zh: '在单局内一次性消除 ≥ 2 行/列。',
        check: (snap) => Number(snap?.maxMultiClearInOneStep || 0) >= 2,
    },
    {
        id: 'm1_to_m2_consecutive_3_days',
        from: 'M1',
        to: 'M2',
        title_zh: '连续 3 天回访',
        description_zh: '在最近 7 天里至少有 3 个不同的活跃日。',
        check: (snap) => Number(snap?.activeDaysLast7 || 0) >= 3,
    },
    {
        id: 'm2_to_m3_first_event_complete',
        from: 'M2',
        to: 'M3',
        title_zh: '首次活动完成',
        description_zh: '完成至少 1 个周循环活动。',
        check: (snap) => Number(snap?.weeklyChallengesCompleted || 0) >= 1,
    },
];

let _cache = null;

function _load() {
    if (_cache) return _cache;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            _cache = JSON.parse(raw);
            return _cache;
        }
    } catch {}
    _cache = { completed: {}, history: [] };
    return _cache;
}

function _save() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_cache));
    } catch {}
}

/**
 * 评估玩家当前 snapshot 是否触发新里程碑；触发的会持久化并上报事件。
 *   返回新触发的里程碑数组（已存档的不再返回）。
 */
export function evaluateMilestones(playerSnapshot, { tracker = null, stage = null, band = null } = {}) {
    const state = _load();
    const newlyCompleted = [];
    for (const m of MILESTONES) {
        if (state.completed[m.id]) continue;
        let passed = false;
        try { passed = m.check(playerSnapshot || {}); } catch { passed = false; }
        if (!passed) continue;
        state.completed[m.id] = { at: Date.now(), from: m.from, to: m.to };
        state.history.push({
            id: m.id,
            at: Date.now(),
            from: m.from,
            to: m.to,
            stage,
            band,
        });
        newlyCompleted.push(m);
        try {
            tracker?.trackEvent?.(ANALYTICS_EVENTS.MATURITY_MILESTONE_COMPLETE.name, {
                milestoneId: m.id,
                from: m.from,
                to: m.to,
                stage,
                band,
            });
        } catch {}
    }
    if (newlyCompleted.length) _save();
    return newlyCompleted;
}

export function getMilestoneStatus() {
    const state = _load();
    return MILESTONES.map((m) => ({
        id: m.id,
        from: m.from,
        to: m.to,
        title: m.title_zh,
        description: m.description_zh,
        completed: !!state.completed[m.id],
        completedAt: state.completed[m.id]?.at || null,
    }));
}

/** 仅供测试使用。 */
export function _resetMilestonesForTests() {
    _cache = null;
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

export { MILESTONES as _MILESTONES_FOR_TEST };
