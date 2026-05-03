/**
 * 与 web/src/bot/rlCurriculum.js、rl_pytorch/game_rules.py 对齐。
 * 关闭课程：在 app.js 的 globalData 中设置 RL_CURRICULUM 为 0 / false / no / off（与网页 VITE_RL_CURRICULUM 语义一致）。
 */
const { GAME_RULES, WIN_SCORE_THRESHOLD } = require('../gameRules');

function _curriculumDisabledByEnv() {
    try {
        if (typeof getApp === 'function') {
            const app = getApp();
            const v = app && app.globalData && app.globalData.RL_CURRICULUM;
            if (v !== undefined && v !== null && v !== '') {
                const s = String(v).trim().toLowerCase();
                if (s === '0' || s === 'false' || s === 'no' || s === 'off') {
                    return true;
                }
            }
        }
    } catch (_) {
        /* getApp 未就绪或非小程序环境 */
    }
    return false;
}

function rlCurriculumEnabled() {
    if (_curriculumDisabledByEnv()) {
        return false;
    }
    return Boolean(GAME_RULES.rlCurriculum && GAME_RULES.rlCurriculum.enabled);
}

/**
 * @param {number} episode1Based 从 1 起的训练局序号
 * @returns {number}
 */
function rlWinThresholdForEpisode(episode1Based) {
    const endCfg = Number(GAME_RULES.winScoreThreshold != null ? GAME_RULES.winScoreThreshold : WIN_SCORE_THRESHOLD);
    if (!rlCurriculumEnabled()) {
        return Math.max(1, Math.round(endCfg));
    }
    const cur = GAME_RULES.rlCurriculum || {};
    const start = Number(cur.winThresholdStart != null ? cur.winThresholdStart : 120);
    const end = Number(cur.winThresholdEnd != null ? cur.winThresholdEnd : endCfg);
    const span = Math.max(1, Number(cur.rampEpisodes != null ? cur.rampEpisodes : 40000));
    const ep = Math.max(1, Math.floor(Number(episode1Based) || 1));
    const t = Math.min(1.0, Math.max(0, ep - 1) / span);
    const v = start + (end - start) * t;
    return Math.max(1, Math.round(v));
}

module.exports = { rlCurriculumEnabled, rlWinThresholdForEpisode };
