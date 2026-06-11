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
        blockColors: ['#3F6DD8', '#4FB8E8', '#52BC4B', '#FFC428', '#F5851E', '#A848E0', '#65C4F0', '#E84D5C'],
        gridOuter: '#1C2630',
        gridCell: '#2E3E50',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 4,
        blockStyle: 'bevel3d',
        clearFlash: 'rgba(220,240,255,0.90)',
        cssBg: '#141C24',
        uiDark: true,
    },

    /** 钛晶：蓝灰金属质感（默认皮肤） */
    titanium: {
        id: 'titanium',
        name: '💎 钛晶凝光',
        blockColors: ['#6AAEE8', '#94BDDF', '#78B8EB', '#A8CCF0', '#88D0F0', '#7DBAE2', '#B4D8EC', '#8DB6D8'],
        gridOuter: '#0A1020',
        gridCell: '#182030',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'metal',
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
        blockColors: ['#FF6A50', '#FF8E3A', '#FFB230', '#FFD638', '#FF7090', '#E04098', '#A858DC', '#FFAE6A'],
        gridOuter: '#241019',
        gridCell: '#341628',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glass',
        clearFlash: 'rgba(255,200,140,0.50)',
        cssBg: '#1A0810',
        uiDark: true,
    },

    /** 樱花：夜樱粉紫胭脂 */
    sakura: {
        id: 'sakura',
        name: '🌸 樱落无声',
        blockColors: ['#FF4490', '#FF2870', '#FFB0D8', '#78D860', '#78B8F0', '#CC60E8', '#FFBA30', '#58D890'],
        gridOuter: '#241018',
        gridCell: '#321628',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'glass',
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
        blockColors: ['#FF5570', '#FF7F11', '#FFD600', '#00C853', '#5590FF', '#DD60FF', '#B85828', '#00BCD4'],
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
        blockColors: ['#E06E62', '#5A92D6', '#D8A84E', '#55A873', '#8D75CE', '#42A7A8', '#D46282', '#6B7DDD'],
        gridOuter: '#F1E3C5',
        gridCell: '#FFF3D8',
        gridLine: 'rgba(130,96,48,0.13)',
        gridGap: 0,
        blockInset: 3,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,210,130,0.72)',
        cssBg: '#F7F0DC',
        uiDark: false,
    },

    /** 盛夏晴空：高饱和夏日水果色 + 海滩晴空浅底（浅色系） */
    summer: {
        id: 'summer',
        name: '☀️ 夏日海风',
        blockIcons: ['🍉', '🍦', '🥥', '🏝️', '🧊', '🍹', '🪁', '🏓'],
        blockColors: ['#E84B5C', '#D4A030', '#6AB82C', '#3A80C8', '#2AB898', '#C8A820', '#E85A5A', '#8B44B0'],
        gridOuter: '#A8C4D8',
        gridCell: '#C8DCEA',
        gridLine: 'rgba(40,110,170,0.28)',
        gridGap: 0,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,248,180,0.72)',
        cssBg: '#B8D2E4',
        uiDark: false,
    },

    /** 美食：食材原色方块 + 美食 emoji */
    food: {
        id: 'food',
        name: '🍕 烟火食光',
        blockColors: ['#FF5040', '#F09020', '#F8D020', '#60B830', '#E09050', '#B05028', '#F05878', '#C068F0'],
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
        blockColors: ['#C89088', '#B8A090', '#A8A878', '#78A890', '#98B0A8', '#C8B8A0', '#A898B8', '#B8B090'],
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

    /** 古典工业：蒸汽朋克金属 */
    industrial: {
        id: 'industrial',
        name: '🏭 蒸汽回响',
        blockIcons: ['⚙️', '🔧', '🔩', '🛠️', '⛓️', '🚂', '🏭', '⚒️'],
        blockColors: ['#D49640', '#C04030', '#B86838', '#4F9080', '#5C2820', '#B89060', '#6878A0', '#3A4048'],
        gridOuter: '#0E0904',
        gridCell: '#1A140C',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 4,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(232,176,80,0.50)',
        cssBg: '#080503',
        uiDark: true,
    },

    /** 北京皇城：紫禁城中式皇家配色 */
    forbidden: {
        id: 'forbidden',
        name: '👑 紫禁浮光',
        blockIcons: ['🐲', '👑', '🪭', '🧧', '🥮', '🀄', '📜', '🍵'],
        blockColors: ['#C8222C', '#1B7E5C', '#1F4FA0', '#D8CCB0', '#E8B83C', '#2E7088', '#B8732C', '#E84068'],
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
        blockColors: ['#3DA88C', '#C4424C', '#D4C4A0', '#404858', '#2A8870', '#E0A040', '#3070C0', '#A8A040'],
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

    /** 扑克博弈：赌场牌桌 */
    boardgame: {
        id: 'boardgame',
        name: '🃏 牌局风云',
        blockIcons: ['♠️', '♥️', '♦️', '♣️', '🃏', '🎴', '🎰', '🎲'],
        blockColors: ['#C89642', '#23866A', '#3E65B8', '#A8B3C2', '#A84A52', '#4F765C', '#6542A0', '#6E7486'],
        gridOuter: '#050711',
        gridCell: '#111628',
        gridLine: 'rgba(180,205,255,0.18)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(212,152,48,0.46)',
        cssBg: '#0E0410',
        uiDark: true,
    },

    /** 运动竞技：八大球类 + 奖杯 */
    sports: {
        id: 'sports',
        name: '⚽ 热血赛场',
        blockIcons: ['⚽', '🏀', '⚾', '🎾', '🏐', '🏈', '🥎', '🏆'],
        blockColors: ['#4F9050', '#2858B0', '#C04848', '#905028', '#2090C8', '#587830', '#6038A0', '#C82838'],
        gridOuter: '#0A1408',
        gridCell: '#0F1C0A',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,235,80,0.55)',
        cssBg: '#06100A',
        uiDark: true,
    },

    /** 户外运动：山野/水域/雪道 */
    outdoor: {
        id: 'outdoor',
        name: '🥾 山野之风',
        blockIcons: ['🥾', '⛺', '🧗', '🚴', '🏄', '🏂', '🛶', '🎣'],
        blockColors: ['#3878B8', '#3E7848', '#7E6048', '#E0B040', '#E08858', '#4FA8C8', '#2A8888', '#7068A8'],
        gridOuter: '#0A1420',
        gridCell: '#101C2C',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(140,200,255,0.50)',
        cssBg: '#06101C',
        uiDark: true,
    },

    /** 极速引擎：八大现代交通工具 */
    vehicles: {
        id: 'vehicles',
        name: '🏎️ 流光速影',
        blockIcons: ['🏎️', '✈️', '🚀', '🚁', '🚢', '🛵', '🚗', '🚌'],
        blockColors: ['#8090A0', '#2860C8', '#E84020', '#3E7E40', '#1E70A8', '#E8C828', '#5080A8', '#6840B0'],
        gridOuter: '#0E1218',
        gridCell: '#161E2C',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,180,40,0.45)',
        cssBg: '#080C12',
        uiDark: true,
    },

    /** 山林秘境：树木 / 落叶 / 麦穗 */
    forest: {
        id: 'forest',
        name: '🌳 荒野秘境',
        blockIcons: ['🌳', '🌲', '🐺', '🍁', '🦅', '🌾', '🐻', '🪺'],
        blockColors: ['#8B5828', '#D87838', '#6878A0', '#4F8048', '#D4A028', '#B0386D', '#7C5028', '#5090C8'],
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

    /** 海盗航行：罗盘 / 宝藏 / 鹦鹉 */
    pirate: {
        id: 'pirate',
        name: '🦜 海盗诗篇',
        blockIcons: ['⚓', '🏴‍☠️', '🪝', '🦜', '⛵', '🗺️', '🧭', '💎'],
        blockColors: ['#B02020', '#D8C4A0', '#2A6890', '#6E4828', '#14406F', '#2E6F45', '#8C2858', '#C8923C'],
        gridOuter: '#04101F',
        gridCell: '#0A1F32',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,200,80,0.45)',
        cssBg: '#020812',
        uiDark: true,
    },

    /** 田园农场：家畜 + 蔬果 */
    farm: {
        id: 'farm',
        name: '🐄 田园牧歌',
        blockIcons: ['🐄', '🐖', '🐑', '🐔', '🐣', '🌽', '🥕', '🍎'],
        blockColors: ['#B85A50', '#4E84B8', '#4E8A58', '#3C98B8', '#9A66B8', '#C89438', '#B06A38', '#C04E64'],
        gridOuter: '#07140A',
        gridCell: '#102414',
        gridLine: 'rgba(190,230,185,0.18)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(170,230,150,0.45)',
        cssBg: '#061006',
        uiDark: true,
    },

    /** 沙漠绿洲：骆驼 / 仙人掌 / 古寺 */
    desert: {
        id: 'desert',
        name: '🐫 大漠孤烟',
        blockIcons: ['🐫', '🦂', '🌵', '🏜️', '🪨', '🏺', '🛕', '🌅'],
        blockColors: ['#4E8EB8', '#B86A48', '#5C9A58', '#B89648', '#8A7A68', '#4E9A98', '#B85E58', '#8A6BB8'],
        gridOuter: '#130D08',
        gridCell: '#24190E',
        gridLine: 'rgba(230,190,120,0.20)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(230,180,80,0.45)',
        cssBg: '#0E0804',
        uiDark: true,
    },
    /** 果韵匠心：致敬乔布斯与 Apple 经典设计 */
    apple: {
        id: 'apple',
        name: '🍎 果韵匠心',
        blockColors: ['#C8C8CC', '#8E8E93', '#D4B88C', '#E8B4B8', '#4A5A6A', '#A8BCC8', '#5E5CE6', '#E55934'],
        gridOuter: '#0E0E12',
        gridCell: '#1A1A20',
        gridLine: 'rgba(255,255,255,0.07)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glass',
        clearFlash: 'rgba(200,200,220,0.30)',
        cssBg: '#09090D',
        uiDark: true,
    },

    /** 禅意山水：水墨画卷 */
    zen: {
        id: 'zen',
        name: '🍵 禅意山水',
        blockIcons: ['🏯', '🎍', '🕊️', '🪔', '🧘', '🎑', '🪘', '🫖'],
        blockColors: ['#6A8A7A', '#8A7A6A', '#5A7A8A', '#A0907A', '#7A9A8A', '#9A8A70', '#6A7A9A', '#8A9A7A'],
        gridOuter: '#D8D0C0',
        gridCell: '#F0EBE0',
        gridLine: 'rgba(100,90,70,0.10)',
        gridGap: 0,
        blockInset: 3,
        blockRadius: 6,
        blockStyle: 'flat',
        clearFlash: 'rgba(200,190,170,0.60)',
        cssBg: '#E8E2D6',
        uiDark: false,
    },

    /** 午后咖啡：暖棕治愈 */
    cafe: {
        id: 'cafe',
        name: '☕ 午后咖啡',
        blockIcons: ['☕', '📖', '🧋', '🪴', '🕯️', '🥐', '🎵', '📝'],
        blockColors: ['#8A6A50', '#6A7A6A', '#A0785A', '#5A8A7A', '#9A7A5A', '#7A8A6A', '#8A6A6A', '#6A8A8A'],
        gridOuter: '#D8C8B0',
        gridCell: '#F2E8D8',
        gridLine: 'rgba(120,90,60,0.10)',
        gridGap: 0,
        blockInset: 3,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(210,180,140,0.65)',
        cssBg: '#EAE0D0',
        uiDark: false,
    },

    /** 花园时光：园艺花草（长辈友好） */
    garden: {
        id: 'garden',
        name: '🌼 花园时光',
        blockIcons: ['🌼', '🏵️', '🪻', '🐌', '🐛', '🪣', '🌸', '🍀'],
        blockColors: ['#C87848', '#5A8A5A', '#D4A040', '#4A80A0', '#9A6A8A', '#6A9A6A', '#C06060', '#4A8A8A'],
        gridOuter: '#C8D8C0',
        gridCell: '#EAF0E4',
        gridLine: 'rgba(60,100,60,0.10)',
        gridGap: 0,
        blockInset: 2,
        blockRadius: 10,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(200,230,180,0.70)',
        cssBg: '#E0EAD8',
        uiDark: false,
    },

    /** 涂鸦课堂：彩笔画板（儿童友好） */
    doodle: {
        id: 'doodle',
        name: '✏️ 涂鸦课堂',
        blockIcons: ['✏️', '📐', '📏', '🎨', '🖍️', '📚', '🔬', '🎓'],
        blockColors: ['#E06050', '#3888D8', '#E8B020', '#40A850', '#D060B0', '#30A8B0', '#F08030', '#8868D0'],
        gridOuter: '#C8D0E0',
        gridCell: '#E8EEF6',
        gridLine: 'rgba(60,80,120,0.10)',
        gridGap: 0,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(200,220,255,0.70)',
        cssBg: '#DEE4F0',
        uiDark: false,
    },

    /** 赛博朋克：电路板 + AI + 矩阵代码 */
    cyberpunk: {
        id: 'cyberpunk',
        name: '🤖 赛博朋克',
        blockIcons: ['🤖', '💻', '🔌', '📡', '🧬', '📊', '🔋', '💾'],
        blockColors: ['#00FF88', '#FF0066', '#00CCFF', '#FFCC00', '#CC00FF', '#00FFCC', '#FF6600', '#88FF00'],
        gridOuter: '#060A10',
        gridCell: '#0C1420',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 3,
        blockStyle: 'neon',
        clearFlash: 'rgba(0,255,136,0.35)',
        cssBg: '#040810',
        uiDark: true,
    },

    /** 北欧极简：纯配色 */
    nordic: {
        id: 'nordic',
        name: '🏔️ 北欧极简',
        blockColors: ['#8A9AA8', '#A8B0A0', '#B0A890', '#90A0B0', '#A0B0A0', '#B0A8A0', '#98A8B0', '#A8B0A8'],
        gridOuter: '#D0D8DC',
        gridCell: '#EAF0F0',
        gridLine: 'rgba(80,100,110,0.08)',
        gridGap: 0,
        blockInset: 3,
        blockRadius: 6,
        blockStyle: 'flat',
        clearFlash: 'rgba(200,210,220,0.55)',
        cssBg: '#E2EAE8',
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

    /** 星座物语：纯配色 + glass */
    zodiac: {
        id: 'zodiac',
        name: '♈ 星座物语',
        blockColors: ['#E84848', '#D8A030', '#58B868', '#3888D8', '#A048D8', '#E87058', '#48A8B8', '#C860A8'],
        gridOuter: '#08081C',
        gridCell: '#101028',
        gridLine: 'rgba(180,160,255,0.12)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glass',
        clearFlash: 'rgba(140,120,220,0.40)',
        cssBg: '#060618',
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
    { id: 'classic',   label: '🔰 基础经典', skins: ['classic', 'titanium'] },
    { id: 'tech',      label: '💡 暗色科技', skins: ['aurora', 'neonCity', 'cyberpunk'] },
    { id: 'nature',    label: '🌐 自然元素', skins: ['ocean', 'sunset', 'forest', 'desert', 'outdoor'] },
    { id: 'japanese',  label: '🎎 日系美学', skins: ['sakura', 'koi', 'zen'] },
    { id: 'cute',      label: '🍡 休闲甜系', skins: ['candy', 'toon', 'pixel8', 'doodle'] },
    { id: 'light',     label: '🫧 浅色清新', skins: ['dawn', 'summer', 'cafe', 'garden', 'nordic'] },
    { id: 'life',      label: '🏷️ 生活意象', skins: ['food', 'music', 'pets', 'universe', 'sports', 'vehicles', 'farm'] },
    { id: 'fantasy',   label: '🧿 奇幻神话', skins: ['fantasy', 'fairy', 'greece', 'demon', 'jurassic'] },
    { id: 'culture',   label: '🪆 文化主题', skins: ['industrial', 'forbidden', 'mahjong', 'boardgame', 'pirate'] },
    { id: 'festive',   label: '🎖️ 庆典社交', skins: ['fiesta', 'zodiac', 'apple'] },
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
    industrial: { icons: ['🏭', '⚙️'], opacity: 0.08 },
    forbidden: { icons: ['👑', '🐲'], opacity: 0.08 },
    mahjong: { icons: ['🀅', '🀀'], opacity: 0.10 },
    boardgame: { icons: ['🃏', '♠️'], opacity: 0.055 },
    sports: { icons: ['⚽', '🏆'], opacity: 0.08 },
    outdoor: { icons: ['🥾', '⛺'], opacity: 0.10 },
    vehicles: { icons: ['🏎️', '✈️'], opacity: 0.08 },
    forest: { icons: ['🌳', '🍁'], opacity: 0.08 },
    pirate: { icons: ['🦜', '🏴‍☠️'], opacity: 0.08 },
    farm: { icons: ['🐄', '🌽'], opacity: 0.055 },
    desert: { icons: ['🐫', '🌵'], opacity: 0.055 },
    summer: { icons: ['☀️', '🏝️'], opacity: 0.10 },
    apple: { icons: ['🍎', '✨'], opacity: 0.06 },
    zen: { icons: ['🍵', '🏯'], opacity: 0.10 },
    cafe: { icons: ['☕', '📖'], opacity: 0.10 },
    garden: { icons: ['🌼', '🌸'], opacity: 0.10 },
    doodle: { icons: ['✏️', '📚'], opacity: 0.10 },
    cyberpunk: { icons: ['🤖', '💻'], opacity: 0.06 },
    nordic: { icons: ['🏔️', '🌿'], opacity: 0.08 },
    fiesta: { icons: ['🎉', '🎊'], opacity: 0.08 },
    zodiac: { icons: ['♈', '♌'], opacity: 0.06 },
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
