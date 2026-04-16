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
from .game_rules import FEATURE_ENCODING, RL_REWARD_SHAPING, rl_curriculum_enabled, rl_win_threshold_for_episode
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
from .features import PHI_DIM, STATE_FEATURE_DIM, build_phi_batch
from .model import (
    ConvSharedPolicyValueNet,
    LightPolicyValueNet,
    LightSharedPolicyValueNet,
    PolicyValueNet,
    SharedPolicyValueNet,
)
from .simulator import BlockBlastSimulator, board_potential, _BOARD_POT_NORM, _SURVIVAL_NORM

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
    """Worker：加载最新权重 → 采集若干局 → 返回轨迹。"""
    global _pool_net, _pool_device
    state_dict, configs = args
    _pool_net.load_state_dict(state_dict)
    return [
        collect_episode(
            _pool_net, _pool_device,
            cfg[0], cfg[1], cfg[2], cfg[3], cfg[4], cfg[5],
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
) -> AnyNet:
    arch = (arch or "conv-shared").lower()
    if arch == "conv-shared":
        return ConvSharedPolicyValueNet(width=width, conv_channels=conv_channels).to(device)
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


def collect_episode(
    net: AnyNet,
    device: torch.device,
    global_ep: int,
    temp_floor: float,
    explore_first_moves: int,
    explore_temp_mult: float,
    dirichlet_epsilon: float,
    dirichlet_alpha: float,
) -> dict:
    """no_grad 采集：只存 numpy，不建计算图；更新时由 GPU 批量再评估。"""
    sim = BlockBlastSimulator("normal")
    sim.win_score_threshold = rl_win_threshold_for_episode(global_ep)
    trajectory: list[dict] = []

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

        temp = _temperature_for_move(
            global_ep, step_idx, temp_floor, explore_first_moves, explore_temp_mult
        )
        d_eps = _dirichlet_epsilon_for_ep(global_ep, dirichlet_epsilon)
        idx, _, _ = _mix_dirichlet_and_sample(
            logits, temp, d_eps, dirichlet_alpha
        )

        chosen = int(idx.item())
        a = legal[chosen]
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))
        clears_step = min(getattr(sim, "_last_clears", 0), 3)

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
        })
        step_idx += 1

    won = sim.score >= sim.win_score_threshold
    sp = float(RL_REWARD_SHAPING.get("stuckPenalty") or 0.0)
    if trajectory and not won and sp and (sim.is_terminal() or not sim.get_legal_actions()):
        trajectory[-1]["reward"] += sp

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
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """前向传播 → 返回 (log_prob_2d, values, mask, col_range)。"""
    if hasattr(net, "forward_batched"):
        if values_precomputed is not None:
            logits_flat, values_flat = net.forward_batched(
                states_t, action_feats_t, n_actions_t, values_precomputed=values_precomputed
            )
        else:
            logits_flat, values_flat = net.forward_batched(states_t, action_feats_t, n_actions_t)
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

    dp_ids = resolve_cuda_device_ids_for_data_parallel()
    use_dp_value = (
        device.type == "cuda"
        and len(dp_ids) > 1
        and os.environ.get("RL_CUDA_DP_VALUE", "1").lower() not in ("0", "false", "no")
        and isinstance(net, (LightPolicyValueNet, LightSharedPolicyValueNet, ConvSharedPolicyValueNet))
    )
    values_dp: torch.Tensor | None = None
    if use_dp_value:
        from torch.nn.parallel import data_parallel as dp_fn
        values_dp = dp_fn(_ValueForward(net), states_t, device_ids=dp_ids, output_device=device)

    lp_2d_init, values_init, mask, _col = _forward_and_log_probs(
        net, states_t, action_feats_t, n_actions_t, all_n_actions, total_steps, device, values_dp,
    )

    # --- 价值目标：outcome-based（纯终局得分） + GAE advantage ---
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

    adv_cat = tensor_to_device(torch.from_numpy(adv_np), device)
    rets_cat = tensor_to_device(
        torch.from_numpy(np.nan_to_num(rets_np, nan=0.0, posinf=1e5, neginf=-1e5).clip(-1e5, 1e5)), device
    )
    if normalize_adv:
        adv_cat = _normalize_advantages(adv_cat, min_std=adv_min_std)
    else:
        adv_cat = torch.nan_to_num(adv_cat, nan=0.0, posinf=1e3, neginf=-1e3).clamp(-100, 100)

    values_old_for_clip = values_init.detach()

    last_result: dict | None = None
    n_epochs = max(1, ppo_epochs)

    for epoch_i in range(n_epochs):
        if epoch_i == 0:
            lp_2d = lp_2d_init
            values_flat = values_init
        else:
            lp_2d, values_flat, mask, _col = _forward_and_log_probs(
                net, states_t, action_feats_t, n_actions_t, all_n_actions, total_steps, device,
            )

        new_lp = _clamp_log_probs_pg(lp_2d.gather(1, chosen_t).squeeze(1))
        probs_2d = lp_2d.exp() * mask.float()
        ent_t = -(probs_2d * lp_2d.masked_fill(~mask, 0.0)).sum(dim=1)

        if n_epochs > 1:
            ratio = torch.exp(new_lp - old_lp_t)
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

        # --- v5 直接监督三头 ---
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

        loss = (
            policy_loss
            + value_coef * value_loss
            - entropy_coef * entropy_mean
            + hole_coef * hole_aux_loss
            + clear_pred_coef * clear_pred_loss
            + bq_coef * bq_loss
            + feas_coef * feas_loss
            + surv_coef * surv_loss
        )

        opt.zero_grad()
        if torch.isfinite(loss).item():
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), max(grad_clip, 1e-8))
            opt.step()
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
            "hole_aux_coef": float(hole_coef),
            "clear_pred_coef": float(clear_pred_coef),
        }

    return last_result


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
    n_workers: int = 1,
    ppo_epochs: int = 4,
    ppo_clip: float = 0.2,
) -> int:
    import multiprocessing as mp

    opt = adam_for_training(net.parameters(), lr=lr)
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

    # --- 多进程 worker pool ---
    pool = None
    actual_workers = max(1, n_workers)
    if actual_workers > 1:
        w = getattr(net, "width", 128)
        cc = getattr(net, "conv_channels", 32)
        ctx = mp.get_context("spawn")
        pool = ctx.Pool(
            actual_workers,
            initializer=_pool_worker_init,
            initargs=(train_arch, w, policy_depth_arg, value_depth_arg, mlp_ratio, cc),
        )
        print(f"多进程采集: {actual_workers} workers (CPU inference → GPU update)", file=sys.stderr)

    wins = 0
    scores: list[float] = []
    t0 = time.perf_counter()
    return_scale = float(os.environ.get("RL_RETURN_SCALE", "1.0"))
    last_update: dict | None = None
    last_log_ep = start_ep
    mps_sync = device.type == "mps" and os.environ.get("RL_MPS_SYNC", "").lower() in ("1", "true", "yes")

    warmup_batches = int(os.environ.get("RL_LR_WARMUP_BATCHES", "20"))
    batch_count = 0

    ep_cursor = start_ep
    try:
        while ep_cursor < start_ep + episodes:
            bs = min(batch_episodes, start_ep + episodes - ep_cursor)

            if warmup_batches > 0:
                effective_lr = _lr_warmup(batch_count, warmup_batches, lr)
                for pg in opt.param_groups:
                    pg["lr"] = effective_lr

            # --- 采集一个 batch ---
            if pool is not None:
                cpu_sd = {k: v.detach().cpu() for k, v in net.state_dict().items()}
                configs = [
                    (ep_cursor + i + 1, temp_floor, explore_first_moves, explore_temp_mult,
                     dirichlet_epsilon, dirichlet_alpha)
                    for i in range(bs)
                ]
                chunks: list[list] = [[] for _ in range(actual_workers)]
                for i, cfg in enumerate(configs):
                    chunks[i % actual_workers].append(cfg)
                args_list = [(cpu_sd, chunk) for chunk in chunks if chunk]
                results = pool.map(_pool_worker_collect, args_list)
                batch = [ep for worker_eps in results for ep in worker_eps]
            else:
                batch = [
                    collect_episode(
                        net, device,
                        ep_cursor + i + 1, temp_floor,
                        explore_first_moves, explore_temp_mult,
                        dirichlet_epsilon, dirichlet_alpha,
                    )
                    for i in range(bs)
                ]

            for ep in batch:
                scores.append(ep["score"])
                if ep["won"]:
                    wins += 1
            ep_cursor += bs

            # --- GPU 批量更新（PPO 或 REINFORCE）---
            ent_eff = _effective_entropy_coef(ep_cursor, entropy_coef)
            result = _reevaluate_and_update(
                net, opt, batch, device, gamma, gae_lambda,
                return_scale, value_coef, ent_eff, normalize_adv,
                adv_min_std, value_huber_beta, grad_clip,
                ppo_epochs=ppo_epochs, ppo_clip=ppo_clip,
            )
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
                ppo_tag = f"ppo×{ppo_epochs}" if ppo_epochs > 1 else "pg"
                print(
                    f"ep {ep_cursor}  |  {ppo_tag}  |  dev={device.type}  |  thr={wt}  |  "
                    f"sc={last_ep['score']:.0f}  avg100={avg:.1f}  win%={wr:.1f}%  steps={last_ep['steps']}  |  "
                    f"π={lp_str}  V={lv_str}  H={he_str}{hole_str}  |  {dt:.1f}s",
                    file=sys.stderr,
                )
                t0 = time.perf_counter()

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
    p = argparse.ArgumentParser(description="Block Blast PyTorch 自博弈 RL（支持 MPS/CUDA）")
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
        default=1.5,
        help="与 explore-first-moves 联用",
    )
    p.add_argument(
        "--dirichlet-epsilon",
        type=float,
        default=0.0,
        help="Dirichlet 混合权重初值；0 关闭（已有温度采样足够探索）",
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
        default=1,
        help="多进程并行采集 worker 数；1=单进程（GPU 采集），>1=CPU 多进程采集 + GPU 更新",
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
            dp_on = os.environ.get("RL_CUDA_DP_VALUE", "1").lower() not in ("0", "false", "no")
            print(
                f"  CUDA data_parallel 卡: {dp_ids}  |  价值头多卡: {'on' if dp_on else 'off'} (RL_CUDA_DP_VALUE)",
                file=sys.stderr,
            )

    arch = args.arch.strip().lower()
    net = build_policy_net(
        arch,
        width=args.width,
        policy_depth=args.policy_depth,
        value_depth=args.value_depth,
        mlp_ratio=args.mlp_ratio,
        device=device,
        conv_channels=getattr(args, "conv_channels", 32),
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
