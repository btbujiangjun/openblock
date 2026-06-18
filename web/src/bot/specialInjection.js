/**
 * bot/specialInjection.js — 特殊块注入状态机（v1.70 从 blockSpawn.js 抽出）
 *
 * 单一职责：根据 hints.spawnIntent + 盘面信号，**最多注入 1 个特殊块**到 dock 三连中。
 *   12 个特殊小块仅在对应"阶段"下生效：
 *     - Relief 减压（intent='relief'）：清屏 / 完美卡入 / 消行 / 同色 / 填洞 5 类触发
 *     - Pressure 加压（intent='pressure'|'sprint'）：制造空洞（diag-2/3 散点）
 *   节流：间隔 ≥5 轮 + 全局上限 max(totalClears×10%, 3) + 子配额 (relief/pressure 各自)
 *   注入后调 BS.validateSpawnTriplet 复校，全失败则放弃返回 null。
 *
 * 拆分动因：
 *   - 519 行单一函数，是 blockSpawn 内最大可独立单元
 *   - 完全显式参数化（triplet/chosenMeta/hints/ctx/grid/fill/topo/pcSetup/scored/opts）
 *   - 内部仅依赖 blockSpawn export 的几何/校验/常量函数，无主管线词法闭包依赖
 *
 * 循环 import 说明：
 *   本模块 import { ... } from './blockSpawn.js'；blockSpawn.js 也 import 本模块。
 *   ESM 顶层只声明函数与 import，运行期才解引用 → 双方链接完成后调用安全。
 *
 * **行为契约**：行为与抽出前严格一致（黄金快照 18 个 / 540 三连样本守护）。
 */

import { defaultRng } from '../lib/seededRng.js';
import { getAllShapes } from '../shapes.js';
import * as _BS_ESM from './blockSpawn.js';

/* 循环依赖处理策略（双轨）：
 *   1. ESM 端（web/cocos .mjs）：`import * as _BS_ESM from './blockSpawn.js'` 走 namespace
 *      live binding，函数运行期访问 `_BS_ESM.xxx` 必然就绪。
 *   2. CJS 端（miniprogram .js）：sync 转译器把 export 收集到文件末尾的一次性
 *      `module.exports = {...}` reassign，循环 require 拿到的旧 exports 永远拿不到 patch。
 *      → 调用方（generateDockShapes 内）必须显式注入 helpers；缺 helpers 时回退 lazy require。
 *
 * 三种 helper 来源优先级：
 *   (a) 调用方注入的 helpers 参数（最快，blockSpawn.js 主路径用）
 *   (b) ESM namespace _BS_ESM（web/cocos 端可用）
 *   (c) 同步 require('./blockSpawn')（miniprogram 端外部直调路径） */
function _resolveBS(injected) {
    if (injected) return injected;
    if (_BS_ESM && typeof _BS_ESM._resolveSpecialPools === 'function') return _BS_ESM;
    /* lazy require：miniprogram CJS 端，外部直调时主模块已加载完成 */
    try {
        // eslint-disable-next-line no-undef
        if (typeof require === 'function') return require('./blockSpawn');
    } catch { /* fall through */ }
    return null;
}

export function _tryInjectSpecial(triplet, chosenMeta, hints, ctx, grid, fill, topo, pcSetup, scored, opts, helpers) {
    const rng = typeof opts?.rng === 'function' ? opts.rng : defaultRng;
    const BS = _resolveBS(helpers);
    /* 极端情况：所有 helper 解析路径都失败 → 保守 fail-open（与抽出前 try/catch 哲学一致）。 */
    if (!BS || typeof BS._resolveSpecialPools !== 'function') return null;

    /* v1.60.6 缺口 #5：信号侧用 enclosedVoidCells（玩家心智小空腔）替代 coverable holes，
     * 与 UI / spawnGeo 同口径——这样 bot 判断"加压会不会让局面太糟"和玩家直觉一致。
     * topo 若没有 enclosedVoidCells（旧调用方），降级到 coverable holes。 */
    const holesSignal = Number.isFinite(topo?.enclosedVoidCells)
        ? topo.enclosedVoidCells
        : (topo?.holes ?? 0);

    /* === Step 1：减压/加压条件评估（v1.60.44 阶段绑定 + 三类触发分级） ===
     *
     * **设计契约（用户 v1.60.44 诉求）**：
     *   12 个特殊小块仅在对应"阶段"下生效：
     *     - **Relief 减压阶段**（`intent === 'relief'`，priority 100，由 intentResolver 派生）
     *       承接三类触发，按优先级排序：
     *         (1) 清屏       — `pcSetup >= 1`         （最强信号：盘面接近 PC）
     *         (2) 完美卡入   — `scored.exactFit >= 0.999` （shape 几何 100% 嵌入）
     *         (3) 消行(低优) — `scored.multiClear >= 1` ，且 chosen 自身无 multiClear
     *                          （低优先级：chosen 主路径已能消行时让位，避免双重铺垫）
     *       monoFlush 是"同色消行"的特殊形态，归并入 (3) 子触发，但不受
     *       "chosen 无 multiClear" 压制——它的 ×5 倍 iconBonus 价值不可替代。
     *
     *     - **Pressure 强加压阶段**（`intent ∈ {'pressure', 'sprint'}`）
     *       承接单一触发：**制造空洞**——diag-2/3 散点形状专为"低填充期播种孤洞"设计。
     *       - `pressure`（priority 70）= challengeBoost>0 ∨ delightMode='challenge_payoff'+stress≥0.55
     *       - `sprint`（priority 60）= stress ∈ [0.45, 0.55) 渐紧过渡带（玩家主动选自虐）
     */
    const skin = ctx?.skin ?? null;
    const monoFlushLines = (typeof grid.findNearFullMonoLines === 'function')
        ? grid.findNearFullMonoLines(skin)
        : [];
    /* v1.60.29：L2 注入路径检查 chosen 中已有 monoFlush 块 — 若已有则关闭 monoFlushSignal，
     * 与 Stage 1/Stage 2 限制一致（单 dock monoFlush ≤ 1，避免视觉单调 + 彩蛋过载）。 */
    const chosenAlreadyHasMonoFlush = (chosenMeta || []).some(m => (m?.monoFlush ?? 0) >= 1);
    const monoFlushSignal = !chosenAlreadyHasMonoFlush && monoFlushLines.length > 0;

    /* v1.60.38：monoFlush 注入命中受 MONO_FLUSH_PICK_PROBABILITY 节流。
     * `monoFlushRound=false` 时即使真模拟通过也降级为 'special-relief'（不标 monoFlush 字段）。 */
    const allowMonoFlushLabel = opts ? opts.monoFlushRound !== false : true;

    const intent = hints?.spawnIntent;
    const isReliefPhase = intent === 'relief';
    const isSprint = intent === 'sprint';
    const isPressureIntent = isSprint || intent === 'pressure';

    /* v1.60.44 三类 relief 触发分级（仅在 isReliefPhase 下评估） */
    const hasClearSetup = pcSetup >= 1;
    const hasExactFitSetup = Array.isArray(scored)
        && scored.some(s => (s?.exactFit ?? 0) >= 0.999);
    /* 消行触发"低优先级"语义形式化：chosen 主路径若已能消行（≥1 块 multiClear≥1），
     * 单独的消行触发不再激活 —— 让位给主路径的高价值消行候选 */
    const chosenHasMultiClear = (chosenMeta || []).some(m => (m?.multiClear ?? 0) >= 1);
    const hasMultiClearScored = Array.isArray(scored)
        && scored.some(s => (s?.multiClear ?? 0) >= 1);
    const multiClearLowPriorityActive = hasMultiClearScored && !chosenHasMultiClear;

    /* 触发分类（用于 audit trail，DFV 可展开 "为什么注入" 因果链） */
    let reliefTrigger = null;
    if (isReliefPhase) {
        if (hasClearSetup) reliefTrigger = 'pcSetup';                  /* 清屏（最强） */
        else if (hasExactFitSetup) reliefTrigger = 'exactFit';          /* 完美卡入 */
        else if (monoFlushSignal) reliefTrigger = 'monoFlush';          /* 同色消行（彩蛋） */
        else if (multiClearLowPriorityActive) reliefTrigger = 'multiClear'; /* 消行（低优先级） */
        /* v1.60.47（契约 A）：填补空洞——无上述清行机会、但盘面已有 ≥2 空洞时，
         * 注入能减洞的灵活小块（最低优先级，让位给一切"能直接消行/同花"的机会）。 */
        else if (holesSignal >= BS.RELIEF_HOLE_FILL_MIN) reliefTrigger = 'holeFill';
    }
    const reliefSignal = reliefTrigger != null;

    /* pressure 强加压阶段：单一触发 = "制造空洞"。
     * roomForHoles 限制 fill<0.45（盘面足够空才有意义播种孤洞），
     * notAlreadyFullOfHoles 限制 holesSignal<4（避免雪上加霜）。 */
    const roomForHoles = fill < 0.45;
    const notAlreadyFullOfHoles = holesSignal < 4;
    const pressureSignal = isPressureIntent && roomForHoles && notAlreadyFullOfHoles;

    /* v1.60.44 阶段绑定后的优先级矩阵 */
    let isRelief = false;
    let isPressure = false;
    if (isPressureIntent && pressureSignal) {
        isPressure = true;
    } else if (isReliefPhase && reliefSignal) {
        isRelief = true;
    }

    if (!isRelief && !isPressure) return null;

    /* === Step 1.5：v1.60.7 新开局 warmup 保护（前 5 轮绝不注入） === */
    const totalRounds = ctx?.totalRounds;
    if (Number.isFinite(totalRounds) && totalRounds < 5) return null;

    /* === Step 1.7：v1.60.7 fill 下限保护 ===
     * v1.60.46（P1）：relief 下限按救济紧迫度分级。 */
    const reliefFillFloor = (hints?.reliefUrgent === false)
        ? BS.RELIEF_FILL_FLOOR_MILD
        : BS.RELIEF_FILL_FLOOR_URGENT;
    if (isRelief && fill < reliefFillFloor) return null;
    if (isPressure && fill < 0.10) return null;

    /* === Step 1.8：v1.60.8 清盘候选保护（单步可达兜底） === */
    if (isRelief && chosenMeta.some(m => (m?.pcPotential ?? 0) >= 2)) {
        return null;
    }

    /* === Step 1.85：v1.60.9 多步可达清盘保护 === */
    if (isRelief && (pcSetup ?? 0) >= 1) {
        if (BS.canTripletPerfectClear(grid, triplet, { budget: 8000 })) {
            return null;
        }
    }

    /* === Step 1.86：v1.60.37 → v1.60.44 chosen 已具强消行能力时兜底抑制 relief === */
    if (isRelief && reliefTrigger !== 'monoFlush') {
        const chosenMultiClearCount = chosenMeta.filter(m => (m?.multiClear ?? 0) >= 1).length;
        if (chosenMultiClearCount >= 2) {
            return null;
        }
    }

    /* === Step 2：节流（间隔 + 双层上限） === */
    if ((ctx.roundsSinceSpecial ?? 0) < 5) return null;

    const globalUsed = ctx.specialShapeUsed ?? 0;
    const globalLimit = Math.max(Math.floor((ctx.totalClears ?? 0) * 0.1), 3);
    if (globalUsed >= globalLimit) return null;

    /* v1.60.6：解析覆写（默认 SPECIAL_RELIEF/PRESSURE_SHAPES + SPECIAL_SHAPE_WEIGHTS） */
    const pools = BS._resolveSpecialPools(ctx);
    const totalClears = ctx.totalClears ?? 0;
    /* θ-I (v3.2 节奏/special 组)：缩放 relief / pressure special 块的注入配额。 */
    const _mcSpecial = ctx.modelConfig || {};
    const _reliefQuotaGain = Number.isFinite(_mcSpecial.specialReliefQuotaGain) ? _mcSpecial.specialReliefQuotaGain : 1.0;
    const _pressureQuotaGain = Number.isFinite(_mcSpecial.specialPressureQuotaGain) ? _mcSpecial.specialPressureQuotaGain : 1.0;
    const reliefSubLimit = Math.max(Math.floor(totalClears * pools.reliefLimitFactor * _reliefQuotaGain), 2);
    const pressureSubLimit = Math.max(Math.floor(totalClears * pools.pressureLimitFactor * _pressureQuotaGain), 2);

    const subUsed = isRelief
        ? (ctx.specialReliefUsed ?? 0)
        : (ctx.specialPressureUsed ?? 0);
    const subLimit = isRelief ? reliefSubLimit : pressureSubLimit;
    if (subUsed >= subLimit) return null;

    /* === Step 3：候选池（按可放置过滤 + 形状权重排序，v1.60.6 缺口 #2） === */
    const pool = isRelief ? pools.relief : pools.pressure;
    const allShapes = getAllShapes();
    const candidates = allShapes.filter(
        s => pool.includes(s.id) && grid.canPlaceAnywhere(s.data)
    );
    if (candidates.length === 0) return null;

    /* 加权抽签排序：连续 N 次 BS.pickWeighted（不重复抽），形成"按权重期望"的尝试序列。 */
    const weighted = candidates
        .map(s => ({ shape: s, w: Math.max(1, pools.weights[s.id] ?? 1) }));
    let candidateOrder = [];
    const remaining = weighted.slice();
    while (remaining.length > 0) {
        const picked = BS.pickWeighted(remaining, rng);
        candidateOrder.push(picked.shape);
        const idx = remaining.indexOf(picked);
        if (idx >= 0) remaining.splice(idx, 1);
    }

    /* v1.60.23：monoFlush 触发时，方向 + 尺寸匹配的小竖/横块优先尝试。 */
    if (monoFlushSignal) {
        const targetIds = new Set();
        for (const line of monoFlushLines) {
            if (line.empty !== 2) continue;
            const cs = line.emptyCells;
            const adjacent = (line.type === 'row' && Math.abs(cs[0].x - cs[1].x) === 1)
                || (line.type === 'col' && Math.abs(cs[0].y - cs[1].y) === 1);
            if (!adjacent) continue;
            targetIds.add(line.type === 'row' ? '1x2' : '2x1');
        }
        if (targetIds.size > 0) {
            const priority = candidateOrder.filter(s => targetIds.has(s.id));
            const rest = candidateOrder.filter(s => !targetIds.has(s.id));
            candidateOrder = [...priority, ...rest];
        }
    }

    /* v1.60.46（P2）：非 monoFlush 的 relief 触发也按缺口朝向偏置候选。 */
    if (isRelief && !monoFlushSignal) {
        if (reliefTrigger === 'holeFill') {
            /* v1.60.47（契约 A）：填补空洞触发——按"放下能减掉多少已有空洞"降序排候选。 */
            const baseHoles = topo?.holes ?? 0;
            const reduceScore = new Map(
                candidateOrder.map(s => [s.id, BS.bestHoleReduction(grid, s.data, baseHoles)])
            );
            candidateOrder = candidateOrder.slice()
                .sort((a, b) => (reduceScore.get(b.id) ?? 0) - (reduceScore.get(a.id) ?? 0));
        } else {
            /* P2：清行类触发（pcSetup/exactFit/multiClear）按近满行/列缺口朝向偏置候选。 */
            const gapIds = BS._reliefGapShapeIds(grid);
            if (gapIds.length > 0) {
                const gapSet = new Set(gapIds);
                const priority = gapIds
                    .map(id => candidateOrder.find(s => s.id === id))
                    .filter(Boolean);
                const rest = candidateOrder.filter(s => !gapSet.has(s.id));
                candidateOrder = [...priority, ...rest];
            }
        }
    }

    /* v1.60.47（契约 B）→ v1.68：加压"制造空洞 / 增加难度"，主动选择。
     * SPECIAL_SHAPE_WEIGHTS 第一档主 key + BS._pressureHoleForcing 同权重档内择朝向。 */
    if (isPressure) {
        const cellCount = (data) => data.reduce((sum, row) => sum + row.reduce((a, v) => a + (v ? 1 : 0), 0), 0);
        const forceScore = new Map(
            candidateOrder.map(s => [s.id, BS._pressureHoleForcing(grid, s.data)])
        );
        candidateOrder = candidateOrder.slice().sort((a, b) => {
            const wa = Math.max(1, pools.weights[a.id] ?? 1);
            const wb = Math.max(1, pools.weights[b.id] ?? 1);
            if (wa !== wb) return wb - wa;
            const d = (forceScore.get(b.id) ?? 0) - (forceScore.get(a.id) ?? 0);
            if (d !== 0) return d;
            const pa = BS.countLegalPlacements(grid, a.data);
            const pb = BS.countLegalPlacements(grid, b.data);
            if (pa !== pb) return pa - pb;
            return cellCount(b.data) - cellCount(a.data);
        });
    }

    /* === Step 4：智能 replaceIdx（Issue 6 + v1.60.8 槽保护增强） === */
    const slotPriority = chosenMeta.slice(0, 3).map((m, i) => ({
        idx: i,
        score: (m?.pcPotential ?? 0) * 4
             + (m?.multiClear  ?? 0) * 2
             + (m?.gapFills    ?? 0)
             + ((m?.placements ?? 0) / 50),
    }))
        .filter(s => (chosenMeta[s.idx]?.pcPotential ?? 0) < 2)
        .sort((a, b) => a.score - b.score);

    if (slotPriority.length === 0) return null;

    /* === Step 5：候选 × 槽位 双层枚举 + 注入后复校（Issue 1） === */
    for (const candidate of candidateOrder) {
        for (const { idx: replaceIdx } of slotPriority) {
            const newTriplet = [...triplet];
            const newMeta = [...chosenMeta];

            const originalShape = newTriplet[replaceIdx];
            const originalMeta = newMeta[replaceIdx];

            newTriplet[replaceIdx] = candidate;
            /* v1.60.38：monoFlush 命中判定从"看 id"改为"真模拟"（避免 labeling 撒谎）。 */
            const isMonoFlushSizeCandidate = isRelief && monoFlushSignal && allowMonoFlushLabel
                && (candidate.id === '1x2' || candidate.id === '2x1');
            let injMonoFlushCount = 0;
            let injMonoFlushTargetCi = null;
            if (isMonoFlushSizeCandidate && typeof grid.bestMonoFlushPotential === 'function') {
                const res = grid.bestMonoFlushPotential(candidate.data, ctx?.skin || null, { returnTarget: true });
                injMonoFlushCount = res?.count || 0;
                injMonoFlushTargetCi = Number.isInteger(res?.targetCi) ? res.targetCi : null;
            }
            const isMonoFlushCandidate = injMonoFlushCount >= 1;
            newMeta[replaceIdx] = {
                shape: candidate,
                placements: BS.countLegalPlacements(grid, candidate.data),
                reason: isMonoFlushCandidate
                    ? 'special-monoFlush'
                    : (isRelief ? 'special-relief' : 'special-pressure'),
                topDriver: isMonoFlushCandidate
                    ? { key: 'monoFlush', label: `补满同色${injMonoFlushCount}线` }
                    : { key: isRelief ? 'relief' : 'pressure', label: isRelief ? '特殊减压' : '特殊加压' },
                monoFlush: isMonoFlushCandidate ? injMonoFlushCount : 0,
                monoFlushTargetCi: isMonoFlushCandidate ? injMonoFlushTargetCi : null,
                original: originalShape,
                originalMeta: { reason: originalMeta?.reason, topDriver: originalMeta?.topDriver },
                injectedAt: replaceIdx,
                subType: isRelief
                    ? (isMonoFlushCandidate ? 'monoFlush' : 'relief')
                    : 'pressure',
                spawnCtx: {
                    fill: Number.isFinite(fill) ? Number(fill.toFixed(3)) : null,
                    pcSetup: pcSetup ?? 0,
                    holesSignal,
                    totalRounds,
                    intent: intent ?? null,
                    reliefTrigger: isRelief ? reliefTrigger : null,
                    monoFlushLines: monoFlushSignal
                        ? monoFlushLines.map(l => ({ type: l.type, idx: l.idx, empty: l.empty }))
                        : null,
                },
            };

            /* Issue 1：注入后复校（任一硬约束失败 → 下一槽 / 下一 candidate） */
            const validation = BS.validateSpawnTriplet(grid, newTriplet);
            if (validation?.ok) {
                /* Bug C 修复（v1.60.37）：事后复算"块实际能消行"，避免 DFV labeling 与块真实能力背离。
                 * monoFlush 例外保留独立 reason。 */
                if (!isMonoFlushCandidate) {
                    const injMc = BS.bestMultiClearPotential(grid, candidate.data);
                    if (injMc >= 1) {
                        newMeta[replaceIdx].reason = 'clear';
                        newMeta[replaceIdx].topDriver = { key: 'clear', label: `可消${injMc}行` };
                        newMeta[replaceIdx].multiClear = injMc;
                        newMeta[replaceIdx].reasonUpgradedFrom = isRelief
                            ? 'special-relief'
                            : 'special-pressure';
                    }
                }
                return {
                    triplet: newTriplet,
                    chosenMeta: newMeta,
                    isRelief,
                    injected: candidate.id,
                    replaceIdx,
                    subType: newMeta[replaceIdx].subType,
                    spawnCtx: newMeta[replaceIdx].spawnCtx,
                    reliefTrigger: isRelief ? reliefTrigger : null,
                };
            }
        }
    }

    /* 所有 candidate × 所有 replaceIdx 都校验失败：放弃注入 */
    return null;
}
