/**
 * InviteRewardSystem - 邀请奖励体系
 * 
 * 功能：
 * 1. 生成分享链接/二维码
 * 2. 追踪邀请关系
 * 3. 发放邀请奖励
 * 4. 阶梯奖励机制
 */
import { getWallet } from '../skills/wallet.js';
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';

const STORAGE_KEY = 'openblock_invite_v1';

/**
 * 邀请奖励配置
 */
export const INVITE_REWARDS = {
    // 首次邀请奖励
    firstInvite: {
        hintToken: 5,
        coin: 100,
        xp: 50
    },
    // 每次邀请奖励
    perInvite: {
        hintToken: 2,
        coin: 50,
        xp: 20
    },
    // 阶梯奖励
    tiers: [
        { invites: 5, bonus: { hintToken: 5, coin: 100 } },
        { invites: 10, bonus: { hintToken: 10, coin: 200 } },
        { invites: 20, bonus: { hintToken: 20, coin: 500 } },
        { invites: 50, bonus: { hintToken: 50, coin: 1000 } }
    ],
    // 被邀请者奖励
    inviteeReward: {
        hintToken: 3,
        coin: 50,
        xp: 30
    }
};

class InviteRewardSystem {
    constructor() {
        this._userId = null;
        this._inviteCode = null;
        this._invitedBy = null;
        this._inviteCount = 0;
        this._claimedRewards = [];
    }

    /**
     * 初始化
     */
    init(userId) {
        this._userId = userId;
        this._loadInviteData();
        
        // 检查 URL 参数中的邀请码
        this._checkUrlInviteCode();
        
        console.log('[Invite] Initialized, code:', this._inviteCode, 'invited:', this._invitedBy);
    }

    /**
     * 加载邀请数据
     */
    _loadInviteData() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                this._inviteCode = data.inviteCode;
                this._invitedBy = data.invitedBy;
                this._inviteCount = data.inviteCount || 0;
                this._claimedRewards = data.claimedRewards || [];
            }
        } catch {}
    }

    /**
     * 保存邀请数据
     */
    _saveInviteData() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                inviteCode: this._inviteCode,
                invitedBy: this._invitedBy,
                inviteCount: this._inviteCount,
                claimedRewards: this._claimedRewards
            }));
        } catch {}
    }

    /**
     * 检查 URL 中的邀请码
     */
    _checkUrlInviteCode() {
        const params = new URLSearchParams(window.location.search);
        const inviteCode = params.get('invite');
        
        if (inviteCode && !this._invitedBy && inviteCode !== this._inviteCode) {
            this._invitedBy = inviteCode;
            this._saveInviteData();
            
            // 发放被邀请者奖励
            this._giveInviteeReward();
        }
    }

    /**
     * 生成分享链接
     */
    generateShareLink() {
        if (!this._inviteCode) {
            this._inviteCode = this._generateInviteCode();
            this._saveInviteData();
        }
        
        const baseUrl = window.location.origin;
        return `${baseUrl}?invite=${this._inviteCode}`;
    }

    /**
     * 生成邀请码
     */
    _generateInviteCode() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return `${this._userId?.slice(0, 4) || 'BB'}${code}`;
    }

    /**
     * 生成分享文案
     */
    generateShareText() {
        const link = this.generateShareLink();
        return `我在玩 Block Blast，来一起PK吧！点击链接注册，你我都能获得奖励：${link}`;
    }

    /**
     * 分享到社交平台
     */
    async shareToSocial(platform) {
        const link = this.generateShareLink();
        const text = this.generateShareText();
        
        let shareUrl = '';
        
        switch (platform) {
            case 'twitter':
                shareUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
                break;
            case 'facebook':
                shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}`;
                break;
            case 'wechat':
                // 微信需要扫二维码，这里返回链接
                return { type: 'link', link, text };
            default:
                // 复制到剪贴板
                if (navigator.clipboard) {
                    await navigator.clipboard.writeText(text);
                    return { type: 'clipboard', text };
                }
        }
        
        if (shareUrl) {
            window.open(shareUrl, '_blank');
            return { type: 'opened', url: shareUrl };
        }
        
        return { type: 'error' };
    }

    /**
     * 发放被邀请者奖励
     */
    _giveInviteeReward() {
        const wallet = getWallet();
        const reward = INVITE_REWARDS.inviteeReward;
        
        if (reward.hintToken) {
            wallet.addBalance('hintToken', reward.hintToken, 'invitee_reward');
        }
        if (reward.coin) {
            wallet.addBalance('coin', reward.coin, 'invitee_reward');
        }
        
        console.log('[Invite] Invitee reward given:', reward);
    }

    /**
     * 记录邀请成功
     */
    async recordInvite(inviteeId) {
        this._inviteCount++;
        this._saveInviteData();
        
        // 发放邀请者奖励
        await this._giveInviteReward();
        
        // 检查阶梯奖励
        await this._checkTierReward();
        
        // 同步到服务端
        await this._syncToServer(inviteeId);
        
        console.log('[Invite] Invite recorded, count:', this._inviteCount);
    }

    /**
     * 发放邀请者奖励
     */
    async _giveInviteReward() {
        const wallet = getWallet();
        
        // 首次邀请额外奖励
        const reward = this._inviteCount === 1 
            ? INVITE_REWARDS.firstInvite 
            : INVITE_REWARDS.perInvite;
        
        if (reward.hintToken) {
            wallet.addBalance('hintToken', reward.hintToken, 'invite_reward');
        }
        if (reward.coin) {
            wallet.addBalance('coin', reward.coin, 'invite_reward');
        }
        if (reward.xp) {
            // XP 会通过 progression 系统自动处理
        }
        
        console.log('[Invite] Inviter reward given:', reward);
    }

    /**
     * 检查阶梯奖励
     */
    async _checkTierReward() {
        for (const tier of INVITE_REWARDS.tiers) {
            if (this._inviteCount >= tier.invites && !this._claimedRewards.includes(tier.invites)) {
                this._claimedRewards.push(tier.invites);
                
                // 发放奖励
                const wallet = getWallet();
                if (tier.bonus.hintToken) {
                    wallet.addBalance('hintToken', tier.bonus.hintToken, 'tier_reward');
                }
                if (tier.bonus.coin) {
                    wallet.addBalance('coin', tier.bonus.coin, 'tier_reward');
                }
                
                console.log('[Invite] Tier reward given:', tier.invites);
            }
        }
        
        this._saveInviteData();
    }

    /**
     * 同步到服务端
     */
    async _syncToServer(inviteeId) {
        if (!isSqliteClientDatabase()) return;
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            await fetch(`${base}/api/invite/record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inviter_id: this._userId,
                    invitee_id: inviteeId,
                    invite_code: this._inviteCode
                })
            });
        } catch (e) {
            console.warn('[Invite] Sync failed:', e);
        }
    }

    /**
     * 获取邀请状态
     */
    getInviteStatus() {
        return {
            inviteCode: this._inviteCode,
            shareLink: this._inviteCode ? this.generateShareLink() : null,
            inviteCount: this._inviteCount,
            invitedBy: this._invitedBy,
            claimedTiers: this._claimedRewards,
            availableTiers: INVITE_REWARDS.tiers.filter(
                t => t.invites <= this._inviteCount && !this._claimedRewards.includes(t.invites)
            ),
            nextTier: INVITE_REWARDS.tiers.find(t => t.invites > this._inviteCount)
        };
    }

    /**
     * 获取进度
     */
    getProgress() {
        const nextTier = INVITE_REWARDS.tiers.find(t => t.invites > this._inviteCount);
        
        if (!nextTier) {
            return { current: this._inviteCount, target: null, progress: 1 };
        }
        
        const prevTier = INVITE_REWARDS.tiers.find(t => t.invites <= this._inviteCount) || { invites: 0 };
        const progress = (this._inviteCount - prevTier.invites) / (nextTier.invites - prevTier.invites);
        
        return {
            current: this._inviteCount,
            target: nextTier.invites,
            progress: Math.min(1, Math.max(0, progress)),
            bonus: nextTier.bonus
        };
    }

    /**
     * 重置邀请数据（调试用）
     */
    resetInviteData() {
        this._inviteCount = 0;
        this._claimedRewards = [];
        this._saveInviteData();
        console.log('[Invite] Data reset');
    }
}

let _instance = null;
export function getInviteRewardSystem() {
    if (!_instance) {
        _instance = new InviteRewardSystem();
    }
    return _instance;
}

export function initInviteSystem(userId) {
    getInviteRewardSystem().init(userId);
}