/**
 * 元系统（Phase 3，引擎无关）：每日签到 + 每日任务 + 赛季积分。
 * 时间通过 nowFn 注入便于测试；所有状态可序列化持久化。
 */

export type MissionId = 'lines' | 'places' | 'score';

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

const CHECKIN_REWARDS = [10, 12, 15, 18, 22, 26, 40]; // streak 1..7（封顶循环）

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

    /** 签到，返回获得的金币（不可签到时返回 0） */
    checkin(): number {
        const today = ymd(this.nowFn());
        if (this.lastCheckinYmd === today) return 0;
        const yesterday = ymd(this.nowFn() - 86400000);
        this.streak = this.lastCheckinYmd === yesterday ? this.streak + 1 : 1;
        this.lastCheckinYmd = today;
        const idx = (this.streak - 1) % CHECKIN_REWARDS.length;
        return CHECKIN_REWARDS[idx];
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
