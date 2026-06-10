"""v12 RL 新信号集成测试：

- topology_aux 扩到 10 维（追加 contiguous_regions / concave_corners）
- spawn_difficulty_after 监督信号（4 维）
- 评估反馈 ΔΦ_eval 塑形
- 难度桶课程 max_scd_for_episode
- 风格族 condition token 注入

不验证训练收敛，只校验信号管线与维度契约。
"""
from __future__ import annotations

import numpy as np
import torch

from rl_pytorch.condition_token import CONDITION_ARCS, CONDITION_INTENTS, encode_condition_onehot
from rl_pytorch.features import STATE_FEATURE_DIM, extract_state_features
from rl_pytorch.model import ConvSharedPolicyValueNet, SPAWN_DIFF_AUX_DIM, TOPOLOGY_AUX_DIM
from rl_pytorch.simulator import (
    OpenBlockSimulator,
    _DIFF_CURR_STAGES,
    _diff_curr_enabled,
    max_scd_for_episode,
)


def test_topology_aux_dim_is_ten():
    assert TOPOLOGY_AUX_DIM == 10
    sim = OpenBlockSimulator("normal")
    sup = sim.get_supervision_signals()
    assert sup["topology_after"].shape == (10,)
    assert sup["spawn_difficulty_after"].shape == (SPAWN_DIFF_AUX_DIM,)


def test_supervision_keys_complete():
    sim = OpenBlockSimulator("normal")
    sup = sim.get_supervision_signals()
    assert set(sup.keys()) >= {"board_quality", "feasibility", "topology_after", "spawn_difficulty_after"}


def test_max_scd_for_episode_monotonic():
    if not _diff_curr_enabled() or not _DIFF_CURR_STAGES:
        return  # 配置关闭时跳过
    prev = 0.0
    for ep in (0, 1000, 5000, 15000, 50000):
        v = max_scd_for_episode(ep)
        assert 0.0 < v <= 1.0
        assert v >= prev - 1e-9
        prev = v


def test_condition_token_injects_into_state():
    from rl_pytorch.game_rules import FEATURE_ENCODING
    sim = OpenBlockSimulator("normal", condition_arc="peak", condition_intent="pressure")
    st = extract_state_features(sim.grid, sim.dock, sim.strategy_id,
                                 arc=sim.condition_arc, intent=sim.condition_intent)
    assert st.shape[0] == STATE_FEATURE_DIM
    cond = encode_condition_onehot("peak", "pressure")
    # condition token 在标量段末尾，标量段长度 = FEATURE_ENCODING["stateScalarDim"]
    scalar_dim = int(FEATURE_ENCODING["stateScalarDim"])
    off = scalar_dim - len(cond)
    np.testing.assert_array_equal(st[off:off + len(cond)], cond)


def test_eval_feedback_does_not_crash():
    """评估反馈塑形启用时 step 应不抛错；reward 为有限实数。
    v12.1：改为瞬时塑形（非势差）→ 不再持久化累计字段。"""
    sim = OpenBlockSimulator("normal")
    legal = sim.get_legal_actions()
    assert legal
    a = legal[0]
    r = sim.step(a["block_idx"], a["gx"], a["gy"])
    assert isinstance(r, float)
    assert np.isfinite(r)


def test_spawn_diff_aux_head_forward():
    net = ConvSharedPolicyValueNet()
    sim = OpenBlockSimulator("normal", condition_arc="momentum", condition_intent="flow")
    st = extract_state_features(sim.grid, sim.dock, sim.strategy_id,
                                 arc=sim.condition_arc, intent=sim.condition_intent)
    batch = torch.from_numpy(np.stack([st, st]))
    pred = net.forward_spawn_diff_aux(batch)
    assert pred.shape == (2, SPAWN_DIFF_AUX_DIM)
    aux = net.forward_aux_all(batch)
    assert set(aux.keys()) >= {"board_quality", "feasibility", "survival", "spawn_diff"}
    assert aux["spawn_diff"].shape == (2, SPAWN_DIFF_AUX_DIM)


def test_dock_difficulty_respects_max_scd():
    """开启严格 max_scd=0.0 时 dock 应被多次重抽（不保证一定满足，但不应崩）。"""
    sim = OpenBlockSimulator("normal", max_scd=0.0)
    assert sim.dock and all(b["shape"] for b in sim.dock)
