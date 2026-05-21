/**
 * @vitest-environment jsdom
 *
 * v1.60.45 — 爽感饥渴闭环（roundsSinceLastDelight + isDelightStarved + delight_starved 规则）
 *
 * 数据依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.5 + RETENTION_QUICK_WINS.md §5
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PlayerProfile } from '../web/src/playerProfile.js';
import { resolveIntent, INTENT_RULES } from '../web/src/derivation/intentResolver.js';
import { deriveSpawnIntent } from '../web/src/adaptiveSpawn.js';
import { _setPlatformForTest } from '../web/src/config/platformProfile.js';

describe('v1.60.45 — playerProfile 爽感闭环字段', () => {
    let profile;

    beforeEach(() => {
        profile = new PlayerProfile(15);
        _setPlatformForTest(null); // 清缓存
    });

    it('新建后 roundsSinceLastDelight = 0', () => {
        expect(profile._roundsSinceLastDelight).toBe(0);
    });

    it('tickRoundForDelight 累加', () => {
        profile.tickRoundForDelight();
        profile.tickRoundForDelight();
        profile.tickRoundForDelight();
        expect(profile._roundsSinceLastDelight).toBe(3);
    });

    it('recordDelight 清零并记录 kind / ts', () => {
        profile.tickRoundForDelight();
        profile.tickRoundForDelight();
        profile.recordDelight('multiClear');
        expect(profile._roundsSinceLastDelight).toBe(0);
        expect(profile._lastDelightKind).toBe('multiClear');
        expect(profile._lastDelightTs).toBeGreaterThan(0);
    });

    it('isDelightStarved Android 阈值 5（5+ → true，4 → false）', () => {
        _setPlatformForTest('android');
        for (let i = 0; i < 4; i++) profile.tickRoundForDelight();
        expect(profile.isDelightStarved()).toBe(false);
        profile.tickRoundForDelight();
        expect(profile.isDelightStarved()).toBe(true);
    });

    it('isDelightStarved iOS 阈值 7（7+ → true，6 → false）', () => {
        _setPlatformForTest('ios');
        for (let i = 0; i < 6; i++) profile.tickRoundForDelight();
        expect(profile.isDelightStarved()).toBe(false);
        profile.tickRoundForDelight();
        expect(profile.isDelightStarved()).toBe(true);
    });

    it('微信小程序档与 Android 同阈值 5', () => {
        _setPlatformForTest('wechat');
        for (let i = 0; i < 5; i++) profile.tickRoundForDelight();
        expect(profile.isDelightStarved()).toBe(true);
    });

    it('recordDelight 后再次 tick 不会立即超阈值', () => {
        _setPlatformForTest('android');
        for (let i = 0; i < 7; i++) profile.tickRoundForDelight();
        expect(profile.isDelightStarved()).toBe(true);
        profile.recordDelight('pcClear');
        profile.tickRoundForDelight();
        expect(profile.isDelightStarved()).toBe(false);
    });
});

describe('v1.60.45 — intentResolver delight_starved 规则', () => {
    it('INTENT_RULES 包含 delight_starved 且 priority=95', () => {
        const rule = INTENT_RULES.find(r => r.id === 'delight_starved');
        expect(rule).toBeTruthy();
        expect(rule.priority).toBe(95);
        expect(rule.spawnIntent).toBe('relief');
    });

    it('delightStarved=true 单独触发 → intent="delight_starved"，spawnIntent="relief"', () => {
        const r = resolveIntent({ delightStarved: true, roundsSinceLastDelight: 6 });
        expect(r.intent).toBe('delight_starved');
        expect(r.spawnIntent).toBe('relief');
    });

    it('relief 主规则触发时优先级高于 delight_starved（priority 100 > 95）', () => {
        const r = resolveIntent({
            delightStarved: true,
            playerDistress: -0.20, /* 触发 relief 主规则 */
        });
        expect(r.intent).toBe('relief');
        expect(r.spawnIntent).toBe('relief');
        /* delight_starved 应被 winner relief 覆盖（同走 relief 但分类不同） */
        expect(r.overrides.has('delight_starved')).toBe(true);
    });

    it('delightStarved=true 优先于 engage（priority 95 > 90）', () => {
        const r = resolveIntent({
            delightStarved: true,
            afkEngageActive: true,
        });
        expect(r.intent).toBe('delight_starved');
        expect(r.spawnIntent).toBe('relief');
        expect(r.overrides.has('engage')).toBe(true);
    });
});

describe('v1.60.45 — deriveSpawnIntent 短路 delightStarved → relief', () => {
    it('delightStarved=true 单独 → "relief"', () => {
        expect(deriveSpawnIntent({ delightStarved: true })).toBe('relief');
    });

    it('forceReliefIntent 优先 delightStarved（同分支语义但更上游）', () => {
        expect(deriveSpawnIntent({
            delightStarved: true,
            forceReliefIntent: true,
        })).toBe('relief');
    });

    it('delightStarved 优先 engage / harvest / pressure', () => {
        expect(deriveSpawnIntent({
            delightStarved: true,
            afkEngageActive: true,
            geometry: { nearFullLines: 3 },     /* harvestable */
            challengeBoost: 0.5,                /* pressure */
        })).toBe('relief');
    });

    it('delightStarved=false → 走原有逻辑', () => {
        expect(deriveSpawnIntent({ delightStarved: false })).toBe('maintain');
        expect(deriveSpawnIntent({
            delightStarved: false,
            playerDistress: -0.20,
        })).toBe('relief'); /* 走主 relief 路径 */
    });
});

/**
 * v1.60.45 §6 — ctx.forceReliefIntent 透传：复活后 game.js 写入 ctx，
 * adaptiveSpawn 应将其纳入 forceReliefIntent 判定。
 */
describe('v1.60.45 §6 — ctx.forceReliefIntent 复活救济路径', () => {
    it('resolveAdaptiveStrategy + ctx.forceReliefIntent=true → spawnIntent="relief"', async () => {
        const { resolveAdaptiveStrategy } = await import('../web/src/adaptiveSpawn.js');
        const profile = new PlayerProfile(15);
        profile._smoothSkill = 0.5;
        const s = resolveAdaptiveStrategy('normal', profile, 50, 0, 0.30, {
            forceReliefIntent: true, /* 模拟 game.js 在复活后注入 */
        });
        expect(s.spawnHints.spawnIntent).toBe('relief');
    });

    it('ctx.forceReliefIntent=false → 按原有逻辑走（中性场景应非 relief）', async () => {
        const { resolveAdaptiveStrategy } = await import('../web/src/adaptiveSpawn.js');
        const profile = new PlayerProfile(15);
        profile._smoothSkill = 0.5;
        const s = resolveAdaptiveStrategy('normal', profile, 50, 0, 0.30, {
            forceReliefIntent: false,
        });
        /* 中性 profile → 不应触发 relief */
        expect(s.spawnHints.spawnIntent).not.toBe('relief');
    });
});
