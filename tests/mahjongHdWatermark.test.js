/**
 * v1.49 (2026-05) — 全量皮肤 HD 模式"emoji 换装"单测
 *
 * 历史背景：mahjong 是 v1.49 首批接入"HD emoji 换装"机制的皮肤，本文件最初
 * 仅覆盖 mahjong；v1.49 终版扩展为全量 34 个皮肤都接入，本文件相应扩充为
 * "麻将专属约束 + 全量皮肤通用约束"两块。
 *
 * v1.49 v4 终版（"水印图片不得重复"修复）：
 *   v3 的 2 件套在默认 5 锚点上 i%2 循环，会出现 3 个相同 emoji（如 mahjong
 *   盘面上 5 个水印里有 3 个 🎲 + 2 个 🀐）—— 视觉上即"图片重复"。
 *   v4 把每个皮肤的 hdIcons 数量统一为 **5 件**（= 默认锚点数），
 *   保证盘面上同时显示的 5 个水印 emoji 两两不同。
 *
 * 全量约束（防止任何皮肤违反"换皮不换轨"+"图片不重复"双重产品契约）：
 *   1. 所有 34 个皮肤都必须声明 hdIcons（HD 模式 emoji 换装）
 *   2. 每个皮肤 hdIcons 数量 = 5（默认锚点数，保证盘面 5 个水印两两不同）
 *   3. 每个皮肤 hdIcons 与该皮肤基础 icons 不重叠（HD 必须真正"换装"）
 *   4. 全局 hdIcons emoji 唯一（任意两个皮肤的 hdIcons 不交，34×5=170 全互异）
 *   5. hdIcons emoji 不在任何皮肤的基础 icons 全集里（避免与基础水印混淆）
 *   6. 所有皮肤都不引入 hdOpacity / hdScale / hdAnchors（仅替换 emoji，与所有皮肤共享漂浮节奏）
 *   7. 小程序 hdIcons 与 web 完全一致（防止 sync 脚本漏改）
 *
 * 麻将专属：v1/v2/v3/v4 四次回退记录（详见下方 mahjong describe 块）。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { SKINS as WEB_SKINS } from '../web/src/skins.js';

/* miniprogram/core/skins.js 是 CommonJS（小程序运行时不支持 ESM），需要走
 * 与 tests/miniprogramCore.test.js 一致的 vm 沙箱加载，避免顶层 import 报
 * "module is not defined in ES module scope"。 */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsCache = new Map();

function _resolveCjs(request, basedir) {
    if (!request.startsWith('.')) return request;
    const base = path.resolve(basedir, request);
    const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
    const match = candidates.find((p) => fs.existsSync(p));
    if (!match) throw new Error(`Cannot resolve ${request} from ${basedir}`);
    return match;
}

function requireCjs(request, basedir = __dirname) {
    const filename = _resolveCjs(request, basedir);
    if (cjsCache.has(filename)) return cjsCache.get(filename).exports;
    const module = { exports: {} };
    cjsCache.set(filename, module);
    const dirname = path.dirname(filename);
    const localRequire = (next) => requireCjs(next, dirname);
    const source = fs.readFileSync(filename, 'utf8');
    const wrapped = `(function (exports, require, module, __filename, __dirname) {\n${source}\n})`;
    vm.runInThisContext(wrapped, { filename })(module.exports, localRequire, module, filename, dirname);
    return module.exports;
}

const { SKIN_LIST: MP_SKIN_LIST } = requireCjs('../miniprogram/core/skins.js');

/* v1.49 v4：HD 模式 5 件套 emoji 换装（骰子 + 一索/雀 + 一筒 + 一万 + 红中），
 * 5 件 = 默认锚点数，保证盘面上 5 个水印 emoji 两两不同；
 * 沿用默认 5 锚点 1:1 映射，与所有皮肤共享同一漂浮节奏与亮度。 */
const EXPECTED_HD_ICONS = ['🎲', '🀐', '🀙', '🀇', '🀄'];

/* ============================================================================
 * 1. web 端 mahjong 皮肤数据结构
 * ============================================================================ */

describe('web mahjong skin — HD 水印组数据', () => {
    const wm = WEB_SKINS.mahjong.boardWatermark;

    it('boardWatermark 同时包含基础 icons 和 hdIcons', () => {
        expect(Array.isArray(wm.icons)).toBe(true);
        expect(wm.icons.length).toBeGreaterThan(0);
        expect(Array.isArray(wm.hdIcons)).toBe(true);
        expect(wm.hdIcons.length).toBe(5);
    });

    it('hdIcons 是约定的 5 件麻将特色 emoji（骰子 + 一索/雀 + 一筒 + 一万 + 红中）', () => {
        expect(wm.hdIcons).toEqual(EXPECTED_HD_ICONS);
    });

    it('hdIcons 数量 = 默认 5 锚点数（盘面 5 个水印 emoji 两两不同，杜绝"图片重复"）', () => {
        // 默认锚点数 = 5（四角 + 中心，见 renderer.js DEFAULT_WATERMARK_ANCHOR_RATIOS）
        // v3 用 2 件时，5 锚点 i%2 循环导致 3 个 🎲 重复 → v4 升到 5 件 = 锚点数
        expect(wm.hdIcons.length).toBe(5);
    });

    it('mahjong 仅覆盖 hdIcons，不引入 hdOpacity / hdScale / hdAnchors', () => {
        // v1.49 修订记录：
        //   v1: 6 锚点 + 自定义 scale → 破坏运动模式，回退
        //   v2: 3 件套 + hdOpacity 0.13 → 亮度高于所有皮肤（dawn 0.12 是最高），回退
        //   v3: 2 件套 + 无 hdOpacity → 5 锚点 i%2 循环出现 3 个 🎲 重复，回退
        //   v4: 当前——5 件套（=锚点数）+ 无 hdOpacity，盘面 5 个水印两两不同
        // 收紧约束防止再次回退到非一致行为。
        expect(wm.hdOpacity).toBeUndefined();
        expect(wm.hdScale).toBeUndefined();
        expect(wm.hdAnchors).toBeUndefined();
    });
});

/* ============================================================================
 * 2. 小程序端 mahjong 皮肤同步
 * ============================================================================ */

describe('miniprogram mahjong skin — 与 web 端字段一致性（sync 脚本）', () => {
    const mpMahjong = MP_SKIN_LIST.find((s) => s.id === 'mahjong');

    it('小程序 mahjong 皮肤存在', () => {
        expect(mpMahjong).toBeDefined();
        expect(mpMahjong?.boardWatermark).toBeDefined();
    });

    it('小程序 boardWatermark 同步包含 hdIcons', () => {
        const wm = mpMahjong.boardWatermark;
        expect(wm.hdIcons).toEqual(EXPECTED_HD_ICONS);
    });

    it('小程序同样仅覆盖 hdIcons，不引入 hdOpacity / hdScale / hdAnchors', () => {
        const wm = mpMahjong.boardWatermark;
        expect(wm.hdOpacity).toBeUndefined();
        expect(wm.hdScale).toBeUndefined();
        expect(wm.hdAnchors).toBeUndefined();
    });

    it('小程序基础 opacity（0.06，移动端柔化）与 web（0.10）的差异由全局移动端策略决定，与 HD 路径无关', () => {
        const webWm = WEB_SKINS.mahjong.boardWatermark;
        const mpWm = mpMahjong.boardWatermark;
        // 仅校验"小程序基础 opacity ≤ web 基础 opacity"的全局移动端柔化约定，
        // 不涉及 HD 字段（HD 已统一回退到基础 opacity）
        expect(mpWm.opacity).toBeLessThanOrEqual(webWm.opacity);
    });
});

/* ============================================================================
 * 3. _renderBoardWatermark 行为：HD 切换 + fallback
 * ============================================================================ */

describe('_renderBoardWatermark — HD 模式切换与 fallback', () => {
    /**
     * 构造一个最小 ctx mock，仅记录 fillText 调用；模拟 renderer 的 _renderBoardWatermark
     * 关键决策路径（icons / opacity / scale / anchors 选择）。
     *
     * 不直接 import web/src/renderer.js Renderer 类（会拖入 fxCanvas / DPR 等浏览器依赖）；
     * 而是复刻同一段决策逻辑断言 wm 字段被正确选中。
     */
    function pickWatermarkConfig(qualityMode, wm) {
        const isHd = qualityMode === 'high';
        const useHdSet = isHd && Array.isArray(wm.hdIcons) && wm.hdIcons.length > 0;
        return {
            icons: useHdSet ? wm.hdIcons : wm.icons,
            opacity: useHdSet ? (wm.hdOpacity ?? wm.opacity ?? 0.07) : (wm.opacity ?? 0.07),
            scale: useHdSet ? (wm.hdScale ?? wm.scale ?? 0.24) : (wm.scale ?? 0.24),
            anchors: (useHdSet && Array.isArray(wm.hdAnchors) && wm.hdAnchors.length > 0)
                ? wm.hdAnchors
                : null,
            usedHd: useHdSet,
        };
    }

    const mahjongWm = WEB_SKINS.mahjong.boardWatermark;

    it('qualityMode=high + 麻将皮肤 → 使用 hdIcons 5 件套；opacity / scale / anchors 全部回退到基础值', () => {
        const cfg = pickWatermarkConfig('high', mahjongWm);
        expect(cfg.usedHd).toBe(true);
        expect(cfg.icons).toEqual(EXPECTED_HD_ICONS);
        // mahjong v4：不引入 hdOpacity，opacity 回退到基础（与所有皮肤亮度一致）
        expect(cfg.opacity).toBe(mahjongWm.opacity);
        // mahjong v4：不引入 hdScale，scale 回退到基础（或全局默认）
        expect(cfg.scale).toBe(mahjongWm.scale ?? 0.24);
        // mahjong v4：不引入 hdAnchors，沿用默认 5 锚点（pickWatermarkConfig 返回 null 表示走默认）
        expect(cfg.anchors).toBeNull();
    });

    it('qualityMode=balanced → 仍用基础 icons 控制开销', () => {
        const cfg = pickWatermarkConfig('balanced', mahjongWm);
        expect(cfg.usedHd).toBe(false);
        expect(cfg.icons).toEqual(mahjongWm.icons);
        expect(cfg.opacity).toBe(mahjongWm.opacity);
        expect(cfg.anchors).toBeNull();
    });

    it('qualityMode=low → 仍用基础 icons', () => {
        const cfg = pickWatermarkConfig('low', mahjongWm);
        expect(cfg.usedHd).toBe(false);
        expect(cfg.icons).toEqual(mahjongWm.icons);
    });

    it('未启用 HD 套装的虚拟皮肤（无 hdIcons）即使在 HD 模式也回退到基础 icons', () => {
        // v1.49 终版：所有 34 个真实皮肤都有 hdIcons，因此此处用虚拟皮肤验证 fallback 行为
        const fakeWm = { icons: ['A', 'B'], opacity: 0.08 };
        const cfg = pickWatermarkConfig('high', fakeWm);
        expect(cfg.usedHd).toBe(false);
        expect(cfg.icons).toEqual(['A', 'B']);
    });

    it('hdIcons 缺失但保留 hdOpacity / hdScale → 视为整体未启用 HD 套装', () => {
        const partial = { icons: ['A'], opacity: 0.1, hdOpacity: 0.2, hdScale: 0.3 };
        const cfg = pickWatermarkConfig('high', partial);
        expect(cfg.usedHd).toBe(false);
        expect(cfg.icons).toEqual(['A']);
        expect(cfg.opacity).toBe(0.1);
        expect(cfg.scale).toBe(0.24);
    });

    it('hdIcons 存在但 hdOpacity / hdScale 缺失 → 回退到基础 opacity / scale', () => {
        const partial = {
            icons: ['A'], opacity: 0.1, scale: 0.3,
            hdIcons: ['B', 'C'],
        };
        const cfg = pickWatermarkConfig('high', partial);
        expect(cfg.usedHd).toBe(true);
        expect(cfg.icons).toEqual(['B', 'C']);
        expect(cfg.opacity).toBe(0.1);
        expect(cfg.scale).toBe(0.3);
        expect(cfg.anchors).toBeNull(); // 锚点也回退到默认 5 锚点
    });
});

/* ============================================================================
 * 4. 不与 boardgame 皮肤雷同（区分姊妹皮肤）
 * ============================================================================ */

describe('mahjong 与 boardgame 姊妹皮肤的 HD 水印做错位', () => {
    it('mahjong HD 5 件套 ≥ 4 张麻将牌（U+1F000 系列）+ 1 颗骰子', () => {
        const hdIcons = WEB_SKINS.mahjong.boardWatermark.hdIcons;
        // U+1F000-U+1F02B 是麻将牌区段
        const mahjongTileCount = hdIcons.filter((c) => {
            const cp = c.codePointAt(0);
            return cp >= 0x1F000 && cp <= 0x1F02B;
        }).length;
        // v4 终版：5 件套 = 1 颗骰子 + 4 张麻将牌（一索/一筒/一万/红中）
        expect(mahjongTileCount).toBeGreaterThanOrEqual(4);
        // 同时含骰子，与 boardgame 共享叙事元素但语境不同（boardgame 是赌场，mahjong 是雀馆）
        expect(hdIcons).toContain('🎲');
    });

    it('boardgame HD 5 件套 = 老虎机 🎰 + 棋子 ♟️ + 三花色（与 mahjong 不同 emoji，错位叙事）', () => {
        const wm = WEB_SKINS.boardgame.boardWatermark;
        // v4 终版：5 件套覆盖 5 锚点；扑克博弈用老虎机 + 国象棋子 + 梅花/红心/方片
        expect(wm.hdIcons).toEqual(['🎰', '♟️', '♣️', '♥️', '♦️']);
        // 与 mahjong 完全不同的 emoji，全局唯一性约束（在 §4 全量 describe 块中校验）
        const mahjongHd = WEB_SKINS.mahjong.boardWatermark.hdIcons;
        const intersect = wm.hdIcons.filter((e) => mahjongHd.includes(e));
        expect(intersect).toEqual([]);
    });
});

/* ============================================================================
 * 4. 全量 34 个皮肤 HD emoji 换装约束（v1.49 终版）
 *
 * 这是本文件的核心约束：所有皮肤共享同一套"换皮不换轨"产品契约。
 * 任意单个皮肤违反以下约束将立即失败，防止后续 PR 不小心引入回归。
 * ============================================================================ */

describe('全量皮肤 HD emoji 换装 — v1.49 终版统一约束', () => {
    /** 收集所有皮肤的 boardWatermark 视图（仅含有 boardWatermark 的皮肤；当前应为 34/34）。 */
    const allSkins = Object.entries(WEB_SKINS).filter(([, s]) => s.boardWatermark);

    it('应该有 34 个皮肤都定义了 boardWatermark', () => {
        expect(allSkins.length).toBe(34);
    });

    it('约束 1：每个皮肤都必须声明 hdIcons（HD 模式 emoji 换装）', () => {
        for (const [id, skin] of allSkins) {
            expect(Array.isArray(skin.boardWatermark.hdIcons), `${id}.hdIcons 应为数组`).toBe(true);
            expect(skin.boardWatermark.hdIcons.length, `${id}.hdIcons 不应为空`).toBeGreaterThan(0);
        }
    });

    it('约束 2：每个皮肤 hdIcons 数量 = 5（默认锚点数，盘面 5 个水印两两不同，杜绝"图片重复"）', () => {
        // v4 终版：把 hdIcons 数量统一抬到 = 默认锚点数 5（renderer.js DEFAULT_WATERMARK_ANCHOR_RATIOS）
        // 这样 _renderBoardWatermark 在锚点 i 上 pick icons[i % 5] = icons[i] 时所有位置都不同 emoji。
        // v3 用 2 件套时，5 锚点 i%2 循环导致 3 个相同 emoji（用户截图见证）。
        for (const [id, skin] of allSkins) {
            const wm = skin.boardWatermark;
            expect(wm.hdIcons.length, `${id} hdIcons 数量应等于默认锚点数 5`).toBe(5);
        }
    });

    it('约束 3：每个皮肤 hdIcons 与该皮肤基础 icons 不重叠（HD 必须真正换装）', () => {
        for (const [id, skin] of allSkins) {
            const wm = skin.boardWatermark;
            const overlap = wm.hdIcons.filter((e) => wm.icons.includes(e));
            expect(overlap, `${id} hdIcons 与基础 icons 不应有交集`).toEqual([]);
        }
    });

    it('约束 4：全局 hdIcons emoji 唯一（任意两个皮肤的 hdIcons 不交）', () => {
        const seen = new Map(); // emoji → 第一个声明的 skinId
        for (const [id, skin] of allSkins) {
            for (const emoji of skin.boardWatermark.hdIcons) {
                if (seen.has(emoji)) {
                    throw new Error(`hdIcons emoji "${emoji}" 在 ${seen.get(emoji)} 与 ${id} 中重复`);
                }
                seen.set(emoji, id);
            }
        }
        // 总数 = 各皮肤 hdIcons 长度之和；这里仅是 sanity check
        const total = allSkins.reduce((acc, [, s]) => acc + s.boardWatermark.hdIcons.length, 0);
        expect(seen.size).toBe(total);
    });

    it('约束 5：hdIcons emoji 不在任何皮肤的基础 icons 全集里（避免与基础水印混淆）', () => {
        const baseSet = new Set();
        for (const [, skin] of allSkins) {
            for (const e of skin.boardWatermark.icons) baseSet.add(e);
        }
        for (const [id, skin] of allSkins) {
            for (const emoji of skin.boardWatermark.hdIcons) {
                if (baseSet.has(emoji)) {
                    throw new Error(`${id} hdIcons "${emoji}" 已存在于基础 icons 全集，会与基础水印混淆`);
                }
            }
        }
    });

    it('约束 6：所有皮肤都不引入 hdOpacity / hdScale / hdAnchors（仅替换 emoji）', () => {
        for (const [id, skin] of allSkins) {
            const wm = skin.boardWatermark;
            expect(wm.hdOpacity, `${id} 不应引入 hdOpacity`).toBeUndefined();
            expect(wm.hdScale, `${id} 不应引入 hdScale`).toBeUndefined();
            expect(wm.hdAnchors, `${id} 不应引入 hdAnchors`).toBeUndefined();
        }
    });

    it('约束 7：小程序 hdIcons 与 web 完全一致（防止 sync 脚本漏改）', () => {
        const mpSkins = requireCjs('../miniprogram/core/skins.js').SKINS;
        for (const [id, webSkin] of allSkins) {
            const mpSkin = mpSkins[id];
            expect(mpSkin, `小程序应有 ${id} 皮肤`).toBeDefined();
            expect(
                mpSkin.boardWatermark?.hdIcons,
                `小程序 ${id}.hdIcons 应与 web 完全一致`,
            ).toEqual(webSkin.boardWatermark.hdIcons);
        }
    });

    it('snapshot：完整的 hdIcons 设计表（任何变化都会触发 review）', () => {
        const table = Object.fromEntries(
            allSkins.map(([id, s]) => [id, s.boardWatermark.hdIcons]),
        );
        // 锁定 v1.49 终版设计；后续如调整，需同步更新 CHANGELOG / SKINS_CATALOG
        expect(table).toMatchSnapshot();
    });
});
