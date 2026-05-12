/**
 * @vitest-environment jsdom
 *
 * skillBar 单测：
 *   - 渲染按钮 + 计数徽章
 *   - 入账（addBalance）触发 .badge-pop-up + .badge-float-plus
 *   - 消耗（spend）触发 .badge-pop-down 且不弹 +N
 *   - hydrate（_replaceWithHydratedState）只刷新数字，无 +N 浮字
 *   - 首次注册（已有存量道具）不应弹 +N，避免开局齐喷
 *   - _toneFromDetail 单元判定
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
import { registerSkill, refreshSkillBar, __test_only__ as bar__ } from '../web/src/skills/skillBar.js';

const { _toneFromDetail, REGISTRY } = bar__;

function _setupDom() {
    document.body.innerHTML = `
        <div id="skill-bar">
            <button id="insight-hint"></button>
        </div>
    `;
}

function _resetWalletAndRegistry() {
    _mockLS.clear();
    const wallet = getWallet();
    wallet._reset();
    // wallet._reset 不清监听器，跨用例残留会让旧 skill 的 callback 跑在新用例上下文
    wallet._listeners = {};
    REGISTRY.clear();
    return wallet;
}

describe('skillBar — _toneFromDetail', () => {
    it('add + amount>0 → gain；add + cappedFrom → none', () => {
        expect(_toneFromDetail({ action: 'add', amount: 3 })).toBe('gain');
        expect(_toneFromDetail({ action: 'add', amount: 0, cappedFrom: 5 })).toBe('none');
    });

    it('spend → drain；hydrate → none；空入参 → none', () => {
        expect(_toneFromDetail({ action: 'spend', amount: 1 })).toBe('drain');
        expect(_toneFromDetail({ action: 'hydrate' })).toBe('none');
        expect(_toneFromDetail(null)).toBe('none');
        expect(_toneFromDetail({})).toBe('none');
    });
});

describe('skillBar — 数字变化动效集成', () => {
    beforeEach(() => {
        // 上一个用例飘起来的 .badge-float-plus 默认 950ms 后才 remove；
        // 测试间显式清理，避免污染下一个用例的 querySelector
        document.querySelectorAll('.badge-float-plus').forEach((n) => n.remove());
        _setupDom();
        _resetWalletAndRegistry();
    });

    it('首次注册按钮：即便钱包已有 5 个 token，也不应弹 +N（避免开局齐喷）', () => {
        // 用 bombToken：无 daily free quota，UI 显示等于 stock
        const wallet = getWallet();
        wallet.addBalance('bombToken', 3, 'chest-rare'); // bypass cap
        registerSkill({
            id: 'bomb-init-test',
            icon: '💣',
            kind: 'bombToken',
            onClick: () => {},
        });
        const btn = document.querySelector('[data-skill-id="bomb-init-test"]');
        expect(btn).not.toBeNull();
        const count = btn.querySelector('.skill-btn__count');
        expect(count.hidden).toBe(false);
        expect(count.textContent).toBe('3');
        // 初次渲染不应飘 +3
        expect(document.querySelector('.badge-float-plus')).toBeNull();
        expect(count.classList.contains('badge-pop-up')).toBe(false);
    });

    it('运行中入账（宝箱奖励）：触发 badge-pop-up + +N 浮字', () => {
        const wallet = getWallet();
        registerSkill({
            id: 'bomb-gain-test',
            icon: '💣',
            kind: 'bombToken',
            onClick: () => {},
        });
        // 初始 0 → 隐藏
        const count = document.querySelector('[data-skill-id="bomb-gain-test"] .skill-btn__count');
        expect(count.hidden).toBe(true);

        wallet.addBalance('bombToken', 3, 'chest-rare'); // bypass cap
        expect(count.hidden).toBe(false);
        expect(count.classList.contains('badge-pop-up')).toBe(true);
        const float = document.querySelector('.badge-float-plus');
        expect(float).not.toBeNull();
        expect(float.textContent).toBe('+3');
    });

    it('消耗（spend）触发 badge-pop-down，且不弹 +N', () => {
        const wallet = getWallet();
        wallet.addBalance('bombToken', 2, 'admin');
        registerSkill({
            id: 'bomb-test',
            icon: '💣',
            kind: 'bombToken',
            onClick: () => {},
        });
        const count = document.querySelector('[data-skill-id="bomb-test"] .skill-btn__count');
        expect(count.textContent).toBe('2');

        wallet.spend('bombToken', 1, 'use-bomb');
        expect(count.classList.contains('badge-pop-down')).toBe(true);
        expect(document.querySelector('.badge-float-plus')).toBeNull();
    });

    it('addBalance 被每日 cap 完全截断（amount=0）：不应弹 +N（tone=none）', () => {
        const wallet = getWallet();
        // bombToken 每日 cap=3；通过非 bypass 来源连发 4 次，最后一次会被截断为 0
        wallet.addBalance('bombToken', 3, 'task-reward'); // ok
        registerSkill({
            id: 'bomb-cap-test',
            icon: '💣',
            kind: 'bombToken',
            onClick: () => {},
        });
        // 清掉初始渲染时可能附加的 class
        const count = document.querySelector('[data-skill-id="bomb-cap-test"] .skill-btn__count');
        count.classList.remove('badge-pop-up', 'badge-pop-down');
        document.querySelectorAll('.badge-float-plus').forEach(n => n.remove());

        // 第二次入账 — 已经 3/3，会被完全截断
        const ok = wallet.addBalance('bombToken', 1, 'task-reward');
        expect(ok).toBe(false);
        // 文本未变（仍是 3），且无 +N 飘字
        expect(count.textContent).toBe('3');
        expect(document.querySelector('.badge-float-plus')).toBeNull();
    });

    it('refreshSkillBar 不会误触发 +N（detail 缺省 → tone=none）', () => {
        const wallet = getWallet();
        wallet.addBalance('rainbowToken', 4, 'admin');
        registerSkill({
            id: 'rainbow-test',
            icon: '🌈',
            kind: 'rainbowToken',
            onClick: () => {},
        });
        document.querySelectorAll('.badge-float-plus').forEach(n => n.remove());

        refreshSkillBar();
        expect(document.querySelector('.badge-float-plus')).toBeNull();
    });
});
