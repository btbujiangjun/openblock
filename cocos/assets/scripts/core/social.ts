/**
 * 社交进阶脚手架（Phase P2）：好友 / 异步 PK / 公会。
 *
 * 引擎无关。默认本地内存实现（可持久化），并定义 `SocialBackend` 接口，
 * 接入真实服务器（你的 API / 微信关系链）时注入即可，无需改业务层。
 * 重度实时玩法（多人对战）属服务器范畴，这里只给客户端契约与本地兜底。
 */

export interface FriendEntry {
    id: string;
    name: string;
    bestScore: number;
}

export interface PkChallenge {
    id: string;
    fromName: string;
    score: number;
    /** 我方应战分数（未应战为 null） */
    myScore: number | null;
}

export interface GuildInfo {
    id: string;
    name: string;
    members: number;
    myContribution: number;
}

/** 真实后端契约（可选注入）。 */
export interface SocialBackend {
    listFriends(): Promise<FriendEntry[]>;
    sendChallenge(score: number): Promise<void>;
    listChallenges(): Promise<PkChallenge[]>;
    answerChallenge(id: string, score: number): Promise<void>;
    guild(): Promise<GuildInfo | null>;
    joinGuild(id: string): Promise<boolean>;
    contribute(points: number): Promise<void>;
}

export class SocialState {
    friends: FriendEntry[] = [];
    challenges: PkChallenge[] = [];
    guild: GuildInfo | null = null;
    private backend: SocialBackend | null = null;

    useBackend(b: SocialBackend | null): void {
        this.backend = b;
    }

    // ---- 异步 PK ----
    async createChallenge(score: number): Promise<void> {
        if (this.backend) { await this.backend.sendChallenge(score); return; }
        // 本地兜底：造一个「影子对手」回合
        this.challenges.unshift({ id: `pk_${Date.now()}`, fromName: 'Rival', score: Math.round(score * (0.8 + Math.random() * 0.5)), myScore: null });
    }

    async refreshChallenges(): Promise<PkChallenge[]> {
        if (this.backend) { this.challenges = await this.backend.listChallenges(); }
        return this.challenges;
    }

    async answer(id: string, score: number): Promise<'win' | 'lose' | 'none'> {
        const c = this.challenges.find((x) => x.id === id);
        if (!c) return 'none';
        c.myScore = score;
        if (this.backend) await this.backend.answerChallenge(id, score);
        return score >= c.score ? 'win' : 'lose';
    }

    // ---- 好友 ----
    async refreshFriends(): Promise<FriendEntry[]> {
        if (this.backend) this.friends = await this.backend.listFriends();
        return this.friends;
    }

    // ---- 公会 ----
    async refreshGuild(): Promise<GuildInfo | null> {
        if (this.backend) this.guild = await this.backend.guild();
        return this.guild;
    }

    async contribute(points: number): Promise<void> {
        if (this.backend) { await this.backend.contribute(points); return; }
        if (this.guild) this.guild.myContribution += points;
    }

    toJSON(): object {
        return { friends: this.friends, challenges: this.challenges, guild: this.guild };
    }

    fromJSON(d: { friends?: FriendEntry[]; challenges?: PkChallenge[]; guild?: GuildInfo | null } | null): void {
        if (!d) return;
        this.friends = d.friends ?? [];
        this.challenges = d.challenges ?? [];
        this.guild = d.guild ?? null;
    }
}
