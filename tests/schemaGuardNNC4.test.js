/**
 * NN-C4: scripts/_lib/schemaGuard 公共工具单测。
 */
import { describe, it, expect } from 'vitest';
import { checkAndMigrate } from '../scripts/_lib/schemaGuard.mjs';

describe('NN-C4 schemaGuard.checkAndMigrate', () => {
    it('current version → ok 不迁移', () => {
        const r = checkAndMigrate({ schemaVersion: 1, x: 1 }, {
            currentVersion: 1, name: 'test',
        });
        expect(r.status).toBe('ok');
        expect(r.didMigrate).toBe(false);
        expect(r.migrated).toEqual({ schemaVersion: 1, x: 1 });
    });

    it('future version → status=future + 原样返回（caller 决定 throw/exit）', () => {
        const r = checkAndMigrate({ schemaVersion: 999, x: 1 }, {
            currentVersion: 1, name: 'test',
        });
        expect(r.status).toBe('future');
        expect(r.fromVersion).toBe(999);
        expect(r.migrated).toEqual({ schemaVersion: 999, x: 1 });
    });

    it('old version + migrations 链 → 依次执行', () => {
        const r = checkAndMigrate({ schemaVersion: 1, x: 1 }, {
            currentVersion: 3,
            name: 'test',
            migrations: {
                2: (v1) => ({ ...v1, schemaVersion: 2, y: 2 }),
                3: (v2) => ({ ...v2, schemaVersion: 3, z: 3 }),
            },
        });
        expect(r.status).toBe('migrated');
        expect(r.didMigrate).toBe(true);
        expect(r.fromVersion).toBe(1);
        expect(r.migrated).toEqual({ schemaVersion: 3, x: 1, y: 2, z: 3 });
    });

    it('无 schemaVersion 字段 → 视作 v1', () => {
        const r = checkAndMigrate({ x: 1 }, {
            currentVersion: 1, name: 'test',
        });
        expect(r.fromVersion).toBe(1);
        expect(r.status).toBe('ok');
    });

    it('支持 meta.schemaVersion 嵌套（perf-baseline / trend-history 风格）', () => {
        const r = checkAndMigrate({ meta: { schemaVersion: 1, capturedAt: 'now' }, results: [] }, {
            currentVersion: 2,
            name: 'perf-baseline',
            migrations: { 2: (v) => ({ ...v, results: v.results.map((r) => ({ ...r, p999: 0 })) }) },
        });
        expect(r.status).toBe('migrated');
        expect(r.migrated.meta.schemaVersion).toBe(2);
    });

    it('无 migrations 函数 → 兜底仅 bump schemaVersion 字段', () => {
        const r = checkAndMigrate({ schemaVersion: 1, x: 1 }, {
            currentVersion: 3, name: 'test',
        });
        expect(r.status).toBe('migrated');
        expect(r.migrated.schemaVersion).toBe(3);
        expect(r.migrated.x).toBe(1);
    });
});
