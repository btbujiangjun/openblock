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
 * @typedef {'glossy' | 'flat' | 'neon' | 'glass' | 'metal' | 'cartoon' | 'jelly' | 'pixel8'} BlockDrawStyle
 * @typedef {'sunken'} CellStyle
 * @typedef {{
 *   id: string,
 *   name: string,
 *   blockColors: string[],
 *   blockIcons?: string[],
 *   gridOuter: string,
 *   gridCell: string,
 *   gridLine?: string | false,
 *   gridGap: number,
 *   blockInset: number,
 *   blockRadius: number,
 *   blockStyle: BlockDrawStyle,
 *   cellStyle?: CellStyle,
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
        name: '✨ 经典',
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
        name: '💎 钛晶',
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
        name: '⚡ 赛博',
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
        name: '🌌 极光',
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
        name: '🌠 星域',
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
        name: '❄️ 雾霜',
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
        name: '🌿 森雾',
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
        name: '🌙 午夜',
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
        name: '🍬 马卡龙',
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
        name: '🕹️ 像素',
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
        name: '🍭 糖果',
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
        name: '🌊 深海',
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
        name: '🌅 日落',
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
        name: '🔥 熔岩',
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
        name: '🌸 樱花',
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
        name: '🧊 极地',
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
        name: '🏺 陶土',
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
        name: '🌃 霓虹都市',
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
    },

    /* ============================================================
     *  卡通 / 趣味系列（新增）
     * ============================================================ */

    /** 卡通乐园：鲜艳原色 + 柔和描边 + 小动物 icon */
    toon: {
        id: 'toon',
        name: '🎨 卡通乐园',
        blockColors: [
            '#FF3B58', '#FF7F11', '#FFD600', '#00C853',
            '#2979FF', '#AA00FF', '#FF4081', '#00BCD4'
        ],
        // 顺序对应 blockColors：红→橙→黄→绿→蓝→紫→粉→青
        blockIcons: ['🐻', '🦊', '🐥', '🐸', '🐬', '🦄', '🐱', '🐠'],
        gridOuter: '#6C4EBF',
        gridCell: '#FAFAF7',
        gridLine: 'rgba(100,70,200,0.12)',
        gridGap: 2,
        blockInset: 1,
        blockRadius: 10,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,255,130,0.90)',
        cssBg: '#F3EEFF',
        cssVars: {
            '--accent-color': '#FF3B58',
            '--accent-dark': '#C5003E',
            '--h1-color': '#7B1FA2'
        }
    },

    /** 丛林探险：热带原色 + 柔和描边 + 丛林动物 icon */
    jungle: {
        id: 'jungle',
        name: '🌴 丛林探险',
        blockColors: [
            '#43A047', '#F57F17', '#00897B', '#E53935',
            '#1565C0', '#6D4C41', '#FDD835', '#5E35B1'
        ],
        // 绿→橙→青绿→红→蓝→棕→黄→紫
        blockIcons: ['🦁', '🐯', '🐊', '🦜', '🦋', '🦧', '🐍', '🦚'],
        gridOuter: '#1B3A1E',
        gridCell: '#253D28',
        gridGap: 2,
        blockInset: 1,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(130,240,130,0.42)',
        cssBg: '#121F14',
        uiDark: true,
        cssVars: {
            '--accent-color': '#66BB6A',
            '--accent-dark': '#A5D6A7',
            '--h1-color': '#C8E6C9'
        }
    },

    /** 泡泡糖：饱和糖果色 + 果冻质感 + 海洋萌物 icon */
    bubbly: {
        id: 'bubbly',
        name: '🫧 泡泡糖',
        // 加大饱和度，避免浅色被磨砂层"洗白"
        blockColors: [
            '#FF4FA0', '#4898F8', '#42C442', '#FFAA18',
            '#22C87A', '#CC3EF0', '#FF6228', '#12C4E8'
        ],
        // 粉→蓝→绿→黄→薄荷→紫→橙→青
        blockIcons: ['🦩', '🐳', '🐢', '🦀', '🌿', '🦑', '🦐', '🐬'],
        gridOuter: '#C8A0D4',        // 柔和中紫，与其他皮肤边框色调一致
        gridCell: '#F0E2F8',         // 接近边框的淡薰衣草，对比度收敛
        gridLine: 'rgba(160,90,180,0.14)', // 极轻网格线（同 frost/pastel 风格）
        gridGap: 1,                  // 与其他浅色皮肤保持一致
        blockInset: 1,
        blockRadius: 14,
        blockStyle: 'jelly',
        clearFlash: 'rgba(255,160,240,0.82)',
        cssBg: '#F8E8FF',
        cssVars: {
            '--accent-color': '#C438CE',
            '--accent-dark': '#9920AA',
            '--h1-color': '#7010A0'
        }
    },

    /** 8位街机：NES/FC 配色 + 浮雕凸起瓦片 + 空格凹陷，复古游戏立体感 */
    pixel8: {
        id: 'pixel8',
        name: '👾 8位街机',
        blockColors: [
            '#E80050', '#005CF8', '#10C010', '#F8D000',
            '#D000C8', '#00D8D0', '#F84000', '#B0F000'
        ],
        gridOuter: '#120800',    // 极深的近黑棕，作为边框/屏幕边缘
        gridCell: '#2E1C0A',     // 比外框明显亮的深棕，空格清晰可辨
        gridLine: false,         // 由 gridGap 间距形成自然网格，不叠加线条
        gridGap: 2,              // 适中间距（原3→2），方块更整齐
        blockInset: 0,
        blockRadius: 0,
        blockStyle: 'pixel8',
        cellStyle: 'sunken',     // 空格凹陷效果，与凸起方块形成对比
        clearFlash: '#F8F8F0',
        cssBg: '#0A0500',
        uiDark: true,
        cssVars: {
            '--accent-color': '#E80050',
            '--accent-dark': '#F84000',
            '--h1-color': '#F8D000'
        }
    },

    /* ============================================================
     *  经典休闲系列（新增）
     * ============================================================ */

    /** 木纹：原木暖底 + 鲜明积木色彩，1010!/Wood Color Jam 经典风格 */
    wood: {
        id: 'wood',
        name: '🪵 木纹',
        blockColors: [
            '#D44820', '#E09828', '#48A030', '#2878C0',
            '#CC2828', '#A848B8', '#E8C030', '#28A898'
        ],
        gridOuter: '#3C1E08',
        gridCell: '#5C3012',
        gridLine: 'rgba(28,12,4,0.22)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,195,80,0.90)',
        cssBg: '#271308',
        uiDark: true,
        cssVars: {
            '--accent-color': '#D47828',
            '--accent-dark': '#E8A030',
            '--h1-color': '#F0C060'
        }
    },

    /** 锦鲤：日式锦鲤色系 + 玻璃质感，深色水面背景烘托水下漂浮感 */
    koi: {
        id: 'koi',
        name: '🎏 锦鲤',
        blockColors: [
            '#E83020', '#F07830', '#F0C030', '#18A8C8',
            '#D82888', '#68B838', '#C0B8D0', '#4850D8'
        ],
        gridOuter: '#0A2030',
        gridCell: '#142838',
        gridLine: 'rgba(20,60,100,0.35)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'glass',
        clearFlash: 'rgba(80,200,255,0.38)',
        cssBg: '#081828',
        uiDark: true,
        cssVars: {
            '--accent-color': '#18A8C8',
            '--accent-dark': '#40C8E8',
            '--h1-color': '#80D8F0'
        }
    },

    /** 温馨：Lo-Fi/Cozy 暖调混彩，柔和玻璃感，治愈系轻松氛围 */
    cozy: {
        id: 'cozy',
        name: '☕ 温馨',
        blockColors: [
            '#E08050', '#D06878', '#7C9868', '#E8C048',
            '#6888A8', '#C88860', '#A870A0', '#88B888'
        ],
        gridOuter: '#C0A888',
        gridCell: '#F5ECD8',
        gridLine: 'rgba(120,80,50,0.15)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 9,
        blockStyle: 'glass',
        clearFlash: 'rgba(255,220,160,0.88)',
        cssBg: '#EDE0CC',
        cssVars: {
            '--accent-color': '#A87850',
            '--accent-dark': '#806040',
            '--h1-color': '#604030'
        }
    },

    /** 魔幻：深紫水晶宝石色系 + 玻璃折射，暗夜奇幻氛围 */
    fantasy: {
        id: 'fantasy',
        name: '🔮 魔幻',
        blockColors: [
            '#9820E0', '#D040A8', '#4060E8', '#40D0C8',
            '#6030C0', '#E030A8', '#2090D8', '#A828F0'
        ],
        gridOuter: '#180830',
        gridCell: '#281048',
        gridLine: 'rgba(100,40,180,0.30)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glass',
        clearFlash: 'rgba(180,100,255,0.40)',
        cssBg: '#100620',
        uiDark: true,
        cssVars: {
            '--accent-color': '#9820E0',
            '--accent-dark': '#C040D8',
            '--h1-color': '#D880FF'
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
