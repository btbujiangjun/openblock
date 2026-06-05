/**
 * 形状池 API —— 由 miniprogram/core/shapes.js 移植。
 * 概率出块默认过滤 special（事件注入形状），与主局一致。
 */
import { ShapeDef } from './types';
import { Rng, defaultRng } from './rng';
import { byCategory, categoryOrder, specialShapeIds } from './shapesData';

const SPECIAL_ID_SET = new Set(specialShapeIds);

const SHAPES: Record<string, ShapeDef[]> = {};
for (const cat of categoryOrder) {
    SHAPES[cat] = (byCategory[cat] || []).map((s) => ({
        id: s.id,
        name: s.name || s.id,
        category: s.category || cat,
        data: s.data,
    }));
}

export function getAllShapes(): ShapeDef[] {
    const all: ShapeDef[] = [];
    for (const cat of categoryOrder) {
        if (SHAPES[cat]) all.push(...SHAPES[cat]);
    }
    return all;
}

export function getRegularShapes(): ShapeDef[] {
    return getAllShapes().filter((s) => !SPECIAL_ID_SET.has(s.id));
}

export function getSpecialShapes(): ShapeDef[] {
    return getAllShapes().filter((s) => SPECIAL_ID_SET.has(s.id));
}

export function isSpecialShapeId(id: string): boolean {
    return SPECIAL_ID_SET.has(id);
}

export function getShapeCategory(shapeId: string): string {
    for (const category in SHAPES) {
        if (SHAPES[category].some((s) => s.id === shapeId)) return category;
    }
    return 'squares';
}

export function getShapeById(id: string): ShapeDef | null {
    for (const category in SHAPES) {
        const shape = SHAPES[category].find((s) => s.id === id);
        if (shape) return shape;
    }
    return null;
}

export interface PickOpts {
    rng?: Rng;
    includeSpecial?: boolean;
}

export function pickShapeByCategoryWeights(
    weights?: Record<string, number>,
    opts?: PickOpts,
): ShapeDef | null {
    const includeSpecial = opts?.includeSpecial === true;
    const rng = typeof opts?.rng === 'function' ? opts!.rng! : defaultRng;
    const pool = includeSpecial ? getAllShapes() : getRegularShapes();
    if (pool.length === 0) return null;
    const wmap = weights && typeof weights === 'object' ? weights : {};
    let total = 0;
    for (const shape of pool) total += wmap[getShapeCategory(shape.id)] ?? 1;
    let r = rng() * total;
    for (const shape of pool) {
        r -= wmap[getShapeCategory(shape.id)] ?? 1;
        if (r <= 0) return shape;
    }
    return pool[0];
}

export { SHAPES };
