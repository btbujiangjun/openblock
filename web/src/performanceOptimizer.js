/**
 * PerformanceOptimizer - 前端性能优化模块
 * 
 * 功能：
 * 1. 脏区域追踪 (Dirty Rect Tracking)
 * 2. 粒子对象池 (Object Pool)
 * 3. 增量渲染调度
 */
export class PerformanceOptimizer {
    constructor() {
        this._dirtyCells = new Set();
        this._particlePool = [];
        this._maxPoolSize = 200;
        this._enabled = true;
    }

    /**
     * 标记单元格为脏（需要重绘）
     */
    markCellDirty(x, y) {
        if (!this._enabled) return;
        this._dirtyCells.add(`${x},${y}`);
    }

    /**
     * 标记区域为脏
     */
    markRegionDirty(x1, y1, x2, y2) {
        if (!this._enabled) return;
        for (let y = y1; y <= y2; y++) {
            for (let x = x1; x <= x2; x++) {
                this.markCellDirty(x, y);
            }
        }
    }

    /**
     * 标记整盘为脏
     */
    markAllDirty() {
        this._dirtyCells.clear();
        this._allDirty = true;
    }

    /**
     * 获取脏区域
     */
    getDirtyRegion() {
        if (this._allDirty || this._dirtyCells.size > 16) {
            return null; // 脏区域太大，重绘全盘
        }
        if (this._dirtyCells.size === 0) {
            return null;
        }
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const key of this._dirtyCells) {
            const [x, y] = key.split(',').map(Number);
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
    }

    /**
     * 检查特定单元格是否脏
     */
    isCellDirty(x, y) {
        return this._allDirty || this._dirtyCells.has(`${x},${y}`);
    }

    /**
     * 清空脏标记
     */
    clearDirty() {
        this._dirtyCells.clear();
        this._allDirty = false;
    }

    /**
     * 获取或创建粒子（对象池）
     */
    acquireParticle() {
        if (this._particlePool.length > 0) {
            return this._particlePool.pop();
        }
        return {};
    }

    /**
     * 回收粒子（对象池）
     */
    releaseParticle(particle) {
        if (this._particlePool.length < this._maxPoolSize) {
            // 重置粒子状态
            particle.x = 0;
            particle.y = 0;
            particle.vx = 0;
            particle.vy = 0;
            particle.color = '';
            particle.life = 0;
            particle.size = 0;
            this._particlePool.push(particle);
        }
    }

    /**
     * 批量回收粒子
     */
    releaseParticles(particles) {
        for (const p of particles) {
            this.releaseParticle(p);
        }
    }

    /**
     * 启用/禁用优化
     */
    setEnabled(enabled) {
        this._enabled = enabled;
    }

    /**
     * 获取池统计
     */
    getPoolStats() {
        return {
            poolSize: this._particlePool.length,
            maxSize: this._maxPoolSize,
            dirtyCells: this._dirtyCells.size
        };
    }
}

let _instance = null;
export function getPerformanceOptimizer() {
    if (!_instance) {
        _instance = new PerformanceOptimizer();
    }
    return _instance;
}