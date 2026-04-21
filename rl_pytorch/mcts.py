"""轻量 UCT-MCTS for Open Block — v8

以神经网络 V(s) 替代随机 rollout，实现低开销的树搜索，
向 AlphaZero「MCTS 策略目标」靠拢。

算法概述
--------
1. Selection  : UCB(s,a) = Q(s,a) + c_puct * P(a|s) * √N(s) / (1 + N(s,a))
2. Expansion  : 叶子节点展开，先验 P(a|s) 来自策略网络
3. Evaluation : 价值网络 V(s_leaf)（替代随机 rollout）
4. Backup     : 沿路径反向更新 Q(s,a) = 累积 V / 访问次数

Open Block 特性适配
-------------------
- 单玩家游戏：无需双方轮流搜索，Q(s,a) 直接反映后继状态期望价值
- dock 随机性：模拟时使用确定性当前 dock（不重新抽块），
  等价于对当前已知信息的期望值计算
- 注意：每次调用 run_mcts() 都从零开始建树（无跨步复用），
  适合 10~50 次模拟的轻量使用场景

使用方式
--------
    visit_pi = run_mcts(net, device, sim, n_simulations=20)
    if visit_pi is not None:
        # visit_pi 可作为 Q 分布目标（替代 1-step lookahead 的 q_vals）
        q_proxy = visit_pi  # shape=(n_legal,)，已归一化

环境变量
--------
    RL_MCTS_SIMS        整数，覆盖 n_simulations（默认读 game_rules）
    RL_MCTS_CPUCT       浮点，覆盖 c_puct
    RL_MCTS_MAX_DEPTH   整数，覆盖 max_depth
"""

from __future__ import annotations

import math
import os

import numpy as np
import torch
import torch.nn.functional as F

from .device import tensor_to_device
from .features import build_phi_batch, extract_state_features


# ---------------------------------------------------------------------------
# 树节点
# ---------------------------------------------------------------------------

class _MCTSNode:
    """UCT 树中的单个节点，对应一个 (state, set-of-legal-actions) 的决策时刻。

    Attributes:
        N   : 访问次数（N(s,a) 语义上也等于本节点被选中次数）
        W   : 累积价值
        Q   : 平均价值 = W / max(N, 1)
        P   : 策略先验（来自父节点的策略网络输出）
        children: action_idx → 子节点
        is_expanded: 是否已展开（获取了合法动作与先验）
    """

    __slots__ = ("N", "W", "Q", "P", "children", "is_expanded")

    def __init__(self, prior: float = 1.0):
        self.N: int = 0
        self.W: float = 0.0
        self.Q: float = 0.0
        self.P: float = prior
        self.children: dict[int, "_MCTSNode"] = {}
        self.is_expanded: bool = False


# ---------------------------------------------------------------------------
# 核心搜索
# ---------------------------------------------------------------------------

def _ucb_score(child: "_MCTSNode", parent_N: int, c_puct: float) -> float:
    """UCB 分数；未访问节点给 +inf 保证优先探索。"""
    return child.Q + c_puct * child.P * math.sqrt(max(parent_N, 1)) / (1 + child.N)


def run_mcts(
    net,
    device: torch.device,
    sim,
    n_simulations: int = 20,
    c_puct: float = 1.5,
    max_depth: int = 8,
    gamma: float = 0.99,
) -> np.ndarray | None:
    """运行 UCT-MCTS，返回根节点各动作的归一化访问分布。

    Args:
        net           : 策略-价值双头网络（须有 forward_policy_logits / forward_value）
        device        : 推理设备
        sim           : 当前局面的模拟器实例；内部会 save/restore，不会破坏外部状态
        n_simulations : 模拟次数（建议 10~50）
        c_puct        : UCB 探索系数（AlphaZero 默认 1.5~5.0）
        max_depth     : 单次模拟展开的最大步数（超限后直接调用 V）
        gamma         : 折扣因子（目前 V 本身已含未来价值，backup 时不额外折扣，
                        保留参数以便后续实验）

    Returns:
        np.ndarray, shape=(n_legal_root,)：归一化访问分布 π；
        若根节点无合法动作则返回 None。
    """
    # 覆盖参数来自环境变量（方便命令行实验）
    env_sims = os.environ.get("RL_MCTS_SIMS", "").strip()
    if env_sims:
        n_simulations = int(env_sims)
    env_cpuct = os.environ.get("RL_MCTS_CPUCT", "").strip()
    if env_cpuct:
        c_puct = float(env_cpuct)
    env_depth = os.environ.get("RL_MCTS_MAX_DEPTH", "").strip()
    if env_depth:
        max_depth = int(env_depth)

    legal_root = sim.get_legal_actions()
    if not legal_root:
        return None
    n_root = len(legal_root)

    # --- 根节点先验 ---
    with torch.no_grad():
        _, phi_np = build_phi_batch(sim, legal_root)
        if phi_np.shape[0] == 0:
            return None
        phi = tensor_to_device(torch.from_numpy(phi_np), device)
        logits = net.forward_policy_logits(phi)
        priors = F.softmax(logits, dim=-1).cpu().numpy()

    root = _MCTSNode()
    root.is_expanded = True
    root.N = 0
    for i in range(n_root):
        root.children[i] = _MCTSNode(prior=float(priors[i]))

    root_saved = sim.save_state()

    for _ in range(n_simulations):
        sim.restore_state(root_saved)
        node = root
        path: list[tuple[_MCTSNode, int]] = []  # (parent, action_idx)
        depth = 0

        # ---- Selection + Expansion ----
        while not sim.is_terminal() and depth < max_depth:
            legal = sim.get_legal_actions()
            if not legal:
                break

            if not node.is_expanded:
                # 展开：获取先验，创建子节点
                with torch.no_grad():
                    _, phi_leaf = build_phi_batch(sim, legal)
                    if phi_leaf.shape[0] > 0:
                        phi_t = tensor_to_device(torch.from_numpy(phi_leaf), device)
                        lg = net.forward_policy_logits(phi_t)
                        pr = F.softmax(lg, dim=-1).cpu().numpy()
                        for j in range(len(legal)):
                            node.children[j] = _MCTSNode(prior=float(pr[j]))
                node.is_expanded = True

            # UCB 选择
            parent_N = node.N if node.N > 0 else 1
            best_i, best_sc = 0, -1e18
            for i, child in node.children.items():
                sc = _ucb_score(child, parent_N, c_puct)
                if sc > best_sc:
                    best_sc = sc
                    best_i = i

            if best_i >= len(legal):
                best_i = len(legal) - 1

            path.append((node, best_i))
            a = legal[best_i]
            sim.step(a["block_idx"], a["gx"], a["gy"])
            node = node.children.setdefault(best_i, _MCTSNode())
            depth += 1

        # ---- Evaluation ----
        if sim.is_terminal():
            leaf_value = 0.0
        else:
            legal_leaf = sim.get_legal_actions()
            if not legal_leaf:
                leaf_value = 0.0
            else:
                with torch.no_grad():
                    s_np = extract_state_features(sim.grid, sim.dock)
                    s_t = tensor_to_device(
                        torch.from_numpy(s_np).unsqueeze(0), device
                    )
                    leaf_value = float(net.forward_value(s_t).item())

        # ---- Backup ----
        for parent, a_idx in reversed(path):
            child_node = parent.children.setdefault(a_idx, _MCTSNode())
            child_node.N += 1
            child_node.W += leaf_value
            child_node.Q = child_node.W / child_node.N
        root.N += 1

    sim.restore_state(root_saved)

    # ---- 归一化访问分布 ----
    counts = np.array(
        [root.children[i].N if i in root.children else 0 for i in range(n_root)],
        dtype=np.float32,
    )
    total = counts.sum()
    if total < 1e-6:
        return None
    return counts / total


def mcts_q_proxy(
    net,
    device: torch.device,
    sim,
    n_simulations: int = 20,
    c_puct: float = 1.5,
    max_depth: int = 8,
    gamma: float = 0.99,
) -> np.ndarray | None:
    """将 MCTS 访问分布转换为「伪 Q 值」数组，可直接替代 lookahead Q 值。

    通过 visit_counts → 对数空间将分布转为分数：
        q_proxy[i] = log(visit_counts[i] + ε)  * scale

    这样 q_proxy 的 softmax 与 visit_counts 分布接近，
    可直接代入 collect_episode 中的 q_vals 逻辑。

    Returns:
        np.ndarray shape=(n_legal,) 或 None（失败时回退到 1-step lookahead）
    """
    visit_pi = run_mcts(net, device, sim, n_simulations, c_puct, max_depth, gamma)
    if visit_pi is None:
        return None
    # 将访问分布映射为分数（对数尺度），供 Q 蒸馏和动作选择使用
    eps = 1.0 / max(len(visit_pi) * 10, 100)
    q = np.log(visit_pi + eps)
    # 平移到 0 均值（稳定后续 softmax 运算）
    q -= q.mean()
    return q
