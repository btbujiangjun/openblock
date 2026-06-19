#!/usr/bin/env python3
"""Run staged RL training: performance -> balanced -> quality.

This wrapper does not change the learning algorithm. It only launches existing
``python -m rl_pytorch.train`` runs with explicit stage/preset metadata so runs
are reproducible and comparable in ``training.jsonl``.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


STAGES = (
    ("performance", "performance"),
    ("balanced", "balanced"),
    ("quality", "quality"),
)


def _parse_stage_episodes(raw: str) -> dict[str, int]:
    if not raw:
        return {"performance": 2000, "balanced": 20000, "quality": 5000}
    out: dict[str, int] = {}
    for part in raw.split(","):
        if not part.strip():
            continue
        name, _, value = part.partition("=")
        if not name or not value:
            raise ValueError(f"bad --stage-episodes item: {part!r}")
        out[name.strip()] = int(value)
    for name, _preset in STAGES:
        out.setdefault(name, 0)
    return out


def main() -> int:
    p = argparse.ArgumentParser(description="OpenBlock RL staged training runner")
    p.add_argument("--stage-episodes", default="", help="comma list, e.g. performance=2000,balanced=20000,quality=5000")
    p.add_argument("--checkpoint", default="rl_checkpoints/bb_policy.pt")
    p.add_argument("--log", default="rl_checkpoints/training.jsonl")
    p.add_argument("--n-workers", type=int, default=0)
    p.add_argument("--batch-episodes", type=int, default=16)
    p.add_argument("--device", default=os.environ.get("RL_DEVICE", "auto"))
    p.add_argument("--plan-id", default="")
    p.add_argument("--dry-run", action="store_true")
    args, passthrough = p.parse_known_args()

    episodes = _parse_stage_episodes(args.stage_episodes)
    plan_id = args.plan_id or f"stage-{uuid.uuid4().hex[:8]}"
    ckpt = str((ROOT / args.checkpoint).resolve() if not Path(args.checkpoint).is_absolute() else Path(args.checkpoint))
    log = str((ROOT / args.log).resolve() if not Path(args.log).is_absolute() else Path(args.log))

    env_base = {k: v for k, v in os.environ.items() if not k.startswith("RL_")}
    env_base.update({
        "RL_TRAINING_LOG": log,
        "RL_STAGE_PLAN": plan_id,
        "RL_SPAWN_ONLINE": "1",
        "RL_SPAWN_CHEAP": "0",
    })

    for stage, preset in STAGES:
        ep = int(episodes.get(stage, 0) or 0)
        if ep <= 0:
            continue
        env = dict(env_base)
        env["RL_TRAINING_PRESET"] = preset
        env["RL_TRAINING_STAGE"] = stage
        # Stage A is for representation warmup; keep deployment spawn fidelity but skip unused supervision.
        if stage == "performance":
            env.setdefault("RL_SUPERVISION", "0")
        cmd = [
            sys.executable, "-m", "rl_pytorch.train",
            "--episodes", str(ep),
            "--batch-episodes", str(args.batch_episodes),
            "--log-every", str(args.batch_episodes),
            "--save", ckpt,
            "--device", args.device,
            "--training-stage", stage,
            "--stage-plan", plan_id,
        ]
        if args.n_workers > 0:
            cmd += ["--n-workers", str(args.n_workers)]
        if Path(ckpt).is_file():
            cmd += ["--resume", ckpt]
        if preset in ("balanced", "quality"):
            cmd += ["--mcts", "--mcts-adaptive"]
        cmd += passthrough
        print(" ".join(cmd), flush=True)
        if args.dry_run:
            continue
        rc = subprocess.call(cmd, cwd=str(ROOT), env=env)
        if rc != 0:
            return rc
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
