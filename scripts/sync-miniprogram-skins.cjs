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
const out = `/**
 * 小程序皮肤配置（自动同步自 web/src/skins.js 的核心渲染字段）。
 */
const storage = require('../adapters/storage');

const STORAGE_KEY = 'openblock_skin';
const DEFAULT_SKIN_ID = ${JSON.stringify(defaultSkinId)};

const CLASSIC_PALETTE = ${JSON.stringify(classicPalette, null, 2)};

const SKINS = ${JSON.stringify(keep, null, 2)};

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
