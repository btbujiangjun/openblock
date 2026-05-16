// @vitest-environment jsdom
/**
 * decisionFlowVizPerf.test.js — DFV v1.55.1 专项性能优化的回归锁定。
 *
 * 锁定 4 件事：
 *   1) 调度档位常量符合预期（active 30fps / idle 6fps 等），
 *      防止有人误把帧率拉回 60fps；
 *   2) 数据指纹对"无意义浮点抖动"稳定（相同业务语义不触发 SVG 重写）；
 *   3) 数据指纹对"业务字段变化"敏感（intent / 关键 breakdown 变化必须触发）；
 *   4) 折叠态 + tab 隐藏 + 不可见时调度被暂停（_isPaused 行为）。
 */

import { describe, it, expect } from 'vitest';

import { __dfvTestables } from '../web/src/decisionFlowViz.js';

const {
    fingerprint, DFV_FPS_ACTIVE, DFV_FPS_IDLE, DFV_PARTICLE_CAP, DFV_TRAIL_COUNT, createInstance,
    setAttrIfChanged,
} = __dfvTestables;

describe('DFV v1.55.1 性能调度常量', () => {
    it('active / idle 帧率与历史 60fps 拉满显著不同', () => {
        expect(DFV_FPS_ACTIVE).toBeLessThanOrEqual(30);
        expect(DFV_FPS_ACTIVE).toBeGreaterThanOrEqual(15);
        expect(DFV_FPS_IDLE).toBeLessThanOrEqual(10);
        expect(DFV_FPS_IDLE).toBeGreaterThanOrEqual(2);
    });

    it('粒子上限 + trail 复制层数控制在硬上限内', () => {
        expect(DFV_PARTICLE_CAP).toBeLessThanOrEqual(96);
        expect(DFV_TRAIL_COUNT).toBeLessThanOrEqual(4);
    });
});

describe('DFV 数据指纹（_dfvFingerprint）', () => {
    const baseProfile = {
        skillLevel: 0.56,
        momentum: 0.0,
        frustrationLevel: 3,
        flowState: 'flow',
        sessionPhase: 'early',
    };
    const baseInsight = {
        stress: -0.20,
        spawnIntent: 'flow',
        scoreMilestoneHit: false,
        afkEngageActive: false,
        spawnHints: { spawnIntent: 'flow', winbackProtectionActive: false },
        stressBreakdown: {
            difficultyMode: -0.220,
            sessionArc: -0.080,
            postPbReleaseStressAdjust: -0.055,
            lifecycleBandAdjust: -0.050,
        },
    };

    it('相同业务语义 + 微小浮点抖动 → 指纹相同', () => {
        const fp1 = fingerprint(baseInsight, baseProfile);
        const fp2 = fingerprint(
            {
                ...baseInsight,
                stress: -0.2003,                  // 0.001 量级抖动
                stressBreakdown: {
                    ...baseInsight.stressBreakdown,
                    difficultyMode: -0.2204,       // 同上
                },
            },
            { ...baseProfile, momentum: 0.001 },
        );
        expect(fp1).toBe(fp2);
    });

    it('spawnIntent 变化 → 指纹不同', () => {
        const fp1 = fingerprint(baseInsight, baseProfile);
        const fp2 = fingerprint(
            { ...baseInsight, spawnHints: { spawnIntent: 'pressure' } },
            baseProfile,
        );
        expect(fp1).not.toBe(fp2);
    });

    it('breakdown 关键字段大幅变化 → 指纹不同', () => {
        const fp1 = fingerprint(baseInsight, baseProfile);
        const fp2 = fingerprint(
            {
                ...baseInsight,
                stressBreakdown: {
                    ...baseInsight.stressBreakdown,
                    difficultyMode: 0.50,
                },
            },
            baseProfile,
        );
        expect(fp1).not.toBe(fp2);
    });

    it('flowState / sessionPhase 切换 → 指纹不同', () => {
        const fp1 = fingerprint(baseInsight, baseProfile);
        const fp2 = fingerprint(baseInsight, { ...baseProfile, flowState: 'low_flow' });
        const fp3 = fingerprint(baseInsight, { ...baseProfile, sessionPhase: 'late' });
        expect(fp1).not.toBe(fp2);
        expect(fp1).not.toBe(fp3);
    });

    it('空 insight / profile 不抛错', () => {
        expect(() => fingerprint(null, null)).not.toThrow();
        expect(fingerprint(null, null)).toBe('empty');
    });
});

describe('DFV v1.55.2 SVG attribute 差异写入（_setAttrIfChanged）', () => {
    it('相同值不触发 setAttribute；不同值才触发', () => {
        let setCount = 0;
        const fakeEl = {
            setAttribute: (k, v) => {
                setCount++;
                fakeEl._attrs = fakeEl._attrs || {};
                fakeEl._attrs[k] = v;
            },
        };
        setAttrIfChanged(fakeEl, 'stroke', '#ff0000');
        expect(setCount).toBe(1);
        // 完全相同 → 跳过
        setAttrIfChanged(fakeEl, 'stroke', '#ff0000');
        expect(setCount).toBe(1);
        // 数字与字符串 '12' 等价，避免 toFixed(2) 重复触发
        setAttrIfChanged(fakeEl, 'stroke-width', '1.20');
        setAttrIfChanged(fakeEl, 'stroke-width', '1.20');
        expect(setCount).toBe(2);
        // 新值 → 触发
        setAttrIfChanged(fakeEl, 'stroke', '#00ff00');
        expect(setCount).toBe(3);
    });

    it('null / undefined el 不抛错', () => {
        expect(() => setAttrIfChanged(null, 'x', 'y')).not.toThrow();
        expect(() => setAttrIfChanged(undefined, 'x', 'y')).not.toThrow();
    });
});

describe('DFV 暂停状态（_isPaused）', () => {
    /**
     * jsdom 不支持 ResizeObserver / IntersectionObserver / Canvas 2d 完整 API，
     * 这里只验证 `_isPaused` 在三个独立标志位下都返回 true，
     * 不调用 show()（避免触碰 _build → ResizeObserver）。
     */
    it('折叠 / docHidden / stage 不可见任一为真 → 暂停', () => {
        const dfv = createInstance();

        dfv._collapsed = false;
        dfv._docHidden = false;
        dfv._stageVisible = true;
        expect(dfv._isPaused()).toBe(false);

        dfv._collapsed = true;
        expect(dfv._isPaused()).toBe(true);
        dfv._collapsed = false;

        dfv._docHidden = true;
        expect(dfv._isPaused()).toBe(true);
        dfv._docHidden = false;

        dfv._stageVisible = false;
        expect(dfv._isPaused()).toBe(true);
        dfv._stageVisible = true;
        expect(dfv._isPaused()).toBe(false);
    });
});
