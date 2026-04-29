/**
 * @vitest-environment jsdom
 *
 * Wallet 单元测试 — 覆盖通货增减、每日免费配额、试穿券、事件总线
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

function freshWallet() {
    _mockLS.clear();
    const w = getWallet();
    w._reset();
    return w;
}

describe('Wallet — 默认状态', () => {
    let w;
    beforeEach(() => { w = freshWallet(); });

    it('初始库存全部为 0', () => {
        expect(w.getStock('hintToken')).toBe(0);
        expect(w.getStock('undoToken')).toBe(0);
        expect(w.getStock('bombToken')).toBe(0);
        expect(w.getStock('rainbowToken')).toBe(0);
        expect(w.getStock('coin')).toBe(0);
        expect(w.getStock('trialPass')).toBe(0);
    });

    it('hint / undo 当日免费各 3 次', () => {
        expect(w.getDailyFreeRemaining('hintToken')).toBe(3);
        expect(w.getDailyFreeRemaining('undoToken')).toBe(3);
        expect(w.getDailyFreeRemaining('bombToken')).toBe(0);
        expect(w.getDailyFreeRemaining('rainbowToken')).toBe(0);
    });

    it('getBalance 等于库存 + 免费配额', () => {
        expect(w.getBalance('hintToken')).toBe(3);
        expect(w.getBalance('bombToken')).toBe(0);
    });

    it('未识别 kind 返回 0 / false', () => {
        expect(w.getBalance('xxxToken')).toBe(0);
        expect(w.spend('xxxToken', 1, 't')).toBe(false);
        expect(w.addBalance('xxxToken', 5, 't')).toBe(false);
    });
});

describe('Wallet — addBalance / spend', () => {
    let w;
    beforeEach(() => { w = freshWallet(); });

    it('addBalance 累加库存', () => {
        w.addBalance('bombToken', 3, 'test');
        expect(w.getStock('bombToken')).toBe(3);
        w.addBalance('bombToken', 2, 'test');
        expect(w.getStock('bombToken')).toBe(5);
    });

    it('addBalance 拒绝负数 / 零', () => {
        w.addBalance('bombToken', 3);
        expect(w.addBalance('bombToken', 0)).toBe(false);
        expect(w.getStock('bombToken')).toBe(3);
    });

    it('spend 优先使用每日免费配额，再用库存', () => {
        w.addBalance('hintToken', 5, 'test');
        // 现在 free=3, stock=5, total=8
        expect(w.spend('hintToken', 2, 't')).toBe(true);
        // 用了 2 次免费，stock 不变
        expect(w.getStock('hintToken')).toBe(5);
        expect(w.getDailyFreeRemaining('hintToken')).toBe(1);
        // 再花 3：1 次免费 + 2 次库存
        expect(w.spend('hintToken', 3, 't')).toBe(true);
        expect(w.getStock('hintToken')).toBe(3);
        expect(w.getDailyFreeRemaining('hintToken')).toBe(0);
    });

    it('spend 库存为 0 + 无免费时返回 false', () => {
        expect(w.spend('bombToken', 1, 't')).toBe(false);
        expect(w.getStock('bombToken')).toBe(0);
    });

    it('spend 余额不足时整笔失败（不部分扣）', () => {
        w.addBalance('bombToken', 1);
        expect(w.spend('bombToken', 5, 't')).toBe(false);
        expect(w.getStock('bombToken')).toBe(1);   // 没动
    });

    it('spend amount <= 0 拒绝', () => {
        w.addBalance('bombToken', 5);
        expect(w.spend('bombToken', 0, 't')).toBe(false);
        expect(w.spend('bombToken', -1, 't')).toBe(false);
    });
});

describe('Wallet — 跨日免费配额重置', () => {
    let w;
    beforeEach(() => { w = freshWallet(); });
    afterEach(() => { vi.useRealTimers(); });

    it('当日 spend 计入 dailyConsumed，次日重置', () => {
        const day1 = new Date('2026-04-29T10:00:00');
        vi.useFakeTimers();
        vi.setSystemTime(day1);

        w.spend('hintToken', 3, 't');
        expect(w.getDailyFreeRemaining('hintToken')).toBe(0);

        const day2 = new Date('2026-04-30T08:00:00');
        vi.setSystemTime(day2);
        expect(w.getDailyFreeRemaining('hintToken')).toBe(3);
    });
});

describe('Wallet — 试穿券', () => {
    let w;
    beforeEach(() => { w = freshWallet(); });
    afterEach(() => { vi.useRealTimers(); });

    it('addTrial 写入券 + isOnTrial 命中', () => {
        w.addTrial('og_geometry', 24);
        expect(w.isOnTrial('og_geometry')).toBe(true);
        expect(w.isOnTrial('other')).toBe(false);
    });

    it('过期试穿券自动清理', () => {
        const t0 = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(new Date(t0));
        w.addTrial('og_geometry', 1);
        expect(w.isOnTrial('og_geometry')).toBe(true);

        vi.setSystemTime(new Date(t0 + 2 * 3600_000));
        expect(w.isOnTrial('og_geometry')).toBe(false);
        expect(w.getActiveTrials()).toHaveLength(0);
    });
});

describe('Wallet — onChange 事件总线', () => {
    let w;
    beforeEach(() => { w = freshWallet(); });

    it('onChange 监听 add / spend', () => {
        const events = [];
        const off = w.onChange('bombToken', (d) => events.push(d));
        w.addBalance('bombToken', 3, 'test-add');
        w.spend('bombToken', 1, 'test-spend');
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({ kind: 'bombToken', action: 'add', amount: 3 });
        expect(events[1]).toMatchObject({ kind: 'bombToken', action: 'spend', amount: 1 });
        off();
        w.addBalance('bombToken', 1);
        expect(events).toHaveLength(2);   // off 后不再触发
    });

    it('* 通配监听所有 kind', () => {
        const events = [];
        w.onChange('*', (d) => events.push(d.kind));
        w.addBalance('bombToken', 1);
        w.addBalance('rainbowToken', 1);
        w.spend('hintToken', 1, 't');
        expect(events).toContain('bombToken');
        expect(events).toContain('rainbowToken');
        expect(events).toContain('hintToken');
    });
});
