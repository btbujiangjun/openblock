/**
 * PB chase BGM for WeChat Mini Program.
 *
 * Plays real bundled short WAV cue files through InnerAudioContext. The motif is global
 * to the game and does not follow skin audio themes.
 */

const TRACKS = {
  near: 'assets/audio/game/pb_chase/pb_near.wav',
  sprint: 'assets/audio/game/pb_chase/pb_sprint.wav',
  release: 'assets/audio/game/pb_chase/pb_release.wav',
};

const MIN_BASELINE = 200;
const BASE_VOLUME = 0.28;

let phase = 'off';
let audio = null;
let releasedThisRun = false;

function destroyAudio() {
  if (!audio) return;
  try { audio.stop(); } catch { /* ignore */ }
  try { audio.destroy(); } catch { /* ignore */ }
  audio = null;
}

function targetPhase({ score, pbBaseline, placements, gameOver }) {
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

function playPhase(nextPhase, volume) {
  if (typeof wx === 'undefined' || !wx.createInnerAudioContext || !TRACKS[nextPhase]) return;
  if (phase === nextPhase) {
    if (audio) audio.volume = volume;
    // Short cue semantics: announce a PB phase once on entry; do not loop/replay
    // while the game-loop remains in the same score band after the 3s cue ends.
    return;
  }
  destroyAudio();
  phase = nextPhase;
  audio = wx.createInnerAudioContext();
  audio.obeyMuteSwitch = false;
  audio.loop = false;
  audio.volume = volume;
  const currentAudio = audio;
  audio.onEnded(() => {
    if (nextPhase === 'release') {
      destroyAudio();
      phase = 'off';
    } else {
      try { currentAudio.destroy(); } catch { /* ignore */ }
      if (audio === currentAudio) audio = null;
    }
  });
  audio.onError((err) => {
    console.warn('[pbChaseBgm] play failed', nextPhase, err);
    destroyAudio();
    phase = 'off';
  });
  audio.src = TRACKS[nextPhase];
  try { audio.play(); } catch { /* ignore */ }
}

function updatePbChaseBgm({ score, pbBaseline, placements, gameOver = false, soundEnabled = true, volume = 0.55 } = {}) {
  if (!soundEnabled) {
    destroyAudio();
    phase = 'off';
    return;
  }
  const next = targetPhase({ score, pbBaseline, placements, gameOver });
  if (next === 'off') {
    destroyAudio();
    phase = 'off';
    return;
  }
  const targetVolume = Math.max(0, Math.min(1, Number(volume) || 0.55)) * BASE_VOLUME;
  if (next === 'release') {
    if (releasedThisRun) return;
    releasedThisRun = true;
    playPhase('release', Math.min(0.22, targetVolume * 1.15));
    return;
  }
  playPhase(next, next === 'sprint' ? Math.min(0.20, targetVolume * 1.08) : Math.min(0.16, targetVolume));
}

function resetPbChaseBgm() {
  releasedThisRun = false;
  destroyAudio();
  phase = 'off';
}

function stopPbChaseBgm() {
  destroyAudio();
  phase = 'off';
}

module.exports = {
  updatePbChaseBgm,
  resetPbChaseBgm,
  stopPbChaseBgm,
  __test_only__: { targetPhase, TRACKS },
};
