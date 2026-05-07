/**
 * friendSystem.js — 好友与对战系统
 * 
 * 功能：
 * 1. 好友管理（添加、删除、查询）
 * 2. 好友状态（在线、离线、游戏中）
 * 3. 好友对战邀请与结果
 * 4. 好友最近动态
 */

const STORAGE_KEY = 'openblock_friends_v1';

export const FRIEND_STATES = {
    NONE: 'none',
    PENDING: 'pending',
    FRIENDS: 'friends',
    BLOCKED: 'blocked'
};

export const ONLINE_STATES = {
    OFFLINE: 'offline',
    ONLINE: 'online',
    IN_GAME: 'in_game'
};

export const BATTLE_STATES = {
    IDLE: 'idle',
    INVITED: 'invited',
    ACCEPTED: 'accepted',
    DECLINED: 'declined',
    PLAYING: 'playing',
    FINISHED: 'finished',
    EXPIRED: 'expited'
};

let _instance = null;
let _userId = null;
let _friends = new Map();
let _friendRequests = [];
let _battleState = BATTLE_STATES.IDLE;
let _currentBattle = null;
let _battleHistory = [];
let _eventListeners = new Map();

function initFriendSystem(userId) {
    _userId = userId;
    _loadFromStorage();
    console.log('[Friend] Initialized for user:', userId);
}

function _loadFromStorage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            _friends = new Map(data.friends || []);
            _friendRequests = data.requests || [];
            _battleHistory = data.history || [];
        }
    } catch {}
}

function _saveToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            friends: Array.from(_friends.entries()),
            requests: _friendRequests,
            history: _battleHistory
        }));
    } catch {}
}

function addFriend(friendId, friendName) {
    if (_friends.has(friendId)) {
        return false;
    }
    
    const friend = {
        id: friendId,
        name: friendName,
        state: FRIEND_STATES.FRIENDS,
        onlineState: ONLINE_STATES.OFFLINE,
        addedAt: Date.now(),
        lastSeen: Date.now(),
        avatar: null,
        level: 1,
        totalScore: 0,
        winCount: 0,
        battleCount: 0
    };
    
    _friends.set(friendId, friend);
    _saveToStorage();
    
    return true;
}

function removeFriend(friendId) {
    if (!_friends.has(friendId)) {
        return false;
    }
    
    _friends.delete(friendId);
    _saveToStorage();
    
    return true;
}

function getFriends() {
    return Array.from(_friends.values()).filter(f => f.state === FRIEND_STATES.FRIENDS);
}

function getFriend(friendId) {
    return _friends.get(friendId);
}

function isFriend(friendId) {
    const friend = _friends.get(friendId);
    return friend?.state === FRIEND_STATES.FRIENDS;
}

function sendFriendRequest(toUserId, message = '') {
    const request = {
        id: generateRequestId(),
        from: _userId,
        to: toUserId,
        message,
        timestamp: Date.now(),
        status: 'pending'
    };
    
    _friendRequests.push(request);
    _saveToStorage();
    
    return request.id;
}

function respondToFriendRequest(requestId, accept) {
    const request = _friendRequests.find(r => r.id === requestId);
    if (!request) return false;
    
    if (accept && request.to === _userId) {
        addFriend(request.from, request.from);
    }
    
    request.status = accept ? 'accepted' : 'rejected';
    _saveToStorage();
    
    return true;
}

function getFriendRequests() {
    return _friendRequests.filter(r => r.to === _userId && r.status === 'pending');
}

function updateOnlineState(userId, state) {
    const friend = _friends.get(userId);
    if (!friend) return;
    
    friend.onlineState = state;
    friend.lastSeen = Date.now();
    _saveToStorage();
}

function inviteToBattle(friendId) {
    if (_battleState !== BATTLE_STATES.IDLE) {
        return null;
    }
    
    const friend = _friends.get(friendId);
    if (!friend) return null;
    
    _battleState = BATTLE_STATES.INVITED;
    _currentBattle = {
        friendId,
        friendName: friend.name,
        invitedAt: Date.now(),
        expiresAt: Date.now() + 30000,
        state: BATTLE_STATES.INVITED
    };
    
    return _currentBattle;
}

function acceptBattleInvite() {
    if (_battleState !== BATTLE_STATES.INVITED || !_currentBattle) {
        return false;
    }
    
    _battleState = BATTLE_STATES.ACCEPTED;
    _currentBattle.state = BATTLE_STATES.ACCEPTED;
    
    return true;
}

function declineBattleInvite() {
    if (_battleState !== BATTLE_STATES.INVITED || !_currentBattle) {
        return false;
    }
    
    _battleState = BATTLE_STATES.DECLINED;
    _currentBattle.state = BATTLE_STATES.DECLINED;
    
    setTimeout(() => {
        resetBattle();
    }, 1000);
    
    return true;
}

function startBattle() {
    if (_battleState !== BATTLE_STATES.ACCEPTED) {
        return false;
    }
    
    _battleState = BATTLE_STATES.PLAYING;
    _currentBattle.startedAt = Date.now();
    _currentBattle.state = BATTLE_STATES.PLAYING;
    
    return true;
}

function finishBattle(result) {
    if (_battleState !== BATTLE_STATES.PLAYING) {
        return null;
    }
    
    const battleRecord = {
        id: generateBattleId(),
        friendId: _currentBattle.friendId,
        friendName: _currentBattle.friendName,
        myScore: result.myScore,
        friendScore: result.friendScore,
        won: result.myScore > result.friendScore,
        timestamp: Date.now()
    };
    
    _battleHistory.unshift(battleRecord);
    if (_battleHistory.length > 50) {
        _battleHistory = _battleHistory.slice(0, 50);
    }
    
    _saveToStorage();
    
    const friend = _friends.get(_currentBattle.friendId);
    if (friend) {
        friend.battleCount += 1;
        if (battleRecord.won) {
            friend.winCount += 1;
        }
    }
    
    _battleState = BATTLE_STATES.FINISHED;
    _currentBattle.state = BATTLE_STATES.FINISHED;
    
    setTimeout(() => {
        resetBattle();
    }, 5000);
    
    return battleRecord;
}

function resetBattle() {
    _battleState = BATTLE_STATES.IDLE;
    _currentBattle = null;
}

function getBattleState() {
    return _battleState;
}

function getCurrentBattle() {
    return _currentBattle;
}

function getBattleHistory(count = 10) {
    return _battleHistory.slice(0, count);
}

function getFriendStats(friendId) {
    const friend = _friends.get(friendId);
    if (!friend) return null;
    
    const winRate = friend.battleCount > 0 
        ? (friend.winCount / friend.battleCount * 100).toFixed(1) 
        : 0;
    
    return {
        level: friend.level,
        totalScore: friend.totalScore,
        battleCount: friend.battleCount,
        winCount: friend.winCount,
        winRate: winRate + '%'
    };
}

function updateFriendStats(friendId, stats) {
    const friend = _friends.get(friendId);
    if (!friend) return;
    
    if (stats.level) friend.level = stats.level;
    if (stats.totalScore) friend.totalScore = stats.totalScore;
    
    _saveToStorage();
}

function generateRequestId() {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

function generateBattleId() {
    return 'battle_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 后续接战斗事件总线时启用：将 BATTLE_STATES 变迁作为事件广播给 socialManager。
function _emitEvent(event, data) {
    const listeners = _eventListeners.get(event) || [];
    listeners.forEach(cb => cb(data));
}

function on(event, callback) {
    if (!_eventListeners.has(event)) {
        _eventListeners.set(event, []);
    }
    _eventListeners.get(event).push(callback);
}

function off(event, callback) {
    const listeners = _eventListeners.get(event);
    if (!listeners) return;
    
    const index = listeners.indexOf(callback);
    if (index > -1) {
        listeners.splice(index, 1);
    }
}

export function getFriendSystem() {
    if (!_instance) {
        _instance = {
            init: initFriendSystem,
            addFriend,
            removeFriend,
            getFriends,
            getFriend,
            isFriend,
            sendFriendRequest,
            respondToFriendRequest,
            getFriendRequests,
            updateOnlineState,
            inviteToBattle,
            acceptBattleInvite,
            declineBattleInvite,
            startBattle,
            finishBattle,
            getBattleState,
            getCurrentBattle,
            getBattleHistory,
            getFriendStats,
            updateFriendStats,
            resetBattle,
            on,
            off,
            FRIEND_STATES,
            ONLINE_STATES,
            BATTLE_STATES
        };
    }
    return _instance;
}

export function getFriendSystemInstance() {
    return getFriendSystem();
}