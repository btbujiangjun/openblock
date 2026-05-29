"""SpawnPolicyNet 服务期分布漂移门禁（CLI）。

用 checkpoint 内 baked-in 的 `drift_reference`（训练集 spawnTargets / PB θ 画像）对照
线上 / holdout 数据的 behaviorContext，计算 PSI。漂移超阈值 → 退出码 1（可做部署 / CI 门禁），
提示在当前 θ / 玩家分布下重训 SpawnPolicyNet。

用法：
  python -m rl_pytorch.spawn_model.drift_check \
      --db openblock.db --ckpt models/spawn_transformer_v3.pt [--threshold 0.25] [--max-sessions 500]

退出码：0=通过（漂移可接受）；1=漂移过大 / 缺少 reference；2=数据不足。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np

from .. import torch_env  # noqa: F401
import torch

from .dataset import load_training_data, _parse_behavior_context
from .drift import check_against_reference, DRIFT_ALARM


def _live_contexts(db_path, min_score, max_sessions):
    """从 DB 重建线上 behaviorContext 矩阵（每个 spawn 帧一行）。"""
    import json
    import sqlite3
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute(
        """
        SELECT s.score, m.frames FROM sessions s
        INNER JOIN move_sequences m ON m.session_id = s.id
        WHERE s.status = 'completed' AND s.score >= ?
        ORDER BY s.score DESC LIMIT ?
        """,
        (min_score, max_sessions),
    )
    rows = []
    for row in cur.fetchall():
        try:
            frames = json.loads(row['frames'] or '[]')
        except (json.JSONDecodeError, TypeError):
            continue
        for f in frames if isinstance(frames, list) else []:
            if f.get('t') == 'spawn' and isinstance(f.get('ps'), dict):
                rows.append(_parse_behavior_context(f['ps']))
    conn.close()
    return np.stack(rows) if rows else np.zeros((0, 0))


def main():
    p = argparse.ArgumentParser(description='SpawnPolicyNet 分布漂移门禁')
    default_db = str(Path(__file__).resolve().parent.parent.parent / 'openblock.db')
    default_ckpt = str(Path(__file__).resolve().parent.parent.parent / 'models' / 'spawn_transformer_v3.pt')
    p.add_argument('--db', type=str, default=default_db)
    p.add_argument('--ckpt', type=str, default=default_ckpt)
    p.add_argument('--threshold', type=float, default=DRIFT_ALARM)
    p.add_argument('--min-score', type=int, default=0)
    p.add_argument('--max-sessions', type=int, default=500)
    args = p.parse_args()

    if not Path(args.ckpt).exists():
        print(f'[drift] checkpoint 不存在: {args.ckpt}')
        sys.exit(1)
    ckpt = torch.load(args.ckpt, map_location='cpu', weights_only=False)
    reference = ckpt.get('drift_reference')
    if not reference:
        print('[drift] 该 ckpt 无 drift_reference（需用 v1.61.0 train_v3 重训后才有）。')
        sys.exit(1)

    if not Path(args.db).exists():
        print(f'[drift] 数据库不存在: {args.db}')
        sys.exit(2)

    live = _live_contexts(args.db, args.min_score, args.max_sessions)
    if live.shape[0] < 30:
        print(f'[drift] 线上样本不足（{live.shape[0]} < 30），跳过判定。')
        sys.exit(2)

    rep = check_against_reference(reference, live, threshold=args.threshold)
    st = rep['spawn_targets']
    print(f"[drift] 参考 n={reference.get('n')}，线上 n={live.shape[0]}")
    print(f"[drift] spawnTargets  max PSI={st['max']:.3f}  ({st['argmax']}, {st['level']})")
    for k, v in st['per_feature'].items():
        print(f"          {k:<22} PSI={v:.3f}")
    if rep.get('pb_theta'):
        th = rep['pb_theta']
        print(f"[drift] PB θ        max PSI={th['max']:.3f}  ({th['argmax']}, {th['level']})")

    if not rep['passed']:
        print(f"[drift] ❌ 漂移超阈值 {args.threshold} → 建议重训 SpawnPolicyNet。")
        sys.exit(1)
    print(f"[drift] ✅ 漂移在阈值 {args.threshold} 内。")
    sys.exit(0)


if __name__ == '__main__':
    main()
