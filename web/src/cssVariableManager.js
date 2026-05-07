/**
 * CSSVariableManager - CSS 变量局部更新优化
 * 
 * 避免主题切换时的全量 DOM 更新，只更新变化的变量
 */
export class CSSVariableManager {
    constructor() {
        this._pendingUpdates = new Map();
        this._updateScheduled = false;
        this._updateDelay = 16; // 一帧延迟，合并多次更新
        this._themeVariables = new Map();
        
        // 常用 CSS 变量映射
        this._varMappings = {
            'grid-cell': '--grid-cell',
            'grid-gap': '--grid-gap',
            'grid-outer': '--grid-outer',
            'block-radius': '--block-radius',
            'block-inset': '--block-inset',
            'clear-flash': '--clear-flash',
            'ui-dark': '--ui-dark',
            'primary-color': '--primary-color',
            'secondary-color': '--secondary-color',
            'bg-color': '--bg-color',
            'text-color': '--text-color'
        };
    }

    /**
     * 初始化主题变量映射
     */
    initTheme(skin) {
        if (!skin) return;
        
        // 只更新与当前皮肤不同的变量
        const updates = {};
        
        if (skin.gridCell) updates['grid-cell'] = skin.gridCell;
        if (skin.gridGap !== undefined) updates['grid-gap'] = skin.gridGap + 'px';
        if (skin.gridOuter) updates['grid-outer'] = skin.gridOuter;
        if (skin.blockRadius !== undefined) updates['block-radius'] = skin.blockRadius + 'px';
        if (skin.blockInset !== undefined) updates['block-inset'] = skin.blockInset + 'px';
        if (skin.clearFlash) updates['clear-flash'] = skin.clearFlash;
        if (skin.uiDark !== undefined) updates['ui-dark'] = skin.uiDark ? '1' : '0';
        
        this.batchUpdate(updates);
    }

    /**
     * 批量更新变量（带节流）
     */
    batchUpdate(updates) {
        for (const [key, value] of Object.entries(updates)) {
            const varName = this._varMappings[key] || `--${key}`;
            this._pendingUpdates.set(varName, value);
        }
        
        if (!this._updateScheduled) {
            this._updateScheduled = true;
            requestAnimationFrame(() => this._flushUpdates());
        }
    }

    /**
     * 立即刷新更新
     */
    flush() {
        if (this._updateScheduled) {
            this._flushUpdates();
        }
    }

    /**
     * 执行更新
     */
    _flushUpdates() {
        this._updateScheduled = false;
        
        if (this._pendingUpdates.size === 0) return;
        
        const root = document.documentElement;
        
        for (const [varName, value] of this._pendingUpdates) {
            try {
                root.style.setProperty(varName, value);
                this._themeVariables.set(varName, value);
            } catch (e) {
                console.warn('[CSSVar] Failed to set', varName, e);
            }
        }
        
        this._pendingUpdates.clear();
    }

    /**
     * 获取变量值
     */
    get(varName) {
        if (this._themeVariables.has(varName)) {
            return this._themeVariables.get(varName);
        }
        return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    }

    /**
     * 重置变量到默认值
     */
    reset() {
        const root = document.documentElement;
        for (const varName of this._themeVariables.keys()) {
            root.style.removeProperty(varName);
        }
        this._themeVariables.clear();
        this._pendingUpdates.clear();
    }

    /**
     * 批量设置皮肤变量（优化版）
     */
    applySkinVariables(skin) {
        if (!skin || typeof skin !== 'object') return;
        
        // 构建批量更新对象
        const updates = {};
        
        // 棋盘相关
        if (skin.gridCell) updates['grid-cell'] = skin.gridCell;
        if (skin.gridOuter) updates['grid-outer'] = skin.gridOuter;
        if (skin.gridGap !== undefined) updates['grid-gap'] = String(skin.gridGap);
        
        // 方块样式
        if (skin.blockRadius !== undefined) updates['block-radius'] = String(skin.blockRadius);
        if (skin.blockInset !== undefined) updates['block-inset'] = String(skin.blockInset);
        
        // 颜色相关
        if (skin.clearFlash) updates['clear-flash'] = skin.clearFlash;
        if (skin.uiDark !== undefined) updates['ui-dark'] = skin.uiDark ? '1' : '0';
        
        // 主题颜色
        if (skin.primaryColor) updates['primary-color'] = skin.primaryColor;
        if (skin.secondaryColor) updates['secondary-color'] = skin.secondaryColor;
        if (skin.bgColor) updates['bg-color'] = skin.bgColor;
        if (skin.textColor) updates['text-color'] = skin.textColor;
        
        this.batchUpdate(updates);
    }
}

let _instance = null;
export function getCSSVariableManager() {
    if (!_instance) {
        _instance = new CSSVariableManager();
    }
    return _instance;
}