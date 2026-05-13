# 商业化与企业能力对照表

> 本文是 OpenBlock 商业化 / 企业能力的**能力对照表**，按主题列出每项能力在本仓库
> 的实现状态与验证依据，供集成团队、审计与运营核对使用。
>
> 当前事实以 [`MONETIZATION.md`](./MONETIZATION.md)、代码和测试为准；本文只做交叉
> 索引，不替代实现文档。
>
> **图例**
>
> | 符号 | 含义 |
> |------|------|
> | ✅ | 仓库内置 —— 可运行、可调用、有测试 |
> | ⚠️ | 部分内置 —— 有骨架/占位，缺少生产闭环的关键环节 |
> | 📋 | 仅文档 —— 流程或规范类，无对应自动化代码 |
> | 🔌 | 外部依赖 —— 需商户号、法务、买量合同等才能闭环 |
> | ⛔ | 规划中 —— 仓库内尚无可验收实现（非外部账号即可补齐） |

文末附 **「外部依赖汇总」** 与 **「规划中能力」** 索引。

---

## 能力矩阵

| # | 改进项 | 结论 | 验证依据（路径 / 接口） | 备注 |
|---|--------|------|-------------------------|------|
| 1 | 真实激励视频 SDK | 🔌 外部依赖 | `web/src/monetization/adAdapter.js` · `setAdProvider` | 须 AdMob 等账号与 SDK 脚本 |
| 2 | 真实插屏 SDK | 🔌 外部依赖 | 同上 | 同上 |
| 3 | 广告聚合 Mediation | 🔌 外部依赖 | `docs/integrations/ADS_IAP_SETUP.md` | 瀑布在广告平台配置，非本仓库代码 |
| 4 | 广告收益与展示埋点 | ⚠️ 部分实现 | `adAdapter.js` → `POST /api/enterprise/ad-impression`、`enterprise_extensions.py` · `ad_impressions` | 已落库占位字段；**无真实 eCPM 回传解析**，收益须接入平台 API |
| 5 | Stripe Web IAP | 🔌 外部依赖 | `iapAdapter.js` · `setIapProvider`、`ADS_IAP_SETUP.md` | 须 Stripe 商户与前端 Checkout |
| 6 | 微信支付 | 🔌 外部依赖 | `docs/platform/WECHAT_MINIPROGRAM.md`、`ADS_IAP_SETUP.md` | 须微信商户与类目审核 |
| 7 | 支付宝 JSAPI | 🔌 外部依赖 | `ADS_IAP_SETUP.md` | 须支付宝开放平台应用 |
| 8 | 服务端支付校验/幂等 | ⚠️ 部分实现 | `POST /api/payment/verify`、`iap_orders` | **幂等与入库已实现**；**非** Stripe/微信/Apple **密码学收据校验**（生产须扩展 Webhook/verify） |
| 9 | 订单对账与退款策略 | ⛔ 未实现 | — | 无专用对账任务/Webhook 路由；仅 `COMPLIANCE_AND_SOPS.md` 文字 |
| 10 | 「移除广告」服务端确权 | ⛔ 未实现 | `iapAdapter.js`、本地 `localStorage` | 权益仍以客户端为准；无服务端令牌校验链路 |
| 11 | 订阅周期管理 | ⚠️ 部分实现 | `iap_orders.expires_at`、`iapAdapter.js` · `_syncPurchaseToServer` | 写入过期时间；**无周期扣款/续订 webhook** |
| 12 | 地区化定价 | 📋 仅文档 | `iapAdapter.js` · `PRODUCTS` | 单一静态目录；无 Geo/IP SKU 映射 API |
| 13 | 黄金事件字典（版本化） | ⚠️ 部分实现 | `docs/engineering/GOLDEN_EVENTS.md`、`web/src/config.js` · `GAME_EVENTS` | **文档与常量对齐**；**无 CI 校验** `GAME_EVENTS` ↔ behaviors |
| 14 | 会话归因字段 | ✅ 已实现 | `sessions.attribution`、`server.py` · `create_session`/`patch_session`、`channelAttribution.js`、`database.js` | 含 UTM、gclid、fbclid |
| 15 | 留存报表 D1/D7/D30 | ✅ 已实现 | `GET /api/ops/dashboard` · `retention.d1/d7/d30`、`web/src/opsDashboard.js` | **D7 为 6–8 日宽松窗口**（与函数 `_retention` 一致）；口径见 `server.py` 注释 |
| 16 | ARPDAU / ARPU | ⚠️ 部分实现 | `iap_orders`、`ad_impressions` | 表可聚合；**无现成 `/api/ops` 字段返回 ARPDAU** |
| 17 | 变现漏斗 | ⚠️ 部分实现 | `GET /api/enterprise/funnel` | 按 `behaviors.event_type` 计数；**非标准漏斗步骤定义** |
| 18 | 填充率 / 激励完成率 | ⚠️ 部分实现 | `ad_impressions.filled` | 有字段；**无请求数/填充失败拆分**，无专用报表 API |
| 19 | 事件导出管道 | ⚠️ 部分实现 | `GET /api/enterprise/analytics-export.ndjson` | NDJSON 导出 behaviors；**非自动同步至云仓**（BigQuery 等须外部管线） |
| 20 | 第三方分析镜像 | ⚠️ 部分实现 | `web/src/analyticsBridge.js`、`analytics_mirror_dlq` | gtag 可选 + DLQ；**未内置 GA4/Amplitude SDK** |
| 21 | MMP / 归因对接 | 🔌 外部依赖 | `channelAttribution.js`（预留参数） | AppsFlyer/Adjust 须账号与 SDK |
| 22 | Remote Config | ✅ 已实现 | `GET /api/enterprise/remote-config`、`remoteConfig.js`、`shared/remote_config.default.json`、`OPENBLOCK_REMOTE_CONFIG_JSON` | |
| 23 | 活动配置 DSL + 时间窗 | ⚠️ 部分实现 | `live_ops_entries`、`GET/POST /api/enterprise/live-ops` | JSON + 时间窗；**无校验 schema、无 CMS UI** |
| 24 | 赛季/通行证配置外置 | ⛔ 未实现 | `web/src/monetization/seasonPass.js` 等 | 逻辑在前端；未读远程配置驱动通行证轨道 |
| 25 | 每日任务模板库 | ⛔ 未实现 | `web/src/monetization/dailyTasks.js` | 硬编码/模块内规则；无服务端模板表 |
| 26 | 限时活动类型扩充 | 📋 仅文档 | `live_ops_entries.payload_json` | 依赖自定义 payload；无预制玩法类型代码 |
| 27 | 运营日历视图 | ⛔ 未实现 | — | 无日历 UI；可查 DB 或外部 BI |
| 28 | 分地区/分桶活动 | ⚠️ 部分实现 | `live_ops_entries.tz`、`abTest.js` | 字段/分桶具备；**无「地区→活动」路由逻辑** |
| 29 | 实验配置服务端存储 | ✅ 已实现 | `experiment_configs`、`GET/POST /api/enterprise/experiments` | POST 需 `X-Ops-Token`（若配置） |
| 30 | 实验生命周期 | ⚠️ 部分实现 | `experiment_configs.status`、`starts_at`、`ends_at` | **无状态机/审批 API** |
| 31 | 护栏指标 | ⚠️ 部分实现 | `guardrail_json` 列 | **存储占位**；无自动告警或暂停实验任务 |
| 32 | 统计报表 uplift | ⛔ 未实现 | `GET /api/ab/results` | 聚合计数；**无置信区间/uplift 计算** |
| 33 | 实验与 Feature Flag 合并策略 | 📋 仅文档 | `web/src/abTest.js` vs `experiment_configs` | 双轨并存；需团队约定 |
| 34 | 埋点质量监控 | ⛔ 未实现 | — | 无丢失率/延迟告警 |
| 35 | Deep Link | 🔌 外部依赖 | — | 依赖域名、Universal Links、宿主 App |
| 36 | Creative 维度报表 | ⚠️ 部分实现 | `attribution.utm_content` | 数据可进会话；**无创意维度聚合 UI/API** |
| 37 | Cohort LTV | ⛔ 未实现 | `monetization_backend.py`、画像 API | 无「cohort × 流水」专用接口 |
| 38 | CI 流水线 | ✅ 已实现 | `.github/workflows/ci.yml` | lint / test / build / Python import |
| 39 | 分环境配置 | ⚠️ 部分实现 | `.env`、`OPENBLOCK_*` | 依赖部署实践；**无 env 模板清单文档集中维护**（分散在各集成文档） |
| 40 | 制品与版本号 | ⚠️ 部分实现 | `package.json` · `version` | **无发布 changelog 门禁或与 Git tag 联动脚本** |
| 41 | 灰度发布 | 📋 仅文档 | Remote Config、实验桶 | 无网关级百分比放量组件 |
| 42 | DB 备份 Runbook | 📋 仅文档 | `docs/operations/COMPLIANCE_AND_SOPS.md` | 无自动备份脚本 |
| 43 | 水平扩展预案 | 📋 仅文档 | `SQLITE_SCHEMA.md`、架构文档 | 迁移方案未脚本化 |
| 44 | 速率限制 | ⚠️ 部分实现 | `OPENBLOCK_RATE_LIMIT_PER_MIN`、`enterprise_extensions.py` | **进程内存计数**；多实例**不共享** |
| 45 | 隐私同意横幅 | ⛔ 未实现 | `POST /api/compliance/consent` | API 有；**无 UI 横幅/CMP** |
| 46 | 导出/删除用户数据 | ⚠️ 部分实现 | `GET /api/compliance/export-user`、`POST /api/compliance/delete-user` | 需 Ops Token；**删除范围未覆盖 achievements/move_sequences 等全部表**（见实现代码） |
| 47 | 未成年人策略 | 📋 仅文档 | `COMPLIANCE_AND_SOPS.md` | 无年龄门/限额代码 |
| 48 | 服务端权威分数 | ⛔ 未实现 | `POST /api/score`、`leaderboard` | 仍以客户端上报为主；无回放重算分数 |
| 49 | 行为上报鉴权 | ⛔ 未实现 | `POST /api/behavior` | 无默认 Token/签名校验 |
| 50 | 日志脱敏 | 📋 仅文档 | `COMPLIANCE_AND_SOPS.md` | 应用日志未统一掩码中间件 |
| 51 | 策略版本注册表 | ✅ 已实现 | `shared/strategy_registry.json`、`GET /api/enterprise/strategy-registry`、`OPENBLOCK_ACTIVE_STRATEGY_VERSION` | 标注用；**不自动切换 RL 权重文件** |
| 52 | 影子流量 | ⛔ 未实现 | — | 无镜像流量或双写对比 |
| 53 | 一键回滚 | 📋 仅文档 | `COMPLIANCE_AND_SOPS.md` | 无自动化回滚按钮/脚本 |
| 54 | RL 离线评估门禁 | ✅ 已实现 | `npm run rl:eval`、`docs/engineering/TESTING.md` | **非 CI 强制门禁**（workflow 未默认执行 rl:eval） |
| 55 | 训练记录与复现 | ⚠️ 部分实现 | `RL_*` 文档、`training.jsonl`（若启用） | 依赖环境与 env；无中心化实验 registry |
| 56 | 共享规则包 | ⚠️ 部分实现 | `shared/game_rules.json`、`docs/platform/SYNC_CONTRACT.md` | Web 权威源；**小程序未 CI 校验 hash 同步** |
| 57 | 埋点契约统一 | ⚠️ 部分实现 | `GOLDEN_EVENTS.md`、`SYNC_CONTRACT.md` | 契约文档；**小程序/多端自动化对齐测试缺失** |
| 58 | 小程序商业化对齐 | 📋 仅文档 | `miniprogram/`、`SYNC_CONTRACT.md` | 双端代码并行；未统一 SDK 封装 |
| 59 | 小程序合规清单 | 📋 仅文档 | `docs/platform/WECHAT_RELEASE.md` | 非可执行代码 |
| 60 | 文档与代码对齐 | ⚠️ 部分实现 | 本文档、`COMMERCIAL_OPERATIONS.md` | 持续维护项；以 `enterprise_extensions.py` 与 `server.py` 为准 |
| 61 | 运营 SOP | 📋 仅文档 | `COMPLIANCE_AND_SOPS.md` | 流程文本；无工单系统集成 |

---

## 🔌 外部依赖汇总

**项号**：1、2、3、5、6、7、21、35

涉及广告平台 / 支付牌照 / MMP / 域名与宿主 App 等，必须由企业与服务商签约后在本仓库接口上接线。

---

## ⛔ 规划中能力

**项号**：9、10、24、25、27、32、34、37、45、48、49、52

若需闭环，须新增路由、任务、UI 或算法（例如 Webhook 对账、服务端确权分数、CMP UI、实验 uplift 统计等）。

---

## 相关入口

- API：`docs/integrations/ENTERPRISE_EXTENSIONS.md`  
- 广告/IAP：`docs/integrations/ADS_IAP_SETUP.md`  
- 数据库：`docs/engineering/SQLITE_SCHEMA.md`、`enterprise_extensions.migrate_enterprise_schema`  
- 事件字典：`docs/engineering/GOLDEN_EVENTS.md`
