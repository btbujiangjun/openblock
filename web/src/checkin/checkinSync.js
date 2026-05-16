/**
 * 签到相关 localStorage 与 Flask SQLite 同步（user_checkin_bundle）。
 * 仅在 VITE_USE_SQLITE_DB 开启时启用；失败时静默回退本地。
 */
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';

const CHECKIN_STORAGE_KEYS = {
    checkin: 'openblock_checkin_v1',
    loginStreak: 'openblock_login_streak_v1',
    monthly: 'openblock_monthly_milestone_v1',
    /** 与 progression/skinFragments.js 同源：unlocked、lastEarnYmd 等 */
    skinFragments: 'openblock_skin_fragments_v1',
};

const CHECKIN_DEBUG_FLAG = 'openblock_checkin_debug_v1';

function getBbUserId() {
    try {
        let userId = localStorage.getItem('bb_user_id');
        if (!userId) {
            userId = 'u' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('bb_user_id', userId);
        }
        return userId;
    } catch {
        return '';
    }
}

async function _apiJson(path, options = {}) {
    const base = getApiBaseUrl().replace(/\/+$/, '');
    const res = await fetch(`${base}${path}`, {
        headers: { 'Content-Type': 'application/json', ...options.headers },
        ...options,
    });
    const text = await res.text();
    let data = null;
    if (text) {
        try {
            data = JSON.parse(text);
        } catch {
            data = { _raw: text };
        }
    }
    if (!res.ok) {
        const err = new Error(data?.error || `HTTP ${res.status} ${path}`);
        err.status = res.status;
        throw err;
    }
    return data;
}

function _defaultCheckin() {
    return { lastClaimYmd: null, streak: 0, totalDays: 0, history: [] };
}

function _defaultSkinFragments() {
    return { unlocked: [], lastEarnYmd: null };
}

function _readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw);
    } catch {
        return fallback;
    }
}

function _isDevEnv() {
    try {
        return !!(import.meta && import.meta.env && import.meta.env.DEV);
    } catch {
        return false;
    }
}

function _isCheckinDebugEnabled() {
    try {
        return _isDevEnv() && localStorage.getItem(CHECKIN_DEBUG_FLAG) === '1';
    } catch {
        return false;
    }
}

function _debugLog(stage, payload) {
    if (!_isCheckinDebugEnabled()) return;
    try {
        console.info(`[checkin-sync][debug] ${stage}`, payload);
    } catch {
        // ignore
    }
}

function _parseYmdToTs(ymd) {
    if (typeof ymd !== 'string') return Number.NaN;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
    if (!m) return Number.NaN;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return Number.NaN;
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return Number.NaN;
    return Date.UTC(y, mo - 1, d);
}

function _compareYmd(a, b) {
    const ta = _parseYmdToTs(a);
    const tb = _parseYmdToTs(b);
    if (Number.isFinite(ta) && Number.isFinite(tb)) return ta === tb ? 0 : (ta > tb ? 1 : -1);
    if (Number.isFinite(ta)) return 1;
    if (Number.isFinite(tb)) return -1;
    return 0;
}

function _normalizeCheckin(s) {
    const base = _defaultCheckin();
    if (!s || typeof s !== 'object') return base;
    const totalDays = Number.isFinite(s.totalDays) ? Math.max(0, Math.floor(s.totalDays)) : 0;
    const streak = Number.isFinite(s.streak) ? Math.max(0, Math.floor(s.streak)) : 0;
    const history = Array.isArray(s.history) ? s.history.filter((x) => typeof x === 'string') : [];
    return {
        lastClaimYmd: typeof s.lastClaimYmd === 'string' ? s.lastClaimYmd : null,
        streak,
        totalDays,
        history,
    };
}

/**
 * 防回滚合并：避免服务端旧 bundle 覆盖本地新签到数据（会导致 UI 重新出现“第1天”）。
 */
function _mergeCheckinState(localState, remoteState) {
    const local = _normalizeCheckin(localState);
    const remote = _normalizeCheckin(remoteState);

    // history 先并集去重，最后截断 90 天（与 checkInPanel 持久化口径一致）
    const historySet = new Set([...local.history, ...remote.history]);
    const mergedHistory = Array.from(historySet)
        .sort((a, b) => _compareYmd(a, b))
        .slice(-90);

    const cmp = _compareYmd(local.lastClaimYmd, remote.lastClaimYmd);
    let chosen = local;
    if (cmp < 0) chosen = remote;
    else if (cmp === 0) {
        // 同一天：保留更大的 streak / totalDays，避免因为某端写回不完整而回退
        chosen = {
            ...local,
            streak: Math.max(local.streak, remote.streak),
            totalDays: Math.max(local.totalDays, remote.totalDays),
            lastClaimYmd: local.lastClaimYmd || remote.lastClaimYmd || null,
            history: mergedHistory,
        };
    }

    const out = {
        ...chosen,
        totalDays: Math.max(local.totalDays, remote.totalDays, chosen.totalDays),
        history: mergedHistory,
    };
    return out;
}

function _mergeLoginStreak(localMedals, remoteMedals) {
    const l = localMedals && typeof localMedals === 'object' ? localMedals : {};
    const r = remoteMedals && typeof remoteMedals === 'object' ? remoteMedals : {};
    const out = {};
    for (const id of new Set([...Object.keys(l), ...Object.keys(r)])) {
        const a = l[id] && typeof l[id] === 'object' ? l[id] : null;
        const b = r[id] && typeof r[id] === 'object' ? r[id] : null;
        if (a && b) {
            out[id] = {
                unlockedAt: Math.max(Number(a.unlockedAt) || 0, Number(b.unlockedAt) || 0),
                totalDays: Math.max(Number(a.totalDays) || 0, Number(b.totalDays) || 0),
            };
        } else {
            out[id] = a || b || {};
        }
    }
    return out;
}

function _mergeMonthlyMilestone(localMs, remoteMs) {
    const l = localMs && typeof localMs === 'object' ? localMs : { lastMilestoneDay: 0 };
    const r = remoteMs && typeof remoteMs === 'object' ? remoteMs : { lastMilestoneDay: 0 };
    return {
        lastMilestoneDay: Math.max(Number(l.lastMilestoneDay) || 0, Number(r.lastMilestoneDay) || 0),
    };
}

function _mergeSkinFragments(localSf, remoteSf) {
    const l = localSf && typeof localSf === 'object' ? localSf : _defaultSkinFragments();
    const r = remoteSf && typeof remoteSf === 'object' ? remoteSf : _defaultSkinFragments();
    const unlocked = Array.from(new Set([
        ...(Array.isArray(l.unlocked) ? l.unlocked : []),
        ...(Array.isArray(r.unlocked) ? r.unlocked : []),
    ]));
    const localLast = typeof l.lastEarnYmd === 'string' ? l.lastEarnYmd : null;
    const remoteLast = typeof r.lastEarnYmd === 'string' ? r.lastEarnYmd : null;
    return {
        unlocked,
        lastEarnYmd: _compareYmd(localLast, remoteLast) >= 0 ? localLast : remoteLast,
    };
}

/** 从当前 localStorage 组装与 PUT 一致的 bundle（供调试或测试） */
function buildCheckinBundleFromLocalStorage() {
    const c = _readJson(CHECKIN_STORAGE_KEYS.checkin, null);
    const sf = _readJson(CHECKIN_STORAGE_KEYS.skinFragments, null);
    return {
        checkin: c && typeof c === 'object' ? c : _defaultCheckin(),
        loginStreakMedals: _readJson(CHECKIN_STORAGE_KEYS.loginStreak, {}) || {},
        monthlyMilestone: _readJson(CHECKIN_STORAGE_KEYS.monthly, { lastMilestoneDay: 0 }) || {
            lastMilestoneDay: 0,
        },
        skinFragments: sf && typeof sf === 'object' ? sf : _defaultSkinFragments(),
    };
}

let _persistTimer = null;

async function _flushPersist() {
    _persistTimer = null;
    const userId = getBbUserId();
    if (!userId) return;
    try {
        const bundle = buildCheckinBundleFromLocalStorage();
        await _apiJson('/api/checkin-bundle', {
            method: 'PUT',
            body: JSON.stringify({ user_id: userId, bundle }),
        });
    } catch (e) {
        console.warn('[checkin-sync] 写入 SQLite 失败，仅保留本地:', e);
    }
}

/** 签到 / 勋章 / 月度里程碑变更后调用（防抖合并写入） */
export function persistCheckinBundleToServer() {
    if (!isSqliteClientDatabase() || typeof window === 'undefined') return;
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => void _flushPersist(), 400);
}

/**
 * game.init 成功后调用：用服务端 bundle 覆盖签到相关 localStorage，并触发月度里程碑重算。
 */
export async function hydrateCheckinFromServer() {
    if (!isSqliteClientDatabase() || typeof window === 'undefined') return;
    const userId = getBbUserId();
    if (!userId) return;
    try {
        const data = await _apiJson(
            `/api/checkin-bundle?user_id=${encodeURIComponent(userId)}`,
            { method: 'GET' },
        );
        const remote = data?.bundle;
        if (!remote || typeof remote !== 'object') return;
        const local = buildCheckinBundleFromLocalStorage();
        const merged = {
            checkin: _mergeCheckinState(local.checkin, remote.checkin),
            loginStreakMedals: _mergeLoginStreak(local.loginStreakMedals, remote.loginStreakMedals),
            monthlyMilestone: _mergeMonthlyMilestone(local.monthlyMilestone, remote.monthlyMilestone),
            skinFragments: _mergeSkinFragments(local.skinFragments, remote.skinFragments),
        };
        _debugLog('hydrate.merge', {
            localCheckin: local.checkin,
            remoteCheckin: remote.checkin || null,
            mergedCheckin: merged.checkin,
        });

        localStorage.setItem(CHECKIN_STORAGE_KEYS.checkin, JSON.stringify(merged.checkin));
        localStorage.setItem(CHECKIN_STORAGE_KEYS.loginStreak, JSON.stringify(merged.loginStreakMedals));
        localStorage.setItem(CHECKIN_STORAGE_KEYS.monthly, JSON.stringify(merged.monthlyMilestone));
        localStorage.setItem(CHECKIN_STORAGE_KEYS.skinFragments, JSON.stringify(merged.skinFragments));

        // 若本地存在更新（合并后与服务端不同），回写服务端以自愈，避免下次启动再次被旧数据“压回去”。
        const shouldRepersist = JSON.stringify(merged) !== JSON.stringify(remote);
        _debugLog('hydrate.repersist', { shouldRepersist });
        if (shouldRepersist) {
            persistCheckinBundleToServer();
        }
        const { recheckMonthlyAfterHydrate } = await import('./monthlyMilestone.js');
        recheckMonthlyAfterHydrate();
    } catch (e) {
        console.warn('[checkin-sync] 从 SQLite 拉取签到数据失败，使用本地:', e);
    }
}

export const __test_only__ = {
    CHECKIN_DEBUG_FLAG,
    _isCheckinDebugEnabled,
    _debugLog,
    _parseYmdToTs,
    _compareYmd,
    _mergeCheckinState,
    _mergeLoginStreak,
    _mergeMonthlyMilestone,
    _mergeSkinFragments,
};
