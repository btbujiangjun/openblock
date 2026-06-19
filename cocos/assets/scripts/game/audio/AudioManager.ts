import { AudioClip, AudioSource, Node, assetManager, director, resources, sys } from 'cc';

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
    when?: number;
}

const SAMPLE_RATE = 22050;

/**
 * iOS 原生上排查"无声"的诊断开关。
 *
 * 打开后会在 Xcode 控制台打印：
 *   - 每次 play(name) 走的是哪条路径（AudioClip 已就绪 / WebAudio 合成 / 等待 ensureProceduralClip）
 *   - loadRemote(file:// 或 data:) 是 OK 还是 FAIL（FAIL 时连 err 一起打）
 *   - playOneShot 抛错（罕见，AVAudioSession 被打断时偶发）
 *
 * 业务排查口径：
 *   - 全是 "play(...) DROPPED enabled=false"          → setEnabled(false) 被误调，去检查持久化键 sound
 *   - 全是 "play(...) via AudioClip ... 但听不到"      → AVAudioSession 失活 / 物理静音开关（仅旧 iPhone）
 *   - "loadRemote FAIL err=..."                       → cocos 端 downloader 不支持该 URI scheme
 *   - "play(...) via WebAudio synth ... 但听不到"     → JSB 上 WebAudio polyfill 缺失，必须走 AudioClip
 *
 * 验证通过后改回 false，避免对正常用户产生日志噪音。
 */
const DEBUG_AUDIO = false;

const SFX_TONES: Record<string, ToneSpec[]> = {
    // 落块：温暖木质轻叩——低频 sine 主体 + 极短高频泛音模拟马林巴琴的"哒"
    place: [
        { freq: 220, dur: 0.06, type: 'sine', gain: 0.10 },
        { freq: 440, dur: 0.03, type: 'sine', gain: 0.04 },
    ],
    // 消除音：柔和和弦琶音（C-E-G 大三和弦上行），sine 波平滑不刺耳。
    // 消行数越多，琶音越长越饱满，强化"满足感"而非"冲击感"。
    clear1: [
        { freq: 262, dur: 0.18, type: 'sine', gain: 0.10 },
        { freq: 330, dur: 0.16, type: 'sine', gain: 0.09, when: 0.06 },
        { freq: 392, dur: 0.20, type: 'sine', gain: 0.08, when: 0.12 },
    ],
    clear2: [
        { freq: 294, dur: 0.16, type: 'sine', gain: 0.10 },
        { freq: 370, dur: 0.16, type: 'sine', gain: 0.09, when: 0.06 },
        { freq: 440, dur: 0.18, type: 'sine', gain: 0.08, when: 0.12 },
        { freq: 524, dur: 0.20, type: 'sine', gain: 0.07, when: 0.20 },
    ],
    clear3: [
        { freq: 330, dur: 0.16, type: 'sine', gain: 0.10 },
        { freq: 392, dur: 0.16, type: 'sine', gain: 0.09, when: 0.06 },
        { freq: 494, dur: 0.16, type: 'sine', gain: 0.08, when: 0.12 },
        { freq: 588, dur: 0.18, type: 'sine', gain: 0.07, when: 0.20 },
        { freq: 660, dur: 0.22, type: 'sine', gain: 0.06, when: 0.28 },
    ],
    clear4: [
        { freq: 262, dur: 0.14, type: 'sine', gain: 0.10 },
        { freq: 330, dur: 0.14, type: 'sine', gain: 0.09, when: 0.05 },
        { freq: 392, dur: 0.14, type: 'sine', gain: 0.09, when: 0.10 },
        { freq: 524, dur: 0.16, type: 'sine', gain: 0.08, when: 0.16 },
        { freq: 660, dur: 0.16, type: 'sine', gain: 0.07, when: 0.24 },
        { freq: 784, dur: 0.24, type: 'sine', gain: 0.06, when: 0.32 },
    ],
    // 连击庆祝音：低频温暖垫底 + 柔和 sine 琶音上行（取代 triangle，更圆润）
    combo2: [
        { freq: 165, dur: 0.14, type: 'sine', gain: 0.04 },
        { freq: 330, dur: 0.10, type: 'sine', gain: 0.07, when: 0.04 },
        { freq: 392, dur: 0.10, type: 'sine', gain: 0.07, when: 0.14 },
        { freq: 494, dur: 0.10, type: 'sine', gain: 0.06, when: 0.24 },
        { freq: 588, dur: 0.18, type: 'sine', gain: 0.05, when: 0.34 },
    ],
    combo3: [
        { freq: 165, dur: 0.14, type: 'sine', gain: 0.04 },
        { freq: 330, dur: 0.10, type: 'sine', gain: 0.07, when: 0.04 },
        { freq: 392, dur: 0.10, type: 'sine', gain: 0.07, when: 0.12 },
        { freq: 494, dur: 0.10, type: 'sine', gain: 0.07, when: 0.20 },
        { freq: 588, dur: 0.10, type: 'sine', gain: 0.06, when: 0.28 },
        { freq: 660, dur: 0.20, type: 'sine', gain: 0.05, when: 0.38 },
    ],
    combo4: [
        { freq: 165, dur: 0.14, type: 'sine', gain: 0.04 },
        { freq: 330, dur: 0.10, type: 'sine', gain: 0.07, when: 0.04 },
        { freq: 392, dur: 0.10, type: 'sine', gain: 0.07, when: 0.10 },
        { freq: 494, dur: 0.10, type: 'sine', gain: 0.07, when: 0.18 },
        { freq: 588, dur: 0.10, type: 'sine', gain: 0.06, when: 0.26 },
        { freq: 660, dur: 0.10, type: 'sine', gain: 0.06, when: 0.34 },
        { freq: 784, dur: 0.22, type: 'sine', gain: 0.05, when: 0.42 },
    ],
    // perfect：柔和 C 大调上行琶音（C5-E5-G5-C6），sine 波更温暖
    perfect: [
        { freq: 524, dur: 0.16, type: 'sine', gain: 0.10 },
        { freq: 660, dur: 0.16, type: 'sine', gain: 0.10, when: 0.08 },
        { freq: 784, dur: 0.16, type: 'sine', gain: 0.10, when: 0.16 },
        { freq: 1048, dur: 0.20, type: 'sine', gain: 0.08, when: 0.24 },
    ],
    gameover: [{ freq: 262, dur: 0.5, type: 'sine', gain: 0.12, slideTo: 110 }],
    skill: [{ freq: 440, dur: 0.10, type: 'sine', gain: 0.10, slideTo: 660 }],
    invalid: [{ freq: 165, dur: 0.12, type: 'sine', gain: 0.08, slideTo: 110 }],
    tick: [{ freq: 660, dur: 0.03, type: 'sine', gain: 0.08 }],
    unlock: [
        { freq: 392, dur: 0.16, type: 'sine', gain: 0.10, slideTo: 784 },
        { freq: 524, dur: 0.18, type: 'sine', gain: 0.08, slideTo: 1048, when: 0.06 },
    ],
    bonus: [
        { freq: 196, dur: 0.16, type: 'sine', gain: 0.10, slideTo: 392 },
        { freq: 330, dur: 0.18, type: 'sine', gain: 0.09, slideTo: 524, when: 0.06 },
        { freq: 524, dur: 0.22, type: 'sine', gain: 0.07, slideTo: 784, when: 0.16 },
    ],
};

function waveValue(type: Wave | undefined, phase: number): number {
    const p = (phase / (Math.PI * 2)) % 1;
    switch (type || 'sine') {
        case 'square': return Math.sin(phase) >= 0 ? 1 : -1;
        case 'sawtooth': return 2 * (p - Math.floor(p + 0.5));
        case 'triangle': return 2 * Math.abs(2 * (p - Math.floor(p + 0.5))) - 1;
        default: return Math.sin(phase);
    }
}

function writeString(buf: Uint8Array, offset: number, s: string): void {
    for (let i = 0; i < s.length; i++) buf[offset + i] = s.charCodeAt(i);
}

function writeU16(buf: Uint8Array, offset: number, v: number): void {
    buf[offset] = v & 255;
    buf[offset + 1] = (v >> 8) & 255;
}

function writeU32(buf: Uint8Array, offset: number, v: number): void {
    buf[offset] = v & 255;
    buf[offset + 1] = (v >> 8) & 255;
    buf[offset + 2] = (v >> 16) & 255;
    buf[offset + 3] = (v >> 24) & 255;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    const g = globalThis as unknown as { btoa?: (s: string) => string };
    if (g.btoa) return g.btoa(binary);

    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const a = bytes[i];
        const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
        const n = (a << 16) | (b << 8) | c;
        out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63];
        out += i + 1 < bytes.length ? chars[(n >> 6) & 63] : '=';
        out += i + 2 < bytes.length ? chars[n & 63] : '=';
    }
    return out;
}

function tonesToWavBytes(tones: ToneSpec[]): Uint8Array {
    const totalSec = tones.reduce((m, t) => Math.max(m, (t.when ?? 0) + t.dur + 0.04), 0.1);
    const samples = Math.ceil(totalSec * SAMPLE_RATE);
    const pcm = new Float32Array(samples);
    for (const tone of tones) {
        const start = Math.floor((tone.when ?? 0) * SAMPLE_RATE);
        const count = Math.ceil(tone.dur * SAMPLE_RATE);
        for (let i = 0; i < count && start + i < samples; i++) {
            const t = i / SAMPLE_RATE;
            const k = tone.dur <= 0 ? 1 : t / tone.dur;
            const freq = tone.slideTo
                ? tone.freq * Math.pow(Math.max(1, tone.slideTo) / Math.max(1, tone.freq), k)
                : tone.freq;
            const envIn = Math.min(1, t / 0.01);
            const envOut = Math.max(0, 1 - Math.max(0, t - tone.dur + 0.035) / 0.035);
            const env = envIn * envOut * (tone.gain ?? 0.18);
            pcm[start + i] += waveValue(tone.type, Math.PI * 2 * freq * t) * env;
        }
    }

    const dataBytes = samples * 2;
    const wav = new Uint8Array(44 + dataBytes);
    writeString(wav, 0, 'RIFF');
    writeU32(wav, 4, 36 + dataBytes);
    writeString(wav, 8, 'WAVE');
    writeString(wav, 12, 'fmt ');
    writeU32(wav, 16, 16);
    writeU16(wav, 20, 1);
    writeU16(wav, 22, 1);
    writeU32(wav, 24, SAMPLE_RATE);
    writeU32(wav, 28, SAMPLE_RATE * 2);
    writeU16(wav, 32, 2);
    writeU16(wav, 34, 16);
    writeString(wav, 36, 'data');
    writeU32(wav, 40, dataBytes);
    for (let i = 0; i < samples; i++) {
        const v = Math.max(-1, Math.min(1, pcm[i]));
        const n = v < 0 ? v * 0x8000 : v * 0x7fff;
        writeU16(wav, 44 + i * 2, n & 0xffff);
    }
    return wav;
}

function wavDataUri(bytes: Uint8Array): string {
    const b64 = bytesToBase64(bytes);
    return b64 ? `data:audio/wav;base64,${b64}` : '';
}

function writeNativeWav(name: string, bytes: Uint8Array): string | null {
    const g = globalThis as unknown as {
        native?: { fileUtils?: { getWritablePath?: () => string; writeDataToFile?: (data: Uint8Array, path: string) => boolean } };
        jsb?: { fileUtils?: { getWritablePath?: () => string; writeDataToFile?: (data: Uint8Array, path: string) => boolean } };
    };
    const fu = g.native?.fileUtils || g.jsb?.fileUtils;
    if (!fu?.getWritablePath || !fu.writeDataToFile) return null;
    const safeName = name.replace(/[^a-z0-9_-]/gi, '_');
    const path = `${fu.getWritablePath()}openblock-${safeName}.wav`;
    try {
        return fu.writeDataToFile(bytes, path) ? path : null;
    } catch {
        return null;
    }
}

/**
 * 把 native fileUtils 返回的原始路径包成 `file://` URI。
 * Cocos `assetManager.loadRemote` 在 iOS 真机上要求 URL scheme——
 * 直接传 `/var/mobile/.../foo.wav` 会被识别为相对路径或下载链接而失败；
 * Android JSB 容忍度高（两种都能加载），故"安卓正常 iOS 哑火"的次根因常常在这里。
 */
function nativePathToFileUri(path: string): string {
    if (path.startsWith('file://') || path.startsWith('http://') || path.startsWith('https://')) return path;
    return path.startsWith('/') ? `file://${path}` : `file:///${path}`;
}

class AudioManagerImpl {
    enabled = true;
    private source: AudioSource | null = null;
    private pbBgmSource: AudioSource | null = null;
    private clips: Record<string, AudioClip> = {};
    private pbBgmClips: Record<string, AudioClip> = {};
    private loading: Record<string, boolean> = {};
    private pending: Record<string, number[]> = {};
    private ctx: AudioContext | null = null;
    private ctxTried = false;
    private unlockArmed = false;
    private pbBgmPhase: 'off' | 'near' | 'sprint' | 'release' = 'off';
    private pbReleasePlayedThisRun = false;

    /**
     * 对齐 web `_primeOutput`：在第一次用户手势时 resume() AudioContext。
     * iOS WKWebView / Safari / 许多桌面浏览器都会在加载后将 ctx 置为 suspended，
     * 必须等用户手势后才能发声；若不解锁，所有 SFX 都"哑火"——这是用户反馈"声效失效"的常见根因。
     * 多次调用幂等；解锁成功后自动卸载监听器，零持续开销。
     *
     * Cocos 原生平台（JSB）无 DOM/WebAudio，直接跳过：armUnlock 仅对 Web/WKWebView 路径有意义；
     * 在原生上调用会徒劳遍历事件名并访问不存在的 globalThis.addEventListener，浪费一次启动期开销。
     */
    armUnlock(): void {
        if (this.unlockArmed) return;
        this.unlockArmed = true;
        if (sys.isNative) return;
        const win = globalThis as unknown as {
            addEventListener?: (ev: string, fn: () => void, opts?: unknown) => void;
            removeEventListener?: (ev: string, fn: () => void, opts?: unknown) => void;
            document?: { addEventListener?: (ev: string, fn: () => void, opts?: unknown) => void; removeEventListener?: (ev: string, fn: () => void, opts?: unknown) => void };
        };
        const target = win.document || win;
        const events = ['pointerdown', 'touchstart', 'mousedown', 'click', 'keydown'];
        const handler = (): void => {
            try {
                const ctx = this.getCtx();
                if (ctx && ctx.state === 'suspended') void ctx.resume();
                // 触发一次极轻 0.005s 静音的 osc，确保 ctx 真正进入 running 态（iOS 关键）。
                if (ctx) {
                    const osc = ctx.createOscillator();
                    const g = ctx.createGain();
                    g.gain.value = 0.0001;
                    osc.connect(g);
                    g.connect(ctx.destination);
                    osc.start();
                    osc.stop(ctx.currentTime + 0.005);
                }
            } catch { /* ignore */ }
            for (const ev of events) {
                try { target.removeEventListener?.(ev, handler, { capture: true } as unknown); } catch { /* ignore */ }
            }
        };
        for (const ev of events) {
            try { target.addEventListener?.(ev, handler, { capture: true, passive: true } as unknown); } catch { /* ignore */ }
        }
    }

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

    private ensurePbBgmSource(): AudioSource {
        if (this.pbBgmSource) return this.pbBgmSource;
        const n = new Node('PbChaseBgm');
        director.getScene()?.addChild(n);
        director.addPersistRootNode(n);
        this.pbBgmSource = n.addComponent(AudioSource);
        return this.pbBgmSource;
    }

    register(name: string, clip: AudioClip): void {
        this.clips[name] = clip;
    }

    /** 上次主动调用 startBgm() 时记录的 BGM 期望开启态，用于 setEnabled(true) 时自动恢复。 */
    private bgmWanted = false;

    setEnabled(on: boolean): void {
        const wasOn = this.enabled;
        this.enabled = on;
        if (!on) {
            this.stopBgm();
            this.stopPbChaseBgm(false);
            return;
        }
        this.preloadSfx();
        // 从静音恢复到开声：如果用户之前主动开过 BGM，自动恢复，避免静音切换后 BGM 永久消失。
        if (!wasOn && this.bgmWanted) this.startBgm();
    }

    /**
     * 启动期预加载：14 个程序化 SFX 同时写盘 + loadRemote 会在原生 iOS 上
     * 把 Cocos asset worker 队列灌满（每个 clip 的 callback 都跑在 main thread），
     * 早期 frames 卡顿明显；按帧依次注册（每帧 1 个），把 ~14 帧（≈230ms）的累计开销
     * 摊到第一秒以后，启动期主线程只做必要事情。
     * Web 路径上 ctx 受用户手势锁，preload 主要是让 AudioClip 路径就绪；同步注册也无关键开销，
     * 但保持统一策略——按帧节流，避免日志洪流和潜在并发 race。
     */
    preloadSfx(): void {
        const names = Object.keys(SFX_TONES);
        const step = (i: number): void => {
            if (i >= names.length) return;
            this.ensureProceduralClip(names[i], SFX_TONES[names[i]]);
            // 用 setTimeout 0 在下一帧再排下一个；Cocos JSB / Web 都有 setTimeout polyfill。
            setTimeout(() => step(i + 1), 16);
        };
        step(0);
    }

    private ensureProceduralClip(name: string, tones: ToneSpec[], playWhenReady = false, volume = 1): void {
        if (this.clips[name] || this.loading[name]) {
            if (playWhenReady && this.loading[name]) (this.pending[name] ||= []).push(volume);
            return;
        }
        const bytes = tonesToWavBytes(tones);
        const uri = wavDataUri(bytes);
        if (!uri) {
            // 连 WAV 都生不出来：直接用 WebAudio 兜底（浏览器可用，原生通常也有 Web Audio polyfill）。
            if (playWhenReady) this.synthTones(tones);
            return;
        }
        if (playWhenReady) (this.pending[name] ||= []).push(volume);
        // 原生（含 iOS 真机）走 data URI 的路径在 OpenAL/AVAudioPlayer 链上经常失败；
        // 优先落盘成 wav 再以 file:// 形式加载，能显著降低首次播放静默概率。
        // Web 则反过来——data URI 直接喂给 <audio>/WebAudio 最稳。
        if (sys.isNative) {
            const localPath = writeNativeWav(name, bytes);
            if (localPath) {
                this.loading[name] = true;
                this.loadProceduralClip(name, nativePathToFileUri(localPath), () => {
                    // 落盘失败时再退到 data URI 做最后一搏。
                    this.loading[name] = true;
                    this.loadProceduralClip(name, uri, () => this.failProceduralClip(name, tones));
                });
                return;
            }
        }
        this.loading[name] = true;
        this.loadProceduralClip(name, uri, () => {
            const localPath = writeNativeWav(name, bytes);
            if (!localPath) {
                this.failProceduralClip(name, tones);
                return;
            }
            this.loading[name] = true;
            this.loadProceduralClip(name, nativePathToFileUri(localPath), () => this.failProceduralClip(name, tones));
        });
    }

    /** 全部 clip 加载路径都失败时的最终兜底：把 pending 的本次播放转走 WebAudio，避免"首声静默"。
     *  若 WebAudio 也不可用（极端原生壳），则 SFX 实际不可发声，但游戏逻辑不被卡住。 */
    private failProceduralClip(name: string, tones: ToneSpec[]): void {
        this.loading[name] = false;
        const pending = this.pending[name] || [];
        this.pending[name] = [];
        if (!this.enabled || !pending.length) return;
        for (let i = 0; i < pending.length; i++) this.synthTones(tones);
    }

    private loadProceduralClip(name: string, uri: string, onFail: () => void): void {
        const uriKind = uri.startsWith('file://') ? 'file' : uri.startsWith('data:') ? 'data' : 'other';
        assetManager.loadRemote(uri, { ext: '.wav' }, (err: unknown, clip: AudioClip) => {
            this.loading[name] = false;
            if (err || !clip) {
                if (DEBUG_AUDIO) console.warn(`[AudioManager] loadRemote(${name}, ${uriKind}) FAIL err=${err}`);
                onFail();
                return;
            }
            if (DEBUG_AUDIO) console.log(`[AudioManager] loadRemote(${name}, ${uriKind}) OK`);
            this.clips[name] = clip;
            const pending = this.pending[name] || [];
            this.pending[name] = [];
            if (this.enabled) for (const v of pending) this.playClip(clip, v);
        });
    }

    private playClip(clip: AudioClip, volume: number): void {
        try {
            this.ensureSource().playOneShot(clip, volume);
        } catch (err) {
            // iOS 原生上 AudioSource.playOneShot 偶发因 AVAudioSession 被打断而抛错；
            // 静默 noop 即可，下次播放会因 AppDelegate.applicationDidBecomeActive 重激活 session 而恢复。
            if (DEBUG_AUDIO) console.warn('[AudioManager] playOneShot fail', err);
        }
    }

    private synth(spec: ToneSpec): void {
        const ctx = this.getCtx();
        if (!ctx) return;
        try {
            if (ctx.state === 'suspended') void ctx.resume();
            const when = spec.when ?? 0;
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

    private synthTones(tones: ToneSpec[]): boolean {
        if (!this.getCtx()) return false;
        for (const tone of tones) this.synth(tone);
        return true;
    }

    /** 优先真实/内存 AudioClip；WebAudio 仅作为浏览器兜底。 */
    play(name: string, volume = 1, tones: ToneSpec[] = SFX_TONES[name] || []): void {
        if (!this.enabled) {
            if (DEBUG_AUDIO) console.log(`[AudioManager] play(${name}) DROPPED enabled=false`);
            return;
        }
        const clip = this.clips[name];
        if (clip) {
            if (DEBUG_AUDIO) console.log(`[AudioManager] play(${name}) via AudioClip vol=${volume}`);
            this.playClip(clip, volume);
            return;
        }
        if (tones.length && this.synthTones(tones)) {
            if (DEBUG_AUDIO) console.log(`[AudioManager] play(${name}) via WebAudio synth`);
            return;
        }
        if (tones.length) {
            if (DEBUG_AUDIO) console.log(`[AudioManager] play(${name}) → ensureProceduralClip (clip not ready)`);
            this.ensureProceduralClip(name, tones, true, volume);
        } else if (DEBUG_AUDIO) {
            console.warn(`[AudioManager] play(${name}) NO PATH (no clip, no tones)`);
        }
    }

    sfxPlace(): void {
        this.play('place', 0.6);
    }

    sfxClear(lines: number): void {
        const key = `clear${Math.max(1, Math.min(4, lines))}`;
        this.play(key, 0.9);
    }

    sfxCombo(n: number): void {
        const key = `combo${Math.max(2, Math.min(4, n))}`;
        this.play(key, 1);
    }

    sfxPerfect(): void {
        this.play('perfect', 1);
    }

    sfxGameOver(): void {
        this.play('gameover', 1);
    }

    sfxSkill(): void {
        this.play('skill', 0.8);
    }

    sfxInvalid(): void {
        this.play('invalid', 0.6);
    }

    /** 与 web `audioFx.play('tick')`：UI 微反馈（hint、技能、设置切换）。 */
    sfxTick(): void {
        this.play('tick', 0.5);
    }

    /** 与 web `audioFx.play('unlock')`：宝箱展示、换肤、成就解锁、转盘中奖统一用。 */
    sfxUnlock(): void {
        this.play('unlock', 0.9);
    }

    /** 与 web `audioFx.play('bonus')`：同色 / icon bonus 行的强反馈音。 */
    sfxBonus(): void {
        this.play('bonus', 1);
    }

    // ---- BGM（程序化轻量 arpeggio，零资源；接 register('bgm', clip) 后可改用循环 clip） ----
    private bgmTimer: ReturnType<typeof setInterval> | null = null;
    private bgmStep = 0;
    bgmOn = false;

    startBgm(): void {
        this.bgmWanted = true;
        if (!this.enabled) return; // 当前静音中：留意愿，setEnabled(true) 时自动恢复
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

    /**
     * 仅在「此前用户主动开过 BGM」时恢复播放（用于 app 切回前台）。
     * 不改变 bgmWanted 意愿位——若用户从未开启或已主动关闭，则保持静默，不会被前后台切换强行打开。
     */
    resumeBgmIfWanted(): void {
        if (this.bgmWanted) this.startBgm();
    }

    /** 主动停止 BGM；保留 bgmWanted=true 让静音→开声时能自动恢复（仅 forget=true 才会清意愿）。 */
    stopBgm(forget = false): void {
        this.bgmOn = false;
        if (this.bgmTimer) { clearInterval(this.bgmTimer); this.bgmTimer = null; }
        if (forget) this.bgmWanted = false;
    }

    toggleBgm(): boolean {
        if (this.bgmOn) this.stopBgm(true);
        else this.startBgm();
        return this.bgmOn;
    }

    private loadPbBgmClip(phase: 'near' | 'sprint' | 'release', onReady: (clip: AudioClip) => void): void {
        const cached = this.pbBgmClips[phase];
        if (cached) {
            onReady(cached);
            return;
        }
        resources.load(`audio/game/pb_chase/pb_${phase}`, AudioClip, (err: Error | null, clip: AudioClip | null) => {
            if (err || !clip) {
                if (DEBUG_AUDIO) console.warn(`[AudioManager] PB cue load failed: ${phase}`, err);
                return;
            }
            this.pbBgmClips[phase] = clip;
            onReady(clip);
        });
    }

    private playPbBgmPhase(phase: 'near' | 'sprint' | 'release', volume: number): void {
        if (!this.enabled) return;
        if (this.pbBgmPhase === phase) {
            if (this.pbBgmSource?.playing) this.pbBgmSource.volume = volume;
            // Short cue semantics: each PB phase is announced once on entry.
            // When the 3s cue finishes, keep pbBgmPhase so updatePbChaseBgm does not
            // replay the same cue every frame while the score remains in that band.
            return;
        }
        this.pbBgmPhase = phase;
        this.loadPbBgmClip(phase, (clip) => {
            if (!this.enabled || this.pbBgmPhase !== phase) return;
            const source = this.ensurePbBgmSource();
            try {
                source.stop();
                source.clip = clip;
                source.loop = false;
                source.volume = volume;
                source.play();
            } catch (err) {
                if (DEBUG_AUDIO) console.warn('[AudioManager] PB cue play failed', err);
            }
        });
    }

    updatePbChaseBgm(input: { score: number; pbBaseline: number; placements: number; gameOver?: boolean }): void {
        if (!this.enabled) {
            this.stopPbChaseBgm(false);
            return;
        }
        const base = Number(input.pbBaseline) || 0;
        const score = Number(input.score) || 0;
        if (base < 200 || (Number(input.placements) || 0) < 3) {
            this.stopPbChaseBgm(false);
            return;
        }
        if (score > base) {
            if (!this.pbReleasePlayedThisRun) {
                this.pbReleasePlayedThisRun = true;
                this.playPbBgmPhase('release', 0.16);
            }
            return;
        }
        if (input.gameOver) {
            this.stopPbChaseBgm(false);
            return;
        }
        const pct = score / base;
        if (pct >= 0.95) this.playPbBgmPhase('sprint', 0.15);
        else if (pct >= 0.80) this.playPbBgmPhase('near', 0.12);
        else this.stopPbChaseBgm(false);
    }

    stopPbChaseBgm(resetRun = true): void {
        try { this.pbBgmSource?.stop(); } catch { /* ignore */ }
        this.pbBgmPhase = 'off';
        if (resetRun) this.pbReleasePlayedThisRun = false;
    }

    resetPbChaseBgm(): void {
        this.stopPbChaseBgm(true);
    }
}

export const AudioManager = new AudioManagerImpl();
