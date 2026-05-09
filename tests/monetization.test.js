/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * jsdom 部分 localStorage 方法可能不可用（getItem/clear）。
 * 用自定义内存 localStorage mock 覆盖，以隔离模块状态。
 */
function makeLocalStorageMock() {
    const store = Object.create(null);
    return {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        get length() { return Object.keys(store).length; },
        key: (i) => Object.keys(store)[i] ?? null,
    };
}

// 在所有模块加载之前设置 mock localStorage
const _mockLS = makeLocalStorageMock();
vi.stubGlobal('localStorage', _mockLS);

function clearLS() { _mockLS.clear(); }

// ---------- featureFlags ----------
import {
    getFlag,
    setFlag,
    resetFlags,
    getAllFlags,
    FLAG_DEFAULTS,
} from '../web/src/monetization/featureFlags.js';

describe('featureFlags', () => {
    beforeEach(() => {
        clearLS();
        resetFlags();
    });

    it('defaults match FLAG_DEFAULTS', () => {
        for (const [k, v] of Object.entries(FLAG_DEFAULTS)) {
            expect(getFlag(k)).toBe(v);
        }
    });

    it('setFlag persists and reflects immediately', () => {
        setFlag('adsRewarded', true);
        expect(getFlag('adsRewarded')).toBe(true);
        const stored = JSON.parse(_mockLS.getItem('openblock_mon_flags_v1') ?? '{}');
        expect(stored.adsRewarded).toBe(true);
    });

    it('resetFlags clears all overrides', () => {
        setFlag('adsRewarded', true);
        setFlag('iap', true);
        resetFlags();
        expect(getFlag('adsRewarded')).toBe(FLAG_DEFAULTS.adsRewarded);
        expect(getFlag('iap')).toBe(FLAG_DEFAULTS.iap);
    });

    it('getAllFlags returns snapshot', () => {
        const all = getAllFlags();
        expect(typeof all).toBe('object');
        expect(Object.keys(all).length).toBeGreaterThan(0);
    });
});

// ---------- MonetizationBus ----------
import * as Bus from '../web/src/monetization/MonetizationBus.js';

describe('MonetizationBus', () => {
    beforeEach(() => {
        Bus._clearAllHandlers();
        Bus.detach();
    });
    afterEach(() => {
        Bus._clearAllHandlers();
        Bus.detach();
    });

    it('on/emit/off basic cycle', () => {
        const calls = [];
        const unsub = Bus.on('test_event', ({ data }) => calls.push(data));
        Bus.emit('test_event', { x: 1 });
        Bus.emit('test_event', { x: 2 });
        expect(calls).toEqual([{ x: 1 }, { x: 2 }]);
        unsub();
        Bus.emit('test_event', { x: 3 });
        expect(calls.length).toBe(2);
    });

    it('attach wraps game.logBehavior without modifying class', () => {
        const origCalls = [];
        const busCalls = [];
        const fakeGame = {
            logBehavior(type, data) { origCalls.push({ type, data }); }
        };
        Bus.on('clear', ({ data }) => busCalls.push(data));
        Bus.attach(fakeGame);

        fakeGame.logBehavior('clear', { linesCleared: 2 });

        expect(origCalls).toHaveLength(1);
        expect(busCalls).toHaveLength(1);
        expect(busCalls[0].linesCleared).toBe(2);
    });

    it('detach restores original logBehavior', () => {
        const fakeGame = {
            logBehavior(_type, _data) { }
        };
        const orig = fakeGame.logBehavior;
        Bus.attach(fakeGame);
        Bus.detach();
        expect(fakeGame.logBehavior).toBe(orig);
    });

    it('attach is idempotent (second attach is no-op)', () => {
        const fakeGame = { logBehavior: vi.fn() };
        Bus.attach(fakeGame);
        const wrapped1 = fakeGame.logBehavior;
        Bus.attach(fakeGame);
        expect(fakeGame.logBehavior).toBe(wrapped1);
    });

    it('getGame returns attached game', () => {
        const fakeGame = { logBehavior: vi.fn() };
        Bus.attach(fakeGame);
        expect(Bus.getGame()).toBe(fakeGame);
        Bus.detach();
        expect(Bus.getGame()).toBeNull();
    });
});

// ---------- dailyTasks ----------
import {
    getDailyTasksStatus,
    getDailyCompletedCount,
    TASK_DEFS,
    initDailyTasks,
} from '../web/src/monetization/dailyTasks.js';

describe('dailyTasks', () => {
    beforeEach(() => {
        clearLS();
        resetFlags();
        setFlag('dailyTasks', true);
        Bus._clearAllHandlers();
        Bus.detach();
    });
    afterEach(() => {
        Bus._clearAllHandlers();
        Bus.detach();
    });

    it('initial state: all tasks incomplete', () => {
        const tasks = getDailyTasksStatus();
        expect(tasks.length).toBe(TASK_DEFS.length);
        tasks.forEach((t) => {
            expect(t.completed).toBe(false);
            expect(t.progress).toBe(0);
        });
    });

    it('clear event increments clear_5 task', () => {
        const fakeGame = { logBehavior: vi.fn() };
        Bus.attach(fakeGame);
        initDailyTasks();

        for (let i = 0; i < 5; i++) {
            fakeGame.logBehavior('clear', { linesCleared: 1 });
        }

        const tasks = getDailyTasksStatus();
        const clearTask = tasks.find((t) => t.id === 'clear_5');
        expect(clearTask).toBeDefined();
        expect(clearTask.completed).toBe(true);
    });

    it('game_over event completes play_1 task', () => {
        const fakeGame = { logBehavior: vi.fn() };
        Bus.attach(fakeGame);
        initDailyTasks();

        fakeGame.logBehavior('game_over', { finalScore: 100 });

        const tasks = getDailyTasksStatus();
        const playTask = tasks.find((t) => t.id === 'play_1');
        expect(playTask.completed).toBe(true);
    });

    it('getDailyCompletedCount returns count', () => {
        const fakeGame = { logBehavior: vi.fn() };
        Bus.attach(fakeGame);
        initDailyTasks();

        fakeGame.logBehavior('game_over', {});
        expect(getDailyCompletedCount()).toBe(1);
    });
});

// ---------- iapAdapter ----------
import {
    PRODUCTS,
    isPurchased,
    getConsumableCount,
    consumeOne,
    getPurchasesSnapshot,
} from '../web/src/monetization/iapAdapter.js';

describe('iapAdapter', () => {
    beforeEach(() => {
        clearLS();
        resetFlags();
        setFlag('iap', true);
    });

    it('PRODUCTS catalog has required items', () => {
        expect(PRODUCTS.remove_ads).toBeDefined();
        expect(PRODUCTS.hint_pack_5).toBeDefined();
        expect(PRODUCTS.monthly_pass).toBeDefined();
    });

    it('isPurchased returns false initially', () => {
        expect(isPurchased('remove_ads')).toBe(false);
    });

    it('consumeOne returns false on empty consumable', () => {
        expect(consumeOne('hint_pack_5')).toBe(false);
    });

    it('getConsumableCount returns 0 initially', () => {
        expect(getConsumableCount('hint_pack_5')).toBe(0);
    });

    it('getPurchasesSnapshot is an object', () => {
        const snap = getPurchasesSnapshot();
        expect(typeof snap).toBe('object');
    });
});

// ---------- skinUnlock ----------
import {
    isSkinUnlocked,
    getUnlockStatus,
    SKIN_UNLOCK_RULES,
} from '../web/src/monetization/skinUnlock.js';

describe('skinUnlock', () => {
    beforeEach(() => {
        clearLS();
        resetFlags();
        setFlag('skinUnlock', true);
    });

    it('free skins are always unlocked', () => {
        expect(isSkinUnlocked('default')).toBe(true);
        expect(isSkinUnlocked('titanium')).toBe(true);
        expect(isSkinUnlocked('classic')).toBe(true);
    });

    it('level-gated skin locked at Lv.1', () => {
        expect(isSkinUnlocked('forest')).toBe(false);
    });

    it('all skins unlocked when feature disabled', () => {
        setFlag('skinUnlock', false);
        expect(isSkinUnlocked('neon')).toBe(true);
    });

    it('getUnlockStatus hint not empty for locked skin', () => {
        const status = getUnlockStatus('neon');
        expect(status.unlocked).toBe(false);
        expect(status.hint.length).toBeGreaterThan(0);
    });

    it('SKIN_UNLOCK_RULES covers expected skins', () => {
        expect(SKIN_UNLOCK_RULES.forest.type).toBe('level');
        expect(SKIN_UNLOCK_RULES.midnight.type).toBe('iap');
    });
});

// ---------- seasonPass ----------
import {
    getSeasonStatus,
    addSeasonXp,
    FREE_TIERS,
    PAID_TIERS,
} from '../web/src/monetization/seasonPass.js';

describe('seasonPass', () => {
    beforeEach(() => {
        clearLS();
        resetFlags();
        setFlag('seasonPass', true);
    });

    it('initial seasonXp is 0', () => {
        const { seasonXp } = getSeasonStatus();
        expect(seasonXp).toBe(0);
    });

    it('addSeasonXp accumulates', () => {
        addSeasonXp(100);
        addSeasonXp(50);
        const { seasonXp } = getSeasonStatus();
        expect(seasonXp).toBe(150);
    });

    it('FREE_TIERS reach flag updates on addSeasonXp', () => {
        addSeasonXp(FREE_TIERS[0].xp);
        const { freeTiers } = getSeasonStatus();
        expect(freeTiers[0].reached).toBe(true);
    });

    it('daysLeft is positive number', () => {
        const { daysLeft } = getSeasonStatus();
        expect(typeof daysLeft).toBe('number');
        expect(daysLeft).toBeGreaterThan(0);
    });

    it('FREE_TIERS and PAID_TIERS are non-empty arrays', () => {
        expect(FREE_TIERS.length).toBeGreaterThan(0);
        expect(PAID_TIERS.length).toBeGreaterThan(0);
    });
});

// ---------- adAdapter ----------
import { initAds, isAdsRemoved, setAdsRemoved } from '../web/src/monetization/adAdapter.js';

describe('adAdapter', () => {
    beforeEach(() => {
        clearLS();
        setAdsRemoved(false);
        resetFlags();
    });

    it('isAdsRemoved default false', () => {
        initAds();
        expect(isAdsRemoved()).toBe(false);
    });

    it('setAdsRemoved(true) sets in-memory flag', () => {
        setAdsRemoved(true);
        expect(isAdsRemoved()).toBe(true);
    });

    it('initAds restores flag from localStorage', () => {
        // beforeEach 已将 in-memory 重置为 false；直接写 localStorage '1' 再 initAds
        _mockLS.setItem('openblock_mon_ads_removed', '1');
        initAds();   // 从 localStorage 读 → 应为 true
        expect(isAdsRemoved()).toBe(true);
    });

    it('setAdsRemoved(false) clears flag', () => {
        setAdsRemoved(true);
        setAdsRemoved(false);
        expect(isAdsRemoved()).toBe(false);
    });
});

// ---------- leaderboard ----------
import { fetchDailyLeaderboard, submitScore } from '../web/src/monetization/leaderboard.js';

describe('leaderboard', () => {
    beforeEach(() => {
        clearLS();
        resetFlags();
        setFlag('leaderboard', true);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ entries: [{ user_id: 'u123', score: 500, strategy: 'normal' }] }),
        }));
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal('localStorage', _mockLS); // re-stub after unstubAllGlobals
    });

    it('fetchDailyLeaderboard returns array', async () => {
        const entries = await fetchDailyLeaderboard(5);
        expect(Array.isArray(entries)).toBe(true);
        expect(entries[0].score).toBe(500);
    });

    it('submitScore calls fetch POST', async () => {
        await submitScore('u_test', 300, 'normal');
        expect(fetch).toHaveBeenCalled();
        const [url, opts] = fetch.mock.calls[0];
        expect(url).toContain('/api/mon/leaderboard/submit');
        expect(opts.method).toBe('POST');
    });
});

// ---------- personalization ----------
import {
    fetchPersonaFromServer,
    updateRealtimeSignals,
    getCommercialInsight,
    buildCommercialWhyLines,
    getCurrentSegment,
    _getState,
    _resetState,
} from '../web/src/monetization/personalization.js';

describe('personalization', () => {
    beforeEach(() => {
        clearLS();
        _resetState();
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.stubGlobal('localStorage', _mockLS);
    });

    it('getCommercialInsight returns default minnow segment', () => {
        const ins = getCommercialInsight();
        expect(ins.segment).toBe('minnow');
        expect(Array.isArray(ins.signals)).toBe(true);
        expect(Array.isArray(ins.actions)).toBe(true);
    });

    it('getCurrentSegment default is minnow', () => {
        expect(getCurrentSegment()).toBe('minnow');
    });

    it('updateRealtimeSignals updates signals in insight', () => {
        const fakeProfile = {
            frustrationLevel: 7,
            skillLevel: 0.6,
            flowState: 'flow',
            hadRecentNearMiss: true,
            sessionPhase: 'peak',
            momentum: 0.5,
        };
        updateRealtimeSignals(fakeProfile);
        const ins = getCommercialInsight();
        const frustSig = ins.signals.find(s => s.key === 'frustration');
        expect(frustSig).toBeDefined();
        expect(frustSig.value).toBe('较高'); // frustration=7 → 较高
    });

    it('fetchPersonaFromServer updates state from server response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                segment: 'whale',
                whale_score: 0.75,
                activity_score: 0.8,
                skill_score: 0.7,
                frustration_avg: 0.1,
                near_miss_rate: 0.2,
                strategy: { actions: [{ type: 'iap', product: 'monthly_pass', priority: 'high' }], explain: 'Whale用户' },
            }),
        }));
        await fetchPersonaFromServer('u_test');
        expect(getCurrentSegment()).toBe('whale');
        const ins = getCommercialInsight();
        expect(ins.segmentIcon).toBe('🐋');
    });

    it('fetchPersonaFromServer gracefully handles network failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
        await expect(fetchPersonaFromServer('u_test')).resolves.toBeUndefined();
        // 依然保持默认 minnow（未被覆盖）
        expect(getCurrentSegment()).toBe('minnow');
    });

    it('signal nearMiss active flag correct', () => {
        const fakeProfile = {
            frustrationLevel: 2,
            skillLevel: 0.5,
            flowState: 'anxious',
            hadRecentNearMiss: true,
            sessionPhase: 'peak',
            momentum: 0.4,
        };
        updateRealtimeSignals(fakeProfile);
        const ins = getCommercialInsight();
        const nmSig = ins.signals.find(s => s.key === 'nearMiss');
        expect(nmSig.sub).toContain('触发近失');
    });

    it('getCommercialInsight returns whyLines array', () => {
        const ins = getCommercialInsight();
        expect(Array.isArray(ins.whyLines)).toBe(true);
        // 默认状态应包含分群说明
        expect(ins.whyLines.some(l => l.includes('分群'))).toBe(true);
    });

    it('action cards have why and effect fields', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                segment: 'dolphin',
                whale_score: 0.45,
                activity_score: 0.5,
                skill_score: 0.6,
                frustration_avg: 0.1,
                near_miss_rate: 0.35,
                strategy: {
                    actions: [
                        { type: 'iap', product: 'weekly_pass', priority: 'medium' },
                        { type: 'ads', format: 'rewarded', trigger: 'near_miss', priority: 'high' },
                    ],
                    explain: 'Dolphin 策略',
                },
            }),
        }));
        await fetchPersonaFromServer('u_dolphin', true);
        const ins = getCommercialInsight();
        const iapCard = ins.actions.find(a => a.product === '周卡通行证');
        expect(iapCard).toBeDefined();
        expect(typeof iapCard.why).toBe('string');
        expect(iapCard.why.length).toBeGreaterThan(0);
        expect(typeof iapCard.effect).toBe('string');
        expect(iapCard.effect.length).toBeGreaterThan(0);
    });

    it('whyLines includes near-miss bullet when hadNearMiss=true', () => {
        updateRealtimeSignals({
            frustrationLevel: 1,
            skillLevel: 0.5,
            flowState: 'bored',
            hadRecentNearMiss: true,
            sessionPhase: 'peak',
            momentum: 0.3,
        });
        const state = _getState();
        const lines = buildCommercialWhyLines(state);
        expect(lines.some(l => l.includes('近失'))).toBe(true);
    });

    it('whyLines includes frustration bullet when frustration >= 5', () => {
        updateRealtimeSignals({
            frustrationLevel: 6,
            skillLevel: 0.4,
            flowState: 'anxious',
            hadRecentNearMiss: false,
            sessionPhase: 'peak',
            momentum: 0.2,
        });
        const state = _getState();
        const lines = buildCommercialWhyLines(state);
        expect(lines.some(l => l.includes('未消行') || l.includes('救济'))).toBe(true);
    });

    it('whyLines includes flow suppression note when in flow state', () => {
        updateRealtimeSignals({
            frustrationLevel: 0,
            skillLevel: 0.7,
            flowState: 'flow',
            hadRecentNearMiss: false,
            sessionPhase: 'peak',
            momentum: 0.5,
        });
        const state = _getState();
        const lines = buildCommercialWhyLines(state);
        expect(lines.some(l => l.includes('心流中'))).toBe(true);
    });
});
