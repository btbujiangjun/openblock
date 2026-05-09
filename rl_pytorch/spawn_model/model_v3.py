"""
SpawnTransformerV3 — 联合分布 + 风格化 + 可解性 + 个性化骨架。

相对 V2 的 5 大升级
-------------------
  U1. **Autoregressive joint decoding**：
      P(s0, s1, s2 | ctx) = P(s0|ctx) · P(s1|ctx, s0) · P(s2|ctx, s0, s1)
      → 解决 V2 三槽独立 head「联合分布建模弱」的痛点。

  U2. **Playstyle conditioning token**：
      用一个可学习 embedding(playstyle_id, d_model) 注入风格信息，
      推理时可控制（perfect_hunter / multi_clear / combo / survival / balanced）。

  U3. **Feasibility auxiliary head**：
      网络对每个 shape 预测「在当前 board 上是否可放」（28 维 sigmoid）。
      训练目标：BCE(feas_pred, feasibility_mask_GT) → 学到一个轻量
      feasibility predictor，在没有外部规则可调用的设备上做内嵌过滤。

  U4. **Soft feasibility mask in main loss**：
      P(infeasible) 加入主损失的负反馈 → 训练阶段把概率从不可放区拉走。

  U5. **LoRA-ready heads**：
      所有 head_0/1/2、style_head、feasibility_head 用 nn.Linear 命名，
      可被 lora.inject_lora_into_model() 自动识别。

输入输出
--------
forward(board, behavior_context, history, target_difficulty=None,
        playstyle_id=None, prev_shapes=None) -> dict
  - board:            (B, 8, 8) float
  - behavior_context: (B, 56)   float（V3.1 用户行为特征）
  - history:          (B, 3, 3) long（PAD=NUM_SHAPES）
  - target_difficulty:(B, 1)    float ∈ [0,1]
  - playstyle_id:     (B,)      long  ∈ [0, NUM_PLAYSTYLES) or None
  - prev_shapes:      (B, 0..2) long  当前已生成的槽位（用于 AR teacher forcing）

返回:
  {
    'logits':       (l0, l1, l2)         (B, NUM_SHAPES) — autoregressive
    'div_logits':   (B, 3, NUM_CATEGORIES)
    'diff_pred':    (B, 1)
    'feas_logits':  (B, NUM_SHAPES)      — sigmoid 后即 P(可放)
    'style_logits': (B, NUM_PLAYSTYLES)  — 推断玩家风格（自监督辅助）
    'intent_logits':(B, NUM_SPAWN_INTENTS) — 推断出块意图（自监督辅助）
  }

NUM_PLAYSTYLES = 5: balanced(0), perfect_hunter(1), multi_clear(2), combo(3), survival(4)

训练损失（详见 train_v3.py）
---------------------------
  L = L_shape + α·L_div + β·L_diff + γ·L_feas + δ·L_soft_infeas + ε·L_style + ζ·L_intent
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn

from .dataset import (
    NUM_SHAPES,
    NUM_CATEGORIES,
    GRID_SIZE,
    BEHAVIOR_CONTEXT_DIM,
    HISTORY_LEN,
)

PLAYSTYLE_VOCAB = ['balanced', 'perfect_hunter', 'multi_clear', 'combo', 'survival']
NUM_PLAYSTYLES = len(PLAYSTYLE_VOCAB)
PLAYSTYLE_TO_IDX = {s: i for i, s in enumerate(PLAYSTYLE_VOCAB)}
SPAWN_INTENT_VOCAB = ['relief', 'engage', 'harvest', 'pressure', 'flow', 'maintain']
NUM_SPAWN_INTENTS = len(SPAWN_INTENT_VOCAB)


class SpawnTransformerV3(nn.Module):
    """V3：联合 + 风格 + 可解性"""

    def __init__(
        self,
        d_model: int = 128,
        nhead: int = 4,
        num_layers: int = 2,
        dim_ff: int = 256,
        dropout: float = 0.1,
        num_playstyles: int = NUM_PLAYSTYLES,
    ):
        super().__init__()
        self.d_model = d_model
        self.num_playstyles = num_playstyles

        self.shape_embed = nn.Embedding(
            NUM_SHAPES + 1, d_model, padding_idx=NUM_SHAPES
        )
        self.playstyle_embed = nn.Embedding(num_playstyles, d_model)

        self.board_proj = nn.Sequential(
            nn.Linear(GRID_SIZE * GRID_SIZE + BEHAVIOR_CONTEXT_DIM, d_model),
            nn.GELU(),
            nn.LayerNorm(d_model),
        )
        self.difficulty_proj = nn.Sequential(
            nn.Linear(1, d_model),
            nn.GELU(),
            nn.LayerNorm(d_model),
        )

        self.history_pos = nn.Embedding(HISTORY_LEN * 3, d_model)
        self.cls_token = nn.Parameter(torch.randn(1, 1, d_model) * 0.02)
        self.style_pos = nn.Parameter(torch.randn(1, 1, d_model) * 0.02)

        self.slot_pos = nn.Embedding(3, d_model)
        self.slot_pad = nn.Parameter(torch.zeros(1, 1, d_model))

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=nhead,
            dim_feedforward=dim_ff,
            dropout=dropout,
            batch_first=True,
            activation='gelu',
        )
        self.encoder = nn.TransformerEncoder(encoder_layer, num_layers=num_layers)
        self.norm = nn.LayerNorm(d_model)

        self.head_0 = nn.Linear(d_model, NUM_SHAPES)
        self.head_1 = nn.Linear(d_model + d_model, NUM_SHAPES)
        self.head_2 = nn.Linear(d_model + 2 * d_model, NUM_SHAPES)

        self.diversity_head = nn.Linear(d_model, NUM_CATEGORIES * 3)
        self.difficulty_head = nn.Linear(d_model, 1)
        self.feasibility_head = nn.Linear(d_model, NUM_SHAPES)
        self.style_head = nn.Linear(d_model, num_playstyles)
        self.intent_head = nn.Linear(d_model, NUM_SPAWN_INTENTS)

    # ------------------------------------------------------------------
    # 编码：board / ctx / diff / history / style → token sequence
    # ------------------------------------------------------------------
    def _encode(
        self,
        board: torch.Tensor,
        behavior_context: torch.Tensor,
        history: torch.Tensor,
        target_difficulty: torch.Tensor | None,
        playstyle_id: torch.Tensor | None,
    ) -> torch.Tensor:
        B = board.size(0)
        device = board.device

        board_flat = board.view(B, -1)
        state = torch.cat([board_flat, behavior_context], dim=-1)
        state_token = self.board_proj(state).unsqueeze(1)

        if target_difficulty is None:
            target_difficulty = torch.full((B, 1), 0.5, device=device)
        diff_token = self.difficulty_proj(target_difficulty).unsqueeze(1)

        hist_flat = history.view(B, -1)
        hist_embed = self.shape_embed(hist_flat)
        positions = torch.arange(HISTORY_LEN * 3, device=device)
        hist_embed = hist_embed + self.history_pos(positions).unsqueeze(0)

        if playstyle_id is None:
            style_token = torch.zeros(B, 1, self.d_model, device=device)
        else:
            style_emb = self.playstyle_embed(playstyle_id).unsqueeze(1)
            style_token = style_emb + self.style_pos

        cls = self.cls_token.expand(B, -1, -1)

        tokens = torch.cat([cls, state_token, diff_token, style_token, hist_embed], dim=1)
        encoded = self.encoder(tokens)
        encoded = self.norm(encoded)
        return encoded

    # ------------------------------------------------------------------
    # 前向：训练 / 推理共享主路径
    # ------------------------------------------------------------------
    def forward(
        self,
        board: torch.Tensor,
        behavior_context: torch.Tensor,
        history: torch.Tensor,
        target_difficulty: torch.Tensor | None = None,
        playstyle_id: torch.Tensor | None = None,
        prev_shapes: torch.Tensor | None = None,
    ) -> dict:
        encoded = self._encode(board, behavior_context, history, target_difficulty, playstyle_id)
        B = board.size(0)
        cls_out = encoded[:, 0]

        prev_emb_list = self._slot_embeddings(B, prev_shapes, encoded.device)

        l0 = self.head_0(cls_out)
        l1 = self.head_1(torch.cat([cls_out, prev_emb_list[0]], dim=-1))
        l2 = self.head_2(torch.cat([cls_out, prev_emb_list[0], prev_emb_list[1]], dim=-1))

        div_logits = self.diversity_head(cls_out).view(B, 3, NUM_CATEGORIES)
        diff_pred = self.difficulty_head(cls_out)
        feas_logits = self.feasibility_head(cls_out)
        style_logits = self.style_head(cls_out)
        intent_logits = self.intent_head(cls_out)

        return {
            'logits': (l0, l1, l2),
            'div_logits': div_logits,
            'diff_pred': diff_pred,
            'feas_logits': feas_logits,
            'style_logits': style_logits,
            'intent_logits': intent_logits,
        }

    def _slot_embeddings(self, B: int, prev_shapes, device) -> list[torch.Tensor]:
        """把已生成的前 0..2 个 shape 转成 d_model 向量；未生成的槽用零向量。

        返回 list 长度 2（slot1 用 prev[0]；slot2 用 prev[0],prev[1]）。
        """
        zero = torch.zeros(B, self.d_model, device=device)
        slots = [zero, zero]

        if prev_shapes is None:
            return slots

        if isinstance(prev_shapes, (list, tuple)):
            pads = [s if s is not None else None for s in prev_shapes]
        else:
            t = prev_shapes
            if t.dim() == 1:
                t = t.unsqueeze(-1)
            pads = [t[:, i] if i < t.size(1) else None for i in range(2)]

        slot_pos_0 = self.slot_pos(torch.zeros(B, dtype=torch.long, device=device))
        slot_pos_1 = self.slot_pos(torch.ones(B, dtype=torch.long, device=device))
        slot_positions = [slot_pos_0, slot_pos_1]

        outputs = []
        for i in range(2):
            ids = pads[i] if i < len(pads) else None
            if ids is None:
                outputs.append(zero)
                continue
            emb = self.shape_embed(ids) + slot_positions[i]
            outputs.append(emb)
        return outputs

    # ------------------------------------------------------------------
    # 推理：autoregressive 采样（带可选 feasibility mask）
    # ------------------------------------------------------------------
    @torch.no_grad()
    def sample(
        self,
        board: torch.Tensor,
        behavior_context: torch.Tensor,
        history: torch.Tensor,
        *,
        target_difficulty: float | None = None,
        playstyle: str | int | None = None,
        feasibility_mask=None,
        temperature: float = 1.0,
        top_k: int = 8,
    ) -> list[int]:
        """
        Autoregressive 采样 3 个不重复的 shape id。

        Args:
            feasibility_mask: 可选 (NUM_SHAPES,) numpy/torch；1=可放，0=不可放。
                              0 的位置 logit 直接置 -1e4。
            playstyle: 'balanced'/'perfect_hunter'/... 或对应 int；None=balanced

        Returns: [s0, s1, s2]
        """
        self.eval()
        B = board.size(0)
        device = board.device

        ps_id = self._resolve_playstyle_tensor(playstyle, B, device)

        td = (
            torch.tensor([[float(target_difficulty)]] * B, device=device, dtype=torch.float32)
            if target_difficulty is not None
            else None
        )

        encoded = self._encode(board, behavior_context, history, td, ps_id)
        cls_out = encoded[:, 0]

        if feasibility_mask is not None:
            from .feasibility import apply_feasibility_mask_torch
        else:
            apply_feasibility_mask_torch = None  # type: ignore

        used = []
        zero = torch.zeros(B, self.d_model, device=device)

        l0 = self.head_0(cls_out)
        s0 = self._sample_slot(l0, used, feasibility_mask, temperature, top_k,
                               apply_feasibility_mask_torch)
        used.append(s0)

        s0_emb = self.shape_embed(torch.tensor([s0], device=device)) + self.slot_pos(torch.zeros(1, dtype=torch.long, device=device))
        l1 = self.head_1(torch.cat([cls_out, s0_emb], dim=-1))
        s1 = self._sample_slot(l1, used, feasibility_mask, temperature, top_k,
                               apply_feasibility_mask_torch)
        used.append(s1)

        s1_emb = self.shape_embed(torch.tensor([s1], device=device)) + self.slot_pos(torch.ones(1, dtype=torch.long, device=device))
        l2 = self.head_2(torch.cat([cls_out, s0_emb, s1_emb], dim=-1))
        s2 = self._sample_slot(l2, used, feasibility_mask, temperature, top_k,
                               apply_feasibility_mask_torch)

        return [s0, s1, s2]

    def _sample_slot(
        self,
        logits: torch.Tensor,
        used: list[int],
        feasibility_mask,
        temperature: float,
        top_k: int,
        apply_mask_fn,
    ) -> int:
        logits = logits.squeeze(0).clone()
        if feasibility_mask is not None and apply_mask_fn is not None:
            logits = apply_mask_fn(logits, feasibility_mask)
        for idx in used:
            logits[idx] -= 1e4
        logits = logits / max(temperature, 0.01)

        k = max(1, min(int(top_k), NUM_SHAPES))
        topk_vals, topk_idx = logits.topk(k)
        if torch.isinf(topk_vals.min()) or torch.isinf(topk_vals.max()):
            finite_mask = torch.isfinite(topk_vals)
            if not finite_mask.any():
                return int(topk_idx[0].item())
            topk_vals = topk_vals[finite_mask]
            topk_idx = topk_idx[finite_mask]
        probs = torch.softmax(topk_vals, dim=-1)
        choice = topk_idx[torch.multinomial(probs, 1).item()].item()
        return int(choice)

    def _resolve_playstyle_tensor(self, playstyle, B: int, device):
        if playstyle is None:
            return None
        if isinstance(playstyle, str):
            idx = PLAYSTYLE_TO_IDX.get(playstyle, 0)
        elif isinstance(playstyle, int):
            idx = playstyle
        elif isinstance(playstyle, torch.Tensor):
            return playstyle.to(device).long()
        else:
            idx = 0
        return torch.full((B,), idx, dtype=torch.long, device=device)

    def count_params(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)
