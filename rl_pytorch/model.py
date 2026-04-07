"""
策略 / 价值网络（PyTorch）。
φ、ψ 维度由 shared/game_rules.json featureEncoding 决定。

提供五种架构（--arch）：
  conv-shared   — 新默认；CNN 棋盘编码 + 128 宽共享主干，~150K 参数，空间感知能力远超 MLP
  light-shared  — 2 层 64 宽共享主干 + 动作投射，~20K 参数
  light         — 2 层 64 宽双塔，~28K 参数
  shared        — 多层残差共享主干（旧默认，~1.2M 参数）
  split         — 多层残差双塔
"""

from __future__ import annotations

import torch
import torch.nn as nn

from .features import ACTION_FEATURE_DIM, PHI_DIM, STATE_FEATURE_DIM

_SCALAR_DIM = 15
_GRID_SIDE = 8
_GRID_FLAT = _GRID_SIDE * _GRID_SIDE
_DOCK_MASK_SIDE = 5
_DOCK_SLOTS = 3
_DOCK_FLAT = _DOCK_SLOTS * _DOCK_MASK_SIDE * _DOCK_MASK_SIDE


# ---------------------------------------------------------------------------
# Conv model — CNN 棋盘编码 + 共享 MLP 主干；对 8×8 空间模式有天然感知
# ---------------------------------------------------------------------------

class ConvSharedPolicyValueNet(nn.Module):
    """
    CNN 棋盘编码器 + 共享 MLP 主干 + 动作融合策略头 + 深价值头。

    从 STATE_FEATURE_DIM (154) 状态向量拆出三段：
      scalars[:15]    → 直连
      grid[15:79]     → reshape(1,8,8) → Conv2d → 全局平均池化 → channels 维
      dock[79:154]    → 直连 (3×5×5 待选块掩码)

    三段拼合走宽 MLP 得到 h(s)；策略为 h(s)⊕ψ(a)→logit，价值为 h(s)→MLP→V。
    ~150K 参数 (width=128, conv_channels=32, action_embed_dim=48)。
    """

    def __init__(
        self,
        width: int = 128,
        conv_channels: int = 32,
        action_embed_dim: int = 48,
    ):
        super().__init__()
        self.width = width
        self.conv_channels = conv_channels
        self.action_embed_dim = action_embed_dim

        self.grid_conv = nn.Sequential(
            nn.Conv2d(1, conv_channels, 3, padding=1),
            nn.GELU(),
            nn.Conv2d(conv_channels, conv_channels, 3, padding=1),
            nn.GELU(),
            nn.Conv2d(conv_channels, conv_channels, 3, padding=1),
            nn.GELU(),
        )
        grid_out_dim = conv_channels

        trunk_in = _SCALAR_DIM + grid_out_dim + _DOCK_FLAT
        self.trunk_norm = nn.LayerNorm(trunk_in)
        self.trunk_fc1 = nn.Linear(trunk_in, width)
        self.trunk_fc2 = nn.Linear(width, width)
        self.trunk_fc3 = nn.Linear(width, width)

        self.action_proj = nn.Linear(ACTION_FEATURE_DIM, action_embed_dim)
        self.policy_fuse = nn.Sequential(
            nn.Linear(width + action_embed_dim, width),
            nn.GELU(),
            nn.Linear(width, 1),
        )
        self.value_head = nn.Sequential(
            nn.Linear(width, width // 2),
            nn.GELU(),
            nn.Linear(width // 2, 1),
        )

    def _encode_state(self, s: torch.Tensor) -> torch.Tensor:
        """s: [B, 154] → h: [B, width]"""
        scalars = s[:, :_SCALAR_DIM]
        grid = s[:, _SCALAR_DIM:_SCALAR_DIM + _GRID_FLAT].reshape(-1, 1, _GRID_SIDE, _GRID_SIDE)
        dock = s[:, _SCALAR_DIM + _GRID_FLAT:]

        g = self.grid_conv(grid)
        g = g.mean(dim=(-2, -1))

        x = torch.cat([scalars, g, dock], dim=-1)
        x = self.trunk_norm(x)
        x = nn.functional.gelu(self.trunk_fc1(x))
        x = x + nn.functional.gelu(self.trunk_fc2(x))
        x = x + nn.functional.gelu(self.trunk_fc3(x))
        return x

    def forward_policy_logits(self, phi: torch.Tensor) -> torch.Tensor:
        if phi.shape[0] == 0:
            return phi.new_zeros((0,))
        state0 = phi[0:1, :STATE_FEATURE_DIM]
        h = self._encode_state(state0)
        a = phi[:, STATE_FEATURE_DIM:]
        ae = nn.functional.gelu(self.action_proj(a))
        h_exp = h.expand(a.shape[0], -1)
        x = torch.cat([h_exp, ae], dim=-1)
        return self.policy_fuse(x).squeeze(-1)

    def forward_value(self, state_feat: torch.Tensor) -> torch.Tensor:
        h = self._encode_state(state_feat)
        return self.value_head(h).squeeze(-1)

    def forward_batched(
        self,
        state_feats: torch.Tensor,
        action_feats: torch.Tensor,
        actions_per_step: torch.Tensor,
        values_precomputed: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        h = self._encode_state(state_feats)
        if values_precomputed is not None:
            values = values_precomputed
        else:
            values = self.value_head(h).squeeze(-1)
        ae = nn.functional.gelu(self.action_proj(action_feats))
        h_exp = torch.repeat_interleave(h, actions_per_step, dim=0)
        x = torch.cat([h_exp, ae], dim=-1)
        logits = self.policy_fuse(x).squeeze(-1)
        return logits, values


# ---------------------------------------------------------------------------
# Light models — 匹配游戏策略空间的低有效维度（与线性模型同数量级表达力）
# ---------------------------------------------------------------------------

class LightPolicyValueNet(nn.Module):
    """双塔 2 层 MLP，~28K 参数。"""

    def __init__(self, width: int = 64):
        super().__init__()
        self.width = width
        self.policy_fc1 = nn.Linear(PHI_DIM, width)
        self.policy_fc2 = nn.Linear(width, width)
        self.policy_head = nn.Linear(width, 1)
        self.value_fc1 = nn.Linear(STATE_FEATURE_DIM, width)
        self.value_fc2 = nn.Linear(width, width)
        self.value_head = nn.Linear(width, 1)

    def forward_policy_logits(self, phi: torch.Tensor) -> torch.Tensor:
        x = nn.functional.gelu(self.policy_fc1(phi))
        x = nn.functional.gelu(self.policy_fc2(x))
        return self.policy_head(x).squeeze(-1)

    def forward_value(self, state_feat: torch.Tensor) -> torch.Tensor:
        x = nn.functional.gelu(self.value_fc1(state_feat))
        x = nn.functional.gelu(self.value_fc2(x))
        return self.value_head(x).squeeze(-1)

    def forward_batched(
        self,
        state_feats: torch.Tensor,
        action_feats: torch.Tensor,
        actions_per_step: torch.Tensor,
        values_precomputed: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Fused: values [K] + policy logits [total_actions] in large GPU batches.

        ``values_precomputed``：多卡时对价值头已做 ``data_parallel`` 时可传入，跳过重算 ``forward_value``。
        """
        if values_precomputed is not None:
            values = values_precomputed
        else:
            values = self.forward_value(state_feats)
        s_exp = torch.repeat_interleave(state_feats, actions_per_step, dim=0)
        phi = torch.cat([s_exp, action_feats], dim=-1)
        logits = self.forward_policy_logits(phi)
        return logits, values


class LightSharedPolicyValueNet(nn.Module):
    """共享主干 2 层 MLP + 动作投射 + 融合头，~20K 参数；状态只编码一次。"""

    def __init__(self, width: int = 64, action_embed_dim: int = 32):
        super().__init__()
        self.width = width
        self.action_embed_dim = action_embed_dim
        self.state_fc1 = nn.Linear(STATE_FEATURE_DIM, width)
        self.state_fc2 = nn.Linear(width, width)
        self.action_proj = nn.Linear(ACTION_FEATURE_DIM, action_embed_dim)
        self.policy_fuse = nn.Sequential(
            nn.Linear(width + action_embed_dim, width),
            nn.GELU(),
            nn.Linear(width, 1),
        )
        self.value_head = nn.Linear(width, 1)

    def _encode_state(self, s: torch.Tensor) -> torch.Tensor:
        x = nn.functional.gelu(self.state_fc1(s))
        return nn.functional.gelu(self.state_fc2(x))

    def forward_policy_logits(self, phi: torch.Tensor) -> torch.Tensor:
        if phi.shape[0] == 0:
            return phi.new_zeros((0,))
        state0 = phi[0:1, :STATE_FEATURE_DIM]
        h = self._encode_state(state0)
        a = phi[:, STATE_FEATURE_DIM:]
        ae = nn.functional.gelu(self.action_proj(a))
        h_exp = h.expand(a.shape[0], -1)
        x = torch.cat([h_exp, ae], dim=-1)
        return self.policy_fuse(x).squeeze(-1)

    def forward_value(self, state_feat: torch.Tensor) -> torch.Tensor:
        h = self._encode_state(state_feat)
        return self.value_head(h).squeeze(-1)

    def forward_batched(
        self,
        state_feats: torch.Tensor,
        action_feats: torch.Tensor,
        actions_per_step: torch.Tensor,
        values_precomputed: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Fused: encode states once → values [K] + policy logits [total_actions].

        ``values_precomputed``：多卡并行价值头时传入，仍会在本设备上算 ``_encode_state`` 供策略支路使用。
        """
        h = self._encode_state(state_feats)
        if values_precomputed is not None:
            values = values_precomputed
        else:
            values = self.value_head(h).squeeze(-1)
        ae = nn.functional.gelu(self.action_proj(action_feats))
        h_exp = torch.repeat_interleave(h, actions_per_step, dim=0)
        x = torch.cat([h_exp, ae], dim=-1)
        logits = self.policy_fuse(x).squeeze(-1)
        return logits, values


# ---------------------------------------------------------------------------
# Heavy models — 残差 MLP；用于超大规模训练或从旧 checkpoint 续训
# ---------------------------------------------------------------------------

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
        x = self.policy_stem(phi)
        x = nn.functional.gelu(x)
        for blk in self.policy_blocks:
            x = blk(x)
        return self.policy_head(x).squeeze(-1)

    def forward_value(self, state_feat: torch.Tensor) -> torch.Tensor:
        x = self.value_stem(state_feat)
        x = nn.functional.gelu(x)
        for blk in self.value_blocks:
            x = blk(x)
        return self.value_head(x).squeeze(-1)


class SharedPolicyValueNet(nn.Module):
    """AlphaZero 风格：状态只过一套残差塔，策略头对 (h(s), ψ(a)) 打分。"""

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
