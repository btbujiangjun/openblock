/**
 * 玩家实时能力画像（增强版 · 长周期评估）
 *
 * ┌────────────────────────────────────────────────────────────────────────┐
 * │  层次              输入                    输出                         │
 * │  ─────────────     ──────────────          ──────────────────────────  │
 * │  即时（步级）      thinkMs / cleared        rawSkill → smoothSkill     │
 * │                    boardFill / miss          momentum / cognitiveLoad  │
 * │                                             flowState / pacingPhase   │
 * │                                                                       │
 * │  中期（局级）      sessionHistory[0..29]     historicalSkill (0~1)     │
 * │                    得分/消行率/技能快照       trend (-1~1)             │
 * │                                             confidence (0~1)          │
 * │                                                                       │
 * │  长期（聚合）      后端 user_stats            historicalSkill 基线     │
 * │                    totalGames/Score/Clears    isNewPlayer 更精准       │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * skillLevel 最终输出 = blend(smoothSkill, historicalSkill, confidence)：
 *   - 局内有足够步数时（>= 窗口一半），以 smoothSkill 为主
 *   - 开局冷启动或步数不足时，以 historicalSkill 作为强先验
 *   - confidence 越高（游戏局数多且近期活跃），短/长期混合越平稳
 *
 * 设计依据：
 *   - 贝叶斯快速收敛：前 fastConvergenceWindow 步用更大 alpha
 *   - 长周期回归：对最近 30 局会话摘要做指数加权线性回归，提取 trend
 *   - 置信度衰减：局数 → 置信上限，离线天数 → 置信折扣
 *   - 心流三态：bored / flow / anxious（Csíkszentmihályi 模型）
 *   - 差一点效应（Near-Miss）/ 节奏张弛 / 认知负荷
 *
 * 持久化到 localStorage，跨局保留技能估计 + 会话历史环 + 终身局数。
 */

import { GAME_RULES } from './gameRules.js';

const STORAGE_KEY = 'openblock_player_profile';
const SKILL_DECAY_HOURS = 24;
const SESSION_HISTORY_CAP = 30;

function _clamp01(v, fallback = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(1, n));
}

function _afkThreshold() {
    return (_cfg().afk?.thresholdMs) ?? 15_000;
}
function _fb() {
    return _cfg().feedback ?? {};
}
function _cfg() {
    return GAME_RULES.adaptiveSpawn ?? {};
}

/**
 * @typedef {'perfect_hunter'|'multi_clear'|'combo'|'survival'|'balanced'} PlaystyleLabel
 */

/**
 * @typedef {{
 *   score: number,
 *   placements: number,
 *   clears: number,
 *   misses: number,
 *   maxCombo: number,
 *   clearRate: number,
 *   skill: number,
 *   duration: number,
 *   ts: number,
 *   playstyle?: PlaystyleLabel,
 *   multiClearRate?: number,
 *   perfectClearRate?: number,
 * }} SessionSummary
 */

export class PlayerProfile {
    /**
     * @param {number} [windowSize] 滑动窗口大小
     */
    constructor(windowSize) {
        const cfg = _cfg();
        this._window = windowSize ?? cfg.profileWindow ?? 15;

        /** @type {Array<{ts:number, thinkMs:number, pickToPlaceMs:number|null, cleared:boolean, lines:number, fill:number, miss:boolean}>} */
        this._moves = [];
        this._lastActionTs = 0;
        /**
         * v1.46「反应」指标：startDrag（玩家激活候选块）→ recordPlace/recordMiss 的纯操作执行段时长。
         *
         * 与 thinkMs 的区别（务必区分）：
         *   - thinkMs        = 上一动作 → 当前落子；包含"等系统出新块 / 看新一波 / 选块 / 拖动"全过程
         *   - pickToPlaceMs  = startDrag → 落子；只含"我握起这一块到我放下"的纯执行时间
         *
         * 0 / null = 玩家未经过 startDrag 的程序化路径（教程脚本、replay、bot 等）→
         *           不计入"反应"窗口均值，避免污染指标。
         */
        this._pickupAt = 0;

        this._smoothSkill = 0.5;
        this._recoveryCounter = 0;
        this._comboStreak = 0;
        this._consecutiveNonClears = 0;

        this._spawnCounter = 0;
        this._sessionStartTs = Date.now();

        this._totalLifetimePlacements = 0;
        this._totalLifetimeGames = 0;

        /** 闭环反馈：出块后跟踪窗口内的消行效果 → 微调 stress 偏移 */
        this._feedbackBias = 0;
        this._feedbackStepsLeft = 0;
        this._feedbackClearsInWindow = 0;

        /* ---- 长周期评估 ---- */
        /** @type {SessionSummary[]} 最近 SESSION_HISTORY_CAP 局的摘要（按时间升序） */
        this._sessionHistory = [];
        /** 从后端聚合统计注入的基线技能（首次 ingest 后有效） */
        this._statsBaselineSkill = -1;
        /** 缓存：历史技能 / 趋势 / 置信度（按需重算） */
        this._cachedHistorical = null;

        /** 模式偏好追踪：{endless:0, level:0} */
        this._modeCount = { endless: 0, level: 0 };

        /** 非敏感个性化偏好：用户明示设置 + 本地行为反馈，不包含年龄/性别/种族等敏感属性 */
        this._personalizationOptions = {
            enabled: true,
            difficulty: true,
            hints: true,
            visuals: true,
            ads: false,
        };
        this._preferenceSignals = {
            hintAccepted: 0,
            hintDismissed: 0,
            difficultyUp: 0,
            difficultyDown: 0,
            qualityLow: 0,
            reducedMotion: 0,
            share: 0,
            challenge: 0,
            collection: 0,
        };
        this._lastSessionEndTs = 0;
        /* v1.48 (2026-05) — 数据层统一：玩家"装机时间戳"。
         * 用于 daysSinceInstall 计算，supersede 之前散落在 gameStats 上的同名字段。
         * 第一次构造（首次启动）写 now；fromJSON 读旧记录时若缺该字段则用最早的
         * sessionHistory[0].ts 兜底，再不行再回退到 now（视作刚装机）。 */
        this._installTs = Date.now();
    }

    /* ================================================================== */
    /*  数据录入                                                           */
    /* ================================================================== */

    recordSpawn() {
        this._lastActionTs = Date.now();
        this._spawnCounter++;
        this._feedbackBias *= (_fb().decay ?? 0.8);
        this._feedbackStepsLeft = (_fb().horizon ?? 4);
        this._feedbackClearsInWindow = 0;
    }

    /**
     * v1.46：玩家在 dock 上按下/触摸一个候选块（Game.startDrag 入口）即调用本方法。
     *
     * 仅记录最近一次 pickup 时刻；下一次 recordPlace / recordMiss 时与之相减，
     * 写入该 move 的 pickToPlaceMs，反映"激活到落子"的纯反应/操作耗时。
     *
     * 重复调用是安全的（拖→拖出→重新选另一块）：以最后一次为准；松手取消（onDragCancel）
     * 不需要清零，因为下一次 startDrag 会覆盖。
     */
    recordPickup() {
        this._pickupAt = Date.now();
    }

    /**
     * @param {boolean} cleared 本次放置是否触发消行
     * @param {number} linesCleared 消除行数
     * @param {number} boardFill 放置后板面填充率 0~1
     */
    recordPlace(cleared, linesCleared, boardFill) {
        const now = Date.now();
        const thinkMs = this._lastActionTs > 0
            ? Math.min(now - this._lastActionTs, 60000)
            : 3000;
        const pickToPlaceMs = this._pickupAt > 0
            ? Math.min(now - this._pickupAt, 60000)
            : null;

        this._pushMove({
            ts: now, thinkMs, pickToPlaceMs, cleared, lines: linesCleared, fill: boardFill, miss: false
        });
        this._lastActionTs = now;
        this._pickupAt = 0;
        this._totalLifetimePlacements++;

        if (linesCleared >= 2) {
            this._comboStreak++;
        } else {
            this._comboStreak = 0;
        }

        if (cleared) {
            this._consecutiveNonClears = 0;
        } else {
            this._consecutiveNonClears++;
        }

        if (this._feedbackStepsLeft > 0) {
            this._feedbackStepsLeft--;
            if (cleared) this._feedbackClearsInWindow += linesCleared;
            if (this._feedbackStepsLeft === 0) {
                const fb = _fb();
                const expected = fb.expected ?? 1;
                const alpha = fb.alpha ?? 0.02;
                const clamp = fb.biasClamp ?? 0.15;
                const delta = this._feedbackClearsInWindow - expected;
                this._feedbackBias += delta * alpha;
                this._feedbackBias = Math.max(-clamp, Math.min(clamp, this._feedbackBias));
            }
        }

        const fz = _cfg().flowZone ?? {};
        if (boardFill > (fz.recoveryFillThreshold ?? 0.82)) {
            this._recoveryCounter = fz.recoveryDuration ?? 4;
        } else if (this._recoveryCounter > 0) {
            this._recoveryCounter--;
        }

        const raw = this._computeRawSkill();
        const cfg = _cfg();
        const fastWin = cfg.fastConvergenceWindow ?? 5;
        const alpha = this._moves.length <= fastWin
            ? (cfg.fastConvergenceAlpha ?? 0.35)
            : (cfg.smoothingFactor ?? 0.15);
        this._smoothSkill += alpha * (raw - this._smoothSkill);
    }

    recordMiss() {
        const now = Date.now();
        const thinkMs = this._lastActionTs > 0
            ? Math.min(now - this._lastActionTs, 60000)
            : 1000;
        const pickToPlaceMs = this._pickupAt > 0
            ? Math.min(now - this._pickupAt, 60000)
            : null;
        this._pushMove({
            ts: now, thinkMs, pickToPlaceMs, cleared: false, lines: 0, fill: 0, miss: true
        });
        this._pickupAt = 0;
        this._consecutiveNonClears++;
    }

    /** 新局开始时调用：重置局内计数器 */
    recordNewGame() {
        this._spawnCounter = 0;
        this._sessionStartTs = Date.now();
        this._consecutiveNonClears = 0;
        this._comboStreak = 0;
        this._totalLifetimeGames++;
    }

    /**
     * 记录非敏感偏好信号。调用方可在提示、设置、分享、挑战等事件发生时写入。
     * @param {string} key
     * @param {number} [delta]
     */
    recordPreferenceSignal(key, delta = 1) {
        if (!Object.prototype.hasOwnProperty.call(this._preferenceSignals, key)) return;
        this._preferenceSignals[key] = Math.max(0, (this._preferenceSignals[key] || 0) + Number(delta || 0));
        this._cachedHistorical = null;
    }

    /**
     * 更新个性化开关。敏感属性不进入这里；地区/语言只应由上层作为聚合实验上下文传入。
     * @param {Partial<{enabled:boolean,difficulty:boolean,hints:boolean,visuals:boolean,ads:boolean}>} opts
     */
    setPersonalizationOptions(opts = {}) {
        const clean = {};
        for (const [k, v] of Object.entries(opts || {})) {
            if (Object.prototype.hasOwnProperty.call(this._personalizationOptions, k) && typeof v === 'boolean') {
                clean[k] = v;
            }
        }
        this._personalizationOptions = { ...this._personalizationOptions, ...clean };
    }

    /**
     * 局末调用：将本局摘要压入会话历史环，供长周期评估。
     * @param {{ score:number, placements:number, clears:number, misses:number, maxCombo:number, mode?:string }} gameStats
     */
    recordSessionEnd(gameStats) {
        const duration = Date.now() - this._sessionStartTs;
        const p = gameStats.placements || 1;
        const mode = gameStats.mode ?? 'endless';
        /** @type {SessionSummary} */
        const summary = {
            score: gameStats.score ?? 0,
            placements: gameStats.placements ?? 0,
            clears: gameStats.clears ?? 0,
            misses: gameStats.misses ?? 0,
            maxCombo: gameStats.maxCombo ?? 0,
            clearRate: p > 0 ? (gameStats.clears ?? 0) / p : 0,
            skill: this._smoothSkill,
            duration,
            ts: Date.now(),
            mode,
            // 玩法偏好快照（局末推断，供历史趋势分析）
            playstyle: this.playstyle,
            multiClearRate: this.multiClearRate,
            perfectClearRate: this.perfectClearRate,
        };
        this._sessionHistory.push(summary);
        if (this._sessionHistory.length > SESSION_HISTORY_CAP) {
            this._sessionHistory = this._sessionHistory.slice(-SESSION_HISTORY_CAP);
        }
        this._cachedHistorical = null;
        // 更新模式计数
        if (mode === 'level') {
            this._modeCount.level = (this._modeCount.level ?? 0) + 1;
        } else {
            this._modeCount.endless = (this._modeCount.endless ?? 0) + 1;
        }
        this._lastSessionEndTs = summary.ts;
    }

    /**
     * 初始化时注入后端聚合统计，计算长期基线能力。
     * 仅在 DB 可用时由 game.js 调用一次。
     * @param {{ totalGames?:number, totalScore?:number, totalClears?:number,
     *           totalPlacements?:number, totalMisses?:number, maxCombo?:number }} stats
     */
    ingestHistoricalStats(stats) {
        if (!stats || !(stats.totalGames > 0)) return;
        const games = stats.totalGames;
        const avgScore = (stats.totalScore ?? 0) / games;
        const avgClears = (stats.totalClears ?? 0) / Math.max(1, stats.totalPlacements ?? 1);
        const missRate = (stats.totalMisses ?? 0) / Math.max(1, (stats.totalPlacements ?? 0) + (stats.totalMisses ?? 0));

        const scoreSkill = Math.min(1, avgScore / 2500);
        const clearSkill = Math.min(1, avgClears / 0.5);
        const missSkill = 1 - Math.min(1, missRate / 0.25);
        const comboSkill = Math.min(1, (stats.maxCombo ?? 0) / 6);

        this._statsBaselineSkill = scoreSkill * 0.35 + clearSkill * 0.30 + missSkill * 0.20 + comboSkill * 0.15;
        this._cachedHistorical = null;
    }

    /* ================================================================== */
    /*  基础指标                                                           */
    /* ================================================================== */

    /**
     * 即时窗口指标。
     *
     * v1.13：返回值新增 `samples` / `activeSamples` 用于区分「真实测量」与「冷启动占位」。
     * 占位值（thinkMs:3000 / clearRate:0.3 / missRate:0.1 / comboRate:0.1）继续保留，
     * 这是为了让 `_computeRawSkill / flowDeviation / playstyle` 等内部消费方在首屏不至于
     * 除零或抖到极端值，但 UI 层应根据 `samples === 0` 把对应数字隐藏为「—」，避免
     * 玩家看到「我还没下任何块就已经被打了消行率 30% / 失误 10%」的误导。
     *
     * @returns {{
     *   thinkMs:number, clearRate:number, comboRate:number, missRate:number,
     *   afkCount:number, samples:number, activeSamples:number
     * }}
     */
    get metrics() {
        return this.metricsForWindow(this._window);
    }

    /**
     * v2 (2026-05)：按指定窗口长度聚合 metrics，供 `playerAbilityModel` 让不同能力指标
     * 使用各自合适的时间尺度（控制看短窗体现手感、消行看中窗等待机会积累）。
     *
     * 与原 `metrics` 行为完全一致：windowSize === this._window 时复用同一冷启动占位语义、
     * 同一 AFK 过滤、同一返回字段集（保证下游 UI / 自适应 / 回放无缝切换）。
     *
     * @param {number} windowSize 取最近 N 步聚合；非有限值或 ≤0 时回退到默认 _window
     * @returns {{
     *   thinkMs:number, clearRate:number, comboRate:number, missRate:number,
     *   multiClearRate:number, perfectClearRate:number, avgLines:number,
     *   pickToPlaceMs:number|null, reactionSamples:number,
     *   afkCount:number, samples:number, activeSamples:number, windowSize:number
     * }}
     */
    metricsForWindow(windowSize) {
        const w = Number.isFinite(windowSize) && windowSize > 0
            ? Math.floor(windowSize)
            : this._window;
        const recent = this._moves.slice(-w);
        if (recent.length === 0) {
            return {
                thinkMs: 3000, clearRate: 0.3, comboRate: 0.1, missRate: 0.1,
                multiClearRate: 0, perfectClearRate: 0, avgLines: 0,
                pickToPlaceMs: null, reactionSamples: 0,
                afkCount: 0, samples: 0, activeSamples: 0, windowSize: w
            };
        }
        const placed = recent.filter(m => !m.miss);
        const afkMs = _afkThreshold();
        const active = placed.filter(m => m.thinkMs < afkMs);
        const afkCount = placed.length - active.length;
        const clearCount = active.filter(m => m.cleared).length;
        const comboCount = active.filter(m => m.lines >= 2).length;

        const reactive = recent.filter(m => m.pickToPlaceMs != null && m.pickToPlaceMs < afkMs);
        const pickToPlaceMs = reactive.length > 0
            ? reactive.reduce((s, m) => s + m.pickToPlaceMs, 0) / reactive.length
            : null;

        /* v2：multiClear / perfectClear 在窗口口径内单独统计，让 clearEfficiency
         * 不必依赖 PlayerProfile 全局 _window 的 multiClearRate / perfectClearRate getter
         * （那两个 getter 仍保留作为对外公开 API，与本窗口口径一致）。 */
        const cleared = active.filter(m => m.cleared);
        const multiClearRate = cleared.length >= 2
            ? cleared.filter(m => m.lines >= 2).length / cleared.length
            : 0;
        const perfectClearRate = cleared.length >= 2
            ? cleared.filter(m => m.fill === 0).length / cleared.length
            : 0;
        const avgLines = cleared.length > 0
            ? cleared.reduce((s, m) => s + m.lines, 0) / cleared.length
            : 0;

        return {
            thinkMs: active.length > 0
                ? active.reduce((s, m) => s + m.thinkMs, 0) / active.length
                : 3000,
            clearRate: active.length > 0 ? clearCount / active.length : 0.3,
            comboRate: clearCount > 0 ? comboCount / clearCount : 0,
            missRate: recent.length > 0
                ? recent.filter(m => m.miss).length / recent.length
                : 0,
            multiClearRate,
            perfectClearRate,
            avgLines,
            pickToPlaceMs,
            reactionSamples: reactive.length,
            afkCount,
            samples: recent.length,
            activeSamples: active.length,
            windowSize: w
        };
    }

    /* ================================================================== */
    /*  能力维度                                                           */
    /* ================================================================== */

    /**
     * 综合技能水平 0~1。
     * 局内步数充足时以实时 smoothSkill 为主；冷启动时以历史基线为锚。
     * blend = smoothWeight * smoothSkill + (1-smoothWeight) * historicalSkill
     */
    get skillLevel() {
        const smooth = Math.max(0, Math.min(1, this._smoothSkill));
        const hist = this.historicalSkill;
        if (hist < 0) return smooth;

        const stepsInSession = this._moves.length;
        const halfWindow = this._window / 2;
        const smoothWeight = Math.min(1, stepsInSession / halfWindow);
        const conf = this.confidence;
        const histWeight = (1 - smoothWeight) * conf;
        const blended = smooth * (1 - histWeight) + hist * histWeight;
        return Math.max(0, Math.min(1, blended));
    }

    /**
     * 历史技能 0~1：从会话历史环 + 后端统计基线综合计算。
     * 会话历史用指数加权均值（近期局权重大）。无历史时返回 -1。
     */
    get historicalSkill() {
        const h = this._getHistoricalCache();
        return h.skill;
    }

    /**
     * 长周期趋势 -1（退步）~ 0（稳定）~ 1（进步）。
     * 对会话历史的 skill 序列做指数加权线性回归。
     */
    get trend() {
        return this._getHistoricalCache().trend;
    }

    /**
     * 置信度 0~1：反映历史数据量与新鲜度。
     * 局数多且近期活跃 → 高置信 → skillLevel 混合更稳定。
     */
    get confidence() {
        return this._getHistoricalCache().confidence;
    }

    /**
     * 动量：最近表现相对历史的变化趋势 -1(急跌)~0(稳定)~1(上升)
     * 对比滑动窗口前半和后半的 clearRate 差异。
     *
     * 设计原则：
     *   - 完全基于「消行率」而非「分数增量」——分数随玩家累计线性增长，
     *     如果用分数差去算 momentum 会出现"得分稳定上升=动量+1"的伪信号。
     *   - 排除 miss / AFK 仍由 _recentMoves + filter !miss 处理。
     *
     * v1.13：增加最小样本阈值 + 样本置信度缩放，避免 2~3 个样本时 momentum 抖到 ±1
     * 与玩家直觉脱节（screenshot 案例：clearRate=0.4 但 momentum=-1）。
     *
     * v1.16：增加噪声衰减——当某半区的消行/未消行接近五五开（伯努利方差≈0.25）时，
     * 一次随机翻转就能把 momentum 推到极端，UI 上玩家会感到"我状态稳定它却显示+1"。
     * 噪声因子 noise = (var_old + var_new) / 2，最终衰减系数 noiseDamping =
     * clamp(1 - noise * 2, 0.5, 1)：
     *   - 两半都很确定（CR≈0 或 CR≈1）→ noise≈0 → noiseDamping≈1 不衰减
     *   - 一半 50/50 一半确定 → noise≈0.125 → noiseDamping≈0.75
     *   - 两半都 50/50 → noise≈0.25 → noiseDamping=0.5（最大衰减）
     */
    get momentum() {
        const recent = this._recentMoves();
        if (recent.length < 6) return 0;
        const mid = Math.floor(recent.length / 2);
        const olderPlaced = recent.slice(0, mid).filter(m => !m.miss);
        const newerPlaced = recent.slice(mid).filter(m => !m.miss);
        const minSamplesPerHalf = 3;
        if (olderPlaced.length < minSamplesPerHalf || newerPlaced.length < minSamplesPerHalf) return 0;

        const olderCR = olderPlaced.filter(m => m.cleared).length / olderPlaced.length;
        const newerCR = newerPlaced.filter(m => m.cleared).length / newerPlaced.length;
        const delta = newerCR - olderCR;
        // 样本置信度：总样本越接近 12 越接近 1；6 个样本时仅 0.5，把 momentum 扁平化
        const sampleConfidence = Math.min(1, (olderPlaced.length + newerPlaced.length) / 12);
        const raw = delta / 0.3;
        // 先在 [-1,1] 上钳制，再按置信度缩放：低置信度时 |momentum| 也被收窄
        const clamped = Math.max(-1, Math.min(1, raw));
        // v1.16：伯努利方差噪声衰减（见上方说明）
        const noise = (olderCR * (1 - olderCR) + newerCR * (1 - newerCR)) / 2;
        const noiseDamping = Math.max(0.5, Math.min(1, 1 - noise * 2));
        return clamped * sampleConfidence * noiseDamping;
    }

    /**
     * 认知负荷 0~1：thinkMs 方差越大 → 玩家对部分局面犹豫不决，认知压力高。
     * placed.length<3 时返回 0.3 占位，仅用于内部 stress 兜底；UI 应配合 metrics.samples
     * 判断是否冷启动（见 cognitiveLoadHasData）。
     */
    get cognitiveLoad() {
        const placed = this._recentMoves().filter(m => !m.miss);
        if (placed.length < 3) return 0.3;
        const avg = placed.reduce((s, m) => s + m.thinkMs, 0) / placed.length;
        const variance = placed.reduce((s, m) => s + (m.thinkMs - avg) ** 2, 0) / placed.length;
        const highVar = (_cfg().flowZone ?? {}).thinkTimeVarianceHigh ?? 8_000_000;
        return Math.min(1, variance / highVar);
    }

    /**
     * v1.13：cognitiveLoad 是否基于真实样本（非冷启动占位 0.3）。
     * 用于 UI 层在首屏把「负荷」字段显示为「—」。
     */
    get cognitiveLoadHasData() {
        return this._recentMoves().filter(m => !m.miss).length >= 3;
    }

    /**
     * 参与度：每分钟操作次数（APM）
     */
    get engagementAPM() {
        const recent = this._recentMoves();
        if (recent.length < 2) return 6;
        const spanMs = recent[recent.length - 1].ts - recent[0].ts;
        if (spanMs < 1000) return 6;
        return recent.length / (spanMs / 60000);
    }

    /* ================================================================== */
    /*  实时状态信号                                                       */
    /* ================================================================== */

    /**
     * 量化心流偏移度 F(t) = |boardPressure / skillLevel − 1|
     * boardPressure 综合棋盘填充、消行率不足、认知负荷等因子。
     * F(t) 越小越沉浸。
     * @returns {number} 0~2（通常 0~1）
     */
    get flowDeviation() {
        const recent = this._recentMoves();
        if (recent.length < 3) return 0;

        const m = this.metrics;
        const placed = recent.filter(r => !r.miss && r.thinkMs < _afkThreshold());
        const avgFill = placed.length > 0
            ? placed.reduce((s, r) => s + r.fill, 0) / placed.length
            : 0.3;

        const fillPressure = avgFill;
        const clearDeficit = 1 - Math.min(1, m.clearRate / 0.4);
        const loadPressure = this.cognitiveLoad;
        const boardPressure = fillPressure * 0.45 + clearDeficit * 0.35 + loadPressure * 0.2;

        const skill = Math.max(0.05, this.skillLevel);
        const ratio = boardPressure / skill;
        return Math.abs(ratio - 1);
    }

    /**
     * 心流状态：bored（无聊→加压）/ flow（心流→维持）/ anxious（焦虑→减压）
     * 基于量化 flowDeviation + 方向判定，替代纯启发式阈值。
     *
     * v1.51（末段崩盘修复）：
     * - 新增"末段瞬时窗口"挣扎信号（最近 8 步），与累计均值 OR 关系，
     *   解决"前 5 分钟良好 + 最后 1 分钟挣扎"被均值稀释的盲区；
     * - 新增"动量强烈下行"硬触发（momentum < -0.35）——直接返 anxious，
     *   解决濒死玩家被误判 bored 的问题；
     * - borderline (fd > 0.55) 分支加方向判定：必须 boardPressure < skill
     *   且 momentum ≥ -0.15 才允许判 bored；否则 fall through 到 flow，
     *   或在 anxious 信号叠加时优先返 anxious。
     *
     * @returns {'bored'|'flow'|'anxious'}
     */
    get flowState() {
        const recent = this._recentMoves();
        if (recent.length < 5) return 'flow';

        const m = this.metrics;
        const fz = _cfg().flowZone ?? {};
        const placedMoves = recent.filter(r => !r.miss);
        const avgFill = placedMoves.length > 0
            ? placedMoves.reduce((s, r) => s + r.fill, 0) / placedMoves.length
            : 0;

        /* v1.51：动量强烈下行硬触发——濒死玩家的最稳健信号（动量噪声衰减后仍 < -0.35
         * 意味着真实崩盘趋势）。这条放在最前，避免后面 borderline 把它误判成 bored。 */
        const momentumNow = this.momentum;
        if (momentumNow <= -0.35) return 'anxious';

        /* v1.18：复合挣扎检测（累计均值）——4 条阈值 ≥3 条命中视为挣扎。 */
        const struggleSignals = (m.missRate > 0.10 ? 1 : 0)
            + (m.thinkMs > (fz.thinkTimeStruggleMs ?? 3500) ? 1 : 0)
            + (m.clearRate < 0.30 ? 1 : 0)
            + (avgFill > 0.55 && m.clearRate < 0.40 ? 1 : 0);
        if (struggleSignals >= 3) return 'anxious';

        /* v1.51：末段瞬时挣扎窗口——最近 8 步内消行数 ≤1、思考时间在上升、avgFill 在
         * 上升 → "局尾崩盘"。与上面的"累计均值"挣扎检测互补：
         *   累计 OR 末段任一命中 ≥3 信号即判 anxious。 */
        const burstSignals = this._burstStruggleSignals();
        if (burstSignals >= 3) return 'anxious';

        const fd = this.flowDeviation;
        if (fd < 0.25) return 'flow';

        if (m.thinkMs < (fz.thinkTimeLowMs ?? 1200)
            && m.clearRate > 0.45
            && m.missRate < 0.05) {
            return 'bored';
        }

        if (m.missRate > (fz.missRateWorry ?? 0.28)) return 'anxious';

        if (m.thinkMs > (fz.thinkTimeHighMs ?? 10000) && m.clearRate < 0.15) {
            return 'anxious';
        }

        if (placedMoves.length > 0 && avgFill > 0.78 && m.clearRate < 0.2) return 'anxious';

        if (this.cognitiveLoad > 0.7 && m.clearRate < 0.25) return 'anxious';

        /* v1.51 borderline 方向判定 ——
         * 旧版 `fd > 0.55 && clearRate > 0.42 → bored` 单看 fd 大小不看方向，
         * 把 boardPressure 高出 skill（→ anxious）的玩家误判成 bored。
         * 修复：必须满足 (a) boardPressure < skill（即 ratio < 1，板面比能力弱→真无聊）
         *      AND (b) momentum 不强烈下行（≥ -0.15）才判 bored；否则 fall through 到 flow。
         * 截图实测玩家 fd=0.60 + clearRate=50% + momentum=-0.53 + late，按旧规则误判为
         * bored、按新规则在 momentumNow ≤ -0.35 早返回 anxious。 */
        if (fd > 0.55 && m.clearRate > 0.42) {
            const skill = Math.max(0.05, this.skillLevel);
            const boardPressureRatio = (1 - this.flowDeviation < 0)
                ? 1 + this.flowDeviation
                : 1 - this.flowDeviation;
            const boardWeakerThanSkill = boardPressureRatio < 1;
            const momentumStable = momentumNow > -0.15;
            if (boardWeakerThanSkill && momentumStable && skill > 0) {
                return 'bored';
            }
        }

        return 'flow';
    }

    /**
     * v1.51 末段瞬时挣扎窗口：最近 8 步（默认）窗口内的"局尾崩盘"信号。
     *
     * 与 metrics 的累计均值正交——当玩家前 5 分钟良好、最后 1 分钟挣扎时，累计均值
     * 仍然漂亮，但本窗口能立即捕获"局尾消行率塌陷 / 思考时间显著上升 / 盘面接近
     * 满格"等真实濒死信号。
     *
     * @private
     * @returns {number} 0~3 命中信号数（≥3 即触发 anxious）
     */
    _burstStruggleSignals() {
        const window = 8;
        const recent = this._moves.slice(-window).filter(m => !m.miss);
        if (recent.length < 5) return 0;
        const half = Math.floor(recent.length / 2);
        const older = recent.slice(0, half);
        const newer = recent.slice(half);
        if (older.length === 0 || newer.length === 0) return 0;

        const newerClearRate = newer.filter(m => m.cleared).length / newer.length;
        const newerThinkAvg = newer.reduce((s, m) => s + m.thinkMs, 0) / newer.length;
        const olderThinkAvg = older.reduce((s, m) => s + m.thinkMs, 0) / older.length;
        const newerFillAvg = newer.reduce((s, m) => s + m.fill, 0) / newer.length;
        const olderFillAvg = older.reduce((s, m) => s + m.fill, 0) / older.length;

        let count = 0;
        if (newerClearRate <= 0.20) count++;
        if (newerThinkAvg > 3500 && newerThinkAvg > olderThinkAvg * 1.2) count++;
        if (newerFillAvg >= 0.70 && newerFillAvg > olderFillAvg + 0.05) count++;
        if (newer.filter(m => m.cleared).length === 0 && newer.length >= 4) count++;
        return count;
    }

    /**
     * 节奏相位：tension（紧张期）/ release（释放期）
     * 由 spawnCounter 对 pacing.cycleLength 取模驱动
     * @returns {'tension'|'release'}
     */
    get pacingPhase() {
        const pacing = _cfg().pacing;
        if (!pacing?.enabled) return 'tension';
        const cycle = pacing.cycleLength ?? 5;
        const pos = this._spawnCounter % cycle;
        return pos < (pacing.tensionPhases ?? 3) ? 'tension' : 'release';
    }

    /**
     * 挫败等级：连续未消行步数。超过阈值时触发挫败救济
     * @returns {number}
     */
    get frustrationLevel() {
        return this._consecutiveNonClears;
    }

    /**
     * 差一点状态：上一步在较满的板面上放置但未消行
     * 此时投放消行友好块可触发 near-miss 正反馈（研究表明续玩意愿最强）
     */
    get hadRecentNearMiss() {
        const recent = this._recentMoves();
        if (recent.length < 1) return false;
        const last = recent[recent.length - 1];
        return !last.miss && !last.cleared && last.fill > 0.6;
    }

    /** 板面接近满时的紧急恢复标志 */
    get needsRecovery() {
        return this._recoveryCounter > 0;
    }

    get recentComboStreak() {
        return this._comboStreak;
    }

    /**
     * 最近滑动窗口内多消率：消行事件中 lines≥2 的比例（0~1）。
     * 反映玩家主动设置多行消除的偏好强度。
     */
    get multiClearRate() {
        const clears = this._moves.slice(-this._window).filter(m => m.cleared && !m.miss);
        if (clears.length < 2) return 0;
        return clears.filter(m => m.lines >= 2).length / clears.length;
    }

    /**
     * 最近滑动窗口内清屏率：消行事件中消行后 fill=0（棋盘全空）的比例（0~1）。
     * 利用 recordPlace 传入的 boardFill 是消行后的值这一特性，fill===0 即为清屏。
     */
    get perfectClearRate() {
        const clears = this._moves.slice(-this._window).filter(m => m.cleared && !m.miss);
        if (clears.length < 2) return 0;
        return clears.filter(m => m.fill === 0).length / clears.length;
    }

    /**
     * 最近滑动窗口内每次消行平均清除的行列条数。
     * 1.0 = 每次仅单消；2.5+ = 强多消偏好。
     */
    get avgLinesPerClear() {
        const clears = this._moves.slice(-this._window).filter(m => m.cleared && !m.miss);
        if (clears.length === 0) return 0;
        return clears.reduce((s, m) => s + m.lines, 0) / clears.length;
    }

    /**
     * 推断玩法风格偏好（取最近窗口行为）。
     *
     * 优先级：perfect_hunter > multi_clear > combo > survival > balanced
     *
     * - perfect_hunter : 频繁清屏（清屏率 ≥ 5%），追求一次性消空棋盘
     * - multi_clear    : 多消率 ≥ 40% 或平均消除条数 ≥ 2.5，偏好同时消多行
     * - combo          : recentComboStreak ≥ 3，连续连消型玩家
     * - survival       : 消行率 < 25%，以保活为主而非积极消行
     * - balanced       : 无明显单一偏好
     *
     * @returns {PlaystyleLabel}
     */
    get playstyle() {
        if (this.perfectClearRate >= 0.05)                              return 'perfect_hunter';
        if (this.multiClearRate >= 0.40 || this.avgLinesPerClear >= 2.5) return 'multi_clear';
        if (this.recentComboStreak >= 3)                                return 'combo';
        if (this.metrics.clearRate < 0.25)                              return 'survival';
        return 'balanced';
    }

    /**
     * 全球化个性化的行为分群：只由行为和明示偏好推断，不使用敏感属性。
     * @returns {'newcomer_protection'|'challenge_seeker'|'relaxation'|'collector'|'social_competitor'|'balanced'}
     */
    get behaviorSegment() {
        const m = this.metrics;
        if (this.isNewPlayer || this.isInOnboarding) return 'newcomer_protection';
        if (this.accessibilityLoad >= 0.55 || (this.sessionPhase === 'late' && this.momentum < -0.25)) return 'relaxation';
        if ((this._preferenceSignals.share + this._preferenceSignals.challenge) >= 3) return 'social_competitor';
        if (this._preferenceSignals.collection >= 3 || this.perfectClearRate >= 0.05) return 'collector';
        if (this.skillLevel >= 0.72 && m.missRate <= 0.08 && (this.multiClearRate >= 0.25 || this.recentComboStreak >= 2)) {
            return 'challenge_seeker';
        }
        if (m.thinkMs > 6000 || m.missRate > 0.18) return 'relaxation';
        return 'balanced';
    }

    /**
     * 中长期动机意图，与单轮 spawnIntent 分离。
     * @returns {'competence'|'challenge'|'relaxation'|'collection'|'social'|'balanced'}
     */
    get motivationIntent() {
        const seg = this.behaviorSegment;
        if (seg === 'newcomer_protection') return 'competence';
        if (seg === 'challenge_seeker') return 'challenge';
        if (seg === 'relaxation') return 'relaxation';
        if (seg === 'collector') return 'collection';
        if (seg === 'social_competitor') return 'social';
        return 'balanced';
    }

    /** 个性化开关快照，供策略层透明消费 */
    get personalizationOptions() {
        return { ...this._personalizationOptions };
    }

    /** 可访问性/设备负担代理：低画质、低动态、误触/思考负担共同推高 */
    get accessibilityLoad() {
        const m = this.metrics;
        const visual = Math.min(1, (this._preferenceSignals.qualityLow + this._preferenceSignals.reducedMotion) / 3);
        const operation = Math.max(
            m.missRate > 0.12 ? Math.min(1, m.missRate / 0.35) : 0,
            m.thinkMs > 5000 ? Math.min(1, (m.thinkMs - 5000) / 10000) : 0
        );
        return _clamp01(visual * 0.45 + operation * 0.55);
    }

    /** 沉默后回归暖启动强度：0=无，1=强暖启动 */
    get returningWarmupStrength() {
        const last = this._lastSessionEndTs || this._getHistoricalCache().lastSessionTs || 0;
        if (!last) return 0;
        const days = (Date.now() - last) / 86_400_000;
        if (days < 1) return 0;
        if (days >= 7) return 1;
        if (days >= 3) return 0.75;
        return 0.45;
    }

    get personalizationContext() {
        return {
            options: this.personalizationOptions,
            behaviorSegment: this.behaviorSegment,
            motivationIntent: this.motivationIntent,
            accessibilityLoad: this.accessibilityLoad,
            returningWarmupStrength: this.returningWarmupStrength,
            usesSensitiveAttributes: false,
            allowedSignals: ['behavior', 'preferences', 'device', 'languageRegionContext'],
        };
    }

    /**
     * 新玩家标识：终身放置 < 20 次且历史不足 3 局
     */
    get isNewPlayer() {
        return this._totalLifetimePlacements < 20 && this._sessionHistory.length < 3;
    }

    /**
     * 是否在首局保护窗口内
     */
    get isInOnboarding() {
        const eng = _cfg().engagement ?? {};
        return this.isNewPlayer && this._spawnCounter <= (eng.firstSessionSpawns ?? 5);
    }

    /** 本局已完成的出块轮次（每轮 dock 刷新 +1），供调试面板展示 */
    get spawnRoundIndex() {
        return this._spawnCounter;
    }

    get lifetimeGames() {
        return this._totalLifetimeGames;
    }

    get lifetimePlacements() {
        return this._totalLifetimePlacements;
    }

    /**
     * v2 (2026-05)：玩家最近一次活跃时间戳（ms epoch）。
     *
     * 优先级：本进程上一局结束（_lastSessionEndTs） > 历史缓存里的 lastSessionTs > 0。
     * 供 `playerAbilityModel.confidence` 的 recencyDecay 项使用——长草玩家终身放置数
     * 仍可能很大，但近 N 天没玩说明模型对其当前状态把握不再可靠，置信度应衰减。
     *
     * 与 `returningWarmupStrength` 共用同一时间源，保持"沉默回归"信号家族的一致性。
     */
    get lastActiveTs() {
        return this._lastSessionEndTs || this._getHistoricalCache().lastSessionTs || 0;
    }

    /* ============================================================================
     * v1.48 (2026-05) — 数据层统一：生命周期"三大裸字段"
     *
     * 此前 `getLifecycleMaturitySnapshot` 期望从 `profile._daysSinceInstall /
     * _totalSessions / _daysSinceLastActive` 读取，但 `PlayerProfile` 从未提供
     * 这些字段的写入入口；同时 `playerInsightPanel` 用的是 `gameStats.daysSinceInstall`，
     * `playerLifecycleDashboard` / `socialIntroTrigger` 又各自从外部 `playerData`
     * 参数取数 —— 三者**不同源**，导致 snapshot.stageCode 实际几乎不离开 S0。
     *
     * 这里把"三大裸字段"统一在 `PlayerProfile` 上，所有上层（出块 / UI / 商业化 /
     * 召回）都从同一处取数；详见 docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md
     * 的"统一数据层"章节。
     * ============================================================================ */

    /** 装机至今天数（向下取整 0 起）。`_installTs` 在新构造时为 now，旧记录
     *  fromJSON 时回填为 sessionHistory[0].ts，再不行回退 now。 */
    get daysSinceInstall() {
        const ts = Number(this._installTs) || 0;
        if (!ts) return 0;
        return Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
    }

    /** 终身会话数（recordSessionEnd 计入 `_sessionHistory`，cap=30）。
     *  与 `lifetimeGames` 区别：`lifetimeGames` 来自 `_totalLifetimeGames`，
     *  即便历史 cap 之外也保留计数；`totalSessions` 优先用累计计数，
     *  缺失则降级到 `_sessionHistory.length`。 */
    get totalSessions() {
        return Math.max(this._totalLifetimeGames || 0, this._sessionHistory.length || 0);
    }

    /** 距上次活跃天数。lastActiveTs=0（从未活跃）时返回 0（视作"今天活跃"），
     *  避免冷启动玩家被误判为长草用户触发 winback。 */
    get daysSinceLastActive() {
        const last = this.lastActiveTs;
        if (!last) return 0;
        return Math.max(0, Math.floor((Date.now() - last) / 86_400_000));
    }

    /**
     * 生命周期"三大裸字段"打包：直接喂给 `getLifecycleMaturitySnapshot` /
     * `getPlayerLifecycleStage` / `evaluateWinbackTrigger` 等所有 retention 模块。
     *
     * 用法：`getLifecycleMaturitySnapshot(profile.lifecyclePayload)`。
     */
    get lifecyclePayload() {
        return {
            daysSinceInstall: this.daysSinceInstall,
            totalSessions: this.totalSessions,
            daysSinceLastActive: this.daysSinceLastActive,
        };
    }

    /**
     * v2 (2026-05)：盘面填充率最近变化速度（每步 fill 增量的窗口均值）。
     *
     * 物理含义：玩家最近 N 步把盘面"加速度往满了堆"的程度——boardFill 静态值
     * 0.75 表示当前满度，但"3 步内从 0.5 冲到 0.75"和"稳定停在 0.75"对死局风险
     * 的预示完全不同。前者 velocity ≈ +0.083，后者 ≈ 0。
     *
     * 实现：取最近 max(2, samples) 个 placed move（不含 miss），做相邻 fill 差分平均。
     * 样本不足返回 0；只看正向（消行后 fill 跳降不算"减压"，避免 velocity 抖到负值
     * 影响 riskLevel 估计）。
     *
     * @param {number} [windowSteps=5]  统计窗口
     * @returns {number}  通常 -0.1 ~ +0.2 之间，正值代表盘面在变满
     */
    boardFillVelocity(windowSteps = 5) {
        const w = Number.isFinite(windowSteps) && windowSteps > 1 ? Math.floor(windowSteps) : 5;
        const placed = this._moves.slice(-w).filter(m => !m.miss && Number.isFinite(m.fill));
        if (placed.length < 2) return 0;
        let sum = 0;
        let count = 0;
        for (let i = 1; i < placed.length; i++) {
            const dv = placed[i].fill - placed[i - 1].fill;
            // 消行后 fill 会跳降，跳降不算"减压"信号——只取正向 / 0 保留 velocity 的"风险加速"语义
            sum += Math.max(0, dv);
            count++;
        }
        return count > 0 ? sum / count : 0;
    }

    /** 闭环反馈偏移量，正值=玩家消行多于预期→可加压，负值=消行不足→应减压 */
    get feedbackBias() {
        return this._feedbackBias;
    }

    /**
     * 会话阶段：early（热身）/ peak（巅峰）/ late（疲劳）
     * @returns {'early'|'peak'|'late'}
     */
    get sessionPhase() {
        const elapsed = Date.now() - this._sessionStartTs;
        if (this._spawnCounter <= 2 || elapsed < 30_000) return 'early';
        if (elapsed < 300_000) return 'peak';
        return 'late';
    }

    /* ================================================================== */
    /*  持久化                                                             */
    /* ================================================================== */

    toJSON() {
        return {
            smoothSkill: this._smoothSkill,
            totalLifetimePlacements: this._totalLifetimePlacements,
            totalLifetimeGames: this._totalLifetimeGames,
            sessionHistory: this._sessionHistory.slice(-SESSION_HISTORY_CAP),
            personalizationOptions: this._personalizationOptions,
            preferenceSignals: this._preferenceSignals,
            modeCount: this._modeCount,
            lastSessionEndTs: this._lastSessionEndTs,
            installTs: this._installTs,
            savedAt: Date.now()
        };
    }

    save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
        } catch { /* private mode */ }
    }

    static fromJSON(data) {
        const p = new PlayerProfile();
        if (data?.smoothSkill != null) {
            let skill = data.smoothSkill;
            if (data.savedAt) {
                const hours = (Date.now() - data.savedAt) / 3_600_000;
                if (hours > SKILL_DECAY_HOURS) {
                    const decay = Math.min(0.5, hours / (SKILL_DECAY_HOURS * 10));
                    skill = skill * (1 - decay) + 0.5 * decay;
                }
            }
            p._smoothSkill = skill;
        }
        if (data?.totalLifetimePlacements != null) {
            p._totalLifetimePlacements = data.totalLifetimePlacements;
        }
        if (data?.totalLifetimeGames != null) {
            p._totalLifetimeGames = data.totalLifetimeGames;
        }
        if (Array.isArray(data?.sessionHistory)) {
            p._sessionHistory = data.sessionHistory.slice(-SESSION_HISTORY_CAP);
        }
        if (data?.personalizationOptions && typeof data.personalizationOptions === 'object') {
            p.setPersonalizationOptions(data.personalizationOptions);
        }
        if (data?.preferenceSignals && typeof data.preferenceSignals === 'object') {
            for (const [k, v] of Object.entries(data.preferenceSignals)) {
                if (Object.prototype.hasOwnProperty.call(p._preferenceSignals, k)) {
                    p._preferenceSignals[k] = Math.max(0, Number(v) || 0);
                }
            }
        }
        if (data?.modeCount && typeof data.modeCount === 'object') {
            p._modeCount = {
                endless: Math.max(0, Number(data.modeCount.endless) || 0),
                level: Math.max(0, Number(data.modeCount.level) || 0),
            };
        }
        if (Number.isFinite(Number(data?.lastSessionEndTs))) {
            p._lastSessionEndTs = Number(data.lastSessionEndTs);
        } else if (p._sessionHistory.length > 0) {
            p._lastSessionEndTs = p._sessionHistory[p._sessionHistory.length - 1].ts || 0;
        }
        /* v1.48：installTs 兼容旧记录——如果旧 JSON 没存这字段，回退到
         * 最早的 sessionHistory[0].ts；再不行用 savedAt（视作"那时已安装"）；
         * 最后兜底 Date.now() 让 daysSinceInstall=0（视作刚装机）。 */
        if (Number.isFinite(Number(data?.installTs)) && Number(data.installTs) > 0) {
            p._installTs = Number(data.installTs);
        } else if (p._sessionHistory.length > 0 && p._sessionHistory[0].ts) {
            p._installTs = p._sessionHistory[0].ts;
        } else if (Number.isFinite(Number(data?.savedAt)) && Number(data.savedAt) > 0) {
            p._installTs = Number(data.savedAt);
        }
        return p;
    }

    static load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (raw) return PlayerProfile.fromJSON(JSON.parse(raw));
        } catch { /* ignore */ }
        return new PlayerProfile();
    }

    /* ================================================================== */
    /*  内部                                                               */
    /* ================================================================== */

    /** @private */
    _pushMove(entry) {
        this._moves.push(entry);
        if (this._moves.length > this._window * 2) {
            this._moves = this._moves.slice(-this._window);
        }
    }

    /** @private */
    _recentMoves() {
        return this._moves.slice(-this._window);
    }

    /**
     * 原始技能值：5 维加权合成
     * @private
     */
    _computeRawSkill() {
        const m = this.metrics;
        const thinkScore = 1 - Math.max(0, Math.min(1, (m.thinkMs - 800) / 12000));
        const clearScore = Math.min(1, m.clearRate / 0.55);
        const comboScore = Math.min(1, m.comboRate / 0.45);
        const missScore = 1 - Math.min(1, m.missRate / 0.3);
        const loadScore = 1 - this.cognitiveLoad;
        return thinkScore * 0.15 + clearScore * 0.30 + comboScore * 0.20 + missScore * 0.20 + loadScore * 0.15;
    }

    /**
     * 计算并缓存长周期指标：historicalSkill、trend、confidence。
     * @private
     * @returns {{ skill: number, trend: number, confidence: number }}
     */
    _getHistoricalCache() {
        if (this._cachedHistorical) return this._cachedHistorical;

        const hist = this._sessionHistory;
        const hasBaseline = this._statsBaselineSkill >= 0;
        const hasHistory = hist.length >= 2;

        if (!hasBaseline && !hasHistory) {
            return (this._cachedHistorical = { skill: -1, trend: 0, confidence: 0, lastSessionTs: 0 });
        }

        /* ---- 会话历史加权均值（近期权重大） ---- */
        let histSkill = -1;
        if (hasHistory) {
            const decay = 0.85;
            let wSum = 0;
            let wTotal = 0;
            for (let i = 0; i < hist.length; i++) {
                const w = Math.pow(decay, hist.length - 1 - i);
                wSum += hist[i].skill * w;
                wTotal += w;
            }
            histSkill = wTotal > 0 ? wSum / wTotal : 0.5;
        }

        /* ---- 与后端统计基线融合 ---- */
        let skill;
        if (histSkill >= 0 && hasBaseline) {
            const sessionWeight = Math.min(1, hist.length / 10);
            skill = histSkill * sessionWeight + this._statsBaselineSkill * (1 - sessionWeight);
        } else if (histSkill >= 0) {
            skill = histSkill;
        } else {
            skill = this._statsBaselineSkill;
        }

        /* ---- 趋势：指数加权线性回归 ---- */
        let trend = 0;
        if (hist.length >= 3) {
            const n = hist.length;
            const tDecay = 0.9;
            let swx = 0, sw = 0, swy = 0, swx2 = 0, swxy = 0;
            for (let i = 0; i < n; i++) {
                const wi = Math.pow(tDecay, n - 1 - i);
                const xi = i / (n - 1);
                const yi = hist[i].skill;
                sw += wi;
                swx += wi * xi;
                swy += wi * yi;
                swx2 += wi * xi * xi;
                swxy += wi * xi * yi;
            }
            const denom = sw * swx2 - swx * swx;
            if (Math.abs(denom) > 1e-12) {
                const slope = (sw * swxy - swx * swy) / denom;
                trend = Math.max(-1, Math.min(1, slope * 2));
            }
        }

        /* ---- 置信度：局数 + 新鲜度 ---- */
        const totalGames = Math.max(this._totalLifetimeGames, hist.length);
        const gameConf = Math.min(1, totalGames / 20);
        let freshnessConf = 1;
        if (hist.length > 0) {
            const lastTs = hist[hist.length - 1].ts;
            const hoursAgo = (Date.now() - lastTs) / 3_600_000;
            if (hoursAgo > SKILL_DECAY_HOURS) {
                freshnessConf = Math.max(0.3, 1 - (hoursAgo - SKILL_DECAY_HOURS) / (SKILL_DECAY_HOURS * 10));
            }
        } else if (hasBaseline) {
            freshnessConf = 0.5;
        }
        const confidence = Math.max(0, Math.min(1, gameConf * freshnessConf));

        const lastSessionTs = hist.length > 0 ? (hist[hist.length - 1].ts || 0) : 0;
        return (this._cachedHistorical = { skill, trend, confidence, lastSessionTs });
    }

    /* ================================================================== */
    /*  扩展维度：sessionTrend / modePref / 五分群                        */
    /* ================================================================== */

    /**
     * 会话局数趋势（近 5 局 vs 前 5 局的放置次数变化）
     * @returns {'rising'|'stable'|'declining'}
     */
    get sessionTrend() {
        const h = this._sessionHistory;
        if (h.length < 6) return 'stable';
        const recent = h.slice(-5).reduce((s, e) => s + e.placements, 0) / 5;
        const older  = h.slice(-10, -5).reduce((s, e) => s + e.placements, 0) / Math.max(1, h.slice(-10, -5).length);
        const ratio = older > 0 ? recent / older : 1;
        if (ratio > 1.15) return 'rising';
        if (ratio < 0.80) return 'declining';
        return 'stable';
    }

    /**
     * 模式偏好
     * @returns {'endless'|'level'|'mixed'}
     */
    get modePref() {
        const e = this._modeCount.endless ?? 0;
        const l = this._modeCount.level ?? 0;
        const total = e + l;
        if (total === 0) return 'endless';
        const levelRatio = l / total;
        if (levelRatio > 0.6) return 'level';
        if (levelRatio > 0.3) return 'mixed';
        return 'endless';
    }

    /**
     * 五分群分类（对应竞品分析 A–E 类）
     *
     * A 轻度休闲：低技能 + 非高频 + 无尽偏好
     * B 中度无尽：中技能 + 稳定/下降 + 强无尽偏好
     * C 重度高价值：高技能 + 下降趋势 + 高历史局数
     * D 中度关卡：任意技能 + 关卡偏好
     * E 高能玩家：极高技能 + 无尽偏好
     *
     * @returns {'A'|'B'|'C'|'D'|'E'}
     */
    get segment5() {
        const skill = this.skillLevel;
        const trend = this.sessionTrend;
        const mode  = this.modePref;
        const games = this._totalLifetimeGames;

        // E 类：极高技能
        if (skill > 0.82) return 'E';

        // D 类：明显关卡偏好
        if (mode === 'level' || mode === 'mixed') return 'D';

        // C 类：高技能 + 下降趋势 + 有足够游戏历史
        if (skill > 0.62 && trend === 'declining' && games >= 20) return 'C';

        // B 类：中技能 + 稳定/上升 + 无尽
        if (skill > 0.38 && mode === 'endless') return 'B';

        // 默认 A 类
        return 'A';
    }
}
