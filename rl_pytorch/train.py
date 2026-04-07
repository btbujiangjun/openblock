"""
自博弈 + 策略梯度（价值基线），PyTorch；支持 **MPS**（Apple GPU）/ CUDA / CPU。

架构选择（--arch）：
  light-shared  默认，~20K 参数；2 层 64 宽共享主干，匹配 161D 手工特征的有效策略维度
  light         ~28K 参数双塔
  shared        残差 MLP 共享主干（~1.2M 参数，旧默认）
  split         残差 MLP 双塔

GPU 加速设计：
  - 采集阶段 no_grad + 存 numpy，不构建计算图
  - 更新阶段 forward_batched 一次性处理全部 step 的 state/action（共享编码一次算完）
  - log_prob / entropy 向量化 padded log_softmax，零 Python 循环
  - GAE 纯 CPU numpy，避免逐步 MPS→CPU 同步
  - --n-workers 多进程并行采集（CPU 推理），GPU 专做批量更新
  - **CUDA 多卡**：环境变量 ``RL_CUDA_DEVICE_IDS=all`` 或 ``0,1``；价值头用 ``torch.nn.parallel.data_parallel``
    （``RL_CUDA_DP_VALUE=1`` 默认开启；设为 0 关闭）。主卡由 ``--device cuda`` / ``cuda:0`` 决定。

用法:
  CUDA_VISIBLE_DEVICES=0,1 python -m rl_pytorch.train --episodes 5000 --device cuda --batch-episodes 16
  RL_CUDA_DEVICE_IDS=all python -m rl_pytorch.train --device cuda
  python -m rl_pytorch.train --n-workers 4 --batch-episodes 16   # 多核并行采集
  python -m rl_pytorch.train --arch shared --width 256 --policy-depth 4  # 兼容旧 checkpoint

--device：``auto`` | ``cpu`` | ``mps`` | ``cuda`` | ``cuda:N``。详见 ``rl_pytorch/device.py``。
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

import numpy as np
import torch
import torch.nn.functional as F
from torch.distributions import Categorical, Dirichlet

from .config import WIN_SCORE_THRESHOLD
from .game_rules import RL_REWARD_SHAPING, rl_curriculum_enabled, rl_win_threshold_for_episode
from .device import (
    adam_for_training,
    apply_throughput_tuning,
    device_summary_line,
    maybe_mps_synchronize,
    resolve_cuda_device_ids_for_data_parallel,
    resolve_training_device,
    tensor_to_device,
)
from .features import PHI_DIM, STATE_FEATURE_DIM, build_phi_batch
from .model import LightPolicyValueNet, LightSharedPolicyValueNet, PolicyValueNet, SharedPolicyValueNet
from .simulator import BlockBlastSimulator

# ---------------------------------------------------------------------------
# 多进程 worker（CPU 推理采集，GPU 专做更新）
# ---------------------------------------------------------------------------
_pool_net: AnyNet | None = None
_pool_device = torch.device("cpu")


def _pool_worker_init(arch: str, width: int, pd: int, vd: int, mr: float):
    """每个 worker 进程初始化一份模型（CPU）。"""
    global _pool_net, _pool_device
    _pool_net = build_policy_net(arch, width, pd, vd, mr, _pool_device)
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


AnyNet = Union[PolicyValueNet, SharedPolicyValueNet, LightPolicyValueNet, LightSharedPolicyValueNet]


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
    if isinstance(net, LightSharedPolicyValueNet):
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
) -> AnyNet:
    arch = (arch or "light-shared").lower()
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


def _effective_entropy_coef(global_ep: int, base: float) -> float:
    """与 rl_backend 一致：随局数线性降低熵系数。"""
    lo = float(os.environ.get("RL_ENTROPY_COEF_MIN", "0.004"))
    span = float(os.environ.get("RL_ENTROPY_DECAY_EPISODES", "12000"))
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
    base = max(temp_floor, 1.0 - global_ep * 0.002)
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

        temp = _temperature_for_move(
            global_ep, step_idx, temp_floor, explore_first_moves, explore_temp_mult
        )
        d_eps = _dirichlet_epsilon_for_ep(global_ep, dirichlet_epsilon)
        idx, _, _ = _mix_dirichlet_and_sample(
            logits, temp, d_eps, dirichlet_alpha
        )

        a = legal[int(idx.item())]
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))

        trajectory.append({
            "state": state_np.copy(),
            "action_feats": phi_np[:, STATE_FEATURE_DIM:].copy(),
            "n_actions": phi_np.shape[0],
            "chosen_idx": int(idx.item()),
            "reward": r,
        })
        step_idx += 1

    won = sim.score >= sim.win_score_threshold
    sp = float(RL_REWARD_SHAPING.get("stuckPenalty") or 0.0)
    if trajectory and not won and sp and (sim.is_terminal() or not sim.get_legal_actions()):
        trajectory[-1]["reward"] += sp

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
) -> dict | None:
    """GPU 批量再评估：把全部 step 的 state/action 拼成大张量，一次过 GPU。"""
    valid = [ep for ep in batch if ep["trajectory"]]
    if not valid:
        return None

    all_states: list[np.ndarray] = []
    all_action_feats: list[np.ndarray] = []
    all_n_actions: list[int] = []
    all_chosen: list[int] = []
    all_rewards: list[float] = []
    ep_lengths: list[int] = []

    for ep in valid:
        traj = ep["trajectory"]
        ep_lengths.append(len(traj))
        for step in traj:
            all_states.append(step["state"])
            all_action_feats.append(step["action_feats"])
            all_n_actions.append(step["n_actions"])
            all_chosen.append(step["chosen_idx"])
            all_rewards.append(step["reward"])

    total_steps = len(all_states)
    if total_steps == 0:
        return None

    states_t = tensor_to_device(torch.from_numpy(np.stack(all_states)), device)
    action_feats_t = tensor_to_device(
        torch.from_numpy(np.concatenate(all_action_feats, axis=0)), device
    )
    n_actions_t = torch.tensor(all_n_actions, device=device, dtype=torch.long)

    # --- 可选：CUDA 多卡上对价值头 data_parallel（light / light-shared）---
    values_precomputed: torch.Tensor | None = None
    dp_ids = resolve_cuda_device_ids_for_data_parallel()
    use_dp_value = (
        device.type == "cuda"
        and len(dp_ids) > 1
        and os.environ.get("RL_CUDA_DP_VALUE", "1").lower() not in ("0", "false", "no")
        and isinstance(net, (LightPolicyValueNet, LightSharedPolicyValueNet))
    )
    if use_dp_value:
        from torch.nn.parallel import data_parallel as dp_fn

        values_precomputed = dp_fn(
            _ValueForward(net), states_t, device_ids=dp_ids, output_device=device
        )

    # --- 单次融合前向 ---
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

    # --- 向量化 per-step log_prob 与 entropy（消除 Python 循环）---
    max_n = int(n_actions_t.max().item())
    padded = logits_flat.new_full((total_steps, max_n), float("-inf"))
    col_range = torch.arange(max_n, device=device)
    mask = col_range.unsqueeze(0) < n_actions_t.unsqueeze(1)
    padded[mask] = logits_flat

    lp_2d = torch.log_softmax(padded, dim=1)
    chosen_t = torch.tensor(all_chosen, device=device, dtype=torch.long).unsqueeze(1)
    lp_t = _clamp_log_probs_pg(lp_2d.gather(1, chosen_t).squeeze(1))

    probs_2d = lp_2d.exp() * mask.float()
    ent_t = -(probs_2d * lp_2d.masked_fill(~mask, 0.0)).sum(dim=1)

    # --- 每局 GAE（纯 CPU numpy，避免逐步 MPS 同步）→ 跨局 advantage 归一化 ---
    vals_np = values_flat.detach().cpu().numpy()
    adv_np = np.empty(total_steps, dtype=np.float32)
    rets_np = np.empty(total_steps, dtype=np.float32)
    v_off = 0
    r_off = 0
    for ep_len in ep_lengths:
        v = vals_np[v_off : v_off + ep_len]
        r = np.array([all_rewards[r_off + j] * return_scale for j in range(ep_len)], dtype=np.float32)
        t_len = ep_len
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
        v_off += ep_len
        r_off += ep_len

    adv_cat = tensor_to_device(torch.from_numpy(adv_np), device)
    rets_cat = tensor_to_device(torch.from_numpy(np.nan_to_num(rets_np, nan=0.0, posinf=1e5, neginf=-1e5).clip(-1e5, 1e5)), device)

    if normalize_adv:
        adv_cat = _normalize_advantages(adv_cat, min_std=adv_min_std)
    else:
        adv_cat = torch.nan_to_num(adv_cat, nan=0.0, posinf=1e3, neginf=-1e3).clamp(-100, 100)

    policy_loss = -(lp_t * adv_cat).mean()
    value_loss = F.smooth_l1_loss(values_flat, rets_cat, reduction="mean", beta=max(value_huber_beta, 1e-6))
    entropy_mean = torch.nan_to_num(ent_t.mean(), nan=0.0, posinf=0.0, neginf=0.0)

    loss = policy_loss + value_coef * value_loss - entropy_coef * entropy_mean

    opt.zero_grad()
    if torch.isfinite(loss).item():
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), max(grad_clip, 1e-8))
        opt.step()
    else:
        opt.zero_grad(set_to_none=True)

    return {
        "policy_loss": float(policy_loss.item()),
        "value_loss": float(value_loss.item()),
        "entropy": float(entropy_mean.item()),
    }


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
    train_arch: str = "light-shared",
    mlp_ratio: float = 2.0,
    policy_depth_arg: int = 4,
    value_depth_arg: int = 4,
    batch_episodes: int = 8,
    n_workers: int = 1,
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
        net.load_state_dict(ckpt["model"])
        if "optimizer" in ckpt:
            opt.load_state_dict(ckpt["optimizer"])
        start_ep = int(ckpt.get("episodes", 0))
        print(f"已从 {resume} 恢复，继续自第 {start_ep} 局", file=sys.stderr)

    # --- 多进程 worker pool ---
    pool = None
    actual_workers = max(1, n_workers)
    if actual_workers > 1:
        w = getattr(net, "width", 64)
        ctx = mp.get_context("spawn")
        pool = ctx.Pool(
            actual_workers,
            initializer=_pool_worker_init,
            initargs=(train_arch, w, policy_depth_arg, value_depth_arg, mlp_ratio),
        )
        print(f"多进程采集: {actual_workers} workers (CPU inference → GPU update)", file=sys.stderr)

    wins = 0
    scores: list[float] = []
    t0 = time.perf_counter()
    return_scale = float(os.environ.get("RL_RETURN_SCALE", "0.1"))
    last_update: dict | None = None
    last_log_ep = start_ep
    mps_sync = device.type == "mps" and os.environ.get("RL_MPS_SYNC", "").lower() in ("1", "true", "yes")

    ep_cursor = start_ep
    try:
        while ep_cursor < start_ep + episodes:
            bs = min(batch_episodes, start_ep + episodes - ep_cursor)

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

            # --- GPU 批量更新 ---
            ent_eff = _effective_entropy_coef(ep_cursor, entropy_coef)
            result = _reevaluate_and_update(
                net, opt, batch, device, gamma, gae_lambda,
                return_scale, value_coef, ent_eff, normalize_adv,
                adv_min_std, value_huber_beta, grad_clip,
            )
            if result:
                last_update = result
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
                print(
                    f"episode {ep_cursor}  |  device={device.type}  |  win_thr={wt}  |  last_score={last_ep['score']:.0f}  |  "
                    f"avg100={avg:.1f}  |  win%_last{eps_since}={wr:.1f}%  |  last_steps={last_ep['steps']}  |  "
                    f"loss_pi={lp_str}  loss_v={lv_str}  "
                    f"H={he_str}  |  {dt:.1f}s",
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
        default=1e-3,
        help="Adam；light 模型配合 1e-3 快速收敛（重模型建议 3e-4）",
    )
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--value-coef", type=float, default=0.25, help="价值头损失权重")
    p.add_argument(
        "--value-huber-beta",
        type=float,
        default=10.0,
        help="smooth_l1 beta；return_scale=0.1 时回报在 [-5, 25] 区间，beta=10 合理",
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
        default=0.01,
        help="策略熵 bonus；0 关闭",
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
        default=64,
        help="隐层宽度；light 系列默认 64（~20K 参数）；旧 shared/split 用 256",
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
        default="light-shared",
        choices=("light-shared", "light", "shared", "split"),
        help="light-shared=轻量共享（默认，~20K）；light=轻量双塔（~28K）；shared/split=旧版重模型",
    )
    p.add_argument(
        "--batch-episodes",
        type=int,
        default=8,
        help="采集多少局后做一次梯度更新（batch REINFORCE，降低方差）",
    )
    p.add_argument(
        "--gae-lambda",
        type=float,
        default=0.95,
        help="GAE λ；0 关闭 GAE",
    )
    p.add_argument(
        "--temp-floor",
        type=float,
        default=0.3,
        help="温度下限",
    )
    p.add_argument(
        "--explore-first-moves",
        type=int,
        default=10,
        help="开局前若干步温度乘 explore-temp-mult；0 关闭",
    )
    p.add_argument(
        "--explore-temp-mult",
        type=float,
        default=1.2,
        help="与 explore-first-moves 联用",
    )
    p.add_argument(
        "--dirichlet-epsilon",
        type=float,
        default=0.08,
        help="Dirichlet 混合权重初值；训练中衰减；0 关闭",
    )
    p.add_argument(
        "--dirichlet-alpha",
        type=float,
        default=0.28,
        help="Dirichlet 总浓度",
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
    )

    resume_path = Path(args.resume) if args.resume else None
    save_path = Path(args.save)

    n_params = sum(p.numel() for p in net.parameters())
    print(f"架构: {arch}  |  参数量: {n_params:,}", file=sys.stderr)

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
