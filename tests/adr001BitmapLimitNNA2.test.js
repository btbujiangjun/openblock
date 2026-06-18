/**
 * NN-A2: ADR-001 决议——n>30 bitmap fallback 保持 slow path。
 *
 * 静态契约：
 * - 所有策略 gridWidth ≤ 30（确保不会触发慢路径）
 * - ADR 文档存在 + 决议明确
 * - n>30 fallback 路径仍正确（防被误删）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import gameRules from '../shared/game_rules.json' with { type: 'json' };
import { Grid } from '../web/src/grid.js';

const ROOT = join(__dirname, '..');
const ADR = join(ROOT, 'docs/engineering/ADR-001-bitmap-n30-limit.md');

describe('NN-A2 ADR-001 bitmap n>30 limit', () => {
    it('ADR 文档存在 + Accepted status', () => {
        expect(existsSync(ADR)).toBe(true);
        const txt = readFileSync(ADR, 'utf8');
        expect(txt).toMatch(/Status\*\*:\s*Accepted/);
        expect(txt).toMatch(/NN-A2/);
    });

    it('所有策略 gridWidth ≤ 30（不会触发慢路径）', () => {
        for (const [sid, s] of Object.entries(gameRules.strategies)) {
            if (typeof s.gridWidth === 'number') {
                expect(s.gridWidth, `strategy ${sid}`).toBeLessThanOrEqual(30);
            }
        }
    });

    it('n=31 fallback 路径仍存在且正确（防被误删）', () => {
        /* 直接构 n=31 grid，确认 fast path 返回 null 时 slow path 接管 */
        const g = new Grid(31);
        /* findGapPositions 会自动走 _findGapPositionsSlow */
        const result = g.findGapPositions();
        expect(Array.isArray(result)).toBe(true);
    });

    it('n=30 仍走 bitmap fast path（边界）', () => {
        const g = new Grid(30);
        const view = g._buildBitmapView([[1]]);
        expect(view).not.toBeNull();
    });

    it('ADR 列出 revisit triggers（避免后人想拓展时无明确条件）', () => {
        const txt = readFileSync(ADR, 'utf8');
        expect(txt).toMatch(/Revisit Trigger/);
        expect(txt).toMatch(/gridWidth >= 16/);
    });
});
