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
 * 皮肤总量：36 款（v10.3 mahjong；v10.4 boardgame；v10.5 主题内配色去重 + desert 减亮；v10.6 浅色 farm/desert 哑光降饱和；v10.7 浅色饱和度上限 ≤ 25%；v10.8 带 icon 皮肤强制使用 icon 友好的 blockStyle）
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
 *   sunset   暮色日落  纯黑紫红 → 玫瑰胭脂暮霭（点出黄昏暖意）
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
 * 文化主题扩展（v10.4）：boardgame 棋牌博弈（综合桌游 / 赌场氛围，v10.5 由「棋牌俱乐部」更名为四字「棋牌博弈」）。
 *   8 牌精选：♠️♥️♦️♣️ 扑克四花色 + 🃏小丑 + 🎲骰子 + 🎰老虎机 + ♟️棋子。
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
 * 设计意图同族系列（titanium 钛晶 8 阶 / lava 熔岩单调 / cyber 霓虹 / sunset 暖色 / sakura 粉夜 / neonCity 都市霓虹）
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
 *   不带 icon 的 10 款（titanium/cyber/sakura/lava/sunset/dawn/macaroon/fantasy/
 *   neonCity/classic）继续保留 glossy/glass/metal/neon/flat，不受此次收敛影响。
 *
 * icon 全局唯一性约束：26 款带 icon 皮肤 × 8 icon = 208 个 emoji 全部互不重复。
 * 详见 docs/SKINS_CATALOG.md。
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

    /** 日落：黄金 / 橙红 / 玫瑰紫暖色系，暮光胭脂底（v10.2 主题强化：纯黑→深玫瑰暮霭） */
    sunset: {
        id: 'sunset',
        name: '🌅 暮色日落',
        boardWatermark: { icons: ['🌅', '☀️'], opacity: 0.08 },
        blockColors: [
            '#FF7761', '#FF9A56', '#FFCC5C', '#88D8B0',
            '#8098CF', '#D478CA', '#FF8FA0', '#FFB870'
        ],
        gridOuter: '#241019',
        gridCell:  '#341628',
        gridGap: 1,
        blockInset: 2,
        blockRadius: 6,
        blockStyle: 'glossy',
        clearFlash: 'rgba(255,200,150,0.42)',
        cssBg: '#1A0810',
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
        // 萌系水族 + 果冻气泡：🪼水母 / 🫧气泡（果冻泡泡的视觉签名，专属）
        // 移除与 ocean 重复的 🐳🦑，让 bubbly 与 ocean 视觉错位（萌 vs 深邃）
        // 海豚↔粉、火烈鸟↔蓝、水母↔绿、海草↔橙，全互补色对配
        blockIcons: ['🐬', '🦩', '🪼', '🌿', '🦀', '🐢', '🫧', '🦐'],
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
        // v10.5：🐭 #C02820 (与 🐰 #B82020 同色族) → #5A2880 深紫，区分度提升
        blockColors: [
            '#B82020', '#A05800', '#7A6000', '#187020',
            '#1050B8', '#901078', '#5A2880', '#006060'
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
        name: '⚙️ 古典工业',
        boardWatermark: { icons: ['⚙️', '🚂'], opacity: 0.08 },
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
     * 麻将牌局（中式国粹）：以麻将牌面为视觉主轴，绿呢牌桌叙事——
     * 风牌 4 张 + 三元绿（發） + 万/筒/索三种数牌的「一」代表（避开 forbidden 已用的 🀄 中）。
     * 配色取自传统中国色：翠青 / 朱红 / 银灰 / 玄墨 / 翡翠 / 鎏金 / 青花 / 苍竹，
     * 牌身象牙色在深色饱和方块上 WCAG ≥ 4.5。盘面用麻将桌深绿呢底烘托国粹氛围。
     * 设计要点：与 forbidden（皇家器物）完全错位 → 麻将是市井牌桌；🀄 已让给 forbidden 独占。
     */
    mahjong: {
        id: 'mahjong',
        name: '🀅 麻将牌局',
        boardWatermark: { icons: ['🀅', '🀀'], opacity: 0.08 },
        // 八牌精选（全部专属，避开 forbidden 已占的 🀄）：
        //   🀀东 / 🀁南 / 🀂西 / 🀃北（风牌全集）+ 🀅發（三元绿，🀄红中归 forbidden）+
        //   🀇一万 / 🀙一筒 / 🀐一索（数牌三家的「一」代表，最具辨识度）
        blockIcons: ['🀀', '🀁', '🀂', '🀃', '🀅', '🀇', '🀙', '🀐'],
        blockColors: [
            '#20B888', // 🀀 东 — 翠青（东方青龙）
            '#D03030', // 🀁 南 — 朱红（南方朱雀）
            '#6E7C8C', // 🀂 西 — 银灰（西方白虎）
            '#4F4F60', // 🀃 北 — 玄墨（北方玄武）
            '#1F8060', // 🀅 發 — 翡翠（三元发财）
            '#D49438', // 🀇 一万 — 鎏金（万字红）
            '#2A60B8', // 🀙 一筒 — 青花（筒五彩）
            '#708030'  // 🀐 一索 — 苍竹（索绿竹）
        ],
        gridOuter:   '#0E2018',
        gridCell:    '#143028',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 6,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(80,200,140,0.46)',
        cssBg:       '#0A1812',
        uiDark:      true,
        cssVars: {
            '--accent-color': '#1F8060',
            '--accent-dark':  '#50B090',
            '--h1-color':     '#80E0B0'
        }
    },

    /**
     * 棋牌博弈（综合桌游 / 赌场氛围，v10.5 由「棋牌俱乐部」更名）：扑克四花色 + 小丑 + 骰子 + 老虎机 + 国际象棋兵，
     * 「棋」与「牌」兼顾，与 mahjong（中式国粹纯麻将）形成姊妹皮肤。
     * 配色取扑克经典——红心绿、方片蓝、黑桃金、梅花银、小丑酒红、骰子玄黑、老虎机紫、棋子象牙；
     * 盘面用 claret velvet 边框 + poker felt 绿呢 cell + 酒红赌场氛围底，
     * 与 mahjong 纯绿呢牌桌叙事完全错位。
     * Glossy 渲染呈现卡牌瓷面光泽。
     */
    boardgame: {
        id: 'boardgame',
        name: '🃏 棋牌博弈',
        boardWatermark: { icons: ['🃏', '♠️'], opacity: 0.08 },
        // 棋牌八件套（全部专属，避开 mahjong 的麻将牌、industrial 的工具、forbidden 的宫廷）：
        //   ♠️黑桃 / ♥️红心 / ♦️方片 / ♣️梅花 — 扑克四花色
        //   🃏小丑（百搭王） / 🎲骰子（赌局） / 🎰老虎机（赌场霓虹） / ♟️棋子（棋艺对弈）
        // 配色策略：每色取经典赌场配色 + 与 emoji 形成最大对比
        //   黑桃黑↔金；红心红↔翠绿；方片红↔深蓝；梅花黑↔冷银；
        //   小丑彩↔酒红；白红骰子↔玄墨；多色老虎机↔暗紫；黑棋兵↔象牙
        blockIcons: ['♠️', '♥️', '♦️', '♣️', '🃏', '🎲', '🎰', '♟️'],
        blockColors: [
            '#D49830', // ♠️ 鎏金（黑桃黑↔金 经典 poker）
            '#1F8060', // ♥️ 翡翠绿（红心红↔绿 互补）
            '#2860B0', // ♦️ 深天蓝（方片红↔蓝 互补）
            '#98A8B8', // ♣️ 冷银（梅花黑↔银 高对比）
            '#5C2030', // 🃏 酒红（小丑彩色↔深酒红 庄重）
            '#3E3E50', // 🎲 玄墨（白红骰子点↔近黑 高对比）
            '#4F3088', // 🎰 暗紫（老虎机霓虹↔暗紫 同调）
            '#E0D8B0'  // ♟️ 象牙（黑棋兵↔象牙 棋盘格）
        ],
        gridOuter:   '#1A0810', // claret velvet trim（赌场红丝绒边）
        gridCell:    '#142818', // poker felt green（牌桌绿呢）
        gridGap:     1,
        blockInset:  2,
        blockRadius: 7,
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
     * 极速引擎：八大现代交通工具，机库深灰底 + 金属反光块。
     * Metal 渲染呈现飞机/汽车/火箭的金属壳质感。
     */
    vehicles: {
        id: 'vehicles',
        name: '🏎️ 极速引擎',
        boardWatermark: { icons: ['🏎️', '✈️'], opacity: 0.08 },
        // 八大现代交通（避开 industrial 已用的 🚂 蒸汽火车，全部当代型号）：
        //   🏎️赛车 / ✈️客机 / 🚀火箭 / 🚁直升机 /
        //   🚢邮轮 / 🛵摩托 / 🚥红绿灯 / 🚌大巴
        // 多数 emoji 体积大、颜色丰富；用「金属灰/钴蓝/火橙/草绿」分布拉开色相
        blockIcons: ['🏎️', '✈️', '🚀', '🚁', '🚢', '🛵', '🚥', '🚌'],
        blockColors: [
            '#8090A0', // 🏎️ 金属银灰（红车↔冷灰）
            '#2860C8', // ✈️ 钴蓝长空（白机↔深蓝）
            '#E84020', // 🚀 火橙（银火箭↔尾焰红）
            '#3E7E40', // 🚁 直升机迷彩绿
            '#1E70A8', // 🚢 海蓝
            '#E8C828', // 🛵 柠黄机身
            '#404858', // 🚥 冷暗灰（红黄绿信号灯↔暗底）
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
        name: '⚓ 海盗航行',
        boardWatermark: { icons: ['⚓', '🏴‍☠️'], opacity: 0.08 },
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
     */
    farm: {
        id: 'farm',
        name: '🐄 田园农场',
        boardWatermark: { icons: ['🐄', '🌽'], opacity: 0.09 },
        // 浅色盘面需用深色方块（深度饱和色，WCAG 对比 ≥ 4.5）
        // 农场八件套（与 pets 家宠/food 主食/toon 动物园全错开）：
        //   🐄奶牛 / 🐖猪 / 🐑绵羊 / 🐔母鸡 / 🐣雏鸡 /
        //   🌽玉米 / 🥕胡萝卜 / 🍎苹果
        blockIcons: ['🐄', '🐖', '🐑', '🐔', '🐣', '🌽', '🥕', '🍎'],
        blockColors: [
            '#B02838', // 🐄 朱红（黑白牛↔大红）
            '#1A488F', // 🐖 深蓝（粉猪↔互补蓝）
            '#2A6028', // 🐑 深苔绿（白羊毛↔深森绿，与浅绿底拉开明度）
            '#1A6E9F', // 🐔 海蓝（红冠母鸡↔蓝）
            '#8E2070', // 🐣 紫红（黄雏鸡↔紫红）
            '#8C5028', // 🌽 烤玉米棕（黄玉米↔自然褐棕，v10.5 修：原 #B82038 与 🐄 朱红同色族）
            '#5C2818', // 🥕 深棕（橙萝卜↔深棕泥土，避免与底绿撞色）
            '#4830B0'  // 🍎 深紫（红苹果↔紫）
        ],
        // v10.6 哑光降饱和：cssBg #D0E5B0 (S=47%) → #DCE5C8 (S=28%) 雾绿替代鲜春绿
        // v10.7 进一步哑光：cssBg #DCE5C8 (S=28%) → #E6E7DC (S~19%) 骨白带一丝绿
        gridOuter:   '#7A8868',
        gridCell:    '#EFF0EA',
        gridGap:     1,
        blockInset:  1,
        blockRadius: 9,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(216,220,210,0.50)',
        cssBg:       '#E6E7DC',
        cssVars: {
            '--text-primary':     '#1F1A12',
            '--text-secondary':   '#54604A',
            '--accent-color':     '#5C7050',
            '--accent-dark':      '#3F5436',
            '--shadow':           'rgba(0,0,0,0.10)',
            '--h1-color':         '#3F5436',
            '--stat-surface':     'rgba(250,250,242,0.92)',
            '--stat-label-color': '#5A6450',
            '--select-bg':        '#F4F5EC',
            '--select-border':    'rgba(122,136,104,0.24)'
        }
    },

    /**
     * 沙漠绿洲：骆驼 / 仙人掌 / 古寺 / 赤陶罐，哑光米沙底 + 深饱和宝石色块（浅色系，主题一致）。
     * v10.1：把深蓝夜空底（深海味）替换为沙金主调，让「沙漠」叙事直接通过 page bg 传达。
     * v10.5：把高亮沙金 #E8C878 (明度 ~75%) 降为柔和琥珀 #C8A868 (明度 ~60%)；
     *       同步把 🌅 的深青底 (与 🏺 同色族) 改为暮霞紫，解决主题内重色。
     * v10.6：把柔和琥珀 #C8A868 (饱和度 49%) 进一步降为哑光米沙 #D8C8A8 (饱和度 35%)。
     * v10.7：再次降饱和，米沙 #D8C8A8 (S=35%) → 浅米 #DAD2C4 (S~21%)，几近中性偏米；
     *       gridOuter / gridCell / clearFlash / cssVars 全套同步推到 S<25%。
     * Glossy 渲染呈现日光下沙漠的耀斑与绿洲倒影。
     */
    desert: {
        id: 'desert',
        name: '🐫 沙漠绿洲',
        boardWatermark: { icons: ['🐫', '🌵'], opacity: 0.10 },
        // 沙漠绿洲八件套（中东/北非/印度异域风物）：
        //   🐫骆驼 / 🦂蝎子 / 🌵仙人掌 / 🏜️沙丘 / 🪨岩石 /
        //   🏺赤陶罐 / 🛕古寺 / 🌅日出
        // 柔琥珀沙底要求方块用深饱和色（WCAG 对比 ≥ 4.5）；色相覆盖蓝/红/紫/绿四象限
        blockIcons: ['🐫', '🦂', '🌵', '🏜️', '🪨', '🏺', '🛕', '🌅'],
        blockColors: [
            '#1A4070', // 🐫 沙漠夜空蓝（沙棕骆驼↔深蓝，最强冷暖反差）
            '#B02030', // 🦂 毒蝎血红（黑棕蝎↔大红警示）
            '#6F1858', // 🌵 品红（绿仙人掌↔互补品红）
            '#1A6048', // 🏜️ 绿洲深翠（沙丘↔翠绿绿洲水面）
            '#4830B0', // 🪨 紫水晶（灰岩↔深紫宝石矿）
            '#185878', // 🏺 陶青（赤陶罐自带橙红↔互补深青）
            '#5C0F38', // 🛕 古寺暗酒红（米白寺↔深酒红夕阳）
            '#6F2890'  // 🌅 暮霞紫（朝霞紫粉↔互补金沙；v10.5 修：原 #1A6878 与 🏺 #185878 同色族）
        ],
        // v10.6 哑光降饱和：cssBg #C8A868 (S=49%) → #D8C8A8 (S=35%) 米沙替代浓琥珀
        // v10.7 进一步哑光：cssBg #D8C8A8 (S=35%) → #DAD2C4 (S~21%) 接近中性的浅米
        gridOuter:   '#786E50',
        gridCell:    '#E8E2D6',
        gridGap:     1,
        blockInset:  2,
        blockRadius: 7,
        blockStyle:  'cartoon',
        clearFlash:  'rgba(216,210,196,0.45)',
        cssBg:       '#DAD2C4',
        cssVars: {
            '--text-primary':     '#1F1810',
            '--text-secondary':   '#5C5340',
            '--accent-color':     '#8A7848',
            '--accent-dark':      '#6E5A30',
            '--shadow':           'rgba(0,0,0,0.12)',
            '--h1-color':         '#5A4528',
            '--stat-surface':     'rgba(250,246,236,0.92)',
            '--stat-label-color': '#6E6048',
            '--select-bg':        '#F0EBE0',
            '--select-border':    'rgba(140,124,90,0.22)'
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
