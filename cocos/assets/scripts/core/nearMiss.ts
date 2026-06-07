/**
 * 「差一行」near-miss 落子鼓励提示的展示判定。
 *
 * 严格对齐 web 主端 `nearMissPlaceFeedback.js` 的 `shouldShowNearMissPlaceFeedback`：
 * 仅在玩家体感**很差**且本次落子确实**贴到近满线**时，单局**最多 1 次**地给出
 * 「再一格就消行 🎯」鼓励，配合长冷却与落子间隔，宁缺毋滥。
 *
 * 与 web 的信号映射（cocos 侧可得）：
 *   · frustrationLevel ← gameModel.roundsSinceLastClear（连续未消行落子数，语义一致）；
 *   · momentum         ← PlayerContext.momentum()（0..1；>0 表示近期有消行＝顺风）；
 *   · clearRate / flowState：cocos 暂无等价信号——对应分支按「未知」处理（不据此放行），
 *     主放行门槛回落到 frustrationLevel 硬门槛（与 web sufferingHard 同口径）。
 *
 * 阈值常量逐条对齐 web `DEFAULT_CFG`。
 */
import type { NearMissLine } from './types';

export interface NearMissCfg {
    enabled: boolean;
    /** 某行/列填充率下限（8 格盘 7/8=0.875 表示只差 1 格满行）。 */
    minLineFill: number;
    /** 连续未消行落子数硬门槛（web frustrationThreshold，默认 4）。 */
    minFrustrationLevel: number;
    /** 单局最多展示次数。 */
    maxPerSession: number;
    /** 两次提示之间至少间隔的落子数。 */
    minPlacementsBetween: number;
    /** 两次提示之间至少间隔的毫秒。 */
    cooldownMs: number;
    /** 局内前 N 次落子不展示（冷启动期不打扰）。 */
    minPlacementsBeforeFirst: number;
    /** 顺风抑制：动量 ≥ 该值视为正向，直接抑制。 */
    healthyMomentum: number;
}

/** 默认配置（与 web `nearMissPlaceFeedback.js` DEFAULT_CFG 逐条一致）。 */
export const NEAR_MISS_CFG: NearMissCfg = {
    enabled: true,
    minLineFill: 0.875,
    minFrustrationLevel: 4,
    maxPerSession: 1,
    minPlacementsBetween: 12,
    cooldownMs: 30_000,
    minPlacementsBeforeFirst: 12,
    healthyMomentum: 0.05,
};

export interface NearMissInput {
    /** 当前盘面所有 ≥ minLineFill 的近满线（差一格满行）。 */
    nearFullLines: NearMissLine[];
    /** 玩家本次落子贡献的所有格子坐标（盘面坐标系）。 */
    placedCells: Array<{ x: number; y: number }>;
    /** 当前盘面最大单行/列填充率（0..1）。 */
    maxLineFill: number;
    /** 连续未消行落子数（gameModel.roundsSinceLastClear）。 */
    frustrationLevel: number;
    /** 动量（0..1；PlayerContext.momentum()）。 */
    momentum: number;
    /** 本局已展示次数。 */
    toastCount: number;
    /** 上次展示时的 placements 计数。 */
    lastPlacementIndex: number | null;
    /** 当前 placements 计数。 */
    currentPlacementIndex: number;
    /** 上次展示时间戳 ms。 */
    lastShownAt: number | null;
    /** 当前时间戳 ms。 */
    now: number;
    /** 覆盖配置（测试用）。 */
    cfg?: Partial<NearMissCfg>;
}

export interface NearMissDecision {
    show: boolean;
    reason?: string;
    /** 命中的近满线（落子贴到的那条；用于高亮 + 鼓励文案绑定）。 */
    line?: NearMissLine;
}

/** 是否展示「差一行」鼓励（严格对齐 web `shouldShowNearMissPlaceFeedback`）。 */
export function shouldShowNearMiss(input: NearMissInput): NearMissDecision {
    const cfg = { ...NEAR_MISS_CFG, ...(input.cfg ?? {}) };
    if (!cfg.enabled) return { show: false, reason: 'disabled' };

    /* 1) 几何前置：必须真的「差 1 格满行」。 */
    if ((Number(input.maxLineFill) || 0) < cfg.minLineFill) {
        return { show: false, reason: 'line_not_near_full' };
    }

    /* 1.5) 落子-近失线 binding：本次落子至少 1 格落在某条近满线上，
     * 确保「再一格就消行」文案与玩家本次操作直觉绑定，避免与盘面别处脱节。 */
    let matched: NearMissLine | null = null;
    if (input.placedCells.length > 0 && input.nearFullLines.length > 0) {
        for (const line of input.nearFullLines) {
            const hit = input.placedCells.some((c) =>
                line.kind === 'row' ? c.y === line.idx : c.x === line.idx);
            if (hit) { matched = line; break; }
        }
        if (!matched) return { show: false, reason: 'placement_not_on_near_full_line' };
    }

    /* 2) 体感很差才放行——连续未消行落子达硬门槛（web sufferingHard）。 */
    if ((Number(input.frustrationLevel) || 0) < cfg.minFrustrationLevel) {
        return { show: false, reason: 'feel_not_bad_enough' };
    }

    /* 3) 顺风强抑制：近期有消行（动量为正）则不打扰。 */
    if ((Number(input.momentum) || 0) >= cfg.healthyMomentum) {
        return { show: false, reason: 'momentum_positive' };
    }

    /* 4) 控频：局内冷启动 / 单局上限 / 落子间隔 / 时间冷却。 */
    if (input.currentPlacementIndex < cfg.minPlacementsBeforeFirst) {
        return { show: false, reason: 'session_warmup' };
    }
    if ((Number(input.toastCount) || 0) >= cfg.maxPerSession) {
        return { show: false, reason: 'session_cap' };
    }
    if (input.lastPlacementIndex != null
        && input.currentPlacementIndex - input.lastPlacementIndex < cfg.minPlacementsBetween) {
        return { show: false, reason: 'placement_cooldown' };
    }
    if (input.lastShownAt != null && input.now - input.lastShownAt < cfg.cooldownMs) {
        return { show: false, reason: 'time_cooldown' };
    }

    return { show: true, line: matched ?? undefined };
}
