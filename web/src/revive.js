/**
 * ReviveManager — 复活系统（低侵入性插件）
 *
 * 设计原则
 * --------
 * 不修改 game.js 内部逻辑，通过"方法装饰"模式在 init(game) 时一次性
 * 包装 game.showNoMovesWarning，将复活界面注入到"没可用空间"提示之前。
 *
 * 复活机制
 * --------
 * 随机清除棋盘上 N 个已占用格子（默认 REVIVE_CLEAR_CELLS=12），
 * 为玩家创造继续落子的空间。清除后重新检查可用移动。
 *
 * 变现锚点
 * --------
 * - 观看广告（watchAd）：免费复活，调用 adAdapter.showRewardedAd()
 * - 跳过（skip）：直接结束，进入原有 game-over 流程
 * - 一局限 REVIVE_LIMIT 次，防止无限复活破坏体验
 *
 * 启用/禁用
 * --------
 *   import { ReviveManager } from './revive.js';
 *   const revive = new ReviveManager({ limit: 1, clearCells: 12 });
 *   revive.init(game);   // 在 Game 实例创建后、start() 前调用
 *
 * featureFlags 集成
 * -----------------
 * 若 featureFlags.revive === false，init 调用无效（仅输出 debug 日志）。
 */

const REVIVE_LIMIT_DEFAULT = 1;   // 每局最多复活次数
const REVIVE_CLEAR_CELLS   = 12;  // 复活时清除的格子数

export class ReviveManager {
    /**
     * @param {object} [opts]
     * @param {number} [opts.limit]       每局最多复活次数（默认 1）
     * @param {number} [opts.clearCells]  复活时清除格子数（默认 12）
     * @param {boolean} [opts.enabled]   强制开关（undefined = 读 featureFlags）
     */
    constructor(opts = {}) {
        this.limit      = opts.limit      ?? REVIVE_LIMIT_DEFAULT;
        this.clearCells = opts.clearCells ?? REVIVE_CLEAR_CELLS;
        this._enabled   = opts.enabled;
        this._usedCount = 0;   // 当局已复活次数
        this._game      = null;
        this._originalShowNoMovesWarning = null;
    }

    // ------------------------------------------------------------------
    // 公开 API
    // ------------------------------------------------------------------

    /**
     * 绑定到 Game 实例（一局仅调用一次）。
     * 通过装饰 game.showNoMovesWarning 实现零侵入注入。
     * @param {import('./game.js').Game} game
     */
    init(game) {
        if (!this._isEnabled()) {
            if (typeof __DEV__ !== 'undefined') console.debug('[ReviveManager] disabled');
            return;
        }
        this._game = game;
        this._originalShowNoMovesWarning = game.showNoMovesWarning.bind(game);

        // 装饰：拦截 showNoMovesWarning，在弹出"没可用空间"前先提供复活选项
        game.showNoMovesWarning = () => this._intercept();
    }

    /** 新局开始时重置复活次数（由 main.js 监听 game.start 调用） */
    resetForNewGame() {
        this._usedCount = 0;
    }

    /** 当前局是否还可复活 */
    canRevive() {
        return this._isEnabled() && this._usedCount < this.limit;
    }

    // ------------------------------------------------------------------
    // 内部实现
    // ------------------------------------------------------------------

    _isEnabled() {
        if (this._enabled !== undefined) return Boolean(this._enabled);
        try {
            // 兼容 featureFlags.js：优先读取
            const ff = window.__featureFlags ?? {};
            return ff.revive !== false;
        } catch {
            return true;
        }
    }

    /** 拦截入口：先展示复活弹层，再决定是否回落到原始 warning */
    _intercept() {
        if (!this.canRevive()) {
            // 已用完复活次数，直接走原始流程
            this._originalShowNoMovesWarning();
            return;
        }
        this._showReviveOverlay();
    }

    /** 构建并展示复活浮层 */
    _showReviveOverlay() {
        // 防止重复展示
        document.querySelectorAll('.revive-overlay').forEach(el => el.remove());
        clearTimeout(this._autoSkipTimer);

        const overlay = document.createElement('div');
        overlay.className = 'revive-overlay';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-label', '复活确认');
        overlay.innerHTML = this._buildHTML();

        document.body.appendChild(overlay);

        // 绑定按钮事件
        overlay.querySelector('.revive-btn-watch')?.addEventListener('click', () => {
            overlay.remove();
            clearTimeout(this._autoSkipTimer);
            this._handleWatchAd();
        });
        overlay.querySelector('.revive-btn-skip')?.addEventListener('click', () => {
            overlay.remove();
            clearTimeout(this._autoSkipTimer);
            this._handleSkip();
        });

        // 自动跳过兜底：4 秒无操作则进入原始 warning
        this._autoSkipTimer = setTimeout(() => {
            overlay.remove();
            this._originalShowNoMovesWarning();
        }, 4000);
    }

    _buildHTML() {
        const remaining = this.limit - this._usedCount;
        return `
<div class="revive-card">
  <div class="revive-icon" aria-hidden="true">💫</div>
  <p class="revive-title">继续游戏？</p>
  <p class="revive-desc">
    清除 ${this.clearCells} 个格子为你腾出空间
    <br><span class="revive-remain">剩余复活次数：${remaining}</span>
  </p>
  <div class="revive-actions">
    <button type="button" class="btn btn-primary revive-btn-watch">
      ▶ 观看广告复活
    </button>
    <button type="button" class="btn btn-secondary revive-btn-skip">
      放弃
    </button>
  </div>
</div>`;
    }

    /** 用户选择观看广告 */
    async _handleWatchAd() {
        let adSuccess = false;
        try {
            // 尝试调用广告适配器（若未接入则静默跳过）
            const { adAdapter } = await import('./monetization/adAdapter.js').catch(() => ({}));
            if (adAdapter?.showRewardedAd) {
                adSuccess = await adAdapter.showRewardedAd('revive');
            } else {
                // 开发模式下模拟广告完成
                adSuccess = true;
            }
        } catch {
            adSuccess = true;  // 广告失败时仍给予复活（优先体验）
        }

        if (adSuccess) {
            this._doRevive();
        } else {
            this._originalShowNoMovesWarning();
        }
    }

    /** 用户放弃复活 */
    _handleSkip() {
        this._originalShowNoMovesWarning();
    }

    /**
     * 执行复活：随机清除 N 个占用格子，然后重新检查可用移动
     */
    _doRevive() {
        const game = this._game;
        if (!game) return;

        this._usedCount++;

        // 收集占用格子坐标
        const occupied = [];
        const n = game.grid.size;
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (game.grid.cells[y][x] >= 0) {
                    occupied.push([x, y]);
                }
            }
        }

        // 随机 shuffle → 取前 clearCells 个
        for (let i = occupied.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [occupied[i], occupied[j]] = [occupied[j], occupied[i]];
        }
        const toClear = occupied.slice(0, Math.min(this.clearCells, occupied.length));

        // 清除格子
        for (const [x, y] of toClear) {
            game.grid.cells[y][x] = -1;
        }

        // 更新渲染
        if (game.renderer) {
            game.renderer.render(game.grid, game.dockBlocks);
        }

        // 记录行为日志
        try {
            const { GAME_EVENTS } = /** @type {any} */ (game);
            game.logBehavior?.('revive_used', {
                clearedCells: toClear.length,
                reviveCount: this._usedCount,
                score: game.score,
            });
        } catch {/* ignore */}

        // 重置游戏状态并继续
        game.isGameOver = false;
        game._endGameInFlight = null;

        // 短暂延迟后重新检查，让渲染刷新
        setTimeout(() => {
            game.checkGameOver?.();
        }, 100);
    }
}
