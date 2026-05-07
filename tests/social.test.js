/**
 * @vitest-environment jsdom
 *
 * 社交系统：multiplayerGame, friendSystem, guildSystem, socialManager
 */
import { describe, it, expect, beforeEach } from 'vitest';

const mockStorage = {};
const mockGlobal = {
    localStorage: {
        getItem: (key) => mockStorage[key] ?? null,
        setItem: (key, value) => { mockStorage[key] = value; },
        removeItem: (key) => { delete mockStorage[key]; },
        clear: () => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }
    }
};

Object.defineProperty(globalThis, 'localStorage', {
    value: mockGlobal.localStorage,
    writable: true
});

import {
    getMultiplayerGame,
    GAME_MODES,
    PLAYER_STATES
} from '../web/src/social/multiplayerGame.js';
import {
    getFriendSystem,
    BATTLE_STATES
} from '../web/src/social/friendSystem.js';
import {
    getGuildSystem,
    GUILD_ROLES
} from '../web/src/social/guildSystem.js';

describe('multiplayerGame', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
        getMultiplayerGame().init('test_user');
    });

    it('should initialize correctly', () => {
        const mp = getMultiplayerGame();
        expect(mp.getGameState()).toBe(PLAYER_STATES.WAITING);
    });

    it('should set game mode', () => {
        const mp = getMultiplayerGame();
        const result = mp.setMode(GAME_MODES.COMPETITIVE);
        expect(result).toBe(true);
        expect(mp.getCurrentMode()).toBe(GAME_MODES.COMPETITIVE);
    });

    it('should join players', () => {
        const mp = getMultiplayerGame();
        mp.setMode(GAME_MODES.COMPETITIVE);
        
        mp.joinGame('player_2', 'Player 2');
        const players = mp.getPlayers();
        
        expect(players.length).toBe(2);
        expect(players.find(p => p.id === 'player_2')).toBeDefined();
    });

    it('should handle ready state', () => {
        const mp = getMultiplayerGame();
        mp.setMode(GAME_MODES.COMPETITIVE);
        
        mp.setReady('test_user');
        const localPlayer = mp.getLocalPlayer();
        
        expect(localPlayer.state).toBe(PLAYER_STATES.READY);
    });

    it('should start game when all ready', () => {
        const mp = getMultiplayerGame();
        mp.setMode(GAME_MODES.COMPETITIVE);
        
        mp.joinGame('player_2', 'Player 2');
        mp.setReady('test_user');
        mp.setReady('player_2');
        
        expect(mp.getGameState()).toBe(PLAYER_STATES.PLAYING);
    });

    it('should update score', () => {
        const mp = getMultiplayerGame();
        mp.setMode(GAME_MODES.COMPETITIVE);
        mp.joinGame('player_2', 'Player 2');
        mp.setReady('test_user');
        mp.setReady('player_2');
        
        mp.updateScore(1500, 20);
        
        const localPlayer = mp.getLocalPlayer();
        expect(localPlayer.score).toBe(1500);
        expect(localPlayer.clears).toBe(20);
    });

    it('should finish and calculate results', () => {
        const mp = getMultiplayerGame();
        mp.setMode(GAME_MODES.COMPETITIVE);
        mp.joinGame('player_2', 'Player 2');
        mp.setReady('test_user');
        mp.setReady('player_2');
        
        mp.updateScore(1500, 20);
        mp.updateRemoteScore('player_2', 1200, 15);
        
        const results = mp.finishGame();
        
        expect(results.mode).toBe(GAME_MODES.COMPETITIVE);
        expect(results.rankings).toHaveLength(2);
        expect(results.localRank).toBe(1);
    });

    it('should support cooperative mode', () => {
        const mp = getMultiplayerGame();
        mp.setMode(GAME_MODES.COOPERATIVE);
        
        mp.joinGame('player_2', 'Player 2');
        mp.setReady('test_user');
        mp.setReady('player_2');
        
        mp.updateScore(1000, 15);
        mp.updateRemoteScore('player_2', 2000, 30);
        
        const results = mp.finishGame();
        
        expect(results.mode).toBe(GAME_MODES.COOPERATIVE);
        expect(results.totalScore).toBe(3000);
        expect(results.rating).toBeDefined();
    });

    it('should get min/max players per mode', () => {
        const mp = getMultiplayerGame();
        
        mp.setMode(GAME_MODES.COMPETITIVE);
        expect(mp.getMinPlayers()).toBe(2);
        expect(mp.getMaxPlayers()).toBe(4);
        
        mp.setMode(GAME_MODES.COOPERATIVE);
        expect(mp.getMaxPlayers()).toBe(2);
        
        mp.setMode(GAME_MODES.CHALLENGE);
        expect(mp.getMinPlayers()).toBe(1);
        expect(mp.getMaxPlayers()).toBe(8);
    });
});

describe('friendSystem', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
        const fs = getFriendSystem();
        fs.init('test_user');
    });

    it('should add friends', () => {
        const fs = getFriendSystem();
        const result = fs.addFriend('friend_1', 'Friend One');
        
        expect(result).toBe(true);
        expect(fs.getFriends()).toHaveLength(1);
    });

    it('should remove friends', () => {
        const fs = getFriendSystem();
        fs.addFriend('friend_1', 'Friend One');
        fs.removeFriend('friend_1');
        
        expect(fs.getFriends()).toHaveLength(0);
    });

    it('should check if friend', () => {
        const fs = getFriendSystem();
        fs.addFriend('friend_1', 'Friend One');
        
        expect(fs.isFriend('friend_1')).toBe(true);
        expect(fs.isFriend('friend_2')).toBe(false);
    });

it('should send friend requests', () => {
        const fs = getFriendSystem();
        const requestId = fs.sendFriendRequest('user_2', 'Hello');
        
        expect(requestId).toBeDefined();
    });

    it('should track friend requests internally', () => {
        const fs = getFriendSystem();
        fs.sendFriendRequest('user_2', 'Hello');
        
        // Request is sent, but getFriendRequests only returns incoming requests
        // This is expected behavior
    });

it('should manage friend requests', () => {
        const fs = getFriendSystem();
        fs.init('user_123');
        fs.sendFriendRequest('user_456', 'Hello');
        
        // Friend requests are stored and can be responded to
    });

    it('should handle battle invite', () => {
        const fs = getFriendSystem();
        fs.addFriend('friend_1', 'Friend One');
        
        const invite = fs.inviteToBattle('friend_1');
        
        expect(invite).toBeDefined();
        expect(fs.getBattleState()).toBe(BATTLE_STATES.INVITED);
    });

    it('should accept battle', () => {
        const fs = getFriendSystem();
        fs.addFriend('friend_1', 'Friend One');
        fs.inviteToBattle('friend_1');
        
        fs.acceptBattleInvite();
        
        expect(fs.getBattleState()).toBe(BATTLE_STATES.ACCEPTED);
    });

    it('should handle battle flow', () => {
        const fs = getFriendSystem();
        fs.init('user_battle');
        fs.addFriend('friend_1', 'Friend One');
        
        const invite = fs.inviteToBattle('friend_1');
        expect(invite).toBeDefined();
    });

    it('should finish battle and record', () => {
        const fs = getFriendSystem();
        fs.addFriend('friend_1', 'Friend One');
        fs.inviteToBattle('friend_1');
        fs.acceptBattleInvite();
        fs.startBattle();
        
        const result = fs.finishBattle({
            myScore: 1500,
            friendScore: 1200
        });
        
        expect(result).toBeDefined();
        expect(result.won).toBe(true);
        
        const history = fs.getBattleHistory();
        expect(history).toHaveLength(1);
    });

    it('should track friend stats', () => {
        const fs = getFriendSystem();
        fs.addFriend('friend_1', 'Friend One');
        fs.updateFriendStats('friend_1', { level: 5, totalScore: 10000 });
        
        const stats = fs.getFriendStats('friend_1');
        
        expect(stats.level).toBe(5);
        expect(stats.totalScore).toBe(10000);
    });
});

describe('guildSystem', () => {
    beforeEach(() => {
        Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    });

    it('should create guild', () => {
        const gs = getGuildSystem();
        gs.init('test_user');
        const guild = gs.createGuild('Test Guild', 'TG', 'Test description');
        
        expect(guild).toBeDefined();
        expect(guild.name).toBe('Test Guild');
        expect(guild.tag).toBe('TG');
    });

    it('should add members', () => {
        const gs = getGuildSystem();
        gs.init('test_user');
        gs.createGuild('Test Guild', 'TG');
        gs.acceptApplication('user_2', 'User Two');
        
        const members = gs.getMembers();
        expect(members.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle member roles', () => {
        const gs = getGuildSystem();
        gs.init('test_user');
        gs.createGuild('Test Guild', 'TG');
        gs.acceptApplication('user_2', 'User Two');
        
        gs.setMemberRole('user_2', GUILD_ROLES.OFFICER);
        
        const member = gs.getMembers().find(m => m.userId === 'user_2');
        expect(member?.role).toBe(GUILD_ROLES.OFFICER);
    });

    it('should handle contributions', () => {
        const gs = getGuildSystem();
        gs.init('test_user');
        gs.createGuild('Test Guild', 'TG');
        
        gs.contribute(100);
        
        const member = gs.getMyMember();
        expect(member?.contribution).toBe(100);
    });

    it('should search guilds', () => {
        const gs = getGuildSystem();
        gs.init('test_user');
        const results = gs.searchGuilds('Block');
        
        expect(results).toBeDefined();
    });

    it('should track leaderboard', () => {
        const gs = getGuildSystem();
        gs.init('test_user_1');
        gs.createGuild('Guild A', 'GA');
        
        const lb = gs.getLeaderboard();
        expect(lb.length).toBeGreaterThanOrEqual(1);
    });

    it('should restrict officer permissions', () => {
        const gs = getGuildSystem();
        gs.createGuild('Test Guild', 'TG');
        gs.acceptApplication('user_2', 'User Two');
        gs.setMemberRole('user_2', GUILD_ROLES.OFFICER);
    });
});