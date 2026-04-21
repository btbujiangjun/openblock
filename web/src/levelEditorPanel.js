/**
 * levelEditorPanel.js — 关卡编辑器 UI 面板
 *
 * 功能
 * ----
 * - 8×8 可点击网格（切换格子填充/空白）
 * - 目标类型（score / clear / survival / board）和数值配置
 * - 关卡限制（最大步数、最大轮数）
 * - 星级门槛（三档）
 * - 关卡模式选择（endless / 马赛克四象限 / 竖条 / 环形）
 * - "PCGRL 随机生成"按钮：程序化填充初始盘面
 * - "导出 JSON"按钮：显示可复制的 LevelConfig
 * - "开始试玩"按钮：直接加载配置并启动游戏
 *
 * 使用方式
 * --------
 *   import { initLevelEditorPanel } from './levelEditorPanel.js';
 *   initLevelEditorPanel(game);  // 在 DOMContentLoaded 后调用
 *
 * DOM 依赖
 * --------
 *   <button id="level-editor-btn"> … </button>   （触发按钮，任意位置）
 *   面板元素由本模块动态创建注入 document.body。
 */

import { generateBoard, generateMosaicBoard, calcFillRatio } from './level/pcgrl.js';
import {
    MOSAIC_LEVEL_4ZONE,
    MOSAIC_LEVEL_STRIPS,
    MOSAIC_LEVEL_RING,
    createZoneOverlay,
    removeZoneOverlay,
} from './level/mosaicLevel.js';

// -----------------------------------------------------------------------
// 面板 HTML 模板
// -----------------------------------------------------------------------
const PANEL_ID = 'level-editor-panel';

function buildPanelHTML() {
    return `
<div id="${PANEL_ID}" class="level-editor-overlay" hidden aria-modal="true" role="dialog" aria-label="关卡编辑器">
  <div class="level-editor-card">
    <div class="le-header">
      <h2 class="le-title">🗺 关卡编辑器</h2>
      <button class="le-close" id="le-close-btn" aria-label="关闭">✕</button>
    </div>

    <div class="le-body">
      <!-- 左栏：网格编辑 -->
      <section class="le-section le-grid-section">
        <div class="le-section-title">初始盘面</div>
        <div class="le-grid-toolbar">
          <label class="le-label">填充率
            <input type="range" id="le-fill-ratio" min="0" max="70" value="25" step="5" class="le-range">
            <span id="le-fill-ratio-val">25%</span>
          </label>
          <button class="le-btn le-btn-ghost" id="le-gen-btn">⚡ PCGRL 生成</button>
          <button class="le-btn le-btn-ghost" id="le-clear-btn">🗑 清空</button>
        </div>
        <div id="le-grid" class="le-grid" data-size="8" role="grid" aria-label="关卡盘面编辑器"></div>
        <div class="le-grid-hint">点击格子切换填充 / 右键选择颜色</div>
      </section>

      <!-- 右栏：关卡配置 -->
      <section class="le-section le-config-section">
        <div class="le-section-title">关卡配置</div>

        <div class="le-field">
          <label class="le-label" for="le-level-name">关卡名称</label>
          <input type="text" id="le-level-name" class="le-input" value="我的关卡" maxlength="20">
        </div>

        <div class="le-field">
          <label class="le-label" for="le-mode">玩法模式</label>
          <select id="le-mode" class="le-select">
            <option value="endless">无尽模式（行列消除）</option>
            <option value="mosaic_quadrant">马赛克 · 四象限</option>
            <option value="mosaic_strips">马赛克 · 竖条</option>
            <option value="mosaic_ring">马赛克 · 环形</option>
          </select>
        </div>

        <div class="le-field-group">
          <div class="le-section-title" style="margin-top:8px;">胜利目标</div>
          <div class="le-row">
            <label class="le-label" for="le-obj-type">类型</label>
            <select id="le-obj-type" class="le-select">
              <option value="score">达到分数</option>
              <option value="clear" selected>消除行数</option>
              <option value="survival">存活轮数</option>
            </select>
          </div>
          <div class="le-row">
            <label class="le-label" for="le-obj-value">目标值</label>
            <input type="number" id="le-obj-value" class="le-input le-input-sm" value="5" min="1" max="999">
          </div>
        </div>

        <div class="le-field-group">
          <div class="le-section-title" style="margin-top:8px;">限制条件</div>
          <div class="le-row">
            <label class="le-label" for="le-max-placements">最大步数</label>
            <input type="number" id="le-max-placements" class="le-input le-input-sm" value="30" min="5" max="999">
            <span class="le-unit">步</span>
          </div>
          <div class="le-row">
            <label class="le-label" for="le-max-rounds">最大轮数</label>
            <input type="number" id="le-max-rounds" class="le-input le-input-sm" value="" placeholder="不限" min="1" max="999">
            <span class="le-unit">轮</span>
          </div>
        </div>

        <div class="le-field-group">
          <div class="le-section-title" style="margin-top:8px;">星级门槛（按目标值）</div>
          <div class="le-row">
            <label class="le-label">⭐ 1星</label>
            <input type="number" id="le-star1" class="le-input le-input-sm" value="5" min="1">
          </div>
          <div class="le-row">
            <label class="le-label">⭐⭐ 2星</label>
            <input type="number" id="le-star2" class="le-input le-input-sm" value="8" min="1">
          </div>
          <div class="le-row">
            <label class="le-label">⭐⭐⭐ 3星</label>
            <input type="number" id="le-star3" class="le-input le-input-sm" value="12" min="1">
          </div>
        </div>

        <!-- 操作按钮 -->
        <div class="le-actions">
          <button class="le-btn le-btn-primary" id="le-play-btn">▶ 开始试玩</button>
          <button class="le-btn le-btn-secondary" id="le-export-btn">📋 导出 JSON</button>
        </div>

        <!-- JSON 导出区 -->
        <textarea id="le-json-out" class="le-json-out" rows="6" readonly placeholder="点击「导出 JSON」查看配置…" hidden></textarea>
      </section>
    </div>
  </div>
</div>
`;
}

// -----------------------------------------------------------------------
// 颜色映射（与游戏主题对应）
// -----------------------------------------------------------------------
const CELL_COLORS = ['#e8e8e8', '#ef5350', '#42a5f5', '#66bb6a', '#ffa726', '#ab47bc', '#26c6da'];
// index 0 = empty，1~6 = 各颜色

// -----------------------------------------------------------------------
// 核心状态
// -----------------------------------------------------------------------
let _game = null;
let _cells = [];       // [y][x] = colorIdx (0=empty)
let _size = 8;
let _activeMosaicOverlay = null;
let _selectedColor = 1;  // 当前绘制颜色

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

    // 马赛克模式附加 clearRules
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
                if (e.button === 2) return;  // 右键由 contextmenu 处理
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
    if (forceColor !== undefined) {
        _cells[y][x] = forceColor;
    } else {
        _cells[y][x] = _cells[y][x] === 0 ? _selectedColor : 0;
    }
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
    const close = () => picker.remove();
    setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
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

    // 随机着色（board 中非 null 的格子已有颜色 1~6）
    _cells = board.map(row => row.map(c => (c === null ? 0 : c)));
    renderGrid();
}

// -----------------------------------------------------------------------
// 面板初始化 & 事件绑定
// -----------------------------------------------------------------------

function initCells() {
    _cells = Array.from({ length: _size }, () => Array(_size).fill(0));
}

export function initLevelEditorPanel(game) {
    _game = game;

    // 注入 HTML
    if (!document.getElementById(PANEL_ID)) {
        document.body.insertAdjacentHTML('beforeend', buildPanelHTML());
        injectStyles();
    }

    initCells();
    renderGrid();
    bindEvents();
}

function bindEvents() {
    // 关闭按钮
    document.getElementById('le-close-btn')?.addEventListener('click', closePanel);

    // 点击遮罩关闭
    document.getElementById(PANEL_ID)?.addEventListener('click', (e) => {
        if (e.target.id === PANEL_ID) closePanel();
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
        // 序列化时排除 clearRules（函数不可序列化）
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
        closePanel();

        // 清理旧叠加层
        if (_activeMosaicOverlay) {
            removeZoneOverlay(_activeMosaicOverlay);
            _activeMosaicOverlay = null;
        }

        await _game.start({ levelConfig: config });

        // 马赛克模式添加区域叠加层
        if (config.zones) {
            _activeMosaicOverlay = createZoneOverlay(_game, config.zones);
        }
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !document.getElementById(PANEL_ID)?.hidden) {
            closePanel();
        }
    });
}

export function openLevelEditorPanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) {
        panel.hidden = false;
        renderGrid();
    }
}

function closePanel() {
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.hidden = true;
    document.querySelector('.le-color-picker')?.remove();
}

// -----------------------------------------------------------------------
// 内联样式注入（避免额外 CSS 文件）
// -----------------------------------------------------------------------
function injectStyles() {
    if (document.getElementById('le-styles')) return;
    const style = document.createElement('style');
    style.id = 'le-styles';
    style.textContent = `
.level-editor-overlay {
    position: fixed; inset: 0; z-index: 1100;
    background: rgba(0,0,0,.65); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    padding: 16px; box-sizing: border-box;
}
.level-editor-card {
    background: #1e1e2e; border-radius: 16px;
    width: 100%; max-width: 860px; max-height: 90vh;
    display: flex; flex-direction: column;
    box-shadow: 0 20px 60px rgba(0,0,0,.6);
    overflow: hidden;
}
.le-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px; border-bottom: 1px solid rgba(255,255,255,.08);
}
.le-title { margin: 0; font-size: 1.1rem; color: #cdd6f4; font-weight: 700; }
.le-close {
    background: none; border: none; color: #6c7086; cursor: pointer;
    font-size: 1.2rem; line-height: 1; padding: 4px 8px; border-radius: 6px;
    transition: color .15s;
}
.le-close:hover { color: #cdd6f4; }
.le-body {
    display: flex; gap: 0; overflow: auto; flex: 1;
}
.le-section {
    padding: 16px 20px; flex: 1; overflow: auto;
}
.le-grid-section {
    border-right: 1px solid rgba(255,255,255,.07);
    min-width: 280px; max-width: 380px;
}
.le-config-section { min-width: 280px; }
.le-section-title {
    font-size: .75rem; text-transform: uppercase; letter-spacing: .08em;
    color: #7f849c; margin-bottom: 10px; font-weight: 600;
}
.le-grid-toolbar {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    margin-bottom: 10px;
}
.le-grid {
    display: grid; gap: 2px;
    width: 100%; aspect-ratio: 1;
    margin-bottom: 8px;
}
.le-cell {
    border-radius: 3px; cursor: pointer;
    transition: transform .08s, filter .08s;
    border: 1px solid rgba(0,0,0,.18);
    min-width: 0; min-height: 0;
    aspect-ratio: 1;
}
.le-cell:hover { transform: scale(1.08); filter: brightness(1.2); }
.le-cell--filled { box-shadow: inset 0 1px 0 rgba(255,255,255,.25); }
.le-grid-hint { font-size: .7rem; color: #585b70; }
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
    color: #cdd6f4; padding: 5px 8px; font-size: .85rem;
    flex: 1; min-width: 0;
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
