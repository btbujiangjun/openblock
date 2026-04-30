/**
 * i18n — 多语言（扁平键值；阿拉伯语自动 RTL）
 *
 * - 文案：`locales/*.js`
 * - DOM：`data-i18n`、`data-i18n-title`、`data-i18n-aria-label` 等，见 applyDom()
 * - JS：`import { t, tSkinName } from './i18n/i18n.js'`
 */
import zhCN from './locales/zh-CN.js';
import en from './locales/en.js';
import fr from './locales/fr.js';
import de from './locales/de.js';
import es from './locales/es.js';
import ar from './locales/ar.js';
import ja from './locales/ja.js';
import ko from './locales/ko.js';
import el from './locales/el.js';
import it from './locales/it.js';
import ptBR from './locales/pt-BR.js';
import ru from './locales/ru.js';
import pl from './locales/pl.js';
import tr from './locales/tr.js';
import vi from './locales/vi.js';
import th from './locales/th.js';
import id from './locales/id.js';
import nl from './locales/nl.js';
import uk from './locales/uk.js';

const LOCALES = {
    'zh-CN': zhCN,
    en,
    fr,
    de,
    es,
    ar,
    ja,
    ko,
    el,
    it,
    'pt-BR': ptBR,
    ru,
    pl,
    tr,
    vi,
    th,
    id,
    nl,
    uk,
};

const STORAGE_KEY = 'openblock_locale_v1';
const FALLBACK = 'zh-CN';

/** @type {keyof typeof LOCALES} */
let current = FALLBACK;

/** @type {Set<(code: string) => void>} */
const listeners = new Set();

export const AVAILABLE_LOCALES = [
    { code: 'zh-CN', nativeName: '中文' },
    { code: 'en', nativeName: 'English' },
    { code: 'ja', nativeName: '日本語' },
    { code: 'ko', nativeName: '한국어' },
    { code: 'fr', nativeName: 'Français' },
    { code: 'de', nativeName: 'Deutsch' },
    { code: 'es', nativeName: 'Español' },
    { code: 'it', nativeName: 'Italiano' },
    { code: 'pt-BR', nativeName: 'Português (Brasil)' },
    { code: 'nl', nativeName: 'Nederlands' },
    { code: 'ru', nativeName: 'Русский' },
    { code: 'uk', nativeName: 'Українська' },
    { code: 'pl', nativeName: 'Polski' },
    { code: 'tr', nativeName: 'Türkçe' },
    { code: 'vi', nativeName: 'Tiếng Việt' },
    { code: 'th', nativeName: 'ไทย' },
    { code: 'id', nativeName: 'Bahasa Indonesia' },
    { code: 'ar', nativeName: 'العربية' },
    { code: 'el', nativeName: 'Ελληνικά' },
];

export function getLocale() {
    return current;
}

/**
 * @param {string} code
 */
export function setLocale(code) {
    if (!LOCALES[code]) code = FALLBACK;
    current = code;
    try {
        localStorage.setItem(STORAGE_KEY, code);
    } catch { /* ignore */ }
    document.documentElement.lang = code;
    document.documentElement.dir = code === 'ar' ? 'rtl' : 'ltr';
    listeners.forEach((fn) => {
        try {
            fn(code);
        } catch { /* ignore */ }
    });
}

/** @param {(code: string) => void} cb */
export function subscribeLocale(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

export function initI18n() {
    let saved = FALLBACK;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw && LOCALES[raw]) saved = raw;
    } catch { /* ignore */ }
    setLocale(saved);
}

/**
 * @param {string} key
 * @param {Record<string, string | number>} [vars] 占位符 {{name}}
 */
export function t(key, vars) {
    const dict = LOCALES[current] || LOCALES[FALLBACK];
    let str = dict[key] ?? LOCALES[FALLBACK][key] ?? key;
    if (vars && typeof str === 'string') {
        str = str.replace(/\{\{(\w+)\}\}/g, (_, k) => {
            const v = vars[k];
            return v !== undefined && v !== null ? String(v) : '';
        });
    }
    return str;
}

/**
 * 棋盘主题显示名（语言包 `skin.name.<id>`）；未配置时回退 `skins.js` 的 `name`。
 * @param {{ id: string, name?: string }} skin
 */
export function tSkinName(skin) {
    if (!skin?.id) return '';
    const key = `skin.name.${skin.id}`;
    const localized = t(key);
    return localized !== key ? localized : (skin.name || skin.id);
}

/**
 * 将 data-i18n* 写入 DOM（切换语言后整页或子树重跑）
 * @param {ParentNode} [root]
 */
export function applyDom(root = document.body) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.dataset.i18n;
        if (!key) return;
        let vars;
        try {
            vars = el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : undefined;
        } catch {
            vars = undefined;
        }
        el.textContent = t(key, vars);
    });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
        const key = el.dataset.i18nHtml;
        if (!key) return;
        el.innerHTML = t(key);
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.dataset.i18nTitle;
        if (!key) return;
        el.title = t(key);
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
        const key = el.dataset.i18nAriaLabel;
        if (!key) return;
        el.setAttribute('aria-label', t(key));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.dataset.i18nPlaceholder;
        if (!key) return;
        /** @type {HTMLInputElement} */ (el).placeholder = t(key);
    });
}

/**
 * 同步 document title / meta description（需在 applyDom 外单独调用以使用当前 locale）
 */
export function applyMeta() {
    document.title = t('meta.title');
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute('content', t('meta.description'));
}
