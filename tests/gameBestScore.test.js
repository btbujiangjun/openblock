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

// ── v1.56.7：updateUI 调用顺序回归（防止 best DOM 滞后一帧） ──────────────
// 用户截图反馈："得分 210 / 最佳 140 / 已超 190" —— 三数错乱
//   根因：_maybeCelebrateNewBest 在 updateUI 末尾才调用，"最佳" DOM 已用旧值写入
//   修复：把 _maybeCelebrateNewBest 移到 updateUI 开头（DOM 写入之前）
// 测试方法：mock 一个 _maybeCelebrateNewBest 记录调用时 DOM "best" 值，
//          验证调用时 DOM 尚未写入（顺序正确）

describe('v1.56.7 updateUI 顺序：_maybeCelebrateNewBest 必须在 best DOM 写入之前', () => {
    beforeEach(() => {
        document.body.innerHTML = `
            <div id="score"></div>
            <div id="best">OLD</div>
            <div id="best-strategy-badge"></div>
            <div id="best-gap"></div>
        `;
    });

    it('updateUI 调用 _maybeCelebrateNewBest 时，best DOM 仍是上一帧的值', () => {
        /* 关键契约：_maybeCelebrateNewBest 在 best DOM 写入之前被调用。
         * 这样庆祝路径内同步 bestScore 后，紧接着的 DOM 写入能用上最新值。 */
        let bestDomAtCelebrateCall = null;
        const game = {
            score: 210,
            bestScore: 140,
            strategy: 'normal',
            _bestScoreAtRunStart: 20,
            _lastDisplayedScore: 0,
            _newBestCelebrated: true,
            _newBestCelebrationCount: 1,
            _levelMode: 'endless',
            gameStats: { placements: 10 },
            _isLowBestForIntenseCopy: () => false,
            _updateProgressionHud: vi.fn(),
            _maybeEmitNearPersonalBest: vi.fn(),
            _maybeCelebrateNewBest: function () {
                // 抓拍调用时 DOM 上 best 的值
                bestDomAtCelebrateCall = document.getElementById('best').textContent;
                // 模拟静默分支：把 bestScore 同步到 score
                this.bestScore = this.score;
            }
        };
        Game.prototype.updateUI.call(game);
        // 调用时 best DOM 仍是初始值 "OLD"（_maybeCelebrateNewBest 在写 DOM 之前执行）
        expect(bestDomAtCelebrateCall).toBe('OLD');
        // updateUI 结束后 best DOM 同步到 210（因为 _maybeCelebrateNewBest 已经
        // 把 bestScore 从 140 更新到 210，紧接着的 DOM 写入才能用上最新值）
        expect(document.getElementById('best').textContent).toBe('210');
    });

    it('修复用户截图场景：得分 210 / baseline 20 / bestScore 起始 140 → DOM 最终对齐', () => {
        const game = {
            score: 210,
            bestScore: 140, // 进入 updateUI 时内存 bestScore 滞后
            strategy: 'normal',
            _bestScoreAtRunStart: 20,
            _lastDisplayedScore: 140,
            _newBestCelebrated: true,
            _newBestCelebrationCount: 1,
            _levelMode: 'endless',
            gameStats: { placements: 10 },
            _isLowBestForIntenseCopy: () => false,
            _updateProgressionHud: vi.fn(),
            _maybeEmitNearPersonalBest: vi.fn(),
            _maybeCelebrateNewBest: function () {
                // 复刻真实静默分支
                if (this.score > this.bestScore) this.bestScore = this.score;
            }
        };
        Game.prototype.updateUI.call(game);
        // 三数关系自洽：最佳 = 210，best-gap "本局 +190"（参照 baseline=20）
        expect(document.getElementById('best').textContent).toBe('210');
        const gapText = document.getElementById('best-gap').textContent;
        expect(gapText).toContain('190');
    });

    it('追平开局基线（score === baseline）→ best-gap 隐藏（不显示"本局 +0"）', () => {
        const game = {
            score: 300,
            bestScore: 300,
            strategy: 'normal',
            _bestScoreAtRunStart: 300,
            _lastDisplayedScore: 300,
            _newBestCelebrated: true,
            _newBestCelebrationCount: 1,
            _levelMode: 'endless',
            gameStats: { placements: 10 },
            _isLowBestForIntenseCopy: () => false,
            _updateProgressionHud: vi.fn(),
            _maybeEmitNearPersonalBest: vi.fn(),
            _maybeCelebrateNewBest: vi.fn()
        };
        Game.prototype.updateUI.call(game);
        const gapEl = document.getElementById('best-gap');
        // gap === 0 时 msg 保持 undefined，gapEl 被显式 hide
        expect(gapEl.hidden).toBe(true);
    });
});
