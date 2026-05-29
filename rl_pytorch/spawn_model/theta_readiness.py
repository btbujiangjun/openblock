"""SpawnPolicyNet 显式 θ「日志就绪度」前置门禁（CLI）。

回答一个工程问题：**当前日志是否已具备「显式 θ 条件」可学习的信号**，
即——重训前先确认 `ps.adaptive.stressBreakdown.pbCurveParams` 的 (1) 覆盖率、
(2) θ-regime 多样性、(3) 归一化后有效跨度。三者任一不达标，显式 θ 那 4 列
（behaviorContext[57-60]）对条件建模就接近零信息量，重训也学不到 θ→出块映射。

判定（默认阈值，可调）：
  - 覆盖率 coverage  ≥ --min-coverage（默认 0.80）：多数 spawn 帧带 pbCurveParams；
  - regime 数 regimes ≥ --min-regimes（默认 2）：至少两组不同 θ（否则是常数）；
  - 最大归一化跨度 ≥ --min-norm-spread（默认 0.05）：θ 在归一化域里真有差异。

用法：
  python -m rl_pytorch.spawn_model.theta_readiness --db openblock.db
  npm run spawn:theta-readiness -- --db openblock.db

退出码：0=就绪（可重训受益于显式 θ）；2=数据不足；3=未就绪（覆盖/多样性/跨度不达标）。
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

import numpy as np

from .dataset import (
    _PB_THETA_KEYS,
    _PB_THETA_RANGES,
    _norm_pb_theta,
    theta_regime_id,
)


def _iter_spawn_pb(db_path, min_score, max_sessions, status):
    """逐 spawn 帧产出 (pbCurveParams|None)。"""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        SELECT s.score, m.frames FROM sessions s
        INNER JOIN move_sequences m ON m.session_id = s.id
        WHERE s.status = ? AND s.score >= ?
        ORDER BY s.id DESC LIMIT ?
        """,
        (status, min_score, max_sessions),
    )
    n_sessions = 0
    for row in cur.fetchall():
        n_sessions += 1
        try:
            frames = json.loads(row["frames"] or "[]")
        except (json.JSONDecodeError, TypeError):
            continue
        for f in frames if isinstance(frames, list) else []:
            if f.get("t") != "spawn" or not isinstance(f.get("ps"), dict):
                continue
            pb = (((f["ps"].get("adaptive") or {}).get("stressBreakdown") or {})
                  .get("pbCurveParams"))
            yield pb if isinstance(pb, dict) else None
    conn.close()
    return n_sessions


def analyze(db_path, min_score, max_sessions, status):
    total = 0
    with_pb = 0
    regimes = Counter()
    norm_rows = []
    raw_rows = []
    gen = _iter_spawn_pb(db_path, min_score, max_sessions, status)
    while True:
        try:
            pb = next(gen)
        except StopIteration as stop:
            n_sessions = stop.value or 0
            break
        total += 1
        if pb is None:
            continue
        with_pb += 1
        regimes[theta_regime_id(pb)] += 1
        norm_rows.append(_norm_pb_theta(pb))
        raw_rows.append([pb.get(k) for k in _PB_THETA_KEYS])
    norm = np.asarray(norm_rows, dtype=np.float64) if norm_rows else np.zeros((0, 4))
    return {
        "n_sessions": n_sessions,
        "total_spawn": total,
        "with_pb": with_pb,
        "coverage": (with_pb / total) if total else 0.0,
        "regimes": regimes,
        "norm": norm,
        "raw": raw_rows,
    }


def main():
    p = argparse.ArgumentParser(description="SpawnPolicyNet 显式 θ 日志就绪度门禁")
    default_db = str(Path(__file__).resolve().parent.parent.parent / "openblock.db")
    p.add_argument("--db", type=str, default=default_db)
    p.add_argument("--status", type=str, default="completed")
    p.add_argument("--min-score", type=int, default=0)
    p.add_argument("--max-sessions", type=int, default=2000)
    p.add_argument("--min-coverage", type=float, default=0.80)
    p.add_argument("--min-regimes", type=int, default=2)
    p.add_argument("--min-norm-spread", type=float, default=0.05)
    p.add_argument("--min-samples", type=int, default=200)
    args = p.parse_args()

    if not Path(args.db).exists():
        print(f"[θ-readiness] 数据库不存在: {args.db}")
        sys.exit(2)

    r = analyze(args.db, args.min_score, args.max_sessions, args.status)
    total, with_pb, cov = r["total_spawn"], r["with_pb"], r["coverage"]

    print(f"[θ-readiness] DB={args.db}")
    print(f"  会话={r['n_sessions']}  spawn 帧={total}  带 pbCurveParams={with_pb}  覆盖率={cov:.1%}")

    if total < args.min_samples:
        print(f"  ⚠️  spawn 帧不足（{total} < {args.min_samples}），无法判定。")
        sys.exit(2)

    n_regimes = len(r["regimes"])
    print(f"  θ-regime 数={n_regimes}  （top: {[c for _, c in r['regimes'].most_common(3)]} 帧）")

    norm = r["norm"]
    max_spread = 0.0
    if norm.shape[0] > 0:
        print(f"  {'dim':<16}{'min':>8}{'max':>8}{'norm_spread':>13}{'norm_std':>10}")
        for i, k in enumerate(_PB_THETA_KEYS):
            col = norm[:, i]
            spread = float(col.max() - col.min())
            std = float(col.std())
            max_spread = max(max_spread, spread)
            lo, hi = _PB_THETA_RANGES[k]
            raw_min = lo + col.min() * (hi - lo)
            raw_max = lo + col.max() * (hi - lo)
            print(f"  {k:<16}{raw_min:>8.4f}{raw_max:>8.4f}{spread:>13.3f}{std:>10.3f}")
    print(f"  最大归一化跨度={max_spread:.3f}")

    fails = []
    if cov < args.min_coverage:
        fails.append(f"覆盖率 {cov:.1%} < {args.min_coverage:.0%}")
    if n_regimes < args.min_regimes:
        fails.append(f"regime 数 {n_regimes} < {args.min_regimes}")
    if max_spread < args.min_norm_spread:
        fails.append(f"归一化跨度 {max_spread:.3f} < {args.min_norm_spread}")

    if fails:
        print("[θ-readiness] ❌ 未就绪：" + "；".join(fails))
        print("  → 显式 θ 那 4 列接近常数，重训学不到 θ→出块映射；"
              "需先让 L2 tuner 产出有差异的 PB 曲线 θ 并累计新日志。")
        sys.exit(3)

    print("[θ-readiness] ✅ 就绪：覆盖/多样性/跨度均达标，重训可受益于显式 θ 条件。")
    sys.exit(0)


if __name__ == "__main__":
    main()
