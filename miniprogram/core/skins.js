/**
 * 小程序皮肤配置（自动同步自 web/src/skins.js 的核心渲染字段）。
 */
const storage = require('../adapters/storage');
const GAME_RULES = require('./game_rules.json');

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
      "#B86858",
      "#5890D0",
      "#C8A060",
      "#489868",
      "#8868B0",
      "#489898",
      "#C06078",
      "#7068C8"
    ],
    "gridOuter": "#8A7040",
    "gridCell": "#F8F0E0",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "glossy",
    "clearFlash": "rgba(255,235,180,0.90)"
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
    "gridCell": "#280A12",
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
      "#D49830",
      "#1F8060",
      "#2860B0",
      "#98A8B8",
      "#5C2030",
      "#3D6048",
      "#4F3088",
      "#3E3E50"
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
    "gridOuter": "#1A0810",
    "gridCell": "#142818",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
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
      "#C89898",
      "#88A8D0",
      "#88B088",
      "#78B8D0",
      "#C898C0",
      "#C0A878",
      "#B89878",
      "#A898D0"
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
    "gridOuter": "#7A8868",
    "gridCell": "#EFF0EA",
    "gridGap": 1,
    "blockInset": 1,
    "blockRadius": 9,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(216,220,210,0.50)"
  },
  "desert": {
    "id": "desert",
    "name": "🐫 沙漠绿洲",
    "blockColors": [
      "#AAB8C2",
      "#C9A090",
      "#A8BA9E",
      "#C9BE9E",
      "#ADA8AE",
      "#95AEAC",
      "#C49A94",
      "#B5A8B4"
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
    "gridOuter": "#786E50",
    "gridCell": "#E8E2D6",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(216,210,196,0.45)"
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

/** RL 无头局：与网页 simulator 一致，固定 canonical 主题的 detectBonusLines / monoNearFullLine */
function getRlTrainingBonusLineSkin() {
  const cfg = GAME_RULES.rlBonusScoring || {};
  if (cfg.useGameplayBonusRules === false) {
    return null;
  }
  const raw = cfg.blockIcons;
  if (Array.isArray(raw) && raw.length > 0) {
    return { blockIcons: raw.map((x) => String(x)) };
  }
  const sid = typeof cfg.canonicalSkinId === 'string' && SKINS[cfg.canonicalSkinId]
    ? cfg.canonicalSkinId
    : DEFAULT_SKIN_ID;
  const icons = SKINS[sid]?.blockIcons;
  if (!icons?.length) {
    return null;
  }
  return { blockIcons: icons };
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
  getRlTrainingBonusLineSkin,
};
