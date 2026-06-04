import { describe, it, expect } from 'vitest';
import { collectStepRows, aggregate as aggBucket } from '../scripts/aggregate-step-difficulty.mjs';
import { auditSession, aggregate as aggExact, countIsolatedHoles } from '../scripts/audit-exact-match.mjs';
import { buildReplayAnalysis } from '../web/src/moveSequence.js';

const empty = () => ({ size: 8, cells: Array.from({ length: 8 }, () => Array(8).fill(null)) });
const S1 = [[1]];
const BAR = [[1, 1, 1, 1]];

function syntheticFrames() {
    return [
        { t: 'init', grid: empty(), ps: { strategyId: 'normal' } },
        {
            t: 'spawn', dock: [{ id: 'a', shape: BAR }, { id: 'b', shape: S1 }, { id: 'c', shape: S1 }],
            ps: { strategyId: 'normal', boardFill: 0.0, metrics: { thinkMs: 1000, samples: 5 } },
            spawnMeta: { attempt: 0, stepDifficulty: { stepDifficulty: 0.15, bucket: 'trivial', scdScore: 0.09, comboKillerCnt: 1, comboLongBarCnt: 1, minFlexibility: 12, contiguousRegions: 1, concaveCorners: 0 } }
        },
        { t: 'place', i: 0, x: 0, y: 0, ps: { strategyId: 'normal', boardFill: 0.06, metrics: { thinkMs: 1200, samples: 5 }, linesCleared: 0 } },
        { t: 'place', i: 1, x: 0, y: 1, ps: { strategyId: 'normal', boardFill: 0.08, metrics: { thinkMs: 900, samples: 5 }, linesCleared: 0 } },
        { t: 'place', i: 2, x: 1, y: 1, ps: { strategyId: 'normal', boardFill: 0.09, metrics: { thinkMs: 5000, samples: 5 }, linesCleared: 0 } }
    ];
}

describe('P4 — 难度分桶聚合', () => {
    it('collectStepRows 把 spawn 难度与后续 place 表现配对', () => {
        const rows = collectStepRows([{ frames: syntheticFrames() }]);
        expect(rows.length).toBe(3);
        expect(rows.every((r) => r.bucket === 'trivial' && r.algo === 'normal')).toBe(true);
    });
    it('aggregate 产出难度桶统计与 algoScoreSpread', () => {
        const rows = collectStepRows([{ frames: syntheticFrames() }]);
        const agg = aggBucket(rows);
        expect(agg.totalSteps).toBe(3);
        expect(agg.bucketStats.trivial.samples).toBe(3);
        expect(agg.bucketStats.trivial.thinkMs.mean).toBeCloseTo((1200 + 900 + 5000) / 3, 3);
        expect(agg.algos).toContain('normal');
    });
    it('aggregate 暴露离散度跨度（scd_cv/scd_range/killer_range）与几何/清屏分桶', () => {
        const rows = collectStepRows([{ frames: syntheticFrames() }]);
        const agg = aggBucket(rows);
        expect(agg.spread).toBeTruthy();
        // 单一 scdScore=0.09 → range 0、cv 0
        expect(agg.spread.scdRange).toBeCloseTo(0, 6);
        expect(agg.spread.killerRange).toBeCloseTo(0, 6);
        const b = agg.bucketStats.trivial;
        expect(b).toHaveProperty('cleanScreenRate');
        expect(b.contiguousRegions.mean).toBeCloseTo(1, 6);
        expect(b.concaveCorners.mean).toBeCloseTo(0, 6);
        expect(b.noBlastRate).toBe(1); // 三步均无消行
    });
});

describe('v1.67 — 构造式归因聚合（phaseStats 闭环）', () => {
    function lowPhaseConstructFrames(construct) {
        return [
            { t: 'init', grid: empty(), ps: { strategyId: 'normal' } },
            {
                t: 'spawn', dock: [{ id: 'a', shape: BAR }, { id: 'b', shape: S1 }, { id: 'c', shape: S1 }],
                ps: { strategyId: 'normal', boardFill: 0.1, metrics: { thinkMs: 500 } },
                spawnMeta: {
                    attempt: 0,
                    stepDifficulty: { stepDifficulty: 0.2, bucket: 'easy', scdScore: 0.1 },
                    pressurePhase: 'low',
                    lowClearDelivered: true,
                    construct
                }
            },
            { t: 'place', i: 0, x: 0, y: 0, ps: { strategyId: 'normal', boardFill: 0.0, metrics: { thinkMs: 100 }, linesCleared: 2 } }
        ];
    }

    it('collectStepRows 透传 constructKind/constructDelivered', () => {
        const rows = collectStepRows([{ frames: lowPhaseConstructFrames({ kind: 'completer', delivered: true, completerCount: 2 }) }]);
        expect(rows).toHaveLength(1);
        expect(rows[0].pressurePhase).toBe('low');
        expect(rows[0].constructKind).toBe('completer');
        expect(rows[0].constructDelivered).toBe(true);
    });

    it('aggregate.phaseStats.low 暴露 C1 补全 / C2 造势交付率', () => {
        const rows = collectStepRows([{ frames: lowPhaseConstructFrames({ kind: 'completer', delivered: true, completerCount: 2 }) }]);
        const agg = aggBucket(rows);
        expect(agg.phaseStats.low.completerDeliveredRate).toBeCloseTo(1, 6);
        expect(agg.phaseStats.low.setupDeliveredRate).toBeCloseTo(0, 6);
    });

    it('未交付的构造（delivered=false）不计入交付率', () => {
        const rows = collectStepRows([{ frames: lowPhaseConstructFrames({ kind: 'setup', delivered: false, setupCount: 1 }) }]);
        const agg = aggBucket(rows);
        expect(agg.phaseStats.low.setupDeliveredRate).toBeCloseTo(0, 6);
        expect(agg.phaseStats.low.completerDeliveredRate).toBeCloseTo(0, 6);
    });

    it('旧帧（无 construct 字段）安全缺省，交付率为 0', () => {
        const rows = collectStepRows([{ frames: syntheticFrames() }]);
        const agg = aggBucket(rows);
        // syntheticFrames 为 mid 相位、无 construct → low 桶无样本
        expect(agg.phaseStats.low.samples).toBe(0);
    });
});

describe('P5 — is_exact_match 回算', () => {
    it('countIsolatedHoles 识别四面围住的空格', () => {
        const b = { size: 3, cells: [[1, 1, 1], [1, null, 1], [1, 1, 1]] };
        expect(countIsolatedHoles(b)).toBe(1);
    });
    it('auditSession 在空盘把每个真实落点判为 exact（任意落点等价）', () => {
        const records = auditSession(syntheticFrames());
        expect(records.length).toBe(3);
        expect(records.every((r) => r.isExact === true)).toBe(true); // 空盘任意落点等价，实际落点∈argmax
    });
    it('aggregate 计算 exact_match_rate 与 punish_index', () => {
        const records = auditSession(syntheticFrames());
        const agg = aggExact(records);
        expect(agg.totalSteps).toBe(3);
        expect(agg.exactMatchRate).toBe(1);
    });
    it('aggregate 暴露 max_punish_index / punishment_label / chain_label / composite', () => {
        const records = auditSession(syntheticFrames());
        const agg = aggExact(records, { reviveRate: 0.1 });
        expect(agg).toHaveProperty('maxPunishIndex');
        expect(['宽容型', '中等型', '致命型', null]).toContain(agg.punishmentLabel);
        expect(agg.chainLabelRates['0级并行']).toBeCloseTo(1, 6); // 空盘无消行
        expect(typeof agg.compositeDifficultyScore).toBe('number');
        expect(['极简', '简单', '标准', '困难', '极限']).toContain(agg.difficultySubLabel);
        expect(agg.reviveRate).toBe(0.1);
    });
});

describe('chain_label / punishment_label / 难度档', () => {
    it('chainLabel 按 lines + 清屏分级', async () => {
        const { chainLabel, punishmentLabel, difficultySubLabel } = await import('../scripts/audit-exact-match.mjs');
        expect(chainLabel(0, false)).toBe('0级并行');
        expect(chainLabel(1, false)).toBe('1级单消');
        expect(chainLabel(3, false)).toBe('2级多消嵌套');
        expect(chainLabel(2, true)).toBe('3级清屏');
        expect(punishmentLabel(0.3)).toBe('宽容型');
        expect(punishmentLabel(1.0)).toBe('中等型');
        expect(punishmentLabel(2.0)).toBe('致命型');
        expect(difficultySubLabel(10)).toBe('极简');
        expect(difficultySubLabel(85)).toBe('极限');
    });
});

describe('P3 — buildReplayAnalysis 新增 think_cv / 难度分布', () => {
    it('metrics 暴露 think_cv / think_range / stepDifficulty*', () => {
        const analysis = buildReplayAnalysis(syntheticFrames(), { score: 100 });
        expect(analysis.metrics).toHaveProperty('think_cv');
        expect(analysis.metrics).toHaveProperty('think_range');
        expect(analysis.metrics).toHaveProperty('stepDifficultyMean');
        expect(analysis.metrics).toHaveProperty('stepDifficultyBuckets');
        // 三个 place 帧 thinkMs = 1200/900/5000 → range = 4100
        expect(analysis.metrics.think_range).toBeCloseTo(4100, 6);
        // 一个 spawn 帧难度 0.15
        expect(analysis.metrics.stepDifficultyMean).toBeCloseTo(0.15, 6);
        expect(analysis.metrics.stepDifficultyBuckets.trivial).toBe(1);
    });
});
