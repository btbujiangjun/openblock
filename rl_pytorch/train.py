"""
自博弈 + 策略梯度（价值基线），PyTorch；支持 **MPS**（Apple GPU）/ CUDA / CPU。

参考 AlphaGo / AlphaZero 的实用化改进（本仓库为单步决策、无完整 MCTS）：
  - 可选 **共享主干**（--arch shared）：状态只编码一次，策略对 (h(s), ψ(a)) 打分，减轻大张量合法步下的重复计算。
  - **GAE(λ)**（默认开启）：比纯蒙特卡洛回报更低方差的优势估计，利于稳定训练。
  - **根节点 Dirichlet 噪声**（自博弈）：与 AZ 类似，在合法动作上混合探索性先验，缓解过早坍缩。
  - **开局更高温度**：前若干步放大 temperature，鼓励开局多样性。

用法:
  pip install -r requirements-rl.txt
  python -m rl_pytorch.train --episodes 2000 --device auto --save-every 100 --save rl_checkpoints/bb_policy.pt
  python -m rl_pytorch.train --arch shared --gae-lambda 0.95 --dirichlet-epsilon 0.25

--device auto：macOS 上优先 **MPS**；其他平台为 CUDA → MPS → CPU。详见 device.py。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch.distributions import Categorical, Dirichlet

from .config import WIN_SCORE_THRESHOLD
from .game_rules import RL_REWARD_SHAPING, rl_curriculum_enabled, rl_win_threshold_for_episode
from .device import adam_for_training, apply_throughput_tuning, maybe_mps_synchronize, resolve_training_device, tensor_to_device
from .features import PHI_DIM, STATE_FEATURE_DIM, build_phi_batch
from .model import PolicyValueNet, SharedPolicyValueNet
from .simulator import BlockBlastSimulator


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


def _checkpoint_meta(
    net: PolicyValueNet | SharedPolicyValueNet,
    device: torch.device,
    gamma: float,
    lr: float,
    arch: str,
    mlp_ratio: float,
    policy_depth: int,
    value_depth: int,
) -> dict:
    meta = {
        "gamma": gamma,
        "lr": lr,
        "device": str(device),
        "phi_dim": PHI_DIM,
        "state_dim": STATE_FEATURE_DIM,
        "arch": arch,
        "mlp_ratio": mlp_ratio,
    }
    if isinstance(net, SharedPolicyValueNet):
        meta["width"] = int(net.shared_stem.out_features)
        sd = len(net.shared_blocks)
        meta["shared_depth"] = sd
        meta["policy_depth"] = policy_depth
        meta["value_depth"] = value_depth
    else:
        meta["width"] = int(net.policy_stem.out_features)
        meta["policy_depth"] = len(net.policy_blocks)
        meta["value_depth"] = len(net.value_blocks)
    return meta


def build_policy_net(
    arch: str,
    width: int,
    policy_depth: int,
    value_depth: int,
    mlp_ratio: float,
    device: torch.device,
) -> PolicyValueNet | SharedPolicyValueNet:
    arch = (arch or "split").lower()
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
    net: PolicyValueNet | SharedPolicyValueNet,
    device: torch.device,
    global_ep: int,
    temp_floor: float,
    explore_first_moves: int,
    explore_temp_mult: float,
    dirichlet_epsilon: float,
    dirichlet_alpha: float,
) -> dict:
    sim = BlockBlastSimulator("normal")
    sim.win_score_threshold = rl_win_threshold_for_episode(global_ep)
    log_probs: list[torch.Tensor] = []
    states: list[torch.Tensor] = []
    rewards: list[float] = []
    entropies: list[torch.Tensor] = []

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

        phi = tensor_to_device(torch.from_numpy(phi_np), device)
        s = tensor_to_device(torch.from_numpy(state_np), device)

        logits = net.forward_policy_logits(phi)
        temp = _temperature_for_move(
            global_ep, step_idx, temp_floor, explore_first_moves, explore_temp_mult
        )
        d_eps = _dirichlet_epsilon_for_ep(global_ep, dirichlet_epsilon)
        idx, log_p, ent = _mix_dirichlet_and_sample(
            logits, temp, d_eps, dirichlet_alpha
        )
        entropies.append(ent)

        a = legal[int(idx.item())]
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))

        log_probs.append(log_p)
        states.append(s)
        rewards.append(r)
        step_idx += 1

    won = sim.score >= sim.win_score_threshold
    sp = float(RL_REWARD_SHAPING.get("stuckPenalty") or 0.0)
    if rewards and not won and sp and (sim.is_terminal() or not sim.get_legal_actions()):
        rewards[-1] += sp

    return {
        "log_probs": log_probs,
        "states": states,
        "rewards": rewards,
        "entropies": entropies,
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


def train_loop(
    net: PolicyValueNet | SharedPolicyValueNet,
    device: torch.device,
    episodes: int,
    lr: float,
    value_coef: float,
    gamma: float,
    log_every: int,
    save_every: int,
    ckpt_path: Path | None,
    resume: Path | None,
    entropy_coef: float = 0.012,
    normalize_adv: bool = True,
    grad_clip: float = 1.0,
    adv_min_std: float = 1e-4,
    value_huber_beta: float = 150.0,
    gae_lambda: float = 0.95,
    temp_floor: float = 0.35,
    explore_first_moves: int = 24,
    explore_temp_mult: float = 1.35,
    dirichlet_epsilon: float = 0.22,
    dirichlet_alpha: float = 0.28,
    train_arch: str = "split",
    mlp_ratio: float = 2.0,
    policy_depth_arg: int = 6,
    value_depth_arg: int = 5,
) -> int:
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

    wins = 0
    scores: list[float] = []
    t0 = time.perf_counter()
    return_scale = float(os.environ.get("RL_RETURN_SCALE", "0.025"))

    for e in range(start_ep, start_ep + episodes):
        global_ep = e + 1
        ep = collect_episode(
            net,
            device,
            global_ep=global_ep,
            temp_floor=temp_floor,
            explore_first_moves=explore_first_moves,
            explore_temp_mult=explore_temp_mult,
            dirichlet_epsilon=dirichlet_epsilon,
            dirichlet_alpha=dirichlet_alpha,
        )
        rewards = ep["rewards"]
        scores.append(ep["score"])
        if ep["won"]:
            wins += 1

        if not ep["log_probs"]:
            continue

        r_train = [float(r) * return_scale for r in rewards]

        states_t = torch.stack(ep["states"], dim=0)
        log_probs_t = torch.stack(ep["log_probs"], dim=0)
        entropies_t = torch.stack(ep["entropies"], dim=0)

        values = net.forward_value(states_t)
        values = torch.nan_to_num(values, nan=0.0, posinf=1e5, neginf=-1e5)
        values = torch.clamp(values, -1e5, 1e5)
        log_probs_t = _clamp_log_probs_pg(log_probs_t)

        if gae_lambda > 1e-8:
            adv, returns = compute_gae_advantages_and_returns(r_train, values, gamma, gae_lambda, device)
        else:
            returns = tensor_to_device(episode_returns(r_train, gamma), device)
            adv = returns - values.detach()
        returns = torch.nan_to_num(returns, nan=0.0, posinf=1e5, neginf=-1e5)
        returns = torch.clamp(returns, -1e5, 1e5)
        if normalize_adv:
            adv = _normalize_advantages(adv, min_std=adv_min_std)
        else:
            adv = torch.nan_to_num(adv, nan=0.0, posinf=1e3, neginf=-1e3)
            adv = torch.clamp(adv, -100.0, 100.0)

        policy_loss = -(log_probs_t * adv).mean()
        value_loss = F.smooth_l1_loss(
            values, returns, reduction="mean", beta=max(value_huber_beta, 1e-6)
        )
        entropy_mean = torch.nan_to_num(entropies_t.mean(), nan=0.0, posinf=0.0, neginf=0.0)

        ent_eff = _effective_entropy_coef(e + 1, entropy_coef)
        loss = policy_loss + value_coef * value_loss - ent_eff * entropy_mean

        opt.zero_grad()
        if torch.isfinite(loss).item():
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(), max(grad_clip, 1e-8))
            opt.step()
        else:
            opt.zero_grad(set_to_none=True)
        if device.type == "mps" and os.environ.get("RL_MPS_SYNC", "").lower() in ("1", "true", "yes"):
            maybe_mps_synchronize(device)

        if (e + 1) % log_every == 0:
            dt = time.perf_counter() - t0
            n = min(100, len(scores))
            avg = sum(scores[-n:]) / n if n else 0.0
            wr = 100.0 * wins / log_every
            wins = 0
            wt = ep.get("win_threshold", WIN_SCORE_THRESHOLD)
            print(
                f"episode {e + 1}  |  device={device.type}  |  win_thr={wt}  |  last_score={ep['score']:.0f}  |  "
                f"avg100={avg:.1f}  |  win%_last{log_every}={wr:.1f}%  |  last_steps={ep['steps']}  |  "
                f"loss_pi={policy_loss.item():.4f}  loss_v={value_loss.item():.4f}  "
                f"H={entropy_mean.item():.3f}  |  {dt:.1f}s",
                file=sys.stderr,
            )
            t0 = time.perf_counter()

        se = max(1, save_every)
        if ckpt_path and (e + 1) % se == 0:
            ckpt_path.parent.mkdir(parents=True, exist_ok=True)
            torch.save(
                {
                    "model": net.state_dict(),
                    "optimizer": opt.state_dict(),
                    "episodes": e + 1,
                    "meta": _checkpoint_meta(
                        net,
                        device,
                        gamma,
                        lr,
                        train_arch,
                        mlp_ratio,
                        policy_depth_arg,
                        value_depth_arg,
                    ),
                },
                ckpt_path,
            )

    return start_ep + episodes


def main() -> None:
    p = argparse.ArgumentParser(description="Block Blast PyTorch 自博弈 RL（支持 MPS/CUDA）")
    p.add_argument("--episodes", type=int, default=1000)
    p.add_argument("--lr", type=float, default=1.5e-4, help="Adam；与浏览器后端 RL_LR 默认一致")
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--value-coef", type=float, default=0.18, help="价值头损失权重（与 RL_VALUE_COEF 默认一致）")
    p.add_argument(
        "--value-huber-beta",
        type=float,
        default=150.0,
        help="smooth_l1 的 beta，回报尺度大时缓和 value loss",
    )
    p.add_argument(
        "--adv-min-std",
        type=float,
        default=1e-4,
        help="advantage 标准差低于此则不做去均值标准化，避免整段 A 变 0",
    )
    p.add_argument(
        "--entropy-coef",
        type=float,
        default=0.012,
        help="策略熵 bonus（越大探索越强）；0 关闭；默认略低于旧版以利后期利用",
    )
    p.add_argument(
        "--no-adv-norm",
        action="store_true",
        help="关闭每局 advantage 标准化",
    )
    p.add_argument("--grad-clip", type=float, default=1.0, help="梯度裁剪范数")
    p.add_argument(
        "--width",
        type=int,
        default=384,
        help="隐层宽度；高维空间观测（棋盘+待选块）建议 ≥384",
    )
    p.add_argument("--policy-depth", type=int, default=6)
    p.add_argument("--value-depth", type=int, default=5)
    p.add_argument("--mlp-ratio", type=float, default=2.0)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument(
        "--device",
        type=str,
        default="auto",
        help="auto | mps | cuda | cpu（auto：macOS 优先 MPS，其余平台 CUDA>MPS>CPU）",
    )
    p.add_argument("--save", type=str, default="rl_checkpoints/bb_policy.pt")
    p.add_argument("--resume", type=str, default="")
    p.add_argument("--log-every", type=int, default=50, help="每隔多少局打印一行统计")
    p.add_argument(
        "--save-every",
        type=int,
        default=100,
        help="每隔多少局保存 checkpoint（默认 100，减少写盘）",
    )
    p.add_argument(
        "--arch",
        type=str,
        default="split",
        choices=("split", "shared"),
        help="split=策略/价值双塔（与旧 checkpoint 兼容）；shared=AlphaZero 式共享主干（新训推荐，算子更少）",
    )
    p.add_argument(
        "--gae-lambda",
        type=float,
        default=0.95,
        help="GAE λ；0 关闭 GAE，改用蒙特卡洛回报 − V（旧行为）",
    )
    p.add_argument(
        "--temp-floor",
        type=float,
        default=0.35,
        help="温度下限（随全局局数衰减的底）",
    )
    p.add_argument(
        "--explore-first-moves",
        type=int,
        default=18,
        help="开局前若干步温度乘 explore-temp-mult（AlphaZero 式前段多探索）；0 关闭",
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
        default=0.12,
        help="根分布混合 Dirichlet 初值；训练中随局数衰减至 RL_DIRICHLET_EPS_END；0 关闭",
    )
    p.add_argument(
        "--dirichlet-alpha",
        type=float,
        default=0.28,
        help="Dirichlet 总浓度（按合法步数均分到各动作，类似 AlphaZero）",
    )
    args = p.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    device = resolve_training_device(args.device)
    apply_throughput_tuning(device)
    print(f"使用设备: {device}", file=sys.stderr)

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
