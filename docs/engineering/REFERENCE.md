# 工程参考

黄金事件字典与国际化（i18n）参考文档。

---

## 一、黄金事件字典

> 与 `web/src/config.js` · `GAME_EVENTS`、商业化 `MonetizationBus`、后端 `behaviors.event_type` 对齐。

### 1.1 玩法事件

| 事件常量 | 字符串值 | `data` 核心字段 |
|----------|----------|-----------------|
| `PLACE` | `place` | `shape`, `position`, `cleared`, `boardFill`, `combo` |
| `PLACE_FAILED` | `place_failed` | `shape`, `reason` |
| `CLEAR` | `clear` | `count`, `lines`, `score`, `combo` |
| `NO_CLEAR` | `no_clear` | `boardFill`, `nearMiss`, `placement` |
| `GAME_OVER` | `game_over` | `finalScore`, `totalClears`, `duration`, `strategy` |
| `SPAWN_BLOCKS` | `spawn_blocks` | `shapes`, `adaptiveInsight`, `stress` |
| `SELECT_BLOCK` | `select_block` | `blockIndex`, `shape` |
| `DRAG_START` | `drag_start` | `blockIndex` |
| `DRAG_END` | `drag_end` | `placed` |
| `REVIVE_SHOW` | `revive_show` | `showCount`, `score`（濒死弹层展示=挣扎信号，v1.66 P3） |
| `REVIVE_USED` | `revive_used` | `score`, `reviveCount`（实际复活，难度过载信号） |

> v1.66 P3：`revive_show`/`revive_used` 经 `server.py` ops/dashboard 聚合为 `struggleRate`/`reviveRate`，
> 在运营面板（`opsDashboard.js`）按难度信号呈现；`struggleRate>0.35` 触发告警样式。

权威源码：`web/src/config.js` 中 `GAME_EVENTS` 注释块。

### 1.2 后端 behaviors 写入约定

- `event_type`：使用与前端一致的 snake_case 字符串（如 `game_over`、`iap_purchase`）。
- `event_data`：JSON 对象字符串；字段集合随版本扩展时应向后兼容（新增可选键）。
- `timestamp`：毫秒或秒混合历史存在；新写入应以毫秒为主（见 `SQLITE_SCHEMA.md`）。

### 1.3 商业化扩展事件

| event_type | 说明 |
|------------|------|
| `ad_rewarded_shown` | 激励展示/完成（可与 `ad_impressions` 表并存） |
| `ad_interstitial_shown` | 插屏展示 |
| `iap_purchase` | 内购成功（客户端上报补充） |

服务端广告占位表：`ad_impressions`（见 `backend/enterprise_extensions.py`、`ENTERPRISE_EXTENSIONS.md`）。

### 1.4 生命周期 / 成熟度事件

| event_type | 触发模块 | 关键 `properties` |
|------------|----------|-------------------|
| `ftue_step_complete` | FTUE 流程 | `step`, `attempts`, `durationMs` |
| `intent_exposed` | `strategyAdvisor.js` | `intent`, `stage`, `band`, `stress` |
| `intent_followed` | `strategyAdvisor.js` | `intent`, `followStep`, `tookHint` |
| `bottleneck_hit` | `blockSpawn.js` | `firstMoveFreedom`, `dockRound`, `solutionCount` |
| `recovery_success` | `adaptiveSpawn.js` / `stressMeter.js` | `peakStress`, `recoverSteps`, `valley` |
| `maturity_milestone_complete` | `maturityMilestones.js` | `milestoneId`, `band`, `stage` |
| `weekly_challenge_join` | `weeklyChallenge.js` | `challengeId`, `cycle`, `stage`, `band` |
| `weekly_challenge_complete` | 同上 | `challengeId`, `score`, `cycle`, `durationMs` |
| `winback_session_started` | `winbackProtection.js` | `daysSinceLastActive`, `protectionPreset` |
| `winback_session_completed` | 同上 | `protectedRounds`, `survived`, `score` |

命名规约：全小写 snake_case，带模块前缀。`properties` 仅追加键。所有 lifecycle 事件应可被 `analyticsTracker.getUserJourney()` 重放。

### 1.5 PlayerStateSnapshot.metrics（回放帧 / spawn 决策快照）

| 字段 | 含义 | 取值 | 备注 |
|------|------|------|------|
| `thinkMs` | 思考时长 | ms | activeSamples=0 时 null |
| `pickToPlaceMs` | 反应时长：drag→place | ms | reactionSamples=0 时 null |
| `reactionSamples` | 有效样本数 | int ≥ 0 | <minSamples 时 reactionAdjust=0 |
| `clearRate` | 窗口消行率 | 0~1 | activeSamples=0 时 null |
| `comboRate` | 窗口连消率 | 0~1 | 同上 |
| `missRate` | 窗口失误率 | 0~1 | samples=0 时 null |
| `afkCount` | AFK 样本数 | int ≥ 0 | |
| `samples` / `activeSamples` | 总/非 AFK 样本 | int ≥ 0 | |

### 1.6 stressBreakdown 与 spawnGeo 信号

| 信号 | 含义 | 钳值 |
|------|------|------|
| `reactionAdjust` | 反应过快 +stress；过慢 -stress | ±maxAdjust（±0.05） |

| spawnGeo 字段 | 含义 | 单位 |
|---------------|------|------|
| `holes` | 任何形状覆盖不到的空格数 | int |
| `flatness` | 1/(1+heightVariance) | 0~1 |
| `firstMoveFreedom` | 瓶颈块自由度 | int |
| `solutionCount` | 可落子数之和（DFS 截断） | int |

---

## 二、Web 前端国际化（i18n）

微信小程序使用独立轻量 i18n（`miniprogram/core/i18n.js`，内置 zh-CN/en + 34 皮肤名），不加载 Web 端 locales。

### 2.1 架构

- **形式**：各语言一个 ES 模块，扁平键值，默认回退 `zh-CN`。
- **入口**：`web/src/i18n/i18n.js`（`initI18n`、`t()`、`applyDom()`、`setLocale()` 等）。
- **持久化**：`localStorage` 键 `openblock_locale_v1`。
- **RTL**：`ar` 下 `document.documentElement.dir = 'rtl'`，其余 `ltr`。

### 2.2 支持语言

zh-CN, en, ja, ko, fr, de, es, it, pt-BR, nl, ru, uk, pl, tr, vi, th, id, ar, el 共 19 种。语言列表以 `i18n.js` 中 `AVAILABLE_LOCALES` 为唯一事实来源。

### 2.3 核心 API

| 导出 | 作用 |
|------|------|
| `initI18n()` | 启动时从 localStorage 读取并 `setLocale` |
| `getLocale()` / `setLocale(code)` | 读写当前语言 |
| `t(key, vars?)` | 取文案；支持 `{{name}}` 占位符 |
| `tSkinName(skin)` | 棋盘主题显示名 |
| `applyDom(root?)` | 根据 `data-i18n*` 写入 DOM |
| `applyMeta()` | 同步 `document.title` 与 `<meta name="description">` |
| `subscribeLocale(cb)` | 语言切换后回调 |
| `AVAILABLE_LOCALES` | `{ code, nativeName }[]` |

### 2.4 文案键约定

| 前缀 | 用途 |
|------|------|
| `meta.title` / `meta.description` | 页面标题与描述 |
| `ui.stat.*` / `ui.skin.*` / `ui.header.*` | 顶栏、统计、无障碍 |
| `menu.*` | 主菜单按钮 |
| `dailyMaster.*` | 每日大师题提示 |
| `game.over.*` / `game.retry` / `game.menu` | 结算 |
| `progress.rank.*` / `progress.streakDays` | 等级称号 |
| `skin.name.<id>` | 皮肤名 |
| `effect.scoreMilestone` / `effect.nearMissPlace` / `effect.noMovesEnd` | 分数里程碑/几何近失/鼓励语 |

新增 UI 时先在 `zh-CN.js` 增加键，再同步到其他语言文件。小程序新增 UI 时同步更新 `miniprogram/core/i18n.js`。

### 2.5 DOM 绑定

| 属性 | 行为 |
|------|------|
| `data-i18n="key"` | `textContent = t(key)` |
| `data-i18n-html` | `innerHTML`（慎用） |
| `data-i18n-title` / `-aria-label` / `-placeholder` | 对应属性 |

### 2.6 新增语言 Checklist

1. 复制 `web/src/i18n/locales/en.js` 为 `代码.js`
2. 翻译全部键，保留占位符名
3. 在 `i18n.js` 中 import 并追加 `LOCALES` 和 `AVAILABLE_LOCALES`
4. 运行 `npm test`
5. 本地切换验证

### 2.7 相关文件索引

| 路径 | 说明 |
|------|------|
| `web/src/i18n/i18n.js` | 运行时与语言列表 |
| `web/src/i18n/locales/*.js` | 各语言字典 |
| `web/src/main.js` | 初始化与 `#locale-select` |
| `tests/i18n.test.js` | 单测 |
