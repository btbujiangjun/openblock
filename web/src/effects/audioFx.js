/**
 * audioFx.js — v10.15 程序化音效与触觉反馈系统（Top 5 高 ROI #1）
 *
 * 设计目标
 * --------
 * - **零依赖**：纯 Web Audio API（oscillator + gain），不引入任何音频资源 / 外部库
 * - **零侵入**：通过装饰 renderer 的 trigger* 方法接入，game.js 无需改动
 * - **懒加载**：首次用户交互后再创建 AudioContext，避开 Chrome autoplay 限制
 * - **可关闭**：localStorage 持久化「音效 / 触觉 / 音量」三档偏好
 * - **可扩展**：每个 sound 是一段纯函数，新增类型仅需追加表项
 *
 * 音色清单（手工调过的"听感舒适"参数）
 * ------------------------------------
 *   place    短促 sine 700Hz / 60ms        放置方块
 *   clear    triangle 1200Hz / 160ms       单次消行
 *   multi    双音 (1100→1500Hz) / 220ms    一次清 ≥2 行
 *   combo    三音上扬 (700/900/1200) / 320ms  连击 streak ≥ 2
 *   perfect  C5+E5+G5 三和弦 / 720ms        盘面清空
 *   bonus    短促闪音 (1800Hz) / 100ms     bonus 同色 / 同 icon 整行
 *   unlock   上扬清音 (600→1200) / 600ms   皮肤 / 成就解锁
 *   tick     极轻 800Hz / 30ms             菜单点击
 *
 * 触觉清单
 * --------
 *   place   8ms
 *   clear   20ms
 *   multi   [10, 30, 10]
 *   combo   [15, 40, 15, 40]
 *   perfect [40, 80, 40, 80, 40]
 *   bonus   [10, 20, 10]
 *
 * 接入路径（main.js）
 * -------------------
 *   const audio = createAudioFx();
 *   audio.attachToRenderer(game.renderer);   // 装饰 trigger* 方法
 *   window.__audioFx = audio;
 *
 * 用户偏好（控制台口令）
 * ----------------------
 *   window.__audioFx.setEnabled(true|false)
 *   window.__audioFx.setHaptic(true|false)
 *   window.__audioFx.setVolume(0..1)
 */

const STORAGE_KEY = 'openblock_audiofx_v1';

const DEFAULT_PREFS = {
    sound: true,
    haptic: true,
    volume: 0.55,
};

/** 浏览器是否支持 Web Audio（SSR / 旧浏览器降级） */
function _supportsWebAudio() {
    if (typeof window === 'undefined') return false;
    return !!(window.AudioContext || window.webkitAudioContext);
}

/** 浏览器是否支持设备震动 */
function _supportsVibrate() {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** 读 / 写 偏好 */
function _loadPrefs() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_PREFS };
        return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_PREFS };
    }
}

function _savePrefs(prefs) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch {
        /* ignore */
    }
}

export class AudioFx {
    constructor() {
        this.prefs = _loadPrefs();
        this.ctx = null;
        this.master = null;
        this._unlocked = false;
        this._lastPlayTs = 0;
        this._reducedMotion = this._detectReducedMotion();
        this._installAutoUnlock();
    }

    /** 用户偏好 API */
    setEnabled(b) { this.prefs.sound = !!b; _savePrefs(this.prefs); }
    setHaptic(b)  { this.prefs.haptic = !!b; _savePrefs(this.prefs); }
    setVolume(v)  {
        this.prefs.volume = Math.max(0, Math.min(1, +v || 0));
        _savePrefs(this.prefs);
        if (this.master) this.master.gain.value = this.prefs.volume;
    }
    getPrefs()    { return { ...this.prefs }; }

    /**
     * 装饰 Renderer 的关键反馈方法，让其在原行为外联动音效 + 触觉。
     * 不改 game.js，向后兼容（renderer 仍可独立使用）。
     */
    attachToRenderer(renderer) {
        if (!renderer || renderer.__audioFxAttached) return;
        renderer.__audioFxAttached = true;

        const wrap = (name, soundType, hapticPattern) => {
            const orig = renderer[name];
            if (typeof orig !== 'function') return;
            renderer[name] = (...args) => {
                this.play(soundType);
                this.vibrate(hapticPattern);
                return orig.apply(renderer, args);
            };
        };

        wrap('triggerPerfectFlash',     'perfect', [40, 80, 40, 80, 40]);
        wrap('triggerComboFlash',       'combo',   [15, 40, 15, 40]);
        wrap('triggerBonusMatchFlash',  'bonus',   [10, 20, 10]);
        wrap('triggerDoubleWave',       'multi',   [10, 30, 10]);

        const origSetClearCells = renderer.setClearCells;
        if (typeof origSetClearCells === 'function') {
            renderer.setClearCells = (cells) => {
                if (Array.isArray(cells) && cells.length > 0) {
                    this.play('clear');
                    this.vibrate(20);
                }
                return origSetClearCells.call(renderer, cells);
            };
        }
    }

    /** 播放一段程序化音效 */
    play(type, opts = {}) {
        if (!this.prefs.sound) return;
        if (!this._ensureCtx()) return;
        const now = this.ctx.currentTime;
        if (now - this._lastPlayTs < 0.012) return;
        this._lastPlayTs = now;

        switch (type) {
            case 'place':   return this._tonePlace(now);
            case 'clear':   return this._toneClear(now);
            case 'multi':   return this._toneMulti(now);
            case 'combo':   return this._toneCombo(now, opts.streak);
            case 'perfect': return this._tonePerfect(now);
            case 'bonus':   return this._toneBonus(now);
            case 'unlock':  return this._toneUnlock(now);
            case 'tick':    return this._toneTick(now);
            default: return;
        }
    }

    /** 触发设备震动（有偏好开关 + 浏览器支持判断 + reduced motion 护栏） */
    vibrate(pattern) {
        if (!this.prefs.haptic || this._reducedMotion) return;
        if (!_supportsVibrate()) return;
        try { navigator.vibrate(pattern); } catch { /* ignore */ }
    }

    _detectReducedMotion() {
        try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
        catch { return false; }
    }

    _ensureCtx() {
        if (this.ctx) return true;
        if (!_supportsWebAudio()) return false;
        try {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new Ctx();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.prefs.volume;
            this.master.connect(this.ctx.destination);
            return true;
        } catch {
            return false;
        }
    }

    /** 监听首次用户交互后 resume AudioContext（Chrome autoplay 策略） */
    _installAutoUnlock() {
        if (typeof window === 'undefined') return;
        const unlock = () => {
            if (this._unlocked) return;
            this._unlocked = true;
            this._ensureCtx();
            if (this.ctx && this.ctx.state === 'suspended') {
                this.ctx.resume().catch(() => { /* ignore */ });
            }
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            window.removeEventListener('touchstart', unlock);
        };
        window.addEventListener('pointerdown', unlock, { once: true, passive: true });
        window.addEventListener('keydown',     unlock, { once: true });
        window.addEventListener('touchstart',  unlock, { once: true, passive: true });
    }

    /* ============================================================ */
    /*  各音色：每个都是「短促有趣」+「不会过响」+「不会刺耳」     */
    /* ============================================================ */

    _envelope(g, now, attack, decay, peak = 1, sustain = 0) {
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(peak, now + attack);
        g.gain.linearRampToValueAtTime(sustain, now + attack + decay);
    }

    _tone(now, { type = 'sine', freq = 440, dur = 0.15, gain = 0.18, slideTo = null }) {
        const osc = this.ctx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now);
        if (slideTo != null) {
            osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + dur);
        }
        const g = this.ctx.createGain();
        this._envelope(g, now, 0.005, dur, gain, 0);
        osc.connect(g);
        g.connect(this.master);
        osc.start(now);
        osc.stop(now + dur + 0.02);
    }

    _tonePlace(now) {
        this._tone(now, { type: 'sine', freq: 700, slideTo: 480, dur: 0.06, gain: 0.10 });
    }
    _toneClear(now) {
        this._tone(now, { type: 'triangle', freq: 1200, slideTo: 800, dur: 0.16, gain: 0.16 });
    }
    _toneMulti(now) {
        this._tone(now, { type: 'triangle', freq: 1100, slideTo: 1500, dur: 0.10, gain: 0.14 });
        this._tone(now + 0.12, { type: 'sine', freq: 1500, slideTo: 1100, dur: 0.10, gain: 0.12 });
    }
    _toneCombo(now, streak = 0) {
        const steps = Math.min(2 + Math.max(0, streak | 0), 5);
        for (let i = 0; i < steps; i++) {
            const f = 600 + i * 220;
            this._tone(now + i * 0.07, { type: 'triangle', freq: f, dur: 0.08, gain: 0.13 });
        }
    }
    _tonePerfect(now) {
        const C5 = 523.25, E5 = 659.25, G5 = 783.99, C6 = 1046.5;
        for (const f of [C5, E5, G5]) {
            this._tone(now, { type: 'sine', freq: f, dur: 0.55, gain: 0.10 });
        }
        this._tone(now + 0.18, { type: 'triangle', freq: C6, slideTo: C6 * 1.5, dur: 0.30, gain: 0.10 });
    }
    _toneBonus(now) {
        this._tone(now, { type: 'square', freq: 1800, slideTo: 2400, dur: 0.08, gain: 0.08 });
    }
    _toneUnlock(now) {
        this._tone(now, { type: 'sine', freq: 600, slideTo: 1200, dur: 0.32, gain: 0.14 });
        this._tone(now + 0.18, { type: 'triangle', freq: 1200, slideTo: 1800, dur: 0.32, gain: 0.10 });
    }
    _toneTick(now) {
        this._tone(now, { type: 'sine', freq: 880, dur: 0.03, gain: 0.06 });
    }
}

/** 工厂：单例 + 暴露到 window.__audioFx 便于控制台调试 */
let _instance = null;
export function createAudioFx() {
    if (_instance) return _instance;
    _instance = new AudioFx();
    if (typeof window !== 'undefined') window.__audioFx = _instance;
    return _instance;
}

export function getAudioFx() { return _instance; }
