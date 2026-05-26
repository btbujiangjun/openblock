"""训练管线 — 从头训练 + 增量训练。

CLI 用法:
    python -m rl_pytorch.spawn_tuning_v2.train \
        --db .cursor-stress-logs/spawn-tuning-v2.sqlite \
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
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn

from .model import build_default_model, build_model, SpawnParamTunerResNet
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
    model: SpawnParamTunerResNet,
    train_ds: SamplesDataset,
    optimizer: torch.optim.Optimizer,
    weights: LossWeights,
    batch_size: int,
    device: torch.device,
    epoch: int,
    *,
    log_fp=None,         # JSONL 写入句柄 — 每 batch_log_interval 写一行 batch-level loss
    global_step_start: int = 0,
    batch_log_interval: int = 4,
) -> Tuple[Dict[str, float], int]:
    """训练一个 epoch。

    Returns:
        (epoch metrics dict, final global_step) — global_step 累计自始至终的 batch 编号
    """
    model.train()
    sums = {"total": 0.0, "shape": 0.0, "balance": 0.0, "surprise": 0.0,
            "breaking": 0.0, "smooth": 0.0, "aux": 0.0,
            "pb_distribution": 0.0, "anchor": 0.0,
            # v2.9 / v2.9.1
            "monotonic": 0.0, "target_fit": 0.0, "endpoint": 0.0}
    n_batches = 0
    global_step = global_step_start

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
        global_step += 1

        # 每 N batch 写一行 batch-level JSONL — 让前端能看到 epoch 内部 loss 趋势
        if log_fp is not None and (n_batches % max(1, batch_log_interval) == 0):
            log_fp.write(json.dumps({
                "type": "batch",
                "step": global_step,
                "epoch": epoch,
                "batch": n_batches,
                "train_loss_batch": float(d.get("total", 0.0)),
            }) + "\n")
            log_fp.flush()

    return ({k: v / max(1, n_batches) for k, v in sums.items()}, global_step)


@torch.no_grad()
def _eval_one_epoch(
    model: SpawnParamTunerResNet,
    val_ds: SamplesDataset,
    weights: LossWeights,
    batch_size: int,
    device: torch.device,
) -> Dict[str, float]:
    from .losses import p_reach_metrics
    model.eval()
    sums = {"total": 0.0, "shape": 0.0, "balance": 0.0, "surprise": 0.0,
            "breaking": 0.0, "smooth": 0.0, "aux": 0.0,
            "pb_distribution": 0.0, "anchor": 0.0,
            # v2.9 / v2.9.1
            "monotonic": 0.0, "target_fit": 0.0, "endpoint": 0.0}
    curve_var_sum = 0.0  # v2.9.4: per-sample 预测曲线方差, 用于退化检测
    calibrated_mae_sum = 0.0  # v2.10.2: 预测 vs 校准 target MAE (不受 state_offset 噪声干扰)
    p_reach_sums = {"reach_50": 0.0, "reach_80": 0.0, "reach_95": 0.0,
                    "reach_100": 0.0, "reach_120": 0.0, "reach_150": 0.0}
    curve_mae_sum = 0.0
    n_batches = 0
    n_samples = 0

    # v2.10.2: 预计算 calibrated target tensor (业务命题 S 形, 不含 state_offset 噪声)
    from .target_curve import target_curve_calibrated_vector
    calibrated_target = torch.tensor(
        target_curve_calibrated_vector(), dtype=torch.float32, device=device,
    )  # shape (20,)

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

        # v2.9.4: per-sample 预测曲线方差 → 检测退化解 (全水平输出 var ≈ 0)
        curve_var_sum += float(preds["curve"].std(dim=-1).mean().item())

        # v2.10.2: 预测 vs calibrated target MAE (业务真实拟合度, 不受 state_offset 噪声干扰)
        cal_diff = (preds["curve"] - calibrated_target.unsqueeze(0)).abs()
        calibrated_mae_sum += float(cal_diff.mean().item())

        # v2.5: P_reach 业务指标 (累加平均)
        reach = p_reach_metrics(preds["curve"])
        for k in p_reach_sums:
            p_reach_sums[k] += reach.get(k, 0.0)

    metrics = {k: v / max(1, n_batches) for k, v in sums.items()}
    metrics["curve_mae"] = curve_mae_sum / max(1, n_samples)
    metrics["curve_var"] = curve_var_sum / max(1, n_batches)  # v2.9.4
    metrics["calibrated_mae"] = calibrated_mae_sum / max(1, n_batches)  # v2.10.2
    for k, v in p_reach_sums.items():
        metrics[k] = v / max(1, n_batches)
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
    # v2.10.2: patience 10 → 15, 实测 job_19/20 ResNet best ep=8 后 10 个 epoch 没改进就停了,
    # 但 composite 实际只是平台震荡, 拉长后还能再降 0.01-0.02
    early_stop_patience: int = 15,
    seed: int = 42,
    write_db_record: bool = False,
    model_type: str = "resnet",   # v2.9: "resnet" / "transformer"
    model_kwargs: Optional[Dict] = None,   # v2.10.9 G10: 透传到 build_model(d_model, n_layers, ...)
) -> Dict[str, float]:
    """主训练函数。

    Returns:
        训练完毕的最终 metrics dict (含 best_val_loss / best_curve_mae 等)
    """
    torch.manual_seed(seed)
    np.random.seed(seed)
    device = torch.device(device_str)
    weights = weights or LossWeights()

    print(f"[train_v2] device={device} sets={sample_set_ids} output={output_path} model_type={model_type}")

    # ─── 加载数据 ───
    ds = SamplesDataset.from_sqlite(db_path, sample_set_ids)
    train_ds, val_ds = ds.train_val_split(val_ratio=val_ratio, seed=seed)
    print(f"[train_v2] 共 {len(ds)} 样本 → train={len(train_ds)}, val={len(val_ds)}")

    # ─── 模型 (v2.9: 支持 resnet / transformer; v2.10.9 G10: 超参可调) ───
    model = build_model(model_type, **(model_kwargs or {})).to(device)
    print(f"[train_v2] {model_type} 模型参数量: {model.count_parameters():,}")
    if base_model_path:
        ck = torch.load(base_model_path, map_location=device)
        model.load_state_dict(ck["model_state_dict"])
        print(f"[train_v2] 加载基础模型 {base_model_path} (增量训练, lr 自动 × 0.1)")
        lr = lr * 0.1

    # v2.9.4: Transformer 对 LR 极敏感, cap 在 1e-3 (实测 job_16 用 lr=0.05 直接 ep 01
    # 落入退化解 curve_var=0, 12 epoch 早停)。ResNet 可以扛 lr=0.05 但 Transformer 不行。
    if model_type == "transformer" and lr > 1e-3:
        print(f"[train_v2] warn: transformer 不适合 lr={lr} (易陷退化解), 自动 cap 到 1e-3")
        lr = 1e-3

    # ─── 优化器 + LR 调度 (v2.9: 加 warmup) ───
    # warmup: 前 5 个 epoch 从 lr*0.01 线性升到 lr, 之后 cosine annealing 到 0
    # 收益: 避免初期大梯度震荡, 实测 ResNet 类网络改善 5-10%
    optimizer = torch.optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-5)
    warmup_epochs = max(1, min(5, epochs // 10))   # 5 epoch 或 epochs/10 (取较小)
    if epochs > warmup_epochs:
        warmup = torch.optim.lr_scheduler.LinearLR(
            optimizer, start_factor=0.01, end_factor=1.0, total_iters=warmup_epochs,
        )
        cosine = torch.optim.lr_scheduler.CosineAnnealingLR(
            optimizer, T_max=max(1, epochs - warmup_epochs),
        )
        scheduler = torch.optim.lr_scheduler.SequentialLR(
            optimizer, schedulers=[warmup, cosine], milestones=[warmup_epochs],
        )
    else:
        # epochs 太少时单独 cosine
        scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, epochs))

    # ─── 日志文件 (行缓冲, 让 batch JSONL 立即落盘, 前端轮询能即时拿到) ───
    log_path = str(output_path) + ".log"
    log_fp = open(log_path, "w", encoding="utf-8", buffering=1)

    # ─── 训练循环 ───
    best_val = float("inf")
    best_metrics: Dict[str, float] = {}
    patience_left = early_stop_patience
    t_start = time.time()
    global_step = 0  # 累计 batch 编号 — 用作 batch-level JSONL 的 x 轴

    for epoch in range(epochs):
        t0 = time.time()
        train_m, global_step = _train_one_epoch(
            model, train_ds, optimizer, weights, batch_size, device, epoch,
            log_fp=log_fp,
            global_step_start=global_step,
            batch_log_interval=4,  # 每 4 个 batch 写一行 → 13 batch/epoch ≈ 3 个点
        )
        val_m = _eval_one_epoch(model, val_ds, weights, batch_size, device)
        scheduler.step()

        record = {
            "type": "epoch",
            "step": global_step,           # epoch 结束时的累计 step
            "epoch": epoch,
            "train_loss": train_m["total"],
            "val_loss": val_m["total"],
            "val_curve_mae": val_m["curve_mae"],
            "val_balance": val_m["balance"],
            "val_surprise": val_m["surprise"],
            "val_breaking": val_m["breaking"],
            "val_pb_distribution": val_m.get("pb_distribution", 0.0),  # v2.4
            "val_anchor": val_m.get("anchor", 0.0),                    # v2.6
            # v2.9 / v2.9.1 — 形状约束指标
            "val_monotonic": val_m.get("monotonic", 0.0),
            "val_target_fit": val_m.get("target_fit", 0.0),
            "val_endpoint": val_m.get("endpoint", 0.0),
            # v2.9.4 — 退化解检测指标
            "val_curve_var": val_m.get("curve_var", 0.0),
            # v2.10.2 — 预测 vs calibrated target MAE (业务真实拟合度)
            "val_calibrated_mae": val_m.get("calibrated_mae", 0.0),
            # v2.5: 业务级 P_reach 分布 (玩家到达 r=X 的累积概率)
            "reach_50":  val_m.get("reach_50",  0.0),
            "reach_80":  val_m.get("reach_80",  0.0),
            "reach_95":  val_m.get("reach_95",  0.0),
            "reach_100": val_m.get("reach_100", 0.0),  # ⭐ 破 PB 率
            "reach_120": val_m.get("reach_120", 0.0),
            "reach_150": val_m.get("reach_150", 0.0),
            "lr": optimizer.param_groups[0]["lr"],
            "elapsed_s": round(time.time() - t0, 2),
        }
        log_fp.write(json.dumps(record) + "\n")
        log_fp.flush()
        print(f"[train_v2] ep {epoch:02d} train={train_m['total']:.4f} val={val_m['total']:.4f} "
              f"mae={val_m['curve_mae']:.4f} balance={val_m['balance']:.4f} time={record['elapsed_s']:.1f}s")

        # v2.9.4: 综合 EarlyStop 指标, 防止"退化解"陷阱
        #   病例 (job_16, transformer, lr=0.05): ep 01 模型输出全平均 ≈ 0.55,
        #   val_curve_mae=0.0698 偏低 (因为实测均值也在 0.55 附近), 锁定 trivial 解。
        #   解法: composite = curve_mae + 0.5*anchor + 0.4*target_fit
        #     - anchor: 关键 r 点偏离则惩罚 → 全平均输出 anchor 必然大
        #     - target_fit: vs 校准 S 形 MSE → 全平均跟 S 形差距大
        #   另加 curve_var 退化检测: 预测曲线 std < 0.02 时强制视为未改进
        curve_var = val_m.get("curve_var", 0.0)
        composite = (val_m["curve_mae"]
                     + 0.5 * val_m.get("anchor", 0.0)
                     + 0.4 * val_m.get("target_fit", 0.0))
        # 退化解检测: 预测曲线方差过低 → 模型输出几乎水平线 → 拒绝当 best
        is_degenerate = curve_var < 0.02
        improved = (composite < best_val) and (not is_degenerate)

        if improved:
            best_val = composite
            best_metrics = {**val_m, "best_epoch": epoch, "composite": composite}
            patience_left = early_stop_patience
            _save_checkpoint(model, output_path, best_metrics, base_model_path, sample_set_ids)
        else:
            patience_left -= 1
            if is_degenerate and epoch < 5:
                # 早期退化解 — 提示用户 LR 可能过大, 但仍继续训练给机会逃出
                print(f"[train_v2] warn: ep {epoch} curve_var={curve_var:.4f} < 0.02 (degenerate, likely LR too high)")
            if patience_left <= 0 and best_val != float("inf"):
                print(f"[train_v2] EarlyStopping at epoch {epoch} (no improvement in {early_stop_patience} epochs)")
                break

    log_fp.close()
    total_time = time.time() - t_start
    # v2.9.5: 退化解兜底 — 整个训练从未保存过 checkpoint 时强制保存最终 epoch
    if best_val == float("inf"):
        print(f"[train_v2] warn: 全程退化解, 强制保存最终 epoch")
        final_metrics = {
            **_eval_one_epoch(model, val_ds, weights, batch_size, device),
            "best_epoch": epoch, "composite": None,
        }
        _save_checkpoint(model, output_path, final_metrics, base_model_path, sample_set_ids)
        best_metrics = final_metrics
    print(f"[train_v2] ✓ 完成,耗时 {total_time:.1f}s  best_val_mae={best_val:.4f}")

    # 写 models 表 (可选)
    if write_db_record:
        weights_bytes = Path(output_path).read_bytes()
        sha = hashlib.sha256(weights_bytes).hexdigest()
        save_model_record(
            db_path=db_path,
            name=Path(output_path).stem,
            model_type=model_type,  # v2.9.1: 用实际架构类型, 不再 hardcode "resnet"
            weights_path=str(output_path),
            sha256=sha,
            size_bytes=len(weights_bytes),
            metrics=best_metrics,
            parent_model_id=None,  # 增量训练时调用方填
        )

    return best_metrics


def _save_checkpoint(
    model: nn.Module,
    path: str,
    metrics: Dict[str, float],
    base_model_path: Optional[str],
    sample_set_ids: List[int],
):
    """v2.9.1: 兼容 ResNet-MLP 和 Transformer 两种架构。

    arch 字段按模型类型挑选保存的超参数:
      - ResNet-MLP: hidden_dim / n_blocks / curve_bins
      - Transformer: d_model / n_layers / curve_bins

    v2.9.2: 同时写一个 sidecar JSON (path + ".metrics.json"),
    让 job_executor 不依赖 torch.load 也能读 metrics — 避免 daemon thread
    内首次 import torch + 加载 mps ckpt 时可能的死锁。
    """
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    arch: Dict[str, object] = {"curve_bins": getattr(model, "curve_bins", CURVE_N_BINS)}
    # 通过 hasattr 自动选择 — 避免在这里 isinstance import 链耦合
    if hasattr(model, "hidden_dim") and hasattr(model, "n_blocks"):
        arch["model_type"] = "resnet"
        arch["hidden_dim"] = int(model.hidden_dim)
        arch["n_blocks"] = int(model.n_blocks)
    elif hasattr(model, "d_model") and hasattr(model, "n_layers"):
        arch["model_type"] = "transformer"
        arch["d_model"] = int(model.d_model)
        arch["n_layers"] = int(model.n_layers)
    else:
        arch["model_type"] = "unknown"
    param_count = (model.count_parameters()
                   if hasattr(model, "count_parameters")
                   else sum(p.numel() for p in model.parameters()))
    meta = {
        "version": "v2.9.2",
        "param_count": int(param_count),
        "base_model": base_model_path,
        "sample_set_ids": list(sample_set_ids),
        "saved_at": int(time.time()),
    }
    torch.save({
        "model_state_dict": model.state_dict(),
        "arch": arch,
        "metrics": metrics,
        "meta": meta,
    }, path)

    # v2.9.2: sidecar JSON — 让 job_executor 不需要 torch.load
    sidecar = Path(path).with_suffix(Path(path).suffix + ".meta.json")
    try:
        # metrics 中可能有 tensor 标量, 用 _to_jsonable 安全转换
        sidecar.write_text(json.dumps({
            "arch": arch,
            "metrics": {k: _to_jsonable(v) for k, v in metrics.items()},
            "meta": meta,
        }, indent=2), encoding="utf-8")
    except Exception as e:
        # sidecar 失败不影响主流程 (torch.save 已成功); 仅 warning
        print(f"[train_v2] warn: failed to write sidecar metadata: {e}", file=sys.stderr)


def _to_jsonable(v):
    """把 metrics 中的 numpy/torch 标量等转成 native python 类型。"""
    try:
        import torch as _t
        if isinstance(v, _t.Tensor):
            return v.item() if v.numel() == 1 else v.tolist()
    except Exception:
        pass
    try:
        import numpy as _np
        if isinstance(v, _np.generic):
            return v.item()
        if isinstance(v, _np.ndarray):
            return v.tolist()
    except Exception:
        pass
    if isinstance(v, (int, float, str, bool, list, dict, type(None))):
        # v2.9.5: Infinity/NaN is not valid JSON → 转 None 避免前端 JSON.parse 崩溃
        if isinstance(v, float) and (v != v or v == float("inf") or v == float("-inf")):
            return None
        return v
    return str(v)


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
    p.add_argument("--model-type", default="resnet",
                   help="网络架构: resnet (默认, ResNet-MLP) / transformer (v2.9)")
    # G10 v2.10.9: 模型超参 (仅当 --model-type=transformer 时生效)
    p.add_argument("--d-model", type=int, default=None, help="Transformer hidden dim (默认 128)")
    p.add_argument("--n-layers", type=int, default=None, help="Transformer encoder 层数 (默认 3)")
    p.add_argument("--hidden-dim", type=int, default=None, help="ResNet hidden dim (默认 128)")
    p.add_argument("--n-blocks", type=int, default=None, help="ResNet block 层数 (默认 8)")
    args = p.parse_args()

    sample_set_ids = [int(x) for x in args.sample_sets.split(",")]
    rehearsal_ids = [int(x) for x in args.rehearsal_sets.split(",")] if args.rehearsal_sets else None

    # G10: 构造 model_kwargs 透传到 build_model
    model_kwargs = {}
    if args.model_type == "transformer":
        if args.d_model is not None:  model_kwargs["d_model"] = args.d_model
        if args.n_layers is not None: model_kwargs["n_layers"] = args.n_layers
    else:
        if args.hidden_dim is not None: model_kwargs["hidden_dim"] = args.hidden_dim
        if args.n_blocks is not None:   model_kwargs["n_blocks"] = args.n_blocks

    train(
        db_path=args.db,
        sample_set_ids=sample_set_ids,
        model_type=args.model_type,
        model_kwargs=model_kwargs or None,
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
