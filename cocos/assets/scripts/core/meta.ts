/**
 * 元系统（Phase 3，引擎无关）：每日签到 + 每日任务 + 赛季积分。
 * 时间通过 nowFn 注入便于测试；所有状态可序列化持久化。
 */

import type { Wallet, WalletKind } from './economy';

export type MissionId = 'lines' | 'places' | 'score';

/**
 * 签到奖励（严格对齐 web `checkin/checkInPanel.js` REWARDS）：token 礼包，第 7 天附 24h 随机试穿。
 */
export interface CheckInReward {
    items: Partial<Record<WalletKind, number>>;
    /** 第 7 天大奖：24h 限定皮肤随机试穿（对齐 web）。 */
    trialHours?: number;
}

export interface MissionState {
    id: MissionId;
    name: string;
    target: number;
    progress: number;
    reward: number;
    claimed: boolean;
}

interface MetaJSON {
    lastCheckinYmd?: string;
    streak?: number;
    missionsYmd?: string;
    missions?: MissionState[];
    seasonPoints?: number;
}

/** 7 日签到奖励表（token 礼包，循环封顶）——与 web REWARDS 逐条一致。 */
const CHECKIN_REWARDS: CheckInReward[] = [
    { items: { hintToken: 1 } },
    { items: { hintToken: 1, undoToken: 1 } },
    { items: { hintToken: 2 } },
    { items: { bombToken: 1 } },
    { items: { hintToken: 2, undoToken: 2 } },
    { items: { rainbowToken: 1 } },
    { items: { hintToken: 2, bombToken: 1, rainbowToken: 1 }, trialHours: 24 },
];

/** 第 7 天大奖随机试穿皮肤池（对齐 web TRIAL_SKIN_POOL）。 */
export const CHECKIN_TRIAL_POOL = ['forbidden', 'demon', 'fairy', 'aurora', 'industrial', 'mahjong', 'boardgame'];

/**
 * 把签到 token 礼包入账钱包（严格对齐 web `checkInPanel.js:_claim`）：
 *   · 各 token 走 `addBalance(kind, v, 'checkin-day-<day>')`——非豁免来源，计入每日发放上限（与 web 一致）；
 *   · trialHours：从 CHECKIN_TRIAL_POOL（限已拥有皮肤）随机取一个发限时试穿券。
 * @returns 实际发到的试穿皮肤 id（无则空串）。
 */
export function grantCheckinReward(wallet: Wallet, day: number, reward: CheckInReward, ownedSkinIds: string[]): string {
    const source = `checkin-day-${day}`;
    for (const [k, v] of Object.entries(reward.items)) {
        wallet.addBalance(k as WalletKind, v as number, source);
    }
    let trialSkin = '';
    if (reward.trialHours) {
        const pool = CHECKIN_TRIAL_POOL.filter((id) => ownedSkinIds.includes(id));
        if (pool.length) {
            trialSkin = pool[Math.floor(Math.random() * pool.length)];
            wallet.addTrial(trialSkin, reward.trialHours);
        }
    }
    return trialSkin;
}

function ymd(ts: number): string {
    const d = new Date(ts);
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
}

function defaultMissions(): MissionState[] {
    return [
        { id: 'lines', name: '消除 12 行', target: 12, progress: 0, reward: 20, claimed: false },
        { id: 'places', name: '放置 40 块', target: 40, progress: 0, reward: 15, claimed: false },
        { id: 'score', name: '单局得 600 分', target: 600, progress: 0, reward: 30, claimed: false },
    ];
}

export class MetaState {
    private nowFn: () => number;
    lastCheckinYmd = '';
    streak = 0;
    missionsYmd = '';
    missions: MissionState[] = defaultMissions();
    seasonPoints = 0;

    constructor(nowFn: () => number = () => Date.now()) {
        this.nowFn = nowFn;
        this.rolloverMissions();
    }

    /** 跨天则重置每日任务 */
    private rolloverMissions(): void {
        const today = ymd(this.nowFn());
        if (this.missionsYmd !== today) {
            this.missionsYmd = today;
            this.missions = defaultMissions();
        }
    }

    canCheckin(): boolean {
        return this.lastCheckinYmd !== ymd(this.nowFn());
    }

    /** 7 日签到奖励表（token 礼包，循环封顶）—— 供签到日历面板逐格展示。 */
    rewardSchedule(): CheckInReward[] {
        return CHECKIN_REWARDS.map((r) => ({ items: { ...r.items }, trialHours: r.trialHours }));
    }

    /**
     * 今日将落在签到周期的第几天（1..7，对齐 web checkInPanel `nextStreakDay`）：
     *   - 今日已签 → 当前 streak 在周期内的位置
     *   - 昨日签过 → 周期内下一天
     *   - 断签/首签 → 第 1 天
     */
    nextStreakDay(): number {
        const len = CHECKIN_REWARDS.length;
        const today = ymd(this.nowFn());
        const yesterday = ymd(this.nowFn() - 86400000);
        if (this.lastCheckinYmd === today) return ((this.streak - 1) % len + len) % len + 1;
        if (this.lastCheckinYmd === yesterday) return (this.streak % len) + 1;
        return 1;
    }

    /** 签到，返回 { day: 落在周期的第几天(1..7), reward: token 礼包 }；不可签到时返回 null。 */
    checkin(): { day: number; reward: CheckInReward } | null {
        const today = ymd(this.nowFn());
        if (this.lastCheckinYmd === today) return null;
        const yesterday = ymd(this.nowFn() - 86400000);
        this.streak = this.lastCheckinYmd === yesterday ? this.streak + 1 : 1;
        this.lastCheckinYmd = today;
        const idx = (this.streak - 1) % CHECKIN_REWARDS.length;
        return { day: idx + 1, reward: CHECKIN_REWARDS[idx] };
    }

    /** 接入游戏事件推进任务/赛季积分 */
    recordLines(n: number): void {
        this.rolloverMissions();
        this.bump('lines', n);
        this.seasonPoints += n * 5;
    }

    recordPlace(): void {
        this.rolloverMissions();
        this.bump('places', 1);
    }

    recordScore(total: number): void {
        this.rolloverMissions();
        const m = this.missions.find((x) => x.id === 'score');
        if (m && total > m.progress) m.progress = Math.min(total, m.target);
    }

    private bump(id: MissionId, delta: number): void {
        const m = this.missions.find((x) => x.id === id);
        if (m && !m.claimed) m.progress = Math.min(m.target, m.progress + delta);
    }

    isComplete(id: MissionId): boolean {
        const m = this.missions.find((x) => x.id === id);
        return !!m && m.progress >= m.target;
    }

    /** 领取任务奖励，返回金币（不可领时 0） */
    claimMission(id: MissionId): number {
        const m = this.missions.find((x) => x.id === id);
        if (!m || m.claimed || m.progress < m.target) return 0;
        m.claimed = true;
        return m.reward;
    }

    seasonLevel(): number {
        return Math.floor(this.seasonPoints / 100) + 1;
    }

    toJSON(): MetaJSON {
        return {
            lastCheckinYmd: this.lastCheckinYmd,
            streak: this.streak,
            missionsYmd: this.missionsYmd,
            missions: this.missions,
            seasonPoints: this.seasonPoints,
        };
    }

    fromJSON(data: MetaJSON | null): void {
        if (!data) return;
        this.lastCheckinYmd = data.lastCheckinYmd ?? '';
        this.streak = data.streak ?? 0;
        this.missionsYmd = data.missionsYmd ?? '';
        this.missions = Array.isArray(data.missions) ? data.missions : defaultMissions();
        this.seasonPoints = data.seasonPoints ?? 0;
        this.rolloverMissions();
    }
}
