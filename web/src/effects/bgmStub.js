/**
 * bgmStub.js — 程序化皮肤氛围层
 *
 * 不克隆或内置商业音频素材；用 Web Audio 生成低音量、短循环的原创氛围动机。
 * 设计目标是补足“皮肤换世界”的背景感，而不抢方块落子 / 消行音效。
 * 未来如接入授权 OGG/MP3，可复用本模块的偏好、切肤和 cross-fade API。
 */

import { getActiveSkinId, onSkinAfterApply } from '../skins.js';

const STORAGE_KEY = 'openblock_bgm_v1';
const PREFS_VERSION = 2;

const PREFS_DEFAULT = { enabled: false, volume: 0.12, version: PREFS_VERSION };
const THEME_MAP = {
    ocean: 'water', koi: 'water', summer: 'water',
    forest: 'forest', jurassic: 'forest', dawn: 'forest',
    music: 'music', neonCity: 'neon', pixel8: 'neon',
    universe: 'space', fantasy: 'magic', fairy: 'magic',
    demon: 'dark', forbidden: 'royal', mahjong: 'mahjong',
    cafe: 'cafe', food: 'cafe', fiesta: 'party',
    titanium: 'metal', apple: 'metal', aurora: 'crystal',
    sakura: 'sakura', sunset: 'warm', candy: 'cute', pets: 'cute', toon: 'cute',
};

function _load() {
    try {
        const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (raw.version !== PREFS_VERSION) return { ...PREFS_DEFAULT };
        return { ...PREFS_DEFAULT, ...raw };
    } catch { return { ...PREFS_DEFAULT }; }
}
function _save(s) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ } }

let _initialized = false;
let _prefs = null;
let _ctx = null;
let _master = null;
let _timer = null;
let _skinId = 'classic';
let _unsubSkin = null;

function _supportsWebAudio() {
    if (typeof window === 'undefined') return false;
    return !!(window.AudioContext || window.webkitAudioContext);
}

function _themeForSkin(skinId) {
    return THEME_MAP[skinId] || 'classic';
}

function _rootForTheme(theme) {
    return ({
        water: 330, forest: 294, music: 523, neon: 440, space: 262,
        magic: 466, dark: 220, royal: 330, mahjong: 294, cafe: 247,
        party: 440, metal: 247, crystal: 523, sakura: 523, warm: 330,
        cute: 440, classic: 392,
    })[theme] || 392;
}

function _ensureCtx() {
    if (_ctx) return true;
    if (!_supportsWebAudio()) return false;
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        _ctx = new Ctx();
        _master = _ctx.createGain();
        _master.gain.value = _prefs?.enabled ? (_prefs.volume || 0) : 0;
        _master.connect(_ctx.destination);
        return true;
    } catch {
        return false;
    }
}

function _unlockAndStart() {
    if (!_prefs?.enabled || !_ensureCtx()) return;
    if (_ctx.state === 'suspended') {
        _ctx.resume().then(_startLoop).catch(() => { /* ignore */ });
    } else {
        _startLoop();
    }
}

function _tone(at, { freq, dur = 0.18, gain = 0.03, type = 'sine', slideTo = null }) {
    if (!_ctx || !_master) return;
    const osc = _ctx.createOscillator();
    const g = _ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), at + dur);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    osc.connect(g);
    g.connect(_master);
    osc.start(at);
    osc.stop(at + dur + 0.03);
}

function _noise(at, { dur = 0.18, gain = 0.018, freq = 1600, q = 0.8 } = {}) {
    if (!_ctx || !_master || typeof _ctx.createBuffer !== 'function') return;
    const len = Math.max(1, Math.floor((_ctx.sampleRate || 44100) * dur));
    const buf = _ctx.createBuffer(1, len, _ctx.sampleRate || 44100);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
        const p = i / Math.max(1, len - 1);
        data[i] = (Math.random() * 2 - 1) * (Math.sin(Math.PI * p) ** 0.8);
    }
    const src = _ctx.createBufferSource();
    const filter = _ctx.createBiquadFilter();
    const g = _ctx.createGain();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq, at);
    filter.Q.setValueAtTime(q, at);
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.buffer = buf;
    src.connect(filter);
    filter.connect(g);
    g.connect(_master);
    src.start(at);
    src.stop(at + dur + 0.02);
}

function _playAmbientMotif() {
    if (!_prefs?.enabled || !_ctx || _ctx.state !== 'running') return;
    const theme = _themeForSkin(_skinId);
    const root = _rootForTheme(theme);
    const now = _ctx.currentTime + 0.02;
    if (theme === 'water') {
        _tone(now, { freq: root * 3.8, slideTo: root * 1.3, dur: 0.32, gain: 0.020 });
        _noise(now + 0.08, { dur: 0.25, gain: 0.010, freq: 1700, q: 0.7 });
    } else if (theme === 'forest') {
        _noise(now, { dur: 0.26, gain: 0.012, freq: 2400, q: 0.65 });
        _tone(now + 0.12, { freq: root * 7, slideTo: root * 8, dur: 0.055, gain: 0.012 });
    } else if (theme === 'space') {
        _tone(now, { freq: root, slideTo: root * 2.6, dur: 0.90, gain: 0.014 });
        _tone(now + 0.26, { freq: root * 3.1, slideTo: root * 1.6, dur: 0.60, gain: 0.008 });
    } else if (theme === 'dark') {
        _tone(now, { freq: root * 1.15, slideTo: root * 1.55, dur: 0.24, gain: 0.012, type: 'triangle' });
        _noise(now + 0.05, { dur: 0.12, gain: 0.008, freq: 1200, q: 0.8 });
    } else if (theme === 'mahjong') {
        _noise(now, { dur: 0.04, gain: 0.018, freq: 1100, q: 2.2 });
        _noise(now + 0.08, { dur: 0.035, gain: 0.013, freq: 1700, q: 2.4 });
    } else if (theme === 'neon') {
        for (let i = 0; i < 3; i++) _tone(now + i * 0.09, { freq: root * (2 + i * 0.5), dur: 0.06, gain: 0.012, type: 'square' });
    } else if (theme === 'party') {
        _noise(now, { dur: 0.05, gain: 0.014, freq: 2600, q: 1.2 });
        _tone(now + 0.04, { freq: root * 2, slideTo: root * 3, dur: 0.10, gain: 0.014 });
    } else if (theme === 'cafe') {
        _noise(now, { dur: 0.045, gain: 0.012, freq: 850, q: 1.4 });
        _tone(now + 0.05, { freq: root * 1.5, slideTo: root * 1.1, dur: 0.18, gain: 0.012, type: 'triangle' });
    } else if (theme === 'royal') {
        _tone(now, { freq: root * 0.5, slideTo: root * 0.49, dur: 0.45, gain: 0.013, type: 'triangle' });
    } else if (theme === 'music') {
        _tone(now, { freq: root, dur: 0.22, gain: 0.014 });
        _tone(now + 0.03, { freq: root * 1.25, dur: 0.20, gain: 0.010 });
        _tone(now + 0.06, { freq: root * 1.5, dur: 0.18, gain: 0.009 });
    } else {
        _tone(now, { freq: root * 1.5, slideTo: root * 2, dur: 0.24, gain: 0.012 });
    }
}

function _nextDelayMs() {
    const theme = _themeForSkin(_skinId);
    const base = theme === 'party' || theme === 'neon' ? 2200
        : theme === 'dark' || theme === 'space' ? 3600
            : 3000;
    return base + Math.floor(Math.random() * 1200);
}

function _loopTick() {
    _timer = null;
    if (!_prefs?.enabled) return;
    _playAmbientMotif();
    _timer = window.setTimeout(_loopTick, _nextDelayMs());
}

function _startLoop() {
    if (!_prefs?.enabled || !_ctx || _timer) return;
    if (_master) _master.gain.value = _prefs.volume;
    _timer = window.setTimeout(_loopTick, 500);
}

function _stopLoop() {
    if (_timer) {
        window.clearTimeout(_timer);
        _timer = null;
    }
    if (_master) _master.gain.value = 0;
}

export function initBgm() {
    if (_initialized) return;
    _initialized = true;
    _prefs = _load();
    try { _skinId = getActiveSkinId(); } catch { _skinId = 'classic'; }
    if (typeof window !== 'undefined') {
        window.__bgm = {
            getPrefs: () => ({ ..._prefs }),
            setEnabled(b) {
                _prefs.enabled = !!b;
                _prefs.version = PREFS_VERSION;
                _save(_prefs);
                if (_prefs.enabled) _unlockAndStart();
                else _stopLoop();
            },
            setVolume(v) {
                _prefs.volume = Math.max(0, Math.min(1, +v || 0));
                _save(_prefs);
                if (_master) _master.gain.value = _prefs.enabled ? _prefs.volume : 0;
            },
            setSkin(id) {
                _skinId = id || 'classic';
                if (_prefs.enabled && _ctx?.state === 'running') _playAmbientMotif();
            },
            isImplemented: () => true,
        };
        const unlock = () => _unlockAndStart();
        const opts = { passive: true };
        window.addEventListener('pointerdown', unlock, opts);
        window.addEventListener('touchstart', unlock, opts);
        window.addEventListener('keydown', unlock);
    }
    _unsubSkin = onSkinAfterApply((id) => {
        _skinId = id;
        if (_prefs?.enabled && _ctx?.state === 'running') _playAmbientMotif();
    });
    void _unsubSkin;
    console.info('[BGM] procedural skin ambience initialized.');
}
