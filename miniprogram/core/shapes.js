/**
 * 多连块定义：数据来自 shared/shapes.json，与 rl_pytorch / rl_mlx 共用。
 *
 * v1.60.1（Issue 5）：形状池二分
 *   - 常规池（regular，28 个）：参与"概率出块"，从 byCategory 抽样
 *   - 独立库（special，12 个）：v1.32+v1.60.0 引入的"事件注入形状"，
 *     **不参与概率出块**，仅由 `_tryInjectSpecial` 按盘面/节奏触发条件注入
 *
 * 关键 API 变化：
 *   - `pickShapeByCategoryWeights(weights)` 默认**自动过滤 special**，根除 Issue 5
 *     里"特殊形状仍按 category 权重抢概率"的泄漏（原方案靠 _pickFallbackSafe 12 次
 *     重抽 + _sanitizeShapeArr 二次消毒，本次直接在数据源头切断）
 *   - 新增 `getRegularShapes()` / `getSpecialShapes()` / `getSpecialShapeIds()` /
 *     `isSpecialShapeId(id)`，blockSpawn.js 不再硬编码 12 id（单源化 from JSON）
 *   - `getAllShapes()` **保持原语义**返回全部 40 个（向后兼容所有现存 grep / 测试 /
 *     训练侧 dataset.py）；下游若只要常规池，明确调 `getRegularShapes()`
 */
const shapesBundle = require('./shapesData');

const ORDER = shapesBundle.categoryOrder;
const BY = shapesBundle.byCategory;

/** v1.60.1：独立库 id 单源（来自 shared/shapes.json `specialShapeIds`），无则空集 */
const SPECIAL_IDS_RAW = Array.isArray(shapesBundle.specialShapeIds) ? shapesBundle.specialShapeIds : [];
const SPECIAL_ID_SET = new Set(SPECIAL_IDS_RAW);

/** @type {Record<string, Array<{ id: string, name: string, category: string, data: number[][] }>>} */
const SHAPES = {};
for (const cat of ORDER) {
    const list = BY[cat] || [];
    SHAPES[cat] = list.map((s) => ({
        id: s.id,
        name: s.name || s.id,
        category: s.category || cat,
        data: s.data
    }));
}

/**
 * 返回**所有 40 个**形状（含 special）。保持向后兼容：训练侧 / 拓扑覆盖率 /
 * 模型词表全部依赖此 API 的"40"语义。如需只看常规池，明确调 `getRegularShapes()`。
 */
function getAllShapes() {
    const all = [];
    for (const cat of ORDER) {
        if (SHAPES[cat]) {
            all.push(...SHAPES[cat]);
        }
    }
    return all;
}

/**
 * v1.60.1：常规出块池（28 个），剔除所有 specialShapeIds。
 * 概率出块（generateDockShapes 的 weighted / clear / perfectClear 路径）应用此池作为基础候选。
 */
function getRegularShapes() {
    return getAllShapes().filter((s) => !SPECIAL_ID_SET.has(s.id));
}

/**
 * v1.60.1：独立库（12 个），仅供 `_tryInjectSpecial` 事件注入路径使用。
 */
function getSpecialShapes() {
    return getAllShapes().filter((s) => SPECIAL_ID_SET.has(s.id));
}

/** v1.60.1：独立库 id 列表（与 shared/shapes.json `specialShapeIds` 同源） */
function getSpecialShapeIds() {
    return [...SPECIAL_IDS_RAW];
}

/** v1.60.1：单 id 速查（O(1)） */
function isSpecialShapeId(id) {
    return SPECIAL_ID_SET.has(id);
}

function getShapesByCategory(category) {
    return SHAPES[category] || [];
}

function getShapeCategory(shapeId) {
    for (const category in SHAPES) {
        if (SHAPES[category].some((s) => s.id === shapeId)) {
            return category;
        }
    }
    return 'squares';
}

function getShapeById(id) {
    for (const category in SHAPES) {
        const shape = SHAPES[category].find((s) => s.id === id);
        if (shape) {
            return shape;
        }
    }
    return null;
}

/**
 * 按类别权重随机选一个形状（同类内均匀）；用于开局铺盘与补块兜底，与 generateBlocks 的 per-shape 权重一致。
 *
 * v1.60.1（Issue 5）：默认**自动过滤 special**——根除"特殊形状通过概率路径泄漏到 dock"。
 *   - 若需保留旧语义（含 special），传 `{ includeSpecial: true }`（仅供开局铺盘等
 *     极少数明确不区分的场景）
 *   - 同步将 `_pickFallbackSafe` 12 次重抽降级为 0 次（数据源切断后无需重抽）
 *
 * @param {Record<string, number>} [weights]
 * @param {{ rng?: () => number, includeSpecial?: boolean }} [opts]
 */
function pickShapeByCategoryWeights(weights, opts) {
    const includeSpecial = opts?.includeSpecial === true;
    const rng = typeof opts?.rng === 'function' ? opts.rng : Math.random;
    const pool = includeSpecial ? getAllShapes() : getRegularShapes();
    if (pool.length === 0) {
        return null;
    }
    const wmap = weights && typeof weights === 'object' ? weights : {};
    let total = 0;
    for (const shape of pool) {
        total += wmap[getShapeCategory(shape.id)] ?? 1;
    }
    let r = rng() * total;
    for (const shape of pool) {
        r -= wmap[getShapeCategory(shape.id)] ?? 1;
        if (r <= 0) {
            return shape;
        }
    }
    return pool[0];
}

module.exports = { getAllShapes, getRegularShapes, getShapeById, getShapeCategory, getShapesByCategory, getSpecialShapeIds, getSpecialShapes, isSpecialShapeId, pickShapeByCategoryWeights, SHAPES };
