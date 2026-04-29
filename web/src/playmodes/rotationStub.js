/**
 * rotationStub.js — v10.16 旋转方块玩法分支（P2 骨架）
 *
 * 大工程占位：在落子前可旋转候选方块（致敬俄罗斯方块）。
 *
 * 当前实施
 * --------
 * - 仅提供模式开关 API + 对 dock 块旋转的算法占位
 * - 实际旋转需要修改 game.js 的 dragBlock 流程（拖拽时按 R 键 / 双指扭转）
 * - 因影响核心玩法节奏（消行规则 / hintEngine 评分 / spawnModel 重训），列为 P2
 *
 * 待实施 TODO
 * -----------
 * 1. game.js 的 onMove 中监听 keydown('r') / 双指 gesture
 * 2. 实现 rotateShape90(shape) 工具
 * 3. 测试旋转后的合法性（canPlace 重检）
 * 4. UI：在 dock 块上加旋转按钮（移动端友好）
 * 5. hintEngine 评分增加旋转维度（候选 4 个朝向）
 */

export function rotateShape90(shape) {
    if (!shape || !shape.length) return shape;
    const h = shape.length;
    const w = shape[0].length;
    const out = [];
    for (let r = 0; r < w; r++) {
        const row = [];
        for (let c = 0; c < h; c++) {
            row.push(shape[h - 1 - c][r]);
        }
        out.push(row);
    }
    return out;
}

const STORAGE_KEY = 'openblock_rotation_mode_v1';

export function isRotationModeEnabled() {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; }
    catch { return false; }
}

export function setRotationModeEnabled(b) {
    try { localStorage.setItem(STORAGE_KEY, b ? '1' : '0'); }
    catch { /* ignore */ }
}

export function initRotationStub() {
    if (typeof window !== 'undefined') {
        window.__rotationMode = {
            isEnabled: isRotationModeEnabled,
            setEnabled: setRotationModeEnabled,
            rotate: rotateShape90,
            isImplemented: () => false,
        };
    }
    console.info('[rotationStub] initialized — game.js integration pending.');
}
