/** 钱包/虚拟货币（引擎无关，Phase 3）。技能消耗、奖励、签到收入统一走这里。 */

export type WalletListener = (coins: number, delta: number) => void;

export class Wallet {
    private _coins: number;
    private listeners: WalletListener[] = [];

    constructor(initial = 0) {
        this._coins = Math.max(0, Math.floor(initial));
    }

    get coins(): number {
        return this._coins;
    }

    onChange(fn: WalletListener): () => void {
        this.listeners.push(fn);
        return () => {
            const i = this.listeners.indexOf(fn);
            if (i >= 0) this.listeners.splice(i, 1);
        };
    }

    private emit(delta: number): void {
        for (const fn of this.listeners) fn(this._coins, delta);
    }

    canAfford(n: number): boolean {
        return this._coins >= n;
    }

    earn(n: number): void {
        if (n <= 0) return;
        this._coins += Math.floor(n);
        this.emit(Math.floor(n));
    }

    spend(n: number): boolean {
        const cost = Math.floor(n);
        if (cost <= 0) return true;
        if (this._coins < cost) return false;
        this._coins -= cost;
        this.emit(-cost);
        return true;
    }

    toJSON(): { coins: number } {
        return { coins: this._coins };
    }

    fromJSON(data: { coins?: number } | null): void {
        this._coins = Math.max(0, Math.floor(data?.coins ?? 0));
    }
}
