/**
 * 新手村（newbieVillage）单测
 *
 * 重点：验证 5 类消行演示（单消/多消/同花/连击/清屏）在「按设计落点落子」后，
 * 用**真实计分链路**（clearScoring.computeClearScore / detectBonusLines /
 * deriveNextComboCount）结算出的分数，与 shared/game_rules.json 的规则严格一致。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom 在本仓库 vitest 配置下 localStorage 行为不稳定，按现有测试惯例注入 mock
const _store = {};
vi.stubGlobal('localStorage', {
    getItem: (k) => _store[k] ?? null,
    setItem: (k, v) => { _store[k] = String(v); },
    removeItem: (k) => { delete _store[k]; },
});

const {
    SCENARIO,
    applyPiece,
    computeClears,
    scorePlacement,
    shapeCells,
    shouldShowNewbieVillage,
    NEWBIE_VILLAGE_STORAGE_KEY,
    __resetForTest,
} = await import('../web/src/onboarding/newbieVillage.js');
const { deriveNextComboCount } = await import('../web/src/clearScoring.js');
const { getShapeById } = await import('../web/src/shapes.js');

beforeEach(() => {
    __resetForTest();
    for (const k of Object.keys(_store)) delete _store[k];
});

/** 忠实回放一课：按 target 逐枚落子，combo 链按 grace 窗口推进，返回每手结算 + 总分 */
function playLesson(step) {
    let board = step.seed();
    let combo = 0;
    let rounds = Infinity;
    let total = 0;
    const placements = [];
    for (const piece of step.pieces) {
        // 锁定落点必须落在空格
        for (const [dx, dy] of piece.cells) {
            expect(board[piece.target[1] + dy][piece.target[0] + dx]).toBeNull();
        }
        board = applyPiece(board, piece, piece.target);
        const cleared = computeClears(board).lines > 0;
        combo = deriveNextComboCount(combo, rounds, cleared);
        rounds = cleared ? 0 : rounds + 1;
        const scored = scorePlacement(board, combo);
        board = scored.afterBoard;
        total += scored.score.clearScore;
        placements.push({ scored, combo });
    }
    return { placements, total, finalBoard: board };
}

const lesson = (id) => SCENARIO.find((s) => s.id === id);

describe('shouldShowNewbieVillage', () => {
    it('首登（lifetimeGames=0、无本地记录）应展示', () => {
        expect(shouldShowNewbieVillage({ game: { playerProfile: { lifetimeGames: 0 } } })).toBe(true);
    });
    it('已玩过不展示', () => {
        expect(shouldShowNewbieVillage({ game: { playerProfile: { lifetimeGames: 3 } } })).toBe(false);
    });
    it('已完成/已跳过不再展示', () => {
        localStorage.setItem(NEWBIE_VILLAGE_STORAGE_KEY, JSON.stringify({ done: true }));
        expect(shouldShowNewbieVillage({ game: { playerProfile: { lifetimeGames: 0 } } })).toBe(false);
    });
});

describe('computeClears（8×8，colorIdx 0 不可误判为空）', () => {
    it('colorIdx=0 填满的行也应判定为满', () => {
        const board = Array.from({ length: 8 }, () => Array(8).fill(null));
        for (let c = 0; c < 8; c++) board[7][c] = 0; // 全 0 色
        expect(computeClears(board).lines).toBe(1);
    });
    it('空盘无消除', () => {
        const board = Array.from({ length: 8 }, () => Array(8).fill(null));
        expect(computeClears(board).lines).toBe(0);
    });
});

describe('演示方块必须是真实候选块（非单格）', () => {
    it('每枚演示块都对应 shapes.json 里的真实形状，且为多格', () => {
        for (const step of SCENARIO) {
            for (const piece of step.pieces) {
                expect(piece.shapeId, `${step.id} 缺少 shapeId`).toBeTruthy();
                const shape = getShapeById(piece.shapeId);
                expect(shape, `未知形状 ${piece.shapeId}`).toBeTruthy();
                // 不是「假的单格」
                expect(piece.cells.length).toBeGreaterThan(1);
                // cells 与真实形状 data 严格一致
                expect(piece.cells).toEqual(shapeCells(piece.shapeId));
            }
        }
    });
});

describe('预铺盘不得出现孤立单格（须由多格形状拼搭）', () => {
    for (const step of SCENARIO) {
        it(`「${step.id}」预铺盘每个方块都连成块（存在同色相邻）`, () => {
            const b = step.seed();
            const H = b.length;
            const W = b[0].length;
            const singles = [];
            for (let r = 0; r < H; r++) {
                for (let c = 0; c < W; c++) {
                    const v = b[r][c];
                    if (v === null) continue;
                    const hasSameColorNeighbor =
                        (r > 0 && b[r - 1][c] === v)
                        || (r < H - 1 && b[r + 1][c] === v)
                        || (c > 0 && b[r][c - 1] === v)
                        || (c < W - 1 && b[r][c + 1] === v);
                    if (!hasSameColorNeighbor) singles.push([r, c]);
                }
            }
            expect(singles, `孤立单格: ${JSON.stringify(singles)}`).toEqual([]);
        });
    }
});

describe('SCENARIO 五课覆盖 + 真实计分一致', () => {
    it('覆盖单消/多消/同花/连击/清屏 5 类', () => {
        expect(SCENARIO.map((s) => s.id)).toEqual(['single', 'multi', 'mono', 'combo', 'perfect']);
    });

    it('单消：c=1，基础分 20×1²=20', () => {
        const { placements, total } = playLesson(lesson('single'));
        const { scored } = placements[0];
        expect(scored.result.count).toBe(1);
        expect(scored.result.bonusLines.length).toBe(0);
        expect(scored.score.clearScore).toBe(20);
        expect(total).toBe(20);
    });

    it('多消：c=2，基础分 20×2²=80（无同花）', () => {
        const { placements } = playLesson(lesson('multi'));
        const { scored } = placements[0];
        expect(scored.result.count).toBe(2);
        expect(scored.result.bonusLines.length).toBe(0);
        expect(scored.score.baseScore).toBe(80);
        expect(scored.score.clearScore).toBe(80);
    });

    it('同花：整行同色 → ×5（20 → 100）', () => {
        const { placements } = playLesson(lesson('mono'));
        const { scored } = placements[0];
        expect(scored.result.count).toBe(1);
        expect(scored.result.bonusLines.length).toBeGreaterThanOrEqual(1);
        expect(scored.score.iconBonusScore).toBe(80); // 20 ×1 ×(5-1)
        expect(scored.score.clearScore).toBe(100);
    });

    it('连击：连续 3 手清线 → ♥3 ×2，第 3 手 20×2=40', () => {
        const { placements } = playLesson(lesson('combo'));
        expect(placements.map((p) => p.combo)).toEqual([1, 2, 3]);
        expect(placements[0].scored.score.clearScore).toBe(20);
        expect(placements[1].scored.score.clearScore).toBe(20);
        expect(placements[2].scored.score.comboMultiplier).toBe(2);
        expect(placements[2].scored.score.clearScore).toBe(40);
    });

    it('清屏：清空棋盘 → perfect ×10（基础 80 → 800）', () => {
        const { placements, finalBoard } = playLesson(lesson('perfect'));
        const { scored } = placements[0];
        expect(scored.result.perfectClear).toBe(true);
        expect(scored.score.clearScore).toBe(800);
        // 清屏后盘面应全空
        expect(finalBoard.every((row) => row.every((v) => v === null))).toBe(true);
    });
});
