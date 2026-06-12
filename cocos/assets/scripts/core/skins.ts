/**
 * 皮肤/调色板 —— 与 web/src/skins.js 同源（颜色 / icon / 盘面色板对齐）。
 *
 * 移植范围：cocos 渲染所需的数据字段（blockColors / blockIcons / gridOuter / gridCell /
 * gridLine / gridGap / blockInset / blockRadius / blockStyle / clearFlash / cssBg / uiDark）。
 * 未移植 web 专属字段（boardWatermark / cssVars）—— 它们属于 DOM/HUD 主题，cocos 端不消费。
 *
 * 默认皮肤与 web 一致：titanium。
 */
import { Skin } from './types';

export const SKINS: Record<string, Skin> = {
    /** 经典：高饱和六色积木 + 立体梯形浮雕 */
    classic: {
        id: 'classic',
        name: '✨ 极简经典',
        blockIcons: ['🏆', '💎', '🎯', '🎲', '♠️', '♥️', '🃏', '🎰'],
        blockColors: ['#6E90E1', '#4FB8E8', '#52BC4B', '#FFC428', '#F5851E', '#BD74E7', '#65C4F0', '#EC6B77'],
        gridOuter: '#1C2630',
        gridCell: '#2E3E50',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 4,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(220,240,255,0.90)',
        cssBg: '#141C24',
        uiDark: true,
    },

    /** 钛晶：蓝灰金属质感（默认皮肤） */
    titanium: {
        id: 'titanium',
        name: '💎 钛晶凝光',
        blockIcons: ['⚙️', '🔩', '🛡️', '🔧', '💠', '⚒️', '🛠️', '⛓️'],
        blockColors: ['#6AAEE8', '#94BDDF', '#78B8EB', '#A8CCF0', '#88D0F0', '#7DBAE2', '#B4D8EC', '#8DB6D8'],
        gridOuter: '#0A1020',
        gridCell: '#182030',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(200,220,245,0.42)',
        cssBg: '#080C18',
        uiDark: true,
    },

    /** 极光：冰川极光玻璃感 */
    aurora: {
        id: 'aurora',
        name: '🌌 极光幻梦',
        blockIcons: ['🦌', '🐧', '🐋', '❄️', '🌌', '🐻‍❄️', '🦭', '🏔️'],
        blockColors: ['#5AD8CC', '#8070F0', '#AA90FA', '#38D89E', '#28D8F0', '#8590F8', '#C488FC', '#60C8FF'],
        gridOuter: '#04101C',
        gridCell: '#0C1C2E',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(170,245,210,0.38)',
        cssBg: '#020C18',
        uiDark: true,
    },

    /** 霓虹都市：RGB 霓虹灯光压近黑底 */
    neonCity: {
        id: 'neonCity',
        name: '🌃 霓虹未眠',
        blockIcons: ['🌆', '🚥', '🚇', '🎆', '🏨', '🚖', '🌉', '🛤️'],
        blockColors: ['#FF2DAA', '#9B72FF', '#00E5FF', '#76FF03', '#FFAB40', '#FF4081', '#448AFF', '#18FFFF'],
        gridOuter: '#0B0F1A',
        gridCell: '#151C2E',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'neon',
        clearFlash: 'rgba(0,229,255,0.35)',
        cssBg: '#080C16',
        uiDark: true,
    },

    /** 深海：珊瑚 / 荧光鱼 / 海水青 */
    ocean: {
        id: 'ocean',
        name: '🌊 深海之瞳',
        blockIcons: ['🐙', '🦞', '🐡', '🐬', '🐚', '🐳', '🦈', '🐢'],
        blockColors: ['#00C8F0', '#0098C8', '#48D4E4', '#90F0FF', '#00E4C0', '#FFB347', '#FF7878', '#20E8FF'],
        gridOuter: '#040E18',
        gridCell: '#081C28',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(144,224,239,0.35)',
        cssBg: '#020A14',
        uiDark: true,
    },

    /** 琥珀流光：暖色宝石谱 + glass 渲染 */
    sunset: {
        id: 'sunset',
        name: '🌅 琥珀流光',
        blockIcons: ['🌅', '🏺', '🌼', '🏵️', '🍀', '🪻', '🌺', '🐫'],
        blockColors: ['#FF6A50', '#FF8E3A', '#FFB230', '#FFD638', '#FF7090', '#E04098', '#A858DC', '#FFAE6A'],
        gridOuter: '#241019',
        gridCell: '#341628',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,200,140,0.50)',
        cssBg: '#1A0810',
        uiDark: true,
    },

    /** 樱花：夜樱粉紫胭脂 */
    sakura: {
        id: 'sakura',
        name: '🌸 樱落无声',
        blockIcons: ['🌸', '🕊️', '🏯', '🪔', '🧘', '🎑', '🫖', '🪘'],
        blockColors: ['#FF4490', '#FF2870', '#FFB0D8', '#78D860', '#78B8F0', '#CC60E8', '#FFBA30', '#58D890'],
        gridOuter: '#241018',
        gridCell: '#321628',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,180,220,0.52)',
        cssBg: '#1A0810',
        uiDark: true,
    },

    /** 锦鲤：朱红/金黄/橙橘/樱粉 */
    koi: {
        id: 'koi',
        name: '🎏 锦鲤戏月',
        blockIcons: ['🎋', '🌊', '🪷', '⛩️', '🐟', '🏮', '🎐', '🎏'],
        blockColors: ['#FF5040', '#F07828', '#F0C820', '#4070D8', '#E880A8', '#38A8B8', '#F05888', '#D0A858'],
        gridOuter: '#040E18',
        gridCell: '#081C2C',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 9,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(80,200,255,0.38)',
        cssBg: '#020A14',
        uiDark: true,
    },

    /** 糖果：超饱和纯色糖块 */
    candy: {
        id: 'candy',
        name: '🍭 糖心蜜语',
        blockIcons: ['🍪', '🎀', '🍫', '🍰', '🍩', '🍬', '🍭', '🧁'],
        blockColors: ['#FF4466', '#FF8820', '#FFD020', '#44E848', '#22AAFF', '#CC66FF', '#FF44BB', '#22E8CC'],
        gridOuter: '#22082A',
        gridCell: '#321048',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,200,255,0.88)',
        cssBg: '#1A0628',
        uiDark: true,
    },

    /** 卡通乐园：原色积木 + 萌物图标 */
    toon: {
        id: 'toon',
        name: '🎨 童画世界',
        blockColors: ['#FF5570', '#FF7F11', '#FFD600', '#00C853', '#5590FF', '#DD60FF', '#D46D3A', '#00BCD4'],
        blockIcons: ['🐼', '🐨', '🐘', '🦒', '🦛', '🦔', '🦘', '🦄'],
        gridOuter: '#2A1860',
        gridCell: '#3A2478',
        gridGap: 2,
        blockInset: 1,
        blockRadius: 10,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,255,130,0.90)',
        cssBg: '#1A1040',
        uiDark: true,
    },

    /** 街机格斗：NES/SNK 鲜艳配色 */
    pixel8: {
        id: 'pixel8',
        name: '👾 像素纪元',
        blockIcons: ['💣', '🪙', '🥊', '🎮', '👊', '🍄', '🕹️', '👾'],
        blockColors: ['#FF2050', '#1E78FF', '#00C030', '#F8C000', '#CC00CC', '#00B8C8', '#FF5800', '#90E000'],
        gridOuter: '#0D0400',
        gridCell: '#1E1008',
        gridGap: 1,
        blockInset: 2,
        blockStyle: 'cartoon',
        blockRadius: 4,
        clearFlash: '#FFFFF0',
        cssBg: '#080200',
        uiDark: true,
    },

    /** 晨光：低饱和暖米盘面（浅色系） */
    dawn: {
        id: 'dawn',
        name: '☀️ 晨光微曦',
        blockIcons: ['🐝', '🌱', '🍯', '🦗', '🐞', '🌿', '🪹', '🐓'],
        blockColors: ['#DA5244', '#4181D0', '#A67925', '#488D61', '#8970CC', '#378C8C', '#D15578', '#6678DC'],
        gridOuter: '#D8C8A4',
        gridCell: '#EDE0C4',
        gridLine: 'rgba(110,80,36,0.28)',
        gridGap: 0,
        blockInset: 3,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,210,130,0.72)',
        cssBg: '#D4C8AE',
        uiDark: false,
    },

    /** 盛夏晴空：高饱和夏日水果色 + 海滩晴空浅底（浅色系） */
    summer: {
        id: 'summer',
        name: '🏖️ 夏日海风',
        blockIcons: ['🍉', '🍦', '🥥', '🏝️', '🧊', '🍹', '🪁', '🏓'],
        blockColors: ['#D81C30', '#8B681D', '#467A1D', '#3271B1', '#1D7E68', '#826D15', '#D71E1E', '#8B44B0'],
        gridOuter: '#8AAEC8',
        gridCell: '#A8C4D8',
        gridLine: 'rgba(30,80,130,0.32)',
        gridGap: 0,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,248,180,0.72)',
        cssBg: '#92B4CC',
        uiDark: false,
    },

    /** 美食：食材原色方块 + 美食 emoji */
    food: {
        id: 'food',
        name: '🍕 烟火食光',
        blockColors: ['#FF5040', '#F09020', '#F8D020', '#60B830', '#E09050', '#B8542A', '#F05878', '#C068F0'],
        blockIcons: ['🥑', '🍣', '🍞', '🍕', '🌮', '🍔', '🥩', '🍜'],
        gridOuter: '#18100A',
        gridCell: '#281808',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,200,100,0.88)',
        cssBg: '#100A04',
        uiDark: true,
    },

    /** 音乐律动：舞台追光色 + 乐器 emoji */
    music: {
        id: 'music',
        name: '🎹 音律星河',
        blockColors: ['#FF3060', '#FF9020', '#FFE820', '#40E840', '#3088FF', '#E040FF', '#FF60A0', '#40E8E8'],
        blockIcons: ['🎤', '🎹', '🎧', '🎺', '🥁', '🎸', '🎷', '🎻'],
        gridOuter: '#100818',
        gridCell: '#1C0C28',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'neon',
        clearFlash: 'rgba(255,100,200,0.40)',
        cssBg: '#08040F',
        uiDark: true,
    },

    /** 萌宠：卡通风格 + 宠物 emoji（浅色系） */
    pets: {
        id: 'pets',
        name: '🐶 萌宠时光',
        blockColors: ['#B5695E', '#967660', '#7E7E51', '#57876F', '#648379', '#907853', '#89749F', '#877D56'],
        blockIcons: ['🐰', '🐠', '🐦', '🐱', '🦎', '🐹', '🐭', '🐶'],
        gridOuter: '#C0B090',
        gridCell: '#F5EDDC',
        gridGap: 1,
        blockInset: 1,
        blockRadius: 10,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,240,180,0.88)',
        cssBg: '#EDE4CE',
        uiDark: false,
    },

    /** 宇宙：八大行星 + 天体 emoji */
    universe: {
        id: 'universe',
        name: '🪐 星河漫游',
        blockColors: ['#E84020', '#F09030', '#D8C820', '#3898D0', '#D040D0', '#20B0C0', '#D88020', '#9070F0'],
        blockIcons: ['🛸', '🌍', '🔭', '🌙', '⭐', '🪐', '☄️', '🌠'],
        gridOuter: '#04020E',
        gridCell: '#0A0618',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(100,80,200,0.40)',
        cssBg: '#020108',
        uiDark: true,
    },

    /** 魔幻：宝石矿物配色 */
    fantasy: {
        id: 'fantasy',
        name: '🔮 幻梦之境',
        blockIcons: ['🧙', '🧝', '🧞', '💫', '🗝️', '📿', '🪬', '🪩'],
        blockColors: ['#CC48FF', '#5080F0', '#18B848', '#E82020', '#E8B820', '#20B0D8', '#E020A0', '#9060E0'],
        gridOuter: '#0E0428',
        gridCell: '#1A0838',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(160,80,255,0.42)',
        cssBg: '#0A0420',
        uiDark: true,
    },

    /** 希腊神话：奥林匹斯诸神 icon */
    greece: {
        id: 'greece',
        name: '🏛️ 众神之诗',
        blockIcons: ['🔱', '☀️', '🍷', '🦚', '⚡', '🏹', '💘', '🦉'],
        blockColors: ['#E8C030', '#4898E8', '#90C040', '#F07828', '#90B8D8', '#D050E8', '#20A8B8', '#7860E0'],
        gridOuter: '#040A18',
        gridCell: '#0A1228',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(230,195,40,0.52)',
        cssBg: '#020812',
        uiDark: true,
    },

    /** 恶魔冥界：硫磺地狱火 */
    demon: {
        id: 'demon',
        name: '😈 永夜咏叹',
        blockIcons: ['👁️', '⚔️', '💀', '🕷️', '🦇', '👹', '☠️', '😈'],
        blockColors: ['#F03030', '#F0A020', '#CC40FF', '#FF5030', '#E8A0D8', '#9870D8', '#E03060', '#20D848'],
        gridOuter: '#160408',
        gridCell: '#341018',
        gridLine: 'rgba(255,112,136,0.24)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(220,30,40,0.48)',
        cssBg: '#0E0408',
        uiDark: true,
    },

    /** 恐龙世界：史前爬行类 + 化石 + 火山 */
    jurassic: {
        id: 'jurassic',
        name: '🦕 远古之息',
        blockIcons: ['🥚', '🌋', '🦕', '🦴', '🐉', '🦖', '🐊', '🐍'],
        blockColors: ['#50C030', '#F05030', '#9060F0', '#A8D840', '#80B850', '#30A8B8', '#D0A030', '#F0C840'],
        gridOuter: '#0E1A06',
        gridCell: '#1A2A0E',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(160,220,60,0.50)',
        cssBg: '#0A1408',
        uiDark: true,
    },

    /** 花仙梦境：精灵·花卉·魔法 */
    fairy: {
        id: 'fairy',
        name: '🧚 花语星梦',
        blockIcons: ['🌻', '🦋', '🌹', '🍃', '🪄', '🌷', '🌈', '🧚'],
        blockColors: ['#D060F0', '#F060A0', '#60A0F8', '#F07060', '#F040A0', '#9B72F0', '#F09040', '#40D0E8'],
        gridOuter: '#1F0E2C',
        gridCell: '#2C1640',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 9,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(240,150,240,0.52)',
        cssBg: '#150A24',
        uiDark: true,
    },

    /** 北京皇城：紫禁城中式皇家配色 */
    forbidden: {
        id: 'forbidden',
        name: '👑 紫禁浮光',
        blockIcons: ['🐲', '👑', '🪭', '🧧', '🥮', '🀄', '📜', '🍵'],
        blockColors: ['#D8252F', '#1B7E5C', '#2B6BD6', '#D8CCB0', '#E8B83C', '#317891', '#B8732C', '#E84068'],
        gridOuter: '#1C0608',
        gridCell: '#2A0E12',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(232,184,60,0.52)',
        cssBg: '#160406',
        uiDark: true,
    },

    /** 麻将牌局：绿呢牌桌 + 麻将牌 */
    mahjong: {
        id: 'mahjong',
        name: '🀄 牌影江湖',
        blockIcons: ['🀀', '🀁', '🀂', '🀃', '🀅', '🀇', '🀙', '🀐'],
        blockColors: ['#4FC0A1', '#D9848B', '#D4C4A0', '#919BAF', '#36AF90', '#E6B263', '#6C9DDA', '#B9B148'],
        gridOuter: '#3D2818',
        gridCell: '#2A4A38',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(180,220,150,0.50)',
        cssBg: '#1F1810',
        uiDark: true,
    },

    /** 山林秘境：树木 / 落叶 / 麦穗 */
    forest: {
        id: 'forest',
        name: '🌳 荒野秘境',
        blockIcons: ['🌳', '🌲', '🐺', '🍁', '🦅', '🌾', '🐻', '🪺'],
        blockColors: ['#A5682F', '#D97B3C', '#6B7BA2', '#518349', '#D4A028', '#C4497F', '#A36934', '#5392C9'],
        gridOuter: '#06140A',
        gridCell: '#0E2010',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(180,255,160,0.45)',
        cssBg: '#040E06',
        uiDark: true,
    },

    /** 果韵匠心：致敬乔布斯与 Apple 经典设计 */
    apple: {
        id: 'apple',
        name: '🍎 果韵匠心',
        blockIcons: ['🍎', '💻', '✈️', '🚀', '📡', '🔋', '💾', '🔌'],
        blockColors: ['#C8C8CC', '#8E8E93', '#D4B88C', '#E8B4B8', '#5F7488', '#A8BCC8', '#6261E7', '#E55934'],
        gridOuter: '#0E0E12',
        gridCell: '#1A1A20',
        gridLine: 'rgba(255,255,255,0.07)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(200,200,220,0.30)',
        cssBg: '#09090D',
        uiDark: true,
    },

    /** 午后咖啡：暖棕治愈 */
    cafe: {
        id: 'cafe',
        name: '☕ 午后咖啡',
        blockIcons: ['☕', '📖', '🧋', '🪴', '🕯️', '🥐', '🎵', '📝'],
        blockColors: ['#8A6A50', '#6A7A6A', '#997356', '#548172', '#947556', '#707E61', '#8A6A6A', '#617E7E'],
        gridOuter: '#C0AC90',
        gridCell: '#D8CCBA',
        gridLine: 'rgba(90,66,38,0.24)',
        gridGap: 0,
        blockInset: 3,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(210,180,140,0.65)',
        cssBg: '#C8BAAA',
        uiDark: false,
    },

    /** 欢庆嘉年：派对 / 节日 */
    fiesta: {
        id: 'fiesta',
        name: '🎉 欢庆嘉年',
        blockIcons: ['🎉', '🎊', '🎈', '🪅', '🥳', '🎁', '🧨', '🎪'],
        blockColors: ['#FF3058', '#FF9020', '#FFD028', '#30D850', '#2098FF', '#CC40FF', '#FF50A0', '#20D0D0'],
        gridOuter: '#180828',
        gridCell: '#281040',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,220,100,0.85)',
        cssBg: '#100420',
        uiDark: true,
    },

};

/** 默认皮肤与 web 一致：titanium。 */
export const DEFAULT_SKIN_ID = 'titanium';

/** 已下线皮肤 id → 迁移目标（与 web REMOVED_SKIN_ALIASES 对齐）。 */
const REMOVED_SKIN_ALIASES: Record<string, string> = {
    cyber: 'neonCity',
    macaroon: 'dawn',
    neural: 'neonCity',
    lava: 'sunset',
    midnight: 'neonCity',
    pastel: 'candy',
    retro: 'pixel8',
    jungle: 'toon',
    bubbly: 'ocean',
    beast: 'forest',
    cyberpunk: 'neonCity',
    desert: 'sunset',
    outdoor: 'forest',
    garden: 'dawn',
    nordic: 'cafe',
    doodle: 'dawn',
    zen: 'cafe',
    sports: 'fiesta',
    vehicles: 'neonCity',
    farm: 'food',
    zodiac: 'universe',
    boardgame: 'mahjong',
    pirate: 'ocean',
    industrial: 'forbidden',
};

export function getSkin(id?: string | null): Skin {
    if (!id) return SKINS[DEFAULT_SKIN_ID];
    const mapped = REMOVED_SKIN_ALIASES[id] || id;
    return SKINS[mapped] || SKINS[DEFAULT_SKIN_ID];
}

export function listSkinIds(): string[] {
    return Object.keys(SKINS);
}

export interface SkinCategory {
    id: string;
    label: string;
    skins: string[];
}

export const SKIN_CATEGORIES: SkinCategory[] = [
    { id: 'classic',   label: '🔰 经典 · 科技', skins: ['classic', 'titanium', 'aurora', 'neonCity', 'candy', 'toon', 'pixel8'] },
    { id: 'nature',    label: '🌿 自然 · 清新', skins: ['ocean', 'sunset', 'forest', 'dawn', 'summer', 'cafe', 'sakura'] },
    { id: 'life',      label: '🏷️ 生活 · 庆典', skins: ['food', 'music', 'pets', 'universe', 'fiesta', 'apple', 'koi'] },
    { id: 'fantasy',   label: '🧿 奇幻 · 文化', skins: ['fantasy', 'fairy', 'greece', 'demon', 'jurassic', 'forbidden', 'mahjong'] },
];

export function getSkinCategories(): Array<{ id: string; label: string; skins: Skin[] }> {
    return SKIN_CATEGORIES
        .map(cat => ({
            ...cat,
            skins: cat.skins.filter(id => SKINS[id]).map(id => SKINS[id]),
        }))
        .filter(cat => cat.skins.length > 0);
}

/** 盘面水印（对齐 web `skin.boardWatermark`）：盘面 5 锚点上的低透明度浮层 emoji。 */
export interface BoardWatermark {
    icons: string[];
    opacity: number;
    /** 字号缩放（相对默认）。缺省按默认。 */
    scale?: number;
}

/** 各皮肤盘面水印（icons/opacity/scale 与 web `skins.js` boardWatermark 基础值对齐）。 */
const WATERMARKS: Record<string, BoardWatermark> = {
    classic: { icons: ['🎮', '⭐'], opacity: 0.07 },
    titanium: { icons: ['💠', '🔷'], opacity: 0.07 },
    aurora: { icons: ['🐧', '🐻‍❄️', '❄️', '🌌'], opacity: 0.08 },
    neonCity: { icons: ['🌃', '🏙️'], opacity: 0.07 },
    ocean: { icons: ['🦈', '🐠'], opacity: 0.07 },
    sunset: { icons: ['🌅', '🔆'], opacity: 0.08 },
    sakura: { icons: ['🌸', '🌺'], opacity: 0.09 },
    koi: { icons: ['🎏', '🐟'], opacity: 0.08 },
    candy: { icons: ['🍭', '🍬'], opacity: 0.09 },
    toon: { icons: ['🎪', '🎠'], opacity: 0.08 },
    pixel8: { icons: ['👾', '🎮', '🍄', '🥊'], opacity: 0.10, scale: 0.72 },
    dawn: { icons: ['🌄', '🌻', '🕊️', '🍃'], opacity: 0.12, scale: 0.28 },
    food: { icons: ['🍕', '🍔'], opacity: 0.08 },
    music: { icons: ['🎹', '🎸'], opacity: 0.08 },
    pets: { icons: ['🐶', '🐾'], opacity: 0.09 },
    universe: { icons: ['🪐', '⭐'], opacity: 0.07 },
    fantasy: { icons: ['🔮', '✨'], opacity: 0.08 },
    greece: { icons: ['🏛️', '⚡'], opacity: 0.08 },
    demon: { icons: ['😈', '💀'], opacity: 0.08 },
    jurassic: { icons: ['🦕', '🦖'], opacity: 0.08 },
    fairy: { icons: ['🧚', '🌸'], opacity: 0.08 },
    forbidden: { icons: ['👑', '🐲'], opacity: 0.08 },
    mahjong: { icons: ['🀅', '🀀'], opacity: 0.10 },
    forest: { icons: ['🌳', '🍁'], opacity: 0.08 },
    summer: { icons: ['☀️', '🏝️'], opacity: 0.10 },
    apple: { icons: ['🍎', '✨'], opacity: 0.05 },
    cafe: { icons: ['☕', '📖'], opacity: 0.10 },
    fiesta: { icons: ['🎉', '🎊'], opacity: 0.08 },
};

/** 取皮肤盘面水印（含已下线皮肤别名映射）；无则返回 null。 */
export function getWatermark(id: string): BoardWatermark | null {
    const mapped = REMOVED_SKIN_ALIASES[id] || id;
    return WATERMARKS[mapped] || null;
}

/** 4 月 1 日限定 emoji 集（覆盖所有皮肤的 blockIcons，与 web seasonalSkin.APRIL_FOOLS_ICONS 一致）。 */
const APRIL_FOOLS_ICONS = ['😀', '😎', '🤩', '😜', '🥳', '🤖', '👻', '🎭'];

/** 是否处于愚人节（4/1）。date 可注入便于测试。 */
export function isAprilFools(date: Date = new Date()): boolean {
    return date.getMonth() === 3 && date.getDate() === 1;
}

/**
 * 节日彩蛋（对齐 web `applyAprilFoolsIfActive`）：4 月 1 日把所有皮肤的 blockIcons 临时换成表情 emoji，
 * 原本无 icon 的皮肤也补上节日表情。需在渲染前调用（直接就地改 SKINS，模型/视图随后读到的即为覆盖值）。
 * core 保持引擎无关：是否退订由调用方（各端壳）从本地存储读出后以 `optOut` 传入。
 */
export function applyAprilFoolsIfActive(opts?: { date?: Date; optOut?: boolean }): boolean {
    if (opts?.optOut) return false;
    if (!isAprilFools(opts?.date)) return false;
    for (const id of Object.keys(SKINS)) {
        const s = SKINS[id];
        if (Array.isArray(s.blockIcons) && s.blockIcons.length) {
            s.blockIcons = APRIL_FOOLS_ICONS.slice(0, s.blockIcons.length);
        } else if (Array.isArray(s.blockColors) && s.blockColors.length) {
            s.blockIcons = APRIL_FOOLS_ICONS.slice(0, s.blockColors.length);
        }
    }
    return true;
}
