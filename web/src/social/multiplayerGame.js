/**
 * multiplayerGame.js — 多人游戏模式系统
 * 
 * 支持模式：
 * 1. 竞技模式 (competitive): 1v1 比分数
 * 2. 合作模式 (cooperative): 双人协作挑战
 * 3. 挑战模式 (challenge): 限时任务
 * 
 * 状态机：waiting → ready → playing → finished
 */

export const GAME_MODES = {
    COMPETITIVE: 'competitive',
    COOPERATIVE: 'cooperative',
    CHALLENGE: 'challenge'
};

export const PLAYER_STATES = {
    WAITING: 'waiting',
    READY: 'ready',
    PLAYING: 'playing',
    FINISHED: 'finished',
    DISCONNECTED: 'disconnected'
};

export const GAME_EVENTS = {
    PLAYER_JOINED: 'player_joined',
    PLAYER_LEFT: 'player_left',
    GAME_STARTED: 'game_started',
    SCORE_UPDATED: 'score_updated',
    GAME_FINISHED: 'game_finished',
    SYNC_STATE: 'sync_state'
};

// 匹配超时（保留为后续 matchmaking 时间窗预留常量）
const _MATCH_TIMEOUT = 60000;
const SYNC_INTERVAL = 2000;

let _instance = null;
let _userId = null;
let _currentMode = null;
let _players = new Map();
let _gameState = PLAYER_STATES.WAITING;
let _localScore = 0;
let _startTime = 0;
let _eventListeners = new Map();
let _syncTimer = null;

function createPlayer(id, name, isLocal = false) {
    return {
        id,
        name,
        isLocal,
        score: 0,
        clears: 0,
        state: PLAYER_STATES.WAITING,
        joinedAt: Date.now(),
        lastSync: Date.now()
    };
}

function initMultiplayer(userId) {
    _userId = userId;
    _currentMode = null;
    _players.clear();
    _gameState = PLAYER_STATES.WAITING;
    _localScore = 0;
    _startTime = 0;
    
    console.log('[Multiplayer] Initialized for user:', userId);
}

function setMode(mode) {
    if (!Object.values(GAME_MODES).includes(mode)) {
        console.error('[Multiplayer] Invalid mode:', mode);
        return false;
    }
    
    _currentMode = mode;
    _players.clear();
    _gameState = PLAYER_STATES.WAITING;
    
    const localPlayer = createPlayer(_userId, 'You', true);
    _players.set(_userId, localPlayer);
    
    console.log('[Multiplayer] Mode set to:', mode);
    emitEvent(GAME_EVENTS.PLAYER_JOINED, localPlayer);
    
    return true;
}

function joinGame(playerId, playerName) {
    if (_players.has(playerId)) {
        return _players.get(playerId);
    }
    
    const player = createPlayer(playerId, playerName, false);
    _players.set(playerId, player);
    
    emitEvent(GAME_EVENTS.PLAYER_JOINED, player);
    
    return player;
}

function leaveGame(playerId) {
    const player = _players.get(playerId);
    if (!player) return false;
    
    if (playerId === _userId) {
        resetGame();
        return true;
    }
    
    player.state = PLAYER_STATES.DISCONNECTED;
    emitEvent(GAME_EVENTS.PLAYER_LEFT, player);
    
    return true;
}

function setReady(playerId) {
    const player = _players.get(playerId);
    if (!player) return false;
    
    player.state = PLAYER_STATES.READY;
    
    const allReady = Array.from(_players.values()).every(p => 
        p.state === PLAYER_STATES.READY || p.isLocal
    );
    
    if (allReady && _players.size >= (getMinPlayers())) {
        startGame();
    }
    
    return true;
}

function startGame() {
    if (_gameState !== PLAYER_STATES.WAITING) return false;
    
    _gameState = PLAYER_STATES.PLAYING;
    _startTime = Date.now();
    _localScore = 0;
    
    for (const player of _players.values()) {
        player.state = PLAYER_STATES.PLAYING;
        player.score = 0;
        player.clears = 0;
    }
    
    startSyncTimer();
    emitEvent(GAME_EVENTS.GAME_STARTED, {
        startTime: _startTime,
        players: Array.from(_players.values())
    });
    
    return true;
}

function updateScore(score, clears) {
    const player = _players.get(_userId);
    if (!player || _gameState !== PLAYER_STATES.PLAYING) return;
    
    player.score = score;
    player.clears = clears;
    _localScore = score;
    
    emitEvent(GAME_EVENTS.SCORE_UPDATED, {
        playerId: _userId,
        score,
        clears
    });
}

function updateRemoteScore(playerId, score, clears) {
    const player = _players.get(playerId);
    if (!player) return;
    
    player.score = score;
    player.clears = clears;
    player.lastSync = Date.now();
    
    emitEvent(GAME_EVENTS.SCORE_UPDATED, {
        playerId,
        score,
        clears
    });
}

function finishGame() {
    if (_gameState !== PLAYER_STATES.PLAYING) return null;
    
    stopSyncTimer();
    _gameState = PLAYER_STATES.FINISHED;
    
    for (const player of _players.values()) {
        player.state = PLAYER_STATES.FINISHED;
    }
    
    const results = calculateResults();
    
    emitEvent(GAME_EVENTS.GAME_FINISHED, results);
    
    return results;
}

function calculateResults() {
    const players = Array.from(_players.values());
    const sortedByScore = [...players].sort((a, b) => b.score - a.score);
    
    if (_currentMode === GAME_MODES.COMPETITIVE) {
        const localPlayer = players.find(p => p.id === _userId);
        const rank = sortedByScore.findIndex(p => p.id === _userId) + 1;
        
        return {
            mode: _currentMode,
            winner: sortedByScore[0],
            rankings: sortedByScore.map((p, i) => ({ ...p, rank: i + 1 })),
            localRank: rank,
            localScore: localPlayer?.score ?? 0,
            isWinner: rank === 1
        };
    }
    
    if (_currentMode === GAME_MODES.COOPERATIVE) {
        const totalScore = players.reduce((sum, p) => sum + p.score, 0);
        const totalClears = players.reduce((sum, p) => sum + p.clears, 0);
        
        return {
            mode: _currentMode,
            totalScore,
            totalClears,
            players: players.map(p => ({
                id: p.id,
                name: p.name,
                score: p.score,
                clears: p.clears
            })),
            localScore: _localScore,
            rating: calculateCoopRating(totalScore, totalClears)
        };
    }
    
    if (_currentMode === GAME_MODES.CHALLENGE) {
        const elapsed = Date.now() - _startTime;
        
        return {
            mode: _currentMode,
            timeElapsed: elapsed,
            localScore: _localScore,
            players: players.map(p => ({
                id: p.id,
                name: p.name,
                score: p.score
            }))
        };
    }
    
    return null;
}

function calculateCoopRating(totalScore, totalClears) {
    const scoreRating = Math.min(totalScore / 5000, 1) * 50;
    const clearRating = Math.min(totalClears / 50, 1) * 50;
    
    const total = scoreRating + clearRating;
    
    if (total >= 90) return 'S';
    if (total >= 75) return 'A';
    if (total >= 60) return 'B';
    if (total >= 40) return 'C';
    return 'D';
}

function getMinPlayers() {
    return _currentMode === GAME_MODES.CHALLENGE ? 1 : 2;
}

function getMaxPlayers() {
    switch (_currentMode) {
        case GAME_MODES.COMPETITIVE: return 4;
        case GAME_MODES.COOPERATIVE: return 2;
        case GAME_MODES.CHALLENGE: return 8;
        default: return 2;
    }
}

function getGameState() {
    return _gameState;
}

function getCurrentMode() {
    return _currentMode;
}

function getPlayers() {
    return Array.from(_players.values());
}

function getLocalPlayer() {
    return _players.get(_userId);
}

function resetGame() {
    stopSyncTimer();
    _currentMode = null;
    _players.clear();
    _gameState = PLAYER_STATES.WAITING;
    _localScore = 0;
    _startTime = 0;
}

function emitEvent(event, data) {
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

function startSyncTimer() {
    stopSyncTimer();
    _syncTimer = setInterval(() => {
        const localPlayer = _players.get(_userId);
        if (localPlayer && _gameState === PLAYER_STATES.PLAYING) {
            emitEvent(GAME_EVENTS.SYNC_STATE, {
                playerId: _userId,
                score: localPlayer.score,
                clears: localPlayer.clears
            });
        }
    }, SYNC_INTERVAL);
}

function stopSyncTimer() {
    if (_syncTimer) {
        clearInterval(_syncTimer);
        _syncTimer = null;
    }
}

export function getMultiplayerGame() {
    if (!_instance) {
        _instance = {
            init: initMultiplayer,
            setMode,
            joinGame,
            leaveGame,
            setReady,
            startGame,
            updateScore,
            updateRemoteScore,
            finishGame,
            getGameState,
            getCurrentMode,
            getPlayers,
            getLocalPlayer,
            getMinPlayers,
            getMaxPlayers,
            resetGame,
            on,
            off,
            GAME_MODES,
            PLAYER_STATES,
            GAME_EVENTS
        };
    }
    return _instance;
}

export function getMultiplayerGameInstance() {
    return getMultiplayerGame();
}