/**
 * levelEditorPanel.js — 关卡编辑器（与回放并列的 screen 子功能）
 *
 * 使用与回放相同的 game.showScreen / showScreen('menu') 导航模式。
 * HTML 结构已静态写入 index.html（#level-editor-screen），
 * 本模块只负责：初始化网格、绑定事件、调用 PCGRL 生成、试玩启动。
 *
 * 入口：initLevelEditorPanel(game) — 在 DOMContentLoaded 后调用一次
 * 打开：openLevelEditorPanel()   — 由菜单按钮触发
 */

import { generateBoard, generateMosaicBoard } from './level/pcgrl.js';
import {
    MOSAIC_LEVEL_4ZONE,
    MOSAIC_LEVEL_STRIPS,
    MOSAIC_LEVEL_RING,
    createZoneOverlay,
    removeZoneOverlay,
} from './level/mosaicLevel.js';

// -----------------------------------------------------------------------
// 颜色映射（与游戏主题对应）
// -----------------------------------------------------------------------
const CELL_COLORS = ['#e8e8e8', '#ef5350', '#42a5f5', '#66bb6a', '#ffa726', '#ab47bc', '#26c6da'];

// -----------------------------------------------------------------------
// 模块状态
// -----------------------------------------------------------------------
let _game = null;
let _cells = [];
const _size = 8;
let _selectedColor = 1;
let _activeMosaicOverlay = null;

// -----------------------------------------------------------------------
// 工具函数
// -----------------------------------------------------------------------

function boardFromCells() {
    return _cells.map(row => row.map(c => (c === 0 ? null : c)));
}

function buildLevelConfig() {
    const name = document.getElementById('le-level-name')?.value || '我的关卡';
    const modeVal = document.getElementById('le-mode')?.value || 'endless';
    const objType = document.getElementById('le-obj-type')?.value || 'clear';
    const objValue = parseInt(document.getElementById('le-obj-value')?.value || '5', 10);
    const maxPlacements = parseInt(document.getElementById('le-max-placements')?.value || '0', 10) || undefined;
    const maxRoundsRaw = document.getElementById('le-max-rounds')?.value;
    const maxRounds = maxRoundsRaw ? parseInt(maxRoundsRaw, 10) : undefined;
    const star1 = parseInt(document.getElementById('le-star1')?.value || '0', 10);
    const star2 = parseInt(document.getElementById('le-star2')?.value || '0', 10);
    const star3 = parseInt(document.getElementById('le-star3')?.value || '0', 10);

    const initialBoard = boardFromCells();
    const hasInitBoard = initialBoard.some(row => row.some(c => c !== null));

    let mosaicBase = null;
    if (modeVal === 'mosaic_quadrant') mosaicBase = MOSAIC_LEVEL_4ZONE;
    else if (modeVal === 'mosaic_strips') mosaicBase = MOSAIC_LEVEL_STRIPS;
    else if (modeVal === 'mosaic_ring') mosaicBase = MOSAIC_LEVEL_RING;

    const config = {
        id: `custom_${Date.now()}`,
        name,
        mode: 'level',
        initialBoard: hasInitBoard ? initialBoard : null,
        objective: { type: objType, value: objValue },
        stars: { one: star1, two: star2, three: star3 },
        constraints: {
            ...(maxPlacements ? { maxPlacements } : {}),
            ...(maxRounds ? { maxRounds } : {}),
        },
    };

    if (mosaicBase) {
        config.zones = mosaicBase.zones;
        config.clearRules = mosaicBase.clearRules;
        config.description = mosaicBase.description;
    }

    return config;
}

// -----------------------------------------------------------------------
// 网格渲染
// -----------------------------------------------------------------------

function renderGrid() {
    const gridEl = document.getElementById('le-grid');
    if (!gridEl) return;
    gridEl.innerHTML = '';
    gridEl.style.gridTemplateColumns = `repeat(${_size}, 1fr)`;

    for (let y = 0; y < _size; y++) {
        for (let x = 0; x < _size; x++) {
            const cell = document.createElement('div');
            cell.className = 'le-cell';
            cell.dataset.x = x;
            cell.dataset.y = y;
            const colorIdx = _cells[y][x];
            cell.style.background = CELL_COLORS[colorIdx] || CELL_COLORS[0];
            if (colorIdx > 0) cell.classList.add('le-cell--filled');

            cell.addEventListener('mousedown', (e) => {
                e.preventDefault();
                if (e.button === 2) return;
                toggleCell(x, y);
            });
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showColorPicker(x, y, cell);
            });
            cell.addEventListener('mouseenter', (e) => {
                if (e.buttons === 1) toggleCell(x, y, _selectedColor);
            });

            gridEl.appendChild(cell);
        }
    }
}

function toggleCell(x, y, forceColor) {
    _cells[y][x] = forceColor !== undefined ? forceColor : (_cells[y][x] === 0 ? _selectedColor : 0);
    const cell = document.querySelector(`#le-grid .le-cell[data-x="${x}"][data-y="${y}"]`);
    if (cell) {
        const colorIdx = _cells[y][x];
        cell.style.background = CELL_COLORS[colorIdx] || CELL_COLORS[0];
        cell.classList.toggle('le-cell--filled', colorIdx > 0);
    }
}

function showColorPicker(x, y, cellEl) {
    document.querySelector('.le-color-picker')?.remove();
    const picker = document.createElement('div');
    picker.className = 'le-color-picker';
    const rect = cellEl.getBoundingClientRect();
    picker.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${rect.left}px;z-index:9999;display:flex;gap:4px;background:#1e1e2e;padding:6px;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.4);`;

    CELL_COLORS.forEach((color, idx) => {
        const btn = document.createElement('button');
        btn.style.cssText = `width:22px;height:22px;border-radius:4px;border:2px solid ${idx === _selectedColor ? '#fff' : 'transparent'};background:${color};cursor:pointer;`;
        btn.title = idx === 0 ? '清空' : `颜色 ${idx}`;
        btn.addEventListener('click', () => {
            _selectedColor = idx;
            toggleCell(x, y, idx);
            picker.remove();
        });
        picker.appendChild(btn);
    });

    document.body.appendChild(picker);
    setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 0);
}

// -----------------------------------------------------------------------
// PCGRL 生成
// -----------------------------------------------------------------------

function doGenerate() {
    const fillRatio = parseInt(document.getElementById('le-fill-ratio')?.value || '25', 10) / 100;
    const modeVal = document.getElementById('le-mode')?.value || 'endless';

    let board;
    if (modeVal === 'mosaic_quadrant') {
        board = generateMosaicBoard(MOSAIC_LEVEL_4ZONE.zones, { size: _size, zoneFillRatio: fillRatio });
    } else if (modeVal === 'mosaic_strips') {
        board = generateMosaicBoard(MOSAIC_LEVEL_STRIPS.zones, { size: _size, zoneFillRatio: fillRatio });
    } else if (modeVal === 'mosaic_ring') {
        board = generateMosaicBoard(MOSAIC_LEVEL_RING.zones, { size: _size, zoneFillRatio: fillRatio });
    } else {
        board = generateBoard({ size: _size, fillRatio });
    }

    _cells = board.map(row => row.map(c => (c === null ? 0 : c)));
    renderGrid();
}

// -----------------------------------------------------------------------
// 初始化
// -----------------------------------------------------------------------

function initCells() {
    _cells = Array.from({ length: _size }, () => Array(_size).fill(0));
}

export function initLevelEditorPanel(game) {
    _game = game;
    initCells();
    injectStyles();
    bindEvents();
}

function bindEvents() {
    // 返回菜单
    document.getElementById('le-back-btn')?.addEventListener('click', () => {
        document.querySelector('.le-color-picker')?.remove();
        _game?.showScreen('menu');
    });

    // 填充率滑块
    document.getElementById('le-fill-ratio')?.addEventListener('input', (e) => {
        const el = document.getElementById('le-fill-ratio-val');
        if (el) el.textContent = `${e.target.value}%`;
    });

    // PCGRL 生成
    document.getElementById('le-gen-btn')?.addEventListener('click', doGenerate);

    // 清空
    document.getElementById('le-clear-btn')?.addEventListener('click', () => {
        initCells();
        renderGrid();
    });

    // 导出 JSON
    document.getElementById('le-export-btn')?.addEventListener('click', () => {
        const config = buildLevelConfig();
        const exportable = { ...config };
        delete exportable.clearRules;
        const jsonOut = document.getElementById('le-json-out');
        if (jsonOut) {
            jsonOut.hidden = false;
            jsonOut.value = JSON.stringify(exportable, null, 2);
        }
    });

    // 开始试玩
    document.getElementById('le-play-btn')?.addEventListener('click', async () => {
        if (!_game) return;
        const config = buildLevelConfig();

        if (_activeMosaicOverlay) {
            removeZoneOverlay(_activeMosaicOverlay);
            _activeMosaicOverlay = null;
        }

        await _game.start({ levelConfig: config });

        if (config.zones) {
            _activeMosaicOverlay = createZoneOverlay(_game, config.zones);
        }
    });
}

export function openLevelEditorPanel() {
    renderGrid();
    _game?.showScreen('level-editor-screen');
}

// -----------------------------------------------------------------------
// 样式注入
// -----------------------------------------------------------------------
function injectStyles() {
    if (document.getElementById('le-styles')) return;
    const style = document.createElement('style');
    style.id = 'le-styles';
    style.textContent = `
.level-editor-screen {
    display: flex !important;
    flex-direction: column;
    background: #181825;
    padding: 0;
    overflow: hidden;
}
.level-editor-screen:not(.active) {
    display: none !important;
}
.le-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 20px; border-bottom: 1px solid rgba(255,255,255,.08);
    flex-shrink: 0;
}
.le-title { margin: 0; font-size: 1.1rem; color: #cdd6f4; font-weight: 700; }
.le-back-btn { flex-shrink: 0; }
.le-body {
    display: flex; gap: 0; overflow: auto; flex: 1; min-height: 0;
}
.le-section {
    padding: 14px 18px; flex: 1; overflow: auto;
}
.le-grid-section {
    border-right: 1px solid rgba(255,255,255,.07);
    min-width: 240px; max-width: 360px; display: flex; flex-direction: column;
}
.le-config-section { min-width: 260px; }
.le-section-title {
    font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
    color: #7f849c; margin-bottom: 8px; font-weight: 600;
}
.le-grid-toolbar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin-bottom: 8px;
}
.le-grid {
    display: grid; gap: 2px;
    width: 100%; aspect-ratio: 1;
    margin-bottom: 6px; flex-shrink: 0;
}
.le-cell {
    border-radius: 3px; cursor: pointer;
    transition: transform .08s, filter .08s;
    border: 1px solid rgba(0,0,0,.18);
    min-width: 0; min-height: 0; aspect-ratio: 1;
}
.le-cell:hover { transform: scale(1.08); filter: brightness(1.2); }
.le-cell--filled { box-shadow: inset 0 1px 0 rgba(255,255,255,.25); }
.le-grid-hint { font-size: .68rem; color: #585b70; }
.le-field, .le-field-group { margin-bottom: 10px; }
.le-row {
    display: flex; align-items: center; gap: 8px; margin-bottom: 6px;
}
.le-label {
    font-size: .8rem; color: #bac2de; white-space: nowrap;
    display: flex; align-items: center; gap: 6px;
}
.le-input {
    background: #313244; border: 1px solid #45475a; border-radius: 6px;
    color: #cdd6f4; padding: 5px 8px; font-size: .85rem; flex: 1; min-width: 0;
}
.le-input-sm { width: 72px; flex: none; }
.le-select {
    background: #313244; border: 1px solid #45475a; border-radius: 6px;
    color: #cdd6f4; padding: 5px 8px; font-size: .85rem; flex: 1;
}
.le-range { flex: 1; accent-color: #89b4fa; }
.le-unit { font-size: .75rem; color: #585b70; }
.le-actions { display: flex; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
.le-btn {
    padding: 8px 14px; border-radius: 8px; border: none;
    cursor: pointer; font-size: .85rem; font-weight: 600;
    transition: opacity .15s, transform .1s;
}
.le-btn:hover { opacity: .85; transform: translateY(-1px); }
.le-btn-primary { background: #89b4fa; color: #1e1e2e; }
.le-btn-secondary { background: #45475a; color: #cdd6f4; }
.le-btn-ghost {
    background: transparent; border: 1px solid #45475a;
    color: #bac2de; padding: 4px 10px; font-size: .78rem;
}
.le-json-out {
    margin-top: 10px; width: 100%; box-sizing: border-box;
    background: #181825; border: 1px solid #313244; border-radius: 8px;
    color: #a6e3a1; font-size: .72rem; font-family: monospace;
    padding: 8px; resize: vertical;
}
@media (max-width: 600px) {
    .le-body { flex-direction: column; }
    .le-grid-section { border-right: none; border-bottom: 1px solid rgba(255,255,255,.07); max-width: none; }
}
`;
    document.head.appendChild(style);
}
