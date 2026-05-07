/**
 * CohortManager - 用户分组管理系统
 * 
 * 功能：
 * 1. 用户分群
 * 2. 用户属性跟踪
 * 3. 动态分组
 */
import { getApiBaseUrl, isSqliteClientDatabase } from '../config.js';

const COHORT_STORAGE_KEY = 'openblock_cohorts_v1';

/**
 * 内置分群规则
 */
export const COHORT_RULES = {
    NEW_USER: {
        id: 'new_user',
        name: '新用户',
        description: '注册 7 天内的用户',
        condition: (user) => user.daysSinceRegister <= 7
    },
    
    ACTIVE_USER: {
        id: 'active_user',
        name: '活跃用户',
        description: '7 天内登录 ≥ 3 次',
        condition: (user) => user.loginDays7 >= 3
    },
    
    WHALE: {
        id: 'whale',
        name: '鲸鱼用户',
        description: '累计消费 ≥ 100 元',
        condition: (user) => user.totalSpent >= 10000 // 分
    },
    
    DOLPHIN: {
        id: 'dolphin',
        name: '海豚用户',
        description: '累计消费 20-100 元',
        condition: (user) => user.totalSpent >= 2000 && user.totalSpent < 10000
    },
    
    MINNOW: {
        id: 'minnow',
        name: '小鱼用户',
        description: '累计消费 < 20 元或未消费',
        condition: (user) => user.totalSpent < 2000
    },
    
    HIGH_SCORE: {
        id: 'high_score',
        name: '高分玩家',
        description: '历史最高分 ≥ 1000',
        condition: (user) => user.bestScore >= 1000
    },
    
    CHURN_RISK: {
        id: 'churn_risk',
        name: '流失风险',
        description: '7 天未登录或高流失风险值',
        condition: (user) => user.daysSinceLastLogin >= 7 || user.churnRisk >= 0.6
    },
    
    TESTER: {
        id: 'tester',
        name: '测试用户',
        description: '标记为测试账号',
        condition: (user) => user.isTester === true
    }
};

class CohortManager {
    constructor() {
        this._userId = null;
        this._userProperties = {};
        this._userCohorts = new Set();
        this._cohortHistory = [];
    }

    /**
     * 初始化
     */
    init(userId) {
        this._userId = userId;
        this._loadCohortData();
        console.log('[Cohort] Initialized for user:', userId);
    }

    /**
     * 加载分群数据
     */
    _loadCohortData() {
        try {
            const stored = localStorage.getItem(COHORT_STORAGE_KEY);
            if (stored) {
                const data = JSON.parse(stored);
                this._userCohorts = new Set(data.cohorts || []);
                this._cohortHistory = data.history || [];
            }
        } catch {}
    }

    /**
     * 保存分群数据
     */
    _saveCohortData() {
        try {
            localStorage.setItem(COHORT_STORAGE_KEY, JSON.stringify({
                cohorts: Array.from(this._userCohorts),
                history: this._cohortHistory
            }));
        } catch {}
    }

    /**
     * 更新用户属性
     */
    updateUserProperties(properties) {
        this._userProperties = {
            ...this._userProperties,
            ...properties,
            lastUpdated: Date.now()
        };
        
        // 重新计算分群
        this._recalculateCohorts();
        
        return this._userCohorts;
    }

    /**
     * 从其他系统同步属性
     */
    syncFromSystem() {
        // 从 progression 获取数据
        try {
            const progress = JSON.parse(localStorage.getItem('openblock_progression_v1') || '{}');
            
            this.updateUserProperties({
                totalXp: progress.totalXp || 0,
                level: Math.floor(Math.sqrt((progress.totalXp || 0) / 100)) + 1
            });
        } catch {}
        
        // 从购买历史获取消费数据
        try {
            const purchases = JSON.parse(localStorage.getItem('openblock_mon_purchases_v1') || '{}');
            const totalSpent = Object.values(purchases)
                .reduce((sum, p) => {
                    if (p.priceNum) return sum + p.priceNum * 100;
                    return sum;
                }, 0);
            
            this.updateUserProperties({ totalSpent });
        } catch {}
        
        // 从玩家能力模型获取风险值
        try {
            const abilityModel = window.__abilityModel;
            if (abilityModel) {
                const persona = abilityModel.getPersona?.();
                if (persona) {
                    this.updateUserProperties({
                        churnRisk: persona.churnRisk || 0
                    });
                }
            }
        } catch {}
    }

    /**
     * 重新计算分群
     */
    _recalculateCohorts() {
        const newCohorts = new Set();
        
        for (const [id, rule] of Object.entries(COHORT_RULES)) {
            if (rule.condition(this._userProperties)) {
                newCohorts.add(id);
            }
        }
        
        // 检查变化
        const added = [...newCohorts].filter(c => !this._userCohorts.has(c));
        const removed = [...this._userCohorts].filter(c => !newCohorts.has(c));
        
        if (added.length > 0 || removed.length > 0) {
            this._cohortHistory.push({
                timestamp: Date.now(),
                added: Array.from(added),
                removed: Array.from(removed)
            });
            
            // 只保留最近 20 条历史
            if (this._cohortHistory.length > 20) {
                this._cohortHistory = this._cohortHistory.slice(-20);
            }
        }
        
        this._userCohorts = newCohorts;
        this._saveCohortData();
        
        console.log('[Cohort] Updated:', Array.from(this._userCohorts));
    }

    /**
     * 获取用户所属分群
     */
    getCohorts() {
        return Array.from(this._userCohorts);
    }

    /**
     * 检查用户是否属于某个分群
     */
    inCohort(cohortId) {
        return this._userCohorts.has(cohortId);
    }

    /**
     * 获取用户属性
     */
    getUserProperties() {
        return { ...this._userProperties };
    }

    /**
     * 获取分群历史
     */
    getCohortHistory() {
        return [...this._cohortHistory];
    }

    /**
     * 同步到服务端
     */
    async syncToServer() {
        if (!isSqliteClientDatabase() || !this._userId) return;
        
        try {
            const base = getApiBaseUrl().replace(/\/+$/, '');
            await fetch(`${base}/api/cohorts`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: this._userId,
                    cohorts: Array.from(this._userCohorts),
                    properties: this._userProperties
                })
            });
        } catch (e) {
            console.warn('[Cohort] Sync failed:', e);
        }
    }

    /**
     * 获取分群状态
     */
    getStatus() {
        return {
            userId: this._userId,
            cohorts: Array.from(this._userCohorts),
            properties: this._userProperties,
            historyLength: this._cohortHistory.length
        };
    }
}

let _cohortInstance = null;
export function getCohortManager() {
    if (!_cohortInstance) {
        _cohortInstance = new CohortManager();
    }
    return _cohortInstance;
}

export function initCohortManager(userId) {
    getCohortManager().init(userId);
}