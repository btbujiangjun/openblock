"""
自博弈 + REINFORCE（价值基线），**MLX** 后端；较原 PyTorch 版加深网络（残差 MLP 双塔）。

依赖: pip install mlx numpy
运行: python -m rl_mlx.train --episodes 1000 --save rl_checkpoints/bb_mlx.safetensors

需在 Apple Silicon（或 MLX 支持环境）上安装 mlx。
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from pathlib import Path

import mlx.core as mx
import mlx.nn as nn
import mlx.optimizers as optim
import numpy as np

from .config import WIN_SCORE_THRESHOLD
from .game_rules import RL_REWARD_SHAPING
from .features import build_phi_batch
from .model import PolicyValueNet
from .simulator import BlockBlastSimulator


def _softmax_np(x: np.ndarray, temperature: float) -> np.ndarray:
    if temperature <= 1e-8:
        temperature = 1e-8
    z = (x - x.max()) / temperature
    e = np.exp(z)
    return e / e.sum()


def collect_episode(model: PolicyValueNet, temperature: float) -> dict:
    """采样阶段用 numpy 分类分布；反传时在 loss 内重算 log 概率（标准 REINFORCE）。"""
    sim = BlockBlastSimulator("normal")
    trajectory: list[dict] = []

    while True:
        if sim.is_terminal():
            break
        legal = sim.get_legal_actions()
        if not legal:
            break

        state_np, phi_np = build_phi_batch(sim, legal)
        if phi_np.shape[0] == 0:
            break

        logits = model.policy_logits(mx.array(phi_np))
        mx.eval(logits)
        logits_np = np.asarray(logits, dtype=np.float64)
        probs = _softmax_np(logits_np, temperature)
        idx = int(np.random.choice(len(probs), p=probs))

        a = legal[idx]
        r = float(sim.step(a["block_idx"], a["gx"], a["gy"]))

        trajectory.append(
            {
                "phi": phi_np.astype(np.float32),
                "state": state_np.astype(np.float32),
                "idx": idx,
                "reward": r,
            }
        )

    won = sim.score >= WIN_SCORE_THRESHOLD
    sp = float(RL_REWARD_SHAPING.get("stuckPenalty") or 0.0)
    if trajectory and not won and sp and (sim.is_terminal() or not sim.get_legal_actions()):
        trajectory[-1]["reward"] = float(trajectory[-1]["reward"]) + sp

    return {
        "trajectory": trajectory,
        "score": sim.score,
        "steps": sim.steps,
        "clears": sim.total_clears,
        "won": won,
    }


def episode_returns(rewards: list[float], gamma: float) -> np.ndarray:
    g = 0.0
    out: list[float] = []
    for r in reversed(rewards):
        g = r + gamma * g
        out.append(g)
    out.reverse()
    return np.array(out, dtype=np.float32)


def reinforce_loss_fn(trajectory: list[dict], returns_mx: mx.array, value_coef: float):
    """返回 loss_fn(model) -> scalar，供 nn.value_and_grad 使用。"""

    def loss_fn(m: PolicyValueNet) -> mx.array:
        tlen = len(trajectory)
        if tlen == 0:
            return mx.array(0.0)
        pi_acc = mx.array(0.0)
        v_acc = mx.array(0.0)
        for t in range(tlen):
            tr = trajectory[t]
            phi = mx.array(tr["phi"])
            s = mx.array(tr["state"].reshape(1, -1))
            logits = m.policy_logits(phi)
            log_probs = mx.log_softmax(logits, axis=0)
            log_p = log_probs[tr["idx"]]
            v = m.value(s)[0]
            g = returns_mx[t]
            adv = g - mx.stop_gradient(v)
            pi_acc = pi_acc - log_p * adv
            v_acc = v_acc + (g - v) ** 2
        return (pi_acc / tlen) + value_coef * (v_acc / tlen)

    return loss_fn


def save_checkpoint(
    path: Path,
    model: PolicyValueNet,
    optimizer: optim.Optimizer,
    episodes: int,
    meta: dict,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    weights_path = path.with_suffix(".safetensors")
    nn.save_weights(str(weights_path), model)
    sidecar = {
        "weights": weights_path.name,
        "episodes": episodes,
        "optimizer": type(optimizer).__name__,
        "meta": meta,
    }
    path.with_suffix(".json").write_text(json.dumps(sidecar, indent=2), encoding="utf-8")


def load_weights_only(weights_path: Path, model: PolicyValueNet) -> None:
    nn.load_weights(str(weights_path), model)


def train_loop(
    model: PolicyValueNet,
    optimizer: optim.Optimizer,
    episodes: int,
    lr: float,
    value_coef: float,
    gamma: float,
    log_every: int,
    ckpt_base: Path | None,
    resume_weights: Path | None,
    resume_episodes: int,
) -> int:
    start_ep = resume_episodes
    if resume_weights and resume_weights.is_file():
        load_weights_only(resume_weights, model)
        mx.eval(model.parameters())
        print(f"已从权重恢复: {resume_weights}，自第 {start_ep} 局继续", file=sys.stderr)

    wins = 0
    scores: list[float] = []
    t0 = time.perf_counter()

    for e in range(start_ep, start_ep + episodes):
        temp = max(0.4, 1.0 - (e - start_ep) * 0.002)

        ep = collect_episode(model, temperature=temp)
        traj = ep["trajectory"]
        scores.append(ep["score"])
        if ep["won"]:
            wins += 1

        if not traj:
            continue

        rewards = [tr["reward"] for tr in traj]
        ret_scale = float(os.environ.get("RL_RETURN_SCALE", "0.025"))
        returns_np = episode_returns(rewards, gamma)
        if ret_scale != 1.0:
            returns_np = returns_np * ret_scale
        returns_mx = mx.array(returns_np)

        loss_fn = reinforce_loss_fn(traj, returns_mx, value_coef)
        loss_and_grad_fn = nn.value_and_grad(model, loss_fn)
        loss_val, grads = loss_and_grad_fn(model)
        optimizer.update(model, grads)
        mx.eval(model.parameters(), optimizer.state, loss_val)

        if (e + 1) % log_every == 0:
            dt = time.perf_counter() - t0
            n = min(100, len(scores))
            avg = sum(scores[-n:]) / n if n else 0.0
            wr = 100.0 * wins / log_every
            wins = 0
            lv = float(np.asarray(loss_val))
            print(
                f"episode {e + 1}  |  last_score={ep['score']:.0f}  |  "
                f"avg100={avg:.1f}  |  win%_last{log_every}={wr:.1f}%  |  last_steps={ep['steps']}  |  "
                f"loss={lv:.4f}  |  {dt:.1f}s",
                file=sys.stderr,
            )
            t0 = time.perf_counter()

        if ckpt_base and (e + 1) % max(log_every, 1) == 0:
            save_checkpoint(
                ckpt_base,
                model,
                optimizer,
                e + 1,
                {"gamma": gamma, "lr": lr},
            )

    return start_ep + episodes


def main() -> None:
    p = argparse.ArgumentParser(description="Block Blast MLX 自博弈 RL")
    p.add_argument("--episodes", type=int, default=1000)
    p.add_argument("--lr", type=float, default=3e-4)
    p.add_argument("--gamma", type=float, default=0.99)
    p.add_argument("--value-coef", type=float, default=0.5)
    p.add_argument("--width", type=int, default=256, help="残差块宽度")
    p.add_argument("--policy-depth", type=int, default=4, help="策略塔残差层数")
    p.add_argument("--value-depth", type=int, default=4, help="价值塔残差层数")
    p.add_argument("--mlp-ratio", type=float, default=2.0, help="FFN 隐层相对 width 比例")
    p.add_argument("--seed", type=int, default=0)
    p.add_argument("--save", type=str, default="rl_checkpoints/bb_mlx")
    p.add_argument("--resume-weights", type=str, default="", help=".safetensors 权重路径")
    p.add_argument("--resume-episodes", type=int, default=0, help="已训练局数（优化器不恢复）")
    p.add_argument("--log-every", type=int, default=50)
    args = p.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    mx.random.seed(args.seed)

    model = PolicyValueNet(
        width=args.width,
        policy_depth=args.policy_depth,
        value_depth=args.value_depth,
        mlp_ratio=args.mlp_ratio,
    )
    mx.eval(model.parameters())

    optimizer = optim.Adam(learning_rate=args.lr)

    save_base = Path(args.save)
    resume_w = Path(args.resume_weights) if args.resume_weights else None

    total = train_loop(
        model,
        optimizer,
        episodes=args.episodes,
        lr=args.lr,
        value_coef=args.value_coef,
        gamma=args.gamma,
        log_every=args.log_every,
        ckpt_base=save_base,
        resume_weights=resume_w,
        resume_episodes=args.resume_episodes,
    )

    save_checkpoint(
        save_base,
        model,
        optimizer,
        total,
        {
            "gamma": args.gamma,
            "lr": args.lr,
            "width": args.width,
            "policy_depth": args.policy_depth,
            "value_depth": args.value_depth,
            "mlp_ratio": args.mlp_ratio,
            "win_threshold": WIN_SCORE_THRESHOLD,
            "backend": "mlx",
        },
    )
    print(f"已保存 {save_base.with_suffix('.safetensors')}（累计局数 {total}）", file=sys.stderr)


if __name__ == "__main__":
    main()
