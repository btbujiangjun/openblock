/**
 * 关卡模式管理（从 web/levelManager.js 精简迁移到小程序）。
 */
class LevelManager {
  constructor(config) {
    this.config = config || {};
    this._totalClears = 0;
    this._totalRounds = 0;
    this._totalPlacements = 0;
  }

  applyInitialBoard(grid) {
    const board = this.config.initialBoard;
    if (!board) return;
    for (let y = 0; y < grid.size; y++) {
      for (let x = 0; x < grid.size; x++) {
        const val = board[y]?.[x];
        grid.cells[y][x] = (val !== undefined && val !== null && val >= 0) ? val : null;
      }
    }
  }

  getSpawnHints() {
    return this.config.spawnHints || {};
  }

  recordClear(linesCount) {
    this._totalClears += linesCount || 0;
  }

  recordRound() {
    this._totalRounds++;
  }

  recordPlacement() {
    this._totalPlacements++;
  }

  checkObjective(game) {
    const obj = this.config.objective || {};
    const c = this.config.constraints || {};
    const maxRounds = c.maxRounds ?? obj.maxRounds;
    const maxPlacements = c.maxPlacements ?? obj.maxPlacements;
    const score = game.score || 0;
    const clears = game.totalClears ?? this._totalClears;
    const scoreTarget = obj.value ?? obj.target ?? 0;
    const clearTarget = obj.value ?? obj.target ?? 0;
    const survivalTarget = obj.value ?? obj.minRounds ?? 0;
    let achieved = false;
    let objectiveDesc = '';

    switch (obj.type) {
      case 'score':
        achieved = score >= scoreTarget;
        objectiveDesc = `得分 ${score} / ${scoreTarget}`;
        break;
      case 'clear':
        achieved = clears >= clearTarget;
        objectiveDesc = `消行 ${clears} / ${clearTarget}`;
        break;
      case 'survival':
        achieved = this._totalRounds >= survivalTarget;
        objectiveDesc = `存活 ${this._totalRounds} / ${survivalTarget} 轮`;
        break;
      default:
        objectiveDesc = '自由模式';
        break;
    }

    let failed = false;
    if (!achieved) {
      if (maxRounds !== undefined && this._totalRounds >= maxRounds) failed = true;
      if (maxPlacements !== undefined && this._totalPlacements >= maxPlacements) failed = true;
    }

    if (!achieved && !failed) {
      return { done: false, stars: 0, objective: objectiveDesc, failed: false };
    }

    const stars = this._calcStars(score, clears, achieved);
    const mode = achieved ? 'level' : 'level-fail';
    return {
      done: true,
      achieved,
      failed,
      stars,
      objective: objectiveDesc,
      mode,
    };
  }

  getResult(game) {
    const result = this.checkObjective(game);
    return {
      stars: result.stars,
      objective: result.objective,
      config: this.config,
      totalClears: this._totalClears,
      totalRounds: this._totalRounds,
      achieved: !!result.achieved,
      failed: !!result.failed,
      mode: result.mode || 'level',
    };
  }

  _calcStars(score, clears, achieved) {
    if (!achieved) return 0;
    const val = this.config.objective?.type === 'clear' ? clears : score;
    const thresholds = this.config.stars;
    if (thresholds) {
      if (val >= thresholds.three) return 3;
      if (val >= thresholds.two) return 2;
      if (val >= thresholds.one) return 1;
      return 1;
    }
    const arr = this.config.objective?.starThresholds;
    if (Array.isArray(arr) && arr.length >= 3) {
      if (val >= arr[2]) return 3;
      if (val >= arr[1]) return 2;
      if (val >= arr[0]) return 1;
      return 1;
    }
    return 1;
  }
}

module.exports = { LevelManager };

