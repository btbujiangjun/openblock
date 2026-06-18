import { beforeEach, describe, expect, it, vi } from 'vitest';

const _store = {};
vi.stubGlobal('localStorage', {
    getItem: (k) => _store[k] ?? null,
    setItem: (k, v) => { _store[k] = String(v); },
    removeItem: (k) => { delete _store[k]; },
});

const {
    isWebPremiumClient,
    isSkinPremiumEnabled,
    applyPremiumSkinVars,
    initSkinPremium,
    setSkinPremiumEnabled,
    __resetPremiumForTest,
} = await import('../web/src/effects/skinPremium.js');

function _mountToggle() {
    const btn = document.createElement('button');
    btn.id = 'skin-premium-toggle';
    btn.setAttribute('aria-pressed', 'false');
    document.body.appendChild(btn);
    return btn;
}

beforeEach(() => {
    __resetPremiumForTest();
    document.body.innerHTML = '';
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-ui-theme');
    document.body.dataset.quality = '';
    for (const k of [
        '--premium-accent',
        '--premium-board-border',
        '--premium-board-glow',
        '--premium-glass-surface',
        '--premium-glass-border',
    ]) {
        document.documentElement.style.removeProperty(k);
    }
});

describe('skinPremium web-only gating', () => {
    it('浏览器 Web 主端可启用', () => {
        expect(isWebPremiumClient()).toBe(true);
    });

    it('原生壳不启用', () => {
        document.documentElement.classList.add('native-client');
        expect(isWebPremiumClient()).toBe(false);
    });

    it('默认关闭，不挂载 premium 类', () => {
        initSkinPremium();
        expect(document.documentElement.classList.contains('web-premium-skin')).toBe(false);
        expect(isSkinPremiumEnabled()).toBe(false);
    });

    it('setSkinPremiumEnabled(true) 挂载 premium 类', () => {
        setSkinPremiumEnabled(true, { persist: false });
        expect(document.documentElement.classList.contains('web-premium-skin')).toBe(true);
        expect(isSkinPremiumEnabled()).toBe(true);
    });

    it('setSkinPremiumEnabled(false) 移除 premium 类与 CSS 变量', () => {
        setSkinPremiumEnabled(true, { persist: false });
        setSkinPremiumEnabled(false, { persist: false });
        expect(document.documentElement.classList.contains('web-premium-skin')).toBe(false);
        expect(isSkinPremiumEnabled()).toBe(false);
        expect(document.documentElement.style.getPropertyValue('--premium-accent').trim()).toBe('');
    });

    it('quality-low 关闭 premium 渲染细节', () => {
        setSkinPremiumEnabled(true, { persist: false });
        document.documentElement.classList.add('quality-low');
        expect(isSkinPremiumEnabled()).toBe(false);
    });
});

describe('initSkinPremium toggle sync', () => {
    it('从 localStorage 恢复开启态并同步按钮', () => {
        localStorage.setItem('openblock_skin_premium_v1', JSON.stringify({ enabled: true }));
        const btn = _mountToggle();
        initSkinPremium();
        expect(isSkinPremiumEnabled()).toBe(true);
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        expect(btn.textContent).toBe('💎');
    });

    it('点击按钮切换开关并持久化', () => {
        const btn = _mountToggle();
        initSkinPremium();
        expect(isSkinPremiumEnabled()).toBe(false);

        btn.click();
        expect(isSkinPremiumEnabled()).toBe(true);
        expect(JSON.parse(localStorage.getItem('openblock_skin_premium_v1')).enabled).toBe(true);

        btn.click();
        expect(isSkinPremiumEnabled()).toBe(false);
        expect(JSON.parse(localStorage.getItem('openblock_skin_premium_v1')).enabled).toBe(false);
    });
});

describe('applyPremiumSkinVars', () => {
    it('从皮肤 accent 推导 premium CSS 变量', () => {
        applyPremiumSkinVars({
            id: 'test',
            uiDark: true,
            cssVars: { '--accent-color': '#f97316' },
            gridOuter: '#111',
            gridCell: '#222',
            blockColors: [],
            gridGap: 1,
            blockInset: 2,
            blockRadius: 5,
            blockStyle: 'cartoon',
            clearFlash: '#fff',
        });
        expect(document.documentElement.style.getPropertyValue('--premium-accent').trim()).toBe('#f97316');
        expect(document.documentElement.style.getPropertyValue('--premium-board-border')).toContain('rgba');
    });
});
