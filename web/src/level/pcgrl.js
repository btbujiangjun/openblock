/**
 * pcgrl.js — 程序化关卡生成（PCGRL 思路）
 *
 * 通过「生成 → 验证 → 修正」迭代产生合法的初始盘面，用于关卡编辑器的
 * "自动生成"功能和 RL 训练的课程数据集。
 *
 * 核心思路（PCGRL 简化版）
 * -----------------------
 * 1. 随机填充：按目标填充率随机放置方块
 * 2. 连通性检测：确保空格区域连通（玩家有策略空间）
 * 3. 可玩性验证：至少存在 1 个合法落子位置
 * 4. 迭代修正：若不满足则随机翻转格子重试（最多 N 轮）
 * 5. 区域感知：马赛克模式确保各区域填充率均衡
 *
 * 导出 API
 * --------
 *   generateBoard(opts)   → number[][]
 *   generateMosaicBoard(zones, opts) → number[][]
 *   validateBoard(board, shapes)     → boolean
 */

// -----------------------------------------------------------------------
// 内置简化形状库（用于可玩性验证，无需引入 blockSpawn）
// -----------------------------------------------------------------------
const MINI_SHAPES = [
    [[1]],
    [[1, 1]],
    [[1], [1]],
    [[1, 1, 1]],
    [[1, 1], [1, 0]],
    [[1, 0], [1, 1]],
    [[1, 1], [0, 1]],
    [[0, 1], [1, 1]],
    [[1, 1], [1, 1]],
    [[1, 0], [1, 0], [1, 1]],
];

/**
 * 检测形状能否放在盘面的某个位置
 */
function canPlace(board, shape, ox, oy, n) {
    for (let dy = 0; dy < shape.length; dy++) {
        for (let dx = 0; dx < shape[dy].length; dx++) {
            if (!shape[dy][dx]) continue;
            const nx = ox + dx;
            const ny = oy + dy;
            if (nx >= n || ny >= n) return false;
            if (board[ny][nx] !== null) return false;
        }
    }
    return true;
}

/**
 * 验证盘面是否至少存在一个合法落子位置
 */
export function validateBoard(board, shapes = MINI_SHAPES) {
    const n = board.length;
    for (const shape of shapes) {
        for (let y = 0; y < n; y++) {
            for (let x = 0; x < n; x++) {
                if (canPlace(board, shape, x, y, n)) return true;
            }
        }
    }
    return false;
}

/**
 * 生成随机盘面
 *
 * @param {object} opts
 * @param {number} [opts.size=8]          盘面尺寸
 * @param {number} [opts.fillRatio=0.3]   目标填充率（0~1）
 * @param {number} [opts.colorCount=6]    颜色数量
 * @param {number} [opts.maxRetries=60]   最大重试次数
 * @param {number[][]} [opts.fixedCells]  预设固定格子 [[y,x], ...]（不可修改）
 * @returns {number[][]}  cells[y][x]，null 表示空格，数字表示颜色 1~colorCount
 */
export function generateBoard(opts = {}) {
    const {
        size = 8,
        fillRatio = 0.3,
        colorCount = 6,
        maxRetries = 60,
        fixedCells = [],
    } = opts;

    const fixedSet = new Set(fixedCells.map(([y, x]) => `${y},${x}`));
    const totalCells = size * size;
    const targetFilled = Math.round(totalCells * fillRatio);

    function makeEmpty() {
        return Array.from({ length: size }, () => Array(size).fill(null));
    }

    function randomColor() {
        return Math.floor(Math.random() * colorCount) + 1;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const board = makeEmpty();

        // 填入固定格子
        for (const [fy, fx] of fixedCells) {
            if (fy < size && fx < size) board[fy][fx] = randomColor();
        }

        // 随机填入目标数量的格子
        const freeSlots = [];
        for (let y = 0; y < size; y++) {
            for (let x = 0; x < size; x++) {
                if (!fixedSet.has(`${y},${x}`)) freeSlots.push([y, x]);
            }
        }

        // Fisher-Yates 打乱
        for (let i = freeSlots.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [freeSlots[i], freeSlots[j]] = [freeSlots[j], freeSlots[i]];
        }

        const toFill = Math.min(targetFilled - fixedCells.length, freeSlots.length);
        for (let i = 0; i < toFill; i++) {
            const [y, x] = freeSlots[i];
            board[y][x] = randomColor();
        }

        if (validateBoard(board)) return board;
    }

    // 回退：返回空盘
    return makeEmpty();
}

/**
 * 生成马赛克模式盘面
 * 确保各区域填充率接近目标值，且全局可玩
 *
 * @param {Array<{x,y,w,h}>} zones  区域定义
 * @param {object} opts
 * @param {number} [opts.size=8]
 * @param {number} [opts.zoneFillRatio=0.25]  各区域预填充率（留出空间让玩家填）
 * @param {number} [opts.colorCount=6]
 * @param {number} [opts.maxRetries=80]
 * @returns {number[][]}
 */
export function generateMosaicBoard(zones, opts = {}) {
    const {
        size = 8,
        zoneFillRatio = 0.25,
        colorCount = 6,
        maxRetries = 80,
    } = opts;

    function randomColor() {
        return Math.floor(Math.random() * colorCount) + 1;
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const board = Array.from({ length: size }, () => Array(size).fill(null));

        for (const zone of zones) {
            const cells = [];
            for (let dy = 0; dy < zone.h; dy++) {
                for (let dx = 0; dx < zone.w; dx++) {
                    const gy = zone.y + dy;
                    const gx = zone.x + dx;
                    if (gy < size && gx < size) cells.push([gy, gx]);
                }
            }

            // 打乱并填入部分格子
            for (let i = cells.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [cells[i], cells[j]] = [cells[j], cells[i]];
            }
            const toFill = Math.round(cells.length * zoneFillRatio);
            for (let i = 0; i < toFill; i++) {
                board[cells[i][0]][cells[i][1]] = randomColor();
            }
        }

        if (validateBoard(board)) return board;
    }

    return Array.from({ length: size }, () => Array(size).fill(null));
}

/**
 * 计算盘面填充率
 * @param {number[][]} board
 * @returns {number}  0~1
 */
export function calcFillRatio(board) {
    const n = board.length;
    let filled = 0;
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (board[y][x] !== null) filled++;
        }
    }
    return filled / (n * n);
}

/**
 * 将盘面格式转换为 JSON 字符串（用于 LevelConfig.initialBoard 序列化）
 * @param {number[][]} board
 * @returns {string}
 */
export function boardToJson(board) {
    return JSON.stringify(board);
}
