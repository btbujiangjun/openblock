/**
 * tests/badgeAnimator.test.js
 *
 * 校验通用徽章动效：
 *   1) 解析 DOM 旧值（含 99+ 截断）
 *   2) tone 自动判断 gain / drain / none
 *   3) 入账增量触发 +N 浮字 + pop-up class
 *   4) 消耗触发 pop-down class，无 +N 浮字
 *   5) hydrate / 等值变化不弹动效
 *   6) 立即落值 setBadgeImmediate 不依赖 RAF
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
    animateBadgeChange,
    setBadgeImmediate,
    __test_only__,
} from '../web/src/effects/badgeAnimator.js';

const { _readDomValue, _defaultFormatter, _resolveTone } = __test_only__;

function _newBadge(initialText = '') {
    const el = document.createElement('span');
    el.className = 'skill-btn__count';
    el.textContent = initialText;
    document.body.appendChild(el);
    return el;
}

describe('badgeAnimator — 内部辅助', () => {
    it('_readDomValue 兼容空 / 数字 / 99+', () => {
        const a = _newBadge('');
        const b = _newBadge('42');
        const c = _newBadge('99+');
        const d = _newBadge('  7  ');
        expect(_readDomValue(a)).toBe(0);
        expect(_readDomValue(b)).toBe(42);
        expect(_readDomValue(c)).toBe(99);
        expect(_readDomValue(d)).toBe(7);
    });

    it('_defaultFormatter 在 >99 时截断为 99+', () => {
        expect(_defaultFormatter(0)).toBe('0');
        expect(_defaultFormatter(99)).toBe('99');
        expect(_defaultFormatter(100)).toBe('99+');
        expect(_defaultFormatter(1234)).toBe('99+');
    });

    it('_resolveTone 默认按方向自动选择，可被 options.tone 强制', () => {
        expect(_resolveTone(0, 5, 'auto')).toBe('gain');
        expect(_resolveTone(5, 2, 'auto')).toBe('drain');
        expect(_resolveTone(5, 5, 'auto')).toBe('none');
        expect(_resolveTone(0, 5, 'drain')).toBe('drain');
        expect(_resolveTone(5, 2, 'gain')).toBe('gain');
    });
});

describe('badgeAnimator — 动效行为', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.useRealTimers();
    });

    it('入账增益：添加 badge-pop-up class 与 .badge-float-plus 浮字', async () => {
        const el = _newBadge('3');
        const handle = animateBadgeChange(el, 8, { tone: 'gain' });
        expect(el.classList.contains('badge-pop-up')).toBe(true);
        const float = document.querySelector('.badge-float-plus');
        expect(float).not.toBeNull();
        expect(float.textContent).toBe('+5');
        // 让动画快进结束
        handle?.cancel();
        expect(el.textContent).toBe('8');
    });

    it('消耗减益：添加 badge-pop-down class，不弹 +N 浮字', () => {
        const el = _newBadge('5');
        const handle = animateBadgeChange(el, 2, { tone: 'drain' });
        expect(el.classList.contains('badge-pop-down')).toBe(true);
        expect(document.querySelector('.badge-float-plus')).toBeNull();
        handle?.cancel();
        expect(el.textContent).toBe('2');
    });

    it('等值（hydrate / 重复刷新）：不附 class、不弹浮字、文本即落', () => {
        const el = _newBadge('7');
        const handle = animateBadgeChange(el, 7, { tone: 'gain', floatPlus: true });
        expect(handle).toBeNull();
        expect(el.classList.contains('badge-pop-up')).toBe(false);
        expect(document.querySelector('.badge-float-plus')).toBeNull();
        expect(el.textContent).toBe('7');
    });

    it('floatPlus:false 显式抑制：增益时也不弹 +N（用于初始化 / hydrate）', () => {
        const el = _newBadge('0');
        const handle = animateBadgeChange(el, 12, { tone: 'gain', floatPlus: false });
        expect(document.querySelector('.badge-float-plus')).toBeNull();
        // 仍然加 pulse 强调可视刷新
        expect(el.classList.contains('badge-pop-up')).toBe(true);
        handle?.cancel();
    });

    it('count-up 动画 handle.cancel() 立刻把文本落到目标值', () => {
        const el = _newBadge('0');
        const handle = animateBadgeChange(el, 9, { tone: 'gain', duration: 5000 });
        expect(handle).not.toBeNull();
        handle.cancel();
        expect(el.textContent).toBe('9');
    });

    it('setBadgeImmediate 立即落值并清掉进行中的动画', () => {
        const el = _newBadge('0');
        animateBadgeChange(el, 50, { tone: 'gain', duration: 5000 });
        setBadgeImmediate(el, 99);
        expect(el.textContent).toBe('99');
        setBadgeImmediate(el, 200);
        expect(el.textContent).toBe('99+');
    });

    it('null 元素 / 非数值入参：不抛错，温柔处理', () => {
        expect(() => animateBadgeChange(null, 5)).not.toThrow();
        const el = _newBadge('3');
        expect(() => animateBadgeChange(el, NaN)).not.toThrow();
        // NaN → 0；3 → 0 视为 drain
        expect(el.classList.contains('badge-pop-down')).toBe(true);
    });

    it('全局样式 stylesheet 仅注入一次（id 去重）', () => {
        // 模块加载时已注入；多次调用不重复
        animateBadgeChange(_newBadge('0'), 1, { tone: 'gain' });
        animateBadgeChange(_newBadge('0'), 1, { tone: 'gain' });
        const styles = document.querySelectorAll('#badge-animator-styles');
        expect(styles.length).toBe(1);
    });
});
