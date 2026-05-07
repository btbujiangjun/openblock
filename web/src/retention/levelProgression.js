/**
 * levelProgression.js — 关卡进度与目标追踪系统
 * 
 * 管理玩家的关卡进度、星级收集、章节解锁
 * 与 goalSystem.js 集成以追踪长期目标
 */

import { LEVEL_PACK, getLevelById } from '../level/levelPack.js';

const CHAPTER_CONFIG = [
    {
        id: 'chapter_1',
        name: '新手入门',
        description: '掌握基础操作',
        levels: ['L01', 'L02', 'L03', 'L04', 'L05'],
        unlockRequirement: 0,
        icon: '🌱'
    },
    {
        id: 'chapter_2',
        name: '进阶之路',
        description: '学习策略思维',
        levels: ['L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12'],
        unlockRequirement: 5,
        icon: '📈'
    },
    {
        id: 'chapter_3',
        name: '高手挑战',
        description: '终极难度测试',
        levels: ['L13', 'L14', 'L15', 'L16', 'L17', 'L18', 'L19', 'L20'],
        unlockRequirement: 12,
        icon: '🏔️'
    }
];

let _instance = null;
let _progress = {
    currentLevel: 'L01',
    completedLevels: new Set(),
    levelStars: {},
    totalStars: 0,
    unlockedChapters: new Set(['chapter_1']),
    lastPlayedLevel: null,
    bestScores: {},
    bestClears: {},
    retryCount: {}
};

function resetToDefaults() {
    _progress = {
        currentLevel: 'L01',
        completedLevels: new Set(),
        levelStars: {},
        totalStars: 0,
        unlockedChapters: new Set(['chapter_1']),
        lastPlayedLevel: null,
        bestScores: {},
        bestClears: {},
        retryCount: {}
    };
}

function loadFromStorage() {
    resetToDefaults();
    try {
        const saved = localStorage.getItem('levelProgression');
        if (saved) {
            const parsed = JSON.parse(saved);
            _progress.currentLevel = parsed.currentLevel || 'L01';
            _progress.completedLevels = new Set(parsed.completedLevels || []);
            _progress.levelStars = parsed.levelStars || {};
            _progress.totalStars = parsed.totalStars || 0;
            _progress.unlockedChapters = new Set(parsed.unlockedChapters || ['chapter_1']);
            _progress.lastPlayedLevel = parsed.lastPlayedLevel || null;
            _progress.bestScores = parsed.bestScores || {};
            _progress.bestClears = parsed.bestClears || {};
            _progress.retryCount = parsed.retryCount || {};
        }
    } catch (e) {
        console.warn('Failed to load level progression:', e);
    }
}

function saveToStorage() {
    try {
        const toSave = {
            currentLevel: _progress.currentLevel,
            completedLevels: Array.from(_progress.completedLevels),
            levelStars: _progress.levelStars,
            totalStars: _progress.totalStars,
            unlockedChapters: Array.from(_progress.unlockedChapters),
            lastPlayedLevel: _progress.lastPlayedLevel,
            bestScores: _progress.bestScores,
            bestClears: _progress.bestClears,
            retryCount: _progress.retryCount
        };
        localStorage.setItem('levelProgression', JSON.stringify(toSave));
    } catch (e) {
        console.warn('Failed to save level progression:', e);
    }
}

function checkChapterUnlocks() {
    const completedCount = _progress.completedLevels.size;
    
    for (const chapter of CHAPTER_CONFIG) {
        if (_progress.unlockedChapters.has(chapter.id)) continue;
        
        if (completedCount >= chapter.unlockRequirement) {
            _progress.unlockedChapters.add(chapter.id);
        }
    }
}

function getNextUnlockedLevel(currentId) {
    const currentIndex = LEVEL_PACK.findIndex(l => l.id === currentId);
    if (currentIndex === -1 || currentIndex >= LEVEL_PACK.length - 1) {
        return null;
    }
    
    for (let i = currentIndex + 1; i < LEVEL_PACK.length; i++) {
        const level = LEVEL_PACK[i];
        const chapter = CHAPTER_CONFIG.find(c => c.levels.includes(level.id));
        if (chapter && _progress.unlockedChapters.has(chapter.id)) {
            return level.id;
        }
    }
    
    return null;
}

export function initLevelProgression() {
    loadFromStorage();
}

export function getLevelProgression() {
    if (!_instance) {
        _instance = {
            getCurrentLevel: () => _progress.currentLevel,
            
            startLevel: function(levelId) {
                const level = getLevelById(levelId);
                if (!level) return null;
                
                _progress.lastPlayedLevel = levelId;
                _progress.retryCount[levelId] = (_progress.retryCount[levelId] || 0) + 1;
                saveToStorage();
                
                return level;
            },
            
            completeLevel: function(levelId, result) {
                const level = getLevelById(levelId);
                if (!level) return;
                
                const previousStars = _progress.levelStars[levelId] || 0;
                const newStars = result.stars || 0;
                
                if (newStars > previousStars) {
                    _progress.levelStars[levelId] = newStars;
                    _progress.totalStars += (newStars - previousStars);
                }
                
                if (result.achieved && !_progress.completedLevels.has(levelId)) {
                    _progress.completedLevels.add(levelId);
                }
                
                if (result.score > (_progress.bestScores[levelId] || 0)) {
                    _progress.bestScores[levelId] = result.score;
                }
                
                if (result.clears > (_progress.bestClears[levelId] || 0)) {
                    _progress.bestClears[levelId] = result.clears;
                }
                
                if (result.achieved) {
                    const nextLevel = getNextUnlockedLevel(levelId);
                    if (nextLevel) {
                        _progress.currentLevel = nextLevel;
                    }
                }
                
                checkChapterUnlocks();
                saveToStorage();
                
                return {
                    stars: newStars,
                    isNewBest: newStars > previousStars,
                    completed: result.achieved,
                    nextLevel: result.achieved ? getNextUnlockedLevel(levelId) : null
                };
            },
            
            getLevelStatus: function(levelId) {
                const level = getLevelById(levelId);
                if (!level) return null;
                
                const chapter = CHAPTER_CONFIG.find(c => c.levels.includes(levelId));
                const isUnlocked = chapter 
                    ? _progress.unlockedChapters.has(chapter.id) 
                    : true;
                
                return {
                    level,
                    isUnlocked,
                    isCompleted: _progress.completedLevels.has(levelId),
                    stars: _progress.levelStars[levelId] || 0,
                    bestScore: _progress.bestScores[levelId] || 0,
                    bestClears: _progress.bestClears[levelId] || 0,
                    retryCount: _progress.retryCount[levelId] || 0
                };
            },
            
            getChapters: function() {
                return CHAPTER_CONFIG.map(chapter => {
                    const chapterLevels = chapter.levels
                        .map(id => this.getLevelStatus(id))
                        .filter(Boolean);
                    
                    const completedCount = chapterLevels.filter(l => l.isCompleted).length;
                    const totalStars = chapterLevels.reduce((sum, l) => sum + l.stars, 0);
                    const maxStars = chapterLevels.length * 3;
                    
                    return {
                        ...chapter,
                        isUnlocked: _progress.unlockedChapters.has(chapter.id),
                        completedCount,
                        totalLevels: chapter.levels.length,
                        stars: totalStars,
                        maxStars,
                        progress: completedCount / chapter.levels.length
                    };
                });
            },
            
            getSummary: function() {
                const chapters = CHAPTER_CONFIG.length;
                const completed = _progress.completedLevels.size;
                const totalLevels = LEVEL_PACK.length;
                
                return {
                    currentLevel: _progress.currentLevel,
                    completedLevels: completed,
                    totalLevels,
                    completionPercent: (completed / totalLevels) * 100,
                    totalStars: _progress.totalStars,
                    maxPossibleStars: totalLevels * 3,
                    starPercent: (_progress.totalStars / (totalLevels * 3)) * 100,
                    chaptersUnlocked: _progress.unlockedChapters.size,
                    totalChapters: chapters,
                    lastPlayedLevel: _progress.lastPlayedLevel,
                    currentChapter: CHAPTER_CONFIG.find(c => 
                        c.levels.includes(_progress.currentLevel)
                    )?.id
                };
            },
            
            isLevelUnlocked: function(levelId) {
                const status = this.getLevelStatus(levelId);
                return status?.isUnlocked ?? false;
            },
            
            getNextLevel: function() {
                return getNextUnlockedLevel(_progress.currentLevel);
            },
            
            resetProgress: function() {
                _progress = {
                    currentLevel: 'L01',
                    completedLevels: new Set(),
                    levelStars: {},
                    totalStars: 0,
                    unlockedChapters: new Set(['chapter_1']),
                    lastPlayedLevel: null,
                    bestScores: {},
                    bestClears: {},
                    retryCount: {}
                };
                saveToStorage();
            }
        };
    }
    return _instance;
}

export function getLevelProgressionInstance() {
    return getLevelProgression();
}