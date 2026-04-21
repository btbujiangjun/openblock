/**
 * blockPool.js — 块池管理模块
 *
 * 解决"无块池管理"问题：原始出块算法不跟踪形状的"新鲜度"，
 * 可能连续出现相同形状，降低策略多样性和感知公平感。
 *
 * 设计原则
 * --------
 * - 零侵入：不修改 blockSpawn.js 核心逻辑，以"包装器"模式接入
 * - 透明代理：BlockPool.wrap(generateFn) 返回同签名函数，随时可替换回原始函数
 * - 两级新鲜度保障：
 *     局内窗口（recentWindow）：对同一局内近 N 轮出现的形状降权
 *     局间内存（crossRoundMemory）：跨轮积累品类频率，鼓励多样性
 * - 不阻止重复：只是调整权重，不强制禁止，保留随机性
 *
 * 使用方式（main.js 或 game.js 初始化时）
 * -----------------------------------------
 *   import { BlockPool } from './bot/blockPool.js';
 *   import { generateDockShapes } from './bot/blockSpawn.js';
 *
 *   const pool = new BlockPool({ recentWindow: 9, penaltyFactor: 0.4 });
 *   // 用包装后的函数替换原函数引用
 *   const spawnFn = pool.wrap(generateDockShapes);
 *   // 后续直接调用 spawnFn(grid, config, hints, context) 即可
 *
 *   // 新局开始时重置局内窗口
 *   pool.resetForNewGame();
 */

import { getShapeCategory } from '../shapes.js';

export class BlockPool {
    /**
     * @param {object} [opts]
     * @param {number} [opts.recentWindow=9]       局内窗口：近 N 槽的形状 id
     * @param {number} [opts.penaltyFactor=0.4]    窗口内出现时权重乘以此系数（< 1）
     * @param {number} [opts.categoryWindow=3]     跨轮品类记忆窗口（轮数）
     * @param {number} [opts.categoryPenalty=0.7]  品类重复时权重乘以此系数
     */
    constructor(opts = {}) {
        this.recentWindow   = opts.recentWindow   ?? 9;     // 3块/轮 × 3轮
        this.penaltyFactor  = opts.penaltyFactor  ?? 0.4;
        this.categoryWindow = opts.categoryWindow ?? 3;
        this.categoryPenalty = opts.categoryPenalty ?? 0.7;

        /** @type {string[]} 近 recentWindow 个已出形状 id */
        this._recentIds = [];
        /** @type {string[][]} 近 categoryWindow 轮每轮出现的品类 */
        this._recentCategoryRounds = [];
    }

    // ------------------------------------------------------------------
    // 公开 API
    // ------------------------------------------------------------------

    /**
     * 包装 generateDockShapes，注入新鲜度惩罚逻辑。
     * 返回的函数签名与原函数完全相同。
     *
     * @param {Function} generateFn  原始 generateDockShapes(grid, config, hints, ctx)
     * @returns {Function} 包装后的生成函数
     */
    wrap(generateFn) {
        return (grid, config, hints = {}, context = {}) => {
            // 将新鲜度信息注入 context（供 GlobalLayer/blockSpawn 内部参考）
            const enrichedCtx = {
                ...context,
                recentShapeIds: [...this._recentIds],
                recentCategories: [...this._recentCategoryRounds],
            };
            const shapes = generateFn(grid, config, hints, enrichedCtx);
            this._recordShapes(shapes);
            return shapes;
        };
    }

    /**
     * 对已打分候选列表应用新鲜度惩罚（供测试或手动调用）
     * @param {Array<{shape:{id:string}, weight:number, category:string}>} scored
     * @returns {Array} 调整后的候选（新对象，不修改原数组）
     */
    penalize(scored) {
        const recentSet = new Set(this._recentIds);
        const catFreq = this._buildCategoryFreq();

        return scored.map(s => {
            let w = s.weight;
            if (recentSet.has(s.shape.id)) {
                w *= this.penaltyFactor;
            }
            const catCount = catFreq[s.category] || 0;
            if (catCount > 1) {
                w *= Math.pow(this.categoryPenalty, catCount - 1);
            }
            return { ...s, weight: Math.max(w, 0.01) };
        });
    }

    /** 新局开始时重置局内窗口（跨局品类记忆保留） */
    resetForNewGame() {
        this._recentIds = [];
        // 品类记忆不清空，保证跨局多样性
    }

    /** 获取当前窗口统计（调试/诊断用） */
    getDiagnostics() {
        return {
            recentIds: [...this._recentIds],
            categoryFreq: this._buildCategoryFreq(),
            recentCategoryRounds: this._recentCategoryRounds.map(r => [...r]),
        };
    }

    // ------------------------------------------------------------------
    // 内部实现
    // ------------------------------------------------------------------

    /** 记录本轮出块形状 */
    _recordShapes(shapes) {
        if (!shapes || shapes.length === 0) return;

        // 更新局内 id 窗口（每个形状 id 都记录，滑动窗口）
        for (const s of shapes) {
            if (!s?.id) continue;
            this._recentIds.push(s.id);
        }
        // 保持窗口大小
        while (this._recentIds.length > this.recentWindow) {
            this._recentIds.shift();
        }

        // 记录本轮品类（用于跨轮记忆）
        const cats = shapes.map(s => s?.id ? getShapeCategory(s.id) : 'unknown').filter(Boolean);
        if (cats.length > 0) {
            this._recentCategoryRounds.push(cats);
            while (this._recentCategoryRounds.length > this.categoryWindow) {
                this._recentCategoryRounds.shift();
            }
        }
    }

    /** 统计近几轮品类频率 */
    _buildCategoryFreq() {
        const freq = {};
        for (const round of this._recentCategoryRounds) {
            for (const cat of round) {
                freq[cat] = (freq[cat] || 0) + 1;
            }
        }
        return freq;
    }
}

/** 全局默认块池实例（供直接导入使用） */
export const defaultBlockPool = new BlockPool();
