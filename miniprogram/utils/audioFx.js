/**
 * 小程序端程序化音效。
 *
 * 不引入音频资源：首次播放时生成短 WAV 到 USER_DATA_PATH，再用 InnerAudioContext 播放。
 */
const storage = require('../adapters/storage');

const STORAGE_KEY = 'openblock_audiofx_v1';
const DEFAULT_PREFS = { sound: true, haptic: true, volume: 0.55 };
const SAMPLE_RATE = 22050;
const ASSET_EVENTS = ['place', 'clear', 'multi', 'combo', 'perfect', 'bonus', 'unlock', 'gameOver', 'tick', 'select'];

const BASE_SOUND_DEFS = {
  place: { dur: 0.09, tones: [{ f0: 700, f1: 480, gain: 0.45 }] },
  clear: { dur: 0.36, tones: [{ f0: 520, f1: 1120, gain: 0.30 }, { f0: 780, f1: 1420, gain: 0.18 }, { f0: 1040, f1: 1680, gain: 0.12 }] },
  multi: { dur: 0.52, tones: [{ f0: 520, f1: 1180, gain: 0.30 }, { f0: 780, f1: 1480, gain: 0.22 }, { f0: 1560, gain: 0.10 }] },
  combo: { dur: 0.56, tones: [{ f0: 523, f1: 680, gain: 0.18 }, { f0: 660, f1: 860, gain: 0.18 }, { f0: 784, f1: 1020, gain: 0.18 }, { f0: 1397, f1: 2093, gain: 0.12 }] },
  perfect: { dur: 0.9, tones: [{ f0: 523, f1: 680, gain: 0.18 }, { f0: 659, f1: 820, gain: 0.18 }, { f0: 784, f1: 980, gain: 0.18 }, { f0: 1568, f1: 2200, gain: 0.10 }], noise: 0.06 },
  bonus: { dur: 0.72, tones: [{ f0: 392, f1: 520, gain: 0.16 }, { f0: 523, f1: 700, gain: 0.16 }, { f0: 659, f1: 860, gain: 0.14 }, { f0: 1046, f1: 1568, gain: 0.10 }], noise: 0.08 },
  unlock: { dur: 0.56, tones: [{ f0: 640, f1: 960, gain: 0.18 }, { f0: 960, f1: 1280, gain: 0.14 }, { f0: 1280, f1: 1680, gain: 0.10 }], noise: 0.035 },
  gameOver: { dur: 0.82, tones: [{ f0: 165, f1: 82, gain: 0.20 }, { f0: 392, f1: 330, gain: 0.12 }, { f0: 659, f1: 494, gain: 0.10 }] },
  tick: { dur: 0.04, tones: [{ f0: 880, gain: 0.26 }] },
  select: { dur: 0.08, tones: [{ f0: 660, f1: 1040, gain: 0.22 }, { t: 0.035, f0: 1320, gain: 0.08 }] },
};

const SKIN_SOUND_PROFILES = {
  classic: { root: 392, group: 'tile', texture: 1500 },
  titanium: { root: 247, group: 'metal', texture: 2100 },
  aurora: { root: 523, group: 'glass', texture: 3200 },
  neonCity: { root: 440, group: 'neon', texture: 2600 },
  ocean: { root: 330, group: 'water', texture: 1700 },
  sunset: { root: 330, group: 'warm', texture: 1100 },
  sakura: { root: 523, group: 'royal', texture: 2400 },
  koi: { root: 392, group: 'water', texture: 1500 },
  candy: { root: 523, group: 'cute', texture: 2600 },
  toon: { root: 392, group: 'rubber', texture: 1200 },
  pixel8: { root: 330, group: 'pixel', texture: 2200 },
  dawn: { root: 392, group: 'nature', texture: 2400 },
  summer: { root: 440, group: 'water', texture: 1900 },
  food: { root: 294, group: 'wood', texture: 1200 },
  music: { root: 523, group: 'music', texture: 2800 },
  pets: { root: 440, group: 'cute', texture: 1800 },
  universe: { root: 262, group: 'space', texture: 3200 },
  fantasy: { root: 466, group: 'magic', texture: 3400 },
  greece: { root: 349, group: 'royal', texture: 1800 },
  demon: { root: 247, group: 'dark', texture: 950 },
  jurassic: { root: 294, group: 'jungle', texture: 1500 },
  fairy: { root: 523, group: 'magic', texture: 3600 },
  forbidden: { root: 330, group: 'royal', texture: 900 },
  mahjong: { root: 330, group: 'mahjong', texture: 1350 },
  forest: { root: 330, group: 'nature', texture: 2200 },
  apple: { root: 330, group: 'glass', texture: 2600 },
  cafe: { root: 247, group: 'wood', texture: 850 },
  arcadeCabinet: { root: 392, group: 'pixel', texture: 2200 },
  circuitBoard: { root: 440, group: 'neon', texture: 2600 },
  toyBox: { root: 523, group: 'rubber', texture: 1400 },
  mineralCave: { root: 330, group: 'glass', texture: 3000 },
  alchemyLab: { root: 466, group: 'magic', texture: 3400 },
  botanicalStudy: { root: 294, group: 'nature', texture: 2200 },
  spaceDock: { root: 294, group: 'space', texture: 3200 },
  dungeonLoot: { root: 247, group: 'dark', texture: 1200 },
  origamiPaper: { root: 392, group: 'royal', texture: 1600 },
  museumRelic: { root: 294, group: 'royal', texture: 1100 },
  winterCabin: { root: 262, group: 'wood', texture: 800 },
  rainyWindow: { root: 330, group: 'water', texture: 1500 },
  inkGarden: { root: 392, group: 'royal', texture: 1600 },
  fiesta: { root: 440, group: 'party', texture: 2600 },
};

function semitone(root, steps) {
  return root * (2 ** (steps / 12));
}

function groupForSkin(skinId) {
  return (SKIN_SOUND_PROFILES[skinId] || SKIN_SOUND_PROFILES.classic).group;
}

function buildThemeSoundDefs(skinId) {
  const profile = SKIN_SOUND_PROFILES[skinId] || SKIN_SOUND_PROFILES.classic;
  const root = profile.root;
  const group = profile.group;
  const texture = profile.texture || 1400;
  const scale = group === 'dark' ? [0, 3, 7, 10, 12]
    : group === 'royal' || group === 'mahjong' ? [0, 2, 5, 7, 9, 12]
      : group === 'space' || group === 'magic' ? [0, 2, 4, 6, 8, 10, 12]
        : [0, 4, 7, 12, 16];
  const note = (idx, octave = 0) => semitone(root, scale[idx % scale.length] + octave * 12);
  const air = group === 'magic' ? 0.035
    : ['water', 'cute', 'space', 'party'].includes(group) ? 0.11
    : group === 'dark' ? 0.045
      : 0.055;
  const place = (() => {
    if (group === 'water') return { dur: 0.11, tones: [{ f0: root * 4.0, f1: root * 1.4, gain: 0.34 }, { t: 0.03, f0: root * 5.2, f1: root * 2.2, gain: 0.14 }] };
    if (group === 'metal' || group === 'glass') return { dur: 0.07, tones: [{ f0: root * 2.0, f1: root * 1.4, gain: 0.34 }, { t: 0.018, f0: root * 5.0, gain: 0.12 }], noise: 0.015 };
    if (group === 'mahjong') return { dur: 0.065, tones: [{ f0: root * 1.35, f1: root * 1.05, gain: 0.30 }, { t: 0.02, f0: root * 2.45, gain: 0.08 }], noise: 0.012 };
    if (group === 'wood' || group === 'nature' || group === 'jungle' || group === 'royal') return { dur: 0.08, tones: [{ f0: root * 1.25, f1: root * 0.92, gain: 0.30 }, { t: 0.02, f0: root * 2.25, gain: 0.08 }], noise: group === 'jungle' ? 0.012 : 0.016 };
    if (group === 'magic') return { dur: 0.075, tones: [{ f0: root * 2.4, f1: root * 2.85, gain: 0.24 }, { t: 0.026, f0: root * 4.6, f1: root * 5.2, gain: 0.09 }], noise: 0.006 };
    if (group === 'dark') return { dur: 0.075, tones: [{ f0: root * 1.22, f1: root * 1.48, gain: 0.25 }, { t: 0.03, f0: root * 2.0, gain: 0.07 }], noise: 0.006 };
    if (group === 'pixel') return { dur: 0.07, tones: [{ f0: root * 2.0, gain: 0.34 }, { t: 0.035, f0: root * 3.0, gain: 0.18 }] };
    if (group === 'rubber') return { dur: 0.10, tones: [{ f0: root * 1.55, f1: root * 2.05, gain: 0.28 }, { t: 0.055, f0: root * 2.05, f1: root * 1.45, gain: 0.14 }] };
    return { dur: 0.07, tones: [{ f0: root * 1.7, f1: root * 1.25, gain: 0.32 }, { t: 0.03, f0: root * 2.4, gain: 0.10 }] };
  })();
  const motif = [
    { f0: texture, f1: texture * (group === 'water' ? 0.65 : group === 'dark' ? 1.04 : 1.08), gain: group === 'dark' ? 0.030 : group === 'mahjong' ? 0.045 : 0.065 },
    { f0: note(3, 1), f1: note(3, 1) * 1.04, gain: 0.055 },
  ];
  return {
    place,
    clear: {
      dur: 0.34,
      tones: [
        { f0: note(0), f1: note(2), gain: 0.28 },
        { f0: note(2), f1: note(3), gain: 0.18 },
        { f0: note(4), f1: note(4) * 1.05, gain: 0.13 },
        ...motif.slice(0, 1),
      ],
      noise: air * 0.35,
    },
    multi: {
      dur: 0.48,
      tones: [
        { f0: note(0), f1: note(2), gain: 0.28 },
        { f0: note(2), f1: note(3), gain: 0.20 },
        { f0: note(4), f1: note(4) * 1.06, gain: 0.15 },
        { f0: note(3, 1), f1: note(3, 1) * 1.05, gain: 0.10 },
        ...motif,
      ],
      noise: air * 0.45,
    },
    combo: {
      dur: 0.56,
      tones: [
        { f0: root * (group === 'dark' ? 1.1 : 0.95), f1: root * (group === 'dark' ? 1.55 : 1.25), gain: group === 'dark' ? 0.09 : 0.08 },
        { f0: note(1), f1: note(2), gain: 0.15 },
        { f0: note(3), f1: note(4), gain: 0.17 },
        { f0: note(4, 1), f1: note(4, 1) * 1.04, gain: 0.12 },
        ...motif,
      ],
      noise: air * 0.55,
    },
    perfect: {
      dur: 0.9,
      tones: [
        { f0: root * (group === 'dark' ? 1.1 : 0.92), f1: root * (group === 'dark' ? 1.6 : 1.3), gain: group === 'dark' ? 0.09 : 0.12 },
        { f0: note(0, 1), f1: note(1, 1), gain: 0.17 },
        { f0: note(2, 1), f1: note(3, 1), gain: 0.17 },
        { f0: note(4, 1), f1: note(4, 1) * 1.08, gain: 0.11 },
      ],
      noise: group === 'dark' ? 0.045 : Math.max(0.08, air),
    },
    bonus: {
      dur: 0.72,
      tones: [
        { f0: root * (group === 'dark' ? 1.08 : 0.96), f1: root * (group === 'dark' ? 1.5 : 1.35), gain: group === 'dark' ? 0.10 : 0.13 },
        { f0: note(0), f1: note(1), gain: 0.12 },
        { f0: note(2), f1: note(3), gain: 0.14 },
        { f0: note(4), f1: note(4) * 1.06, gain: 0.11 },
      ],
      noise: group === 'dark' ? 0.05 : Math.max(0.10, air),
    },
    unlock: {
      dur: 0.56,
      tones: [
        { f0: note(0, 1), f1: note(1, 1), gain: 0.16 },
        { f0: note(2, 1), f1: note(3, 1), gain: 0.14 },
        { f0: note(4, 1), f1: note(4, 1) * 1.06, gain: 0.10 },
        ...motif.slice(0, 1),
      ],
      noise: group === 'magic' ? 0.025 : air * 0.45,
    },
    gameOver: BASE_SOUND_DEFS.gameOver,
    tick: { dur: 0.04, tones: [{ f0: note(2, 1), gain: 0.22 }] },
    select: { dur: 0.08, tones: [{ f0: note(1, 1), f1: note(2, 1), gain: 0.20 }, { t: 0.035, f0: note(4, 1), gain: 0.08 }] },
  };
}

const HAPTICS = {
  place: 'light',
  clear: 'medium',
  multi: 'medium',
  combo: 'heavy',
  bonus: 'heavy',
  perfect: 'heavy',
  gameOver: 'heavy',
  unlock: 'medium',
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
  unlock: 5,
  gameOver: 6,
  select: 1,
};

function loadPrefs() {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const prefs = raw ? { ...DEFAULT_PREFS, ...JSON.parse(raw) } : { ...DEFAULT_PREFS };
    if (prefs.haptic !== prefs.sound) {
      prefs.haptic = prefs.sound;
      savePrefs(prefs);
    }
    return prefs;
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
    this._skinTheme = 'classic';
    this._skinSoundGroup = groupForSkin(this._skinTheme);
    this._soundDefs = buildThemeSoundDefs(this._skinTheme);
    this._assetMissing = {};
    this._setupAudioSession();
  }

  setEnabled(v) {
    this.prefs.sound = !!v;
    this.prefs.haptic = this.prefs.sound;
    savePrefs(this.prefs);
  }
  setHaptic(v) {
    this.prefs.haptic = !!v && this.prefs.sound !== false;
    savePrefs(this.prefs);
  }
  setVolume(v) { this.prefs.volume = clamp(Number(v) || 0, 0, 1); this._paths = {}; savePrefs(this.prefs); }
  getPrefs() { return { ...this.prefs }; }
  getSkinTheme() { return this._skinTheme; }
  setSkinTheme(skinId) {
    const id = String(skinId || 'classic');
    if (id === this._skinTheme) return;
    this._skinTheme = id;
    this._skinSoundGroup = groupForSkin(id);
    this._soundDefs = buildThemeSoundDefs(id);
    this._paths = {};
    this._warmupQueue = this._warmupQueue.filter((type) => this._soundDefs[type]);
  }

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
    const external = this._externalSoundSrc(type);
    if (external) {
      this._playSrc(type, external, () => this._playGenerated(type));
      return;
    }
    this._playGenerated(type);
  }

  _playGenerated(type) {
    const src = this._paths[type] || this._ensureSoundFile(type);
    if (!src) {
      this.warmup([type]);
      return;
    }
    this._playSrc(type, src);
  }

  _playSrc(type, src, onErrorFallback = null) {
    if (typeof wx === 'undefined' || !wx.createInnerAudioContext) return;
    try {
      const audio = wx.createInnerAudioContext();
      audio.obeyMuteSwitch = false;
      audio.volume = clamp(this.prefs.volume, 0, 1);
      audio.onEnded(() => audio.destroy());
      audio.onError((err) => {
        console.warn('[audioFx] play failed', type, err);
        audio.destroy();
        if (onErrorFallback) {
          this._assetMissing[src] = true;
          onErrorFallback();
        }
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

  _externalSoundSrc(type) {
    if (!ASSET_EVENTS.includes(type)) return '';
    try {
      if (globalThis.__openBlockDisableExternalAudioAssets === true) return '';
    } catch { /* ignore */ }
    const base = (() => {
      try {
        const custom = globalThis.__openBlockAudioAssetBase;
        if (custom && typeof custom === 'string') return custom.replace(/\/+$/, '');
      } catch { /* ignore */ }
      return 'assets/audio/skins';
    })();
    const skin = encodeURIComponent(this._skinTheme || 'classic');
    const group = encodeURIComponent(this._skinSoundGroup || 'default');
    const candidates = [
      `${base}/${skin}/${type}.ogg`,
      `${base}/${skin}/${type}.mp3`,
      `${base}/${skin}/${type}.wav`,
      `${base}/${skin}/${type}.m4a`,
      `${base}/_themes/${group}/${type}.ogg`,
      `${base}/_themes/${group}/${type}.mp3`,
      `${base}/_themes/${group}/${type}.wav`,
      `${base}/_themes/${group}/${type}.m4a`,
      `${base}/_groups/${group}/${type}.ogg`,
      `${base}/_groups/${group}/${type}.mp3`,
      `${base}/_groups/${group}/${type}.wav`,
      `${base}/_groups/${group}/${type}.m4a`,
    ];
    return candidates.find((src) => !this._assetMissing[src]) || '';
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

  warmup(types = null) {
    if (this._unavailable || !this.prefs.sound) return;
    const queueTypes = Array.isArray(types) ? types : Object.keys(this._soundDefs);
    for (const type of queueTypes) {
      if (this._soundDefs[type] && !this._paths[type] && !this._warmupQueue.includes(type)) {
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
    const def = this._soundDefs[type];
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
