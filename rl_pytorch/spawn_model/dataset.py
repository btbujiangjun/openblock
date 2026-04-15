"""
从 SQLite move_sequences 提取训练数据（v2）。

每个样本 = (board_state, context_scalars, recent_shape_ids) → (target_shape_ids)

v2 改进：
  - CONTEXT_DIM 12 → 24：涵盖完整玩家能力画像 + 自适应策略信号
  - 新增品类标签用于多样性辅助损失
  - 采样权重同时考虑分数和消行率（避免纯分数膨胀）
"""

import json
import sqlite3
import numpy as np
from pathlib import Path

SHAPE_VOCAB = [
    '1x4', '4x1', '1x5', '5x1', '2x3', '3x2', '2x2', '3x3',
    't-up', 't-down', 't-left', 't-right',
    'z-h', 'z-h2', 'z-v', 'z-v2',
    'l-1', 'l-2', 'l-3', 'l-4', 'l5-a', 'l5-b', 'l5-c', 'l5-d',
    'j-1', 'j-2', 'j-3', 'j-4'
]
SHAPE_TO_IDX = {s: i for i, s in enumerate(SHAPE_VOCAB)}
NUM_SHAPES = len(SHAPE_VOCAB)
GRID_SIZE = 8
CONTEXT_DIM = 24
HISTORY_LEN = 3

SHAPE_CATEGORY = {
    '1x4': 0, '4x1': 0, '1x5': 0, '5x1': 0,
    '2x3': 1, '3x2': 1,
    '2x2': 2, '3x3': 2,
    't-up': 3, 't-down': 3, 't-left': 3, 't-right': 3,
    'z-h': 4, 'z-h2': 4, 'z-v': 4, 'z-v2': 4,
    'l-1': 5, 'l-2': 5, 'l-3': 5, 'l-4': 5,
    'l5-a': 5, 'l5-b': 5, 'l5-c': 5, 'l5-d': 5,
    'j-1': 6, 'j-2': 6, 'j-3': 6, 'j-4': 6,
}
NUM_CATEGORIES = 7


def _parse_board(grid_json):
    cells = grid_json.get('cells', [])
    board = np.zeros((GRID_SIZE, GRID_SIZE), dtype=np.float32)
    for y in range(min(GRID_SIZE, len(cells))):
        row = cells[y]
        for x in range(min(GRID_SIZE, len(row))):
            if row[x] is not None:
                board[y][x] = 1.0
    return board


def _safe(val, default=0.0):
    if val is None:
        return default
    try:
        return float(val)
    except (ValueError, TypeError):
        return default


_FLOW_MAP = {'bored': -1.0, 'flow': 0.0, 'anxious': 1.0}
_PACING_MAP = {'early': 0.0, 'tension': 0.5, 'release': 1.0}
_SESSION_MAP = {'warmup': 0.0, 'peak': 0.5, 'cooldown': 1.0}


def _parse_context(ps):
    """Extract 24-dim context from player state snapshot (v2)."""
    if not ps or not isinstance(ps, dict):
        return np.zeros(CONTEXT_DIM, dtype=np.float32)

    metrics = ps.get('metrics', {}) or {}
    adaptive = ps.get('adaptive', {}) or {}
    hints = adaptive.get('spawnHints', {}) or {}

    return np.array([
        # [0-3] 基础状态
        min(1.0, _safe(ps.get('score'), 0) / 500.0),
        _safe(ps.get('boardFill'), 0),
        _safe(ps.get('skill'), 0.5),
        _safe(ps.get('momentum'), 0),
        # [4-7] 情绪与认知
        _safe(ps.get('frustration'), 0),
        _safe(ps.get('cognitiveLoad'), 0),
        _safe(ps.get('engagementAPM'), 0) / 30.0,
        _safe(ps.get('flowDeviation'), 0),
        # [8-11] 标志位
        1.0 if ps.get('needsRecovery') else 0.0,
        1.0 if ps.get('hadNearMiss') else 0.0,
        1.0 if ps.get('isNewPlayer') else 0.0,
        min(1.0, _safe(ps.get('recentComboStreak'), 0) / 5.0),
        # [12-16] 统计指标
        min(1.0, _safe(metrics.get('clearRate'), 0)),
        min(1.0, _safe(metrics.get('missRate'), 0)),
        min(1.0, _safe(metrics.get('comboRate'), 0)),
        min(_safe(metrics.get('thinkMs'), 3000) / 10000.0, 1.0),
        min(_safe(metrics.get('afkCount'), 0) / 5.0, 1.0),
        # [17-19] 长周期能力评估
        _safe(ps.get('historicalSkill'), 0.5),
        np.clip(_safe(ps.get('trend'), 0), -1, 1),
        _safe(ps.get('confidence'), 0),
        # [20-23] 自适应策略信号
        np.clip(_safe(adaptive.get('stress'), 0), -0.5, 1.5),
        _FLOW_MAP.get(ps.get('flowState'), 0.0),
        _PACING_MAP.get(ps.get('pacingPhase'), 0.5),
        _SESSION_MAP.get(adaptive.get('sessionPhase'), 0.5),
    ], dtype=np.float32)


def _shape_id_to_idx(shape_id):
    return SHAPE_TO_IDX.get(shape_id, 0)


def _shape_id_to_cat(shape_id):
    return SHAPE_CATEGORY.get(shape_id, 0)


def extract_samples_from_session(frames, session_score, session_clear_rate=0.0):
    """
    Extract (board, context, history, targets, categories, weight) from one game's frames.
    weight 同时考虑分数与消行率，避免纯分数膨胀偏好。
    """
    samples = []
    last_grid = None
    spawn_history = []

    for frame in frames:
        t = frame.get('t')
        if t == 'init':
            last_grid = frame.get('grid')
        elif t == 'spawn':
            dock = frame.get('dock', [])
            if len(dock) < 3 or last_grid is None:
                continue

            target_ids = [_shape_id_to_idx(d.get('id', '')) for d in dock[:3]]
            target_cats = np.array([_shape_id_to_cat(d.get('id', '')) for d in dock[:3]], dtype=np.int64)
            board = _parse_board(last_grid)
            ps = frame.get('ps')
            context = _parse_context(ps)

            hist = np.zeros((HISTORY_LEN, 3), dtype=np.int64)
            for i, prev in enumerate(spawn_history[-HISTORY_LEN:]):
                offset = HISTORY_LEN - len(spawn_history[-HISTORY_LEN:]) + i
                for j, sid in enumerate(prev[:3]):
                    hist[offset][j] = sid

            score_w = 1.0 + max(0, session_score - 50) / 200.0
            clear_w = 1.0 + session_clear_rate * 0.5
            weight = (score_w * 0.6 + clear_w * 0.4)

            samples.append({
                'board': board,
                'context': context,
                'history': hist,
                'targets': np.array(target_ids, dtype=np.int64),
                'categories': target_cats,
                'weight': np.float32(weight),
            })

            spawn_history.append(target_ids)
        elif t == 'place':
            if last_grid is not None and frame.get('gridAfter'):
                last_grid = frame.get('gridAfter')

    return samples


def load_training_data(db_path, min_score=0, max_sessions=500):
    db_path = str(db_path)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("""
        SELECT s.id, s.score, m.frames
        FROM sessions s
        INNER JOIN move_sequences m ON m.session_id = s.id
        WHERE s.status = 'completed' AND s.score >= ?
        ORDER BY s.score DESC
        LIMIT ?
    """, (min_score, max_sessions))

    all_samples = []
    for row in cur.fetchall():
        try:
            frames = json.loads(row['frames'] or '[]')
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(frames, list) or len(frames) < 5:
            continue
        score = row['score'] or 0

        clear_count = sum(1 for f in frames if f.get('t') == 'place')
        spawn_count = sum(1 for f in frames if f.get('t') == 'spawn')
        clear_rate = (clear_count / max(spawn_count, 1)) if spawn_count > 0 else 0.0

        samples = extract_samples_from_session(frames, score, clear_rate)
        all_samples.extend(samples)

    conn.close()
    return all_samples


try:
    import torch
    from torch.utils.data import Dataset

    class SpawnDataset(Dataset):

        def __init__(self, samples):
            self.samples = samples

        def __len__(self):
            return len(self.samples)

        def __getitem__(self, idx):
            s = self.samples[idx]
            return {
                'board': torch.from_numpy(s['board']),
                'context': torch.from_numpy(s['context']),
                'history': torch.from_numpy(s['history']),
                'targets': torch.from_numpy(s['targets']),
                'categories': torch.from_numpy(s['categories']),
                'weight': torch.tensor(s['weight']),
            }

except ImportError:
    pass
