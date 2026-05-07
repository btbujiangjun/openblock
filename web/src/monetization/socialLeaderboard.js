/**
 * SocialLeaderboard - 社交排行榜系统
 * 
 * 功能：
 * 1. 好友排行榜
 * 2. 全球排行榜
 * 3. 本地排行榜
 * 4. 社交互动（点赞、评论）
 */
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';

const STORAGE_KEY = 'openblock_leaderboard_v1';

export const LEADERBOARD_TYPES = {
    FRIENDS: 'friends',
    GLOBAL: 'global',
    WEEKLY: 'weekly',
    ALL_TIME: 'all_time',
    LOCAL: 'local'
};

class SocialLeaderboard {
    constructor() {
        this._userId = null;
        this._friends = [];
        this._cache = {};
        this._cacheTime = {};
    }

    /**
     * 初始化
     */
    init(userId) {
        this._userId = userId;
        this._loadLocalData();
        console.log('[Leaderboard] Initialized for user:', userId);
    }

    /**
     * 加载本地数据
     */
    _loadLocalData() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                this._friends = data.friends || [];
            }
        } catch {}
    }

    /**
     * 保存本地数据
     */
    _saveLocalData() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                friends: this._friends
            }));
        } catch {}
    }

    /**
     * 获取排行榜数据
     */
    async getLeaderboard(type = LEADERBOARD_TYPES.GLOBAL, limit = 100) {
        const cacheKey = `${type}_${limit}`;
        
        // 检查缓存（5分钟有效）
        if (this._cache[cacheKey] && (Date.now() - this._cacheTime[cacheKey]) < 5 * 60 * 1000) {
            return this._cache[cacheKey];
        }
        
        // 尝试从服务器获取
        if (isSqliteClientDatabase()) {
            try {
                const base = getApiBaseUrl().replace(/\/+$/, '');
                const response = await fetch(
                    `${base}/api/leaderboard?type=${type}&limit=${limit}&user_id=${this._userId}`
                );
                
                if (response.ok) {
                    const data = await response.json();
                    this._cache[cacheKey] = data;
                    this._cacheTime[cacheKey] = Date.now();
                    return data;
                }
            } catch (e) {
                console.warn('[Leaderboard] Fetch failed:', e);
            }
        }
        
        // 返回本地模拟数据
        return this._generateMockData(type, limit);
    }

    /**
     * 生成模拟数据
     */
    _generateMockData(type, limit) {
        const mockUsers = [
            { id: 'user_1', name: '游戏达人', avatar: '🎮', score: 2500 },
            { id: 'user_2', name: '方块大师', avatar: '🧩', score: 2200 },
            { id: 'user_3', name: '消消乐高手', avatar: '⭐', score: 2000 },
            { id: 'user_4', name: '拼图小王子', avatar: '👑', score: 1800 },
            { id: 'user_5', name: '益智玩家', avatar: '🎯', score: 1600 },
            { id: 'user_6', name: '休闲达人', avatar: '🌟', score: 1400 },
            { id: 'user_7', name: '新手上路', avatar: '🌱', score: 1200 },
            { id: 'user_8', name: '快乐游戏', avatar: '😊', score: 1000 }
        ];
        
        // 根据类型调整数据
        if (type === LEADERBOARD_TYPES.FRIENDS) {
            return this._getFriendsLeaderboard();
        }
        
        return mockUsers.slice(0, limit).map((user, index) => ({
            rank: index + 1,
            ...user,
            isMe: user.id === this._userId
        }));
    }

    /**
     * 获取好友排行榜
     */
    _getFriendsLeaderboard() {
        const allUsers = [
            ...this._friends,
            { id: this._userId, name: '我', avatar: '🎮', score: Math.floor(Math.random() * 2000) + 500 }
        ];
        
        return allUsers
            .sort((a, b) => b.score - a.score)
            .map((user, index) => ({
                rank: index + 1,
                id: user.id,
                name: user.name,
                avatar: user.avatar,
                score: user.score,
                isMe: user.id === this._userId
            }));
    }

    /**
     * 获取我的排名
     */
    async getMyRank(type = LEADERBOARD_TYPES.GLOBAL) {
        const leaderboard = await this.getLeaderboard(type);
        const myEntry = leaderboard.find(entry => entry.isMe);
        
        return myEntry?.rank || null;
    }

    /**
     * 提交分数
     */
    async submitScore(score, gameData = {}) {
        if (!this._userId) return false;
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            
            await fetch(`${base}/api/leaderboard`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this._userId,
                    score,
                    ...gameData
                })
            });
            
            // 清除缓存
            this._cache = {};
            
            return true;
        } catch (e) {
            console.warn('[Leaderboard] Submit failed:', e);
            return false;
        }
    }

    /**
     * 添加好友
     */
    async addFriend(friendCode) {
        if (!friendCode || friendCode === this._userId) return false;
        
        // 检查是否已添加
        if (this._friends.some(f => f.id === friendCode)) {
            return false;
        }
        
        // 添加模拟好友
        this._friends.push({
            id: friendCode,
            name: `玩家${friendCode.slice(-4)}`,
            avatar: ['🎮', '🧩', '⭐', '👑', '🎯'][Math.floor(Math.random() * 5)],
            score: Math.floor(Math.random() * 2000)
        });
        
        this._saveLocalData();
        
        return true;
    }

    /**
     * 移除好友
     */
    removeFriend(friendId) {
        this._friends = this._friends.filter(f => f.id !== friendId);
        this._saveLocalData();
    }

    /**
     * 获取好友列表
     */
    getFriends() {
        return [...this._friends];
    }

    /**
     * 生成分享码
     */
    generateShareCode() {
        return `BB${this._userId?.slice(0, 8) || Math.random().toString(36).slice(2, 10)}`;
    }

    /**
     * 从分享码解析用户
     */
    parseShareCode(code) {
        if (code.startsWith('BB')) {
            return code.slice(2);
        }
        return null;
    }

    /**
     * 点赞
     */
    async likeEntry(entryId) {
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            await fetch(`${base}/api/leaderboard/like`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this._userId,
                    entry_id: entryId
                })
            });
            return true;
        } catch {}
        return false;
    }

    /**
     * 获取我的最高分
     */
    getMyBestScore() {
        // 从本地存储获取
        try {
            const best = localStorage.getItem('openblock_best_score');
            return best ? parseInt(best) : 0;
        } catch {
            return 0;
        }
    }

    /**
     * 检查是否是新纪录
     */
    checkNewRecord(score) {
        const best = this.getMyBestScore();
        if (score > best) {
            localStorage.setItem('openblock_best_score', String(score));
            return true;
        }
        return false;
    }
}

let _instance = null;
export function getSocialLeaderboard() {
    if (!_instance) {
        _instance = new SocialLeaderboard();
    }
    return _instance;
}

export function initLeaderboard(userId) {
    getSocialLeaderboard().init(userId);
}