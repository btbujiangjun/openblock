import { describe, it, expect, beforeEach, vi } from 'vitest';

/* 部分环境带无效 --localstorage-file，全局 localStorage 无可用方法；用内存实现覆盖。 */
const { mockLS } = vi.hoisted(() => {
    const store = Object.create(null);
    return {
        mockLS: {
            getItem: (k) => (k in store ? store[k] : null),
            setItem: (k, v) => { store[k] = String(v); },
            removeItem: (k) => { delete store[k]; },
            clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        },
    };
});
vi.stubGlobal('localStorage', mockLS);

import { getLifetimeSpend, getPurchaseCount } from '../web/src/monetization/iapAdapter.js';
import { getCurrentTier } from '../web/src/retention/vipSystem.js';

const LEDGER_KEY = 'openblock_mon_spend_v1';

describe('MO-4 累计付费账本（lifetimeSpend SSOT）', () => {
    beforeEach(() => {
        localStorage.removeItem(LEDGER_KEY);
    });

    it('空账本时返回 0', () => {
        expect(getLifetimeSpend()).toBe(0);
        expect(getPurchaseCount()).toBe(0);
    });

    it('读取 minor 单位账本并换算为元', () => {
        localStorage.setItem(LEDGER_KEY, JSON.stringify({ totalMinor: 23800, count: 3 }));
        expect(getLifetimeSpend()).toBeCloseTo(238, 2);
        expect(getPurchaseCount()).toBe(3);
    });

    it('iapAdapter 与 vipSystem 共用同一账本 key（跨模块契约）', () => {
        localStorage.setItem(LEDGER_KEY, JSON.stringify({ totalMinor: 6000, count: 1 })); // ¥60
        expect(getLifetimeSpend()).toBeCloseTo(60, 2);
        // 60 元 → 价值 tier T3（≥50）
        expect(getCurrentTier().id).toBe('T3');
    });
});
