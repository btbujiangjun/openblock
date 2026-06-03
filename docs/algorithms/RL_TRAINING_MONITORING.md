# RL 训练监控

> 本文聚合了训练看板的数据流与刷新机制、趋势解读与异常研判、以及数值稳定性与 Loss 裁剪方案，是 RL 训练观测的完整参考。
> 算法总览见 [`ALGORITHMS_RL.md`](./ALGORITHMS_RL.md)。

## 一、看板数据流

> 当前定位：维护 RL 训练看板的数据来源、刷新机制和自检方法。

### 1.1 数据从哪来

| 模式 | 曲线与摘要 `#rl-dash-summary` | 左侧 RL「局数 / 均分 / 胜率 / 最佳」 |
|------|--------------------------------|--------------------------------------|
| **未勾选 PyTorch** | `browserTrainingLog.js`（localStorage 环形缓冲）；每局结束由 `appendBrowserTrainEpisode` 写入 `train_episode` | 本页会话内 `onEpisode` 累计 |
| **勾选 PyTorch** | `GET /api/rl/training_log?tail=5000` 读 `training.jsonl` 尾部；**不经过**浏览器缓冲 | 与 `onEpisode` 取 max；刷新时与 `GET /api/rl/status` 的 `episodes` 再对齐 |

请求带 `cache: 'no-store'`，避免浏览器缓存旧 JSON。

### 1.2 训练中是否会自动更新

1. **每局结束** `onEpisode` → `scheduleDashRefresh()`：若勾选 **「训练中自动刷新」** 且当前在跑训练，约 **350ms** 后调用 `refreshDashboardFull()`。
2. **定时轮询** `syncChartPoll()`：同上条件时，每 **约 1.2s（浏览器）/ 1.8s（PyTorch）** 再调一次 `refreshDashboardFull()`，防止单局 debounce 遗漏。

若 **关闭**「训练中自动刷新」，则仅在点击 **「刷新图表」** 或改「最近 N 局」下拉时更新看板。

### 1.3「刷新图表」做什么（`refreshDashboardFull`）

依次：

1. `refreshTrainingCharts()`：拉取日志 → `updateRlTrainingCharts` 重绘摘要条与 8 个同级面板（6 个主曲线 + 2 个 Teacher / Replay 诊断）；每个面板都有独立展开/收起按钮；**图例画在画布内右上角**（省侧栏高度），**悬停图例项**为 `cursor: help` 并更新 **`title`** 气泡。
2. 若勾选 PyTorch：`refreshServerTrainingLog()` 更新 RL 面板内 **「训练损失」** 文本预读；`syncEpisodesFromServer()` 用服务端 `episodes` 与本地 `totalEpisodes` 取 **max**，对齐左侧 **局数**。

因此按钮不仅刷新右侧看板，也保证 **局数 / 损失预读** 与 Flask 一致（尤其在空闲时手动刷新）。

### 1.4 有效性自检清单

- 勾选 PyTorch、启动训练：观察摘要 **末局** 序号与 `training.jsonl` 中最新 `train_episode.episodes` 应一起增长。
- 关闭自动刷新、只点「刷新图表」：曲线与摘要应跳变为当前文件内容。
- 切换「最近 N 局」：立即重绘（同一次 `refreshDashboardFull` 链路）。
- PyTorch 批量训练 v9.3 后：若 `training.jsonl` 包含 `teacher_q_coverage` / `replay_steps` 等字段，第 7/8 个面板显示 Teacher / Replay 曲线；若字段存在但值全为 0，面板内会显示“暂无有效数据”的原因。

### 1.5 PyTorch 在线训练：lookahead 与左侧统计

- **「1-step lookahead」**（`#rl-lookahead`）：默认 **不勾选**。勾选后每步大量调用 **`eval_values`**，首局可能长时间看不到「上局 …」日志；不勾选则每步仅 **`select_action`**，局末更快结束一局。
- **左侧「局数」**：与 `onEpisode` 累计及服务端 **`GET /api/rl/status`** 的 **`episodes`** 取 **max**（见 §1），可能与「本页刚点的训练」不同步到同一零点。
- **「均分 / 胜率 / 最佳」**：主要由 **本会话内** `onEpisode` 写入的最近窗口统计；未完成第一局或窗口为空时可为 **「—」**，与局数栏是否已对齐服务端无关。

面板 **`startBatch`** 异常时会 **`finally`** 解锁按钮；错误摘要写在 **「训练进展」**。

### 1.6 面板布局与交互（v1.14）

RL 机器人面板（`#rl-panel`，右栏）与玩家画像面板（`#player-insight-panel`，左栏）在 v1.14 做了一轮布局/交互细化，核心目标是：**让面板内容填满 vfill、避免外层兜底滚动、让任何超长块自带局部滚动条且与主题色协调**。

#### 1.6.1 训练日志在训练时默认展开

> 文件：`web/src/bot/rlPanel.js#startBatch`

`startBatch()` 入口处自动把 **「训练进展」** (`#rl-progress-log`) 与 **「训练损失」** (`#rl-server-log`) 所在的 `<details>` 置 `open=true`，方便观察实时输出。HTML 中两段日志保持默认折叠（无 `open`），仅在按下「开始训练」时被展开；用户中途手动收起后下次开训仍会再次展开（行为保持一致简单）。

#### 1.6.2 看板摘要去层级

> 文件：`web/index.html`、`web/public/styles/main.css`（`.rl-dash-summary`）

| 调整 | 之前 | 之后 |
| --- | --- | --- |
| HTML 包装层 | `details > div.rl-dash-compact > #rl-dash-summary` | `details > #rl-dash-summary` 直接挂载 |
| `.rl-dash-summary` 自身边框 | 浅 accent 色 background + border + border-radius | `background:none / border:none / border-radius:0` |

`<details>` 自身已经是面板视觉框，去掉中间层 + 内层框后视觉上不再"框中框"，DOM 也少一级。`.rl-dash-compact` CSS 选择器作为占位保留（无 DOM 命中），便于后续若再追加内容时复用命名空间。

#### 1.6.3「训练曲线」→「训练指标」

> 文件：`web/index.html`、`web/src/uiIcons.js`、`web/src/bot/rlTrainingCharts.js`、`web/public/styles/main.css`

将该 `<details>` 的 summary 文案与所有相关 tooltip / 注释统一改为「训练指标」，更准确地涵盖损失、熵、Lv、teacher 覆盖等多类曲线（不仅是"曲线"）。

#### 1.6.4 训练指标自适应高度 + 内部滚动条

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

#### 1.6.5 左侧画像默认展开更多 panel

> 文件：`web/index.html`、`web/src/monetization/commercialInsight.js`

为了让 `.app-side-left` 在大多数视口下能填满高度（不再露出底部背景大片留白），以下 `<details>` 在 HTML 中默认 `open`：

- **能力指标**、**实时状态**（v1.13 已 open）
- **实时策略**、**策略解释**、**算法解释**（v1.14 新增）
- **出块算法**（v1.13 已 open）

商业化策略 section 由 `commercialInsight.js` 动态注入，v1.14 起 `section.open = true` 默认展开，由 `.app-side-left` 的 `overflow-y:auto` 兜底滚动。

#### 1.6.6 主题化细滚动条

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

### 1.7 面板收起 / 展开（v1.33）

> 文件：`web/index.html`（按钮 + inline 防闪烁脚本）、`web/public/styles/main.css`（`.rl-collapsed` 规则与 `--cell-px-width-reserve` / `--cell-px-height-reserve` / `--cell-px-max`）、`web/src/bot/rlPanel.js`（`setRlPanelCollapsed` 与按钮绑定）

#### 1.7.1 动机

RL 训练面板在不需要看训练曲线时（绝大多数纯玩家会话）依然占用约 120~360px 右侧栏宽度。这部分空间在玩游戏时是**纯负担** —— 中央 `--cell-px` 受 `(100vw - widthReserve) / 15` 与 `(100dvh - heightReserve) / 13` 双重上限约束，导致盘面与候选区无法用满视口。v1.33 引入「**整面板收起 → 把空间还给游戏**」交互；v1.34 进一步把收起态升级为「**游戏聚焦布局**」，同时扩大棋盘格与候选方块。

#### 1.7.2 收起态规则

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

#### 1.7.3 状态持久化与防闪烁

- 持久化键：`localStorage["openblock_rl_panel_collapsed_v1"]`（`"1"`=收起，`"0"`/缺失=展开）
- `index.html <head>` 中 inline 脚本在 `main.css` 加载之后、`<body>` 渲染之前读取 storage，命中时给 `<html>` 加 `.rl-collapsed`，避免「先展开再瞬间收起」的闪烁
- class 挂在 `<html>` 而非 `<body>`，是因为 inline 脚本执行时 body 还未创建；CSS 选择器统一使用 `.rl-collapsed` / `:root:not(.rl-collapsed)` 与挂载点解耦

#### 1.7.4 按钮交互与 ARIA

| ID | 位置 | 文案 | 触发 |
| --- | --- | --- | --- |
| `#rl-collapse-btn` | `.rl-header-row` 末尾 | `›` | 点击 → `setRlPanelCollapsed(true)`，焦点移交到 `#rl-expand-btn` |
| `#rl-expand-btn` | `.rl-collapsed-strip` 首项 | `🦾` | 点击 → `setRlPanelCollapsed(false)`，焦点移交到 `#rl-collapse-btn` |

两按钮的 `aria-expanded` 反映"面板是否展开"，初始值由 `initRLPanel` 末尾根据 `<html>` 当前 class 投影一次（与 inline 脚本预设状态对齐）。

#### 1.7.5 与盘面尺寸联动

收起 / 展开后，`setRlPanelCollapsed` 主动 `dispatchEvent(new Event('resize'))` 触发：

1. CSS clamp 重算 `--cell-px` → 盘面 canvas CSS 尺寸更新
2. `game.js` 的 `ResizeObserver(canvas)` 检测到 dock 单元尺寸变化 → `refreshDockSkin()` 重绘候选区
3. dock 候选块 / skin 视觉与盘面方块保持像素一致

整个过程纯 DOM/CSS，不读取/修改游戏内部状态；其它模块可独立 `import { setRlPanelCollapsed } from './bot/rlPanel.js'` 调用（如未来"全屏游戏"入口）。

## 二、趋势解读

> 当前定位：维护 RL 训练看板的趋势解读、异常研判和调参优先级。
> 配套：`web/src/bot/rlTrainingCharts.js` **8** 个同级面板 + 摘要条；曲线为 **细线=逐局**、**粗线=滑动平均（MA）**（得分图为 MA 粗线 + 逐局细线）。

### 2.1 八图各自回答什么问题（图 1～6）

| 图表 | 粗线含义 | 健康时常见形态 | 需警惕 |
|------|----------|----------------|--------|
| **Lπ 策略损失** | 近 20 局策略 surrogate 平滑 | 粗线缓慢下行或窄幅横盘；细线可很抖 | 粗线持续上行且胜率不再涨 |
| **Lv 价值损失** | 近 20 局价值拟合误差平滑 | 粗线有界、尖峰稀疏 | 粗线阶跃上升、或纵轴被单点撑爆（见数值稳定文档） |
| **策略熵 H(π)** | 单序列 | 训练初中期缓慢下降（策略变尖锐） | 长期贴 0（过早收敛）或剧烈反弹 |
| **轨迹长度** | 单序列 | 随能力上升而拉长或平台在较高位 | 突然塌回极短（环境/日志异常） |
| **近 40 局胜率** | 滑动平均 | 从低到高再 **平台化** | 平台后持续下滑且无恢复 |
| **对局得分** | 滑动平均 | 与胜率、步长同向 | 与胜率背离（仅刷分不赢等） |

解读顺序建议：**先看胜率 / 得分 / 步数（任务是否真变好）→ 再看熵与 Lπ 粗线（策略是否在学）→ 再看 Lv 粗线（价值分支是否健康）→ 最后看图 7/8（teacher 与 replay 是否参与更新）**。

### 2.2 图 7「Teacher 覆盖与目标形态」— 图例与口径

纵轴为 **0～100%**（字段一般为 0～1）。与代码 `web/src/bot/rlTrainingCharts.js` 中面板标题 **Teacher 覆盖与目标形态** 一致。**图例绘制在画布内右上角**（无底色，标签带轻微阴影便于叠在曲线上阅读），不占画布外高度；悬停图例项为 **`cursor: help`**，完整说明在 **`canvas.title` 原生气泡**（与下表一致）。

| 图例（曲线名） | 颜色（代码） | 日志字段 | 含义 |
|----------------|-------------|----------|------|
| **Q coverage** | 深绿 `#1b5e20` | `teacher_q_coverage` | 带 **Q teacher**（beam / lookahead `q_vals` / 在线 `q_teacher`）的步占本批 **PG 相关步** 的比例。**1** 表示几乎全部步有 Q 蒸馏目标。 |
| **visit coverage** | 深蓝虚线 `#0d47a1` | `teacher_visit_coverage` | 带 **MCTS visit_pi** teacher 的步占比；纯在线 lookahead **通常为 0**；离线 MCTS 时可上升。 |
| **q entropy norm** | 紫 `#4a148c` | `teacher_q_entropy_norm` | teacher Q softmax 分布熵的归一化（约 **0～1**）。**高**≈目标较**平**；**低**≈较**尖锐**。 |
| **q top margin** | 橙红虚线 `#bf360c` | `teacher_q_margin` | teacher Q 归一化后 **top1 − top2**。**长期过小** ≈ teacher 难分优劣，蒸馏信号弱。 |

### 2.3 图 8「蒸馏吸收与 Replay 占比」— 图例与口径

面板标题以代码为准：**蒸馏吸收与 Replay 占比**（若界面文案略有出入，以图例标签为准）。**图例在画布内右上角**；悬停图例项 **`cursor: help`** + **`title`**。**三条曲线共用纵轴**且启用 **robust 裁剪**，因此 **蒸馏损失（可大于 1）** 与 **replay ratio（仅 0～1）** 会出现在同一坐标系：**勿把纵轴数值当成同一物理量**。

| 图例（曲线名） | 颜色（代码） | 日志字段 | 含义 |
|----------------|-------------|----------|------|
| **Q distill** | 青绿 `#00695c` | `loss_q_distill` | Q 蒸馏损失（**未乘** `q_distill_coef`）。观察策略是否在学习 teacher Q 分布。 |
| **visit_pi distill** | 玫红虚线 `#ad1457` | `loss_visit_pi` | visit_pi 蒸馏损失；无 MCTS 时常接近 **0**。 |
| **replay ratio** | 棕 `#6d4c41` | `replay_steps/(pg_steps+replay_steps)` | **search replay** 混入步数占本批总步比例；摘要条 **replay xx%** 与之同源。占比长期过高可调低 `searchReplay.sampleRatio` / `maxSamples`。 |

### 2.4 诊断面板总述

前 6 图为任务表现，图 7、8 为 teacher / replay 诊断；各图可独立展开/收起。无有效数据时显示说明而非误导性的 **0 线**。摘要条中的 **tq 覆盖**、**replay 占比**、**qH** 便于快速对照图 7、8。

### 2.5 训练日志 `[adap …]` / `[quant …]` 字段（课程模式）

OpenBlock 训练课程现有三模式，启动 banner 会打印当前模式：

```
Curriculum 模式: quantile  p=70  window=500  emaAlpha=0.05  ... (目标 win_rate≈30%)
Curriculum 模式: adaptive (v11)  window=200  checkEvery=50  target_wr=0.5
Curriculum 模式: linear  start=40->end=600 over 40000 ep
```

#### 2.5.1 `[adap …]`（v11 adaptive 模式）

启用 `rlCurriculum.mode = "adaptive"`（或 `rlRewardShaping.adaptiveCurriculum.enabled=true` 自动推断）后：

```
... | thr=180  [adap wr=42% vep=8000 act=hold] | sc=145 ...
```

| 字段 | 含义 | 健康范围 | 异常信号 |
|---|---|---|---|
| `wr` | 近 `window` 局（默认 200）滑动胜率 | 30%~60% | 长期 < 10% → 多次 `act=severe` 触发 |
| `vep` | 虚拟课程局数；驱动 `win_threshold` 推进 | 单调缓慢上升或在塌缩后小幅回退后再爬 | 长期持平 / 长期下降 → 检查 `stepDown` / `severeRollbackFactor` |
| `act` | 本次反馈决策 | `hold` / `accel` 为主，偶尔 `pause` | 连续 `rollback` 或 `severe` → 模型在当前 threshold 显著塌缩 |

**研判优先级**：当胜率曲线（图 5）长期低于 30% 且日志连续出现 `act=rollback/severe` 时，**等 1k–3k ep 看 vep 是否真在下降**，下降说明闭环在生效；若 vep 也不动则确认 `RL_ADAPTIVE_CURRICULUM=1`（或 `enabled=true`）。详见 [ALGORITHMS_RL §12.3](./ALGORITHMS_RL.md#123-自适应课程v8-引入v11-闭环化)。

#### 2.5.2 `[quant …]`（v11.2 quantile 模式，**当前默认**）

启用 `rlCurriculum.mode = "quantile"` 后：

```
... | thr=287  [quant p70 tgt=295 ema=287.4 n=500 act=quantile] | sc=312 avg100=255 win%=31.5% | ...
```

| 字段 | 含义 | 健康范围 | 异常信号 |
|---|---|---|---|
| `p` | 目标分位数（与配置一致） | 固定值 | 不应变化 |
| `tgt` | 当前 `score_history` 的 p 分位数原始值 | 随能力增长稳步上升 | 突降 → 模型最近大量崩盘 |
| `ema` | 平滑后的内部状态 | 滞后 `tgt` ~14 局 | `tgt` 与 `ema` 长期差 > 20% → 考虑加大 `emaAlpha` |
| `n` | 当前 `score_history` 样本数（≤ `windowEpisodes`） | 训练 ≥ 500 ep 后稳定为 windowEpisodes | 训练已久仍 < windowEpisodes → 检查 batch_episodes 是否正常累计 |
| `act` | 当前分支 | 训练 > 100 ep 后稳定为 `quantile` | 长期停在 `bootstrap` → 检查 score 是否被追加 |

**关键观察**：quantile 模式下 win_rate（看板图 5）应**数学上恒等于 `1 - p/100`**（例如 p=70 → 30%）。若长期偏离 ±5pp，说明：
- **偏低**：模型最近大量崩盘 → 检查策略是否过度收敛、是否需要更多探索
- **偏高**：策略相对最近 500 局分布过强 → 极少见，可能 score_history 未正确更新

详见 [ALGORITHMS_RL §12.4](./ALGORITHMS_RL.md#124-分位数自适应课程v112-引入新默认)。

#### 2.5.3 `[smooth …]`（v11.2 方案 B 平滑奖励，opt-in）

启用 `rlRewardShaping.smoothWinBonus.enabled=true`（或 `RL_SMOOTH_WIN_BONUS=1`）后：

```
... | thr=287  [quant ...]  [smooth tgt=180 span=120 r=+18.3 act=smooth] | sc=240 ...
```

| 字段 | 含义 | 健康范围 | 异常信号 |
|---|---|---|---|
| `tgt` | 当前 score 分布的 `targetPercentile`（默认 p50） | 随能力增长稳步上升 | 突降 → 模型最近大量崩盘 |
| `span` | `spanHighPercentile - spanLowPercentile`（默认 IQR） | 与 `tgt` 同量级，受 `spanFloor` 兜底保护 | 长期 = `spanFloor` → 分布过窄，需调小 floor 或检查多样性 |
| `r` | 本批最后一局注入的 smooth reward（已被 `saturationClip` 限制） | `[-tanh(c)·winBonus, +tanh(c)·winBonus]` | 长期满量级 → 分数远超分布中心，需检查 reward hacking |
| `act` | 当前分支 | `bootstrap`（前 `bootstrapEpisodes` 局）→ `smooth`（正常） | 长期 `bootstrap` → score_history 未追加 |

**关键观察**：启用 smooth 后看 `Lv`（图 6）应在 10k+ ep 内**逐步下降**至 < 10。若 `Lv` 未改善，说明问题不在 sparse 跳变（可能是 value head 容量不足或 GAE λ 配错）。

#### 2.5.4 `[rnd …]`（v11.2 方案 C RND Curiosity，opt-in）

启用 `rlRewardShaping.rndCuriosity.enabled=true`（或 `RL_RND=1`）后：

```
... | thr=287  [quant ...]  [rnd ī=0.68 Lp=0.68 σ=0.11] | sc=312 ...
```

| 字段 | 含义 | 健康范围 | 异常信号 |
|---|---|---|---|
| `ī` | 本批 intrinsic reward 均值（归一化前） | 训练初期 0.5~1.5，长期缓慢下降 | 长期 > 2.0 → 状态空间持续新颖（可能 STATE_FEATURE_DIM 配错）；长期 ≈ 0 → predictor 已完全模仿 target（应降 β） |
| `Lp` | predictor 网络 loss | 应缓慢下降（前 5k ep 内下降 30%+） | 不降 → 检查 lr / grad_clip / state 是否变化 |
| `σ` | RND normalizer running std | 训练 ≥ 1k ep 后稳定在 0.05~0.5 | 长期 < 1e-3 → reward 量级过小，β 实际无效 |

**触发监测 alert**（即使 RND disabled 也会在满足条件时打）：

```
⚠️  RND Trigger: score_stall | 近 N log 段 mean_score 斜率 |0.00042| < 0.001（窗口约 5000 ep） | 建议设 RL_RND=1 或 game_rules.json rndCuriosity.enabled=true
⚠️  RND Trigger: entropy_collapse | entropy 0.087 < 0.2 且 avg_score 320 < expected×0.8 = 400 | 建议设 RL_RND=1 ...
```

**关键观察**：启用 RND 后看 entropy（图 4）应**保持在 1.0+ 不再单调下降**，且 avg_score 应在 5k-10k ep 内**重新开始增长**。若启用 RND 但 score 反而下降，说明 β 过大盖过外部奖励，降到 0.05 或更小。

详见 [ALGORITHMS_RL §12.7](./ALGORITHMS_RL.md#127-后续演进路线v12-备选方案) 与 [RL_ALPHAZERO_OPTIMIZATION §9.1.z](./RL_ALPHAZERO_OPTIMIZATION.md#91z-课程后续演进路线v12-备选方案)。

### 2.6 看板图 9：课程门槛与得分分位（v11.2）

新增图 9，专用于 quantile 模式可观测性，含 4 条曲线：

| 曲线 | 字段 | 颜色 | 解读 |
|---|---|---|---|
| `win threshold` | `win_threshold` | 红 | 当前 batch 实际生效的胜利门槛（linear/adaptive/quantile 都有） |
| `quantile target (p)` | `quantile_target` | 蓝（虚线） | score 第 p 分位数原始值（仅 quantile） |
| `quantile EMA` | `quantile_ema` | 青 | EMA 平滑后的内部状态（仅 quantile） |
| `win_rate × 100` | `win_rate_recent` | 紫（点线） | 本 log 段胜率，已 ×100 缩放到与 thr 同尺度 |

**典型形态**：
- **健康**：thr / target / ema 三线接近重合，win_rate × 100 稳定在 (1 - p/100) × 100 附近 ±5pp
- **EMA 跟不上**：target 与 ema 持续偏离 > 15% → 调大 `emaAlpha`
- **bootstrap 未退出**：训练 > 100 ep 后 target 仍为空（NaN）→ 检查 `_quant_score_history` 是否被正确追加
- **非 quantile 模式**：仅有 win_threshold 一条线，target / ema 为空板提示

### 2.7 典型案例研判（长训后期，约 4 万局量级）

以下与常见截图形态一致，用于说明「全过程是否正常」的判读逻辑（非绑定某一固定随机种子）。

#### 2.7.1 偏正常的信号

- **局数**已很大（如 3.9 万+），说明训练管线持续跑通、日志连续。
- **近 40 局胜率**曾爬升至 **50%～70%** 区间并能在 **50% 上下** 波动，说明策略已超越随机，具备稳定赢面。
- **步数、得分**粗线 **长期抬升**，与「更会存活、更会得分」一致。
- **熵**总体 **下行**，符合「从探索到利用」的常见曲线。

**结论（外在指标）**：从任务表现看，**训练前半程到中后期是有效的**，不能简单判为「完全没学到」。

#### 2.7.2 需关注的信号（后期）

- **Lv 粗线在时间轴末端抬升**或伴随 **Lπ 末端尖峰**：常见于
  - 课程/阈值变化导致 **分布偏移**；
  - 价值目标与策略 **非平稳**（non-stationarity）；
  - 或 **少数难局 / 高回报轨迹** 使 critic 暂时拟合困难。
  若 **胜率与得分粗线仅小幅回调** 而仍高于早期，多为 **正常波动**；若 **粗线连续下行数周（按局数）** 且熵异常，再考虑「退化」。
- **胜率从峰值略回落**（例如从 ~65% 到 ~54%）：在自博弈/非固定对手下 **常见**，未必是 bug；需对照 **是否改过奖励、阈值、网络或数据管线**。

#### 2.7.3 综合研判话术

| 情形 | 建议结论 |
|------|----------|
| 胜/分/步粗线长期向上，Lv 偶发尖峰、粗线仍平 | **整体正常**，继续观察或微调价值系数 |
| 胜/分粗线下行 + Lv/Lπ 粗线同时恶化 | **可能异常**，优先查日志尺度、学习率、checkpoint |
| 仅 Lv 爆炸、外在指标仍涨 | **价值分支不稳**（见数值稳定文档），已用裁剪/日志上限缓解 |

### 2.8 优化建议（按优先级）

#### 2.8.1 已落地、优先确认环境

1. **启用/核对数值裁剪**（减轻 Lv 尖峰与日志污染）：
   `RL_RETURNS_CLIP`、`RL_VALUE_TARGET_CLIP`、`RL_GAE_DELTA_CLIP`、`RL_LOG_LOSS_CLIP`（见数值稳定章节）。
2. **改超参后重启 Flask**，避免新旧标度混在同一 `training.jsonl` 里拉长纵轴误解。

#### 2.8.2 训练策略层

3. **`RL_VALUE_COEF`**：Lv 粗线长期高于 Lπ 且外在指标停滞时，可 **小幅降低** 价值权重，减轻 critic 拉扯。
4. **`RL_GRAD_CLIP` / `RL_LR`**：末端损失同时炸、且出现 NaN 跳过保存时，略 **降学习率** 或 **收紧梯度裁剪**。
5. **熵系数**（`RL_ENTROPY_COEF` 与衰减）：若熵过早贴 0 且胜率不再涨，略 **提高熵下限** 或 **减慢衰减**；若长期过高噪声，反向微调。
6. **课程与胜利阈值**（`game_rules.json` / `rlCurriculum`）：阈值爬坡若与当前策略能力不匹配，会表现为 **后期胜率回落 + Lv 抬升**，应对齐策划曲线或放缓爬坡。
7. **Teacher / Replay 指标**：若 `teacher_q_coverage` 低，优先检查 lookahead/beam/MCTS 开关；若 `teacher_q_entropy_norm` 长期接近 1 且 `teacher_q_margin` 很小，说明 teacher 目标太平，可降低 `tau` 或增强 beam；若 replay 占比长期过高，先降低 `searchReplay.sampleRatio` 而不是继续加 loss。

#### 2.8.3 工程与运维

8. **定期存盘与回滚**：利用 `checkpoint_saved` 事件与 `RL_SAVE_EVERY`；若某段之后指标系统性变差，**回滚到峰值前 checkpoint** 对比。
9. **看板窗口**：右侧「最近 N 局」拉大可看长期；判 **短期抖动** 用较短窗口。
10. **双机对比**：同一 `training.jsonl` 备份下 A/B 两套超参，只比较 **粗线** 与摘要，减少细线噪声干扰。

### 2.9 与仓库内其他文档的关系

| 文档 | 内容 |
|------|------|
| [`RL_TRAINING_NUMERICAL_STABILITY.md`](./RL_TRAINING_NUMERICAL_STABILITY.md) | Lv 爆炸根因与裁剪环境变量 |
| [`RL_TRAINING_DASHBOARD_FLOW.md`](./RL_TRAINING_DASHBOARD_FLOW.md) | 看板数据从哪来、如何刷新 |
| **本文** | **趋势判读 + 是否正常 + 优化清单** |

## 三、数值稳定与 Loss 裁剪

> 当前定位：维护 RL 训练数值稳定、loss 幅值和环境变量说明。
> 对应现象：训练看板中 **Lv（价值损失）纵轴出现 10³⁰ 量级**、Lπ 剧烈抖动，而胜率/得分仍上升。

### 3.1 根因归纳

#### 3.1.1 单局 `train_episode` 路径（`rl_backend._rl_train_episode_inner`）

- 价值目标为 **蒙特卡洛折扣回报** \(G_t\) 与 **当前价值估计** \(V(s)\) 的 smooth L1。
- 长局、单步奖励与得分增量较大时，\(G_t\) 沿时间反向累加，**尺度可达数百～数千**；而价值头若仍接近初始化量级，**|G−V|** 很大 → `loss_value` 数值高。
- 若再配合偶发 **非有限梯度 / 异常步**，日志里可能出现极端标量，**拖垮看板纵轴比例**（即使策略仍在改善）。

#### 3.1.2 批量 PPO 路径（`rl_pytorch/train._reevaluate_and_update`）

- 使用 **GAE** 构造优势与回报；**TD 误差** \(\delta_t = r + \gamma V_{t+1} - V_t\) 在长局、大 \(r\) 时可在时间上累积放大。
- 原实现对价值目标 `rets_np` 使用 **±1e5** 的宽松裁剪，与 **outcome 混合目标**（约 \([0,2]\)）尺度不一致时，**价值分支仍可能学在错误量级上**，表现为 Lv 尖峰或不稳定。

#### 3.1.3 与「表现变好」不矛盾

- 策略梯度主要由 **标准化后的优势** 驱动；价值头偏差大时，**策略仍可沿奖励信号上升**。
- 但若 **Critic 长期尺度不对**，存在 **后期性能天花板或突然恶化** 的风险，故需从目标尺度与日志两侧收紧。

### 3.2 代码侧优化（已实现）

| 位置 | 改动 |
|------|------|
| `backend/rl_backend.py` | `RL_RETURNS_CLIP`（默认 ±512）裁剪单局 MC 回报，再算 `value_loss`。 |
| `backend/rl_backend.py` | 单局 **`_rl_train_episode_inner`**：若 POST 步含 **`q_teacher`**，叠加 **Q 蒸馏**；`training.jsonl` 可记录 **`loss_q_distill`、`q_distill_coef`、`teacher_q_coverage`**（与批量 flush 字段对齐）。 |
| `backend/rl_backend.py` | `_loss_scalar_for_log`：写入 `training.jsonl` 与 API 的 `loss_policy` / `loss_value` 做 **有限性检查** 与 **`RL_LOG_LOSS_CLIP`（默认 1e6）** 幅值上限。 |
| `rl_pytorch/train.py` | `RL_VALUE_TARGET_CLIP`（默认 512）裁剪批量路径上用于价值损失的回报目标。 |
| `rl_pytorch/train.py` | `RL_GAE_DELTA_CLIP`（默认 80）裁剪 GAE 的 \(\delta_t\)，抑制优势沿时间爆炸。 |
| `web/src/bot/rlTrainingCharts.js` | 绘制 Lπ/Lv 曲线时对 **超过阈值的异常点** 置为 `NaN`，避免旧日志污染纵轴（仅显示层）。 |

### 3.3 环境变量参考

| 变量 | 默认 | 作用 |
|------|------|------|
| `RL_RETURNS_CLIP` | `512` | 单局路径：`|G|` 逐元素上限；设为 `0` 可关闭（不推荐）。 |
| `RL_VALUE_TARGET_CLIP` | `512` | 批量 PPO：价值回归目标逐元素上限；`0` 关闭 numpy 裁剪（仍经 `nan_to_num`）。 |
| `RL_GAE_DELTA_CLIP` | `80` | 批量 PPO：TD 误差裁剪后再做 GAE 递推；`0` 关闭。 |
| `RL_LOG_LOSS_CLIP` | `1e6` | 写入日志/API 的损失标量绝对值上限。 |

与现有 `RL_RETURN_SCALE`、`RL_VALUE_COEF`、`RL_GRAD_CLIP` 等可同时调节；**先调裁剪与回报尺度，再动学习率** 更安全。

### 3.4 看板解读建议

- **Lv**：优先看 **粗线滑动平均**；若仍偶发尖峰，对照是否 **旧 JSONL** 或未重启后端（仍写旧尺度日志）。
- **Lπ**：高噪声常见；与 **熵**、**胜率** 同向则多为可接受。
- **胜率 / 得分 / 步数**：外在指标；与 Lv 解耦判断时，以「趋势 + 平台」为主。
