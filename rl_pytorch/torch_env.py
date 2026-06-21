"""
在首次 ``import torch`` 之前执行（须先于 ``import torch`` 导入本模块）。

- 默认 ``TORCH_NNPACK_ENABLED=0``，避免在部分 CPU（无 NNPACK 所需指令集等）上反复出现::

    [W... NNPACK.cpp:56] Could not initialize NNPACK! Reason: Unsupported hardware.

  若确需 NNPACK，可在环境中显式设置 ``TORCH_NNPACK_ENABLED=1`` 后再启动 Python。

本模块无副作用依赖，可被 ``server.py``、``train.py`` 等安全地最先 import。
"""

from __future__ import annotations

import os


def _bootstrap() -> None:
    # 未显式配置时默认关闭 NNPACK（与 ATen 内 NNPACK 路径一致）
    if "TORCH_NNPACK_ENABLED" not in os.environ:
        os.environ["TORCH_NNPACK_ENABLED"] = "0"

    # 默认关闭 oneDNN/MKLDNN：部分虚拟机/旧 CPU 上 Conv2d 会报
    # RuntimeError: could not create a primitive；设 RL_CPU_DISABLE_MKLDNN=0 可恢复加速
    if os.environ.get("RL_CPU_DISABLE_MKLDNN", "1").lower() not in ("0", "false", "no"):
        os.environ.setdefault("DNNL_DEFAULT_FPMATH_MODE", "strict")
        os.environ.setdefault("MKLDNN_VERBOSE", "0")

    # ── MPS（Apple Silicon）显存水位防护：必须在 import torch 之前生效 ──
    # 真凶溯源：vmmap 显示训练 4 分钟内 owned unmapped (graphics) 达 15.3GB，
    # 这是 PyTorch MPS allocator 持有的 MTLBuffer 物理页面，靠 torch.mps.empty_cache()
    # 完全释放不回操作系统（只回 PyTorch 内部池）。无水位限制时长跑会撑爆 48GB Mac
    # 触发 jetsam SIGKILL（即 06-21 11:19 那次 OOM 的根因）。
    # 关键点：环境变量名是 PYTORCH_MPS_HIGH_WATERMARK_RATIO（带 PYTORCH_ 前缀），
    # 项目历史上用 RL_MPS_HIGH_WATERMARK_RATIO 这个自定义名，PyTorch 根本读不到→等于没设。
    #
    # 取值语义（PyTorch MPS allocator）：
    #   HIGH_WATERMARK_RATIO=0.0  无上限（默认；危险）
    #   HIGH_WATERMARK_RATIO=R    分配触顶 R*recommendedMaxWorkingSetSize 时拒绝
    #   LOW_WATERMARK_RATIO=R     <R 时不主动 trim；>R 时尝试归还给 driver
    # 在 48GB 统一内存 Mac 上：经 L1/L2/L4/L5/L8/L11 治根（commit 2c0fa76）后
    # 实测 mps_driver_gb max=0.55GB / mean=0.25GB（远低于历史 15-25GB 假象），
    # 0.55 水位（上限 26GB）完全用不上，反而限制了未来 batch 扩展空间。
    # 0.75（上限 36GB）给 batch_episodes 调大或 mcts_sims 扩展留余量；
    # 真泄漏已根除，水位放宽不会触发 jetsam（unified memory 不再倒灌）。
    _hw = os.environ.get("PYTORCH_MPS_HIGH_WATERMARK_RATIO")
    if _hw is None:
        os.environ["PYTORCH_MPS_HIGH_WATERMARK_RATIO"] = "0.75"
    _lw = os.environ.get("PYTORCH_MPS_LOW_WATERMARK_RATIO")
    if _lw is None:
        os.environ["PYTORCH_MPS_LOW_WATERMARK_RATIO"] = "0.5"


_bootstrap()
