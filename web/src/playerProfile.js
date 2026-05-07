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

        /** @type {Array<{ts:number, thinkMs:number, cleared:boolean, lines:number, fill:number, miss:boolean}>} */
        this._moves = [];
        this._lastActionTs = 0;

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
     * @param {boolean} cleared 本次放置是否触发消行
     * @param {number} linesCleared 消除行数
     * @param {number} boardFill 放置后板面填充率 0~1
     */
    recordPlace(cleared, linesCleared, boardFill) {
        const now = Date.now();
        const thinkMs = this._lastActionTs > 0
            ? Math.min(now - this._lastActionTs, 60000)
            : 3000;

        this._pushMove({ ts: now, thinkMs, cleared, lines: linesCleared, fill: boardFill, miss: false });
        this._lastActionTs = now;
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
        this._pushMove({ ts: now, thinkMs, cleared: false, lines: 0, fill: 0, miss: true });
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
        const recent = this._recentMoves();
        if (recent.length === 0) {
            return {
                thinkMs: 3000, clearRate: 0.3, comboRate: 0.1, missRate: 0.1,
                afkCount: 0, samples: 0, activeSamples: 0
            };
        }
        const placed = recent.filter(m => !m.miss);
        const afkMs = _afkThreshold();
        const active = placed.filter(m => m.thinkMs < afkMs);
        const afkCount = placed.length - active.length;
        const clearCount = active.filter(m => m.cleared).length;
        const comboCount = active.filter(m => m.lines >= 2).length;
        return {
            thinkMs: active.length > 0
                ? active.reduce((s, m) => s + m.thinkMs, 0) / active.length
                : 3000,
            clearRate: active.length > 0 ? clearCount / active.length : 0.3,
            comboRate: clearCount > 0 ? comboCount / clearCount : 0,
            missRate: recent.length > 0
                ? recent.filter(m => m.miss).length / recent.length
                : 0,
            afkCount,
            samples: recent.length,
            activeSamples: active.length
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
     * v1.13：增加最小样本阈值 + 样本置信度缩放，避免 2~3 个样本时 momentum 抖到 ±1
     * 与玩家直觉脱节（screenshot 案例：clearRate=0.4 但 momentum=-1）。
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
        return clamped * sampleConfidence;
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
     * @returns {'bored'|'flow'|'anxious'}
     */
    get flowState() {
        const recent = this._recentMoves();
        if (recent.length < 5) return 'flow';

        const fd = this.flowDeviation;
        if (fd < 0.25) return 'flow';

        const m = this.metrics;
        const fz = _cfg().flowZone ?? {};

        if (m.thinkMs < (fz.thinkTimeLowMs ?? 1200)
            && m.clearRate > 0.45
            && m.missRate < 0.05) {
            return 'bored';
        }

        if (m.missRate > (fz.missRateWorry ?? 0.28)) return 'anxious';

        if (m.thinkMs > (fz.thinkTimeHighMs ?? 10000) && m.clearRate < 0.15) {
            return 'anxious';
        }

        const placedMoves = recent.filter(r => !r.miss);
        if (placedMoves.length > 0) {
            const avgFill = placedMoves.reduce((s, r) => s + r.fill, 0) / placedMoves.length;
            if (avgFill > 0.78 && m.clearRate < 0.2) return 'anxious';
        }

        if (this.cognitiveLoad > 0.7 && m.clearRate < 0.25) return 'anxious';

        if (fd > 0.5 && m.clearRate > 0.4) return 'bored';

        return 'flow';
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
            return (this._cachedHistorical = { skill: -1, trend: 0, confidence: 0 });
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

        return (this._cachedHistorical = { skill, trend, confidence });
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
