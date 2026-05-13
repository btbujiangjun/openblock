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
