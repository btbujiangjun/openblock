/**
 * 小程序皮肤配置（自动同步自 web/src/skins.js 的核心渲染字段）。
 */
const storage = require('../adapters/storage');

const STORAGE_KEY = 'openblock_skin';
const DEFAULT_SKIN_ID = "titanium";

const CLASSIC_PALETTE = [
  "#6E90E1",
  "#4FB8E8",
  "#52BC4B",
  "#FFC428",
  "#F5851E",
  "#BD74E7",
  "#65C4F0",
  "#EC6B77"
];

const SKINS = {
  "classic": {
    "id": "classic",
    "name": "✨ 极简经典",
    "blockColors": [
      "#6E90E1",
      "#4FB8E8",
      "#52BC4B",
      "#FFC428",
      "#F5851E",
      "#BD74E7",
      "#65C4F0",
      "#EC6B77"
    ],
    "blockIcons": [
      "🏆",
      "💎",
      "🎯",
      "🎲",
      "♠️",
      "♥️",
      "🃏",
      "🎰"
    ],
    "gridOuter": "#1C2630",
    "gridCell": "#2E3E50",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 4,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(220,240,255,0.90)"
  },
  "titanium": {
    "id": "titanium",
    "name": "💎 钛晶凝光",
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
    "blockIcons": [
      "⚙️",
      "🔩",
      "🛡️",
      "🔧",
      "💠",
      "⚒️",
      "🛠️",
      "⛓️"
    ],
    "gridOuter": "#0A1020",
    "gridCell": "#182030",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(200,220,245,0.42)"
  },
  "aurora": {
    "id": "aurora",
    "name": "🌌 极光幻梦",
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
      "⛄",
      "🐺",
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
    "name": "🌃 霓虹未眠",
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
    "blockIcons": [
      "🌆",
      "🚥",
      "🚇",
      "🎆",
      "🏨",
      "🚖",
      "🌉",
      "🛤️"
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
    "name": "🌊 深海之瞳",
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
      "🐬",
      "🐚",
      "🐳",
      "🦈",
      "🐢"
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
    "blockIcons": [
      "🌅",
      "🏺",
      "🌼",
      "🏵️",
      "🍀",
      "🍂",
      "🌺",
      "🐫"
    ],
    "gridOuter": "#241019",
    "gridCell": "#341628",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,200,140,0.50)"
  },
  "sakura": {
    "id": "sakura",
    "name": "🌸 樱落无声",
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
    "blockIcons": [
      "🌸",
      "🕊️",
      "🏯",
      "🎎",
      "🧘",
      "🎑",
      "🍶",
      "🥢"
    ],
    "gridOuter": "#241018",
    "gridCell": "#321628",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,180,220,0.52)"
  },
  "koi": {
    "id": "koi",
    "name": "🎏 锦鲤戏月",
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
    "name": "🍭 糖心蜜语",
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
  "toon": {
    "id": "toon",
    "name": "🎨 童画世界",
    "blockColors": [
      "#FF5570",
      "#FF7F11",
      "#FFD600",
      "#00C853",
      "#5590FF",
      "#DD60FF",
      "#D46D3A",
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
    "name": "👾 像素纪元",
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
      "💰",
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
      "#DA5244",
      "#4181D0",
      "#A67925",
      "#488D61",
      "#8970CC",
      "#378C8C",
      "#D15578",
      "#6678DC"
    ],
    "blockIcons": [
      "🐝",
      "🌱",
      "🍯",
      "🦗",
      "🐞",
      "🌿",
      "🐣",
      "🐓"
    ],
    "gridOuter": "#D8C8A4",
    "gridCell": "#EDE0C4",
    "gridGap": 0,
    "blockInset": 3,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,210,130,0.72)"
  },
  "summer": {
    "id": "summer",
    "name": "🏖️ 夏日海风",
    "blockColors": [
      "#D81C30",
      "#8B681D",
      "#467A1D",
      "#3271B1",
      "#1D7E68",
      "#826D15",
      "#D71E1E",
      "#8B44B0"
    ],
    "blockIcons": [
      "🍉",
      "🍦",
      "🥥",
      "🏝️",
      "🍧",
      "🍹",
      "🏄",
      "🏓"
    ],
    "gridOuter": "#8AAEC8",
    "gridCell": "#A8C4D8",
    "gridGap": 0,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,248,180,0.72)"
  },
  "food": {
    "id": "food",
    "name": "🍕 烟火食光",
    "blockColors": [
      "#FF5040",
      "#F09020",
      "#F8D020",
      "#60B830",
      "#E09050",
      "#B8542A",
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
    "name": "🎹 音律星河",
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
    "name": "🐶 萌宠时光",
    "blockColors": [
      "#B5695E",
      "#967660",
      "#7E7E51",
      "#57876F",
      "#648379",
      "#907853",
      "#89749F",
      "#877D56"
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
    "name": "🌑 星河漫游",
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
      "🌑",
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
    "name": "🔮 幻梦之境",
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
    "blockIcons": [
      "🧙",
      "🧝",
      "🧞",
      "💫",
      "🗝️",
      "📿",
      "🧿",
      "🔮"
    ],
    "gridOuter": "#0E0428",
    "gridCell": "#1A0838",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(160,80,255,0.42)"
  },
  "greece": {
    "id": "greece",
    "name": "🏛️ 众神之诗",
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
    "name": "😈 永夜咏叹",
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
    "name": "🦕 远古之息",
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
    "name": "🧚 花语星梦",
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
      "🌟",
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
  "forbidden": {
    "id": "forbidden",
    "name": "👑 紫禁浮光",
    "blockColors": [
      "#D8252F",
      "#1B7E5C",
      "#2B6BD6",
      "#D8CCB0",
      "#E8B83C",
      "#317891",
      "#B8732C",
      "#E84068"
    ],
    "blockIcons": [
      "🐲",
      "👑",
      "🎭",
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
    "name": "🀄 牌影江湖",
    "blockColors": [
      "#4FC0A1",
      "#D9848B",
      "#D4C4A0",
      "#919BAF",
      "#36AF90",
      "#E6B263",
      "#6C9DDA",
      "#B9B148"
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
  "forest": {
    "id": "forest",
    "name": "🌳 荒野秘境",
    "blockColors": [
      "#A5682F",
      "#D97B3C",
      "#6B7BA2",
      "#518349",
      "#D4A028",
      "#C4497F",
      "#A36934",
      "#5392C9"
    ],
    "blockIcons": [
      "🌳",
      "🌲",
      "🦝",
      "🍁",
      "🦅",
      "🌾",
      "🐻",
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
  "apple": {
    "id": "apple",
    "name": "🍎 果韵匠心",
    "blockColors": [
      "#C8C8CC",
      "#8E8E93",
      "#D4B88C",
      "#E8B4B8",
      "#5F7488",
      "#A8BCC8",
      "#6261E7",
      "#E55934"
    ],
    "blockIcons": [
      "🍎",
      "💻",
      "✈️",
      "🚀",
      "📡",
      "🔋",
      "💾",
      "🔌"
    ],
    "gridOuter": "#0E0E12",
    "gridCell": "#1A1A20",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(200,200,220,0.30)"
  },
  "cafe": {
    "id": "cafe",
    "name": "☕ 午后咖啡",
    "blockColors": [
      "#8A6A50",
      "#6A7A6A",
      "#997356",
      "#548172",
      "#947556",
      "#707E61",
      "#8A6A6A",
      "#617E7E"
    ],
    "blockIcons": [
      "☕",
      "📖",
      "🥤",
      "🌵",
      "🕯️",
      "🥐",
      "🎵",
      "📝"
    ],
    "gridOuter": "#C0AC90",
    "gridCell": "#D8CCBA",
    "gridGap": 0,
    "blockInset": 3,
    "blockRadius": 8,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(210,180,140,0.65)"
  },
  "arcadeCabinet": {
    "id": "arcadeCabinet",
    "name": "📺 复古街机",
    "blockColors": [
      "#35E06F",
      "#FF3B6B",
      "#20C8FF",
      "#FFD13D",
      "#B05CFF",
      "#FF8A24",
      "#40E0D0",
      "#F4F4F8"
    ],
    "blockIcons": [
      "📺",
      "📟",
      "💽",
      "📀",
      "💿",
      "📼",
      "🎚️",
      "🎛️"
    ],
    "blockIconAssets": [
      "/assets/skins/arcadeCabinet/block-0.svg",
      "/assets/skins/arcadeCabinet/block-1.svg",
      "/assets/skins/arcadeCabinet/block-2.svg",
      "/assets/skins/arcadeCabinet/block-3.svg",
      "/assets/skins/arcadeCabinet/block-4.svg",
      "/assets/skins/arcadeCabinet/block-5.svg",
      "/assets/skins/arcadeCabinet/block-6.svg",
      "/assets/skins/arcadeCabinet/block-7.svg"
    ],
    "gridOuter": "#050815",
    "gridCell": "#10172A",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "pixel8",
    "clearFlash": "rgba(90,240,180,0.78)"
  },
  "circuitBoard": {
    "id": "circuitBoard",
    "name": "🧲 电路矩阵",
    "blockColors": [
      "#2FE68A",
      "#48B8FF",
      "#D6F75A",
      "#A978FF",
      "#F5A642",
      "#B07848",
      "#6EE7C8",
      "#FF5E7A"
    ],
    "blockIcons": [
      "🧲",
      "📶",
      "🟢",
      "🟣",
      "🟡",
      "🟤",
      "🪛",
      "🪫"
    ],
    "blockIconAssets": [
      "/assets/skins/circuitBoard/block-0.svg",
      "/assets/skins/circuitBoard/block-1.svg",
      "/assets/skins/circuitBoard/block-2.svg",
      "/assets/skins/circuitBoard/block-3.svg",
      "/assets/skins/circuitBoard/block-4.svg",
      "/assets/skins/circuitBoard/block-5.svg",
      "/assets/skins/circuitBoard/block-6.svg",
      "/assets/skins/circuitBoard/block-7.svg"
    ],
    "gridOuter": "#061A12",
    "gridCell": "#0D2A1D",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 5,
    "blockStyle": "neon",
    "clearFlash": "rgba(80,255,180,0.62)"
  },
  "toyBox": {
    "id": "toyBox",
    "name": "🧸 玩具箱子",
    "blockColors": [
      "#E8527A",
      "#F38C32",
      "#F7D04A",
      "#58C56A",
      "#42A7E8",
      "#9B72F0",
      "#F06DB8",
      "#38C8BE"
    ],
    "blockIcons": [
      "🧸",
      "🪀",
      "🪁",
      "🧩",
      "🪆",
      "🛝",
      "🛴",
      "🎳"
    ],
    "blockIconAssets": [
      "/assets/skins/toyBox/block-0.svg",
      "/assets/skins/toyBox/block-1.svg",
      "/assets/skins/toyBox/block-2.svg",
      "/assets/skins/toyBox/block-3.svg",
      "/assets/skins/toyBox/block-4.svg",
      "/assets/skins/toyBox/block-5.svg",
      "/assets/skins/toyBox/block-6.svg",
      "/assets/skins/toyBox/block-7.svg"
    ],
    "gridOuter": "#CCB88C",
    "gridCell": "#F4E8CE",
    "gridGap": 0,
    "blockInset": 3,
    "blockRadius": 9,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,220,120,0.75)"
  },
  "mineralCave": {
    "id": "mineralCave",
    "name": "💍 宝石矿洞",
    "blockColors": [
      "#54D3D8",
      "#B38AF6",
      "#D6A15C",
      "#8C6A4A",
      "#7A54D6",
      "#D8BC4C",
      "#E06A3A",
      "#4A8EE8"
    ],
    "blockIcons": [
      "💍",
      "🔦",
      "🧱",
      "🟫",
      "🟪",
      "🟨",
      "🔸",
      "🔹"
    ],
    "blockIconAssets": [
      "/assets/skins/mineralCave/block-0.svg",
      "/assets/skins/mineralCave/block-1.svg",
      "/assets/skins/mineralCave/block-2.svg",
      "/assets/skins/mineralCave/block-3.svg",
      "/assets/skins/mineralCave/block-4.svg",
      "/assets/skins/mineralCave/block-5.svg",
      "/assets/skins/mineralCave/block-6.svg",
      "/assets/skins/mineralCave/block-7.svg"
    ],
    "gridOuter": "#12131C",
    "gridCell": "#202132",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(160,230,255,0.58)"
  },
  "alchemyLab": {
    "id": "alchemyLab",
    "name": "⚗️ 炼金工坊",
    "blockColors": [
      "#8BD450",
      "#4AC7C0",
      "#C06BE8",
      "#D8B04A",
      "#B87333",
      "#58A6E8",
      "#E06088",
      "#6DAA60"
    ],
    "blockIcons": [
      "⚗️",
      "🧪",
      "🧫",
      "🧴",
      "🧂",
      "🪶",
      "🧵",
      "🫙"
    ],
    "blockIconAssets": [
      "/assets/skins/alchemyLab/block-0.svg",
      "/assets/skins/alchemyLab/block-1.svg",
      "/assets/skins/alchemyLab/block-2.svg",
      "/assets/skins/alchemyLab/block-3.svg",
      "/assets/skins/alchemyLab/block-4.svg",
      "/assets/skins/alchemyLab/block-5.svg",
      "/assets/skins/alchemyLab/block-6.svg",
      "/assets/skins/alchemyLab/block-7.svg"
    ],
    "gridOuter": "#17120A",
    "gridCell": "#2A2112",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(180,255,140,0.60)"
  },
  "botanicalStudy": {
    "id": "botanicalStudy",
    "name": "🥀 植物标本",
    "blockColors": [
      "#8C4A5A",
      "#4F7F55",
      "#6C9B4A",
      "#B24F5A",
      "#9C7240",
      "#5F8A68",
      "#486A50",
      "#8A6A4B"
    ],
    "blockIcons": [
      "🥀",
      "🫛",
      "🫒",
      "🍓",
      "🫚",
      "🪴",
      "🪲",
      "🫘"
    ],
    "blockIconAssets": [
      "/assets/skins/botanicalStudy/block-0.svg",
      "/assets/skins/botanicalStudy/block-1.svg",
      "/assets/skins/botanicalStudy/block-2.svg",
      "/assets/skins/botanicalStudy/block-3.svg",
      "/assets/skins/botanicalStudy/block-4.svg",
      "/assets/skins/botanicalStudy/block-5.svg",
      "/assets/skins/botanicalStudy/block-6.svg",
      "/assets/skins/botanicalStudy/block-7.svg"
    ],
    "gridOuter": "#BFC7A8",
    "gridCell": "#E7E8D8",
    "gridGap": 0,
    "blockInset": 3,
    "blockRadius": 8,
    "blockStyle": "flat",
    "clearFlash": "rgba(170,220,130,0.62)"
  },
  "spaceDock": {
    "id": "spaceDock",
    "name": "🛰️ 太空船坞",
    "blockColors": [
      "#4AD8FF",
      "#8C7CFF",
      "#56E6A4",
      "#F6C84A",
      "#EF6A7A",
      "#6FA8FF",
      "#B6E6FF",
      "#D48BFF"
    ],
    "blockIcons": [
      "🛰️",
      "🧑‍🚀",
      "👨‍🚀",
      "👩‍🚀",
      "🛞",
      "🧯",
      "🗜️",
      "📍"
    ],
    "blockIconAssets": [
      "/assets/skins/spaceDock/block-0.svg",
      "/assets/skins/spaceDock/block-1.svg",
      "/assets/skins/spaceDock/block-2.svg",
      "/assets/skins/spaceDock/block-3.svg",
      "/assets/skins/spaceDock/block-4.svg",
      "/assets/skins/spaceDock/block-5.svg",
      "/assets/skins/spaceDock/block-6.svg",
      "/assets/skins/spaceDock/block-7.svg"
    ],
    "gridOuter": "#06101F",
    "gridCell": "#101A30",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "neon",
    "clearFlash": "rgba(120,220,255,0.70)"
  },
  "dungeonLoot": {
    "id": "dungeonLoot",
    "name": "🪤 地牢宝藏",
    "blockColors": [
      "#B88438",
      "#686070",
      "#B84A3A",
      "#4F8A70",
      "#8C6A42",
      "#C6A64A",
      "#B04A68",
      "#586078"
    ],
    "blockIcons": [
      "🪤",
      "🕳️",
      "🪓",
      "🧰",
      "📦",
      "⚜️",
      "🏚️",
      "🪦"
    ],
    "blockIconAssets": [
      "/assets/skins/dungeonLoot/block-0.svg",
      "/assets/skins/dungeonLoot/block-1.svg",
      "/assets/skins/dungeonLoot/block-2.svg",
      "/assets/skins/dungeonLoot/block-3.svg",
      "/assets/skins/dungeonLoot/block-4.svg",
      "/assets/skins/dungeonLoot/block-5.svg",
      "/assets/skins/dungeonLoot/block-6.svg",
      "/assets/skins/dungeonLoot/block-7.svg"
    ],
    "gridOuter": "#0F0C10",
    "gridCell": "#1D1720",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 6,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,210,110,0.62)"
  },
  "origamiPaper": {
    "id": "origamiPaper",
    "name": "✉️ 折纸纸艺",
    "blockColors": [
      "#D86A88",
      "#E29B52",
      "#D8C86A",
      "#78A870",
      "#64A8C8",
      "#9B7AC8",
      "#C47AA0",
      "#8CA0B8"
    ],
    "blockIcons": [
      "✉️",
      "📄",
      "🏷️",
      "🔖",
      "🧾",
      "📰",
      "📑",
      "📃"
    ],
    "blockIconAssets": [
      "/assets/skins/origamiPaper/block-0.svg",
      "/assets/skins/origamiPaper/block-1.svg",
      "/assets/skins/origamiPaper/block-2.svg",
      "/assets/skins/origamiPaper/block-3.svg",
      "/assets/skins/origamiPaper/block-4.svg",
      "/assets/skins/origamiPaper/block-5.svg",
      "/assets/skins/origamiPaper/block-6.svg",
      "/assets/skins/origamiPaper/block-7.svg"
    ],
    "gridOuter": "#C9BFAE",
    "gridCell": "#ECE5D8",
    "gridGap": 0,
    "blockInset": 3,
    "blockRadius": 4,
    "blockStyle": "flat",
    "clearFlash": "rgba(255,235,190,0.66)"
  },
  "museumRelic": {
    "id": "museumRelic",
    "name": "⚱️ 博物遗珍",
    "blockColors": [
      "#B0703C",
      "#8A6A48",
      "#506A78",
      "#9B4F4A",
      "#7A6AA0",
      "#C0A05A",
      "#4F8068",
      "#8C7850"
    ],
    "blockIcons": [
      "⚱️",
      "🔎",
      "🗄️",
      "🖼️",
      "🪞",
      "📏",
      "🧭",
      "🪙"
    ],
    "blockIconAssets": [
      "/assets/skins/museumRelic/block-0.svg",
      "/assets/skins/museumRelic/block-1.svg",
      "/assets/skins/museumRelic/block-2.svg",
      "/assets/skins/museumRelic/block-3.svg",
      "/assets/skins/museumRelic/block-4.svg",
      "/assets/skins/museumRelic/block-5.svg",
      "/assets/skins/museumRelic/block-6.svg",
      "/assets/skins/museumRelic/block-7.svg"
    ],
    "gridOuter": "#17120C",
    "gridCell": "#281F14",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(230,190,120,0.58)"
  },
  "winterCabin": {
    "id": "winterCabin",
    "name": "🪵 冬日木屋",
    "blockColors": [
      "#7A5130",
      "#B04A4A",
      "#2F6F88",
      "#C09854",
      "#556B84",
      "#D06A38",
      "#6F8A70",
      "#A05A48"
    ],
    "blockIcons": [
      "🪵",
      "🧤",
      "🧣",
      "🧦",
      "🛷",
      "🔥",
      "🫖",
      "🏕️"
    ],
    "blockIconAssets": [
      "/assets/skins/winterCabin/block-0.svg",
      "/assets/skins/winterCabin/block-1.svg",
      "/assets/skins/winterCabin/block-2.svg",
      "/assets/skins/winterCabin/block-3.svg",
      "/assets/skins/winterCabin/block-4.svg",
      "/assets/skins/winterCabin/block-5.svg",
      "/assets/skins/winterCabin/block-6.svg",
      "/assets/skins/winterCabin/block-7.svg"
    ],
    "gridOuter": "#E0D7C8",
    "gridCell": "#F3EFE6",
    "gridGap": 0,
    "blockInset": 3,
    "blockRadius": 8,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(210,235,255,0.66)"
  },
  "rainyWindow": {
    "id": "rainyWindow",
    "name": "🌧️ 雨窗夜灯",
    "blockColors": [
      "#4C8FB8",
      "#6AA0D0",
      "#3FC0D0",
      "#58D0B8",
      "#A8B8C8",
      "#8A74C8",
      "#6A7A90",
      "#D8B858"
    ],
    "blockIcons": [
      "🌧️",
      "☔",
      "💧",
      "💦",
      "🪟",
      "🌂",
      "☁️",
      "💡"
    ],
    "blockIconAssets": [
      "/assets/skins/rainyWindow/block-0.svg",
      "/assets/skins/rainyWindow/block-1.svg",
      "/assets/skins/rainyWindow/block-2.svg",
      "/assets/skins/rainyWindow/block-3.svg",
      "/assets/skins/rainyWindow/block-4.svg",
      "/assets/skins/rainyWindow/block-5.svg",
      "/assets/skins/rainyWindow/block-6.svg",
      "/assets/skins/rainyWindow/block-7.svg"
    ],
    "gridOuter": "#07101A",
    "gridCell": "#101C2A",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 7,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(140,210,255,0.58)"
  },
  "fiesta": {
    "id": "fiesta",
    "name": "🎉 欢庆嘉年",
    "blockColors": [
      "#FF3058",
      "#FF9020",
      "#FFD028",
      "#30D850",
      "#2098FF",
      "#CC40FF",
      "#FF50A0",
      "#20D0D0"
    ],
    "blockIcons": [
      "🎉",
      "🎊",
      "🎈",
      "🎠",
      "🥳",
      "🎁",
      "🧨",
      "🎪"
    ],
    "gridOuter": "#180828",
    "gridCell": "#281040",
    "gridGap": 1,
    "blockInset": 2,
    "blockRadius": 8,
    "blockStyle": "cartoon",
    "clearFlash": "rgba(255,220,100,0.85)"
  }
};

const SKIN_CATEGORIES = [
  {
    "id": "classic",
    "label": "🔰 经典 · 科技",
    "skins": [
      "classic",
      "titanium",
      "aurora",
      "neonCity",
      "candy",
      "toon",
      "pixel8",
      "arcadeCabinet",
      "circuitBoard",
      "spaceDock"
    ]
  },
  {
    "id": "nature",
    "label": "🌿 自然 · 清新",
    "skins": [
      "ocean",
      "sunset",
      "forest",
      "dawn",
      "summer",
      "cafe",
      "sakura",
      "botanicalStudy",
      "mineralCave",
      "winterCabin",
      "rainyWindow"
    ]
  },
  {
    "id": "life",
    "label": "🏷️ 生活 · 庆典",
    "skins": [
      "food",
      "music",
      "pets",
      "universe",
      "fiesta",
      "apple",
      "koi",
      "toyBox"
    ]
  },
  {
    "id": "fantasy",
    "label": "🧿 奇幻 · 文化",
    "skins": [
      "fantasy",
      "fairy",
      "greece",
      "demon",
      "jurassic",
      "forbidden",
      "mahjong",
      "alchemyLab",
      "dungeonLoot",
      "origamiPaper",
      "museumRelic"
    ]
  }
];


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
  aurora: { icons: ['🐧', '❄️', '🌌'], opacity: 0.05, hdIcons: ['⛸️', '☃️', '⛷️', '🌨️', '🏂'] },
  neonCity: { icons: ['🌃', '🏙️'], opacity: 0.045, hdIcons: ['🌆', '🚖', '🏨', '🚇', '🚥'] },
  ocean: { icons: ['🦈', '🐠'], opacity: 0.045, hdIcons: ['🐳', '🐙', '🐬', '🐢', '🦑'] },
  sunset: { icons: ['🌅', '🔆'], opacity: 0.05, hdIcons: ['🌇', '🌞', '🍹', '🥥', '🐚'] },
  sakura: { icons: ['🌸', '🌺'], opacity: 0.052, hdIcons: ['🌷', '🌹', '🌼', '💐', '🏵️'] },
  koi: { icons: ['🎏', '🐟'], opacity: 0.05, hdIcons: ['🐉', '🌊', '🦞', '🦀', '⛩️'] },
  candy: { icons: ['🍭', '🍬'], opacity: 0.052, hdIcons: ['🍦', '🧁', '🍫', '🍪', '🎂'] },
  bubbly: { icons: ['🔵', '🐡'], opacity: 0.052, hdIcons: ['🥤', '🎾', '🍹', '🔮', '💫'] },
  toon: { icons: ['🎪', '🎠'], opacity: 0.048, hdIcons: ['🤡', '🎈', '🎡', '🎭', '🤖'] },
  pixel8: { icons: ['👾', '🎮', '🍄'], opacity: 0.055, scale: 0.34, hdIcons: ['💰', '🏯', '⚔️', '🛡️', '🗡️'] },
  dawn: { icons: ['🌄', '🌻', '🍃'], opacity: 0.052, hdIcons: ['🐝', '🦋', '🌾', '🍯', '🌱'] },
  food: { icons: ['🍕', '🍔'], opacity: 0.048, hdIcons: ['🍣', '🍩', '🥐', '🌮', '🥗'] },
  music: { icons: ['🎹', '🎸'], opacity: 0.048, hdIcons: ['🎷', '🥁', '🎺', '🎻', '🎤'] },
  pets: { icons: ['🐶', '🐾'], opacity: 0.05, hdIcons: ['🐱', '🐰', '🐹', '🐤', '🦊'] },
  universe: { icons: ['🌑', '⭐'], opacity: 0.045, hdIcons: ['🚀', '🛸', '🌠', '☄️', '🌙'] },
  fantasy: { icons: ['🔮', '✨'], opacity: 0.048, hdIcons: ['🧙', '🌟', '🧝', '🧞', '🧿'] },
  beast: { icons: ['🦁', '🐯'], opacity: 0.048, hdIcons: ['🐆', '🐺', '🐘', '🦏', '🦒'] },
  greece: { icons: ['🏛️', '⚡'], opacity: 0.048, hdIcons: ['🦉', '🏺', '🗿', '🏹', '🐎'] },
  demon: { icons: ['😈', '💀'], opacity: 0.045, hdIcons: ['👻', '🦇', '🕷️', '🕸️', '👹'] },
  jurassic: { icons: ['🦕', '🦖'], opacity: 0.048, hdIcons: ['🦴', '🌋', '🥚', '🗻', '🦎'] },
  fairy: { icons: ['🧚', '🌸'], opacity: 0.05, hdIcons: ['🦌', '🐿️', '🪻', '🍂', '🌰'] },
  industrial: { icons: ['🏭', '⚙️'], opacity: 0.045, hdIcons: ['🔩', '🛠️', '⚒️', '🔧', '⛏️'] },
  forbidden: { icons: ['👑', '🐲'], opacity: 0.048, hdIcons: ['🎐', '🧧', '🏮', '🥢', '🍵'] },
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
  outdoor: { icons: ['🥾', '⛺'], opacity: 0.052, hdIcons: ['🏔️', '🧗', '🎒', '🧭', '⛵'] },
  vehicles: { icons: ['🏎️', '✈️'], opacity: 0.048, hdIcons: ['🚂', '🚁', '🚤', '🛵', '🚜'] },
  forest: { icons: ['🌳', '🍁'], opacity: 0.048, hdIcons: ['🌲', '🐻', '🐗', '🦔', '🍇'] },
  pirate: { icons: ['🦜', '☠️'], opacity: 0.048, hdIcons: ['⚓', '🗺️', '💰', '🛶', '🚣'] },
  farm: { icons: ['🐄', '🌽'], opacity: 0.04, hdIcons: ['🐔', '🥕', '🐑', '🐖', '🥬'] },
  desert: { icons: ['🐫', '🌵'], opacity: 0.04, hdIcons: ['🦂', '🌴', '🏜️', '🐍', '🌶️'] },
  summer: { icons: ['☀️', '🏝️'], opacity: 0.06, hdIcons: ['🍉', '🩴', '🏄', '🍧', '🪸'] },
  apple: { icons: ['🍎', '✨'], opacity: 0.04, hdIcons: ['⚪', '⬜', '🔘', '◻️', '🔲'] },
  cafe: { icons: ['☕', '📖'], opacity: 0.10, hdIcons: ['🥯', '🍮', '🥄', '🪑', '🧺'] },
  fiesta: { icons: ['🎉', '🎊'], opacity: 0.08, hdIcons: ['🎇', '🎫', '🎗️', '📯', '🎆'] },
  arcadeCabinet: { icons: ['📺', '📻'], opacity: 0.055, hdIcons: ['🖲️', '🔳', '📠', '🧮', '🔣'] },
  circuitBoard: { icons: ['🧲', '📶'], opacity: 0.048, hdIcons: ['⌁', '⎍', '⏚', '⟟', '⟠'] },
  toyBox: { icons: ['🧸', '🧩'], opacity: 0.078, hdIcons: ['🛼', '🥏', '🪇', '🪈', '🪗'] },
  mineralCave: { icons: ['💍', '🔦'], opacity: 0.052, hdIcons: ['◾', '◽', '▪️', '▫️', '⬛'] },
  alchemyLab: { icons: ['⚗️', '🧪'], opacity: 0.052, hdIcons: ['☣️', '☢️', '♨️', '⚕️', '☤'] },
  botanicalStudy: { icons: ['🥀', '🫛'], opacity: 0.10, hdIcons: ['🫐', '🥦', '🍅', '🍆', '🥒'] },
  spaceDock: { icons: ['🛰️', '🧑‍🚀'], opacity: 0.045, hdIcons: ['✦', '✧', '✹', '✺', '✷'] },
  dungeonLoot: { icons: ['🪤', '🕳️'], opacity: 0.05, hdIcons: ['⛓', '⌬', '⟡', '⟢', '✶'] },
  origamiPaper: { icons: ['✉️', '📄'], opacity: 0.11, hdIcons: ['▱', '△', '◇', '□', '▽'] },
  museumRelic: { icons: ['⚱️', '🔎'], opacity: 0.052, hdIcons: ['⌛', '⏳', '♜', '♞', '♝'] },
  winterCabin: { icons: ['🪵', '🧤'], opacity: 0.08, hdIcons: ['🪡', '🧶', '🥾', '🫎', '🫕'] },
  rainyWindow: { icons: ['🌧️', '☔'], opacity: 0.05, hdIcons: ['♒', '≋', '∿', '∽', '◌'] },
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

function getSkinCategories() {
  return SKIN_CATEGORIES.map((cat) => ({
    ...cat,
    skins: cat.skins.filter((id) => SKINS[id]).map((id) => ({ id, name: SKINS[id].name })),
  })).filter((cat) => cat.skins.length > 0);
}

module.exports = {
  STORAGE_KEY,
  DEFAULT_SKIN_ID,
  CLASSIC_PALETTE,
  SKINS,
  SKIN_LIST,
  SKIN_CATEGORIES,
  getActiveSkinId,
  getActiveSkin,
  getBlockColors,
  setActiveSkinId,
  getSkinListMeta,
  getSkinCategories,
};
