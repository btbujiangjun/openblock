/**
 * 签到相关 localStorage 与 Flask SQLite 同步（user_checkin_bundle）。
 * 仅在 VITE_USE_SQLITE_DB 开启时启用；失败时静默回退本地。
 */
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';

export const CHECKIN_STORAGE_KEYS = {
    checkin: 'openblock_checkin_v1',
    loginStreak: 'openblock_login_streak_v1',
    monthly: 'openblock_monthly_milestone_v1',
    /** 与 progression/skinFragments.js 同源：unlocked、lastEarnYmd 等 */
    skinFragments: 'openblock_skin_fragments_v1',
};

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

/** 从当前 localStorage 组装与 PUT 一致的 bundle（供调试或测试） */
export function buildCheckinBundleFromLocalStorage() {
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
        const b = data?.bundle;
        if (!b || typeof b !== 'object') return;

        if (b.checkin && typeof b.checkin === 'object') {
            localStorage.setItem(CHECKIN_STORAGE_KEYS.checkin, JSON.stringify(b.checkin));
        }
        if (b.loginStreakMedals && typeof b.loginStreakMedals === 'object') {
            localStorage.setItem(
                CHECKIN_STORAGE_KEYS.loginStreak,
                JSON.stringify(b.loginStreakMedals),
            );
        }
        if (b.monthlyMilestone && typeof b.monthlyMilestone === 'object') {
            localStorage.setItem(
                CHECKIN_STORAGE_KEYS.monthly,
                JSON.stringify(b.monthlyMilestone),
            );
        }
        if (b.skinFragments && typeof b.skinFragments === 'object') {
            localStorage.setItem(
                CHECKIN_STORAGE_KEYS.skinFragments,
                JSON.stringify(b.skinFragments),
            );
        }
        const { recheckMonthlyAfterHydrate } = await import('./monthlyMilestone.js');
        recheckMonthlyAfterHydrate();
    } catch (e) {
        console.warn('[checkin-sync] 从 SQLite 拉取签到数据失败，使用本地:', e);
    }
}
