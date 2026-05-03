/**
 * RL 训练与「具体玩法」之间的适配层：自博弈只依赖本类，不直接读 grid/dock。
 * 规则与特征维度来自 shared/game_rules.json；棋盘逻辑在 simulator + Grid。
 */
import { OpenBlockSimulator } from './simulator.js';
import { buildDecisionBatch } from './features.js';
import { RL_TRAINING_STRATEGY_ID, WIN_SCORE_THRESHOLD } from '../gameRules.js';

export class RlGameplayEnvironment {
    /**
     * @param {string} [strategyId] 对应 game_rules.strategies 的键
     * @param {{ winScoreThreshold?: number }} [envOpts] 本局胜局分数门槛；不传则用 winScoreThreshold 配置默认
     */
    constructor(strategyId = RL_TRAINING_STRATEGY_ID, envOpts = {}) {
        const w = envOpts?.winScoreThreshold;
        const winScoreThreshold = typeof w === 'number' && Number.isFinite(w)
            ? Math.max(1, Math.round(w))
            : WIN_SCORE_THRESHOLD;
        this._sim = new OpenBlockSimulator(strategyId, { winScoreThreshold });
    }

    /** 供「评估一局」可视化等需要同步盘面时使用 */
    get simulator() {
        return this._sim;
    }

    reset() {
        this._sim.reset();
    }

    isTerminal() {
        return this._sim.isTerminal();
    }

    getLegalActions() {
        return this._sim.getLegalActions();
    }

    step(blockIdx, gx, gy) {
        return this._sim.step(blockIdx, gx, gy);
    }

    get score() {
        return this._sim.score;
    }

    get steps() {
        return this._sim.steps;
    }

    get totalClears() {
        return this._sim.totalClears;
    }

    get won() {
        return this._sim.score >= this._sim.winScoreThreshold;
    }

    buildDecisionBatch() {
        return buildDecisionBatch(this._sim);
    }
}
