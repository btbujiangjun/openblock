/**
 * 玩家画像 / 出块上下文（Phase P2 —— web `game.js._spawnContext` 的引擎无关下沉）。
 *
 * 职责：把「游戏结果信号」（消行/分数/节奏）累积为跨轮上下文，经 setSpawnContextProvider
 * 喂给真实出块引擎 generateDockShapes（它读取 lastClearCount / roundsSinceClear /
 * totalClears / scoreMilestone 等），并附带 skill/momentum/frustration 三档画像信号，
 * 供未来 adaptive 层 / 分析消费。纯逻辑、不依赖引擎与 DOM，可被 web/小程序复用。
 *
 * 由 GameController 在模型事件里驱动：onRound（每次新 dock）/ onClear（消行）/ onScore（计分），
 * 新开局调 reset。snapshot() 返回合并进 spawnContext 的只读快照。
 */
export class PlayerContext {
    /** 距上次消行的出块轮数（引擎据此判断纾困/加压）。 */
    private roundsSinceClear = 0;
    /** 上一次消行的行数。 */
    private lastClearCount = 0;
    /** 本局累计消行数（引擎据此放宽特殊形状配额）。 */
    private totalClears = 0;
    /** 本局出块轮数。 */
    private roundCount = 0;
    /** 是否刚跨过一个分数里程碑（消费一轮后由 onRound 清零）。 */
    private scoreMilestone = false;
    private lastMilestone = 0;
    /** 历史最佳（供 PB 追逐类信号）。 */
    private bestScore = 0;
    /** 近若干轮每轮消行数窗口（动量估计）。 */
    private recentClears: number[] = [];
    /** 上个 dock 周期内首手自由度最低点（web _spawnContext.bottleneckTrough）。 */
    private bottleneckTrough = Infinity;
    /** 上个 dock 周期内合法落点总数最低点（web _spawnContext.bottleneckSolutionTrough）。 */
    private bottleneckSolutionTrough = Infinity;
    /** 采样次数；0 表示本周期尚无瓶颈样本。 */
    private bottleneckSamples = 0;

    /** 分数里程碑步长（每跨过一档触发一次 scoreMilestone）。 */
    private readonly milestoneStep = 500;
    private readonly window = 8;

    setBest(best: number): void {
        this.bestScore = Math.max(0, best | 0);
    }

    /** 新开局重置（保留 best 作为 PB 基线）。 */
    reset(best: number): void {
        this.roundsSinceClear = 0;
        this.lastClearCount = 0;
        this.totalClears = 0;
        this.roundCount = 0;
        this.scoreMilestone = false;
        this.lastMilestone = 0;
        this.recentClears = [];
        this.resetBottleneck();
        this.setBest(best);
    }

    /** 每次新 dock（出块一轮）：推进节奏计数，开窗，清里程碑标记。 */
    onRound(): void {
        this.roundCount++;
        this.roundsSinceClear++;
        this.scoreMilestone = false;
        this.recentClears.push(0);
        if (this.recentClears.length > this.window) this.recentClears.shift();
    }

    /** 新 dock 周期开始时重置瓶颈采样。 */
    resetBottleneck(): void {
        this.bottleneckTrough = Infinity;
        this.bottleneckSolutionTrough = Infinity;
        this.bottleneckSamples = 0;
    }

    /**
     * 记录当前 dock 周期内的瓶颈低谷。
     * @param solutionCount 当前未放置候选块的合法落点总和
     * @param firstMoveFreedom 当前未放置候选块中最小合法落点数
     */
    updateBottleneck(solutionCount: number, firstMoveFreedom: number): void {
        if (Number.isFinite(firstMoveFreedom)) {
            this.bottleneckTrough = Number.isFinite(this.bottleneckTrough)
                ? Math.min(this.bottleneckTrough, firstMoveFreedom)
                : firstMoveFreedom;
        }
        if (Number.isFinite(solutionCount)) {
            this.bottleneckSolutionTrough = Number.isFinite(this.bottleneckSolutionTrough)
                ? Math.min(this.bottleneckSolutionTrough, solutionCount)
                : solutionCount;
        }
        this.bottleneckSamples++;
    }

    /** 消行：记录行数、清零间隔、累计，并并入当前轮窗口。 */
    onClear(count: number): void {
        if (count <= 0) return;
        this.lastClearCount = count;
        this.roundsSinceClear = 0;
        this.totalClears += count;
        if (this.recentClears.length === 0) this.recentClears.push(0);
        this.recentClears[this.recentClears.length - 1] += count;
    }

    /** 计分：跨过新里程碑则置 scoreMilestone（引擎对 gapFill 形状 ×1.3 加权）。 */
    onScore(score: number): void {
        const m = Math.floor(Math.max(0, score) / this.milestoneStep);
        if (m > this.lastMilestone) {
            this.lastMilestone = m;
            this.scoreMilestone = true;
        }
    }

    /** 熟练度（0..1）：本局每轮平均消行（≈1.2 行/轮视为高水平）。 */
    skill(): number {
        const lpr = this.totalClears / Math.max(8, this.roundCount);
        return clamp01(lpr / 1.2);
    }

    /** 动量（0..1）：近窗口平均消行（≈1.5 行/轮视为高动量）。 */
    momentum(): number {
        if (this.recentClears.length === 0) return 0;
        const sum = this.recentClears.reduce((a, b) => a + b, 0);
        return clamp01((sum / this.recentClears.length) / 1.5);
    }

    /** 受挫度（0..1）：连续未消行轮数（8 轮封顶）。 */
    frustration(): number {
        return clamp01(this.roundsSinceClear / 8);
    }

    /** 合并进 spawnContext 的只读快照（键名与引擎/web _spawnContext 对齐）。 */
    snapshot(): Record<string, unknown> {
        return {
            lastClearCount: this.lastClearCount,
            roundsSinceClear: this.roundsSinceClear,
            totalClears: this.totalClears,
            scoreMilestone: this.scoreMilestone,
            bestScore: this.bestScore,
            skill: this.skill(),
            momentum: this.momentum(),
            frustration: this.frustration(),
            bottleneckTrough: this.bottleneckTrough,
            bottleneckSolutionTrough: this.bottleneckSolutionTrough,
            bottleneckSamples: this.bottleneckSamples,
        };
    }
}

function clamp01(v: number): number {
    if (!Number.isFinite(v)) return 0;
    return v < 0 ? 0 : v > 1 ? 1 : v;
}
