"""OpenBlock Flask backend 业务模块集合。

此包内的模块由根目录 `server.py` 在启动时按需 import：

  - `enterprise_extensions`  企业扩展（IAP 占位、远程配置、合规）
  - `rl_backend`             RL 推理 / 在线训练路由 (/api/rl/*)
  - `spawn_tuning_v2_backend`  Spawn Tuning v2 蓝图 (/api/spawn-tuning-v2/*)
  - `monetization_backend`   商业化路由 (/api/mon/*)

迁移历史：
  v1.51.0 之前这些模块平铺在仓库根目录；2026-05 将其归位到 `backend/`
  以收敛根目录文件数。模块文件名未改，仅导入路径前加 `backend.`。
"""
