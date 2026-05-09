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
        _bestScoreAtRunStart: runBest,
        bestScore: currentBest,
        score,
        updateUI: vi.fn(),
        renderer: {
            triggerBonusMatchFlash: vi.fn(),
            triggerPerfectFlash: vi.fn(),
            setShake: vi.fn()
        }
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
