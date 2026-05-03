/**
 * 与 rl_pytorch/game_rules.py 中 rl_curriculum_enabled / rl_win_threshold_for_episode 对齐，
 * 供浏览器自博弈按局数设置胜局分数门槛。
 */
import { GAME_RULES, WIN_SCORE_THRESHOLD } from '../gameRules.js';

function _envCurriculumOff() {
  try {
    const v = import.meta.env?.VITE_RL_CURRICULUM;
    if (v === undefined || v === null || v === '') {
      return false;
    }
    return String(v).trim().toLowerCase() === '0'
      || String(v).trim().toLowerCase() === 'false'
      || String(v).trim().toLowerCase() === 'no'
      || String(v).trim().toLowerCase() === 'off';
  } catch {
    return false;
  }
}

/** 与 Python：环境变量关闭优先于 JSON enabled */
export function rlCurriculumEnabled() {
  if (_envCurriculumOff()) {
    return false;
  }
  return Boolean(GAME_RULES.rlCurriculum?.enabled);
}

/**
 * @param {number} episode1Based 从 1 起的训练局序号（与 collect_episode 的 global_ep+1 一致）
 * @returns {number} 当前局「计胜」分数门槛
 */
export function rlWinThresholdForEpisode(episode1Based) {
  const endCfg = Number(GAME_RULES.winScoreThreshold ?? WIN_SCORE_THRESHOLD);
  if (!rlCurriculumEnabled()) {
    return Math.max(1, Math.round(endCfg));
  }
  const cur = GAME_RULES.rlCurriculum || {};
  const start = Number(cur.winThresholdStart ?? 120);
  const end = Number(cur.winThresholdEnd ?? endCfg);
  const span = Math.max(1, Number(cur.rampEpisodes ?? 40000));
  const ep = Math.max(1, Math.floor(Number(episode1Based) || 1));
  const t = Math.min(1.0, Math.max(0, ep - 1) / span);
  const v = start + (end - start) * t;
  return Math.max(1, Math.round(v));
}
