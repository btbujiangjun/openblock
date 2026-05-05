/**
 * 小程序端程序化音效。
 *
 * 不引入音频资源：首次播放时生成短 WAV 到 USER_DATA_PATH，再用 InnerAudioContext 播放。
 */
const storage = require('../adapters/storage');

const STORAGE_KEY = 'openblock_audiofx_v1';
const DEFAULT_PREFS = { sound: true, haptic: true, volume: 0.45 };
const SAMPLE_RATE = 22050;

const SOUND_DEFS = {
  place: { dur: 0.09, tones: [{ f0: 700, f1: 480, gain: 0.45 }] },
  clear: { dur: 0.36, tones: [{ f0: 360, f1: 1020, gain: 0.36 }, { t: 0.05, f0: 540, f1: 1580, gain: 0.18 }, { f0: 92, f1: 52, gain: 0.16 }] },
  multi: { dur: 0.52, tones: [{ f0: 400, f1: 1080, gain: 0.34 }, { t: 0.10, f0: 580, f1: 1320, gain: 0.28 }, { t: 0.18, f0: 1560, gain: 0.10 }] },
  combo: { dur: 0.56, tones: [{ f0: 523, f1: 640, gain: 0.20 }, { t: 0.10, f0: 660, f1: 810, gain: 0.22 }, { t: 0.20, f0: 784, f1: 980, gain: 0.24 }, { t: 0.32, f0: 1397, f1: 2093, gain: 0.16 }] },
  perfect: { dur: 0.9, tones: [{ f0: 98, f1: 49, gain: 0.20 }, { t: 0.14, f0: 523, f1: 620, gain: 0.22 }, { t: 0.24, f0: 659, f1: 780, gain: 0.22 }, { t: 0.34, f0: 784, f1: 930, gain: 0.22 }, { t: 0.54, f0: 1568, f1: 2350, gain: 0.12 }], noise: 0.08 },
  bonus: { dur: 0.72, tones: [{ f0: 90, f1: 45, gain: 0.24 }, { t: 0.08, f0: 220, f1: 440, gain: 0.14 }, { t: 0.22, f0: 392, f1: 580, gain: 0.18 }, { t: 0.36, f0: 523, f1: 760, gain: 0.16 }], noise: 0.12 },
  gameOver: { dur: 0.82, tones: [{ f0: 165, f1: 82, gain: 0.22 }, { t: 0.10, f0: 659, f1: 494, gain: 0.14 }, { t: 0.36, f0: 392, f1: 330, gain: 0.14 }] },
  tick: { dur: 0.04, tones: [{ f0: 880, gain: 0.26 }] },
  select: { dur: 0.08, tones: [{ f0: 660, f1: 1040, gain: 0.22 }, { t: 0.035, f0: 1320, gain: 0.08 }] },
};

const HAPTICS = {
  place: 'light',
  clear: 'medium',
  multi: 'medium',
  combo: 'heavy',
  bonus: 'heavy',
  perfect: 'heavy',
  gameOver: 'heavy',
  select: 'light',
};

const FEEDBACK_PRIORITY = {
  tick: 0,
  place: 1,
  clear: 2,
  multi: 3,
  combo: 4,
  bonus: 5,
  perfect: 6,
  gameOver: 6,
  select: 1,
};

function loadPrefs() {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs(prefs) {
  try { storage.setItem(STORAGE_KEY, JSON.stringify(prefs)); } catch { /* ignore */ }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function bytesToBase64(bytes) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63]
      + (i + 1 < bytes.length ? chars[(n >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? chars[n & 63] : '=');
  }
  return out;
}

function writeAscii(view, offset, text) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

function synthWav(def, volume) {
  const frames = Math.max(1, Math.floor(def.dur * SAMPLE_RATE));
  const bytes = new Uint8Array(44 + frames * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + frames * 2, true);
  writeAscii(view, 8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, frames * 2, true);

  for (let i = 0; i < frames; i++) {
    const t = i / SAMPLE_RATE;
    let sample = 0;
    for (const tone of def.tones || []) {
      const local = t - (tone.t || 0);
      if (local < 0) continue;
      const remain = def.dur - (tone.t || 0);
      if (local > remain) continue;
      const p = local / Math.max(0.001, remain);
      const env = Math.sin(Math.PI * clamp(p, 0, 1)) ** 0.72;
      const f = tone.f1 ? tone.f0 * ((tone.f1 / tone.f0) ** clamp(p, 0, 1)) : tone.f0;
      sample += Math.sin(2 * Math.PI * f * local) * (tone.gain || 0.2) * env;
    }
    if (def.noise) {
      const env = Math.sin(Math.PI * (i / frames)) ** 0.55;
      sample += (Math.random() * 2 - 1) * def.noise * env;
    }
    view.setInt16(44 + i * 2, clamp(sample * volume, -1, 1) * 32767, true);
  }
  return bytes;
}

class MiniAudioFx {
  constructor() {
    this.prefs = loadPrefs();
    this._paths = {};
    this._lastPlay = 0;
    this._lastHaptic = 0;
    this._lastFeedbackAt = 0;
    this._lastFeedbackPriority = -1;
    this._warming = false;
    this._warmupQueue = [];
    this._unavailable = false;
    this._audioOptionReady = false;
    this._setupAudioSession();
  }

  setEnabled(v) { this.prefs.sound = !!v; savePrefs(this.prefs); }
  setHaptic(v) { this.prefs.haptic = !!v; savePrefs(this.prefs); }
  setVolume(v) { this.prefs.volume = clamp(Number(v) || 0, 0, 1); this._paths = {}; savePrefs(this.prefs); }
  getPrefs() { return { ...this.prefs }; }

  _setupAudioSession() {
    if (this._audioOptionReady || typeof wx === 'undefined') return;
    this._audioOptionReady = true;
    try {
      wx.setInnerAudioOption?.({
        obeyMuteSwitch: false,
        mixWithOther: true,
      });
    } catch {
      // ignore
    }
  }

  play(type, opts = {}) {
    if (!this.prefs.sound) return;
    this._setupAudioSession();
    const now = Date.now();
    if (!opts.force && now - this._lastPlay < 24 && type !== 'perfect' && type !== 'bonus') return;
    this._lastPlay = now;
    const src = this._paths[type] || this._ensureSoundFile(type);
    if (!src) {
      this.warmup([type]);
      return;
    }
    if (typeof wx === 'undefined' || !wx.createInnerAudioContext) return;
    try {
      const audio = wx.createInnerAudioContext();
      audio.obeyMuteSwitch = false;
      audio.volume = clamp(this.prefs.volume, 0, 1);
      audio.onEnded(() => audio.destroy());
      audio.onError((err) => {
        console.warn('[audioFx] play failed', type, err);
        audio.destroy();
      });
      let started = false;
      const start = () => {
        if (started) return;
        started = true;
        try { audio.play(); } catch { /* ignore */ }
      };
      audio.onCanplay(start);
      audio.src = src;
      setTimeout(start, 20);
    } catch (err) {
      console.warn('[audioFx] create failed', type, err);
    }
  }

  vibrate(type) {
    if (!this.prefs.haptic) return;
    const now = Date.now();
    if (now - this._lastHaptic < 55 && type !== 'perfect' && type !== 'gameOver') return;
    this._lastHaptic = now;
    const level = HAPTICS[type] || 'light';
    try {
      wx.vibrateShort({ type: level });
    } catch {
      try { wx.vibrateShort(); } catch { /* ignore */ }
    }
  }

  feedback(type, opts = {}) {
    const now = Date.now();
    const priority = FEEDBACK_PRIORITY[type] ?? 1;
    if (now - this._lastFeedbackAt < 72 && priority < this._lastFeedbackPriority) return;
    this._lastFeedbackAt = now;
    this._lastFeedbackPriority = priority;
    this.play(type, { force: opts.force || type === 'gameOver' });
    this.vibrate(type);
  }

  warmup(types = Object.keys(SOUND_DEFS)) {
    if (this._unavailable || !this.prefs.sound) return;
    for (const type of types) {
      if (SOUND_DEFS[type] && !this._paths[type] && !this._warmupQueue.includes(type)) {
        this._warmupQueue.push(type);
      }
    }
    if (this._warming) return;
    this._warming = true;
    const step = () => {
      const type = this._warmupQueue.shift();
      if (!type) {
        this._warming = false;
        return;
      }
      this._ensureSoundFile(type);
      setTimeout(step, 80);
    };
    setTimeout(step, 120);
  }

  _ensureSoundFile(type) {
    if (this._paths[type]) return this._paths[type];
    const def = SOUND_DEFS[type];
    if (!def || typeof wx === 'undefined') return '';
    const wav = synthWav(def, this.prefs.volume);
    const base64 = bytesToBase64(wav);
    if (!wx.getFileSystemManager || !wx.env || !wx.env.USER_DATA_PATH) {
      const dataUri = `data:audio/wav;base64,${base64}`;
      this._paths[type] = dataUri;
      return dataUri;
    }
    try {
      const fs = wx.getFileSystemManager();
      const filePath = `${wx.env.USER_DATA_PATH}/openblock_${type}_v3.wav`;
      fs.writeFileSync(filePath, base64, 'base64');
      this._paths[type] = filePath;
      return filePath;
    } catch (err) {
      console.warn('[audioFx] write failed, fallback to data uri', type, err);
      const dataUri = `data:audio/wav;base64,${base64}`;
      this._paths[type] = dataUri;
      return dataUri;
    }
  }
}

let instance = null;

function createAudioFx() {
  if (!instance) instance = new MiniAudioFx();
  return instance;
}

module.exports = { createAudioFx };
