/**
 * PB chase BGM controller.
 *
 * Uses real OGG assets, not procedural synthesis. This layer is game-level and
 * intentionally ignores skin/theme so the PB chase becomes an OpenBlock motif.
 */

const TRACKS = {
    near: '/audio/game/pb_chase/pb_near.ogg',
    sprint: '/audio/game/pb_chase/pb_sprint.ogg',
    release: '/audio/game/pb_chase/pb_release.ogg',
};

const MIN_BASELINE = 200;
const BASE_VOLUME = 0.28;
const FADE_MS = 420;

let _phase = 'off';
let _releasedThisRun = false;
let _current = null;

function _canUseAudio() {
    return typeof Audio !== 'undefined' && typeof window !== 'undefined';
}

function _makeAudio(phase) {
    if (!_canUseAudio()) return null;
    const audio = new Audio(TRACKS[phase]);
    audio.preload = 'auto';
    audio.loop = phase !== 'release';
    audio.volume = 0;
    return audio;
}

function _clearFade(audio) {
    if (!audio) return;
    if (audio.__pbFadeTimer) {
        window.clearInterval(audio.__pbFadeTimer);
        audio.__pbFadeTimer = null;
    }
}

function _fadeTo(audio, targetVolume, ms = FADE_MS, onDone = null) {
    if (!audio) return;
    _clearFade(audio);
    const start = audio.volume || 0;
    const startedAt = Date.now();
    audio.__pbFadeTimer = window.setInterval(() => {
        const t = Math.min(1, (Date.now() - startedAt) / Math.max(1, ms));
        audio.volume = start + (targetVolume - start) * t;
        if (t >= 1) {
            _clearFade(audio);
            if (onDone) onDone();
        }
    }, 40);
}

function _stopCurrent({ keepPhase = false } = {}) {
    const audio = _current;
    _current = null;
    if (!keepPhase) _phase = 'off';
    if (!audio) return;
    _fadeTo(audio, 0, 180, () => {
        try {
            audio.pause();
            audio.currentTime = 0;
        } catch { /* ignore */ }
    });
}

function _playPhase(nextPhase, volume) {
    if (!_canUseAudio() || !TRACKS[nextPhase]) return;
    if (_phase === nextPhase && _current) {
        _fadeTo(_current, volume, 160);
        return;
    }
    _stopCurrent({ keepPhase: true });
    const audio = _makeAudio(nextPhase);
    if (!audio) return;
    _phase = nextPhase;
    _current = audio;
    audio.onended = () => {
        if (nextPhase === 'release') _stopCurrent();
    };
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
        p.catch(() => {
            if (_current === audio) _current = null;
            _phase = 'off';
        });
    }
    _fadeTo(audio, volume);
}

function _targetPhase({ score, pbBaseline, placements, gameOver }) {
    const base = Number(pbBaseline) || 0;
    const currentScore = Number(score) || 0;
    if (base < MIN_BASELINE || (Number(placements) || 0) < 3) return 'off';
    if (currentScore > base) return 'release';
    if (gameOver) return 'off';
    const pct = currentScore / base;
    if (pct >= 0.95) return 'sprint';
    if (pct >= 0.80) return 'near';
    return 'off';
}

export function updatePbChaseBgm({ score, pbBaseline, placements, gameOver = false, soundEnabled = true, volume = 0.55 } = {}) {
    if (!soundEnabled) {
        _stopCurrent();
        return;
    }
    const next = _targetPhase({ score, pbBaseline, placements, gameOver });
    if (next === 'off') {
        _stopCurrent();
        return;
    }
    const targetVolume = Math.max(0, Math.min(1, Number(volume) || 0.55)) * BASE_VOLUME;
    if (next === 'release') {
        if (_releasedThisRun) return;
        _releasedThisRun = true;
        _playPhase('release', Math.min(0.22, targetVolume * 1.15));
        return;
    }
    _playPhase(next, next === 'sprint' ? Math.min(0.20, targetVolume * 1.08) : Math.min(0.16, targetVolume));
}

export function resetPbChaseBgm() {
    _releasedThisRun = false;
    _stopCurrent();
}

export function stopPbChaseBgm() {
    _stopCurrent();
}

export const __test_only__ = {
    _targetPhase,
    TRACKS,
};
