/**
 * lifecyclePlaybook.js — 阶段 × 成熟度策略矩阵
 *
 * 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P1-1：把 5×5 = 25 格运营动作集中到一个
 * 配置化矩阵；personalization / pushNotificationSystem / dailyTasks 等模块从这里
 * 取默认动作，避免分散硬编码导致策略漂移。
 *
 *   - 行：S0 / S1 / S2 / S3 / S4（onboarding / exploration / growth / stability / winback）
 *   - 列：M0 / M1 / M2 / M3 / M4
 *   - 每格：actions[]，由 actionId + tone + intent 组成；intent 与 intentLexicon 同源
 *
 * 蓝图允许最多 15 格留空（继承 defaultActions）；本文件确保 ≥ 10 格非空，并提供
 * `resolveActions(stage, band)` 供调用方统一查询。
 */
import { suggestIntentForSegment } from '../intentLexicon.js';

const STAGE_ALIASES = {
    onboarding: 'S0',
    exploration: 'S1',
    growth: 'S2',
    stability: 'S3',
    veteran: 'S3',
    winback: 'S4',
};

const BAND_ALIASES = { L1: 'M0', L2: 'M1', L3: 'M2', L4: 'M3' };

/**
 * 默认动作集；所有未在矩阵中显式声明的格子都从这里继承。
 * 字段：
 *   - id：动作 ID（与现有模块的 actionId / interventionType 对齐）
 *   - tone：在 intentLexicon 中的语气分类
 *   - intent：与 spawnIntent 同义；用于 push/任务文案选择
 */
const DEFAULT_ACTIONS = [
    { id: 'daily_task_default', tone: 'neutral', intent: 'maintain' },
];

const PLAYBOOK = {
    S0: {
        M0: [
            { id: 'ftue_minimum_friction', tone: 'supportive', intent: 'relief' },
            { id: 'first_clear_guarantee', tone: 'supportive', intent: 'engage' },
        ],
    },
    S1: {
        M0: [
            { id: 'bottleneck_prompt', tone: 'supportive', intent: 'relief' },
            { id: 'task_safety_net', tone: 'neutral', intent: 'maintain' },
        ],
        M1: [
            { id: 'task_density_plus_one', tone: 'inviting', intent: 'engage' },
            { id: 'light_challenge', tone: 'challenge', intent: 'pressure' },
        ],
        M2: [
            { id: 'weekly_loop_seeding', tone: 'rewarding', intent: 'harvest' },
        ],
    },
    S2: {
        M0: [
            { id: 'friendly_spawn', tone: 'supportive', intent: 'relief' },
            { id: 'first_purchase_warmup', tone: 'inviting', intent: 'engage' },
        ],
        M1: [
            { id: 'weekly_challenge_main', tone: 'inviting', intent: 'engage' },
            { id: 'first_purchase_pack', tone: 'rewarding', intent: 'harvest' },
        ],
        M2: [
            { id: 'weekly_challenge_main', tone: 'inviting', intent: 'engage' },
            { id: 'time_bound_challenge', tone: 'challenge', intent: 'pressure' },
            { id: 'tier_offer_default', tone: 'rewarding', intent: 'harvest' },
        ],
        M3: [
            { id: 'season_target', tone: 'challenge', intent: 'pressure' },
            { id: 'leaderboard_push', tone: 'challenge', intent: 'pressure' },
        ],
    },
    S3: {
        M1: [
            { id: 'maturity_milestone_promotion', tone: 'inviting', intent: 'engage' },
        ],
        M2: [
            { id: 'season_target', tone: 'challenge', intent: 'pressure' },
            { id: 'tier_offer_upgrade', tone: 'rewarding', intent: 'harvest' },
        ],
        M3: [
            { id: 'leaderboard_push', tone: 'challenge', intent: 'pressure' },
            { id: 'community_invite', tone: 'inviting', intent: 'engage' },
        ],
        M4: [
            { id: 'vip_perks', tone: 'rewarding', intent: 'harvest' },
        ],
    },
    S4: {
        M0: [
            { id: 'winback_protected_session', tone: 'supportive', intent: 'relief' },
            { id: 'high_value_small_reward', tone: 'rewarding', intent: 'harvest' },
        ],
        M1: [
            { id: 'winback_protected_session', tone: 'supportive', intent: 'relief' },
            { id: 'first_purchase_recall', tone: 'inviting', intent: 'engage' },
        ],
        M2: [
            { id: 'winback_challenge', tone: 'challenge', intent: 'pressure' },
            { id: 'tier_offer_recall', tone: 'rewarding', intent: 'harvest' },
        ],
        M3: [
            { id: 'winback_challenge', tone: 'challenge', intent: 'pressure' },
            { id: 'season_reset', tone: 'inviting', intent: 'engage' },
        ],
        M4: [
            { id: 'vip_recall_pack', tone: 'rewarding', intent: 'harvest' },
        ],
    },
};

function _normalize(stageOrAlias) {
    if (!stageOrAlias) return null;
    if (STAGE_ALIASES[stageOrAlias]) return STAGE_ALIASES[stageOrAlias];
    return /^S[0-4]$/.test(stageOrAlias) ? stageOrAlias : null;
}

function _normalizeBand(band) {
    if (!band) return null;
    if (BAND_ALIASES[band]) return BAND_ALIASES[band];
    return /^M[0-4]$/.test(band) ? band : null;
}

/**
 * 取某个 (stage, band) 的动作列表。
 *   - 未声明的格子继承 DEFAULT_ACTIONS。
 *   - 每个动作附加由 intent 推荐出的 fallback intent，便于 UI 直接使用。
 */
export function resolveActions(stage, band) {
    const s = _normalize(stage);
    const b = _normalizeBand(band);
    const fromMatrix = (s && b && PLAYBOOK[s]?.[b]) || null;
    const actions = fromMatrix ? [...fromMatrix] : [...DEFAULT_ACTIONS];
    /* 任何动作如果省略 intent，按 stage/band 在 lexicon 中找最优 intent。 */
    const fallback = suggestIntentForSegment({ stage: s || 'S2', band: b || 'M2' });
    return actions.map((action) => ({
        ...action,
        intent: action.intent || fallback,
    }));
}

/** 矩阵覆盖率：用于 CI / dev 面板检查"非空格 ≥ 10"。 */
export function getCoverage() {
    let nonEmpty = 0;
    const cells = [];
    for (const stage of ['S0', 'S1', 'S2', 'S3', 'S4']) {
        for (const band of ['M0', 'M1', 'M2', 'M3', 'M4']) {
            const cell = PLAYBOOK[stage]?.[band];
            if (Array.isArray(cell) && cell.length > 0) {
                nonEmpty++;
                cells.push({ stage, band, count: cell.length });
            }
        }
    }
    return { totalCells: 25, nonEmpty, cells };
}

export { PLAYBOOK as _PLAYBOOK_FOR_TEST, DEFAULT_ACTIONS as _DEFAULT_ACTIONS_FOR_TEST };
