// @vitest-environment jsdom
/**
 * v1.60.21 — "双胞胎/三胞胎" 重复块注入的算法不变式。
 *
 * 覆盖 8 块：
 *   1) DUP_INJECT_CONFIG 阈值/概率/节流常量 frozen + 含理性默认；
 *   2) novelty < HIGH_THRESHOLD → 拒绝注入（门控 3）；
 *   3) dupInjectUsed >= MAX_PER_RUN → 拒绝（门控 1）；
 *   4) roundsSinceDupInject <= MIN_ROUND_GAP → 拒绝（门控 2）；
 *   5) specialInjected=true → 跑过（与 special 互斥）；
 *   6) novelty=1 + 满足节流 + 主块 placements 足 → 命中 dup2 或 dup3；
 *      chosenMeta 主槽 role='main'，副槽 role='replica' + duplicateGroup 设置正确；
 *   7) dup3 主块 placements < 9 → 拒绝（dup3 安全护栏）；
 *   8) validateSpawnTriplet({ allowDuplicates: true }) 不再拒绝重复 shape。
 */

import { describe, it, expect } from 'vitest';

import { Grid } from '../web/src/grid.js';
import {
    DUP_INJECT_CONFIG,
    _tryInjectDuplicates,
    validateSpawnTriplet,
    resetSpawnMemory,
} from '../web/src/bot/blockSpawn.js';

/** 用确定性 rng 写测试 */
function fixedRng(seq) {
    let i = 0;
    return () => seq[i++ % seq.length];
}

/** 构造合法且有足够 placements 的 triplet：1×2 + 1×3 + 2×1 在空 10×10 盘上 placements 都 >> 9 */
function buildEmptyGrid() {
    return new Grid(10);
}

function shape1x2() { return { id: '1x2', data: [[1, 1]] }; }
function shape1x3() { return { id: '1x3', data: [[1, 1, 1]] }; }
function shape2x1() { return { id: '2x1', data: [[1], [1]] }; }

/** 构造一个 chosenMeta 三元组，主块为 1x2（placements 高），副块次之 */
function buildScenario() {
    const triplet = [shape1x2(), shape1x3(), shape2x1()];
    const chosenMeta = [
        { shape: triplet[0], placements: 90, topDriver: { key: 'multiClear', label: '可消1行' } },
        { shape: triplet[1], placements: 80, topDriver: { key: 'gapFills',   label: '补2缺'   } },
        { shape: triplet[2], placements: 70, topDriver: { key: 'mobility',   label: '机动'    } },
    ];
    return { triplet, chosenMeta };
}

describe('v1.60.21 — DUP_INJECT_CONFIG 常量合理性', () => {
    it('阈值/概率/节流默认值在合理范围且 frozen', () => {
        expect(DUP_INJECT_CONFIG.HIGH_THRESHOLD).toBeGreaterThan(0);
        expect(DUP_INJECT_CONFIG.HIGH_THRESHOLD).toBeLessThan(DUP_INJECT_CONFIG.EXTREME_THRESHOLD);
        expect(DUP_INJECT_CONFIG.PROB_HIGH).toBeGreaterThan(0);
        expect(DUP_INJECT_CONFIG.PROB_HIGH).toBeLessThanOrEqual(0.15); /* "小概率" */
        expect(DUP_INJECT_CONFIG.PROB_EXTREME).toBeGreaterThanOrEqual(DUP_INJECT_CONFIG.PROB_HIGH);
        expect(DUP_INJECT_CONFIG.MAX_PER_RUN).toBe(3); /* 用户契约 */
        expect(DUP_INJECT_CONFIG.MIN_ROUND_GAP).toBe(10); /* 用户契约 */
        expect(Object.isFrozen(DUP_INJECT_CONFIG)).toBe(true);
    });
});

describe('v1.60.21 — 门控：novelty 阈值', () => {
    it('novelty < HIGH_THRESHOLD → 拒绝', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const { triplet, chosenMeta } = buildScenario();
        const hints = { spawnTargets: { novelty: 0.5 } };
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 999 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01]) });
        expect(result).toBeNull();
    });

    it('novelty=0.65（刚到 HIGH）+ 概率 = 0.01 < PROB_HIGH(0.05) → 命中 dup2', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const { triplet, chosenMeta } = buildScenario();
        const hints = { spawnTargets: { novelty: 0.65 } };
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 999 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01]) });
        expect(result).not.toBeNull();
        expect(result.mode).toBe('dup2');
    });

    it('novelty=0.65 + 概率 = 0.99 > PROB_HIGH → 拒绝（小概率不命中）', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const { triplet, chosenMeta } = buildScenario();
        const hints = { spawnTargets: { novelty: 0.65 } };
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 999 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.99]) });
        expect(result).toBeNull();
    });
});

describe('v1.60.21 — 门控：单局配额', () => {
    it('dupInjectUsed >= MAX_PER_RUN(3) → 拒绝', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const { triplet, chosenMeta } = buildScenario();
        const hints = { spawnTargets: { novelty: 1.0 } };
        const ctx = { dupInjectUsed: 3, roundsSinceDupInject: 999 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01]) });
        expect(result).toBeNull();
    });

    it('dupInjectUsed = MAX_PER_RUN - 1 = 2 → 仍允许（界限严格 <）', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const { triplet, chosenMeta } = buildScenario();
        const hints = { spawnTargets: { novelty: 1.0 } };
        const ctx = { dupInjectUsed: 2, roundsSinceDupInject: 999 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01, 0.99]) });
        expect(result, '剩 1 次配额，仍可命中').not.toBeNull();
    });
});

describe('v1.60.21 — 门控：轮次间隔', () => {
    it('roundsSinceDupInject = MIN_ROUND_GAP(10) → 拒绝（"大于 10"）', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const { triplet, chosenMeta } = buildScenario();
        const hints = { spawnTargets: { novelty: 1.0 } };
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 10 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01]) });
        expect(result, '边界值 10 应被拒绝').toBeNull();
    });

    it('roundsSinceDupInject = 11 → 通过门控 2', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const { triplet, chosenMeta } = buildScenario();
        const hints = { spawnTargets: { novelty: 1.0 } };
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 11 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01, 0.99]) });
        expect(result).not.toBeNull();
    });
});

describe('v1.60.21 — 与 special 注入互斥', () => {
    it('specialInjected=true → 跳过 dup 注入', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const { triplet, chosenMeta } = buildScenario();
        const hints = { spawnTargets: { novelty: 1.0 } };
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 999 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, {
            rng: fixedRng([0.01, 0.99]),
            specialInjected: true,
        });
        expect(result).toBeNull();
    });
});

describe('v1.60.21 — 注入结果正确性', () => {
    it('extreme novelty + rng→dup3 → 三块全同 + chosenMeta role 正确', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const { triplet, chosenMeta } = buildScenario();
        const hints = { spawnTargets: { novelty: 1.0 } };
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 999, totalRounds: 25 };
        /* rng 序列：[0.01 通过 PROB_EXTREME 0.10, 0.01 < 0.5 → dup3] */
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01, 0.01]) });
        expect(result.mode).toBe('dup3');

        const ids = triplet.map(s => s.id);
        expect(new Set(ids).size, 'dup3 后三块 id 应相同').toBe(1);

        const mainCnt = chosenMeta.filter(m => m.duplicateRole === 'main').length;
        const replicaCnt = chosenMeta.filter(m => m.duplicateRole === 'replica').length;
        expect(mainCnt).toBe(1);
        expect(replicaCnt).toBe(2);
        chosenMeta.forEach(m => expect(m.duplicateGroup).toBe('dup3'));

        /* 副槽必须 audit trail 完整：original + injectedAt */
        const replicas = chosenMeta.filter(m => m.duplicateRole === 'replica');
        replicas.forEach(m => {
            expect(m.originalShape).toBeDefined();
            expect(m.originalMeta).toBeDefined();
            expect(m.injectedAt).toBe(25);
        });
    });

    it('high novelty 区间 → 只能命中 dup2，不可能 dup3', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const hints = { spawnTargets: { novelty: 0.7 } }; /* high but not extreme */
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 999 };

        let dup2Cnt = 0, dup3Cnt = 0;
        for (let i = 0; i < 20; i++) {
            const { triplet, chosenMeta } = buildScenario();
            const r = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01, 0.01]) });
            if (r?.mode === 'dup2') dup2Cnt++;
            if (r?.mode === 'dup3') dup3Cnt++;
        }
        expect(dup3Cnt, 'high novelty 区间不应触发 dup3').toBe(0);
        expect(dup2Cnt).toBeGreaterThanOrEqual(1);
    });
});

describe('v1.60.21 — 安全护栏：主块 placements 不足', () => {
    it('dup3 + 主块 placements < 9 → 拒绝', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const triplet = [shape1x2(), shape1x3(), shape2x1()];
        const chosenMeta = [
            { shape: triplet[0], placements: 8, topDriver: { key: 'mobility', label: '机动' } },
            { shape: triplet[1], placements: 5, topDriver: { key: 'mobility', label: '机动' } },
            { shape: triplet[2], placements: 4, topDriver: { key: 'mobility', label: '机动' } },
        ];
        const hints = { spawnTargets: { novelty: 1.0 } };
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 999 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01, 0.01]) });
        expect(result, '主块 placements=8 < 9 → dup3 拒绝').toBeNull();
    });

    it('dup2 + 主块 placements < 6 → 拒绝', () => {
        resetSpawnMemory();
        const grid = buildEmptyGrid();
        const triplet = [shape1x2(), shape1x3(), shape2x1()];
        const chosenMeta = [
            { shape: triplet[0], placements: 5, topDriver: { key: 'mobility', label: '机动' } },
            { shape: triplet[1], placements: 4, topDriver: { key: 'mobility', label: '机动' } },
            { shape: triplet[2], placements: 3, topDriver: { key: 'mobility', label: '机动' } },
        ];
        const hints = { spawnTargets: { novelty: 0.7 } };
        const ctx = { dupInjectUsed: 0, roundsSinceDupInject: 999 };
        const result = _tryInjectDuplicates(triplet, chosenMeta, hints, ctx, grid, { rng: fixedRng([0.01]) });
        expect(result, '主块 placements=5 < 6 → dup2 拒绝').toBeNull();
    });
});

describe('v1.60.21 — validateSpawnTriplet allowDuplicates 选项', () => {
    it('默认 allowDuplicates 缺省时仍拒绝重复 shape', () => {
        const grid = buildEmptyGrid();
        const s = shape1x2();
        const v = validateSpawnTriplet(grid, [s, s, s]);
        expect(v.ok).toBe(false);
        expect(v.reason).toBe('duplicate-shape');
    });

    it('allowDuplicates=true 时不再拒绝重复 shape', () => {
        const grid = buildEmptyGrid();
        const s = shape1x2();
        const v = validateSpawnTriplet(grid, [s, s, s], { allowDuplicates: true });
        expect(v.ok, '三块同形且 placements 足够时应通过').toBe(true);
    });
});
