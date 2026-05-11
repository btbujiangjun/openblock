const fs = require('fs');
const vm = require('vm');

const srcPath = '/Users/admin/Documents/work/opensource/openblock/web/src/skins.js';
const dstPath = '/Users/admin/Documents/work/opensource/openblock/miniprogram/core/skins.js';
const src = fs.readFileSync(srcPath, 'utf8');

const defaultSkinMatch = src.match(/export const DEFAULT_SKIN_ID = '([^']+)'/);
const defaultSkinId = defaultSkinMatch ? defaultSkinMatch[1] : 'titanium';

const marker = 'export const SKINS = {';
const start = src.indexOf(marker);
if (start < 0) {
  throw new Error('SKINS marker not found');
}

let i = start + marker.length - 1;
let depth = 0;
let inSingle = false;
let inDouble = false;
let inTemplate = false;
let escaped = false;
let end = -1;

for (; i < src.length; i++) {
  const ch = src[i];
  if (escaped) {
    escaped = false;
    continue;
  }
  if (ch === '\\') {
    escaped = true;
    continue;
  }
  if (inSingle) {
    if (ch === "'") inSingle = false;
    continue;
  }
  if (inDouble) {
    if (ch === '"') inDouble = false;
    continue;
  }
  if (inTemplate) {
    if (ch === '`') inTemplate = false;
    continue;
  }
  if (ch === "'") {
    inSingle = true;
    continue;
  }
  if (ch === '"') {
    inDouble = true;
    continue;
  }
  if (ch === '`') {
    inTemplate = true;
    continue;
  }
  if (ch === '{') depth++;
  if (ch === '}') {
    depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
}

if (end < 0) {
  throw new Error('SKINS block end not found');
}

const objectLiteral = src.slice(start + marker.length - 1, end + 1);
const webSkins = vm.runInNewContext(`(${objectLiteral})`);

const keep = {};
for (const [key, skin] of Object.entries(webSkins)) {
  keep[key] = {
    id: skin.id,
    name: skin.name,
    blockColors: skin.blockColors,
    blockIcons: skin.blockIcons,
    gridOuter: skin.gridOuter,
    gridCell: skin.gridCell,
    gridGap: skin.gridGap,
    blockInset: skin.blockInset,
    blockRadius: skin.blockRadius,
    blockStyle: skin.blockStyle,
    cellStyle: skin.cellStyle,
    clearFlash: skin.clearFlash,
  };
}

const classicPalette = (keep.classic && keep.classic.blockColors) || [];
const mobileOptimizer = `
function _hexToRgb(hex) {
  const m = /^#?([a-f\\d]{2})([a-f\\d]{2})([a-f\\d]{2})$/i.exec(hex || '');
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : null;
}

function _rgbToHex(c) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return \`#\${h(c.r)}\${h(c.g)}\${h(c.b)}\`;
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
  classic: { icons: ['🎮', '⭐'], opacity: 0.045 },
  titanium: { icons: ['💠', '🔷'], opacity: 0.045 },
  aurora: { icons: ['🐧', '❄️', '🌌'], opacity: 0.05 },
  neonCity: { icons: ['🌃', '🏙️'], opacity: 0.045 },
  ocean: { icons: ['🦈', '🐠'], opacity: 0.045 },
  sunset: { icons: ['🌅', '🔆'], opacity: 0.05 },
  sakura: { icons: ['🌸', '🌺'], opacity: 0.052 },
  koi: { icons: ['🎏', '🐟'], opacity: 0.05 },
  candy: { icons: ['🍭', '🍬'], opacity: 0.052 },
  bubbly: { icons: ['🫧', '🐡'], opacity: 0.052 },
  toon: { icons: ['🎪', '🎠'], opacity: 0.048 },
  pixel8: { icons: ['👾', '🎮', '🍄'], opacity: 0.055, scale: 0.34 },
  dawn: { icons: ['🌄', '🌻', '🍃'], opacity: 0.052 },
  food: { icons: ['🍕', '🍔'], opacity: 0.048 },
  music: { icons: ['🎹', '🎸'], opacity: 0.048 },
  pets: { icons: ['🐶', '🐾'], opacity: 0.05 },
  universe: { icons: ['🪐', '⭐'], opacity: 0.045 },
  fantasy: { icons: ['🔮', '✨'], opacity: 0.048 },
  beast: { icons: ['🦁', '🐯'], opacity: 0.048 },
  greece: { icons: ['🏛️', '⚡'], opacity: 0.048 },
  demon: { icons: ['😈', '💀'], opacity: 0.045 },
  jurassic: { icons: ['🦕', '🦖'], opacity: 0.048 },
  fairy: { icons: ['🧚', '🌸'], opacity: 0.05 },
  industrial: { icons: ['🏭', '⚙️'], opacity: 0.045 },
  forbidden: { icons: ['👑', '🐲'], opacity: 0.048 },
  mahjong: { icons: ['🀅', '🀀'], opacity: 0.06 },
  boardgame: { icons: ['🃏', '♠️'], opacity: 0.04 },
  sports: { icons: ['⚽', '🏆'], opacity: 0.048 },
  outdoor: { icons: ['🥾', '⛺'], opacity: 0.052 },
  vehicles: { icons: ['🏎️', '✈️'], opacity: 0.048 },
  forest: { icons: ['🌳', '🍁'], opacity: 0.048 },
  pirate: { icons: ['🦜', '🏴‍☠️'], opacity: 0.048 },
  farm: { icons: ['🐄', '🌽'], opacity: 0.04 },
  desert: { icons: ['🐫', '🌵'], opacity: 0.04 },
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
`;
const out = `/**
 * 小程序皮肤配置（自动同步自 web/src/skins.js 的核心渲染字段）。
 */
const storage = require('../adapters/storage');

const STORAGE_KEY = 'openblock_skin';
const DEFAULT_SKIN_ID = ${JSON.stringify(defaultSkinId)};

const CLASSIC_PALETTE = ${JSON.stringify(classicPalette, null, 2)};

const SKINS = ${JSON.stringify(keep, null, 2)};

${mobileOptimizer}

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
`;

fs.writeFileSync(dstPath, out);
console.log(`Synced ${Object.keys(keep).length} skins to ${dstPath}`);
