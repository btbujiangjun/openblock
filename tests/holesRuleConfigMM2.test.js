/**
 * MM2: holesRule cg 阈值外移到 topologyDifficulty.holeClearGuarantee 契约。
 */
import { describe, it, expect } from 'vitest';
import gameRules from '../shared/game_rules.json' with { type: 'json' };

describe('MM2 topologyDifficulty.holeClearGuarantee 外移', () => {
    const topo = gameRules.adaptiveSpawn.topologyDifficulty;

    it('holeClearGuarantee 字段存在 + 默认 2（与历史一致）', () => {
        expect(topo.holeClearGuarantee).toBe(2);
    });

    it('bottleneckClearGuarantee 字段存在 + 默认 2', () => {
        expect(topo.bottleneckClearGuarantee).toBe(2);
    });

    it('原有字段 holeClearGuaranteeAt / holeSizePreference 保持不变', () => {
        expect(topo.holeClearGuaranteeAt).toBe(2);
        expect(topo.holeSizePreference).toBe(-0.22);
        expect(topo.bottleneckClearGuaranteeAt).toBe(2);
        expect(topo.bottleneckSizePreferenceDelta).toBe(-0.18);
    });

    it('包含 MM2 说明注释', () => {
        expect(topo._mm2_note).toMatch(/MM2|外移|灰度/);
    });

    /* helper 参照实现：cg 阈值默认 2 */
    function holesRuleRef(s, holes, topoCfg) {
        if (!(holes >= (topoCfg?.holeClearGuaranteeAt ?? 2))) return s;
        const cg = Number.isFinite(topoCfg?.holeClearGuarantee) ? topoCfg.holeClearGuarantee : 2;
        return {
            clearGuarantee: Math.max(s.clearGuarantee, cg),
            sizePreference: Math.min(s.sizePreference, topoCfg?.holeSizePreference ?? -0.22),
        };
    }

    it('helper 用 game_rules.json 默认值 → 历史等价', () => {
        const out = holesRuleRef({ clearGuarantee: 0, sizePreference: 0 }, 3, topo);
        expect(out.clearGuarantee).toBe(2);
        expect(out.sizePreference).toBe(-0.22);
    });

    it('运营提高 holeClearGuarantee=3 → cg 抬到 3', () => {
        const overridden = { ...topo, holeClearGuarantee: 3 };
        const out = holesRuleRef({ clearGuarantee: 0, sizePreference: 0 }, 3, overridden);
        expect(out.clearGuarantee).toBe(3);
    });

    it('NaN fallback → 默认 2', () => {
        const broken = { ...topo, holeClearGuarantee: NaN };
        const out = holesRuleRef({ clearGuarantee: 0, sizePreference: 0 }, 3, broken);
        expect(out.clearGuarantee).toBe(2);
    });
});
