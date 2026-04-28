/**
 * 小程序皮肤配置（自动同步自 web/src/skins.js 的核心渲染字段）。
 */
const storage = require('../adapters/storage');

const STORAGE_KEY = 'openblock_skin';
const DEFAULT_SKIN_ID = "titanium";

const CLASSIC_PALETTE = [
  "#80D455",
  "#5BB8F8",
  "#FF9840",
  "#FFD820",
  "#80A8FF",
  "#FF7868",
  "#FF98C0",
  "#C8A8FF"
];

const SKINS = {
  "classic": {
    "id": "classic",
    "name": "✨ 极简经典",
    "blockColors": [
      "#80D455",
      "#5BB8F8",
      "#FF9840",
      "#FFD820",
      "#80A8FF",
      "#FF7868",
      "#FF98C0",
      "#C8A8FF"
    ],
    "gridOuter": "#1C2630",
    "gridCell": "#2E3E50",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "glossy",
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
  "cyber": {
    "id": "cyber",
    "name": "⚡ 赛博朋克",
    "blockColors": [
      "#00E8C8",
      "#F52885",
      "#B060F0",
      "#50CCF0",
      "#3B82F6",
      "#EC4899",
      "#10F5A8",
      "#FF2070"
    ],
    "gridOuter": "#060214",
    "gridCell": "#0C0826",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "neon",
    "clearFlash": "rgba(80,204,240,0.38)"
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
    "blockStyle": "glass",
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
    "blockStyle": "glass",
    "clearFlash": "rgba(144,224,239,0.35)"
  },
  "sunset": {
    "id": "sunset",
    "name": "🌅 暮色日落",
    "blockColors": [
      "#FF7761",
      "#FF9A56",
      "#FFCC5C",
      "#88D8B0",
      "#8098CF",
      "#D478CA",
      "#FF8FA0",
      "#FFB870"
    ],
    "gridOuter": "#160A14",
    "gridCell": "#261424",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "glossy",
    "clearFlash": "rgba(255,200,150,0.40)"
  },
  "lava": {
    "id": "lava",
    "name": "🔥 熔岩炽焰",
    "blockColors": [
      "#FF4040",
      "#FF6830",
      "#FF9020",
      "#FFB818",
      "#E84040",
      "#FF3868",
      "#FF7848",
      "#FFA830"
    ],
    "gridOuter": "#0E0604",
    "gridCell": "#1E0C08",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 4,
    "blockStyle": "glossy",
    "clearFlash": "rgba(255,180,80,0.40)"
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
    "gridOuter": "#180810",
    "gridCell": "#280C1C",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "glass",
    "clearFlash": "rgba(255,180,220,0.50)"
  },
  "koi": {
    "id": "koi",
    "name": "🎏 锦鲤跃龙",
    "blockColors": [
      "#FF5040",
      "#F07828",
      "#F0C820",
      "#3A9EC8",
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
    "blockStyle": "glass",
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
    "gridOuter": "#1A0828",
    "gridCell": "#280E40",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "glossy",
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
      "🦩",
      "🪼",
      "🌿",
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
    "blockStyle": "jelly",
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
      "#FF6098",
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
    "name": "🕹️ 街机格斗",
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
    "blockStyle": "glossy",
    "clearFlash": "#FFFFF0"
  },
  "dawn": {
    "id": "dawn",
    "name": "☀️ 晨光微曦",
    "blockColors": [
      "#B02000",
      "#0050C0",
      "#A85800",
      "#187030",
      "#8010B0",
      "#006868",
      "#C01040",
      "#4020C8"
    ],
    "gridOuter": "#8A7040",
    "gridCell": "#F8F0E0",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "glossy",
    "clearFlash": "rgba(255,235,180,0.90)"
  },
  "macaroon": {
    "id": "macaroon",
    "name": "🍬 法式马卡",
    "blockColors": [
      "#C01860",
      "#0058C0",
      "#B06000",
      "#1A7830",
      "#8020C0",
      "#007860",
      "#C02020",
      "#5828B0"
    ],
    "gridOuter": "#A09088",
    "gridCell": "#FAF6F0",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "flat",
    "clearFlash": "rgba(255,240,255,0.90)"
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
      "#D87040",
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
    "blockStyle": "glossy",
    "clearFlash": "rgba(255,200,100,0.88)"
  },
  "music": {
    "id": "music",
    "name": "🎵 音乐律动",
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
    "name": "🐾 萌宠天地",
    "blockColors": [
      "#B82020",
      "#A05800",
      "#7A6000",
      "#187020",
      "#1050B8",
      "#901078",
      "#C02820",
      "#006060"
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
    "blockStyle": "glass",
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
    "gridOuter": "#08041A",
    "gridCell": "#120830",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "glass",
    "clearFlash": "rgba(160,80,255,0.40)"
  },
  "beast": {
    "id": "beast",
    "name": "🗺️ 冒险奇境",
    "blockColors": [
      "#F0A820",
      "#F07030",
      "#5090D8",
      "#B0B8C8",
      "#D08830",
      "#E08050",
      "#A0A8A8",
      "#40A0D8"
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
    "blockStyle": "glossy",
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
    "gridOuter": "#08080E",
    "gridCell": "#10101C",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "glossy",
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
    "gridOuter": "#0A0412",
    "gridCell": "#180828",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "glass",
    "clearFlash": "rgba(200,20,30,0.45)"
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
    "gridOuter": "#080E04",
    "gridCell": "#101A08",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "glossy",
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
    "gridOuter": "#100820",
    "gridCell": "#1A1030",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 9,
    "blockStyle": "glass",
    "clearFlash": "rgba(240,150,240,0.52)"
  },
  "industrial": {
    "id": "industrial",
    "name": "⚙️ 古典工业",
    "blockColors": [
      "#D49640",
      "#C04030",
      "#B86838",
      "#4F9080",
      "#B07840",
      "#B89060",
      "#6878A0",
      "#D4A848"
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
    "blockStyle": "metal",
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
    "blockStyle": "glossy",
    "clearFlash": "rgba(232,184,60,0.52)"
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
    "blockStyle": "glossy",
    "clearFlash": "rgba(255,235,80,0.55)"
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
      "#404858",
      "#6840B0"
    ],
    "blockIcons": [
      "🏎️",
      "✈️",
      "🚀",
      "🚁",
      "🚢",
      "🛵",
      "🚥",
      "🚌"
    ],
    "gridOuter": "#0E1218",
    "gridCell": "#161E2C",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "metal",
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
    "blockStyle": "glossy",
    "clearFlash": "rgba(180,255,160,0.45)"
  },
  "pirate": {
    "id": "pirate",
    "name": "⚓ 海盗航行",
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
    "blockStyle": "glass",
    "clearFlash": "rgba(255,200,80,0.45)"
  },
  "farm": {
    "id": "farm",
    "name": "🐄 田园农场",
    "blockColors": [
      "#B02838",
      "#1A488F",
      "#2A7038",
      "#1A6E9F",
      "#8E2070",
      "#B82038",
      "#1F6038",
      "#4830B0"
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
    "gridOuter": "#B89668",
    "gridCell": "#F5EDD8",
    "gridGap": 1,
    "blockInset": 1,
    "blockRadius": 9,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,235,170,0.88)"
  },
  "desert": {
    "id": "desert",
    "name": "🐫 沙漠绿洲",
    "blockColors": [
      "#1F5870",
      "#E8B860",
      "#D8A050",
      "#2A8068",
      "#C46838",
      "#2A6048",
      "#6038A8",
      "#1F4870"
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
    "gridOuter": "#0A0E1A",
    "gridCell": "#161E2E",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "glossy",
    "clearFlash": "rgba(232,184,80,0.50)"
  }
};

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
