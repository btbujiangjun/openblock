/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    installBrowserChromeGuards,
    shouldAllowBrowserChrome,
    __test_only__,
} from '../web/src/browserChromeGuards.js';

const { shouldBlockKey, isTouchLikeClient, clearDisallowedSelection } = __test_only__;

describe('browserChromeGuards', () => {
    let teardown = () => {};

    beforeEach(() => {
        document.body.innerHTML = `
            <input id="inp" type="text" />
            <div id="game"><canvas id="cv"></canvas></div>
            <div data-allow-browser-chrome id="allow"><span id="in-allow">x</span></div>
        `;
        delete document.documentElement.dataset.browserChromeGuards;
        teardown = installBrowserChromeGuards();
    });

    afterEach(() => {
        teardown();
    });

    it('shouldAllowBrowserChrome — 输入框与标记区域放行', () => {
        expect(shouldAllowBrowserChrome(document.getElementById('inp'))).toBe(true);
        expect(shouldAllowBrowserChrome(document.getElementById('cv'))).toBe(false);
        expect(shouldAllowBrowserChrome(document.getElementById('in-allow'))).toBe(true);
    });

    it('shouldBlockKey — 屏蔽 F5 / Ctrl+R / 右键菜单键', () => {
        expect(shouldBlockKey({ target: document.getElementById('cv'), key: 'F5', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
        expect(shouldBlockKey({ target: document.getElementById('cv'), key: 'r', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
        expect(shouldBlockKey({ target: document.getElementById('cv'), key: 'ContextMenu', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(true);
        expect(shouldBlockKey({ target: document.getElementById('inp'), key: 'r', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
        expect(shouldBlockKey({ target: document.getElementById('cv'), key: 'ArrowUp', ctrlKey: false, metaKey: false, altKey: false, shiftKey: false })).toBe(false);
    });

    it('contextmenu 在棋盘区域被拦截', () => {
        const ev = new Event('contextmenu', { bubbles: true, cancelable: true });
        document.getElementById('cv').dispatchEvent(ev);
        expect(ev.defaultPrevented).toBe(true);
    });

    it('selectstart / copy 在棋盘区域被拦截，输入框放行', () => {
        const sel = new Event('selectstart', { bubbles: true, cancelable: true });
        document.getElementById('cv').dispatchEvent(sel);
        expect(sel.defaultPrevented).toBe(true);

        const copy = new Event('copy', { bubbles: true, cancelable: true });
        document.getElementById('cv').dispatchEvent(copy);
        expect(copy.defaultPrevented).toBe(true);

        const copyInp = new Event('copy', { bubbles: true, cancelable: true });
        document.getElementById('inp').dispatchEvent(copyInp);
        expect(copyInp.defaultPrevented).toBe(false);
    });

    it('isTouchLikeClient — native-client class 为 true', () => {
        document.documentElement.classList.add('native-client');
        expect(isTouchLikeClient()).toBe(true);
        document.documentElement.classList.remove('native-client');
    });

    it('clearDisallowedSelection — 清除棋盘区选区，放行区保留', () => {
        document.body.innerHTML = `
            <div data-allow-browser-chrome id="allow"><span id="keep">keep</span></div>
            <div id="game"><span id="txt">score</span></div>
        `;
        const txt = document.getElementById('txt');
        const keep = document.getElementById('keep');
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(txt);
        sel?.removeAllRanges();
        sel?.addRange(range);
        expect(sel?.toString()).toBe('score');

        clearDisallowedSelection();
        expect(sel?.isCollapsed).toBe(true);

        const rangeAllow = document.createRange();
        rangeAllow.selectNodeContents(keep);
        sel?.removeAllRanges();
        sel?.addRange(rangeAllow);
        clearDisallowedSelection();
        expect(sel?.toString()).toBe('keep');
    });
});
