/**
 * @vitest-environment jsdom
 *
 * 消行动画收尾：iOS WebView 偶发丢弃 rAF 尾帧时，也必须释放动画锁并刷新候选池。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../web/src/game.js';

function makeClearEffectGame() {
    return {
        drag: { index: 2 },
        dragBlock: { id: '1x1', shape: [[1]], colorIdx: 0 },
        dockBlocks: [
            { id: 'a', placed: true },
            { id: 'b', placed: true },
            { id: 'c', placed: true },
        ],
        isAnimating: false,
        score: 0,
        bestScore: 1000,
        strategy: 'normal',
        gameStats: {
            score: 0,
            clears: 0,
            maxLinesCleared: 0,
            maxCombo: 0,
        },
        _spawnContext: { totalClears: 0 },
        _clearStreak: 0,
        _levelManager: null,
        grid: { getFillRatio: vi.fn(() => 0.5) },
        renderer: {
            addParticles: vi.fn(),
            setClearCells: vi.fn(),
            triggerBonusMatchFlash: vi.fn(),
            beginBonusIconGush: vi.fn(),
            beginBonusColorGush: vi.fn(),
            addBonusLineBurst: vi.fn(),
            triggerPerfectFlash: vi.fn(),
            triggerComboFlash: vi.fn(),
            triggerDoubleWave: vi.fn(),
            setShake: vi.fn(),
            updateShake: vi.fn(),
            updateParticles: vi.fn(),
            updateIconParticles: vi.fn(),
            clearParticles: vi.fn(),
        },
        logBehavior: vi.fn(),
        _maybeCelebrateNewBest: vi.fn(() => false),
        _isLowBestForIntenseCopy: vi.fn(() => false),
        showFloatScore: vi.fn(),
        markDirty: vi.fn(),
        _markDockBlockPlaced: vi.fn(),
        _refreshIntentSnapshot: vi.fn(),
        spawnBlocks: vi.fn(),
        updateUI: vi.fn(),
        checkGameOver: vi.fn(),
    };
}

describe('Game playClearEffect fallback', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('rAF 尾帧未执行时，定时兜底会刷新下一轮候选块', () => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', vi.fn());

        const game = makeClearEffectGame();
        Game.prototype.playClearEffect.call(game, {
            count: 1,
            cells: [{ x: 0, y: 0 }],
            bonusLines: [],
            perfectClear: false,
        });

        expect(game.isAnimating).toBe(true);
        expect(game.spawnBlocks).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1000);

        expect(game.isAnimating).toBe(false);
        expect(game._refreshIntentSnapshot).toHaveBeenCalledOnce();
        expect(game.spawnBlocks).toHaveBeenCalledOnce();
        expect(game.checkGameOver).toHaveBeenCalledOnce();
    });
});
