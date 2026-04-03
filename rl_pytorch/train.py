"""
自博弈 + REINFORCE（价值基线），PyTorch；支持 **MPS**（Apple GPU）/ CUDA / CPU。

用法:
  pip install -r requirements-rl.txt
  python -m rl_pytorch.train --episodes 2000 --device auto --save rl_checkpoints/bb_policy.pt

--device auto: 优先 cuda，其次 mps，否则 cpu。
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch.distributions import Categorical

from .config import WIN_SCORE_THRESHOLD
from .features import build_phi_batch
from .model import PolicyValueNet
from .simulator import BlockBlastSimulator


def resolve_device(preference: str) -> torch.device:
    pref = (preference or "auto").lower().strip()
    if pref == "auto":
        if torch.cuda.is_available():
            return torch.device("cuda")
        mps_b = getattr(torch.backends, "mps", None)
        if mps_b is not None and mps_b.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    if pref == "cuda":
        if not torch.cuda.is_available():
            print("CUDA 不可用，回退 CPU", file=sys.stderr)
            return torch.device("cpu")
        return torch.device("cuda")
    if pref == "mps":
        mps_b = getattr(torch.backends, "mps", None)
        if mps_b is None or not mps_b.is_available():
            print("MPS 不可用（需 Apple Silicon + 支持 MPS 的 PyTorch），回退 CPU", file=sys.stderr)
            return torch.device("cpu")
        return torch.device("mps")
    if pref == "cpu":
        return torch.device("cpu")
    print(f"未知 --device={preference!r}，使用 CPU", file=sys.stderr)
    return torch.device("cpu")


def collect_episode(net: PolicyValueNet, device: torch.device, temperature: float) -> dict:
    sim = BlockBlastSimulator("normal")
    log_probs: list[torch.Tensor] = []
    states: list[torch.Tensor] = []
    rewards: list[float] = []

    while True:
        if sim.is_terminal():
            break
        legal = sim.get_legal_actions()
        if not legal:
            break

        state_np, phi_np = build_phi_batch(sim, legal)
        if phi_np.shape[0] == 0:
            break

        phi = torch.from_numpy(phi_np).to(device)
        s = torch.from_numpy(state_np).to(device)

        logits = net.forward_policy_logits(phi)
        if temperature > 1e-6:
            logits = logits / temperature

        dist = Categorical(logits=logits)
        idx = dist.sample()
        log_p = dist.log_prob(idx)

        a = legal[int(idx.item())]
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))

        log_probs.append(log_p)
        states.append(s)
        rewards.append(r)

    won = sim.score >= WIN_SCORE_THRESHOLD
    return {
        "log_probs": log_probs,
        "states": states,
        "rewards": rewards,
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
    ckpt_path: Path | None,
    resume: Path | None,
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

    for e in range(start_ep, start_ep + episodes):
        temp = max(0.4, 1.0 - (e - start_ep) * 0.002)

        ep = collect_episode(net, device, temperature=temp)
        rewards = ep["rewards"]
        scores.append(ep["score"])
        if ep["won"]:
            wins += 1

        if not ep["log_probs"]:
            continue

        returns = episode_returns(rewards, gamma).to(device)
        states_t = torch.stack(ep["states"], dim=0)
        log_probs_t = torch.stack(ep["log_probs"], dim=0)

        values = net.forward_value(states_t)
        adv = returns - values.detach()

        policy_loss = -(log_probs_t * adv).mean()
        value_loss = F.mse_loss(values, returns)

        loss = policy_loss + value_coef * value_loss

        opt.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(net.parameters(), 1.0)
        opt.step()

        if (e + 1) % log_every == 0:
            dt = time.perf_counter() - t0
            n = min(100, len(scores))
            avg = sum(scores[-n:]) / n if n else 0.0
            wr = 100.0 * wins / log_every
            wins = 0
            print(
                f"episode {e + 1}  |  device={device.type}  |  last_score={ep['score']:.0f}  |  "
                f"avg100={avg:.1f}  |  win%_last{log_every}={wr:.1f}%  |  last_steps={ep['steps']}  |  "
                f"loss_pi={policy_loss.item():.4f}  loss_v={value_loss.item():.4f}  |  {dt:.1f}s",
                file=sys.stderr,
            )
            t0 = time.perf_counter()

        if ckpt_path and (e + 1) % max(log_every, 1) == 0:
            ckpt_path.parent.mkdir(parents=True, exist_ok=True)
            torch.save(
                {
                    "model": net.state_dict(),
                    "optimizer": opt.state_dict(),
                    "episodes": e + 1,
                    "meta": {"gamma": gamma, "lr": lr, "device": str(device)},
                },
                ckpt_path,
            )

    return start_ep + episodes


def main() -> None:
    p = argparse.ArgumentParser(description="Block Blast PyTorch 自博弈 RL（支持 MPS/CUDA）")
    p.add_argument("--episodes", type=int, default=1000)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--value-coef", type=float, default=0.5)
    p.add_argument("--width", type=int, default=256)
    p.add_argument("--policy-depth", type=int, default=4)
    p.add_argument("--value-depth", type=int, default=4)
    p.add_argument("--mlp-ratio", type=float, default=2.0)
    p.add_argument("--seed", type=int, default=0)
    p.add_argument(
        "--device",
        type=str,
        default="auto",
        help="auto | mps | cuda | cpu（auto：cuda > mps > cpu）",
    )
    p.add_argument("--save", type=str, default="rl_checkpoints/bb_policy.pt")
    p.add_argument("--resume", type=str, default="")
    p.add_argument("--log-every", type=int, default=50)
    args = p.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(args.seed)

    device = resolve_device(args.device)
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
        ckpt_path=save_path,
        resume=resume_path,
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
