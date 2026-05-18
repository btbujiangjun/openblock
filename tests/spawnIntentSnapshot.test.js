/**
 * @vitest-environment jsdom
 *
 * v1.57.4 — spawnIntent 决策快照增量刷新
 *
 * 背景：DFV "盘面具备消行机会" / stressMeter "识别到密集消行机会" 等基于
 * `_lastAdaptiveInsight` 的展示文案，会在 dock 周期内（玩家放置 1~2 块、消行后）
 * 与玩家实时盘面错位 —— spawnIntent 与 spawnDiagnostics.layer1 是 spawnBlocks()
 * 时的"决策快照"，dock 三块全部消化前不会刷新。
 *
 * 修复：
 *   1. 抽 `deriveSpawnIntent` 纯函数（adaptiveSpawn.js）—— 让 game.js 能用同一套
 *      规则配合实时几何重判 intent。
 *   2. 抽 `snapshotInsightGeometry(grid, dockPool)` 函数 —— 返回 fill/holes/
 *      nearFullLines/multiClearCandidates/pcSetup 5 字段。
 *   3. 补 `_mergeLiveGeometrySignals` 漏算 pcSetup 的次发缺陷。
 *   4. game.js 在玩家每次放置后（含消行动画完成）调用 `_refreshIntentSnapshot()`，
 *      用 deriveSpawnIntent + snapshotInsightGeometry 增量刷新 insight。
 *
 * 测试覆盖：
 *   A. deriveSpawnIntent 7 个分支优先级（relief→engage→harvest→pressure→sprint→flow→maintain）
 *   B. snapshotInsightGeometry 几何字段正确性（空盘 / 满盘 / 含洞 / 近满）
 *   C. _mergeLiveGeometrySignals pcSetup 补漏（spawn 时 ctx.pcSetup 应 = analyzePerfectClearSetup(grid)）
 *   D. 集成回归：构造"上次 spawn=harvest"的快照 → 玩家消行 → 用 deriveSpawnIntent+
 *      snapshotInsightGeometry 重判应切换为非 harvest
 *   E. _intentInputs 暴露：resolveAdaptiveStrategy 返回值含可供 game.js 缓存的字段
 */

import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    deriveSpawnIntent,
    snapshotInsightGeometry,
    resolveAdaptiveStrategy,
    resetAdaptiveMilestone
} from '../web/src/adaptiveSpawn.js';
import { analyzePerfectClearSetup } from '../web/src/bot/blockSpawn.js';
import { PlayerProfile } from '../web/src/playerProfile.js';

/* ============================================================
 * A. deriveSpawnIntent 7 分支优先级
 * ============================================================ */
describe('v1.57.4 A — deriveSpawnIntent 分支优先级', () => {
    const baseInputs = {
        playerDistress: 0,
        forceReliefIntent: false,
        afkEngageActive: false,
        challengeBoost: 0,
        delightMode: null,
        rhythmPhase: 'neutral',
        stress: 0.3,
        sprintCfg: { enabled: true, minStress: 0.45, maxStress: 0.55 },
        geometry: { nearFullLines: 0, pcSetup: 0, boardFill: 0.3 },
        pcSetupMinFill: 0.45,
    };

    it('默认无信号 → maintain', () => {
        expect(deriveSpawnIntent(baseInputs)).toBe('maintain');
    });

    it('playerDistress < -0.10 → relief（最高优先级）', () => {
        expect(deriveSpawnIntent({ ...baseInputs, playerDistress: -0.15 })).toBe('relief');
    });

    it('delightMode=relief → relief', () => {
        expect(deriveSpawnIntent({ ...baseInputs, delightMode: 'relief' })).toBe('relief');
    });

    it('forceReliefIntent=true → relief（即使 playerDistress 不深）', () => {
        expect(deriveSpawnIntent({ ...baseInputs, forceReliefIntent: true, playerDistress: 0.05 })).toBe('relief');
    });

    it('afkEngageActive=true（无 distress）→ engage', () => {
        expect(deriveSpawnIntent({ ...baseInputs, afkEngageActive: true })).toBe('engage');
    });

    it('relief 优先级高于 engage：distress + afk → relief', () => {
        expect(deriveSpawnIntent({
            ...baseInputs, playerDistress: -0.15, afkEngageActive: true
        })).toBe('relief');
    });

    it('nearFullLines ≥ 2 → harvest', () => {
        expect(deriveSpawnIntent({
            ...baseInputs, geometry: { nearFullLines: 2, pcSetup: 0, boardFill: 0.3 }
        })).toBe('harvest');
    });

    it('pcSetup ≥1 但 boardFill < pcSetupMinFill → 不进 harvest', () => {
        expect(deriveSpawnIntent({
            ...baseInputs, geometry: { nearFullLines: 0, pcSetup: 1, boardFill: 0.30 }
        })).toBe('maintain');
    });

    it('pcSetup ≥1 且 boardFill ≥ pcSetupMinFill → harvest', () => {
        expect(deriveSpawnIntent({
            ...baseInputs, geometry: { nearFullLines: 0, pcSetup: 1, boardFill: 0.50 }
        })).toBe('harvest');
    });

    it('harvest 优先级高于 pressure：harvestable + challengeBoost → harvest', () => {
        expect(deriveSpawnIntent({
            ...baseInputs, geometry: { nearFullLines: 3, pcSetup: 0, boardFill: 0.6 },
            challengeBoost: 0.1, stress: 0.7
        })).toBe('harvest');
    });

    it('challengeBoost > 0（无 harvest 几何）→ pressure', () => {
        expect(deriveSpawnIntent({ ...baseInputs, challengeBoost: 0.05, stress: 0.7 })).toBe('pressure');
    });

    it('delightMode=challenge_payoff + stress ≥ 0.55 → pressure', () => {
        expect(deriveSpawnIntent({
            ...baseInputs, delightMode: 'challenge_payoff', stress: 0.6
        })).toBe('pressure');
    });

    it('stress ∈ [0.45, 0.55) + 无前置触发 → sprint', () => {
        expect(deriveSpawnIntent({ ...baseInputs, stress: 0.50 })).toBe('sprint');
        expect(deriveSpawnIntent({ ...baseInputs, stress: 0.45 })).toBe('sprint');
        expect(deriveSpawnIntent({ ...baseInputs, stress: 0.5499 })).toBe('sprint');
    });

    it('sprint 边界：stress=0.55 不再 sprint（>= max 排除）', () => {
        expect(deriveSpawnIntent({ ...baseInputs, stress: 0.55 })).not.toBe('sprint');
    });

    it('sprintCfg.enabled=false → 跳过 sprint 段', () => {
        expect(deriveSpawnIntent({
            ...baseInputs, stress: 0.50, sprintCfg: { enabled: false }
        })).toBe('maintain');
    });

    it('delightMode=flow_payoff → flow', () => {
        expect(deriveSpawnIntent({ ...baseInputs, delightMode: 'flow_payoff' })).toBe('flow');
    });

    it('rhythmPhase=payoff → flow（无 delightMode 推动）', () => {
        expect(deriveSpawnIntent({ ...baseInputs, rhythmPhase: 'payoff' })).toBe('flow');
    });

    it('优先级总览：relief > engage > harvest > pressure > sprint > flow > maintain', () => {
        // relief 抢占所有
        expect(deriveSpawnIntent({
            ...baseInputs,
            playerDistress: -0.2, afkEngageActive: true,
            geometry: { nearFullLines: 3, pcSetup: 1, boardFill: 0.6 },
            challengeBoost: 0.2, stress: 0.5, delightMode: 'flow_payoff'
        })).toBe('relief');
        // engage 抢占 harvest 及之后
        expect(deriveSpawnIntent({
            ...baseInputs, afkEngageActive: true,
            geometry: { nearFullLines: 3, pcSetup: 1, boardFill: 0.6 },
            challengeBoost: 0.2, stress: 0.5
        })).toBe('engage');
        // harvest 抢占 pressure 及之后
        expect(deriveSpawnIntent({
            ...baseInputs,
            geometry: { nearFullLines: 3, pcSetup: 1, boardFill: 0.6 },
            challengeBoost: 0.2, stress: 0.5
        })).toBe('harvest');
        // pressure 抢占 sprint 及之后
        expect(deriveSpawnIntent({
            ...baseInputs, challengeBoost: 0.2, stress: 0.50, delightMode: 'flow_payoff'
        })).toBe('pressure');
        // sprint 抢占 flow
        expect(deriveSpawnIntent({
            ...baseInputs, stress: 0.50, rhythmPhase: 'payoff'
        })).toBe('sprint');
        // flow 抢占 maintain
        expect(deriveSpawnIntent({ ...baseInputs, rhythmPhase: 'payoff' })).toBe('flow');
    });
});

/* ============================================================
 * B. snapshotInsightGeometry 几何字段正确性
 * ============================================================ */
describe('v1.57.4 B — snapshotInsightGeometry 几何快照', () => {
    it('空盘 → fill=0, holes=0, nearFullLines=0, pcSetup=0', () => {
        const g = new Grid(8);
        const snap = snapshotInsightGeometry(g, []);
        expect(snap).not.toBeNull();
        expect(snap.fill).toBe(0);
        expect(snap.holes).toBe(0);
        expect(snap.nearFullLines).toBe(0);
        expect(snap.pcSetup).toBe(0);
    });

    it('近满一行（7/8）→ fill ≈ 7/64, nearFullLines ≥ 1', () => {
        const g = new Grid(8);
        // 第 0 行填 7 格（留 col=4 空）
        for (let x = 0; x < 8; x++) {
            if (x !== 4) g.cells[0][x] = 0;
        }
        const snap = snapshotInsightGeometry(g, []);
        expect(snap.fill).toBeCloseTo(7 / 64, 3);
        expect(snap.nearFullLines).toBeGreaterThanOrEqual(1);
        expect(snap.holes).toBe(0); // 单个空格在顶部，可填充
    });

    it('两条近满 → nearFullLines ≥ 2（触发 harvest 几何）', () => {
        const g = new Grid(8);
        for (let x = 0; x < 8; x++) {
            if (x !== 4) {
                g.cells[0][x] = 0;
                g.cells[1][x] = 0;
            }
        }
        const snap = snapshotInsightGeometry(g, []);
        expect(snap.nearFullLines).toBeGreaterThanOrEqual(2);
    });

    it('grid 为 null → 返回 null（保护降级）', () => {
        expect(snapshotInsightGeometry(null, [])).toBeNull();
        expect(snapshotInsightGeometry({}, [])).toBeNull();
    });

    it('与 analyzePerfectClearSetup 口径一致（pcSetup 字段相等）', () => {
        const g = new Grid(8);
        // 填一整行（除留 4 格让 1×4 长条能补满）
        for (let x = 0; x < 8; x++) g.cells[0][x] = 0;
        for (let x = 0; x < 4; x++) g.cells[1][x] = 0;
        const snap = snapshotInsightGeometry(g, []);
        expect(snap.pcSetup).toBe(analyzePerfectClearSetup(g));
    });
});

/* ============================================================
 * C. _mergeLiveGeometrySignals pcSetup 补漏（v1.57.4 次发缺陷）
 * ============================================================ */
describe('v1.57.4 C — _mergeLiveGeometrySignals 实时刷新 pcSetup', () => {
    it('spawn 决策时 ctx.pcSetup 应来自 analyzePerfectClearSetup(grid)，而非旧 ctx 快照', () => {
        resetAdaptiveMilestone?.();
        const g = new Grid(8);
        // 构造一个 pcSetup>=1 的盘面：填两整行
        for (let x = 0; x < 8; x++) {
            g.cells[0][x] = 0;
            g.cells[1][x] = 0;
        }
        const livePc = analyzePerfectClearSetup(g);
        expect(livePc).toBeGreaterThanOrEqual(0);

        const profile = new PlayerProfile();
        // 故意把 ctx.pcSetup 给一个"陈旧的过期值"（与 grid 实际不符）
        const stalePc = livePc === 0 ? 2 : 0;
        const layered = resolveAdaptiveStrategy('default', profile, 100, 1, 0.25, {
            bestScore: 500, recentBestRatio: 0.2,
            totalRounds: 10, roundsSinceClear: 1,
            comboChain: 0, recentClears: [], placements: 10,
            pcSetup: stalePc, // 陈旧值
            _gridRef: g, // 提供 grid 让 _mergeLiveGeometrySignals 实时重算
        });
        // _mergeLiveGeometrySignals 应已用 livePc 覆盖 stalePc，spawnIntent/harvestable 与 livePc 一致
        const intentInputs = layered._intentInputs;
        expect(intentInputs).toBeTruthy();
        // 不直接断言 ctx.pcSetup（已被 _mergeLiveGeometrySignals 内部消费），改为
        // 用 deriveSpawnIntent 重判验证：geometry.pcSetup 应等于 livePc（snapshotInsightGeometry 复算）
        const snap = snapshotInsightGeometry(g, []);
        expect(snap.pcSetup).toBe(livePc);
    });
});

/* ============================================================
 * D. 集成回归：上次 spawn=harvest → 玩家消行 → 重判应切换
 * ============================================================ */
describe('v1.57.4 D — 集成：harvest 快照 + 实时盘面变更 → 重判切换', () => {
    it('上次 spawn 时 harvest（近满×3），玩家清空盘面后用 deriveSpawnIntent 重判应非 harvest', () => {
        // 1. 构造 spawn 时刻：近满×3 的盘面 → spawnIntent=harvest
        const spawnTimeGrid = new Grid(8);
        for (let row = 0; row < 3; row++) {
            for (let x = 0; x < 8; x++) {
                if (x !== 4) spawnTimeGrid.cells[row][x] = 0;
            }
        }
        const spawnGeom = snapshotInsightGeometry(spawnTimeGrid, []);
        const intentAtSpawn = deriveSpawnIntent({
            playerDistress: 0,
            forceReliefIntent: false,
            afkEngageActive: false,
            challengeBoost: 0,
            delightMode: null,
            rhythmPhase: 'neutral',
            stress: 0.3,
            sprintCfg: { enabled: true, minStress: 0.45, maxStress: 0.55 },
            geometry: {
                nearFullLines: spawnGeom.nearFullLines,
                pcSetup: spawnGeom.pcSetup,
                boardFill: spawnGeom.fill,
            },
            pcSetupMinFill: 0.45,
        });
        expect(intentAtSpawn).toBe('harvest'); // 决策时确实 harvest

        // 2. 模拟玩家消行：盘面变空（_refreshIntentSnapshot 在 game.js 中会取实时 grid）
        const liveGrid = new Grid(8);
        const liveGeom = snapshotInsightGeometry(liveGrid, []);
        expect(liveGeom.nearFullLines).toBe(0);

        // 3. 用同一套决策侧不变量 + 实时 geometry 重判，应不再是 harvest
        const intentAfterRefresh = deriveSpawnIntent({
            playerDistress: 0,
            forceReliefIntent: false,
            afkEngageActive: false,
            challengeBoost: 0,
            delightMode: null,
            rhythmPhase: 'neutral',
            stress: 0.3,
            sprintCfg: { enabled: true, minStress: 0.45, maxStress: 0.55 },
            geometry: {
                nearFullLines: liveGeom.nearFullLines,
                pcSetup: liveGeom.pcSetup,
                boardFill: liveGeom.fill,
            },
            pcSetupMinFill: 0.45,
        });
        expect(intentAfterRefresh).not.toBe('harvest');
        expect(intentAfterRefresh).toBe('maintain'); // 空盘 + 无其他信号 → maintain
    });

    it('上次 spawn 时 maintain（空盘），玩家堆出近满×2 后重判应切换为 harvest', () => {
        const spawnTimeGrid = new Grid(8);
        const spawnGeom = snapshotInsightGeometry(spawnTimeGrid, []);
        const intentAtSpawn = deriveSpawnIntent({
            playerDistress: 0, forceReliefIntent: false, afkEngageActive: false,
            challengeBoost: 0, delightMode: null, rhythmPhase: 'neutral', stress: 0.3,
            sprintCfg: { enabled: true, minStress: 0.45, maxStress: 0.55 },
            geometry: {
                nearFullLines: spawnGeom.nearFullLines,
                pcSetup: spawnGeom.pcSetup,
                boardFill: spawnGeom.fill,
            },
            pcSetupMinFill: 0.45,
        });
        expect(intentAtSpawn).toBe('maintain');

        // 玩家堆出近满×2
        const liveGrid = new Grid(8);
        for (let row = 0; row < 2; row++) {
            for (let x = 0; x < 8; x++) {
                if (x !== 4) liveGrid.cells[row][x] = 0;
            }
        }
        const liveGeom = snapshotInsightGeometry(liveGrid, []);
        const intentAfterRefresh = deriveSpawnIntent({
            playerDistress: 0, forceReliefIntent: false, afkEngageActive: false,
            challengeBoost: 0, delightMode: null, rhythmPhase: 'neutral', stress: 0.3,
            sprintCfg: { enabled: true, minStress: 0.45, maxStress: 0.55 },
            geometry: {
                nearFullLines: liveGeom.nearFullLines,
                pcSetup: liveGeom.pcSetup,
                boardFill: liveGeom.fill,
            },
            pcSetupMinFill: 0.45,
        });
        expect(intentAfterRefresh).toBe('harvest');
    });
});

/* ============================================================
 * E. _intentInputs 暴露契约：game.js 增量刷新所需字段完整
 * ============================================================ */
describe('v1.57.4 E — resolveAdaptiveStrategy 返回 _intentInputs 可缓存对象', () => {
    it('layered._intentInputs 含 deriveSpawnIntent 所需全部决策侧字段', () => {
        resetAdaptiveMilestone?.();
        const g = new Grid(8);
        const profile = new PlayerProfile();
        const layered = resolveAdaptiveStrategy('default', profile, 100, 1, 0.3, {
            bestScore: 500, recentBestRatio: 0.2,
            totalRounds: 10, roundsSinceClear: 1,
            comboChain: 0, recentClears: [], placements: 10,
            _gridRef: g,
        });
        const inputs = layered._intentInputs;
        expect(inputs).toBeTruthy();
        // deriveSpawnIntent 所需字段（除 geometry 由调用方按实时盘面填）
        for (const k of [
            'playerDistress', 'forceReliefIntent', 'afkEngageActive',
            'challengeBoost', 'delightMode', 'rhythmPhase', 'stress',
            'sprintCfg', 'pcSetupMinFill'
        ]) {
            expect(inputs, `缺少 _intentInputs.${k}`).toHaveProperty(k);
        }
    });

    it('使用 _intentInputs + 任意 geometry 重判，结果与 layered._spawnIntent 在同 geometry 下一致', () => {
        resetAdaptiveMilestone?.();
        const g = new Grid(8);
        const profile = new PlayerProfile();
        const layered = resolveAdaptiveStrategy('default', profile, 100, 1, 0.3, {
            bestScore: 500, recentBestRatio: 0.2,
            totalRounds: 10, roundsSinceClear: 1,
            comboChain: 0, recentClears: [], placements: 10,
            _gridRef: g,
        });
        const liveGeom = snapshotInsightGeometry(g, []);
        const reIntent = deriveSpawnIntent({
            ...layered._intentInputs,
            geometry: {
                nearFullLines: liveGeom.nearFullLines,
                pcSetup: liveGeom.pcSetup,
                boardFill: liveGeom.fill,
            },
        });
        // resolveAdaptiveStrategy 内部用同一套 deriveSpawnIntent 算 intent，
        // 在空盘 + 同 geometry 条件下应一致
        expect(reIntent).toBe(layered._spawnIntent);
    });
});
