/**
 * @vitest-environment jsdom
 *
 * 消行动效（v1.61 重构）：
 *   - 逻辑结算（候选区重抽 / 刷新快照 / 结束判定）在放块当帧立即完成，不再等动画播完，
 *     以便玩家在火花未散时即可继续放置——消除"动效期间无法放块"的爽感损耗。
 *   - 视觉特效作为非阻塞 overlay；isAnimating 仅标记特效进行中，结束（含 iOS 丢弃 rAF
 *     尾帧时的定时兜底）后复位。
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

    it('逻辑结算（重抽/刷新/结束判定）在放块当帧立即完成，不等动画', () => {
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', vi.fn());

        const game = makeClearEffectGame();
        Game.prototype.playClearEffect.call(game, {
            count: 1,
            cells: [{ x: 0, y: 0 }],
            bonusLines: [],
            perfectClear: false,
        });

        // 视觉特效仍在进行
        expect(game.isAnimating).toBe(true);
        // 但逻辑结算已立即完成，玩家可继续操作
        expect(game._refreshIntentSnapshot).toHaveBeenCalledOnce();
        expect(game.spawnBlocks).toHaveBeenCalledOnce();
        expect(game.checkGameOver).toHaveBeenCalledOnce();
    });

    it('rAF 尾帧未执行时，定时兜底会复位特效态', () => {
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
        expect(game.renderer.clearParticles).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1000);

        expect(game.isAnimating).toBe(false);
        expect(game.renderer.clearParticles).toHaveBeenCalledOnce();
    });
});
