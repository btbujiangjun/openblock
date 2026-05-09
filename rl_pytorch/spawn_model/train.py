"""
SpawnTransformerV2 训练脚本。

用法:
  python -m rl_pytorch.spawn_model.train --db openblock.db --epochs 50 --lr 3e-4

多任务损失:
  L = w_ce * L_ce + w_div * L_div + w_anti * L_anti
  - L_ce:   形状预测交叉熵（主目标，加权采样）
  - L_div:  多样性辅助损失（品类预测 CE，鼓励学习品类多样的出块模式）
  - L_anti: 分数膨胀控制（低填充率+高技能时若出易消块则施加惩罚）
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

from .. import torch_env  # noqa: F401 — 须在 import torch 之前（NNPACK 警告 / CPU 环境）

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split

from ..device import apply_cpu_training_tuning, apply_throughput_tuning, resolve_training_device
from .dataset import load_training_data, SpawnDataset, NUM_SHAPES, NUM_CATEGORIES, CONTEXT_DIM
from .model import SpawnTransformerV2

MODEL_DIR = Path(__file__).resolve().parent.parent.parent / 'models'

EASY_SHAPE_MASK = None


def _default_dataloader_workers(device: torch.device) -> int:
    """CPU 上可选多进程加载；macOS 默认 0，其它平台默认小额度以提速。"""
    raw = os.environ.get("RL_CPU_DATALOADER_WORKERS", "").strip()
    if raw.isdigit():
        return max(0, int(raw))
    if device.type != "cpu":
        return 0
    if sys.platform == "darwin":
        return 0
    n = (os.cpu_count() or 4) - 1
    return max(0, min(4, n))


def _get_easy_shape_mask(device):
    """小方块（1~4 格）视为 easy，大/异形方块视为 hard。"""
    global EASY_SHAPE_MASK
    if EASY_SHAPE_MASK is not None and EASY_SHAPE_MASK.device == device:
        return EASY_SHAPE_MASK

    from .dataset import SHAPE_VOCAB
    EASY_SHAPES = {'2x2', '1x4', '4x1'}
    mask = torch.zeros(NUM_SHAPES, device=device)
    for i, name in enumerate(SHAPE_VOCAB):
        if name in EASY_SHAPES:
            mask[i] = 1.0
    EASY_SHAPE_MASK = mask
    return mask


def compute_anti_inflate_loss(logits_tuple, context, device):
    """
    When the player is skilled (skill > 0.6) and board is not crowded (fill < 0.4),
    penalize high probability on easy shapes.
    """
    skill = context[:, 2]
    fill = context[:, 1]
    trigger = torch.clamp((skill - 0.6) * 5.0, 0, 1) * torch.clamp((0.4 - fill) * 5.0, 0, 1)

    if trigger.sum().item() < 0.01:
        return torch.tensor(0.0, device=device)

    easy_mask = _get_easy_shape_mask(device)
    penalty = torch.tensor(0.0, device=device)
    for logits in logits_tuple:
        probs = torch.softmax(logits, dim=-1)
        easy_prob = (probs * easy_mask.unsqueeze(0)).sum(dim=-1)
        penalty = penalty + (easy_prob * trigger).mean()

    return penalty / 3.0


def compute_diversity_loss(div_logits, categories, criterion_div):
    """Auxiliary loss: predict the category of each of the 3 shapes."""
    B = div_logits.size(0)
    loss = 0.0
    for slot in range(3):
        loss = loss + criterion_div(div_logits[:, slot, :], categories[:, slot])
    return loss / 3.0


def compute_target_difficulty(context):
    """
    Derive target difficulty from player state for training.
    V3.1 behavior context uses boardDifficulty (fill + holes) and risk relief.
    Legacy 24-dim context falls back to raw fill and zero board risk.
    """
    skill = context[:, 2]
    frustration = context[:, 4]
    stress = context[:, 20] if context.size(1) > 20 else torch.zeros_like(skill)
    if context.size(1) > 37:
        board_difficulty = context[:, 26]
        board_risk = context[:, 37]
        near_clear = torch.clamp(context[:, 29] + context[:, 30], 0.0, 1.0)
    else:
        board_difficulty = context[:, 1]
        board_risk = torch.zeros_like(skill)
        near_clear = torch.zeros_like(skill)

    diff = (
        0.3
        + 0.5 * skill
        - 0.2 * frustration
        + 0.15 * stress
        + 0.08 * board_difficulty
        - 0.1 * board_risk
        + 0.06 * near_clear
    )
    return torch.clamp(diff, 0.0, 1.0).unsqueeze(-1)


def train(args):
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    status_path = MODEL_DIR / 'spawn_train_status.json'
    model_path = MODEL_DIR / 'spawn_transformer.pt'

    def _write_status(d):
        with open(status_path, 'w') as f:
            json.dump(d, f)

    _write_status({'phase': 'loading', 'progress': 0, 'message': '加载训练数据…'})

    db_path = Path(args.db)
    if not db_path.exists():
        _write_status({'phase': 'error', 'message': f'数据库不存在: {db_path}'})
        return

    samples = load_training_data(db_path, min_score=args.min_score, max_sessions=args.max_sessions)
    if len(samples) < 10:
        _write_status({'phase': 'error', 'message': f'训练样本不足: {len(samples)} 条（至少需要 10 条）'})
        return

    _write_status({'phase': 'loading', 'progress': 0, 'message': f'加载到 {len(samples)} 个样本'})

    dataset = SpawnDataset(samples)
    val_size = max(1, int(len(dataset) * 0.1))
    train_size = len(dataset) - val_size
    train_ds, val_ds = random_split(dataset, [train_size, val_size])

    device_pref = os.environ.get("RL_SPAWN_DEVICE", "auto").strip() or "auto"
    device = resolve_training_device(device_pref)
    apply_throughput_tuning(device)
    apply_cpu_training_tuning(device)

    dl_workers = _default_dataloader_workers(device)
    pin_mem = device.type == "cuda"
    train_loader = DataLoader(
        train_ds,
        batch_size=args.batch_size,
        shuffle=True,
        drop_last=True,
        num_workers=dl_workers,
        persistent_workers=dl_workers > 0,
        pin_memory=pin_mem,
    )
    val_loader = DataLoader(
        val_ds,
        batch_size=args.batch_size,
        shuffle=False,
        num_workers=dl_workers,
        persistent_workers=dl_workers > 0,
        pin_memory=pin_mem,
    )

    model = SpawnTransformerV2(
        d_model=args.d_model,
        nhead=args.nhead,
        num_layers=args.num_layers,
        dim_ff=args.dim_ff,
        dropout=args.dropout,
    ).to(device)

    print(f'SpawnTransformerV2: {model.count_params():,} params, device={device}, context_dim={CONTEXT_DIM}')

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    criterion_ce = nn.CrossEntropyLoss(reduction='none')
    criterion_div = nn.CrossEntropyLoss()
    criterion_diff = nn.MSELoss()

    w_ce = args.w_ce
    w_div = args.w_div
    w_anti = args.w_anti

    best_val_loss = float('inf')
    history = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        total_loss = 0
        total_ce = 0
        total_div = 0
        total_anti = 0
        total_n = 0

        for batch in train_loader:
            board = batch['board'].to(device)
            context = batch['context'].to(device)
            hist = batch['history'].to(device)
            targets = batch['targets'].to(device)
            categories = batch['categories'].to(device)
            weights = batch['weight'].to(device)

            target_diff = compute_target_difficulty(context).to(device)

            out = model(board, context, hist, target_diff)
            l0, l1, l2 = out['logits']

            loss_ce = ((criterion_ce(l0, targets[:, 0]) +
                        criterion_ce(l1, targets[:, 1]) +
                        criterion_ce(l2, targets[:, 2])) / 3.0 * weights).mean()

            loss_div = compute_diversity_loss(out['div_logits'], categories, criterion_div)
            loss_anti = compute_anti_inflate_loss((l0, l1, l2), context, device)

            loss_diff = criterion_diff(out['diff_pred'], target_diff)

            loss = w_ce * loss_ce + w_div * loss_div + w_anti * loss_anti + 0.1 * loss_diff

            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            bs = board.size(0)
            total_loss += loss.item() * bs
            total_ce += loss_ce.item() * bs
            total_div += loss_div.item() * bs
            total_anti += loss_anti.item() * bs
            total_n += bs

        scheduler.step()
        train_loss = total_loss / max(1, total_n)
        train_ce = total_ce / max(1, total_n)
        train_div_l = total_div / max(1, total_n)
        train_anti_l = total_anti / max(1, total_n)

        model.eval()
        val_loss = 0
        val_correct = [0, 0, 0]
        val_total = 0
        with torch.no_grad():
            for batch in val_loader:
                board = batch['board'].to(device)
                context = batch['context'].to(device)
                hist = batch['history'].to(device)
                targets = batch['targets'].to(device)

                out = model(board, context, hist)
                l0, l1, l2 = out['logits']
                vl = (criterion_ce(l0, targets[:, 0]).mean() +
                      criterion_ce(l1, targets[:, 1]).mean() +
                      criterion_ce(l2, targets[:, 2]).mean()) / 3.0
                val_loss += vl.item() * board.size(0)
                val_total += board.size(0)

                for i, logits in enumerate([l0, l1, l2]):
                    val_correct[i] += (logits.argmax(dim=-1) == targets[:, i]).sum().item()

        val_loss /= max(1, val_total)
        val_acc = [c / max(1, val_total) for c in val_correct]
        avg_acc = sum(val_acc) / 3.0

        entry = {
            'epoch': epoch,
            'train_loss': round(train_loss, 4),
            'train_ce': round(train_ce, 4),
            'train_div': round(train_div_l, 4),
            'train_anti': round(train_anti_l, 4),
            'val_loss': round(val_loss, 4),
            'val_acc': round(avg_acc, 4),
            'lr': round(scheduler.get_last_lr()[0], 6),
        }
        history.append(entry)

        progress = int(epoch / args.epochs * 100)
        _write_status({
            'phase': 'training',
            'progress': progress,
            'epoch': epoch,
            'total_epochs': args.epochs,
            'train_loss': entry['train_loss'],
            'val_loss': entry['val_loss'],
            'val_acc': entry['val_acc'],
            'message': (f'Epoch {epoch}/{args.epochs}  '
                        f'loss={train_loss:.4f} (ce={train_ce:.4f} div={train_div_l:.4f} anti={train_anti_l:.4f})  '
                        f'val={val_loss:.4f}  acc={avg_acc:.3f}'),
        })

        print(f"[{epoch}/{args.epochs}] loss={train_loss:.4f} ce={train_ce:.4f} "
              f"div={train_div_l:.4f} anti={train_anti_l:.4f} val={val_loss:.4f} acc={avg_acc:.3f}")

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save({
                'model_state_dict': model.state_dict(),
                'config': {
                    'd_model': args.d_model,
                    'nhead': args.nhead,
                    'num_layers': args.num_layers,
                    'dim_ff': args.dim_ff,
                    'dropout': args.dropout,
                },
                'model_version': 'v2',
                'context_dim': CONTEXT_DIM,
                'epoch': epoch,
                'val_loss': val_loss,
                'val_acc': avg_acc,
                'num_shapes': NUM_SHAPES,
                'num_categories': NUM_CATEGORIES,
            }, str(model_path))

    _write_status({
        'phase': 'done',
        'progress': 100,
        'message': f'训练完成！最佳 val_loss={best_val_loss:.4f}',
        'model_path': str(model_path),
        'best_val_loss': round(best_val_loss, 4),
        'total_samples': len(samples),
        'history': history,
    })
    print(f'Done. Best val_loss={best_val_loss:.4f}. Model saved to {model_path}')


def main():
    default_db = str(Path(__file__).resolve().parent.parent.parent / 'openblock.db')

    parser = argparse.ArgumentParser(description='Train SpawnTransformerV2')
    parser.add_argument('--db', type=str, default=default_db)
    parser.add_argument('--epochs', type=int, default=50)
    parser.add_argument('--batch-size', type=int, default=64)
    parser.add_argument('--lr', type=float, default=3e-4)
    parser.add_argument('--d-model', type=int, default=128)
    parser.add_argument('--nhead', type=int, default=4)
    parser.add_argument('--num-layers', type=int, default=2)
    parser.add_argument('--dim-ff', type=int, default=256)
    parser.add_argument('--dropout', type=float, default=0.1)
    parser.add_argument('--min-score', type=int, default=0)
    parser.add_argument('--max-sessions', type=int, default=500)
    parser.add_argument('--w-ce', type=float, default=1.0, help='主分类损失权重')
    parser.add_argument('--w-div', type=float, default=0.3, help='多样性损失权重')
    parser.add_argument('--w-anti', type=float, default=0.5, help='反膨胀损失权重')
    args = parser.parse_args()
    train(args)


if __name__ == '__main__':
    main()
