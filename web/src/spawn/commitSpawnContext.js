/**
 * commitSpawnContext.js —— 三端共享的「出块 commit 段」纯逻辑闭包。
 *
 * 背景：web `_commitSpawn` / 小程序 `_commitSpawnContext` / Cocos `engineSpawn` commit
 * 段长期由各端独立维护字段（totalRounds、roundsSinceSpecial、constructCooldown、
 * pendingClearTarget、L1 棋盘特征回写、prevAdaptiveStress、scoreMilestone 重置 …），
 * 一旦 web 主端新增字段就会出现"小程序/Android 漏接"型 bug——已发生过两次：
 *   1) v1.60.x：cocos `engineSpawn` 漏归零 `roundsSinceSpecial` → diag-3 连出
 *   2) v1.67  ：mini/cocos 漏维护 `constructCooldown/pendingClearTarget` → 构造式喂解冷却失效
 *
 * 本模块把"纯 ctx 字段维护"那段抽出，三端 commit 段统一调用 commitSpawnContext()，
 * UI/profile/DB 写入仍由各端自身负责（视觉层、玩家画像、本地持久化不可共享）。
 *
 * 设计原则：
 *   - 纯函数（in-place 修改传入 ctx；返回 void），无 import 副作用、无 DOM/uni/小程序 API 依赖；
 *   - 调用方时序：必须在 `generateDockShapes()` 完成、且本轮 dock 形状已落定（shapes 数组就位）
 *     之后调用，使内部能读 `getLastSpawnDiagnostics()` 的 constructive / layer1；
 *   - 幂等性：引擎 `_tryInjectSpecial` 成功分支已同址归零 `roundsSinceSpecial`，本函数再次
 *     置 0 等价无 op；保留作为深度防御，并兼容旧 fallback 路径（不走引擎的兜底 shape）。
 */

import { SPECIAL_SHAPES } from '../bot/blockSpawn.js';
import { GAME_RULES } from '../gameRules.js';

/**
 * 三端共享的 commit 段纯逻辑：维护跨轮 ctx 字段。
 *
 * @param {object} params
 * @param {object} params.ctx           - 跨轮 spawnContext（web `_spawnContext` / mini `_spawnContext` / cocos engineSpawn 闭包 `ctx`）
 * @param {Array<{id:string}>} params.shapes - 本轮最终交付给 dock 的形状数组（已经过 fisherYates 打乱）
 * @param {object|null} params.layered  - resolveAdaptiveStrategy 产出，需要其 `_adaptiveStressRaw` / `_occupancyFillAnchor`
 * @param {object|null} [params.diagnostics] - getLastSpawnDiagnostics() 结果；由调用方传入以避免本模块再 require
 *                                              引擎闭包（保持 0 副作用 import 链）。
 */
export function commitSpawnContext({ ctx, shapes, layered, diagnostics }) {
    if (!ctx) return;

    /* === 1. totalRounds++ ===
     * 与 web `_commitSpawn:2439` 同址。仅在出块成功后推进；失败重试链不消费此计数，
     * 保证 lifecycle_stage 分桶与寻参 v2 context_key 严格对齐。 */
    ctx.totalRounds = (ctx.totalRounds | 0) + 1;

    /* === 2. roundsSinceSpecial=0（含 SPECIAL_SHAPES）===
     * 引擎 `_tryInjectSpecial` 成功分支已同址归零（v1.60.x 根因清理）；此处作为深度
     * 防御，覆盖"不走引擎的 fallback 路径（如 sanitizeDockShapes 兜底 / 模型直出）"。 */
    if (Array.isArray(shapes) && shapes.some((s) => s && SPECIAL_SHAPES.includes(s.id))) {
        ctx.roundsSinceSpecial = 0;
    }

    /* === 3. scoreMilestone 栈底重置 ===
     * spawnBlocks 入口已根据 layered.spawnHints.scoreMilestone 桥接到 ctx；
     * 本轮使用完后清为 false，保证下一轮重新由 hints 决定，不留隔轮残留。 */
    ctx.scoreMilestone = false;

    /* === 4. prevAdaptiveStress 写 raw 域 ===
     * 与 adaptiveSpawn.smoothStress 的 raw 域 [-0.2, 1] 单位一致；
     * 详见 adaptiveSpawn.js 顶部 normalizeStress JSDoc。 */
    if (layered && Number.isFinite(layered._adaptiveStressRaw)) {
        ctx.prevAdaptiveStress = layered._adaptiveStressRaw;
    }

    /* === 5. _occupancyFillAnchor 持久化 ===
     * 低 fill 场景下"沿用历史高占用锚点"信号；下一轮 adaptiveSpawn 内 occupancyDamping
     * 据此延迟撤销减压。 */
    if (layered && Number.isFinite(layered._occupancyFillAnchor)) {
        ctx._occupancyFillAnchor = layered._occupancyFillAnchor;
    }

    /* === 6. L1 棋盘特征回写 ===
     * 来自 blockSpawn 内部 lastSpawnDiagnostics，供下一轮 friendlyBoardRelief /
     * frustrationRelief 等信号读取。diagnostics 为可选项，缺失静默跳过。 */
    const l1 = diagnostics && diagnostics.layer1;
    if (l1) {
        ctx.nearFullLines           = l1.nearFullLines           | 0;
        ctx.pcSetup                 = l1.pcSetup                 | 0;
        ctx.holes                   = l1.holes                   | 0;
        ctx.multiClearCandidates    = l1.multiClearCandidates    | 0;
        ctx.perfectClearCandidates  = l1.perfectClearCandidates  | 0;
    }

    /* === 7. v1.67 构造式跨 dock 状态机 ===
     *   - constructCooldown：每 dock 递减；构造块（C1/C2/order）交付后置 cooldownDocks，
     *     接下来 N dock 不再强供，避免「系统连发喂解」的脚本感。
     *   - pendingClearTarget：C2 setup 交付则记录目标线（下一 dock 优先兑现）；
     *     completer/order 交付（已兑现）或本 dock 未续接则清空。 */
    const cons = diagnostics && diagnostics.constructive;
    const cd = Math.max(0, Number(ctx.constructCooldown) || 0);
    ctx.constructCooldown = cd > 0 ? cd - 1 : 0;
    if (cons && cons.delivered) {
        const cdSet = Math.max(0, Number(GAME_RULES?.adaptiveSpawn?.constructiveSpawn?.cooldownDocks) || 0);
        ctx.constructCooldown = cdSet;
        if (cons.kind === 'setup' && cons.pendingClearTarget) {
            ctx.pendingClearTarget = cons.pendingClearTarget;
        } else {
            /* completer 交付 = 目标已兑现；清空待办，避免对已消除的线反复续接。 */
            ctx.pendingClearTarget = null;
        }
    }
}
