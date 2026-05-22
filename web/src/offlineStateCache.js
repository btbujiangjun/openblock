/**
 * offlineStateCache.js — 出块算法信号 + 玩家关键状态的 localStorage 快照
 *
 * 定位：SQLite 的补充，而非替代。
 *   - SQLite 存储完整的跨局历史（每局 events、得分序列等），适合服务端分析；
 *   - 本模块把出块算法**当前轮所需的最小信号集**写入 localStorage，
 *     确保玩家在离线（无 Flask 服务）或首次加载（SQLite 尚未 hydrate 完成）时
 *     也能读到上一局末尾的准确画像，不必降级到默认值。
 *
 * 键名：`openblock_spawn_signals_v1`（已纳入 localStorageStateSync.js CORE_KEYS，
 *       随 core 分区每 5 秒同步到 SQLite）。
 *
 * 写入时机：每回合 spawnBlocks 结束后调用 writeSpawnSignals(game)，约 100ms 内完成。
 * 读取时机：game 初始化时 / adaptiveSpawn 构造 profile 数据时，若 SQLite 不可用则回退读本模块。
 *
 * @module offlineStateCache
 */

const STORAGE_KEY = 'openblock_spawn_signals_v1';
const SCHEMA_VERSION = 2; // 字段变更时递增，旧版本自动丢弃

/** 快照最大保留条目（循环覆盖，仅保留最新 N 局） */
const MAX_SESSION_HISTORY_SNAPSHOT = 10;

// ─── 写入 ────────────────────────────────────────────────────────────────────

/**
 * 从 game 实例提取出块算法关键信号并写入 localStorage。
 * 应在 spawnBlocks() 完成后调用（每回合约 1 次）。
 *
 * @param {import('./game.js').Game} game
 */
export function writeSpawnSignals(game) {
    if (!game) return;
    try {
        const profile = game._playerProfile ?? game.playerProfile;
        const ctx = game._spawnContext ?? {};
        const lastInsight = game._lastAdaptiveInsight ?? {};
        const stressBreakdown = lastInsight.stressBreakdown ?? {};

        const snapshot = {
            _v: SCHEMA_VERSION,
            _ts: Date.now(),

            /* ── 玩家核心进度 ── */
            bestScore: game.bestScore ?? 0,
            score: game.score ?? 0,
            runStreak: game.runStreak ?? 0,

            /* ── PlayerProfile 字段（出块算法直接依赖） ── */
            skillLevel:         profile?.skillLevel ?? 0,
            flowState:          profile?.flowState ?? 'flow',
            momentum:           profile?.momentum ?? 0,
            frustrationLevel:   profile?.frustrationLevel ?? 0,
            isInOnboarding:     profile?.isInOnboarding ?? false,
            lifetimeGames:      profile?._lifetimeGames ?? profile?.lifetimeGames ?? 0,
            daysSinceInstall:   profile?._daysSinceInstall ?? profile?.daysSinceInstall ?? 0,
            totalSessions:      profile?._totalSessions ?? profile?.totalSessions ?? profile?.lifetimeGames ?? 0,
            daysSinceLastActive: profile?._daysSinceLastActive ?? profile?.daysSinceLastActive ?? 0,
            /* 近 N 局会话摘要（只取最近 MAX_SESSION_HISTORY_SNAPSHOT 条减少体积） */
            sessionHistoryTail: (profile?._sessionHistory ?? [])
                .slice(-MAX_SESSION_HISTORY_SNAPSHOT)
                .map((s) => ({
                    score: s.score,
                    clearRate: s.clearRate,
                    duration: s.duration,
                    ts: s.ts,
                })),
            /* 爽感饥渴度 */
            roundsSinceLastDelight: profile?._roundsSinceLastDelight ?? 0,

            /* ── 局内滚动上下文（跨轮积累量） ── */
            roundIndex:         ctx.roundIndex ?? 0,
            hadRecentNearMiss:  ctx.hadRecentNearMiss ?? false,
            monoFlushRound:     ctx.monoFlushRound ?? 0,
            comboChain:         ctx.comboChain ?? 0,
            clearSinceStart:    ctx.clearSinceStart ?? 0,

            /* ── 最近一次 adaptiveSpawn 输出的核心派生信号 ── */
            stress:             lastInsight.stress ?? 0,
            spawnIntent:        lastInsight.spawnIntent ?? 'maintain',
            lifecycleStage:     stressBreakdown.lifecycleStage ?? null,
            lifecycleBand:      stressBreakdown.lifecycleBand ?? null,
            lifecycleCapAdjust: stressBreakdown.lifecycleCapAdjust ?? 0,
            spawnHintsClearGuarantee: lastInsight.spawnHints?.clearGuarantee ?? 0,
            spawnHintsSizePreference: lastInsight.spawnHints?.sizePreference ?? 0,
        };

        localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
        /* localStorage 满或隐私模式：静默忽略，不影响游戏主流程 */
        console.warn('[offlineStateCache] writeSpawnSignals failed:', e);
    }
}

// ─── 读取 ────────────────────────────────────────────────────────────────────

/**
 * 读取上次写入的出块信号快照。
 * 若键不存在、schema 版本不匹配或解析失败，返回 null。
 *
 * @returns {{ bestScore: number, skillLevel: number, flowState: string, ... } | null}
 */
export function readSpawnSignals() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (!obj || obj._v !== SCHEMA_VERSION) return null;
        return obj;
    } catch {
        return null;
    }
}

/**
 * 将快照合并到 PlayerProfile / game 上下文，仅填充 profile 中**尚未有值**的字段。
 * 这是"离线降级"路径：SQLite hydrate 失败时，用本地快照恢复上次离开时的状态。
 *
 * @param {import('./game.js').Game} game
 * @returns {boolean} 是否实际执行了合并
 */
export function hydrateFromSpawnSignals(game) {
    if (!game) return false;
    const snap = readSpawnSignals();
    if (!snap) return false;

    try {
        const profile = game._playerProfile ?? game.playerProfile;

        /* bestScore：以快照与当前内存的较大值为准（防回滚） */
        if (typeof snap.bestScore === 'number' && snap.bestScore > (game.bestScore ?? 0)) {
            game.bestScore = snap.bestScore;
        }

        if (profile) {
            /* 只补填 profile 中尚为默认值（0 / null / undefined）的字段 */
            if (!profile._lifetimeGames && snap.lifetimeGames) {
                profile._lifetimeGames = snap.lifetimeGames;
            }
            if (!profile._daysSinceInstall && snap.daysSinceInstall) {
                profile._daysSinceInstall = snap.daysSinceInstall;
            }
            if (!profile._totalSessions && snap.totalSessions) {
                profile._totalSessions = snap.totalSessions;
            }
            if (!profile._daysSinceLastActive && snap.daysSinceLastActive) {
                profile._daysSinceLastActive = snap.daysSinceLastActive;
            }
            /* sessionHistory：若本地为空且快照有数据，恢复最后 N 条（启用 smooth-skill 计算）*/
            if (
                Array.isArray(snap.sessionHistoryTail) &&
                snap.sessionHistoryTail.length > 0 &&
                (!profile._sessionHistory || profile._sessionHistory.length === 0)
            ) {
                profile._sessionHistory = snap.sessionHistoryTail;
            }
            if (!profile._roundsSinceLastDelight && snap.roundsSinceLastDelight) {
                profile._roundsSinceLastDelight = snap.roundsSinceLastDelight;
            }
        }

        /* 回填跨轮上下文 */
        if (game._spawnContext) {
            const ctx = game._spawnContext;
            if (!ctx.monoFlushRound && snap.monoFlushRound) ctx.monoFlushRound = snap.monoFlushRound;
            if (!ctx.comboChain && snap.comboChain) ctx.comboChain = snap.comboChain;
            if (!ctx.clearSinceStart && snap.clearSinceStart) ctx.clearSinceStart = snap.clearSinceStart;
        }

        return true;
    } catch (e) {
        console.warn('[offlineStateCache] hydrateFromSpawnSignals failed:', e);
        return false;
    }
}

/**
 * 清除快照（游戏重置 / 注销时调用）。
 */
export function clearSpawnSignals() {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
}

/**
 * 返回快照的人类可读摘要（供 Debug / DFV 面板使用）。
 *
 * @returns {string}
 */
export function describeSpawnSignals() {
    const snap = readSpawnSignals();
    if (!snap) return '（无快照）';
    const age = Math.round((Date.now() - (snap._ts ?? 0)) / 1000);
    return [
        `best=${snap.bestScore} stress=${snap.stress?.toFixed(3)} intent=${snap.spawnIntent}`,
        `skill=${snap.skillLevel?.toFixed(3)} flow=${snap.flowState} momentum=${snap.momentum?.toFixed(2)}`,
        `stage=${snap.lifecycleStage ?? '?'}·${snap.lifecycleBand ?? '?'} capAdj=${snap.lifecycleCapAdjust?.toFixed(3)}`,
        `rounds=${snap.roundIndex} delight-drought=${snap.roundsSinceLastDelight}`,
        `（${age}s ago）`,
    ].join(' | ');
}
