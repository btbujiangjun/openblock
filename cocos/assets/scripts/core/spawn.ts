/**
 * 出块（dock 生成）—— Phase 1 采用"加权随机 + 同花顺颜色偏置 + 可玩性兜底"的精简策略。
 * 接口预留 adaptive 钩子：后续可把 miniprogram/core/adaptiveSpawn.js 接到这里替换 weights。
 */
import { Grid } from './grid';
import { DockBlock, Skin } from './types';
import { Rng, defaultRng } from './rng';
import { getRegularShapes, pickShapeByCategoryWeights } from './shapes';
import { monoNearFullLineColorWeights, pickThreeDockColors } from './scoring';
import { DOCK_SLOTS } from './config';

export interface SpawnOptions {
    rng?: Rng;
    skin?: Skin | null;
    /** 类别权重（adaptive 层可注入），缺省均匀 */
    categoryWeights?: Record<string, number>;
    /** 至少保证 N 块当前可放置（可玩性兜底），默认 1 */
    minPlayable?: number;
}

/**
 * 生成 3 个候选块。颜色按近满同色偏置抽取；形状按类别权重抽取；
 * 并做一次"至少 minPlayable 块可放"的兜底重试。
 */
export function generateDock(grid: Grid, opts: SpawnOptions = {}): DockBlock[] {
    const rng = opts.rng ?? defaultRng;
    const colorBias = monoNearFullLineColorWeights(grid, opts.skin ?? null);

    const tryOnce = (): DockBlock[] => {
        const colors = pickThreeDockColors(colorBias, rng);
        const blocks: DockBlock[] = [];
        for (let i = 0; i < DOCK_SLOTS; i++) {
            const def = pickShapeByCategoryWeights(opts.categoryWeights, { rng })
                ?? getRegularShapes()[0];
            blocks.push({
                index: i,
                shape: def.data,
                shapeId: def.id,
                colorIdx: colors[i],
                placed: false,
            });
        }
        return blocks;
    };

    const minPlayable = Math.max(0, opts.minPlayable ?? 1);
    let best = tryOnce();
    if (minPlayable <= 0) return best;

    for (let attempt = 0; attempt < 12; attempt++) {
        const playable = best.filter((b) => grid.canPlaceAnywhere(b.shape)).length;
        if (playable >= minPlayable) return best;
        best = tryOnce();
    }
    return best;
}
