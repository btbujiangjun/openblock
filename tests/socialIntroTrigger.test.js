/**
 * @vitest-environment jsdom
 * socialIntroTrigger.test.js - 社交引入节点测试
 */

import { describe, it, expect, beforeEach } from 'vitest';

const mockStorage = {};

Object.defineProperty(globalThis, 'localStorage', {
    value: {
        getItem: (key) => mockStorage[key] ?? null,
        setItem: (key, value) => { mockStorage[key] = value; },
        removeItem: (key) => { delete mockStorage[key]; },
        clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
    },
    writable: true
});

import {
    checkSocialIntroTrigger,
    triggerSocialIntro,
    completeSocialIntro,
    getSocialProgress
} from '../web/src/retention/socialIntroTrigger.js';

describe('Social Intro Trigger', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    describe('checkSocialIntroTrigger', () => {
        it('should return available intros for new player', () => {
            const result = checkSocialIntroTrigger(5, 3);
            expect(result.shouldTrigger).toBeDefined();
            expect(result.nextIntro).toBeDefined();
        });

        it('should not trigger for already completed intros', () => {
            checkSocialIntroTrigger(20, 10);
            triggerSocialIntro('add_friend');
            completeSocialIntro('add_friend');
            
            const result = checkSocialIntroTrigger(25, 15);
            expect(result.availableIntros.every(i => i.id !== 'add_friend')).toBe(true);
        });
    });

    describe('triggerSocialIntro', () => {
        it('should successfully trigger intro', () => {
            const result = triggerSocialIntro('add_friend');
            expect(result.success).toBe(true);
            expect(result.introId).toBe('add_friend');
            expect(result.message).toBeDefined();
            expect(result.reward).toBeDefined();
        });
    });

    describe('completeSocialIntro', () => {
        it('should complete triggered intro', () => {
            triggerSocialIntro('join_guild');
            const result = completeSocialIntro('join_guild', { guildId: 'guild_123' });
            expect(result.success).toBe(true);
            expect(result.reward).toBeDefined();
        });

        it('should fail for non-triggered intro', () => {
            const result = completeSocialIntro('add_friend', {});
            expect(result.success).toBe(false);
        });
    });

    describe('getSocialProgress', () => {
        it('should return progress data', () => {
            const progress = getSocialProgress();
            expect(progress.completed).toBeDefined();
            expect(progress.total).toBeDefined();
            expect(progress.progress).toBeDefined();
            expect(progress.milestones).toBeDefined();
        });
    });
});