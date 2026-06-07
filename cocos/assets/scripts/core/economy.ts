/**
 * 钱包/虚拟货币（引擎无关）。严格对齐 web `skills/wallet.js`：
 *   · 多通货库存：hint/undo/bomb/rainbow/freeze/preview/reroll token + coin + trialPass + fragment
 *   · 每日免费配额（hint/undo 每天免费 3 次，日切自动复活）
 *   · 每日发放上限（防通胀），但宝箱/IAP 等里程碑来源走 GRANT_BYPASS_SOURCES 豁免
 *   · 消耗优先扣每日免费额度再扣库存
 *   · 皮肤试穿券（限时）
 *
 * 持久化：toJSON/fromJSON 由调用方（GameModel 存档）负责；兼容旧版仅 `{coins}` 的存档。
 */

export type WalletKind =
    | 'hintToken' | 'undoToken' | 'bombToken' | 'rainbowToken'
    | 'freezeToken' | 'previewToken' | 'rerollToken'
    | 'coin' | 'trialPass' | 'fragment';

export const WALLET_KINDS: WalletKind[] = [
    'hintToken', 'undoToken', 'bombToken', 'rainbowToken',
    'freezeToken', 'previewToken', 'rerollToken',
    'coin', 'trialPass', 'fragment',
];

/** 每日免费配额（对齐 web DAILY_FREE_QUOTA）。 */
const DAILY_FREE_QUOTA: Partial<Record<WalletKind, number>> = {
    hintToken: 3,
    undoToken: 3,
};

/** 每日发放上限（对齐 web DAILY_GRANT_CAP）防通胀；trialPass 不限。 */
const DAILY_GRANT_CAP: Partial<Record<WalletKind, number>> = {
    hintToken: 8, undoToken: 6, bombToken: 3, rainbowToken: 2,
    freezeToken: 2, previewToken: 4, rerollToken: 3, coin: 500, fragment: 5,
};

/** 绕过每日上限的来源（里程碑/付费，对齐 web GRANT_BYPASS_SOURCES）。 */
const GRANT_BYPASS_SOURCES = new Set<string>([
    'iap',
    'chest-common', 'chest-rare', 'chest-epic',
    'season-chest-common', 'season-chest-rare', 'season-chest-epic', 'season-chest-legend',
    'first-day-pack', 'admin', 'test',
    // 注：lucky-wheel-* 不在豁免内（与 web 一致）——转盘 token 计入每日发放上限。
]);

function ymd(d = new Date()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export interface Trial { skinId: string; expiresAt: number; }

/** 金币便捷监听（向后兼容现有 coins HUD / 事件链）。 */
export type WalletListener = (coins: number, delta: number) => void;

export interface WalletChangeDetail {
    kind: WalletKind;
    amount: number;
    action: 'add' | 'spend';
    source?: string;
    cappedFrom?: number;
}
/** 任意通货变更监听（SkillBar 余额徽章用）。 */
export type WalletChangeListener = (detail: WalletChangeDetail) => void;

interface WalletJSON {
    balance?: Partial<Record<WalletKind, number>>;
    dailyConsumed?: Record<string, Partial<Record<WalletKind, number>>>;
    dailyGranted?: Record<string, Partial<Record<WalletKind, number>>>;
    trials?: Trial[];
    coins?: number; // 旧版兼容
}

export class Wallet {
    private balance: Record<WalletKind, number>;
    private dailyConsumed: Record<string, Partial<Record<WalletKind, number>>> = {};
    private dailyGranted: Record<string, Partial<Record<WalletKind, number>>> = {};
    private trials: Trial[] = [];
    private coinListeners: WalletListener[] = [];
    private changeListeners: WalletChangeListener[] = [];

    constructor(initial = 0) {
        this.balance = {} as Record<WalletKind, number>;
        for (const k of WALLET_KINDS) this.balance[k] = 0;
        this.balance.coin = Math.max(0, Math.floor(initial));
    }

    /* ============ 金币便捷 API（向后兼容） ============ */

    get coins(): number {
        return this.balance.coin;
    }

    onChange(fn: WalletListener): () => void {
        this.coinListeners.push(fn);
        return () => {
            const i = this.coinListeners.indexOf(fn);
            if (i >= 0) this.coinListeners.splice(i, 1);
        };
    }

    canAfford(n: number): boolean {
        return this.balance.coin >= n;
    }

    /** 玩法收入（消行/成就/转盘/宝箱金币）。不计入每日发放上限。 */
    earn(n: number): void {
        const amt = Math.floor(n);
        if (amt <= 0) return;
        this.balance.coin += amt;
        this.emitCoin(amt);
        this.emitChange({ kind: 'coin', amount: amt, action: 'add', source: 'gameplay' });
    }

    /** 金币消费（复活等）。 */
    spend(n: number): boolean {
        const cost = Math.floor(n);
        if (cost <= 0) return true;
        if (this.balance.coin < cost) return false;
        this.balance.coin -= cost;
        this.emitCoin(-cost);
        this.emitChange({ kind: 'coin', amount: cost, action: 'spend', source: 'spend' });
        return true;
    }

    /* ============ 通用通货 API（对齐 web） ============ */

    /** 仅库存（不含每日免费）。 */
    getStock(kind: WalletKind): number {
        return this.balance[kind] | 0;
    }

    /** 当日剩余免费配额。 */
    getDailyFreeRemaining(kind: WalletKind): number {
        const quota = DAILY_FREE_QUOTA[kind] || 0;
        if (quota <= 0) return 0;
        const consumed = this.dailyConsumed[ymd()]?.[kind] ?? 0;
        return Math.max(0, quota - consumed);
    }

    /** 当前可用余额：库存 + 当日剩余免费配额。 */
    getBalance(kind: WalletKind): number {
        return this.getStock(kind) + this.getDailyFreeRemaining(kind);
    }

    /**
     * 发放（宝箱/任务/广告/IAP）。除豁免来源外，单 kind 单日累加受 DAILY_GRANT_CAP 截断。
     * @returns 实际入账数量（可能因上限小于请求值）。
     */
    addBalance(kind: WalletKind, amount: number, source = 'unknown'): number {
        if (!WALLET_KINDS.includes(kind)) return 0;
        let toAdd = Math.floor(amount);
        if (toAdd <= 0) return 0;
        if (!GRANT_BYPASS_SOURCES.has(source)) {
            const cap = DAILY_GRANT_CAP[kind];
            if (cap !== undefined) {
                const day = ymd();
                const dg = this.dailyGranted[day] ?? (this.dailyGranted[day] = {});
                const granted = dg[kind] ?? 0;
                const room = Math.max(0, cap - granted);
                if (toAdd > room) toAdd = room;
                dg[kind] = granted + toAdd;
            }
        }
        if (toAdd <= 0) {
            // 完全被截断：仍 emit 让 UI 可提示「已达每日上限」。
            this.emitChange({ kind, amount: 0, action: 'add', source, cappedFrom: Math.floor(amount) });
            return 0;
        }
        this.balance[kind] = Math.max(0, (this.balance[kind] | 0) + toAdd);
        this.gcDaily(this.dailyGranted);
        if (kind === 'coin') this.emitCoin(toAdd);
        this.emitChange({
            kind, amount: toAdd, action: 'add', source,
            cappedFrom: Math.floor(amount) > toAdd ? Math.floor(amount) : undefined,
        });
        return toAdd;
    }

    /**
     * 消耗（优先扣每日免费配额，再扣库存）。对齐 web spend。
     * @returns 是否成功（余额不足返回 false）。
     */
    spendKind(kind: WalletKind, amount = 1, reason = 'unknown'): boolean {
        if (!WALLET_KINDS.includes(kind) || amount <= 0) return false;
        if (this.getBalance(kind) < amount) return false;
        let remaining = amount;
        const freeLeft = this.getDailyFreeRemaining(kind);
        if (freeLeft > 0) {
            const useFree = Math.min(freeLeft, remaining);
            const day = ymd();
            const dc = this.dailyConsumed[day] ?? (this.dailyConsumed[day] = {});
            dc[kind] = (dc[kind] ?? 0) + useFree;
            remaining -= useFree;
        }
        if (remaining > 0) this.balance[kind] = (this.balance[kind] | 0) - remaining;
        this.gcDaily(this.dailyConsumed);
        if (kind === 'coin') this.emitCoin(-amount);
        this.emitChange({ kind, amount, action: 'spend', source: reason });
        return true;
    }

    /* ============ 试穿券 ============ */

    addTrial(skinId: string, hours = 24): number {
        const expiresAt = Date.now() + hours * 3600_000;
        this.trials.push({ skinId, expiresAt });
        this.emitChange({ kind: 'trialPass', amount: 1, action: 'add', source: `trial-${skinId}` });
        return expiresAt;
    }

    isOnTrial(skinId: string): boolean {
        this.purgeExpiredTrials();
        return this.trials.some((t) => t.skinId === skinId);
    }

    getActiveTrials(): Trial[] {
        this.purgeExpiredTrials();
        return this.trials.slice();
    }

    /* ============ 事件 ============ */

    /** 任意通货变更监听（含 token / 金币 / 试穿）。 */
    onAnyChange(fn: WalletChangeListener): () => void {
        this.changeListeners.push(fn);
        return () => {
            const i = this.changeListeners.indexOf(fn);
            if (i >= 0) this.changeListeners.splice(i, 1);
        };
    }

    private emitCoin(delta: number): void {
        for (const fn of this.coinListeners) fn(this.balance.coin, delta);
    }

    private emitChange(detail: WalletChangeDetail): void {
        for (const fn of this.changeListeners) fn(detail);
    }

    /* ============ 内部 ============ */

    private purgeExpiredTrials(): void {
        const now = Date.now();
        this.trials = this.trials.filter((t) => t.expiresAt > now);
    }

    /** 仅保留最近 7 天的每日计数，防止存档无限膨胀。 */
    private gcDaily(map: Record<string, unknown>): void {
        const days = Object.keys(map).sort();
        if (days.length <= 7) return;
        for (const d of days.slice(0, days.length - 7)) delete map[d];
    }

    toJSON(): WalletJSON {
        return {
            balance: { ...this.balance },
            dailyConsumed: this.dailyConsumed,
            dailyGranted: this.dailyGranted,
            trials: this.trials,
            coins: this.balance.coin, // 冗余字段，便于旧读取方/调试
        };
    }

    fromJSON(data: WalletJSON | { coins?: number } | null): void {
        for (const k of WALLET_KINDS) this.balance[k] = 0;
        if (!data) return;
        const d = data as WalletJSON;
        if (d.balance && typeof d.balance === 'object') {
            for (const k of WALLET_KINDS) this.balance[k] = Math.max(0, Math.floor(d.balance[k] ?? 0));
        } else if (d.coins != null) {
            // 旧版存档：仅金币。
            this.balance.coin = Math.max(0, Math.floor(d.coins));
        }
        this.dailyConsumed = (d.dailyConsumed && typeof d.dailyConsumed === 'object') ? d.dailyConsumed : {};
        this.dailyGranted = (d.dailyGranted && typeof d.dailyGranted === 'object') ? d.dailyGranted : {};
        this.trials = Array.isArray(d.trials)
            ? d.trials.filter((t) => t && typeof t.skinId === 'string' && typeof t.expiresAt === 'number')
            : [];
        this.purgeExpiredTrials();
    }
}
