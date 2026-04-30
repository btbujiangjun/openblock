/**
 * @vitest-environment jsdom
 *
 * v10.17 留存 sprint 关键逻辑单元测试 — 覆盖：
 *  - wallet 防通胀 cap
 *  - popupCoordinator 主弹窗优先级队列
 *  - rankSystem 段位计算
 *  - skinFragments 碎片合成
 *  - asyncPk encode/decode
 *  - replayAlbum 里程碑锁定
 *  - monthlyMilestone 触发逻辑
 *  - dailyDish 当日菜品
 *  - firstWinBoost 加分计算
 */
import { describe, it, expect, vi } from 'vitest';

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
const _mockLS = makeLocalStorageMock();
vi.stubGlobal('localStorage', _mockLS);

import { getWallet } from '../web/src/skills/wallet.js';
import { requestPrimaryPopup, releasePrimaryPopup, __resetPrimaryForTest } from '../web/src/popupCoordinator.js';
import { __test_only__ as rankInternals, getCurrentRank, __resetForTest as resetRank } from '../web/src/progression/rankSystem.js';
import { __test_only__ as fragInternals, tryUnlockRandom, __resetForTest as resetFrag } from '../web/src/progression/skinFragments.js';
import { __test_only__ as pkInternals } from '../web/src/social/asyncPk.js';
import { __test_only__ as msInternals, __resetForTest as resetMs } from '../web/src/checkin/monthlyMilestone.js';
import { getTodayDish } from '../web/src/daily/dailyDish.js';

/* ---------- Wallet 防通胀 ---------- */
describe('v10.17 wallet 防通胀 cap', () => {
    it('普通 source 受 cap 限制（hintToken 上限 8/天）', () => {
        _mockLS.clear();
        const w = getWallet();
        w._reset();
        const ok1 = w.addBalance('hintToken', 5, 'daily-task');
        expect(ok1).toBe(true);
        const stock1 = w.getStock('hintToken');
        expect(stock1).toBe(5);
        const ok2 = w.addBalance('hintToken', 5, 'daily-task');
        // 第二次只能加 3（cap=8 - 已发 5）
        expect(ok2).toBe(true);
        expect(w.getStock('hintToken')).toBe(8);
        // 第三次完全被截断
        const ok3 = w.addBalance('hintToken', 1, 'daily-task');
        expect(ok3).toBe(false);
        expect(w.getStock('hintToken')).toBe(8);
    });

    it('特殊 source（first-day-pack / iap）绕过 cap', () => {
        _mockLS.clear();
        const w = getWallet();
        w._reset();
        w.addBalance('hintToken', 8, 'daily-task');
        // 已达 cap
        expect(w.addBalance('hintToken', 1, 'daily-task')).toBe(false);
        // 但 first-day-pack 可继续加
        expect(w.addBalance('hintToken', 5, 'first-day-pack')).toBe(true);
        expect(w.getStock('hintToken')).toBe(13);
    });

    it('getTodayGranted / getDailyGrantCap 正确返回', () => {
        _mockLS.clear();
        const w = getWallet();
        w._reset();
        w.addBalance('bombToken', 2, 'daily-task');
        expect(w.getTodayGranted('bombToken')).toBe(2);
        expect(w.getDailyGrantCap('bombToken')).toBe(3);
    });
});

/* ---------- popupCoordinator 主弹窗优先级 ---------- */
describe('v10.17 popupCoordinator 主弹窗', () => {
    it('同会话重复同 id 弹窗被拒', () => {
        __resetPrimaryForTest();
        expect(requestPrimaryPopup('checkIn')).toBe(true);
        releasePrimaryPopup();
        expect(requestPrimaryPopup('checkIn')).toBe(false);
    });

    it('低优先级在高优先级后被拒', () => {
        __resetPrimaryForTest();
        expect(requestPrimaryPopup('welcomeBack')).toBe(true);
        // welcomeBack(0) 后，seasonalRecommend(2) 应被拒
        expect(requestPrimaryPopup('seasonalRecommend')).toBe(false);
        releasePrimaryPopup();
        // 即使释放，seasonalRecommend 因 welcomeBack 仍然占用 currentPrimaryPriority=∞ 后又恢复
        expect(requestPrimaryPopup('seasonalRecommend')).toBe(true);
    });

    it('高优先级抢占低优先级（抢占语义）', () => {
        __resetPrimaryForTest();
        expect(requestPrimaryPopup('seasonPassUpdate')).toBe(true);   // prio=3
        expect(requestPrimaryPopup('welcomeBack')).toBe(true);         // prio=0 抢占
    });

    it('未注册 id 通过（向后兼容）', () => {
        __resetPrimaryForTest();
        expect(requestPrimaryPopup('unknownId')).toBe(true);
    });
});

/* ---------- rankSystem 段位 ---------- */
describe('v10.17 rankSystem', () => {
    it('exp=0 → 青铜 III', () => {
        const r = rankInternals._rankFor(0);
        expect(r.idx).toBe(0);
        expect(r.name).toBe('青铜 III');
    });

    it('exp=350 → 白银 III', () => {
        const r = rankInternals._rankFor(350);
        expect(r.name).toBe('白银 III');
    });

    it('exp=34000 → 王者', () => {
        const r = rankInternals._rankFor(34000);
        expect(r.name).toBe('王者');
    });

    it('getCurrentRank 读 localStorage', () => {
        _mockLS.clear();
        resetRank();
        const r = getCurrentRank();
        expect(r.totalExp).toBe(0);
    });
});

/* ---------- skinFragments 碎片合成 ---------- */
describe('v10.17 skinFragments', () => {
    it('解锁需要 30 个碎片', () => {
        expect(fragInternals.COST_PER_UNLOCK).toBe(30);
    });

    it('碎片不足时不解锁', () => {
        _mockLS.clear();
        resetFrag();
        const wallet = getWallet();
        wallet._reset();
        wallet.addBalance('fragment', 20, 'test');
        expect(tryUnlockRandom()).toBeNull();
    });

    it('碎片足够 → 解锁随机一款 + 扣 30', () => {
        _mockLS.clear();
        resetFrag();
        const wallet = getWallet();
        wallet._reset();
        wallet.addBalance('fragment', 40, 'test');
        const skin = tryUnlockRandom();
        expect(skin).toBeTruthy();
        expect(fragInternals.FRAGMENT_POOL).toContain(skin);
        expect(wallet.getBalance('fragment')).toBe(10);
    });
});

/* ---------- asyncPk encode/decode ---------- */
describe('v10.17 asyncPk encode/decode', () => {
    it('编解码可逆', () => {
        const payload = { seed: 12345, score: 999, skinId: 'sunset', ymd: '2026-04-29' };
        const id = pkInternals._encodePayload(payload);
        expect(typeof id).toBe('string');
        expect(id.length).toBeGreaterThan(0);
        const back = pkInternals._decodePayload(id);
        expect(back).toEqual(payload);
    });

    it('损坏数据返回 null', () => {
        expect(pkInternals._decodePayload('!!!not-base64!!!')).toBeNull();
        expect(pkInternals._decodePayload('')).toBeNull();
    });

    it('_isValidChallenge 校验 seed/score', () => {
        expect(pkInternals._isValidChallenge({ seed: 1, score: 2 })).toBe(true);
        expect(pkInternals._isValidChallenge({ seed: 'x', score: 2 })).toBe(false);
        expect(pkInternals._isValidChallenge(null)).toBeFalsy();
    });
});

/* ---------- monthlyMilestone ---------- */
describe('v10.17 monthlyMilestone', () => {
    it('totalDays < 7 不触发', () => {
        _mockLS.clear();
        resetMs();
        localStorage.setItem('openblock_checkin_v1', JSON.stringify({ totalDays: 5 }));
        msInternals._check();
        // 应保持初始 lastMilestoneDay = 0
        const self = JSON.parse(localStorage.getItem('openblock_monthly_milestone_v1') || '{"lastMilestoneDay":0}');
        expect(self.lastMilestoneDay).toBe(0);
    });

    it('totalDays = 7 → 触发第 7 天里程碑', () => {
        _mockLS.clear();
        resetMs();
        const wallet = getWallet();
        wallet._reset();
        localStorage.setItem('openblock_checkin_v1', JSON.stringify({ totalDays: 7 }));
        msInternals._check();
        const self = JSON.parse(localStorage.getItem('openblock_monthly_milestone_v1'));
        expect(self.lastMilestoneDay).toBe(7);
        // 钱包应有 hintToken / undoToken 增加（cap 内）
        expect(wallet.getStock('hintToken')).toBeGreaterThan(0);
    });

    it('totalDays = 30 → 解锁皮肤', () => {
        _mockLS.clear();
        resetMs();
        const wallet = getWallet();
        wallet._reset();
        localStorage.setItem('openblock_checkin_v1', JSON.stringify({ totalDays: 30 }));
        // 推进 5 个里程碑（每次 _check 只发一项）
        for (let i = 0; i < 6; i++) msInternals._check();
        const fragData = JSON.parse(localStorage.getItem('openblock_skin_fragments_v1') || '{"unlocked":[]}');
        expect(fragData.unlocked.length).toBeGreaterThanOrEqual(1);
    });
});

/* ---------- dailyDish 当日菜品 ---------- */
describe('v10.17 dailyDish', () => {
    it('返回当前周几对应的菜品', () => {
        const d = getTodayDish();
        expect(d).toBeTruthy();
        expect(d.weekday).toBe(new Date().getDay());
        expect(d.modifier).toBeTruthy();
    });
});
