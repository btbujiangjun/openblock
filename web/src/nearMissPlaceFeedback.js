/**
 * 落子未消行时的「几何近失」鼓励 toast 判定（v1.50.1）。
 *
 * 设计原则（产品）：
 * - 文案要短：i18n key effect.nearMissPlace（"再一格就消行" / "One more to clear"）；
 * - 仅在玩家体感**很差**时出现（高挫败 / 焦虑心流 / 强救济信号叠加），顺风局完全不出；
 * - 严格控频：单局**最多 1 次**；落子间隔 + 长冷却 + 心流复位时清零，宁缺毋滥。
 */

import { GAME_RULES } from './gameRules.js';

const DEFAULT_CFG = {
    enabled: true,
    /** 某行/列填充率下限（8 格盘 7/8=0.875 表示只差 1 格满行） */
    minLineFill: 0.875,
    /** 连续未消行步数硬门槛——与 engagement.frustrationThreshold 对齐（默认 4） */
    minFrustrationLevel: 4,
    /** anxious 心流下的"已经在受苦"次门槛——配合 anxious flowState 才放行 */
    minFrustrationWhenAnxious: 2,
    /** 单局最多展示次数（v1.50.1：从 2 降到 1） */
    maxPerSession: 1,
    /** 两次 toast 之间至少间隔的落子数（v1.50.1：从 8 提到 12） */
    minPlacementsBetween: 12,
    /** 两次 toast 之间至少间隔的毫秒（v1.50.1：从 15s 提到 30s） */
    cooldownMs: 30_000,
    /** 局内前 N 次落子不展示——避免冷启动期误打扰 */
    minPlacementsBeforeFirst: 12,
    /** 顺风抑制：clearRate ≥ 该值视为节奏顺畅，直接抑制 */
    healthyClearRate: 0.30,
    /** 顺风抑制：动量为正且 ≥ 该值视为正向，直接抑制 */
    healthyMomentum: 0.05,
};

export function getNearMissPlaceFeedbackCfg() {
    const raw = GAME_RULES.adaptiveSpawn?.nearMissPlaceFeedback ?? {};
    return { ...DEFAULT_CFG, ...raw };
}

/**
 * @param {object} input
 * @param {number} input.maxLineFill 当前盘面 getMaxLineFill()
 * @param {boolean} [input.pendingNoMovesEnd] game over 倒计时中
 * @param {number} [input.frustrationLevel] 连续未消行步数
 * @param {string} [input.flowState] bored | flow | anxious
 * @param {number} [input.momentum] -1~1
 * @param {number} [input.clearRate] 滑动窗口消行率（0~1）
 * @param {number} [input.toastCount] 本局已展示次数
 * @param {number|null} [input.lastPlacementIndex] 上次展示时的 placements 计数
 * @param {number} [input.currentPlacementIndex] 当前 placements 计数
 * @param {number|null} [input.lastShownAt] 上次展示时间戳 ms
 * @param {number} [input.now] 当前时间戳 ms
 * @param {Array<{x:number,y:number}>} [input.placedCells]
 *        v1.51.1：玩家本次落子贡献的所有格子坐标（盘面坐标系）。
 * @param {Array<{type:'row'|'col',index:number,fill:number}>} [input.nearFullLines]
 *        v1.51.1：grid.getMaxLineFillLines() 返回的 ≥ minLineFill 的所有 line。
 *        若提供，必须有 ≥1 个 placedCells 与某 line 重叠才放行（避免"toast 与玩家
 *        本次操作脱节"）。两者中任一缺省则跳过 binding 校验，向后兼容旧调用。
 * @param {object} [input.cfg] 覆盖配置（测试用）
 * @returns {{ show: boolean, reason?: string, line?: {type:'row'|'col',index:number,fill:number} }}
 */
export function shouldShowNearMissPlaceFeedback(input) {
    const cfg = { ...DEFAULT_CFG, ...(input.cfg ?? getNearMissPlaceFeedbackCfg()) };
    if (cfg.enabled === false) return { show: false, reason: 'disabled' };
    if (input.pendingNoMovesEnd) return { show: false, reason: 'no_moves_pending' };

    /* 1) 几何前置：必须真的"差 1 格满行" */
    const maxLineFill = Number(input.maxLineFill) || 0;
    if (maxLineFill < (cfg.minLineFill ?? 0.875)) {
        return { show: false, reason: 'line_not_near_full' };
    }

    /* 1.5) v1.51.1：落子-近失线 binding —— 仅当玩家本次落子至少 1 格落在某条
     * 接近满的 line 上时才放行。这能确保 toast 文案"再一格就消行"与玩家的操作
     * 直觉绑定，避免"刚好盘面别处有 7/8 line / toast 显示期间盘面变化"导致的脱节。
     * 两个入参任一缺省即跳过本步骤（向后兼容旧调用）。 */
    let matchedLine = null;
    if (Array.isArray(input.placedCells) && input.placedCells.length > 0
        && Array.isArray(input.nearFullLines) && input.nearFullLines.length > 0) {
        for (const line of input.nearFullLines) {
            const hit = input.placedCells.some((c) => {
                if (line.type === 'row') return c.y === line.index;
                if (line.type === 'col') return c.x === line.index;
                return false;
            });
            if (hit) {
                matchedLine = line;
                break;
            }
        }
        if (!matchedLine) {
            return { show: false, reason: 'placement_not_on_near_full_line' };
        }
    }

    /* 2) 体感很差才放行——二选一：硬挫败 OR (anxious 心流 + 中等挫败) */
    const frustration = Number(input.frustrationLevel) || 0;
    const flowState = input.flowState ?? 'flow';
    const momentum = Number(input.momentum) || 0;
    const clearRate = Number(input.clearRate) || 0;

    const sufferingHard = frustration >= (cfg.minFrustrationLevel ?? 4);
    const anxiousAndSuffering = flowState === 'anxious'
        && frustration >= (cfg.minFrustrationWhenAnxious ?? 2);

    if (!(sufferingHard || anxiousAndSuffering)) {
        return { show: false, reason: 'feel_not_bad_enough' };
    }

    /* 3) 顺风强抑制：节奏顺畅 / 动量为正 / 非焦虑心流 任一成立都不打扰 */
    if (clearRate >= (cfg.healthyClearRate ?? 0.30)) {
        return { show: false, reason: 'clear_rate_healthy' };
    }
    if (momentum >= (cfg.healthyMomentum ?? 0.05)) {
        return { show: false, reason: 'momentum_positive' };
    }
    if (flowState === 'flow' && frustration < (cfg.minFrustrationLevel ?? 4)) {
        return { show: false, reason: 'player_in_flow' };
    }

    /* 4) 控频：局内冷启动 / 单局上限 / 落子间隔 / 时间冷却 */
    const currentPlacement = Number(input.currentPlacementIndex) || 0;
    if (currentPlacement < (cfg.minPlacementsBeforeFirst ?? 12)) {
        return { show: false, reason: 'session_warmup' };
    }
    const toastCount = Number(input.toastCount) || 0;
    if (toastCount >= (cfg.maxPerSession ?? 1)) {
        return { show: false, reason: 'session_cap' };
    }
    const lastPlacement = input.lastPlacementIndex;
    const minBetween = cfg.minPlacementsBetween ?? 12;
    if (lastPlacement != null && currentPlacement - lastPlacement < minBetween) {
        return { show: false, reason: 'placement_cooldown' };
    }
    const lastShownAt = input.lastShownAt;
    const now = input.now ?? Date.now();
    const cooldownMs = cfg.cooldownMs ?? 30_000;
    if (lastShownAt != null && now - lastShownAt < cooldownMs) {
        return { show: false, reason: 'time_cooldown' };
    }

    return { show: true, line: matchedLine };
}
