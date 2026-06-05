# Cocos 迁移路线图（Phase 0 → 4）

目标：**保留 web 内核不变**，并行新增 Cocos 客户端；玩法逻辑收敛为三端共享的单一真源。

图例：✅ 已实现 · 🟡 已实现可用但待加强/接真实资源 · ⬜ 规划中

---

## Phase 0 · 引擎无关 core ✅

`assets/scripts/core/`，由 `miniprogram/core` 移植为 TS，已通过 `tsc strict` + 运行时冒烟。

| 模块 | 状态 |
| --- | --- |
| `rng / shapes / grid / scoring` | ✅ 移植 |
| `shapesData`（**由 `shared/shapes.json` 生成**，单一真源） | ✅ `npm run sync:cocos-core` |
| `adaptive`（**忠实移植 `derivePbCurve` + 拓扑压力 → 类别权重**） | ✅ 出块回退层 |
| `engine/*`（**`web/src` 真实出块闭包原样生成**，100% 同源） | ✅ `npm run sync:cocos-core` + `engineSpawn` 已接入 |
| `economy`（钱包）/ `skills`（定义+hint）/ `meta`（签到/任务/赛季） | ✅ |
| `gameModel`（事件内核 + undo/bomb/rainbow/freeze/存档 + 自适应出块） | ✅ |
| `skins / spawn` | ✅ |

## Phase 1 · 可玩核心循环 ✅

盘面/候选区/拖拽吸附/消行/计分/补块/判负/HUD/代码优先启动，全部 ✅。

## Phase 2 · 特效 / 音频 / 手感 ✅（资源待替换为美术/音频）

| 能力 | 实现 | 状态 |
| --- | --- | --- |
| 消行闪光 | `effects/LineClearFx` | ✅ |
| 碎屑粒子 + 连击/完美飘字 | `effects/FxLayer` | ✅ |
| 屏幕抖动 | `effects/ScreenShake` | ✅ |
| 落子高光 / 无效回弹音 | `FxLayer.flashPlacement` + `AudioManager.sfxInvalid` | ✅ |
| 程序化音效（WebAudio 合成，零资源） | `audio/AudioManager` | ✅ |
| 震动反馈 | `platform/Haptics` | ✅ |
| 皮肤切换 | `core/skins` + 顶部「皮肤」按钮 | ✅ |
| 真实音频/粒子贴图/骨骼动画 | — | 🟡 接资源后增强 |

## Phase 3 · 元系统 ✅

| 能力 | 实现 | 状态 |
| --- | --- | --- |
| 技能：提示/撤销/炸弹/彩虹/冻结 | `core/skills` + `GameModel` + `skills/SkillBar` | ✅ |
| 钱包经济（消行获币、技能消耗） | `core/economy` | ✅ |
| 每日签到 / 任务 / 赛季积分 | `core/meta` + `ui/MetaPanel` | ✅ |
| 新手引导 | `ui/Tutorial` | ✅ |
| 皮肤商店 / 更丰富任务体系 | — | ⬜ 可在现有框架上扩展 |

## Phase 4 · 平台导出与商业化 🟡

| 能力 | 实现 | 状态 |
| --- | --- | --- |
| 跨端存储 + 自动存档/读档 | `platform/Storage` + `GameController.save` | ✅ |
| 运行环境检测 | `platform/Platform` | ✅ |
| 广告 / IAP 抽象 | `platform/Monetization`（Noop 默认） | ✅ |
| 微信小游戏广告/支付适配 | `platform/wechat/WechatAdapters` | ✅ 代码就绪（填 adUnitId 启用） |
| 云存档接口 | `platform/CloudSave`（本地兜底） | ✅ |
| 原生 iOS/Android 广告/支付 SDK 桥接 | — | ⬜ 实现 `AdsAdapter/IapAdapter` 注入即可 |

导出步骤见 [BUILD.md](./BUILD.md)。

---

## Phase P0–P2 · 留存 / 变现 / 商业化补齐 ✅（与 web 客户端功能对齐）

引擎无关逻辑均落在 `core/`（已过 `npm run typecheck:cocos` 严格检查 + Node 冒烟），
UI/平台在 `game/`。所有数值/开关统一走 `core/remoteConfig`（可不发版调参与 A/B）。

### P0 · 首发体验
| 能力 | 实现 | 状态 |
| --- | --- | --- |
| 续命 revive（濒死→看广告/金币复活，每局上限、递增花费） | `GameModel.revive` + `ui/ReviveOverlay`(ModalPanel) + `platform/Ads` | ✅ |
| i18n 框架 + zh-CN/en（HUD/技能/面板/弹窗全抽 key） | `core/i18n` + 各 UI `t()` | ✅ |
| 变现实装：激励视频（revive/翻倍/转盘/reroll）+ IAP 商品表 | `platform/Ads` + `core/remoteConfig.iapProducts` + 微信适配 | ✅ 填 adUnitId 启用 |
| 手感：BGM + 分数滚动动画 + 近失反馈 | `AudioManager.startBgm` + `Hud.setScore`(tween) + `FxLayer.flashNearMiss` | ✅ |

### P1 · 增长闭环
| 能力 | 实现 | 状态 |
| --- | --- | --- |
| 结算开箱（基础+按分加成，看广告翻倍）+ 幸运转盘 | `core/rewards` + `ui/ModalPanel`/`ui/WheelPanel` | ✅ |
| 成长：等级经验 + 成就（含奖励）+ 排行入口 | `core/progression`/`core/achievements` + `platform/Leaderboard` | ✅ |
| 玩法模式：Zen（不败软重排）/ Lightning（60s 翻倍） | `core/modes` + `GameModel` + `ui/ModeSelect`(ModalPanel) | ✅ |
| 技能扩展：reroll / preview / aim | `core/skills` + `GameController.onSkill` | ✅ |
| 签到强化：连签 + 月度里程碑 + 首胜加成 + 每日菜单 | `core/daily` + `ui/MetaPanel` | ✅ |
| 回流：welcomeBack + 首日礼包 | `GameController.maybeWelcomeBack` | ✅ |
| 远程配置 + featureFlags | `core/remoteConfig` | ✅ |

### P2 · 社交 / 数据 / 运营
| 能力 | 实现 | 状态 |
| --- | --- | --- |
| 分享裂变 + 排行榜 | `platform/Share`（微信转发/Web share）+ `platform/Leaderboard`（开放数据/本地兜底） | ✅ |
| 真实云存档 + 离线队列 | `platform/CloudSync`（写本地+队列，在线 flush，pull 取 best 合并） | ✅ |
| 埋点上报（复用 GAME_EVENTS 口径） | `core/analytics` + `platform/AnalyticsSink`（微信 reportEvent/HTTP beacon） | ✅ |
| 季节皮肤 + 季节强调色 | `skin/seasonalSkin`（按月默认皮肤/色调） | ✅ |
| RL 出块路径 + 玩家画像 context 下沉 | `core/spawnModel`（policy 接缝 + contextProvider，flag `rlSpawn` 门控） | ✅ 接缝就绪 |
| 社交进阶 asyncPK/friend/guild 脚手架 | `core/social`（本地兜底 + `SocialBackend` 契约） | ✅ 脚手架 |

> 说明：广告/IAP/排行/云存档/埋点的「真实服务端」属后端范畴，客户端均提供**契约 + 本地兜底**，
> 微信端填入 adUnitId / 接入开放数据子域 / 配置上报即生效；多人实时对战需服务器，故只给客户端契约。

校验：`npm run typecheck:cocos`（全相位 strict，`cocos/typecheck/cc.d.ts` 提供离线 `cc` 桩）。

---

## 单一真源与同步

本仓库既有约定：**`shared/*.json` = 数据真源，`web/src` = 逻辑真源**，`miniprogram/core`
由 `scripts/sync-core.sh` 生成。Cocos 沿用同一哲学：

- `cocos/assets/scripts/core/shapesData.ts` 由 `scripts/sync-cocos-core.mjs` 从
  `shared/shapes.json` 生成（已并入 `npm run sync:core`，CI 可用 `npm run verify:cocos-core` 守门）。
- 自适应难度 `core/adaptive.ts` 忠实移植 `adaptiveSpawn.derivePbCurve` 与拓扑压力信号
  （已通过 Node 对拍：ratio .82→tension 0.5、ratio 1.1→brake；满盘→救济权重↑）。
  现作为**回退**：引擎闭包异常时 `GameModel.refillDock` 自动降级到 `adaptive`，保证可玩。

### 出块 100% 同源引擎（已落地）

`scripts/sync-cocos-engine.mjs` 把 `web/src` 的「引擎无关纯逻辑闭包」（与 `sync-core.sh`
同名单：`bot/blockSpawn.generateDockShapes` + `adaptiveSpawn` + `boardTopology` +
`spawnStepDifficulty` + `constructiveSpawn` + `grid/shapes/gameRules/difficulty/
playerAbilityModel/playerProfile/clientPolicyV2` …）**原样生成**到
`cocos/assets/scripts/engine/*.js`（ESM 保留），即与 web 出块完全同源、非手写副本。

- 数据：`engine/shapesData.js` / `gameRulesData.js` 由 `shared/*.json` 生成（`export default`）。
- `config`：生成极简 shim（仅 `getStrategy`/`STRATEGIES`，去 `localStorage`/`import.meta.env` 耦合）。
- `platformProfile.js`：原样复制（纯逻辑、`typeof` 守卫，可被 `globalThis.__OPENBLOCK_PLATFORM__` 覆盖）。
- 软子系统（`monetization/ retention/ lifecycle/`）：自动生成「具名导出返回 `null` 的函数 + 空命名空间」桩，
  配合调用点既有 `?.`/`if`/`try` 守卫软失败（与小程序 soft-wrap 等价）。
- 接线：`core/engineSpawn.ts → createEngineSpawner()` 把当前棋盘快照成 engine `Grid`（两端
  `cells[y][x]` 表示一致）调真实 `generateDockShapes`，形状 100% 走引擎、配色沿用本端
  `pickThreeDockColors`；`Bootstrap` 注入到 `GameModel.spawnFn`。
- 同步/守门：已并入 `npm run sync:cocos-core` 与 `npm run verify:cocos-core`（CI 可守 drift）。
- 验证：Node 全对局冒烟通过（8 局 avg≈48 出块/局、421 次消行、自然 gameover）；core 严格类型检查通过。

> ⚠️ 待办：请在 **Cocos 编辑器**里跑一次实测（引擎为生成 JS，编辑器内模块解析/打包以实机为准）。

## 下一步（可选，触及 web）

1. 接入真实美术/音频资源（`AudioManager.register` 注册 clip 即自动优先于合成音）。
2. 如需玩家画像驱动（skill/momentum/frustration），可把 web `game.js` 的 `_spawnContext`
   装配逻辑也抽到引擎无关层，让 Cocos 复用完整自适应输入（当前用中性 context）。
