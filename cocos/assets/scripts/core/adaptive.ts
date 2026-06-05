/**
 * 自适应难度（引擎无关）。忠实移植 web/src/adaptiveSpawn.js 的 PB 曲线
 * （derivePbCurve：tension / brake / release / phase），并叠加一个轻量的
 * 盘面拓扑压力模型（fill / holes / nearFullLines / risk），最终产出
 * 「类别权重 + 最小可玩数」供出块使用。
 *
 * 设计：不拉入 web 的 retention/lifecycle 重依赖闭包，只取「分数相对最佳分的
 * 张力」与「盘面危险度」这两个对手感最关键、且完全可在 Node 验证的信号。
 */
import { Grid } from './grid';

export interface PbCurve {
    pbRatio: number | null;
    pbTension: number;
    pbBrake: number;
    pbRelease: number;
    pbPhase: 'unknown' | 'warmup' | 'chase' | 'tension' | 'gate' | 'release' | 'brake' | 'overshoot';
}

export interface BoardPressure {
    fill: number;
    holes: number;
    nearFullLines: number;
    maxLineFill: number;
    risk: number;
}

export interface AdaptivePlan {
    categoryWeights: Record<string, number>;
    minPlayable: number;
    pb: PbCurve;
    pressure: BoardPressure;
    hard: number;
    relief: number;
}

export const DEFAULT_SPAWN_PARAMS_PB_CURVE = Object.freeze({
    pbTensionCenter: 0.82,
    pbTensionWidth: 0.08,
    pbBrakeCenter: 1.05,
    pbBrakeWidth: 0.06,
});

function clamp01(x: number): number {
    return x < 0 ? 0 : x > 1 ? 1 : x;
}

function sigmoid01(x: number): number {
    return 1 / (1 + Math.exp(-x));
}

/** 与 web/src/adaptiveSpawn.js derivePbCurve 完全同口径。 */
export function derivePbCurve(
    score = 0,
    bestScore = 0,
    releaseActive = false,
    options: Partial<typeof DEFAULT_SPAWN_PARAMS_PB_CURVE> | null = null,
): PbCurve {
    const best = Number(bestScore) || 0;
    if (best <= 0) {
        return { pbRatio: null, pbTension: 0, pbBrake: 0, pbRelease: releaseActive ? 1 : 0, pbPhase: 'unknown' };
    }
    const numOrDefault = (v: unknown, d: number): number => {
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? n : d;
    };
    const tensionCenter = numOrDefault(options?.pbTensionCenter, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbTensionCenter);
    const tensionWidth = numOrDefault(options?.pbTensionWidth, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbTensionWidth);
    const brakeCenter = numOrDefault(options?.pbBrakeCenter, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbBrakeCenter);
    const brakeWidth = numOrDefault(options?.pbBrakeWidth, DEFAULT_SPAWN_PARAMS_PB_CURVE.pbBrakeWidth);

    const ratio = Math.max(0, Number(score) || 0) / best;
    const pbTension = clamp01(sigmoid01((ratio - tensionCenter) / tensionWidth));
    const pbBrake = clamp01(sigmoid01((ratio - brakeCenter) / brakeWidth));
    const pbRelease = releaseActive ? 1 : 0;
    let pbPhase: PbCurve['pbPhase'] = 'warmup';
    if (ratio >= 1.15) pbPhase = 'overshoot';
    else if (ratio >= 1.05) pbPhase = 'brake';
    else if (ratio >= 1.0) pbPhase = 'release';
    else if (ratio >= 0.95) pbPhase = 'gate';
    else if (ratio >= 0.8) pbPhase = 'tension';
    else if (ratio >= 0.5) pbPhase = 'chase';
    return { pbRatio: ratio, pbTension, pbBrake, pbRelease, pbPhase };
}

/** 盘面拓扑压力：fill / 空洞 / 近满行列 / 最大行列填充 → 危险度 risk。 */
export function analyzeBoardPressure(grid: Grid): BoardPressure {
    const n = grid.size;
    const fill = grid.getFillRatio();

    let holes = 0;
    for (let x = 0; x < n; x++) {
        let seenFilled = false;
        for (let y = 0; y < n; y++) {
            if (grid.cells[y][x] !== null) seenFilled = true;
            else if (seenFilled) holes++;
        }
    }

    let nearFullLines = 0;
    let maxLineFill = 0;
    for (let y = 0; y < n; y++) {
        let c = 0;
        for (let x = 0; x < n; x++) if (grid.cells[y][x] !== null) c++;
        if (c >= n - 2 && c < n) nearFullLines++;
        if (c / n > maxLineFill) maxLineFill = c / n;
    }
    for (let x = 0; x < n; x++) {
        let c = 0;
        for (let y = 0; y < n; y++) if (grid.cells[y][x] !== null) c++;
        if (c >= n - 2 && c < n) nearFullLines++;
        if (c / n > maxLineFill) maxLineFill = c / n;
    }

    const risk = clamp01(fill * 0.7 + holes / (n * 2) * 0.5 + Math.max(0, maxLineFill - 0.6) * 0.6);
    return { fill, holes, nearFullLines, maxLineFill, risk };
}

/**
 * 综合 PB 张力与盘面压力，产出类别权重与最小可玩数。
 * - 接近/冲击最佳分（tension 高）→ 提升复杂形状（方/矩/Z），增加挑战；
 * - 盘面危险（risk 高）或越过最佳分后的 brake → 提升救济（细线条/L），降低不公平死局。
 */
export function deriveAdaptivePlan(
    grid: Grid,
    score: number,
    best: number,
    releaseActive = false,
): AdaptivePlan {
    const pb = derivePbCurve(score, best, releaseActive);
    const pressure = analyzeBoardPressure(grid);

    const hard = clamp01(pb.pbTension * 0.85 + 0.15 - pressure.risk * 0.4);
    const relief = clamp01(pressure.risk * 0.9 + pb.pbBrake * 0.4 + (1 - pb.pbTension) * 0.15);

    const w: Record<string, number> = {
        lines: clamp01v(1 + relief * 1.2 - hard * 0.2),
        rects: clamp01v(1 + hard * 1.0 - relief * 0.3),
        squares: clamp01v(1 + hard * 1.4 - relief * 0.5),
        tshapes: clamp01v(1 + hard * 0.5),
        zshapes: clamp01v(1 + hard * 0.9 - relief * 0.4),
        lshapes: clamp01v(1 + hard * 0.3 + relief * 0.2),
        jshapes: clamp01v(1 + hard * 0.3),
    };

    const minPlayable = Math.min(3, 1 + Math.round(pressure.risk * 2));
    return { categoryWeights: w, minPlayable, pb, pressure, hard, relief };
}

function clamp01v(v: number): number {
    return v < 0.1 ? 0.1 : v;
}
