"""
策略 / 价值双塔，带残差 MLP（MLX）。
对合法动作特征 φ∈R^22 与状态 ψ∈R^15 分别做深层编码。
"""

from __future__ import annotations

import mlx.core as mx
import mlx.nn as nn

from .features import PHI_DIM, STATE_FEATURE_DIM


class ResidualMLPBlock(nn.Module):
    """Pre-LayerNorm + GELU MLP + 残差。"""

    def __init__(self, dim: int, mlp_ratio: float = 2.0):
        super().__init__()
        hidden = max(int(dim * mlp_ratio), dim)
        self.norm = nn.LayerNorm(dim)
        self.fc1 = nn.Linear(dim, hidden)
        self.fc2 = nn.Linear(hidden, dim)

    def __call__(self, x: mx.array) -> mx.array:
        h = self.norm(x)
        h = self.fc1(h)
        h = nn.gelu(h)
        h = self.fc2(h)
        return x + h


class PolicyValueNet(nn.Module):
    def __init__(
        self,
        width: int = 256,
        policy_depth: int = 4,
        value_depth: int = 4,
        mlp_ratio: float = 2.0,
    ):
        super().__init__()
        self.policy_stem = nn.Linear(PHI_DIM, width)
        self.policy_blocks = [ResidualMLPBlock(width, mlp_ratio) for _ in range(policy_depth)]
        self.policy_head = nn.Linear(width, 1)

        self.value_stem = nn.Linear(STATE_FEATURE_DIM, width)
        self.value_blocks = [ResidualMLPBlock(width, mlp_ratio) for _ in range(value_depth)]
        self.value_head = nn.Linear(width, 1)

    def policy_logits(self, phi: mx.array) -> mx.array:
        """phi: [N, PHI_DIM] -> logits [N]"""
        x = self.policy_stem(phi)
        x = nn.gelu(x)
        for blk in self.policy_blocks:
            x = blk(x)
        return self.policy_head(x).squeeze(-1)

    def value(self, state_feat: mx.array) -> mx.array:
        """state_feat: [B, STATE_FEATURE_DIM] -> [B]"""
        x = self.value_stem(state_feat)
        x = nn.gelu(x)
        for blk in self.value_blocks:
            x = blk(x)
        return self.value_head(x).squeeze(-1)
