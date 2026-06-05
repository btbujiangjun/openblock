/**
 * 排行榜（Phase P2）。微信走开放数据域（wx.setUserCloudStorage + 子域渲染）；
 * 其它端用本地 Top 榜兜底，保证任何环境有榜可看。
 */
import { Storage, STORAGE_KEYS } from './Storage';

export interface RankEntry {
    name: string;
    score: number;
    you?: boolean;
}

interface WxLbApi {
    setUserCloudStorage?: (opts: { KVDataList: Array<{ key: string; value: string }> }) => void;
}

function wx(): WxLbApi | null {
    return (globalThis as unknown as { wx?: WxLbApi }).wx ?? null;
}

export const Leaderboard = {
    /** 提交分数：微信写入开放数据，同时更新本地 Top 榜。 */
    submit(score: number): void {
        const api = wx();
        if (api?.setUserCloudStorage) {
            try {
                api.setUserCloudStorage({ KVDataList: [{ key: 'score', value: String(score) }] });
            } catch { /* ignore */ }
        }
        const local = this.localTop();
        local.push({ name: 'You', score, you: true });
        local.sort((a, b) => b.score - a.score);
        Storage.setJSON(STORAGE_KEYS.leaderboard, local.slice(0, 20));
    },

    localTop(): RankEntry[] {
        return Storage.getJSON<RankEntry[]>(STORAGE_KEYS.leaderboard, []);
    },

    /** 取展示用榜单（本地兜底；微信端实际榜由开放数据子域绘制）。 */
    top(limit = 10): RankEntry[] {
        return this.localTop().slice(0, limit);
    },
};
