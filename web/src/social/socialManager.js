/**
 * socialManager.js — 统一社交系统管理器
 * 
 * 整合：
 * - multiplayerGame: 多人游戏模式
 * - friendSystem: 好友与对战
 * - guildSystem: 公会系统
 * - socialLeaderboard: 排行榜
 */

import { getMultiplayerGame, GAME_MODES } from './multiplayerGame.js';
// FRIEND_STATES / GUILD_STATES 通过子系统按需访问，避免顶层未使用导入；UI 层需要时直接 import 子系统。
import { getFriendSystem, BATTLE_STATES } from './friendSystem.js';
import { getGuildSystem, GUILD_ROLES } from './guildSystem.js';
import { getSocialLeaderboard, LEADERBOARD_TYPES } from '../monetization/socialLeaderboard.js';

let _instance = null;
let _userId = null;
let _initialized = false;

export function initSocialManager(userId) {
    if (_initialized) return;
    
    _userId = userId;
    
    getMultiplayerGame().init(userId);
    getFriendSystem().init(userId);
    getGuildSystem().init(userId);
    
    const leaderboard = getSocialLeaderboard();
    if (leaderboard.init) {
        leaderboard.init(userId);
    }
    
    _initialized = true;
    console.log('[Social] Manager initialized for user:', userId);
}

export function getSocialManager() {
    if (!_instance) {
        _instance = {
            init: initSocialManager,
            
            getMultiplayer: () => getMultiplayerGame(),
            
            getFriends: () => getFriendSystem(),
            
            getGuild: () => getGuildSystem(),
            
            getLeaderboard: () => getSocialLeaderboard(),
            
            startCompetitiveMatch: function() {
                const mp = getMultiplayerGame();
                mp.setMode(GAME_MODES.COMPETITIVE);
                return mp;
            },
            
            startCoopMatch: function() {
                const mp = getMultiplayerGame();
                mp.setMode(GAME_MODES.COOPERATIVE);
                return mp;
            },
            
            startChallenge: function() {
                const mp = getMultiplayerGame();
                mp.setMode(GAME_MODES.CHALLENGE);
                return mp;
            },
            
            inviteFriend: function(friendId) {
                return getFriendSystem().inviteToBattle(friendId);
            },
            
            acceptInvite: function() {
                return getFriendSystem().acceptBattleInvite();
            },
            
            declineInvite: function() {
                return getFriendSystem().declineBattleInvite();
            },
            
            createGuild: function(name, tag, description) {
                return getGuildSystem().createGuild(name, tag, description);
            },
            
            joinGuild: function(guildId) {
                const result = getGuildSystem().applyToGuild(guildId);
                if (result.success) {
                    const mockGuild = {
                        id: guildId,
                        name: 'Joined Guild',
                        tag: 'JOIN',
                        members: [{ userId: _userId, name: 'You', role: GUILD_ROLES.MEMBER }]
                    };
                    return getGuildSystem().joinGuild(mockGuild);
                }
                return false;
            },
            
            getSocialSummary: function() {
                const friends = getFriendSystem().getFriends();
                const guild = getGuildSystem().getGuild();
                const leaderboard = getSocialLeaderboard();
                
                return {
                    friendCount: friends.length,
                    onlineFriends: friends.filter(f => f.onlineState === 'online').length,
                    inGameFriends: friends.filter(f => f.onlineState === 'in_game').length,
                    guildMember: guild !== null,
                    guildName: guild?.name || null,
                    guildRole: guild ? getGuildSystem().getMyRole() : null,
                    leaderboards: {
                        friends: leaderboard.getTop(LEADERBOARD_TYPES.FRIENDS, 10),
                        global: leaderboard.getTop(LEADERBOARD_TYPES.GLOBAL, 10),
                        weekly: leaderboard.getTop(LEADERBOARD_TYPES.WEEKLY, 10)
                    }
                };
            },
            
            getActiveEvents: function() {
                const events = [];
                
                const mp = getMultiplayerGame();
                const mpState = mp.getGameState();
                if (mpState === 'playing') {
                    events.push({
                        type: 'multiplayer',
                        mode: mp.getCurrentMode(),
                        players: mp.getPlayers().length
                    });
                }
                
                const fs = getFriendSystem();
                const battleState = fs.getBattleState();
                if (battleState === BATTLE_STATES.INVITED) {
                    const battle = fs.getCurrentBattle();
                    events.push({
                        type: 'battle_invite',
                        from: battle?.friendName
                    });
                }
                
                const gs = getGuildSystem();
                const guild = gs.getGuild();
                if (guild) {
                    const recentActivity = guild.announcements?.[0];
                    if (recentActivity) {
                        events.push({
                            type: 'guild_announcement',
                            content: recentActivity.content.substring(0, 50)
                        });
                    }
                }
                
                return events;
            },
            
            cleanup: function() {
                getMultiplayerGame().resetGame();
                getFriendSystem().resetBattle();
                _initialized = false;
            }
        };
    }
    return _instance;
}

export function getSocialManagerInstance() {
    return getSocialManager();
}