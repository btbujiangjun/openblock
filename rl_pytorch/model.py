"""
策略 / 价值网络（PyTorch）- v5。

v5 核心改动（不收敛根因修复）：
  - DockBoardAttention: 每个 dock 块对棋盘 CNN 特征做交叉注意力，替代 flat MLP；
    让网络理解「哪个块能补哪行」的组合信息
  - 三个直接监督头（不依赖稀疏 MC returns，每步都有即时梯度）：
    board_quality_head: 回归 board_potential 棋盘质量分
    feasibility_head:   二分类 "剩余块是否全部可放"
    survival_head:      回归 "还能活多少步 / 30"
  - clear_pred_head（v4 保留）：4 类消行预测

state=181 (42 scalars + 64 grid + 75 dock), action=12, phi=193。
"""

from __future__ import annotations

import torch
import torch.nn as nn

from .features import ACTION_FEATURE_DIM, PHI_DIM, STATE_FEATURE_DIM
from .game_rules import FEATURE_ENCODING

_SCALAR_DIM = int(FEATURE_ENCODING.get("stateScalarDim", 23))
_GRID_SIDE = int(FEATURE_ENCODING.get("maxGridWidth", 8))
_GRID_FLAT = _GRID_SIDE * _GRID_SIDE
_DOCK_MASK_SIDE = int(FEATURE_ENCODING.get("dockMaskSide", 5))
_DOCK_SLOTS = int(FEATURE_ENCODING.get("dockSlots", 3))
_DOCK_FLAT = _DOCK_SLOTS * _DOCK_MASK_SIDE * _DOCK_MASK_SIDE


# ---------------------------------------------------------------------------
# Dock-Board Cross-Attention — 让每个 dock 块"看"棋盘空间特征
# ---------------------------------------------------------------------------

class DockBoardAttention(nn.Module):
    """每个 dock 块（5×5 mask）对 CNN 棋盘空间特征做 cross-attention。

    Q = dock_mask(25) → Linear → [head_dim]
    K, V = grid_conv(C, H, W) → Conv1×1 → [head_dim, H*W]
    Output = softmax(Q·K / √d) · V → [3, head_dim] → flatten → [3*head_dim]

    这让网络回答「这个 L 形块放在哪片区域最合适？」——替代 flat MLP(75→32) 的盲压缩。
    """

    def __init__(self, dock_cell_dim: int = 25, grid_channels: int = 32, head_dim: int = 16):
        super().__init__()
        self.head_dim = head_dim
        self.q_proj = nn.Linear(dock_cell_dim, head_dim)
        self.k_proj = nn.Conv2d(grid_channels, head_dim, 1)
        self.v_proj = nn.Conv2d(grid_channels, head_dim, 1)
        self.out_proj = nn.Linear(head_dim, head_dim)

    def forward(self, dock_masks: torch.Tensor, grid_feat: torch.Tensor) -> torch.Tensor:
        """
        dock_masks: [B, 3, 25]  (3 dock blocks, each 5×5 flattened)
        grid_feat:  [B, C, 8, 8] (CNN features before global average pooling)
        Returns:    [B, 3 * head_dim]
        """
        B = dock_masks.shape[0]
        q = self.q_proj(dock_masks)  # [B, 3, hd]
        k = self.k_proj(grid_feat).reshape(B, self.head_dim, -1)  # [B, hd, 64]
        v = self.v_proj(grid_feat).reshape(B, self.head_dim, -1)  # [B, hd, 64]
        attn = torch.bmm(q, k) / (self.head_dim ** 0.5)  # [B, 3, 64]
        attn = nn.functional.softmax(attn, dim=-1)
        ctx = torch.bmm(attn, v.transpose(1, 2))  # [B, 3, hd]
        ctx = self.out_proj(ctx)  # [B, 3, hd]
        return ctx.reshape(B, -1)  # [B, 3*hd]


# ---------------------------------------------------------------------------
# DockPointEncoder — 形状感知 PointNet 编码器（v8.1 新增）
# ---------------------------------------------------------------------------

class DockPointEncoder(nn.Module):
    """PointNet 风格的 dock 块编码器，替代 5×5 mask 的平坦压缩。

    动机
    ----
    5×5 mask（25 维）将形状放置在固定画布中心，丢失了精确的相对坐标关系；
    PointNet 对每个占用格子编码坐标 (x, y)，通过最大池化聚合成固定维度表示，
    天然具有平移不变性且对不规则形状更精确。

    输入格式
    --------
    5×5 mask（来自 features.py `_encode_shape_mask`）: shape (B, _DOCK_SLOTS, 25)
    → 内部转换为点集 (x_norm, y_norm, occupancy) → per-point MLP → max pool

    输出
    ----
    shape (B, _DOCK_SLOTS, out_dim)  — 与 DockBoardAttention 接口对齐

    设计特点
    --------
    - 与现有状态特征维度兼容：out_dim=16（同 dock_attn_head_dim 的默认值）
    - 空 dock 槽（全零 mask）输出全零向量（无块时无信号）
    - 参数量极少（~1K）：2 层 MLP + max pool
    """

    def __init__(self, mask_side: int = 5, hidden_dim: int = 32, out_dim: int = 16):
        super().__init__()
        self.mask_side = mask_side
        self.out_dim = out_dim

        # 每个点的坐标编码：(x_norm, y_norm) → hidden
        self.point_mlp = nn.Sequential(
            nn.Linear(2, hidden_dim),
            nn.GELU(),
            nn.Linear(hidden_dim, out_dim),
        )
        # 将每个 slot 聚合后做一次非线性变换
        self.slot_proj = nn.Sequential(
            nn.Linear(out_dim, out_dim),
            nn.GELU(),
        )

        # 预计算归一化坐标（常量，注册为 buffer）
        coords = []
        for y in range(mask_side):
            for x in range(mask_side):
                coords.append([x / (mask_side - 1) - 0.5, y / (mask_side - 1) - 0.5])
        self.register_buffer(
            "point_coords",
            torch.tensor(coords, dtype=torch.float32),  # (25, 2)
        )

    def forward(self, dock_masks: torch.Tensor) -> torch.Tensor:
        """
        dock_masks: (B, _DOCK_SLOTS, mask_side²)  — 同 DockBoardAttention 的 dock 输入
        Returns:   (B, _DOCK_SLOTS * out_dim)      — 与 DockBoardAttention 返回兼容
        """
        B, S, P = dock_masks.shape  # P = mask_side²
        assert P == self.mask_side ** 2

        # 坐标矩阵：(1, 1, P, 2) → 广播到 (B, S, P, 2)
        coords = self.point_coords.unsqueeze(0).unsqueeze(0).expand(B, S, P, 2)

        # 每点特征：(B, S, P, out_dim)
        pt_feat = self.point_mlp(coords)  # (B*S*P, out_dim) 形式经广播

        # 用 mask 加权（空格子贡献 0）
        mask_w = dock_masks.unsqueeze(-1)  # (B, S, P, 1)
        pt_feat = pt_feat * mask_w

        # max pooling over points（空 slot 全零）
        slot_feat, _ = pt_feat.max(dim=2)  # (B, S, out_dim)
        slot_feat = self.slot_proj(slot_feat)  # (B, S, out_dim)

        return slot_feat.reshape(B, -1)  # (B, S * out_dim)


# ---------------------------------------------------------------------------
# Conv model — CNN 棋盘编码 + 共享 MLP 主干；对 8×8 空间模式有天然感知
# ---------------------------------------------------------------------------

class _ResConvBlock(nn.Module):
    """Conv2d + GELU + Conv2d + residual。"""

    def __init__(self, ch: int):
        super().__init__()
        self.conv1 = nn.Conv2d(ch, ch, 3, padding=1)
        self.conv2 = nn.Conv2d(ch, ch, 3, padding=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = nn.functional.gelu(self.conv1(x))
        h = self.conv2(h)
        return nn.functional.gelu(x + h)


class ConvSharedPolicyValueNet(nn.Module):
    """v5: CNN 棋盘编码 + DockBoardAttention 交叉注意力 + 直接监督三头。

    从 STATE_FEATURE_DIM (181) 拆三段：
      scalars[:42]     → 直连
      grid[42:106]     → reshape(1,8,8) → Conv→ResConv×2 → 两路输出：
                          (a) 全局池化 → conv_channels 维
                          (b) 空间特征 [C,8,8] 供 dock cross-attention
      dock[106:181]    → reshape(3,5,5) → DockBoardAttention(grid_spatial) → 3×head_dim 维

    三段拼合走 trunk → h(s)；策略 = h(s)⊕ψ(a)→logit；价值 = h(s)→MLP→V。
    直接监督三头（board_quality / feasibility / survival）从 h(s) 出发，
    每步都有即时梯度，不依赖稀疏 MC returns。
    """

    def __init__(
        self,
        width: int = 128,
        conv_channels: int = 32,
        action_embed_dim: int = 48,
        dock_attn_head_dim: int = 16,
        use_point_encoder: bool = False,
    ):
        """
        Args:
            use_point_encoder: True=使用 DockPointEncoder（PointNet 形状感知编码）
                替代 DockBoardAttention；输出维度相同 (3 × head_dim)，但表示更精确。
                注：改变此参数后需从头训练，不兼容旧 checkpoint。
        """
        super().__init__()
        self.width = width
        self.conv_channels = conv_channels
        self.action_embed_dim = action_embed_dim
        self.use_point_encoder = use_point_encoder

        self.grid_conv_stem = nn.Sequential(
            nn.Conv2d(1, conv_channels, 3, padding=1),
            nn.GELU(),
        )
        self.grid_res1 = _ResConvBlock(conv_channels)
        self.grid_res2 = _ResConvBlock(conv_channels)

        if use_point_encoder:
            # PointNet 形状感知编码：不依赖空间 grid 特征，独立编码每个 dock 块
            self.dock_encoder = DockPointEncoder(
                mask_side=_DOCK_MASK_SIDE,
                hidden_dim=conv_channels,
                out_dim=dock_attn_head_dim,
            )
        else:
            # 默认 DockBoardAttention：dock mask 对 CNN grid 特征做交叉注意力
            self.dock_board_attn = DockBoardAttention(
                dock_cell_dim=_DOCK_MASK_SIDE * _DOCK_MASK_SIDE,
                grid_channels=conv_channels,
                head_dim=dock_attn_head_dim,
            )
        dock_ctx_dim = _DOCK_SLOTS * dock_attn_head_dim  # 3 × 16 = 48

        trunk_in = _SCALAR_DIM + conv_channels + dock_ctx_dim  # 23 + 32 + 48 = 103
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
            nn.Linear(width, width),
            nn.GELU(),
            nn.Linear(width, width // 2),
            nn.GELU(),
            nn.Linear(width // 2, 1),
        )
        fuse_in = width + action_embed_dim
        hid = max(width // 2, 32)
        self.hole_aux_head = nn.Sequential(
            nn.Linear(fuse_in, hid), nn.GELU(), nn.Linear(hid, 1),
        )
        self.clear_pred_head = nn.Sequential(
            nn.Linear(fuse_in, hid), nn.GELU(), nn.Linear(hid, 4),
        )
        self.board_quality_head = nn.Sequential(
            nn.Linear(width, hid), nn.GELU(), nn.Linear(hid, 1),
        )
        self.feasibility_head = nn.Sequential(
            nn.Linear(width, hid), nn.GELU(), nn.Linear(hid, 1),
        )
        self.survival_head = nn.Sequential(
            nn.Linear(width, hid), nn.GELU(), nn.Linear(hid, 1),
        )

    def _encode_state(self, s: torch.Tensor) -> torch.Tensor:
        """s: [B, STATE_FEATURE_DIM] → h: [B, width]"""
        scalars = s[:, :_SCALAR_DIM]
        grid = s[:, _SCALAR_DIM:_SCALAR_DIM + _GRID_FLAT].reshape(-1, 1, _GRID_SIDE, _GRID_SIDE)
        dock_raw = s[:, _SCALAR_DIM + _GRID_FLAT:]

        g = self.grid_conv_stem(grid)
        g = self.grid_res1(g)
        g = self.grid_res2(g)          # [B, C, 8, 8]
        g_pooled = g.mean(dim=(-2, -1))  # [B, C]

        dock_3 = dock_raw.reshape(-1, _DOCK_SLOTS, _DOCK_MASK_SIDE * _DOCK_MASK_SIDE)
        if self.use_point_encoder:
            # PointNet 形状感知编码：独立编码每个 dock 块的点集
            dock_ctx = self.dock_encoder(dock_3)   # [B, 48]
        else:
            # 默认：dock 对 CNN 棋盘特征做交叉注意力
            dock_ctx = self.dock_board_attn(dock_3, g)  # [B, 48]

        x = torch.cat([scalars, g_pooled, dock_ctx], dim=-1)
        x = self.trunk_norm(x)
        x = nn.functional.gelu(self.trunk_fc1(x))
        x = x + nn.functional.gelu(self.trunk_fc2(x))
        x = x + nn.functional.gelu(self.trunk_fc3(x))
        return x

    def forward_trunk(self, s: torch.Tensor) -> torch.Tensor:
        """共享主干 h(s)，供单机多卡 ``data_parallel`` 切分 batch 维。"""
        return self._encode_state(s)

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
        trunk_hidden: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        if trunk_hidden is not None:
            h = trunk_hidden
        else:
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

    def forward_hole_aux(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        """预测落子后归一化空洞数 ∈[0,1] 量级（训练目标由外部除以 holeAuxTargetMax）。"""
        h = self._encode_state(state_feat)
        ae = nn.functional.gelu(self.action_proj(chosen_action_feat))
        x = torch.cat([h, ae], dim=-1)
        return self.hole_aux_head(x).squeeze(-1)

    def forward_clear_pred(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        """预测落子后消行数 [B, 4] logits（0/1/2/3+ 四类）。"""
        h = self._encode_state(state_feat)
        ae = nn.functional.gelu(self.action_proj(chosen_action_feat))
        x = torch.cat([h, ae], dim=-1)
        return self.clear_pred_head(x)

    def forward_board_quality(self, state_feat: torch.Tensor) -> torch.Tensor:
        """回归棋盘质量分（归一化后的 board_potential）。"""
        h = self._encode_state(state_feat)
        return self.board_quality_head(h).squeeze(-1)

    def forward_feasibility(self, state_feat: torch.Tensor) -> torch.Tensor:
        """logits: 剩余 dock 块是否全部可放。"""
        h = self._encode_state(state_feat)
        return self.feasibility_head(h).squeeze(-1)

    def forward_survival(self, state_feat: torch.Tensor) -> torch.Tensor:
        """回归 steps_remaining / 30（归一化生存步数）。"""
        h = self._encode_state(state_feat)
        return self.survival_head(h).squeeze(-1)

    def forward_aux_all(self, state_feats: torch.Tensor) -> dict[str, torch.Tensor]:
        """一次编码，并行输出三个辅助头的预测值。"""
        h = self._encode_state(state_feats)
        return {
            "board_quality": self.board_quality_head(h).squeeze(-1),
            "feasibility": self.feasibility_head(h).squeeze(-1),
            "survival": self.survival_head(h).squeeze(-1),
        }


# ---------------------------------------------------------------------------
# Light models — 匹配游戏策略空间的低有效维度（与线性模型同数量级表达力）
# ---------------------------------------------------------------------------

class _AuxStubsMixin:
    """为没有三头直接监督的轻量架构提供返回零张量的 stub。"""

    def forward_board_quality(self, state_feat: torch.Tensor) -> torch.Tensor:
        return state_feat.new_zeros(state_feat.shape[0])

    def forward_feasibility(self, state_feat: torch.Tensor) -> torch.Tensor:
        return state_feat.new_zeros(state_feat.shape[0])

    def forward_survival(self, state_feat: torch.Tensor) -> torch.Tensor:
        return state_feat.new_zeros(state_feat.shape[0])

    def forward_aux_all(self, state_feats: torch.Tensor) -> dict[str, torch.Tensor]:
        z = state_feats.new_zeros(state_feats.shape[0])
        return {"board_quality": z, "feasibility": z, "survival": z}


class LightPolicyValueNet(_AuxStubsMixin, nn.Module):
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
        self.hole_aux_head = nn.Sequential(
            nn.Linear(PHI_DIM, width),
            nn.GELU(),
            nn.Linear(width, 1),
        )
        self.clear_pred_head = nn.Sequential(
            nn.Linear(PHI_DIM, width),
            nn.GELU(),
            nn.Linear(width, 4),
        )

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
        trunk_hidden: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Fused: values [K] + policy logits [total_actions] in large GPU batches.

        ``values_precomputed``：多卡时对价值头已做 ``data_parallel`` 时可传入，跳过重算 ``forward_value``。
        ``trunk_hidden``：未使用（双塔结构无单独 trunk）。
        """
        del trunk_hidden
        if values_precomputed is not None:
            values = values_precomputed
        else:
            values = self.forward_value(state_feats)
        s_exp = torch.repeat_interleave(state_feats, actions_per_step, dim=0)
        phi = torch.cat([s_exp, action_feats], dim=-1)
        logits = self.forward_policy_logits(phi)
        return logits, values

    def forward_hole_aux(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        phi = torch.cat([state_feat, chosen_action_feat], dim=-1)
        return self.hole_aux_head(phi).squeeze(-1)

    def forward_clear_pred(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        phi = torch.cat([state_feat, chosen_action_feat], dim=-1)
        return self.clear_pred_head(phi)


class LightSharedPolicyValueNet(_AuxStubsMixin, nn.Module):
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
        fuse_in = width + action_embed_dim
        hid = max(width // 2, 32)
        self.hole_aux_head = nn.Sequential(
            nn.Linear(fuse_in, hid),
            nn.GELU(),
            nn.Linear(hid, 1),
        )
        self.clear_pred_head = nn.Sequential(
            nn.Linear(fuse_in, hid),
            nn.GELU(),
            nn.Linear(hid, 4),
        )

    def _encode_state(self, s: torch.Tensor) -> torch.Tensor:
        x = nn.functional.gelu(self.state_fc1(s))
        return nn.functional.gelu(self.state_fc2(x))

    def forward_trunk(self, s: torch.Tensor) -> torch.Tensor:
        """共享主干，供 CUDA 多卡 data_parallel。"""
        return self._encode_state(s)

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
        trunk_hidden: torch.Tensor | None = None,
    ) -> tuple[torch.Tensor, torch.Tensor]:
        """Fused: encode states once → values [K] + policy logits [total_actions].

        ``values_precomputed``：多卡并行价值头时传入，仍会在本设备上算 ``_encode_state`` 供策略支路使用。
        ``trunk_hidden``：多卡已对 ``forward_trunk`` 切分时传入，跳过重复编码。
        """
        if trunk_hidden is not None:
            h = trunk_hidden
        else:
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

    def forward_hole_aux(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        h = self._encode_state(state_feat)
        ae = nn.functional.gelu(self.action_proj(chosen_action_feat))
        x = torch.cat([h, ae], dim=-1)
        return self.hole_aux_head(x).squeeze(-1)

    def forward_clear_pred(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        h = self._encode_state(state_feat)
        ae = nn.functional.gelu(self.action_proj(chosen_action_feat))
        x = torch.cat([h, ae], dim=-1)
        return self.clear_pred_head(x)


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


class PolicyValueNet(_AuxStubsMixin, nn.Module):
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
        self.hole_aux_head = nn.Sequential(
            nn.Linear(PHI_DIM, width),
            nn.GELU(),
            nn.Linear(width, 1),
        )
        self.clear_pred_head = nn.Sequential(
            nn.Linear(PHI_DIM, width),
            nn.GELU(),
            nn.Linear(width, 4),
        )

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

    def forward_hole_aux(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        phi = torch.cat([state_feat, chosen_action_feat], dim=-1)
        return self.hole_aux_head(phi).squeeze(-1)

    def forward_clear_pred(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        phi = torch.cat([state_feat, chosen_action_feat], dim=-1)
        return self.clear_pred_head(phi)


class SharedPolicyValueNet(_AuxStubsMixin, nn.Module):
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
        hid = max(width // 2, 32)
        self.hole_aux_head = nn.Sequential(
            nn.Linear(fusion_in, hid),
            nn.GELU(),
            nn.Linear(hid, 1),
        )
        self.clear_pred_head = nn.Sequential(
            nn.Linear(fusion_in, hid),
            nn.GELU(),
            nn.Linear(hid, 4),
        )

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

    def forward_hole_aux(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        h = self._encode_state(state_feat)
        ae = self.action_proj(chosen_action_feat)
        x = torch.cat([h, ae], dim=-1)
        return self.hole_aux_head(x).squeeze(-1)

    def forward_clear_pred(self, state_feat: torch.Tensor, chosen_action_feat: torch.Tensor) -> torch.Tensor:
        h = self._encode_state(state_feat)
        ae = self.action_proj(chosen_action_feat)
        x = torch.cat([h, ae], dim=-1)
        return self.clear_pred_head(x)
