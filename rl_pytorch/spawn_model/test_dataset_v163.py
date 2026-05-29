"""v1.63 出块算法优化数据集补全 —— 锁定两项改进的回归测试。

需求1：采样时 PB 围绕"指定数值"波动（避免常量），reward 口径按采样到的 PB 计算。
需求2：行为序列打包成 append-only 样本集（自动同步、WORM 不可删、删除原局后仍可训练）。

dataset 侧测试无第三方依赖（numpy 必备）；server 侧测试在 Flask 缺失时自动跳过，
避免 CPU-torch CI（spawn-model-gate）强依赖 Flask。
"""
import json
import os
import sqlite3
import tempfile

import numpy as np
import pytest

from rl_pytorch.spawn_model import dataset as D


def _mk_frames(best_score=1200):
    return [
        {'t': 'init', 'grid': {'cells': [[None] * 8 for _ in range(8)], 'size': 8},
         'ps': {'pv': 3, 'score': 0, 'bestScore': best_score, 'boardFill': 0.0, 'spawnGeo': {'holes': 0}}},
        {'t': 'spawn', 'dock': [{'id': '1x4'}, {'id': '2x2'}, {'id': 't-up'}],
         'ps': {'pv': 3, 'score': 800, 'bestScore': best_score, 'boardFill': 0.1, 'spawnGeo': {'holes': 1}}},
        {'t': 'place', 'i': 0, 'x': 0, 'y': 0,
         'ps': {'pv': 3, 'score': 810, 'bestScore': best_score, 'boardFill': 0.05, 'linesCleared': 1, 'spawnGeo': {'holes': 0}}},
        {'t': 'place', 'i': 1, 'x': 2, 'y': 0,
         'ps': {'pv': 3, 'score': 840, 'bestScore': best_score, 'boardFill': 0.0, 'linesCleared': 2, 'spawnGeo': {'holes': 0}}},
        {'t': 'spawn', 'dock': [{'id': '1x4'}, {'id': 'l-1'}, {'id': '2x2'}],
         'ps': {'pv': 3, 'score': 840, 'bestScore': best_score, 'boardFill': 0.0, 'spawnGeo': {'holes': 0}}},
    ]


# ── 需求1：PB 波动 + reward 口径 ─────────────────────────────────────────────

def test_pb_jitter_off_is_constant():
    frames = _mk_frames(1000)
    s = D.extract_samples_from_session(frames, 840, 0.5, pb_jitter=0.0, rng=np.random.default_rng(1))
    pbs = {float(x['pb_sampled']) for x in s}
    assert pbs == {1000.0}


def test_pb_jitter_on_varies_within_bounds():
    frames = _mk_frames(1000)
    pbs = set()
    for seed in range(30):
        for x in D.extract_samples_from_session(frames, 840, 0.5, pb_jitter=0.15,
                                                 rng=np.random.default_rng(seed)):
            pbs.add(round(float(x['pb_sampled']), 3))
    assert len(pbs) > 1                       # 不是常量
    assert min(pbs) >= 1000 * 0.85 - 1e-6      # ±15% 边界
    assert max(pbs) <= 1000 * 1.15 + 1e-6


def test_reward_uses_sampled_pb():
    frames = _mk_frames(1000)
    s = D.extract_samples_from_session(frames, 840, 0.5, pb_jitter=0.15, rng=np.random.default_rng(3))
    for x in s:
        assert np.isfinite(float(x['reward']))
        assert np.isfinite(float(x['pb_ratio_sampled']))
    # PB 越小 → 同一帧 reward 越高（口径按采样 PB）
    r_small = D._pb_reward(np.array([3, 30, -0.1, -1, 2, 2, 0], dtype=np.float32), 800, 500.0)
    r_large = D._pb_reward(np.array([3, 30, -0.1, -1, 2, 2, 0], dtype=np.float32), 800, 2000.0)
    assert r_small > r_large


def test_pb_center_fallback_chain():
    # 显式 > 帧 bestScore > 局分数
    assert D._resolve_pb_center([], 0, explicit=900) == 900.0
    assert D._resolve_pb_center(_mk_frames(1234), 50) == 1234.0
    no_pb = [{'t': 'spawn', 'ps': {'score': 1}}]
    assert D._resolve_pb_center(no_pb, 777) == 777.0


def test_outcome_vector():
    frames = _mk_frames(1000)
    s = D.extract_samples_from_session(frames, 840, 0.5, pb_jitter=0.0, rng=np.random.default_rng(0))
    oc = s[0]['outcome']
    assert oc.shape == (D.OUTCOME_DIM,)
    assert oc[0] == 3.0      # 1 + 2 lines
    assert oc[4] == 2.0      # placed 2
    assert oc[5] == 2.0      # max single clear
    assert oc[6] == 1.0      # perfect clear (fill -> 0 with clear)


# ── 需求2：append-only 样本集（server 侧，Flask 缺失则跳过）──────────────────

def test_dataset_worm_autosync_and_decouple():
    pytest.importorskip("flask")
    db_fd, db_path = tempfile.mkstemp(suffix='.db')
    os.close(db_fd)
    os.environ["OPENBLOCK_DB_PATH"] = db_path
    import importlib
    import server as _server
    importlib.reload(_server)   # 确保用本测试的临时库重新 init_db
    client = _server.app.test_client()

    sid = client.post('/api/session', json={'userId': 'u1', 'strategy': 'normal'}).get_json()
    sid = sid.get('sessionId') or sid.get('id')
    frames = [
        {'t': 'init', 'grid': {'cells': [[None] * 8 for _ in range(8)], 'size': 8},
         'scoring': {'singleLine': 10, 'multiLine': 30, 'combo': 50},
         'ps': {'pv': 3, 'score': 0, 'bestScore': 1200, 'boardFill': 0.0, 'spawnGeo': {'holes': 0}}},
        {'t': 'spawn', 'dock': [{'id': '1x4', 'shape': [[1, 1, 1, 1]], 'colorIdx': 0},
                                {'id': '2x2', 'shape': [[1, 1], [1, 1]], 'colorIdx': 1},
                                {'id': 't-up', 'shape': [[1, 1, 1], [0, 1, 0]], 'colorIdx': 2}],
         'ps': {'pv': 3, 'score': 0, 'bestScore': 1200, 'boardFill': 0.1, 'spawnGeo': {'holes': 1}}},
        {'t': 'place', 'i': 0, 'x': 0, 'y': 0,
         'ps': {'pv': 3, 'score': 10, 'bestScore': 1200, 'boardFill': 0.05, 'linesCleared': 1, 'spawnGeo': {'holes': 0}}},
        {'t': 'spawn', 'dock': [{'id': '1x4', 'shape': [[1, 1, 1, 1]], 'colorIdx': 0},
                                {'id': 'l-1', 'shape': [[1, 0], [1, 1]], 'colorIdx': 3},
                                {'id': '2x2', 'shape': [[1, 1], [1, 1]], 'colorIdx': 1}],
         'ps': {'pv': 3, 'score': 10, 'bestScore': 1200, 'boardFill': 0.05, 'spawnGeo': {'holes': 0}}},
        {'t': 'place', 'i': 1, 'x': 2, 'y': 0,
         'ps': {'pv': 3, 'score': 40, 'bestScore': 1200, 'boardFill': 0.0, 'linesCleared': 2, 'spawnGeo': {'holes': 0}}},
    ]
    # 自动同步：PUT move-sequence → 打包
    client.put(f'/api/move-sequence/{sid}', json={'userId': 'u1', 'frames': frames})
    client.patch(f'/api/session/{sid}', json={'status': 'completed', 'score': 40,
                                              'endTime': 1700000000000,
                                              'gameStats': {'gameOverReason': 'jam', 'pbBaseline': 1200}})

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    row = cur.execute("SELECT * FROM spawn_dataset_samples WHERE session_id=?", (sid,)).fetchone()
    assert row is not None and row['sample_count'] == 2
    assert row['pb_baseline'] == 1200 and row['game_over_reason'] == 'jam'

    # WORM：直接 DELETE 必须被触发器拒绝
    with pytest.raises(sqlite3.IntegrityError):
        cur.execute("DELETE FROM spawn_dataset_samples WHERE session_id=?", (sid,))
        conn.commit()
    conn.close()

    # 删除原始 replay 会话 → 样本集去耦存活
    client.post('/api/replay-sessions/delete', json={'user_id': 'u1', 'session_ids': [sid]})
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    assert cur.execute("SELECT COUNT(*) FROM move_sequences WHERE session_id=?", (sid,)).fetchone()[0] == 0
    assert cur.execute("SELECT COUNT(*) FROM spawn_dataset_samples WHERE session_id=?", (sid,)).fetchone()[0] == 1
    conn.close()

    # 仍可从样本集训练（删除安全），PB 中心取打包行 pb_baseline
    samples = D.load_packed_dataset(db_path, pb_jitter=0.15, seed=7)
    assert len(samples) == 2
    assert samples[0]['died'] is True
    os.remove(db_path)
