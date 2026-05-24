"""
Phase B — 训练 NN 代理模型。

用法:
    python -m rl_pytorch.spawn_tuning.train_surrogate \
        --db .cursor-stress-logs/spawn-tuning.sqlite \
        --run-id 1234567890 \
        --output checkpoints/surrogate_phase_b.pt \
        --epochs 50 --batch-size 256 --lr 1e-3

输出:
    - checkpoint .pt 文件 (含 model state_dict + 训练曲线)
    - 命令行输出每 epoch 的 train/val loss
    - 保存到 spawn_tuning_surrogates 表 (可选)
"""

import argparse
import json
import math
import sys
from pathlib import Path

import torch
import torch.optim as optim
from torch.utils.data import TensorDataset, DataLoader, random_split

from .surrogate_model import SpawnTuningSurrogate, count_parameters, compute_loss
from .feature_io import load_samples_from_sqlite


def train(
    db_path: str,
    run_id: int,
    output_path: str,
    epochs: int = 50,
    batch_size: int = 256,
    lr: float = 1e-3,
    weight_decay: float = 1e-4,
    val_split: float = 0.1,
    seed: int = 42,
    device: str = "cpu",
) -> dict:
    """训练代理模型,返回 { train_losses, val_losses, val_mae, params, path }"""
    torch.manual_seed(seed)

    print(f"[train_surrogate] 加载样本 from {db_path} run_id={run_id}")
    data = load_samples_from_sqlite(db_path, run_id)
    print(f"  共 {data['n']} 样本")

    # 把所有张量打包成 TensorDataset
    full = TensorDataset(
        data["theta"], data["diff_idx"], data["gen_idx"],
        data["life_idx"], data["log_best"], data["target"]
    )
    val_n = max(1, int(data["n"] * val_split))
    train_n = data["n"] - val_n
    train_set, val_set = random_split(full, [train_n, val_n], generator=torch.Generator().manual_seed(seed))
    train_loader = DataLoader(train_set, batch_size=batch_size, shuffle=True)
    val_loader = DataLoader(val_set, batch_size=batch_size, shuffle=False)

    print(f"  train={train_n}, val={val_n}")

    model = SpawnTuningSurrogate().to(device)
    print(f"  parameters: {count_parameters(model):,}")
    opt = optim.AdamW(model.parameters(), lr=lr, weight_decay=weight_decay)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(opt, T_max=epochs)

    history = {"train_loss": [], "val_loss": [], "val_mae": []}
    best_val = float("inf")
    patience = 5
    bad_epochs = 0

    for epoch in range(1, epochs + 1):
        # train
        model.train()
        train_losses = []
        train_components = {"mse": 0.0, "mono": 0.0, "smooth": 0.0, "n": 0}
        for theta, diff, gen, life, log_best, target in train_loader:
            theta_d = theta.to(device)
            diff_d = diff.to(device)
            gen_d = gen.to(device)
            life_d = life.to(device)
            log_best_d = log_best.to(device)
            target_d = target.to(device)
            pred = model(theta_d, diff_d, gen_d, life_d, log_best_d)
            loss, comp = compute_loss(
                pred, target_d, theta_d, log_best_d,
                diff_d, gen_d, life_d, model=model,
            )
            opt.zero_grad()
            loss.backward()
            opt.step()
            train_losses.append(loss.item())
            train_components["mse"] += comp.get("mse", 0.0) * pred.shape[0]
            train_components["mono"] += comp.get("mono", 0.0) * pred.shape[0]
            train_components["smooth"] += comp.get("smooth", 0.0) * pred.shape[0]
            train_components["n"] += pred.shape[0]
        train_loss_avg = sum(train_losses) / max(1, len(train_losses))

        # val (不算单调性/光滑性正则,纯 MSE 用于判断过拟合)
        model.eval()
        val_losses = []
        val_mae_sum = torch.zeros(3, device=device)
        val_count = 0
        with torch.no_grad():
            for theta, diff, gen, life, log_best, target in val_loader:
                pred = model(theta.to(device), diff.to(device), gen.to(device), life.to(device), log_best.to(device))
                t = target.to(device)
                vloss = torch.nn.functional.mse_loss(pred, t)
                val_losses.append(vloss.item())
                val_mae_sum += (pred - t).abs().sum(dim=0)
                val_count += pred.shape[0]
        val_loss_avg = sum(val_losses) / max(1, len(val_losses))
        val_mae = (val_mae_sum / max(1, val_count)).cpu().tolist()

        history["train_loss"].append(train_loss_avg)
        history["val_loss"].append(val_loss_avg)
        history["val_mae"].append(val_mae)

        scheduler.step()
        nN = max(1, train_components["n"])
        print(
            f"  epoch {epoch:02d}: train={train_loss_avg:.5f} "
            f"(mse={train_components['mse']/nN:.5f} "
            f"mono={train_components['mono']/nN:.5f} "
            f"smooth={train_components['smooth']/nN:.5f}) "
            f"val={val_loss_avg:.5f} "
            f"mae=[f:{val_mae[0]:.3f} e:{val_mae[1]:.3f} a:{val_mae[2]:.3f}]"
        )

        if val_loss_avg < best_val:
            best_val = val_loss_avg
            bad_epochs = 0
            # 保存最佳
            Path(output_path).parent.mkdir(parents=True, exist_ok=True)
            torch.save({
                "model_state_dict": model.state_dict(),
                "epoch": epoch,
                "train_loss": train_loss_avg,
                "val_loss": val_loss_avg,
                "val_mae": val_mae,
                "param_count": count_parameters(model),
            }, output_path)
        else:
            bad_epochs += 1
            if bad_epochs >= patience:
                print(f"  early stopping at epoch {epoch} (val_loss not improving for {patience} epochs)")
                break

    return {
        "history": history,
        "best_val": best_val,
        "param_count": count_parameters(model),
        "path": output_path,
    }


def main():
    p = argparse.ArgumentParser(description="Train spawn-tuning NN surrogate (Phase B)")
    p.add_argument("--db", required=True, help="SQLite path containing spawn_tuning_samples_v2")
    p.add_argument("--run-id", required=True, type=int)
    p.add_argument("--output", default="checkpoints/surrogate_phase_b.pt")
    p.add_argument("--epochs", type=int, default=50)
    p.add_argument("--batch-size", type=int, default=256)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--device", default="cpu", help="cpu / cuda / mps")
    args = p.parse_args()

    if not Path(args.db).exists():
        print(f"db not found: {args.db}", file=sys.stderr)
        sys.exit(1)

    result = train(
        db_path=args.db,
        run_id=args.run_id,
        output_path=args.output,
        epochs=args.epochs,
        batch_size=args.batch_size,
        lr=args.lr,
        device=args.device,
    )
    print(f"\n✓ 训练完成,checkpoint 保存到: {result['path']}")
    print(f"  best val loss: {result['best_val']:.5f}")


if __name__ == "__main__":
    main()
