"""
LoRA 适配器 — 用于个性化 fine-tune 与跨玩家迁移。

设计动机
--------
我们希望同一个 SpawnTransformer trunk 能服务**全体玩家**，同时保留**个体差异**。
若每个玩家都训练一个独立模型，参数量与维护成本无法接受；若所有玩家共用，
个性化丢失。

LoRA（Low-Rank Adaptation）提供了一个折中方案：

  - 冻结 trunk 参数（共享）
  - 在每个 Linear 层旁加一个低秩支路 W' = W + α/r · B·A
    其中 A:(r, in)、B:(out, r)、r=4~8（参数量极小）
  - 不同玩家 = 不同 (A, B)；切换玩家 = 加载小的 adapter checkpoint

优势
----
  - 参数量：r=4 时每个玩家 ~5K 额外参数（vs 全模型 200K）
  - 训练：冻结 90% 参数，只反向 LoRA → 速度快、抗遗忘
  - 推理：切换玩家无需重新加载主模型

实现
----
  - LoRALinear: nn.Module 包装 nn.Linear，可启停 LoRA 支路
  - inject_lora_into_model(): 遍历模型把 nn.Linear 替换为 LoRALinear
  - LoRAAdapter: 只 dump/load LoRA 参数的工具

使用模式
--------
    base = SpawnTransformerV3(...)
    base.load_state_dict(...)           # 全局 trunk
    inject_lora_into_model(base, r=4, alpha=8)
    freeze_non_lora(base)
    optim = torch.optim.AdamW(lora_parameters(base), lr=1e-3)
    # 在玩家 A 的小数据上 fine-tune
    save_lora(base, 'players/playerA.lora.pt')

    # 切换：
    load_lora(base, 'players/playerB.lora.pt')
"""

from __future__ import annotations

import math
from typing import Iterable

import torch
import torch.nn as nn


class LoRALinear(nn.Module):
    """nn.Linear + 低秩支路 ΔW = α/r · B·A。

    A: (r, in) 高斯初始化；B: (out, r) 零初始化（开始时 ΔW=0）。
    """

    def __init__(
        self,
        base: nn.Linear,
        r: int = 4,
        alpha: float = 8.0,
        dropout: float = 0.0,
    ):
        super().__init__()
        self.in_features = base.in_features
        self.out_features = base.out_features
        self.r = r
        self.alpha = alpha
        self.scaling = alpha / max(1, r)

        self.weight = base.weight
        self.bias = base.bias
        self.weight.requires_grad_(False)
        if self.bias is not None:
            self.bias.requires_grad_(False)

        self.lora_A = nn.Parameter(torch.zeros(r, self.in_features))
        self.lora_B = nn.Parameter(torch.zeros(self.out_features, r))
        nn.init.kaiming_uniform_(self.lora_A, a=math.sqrt(5))
        nn.init.zeros_(self.lora_B)

        self.lora_dropout = nn.Dropout(dropout) if dropout > 0 else nn.Identity()
        self.lora_enabled = True

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        out = nn.functional.linear(x, self.weight, self.bias)
        if not self.lora_enabled:
            return out
        delta = self.lora_dropout(x) @ self.lora_A.T @ self.lora_B.T
        return out + delta * self.scaling

    def extra_repr(self) -> str:
        return (f"in={self.in_features}, out={self.out_features}, "
                f"r={self.r}, alpha={self.alpha}, enabled={self.lora_enabled}")


def inject_lora_into_model(
    model: nn.Module,
    r: int = 4,
    alpha: float = 8.0,
    dropout: float = 0.0,
    target_substrings: Iterable[str] = ("head_", "diversity", "difficulty", "style"),
) -> int:
    """在模型中查找名字含 target_substrings 的 Linear 层，替换为 LoRALinear。

    默认只在「头部 Linear」插入 LoRA（保留 transformer encoder 不变），
    这是 LoRA 个性化的常见做法（trunk 提取通用表示，head 做个性化映射）。

    Returns:
        替换的层数
    """
    replaced = 0
    targets = list(target_substrings)
    for name, module in list(model.named_modules()):
        for child_name, child in list(module.named_children()):
            full_name = f"{name}.{child_name}" if name else child_name
            if not isinstance(child, nn.Linear):
                continue
            if any(t in full_name for t in targets):
                lora = LoRALinear(child, r=r, alpha=alpha, dropout=dropout)
                setattr(module, child_name, lora)
                replaced += 1
    return replaced


def freeze_non_lora(model: nn.Module) -> None:
    """冻结所有非 LoRA 参数。"""
    for name, p in model.named_parameters():
        if "lora_A" in name or "lora_B" in name:
            p.requires_grad_(True)
        else:
            p.requires_grad_(False)


def lora_parameters(model: nn.Module):
    """yield 所有 LoRA 参数（用于 optimizer）。"""
    for name, p in model.named_parameters():
        if "lora_A" in name or "lora_B" in name:
            if p.requires_grad:
                yield p


def lora_state_dict(model: nn.Module) -> dict:
    """提取所有 LoRA 参数为 state_dict（便于保存玩家专属 adapter）。"""
    out = {}
    for name, p in model.named_parameters():
        if "lora_A" in name or "lora_B" in name:
            out[name] = p.detach().cpu().clone()
    return out


def load_lora_state_dict(model: nn.Module, state: dict, strict: bool = True) -> int:
    """把 LoRA state_dict 加载回模型。

    Returns: 实际加载的张量数。
    """
    n = 0
    own = dict(model.named_parameters())
    for k, v in state.items():
        if k in own and ("lora_A" in k or "lora_B" in k):
            with torch.no_grad():
                own[k].copy_(v.to(own[k].device))
            n += 1
        elif strict:
            raise KeyError(f"LoRA key not in model: {k}")
    return n


def set_lora_enabled(model: nn.Module, enabled: bool) -> None:
    """开关所有 LoRA 支路（可用于 A/B 对比）。"""
    for m in model.modules():
        if isinstance(m, LoRALinear):
            m.lora_enabled = bool(enabled)


def count_lora_params(model: nn.Module) -> int:
    return sum(p.numel() for p in lora_parameters(model))
