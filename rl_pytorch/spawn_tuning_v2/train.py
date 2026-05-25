"""训练管线 — 从头训练 + 增量训练。

CLI 用法:
    python -m rl_pytorch.spawn_tuning_v2.train \
        --db .cursor-stress-logs/spawn-tuning.sqlite \
        --sample-sets 1,2,3 \
        --output checkpoints/v2/model_xxx.pt \
        --epochs 50 --batch-size 256 --lr 1e-3

增量训练 (在 base_model 基础上微调):
    python -m rl_pytorch.spawn_tuning_v2.train \
        --db ... --sample-sets 4,5 \
        --base-model checkpoints/v2/model_prev.pt \
        --rehearsal-set-ids 1,2 --rehearsal-ratio 0.15 \
        --epochs 20 --lr 1e-4

输出:
  - <output>.pt:    完整 checkpoint (model_state + meta)
  - <output>.log:   JSONL 每 epoch 指标 (train_loss/val_loss/curve_mae/...)
"""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
import torch
import torch.nn as nn

from .model import build_default_model, SpawnTuningResNetMLP
from .losses import LossWeights, compute_total_loss
from .feature_io import SamplesDataset, save_model_record
from .target_curve import target_curve_vector, CURVE_N_BINS


# ─────────── 单步训练 ───────────

def _to_torch_batch(batch_np: Dict[str, np.ndarray], device: torch.device) -> Dict[str, torch.Tensor]:
    """numpy batch → torch tensors。"""
    out = {}
    for k, v in batch_np.items():
        if k.endswith("_idx"):
            out[k] = torch.from_numpy(v).long().to(device)
        else:
            out[k] = torch.from_numpy(v).float().to(device)
    return out


def _train_one_epoch(
    model: SpawnTuningResNetMLP,
    train_ds: SamplesDataset,
    optimizer: torch.optim.Optimizer,
    weights: LossWeights,
    batch_size: int,
    device: torch.device,
    epoch: int,
) -> Dict[str, float]:
    model.train()
    sums = {"total": 0.0, "shape": 0.0, "balance": 0.0, "surprise": 0.0,
            "breaking": 0.0, "smooth": 0.0, "aux": 0.0}
    n_batches = 0

    for batch_np in train_ds.iter_batches(batch_size=batch_size, shuffle=True, seed=epoch):
        batch = _to_torch_batch(batch_np, device)
        # 让 theta_norm 可求梯度 (用于 L_smooth)
        batch["theta_norm"] = batch["theta_norm"].detach().requires_grad_(True)

        preds = model(
            difficulty_idx=batch["difficulty_idx"],
            generator_idx=batch["generator_idx"],
            bot_idx=batch["bot_idx"],
            pb_bin_idx=batch["pb_bin_idx"],
            lifecycle_idx=batch["lifecycle_idx"],
            log_pb=batch["log_pb"],
            theta_norm=batch["theta_norm"],
        )

        targets = {
            "curve": batch["d_curve"],
            "pb_broke": batch["pb_broke"],
            "noMove": batch["noMove"],
            "score": batch["score"],
            "survival": batch["survival"],
        }

        breakdown = compute_total_loss(
            preds, targets, batch["pb_bin_idx"],
            theta_norm=batch["theta_norm"],
            weights=weights,
        )

        optimizer.zero_grad()
        breakdown.total.backward()
        torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=5.0)
        optimizer.step()

        d = breakdown.to_dict()
        for k in sums:
            sums[k] += d.get(k, 0.0)
        n_batches += 1

    return {k: v / max(1, n_batches) for k, v in sums.items()}


@torch.no_grad()
def _eval_one_epoch(
    model: SpawnTuningResNetMLP,
    val_ds: SamplesDataset,
    weights: LossWeights,
    batch_size: int,
    device: torch.device,
) -> Dict[str, float]:
    model.eval()
    sums = {"total": 0.0, "shape": 0.0, "balance": 0.0, "surprise": 0.0,
            "breaking": 0.0, "smooth": 0.0, "aux": 0.0}
    curve_mae_sum = 0.0
    n_batches = 0
    n_samples = 0

    for batch_np in val_ds.iter_batches(batch_size=batch_size, shuffle=False):
        batch = _to_torch_batch(batch_np, device)
        preds = model(
            difficulty_idx=batch["difficulty_idx"],
            generator_idx=batch["generator_idx"],
            bot_idx=batch["bot_idx"],
            pb_bin_idx=batch["pb_bin_idx"],
            lifecycle_idx=batch["lifecycle_idx"],
            log_pb=batch["log_pb"],
            theta_norm=batch["theta_norm"],
        )
        targets = {
            "curve": batch["d_curve"],
            "pb_broke": batch["pb_broke"],
            "noMove": batch["noMove"],
            "score": batch["score"],
            "survival": batch["survival"],
        }
        breakdown = compute_total_loss(preds, targets, batch["pb_bin_idx"], weights=weights)
        d = breakdown.to_dict()
        for k in sums:
            sums[k] += d.get(k, 0.0)

        # curve_mae: 主要业务指标
        diff = (preds["curve"] - batch["d_curve"]).abs()
        curve_mae_sum += float(diff.sum().item())
        n_samples += batch["d_curve"].numel()
        n_batches += 1

    metrics = {k: v / max(1, n_batches) for k, v in sums.items()}
    metrics["curve_mae"] = curve_mae_sum / max(1, n_samples)
    return metrics


# ─────────── 训练入口 ───────────

def train(
    db_path: str,
    sample_set_ids: List[int],
    output_path: str,
    *,
    base_model_path: Optional[str] = None,
    rehearsal_set_ids: Optional[List[int]] = None,
    rehearsal_ratio: float = 0.15,
    epochs: int = 50,
    batch_size: int = 256,
    lr: float = 1e-3,
    weights: Optional[LossWeights] = None,
    device_str: str = "cpu",
    val_ratio: float = 0.1,
    early_stop_patience: int = 10,
    seed: int = 42,
    write_db_record: bool = False,
) -> Dict[str, float]:
    """主训练函数。

    Returns:
        训练完毕的最终 metrics dict (含 best_val_loss / best_curve_mae 等)
    """
    torch.manual_seed(seed)
    np.random.seed(seed)
    device = torch.device(device_str)
    weights = weights or LossWeights()

    print(f"[train_v2] device={device} sets={sample_set_ids} output={output_path}")

    # ─── 加载数据 ───
    ds = SamplesDataset.from_sqlite(db_path, sample_set_ids)
    train_ds, val_ds = ds.train_val_split(val_ratio=val_ratio, seed=seed)
    print(f"[train_v2] 共 {len(ds)} 样本 → train={len(train_ds)}, val={len(val_ds)}")

    # ─── 模型 ───
    model = build_default_model().to(device)
    print(f"[train_v2] 模型参数量: {model.count_parameters():,}")
    if base_model_path:
        ck = torch.load(base_model_path, map_location=device)
        model.load_state_dict(ck["model_state_dict"])
        print(f"[train_v2] 加载基础模型 {base_model_path} (增量训练, lr 自动 × 0.1)")
        lr = lr * 0.1

    # ─── 优化器 ───
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)

    # ─── 日志文件 ───
    log_path = str(output_path) + ".log"
    log_fp = open(log_path, "w", encoding="utf-8")

    # ─── 训练循环 ───
    best_val = float("inf")
    best_metrics: Dict[str, float] = {}
    patience_left = early_stop_patience
    t_start = time.time()

    for epoch in range(epochs):
        t0 = time.time()
        train_m = _train_one_epoch(model, train_ds, optimizer, weights, batch_size, device, epoch)
        val_m = _eval_one_epoch(model, val_ds, weights, batch_size, device)
        scheduler.step()

        record = {
            "epoch": epoch,
            "train_loss": train_m["total"],
            "val_loss": val_m["total"],
            "val_curve_mae": val_m["curve_mae"],
            "val_balance": val_m["balance"],
            "val_surprise": val_m["surprise"],
            "val_breaking": val_m["breaking"],
            "lr": optimizer.param_groups[0]["lr"],
            "elapsed_s": round(time.time() - t0, 2),
        }
        log_fp.write(json.dumps(record) + "\n")
        log_fp.flush()
        print(f"[train_v2] ep {epoch:02d} train={train_m['total']:.4f} val={val_m['total']:.4f} "
              f"mae={val_m['curve_mae']:.4f} balance={val_m['balance']:.4f} time={record['elapsed_s']:.1f}s")

        if val_m["curve_mae"] < best_val:
            best_val = val_m["curve_mae"]
            best_metrics = {**val_m, "best_epoch": epoch}
            patience_left = early_stop_patience
            # 保存最优 checkpoint
            _save_checkpoint(model, output_path, best_metrics, base_model_path, sample_set_ids)
        else:
            patience_left -= 1
            if patience_left <= 0:
                print(f"[train_v2] EarlyStopping at epoch {epoch} (no improvement in {early_stop_patience} epochs)")
                break

    log_fp.close()
    total_time = time.time() - t_start
    print(f"[train_v2] ✓ 完成,耗时 {total_time:.1f}s  best_val_mae={best_val:.4f}")

    # 写 models 表 (可选)
    if write_db_record:
        weights_bytes = Path(output_path).read_bytes()
        sha = hashlib.sha256(weights_bytes).hexdigest()
        save_model_record(
            db_path=db_path,
            name=Path(output_path).stem,
            model_type="resnet",
            weights_path=str(output_path),
            sha256=sha,
            size_bytes=len(weights_bytes),
            metrics=best_metrics,
            parent_model_id=None,  # 增量训练时调用方填
        )

    return best_metrics


def _save_checkpoint(
    model: SpawnTuningResNetMLP,
    path: str,
    metrics: Dict[str, float],
    base_model_path: Optional[str],
    sample_set_ids: List[int],
):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model_state_dict": model.state_dict(),
        "arch": {
            "hidden_dim": model.hidden_dim,
            "n_blocks": model.n_blocks,
            "curve_bins": model.curve_bins,
        },
        "metrics": metrics,
        "meta": {
            "version": "v2.0.0",
            "param_count": model.count_parameters(),
            "base_model": base_model_path,
            "sample_set_ids": list(sample_set_ids),
            "saved_at": int(time.time()),
        },
    }, path)


# ─────────── CLI ───────────

def main():
    p = argparse.ArgumentParser(description="Spawn Tuning v2 — ResNet-MLP 训练")
    p.add_argument("--db", required=True, help="SQLite path")
    p.add_argument("--sample-sets", required=True, help="逗号分隔的 set_id 列表")
    p.add_argument("--output", required=True, help="checkpoint 输出路径 .pt")
    p.add_argument("--base-model", default=None, help="增量训练的基础模型 .pt")
    p.add_argument("--rehearsal-sets", default="", help="rehearsal 用的旧 set_ids (增量训练时)")
    p.add_argument("--rehearsal-ratio", type=float, default=0.15)
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--batch-size", type=int, default=256)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--device", default="cpu")
    p.add_argument("--val-ratio", type=float, default=0.1)
    p.add_argument("--early-stop-patience", type=int, default=10)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--write-db-record", action="store_true")
    args = p.parse_args()

    sample_set_ids = [int(x) for x in args.sample_sets.split(",")]
    rehearsal_ids = [int(x) for x in args.rehearsal_sets.split(",")] if args.rehearsal_sets else None

    train(
        db_path=args.db,
        sample_set_ids=sample_set_ids,
        output_path=args.output,
        base_model_path=args.base_model,
        rehearsal_set_ids=rehearsal_ids,
        rehearsal_ratio=args.rehearsal_ratio,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        device_str=args.device,
        val_ratio=args.val_ratio,
        early_stop_patience=args.early_stop_patience,
        seed=args.seed,
        write_db_record=args.write_db_record,
    )


if __name__ == "__main__":
    main()
