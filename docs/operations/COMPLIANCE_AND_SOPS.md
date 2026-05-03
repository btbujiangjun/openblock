# 合规与运维 SOP（摘要）

> 非法律意见；上线前应交由法务审核。**删除用户**操作不可逆，需二次确认。

## 隐私与同意

- 首次加载可通过自有 CMP / 横幅收集同意主题（分析、广告个性化等）。  
- 调用 `POST /api/compliance/consent`，body：`{ "user_id": "...", "consents": { "analytics": true, "ads": false } }`。  
- 日志中对 `user_id`、订单号采用掩码（见下方）。

## 数据主体请求（导出 / 删除）

| 操作 | API | headers |
|------|-----|---------|
| 导出 | `GET /api/compliance/export-user?user_id=` | `X-Ops-Token` |
| 删除 | `POST /api/compliance/delete-user` JSON `{ user_id }` | `X-Ops-Token` |

删除范围当前包含：`behaviors`、`scores`、`sessions`、`user_consents`、`user_stats`（可按法务要求扩展 achievements 等）。

## 备份与恢复（SQLite）

1. 停写或低峰执行：`cp openblock.db openblock-$(date +%Y%m%d).bak`  
2. WAL 模式建议同时备份 `-wal` / `-shm` 或执行 `PRAGMA wal_checkpoint(FULL)` 后备份单文件。  
3. 恢复：替换 db 文件后重启进程。

## 事故回滚（策略 / 玩法）

1. 设置 `OPENBLOCK_ACTIVE_STRATEGY_VERSION` 与已知稳定版本 id（标注用）。  
2. RL：切换 `RL_CHECKPOINT_SAVE` 指向旧 checkpoint 并重启服务。  
3. 远程配置：`OPENBLOCK_REMOTE_CONFIG_JSON` 紧急覆盖广告频控等开关。

## 未成年人与付费

- 上架渠道（苹果、微信等）的年龄分级与付费限制需在产品层单独实现；本仓库提供后端订单审计占位。
