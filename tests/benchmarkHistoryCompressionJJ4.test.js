/**
 * JJ4: benchmark-suite history 压缩算法单测。
 *
 * 独立验证 _compressHistory 算法（同源拷贝），保证：
 *   - ≤ recentKeep 不动
 *   - > recentKeep 时，老条目按月去重保留首条
 *   - 总数不超 hardCap
 *   - 最近 N 条永远全留
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const SCRIPT = readFileSync(join(ROOT, 'scripts/benchmark-suite.mjs'), 'utf8');

function compress(entries, recentKeep = 10, hardCap = 50) {
    if (entries.length <= recentKeep) return entries;
    const recent = entries.slice(-recentKeep);
    const old = entries.slice(0, -recentKeep);
    const seenMonth = new Set();
    const monthly = [];
    for (const e of old) {
        const d = new Date(e.ts || 0);
        const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
        if (seenMonth.has(key)) continue;
        seenMonth.add(key);
        monthly.push(e);
    }
    const merged = [...monthly, ...recent];
    return merged.length > hardCap ? merged.slice(-hardCap) : merged;
}

const MS_DAY = 86400000;

describe('JJ4 benchmark history 压缩算法', () => {
    it('脚本中含 _compressHistory 实现', () => {
        expect(SCRIPT).toMatch(/_compressHistory/);
        expect(SCRIPT).toMatch(/recentKeep/);
    });

    it('≤ recentKeep 时原样返回', () => {
        const e = Array.from({ length: 5 }, (_, i) => ({ ts: i * MS_DAY, snapshot: {} }));
        expect(compress(e, 10)).toEqual(e);
    });

    it('> recentKeep 时最近 N 条永远全留', () => {
        const e = Array.from({ length: 30 }, (_, i) => ({ ts: i * MS_DAY, snapshot: {} }));
        const out = compress(e, 10);
        const recent10 = out.slice(-10);
        expect(recent10).toEqual(e.slice(-10));
    });

    it('老条目按月去重保留首条', () => {
        const base = Date.UTC(2024, 0, 1);
        /* 设计：12 老条目（同月成对，递增月），最近 10 全留 */
        const oldEntries = [
            { ts: base, snapshot: { m: 'a1' } },               /* Jan */
            { ts: base + MS_DAY, snapshot: { m: 'a2' } },      /* Jan dup */
            { ts: base + MS_DAY * 31, snapshot: { m: 'b1' } }, /* Feb */
            { ts: base + MS_DAY * 35, snapshot: { m: 'b2' } }, /* Feb dup */
            { ts: base + MS_DAY * 62, snapshot: { m: 'c1' } }, /* Mar */
            { ts: base + MS_DAY * 65, snapshot: { m: 'c2' } }, /* Mar dup */
            { ts: base + MS_DAY * 93, snapshot: { m: 'd1' } }, /* Apr */
            { ts: base + MS_DAY * 95, snapshot: { m: 'd2' } }, /* Apr dup */
            { ts: base + MS_DAY * 124, snapshot: { m: 'e1' } }, /* May */
            { ts: base + MS_DAY * 126, snapshot: { m: 'e2' } }, /* May dup */
            { ts: base + MS_DAY * 155, snapshot: { m: 'f1' } }, /* Jun */
            { ts: base + MS_DAY * 157, snapshot: { m: 'f2' } }, /* Jun dup */
        ];
        const recentEntries = Array.from({ length: 10 }, (_, i) => ({
            ts: base + MS_DAY * (200 + i), snapshot: { m: `r${i}` },
        }));
        const out = compress([...oldEntries, ...recentEntries], 10);
        /* 老 12 条压成月度首条：a1, b1, c1, d1, e1, f1 = 6 条 */
        const monthly = out.slice(0, -10);
        expect(monthly.length).toBe(6);
        expect(monthly.map(e => e.snapshot.m)).toEqual(['a1', 'b1', 'c1', 'd1', 'e1', 'f1']);
    });

    it('hardCap 限制总数', () => {
        const e = Array.from({ length: 100 }, (_, i) => ({
            ts: Date.UTC(2020, 0, 1) + i * 60 * MS_DAY, /* 每 60 天 = 月度采样 */
            snapshot: {},
        }));
        const out = compress(e, 10, 20);
        expect(out.length).toBeLessThanOrEqual(20);
        /* 最近 10 仍应保留 */
        expect(out.slice(-10)).toEqual(e.slice(-10));
    });

    it('稳态：每月跑 4 次 × 12 月 → 压缩后大约 22 条', () => {
        const base = Date.UTC(2024, 0, 1);
        const e = [];
        for (let mo = 0; mo < 12; mo++) {
            for (let w = 0; w < 4; w++) {
                e.push({ ts: base + mo * 30 * MS_DAY + w * 7 * MS_DAY, snapshot: {} });
            }
        }
        const out = compress(e, 10);
        /* 老 38 条 → 月度去重保留 12 月各 1 = 至多 12 条；加最近 10 = 22 */
        expect(out.length).toBeLessThanOrEqual(22);
        expect(out.length).toBeGreaterThanOrEqual(10);
    });
});
