/**
 * 方块与盘面主题（换肤）
 * 持久化键：localStorage.openblock_skin
 */

import { GAME_RULES } from './gameRules.js';

const STORAGE_KEY = 'openblock_skin';

/** 已下线皮肤 id → 迁移目标（读档时自动改写 localStorage）
 *  v10.31：cyber/macaroon 下线
 *  v10.32：neural → neonCity；lava → sunset（与 sunset 合并为「琥珀流光」）
 *  v10.33：bubbly → ocean；beast → forest（icon 精华并入）；新增 zen/cafe/garden/doodle/cyberpunk/nordic/fiesta/zodiac */
const REMOVED_SKIN_ALIASES = {
    cyber: 'neonCity',
    macaroon: 'dawn',
    neural: 'neonCity',
    lava: 'sunset',
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
 * @typedef {'glossy' | 'flat' | 'neon' | 'glass' | 'metal' | 'cartoon' | 'jelly' | 'pixel8' | 'bevel3d'} BlockDrawStyle
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
 * 皮肤总量：42 款（v10.33 删除 bubbly/beast 2 款，新增 zen/cafe/garden/doodle/cyberpunk/nordic/fiesta/zodiac 8 款；
 *               v10.32 剔除 `neural`→`neonCity` 与 `lava`→`sunset`，sunset 升级为「琥珀流光」glass 风格）
 * 盘面设计基准：参考 neonCity —— gridOuter（极深）+ gridCell（深色可见空格）
 * 方块须与 gridCell 形成明显明度/色相反差。
 *
 * 合并历史：
 *   cosmos  → cyber        frost / arctic → aurora
 *   midnight→ neonCity     pastel         → candy
 *   retro   → pixel8       jungle         → toon
 *   sage / terra / wood / cozy             → 移除
 *
 * 文化主题（v9 新增）：industrial 古典工业 + forbidden 北京皇城。
 * 主题扩展（v10 新增 6 款）：sports 运动竞技 + vehicles 极速引擎 +
 *                          forest 山林秘境 + pirate 海盗航行 +
 *                          farm 田园农场 + desert 沙漠绿洲。
 * 主题一致性（v10.1）：farm 卡其沙黄底 → 浅春绿牧草底；
 *                     desert 深蓝夜空底 → 浅沙金主调底（uiDark 转为浅色）。
 *                     原则：盘面/页面背景的色相必须服务于皮肤主题叙事。
 *
 * 主题强化（v10.2）：将「主题↔背景一致性铁律」推广到全部深色皮肤。
 *   sunset   琥珀流光  纯黑紫红 → 玫瑰胭脂暮霭（点出琥珀宝石质感；v10.32 与 lava 合并）
 *   sakura   樱花飞雪  纯黑红   → 胭脂粉紫夜（夜樱粉光）
 *   candy    糖果甜心  通用紫黑 → 莓果糖果橱（甜系深莓紫）
 *   fantasy  魔幻秘境  纯黑     → 水晶秘境紫（魔法神秘紫）
 *   fairy    花仙梦境  通用紫   → 玫瑰薰衣紫（花园梦幻调）
 *   greece   希腊神话  中性黑   → 深爱琴海蓝（地中海夜空）
 *   demon    恶魔冥界  通用紫   → 深血赤褐（地狱血火）
 *   jurassic 恐龙世界  纯黑绿   → 深森林绿（侏罗丛林）
 * 共 8 款深色皮肤的 cssBg / gridOuter / gridCell 推移，使背景直接讲主题，而非仅依赖方块。
 *
 * 文化主题扩展（v10.3）：mahjong 麻将牌局（中式国粹，绿呢牌桌叙事）。
 *   8 牌精选：🀀🀁🀂🀃 风牌全集 + 🀅 發（🀄 让给 forbidden 独占）+
 *           🀇一万 / 🀙一筒 / 🀐一索 三家数牌「一」代表。
 *   配色取自传统中国色：翠青 / 朱红 / 银灰 / 玄墨 / 翡翠 / 鎏金 / 青花 / 苍竹。
 *
 * 文化主题扩展（v10.4）：boardgame 棋牌博弈（综合桌游 / 赌场氛围，v10.5 由「棋牌俱乐部」更名为四字「棋牌博弈」；v10.17.6 再更名为「扑克博弈」并把 icon 全量替换为 4 花色 × {A, K} 8 张扑克牌）。
 *   8 牌精选：🂡黑桃A / 🂮黑桃K / 🂱红心A / 🂾红心K / 🃁方片A / 🃎方片K / 🃑梅花A / 🃞梅花K（8 张代表性扑克牌的对称组合）。
 *   配色：经典赌场金/绿/蓝/银/酒红/玄墨/紫/象牙，红丝绒边 + 绿呢 cell + 酒红底，
 *   与 mahjong 纯绿呢牌桌叙事错位。
 *
 * 主题内配色去重（v10.5）：审计全部皮肤的 8 色 HSL 距离矩阵，对 8 款 minD < 2.0 的带 icon 皮肤做修正——
 *   pets       🐭 #C02820       → #5A2880 深紫       （与 🐰 红区分，0.69 → 3.10）
 *   desert     🌅 #1A6878       → #6F2890 暮霞紫     （与 🏺 陶青区分，1.48 → 2.17）
 *   farm       🌽 #B82038       → #8C5028 烤玉米棕   （与 🐄 朱红区分，1.69 → 2.33）
 *   koi        🪷 #3A9EC8       → #4070D8 莲花池蓝   （与 🏮 红灯笼蓝区分，1.95 → 3.50）
 *   food       🍔 #D87040       → #B05028 烤肉锈棕   （与 🌮 暖橙区分，2.03 → 2.81）
 *   industrial ⚒️ #D4A848       → #3A4048 深铸铁灰   （独立中性灰阶）
 *              ⛓️ #B07840       → #5C2820 暗锈链红   （与 🔩 紫铜区分，1.06 → 2.69）
 *   toon       🦘 #FF6098       → #B85828 袋鼠毛棕   （与 🐼 红粉区分，1.78 → 3.37）
 *   beast      整组 8 色重写（原色板顺序与 icons 索引错位 + 🐯/🐆 蓝色族重叠，1.78 → 5.62）
 * 所有 26 款带 icon 皮肤 minD ≥ 2.0。
 * 设计意图同族系列（titanium 钛晶 8 阶 / neonCity 霓虹 / sunset 琥珀流光暖色 / sakura 粉夜）
 * 全部为「无 blockIcons 的纯配色阶梯皮肤」，免除主题内差异度铁律。
 *
 * desert 视觉减亮（v10.5）：cssBg 由高亮沙金 #E8C878（明度 ~75%）改为柔和琥珀 #C8A868（明度 ~60%），
 *   gridOuter / gridCell / clearFlash / cssVars 同步降饱和与减亮。
 *
 * 浅色皮肤哑光降饱和（v10.6）：用户反馈 farm / desert 的 cssBg 仍偏浓——
 *   farm   #D0E5B0 (S=47%) → #DCE5C8 (S=28%) 雾绿替代鲜春绿
 *   desert #C8A868 (S=49%) → #D8C8A8 (S=35%) 米沙替代浓琥珀
 *
 * 浅色再次哑光（v10.7）：用户再次反馈仍浓——把浅色饱和度上限收紧到 ≤ 25%：
 *   farm   #DCE5C8 (S=28%) → #E6E7DC (S~19%) 骨白带一丝绿
 *   desert #D8C8A8 (S=35%) → #DAD2C4 (S~21%) 接近中性的浅米
 *   两款的 gridOuter / gridCell / clearFlash / cssVars 全套同步降饱和，blockColors 不变；
 *   主题色相由 cssVars 的小面积 accent 传达，cssBg 仅作为「带一点点暖/冷调的近骨白」；
 *   WCAG 对比度（blockColors vs gridCell 实际渲染场景）仍 ≥ 4.5 AA。
 *
 * 带 icon 皮肤 blockStyle 收敛（v10.8 · icon 呈现铁律）：
 *   立体水晶/反光材质（glossy / glass / jelly / metal）会在方块表面叠加强反光
 *   高光层（顶部 50-58% 亮带、左上角光斑、金属拉丝亮带 50% 穿心、果冻径向高光），
 *   这些光学效果会与 emoji icon 在视觉中心 (~53%) 处发生冲突，
 *   导致 icon 边缘被白光"洗白"、看起来漂浮/糊化。
 *
 *   规则：blockIcons 存在时，blockStyle 只能选择 'cartoon'（推荐）/ 'neon' / 'flat' / 'pixel8'
 *        其中 cartoon 既保留立体磨砂质感（顶高光在 52% 处淡出，左上角小光斑 27%/23%
 *        与 emoji 中心完全分离），又不干扰 icon 呈现，是带 icon 皮肤的默认选择。
 *
 *   v10.8 修正 22 款带 icon 皮肤：
 *     glass(6) → cartoon ：aurora / ocean / koi / universe / demon / fairy / pirate
 *     glossy(13)→ cartoon ：candy / pixel8 / food / beast / greece / jurassic /
 *                          forbidden / mahjong / boardgame / sports / forest / desert
 *     metal(2) → cartoon ：industrial / vehicles
 *     jelly(1) → cartoon ：bubbly
 *
 *   保留：cartoon(toon/pets/farm) 与 neon(music) — 已是 icon 友好风格
 *   不带 icon 的 7 款（titanium/sakura/sunset/dawn/fantasy/neonCity/classic；v10.32 lava 已并入 sunset）
 *   继续保留 glossy/glass/metal/neon/flat，不受此次收敛影响。
 *
 * icon 全局唯一性约束：35 款带 icon 皮肤 × 8 = 280 个 emoji 全部互不重复（另有 7 款纯配色皮肤无 icon）。
 * 详见 docs/SKINS_CATALOG.md。
 */
/** @type {Record<string, Skin>} */
export const SKINS = {

    /* ══════════════════════════════════════════
     *  基础 / 经典
     * ══════════════════════════════════════════ */

    /** 经典：高饱和六色积木 + 立体梯形浮雕（v10.32 升级 blockStyle 为 bevel3d，盘面恢复中性深灰） */
    classic: {
        id: 'classic',
        name: '✨ 极简经典',
        boardWatermark: { icons: ['🎮', '⭐'], opacity: 0.07, hdIcons: ['🕹️', '🎯', '🏁', '🎴', '🎟️'] },
        blockIcons: ['🏆', '💎', '🎯', '🎲', '♠️', '♥️', '🃏', '🎰'],
        blockColors: [
            '#6E90E1', '#4FB8E8', '#52BC4B', '#FFC428',
            '#F5851E', '#BD74E7', '#65C4F0', '#EC6B77'
        ],
        gridOuter: '#1C2630',
        gridCell:  '#2E3E50',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 4,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(220,240,255,0.90)',
        cssBg: '#141C24',
        uiDark: true,
        cssVars: {
            '--accent-color': '#4FB8E8',
            '--accent-dark':  '#FFC428',
            '--h1-color':     '#BFE0FF'
        }
    },

    /** 钛晶：蓝灰金属质感，极深冷色盘面烘托金属光泽 */
    titanium: {
        id: 'titanium',
        name: '💎 钛晶凝光',
        boardWatermark: { icons: ['💠', '🔷'], opacity: 0.07, hdIcons: ['🔶', '🔺', '🟧', '🟩', '🟦'] },
        blockIcons: ['⚙️', '🔩', '🛡️', '🔧', '💠', '⚒️', '🛠️', '⛓️'],
        blockColors: [
            '#6AAEE8', '#94BDDF', '#78B8EB', '#A8CCF0',
            '#88D0F0', '#7DBAE2', '#B4D8EC', '#8DB6D8'
        ],
        gridOuter: '#0A1020',
        gridCell:  '#182030',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 5,
        blockStyle: 'cartoon',
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

    /** 极光（整合极地）：冰川极光玻璃感，深海蓝底 */
    aurora: {
        id: 'aurora',
        name: '🌌 极光幻梦',
        boardWatermark: { icons: ['🐧', '🐻‍❄️', '❄️', '🌌'], opacity: 0.08, hdIcons: ['🧊', '☃️', '⛷️', '🌨️', '🏂'] },
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
        blockStyle: 'cartoon',
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
        name: '🌃 霓虹未眠',
        boardWatermark: { icons: ['🌃', '🏙️'], opacity: 0.07, hdIcons: ['🌆', '🚖', '🏨', '🚇', '🚥'] },
        // 都市夜景八件套：🌆日落城市 / 🚥红绿灯 / 🚇地铁 / 🎆烟花 / 🏨酒店 / 🚖出租 / 🌉夜桥 / 🛤️铁轨
        blockIcons: ['🌆', '🚥', '🚇', '🎆', '🏨', '🚖', '🌉', '🛤️'],
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
        name: '🌊 深海之瞳',
        boardWatermark: { icons: ['🦈', '🐠'], opacity: 0.07, hdIcons: ['🐳', '🐙', '🐬', '🐢', '🦑'] },
        // 深海+浅海全谱系（融合 bubbly 精华 🐬🐢，替换辨识度较低的 🪸🦑）
        blockIcons: ['🐙', '🦞', '🐡', '🐬', '🐚', '🐳', '🦈', '🐢'],
        blockColors: [
            '#00C8F0', '#0098C8', '#48D4E4', '#90F0FF',
            '#00E4C0', '#FFB347', '#FF7878', '#20E8FF'
        ],
        gridOuter: '#040E18',
        gridCell:  '#081C28',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(144,224,239,0.35)',
        cssBg: '#020A14',
        uiDark: true,
        cssVars: {
            '--accent-color': '#48CAE4',
            '--accent-dark':  '#90E0EF',
            '--h1-color':     '#ADE8F4'
        }
    },

    /** 琥珀流光（v10.32 合并 sunset+lava）：暖色宝石谱 + glass 渲染 = 立体水晶玻璃方块
     *
     * 设计意图：
     * - sunset 与 lava 的暖色定位高度重合（橙红 / 金黄 / 焰光），合并为单款
     * - 新名「琥珀流光」点出立体水晶玻璃质感（琥珀宝石 + 流动光泽）
     * - 8 色覆盖珊瑚 / 焰橙 / 琥珀 / 鎏金 / 玫瑰 / 朱砂 / 紫晶 / 蜜桃 — 暖色谱中保留多色变化
     * - blockStyle: 'glass' — 顶部高光 + 通透渐变，最贴近水晶玻璃折射效果
     */
    sunset: {
        id: 'sunset',
        name: '🌅 琥珀流光',
        boardWatermark: { icons: ['🌅', '🔆'], opacity: 0.08, hdIcons: ['🌇', '🌞', '🍹', '🥥', '🐚'] },
        blockIcons: ['🌅', '🏺', '🌼', '🏵️', '🍀', '🍂', '🌺', '🐫'],
        blockColors: [
            '#FF6A50', '#FF8E3A', '#FFB230', '#FFD638',
            '#FF7090', '#E04098', '#A858DC', '#FFAE6A'
        ],
        gridOuter: '#241019',
        gridCell:  '#341628',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,200,140,0.50)',
        cssBg: '#1A0810',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF8E3A',
            '--accent-dark':  '#FFD638',
            '--h1-color':     '#FFDAB9'
        }
    },

    /* ══════════════════════════════════════════
     *  日系美学
     * ══════════════════════════════════════════ */

    /** 樱花：夜樱场景——深胭脂粉紫夜底，粉红/翠绿/金黄方块如花瓣飘落（v10.2 主题强化：纯黑红→粉紫胭脂） */
    sakura: {
        id: 'sakura',
        name: '🌸 樱落无声',
        boardWatermark: { icons: ['🌸', '🌺'], opacity: 0.09, hdIcons: ['🌷', '🌹', '🌼', '💐', '🏵️'] },
        blockIcons: ['🌸', '🕊️', '🏯', '🎎', '🧘', '🎑', '🍶', '🥢'],
        blockColors: [
            '#FF4490', '#FF2870', '#FFB0D8', '#78D860',
            '#78B8F0', '#CC60E8', '#FFBA30', '#58D890'
        ],
        gridOuter: '#241018',
        gridCell:  '#321628',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,180,220,0.52)',
        cssBg: '#1A0810',
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
        name: '🎏 锦鲤戏月',
        boardWatermark: { icons: ['🎏', '🐟'], opacity: 0.08, hdIcons: ['🐉', '🌊', '🦞', '🦀', '⛩️'] },
        // 锦鲤池 + 日式风物：🎏鲤鱼旗 / 🎋七夕竹 / 🌊浪涌 / 🪷莲花 / ⛩️鸟居 /
        //                  🏮红灯笼 / 🎐风铃 / 🐟池中鲤
        // 移除与深海重复的 🦈🐡🐙🐠，全部换成日本意象专属 emoji
        // 蓝浪/蓝鲤放暖红底，红鸟居/红灯笼放蓝青底，全互补色
        blockIcons: ['🎋', '🌊', '🏵️', '⛩️', '🐟', '🏮', '🎐', '🎏'],
        // v10.5：🪷 #3A9EC8 (与 🏮 #38A8B8 同色族) → #4070D8 莲花池蓝，区分度提升
        blockColors: [
            '#FF5040', '#F07828', '#F0C820', '#4070D8',
            '#E880A8', '#38A8B8', '#F05888', '#D0A858'
        ],
        gridOuter: '#040E18',
        gridCell:  '#081C2C',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 9,
        blockStyle: 'cartoon',
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
        name: '🍭 糖心蜜语',
        boardWatermark: { icons: ['🍭', '🍬'], opacity: 0.09, hdIcons: ['🍦', '🧁', '🍫', '🍪', '🎂'] },
        // 纯糖果甜点（移除与 food 重复的 🍦、与 fairy 重复的 🌈）
        // 加入 🍪饼干、🍩甜甜圈，全部专属糖果系；棕色甜点压亮黄/红底，彩色棒糖压粉紫底
        blockIcons: ['🍪', '🎀', '🍫', '🍰', '🍩', '🍬', '🍭', '🧁'],
        blockColors: [
            '#FF4466', '#FF8820', '#FFD020', '#44E848',
            '#22AAFF', '#CC66FF', '#FF44BB', '#22E8CC'
        ],
        gridOuter: '#22082A',
        gridCell:  '#321048',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,200,255,0.88)',
        cssBg: '#1A0628',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF44BB',
            '--accent-dark':  '#CC2288',
            '--h1-color':     '#FFB8E8'
        }
    },

    /* ══════════════════════════════════════════
     *  卡通 / 复古
     * ══════════════════════════════════════════ */

    /** 卡通乐园（整合丛林）：原色积木 + 混合萌物图标，深漫画紫底 */
    toon: {
        id: 'toon',
        name: '🎨 童画世界',
        boardWatermark: { icons: ['🎪', '🎠'], opacity: 0.08, hdIcons: ['🤡', '🎈', '🎡', '🎭', '🤖'] },
        // v10.5：🦘 #FF6098 (与 🐼 #FF5570 同粉色族) → #B85828 袋鼠毛棕，区分两个粉系动物
        blockColors: [
            '#FF5570', '#FF7F11', '#FFD600', '#00C853',
            '#5590FF', '#DD60FF', '#D46D3A', '#00BCD4'
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
        name: '👾 像素纪元',
        boardWatermark: { icons: ['👾', '🎮', '🍄', '🥊'], opacity: 0.10, scale: 0.72, hdIcons: ['💰', '🏯', '⚔️', '🛡️', '🗡️'] },
        // 街机·8-bit·格斗：💣炸弹 / 🪙金币 / 🥊拳套 / 🎮手柄 / 👊重拳 / 🍄蘑菇 /
        //                  🕹️摇杆 / 👾外星人
        // 移除与 greece 撞色的 ⚡（雷电意象更属希腊神话），加入 💣🪙 强化「街机经典符号」
        // 暗色 icon（🎮🕹️💣👾）压亮黄/橙/品红底，金币放蓝底，蘑菇放青底
        blockIcons: ['💣', '💰', '🥊', '🎮', '👊', '🍄', '🕹️', '👾'],
        blockColors: [
            '#FF2050', '#1E78FF', '#00C030', '#F8C000',
            '#CC00CC', '#00B8C8', '#FF5800', '#90E000'
        ],
        gridOuter: '#0D0400',
        gridCell:  '#1E1008',
        gridGap: 1,
        blockInset: 2,
        blockStyle: 'cartoon',
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
     * 晨光：低饱和暖米盘面 + 清晰但不压迫的琥珀格线。
     * 浅底不再使用过重棕线和粉灰背景，避免整盘显脏、格子边界过硬。
     */
    dawn: {
        id: 'dawn',
        name: '☀️ 晨光微曦',
        boardWatermark: { icons: ['🌄', '🌻', '🕊️', '🍃'], opacity: 0.12, scale: 0.28, hdIcons: ['🐝', '🦋', '🌾', '🍯', '🌱'] },
        // 清晨田野八件套：🐝蜜蜂 / 🌱嫩芽 / 🍯蜂蜜 / 🦗蟋蟀 / 🐞瓢虫 / 🌿蕨叶 / 🪹空巢 / 🐓公鸡
        blockIcons: ['🐝', '🌱', '🍯', '🦗', '🐞', '🌿', '🐣', '🐓'],
        blockColors: [
            '#DA5244', '#4181D0', '#A67925', '#488D61',
            '#8970CC', '#378C8C', '#D15578', '#6678DC'
        ],
        gridOuter: '#D8C8A4',
        gridCell:  '#EDE0C4',
        gridLine:  'rgba(110,80,36,0.28)',
        gridGap: 0,
        blockInset: 3,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,210,130,0.72)',
        cssBg: '#D4C8AE',
        uiDark: false,
        cssVars: {
            '--text-primary':     '#2A2116',
            '--text-secondary':   '#6A5638',
            '--accent-color':     '#D98232',
            '--accent-dark':      '#A85F20',
            '--shadow':           'rgba(95,70,36,0.13)',
            '--h1-color':         '#8A4A1E',
            '--stat-surface':     'rgba(255,250,238,0.94)',
            '--stat-label-color': '#866A42',
            '--select-bg':        '#FFF8EA',
            '--select-border':    'rgba(148,104,48,0.28)'
        }
    },

    /**
     * 盛夏晴空：高饱和夏日水果色 + 海滩晴空浅底（浅色系）。
     * 浅蓝天空盘面，八色取自西瓜/芒果/椰青/晴空/薄荷/柠檬/珊瑚/紫罗兰，
     * 与 dawn（暖米晨光）/ pets（奶油萌宠）形成冷色系浅肤互补。
     */
    summer: {
        id: 'summer',
        name: '🏖️ 夏日海风',
        boardWatermark: { icons: ['☀️', '🏝️'], opacity: 0.10, hdIcons: ['🍉', '🍹', '🏄', '🧊', '🥥'] },
        // 夏日海滩八件套（全部专属，与现有 30+ 款皮肤无重复）：
        //   🍉西瓜 / 🍦冰淇淋 / 🥥椰子 / 🏝️热带岛 /
        //   🧊冰块 / 🍹饮料 / 🪁风筝 / 🏓乒乓球
        blockIcons: ['🍉', '🍦', '🥥', '🏝️', '🧊', '🍹', '🏄', '🏓'],
        blockColors: [
            '#D81C30', // 🍉 西瓜红（夏日水果代表）
            '#8B681D', // 🍦 芒果黄（冰淇淋甜筒）
            '#467A1D', // 🥥 椰青绿（椰树绿叶）
            '#3271B1', // 🏝️ 晴空蓝（海岛天空）
            '#1D7E68', // 🧊 薄荷青（冰块清凉）
            '#826D15', // 🍹 柠檬黄（冰饮柠檬）
            '#D71E1E', // 🏄 珊瑚红（冲浪与晚霞）
            '#8B44B0'  // 🏓 紫罗兰（夏日花丛）
        ],
        gridOuter: '#8AAEC8',
        gridCell:  '#A8C4D8',
        gridLine:  'rgba(30,80,130,0.32)',
        gridGap: 0,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,248,180,0.72)',
        cssBg: '#92B4CC',
        uiDark: false,
        cssVars: {
            '--text-primary':     '#162636',
            '--text-secondary':   '#3A5A72',
            '--accent-color':     '#3078C0',
            '--accent-dark':      '#1E5CA0',
            '--shadow':           'rgba(20,50,80,0.18)',
            '--h1-color':         '#E06060',
            '--stat-surface':     '#C8DCEA',
            '--stat-label-color': '#3A5A72',
            '--select-bg':        '#C8DCEA',
            '--select-border':    'rgba(40,110,170,0.32)'
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
        name: '🍕 烟火食光',
        boardWatermark: { icons: ['🍕', '🍔'], opacity: 0.08, hdIcons: ['🍣', '🍩', '🥐', '🌮', '🥗'] },
        // v10.5：🍔 #D87040 (与 🌮 #E09050 同暖橙) → #B05028 烤肉锈棕，汉堡牛肉色
        blockColors: [
            '#FF5040', '#F09020', '#F8D020', '#60B830',
            '#E09050', '#B8542A', '#F05878', '#C068F0'
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
        blockStyle: 'cartoon',
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
        name: '🎹 音律星河',
        boardWatermark: { icons: ['🎹', '🎸'], opacity: 0.08, hdIcons: ['🎷', '🥁', '🎺', '🎻', '🎤'] },
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
     * v10.20：浅色盘面方块柔化为灰调豆沙/橄榄等（色相仍分散），配合 renderer 浅色盘策略。
     */
    pets: {
        id: 'pets',
        name: '🐶 萌宠时光',
        boardWatermark: { icons: ['🐶', '🐾'], opacity: 0.09, hdIcons: ['🐱', '🐰', '🐹', '🐤', '🦊'] },
        // v10.5：🐭 深紫区分度；v10.20：整体提亮降艳
        blockColors: [
            '#B5695E', '#967660', '#7E7E51', '#57876F',
            '#648379', '#907853', '#89749F', '#877D56'
        ],
        // 家庭小宠（与 toon 动物园 / beast 猛兽完全错开，移除非小宠的 🐸🦜🐢）
        // 🐰兔子 / 🐠观赏鱼 / 🐦小鸟 / 🐱猫 / 🦎宠物蜥蜴 / 🐹仓鼠 / 🐭小白鼠 / 🐶狗
        // 浅色盘 + 深色块：白兔放深红、橙猫放深绿（互补）、绿蜥放深蓝、灰鼠紫底
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
        name: '🌑 星河漫游',
        boardWatermark: { icons: ['🌑', '⭐'], opacity: 0.07, hdIcons: ['🚀', '🛸', '🌠', '☄️', '🌙'] },
        blockColors: [
            '#E84020', '#F09030', '#D8C820', '#3898D0',
            '#D040D0', '#20B0C0', '#D88020', '#9070F0'
        ],
        // 八大天体专属：🛸UFO / 🌍地球 / 🔭望远镜 / 🌙月 / ⭐星 / 🌑新月 / ☄️彗星 / 🌠流星
        // 与 aurora 的 🌌（星云/极光）错开；黄色月/星避开金黄块，全互补色
        blockIcons: ['🛸', '🌍', '🔭', '🌙', '⭐', '🌑', '☄️', '🌠'],
        gridOuter: '#04020E',
        gridCell:  '#0A0618',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
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

    /** 魔幻：紫水晶/蓝宝石/祖母绿/红宝石等宝石矿物配色，深神秘紫底（v10.2 主题强化：纯黑→水晶秘境紫） */
    fantasy: {
        id: 'fantasy',
        name: '🔮 幻梦之境',
        boardWatermark: { icons: ['🔮', '✨'], opacity: 0.08, hdIcons: ['🧙', '🌟', '🧝', '🧞', '🧿'] },
        // 魔法奇幻八件套：🧙巫师 / 🧝精灵 / 🧞灯神 / 💫星闪 / 🗝️钥匙 / 📿念珠 / 🪬护符 / 🪩幻球
        blockIcons: ['🧙', '🧝', '🧞', '💫', '🗝️', '📿', '🧿', '🔮'],
        blockColors: [
            '#CC48FF', '#5080F0', '#18B848', '#E82020',
            '#E8B820', '#20B0D8', '#E020A0', '#9060E0'
        ],
        gridOuter: '#0E0428',
        gridCell:  '#1A0838',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(160,80,255,0.42)',
        cssBg: '#0A0420',
        uiDark: true,
        cssVars: {
            '--accent-color': '#9828D8',
            '--accent-dark':  '#BB50F0',
            '--h1-color':     '#CC88FF'
        }
    },

    // 主题：希腊神话（奥林匹斯诸神，每色对应一位神明专属符号）
    // 宙斯⚡ / 波塞冬🔱 / 雅典娜🏛️ / 阿波罗🌞 / 阿尔忒弥斯🏹 / 狄俄尼索斯🍇 / 赫拉🦚 / 哈迪斯💀
    greece: {
        id: 'greece',
        name: '🏛️ 众神之诗',
        boardWatermark: { icons: ['🏛️', '⚡'], opacity: 0.08, hdIcons: ['🦉', '🏺', '🗿', '🏹', '🐎'] },
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
        gridOuter:   '#040A18',
        gridCell:    '#0A1228',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 7,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(230,195,40,0.52)',
        cssBg:       '#020812',
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
        name: '😈 永夜咏叹',
        boardWatermark: { icons: ['😈', '💀'], opacity: 0.08, hdIcons: ['👻', '🦇', '🕷️', '🕸️', '👹'] },
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
        gridOuter:   '#160408',
        gridCell:    '#341018',
        gridLine:    'rgba(255,112,136,0.24)',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 5,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(220,30,40,0.48)',
        cssBg:       '#0E0408',
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
        name: '🦕 远古之息',
        boardWatermark: { icons: ['🦕', '🦖'], opacity: 0.08, hdIcons: ['🦴', '🌋', '🥚', '🗻', '🦎'] },
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
        gridOuter:   '#0E1A06',
        gridCell:    '#1A2A0E',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 5,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(160,220,60,0.50)',
        cssBg:       '#0A1408',
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
        name: '🧚 花语星梦',
        boardWatermark: { icons: ['🧚', '🌸'], opacity: 0.08, hdIcons: ['🦌', '🐿️', '🍄', '🍂', '🌰'] },
        // 花仙系专属：🧚花仙子 / 🦋蝶仙 / 🌹玫瑰 / 🌷郁金香 / 🌻向日葵 / 🍃嫩叶 / 🪄魔棒 / 🌈彩虹
        // 黄向日葵/绿嫩叶/红玫瑰落紫/粉/品红底 → 强冷暖反差；蝴蝶蓝放粉底，樱花粉换为玫瑰
        blockIcons: ['🌻', '🦋', '🌹', '🍃', '🌟', '🌷', '🌈', '🧚'],
        blockColors: [
            '#D060F0', // 🧚 花仙子紫（精灵）
            '#F060A0', // 🌸 樱花粉（浪漫）
            '#60A0F8', // 🦋 蝶翼蓝（自由）
            '#F07060', // 🌺 玫瑰珊瑚（热情）
            '#F040A0', // 🌷 郁金香玫红
            '#9B72F0', // 🌟 星光紫（与金黄 emoji 拉开色相）
            '#F09040', // 🍄 蘑菇橙（童话）
            '#40D0E8', // 🌈 彩虹青（梦幻）
        ],
        gridOuter:   '#1F0E2C',
        gridCell:    '#2C1640',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 9,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(240,150,240,0.52)',
        cssBg:       '#150A24',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#D060F0',
            '--accent-dark':  '#E890FF',
            '--h1-color':     '#F0B8FF'
        }
    },

    /* ══════════════════════════════════════════
     *  文化主题（中华皇城）
     * ══════════════════════════════════════════ */

    /**
     * 北京皇城（紫禁城 / 故宫）：朱红宫墙 + 龙袍金 + 翡翠玉 + 青花蓝 + 牙白瓷的中式皇家配色，
     * 玄朱深底烘托琉璃光泽。Glossy 渲染表现宫廷漆器、琉璃瓦、汝窑釉的温润光感。
     */
    forbidden: {
        id: 'forbidden',
        name: '👑 紫禁浮光',
        boardWatermark: { icons: ['👑', '🐲'], opacity: 0.08, hdIcons: ['🎭', '🧧', '🏮', '🥢', '🍵'] },
        // 紫禁城八件套（全部专属，注意 🐲 龙颜 ≠ jurassic 的 🐉 翼龙）：
        //   🐲龙颜 / 👑凤冠皇冠 / 🪭折扇 / 🧧红包 / 🥮月饼 /
        //   🀄麻将红中 / 📜圣旨卷轴 / 🍵御茶
        // 配色取材故宫：朱红宫墙·龙袍金·翡翠玉柄·牙白瓷·龙鳞青·琉璃棕黄·青花蓝·桃红
        // 绿龙↔朱红、金冠↔翡翠、扇↔青花、红包↔牙白：全部冷暖/明度强反差。
        blockIcons: ['🐲', '👑', '🎭', '🧧', '🥮', '🀄', '📜', '🍵'],
        blockColors: [
            '#D8252F', // 🐲 朱红宫墙（绿龙颜↔大红 强反差）
            '#1B7E5C', // 👑 翡翠玉绿（金凤冠↔玉绿）
            '#2B6BD6', // 🎭 青花蓝（戏曲面具↔深靛）
            '#D8CCB0', // 🧧 牙白瓷（朱红包↔象牙）
            '#E8B83C', // 🥮 龙袍金（暖棕月饼↔金）
            '#317891', // 🀄 龙鳞青（红中↔青）
            '#B8732C', // 📜 琉璃棕黄（米卷轴↔铜黄）
            '#E84068'  // 🍵 桃红（绿茶↔粉红）
        ],
        gridOuter:   '#1C0608',
        gridCell:    '#2A0E12',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 6,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(232,184,60,0.52)',
        cssBg:       '#160406',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#E8B83C',
            '--accent-dark':  '#C8222C',
            '--h1-color':     '#FFE090'
        }
    },

    /**
     * 麻将牌局（中式国粹）— v10.17.3 重制配色，提升主题搭配度：
     *   旧版 cssBg #0A1812 + gridCell #143028 几乎黑底，与"绿呢牌桌+茶馆暖灯"的麻将印象错位。
     *   新版三层叙事：
     *     1) cssBg #1F1810 → 茶馆实木地砖 / 暖光氛围底
     *     2) gridOuter #3D2818 → 牌桌实木台沿（深棕红，与朱红南风牌呼应）
     *     3) gridCell  #2A4A38 → 经典绿呢（emerald felt 略明亮，可见空格但不死黑）
     *   方块明度跨度从 30→73，与 L≈22% 的绿呢呈足够反差；高饱和暖色（朱砂红/蜜蜡金/牙白）
     *   营造"温暖牌局"氛围，与 forbidden（皇家器物冷艳） / boardgame（赌场酒红）完全错位。
     *
     * 风牌 4 张 + 三元绿（發） + 万/筒/索三种数牌的「一」代表（避开 forbidden 已用的 🀄 中）。
     * 8 色 minD 满足 v10.5 去重：色相覆盖 37→356°，明度跨度 ≥ 40%。
     * blockStyle: 'cartoon'（v10.8 带 icon 主题强制使用，避免水晶质地遮挡 emoji）。
     * v10.22：产品要求「icon 与麻将严格一致」—— blockIcons 固定为 **麻将牌专用区段**（U+1F000 系列），
     *   与皮肤名/水印的「發」牌面字形同源；🀄 红中仍归 forbidden 独占。
     * v10.23：渲染层 `paintMahjongTileIcon` 在牌心绘制 **象牙立体牌面 + 细金边 + 传统设色阴刻字**（参考红中），
     *   字色见 `mahjongTileIcon.js` 之 MAHJONG_TILE_INK；图鉴 CSS `.lore-card__icons--mahjong` 与之对齐。
     * v10.24：麻将 icon **扁平简化**——方形象牙底 + 赭金外缘 + **同色圆角内框线** + 框内字；框与字整体相对象牙块居中。
     * v10.25：**极简**——格心仅 **一层竖长圆角矩形**（类麻将比例）+ 奶油底 + **同色单描边** + 框内字；矩形与字均相对格子/框区居中，无金边与嵌套框。
     * v10.26：牌块宽高按 **实体牌 21:29**；去掉主题色矩形框线，**字直接印在奶油牌面**上尽量放大并保持居中。
     * v10.27：**去掉奶油麻将块底**；仅在格内按 **21:29** 虚拟竖条区域放大绘字（占格高达 ~94%），更醒目。
     * v10.29：皮肤图鉴麻将行用 **canvas** 调 `renderer.paintMahjongLorePreviewTile`，与盘面 cartoon 块 + `paintMahjongTileIcon` 同管线；blockIcons 仍为 🀀–🀐。
     */
    mahjong: {
        id: 'mahjong',
        name: '🀄 牌影江湖',
        /* v1.49 (2026-05) — HD 模式"麻将特色 emoji 换装"：
         *   仅替换 emoji 选型，**亮度 / scale / 锚点 / 漂浮节奏全部与其他皮肤完全一致**。
         *
         *   - 基础水印：['🀅', '🀀'] 發 + 东，2 件、opacity 0.10
         *   - HD 水印：  ['🎲', '🀐', '🀙', '🀇', '🀄'] 骰子 + 一索（幺鸡 / 港粤"打雀"的雀）
         *               + 一筒 + 一万 + 红中，**5 件套**（与默认锚点数 5 完全对齐 ——
         *               盘面同时显示的 5 个水印 emoji 两两不同，杜绝"图片重复"），
         *               依然继承基础 opacity 0.10、依然走默认 5 锚点 + 默认 scale +
         *               默认 segment 时长。骰子是麻将开局的灵魂道具；一索（幺鸡）是
         *               麻将"雀"的具象；一筒/一万选「一」头牌代表筒子/万子两门数牌；
         *               红中是麻将的精神图腾，配齐"骰⇒数⇒字"完整国粹叙事。
         *
         * 渲染契约：boardWatermark 顶层 icons / opacity / scale 是基础锚定值；
         * hdIcons / hdOpacity / hdScale / hdAnchors 是 HD 模式可选覆盖项，任一
         * 缺失则继承基础值。**麻将仅覆盖 hdIcons**，其余字段全部保持与基础一致 ——
         * 这与 v1.49 中"所有 HD 皮肤亮度 / 运动模式一致 + 单局水印图片不重复"
         * 双重产品约束对齐。
         *
         * v1.49 修订记录：
         *   - v1：6 件套 + 自定义 6 锚点（六侧分布）→ 破坏运动模式一致性，回退
         *   - v2：3 件套 + hdOpacity 0.13 → 亮度高于所有皮肤（dawn 0.12 已是最高），回退
         *   - v3：2 件套 + 无 hdOpacity → 5 锚点上 i%2 循环导致 3 个 🎲 重复，回退
         *   - 当前 v4：**5 件套**（=默认锚点数）+ 无 hdOpacity，盘面 5 个水印两两不同 */
        boardWatermark: {
            icons: ['🀅', '🀀'],
            opacity: 0.10,
            hdIcons: ['🎲', '🀐', '🀙', '🀇', '🀄'],
        },
        // 列表前缀用 🀄（红中）提高彩色字形面积；盘面 blockIcons 仍为 U+1F000 八牌（🀅 發 等）
        blockIcons: ['🀀', '🀁', '🀂', '🀃', '🀅', '🀇', '🀙', '🀐'],
        blockColors: [
            '#4FC0A1', // 🀀 东 — 浅碧绿（东方青龙，明亮清透，与绿呢拉开明度）
            '#D9848B', // 🀁 南 — 朱砂红（南方朱雀，国画传统红，与暖色背景呼应）
            '#D4C4A0', // 🀂 西 — 牙白（西方白虎，象牙瓷面，绿呢上最高明度）
            '#919BAF', // 🀃 北 — 玄墨蓝灰（北方玄武，深沉天玄）
            '#36AF90', // 🀅 發 — 翡翠（三元发财，深翡翠，比东更深一档）
            '#E6B263', // 🀇 一万 — 蜜蜡黄金（红万字烫金，温暖发"赢"色）
            '#6C9DDA', // 🀙 一筒 — 青花钴蓝（筒上瓷器经典）
            '#B9B148'  // 🀐 一索 — 苍竹黄绿（索绿带黄，与翡翠／东错位）
        ],
        gridOuter:   '#3D2818',   // 实木台沿（深棕红，茶馆木质牌桌）
        gridCell:    '#2A4A38',   // 经典绿呢（emerald felt，可见空格）
        gridGap:     1,
        blockInset:  2,
        blockRadius: 6,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(180,220,150,0.50)',  // 翠绿亮闪（呼应绿呢）
        cssBg:       '#1F1810',   // 茶馆暖灯下的实木地砖背景
        uiDark:      true,
        cssVars: {
            '--accent-color': '#E0A040',  // 蜜蜡黄金 — 温暖的"胡牌"色
            '--accent-dark':  '#C4884A',
            '--h1-color':     '#E8C470'
        }
    },

    /**
     * 山林秘境：树木 / 落叶 / 麦穗 / 木桩 / 鸟巢，苔藓深绿底 + 秋日色块。
     * Glossy 渲染呈现湿润树叶与树皮纹理感。
     */
    forest: {
        id: 'forest',
        name: '🌳 荒野秘境',
        boardWatermark: { icons: ['🌳', '🍁'], opacity: 0.08, hdIcons: ['🌲', '🐻', '🐗', '🦔', '🍇'] },
        // 林木+猛兽融合（吸收 beast 精华 🐺🦅🐻，替换 🌴🍂🪵）
        blockIcons: ['🌳', '🌲', '🐺', '🍁', '🦅', '🌾', '🐻', '🍄'],
        blockColors: [
            '#A5682F', // 🌳 焦糖棕
            '#D97B3C', // 🌲 暖橙树根
            '#6B7BA2', // 🐺 钢蓝灰
            '#518349', // 🍁 苔绿
            '#D4A028', // 🦅 鎏金
            '#C4497F', // 🌾 紫红
            '#A36934', // 🐻 棕熊
            '#5392C9'  // 🍄 天蓝
        ],
        gridOuter:   '#06140A',
        gridCell:    '#0E2010',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 7,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(180,255,160,0.45)',
        cssBg:       '#040E06',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#38A878',
            '--accent-dark':  '#60C898',
            '--h1-color':     '#A8E8C0'
        }
    },

    /**
     * 果韵匠心：致敬乔布斯与 Apple 的经典设计哲学。
     * 八色取自 Apple 标志性产品配色——银、深空灰、金、玫瑰金、午夜、远峰蓝、深紫、(PRODUCT)RED。
     * 极窄黑盘面 + glass 渲染模拟精密陶瓷与冷冽玻璃的温润通透，
     * 无 icon 干扰，呈现纯粹的几何之美。至繁归于至简。
     */
    apple: {
        id: 'apple',
        name: '🍎 果韵匠心',
        boardWatermark: { icons: ['🍎', '✨'], opacity: 0.05, hdIcons: ['⚪', '⬜', '🔘', '◻️', '🔲'] },
        blockIcons: ['🍎', '💻', '✈️', '🚀', '📡', '🔋', '💾', '🔌'],
        blockColors: [
            '#C8C8CC', // 银色 — MacBook / iPad 铝合金
            '#8E8E93', // 深空灰 — iPhone / MacBook Pro
            '#D4B88C', // 金色 — iPhone 5S 香槟金
            '#E8B4B8', // 玫瑰金 — iPhone 6S
            '#5F7488', // 午夜 — MacBook Air / iPhone 暗色系
            '#A8BCC8', // 远峰蓝 — iPhone 13 Pro
            '#6261E7', // 深紫色 — iPhone 14 Pro
            '#E55934'  // (PRODUCT)RED — 经典红
        ],
        gridOuter: '#0E0E12',
        gridCell:  '#1A1A20',
        gridLine:  'rgba(255,255,255,0.07)',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(200,200,220,0.30)',
        cssBg: '#09090D',
        uiDark: true,
        cssVars: {
            '--accent-color': '#8E8E93',
            '--accent-dark':  '#C8C8CC',
            '--h1-color':     '#D4D4D8'
        }
    },

    /** 午后咖啡：暖棕治愈 + 书吧氛围，浅色系 */
    cafe: {
        id: 'cafe',
        name: '☕ 午后咖啡',
        boardWatermark: { icons: ['☕', '📖'], opacity: 0.10 },
        blockIcons: ['☕', '📖', '🧋', '🌵', '🕯️', '🥐', '🎵', '📝'],
        blockColors: [
            '#8A6A50', '#6A7A6A', '#997356', '#548172',
            '#947556', '#707E61', '#8A6A6A', '#617E7E'
        ],
        gridOuter: '#C0AC90',
        gridCell:  '#D8CCBA',
        gridLine:  'rgba(90,66,38,0.24)',
        gridGap: 0,
        blockInset: 3,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(210,180,140,0.65)',
        cssBg: '#C8BAAA',
        uiDark: false,
        cssVars: {
            '--text-primary':     '#2A2018',
            '--text-secondary':   '#6A5A48',
            '--accent-color':     '#A07848',
            '--accent-dark':      '#7A5830',
            '--shadow':           'rgba(90,60,30,0.12)',
            '--h1-color':         '#6A4A28',
            '--stat-surface':     'rgba(242,232,216,0.94)',
            '--stat-label-color': '#7A6A58',
            '--select-bg':        '#F2E8D8',
            '--select-border':    'rgba(120,90,60,0.22)'
        }
    },

    /** 欢庆嘉年：派对 / 节日 / 彩旗 / 烟花，全年龄 */
    fiesta: {
        id: 'fiesta',
        name: '🎉 欢庆嘉年',
        boardWatermark: { icons: ['🎉', '🎊'], opacity: 0.08 },
        blockIcons: ['🎉', '🎊', '🎈', '🎠', '🥳', '🎁', '🧨', '🎪'],
        blockColors: [
            '#FF3058', '#FF9020', '#FFD028', '#30D850',
            '#2098FF', '#CC40FF', '#FF50A0', '#20D0D0'
        ],
        gridOuter: '#180828',
        gridCell:  '#281040',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,220,100,0.85)',
        cssBg: '#100420',
        uiDark: true,
        cssVars: {
            '--accent-color': '#FF3058',
            '--accent-dark':  '#FFD028',
            '--h1-color':     '#FFB0D0'
        }
    },

};

export const SKIN_LIST = Object.values(SKINS);

/** 皮肤分类（与 SKINS_CATALOG.md 大类对齐，合并小类以减少选择噪音） */
export const SKIN_CATEGORIES = [
    { id: 'classic',   label: '🔰 经典 · 科技', skins: ['classic', 'titanium', 'aurora', 'neonCity', 'candy', 'toon', 'pixel8'] },
    { id: 'nature',    label: '🌿 自然 · 清新', skins: ['ocean', 'sunset', 'forest', 'dawn', 'summer', 'cafe', 'sakura'] },
    { id: 'life',      label: '🏷️ 生活 · 庆典', skins: ['food', 'music', 'pets', 'universe', 'fiesta', 'apple', 'koi'] },
    { id: 'fantasy',   label: '🧿 奇幻 · 文化', skins: ['fantasy', 'fairy', 'greece', 'demon', 'jurassic', 'forbidden', 'mahjong'] },
];

/**
 * 按分类返回皮肤列表（过滤掉 SKINS 中不存在的 id）
 * @returns {Array<{id: string, label: string, skins: Skin[]}>}
 */
export function getSkinCategories() {
    return SKIN_CATEGORIES.map(cat => ({
        ...cat,
        skins: cat.skins.filter(id => SKINS[id]).map(id => SKINS[id]),
    })).filter(cat => cat.skins.length > 0);
}
export function getActiveSkinId() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_SKIN_ID;
        const id = Object.prototype.hasOwnProperty.call(REMOVED_SKIN_ALIASES, raw)
            ? REMOVED_SKIN_ALIASES[raw]
            : raw;
        if (id !== raw) {
            try { localStorage.setItem(STORAGE_KEY, id); } catch { /* ignore */ }
        }
        if (SKINS[id]) return id;
    } catch {
        /* ignore */
    }
    return DEFAULT_SKIN_ID;
}

/** @returns {Skin} */
export function getActiveSkin() {
    return SKINS[getActiveSkinId()] || SKINS[DEFAULT_SKIN_ID];
}

/**
 * RL / 无头模拟器用的 bonus 与 dock 染色偏置皮肤（非玩家当前主题）。
 * 为保证浏览器无头局与 Python RL 完全一致，只读取 shared/game_rules.json
 * 中的 rlBonusScoring.blockIcons；为空时退化为同色判定。
 *
 * @returns {{ blockIcons: string[] } | null}
 */
export function getRlTrainingBonusLineSkin() {
    const cfg = GAME_RULES.rlBonusScoring || {};
    if (cfg.useGameplayBonusRules === false) {
        return null;
    }
    const raw = cfg.blockIcons;
    if (Array.isArray(raw) && raw.length > 0) {
        return { blockIcons: raw.map((x) => String(x)) };
    }
    return null;
}

export function getBlockColors() {
    return getActiveSkin().blockColors;
}

/**
 * v10.15: 皮肤切换钩子 — 由 skinTransition.js 注册，可拦截 setActiveSkinId 的实际生效时机
 * 让转场动画在淡入到峰值时再 applyImmediate()，呈现"主题色一闪覆盖 cssVars 替换"的效果。
 */
let _skinTransitionHook = null;
export function setSkinTransitionHook(hook) {
    _skinTransitionHook = (typeof hook === 'function') ? hook : null;
}

/**
 * v10.16: 皮肤切换后回调（不影响 transition）— 多个订阅者并存。
 * 用于 firstUnlockCelebration 等不需要拦截 apply 时机的副作用模块。
 */
const _afterApplyListeners = [];
export function onSkinAfterApply(fn) {
    if (typeof fn !== 'function') return () => { /* noop */ };
    _afterApplyListeners.push(fn);
    return () => {
        const i = _afterApplyListeners.indexOf(fn);
        if (i >= 0) _afterApplyListeners.splice(i, 1);
    };
}
function _emitAfterApply(id) {
    for (const fn of _afterApplyListeners) {
        try { fn(id); } catch (e) { console.warn('[skin onAfterApply]', e); }
    }
}

/**
 * @param {string} id
 * @returns {boolean} 是否成功切换
 */
export function setActiveSkinId(id) {
    if (!SKINS[id]) return false;
    const apply = () => {
        try {
            localStorage.setItem(STORAGE_KEY, id);
        } catch {
            /* ignore */
        }
        applySkinToDocument(SKINS[id]);
        _emitAfterApply(id);
    };
    if (_skinTransitionHook) {
        try { _skinTransitionHook(id, apply); }
        catch { apply(); }
    } else {
        apply();
    }
    return true;
}

/** 是否应在首字符后插入 U+FE0F，以尽量使用彩色 emoji 字形（深色 HUD 下避免纯黑剪影） */
function _skinPickerLeadingNeedsVs16(cp) {
    if (cp >= 0x2660 && cp <= 0x2668) return true;
    if (cp === 0x2693 || cp === 0x2699 || cp === 0x267B) return true;
    if (cp === 0x266A || cp === 0x266B) return true;
    if (cp === 0x1F3B5 || cp === 0x1F43E || cp === 0x1F579) return true;
    if (cp === 0x1F3B6 || cp === 0x1F436 || cp === 0x1F0CF) return true;
    if (cp === 0x1F4BB || cp === 0x1F310 || cp === 0x1F4CA || cp === 0x1F4BE || cp === 0x1F6F0) return true;
    if (cp === 0x1F916 || cp === 0x1F5A5 || cp === 0x1F4E1 || cp === 0x1F9BF || cp === 0x1F5C4) return true;
    if (cp === 0x1F697 || cp === 0x1F3D6 || cp === 0x1F9A6) return true;
    if (cp === 0x1F4AC || cp === 0x2601 || cp === 0x26C5 || cp === 0x1F9E9 || cp === 0x1F50B || cp === 0x1F4F2) return true;
    if (cp >= 0x1F000 && cp <= 0x1F021) return true;
    if (cp === 0x1F3B9 || cp === 0x1F47E || cp === 0x1F99C || cp === 0x1F3ED) return true;
    return false;
}

/**
 * 皮肤下拉 `<option>` 标签：为首枚图形字符补 emoji 呈现（VS16），减轻 ♠⚓🎵🐾🕹 等在深色界面发黑。
 * @param {string} text
 */
export function normalizeSkinPickerLabel(text) {
    if (!text || typeof text !== 'string') return text;
    const cp = text.codePointAt(0);
    if (cp === undefined) return text;
    const firstLen = cp > 0xffff ? 2 : 1;
    /* 🏴‍☠️ 等 ZWJ 旗帜序列：禁止在首 grapheme 后插入 VS16 */
    if (text.length > firstLen && text.charAt(firstLen) === '\u200D') return text;
    if (!_skinPickerLeadingNeedsVs16(cp)) return text;
    if (text.length > firstLen && text.charAt(firstLen) === '\uFE0F') return text;
    return text.slice(0, firstLen) + '\uFE0F' + text.slice(firstLen);
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
    root.dataset.uiTheme = skin.uiDark ? 'dark' : 'light';

    root.style.setProperty('--grid-bg', skin.gridOuter);
    root.style.setProperty('--cell-empty', skin.gridCell);
    root.style.setProperty('--grid-line', skin.gridLine || (skin.uiDark ? 'rgba(255,255,255,0.16)' : 'rgba(15,23,42,0.18)'));
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
