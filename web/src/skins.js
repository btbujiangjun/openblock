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
 * @typedef {{ icons: string[], opacity?: number, scale?: number }} BoardWatermark
 * @typedef {{
 *   id: string,
 *   name: string,
 *   blockColors: string[],
 *   blockIcons?: string[],
 *   boardWatermark?: BoardWatermark,
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

/**
 * 皮肤总量：15 款
 * 盘面设计基准：参考 neonCity —— gridOuter（极深）+ gridCell（深色可见空格）
 * 方块须与 gridCell 形成明显明度/色相反差。
 *
 * 合并历史：
 *   cosmos  → cyber        frost / arctic → aurora
 *   midnight→ neonCity     pastel         → candy
 *   retro   → pixel8       jungle         → toon
 *   sage / terra / wood / cozy             → 移除
 */
/** @type {Record<string, Skin>} */
export const SKINS = {

    /* ══════════════════════════════════════════
     *  基础 / 经典
     * ══════════════════════════════════════════ */

    /** 经典：高饱和积木配色，深色中性盘面突显鲜亮方块 */
    classic: {
        id: 'classic',
        name: '✨ 极简经典',
        boardWatermark: { icons: ['🎮', '⭐'], opacity: 0.07 },
        blockColors: [
            '#80D455', '#5BB8F8', '#FF9840', '#FFD820',
            '#80A8FF', '#FF7868', '#FF98C0', '#C8A8FF'
        ],
        gridOuter: '#1C2630',
        gridCell:  '#2E3E50',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'glossy',
        clearFlash: 'rgba(220,240,255,0.90)',
        cssBg: '#141C24',
        uiDark: true,
        cssVars: {
            '--accent-color': '#5BB8F8',
            '--accent-dark':  '#80D455',
            '--h1-color':     '#C0E0FF'
        }
    },

    /** 钛晶：蓝灰金属质感，极深冷色盘面烘托金属光泽 */
    titanium: {
        id: 'titanium',
        name: '💎 钛晶矩阵',
        boardWatermark: { icons: ['💠', '🔷'], opacity: 0.07 },
        blockColors: [
            '#6AAEE8', '#94BDDF', '#78B8EB', '#A8CCF0',
            '#88D0F0', '#7DBAE2', '#B4D8EC', '#8DB6D8'
        ],
        gridOuter: '#0A1020',
        gridCell:  '#182030',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'metal',
        clearFlash: 'rgba(200,220,245,0.42)',
        cssBg: '#080C18',
        uiDark: true,
        cssVars: {
            '--accent-color': '#7eb8ff',
            '--accent-dark':  '#a5d8ff',
            '--h1-color':     '#cfe8ff'
        }
    },

    /* ══════════════════════════════════════════
     *  暗色科技
     * ══════════════════════════════════════════ */

    /** 赛博（整合星域）：高压电光 + 宇宙粒子，极暗底色 */
    cyber: {
        id: 'cyber',
        name: '⚡ 赛博朋克',
        boardWatermark: { icons: ['⚡', '💻'], opacity: 0.08 },
        blockColors: [
            '#00E8C8', '#F52885', '#B060F0', '#50CCF0',
            '#3B82F6', '#EC4899', '#10F5A8', '#FF2070'
        ],
        gridOuter: '#060214',
        gridCell:  '#0C0826',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'neon',
        clearFlash: 'rgba(80,204,240,0.38)',
        cssBg: '#04010E',
        uiDark: true,
        cssVars: {
            '--accent-color': '#50CCF0',
            '--accent-dark':  '#00E8C8',
            '--h1-color':     '#F52885'
        }
    },

    /** 极光（整合极地）：冰川极光玻璃感，深海蓝底 */
    aurora: {
        id: 'aurora',
        name: '🌌 冰川极光',
        boardWatermark: { icons: ['🐧', '🐻‍❄️', '❄️', '🌌'], opacity: 0.08 },
        // 极地动物 + 冰雪天象（专属：❄️🌌🏔️ + 🐻‍❄️🦌🐧🐋🦭，移除通用 🦊🐟🦅）
        // 蓝鲸放浅紫底，雪花落绿底，星河压亮青底，雪山落天蓝底——色相全对冲
        blockIcons: ['🦌', '🐧', '🐋', '❄️', '🌌', '🐻‍❄️', '🦭', '🏔️'],
        blockColors: [
            '#5AD8CC', '#8070F0', '#AA90FA', '#38D89E',
            '#28D8F0', '#8590F8', '#C488FC', '#60C8FF'
        ],
        gridOuter: '#04101C',
        gridCell:  '#0C1C2E',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glass',
        clearFlash: 'rgba(170,245,210,0.38)',
        cssBg: '#020C18',
        uiDark: true,
        cssVars: {
            '--accent-color': '#38D89E',
            '--accent-dark':  '#72EAB8',
            '--h1-color':     '#A8F4FC'
        }
    },

    /** 霓虹都市（整合午夜，盘面基准参考款）：RGB 霓虹灯光压近黑底 */
    neonCity: {
        id: 'neonCity',
        name: '🌃 霓虹都市',
        boardWatermark: { icons: ['🌃', '🏙️'], opacity: 0.07 },
        blockColors: [
            '#FF2DAA', '#9B72FF', '#00E5FF', '#76FF03',
            '#FFAB40', '#FF4081', '#448AFF', '#18FFFF'
        ],
        gridOuter: '#0B0F1A',
        gridCell:  '#151C2E',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'neon',
        clearFlash: 'rgba(0,229,255,0.35)',
        cssBg: '#080C16',
        uiDark: true,
        cssVars: {
            '--accent-color': '#00E5FF',
            '--accent-dark':  '#76FF03',
            '--h1-color':     '#FF2DAA'
        }
    },

    /* ══════════════════════════════════════════
     *  自然元素
     * ══════════════════════════════════════════ */

    /** 深海：珊瑚 / 荧光鱼 / 海水青，深渊暗底 */
    ocean: {
        id: 'ocean',
        name: '🌊 深海幽域',
        boardWatermark: { icons: ['🦈', '🐠'], opacity: 0.07 },
        // 深海生物 + 珊瑚贝壳：🐙章鱼 / 🦞龙虾 / 🐡河豚 / 🪸珊瑚 / 🐚海螺 / 🐳蓝鲸 / 🦈鲨鱼 / 🦑鱿鱼
        // 移除通用 🐠🦭，专属深海符号（🪸珊瑚 / 🐚海螺）独占；蓝鲸/鲨鱼放暖块（橙/红）反差最强
        blockIcons: ['🐙', '🦞', '🐡', '🪸', '🐚', '🐳', '🦈', '🦑'],
        blockColors: [
            '#00C8F0', '#0098C8', '#48D4E4', '#90F0FF',
            '#00E4C0', '#FFB347', '#FF7878', '#20E8FF'
        ],
        gridOuter: '#040E18',
        gridCell:  '#081C28',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glass',
        clearFlash: 'rgba(144,224,239,0.35)',
        cssBg: '#020A14',
        uiDark: true,
        cssVars: {
            '--accent-color': '#48CAE4',
            '--accent-dark':  '#90E0EF',
            '--h1-color':     '#ADE8F4'
        }
    },

    /** 日落：黄金 / 橙红 / 玫瑰紫暖色系，暮光深紫底 */
    sunset: {
        id: 'sunset',
        name: '🌅 暮色日落',
        boardWatermark: { icons: ['🌅', '☀️'], opacity: 0.08 },
        blockColors: [
            '#FF7761', '#FF9A56', '#FFCC5C', '#88D8B0',
            '#8098CF', '#D478CA', '#FF8FA0', '#FFB870'
        ],
        gridOuter: '#160A14',
        gridCell:  '#261424',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,200,150,0.40)',
        cssBg: '#0E0610',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF9A56',
            '--accent-dark':  '#FFCC5C',
            '--h1-color':     '#FFDAB9'
        }
    },

    /** 熔岩：火红 / 橙黄熔浆，焦炭暗底（改 glossy 更贴近流体感） */
    lava: {
        id: 'lava',
        name: '🔥 熔岩炽焰',
        boardWatermark: { icons: ['🌋', '🔥'], opacity: 0.07 },
        blockColors: [
            '#FF4040', '#FF6830', '#FF9020', '#FFB818',
            '#E84040', '#FF3868', '#FF7848', '#FFA830'
        ],
        gridOuter: '#0E0604',
        gridCell:  '#1E0C08',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 4,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,180,80,0.40)',
        cssBg: '#080402',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF6830',
            '--accent-dark':  '#FFB818',
            '--h1-color':     '#FFD0A0'
        }
    },

    /* ══════════════════════════════════════════
     *  日系美学
     * ══════════════════════════════════════════ */

    /** 樱花：夜樱场景——深红黑夜底，粉红/翠绿/金黄方块如花瓣飘落 */
    sakura: {
        id: 'sakura',
        name: '🌸 樱花飞雪',
        boardWatermark: { icons: ['🌸', '🌺'], opacity: 0.09 },
        blockColors: [
            '#FF4490', '#FF2870', '#FFB0D8', '#78D860',
            '#78B8F0', '#CC60E8', '#FFBA30', '#58D890'
        ],
        gridOuter: '#180810',
        gridCell:  '#280C1C',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'glass',
        clearFlash: 'rgba(255,180,220,0.50)',
        cssBg: '#100608',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF4490',
            '--accent-dark':  '#FF80C0',
            '--h1-color':     '#FFBAD8'
        }
    },

    /** 锦鲤：朱红/金黄/橙橘/樱粉等锦鲤体色，银白替换近黑块，深水底 */
    koi: {
        id: 'koi',
        name: '🎏 锦鲤跃龙',
        boardWatermark: { icons: ['🎏', '🐟'], opacity: 0.08 },
        // 锦鲤池 + 日式风物：🎏鲤鱼旗 / 🎋七夕竹 / 🌊浪涌 / 🪷莲花 / ⛩️鸟居 /
        //                  🏮红灯笼 / 🎐风铃 / 🐟池中鲤
        // 移除与深海重复的 🦈🐡🐙🐠，全部换成日本意象专属 emoji
        // 蓝浪/蓝鲤放暖红底，红鸟居/红灯笼放蓝青底，全互补色
        blockIcons: ['🎋', '🌊', '🪷', '⛩️', '🐟', '🏮', '🎐', '🎏'],
        blockColors: [
            '#FF5040', '#F07828', '#F0C820', '#3A9EC8',
            '#E880A8', '#38A8B8', '#F05888', '#D0A858'
        ],
        gridOuter: '#040E18',
        gridCell:  '#081C2C',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 9,
        blockStyle: 'glass',
        clearFlash: 'rgba(80,200,255,0.38)',
        cssBg: '#020A14',
        uiDark: true,
        cssVars: {
            '--accent-color': '#38A8B8',
            '--accent-dark':  '#60C8D8',
            '--h1-color':     '#90DDF0'
        }
    },

    /* ══════════════════════════════════════════
     *  休闲甜系
     * ══════════════════════════════════════════ */

    /** 糖果（整合马卡龙）：超饱和纯色糖块，深浆果夜底凸显甜味 */
    candy: {
        id: 'candy',
        name: '🍭 糖果甜心',
        boardWatermark: { icons: ['🍭', '🍬'], opacity: 0.09 },
        // 纯糖果甜点（移除与 food 重复的 🍦、与 fairy 重复的 🌈）
        // 加入 🍪饼干、🍩甜甜圈，全部专属糖果系；棕色甜点压亮黄/红底，彩色棒糖压粉紫底
        blockIcons: ['🍪', '🎀', '🍫', '🍰', '🍩', '🍬', '🍭', '🧁'],
        blockColors: [
            '#FF4466', '#FF8820', '#FFD020', '#44E848',
            '#22AAFF', '#CC66FF', '#FF44BB', '#22E8CC'
        ],
        gridOuter: '#1A0828',
        gridCell:  '#280E40',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,200,255,0.88)',
        cssBg: '#120420',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF44BB',
            '--accent-dark':  '#CC2288',
            '--h1-color':     '#FFB8E8'
        }
    },

    /** 泡泡糖：Q 弹果冻海洋生物，深紫底衬托高饱和果冻色 */
    bubbly: {
        id: 'bubbly',
        name: '🫧 元气泡泡',
        boardWatermark: { icons: ['🫧', '🐡'], opacity: 0.09 },
        blockColors: [
            '#FF72BB', '#4898F8', '#42C442', '#FFAA18',
            '#22C87A', '#E060FF', '#FF8848', '#12C4E8'
        ],
        // 萌系水族 + 果冻气泡：🪼水母 / 🫧气泡（果冻泡泡的视觉签名，专属）
        // 移除与 ocean 重复的 🐳🦑，让 bubbly 与 ocean 视觉错位（萌 vs 深邃）
        // 海豚↔粉、火烈鸟↔蓝、水母↔绿、海草↔橙，全互补色对配
        blockIcons: ['🐬', '🦩', '🪼', '🌿', '🦀', '🐢', '🫧', '🦐'],
        gridOuter: '#2A1048',
        gridCell:  '#401870',
        gridGap: 1,
        blockInset: 1,
        blockRadius: 14,
        blockStyle: 'jelly',
        clearFlash: 'rgba(255,160,240,0.82)',
        cssBg: '#1C0838',
        uiDark: true,
        cssVars: {
            '--accent-color': '#CC3EF0',
            '--accent-dark':  '#9920AA',
            '--h1-color':     '#DD80FF'
        }
    },

    /* ══════════════════════════════════════════
     *  卡通 / 复古
     * ══════════════════════════════════════════ */

    /** 卡通乐园（整合丛林）：原色积木 + 混合萌物图标，深漫画紫底 */
    toon: {
        id: 'toon',
        name: '🎨 卡通乐园',
        boardWatermark: { icons: ['🎪', '🎠'], opacity: 0.08 },
        blockColors: [
            '#FF5570', '#FF7F11', '#FFD600', '#00C853',
            '#5590FF', '#DD60FF', '#FF6098', '#00BCD4'
        ],
        // 卡通动物园：🐼熊猫 / 🐨考拉 / 🐘大象 / 🦒长颈鹿 / 🦛河马 / 🦔刺猬 /
        //              🦘袋鼠 / 🦄独角兽
        // 全部为非洲/澳洲/亚洲动物园明星，与 beast(猛兽)、pets(家宠) 完全错开
        // 黑白熊猫压粉底、灰象压亮黄底、长颈鹿黄斑放绿底，全部明度/色相强反差
        blockIcons: ['🐼', '🐨', '🐘', '🦒', '🦛', '🦔', '🦘', '🦄'],
        gridOuter: '#2A1860',
        gridCell:  '#3A2478',
        gridGap: 2,
        blockInset: 1,
        blockRadius: 10,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,255,130,0.90)',
        cssBg: '#1A1040',
        uiDark: true,
        cssVars: {
            '--accent-color': '#AA00FF',
            '--accent-dark':  '#DD40FF',
            '--h1-color':     '#E880FF'
        }
    },

    /** 街机（魂斗罗/经典动作）：NES/SNK 鲜艳配色 + glossy 方块 + 街机/格斗/平台跳跃意象 icon */
    pixel8: {
        id: 'pixel8',
        name: '🕹️ 街机格斗',
        boardWatermark: { icons: ['🕹️', '👾', '🍄', '🥊'], opacity: 0.10, scale: 0.72 },
        // 街机·8-bit·格斗：💣炸弹 / 🪙金币 / 🥊拳套 / 🎮手柄 / 👊重拳 / 🍄蘑菇 /
        //                  🕹️摇杆 / 👾外星人
        // 移除与 greece 撞色的 ⚡（雷电意象更属希腊神话），加入 💣🪙 强化「街机经典符号」
        // 暗色 icon（🎮🕹️💣👾）压亮黄/橙/品红底，金币放蓝底，蘑菇放青底
        blockIcons: ['💣', '🪙', '🥊', '🎮', '👊', '🍄', '🕹️', '👾'],
        blockColors: [
            '#FF2050', '#1E78FF', '#00C030', '#F8C000',
            '#CC00CC', '#00B8C8', '#FF5800', '#90E000'
        ],
        gridOuter: '#0D0400',
        gridCell:  '#1E1008',
        gridGap: 1,
        blockInset: 2,
        blockStyle: 'glossy',
        blockRadius: 4,
        clearFlash: '#FFFFF0',
        cssBg: '#080200',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF2050',
            '--accent-dark':  '#FF6020',
            '--h1-color':     '#F8C000'
        }
    },

    /* ══════════════════════════════════════════
     *  浅色系（与暗色形成互补，保留自然光感）
     * ══════════════════════════════════════════ */

    /**
     * 晨光：暖奶油盘面 + 高饱和冷暖交替积木，晨间自然光感。
     * 浅底设计：gridOuter 作暖金色边框，gridCell 象牙白空格，
     * 鲜艳方块在浅底上形成足够明度反差。
     */
    dawn: {
        id: 'dawn',
        name: '☀️ 晨光微曦',
        boardWatermark: { icons: ['☀️', '🌤️'], opacity: 0.09 },
        // 浅色盘面需用深色方块（深度饱和色，WCAG对比 ≥4.5）
        blockColors: [
            '#B02000', '#0050C0', '#A85800', '#187030',
            '#8010B0', '#006868', '#C01040', '#4020C8'
        ],
        gridOuter: '#8A7040',
        gridCell:  '#F8F0E0',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,235,180,0.90)',
        cssBg: '#F0E8D4',
        cssVars: {
            '--text-primary':     '#1E1810',
            '--text-secondary':   '#5C4830',
            '--accent-color':     '#C05820',
            '--accent-dark':      '#904010',
            '--shadow':           'rgba(0,0,0,0.14)',
            '--h1-color':         '#6A3818',
            '--stat-surface':     'rgba(255,248,232,0.92)',
            '--stat-label-color': '#7A6040',
            '--select-bg':        '#FFF4E4',
            '--select-border':    'rgba(160,120,60,0.25)'
        }
    },

    /**
     * 马卡龙：哑光平涂 + 暖白盘面，饱和甜点色提升可读性。
     * 保留经典 pastel 风格，修正低对比问题。
     */
    macaroon: {
        id: 'macaroon',
        name: '🍬 法式马卡',
        boardWatermark: { icons: ['🍬', '🧁'], opacity: 0.09 },
        // 浅色盘面需用深色方块（深度饱和色，WCAG对比 ≥4.5）
        blockColors: [
            '#C01860', '#0058C0', '#B06000', '#1A7830',
            '#8020C0', '#007860', '#C02020', '#5828B0'
        ],
        gridOuter: '#A09088',
        gridCell:  '#FAF6F0',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'flat',
        clearFlash: 'rgba(255,240,255,0.90)',
        cssBg: '#F2EDE4',
        cssVars: {
            '--text-primary':     '#1E1818',
            '--text-secondary':   '#5C4848',
            '--accent-color':     '#C04878',
            '--accent-dark':      '#A03060',
            '--shadow':           'rgba(0,0,0,0.12)',
            '--h1-color':         '#8A3060',
            '--stat-surface':     'rgba(255,250,248,0.92)',
            '--stat-label-color': '#7A5060',
            '--select-bg':        '#FFF4F6',
            '--select-border':    'rgba(180,120,140,0.25)'
        }
    },

    /* ══════════════════════════════════════════
     *  Icon 主题系列（方块 icon 为首要标识）
     * ══════════════════════════════════════════ */

    /**
     * 美食：食材原色方块 + 美食 emoji，暗系料理底映衬色泽。
     * 参考 1010! Food DLC 的"色块即食材"设计语言。
     */
    food: {
        id: 'food',
        name: '🍕 美食盛宴',
        boardWatermark: { icons: ['🍕', '🍔'], opacity: 0.08 },
        blockColors: [
            '#FF5040', '#F09020', '#F8D020', '#60B830',
            '#E09050', '#D87040', '#F05878', '#C068F0'
        ],
        // 各国主食料理（与 candy 甜点完全错开，移除 🍩🎂🍦 三件甜点）
        // 🥑（轻食 / 牛油果吐司）/ 🍣寿司 / 🍞面包 / 🍕披萨 / 🌮塔可 / 🍔汉堡 /
        // 🥩牛排 / 🍜拉面 — 八国主食轮转
        // 🥑绿底放红块、披萨红底放绿块、寿司粉白放橙底，色相全互补
        blockIcons: ['🥑', '🍣', '🍞', '🍕', '🌮', '🍔', '🥩', '🍜'],
        gridOuter: '#18100A',
        gridCell:  '#281808',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,200,100,0.88)',
        cssBg: '#100A04',
        uiDark: true,
        cssVars: {
            '--accent-color': '#F09020',
            '--accent-dark':  '#F8D020',
            '--h1-color':     '#FFD8A0'
        }
    },

    /**
     * 音乐节：舞台追光色 + 乐器 emoji，极暗演出场底色。
     * Neon 渲染模拟聚光灯质感。
     */
    music: {
        id: 'music',
        name: '🎵 音乐律动',
        boardWatermark: { icons: ['🎵', '🎸'], opacity: 0.08 },
        blockColors: [
            '#FF3060', '#FF9020', '#FFE820', '#40E840',
            '#3088FF', '#E040FF', '#FF60A0', '#40E8E8'
        ],
        // 八件乐器主题专属（无任何与其它皮肤重复）：🎤话筒/🎹钢琴/🎧耳机/🎺小号/
        // 🥁架子鼓/🎸吉他/🎷萨克斯/🎻小提琴
        // 暗色乐器（🎤🎹🎧）压亮黄/橙底；亮金乐器（🎺🎷）放绿/粉冷底，强反差
        blockIcons: ['🎤', '🎹', '🎧', '🎺', '🥁', '🎸', '🎷', '🎻'],
        gridOuter: '#100818',
        gridCell:  '#1C0C28',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'neon',
        clearFlash: 'rgba(255,100,200,0.40)',
        cssBg: '#08040F',
        uiDark: true,
        cssVars: {
            '--accent-color': '#E040FF',
            '--accent-dark':  '#FF3060',
            '--h1-color':     '#FF80D0'
        }
    },

    /**
     * 萌宠：卡通风格 + 宠物 emoji，浅暖奶油盘面（浅色系 icon 主题）。
     * 与丛林/卡通乐园区别：家养萌宠 + 浅色背景，更治愈柔和。
     */
    pets: {
        id: 'pets',
        name: '🐾 萌宠天地',
        boardWatermark: { icons: ['🐾', '🐶'], opacity: 0.09 },
        // 浅色盘面需用深色方块（深度饱和色，WCAG对比 ≥4.5）
        blockColors: [
            '#B82020', '#A05800', '#7A6000', '#187020',
            '#1050B8', '#901078', '#C02820', '#006060'
        ],
        // 家庭小宠（与 toon 动物园 / beast 猛兽完全错开，移除非小宠的 🐸🦜🐢）
        // 🐰兔子 / 🐠观赏鱼 / 🐦小鸟 / 🐱猫 / 🦎宠物蜥蜴 / 🐹仓鼠 / 🐭小白鼠 / 🐶狗
        // 浅色盘 + 深色块：白兔放深红、橙猫放深绿（互补）、绿蜥放深蓝、灰鼠放红底
        blockIcons: ['🐰', '🐠', '🐦', '🐱', '🦎', '🐹', '🐭', '🐶'],
        gridOuter: '#C0B090',
        gridCell:  '#F5EDDC',
        gridGap: 1,
        blockInset: 1,
        blockRadius: 10,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,240,180,0.88)',
        cssBg: '#EDE4CE',
        cssVars: {
            '--text-primary':     '#1E1810',
            '--text-secondary':   '#5C4830',
            '--accent-color':     '#C05820',
            '--accent-dark':      '#904010',
            '--shadow':           'rgba(0,0,0,0.14)',
            '--h1-color':         '#6A3818',
            '--stat-surface':     'rgba(255,248,232,0.92)',
            '--stat-label-color': '#7A6040',
            '--select-bg':        '#FFF4E4',
            '--select-border':    'rgba(160,120,60,0.25)'
        }
    },

    /**
     * 宇宙：八大行星 + 天体 emoji，近黑星空底。
     * Glass 渲染模拟行星玻璃球体质感。
     */
    universe: {
        id: 'universe',
        name: '🪐 宇宙星际',
        boardWatermark: { icons: ['🪐', '⭐'], opacity: 0.07 },
        blockColors: [
            '#E84020', '#F09030', '#D8C820', '#3898D0',
            '#D040D0', '#20B0C0', '#D88020', '#9070F0'
        ],
        // 八大天体专属：🛸UFO / 🌍地球 / 🔭望远镜 / 🌙月 / ⭐星 / 🪐土星 / ☄️彗星 / 🌠流星
        // 与 aurora 的 🌌（星云/极光）错开；黄色月/星避开金黄块，全互补色
        blockIcons: ['🛸', '🌍', '🔭', '🌙', '⭐', '🪐', '☄️', '🌠'],
        gridOuter: '#04020E',
        gridCell:  '#0A0618',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'glass',
        clearFlash: 'rgba(100,80,200,0.40)',
        cssBg: '#020108',
        uiDark: true,
        cssVars: {
            '--accent-color': '#6040C8',
            '--accent-dark':  '#9060E8',
            '--h1-color':     '#C0A0FF'
        }
    },

    /* ══════════════════════════════════════════
     *  奇幻
     * ══════════════════════════════════════════ */

    /** 魔幻：紫水晶/蓝宝石/祖母绿/红宝石等宝石矿物配色，近黑深紫底 */
    fantasy: {
        id: 'fantasy',
        name: '🔮 魔幻秘境',
        boardWatermark: { icons: ['🔮', '✨'], opacity: 0.08 },
        blockColors: [
            '#CC48FF', '#5080F0', '#18B848', '#E82020',
            '#E8B820', '#20B0D8', '#E020A0', '#9060E0'
        ],
        gridOuter: '#08041A',
        gridCell:  '#120830',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glass',
        clearFlash: 'rgba(160,80,255,0.40)',
        cssBg: '#040210',
        uiDark: true,
        cssVars: {
            '--accent-color': '#9828D8',
            '--accent-dark':  '#BB50F0',
            '--h1-color':     '#CC88FF'
        }
    },

    // ── 新增皮肤 ──────────────────────────────────────────────────────────
    // 主题：冒险（凶猛野兽，方块显示猛兽 icon）
    beast: {
        id: 'beast',
        name: '🗺️ 冒险奇境',
        boardWatermark: { icons: ['🦁', '🐯'], opacity: 0.08 },
        // 陆地猛兽八连：🐺狼 / 🦏犀牛 / 🐯虎 / 🦁狮 / 🐗野猪 / 🦅雕 / 🐆豹 / 🐻熊
        // 移除与 ocean 重复的 🦈鲨鱼，加入 🐗野猪强化「陆地猎人」纯陆生主题
        // 黄狮/橙虎避开金/橙底；灰狼/灰犀挪到金/橙底（高明度反差），避免「灰底灰兽」
        blockIcons: ['🐺', '🦏', '🐯', '🦁', '🐗', '🦅', '🐆', '🐻'],
        blockColors: [
            '#F0A820', // 🦁 狮子金
            '#F07030', // 🐯 虎纹橙
            '#5090D8', // 🦅 苍鹰蓝
            '#B0B8C8', // 🐺 狼灰
            '#D08830', // 🐆 豹纹铜
            '#E08050', // 🐻 棕熊铜（原深棕→亮铜，提升对比）
            '#A0A8A8', // 🦏 犀牛铁灰
            '#40A0D8', // 🦈 鲨鱼蓝
        ],
        gridOuter:   '#150C04',
        gridCell:    '#221608',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 6,
        blockStyle:  'glossy',
        clearFlash:  'rgba(255,180,30,0.50)',
        cssBg:       '#0E0802',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#D8900A',
            '--accent-dark':  '#F0B030',
            '--h1-color':     '#FFD060'
        }
    },

    // 主题：希腊神话（奥林匹斯诸神，每色对应一位神明专属符号）
    // 宙斯⚡ / 波塞冬🔱 / 雅典娜🏛️ / 阿波罗🌞 / 阿尔忒弥斯🏹 / 狄俄尼索斯🍇 / 赫拉🦚 / 哈迪斯💀
    greece: {
        id: 'greece',
        name: '🏛️ 希腊神话',
        boardWatermark: { icons: ['🏛️', '⚡'], opacity: 0.08 },
        // 奥林匹斯诸神图腾：⚡宙斯雷霆 / 🔱波塞冬三叉戟 / 🦉雅典娜之猫头鹰 /
        // ☀️阿波罗烈日 / 🏹阿尔忒弥斯之弓 / 🍷狄俄尼索斯酒神 / 💘阿芙罗狄忒爱神之箭 /
        // 🦚赫拉孔雀
        // 移除与 universe/demon 撞色的 🌙☠️，换成更专属的 🏹（猎神）🦚（赫拉），强化神祇符号性
        // 银三叉戟压金底、太阳放蓝底、孔雀多色放橙底、爱神心放青底，全互补
        blockIcons: ['🔱', '☀️', '🍷', '🦚', '⚡', '🏹', '💘', '🦉'],
        blockColors: [
            '#E8C030', // ⚡ 宙斯（雷霆金）
            '#4898E8', // 🔱 波塞冬（海洋蓝，加亮）
            '#90C040', // 🏛️ 雅典娜（橄榄绿）
            '#F07828', // 🌞 阿波罗（烈日橙）
            '#90B8D8', // 🏹 阿尔忒弥斯（月光银蓝）
            '#D050E8', // 🍷 狄俄尼索斯（酒神紫）
            '#20A8B8', // 💘 阿芙罗狄忒（孔雀青底衬心箭）
            '#7860E0', // 💀 哈迪斯（明亮冥界蓝）
        ],
        gridOuter:   '#08080E',
        gridCell:    '#10101C',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 7,
        blockStyle:  'glossy',
        clearFlash:  'rgba(230,195,40,0.52)',
        cssBg:       '#050508',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#C8A010',
            '--accent-dark':  '#E8C038',
            '--h1-color':     '#FFD870'
        }
    },

    // 主题：恶魔地狱（硫磺地狱火、暗黑魔法）
    demon: {
        id: 'demon',
        name: '😈 恶魔冥界',
        boardWatermark: { icons: ['😈', '💀'], opacity: 0.08 },
        // 冥府八符：👁️邪眼 / ⚔️双剑 / 💀骷髅 / 🕷️毒蛛 / 🦇蝙蝠 / 👹鬼面 / ☠️死亡之骨 / 😈魔王
        // 把同形的 👿 换成 👹（鬼面），与 😈 视觉差异更大；☠️ 由 greece 让出，独占冥界
        // 暗色 icon（🦇🕷️）压粉/紫底，红魔王（😈👹）压绿/紫底，全互补
        blockIcons: ['👁️', '⚔️', '💀', '🕷️', '🦇', '👹', '☠️', '😈'],
        blockColors: [
            '#F03030', // 地狱红（加亮）
            '#F0A020', // 硫磺黄
            '#CC40FF', // 暗魔紫（加亮为明亮紫）
            '#FF5030', // 鲜血橙（加亮）
            '#E8A0D8', // 幽灵粉
            '#9870D8', // 深影紫（加亮）
            '#E03060', // 深红（加亮）
            '#20D848', // 毒液绿
        ],
        gridOuter:   '#0A0412',
        gridCell:    '#180828',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 5,
        blockStyle:  'glass',
        clearFlash:  'rgba(200,20,30,0.45)',
        cssBg:       '#060210',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#CC1830',
            '--accent-dark':  '#E83050',
            '--h1-color':     '#FF5070'
        }
    },

    // 主题：侏罗纪（远古恐龙纪元，方块显示侏罗纪典型生物 icon）
    // 🦕 蜥脚类 / 🦖 霸王龙 / 🐊 鳄鱼 / 🦎 蜥蜴 / 🥚 恐龙蛋 / 🌿 蕨类 / 🌋 火山 / 💎 琥珀
    jurassic: {
        id: 'jurassic',
        name: '🦕 恐龙世界',
        boardWatermark: { icons: ['🦕', '🦖'], opacity: 0.08 },
        // 恐龙世界 — 史前爬行类 + 化石 + 火山：
        // 🥚恐龙蛋 / 🌋火山（灭绝意象） / 🦕腕龙 / 🦴化石 / 🐉翼龙 / 🦖霸王龙 / 🐊棘龙 / 🐍蛇颈龙
        // 把 🐢（让给 bubbly 萌系）替换为 🌋火山，更具 K-Pg 灭绝叙事；与所有皮肤无重复
        // 蛋(白)/化石(白)放绿底；火山(暗)压红底；翼龙/霸王龙放紫/青底，色相分散
        blockIcons: ['🥚', '🌋', '🦕', '🦴', '🐉', '🦖', '🐊', '🐍'],
        blockColors: [
            '#50C030', // 🦕 腕龙绿（植食巨兽，加亮）
            '#F05030', // 🦖 霸王龙红（顶级掠食者，加亮）
            '#9060F0', // 🐉 翼龙紫（天空霸主，加亮）
            '#A8D840', // 🦎 迅猛龙亮绿（疾速猎手）
            '#80B850', // 🐊 棘龙橄榄（水陆两栖）
            '#30A8B8', // 🐍 蛇颈龙青（深海游弋）
            '#D0A030', // 🦴 化石琥珀（远古遗骸）
            '#F0C840', // 🥚 恐龙蛋金黄（生命起源）
        ],
        gridOuter:   '#080E04',
        gridCell:    '#101A08',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 5,
        blockStyle:  'glossy',
        clearFlash:  'rgba(160,220,60,0.50)',
        cssBg:       '#060C02',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#5AC030',
            '--accent-dark':  '#80E050',
            '--h1-color':     '#B0F060'
        }
    },

    // 主题：花仙子（精灵·花卉·魔法，少女清新风）
    // 原 8 色全为粉/紫/红粉，icon 也全粉系导致同色糊作一片；
    // 由 pixel8 让出 🍄（更适合街机·Mario 意象），koi 让出 🌸（更适合日式池）
    // → 改用「多色花卉」让 fairy 拥有黄/绿/红三色花区分度，强化花园视觉层次
    fairy: {
        id: 'fairy',
        name: '🧚 花仙梦境',
        boardWatermark: { icons: ['🧚', '🌸'], opacity: 0.08 },
        // 花仙系专属：🧚花仙子 / 🦋蝶仙 / 🌹玫瑰 / 🌷郁金香 / 🌻向日葵 / 🍃嫩叶 / 🪄魔棒 / 🌈彩虹
        // 黄向日葵/绿嫩叶/红玫瑰落紫/粉/品红底 → 强冷暖反差；蝴蝶蓝放粉底，樱花粉换为玫瑰
        blockIcons: ['🌻', '🦋', '🌹', '🍃', '🪄', '🌷', '🌈', '🧚'],
        blockColors: [
            '#D060F0', // 🧚 花仙子紫（精灵）
            '#F060A0', // 🌸 樱花粉（浪漫）
            '#60A0F8', // 🦋 蝶翼蓝（自由）
            '#F07060', // 🌺 玫瑰珊瑚（热情）
            '#F040A0', // 🌷 郁金香玫红
            '#9B72F0', // 🪄 魔棒紫（与金黄 emoji 拉开色相）
            '#F09040', // 🍄 蘑菇橙（童话）
            '#40D0E8', // 🌈 彩虹青（梦幻）
        ],
        gridOuter:   '#100820',
        gridCell:    '#1A1030',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 9,
        blockStyle:  'glass',
        clearFlash:  'rgba(240,150,240,0.52)',
        cssBg:       '#0C0618',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#D060F0',
            '--accent-dark':  '#E890FF',
            '--h1-color':     '#F0B8FF'
        }
    },
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

    /* 字标像素格与 canvas 方块：同源 blockInset / blockRadius / gridGap / blockStyle（缺省防 NaN） */
    const wmRef = 40;
    const inset = skin.blockInset ?? 2;
    const gap = skin.gridGap ?? 1;
    const radius = skin.blockRadius ?? 5;
    root.style.setProperty('--skin-wm-inset-frac', String(inset / wmRef));
    root.style.setProperty('--skin-wm-radius-frac', String(radius / wmRef));
    root.style.setProperty('--skin-wm-gridgap-frac', String((2 * inset + gap) / wmRef));
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
