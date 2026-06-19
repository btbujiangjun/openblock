import { describe, expect, it } from 'vitest';
import {
    __test_only__,
    resetPbChaseBgm,
    updatePbChaseBgm,
} from '../web/src/effects/pbChaseBgm.js';

describe('pbChaseBgm phase selection', () => {
    const { _targetPhase, TRACKS } = __test_only__;

    it('stays off for low or warmup PB contexts', () => {
        expect(_targetPhase({ score: 300, pbBaseline: 0, placements: 5 })).toBe('off');
        expect(_targetPhase({ score: 180, pbBaseline: 190, placements: 5 })).toBe('off');
        expect(_targetPhase({ score: 900, pbBaseline: 1000, placements: 2 })).toBe('off');
    });

    it('maps PB distance into near, sprint, and release phases', () => {
        expect(_targetPhase({ score: 790, pbBaseline: 1000, placements: 3 })).toBe('off');
        expect(_targetPhase({ score: 800, pbBaseline: 1000, placements: 3 })).toBe('near');
        expect(_targetPhase({ score: 950, pbBaseline: 1000, placements: 3 })).toBe('sprint');
        expect(_targetPhase({ score: 1001, pbBaseline: 1000, placements: 3 })).toBe('release');
    });

    it('stops unfinished chase loops on game over', () => {
        expect(_targetPhase({ score: 950, pbBaseline: 1000, placements: 3, gameOver: true })).toBe('off');
        expect(_targetPhase({ score: 1001, pbBaseline: 1000, placements: 3, gameOver: true })).toBe('release');
    });

    it('uses short WAV cue assets instead of old long OGG loops', () => {
        expect(TRACKS).toEqual({
            near: '/audio/game/pb_chase/pb_near.wav',
            sprint: '/audio/game/pb_chase/pb_sprint.wav',
            release: '/audio/game/pb_chase/pb_release.wav',
        });
    });
});

describe('pbChaseBgm short cue playback', () => {
    function installAudioHarness() {
        const instances = [];
        const oldWindow = globalThis.window;
        const oldAudio = globalThis.Audio;
        globalThis.window = {
            setInterval: () => 1,
            clearInterval: () => {},
        };
        globalThis.Audio = class FakeAudio {
            constructor(src) {
                this.src = src;
                this.preload = '';
                this.loop = true;
                this.volume = 0;
                this.currentTime = 0;
                this.paused = false;
                this.onended = null;
                instances.push(this);
            }
            play() {
                this.paused = false;
                return Promise.resolve();
            }
            pause() {
                this.paused = true;
            }
        };
        return {
            instances,
            cleanup() {
                resetPbChaseBgm();
                globalThis.window = oldWindow;
                globalThis.Audio = oldAudio;
            },
        };
    }

    it('announces near once with loop=false', () => {
        const h = installAudioHarness();
        try {
            updatePbChaseBgm({ score: 800, pbBaseline: 1000, placements: 3 });
            expect(h.instances).toHaveLength(1);
            expect(h.instances[0].src).toBe('/audio/game/pb_chase/pb_near.wav');
            expect(h.instances[0].loop).toBe(false);
        } finally {
            h.cleanup();
        }
    });

    it('does not replay the same phase after its 3s cue ends while score remains in the same band', () => {
        const h = installAudioHarness();
        try {
            updatePbChaseBgm({ score: 800, pbBaseline: 1000, placements: 3 });
            updatePbChaseBgm({ score: 820, pbBaseline: 1000, placements: 4 });
            expect(h.instances).toHaveLength(1);
            h.instances[0].onended?.();
            updatePbChaseBgm({ score: 840, pbBaseline: 1000, placements: 5 });
            expect(h.instances).toHaveLength(1);
        } finally {
            h.cleanup();
        }
    });

    it('creates a new cue only when moving into another PB phase', () => {
        const h = installAudioHarness();
        try {
            updatePbChaseBgm({ score: 800, pbBaseline: 1000, placements: 3 });
            h.instances[0].onended?.();
            updatePbChaseBgm({ score: 950, pbBaseline: 1000, placements: 4 });
            expect(h.instances).toHaveLength(2);
            expect(h.instances[1].src).toBe('/audio/game/pb_chase/pb_sprint.wav');
            expect(h.instances[1].loop).toBe(false);
        } finally {
            h.cleanup();
        }
    });
});
