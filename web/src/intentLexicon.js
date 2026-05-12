/**
 * intentLexicon.js — spawnIntent 与运营文案的统一词典
 *
 * 落地 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT P2-4：
 *   局内 spawnIntent（relief / engage / pressure / flow / harvest / maintain）与
 *   召回推送、每日任务、CRM 弹窗等运营触达共用同一份语义词典；任何对单端文案的
 *   修改都应同时反映到对端，避免"系统说要救济、推送说要冲分"的矛盾叙事。
 *
 * 数据源：仓库根 shared/intent_lexicon.json（与 shared/game_rules.json 同等地位）。
 * 此模块仅做读访问 + 校验封装；运营/推送模块从这里取，不直接依赖 JSON 形状。
 *
 * 与 web/src/stressMeter.js `SPAWN_INTENT_NARRATIVE` 的关系：
 *   - in_game_narrative_zh 与 SPAWN_INTENT_NARRATIVE 默认值一致；
 *   - SPAWN_INTENT_NARRATIVE 仍由 stressMeter 拥有（含 flow / harvest 的高压守卫等
 *     场景化变体），lexicon 只承诺"默认 base 句子 + 出局触达句"。
 */
import lexicon from '../../shared/intent_lexicon.json';

export const SUPPORTED_INTENTS = Object.freeze(Object.keys(lexicon.intents || {}));

/**
 * 取一个 intent 的完整词条；未知 intent 返回 null（调用方需自行兜底）。
 */
export function getIntentEntry(intent) {
    if (!intent || typeof intent !== 'string') return null;
    const entry = lexicon.intents?.[intent];
    return entry ? { ...entry } : null;
}

/**
 * 取局内叙事文案。等价于 stressMeter.SPAWN_INTENT_NARRATIVE 的 base 项。
 *   locale 仅支持 'zh' / 'en'；当前 lexicon 优先 zh，未提供 en 时返回 zh。
 */
export function getInGameNarrative(intent, locale = 'zh') {
    const entry = getIntentEntry(intent);
    if (!entry) return '';
    if (locale === 'en' && entry.in_game_narrative_en) return entry.in_game_narrative_en;
    return entry.in_game_narrative_zh || '';
}

/**
 * 取出局推送文案（CRM / 通知中心使用）。
 */
export function getOutOfGamePush(intent, locale = 'zh') {
    const entry = getIntentEntry(intent);
    if (!entry) return '';
    if (locale === 'en' && entry.out_of_game_push_en) return entry.out_of_game_push_en;
    return entry.out_of_game_push_zh || '';
}

/**
 * 取出局任务文案（每日任务 / 周挑战等模块的标题）。
 */
export function getOutOfGameTaskCopy(intent, locale = 'zh') {
    const entry = getIntentEntry(intent);
    if (!entry) return '';
    if (locale === 'en' && entry.out_of_game_task_en) return entry.out_of_game_task_en;
    return entry.out_of_game_task_zh || '';
}

/**
 * 给定 stage / band，挑选最贴合的 intent。
 *   策略：优先匹配 preferred_stages 与 preferred_bands 同时命中的；其次仅 stage 命中；
 *   再次仅 band 命中；都无则返回 'maintain'。便于运营在没有局内信号时也能按运营标签
 *   推荐合适的触达 tone。
 */
export function suggestIntentForSegment({ stage, band } = {}) {
    if (!stage && !band) return 'maintain';
    let bestIntent = 'maintain';
    let bestScore = -1;
    for (const intent of SUPPORTED_INTENTS) {
        const entry = lexicon.intents[intent] || {};
        const stageHit = stage && Array.isArray(entry.preferred_stages) && entry.preferred_stages.includes(stage) ? 2 : 0;
        const bandHit = band && Array.isArray(entry.preferred_bands) && entry.preferred_bands.includes(band) ? 1 : 0;
        const score = stageHit + bandHit;
        if (score > bestScore) {
            bestScore = score;
            bestIntent = intent;
        }
    }
    return bestIntent;
}

/** 词典完整副本，仅供 dev panel / 测试快照使用。 */
export function getLexiconSnapshot() {
    return JSON.parse(JSON.stringify(lexicon));
}
