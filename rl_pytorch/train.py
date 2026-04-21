"""
自博弈 + PPO / REINFORCE 策略梯度，PyTorch — v5 直接监督重构。

v5 核心改动（修复不收敛根因）：
  - 纯 outcome 价值目标：V 学习预测 final_score/threshold（低方差、无信用分配问题）
  - 三个直接监督辅助损失（每步即时梯度，不依赖稀疏 MC returns）：
    board_quality_loss: MSE，回归 board_potential（棋盘结构质量）
    feasibility_loss:   BCE，预测"剩余 dock 块是否全部可放"
    survival_loss:      MSE，回归 steps_to_end / 30（生存预期）
  - 精简奖励：仅保留得分增量 + 势函数塑形 + 胜利奖励；
    placeBonus / holePenalty / heightPenalty 等噪声项已移除
  - DockBoardAttention（conv-shared 架构）：dock 块对棋盘 CNN 特征做交叉注意力
  - 保留 v4 的 clear_pred / hole_aux / PPO / LR warmup / value clip

--device：``auto`` | ``cpu`` | ``mps`` | ``cuda`` | ``cuda:N``
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path
from typing import Union

from . import torch_env  # noqa: F401 — 须在 import torch 之前（NNPACK 警告 / CPU 环境）

import numpy as np
import torch
import torch.nn.functional as F
from torch.distributions import Categorical, Dirichlet

from .config import WIN_SCORE_THRESHOLD
from .game_rules import (
    FEATURE_ENCODING,
    RL_REWARD_SHAPING,
    rl_curriculum_enabled,
    rl_win_threshold_for_episode,
    rl_adaptive_curriculum_config,
    rl_win_threshold_from_virtual_ep,
)
from .device import (
    adam_for_training,
    apply_cpu_training_tuning,
    apply_throughput_tuning,
    device_summary_line,
    maybe_mps_synchronize,
    resolve_cuda_device_ids_for_data_parallel,
    resolve_training_device,
    tensor_to_device,
)
from .features import PHI_DIM, STATE_FEATURE_DIM, build_phi_batch, extract_state_features
from .model import (
    ConvSharedPolicyValueNet,
    LightPolicyValueNet,
    LightSharedPolicyValueNet,
    PolicyValueNet,
    SharedPolicyValueNet,
)
from .simulator import OpenBlockSimulator, board_potential, _BOARD_POT_NORM, _SURVIVAL_NORM

# ---------------------------------------------------------------------------
# 多进程 worker（CPU 推理采集，GPU 专做更新）
# ---------------------------------------------------------------------------
_pool_net: AnyNet | None = None
_pool_device = torch.device("cpu")


def _pool_worker_init(arch: str, width: int, pd: int, vd: int, mr: float, cc: int = 32):
    """每个 worker 进程初始化一份模型（CPU）。"""
    global _pool_net, _pool_device
    _pool_net = build_policy_net(arch, width, pd, vd, mr, _pool_device, conv_channels=cc)
    _pool_net.eval()


def _pool_worker_collect(args: tuple) -> list[dict]:
    """Worker：加载最新权重 → 采集若干局 → 返回轨迹。

    config tuple: (global_ep, temp_floor, explore_first_moves, explore_temp_mult,
                   dirichlet_epsilon, dirichlet_alpha, win_threshold_override)
    第 7 个元素 win_threshold_override 为可选（None 表示使用线性课程）。
    """
    global _pool_net, _pool_device
    state_dict, configs = args
    _pool_net.load_state_dict(state_dict)
    return [
        collect_episode(
            _pool_net, _pool_device,
            cfg[0], cfg[1], cfg[2], cfg[3], cfg[4], cfg[5],
            win_threshold_override=cfg[6] if len(cfg) > 6 else None,
        )
        for cfg in configs
    ]


def _normalize_advantages(adv: torch.Tensor, min_std: float = 1e-4) -> torch.Tensor:
    adv = torch.nan_to_num(adv, nan=0.0, posinf=0.0, neginf=0.0)
    adv = torch.clamp(adv, -500.0, 500.0)
    if adv.numel() < 2:
        return torch.clamp(adv, -30.0, 30.0)
    std = adv.std(unbiased=False)
    if float(std) < min_std:
        return torch.clamp(adv, -30.0, 30.0)
    out = (adv - adv.mean()) / (std + 1e-8)
    return torch.clamp(out, -30.0, 30.0)


def _clamp_log_probs_pg(log_probs: torch.Tensor) -> torch.Tensor:
    x = torch.nan_to_num(log_probs, nan=0.0, posinf=0.0, neginf=-50.0)
    return x.clamp(min=-50.0, max=0.0)


AnyNet = Union[PolicyValueNet, SharedPolicyValueNet, LightPolicyValueNet, LightSharedPolicyValueNet, ConvSharedPolicyValueNet]


class _ValueForward(torch.nn.Module):
    """供 ``data_parallel`` 仅前向价值头（与主网共享参数）。"""

    def __init__(self, net: AnyNet):
        super().__init__()
        self.net = net

    def forward(self, state_feat: torch.Tensor) -> torch.Tensor:
        return self.net.forward_value(state_feat)


class _TrunkForward(torch.nn.Module):
    """供 ``data_parallel`` 切分共享主干 batch（与主网共享参数）。"""

    def __init__(self, net: AnyNet):
        super().__init__()
        self.net = net

    def forward(self, state_feat: torch.Tensor) -> torch.Tensor:
        return self.net.forward_trunk(state_feat)


def _checkpoint_meta(
    net: AnyNet,
    device: torch.device,
    gamma: float,
    lr: float,
    arch: str,
    mlp_ratio: float,
    policy_depth: int,
    value_depth: int,
) -> dict:
    meta: dict = {
        "gamma": gamma,
        "lr": lr,
        "device": str(device),
        "phi_dim": PHI_DIM,
        "state_dim": STATE_FEATURE_DIM,
        "arch": arch,
    }
    if isinstance(net, ConvSharedPolicyValueNet):
        meta["width"] = net.width
        meta["conv_channels"] = net.conv_channels
        meta["action_embed_dim"] = net.action_embed_dim
    elif isinstance(net, LightSharedPolicyValueNet):
        meta["width"] = net.width
        meta["action_embed_dim"] = net.action_embed_dim
    elif isinstance(net, LightPolicyValueNet):
        meta["width"] = net.policy_fc1.out_features
    elif isinstance(net, SharedPolicyValueNet):
        meta["width"] = int(net.shared_stem.out_features)
        meta["shared_depth"] = len(net.shared_blocks)
        meta["policy_depth"] = policy_depth
        meta["value_depth"] = value_depth
        meta["mlp_ratio"] = mlp_ratio
    else:
        meta["width"] = int(net.policy_stem.out_features)
        meta["policy_depth"] = len(net.policy_blocks)
        meta["value_depth"] = len(net.value_blocks)
        meta["mlp_ratio"] = mlp_ratio
    return meta


def build_policy_net(
    arch: str,
    width: int,
    policy_depth: int,
    value_depth: int,
    mlp_ratio: float,
    device: torch.device,
    conv_channels: int = 32,
    use_point_encoder: bool = False,
) -> AnyNet:
    arch = (arch or "conv-shared").lower()
    if arch == "conv-shared":
        return ConvSharedPolicyValueNet(
            width=width,
            conv_channels=conv_channels,
            use_point_encoder=use_point_encoder,
        ).to(device)
    if arch == "light-shared":
        return LightSharedPolicyValueNet(width=width).to(device)
    if arch == "light":
        return LightPolicyValueNet(width=width).to(device)
    if arch == "shared":
        return SharedPolicyValueNet(
            width=width,
            shared_depth=policy_depth,
            mlp_ratio=mlp_ratio,
        ).to(device)
    return PolicyValueNet(
        width=width,
        policy_depth=policy_depth,
        value_depth=value_depth,
        mlp_ratio=mlp_ratio,
    ).to(device)


def _clear_pred_coef() -> float:
    if (raw := os.environ.get("RL_CLEAR_PRED_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("clearPredLossCoef") or 0.15)


def _outcome_value_mix() -> float:
    """v5 默认 1.0（纯 outcome 价值目标）。"""
    ocfg = RL_REWARD_SHAPING.get("outcomeValueMix") or {}
    if (raw := os.environ.get("RL_OUTCOME_VALUE_MIX", "").strip()) != "":
        return float(raw)
    if not ocfg.get("enabled", False):
        return 1.0
    return float(ocfg.get("mix", 1.0))


def _board_quality_coef() -> float:
    if (raw := os.environ.get("RL_BQ_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("boardQualityLossCoef") or 0.5)


def _feasibility_coef() -> float:
    if (raw := os.environ.get("RL_FEAS_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("feasibilityLossCoef") or 0.3)


def _survival_coef() -> float:
    if (raw := os.environ.get("RL_SURV_COEF", "").strip()) != "":
        return float(raw)
    return float(RL_REWARD_SHAPING.get("survivalLossCoef") or 0.2)


def _q_distill_coef() -> float:
    """Q 分布蒸馏损失系数；来自 rlRewardShaping.qDistillation.coef 或 RL_Q_DISTILL_COEF。"""
    if (raw := os.environ.get("RL_Q_DISTILL_COEF", "").strip()) != "":
        return float(raw)
    cfg = RL_REWARD_SHAPING.get("qDistillation") or {}
    if not cfg.get("enabled", False):
        return 0.0
    return float(cfg.get("coef", 0.1))


def _q_distill_tau() -> float:
    """Q → target_pi 的软化温度；越小分布越尖锐，越大越均匀。"""
    if (raw := os.environ.get("RL_Q_DISTILL_TAU", "").strip()) != "":
        return float(raw)
    cfg = RL_REWARD_SHAPING.get("qDistillation") or {}
    return float(cfg.get("tau", 1.0))


def _lr_warmup(step: int, warmup_steps: int, base_lr: float) -> float:
    if warmup_steps <= 0 or step >= warmup_steps:
        return base_lr
    return base_lr * (step + 1) / warmup_steps


def _hole_aux_coef_and_denom() -> tuple[float, float]:
    """空洞辅助损失：系数来自 rlRewardShaping.holeAuxLossCoef 或 RL_HOLE_AUX_COEF；目标除以 holeAuxTargetMax / maxHoles。"""
    if (raw := os.environ.get("RL_HOLE_AUX_COEF", "").strip()) != "":
        coef = float(raw)
    else:
        coef = float(RL_REWARD_SHAPING.get("holeAuxLossCoef") or 0.0)
    raw_max = RL_REWARD_SHAPING.get("holeAuxTargetMax")
    if raw_max is not None:
        denom = float(raw_max)
    else:
        denom = float((FEATURE_ENCODING.get("actionNorm") or {}).get("maxHoles") or 16.0)
    return coef, max(denom, 1e-6)


def _effective_entropy_coef(global_ep: int, base: float) -> float:
    """随局数线性降低熵系数；衰减周期与课程爬坡对齐。"""
    lo = float(os.environ.get("RL_ENTROPY_COEF_MIN", "0.008"))
    span = float(os.environ.get("RL_ENTROPY_DECAY_EPISODES", "60000"))
    if span <= 0 or base <= lo:
        return base
    t = min(1.0, max(0, global_ep) / span)
    return base - (base - lo) * t


def _dirichlet_epsilon_for_ep(global_ep: int, base: float) -> float:
    """随训练局数降低 Dirichlet 混合权重，减轻后期无效探索（可用 RL_DIRICHLET_DECAY_EPISODES=0 关闭衰减）。"""
    span = float(os.environ.get("RL_DIRICHLET_DECAY_EPISODES", "25000"))
    end = float(os.environ.get("RL_DIRICHLET_EPS_END", "0.06"))
    if span <= 0 or base <= end:
        return base
    t = min(1.0, max(0, global_ep - 1) / span)
    return end + (base - end) * (1.0 - t)


def _temperature_for_move(global_ep: int, step_idx: int, temp_floor: float, explore_first_moves: int, explore_mult: float) -> float:
    decay_rate = float(os.environ.get("RL_TEMP_DECAY_RATE", "0.00005"))
    base = max(temp_floor, 1.0 - global_ep * decay_rate)
    if explore_first_moves > 0 and step_idx < explore_first_moves:
        base *= explore_mult
    return max(temp_floor, base)


def _mix_dirichlet_and_sample(
    logits: torch.Tensor,
    temperature: float,
    dirichlet_epsilon: float,
    dirichlet_alpha: float,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
    if temperature > 1e-6:
        logits = logits / temperature
    probs = F.softmax(logits, dim=-1)
    n = probs.shape[0]
    if dirichlet_epsilon > 1e-8 and dirichlet_alpha > 1e-8 and n > 0:
        conc = max(1e-4, float(dirichlet_alpha) / max(n, 1))
        conc_t = torch.full((n,), conc, dtype=logits.dtype)
        # PyTorch MPS 未实现 Dirichlet 采样，CPU 采样后拷回
        if logits.device.type == "mps":
            d = Dirichlet(conc_t.cpu())
            noise = d.sample().to(logits.device, dtype=logits.dtype)
        else:
            d = Dirichlet(conc_t.to(logits.device))
            noise = d.sample()
        probs = (1.0 - dirichlet_epsilon) * probs + dirichlet_epsilon * noise
        probs = probs / probs.sum().clamp_min(1e-10)
    dist = Categorical(probs=probs.clamp_min(1e-10))
    idx = dist.sample()
    log_p = dist.log_prob(idx)
    ent = dist.entropy()
    return idx, log_p, ent


def compute_gae_advantages_and_returns(
    rewards: list[float],
    values: torch.Tensor,
    gamma: float,
    lam: float,
    device: torch.device,
) -> tuple[torch.Tensor, torch.Tensor]:
    """GAE(λ)；returns = adv + V(s) 作为价值头目标。"""
    t = len(rewards)
    if t == 0:
        z = torch.zeros(0, device=device, dtype=torch.float32)
        return z, z
    r = tensor_to_device(torch.tensor(rewards, dtype=torch.float32), device)
    v = values.detach().reshape(-1)[:t]
    if v.shape[0] < t:
        v = F.pad(v, (0, t - v.shape[0]))
    next_v = torch.zeros(t, device=device, dtype=torch.float32)
    if t > 1:
        next_v[:-1] = v[1:]
    deltas = r + gamma * next_v - v
    adv = torch.zeros(t, device=device, dtype=torch.float32)
    gae_acc = 0.0
    for i in range(t - 1, -1, -1):
        gae_acc = float(deltas[i].item()) + gamma * lam * gae_acc
        adv[i] = gae_acc
    rets = adv + v
    return adv, rets


def _lookahead_q_values(
    net: AnyNet,
    device: torch.device,
    sim: OpenBlockSimulator,
    legal: list[dict],
    gamma: float,
) -> np.ndarray | None:
    """1-step lookahead: Q(s,a) = r(s,a) + γ·V(s')。

    对每个合法动作模拟一步，评估后继状态的 V(s')。
    返回 Q 值数组；若动作数过多（>150）则跳过以节约时间。
    """
    n_actions = len(legal)
    if n_actions == 0 or n_actions > 150:
        return None

    saved = sim.save_state()
    rewards = np.empty(n_actions, dtype=np.float32)
    next_states = np.empty((n_actions, STATE_FEATURE_DIM), dtype=np.float32)

    for i, a in enumerate(legal):
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
        rewards[i] = r
        next_states[i] = extract_state_features(sim.grid, sim.dock)
        sim.restore_state(saved)

    with torch.no_grad():
        ns_t = tensor_to_device(torch.from_numpy(next_states), device)
        v_next = net.forward_value(ns_t).cpu().numpy()

    return rewards + gamma * v_next


def _beam_2ply_q_values(
    net: AnyNet,
    device: torch.device,
    sim: OpenBlockSimulator,
    legal: list[dict],
    gamma: float,
    top_k: int = 15,
    max_actions: int = 100,
) -> np.ndarray | None:
    """三块组合 2-ply beam 搜索：Q_2ply(s,a1) = r1 + γ · max_{a2}[r2 + γ·V(s'')]。

    针对 Block Puzzle 一轮三块的强耦合特性——当 dock 仍有 ≥2 块时，展开第二层
    以捕捉跨块放置的协同效应。具体流程：

      1. 第一层（全部动作）：计算 r1 + γ·V(s') → Q_1ply
      2. 按 Q_1ply 选出 top-k 动作做第二层展开
      3. 第二层所有 s'' 合并批量推理（单次 GPU forward），避免循环内多次调用
      4. 其余动作保持 Q_1ply 值（退化为 1-step）

    Guard 条件：
      - n_actions > max_actions：直接返回 None（同 1-step 的 >150 保护）
      - dock 剩余块 < 2：退化为 1-step lookahead（2-ply 无意义）
    """
    n_actions = len(legal)
    if n_actions == 0 or n_actions > max_actions:
        return None

    # dock 仅剩 ≤1 块时，2-ply 无额外信息，退化为 1-step
    blocks_remain = sum(1 for s in sim.dock if s is not None)
    if blocks_remain < 2:
        return _lookahead_q_values(net, device, sim, legal, gamma)

    saved = sim.save_state()

    # ——— 第一层：计算所有动作的 r1 + V(s') ———
    r1_arr = np.empty(n_actions, dtype=np.float32)
    next_states = np.empty((n_actions, STATE_FEATURE_DIM), dtype=np.float32)
    for i, a in enumerate(legal):
        r1_arr[i] = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
        next_states[i] = extract_state_features(sim.grid, sim.dock)
        sim.restore_state(saved)

    with torch.no_grad():
        ns_t = tensor_to_device(torch.from_numpy(next_states), device)
        v1 = net.forward_value(ns_t).cpu().numpy().flatten()

    q1 = r1_arr + gamma * v1
    q2ply = q1.copy()

    # ——— 第二层：对 top-k 批量收集所有 s'' 再统一推理 ———
    top_k_actual = min(top_k, n_actions)
    top_k_idxs = np.argsort(q1)[-top_k_actual:]

    # 结构：(action_index, r1, r2_arr, ns2_states)
    ply2_batches: list[tuple[int, float, np.ndarray, np.ndarray]] = []

    for i in top_k_idxs:
        a1 = legal[int(i)]
        r1 = float(sim.step(a1["block_idx"], a1["gx"], a1["gy"]))
        legal2 = sim.get_legal_actions()

        if not legal2:
            q2ply[i] = r1  # 第一步后已终局，V=0
            sim.restore_state(saved)
            continue

        n2 = len(legal2)
        saved2 = sim.save_state()
        r2_arr = np.empty(n2, dtype=np.float32)
        ns2 = np.empty((n2, STATE_FEATURE_DIM), dtype=np.float32)
        for j, a2 in enumerate(legal2):
            r2_arr[j] = float(sim.step(a2["block_idx"], a2["gx"], a2["gy"]))
            ns2[j] = extract_state_features(sim.grid, sim.dock)
            sim.restore_state(saved2)

        ply2_batches.append((int(i), r1, r2_arr, ns2))
        sim.restore_state(saved)

    if ply2_batches:
        # 合并所有 s'' 做一次批量 V 推理
        all_ns2 = np.concatenate([b[3] for b in ply2_batches], axis=0)
        with torch.no_grad():
            ns2_t = tensor_to_device(torch.from_numpy(all_ns2), device)
            all_v2 = net.forward_value(ns2_t).cpu().numpy().flatten()

        offset = 0
        for (i, r1, r2_arr, _ns2) in ply2_batches:
            n2 = len(r2_arr)
            v2 = all_v2[offset : offset + n2]
            q2ply[i] = r1 + gamma * float(np.max(r2_arr + gamma * v2))
            offset += n2

    return q2ply


def _beam_3ply_q_values(
    net: AnyNet,
    device: torch.device,
    sim: OpenBlockSimulator,
    legal: list[dict],
    gamma: float,
    top_k: int = 15,
    max_actions: int = 100,
    top_k2: int = 5,
    max_actions2: int = 50,
) -> np.ndarray | None:
    """三块全排列 3-ply beam：Q_3ply(s,a1) = r1+γ·max_{a2}[r2+γ·max_{a3}[r3+γ·V(s''')]].

    扩展 2-ply：对 top_k 中的每个 a1，再对 top_k2 个 a2 展开第三层，
    全部 s''' 合并一次批量 V 推理。

    Guard 条件：
      - dock 剩余块 < 3：退化为 2-ply（仍有意义）或 1-step（仅 1 块时）
      - n_actions > max_actions：直接返回 None
    """
    n_actions = len(legal)
    if n_actions == 0 or n_actions > max_actions:
        return None

    blocks_remain = sum(1 for s in sim.dock if s is not None)
    if blocks_remain < 3:
        # 退化为 2-ply（或 1-step）
        return _beam_2ply_q_values(net, device, sim, legal, gamma, top_k, max_actions)

    saved = sim.save_state()

    # ——— 第一层：计算所有动作的 r1 + V(s') ———
    r1_arr = np.empty(n_actions, dtype=np.float32)
    next_states = np.empty((n_actions, STATE_FEATURE_DIM), dtype=np.float32)
    for i, a in enumerate(legal):
        r1_arr[i] = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
        next_states[i] = extract_state_features(sim.grid, sim.dock)
        sim.restore_state(saved)

    with torch.no_grad():
        ns_t = tensor_to_device(torch.from_numpy(next_states), device)
        v1 = net.forward_value(ns_t).cpu().numpy().flatten()

    q1 = r1_arr + gamma * v1
    q3ply = q1.copy()

    top_k_actual = min(top_k, n_actions)
    top_k_idxs = np.argsort(q1)[-top_k_actual:]

    # ——— 第二 / 三层批量收集 ———
    # ply3_items: (a1_idx, r1, a2_idx_local, r2, ns3_states_2d)
    ply2_best: dict[int, tuple[float, np.ndarray, np.ndarray]] = {}  # a1→(r1, r2_arr, ns2)

    for i in top_k_idxs:
        a1 = legal[int(i)]
        r1 = float(sim.step(a1["block_idx"], a1["gx"], a1["gy"]))
        legal2 = sim.get_legal_actions()

        if not legal2 or len(legal2) > max_actions2:
            q3ply[i] = r1
            sim.restore_state(saved)
            continue

        n2 = len(legal2)
        saved2 = sim.save_state()
        r2_arr = np.empty(n2, dtype=np.float32)
        ns2 = np.empty((n2, STATE_FEATURE_DIM), dtype=np.float32)
        for j, a2 in enumerate(legal2):
            r2_arr[j] = float(sim.step(a2["block_idx"], a2["gx"], a2["gy"]))
            ns2[j] = extract_state_features(sim.grid, sim.dock)
            sim.restore_state(saved2)

        ply2_best[int(i)] = (r1, r2_arr, ns2)
        sim.restore_state(saved)

    if not ply2_best:
        return q3ply

    # ——— 第二层 V 批量推理（确定 top_k2 ）———
    all_ns2_concat = np.concatenate([v[2] for v in ply2_best.values()], axis=0)
    with torch.no_grad():
        ns2_t = tensor_to_device(torch.from_numpy(all_ns2_concat), device)
        all_v2 = net.forward_value(ns2_t).cpu().numpy().flatten()

    # ply3_batches: (a1_idx, r1, r2, ns3_block)
    ply3_batches: list[tuple[int, float, float, np.ndarray]] = []
    v2_offset = 0
    q2_map: dict[int, tuple[float, np.ndarray]] = {}  # a1→(r1, q2_arr)
    for i, (r1, r2_arr, ns2) in ply2_best.items():
        n2 = len(r2_arr)
        v2 = all_v2[v2_offset: v2_offset + n2]
        q2_arr = r2_arr + gamma * v2
        q2_map[i] = (r1, q2_arr)
        v2_offset += n2

    # 对每个 a1，选 top_k2 个 a2 展开第三层
    for i, (r1, q2_arr) in q2_map.items():
        n2 = len(q2_arr)
        top_k2_actual = min(top_k2, n2)
        top2_idxs = np.argsort(q2_arr)[-top_k2_actual:]

        # 需要重新模拟以收集 ns3
        a1 = legal[i]
        sim.step(a1["block_idx"], a1["gx"], a1["gy"])
        legal2_cur = sim.get_legal_actions()
        if not legal2_cur:
            q3ply[i] = r1
            sim.restore_state(saved)
            continue

        saved2 = sim.save_state()
        for j in top2_idxs:
            if j >= len(legal2_cur):
                sim.restore_state(saved2)
                continue
            a2 = legal2_cur[j]
            r2_val = float(sim.step(a2["block_idx"], a2["gx"], a2["gy"]))
            legal3 = sim.get_legal_actions()

            if not legal3:
                ply3_batches.append((i, r1, r2_val, np.empty((0, STATE_FEATURE_DIM), dtype=np.float32)))
                sim.restore_state(saved2)
                continue

            n3 = len(legal3)
            saved3 = sim.save_state()
            r3_arr = np.empty(n3, dtype=np.float32)
            ns3 = np.empty((n3, STATE_FEATURE_DIM), dtype=np.float32)
            for k, a3 in enumerate(legal3):
                r3_arr[k] = float(sim.step(a3["block_idx"], a3["gx"], a3["gy"]))
                ns3[k] = extract_state_features(sim.grid, sim.dock)
                sim.restore_state(saved3)
            # 将 (r3, ns3) 打包为 concatenated block：首行存 r3，后续行存 ns3
            block = np.empty((n3 + 1, STATE_FEATURE_DIM), dtype=np.float32)
            block[0, :n3] = r3_arr
            block[1:, :] = ns3
            ply3_batches.append((i, r1, r2_val, block))
            sim.restore_state(saved2)
        sim.restore_state(saved)

    if ply3_batches:
        # 合并所有 ns3 做一次批量推理
        ns3_list = []
        for _, _, _, blk in ply3_batches:
            if blk.shape[0] > 1:
                ns3_list.append(blk[1:])
        if ns3_list:
            all_ns3 = np.concatenate(ns3_list, axis=0)
            with torch.no_grad():
                ns3_t = tensor_to_device(torch.from_numpy(all_ns3), device)
                all_v3 = net.forward_value(ns3_t).cpu().numpy().flatten()

            v3_off = 0
            # 用 a1-level 的 best_q3 dict 做 max 聚合
            best_q3: dict[int, float] = {}
            for (i, r1, r2_val, blk) in ply3_batches:
                if blk.shape[0] <= 1:
                    q3_val = r2_val  # 第三层无动作，V=0
                else:
                    n3 = blk.shape[0] - 1
                    r3_arr = blk[0, :n3]
                    v3 = all_v3[v3_off: v3_off + n3]
                    q3_val = float(r2_val + gamma * np.max(r3_arr + gamma * v3))
                    v3_off += n3
                # 对同一 a1，取不同 a2 的最大 q3_val
                if i not in best_q3 or q3_val > best_q3[i]:
                    best_q3[i] = q3_val

            for i, q3_best in best_q3.items():
                r1 = q2_map[i][0]
                q3ply[i] = r1 + gamma * q3_best

    return q3ply


# ---------------------------------------------------------------------------
# 进程级 Zobrist 缓存单例（v8.2）
# ---------------------------------------------------------------------------
_GLOBAL_ZOBRIST_CACHE: "ZobristCache | None" = None  # type: ignore[name-defined]


def _get_global_zobrist_cache():
    """返回进程唯一的 ZobristCache 实例。

    大小由 RL_ZOBRIST_CACHE_SIZE 环境变量控制（0 或负数则禁用）。
    game_rules.json lightMCTS.zobristCacheSize 作为默认值（5000）。
    """
    global _GLOBAL_ZOBRIST_CACHE
    if _GLOBAL_ZOBRIST_CACHE is not None:
        return _GLOBAL_ZOBRIST_CACHE

    # 读取配置（game_rules._DATA 的顶层 lightMCTS 节点）
    from .game_rules import _DATA as _GR_DATA  # type: ignore[attr-defined]
    rules = _GR_DATA.get("lightMCTS", {})
    default_size = int(rules.get("zobristCacheSize", 5000))
    size = int(os.environ.get("RL_ZOBRIST_CACHE_SIZE", default_size))
    if size <= 0:
        return None   # 禁用

    from .mcts import ZobristHasher, ZobristCache  # type: ignore[attr-defined]
    hasher = ZobristHasher(grid_size=8)
    _GLOBAL_ZOBRIST_CACHE = ZobristCache(hasher=hasher, max_size=size)
    return _GLOBAL_ZOBRIST_CACHE


def collect_episode(
    net: AnyNet,
    device: torch.device,
    global_ep: int,
    temp_floor: float,
    explore_first_moves: int,
    explore_temp_mult: float,
    dirichlet_epsilon: float,
    dirichlet_alpha: float,
    win_threshold_override: int | None = None,
) -> dict:
    """no_grad 采集：只存 numpy，不建计算图；更新时由 GPU 批量再评估。

    新增参数 win_threshold_override：自适应课程时由 train_loop 动态传入，
    覆盖基于 global_ep 的线性计算结果。
    """
    sim = OpenBlockSimulator("normal")
    if win_threshold_override is not None:
        sim.win_score_threshold = win_threshold_override
    else:
        sim.win_score_threshold = rl_win_threshold_for_episode(global_ep)
    trajectory: list[dict] = []
    gamma = float(os.environ.get("RL_GAMMA", "0.99"))
    use_lookahead = os.environ.get("RL_LOOKAHEAD", "1").lower() not in ("0", "false", "no")
    lookahead_mix = float(os.environ.get("RL_LOOKAHEAD_MIX", "0.5"))

    # --- 搜索策略选择（优先级：MCTS > 3-ply beam > 2-ply beam > 1-step）---
    _mcts_cfg = RL_REWARD_SHAPING.get("lightMCTS") or {}
    use_mcts = (
        _mcts_cfg.get("enabled", False)
        or os.environ.get("RL_MCTS", "0").lower() not in ("0", "false", "no")
    )
    _mcts_sims = int(_mcts_cfg.get("numSimulations", 20))
    _mcts_cpuct = float(_mcts_cfg.get("cPuct", 1.5))
    _mcts_depth = int(_mcts_cfg.get("maxDepth", 8))
    # v8.1：MCTS 树复用 + 多温度采样 + SpawnPredictor
    _use_mcts_reuse = (
        use_mcts
        and os.environ.get("RL_MCTS_REUSE", "1").lower() not in ("0", "false", "no")
    )
    _mcts_train_temp = float(os.environ.get("RL_MCTS_TRAIN_TEMP", "1.0"))
    _spawn_pred: "SpawnPredictor | None" = None
    if use_mcts and os.environ.get("RL_MCTS_STOCHASTIC", "0") not in ("0", "false", "no"):
        from .spawn_predictor import SpawnPredictor as _SP
        _spawn_pred = _SP.load(device=device)

    _beam3ply_cfg = RL_REWARD_SHAPING.get("beam3ply") or {}
    use_beam3ply = (
        (_beam3ply_cfg.get("enabled", False)
         or os.environ.get("RL_BEAM3PLY", "0").lower() not in ("0", "false", "no"))
        and not use_mcts
    )
    _b3_topk = int(_beam3ply_cfg.get("topK", 15))
    _b3_topk2 = int(_beam3ply_cfg.get("topK2", 5))
    _b3_max = int(_beam3ply_cfg.get("maxActions", 100))
    _b3_max2 = int(_beam3ply_cfg.get("maxActions2", 50))

    _beam2ply_cfg = RL_REWARD_SHAPING.get("beam2ply") or {}
    use_beam2ply = (
        _beam2ply_cfg.get("enabled", True)
        and os.environ.get("RL_BEAM2PLY", "1").lower() not in ("0", "false", "no")
        and not use_mcts and not use_beam3ply
    )
    _beam2ply_topk = int(_beam2ply_cfg.get("topK", 15))
    _beam2ply_max_actions = int(_beam2ply_cfg.get("maxActions", 100))

    # MCTS 树状态（跨步复用 + 可选 Zobrist 跨局热启动）
    from .mcts import MCTSTreeState as _MCTSTreeState, select_action_from_visits as _select_mcts
    if _use_mcts_reuse:
        _zobrist_cache = _get_global_zobrist_cache()   # 进程级单例
        _mcts_tree = _MCTSTreeState(zobrist_cache=_zobrist_cache)
        _mcts_tree.try_warm_start(sim)                 # 尝试从缓存热启动
    else:
        _mcts_tree = None
    _prev_dock_remain: int = sum(1 for s in sim.dock if s is not None)

    step_idx = 0
    while True:
        if sim.is_terminal():
            break
        legal = sim.get_legal_actions()
        if not legal:
            break

        state_np, phi_np = build_phi_batch(sim, legal)
        if phi_np.shape[0] == 0:
            break

        with torch.no_grad():
            phi = tensor_to_device(torch.from_numpy(phi_np), device)
            logits = net.forward_policy_logits(phi)
            clean_lp = F.log_softmax(logits, dim=-1)

        # dock 刷新检测（三块放完后 dock 重新生成）→ 失效树复用
        cur_dock_remain = sum(1 for s in sim.dock if s is not None)
        if _mcts_tree is not None and cur_dock_remain > _prev_dock_remain:
            _mcts_tree.invalidate()
        _prev_dock_remain = cur_dock_remain

        q_vals = None
        _visit_pi = None
        if use_lookahead and step_idx >= explore_first_moves:
            if use_mcts:
                # 轻量 MCTS：访问分布→伪 Q 值（类 AlphaZero 策略目标）
                from .mcts import mcts_q_proxy as _mcts_fn
                q_vals = _mcts_fn(
                    net, device, sim,
                    n_simulations=_mcts_sims,
                    c_puct=_mcts_cpuct,
                    max_depth=_mcts_depth,
                    gamma=gamma,
                    spawn_predictor=_spawn_pred,
                    tree_state=_mcts_tree,
                )
                # 同时获取原始访问分布（用于温度采样）
                if _mcts_tree is not None and _mcts_tree.root is not None:
                    from .mcts import _extract_visit_pi as _evp
                    _visit_pi = _evp(_mcts_tree.root, len(legal))
            elif use_beam3ply:
                # 3-ply beam：dock=3 时三块全排列，否则自动退化为 2-ply/1-step
                q_vals = _beam_3ply_q_values(
                    net, device, sim, legal, gamma,
                    top_k=_b3_topk, max_actions=_b3_max,
                    top_k2=_b3_topk2, max_actions2=_b3_max2,
                )
            elif use_beam2ply:
                # 2-ply beam：当 dock≥2 块时展开第二层，否则自动退化为 1-step
                q_vals = _beam_2ply_q_values(
                    net, device, sim, legal, gamma,
                    top_k=_beam2ply_topk,
                    max_actions=_beam2ply_max_actions,
                )
            else:
                q_vals = _lookahead_q_values(net, device, sim, legal, gamma)

        if q_vals is not None:
            q_t = tensor_to_device(torch.from_numpy(q_vals), device)
            q_logits = q_t / max(temp_floor, 0.1)
            combined = (1.0 - lookahead_mix) * logits + lookahead_mix * q_logits
        else:
            combined = logits

        temp = _temperature_for_move(
            global_ep, step_idx, temp_floor, explore_first_moves, explore_temp_mult
        )
        d_eps = _dirichlet_epsilon_for_ep(global_ep, dirichlet_epsilon)

        # --- 多温度动作选择 ---
        # MCTS 模式：优先用访问分布按温度采样（AlphaZero 风格）
        # 非 MCTS 模式：沿用原有 Dirichlet + softmax 采样
        if use_mcts and _visit_pi is not None:
            chosen = _select_mcts(_visit_pi, temperature=_mcts_train_temp)
        else:
            idx, _, _ = _mix_dirichlet_and_sample(
                combined, temp, d_eps, dirichlet_alpha
            )
            chosen = int(idx.item())

        a = legal[chosen]
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
        clears_step = min(getattr(sim, "_last_clears", 0), 3)

        # MCTS 树复用：推进树根到已选动作的子节点
        if _mcts_tree is not None:
            _mcts_tree.advance(chosen)

        sup = sim.get_supervision_signals()
        trajectory.append({
            "state": state_np.copy(),
            "action_feats": phi_np[:, STATE_FEATURE_DIM:].copy(),
            "n_actions": phi_np.shape[0],
            "chosen_idx": chosen,
            "reward": r,
            "old_log_prob": float(clean_lp[chosen].item()),
            "holes_after": int(sim.count_holes()),
            "clears": clears_step,
            "board_quality": sup["board_quality"],
            "feasibility": sup["feasibility"],
            # Q 分布蒸馏目标：MCTS 访问分布 or beam Q 值
            "q_vals": q_vals.tolist() if q_vals is not None else None,
            # MCTS 访问分布（visit_pi）：用于直接 CE 损失（可选，比 q_proxy 更准确）
            "visit_pi": _visit_pi.tolist() if _visit_pi is not None else None,
        })
        step_idx += 1

    won = sim.score >= sim.win_score_threshold
    sp = float(RL_REWARD_SHAPING.get("stuckPenalty") or 0.0)
    if trajectory and not won and sp and (sim.is_terminal() or not sim.get_legal_actions()):
        trajectory[-1]["reward"] += sp

    # 局末将当前根节点存入 Zobrist 缓存（供下局热启动）
    if _mcts_tree is not None:
        _mcts_tree.flush_to_cache()

    total = len(trajectory)
    for i in range(total):
        trajectory[i]["steps_to_end"] = total - i - 1

    return {
        "trajectory": trajectory,
        "score": sim.score,
        "steps": sim.steps,
        "clears": sim.total_clears,
        "won": won,
        "win_threshold": int(sim.win_score_threshold),
    }


def episode_returns(rewards: list[float], gamma: float) -> torch.Tensor:
    g = 0.0
    out: list[float] = []
    for r in reversed(rewards):
        g = r + gamma * g
        out.append(g)
    out.reverse()
    return torch.tensor(out, dtype=torch.float32)


def _forward_and_log_probs(
    net: AnyNet,
    states_t: torch.Tensor,
    action_feats_t: torch.Tensor,
    n_actions_t: torch.Tensor,
    all_n_actions: list[int],
    total_steps: int,
    device: torch.device,
    values_precomputed: torch.Tensor | None = None,
    trunk_hidden: torch.Tensor | None = None,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """前向传播 → 返回 (log_prob_2d, values, mask, col_range)。"""
    if hasattr(net, "forward_batched"):
        fb_kw: dict = {}
        if values_precomputed is not None:
            fb_kw["values_precomputed"] = values_precomputed
        if trunk_hidden is not None:
            fb_kw["trunk_hidden"] = trunk_hidden
        logits_flat, values_flat = net.forward_batched(
            states_t, action_feats_t, n_actions_t, **fb_kw
        )
    elif isinstance(net, SharedPolicyValueNet):
        values_flat = net.forward_value(states_t)
        parts: list[torch.Tensor] = []
        a_off = 0
        for i in range(total_steps):
            n = all_n_actions[i]
            phi_i = torch.cat([states_t[i : i + 1].expand(n, -1), action_feats_t[a_off : a_off + n]], dim=-1)
            parts.append(net.forward_policy_logits(phi_i))
            a_off += n
        logits_flat = torch.cat(parts)
    else:
        values_flat = net.forward_value(states_t)
        s_exp = torch.repeat_interleave(states_t, n_actions_t, dim=0)
        phi_cat = torch.cat([s_exp, action_feats_t], dim=-1)
        logits_flat = net.forward_policy_logits(phi_cat)

    values_flat = torch.nan_to_num(values_flat, nan=0.0, posinf=1e5, neginf=-1e5).clamp(-1e5, 1e5)

    logits_flat = torch.nan_to_num(logits_flat, nan=0.0, posinf=30.0, neginf=-30.0).clamp(-30.0, 30.0)

    max_n = int(n_actions_t.max().item())
    padded = logits_flat.new_full((total_steps, max_n), float("-inf"))
    col_range = torch.arange(max_n, device=device)
    mask = col_range.unsqueeze(0) < n_actions_t.unsqueeze(1)
    padded[mask] = logits_flat
    lp_2d = torch.log_softmax(padded, dim=1)
    return lp_2d, values_flat, mask, col_range


def _reevaluate_and_update(
    net: AnyNet,
    opt: torch.optim.Optimizer,
    batch: list[dict],
    device: torch.device,
    gamma: float,
    gae_lambda: float,
    return_scale: float,
    value_coef: float,
    entropy_coef: float,
    normalize_adv: bool,
    adv_min_std: float,
    value_huber_beta: float,
    grad_clip: float,
    ppo_epochs: int = 1,
    ppo_clip: float = 0.2,
) -> dict | None:
    """v5: outcome 价值目标 + 直接监督三头 + GAE advantage + PPO。"""
    valid = [ep for ep in batch if ep["trajectory"]]
    if not valid:
        return None

    all_states: list[np.ndarray] = []
    all_action_feats: list[np.ndarray] = []
    all_n_actions: list[int] = []
    all_chosen: list[int] = []
    all_rewards: list[float] = []
    all_old_lp: list[float] = []
    all_holes_after: list[float] = []
    all_clears: list[int] = []
    all_board_quality: list[float] = []
    all_feasibility: list[float] = []
    all_steps_to_end: list[float] = []
    all_q_vals: list[np.ndarray | None] = []
    ep_lengths: list[int] = []
    ep_scores: list[float] = []
    ep_thresholds: list[float] = []

    for ep in valid:
        traj = ep["trajectory"]
        ep_lengths.append(len(traj))
        ep_scores.append(float(ep.get("score", 0)))
        ep_thresholds.append(float(ep.get("win_threshold", WIN_SCORE_THRESHOLD)))
        for step in traj:
            all_states.append(step["state"])
            all_action_feats.append(step["action_feats"])
            all_n_actions.append(step["n_actions"])
            all_chosen.append(step["chosen_idx"])
            all_rewards.append(step["reward"])
            all_old_lp.append(step.get("old_log_prob", 0.0))
            if "holes_after" in step:
                all_holes_after.append(float(step["holes_after"]))
            all_clears.append(int(step.get("clears", 0)))
            all_board_quality.append(float(step.get("board_quality", 0.0)))
            all_feasibility.append(float(step.get("feasibility", 1.0)))
            all_steps_to_end.append(float(step.get("steps_to_end", 0)))
            qv = step.get("q_vals")
            all_q_vals.append(np.array(qv, dtype=np.float32) if qv is not None else None)

    total_steps = len(all_states)
    if total_steps == 0:
        return None

    states_t = tensor_to_device(torch.from_numpy(np.stack(all_states)), device)
    action_feats_t = tensor_to_device(
        torch.from_numpy(np.concatenate(all_action_feats, axis=0)), device
    )
    n_actions_t = torch.tensor(all_n_actions, device=device, dtype=torch.long)
    chosen_t = torch.tensor(all_chosen, device=device, dtype=torch.long).unsqueeze(1)
    old_lp_t = tensor_to_device(torch.tensor(all_old_lp, dtype=torch.float32), device)

    hole_coef, hole_denom = _hole_aux_coef_and_denom()
    clear_pred_coef = _clear_pred_coef()
    outcome_mix = _outcome_value_mix()
    bq_coef = _board_quality_coef()
    feas_coef = _feasibility_coef()
    surv_coef = _survival_coef()
    q_distill_coef = _q_distill_coef()
    q_distill_tau = _q_distill_tau()

    step_starts = torch.zeros(total_steps + 1, dtype=torch.long, device=device)
    step_starts[1:] = torch.cumsum(n_actions_t, dim=0)
    chosen_rows = step_starts[:-1] + chosen_t.squeeze(1)
    chosen_action_feats = action_feats_t[chosen_rows]

    use_hole_aux = (
        hole_coef > 1e-12
        and callable(getattr(net, "forward_hole_aux", None))
        and len(all_holes_after) == total_steps
    )
    holes_target: torch.Tensor | None = None
    if use_hole_aux:
        holes_target = (
            torch.tensor(all_holes_after, dtype=torch.float32, device=device) / hole_denom
        ).clamp(0.0, 1.0)

    use_clear_pred = (
        clear_pred_coef > 1e-12
        and callable(getattr(net, "forward_clear_pred", None))
        and len(all_clears) == total_steps
    )
    clears_target: torch.Tensor | None = None
    if use_clear_pred:
        clears_target = torch.tensor(
            [min(c, 3) for c in all_clears], dtype=torch.long, device=device
        )

    # --- 直接监督目标 ---
    has_aux_heads = callable(getattr(net, "forward_aux_all", None))
    bq_target_t = tensor_to_device(
        torch.tensor(all_board_quality, dtype=torch.float32), device
    )
    feas_target_t = tensor_to_device(
        torch.tensor(all_feasibility, dtype=torch.float32), device
    )
    surv_target_t = tensor_to_device(
        torch.tensor([s / _SURVIVAL_NORM for s in all_steps_to_end], dtype=torch.float32), device
    ).clamp(0.0, 1.0)

    # Q 分布蒸馏目标张量（变长 Q 数组 → 对齐到 max_n 的 padded 矩阵）
    q_vals_padded: torch.Tensor | None = None
    q_has_vals: torch.Tensor | None = None
    if q_distill_coef > 1e-12 and len(all_q_vals) == total_steps:
        max_n_q = int(n_actions_t.max().item())
        q_padded_np = np.full((total_steps, max_n_q), -1e9, dtype=np.float32)
        has_q_np = np.zeros(total_steps, dtype=bool)
        for t_i, qv in enumerate(all_q_vals):
            if qv is not None and len(qv) == all_n_actions[t_i]:
                q_padded_np[t_i, : len(qv)] = qv
                has_q_np[t_i] = True
        if has_q_np.any():
            q_vals_padded = tensor_to_device(torch.from_numpy(q_padded_np), device)
            q_has_vals = torch.from_numpy(has_q_np).to(device)

    dp_ids = resolve_cuda_device_ids_for_data_parallel()
    use_dp_trunk = (
        device.type == "cuda"
        and len(dp_ids) > 1
        and os.environ.get("RL_CUDA_DP_TRUNK", "1").lower() not in ("0", "false", "no")
        and hasattr(net, "forward_trunk")
    )
    use_dp_value_only = (
        device.type == "cuda"
        and len(dp_ids) > 1
        and not use_dp_trunk
        and os.environ.get("RL_CUDA_DP_VALUE", "1").lower() not in ("0", "false", "no")
        and isinstance(net, (LightPolicyValueNet, LightSharedPolicyValueNet, ConvSharedPolicyValueNet))
    )
    trunk_h_init: torch.Tensor | None = None
    values_dp: torch.Tensor | None = None
    if use_dp_trunk:
        from torch.nn.parallel import data_parallel as dp_fn

        trunk_h_init = dp_fn(_TrunkForward(net), states_t, device_ids=dp_ids, output_device=device)
    elif use_dp_value_only:
        from torch.nn.parallel import data_parallel as dp_fn

        values_dp = dp_fn(_ValueForward(net), states_t, device_ids=dp_ids, output_device=device)

    lp_2d_init, values_init, mask, _col = _forward_and_log_probs(
        net,
        states_t,
        action_feats_t,
        n_actions_t,
        all_n_actions,
        total_steps,
        device,
        values_precomputed=values_dp,
        trunk_hidden=trunk_h_init,
    )

    # --- 价值目标：outcome-based（纯终局得分） + GAE advantage ---
    _vtc = float(os.environ.get("RL_VALUE_TARGET_CLIP", "512"))
    _gae_dc = float(os.environ.get("RL_GAE_DELTA_CLIP", "80"))
    vals_np = values_init.detach().cpu().numpy()
    adv_np = np.empty(total_steps, dtype=np.float32)
    rets_np = np.empty(total_steps, dtype=np.float32)
    v_off = 0
    r_off = 0
    for ep_i, ep_len in enumerate(ep_lengths):
        v = vals_np[v_off : v_off + ep_len]
        r = np.array([all_rewards[r_off + j] * return_scale for j in range(ep_len)], dtype=np.float32)
        t_len = ep_len

        # GAE advantages（用于策略梯度）
        if gae_lambda > 1e-8:
            next_v = np.zeros(t_len, dtype=np.float32)
            if t_len > 1:
                next_v[:-1] = v[1:]
            deltas = r + gamma * next_v - v
            if _gae_dc > 0:
                deltas = np.clip(deltas, -_gae_dc, _gae_dc)
            gae_acc = 0.0
            for i in range(t_len - 1, -1, -1):
                gae_acc = float(deltas[i]) + gamma * gae_lambda * gae_acc
                adv_np[v_off + i] = gae_acc
            rets_np[v_off : v_off + ep_len] = adv_np[v_off : v_off + ep_len] + v
        else:
            g = 0.0
            for i in range(t_len - 1, -1, -1):
                g = float(r[i]) + gamma * g
                rets_np[v_off + i] = g
            adv_np[v_off : v_off + ep_len] = rets_np[v_off : v_off + ep_len] - v

        # outcome 价值目标（替换 GAE returns 用于 value loss）
        outcome_val = float(np.clip(ep_scores[ep_i] / max(ep_thresholds[ep_i], 1), 0.0, 2.0))
        if outcome_mix > 1e-8:
            for i in range(ep_len):
                rets_np[v_off + i] = (1.0 - outcome_mix) * rets_np[v_off + i] + outcome_mix * outcome_val

        v_off += ep_len
        r_off += ep_len

    if _vtc > 0:
        rets_np = np.clip(rets_np, -_vtc, _vtc)
    rets_clean = np.nan_to_num(rets_np, nan=0.0, posinf=65504.0, neginf=-65504.0)
    if _vtc > 0:
        rets_clean = np.clip(rets_clean, -_vtc, _vtc)
    adv_cat = tensor_to_device(torch.from_numpy(adv_np), device)
    rets_cat = tensor_to_device(torch.from_numpy(rets_clean), device)
    if normalize_adv:
        adv_cat = _normalize_advantages(adv_cat, min_std=adv_min_std)
    else:
        adv_cat = torch.nan_to_num(adv_cat, nan=0.0, posinf=1e3, neginf=-1e3).clamp(-100, 100)

    values_old_for_clip = values_init.detach()

    last_result: dict | None = None
    n_epochs = max(1, ppo_epochs)

    _pre_sd: dict | None = None
    if n_epochs > 1:
        _pre_sd = {k: v.clone() for k, v in net.state_dict().items()}

    for epoch_i in range(n_epochs):
        if epoch_i == 0:
            lp_2d = lp_2d_init
            values_flat = values_init
        else:
            trunk_h_e: torch.Tensor | None = None
            if use_dp_trunk:
                from torch.nn.parallel import data_parallel as dp_fn

                trunk_h_e = dp_fn(_TrunkForward(net), states_t, device_ids=dp_ids, output_device=device)
            lp_2d, values_flat, mask, _col = _forward_and_log_probs(
                net,
                states_t,
                action_feats_t,
                n_actions_t,
                all_n_actions,
                total_steps,
                device,
                trunk_hidden=trunk_h_e,
            )

        new_lp = _clamp_log_probs_pg(lp_2d.gather(1, chosen_t).squeeze(1))
        probs_2d = lp_2d.exp() * mask.float()
        ent_t = -(probs_2d * lp_2d.masked_fill(~mask, 0.0)).sum(dim=1)

        if n_epochs > 1:
            log_ratio = (new_lp - old_lp_t).clamp(-10.0, 10.0)
            ratio = torch.exp(log_ratio)
            surr1 = ratio * adv_cat
            surr2 = torch.clamp(ratio, 1.0 - ppo_clip, 1.0 + ppo_clip) * adv_cat
            policy_loss = -torch.min(surr1, surr2).mean()
        else:
            policy_loss = -(new_lp * adv_cat).mean()

        v_clipped = values_old_for_clip + torch.clamp(
            values_flat - values_old_for_clip, -ppo_clip, ppo_clip
        )
        vl_unclipped = F.smooth_l1_loss(values_flat, rets_cat, reduction="none", beta=max(value_huber_beta, 1e-6))
        vl_clipped = F.smooth_l1_loss(v_clipped, rets_cat, reduction="none", beta=max(value_huber_beta, 1e-6))
        value_loss = torch.max(vl_unclipped, vl_clipped).mean()

        entropy_mean = torch.nan_to_num(ent_t.mean(), nan=0.0, posinf=0.0, neginf=0.0)

        hole_aux_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if use_hole_aux and holes_target is not None:
            pred_h = net.forward_hole_aux(states_t, chosen_action_feats)
            hole_aux_loss = F.smooth_l1_loss(pred_h, holes_target, reduction="mean", beta=1.0)

        clear_pred_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if use_clear_pred and clears_target is not None:
            clear_logits = net.forward_clear_pred(states_t, chosen_action_feats)
            clear_pred_loss = F.cross_entropy(clear_logits, clears_target, reduction="mean")

        bq_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        feas_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        surv_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if has_aux_heads and (bq_coef > 1e-12 or feas_coef > 1e-12 or surv_coef > 1e-12):
            aux = net.forward_aux_all(states_t)
            if bq_coef > 1e-12:
                bq_loss = F.smooth_l1_loss(aux["board_quality"], bq_target_t, reduction="mean", beta=1.0)
            if feas_coef > 1e-12:
                feas_loss = F.binary_cross_entropy_with_logits(
                    aux["feasibility"], feas_target_t, reduction="mean"
                )
            if surv_coef > 1e-12:
                surv_loss = F.smooth_l1_loss(aux["survival"], surv_target_t, reduction="mean", beta=1.0)

        # Q 分布蒸馏：策略头模仿 lookahead Q 的 softmax 分布（AlphaZero 策略改进的轻量实现）
        q_distill_loss = torch.tensor(0.0, device=device, dtype=torch.float32)
        if (
            q_distill_coef > 1e-12
            and q_vals_padded is not None
            and q_has_vals is not None
            and bool(q_has_vals.any().item())
        ):
            q_rows = q_vals_padded[q_has_vals]        # (n_q, max_n)
            q_mask = mask[q_has_vals]                  # (n_q, max_n) bool
            lp_q = lp_2d[q_has_vals]                  # (n_q, max_n) log-probs
            tau = max(q_distill_tau, 0.1)
            # softmax(Q/τ) 作为 target_pi；padded 位置填 -inf → softmax=0
            target_pi = torch.softmax(
                q_rows.masked_fill(~q_mask, float("-inf")) / tau, dim=1
            )
            # 有效位置上的 CE 损失：-Σ target_pi * log_prob
            target_pi_safe = target_pi.masked_fill(~q_mask, 0.0)
            lp_q_safe = lp_q.masked_fill(~q_mask, 0.0)
            q_distill_loss = -(target_pi_safe * lp_q_safe).sum(dim=1).mean()
            q_distill_loss = torch.nan_to_num(q_distill_loss, nan=0.0, posinf=0.0, neginf=0.0)

        def _safe_aux(t):
            return t if torch.isfinite(t).item() else torch.zeros_like(t)

        policy_loss = _safe_aux(policy_loss)
        value_loss_safe = _safe_aux(value_loss)

        loss = (
            policy_loss
            + value_coef * value_loss_safe
            - entropy_coef * entropy_mean
            + hole_coef * _safe_aux(hole_aux_loss)
            + clear_pred_coef * _safe_aux(clear_pred_loss)
            + bq_coef * _safe_aux(bq_loss)
            + feas_coef * _safe_aux(feas_loss)
            + surv_coef * _safe_aux(surv_loss)
            + q_distill_coef * _safe_aux(q_distill_loss)
        )

        opt.zero_grad()
        stepped = False
        if torch.isfinite(loss).item():
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), max(grad_clip, 1e-8))
            opt.step()
            stepped = True
            if any(torch.isnan(p).any() for p in net.parameters()):
                if _pre_sd is not None:
                    net.load_state_dict(_pre_sd)
                stepped = False
        else:
            opt.zero_grad(set_to_none=True)

        last_result = {
            "policy_loss": float(policy_loss.item()),
            "value_loss": float(value_loss.item()),
            "entropy": float(entropy_mean.item()),
            "loss_hole_aux": float(hole_aux_loss.item()),
            "loss_clear_pred": float(clear_pred_loss.item()),
            "loss_bq": float(bq_loss.item()),
            "loss_feas": float(feas_loss.item()),
            "loss_surv": float(surv_loss.item()),
            "loss_q_distill": float(q_distill_loss.item()),
            "hole_aux_coef": float(hole_coef),
            "clear_pred_coef": float(clear_pred_coef),
            "q_distill_coef": float(q_distill_coef),
            "optimizer_stepped": stepped,
        }

        if not stepped and epoch_i > 0:
            break

    return last_result


def _auto_n_workers(device: torch.device) -> int:
    """自动选择多进程 worker 数：GPU 设备留 1 核给主线程，CPU 模式不启多进程。"""
    if device.type == "cpu":
        return 1
    n_cpu = os.cpu_count() or 1
    return max(2, min(n_cpu - 1, 6))


def train_loop(
    net: AnyNet,
    device: torch.device,
    episodes: int,
    lr: float,
    value_coef: float,
    gamma: float,
    log_every: int,
    save_every: int,
    ckpt_path: Path | None,
    resume: Path | None,
    entropy_coef: float = 0.01,
    normalize_adv: bool = True,
    grad_clip: float = 1.0,
    adv_min_std: float = 1e-4,
    value_huber_beta: float = 10.0,
    gae_lambda: float = 0.95,
    temp_floor: float = 0.3,
    explore_first_moves: int = 10,
    explore_temp_mult: float = 1.2,
    dirichlet_epsilon: float = 0.08,
    dirichlet_alpha: float = 0.28,
    train_arch: str = "conv-shared",
    mlp_ratio: float = 2.0,
    policy_depth_arg: int = 4,
    value_depth_arg: int = 4,
    batch_episodes: int = 8,
    n_workers: int = 0,
    ppo_epochs: int = 4,
    ppo_clip: float = 0.2,
    eval_gate_every: int = 0,
    eval_gate_games: int = 50,
    eval_gate_win_ratio: float = 0.55,
) -> int:
    import collections
    import multiprocessing as mp

    opt = adam_for_training(net.parameters(), lr=lr)

    # --- 评估门控：基线权重 + 历史最优保留（v8）---
    _baseline_sd: dict | None = None
    _last_gate_ep: int = 0
    _best_ever_sd: dict | None = None   # 历史最优模型权重（从不降级）
    _best_ever_wr: float = 0.0          # 历史最优对应胜率
    if eval_gate_every > 0:
        _baseline_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}
        _best_ever_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}

    # --- 自适应课程（v8）---
    _adap_cfg = rl_adaptive_curriculum_config()
    _use_adaptive = _adap_cfg.get("enabled", False) and rl_curriculum_enabled()
    _adap_window = int(_adap_cfg.get("window", 200))
    _adap_target_wr = float(_adap_cfg.get("targetWinRate", 0.5))
    _adap_step_up = float(_adap_cfg.get("stepUp", 2))
    _adap_step_down = float(_adap_cfg.get("stepDown", 0))
    _adap_check_every = int(_adap_cfg.get("checkEvery", 50))
    # 虚拟局数：课程推进速度由滑动胜率决定，可快于/慢于实际局数
    _virtual_ep: float = 0.0
    _win_history: collections.deque = collections.deque(maxlen=_adap_window)
    _last_adap_check_ep: int = 0

    start_ep = 0
    if resume and resume.is_file():
        try:
            ckpt = torch.load(resume, map_location=device, weights_only=False)
        except TypeError:
            ckpt = torch.load(resume, map_location=device)
        ckpt_arch = str((ckpt.get("meta") or {}).get("arch", train_arch))
        if ckpt_arch != train_arch:
            print(
                f"警告: checkpoint arch={ckpt_arch} 与当前 --arch {train_arch} 不一致，加载可能失败",
                file=sys.stderr,
            )
        try:
            inco = net.load_state_dict(ckpt["model"], strict=False)
            if inco.missing_keys or inco.unexpected_keys:
                print(
                    f"注意: checkpoint 非严格加载 missing={len(inco.missing_keys)} "
                    f"unexpected={len(inco.unexpected_keys)}（如新增 hole_aux 头时属正常）",
                    file=sys.stderr,
                )
            if "optimizer" in ckpt:
                opt.load_state_dict(ckpt["optimizer"])
            start_ep = int(ckpt.get("episodes", 0))
            print(f"已从 {resume} 恢复，继续自第 {start_ep} 局", file=sys.stderr)
        except RuntimeError as e:
            print(
                f"警告: checkpoint 权重与当前模型不兼容，忽略旧权重从头训练: {e}",
                file=sys.stderr,
            )

    # --- 多进程 worker pool（0=自动检测） ---
    pool = None
    actual_workers = n_workers if n_workers > 0 else _auto_n_workers(device)
    if actual_workers > 1:
        w = getattr(net, "width", 128)
        cc = getattr(net, "conv_channels", 32)
        ctx = mp.get_context("spawn")
        pool = ctx.Pool(
            actual_workers,
            initializer=_pool_worker_init,
            initargs=(train_arch, w, policy_depth_arg, value_depth_arg, mlp_ratio, cc),
        )
        print(f"多进程采集: {actual_workers} workers (CPU inference → GPU update) + pipeline overlap", file=sys.stderr)

    wins = 0
    scores: list[float] = []
    t0 = time.perf_counter()
    return_scale = float(os.environ.get("RL_RETURN_SCALE", "1.0"))
    last_update: dict | None = None
    last_log_ep = start_ep
    mps_sync = device.type == "mps" and os.environ.get("RL_MPS_SYNC", "").lower() in ("1", "true", "yes")

    warmup_batches = int(os.environ.get("RL_LR_WARMUP_BATCHES", "20"))
    batch_count = 0

    # 流水线状态：上一轮异步采集的 AsyncResult
    _pending_async = None
    t_collect_ms = 0.0
    t_train_ms = 0.0

    def _make_pool_args(ep_start: int, count: int, win_thr: int | None = None):
        """构建 pool worker 的参数列表。

        每个 config 为 7-tuple：(global_ep, temp_floor, explore_first_moves,
            explore_temp_mult, dirichlet_epsilon, dirichlet_alpha, win_threshold_override)
        """
        configs = [
            (ep_start + i + 1, temp_floor, explore_first_moves, explore_temp_mult,
             dirichlet_epsilon, dirichlet_alpha, win_thr)
            for i in range(count)
        ]
        chunks: list[list] = [[] for _ in range(actual_workers)]
        for i, cfg in enumerate(configs):
            chunks[i % actual_workers].append(cfg)
        cpu_sd = {k: v.detach().cpu() for k, v in net.state_dict().items()}
        return [(cpu_sd, chunk) for chunk in chunks if chunk]

    ep_cursor = start_ep
    try:
        while ep_cursor < start_ep + episodes:
            bs = min(batch_episodes, start_ep + episodes - ep_cursor)

            if warmup_batches > 0:
                effective_lr = _lr_warmup(batch_count, warmup_batches, lr)
                for pg in opt.param_groups:
                    pg["lr"] = effective_lr

            # --- 自适应课程：计算当前有效胜利门槛 ---
            if _use_adaptive:
                cur_win_thr: int | None = rl_win_threshold_from_virtual_ep(int(_virtual_ep))
            else:
                cur_win_thr = None  # None = collect_episode 内部按线性课程计算

            # --- 采集（含流水线重叠）---
            tc0 = time.perf_counter()

            if pool is not None:
                if _pending_async is not None:
                    results = _pending_async.get()
                    batch = [ep for worker_eps in results for ep in worker_eps]
                else:
                    args_list = _make_pool_args(ep_cursor, bs, cur_win_thr)
                    results = pool.map(_pool_worker_collect, args_list)
                    batch = [ep for worker_eps in results for ep in worker_eps]

                tc1 = time.perf_counter()
                t_collect_ms = (tc1 - tc0) * 1000

                # 预发射下一批采集（与本轮 GPU 训练重叠）
                next_ep = ep_cursor + bs
                next_bs = min(batch_episodes, start_ep + episodes - next_ep)
                if next_bs > 0:
                    next_args = _make_pool_args(next_ep, next_bs, cur_win_thr)
                    _pending_async = pool.map_async(_pool_worker_collect, next_args)
                else:
                    _pending_async = None
            else:
                batch = [
                    collect_episode(
                        net, device,
                        ep_cursor + i + 1, temp_floor,
                        explore_first_moves, explore_temp_mult,
                        dirichlet_epsilon, dirichlet_alpha,
                        win_threshold_override=cur_win_thr,
                    )
                    for i in range(bs)
                ]
                tc1 = time.perf_counter()
                t_collect_ms = (tc1 - tc0) * 1000

            for ep in batch:
                scores.append(ep["score"])
                won = ep["won"]
                if won:
                    wins += 1
                if _use_adaptive:
                    _win_history.append(1 if won else 0)
            ep_cursor += bs

            # --- 自适应课程：每 checkEvery 局更新虚拟进度 ---
            if _use_adaptive and ep_cursor - _last_adap_check_ep >= _adap_check_every:
                _last_adap_check_ep = ep_cursor
                if len(_win_history) >= 10:
                    recent_wr = sum(_win_history) / len(_win_history)
                    if recent_wr > _adap_target_wr:
                        # 超过目标胜率：加速推进（额外增加虚拟局数）
                        _virtual_ep += _adap_step_up * _adap_check_every
                    elif recent_wr < _adap_target_wr * 0.6:
                        # 远低于目标：暂停推进（保持当前虚拟局数）
                        _virtual_ep += max(0.0, _adap_step_down * _adap_check_every)
                    else:
                        # 正常范围：按实际局数推进
                        _virtual_ep += float(_adap_check_every)
                else:
                    _virtual_ep += float(_adap_check_every)

            # --- GPU 批量更新（PPO 或 REINFORCE）---
            tt0 = time.perf_counter()
            ent_eff = _effective_entropy_coef(ep_cursor, entropy_coef)
            result = _reevaluate_and_update(
                net, opt, batch, device, gamma, gae_lambda,
                return_scale, value_coef, ent_eff, normalize_adv,
                adv_min_std, value_huber_beta, grad_clip,
                ppo_epochs=ppo_epochs, ppo_clip=ppo_clip,
            )
            tt1 = time.perf_counter()
            t_train_ms = (tt1 - tt0) * 1000

            if result:
                last_update = result
            batch_count += 1
            if mps_sync:
                maybe_mps_synchronize(device)

            # --- 日志 ---
            if ep_cursor % log_every < bs or ep_cursor >= start_ep + episodes:
                dt = time.perf_counter() - t0
                n = min(100, len(scores))
                avg = sum(scores[-n:]) / n if n else 0.0
                eps_since = ep_cursor - last_log_ep
                wr = 100.0 * wins / max(eps_since, 1)
                wins = 0
                last_log_ep = ep_cursor
                last_ep = batch[-1]
                # 自适应课程时显示虚拟局数对应的门槛
                if _use_adaptive and cur_win_thr is not None:
                    wt = cur_win_thr
                else:
                    wt = last_ep.get("win_threshold", WIN_SCORE_THRESHOLD)
                lp_str = f"{last_update['policy_loss']:.4f}" if last_update else "N/A"
                lv_str = f"{last_update['value_loss']:.4f}" if last_update else "N/A"
                he_str = f"{last_update['entropy']:.3f}" if last_update else "N/A"
                hole_str = ""
                if last_update and last_update.get("hole_aux_coef", 0) > 1e-12:
                    hole_str = f"  hole={last_update.get('loss_hole_aux', 0):.4f}"
                if last_update and last_update.get("clear_pred_coef", 0) > 1e-12:
                    hole_str += f"  clr={last_update.get('loss_clear_pred', 0):.4f}"
                if last_update and last_update.get("loss_bq", 0) > 1e-6:
                    hole_str += f"  bq={last_update['loss_bq']:.4f}"
                if last_update and last_update.get("loss_feas", 0) > 1e-6:
                    hole_str += f"  feas={last_update['loss_feas']:.4f}"
                if last_update and last_update.get("loss_surv", 0) > 1e-6:
                    hole_str += f"  surv={last_update['loss_surv']:.4f}"
                if last_update and last_update.get("q_distill_coef", 0) > 1e-12:
                    hole_str += f"  qdst={last_update.get('loss_q_distill', 0):.4f}"
                ppo_tag = f"ppo×{ppo_epochs}" if ppo_epochs > 1 else "pg"
                gpu_pct = 100.0 * t_train_ms / max(t_collect_ms + t_train_ms, 1)
                # 自适应课程：显示虚拟进度
                adap_tag = f"  vep={_virtual_ep:.0f}" if _use_adaptive else ""
                print(
                    f"ep {ep_cursor}  |  {ppo_tag}  |  dev={device.type}  |  thr={wt}{adap_tag}  |  "
                    f"sc={last_ep['score']:.0f}  avg100={avg:.1f}  win%={wr:.1f}%  steps={last_ep['steps']}  |  "
                    f"π={lp_str}  V={lv_str}  H={he_str}{hole_str}  |  "
                    f"C={t_collect_ms:.0f}ms T={t_train_ms:.0f}ms GPU≈{gpu_pct:.0f}%  |  {dt:.1f}s",
                    file=sys.stderr,
                )
                t0 = time.perf_counter()

            # --- 评估门控（v8：软/硬门控 + 历史最优保留）---
            # 软门控（默认）：仅记录，不回滚
            # 硬门控（RL_EVAL_GATE_HARD=1）：失败时恢复到历史最优（非仅基线）
            if (
                eval_gate_every > 0
                and _baseline_sd is not None
                and ep_cursor - _last_gate_ep >= eval_gate_every
            ):
                from .eval_gate import eval_gate_check as _gate_fn

                _gate_w = getattr(net, "width", 128)
                _gate_cc = getattr(net, "conv_channels", 32)
                _baseline_net = build_policy_net(
                    train_arch, _gate_w, policy_depth_arg, value_depth_arg,
                    mlp_ratio, device, conv_channels=_gate_cc,
                )
                _baseline_net.load_state_dict(
                    {k: v.to(device) for k, v in _baseline_sd.items()}
                )
                _gate_passed, _gate_m = _gate_fn(
                    net, _baseline_net, device,
                    n_games=eval_gate_games,
                    win_ratio=eval_gate_win_ratio,
                )
                _cwr = _gate_m["candidate"]["win_rate"]
                _bwr = _gate_m["baseline"]["win_rate"]
                _hard = os.environ.get("RL_EVAL_GATE_HARD", "0").lower() not in ("0", "false", "no")

                if _gate_passed:
                    # 候选超过基线 → 更新基线
                    _baseline_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}
                    # 检查是否超过历史最优
                    if _cwr > _best_ever_wr:
                        _best_ever_wr = _cwr
                        _best_ever_sd = {k: v.clone().cpu() for k, v in net.state_dict().items()}
                        best_tag = "  ★ 历史最优已更新"
                    else:
                        best_tag = f"  (历史最优胜率={_best_ever_wr:.1%})"
                    print(
                        f"[EvalGate] ep={ep_cursor}  ✓ PASSED  cand={_cwr:.1%}  base={_bwr:.1%}"
                        f"  → 基线已更新{best_tag}",
                        file=sys.stderr,
                    )
                else:
                    if _hard and _best_ever_sd is not None:
                        # 硬门控：回滚到历史最优（而非仅当前基线）
                        net.load_state_dict({k: v.to(device) for k, v in _best_ever_sd.items()})
                        restore_tag = f"  [已恢复历史最优 best_wr={_best_ever_wr:.1%}]"
                    else:
                        restore_tag = "  [软门控：继续训练]"
                    print(
                        f"[EvalGate] ep={ep_cursor}  ✗ FAILED  cand={_cwr:.1%}  base={_bwr:.1%}"
                        + restore_tag,
                        file=sys.stderr,
                    )
                _last_gate_ep = ep_cursor
                del _baseline_net

            # --- 存档 ---
            se = max(1, save_every)
            if ckpt_path and (ep_cursor % se < bs or ep_cursor >= start_ep + episodes):
                ckpt_path.parent.mkdir(parents=True, exist_ok=True)
                torch.save(
                    {
                        "model": net.state_dict(),
                        "optimizer": opt.state_dict(),
                        "episodes": ep_cursor,
                        "meta": _checkpoint_meta(
                            net, device, gamma, lr, train_arch,
                            mlp_ratio, policy_depth_arg, value_depth_arg,
                        ),
                    },
                    ckpt_path,
                )
    finally:
        if pool is not None:
            pool.close()
            pool.join()

    return ep_cursor


def main() -> None:
    p = argparse.ArgumentParser(description="Open Block PyTorch 自博弈 RL（支持 MPS/CUDA）")
    p.add_argument("--episodes", type=int, default=5000)
    p.add_argument(
        "--lr",
        type=float,
        default=3e-4,
        help="Adam 学习率；128 宽模型推荐 3e-4",
    )
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--value-coef", type=float, default=1.0, help="价值头损失权重；加大以加速 value 拟合")
    p.add_argument(
        "--value-huber-beta",
        type=float,
        default=1.0,
        help="smooth_l1 beta；return_scale=1 下回报在 [-5, 50] 区间，beta=1 合理",
    )
    p.add_argument(
        "--adv-min-std",
        type=float,
        default=1e-4,
        help="advantage 标准差低于此则不做标准化",
    )
    p.add_argument(
        "--entropy-coef",
        type=float,
        default=0.025,
        help="策略熵 bonus；防止策略过早确定化",
    )
    p.add_argument(
        "--no-adv-norm",
        action="store_true",
        help="关闭 advantage 标准化",
    )
    p.add_argument("--grad-clip", type=float, default=1.0, help="梯度裁剪范数")
    p.add_argument(
        "--width",
        type=int,
        default=128,
        help="隐层宽度；conv-shared 推荐 128（~132K 参数）；加大以提高价值/策略拟合能力",
    )
    p.add_argument(
        "--policy-depth",
        type=int,
        default=4,
        help="残差塔深度（仅 shared/split 架构使用）",
    )
    p.add_argument("--value-depth", type=int, default=4)
    p.add_argument("--mlp-ratio", type=float, default=2.0)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument(
        "--device",
        type=str,
        default="auto",
        help="auto | cpu | mps | cuda | cuda:N（多卡见 RL_CUDA_DEVICE_IDS、RL_CUDA_DP_VALUE）",
    )
    p.add_argument("--save", type=str, default="rl_checkpoints/bb_policy.pt")
    p.add_argument("--resume", type=str, default="")
    p.add_argument("--log-every", type=int, default=50, help="每隔多少局打印一行统计")
    p.add_argument(
        "--save-every",
        type=int,
        default=200,
        help="每隔多少局保存 checkpoint",
    )
    p.add_argument(
        "--arch",
        type=str,
        default="conv-shared",
        choices=("conv-shared", "light-shared", "light", "shared", "split"),
        help="conv-shared=残差CNN+dock MLP+共享主干（默认，~132K）；light-shared=轻量共享（~20K）；shared/split=旧版重模型",
    )
    p.add_argument(
        "--conv-channels",
        type=int,
        default=32,
        help="conv-shared 架构的 CNN 通道数；增大以捕捉更丰富的空间模式",
    )
    p.add_argument(
        "--batch-episodes",
        type=int,
        default=128,
        help="采集多少局后做一次梯度更新（大 batch 提高梯度稳定性）",
    )
    p.add_argument(
        "--ppo-epochs",
        type=int,
        default=4,
        help="每批数据的 PPO 更新轮数；1=退化为 REINFORCE",
    )
    p.add_argument(
        "--ppo-clip",
        type=float,
        default=0.2,
        help="PPO clipped surrogate ε；仅 ppo-epochs>1 时生效",
    )
    p.add_argument(
        "--gae-lambda",
        type=float,
        default=0.85,
        help="GAE λ；v5 默认 0.85（outcome 目标下 V 收敛更快，可用较低 λ 降方差）",
    )
    p.add_argument(
        "--temp-floor",
        type=float,
        default=0.35,
        help="温度下限；保持足够随机性以防过早收敛",
    )
    p.add_argument(
        "--explore-first-moves",
        type=int,
        default=15,
        help="开局前若干步温度乘 explore-temp-mult；0 关闭",
    )
    p.add_argument(
        "--explore-temp-mult",
        type=float,
        default=1.3,
        help="与 explore-first-moves 联用；v6 降为 1.3 配合 Dirichlet 探索",
    )
    p.add_argument(
        "--dirichlet-epsilon",
        type=float,
        default=0.15,
        help="Dirichlet 混合权重初值；v6 默认 0.15 增强早期探索",
    )
    p.add_argument(
        "--dirichlet-alpha",
        type=float,
        default=0.28,
        help="Dirichlet 总浓度（dirichlet-epsilon=0 时无效）",
    )
    p.add_argument(
        "--n-workers",
        type=int,
        default=0,
        help="多进程并行采集 worker 数；0=自动（GPU 设备按 CPU 核数），1=单进程，>1=CPU 多进程 + GPU 更新 + 流水线重叠",
    )
    p.add_argument(
        "--eval-gate-every",
        type=int,
        default=0,
        help="评估门控触发间隔（局数），0=关闭；每隔 N 局对比候选/基线胜率，候选≥基线×win-ratio 才更新基线",
    )
    p.add_argument(
        "--eval-gate-games",
        type=int,
        default=50,
        help="评估门控每侧运行的贪心评估局数",
    )
    p.add_argument(
        "--eval-gate-win-ratio",
        type=float,
        default=0.55,
        help="门控胜率倍数阈值；0.55 = 候选须超过基线胜率的 55%%（AlphaZero 默认标准）",
    )
    # ── v8 新增参数 ──────────────────────────────────────────────────────
    p.add_argument(
        "--adaptive-curriculum",
        action="store_true",
        help="启用自适应课程（RL_ADAPTIVE_CURRICULUM=1 亦可）：根据滑动胜率动态调整"
             "课程门槛推进速度；胜率高则加速，胜率低则减速",
    )
    p.add_argument(
        "--beam3ply",
        action="store_true",
        help="启用 3-ply beam（RL_BEAM3PLY=1 亦可）：dock=3 块时三层全排列展开，"
             "其余情况自动退化为 2-ply；注意显著增加每步采集耗时",
    )
    p.add_argument(
        "--mcts",
        action="store_true",
        help="启用轻量 MCTS（RL_MCTS=1 亦可）：用 UCT 搜索取代 beam Q 值，"
             "访问分布作为策略目标（类 AlphaZero）；与 beam 互斥，MCTS 优先级更高",
    )
    p.add_argument(
        "--mcts-sims",
        type=int,
        default=0,
        help="MCTS 每步模拟次数；0=使用 game_rules.json 中的 lightMCTS.numSimulations（默认 20）",
    )
    p.add_argument(
        "--mcts-no-reuse",
        action="store_true",
        help="禁用 MCTS 树复用（默认启用）：每步重新建树；用于消融对比",
    )
    p.add_argument(
        "--mcts-train-temp",
        type=float,
        default=1.0,
        help="MCTS 训练时动作采样温度（T=1 按访问频率采样，T=0 贪心，T>1 均匀探索）",
    )
    p.add_argument(
        "--mcts-stochastic",
        action="store_true",
        help="MCTS 叶子节点评估时随机采样出块分布（需 SpawnPredictor 检查点）",
    )
    p.add_argument(
        "--spawn-model-path",
        type=str,
        default="",
        help="SpawnTransformerV2 检查点路径；用于 --mcts-stochastic",
    )
    p.add_argument(
        "--point-encoder",
        action="store_true",
        help="使用 DockPointEncoder（PointNet 形状感知编码）替代默认 DockBoardAttention；"
             "需重新训练，与旧 checkpoint 不兼容",
    )
    p.add_argument(
        "--mcts-batch-size",
        type=int,
        default=0,
        help="v8.2：批量叶子评估并发模拟数（8~32）；0=使用 game_rules.json 中的 evalBatchSize（默认 8）；"
             "n_simulations≥50 时自动启用批量模式",
    )
    p.add_argument(
        "--zobrist-cache-size",
        type=int,
        default=0,
        help="v8.2：Zobrist hash 跨局节点缓存上限（节点数）；0=使用 game_rules.json（默认 5000）；-1=禁用",
    )
    args = p.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    device = resolve_training_device(args.device)
    apply_throughput_tuning(device)
    apply_cpu_training_tuning(device)
    print(f"使用设备: {device_summary_line(device)}", file=sys.stderr)
    if device.type == "cuda":
        dp_ids = resolve_cuda_device_ids_for_data_parallel()
        if len(dp_ids) > 1:
            trunk_on = os.environ.get("RL_CUDA_DP_TRUNK", "1").lower() not in ("0", "false", "no")
            val_on = os.environ.get("RL_CUDA_DP_VALUE", "1").lower() not in ("0", "false", "no")
            print(
                f"  CUDA data_parallel 卡: {dp_ids}  |  共享主干: {'on' if trunk_on else 'off'} (RL_CUDA_DP_TRUNK)"
                f"  |  仅价值头: {'on' if val_on else 'off'} (RL_CUDA_DP_VALUE，无 forward_trunk 时)",
                file=sys.stderr,
            )

    # v8/v8.1 功能开关（命令行参数 → 环境变量，传递给 collect_episode）
    if getattr(args, "adaptive_curriculum", False):
        os.environ["RL_ADAPTIVE_CURRICULUM"] = "1"
    if getattr(args, "beam3ply", False):
        os.environ["RL_BEAM3PLY"] = "1"
    if getattr(args, "mcts", False):
        os.environ["RL_MCTS"] = "1"
    if getattr(args, "mcts_sims", 0) > 0:
        os.environ["RL_MCTS_SIMS"] = str(args.mcts_sims)
    # v8.1 新增
    if getattr(args, "mcts_no_reuse", False):
        os.environ["RL_MCTS_REUSE"] = "0"
    if getattr(args, "mcts_train_temp", 1.0) != 1.0:
        os.environ["RL_MCTS_TRAIN_TEMP"] = str(args.mcts_train_temp)
    if getattr(args, "mcts_stochastic", False):
        os.environ["RL_MCTS_STOCHASTIC"] = "1"
    if getattr(args, "spawn_model_path", ""):
        os.environ["RL_SPAWN_MODEL_PATH"] = args.spawn_model_path
    # v8.2 新增
    if getattr(args, "mcts_batch_size", 0) > 0:
        os.environ["RL_MCTS_BATCH_SIZE"] = str(args.mcts_batch_size)
    _zobrist_cache_size = getattr(args, "zobrist_cache_size", 0)
    if _zobrist_cache_size != 0:
        os.environ["RL_ZOBRIST_CACHE_SIZE"] = str(_zobrist_cache_size)
    _use_point_encoder = getattr(args, "point_encoder", False)

    arch = args.arch.strip().lower()
    net = build_policy_net(
        arch,
        width=args.width,
        policy_depth=args.policy_depth,
        value_depth=args.value_depth,
        mlp_ratio=args.mlp_ratio,
        device=device,
        conv_channels=getattr(args, "conv_channels", 32),
        use_point_encoder=_use_point_encoder,
    )

    resume_path = Path(args.resume) if args.resume else None
    save_path = Path(args.save)

    algo_label = f"PPO(epochs={args.ppo_epochs}, clip={args.ppo_clip})" if args.ppo_epochs > 1 else "REINFORCE"
    n_params = sum(p.numel() for p in net.parameters())
    print(f"架构: {arch}  |  参数量: {n_params:,}  |  算法: {algo_label}", file=sys.stderr)

    total_eps = train_loop(
        net,
        device,
        episodes=args.episodes,
        lr=args.lr,
        value_coef=args.value_coef,
        gamma=args.gamma,
        log_every=args.log_every,
        save_every=args.save_every,
        ckpt_path=save_path,
        resume=resume_path,
        entropy_coef=args.entropy_coef,
        normalize_adv=not args.no_adv_norm,
        grad_clip=args.grad_clip,
        adv_min_std=args.adv_min_std,
        value_huber_beta=args.value_huber_beta,
        gae_lambda=args.gae_lambda,
        temp_floor=args.temp_floor,
        explore_first_moves=args.explore_first_moves,
        explore_temp_mult=args.explore_temp_mult,
        dirichlet_epsilon=args.dirichlet_epsilon,
        dirichlet_alpha=args.dirichlet_alpha,
        train_arch=arch,
        mlp_ratio=args.mlp_ratio,
        policy_depth_arg=args.policy_depth,
        value_depth_arg=args.value_depth,
        batch_episodes=args.batch_episodes,
        n_workers=args.n_workers,
        ppo_epochs=args.ppo_epochs,
        ppo_clip=args.ppo_clip,
        eval_gate_every=args.eval_gate_every,
        eval_gate_games=args.eval_gate_games,
        eval_gate_win_ratio=args.eval_gate_win_ratio,
    )

    save_path.parent.mkdir(parents=True, exist_ok=True)
    final_meta = _checkpoint_meta(
        net,
        device,
        args.gamma,
        args.lr,
        arch,
        args.mlp_ratio,
        args.policy_depth,
        args.value_depth,
    )
    final_meta["win_threshold"] = WIN_SCORE_THRESHOLD
    final_meta["gae_lambda"] = args.gae_lambda
    final_meta["ppo_epochs"] = args.ppo_epochs
    final_meta["ppo_clip"] = args.ppo_clip
    final_meta["rl_curriculum"] = rl_curriculum_enabled()
    torch.save(
        {
            "model": net.state_dict(),
            "episodes": total_eps,
            "meta": final_meta,
        },
        save_path,
    )
    meta_path = save_path.with_suffix(".json")
    meta_path.write_text(
        json.dumps(
            {
                "checkpoint": str(save_path),
                "episodes": total_eps,
                "device": str(device),
                "note": "与 rl_pytorch 模拟器一致；浏览器端需另行对接。",
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"已保存 {save_path}（累计局数 {total_eps}）", file=sys.stderr)


if __name__ == "__main__":
    main()
