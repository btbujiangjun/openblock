/**
 * levelPack.js — 预生成关卡包（20 关）
 * 与 web/src/level/levelPack.js 对齐（CJS 版）。
 */
const _score = (target, maxR, stars) => ({ type: 'score', target, maxRounds: maxR, starThresholds: stars });
const _clear = (target, maxP, stars) => ({ type: 'clear', target, maxPlacements: maxP, starThresholds: stars });
const _surv = (minR, maxP, stars) => ({ type: 'survival', minRounds: minR, maxPlacements: maxP, starThresholds: stars });

function _leftFill(fillCols = 2) {
  return Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, (_, x) => (x < fillCols ? 0 : -1))
  );
}

function _randomFill30() {
  return Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => (Math.random() < 0.3 ? 0 : -1))
  );
}

function _bottomFill(rows = 3) {
  return Array.from({ length: 8 }, (_, y) =>
    Array.from({ length: 8 }, () => (y >= 8 - rows ? 0 : -1))
  );
}

const LEVEL_01 = { id: 'L01', title: '第 1 关 · 起步', difficulty: 'easy', objective: _score(300, 20, [100, 200, 300]), initialBoard: null, allowedShapes: null };
const LEVEL_02 = { id: 'L02', title: '第 2 关 · 第一消行', difficulty: 'easy', objective: _clear(3, 30, [1, 2, 3]), initialBoard: null };
const LEVEL_03 = { id: 'L03', title: '第 3 关 · 分数挑战', difficulty: 'easy', objective: _score(600, 25, [200, 400, 600]), initialBoard: null };
const LEVEL_04 = { id: 'L04', title: '第 4 关 · 连消入门', difficulty: 'easy', objective: _clear(5, 40, [2, 4, 5]), initialBoard: null };
const LEVEL_05 = { id: 'L05', title: '第 5 关 · 初级生存', difficulty: 'easy', objective: _surv(10, 50, [10, 12, 15]), initialBoard: null };

const LEVEL_06 = { id: 'L06', title: '第 6 关 · 清理左侧', difficulty: 'normal', objective: _score(800, 22, [300, 600, 800]), initialBoard: _leftFill(2) };
const LEVEL_07 = { id: 'L07', title: '第 7 关 · 消行加速', difficulty: 'normal', objective: _clear(8, 40, [4, 6, 8]), initialBoard: _leftFill(1) };
const LEVEL_08 = { id: 'L08', title: '第 8 关 · 中等分数', difficulty: 'normal', objective: _score(1200, 28, [500, 900, 1200]), initialBoard: null };
const LEVEL_09 = {
  id: 'L09',
  title: '第 9 关 · 双侧清理',
  difficulty: 'normal',
  objective: _clear(10, 50, [5, 8, 10]),
  initialBoard: (() => {
    const b = Array.from({ length: 8 }, () => Array(8).fill(-1));
    for (let y = 0; y < 8; y++) {
      b[y][0] = 0;
      b[y][7] = 0;
    }
    return b;
  })(),
};
const LEVEL_10 = { id: 'L10', title: '第 10 关 · 生存考验', difficulty: 'normal', objective: _surv(18, 60, [15, 17, 18]), initialBoard: _leftFill(2) };
const LEVEL_11 = { id: 'L11', title: '第 11 关 · 分数冲刺', difficulty: 'normal', objective: _score(1600, 30, [800, 1200, 1600]), initialBoard: null };
const LEVEL_12 = { id: 'L12', title: '第 12 关 · 综合挑战', difficulty: 'normal', objective: _clear(15, 55, [8, 12, 15]), initialBoard: _leftFill(3) };

const LEVEL_13 = { id: 'L13', title: '第 13 关 · 高压消行', difficulty: 'hard', objective: _clear(20, 60, [12, 16, 20]), initialBoard: _bottomFill(2) };
const LEVEL_14 = { id: 'L14', title: '第 14 关 · 密集突围', difficulty: 'hard', objective: _score(2000, 30, [1000, 1500, 2000]), initialBoard: _randomFill30() };
const LEVEL_15 = { id: 'L15', title: '第 15 关 · 生死存亡', difficulty: 'hard', objective: _surv(25, 65, [20, 23, 25]), initialBoard: _bottomFill(3) };
const LEVEL_16 = { id: 'L16', title: '第 16 关 · 极限得分', difficulty: 'hard', objective: _score(2800, 32, [1500, 2200, 2800]), initialBoard: null };
const LEVEL_17 = { id: 'L17', title: '第 17 关 · 马赛克初探', difficulty: 'hard', objective: _clear(25, 70, [15, 20, 25]), initialBoard: _randomFill30() };
const LEVEL_18 = { id: 'L18', title: '第 18 关 · 精准消除', difficulty: 'hard', objective: _score(3500, 35, [2000, 2800, 3500]), initialBoard: _bottomFill(2) };
const LEVEL_19 = { id: 'L19', title: '第 19 关 · 终极生存', difficulty: 'hard', objective: _surv(30, 70, [25, 28, 30]), initialBoard: _randomFill30() };
const LEVEL_20 = { id: 'L20', title: '第 20 关 · 大师挑战', difficulty: 'hard', objective: _score(5000, 40, [2500, 3800, 5000]), initialBoard: null };

const LEVEL_PACK = [
  LEVEL_01, LEVEL_02, LEVEL_03, LEVEL_04, LEVEL_05,
  LEVEL_06, LEVEL_07, LEVEL_08, LEVEL_09, LEVEL_10,
  LEVEL_11, LEVEL_12, LEVEL_13, LEVEL_14, LEVEL_15,
  LEVEL_16, LEVEL_17, LEVEL_18, LEVEL_19, LEVEL_20,
];

function getLevelById(id) {
  return LEVEL_PACK.find((l) => l.id === id) || null;
}

const LEVEL_PACK_BY_DIFFICULTY = {
  easy: LEVEL_PACK.filter((l) => l.difficulty === 'easy'),
  normal: LEVEL_PACK.filter((l) => l.difficulty === 'normal'),
  hard: LEVEL_PACK.filter((l) => l.difficulty === 'hard'),
};

module.exports = { LEVEL_PACK, getLevelById, LEVEL_PACK_BY_DIFFICULTY };

