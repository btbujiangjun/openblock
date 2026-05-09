/**
 * ShareCardGenerator - 战绩分享卡片生成器
 * 
 * 功能：
 * 1. Canvas 绘制分享卡片
 * 2. 支持多种模板
 * 3. 生成图片/链接
 */
// 卡片自带配色集合，独立于游戏皮肤；后续如需联动皮肤主色再 import getActiveSkin。

const CARD_WIDTH = 600;
const CARD_HEIGHT = 800;

/**
 * 卡片模板
 */
export const CARD_TEMPLATES = {
    GAME_OVER: 'game_over',
    HIGH_SCORE: 'high_score',
    ACHIEVEMENT: 'achievement',
    DAILY_STREAK: 'daily_streak'
};

/**
 * 颜色主题
 */
const THEMES = {
    default: {
        bg: '#E8EEF1',
        primary: '#5B9BD5',
        accent: '#FF6B6B',
        text: '#2C3E50',
        subtext: '#7F8C8D'
    },
    neon: {
        bg: '#0a0a1a',
        primary: '#00f0ff',
        accent: '#ff00ff',
        text: '#ffffff',
        subtext: '#8888aa'
    },
    golden: {
        bg: '#1a1510',
        primary: '#ffd700',
        accent: '#ff6b35',
        text: '#ffffff',
        subtext: '#ccaa66'
    }
};

class ShareCardGenerator {
    constructor() {
        this._canvas = null;
        this._ctx = null;
        this._theme = THEMES.default;
    }

    /**
     * 初始化 Canvas
     */
    _initCanvas() {
        if (!this._canvas) {
            this._canvas = document.createElement('canvas');
            this._canvas.width = CARD_WIDTH;
            this._canvas.height = CARD_HEIGHT;
            this._ctx = this._canvas.getContext('2d');
        }
    }

    /**
     * 设置主题
     */
    setTheme(themeName = 'default') {
        this._theme = THEMES[themeName] || THEMES.default;
    }

    /**
     * 生成游戏结束卡片
     */
    async generateGameOverCard(gameData) {
        this._initCanvas();
        const { ctx } = this;
        
        const { score, bestScore, clears, maxCombo, strategy, date } = gameData;
        /* 严格大于：等于历史最高（持平）不算"新纪录"，避免反复持平也每局发"新纪录!"卡片 */
        const isNewBest = score > bestScore && bestScore > 0;
        
        // 背景
        this._drawBackground();
        
        // 标题
        ctx.fillStyle = this._theme.text;
        ctx.font = 'bold 48px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('游戏结束', CARD_WIDTH / 2, 80);
        
        // 分数
        if (isNewBest) {
            ctx.fillStyle = this._theme.accent;
            ctx.font = 'bold 72px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText('新纪录!', CARD_WIDTH / 2, 160);
        }
        
        ctx.fillStyle = this._theme.text;
        ctx.font = 'bold 96px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(score.toLocaleString(), CARD_WIDTH / 2, 260);
        
        // 统计信息
        const stats = [
            { label: '消除次数', value: clears },
            { label: '最高Combo', value: maxCombo },
            { label: '游戏模式', value: strategy || 'Normal' }
        ];
        
        let y = 340;
        for (const stat of stats) {
            ctx.fillStyle = this._theme.subtext;
            ctx.font = '24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(stat.label, CARD_WIDTH / 2, y);
            
            ctx.fillStyle = this._theme.text;
            ctx.font = 'bold 36px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(stat.value.toString(), CARD_WIDTH / 2, y + 40);
            
            y += 90;
        }
        
        // 装饰块
        this._drawDecorBlocks(CARD_WIDTH / 2 - 120, 580, 240, 80);
        
        // 底部信息
        ctx.fillStyle = this._theme.subtext;
        ctx.font = '20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Block Blast', CARD_WIDTH / 2, 720);
        ctx.fillText(date || new Date().toLocaleDateString(), CARD_WIDTH / 2, 750);
        
        return this._canvas.toDataURL('image/png');
    }

    /**
     * 生成高分卡片
     */
    async generateHighScoreCard(gameData) {
        this._initCanvas();
        const { ctx } = this;
        
        const { score, rank, totalPlayers } = gameData;
        
        // 背景
        this._drawBackground();
        
        // 标题
        ctx.fillStyle = this._theme.accent;
        ctx.font = 'bold 56px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🎉 新纪录!', CARD_WIDTH / 2, 100);
        
        // 分数
        ctx.fillStyle = this._theme.primary;
        ctx.font = 'bold 120px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(score.toLocaleString(), CARD_WIDTH / 2, 280);
        
        // 排名
        if (rank) {
            ctx.fillStyle = this._theme.text;
            ctx.font = '32px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`全球排名 #${rank}`, CARD_WIDTH / 2, 380);
            ctx.fillStyle = this._theme.subtext;
            ctx.font = '24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            ctx.fillText(`共 ${totalPlayers} 名玩家`, CARD_WIDTH / 2, 420);
        }
        
        // 徽章
        this._drawBadge(CARD_WIDTH / 2, 520, 80);
        
        // 底部
        ctx.fillStyle = this._theme.subtext;
        ctx.font = '22px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Block Blast', CARD_WIDTH / 2, 720);
        ctx.fillText('扫码开始挑战', CARD_WIDTH / 2, 760);
        
        return this._canvas.toDataURL('image/png');
    }

    /**
     * 生成成就卡片
     */
    async generateAchievementCard(achievementData) {
        this._initCanvas();
        const { ctx } = this;
        
        const { title, description, icon, date } = achievementData;
        
        // 背景
        this._drawBackground();
        
        // 成就标题
        ctx.fillStyle = this._theme.primary;
        ctx.font = 'bold 48px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('🏆 成就解锁', CARD_WIDTH / 2, 80);
        
        // 图标
        ctx.font = '100px sans-serif';
        ctx.fillText(icon || '🏆', CARD_WIDTH / 2, 220);
        
        // 成就名称
        ctx.fillStyle = this._theme.text;
        ctx.font = 'bold 40px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(title, CARD_WIDTH / 2, 320);
        
        // 描述
        ctx.fillStyle = this._theme.subtext;
        ctx.font = '24px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(description || '', CARD_WIDTH / 2, 380);
        
        // 装饰
        this._drawDecorBlocks(CARD_WIDTH / 2 - 100, 480, 200, 60);
        
        // 日期
        ctx.fillStyle = this._theme.subtext;
        ctx.font = '20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText(date || new Date().toLocaleDateString(), CARD_WIDTH / 2, 720);
        
        return this._canvas.toDataURL('image/png');
    }

    /**
     * 绘制背景
     */
    _drawBackground() {
        const { ctx } = this;
        
        // 渐变背景
        const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
        gradient.addColorStop(0, this._theme.bg);
        gradient.addColorStop(1, this._adjustBrightness(this._theme.bg, -10));
        
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);
    }

    /**
     * 调整亮度
     */
    _adjustBrightness(hex, percent) {
        const num = parseInt(hex.replace('#', ''), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.max(0, Math.min(255, (num >> 16) + amt));
        const G = Math.max(0, Math.min(255, (num >> 8 & 0x00FF) + amt));
        const B = Math.max(0, Math.min(255, (num & 0x0000FF) + amt));
        return `#${(0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1)}`;
    }

    /**
     * 绘制装饰块
     */
    _drawDecorBlocks(x, y, width, height) {
        const { ctx } = this;
        
        ctx.fillStyle = this._theme.primary + '40';
        ctx.fillRect(x, y, width, height);
        
        ctx.fillStyle = this._theme.accent + '30';
        ctx.fillRect(x + 10, y + 10, width - 20, height - 20);
    }

    /**
     * 绘制徽章
     */
    _drawBadge(x, y, size) {
        const { ctx } = this;
        
        // 外圈
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fillStyle = this._theme.primary;
        ctx.fill();
        
        // 内圈
        ctx.beginPath();
        ctx.arc(x, y, size / 2 - 8, 0, Math.PI * 2);
        ctx.fillStyle = this._theme.bg;
        ctx.fill();
        
        // 星星
        ctx.fillStyle = this._theme.accent;
        ctx.font = `${size / 2}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('⭐', x, y);
    }

    /**
     * 生成分享链接
     */
    generateShareLink(gameData) {
        const params = new URLSearchParams({
            score: gameData.score,
            clears: gameData.clears,
            combo: gameData.maxCombo,
            date: gameData.date || new Date().toISOString().split('T')[0]
        });
        
        return `${window.location.origin}?share=${btoa(params.toString())}`;
    }

    /**
     * 从链接解析游戏数据
     */
    parseShareLink(url) {
        try {
            const urlObj = new URL(url);
            const shareParam = urlObj.searchParams.get('share');
            if (shareParam) {
                const params = new URLSearchParams(atob(shareParam));
                return {
                    score: parseInt(params.get('score') || '0'),
                    clears: parseInt(params.get('clears') || '0'),
                    combo: parseInt(params.get('combo') || '0'),
                    date: params.get('date')
                };
            }
        } catch {}
        return null;
    }

    /**
     * 导出为文件
     */
    async exportAsFile(dataUrl, filename = 'share-card.png') {
        const link = document.createElement('a');
        link.download = filename;
        link.href = dataUrl;
        link.click();
    }
}

let _instance = null;
export function getShareCardGenerator() {
    if (!_instance) {
        _instance = new ShareCardGenerator();
    }
    return _instance;
}