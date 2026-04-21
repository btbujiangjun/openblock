"""轻量 UCT-MCTS for Open Block — v8.2

以神经网络 V(s) 替代随机 rollout，实现低开销的树搜索，
向 AlphaZero「MCTS 策略目标」靠拢。

v8.2 新增
---------
- **Zobrist hash 跨局持久化**（ZobristHasher + ZobristCache）：
  用 Zobrist 哈希索引已见局面的 MCTS 节点，跨局保留统计信息；
  hit 时以旧树作为热启动，减少冷启动模拟数量。
- **批量叶子节点评估 + 虚拟 loss 并行 MCTS**（run_mcts_batched）：
  每 eval_batch_size 次模拟合并为一次 GPU forward，适合 100+ 次模拟；
  虚拟 loss 使同批次模拟分散至不同子树，降低重叠率。
- **自动分派**（mcts_q_proxy）：n_simulations ≥ 50 时自动切换为批量模式。

v8.1 新增
---------
- **MCTS 树复用**（MCTSTreeState）：一局内跨步保留搜索树，避免重复建树开销。
  每步选完动作后调用 state.advance(chosen_idx)，复用对应子树作为下一步的根。
  dock 刷新（三块全放完）时调用 state.invalidate() 清空树。
- **多温度采样**（select_action_from_visits）：
  T=0 → argmax（贪心/评估）；T>0 → 按 N^(1/T) 随机采样。
- **随机出块 MCTS 展开**（stochastic mode）：当 SpawnPredictor 可用时，
  在叶子节点以 dock 采样分布代替确定性当前 dock 估计 V，
  减少因「已知出块」引发的乐观偏差。

算法概述
--------
1. Selection  : UCB(s,a) = Q(s,a) + c_puct * P(a|s) * √N(s) / (1 + N(s,a))
2. Expansion  : 叶子节点展开，先验 P(a|s) 来自策略网络
3. Evaluation : 价值网络 V(s_leaf)（替代随机 rollout）
4. Backup     : 沿路径反向更新 Q(s,a) = 累积 V / 访问次数

Open Block 特性适配
-------------------
- 单玩家游戏：Q(s,a) 直接反映后继状态期望价值
- dock 随机性：默认确定性（使用当前已知 dock）；stochastic=True 时采样未来 dock
- 无跨步树复用时，每次调用从零建树（适合 10~50 次模拟）

使用方式
--------
    # 无树复用（简单模式）
    visit_pi = run_mcts(net, device, sim, n_simulations=20)

    # 有树复用（推荐用于完整 episode 采集）
    tree = MCTSTreeState()
    for step in episode:
        visit_pi = run_mcts_reuse(tree, net, device, sim, n_simulations=20)
        chosen = select_action_from_visits(visit_pi, temperature=1.0)
        sim.step(legal[chosen])
        tree.advance(chosen)           # 复用子树
        if dock_refilled:
            tree.invalidate()          # dock 刷新后清空

环境变量
--------
    RL_MCTS_SIMS          整数，覆盖 n_simulations
    RL_MCTS_CPUCT         浮点，覆盖 c_puct
    RL_MCTS_MAX_DEPTH     整数，覆盖 max_depth
    RL_MCTS_STOCHASTIC    1=启用随机出块评估（需 SpawnPredictor）
    RL_MCTS_BATCH_SIZE    整数，批量叶子评估大小（默认 8）
    RL_ZOBRIST_CACHE_SIZE 整数，Zobrist 跨局缓存节点数上限（默认 5000，0=禁用）
"""

from __future__ import annotations

import math
import os
from collections import OrderedDict
from typing import TYPE_CHECKING

import numpy as np
import torch
import torch.nn.functional as F

from .device import tensor_to_device
from .features import build_phi_batch, extract_state_features

if TYPE_CHECKING:
    from .spawn_predictor import SpawnPredictor


# ---------------------------------------------------------------------------
# 树节点
# ---------------------------------------------------------------------------

class _MCTSNode:
    """UCT 树中的单个节点。

    Attributes:
        N   : 被选中（访问）次数
        W   : 累积价值
        Q   : 平均价值 = W / max(N, 1)
        P   : 策略先验（来自父节点展开时的策略网络输出）
        children: action_idx → 子节点
        is_expanded: 是否已展开（已获取合法动作+先验）
        n_legal: 展开时的合法动作数（用于校验子树有效性）
    """

    __slots__ = ("N", "W", "Q", "P", "children", "is_expanded", "n_legal")

    def __init__(self, prior: float = 1.0):
        self.N: int = 0
        self.W: float = 0.0
        self.Q: float = 0.0
        self.P: float = prior
        self.children: dict[int, "_MCTSNode"] = {}
        self.is_expanded: bool = False
        self.n_legal: int = 0


# ---------------------------------------------------------------------------
# 跨步树状态（树复用）
# ---------------------------------------------------------------------------

class MCTSTreeState:
    """一局内跨步复用的 MCTS 树容器。

    使用方式::

        cache = ZobristCache(ZobristHasher())   # 可选，跨局热启动
        tree = MCTSTreeState(zobrist_cache=cache)
        while not done:
            visit_pi = run_mcts_reuse(tree, net, device, sim)
            chosen = select_action_from_visits(visit_pi, temperature=T)
            sim.step(legal[chosen])
            if dock_slots_remaining > 0:
                tree.advance(chosen)   # 复用对应子树
            else:
                tree.invalidate()      # dock 刷新后重建
        # 新局开始时，不需要重置 tree，cache 会尝试热启动根节点
    """

    def __init__(self, zobrist_cache: "ZobristCache | None" = None):
        self.root: _MCTSNode | None = None
        self._n_advances: int = 0       # 诊断：本局步内复用次数
        self._zobrist_key: int | None = None    # 当前根节点的 Zobrist key
        self.zobrist_cache = zobrist_cache      # 可选跨局缓存

    def try_warm_start(self, sim) -> bool:
        """在新局/dock 刷新后，尝试从 Zobrist 缓存中热启动根节点。

        读取顺序：本地 LRU（full subtree）→ 跨进程 SharedZobristTable（N+Q 统计）。
        若命中，将 root 指向对应节点并返回 True；否则保持 root=None，返回 False。
        """
        if self.zobrist_cache is None:
            return False
        try:
            grid_np = sim.grid if hasattr(sim, "grid") else None
            dock = sim.dock if hasattr(sim, "dock") else []
            if grid_np is None:
                return False
            key, cached_node = _zobrist_cache_lookup_with_shared(
                self.zobrist_cache, grid_np, dock
            )
            if cached_node is not None:
                self.root = cached_node
                self._zobrist_key = key
                return True
        except Exception:
            pass
        return False

    def flush_to_cache(self) -> None:
        """将当前根节点存入本地 LRU 和跨进程共享表（局末调用）。"""
        if self.zobrist_cache is not None and self.root is not None and self._zobrist_key is not None:
            _zobrist_cache_flush_with_shared(
                self.zobrist_cache, self._zobrist_key, self.root
            )

    def advance(self, chosen_action_idx: int) -> bool:
        """将树根移动到被选中动作的子节点。

        返回 True 表示成功复用；False 表示子树不存在（下次重新建树）。
        """
        if self.root is None:
            return False
        child = self.root.children.get(chosen_action_idx)
        if child is None:
            self.root = None
            self._zobrist_key = None
            return False
        # 复用子树：新根不再需要 P（作为根节点时先验不参与 UCB 计算）
        child.P = 1.0
        self.root = child
        self._zobrist_key = None    # 子树 key 未记录，置空
        self._n_advances += 1
        return True

    def invalidate(self):
        """清空搜索树（dock 刷新或新局开始时调用）。"""
        self.root = None
        self._zobrist_key = None

    @property
    def reuse_count(self) -> int:
        return self._n_advances


# ---------------------------------------------------------------------------
# UCB 选择
# ---------------------------------------------------------------------------

def _ucb_score(child: _MCTSNode, parent_N: int, c_puct: float) -> float:
    """UCB 分数；未被访问的子节点给极大分（确保全部探索至少一次）。"""
    if child.N == 0:
        return 1e9 + child.P   # 用先验打破并列
    return child.Q + c_puct * child.P * math.sqrt(parent_N) / (1 + child.N)


# ---------------------------------------------------------------------------
# 内部：单次模拟
# ---------------------------------------------------------------------------

def _simulate(
    root: _MCTSNode,
    sim,
    net,
    device: torch.device,
    c_puct: float,
    max_depth: int,
    spawn_predictor: "SpawnPredictor | None",
    gamma: float,
) -> float:
    """执行一次 Selection→Expansion→Evaluation→Backup，返回叶子节点价值。"""
    node = root
    path: list[tuple[_MCTSNode, int]] = []
    depth = 0

    # ---- Selection + Expansion ----
    while not sim.is_terminal() and depth < max_depth:
        legal = sim.get_legal_actions()
        if not legal:
            break

        if not node.is_expanded:
            # 展开：用策略网络计算先验
            with torch.no_grad():
                _, phi_leaf = build_phi_batch(sim, legal)
                if phi_leaf.shape[0] > 0:
                    phi_t = tensor_to_device(torch.from_numpy(phi_leaf), device)
                    lg = net.forward_policy_logits(phi_t)
                    pr = F.softmax(lg, dim=-1).cpu().numpy()
                    for j in range(len(legal)):
                        node.children[j] = _MCTSNode(prior=float(pr[j]))
            node.is_expanded = True
            node.n_legal = len(legal)

        # UCB 选择
        best_i, best_sc = 0, -1e18
        pN = max(node.N, 1)
        for i in range(node.n_legal):
            child = node.children.get(i)
            if child is None:
                child = _MCTSNode()
                node.children[i] = child
            sc = _ucb_score(child, pN, c_puct)
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
        elif spawn_predictor is not None and os.environ.get("RL_MCTS_STOCHASTIC", "0") not in ("0", "false"):
            # 随机出块评估：对若干 dock 样本求期望 V
            leaf_value = spawn_predictor.expected_value(sim, net, device, n_samples=3)
        else:
            with torch.no_grad():
                s_np = extract_state_features(sim.grid, sim.dock)
                s_t = tensor_to_device(torch.from_numpy(s_np).unsqueeze(0), device)
                leaf_value = float(net.forward_value(s_t).item())

    # ---- Backup ----
    for parent, a_idx in reversed(path):
        child_node = parent.children.setdefault(a_idx, _MCTSNode())
        child_node.N += 1
        child_node.W += leaf_value
        child_node.Q = child_node.W / child_node.N
    root.N += 1

    return leaf_value


# ---------------------------------------------------------------------------
# 公开接口：无树复用版
# ---------------------------------------------------------------------------

def run_mcts(
    net,
    device: torch.device,
    sim,
    n_simulations: int = 20,
    c_puct: float = 1.5,
    max_depth: int = 8,
    gamma: float = 0.99,
    spawn_predictor: "SpawnPredictor | None" = None,
) -> np.ndarray | None:
    """运行 UCT-MCTS，返回根节点各动作的归一化访问分布。

    Args:
        net           : 策略-价值双头网络
        device        : 推理设备
        sim           : 当前局面（内部 save/restore，不破坏外部状态）
        n_simulations : 模拟次数（建议 10~50）
        c_puct        : UCB 探索系数
        max_depth     : 单次模拟的最大展开深度
        gamma         : 折扣因子（保留参数，当前评估不额外折扣）
        spawn_predictor: 出块预测模型；非 None + RL_MCTS_STOCHASTIC=1 时启用随机评估

    Returns:
        np.ndarray shape=(n_legal,) 归一化访问分布；无合法动作时返回 None。
    """
    # 环境变量覆盖
    if (v := os.environ.get("RL_MCTS_SIMS", "").strip()):
        n_simulations = int(v)
    if (v := os.environ.get("RL_MCTS_CPUCT", "").strip()):
        c_puct = float(v)
    if (v := os.environ.get("RL_MCTS_MAX_DEPTH", "").strip()):
        max_depth = int(v)

    legal_root = sim.get_legal_actions()
    if not legal_root:
        return None
    n_root = len(legal_root)

    with torch.no_grad():
        _, phi_np = build_phi_batch(sim, legal_root)
        if phi_np.shape[0] == 0:
            return None
        phi = tensor_to_device(torch.from_numpy(phi_np), device)
        logits = net.forward_policy_logits(phi)
        priors = F.softmax(logits, dim=-1).cpu().numpy()

    root = _MCTSNode()
    root.is_expanded = True
    root.n_legal = n_root
    for i in range(n_root):
        root.children[i] = _MCTSNode(prior=float(priors[i]))

    root_saved = sim.save_state()
    for _ in range(n_simulations):
        sim.restore_state(root_saved)
        _simulate(root, sim, net, device, c_puct, max_depth, spawn_predictor, gamma)
    sim.restore_state(root_saved)

    return _extract_visit_pi(root, n_root)


# ---------------------------------------------------------------------------
# 公开接口：跨步树复用版（推荐用于完整 episode 采集）
# ---------------------------------------------------------------------------

def run_mcts_reuse(
    tree_state: MCTSTreeState,
    net,
    device: torch.device,
    sim,
    n_simulations: int = 20,
    c_puct: float = 1.5,
    max_depth: int = 8,
    gamma: float = 0.99,
    spawn_predictor: "SpawnPredictor | None" = None,
) -> np.ndarray | None:
    """带树复用的 MCTS 搜索。

    若 tree_state.root 非空则继续在已有树上追加模拟（复用已积累的统计信息）；
    否则重新建树（根节点初始化）。
    模拟完成后不修改 tree_state（由调用方调用 tree_state.advance() 或
    tree_state.invalidate() 管理）。
    """
    # 环境变量覆盖
    if (v := os.environ.get("RL_MCTS_SIMS", "").strip()):
        n_simulations = int(v)
    if (v := os.environ.get("RL_MCTS_CPUCT", "").strip()):
        c_puct = float(v)
    if (v := os.environ.get("RL_MCTS_MAX_DEPTH", "").strip()):
        max_depth = int(v)

    legal_root = sim.get_legal_actions()
    if not legal_root:
        return None
    n_root = len(legal_root)

    # ---- 复用或重建根节点 ----
    root = tree_state.root
    if root is None or root.n_legal != n_root:
        # 树不存在或动作数变化（dock 刷新/不同局面）→ 重建
        with torch.no_grad():
            _, phi_np = build_phi_batch(sim, legal_root)
            if phi_np.shape[0] == 0:
                return None
            phi = tensor_to_device(torch.from_numpy(phi_np), device)
            logits = net.forward_policy_logits(phi)
            priors = F.softmax(logits, dim=-1).cpu().numpy()

        root = _MCTSNode()
        root.is_expanded = True
        root.n_legal = n_root
        for i in range(n_root):
            root.children[i] = _MCTSNode(prior=float(priors[i]))
        tree_state.root = root
        # 复用场景下已有访问统计；追加模拟数量按复用程度缩减
        extra_sims = n_simulations
    else:
        # 已有树：只补充不足部分（已有 N 次模拟则仅补 max(0, n_sims - N) 次）
        already = root.N
        extra_sims = max(0, n_simulations - already)

    root_saved = sim.save_state()
    for _ in range(extra_sims):
        sim.restore_state(root_saved)
        _simulate(root, sim, net, device, c_puct, max_depth, spawn_predictor, gamma)
    sim.restore_state(root_saved)

    return _extract_visit_pi(root, n_root)


# ---------------------------------------------------------------------------
# 温度缩放动作选择
# ---------------------------------------------------------------------------

def select_action_from_visits(
    visit_pi: np.ndarray,
    temperature: float = 1.0,
) -> int:
    """从访问分布中按温度采样动作索引。

    Args:
        visit_pi    : run_mcts[_reuse] 返回的归一化访问分布
        temperature : 采样温度。
            T → 0 : 贪心 argmax（评估/推理模式）
            T = 1 : 按访问频率比例采样（标准 AlphaZero 训练模式）
            T > 1 : 更均匀，增强探索

    Returns:
        选中的动作索引 int
    """
    if temperature <= 1e-6:
        return int(np.argmax(visit_pi))
    adjusted = np.power(np.asarray(visit_pi, dtype=np.float64) + 1e-10, 1.0 / temperature)
    total = adjusted.sum()
    if total < 1e-12:
        return int(np.argmax(visit_pi))
    adjusted /= total
    return int(np.random.choice(len(visit_pi), p=adjusted))


# ---------------------------------------------------------------------------
# Q 代理（兼容现有 Q-蒸馏框架）
# ---------------------------------------------------------------------------

def mcts_q_proxy(
    net,
    device: torch.device,
    sim,
    n_simulations: int = 20,
    c_puct: float = 1.5,
    max_depth: int = 8,
    gamma: float = 0.99,
    spawn_predictor: "SpawnPredictor | None" = None,
    tree_state: MCTSTreeState | None = None,
    eval_batch_size: int = 8,
) -> np.ndarray | None:
    """将 MCTS 访问分布转换为「伪 Q 值」，可直接替代 lookahead Q 值。

    q_proxy[i] = log(visit_pi[i] + ε)，softmax 近似 visit_pi 分布，
    可代入 collect_episode 的 q_vals 逻辑（Q 蒸馏 + 动作选择混合）。

    **自动分派策略**
    - n_simulations < 50：使用 run_mcts / run_mcts_reuse（单次 GPU 调用）
    - n_simulations ≥ 50：使用 run_mcts_batched（批量 GPU 调用，效率更高）
    """
    env_sims = os.environ.get("RL_MCTS_SIMS")
    if env_sims:
        n_simulations = int(env_sims)
    env_bs = os.environ.get("RL_MCTS_BATCH_SIZE")
    if env_bs:
        eval_batch_size = int(env_bs)

    # 大模拟量：切换批量模式
    if n_simulations >= 50:
        visit_pi = run_mcts_batched(
            net, device, sim,
            n_simulations=n_simulations,
            c_puct=c_puct,
            max_depth=max_depth,
            eval_batch_size=eval_batch_size,
            tree_state=tree_state,
            spawn_predictor=spawn_predictor,
        )
    elif tree_state is not None:
        visit_pi = run_mcts_reuse(
            tree_state, net, device, sim,
            n_simulations=n_simulations,
            c_puct=c_puct,
            max_depth=max_depth,
            gamma=gamma,
            spawn_predictor=spawn_predictor,
        )
    else:
        visit_pi = run_mcts(
            net, device, sim,
            n_simulations=n_simulations,
            c_puct=c_puct,
            max_depth=max_depth,
            gamma=gamma,
            spawn_predictor=spawn_predictor,
        )

    if visit_pi is None:
        return None
    eps = 1.0 / max(len(visit_pi) * 10, 100)
    q = np.log(visit_pi + eps)
    q -= q.mean()
    return q


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _extract_visit_pi(root: _MCTSNode, n_root: int) -> np.ndarray | None:
    counts = np.array(
        [root.children[i].N if i in root.children else 0 for i in range(n_root)],
        dtype=np.float32,
    )
    total = counts.sum()
    if total < 1e-6:
        return None
    return counts / total


# ---------------------------------------------------------------------------
# Zobrist hash 跨局持久化缓存（v8.2）
# ---------------------------------------------------------------------------

class ZobristHasher:
    """为棋盘+dock 组合状态计算 64-bit Zobrist hash。

    哈希将棋盘每个格子（空/占）与 dock 三槽占用情况编码为独立随机位串，
    最终通过 XOR 组合。用于在不同局之间识别「曾访问过的局面」。

    设计取舍
    --------
    - 棋盘只区分「空」与「非空」（不区分颜色），以提高跨局 hit 率。
    - dock 仅编码三槽的「有/无」，而非具体形状，保守但高效。
    - 不同形状 / 颜色的 dock 配置会产生不同 hash，可能错过部分复用机会，
      但杜绝了错误的节点复用（安全性优先）。
    """

    def __init__(self, grid_size: int = 8, seed: int = 0x5EED_BABE):
        rng = np.random.RandomState(seed)
        # table[row, col, 0=empty/1=occupied]
        self._grid_table: np.ndarray = rng.randint(
            1, 2**63, size=(grid_size, grid_size, 2), dtype=np.int64
        )
        # dock slot[0/1/2] × occupied[0/1]
        self._dock_table: np.ndarray = rng.randint(
            1, 2**63, size=(3, 2), dtype=np.int64
        )
        self.grid_size = grid_size

    def hash_state(self, grid_np: np.ndarray, dock) -> int:
        """计算 (grid, dock) 的 Zobrist hash。

        Parameters
        ----------
        grid_np : 2D numpy array, shape (H, W)；值 < 0 表示空格。
        dock    : 长度为 3 的序列，None 表示槽位为空。
        """
        h = np.int64(0)
        rows = min(grid_np.shape[0], self.grid_size)
        cols = min(grid_np.shape[1], self.grid_size)
        for r in range(rows):
            for c in range(cols):
                occupied = 0 if grid_np[r, c] < 0 else 1
                h ^= self._grid_table[r, c, occupied]
        for i, slot in enumerate(dock[:3]):
            occ = 0 if slot is None else 1
            h ^= self._dock_table[i, occ]
        return int(h)


class ZobristCache:
    """LRU 节点缓存：将 Zobrist hash 映射至 MCTS 根节点。

    跨局工作原理
    -----------
    每局结束后不清空本缓存。下一局开局时，``MCTSTreeState`` 查询
    初始局面 hash，若命中则以旧树（根节点）作为热启动根，
    已有的访问统计将被继续利用，而无需从零累积。

    缓存驱逐
    --------
    使用 LRU（最近最少使用）策略；容量超过 ``max_size`` 时驱逐最老条目。
    每个条目对应一整棵子树，内存占用随树规模变化，实践中 5000 节点通常 < 50 MB。
    """

    def __init__(self, hasher: ZobristHasher, max_size: int = 5000):
        self.hasher = hasher
        self.max_size = max_size
        self._lru: OrderedDict[int, _MCTSNode] = OrderedDict()
        self.hits: int = 0
        self.misses: int = 0

    # ------------------------------------------------------------------
    def lookup(self, grid_np: np.ndarray, dock) -> tuple[int, "_MCTSNode | None"]:
        """查找局面对应的缓存节点。返回 (hash_key, node_or_None)。"""
        key = self.hasher.hash_state(grid_np, dock)
        node = self._lru.get(key)
        if node is not None:
            self._lru.move_to_end(key)
            self.hits += 1
        else:
            self.misses += 1
        return key, node

    def store(self, key: int, node: "_MCTSNode") -> None:
        """存入缓存；超容量时驱逐最老条目。key 已存在时更新值并刷新 LRU 顺序。"""
        if key in self._lru:
            self._lru.move_to_end(key)
            self._lru[key] = node   # 更新为最新节点
        else:
            if len(self._lru) >= self.max_size:
                self._lru.popitem(last=False)
            self._lru[key] = node

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total > 0 else 0.0

    def stats(self) -> str:
        return (
            f"ZobristCache size={len(self._lru)}/{self.max_size} "
            f"hits={self.hits} misses={self.misses} "
            f"rate={self.hit_rate:.1%}"
        )


# ---------------------------------------------------------------------------
# 批量叶子节点评估（虚拟 loss 并行 MCTS）— v8.2
# ---------------------------------------------------------------------------

_VIRTUAL_LOSS_N = 1   # 虚拟 loss 额外访问计数

def _apply_virtual_loss(path: "list[tuple[_MCTSNode, int]]") -> None:
    """沿路径施加虚拟 loss：N+1，使同批次其他模拟不倾向于同一路径。"""
    for parent, a_idx in path:
        child = parent.children.get(a_idx)
        if child is not None:
            child.N += _VIRTUAL_LOSS_N


def _remove_virtual_loss(path: "list[tuple[_MCTSNode, int]]") -> None:
    """移除虚拟 loss；在真实反向传播后调用。"""
    for parent, a_idx in path:
        child = parent.children.get(a_idx)
        if child is not None:
            child.N = max(0, child.N - _VIRTUAL_LOSS_N)
            child.Q = child.W / child.N if child.N > 0 else 0.0


def _select_leaf_for_batch(
    root: "_MCTSNode",
    sim,
    net,
    device: "torch.device",
    c_puct: float,
    max_depth: int,
) -> "tuple[list[tuple[_MCTSNode, int]], np.ndarray | None, bool]":
    """Selection + Expansion（不做 GPU 评估），返回：

    - path      : [(parent_node, action_idx), ...]
    - leaf_feat : 叶子状态特征 numpy array，或 None（终局时）
    - is_term   : 是否为终局节点
    """
    node = root
    path: list[tuple[_MCTSNode, int]] = []
    depth = 0

    while not sim.is_terminal() and depth < max_depth:
        legal = sim.get_legal_actions()
        if not legal:
            break

        if not node.is_expanded:
            # 展开：用策略网络计算先验
            with torch.no_grad():
                s_np = extract_state_features(sim.grid, sim.dock)
                s_t = tensor_to_device(
                    torch.from_numpy(s_np).unsqueeze(0), device
                )
                logits = net.forward_policy(s_t).squeeze(0).cpu().numpy()
            n_legal = len(legal)
            block_logits = logits[:n_legal]
            priors = np.exp(block_logits - block_logits.max())
            priors /= priors.sum()
            for j, p in enumerate(priors):
                node.children[j] = _MCTSNode(prior=float(p))
            node.is_expanded = True
            node.n_legal = n_legal
            break   # 这是新叶子，停止 selection

        # UCB 选择
        pN = max(node.N, 1)
        best_i, best_sc = 0, -1e18
        for i in range(node.n_legal):
            child = node.children.get(i)
            if child is None:
                child = _MCTSNode()
                node.children[i] = child
            sc = _ucb_score(child, pN, c_puct)
            if sc > best_sc:
                best_sc = sc
                best_i = i

        best_i = min(best_i, len(legal) - 1)
        path.append((node, best_i))
        a = legal[best_i]
        sim.step(a["block_idx"], a["gx"], a["gy"])
        node = node.children.setdefault(best_i, _MCTSNode())
        depth += 1

    is_term = sim.is_terminal() or not sim.get_legal_actions()
    if is_term:
        return path, None, True
    leaf_feat = extract_state_features(sim.grid, sim.dock)
    return path, leaf_feat, False


def run_mcts_batched(
    net,
    device: "torch.device",
    sim,
    n_simulations: int = 100,
    c_puct: float = 1.5,
    max_depth: int = 8,
    eval_batch_size: int = 8,
    tree_state: "MCTSTreeState | None" = None,
    spawn_predictor: "SpawnPredictor | None" = None,
) -> "np.ndarray | None":
    """批量叶子节点评估 MCTS，适合 100+ 次模拟。

    相比 ``run_mcts``（每次模拟做 1 次 GPU forward），本函数将
    ``eval_batch_size`` 次模拟的叶子合并为一次 GPU forward，
    理论上将 GPU 传输/kernel 启动开销降低至原来的 1/eval_batch_size。

    虚拟 loss 机制使同批次模拟分散到不同子树，降低批内路径重叠率。

    Parameters
    ----------
    eval_batch_size : 每次 GPU 批推理包含的并行模拟数（建议 8~32）。
    tree_state      : 若提供，命中时从缓存根开始；结束后自动存回缓存。

    Returns
    -------
    归一化访问分布 visit_pi，长度 = 根节点合法动作数；失败返回 None。
    """
    # ---- 读取环境变量覆盖 ----
    env_sims = os.environ.get("RL_MCTS_SIMS")
    if env_sims:
        n_simulations = int(env_sims)
    env_cpuct = os.environ.get("RL_MCTS_CPUCT")
    if env_cpuct:
        c_puct = float(env_cpuct)
    env_depth = os.environ.get("RL_MCTS_MAX_DEPTH")
    if env_depth:
        max_depth = int(env_depth)
    env_bs = os.environ.get("RL_MCTS_BATCH_SIZE")
    if env_bs:
        eval_batch_size = int(env_bs)

    root_saved = sim.save_state()
    legal_root = sim.get_legal_actions()
    if not legal_root:
        return None

    # ---- 确定根节点 ----
    if tree_state is not None and tree_state.root is not None:
        root = tree_state.root
        already_done = root.N
        n_simulations = max(0, n_simulations - already_done)
    else:
        root = _MCTSNode()
        if tree_state is not None:
            tree_state.root = root

    if n_simulations <= 0:
        sim.restore_state(root_saved)
        return _extract_visit_pi(root, len(legal_root))

    # ---- 批量模拟 ----
    done = 0
    while done < n_simulations:
        batch = min(eval_batch_size, n_simulations - done)

        paths_list: list[list[tuple[_MCTSNode, int]]] = []
        feats_list: list[np.ndarray] = []
        term_flags: list[bool] = []
        leaf_feat_idx: list[int] = []   # 非终局样本在 feats_list 中的索引

        # Phase 1: selection（含虚拟 loss）
        for _ in range(batch):
            sim.restore_state(root_saved)
            path, feat, is_term = _select_leaf_for_batch(
                root, sim, net, device, c_puct, max_depth
            )
            paths_list.append(path)
            term_flags.append(is_term)
            if not is_term and feat is not None:
                leaf_feat_idx.append(len(feats_list))
                feats_list.append(feat)
            else:
                leaf_feat_idx.append(-1)
            # 施加虚拟 loss，使后续模拟分散
            _apply_virtual_loss(path)

        # Phase 2: 批量 GPU 推理（仅非终局叶子）
        values_arr: np.ndarray | None = None
        if feats_list:
            stacked = np.stack(feats_list, axis=0)           # (K, C, H, W)
            batch_t = tensor_to_device(
                torch.from_numpy(stacked), device
            )
            with torch.no_grad():
                if (
                    spawn_predictor is not None
                    and os.environ.get("RL_MCTS_STOCHASTIC", "0") not in ("0", "false")
                    and spawn_predictor.available
                ):
                    # 随机出块评估：对每个叶子单独调用（仍比逐次更便捷）
                    vals = []
                    for feat in feats_list:
                        sim.restore_state(root_saved)   # 近似恢复（不精确但快）
                        v = spawn_predictor.expected_value(sim, net, device, n_samples=2)
                        vals.append(v)
                    values_arr = np.array(vals, dtype=np.float32)
                else:
                    values_arr = (
                        net.forward_value(batch_t).cpu().numpy().flatten()
                    )

        # Phase 3: 移除虚拟 loss + 反向传播
        for idx, (path, is_term) in enumerate(zip(paths_list, term_flags)):
            _remove_virtual_loss(path)
            if is_term:
                v = 0.0
            else:
                fi = leaf_feat_idx[idx]
                v = float(values_arr[fi]) if (values_arr is not None and fi >= 0) else 0.0

            for parent, a_idx in reversed(path):
                child = parent.children.setdefault(a_idx, _MCTSNode())
                child.N += 1
                child.W += v
                child.Q = child.W / child.N
            root.N += 1

        done += batch

    sim.restore_state(root_saved)
    return _extract_visit_pi(root, len(legal_root))


# ---------------------------------------------------------------------------
# 跨进程共享转置表（SharedZobristTable）— v8.3
# ---------------------------------------------------------------------------

class SharedZobristTable:
    """无锁进程间共享转置表（transposition table）。

    使用 ``multiprocessing.shared_memory.SharedMemory`` 分配固定大小内存，
    所有 worker 进程通过 ``shm_name`` 附加到同一内存块，
    **无需 IPC 消息传递**即可读写节点统计（N、Q）。

    数据格式（每槽 8 字节）
    ----------------------
    offset 0-3  : uint32  — hash key 低 32 位（快速冲突检测）
    offset 4-5  : uint16  — N（访问次数，上限 65535）
    offset 6-7  : float16 — Q（平均价值；-1~1 精度足够）

    索引策略
    --------
    ``slot_idx = key % n_slots``（取模映射），冲突时直接覆盖（近似 LRU）。
    对热启动而言大致正确的 Q 值已足够，轻微覆盖不影响安全性。

    写入竞争
    --------
    不加锁：极少数槽位出现并发写入时，N/Q 可能暂时不一致，但不会崩溃。
    这是引擎设计的标准工程取舍（棋类引擎普遍采用无锁转置表）。

    典型内存占用
    -----------
    8192 slots × 8 B = 64 KB；65536 slots × 8 B = 512 KB。

    生命周期
    --------
    主进程调用 ``create()`` 建表 → 将 ``.name`` 和 ``.n_slots`` 传给 worker →
    worker 调用 ``attach()`` 连接 → 程序结束主进程调用 ``close_and_unlink()``。
    """

    SLOT_BYTES = 8
    _DTYPE = np.dtype([
        ("key32", np.uint32),
        ("N",     np.uint16),
        ("Q",     np.float16),
    ])  # 合计 8 bytes/slot

    def __init__(self, n_slots: int, shm):
        self.n_slots = n_slots
        self._shm = shm
        self._table: np.ndarray = np.frombuffer(shm.buf, dtype=self._DTYPE)
        self.name: str = shm.name

    # ------------------------------------------------------------------
    @classmethod
    def create(cls, n_slots: int = 8192) -> "SharedZobristTable":
        """主进程调用：分配新共享内存并清零。"""
        from multiprocessing.shared_memory import SharedMemory
        shm = SharedMemory(create=True, size=n_slots * cls.SLOT_BYTES)
        # 清零（key=0 表示空槽；hash=0 的冲突极低概率且无害）
        np.frombuffer(shm.buf, dtype=np.uint8)[:] = 0
        return cls(n_slots, shm)

    @classmethod
    def attach(cls, shm_name: str, n_slots: int) -> "SharedZobristTable":
        """Worker 进程调用：附加到已有共享内存。"""
        from multiprocessing.shared_memory import SharedMemory
        shm = SharedMemory(create=False, name=shm_name)
        return cls(n_slots, shm)

    # ------------------------------------------------------------------
    def _idx(self, key: int) -> int:
        return key % self.n_slots

    def lookup(self, key: int) -> "tuple[int, float] | None":
        """返回 (N, Q) 或 None（未命中/hash 冲突）。"""
        idx = self._idx(key)
        slot = self._table[idx]
        if int(slot["key32"]) != (key & 0xFFFFFFFF):
            return None
        n = int(slot["N"])
        if n == 0:
            return None
        return n, float(slot["Q"])

    def store(self, key: int, n: int, q: float) -> None:
        """写入统计数据；冲突时直接覆盖。"""
        idx = self._idx(key)
        self._table[idx] = (key & 0xFFFFFFFF, min(n, 65535), np.float16(q))

    def close(self) -> None:
        """释放本进程对共享内存的引用（不删除，worker 和主进程均需调用）。"""
        try:
            del self._table   # 先释放 numpy buffer 引用
        except Exception:
            pass
        try:
            self._shm.close()
        except Exception:
            pass

    def close_and_unlink(self) -> None:
        """主进程调用：关闭并删除共享内存段。"""
        try:
            del self._table
        except Exception:
            pass
        try:
            self._shm.close()
            self._shm.unlink()
        except Exception:
            pass

    def stats(self) -> str:
        occupied = int((self._table["key32"] != 0).sum())
        return f"SharedZobristTable name={self.name} slots={occupied}/{self.n_slots}"


# ---------------------------------------------------------------------------
# ZobristCache ← SharedZobristTable 整合
# （在已有 ZobristCache 类上增加共享表感知）
# ---------------------------------------------------------------------------

def _make_zobrist_cache_with_shared(
    hasher: ZobristHasher,
    local_size: int = 5000,
    shared_table: "SharedZobristTable | None" = None,
) -> ZobristCache:
    """构建 ZobristCache，可选附加 SharedZobristTable 作为二级跨进程缓存。

    读取顺序：本地 LRU（full subtree） → 共享表（N+Q 统计热启动）。
    写入：同时更新本地 LRU 和共享表。
    """
    cache = ZobristCache(hasher, max_size=local_size)
    cache._shared_table = shared_table  # type: ignore[attr-defined]
    return cache


def _zobrist_cache_lookup_with_shared(
    cache: ZobristCache,
    grid_np: np.ndarray,
    dock,
) -> "tuple[int, _MCTSNode | None]":
    """感知共享表的 lookup：本地未命中时查共享表做 N/Q 热启动。"""
    key, node = cache.lookup(grid_np, dock)
    if node is not None:
        return key, node

    shared: SharedZobristTable | None = getattr(cache, "_shared_table", None)
    if shared is None:
        return key, None

    result = shared.lookup(key)
    if result is None:
        return key, None

    n_cached, q_cached = result
    # 从共享表恢复：创建一个携带历史统计的「虚」根节点
    hot_node = _MCTSNode()
    hot_node.N = n_cached
    hot_node.W = q_cached * n_cached
    hot_node.Q = q_cached
    # 存入本地 LRU，后续步可复用
    cache.store(key, hot_node)
    cache.hits += 1
    cache.misses = max(0, cache.misses - 1)   # 补偿 lookup 里的 misses++
    return key, hot_node


def _zobrist_cache_flush_with_shared(
    cache: ZobristCache,
    key: int,
    node: "_MCTSNode",
) -> None:
    """感知共享表的 flush：同时写本地 LRU 和共享表。"""
    cache.store(key, node)
    shared: SharedZobristTable | None = getattr(cache, "_shared_table", None)
    if shared is not None and node.N > 0:
        shared.store(key, node.N, node.Q)


# ---------------------------------------------------------------------------
# 渐进式模拟次数（adaptive sims）— v8.3
# ---------------------------------------------------------------------------

def run_mcts_adaptive(
    net,
    device: "torch.device",
    sim,
    min_sims: int = 10,
    max_sims: int = 100,
    confidence_ratio: float = 3.0,
    check_interval: int = 10,
    c_puct: float = 1.5,
    max_depth: int = 8,
    gamma: float = 0.99,
    eval_batch_size: int = 8,
    tree_state: "MCTSTreeState | None" = None,
    spawn_predictor: "SpawnPredictor | None" = None,
) -> "tuple[np.ndarray | None, int]":
    """渐进式 MCTS：根据局面不确定性动态调整模拟次数。

    算法
    ----
    1. 先运行 ``min_sims`` 次模拟（批量或单步，取决于 min_sims 大小）。
    2. 每 ``check_interval`` 次检查一次收敛：
       若 ``visits[top1] / visits[top2] >= confidence_ratio``，提前停止。
    3. 否则继续，直到达到 ``max_sims``。

    收敛判定
    --------
    ``confidence_ratio``：第一名与第二名访问次数之比。
    - ratio=3.0：第一名访问数 ≥ 第二名的 3 倍时视为「局面明朗」，提前退出。
    - ratio=2.0：更激进（节省开销）；ratio=5.0：更保守（精度更高）。

    环境变量覆盖
    ------------
    - ``RL_MCTS_MIN_SIMS``  : 最小模拟次数
    - ``RL_MCTS_MAX_SIMS``  : 最大模拟次数（覆盖 max_sims；若设置此值则也覆盖 RL_MCTS_SIMS）
    - ``RL_MCTS_CONFIDENCE`` : confidence_ratio

    Returns
    -------
    (visit_pi, sims_used) — 归一化访问分布 + 实际使用的模拟次数。
    """
    env_min = os.environ.get("RL_MCTS_MIN_SIMS")
    if env_min:
        min_sims = int(env_min)
    env_max = os.environ.get("RL_MCTS_MAX_SIMS")
    if env_max:
        max_sims = int(env_max)
    env_conf = os.environ.get("RL_MCTS_CONFIDENCE")
    if env_conf:
        confidence_ratio = float(env_conf)
    env_cpuct = os.environ.get("RL_MCTS_CPUCT")
    if env_cpuct:
        c_puct = float(env_cpuct)
    env_depth = os.environ.get("RL_MCTS_MAX_DEPTH")
    if env_depth:
        max_depth = int(env_depth)
    env_bs = os.environ.get("RL_MCTS_BATCH_SIZE")
    if env_bs:
        eval_batch_size = int(env_bs)

    root_saved = sim.save_state()
    legal_root = sim.get_legal_actions()
    if not legal_root:
        return None, 0
    n_legal = len(legal_root)

    # 决定根节点
    if tree_state is not None and tree_state.root is not None:
        root = tree_state.root
        already_done = root.N
    else:
        root = _MCTSNode()
        if tree_state is not None:
            tree_state.root = root
        already_done = 0

    def _run_batch(n: int) -> None:
        """执行 n 次模拟（批量或单步）。"""
        if n <= 0:
            return
        use_batch = n >= 8
        if use_batch:
            bs = min(eval_batch_size, n)
            done = 0
            while done < n:
                batch = min(bs, n - done)
                paths_list, feats_list, term_flags, leaf_feat_idx = [], [], [], []
                for _ in range(batch):
                    sim.restore_state(root_saved)
                    path, feat, is_term = _select_leaf_for_batch(
                        root, sim, net, device, c_puct, max_depth
                    )
                    paths_list.append(path)
                    term_flags.append(is_term)
                    if not is_term and feat is not None:
                        leaf_feat_idx.append(len(feats_list))
                        feats_list.append(feat)
                    else:
                        leaf_feat_idx.append(-1)
                    _apply_virtual_loss(path)

                values_arr = None
                if feats_list:
                    stacked = np.stack(feats_list, axis=0)
                    batch_t = tensor_to_device(torch.from_numpy(stacked), device)
                    with torch.no_grad():
                        values_arr = net.forward_value(batch_t).cpu().numpy().flatten()

                for idx, (path, is_term) in enumerate(zip(paths_list, term_flags)):
                    _remove_virtual_loss(path)
                    fi = leaf_feat_idx[idx]
                    v = 0.0 if is_term else (float(values_arr[fi]) if values_arr is not None and fi >= 0 else 0.0)
                    for parent, a_idx in reversed(path):
                        child = parent.children.setdefault(a_idx, _MCTSNode())
                        child.N += 1
                        child.W += v
                        child.Q = child.W / child.N
                    root.N += 1
                done += batch
        else:
            for _ in range(n):
                sim.restore_state(root_saved)
                _simulate(root, sim, net, device, c_puct, max_depth,
                          spawn_predictor=spawn_predictor, gamma=gamma)

    def _confidence() -> float:
        """计算当前 top1/top2 访问比；根动作数 < 2 时返回无穷大。"""
        counts = [root.children[i].N if i in root.children else 0 for i in range(n_legal)]
        sorted_counts = sorted(counts, reverse=True)
        if len(sorted_counts) < 2 or sorted_counts[1] == 0:
            return float("inf")
        return sorted_counts[0] / sorted_counts[1]

    # Step 1: 运行最小模拟数（扣除已有统计）
    initial_n = max(0, min_sims - already_done)
    _run_batch(initial_n)
    total_used = already_done + initial_n

    # Step 2: 渐进扩增，每 check_interval 次检查一次收敛
    while total_used < max_sims:
        if _confidence() >= confidence_ratio:
            break   # 提前收敛
        increment = min(check_interval, max_sims - total_used)
        _run_batch(increment)
        total_used += increment

    sim.restore_state(root_saved)
    return _extract_visit_pi(root, n_legal), total_used


