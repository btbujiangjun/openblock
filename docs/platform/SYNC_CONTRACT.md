# Web / 微信小程序 / Android / iOS 同步契约

> 降低四端并行维护成本：**规则数据单一来源**、**Web 构建产物复用**、**会话与归因字段一致**、**埋点字典一致**。

## 端形态

| 端 | 运行形态 | 核心逻辑来源 |
|----|----------|--------------|
| Web | Vite 静态前端 + Canvas | `web/src` + `shared` |
| Android | `mobile/android` Capacitor WebView 壳 | 打包后的 `dist`，由 `web/src` 构建 |
| iOS | `mobile/ios` Capacitor WKWebView 壳 | 打包后的 `dist`，由 `web/src` 构建 |
| 微信小程序 | `miniprogram` 轻量包 | `shared` 数据 + `scripts/sync-core.sh` 生成的 `miniprogram/core` 模块 |

## 必须对齐

| 项 | 权威位置 | 说明 |
|----|----------|------|
| 方块与规则 | `shared/game_rules.json`、`shared/shapes.json` | Web/Android/iOS 通过 Vite 打包读取；小程序运行时使用 `core/gameRulesData.js`、`core/shapesData.js`，由同步脚本生成 CommonJS 数据模块，不直接携带 JSON |
| 小程序出块体验 | `web/src/adaptiveSpawn.js`、`web/src/bot/blockSpawn.js`、`miniprogram/core/adaptiveSpawn.js`、`miniprogram/core/bot/blockSpawn.js`、`miniprogram/utils/gameController.js` | 小程序同步 Web 规则轨的自适应出块和可玩性 guard；控制器层维护与 Web 同语义的 `scoreMilestone` 桥接、`totalRounds`、special / duplicate 注入节流、诊断回写与玩家画像闭环；`model-v3` 推理、训练和诊断面板不进入小程序包 |
| 小程序玩家实时画像 | `web/src/playerProfile.js` → `miniprogram/core/playerProfile.js`（`scripts/sync-core.sh` 自动转 CJS）；`miniprogram/utils/gameController.js` 串接 `recordNewGame / recordSpawn / recordPlace / recordSessionEnd / save`；持久化经 `miniprogram/adapters/storageShim.js` 把 `wx.*StorageSync` 桥成 `globalThis.localStorage` | 与 Web 同源的 `skillLevel / flowState / pacingPhase / momentum / segment5 / sessionPhase` 等字段直接驱动 `adaptiveSpawn`，跨局保留技能、会话历史与模式偏好 |
| 皮肤与水印 | `web/src/skins.js`、`miniprogram/core/skins.js` | 小程序保留 34 套皮肤、主题 icon、水印配置，并叠加手机端白色盘面与对比度优化 |
| 出块寻参离线包 (v2) | `web/public/spawn-tuning-v2/policies.json`、`miniprogram/core/tuning/v2/spawnPoliciesV2.js` | 权威 JSON 纳入 git；`npm run sync:spawn-bundle` / `prebuild` 生成小程序 CJS；Web/Android/iOS 在 `clientPolicyV2.initClientPolicyV2()` 启动时 fetch `/spawn-tuning-v2/policies.json`（Vite 构建复制 `web/public` → `dist`）；小程序 `app.js` 启动时 `require('./core/tuning/v2/spawnPoliciesV2')`；`policies.meta.json` 含 SHA-256，CI 用 `npm run verify:spawn-bundle` 校验 |
| 皮肤名 i18n | `web/src/i18n/locales/*`、`miniprogram/core/i18n.js` | 小程序目前支持 `zh-CN` / `en`，皮肤名随语言切换刷新 |
| Android/iOS 客户端壳 | `mobile/capacitor.config.json`、`mobile/android`、`mobile/ios` | 壳工程只承载 WebView 和平台配置，不复制或改写 `web/src` 核心玩法 |
| API 地址 | 根目录 `.env*` / 构建环境变量 | Android/iOS 真机包不能依赖 Vite dev proxy，应使用设备可访问的 HTTPS API origin |
| 会话归因字段 | `sessions.attribution` JSON | Web/Android/iOS：`channelAttribution` → `getSessionAttributionSnapshot`；小程序：启动参数/onLaunch 写入同等键名 |
| IAP/广告占位 | 后端 `/api/payment/verify`、`/api/enterprise/ad-impression` | 小程序和移动端使用各自 SDK，请求体字段保持一致 |

## 建议自动化

- CI 中校验：`shared/game_rules.json` / `shared/shapes.json` 与小程序生成数据模块语义一致（见仓库脚本扩展位）。
- 移动端发包前固定流程：`npm run build` → `npm run mobile:sync` → Android Studio / Xcode 构建。
- 黄金事件：`docs/engineering/REFERENCE.md`（§一）与小程序埋点名定期 diff。

## 已知差异处理

- 小程序无浏览器 UTM：使用场景值、`query` 中的自定义参数映射到 `utm_source` / `utm_campaign`；Android/iOS 可沿用 Web URL 参数、安装渠道或后续原生桥接注入。
- 小程序不包含 RL 训练、模型状态、后端同步和商业化运营看板；规则轨出块、棋盘、消行、计分与玩家画像闭环保持 Web 主端同语义，只保留本地离线核心对局体验。
- P1/P2 出块优化器、Web Worker 评估页、SQLite 参数方案和 DFV 可视化属于 Web 调参工具链，不进入小程序核心包；小程序后续若要采用 P2，必须先把对应预算字段固化到 `adaptiveSpawn` 规则轨并通过 `scripts/sync-core.sh` 同步。
- 小程序不直接上传 `core/game_rules.json`、`core/shapes.json` 或 `package.json`，以减少微信开发工具的 JSON 模块兼容和“无依赖文件”提示。
- Android/iOS 首版是 WebView 壳，离线核心对局随 `dist` 打包可用；后端 API、支付、推送等能力需要真实 API origin 和后续平台 SDK 适配。
