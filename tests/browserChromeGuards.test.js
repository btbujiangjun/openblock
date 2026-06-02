/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    installBrowserChromeGuards,
    shouldAllowBrowserChrome,
    __test_only__,
} from '../web/src/browserChromeGuards.js';

const { shouldBlockKey } = __test_only__;

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
});
