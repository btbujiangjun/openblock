"""
SpawnTransformerV2: 条件式生成推荐模型（v2）

相较 v1 的改进:
  1. 上下文维度 12 → 24（完整能力画像 + 自适应信号）
  2. 目标难度条件嵌入（target_difficulty token）使推理时可控制压力水平
  3. 多样性辅助头（diversity head）预测品类分布，与主损失联合训练
  4. 分数膨胀控制头（anti-inflate head）预测难度/易消程度

Architecture:
  board(64) + context(24) → project(d_model)  [state token]
  difficulty(1) → embed(d_model)              [difficulty token]
  history(9) → embed + positional → d_model   [history tokens]
  concat [CLS, state, diff, history] → Transformer encoder
  CLS → 3 shape heads + 1 diversity head + 1 difficulty regressor
"""

import torch
import torch.nn as nn
import math
from .dataset import NUM_SHAPES, NUM_CATEGORIES, GRID_SIZE, CONTEXT_DIM, HISTORY_LEN


class SpawnTransformerV2(nn.Module):
    def __init__(self, d_model=128, nhead=4, num_layers=2, dim_ff=256, dropout=0.1):
        super().__init__()
        self.d_model = d_model

        self.shape_embed = nn.Embedding(NUM_SHAPES + 1, d_model, padding_idx=NUM_SHAPES)

        self.board_proj = nn.Sequential(
            nn.Linear(GRID_SIZE * GRID_SIZE + CONTEXT_DIM, d_model),
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
        self.head_1 = nn.Linear(d_model, NUM_SHAPES)
        self.head_2 = nn.Linear(d_model, NUM_SHAPES)

        self.diversity_head = nn.Linear(d_model, NUM_CATEGORIES * 3)
        self.difficulty_head = nn.Linear(d_model, 1)

    def forward(self, board, context, history, target_difficulty=None):
        """
        board:             (B, 8, 8) float
        context:           (B, 24) float
        history:           (B, 3, 3) long
        target_difficulty: (B, 1) float, 0~1. None → use 0.5 (neutral)
        Returns: dict with keys:
          logits: (logits_0, logits_1, logits_2)
          div_logits: (B, 3, NUM_CATEGORIES)
          diff_pred: (B, 1)
        """
        B = board.size(0)
        device = board.device

        board_flat = board.view(B, -1)
        state = torch.cat([board_flat, context], dim=-1)
        state_token = self.board_proj(state).unsqueeze(1)

        if target_difficulty is None:
            target_difficulty = torch.full((B, 1), 0.5, device=device)
        diff_token = self.difficulty_proj(target_difficulty).unsqueeze(1)

        hist_flat = history.view(B, -1)
        hist_embed = self.shape_embed(hist_flat)
        positions = torch.arange(HISTORY_LEN * 3, device=device)
        hist_embed = hist_embed + self.history_pos(positions).unsqueeze(0)

        cls = self.cls_token.expand(B, -1, -1)

        tokens = torch.cat([cls, state_token, diff_token, hist_embed], dim=1)

        encoded = self.encoder(tokens)
        encoded = self.norm(encoded)
        cls_out = encoded[:, 0]

        l0 = self.head_0(cls_out)
        l1 = self.head_1(cls_out)
        l2 = self.head_2(cls_out)

        div_logits = self.diversity_head(cls_out).view(B, 3, NUM_CATEGORIES)
        diff_pred = self.difficulty_head(cls_out)

        return {
            'logits': (l0, l1, l2),
            'div_logits': div_logits,
            'diff_pred': diff_pred,
        }

    def predict(self, board, context, history,
                target_difficulty=None, temperature=1.0, top_k=8):
        """
        Inference: sample 3 shapes with difficulty-conditioned generation.
        target_difficulty: float 0~1 (0=easy, 1=hard). None → auto (0.5).
        """
        self.eval()
        with torch.no_grad():
            if target_difficulty is not None:
                td = torch.tensor([[target_difficulty]], dtype=torch.float32,
                                  device=board.device)
            else:
                td = None

            out = self.forward(board, context, history, td)
            l0, l1, l2 = out['logits']

        results = []
        used = set()
        for logits in [l0, l1, l2]:
            logits = logits.squeeze(0) / max(temperature, 0.01)
            for idx in used:
                logits[idx] -= 10.0

            topk_vals, topk_idx = logits.topk(min(top_k, NUM_SHAPES))
            probs = torch.softmax(topk_vals, dim=-1)
            chosen = topk_idx[torch.multinomial(probs, 1).item()].item()
            results.append(chosen)
            used.add(chosen)

        return results

    def count_params(self):
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


# Backward-compatible alias
SpawnTransformer = SpawnTransformerV2
