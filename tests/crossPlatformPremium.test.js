/**
 * 新手村 / 精致界面 core 跨端契约单测（权威源 web/src → sync-core / sync-cocos-engine）
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsCache = new Map();

function resolveCjs(request, basedir = __dirname) {
    if (!request.startsWith('.')) return request;
    const base = path.resolve(basedir, request);
    const candidates = [`${base}.js`, `${base}.json`, base, path.join(base, 'index.js')];
    const match = candidates.find((p) => {
        try { return fs.existsSync(p) && fs.statSync(p).isFile(); }
        catch { return false; }
    });
    if (!match) throw new Error(`Cannot resolve ${request} from ${basedir}`);
    return match;
}

function requireCjs(request, basedir = __dirname) {
    const filename = resolveCjs(request, basedir);
    if (cjsCache.has(filename)) return cjsCache.get(filename).exports;
    if (filename.endsWith('.json')) return JSON.parse(fs.readFileSync(filename, 'utf8'));
    const module = { exports: {} };
    cjsCache.set(filename, module);
    const dirname = path.dirname(filename);
    const localRequire = (next) => requireCjs(next, dirname);
    const source = fs.readFileSync(filename, 'utf8');
    const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`;
    vm.runInThisContext(wrapped, { filename })(module.exports, localRequire, module, filename, dirname);
    return module.exports;
}

const _store = {};
beforeEach(() => {
    for (const k of Object.keys(_store)) delete _store[k];
});

const storage = {
    getItem: (k) => _store[k] ?? null,
    setItem: (k, v) => { _store[k] = String(v); },
    removeItem: (k) => { delete _store[k]; },
};

const webCore = await import('../web/src/onboarding/newbieVillageCore.js');
const mpCore = requireCjs('../miniprogram/core/onboarding/newbieVillageCore.js');
const premiumWeb = await import('../web/src/effects/skinPremiumCore.js');
const premiumMp = requireCjs('../miniprogram/core/effects/skinPremiumCore.js');
const appearanceWeb = await import('../web/src/effects/appearanceModeCore.js');
const appearanceMp = requireCjs('../miniprogram/core/effects/appearanceModeCore.js');

describe('newbieVillageCore 跨端一致', () => {
    it('SCENARIO 课数与首课 id 一致', () => {
        expect(mpCore.SCENARIO.length).toBe(webCore.SCENARIO.length);
        expect(mpCore.SCENARIO[0].id).toBe('single');
        expect(mpCore.SCENARIO[4].id).toBe('perfect');
    });

    it('首登判定 storage 键一致', () => {
        expect(mpCore.NEWBIE_VILLAGE_STORAGE_KEY).toBe(webCore.NEWBIE_VILLAGE_STORAGE_KEY);
        expect(webCore.shouldShowNewbieVillageCore({ storage, game: { playerProfile: { lifetimeGames: 0 } } })).toBe(true);
        expect(webCore.shouldShowNewbieVillageCore({ storage, game: { playerProfile: { lifetimeGames: 1 } } })).toBe(false);
    });

    it('单消课计分与 Web core 一致', () => {
        const step = webCore.SCENARIO[0];
        let board = step.seed();
        const piece = step.pieces[0];
        board = webCore.applyPiece(board, piece, piece.target);
        const webScored = webCore.scorePlacement(board, 0);
        board = mpCore.applyPiece(step.seed(), piece, piece.target);
        const mpScored = mpCore.scorePlacement(board, 0);
        expect(mpScored.score.clearScore).toBe(webScored.score.clearScore);
    });
});

describe('skinPremiumCore / appearanceModeCore 跨端一致', () => {
    it('存储键与默认关闭', () => {
        expect(premiumMp.SKIN_PREMIUM_STORAGE_KEY).toBe(premiumWeb.SKIN_PREMIUM_STORAGE_KEY);
        expect(premiumWeb.loadPremiumPrefs(storage).enabled).toBe(false);
    });

    it('computePremiumSkinVars accent 一致', () => {
        const skin = { uiDark: true, cssVars: { '--accent-color': '#f97316' } };
        const w = premiumWeb.computePremiumSkinVars(skin);
        const m = premiumMp.computePremiumSkinVars(skin);
        expect(m['--premium-accent']).toBe(w['--premium-accent']);
        expect(m['--premium-board-border']).toBe(w['--premium-board-border']);
    });

    it('isPremiumRenderEnabled 低画质关闭', () => {
        expect(premiumWeb.isPremiumRenderEnabled({ enabled: true, qualityMode: 'low' })).toBe(false);
        expect(premiumWeb.isPremiumRenderEnabled({ enabled: true, qualityMode: 'high' })).toBe(true);
    });

    it('premiumBoardCornerRadiusPx 随盘面宽度缩放', () => {
        expect(premiumWeb.premiumBoardCornerRadiusPx(480)).toBe(12);
        expect(premiumWeb.premiumBoardCornerRadiusPx(240)).toBe(6);
        expect(premiumMp.premiumBoardCornerRadiusPx(480)).toBe(12);
    });

    it('appearanceModeCore 三档与 resolve 一致', () => {
        expect(appearanceMp.APPEARANCE_MODES).toEqual(appearanceWeb.APPEARANCE_MODES);
        expect(appearanceMp.resolveAppearanceMode({ premiumEnabled: true, visualEnabled: false }))
            .toBe('premium');
        expect(appearanceMp.cycleAppearanceMode('full')).toBe('basic');
    });
});
