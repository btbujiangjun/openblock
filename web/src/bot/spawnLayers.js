/**
 * spawnLayers.js — 出块算法三层架构
 *
 * 将 blockSpawn.js 中混合的三种关注点显式分离为独立的层对象，
 * 每层只做一件事，便于单独测试和未来扩展（关卡模式可替换任一层）。
 *
 * 层次职责
 * --------
 * FallbackLayer  — 兜底保活：确保三连块中至少有 1 块可以放下，
 *                   同时尽可能提供「趋近消行」的形状（保活 + 可解性）。
 *                   当其他层失败或置信度极低时兜底。
 *
 * LaneLayer      — 泳道混合：根据 spawnHints（combo 链、节奏相位、
 *                   clearGuarantee）对候选块进行筛选/重排，
 *                   实现「setup → payoff」节奏感。
 *
 * GlobalLayer    — 全局调控：结合 spawnContext（局弧线、里程碑、
 *                   跨轮回忆）做全局权重偏移，形状多样性保障。
 *
 * 使用方式（blockSpawn.js 内部调用）
 * -----------------------------------
 *   import { FallbackLayer, LaneLayer, GlobalLayer } from './spawnLayers.js';
 *
 *   // 每层接受 ScoredShape[] 并返回 ScoredShape[]（过滤/重排/补全）
 *   let candidates = scoredAll;
 *   candidates = GlobalLayer.adjust(candidates, spawnContext, hints);
 *   candidates = LaneLayer.filter(candidates, hints);
 *   const triplet = FallbackLayer.pick(candidates, grid, weights);
 *
 * ScoredShape 类型
 * ----------------
 *   { shape: ShapeObj, weight: number, gapFills: number, placements: number,
 *     category: string, reason?: string }
 *
 * 公开 API 稳定性：所有层的静态方法签名不随内部实现变化。
 */

import { pickShapeByCategoryWeights, getShapeCategory } from '../shapes.js';

// ========================================================================
// FallbackLayer — 兜底保活层
// ========================================================================

/**
 * 确保候选集内至少有能放下的块，不足时从权重池补入。
 * 始终返回 ≥ 3 个候选（可能有重复 id，由上层去重）。
 *
 * @param {object[]} scored    已打分候选列表
 * @param {object}   grid      当前棋盘
 * @param {object}   weights   shapeWeights（品类 → 权重）
 * @param {number}   [minGuarantee=1] 至少保证几个可放块
 * @returns {object[]} 补全后的候选列表
 */
export const FallbackLayer = {
    /**
     * @param {object[]} scored
     * @param {object}   grid
     * @param {object}   weights
     * @param {number}   [minGuarantee]
     */
    ensure(scored, grid, weights, minGuarantee = 1) {
        // 计算可放置数量
        const placeable = scored.filter(s => s.placements > 0);
        if (placeable.length >= minGuarantee) return scored;

        // 从全量形状池中补入可放的块
        const supplemented = [...scored];
        let tries = 0;
        while (supplemented.filter(s => s.placements > 0).length < minGuarantee && tries++ < 30) {
            const shape = pickShapeByCategoryWeights(weights);
            if (!shape) break;
            const placements = _countLegalPlacements(grid, shape.data);
            if (placements > 0) {
                supplemented.push({
                    shape,
                    weight: 0.5,
                    gapFills: 0,
                    placements,
                    category: getShapeCategory(shape.id),
                    reason: 'fallback_ensure',
                });
            }
        }
        return supplemented;
    },

    /**
     * 从候选中选出 3 个，优先保证至少 1 个可放置。
     * 若 gapFills > 0 的块存在，第一个槽优先放 gap-filler。
     *
     * @param {object[]} candidates
     * @returns {object[]} 最终三连块（shapes 数组）
     */
    pick(candidates) {
        const blocks = [];
        const usedIds = new Set();

        // 优先放一个能消行的块（gap-filler）
        const gapFillers = candidates.filter(s => s.gapFills > 0 && !usedIds.has(s.shape.id));
        if (gapFillers.length > 0) {
            blocks.push(gapFillers[0].shape);
            usedIds.add(gapFillers[0].shape.id);
        }

        // 剩余槽位按权重填充
        let rem = candidates.filter(s => !usedIds.has(s.shape.id));
        while (blocks.length < 3 && rem.length > 0) {
            const pick = _pickWeighted(rem);
            blocks.push(pick.shape);
            usedIds.add(pick.shape.id);
            rem = rem.filter(s => !usedIds.has(s.shape.id));
        }

        return blocks.slice(0, 3);
    },
};

// ========================================================================
// LaneLayer — 泳道混合层
// ========================================================================

/**
 * 根据 spawnHints 对候选块进行筛选/权重偏移，实现节奏感。
 *
 * hints 字段说明：
 *   clearGuarantee  (0-3)   三连块中至少 N 个能触发即时消行
 *   sizePreference  (-1~1)  负=偏小块，正=偏大块
 *   comboChain      (0~1)   高值 → 偏好能续链的消行块
 *   rhythmPhase     'setup'|'payoff'|'neutral'  节奏相位
 */
export const LaneLayer = {
    /**
     * @param {object[]} candidates  已打分候选
     * @param {object}   hints       spawnHints from adaptiveSpawn.js
     * @returns {object[]} 权重调整后的候选（不改变引用）
     */
    filter(candidates, hints = {}) {
        const {
            clearGuarantee = 0,
            sizePreference = 0,
            comboChain = 0,
            rhythmPhase = 'neutral',
        } = hints;

        return candidates.map(s => {
            let w = s.weight;
            const cells = _shapeCellCount(s.shape.data);

            // 尺寸偏好调整
            if (sizePreference < 0) {
                w *= (1 + sizePreference * (cells / 5));   // 小块加权
            } else if (sizePreference > 0) {
                w *= (1 + sizePreference * (cells / 5) * 0.5);  // 大块加权
            }

            // combo 链强度：提升能触发消行的块权重
            if (comboChain > 0 && s.gapFills > 0) {
                w *= (1 + comboChain * 1.5);
            }

            // 节奏相位：setup 阶段推送大块堆满；payoff 阶段推送消行块
            if (rhythmPhase === 'setup') {
                w *= (1 + Math.max(0, sizePreference) * 0.8);
            } else if (rhythmPhase === 'payoff' && s.gapFills > 0) {
                w *= 1.8;
            }

            // clearGuarantee：确保至少有 N 个能消行的块
            if (clearGuarantee > 0 && s.gapFills === 0) {
                // 在需要保证消行时适度降低非消行块权重
                w *= 0.7;
            }

            return { ...s, weight: Math.max(w, 0.01) };
        });
    },
};

// ========================================================================
// GlobalLayer — 全局调控层
// ========================================================================

/**
 * 结合 spawnContext（局内弧线、里程碑、跨轮记忆）做全局权重偏移。
 *
 * context 字段说明：
 *   sessionArc        'warmup'|'peak'|'cooldown'
 *   scoreMilestone    boolean  刚达到分数里程碑
 *   recentCategories  string[][]  最近 3 轮已出品类
 *   roundsSinceClear  number
 */
export const GlobalLayer = {
    /**
     * @param {object[]} candidates
     * @param {object}   context  spawnContext from game.js
     * @returns {object[]} 调整后的候选
     */
    adjust(candidates, context = {}) {
        const {
            sessionArc = 'peak',
            scoreMilestone = false,
            recentCategories = [],
            roundsSinceClear = 0,
        } = context;

        // 多样性保障：近 3 轮出现过的品类轻微降权，鼓励多样性
        const recentSet = new Set(recentCategories.flat());

        // 长时间无消行 → 增加消行块权重（挫败缓解）
        const frustrationFactor = Math.min(roundsSinceClear / 5, 1);

        return candidates.map(s => {
            let w = s.weight;

            // 里程碑：短暂推送大块制造高峰感
            if (scoreMilestone) {
                const cells = _shapeCellCount(s.shape.data);
                if (cells >= 4) w *= 1.3;
            }

            // 局弧线：热身阶段偏小块，高峰阶段正常，冷却阶段偏大块
            if (sessionArc === 'warmup') {
                const cells = _shapeCellCount(s.shape.data);
                w *= cells <= 3 ? 1.4 : 0.8;
            } else if (sessionArc === 'cooldown') {
                const cells = _shapeCellCount(s.shape.data);
                w *= cells >= 4 ? 1.2 : 0.9;
            }

            // 挫败缓解：长时间无消行时提升消行块权重
            if (frustrationFactor > 0.3 && s.gapFills > 0) {
                w *= (1 + frustrationFactor * 1.5);
            }

            // 多样性：最近出现过的品类轻微降权
            if (recentSet.has(s.category)) {
                w *= 0.85;
            }

            return { ...s, weight: Math.max(w, 0.01) };
        });
    },
};

// ========================================================================
// 内部工具函数
// ========================================================================

function _shapeCellCount(data) {
    let n = 0;
    for (let y = 0; y < data.length; y++)
        for (let x = 0; x < data[y].length; x++)
            if (data[y][x]) n++;
    return n;
}

function _countLegalPlacements(grid, shapeData) {
    let c = 0;
    const n = grid.size;
    for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++)
            if (grid.canPlace(shapeData, x, y)) c++;
    return c;
}

/**
 * 按 weight 加权随机选一个元素
 * @param {Array<{weight: number}>} arr
 */
function _pickWeighted(arr) {
    const total = arr.reduce((s, x) => s + (x.weight || 1), 0);
    let r = Math.random() * total;
    for (const item of arr) {
        r -= item.weight || 1;
        if (r <= 0) return item;
    }
    return arr[arr.length - 1];
}
