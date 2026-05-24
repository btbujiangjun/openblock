"""
Surrogate Model — 多任务 MLP 代理 f̂(θ, context) → (fairness, excitement, antiInflation)。

设计依据: docs/algorithms/SPAWN_AUTO_TUNING.md §5.3

输入维度: 14 (θ) + 4 (difficulty emb) + 4 (generator emb) + 4 (lifecycle emb) + 1 (log_bestScore) = 27
输出维度: 3 (3 个 subscore, 各 ∈ [0, 1])
参数量: ~6,800 (轻量, CPU 训练)

关键技术:
    - Embedding 处理离散 context
    - 多任务共享 trunk + 独立任务头
    - 单调性正则 (antiInflation 随 bestScore 严格递增 → 健康分递减)
    - 平滑正则 (输出对 θ 的梯度光滑)
"""

import torch
import torch.nn as nn
import torch.nn.functional as F


# Context 词汇表 (与 web/src/tuning/contextSpace.js 对齐,改一处必须同步另一处)
DIFFICULTIES = ["easy", "normal", "hard"]
GENERATORS = ["triplet-p1", "budget-p2"]
LIFECYCLE_STAGES = ["onboarding", "growth", "mature", "plateau"]
BEST_SCORE_BINS = [500, 1500, 4000, 10000, 25000]


class SpawnTuningSurrogate(nn.Module):
    """多任务 MLP 代理: (θ, context) → (fairness, excitement, antiInflation)."""

    THETA_DIM = 14  # 与 paramSpace.PARAM_KEYS 长度一致
    EMB_DIM = 4

    def __init__(self, hidden_dim: int = 64, dropout: float = 0.1):
        super().__init__()
        # 上下文 embedding
        self.diff_emb = nn.Embedding(len(DIFFICULTIES), self.EMB_DIM)
        self.gen_emb = nn.Embedding(len(GENERATORS), self.EMB_DIM)
        self.life_emb = nn.Embedding(len(LIFECYCLE_STAGES), self.EMB_DIM)

        input_dim = self.THETA_DIM + 3 * self.EMB_DIM + 1  # +1 for log_bestScore
        self.trunk = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, hidden_dim // 2),
            nn.ReLU(),
        )

        head_in = hidden_dim // 2
        self.head_fairness = nn.Sequential(
            nn.Linear(head_in, 16), nn.ReLU(), nn.Linear(16, 1), nn.Sigmoid()
        )
        self.head_excitement = nn.Sequential(
            nn.Linear(head_in, 16), nn.ReLU(), nn.Linear(16, 1), nn.Sigmoid()
        )
        self.head_antiInflation = nn.Sequential(
            nn.Linear(head_in, 16), nn.ReLU(), nn.Linear(16, 1), nn.Sigmoid()
        )

    def forward(
        self,
        theta: torch.Tensor,            # [B, 14]
        diff_idx: torch.Tensor,         # [B] long
        gen_idx: torch.Tensor,          # [B] long
        life_idx: torch.Tensor,         # [B] long
        log_best: torch.Tensor,         # [B, 1] float (log10(bestScore) z-scored)
    ) -> torch.Tensor:                  # [B, 3]
        diff_e = self.diff_emb(diff_idx)
        gen_e = self.gen_emb(gen_idx)
        life_e = self.life_emb(life_idx)
        x = torch.cat([theta, diff_e, gen_e, life_e, log_best], dim=-1)
        h = self.trunk(x)
        return torch.cat([
            self.head_fairness(h),
            self.head_excitement(h),
            self.head_antiInflation(h),
        ], dim=-1)


def compute_loss(
    pred: torch.Tensor,                # [B, 3] - (fairness, excitement, antiInflation)
    target: torch.Tensor,              # [B, 3]
    theta: torch.Tensor,               # [B, 14]
    log_best: torch.Tensor,            # [B, 1]
    diff_idx: torch.Tensor,            # [B]
    gen_idx: torch.Tensor,             # [B]
    life_idx: torch.Tensor,            # [B]
    model: "SpawnTuningSurrogate" = None,
    lambda_mono: float = 0.3,
    lambda_smooth: float = 0.05,
) -> tuple[torch.Tensor, dict]:
    """
    总损失 = MSE + λ_mono · 单调性正则 + λ_smooth · 输出光滑正则

    单调性 (antiInflation 健康分应随 bestScore 单调不增):
        L_mono = mean(ReLU(d antiInflation_pred / d log_bestScore))

    光滑性 (输出对 θ 的梯度幅值不要太大):
        L_smooth = mean(||∇_θ pred||²)

    实现:
        用 torch.autograd.grad 显式求偏导,需要在 forward 时保持张量 requires_grad=True
        如果 model 未传入或正则系数为 0,跳过对应项 (训练快速通道)。
    """
    L_mse = F.mse_loss(pred, target)
    breakdown = {"mse": L_mse.item()}

    device = pred.device
    L_mono = torch.tensor(0.0, device=device)
    L_smooth = torch.tensor(0.0, device=device)

    if model is not None and (lambda_mono > 0 or lambda_smooth > 0):
        # 重新跑 forward 但 log_best / theta 设为 requires_grad,
        # 这样能用 torch.autograd.grad 显式求偏导。
        log_best_g = log_best.detach().clone().requires_grad_(True)
        theta_g = theta.detach().clone().requires_grad_(True)

        # forward 用 grad-enabled 输入
        pred_g = model(theta_g, diff_idx, gen_idx, life_idx, log_best_g)

        # 1. 单调性: ∂ antiInflation / ∂ log_best ≤ 0
        if lambda_mono > 0:
            antiInflation_pred = pred_g[:, 2]  # 第 3 个任务头
            grad_log = torch.autograd.grad(
                outputs=antiInflation_pred.sum(),
                inputs=log_best_g,
                create_graph=True,
                retain_graph=True,
            )[0]
            # 单调不增: 惩罚正梯度 (bestScore 升时 antiInflation 不该升)
            L_mono = F.relu(grad_log).mean()
            breakdown["mono"] = L_mono.item()

        # 2. 光滑性: ||∂ pred / ∂ θ||² 要小
        if lambda_smooth > 0:
            grad_theta = torch.autograd.grad(
                outputs=pred_g.sum(),
                inputs=theta_g,
                create_graph=True,
                retain_graph=True,
            )[0]
            L_smooth = (grad_theta ** 2).sum(dim=1).mean()
            breakdown["smooth"] = L_smooth.item()

    total = L_mse + lambda_mono * L_mono + lambda_smooth * L_smooth
    breakdown["total"] = total.item()
    return total, breakdown


def count_parameters(model: nn.Module) -> int:
    """统计可训练参数数量。"""
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == "__main__":
    # 自检
    model = SpawnTuningSurrogate()
    print(f"SpawnTuningSurrogate params: {count_parameters(model):,}")

    B = 32
    theta = torch.rand(B, 14)
    diff = torch.randint(0, 3, (B,))
    gen = torch.randint(0, 2, (B,))
    life = torch.randint(0, 4, (B,))
    log_best = torch.randn(B, 1)
    out = model(theta, diff, gen, life, log_best)
    print(f"forward shape: {out.shape}")
    assert out.shape == (B, 3)
    assert (out >= 0).all() and (out <= 1).all()
    print("✓ surrogate self-check passed")
