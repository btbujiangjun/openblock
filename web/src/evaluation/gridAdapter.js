/**
 * gridAdapter.js — 把一个 cells 二维数组包成 boardTopology 期望的 grid-like。
 *
 * 仅实现 analyzeBoardTopology / computeCoverableCells 真正调用到的方法：
 *   - 字段：size / cells
 *   - 方法：canPlace(shape, gx, gy)
 *   - 可选：isCellNearSpecial（评估上下文里不区分特殊格，恒返回 false）
 *
 * 这是评估模块**唯一**对 boardTopology 的耦合点；后续若新增几何指标，统一在这里扩。
 */

export function wrapCellsAsGrid(cells) {
    const size = cells.length;
    return {
        size,
        cells,
        canPlace(shape, gx, gy) {
            for (let y = 0; y < shape.length; y++) {
                for (let x = 0; x < shape[y].length; x++) {
                    if (!shape[y][x]) continue;
                    const tx = gx + x;
                    const ty = gy + y;
                    if (tx < 0 || tx >= size || ty < 0 || ty >= size) return false;
                    if (cells[ty][tx] !== null) return false;
                }
            }
            return true;
        },
        isCellNearSpecial() { return false; },
    };
}
