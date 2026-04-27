"""
个性化 fine-tune 脚本 — 在已训练的 V3 模型基础上为单玩家做 LoRA 微调。

设计动机
--------
通用模型只能拟合"群体平均行为"，但不同玩家偏好差异显著（例：
有人喜欢长直条挑战极限，有人偏好规整方块求稳）。我们希望：

  - 不重训整个模型（成本/遗忘风险）
  - 只为特定玩家调整 head 部分映射
  - 切换玩家瞬时（只切 LoRA adapter）

这正是 LoRA 适合的场景。本脚本：

  1. 加载预训练 V3 trunk
  2. 在 head_*/style/feasibility 处注入 LoRA（默认 r=4, α=8）
  3. 冻结 trunk，只训 LoRA 参数
  4. 用单玩家会话数据微调
  5. 仅保存 LoRA 状态 (~5K 参数)

用法
----
  python -m rl_pytorch.spawn_model.personalize \
      --base-ckpt models/spawn_transformer_v3.pt \
      --user-id  alice \
      --db       openblock.db \
      --epochs   10

输出：models/lora_<user_id>.pt（只含 LoRA 参数）

推理时
------
  base = SpawnTransformerV3()
  base.load_state_dict(torch.load('models/spawn_transformer_v3.pt')['model_state_dict'])
  inject_lora_into_model(base, r=4, alpha=8)
  load_lora_state_dict(base, torch.load('models/lora_alice.pt')['lora'])
  → 模型即为"为 alice 个性化"的版本
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from .. import torch_env  # noqa: F401

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split

from ..device import resolve_training_device
from .dataset import (
    NUM_SHAPES,
    CONTEXT_DIM,
    SHAPE_VOCAB,
    SpawnDataset,
    extract_samples_from_session,
)
from .lora import (
    inject_lora_into_model,
    freeze_non_lora,
    lora_parameters,
    lora_state_dict,
    count_lora_params,
)
from .model_v3 import SpawnTransformerV3
from .train import compute_target_difficulty
from .train_v3 import _infer_playstyle_from_context

MODEL_DIR = Path(__file__).resolve().parent.parent.parent / 'models'


def load_user_samples(db_path: Path, user_id: str, max_sessions: int = 200) -> list:
    """从 sessions 表加载指定 user_id 的对局并提取样本。"""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT s.id, s.score, m.frames
        FROM sessions s
        INNER JOIN move_sequences m ON m.session_id = s.id
        WHERE s.user_id = ? AND s.status = 'completed'
        ORDER BY s.created_at DESC
        LIMIT ?
    """, (user_id, max_sessions))

    samples = []
    for row in cur.fetchall():
        try:
            frames = json.loads(row['frames'] or '[]')
        except (json.JSONDecodeError, TypeError):
            continue
        if not isinstance(frames, list) or len(frames) < 5:
            continue
        score = row['score'] or 0
        clear_count = sum(1 for f in frames if f.get('t') == 'place')
        spawn_count = sum(1 for f in frames if f.get('t') == 'spawn')
        clear_rate = (clear_count / max(spawn_count, 1)) if spawn_count > 0 else 0.0
        samples.extend(extract_samples_from_session(frames, score, clear_rate))

    conn.close()
    return samples


def fine_tune(args):
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    out_path = MODEL_DIR / f'lora_{args.user_id}.pt'

    db_path = Path(args.db)
    samples = load_user_samples(db_path, args.user_id, args.max_sessions)
    if len(samples) < 10:
        print(f'[personalize] 玩家 {args.user_id} 样本过少 ({len(samples)} 条), 终止')
        return
    print(f'[personalize] 玩家 {args.user_id}: {len(samples)} 个样本')

    base_path = Path(args.base_ckpt)
    if not base_path.exists():
        print(f'[personalize] 基础模型不存在: {base_path}')
        return

    device = resolve_training_device(args.device)

    model = SpawnTransformerV3().to(device)
    state = torch.load(base_path, map_location=device, weights_only=False)
    model_sd = state.get('model_state_dict') or state
    model.load_state_dict(model_sd, strict=False)
    print(f'[personalize] 已加载基础模型: {base_path}')

    n_replaced = inject_lora_into_model(
        model, r=args.lora_r, alpha=args.lora_alpha, dropout=args.lora_dropout,
    )
    freeze_non_lora(model)
    n_lora = count_lora_params(model)
    n_total = sum(p.numel() for p in model.parameters())
    print(f'[personalize] 注入 LoRA: {n_replaced} 层, '
          f'{n_lora:,} 可训练参数 / {n_total:,} 总参数')

    dataset = SpawnDataset(samples)
    val_size = max(1, int(len(dataset) * 0.2))
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])
    train_loader = DataLoader(train_ds, batch_size=args.batch_size,
                              shuffle=True, drop_last=True)
    val_loader = DataLoader(val_ds, batch_size=args.batch_size, shuffle=False)

    optim = torch.optim.AdamW(lora_parameters(model), lr=args.lr, weight_decay=1e-4)
    criterion_ce = nn.CrossEntropyLoss(reduction='none')

    best_val = float('inf')
    history = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        sum_loss = 0.0
        total_n = 0
        for batch in train_loader:
            board = batch['board'].to(device)
            context = batch['context'].to(device)
            hist = batch['history'].to(device)
            targets = batch['targets'].to(device)
            weights = batch['weight'].to(device)

            target_diff = compute_target_difficulty(context).to(device)
            ps = _infer_playstyle_from_context(context)

            out = model(board, context, hist, target_diff,
                        playstyle_id=ps, prev_shapes=targets[:, :2])
            l0, l1, l2 = out['logits']
            loss = ((criterion_ce(l0, targets[:, 0])
                     + criterion_ce(l1, targets[:, 1])
                     + criterion_ce(l2, targets[:, 2])) / 3.0 * weights).mean()

            optim.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(lora_parameters(model), 1.0)
            optim.step()

            sum_loss += loss.item() * board.size(0)
            total_n += board.size(0)

        train_loss = sum_loss / max(1, total_n)

        model.eval()
        val_loss = 0.0
        val_n = 0
        with torch.no_grad():
            for batch in val_loader:
                board = batch['board'].to(device)
                context = batch['context'].to(device)
                hist = batch['history'].to(device)
                targets = batch['targets'].to(device)
                out = model(board, context, hist, prev_shapes=targets[:, :2])
                l0, l1, l2 = out['logits']
                vl = (criterion_ce(l0, targets[:, 0]).mean()
                      + criterion_ce(l1, targets[:, 1]).mean()
                      + criterion_ce(l2, targets[:, 2]).mean()) / 3.0
                val_loss += vl.item() * board.size(0)
                val_n += board.size(0)
        val_loss /= max(1, val_n)

        print(f'[personalize {args.user_id} {epoch}/{args.epochs}] '
              f'train={train_loss:.4f} val={val_loss:.4f}')
        history.append({'epoch': epoch, 'train': round(train_loss, 4),
                        'val': round(val_loss, 4)})

        if val_loss < best_val:
            best_val = val_loss
            torch.save({
                'lora': lora_state_dict(model),
                'config': {
                    'r': args.lora_r,
                    'alpha': args.lora_alpha,
                    'dropout': args.lora_dropout,
                    'base_ckpt': str(base_path),
                    'user_id': args.user_id,
                    'samples': len(samples),
                    'val_loss': val_loss,
                    'history': history,
                },
            }, str(out_path))

    print(f'[personalize] 最佳 val_loss={best_val:.4f} 已保存到 {out_path}')


def main():
    default_db = str(Path(__file__).resolve().parent.parent.parent / 'openblock.db')
    default_ckpt = str(MODEL_DIR / 'spawn_transformer_v3.pt')

    p = argparse.ArgumentParser(description='LoRA 个性化微调')
    p.add_argument('--user-id', type=str, required=True)
    p.add_argument('--base-ckpt', type=str, default=default_ckpt)
    p.add_argument('--db', type=str, default=default_db)
    p.add_argument('--max-sessions', type=int, default=200)
    p.add_argument('--epochs', type=int, default=10)
    p.add_argument('--batch-size', type=int, default=32)
    p.add_argument('--lr', type=float, default=1e-3)
    p.add_argument('--lora-r', type=int, default=4)
    p.add_argument('--lora-alpha', type=float, default=8.0)
    p.add_argument('--lora-dropout', type=float, default=0.1)
    p.add_argument('--device', type=str, default='auto')
    args = p.parse_args()
    fine_tune(args)


if __name__ == '__main__':
    main()
