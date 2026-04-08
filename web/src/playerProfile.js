/**
 * 玩家实时能力画像（增强版）
 *
 * 基于滑动窗口行为数据计算多维技能指标与实时状态信号，
 * 供自适应出块引擎匹配最优投放策略、维持心流体验。
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │  输入信号          →   能力维度           →   状态输出           │
 * │  thinkMs              skillLevel(0~1)        flowState           │
 * │  cleared / lines      momentum(-1~1)         pacingPhase         │
 * │  boardFill             cognitiveLoad(0~1)     frustrationLevel    │
 * │  miss                  engagementAPM          sessionPhase        │
 * │  timestamps            clearRate/comboRate     hadRecentNearMiss  │
 * │                                                isNewPlayer        │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * 设计依据：
 *   - 贝叶斯快速收敛：前 fastConvergenceWindow 步用更大 alpha（论文实测拼图 5 步可用）
 *   - 心流三态：bored / flow / anxious（Csíkszentmihályi 模型）
 *   - 差一点效应（Near-Miss）：高填充下未消行 → 下轮投放消行友好块，转挫败为动力
 *   - 节奏张弛：spawnCounter 驱动周期相位（tension / release）
 *   - 认知负荷：thinkMs 方差高 → 玩家对特定局面犹豫，认知压力大
 *
 * 持久化到 localStorage，跨局保留技能估计 + 终身局数。
 */

import { GAME_RULES } from './gameRules.js';

const STORAGE_KEY = 'openblock_player_profile';
const SKILL_DECAY_HOURS = 24;
function _afkThreshold() {
    return (_cfg().afk?.thresholdMs) ?? 15_000;
}
function _fb() {
    return _cfg().feedback ?? {};
}

function _cfg() {
    return GAME_RULES.adaptiveSpawn ?? {};
}

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

    /* ================================================================== */
    /*  基础指标                                                           */
    /* ================================================================== */

    /** @returns {{ thinkMs:number, clearRate:number, comboRate:number, missRate:number, afkCount:number }} */
    get metrics() {
        const recent = this._recentMoves();
        if (recent.length === 0) {
            return { thinkMs: 3000, clearRate: 0.3, comboRate: 0.1, missRate: 0.1, afkCount: 0 };
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
            afkCount
        };
    }

    /* ================================================================== */
    /*  能力维度                                                           */
    /* ================================================================== */

    /** 综合技能水平 0~1（指数平滑，前 5 步贝叶斯快速收敛） */
    get skillLevel() {
        return Math.max(0, Math.min(1, this._smoothSkill));
    }

    /**
     * 动量：最近表现相对历史的变化趋势 -1(急跌)~0(稳定)~1(上升)
     * 对比滑动窗口前半和后半的 clearRate 差异
     */
    get momentum() {
        const recent = this._recentMoves();
        if (recent.length < 6) return 0;
        const mid = Math.floor(recent.length / 2);
        const olderPlaced = recent.slice(0, mid).filter(m => !m.miss);
        const newerPlaced = recent.slice(mid).filter(m => !m.miss);
        if (olderPlaced.length < 2 || newerPlaced.length < 2) return 0;

        const olderCR = olderPlaced.filter(m => m.cleared).length / olderPlaced.length;
        const newerCR = newerPlaced.filter(m => m.cleared).length / newerPlaced.length;
        const delta = newerCR - olderCR;
        return Math.max(-1, Math.min(1, delta / 0.3));
    }

    /**
     * 认知负荷 0~1：thinkMs 方差越大 → 玩家对部分局面犹豫不决，认知压力高
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
     * 新玩家标识：终身放置 < 20 次
     * 首局保护：新玩家的前 N 轮 spawn 使用 onboarding 策略
     */
    get isNewPlayer() {
        return this._totalLifetimePlacements < 20;
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
}
