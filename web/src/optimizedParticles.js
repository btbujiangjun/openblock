/**
 * OptimizedParticleSystem - 粒子系统优化版
 * 使用对象池减少 GC 压力
 */
import { getPerformanceOptimizer } from './performanceOptimizer.js';

export class OptimizedParticleSystem {
    constructor(renderer) {
        this._renderer = renderer;
        this._optimizer = getPerformanceOptimizer();
    }

    /**
     * 添加粒子（使用对象池）
     */
    addParticles(cells, opts = {}) {
        const lines = opts.lines ?? 1;
        const isPerfect = opts.perfectClear ?? false;
        const isCombo = lines >= 3;
        const isDouble = lines === 2;
        
        const { getBlockColors } = this._getColorFunc();
        const palette = getBlockColors();

        const perCell = isPerfect ? 24 : isCombo ? 17 : isDouble ? 13 : 10;
        const speed = isPerfect ? 2.55 : isCombo ? 2.0 : isDouble ? 1.6 : 1.28;
        const lifeDecay = isPerfect ? 0.0085 : isCombo ? 0.012 : isDouble ? 0.016 : 0.020;
        const baseLife = isPerfect ? 1.65 : isCombo ? 1.42 : isDouble ? 1.26 : 1.18;
        const damping = isPerfect ? 0.972 : isCombo ? 0.968 : isDouble ? 0.962 : 0.958;
        const gravityMul = isPerfect ? 0.55 : isCombo ? 0.65 : isDouble ? 0.78 : 0.9;

        const rainbowColors = ['#FF4444', '#FF8800', '#FFDD00', '#44DD44', '#4488FF', '#AA44FF'];

        for (const cell of cells) {
            const color = isPerfect
                ? rainbowColors[Math.floor(Math.random() * rainbowColors.length)]
                : (palette[cell.color] || '#FFFFFF');
            const cx = cell.x * this._renderer.cellSize + this._renderer.cellSize / 2;
            const cy = cell.y * this._renderer.cellSize + this._renderer.cellSize / 2;
            
            for (let i = 0; i < perCell; i++) {
                const ang = Math.random() * Math.PI * 2;
                const sp = (3.5 + Math.random() * 11) * speed;
                const jump = 7 + Math.random() * 9;
                
                // 从对象池获取粒子
                const p = this._optimizer.acquireParticle();
                p.x = cx;
                p.y = cy;
                p.vx = Math.cos(ang) * sp * 1.55 + (Math.random() - 0.5) * 5;
                p.vy = Math.sin(ang) * sp * 0.95 - jump;
                p.color = color;
                p.life = baseLife;
                p.lifeDecay = lifeDecay;
                p.damping = damping;
                p.gravityMul = gravityMul;
                p.size = (isCombo ? 3 : 4) + Math.random() * (isCombo ? 5 : 4);
                
                this._renderer.particles.push(p);
            }
            
            if (isCombo || isPerfect) {
                const sparkCount = isPerfect ? 10 : 6;
                for (let j = 0; j < sparkCount; j++) {
                    const p = this._optimizer.acquireParticle();
                    p.x = cx;
                    p.y = cy;
                    p.vx = (Math.random() - 0.5) * (isPerfect ? 30 : 24);
                    p.vy = (Math.random() - 0.5) * (isPerfect ? 30 : 24) - (9 + Math.random() * 7);
                    p.color = isPerfect
                        ? rainbowColors[j % rainbowColors.length]
                        : (j % 2 === 0 ? '#FFD700' : '#FFF8DC');
                    p.life = isPerfect ? 1.75 : 1.48;
                    p.lifeDecay = isPerfect ? 0.0075 : 0.010;
                    p.damping = isPerfect ? 0.974 : 0.968;
                    p.gravityMul = 0.45;
                    p.size = 2 + Math.random() * (isPerfect ? 4 : 3);
                    
                    this._renderer.particles.push(p);
                }
            }
        }
    }

    /**
     * 更新粒子（回收死亡粒子到对象池）
     */
    updateParticles() {
        const particles = this._renderer.particles;
        const deadParticles = [];
        
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            
            if (p.damping != null) {
                p.vx *= p.damping;
                p.vy *= p.damping;
            }
            p.vy += 0.35 * (p.gravityMul ?? 1);
            
            const decay = p.lifeDecay ?? 0.03;
            p.life -= decay;
            
            if (p.life <= 0) {
                deadParticles.push(particles.splice(i, 1)[0]);
            }
        }
        
        // 批量回收死亡粒子到对象池
        if (deadParticles.length > 0) {
            this._optimizer.releaseParticles(deadParticles);
        }
    }

    _getColorFunc() {
        // 延迟导入避免循环依赖
        return { getBlockColors: () => this._renderer._blockColors || {} };
    }
}