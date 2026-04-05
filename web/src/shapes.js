/**
 * 多连块定义：数据来自 shared/shapes.json，与 rl_pytorch / rl_mlx 共用。
 */
import shapesBundle from '../../shared/shapes.json';

const ORDER = shapesBundle.categoryOrder;
const BY = shapesBundle.byCategory;

/** @type {Record<string, Array<{ id: string, name: string, category: string, data: number[][] }>>} */
export const SHAPES = {};
for (const cat of ORDER) {
    const list = BY[cat] || [];
    SHAPES[cat] = list.map((s) => ({
        id: s.id,
        name: s.name || s.id,
        category: s.category || cat,
        data: s.data
    }));
}

export function getAllShapes() {
    const all = [];
    for (const cat of ORDER) {
        if (SHAPES[cat]) {
            all.push(...SHAPES[cat]);
        }
    }
    return all;
}

export function getShapesByCategory(category) {
    return SHAPES[category] || [];
}

export function getShapeCategory(shapeId) {
    for (const category in SHAPES) {
        if (SHAPES[category].some((s) => s.id === shapeId)) {
            return category;
        }
    }
    return 'squares';
}

export function getShapeById(id) {
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
 * @param {Record<string, number>} [weights]
 */
export function pickShapeByCategoryWeights(weights) {
    const all = getAllShapes();
    if (all.length === 0) {
        return null;
    }
    const wmap = weights && typeof weights === 'object' ? weights : {};
    let total = 0;
    for (const shape of all) {
        total += wmap[getShapeCategory(shape.id)] ?? 1;
    }
    let r = Math.random() * total;
    for (const shape of all) {
        r -= wmap[getShapeCategory(shape.id)] ?? 1;
        if (r <= 0) {
            return shape;
        }
    }
    return all[0];
}
