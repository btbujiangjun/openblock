/**
 * commitSpawnContext 跨端 parity 契约测试
 * =========================================
 *
 * 锁定 web/miniprogram/cocos 三端共享的「出块 commit 段」纯字段维护行为：
 *   1. web `_commitSpawn` → import 自 `web/src/spawn/commitSpawnContext.js`
 *   2. mini `_commitSpawnContext` → require 自 `miniprogram/core/spawn/commitSpawnContext.js`
 *      （由 scripts/sync-core.sh 从同源生成，ESM→CJS 转换后语义不变）
 *   3. cocos `engineSpawn` → import 自 `cocos/assets/scripts/engine/spawn/commitSpawnContext.mjs`
 *      （由 scripts/sync-cocos-engine.mjs 从同源生成，仅做 .js→.mjs 与 shared/JSON 改写）
 *
 * 本测试既验证「同 ctx 在两端走完 commit 后 ctx 字段严格相等」，也锁定关键不变量：
 *   - 含 SPECIAL_SHAPES → `roundsSinceSpecial=0`
 *   - 构造 setup 交付 → `pendingClearTarget` 透传 + `constructCooldown` 跳到 cooldownDocks
 *   - 构造 completer 交付 → `pendingClearTarget=null` + cooldown 重置
 *   - 无构造交付 → cooldown 自然 −−（不归零）
 *
 * 防回归点：上一次发生过两次同型 bug：
 *   (1) v1.60.x cocos 漏归零 roundsSinceSpecial → diag-3 连出
 *   (2) v1.67  mini/cocos 漏维护 constructCooldown/pendingClearTarget → 构造冷却失效
 * 任何一次"web 改 commit 段，sync 脚本/调用方漏跟进"都会让本测试失红。
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { commitSpawnContext as commitWeb } from '../web/src/spawn/commitSpawnContext.js';
import { SPECIAL_SHAPES } from '../web/src/bot/blockSpawn.js';
import { GAME_RULES } from '../web/src/gameRules.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeRequire = createRequire(import.meta.url);
const cjsCache = new Map();

/* 简化版 requireCjs（与 tests/miniprogramCore.test.js 同源 helper）：
 * 小程序 commitSpawnContext 是 CJS（`require()`），项目根 package.json 为 `type: "module"`，
 * 不能用 ESM `import` / `createRequire` 直接加载——CommonJS 文件被 ESM loader 误识别会抛
 * `require is not defined in ES module scope`。这里用 vm runInThisContext 手动注入
 * exports/require/module 三元组。 */
function resolveCjs(request, basedir = __dirname) {
    if (!request.startsWith('.')) return request;
    const base = path.resolve(basedir, request);
    const candidates = [`${base}.js`, `${base}.json`, base, path.join(base, 'index.js')];
    const match = candidates.find((p) => {
        try { return fs.existsSync(p) && fs.statSync(p).isFile(); } catch { return false; }
    });
    if (!match) throw new Error(`Cannot resolve ${request} from ${basedir}`);
    return match;
}
function requireCjs(request, basedir = __dirname) {
    const filename = resolveCjs(request, basedir);
    if (!path.isAbsolute(filename)) return nodeRequire(filename);
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

const { commitSpawnContext: commitMini } = requireCjs('../miniprogram/core/spawn/commitSpawnContext.js');

/** 构造典型出块 commit 场景的辅助。返回新对象，避免跨用例污染。 */
function makeCtx(overrides = {}) {
    return {
        totalRounds: 7,
        roundsSinceSpecial: 4,
        scoreMilestone: true,
        prevAdaptiveStress: 0.123,
        _occupancyFillAnchor: 0.45,
        nearFullLines: 0, pcSetup: 0, holes: 0,
        multiClearCandidates: 0, perfectClearCandidates: 0,
        constructCooldown: 0,
        pendingClearTarget: null,
        ...overrides,
    };
}
function makeLayered(overrides = {}) {
    return { _adaptiveStressRaw: 0.55, _occupancyFillAnchor: 0.62, ...overrides };
}
function makeDiag(overrides = {}) {
    return {
        layer1: {
            nearFullLines: 2, pcSetup: 1, holes: 3,
            multiClearCandidates: 5, perfectClearCandidates: 1,
        },
        constructive: null,
        ...overrides,
    };
}

describe('commitSpawnContext 三端 parity', () => {
    /** 通用断言：web/mini 两个实现修改后的 ctx 完全相等（深比较）。 */
    function expectParity(scenarioName, { shapes, layered, diagnostics }) {
        const ctxW = makeCtx();
        const ctxM = makeCtx();
        commitWeb({ ctx: ctxW, shapes, layered, diagnostics });
        commitMini({ ctx: ctxM, shapes, layered, diagnostics });
        expect(ctxW, `[${scenarioName}] web vs mini ctx 不一致`).toEqual(ctxM);
        return ctxW;
    }

    it('普通出块（无 special / 无构造）：totalRounds++ / scoreMilestone=false / L1 回写 / cooldown 不动', () => {
        // 注：l3-a 在 SPECIAL_RELIEF_SHAPES 里 → 会触发 roundsSinceSpecial=0；
        // 为本场景"无 special"语义，用 3 个普通块。
        const cleanShapes = [{ id: '2x2' }, { id: 'I3' }, { id: 'I4' }];
        const ctx = expectParity('normal-spawn', {
            shapes: cleanShapes,
            layered: makeLayered(),
            diagnostics: makeDiag(),
        });

        expect(ctx.totalRounds).toBe(8);              // 7 → 8
        expect(ctx.roundsSinceSpecial).toBe(4);       // 不含 special → 不归零
        expect(ctx.scoreMilestone).toBe(false);       // 栈底重置
        expect(ctx.prevAdaptiveStress).toBe(0.55);
        expect(ctx._occupancyFillAnchor).toBe(0.62);
        expect(ctx.nearFullLines).toBe(2);
        expect(ctx.pcSetup).toBe(1);
        expect(ctx.holes).toBe(3);
        expect(ctx.multiClearCandidates).toBe(5);
        expect(ctx.perfectClearCandidates).toBe(1);
        expect(ctx.constructCooldown).toBe(0);
        expect(ctx.pendingClearTarget).toBeNull();
    });

    it('含 SPECIAL_SHAPES → roundsSinceSpecial=0（深度防御：调用方兜底归零）', () => {
        // 用真实的 SPECIAL_SHAPES 元素，避免引擎升级时硬编码漂移。
        const special = SPECIAL_SHAPES[0];
        const ctx = expectParity('with-special', {
            shapes: [{ id: special }, { id: 'I3' }, { id: '2x2' }],
            layered: makeLayered(),
            diagnostics: makeDiag(),
        });
        expect(ctx.roundsSinceSpecial).toBe(0);
    });

    it('构造 setup 交付：constructCooldown=cooldownDocks / pendingClearTarget 透传', () => {
        const cooldownDocks = GAME_RULES?.adaptiveSpawn?.constructiveSpawn?.cooldownDocks ?? 0;
        const target = { type: 'row', y: 5 };
        const ctx = expectParity('construct-setup', {
            shapes: [{ id: '2x2' }, { id: 'I3' }, { id: 'I4' }],
            layered: makeLayered(),
            diagnostics: makeDiag({
                constructive: { delivered: true, kind: 'setup', pendingClearTarget: target },
            }),
        });
        expect(ctx.constructCooldown).toBe(cooldownDocks);
        expect(ctx.pendingClearTarget).toEqual(target);
    });

    it('构造 completer 交付：constructCooldown=cooldownDocks / pendingClearTarget 清空', () => {
        const cooldownDocks = GAME_RULES?.adaptiveSpawn?.constructiveSpawn?.cooldownDocks ?? 0;
        const ctxW = makeCtx({ pendingClearTarget: { type: 'col', x: 3 } });
        const ctxM = makeCtx({ pendingClearTarget: { type: 'col', x: 3 } });
        const args = {
            shapes: [{ id: '2x2' }, { id: 'I3' }, { id: 'I4' }],
            layered: makeLayered(),
            diagnostics: makeDiag({
                constructive: { delivered: true, kind: 'completer', pendingClearTarget: null },
            }),
        };
        commitWeb({ ctx: ctxW, ...args });
        commitMini({ ctx: ctxM, ...args });
        expect(ctxW).toEqual(ctxM);
        expect(ctxW.constructCooldown).toBe(cooldownDocks);
        expect(ctxW.pendingClearTarget).toBeNull();
    });

    it('无构造交付：constructCooldown 自然 −−（不归零、不重置）', () => {
        const ctxW = makeCtx({ constructCooldown: 3 });
        const ctxM = makeCtx({ constructCooldown: 3 });
        const args = {
            shapes: [{ id: '2x2' }, { id: 'I3' }, { id: 'I4' }],
            layered: makeLayered(),
            diagnostics: makeDiag({ constructive: { delivered: false } }),
        };
        commitWeb({ ctx: ctxW, ...args });
        commitMini({ ctx: ctxM, ...args });
        expect(ctxW).toEqual(ctxM);
        expect(ctxW.constructCooldown).toBe(2); // 3 −−
        expect(ctxW.pendingClearTarget).toBeNull();
    });

    it('layered 缺 _adaptiveStressRaw / _occupancyFillAnchor → 保留 ctx 原值（不写 NaN）', () => {
        const ctx = expectParity('partial-layered', {
            shapes: [{ id: '2x2' }, { id: 'I3' }, { id: 'I4' }],
            layered: {}, // 空 layered，模拟极端 fallback 路径
            diagnostics: makeDiag(),
        });
        expect(ctx.prevAdaptiveStress).toBe(0.123); // 原值保留
        expect(ctx._occupancyFillAnchor).toBe(0.45);
    });

    it('diagnostics=null → 不抛错；L1 字段保留原值；constructCooldown 仍自然 −−', () => {
        const ctxW = makeCtx({ constructCooldown: 2, nearFullLines: 9 });
        const ctxM = makeCtx({ constructCooldown: 2, nearFullLines: 9 });
        const args = {
            shapes: [{ id: '2x2' }, { id: 'I3' }, { id: 'I4' }],
            layered: makeLayered(),
            diagnostics: null,
        };
        expect(() => commitWeb({ ctx: ctxW, ...args })).not.toThrow();
        expect(() => commitMini({ ctx: ctxM, ...args })).not.toThrow();
        expect(ctxW).toEqual(ctxM);
        expect(ctxW.nearFullLines).toBe(9);          // 原值保留
        expect(ctxW.constructCooldown).toBe(1);      // 2 −−
    });

    it('totalRounds 严格 +1（防"重复 ++" 漂移：cocos 旧版尾部 ++ 与共享函数 ++ 撞车的复发护栏）', () => {
        const baseline = 100;
        const ctx = expectParity('totalRounds-monotonic', {
            shapes: [{ id: '2x2' }, { id: 'I3' }, { id: 'I4' }],
            layered: makeLayered(),
            diagnostics: makeDiag(),
        });
        const ctxAgain = makeCtx({ totalRounds: baseline });
        commitWeb({
            ctx: ctxAgain,
            shapes: [{ id: '2x2' }, { id: 'I3' }, { id: 'I4' }],
            layered: makeLayered(),
            diagnostics: makeDiag(),
        });
        expect(ctxAgain.totalRounds).toBe(baseline + 1);
        // 同时反向锁定上面的"普通出块"用例：7 → 8 而非 9。
        expect(ctx.totalRounds).toBe(8);
    });
});
