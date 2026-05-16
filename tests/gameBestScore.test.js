/**
 * @vitest-environment jsdom
 *
 * 最高分庆祝：必须严格超过开局历史最佳，追平不触发。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Game } from '../web/src/game.js';

function makeGameForBest({ runBest = 1440, currentBest = runBest, score = 0 } = {}) {
    return {
        _newBestCelebrated: false,
        _newBestCelebrationCount: 0,
        _bestScoreAtRunStart: runBest,
        bestScore: currentBest,
        score,
        strategy: 'normal',
        gameStats: { placements: 0 },
        updateUI: vi.fn(),
        renderer: {
            triggerBonusMatchFlash: vi.fn(),
            triggerPerfectFlash: vi.fn(),
            setShake: vi.fn()
        },
        /* v1.55 §4.9 / §4.12：补 mock 方法以兼容 _maybeCelebrateNewBest 新引入的副作用 */
        _emitPersonalBestEvent: vi.fn(),
        _startPostPbReleaseWindow: vi.fn()
    };
}

describe('Game new best celebration', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('追平开局历史最佳不触发 NEW BEST 动效', () => {
        const game = makeGameForBest({ runBest: 1440, score: 1440 });
        const madeNewBest = Game.prototype._maybeCelebrateNewBest.call(game, 1200);

        expect(madeNewBest).toBe(false);
        expect(game._newBestCelebrated).toBe(false);
        expect(game.updateUI).not.toHaveBeenCalled();
        expect(game.renderer.triggerBonusMatchFlash).not.toHaveBeenCalled();
        expect(document.querySelector('.new-best-popup')).toBeNull();
    });

    it('严格超过开局历史最佳才触发 NEW BEST 动效', () => {
        const game = makeGameForBest({ runBest: 1440, score: 1441 });
        const madeNewBest = Game.prototype._maybeCelebrateNewBest.call(game, 1440);

        expect(madeNewBest).toBe(true);
        expect(game._newBestCelebrated).toBe(true);
        expect(game.bestScore).toBe(1441);
        expect(game.updateUI).toHaveBeenCalledOnce();
        expect(game.renderer.triggerBonusMatchFlash).toHaveBeenCalledOnce();
        expect(document.querySelector('.new-best-popup')).not.toBeNull();
    });
});

// ── v1.55.11：追平最佳特效已撤销（_maybeCelebrateTiePersonalBest 现为 no-op） ──
//   产品反馈："追平不触发特效"——三态特效（蓝 milestone / 绿 tie / 金 new-best）
//   被简化为"只有金色破 PB 烟花"这一唯一激励事件。这里只保留契约回归测试，确保
//   任何输入下方法始终 return false 且不产生 DOM 副作用。

describe('Game tie best celebration is disabled (v1.55.11)', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    function makeAnyGame({ runBest = 1440, score = runBest, alreadyCelebratedPb = false } = {}) {
        return {
            _newBestCelebrated: alreadyCelebratedPb,
            _tiedBestCelebratedThisRun: false,
            _bestScoreAtRunStart: runBest,
            bestScore: runBest,
            score,
            _anchorOnBoard: vi.fn(),
        };
    }

    it.each([
        { name: 'score === bestScore 且 best ≥ 500（曾经会触发的高 best 追平）', runBest: 1960, score: 1960 },
        { name: 'best < 500 的低 best 追平', runBest: 300, score: 300 },
        { name: 'score < bestScore 的进行中状态', runBest: 1960, score: 1500 },
        { name: 'score > bestScore 的已破 PB', runBest: 1960, score: 2000 },
    ])('始终返回 false（场景: $name）', ({ runBest, score }) => {
        const game = makeAnyGame({ runBest, score });
        const ok = Game.prototype._maybeCelebrateTiePersonalBest.call(game);
        expect(ok).toBe(false);
    });

    it('调用后不产生任何 DOM 节点（无副作用）', () => {
        const game = makeAnyGame({ runBest: 1960, score: 1960 });
        Game.prototype._maybeCelebrateTiePersonalBest.call(game);
        expect(document.querySelector('.float-tie-best')).toBeNull();
        expect(document.querySelector('.float-milestone')).toBeNull();
    });
});
