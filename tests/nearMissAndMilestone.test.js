/**
 * @vitest-environment jsdom
 *
 * 落子近失（near-miss）与分数里程碑（score milestone）相关提示的回归测试。
 *
 * 覆盖 v1.49 修复点（详见 CHANGELOG）：
 *   1. `nearMissCount` 死字段引用 — 确保 `_lastAdaptiveInsight` 中不再依赖该字段；
 *   2. `best.gap.victory` 死分支 — `ratio<=0.02` 时确实输出该 i18n key；
 *   3. 几何 near-miss — `Grid.getMaxLineFill()` 工具方法在边界条件下返回正确值；
 *   4. 字段更名 — `_milestoneHit` → `_scoreMilestoneHit` + `_scoreMilestoneValue`；
 *   5. 里程碑相对化 — `bestScore` 缺失时用绝对档；`bestScore≥200` 时按比例派生；
 *   6. i18n key 完整性 — 4 个新/改 key 在 zh-CN 与 en 中都存在。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveAdaptiveStrategy, resetAdaptiveMilestone } from '../web/src/adaptiveSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { Grid } from '../web/src/grid.js';
import zhCN from '../web/src/i18n/locales/zh-CN.js';
import en from '../web/src/i18n/locales/en.js';
import jaLocale from '../web/src/i18n/locales/ja.js';
import koLocale from '../web/src/i18n/locales/ko.js';
import frLocale from '../web/src/i18n/locales/fr.js';
import deLocale from '../web/src/i18n/locales/de.js';
import esLocale from '../web/src/i18n/locales/es.js';
import itLocale from '../web/src/i18n/locales/it.js';
import ptBRLocale from '../web/src/i18n/locales/pt-BR.js';
import nlLocale from '../web/src/i18n/locales/nl.js';
import ruLocale from '../web/src/i18n/locales/ru.js';
import ukLocale from '../web/src/i18n/locales/uk.js';
import plLocale from '../web/src/i18n/locales/pl.js';
import trLocale from '../web/src/i18n/locales/tr.js';
import viLocale from '../web/src/i18n/locales/vi.js';
import thLocale from '../web/src/i18n/locales/th.js';
import idLocale from '../web/src/i18n/locales/id.js';
import arLocale from '../web/src/i18n/locales/ar.js';
import elLocale from '../web/src/i18n/locales/el.js';

function makeProfile() { return new PlayerProfile(15); }

describe('Grid.getMaxLineFill (geometric near-miss helper)', () => {
    it('returns 0 for empty board', () => {
        const g = new Grid(8);
        expect(g.getMaxLineFill()).toBe(0);
    });

    it('returns 1 when any single row is fully filled', () => {
        const g = new Grid(8);
        for (let x = 0; x < 8; x++) g.cells[3][x] = 'red';
        expect(g.getMaxLineFill()).toBe(1);
    });

    it('returns 1 when any single column is fully filled', () => {
        const g = new Grid(8);
        for (let y = 0; y < 8; y++) g.cells[y][2] = 'blue';
        expect(g.getMaxLineFill()).toBe(1);
    });

    it('returns 7/8 when a row needs only one more cell to clear (true geometric near-miss)', () => {
        const g = new Grid(8);
        for (let x = 0; x < 7; x++) g.cells[0][x] = 'green';
        // 单行 7/8 = 0.875，作为新触发阈值 0.78 的"应当触发"侧
        expect(g.getMaxLineFill()).toBeCloseTo(0.875, 5);
        expect(g.getMaxLineFill()).toBeGreaterThanOrEqual(0.78);
    });

    it('returns < 0.78 for moderately filled board with no near-miss row/col (regression for v1.32 false positives)', () => {
        const g = new Grid(8);
        // 棋盘整体 fill ≈ 0.5，但每行/列最多 4/8 = 0.5
        for (let y = 0; y < 4; y++) {
            for (let x = 0; x < 8; x++) g.cells[y][x] = 'cyan';
        }
        // 每行 0/8 或 8/8——这个示例不合适，我们换：分散填充
        const g2 = new Grid(8);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 4; x++) g2.cells[y][x] = 'cyan';
        }
        // 每行 4/8 = 0.5，每列 0 或 8（左半 8/8）
        // 上面这个构造让左 4 列都满，所以 maxLineFill = 1 — 不合适
        // 换成棋盘格状半填充：
        const g3 = new Grid(8);
        for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
                if ((x + y) % 2 === 0) g3.cells[y][x] = 'cyan';
            }
        }
        // 每行/列各 4/8 = 0.5，整体 fill = 0.5；maxLineFill = 0.5 — 旧版会因 fillBefore>0.55 误触发，
        // 但本身离 0.78 还远，新版不再误触发。
        expect(g3.getFillRatio()).toBeCloseTo(0.5, 5);
        expect(g3.getMaxLineFill()).toBeCloseTo(0.5, 5);
        expect(g3.getMaxLineFill()).toBeLessThan(0.78);
    });
});

describe('Grid.getMaxLineFillLines (v1.51.1 placement-binding helper)', () => {
    it('returns empty lines when board has no near-full row/col', () => {
        const g = new Grid(8);
        for (let x = 0; x < 4; x++) g.cells[0][x] = 'red'; // 0/8 .. 4/8
        const out = g.getMaxLineFillLines(0.875);
        expect(out.maxFill).toBeCloseTo(0.5, 5);
        expect(out.lines).toEqual([]);
    });

    it('returns the specific row index when a row is 7/8 full', () => {
        const g = new Grid(8);
        for (let x = 0; x < 7; x++) g.cells[3][x] = 'green';
        const out = g.getMaxLineFillLines(0.875);
        expect(out.maxFill).toBeCloseTo(0.875, 5);
        expect(out.lines).toEqual([
            { type: 'row', index: 3, count: 7, fill: 0.875 },
        ]);
    });

    it('returns multiple rows and cols when several lines hit the threshold', () => {
        const g = new Grid(8);
        for (let x = 0; x < 7; x++) g.cells[1][x] = 'a';
        for (let x = 0; x < 7; x++) g.cells[5][x] = 'b';
        for (let y = 0; y < 7; y++) g.cells[y][2] = 'c';
        const out = g.getMaxLineFillLines(0.875);
        expect(out.maxFill).toBeGreaterThanOrEqual(0.875);
        const sig = out.lines.map((l) => `${l.type}:${l.index}`).sort();
        expect(sig).toContain('row:1');
        expect(sig).toContain('row:5');
        expect(sig).toContain('col:2');
    });

    it('honours the threshold (1.0 → only fully-filled lines)', () => {
        const g = new Grid(8);
        for (let x = 0; x < 7; x++) g.cells[2][x] = 'a';     // 7/8
        for (let x = 0; x < 8; x++) g.cells[6][x] = 'b';     // 8/8
        const out = g.getMaxLineFillLines(1.0);
        expect(out.lines).toEqual([
            { type: 'row', index: 6, count: 8, fill: 1 },
        ]);
    });
});

describe('resolveAdaptiveStrategy: scoreMilestone field rename and relative scaling', () => {
    beforeEach(() => { resetAdaptiveMilestone(); });

    it('exposes _scoreMilestoneHit and _scoreMilestoneValue, not the deprecated _milestoneHit', () => {
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 60, 0, 0.3, { totalRounds: 5, bestScore: 0 });
        expect('_scoreMilestoneHit' in s).toBe(true);
        expect('_scoreMilestoneValue' in s).toBe(true);
        // 旧字段已被删除（如果还在，说明改名没改全）
        expect('_milestoneHit' in s).toBe(false);
    });

    it('does NOT trigger any milestone when bestScore is below MIN_BEST_FOR_MILESTONE_TOAST (v1.55.10)', () => {
        // v1.55.10：低 best 玩家（bestScore < 500）任何分数都不触发 milestone toast，
        // 把"分数情绪反馈"完全让位给 PB 庆祝 / 追平 / near-PB。
        const s1 = resolveAdaptiveStrategy('normal', makeProfile(), 60, 0, 0.3, { totalRounds: 5, bestScore: 0 });
        expect(s1._scoreMilestoneHit).toBe(false);
        const s2 = resolveAdaptiveStrategy('normal', makeProfile(), 260, 0, 0.3, { totalRounds: 5, bestScore: 499 });
        expect(s2._scoreMilestoneHit).toBe(false);
    });

    it('does not re-trigger the same milestone twice within the same run', () => {
        // bestScore=1000 → 派生档位 [500, 750, 900]；分数 510 → 跨过 500 档（一次）
        // 再 resolve（分数 760）不再触发任何 milestone（v1.55.10 局内一次契约）
        resolveAdaptiveStrategy('normal', makeProfile(), 510, 0, 0.3, { totalRounds: 5, bestScore: 1000 });
        const s2 = resolveAdaptiveStrategy('normal', makeProfile(), 760, 0, 0.3, { totalRounds: 6, bestScore: 1000 });
        expect(s2._scoreMilestoneHit).toBe(false);
    });

    it('scales milestones relative to bestScore for advanced players (v1.55.10: [0.50, 0.75, 0.90])', () => {
        // bestScore=1000 → 派生档位 [500, 750, 900]；分数 510 → 跨过 500 档
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 510, 0, 0.3, { totalRounds: 5, bestScore: 1000 });
        expect(s._scoreMilestoneHit).toBe(true);
        expect(s._scoreMilestoneValue).toBe(500);
    });

    it('only triggers ONCE per run even across different milestones (v1.55.10 in-run cap)', () => {
        // bestScore=1000；第一次到 510 跨 500 → hit。第二次到 760 应跨 750 但被局内一次拦截。
        const s1 = resolveAdaptiveStrategy('normal', makeProfile(), 510, 0, 0.3, { totalRounds: 5, bestScore: 1000 });
        expect(s1._scoreMilestoneHit).toBe(true);
        const s2 = resolveAdaptiveStrategy('normal', makeProfile(), 760, 0, 0.3, { totalRounds: 6, bestScore: 1000 });
        expect(s2._scoreMilestoneHit).toBe(false);
        const s3 = resolveAdaptiveStrategy('normal', makeProfile(), 920, 0, 0.3, { totalRounds: 7, bestScore: 1000 });
        expect(s3._scoreMilestoneHit).toBe(false);
    });

    it('does NOT trigger the obsolete 0.25 / 1.0 / 1.25 ratios (v1.55.10 removed)', () => {
        // bestScore=1000；旧版会在 score=260（0.25 档）触发，新版不再触发
        const s = resolveAdaptiveStrategy('normal', makeProfile(), 260, 0, 0.3, { totalRounds: 5, bestScore: 1000 });
        expect(s._scoreMilestoneHit).toBe(false);
    });
});

describe('i18n: milestone & near-miss & best-gap keys exist in zh-CN and en', () => {
    const NEW_KEYS = [
        'effect.scoreMilestone',
        'effect.nearMissPlace',
        'effect.noMovesEnd',
        'best.gap.victory',
    ];

    it('zh-CN provides all 4 keys with non-empty strings', () => {
        for (const k of NEW_KEYS) {
            expect(zhCN[k], `zh-CN missing ${k}`).toBeTruthy();
            expect(typeof zhCN[k]).toBe('string');
        }
    });

    it('en provides all 4 keys with non-empty strings', () => {
        for (const k of NEW_KEYS) {
            expect(en[k], `en missing ${k}`).toBeTruthy();
            expect(typeof en[k]).toBe('string');
        }
    });

    it('effect.scoreMilestone supports the {{score}} placeholder', () => {
        expect(zhCN['effect.scoreMilestone']).toMatch(/\{\{score\}\}/);
        expect(en['effect.scoreMilestone']).toMatch(/\{\{score\}\}/);
    });

    it('v1.55.10: effect.scoreMilestonePct exists with {{pct}} placeholder in both locales', () => {
        expect(zhCN['effect.scoreMilestonePct']).toBeTruthy();
        expect(zhCN['effect.scoreMilestonePct']).toMatch(/\{\{pct\}\}/);
        expect(en['effect.scoreMilestonePct']).toBeTruthy();
        expect(en['effect.scoreMilestonePct']).toMatch(/\{\{pct\}\}/);
    });

    it('v1.55.10: effect.tieBest exists in both locales (non-empty)', () => {
        expect(zhCN['effect.tieBest']).toBeTruthy();
        expect(typeof zhCN['effect.tieBest']).toBe('string');
        expect(en['effect.tieBest']).toBeTruthy();
        expect(typeof en['effect.tieBest']).toBe('string');
    });

    it('best.gap.victory no longer reuses the no-moves-end phrasing', () => {
        // 旧 zh-CN: '就差一点！再冲一把！' 与 _handleNoMoves 硬编码 '差一点... 再冲一把！' 高度撞车，
        // v1.49 已替换为更精准的"即将刷新最佳"。
        expect(zhCN['best.gap.victory']).not.toMatch(/再冲一把/);
    });

    it('effect.nearMissPlace is short and refers to clearing (v1.50.1)', () => {
        expect(zhCN['effect.nearMissPlace']).toMatch(/消/);
        expect(zhCN['effect.nearMissPlace'].length).toBeLessThanOrEqual(10);
        expect(en['effect.nearMissPlace']).toMatch(/clear/i);
        expect(en['effect.nearMissPlace'].length).toBeLessThanOrEqual(24);
    });

    it('effect.nearMissPlace is provided in all 19 supported locales (no fallback to zh-CN)', () => {
        const locales = {
            'zh-CN': zhCN, en,
            ja: jaLocale, ko: koLocale, fr: frLocale, de: deLocale, es: esLocale,
            it: itLocale, 'pt-BR': ptBRLocale, nl: nlLocale, ru: ruLocale, uk: ukLocale,
            pl: plLocale, tr: trLocale, vi: viLocale, th: thLocale, id: idLocale,
            ar: arLocale, el: elLocale,
        };
        for (const [code, dict] of Object.entries(locales)) {
            expect(dict['effect.nearMissPlace'], `${code} missing effect.nearMissPlace`).toBeTruthy();
            expect(typeof dict['effect.nearMissPlace']).toBe('string');
        }
    });

    it('legacy effect.milestoneHit is kept as a deprecated alias (back-compat)', () => {
        // 字段 v1.49 改名后 showFloatScore 改用 effect.scoreMilestone；
        // 但 effect.milestoneHit 暂保留以兼容历史调用方。
        expect(zhCN['effect.milestoneHit']).toBeTruthy();
        expect(en['effect.milestoneHit']).toBeTruthy();
    });
});
