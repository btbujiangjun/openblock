# RL 看板：数据流与刷新机制

> 当前定位：维护 RL 训练看板的数据来源、刷新机制和自检方法。
> 曲线趋势解读见 [`RL_TRAINING_DASHBOARD_TRENDS.md`](./RL_TRAINING_DASHBOARD_TRENDS.md)，算法总览见 [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md)。

## 1. 数据从哪来

| 模式 | 曲线与摘要 `#rl-dash-summary` | 左侧 RL「局数 / 均分 / 胜率 / 最佳」 |
|------|--------------------------------|--------------------------------------|
| **未勾选 PyTorch** | `browserTrainingLog.js`（localStorage 环形缓冲）；每局结束由 `appendBrowserTrainEpisode` 写入 `train_episode` | 本页会话内 `onEpisode` 累计 |
| **勾选 PyTorch** | `GET /api/rl/training_log?tail=5000` 读 `training.jsonl` 尾部；**不经过**浏览器缓冲 | 与 `onEpisode` 取 max；刷新时与 `GET /api/rl/status` 的 `episodes` 再对齐 |

请求带 `cache: 'no-store'`，避免浏览器缓存旧 JSON。

## 2. 训练中是否会自动更新

1. **每局结束** `onEpisode` → `scheduleDashRefresh()`：若勾选 **「训练中自动刷新」** 且当前在跑训练，约 **350ms** 后调用 `refreshDashboardFull()`。
2. **定时轮询** `syncChartPoll()`：同上条件时，每 **约 1.2s（浏览器）/ 1.8s（PyTorch）** 再调一次 `refreshDashboardFull()`，防止单局 debounce 遗漏。

若 **关闭**「训练中自动刷新」，则仅在点击 **「刷新图表」** 或改「最近 N 局」下拉时更新看板。

## 3.「刷新图表」做什么（`refreshDashboardFull`）

依次：

1. `refreshTrainingCharts()`：拉取日志 → `updateRlTrainingCharts` 重绘摘要条与 8 个同级面板（6 个主曲线 + 2 个 Teacher / Replay 诊断）；每个面板都有独立展开/收起按钮；**图例画在画布内右上角**（省侧栏高度），**悬停图例项**为 `cursor: help` 并更新 **`title`** 气泡。
2. 若勾选 PyTorch：`refreshServerTrainingLog()` 更新 RL 面板内 **「训练损失」** 文本预读；`syncEpisodesFromServer()` 用服务端 `episodes` 与本地 `totalEpisodes` 取 **max**，对齐左侧 **局数**。

因此按钮不仅刷新右侧看板，也保证 **局数 / 损失预读** 与 Flask 一致（尤其在空闲时手动刷新）。

## 4. 有效性自检清单

- 勾选 PyTorch、启动训练：观察摘要 **末局** 序号与 `training.jsonl` 中最新 `train_episode.episodes` 应一起增长。
- 关闭自动刷新、只点「刷新图表」：曲线与摘要应跳变为当前文件内容。
- 切换「最近 N 局」：立即重绘（同一次 `refreshDashboardFull` 链路）。
- PyTorch 批量训练 v9.3 后：若 `training.jsonl` 包含 `teacher_q_coverage` / `replay_steps` 等字段，第 7/8 个面板显示 Teacher / Replay 曲线；若字段存在但值全为 0，面板内会显示“暂无有效数据”的原因。

更细的数值与损失含义见 [RL 训练数值稳定](./RL_TRAINING_NUMERICAL_STABILITY.md)。  
**趋势判读与训练是否正常**：见 [RL 训练看板趋势](./RL_TRAINING_DASHBOARD_TRENDS.md)。

## 5. PyTorch 在线训练：lookahead 与左侧统计

- **「1-step lookahead」**（`#rl-lookahead`）：默认 **不勾选**。勾选后每步大量调用 **`eval_values`**，首局可能长时间看不到「上局 …」日志；不勾选则每步仅 **`select_action`**，局末更快结束一局。
- **左侧「局数」**：与 `onEpisode` 累计及服务端 **`GET /api/rl/status`** 的 **`episodes`** 取 **max**（见 §1），可能与「本页刚点的训练」不同步到同一零点。
- **「均分 / 胜率 / 最佳」**：主要由 **本会话内** `onEpisode` 写入的最近窗口统计；未完成第一局或窗口为空时可为 **「—」**，与局数栏是否已对齐服务端无关。

面板 **`startBatch`** 异常时会 **`finally`** 解锁按钮；错误摘要写在 **「训练进展」**。详见 [PyTorch RL 在线服务](./RL_PYTORCH_SERVICE.md) §1。

## 6. 面板布局与交互（v1.14）

RL 机器人面板（`#rl-panel`，右栏）与玩家画像面板（`#player-insight-panel`，左栏）在 v1.14 做了一轮布局/交互细化，核心目标是：**让面板内容填满 vfill、避免外层兜底滚动、让任何超长块自带局部滚动条且与主题色协调**。

### 6.1 训练日志在训练时默认展开

> 文件：`web/src/bot/rlPanel.js#startBatch`

`startBatch()` 入口处自动把 **「训练进展」** (`#rl-progress-log`) 与 **「训练损失」** (`#rl-server-log`) 所在的 `<details>` 置 `open=true`，方便观察实时输出。HTML 中两段日志保持默认折叠（无 `open`），仅在按下「开始训练」时被展开；用户中途手动收起后下次开训仍会再次展开（行为保持一致简单）。

### 6.2 看板摘要去层级

> 文件：`web/index.html`、`web/public/styles/main.css`（`.rl-dash-summary`）

| 调整 | 之前 | 之后 |
| --- | --- | --- |
| HTML 包装层 | `details > div.rl-dash-compact > #rl-dash-summary` | `details > #rl-dash-summary` 直接挂载 |
| `.rl-dash-summary` 自身边框 | 浅 accent 色 background + border + border-radius | `background:none / border:none / border-radius:0` |

`<details>` 自身已经是面板视觉框，去掉中间层 + 内层框后视觉上不再"框中框"，DOM 也少一级。`.rl-dash-compact` CSS 选择器作为占位保留（无 DOM 命中），便于后续若再追加内容时复用命名空间。

### 6.3 「训练曲线」→「训练指标」

> 文件：`web/index.html`、`web/src/uiIcons.js`、`web/src/bot/rlTrainingCharts.js`、`web/public/styles/main.css`

将该 `<details>` 的 summary 文案与所有相关 tooltip / 注释统一改为「训练指标」，更准确地涵盖损失、熵、Lv、teacher 覆盖等多类曲线（不仅是"曲线"）。

### 6.4 训练指标自适应高度 + 内部滚动条

> 文件：`web/src/bot/rlPanel.js#scheduleTrainingMetricsAutoCollapse / _evaluateMetricsCollapse`、`web/public/styles/main.css`（`.rl-panel`、`.rl-panel > details:has(> #rl-chart-root)[open]`、`.rl-chart-root`）

挑战：`<details>` + flex 在不同浏览器里的实际表现并不可靠 —— `flex:1 1 0` 不一定能压缩 details 的 content 区，导致 `#rl-chart-root` 按内部 8 条 `.rl-chart-panel` 累加自然撑开，进而 `overflow-y:auto` 因为容器没真正限高而看不到滚动条。

解决方案分两层：

1. **`.rl-panel` 自身 `overflow-y: hidden`**（v1.13 是 `auto`）：避免溢出冒泡到外层、让 panel 整体出条而不是「训练指标」局部出条。
2. **JS 动态测量并写 `chartRoot.style.maxHeight`**：

   ```text
   remaining = panelHeight − Σ(其它 children 高度) − summary高 − 8(buffer)
   if remaining < 90px:
       折叠训练指标 details（用 dataset.autoToggling 标记，区分脚本/用户操作）
   else:
       chartRoot.style.maxHeight = max(remaining, 80) + 'px'
       由 #rl-chart-root 的 overflow-y:auto 出局部滚动条
   ```

   触发时机：
   - `ResizeObserver(panel)` 初次 observe + 后续尺寸变化
   - 任意 `<details>` toggle（用户/脚本均可，事件捕获 `true`）
   - `startBatch()` 展开训练日志后

   `dataset.autoToggling = '1'` 用于让 toggle 监听器区分「脚本主动 toggle」与「用户主动 toggle」：脚本 toggle 时清除标记不计入用户操作；用户主动操作时清除 `metricsAutoCollapsedByScript`，避免后续误自动展开/折叠抖动。

### 6.5 左侧画像默认展开更多 panel

> 文件：`web/index.html`、`web/src/monetization/commercialInsight.js`

为了让 `.app-side-left` 在大多数视口下能填满高度（不再露出底部背景大片留白），以下 `<details>` 在 HTML 中默认 `open`：

- **能力指标**、**实时状态**（v1.13 已 open）
- **实时策略**、**策略解释**、**算法解释**（v1.14 新增）
- **出块算法**（v1.13 已 open）

商业化策略 section 由 `commercialInsight.js` 动态注入，v1.14 起 `section.open = true` 默认展开，由 `.app-side-left` 的 `overflow-y:auto` 兜底滚动。

### 6.6 主题化细滚动条

> 文件：`web/public/styles/main.css`（紧随 `.app-side-left` 定义之后）

左右两侧栏 (`.app-side-left` / `.rl-panel`) 与内部仍会滚动的子容器 (`#rl-chart-root` 训练指标曲线、`.rl-log` 训练进展/损失) 共享同一套半透明、accent 色调的细滑块样式：

| 维度 | 设置 |
| --- | --- |
| Firefox | `scrollbar-width: thin` + `scrollbar-color: color-mix(--accent-color 38%, transparent) transparent` |
| WebKit/Blink 宽度 | `width: 7px / height: 7px` |
| 轨道 | `background: transparent`（让 panel 底色透出来） |
| 滑块 | `background: color-mix(--accent-color 30%, transparent)` + `padding-box border-radius: 6px` |
| Hover | 升至 60% accent |
| Active | 升至 78% accent |

主题色未来切换皮肤（覆盖 `--accent-color`）时滚动条自动跟随，无需额外配置。

## 7. 面板收起 / 展开（v1.33）

> 文件：`web/index.html`（按钮 + inline 防闪烁脚本）、`web/public/styles/main.css`（`.rl-collapsed` 规则与 `--cell-px-width-reserve` / `--cell-px-height-reserve` / `--cell-px-max`）、`web/src/bot/rlPanel.js`（`setRlPanelCollapsed` 与按钮绑定）

### 7.1 动机

RL 训练面板在不需要看训练曲线时（绝大多数纯玩家会话）依然占用约 120~360px 右侧栏宽度。这部分空间在玩游戏时是**纯负担** —— 中央 `--cell-px` 受 `(100vw - widthReserve) / 15` 与 `(100dvh - heightReserve) / 13` 双重上限约束，导致盘面与候选区无法用满视口。v1.33 引入「**整面板收起 → 把空间还给游戏**」交互；v1.34 进一步把收起态升级为「**游戏聚焦布局**」，同时扩大棋盘格与候选方块。

### 7.2 收起态规则

| 维度 | 展开态（默认） | 收起态（`.rl-collapsed`） |
| --- | --- | --- |
| `.rl-panel` 宽度 | `clamp(120px, …, 360px)` | **36px** 细栏 |
| `#app` 右内边距 | 8(inset) + rail + 8(gap) | **52px** = 8 + 36 + 8 |
| `--cell-px-width-reserve` | **332px** = 2×120 + 60 | **188px**（更激进释放右栏空间） |
| `--cell-px-height-reserve` | **257px** | **214px**（压缩标题、统计、skill bar、dock 间距） |
| `--cell-px-max` | **80px** | **88px** |
| 可见内容 | header-row + 全部 details | 仅 `.rl-collapsed-strip`（🦾 按钮 + 旋转标签） |
| `--cell-px` 上限实际抬升 | — | **横向 + 纵向同时抬升**，棋盘与候选块同步变大 |

`--cell-px-width-reserve` / `--cell-px-height-reserve` / `--cell-px-max` 从 `--cell-px` 公式中提取出来，便于在收起态用变量 override 同时影响盘面与候选区尺寸：

```css
--cell-px: clamp(
  22px,
  min(
    (100dvh - var(--cell-px-height-reserve)) / 13,
    (100vw - var(--cell-px-width-reserve)) / 15
  ),
  var(--cell-px-max)
);
```

收起态还会轻量压缩周边 chrome：顶部字标缩小、统计行内边距/字号收敛、`.play-stack` gap 与 padding 收紧、skill 按钮从 38px 降到 34px、dock 上下边距减少。这样右侧空间释放后不会只形成留白，而会被 `--cell-px` 吃掉，表现为**棋盘格子、盘面 canvas、候选方块 canvas 同步放大**。

### 7.3 状态持久化与防闪烁

- 持久化键：`localStorage["openblock_rl_panel_collapsed_v1"]`（`"1"`=收起，`"0"`/缺失=展开）
- `index.html <head>` 中 inline 脚本在 `main.css` 加载之后、`<body>` 渲染之前读取 storage，命中时给 `<html>` 加 `.rl-collapsed`，避免「先展开再瞬间收起」的闪烁
- class 挂在 `<html>` 而非 `<body>`，是因为 inline 脚本执行时 body 还未创建；CSS 选择器统一使用 `.rl-collapsed` / `:root:not(.rl-collapsed)` 与挂载点解耦

### 7.4 按钮交互与 ARIA

| ID | 位置 | 文案 | 触发 |
| --- | --- | --- | --- |
| `#rl-collapse-btn` | `.rl-header-row` 末尾 | `›` | 点击 → `setRlPanelCollapsed(true)`，焦点移交到 `#rl-expand-btn` |
| `#rl-expand-btn` | `.rl-collapsed-strip` 首项 | `🦾` | 点击 → `setRlPanelCollapsed(false)`，焦点移交到 `#rl-collapse-btn` |

两按钮的 `aria-expanded` 反映"面板是否展开"，初始值由 `initRLPanel` 末尾根据 `<html>` 当前 class 投影一次（与 inline 脚本预设状态对齐）。

### 7.5 与盘面尺寸联动

收起 / 展开后，`setRlPanelCollapsed` 主动 `dispatchEvent(new Event('resize'))` 触发：

1. CSS clamp 重算 `--cell-px` → 盘面 canvas CSS 尺寸更新
2. `game.js` 的 `ResizeObserver(canvas)` 检测到 dock 单元尺寸变化 → `refreshDockSkin()` 重绘候选区
3. dock 候选块 / skin 视觉与盘面方块保持像素一致

整个过程纯 DOM/CSS，不读取/修改游戏内部状态；其它模块可独立 `import { setRlPanelCollapsed } from './bot/rlPanel.js'` 调用（如未来"全屏游戏"入口）。
