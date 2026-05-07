/**
 * guildSystem.js — 公会/社团系统
 * 
 * 功能：
 * 1. 公会创建与管理
 * 2. 成员管理（加入、离开、升职）
 * 3. 公会任务与活动
 * 4. 公会排行榜
 * 5. 公会聊天
 */

const STORAGE_KEY = 'openblock_guild_v1';

export const GUILD_ROLES = {
    LEADER: 'leader',
    OFFICER: 'officer',
    MEMBER: 'member',
    RECRUIT: 'recruit'
};

export const GUILD_STATES = {
    NONE: 'none',
    APPLYING: 'applying',
    MEMBER: 'member'
};

export const GUILD_ACTIVITIES = {
    WEEKLY_QUEST: 'weekly_quest',
    TOURNAMENT: 'tournament',
    DONATION: 'donation',
    MEMBER_BATTLE: 'member_battle'
};

const MAX_MEMBERS = 50;
const MAX_OFFICERS = 5;

let _instance = null;
let _userId = null;
let _guild = null;
let _guildHistory = [];
let _eventListeners = new Map();

function initGuildSystem(userId) {
    _userId = userId;
    _loadFromStorage();
    console.log('[Guild] Initialized for user:', userId);
}

function _loadFromStorage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            const data = JSON.parse(stored);
            _guild = data.guild || null;
            _guildHistory = data.history || [];
        }
    } catch {}
}

function _saveToStorage() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            guild: _guild,
            history: _guildHistory
        }));
    } catch {}
}

function createGuild(name, tag, description = '') {
    if (_guild) {
        return null;
    }
    
    const guild = {
        id: generateGuildId(),
        name,
        tag: tag.toUpperCase(),
        description,
        leaderId: _userId,
        createdAt: Date.now(),
        level: 1,
        exp: 0,
        members: [{
            userId: _userId,
            name: 'You',
            role: GUILD_ROLES.LEADER,
            joinedAt: Date.now(),
            contribution: 0,
            weeklyContribution: 0,
            lastActive: Date.now()
        }],
        announcements: [],
        settings: {
            requireApproval: true,
            minLevel: 1,
            public: true
        },
        stats: {
            totalScore: 0,
            memberCount: 1,
            tournamentWins: 0,
            weeklyRank: 0
        }
    };
    
    _guild = guild;
    _saveToStorage();
    
    return guild;
}

function applyToGuild(guildId) {
    if (_guild) {
        return { success: false, reason: 'Already in a guild' };
    }
    
    return { success: true, guildId };
}

function acceptApplication(userId, userName) {
    if (!_guild || !canInvite()) {
        return false;
    }
    
    if (_guild.members.length >= MAX_MEMBERS) {
        return false;
    }
    
    const member = {
        userId,
        name: userName,
        role: GUILD_ROLES.RECRUIT,
        joinedAt: Date.now(),
        contribution: 0,
        weeklyContribution: 0,
        lastActive: Date.now()
    };
    
    _guild.members.push(member);
    _saveToStorage();
    
    emitEvent('member_joined', member);
    return true;
}

function joinGuild(guildData) {
    if (_guild) {
        return false;
    }
    
    _guild = guildData;
    _saveToStorage();
    
    return true;
}

function leaveGuild() {
    if (!_guild) {
        return false;
    }
    
    if (_guild.leaderId === _userId && _guild.members.length > 1) {
        return { success: false, reason: 'Transfer leadership first' };
    }
    
    _guild.members = _guild.members.filter(m => m.userId !== _userId);
    
    if (_guild.members.length === 0) {
        _guild = null;
    } else {
        _saveToStorage();
    }
    
    return { success: true };
}

function kickMember(userId) {
    if (!_guild || !canKick()) {
        return false;
    }
    
    const member = _guild.members.find(m => m.userId === userId);
    if (!member) return false;
    
    if (member.role === GUILD_ROLES.LEADER) {
        return false;
    }
    
    _guild.members = _guild.members.filter(m => m.userId !== userId);
    _saveToStorage();
    
    emitEvent('member_left', { userId, reason: 'kicked' });
    return true;
}

function setMemberRole(userId, role) {
    if (!_guild || !canPromote()) {
        return false;
    }
    
    const member = _guild.members.find(m => m.userId === userId);
    if (!member) return false;
    
    if (role === GUILD_ROLES.LEADER) {
        const currentLeader = _guild.members.find(m => m.role === GUILD_ROLES.LEADER);
        if (currentLeader) {
            currentLeader.role = GUILD_ROLES.MEMBER;
        }
        _guild.leaderId = userId;
    } else {
        const currentOfficers = _guild.members.filter(m => m.role === GUILD_ROLES.OFFICER).length;
        if (role === GUILD_ROLES.OFFICER && currentOfficers >= MAX_OFFICERS) {
            return false;
        }
    }
    
    member.role = role;
    _saveToStorage();
    
    emitEvent('role_changed', { userId, role });
    return true;
}

function contribute(amount) {
    if (!_guild) {
        return false;
    }
    
    const member = _guild.members.find(m => m.userId === _userId);
    if (!member) return false;
    
    member.contribution += amount;
    member.weeklyContribution += amount;
    member.lastActive = Date.now();
    
    _guild.exp += amount;
    checkLevelUp();
    _saveToStorage();
    
    return true;
}

function checkLevelUp() {
    const expToLevel = getExpForLevel(_guild.level + 1);
    if (_guild.exp >= expToLevel) {
        _guild.level += 1;
        
        emitEvent('level_up', { newLevel: _guild.level });
    }
}

function getExpForLevel(level) {
    return level * 1000 + (level - 1) * 500;
}

function postAnnouncement(content) {
    if (!_guild || !canPostAnnouncement()) {
        return false;
    }
    
    const announcement = {
        id: generateAnnouncementId(),
        content,
        authorId: _userId,
        authorName: getMyMember()?.name || 'You',
        timestamp: Date.now()
    };
    
    _guild.announcements.unshift(announcement);
    if (_guild.announcements.length > 10) {
        _guild.announcements = _guild.announcements.slice(0, 10);
    }
    
    _saveToStorage();
    emitEvent('announcement', announcement);
    
    return true;
}

function addActivity(activity) {
    if (!_guild) {
        return null;
    }
    
    const record = {
        id: generateActivityId(),
        type: activity.type,
        userId: _userId,
        userName: getMyMember()?.name || 'You',
        data: activity.data,
        timestamp: Date.now()
    };
    
    _guildHistory.unshift(record);
    if (_guildHistory.length > 100) {
        _guildHistory = _guildHistory.slice(0, 100);
    }
    
    _saveToStorage();
    return record;
}

function getGuild() {
    return _guild;
}

function getMembers() {
    return _guild?.members || [];
}

function getMyMember() {
    return _guild?.members.find(m => m.userId === _userId) || null;
}

function getMyRole() {
    return getMyMember()?.role || null;
}

function getGuildRank() {
    return _guild?.stats.weeklyRank || 0;
}

function getLeaderboard() {
    if (!_guild) return [];
    
    return [..._guild.members]
        .sort((a, b) => b.contribution - a.contribution)
        .map((m, i) => ({ ...m, rank: i + 1 }));
}

function canInvite() {
    const role = getMyRole();
    return role === GUILD_ROLES.LEADER || role === GUILD_ROLES.OFFICER;
}

function canKick() {
    const role = getMyRole();
    return role === GUILD_ROLES.LEADER || role === GUILD_ROLES.OFFICER;
}

function canPromote() {
    return getMyRole() === GUILD_ROLES.LEADER;
}

function canPostAnnouncement() {
    const role = getMyRole();
    return role === GUILD_ROLES.LEADER || role === GUILD_ROLES.OFFICER;
}

function canEditSettings() {
    return getMyRole() === GUILD_ROLES.LEADER;
}

function updateSettings(settings) {
    if (!_guild || !canEditSettings()) {
        return false;
    }
    
    _guild.settings = { ..._guild.settings, ...settings };
    _saveToStorage();
    
    return true;
}

function searchGuilds(query, limit = 10) {
    const mockGuilds = [
        { id: 'g1', name: 'Block Masters', tag: 'BM', memberCount: 25, level: 5 },
        { id: 'g2', name: 'Cube Warriors', tag: 'CW', memberCount: 18, level: 3 },
        { id: 'g3', name: 'Puzzle Legends', tag: 'PL', memberCount: 30, level: 7 }
    ];
    
    return mockGuilds
        .filter(g => g.name.toLowerCase().includes(query.toLowerCase()))
        .slice(0, limit);
}

function generateGuildId() {
    return 'guild_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

function generateAnnouncementId() {
    return 'ann_' + Date.now();
}

function generateActivityId() {
    return 'act_' + Date.now();
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

export function getGuildSystem() {
    if (!_instance) {
        _instance = {
            init: initGuildSystem,
            createGuild,
            applyToGuild,
            acceptApplication,
            joinGuild,
            leaveGuild,
            kickMember,
            setMemberRole,
            contribute,
            postAnnouncement,
            addActivity,
            getGuild,
            getMembers,
            getMyMember,
            getMyRole,
            getGuildRank,
            getLeaderboard,
            canInvite,
            canKick,
            canPromote,
            canPostAnnouncement,
            canEditSettings,
            updateSettings,
            searchGuilds,
            on,
            off,
            GUILD_ROLES,
            GUILD_STATES,
            GUILD_ACTIVITIES
        };
    }
    return _instance;
}

export function getGuildSystemInstance() {
    return getGuildSystem();
}