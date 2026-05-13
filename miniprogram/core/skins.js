/**
 * 小程序皮肤配置（自动同步自 web/src/skins.js 的核心渲染字段）。
 */
const storage = require('../adapters/storage');

const STORAGE_KEY = 'openblock_skin';
const DEFAULT_SKIN_ID = "titanium";

const CLASSIC_PALETTE = [
  "#3F6DD8",
  "#4FB8E8",
  "#52BC4B",
  "#FFC428",
  "#F5851E",
  "#A848E0",
  "#65C4F0",
  "#E84D5C"
];

const SKINS = {
  "classic": {
    "id": "classic",
    "name": "✨ 极简经典",
    "blockColors": [
      "#3F6DD8",
      "#4FB8E8",
      "#52BC4B",
      "#FFC428",
      "#F5851E",
      "#A848E0",
      "#65C4F0",
      "#E84D5C"
    ],
    "gridOuter": "#1C2630",
    "gridCell": "#2E3E50",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 4,
    "blockStyle": "bevel3d",
    "clearFlash": "rgba(220,240,255,0.90)"
  },
  "titanium": {
    "id": "titanium",
    "name": "💎 钛晶矩阵",
    "blockColors": [
      "#6AAEE8",
      "#94BDDF",
      "#78B8EB",
      "#A8CCF0",
      "#88D0F0",
      "#7DBAE2",
      "#B4D8EC",
      "#8DB6D8"
    ],
    "gridOuter": "#0A1020",
    "gridCell": "#182030",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "metal",
    "clearFlash": "rgba(200,220,245,0.42)"
  },
  "aurora": {
    "id": "aurora",
    "name": "🌌 冰川极光",
    "blockColors": [
      "#5AD8CC",
      "#8070F0",
      "#AA90FA",
      "#38D89E",
      "#28D8F0",
      "#8590F8",
      "#C488FC",
      "#60C8FF"
    ],
    "blockIcons": [
      "🦌",
      "🐧",
      "🐋",
      "❄️",
      "🌌",
      "🐻‍❄️",
      "🦭",
      "🏔️"
    ],
    "gridOuter": "#04101C",
    "gridCell": "#0C1C2E",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(170,245,210,0.38)"
  },
  "neonCity": {
    "id": "neonCity",
    "name": "🌃 霓虹都市",
    "blockColors": [
      "#FF2DAA",
      "#9B72FF",
      "#00E5FF",
      "#76FF03",
      "#FFAB40",
      "#FF4081",
      "#448AFF",
      "#18FFFF"
    ],
    "gridOuter": "#0B0F1A",
    "gridCell": "#151C2E",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "neon",
    "clearFlash": "rgba(0,229,255,0.35)"
  },
  "ocean": {
    "id": "ocean",
    "name": "🌊 深海幽域",
    "blockColors": [
      "#00C8F0",
      "#0098C8",
      "#48D4E4",
      "#90F0FF",
      "#00E4C0",
      "#FFB347",
      "#FF7878",
      "#20E8FF"
    ],
    "blockIcons": [
      "🐙",
      "🦞",
      "🐡",
      "🪸",
      "🐚",
      "🐳",
      "🦈",
      "🦑"
    ],
    "gridOuter": "#040E18",
    "gridCell": "#081C28",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(144,224,239,0.35)"
  },
  "sunset": {
    "id": "sunset",
    "name": "🌅 琥珀流光",
    "blockColors": [
      "#FF6A50",
      "#FF8E3A",
      "#FFB230",
      "#FFD638",
      "#FF7090",
      "#E04098",
      "#A858DC",
      "#FFAE6A"
    ],
    "gridOuter": "#241019",
    "gridCell": "#341628",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "glass",
    "clearFlash": "rgba(255,200,140,0.50)"
  },
  "sakura": {
    "id": "sakura",
    "name": "🌸 樱花飞雪",
    "blockColors": [
      "#FF4490",
      "#FF2870",
      "#FFB0D8",
      "#78D860",
      "#78B8F0",
      "#CC60E8",
      "#FFBA30",
      "#58D890"
    ],
    "gridOuter": "#241018",
    "gridCell": "#321628",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "glass",
    "clearFlash": "rgba(255,180,220,0.52)"
  },
  "koi": {
    "id": "koi",
    "name": "🎏 锦鲤跃龙",
    "blockColors": [
      "#FF5040",
      "#F07828",
      "#F0C820",
      "#4070D8",
      "#E880A8",
      "#38A8B8",
      "#F05888",
      "#D0A858"
    ],
    "blockIcons": [
      "🎋",
      "🌊",
      "🪷",
      "⛩️",
      "🐟",
      "🏮",
      "🎐",
      "🎏"
    ],
    "gridOuter": "#040E18",
    "gridCell": "#081C2C",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 9,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(80,200,255,0.38)"
  },
  "candy": {
    "id": "candy",
    "name": "🍭 糖果甜心",
    "blockColors": [
      "#FF4466",
      "#FF8820",
      "#FFD020",
      "#44E848",
      "#22AAFF",
      "#CC66FF",
      "#FF44BB",
      "#22E8CC"
    ],
    "blockIcons": [
      "🍪",
      "🎀",
      "🍫",
      "🍰",
      "🍩",
      "🍬",
      "🍭",
      "🧁"
    ],
    "gridOuter": "#22082A",
    "gridCell": "#321048",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,200,255,0.88)"
  },
  "bubbly": {
    "id": "bubbly",
    "name": "🫧 元气泡泡",
    "blockColors": [
      "#FF72BB",
      "#4898F8",
      "#42C442",
      "#FFAA18",
      "#22C87A",
      "#E060FF",
      "#FF8848",
      "#12C4E8"
    ],
    "blockIcons": [
      "🐬",
      "🦦",
      "🪼",
      "🏖️",
      "🦀",
      "🐢",
      "🫧",
      "🦐"
    ],
    "gridOuter": "#2A1048",
    "gridCell": "#401870",
    "gridGap": 1,
    "blockInset": 1,
    "blockRadius": 14,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,160,240,0.82)"
  },
  "toon": {
    "id": "toon",
    "name": "🎨 卡通乐园",
    "blockColors": [
      "#FF5570",
      "#FF7F11",
      "#FFD600",
      "#00C853",
      "#5590FF",
      "#DD60FF",
      "#B85828",
      "#00BCD4"
    ],
    "blockIcons": [
      "🐼",
      "🐨",
      "🐘",
      "🦒",
      "🦛",
      "🦔",
      "🦘",
      "🦄"
    ],
    "gridOuter": "#2A1860",
    "gridCell": "#3A2478",
    "gridGap": 2,
    "blockInset": 1,
    "blockRadius": 10,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,255,130,0.90)"
  },
  "pixel8": {
    "id": "pixel8",
    "name": "👾 街机格斗",
    "blockColors": [
      "#FF2050",
      "#1E78FF",
      "#00C030",
      "#F8C000",
      "#CC00CC",
      "#00B8C8",
      "#FF5800",
      "#90E000"
    ],
    "blockIcons": [
      "💣",
      "🪙",
      "🥊",
      "🎮",
      "👊",
      "🍄",
      "🕹️",
      "👾"
    ],
    "gridOuter": "#0D0400",
    "gridCell": "#1E1008",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 4,
    "blockStyle": "cartoon",
    "clearFlash": "#FFFFF0"
  },
  "dawn": {
    "id": "dawn",
    "name": "☀️ 晨光微曦",
    "blockColors": [
      "#E06E62",
      "#5A92D6",
      "#D8A84E",
      "#55A873",
      "#8D75CE",
      "#42A7A8",
      "#D46282",
      "#6B7DDD"
    ],
    "gridOuter": "#F1E3C5",
    "gridCell": "#FFF3D8",
    "gridGap": 0,
    "blockInset": 3,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,210,130,0.72)"
  },
  "food": {
    "id": "food",
    "name": "🍕 美食盛宴",
    "blockColors": [
      "#FF5040",
      "#F09020",
      "#F8D020",
      "#60B830",
      "#E09050",
      "#B05028",
      "#F05878",
      "#C068F0"
    ],
    "blockIcons": [
      "🥑",
      "🍣",
      "🍞",
      "🍕",
      "🌮",
      "🍔",
      "🥩",
      "🍜"
    ],
    "gridOuter": "#18100A",
    "gridCell": "#281808",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,200,100,0.88)"
  },
  "music": {
    "id": "music",
    "name": "🎹 音乐律动",
    "blockColors": [
      "#FF3060",
      "#FF9020",
      "#FFE820",
      "#40E840",
      "#3088FF",
      "#E040FF",
      "#FF60A0",
      "#40E8E8"
    ],
    "blockIcons": [
      "🎤",
      "🎹",
      "🎧",
      "🎺",
      "🥁",
      "🎸",
      "🎷",
      "🎻"
    ],
    "gridOuter": "#100818",
    "gridCell": "#1C0C28",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "neon",
    "clearFlash": "rgba(255,100,200,0.40)"
  },
  "pets": {
    "id": "pets",
    "name": "🐶 萌宠天地",
    "blockColors": [
      "#C89088",
      "#B8A090",
      "#A8A878",
      "#78A890",
      "#98B0A8",
      "#C8B8A0",
      "#A898B8",
      "#B8B090"
    ],
    "blockIcons": [
      "🐰",
      "🐠",
      "🐦",
      "🐱",
      "🦎",
      "🐹",
      "🐭",
      "🐶"
    ],
    "gridOuter": "#C0B090",
    "gridCell": "#F5EDDC",
    "gridGap": 1,
    "blockInset": 1,
    "blockRadius": 10,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,240,180,0.88)"
  },
  "universe": {
    "id": "universe",
    "name": "🪐 宇宙星际",
    "blockColors": [
      "#E84020",
      "#F09030",
      "#D8C820",
      "#3898D0",
      "#D040D0",
      "#20B0C0",
      "#D88020",
      "#9070F0"
    ],
    "blockIcons": [
      "🛸",
      "🌍",
      "🔭",
      "🌙",
      "⭐",
      "🪐",
      "☄️",
      "🌠"
    ],
    "gridOuter": "#04020E",
    "gridCell": "#0A0618",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(100,80,200,0.40)"
  },
  "fantasy": {
    "id": "fantasy",
    "name": "🔮 魔幻秘境",
    "blockColors": [
      "#CC48FF",
      "#5080F0",
      "#18B848",
      "#E82020",
      "#E8B820",
      "#20B0D8",
      "#E020A0",
      "#9060E0"
    ],
    "gridOuter": "#0E0428",
    "gridCell": "#1A0838",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "glass",
    "clearFlash": "rgba(160,80,255,0.42)"
  },
  "beast": {
    "id": "beast",
    "name": "🗺️ 冒险奇境",
    "blockColors": [
      "#6878A0",
      "#A82820",
      "#3878C8",
      "#5C2880",
      "#2A6028",
      "#D4A028",
      "#4A6020",
      "#7C5028"
    ],
    "blockIcons": [
      "🐺",
      "🦏",
      "🐯",
      "🦁",
      "🐗",
      "🦅",
      "🐆",
      "🐻"
    ],
    "gridOuter": "#150C04",
    "gridCell": "#221608",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,180,30,0.50)"
  },
  "greece": {
    "id": "greece",
    "name": "🏛️ 希腊神话",
    "blockColors": [
      "#E8C030",
      "#4898E8",
      "#90C040",
      "#F07828",
      "#90B8D8",
      "#D050E8",
      "#20A8B8",
      "#7860E0"
    ],
    "blockIcons": [
      "🔱",
      "☀️",
      "🍷",
      "🦚",
      "⚡",
      "🏹",
      "💘",
      "🦉"
    ],
    "gridOuter": "#040A18",
    "gridCell": "#0A1228",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(230,195,40,0.52)"
  },
  "demon": {
    "id": "demon",
    "name": "😈 恶魔冥界",
    "blockColors": [
      "#F03030",
      "#F0A020",
      "#CC40FF",
      "#FF5030",
      "#E8A0D8",
      "#9870D8",
      "#E03060",
      "#20D848"
    ],
    "blockIcons": [
      "👁️",
      "⚔️",
      "💀",
      "🕷️",
      "🦇",
      "👹",
      "☠️",
      "😈"
    ],
    "gridOuter": "#160408",
    "gridCell": "#341018",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(220,30,40,0.48)"
  },
  "jurassic": {
    "id": "jurassic",
    "name": "🦕 恐龙世界",
    "blockColors": [
      "#50C030",
      "#F05030",
      "#9060F0",
      "#A8D840",
      "#80B850",
      "#30A8B8",
      "#D0A030",
      "#F0C840"
    ],
    "blockIcons": [
      "🥚",
      "🌋",
      "🦕",
      "🦴",
      "🐉",
      "🦖",
      "🐊",
      "🐍"
    ],
    "gridOuter": "#0E1A06",
    "gridCell": "#1A2A0E",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(160,220,60,0.50)"
  },
  "fairy": {
    "id": "fairy",
    "name": "🧚 花仙梦境",
    "blockColors": [
      "#D060F0",
      "#F060A0",
      "#60A0F8",
      "#F07060",
      "#F040A0",
      "#9B72F0",
      "#F09040",
      "#40D0E8"
    ],
    "blockIcons": [
      "🌻",
      "🦋",
      "🌹",
      "🍃",
      "🪄",
      "🌷",
      "🌈",
      "🧚"
    ],
    "gridOuter": "#1F0E2C",
    "gridCell": "#2C1640",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 9,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(240,150,240,0.52)"
  },
  "industrial": {
    "id": "industrial",
    "name": "🏭 古典工业",
    "blockColors": [
      "#D49640",
      "#C04030",
      "#B86838",
      "#4F9080",
      "#5C2820",
      "#B89060",
      "#6878A0",
      "#3A4048"
    ],
    "blockIcons": [
      "⚙️",
      "🔧",
      "🔩",
      "🛠️",
      "⛓️",
      "🚂",
      "🏭",
      "⚒️"
    ],
    "gridOuter": "#0E0904",
    "gridCell": "#1A140C",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 4,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(232,176,80,0.50)"
  },
  "forbidden": {
    "id": "forbidden",
    "name": "👑 北京皇城",
    "blockColors": [
      "#C8222C",
      "#1B7E5C",
      "#1F4FA0",
      "#D8CCB0",
      "#E8B83C",
      "#2E7088",
      "#B8732C",
      "#E84068"
    ],
    "blockIcons": [
      "🐲",
      "👑",
      "🪭",
      "🧧",
      "🥮",
      "🀄",
      "📜",
      "🍵"
    ],
    "gridOuter": "#1C0608",
    "gridCell": "#2A0E12",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(232,184,60,0.52)"
  },
  "mahjong": {
    "id": "mahjong",
    "name": "🀄 麻将牌局",
    "blockColors": [
      "#3DA88C",
      "#C4424C",
      "#D4C4A0",
      "#404858",
      "#2A8870",
      "#E0A040",
      "#3070C0",
      "#A8A040"
    ],
    "blockIcons": [
      "🀀",
      "🀁",
      "🀂",
      "🀃",
      "🀅",
      "🀇",
      "🀙",
      "🀐"
    ],
    "gridOuter": "#3D2818",
    "gridCell": "#2A4A38",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(180,220,150,0.50)"
  },
  "boardgame": {
    "id": "boardgame",
    "name": "🃏 扑克博弈",
    "blockColors": [
      "#C89642",
      "#23866A",
      "#3E65B8",
      "#A8B3C2",
      "#A84A52",
      "#4F765C",
      "#6542A0",
      "#6E7486"
    ],
    "blockIcons": [
      "♠️",
      "♥️",
      "♦️",
      "♣️",
      "🃏",
      "🎴",
      "🎰",
      "🎲"
    ],
    "gridOuter": "#050711",
    "gridCell": "#111628",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(212,152,48,0.46)"
  },
  "sports": {
    "id": "sports",
    "name": "⚽ 运动竞技",
    "blockColors": [
      "#4F9050",
      "#2858B0",
      "#C04848",
      "#905028",
      "#2090C8",
      "#587830",
      "#6038A0",
      "#C82838"
    ],
    "blockIcons": [
      "⚽",
      "🏀",
      "⚾",
      "🎾",
      "🏐",
      "🏈",
      "🥎",
      "🏆"
    ],
    "gridOuter": "#0A1408",
    "gridCell": "#0F1C0A",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,235,80,0.55)"
  },
  "outdoor": {
    "id": "outdoor",
    "name": "🥾 户外运动",
    "blockColors": [
      "#3878B8",
      "#3E7848",
      "#7E6048",
      "#E0B040",
      "#E08858",
      "#4FA8C8",
      "#2A8888",
      "#7068A8"
    ],
    "blockIcons": [
      "🥾",
      "⛺",
      "🧗",
      "🚴",
      "🏄",
      "🏂",
      "🛶",
      "🎣"
    ],
    "gridOuter": "#0A1420",
    "gridCell": "#101C2C",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(140,200,255,0.50)"
  },
  "vehicles": {
    "id": "vehicles",
    "name": "🏎️ 极速引擎",
    "blockColors": [
      "#8090A0",
      "#2860C8",
      "#E84020",
      "#3E7E40",
      "#1E70A8",
      "#E8C828",
      "#5080A8",
      "#6840B0"
    ],
    "blockIcons": [
      "🏎️",
      "✈️",
      "🚀",
      "🚁",
      "🚢",
      "🛵",
      "🚗",
      "🚌"
    ],
    "gridOuter": "#0E1218",
    "gridCell": "#161E2C",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,180,40,0.45)"
  },
  "forest": {
    "id": "forest",
    "name": "🌳 山林秘境",
    "blockColors": [
      "#8B5828",
      "#D87838",
      "#D4A848",
      "#4F8048",
      "#2A6038",
      "#B0386D",
      "#38A878",
      "#5090C8"
    ],
    "blockIcons": [
      "🌳",
      "🌲",
      "🌴",
      "🍁",
      "🍂",
      "🌾",
      "🪵",
      "🪺"
    ],
    "gridOuter": "#06140A",
    "gridCell": "#0E2010",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(180,255,160,0.45)"
  },
  "pirate": {
    "id": "pirate",
    "name": "🦜 海盗航行",
    "blockColors": [
      "#B02020",
      "#D8C4A0",
      "#2A6890",
      "#6E4828",
      "#14406F",
      "#2E6F45",
      "#8C2858",
      "#C8923C"
    ],
    "blockIcons": [
      "⚓",
      "🏴‍☠️",
      "🪝",
      "🦜",
      "⛵",
      "🗺️",
      "🧭",
      "💎"
    ],
    "gridOuter": "#04101F",
    "gridCell": "#0A1F32",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,200,80,0.45)"
  },
  "farm": {
    "id": "farm",
    "name": "🐄 田园农场",
    "blockColors": [
      "#B85A50",
      "#4E84B8",
      "#4E8A58",
      "#3C98B8",
      "#9A66B8",
      "#C89438",
      "#B06A38",
      "#C04E64"
    ],
    "blockIcons": [
      "🐄",
      "🐖",
      "🐑",
      "🐔",
      "🐣",
      "🌽",
      "🥕",
      "🍎"
    ],
    "gridOuter": "#07140A",
    "gridCell": "#102414",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(170,230,150,0.45)"
  },
  "desert": {
    "id": "desert",
    "name": "🐫 沙漠绿洲",
    "blockColors": [
      "#4E8EB8",
      "#B86A48",
      "#5C9A58",
      "#B89648",
      "#8A7A68",
      "#4E9A98",
      "#B85E58",
      "#8A6BB8"
    ],
    "blockIcons": [
      "🐫",
      "🦂",
      "🌵",
      "🏜️",
      "🪨",
      "🏺",
      "🛕",
      "🌅"
    ],
    "gridOuter": "#130D08",
    "gridCell": "#24190E",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(230,180,80,0.45)"
  }
};


function _hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function _rgbToHex(c) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

function _mix(a, b, t) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function _luma(c) {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
}

function _contrast(a, b) {
  return Math.abs(_luma(a) - _luma(b));
}

function _fitLuma(c, min, max) {
  let out = c;
  for (let i = 0; i < 8; i++) {
    const l = _luma(out);
    if (l < min) {
      out = _mix(out, { r: 255, g: 255, b: 255 }, Math.min(0.34, (min - l) * 1.6));
    } else if (l > max) {
      out = _mix(out, { r: 0, g: 0, b: 0 }, Math.min(0.30, (l - max) * 1.5));
    } else {
      break;
    }
  }
  return out;
}

function _mobileBlockColor(hex, gridCellHex = '#1f2937') {
  const c = _hexToRgb(hex);
  if (!c) return hex;
  const grid = _hexToRgb(gridCellHex) || { r: 31, g: 41, b: 55 };
  const gridLuma = _luma(grid);
  let out = gridLuma > 0.56
    ? _fitLuma(c, 0.26, 0.54)
    : _fitLuma(c, Math.max(0.60, gridLuma + 0.28), 0.88);

  // 手机屏幕上，方块必须和浅/深盘面拉开亮度层级。
  for (let i = 0; i < 8 && _contrast(out, grid) < 0.26; i++) {
    out = gridLuma > 0.56
      ? _mix(out, { r: 0, g: 0, b: 0 }, 0.14)
      : _mix(out, { r: 255, g: 255, b: 255 }, 0.18);
  }
  return _rgbToHex(out);
}

function _mobileGridCellColor(hex, fallback = '#26344a') {
  const c = _hexToRgb(hex);
  if (!c) return fallback;
  const whiteBase = { r: 252, g: 252, b: 250 };
  const tintedWhite = _mix(c, whiteBase, 0.97);
  return _rgbToHex(_fitLuma(tintedWhite, 0.90, 0.97));
}

function _mobileGridOuterColor(hex, gridCellHex, fallback = '#182235') {
  const c = _hexToRgb(hex);
  const grid = _hexToRgb(gridCellHex) || { r: 220, g: 224, b: 216 };
  let out = c || _hexToRgb(fallback);
  out = _mix(out, grid, 0.90);
  out = _fitLuma(out, 0.84, Math.max(0.88, _luma(grid) - 0.05));
  if (_contrast(out, grid) < 0.08) {
    out = _mix(out, { r: 0, g: 0, b: 0 }, 0.18);
  }
  return _rgbToHex(out);
}

const BOARD_WATERMARKS = {
  // v1.49 (2026-05) — 全量皮肤 HD 模式 emoji 换装（5 件套终版）：
  //   每个皮肤都注入 **5 件** hdIcons（= 默认锚点数），保证盘面上同时显示的 5 个水印
  //   两两不同，杜绝"图片重复"。主题强相关 + 全局唯一（与所有皮肤的基础 icons /
  //   其他皮肤的 hdIcons 均不重复），仅替换 emoji，不引入 hdOpacity / hdScale / hdAnchors。
  //   小程序 hdIcons 与 web 完全一致，确保 HD 模式双端 emoji 内容完全对齐。
  classic: { icons: ['🎮', '⭐'], opacity: 0.045, hdIcons: ['🕹️', '🎯', '🏁', '🎴', '🎟️'] },
  titanium: { icons: ['💠', '🔷'], opacity: 0.045, hdIcons: ['🔶', '🔺', '🟧', '🟩', '🟦'] },
  aurora: { icons: ['🐧', '❄️', '🌌'], opacity: 0.05, hdIcons: ['🧊', '☃️', '⛷️', '🌨️', '🏂'] },
  neonCity: { icons: ['🌃', '🏙️'], opacity: 0.045, hdIcons: ['🌆', '🚖', '🏨', '🚇', '🚥'] },
  ocean: { icons: ['🦈', '🐠'], opacity: 0.045, hdIcons: ['🐳', '🐙', '🐬', '🐢', '🦑'] },
  sunset: { icons: ['🌅', '🔆'], opacity: 0.05, hdIcons: ['🌇', '🌞', '🍹', '🥥', '🐚'] },
  sakura: { icons: ['🌸', '🌺'], opacity: 0.052, hdIcons: ['🌷', '🌹', '🌼', '💐', '🪷'] },
  koi: { icons: ['🎏', '🐟'], opacity: 0.05, hdIcons: ['🐉', '🌊', '🦞', '🦀', '⛩️'] },
  candy: { icons: ['🍭', '🍬'], opacity: 0.052, hdIcons: ['🍦', '🧁', '🍫', '🍪', '🎂'] },
  bubbly: { icons: ['🫧', '🐡'], opacity: 0.052, hdIcons: ['🥤', '🪀', '🧋', '🪩', '💫'] },
  toon: { icons: ['🎪', '🎠'], opacity: 0.048, hdIcons: ['🤡', '🎈', '🪅', '🎭', '🤖'] },
  pixel8: { icons: ['👾', '🎮', '🍄'], opacity: 0.055, scale: 0.34, hdIcons: ['🪙', '🏯', '⚔️', '🛡️', '🗡️'] },
  dawn: { icons: ['🌄', '🌻', '🍃'], opacity: 0.052, hdIcons: ['🐝', '🦋', '🌾', '🍯', '🌱'] },
  food: { icons: ['🍕', '🍔'], opacity: 0.048, hdIcons: ['🍣', '🍩', '🥐', '🌮', '🥗'] },
  music: { icons: ['🎹', '🎸'], opacity: 0.048, hdIcons: ['🎷', '🥁', '🎺', '🎻', '🎤'] },
  pets: { icons: ['🐶', '🐾'], opacity: 0.05, hdIcons: ['🐱', '🐰', '🐹', '🐤', '🦊'] },
  universe: { icons: ['🪐', '⭐'], opacity: 0.045, hdIcons: ['🚀', '🛸', '🌠', '☄️', '🌑'] },
  fantasy: { icons: ['🔮', '✨'], opacity: 0.048, hdIcons: ['🧙', '🪄', '🧝', '🧞', '🪬'] },
  beast: { icons: ['🦁', '🐯'], opacity: 0.048, hdIcons: ['🐆', '🐺', '🐘', '🦏', '🦒'] },
  greece: { icons: ['🏛️', '⚡'], opacity: 0.048, hdIcons: ['🦉', '🏺', '🗿', '🏹', '🐎'] },
  demon: { icons: ['😈', '💀'], opacity: 0.045, hdIcons: ['👻', '🦇', '🕷️', '🕸️', '👹'] },
  jurassic: { icons: ['🦕', '🦖'], opacity: 0.048, hdIcons: ['🦴', '🌋', '🥚', '🪨', '🦎'] },
  fairy: { icons: ['🧚', '🌸'], opacity: 0.05, hdIcons: ['🦌', '🐿️', '🪺', '🍂', '🌰'] },
  industrial: { icons: ['🏭', '⚙️'], opacity: 0.045, hdIcons: ['🔩', '🛠️', '⚒️', '🪛', '⛏️'] },
  forbidden: { icons: ['👑', '🐲'], opacity: 0.048, hdIcons: ['🪭', '🧧', '🏮', '🥢', '🍵'] },
  // v1.49 (2026-05) — mahjong HD 模式"麻将特色 emoji 换装"（5 件套终版）：
  //   基础 ['🀅','🀀'] → HD ['🎲','🀐','🀙','🀇','🀄']（骰子 + 一索/幺鸡 + 一筒 + 一万 + 红中），
  //   5 件 = 默认锚点数，保证盘面上 5 个水印两两不同（杜绝 i%2 循环导致的"3 个 🎲 重复"）。
  //   亮度 / scale / 锚点 / 漂浮节奏全部与其他皮肤完全一致（不引入 hdOpacity / hdScale / hdAnchors）。
  //   小程序基础水印保留双字（移动端默认 opacity 0.06）；
  //   高画质模式（_qualityMode='high'）切到 hdIcons 5 件套，与 web 端体验对齐。
  mahjong: {
    icons: ['🀅', '🀀'],
    opacity: 0.06,
    hdIcons: ['🎲', '🀐', '🀙', '🀇', '🀄'],
  },
  boardgame: { icons: ['🃏', '♠️'], opacity: 0.04, hdIcons: ['🎰', '♟️', '♣️', '♥️', '♦️'] },
  sports: { icons: ['⚽', '🏆'], opacity: 0.048, hdIcons: ['🏀', '🥇', '🏐', '🏈', '⚾'] },
  outdoor: { icons: ['🥾', '⛺'], opacity: 0.052, hdIcons: ['🏔️', '🧗', '🎒', '🧭', '🪃'] },
  vehicles: { icons: ['🏎️', '✈️'], opacity: 0.048, hdIcons: ['🚂', '🚁', '🚤', '🛵', '🚜'] },
  forest: { icons: ['🌳', '🍁'], opacity: 0.048, hdIcons: ['🌲', '🐻', '🐗', '🦔', '🍇'] },
  pirate: { icons: ['🦜', '🏴‍☠️'], opacity: 0.048, hdIcons: ['⚓', '🗺️', '💰', '🛶', '🚣'] },
  farm: { icons: ['🐄', '🌽'], opacity: 0.04, hdIcons: ['🐔', '🥕', '🐑', '🐖', '🥬'] },
  desert: { icons: ['🐫', '🌵'], opacity: 0.04, hdIcons: ['🦂', '🌴', '🏜️', '🐍', '🌶️'] },
};

function _optimizeSkinForMobile(skin) {
  const gridCell = _mobileGridCellColor(skin.gridCell, '#26344a');
  const gridOuter = _mobileGridOuterColor(skin.gridOuter, gridCell, '#182235');
  const baseRadius = Math.max(4, Math.min(8, skin.blockRadius || 6));
  return {
    ...skin,
    blockColors: (skin.blockColors || CLASSIC_PALETTE).map((color) => _mobileBlockColor(color, gridCell)),
    gridOuter,
    gridCell,
    gridGap: Math.max(1, skin.gridGap || 1),
    blockInset: Math.max(1, Math.min(2, skin.blockInset || 2)),
    blockRadius: baseRadius,
    boardWatermark: BOARD_WATERMARKS[skin.id] || { icons: skin.blockIcons || ['✦'], opacity: 0.045 },
    clearFlash: skin.clearFlash || 'rgba(255,255,255,0.72)',
    mobileOptimized: true,
  };
}

for (const id of Object.keys(SKINS)) {
  SKINS[id] = _optimizeSkinForMobile(SKINS[id]);
}


const SKIN_LIST = Object.values(SKINS);

function getActiveSkinId() {
  const id = storage.getItem(STORAGE_KEY);
  if (id && SKINS[id]) return id;
  return DEFAULT_SKIN_ID;
}

function getActiveSkin() {
  return SKINS[getActiveSkinId()] || SKINS[DEFAULT_SKIN_ID];
}

function getBlockColors() {
  return getActiveSkin().blockColors || CLASSIC_PALETTE;
}

function setActiveSkinId(id) {
  if (!SKINS[id]) return false;
  storage.setItem(STORAGE_KEY, id);
  return true;
}

function getSkinListMeta() {
  return SKIN_LIST.map((s) => ({ id: s.id, name: s.name }));
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_SKIN_ID,
  CLASSIC_PALETTE,
  SKINS,
  SKIN_LIST,
  getActiveSkinId,
  getActiveSkin,
  getBlockColors,
  setActiveSkinId,
  getSkinListMeta,
};
