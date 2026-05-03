# Web / 微信小程序同步契约

> 降低双端并行维护成本：**规则数据单一来源**、**会话与归因字段一致**、**埋点字典一致**。

## 必须对齐

| 项 | 权威位置 | 说明 |
|----|----------|------|
| 方块与规则 | `shared/game_rules.json`、`shared/shapes.json` | 构建或脚本拷贝到 `miniprogram` |
| 会话归因字段 | `sessions.attribution` JSON | Web：`channelAttribution` → `getSessionAttributionSnapshot`；小程序：启动参数/onLaunch 写入同等键名 |
| IAP/广告占位 | 后端 `/api/payment/verify`、`/api/enterprise/ad-impression` | 小程序使用各自 SDK，请求体字段保持一致 |

## 建议自动化

- CI 中校验：`shared/game_rules.json` 与小程序副本 hash 一致（见仓库脚本扩展位）。  
- 黄金事件：`docs/engineering/GOLDEN_EVENTS.md` 与小程序埋点名定期 diff。

## 已知差异处理

- 小程序无浏览器 UTM：使用场景值、`query` 中的自定义参数映射到 `utm_source` / `utm_campaign`。
