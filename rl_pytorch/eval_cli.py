"""
离线贪心评估 PyTorch checkpoint（与网页训练看板的滑动统计独立）。

示例：
  python3 -m rl_pytorch.eval_cli --checkpoint rl_checkpoints/bb_policy.pt --n-games 128 --rounds 3
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _load_net(path: Path, device):
    import torch

    import rl_pytorch.torch_env  # noqa: F401

    from rl_pytorch.train import build_policy_net

    try:
        ckpt = torch.load(path, map_location=device, weights_only=False)
    except TypeError:
        ckpt = torch.load(path, map_location=device)
    meta = dict(ckpt.get("meta") or {})
    arch = str(meta.get("arch", "conv-shared")).lower()
    width = int(meta.get("width", 128))
    policy_depth = int(meta.get("policy_depth", meta.get("shared_depth", 4)))
    value_depth = int(meta.get("value_depth", 4))
    mlp_ratio = float(meta.get("mlp_ratio", 2.0))
    conv_channels = int(meta.get("conv_channels", 32))
    use_point_encoder = bool(meta.get("use_point_encoder", False))

    net = build_policy_net(
        arch,
        width,
        policy_depth,
        value_depth,
        mlp_ratio,
        device,
        conv_channels=conv_channels,
        use_point_encoder=use_point_encoder,
    )
    net.load_state_dict(ckpt["model"], strict=False)
    net.eval()
    episodes = int(ckpt.get("episodes", 0))
    return net, episodes, meta


def main() -> None:
    p = argparse.ArgumentParser(description="OpenBlock RL greedy eval (multi-round seeds)")
    p.add_argument("--checkpoint", type=str, required=True, help="路径 bb_policy.pt")
    p.add_argument("--n-games", type=int, default=128, help="每轮模拟局数")
    p.add_argument("--rounds", type=int, default=3, help="轮数（每轮独立随机种子）")
    p.add_argument("--device", type=str, default="auto")
    p.add_argument("--temperature", type=float, default=0.0, help="0=贪心 argmax")
    p.add_argument("--win-threshold", type=float, default=None, help="默认读 game_rules")
    p.add_argument("--seed-base", type=int, default=20260503)
    p.add_argument("--json", action="store_true", help="仅输出一行 JSON")
    args = p.parse_args()

    path = Path(args.checkpoint)
    if not path.is_file():
        print(f"checkpoint not found: {path}", file=sys.stderr)
        sys.exit(1)

    import random

    import numpy as np
    import torch

    from rl_pytorch.device import resolve_training_device
    from rl_pytorch.eval_gate import run_eval_games

    device = resolve_training_device(args.device)
    net, ckpt_eps, meta = _load_net(path, device)

    rng = random.Random(int(args.seed_base))
    all_scores: list[float] = []
    win_thr_used = None
    last_wr = 0.0
    for _r in range(max(1, int(args.rounds))):
        n = max(1, min(512, int(args.n_games)))
        seeds = [rng.randrange(1, 2**31 - 1) for _ in range(n)]
        m = run_eval_games(
            net,
            device,
            n,
            args.win_threshold,
            temperature=float(args.temperature),
            seeds=seeds,
        )
        all_scores.extend(float(x) for x in (m.get("scores") or []))
        win_thr_used = float(m.get("win_threshold", 0))
        last_wr = float(m.get("win_rate", 0))

    arr = np.asarray(all_scores, dtype=np.float64)
    thr = float(win_thr_used) if win_thr_used is not None else 0.0
    wins = int(np.sum(arr >= thr)) if arr.size else 0
    summary = {
        "checkpoint": str(path.resolve()),
        "checkpoint_episodes": ckpt_eps,
        "arch": meta.get("arch"),
        "n_games_total": int(arr.size),
        "rounds": int(args.rounds),
        "n_games_per_round": int(args.n_games),
        "win_threshold": thr,
        "win_rate": float(wins / max(arr.size, 1)),
        "avg_score": float(np.mean(arr)) if arr.size else 0.0,
        "score_std": float(np.std(arr)) if arr.size > 1 else 0.0,
        "temperature": float(args.temperature),
        "last_round_win_rate": last_wr,
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
        return

    print(
        f"checkpoint={path}  episodes_meta={ckpt_eps}  device={device}\n"
        f"games={summary['n_games_total']}  rounds={summary['rounds']}  "
        f"thr={summary['win_threshold']:.0f}\n"
        f"win_rate={summary['win_rate']*100:.1f}%  avg_score={summary['avg_score']:.1f}  "
        f"std={summary['score_std']:.1f}  temp={summary['temperature']}"
    )


if __name__ == "__main__":
    main()
