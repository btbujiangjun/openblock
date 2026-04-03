"""策略 / 价值双塔 + 残差 MLP（PyTorch）。φ∈R^22，ψ∈R^15。"""

from __future__ import annotations

import torch
import torch.nn as nn

from .features import PHI_DIM, STATE_FEATURE_DIM


class ResidualMLPBlock(nn.Module):
    """Pre-LayerNorm + GELU FFN + 残差。"""

    def __init__(self, dim: int, mlp_ratio: float = 2.0):
        super().__init__()
        hidden = max(int(dim * mlp_ratio), dim)
        self.norm = nn.LayerNorm(dim)
        self.fc1 = nn.Linear(dim, hidden)
        self.fc2 = nn.Linear(hidden, dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.norm(x)
        h = self.fc1(h)
        h = nn.functional.gelu(h)
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
        self.policy_blocks = nn.ModuleList(
            [ResidualMLPBlock(width, mlp_ratio) for _ in range(policy_depth)]
        )
        self.policy_head = nn.Linear(width, 1)

        self.value_stem = nn.Linear(STATE_FEATURE_DIM, width)
        self.value_blocks = nn.ModuleList(
            [ResidualMLPBlock(width, mlp_ratio) for _ in range(value_depth)]
        )
        self.value_head = nn.Linear(width, 1)

    def forward_policy_logits(self, phi: torch.Tensor) -> torch.Tensor:
        """phi: [N, PHI_DIM] -> logits [N]"""
        x = self.policy_stem(phi)
        x = nn.functional.gelu(x)
        for blk in self.policy_blocks:
            x = blk(x)
        return self.policy_head(x).squeeze(-1)

    def forward_value(self, state_feat: torch.Tensor) -> torch.Tensor:
        """state_feat: [B, STATE_FEATURE_DIM] -> [B]"""
        x = self.value_stem(state_feat)
        x = nn.functional.gelu(x)
        for blk in self.value_blocks:
            x = blk(x)
        return self.value_head(x).squeeze(-1)
