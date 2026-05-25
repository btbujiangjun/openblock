"""
ResNet-MLP 模型 (L4) — 用于学习 (ctx, θ) → d_curve(20) + 辅助标签(4) 的映射。

架构 (~235K 参数):
  Input (46)
    └─ ctx_embedding (32):
       Embedding(difficulty, generator, bot_policy, pb_bin, lifecycle) → concat → 28
       + log10(pb_actual) z-score projected → 4
    └─ θ_normalized (14)
  ↓
  trunk_in: Linear(46→256) + LayerNorm + GELU
  ↓
  ResBlock × 8: 每块 Linear(256→256)×2 + LayerNorm×2 + Dropout + Residual
  ↓
  LayerNorm(256)
  ↓
  Heads:
    head_curve:    256 → 128 → 20    (sigmoid)
    head_pb:       256 → 64  → 1     (sigmoid, pb_broke prob)
    head_noMove:   256 → 64  → 1     (sigmoid, 归一化 noMove_step)
    head_score:    256 → 64  → 1     (linear, log_score)
    head_survival: 256 → 64  → 1     (sigmoid)

参数量校验请见 tests/spawn_tuning_v2/test_model.py::test_param_count
"""
from __future__ import annotations
import torch
import torch.nn as nn
import torch.nn.functional as F

# ─────────── 默认超参 ───────────

DEFAULT_HIDDEN_DIM = 128  # 实测 hidden=128 + 8 blocks ≈ 325K 参数, 符合 L4 量级
DEFAULT_N_BLOCKS = 8
DEFAULT_DROPOUT = 0.1
DEFAULT_HEAD_HIDDEN = 64

# 5 维 context 取值数 (与 schema CHECK 一致)
N_DIFFICULTY = 3
N_GENERATOR = 2
N_BOT_POLICY = 3
N_PB_BIN = 5
N_LIFECYCLE = 4
N_THETA = 14
N_CURVE_BINS = 20

# Embedding 维度
EMB_DIFF = 4
EMB_GEN = 4
EMB_BOT = 4
EMB_PB = 8
EMB_LIFE = 8
EMB_LOG_PB_PROJ = 4
EMB_TOTAL = EMB_DIFF + EMB_GEN + EMB_BOT + EMB_PB + EMB_LIFE + EMB_LOG_PB_PROJ  # = 32


class ResBlock(nn.Module):
    """简单 MLP 残差块: Linear → LN → GELU → Dropout → Linear → LN → +x → GELU"""

    def __init__(self, dim: int, dropout: float = DEFAULT_DROPOUT):
        super().__init__()
        self.fc1 = nn.Linear(dim, dim)
        self.ln1 = nn.LayerNorm(dim)
        self.fc2 = nn.Linear(dim, dim)
        self.ln2 = nn.LayerNorm(dim)
        self.dropout = nn.Dropout(dropout)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.fc1(x)
        h = self.ln1(h)
        h = F.gelu(h)
        h = self.dropout(h)
        h = self.fc2(h)
        h = self.ln2(h)
        return F.gelu(h + x)


class ContextEmbedding(nn.Module):
    """5 维离散 context + log_pb 数值 → 32 维稠密向量"""

    def __init__(self):
        super().__init__()
        self.emb_diff = nn.Embedding(N_DIFFICULTY, EMB_DIFF)
        self.emb_gen = nn.Embedding(N_GENERATOR, EMB_GEN)
        self.emb_bot = nn.Embedding(N_BOT_POLICY, EMB_BOT)
        self.emb_pb = nn.Embedding(N_PB_BIN, EMB_PB)
        self.emb_life = nn.Embedding(N_LIFECYCLE, EMB_LIFE)
        self.proj_log_pb = nn.Linear(1, EMB_LOG_PB_PROJ)

    def forward(
        self,
        difficulty_idx: torch.Tensor,
        generator_idx: torch.Tensor,
        bot_idx: torch.Tensor,
        pb_bin_idx: torch.Tensor,
        lifecycle_idx: torch.Tensor,
        log_pb: torch.Tensor,
    ) -> torch.Tensor:
        # log_pb: (B,) → (B, 1)
        if log_pb.dim() == 1:
            log_pb = log_pb.unsqueeze(-1)
        return torch.cat([
            self.emb_diff(difficulty_idx),
            self.emb_gen(generator_idx),
            self.emb_bot(bot_idx),
            self.emb_pb(pb_bin_idx),
            self.emb_life(lifecycle_idx),
            self.proj_log_pb(log_pb),
        ], dim=-1)  # (B, 32)


class SpawnTuningResNetMLP(nn.Module):
    """L4 主模型: ResNet-MLP (8 个残差块, hidden=256)"""

    def __init__(
        self,
        hidden_dim: int = DEFAULT_HIDDEN_DIM,
        n_blocks: int = DEFAULT_N_BLOCKS,
        dropout: float = DEFAULT_DROPOUT,
        head_hidden: int = DEFAULT_HEAD_HIDDEN,
        curve_bins: int = N_CURVE_BINS,
    ):
        super().__init__()
        self.hidden_dim = hidden_dim
        self.n_blocks = n_blocks
        self.curve_bins = curve_bins

        self.ctx_emb = ContextEmbedding()
        input_dim = EMB_TOTAL + N_THETA  # 32 + 14 = 46

        # Trunk
        self.trunk_in = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.LayerNorm(hidden_dim),
            nn.GELU(),
        )
        self.blocks = nn.ModuleList([
            ResBlock(hidden_dim, dropout=dropout) for _ in range(n_blocks)
        ])
        self.trunk_out_ln = nn.LayerNorm(hidden_dim)

        # Heads
        self.head_curve = self._build_head(hidden_dim, 128, curve_bins)
        self.head_pb = self._build_head(hidden_dim, head_hidden, 1)
        self.head_noMove = self._build_head(hidden_dim, head_hidden, 1)
        self.head_score = self._build_head(hidden_dim, head_hidden, 1)
        self.head_survival = self._build_head(hidden_dim, head_hidden, 1)

    @staticmethod
    def _build_head(in_dim: int, h_dim: int, out_dim: int) -> nn.Sequential:
        return nn.Sequential(
            nn.Linear(in_dim, h_dim),
            nn.GELU(),
            nn.Linear(h_dim, out_dim),
        )

    def encode(
        self,
        difficulty_idx, generator_idx, bot_idx, pb_bin_idx, lifecycle_idx,
        log_pb, theta_norm,
    ) -> torch.Tensor:
        """编码到 trunk 输出 (用于 surrogate inspection)。"""
        ctx = self.ctx_emb(difficulty_idx, generator_idx, bot_idx, pb_bin_idx, lifecycle_idx, log_pb)
        x = torch.cat([ctx, theta_norm], dim=-1)
        x = self.trunk_in(x)
        for block in self.blocks:
            x = block(x)
        return self.trunk_out_ln(x)

    def forward(
        self,
        difficulty_idx, generator_idx, bot_idx, pb_bin_idx, lifecycle_idx,
        log_pb, theta_norm,
    ) -> dict:
        """前向: 返回包含所有 head 输出的 dict。

        所有输入形状: (B,) for 类别, (B,) for log_pb, (B, 14) for theta_norm。
        """
        h = self.encode(
            difficulty_idx, generator_idx, bot_idx, pb_bin_idx, lifecycle_idx,
            log_pb, theta_norm,
        )
        return {
            "curve": torch.sigmoid(self.head_curve(h)),         # (B, 20)
            "pb_broke": torch.sigmoid(self.head_pb(h)).squeeze(-1),     # (B,)
            "noMove": torch.sigmoid(self.head_noMove(h)).squeeze(-1),   # (B,)
            "score": self.head_score(h).squeeze(-1),                    # (B,) linear (log_score)
            "survival": torch.sigmoid(self.head_survival(h)).squeeze(-1),  # (B,)
        }

    def count_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


def build_default_model() -> SpawnTuningResNetMLP:
    """构造默认配置的 ResNet-MLP (L4) 模型。"""
    return SpawnTuningResNetMLP()
