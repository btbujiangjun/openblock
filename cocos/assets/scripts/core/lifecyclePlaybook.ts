/**
 * lifecyclePlaybook.ts — 阶段 × 成熟度策略矩阵（移植 web `retention/lifecyclePlaybook.js` + `intentLexicon.js`）。
 *
 * 把 5×5=25 格运营动作集中到一个配置化矩阵：行=阶段 S0..S4（onboarding/exploration/growth/stability/winback），
 * 列=成熟度 M0..M4。每格 actions[] 由 {id, tone, intent} 组成；未声明的格继承 DEFAULT_ACTIONS。
 * 调用方（提示语气 / 每日任务密度）统一经 `resolveActions(stage, band)` 查询。
 *
 * intentLexicon 内联自 `shared/intent_lexicon.json`（7 个 intent，含 tone / 偏好阶段/band / 局内叙事），
 * 让局内出块意图与运营触达文案共用同一语义，避免叙事矛盾。zh/en 叙事按当前 locale 选取。
 *
 * 引擎无关：除 i18n 的 getLocale 外不依赖运行时；可被 core 任意模块与 game 层消费。
 */
import { getLocale } from './i18n';

export type Stage = 'S0' | 'S1' | 'S2' | 'S3' | 'S4';
export type Band = 'M0' | 'M1' | 'M2' | 'M3' | 'M4';
export type Tone = 'supportive' | 'inviting' | 'challenge' | 'steady' | 'rising' | 'rewarding' | 'neutral';
export type Intent = 'relief' | 'engage' | 'pressure' | 'flow' | 'sprint' | 'harvest' | 'maintain';

export interface PlaybookAction { id: string; tone: Tone; intent: Intent }

const STAGE_ALIASES: Record<string, Stage> = {
    onboarding: 'S0',
    exploration: 'S1',
    growth: 'S2',
    stability: 'S3',
    veteran: 'S3',
    winback: 'S4',
};

const BAND_ALIASES: Record<string, Band> = { L1: 'M0', L2: 'M1', L3: 'M2', L4: 'M3' };

/** 默认动作集；所有未在矩阵中显式声明的格子都继承这里。 */
const DEFAULT_ACTIONS: PlaybookAction[] = [
    { id: 'daily_task_default', tone: 'neutral', intent: 'maintain' },
];

/** 5×5 矩阵（与 web PLAYBOOK 严格同构，≥10 格非空）。 */
const PLAYBOOK: Partial<Record<Stage, Partial<Record<Band, PlaybookAction[]>>>> = {
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

interface IntentEntry {
    labelZh: string;
    narrativeZh: string;
    narrativeEn: string;
    tone: Tone;
    preferredStages: Stage[];
    preferredBands: Band[];
}

/** 内联自 shared/intent_lexicon.json（局内叙事 base 句；缺 en 时退回 zh 的英文化近似）。 */
const INTENT_LEXICON: Record<Intent, IntentEntry> = {
    relief: {
        labelZh: '救济', tone: 'supportive', preferredStages: ['S0', 'S1', 'S4'], preferredBands: ['M0', 'M1'],
        narrativeZh: '盘面通透又是兑现窗口，悄悄给你减压享受多消。',
        narrativeEn: 'Board is open — quietly easing pressure so you can enjoy big clears.',
    },
    engage: {
        labelZh: '召回', tone: 'inviting', preferredStages: ['S2', 'S3', 'S4'], preferredBands: ['M1', 'M2'],
        narrativeZh: '给你一个明显得分目标 + 友好开局，找回流畅手感。',
        narrativeEn: 'Here is a clear scoring goal and a friendly opening to get back in flow.',
    },
    pressure: {
        labelZh: '加压', tone: 'challenge', preferredStages: ['S2', 'S3'], preferredBands: ['M2', 'M3', 'M4'],
        narrativeZh: '正在挑战自我！系统略加压让收尾更有仪式感。',
        narrativeEn: 'You are pushing yourself — a touch more pressure for a grand finish.',
    },
    flow: {
        labelZh: '心流', tone: 'steady', preferredStages: ['S1', 'S2', 'S3'], preferredBands: ['M1', 'M2', 'M3'],
        narrativeZh: '心流稳定，系统继续维持流畅的出块节奏。',
        narrativeEn: 'Flow is steady — keeping the piece cadence smooth.',
    },
    sprint: {
        labelZh: '冲刺', tone: 'rising', preferredStages: ['S2', 'S3'], preferredBands: ['M2', 'M3'],
        narrativeZh: '节奏渐紧，逐步收束的过渡阶段。',
        narrativeEn: 'Pace tightening, gradual ramp into the contested zone.',
    },
    harvest: {
        labelZh: '兑现', tone: 'rewarding', preferredStages: ['S2', 'S3'], preferredBands: ['M2', 'M3', 'M4'],
        narrativeZh: '识别到密集消行机会，正在投放促清的形状。',
        narrativeEn: 'Dense clear chances detected — feeding shapes that help you cash in.',
    },
    maintain: {
        labelZh: '维持', tone: 'neutral', preferredStages: ['S1', 'S2'], preferredBands: ['M1', 'M2'],
        narrativeZh: '看起来比较轻松，悄悄加点料维持新鲜感。',
        narrativeEn: 'Looking comfortable — adding a little spice to keep it fresh.',
    },
};

const SUPPORTED_INTENTS = Object.keys(INTENT_LEXICON) as Intent[];

function normalizeStage(s?: string | null): Stage | null {
    if (!s) return null;
    if (STAGE_ALIASES[s]) return STAGE_ALIASES[s];
    return /^S[0-4]$/.test(s) ? (s as Stage) : null;
}

function normalizeBand(b?: string | null): Band | null {
    if (!b) return null;
    if (BAND_ALIASES[b]) return BAND_ALIASES[b];
    return /^M[0-4]$/.test(b) ? (b as Band) : null;
}

/**
 * 给定 stage / band 挑选最贴合的 intent（移植 suggestIntentForSegment）：
 * 优先 stage(权重2)+band(权重1) 同时命中；都无则 'maintain'。
 */
export function suggestIntentForSegment(stage?: string | null, band?: string | null): Intent {
    if (!stage && !band) return 'maintain';
    let best: Intent = 'maintain';
    let bestScore = -1;
    for (const intent of SUPPORTED_INTENTS) {
        const e = INTENT_LEXICON[intent];
        const stageHit = stage && e.preferredStages.includes(stage as Stage) ? 2 : 0;
        const bandHit = band && e.preferredBands.includes(band as Band) ? 1 : 0;
        const score = stageHit + bandHit;
        if (score > bestScore) { bestScore = score; best = intent; }
    }
    return best;
}

/**
 * 取某 (stage, band) 的动作列表。未声明的格继承 DEFAULT_ACTIONS；
 * 每个动作若省略 intent，按 stage/band 在 lexicon 中找 fallback。
 */
export function resolveActions(stage?: string | null, band?: string | null): PlaybookAction[] {
    const s = normalizeStage(stage);
    const b = normalizeBand(band);
    const fromMatrix = (s && b && PLAYBOOK[s]?.[b]) || null;
    const actions = fromMatrix ? [...fromMatrix] : [...DEFAULT_ACTIONS];
    const fallback = suggestIntentForSegment(s || 'S2', b || 'M2');
    return actions.map((a) => ({ ...a, intent: a.intent || fallback }));
}

/** 该 (stage, band) 的主导 intent（首动作）。 */
export function primaryIntent(stage?: string | null, band?: string | null): Intent {
    return resolveActions(stage, band)[0].intent;
}

/** 该 (stage, band) 的主导语气 tone（首动作）。 */
export function toneFor(stage?: string | null, band?: string | null): Tone {
    return resolveActions(stage, band)[0].tone;
}

/** 取 intent 的局内叙事文案，按当前 locale 选 zh/en。 */
export function intentNarrative(intent: Intent): string {
    const e = INTENT_LEXICON[intent];
    if (!e) return '';
    return getLocale().startsWith('zh') ? e.narrativeZh : e.narrativeEn;
}

/**
 * 任务密度加成 0..2（驱动每日 dish 目标/奖励缩放）：
 * 矩阵里含 density 标记动作 +1；含挑战/兑现意图（pressure/harvest/challenge id）+1。
 * 即越成熟/越挑战的格子，给越密集的每日目标。
 */
export function taskDensityBonus(stage?: string | null, band?: string | null): number {
    let bonus = 0;
    for (const a of resolveActions(stage, band)) {
        if (/density/.test(a.id)) bonus += 1;
        if (a.intent === 'pressure' || a.intent === 'harvest' || /challenge/.test(a.id)) bonus += 1;
    }
    return Math.min(2, bonus);
}

/** 矩阵覆盖率（dev/CI：检查非空格 ≥ 10）。 */
export function getCoverage(): { totalCells: number; nonEmpty: number } {
    let nonEmpty = 0;
    for (const stage of ['S0', 'S1', 'S2', 'S3', 'S4'] as Stage[]) {
        for (const band of ['M0', 'M1', 'M2', 'M3', 'M4'] as Band[]) {
            const cell = PLAYBOOK[stage]?.[band];
            if (Array.isArray(cell) && cell.length > 0) nonEmpty++;
        }
    }
    return { totalCells: 25, nonEmpty };
}
