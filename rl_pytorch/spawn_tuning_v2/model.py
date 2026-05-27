"""
ResNet-MLP 模型 (L4) — 用于学习 (ctx, θ) → d_curve(20) + 辅助标签(4) 的映射。

架构 (~325K 参数):
  Input (41)
    └─ ctx_embedding (32):
       Embedding(difficulty, generator, bot_policy, pb_bin, lifecycle) → concat → 28
       + log10(pb_actual) z-score projected → 4
    └─ θ_normalized (9)  — 见 feature_io.THETA_KEYS

设计取舍演进:
  v2.0: 草案 14 维 (其中 9 维是装饰性参数, 游戏代码未读取)
  v2.1: 收缩到 5 维, 只保留 simulator/adaptiveSpawn 真正消费的参数
  v2.2: 把 adaptiveSpawn.js 里 PB 双 S 曲线 4 个硬编码常数提到 modelConfig
        (DEFAULT_SPAWN_PARAMS_PB_CURVE), 把它们加回 θ → 9 维 全部真实生效
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
from typing import Dict
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
# v2.10.34: 扩展类别数 — generator 2→4 (加 baseline, model-v3); bot 3→4 (加 rl-bot)
# 老 ckpt (N_GEN=2, N_BOT=3) 加载: 由 _load_state_dict_compat 把老 row 复制到新 emb 前 N 行
N_GENERATOR = 4
N_BOT_POLICY = 4
N_PB_BIN = 5
N_LIFECYCLE = 4
N_THETA = 9  # v2.2: 5 个个性化/选拔 + 4 个 PB 曲线参数; 见 feature_io.THETA_KEYS
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


class SpawnParamTunerResNet(nn.Module):
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
        input_dim = EMB_TOTAL + N_THETA  # 32 + 9 = 41

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
        # v2.10.32 (P2.2): r-head — 该 ctx 下 bot 实际能达到的 score/PB
        #   作用: 让 model 显式学到"PB 高时 r 触达上限低", 推理时可用作 r > r_max 区域 mask
        #   输出 (B,) ∈ [0, 2.0] (CURVE_R_MAX)
        self.head_r = self._build_head(hidden_dim, head_hidden, 1)

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

        所有输入形状: (B,) for 类别, (B,) for log_pb, (B, N_THETA) for theta_norm。
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
            # v2.10.32 (P2.2): r_pred ∈ [0, 2.0] (CURVE_R_MAX). 2.0 * sigmoid 钳制
            "r_value": (2.0 * torch.sigmoid(self.head_r(h))).squeeze(-1),  # (B,)
        }

    def count_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)

    @torch.no_grad()
    def predict_with_uncertainty(self, n_samples: int = 30, **forward_kwargs) -> Dict[str, torch.Tensor]:
        """v2.10.32 (P2.3) — MC Dropout uncertainty 估计.

        训练 dropout 默认 p=0.10, inference 时若不 model.eval() 而是 model.train(),
        每次 forward 会随机 dropout 不同子网 → N 次预测的均值 / 方差就是 Bayesian uncertainty。

        Args:
            n_samples: MC 采样次数 (默认 30, 标准做法)
            **forward_kwargs: 跟 forward() 一样的输入 (difficulty_idx, ...)

        Returns:
            dict 含 "curve_mean" / "curve_std" / "r_mean" / "r_std"
            其中 std 大的 bin / ctx 表示 model 自身不确定, 应在 UI 上用置信带显示
        """
        # 启用 dropout (forward 期间) 但不算梯度
        was_training = self.training
        # 只让 dropout 层在 training 模式 (其他 LayerNorm 等保持 eval 行为)
        for m in self.modules():
            if isinstance(m, nn.Dropout):
                m.train(True)
        try:
            curve_samples = []
            r_samples = []
            for _ in range(n_samples):
                out = self.forward(**forward_kwargs)
                curve_samples.append(out["curve"])
                r_samples.append(out["r_value"])
            curve_stack = torch.stack(curve_samples, dim=0)   # (n_samples, B, 20)
            r_stack = torch.stack(r_samples, dim=0)            # (n_samples, B)
            return {
                "curve_mean": curve_stack.mean(dim=0),
                "curve_std": curve_stack.std(dim=0),
                "r_mean": r_stack.mean(dim=0),
                "r_std": r_stack.std(dim=0),
                "n_samples": n_samples,
            }
        finally:
            if not was_training:
                # 恢复 eval 模式
                for m in self.modules():
                    if isinstance(m, nn.Dropout):
                        m.train(False)


def load_state_dict_compat(model: nn.Module, state_dict: Dict[str, torch.Tensor]) -> tuple[list, list]:
    """v2.10.34 — embedding 维度兼容加载.

    场景: 老 ckpt emb_gen.weight shape (2, D), 当前 model 期望 (4, D)
    → strict=True 会 RuntimeError; strict=False 会丢失整个 emb 学到的权重
    → 此函数把老 row 复制到新 emb 前 N_OLD 行, 后续 row 保持随机初始化 (新类别)

    覆盖 keys: emb_diff/emb_gen/emb_bot/emb_pb/emb_life 的 weight

    Returns: (missing_keys, unexpected_keys) — 跟 load_state_dict 一样
    """
    compat_sd = dict(state_dict)
    emb_keys = [
        "ctx_emb.emb_diff.weight", "ctx_emb.emb_gen.weight", "ctx_emb.emb_bot.weight",
        "ctx_emb.emb_pb.weight", "ctx_emb.emb_life.weight",
    ]
    for key in emb_keys:
        if key not in compat_sd:
            continue
        old_w = compat_sd[key]
        # 找当前 model 对应 param
        cur_param = model.state_dict().get(key)
        if cur_param is None:
            continue
        if old_w.shape == cur_param.shape:
            continue   # 形状一致直接用
        if old_w.dim() != 2 or cur_param.dim() != 2 or old_w.shape[1] != cur_param.shape[1]:
            # 不仅 row 数变, dim 也变 — 不安全, skip
            del compat_sd[key]
            continue
        # row 数 N_OLD < N_NEW: pad 后面新行用当前 model 的 random init
        if old_w.shape[0] < cur_param.shape[0]:
            new_w = cur_param.clone()
            new_w[:old_w.shape[0]] = old_w
            compat_sd[key] = new_w
        elif old_w.shape[0] > cur_param.shape[0]:
            # 老 ckpt 有更多类别 (理论不应该) — 截断
            compat_sd[key] = old_w[:cur_param.shape[0]]
    return model.load_state_dict(compat_sd, strict=False)


def build_default_model() -> SpawnParamTunerResNet:
    """构造默认配置的 ResNet-MLP (L4) 模型。"""
    return SpawnParamTunerResNet()


# ═════════════════════════════════════════════════════════════════════
# v2.9 — Transformer 模型 (与 ResNet-MLP 并存)
#
# 设计依据:
#   d_curve 的 20 个 bin 是 r 从 0 到 2.0 的**有序序列**。
#   ResNet-MLP 把它当 20 个独立标量预测, 难以学到 bin 之间的递增关系。
#   Transformer 用 self-attention 让 bin i 受 bin <i 影响, 天然适合序列建模。
#
# 架构:
#   ctx(32) + theta(N_THETA=9) → Linear(64) → context_vec (B, 64)
#   ↓ broadcast 到 20 个 bin
#   + position_embedding (20, 64) [位置编码]
#   ↓
#   token_seq (B, 20, 64)
#   ↓
#   [TransformerEncoder × 3 层, head=4, dim_feedforward=128, dropout=0.1]
#   ↓
#   Linear(64 → 1) per position → d_curve (B, 20)
#
#   5 个 head (curve / pb_broke / noMove / score / survival):
#     - curve head: 直接来自上面的 20 位置输出
#     - 其他 4 head: 用全局 mean pooling 后 Linear(64 → 1)
# ═════════════════════════════════════════════════════════════════════

DEFAULT_TRANSFORMER_DIM = 128
DEFAULT_TRANSFORMER_LAYERS = 4
DEFAULT_TRANSFORMER_HEADS = 4
DEFAULT_TRANSFORMER_FFN = 128


class SpawnParamTunerTransformer(nn.Module):
    """v2.9: Transformer-based 模型 — 把 d_curve 当 sequence 建模。

    ~200K 参数 (比 ResNet-MLP 325K 更小, 但更适合序列任务)。
    """

    def __init__(
        self,
        d_model: int = DEFAULT_TRANSFORMER_DIM,
        n_layers: int = DEFAULT_TRANSFORMER_LAYERS,
        n_heads: int = DEFAULT_TRANSFORMER_HEADS,
        ffn_dim: int = DEFAULT_TRANSFORMER_FFN,
        dropout: float = DEFAULT_DROPOUT,
        curve_bins: int = N_CURVE_BINS,
    ):
        super().__init__()
        self.d_model = d_model
        self.n_layers = n_layers
        self.curve_bins = curve_bins

        self.ctx_emb = ContextEmbedding()
        # 把 (ctx_emb + theta) 投影到 d_model
        self.condition_proj = nn.Linear(EMB_TOTAL + N_THETA, d_model)
        # 位置编码 (learnable, 20 维)
        self.pos_emb = nn.Parameter(torch.randn(curve_bins, d_model) * 0.01)

        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model, nhead=n_heads,
            dim_feedforward=ffn_dim, dropout=dropout,
            activation="gelu", batch_first=True, norm_first=True,
        )
        # v2.9.1: enable_nested_tensor=False 避免 norm_first=True 时的 UserWarning;
        # 我们也不需要 nested tensor 优化 (输入是固定 20-bin 序列, 无 padding)
        self.encoder = nn.TransformerEncoder(
            encoder_layer, num_layers=n_layers, enable_nested_tensor=False
        )
        self.out_norm = nn.LayerNorm(d_model)

        # curve head (per-position)
        self.head_curve = nn.Linear(d_model, 1)
        # 4 个全局 head (mean pooling 后)
        self.head_pb = nn.Linear(d_model, 1)
        self.head_noMove = nn.Linear(d_model, 1)
        self.head_score = nn.Linear(d_model, 1)
        self.head_survival = nn.Linear(d_model, 1)
        # v2.10.32 (P2.2): r-head — bot 实际能达到的 r = score/PB
        self.head_r = nn.Linear(d_model, 1)

    def encode(
        self,
        difficulty_idx, generator_idx, bot_idx, pb_bin_idx, lifecycle_idx,
        log_pb, theta_norm,
    ) -> torch.Tensor:
        """编码到 (B, n_bins, d_model)。"""
        ctx = self.ctx_emb(difficulty_idx, generator_idx, bot_idx, pb_bin_idx, lifecycle_idx, log_pb)
        cond = torch.cat([ctx, theta_norm], dim=-1)   # (B, 32 + N_THETA)
        cond = self.condition_proj(cond)               # (B, d_model)
        # broadcast 到 20 个 bin + 加位置编码
        tokens = cond.unsqueeze(1).expand(-1, self.curve_bins, -1)  # (B, 20, d_model)
        tokens = tokens + self.pos_emb.unsqueeze(0)                 # (B, 20, d_model)
        # Transformer encoder
        out = self.encoder(tokens)                                  # (B, 20, d_model)
        return self.out_norm(out)

    def forward(
        self,
        difficulty_idx, generator_idx, bot_idx, pb_bin_idx, lifecycle_idx,
        log_pb, theta_norm,
    ) -> dict:
        seq = self.encode(
            difficulty_idx, generator_idx, bot_idx, pb_bin_idx, lifecycle_idx,
            log_pb, theta_norm,
        )  # (B, 20, d_model)
        # curve: 每个 position 一个 sigmoid 标量
        curve = torch.sigmoid(self.head_curve(seq).squeeze(-1))     # (B, 20)
        # 4 个全局 head: mean pooling over positions
        pooled = seq.mean(dim=1)                                     # (B, d_model)
        return {
            "curve": curve,
            "pb_broke": torch.sigmoid(self.head_pb(pooled)).squeeze(-1),
            "noMove": torch.sigmoid(self.head_noMove(pooled)).squeeze(-1),
            "score": self.head_score(pooled).squeeze(-1),
            "survival": torch.sigmoid(self.head_survival(pooled)).squeeze(-1),
            # v2.10.32 (P2.2): r_pred ∈ [0, 2.0]
            "r_value": (2.0 * torch.sigmoid(self.head_r(pooled))).squeeze(-1),
        }

    def count_parameters(self) -> int:
        return sum(p.numel() for p in self.parameters() if p.requires_grad)


def build_model(model_type: str = "resnet", **kwargs) -> nn.Module:
    """v2.9 模型工厂 — 通过 model_type 字符串选择架构。

    支持:
      "resnet" / "mlp" / "resnet-mlp"  → SpawnParamTunerResNet (L4)
      "transformer"                    → SpawnParamTunerTransformer

    v2.10.9 G10: kwargs 透传给具体类构造函数:
      resnet:      hidden_dim, n_blocks
      transformer: d_model, n_layers, n_heads, ffn_dim
    """
    mt = (model_type or "resnet").lower().strip()
    if mt in ("resnet", "mlp", "resnet-mlp"):
        rn_kwargs = {k: v for k, v in kwargs.items() if k in ("hidden_dim", "n_blocks", "curve_bins", "dropout")}
        return SpawnParamTunerResNet(**rn_kwargs)
    if mt in ("transformer", "xformer", "tx"):
        tx_kwargs = {k: v for k, v in kwargs.items() if k in ("d_model", "n_layers", "n_heads", "ffn_dim", "curve_bins", "dropout")}
        return SpawnParamTunerTransformer(**tx_kwargs)
    raise ValueError(f"unknown model_type: {model_type!r} (支持: resnet, transformer)")
