"""效率优化等价性回归测试，锁死一致性（不降低模型效果的护栏）。

覆盖：
- E：局内精确 phi 缓存 —— miss/hit/别名三路均与 uncached 逐字段等价。
- B：MCTS batched policy expansion —— 合批先验与逐叶 softmax 数值等价。

这些优化只应改变速度，不应改变 teacher 目标 / 轨迹 / 动作概率。
"""
from __future__ import annotations

import os
import random

import numpy as np
import torch

import rl_pytorch.features as Fe
from rl_pytorch.mcts import _MCTSNode, _flush_expand_policy
from rl_pytorch.simulator import OpenBlockSimulator


def _advanced_sim(seed: int, steps: int) -> OpenBlockSimulator:
    random.seed(seed)
    np.random.seed(seed)
    sim = OpenBlockSimulator("normal")
    for _ in range(steps):
        legal = sim.get_legal_actions()
        if not legal:
            break
        a = legal[len(legal) // 2]
        sim.step(a["block_idx"], a["gx"], a["gy"])
    return sim


# ---------------------------------------------------------------------------
# E：phi 缓存等价 + 防别名
# ---------------------------------------------------------------------------

def test_phi_cache_equivalence_and_no_aliasing():
    sim = _advanced_sim(seed=3, steps=4)
    legal = sim.get_legal_actions()
    assert legal, "需要非空合法动作"

    os.environ["RL_PHI_CACHE"] = "0"
    Fe.phi_cache_begin_episode()
    s_ref, p_ref = Fe.build_phi_batch(sim, legal)

    os.environ["RL_PHI_CACHE"] = "1"
    try:
        Fe.phi_cache_begin_episode()
        s1, p1 = Fe.build_phi_batch(sim, legal)   # miss
        s2, p2 = Fe.build_phi_batch(sim, legal)   # hit
        assert np.array_equal(s_ref, s1) and np.array_equal(p_ref, p1)
        assert np.array_equal(s_ref, s2) and np.array_equal(p_ref, p2)
        hits, misses = Fe.phi_cache_stats()
        assert hits >= 1 and misses >= 1
        # 调用方修改返回值不得污染缓存
        p2[0, 0] += 999.0
        s3, p3 = Fe.build_phi_batch(sim, legal)   # hit again
        assert np.array_equal(p_ref, p3), "缓存被调用方写入污染（别名）"
    finally:
        os.environ.pop("RL_PHI_CACHE", None)
        Fe.phi_cache_begin_episode()


def test_phi_cache_key_distinguishes_boards():
    """不同盘面必须命中不同缓存条目（精确键，不可有损）。"""
    os.environ["RL_PHI_CACHE"] = "1"
    try:
        sim_a = _advanced_sim(seed=5, steps=3)
        Fe.phi_cache_begin_episode()
        _sa, pa = Fe.build_phi_batch(sim_a, sim_a.get_legal_actions())
        # 再推进一步形成不同盘面
        la = sim_a.get_legal_actions()
        sim_a.step(la[0]["block_idx"], la[0]["gx"], la[0]["gy"])
        _sb, pb = Fe.build_phi_batch(sim_a, sim_a.get_legal_actions())
        # 不同盘面的 phi 不应相同形状/内容地误命中
        assert not (pa.shape == pb.shape and np.array_equal(pa, pb))
    finally:
        os.environ.pop("RL_PHI_CACHE", None)
        Fe.phi_cache_begin_episode()


# ---------------------------------------------------------------------------
# B：batched policy expansion == 逐叶 softmax
# ---------------------------------------------------------------------------

class _LinearPolicyNet:
    """确定性 policy 头：每个动作一个 logit = phi · w。"""

    def __init__(self, dim: int):
        g = np.random.RandomState(0)
        self.w = torch.from_numpy(g.randn(dim).astype(np.float32))

    def forward_policy_logits(self, phi_t: torch.Tensor) -> torch.Tensor:
        return phi_t @ self.w


def test_mcts_batched_policy_matches_per_leaf():
    dev = torch.device("cpu")
    rng = np.random.RandomState(42)
    dim = 16
    leaves = [(n, np.ascontiguousarray(rng.randn(n, dim).astype(np.float32)))
              for n in (3, 5, 7, 1)]
    net = _LinearPolicyNet(dim)

    # 参考：逐叶 softmax
    ref = []
    for n_legal, phi in leaves:
        with torch.no_grad():
            lg = net.forward_policy_logits(torch.from_numpy(phi)).cpu().numpy()
        bl = lg[:n_legal]
        p = np.exp(bl - bl.max())
        p /= p.sum()
        ref.append(p)

    # 被测：批量 flush
    nodes = [_MCTSNode() for _ in leaves]
    _flush_expand_policy(net, dev, nodes,
                         [phi for _, phi in leaves],
                         [n for n, _ in leaves])

    for (n_legal, _), node, p in zip(leaves, nodes, ref):
        got = np.array([node.children[j].P for j in range(n_legal)])
        assert np.abs(got - p).max() < 1e-6, "batched 先验与逐叶 softmax 不一致"
