import { describe, it, expect } from 'vitest';
import fixtureCases from './fixtures/spawnStepDifficulty.cases.json';
import {
    computeSpawnStepDifficulty,
    classifyTriplet,
    scdScore,
    scdLevel,
    isLongBar,
    isKillerShape,
    shapeCellCount,
    difficultyBucket,
    spawnStepDifficultyFeatures,
    SPAWN_STEP_DIFFICULTY_FEATURE_DIM,
    DIFFICULTY_BUCKETS,
    SPAWN_STEP_DIFFICULTY_VERSION
} from '../web/src/spawnStepDifficulty.js';

const S1 = [[1]];
const BAR = [[1, 1, 1, 1]];
const COL = [[1], [1], [1], [1]];
const SQ2 = [[1, 1], [1, 1]];
const SQ3 = [[1, 1, 1], [1, 1, 1], [1, 1, 1]];
const L3 = [[1, 0], [1, 0], [1, 1]];

describe('spawnStepDifficulty — 形状级口径 (P1)', () => {
    it('shapeCellCount 计正确占用格', () => {
        expect(shapeCellCount(S1)).toBe(1);
        expect(shapeCellCount(BAR)).toBe(4);
        expect(shapeCellCount(SQ3)).toBe(9);
        expect(shapeCellCount(null)).toBe(0);
    });

    it('isLongBar：单行/单列长度≥4 才算；2x2、L 型不算', () => {
        expect(isLongBar(BAR)).toBe(true);
        expect(isLongBar(COL)).toBe(true);
        expect(isLongBar(SQ2)).toBe(false);
        expect(isLongBar(SQ3)).toBe(false);
        expect(isLongBar(L3)).toBe(false);
        expect(isLongBar([[1, 1, 1]])).toBe(false); // 长度 3 < 4
    });

    it('isKillerShape：大体积或长条 + 低机动性；无 countLegal 退化为纯形状口径', () => {
        expect(isKillerShape(SQ3, null)).toBe(true); // 9 格 ≥ 5
        expect(isKillerShape(BAR, null)).toBe(true); // 长条
        expect(isKillerShape(SQ2, null)).toBe(false); // 4 格、非长条
        // 有 countLegal：体积达标但机动性高 → 非 killer
        expect(isKillerShape(SQ3, () => 30)).toBe(false);
        expect(isKillerShape(SQ3, () => 3)).toBe(true);
    });

    it('classifyTriplet 组合计数与同质判定', () => {
        const r = classifyTriplet([SQ3, BAR, SQ2]);
        expect(r.comboTotalCells).toBe(9 + 4 + 4);
        expect(r.comboLongBarCnt).toBe(1);
        expect(r.comboKillerCnt).toBe(2); // SQ3(9格) + BAR(长条)
        expect(r.isHomogeneousFamily).toBe(false);
        const homo = classifyTriplet([SQ2, SQ2, SQ2]);
        expect(homo.isHomogeneousFamily).toBe(true);
    });

    it('classifyTriplet 用 countLegal 取 minFlexibility 短板', () => {
        const legal = new Map([[SQ3, 2], [BAR, 12], [SQ2, 20]]);
        const r = classifyTriplet([SQ3, BAR, SQ2], { countLegal: (d) => legal.get(d) });
        expect(r.minFlexibility).toBe(2);
    });
});

describe('spawnStepDifficulty — 空间约束密度 (P0)', () => {
    it('scdScore = 总格 / 空格', () => {
        expect(scdScore(8, 0)).toBeCloseTo(8 / 64.001, 4);
        expect(scdScore(8, 56)).toBeCloseTo(8 / 8.001, 4);
    });
    it('scdLevel 三档', () => {
        expect(scdLevel(0.1)).toBe('ample');
        expect(scdLevel(0.4)).toBe('tight');
        expect(scdLevel(0.9)).toBe('scarce');
    });
});

describe('spawnStepDifficulty — 桶与合成 (P2)', () => {
    it('difficultyBucket 5 档边界', () => {
        expect(difficultyBucket(0.0)).toBe('trivial');
        expect(difficultyBucket(0.2)).toBe('trivial');
        expect(difficultyBucket(0.21)).toBe('easy');
        expect(difficultyBucket(0.6)).toBe('standard');
        expect(difficultyBucket(0.81)).toBe('extreme');
        expect(difficultyBucket(1.5)).toBe('extreme'); // clamp
    });

    it('stepDifficulty 单调性：满盘 + 致命块 + 稀缺解 显著高于空盘小块', () => {
        const easy = computeSpawnStepDifficulty({
            shapes: [S1, S1, SQ2], occupiedCount: 0, boardDifficulty: 0,
            solutionMetrics: { solutionCount: 40 }
        });
        const hard = computeSpawnStepDifficulty({
            shapes: [SQ3, BAR, SQ2], occupiedCount: 50, boardDifficulty: 0.85,
            solutionMetrics: { solutionCount: 2 }
        });
        expect(hard.stepDifficulty).toBeGreaterThan(easy.stepDifficulty);
        expect(hard.bucket).toBe('extreme');
        expect(easy.bucket).toBe('trivial');
    });

    it('capped/truncated 解视为充裕（solutionTerm=0）', () => {
        const r = computeSpawnStepDifficulty({
            shapes: [SQ2, SQ2, SQ2], occupiedCount: 30, boardDifficulty: 0.5,
            solutionMetrics: { capped: true }
        });
        expect(r.terms.solution).toBe(0);
        expect(r.solutionCount).toBeNull();
    });

    it('输出 schema 完整且版本号正确', () => {
        const r = computeSpawnStepDifficulty({ shapes: [S1, S1, S1], occupiedCount: 0 });
        expect(r.version).toBe(SPAWN_STEP_DIFFICULTY_VERSION);
        expect(DIFFICULTY_BUCKETS).toContain(r.bucket);
        expect(r).toHaveProperty('scdScore');
        expect(r).toHaveProperty('comboKillerCnt');
        expect(r.terms).toHaveProperty('killer');
    });
});

describe('spawnStepDifficulty — RL 状态特征子向量', () => {
    it('返回固定 4 维且均在 [0,1]', () => {
        const f = spawnStepDifficultyFeatures([SQ3, BAR, SQ2], 50);
        expect(f).toHaveLength(SPAWN_STEP_DIFFICULTY_FEATURE_DIM);
        for (const v of f) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
        }
    });

    it('空盘小块特征显著低于满盘致命块', () => {
        const easy = spawnStepDifficultyFeatures([S1, S1, SQ2], 0);
        const hard = spawnStepDifficultyFeatures([SQ3, BAR, SQ3], 50);
        expect(hard[0]).toBeGreaterThan(easy[0]); // scdNorm
        expect(hard[2]).toBeGreaterThan(easy[2]); // killer
    });
});

describe('spawnStepDifficulty — 跨语言契约 fixture', () => {
    for (const { input, expected } of fixtureCases) {
        it(`fixture: ${input.name}`, () => {
            const got = computeSpawnStepDifficulty({
                shapes: input.shapes,
                occupiedCount: input.occupiedCount,
                boardDifficulty: input.boardDifficulty,
                solutionMetrics: input.solutionMetrics
            });
            expect(got.stepDifficulty).toBeCloseTo(expected.stepDifficulty, 6);
            expect(got.bucket).toBe(expected.bucket);
            expect(got.comboKillerCnt).toBe(expected.comboKillerCnt);
            expect(got.comboLongBarCnt).toBe(expected.comboLongBarCnt);
            expect(got.scdScore).toBeCloseTo(expected.scdScore, 6);

            const feats = spawnStepDifficultyFeatures(input.shapes, input.occupiedCount);
            expect(feats).toHaveLength(SPAWN_STEP_DIFFICULTY_FEATURE_DIM);
            for (let i = 0; i < feats.length; i++) {
                expect(feats[i]).toBeCloseTo(expected.features[i], 6);
            }
        });
    }
});
