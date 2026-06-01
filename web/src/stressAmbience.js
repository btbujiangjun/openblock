/**
 * stressAmbience.js — v1.57 stress 感知化层
 *
 * 解决「算法精算 stress 但玩家感知不到」的断层。把 adaptiveSpawn finalStress
 * (norm [0,1]) 通过 4 个独立渠道渗透到玩家感官：
 *
 *   A. 棋盘氛围光    —— CSS box-shadow 颜色 / 透明度随 stress 变化
 *   B. 呼吸节奏      —— CSS animation-duration 随 stress 加快（高压急促）
 *   C. 消行震动幅度  —— renderer.setShake intensity × ambience.shakeMult
 *   D. 音频低通滤波  —— BiquadFilter cutoff 随 stress 降低（高频被削，闷感）
 *
 * 严格遵守 v1.56.3 策略隐性原则：
 *   - 不向主 HUD 暴露 stress 数字 / 标签
 *   - stressMeter 仍只在 insightPanel 内（玩家主动打开才看到）
 *   - 所有反馈通过「氛围」而非「信息」传达，玩家通过游戏体验潜意识感知
 *
 * 设计取舍
 * --------
 * - 6 档离散映射而非连续插值：玩家无意识感知有"边缘清晰度"，6 档刚好对应
 *   stressMeter.STRESS_LEVELS 的 calm/easy/flow/engaged/tense/intense
 *   （norm 阈值与 stressMeter.js 36-43 行严格一致，单一真理源）
 * - shakeMult 范围 [0.85, 1.30]：±15%~30% 是「能感知但不夸张」的体感窗口
 *   （超过 ±40% 会被反馈"震动忽强忽弱很烦"）
 * - audioCutoff 范围 [4000, 14000] Hz：人耳对 4-8kHz 高频敏感（"明亮度")，
 *   降到 4kHz 时整体听感会有"压抑"暗示，但仍可清晰辨识音色
 *
 * 关闭路径
 * --------
 * - prefers-reduced-motion: 关闭呼吸动画（CSS 层）
 * - 玩家关闭画质等级（quality=off/low）: applyStressToDOM 仍写变量但 CSS
 *   通过 `body[data-quality="off"] #game-wrapper::before { display: none; }` 隐藏
 * - 音频偏好关闭（audioFx.prefs.sound=false）: setStressAmbienceCutoff 仍执行但
 *   master gain 为 0，听感无差异
 */

/** stress 氛围 6 档；阈值与 stressMeter.STRESS_LEVELS 同步（norm 域） */
export const STRESS_AMBIENCE_BANDS = [
    { id: 'calm',    max: 0.125,    glow: '120, 200, 230', glowAlpha: 0.10, breathMs: 4200, shakeMult: 0.85, audioCutoff: 14000 },
    { id: 'easy',    max: 0.333,    glow: '160, 220, 200', glowAlpha: 0.12, breathMs: 3600, shakeMult: 0.92, audioCutoff: 12000 },
    { id: 'flow',    max: 0.542,    glow: '180, 220, 160', glowAlpha: 0.16, breathMs: 3000, shakeMult: 1.00, audioCutoff: 10000 },
    { id: 'engaged', max: 0.708,    glow: '230, 200, 140', glowAlpha: 0.22, breathMs: 2400, shakeMult: 1.10, audioCutoff: 7500 },
    { id: 'tense',   max: 0.833,    glow: '230, 160, 120', glowAlpha: 0.30, breathMs: 1900, shakeMult: 1.20, audioCutoff: 5500 },
    { id: 'intense', max: Infinity, glow: '220, 100, 100', glowAlpha: 0.40, breathMs: 1500, shakeMult: 1.30, audioCutoff: 4000 },
];

/* 中性锚（与 stressMeter / adaptiveSpawn 一致：norm 0.4375 = raw 中性 0.325） */
const NEUTRAL_STRESS = 0.4375;
const DEFAULT_BAND = STRESS_AMBIENCE_BANDS[2]; // flow

/**
 * 是否为 Android WebView 客户端（含鸿蒙系统自带的旧版 WebView）。
 * 用于在这类不稳定的 Web Audio 实现上跳过常驻 BiquadFilter（避免「滋滋」杂音）。
 */
function _isAndroidWebViewClient() {
    try {
        if (typeof document !== 'undefined'
            && document.documentElement.classList.contains('android-client')) {
            return true;
        }
        const cap = typeof window !== 'undefined' ? window.Capacitor : null;
        if (typeof cap?.getPlatform === 'function' && cap.getPlatform() === 'android') return true;
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
        return /android|harmony|huawei/i.test(ua);
    } catch {
        return false;
    }
}

/**
 * 把 stress (norm) 映射到 6 档氛围之一；超界按首/末档兜底。
 * @param {number} stressNorm  [0,1] norm 域 stress
 * @returns {object} STRESS_AMBIENCE_BANDS 中一项
 */
export function getStressAmbience(stressNorm) {
    if (!Number.isFinite(stressNorm)) return DEFAULT_BAND;
    for (const band of STRESS_AMBIENCE_BANDS) {
        if (stressNorm < band.max) return band;
    }
    return STRESS_AMBIENCE_BANDS[STRESS_AMBIENCE_BANDS.length - 1];
}

/**
 * A + B 档：把氛围写入 DOM CSS 变量。CSS 侧通过 `transition` 让变化在
 * 600~800ms 内平滑过渡（避免 stress 突变带来视觉跳跃）。
 *
 * 写入的 4 个变量：
 *   --stress-ambience-glow         主氛围色（rgba）
 *   --stress-ambience-glow-strong  强氛围色（同色更高 alpha，用于聚焦/边框）
 *   --stress-ambience-breath-ms    呼吸节奏（B 档）
 *   --stress-ambience-level        归一化数值 [0,1]（供其他动画/插件读取）
 * 以及 dataset.stressBand 写入 6 档 id（供 CSS 通过 [data-stress-band="..."] 精确匹配）
 *
 * @param {number} stressNorm
 * @param {HTMLElement|null} rootEl
 */
export function applyStressToDOM(stressNorm, rootEl) {
    if (!rootEl || !rootEl.style || typeof rootEl.style.setProperty !== 'function') return;
    const band = getStressAmbience(stressNorm);
    const level = Number.isFinite(stressNorm) ? Math.max(0, Math.min(1, stressNorm)) : NEUTRAL_STRESS;
    const strongAlpha = Math.min(0.6, band.glowAlpha * 1.6);
    rootEl.style.setProperty('--stress-ambience-glow', `rgba(${band.glow}, ${band.glowAlpha})`);
    rootEl.style.setProperty('--stress-ambience-glow-strong', `rgba(${band.glow}, ${strongAlpha.toFixed(3)})`);
    rootEl.style.setProperty('--stress-ambience-breath-ms', `${band.breathMs}ms`);
    rootEl.style.setProperty('--stress-ambience-level', level.toFixed(3));
    if (rootEl.dataset) rootEl.dataset.stressBand = band.id;
}

/**
 * C 档：装饰 renderer.setShake，让 intensity 自动乘 stress 倍率。
 * 装饰器模式：不需要改 game.js 任何 setShake 调用点，零侵入。
 *
 * @param {object} renderer
 */
export function attachStressShakeMultiplier(renderer) {
    if (!renderer || renderer.__stressShakeAttached) return;
    const origSetShake = renderer.setShake;
    if (typeof origSetShake !== 'function') return;
    renderer.__stressShakeAttached = true;
    renderer._stressShakeMultiplier = 1;
    renderer.setStressShakeMultiplier = function (mult) {
        const m = Number(mult);
        if (!Number.isFinite(m)) return;
        /* 安全护栏：再大的 stress 也不能放大震动超过 2 倍 / 缩到 0.5 倍以下，
         * 避免极端 stress 把震动撑爆或归零导致玩家失去消行反馈。 */
        this._stressShakeMultiplier = Math.max(0.5, Math.min(2.0, m));
    };
    renderer.setShake = function (intensity, duration) {
        const mult = this._stressShakeMultiplier || 1;
        return origSetShake.call(this, (Number(intensity) || 0) * mult, duration);
    };
}

/**
 * D 档：在 audioFx.master → destination 之间插入 BiquadFilter（lowpass）。
 * 高 stress 时 cutoff 降低 → 高频被削 → 听感变"闷"；低 stress 时 cutoff 抬高
 * → 整体明亮。
 *
 * 实现细节：
 * - 装饰 audioFx._ensureCtx，在 master 创建后立即插入 filter（不影响首播延迟）
 * - 频率变化用 linearRampToValueAtTime 在 600ms 内平滑过渡（avoid pop click）
 * - 不破坏现有 master gain（音量偏好仍生效）
 *
 * @param {object} audioFx  createAudioFx() 返回的实例
 */
export function attachStressAudioFilter(audioFx) {
    if (!audioFx || audioFx.__stressFilterAttached) return;
    if (typeof audioFx._ensureCtx !== 'function') return;
    audioFx.__stressFilterAttached = true;
    const origEnsureCtx = audioFx._ensureCtx.bind(audioFx);
    audioFx._ensureCtx = () => {
        const ok = origEnsureCtx();
        if (!ok || !audioFx.ctx || !audioFx.master || audioFx.__stressFilter) return ok;
        /* v1.61.12：Android WebView（含鸿蒙 2.0 旧内核）跳过常驻低通 BiquadFilter。
         * 这类旧 WebView 的 biquad 实现不稳定，串在主输出上会自激/振铃，把所有
         * 音频（连开关音效的纯正弦 tick）都染成持续「滋滋」杂音并糊掉正常音色。
         * D 档「压力闷感」只是潜意识氛围线索，关掉它对玩法无影响；A/B/C 三档
         * （氛围光 / 呼吸节奏 / 震动幅度）在 Android 上仍正常工作。 */
        if (_isAndroidWebViewClient()) return ok;
        try {
            const filter = audioFx.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(10000, audioFx.ctx.currentTime);
            filter.Q.setValueAtTime(0.7, audioFx.ctx.currentTime);
            audioFx.master.disconnect();
            audioFx.master.connect(filter);
            /* 串到限幅器之前（若存在），避免绕过 v1.61.12 的削顶保护 */
            filter.connect(audioFx._limiter || audioFx.ctx.destination);
            audioFx.__stressFilter = filter;
        } catch { /* ignore: filter 失败时音频降级为无 stress 着色 */ }
        return ok;
    };
    audioFx.setStressAmbienceCutoff = function (cutoffHz) {
        const f = this.__stressFilter;
        if (!f || !this.ctx) return;
        const cur = this.ctx.currentTime;
        const target = Math.max(800, Math.min(20000, Number(cutoffHz) || 10000));
        try {
            f.frequency.cancelScheduledValues(cur);
            f.frequency.setValueAtTime(f.frequency.value, cur);
            f.frequency.linearRampToValueAtTime(target, cur + 0.6);
        } catch { /* ignore */ }
    };
}

/**
 * 主入口：每次 stress 更新时一次性推送 4 档反馈。
 * game.js 在 _captureAdaptiveInsight 末尾调用即可。
 *
 * @param {object} opts
 * @param {number} opts.stressNorm  [0,1] norm 域
 * @param {HTMLElement|null} [opts.rootEl]   A+B 档目标元素（一般是 .play-stack）
 * @param {object|null} [opts.renderer]      C 档目标 renderer
 * @param {object|null} [opts.audioFx]       D 档目标 audioFx
 */
export function pushStressAmbience({ stressNorm, rootEl, renderer, audioFx }) {
    applyStressToDOM(stressNorm, rootEl);
    const band = getStressAmbience(stressNorm);
    if (renderer && typeof renderer.setStressShakeMultiplier === 'function') {
        renderer.setStressShakeMultiplier(band.shakeMult);
    }
    if (audioFx && typeof audioFx.setStressAmbienceCutoff === 'function') {
        audioFx.setStressAmbienceCutoff(band.audioCutoff);
    }
    return band;
}
