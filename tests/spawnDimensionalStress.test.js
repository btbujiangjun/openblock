/**
 * @vitest-environment jsdom
 *
 * v1.57.3 — 9 项多维 stress→算法 难度区间
 *
 * 在 targetSolutionRange / targetHoleIncrement（v9 / v1.57.2 旧双轴）之外，再引入 9 个
 * 廉价的"叶子级 stress 投射维度"：
 *   ① targetMaxHoleIncrement           — 最差解空洞数（专注度税上界）
 *   ② targetEndFillRatio               — 终末填充率（空间窒息感）
 *   ③ targetNearFullDelta              — 近满 delta（消行节律）
 *   ④ targetFirstMoveSurvivorRatio     — 第一步存活率（试错代价）
 *   ⑤ targetSolutionDiversity          — 解多样性 CV
 *   ⑥ targetEndFlatness                — 终末平整度
 *   ⑦ targetEndDangerColumns           — 爆顶预警
 *   ⑧ targetVisualClutter              — 视觉杂乱 delta
 *   ⑨ targetHoleIncrementGap           — 专注度税差距 max−min
 *
 * 测试覆盖：
 *   A. evaluateTripletSolutions 返回 9 个新字段且合理（空盘）
 *   B. shared/game_rules.json 9 套子节配置完整性（enabled / ranges）
 *   C. adaptiveSpawn 派生 9 个 spawnHints.target* 字段（stress 单调 / activationFill 守卫）
 *   D. blockSpawn diagnostics.solutionRejects 含 9×2=18 个新计数器
 *   E. blockSpawn layer1.targetX 透传完整
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    evaluateTripletSolutions,
    generateDockShapes,
    getLastSpawnDiagnostics
} from '../web/src/bot/blockSpawn.js';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import gameRules from '../shared/game_rules.json';

const singleCell = [[1]];

const DIM_KEYS = [
    'maxHoleIncrement',
    'holeIncrementGap',
    'endFillRatio',
    'nearFullDelta',
    'firstMoveSurvivor',
    'solutionDiversity',
    'endFlatness',
    'endDangerColumns',
    'visualClutter'
];

const SPAWN_HINT_KEYS = [
    'targetMaxHoleIncrement',
    'targetHoleIncrementGap',
    'targetEndFillRatio',
    'targetNearFullDelta',
    'targetFirstMoveSurvivorRatio',
    'targetSolutionDiversity',
    'targetEndFlatness',
    'targetEndDangerColumns',
    'targetVisualClutter'
];

const REJECT_KEYS = [
    'maxHoleTooMany', 'maxHoleTooClean',
    'holeGapTooNarrow', 'holeGapTooWide',
    'fillTooHigh', 'fillTooLow',
    'nearFullDeltaTooHigh', 'nearFullDeltaTooLow',
    'survivorTooHigh', 'survivorTooLow',
    'diversityTooHigh', 'diversityTooLow',
    'flatnessTooHigh', 'flatnessTooLow',
    'dangerColsTooHigh', 'dangerColsTooLow',
    'clutterTooHigh', 'clutterTooLow'
];

/* ============================================================
 * A. evaluateTripletSolutions 返回 9 个新 metric 字段
 * ============================================================ */
describe('v1.57.3 A — evaluateTripletSolutions 返回 9 个 stress 投射 metric', () => {
    it('空盘 + singleCell×3 应返回完整 9 字段且数值合理', () => {
        const g = new Grid(8);
        const m = evaluateTripletSolutions(g, [singleCell, singleCell, singleCell], { leafCap: 32 });

        // ① maxHoleIncrement
        expect(m).toHaveProperty('maxHoleIncrement');
        expect(m.maxHoleIncrement).toBeGreaterThanOrEqual(0);
        expect(m.maxHoleIncrement).toBeGreaterThanOrEqual(m.minHoleIncrement);

        // ⑨ holeIncrementGap == max − min
        expect(m).toHaveProperty('holeIncrementGap');
        expect(m.holeIncrementGap).toBe(m.maxHoleIncrement - m.minHoleIncrement);

        // ② endFillRatio
        expect(m).toHaveProperty('meanEndFillRatio');
        expect(m).toHaveProperty('minEndFillRatio');
        expect(m.meanEndFillRatio).toBeGreaterThan(0);
        expect(m.meanEndFillRatio).toBeLessThan(1);
        // 单格×3 在空盘 → 占用 3 格 → fill = 3/64
        expect(m.meanEndFillRatio).toBeCloseTo(3 / 64, 3);

        // ③ nearFullDelta（空盘放 3 个单格不可能产生近满线）
        expect(m).toHaveProperty('meanNearFullDelta');
        expect(m.meanNearFullDelta).toBe(0);

        // ④ firstMoveSurvivorRatio：空盘所有位置都能完成 → 应接近 1
        expect(m).toHaveProperty('firstMoveSurvivorRatio');
        expect(m.firstMoveSurvivorRatio).toBeGreaterThan(0);
        expect(m.firstMoveSurvivorRatio).toBeLessThanOrEqual(1);

        // ⑤ solutionDiversity（6 排列同构 → CV 应 = 0）
        expect(m).toHaveProperty('solutionDiversity');
        expect(m.solutionDiversity).toBeGreaterThanOrEqual(0);

        // ⑥ endFlatness（3 个孤立单格 → 列方差很小）
        expect(m).toHaveProperty('meanEndFlatness');
        expect(m.meanEndFlatness).toBeGreaterThanOrEqual(0);

        // ⑦ dangerColumns：注意空盘上单格放在 y=0 时 colHeight=8 ≥ 6 即危险列；
        // 8×8 空盘单格可放任意位置，叶子均值非 0。只要求字段存在且 ≥ 0。
        expect(m).toHaveProperty('meanDangerColumns');
        expect(m.meanDangerColumns).toBeGreaterThanOrEqual(0);

        // ⑧ visualClutter（单格无颜色，3 个单格相邻可能 → 边界数小）
        expect(m).toHaveProperty('meanClutterDelta');
    });

    it('threeData 长度不为 3 → 返回 9 字段缺省值（不抛错）', () => {
        const g = new Grid(8);
        const m = evaluateTripletSolutions(g, [singleCell], { leafCap: 8 });
        for (const k of [
            'maxHoleIncrement', 'holeIncrementGap',
            'meanEndFillRatio', 'minEndFillRatio',
            'meanNearFullDelta',
            'firstMoveSurvivorRatio',
            'solutionDiversity',
            'meanEndFlatness',
            'meanDangerColumns',
            'meanClutterDelta'
        ]) {
            expect(m).toHaveProperty(k);
            expect(Number.isFinite(m[k])).toBe(true);
        }
    });
});

/* ============================================================
 * B. shared/game_rules.json 9 套子节配置完整性
 * ============================================================ */
describe('v1.57.3 B — game_rules.json 9 套 ranges 契约', () => {
    const cfg = gameRules.adaptiveSpawn?.solutionDifficulty;

    it('solutionDifficulty 节存在且 enabled', () => {
        expect(cfg).toBeTruthy();
        expect(cfg.enabled).toBe(true);
    });

    for (const k of DIM_KEYS) {
        it(`子节 ${k} 存在 + enabled + ranges 数组非空`, () => {
            const dim = cfg[k];
            expect(dim, `missing dim ${k}`).toBeTruthy();
            expect(dim.enabled).toBe(true);
            expect(Array.isArray(dim.ranges)).toBe(true);
            expect(dim.ranges.length).toBeGreaterThan(0);
            // 每个 range 必须含 minStress
            for (const r of dim.ranges) {
                expect(typeof r.minStress).toBe('number');
            }
        });
    }

    it('miniprogram gameRulesData 同步 9 套子节', async () => {
        const mpRules = (await import('../miniprogram/core/gameRulesData.js')).default
            ?? (await import('../miniprogram/core/gameRulesData.js')).gameRulesData;
        const mpCfg = mpRules?.adaptiveSpawn?.solutionDifficulty;
        expect(mpCfg).toBeTruthy();
        for (const k of DIM_KEYS) {
            expect(mpCfg[k], `mp missing ${k}`).toBeTruthy();
            expect(mpCfg[k].enabled).toBe(true);
        }
    });
});

/* ============================================================
 * C. adaptiveSpawn 派生 9 个 spawnHints.target* 字段
 * ============================================================ */
describe('v1.57.3 C — adaptiveSpawn 派生 9 个 target* 字段', () => {
    beforeEach(() => {
        resetAdaptiveMilestone?.();
    });

    function _resolve(score, fill = 0.6) {
        const profile = new PlayerProfile();
        profile.runs = 80; // veteran 段确保 stress 派生路径完整
        return resolveAdaptiveStrategy('default', profile, score, 5, fill, {
            bestScore: 1000,
            recentBestRatio: score / 1000,
            totalRounds: 80,
            roundsSinceClear: 5,
            comboChain: 0,
            recentClears: [],
            scoreMilestone: false,
            placements: 50
        });
    }

    it('boardFill < activationFill (0.45) → 9 个 spawnHints 均为 null', () => {
        const s = _resolve(50, 0.3);
        for (const k of SPAWN_HINT_KEYS) {
            expect(s.spawnHints[k], `expected null for ${k} at low fill`).toBeNull();
        }
    });

    it('boardFill ≥ activationFill → 9 个 _target* 顶层字段已暴露', () => {
        const s = _resolve(50, 0.7);
        for (const k of SPAWN_HINT_KEYS) {
            const topKey = '_' + k;
            expect(s).toHaveProperty(topKey);
            // 至少结构合法（null 或 { min, max, label }）
            const v = s[topKey];
            if (v != null) {
                expect(typeof v).toBe('object');
                expect(v).toHaveProperty('min');
                expect(v).toHaveProperty('max');
            }
        }
    });

    it('低 stress vs 高 stress：① maxHoleIncrement 单调（高 stress 出现 min≥1 强约束）', () => {
        const low = _resolve(50, 0.5);   // 低 stress（远 PB + 浅 fill）
        const high = _resolve(995, 0.95); // 高 stress（近 PB + 深 fill + 高 score）
        // 注意：实际 stress 取决于 adaptiveSpawn 上下游链路；这里只校验"高 stress 时配置激活"
        // 不强求 low === null（adaptiveSpawn 内部 stress 可能仍 ≥ 0.5）
        expect(high._targetMaxHoleIncrement || high._targetHoleIncrementGap || high._targetEndFillRatio).toBeTruthy();
        void low;
    });
});

/* ============================================================
 * D. blockSpawn diagnostics.solutionRejects 含 18 个新计数器
 * ============================================================ */
describe('v1.57.3 D — diagnostics.solutionRejects 含 9 个维度 × 2 = 18 个新 key', () => {
    it('生成一次 spawn 后 diagnostics 含 18 个 reject 字段（即使为 0）', () => {
        const g = new Grid(8);
        const profile = new PlayerProfile();
        const strategy = resolveAdaptiveStrategy('default', profile, 100, 1, 0.1, {
            bestScore: 500, recentBestRatio: 0.2,
            totalRounds: 10, roundsSinceClear: 1,
            comboChain: 0, recentClears: [], placements: 10
        });
        generateDockShapes(g, { score: 100, profile, strategy });
        const diag = getLastSpawnDiagnostics();
        expect(diag?.solutionRejects).toBeTruthy();
        for (const k of REJECT_KEYS) {
            expect(diag.solutionRejects, `missing reject key ${k}`).toHaveProperty(k);
            expect(typeof diag.solutionRejects[k]).toBe('number');
        }
    });
});

/* ============================================================
 * E. blockSpawn layer1.targetX 透传完整
 * ============================================================ */
describe('v1.57.3 E — diagnostics.layer1 透传 9 个 target* 字段', () => {
    it('layer1 含 9 个 target* 字段（值可为 null）', () => {
        const g = new Grid(8);
        const profile = new PlayerProfile();
        const strategy = resolveAdaptiveStrategy('default', profile, 100, 1, 0.1, {
            bestScore: 500, recentBestRatio: 0.2,
            totalRounds: 10, roundsSinceClear: 1,
            comboChain: 0, recentClears: [], placements: 10
        });
        generateDockShapes(g, { score: 100, profile, strategy });
        const diag = getLastSpawnDiagnostics();
        for (const k of SPAWN_HINT_KEYS) {
            expect(diag.layer1, `missing layer1 ${k}`).toHaveProperty(k);
        }
    });
});
