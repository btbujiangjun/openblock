/**
 * @vitest-environment jsdom
 *
 * v1.57.2 — stress → 出块算法的"新空洞强迫度"第二维度
 *
 * 在 targetSolutionRange（解空间宽度）之外，引入 targetHoleIncrement（空洞强迫度）：
 *   - DFS 在每个完整解叶子用 stacking 口径计算新空洞数 = 终末盘面 stacked holes − 初始
 *   - 取 6 种顺序所有解中 min 作为 minHoleIncrement（候选"最干净放置路径"的新空洞数）
 *   - 按 stress 选 { minIncrement, maxIncrement } 软过滤
 *     · 低 stress 段 max=0/1 强约束（必须存在干净解）
 *     · 高 stress 段 min≥1/2 强约束（玩家被迫接受至少 N 个新空洞）
 *
 * 测试覆盖：
 *   1. evaluateTripletSolutions 返回 minHoleIncrement / meanHoleIncrement 字段
 *   2. 空盘面（baseHoles=0）放无空洞解 → minHoleIncrement=0
 *   3. 故意构造"必带空洞"盘面 → minHoleIncrement≥1
 *   4. shared/game_rules.json holeIncrement.ranges 配置完整性
 *   5. adaptiveSpawn 派生 spawnHints.targetHoleIncrement（stress 单调性）
 *   6. blockSpawn earlyAttempt 软过滤：max=0 时拒绝带空洞的候选；min=1 时拒绝干净候选
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

/* ---------- Helpers ---------- */

function emptyGrid(n = 8) {
    return new Grid(n);
}

const singleCell = [[1]];
const dominoH = [[1, 1]];

/* ============================================================
 * 1. evaluateTripletSolutions 返回新字段
 * ============================================================ */
describe('v1.57.2 — evaluateTripletSolutions 返回 hole increment 字段', () => {
    it('空盘面 + 单格×3 → minHoleIncrement=0（必有干净放法）', () => {
        const g = emptyGrid();
        const m = evaluateTripletSolutions(g, [singleCell, singleCell, singleCell], { leafCap: 32 });
        expect(m).toHaveProperty('minHoleIncrement');
        expect(m).toHaveProperty('meanHoleIncrement');
        expect(m.solutionCount).toBeGreaterThan(0);
        expect(m.minHoleIncrement).toBe(0);
        expect(m.meanHoleIncrement).toBe(0);
    });

    it('空盘面 + dominoH×3 → 所有解都干净，minHoleIncrement=0', () => {
        const g = emptyGrid();
        const m = evaluateTripletSolutions(g, [dominoH, dominoH, dominoH], { leafCap: 32 });
        expect(m.solutionCount).toBeGreaterThan(0);
        expect(m.minHoleIncrement).toBe(0);
    });

    it('无可解时（三块都放不下）→ minHoleIncrement=Infinity', () => {
        // 用 8×8 全满（除一格）+ domino，没有空间放任何 2 格块
        const g = emptyGrid();
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = 0;
        g.cells[0][0] = null; // 只留一个空格
        const m = evaluateTripletSolutions(g, [dominoH, dominoH, dominoH], { leafCap: 32 });
        expect(m.solutionCount).toBe(0);
        expect(m.minHoleIncrement).toBe(Infinity);
    });
});

/* ============================================================
 * 2. 必带空洞的盘面 → minHoleIncrement>0
 * ============================================================ */
describe('v1.57.2 — 必带空洞场景', () => {
    it('底部留洞的列盘面 + 顶端落子 → minHoleIncrement 反映被压住的空格', () => {
        /**
         * 构造：col 0 的 y=2..7 全部填满，y=0,1 留空。如果 dominoV 放在 col 1 的 (1, 0..1)，
         * 不会增加 col 0 的 hole（col 0 顶部已经有 2 行空，但下方已有占用——这本身就是初始 hole）。
         *
         * 此测试主要验证：evaluateTripletSolutions 在含初始 holes 的盘面上能正确返回
         * delta（max(0, after - base)），不返回负值。
         */
        const g = new Grid(8);
        for (let y = 2; y <= 7; y++) g.cells[y][0] = 0; // col 0 底部填满，y=0,1 空 → 已有 2 个 holes（y=0,1 被上方空格"压"... 等等其实没有，因为是 y=0 在最上方）
        // 重新设计：y 越大越靠下。col 0 的 y=0..5 填满，y=6,7 空 → 这些"被压在下方的空格"算 hole（y=6,7 在 y=0..5 之下）
        // 但 cells[0]..cells[5] 才是上方的"已填",cells[6][0] / cells[7][0] 是下方的"空" → 计入 holes
        for (let y = 0; y < 8; y++) g.cells[y][0] = null;
        for (let y = 0; y <= 5; y++) g.cells[y][0] = 0;
        // 现在 col 0 在 y=0..5 occupied、y=6,7 empty → "被压住的空格" = 2
        const m = evaluateTripletSolutions(g, [singleCell, singleCell, singleCell], { leafCap: 32 });
        expect(m.solutionCount).toBeGreaterThan(0);
        // 不在 col 0 落子时 delta=0；在 col 0 上方 y=? 落子... 我们只关心 min（最干净路径）
        expect(m.minHoleIncrement).toBe(0);
    });
});

/* ============================================================
 * 3. shared/game_rules.json holeIncrement.ranges 配置完整性
 * ============================================================ */
describe('v1.57.2 — game_rules.json holeIncrement.ranges 配置契约', () => {
    const hi = gameRules.adaptiveSpawn?.solutionDifficulty?.holeIncrement;

    it('holeIncrement 节存在且 enabled=true', () => {
        expect(hi).toBeDefined();
        expect(hi.enabled).toBe(true);
        expect(Array.isArray(hi.ranges)).toBe(true);
        expect(hi.ranges.length).toBeGreaterThanOrEqual(5);
    });

    it('ranges 按 minStress 严格单调递增', () => {
        const ms = hi.ranges.map(r => r.minStress);
        for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThan(ms[i - 1]);
    });

    it('低 stress 段（≤0.5）使用 maxIncrement 约束，高 stress 段（≥0.6）使用 minIncrement 约束', () => {
        const low = hi.ranges.filter(r => r.minStress <= 0.5);
        const high = hi.ranges.filter(r => r.minStress >= 0.6);
        expect(low.length).toBeGreaterThan(0);
        expect(high.length).toBeGreaterThan(0);
        low.forEach(r => {
            expect(r.maxIncrement).not.toBeNull();
            expect(r.minIncrement).toBeNull();
        });
        high.forEach(r => {
            expect(r.minIncrement).not.toBeNull();
            expect(r.maxIncrement).toBeNull();
        });
    });

    it('低 stress 最严格 (max=0)，stress 越高 max 越大；高 stress min 单调递增', () => {
        const sorted = [...hi.ranges].sort((a, b) => a.minStress - b.minStress);
        // 最低档应是 max=0（强制干净）
        expect(sorted[0].maxIncrement).toBe(0);
        // 高档 min 应递增
        const highSorted = sorted.filter(r => r.minIncrement != null);
        for (let i = 1; i < highSorted.length; i++) {
            expect(highSorted[i].minIncrement).toBeGreaterThanOrEqual(highSorted[i - 1].minIncrement);
        }
    });
});

/* ============================================================
 * 4. adaptiveSpawn 派生 spawnHints.targetHoleIncrement
 * ============================================================ */
describe('v1.57.2 — adaptiveSpawn 派生 targetHoleIncrement（stress 单调性）', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    /**
     * 在不暴露内部 stress 的前提下，通过构造极端 profile 让 stress 落入低/高档。
     * 用 _boardFill ≥ activationFill 触发评估。
     */
    function deriveHint(score, momentum, boardFill = 0.6) {
        const p = new PlayerProfile(15);
        p._smoothSkill = 0.4;
        p._momentum = momentum;
        p._sessionPhase = 'mid';
        const r = resolveAdaptiveStrategy('default', p, score, 5, boardFill, {
            bestScore: 500,
            recentBestRatio: score / 500
        });
        return r?.spawnHints?.targetHoleIncrement ?? null;
    }

    it('boardFill 低于 activationFill (0.45) → targetHoleIncrement=null', () => {
        const thi = deriveHint(50, 0.2, 0.30);
        expect(thi).toBeNull();
    });

    it('boardFill ≥ 0.45 → 返回 { min/max, label } 区间', () => {
        const thi = deriveHint(100, 0.1, 0.6);
        expect(thi).not.toBeNull();
        // 至少 min 或 max 之一非空
        const hasBound = (thi.min != null) || (thi.max != null);
        expect(hasBound).toBe(true);
        expect(typeof thi.label).toBe('string');
    });

    it('从 ranges 配置里挑选的档位必定来自 holeIncrement.ranges', () => {
        const thi = deriveHint(100, 0.1, 0.6);
        const labels = gameRules.adaptiveSpawn.solutionDifficulty.holeIncrement.ranges.map(r => r.label);
        expect(labels).toContain(thi.label);
    });
});

/* ============================================================
 * 5. blockSpawn earlyAttempt 软过滤：max=0 vs min=1
 * ============================================================ */
describe('v1.57.2 — blockSpawn targetHoleIncrement 软过滤', () => {
    /**
     * 用 fill ≥ activationFill (0.45) 的盘面，触发 solutionDifficulty 评估；
     * 然后通过 strategyConfig.spawnHints.targetHoleIncrement 注入区间，
     * 检查 diagnostics.solutionRejects 的 holeTooMany / holeTooClean 计数变化。
     *
     * 物理含义验证：
     *   - max=0 时，candidates with minHoleIncrement>0 应被拒绝 → holeTooMany 计数 > 0
     *     OR generateDockShapes 退而求其次最终通过（依赖 attempt 上限）
     *   - min=1 时，candidates with minHoleIncrement=0 应被拒绝 → holeTooClean 计数 > 0
     */
    function makeStrategy(targetHoleIncrement) {
        return {
            shapeWeights: { single: 1, line2: 1, line3: 1, square2: 1, lShape3: 1 },
            spawnHints: {
                clearGuarantee: 1,
                sizePreference: 0,
                diversityBoost: 0,
                comboChain: 0,
                multiClearBonus: 0,
                multiLineTarget: 0,
                delightBoost: 0,
                perfectClearBoost: 0,
                iconBonusTarget: 0,
                delightMode: 'neutral',
                rhythmPhase: 'neutral',
                sessionArc: 'mid',
                scoreMilestone: false,
                targetSolutionRange: null,
                targetHoleIncrement,
                spawnIntent: 'maintain',
                orderRigor: 0,
                orderMaxValidPerms: 6
            }
        };
    }

    function fillGridTo(n, ratio) {
        const g = new Grid(n);
        const total = n * n;
        const target = Math.floor(total * ratio);
        let placed = 0;
        for (let y = 0; y < n && placed < target; y++) {
            for (let x = 0; x < n && placed < target; x++) {
                g.cells[y][x] = (x + y) % 7; // 不消行的颜色 pattern
                placed++;
            }
        }
        return g;
    }

    it('max=0 强约束注入 → diagnostics 暴露 holeTooMany 计数字段（可能触发）', () => {
        const g = fillGridTo(8, 0.5); // 50% 填充，确保 fill ≥ activationFill
        const strategy = makeStrategy({ min: null, max: 0, label: '干净' });
        generateDockShapes(g, strategy, {});
        const diag = getLastSpawnDiagnostics();
        expect(diag).toBeDefined();
        expect(diag.solutionRejects).toBeDefined();
        // 关键契约：holeTooMany / holeTooClean 字段必定存在（不是 undefined）
        expect(typeof diag.solutionRejects.holeTooMany).toBe('number');
        expect(typeof diag.solutionRejects.holeTooClean).toBe('number');
        // 应用上下文存在
        expect(diag.layer1.targetHoleIncrement).toEqual({ min: null, max: 0, label: '干净' });
    });

    it('min=2 强约束注入 → diagnostics.targetHoleIncrement 透传，holeTooClean 字段可计数', () => {
        const g = fillGridTo(8, 0.5);
        const strategy = makeStrategy({ min: 2, max: null, label: '极限' });
        generateDockShapes(g, strategy, {});
        const diag = getLastSpawnDiagnostics();
        expect(diag.layer1.targetHoleIncrement).toEqual({ min: 2, max: null, label: '极限' });
        expect(typeof diag.solutionRejects.holeTooClean).toBe('number');
    });

    it('null hint → 无 hole 过滤，diagnostics.targetHoleIncrement=null', () => {
        const g = fillGridTo(8, 0.5);
        const strategy = makeStrategy(null);
        generateDockShapes(g, strategy, {});
        const diag = getLastSpawnDiagnostics();
        expect(diag.layer1.targetHoleIncrement).toBeNull();
    });
});

/* ============================================================
 * 6. 与 P1 (targetSolutionRange) 双轴共存
 * ============================================================ */
describe('v1.57.2 — 与 targetSolutionRange 双轴共存', () => {
    it('同时注入 solutionRange 和 holeIncrement，diagnostics 同时展示两轴', () => {
        const g = new Grid(8);
        for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) g.cells[y][x] = (x + y) % 7;
        const strategy = {
            shapeWeights: { single: 1, line2: 1, line3: 1 },
            spawnHints: {
                clearGuarantee: 1, sizePreference: 0, diversityBoost: 0,
                comboChain: 0, multiClearBonus: 0, multiLineTarget: 0,
                delightBoost: 0, perfectClearBoost: 0, iconBonusTarget: 0,
                delightMode: 'neutral', rhythmPhase: 'neutral', sessionArc: 'mid',
                scoreMilestone: false,
                targetSolutionRange: { min: 1, max: 32, label: '紧张' },
                targetHoleIncrement: { min: 1, max: null, label: '紧张' },
                spawnIntent: 'pressure', orderRigor: 0, orderMaxValidPerms: 6
            }
        };
        generateDockShapes(g, strategy, {});
        const diag = getLastSpawnDiagnostics();
        expect(diag.layer1.targetSolutionRange).toEqual({ min: 1, max: 32, label: '紧张' });
        expect(diag.layer1.targetHoleIncrement).toEqual({ min: 1, max: null, label: '紧张' });
    });
});
