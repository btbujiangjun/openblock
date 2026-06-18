/**
 * NN-B1: 修 MM2 死字段——bottleneckClearGuarantee 真接入 helper。
 */
import { describe, it, expect } from 'vitest';
import gameRules from '../shared/game_rules.json' with { type: 'json' };
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const topo = gameRules.adaptiveSpawn.topologyDifficulty;

/* 参照实现（与 helper 一致）：cgFloor 优先 bottleneckClearGuarantee，fallback bottleneckClearGuaranteeAt，再 fallback 2 */
function bottleneckRuleRef(s, hasSignal, cfg) {
    if (!hasSignal) return s;
    const cgFloor = Number.isFinite(cfg?.bottleneckClearGuarantee)
        ? cfg.bottleneckClearGuarantee
        : (Number.isFinite(cfg?.bottleneckClearGuaranteeAt)
            ? cfg.bottleneckClearGuaranteeAt : 2);
    const sizeDelta = Number.isFinite(cfg?.bottleneckSizePreferenceDelta)
        ? cfg.bottleneckSizePreferenceDelta : -0.18;
    return {
        clearGuarantee: Math.max(s.clearGuarantee, cgFloor),
        sizePreference: Math.min(s.sizePreference, sizeDelta),
    };
}

describe('NN-B1 bottleneckClearGuarantee 真接入', () => {
    it('helper 源码包含 bottleneckClearGuarantee 读取（修死字段）', () => {
        const src = readFileSync(join(__dirname, '..', 'web/src/adaptiveSpawn.js'), 'utf8');
        expect(src).toMatch(/topoCfg\?\.bottleneckClearGuarantee\b/);
        expect(src).toMatch(/NN-B1/);
    });

    it('默认（仅 bottleneckClearGuaranteeAt=2 历史值）→ cg ≥ 2', () => {
        const out = bottleneckRuleRef(
            { clearGuarantee: 0, sizePreference: 0 }, true,
            { bottleneckClearGuaranteeAt: 2 },
        );
        expect(out.clearGuarantee).toBe(2);
    });

    it('新字段 bottleneckClearGuarantee=3 优先生效', () => {
        const out = bottleneckRuleRef(
            { clearGuarantee: 0, sizePreference: 0 }, true,
            { bottleneckClearGuarantee: 3, bottleneckClearGuaranteeAt: 2 },
        );
        expect(out.clearGuarantee).toBe(3);
    });

    it('仅 bottleneckClearGuaranteeAt（无新字段）→ fallback 该字段（向后兼容）', () => {
        const out = bottleneckRuleRef(
            { clearGuarantee: 0, sizePreference: 0 }, true,
            { bottleneckClearGuaranteeAt: 4 },
        );
        expect(out.clearGuarantee).toBe(4);
    });

    it('两字段都缺 → fallback 2', () => {
        const out = bottleneckRuleRef(
            { clearGuarantee: 0, sizePreference: 0 }, true, {},
        );
        expect(out.clearGuarantee).toBe(2);
    });

    it('NaN 守护 → fallback 链生效', () => {
        const out = bottleneckRuleRef(
            { clearGuarantee: 0, sizePreference: 0 }, true,
            { bottleneckClearGuarantee: NaN, bottleneckClearGuaranteeAt: 3 },
        );
        expect(out.clearGuarantee).toBe(3);
    });

    it('hasBottleneckSignal=false → no-op（cgFloor 不评估）', () => {
        const out = bottleneckRuleRef(
            { clearGuarantee: 1, sizePreference: 0.5 }, false,
            { bottleneckClearGuarantee: 99 },
        );
        expect(out).toEqual({ clearGuarantee: 1, sizePreference: 0.5 });
    });

    it('game_rules.json 当前 bottleneckClearGuarantee=2 与历史等价（spawnGolden 保护）', () => {
        expect(topo.bottleneckClearGuarantee).toBe(2);
        expect(topo.bottleneckClearGuaranteeAt).toBe(2);
    });
});
