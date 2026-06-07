/**
 * Bonus 行列特征测试：
 * - 整行/整列同 icon（允许不同 colorIdx 映射到同一 icon）触发 bonus
 * - 无 icon 皮肤时，退化为“同颜色”触发 bonus
 * - 与 ClearRuleEngine.apply 联动时，必须在清除前检测
 */
import { describe, it, expect } from 'vitest';
import { GAME_RULES } from '../web/src/gameRules.js';
import { Grid } from '../web/src/grid.js';
import { ClearRuleEngine, RowColRule } from '../web/src/clearRules.js';
import {
    detectBonusLines,
    computeClearScore,
    ICON_BONUS_LINE_MULT,
    PERFECT_CLEAR_MULT,
    bonusEffectHoldMs,
    monoNearFullLineColorWeights,
    pickThreeDockColors,
} from '../web/src/game.js';
import {
    deriveComboMultiplier,
    deriveNextComboCount,
    isComboBroken,
    COMBO_MULTIPLIER_CFG,
} from '../web/src/clearScoring.js';
import { getAllShapes } from '../web/src/shapes.js';

function fillRow(grid, row, values) {
    for (let x = 0; x < grid.size; x++) grid.cells[row][x] = values[x];
}

function fillCol(grid, col, values) {
    for (let y = 0; y < grid.size; y++) grid.cells[y][col] = values[y];
}

function shapeLinePotential(shape) {
    const rows = new Set();
    const cols = new Set();
    for (let y = 0; y < shape.length; y++) {
        for (let x = 0; x < shape[y].length; x++) {
            if (!shape[y][x]) continue;
            rows.add(y);
            cols.add(x);
        }
    }
    return rows.size + cols.size;
}

function expectedScore(count, bonusCount, baseUnit = 20, perfectClear = false, comboMultiplier = 1) {
    const safeBonus = Math.min(bonusCount, count);
    const baseScore = count > 0 ? baseUnit * count * count : 0;
    const lineScore = baseUnit * count;
    const iconBonusScore = lineScore * safeBonus * (ICON_BONUS_LINE_MULT - 1);
    const clearScore = (baseScore + iconBonusScore) * (perfectClear ? PERFECT_CLEAR_MULT : 1) * comboMultiplier;
    return { baseScore, iconBonusScore, clearScore, comboMultiplier };
}

describe('bonus line feature', () => {
    it('bonus 计分倍率来自 shared/game_rules.json', () => {
        expect(ICON_BONUS_LINE_MULT).toBe(GAME_RULES.clearScoring.iconBonusLineMult);
    });

    it('清屏计分倍率来自 shared/game_rules.json', () => {
        expect(PERFECT_CLEAR_MULT).toBe(GAME_RULES.clearScoring.perfectClearMult);
    });

    it('当前形状库单次理论最大消除行列数为 6', () => {
        const maxLines = Math.max(...getAllShapes().map((s) => shapeLinePotential(s.data)));
        expect(maxLines).toBe(6);
    });

    it(`computeClearScore：每条 bonus 线为 ${ICON_BONUS_LINE_MULT} 倍行摊分（单消 +1 bonus 线）`, () => {
        const r = computeClearScore('normal', { count: 1, bonusLines: [{ type: 'row', idx: 0 }] });
        expect(r.baseScore).toBe(20);
        expect(r.iconBonusScore).toBe(80);
        expect(r.clearScore).toBe(100);
    });

    it('computeClearScore：覆盖 1~6 消、0~count 条 bonus 线，结果符合平方基础分公式', () => {
        for (let count = 1; count <= 6; count++) {
            for (let bonusCount = 0; bonusCount <= count; bonusCount++) {
                const r = computeClearScore('normal', {
                    count,
                    bonusLines: Array.from({ length: bonusCount }, (_, idx) => ({ type: 'row', idx })),
                });
                const expected = expectedScore(count, bonusCount);
                expect(r).toEqual(expected);
                expect(r.baseScore % 10).toBe(0);
                expect(r.iconBonusScore % 10).toBe(0);
                expect(r.clearScore % 10).toBe(0);
            }
        }
    });

    it('computeClearScore：异常 bonusLines 数量超过消除线数时钳制到 count', () => {
        const r = computeClearScore('normal', {
            count: 2,
            bonusLines: [{}, {}, {}],
        });
        expect(r).toEqual(expectedScore(2, 2));
    });

    it('computeClearScore：清屏会在基础分与 bonus 分之后整体乘以清屏倍率', () => {
        const r = computeClearScore('normal', {
            count: 2,
            bonusLines: [{ type: 'row', idx: 0 }],
            perfectClear: true,
        });
        expect(r).toEqual(expectedScore(2, 1, 20, true));
    });

    it('bonusEffectHoldMs 落在 3000–5000ms', () => {
        expect(bonusEffectHoldMs(1)).toBe(3400);
        expect(bonusEffectHoldMs(6)).toBe(5000);
        expect(bonusEffectHoldMs(0)).toBe(0);
    });

    it('整行同 icon（不同 colorIdx）可触发 bonus', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['A', 'B', 'C', 'D'] };
        // 0/4/8/12 -> 都映射到 icon 'A'
        fillRow(g, 2, [0, 4, 8, 12, 0, 4, 8, 12]);

        const bonus = detectBonusLines(g, skin);
        expect(bonus).toHaveLength(1);
        expect(bonus[0]).toMatchObject({ type: 'row', idx: 2, icon: 'A' });
    });

    it('整列同 icon（不同 colorIdx）可触发 bonus', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['X', 'Y'] };
        // 1/3/5/7 -> 都映射到 icon 'Y'
        fillCol(g, 6, [1, 3, 5, 7, 1, 3, 5, 7]);

        const bonus = detectBonusLines(g, skin);
        expect(bonus).toHaveLength(1);
        expect(bonus[0]).toMatchObject({ type: 'col', idx: 6, icon: 'Y' });
    });

    it('无 blockIcons 时按同颜色判断 bonus（同色行）', () => {
        const g = new Grid(8);
        const skin = { blockIcons: [] };
        fillRow(g, 4, [5, 5, 5, 5, 5, 5, 5, 5]);

        const bonus = detectBonusLines(g, skin);
        expect(bonus).toHaveLength(1);
        expect(bonus[0]).toMatchObject({ type: 'row', idx: 4, colorIdx: 5, icon: null });
    });

    it('整行已满但 icon 不一致时不触发 bonus', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['A', 'B', 'C', 'D'] };
        fillRow(g, 1, [0, 1, 2, 3, 0, 1, 2, 3]);

        const bonus = detectBonusLines(g, skin);
        expect(bonus).toHaveLength(0);
    });

    it('演示：先检测 bonus，再 apply 清除，特征不会丢失', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['A', 'B', 'C', 'D'] };
        fillRow(g, 0, [0, 4, 8, 12, 0, 4, 8, 12]); // row bonus
        fillCol(g, 7, [12, 0, 4, 8, 12, 0, 4, 8]); // col bonus（均映射为 A）

        const bonusBeforeApply = detectBonusLines(g, skin);
        const cleared = new ClearRuleEngine([RowColRule]).apply(g);

        expect(cleared.count).toBe(2);
        expect(bonusBeforeApply.map(b => `${b.type}:${b.idx}`).sort()).toEqual(['col:7', 'row:0']);
        // apply 后网格已清空对应行列（证明必须先检测）
        expect(g.cells[0].every(c => c === null)).toBe(true);
        expect(g.cells.every(row => row[7] === null)).toBe(true);
    });

    it('monoNearFullLineColorWeights：近满且同色行提高该 dock 色权重', () => {
        const g = new Grid(8);
        for (let x = 0; x < 6; x++) g.cells[2][x] = 3;
        // 两格空
        const w = monoNearFullLineColorWeights(g, { blockIcons: [] });
        expect(w[3]).toBeGreaterThan(0);
        expect(w[0]).toBe(0);
    });

    it('monoNearFullLineColorWeights：近满行同 icon 时给相关 dock 色加分', () => {
        const g = new Grid(8);
        const skin = { blockIcons: ['A', 'B', 'C', 'D'] };
        fillRow(g, 5, [0, 4, 8, 12, 0, 4, null, null]);
        const w = monoNearFullLineColorWeights(g, skin);
        expect(w[0]).toBeGreaterThan(0);
        expect(w[4]).toBeGreaterThan(0);
    });

    it('pickThreeDockColors：强偏置时高概率取到该色；且三色互异', () => {
        const bias = [100, 0, 0, 0, 0, 0, 0, 0];
        let hits = 0;
        for (let t = 0; t < 200; t++) {
            const c = pickThreeDockColors(bias);
            expect(new Set(c).size).toBe(3);
            if (c.includes(0)) hits++;
        }
        expect(hits).toBeGreaterThan(180);
    });

    /* === Combo 链（grace 窗口模型） === */

    describe('combo multiplier (deriveComboMultiplier + computeClearScore × comboCount)', () => {
        it('默认配置 grace=3 / activation=3 / step=1 / max=2：1~2 连无加成，3 连起 ×2 cap', () => {
            const cfg = COMBO_MULTIPLIER_CFG;
            expect(cfg).not.toBeNull();
            expect(cfg.gracePlacements).toBe(3);
            expect(cfg.activationCount).toBe(3);
            expect(cfg.maxMultiplier).toBe(2);
            expect(deriveComboMultiplier(0)).toBe(1);
            expect(deriveComboMultiplier(1)).toBe(1);
            expect(deriveComboMultiplier(2)).toBe(1);
            expect(deriveComboMultiplier(3)).toBe(2);
            expect(deriveComboMultiplier(4)).toBe(2);
            expect(deriveComboMultiplier(10)).toBe(2);
        });

        it('cfg.enabled=false 时全部退化为 ×1（向后兼容）', () => {
            expect(deriveComboMultiplier(5, { enabled: false, activationStreak: 3, stepBonus: 1, maxMultiplier: 2 })).toBe(1);
        });

        it('cfg=null 时（配置缺失）也回退 ×1', () => {
            expect(deriveComboMultiplier(5, null)).toBe(1);
        });

        it('自定义 max=4 / step=1：3 连 ×2、4 连 ×3、5+ 连 ×4 线性递增并 cap', () => {
            const cfg = { enabled: true, activationStreak: 3, stepBonus: 1, maxMultiplier: 4 };
            expect(deriveComboMultiplier(2, cfg)).toBe(1);
            expect(deriveComboMultiplier(3, cfg)).toBe(2);
            expect(deriveComboMultiplier(4, cfg)).toBe(3);
            expect(deriveComboMultiplier(5, cfg)).toBe(4);
            expect(deriveComboMultiplier(10, cfg)).toBe(4);
        });

        it('自定义 step=0.5：3 连 ×1.5、4 连 ×2、5+ 连 ×2 (cap)', () => {
            const cfg = { enabled: true, activationStreak: 3, stepBonus: 0.5, maxMultiplier: 2 };
            expect(deriveComboMultiplier(3, cfg)).toBe(1.5);
            expect(deriveComboMultiplier(4, cfg)).toBe(2);
            expect(deriveComboMultiplier(5, cfg)).toBe(2);
        });

        it('computeClearScore：comboCount<activation 时 clearScore 完全等价旧公式', () => {
            const r0 = computeClearScore('normal', { count: 2, bonusLines: [{ type: 'row', idx: 0 }] }, undefined, 0);
            const r1 = computeClearScore('normal', { count: 2, bonusLines: [{ type: 'row', idx: 0 }] }, undefined, 1);
            const r2 = computeClearScore('normal', { count: 2, bonusLines: [{ type: 'row', idx: 0 }] }, undefined, 2);
            expect(r0.clearScore).toBe(240);
            expect(r0.comboMultiplier).toBe(1);
            expect(r1.clearScore).toBe(240);
            expect(r2.clearScore).toBe(240);
        });

        it('computeClearScore：comboCount=3 时 clearScore 是旧公式的 2 倍且 comboMultiplier=2', () => {
            const r = computeClearScore('normal', { count: 2, bonusLines: [{ type: 'row', idx: 0 }] }, undefined, 3);
            expect(r.baseScore).toBe(80);
            expect(r.iconBonusScore).toBe(160);
            expect(r.clearScore).toBe(240 * 2);
            expect(r.comboMultiplier).toBe(2);
        });

        it('computeClearScore：combo × perfectClear 串行累乘（清屏 + 3 连 → ×10 × ×2 = ×20）', () => {
            const baseR = computeClearScore('normal', { count: 1, perfectClear: false }, undefined, 1);
            const comboPerfectR = computeClearScore('normal', { count: 1, perfectClear: true }, undefined, 3);
            expect(baseR.clearScore).toBe(20);
            expect(baseR.comboMultiplier).toBe(1);
            expect(comboPerfectR.clearScore).toBe(20 * 10 * 2);
            expect(comboPerfectR.comboMultiplier).toBe(2);
        });

        it('computeClearScore：count=0 时返回 comboMultiplier=1（早返回路径不漏字段）', () => {
            const r = computeClearScore('normal', { count: 0 }, undefined, 99);
            expect(r.clearScore).toBe(0);
            expect(r.comboMultiplier).toBe(1);
        });

        it('scoringOverride 携带 comboMultiplier=null 时关闭加成（回放场景）', () => {
            const r = computeClearScore('normal', { count: 1 }, {
                singleLine: 20,
                iconBonusLineMult: 5,
                perfectClearMult: 10,
                comboMultiplier: { enabled: false, activationCount: 3, stepBonus: 1, maxMultiplier: 2 }
            }, 5);
            expect(r.clearScore).toBe(20);
            expect(r.comboMultiplier).toBe(1);
        });
    });

    /* === Combo grace 窗口：用户示例完整状态机验证 === */

    describe('combo grace window (deriveNextComboCount + isComboBroken)', () => {
        const cfg = { enabled: true, gracePlacements: 3, activationCount: 3, stepBonus: 1, maxMultiplier: 2 };

        it('用户示例 1：连续清+缓冲清 → combo 一直累加', () => {
            /* 100 清 → 1; 101/102 未清; 103 清 → 2; 104/105 未清; 106 清 → 3 */
            // 100 清（首次启动，prev=0 → 1，gap 任意）
            let combo = 0, gap = Number.POSITIVE_INFINITY;
            combo = deriveNextComboCount(combo, gap, true, cfg);
            gap = 0;
            expect(combo).toBe(1);

            // 101 未清 → gap=1
            combo = deriveNextComboCount(combo, gap, false, cfg);
            gap += 1;
            expect(combo).toBe(1);
            expect(isComboBroken(gap, cfg)).toBe(false);

            // 102 未清 → gap=2
            combo = deriveNextComboCount(combo, gap, false, cfg);
            gap += 1;
            expect(combo).toBe(1);
            expect(isComboBroken(gap, cfg)).toBe(false);

            // 103 清 → gap=2 < grace=3 → combo+=1 = 2
            combo = deriveNextComboCount(combo, gap, true, cfg);
            gap = 0;
            expect(combo).toBe(2);

            // 104/105 未清
            combo = deriveNextComboCount(combo, gap, false, cfg);
            gap += 1;
            combo = deriveNextComboCount(combo, gap, false, cfg);
            gap += 1;

            // 106 清 → gap=2 < 3 → combo+=1 = 3
            combo = deriveNextComboCount(combo, gap, true, cfg);
            gap = 0;
            expect(combo).toBe(3);
            expect(deriveComboMultiplier(combo, cfg)).toBe(2);
        });

        it('用户示例 2：连续 ≥grace 步未清 → combo 已断、下次清线重置为 1', () => {
            /* 100 清 → 1; 101/102/103/104 都未清 → 待断; 105 清 → 重置为 1 */
            let combo = 0, gap = Number.POSITIVE_INFINITY;
            combo = deriveNextComboCount(combo, gap, true, cfg);
            gap = 0;
            expect(combo).toBe(1);

            // 101/102/103/104 都未清 → gap 累加到 4
            for (let i = 0; i < 4; i++) {
                combo = deriveNextComboCount(combo, gap, false, cfg);
                gap += 1;
            }
            expect(gap).toBe(4);
            expect(isComboBroken(gap, cfg)).toBe(true);
            expect(combo).toBe(1); // _comboCount 在 grace 期内本身不清零

            // 105 清 → gap=4 ≥ 3 → 重启 = 1
            combo = deriveNextComboCount(combo, gap, true, cfg);
            gap = 0;
            expect(combo).toBe(1);
        });

        it('gap = grace 边界：恰好等于 grace → 视为已断', () => {
            // grace=3：清 → 未清 →未清 →未清(此时 gap=3) → 清 时 combo 重置
            let combo = 0, gap = Number.POSITIVE_INFINITY;
            combo = deriveNextComboCount(combo, gap, true, cfg); gap = 0;
            for (let i = 0; i < 3; i++) {
                combo = deriveNextComboCount(combo, gap, false, cfg);
                gap += 1;
            }
            expect(gap).toBe(3);
            expect(isComboBroken(gap, cfg)).toBe(true);
            combo = deriveNextComboCount(combo, gap, true, cfg);
            expect(combo).toBe(1); // grace 已过 → 重启
        });

        it('gap = grace-1 边界：刚好在窗口内 → combo 延续', () => {
            let combo = 0, gap = Number.POSITIVE_INFINITY;
            combo = deriveNextComboCount(combo, gap, true, cfg); gap = 0;
            for (let i = 0; i < 2; i++) { // 2 步未清，gap=2
                combo = deriveNextComboCount(combo, gap, false, cfg);
                gap += 1;
            }
            expect(gap).toBe(2);
            expect(isComboBroken(gap, cfg)).toBe(false);
            combo = deriveNextComboCount(combo, gap, true, cfg);
            expect(combo).toBe(2); // 延续
        });

        it('未清线时返回 prev 不变（gap 累加由调用方维护）', () => {
            expect(deriveNextComboCount(5, 2, false, cfg)).toBe(5);
            expect(deriveNextComboCount(0, 0, false, cfg)).toBe(0);
        });

        it('首次启动：prev=0 且 cleared=true → 返回 1，与 gap 无关', () => {
            expect(deriveNextComboCount(0, 0, true, cfg)).toBe(1);
            expect(deriveNextComboCount(0, 100, true, cfg)).toBe(1);
            expect(deriveNextComboCount(0, Number.POSITIVE_INFINITY, true, cfg)).toBe(1);
        });

        it('grace=1（严格连击）等价于旧 _clearStreak 模型：未清立即断', () => {
            const strict = { ...cfg, gracePlacements: 1 };
            let combo = deriveNextComboCount(0, Infinity, true, strict); // 1
            expect(combo).toBe(1);
            // 任意 1 步未清 → gap=1 = grace → 下次清线重启
            combo = deriveNextComboCount(combo, 1, true, strict);
            expect(combo).toBe(1);
            // 连续清：gap=0 < grace → 延续
            combo = deriveNextComboCount(combo, 0, true, strict);
            expect(combo).toBe(2);
        });

        it('enabled=false：所有调用恒返回 0（disabled），combo 体系完全关闭', () => {
            const off = { ...cfg, enabled: false };
            expect(deriveNextComboCount(0, Infinity, true, off)).toBe(0);
            expect(deriveNextComboCount(5, 0, true, off)).toBe(0);
            expect(isComboBroken(0, off)).toBe(true);
            expect(deriveComboMultiplier(10, off)).toBe(1);
        });

        it('端到端：30 步序列下与 web 主局完全同口径的 combo 与 score 演进', () => {
            /* 模拟一段长序列，验证 combo 状态机不会漂移、与 computeClearScore 集成正确 */
            const pattern = [
                /* idx 0~9 */  1, 1, 1, 0, 0, 1, 0, 0, 0, 1,  // 持续打节奏后断
                /* idx 10~19 */ 1, 1, 0, 1, 1, 1, 1, 1, 1, 1,  // 连续高 combo
                /* idx 20~29 */ 0, 0, 0, 1, 0, 0, 1, 0, 0, 1,  // grace 重置后再启动
            ];
            const expectedCombos = [];
            const expectedScoresEach = [];
            let combo = 0, gap = Number.POSITIVE_INFINITY;
            for (const cleared of pattern) {
                if (cleared === 1) {
                    combo = deriveNextComboCount(combo, gap, true, cfg);
                    gap = 0;
                } else {
                    gap = (gap === Infinity) ? Infinity : gap + 1;
                }
                expectedCombos.push(cleared === 1 ? combo : null);
                if (cleared === 1) {
                    expectedScoresEach.push(
                        computeClearScore('normal', { count: 1 }, undefined, combo).clearScore
                    );
                }
            }
            /* 手算: 1,1,1,0,0,1,0,0,0,1,1,1,0,1,1,1 →
             *       combo: 1,2,3,3,3,4,4,4,4,1,2,3,3,4,5,6
             *       第 9 步 gap=3 已断 → 重置为 1；第 12 步 gap=1 < 3 仍延续 */
            expect(expectedCombos[2]).toBe(3);    // 三连击
            expect(expectedCombos[5]).toBe(4);    // 缓冲后延续
            expect(expectedCombos[9]).toBe(1);    // 3 步未清 → 已断、重启
            expect(expectedCombos[15]).toBe(6);   // 后段持续累加
            /* 后段 idx 16~19 = 1,1,1,1 → 持续递增 */
            expect(expectedCombos[19]).toBe(10);
            /* 高 combo 时单消得分 = 20 × 2 (cap) = 40；低 combo (1,2) = 20 */
            for (let i = 0; i < expectedCombos.length; i++) {
                const c = expectedCombos[i];
                if (c == null) continue;
                const score = computeClearScore('normal', { count: 1 }, undefined, c).clearScore;
                expect(score).toBe(c >= 3 ? 40 : 20);
            }
        });
    });
});

