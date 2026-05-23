/**
 * @vitest-environment jsdom
 *
 * tests/insightMetricModal.test.js
 *
 * 校验「指标详读」浮层：
 *   1) splitTooltipForModal 按"📈 看图："正确拆分含义/分析
 *   2) summarizePoints 计算 min/max/avg/last/count
 *   3) nearestPointByIdx 找最近样本
 *   4) openInsightMetricModal 创建 backdrop + plot + 含义/分析段
 *   5) 关闭按钮 / Esc / 点击 backdrop 都能关闭
 *   6) 重复 open 不残留旧 overlay（替换为新指标）
 *   7) data 为空数组时仍能弹出（不抛错）
 *   8) 注入的 fallback stylesheet 仅一份（id 去重）
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    openInsightMetricModal,
    closeInsightMetricModal,
    splitTooltipForModal,
    summarizePoints,
    nearestPointByIdx,
    formatElapsedMs,
} from '../web/src/insightMetricModal.js';

const SAMPLE_TOOLTIP =
    '心流偏移 F(t)：衡量当前挑战强度与玩家能力匹配程度（0 为理想心流区）。\n📈 看图：< 0.25 = 沉浸区；> 0.55 = 显著偏移。';

const SAMPLE_DATA = {
    points: [
        { idx: 0,  value: 0.10 },
        { idx: 5,  value: 0.30 },
        { idx: 10, value: 0.55 },
        { idx: 15, value: 0.42 },
        { idx: 20, value: 0.18 },
    ],
    totalFrames: 21,
};

describe('insightMetricModal — 工具函数', () => {
    it('splitTooltipForModal 按 📈 拆分含义/分析两段', () => {
        const r = splitTooltipForModal(SAMPLE_TOOLTIP);
        expect(r.meaning.startsWith('心流偏移')).toBe(true);
        expect(r.meaning.includes('📈')).toBe(false);
        expect(r.analysis.startsWith('< 0.25')).toBe(true);
        expect(r.analysis.includes('看图')).toBe(false);
    });

    it('splitTooltipForModal 无 📈 时全部归到含义', () => {
        const r = splitTooltipForModal('只是简单含义说明，没有曲线分析。');
        expect(r.meaning).toBe('只是简单含义说明，没有曲线分析。');
        expect(r.analysis).toBe('');
    });

    it('splitTooltipForModal 空入参 → 两段皆空', () => {
        expect(splitTooltipForModal('')).toEqual({ meaning: '', analysis: '' });
        expect(splitTooltipForModal(null)).toEqual({ meaning: '', analysis: '' });
        expect(splitTooltipForModal(undefined)).toEqual({ meaning: '', analysis: '' });
    });

    it('summarizePoints 给出 min/max/avg/last/count', () => {
        const s = summarizePoints(SAMPLE_DATA.points);
        expect(s.count).toBe(5);
        expect(s.min).toBeCloseTo(0.10);
        expect(s.max).toBeCloseTo(0.55);
        expect(s.avg).toBeCloseTo((0.10 + 0.30 + 0.55 + 0.42 + 0.18) / 5);
        expect(s.last).toBeCloseTo(0.18);
    });

    it('summarizePoints 空数组 → 全 null', () => {
        const s = summarizePoints([]);
        expect(s).toEqual({ count: 0, min: null, max: null, avg: null, last: null });
    });

    it('nearestPointByIdx 找到最接近 idx 的样本', () => {
        expect(nearestPointByIdx(SAMPLE_DATA.points, 6).idx).toBe(5);
        expect(nearestPointByIdx(SAMPLE_DATA.points, 8).idx).toBe(10);
        expect(nearestPointByIdx(SAMPLE_DATA.points, 0).idx).toBe(0);
        expect(nearestPointByIdx(SAMPLE_DATA.points, 100).idx).toBe(20);
    });

    it('nearestPointByIdx 空数组 → null', () => {
        expect(nearestPointByIdx([], 5)).toBeNull();
    });
});

describe('insightMetricModal — 浮层生命周期', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });

    afterEach(() => {
        closeInsightMetricModal();
        document.body.innerHTML = '';
    });

    function _openSample(overrides = {}) {
        return openInsightMetricModal({
            metricKey: 'flowDeviation',
            label: 'F(t)',
            group: 'state',
            fmt: 'f2',
            color: '#fbbf24',
            tooltip: SAMPLE_TOOLTIP,
            data: SAMPLE_DATA,
            ...overrides,
        });
    }

    it('open 创建 backdrop + plot + 摘要 + 两段说明', () => {
        const handle = _openSample();
        expect(handle).not.toBeNull();
        const backdrop = document.querySelector('.insight-metric-modal-backdrop');
        expect(backdrop).not.toBeNull();
        expect(backdrop.querySelector('.imm-title').textContent).toBe('F(t)');
        expect(backdrop.querySelector('.imm-key').textContent).toBe('flowDeviation');
        expect(backdrop.querySelector('.imm-plot')).not.toBeNull();
        // 折线 polyline 应该被绘制（5 个点 → polyline 存在）
        expect(backdrop.querySelector('polyline')).not.toBeNull();
        // 含义 + 分析两段
        const titles = Array.from(backdrop.querySelectorAll('.imm-section-title')).map((n) => n.textContent);
        expect(titles).toEqual(['物理含义', '曲线分析']);
        // 摘要 5 项
        expect(backdrop.querySelectorAll('.imm-summary li').length).toBe(5);
    });

    it('信息布局：物理含义在图表上方，曲线分析在图表下方', () => {
        _openSample();
        const modal = document.querySelector('.insight-metric-modal');
        const children = Array.from(modal.children);
        const meaningIdx = children.findIndex((n) => n.classList?.contains('imm-section--meaning'));
        const plotIdx    = children.findIndex((n) => n.classList?.contains('imm-plot-wrap'));
        const analysisIdx = children.findIndex((n) => n.classList?.contains('imm-section--analysis'));
        expect(meaningIdx).toBeGreaterThanOrEqual(0);
        expect(plotIdx).toBeGreaterThan(meaningIdx);
        expect(analysisIdx).toBeGreaterThan(plotIdx);
    });

    it('readout 默认显示当前游标对应数据（默认最后一帧）', () => {
        _openSample(); // cursorIdx 默认 → totalFrames - 1 = 20，最近点是 idx=20 / value=0.18
        const value = document.querySelector('[data-role="value"]').textContent;
        expect(value).toBe('0.18');
        const frame = document.querySelector('[data-role="frame"]').textContent;
        expect(frame).toBe('# 21 / 21');
        const pct = document.querySelector('[data-role="pct"]').textContent;
        expect(pct).toBe('100%');
    });

    it('cursorIdx 可显式指定，readout 跟随', () => {
        _openSample({ cursorIdx: 5 });
        expect(document.querySelector('[data-role="value"]').textContent).toBe('0.30');
        expect(document.querySelector('[data-role="frame"]').textContent).toBe('# 6 / 21');
    });

    it('点击 backdrop 关闭浮层', () => {
        _openSample();
        const backdrop = document.querySelector('.insight-metric-modal-backdrop');
        backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        expect(document.querySelector('.insight-metric-modal-backdrop')).toBeNull();
    });

    it('点击关闭按钮关闭浮层', () => {
        _openSample();
        document.querySelector('.imm-close').click();
        expect(document.querySelector('.insight-metric-modal-backdrop')).toBeNull();
    });

    it('Esc 键关闭浮层', () => {
        _openSample();
        const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
        document.dispatchEvent(ev);
        expect(document.querySelector('.insight-metric-modal-backdrop')).toBeNull();
    });

    it('重复 open 不残留旧 overlay（替换）', () => {
        _openSample({ metricKey: 'a', label: 'A' });
        _openSample({ metricKey: 'b', label: 'B' });
        const all = document.querySelectorAll('.insight-metric-modal-backdrop');
        expect(all.length).toBe(1);
        expect(all[0].querySelector('.imm-title').textContent).toBe('B');
        expect(all[0].getAttribute('data-metric-key')).toBe('b');
    });

    it('data.points 为空时也能弹出，不抛错（无 polyline）', () => {
        expect(() =>
            _openSample({
                data: { points: [], totalFrames: 0 },
            })
        ).not.toThrow();
        const backdrop = document.querySelector('.insight-metric-modal-backdrop');
        expect(backdrop).not.toBeNull();
        // 没数据 → 没有 polyline
        expect(backdrop.querySelector('polyline')).toBeNull();
        // readout 三个槽位仍然渲染 dash（没有最近点 → setText 未触发）
        expect(document.querySelector('[data-role="value"]').textContent).toBe('—');
    });

    it('fallback stylesheet 只注入一份（id 去重）', () => {
        _openSample();
        closeInsightMetricModal();
        _openSample();
        const styles = document.querySelectorAll('#insight-metric-modal-fallback-styles');
        expect(styles.length).toBe(1);
    });

    it('cell 内容 HTML escape 安全（防 XSS）', () => {
        _openSample({ metricKey: '<x>', label: '<img onerror=alert(1)>' });
        const backdrop = document.querySelector('.insight-metric-modal-backdrop');
        const title = backdrop.querySelector('.imm-title');
        expect(title.textContent).toBe('<img onerror=alert(1)>');
        // 不应解析为真实标签
        expect(title.querySelector('img')).toBeNull();
    });
});

/* ============================================================
 * v1.61：副坐标 + 时长 X 轴
 * ============================================================ */

describe('insightMetricModal — formatElapsedMs', () => {
    it('0ms → 0:00', () => {
        expect(formatElapsedMs(0)).toBe('0:00');
    });
    it('小于 1 分钟显示秒', () => {
        expect(formatElapsedMs(12_000)).toBe('0:12');
        expect(formatElapsedMs(59_999)).toBe('0:59');
    });
    it('1 小时以内显示 mm:ss', () => {
        expect(formatElapsedMs(95_000)).toBe('1:35');
        expect(formatElapsedMs(60_000)).toBe('1:00');
        expect(formatElapsedMs(3_599_000)).toBe('59:59');
    });
    it('1 小时以上显示 h:mm:ss', () => {
        expect(formatElapsedMs(3_600_000)).toBe('1:00:00');
        expect(formatElapsedMs(3_725_000)).toBe('1:02:05');
    });
    it('非有限/负数 → —', () => {
        expect(formatElapsedMs(null)).toBe('—');
        expect(formatElapsedMs(undefined)).toBe('—');
        expect(formatElapsedMs(NaN)).toBe('—');
        expect(formatElapsedMs(-1)).toBe('—');
    });
});

describe('insightMetricModal — 副坐标下拉（双指标对比）', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });
    afterEach(() => {
        closeInsightMetricModal();
        document.body.innerHTML = '';
    });

    const ALL_SERIES = {
        flowDeviation: {
            metricKey: 'flowDeviation',
            label: 'F(t)',
            group: 'state',
            fmt: 'f2',
            color: '#fbbf24',
            tooltip: '',
            points: SAMPLE_DATA.points,
        },
        clearRate: {
            metricKey: 'clearRate',
            label: '消行率',
            group: 'ability',
            fmt: 'pct',
            color: '#27ae60',
            tooltip: '',
            points: [
                { idx: 0,  value: 1.00 },
                { idx: 5,  value: 0.50 },
                { idx: 10, value: 0.33 },
                { idx: 15, value: 0.50 },
                { idx: 20, value: 0.50 },
            ],
        },
        boardFill: {
            metricKey: 'boardFill',
            label: '板面',
            group: 'game',
            fmt: 'pct',
            color: '#5b9bd5',
            tooltip: '',
            points: [
                { idx: 0, value: 0.10 },
                { idx: 10, value: 0.40 },
                { idx: 20, value: 0.65 },
            ],
        },
    };

    function _open(overrides = {}) {
        return openInsightMetricModal({
            metricKey: 'flowDeviation',
            label: 'F(t)',
            group: 'state',
            fmt: 'f2',
            color: '#fbbf24',
            tooltip: SAMPLE_TOOLTIP,
            data: SAMPLE_DATA,
            allSeries: ALL_SERIES,
            ...overrides,
        });
    }

    it('默认渲染副坐标下拉，列出除自身以外的指标', () => {
        _open();
        const select = document.querySelector('[data-role="secondary-select"]');
        expect(select).not.toBeNull();
        const values = Array.from(select.options).map((o) => o.value);
        // 第一个永远是 ''（无），其余按 allSeries 顺序排列，剔除主指标
        expect(values[0]).toBe('');
        expect(values).toContain('clearRate');
        expect(values).toContain('boardFill');
        expect(values).not.toContain('flowDeviation');
    });

    it('未传 allSeries 时，下拉不渲染（保持原 UI）', () => {
        _open({ allSeries: undefined });
        expect(document.querySelector('[data-role="secondary-select"]')).toBeNull();
        // 默认情况下副值 readout cell 也保持 hidden
        const cellSecondary = document.querySelector('[data-role="cell-secondary"]');
        expect(cellSecondary?.hasAttribute('hidden')).toBe(true);
    });

    it('选中副指标后，绘制虚线副曲线并显示副值 readout', () => {
        const handle = _open();
        // 初始：只有主曲线，没有副曲线
        let lines = document.querySelectorAll('polyline');
        expect(lines.length).toBe(1);
        const cellSecondary = document.querySelector('[data-role="cell-secondary"]');
        expect(cellSecondary?.hasAttribute('hidden')).toBe(true);

        // 用编程式 setSecondary 切换（更稳定，不依赖 jsdom Select change 事件）
        handle.setSecondary('clearRate');

        lines = document.querySelectorAll('polyline');
        expect(lines.length).toBe(2);
        const secondaryLine = document.querySelector('.imm-line--secondary');
        expect(secondaryLine).not.toBeNull();
        expect(secondaryLine.getAttribute('stroke-dasharray')).not.toBeNull();
        expect(secondaryLine.getAttribute('stroke')).toBe('#27ae60');

        // 副值 readout cell 出现，标签为副指标名
        expect(cellSecondary?.hasAttribute('hidden')).toBe(false);
        const tag = document.querySelector('[data-role="secondary-tag"]');
        expect(tag.textContent).toBe('消行率');
        // 默认 cursorIdx = totalFrames - 1 = 20，clearRate@idx=20 = 0.50 → pct 50%
        const valSecondary = document.querySelector('[data-role="value-secondary"]').textContent;
        expect(valSecondary).toBe('50%');
    });

    it('副指标切换可来回切，无残留 polyline', () => {
        const handle = _open();
        handle.setSecondary('clearRate');
        expect(document.querySelectorAll('polyline').length).toBe(2);
        handle.setSecondary('boardFill');
        // 切换后还是 2 条（主 + 副），不会累积
        expect(document.querySelectorAll('polyline').length).toBe(2);
        const tag = document.querySelector('[data-role="secondary-tag"]');
        expect(tag.textContent).toBe('板面');
        handle.setSecondary(null);
        // 取消副指标后只剩主线
        expect(document.querySelectorAll('polyline').length).toBe(1);
        const cell = document.querySelector('[data-role="cell-secondary"]');
        expect(cell?.hasAttribute('hidden')).toBe(true);
    });

    it('select change 事件触发副坐标渲染', () => {
        _open();
        const select = document.querySelector('[data-role="secondary-select"]');
        select.value = 'boardFill';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const tag = document.querySelector('[data-role="secondary-tag"]');
        expect(tag.textContent).toBe('板面');
        expect(document.querySelectorAll('polyline').length).toBe(2);
    });

    it('主曲线自身从下拉中排除，避免"主 = 副"', () => {
        _open();
        const select = document.querySelector('[data-role="secondary-select"]');
        const values = Array.from(select.options).map((o) => o.value);
        expect(values.includes('flowDeviation')).toBe(false);
    });
});

describe('insightMetricModal — 副坐标下拉按类别分组（optgroup）', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });
    afterEach(() => {
        closeInsightMetricModal();
        document.body.innerHTML = '';
    });

    const ALL_SERIES = {
        flowDeviation: {
            metricKey: 'flowDeviation', label: 'F(t)', group: 'state', fmt: 'f2',
            color: '#fbbf24', tooltip: '', points: SAMPLE_DATA.points,
        },
        clearRate: {
            metricKey: 'clearRate', label: '消行率', group: 'ability', fmt: 'pct',
            color: '#27ae60', tooltip: '',
            points: [{ idx: 0, value: 0.5 }, { idx: 20, value: 0.5 }],
        },
        skill: {
            metricKey: 'skill', label: '技能', group: 'ability', fmt: 'pct',
            color: '#27ae60', tooltip: '',
            points: [{ idx: 0, value: 0.5 }, { idx: 20, value: 0.5 }],
        },
        boardFill: {
            metricKey: 'boardFill', label: '板面', group: 'game', fmt: 'pct',
            color: '#5b9bd5', tooltip: '',
            points: [{ idx: 0, value: 0.1 }, { idx: 20, value: 0.5 }],
        },
        stress: {
            metricKey: 'stress', label: '压力', group: 'spawn', fmt: 'f2',
            color: '#8e44ad', tooltip: '',
            points: [{ idx: 0, value: 0.3 }, { idx: 20, value: 0.6 }],
        },
    };

    const SECONDARY_GROUPS = [
        { group: 'game',    title: '🎮 盘面',           keys: ['boardFill'] },
        { group: 'ability', title: '👤 玩家·能力',       keys: ['clearRate', 'skill'] },
        { group: 'state',   title: '👤 玩家·状态',       keys: ['flowDeviation'] },
        { group: 'spawn',   title: '⚙️ 系统·决策',       keys: ['stress'] },
    ];

    function _open(overrides = {}) {
        return openInsightMetricModal({
            metricKey: 'flowDeviation', label: 'F(t)', group: 'state',
            fmt: 'f2', color: '#fbbf24',
            tooltip: SAMPLE_TOOLTIP,
            data: SAMPLE_DATA,
            allSeries: ALL_SERIES,
            secondaryGroups: SECONDARY_GROUPS,
            ...overrides,
        });
    }

    it('下拉用 optgroup 分组渲染，标题取自 secondaryGroups[i].title', () => {
        _open();
        const select = document.querySelector('[data-role="secondary-select"]');
        const groups = Array.from(select.querySelectorAll('optgroup'));
        // 主指标在 state 组，state 组里只剩 flowDeviation 一个 → 整个 state 组隐藏
        // 剩 game / ability / spawn 三组
        expect(groups.map((g) => g.label)).toEqual(['🎮 盘面', '👤 玩家·能力', '⚙️ 系统·决策']);
    });

    it('每个 optgroup 内 option 顺序与 keys 一致', () => {
        _open();
        const ability = document.querySelector(
            '[data-role="secondary-select"] optgroup[label="👤 玩家·能力"]'
        );
        const values = Array.from(ability.querySelectorAll('option')).map((o) => o.value);
        expect(values).toEqual(['clearRate', 'skill']);
    });

    it('整组只剩主指标自身时，该组不渲染（避免空 optgroup）', () => {
        // state 组只挂 flowDeviation，且就是主指标 → 整个 state 组不应出现
        _open();
        const labels = Array.from(
            document.querySelectorAll('[data-role="secondary-select"] optgroup')
        ).map((g) => g.label);
        expect(labels).not.toContain('👤 玩家·状态');
    });

    it('keys 里指向不存在 series 的项被静默跳过', () => {
        _open({
            secondaryGroups: [
                { group: 'game', title: '🎮 盘面', keys: ['boardFill', 'ghostKey'] },
            ],
        });
        const game = document.querySelector(
            '[data-role="secondary-select"] optgroup[label="🎮 盘面"]'
        );
        const values = Array.from(game.querySelectorAll('option')).map((o) => o.value);
        expect(values).toEqual(['boardFill']);
    });

    it('未被任何分组接管的候选项落入"其它"组（兜底）', () => {
        // 只声明 ability 一组、剩余 boardFill / stress 会被收编到"其它"
        _open({
            secondaryGroups: [
                { group: 'ability', title: '👤 玩家·能力', keys: ['clearRate', 'skill'] },
            ],
        });
        const other = document.querySelector(
            '[data-role="secondary-select"] optgroup[label="其它"]'
        );
        expect(other).not.toBeNull();
        const values = Array.from(other.querySelectorAll('option')).map((o) => o.value);
        // 顺序按 ALL_SERIES 中的 candidate 顺序（除自身、除已被接管者）
        expect(values).toEqual(expect.arrayContaining(['boardFill', 'stress']));
        expect(values.length).toBe(2);
    });

    it('未传 secondaryGroups → 退化为平铺，无 optgroup', () => {
        _open({ secondaryGroups: undefined });
        const select = document.querySelector('[data-role="secondary-select"]');
        expect(select.querySelectorAll('optgroup').length).toBe(0);
        const values = Array.from(select.querySelectorAll('option'))
            .filter((o) => o.value)
            .map((o) => o.value);
        // 平铺包含除主指标外的所有候选
        expect(values).toContain('clearRate');
        expect(values).toContain('boardFill');
        expect(values).not.toContain('flowDeviation');
    });

    it('分组渲染下，主指标依旧被剔除（出现在分组中也不会渲染为 option）', () => {
        // ability 组里恶意混入主指标 key——应被剔除
        _open({
            metricKey: 'clearRate',
            label: '消行率',
            color: '#27ae60',
            secondaryGroups: [
                { group: 'ability', title: '👤 玩家·能力', keys: ['clearRate', 'skill'] },
            ],
        });
        const ability = document.querySelector(
            '[data-role="secondary-select"] optgroup[label="👤 玩家·能力"]'
        );
        const values = Array.from(ability.querySelectorAll('option')).map((o) => o.value);
        expect(values).toEqual(['skill']);
        expect(values).not.toContain('clearRate');
    });

    it('用户从分组下拉中选择，依旧能正确切到副坐标', () => {
        _open();
        const select = document.querySelector('[data-role="secondary-select"]');
        select.value = 'clearRate';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        const tag = document.querySelector('[data-role="secondary-tag"]');
        expect(tag.textContent).toBe('消行率');
        expect(document.querySelectorAll('polyline').length).toBe(2);
    });
});

describe('insightMetricModal — 副指标含义/分析同框展示', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });
    afterEach(() => {
        closeInsightMetricModal();
        document.body.innerHTML = '';
    });

    /* 主：F(t)；副：消行率（带完整 tooltip 含「📈 看图」分隔） */
    const ALL_SERIES = {
        flowDeviation: {
            metricKey: 'flowDeviation', label: 'F(t)', group: 'state', fmt: 'f2',
            color: '#fbbf24', tooltip: '', points: SAMPLE_DATA.points,
        },
        clearRate: {
            metricKey: 'clearRate', label: '消行率', group: 'ability', fmt: 'pct',
            color: '#27ae60',
            tooltip: '近期窗口内「落子后成功消行」的步数占比。\n📈 看图：> 50% 通常对应舒适流畅区；< 30% 是关键阈值。',
            points: [
                { idx: 0, value: 0.30 },
                { idx: 10, value: 0.55 },
                { idx: 20, value: 0.42 },
            ],
        },
        boardFill: {
            metricKey: 'boardFill', label: '板面', group: 'game', fmt: 'pct',
            color: '#5b9bd5',
            tooltip: '', // 没 tooltip → 应显示两条占位
            points: [
                { idx: 0, value: 0.1 },
                { idx: 10, value: 0.4 },
                { idx: 20, value: 0.7 },
            ],
        },
    };

    function _open(overrides = {}) {
        return openInsightMetricModal({
            metricKey: 'flowDeviation', label: 'F(t)', group: 'state',
            fmt: 'f2', color: '#fbbf24',
            tooltip: SAMPLE_TOOLTIP,
            data: SAMPLE_DATA,
            allSeries: ALL_SERIES,
            ...overrides,
        });
    }

    it('未选副指标时，含义/分析的 aux 槽位 hidden 且为空', () => {
        _open();
        const meaningAux = document.querySelector('[data-role="meaning-secondary"]');
        const analysisAux = document.querySelector('[data-role="analysis-secondary"]');
        expect(meaningAux).not.toBeNull();
        expect(analysisAux).not.toBeNull();
        expect(meaningAux.hasAttribute('hidden')).toBe(true);
        expect(analysisAux.hasAttribute('hidden')).toBe(true);
        expect(meaningAux.innerHTML).toBe('');
        expect(analysisAux.innerHTML).toBe('');
    });

    it('选副指标后，含义和分析两段同时填充并显示', () => {
        const handle = _open();
        handle.setSecondary('clearRate');

        const meaningAux = document.querySelector('[data-role="meaning-secondary"]');
        const analysisAux = document.querySelector('[data-role="analysis-secondary"]');
        expect(meaningAux.hasAttribute('hidden')).toBe(false);
        expect(analysisAux.hasAttribute('hidden')).toBe(false);

        // head 显示副指标名 + key
        expect(meaningAux.querySelector('.imm-aux-label').textContent).toBe('消行率');
        expect(meaningAux.querySelector('.imm-aux-key').textContent).toBe('clearRate');
        expect(analysisAux.querySelector('.imm-aux-label').textContent).toBe('消行率');

        // body 内容来自 splitTooltipForModal 拆分
        const meaningBody = meaningAux.querySelector('.imm-aux-body').textContent;
        expect(meaningBody).toContain('落子后成功消行');
        expect(meaningBody.includes('📈')).toBe(false);

        const analysisBody = analysisAux.querySelector('.imm-aux-body--analysis').textContent;
        expect(analysisBody).toContain('> 50%');
        expect(analysisBody.includes('看图')).toBe(false);
    });

    it('副指标无 tooltip 时，两段显示占位文案', () => {
        const handle = _open();
        handle.setSecondary('boardFill');
        const meaningAux = document.querySelector('[data-role="meaning-secondary"]');
        const analysisAux = document.querySelector('[data-role="analysis-secondary"]');
        expect(meaningAux.hasAttribute('hidden')).toBe(false);
        expect(analysisAux.hasAttribute('hidden')).toBe(false);
        expect(meaningAux.querySelector('.imm-empty')?.textContent).toBe('该指标暂无含义说明。');
        expect(analysisAux.querySelector('.imm-empty')?.textContent).toBe('该指标暂无曲线分析。');
    });

    it('色点颜色与副指标色绑定（CSS var --imm-aux-color）', () => {
        const handle = _open();
        handle.setSecondary('clearRate');
        const head = document.querySelector('[data-role="meaning-secondary"] .imm-aux-head');
        expect(head.getAttribute('style')).toContain('#27ae60');
        const dot = head.querySelector('.imm-aux-dot');
        expect(dot.getAttribute('style')).toContain('#27ae60');
    });

    it('取消副指标后，两段恢复 hidden 且清空内容', () => {
        const handle = _open();
        handle.setSecondary('clearRate');
        handle.setSecondary(null);
        const meaningAux = document.querySelector('[data-role="meaning-secondary"]');
        const analysisAux = document.querySelector('[data-role="analysis-secondary"]');
        expect(meaningAux.hasAttribute('hidden')).toBe(true);
        expect(analysisAux.hasAttribute('hidden')).toBe(true);
        expect(meaningAux.innerHTML).toBe('');
        expect(analysisAux.innerHTML).toBe('');
    });

    it('副指标切换时内容实时更新（不残留前一个）', () => {
        const handle = _open();
        handle.setSecondary('clearRate');
        expect(
            document.querySelector('[data-role="meaning-secondary"] .imm-aux-label').textContent
        ).toBe('消行率');
        handle.setSecondary('boardFill');
        expect(
            document.querySelector('[data-role="meaning-secondary"] .imm-aux-label').textContent
        ).toBe('板面');
    });

    it('主指标摘要行始终带"主指标"归属标记 + 名称 + key', () => {
        _open();
        const primaryRow = document.querySelector('.imm-summary-row--primary');
        expect(primaryRow).not.toBeNull();
        expect(primaryRow.querySelector('.imm-summary-row-label').textContent).toBe('F(t)');
        expect(primaryRow.querySelector('.imm-summary-row-key').textContent).toBe('flowDeviation');
        expect(primaryRow.querySelector('.imm-summary-row-tag').textContent).toBe('主指标');
        // 主指标行始终可见
        expect(primaryRow.hasAttribute('hidden')).toBe(false);
    });

    it('未选副指标时，副指标摘要行 hidden 且为空', () => {
        _open();
        const secondaryRow = document.querySelector('[data-role="summary-secondary"]');
        expect(secondaryRow).not.toBeNull();
        expect(secondaryRow.hasAttribute('hidden')).toBe(true);
        expect(secondaryRow.innerHTML).toBe('');
        // 默认情况下：主行 5 个统计格、副行 0 个 → 总共 5 个 li（保持旧行为不变）
        expect(document.querySelectorAll('.imm-summary li').length).toBe(5);
    });

    it('选副指标后，副指标摘要行渲染独立的 min/max/avg/last/样本', () => {
        const handle = _open();
        handle.setSecondary('clearRate');
        const secondaryRow = document.querySelector('[data-role="summary-secondary"]');
        expect(secondaryRow.hasAttribute('hidden')).toBe(false);
        // 副行的 5 个统计格
        const items = secondaryRow.querySelectorAll('.imm-summary--secondary li');
        expect(items.length).toBe(5);
        const labels = Array.from(items).map((li) => li.querySelector('span').textContent);
        expect(labels).toEqual(['min', 'max', 'avg', 'last', '样本']);
        // clearRate fmt=pct：min=0.30 → 30%、max=0.55 → 55%、last=0.42 → 42%
        const values = Array.from(items).map((li) => li.querySelector('b').textContent);
        expect(values[0]).toBe('30%');
        expect(values[1]).toBe('55%');
        expect(values[3]).toBe('42%');
        // 副指标行 head：色点 + 名称 + key + "副指标" tag
        expect(secondaryRow.querySelector('.imm-summary-row-label').textContent).toBe('消行率');
        expect(secondaryRow.querySelector('.imm-summary-row-key').textContent).toBe('clearRate');
        expect(secondaryRow.querySelector('.imm-summary-row-tag').textContent).toBe('副指标');
    });

    it('主指标摘要不会被副指标渲染串改（值仍来自 SAMPLE_DATA）', () => {
        const handle = _open();
        handle.setSecondary('clearRate');
        const primaryRow = document.querySelector('.imm-summary-row--primary');
        const items = primaryRow.querySelectorAll('.imm-summary li');
        expect(items.length).toBe(5);
        // F(t) fmt=f2：SAMPLE_DATA 中 min=0.10、max=0.55、last=0.18
        const values = Array.from(items).map((li) => li.querySelector('b').textContent);
        expect(values[0]).toBe('0.10');
        expect(values[1]).toBe('0.55');
        expect(values[3]).toBe('0.18');
        // 主行始终标"主指标"，不会变 "副指标"
        expect(primaryRow.querySelector('.imm-summary-row-tag').textContent).toBe('主指标');
    });

    it('切换副指标时摘要行实时刷新（不残留前一个）', () => {
        const handle = _open();
        handle.setSecondary('clearRate');
        expect(
            document.querySelector('[data-role="summary-secondary"] .imm-summary-row-label').textContent
        ).toBe('消行率');
        handle.setSecondary('boardFill');
        const secondaryRow = document.querySelector('[data-role="summary-secondary"]');
        expect(secondaryRow.querySelector('.imm-summary-row-label').textContent).toBe('板面');
        // boardFill fmt=pct，min=0.10 → 10%、last=0.70 → 70%
        const items = secondaryRow.querySelectorAll('.imm-summary--secondary li');
        const values = Array.from(items).map((li) => li.querySelector('b').textContent);
        expect(values[0]).toBe('10%');
        expect(values[3]).toBe('70%');
    });

    it('取消副指标后，摘要行恢复 hidden 且清空', () => {
        const handle = _open();
        handle.setSecondary('clearRate');
        handle.setSecondary(null);
        const secondaryRow = document.querySelector('[data-role="summary-secondary"]');
        expect(secondaryRow.hasAttribute('hidden')).toBe(true);
        expect(secondaryRow.innerHTML).toBe('');
        // 副行清空后 .imm-summary li 总数回到 5
        expect(document.querySelectorAll('.imm-summary li').length).toBe(5);
    });

    it('副指标含义/分析 HTML escape 安全', () => {
        const handle = _open({
            allSeries: {
                ...ALL_SERIES,
                evil: {
                    metricKey: 'evil', label: '<img src=x onerror=alert(1)>',
                    group: 'state', fmt: 'f2', color: '#f00',
                    tooltip: '<script>boom</script>\n📈 <b>看图</b>：<i>nope</i>',
                    points: [{ idx: 0, value: 0 }],
                },
            },
        });
        handle.setSecondary('evil');
        const meaningAux = document.querySelector('[data-role="meaning-secondary"]');
        // 标签按 textContent 读出原文，但不应解析为 DOM 节点
        expect(meaningAux.querySelector('.imm-aux-label').textContent).toBe('<img src=x onerror=alert(1)>');
        expect(meaningAux.querySelector('img')).toBeNull();
        expect(meaningAux.querySelector('script')).toBeNull();
        const analysisAux = document.querySelector('[data-role="analysis-secondary"]');
        expect(analysisAux.querySelector('b')).toBeNull();
        expect(analysisAux.querySelector('i')).toBeNull();
    });
});

describe('insightMetricModal — 时长 X 轴', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
    });
    afterEach(() => {
        closeInsightMetricModal();
        document.body.innerHTML = '';
    });

    function _open(overrides = {}) {
        // 21 帧、12 秒/帧（让总时长 240s = 4:00）
        const frameTimestamps = Array.from({ length: 21 }, (_, i) => i * 12_000);
        return openInsightMetricModal({
            metricKey: 'flowDeviation',
            label: 'F(t)',
            group: 'state',
            fmt: 'f2',
            color: '#fbbf24',
            tooltip: SAMPLE_TOOLTIP,
            data: SAMPLE_DATA,
            frameTimestamps,
            ...overrides,
        });
    }

    it('启用 frameTimestamps → X 轴刻度显示 mm:ss，readout 显示时长', () => {
        _open();
        // X 轴 4 段共 5 个刻度：0:00, 1:00, 2:00, 3:00, 4:00
        const xLabels = Array.from(document.querySelectorAll('.imm-axis-label--x'))
            .map((n) => n.textContent);
        expect(xLabels).toEqual(['0:00', '1:00', '2:00', '3:00', '4:00']);
        // readout 的时长格（默认 cursorIdx 末帧 idx=20 → 240_000ms = 4:00）
        const time = document.querySelector('[data-role="time"]').textContent;
        expect(time).toBe('4:00');
        // hint 文案显示横坐标模式
        const hint = document.querySelector('.imm-readout-hint').textContent;
        expect(hint).toContain('时长');
    });

    it('未传 frameTimestamps → 退化为 #N 帧序号', () => {
        _open({ frameTimestamps: undefined });
        const xLabels = Array.from(document.querySelectorAll('.imm-axis-label--x'))
            .map((n) => n.textContent);
        expect(xLabels.every((s) => s.startsWith('#'))).toBe(true);
        // readout 的 time 字段在无时间戳时显示 —
        const time = document.querySelector('[data-role="time"]').textContent;
        expect(time).toBe('—');
        // hint 显示帧
        const hint = document.querySelector('.imm-readout-hint').textContent;
        expect(hint).toContain('帧');
    });

    it('cursorIdx 指定帧时，readout.time 准确读出对应 ms', () => {
        // cursorIdx = 5 → idx=5 → 60_000ms = 1:00
        _open({ cursorIdx: 5 });
        expect(document.querySelector('[data-role="time"]').textContent).toBe('1:00');
        expect(document.querySelector('[data-role="frame"]').textContent).toBe('# 6 / 21');
    });
});
