"""v1.69 RL outcome 扩展契约测试（OUTCOME_DIM 15）。

覆盖：
  - OUTCOME_DIM == 15 + 旧字段[0..6] 不变（向后兼容）
  - 端侧 evaluation 派生维度 [7..14] 由 ps.evalMetrics / ps.evalRound 注入
  - _outcome_weight_factor：salvage 加权 / forced_bad 降权 / mean_regret 线性降权
  - _pb_reward：roundAbsScore 加成、totalRoundRegret 扣减
  - 旧 7 维 outcome 调用 weight/reward 等价 v1.63 行为（向后兼容）
"""

import numpy as np

from . import dataset as D


def _mk_frames_with_eval():
    """模拟一组帧：spawn → 3×place（带 evalMetrics）→ 下一 spawn（ps.evalRound）。"""
    return [
        {'t': 'init', 'grid': {'size': 8, 'cells': []}},
        {'t': 'spawn', 'dock': [{'id': 'a'}, {'id': 'b'}, {'id': 'c'}],
         'ps': {'score': 100, 'boardFill': 0.20, 'spawnGeo': {'holes': 0}, 'bestScore': 1000}},
        {'t': 'place', 'i': 0, 'x': 0, 'y': 0,
         'ps': {'score': 110, 'boardFill': 0.22, 'spawnGeo': {'holes': 0},
                'linesCleared': 1,
                'evalMetrics': {'regret': 0.10, 'optimality': 0.85, 'absScore': 0.7,
                                 'badnessTag': 'fine'}}},
        {'t': 'place', 'i': 1, 'x': 2, 'y': 0,
         'ps': {'score': 130, 'boardFill': 0.24, 'spawnGeo': {'holes': 1},
                'linesCleared': 2,
                'evalMetrics': {'regret': 0.20, 'optimality': 0.75, 'absScore': 0.6,
                                 'badnessTag': 'wasted_payoff'}}},
        {'t': 'place', 'i': 2, 'x': 4, 'y': 0,
         'ps': {'score': 160, 'boardFill': 0.0, 'spawnGeo': {'holes': 0},
                'linesCleared': 3,
                'evalMetrics': {'regret': 0.0, 'optimality': 1.0, 'absScore': 0.9,
                                 'badnessTag': 'optimal'}}},
        {'t': 'spawn', 'dock': [{'id': 'd'}, {'id': 'e'}, {'id': 'f'}],
         'ps': {'score': 160, 'boardFill': 0.0, 'spawnGeo': {'holes': 0},
                'bestScore': 1000,
                'evalRound': {'classification': 'salvage', 'absScore': 0.72,
                              'regrets': {'order': 0.05, 'path': 0.10, 'payoff': 0.20},
                              'bestRoundAbs': 0.80, 'payoffRealized': 0.85}}},
    ]


def test_outcome_dim_extended_to_15():
    assert D.OUTCOME_DIM == 15
    assert D.OUTCOME_DIM_LEGACY == 7


def test_outcome_v169_eval_derived_fields():
    frames = _mk_frames_with_eval()
    oc = D._compute_spawn_outcome(frames, 1)
    assert oc.shape == (15,)
    # 旧字段保持 v1.63 语义
    assert oc[0] == 6.0           # 1+2+3 lines
    assert oc[4] == 3.0           # placed 3
    assert oc[5] == 3.0           # max single clear
    assert oc[6] == 1.0           # perfect clear
    # v1.69 新字段
    assert abs(oc[7] - (0.10 + 0.20 + 0.0) / 3) < 1e-6     # mean regret
    assert abs(oc[8] - (0.85 + 0.75 + 1.0) / 3) < 1e-6     # mean optimality
    assert oc[9] == 0.0           # not forced_bad
    assert oc[10] == 1.0          # salvage
    assert abs(oc[11] - 0.72) < 1e-6   # round abs
    assert abs(oc[12] - 0.05) < 1e-6   # order regret
    assert abs(oc[13] - 0.10) < 1e-6   # path regret
    assert abs(oc[14] - 0.20) < 1e-6   # payoff regret


def test_outcome_v169_back_compat_when_eval_missing():
    """旧帧（无 evalMetrics / evalRound）：派生维度全部归零，旧字段不变。"""
    frames = [
        {'t': 'spawn', 'ps': {'score': 0, 'boardFill': 0, 'spawnGeo': {'holes': 0}}},
        {'t': 'place', 'ps': {'score': 10, 'boardFill': 0.1, 'spawnGeo': {'holes': 0},
                              'linesCleared': 1}},
        {'t': 'place', 'ps': {'score': 30, 'boardFill': 0.2, 'spawnGeo': {'holes': 0},
                              'linesCleared': 2}},
    ]
    oc = D._compute_spawn_outcome(frames, 0)
    assert oc.shape == (15,)
    assert oc[0] == 3.0
    # 派生维度全 0，optimality 在缺数据时退化为中性值（=0 表示未评估）
    for i in range(7, 15):
        assert oc[i] == 0.0, f'index {i} expected 0, got {oc[i]}'


def test_outcome_weight_factor_salvage_uplift():
    """salvage 标志位 → ×1.25 加权（不利场景救场是高质量正样本）。"""
    base = [3.0, 30.0, -0.05, -1.0, 3.0, 2.0, 0.0,
            0.05, 0.95, 0.0, 0.0, 0.7, 0.05, 0.10, 0.10]   # 一般好局
    salvage = base.copy()
    salvage[10] = 1.0
    w_base = D._outcome_weight_factor(np.array(base, dtype=np.float32))
    w_salvage = D._outcome_weight_factor(np.array(salvage, dtype=np.float32))
    assert w_salvage > w_base
    assert abs(w_salvage / w_base - 1.25) < 0.05 + 0.35    # 允许 mean_regret 项的差异


def test_outcome_weight_factor_forced_bad_downweight():
    """forced_bad 标志位 → ×0.60 降权（算法责任）。"""
    base = [1.0, 5.0, 0.05, 1.0, 3.0, 1.0, 0.0,
            0.30, 0.70, 0.0, 0.0, 0.30, 0.30, 0.30, 0.20]
    forced = base.copy()
    forced[9] = 1.0
    w_base = D._outcome_weight_factor(np.array(base, dtype=np.float32))
    w_forced = D._outcome_weight_factor(np.array(forced, dtype=np.float32))
    assert w_forced < w_base
    assert w_forced >= 0.4   # 仍在 clip 下限之上


def test_outcome_weight_back_compat_with_7dim():
    """旧 7 维 outcome 调用 weight 仍工作（兼容旧 callsite）。"""
    legacy = np.array([2.0, 10.0, 0.0, 0.0, 3.0, 1.0, 0.0], dtype=np.float32)
    w = D._outcome_weight_factor(legacy)
    assert 0.4 <= w <= 2.0


def test_pb_reward_round_abs_uplift_and_regret_penalty():
    base = np.array([3.0, 30.0, -0.05, -1.0, 3.0, 2.0, 0.0,
                     0.10, 0.90, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], dtype=np.float32)
    high_quality = base.copy()
    high_quality[11] = 0.95   # round abs
    r_base = D._pb_reward(base, 100.0, 1000.0)
    r_high = D._pb_reward(high_quality, 100.0, 1000.0)
    assert r_high > r_base

    high_regret = base.copy()
    high_regret[12] = high_regret[13] = high_regret[14] = 0.9    # 三类 regret 全高
    r_bad = D._pb_reward(high_regret, 100.0, 1000.0)
    assert r_bad < r_base
