"""
SpawnTransformerV3 训练脚本 — 联合 + 风格 + 可解性。

用法:
  python -m rl_pytorch.spawn_model.train_v3 --db openblock.db --epochs 50 --lr 3e-4

多任务损失（详见 ALGORITHMS_SPAWN.md §11.x）:
  L = w_ce  · L_ce_AR              # 三槽 autoregressive 交叉熵
    + w_div · L_div                # 品类预测
    + w_anti · L_anti              # 反分数膨胀（与 V2 一致）
    + w_diff · L_diff              # 难度回归
    + w_feas · L_feas              # 可解性辅助监督（BCE）
    + w_si  · L_soft_infeasible    # 主分布上的软不可行惩罚
    + w_st  · L_style              # 风格自监督

L_soft_infeasible 形式：
  对每槽 i，把当前 board 的 feasibility_mask 作为"权重"，求
    -log(sum_j P(s_i = j) * mask_j) 
  即「让模型把概率质量放在可行集合上」。

我们用 GT board 做 mask（训练时无法对每个生成 shape 重新算可行性）。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from .. import torch_env  # noqa: F401

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, random_split

from ..device import (
    apply_cpu_training_tuning,
    apply_throughput_tuning,
    resolve_training_device,
)
from .dataset import (
    NUM_SHAPES,
    NUM_CATEGORIES,
    CONTEXT_DIM,
    BEHAVIOR_CONTEXT_DIM,
    SHAPE_VOCAB,
    SpawnDataset,
    load_training_data,
)
from .feasibility import build_feasibility_mask
from .model_v3 import SpawnTransformerV3, NUM_PLAYSTYLES, PLAYSTYLE_TO_IDX, NUM_SPAWN_INTENTS
from .train import (
    _default_dataloader_workers,
    compute_anti_inflate_loss,
    compute_diversity_loss,
    compute_target_difficulty,
)

MODEL_DIR = Path(__file__).resolve().parent.parent.parent / 'models'


def _shape_map_for_feasibility() -> dict:
    from ..shapes_data import get_all_shapes
    return {s["id"]: s["data"] for s in get_all_shapes()}


def build_feasibility_batch(boards: torch.Tensor, shape_map: dict) -> torch.Tensor:
    """对 batch 中每个 board 计算 (NUM_SHAPES,) feasibility mask。

    Args:
        boards: (B, 8, 8) float
        shape_map: {shape_id: data}
    Returns:
        (B, NUM_SHAPES) float32 ∈ {0, 1}
    """
    bnp = boards.detach().cpu().numpy()
    B = bnp.shape[0]
    out = np.zeros((B, NUM_SHAPES), dtype=np.float32)
    for i in range(B):
        out[i] = build_feasibility_mask(bnp[i], SHAPE_VOCAB, shape_map)
    return torch.from_numpy(out).to(boards.device)


def _infer_playstyle_from_context(context: torch.Tensor) -> torch.Tensor:
    """从 context 启发式推断 playstyle 索引（自监督的弱标签）。

    使用规则与 web/src/playerProfile.js 的 playstyle getter 一致：
      - perfect_hunter : clearRate 高 + comboStreak 低 + 多消率高
      - multi_clear    : multiClearRate proxy（comboRate>0.4 或 clearRate>0.6）
      - combo          : recentComboStreak >= 3 / 5（context[11]）
      - survival       : clearRate < 0.25
      - balanced       : 默认

    Args:
        context: (B, CONTEXT_DIM)
    Returns:
        (B,) long ∈ [0, NUM_PLAYSTYLES)
    """
    B = context.size(0)
    out = torch.zeros(B, dtype=torch.long, device=context.device)
    for i in range(B):
        ctx = context[i]
        clear_rate = float(ctx[12].item()) if ctx.size(0) > 12 else 0.0
        combo_rate = float(ctx[14].item()) if ctx.size(0) > 14 else 0.0
        recent_combo = float(ctx[11].item()) if ctx.size(0) > 11 else 0.0

        if clear_rate >= 0.6 and combo_rate < 0.4:
            out[i] = PLAYSTYLE_TO_IDX['perfect_hunter']
        elif combo_rate >= 0.4 or clear_rate >= 0.5:
            out[i] = PLAYSTYLE_TO_IDX['multi_clear']
        elif recent_combo >= 0.5:
            out[i] = PLAYSTYLE_TO_IDX['combo']
        elif clear_rate < 0.25:
            out[i] = PLAYSTYLE_TO_IDX['survival']
        else:
            out[i] = PLAYSTYLE_TO_IDX['balanced']
    return out


def _infer_intent_from_behavior_context(behavior_context: torch.Tensor) -> torch.Tensor:
    """从 V3.1 behavior context 的 spawnIntent one-hot 段提取意图弱标签。"""
    if behavior_context.size(1) < 54:
        return torch.full((behavior_context.size(0),), 5, dtype=torch.long, device=behavior_context.device)
    intent_slice = behavior_context[:, 48:54]
    has_signal = intent_slice.sum(dim=-1) > 0.01
    pred = intent_slice.argmax(dim=-1).long()
    fallback = torch.full_like(pred, 5)
    return torch.where(has_signal, pred, fallback)


def soft_infeasible_loss(logits_tuple, feas_mask: torch.Tensor) -> torch.Tensor:
    """对 (l0, l1, l2) 与 feas_mask 计算 -log(P(可行)) 的均值。

    feas_mask: (B, NUM_SHAPES) ∈ {0, 1}
    """
    eps = 1e-6
    total = torch.tensor(0.0, device=feas_mask.device)
    for logits in logits_tuple:
        probs = torch.softmax(logits, dim=-1)
        feas_prob = (probs * feas_mask).sum(dim=-1).clamp(min=eps)
        total = total + (-torch.log(feas_prob)).mean()
    return total / 3.0


def feasibility_bce_loss(feas_logits: torch.Tensor, feas_mask: torch.Tensor) -> torch.Tensor:
    """对 feasibility_head 的 BCE 监督。

    feas_logits: (B, NUM_SHAPES) raw
    feas_mask:   (B, NUM_SHAPES) GT
    """
    return nn.functional.binary_cross_entropy_with_logits(feas_logits, feas_mask)


def style_ce_loss(style_logits: torch.Tensor, style_targets: torch.Tensor) -> torch.Tensor:
    return nn.functional.cross_entropy(style_logits, style_targets)


def intent_ce_loss(intent_logits: torch.Tensor, intent_targets: torch.Tensor) -> torch.Tensor:
    return nn.functional.cross_entropy(intent_logits, intent_targets)


def train(args):
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    status_path = MODEL_DIR / 'spawn_train_status.json'
    model_path = MODEL_DIR / 'spawn_transformer_v3.pt'

    def _write_status(d):
        with open(status_path, 'w') as f:
            json.dump(d, f)

    _write_status({'phase': 'loading', 'progress': 0,
                   'message': '加载训练数据 (V3)…'})

    db_path = Path(args.db)
    if not db_path.exists():
        _write_status({'phase': 'error', 'message': f'数据库不存在: {db_path}'})
        return

    samples = load_training_data(
        db_path, min_score=args.min_score, max_sessions=args.max_sessions
    )
    if len(samples) < 10:
        _write_status({'phase': 'error',
                       'message': f'训练样本不足: {len(samples)}'})
        return

    _write_status({'phase': 'loading', 'progress': 0,
                   'message': f'V3 加载到 {len(samples)} 个样本'})

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
        train_ds, batch_size=args.batch_size, shuffle=True, drop_last=True,
        num_workers=dl_workers, persistent_workers=dl_workers > 0, pin_memory=pin_mem,
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch_size, shuffle=False,
        num_workers=dl_workers, persistent_workers=dl_workers > 0, pin_memory=pin_mem,
    )

    model = SpawnTransformerV3(
        d_model=args.d_model,
        nhead=args.nhead,
        num_layers=args.num_layers,
        dim_ff=args.dim_ff,
        dropout=args.dropout,
    ).to(device)

    print(f'SpawnTransformerV3: {model.count_params():,} params, device={device}')

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=args.epochs)

    criterion_ce = nn.CrossEntropyLoss(reduction='none')
    criterion_div = nn.CrossEntropyLoss()
    criterion_diff = nn.MSELoss()

    shape_map = _shape_map_for_feasibility()
    use_feas = args.w_feas > 0 or args.w_si > 0
    use_style = args.w_st > 0

    best_val_loss = float('inf')
    history = []

    for epoch in range(1, args.epochs + 1):
        model.train()
        sums = {k: 0.0 for k in
        ('loss', 'ce', 'div', 'anti', 'diff', 'feas', 'si', 'style', 'intent')}
        total_n = 0

        for batch in train_loader:
            board = batch['board'].to(device)
            context = batch['context'].to(device)
            behavior_context = batch['behavior_context'].to(device)
            hist = batch['history'].to(device)
            targets = batch['targets'].to(device)
            categories = batch['categories'].to(device)
            weights = batch['weight'].to(device)

            target_diff = compute_target_difficulty(behavior_context).to(device)
            playstyle_id = (
                _infer_playstyle_from_context(behavior_context) if use_style else None
            )
            intent_id = _infer_intent_from_behavior_context(behavior_context)

            out = model(
                board, behavior_context, hist, target_diff,
                playstyle_id=playstyle_id,
                prev_shapes=targets[:, :2],
            )
            l0, l1, l2 = out['logits']

            loss_ce = (
                (criterion_ce(l0, targets[:, 0])
                 + criterion_ce(l1, targets[:, 1])
                 + criterion_ce(l2, targets[:, 2])) / 3.0 * weights
            ).mean()

            loss_div = compute_diversity_loss(out['div_logits'], categories, criterion_div)
            loss_anti = compute_anti_inflate_loss((l0, l1, l2), context, device)
            loss_diff = criterion_diff(out['diff_pred'], target_diff)

            if use_feas:
                feas_mask = build_feasibility_batch(board, shape_map)
                loss_feas = feasibility_bce_loss(out['feas_logits'], feas_mask)
                loss_si = soft_infeasible_loss((l0, l1, l2), feas_mask)
            else:
                loss_feas = torch.tensor(0.0, device=device)
                loss_si = torch.tensor(0.0, device=device)

            if use_style and playstyle_id is not None:
                loss_style = style_ce_loss(out['style_logits'], playstyle_id)
            else:
                loss_style = torch.tensor(0.0, device=device)

            loss_intent = intent_ce_loss(out['intent_logits'], intent_id)

            loss = (
                args.w_ce * loss_ce
                + args.w_div * loss_div
                + args.w_anti * loss_anti
                + args.w_diff * loss_diff
                + args.w_feas * loss_feas
                + args.w_si * loss_si
                + args.w_st * loss_style
                + args.w_intent * loss_intent
            )

            optimizer.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            bs = board.size(0)
            sums['loss'] += loss.item() * bs
            sums['ce'] += loss_ce.item() * bs
            sums['div'] += loss_div.item() * bs
            sums['anti'] += loss_anti.item() * bs
            sums['diff'] += loss_diff.item() * bs
            sums['feas'] += loss_feas.item() * bs
            sums['si'] += loss_si.item() * bs
            sums['style'] += loss_style.item() * bs
            sums['intent'] += loss_intent.item() * bs
            total_n += bs

        scheduler.step()
        means = {k: sums[k] / max(1, total_n) for k in sums}

        model.eval()
        val_loss = 0.0
        val_correct = [0, 0, 0]
        val_total = 0
        with torch.no_grad():
            for batch in val_loader:
                board = batch['board'].to(device)
                context = batch['context'].to(device)
                behavior_context = batch['behavior_context'].to(device)
                hist = batch['history'].to(device)
                targets = batch['targets'].to(device)
                out = model(board, behavior_context, hist, prev_shapes=targets[:, :2])
                l0, l1, l2 = out['logits']
                vl = (criterion_ce(l0, targets[:, 0]).mean()
                      + criterion_ce(l1, targets[:, 1]).mean()
                      + criterion_ce(l2, targets[:, 2]).mean()) / 3.0
                val_loss += vl.item() * board.size(0)
                val_total += board.size(0)
                for i, logits in enumerate([l0, l1, l2]):
                    val_correct[i] += (logits.argmax(dim=-1) == targets[:, i]).sum().item()

        val_loss /= max(1, val_total)
        val_acc = [c / max(1, val_total) for c in val_correct]
        avg_acc = sum(val_acc) / 3.0

        entry = {
            'epoch': epoch,
            'train_loss': round(means['loss'], 4),
            'train_ce': round(means['ce'], 4),
            'train_div': round(means['div'], 4),
            'train_anti': round(means['anti'], 4),
            'train_feas': round(means['feas'], 4),
            'train_si': round(means['si'], 4),
            'train_style': round(means['style'], 4),
            'train_intent': round(means['intent'], 4),
            'val_loss': round(val_loss, 4),
            'val_acc': round(avg_acc, 4),
            'lr': round(scheduler.get_last_lr()[0], 6),
        }
        history.append(entry)

        progress = int(epoch / args.epochs * 100)
        _write_status({
            'phase': 'training', 'progress': progress, 'epoch': epoch,
            'total_epochs': args.epochs,
            'val_loss': entry['val_loss'], 'val_acc': entry['val_acc'],
            'message': (f'V3 Epoch {epoch}/{args.epochs}  '
                        f'loss={means["loss"]:.4f} (ce={means["ce"]:.3f} '
                        f'div={means["div"]:.3f} feas={means["feas"]:.3f} '
                        f'si={means["si"]:.3f} style={means["style"]:.3f} '
                        f'intent={means["intent"]:.3f})  '
                        f'val={val_loss:.4f} acc={avg_acc:.3f}'),
        })

        print(f"[V3 {epoch}/{args.epochs}] loss={means['loss']:.4f} "
              f"ce={means['ce']:.3f} feas={means['feas']:.3f} "
              f"si={means['si']:.3f} style={means['style']:.3f} "
              f"intent={means['intent']:.3f} "
              f"val={val_loss:.4f} acc={avg_acc:.3f}")

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
                    'num_playstyles': NUM_PLAYSTYLES,
                    'num_spawn_intents': NUM_SPAWN_INTENTS,
                },
                'model_version': 'v3.1-behavior',
                'context_dim': CONTEXT_DIM,
                'behavior_context_dim': BEHAVIOR_CONTEXT_DIM,
                'epoch': epoch,
                'val_loss': val_loss,
                'val_acc': avg_acc,
                'num_shapes': NUM_SHAPES,
                'num_categories': NUM_CATEGORIES,
            }, str(model_path))

    _write_status({
        'phase': 'done', 'progress': 100,
        'message': f'V3 训练完成！最佳 val_loss={best_val_loss:.4f}',
        'model_path': str(model_path),
        'best_val_loss': round(best_val_loss, 4),
        'total_samples': len(samples),
        'history': history,
    })
    print(f'Done V3. Best val_loss={best_val_loss:.4f}. Model saved to {model_path}')


def main():
    default_db = str(Path(__file__).resolve().parent.parent.parent / 'openblock.db')
    p = argparse.ArgumentParser(description='Train SpawnTransformerV3')
    p.add_argument('--db', type=str, default=default_db)
    p.add_argument('--epochs', type=int, default=50)
    p.add_argument('--batch-size', type=int, default=64)
    p.add_argument('--lr', type=float, default=3e-4)
    p.add_argument('--d-model', type=int, default=128)
    p.add_argument('--nhead', type=int, default=4)
    p.add_argument('--num-layers', type=int, default=2)
    p.add_argument('--dim-ff', type=int, default=256)
    p.add_argument('--dropout', type=float, default=0.1)
    p.add_argument('--min-score', type=int, default=0)
    p.add_argument('--max-sessions', type=int, default=500)
    p.add_argument('--w-ce', type=float, default=1.0)
    p.add_argument('--w-div', type=float, default=0.3)
    p.add_argument('--w-anti', type=float, default=0.5)
    p.add_argument('--w-diff', type=float, default=0.1)
    p.add_argument('--w-feas', type=float, default=0.4,
                   help='feasibility BCE 辅助监督权重')
    p.add_argument('--w-si', type=float, default=0.2,
                   help='softInfeasible 主分布软不可行惩罚权重')
    p.add_argument('--w-st', type=float, default=0.15,
                   help='style 自监督交叉熵权重')
    p.add_argument('--w-intent', type=float, default=0.10,
                   help='spawnIntent 自监督交叉熵权重')
    args = p.parse_args()
    train(args)


if __name__ == '__main__':
    main()
