"""
训练设备解析与 CPU→Apple GPU 传输辅助。

在 **macOS** 上，`auto` 优先使用 **MPS**（Metal），便于 Apple Silicon 上高效训练；
Linux/Windows 上 `auto` 顺序为 CUDA → MPS → CPU。

若某算子在 MPS 上未实现，可设置环境变量 ``PYTORCH_ENABLE_MPS_FALLBACK=1`` 自动回退 CPU。

M4 / MPS 吞吐相关环境变量（见仓库根目录 ``.env.example``）：
  ``RL_TORCH_COMPILE`` — 设为 1 时对 ``PolicyValueNet`` 尝试 ``torch.compile``（首局可能较慢）
  ``RL_MPS_SYNC`` — 仅多线程 Flask 下必要时设为 1；单进程训练保持 0 以减少同步开销
"""

from __future__ import annotations

import os
import sys
import warnings

_mps_throughput_applied = False


def resolve_training_device(preference: str = "auto"):
    """
    :param preference: ``auto`` | ``mps`` | ``cuda`` | ``cpu``
    """
    import torch

    pref = (preference or "auto").lower().strip()
    if pref == "auto":
        # Apple：通常无 CUDA，优先 MPS 可少一次无效检测并直达 GPU
        if sys.platform == "darwin":
            mps_b = getattr(torch.backends, "mps", None)
            if mps_b is not None and mps_b.is_available():
                return torch.device("mps")
            return torch.device("cpu")
        if torch.cuda.is_available():
            return torch.device("cuda")
        mps_b = getattr(torch.backends, "mps", None)
        if mps_b is not None and mps_b.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    if pref == "cuda":
        if not torch.cuda.is_available():
            warnings.warn("CUDA 不可用，使用 CPU", stacklevel=2)
            return torch.device("cpu")
        return torch.device("cuda")
    if pref == "mps":
        mps_b = getattr(torch.backends, "mps", None)
        if mps_b is None or not mps_b.is_available():
            warnings.warn("MPS 不可用（需 Apple Silicon 与新版 PyTorch），使用 CPU", stacklevel=2)
            return torch.device("cpu")
        return torch.device("mps")
    if pref == "cpu":
        return torch.device("cpu")
    warnings.warn(f"未知 device={preference!r}，使用 CPU", stacklevel=2)
    return torch.device("cpu")


def tensor_to_device(tensor, device, non_blocking: bool | None = None):
    """将 CPU tensor 拷到 device；对 MPS/CUDA 默认 ``non_blocking=True`` 以重叠 H2D。"""
    import torch

    if non_blocking is None:
        non_blocking = device.type in ("mps", "cuda") and tensor.device.type == "cpu"
    return tensor.to(device, non_blocking=non_blocking)


def maybe_mps_synchronize(device) -> None:
    """训练步后可选同步，避免 MPS 异步执行导致下一请求读到未完成状态（多线程服务时更稳）。"""
    import torch

    if device.type != "mps":
        return
    mps_b = getattr(torch.backends, "mps", None)
    if mps_b is not None and mps_b.is_available():
        torch.mps.synchronize()


def apply_throughput_tuning(device) -> None:
    """
    单机 **MPS**（Apple Silicon，含 M4）训练吞吐：在首处 ``import torch`` 之后、首次 GPU 计算前调用一次即可。

    - ``torch.set_float32_matmul_precision('high')``：允许更快 FP32 矩阵乘实现（略损数值冗余，RL 通常可接受）。
    """
    import torch

    if getattr(device, "type", None) != "mps":
        return
    try:
        torch.set_float32_matmul_precision("high")
    except Exception:
        pass


def adam_for_training(params, lr: float, **kwargs):
    """
    Adam，优先 ``foreach=True``（PyTorch 2+ 在 MPS/CUDA 上常减少 Python 循环开销）。
    不支持时回退默认构造。
    """
    import torch

    try:
        return torch.optim.Adam(params, lr=lr, foreach=True, **kwargs)
    except TypeError:
        return torch.optim.Adam(params, lr=lr, **kwargs)
