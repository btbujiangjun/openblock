"""出块预测模型封装 — SpawnPredictor（v8.1）

集成 SpawnTransformerV2，为 MCTS 随机展开提供出块分布先验，
减少因「当前确定性 dock」引发的乐观偏差。

核心功能
--------
1. **predict_next_shapes()**
   给定棋盘状态+上下文+历史，预测下一轮三槽各形状的概率分布。

2. **sample_dock_from_distribution()**
   从预测分布中采样一组三块形状（用于 MCTS 模拟时替换当前 dock）。

3. **expected_value()**
   对若干 dock 采样取平均 V(s)，提供期望值估计（减少偏差）。

4. **build_context_from_sim()**
   从 OpenBlockSimulator 提取 CONTEXT_DIM=24 维上下文特征（近似值，
   不含完整玩家画像；仅用 MCTS 估值，精度要求不高）。

使用方式
--------
    predictor = SpawnPredictor.load("rl_checkpoints/spawn_v2.pt", device)
    v_expected = predictor.expected_value(sim, policy_net, device, n_samples=4)

检查点路径优先级：
    1. 函数参数显式传入
    2. 环境变量 RL_SPAWN_MODEL_PATH
    3. 默认路径 rl_checkpoints/spawn_v2.pt（不存在则以随机权重退化）

若无可用检查点，SpawnPredictor 回退到「当前确定性 dock」策略（等同于不使用出块建模）。
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F

from .device import tensor_to_device
from .features import extract_state_features

_DEFAULT_CKPT = Path(__file__).resolve().parent.parent / "rl_checkpoints" / "spawn_v2.pt"


# ---------------------------------------------------------------------------
# 懒加载 spawn_model（避免循环导入）
# ---------------------------------------------------------------------------

def _load_spawn_model(device: torch.device):
    from .spawn_model.model import SpawnTransformerV2
    return SpawnTransformerV2().to(device)


def _get_shapes_data():
    """返回 shape_id → shape_data(list[list[int]]) 映射。"""
    from .shapes_data import get_all_shapes
    from .spawn_model.dataset import SHAPE_VOCAB
    all_shapes = get_all_shapes()
    shape_map = {s["id"]: s["data"] for s in all_shapes}
    return SHAPE_VOCAB, shape_map


# ---------------------------------------------------------------------------
# SpawnPredictor
# ---------------------------------------------------------------------------

class SpawnPredictor:
    """SpawnTransformerV2 推理封装，为 MCTS 提供随机出块评估。

    Attributes:
        model  : SpawnTransformerV2 实例
        device : 推理设备
        available: 是否已加载可用检查点（False=退化模式）
    """

    def __init__(self, model, device: torch.device, available: bool = True):
        self.model = model
        self.device = device
        self.available = available
        self._shape_vocab: list[str] | None = None
        self._shape_map: dict | None = None

    @classmethod
    def load(
        cls,
        checkpoint_path: str | Path | None = None,
        device: torch.device | None = None,
    ) -> "SpawnPredictor":
        """加载 SpawnTransformerV2 检查点，返回 SpawnPredictor 实例。

        Args:
            checkpoint_path: .pt 检查点路径；None=自动查找（环境变量→默认路径）
            device         : 推理设备；None=CPU
        """
        if device is None:
            device = torch.device("cpu")

        # 解析检查点路径
        if checkpoint_path is None:
            env_path = os.environ.get("RL_SPAWN_MODEL_PATH", "").strip()
            checkpoint_path = Path(env_path) if env_path else _DEFAULT_CKPT

        model = _load_spawn_model(device)

        if Path(checkpoint_path).is_file():
            try:
                state = torch.load(checkpoint_path, map_location=device, weights_only=False)
                # 兼容多种保存格式
                if isinstance(state, dict) and "model" in state:
                    state = state["model"]
                model.load_state_dict(state, strict=False)
                model.eval()
                print(f"[SpawnPredictor] 已加载检查点: {checkpoint_path}", flush=True)
                return cls(model, device, available=True)
            except Exception as e:
                print(f"[SpawnPredictor] 检查点加载失败 ({e})，退化为随机权重", flush=True)
        else:
            print(f"[SpawnPredictor] 未找到检查点 {checkpoint_path}，退化为确定性 dock 模式", flush=True)

        model.eval()
        return cls(model, device, available=False)

    # ------------------------------------------------------------------
    # 内部：lazy 加载形状词典
    # ------------------------------------------------------------------

    def _get_vocab_and_map(self):
        if self._shape_vocab is None:
            self._shape_vocab, self._shape_map = _get_shapes_data()
        return self._shape_vocab, self._shape_map

    # ------------------------------------------------------------------
    # 核心接口
    # ------------------------------------------------------------------

    def predict_next_shapes(
        self,
        board_np: np.ndarray,
        context_np: np.ndarray | None = None,
        history_ids: np.ndarray | None = None,
        target_difficulty: float = 0.5,
    ) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        """预测下一轮三槽形状的概率分布。

        Args:
            board_np        : (8, 8) float32 棋盘占用率（0/1）
            context_np      : (24,) float32 上下文特征；None 则全零
            history_ids     : (HISTORY_LEN, 3) int 历史形状 ID；None 则全 PAD
            target_difficulty: 目标难度 [0, 1]

        Returns:
            (probs_0, probs_1, probs_2): 各槽形状概率分布，shape=(NUM_SHAPES,)
        """
        from .spawn_model.dataset import NUM_SHAPES, CONTEXT_DIM, HISTORY_LEN

        board_t = torch.from_numpy(board_np).unsqueeze(0).float().to(self.device)  # (1,8,8)
        if context_np is None:
            context_np = np.zeros(CONTEXT_DIM, dtype=np.float32)
        ctx_t = torch.from_numpy(context_np).unsqueeze(0).float().to(self.device)  # (1,24)
        if history_ids is None:
            history_ids = np.full((HISTORY_LEN, 3), NUM_SHAPES, dtype=np.int64)
        hist_t = torch.from_numpy(history_ids).unsqueeze(0).long().to(self.device)  # (1,H,3)
        diff_t = torch.tensor([[target_difficulty]], dtype=torch.float32, device=self.device)

        with torch.no_grad():
            out = self.model(board_t, ctx_t, hist_t, target_difficulty=diff_t)
        logits = out["logits"]
        p0 = F.softmax(logits[0], dim=-1).squeeze(0).cpu().numpy()
        p1 = F.softmax(logits[1], dim=-1).squeeze(0).cpu().numpy()
        p2 = F.softmax(logits[2], dim=-1).squeeze(0).cpu().numpy()
        return p0, p1, p2

    def sample_shape_ids(
        self,
        board_np: np.ndarray,
        context_np: np.ndarray | None = None,
        history_ids: np.ndarray | None = None,
        target_difficulty: float = 0.5,
    ) -> tuple[int, int, int]:
        """从预测分布中采样一组 (shape_id_0, shape_id_1, shape_id_2)。"""
        p0, p1, p2 = self.predict_next_shapes(board_np, context_np, history_ids, target_difficulty)
        s0 = int(np.random.choice(len(p0), p=p0.astype(np.float64) / p0.sum()))
        s1 = int(np.random.choice(len(p1), p=p1.astype(np.float64) / p1.sum()))
        s2 = int(np.random.choice(len(p2), p=p2.astype(np.float64) / p2.sum()))
        return s0, s1, s2

    def expected_value(
        self,
        sim,
        policy_net,
        device: torch.device,
        n_samples: int = 3,
        target_difficulty: float = 0.5,
    ) -> float:
        """对若干 dock 采样估算 E[V(s)]，减少确定性 dock 的乐观偏差。

        流程：
        1. 从当前棋盘状态提取 board_np
        2. 对 n_samples 个 dock 采样，修改 sim 的 dock（用 save/restore 保护）
        3. 对每个 dock 状态计算 V(s)
        4. 返回均值

        若未加载可用检查点，退化为当前确定性 dock 的 V(s)。
        """
        if not self.available:
            s_np = extract_state_features(sim.grid, sim.dock)
            s_t = tensor_to_device(torch.from_numpy(s_np).unsqueeze(0), device)
            with torch.no_grad():
                return float(policy_net.forward_value(s_t).item())

        vocab, shape_map = self._get_vocab_and_map()
        board_np = _extract_board_np(sim)
        saved = sim.save_state()

        values = []
        for _ in range(n_samples):
            try:
                s0, s1, s2 = self.sample_shape_ids(board_np, target_difficulty=target_difficulty)
                # 用采样的形状替换 sim dock
                sampled_dock = _build_dock_from_ids([s0, s1, s2], vocab, shape_map)
                sim.restore_state(saved)
                _override_sim_dock(sim, sampled_dock)
                s_np = extract_state_features(sim.grid, sim.dock)
                s_t = tensor_to_device(torch.from_numpy(s_np).unsqueeze(0), device)
                with torch.no_grad():
                    v = float(policy_net.forward_value(s_t).item())
                values.append(v)
            except Exception:
                pass  # 采样失败时跳过该样本

        sim.restore_state(saved)
        if not values:
            s_np = extract_state_features(sim.grid, sim.dock)
            s_t = tensor_to_device(torch.from_numpy(s_np).unsqueeze(0), device)
            with torch.no_grad():
                return float(policy_net.forward_value(s_t).item())
        return float(np.mean(values))

    @staticmethod
    def build_context_from_sim(sim) -> np.ndarray:
        """从 simulator 提取近似 24 维上下文特征。

        注意：完整上下文需要玩家画像（历史对局数据），此处仅提取局内可观测信号。
        前 12 维填零（玩家画像），后 12 维编码局内状态。
        """
        from . import fast_grid as _fg
        gnp = _fg.grid_to_np(sim.grid)
        feats = _fg.fast_board_features(gnp)
        n = sim.grid.size
        fill_ratio = float(np.sum(gnp >= 0)) / max(n * n, 1)
        score_norm = float(getattr(sim, "score", 0)) / 220.0
        steps_norm = float(getattr(sim, "steps", 0)) / 100.0
        ctx = np.zeros(24, dtype=np.float32)
        # 后 12 维：局内可观测
        ctx[12] = fill_ratio
        ctx[13] = float(feats.get("holes", 0)) / 16.0
        ctx[14] = score_norm
        ctx[15] = steps_norm
        ctx[16] = float(feats.get("row_trans", 0)) / 64.0
        ctx[17] = float(feats.get("col_trans", 0)) / 64.0
        ctx[18] = float(feats.get("wells", 0)) / 24.0
        return ctx


# ---------------------------------------------------------------------------
# 辅助函数
# ---------------------------------------------------------------------------

def _extract_board_np(sim) -> np.ndarray:
    """从 simulator 提取 (8,8) float32 棋盘占用矩阵。"""
    from . import fast_grid as _fg
    gnp = _fg.grid_to_np(sim.grid)
    n = sim.grid.size
    out = np.zeros((8, 8), dtype=np.float32)
    m = min(n, 8)
    out[:m, :m] = (gnp[:m, :m] >= 0).astype(np.float32)
    return out


def _build_dock_from_ids(
    shape_ids: list[int],
    vocab: list[str],
    shape_map: dict,
) -> list[dict | None]:
    """将形状 ID 列表转换为 simulator dock 格式的列表。"""
    dock = []
    for sid in shape_ids:
        if sid < len(vocab):
            name = vocab[sid]
            data = shape_map.get(name)
            if data is not None:
                dock.append({"id": name, "data": data, "color": 0})
                continue
        dock.append(None)
    return dock


def _override_sim_dock(sim, new_dock: list) -> None:
    """就地替换 simulator 的 dock 列表（仅替换非 None 槽）。

    注意：此操作在 save/restore 保护下调用，不影响外部状态。
    """
    if hasattr(sim, "dock") and isinstance(sim.dock, list):
        for i, slot in enumerate(new_dock):
            if i < len(sim.dock):
                sim.dock[i] = slot
