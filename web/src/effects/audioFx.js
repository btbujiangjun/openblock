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
 *   clear    上扬 sine + 尾音层 ~380ms     单次消行（偏长，对齐消除爽感）
 *   multi    多层上扬 + 泛音尾 ~520ms      一次清 ≥2 行
 *   combo    多段 sine 递升、步长加长      连击 streak ≥ 2
 *   perfect  C5+E5+G5 三和弦 / 720ms        盘面清空
 *   bonus    爆炸冲击 + 明亮欢呼掌声 1.6s bonus 同色 / 同 icon 整行
 *   gameOver 低频落点 + 下行短句 ~900ms       游戏结束 / 结算出现
 *   unlock   上扬清音 (600→1200) / 600ms   皮肤 / 成就解锁
 *   tick     极轻 800Hz / 30ms             菜单点击
 *
 * 触觉清单
 * --------
 *   place   8ms
 *   clear   [22, 38, 22]ms
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

const FEEDBACK_PRIORITY = {
    clear: 1,
    multi: 2,
    combo: 3,
    bonus: 4,
    perfect: 6,
};

const FEEDBACK_GATE_MS = 90;

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
        this._pendingClearFeedbackTimer = null;
        this._feedbackGateUntilMs = 0;
        this._feedbackGatePriority = 0;
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

        const wrap = (name, soundType, hapticPattern, optsFromArgs = null) => {
            const orig = renderer[name];
            if (typeof orig !== 'function') return;
            renderer[name] = (...args) => {
                this._cancelPendingClearFeedback();
                if (this._playFeedback(soundType, optsFromArgs ? optsFromArgs(args) : {})) {
                    this.vibrate(hapticPattern);
                }
                return orig.apply(renderer, args);
            };
        };

        wrap('triggerPerfectFlash',     'perfect', [40, 80, 40, 80, 40]);
        wrap('triggerComboFlash',       'combo',   [15, 40, 15, 40], (args) => ({ streak: Number(args[0]) || 0 }));
        wrap('triggerBonusMatchFlash',  'bonus',   [10, 20, 10], (args) => ({ count: Number(args[0]) || 1 }));
        wrap('triggerDoubleWave',       'multi',   [10, 30, 10]);

        const origSetClearCells = renderer.setClearCells;
        if (typeof origSetClearCells === 'function') {
            renderer.setClearCells = (cells) => {
                if (Array.isArray(cells) && cells.length > 0) {
                    this._scheduleClearFeedback();
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
        if (!opts.force && now - this._lastPlayTs < 0.012) return;
        this._lastPlayTs = now;

        switch (type) {
            case 'place':   return this._tonePlace(now);
            case 'clear':   return this._toneClear(now);
            case 'multi':   return this._toneMulti(now);
            case 'combo':   return this._toneCombo(now, opts.streak);
            case 'perfect': return this._tonePerfect(now);
            case 'bonus':   return this._toneBonus(now, opts.count);
            case 'gameOver': return this._toneGameOver(now);
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

    _scheduleClearFeedback() {
        this._cancelPendingClearFeedback();
        this._pendingClearFeedbackTimer = setTimeout(() => {
            this._pendingClearFeedbackTimer = null;
            if (this._playFeedback('clear')) {
                this.vibrate([22, 38, 22]);
            }
        }, 16);
    }

    _cancelPendingClearFeedback() {
        if (this._pendingClearFeedbackTimer == null) return;
        clearTimeout(this._pendingClearFeedbackTimer);
        this._pendingClearFeedbackTimer = null;
    }

    _playFeedback(type, opts = {}) {
        const priority = FEEDBACK_PRIORITY[type] || 0;
        const nowMs = Date.now();
        if (nowMs < this._feedbackGateUntilMs && priority <= this._feedbackGatePriority) {
            return false;
        }
        this._feedbackGateUntilMs = nowMs + FEEDBACK_GATE_MS;
        this._feedbackGatePriority = priority;
        this.play(type, { ...opts, force: true });
        return true;
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
    /*  各音色：有度反馈、不刺耳；消行 / 多消 / 连击刻意偏长以贴合消除爽感     */
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

    _noiseBurst(now, { dur = 0.18, gain = 0.05, filter = 'bandpass', freq = 1200, q = 0.8 } = {}) {
        if (typeof this.ctx.createBuffer !== 'function' || typeof this.ctx.createBufferSource !== 'function') {
            return;
        }
        const sampleRate = this.ctx.sampleRate || 44100;
        const length = Math.max(1, Math.floor(sampleRate * dur));
        const buffer = this.ctx.createBuffer(1, length, sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < length; i++) {
            const t = i / Math.max(1, length - 1);
            const env = Math.sin(Math.PI * t) ** 0.55;
            data[i] = (Math.random() * 2 - 1) * env;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        const f = this.ctx.createBiquadFilter?.();
        if (f) {
            f.type = filter;
            f.frequency.setValueAtTime(freq, now);
            f.Q.setValueAtTime(q, now);
        }
        const g = this.ctx.createGain();
        this._envelope(g, now, 0.01, dur, gain, 0);
        if (f) {
            src.connect(f);
            f.connect(g);
        } else {
            src.connect(g);
        }
        g.connect(this.master);
        src.start(now);
        src.stop(now + dur + 0.02);
    }

    _tonePlace(now) {
        this._tone(now, { type: 'sine', freq: 700, slideTo: 480, dur: 0.06, gain: 0.10 });
    }
    _toneClear(now) {
        /* 主体：较长向上滑音，占满「消除」前半拍 */
        this._tone(now, { type: 'sine', freq: 360, slideTo: 1020, dur: 0.26, gain: 0.15 });
        /* 亮色：略晚进入、略快收尾，与主层错开 */
        this._tone(now + 0.04, { type: 'sine', freq: 540, slideTo: 1580, dur: 0.2, gain: 0.078 });
        /* 低频「落地」略拉长 */
        this._tone(now, { type: 'sine', freq: 92, slideTo: 52, dur: 0.11, gain: 0.075 });
        /* 尾音：固定高音缓慢包络衰减，延长爽感尾巴（无音高滑移） */
        this._tone(now + 0.1, { type: 'sine', freq: 1180, dur: 0.2, gain: 0.055 });
        this._tone(now + 0.14, { type: 'sine', freq: 1760, dur: 0.16, gain: 0.038 });
    }
    _toneMulti(now) {
        /* 多行：更长的双层上扬 + 泛音 + 双尾音 */
        this._tone(now, { type: 'sine', freq: 400, slideTo: 1080, dur: 0.22, gain: 0.15 });
        this._tone(now + 0.1, { type: 'sine', freq: 580, slideTo: 1320, dur: 0.2, gain: 0.13 });
        this._tone(now + 0.06, { type: 'sine', freq: 1280, slideTo: 2100, dur: 0.12, gain: 0.06 });
        this._tone(now + 0.13, { type: 'sine', freq: 1040, dur: 0.22, gain: 0.05 });
        this._tone(now + 0.2, { type: 'sine', freq: 1560, dur: 0.18, gain: 0.036 });
    }
    _toneCombo(now, streak = 0) {
        this._toneComboCelebration(now, streak);
    }
    _toneComboCelebration(now, streak = 0) {
        const lines = Math.max(3, streak | 0);
        const steps = Math.min(lines, 5);
        const stepDt = 0.115;
        this._tone(now, { type: 'sine', freq: 196, slideTo: 174.61, dur: 0.12, gain: 0.035 });
        for (let i = 0; i < steps; i++) {
            const f0 = 523.25 * (1 + i * 0.18);
            this._tone(now + i * stepDt, {
                type: 'triangle',
                freq: f0,
                slideTo: f0 * 1.22,
                dur: 0.085,
                gain: 0.065 + i * 0.011,
            });
        }
        const tailAt = now + steps * stepDt + 0.02;
        this._tone(tailAt, { type: 'sine', freq: 1396.91, slideTo: 2093, dur: 0.2, gain: 0.066 });
    }
    _tonePerfect(now) {
        // 清屏是最高优先级反馈：额外加入低频冲击、上扫和高频闪光，压过其它消行音效。
        this._noiseBurst(now, { dur: 0.28, gain: 0.13, filter: 'lowpass', freq: 520, q: 0.7 });
        this._noiseBurst(now + 0.03, { dur: 0.42, gain: 0.1, filter: 'bandpass', freq: 2400, q: 0.9 });
        this._tone(now, { type: 'sawtooth', freq: 55, slideTo: 110, dur: 0.32, gain: 0.055 });
        this._noiseBurst(now, { dur: 0.22, gain: 0.09, filter: 'lowpass', freq: 760, q: 0.7 });
        this._noiseBurst(now + 0.08, { dur: 0.28, gain: 0.065, filter: 'bandpass', freq: 1800, q: 0.75 });
        this._tone(now, { type: 'sine', freq: 98, slideTo: 49, dur: 0.22, gain: 0.09 });
        const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5, 1568];
        for (let i = 0; i < notes.length; i++) {
            this._tone(now + 0.16 + i * 0.08, {
                type: i % 2 ? 'sine' : 'triangle',
                freq: notes[i],
                slideTo: notes[i] * 1.18,
                dur: 0.16,
                gain: 0.085 + i * 0.005,
            });
        }
        this._tone(now + 0.72, { type: 'triangle', freq: 2093, slideTo: 3136, dur: 0.38, gain: 0.07 });
        this._tone(now + 0.9, { type: 'sine', freq: 2637, dur: 0.5, gain: 0.035 });
    }
    _toneBonus(now, count = 1) {
        this._toneBonusCheers(now, count);
    }
    _toneBonusCheers(now, count = 1) {
        const bonusCount = Math.max(1, count | 0);
        // 爆炸生效：短促低频冲击 + 中高频爆裂，不再使用长高通尾音，避免“丝丝声”。
        this._noiseBurst(now, { dur: 0.16, gain: 0.12, filter: 'lowpass', freq: 680, q: 0.8 });
        this._noiseBurst(now + 0.04, { dur: 0.22, gain: 0.095, filter: 'bandpass', freq: 1850, q: 0.72 });
        this._tone(now, { type: 'sine', freq: 90, slideTo: 45, dur: 0.2, gain: 0.085 });
        this._tone(now + 0.05, { type: 'triangle', freq: 220, slideTo: 440, dur: 0.18, gain: 0.05 });
        this._noiseBurst(now + 0.24, { dur: 0.34, gain: 0.072, filter: 'bandpass', freq: 2300, q: 0.9 });
        this._noiseBurst(now + 0.52, { dur: 0.3, gain: 0.05, filter: 'bandpass', freq: 2650, q: 0.95 });

        // 号角式短句：爆炸后立刻抬亮庆祝感。
        const hornAt = [0.18, 0.36, 0.58];
        for (let i = 0; i < hornAt.length; i++) {
            const t = hornAt[i];
            const root = [392, 523.25, 659.25][i];
            this._tone(now + t, { type: 'triangle', freq: root, slideTo: root * 1.48, dur: 0.13, gain: 0.064 });
            this._tone(now + t + 0.022, { type: 'sine', freq: root * 1.5, slideTo: root * 1.86, dur: 0.11, gain: 0.042 });
        }

        // 几组明亮“嘿/哇”式喊声，只保留短促爆发段。
        const chants = Math.min(8, 4 + bonusCount);
        for (let i = 0; i < chants; i++) {
            const t = 0.26 + i * 0.16;
            const base = [392, 440, 493.88, 523.25, 587.33][i % 5];
            this._tone(now + t, { type: 'triangle', freq: base, slideTo: base * 1.22, dur: 0.12, gain: Math.max(0.024, 0.05 - i * 0.0028) });
            this._tone(now + t + 0.025, { type: 'sine', freq: base * 1.5, slideTo: base * 1.36, dur: 0.09, gain: Math.max(0.014, 0.03 - i * 0.002) });
        }

        // 拍手/碎裂掌声：短而亮，快速收尾，不留下高频嘶声。
        const clapCount = Math.min(22, 12 + bonusCount * 2);
        for (let i = 0; i < clapCount; i++) {
            const t = 0.18 + 1.15 * (i / Math.max(1, clapCount - 1));
            this._noiseBurst(now + t, {
                dur: 0.045,
                gain: Math.max(0.018, 0.052 - i * 0.0014),
                filter: 'bandpass',
                freq: 2100 + (i % 5) * 220,
                q: 1.35,
            });
            if (i % 3 === 0) {
                this._noiseBurst(now + t + 0.035, {
                    dur: 0.035,
                    gain: Math.max(0.012, 0.026 - i * 0.0008),
                    filter: 'bandpass',
                    freq: 3100,
                    q: 1.1,
                });
            }
        }
    }
    _toneGameOver(now) {
        // 结算提示：柔和下行，不做失败刺耳音，避免与结算卡停留时间冲突。
        this._tone(now, { type: 'sine', freq: 164.81, slideTo: 82.41, dur: 0.32, gain: 0.09 });
        this._tone(now + 0.04, { type: 'triangle', freq: 659.25, slideTo: 493.88, dur: 0.18, gain: 0.07 });
        this._tone(now + 0.24, { type: 'triangle', freq: 523.25, slideTo: 392.0, dur: 0.2, gain: 0.065 });
        this._tone(now + 0.48, { type: 'sine', freq: 392.0, slideTo: 329.63, dur: 0.28, gain: 0.052 });
        this._tone(now + 0.62, { type: 'sine', freq: 246.94, dur: 0.34, gain: 0.04 });
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
