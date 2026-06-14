/**
 * C2 纯逻辑：campaignManager（LO-1） + winbackTiers（LO-4）。
 */
import { describe, it, expect } from 'vitest';
import {
    isCampaignActive, matchesAudience, getActiveCampaigns, getTopCampaign,
} from '../web/src/retention/campaignManager.js';
import {
    classifyWinbackTier, shouldOfferWinback, daysSince, resolveWinback,
} from '../web/src/retention/winbackTiers.js';

describe('LO-1 campaignManager', () => {
    const now = Date.parse('2026-06-15T10:00:00Z'); // 周一(1)
    const cfg = {
        campaigns: [
            { id: 'always', audience: 'all', priority: 10 },
            { id: 'season', audience: 'all', start: '2026-06-01', end: '2026-08-31', priority: 80 },
            { id: 'expired', audience: 'all', start: '2026-01-01', end: '2026-02-01', priority: 50 },
            { id: 'weekend', audience: 'all', recurring: 'weekly', weekdays: [5, 6], priority: 60 },
            { id: 'newbie', audience: 'new', priority: 100 },
        ],
    };
    it('窗口判定：season 生效 / expired 失效', () => {
        expect(isCampaignActive(cfg.campaigns[1], now)).toBe(true);
        expect(isCampaignActive(cfg.campaigns[2], now)).toBe(false);
    });
    it('周期活动：周一不在 weekend', () => {
        expect(isCampaignActive(cfg.campaigns[3], now)).toBe(false);
    });
    it('受众过滤', () => {
        expect(matchesAudience(cfg.campaigns[4], { lifecycleStage: 'new' })).toBe(true);
        expect(matchesAudience(cfg.campaigns[4], { lifecycleStage: 'mature' })).toBe(false);
    });
    it('getActiveCampaigns 按优先级 + 受众', () => {
        const act = getActiveCampaigns(cfg, { lifecycleStage: 'new' }, now);
        const ids = act.map((c) => c.id);
        expect(ids).toContain('newbie');
        expect(ids).toContain('season');
        expect(ids).not.toContain('expired');
        expect(ids).not.toContain('weekend');
        expect(act[0].id).toBe('newbie'); // 最高优先级
        expect(getTopCampaign(cfg, { lifecycleStage: 'new' }, now).id).toBe('newbie');
    });
});

describe('LO-4 winbackTiers', () => {
    it('分层边界', () => {
        expect(classifyWinbackTier(1).id).toBe('none');
        expect(classifyWinbackTier(3).id).toBe('d3');
        expect(classifyWinbackTier(7).id).toBe('d7');
        expect(classifyWinbackTier(14).id).toBe('d14');
        expect(classifyWinbackTier(40).id).toBe('d30');
    });
    it('shouldOfferWinback', () => {
        expect(shouldOfferWinback(1)).toBe(false);
        expect(shouldOfferWinback(7)).toBe(true);
    });
    it('daysSince + resolveWinback', () => {
        const now = Date.now();
        expect(daysSince(now - 8 * 86400000, now)).toBe(8);
        const r = resolveWinback(now - 8 * 86400000, now);
        expect(r.tier).toBe('d7');
        expect(r.gift).toBe('winback_mid');
        expect(r.rewards.length).toBeGreaterThan(0);
    });
});
