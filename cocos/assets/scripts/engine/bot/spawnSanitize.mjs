/* 自动生成 —— 请勿手改。源：web/src/bot/spawnSanitize.js
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
/**
 * bot/spawnSanitize.js — 出块结果安全网（v1.70 从 blockSpawn.js 抽出）
 *
 * 单一职责：保证最终交付到 dock 的 3 个 shape 中**不含特殊形状**——
 *   - `_pickFallbackSafe`：从 shapeWeights 加权池随机挑一个常规块（无特殊块）
 *   - `_sanitizeShapeArr`：对一组 shape 做原地替换；任何特殊形状被 fallback 替掉，
 *      若 fallback 也无法落盘则在"非特殊 + 可放置"全集中随机挑一个
 *
 * 为何独立成文件（拆分 God Module 第一步）：
 *   - 与 blockSpawn 主管线（generateDockShapes）**完全无词法耦合**，仅依赖
 *     shapes.js 暴露的几何/分类原语，可独立测试
 *   - 模型路径（_spawnBlocksWithModel）与 game.js 防御调用都用到这里，
 *     拆出后职责清晰：『出块算法跑完后清理结果』，而非埋在 4000 行主管线里
 *
 * 随机源：
 *   - `_pickFallbackSafe(weights)` 走 shapes 内部 RNG（向后兼容，默认 Math.random）
 *   - `_sanitizeShapeArr(arr, grid, weights, rng = Math.random)` 接受可选 rng，
 *     daily / replay / A-B 场景由 generateDockShapes 注入 `_rng`，保证全链路可复现
 *
 * **不变式**：mutate input arr in-place；不改变长度；不替换非特殊形状。
 */

import {
    getAllShapes,
    pickShapeByCategoryWeights,
    isSpecialShapeId,
} from '../shapes.mjs';

/** 加权挑一个常规（非特殊）形状；返回 shape 对象或 null。 */
export function _pickFallbackSafe(weights) {
    return pickShapeByCategoryWeights(weights);
}

/**
 * 原地把 arr 中所有特殊形状替换为常规形状。
 *
 * @param {Array<{ id: string, data: number[][] }>} arr 目标 shape 数组
 * @param {{ canPlaceAnywhere: (data: number[][]) => boolean }} grid Grid 实例
 * @param {object} weights shapeWeights（用于 fallback 候选池加权）
 * @param {() => number} [rng=Math.random] 随机源；可注入以支持可复现
 */
export function _sanitizeShapeArr(arr, grid, weights, rng = Math.random) {
    for (let i = 0; i < arr.length; i++) {
        if (isSpecialShapeId(arr[i].id)) {
            const safe = _pickFallbackSafe(weights);
            if (safe && grid.canPlaceAnywhere(safe.data)) {
                arr[i] = safe;
            } else {
                const all = getAllShapes().filter(s => !isSpecialShapeId(s.id) && grid.canPlaceAnywhere(s.data));
                if (all.length > 0) arr[i] = all[Math.floor(rng() * all.length)];
            }
        }
    }
}
