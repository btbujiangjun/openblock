/**
 * 虚拟伙伴 / 角色养成（Phase P2 —— web `companion/companionStub.js` 的完整化移植）。
 *
 * web 端为 stub（仅 icon/名字元数据 + 养成 TODO）。此处补齐一个可运行的轻量养成模型：
 * 每款皮肤有专属伙伴；全局一只伙伴随当前皮肤切换外观，靠「消行 / 完成对局 / 每日喂食」积累
 * 亲密度 XP 并升级（Lv.1→5）。纯逻辑、不依赖引擎与 DOM，可被 web/小程序复用。
 */

export interface CompanionMeta {
    icon: string;
    name: string;
}

/** 各皮肤专属伙伴（icon/名字与 web companionStub.COMPANIONS 对齐，并补全到 cocos 皮肤集）。 */
const COMPANIONS: Record<string, CompanionMeta> = {
    classic: { icon: '⬛', name: '小方' },
    titanium: { icon: '🔩', name: '钛粒' },
    neonCity: { icon: '🌃', name: 'Cyb-3' },
    aurora: { icon: '🌈', name: '极光' },
    ocean: { icon: '🐋', name: '大蓝' },
    sunset: { icon: '🌅', name: '余晖' },
    sakura: { icon: '🌸', name: '小樱' },
    koi: { icon: '🐟', name: '锦鲤' },
    candy: { icon: '🍬', name: '糖糖' },
    bubbly: { icon: '🫧', name: '泡泡' },
    toon: { icon: '🎠', name: '叮当' },
    pixel8: { icon: '👾', name: '像素怪' },
    dawn: { icon: '🌻', name: '向阳' },
    pets: { icon: '🐶', name: '阿黄' },
    universe: { icon: '🌌', name: '星辰' },
    fantasy: { icon: '🧝', name: '艾莉' },
    fairy: { icon: '✨', name: '萤' },
    music: { icon: '🎵', name: '音符' },
    beast: { icon: '🦁', name: '狮王' },
    greece: { icon: '🦉', name: '雅典娜' },
    demon: { icon: '😈', name: '小恶' },
    jurassic: { icon: '🦖', name: '霸王' },
    industrial: { icon: '⚙️', name: '齿轮' },
    forbidden: { icon: '🐲', name: '龙影' },
    mahjong: { icon: '🀄', name: '中神' },
    boardgame: { icon: '🃏', name: '小丑' },
    sports: { icon: '⚽', name: '球球' },
    outdoor: { icon: '⛺', name: '阿营' },
    vehicles: { icon: '🏎️', name: '飞驰' },
    forest: { icon: '🦌', name: '小鹿' },
    pirate: { icon: '🦜', name: '鹦鹉' },
    farm: { icon: '🐄', name: '小牛' },
    desert: { icon: '🐫', name: '骆驼' },
    food: { icon: '🍕', name: '披萨君' },
    summer: { icon: '🍉', name: '西瓜' },
    apple: { icon: '🍎', name: '果子' },
    cafe: { icon: '☕', name: '拿铁' },
    fiesta: { icon: '🎉', name: '嘉年' },
};

/** 取某皮肤的伙伴；未配置时回退到通用占位。 */
export function getCompanion(skinId: string): CompanionMeta {
    return COMPANIONS[skinId] || { icon: '🐾', name: '伙伴' };
}

export function listCompanions(): Record<string, CompanionMeta> {
    return COMPANIONS;
}

/** 各等级累计 XP 阈值（Lv.1..5）。 */
const LEVEL_XP = [0, 50, 150, 350, 700];
/** 每日喂食获得的亲密度。 */
const FEED_XP = 20;

/** 伙伴养成状态（全局一只，外观随当前皮肤）。 */
export class CompanionState {
    xp = 0;
    /** 上次喂食日期（YYYY-MM-DD），用于每日一次门控。 */
    lastFed = '';

    /** 当前等级（1..5）。 */
    level(): number {
        let lv = 1;
        for (let i = 0; i < LEVEL_XP.length; i++) {
            if (this.xp >= LEVEL_XP[i]) lv = i + 1;
        }
        return lv;
    }

    /** 升到下一级还需的 XP（满级返回 0）。 */
    xpToNext(): number {
        const lv = this.level();
        if (lv >= LEVEL_XP.length) return 0;
        return Math.max(0, LEVEL_XP[lv] - this.xp);
    }

    /** 当前级进度（0..1，满级为 1）。 */
    progress(): number {
        const lv = this.level();
        if (lv >= LEVEL_XP.length) return 1;
        const base = LEVEL_XP[lv - 1];
        const span = LEVEL_XP[lv] - base;
        return span <= 0 ? 1 : Math.min(1, (this.xp - base) / span);
    }

    /** 增加亲密度，返回是否升级。 */
    addXp(n: number): boolean {
        if (n <= 0) return false;
        const before = this.level();
        this.xp += n;
        return this.level() > before;
    }

    /** 今天是否可喂食。 */
    canFeed(today: string): boolean {
        return this.lastFed !== today;
    }

    /** 喂食（每日一次）：成功返回获得的 XP，否则 0。 */
    feed(today: string): number {
        if (!this.canFeed(today)) return 0;
        this.lastFed = today;
        this.xp += FEED_XP;
        return FEED_XP;
    }

    toJSON(): { xp: number; lastFed: string } {
        return { xp: this.xp, lastFed: this.lastFed };
    }

    fromJSON(o: { xp?: number; lastFed?: string } | null): void {
        if (!o) return;
        this.xp = Math.max(0, o.xp ?? 0);
        this.lastFed = o.lastFed ?? '';
    }
}
