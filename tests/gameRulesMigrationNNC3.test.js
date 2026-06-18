/**
 * NN-C3: game_rules schema 演进 + _migrateRules 契约。
 */
import { describe, it, expect } from 'vitest';
import { GAME_RULES, _RULES_SCHEMA_VERSION, _migrateRules } from '../web/src/gameRules.js';

describe('NN-C3 game_rules schema 演进', () => {
    it('RULES_SCHEMA_VERSION = 1（与 game_rules.json 一致）', () => {
        expect(_RULES_SCHEMA_VERSION).toBe(1);
        expect(GAME_RULES.schemaVersion).toBe(1);
    });

    it('当前 rules 无迁移（didMigrate=false）', () => {
        const r = _migrateRules({ ...GAME_RULES });
        expect(r.didMigrate).toBe(false);
        expect(r.fromVersion).toBe(1);
    });

    it('无 schemaVersion 字段的旧 rules → 视作 v1 → 无迁移', () => {
        const old = { ...GAME_RULES };
        delete old.schemaVersion;
        const r = _migrateRules(old);
        expect(r.fromVersion).toBe(1);
        expect(r.didMigrate).toBe(false);
    });

    it('未来 v2 rules → throw（拒绝客户端误读）', () => {
        const future = { ...GAME_RULES, schemaVersion: 2 };
        expect(() => _migrateRules(future)).toThrow(/schemaVersion=2.*客户端支持的 1/);
    });

    it('未来 v999 同样 throw', () => {
        expect(() => _migrateRules({ schemaVersion: 999 })).toThrow();
    });

    it('迁移后注入 schemaVersion 字段（即使 fromVersion === current 仍保字段）', () => {
        /* 假设以后 v1→v2 迁移：函数兜底返回 schemaVersion=current */
        const r = _migrateRules({ ...GAME_RULES });
        expect(r.migrated.schemaVersion).toBe(1);
    });

    it('GAME_RULES 在导入时已通过 migration（无 throw）', () => {
        /* 导入成功 = migration 未抛 */
        expect(GAME_RULES).toBeTruthy();
        expect(GAME_RULES.strategies).toBeTruthy();
    });
});
