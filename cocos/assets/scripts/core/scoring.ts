/**
 * 消行计分与 dock 颜色偏置 —— 由 miniprogram/core/bonusScoring.js 移植。
 */
import { Grid } from './grid';
import { Skin } from './types';
import { Rng, defaultRng } from './rng';
import { DEFAULT_SCORING, MONO_NEAR_FULL_COLOR_WEIGHT, ScoringConfig } from './config';

function dockSlot(ci: number): number {
    return ((ci % 8) + 8) % 8;
}

export function bonusEffectHoldMs(bonusCount: number): number {
    if (bonusCount <= 0) return 0;
    return Math.min(5000, Math.max(3000, 3000 + bonusCount * 400));
}

export function computeClearScore(
    result: { count?: number; bonusLines?: unknown[]; perfectClear?: boolean },
    scoring: ScoringConfig = DEFAULT_SCORING,
): { baseScore: number; iconBonusScore: number; clearScore: number } {
    const c = result?.count ?? 0;
    const baseUnit = scoring.singleLine ?? 20;
    const baseScore = c > 0 ? baseUnit * c * c : 0;
    const bonusLines = result?.bonusLines || [];
    const bonusCount = bonusLines.length;
    if (c <= 0) return { baseScore, iconBonusScore: 0, clearScore: baseScore };
    const effectiveBonusCount = Math.min(bonusCount, c);
    const lineScore = baseUnit * c;
    const iconBonusScore = lineScore * effectiveBonusCount * (scoring.iconBonusLineMult - 1);
    const subtotal = baseScore + iconBonusScore;
    const perfectMult = result?.perfectClear ? scoring.perfectClearMult : 1;
    return { baseScore, iconBonusScore, clearScore: subtotal * perfectMult };
}

/** 近满同色行列 → 给对应 dock 颜色加偏置（让玩家更容易凑同花顺） */
export function monoNearFullLineColorWeights(grid: Grid, skin: Skin | null = null): number[] {
    const w = new Array(8).fill(0);
    if (!grid?.cells) return w;
    const n = grid.size;
    const blockIcons = skin?.blockIcons;
    const getIcon = (ci: number): string | null =>
        blockIcons?.length ? blockIcons[ci % blockIcons.length] : null;

    function biasFor(empty: number): number {
        if (empty < 1 || empty > n - 2) return 0;
        if (empty <= 2) return MONO_NEAR_FULL_COLOR_WEIGHT;
        const buildupMaxBias = 0.4;
        const buildupMinBias = 0.15;
        const t = (empty - 3) / Math.max(1, n - 5);
        return buildupMaxBias - (buildupMaxBias - buildupMinBias) * Math.max(0, Math.min(1, t));
    }

    function addLine(filledVals: number[], biasWeight: number): void {
        if (filledVals.length === 0 || biasWeight <= 0) return;
        const icon0 = getIcon(filledVals[0]);
        const monoIcon = icon0 !== null && filledVals.every((c) => getIcon(c) === icon0);
        const monoColor = icon0 === null && filledVals.every((c) => c === filledVals[0]);
        if (!monoIcon && !monoColor) return;
        if (monoIcon) {
            const distinctDock = [...new Set(filledVals.map(dockSlot))];
            const share = biasWeight / distinctDock.length;
            for (const s of distinctDock) w[s] += share;
        } else {
            w[dockSlot(filledVals[0])] += biasWeight;
        }
    }

    for (let y = 0; y < n; y++) {
        const filled: number[] = [];
        for (let x = 0; x < n; x++) {
            const c = grid.cells[y][x];
            if (c !== null) filled.push(c);
        }
        const empty = n - filled.length;
        if (empty >= 1 && empty <= n - 2) addLine(filled, biasFor(empty));
    }
    for (let x = 0; x < n; x++) {
        const filled: number[] = [];
        for (let y = 0; y < n; y++) {
            const c = grid.cells[y][x];
            if (c !== null) filled.push(c);
        }
        const empty = n - filled.length;
        if (empty >= 1 && empty <= n - 2) addLine(filled, biasFor(empty));
    }
    return w;
}

/** 8 色无放回加权抽三色 */
export function pickThreeDockColors(biasWeights: number[], rnd: Rng = defaultRng): [number, number, number] {
    const bias = biasWeights || [];
    const pool = [0, 1, 2, 3, 4, 5, 6, 7];
    const out: number[] = [];
    for (let k = 0; k < 3; k++) {
        let total = 0;
        for (const c of pool) total += 1 + (bias[c] || 0);
        let r = rnd() * total;
        let chosen = pool[0];
        for (const c of pool) {
            r -= 1 + (bias[c] || 0);
            if (r <= 0) { chosen = c; break; }
        }
        out.push(chosen);
        pool.splice(pool.indexOf(chosen), 1);
    }
    return out as [number, number, number];
}
