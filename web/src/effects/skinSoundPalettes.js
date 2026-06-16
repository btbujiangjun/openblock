/**
 * skinSoundPalettes.js — 皮肤主题声效生成器
 *
 * 每款皮肤绑定一个声音主题；主题决定落子材质、消行音阶、连击递进、
 * 解锁提示与庆祝音色。切换皮肤时通过 onSkinAfterApply 同步替换 AudioFx
 * 内部音色函数，让转场中播放的 unlock 也使用新皮肤的音色。
 */

import { SKINS, getActiveSkinId, onSkinAfterApply } from '../skins.js';

const MAJOR = [0, 4, 7, 12, 16, 19];
const PENTATONIC = [0, 2, 4, 7, 9, 12];
const MINOR = [0, 3, 7, 10, 12, 15];
const EASTERN = [0, 2, 5, 7, 9, 12];
const WHOLE_TONE = [0, 2, 4, 6, 8, 10, 12];

const PRESETS = {
    crystal:  { root: 392, scale: MAJOR,      wave: 'sine',     material: 'glass',    color: 'clear',  air: 0.02,  motif: 'chime' },
    metal:    { root: 220, scale: MINOR,      wave: 'triangle', material: 'metal',    color: 'cool',   air: 0.018, motif: 'alloy' },
    neon:     { root: 440, scale: MAJOR,      wave: 'sine',     material: 'neon',     color: 'bright', air: 0.025, motif: 'arcade' },
    water:    { root: 330, scale: PENTATONIC, wave: 'sine',     material: 'water',    color: 'soft',   air: 0.018, motif: 'bubble' },
    warm:     { root: 330, scale: MAJOR,      wave: 'triangle', material: 'soft',     color: 'warm',   air: 0.012, motif: 'sun' },
    wood:     { root: 247, scale: PENTATONIC, wave: 'triangle', material: 'wood',     color: 'earth',  air: 0.012, motif: 'wood' },
    cute:     { root: 523, scale: MAJOR,      wave: 'sine',     material: 'soft',     color: 'cute',   air: 0.016, motif: 'toy' },
    pixel:    { root: 330, scale: PENTATONIC, wave: 'square',   material: 'pixel',    color: 'arcade', air: 0.008, motif: 'chip' },
    piano:    { root: 523, scale: MAJOR,      wave: 'sine',     material: 'piano',    color: 'music',  air: 0.012, motif: 'piano' },
    cosmic:   { root: 262, scale: WHOLE_TONE, wave: 'sine',     material: 'space',    color: 'cosmic', air: 0.022, motif: 'space' },
    magic:    { root: 466, scale: WHOLE_TONE, wave: 'triangle', material: 'sparkle',  color: 'magic',  air: 0.024, motif: 'sparkle' },
    myth:     { root: 349, scale: MAJOR,      wave: 'triangle', material: 'ceremony', color: 'gold',   air: 0.015, motif: 'lyre' },
    dark:     { root: 247, scale: MINOR,      wave: 'triangle', material: 'wood',     color: 'dark',   air: 0.010, motif: 'underworld' },
    nature:   { root: 294, scale: PENTATONIC, wave: 'sine',     material: 'leaf',     color: 'nature', air: 0.02,  motif: 'forest' },
    royal:    { root: 330, scale: EASTERN,    wave: 'triangle', material: 'ceremony', color: 'royal',  air: 0.014, motif: 'gong' },
    mahjong:  { root: 330, scale: EASTERN,    wave: 'triangle', material: 'tile',     color: 'table',  air: 0.008, motif: 'mahjong' },
    fiesta:   { root: 440, scale: MAJOR,      wave: 'triangle', material: 'party',    color: 'party',  air: 0.024, motif: 'confetti' },
};

export const SKIN_SOUND_THEMES = {
    classic:   { preset: 'crystal', root: 392, material: 'tile', motif: 'classic' },
    titanium:  { preset: 'metal', root: 247, material: 'metal', motif: 'alloy' },
    aurora:    { preset: 'crystal', root: 523, material: 'glass', motif: 'aurora' },
    neonCity:  { preset: 'neon', root: 440, material: 'neon', motif: 'arcade' },
    ocean:     { preset: 'water', root: 330, material: 'water', motif: 'bubble' },
    sunset:    { preset: 'warm', root: 330, material: 'glass', motif: 'ember' },
    sakura:    { preset: 'warm', root: 523, scale: EASTERN, material: 'soft', motif: 'sakura' },
    koi:       { preset: 'water', root: 392, scale: EASTERN, material: 'water', motif: 'koi' },
    candy:     { preset: 'cute', root: 523, material: 'soft', motif: 'candy' },
    toon:      { preset: 'cute', root: 392, material: 'rubber', motif: 'boing' },
    pixel8:    { preset: 'pixel', root: 330, material: 'pixel', motif: 'chip' },
    dawn:      { preset: 'warm', root: 392, material: 'soft', motif: 'morning' },
    summer:    { preset: 'water', root: 440, material: 'beach', motif: 'beach' },
    food:      { preset: 'warm', root: 294, material: 'wood', motif: 'kitchen' },
    music:     { preset: 'piano', root: 523, material: 'piano', motif: 'piano' },
    pets:      { preset: 'cute', root: 440, material: 'soft', motif: 'pet' },
    universe:  { preset: 'cosmic', root: 262, material: 'space', motif: 'space' },
    fantasy:   { preset: 'magic', root: 466, material: 'sparkle', motif: 'spell' },
    greece:    { preset: 'myth', root: 349, material: 'ceremony', motif: 'lyre' },
    demon:     { preset: 'dark', root: 247, material: 'wood', motif: 'underworld' },
    jurassic:  { preset: 'nature', root: 294, material: 'wood', motif: 'jungle' },
    fairy:     { preset: 'magic', root: 523, scale: MAJOR, material: 'sparkle', motif: 'fairy' },
    forbidden: { preset: 'royal', root: 330, material: 'ceremony', motif: 'gong' },
    mahjong:   { preset: 'mahjong', root: 330, material: 'tile', motif: 'mahjong' },
    forest:    { preset: 'nature', root: 330, material: 'leaf', motif: 'forest' },
    apple:     { preset: 'metal', root: 330, material: 'glass', motif: 'device' },
    cafe:      { preset: 'wood', root: 247, material: 'wood', motif: 'cafe' },
    arcadeCabinet: { preset: 'pixel', root: 392, material: 'pixel', motif: 'arcade' },
    circuitBoard:  { preset: 'neon', root: 440, material: 'neon', motif: 'device' },
    toyBox:        { preset: 'cute', root: 523, material: 'rubber', motif: 'toy' },
    mineralCave:   { preset: 'crystal', root: 330, material: 'stone', motif: 'chime' },
    alchemyLab:    { preset: 'magic', root: 466, material: 'glass', motif: 'spell' },
    botanicalStudy:{ preset: 'nature', root: 294, material: 'leaf', motif: 'forest' },
    spaceDock:     { preset: 'cosmic', root: 294, material: 'space', motif: 'space' },
    dungeonLoot:   { preset: 'dark', root: 247, material: 'wood', motif: 'underworld' },
    origamiPaper:  { preset: 'warm', root: 392, scale: EASTERN, material: 'paper', motif: 'sakura' },
    museumRelic:   { preset: 'royal', root: 294, material: 'wood', motif: 'gong' },
    winterCabin:   { preset: 'wood', root: 262, material: 'wood', motif: 'cafe' },
    rainyWindow:   { preset: 'water', root: 330, material: 'glass', motif: 'bubble' },
    inkGarden:     { preset: 'warm', root: 392, scale: EASTERN, material: 'paper', motif: 'sakura' },
    fiesta:    { preset: 'fiesta', root: 440, material: 'party', motif: 'confetti' },
};

const THEMED_METHODS = ['place', 'clear', 'multi', 'combo', 'perfect', 'bonus', 'unlock', 'tick'];
const ASSET_EVENTS = ['place', 'clear', 'multi', 'combo', 'perfect', 'bonus', 'unlock', 'tick'];
const ASSET_EVENT_GAIN = {
    place: 0.65,
    tick: 0.45,
    clear: 0.72,
    multi: 0.76,
    combo: 0.78,
    perfect: 0.82,
    bonus: 0.80,
    unlock: 0.72,
};

let _current = null;
let _origMethods = {};
let _unsubscribe = null;
const _assetCache = new Map();

function _semitone(root, steps) {
    return root * (2 ** (steps / 12));
}

function _note(theme, index, octave = 0) {
    const scale = theme.scale || MAJOR;
    const steps = scale[index % scale.length] + octave * 12;
    return _semitone(theme.root, steps);
}

function _resolveTheme(skinId) {
    const raw = SKIN_SOUND_THEMES[skinId] || SKIN_SOUND_THEMES.classic;
    const preset = PRESETS[raw.preset] || PRESETS.crystal;
    return {
        skinId,
        ...preset,
        ...raw,
        name: SKINS[skinId]?.name || skinId,
    };
}

function _assetBasePath() {
    try {
        const custom = typeof window !== 'undefined' ? window.__openBlockAudioAssetBase : null;
        if (custom && typeof custom === 'string') return custom.replace(/\/+$/, '');
    } catch { /* ignore */ }
    return '/audio/skins';
}

function _externalAssetUrl(theme, event) {
    const skinId = encodeURIComponent(theme.skinId || 'classic');
    const motif = encodeURIComponent(theme.motif || theme.preset || 'classic');
    const base = _assetBasePath();
    return [
        `${base}/${skinId}/${event}.ogg`,
        `${base}/${skinId}/${event}.mp3`,
        `${base}/${skinId}/${event}.wav`,
        `${base}/${skinId}/${event}.m4a`,
        `${base}/_themes/${motif}/${event}.ogg`,
        `${base}/_themes/${motif}/${event}.mp3`,
        `${base}/_themes/${motif}/${event}.wav`,
        `${base}/_themes/${motif}/${event}.m4a`,
    ];
}

function _ensureCtxForAsset(fx) {
    if (!fx) return false;
    if (fx.ctx) return true;
    if (typeof fx._ensureCtx === 'function') return fx._ensureCtx();
    return false;
}

function _fetchAsset(fx, url, { createCtx = false } = {}) {
    if (_assetCache.has(url)) return _assetCache.get(url);
    const entry = { buffer: null, missing: false, promise: null };
    _assetCache.set(url, entry);
    const ctxReady = createCtx ? _ensureCtxForAsset(fx) : !!fx?.ctx;
    if (typeof fetch !== 'function' || !ctxReady || !fx.ctx?.decodeAudioData) {
        _assetCache.delete(url);
        entry.missing = true;
        return entry;
    }
    entry.promise = fetch(url, { cache: 'force-cache' })
        .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.arrayBuffer();
        })
        .then((buf) => fx.ctx.decodeAudioData(buf))
        .then((decoded) => {
            entry.buffer = decoded;
            return decoded;
        })
        .catch(() => {
            entry.missing = true;
            return null;
        });
    return entry;
}

function _preloadExternalAssets(fx, theme) {
    if (typeof window === 'undefined') return;
    if (window.__openBlockDisableExternalAudioAssets === true) return;
    if (!fx?.ctx) return;
    for (const event of ASSET_EVENTS) {
        for (const url of _externalAssetUrl(theme, event)) {
            _fetchAsset(fx, url);
        }
    }
}

function _playExternalAsset(fx, theme, event, now) {
    if (typeof window === 'undefined') return false;
    if (window.__openBlockDisableExternalAudioAssets === true) return false;
    if (!_ensureCtxForAsset(fx) || !fx.ctx || !fx.master) return false;
    for (const url of _externalAssetUrl(theme, event)) {
        const entry = _fetchAsset(fx, url, { createCtx: true });
        if (!entry?.buffer) continue;
        try {
            const src = fx.ctx.createBufferSource();
            const gain = fx.ctx.createGain();
            src.buffer = entry.buffer;
            gain.gain.setValueAtTime(ASSET_EVENT_GAIN[event] ?? 0.72, now);
            src.connect(gain);
            gain.connect(fx.master);
            src.start(now);
            return true;
        } catch {
            return false;
        }
    }
    return false;
}

function _playMaterialClick(fx, now, theme, gain = 1) {
    const material = theme.material;
    const root = theme.root;
    if (material === 'water' || material === 'beach') {
        fx._tone(now, { type: 'sine', freq: root * 2.8, slideTo: root * 1.15, dur: 0.09, gain: 0.055 * gain });
        fx._tone(now + 0.025, { type: 'sine', freq: root * 4.0, slideTo: root * 1.8, dur: 0.06, gain: 0.028 * gain });
        return;
    }
    if (material === 'metal' || material === 'glass') {
        fx._tone(now, { type: 'triangle', freq: root * 1.4, slideTo: root * 1.1, dur: 0.045, gain: 0.07 * gain });
        fx._tone(now + 0.018, { type: 'sine', freq: root * 4.0, dur: 0.05, gain: 0.025 * gain });
        return;
    }
    if (material === 'neon' || material === 'pixel') {
        fx._tone(now, { type: material === 'pixel' ? 'square' : 'sine', freq: root * 2, dur: 0.045, gain: 0.055 * gain });
        fx._tone(now + 0.035, { type: material === 'pixel' ? 'square' : 'sine', freq: root * 3, dur: 0.035, gain: 0.03 * gain });
        return;
    }
    if (material === 'sparkle') {
        fx._tone(now, { type: 'sine', freq: root * 2.4, slideTo: root * 2.8, dur: 0.042, gain: 0.038 * gain });
        fx._tone(now + 0.026, { type: 'triangle', freq: root * 4.8, slideTo: root * 5.4, dur: 0.038, gain: 0.018 * gain });
        return;
    }
    if (material === 'drum') {
        fx._tone(now, { type: 'triangle', freq: root * 1.15, slideTo: root * 0.9, dur: 0.052, gain: 0.045 * gain });
        return;
    }
    if (material === 'wood' || material === 'leaf' || material === 'tile') {
        fx._noiseBurst?.(now, { dur: material === 'tile' ? 0.030 : 0.045, gain: (material === 'tile' ? 0.014 : 0.020) * gain, filter: 'bandpass', freq: material === 'tile' ? 1350 : 1100, q: material === 'tile' ? 1.8 : 1.0 });
        fx._tone(now, { type: 'triangle', freq: root * 1.2, slideTo: root * (material === 'tile' ? 1.02 : 0.9), dur: material === 'tile' ? 0.050 : 0.055, gain: 0.044 * gain });
        return;
    }
    fx._tone(now, { type: 'sine', freq: root * 1.6, dur: 0.05, gain: 0.052 * gain });
    fx._tone(now + 0.026, { type: 'sine', freq: root * 2.2, dur: 0.035, gain: 0.026 * gain });
}

function _playChordAccent(fx, now, theme, {
    degrees = [0, 2, 4],
    dur = 0.11,
    gain = 0.055,
    octave = 0,
    slide = 1.03,
} = {}) {
    for (let i = 0; i < degrees.length; i++) {
        const freq = _note(theme, degrees[i], octave);
        fx._tone(now, {
            type: theme.wave || 'sine',
            freq,
            slideTo: freq * slide,
            dur: i === degrees.length - 1 ? dur * 1.2 : dur,
            gain: Math.max(0.014, gain - i * 0.006),
        });
    }
}

function _playThemeAir(fx, now, theme, amount = 1) {
    const gain = (theme.air || 0) * amount;
    if (gain <= 0 || typeof fx._noiseBurst !== 'function') return;
    const material = theme.material;
    if (material === 'sparkle') {
        fx._noiseBurst(now, { dur: 0.045, gain: gain * 0.24, filter: 'bandpass', freq: 4200, q: 2.4 });
        return;
    }
    const freq = material === 'leaf' ? 2600
        : material === 'water' || material === 'beach' ? 1800
            : material === 'space' || material === 'sparkle' ? 3200
                : material === 'party' ? 2400
                    : 1400;
    fx._noiseBurst(now, { dur: 0.16, gain, filter: 'bandpass', freq, q: 0.9 });
}

function _tapNoise(fx, now, { freq = 1200, gain = 0.025, dur = 0.045, q = 1.1 } = {}) {
    fx._noiseBurst?.(now, { dur, gain, filter: 'bandpass', freq, q });
}

function _playThemeMotif(fx, now, theme, event = 'clear') {
    const boost = event === 'perfect' ? 1.7 : event === 'bonus' ? 1.35 : event === 'unlock' ? 1.15 : 1;
    const motif = theme.motif || 'chime';
    if (motif === 'bubble' || motif === 'koi') {
        fx._tone(now + 0.02, { type: 'sine', freq: theme.root * 4.8, slideTo: theme.root * 1.7, dur: 0.18, gain: 0.035 * boost });
        fx._tone(now + 0.10, { type: 'sine', freq: theme.root * 3.6, slideTo: theme.root * 1.25, dur: 0.22, gain: 0.024 * boost });
        return;
    }
    if (motif === 'beach') {
        _tapNoise(fx, now + 0.02, { freq: 1800, gain: 0.026 * boost, dur: 0.10, q: 0.6 });
        fx._tone(now + 0.08, { type: 'sine', freq: theme.root * 2.0, slideTo: theme.root * 1.15, dur: 0.20, gain: 0.026 * boost });
        return;
    }
    if (motif === 'forest' || motif === 'jungle' || motif === 'morning') {
        _tapNoise(fx, now, { freq: motif === 'jungle' ? 1200 : 2400, gain: (motif === 'jungle' ? 0.016 : 0.022) * boost, dur: 0.08, q: 0.75 });
        fx._tone(now + 0.04, { type: 'sine', freq: _note(theme, 3, 2), slideTo: _note(theme, 4, 2), dur: 0.055, gain: 0.026 * boost });
        fx._tone(now + 0.11, { type: 'sine', freq: _note(theme, 4, 2), slideTo: _note(theme, 2, 2), dur: 0.065, gain: 0.020 * boost });
        return;
    }
    if (motif === 'mahjong') {
        _tapNoise(fx, now, { freq: 1250, gain: 0.020 * boost, dur: 0.026, q: 1.8 });
        _tapNoise(fx, now + 0.038, { freq: 1850, gain: 0.014 * boost, dur: 0.024, q: 2.0 });
        fx._tone(now + 0.018, { type: 'triangle', freq: theme.root * 1.38, slideTo: theme.root * 1.08, dur: 0.055, gain: 0.024 * boost });
        return;
    }
    if (motif === 'gong') {
        fx._tone(now, { type: 'triangle', freq: theme.root * 0.5, slideTo: theme.root * 0.48, dur: 0.34, gain: 0.035 * boost });
        fx._tone(now + 0.03, { type: 'sine', freq: theme.root * 2.0, slideTo: theme.root * 1.98, dur: 0.30, gain: 0.018 * boost });
        return;
    }
    if (motif === 'piano') {
        const chord = [0, 2, 4];
        for (let i = 0; i < chord.length; i++) {
            fx._tone(now, { type: 'sine', freq: _note(theme, chord[i], 1), dur: 0.16, gain: (0.045 - i * 0.006) * boost });
        }
        return;
    }
    if (motif === 'chip' || motif === 'arcade') {
        for (let i = 0; i < 4; i++) {
            fx._tone(now, { type: 'square', freq: _note(theme, [0, 2, 4, 5][i], 1), dur: 0.045, gain: Math.max(0.012, (0.026 - i * 0.003) * boost) });
        }
        return;
    }
    if (motif === 'space') {
        fx._tone(now, { type: 'sine', freq: _note(theme, 0, 1), slideTo: _note(theme, 4, 2), dur: 0.42, gain: 0.026 * boost });
        fx._tone(now + 0.12, { type: 'sine', freq: _note(theme, 3, 2), slideTo: _note(theme, 1, 1), dur: 0.38, gain: 0.014 * boost });
        return;
    }
    if (motif === 'spell' || motif === 'fairy' || motif === 'sparkle') {
        for (let i = 0; i < 5; i++) {
            const degree = [0, 2, 4, 5, 6][i];
            fx._tone(now, { type: i % 2 ? 'sine' : 'triangle', freq: _note(theme, degree, 2), slideTo: _note(theme, degree, 2) * 1.04, dur: 0.075, gain: Math.max(0.010, 0.028 - i * 0.004) * boost });
        }
        return;
    }
    if (motif === 'underworld') {
        _tapNoise(fx, now, { freq: 950, gain: 0.016 * boost, dur: 0.052, q: 0.8 });
        fx._tone(now + 0.035, { type: 'triangle', freq: theme.root * 1.25, slideTo: theme.root * 1.58, dur: 0.11, gain: 0.024 * boost });
        return;
    }
    if (motif === 'confetti' || motif === 'candy') {
        _tapNoise(fx, now, { freq: 2600, gain: 0.024 * boost, dur: 0.055, q: 1.2 });
        _playChordAccent(fx, now + 0.03, theme, { degrees: [0, 2, 4, 5], dur: 0.075, gain: 0.034 * boost, octave: 1, slide: 1.04 });
        return;
    }
    if (motif === 'cafe' || motif === 'kitchen') {
        _tapNoise(fx, now, { freq: motif === 'cafe' ? 850 : 1200, gain: 0.026 * boost, dur: 0.045, q: 1.4 });
        fx._tone(now + 0.035, { type: 'triangle', freq: theme.root * 1.4, slideTo: theme.root * 1.05, dur: 0.11, gain: 0.027 * boost });
        return;
    }
    if (motif === 'pet' || motif === 'boing') {
        fx._tone(now, { type: 'sine', freq: theme.root * 1.8, slideTo: theme.root * 2.25, dur: 0.07, gain: 0.032 * boost });
        fx._tone(now + 0.075, { type: 'sine', freq: theme.root * 2.25, slideTo: theme.root * 1.65, dur: 0.08, gain: 0.023 * boost });
        return;
    }
    if (motif === 'device' || motif === 'alloy') {
        _tapNoise(fx, now, { freq: 1800, gain: 0.022 * boost, dur: 0.028, q: 2.5 });
        fx._tone(now + 0.01, { type: 'sine', freq: theme.root * 5, dur: 0.06, gain: 0.017 * boost });
        return;
    }
    if (motif === 'sakura' || motif === 'ember' || motif === 'sun') {
        _playChordAccent(fx, now, theme, { degrees: [0, 2, 4], dur: 0.12, gain: 0.034 * boost, octave: 1, slide: motif === 'ember' ? 0.98 : 1.03 });
        return;
    }
    _playChordAccent(fx, now, theme, { degrees: [0, 2, 4], dur: 0.10, gain: 0.03 * boost, octave: 1, slide: 1.03 });
}

function _playScoreLift(fx, now, theme, level = 1) {
    const strength = Math.min(7, 3 + Math.max(0, level | 0));
    _playChordAccent(fx, now, theme, {
        degrees: [0, 2, 4, 5],
        dur: 0.11,
        gain: 0.024 + Math.min(0.022, level * 0.003),
        octave: 1,
        slide: 1.06,
    });
    fx._tone(now + 0.10, {
        type: 'sine',
        freq: _note(theme, Math.min(5, strength), 2),
        slideTo: _note(theme, Math.min(5, strength), 2) * 1.08,
        dur: 0.22,
        gain: 0.024 + Math.min(0.020, level * 0.003),
    });
    _playThemeAir(fx, now + 0.08, theme, 0.8 + Math.min(1.2, level * 0.18));
}

function _makePalette(theme) {
    return {
        place(now, fx) {
            if (_playExternalAsset(fx, theme, 'place', now)) return;
            _playMaterialClick(fx, now, theme);
        },
        clear(now, fx) {
            if (_playExternalAsset(fx, theme, 'clear', now)) return;
            if (theme.material === 'water') {
                fx._tone(now, { type: 'sine', freq: theme.root * 4, slideTo: theme.root * 1.25, dur: 0.24, gain: 0.08 });
                fx._tone(now + 0.08, { type: 'sine', freq: theme.root * 3, slideTo: theme.root * 1.5, dur: 0.18, gain: 0.052 });
            } else if (theme.material === 'leaf') {
                _playThemeAir(fx, now, theme, 1.2);
                _playChordAccent(fx, now + 0.02, theme, { degrees: [0, 2, 4], dur: 0.09, gain: 0.07, slide: 1.04 });
            } else if (theme.material === 'drum') {
                fx._tone(now, { type: 'triangle', freq: theme.root * 1.1, slideTo: theme.root * 0.92, dur: 0.07, gain: 0.045 });
                _playChordAccent(fx, now + 0.06, theme, { degrees: [0, 2], dur: 0.09, gain: 0.045, octave: 1, slide: 1.02 });
            } else {
                _playChordAccent(fx, now, theme, { degrees: [0, 2, 4], dur: 0.12, gain: 0.075, slide: 1.03 });
                _playThemeAir(fx, now + 0.04, theme, 0.85);
            }
            _playThemeMotif(fx, now + 0.14, theme, 'clear');
        },
        multi(now, fx) {
            if (_playExternalAsset(fx, theme, 'multi', now)) {
                _playScoreLift(fx, now + 0.08, theme, 2);
                return;
            }
            _playMaterialClick(fx, now, theme, 0.8);
            _playChordAccent(fx, now + 0.04, theme, { degrees: [0, 2, 4, 5], dur: 0.14, gain: 0.078, slide: 1.04 });
            _playThemeAir(fx, now + 0.10, theme, 1.5);
            _playThemeMotif(fx, now + 0.20, theme, 'multi');
        },
        combo(now, fx, streak = 0) {
            const count = Math.max(2, Math.min(6, (streak | 0) + 2));
            if (_playExternalAsset(fx, theme, 'combo', now)) {
                _playScoreLift(fx, now + 0.08, theme, count);
                _playThemeMotif(fx, now + 0.22, theme, 'combo');
                return;
            }
            if (theme.material === 'party') {
                fx._noiseBurst?.(now, { dur: 0.08, gain: 0.045, filter: 'bandpass', freq: 2600, q: 1.2 });
            }
            if (theme.material === 'drum') {
                fx._tone(now, { type: 'triangle', freq: theme.root * 1.05, slideTo: theme.root * 1.25, dur: 0.10, gain: 0.040 });
            }
            _playChordAccent(fx, now + 0.03, theme, { degrees: count > 4 ? [0, 2, 4, 5] : [0, 2, 4], dur: 0.13, gain: 0.08, octave: 1, slide: 1.05 });
            _playThemeAir(fx, now + 0.12, theme, 1.4);
            _playThemeMotif(fx, now + 0.20, theme, 'combo');
        },
        perfect(now, fx) {
            if (_playExternalAsset(fx, theme, 'perfect', now)) {
                _playScoreLift(fx, now + 0.10, theme, 7);
                _playThemeMotif(fx, now + 0.28, theme, 'perfect');
                return;
            }
            fx._noiseBurst?.(now, { dur: 0.11, gain: 0.045, filter: 'bandpass', freq: Math.max(1800, theme.root * 3.4), q: 1.15 });
            _playChordAccent(fx, now + 0.08, theme, { degrees: [0, 2, 4, 5], dur: 0.18, gain: 0.085, octave: 1, slide: 1.07 });
            _playThemeAir(fx, now + 0.28, theme, 2.0);
            _playThemeMotif(fx, now + 0.34, theme, 'perfect');
            fx._tone(now + 0.66, { type: 'sine', freq: _note(theme, 4, 2), slideTo: _note(theme, 5, 2), dur: 0.32, gain: 0.045 });
        },
        bonus(now, fx, count = 1) {
            const bonusCount = Math.max(1, count | 0);
            if (_playExternalAsset(fx, theme, 'bonus', now)) {
                _playScoreLift(fx, now + 0.08, theme, Math.min(7, 3 + bonusCount));
                _playThemeMotif(fx, now + 0.24, theme, 'bonus');
                return;
            }
            fx._noiseBurst?.(now, { dur: 0.09, gain: 0.043, filter: 'bandpass', freq: Math.max(1900, theme.root * 3.2), q: 1.15 });
            _playChordAccent(fx, now + 0.08, theme, { degrees: bonusCount > 1 ? [0, 2, 4, 5] : [0, 2, 4], dur: 0.12, gain: 0.075, octave: 1, slide: 1.07 });
            _playThemeAir(fx, now + 0.16, theme, 1.8);
            _playThemeMotif(fx, now + 0.24, theme, 'bonus');
        },
        unlock(now, fx) {
            if (_playExternalAsset(fx, theme, 'unlock', now)) return;
            _playChordAccent(fx, now, theme, { degrees: [0, 2, 4, 5], dur: 0.16, gain: 0.08, octave: 1, slide: 1.07 });
            _playThemeAir(fx, now + 0.10, theme, 1.3);
            _playThemeMotif(fx, now + 0.18, theme, 'unlock');
        },
        tick(now, fx) {
            if (_playExternalAsset(fx, theme, 'tick', now)) return;
            fx._tone(now, { type: theme.material === 'pixel' ? 'square' : 'sine', freq: _note(theme, 2, 1), dur: 0.028, gain: 0.05 });
        },
    };
}

function _installMethods(audioFx, palette) {
    audioFx._tonePlace = (now) => palette.place(now, audioFx);
    audioFx._toneClear = (now) => palette.clear(now, audioFx);
    audioFx._toneMulti = (now) => palette.multi(now, audioFx);
    audioFx._toneCombo = (now, streak) => palette.combo(now, audioFx, streak);
    audioFx._tonePerfect = (now) => palette.perfect(now, audioFx);
    audioFx._toneBonus = (now, count) => palette.bonus(now, audioFx, count);
    audioFx._toneUnlock = (now) => palette.unlock(now, audioFx);
    audioFx._toneTick = (now) => palette.tick(now, audioFx);
}

function _restoreMethods(audioFx) {
    for (const name of THEMED_METHODS) {
        const method = _origMethods[name];
        if (method) audioFx[`_tone${name[0].toUpperCase()}${name.slice(1)}`] = method;
    }
}

export function initSkinSoundPalettes({ audioFx }) {
    if (!audioFx || audioFx.__skinSoundPalettesInstalled) return;
    audioFx.__skinSoundPalettesInstalled = true;

    _origMethods = Object.fromEntries(THEMED_METHODS.map((name) => {
        const methodName = `_tone${name[0].toUpperCase()}${name.slice(1)}`;
        return [name, typeof audioFx[methodName] === 'function' ? audioFx[methodName].bind(audioFx) : null];
    }));

    const apply = (skinId) => {
        if (!SKINS[skinId]) {
            _current = null;
            _restoreMethods(audioFx);
            return;
        }
        const theme = _resolveTheme(skinId);
        const palette = _makePalette(theme);
        _current = { theme, palette };
        _installMethods(audioFx, palette);
        audioFx.getSkinSoundTheme = () => ({ ...theme });
        audioFx.preloadSkinAudioAssets = () => _preloadExternalAssets(audioFx, theme);
        _preloadExternalAssets(audioFx, theme);
    };

    try { apply(getActiveSkinId()); } catch { apply('classic'); }
    if (_unsubscribe) _unsubscribe();
    _unsubscribe = onSkinAfterApply(apply);
}

function _getCurrentPalette() { return _current; }

export const __test_only__ = {
    PRESETS,
    SKIN_SOUND_THEMES,
    _makePalette,
    _resolveTheme,
    _externalAssetUrl,
    _getCurrentPalette,
};
