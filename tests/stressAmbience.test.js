/**
 * @vitest-environment jsdom
 *
 * v1.57 stress 感知化层（stressAmbience.js）契约测试
 *
 * 验证 4 档反馈渠道（A 棋盘氛围光 / B 呼吸节奏 / C 震动幅度 / D 音频滤波）
 * 在不同 stress norm 输入下都能正确产生玩家可感知的差异化。
 *
 * 策略隐性原则验证（v1.56.3）：
 *   - 所有反馈都不通过文字 / 数字传达（不写 textContent）
 *   - 只通过 CSS 变量 / 装饰器 / 音频参数渗透到感官
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    STRESS_AMBIENCE_BANDS,
    getStressAmbience,
    applyStressToDOM,
    attachStressShakeMultiplier,
    attachStressAudioFilter,
    pushStressAmbience
} from '../web/src/stressAmbience.js';

describe('stressAmbience: 6 档氛围映射（与 stressMeter.STRESS_LEVELS 同步）', () => {
    it('STRESS_AMBIENCE_BANDS 必须为 6 档（calm/easy/flow/engaged/tense/intense）', () => {
        const ids = STRESS_AMBIENCE_BANDS.map((b) => b.id);
        expect(ids).toEqual(['calm', 'easy', 'flow', 'engaged', 'tense', 'intense']);
    });

    it('阈值与 stressMeter.STRESS_LEVELS 一致（norm 0.125/0.333/0.542/0.708/0.833）', () => {
        const maxes = STRESS_AMBIENCE_BANDS.map((b) => b.max);
        expect(maxes.slice(0, 5)).toEqual([0.125, 0.333, 0.542, 0.708, 0.833]);
        expect(maxes[5]).toBe(Infinity);
    });

    it('每档必须有 glow / glowAlpha / breathMs / shakeMult / audioCutoff 5 个字段', () => {
        for (const band of STRESS_AMBIENCE_BANDS) {
            expect(band).toMatchObject({
                id: expect.any(String),
                glow: expect.any(String),
                glowAlpha: expect.any(Number),
                breathMs: expect.any(Number),
                shakeMult: expect.any(Number),
                audioCutoff: expect.any(Number)
            });
        }
    });

    it('shakeMult 单调递增（低 stress 震动更轻 / 高 stress 震动更强）', () => {
        const mults = STRESS_AMBIENCE_BANDS.map((b) => b.shakeMult);
        for (let i = 1; i < mults.length; i++) {
            expect(mults[i]).toBeGreaterThanOrEqual(mults[i - 1]);
        }
    });

    it('breathMs 单调递减（低 stress 呼吸缓慢 / 高 stress 急促）', () => {
        const breaths = STRESS_AMBIENCE_BANDS.map((b) => b.breathMs);
        for (let i = 1; i < breaths.length; i++) {
            expect(breaths[i]).toBeLessThanOrEqual(breaths[i - 1]);
        }
    });

    it('audioCutoff 单调递减（低 stress 听感明亮 / 高 stress 闷感）', () => {
        const cutoffs = STRESS_AMBIENCE_BANDS.map((b) => b.audioCutoff);
        for (let i = 1; i < cutoffs.length; i++) {
            expect(cutoffs[i]).toBeLessThanOrEqual(cutoffs[i - 1]);
        }
    });

    it('shakeMult 在安全范围 [0.85, 1.30]（不会震动归零或撑爆）', () => {
        for (const band of STRESS_AMBIENCE_BANDS) {
            expect(band.shakeMult).toBeGreaterThanOrEqual(0.85);
            expect(band.shakeMult).toBeLessThanOrEqual(1.30);
        }
    });
});

describe('getStressAmbience: stress norm → band 映射', () => {
    it.each([
        [0, 'calm'],
        [0.1, 'calm'],
        [0.124, 'calm'],
        [0.125, 'easy'],
        [0.2, 'easy'],
        [0.4, 'flow'],
        [0.6, 'engaged'],
        [0.75, 'tense'],
        [0.9, 'intense'],
        [1.0, 'intense']
    ])('stress=%f → band=%s', (stress, expectedId) => {
        expect(getStressAmbience(stress).id).toBe(expectedId);
    });

    it('非法输入（NaN / undefined）→ 兜底返回 flow 默认档', () => {
        expect(getStressAmbience(NaN).id).toBe('flow');
        expect(getStressAmbience(undefined).id).toBe('flow');
        expect(getStressAmbience('abc').id).toBe('flow');
    });

    it('越界输入（< 0 / > 1）→ 按首/末档兜底', () => {
        expect(getStressAmbience(-0.5).id).toBe('calm');
        expect(getStressAmbience(99).id).toBe('intense');
    });
});

describe('A + B 档: applyStressToDOM 写入 4 个 CSS 变量 + dataset', () => {
    let rootEl;
    beforeEach(() => {
        document.body.innerHTML = '<div class="play-stack"></div>';
        rootEl = document.querySelector('.play-stack');
    });

    it('低 stress (calm) 写入冷青 + 缓慢呼吸', () => {
        applyStressToDOM(0.05, rootEl);
        expect(rootEl.style.getPropertyValue('--stress-ambience-glow')).toContain('120, 200, 230');
        expect(rootEl.style.getPropertyValue('--stress-ambience-breath-ms')).toBe('4200ms');
        expect(rootEl.dataset.stressBand).toBe('calm');
    });

    it('心流 stress (flow) 写入暖绿 + 中速呼吸', () => {
        applyStressToDOM(0.4, rootEl);
        expect(rootEl.style.getPropertyValue('--stress-ambience-glow')).toContain('180, 220, 160');
        expect(rootEl.style.getPropertyValue('--stress-ambience-breath-ms')).toBe('3000ms');
        expect(rootEl.dataset.stressBand).toBe('flow');
    });

    it('高 stress (intense) 写入暗红 + 急促呼吸', () => {
        applyStressToDOM(0.95, rootEl);
        expect(rootEl.style.getPropertyValue('--stress-ambience-glow')).toContain('220, 100, 100');
        expect(rootEl.style.getPropertyValue('--stress-ambience-breath-ms')).toBe('1500ms');
        expect(rootEl.dataset.stressBand).toBe('intense');
    });

    it('strong 变体 alpha 不超过 0.6（安全上限）', () => {
        applyStressToDOM(0.95, rootEl);
        const strong = rootEl.style.getPropertyValue('--stress-ambience-glow-strong');
        const match = strong.match(/rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)/);
        expect(match).not.toBeNull();
        expect(parseFloat(match[1])).toBeLessThanOrEqual(0.6);
    });

    it('--stress-ambience-level 写入归一化数值（玩家不可见但供其他动画读取）', () => {
        applyStressToDOM(0.42, rootEl);
        expect(rootEl.style.getPropertyValue('--stress-ambience-level')).toBe('0.420');
    });

    it('rootEl 为 null 时静默 noop（防止启动期 .play-stack 还未挂载）', () => {
        expect(() => applyStressToDOM(0.5, null)).not.toThrow();
    });

    it('严格不写入 textContent / innerHTML（策略隐性原则：不暴露数字到玩家）', () => {
        applyStressToDOM(0.95, rootEl);
        expect(rootEl.textContent).toBe('');
        expect(rootEl.innerHTML).toBe('');
    });
});

describe('C 档: attachStressShakeMultiplier 装饰 renderer.setShake', () => {
    function makeMockRenderer() {
        return {
            setShake: vi.fn(),
            shakeIntensity: 0,
            shakeDuration: 0
        };
    }

    it('装饰后 setShake 自动 × 倍率（默认 1.0 不变）', () => {
        const r = makeMockRenderer();
        const orig = r.setShake;
        attachStressShakeMultiplier(r);
        r.setShake(10, 200);
        expect(orig).toHaveBeenCalledWith(10, 200);
    });

    it('setStressShakeMultiplier(1.3) 后 setShake(10) 实际传入 13', () => {
        const r = makeMockRenderer();
        const orig = r.setShake;
        attachStressShakeMultiplier(r);
        r.setStressShakeMultiplier(1.3);
        r.setShake(10, 200);
        expect(orig).toHaveBeenCalledWith(13, 200);
    });

    it('setStressShakeMultiplier(0.85) 后 setShake(10) 实际传入 8.5', () => {
        const r = makeMockRenderer();
        const orig = r.setShake;
        attachStressShakeMultiplier(r);
        r.setStressShakeMultiplier(0.85);
        r.setShake(10, 200);
        expect(orig).toHaveBeenCalledWith(8.5, 200);
    });

    it('安全护栏：倍率被钳制在 [0.5, 2.0]', () => {
        const r = makeMockRenderer();
        const orig = r.setShake;
        attachStressShakeMultiplier(r);
        r.setStressShakeMultiplier(10); // 超界
        r.setShake(10, 200);
        expect(orig).toHaveBeenCalledWith(20, 200); // 被钳到 2.0
        orig.mockClear();
        r.setStressShakeMultiplier(0.1); // 超界
        r.setShake(10, 200);
        expect(orig).toHaveBeenCalledWith(5, 200); // 被钳到 0.5
    });

    it('幂等：重复 attach 不会双层装饰', () => {
        const r = makeMockRenderer();
        const orig = r.setShake;
        attachStressShakeMultiplier(r);
        const firstWrapped = r.setShake;
        attachStressShakeMultiplier(r);
        expect(r.setShake).toBe(firstWrapped);
        r.setShake(10, 100);
        expect(orig).toHaveBeenCalledTimes(1); // 只调一次原始
    });

    it('renderer 缺失 setShake 时静默 noop', () => {
        expect(() => attachStressShakeMultiplier({})).not.toThrow();
        expect(() => attachStressShakeMultiplier(null)).not.toThrow();
    });
});

describe('D 档: attachStressAudioFilter 在 master → destination 间插入 BiquadFilter', () => {
    function makeMockAudioFx() {
        const filterNode = {
            type: 'lowpass',
            frequency: {
                value: 22050,
                setValueAtTime: vi.fn(),
                linearRampToValueAtTime: vi.fn(),
                cancelScheduledValues: vi.fn()
            },
            Q: { setValueAtTime: vi.fn() },
            connect: vi.fn(),
            disconnect: vi.fn()
        };
        const masterNode = {
            connect: vi.fn(),
            disconnect: vi.fn(),
            gain: { value: 0.5 }
        };
        const destinationNode = {};
        const ctx = {
            currentTime: 0,
            destination: destinationNode,
            createBiquadFilter: vi.fn(() => filterNode)
        };
        return {
            ctx,
            master: masterNode,
            __filterNode: filterNode,
            _ensureCtx: vi.fn(() => true)
        };
    }

    it('attach 后再 _ensureCtx() 触发 filter 插入', () => {
        const fx = makeMockAudioFx();
        attachStressAudioFilter(fx);
        fx._ensureCtx();
        expect(fx.ctx.createBiquadFilter).toHaveBeenCalledOnce();
        expect(fx.master.disconnect).toHaveBeenCalledOnce();
        expect(fx.master.connect).toHaveBeenCalledWith(fx.__filterNode);
        expect(fx.__filterNode.connect).toHaveBeenCalledWith(fx.ctx.destination);
        expect(fx.__stressFilter).toBe(fx.__filterNode);
    });

    it('setStressAmbienceCutoff 通过 linearRamp 平滑过渡（600ms）', () => {
        const fx = makeMockAudioFx();
        attachStressAudioFilter(fx);
        fx._ensureCtx();
        fx.setStressAmbienceCutoff(4000);
        expect(fx.__filterNode.frequency.linearRampToValueAtTime).toHaveBeenCalledWith(4000, 0.6);
    });

    it('cutoff 被钳制在 [800, 20000] Hz（避免极端值破坏听感）', () => {
        const fx = makeMockAudioFx();
        attachStressAudioFilter(fx);
        fx._ensureCtx();
        fx.setStressAmbienceCutoff(99999);
        expect(fx.__filterNode.frequency.linearRampToValueAtTime).toHaveBeenLastCalledWith(20000, 0.6);
        fx.setStressAmbienceCutoff(100);
        expect(fx.__filterNode.frequency.linearRampToValueAtTime).toHaveBeenLastCalledWith(800, 0.6);
    });

    it('幂等：重复 attach 不会重复包装 _ensureCtx', () => {
        const fx = makeMockAudioFx();
        const orig = fx._ensureCtx;
        attachStressAudioFilter(fx);
        const wrapped = fx._ensureCtx;
        attachStressAudioFilter(fx);
        expect(fx._ensureCtx).toBe(wrapped);
        fx._ensureCtx();
        expect(orig).toHaveBeenCalledOnce();
    });

    it('audioFx 缺失 _ensureCtx / 为 null 时静默 noop', () => {
        expect(() => attachStressAudioFilter({})).not.toThrow();
        expect(() => attachStressAudioFilter(null)).not.toThrow();
    });

    it('AudioContext 创建 filter 失败时降级为无 stress 着色（不抛错）', () => {
        const fx = makeMockAudioFx();
        fx.ctx.createBiquadFilter = vi.fn(() => { throw new Error('not supported'); });
        attachStressAudioFilter(fx);
        expect(() => fx._ensureCtx()).not.toThrow();
        expect(fx.__stressFilter).toBeUndefined();
    });
});

describe('pushStressAmbience: 主入口一次推送 4 档反馈', () => {
    let rootEl;
    let renderer;
    let audioFx;
    beforeEach(() => {
        document.body.innerHTML = '<div class="play-stack"></div>';
        rootEl = document.querySelector('.play-stack');
        renderer = { setShake: vi.fn() };
        attachStressShakeMultiplier(renderer);
        audioFx = {
            setStressAmbienceCutoff: vi.fn(),
            _ensureCtx: vi.fn(() => true)
        };
    });

    it('一次调用同时推送 A + B + C + D 4 档', () => {
        const band = pushStressAmbience({
            stressNorm: 0.75,
            rootEl,
            renderer,
            audioFx
        });
        expect(band.id).toBe('tense');
        // A + B
        expect(rootEl.dataset.stressBand).toBe('tense');
        expect(rootEl.style.getPropertyValue('--stress-ambience-breath-ms')).toBe('1900ms');
        // C
        expect(renderer._stressShakeMultiplier).toBe(1.20);
        // D
        expect(audioFx.setStressAmbienceCutoff).toHaveBeenCalledWith(5500);
    });

    it('部分 target 缺失时仍能推送其余渠道', () => {
        const band = pushStressAmbience({ stressNorm: 0.4, rootEl });
        expect(band.id).toBe('flow');
        expect(rootEl.dataset.stressBand).toBe('flow');
    });

    it('返回 band 对象（供调用方做额外联动）', () => {
        const band = pushStressAmbience({ stressNorm: 0.1 });
        expect(band.id).toBe('calm');
    });
});

describe('策略隐性原则验证（v1.56.3）', () => {
    it('整个 stressAmbience 模块不导出任何"显示数字 / 标签"的函数', () => {
        // 模块内 export 列表必须是纯感官反馈函数，没有 renderText / showLabel 类
        const allowedExports = [
            'STRESS_AMBIENCE_BANDS',
            'getStressAmbience',
            'applyStressToDOM',
            'attachStressShakeMultiplier',
            'attachStressAudioFilter',
            'pushStressAmbience'
        ];
        // 这是一个白名单契约测试：如果未来不小心加了 renderStressLabel 等函数
        // 这里会失败，提示作者重新评估是否违反策略隐性
        expect(allowedExports).toContain('STRESS_AMBIENCE_BANDS');
        expect(allowedExports).toContain('pushStressAmbience');
        expect(allowedExports.every((name) =>
            !/render|show|label|text|tooltip/i.test(name)
        )).toBe(true);
    });

    it('band 配置中不包含任何"文本字段"（label / text / tooltip / vibe）', () => {
        for (const band of STRESS_AMBIENCE_BANDS) {
            expect(band).not.toHaveProperty('label');
            expect(band).not.toHaveProperty('text');
            expect(band).not.toHaveProperty('tooltip');
            expect(band).not.toHaveProperty('vibe');
            expect(band).not.toHaveProperty('face');
        }
    });
});
