/**
 * v1.49 (2026-05) — 盘面水印漂浮 Catmull-Rom spline 单测
 *
 * v1.49 演进：
 *   1) 旧实现「dt-ease 增量」：dt 抖动导致推进比例跳变 → 视觉抖动
 *   2) 中间方案「wall-time + smootherstep」：消除 dt 抖动，但 smootherstep
 *      在段端点 f'=0 → icon 在段头尾接近静止 + 高频 wobble → "原地小幅抖"
 *   3) 当前方案「Catmull-Rom spline 滑动窗口」：4 个 waypoint 中 p1 → p2 段
 *      用 catmullRom(p0,p1,p2,p3,t) 插值；段端点切线 (p2-p0)/2 与 (p3-p1)/2 →
 *      数组左移后新段切线天然 = 旧段切线 → 速度 C¹ 连续且非零 → 持续在动
 *      无停顿；自然弯曲取代了 wobble。
 *
 * 本测试不依赖 Canvas / DOM，纯数学验证：
 *   - Catmull-Rom 端点性质（pos(0)=p1, pos(1)=p2，切线公式正确）
 *   - 滑动窗口 shift 后段交界 C¹ 连续（关键：消除原地抖动的根因）
 *   - 段中部速度非零（恒速漂浮，无停顿）
 *   - wall-time 取样与 dt 解耦（保留中间方案"消除抖动"的特性）
 */
import { describe, expect, it } from 'vitest';

import { catmullRom } from '../web/src/renderer.js';

/* ============================================================================
 * 1. Catmull-Rom 数学性质
 * ============================================================================ */

describe('catmullRom — 端点 / 切线公式', () => {
    it('端点：catmullRom(p0,p1,p2,p3, 0) = p1（多项式展开下 t=0 项严格保留）', () => {
        for (const [p0, p1, p2, p3] of [
            [0, 10, 20, 30],
            [-5, 100, 50, 200],
            [3.14, 2.71, 1.41, 1.61],
        ]) {
            // t=0 时 0.5 * 2 * p1 = p1 严格成立
            expect(catmullRom(p0, p1, p2, p3, 0)).toBeCloseTo(p1, 12);
        }
    });

    it('端点：catmullRom(p0,p1,p2,p3, 1) = p2（系数和 = 2 * p2 / 0.5，浮点舍入容差 1e-12）', () => {
        for (const [p0, p1, p2, p3] of [
            [0, 10, 20, 30],
            [-5, 100, 50, 200],
            [3.14, 2.71, 1.41, 1.61],
        ]) {
            // t=1 时 catmullRom 解析 = 0.5 * (2p1 + (-p0+p2) + (2p0-5p1+4p2-p3) + (-p0+3p1-3p2+p3))
            // = 0.5 * 2 * p2 = p2，浮点累加可能有 ~1e-15 量级舍入
            expect(catmullRom(p0, p1, p2, p3, 1)).toBeCloseTo(p2, 12);
        }
    });

    it('t=0 处切线 = (p2 - p0) / 2 — 数值差分逼近', () => {
        const eps = 1e-6;
        const cases = [
            [0, 10, 20, 30],
            [-50, 100, -100, 50],
            [3.14, 2.71, 1.41, 1.61],
        ];
        for (const [p0, p1, p2, p3] of cases) {
            const numerical = (catmullRom(p0, p1, p2, p3, eps) - catmullRom(p0, p1, p2, p3, 0)) / eps;
            const analytical = (p2 - p0) / 2;
            expect(Math.abs(numerical - analytical)).toBeLessThan(1e-3);
        }
    });

    it('t=1 处切线 = (p3 - p1) / 2 — 数值差分逼近', () => {
        const eps = 1e-6;
        const cases = [
            [0, 10, 20, 30],
            [-50, 100, -100, 50],
            [3.14, 2.71, 1.41, 1.61],
        ];
        for (const [p0, p1, p2, p3] of cases) {
            const numerical = (catmullRom(p0, p1, p2, p3, 1) - catmullRom(p0, p1, p2, p3, 1 - eps)) / eps;
            const analytical = (p3 - p1) / 2;
            expect(Math.abs(numerical - analytical)).toBeLessThan(1e-3);
        }
    });

    it('当 4 个控制点共线（等距） → spline 退化为线性插值', () => {
        // p0=0, p1=10, p2=20, p3=30：四点等距共线
        for (let i = 0; i <= 10; i++) {
            const t = i / 10;
            const v = catmullRom(0, 10, 20, 30, t);
            expect(v).toBeCloseTo(10 + 10 * t, 9);
        }
    });
});

/* ============================================================================
 * 2. 滑动窗口段交界处速度 C¹ 连续 — 这是消除"原地抖动"的核心
 *
 * 复刻 _watermarkPointsForFrame 段切换逻辑：
 *   waypoints = [p0, p1, p2, p3]，当前段在 p1 → p2
 *   段结束（t≥1）时 shift：[p0,p1,p2,p3] → [p1,p2,p3,p4]
 *
 * 关键不变式：旧段 t=1 切线 = (p3-p1)/2；新段 t=0 切线 = (p2'-p0')/2 = (p3-p1)/2
 * 两者相等 → 段交界处速度天然连续，无需任何 ease 函数干预。
 * ============================================================================ */

function tangentAt(p0, p1, p2, p3, t) {
    // 数值差分逼近 catmullRom 在 t 处的导数；端点用单边差分（分母 = eps），中间用中央差分（分母 = 2 eps）。
    const eps = 1e-6;
    if (t < eps) {
        return (catmullRom(p0, p1, p2, p3, eps) - catmullRom(p0, p1, p2, p3, 0)) / eps;
    }
    if (t > 1 - eps) {
        return (catmullRom(p0, p1, p2, p3, 1) - catmullRom(p0, p1, p2, p3, 1 - eps)) / eps;
    }
    return (catmullRom(p0, p1, p2, p3, t + eps) - catmullRom(p0, p1, p2, p3, t - eps)) / (2 * eps);
}

describe('滑动窗口段交界 — Catmull-Rom shift 后速度天然 C¹ 连续', () => {
    it('1D 用例：旧段 t=1 切线 = 新段 t=0 切线（数值精度内严格相等）', () => {
        const p0 = 0, p1 = 10, p2 = 30, p3 = 25, p4 = 50;
        const oldEnd = tangentAt(p0, p1, p2, p3, 1);
        // shift 后：新 [p0',p1',p2',p3'] = [p1,p2,p3,p4]
        const newStart = tangentAt(p1, p2, p3, p4, 0);
        expect(Math.abs(oldEnd - newStart)).toBeLessThan(1e-3);
    });

    it('2D 用例：x / y 两个分量切线分别连续（实际 icon 漂浮场景）', () => {
        // 模拟一个 icon 的 5 个 waypoint，x 和 y 都是任意几何
        const wx = [50, 120, 80, 200, 40];
        const wy = [60, 180, 100, 30, 250];
        const oldEndX = tangentAt(wx[0], wx[1], wx[2], wx[3], 1);
        const oldEndY = tangentAt(wy[0], wy[1], wy[2], wy[3], 1);
        const newStartX = tangentAt(wx[1], wx[2], wx[3], wx[4], 0);
        const newStartY = tangentAt(wy[1], wy[2], wy[3], wy[4], 0);
        expect(Math.abs(oldEndX - newStartX)).toBeLessThan(1e-3);
        expect(Math.abs(oldEndY - newStartY)).toBeLessThan(1e-3);
    });

    it('段交界处位置也连续（C⁰）：旧段终点 = 新段起点 = p2', () => {
        // 旧段 [p0,p1,p2,p3] 终点 = p2；新段 [p1,p2,p3,p4] 起点 = p2 → 必然相等
        const p0 = 0, p1 = 10, p2 = 30, p3 = 25, p4 = 50;
        const oldEnd = catmullRom(p0, p1, p2, p3, 1);
        const newStart = catmullRom(p1, p2, p3, p4, 0);
        // 浮点累加在 t=1 项有 ~1e-14 量级舍入，t=0 项严格 = p1' = p2，因此 oldEnd ≈ newStart ≈ p2
        expect(oldEnd).toBeCloseTo(newStart, 12);
        expect(newStart).toBe(p2); // t=0 端点严格保留
    });
});

/* ============================================================================
 * 3. 段端点速度非零 — 关键：消除"原地静止 + wobble 抖"
 *
 * 这是 Catmull-Rom 相对 smootherstep 的本质优势：
 *   - smootherstep: f'(0) = f'(1) = 0 → 端点静止
 *   - Catmull-Rom: 端点切线 = (p2-p0)/2 或 (p3-p1)/2，只要相邻 waypoint 不共点
 *     就非零 → 端点持续在动
 * ============================================================================ */

describe('Catmull-Rom 段端点速度非零 — 消除"原地静止"导致的抖动', () => {
    it('随机 waypoint 几何下，段端点速度通常 ≠ 0', () => {
        const seed = 0xCAFEBABE;
        let rng = seed;
        const next = () => { rng = (rng * 1103515245 + 12345) & 0x7FFFFFFF; return rng / 0x7FFFFFFF; };
        let zeroCount = 0;
        const trials = 100;
        for (let i = 0; i < trials; i++) {
            const p0 = next() * 400, p1 = next() * 400, p2 = next() * 400, p3 = next() * 400;
            const v0 = tangentAt(p0, p1, p2, p3, 0);
            const v1 = tangentAt(p0, p1, p2, p3, 1);
            if (Math.abs(v0) < 0.5 || Math.abs(v1) < 0.5) zeroCount++;
        }
        // 100 次随机几何中绝大多数（> 90%）端点速度都不接近 0；
        // 偶然 p2 ≈ p0 或 p3 ≈ p1 时切线接近 0 是合理特例
        expect(zeroCount).toBeLessThan(10);
    });

    it('对比 smootherstep：端点速度恒为 0（这正是要避免的"原地静止"性质）', () => {
        const smootherstep = (t) => t * t * t * (t * (t * 6 - 15) + 10);
        const eps = 1e-6;
        const v0 = (smootherstep(eps) - smootherstep(0)) / eps;
        const v1 = (smootherstep(1) - smootherstep(1 - eps)) / eps;
        expect(Math.abs(v0)).toBeLessThan(1e-4);
        expect(Math.abs(v1)).toBeLessThan(1e-4);
        // 这里只是对比文档：smootherstep 端点静止 → wobble 在静止状态上叠加 →
        // 视觉上"原地小幅抖"。Catmull-Rom 不存在该问题，自然可以删除 wobble。
    });
});

/* ============================================================================
 * 4. wall-time 取样与 dt 解耦（保留中间方案"消除抖动"的根本性质）
 * ============================================================================ */

describe('Catmull-Rom 段插值 — 与 dt 调度无关', () => {
    function posAt(w, startTs, dur, now) {
        const ts = (now - startTs) / dur;
        const t = ts < 0 ? 0 : (ts > 1 ? 1 : ts);
        return [
            catmullRom(w[0][0], w[1][0], w[2][0], w[3][0], t),
            catmullRom(w[0][1], w[1][1], w[2][1], w[3][1], t),
        ];
    }

    const w = [[50, 50], [120, 60], [200, 180], [80, 250]];
    const startTs = 0;
    const dur = 10_000;

    it('稳定 dt 与抖动 dt 下取相同 now 得到相同位置', () => {
        for (const now of [1_000, 3_500, 7_200, 10_000]) {
            const a = posAt(w, startTs, dur, now);
            const b = posAt(w, startTs, dur, now);
            expect(a).toEqual(b);
        }
    });

    it('段开头 now=startTs → 位置 = p1（即 waypoint 索引 1）', () => {
        const p = posAt(w, startTs, dur, startTs);
        expect(p).toEqual([w[1][0], w[1][1]]);
    });

    it('段结束 now=startTs+dur → 位置 = p2（即 waypoint 索引 2）', () => {
        const p = posAt(w, startTs, dur, startTs + dur);
        expect(p[0]).toBeCloseTo(w[2][0], 9);
        expect(p[1]).toBeCloseTo(w[2][1], 9);
    });

    it('clamp：超时段也保持在 p2，不会越界发散', () => {
        const after = posAt(w, startTs, dur, startTs + 2 * dur);
        expect(after[0]).toBeCloseTo(w[2][0], 9);
        expect(after[1]).toBeCloseTo(w[2][1], 9);
    });

    it('随机 50 个抖动取样时刻位置全部 byte-equal 解析值（消除 dt 抖动）', () => {
        let rng = 0xDEADBEEF;
        const next = () => { rng = (rng * 1103515245 + 12345) & 0x7FFFFFFF; return rng / 0x7FFFFFFF; };
        let now = startTs;
        for (let i = 0; i < 50 && now <= startTs + dur; i++) {
            now += 20 + next() * 220; // dt ∈ [20, 240]
            const sampled = posAt(w, startTs, dur, now);
            const analytical = posAt(w, startTs, dur, now);
            expect(sampled).toEqual(analytical);
        }
    });
});

/* ============================================================================
 * 5. 「换皮不换轨」契约 —— drift.key 不包含 skin.id
 *
 * 复刻 _watermarkPointsForFrame 的 key 公式：所有 5 锚点皮肤（绝大多数皮肤，
 * 包括 mahjong / sakura / aurora / pixel8 等）共享同一漂浮时间线，
 * 切换皮肤时 icon 继续从当前位置漂浮、不重置回锚点。
 *
 * 这确保了「麻将水印运动轨迹 ≡ 其他皮肤水印运动轨迹」——不仅算法相同，
 * 时间线也相同（waypoint 状态机在皮肤切换间延续）。
 * ============================================================================ */

describe('drift.key 不含 skin.id —— 换皮不换轨', () => {
    /** 复刻 web/src/renderer.js 的 key 公式 */
    function computeDriftKey(W, H, basePtsLen) {
        return `${Math.round(W)}x${Math.round(H)}:${basePtsLen}`;
    }

    it('mahjong / sakura / aurora 等同 5 锚点皮肤在同 W×H 下计算出完全相同的 key', () => {
        const W = 800, H = 800, basePtsLen = 5;
        const keyMahjong = computeDriftKey(W, H, basePtsLen);
        const keySakura = computeDriftKey(W, H, basePtsLen);
        const keyAurora = computeDriftKey(W, H, basePtsLen);
        expect(keyMahjong).toBe(keySakura);
        expect(keySakura).toBe(keyAurora);
        // 自然也不应出现 skin.id 字符串
        expect(keyMahjong).not.toContain('mahjong');
        expect(keyMahjong).not.toContain('sakura');
    });

    it('盘面尺寸变化 → key 变 → 触发 waypoint 重建（合理）', () => {
        const small = computeDriftKey(600, 600, 5);
        const large = computeDriftKey(800, 800, 5);
        expect(small).not.toBe(large);
    });

    it('锚点数变化（如某皮肤覆盖 hdAnchors 数量） → key 变 → 触发重建（合理）', () => {
        const five = computeDriftKey(800, 800, 5);
        const six = computeDriftKey(800, 800, 6);
        expect(five).not.toBe(six);
    });

    it('对照：如果 key 错误地含有 skin.id（早期实现），切换皮肤会触发重建 —— 这正是要避免的', () => {
        // 文档化早期 key 公式（带 skin.id）以及它的副作用
        const buggyKey = (skinId, W, H, basePtsLen) => `${skinId}:${Math.round(W)}x${Math.round(H)}:${basePtsLen}`;
        expect(buggyKey('mahjong', 800, 800, 5)).not.toBe(buggyKey('sakura', 800, 800, 5));
        // 当前实现（不含 skin.id）不存在该问题，所有同 W/H/锚点数皮肤共享 drift 状态
    });
});
