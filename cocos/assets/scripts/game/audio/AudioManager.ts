import { AudioClip, AudioSource, Node, director } from 'cc';

/**
 * 音频适配（Phase 2）。两条路径：
 *  1) 程序化音效（WebAudio 合成，零资源）—— Web / 微信小游戏预览可用；
 *  2) 注册的 AudioClip（playOneShot）—— 接入真实音频资源后优先使用。
 * 无可用环境时静默降级。
 */

type Wave = OscillatorType;

interface ToneSpec {
    freq: number;
    dur: number;
    type?: Wave;
    gain?: number;
    slideTo?: number;
}

class AudioManagerImpl {
    enabled = true;
    private source: AudioSource | null = null;
    private clips: Record<string, AudioClip> = {};
    private ctx: AudioContext | null = null;
    private ctxTried = false;

    private getCtx(): AudioContext | null {
        if (this.ctxTried) return this.ctx;
        this.ctxTried = true;
        try {
            const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
            const Ctor = g.AudioContext || g.webkitAudioContext;
            this.ctx = Ctor ? new Ctor() : null;
        } catch {
            this.ctx = null;
        }
        return this.ctx;
    }

    private ensureSource(): AudioSource {
        if (this.source) return this.source;
        const n = new Node('AudioManager');
        director.getScene()?.addChild(n);
        director.addPersistRootNode(n);
        this.source = n.addComponent(AudioSource);
        return this.source;
    }

    register(name: string, clip: AudioClip): void {
        this.clips[name] = clip;
    }

    setEnabled(on: boolean): void {
        this.enabled = on;
    }

    private synth(spec: ToneSpec, when = 0): void {
        const ctx = this.getCtx();
        if (!ctx) return;
        try {
            if (ctx.state === 'suspended') void ctx.resume();
            const t0 = ctx.currentTime + when;
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = spec.type || 'sine';
            osc.frequency.setValueAtTime(spec.freq, t0);
            if (spec.slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(1, spec.slideTo), t0 + spec.dur);
            const peak = spec.gain ?? 0.18;
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
            g.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.dur);
            osc.connect(g);
            g.connect(ctx.destination);
            osc.start(t0);
            osc.stop(t0 + spec.dur + 0.02);
        } catch {
            /* ignore */
        }
    }

    /** 优先 clip，否则用合成兜底 */
    play(name: string, volume = 1, fallback?: () => void): void {
        if (!this.enabled) return;
        const clip = this.clips[name];
        if (clip) {
            this.ensureSource().playOneShot(clip, volume);
            return;
        }
        if (fallback) fallback();
    }

    sfxPlace(): void {
        this.play('place', 0.6, () => this.synth({ freq: 320, dur: 0.08, type: 'triangle', gain: 0.12 }));
    }

    sfxClear(lines: number): void {
        this.play('clear', 0.9, () => {
            const base = 440;
            for (let i = 0; i < Math.max(1, lines); i++) {
                this.synth({ freq: base * Math.pow(1.18, i), dur: 0.12, type: 'square', gain: 0.12 }, i * 0.06);
            }
        });
    }

    sfxCombo(n: number): void {
        this.play('combo', 1, () => this.synth({ freq: 520, dur: 0.18, type: 'sawtooth', gain: 0.14, slideTo: 880 + n * 60 }));
    }

    sfxPerfect(): void {
        this.play('perfect', 1, () => {
            [523, 659, 784, 1047].forEach((f, i) => this.synth({ freq: f, dur: 0.16, type: 'triangle', gain: 0.16 }, i * 0.08));
        });
    }

    sfxGameOver(): void {
        this.play('gameover', 1, () => this.synth({ freq: 330, dur: 0.5, type: 'sine', gain: 0.16, slideTo: 110 }));
    }

    sfxSkill(): void {
        this.play('skill', 0.8, () => this.synth({ freq: 660, dur: 0.12, type: 'square', gain: 0.12, slideTo: 990 }));
    }

    sfxInvalid(): void {
        this.play('invalid', 0.6, () => this.synth({ freq: 180, dur: 0.1, type: 'sawtooth', gain: 0.1, slideTo: 120 }));
    }

    // ---- BGM（程序化轻量 arpeggio，零资源；接 register('bgm', clip) 后可改用循环 clip） ----
    private bgmTimer: ReturnType<typeof setInterval> | null = null;
    private bgmStep = 0;
    bgmOn = false;

    startBgm(): void {
        if (this.bgmOn || this.bgmTimer) return;
        this.bgmOn = true;
        const scale = [261.6, 329.6, 392.0, 523.3, 392.0, 329.6];
        const tick = () => {
            if (!this.enabled || !this.bgmOn) return;
            const f = scale[this.bgmStep % scale.length];
            this.synth({ freq: f, dur: 0.32, type: 'sine', gain: 0.05 });
            if (this.bgmStep % 3 === 0) this.synth({ freq: f / 2, dur: 0.5, type: 'triangle', gain: 0.04 });
            this.bgmStep++;
        };
        this.bgmTimer = setInterval(tick, 380);
    }

    stopBgm(): void {
        this.bgmOn = false;
        if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
    }

    toggleBgm(): boolean {
        if (this.bgmOn) this.stopBgm(); else this.startBgm();
        return this.bgmOn;
    }
}

export const AudioManager = new AudioManagerImpl();
