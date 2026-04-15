/**
 * 方块与盘面主题（换肤）
 * 持久化键：localStorage.openblock_skin
 */

const STORAGE_KEY = 'openblock_skin';

/** 首次访问或未存储时的默认主题 */
export const DEFAULT_SKIN_ID = 'titanium';

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
        gridOuter: '#D0D9E2',
        gridCell: '#E2E9F0',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,255,255,0.90)',
        cssBg: '#EDF1F5'
    },
    titanium: {
        id: 'titanium',
        name: '钛晶',
        blockColors: [
            '#6A9ED4', '#94ADCF', '#78A8DB', '#A3BDE0',
            '#88C0E0', '#7DAAD2', '#B4C8DC', '#8DA6C8'
        ],
        gridOuter: '#1a2030',
        gridCell: '#252e40',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'metal',
        clearFlash: 'rgba(200, 220, 245, 0.42)',
        cssBg: '#111820',
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
            '#00E8C8', '#F52885', '#8A3ED0', '#50CCF0',
            '#C040B0', '#5098EF', '#10F5A8', '#FF2070'
        ],
        gridOuter: '#0e0424',
        gridCell: '#18103A',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'neon',
        clearFlash: 'rgba(80, 204, 240, 0.38)',
        cssBg: '#0A0320',
        uiDark: true,
        cssVars: {
            '--accent-color': '#50CCF0',
            '--accent-dark': '#00E8C8',
            '--h1-color': '#F52885'
        }
    },
    aurora: {
        id: 'aurora',
        name: '极光',
        blockColors: [
            '#5AD8CC', '#8070F0', '#AA90FA', '#38D89E',
            '#28D8F0', '#8590F8', '#C488FC', '#35D8C0'
        ],
        gridOuter: '#0E1C30',
        gridCell: '#162E44',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glass',
        clearFlash: 'rgba(170, 245, 210, 0.38)',
        cssBg: '#0A1624',
        uiDark: true,
        cssVars: {
            '--accent-color': '#38D89E',
            '--accent-dark': '#72EAB8',
            '--h1-color': '#A8F4FC'
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
            '#5898D8', '#7098DC', '#9088DC', '#48C0A0',
            '#E8B030', '#E088B0', '#48A8E8', '#A088DC'
        ],
        gridOuter: '#98A8BC',
        gridCell: '#F6F8FC',
        gridLine: 'rgba(50, 65, 85, 0.18)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glass',
        clearFlash: 'rgba(255,255,255,0.92)',
        cssBg: '#EEF2F8'
    },
    sage: {
        id: 'sage',
        name: '森雾',
        blockColors: [
            '#58986A', '#78B088', '#489078', '#88C098',
            '#60B870', '#7CC090', '#389070', '#98CCA8'
        ],
        gridOuter: '#A8C0B0',
        gridCell: '#F2F9F5',
        gridLine: 'rgba(45, 74, 58, 0.16)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,255,255,0.90)',
        cssBg: '#ECF4EE',
        cssVars: {
            '--accent-color': '#60A088',
            '--accent-dark': '#408868',
            '--h1-color': '#306050'
        }
    },
    midnight: {
        id: 'midnight',
        name: '午夜',
        blockColors: [
            '#34D47A', '#3CA0E0', '#E88828', '#F4CC18',
            '#60B4E8', '#EC5040', '#A460C0', '#20C8A0'
        ],
        gridOuter: '#1C2028',
        gridCell: '#282C36',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'neon',
        clearFlash: 'rgba(240, 244, 248, 0.38)',
        cssBg: '#14161E',
        uiDark: true
    },
    pastel: {
        id: 'pastel',
        name: '马卡龙',
        blockColors: [
            '#6AD4A8', '#62C0DC', '#F0B070', '#F08078',
            '#90A0E0', '#A8D078', '#F0A098', '#C090D0'
        ],
        gridOuter: '#A8A098',
        gridCell: '#FAF8F6',
        gridLine: 'rgba(60, 50, 40, 0.16)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'flat',
        clearFlash: 'rgba(255,255,255,0.88)',
        cssBg: '#F0EBE4'
    },
    retro: {
        id: 'retro',
        name: '像素',
        blockColors: [
            '#08D060', '#3068FF', '#FF7808', '#FFD800',
            '#9880FF', '#F04880', '#FF5858', '#E448FF'
        ],
        gridOuter: '#2A363E',
        gridCell: '#3A4A54',
        gridGap: 2,
        blockInset: 1,
        blockRadius: 0,
        blockStyle: 'flat',
        clearFlash: '#EEF2F4',
        cssBg: '#1E2830',
        uiDark: true
    },
    candy: {
        id: 'candy',
        name: '糖果',
        blockColors: [
            '#FF6B8A', '#FFA64D', '#FFD84D', '#7ED87E',
            '#5CB8FF', '#C47DFF', '#FF85B3', '#50E0C0'
        ],
        gridOuter: '#E8D0C8',
        gridCell: '#FFF8F4',
        gridLine: 'rgba(180, 140, 120, 0.18)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255, 240, 245, 0.92)',
        cssBg: '#FFF0EC',
        cssVars: {
            '--accent-color': '#FF6B8A',
            '--accent-dark': '#E05070',
            '--h1-color': '#D04870'
        }
    },
    ocean: {
        id: 'ocean',
        name: '深海',
        blockColors: [
            '#00B4D8', '#0090B0', '#48CAE4', '#90E0EF',
            '#00D4AA', '#FFB347', '#FF6B6B', '#ADE8F4'
        ],
        gridOuter: '#0A2A3C',
        gridCell: '#143848',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glass',
        clearFlash: 'rgba(144, 224, 239, 0.35)',
        cssBg: '#081E2C',
        uiDark: true,
        cssVars: {
            '--accent-color': '#48CAE4',
            '--accent-dark': '#90E0EF',
            '--h1-color': '#ADE8F4'
        }
    },
    sunset: {
        id: 'sunset',
        name: '日落',
        blockColors: [
            '#FF6F61', '#FF9A56', '#FFCC5C', '#88D8B0',
            '#6C8EBF', '#C47ACA', '#FF8FA0', '#FFA86A'
        ],
        gridOuter: '#2C1B30',
        gridCell: '#3A2840',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255, 200, 150, 0.40)',
        cssBg: '#201424',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF9A56',
            '--accent-dark': '#FFCC5C',
            '--h1-color': '#FFDAB9'
        }
    },
    lava: {
        id: 'lava',
        name: '熔岩',
        blockColors: [
            '#FF4040', '#FF6830', '#FF9020', '#FFB818',
            '#E05040', '#D03060', '#FF7848', '#FFA030'
        ],
        gridOuter: '#1A0C08',
        gridCell: '#2C1810',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 4,
        blockStyle: 'metal',
        clearFlash: 'rgba(255, 180, 80, 0.40)',
        cssBg: '#120808',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF6830',
            '--accent-dark': '#FFB818',
            '--h1-color': '#FFD0A0'
        }
    },
    sakura: {
        id: 'sakura',
        name: '樱花',
        blockColors: [
            '#F8A0B8', '#E88098', '#F0C0D0', '#B8D8A8',
            '#A0C8E8', '#D0A0E0', '#F0B0C8', '#C8E0B0'
        ],
        gridOuter: '#C8B0B8',
        gridCell: '#FFF4F8',
        gridLine: 'rgba(180, 100, 130, 0.14)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'glass',
        clearFlash: 'rgba(255, 230, 240, 0.90)',
        cssBg: '#F8EEF2',
        cssVars: {
            '--accent-color': '#E88098',
            '--accent-dark': '#D06080',
            '--h1-color': '#C05878'
        }
    },
    arctic: {
        id: 'arctic',
        name: '极地',
        blockColors: [
            '#60C8FF', '#80A8FF', '#A0D8F8', '#40E0D0',
            '#70B0FF', '#98C8FF', '#50D0E8', '#B0E0F8'
        ],
        gridOuter: '#101828',
        gridCell: '#1A2838',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'glass',
        clearFlash: 'rgba(160, 216, 248, 0.35)',
        cssBg: '#0C1420',
        uiDark: true,
        cssVars: {
            '--accent-color': '#60C8FF',
            '--accent-dark': '#A0D8F8',
            '--h1-color': '#D0ECFF'
        }
    },
    terra: {
        id: 'terra',
        name: '陶土',
        blockColors: [
            '#C87850', '#D4986C', '#B06840', '#D8B090',
            '#A88060', '#C09070', '#E0A878', '#B89878'
        ],
        gridOuter: '#8C7868',
        gridCell: '#F8F0E8',
        gridLine: 'rgba(100, 70, 50, 0.16)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'flat',
        clearFlash: 'rgba(255, 248, 230, 0.88)',
        cssBg: '#EDE4D8',
        cssVars: {
            '--accent-color': '#C87850',
            '--accent-dark': '#A06038',
            '--h1-color': '#784830'
        }
    },
    neonCity: {
        id: 'neonCity',
        name: '霓虹都市',
        blockColors: [
            '#FF2DAA', '#7C4DFF', '#00E5FF', '#76FF03',
            '#FFAB40', '#FF4081', '#448AFF', '#18FFFF'
        ],
        gridOuter: '#0B0F1A',
        gridCell: '#151C2E',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'neon',
        clearFlash: 'rgba(0, 229, 255, 0.35)',
        cssBg: '#080C16',
        uiDark: true,
        cssVars: {
            '--accent-color': '#00E5FF',
            '--accent-dark': '#76FF03',
            '--h1-color': '#FF2DAA'
        }
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
    return DEFAULT_SKIN_ID;
}

/** @returns {Skin} */
export function getActiveSkin() {
    return SKINS[getActiveSkinId()] || SKINS[DEFAULT_SKIN_ID];
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

    /* 字标像素格与 canvas 方块：同源 blockInset / blockRadius / gridGap / blockStyle */
    const wmRef = 40;
    root.style.setProperty('--skin-wm-inset-frac', String(skin.blockInset / wmRef));
    root.style.setProperty('--skin-wm-radius-frac', String(skin.blockRadius / wmRef));
    root.style.setProperty('--skin-wm-gridgap-frac', String((2 * skin.blockInset + (skin.gridGap ?? 1)) / wmRef));
    root.dataset.skinBlockStyle = skin.blockStyle;

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
