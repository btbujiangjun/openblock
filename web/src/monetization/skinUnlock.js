/**
 * 皮肤分级解锁系统（OPT-05）
 *
 * 设计：
 *   - 在 progression.js 的 isSkinUnlocked 之上叠加分级逻辑，不修改其源码
 *   - 通过猴子补丁（运行时覆盖）实现热插拔
 *   - 解锁条件：等级 / 购买 / 积分兑换
 *   - getUnlockStatus(skinId) 返回详细解锁状态
 */

import { getFlag } from './featureFlags.js';
import { getLevelFromTotalXp, loadProgress } from '../progression.js';
import { isPurchased } from './iapAdapter.js';

/**
 * 皮肤解锁规则表
 * type: 'free' | 'level' | 'iap' | 'task_points' | 'season'
 */
export const SKIN_UNLOCK_RULES = {
    default: { type: 'free' },
    classic: { type: 'free' },
    titanium: { type: 'free' },
    forest: { type: 'level', minLevel: 5 },
    neon: { type: 'level', minLevel: 10 },
    ocean: { type: 'level', minLevel: 15 },
    pastel: { type: 'level', minLevel: 20 },
    sakura: { type: 'task_points', points: 100 },
    midnight: { type: 'iap', productId: 'monthly_pass' },
    gold: { type: 'season', seasonMin: 1 },
};

/**
 * 检查皮肤是否已解锁
 * @param {string} skinId
 * @returns {boolean}
 */
export function isSkinUnlocked(skinId) {
    if (!getFlag('skinUnlock')) return true; // 功能关闭时全部开放

    const rule = SKIN_UNLOCK_RULES[skinId];
    if (!rule || rule.type === 'free') return true;

    if (rule.type === 'level') {
        const { totalXp } = loadProgress();
        return getLevelFromTotalXp(totalXp) >= (rule.minLevel ?? 1);
    }

    if (rule.type === 'iap') {
        return isPurchased(rule.productId);
    }

    if (rule.type === 'task_points') {
        const pts = getTaskPoints();
        return pts >= (rule.points ?? 0);
    }

    if (rule.type === 'season') {
        return getCurrentSeason() >= (rule.seasonMin ?? 1);
    }

    return false;
}

/**
 * 获取皮肤详细解锁状态（用于 UI 提示）
 */
export function getUnlockStatus(skinId) {
    const rule = SKIN_UNLOCK_RULES[skinId] ?? { type: 'free' };
    const unlocked = isSkinUnlocked(skinId);

    if (rule.type === 'free') return { unlocked: true, rule, hint: '' };
    if (rule.type === 'level') {
        const { totalXp } = loadProgress();
        const currentLevel = getLevelFromTotalXp(totalXp);
        return {
            unlocked,
            rule,
            hint: unlocked ? '' : `需要达到 Lv.${rule.minLevel}（当前 Lv.${currentLevel}）`,
        };
    }
    if (rule.type === 'iap') {
        return { unlocked, rule, hint: unlocked ? '' : '需要购买月卡解锁' };
    }
    if (rule.type === 'task_points') {
        const pts = getTaskPoints();
        return {
            unlocked,
            rule,
            hint: unlocked ? '' : `需要 ${rule.points} 积分（当前 ${pts}）`,
        };
    }
    if (rule.type === 'season') {
        return { unlocked, rule, hint: unlocked ? '' : '赛季通行证专属皮肤' };
    }
    return { unlocked: false, rule, hint: '未知解锁条件' };
}

/** 读取任务积分（从 localStorage） */
function getTaskPoints() {
    try {
        return Number(localStorage.getItem('openblock_mon_task_points') ?? 0);
    } catch { return 0; }
}

/** 读取当前赛季编号 */
function getCurrentSeason() {
    try {
        const raw = localStorage.getItem('openblock_mon_season_v1');
        if (raw) return JSON.parse(raw).season ?? 0;
    } catch { /* ignore */ }
    return 0;
}
