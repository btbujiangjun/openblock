/**
 * 方块与盘面主题（换肤）
 * 持久化键：localStorage.openblock_skin
 */

import { GAME_RULES } from './gameRules.js';

const STORAGE_KEY = 'openblock_skin';

/** 已下线皮肤 id → 迁移目标（读档时自动改写 localStorage）
 *  v10.31：cyber/macaroon 下线
 *  v10.32：neural → neonCity；lava → sunset（与 sunset 合并为「琥珀流光」） */
const REMOVED_SKIN_ALIASES = {
    cyber: 'neonCity',
    macaroon: 'dawn',
    neural: 'neonCity',
    lava: 'sunset'
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
 * 皮肤总量：34 款（v10.31 剔除 `cyber`→`neonCity`、`macaroon`→`dawn`；
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
 * icon 全局唯一性约束：27 款带 icon 皮肤 × 8 icon = 216 个 emoji 全部互不重复。
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
        boardWatermark: { icons: ['🎮', '⭐'], opacity: 0.07 },
        // 休闲消除经典 8 色：皇家蓝 / 天蓝 / 翠绿 / 金黄 / 橙 / 紫 / 浅蓝 / 朱红
        blockColors: [
            '#3F6DD8', '#4FB8E8', '#52BC4B', '#FFC428',
            '#F5851E', '#A848E0', '#65C4F0', '#E84D5C'
        ],
        gridOuter: '#1C2630',
        gridCell:  '#2E3E50',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 4,
        blockStyle: 'bevel3d',
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
        boardWatermark: { icons: ['🌅', '🔆'], opacity: 0.08 },
        blockColors: [
            '#FF6A50', '#FF8E3A', '#FFB230', '#FFD638',
            '#FF7090', '#E04098', '#A858DC', '#FFAE6A'
        ],
        gridOuter: '#241019',
        gridCell:  '#341628',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glass',
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
        name: '🌸 樱花飞雪',
        boardWatermark: { icons: ['🌸', '🌺'], opacity: 0.09 },
        blockColors: [
            '#FF4490', '#FF2870', '#FFB0D8', '#78D860',
            '#78B8F0', '#CC60E8', '#FFBA30', '#58D890'
        ],
        gridOuter: '#241018',
        gridCell:  '#321628',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 8,
        blockStyle: 'glass',
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
        name: '🎏 锦鲤跃龙',
        boardWatermark: { icons: ['🎏', '🐟'], opacity: 0.08 },
        // 锦鲤池 + 日式风物：🎏鲤鱼旗 / 🎋七夕竹 / 🌊浪涌 / 🪷莲花 / ⛩️鸟居 /
        //                  🏮红灯笼 / 🎐风铃 / 🐟池中鲤
        // 移除与深海重复的 🦈🐡🐙🐠，全部换成日本意象专属 emoji
        // 蓝浪/蓝鲤放暖红底，红鸟居/红灯笼放蓝青底，全互补色
        blockIcons: ['🎋', '🌊', '🪷', '⛩️', '🐟', '🏮', '🎐', '🎏'],
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
        name: '🍭 糖果甜心',
        boardWatermark: { icons: ['🍭', '🍬'], opacity: 0.09 },
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

    /** 泡泡糖：Q 弹果冻海洋生物，深紫底衬托高饱和果冻色 */
    bubbly: {
        id: 'bubbly',
        name: '🫧 元气泡泡',
        boardWatermark: { icons: ['🫧', '🐡'], opacity: 0.09 },
        blockColors: [
            '#FF72BB', '#4898F8', '#42C442', '#FFAA18',
            '#22C87A', '#E060FF', '#FF8848', '#12C4E8'
        ],
        // 萌系浅海 + 沙滩意象 + 果冻气泡（与 ocean「深渊」错位）：🫧 专属签名
        // 🦦水獭 / 🏖️沙滩 强化水域休闲叙事，避免陆生 🦩🌿 与主题割裂
        blockIcons: ['🐬', '🦦', '🪼', '🏖️', '🦀', '🐢', '🫧', '🦐'],
        gridOuter: '#2A1048',
        gridCell:  '#401870',
        gridGap: 1,
        blockInset: 1,
        blockRadius: 14,
        blockStyle: 'cartoon',
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
        // v10.5：🦘 #FF6098 (与 🐼 #FF5570 同粉色族) → #B85828 袋鼠毛棕，区分两个粉系动物
        blockColors: [
            '#FF5570', '#FF7F11', '#FFD600', '#00C853',
            '#5590FF', '#DD60FF', '#B85828', '#00BCD4'
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
        name: '👾 街机格斗',
        boardWatermark: { icons: ['👾', '🎮', '🍄', '🥊'], opacity: 0.10, scale: 0.72 },
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
        boardWatermark: { icons: ['🌄', '🌻', '🕊️', '🍃'], opacity: 0.12, scale: 0.28 },
        blockColors: [
            '#E06E62', '#5A92D6', '#D8A84E', '#55A873',
            '#8D75CE', '#42A7A8', '#D46282', '#6B7DDD'
        ],
        gridOuter: '#F1E3C5',
        gridCell:  '#FFF3D8',
        gridLine:  'rgba(130,96,48,0.13)',
        gridGap: 0,
        blockInset: 3,
        blockRadius: 7,
        blockStyle: 'cartoon',
        clearFlash: 'rgba(255,210,130,0.72)',
        cssBg: '#F7F0DC',
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
        // v10.5：🍔 #D87040 (与 🌮 #E09050 同暖橙) → #B05028 烤肉锈棕，汉堡牛肉色
        blockColors: [
            '#FF5040', '#F09020', '#F8D020', '#60B830',
            '#E09050', '#B05028', '#F05878', '#C068F0'
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
        name: '🎹 音乐律动',
        boardWatermark: { icons: ['🎹', '🎸'], opacity: 0.08 },
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
        name: '🐶 萌宠天地',
        boardWatermark: { icons: ['🐶', '🐾'], opacity: 0.09 },
        // v10.5：🐭 深紫区分度；v10.20：整体提亮降艳
        blockColors: [
            '#C89088', '#B8A090', '#A8A878', '#78A890',
            '#98B0A8', '#C8B8A0', '#A898B8', '#B8B090'
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
        name: '🔮 魔幻秘境',
        boardWatermark: { icons: ['🔮', '✨'], opacity: 0.08 },
        blockColors: [
            '#CC48FF', '#5080F0', '#18B848', '#E82020',
            '#E8B820', '#20B0D8', '#E020A0', '#9060E0'
        ],
        gridOuter: '#0E0428',
        gridCell:  '#1A0838',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 7,
        blockStyle: 'glass',
        clearFlash: 'rgba(160,80,255,0.42)',
        cssBg: '#0A0420',
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
        // v10.5 重做：原色板顺序与 icons 不对齐（注释里 #40A0D8 标 🦈 但实际 idx7 是 🐻），
        //          且 🐯/🐻 共占近蓝色族 (#5090D8 vs #40A0D8) 视觉混淆。
        //          重写为 8 色全互补（钢蓝灰 / 深红 / 深天蓝 / 深紫 / 林绿 / 鎏金 / 苔绿 / 棕熊），
        //          逐 icon 对齐其互补色或本色，minD ≥ 5。
        blockIcons: ['🐺', '🦏', '🐯', '🦁', '🐗', '🦅', '🐆', '🐻'],
        blockColors: [
            '#6878A0', // 🐺 钢蓝灰（灰狼↔冷蓝灰，明度反差）
            '#A82820', // 🦏 深红（灰犀↔互补红，最强冷暖反差）
            '#3878C8', // 🐯 深天蓝（黑橙虎↔互补蓝）
            '#5C2880', // 🦁 深紫（金狮↔互补正补深紫）
            '#2A6028', // 🐗 林深绿（棕黑野猪↔深林绿，狩猎场景一致）
            '#D4A028', // 🦅 鎏金（褐鹰↔金底，王者威严）
            '#4A6020', // 🐆 苔绿（豹↔黄绿丛林，与 #2A6028 林绿区分明度）
            '#7C5028'  // 🐻 棕熊本色（熊本色↔大地棕）
        ],
        gridOuter:   '#150C04',
        gridCell:    '#221608',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 6,
        blockStyle:  'cartoon',
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
        gridOuter:   '#160408',
        gridCell:    '#280A12',
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
     *  文化主题（工业革命 / 中华皇城）
     * ══════════════════════════════════════════ */

    /**
     * 古典工业（维多利亚 / 蒸汽朋克）：黄铜、紫铜、铁锈红与钢蓝构成的工业革命调色板，
     * 焦煤铸铁底烘托金属机械美。Metal 渲染表现齿轮、铆钉、铜管的金属反光质感。
     */
    industrial: {
        id: 'industrial',
        name: '🏭 古典工业',
        boardWatermark: { icons: ['🏭', '⚙️'], opacity: 0.08 },
        // 蒸汽朋克八件套（全部专属，未与现有 16 款 icon 皮肤重复）：
        //   ⚙️齿轮 / 🔧扳手 / 🔩螺栓 / 🛠️锤扳工具 / ⛓️锁链 /
        //   🚂蒸汽火车 / 🏭工厂烟囱 / ⚒️锤镐
        // emoji 多为银/灰/暗调，主色调用「黄铜·紫铜·锈红·暗金」暖金属，单留一格钢蓝
        // 给 🏭 工厂（白烟+冷蓝厂房意象）；银工具放黄铜/锈红/暗金底反差最强。
        blockIcons: ['⚙️', '🔧', '🔩', '🛠️', '⛓️', '🚂', '🏭', '⚒️'],
        // v10.5：⚒️ #D4A848 (与 ⚙️ #D49640 同金属色) → #3A4048 深铸铁灰锤镐
        //       ⛓️ #B07840 (与 🔩 #B86838 紫铜橙同色族) → #5C2820 暗锈链红，区分锁链与螺栓
        blockColors: [
            '#D49640', // ⚙️ 黄铜金（齿轮主体象征）
            '#C04030', // 🔧 铁锈红（银扳手强反差）
            '#B86838', // 🔩 紫铜橙（暖金属铆接）
            '#4F9080', // 🛠️ 铜锈青（patina 翠铜）
            '#5C2820', // ⛓️ 暗锈链红（锁链氧化深锈，与 🔩 紫铜橙明度强反差）
            '#B89060', // 🚂 浅卡其铜（暗火车头压亮底）
            '#6878A0', // 🏭 钢蓝（白烟+冷工厂）
            '#3A4048'  // ⚒️ 深铸铁灰（黑锤镐↔铁灰，独立中性灰阶）
        ],
        gridOuter:   '#0E0904',
        gridCell:    '#1A140C',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 4,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(232,176,80,0.50)',
        cssBg:       '#080503',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#D49640',
            '--accent-dark':  '#B86838',
            '--h1-color':     '#F0BB60'
        }
    },

    /**
     * 北京皇城（紫禁城 / 故宫）：朱红宫墙 + 龙袍金 + 翡翠玉 + 青花蓝 + 牙白瓷的中式皇家配色，
     * 玄朱深底烘托琉璃光泽。Glossy 渲染表现宫廷漆器、琉璃瓦、汝窑釉的温润光感。
     */
    forbidden: {
        id: 'forbidden',
        name: '👑 北京皇城',
        boardWatermark: { icons: ['👑', '🐲'], opacity: 0.08 },
        // 紫禁城八件套（全部专属，注意 🐲 龙颜 ≠ jurassic 的 🐉 翼龙）：
        //   🐲龙颜 / 👑凤冠皇冠 / 🪭折扇 / 🧧红包 / 🥮月饼 /
        //   🀄麻将红中 / 📜圣旨卷轴 / 🍵御茶
        // 配色取材故宫：朱红宫墙·龙袍金·翡翠玉柄·牙白瓷·龙鳞青·琉璃棕黄·青花蓝·桃红
        // 绿龙↔朱红、金冠↔翡翠、扇↔青花、红包↔牙白：全部冷暖/明度强反差。
        blockIcons: ['🐲', '👑', '🪭', '🧧', '🥮', '🀄', '📜', '🍵'],
        blockColors: [
            '#C8222C', // 🐲 朱红宫墙（绿龙颜↔大红 强反差）
            '#1B7E5C', // 👑 翡翠玉绿（金凤冠↔玉绿）
            '#1F4FA0', // 🪭 青花蓝（多色折扇↔深靛）
            '#D8CCB0', // 🧧 牙白瓷（朱红包↔象牙）
            '#E8B83C', // 🥮 龙袍金（暖棕月饼↔金）
            '#2E7088', // 🀄 龙鳞青（红中↔青）
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
        name: '🀄 麻将牌局',
        boardWatermark: { icons: ['🀅', '🀀'], opacity: 0.10 },
        // 列表前缀用 🀄（红中）提高彩色字形面积；盘面 blockIcons 仍为 U+1F000 八牌（🀅 發 等）
        blockIcons: ['🀀', '🀁', '🀂', '🀃', '🀅', '🀇', '🀙', '🀐'],
        blockColors: [
            '#3DA88C', // 🀀 东 — 浅碧绿（东方青龙，明亮清透，与绿呢拉开明度）
            '#C4424C', // 🀁 南 — 朱砂红（南方朱雀，国画传统红，与暖色背景呼应）
            '#D4C4A0', // 🀂 西 — 牙白（西方白虎，象牙瓷面，绿呢上最高明度）
            '#404858', // 🀃 北 — 玄墨蓝灰（北方玄武，深沉天玄）
            '#2A8870', // 🀅 發 — 翡翠（三元发财，深翡翠，比东更深一档）
            '#E0A040', // 🀇 一万 — 蜜蜡黄金（红万字烫金，温暖发"赢"色）
            '#3070C0', // 🀙 一筒 — 青花钴蓝（筒上瓷器经典）
            '#A8A040'  // 🀐 一索 — 苍竹黄绿（索绿带黄，与翡翠／东错位）
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
     * 扑克博弈（v10.17.6/7/8/9/10 共 5 次迭代，本节为 v10.17.10 版）：
     *   v10.17.6 字符 4×{A,K} → v10.17.7 字符全异 → v10.17.8 全 emoji（含 🎴/💰/💵）
     *   → v10.17.9 改回严格扑克（5 emoji + 3 字符卡牌）→ v10.17.10 最终版
     *
     *   v10.17.9 用 🃟/🂠/🂾 字符扑克牌后，用户反馈"后 3 个与前 5 个风格不一致 — 字符是单色小卡，
     *   前 5 个是饱满彩色 emoji"，要求 8 个 icon 全部彩色一致 + 辨识度高。
     *
     *   现实约束（emoji 标准层面，无法绕开）：
     *     真正具有"彩色 emoji 字形"的扑克元素只有 5 个 — ♠️ ♥️ ♦️ ♣️ 🃏 （4 花色 + 大王）
     *     凑足 8 个彩色 emoji，必须扩展到"扑克博弈赌场场景"语境（与主题名"扑克博弈"贯通）。
     *
     *   v10.17.10 方案 — "彩色一致 + 扑克博弈场景"：
     *     扑克核心 5 件（emoji）：♠️ 黑桃 · ♥️ 红心 · ♦️ 方片 · ♣️ 梅花 · 🃏 大王（百搭）
     *     扑克博弈场景 3 件（emoji）：
     *       🎴 花札 — 一张红色和风彩色牌，与扑克同属"牌"类
     *       🎰 老虎机 — 多色赌场标志，扑克博弈的赌场场景
     *       🎲 骰子 — 白底立体黑点，赌博博弈的核心元素
     *     8 个 icon 全部为饱满 emoji 字形，风格一致；语义紧扣"扑克博弈" — 4 花色 / 大王 / 牌 /
     *     赌场 / 赌博，正是赌场扑克的完整语境。
     *
     * 与 mahjong（中式国粹纯麻将）形成姊妹皮肤。
     * 配色沿用旧 8 色（赌场金 / 翡翠 / 天蓝 / 冷银 / 酒红 / 玄墨 / 暗紫 / 象牙），
     * 按 emoji 主色取互补 / 反差：黑↔金、红↔绿、彩↔深酒红、红和风↔玄墨等。
     * 盘面用 claret velvet 边框 + poker felt 绿呢 cell + 酒红赌场氛围底，
     * 与 mahjong 纯绿呢牌桌叙事完全错位。Cartoon 渲染呈现卡牌瓷面光泽。
     */
    boardgame: {
        id: 'boardgame',
        name: '🃏 扑克博弈',
        boardWatermark: { icons: ['🃏', '♠️'], opacity: 0.055 },
        // 扑克博弈 8 件套（v10.17.10：8 件全彩 emoji 字形，风格一致）：
        //   扑克核心 5 件：♠️ 黑桃 · ♥️ 红心 · ♦️ 方片 · ♣️ 梅花 · 🃏 大王（彩色百搭）
        //   博弈场景 3 件：🎴 花札（红和风牌） · 🎰 老虎机（多色赌场） · 🎲 骰子（立体白点骰）
        // 8 个 icon 全部彩色饱满，远观辨识度高；语义紧扣"扑克博弈"赌场全场景。
        blockIcons: ['♠️', '♥️', '♦️', '♣️', '🃏', '🎴', '🎰', '🎲'],
        blockColors: [
            '#C89642', // ♠️ 鎏金
            '#23866A', // ♥️ 翡翠绿
            '#3E65B8', // ♦️ 牌桌蓝
            '#A8B3C2', // ♣️ 冷银
            '#A84A52', // 🃏 酒红
            '#4F765C', // 🎴 松针绿
            '#6542A0', // 🎰 霓虹紫
            '#6E7486'  // 🎲 钢灰
        ],
        gridOuter:   '#050711',
        gridCell:    '#111628',
        gridLine:    'rgba(180,205,255,0.18)',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 5,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(212,152,48,0.46)', // 鎏金筹码闪
        cssBg:       '#0E0410', // deep wine 赌场氛围
        uiDark:      true,
        cssVars: {
            '--accent-color': '#D49830',
            '--accent-dark':  '#B07820',
            '--h1-color':     '#FFD080'
        }
    },

    /* ══════════════════════════════════════════
     *  生活主题（运动 / 交通 / 自然）
     * ══════════════════════════════════════════ */

    /**
     * 运动竞技：八大球类 + 奖杯，草绿球场深色底 + 各球本色高饱和块。
     * Glossy 渲染呈现球体光泽与皮革／合成树脂质感。
     */
    sports: {
        id: 'sports',
        name: '⚽ 运动竞技',
        boardWatermark: { icons: ['⚽', '🏆'], opacity: 0.08 },
        // 八大主流球类全家福（全部专属，无与现有皮肤重复）：
        //   ⚽足球 / 🏀篮球 / ⚾棒球 / 🎾网球 / 🏐排球 /
        //   🏈橄榄球 / 🥎垒球 / 🏆奖杯
        // 球各自有强烈品牌色（橙/白/黄/红线），用补色背景反差最强
        blockIcons: ['⚽', '🏀', '⚾', '🎾', '🏐', '🏈', '🥎', '🏆'],
        blockColors: [
            '#4F9050', // ⚽ 球场草绿（黑白足球↔绿底）
            '#2858B0', // 🏀 深篮蓝（橙篮球↔互补蓝）
            '#C04848', // ⚾ 红土场（白棒球+红线↔红土棕）
            '#905028', // 🎾 赤土网球场（黄绿网球↔暖棕）
            '#2090C8', // 🏐 排球海蓝（白蓝排球↔深泳池）
            '#587830', // 🏈 橄榄绿（橙棕橄榄球↔橄榄绿）
            '#6038A0', // 🥎 紫色场（黄垒球↔紫）
            '#C82838'  // 🏆 颁奖红毯（金奖杯↔正红）
        ],
        gridOuter:   '#0A1408',
        gridCell:    '#0F1C0A',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 8,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(255,235,80,0.55)',
        cssBg:       '#06100A',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#4F9050',
            '--accent-dark':  '#78C060',
            '--h1-color':     '#C8F088'
        }
    },

    /**
     * 户外运动（v10.17.4 新增第 37 款）：与 sports（球类竞技 / 室内场馆）/
     * forest（静态林木）/ vehicles（机动交通）完全错位 —— 主打「人类亲身参与的山野/水域/雪道运动」。
     *
     * 8 件套全谱系覆盖：
     *   山地：🥾 徒步 / 🧗 攀岩
     *   林地：⛺ 露营
     *   公路：🚴 骑行
     *   水域：🏄 冲浪 / 🛶 皮划艇 / 🎣 垂钓
     *   雪道：🏂 滑雪
     *
     * 配色取自然元素互补色：天空蓝 / 草绿 / 岩棕 / 警示黄 / 落日珊瑚 / 冰川青 / 湖青 / 晨曦紫，
     * 以「黎明前山谷深蓝」做背景，烘托清晨户外活动出发氛围。
     * 8 色 minD 满足 v10.5 去重；blockStyle 'cartoon' 满足 v10.8 icon 友好铁律。
     */
    outdoor: {
        id: 'outdoor',
        name: '🥾 户外运动',
        boardWatermark: { icons: ['🥾', '⛺'], opacity: 0.10 },
        // 户外运动八件套（全部专属，避开 sports/forest/vehicles 已用 emoji）：
        //   🥾徒步 / ⛺露营 / 🧗攀岩 / 🚴骑行 / 🏄冲浪 / 🏂滑雪 / 🛶皮划艇 / 🎣垂钓
        blockIcons: ['🥾', '⛺', '🧗', '🚴', '🏄', '🏂', '🛶', '🎣'],
        blockColors: [
            '#3878B8', // 🥾 高山天空蓝（棕褐登山靴↔深蓝天）
            '#3E7848', // ⛺ 草地翠绿（橙红帐篷↔绿草坪）
            '#7E6048', // 🧗 深岩棕（攀岩者↔砂岩壁，低饱和岩石色）
            '#E0B040', // 🚴 公路警示黄（自行车↔黄色单车道）
            '#E08858', // 🏄 落日珊瑚橙(蓝白冲浪板↔暖珊瑚)
            '#4FA8C8', // 🏂 冰川青蓝（蓝紫滑板↔冰雪青）
            '#2A8888', // 🛶 深湖青绿（棕木桨↔湖水）
            '#7068A8'  // 🎣 晨曦薄雾紫（鱼竿↔晨光）
        ],
        gridOuter:   '#0A1420',   // 远山黎明深蓝灰（山脊轮廓）
        gridCell:    '#101C2C',   // 山谷晨雾蓝（可见空格，与方块拉开明度）
        gridGap:     1,
        blockInset:  2,
        blockRadius: 7,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(140,200,255,0.50)',  // 晨曦白蓝亮闪
        cssBg:       '#06101C',   // 黎明前深蓝（户外清晨出发氛围）
        uiDark:      true,
        cssVars: {
            '--accent-color': '#4FA8C8',  // 冰川青蓝（贯穿冲浪/滑雪/天空叙事）
            '--accent-dark':  '#7CC8E0',
            '--h1-color':     '#A8E0F0'
        }
    },

    /**
     * 极速引擎：八大现代交通工具，机库深灰底 + 金属反光块。
     * Metal 渲染呈现飞机/汽车/火箭的金属壳质感。
     */
    vehicles: {
        id: 'vehicles',
        name: '🏎️ 极速引擎',
        boardWatermark: { icons: ['🏎️', '✈️'], opacity: 0.08 },
        // 八大现代载具（表意直出；避开 industrial 的 🚂 蒸汽火车）：
        //   🏎️赛车 / ✈️客机 / 🚀火箭 / 🚁直升机 / 🚢邮轮 / 🛵摩托 / 🚗轿车 / 🚌公交
        // 多数 emoji 体积大、颜色丰富；用「金属灰/钴蓝/火橙/草绿」分布拉开色相
        blockIcons: ['🏎️', '✈️', '🚀', '🚁', '🚢', '🛵', '🚗', '🚌'],
        blockColors: [
            '#8090A0', // 🏎️ 金属银灰（红车↔冷灰）
            '#2860C8', // ✈️ 钴蓝长空（白机↔深蓝）
            '#E84020', // 🚀 火橙（银火箭↔尾焰红）
            '#3E7E40', // 🚁 直升机迷彩绿
            '#1E70A8', // 🚢 海蓝
            '#E8C828', // 🛵 柠黄机身
            '#5080A8', // 🚗 通勤蓝（车身↔公路蓝）
            '#6840B0'  // 🚌 紫底（黄/红巴士↔紫）
        ],
        gridOuter:   '#0E1218',
        gridCell:    '#161E2C',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 5,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(255,180,40,0.45)',
        cssBg:       '#080C12',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#E84020',
            '--accent-dark':  '#FF7040',
            '--h1-color':     '#FFB870'
        }
    },

    /**
     * 山林秘境：树木 / 落叶 / 麦穗 / 木桩 / 鸟巢，苔藓深绿底 + 秋日色块。
     * Glossy 渲染呈现湿润树叶与树皮纹理感。
     */
    forest: {
        id: 'forest',
        name: '🌳 山林秘境',
        boardWatermark: { icons: ['🌳', '🍁'], opacity: 0.08 },
        // 林间八件（与 fairy 花卉、food 蔬果完全错开）：
        //   🌳阔叶树 / 🌲针叶松 / 🌴椰树 / 🍁红枫叶 / 🍂落叶 /
        //   🌾麦穗 / 🪵木桩 / 🪺鸟巢
        // 绿/红枫/麦黄/树皮 4 色谱系；绿叶落焦糖底、秋叶落苔绿底，互补反差
        blockIcons: ['🌳', '🌲', '🌴', '🍁', '🍂', '🌾', '🪵', '🪺'],
        blockColors: [
            '#8B5828', // 🌳 焦糖棕（绿树↔暖棕反差）
            '#D87838', // 🌲 暖橙树根（深松绿↔橙）
            '#D4A848', // 🌴 沙黄椰滩
            '#4F8048', // 🍁 苔绿（红枫↔苔绿）
            '#2A6038', // 🍂 深森绿（落叶橙↔深绿）
            '#B0386D', // 🌾 紫红枫（麦黄↔紫红）
            '#38A878', // 🪵 翠绿苔（树皮↔翠苔）
            '#5090C8'  // 🪺 天蓝（鸟巢棕↔蓝）
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
     * 海盗航行：罗盘 / 宝藏 / 鹦鹉 / 海图，深海舷板底 + 木甲板暖棕 + 宝石冷蓝。
     * Glass 渲染呈现宝石与海水的折射感。
     */
    pirate: {
        id: 'pirate',
        name: '🦜 海盗航行',
        boardWatermark: { icons: ['🦜', '🏴‍☠️'], opacity: 0.08 },
        // 大航海八件套（全部专属）：
        //   ⚓船锚 / 🏴‍☠️海盗旗 / 🪝船钩 / 🦜肩头鹦鹉 /
        //   ⛵风帆船 / 🗺️藏宝图 / 🧭罗盘 / 💎宝石
        // 银/黑/木 emoji 占多数，配色用「暗红·米帆·海蓝·甲板棕·绿岛」拉开
        blockIcons: ['⚓', '🏴‍☠️', '🪝', '🦜', '⛵', '🗺️', '🧭', '💎'],
        blockColors: [
            '#B02020', // ⚓ 战旗暗红（银锚↔红）
            '#D8C4A0', // 🏴‍☠️ 米白破帆布（黑骷髅旗↔米）
            '#2A6890', // 🪝 海蓝（银钩↔深海）
            '#6E4828', // 🦜 木甲板棕（多色鹦鹉↔暖棕）
            '#14406F', // ⛵ 深夜海蓝（白帆↔深蓝）
            '#2E6F45', // 🗺️ 翠岛绿（米羊皮纸↔绿）
            '#8C2858', // 🧭 紫红（金罗盘↔紫红）
            '#C8923C'  // 💎 沉海金（蓝宝石↔金）
        ],
        gridOuter:   '#04101F',
        gridCell:    '#0A1F32',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 6,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(255,200,80,0.45)',
        cssBg:       '#020812',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#C8923C',
            '--accent-dark':  '#E8B860',
            '--h1-color':     '#F8D890'
        }
    },

    /**
     * 田园农场：家畜 + 蔬果，浅春绿草地 + 深木栏边框（浅色系，主题一致）。
     * v10.1：把卡其沙黄底（沙漠味）替换为浅草绿牧场底，与「农场草地」主题一致。
     * Cartoon 渲染呈现可爱农场绘本风格。
     * v10.20：方块柔化为灰粉/灰蓝绿等（仍与 emoji 语义对应），避免深色块在浅绿底上成团发黑。
     */
    farm: {
        id: 'farm',
        name: '🐄 田园农场',
        boardWatermark: { icons: ['🐄', '🌽'], opacity: 0.055 },
        // 农场八件套（与 pets 家宠/food 主食/toon 动物园全错开）：
        //   🐄奶牛 / 🐖猪 / 🐑绵羊 / 🐔母鸡 / 🐣雏鸡 /
        //   🌽玉米 / 🥕胡萝卜 / 🍎苹果
        blockIcons: ['🐄', '🐖', '🐑', '🐔', '🐣', '🌽', '🥕', '🍎'],
        blockColors: [
            '#B85A50', // 🐄 谷仓红
            '#4E84B8', // 🐖 清水蓝
            '#4E8A58', // 🐑 牧草绿
            '#3C98B8', // 🐔 晴空青
            '#9A66B8', // 🐣 紫藤
            '#C89438', // 🌽 玉米金
            '#B06A38', // 🥕 胡萝卜棕
            '#C04E64'  // 🍎 苹果红
        ],
        // v10.6 哑光降饱和：cssBg #D0E5B0 (S=47%) → #DCE5C8 (S=28%) 雾绿替代鲜春绿
        // v10.7 进一步哑光：cssBg #DCE5C8 (S=28%) → #E6E7DC (S~19%) 骨白带一丝绿
        gridOuter:   '#07140A',
        gridCell:    '#102414',
        gridLine:    'rgba(190,230,185,0.18)',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 5,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(170,230,150,0.45)',
        cssBg:       '#061006',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#78B860',
            '--accent-dark':  '#4E8A58',
            '--h1-color':     '#B8E8A8'
        }
    },

    /**
     * 沙漠绿洲：骆驼 / 仙人掌 / 古寺 / 赤陶罐，哑光米沙底 + 低饱和「晒褪陶土 / 灰绿洲」色块。
     * v10.1：把深蓝夜空底（深海味）替换为沙金主调，让「沙漠」叙事直接通过 page bg 传达。
     * v10.5–v10.7：cssBg / grid 持续降饱和至浅米中性底。
     * v10.18：**方块色重做**——旧版为高饱和宝石蓝/品红/电紫；改为低饱和陶土系。
     * v10.19：**再次提亮**——仍显「黑疙瘩」因渲染降饱和+卡通暗角叠暗；方块改为 **浅陶土/沙尘色**（明度明显高于 v10.18，与 `#E8E2D6` 格面靠近但靠色相仍可辨色），并配合 renderer 浅色盘面减轻压暗。
     * v10.20：浅色盘面判定改为 **gridCell 亮度**（`isLightBoardSkin`），不再单独特判 desert。
     * Glossy 渲染呈现日光下沙漠的耀斑与绿洲倒影。
     */
    desert: {
        id: 'desert',
        name: '🐫 沙漠绿洲',
        boardWatermark: { icons: ['🐫', '🌵'], opacity: 0.055 },
        // 沙漠绿洲八件套（中东/北非/印度异域风物）：
        //   🐫骆驼 / 🦂蝎子 / 🌵仙人掌 / 🏜️沙丘 / 🪨岩石 /
        //   🏺赤陶罐 / 🛕古寺 / 🌅日出
        // 浅色盘面：方块用「浅晒褪陶土」，避免深褐一堆；色相仍分散。
        blockIcons: ['🐫', '🦂', '🌵', '🏜️', '🪨', '🏺', '🛕', '🌅'],
        blockColors: [
            '#4E8EB8', // 🐫 绿洲蓝
            '#B86A48', // 🦂 陶土橙
            '#5C9A58', // 🌵 仙人掌绿
            '#B89648', // 🏜️ 沙丘金
            '#8A7A68', // 🪨 岩灰褐
            '#4E9A98', // 🏺 陶青
            '#B85E58', // 🛕 赭红
            '#8A6BB8'  // 🌅 暮霞紫
        ],
        // v10.6 哑光降饱和：cssBg #C8A868 (S=49%) → #D8C8A8 (S=35%) 米沙替代浓琥珀
        // v10.7 进一步哑光：cssBg #D8C8A8 (S=35%) → #DAD2C4 (S~21%) 接近中性的浅米
        gridOuter:   '#130D08',
        gridCell:    '#24190E',
        gridLine:    'rgba(230,190,120,0.20)',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 5,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(230,180,80,0.45)',
        cssBg:       '#0E0804',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#C89438',
            '--accent-dark':  '#8A5A28',
            '--h1-color':     '#E8C078'
        }
    },
};

export const SKIN_LIST = Object.values(SKINS);

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
