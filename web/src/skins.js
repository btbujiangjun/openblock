/**
 * 方块与盘面主题（换肤）
 * 持久化键：localStorage.openblock_skin
 */

const STORAGE_KEY = 'openblock_skin';

/** 切换主题时写入 documentElement 的可选变量（浅色主题会 remove） */
const THEME_VAR_KEYS = [
    '--text-primary',
    '--text-secondary',
    '--accent-color',
    '--accent-dark',
    '--shadow',
    '--h1-color',
    '--stat-surface',
    '--stat-label-color',
    '--select-bg',
    '--select-border'
];

const UI_DARK_BASE = {
    '--text-primary': '#e8eef4',
    '--text-secondary': '#94a3b8',
    '--accent-color': '#38bdf8',
    '--accent-dark': '#7dd3fc',
    '--shadow': 'rgba(0, 0, 0, 0.45)',
    '--h1-color': '#bae6fd',
    '--stat-surface': 'rgba(22, 28, 40, 0.88)',
    '--stat-label-color': '#94a3b8',
    '--select-bg': '#151c2c',
    '--select-border': 'rgba(148, 163, 184, 0.28)'
};

/** 与历史 COLORS 一致，供 config 导出与测试 */
export const CLASSIC_PALETTE = [
    '#70AD47', '#5B9BD5', '#ED7D31', '#FFC000',
    '#4472C4', '#9E480E', '#E74856', '#8764B8'
];

/**
 * @typedef {'glossy' | 'flat' | 'neon' | 'glass' | 'metal'} BlockDrawStyle
 * @typedef {{
 *   id: string,
 *   name: string,
 *   blockColors: string[],
 *   gridOuter: string,
 *   gridCell: string,
 *   gridLine?: string | false,
 *   gridGap: number,
 *   blockInset: number,
 *   blockRadius: number,
 *   blockStyle: BlockDrawStyle,
 *   clearFlash: string,
 *   cssBg?: string,
 *   uiDark?: boolean,
 *   cssVars?: Record<string, string>,
 * }} Skin
 */

/** @type {Record<string, Skin>} */
export const SKINS = {
    classic: {
        id: 'classic',
        name: '经典',
        blockColors: [...CLASSIC_PALETTE],
        gridOuter: '#D4DDE4',
        gridCell: '#C5D3DE',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 4,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,255,255,0.92)',
        cssBg: '#E8EEF1'
    },
    titanium: {
        id: 'titanium',
        name: '钛晶',
        blockColors: [
            '#5B8FC7', '#8B9DC9', '#6B9BD1', '#A8B8D8',
            '#7EB6D9', '#9AABC4', '#B0C4D8', '#7896B8'
        ],
        gridOuter: '#1e2430',
        gridCell: '#2a3142',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'metal',
        clearFlash: 'rgba(200, 220, 245, 0.4)',
        cssBg: '#121820',
        uiDark: true,
        cssVars: {
            '--accent-color': '#7eb8ff',
            '--accent-dark': '#a5d8ff',
            '--h1-color': '#cfe8ff'
        }
    },
    cyber: {
        id: 'cyber',
        name: '赛博',
        blockColors: [
            '#00f5d4', '#f72585', '#7209b7', '#4cc9f0',
            '#b5179e', '#4895ef', '#06ffa5', '#ff006e'
        ],
        gridOuter: '#0d0221',
        gridCell: '#160935',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'neon',
        clearFlash: 'rgba(76, 201, 240, 0.35)',
        cssBg: '#080218',
        uiDark: true,
        cssVars: {
            '--accent-color': '#4cc9f0',
            '--accent-dark': '#00f5d4',
            '--h1-color': '#f72585'
        }
    },
    aurora: {
        id: 'aurora',
        name: '极光',
        blockColors: [
            '#56d4c9', '#7c6cf0', '#a78bfa', '#34d399',
            '#22d3ee', '#818cf8', '#c084fc', '#2dd4bf'
        ],
        gridOuter: '#0c1929',
        gridCell: '#132a3f',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glass',
        clearFlash: 'rgba(167, 243, 208, 0.35)',
        cssBg: '#081420',
        uiDark: true,
        cssVars: {
            '--accent-color': '#34d399',
            '--accent-dark': '#6ee7b7',
            '--h1-color': '#a5f3fc'
        }
    },
    cosmos: {
        id: 'cosmos',
        name: '星域',
        blockColors: [
            '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6',
            '#f59e0b', '#6366f1', '#ef4444', '#22d3ee'
        ],
        gridOuter: '#050814',
        gridCell: '#0f172a',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'neon',
        clearFlash: 'rgba(147, 197, 253, 0.3)',
        cssBg: '#030712',
        uiDark: true,
        cssVars: {
            '--accent-color': '#818cf8',
            '--accent-dark': '#a5b4fc',
            '--h1-color': '#e0e7ff'
        }
    },
    frost: {
        id: 'frost',
        name: '雾霜',
        blockColors: [
            '#4f8fd4', '#6b8fd8', '#8b7fd8', '#3db89a',
            '#e6a820', '#e07aaa', '#3d9ee6', '#9b7fd8'
        ],
        gridOuter: '#94a3b8',
        gridCell: '#f8fafc',
        gridLine: 'rgba(51,65,85,0.22)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glass',
        clearFlash: 'rgba(255,255,255,0.95)',
        cssBg: '#eef2f7'
    },
    sage: {
        id: 'sage',
        name: '森雾',
        blockColors: [
            '#4d8a5e', '#6fa87a', '#3d8a6a', '#7fb88a',
            '#5cb065', '#72b882', '#2d7a62', '#8bc49a'
        ],
        gridOuter: '#a8bdb0',
        gridCell: '#f4faf6',
        gridLine: 'rgba(45,74,58,0.2)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,255,255,0.9)',
        cssBg: '#eef4f0',
        cssVars: {
            '--accent-color': '#5a9b84',
            '--accent-dark': '#3d7a5f',
            '--h1-color': '#2d5a45'
        }
    },
    midnight: {
        id: 'midnight',
        name: '午夜',
        blockColors: [
            '#2ECC71', '#3498DB', '#E67E22', '#F1C40F',
            '#5DADE2', '#E74C3C', '#9B59B6', '#1ABC9C'
        ],
        gridOuter: '#1a1d24',
        gridCell: '#252830',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'neon',
        clearFlash: 'rgba(236,240,241,0.35)',
        cssBg: '#12141a',
        uiDark: true
    },
    pastel: {
        id: 'pastel',
        name: '马卡龙',
        blockColors: [
            '#5ec9a0', '#5ab8d4', '#f0a868', '#f07870',
            '#8898d8', '#9ec86e', '#f09890', '#b888c8'
        ],
        /* 外框略深、格内更亮、网格线更清晰，直角盘面下更易数格 */
        gridOuter: '#8f867c',
        gridCell: '#faf8f5',
        gridLine: 'rgba(45, 38, 32, 0.22)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'flat',
        clearFlash: 'rgba(255,255,255,0.85)',
        /* 整体页底稍沉，衬托中间棋盘 */
        cssBg: '#e4ddd4'
    },
    retro: {
        id: 'retro',
        name: '像素',
        blockColors: [
            '#00C853', '#2962FF', '#FF6D00', '#FFD600',
            '#9575FF', '#EC407A', '#FF5252', '#E040FB'
        ],
        gridOuter: '#263238',
        gridCell: '#37474F',
        gridGap: 2,
        blockInset: 1,
        blockRadius: 0,
        blockStyle: 'flat',
        clearFlash: '#ECEFF1',
        cssBg: '#1c2529',
        uiDark: true
    }
};

export const SKIN_LIST = Object.values(SKINS);

export function getActiveSkinId() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw && SKINS[raw]) return raw;
    } catch {
        /* ignore */
    }
    return 'classic';
}

/** @returns {Skin} */
export function getActiveSkin() {
    return SKINS[getActiveSkinId()] || SKINS.classic;
}

export function getBlockColors() {
    return getActiveSkin().blockColors;
}

/**
 * @param {string} id
 * @returns {boolean} 是否成功切换
 */
export function setActiveSkinId(id) {
    if (!SKINS[id]) return false;
    try {
        localStorage.setItem(STORAGE_KEY, id);
    } catch {
        /* ignore */
    }
    applySkinToDocument(SKINS[id]);
    return true;
}

/** 将主题同步到 CSS 变量（页面背景、棋盘、HUD） */
export function applySkinToDocument(skin) {
    const root = document.documentElement;
    for (const k of THEME_VAR_KEYS) {
        root.style.removeProperty(k);
    }

    root.style.setProperty('--grid-bg', skin.gridOuter);
    root.style.setProperty('--cell-empty', skin.gridCell);
    if (skin.cssBg) {
        root.style.setProperty('--bg-color', skin.cssBg);
    }

    if (skin.uiDark) {
        const merged = { ...UI_DARK_BASE, ...(skin.cssVars || {}) };
        for (const [k, v] of Object.entries(merged)) {
            root.style.setProperty(k, v);
        }
    } else if (skin.cssVars) {
        for (const [k, v] of Object.entries(skin.cssVars)) {
            root.style.setProperty(k, v);
        }
    }
}
