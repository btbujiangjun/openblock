"""
自博弈 + REINFORCE（价值基线），PyTorch；支持 **MPS**（Apple GPU）/ CUDA / CPU。

用法:
  pip install -r requirements-rl.txt
  python -m rl_pytorch.train --episodes 2000 --device auto --save-every 100 --save rl_checkpoints/bb_policy.pt

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
from torch.distributions import Categorical

from .config import WIN_SCORE_THRESHOLD
from .game_rules import RL_REWARD_SHAPING
from .device import maybe_mps_synchronize, resolve_training_device, tensor_to_device
from .features import PHI_DIM, STATE_FEATURE_DIM, build_phi_batch
from .model import PolicyValueNet
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


def _effective_entropy_coef(global_ep: int, base: float) -> float:
    """与 rl_backend 一致：随局数线性降低熵系数。"""
    lo = float(os.environ.get("RL_ENTROPY_COEF_MIN", "0.004"))
    span = float(os.environ.get("RL_ENTROPY_DECAY_EPISODES", "12000"))
    if span <= 0 or base <= lo:
        return base
    t = min(1.0, max(0, global_ep) / span)
    return base - (base - lo) * t


def collect_episode(net: PolicyValueNet, device: torch.device, temperature: float) -> dict:
    sim = BlockBlastSimulator("normal")
    log_probs: list[torch.Tensor] = []
    states: list[torch.Tensor] = []
    rewards: list[float] = []
    entropies: list[torch.Tensor] = []

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
        if temperature > 1e-6:
            logits = logits / temperature

        dist = Categorical(logits=logits)
        idx = dist.sample()
        log_p = dist.log_prob(idx)
        entropies.append(dist.entropy())

        a = legal[int(idx.item())]
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))

        log_probs.append(log_p)
        states.append(s)
        rewards.append(r)

    won = sim.score >= WIN_SCORE_THRESHOLD
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
    net: PolicyValueNet,
    device: torch.device,
    episodes: int,
    lr: float,
    value_coef: float,
    gamma: float,
    log_every: int,
    save_every: int,
    ckpt_path: Path | None,
    resume: Path | None,
    entropy_coef: float = 0.015,
    normalize_adv: bool = True,
    grad_clip: float = 1.0,
    adv_min_std: float = 1e-4,
    value_huber_beta: float = 150.0,
) -> int:
    opt = torch.optim.Adam(net.parameters(), lr=lr)
    start_ep = 0
    if resume and resume.is_file():
        try:
            ckpt = torch.load(resume, map_location=device, weights_only=False)
        except TypeError:
            ckpt = torch.load(resume, map_location=device)
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
        # 按全局局数衰减（续训时不会把温度拉回 1.0）
        temp = max(0.35, 1.0 - e * 0.002)

        ep = collect_episode(net, device, temperature=temp)
        rewards = ep["rewards"]
        scores.append(ep["score"])
        if ep["won"]:
            wins += 1

        if not ep["log_probs"]:
            continue

        returns = tensor_to_device(episode_returns(rewards, gamma), device)
        returns = torch.nan_to_num(returns, nan=0.0, posinf=1e5, neginf=-1e5)
        returns = torch.clamp(returns, -1e5, 1e5)
        if return_scale != 1.0:
            returns = returns * return_scale
        states_t = torch.stack(ep["states"], dim=0)
        log_probs_t = torch.stack(ep["log_probs"], dim=0)
        entropies_t = torch.stack(ep["entropies"], dim=0)

        values = net.forward_value(states_t)
        values = torch.nan_to_num(values, nan=0.0, posinf=1e5, neginf=-1e5)
        values = torch.clamp(values, -1e5, 1e5)
        log_probs_t = _clamp_log_probs_pg(log_probs_t)

        adv = returns - values.detach()
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
            print(
                f"episode {e + 1}  |  device={device.type}  |  last_score={ep['score']:.0f}  |  "
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
                    "meta": {
                        "gamma": gamma,
                        "lr": lr,
                        "device": str(device),
                        "width": net.policy_stem.out_features,
                        "policy_depth": len(net.policy_blocks),
                        "value_depth": len(net.value_blocks),
                        "phi_dim": PHI_DIM,
                        "state_dim": STATE_FEATURE_DIM,
                    },
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
        default=0.015,
        help="策略熵 bonus（越大探索越强）；0 关闭",
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
    args = p.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    device = resolve_training_device(args.device)
    print(f"使用设备: {device}", file=sys.stderr)

    net = PolicyValueNet(
        width=args.width,
        policy_depth=args.policy_depth,
        value_depth=args.value_depth,
        mlp_ratio=args.mlp_ratio,
    ).to(device)

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
    )

    save_path.parent.mkdir(parents=True, exist_ok=True)
    torch.save(
        {
            "model": net.state_dict(),
            "episodes": total_eps,
            "meta": {
                "gamma": args.gamma,
                "lr": args.lr,
                "width": args.width,
                "policy_depth": args.policy_depth,
                "value_depth": args.value_depth,
                "mlp_ratio": args.mlp_ratio,
                "phi_dim": PHI_DIM,
                "state_dim": STATE_FEATURE_DIM,
                "win_threshold": WIN_SCORE_THRESHOLD,
                "device": str(device),
            },
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
