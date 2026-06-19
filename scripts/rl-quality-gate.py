#!/usr/bin/env python3
"""Compare two RL training JSONL logs under no-regression gates.

Usage:
  scripts/rl-quality-gate.py --baseline old.jsonl --candidate new.jsonl

The script intentionally consumes the same fields emitted by train.py
(`train_episode` rows) so efficiency work can be judged by both throughput and
model-quality proxies before running longer eval gates.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from statistics import mean


def _rows(path: Path) -> list[dict]:
    out: list[dict] = []
    with path.open(encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue
            if obj.get("event") == "train_episode":
                out.append(obj)
    return out


def _num(v) -> float | None:
    try:
        x = float(v)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _summary(rows: list[dict], tail: int) -> dict:
    rows = rows[-tail:] if tail > 0 else rows

    def avg(key: str) -> float:
        vals = [_num(r.get(key)) for r in rows]
        vals = [v for v in vals if v is not None]
        return float(mean(vals)) if vals else 0.0

    spawn_dist: dict[str, float] = {}
    dist_rows = [r.get("spawn_bucket_dist") for r in rows if isinstance(r.get("spawn_bucket_dist"), dict)]
    if dist_rows:
        keys = sorted({k for d in dist_rows for k in d})
        for k in keys:
            vals = [_num(d.get(k)) for d in dist_rows]
            vals = [v for v in vals if v is not None]
            spawn_dist[k] = float(mean(vals)) if vals else 0.0

    collect_ms = avg("collect_ms")
    train_ms = avg("train_ms")
    return {
        "n": len(rows),
        "avg100": avg("avg100"),
        "win_rate": avg("win_rate"),
        "teacher_q_coverage": avg("teacher_q_coverage"),
        "teacher_visit_coverage": avg("teacher_visit_coverage"),
        "teacher_skip_rate": avg("teacher_skip_rate"),
        "collect_ms": collect_ms,
        "train_ms": train_ms,
        "throughput_eps_per_sec": (avg("batch_size") / (collect_ms + train_ms) * 1000.0) if collect_ms + train_ms > 0 else 0.0,
        "spawn_failure_rate": avg("spawn_online_failure_rate"),
        "spawn_fallbacks": avg("spawn_legacy_fallbacks"),
        "spawn_scd_avg": avg("spawn_scd_avg"),
        "spawn_bucket_dist": spawn_dist,
    }


def _l1_dist(a: dict[str, float], b: dict[str, float]) -> float:
    keys = set(a) | set(b)
    return sum(abs(float(a.get(k, 0.0)) - float(b.get(k, 0.0))) for k in keys)


def main() -> int:
    p = argparse.ArgumentParser(description="OpenBlock RL training quality gate")
    p.add_argument("--baseline", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--tail", type=int, default=20)
    p.add_argument("--teacher-drop-max", type=float, default=0.02)
    p.add_argument("--avg100-drop-ratio", type=float, default=0.03)
    p.add_argument("--spawn-drift-max", type=float, default=0.05)
    p.add_argument("--require-throughput", action="store_true", default=True)
    args = p.parse_args()

    base = _summary(_rows(Path(args.baseline)), args.tail)
    cand = _summary(_rows(Path(args.candidate)), args.tail)
    failures: list[str] = []

    tq_drop = base["teacher_q_coverage"] - cand["teacher_q_coverage"]
    tv_drop = base["teacher_visit_coverage"] - cand["teacher_visit_coverage"]
    if max(tq_drop, tv_drop) > args.teacher_drop_max:
        failures.append(f"teacher coverage drop too high: tq={tq_drop:.3f}, tv={tv_drop:.3f}")

    min_avg100 = base["avg100"] * (1.0 - args.avg100_drop_ratio)
    if base["avg100"] > 0 and cand["avg100"] < min_avg100:
        failures.append(f"avg100 dropped: baseline={base['avg100']:.2f}, candidate={cand['avg100']:.2f}")

    drift = _l1_dist(base["spawn_bucket_dist"], cand["spawn_bucket_dist"])
    if drift > args.spawn_drift_max:
        failures.append(f"spawn bucket drift too high: L1={drift:.3f}")

    if args.require_throughput and cand["throughput_eps_per_sec"] <= base["throughput_eps_per_sec"]:
        failures.append(
            "throughput did not improve: "
            f"baseline={base['throughput_eps_per_sec']:.3f}, candidate={cand['throughput_eps_per_sec']:.3f}"
        )

    result = {"ok": not failures, "baseline": base, "candidate": cand, "failures": failures}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if not failures else 2


if __name__ == "__main__":
    raise SystemExit(main())
