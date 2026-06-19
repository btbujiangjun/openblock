/**
 * @vitest-environment node
 *
 * moveSequence 补充测试：buildPlayerStateSnapshot / collectReplayMetricsSeries /
 * formatMetricValue / countPlaceStepsInFrames 边界
 */
import { describe, it, expect } from 'vitest';
import { Grid } from '../web/src/grid.js';
import {
    buildInitFrame,
    buildSpawnFrame,
    buildPlaceFrame,
    buildPlayerStateSnapshot,
    buildReplayAnalysis,
    countPlaceStepsInFrames,
    displayScoreFromReplayFrames,
    collectReplayMetricsSeries,
    formatMetricValue,
    formatPlayerStateForReplay,
    getMetricFromPS,
    getFrameElapsedMs,
    extractFrameTimestamps,
    MOVE_SEQUENCE_SCHEMA,
    PLAYER_STATE_SNAPSHOT_VERSION
} from '../web/src/moveSequence.js';
import { PlayerProfile } from '../web/src/playerProfile.js';

const scoring = { singleLine: 10, multiLine: 30, combo: 50 };

describe('buildPlayerStateSnapshot', () => {
    it('produces a snapshot with required fields', () => {
        const profile = new PlayerProfile(10);
        const ctx = {
            score: 100,
            boardFill: 0.4,
            runStreak: 1,
            strategyId: 'normal',
            phase: 'spawn',
            adaptiveInsight: null
        };
        const ps = buildPlayerStateSnapshot(profile, ctx);
        expect(ps.pv).toBe(PLAYER_STATE_SNAPSHOT_VERSION);
        expect(ps.pv).toBe(5);
        expect(ps.phase).toBe('spawn');
        expect(ps.score).toBe(100);
        expect(typeof ps.skill).toBe('number');
        expect(typeof ps.momentum).toBe('number');
        expect(typeof ps.flowState).toBe('string');
    });

    it('includes adaptive data when provided', () => {
        const profile = new PlayerProfile(10);
        const ctx = {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal',
            phase: 'init',
            adaptiveInsight: { stress: 0.3, flowDeviation: 0.1 }
        };
        const ps = buildPlayerStateSnapshot(profile, ctx);
        expect(ps.adaptive).toBeDefined();
        expect(ps.adaptive.stress).toBe(0.3);
    });

    // v1.63 / pv=3：PB 相对进度基线
    it('写入 bestScore 并推导 pbRatio=score/bestScore（best<=0 时 pbRatio=null）', () => {
        const profile = new PlayerProfile(10);
        const base = { boardFill: 0, runStreak: 0, strategyId: 'normal', phase: 'spawn', adaptiveInsight: null };
        const ps = buildPlayerStateSnapshot(profile, { ...base, score: 300, bestScore: 1000 });
        expect(ps.bestScore).toBe(1000);
        expect(ps.pbRatio).toBeCloseTo(0.3, 6);
        // 首局 best=0 → bestScore=null、pbRatio=null（避免除零）
        const ps0 = buildPlayerStateSnapshot(profile, { ...base, score: 300, bestScore: 0 });
        expect(ps0.bestScore).toBeNull();
        expect(ps0.pbRatio).toBeNull();
    });

    // v1.63 / pv=3：近消行拓扑落库（dataset behaviorContext[28-30] 此前恒 0）
    it('spawnGeo 写入 nearFullLines/close1/close2/maxColHeight', () => {
        const profile = new PlayerProfile(10);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0.2, runStreak: 0, strategyId: 'normal', phase: 'spawn',
            adaptiveInsight: null,
            spawnGeo: { holes: 1, nearFullLines: 3, close1: 2, close2: 1, maxColHeight: 5 }
        });
        expect(ps.spawnGeo.nearFullLines).toBe(3);
        expect(ps.spawnGeo.close1).toBe(2);
        expect(ps.spawnGeo.close2).toBe(1);
        expect(ps.spawnGeo.maxColHeight).toBe(5);
    });

    // v1.63 / pv=3：逐 spawn 策略来源（provenance）
    it('当 adaptiveInsight.provenance 存在时拷贝到快照', () => {
        const profile = new PlayerProfile(10);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal', phase: 'spawn',
            adaptiveInsight: { stress: 0.1, provenance: { spawnSource: 'model-v3', fallbackReason: null } }
        });
        expect(ps.provenance).toEqual({ spawnSource: 'model-v3', fallbackReason: null });
    });

    // v1.13 / pv=2 冷启动隔离
    it('冷启动帧：metrics 数值字段为 null，coldStart=true，samples=0', () => {
        const profile = new PlayerProfile(10);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal',
            phase: 'init', adaptiveInsight: null
        });
        expect(ps.coldStart).toBe(true);
        expect(ps.cognitiveLoadHasData).toBe(false);
        expect(ps.cognitiveLoad).toBeNull();
        expect(ps.metrics.samples).toBe(0);
        expect(ps.metrics.activeSamples).toBe(0);
        expect(ps.metrics.thinkMs).toBeNull();
        expect(ps.metrics.clearRate).toBeNull();
        expect(ps.metrics.comboRate).toBeNull();
        expect(ps.metrics.missRate).toBeNull();
    });

    it('落子≥3 之后：coldStart=false，metrics 全为有限数值', () => {
        const profile = new PlayerProfile(10);
        for (let i = 0; i < 4; i++) profile.recordPlace(true, 1, 0.3);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 40, boardFill: 0.3, runStreak: 0, strategyId: 'normal',
            phase: 'place', adaptiveInsight: null
        });
        expect(ps.coldStart).toBe(false);
        expect(ps.cognitiveLoadHasData).toBe(true);
        expect(typeof ps.cognitiveLoad).toBe('number');
        expect(ps.metrics.samples).toBeGreaterThanOrEqual(4);
        expect(typeof ps.metrics.thinkMs).toBe('number');
        expect(typeof ps.metrics.clearRate).toBe('number');
    });
});

describe('formatPlayerStateForReplay 冷启动徽标', () => {
    it('pv=2 冷启动帧带 🌱 前缀，思考/消行率显「—」', () => {
        const profile = new PlayerProfile(10);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal',
            phase: 'init', adaptiveInsight: null
        });
        const txt = formatPlayerStateForReplay(ps);
        expect(txt).toContain('🌱 冷启动');
        expect(txt).toContain('思考 —ms');
        expect(txt).toContain('消行率 —');
    });

    it('落子后无 🌱 徽标，思考/消行率显示真实数值', () => {
        const profile = new PlayerProfile(10);
        for (let i = 0; i < 4; i++) profile.recordPlace(true, 1, 0.3);
        const ps = buildPlayerStateSnapshot(profile, {
            score: 40, boardFill: 0.3, runStreak: 0, strategyId: 'normal',
            phase: 'place', adaptiveInsight: null
        });
        const txt = formatPlayerStateForReplay(ps);
        expect(txt).not.toContain('🌱 冷启动');
        expect(txt).not.toContain('思考 —ms');
    });

    it('pv=1 旧记录的占位组合（thinkMs=3000 + clearRate=0.3）按启发式标记为冷启动', () => {
        const legacyPs = {
            phase: 'init', score: 0, boardFill: 0,
            metrics: { thinkMs: 3000, clearRate: 0.3, comboRate: 0.1, missRate: 0.1 }
        };
        expect(formatPlayerStateForReplay(legacyPs)).toContain('🌱 冷启动');
    });

    /* 相位保护链路：落库 schema 自检——insight.relativity.* 必须穿透 buildPlayerStateSnapshot 的
     * slim.adaptive.relativity，pv≥5，且旧 insight 缺字段时 slim 端自动 null/false。 */
    describe('相位保护链路 落库 schema (pv=5+)', () => {
        const _baseInsight = {
            stress: 0.5, fillRatio: 0.2, skillLevel: 0.5,
            relativity: {
                enabled: true, bypass: null, lambda: 0.3,
                dStar: 0.5, objectiveTarget: { spatial: 0.5, combo: 0.5, order: 0.5, recovery: 0.5, tempo: 0.5, clearEff: 0.5 },
                latent: { confidence: 0.6, n: 10 }, latentCalibration: null,
                chosen: { chosenAlign: 0.9, candidatesConsidered: 4, chosenVec: null },
            },
        };

        it('新插入 4 字段端到端：intent/phaseGeomGain/earlyPhaseCapHit/peogYieldHits 落入 slim', () => {
            const profile = new PlayerProfile(10);
            const insight = {
                ..._baseInsight,
                relativity: {
                    ..._baseInsight.relativity,
                    intent: 'prior_only',
                    phaseGeomGain: 0.5,
                    earlyPhaseCapHit: true,
                    peogYieldHits: { bottleneckHits: 1, nearMissHits: 0, bypassReason: null },
                },
            };
            const ps = buildPlayerStateSnapshot(profile, {
                score: 100, boardFill: 0.2, runStreak: 0, strategyId: 'normal',
                phase: 'spawn', adaptiveInsight: insight,
            });
            expect(ps.adaptive.relativity.intent).toBe('prior_only');
            expect(ps.adaptive.relativity.phaseGeomGain).toBe(0.5);
            expect(ps.adaptive.relativity.earlyPhaseCapHit).toBe(true);
            expect(ps.adaptive.relativity.peogYieldHits).toEqual({
                bottleneckHits: 1, nearMissHits: 0, bypassReason: null,
            });
        });

        it('insight 缺新字段（如旧 game.js 写入路径）→ slim 端补 null/false（向后兼容）', () => {
            const profile = new PlayerProfile(10);
            const ps = buildPlayerStateSnapshot(profile, {
                score: 100, boardFill: 0.2, runStreak: 0, strategyId: 'normal',
                phase: 'spawn', adaptiveInsight: _baseInsight,
            });
            expect(ps.adaptive.relativity.intent).toBeNull();
            expect(ps.adaptive.relativity.phaseGeomGain).toBeNull();
            expect(ps.adaptive.relativity.earlyPhaseCapHit).toBe(false);
            expect(ps.adaptive.relativity.peogYieldHits).toBeNull();
        });
    });

    /* 相位保护链路：回放端必须把"对齐预算 / 几何衰减 / 前期上界 / PEOG 抗抖动"
     * 四类相位语义可读化，让设计师/QA 直接从一帧回放看出"系统当时在做什么"。
     * 旧帧（无 relativity 或 enabled=false）不输出（向后兼容）。 */
    describe('相位保护链路 回放语义可读化', () => {
        const _base = {
            phase: 'spawn', score: 100, boardFill: 0.2,
            metrics: { thinkMs: 800, clearRate: 0.4, comboRate: 0.1, missRate: 0.05, samples: 10 },
        };

        it('enabled=false / 无 relativity → 不输出相对论段（向后兼容）', () => {
            expect(formatPlayerStateForReplay({ ..._base, adaptive: { stress: 0.5, relativity: { enabled: false } } }))
                .not.toContain('相对论');
            expect(formatPlayerStateForReplay({ ..._base, adaptive: { stress: 0.5 } }))
                .not.toContain('相对论');
        });

        it('相位化对齐预算 intent=prior_only → 回放显示"只对形状池微偏（顺玩家相位保爽消，禁评分挑选）"', () => {
            const ps = { ..._base, adaptive: { stress: 0.5, relativity: { enabled: true, intent: 'prior_only' } } };
            const txt = formatPlayerStateForReplay(ps);
            expect(txt).toContain('对齐预算');
            expect(txt).toContain('只对形状池微偏');
            expect(txt).toContain('顺玩家相位保爽消');
        });

        it('相位化对齐预算 intent=full → 显示"完整个性化（mid 段默认）"', () => {
            const ps = { ..._base, adaptive: { stress: 0.5, relativity: { enabled: true, intent: 'full' } } };
            expect(formatPlayerStateForReplay(ps)).toContain('完整个性化');
        });

        it('相位化对齐预算 intent=off + bypass=recovery → 显示"恒等标定，行为=未启用"', () => {
            const ps = { ..._base, adaptive: { stress: 0.3, relativity: { enabled: true, intent: 'off', bypass: 'recovery' } } };
            const txt = formatPlayerStateForReplay(ps);
            expect(txt).toContain('对齐预算=关');
            expect(txt).toContain('救济');
        });

        it('相位化几何增益 phaseGeomGain=0.3 → 显示"几何信号衰减×0.30（新手 0.3 / 温暖局 0.5）"', () => {
            const ps = { ..._base, adaptive: { stress: 0.3, relativity: { enabled: true, intent: 'off', phaseGeomGain: 0.3 } } };
            const txt = formatPlayerStateForReplay(ps);
            expect(txt).toContain('几何信号衰减×0.30');
        });

        it('相位化几何增益 phaseGeomGain=1.0 → 不输出衰减段（默认无衰减）', () => {
            const ps = { ..._base, adaptive: { stress: 0.5, relativity: { enabled: true, intent: 'full', phaseGeomGain: 1.0 } } };
            expect(formatPlayerStateForReplay(ps)).not.toContain('几何信号衰减');
        });

        it('b* 前期上界 earlyPhaseCapHit=true → 显示"b* 触前期上界（高 PB 玩家前期保护生效）"', () => {
            const ps = { ..._base, adaptive: { stress: 0.2, relativity: { enabled: true, intent: 'full', earlyPhaseCapHit: true } } };
            expect(formatPlayerStateForReplay(ps)).toContain('b* 触前期上界');
            expect(formatPlayerStateForReplay(ps)).toContain('高 PB 玩家前期保护生效');
        });

        it('PEOG 抗抖动 peogYieldHits.bottleneckHits>0 → 显示"PEOG 抗抖动累计 ... 连续 ≥ 阈值才让位"', () => {
            const ps = { ..._base, adaptive: { stress: 0.7, relativity: {
                enabled: true, intent: 'full',
                peogYieldHits: { bottleneckHits: 1, nearMissHits: 0, bypassReason: null }
            } } };
            const txt = formatPlayerStateForReplay(ps);
            expect(txt).toContain('PEOG 抗抖动累计 bottleneck=1');
            expect(txt).toContain('连续 ≥ 阈值才让位');
        });

        it('多档同时触发 → 单段内用 · 分隔，按 intent / 几何 / 上界 / PEOG 顺序', () => {
            const ps = { ..._base, adaptive: { stress: 0.2, relativity: {
                enabled: true, intent: 'prior_only',
                phaseGeomGain: 0.5, earlyPhaseCapHit: true,
                peogYieldHits: { bottleneckHits: 2, nearMissHits: 1, bypassReason: null },
            } } };
            const txt = formatPlayerStateForReplay(ps);
            const segLine = txt.split('\n').find((ln) => ln.startsWith('相对论 · '));
            expect(segLine).toBeTruthy();
            const i_intent = segLine.indexOf('对齐预算');
            const i_geom = segLine.indexOf('几何信号衰减');
            const i_cap = segLine.indexOf('b* 触前期上界');
            const i_peog = segLine.indexOf('PEOG 抗抖动');
            expect(i_intent).toBeGreaterThan(-1);
            expect(i_geom).toBeGreaterThan(i_intent);
            expect(i_cap).toBeGreaterThan(i_geom);
            expect(i_peog).toBeGreaterThan(i_cap);
        });
    });
});

describe('§4.17 难度相对论指标缺省值', () => {
    it('relativity 对象存在但部分诊断缺省时，玩家面板指标不显示空白', () => {
        const ps = {
            adaptive: {
                relativity: {
                    enabled: true,
                    lambda: null,
                    // chosenAlign / targetGap / thetaConfidence / phaseGeomGain / peogYieldHits / intent 故意缺省
                    earlyPhaseCapHit: false,
                },
            },
        };
        expect(getMetricFromPS(ps, 'relativityLambda')).toBe(0);
        expect(getMetricFromPS(ps, 'relativityAlign')).toBe(1);
        expect(getMetricFromPS(ps, 'relativityTargetGap')).toBe(0);
        expect(getMetricFromPS(ps, 'thetaConfidence')).toBe(0);
        expect(getMetricFromPS(ps, 'relativityIntent')).toBe(0);
        expect(getMetricFromPS(ps, 'phaseGeomGain')).toBe(1);
        expect(getMetricFromPS(ps, 'peogBottleneckHits')).toBe(0);
        expect(getMetricFromPS(ps, 'earlyPhaseCapHit')).toBe(0);
    });

    it('没有 relativity 对象时仍保持旧行为：指标无数据', () => {
        const ps = { adaptive: {} };
        expect(getMetricFromPS(ps, 'relativityLambda')).toBeNull();
        expect(getMetricFromPS(ps, 'relativityAlign')).toBeNull();
        expect(getMetricFromPS(ps, 'phaseGeomGain')).toBeNull();
    });
});

describe('buildReplayAnalysis 冷启动统计', () => {
    it('全部冷启动帧：coldFramesRatio=1，tags 含「冷启动样本偏多」', () => {
        const profile = new PlayerProfile(10);
        const grid = new Grid(8);
        const psCold = buildPlayerStateSnapshot(profile, {
            score: 0, boardFill: 0, runStreak: 0, strategyId: 'normal',
            phase: 'spawn', adaptiveInsight: null
        });
        const initFrame = buildInitFrame('normal', grid, scoring, psCold);
        const spawnFrame = buildSpawnFrame([], psCold);
        const analysis = buildReplayAnalysis([initFrame, spawnFrame], { score: 0 });
        expect(analysis.metrics.coldFrames).toBe(2);
        expect(analysis.metrics.coldFramesRatio).toBe(1);
        expect(analysis.metrics.firstWarmFrameIdx).toBeNull();
        expect(analysis.tags).toContain('冷启动样本偏多');
        expect(analysis.recommendations.some((r) => r.includes('冷启动占位状态'))).toBe(true);
    });

    it('热身后样本充足：coldFramesRatio=0、firstWarmFrameIdx 指向首帧', () => {
        const profile = new PlayerProfile(10);
        const grid = new Grid(8);
        for (let i = 0; i < 4; i++) profile.recordPlace(true, 1, 0.3);
        const psWarm = buildPlayerStateSnapshot(profile, {
            score: 40, boardFill: 0.3, runStreak: 0, strategyId: 'normal',
            phase: 'place', adaptiveInsight: null
        });
        const frames = [
            buildInitFrame('normal', grid, scoring, psWarm),
            buildSpawnFrame([], psWarm),
            buildPlaceFrame(0, 0, 0, psWarm)
        ];
        const analysis = buildReplayAnalysis(frames, { score: 40 });
        expect(analysis.metrics.coldFrames).toBe(0);
        expect(analysis.metrics.coldFramesRatio).toBe(0);
        expect(analysis.metrics.firstWarmFrameIdx).toBe(0);
        expect(analysis.tags).not.toContain('冷启动样本偏多');
    });
});

describe('countPlaceStepsInFrames edge cases', () => {
    it('null / undefined returns 0', () => {
        expect(countPlaceStepsInFrames(null)).toBe(0);
        expect(countPlaceStepsInFrames(undefined)).toBe(0);
    });

    it('empty array returns 0', () => {
        expect(countPlaceStepsInFrames([])).toBe(0);
    });

    it('only init+spawn returns 0', () => {
        const grid = new Grid(8);
        const frames = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([])
        ];
        expect(countPlaceStepsInFrames(frames)).toBe(0);
    });
});

describe('displayScoreFromReplayFrames edge cases', () => {
    it('null returns null', () => {
        expect(displayScoreFromReplayFrames(null)).toBeNull();
    });

    it('empty returns null', () => {
        expect(displayScoreFromReplayFrames([])).toBeNull();
    });

    it('frames without ps fallback to replayStateAt', () => {
        const grid = new Grid(8);
        const frames = [
            buildInitFrame('normal', grid, scoring),
            buildSpawnFrame([{ id: '1x1', shape: [[1]], colorIdx: 0, placed: false }]),
            buildPlaceFrame(0, 0, 0)
        ];
        const score = displayScoreFromReplayFrames(frames);
        expect(typeof score).toBe('number');
    });
});

describe('collectReplayMetricsSeries', () => {
    it('returns null for empty frames', () => {
        expect(collectReplayMetricsSeries([])).toBeNull();
        expect(collectReplayMetricsSeries(null)).toBeNull();
    });

    it('produces series data for frames with ps', () => {
        const grid = new Grid(8);
        const ps1 = { pv: 1, phase: 'init', score: 0, skill: 0.5, boardFill: 0, metrics: {} };
        const ps2 = { pv: 1, phase: 'spawn', score: 0, skill: 0.52, boardFill: 0.1, metrics: {} };
        const ps3 = { pv: 1, phase: 'place', score: 10, skill: 0.55, boardFill: 0.15, metrics: { clearRate: 0.5 } };
        const frames = [
            buildInitFrame('normal', grid, scoring, ps1),
            buildSpawnFrame([{ id: 'a', shape: [[1]], colorIdx: 0 }], ps2),
            buildPlaceFrame(0, 0, 0, ps3)
        ];
        const result = collectReplayMetricsSeries(frames);
        expect(result).not.toBeNull();
        expect(result.totalFrames).toBe(3);
        expect(result.series).toBeDefined();
        expect(result.series.score).toBeDefined();
        expect(result.series.score.points.length).toBeGreaterThan(0);
    });
});

describe('formatMetricValue', () => {
    it('int format', () => {
        expect(formatMetricValue(42, 'int')).toBe('42');
        expect(formatMetricValue(null, 'int')).toBe('—');
    });

    it('pct format', () => {
        const r = formatMetricValue(0.456, 'pct');
        expect(r).toBe('46%');
    });

    it('f2 format', () => {
        expect(formatMetricValue(0.1234, 'f2')).toBe('0.12');
    });
});

describe('getMetricFromPS', () => {
    it('extracts top-level field', () => {
        expect(getMetricFromPS({ score: 100 }, 'score')).toBe(100);
    });

    it('returns null for missing field', () => {
        expect(getMetricFromPS({}, 'score')).toBeNull();
    });
});

/* ============================================================
 * v1.62：frame.ts 时间戳 — schema 升级 + 提取工具
 * ============================================================ */

describe('MOVE_SEQUENCE_SCHEMA v2 / frame.ts', () => {
    const grid = new Grid(8);

    it('SCHEMA 升级到 2，承诺 frames 携带 ts 字段', () => {
        expect(MOVE_SEQUENCE_SCHEMA).toBe(2);
    });

    it('buildInitFrame 默认 ts=0（init 帧总是时间原点）', () => {
        const init = buildInitFrame('normal', grid, scoring);
        expect(init.v).toBe(2);
        expect(init.ts).toBe(0);
    });

    it('buildInitFrame 显式 ts 也被采纳；负数 / NaN / 非数 → 强制回退 0', () => {
        expect(buildInitFrame('normal', grid, scoring, undefined, { ts: 1234 }).ts).toBe(1234);
        expect(buildInitFrame('normal', grid, scoring, undefined, { ts: -5 }).ts).toBe(0);
        expect(buildInitFrame('normal', grid, scoring, undefined, { ts: NaN }).ts).toBe(0);
        expect(buildInitFrame('normal', grid, scoring, undefined, { ts: 'bad' }).ts).toBe(0);
    });

    it('buildSpawnFrame / buildPlaceFrame 未传 ts 时不写字段（保持与 v1 字节级兼容）', () => {
        const spawn = buildSpawnFrame([]);
        const place = buildPlaceFrame(0, 0, 0);
        expect('ts' in spawn).toBe(false);
        expect('ts' in place).toBe(false);
    });

    it('buildSpawnFrame / buildPlaceFrame 接受 ts 入参', () => {
        const spawn = buildSpawnFrame([], undefined, { ts: 1500 });
        const place = buildPlaceFrame(0, 0, 0, undefined, { ts: 2800 });
        expect(spawn.ts).toBe(1500);
        expect(place.ts).toBe(2800);
    });

    it('build*Frame 静默丢弃无效 ts（不写入错误时间戳）', () => {
        expect('ts' in buildSpawnFrame([], undefined, { ts: -1 })).toBe(false);
        expect('ts' in buildSpawnFrame([], undefined, { ts: NaN })).toBe(false);
        expect('ts' in buildPlaceFrame(0, 0, 0, undefined, { ts: 'oops' })).toBe(false);
    });

    it('ts 与 playerState 可并存（顺序无歧义）', () => {
        const ps = { pv: 2, phase: 'place', score: 42 };
        const place = buildPlaceFrame(0, 1, 2, ps, { ts: 9999 });
        expect(place.ts).toBe(9999);
        expect(place.ps).toEqual(ps);
    });

    // v1.63 / pv=3：spawn 帧逐块 feat + 帧级 spawnMeta
    it('buildSpawnFrame 写入逐块 feat 与帧级 spawnMeta', () => {
        const spawn = buildSpawnFrame(
            [{ id: '1x4', shape: [[1, 1, 1, 1]], colorIdx: 0, feat: { placements: 12, gapFills: 1, multiClear: 2, pcPotential: 0, exactFit: 1, monoFlush: 0, topDriver: 'clear' } }],
            undefined,
            { ts: 100, spawnMeta: { attempt: 2, fallback: false, solutionRejects: { tooFew: 1 } } }
        );
        expect(spawn.dock[0].feat).toEqual({
            placements: 12, gapFills: 1, multiClear: 2, pcPotential: 0, exactFit: 1, monoFlush: 0, topDriver: 'clear'
        });
        expect(spawn.spawnMeta).toEqual({ attempt: 2, fallback: false, solutionRejects: { tooFew: 1 } });
    });

    it('buildSpawnFrame 无 feat / spawnMeta 时保持旧结构（向后兼容）', () => {
        const spawn = buildSpawnFrame([{ id: '1x1', shape: [[1]], colorIdx: 0 }]);
        expect('feat' in spawn.dock[0]).toBe(false);
        expect('spawnMeta' in spawn).toBe(false);
    });
});

describe('getFrameElapsedMs', () => {
    it('返回 v2 frame.ts', () => {
        expect(getFrameElapsedMs({ t: 'spawn', ts: 1234 })).toBe(1234);
        expect(getFrameElapsedMs({ t: 'init', ts: 0 })).toBe(0);
    });

    it('v1 老帧（无 ts） → null', () => {
        expect(getFrameElapsedMs({ t: 'spawn' })).toBeNull();
    });

    it('非有限值 → null', () => {
        expect(getFrameElapsedMs(null)).toBeNull();
        expect(getFrameElapsedMs(undefined)).toBeNull();
        expect(getFrameElapsedMs({ ts: NaN })).toBeNull();
        expect(getFrameElapsedMs({ ts: -1 })).toBeNull();
    });
});

describe('extractFrameTimestamps', () => {
    const grid = new Grid(8);

    it('空 / null → 空数组', () => {
        expect(extractFrameTimestamps([])).toEqual({ startMs: null, frameTimestamps: [] });
        expect(extractFrameTimestamps(null)).toEqual({ startMs: null, frameTimestamps: [] });
    });

    it('v2 frames：每帧 ts 直接成数组，startMs=0', () => {
        const frames = [
            buildInitFrame('normal', grid, scoring, undefined, { ts: 0 }),
            buildSpawnFrame([], undefined, { ts: 1200 }),
            buildPlaceFrame(0, 0, 0, undefined, { ts: 2400 }),
            buildPlaceFrame(0, 1, 0, undefined, { ts: 3600 }),
        ];
        const { startMs, frameTimestamps } = extractFrameTimestamps(frames);
        expect(startMs).toBe(0);
        expect(frameTimestamps).toEqual([0, 1200, 2400, 3600]);
    });

    it('v1 老 frames：无 ts、无 ps._recordedAt → 全部 null', () => {
        const frames = [
            { v: 1, t: 'init' },
            { v: 1, t: 'spawn' },
            { v: 1, t: 'place', i: 0, x: 0, y: 0 },
        ];
        const { startMs, frameTimestamps } = extractFrameTimestamps(frames);
        expect(startMs).toBeNull();
        expect(frameTimestamps).toEqual([null, null, null]);
    });

    it('wall-clock 后备：ps._recordedAt 模式（live 历史），相对首个 _recordedAt 算偏移', () => {
        const frames = [
            { t: 'live', ps: { _recordedAt: 1_700_000_000_000 } },
            { t: 'live', ps: { _recordedAt: 1_700_000_005_000 } },
            { t: 'live', ps: { _recordedAt: 1_700_000_012_000 } },
        ];
        const { startMs, frameTimestamps } = extractFrameTimestamps(frames);
        expect(startMs).toBe(1_700_000_000_000);
        expect(frameTimestamps).toEqual([0, 5_000, 12_000]);
    });

    it('混合：部分 v2 ts + 部分缺失时间戳 → 缺失位置 null', () => {
        const frames = [
            buildInitFrame('normal', grid, scoring, undefined, { ts: 0 }),
            buildSpawnFrame([], undefined, { ts: 1000 }),
            { t: 'place', i: 0, x: 0, y: 0 }, // 无 ts
            buildPlaceFrame(0, 1, 0, undefined, { ts: 3000 }),
        ];
        const { frameTimestamps } = extractFrameTimestamps(frames);
        // 有 v2 ts 的 4 帧 → 走 v2 直通路径；缺失的 1 帧在 v2 路径中会让整组走 wall-clock 后备
        // 第 3 帧无 ts 且无 _recordedAt → null
        expect(frameTimestamps[0]).toBe(0);
        expect(frameTimestamps[1]).toBe(1000);
        expect(frameTimestamps[2]).toBeNull();
        expect(frameTimestamps[3]).toBe(3000);
    });

    it('保护：ts 异常大（>1e12 当成 wall-clock 而非偏移）时走后备', () => {
        const frames = [
            { t: 'init', ts: 1_700_000_000_000 },
            { t: 'spawn', ts: 1_700_000_005_000 },
        ];
        // 这两个 ts 都 > 1e12（wall-clock），不应被当成"相对 0 的 1.7 万亿 ms"
        const { startMs, frameTimestamps } = extractFrameTimestamps(frames);
        expect(startMs).toBe(1_700_000_000_000);
        expect(frameTimestamps).toEqual([0, 5_000]);
    });
});
