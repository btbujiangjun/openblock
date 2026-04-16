"""
训练设备解析与 CPU→GPU 传输辅助。

支持后端：
  - **CUDA**（Linux/Windows 多卡；``cuda`` / ``cuda:0`` / ``cuda:1``）
  - **MPS**（macOS Apple Silicon）
  - **CPU**

``auto`` 策略：
  - **darwin**：MPS → CPU（通常无 CUDA）
  - **其它**：CUDA → MPS → CPU

多卡训练（CUDA）：
  - 环境变量 ``RL_CUDA_DEVICE_IDS``：``all`` / ``0,1`` / ``0``；与 ``resolve_cuda_device_ids_for_data_parallel()`` 配合，
    在 ``train.py`` 中对价值头使用 ``torch.nn.parallel.data_parallel``（可选，见 ``RL_CUDA_DP_VALUE``）。
  - 也可在启动前设置 ``CUDA_VISIBLE_DEVICES=0,1`` 限定可见卡。

CUDA 吞吐（可选环境变量）：
  - ``RL_CUDA_BENCHMARK=1`` — 启用 cudnn benchmark（输入尺寸固定时有利）
  - ``RL_CUDA_TF32`` — 默认等价开启 TF32 矩阵乘（设为 0 关闭）

M4 / MPS：
  - ``RL_TORCH_COMPILE`` / ``RL_MPS_SYNC`` 见仓库说明

**CPU 训练**（见 ``apply_cpu_training_tuning``）：

  - 在任意 ``import torch`` 之前导入 ``rl_pytorch.torch_env``，默认
    ``TORCH_NNPACK_ENABLED=0``，消除不支持 NNPACK 硬件时的 ``[W... NNPACK.cpp]`` 告警。
  - ``RL_CPU_NUM_THREADS`` — PyTorch intra-op 线程数；未设则使用 ``cpu_count()``。
  - ``RL_CPU_INTEROP_THREADS`` — inter-op 并行度；未设则 ``min(4, max(1, n//4))``。
  - ``RL_CPU_DISABLE_MKLDNN`` — 设为 ``1``（默认）时在 CPU 上关闭 oneDNN/MKLDNN 卷积后端。
    部分虚拟机/旧 CPU 上否则会 ``RuntimeError: could not create a primitive``（Conv2d）；设为 ``0`` 可恢复加速。
  - ``RL_CPU_DATALOADER_WORKERS`` — 仅 spawn 模型训练 DataLoader：未设时 Linux/Windows 在 CPU 上默认
    ``min(4, cpu_count-1)``；macOS 默认 ``0``（避免部分环境多进程反慢）；可显式设为 ``2`` 等。

若某算子在 MPS 上未实现，可设置 ``PYTORCH_ENABLE_MPS_FALLBACK=1``。
"""

from __future__ import annotations

import os
import re
import sys
import warnings

_mps_throughput_applied = False


def resolve_training_device(preference: str = "auto"):
    """
    :param preference:
        ``auto`` | ``cpu`` | ``mps`` | ``cuda`` | ``cuda:0`` | ``cuda:1`` | …
    """
    import torch

    pref = (preference or "auto").strip().lower()

    # cuda:N
    m = re.match(r"^cuda\s*:\s*(\d+)\s*$", pref)
    if m:
        if not torch.cuda.is_available():
            warnings.warn("CUDA 不可用，回退 CPU", stacklevel=2)
            return torch.device("cpu")
        idx = int(m.group(1))
        if idx < 0 or idx >= torch.cuda.device_count():
            warnings.warn(
                f"cuda:{idx} 无效（当前 device_count={torch.cuda.device_count()}），使用 cuda:0",
                stacklevel=2,
            )
            idx = 0
        return torch.device(f"cuda:{idx}")

    if pref == "auto":
        if sys.platform == "darwin":
            mps_b = getattr(torch.backends, "mps", None)
            if mps_b is not None and mps_b.is_available():
                return torch.device("mps")
            return torch.device("cpu")
        if torch.cuda.is_available():
            return torch.device("cuda:0")
        mps_b = getattr(torch.backends, "mps", None)
        if mps_b is not None and mps_b.is_available():
            return torch.device("mps")
        return torch.device("cpu")
    if pref == "cuda":
        if not torch.cuda.is_available():
            warnings.warn("CUDA 不可用，使用 CPU", stacklevel=2)
            return torch.device("cpu")
        return torch.device("cuda:0")
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


def cuda_device_indices_available() -> list[int]:
    """当前进程可见的 CUDA 设备下标列表（受 CUDA_VISIBLE_DEVICES 影响）。"""
    import torch

    if not torch.cuda.is_available():
        return []
    return list(range(torch.cuda.device_count()))


def resolve_cuda_device_ids_for_data_parallel() -> list[int]:
    """
    用于 ``torch.nn.parallel.data_parallel`` 的 device_ids（从 0 起的相对下标）。

    环境变量 ``RL_CUDA_DEVICE_IDS``：
      - 未设置或空：``[0]``
      - ``all`` / ``*``：全部可见卡
      - ``0,1``：指定下标（相对当前可见设备集合）
    """
    import torch

    raw = os.environ.get("RL_CUDA_DEVICE_IDS", "").strip().lower()
    n = torch.cuda.device_count()
    if n <= 0:
        return []
    if not raw:
        return [0]
    if raw in ("all", "*"):
        return list(range(n))
    out: list[int] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        if not part.isdigit():
            continue
        i = int(part)
        if 0 <= i < n:
            out.append(i)
    return out if out else [0]


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


def apply_cpu_training_tuning(device) -> None:
    """
    在 **CPU** 设备上优化训练吞吐：线程数、matmul 精度；须在 ``import torch`` 之后、首轮大计算前调用一次。

    NNPACK 告警由 ``torch_env`` 在 import torch **之前** 设置 ``TORCH_NNPACK_ENABLED`` 处理。
    """
    import torch

    if getattr(device, "type", None) != "cpu":
        return

    try:
        n = int(os.environ.get("RL_CPU_NUM_THREADS", "0") or "0")
        if n <= 0:
            import multiprocessing as mp

            n = max(1, mp.cpu_count() or 1)
        torch.set_num_threads(n)
    except Exception:
        pass

    try:
        raw_i = os.environ.get("RL_CPU_INTEROP_THREADS", "").strip()
        if raw_i.isdigit():
            k = max(1, int(raw_i))
        else:
            nthr = torch.get_num_threads()
            k = max(1, min(4, max(1, nthr // 4)))
        if hasattr(torch, "set_num_interop_threads"):
            torch.set_num_interop_threads(k)
    except RuntimeError:
        # 已初始化过或仅能设一次
        pass
    except Exception:
        pass

    try:
        torch.set_float32_matmul_precision("high")
    except Exception:
        pass

    # 部分构建上可显式关闭 NNPACK 后端（env 已在 torch_env 中设置；此处为兜底）
    try:
        nnpack = getattr(torch.backends, "nnpack", None)
        if nnpack is not None and hasattr(nnpack, "enabled"):
            if os.environ.get("TORCH_NNPACK_ENABLED", "0").lower() in ("0", "false", "no"):
                nnpack.enabled = False  # type: ignore[misc]
    except Exception:
        pass

    # oneDNN/MKLDNN：部分 CPU/容器上会报 could not create a primitive（Conv2d）；默认关闭，需加速时设 RL_CPU_DISABLE_MKLDNN=0
    try:
        if os.environ.get("RL_CPU_DISABLE_MKLDNN", "1").lower() not in ("0", "false", "no"):
            mkldnn = getattr(torch.backends, "mkldnn", None)
            if mkldnn is not None and hasattr(mkldnn, "enabled"):
                mkldnn.enabled = False  # type: ignore[misc]
    except Exception:
        pass


def apply_throughput_tuning(device) -> None:
    """
    在首次 GPU 计算前调用一次。

    - **MPS**：``torch.set_float32_matmul_precision('high')``
    - **CUDA**：可选 cudnn benchmark、TF32（见模块文档字符串）
    """
    import torch

    dev_type = getattr(device, "type", None)
    if dev_type == "mps":
        global _mps_throughput_applied
        if _mps_throughput_applied:
            return
        try:
            torch.set_float32_matmul_precision("high")
        except Exception:
            pass
        _mps_throughput_applied = True
        return

    if dev_type == "cuda":
        if os.environ.get("RL_CUDA_BENCHMARK", "").lower() in ("1", "true", "yes"):
            torch.backends.cudnn.benchmark = True
        tf32_on = os.environ.get("RL_CUDA_TF32", "1").lower() not in ("0", "false", "no")
        try:
            torch.backends.cuda.matmul.allow_tf32 = tf32_on
            torch.backends.cudnn.allow_tf32 = tf32_on
        except Exception:
            pass
        return


def device_summary_line(device) -> str:
    """一行可打印的设备与 CUDA 卡信息（用于训练日志）。"""
    import torch

    d = getattr(device, "type", "?")
    if d != "cuda":
        return f"device={device}"
    idx = device.index if device.index is not None else 0
    name = ""
    try:
        name = torch.cuda.get_device_name(idx)
    except Exception:
        name = "?"
    n = torch.cuda.device_count()
    return f"device={device}  ({name})  |  可见 CUDA 卡数: {n}"


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
