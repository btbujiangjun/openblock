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


_bootstrap()
