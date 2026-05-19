// @vitest-environment jsdom
/**
 * v1.60.14 — DFV union 高亮的三大守护 invariant 回归。
 *
 * 用户截图反馈：新一轮出块后节点未按规则高亮（DRIVER_NODE_PATHS.gapFills 应该点亮
 * clearGuarantee + clearOpportunity + 5 个上游信号，但 SVG 没进入 driver-mode）。
 *
 * 排查到 3 个 timing bug：
 *   Bug 1：_buildScene 重建 DOM 后 _driverHlSet 仍保留旧 id 集合，导致 _applyHlSet
 *          按 stale 状态做 diff，新 DOM 节点拿不到 .dfv-driver-hl class；
 *   Bug 2：_renderChosenShapes 早返回（sig 未变）不调用 _renderUnionHighlight，
 *          外部时机（resize / 折叠 / 暂存 rAF 被取消）让 driver-mode class 丢失后
 *          无法自动恢复，直到下一次 spawn；
 *   Bug 3：sig 没包含 topDriver.key，"同 shape 不同 driver"切换不刷新 union。
 *
 * 本套件锁 4 件事：
 *   1) _buildScene 调用后 _driverHlSet 必须为空 + driver-mode class 被移除；
 *   2) _renderChosenShapes 触发 chosen 数据填充后 SVG 自动进入 driver-mode；
 *   3) sig 计算包含 topDriver.key（同 id+reason 但 driver key 不同 → dirty=true）；
 *   4) dirty=false 但 driver-mode class 丢失时，_renderChosenShapes 自动重渲 union。
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { __dfvTestables } from '../web/src/decisionFlowViz.js';

const { createInstance } = __dfvTestables;

/** 构造一个最小化的 jsdom DFV 实例 + 注入 SVG container。 */
function mountDfv() {
    const host = document.createElement('div');
    host.id = 'dfv-host';
    host.innerHTML = `
        <div id="dfv-stage" style="width:600px;height:400px"></div>
        <div id="dfv-stage-shock"></div>
        <div id="dfv-dynamics-host"></div>
        <svg id="dfv-svg" width="600" height="400"></svg>
    `;
    document.body.appendChild(host);

    const dfv = createInstance();
    dfv._svg = host.querySelector('#dfv-svg');
    dfv._stageEl = host.querySelector('#dfv-stage');
    dfv._dynamicsHost = host.querySelector('#dfv-dynamics-host');
    dfv._w = 600;
    dfv._h = 400;
    /* 触发 SVG 场景构建（信号节点 / 派生节点 / chosen 节点 DOM 都会被创建） */
    dfv._buildScene();
    return { dfv, host };
}

describe('v1.60.14 — Bug 1 修复：_buildScene 重置 union 状态', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('_buildScene 调用后 _driverHlSet 必须为空集合', () => {
        const { dfv } = mountDfv();
        expect(dfv._driverHlSet, '_driverHlSet 应被重置为 Set').toBeInstanceOf(Set);
        expect(dfv._driverHlSet.size, '_buildScene 后 _driverHlSet.size 必须为 0').toBe(0);
    });

    it('_buildScene 调用后 SVG 必须移除 dfv-svg--driver-mode class', () => {
        const { dfv } = mountDfv();
        dfv._svg.classList.add('dfv-svg--driver-mode');
        dfv._buildScene();
        expect(dfv._svg.classList.contains('dfv-svg--driver-mode'),
            '_buildScene 必须清除 driver-mode 旧状态').toBe(false);
    });

    it('_buildScene 后立即调用 _renderUnionHighlight（有 chosen 数据）能正确加 driver-mode + DOM hl class', () => {
        const { dfv } = mountDfv();
        /* 模拟 union 高亮使用旧的 _driverHlSet（来自上一局），然后重建 */
        dfv._driverHlSet = new Set(['signal:frust', 'strategy:clearGuarantee']);
        dfv._buildScene();
        /* 注入 chosen 数据，driver=gapFills（按 DRIVER_NODE_PATHS 应点亮 clearGuarantee + clearOpportunity） */
        dfv._lastInsight = {
            spawnDiagnostics: {
                chosen: [
                    { id: '2x2', topDriver: { key: 'gapFills', label: '补2缺' } },
                    { id: 't1',  topDriver: { key: 'gapFills', label: '补2缺' } },
                    { id: 'l2',  topDriver: { key: 'gapFills', label: '补2缺' } },
                ],
            },
        };
        dfv._renderUnionHighlight();
        expect(dfv._svg.classList.contains('dfv-svg--driver-mode'),
            '有 chosen + driver 时 SVG 必须进入 driver-mode').toBe(true);
        /* clearGuarantee 派生节点应在 _driverHlSet 中 */
        expect(dfv._driverHlSet.has('strategy:clearGuarantee'),
            'gapFills driver path 必须把 clearGuarantee 加进 hl set').toBe(true);
        expect(dfv._driverHlSet.has('target:clearOpportunity'),
            'gapFills driver path 必须把 clearOpportunity 加进 hl set').toBe(true);
    });
});

describe('v1.60.14 — Bug 2 修复：dirty=false 守护 union baseline', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('dirty=false 且 driver-mode class 丢失时，_renderChosenShapes 自动重渲 union', () => {
        const { dfv } = mountDfv();
        const insight = {
            spawnDiagnostics: {
                chosen: [
                    { id: '2x2', reason: 'clear', topDriver: { key: 'gapFills', label: '补2缺' } },
                    { id: 't1',  reason: 'clear', topDriver: { key: 'gapFills', label: '补2缺' } },
                    { id: 'l2',  reason: 'weighted', topDriver: { key: 'gapFills', label: '补2缺' } },
                ],
                attempt: 0,
            },
        };
        /* 首次渲染：dirty=true → union 应用 */
        dfv._renderChosenShapes(insight);
        expect(dfv._svg.classList.contains('dfv-svg--driver-mode')).toBe(true);

        /* 模拟外部时机让 driver-mode class 丢失（实际场景：折叠/展开 / resize / 暂存 rAF 取消） */
        dfv._svg.classList.remove('dfv-svg--driver-mode');

        /* 再次以相同 sig 调用：dirty=false，但守护逻辑应检测到 class 丢失并重新应用 union */
        dfv._renderChosenShapes(insight);
        expect(dfv._svg.classList.contains('dfv-svg--driver-mode'),
            'dirty=false 路径检测到 driver-mode 丢失须主动重渲 union').toBe(true);
    });

    it('dirty=false 且 driver-mode class 仍在时，不重复调用（性能保护）', () => {
        const { dfv } = mountDfv();
        const insight = {
            spawnDiagnostics: {
                chosen: [
                    { id: '2x2', reason: 'clear', topDriver: { key: 'gapFills', label: '补2缺' } },
                    { id: 't1',  reason: 'clear', topDriver: { key: 'gapFills', label: '补2缺' } },
                    { id: 'l2',  reason: 'weighted', topDriver: { key: 'gapFills', label: '补2缺' } },
                ],
                attempt: 0,
            },
        };
        dfv._renderChosenShapes(insight);

        let unionCalls = 0;
        const orig = dfv._renderUnionHighlight.bind(dfv);
        dfv._renderUnionHighlight = function () { unionCalls++; return orig(); };
        dfv._renderChosenShapes(insight); /* dirty=false，class 仍在 → 不应触发 union */
        expect(unionCalls, '正常 dirty=false 路径不应重复调用 union').toBe(0);
    });
});

describe('v1.60.14 — Bug 3 修复：sig 包含 topDriver.key', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('chosen id+reason 相同但 topDriver.key 切换 → dirty=true → union 重渲', () => {
        const { dfv } = mountDfv();
        const baseChosen = [
            { id: '2x2', reason: 'clear', topDriver: { key: 'gapFills', label: '补2缺' } },
            { id: 't1',  reason: 'clear', topDriver: { key: 'gapFills', label: '补2缺' } },
            { id: 'l2',  reason: 'weighted', topDriver: { key: 'gapFills', label: '补2缺' } },
        ];

        const insight1 = { spawnDiagnostics: { chosen: baseChosen, attempt: 0 } };
        dfv._renderChosenShapes(insight1);
        const sigAfter1 = dfv._lastChosenSig;

        /* 切换：所有 id + reason 完全不变，仅 driver key 从 gapFills 变为 multiClear */
        const insight2 = {
            spawnDiagnostics: {
                chosen: baseChosen.map(c => ({
                    ...c,
                    topDriver: { key: 'multiClear', label: '可消2行' },
                })),
                attempt: 0,
            },
        };
        dfv._renderChosenShapes(insight2);
        const sigAfter2 = dfv._lastChosenSig;

        expect(sigAfter1, 'sig 必须随 topDriver.key 变化而变化').not.toBe(sigAfter2);
        /* multiClear path：schedule.multiClearBonus + multiLineTarget 应在 hl set 中 */
        expect(dfv._driverHlSet.has('schedule:multiClearBonus'),
            'multiClear driver path 必须把 multiClearBonus 加进 hl set').toBe(true);
    });
});

describe('v1.60.14 — Bug 4 综合：新一轮 spawn 后 union 必然刷新', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    it('从一个 chosen 集切换到完全不同的 chosen 集 → union hl set 跟随重计算', () => {
        const { dfv } = mountDfv();

        /* 第一局：3 块都 gapFills */
        dfv._renderChosenShapes({
            spawnDiagnostics: {
                chosen: [
                    { id: '2x2', reason: 'clear', topDriver: { key: 'gapFills', label: '补2缺' } },
                    { id: 't1',  reason: 'clear', topDriver: { key: 'gapFills', label: '补2缺' } },
                    { id: 'l2',  reason: 'weighted', topDriver: { key: 'gapFills', label: '补2缺' } },
                ],
                attempt: 0,
            },
        });
        expect(dfv._driverHlSet.has('strategy:clearGuarantee')).toBe(true);
        expect(dfv._driverHlSet.has('schedule:multiClearBonus'),
            'gapFills 不应点亮 schedule:multiClearBonus（gapFills.schedule=[]）').toBe(false);

        /* 第二局：3 块都 pcPotential（清屏路径）→ schedule.perfectClearBoost + intent 应被点亮 */
        dfv._renderChosenShapes({
            spawnDiagnostics: {
                chosen: [
                    { id: 'i5', reason: 'perfectClear', topDriver: { key: 'pcPotential', label: '可清屏' } },
                    { id: 'i4', reason: 'perfectClear', topDriver: { key: 'pcPotential', label: '可清屏' } },
                    { id: 'i3', reason: 'perfectClear', topDriver: { key: 'pcPotential', label: '可清屏' } },
                ],
                attempt: 0,
            },
        });
        expect(dfv._driverHlSet.has('schedule:perfectClearBoost'),
            'pcPotential driver path 必须点亮 perfectClearBoost').toBe(true);
        expect(dfv._driverHlSet.has('intent:_'),
            'pcPotential.intent=true 必须点亮 intent 节点').toBe(true);
        expect(dfv._driverHlSet.has('strategy:clearGuarantee'),
            '切换后旧的 gapFills hl 必须被清除').toBe(false);
    });
});
