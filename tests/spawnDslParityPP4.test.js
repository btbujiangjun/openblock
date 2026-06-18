/**
 * PP4 / NN-F3.2: DSL parity fuzz —— POC_HOLES_RULE vs oracle 实现。
 *
 * 目标：用 1000 次随机输入暴力对比 DSL POC_HOLES_RULE 与 oracle 实现
 * （即 adaptiveSpawn.js L1055-1063 的原始 if 块）字段级完全相等，确保
 * DSL 形式与命令式 helper **行为零差异**。这是后续 F3.3+ 批量迁移
 * 规则到 DSL 的"模板测试"——每条新迁移规则都按此模板写一份 parity。
 *
 * 也作为 SPAWN_RULES_PARITY_TEMPLATE 留给后续 F3.3/F3.4 复用。
 */
import { describe, it, expect } from 'vitest';
import { runSpawnRules, POC_HOLES_RULE } from '../web/src/spawn/spawnRulesDsl.js';

/* ---------- oracle：与 adaptiveSpawn._applySpawnHintsHolesRule 完全相同 ---------- */
function oracleHolesRule(s, holes, topoCfg) {
    if (!(holes >= (topoCfg?.holeClearGuaranteeAt ?? 2))) return s;
    const cg = Number.isFinite(topoCfg?.holeClearGuarantee) ? topoCfg.holeClearGuarantee : 2;
    return {
        clearGuarantee: Math.max(s.clearGuarantee, cg),
        sizePreference: Math.min(s.sizePreference, topoCfg?.holeSizePreference ?? -0.22),
    };
}

/* ---------- 随机输入工厂 ---------- */
function rndInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function rndFloat(lo, hi) { return lo + Math.random() * (hi - lo); }
function rndState() {
    return {
        clearGuarantee: rndInt(0, 5),
        sizePreference: rndFloat(-1, 1),
    };
}
function rndTopoCfg() {
    /* 各字段都有 ~25% 概率缺省（覆盖 fallback 路径） */
    const cfg = {};
    if (Math.random() < 0.75) cfg.holeClearGuaranteeAt = rndInt(0, 4);
    if (Math.random() < 0.75) cfg.holeClearGuarantee = rndInt(0, 5);
    if (Math.random() < 0.75) cfg.holeSizePreference = rndFloat(-1, 0);
    return cfg;
}

describe('PP4 / NN-F3.2 DSL parity fuzz', () => {
    it('POC_HOLES_RULE ↔ oracle：1000 次随机字段级等价', () => {
        let mismatch = 0;
        for (let i = 0; i < 1000; i++) {
            const state = rndState();
            const holes = rndInt(0, 6);
            const topoCfg = rndTopoCfg();

            const oracle = oracleHolesRule(state, holes, topoCfg);
            const { state: dsl } = runSpawnRules(
                [POC_HOLES_RULE], state, { holes, topoCfg },
            );

            /* 不变性：oracle 即原 state（when=false）或返回 {cg, sp} 的全新对象。
             * DSL 总是 spread {...state}，所以字段级比对 cg/sp 即可。 */
            const expCg = oracle.clearGuarantee;
            const expSp = oracle.sizePreference;
            if (dsl.clearGuarantee !== expCg || Math.abs(dsl.sizePreference - expSp) > 1e-12) {
                mismatch++;
                if (mismatch <= 3) {
                    console.error('mismatch', { state, holes, topoCfg, oracle, dsl });
                }
            }
        }
        expect(mismatch).toBe(0);
    });

    it('边界：holes 恰等于 holeClearGuaranteeAt 触发', () => {
        const state = { clearGuarantee: 0, sizePreference: 0 };
        const cfg = { holeClearGuaranteeAt: 3, holeClearGuarantee: 2, holeSizePreference: -0.5 };
        const oracle = oracleHolesRule(state, 3, cfg);
        const { state: dsl } = runSpawnRules([POC_HOLES_RULE], state, { holes: 3, topoCfg: cfg });
        expect(dsl.clearGuarantee).toBe(oracle.clearGuarantee);
        expect(dsl.sizePreference).toBeCloseTo(oracle.sizePreference);
    });

    it('边界：holeClearGuaranteeAt=0 时任意 holes 都触发', () => {
        const state = { clearGuarantee: 1, sizePreference: 1 };
        const cfg = { holeClearGuaranteeAt: 0, holeClearGuarantee: 3 };
        const { state: dsl } = runSpawnRules([POC_HOLES_RULE], state, { holes: 0, topoCfg: cfg });
        expect(dsl.clearGuarantee).toBe(3);
    });

    it('边界：topoCfg 完全空 → 走全套默认值（At=2, cg=2, sp=-0.22）', () => {
        const state = { clearGuarantee: 0, sizePreference: 0 };
        const oracle = oracleHolesRule(state, 2, {});
        const { state: dsl } = runSpawnRules([POC_HOLES_RULE], state, { holes: 2, topoCfg: {} });
        expect(dsl.clearGuarantee).toBe(oracle.clearGuarantee);
        expect(dsl.sizePreference).toBeCloseTo(oracle.sizePreference);
    });

    it('边界：holeClearGuarantee 非数（NaN）→ fallback 2，与 oracle 同', () => {
        const state = { clearGuarantee: 0, sizePreference: 0 };
        const cfg = { holeClearGuaranteeAt: 1, holeClearGuarantee: NaN };
        const oracle = oracleHolesRule(state, 2, cfg);
        const { state: dsl } = runSpawnRules([POC_HOLES_RULE], state, { holes: 2, topoCfg: cfg });
        expect(dsl.clearGuarantee).toBe(oracle.clearGuarantee);
        expect(dsl.sizePreference).toBeCloseTo(oracle.sizePreference);
    });
});
