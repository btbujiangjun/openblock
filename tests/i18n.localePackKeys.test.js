/**
 * 校验各语言包是否包含近期 UI 共用键（避免仅中英有译文、其它语言默默回退 zh-CN）
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import zhCN from '../web/src/i18n/locales/zh-CN.js';
import en from '../web/src/i18n/locales/en.js';
import fr from '../web/src/i18n/locales/fr.js';
import de from '../web/src/i18n/locales/de.js';
import es from '../web/src/i18n/locales/es.js';
import ar from '../web/src/i18n/locales/ar.js';
import ja from '../web/src/i18n/locales/ja.js';
import ko from '../web/src/i18n/locales/ko.js';
import el from '../web/src/i18n/locales/el.js';
import localeIt from '../web/src/i18n/locales/it.js';
import ptBR from '../web/src/i18n/locales/pt-BR.js';
import ru from '../web/src/i18n/locales/ru.js';
import pl from '../web/src/i18n/locales/pl.js';
import tr from '../web/src/i18n/locales/tr.js';
import vi from '../web/src/i18n/locales/vi.js';
import th from '../web/src/i18n/locales/th.js';
import localeId from '../web/src/i18n/locales/id.js';
import nl from '../web/src/i18n/locales/nl.js';
import uk from '../web/src/i18n/locales/uk.js';

/** 主菜单 / HUD 等处近期新增的共用键 */
const CORE_KEYS = [
    'ui.aria.quickToolbar',
    'ui.skill.seasonPass',
    'menu.replayAlbum',
    'menu.personalData',
    'menu.dbDebug',
];

const PACKS = {
    'zh-CN': zhCN,
    en,
    fr,
    de,
    es,
    ar,
    ja,
    ko,
    el,
    it: localeIt,
    'pt-BR': ptBR,
    ru,
    pl,
    tr,
    vi,
    th,
    id: localeId,
    nl,
    uk,
};

describe('i18n locale packs', () => {
    it('every locale defines CORE_KEYS with non-empty strings', () => {
        for (const [code, dict] of Object.entries(PACKS)) {
            for (const key of CORE_KEYS) {
                const v = dict[key];
                expect(v, `${code} missing ${key}`).toBeDefined();
                expect(typeof v, `${code} ${key}`).toBe('string');
                expect(v.length, `${code} ${key} empty`).toBeGreaterThan(0);
            }
        }
    });

    it('zh-CN includes CORE_KEYS (sanity)', () => {
        for (const key of CORE_KEYS) {
            expect(zhCN[key]).toBeDefined();
        }
    });
});
