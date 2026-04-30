/**
 * skinSoundPalettes.js — v10.16 皮肤专属音色（P1）
 *
 * 让每款皮肤有独特音色：music 钢琴 / forest 鸟鸣 / industrial 金属 / ocean 水滴
 *
 * 实施
 * ----
 * - 各皮肤逐一定义可选 palette（频率 / 波形 / 时长），未定义者回退到 audioFx 默认
 * - 通过覆盖 audioFx 内部音色函数（_toneClear / _toneCombo / _toneBonus 等）实现
 * - 在 onSkinAfterApply 触发时切换 palette
 *
 * 当前实装的 palette（剩余可按相同模式扩展）
 * -------------------------------------------
 *   music       钢琴 — 三和弦 + 颤音
 *   forest      鸟鸣 — 频率快速颤动 + 三连鸣
 *   industrial  金属敲击 — 短促方波低频
 *   ocean       水滴 — sine 由高到低指数滑动
 *   sakura      古琴 — 三连音 + 衰减
 *   demon       战鼓 — 低频方波 + 双击
 */

import { onSkinAfterApply } from '../skins.js';

const PALETTES = {
    music: {
        clear:   (now, fx) => fx._tone(now, { type: 'sine', freq: 523.25, dur: 0.18, gain: 0.14 }),
        combo:   (now, fx, streak = 0) => {
            const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
            const steps = Math.min(2 + Math.max(0, streak | 0), 5);
            for (let i = 0; i < steps; i++) {
                fx._tone(now + i * 0.08, { type: 'sine', freq: notes[i], dur: 0.10, gain: 0.13 });
            }
        },
        bonus:   (now, fx) => fx._tone(now, { type: 'sine', freq: 1046.5, slideTo: 1568, dur: 0.10, gain: 0.10 }),
    },
    forest: {
        clear:   (now, fx) => {
            for (let i = 0; i < 3; i++) {
                fx._tone(now + i * 0.05, { type: 'sine', freq: 1800 + i * 200, slideTo: 2200, dur: 0.05, gain: 0.10 });
            }
        },
        combo:   (now, fx) => {
            for (let i = 0; i < 5; i++) {
                fx._tone(now + i * 0.05, { type: 'sine', freq: 1500 + Math.random() * 800, dur: 0.04, gain: 0.08 });
            }
        },
    },
    industrial: {
        clear:   (now, fx) => fx._tone(now, { type: 'square', freq: 220, slideTo: 110, dur: 0.10, gain: 0.10 }),
        combo:   (now, fx, streak = 0) => {
            const steps = Math.min(2 + (streak | 0), 5);
            for (let i = 0; i < steps; i++) {
                fx._tone(now + i * 0.06, { type: 'square', freq: 180 + i * 40, dur: 0.06, gain: 0.10 });
            }
        },
        bonus:   (now, fx) => fx._tone(now, { type: 'square', freq: 320, slideTo: 80, dur: 0.12, gain: 0.10 }),
    },
    ocean: {
        clear:   (now, fx) => fx._tone(now, { type: 'sine', freq: 1600, slideTo: 240, dur: 0.32, gain: 0.10 }),
        combo:   (now, fx, streak = 0) => {
            const steps = Math.min(2 + (streak | 0), 5);
            for (let i = 0; i < steps; i++) {
                fx._tone(now + i * 0.10, { type: 'sine', freq: 1400 - i * 120, slideTo: 200, dur: 0.20, gain: 0.10 });
            }
        },
    },
    sakura: {
        clear:   (now, fx) => {
            const notes = [659.25, 783.99, 1046.5];
            for (let i = 0; i < notes.length; i++) {
                fx._tone(now + i * 0.04, { type: 'triangle', freq: notes[i], dur: 0.18, gain: 0.10 });
            }
        },
        combo:   (now, fx) => {
            const pent = [523.25, 587.33, 659.25, 783.99, 880];   // 五声音阶
            for (let i = 0; i < 5; i++) {
                fx._tone(now + i * 0.07, { type: 'triangle', freq: pent[i], dur: 0.10, gain: 0.10 });
            }
        },
    },
    demon: {
        clear:   (now, fx) => {
            fx._tone(now, { type: 'square', freq: 130, dur: 0.06, gain: 0.10 });
            fx._tone(now + 0.08, { type: 'square', freq: 110, dur: 0.08, gain: 0.10 });
        },
        combo:   (now, fx, streak = 0) => {
            const steps = Math.min(2 + (streak | 0), 5);
            for (let i = 0; i < steps; i++) {
                fx._tone(now + i * 0.07, { type: 'square', freq: 90 + i * 20, dur: 0.06, gain: 0.10 });
            }
        },
        bonus:   (now, fx) => fx._tone(now, { type: 'sawtooth', freq: 320, slideTo: 80, dur: 0.18, gain: 0.10 }),
    },
};

let _current = null;
let _origMethods = {};

export function initSkinSoundPalettes({ audioFx }) {
    if (!audioFx) return;
    /* 备份原始内部音色函数，便于回退 */
    _origMethods = {
        clear: audioFx._toneClear.bind(audioFx),
        combo: audioFx._toneCombo.bind(audioFx),
        bonus: audioFx._toneBonus.bind(audioFx),
    };

    const apply = (skinId) => {
        const palette = PALETTES[skinId] || null;
        _current = palette;
        if (palette?.clear) audioFx._toneClear = (now) => palette.clear(now, audioFx);
        else                audioFx._toneClear = _origMethods.clear;
        if (palette?.combo) audioFx._toneCombo = (now, streak) => palette.combo(now, audioFx, streak);
        else                audioFx._toneCombo = _origMethods.combo;
        if (palette?.bonus) audioFx._toneBonus = (now) => palette.bonus(now, audioFx);
        else                audioFx._toneBonus = _origMethods.bonus;
    };

    /* 当前皮肤立即应用 */
    try {
        const cur = (typeof window !== 'undefined' && window.openBlockGame?.currentSkinId) ||
                    (typeof window !== 'undefined' && window.localStorage?.getItem?.('openblock_skin'));
        if (cur) apply(cur);
    } catch { /* ignore */ }

    onSkinAfterApply(apply);
}

export function getCurrentPalette() { return _current; }
export const __test_only__ = { PALETTES };
