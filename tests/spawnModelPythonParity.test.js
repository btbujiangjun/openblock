/**
 * @vitest-environment jsdom
 *
 * web ↔ Python（rl_pytorch/spawn_model/dataset.py）出块模型特征契约 parity。
 *
 * 背景：v1.57.1 把 behaviorContext 从 56 → 57 维（spawnIntent one-hot 6 → 7，新增 'sprint'）。
 * 历史上前端 spawnModel.js 漏改、仍是 56，导致 model-v3 推理时前端拼接维度与后端
 * board_proj.in_features(64+57=121) 不符。本测试静态钉死两端契约，任一侧漂移即失败。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Grid } from '../web/src/grid.js';
import {
    buildSpawnModelContext,
    SHAPE_VOCAB,
    SPAWN_INTENT_VOCAB,
    SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM,
    SPAWN_MODEL_CONTEXT_DIM,
    SPAWN_PB_THETA_RANGES,
} from '../web/src/spawnModel.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const datasetPy = readFileSync(
    resolve(__dirname, '../rl_pytorch/spawn_model/dataset.py'),
    'utf8',
);

/** 解析 Python 模块级 `NAME = <int>`（行首锚定，避免 BEHAVIOR_CONTEXT_DIM 误匹配 CONTEXT_DIM）。 */
function pyInt(name) {
    const m = datasetPy.match(new RegExp(`^${name}\\s*=\\s*(\\d+)`, 'm'));
    if (!m) throw new Error(`未在 dataset.py 找到 ${name}`);
    return Number(m[1]);
}

/** 解析 Python `NAME = [ '...', '...' ]`（可跨行、可含注释），返回字符串数组。 */
function pyStrList(name) {
    const start = datasetPy.indexOf(`${name} = [`);
    if (start < 0) throw new Error(`未在 dataset.py 找到 ${name}`);
    const open = datasetPy.indexOf('[', start);
    const close = datasetPy.indexOf(']', open);
    const body = datasetPy.slice(open + 1, close);
    return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
}

/** 解析 Python `_PB_THETA_RANGES = { 'key': (lo, hi), ... }` → { key: [lo, hi] }。 */
function pyThetaRanges() {
    const start = datasetPy.indexOf('_PB_THETA_RANGES = {');
    if (start < 0) throw new Error('未在 dataset.py 找到 _PB_THETA_RANGES');
    const close = datasetPy.indexOf('}', start);
    const body = datasetPy.slice(start, close);
    const out = {};
    for (const m of body.matchAll(/'([^']+)'\s*:\s*\(([-\d.]+),\s*([-\d.]+)\)/g)) {
        out[m[1]] = [Number(m[2]), Number(m[3])];
    }
    return out;
}

describe('spawnModel web↔Python 特征契约 parity', () => {
    beforeAll(() => {
        const store = new Map();
        Object.defineProperty(globalThis, 'localStorage', {
            configurable: true,
            value: {
                getItem: (k) => store.get(k) ?? null,
                setItem: (k, v) => { store.set(k, String(v)); },
                removeItem: (k) => { store.delete(k); },
                clear: () => { store.clear(); },
            },
        });
    });

    it('behaviorContext 维度与 dataset.py BEHAVIOR_CONTEXT_DIM 一致（66）', () => {
        const pyDim = pyInt('BEHAVIOR_CONTEXT_DIM');
        expect(pyDim).toBe(66);
        expect(SPAWN_MODEL_BEHAVIOR_CONTEXT_DIM).toBe(pyDim);
    });

    it('PB θ 归一化区间与 dataset.py _PB_THETA_RANGES 逐项一致', () => {
        const pyRanges = pyThetaRanges();
        expect(Object.keys(pyRanges).sort()).toEqual(
            ['pbBrakeCenter', 'pbBrakeWidth', 'pbTensionCenter', 'pbTensionWidth'],
        );
        for (const [k, [lo, hi]] of Object.entries(pyRanges)) {
            expect(SPAWN_PB_THETA_RANGES[k]).toEqual([lo, hi]);
        }
    });

    it('基础 context 维度与 dataset.py CONTEXT_DIM 一致（24）', () => {
        const pyDim = pyInt('CONTEXT_DIM');
        expect(SPAWN_MODEL_CONTEXT_DIM).toBe(pyDim);
    });

    it('spawnIntent 词表顺序与 dataset.py _SPAWN_INTENTS 逐项一致（含 sprint）', () => {
        const pyIntents = pyStrList('_SPAWN_INTENTS');
        expect(pyIntents).toEqual([
            'relief', 'engage', 'harvest', 'pressure', 'flow', 'maintain', 'sprint',
        ]);
        expect(SPAWN_INTENT_VOCAB).toEqual(pyIntents);
    });

    it('SHAPE_VOCAB 顺序与 dataset.py SHAPE_VOCAB 逐项一致（40）', () => {
        const pyShapes = pyStrList('SHAPE_VOCAB');
        expect(pyShapes).toHaveLength(40);
        expect(SHAPE_VOCAB).toEqual(pyShapes);
    });

    it('实际构造的 behaviorContext 长度恰为 66，sprint one-hot 落在 idx 54，θ 落在 [57..60]，空间规划 [63..65]', () => {
        const grid = new Grid(8);
        const ctx = buildSpawnModelContext(grid, { metrics: {}, skillLevel: 0.5 }, {
            stress: 0.5,
            fillRatio: 0.1,
            spawnHints: { spawnIntent: 'sprint' },
            // 取各区间上界，归一化后 θ 尾段应为 [1,1,1,1]。
            stressBreakdown: {
                pbCurveParams: {
                    pbTensionCenter: 0.92, pbTensionWidth: 0.15,
                    pbBrakeCenter: 1.15, pbBrakeWidth: 0.12,
                },
            },
        });
        expect(ctx.behaviorContext).toHaveLength(66);
        // [48..54] 为 7 维 intent one-hot；sprint=idx6 → 绝对位置 48+6=54。
        const oneHot = ctx.behaviorContext.slice(48, 55);
        expect(oneHot.reduce((a, b) => a + b, 0)).toBe(1);
        expect(oneHot[6]).toBe(1);
        expect(ctx.behaviorContext[54]).toBe(1);
        // [57..60] PB θ 显式条件，上界 → 归一化 1。
        expect(ctx.behaviorContext.slice(57, 61)).toEqual([1, 1, 1, 1]);
        // [63..65] 空间规划：空盘 → [regionEntropy=0, largestRegionRatio=1, smallRegionCellRatio=0]。
        expect(ctx.behaviorContext.slice(63, 66)).toEqual([0, 1, 0]);
    });

    it('缺省 θ（无 pbCurveParams）→ θ 尾段为默认域归一化、非 0', () => {
        const grid = new Grid(8);
        const ctx = buildSpawnModelContext(grid, { metrics: {}, skillLevel: 0.5 }, {
            stress: 0.3, fillRatio: 0.1, spawnHints: {},
        });
        const tail = ctx.behaviorContext.slice(57, 61);
        // pbTensionCenter 默认 0.82 → (0.82-0.70)/0.22 ≈ 0.5455。
        expect(tail[0]).toBeCloseTo((0.82 - 0.70) / (0.92 - 0.70), 6);
        expect(tail.every((v) => v > 0)).toBe(true);
    });
});
