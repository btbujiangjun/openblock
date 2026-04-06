"""策略 / 价值双塔 + 残差 MLP（PyTorch）。φ、ψ 维度由 shared/game_rules.json 的 featureEncoding 决定（维度见 shared/game_rules.json 的 phiDim/stateDim）。"""

from __future__ import annotations

import torch
import torch.nn as nn

from .features import ACTION_FEATURE_DIM, PHI_DIM, STATE_FEATURE_DIM


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
        width: int = 384,
        policy_depth: int = 6,
        value_depth: int = 5,
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


class SharedPolicyValueNet(nn.Module):
    """AlphaZero 风格：状态只过一套残差塔，策略头对 (h(s), ψ(a)) 打分，避免对每个合法步重复整段 φ 编码。"""

    def __init__(
        self,
        width: int = 384,
        shared_depth: int = 6,
        mlp_ratio: float = 2.0,
        action_embed_dim: int | None = None,
    ):
        super().__init__()
        self.shared_stem = nn.Linear(STATE_FEATURE_DIM, width)
        self.shared_blocks = nn.ModuleList(
            [ResidualMLPBlock(width, mlp_ratio) for _ in range(shared_depth)]
        )
        ae = action_embed_dim if action_embed_dim is not None else max(width // 2, ACTION_FEATURE_DIM * 4)
        self.action_embed_dim = ae
        self.action_proj = nn.Linear(ACTION_FEATURE_DIM, ae)
        fusion_in = width + ae
        self.policy_fusion = nn.Sequential(
            nn.Linear(fusion_in, width),
            nn.GELU(),
            nn.Linear(width, 1),
        )
        self.value_head = nn.Linear(width, 1)

    def _encode_state(self, state_feat: torch.Tensor) -> torch.Tensor:
        x = self.shared_stem(state_feat)
        x = nn.functional.gelu(x)
        for blk in self.shared_blocks:
            x = blk(x)
        return x

    def forward_policy_logits(self, phi: torch.Tensor) -> torch.Tensor:
        """phi: [N, PHI_DIM]，各行 state 段须与首行一致（与 build_phi_batch 一致）。"""
        if phi.shape[0] == 0:
            return phi.new_zeros((0,))
        state0 = phi[0:1, :STATE_FEATURE_DIM]
        h = self._encode_state(state0)
        n = phi.shape[0]
        a = phi[:, STATE_FEATURE_DIM:]
        ae = self.action_proj(a)
        h_exp = h.expand(n, -1)
        x = torch.cat([h_exp, ae], dim=-1)
        return self.policy_fusion(x).squeeze(-1)

    def forward_value(self, state_feat: torch.Tensor) -> torch.Tensor:
        h = self._encode_state(state_feat)
        return self.value_head(h).squeeze(-1)
