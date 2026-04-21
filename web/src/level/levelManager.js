/**
 * levelManager.js — 关卡/旅行模式骨架
 *
 * 解决"无关卡/旅行模式"问题：提供关卡配置读取、目标检测、结果计算的基础层。
 *
 * 设计原则
 * --------
 * - 零侵入：game.js 仅需在 2 处添加 null-safe 检查（start 和 endGame）
 * - 配置驱动：关卡由 JSON（LevelConfig）完整描述，无硬编码
 * - 可扩展目标：支持 scoreTarget / clearTarget / roundLimit / boardTarget 四类目标
 * - 出块兼容：通过 allowedShapes 限制关卡可用块，复用现有 generateDockShapes
 * - 星级评分：三星制，驱动关卡结算界面（已预留 HTML 槽位）
 *
 * LevelConfig 格式
 * ----------------
 * {
 *   id:           string           // 关卡 ID（如 "level_001"）
 *   name:         string           // 展示名（如 "序章 - 初见"）
 *   mode:         'endless'|'level' // 默认 'level'
 *
 *   // 初始盘面（可选）
 *   initialBoard: number[][]|null  // cells[y][x]，null 表示空格，数字表示颜色
 *
 *   // 胜利目标（至少一个）
 *   objective: {
 *     type:   'score'|'clear'|'survival'|'board'
 *     value:  number             // 达到目标分数 / 消除行数 / 存活轮数
 *     boardPattern?: number[][]  // type='board' 时：目标盘面状态
 *   }
 *
 *   // 限制条件（可选）
 *   constraints: {
 *     maxRounds?: number         // 最多 N 轮出块
 *     maxPlacements?: number     // 最多 N 次落子
 *     allowedShapes?: string[]   // 仅允许出现的形状 ID 列表
 *   }
 *
 *   // 星级门槛（可选，默认 1/2/3 星）
 *   stars: {
 *     one:   number              // 达到此值得 1 星
 *     two:   number              // 达到此值得 2 星
 *     three: number              // 达到此值得 3 星
 *   }
 *
 *   // 关卡专属出块偏好（可选，透传给 spawnHints）
 *   spawnHints?: object
 * }
 *
 * game.js 集成（最小改动示例）
 * ----------------------------
 *   // 在 game.start(opts) 中：
 *   if (opts?.levelConfig) {
 *     this._levelManager = new LevelManager(opts.levelConfig);
 *     this._levelManager.applyInitialBoard(this.grid);
 *   }
 *
 *   // 在落子逻辑末尾（updateUI 之后）：
 *   if (this._levelManager) {
 *     const result = this._levelManager.checkObjective(this);
 *     if (result.done) await this.endGame({ mode: 'level', levelResult: result });
 *   }
 *
 *   // 在 endGame 最后：
 *   this._levelManager = null;
 */

/**
 * @typedef {object} LevelObjective
 * @property {'score'|'clear'|'survival'|'board'} type
 * @property {number} value
 * @property {number[][]|undefined} boardPattern
 */

/**
 * @typedef {object} LevelConfig
 * @property {string} id
 * @property {string} name
 * @property {'endless'|'level'} [mode]
 * @property {number[][]|null} [initialBoard]
 * @property {LevelObjective} objective
 * @property {{ maxRounds?:number, maxPlacements?:number, allowedShapes?:string[] }} [constraints]
 * @property {{ one:number, two:number, three:number }} [stars]
 * @property {object} [spawnHints]
 */

export class LevelManager {
    /**
     * @param {LevelConfig} config
     */
    constructor(config) {
        this.config = config;
        /** 累计消除行数（需 game.js 通过 recordClear 更新） */
        this._totalClears = 0;
        /** 累计出块轮数 */
        this._totalRounds = 0;
        /** 累计落子次数 */
        this._totalPlacements = 0;
    }

    // ------------------------------------------------------------------
    // 公开 API（供 game.js 调用）
    // ------------------------------------------------------------------

    /**
     * 将关卡初始盘面写入 grid。
     * 若 config.initialBoard 为 null，grid 保持空白。
     * @param {import('../grid.js').Grid} grid
     */
    applyInitialBoard(grid) {
        const board = this.config.initialBoard;
        if (!board) return;
        for (let y = 0; y < grid.size; y++) {
            for (let x = 0; x < grid.size; x++) {
                const val = board[y]?.[x];
                grid.cells[y][x] = (val !== undefined && val !== null) ? val : null;
            }
        }
    }

    /**
     * 返回关卡限制的形状 ID 集合（供 blockSpawn 过滤）。
     * 若无限制，返回 null。
     * @returns {Set<string>|null}
     */
    getAllowedShapes() {
        const list = this.config.constraints?.allowedShapes;
        return list && list.length > 0 ? new Set(list) : null;
    }

    /**
     * 返回关卡专属 spawnHints（透传给 generateDockShapes）
     * @returns {object}
     */
    getSpawnHints() {
        return this.config.spawnHints ?? {};
    }

    /** 记录本轮消除（落子后调用） */
    recordClear(linesCount) {
        this._totalClears += (linesCount || 0);
    }

    /** 记录出块轮数（spawnBlocks 后调用） */
    recordRound() {
        this._totalRounds++;
    }

    /** 记录落子次数（每次 handleDrop 后调用） */
    recordPlacement() {
        this._totalPlacements++;
    }

    /**
     * 检测目标是否完成（每次落子后调用）
     * @param {{ score:number, gameStats:{clears:number} }} game  game 实例简化接口
     * @returns {{ done:boolean, stars:number, objective:string, failed:boolean }}
     */
    checkObjective(game) {
        const obj = this.config.objective;
        const c = this.config.constraints ?? {};
        const score = game.score ?? 0;
        const clears = game.gameStats?.clears ?? this._totalClears;

        // 检查是否达成目标
        let achieved = false;
        let objectiveDesc = '';

        switch (obj.type) {
            case 'score':
                achieved = score >= obj.value;
                objectiveDesc = `得分 ${score} / ${obj.value}`;
                break;
            case 'clear':
                achieved = clears >= obj.value;
                objectiveDesc = `消行 ${clears} / ${obj.value}`;
                break;
            case 'survival':
                achieved = this._totalRounds >= obj.value;
                objectiveDesc = `存活 ${this._totalRounds} / ${obj.value} 轮`;
                break;
            case 'board':
                achieved = this._checkBoardPattern(game.grid, obj.boardPattern);
                objectiveDesc = '达成目标盘面';
                break;
            default:
                break;
        }

        // 检查是否失败（超过限制）
        let failed = false;
        if (!achieved) {
            if (c.maxRounds !== undefined && this._totalRounds >= c.maxRounds) failed = true;
            if (c.maxPlacements !== undefined && this._totalPlacements >= c.maxPlacements) failed = true;
        }

        if (!achieved && !failed) {
            return { done: false, stars: 0, objective: objectiveDesc, failed: false };
        }

        // 计算星级
        const stars = this._calcStars(score, clears, achieved);
        const mode = achieved ? 'level' : 'level-fail';

        return {
            done: true,
            achieved,
            failed,
            stars,
            objective: objectiveDesc,
            mode,           // 传递给 endGame(opts)
        };
    }

    /**
     * 获取完整结算数据（endGame 时调用）
     * @param {object} game
     * @returns {{ stars:number, objective:string, config:LevelConfig }}
     */
    getResult(game) {
        const result = this.checkObjective(game);
        return {
            stars: result.stars,
            objective: result.objective,
            config: this.config,
            totalClears: this._totalClears,
            totalRounds: this._totalRounds,
        };
    }

    // ------------------------------------------------------------------
    // 内部实现
    // ------------------------------------------------------------------

    _calcStars(score, clears, achieved) {
        if (!achieved) return 0;
        const thresholds = this.config.stars;
        if (!thresholds) return 1;  // 默认通关得 1 星

        // 优先用 score 判断星级，若 objective 是 clear 类型则用 clears
        const val = this.config.objective.type === 'clear' ? clears : score;
        if (val >= thresholds.three) return 3;
        if (val >= thresholds.two)   return 2;
        if (val >= thresholds.one)   return 1;
        return 1;  // 通关至少 1 星
    }

    _checkBoardPattern(grid, pattern) {
        if (!pattern || !grid) return false;
        for (let y = 0; y < grid.size; y++) {
            for (let x = 0; x < grid.size; x++) {
                const expected = pattern[y]?.[x];
                if (expected === undefined) continue;
                const actual = grid.cells[y][x];
                // null 表示"空"，非 null 表示"已填"（颜色无要求时用 1）
                if (expected === null && actual !== null) return false;
                if (expected !== null && actual === null) return false;
            }
        }
        return true;
    }
}

// ========================================================================
// 内置示例关卡（用于测试和演示）
// ========================================================================

/**
 * 示例关卡：得分挑战
 * 在无限制条件下尽快达到 200 分
 */
export const SAMPLE_LEVEL_SCORE = /** @type {LevelConfig} */ ({
    id: 'demo_score',
    name: '得分挑战',
    mode: 'level',
    initialBoard: null,
    objective: { type: 'score', value: 200 },
    stars: { one: 200, two: 400, three: 600 },
    constraints: { maxPlacements: 30 },
});

/**
 * 示例关卡：消行挑战
 * 30 步内消除 5 行
 */
export const SAMPLE_LEVEL_CLEAR = /** @type {LevelConfig} */ ({
    id: 'demo_clear',
    name: '消行挑战',
    mode: 'level',
    initialBoard: null,
    objective: { type: 'clear', value: 5 },
    stars: { one: 5, two: 8, three: 12 },
    constraints: { maxPlacements: 30 },
    spawnHints: { clearGuarantee: 1 },
});

/**
 * 示例关卡：存活挑战
 * 坚持 15 轮不死
 */
export const SAMPLE_LEVEL_SURVIVAL = /** @type {LevelConfig} */ ({
    id: 'demo_survival',
    name: '极限生存',
    mode: 'level',
    initialBoard: null,
    objective: { type: 'survival', value: 15 },
    stars: { one: 15, two: 25, three: 35 },
    spawnHints: { sizePreference: 0.5 },
});
