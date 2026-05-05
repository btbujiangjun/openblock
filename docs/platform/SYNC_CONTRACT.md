# Web / 微信小程序同步契约

> 降低双端并行维护成本：**规则数据单一来源**、**会话与归因字段一致**、**埋点字典一致**。

## 必须对齐

| 项 | 权威位置 | 说明 |
|----|----------|------|
| 方块与规则 | `shared/game_rules.json`、`shared/shapes.json` | 小程序运行时使用 `core/gameRulesData.js`、`core/shapesData.js`，由同步脚本生成 CommonJS 数据模块，不直接携带 JSON |
| 小程序出块体验 | `web/src/bot/blockSpawn.js`、`miniprogram/utils/spawnHeuristic.js` | 小程序保留本地离线启发式出块与可玩性 guard；模型推理和训练不进入小程序包 |
| 皮肤与水印 | `web/src/skins.js`、`miniprogram/core/skins.js` | 小程序保留 34 套皮肤、主题 icon、水印配置，并叠加手机端白色盘面与对比度优化 |
| 皮肤名 i18n | `web/src/i18n/locales/*`、`miniprogram/core/i18n.js` | 小程序目前支持 `zh-CN` / `en`，皮肤名随语言切换刷新 |
| 会话归因字段 | `sessions.attribution` JSON | Web：`channelAttribution` → `getSessionAttributionSnapshot`；小程序：启动参数/onLaunch 写入同等键名 |
| IAP/广告占位 | 后端 `/api/payment/verify`、`/api/enterprise/ad-impression` | 小程序使用各自 SDK，请求体字段保持一致 |

## 建议自动化

- CI 中校验：`shared/game_rules.json` / `shared/shapes.json` 与小程序生成数据模块语义一致（见仓库脚本扩展位）。  
- 黄金事件：`docs/engineering/GOLDEN_EVENTS.md` 与小程序埋点名定期 diff。

## 已知差异处理

- 小程序无浏览器 UTM：使用场景值、`query` 中的自定义参数映射到 `utm_source` / `utm_campaign`。
- 小程序不包含 RL 训练、模型状态、后端同步和商业化运营看板；只保留本地离线核心对局体验。
- 小程序不直接上传 `core/game_rules.json`、`core/shapes.json` 或 `package.json`，以减少微信开发工具的 JSON 模块兼容和“无依赖文件”提示。
