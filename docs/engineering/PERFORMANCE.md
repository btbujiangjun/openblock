# 前端性能优化说明（v10.18）

本文档记录已落地的性能策略与扩展点，**不改变模块边界**：核心玩法仍在 `game.js` / `renderer.js`，懒加载仅推迟非首屏面板的脚本下载。

---

## 8. 脏区域追踪 (Dirty Rect Tracking)

新增 `performanceOptimizer.js`，实现增量渲染。

### 功能

- 标记特定格子/区域为脏，避免全量 Canvas 重绘
- 当脏区域 > 16 格时自动降级为全量重绘
- 与 `markDirty()` 集成

### 使用

```javascript
import { getPerformanceOptimizer } from './performanceOptimizer.js';

const optimizer = getPerformanceOptimizer();

// 标记单元格
optimizer.markCellDirty(x, y);

// 标记区域
optimizer.markRegionDirty(x1, y1, x2, y2);

// 获取需要重绘的区域
const region = optimizer.getDirtyRegion();
```

### 文件

- `performanceOptimizer.js` - 脏区域追踪核心实现

---

## 9. 粒子对象池 (Object Pool)

新增 `optimizedParticles.js`，减少 GC 压力。

### 功能

- 粒子从对象池获取，不再每次创建新对象
- 死亡粒子自动回收到对象池
- 最大池大小：200 个粒子

### 使用

```javascript
import { OptimizedParticleSystem } from './optimizedParticles.js';

const particleSystem = new OptimizedParticleSystem(renderer);
particleSystem.addParticles(cells, { lines: 3 });
particleSystem.updateParticles();
```

### 文件

- `optimizedParticles.js` - 粒子系统优化版

---

## 10. CSS 变量局部更新

新增 `cssVariableManager.js`，优化主题切换。

### 功能

- 批量更新 CSS 变量，带 16ms 节流
- 只更新变化的变量，避免全量 DOM 更新
- 变量映射表简化调用

### 使用

```javascript
import { getCSSVariableManager } from './cssVariableManager.js';

const cssManager = getCSSVariableManager();

// 批量更新
cssManager.batchUpdate({
    'grid-cell': '#FFFFFF',
    'primary-color': '#5B9BD5'
});
cssManager.flush();
```

### 文件

- `cssVariableManager.js` - CSS 变量管理器

---

## 11. 模块按需加载 (Code Splitting)

新增 `moduleLazyLoader.js` + 更新 `monetization/index.js`。

### 功能

- 商业化模块按需加载，减少首屏时间
- 场景化加载策略（game_over, shop, main_menu）
- 模块缓存与预加载

### 使用

```javascript
import { loadModulesForScene, getModuleStats } from './moduleLazyLoader.js';

// 根据场景加载模块
const modules = await loadModulesForScene('game_over');

// 获取模块统计
const stats = getModuleStats();
// { cached: 5, loading: 2, total: 11 }
```

### 场景加载策略

| 场景 | 加载模块 |
|------|----------|
| game_over | leaderboard, replayShare, seasonPass |
| shop | iapAdapter |
| main_menu | checkInPanel, dailyTasks |
| settings | pushNotifications |

### 文件

- `moduleLazyLoader.js` - 模块按需加载器
- `monetization/index.js` - 更新为动态导入

---

## 12. 性能监控

```javascript
import { getPerformanceOptimizer } from './performanceOptimizer.js';
import { getModuleStats } from './moduleLazyLoader.js';

// 对象池统计
const poolStats = getPerformanceOptimizer().getPoolStats();
// { poolSize: 150, maxSize: 200, dirtyCells: 5 }

// 模块统计
const moduleStats = getModuleStats();
// { cached: 5, loading: 2, total: 11 }
```

---

## 原有优化策略

### 1. 渲染合并（`game.js`）

- **`markDirty()`**：只置 `_renderDirty`，通过 **`requestAnimationFrame`** 在同一帧内最多执行一次 **`render()`**
- **事件驱动重绘**：静置时不再用棋盘水印/环境粒子循环驱动 `markDirty()`
- **特效层降载**：`fxCanvas` 使用独立低 DPR

### 2. 回放帧拷贝（`game.js`）

- **`beginReplayFromFrames`**：`structuredClone` 优先，失败回退 JSON

### 3. `loadProgress` 缓存（`progression.js`）

- 内存缓存 + localStorage 回退

### 4. 页面可见性（`lib/pageVisibility.js`）

- 后台标签页暂停定时器

### 5. 首屏后懒加载（`main.js` + `initDeferredPanels.js`）

- `game.init()` 成功后延迟加载非首屏功能

---

## 验证

- 单元测试：`tests/progression.test.js`
- 提交前：`npm test`、`npm run build`
- 手动确认各模块功能正常

- **`markDirty()`**：只置 `_renderDirty`，通过 **`requestAnimationFrame`** 在同一帧内最多执行一次 **`render()`**；无 `rAF` 的环境（极少数测试）退化为立即 `render()`。
- **事件驱动重绘**：静置时不再用棋盘水印/环境粒子循环驱动 `markDirty()`；只有拖拽预览、消除动画、回放、皮肤切换、尺寸变化等真实状态变更才触发 `render()`。避免“游戏已开始但无输入”仍以约 30fps 重绘整张 canvas。
- **环境动效专用循环**：星际宇宙流星、樱花、气泡等皮肤动效改为超低频（约 1～2fps，按皮肤类型自适应）只重绘 **`fxCanvas`**，不再重绘主棋盘 canvas / DOM。主菜单、标签页后台、拖拽预览、消除动画中会暂停，由对应的主渲染路径接管。
- **特效层降载**：`fxCanvas` 使用独立低 DPR（不跟随 Retina 主棋盘 DPR），粒子溢出边距从 1.5 cell 降到 1 cell，并移除 CSS `mask-image`；边缘淡出改在 JS 绘制阶段按粒子位置计算，避免 Chrome 对频繁更新的 canvas 做额外 mask 合成。
- **玻璃层降载**：游戏主卡、侧栏面板、RL 面板、回放面板、toast/HUD 等不再使用 `backdrop-filter`，减少动态 canvas 上方的实时背景模糊合成。
- **盘面水印静态化**：水印不再按 `performance.now()` 漂移。事件驱动渲染下，时间型水印只会在落子/动画时跳动，影响判断；固定锚点更稳定，也避免恢复整盘持续重绘。
- **统一盘面舞台**：所有皮肤共用 `.play-stack` 舞台背景、棋盘外框和格线 CSS 变量，减少皮肤之间左右阴影、棋盘承托和 dash 区域强弱不一致的问题。
- **Perfect Clear 圆形覆盖层移除**：旧版 Perfect Clear 会在 `fxCanvas` 上绘制大面积径向闪光和同心圆冲击波，部分皮肤下像突兀的大圆圈；现在只保留粒子反馈，不再绘制圆形覆盖层。
- **外围光晕停用**：`renderEdgeFalloff()` 不再进入主渲染链路。它会在拖拽吸附、落子完成和消除动画的整帧重绘中改变 dash 外围配色，统一盘面舞台后改由 CSS 外框和皮肤 `gridLine` 承担边界表达。
- **消除退场柔化**：`renderClearCells()` 不再画方形/圆角矩形高亮，改为每格径向柔光，并对整行/整列消除聚合成连续椭圆消散带，避免同色 / 同 icon bonus 退场时暴露方形边框。

### 1.1 主菜单空闲仍高占用（深度原因与 CSS 对策）

仅停掉 JS 的 `rAF` **往往不够**，典型原因：

1. **`visibility: hidden` 不停止 CSS `animation`**  
   主菜单打开时 `#app` 仅 `visibility:hidden`，其子元素 **`.game-board-flow-bg` 的 `boardBgFlow`（超大渐变 + `background-position` 无限动画）仍在计时**，Chrome 持续合成，GPU 飙升；游戏已开始后该动画同样会在静置时持续合成。
2. **`@keyframes` 内插值 `filter`（尤其多层 `drop-shadow`）**  
   主菜单 Hero 字标星标 `wm-star-breathe`、顶栏字标 `wm-header-glow` 若在动画里每帧改 `filter`，代价远高于 `transform`/`opacity`。
3. **`#game-grid-fx` 的 `will-change`**  
   在不见壳层时仍 promoted layer，加重合成负担。

**已落地（`main.css` + `game.js`）：**

- `body.game-shell-hidden` 下对 **`#app` 及其后代** 使用 **`animation-play-state: paused`**，并 **`will-change: auto`** 复位 `#game-grid-fx`。
- **`.game-board-flow-bg`** 改为静态渐变背景，不再无限动画 `background-position`。
- **`#game-grid-fx`** 默认 `will-change:auto`，避免静置时预占 promoted layer。
- **`document.visibilityState === 'hidden'`** 时为 `body` 加 **`doc-visibility-hidden`**，暂停 **`#menu`** 内动画（标签页切后台）。
- **星标 / 顶栏字标 / Hero 字标**：去掉无限呼吸/漂浮动画，仅保留静态 `filter`，避免静置时持续合成。
- **`flushRender()`**：取消待执行的 rAF 并**同步**调用 `render()`，供 `init()` 等需要首帧立绘的路径（与原先直接 `render()` 等价）。
- **`_getPreviewClearCells()`**：对拖拽「预览消行」的 `previewClearOutcome` 按 **色 + 落点 + shape 指纹** 缓存，避免同一次悬浮内重复 DFS。

### 1.2 视觉反馈与性能边界（v10.34）

- **环境动效边界**：`aurora-band` 和 `ripple` 这类流体背景必须裁剪在棋盘矩形内，不能绘制到 `fxCanvas` 外扩边距；否则浅/深皮肤都会在棋盘两侧形成大块幕布或圆圈。
- **水印不驱动重绘**：`boardWatermark` 只作为主 canvas 背景层随正常 `render()` 静态绘制；调整可见性时优先改 `opacity/scale/icons`，不要恢复定时漂移。
- **浅色皮肤外框**：浅色皮肤（如 `dawn`）应使用 `gridGap:0 + 低 alpha gridLine`，避免格缝和棋盘外框过强造成“表格感”。外围舞台背景由 `.play-stack` 提供，不应依赖 `fxCanvas` 光晕补色。

## 2. 回放帧拷贝（`game.js`）

- **`beginReplayFromFrames`**：优先 **`structuredClone`** 逐帧拷贝，失败时回退 **`JSON.parse(JSON.stringify)`**，减轻大 JSON 序列化开销（依运行环境而定）。

## 3. `loadProgress` 缓存（`progression.js`）

- **`loadProgress`**：优先读内存缓存；未命中时解析 localStorage 并写入缓存。
- **`saveProgress`**：规范化后写入 localStorage，**成功时同步更新内存缓存**（避免紧接着多次 `loadProgress` 重复 parse）；写入失败则 **`invalidateProgressCache()`**。
- 若其它代码直接改 `openblock_progression_v1` 而不走 `saveProgress`，须调用 **`invalidateProgressCache()`**。

## 4. 页面可见性（`lib/pageVisibility.js`）

- **`skipWhenDocumentHidden(fn)`**：包装定时器回调，`document.visibilityState === 'hidden'` 时不执行，减少后台标签页 CPU。
- **已接入**：`api.js`（`startSync` 周期 flush + **回到前台时补一次** `flushBehaviors`）、`easterEggs.js`、`seasonChest.js`、`seasonPassEntry.js`、`rlPanel.js`（训练指标轮询）、`spawnModelPanel.js`（层参数刷新与训练轮询）。

## 5. 首屏后懒加载（`main.js` + `initDeferredPanels.js`）

- **`game.init()` 成功之后** `await import('./initDeferredPanels.js')`，再 **`initDeferredPanels({ game })`**。
- **仍保留在首包路径**（`init` 失败也可用的功能）：`initReplayUI`、`initPlayerInsightPanel` 等（见 `main.js` 注释）。
- **延迟 chunk**：RL 面板、Spawn 实验室、关卡编辑器、回放专辑、个人仪表盘、赛季通行证及战令入口红点。

## 6. 验证

- 单元测试：`tests/progression.test.js`（`saveProgress` 后 `loadProgress` 与内存缓存一致；该文件对 `localStorage` 使用内存 mock，避免部分 Node 环境带无效 `--localstorage-file` 时 jsdom 持久化抛错）、`tests/adaptiveSpawn.test.js`（与当前节奏相位行为一致）。
- 提交前：`npm test`、`npm run build`；手动确认 RL 面板、关卡编辑器、赛季入口、回放专辑在首局后可正常打开。

## 7. 商业化模块的 LAZY_MODULES 机制（v1.12）

`web/src/monetization/index.js` 提供统一入口 `initMonetization(game)`，内部维护 `LAZY_MODULES` 清单：

- 每条记录形如 `{ name, path, flag }`，由 `featureFlags.js` 的 flag 决定是否实际 `import()`。
- `_invokeInit` 自动尝试 `init<Name>` 与 `init` 两个常见命名；并把需要 `game` 实例的模块（`adTrigger` / `commercialInsight`）显式注入。
- 模块若导出 `shutdown`，会被收集进 `_cleanups`，`shutdownMonetization()` 时统一清理，支持热插拔。

**与首屏延迟加载的关系：**

- 商业化清单通过 `for ... await` 串行加载，是为了保证统计/实验/广告的初始化顺序与依赖关系；它**只跑在 `initMonetization` 内部**，不阻塞主游戏首屏。
- 首屏路径仍由 `initDeferredPanels.js` 在 `game.init()` 后异步 `import()`，与 monetization 入口解耦。

**新增模块接入：** 在 `LAZY_MODULES` 数组末尾追加 `{ name, path, flag }` 即可，不需要再编辑 `initMonetization` 主体。

## 13. 决策数据流面板（DFV）专项优化 (v1.55.1)

**问题**：打开 🌌 决策数据流面板时 Chrome Helper 进程 GPU 占用飙到约 75% / CPU 约 60%。

**根因（4 条）**：

1. `_loop()` 用 `requestAnimationFrame` 直驱 ~60fps，即便数据未变也每帧重写所有 SVG attribute；
2. Canvas 粒子每个 trail 都 `fill` 一次，主点叠 `shadowBlur=12` 高斯发光（GPU 高成本操作），峰值 96 粒子 × 6 次 fill ≈ 576 path ops/帧；
3. `_edgeFlowPhase` 持续推进，让所有边的 `stroke-dashoffset` 永不静止，迫使浏览器对 SVG 持续重合成；
4. 卡片用 `backdrop-filter: blur(10px)` 让浏览器对底下整张棋盘 canvas 持续模糊合成（与 §1.1 规约相违）。

**已落地（`web/src/decisionFlowViz.js` v1.55.1，不改产品语义）**：

| 优化点 | 实现 | 收益 |
|---|---|---|
| **rAF 三档自适应** | `_scheduleNext()`：active 30fps / idle 6fps / paused 0fps；`_isPaused()` 与 `_lastActiveAt` 决定档位 | rAF 触发次数从 ~60/s 降到稳态 6/s（idle）或 30/s（active） |
| **数据指纹去抖** | `_dfvFingerprint()` 取关键字段（stress / intent / breakdown / flowState / sessionPhase）+ 100 倍取整；指纹相同时跳过节点 / stress 球 / intent / 策略 / 边的 SVG 重写 | 出块决策本质回合制，绝大多数帧指纹不变，SVG attribute 写入降至原 1/10 量级 |
| **`_edgeFlowPhase` 静止守门** | 仅在 active（有粒子 / 指纹变化 / spawn pulse 窗口内）时推进 | idle 时 SVG 完全不重合成 |
| **Canvas 粒子瘦身** | 去掉 `shadowBlur=12`，改用预渲染发光精灵（按 color 缓存到 offscreen canvas）+ `drawImage`；trail 5 → 3；上限 96 → 64；无粒子时跳过 `clearRect` | 粒子绘制路径从 6 次 fill + shadowBlur 降到 4 次 drawImage，GPU 合成成本显著下降 |
| **折叠态彻底暂停** | 点击 ⇔ 折叠时 `cancelAnimationFrame`；恢复时立刻 `_scheduleNext(0)` 取一帧最新数据 | 折叠态完全 0 帧率 |
| **visibilitychange 暂停** | `_installVisibilityHooks()`：tab 隐藏 / IntersectionObserver 检测被遮挡（threshold≤0.02）时停 rAF | 后台 tab / 被遮挡时 0 帧率 |
| **移除 `backdrop-filter`** | 背景透明度从 0.94 上拉到 0.97 补偿视觉 | 不再对底下棋盘 canvas 做实时模糊合成 |

**验证**：

- `tests/decisionFlowVizPerf.test.js`：8 个单测锁定调度档位常量、数据指纹去抖（浮点抖动稳定 / 业务变化敏感）、`_isPaused` 行为；
- 手动验证：打开 DFV 后 Chrome 任务管理器 GPU 占用应从 ~75% 降至 idle 态 < 10%、active 态 < 30%。

**API 变化**：DFV 对外接口（`initDecisionFlowViz` / `toggleDecisionFlowViz` / `getDecisionFlowViz`）保持不变；新增 `__dfvTestables`（仅测试用，不进入生产路径）。

---

## 14. 决策数据流面板 GPU 合成层第二轮瘦身 (v1.55.2)

**问题**：v1.55.1 落地后，DFV 打开时 GPU 从 ~75% 降到 ~44%，但仍偏高。任务管理器抓取显示 CPU 和 GPU 几乎同步上升，说明合成路径与 JS 路径都还有可压空间。

**根因（3 条，与文档 §1.1 经验高度吻合）**：

1. **`@keyframes dfv-node-breathe` 无限循环 `transform: scale()`**：`.dfv-stress-core` 和 `.dfv-intent-core` 套了 2.2s 周期的呼吸动画，即使 JS 完全不刷新 SVG，浏览器也每帧重新合成这两层（与 §1.1 第 2 点"`@keyframes` 内插值 `transform`/`filter` 永不停止合成"完全对应）；
2. **11 处 `filter: drop-shadow / blur`**：每个 filter 强制浏览器为该 SVG 元素创建独立合成层；DFV 一打开就常驻 ~11 个 GPU layer；
3. **2 处 `mix-blend-mode: screen`**（`.dfv-edge--flow` / `.dfv-strategy-link--flow`）：mix-blend-mode 会强制创建 stacking context 并跨层合成，是合成路径上最贵的特性之一。

**已落地（`web/src/decisionFlowViz.js` v1.55.2，视觉略简化但保留所有信息密度）**：

| 优化点 | 实现 | 收益 |
|---|---|---|
| **移除无限呼吸动画** | 删除 `@keyframes dfv-node-breathe` 与对应的 `animation` 属性；core 节点改为静态 | 消除 2 个永不停止合成的 SVG 元素 |
| **全部 SVG filter 移除** | 11 处 `filter: drop-shadow/blur` 全部去除；发光感改由"已绘的 glow 圆环 + 半透明 fill"承担 | 合成层从 ~11 降到接近 0 |
| **`mix-blend-mode: screen` 移除** | 2 处 mix-blend-mode 改为 `opacity: 0.95` 模拟视觉强度 | 不再强制 stacking context 跨层合成 |
| **`transition` 统一收窄** | 所有 transition 时间统一到 ≤0.18s 且只对 `fill / stroke` 生效，去掉对每帧变化的 `width / opacity / dashoffset` 的 transition | 避免 transition 队列堆积；30fps 持续更新时不再因 transition 内插触发额外合成 |
| **SVG attribute 差异写入 helper** | `_setAttrIfChanged(el, key, value)` 用 WeakMap 缓存上次值；相同值跳过 `setAttribute` 调用；应用于 `_renderContributionEdges` / `_renderStressToStrategy` / `_renderSignalNode` / `_renderSparks` 4 个最热路径 | 即便指纹去抖未命中，多数 attribute 仍帧间不变；浏览器 dirty layer 标记次数大幅减少 |
| **`_renderSparks` 路径差异写入** | `path.setAttribute('d', ...)` 与 `value.textContent` 都走差异写入 | sparkline 在数据静止时不重画 |
| **baseline edge idle 波静止** | 旧版 idle 时仍以 sin 波驱动 stroke-opacity（即便 v1.55.1 phase 已锁死，重写本身也有 dirty 成本）；改为完全静态 | idle 时整个 SVG 不再被任何 attribute 写入 |

**视觉调整**：

- 发光感由 SVG filter 改为"半透明 fill + glow 圆环"模拟，整体观感略柔，但所有信息密度（颜色、宽度、文字、动效）保留；
- 头部 emoji `🌌` 取消 drop-shadow，但 emoji 自身辨识度足够；
- 卡片背景已在 v1.55.1 移除 backdrop-filter。

**验证**：

- `tests/decisionFlowVizPerf.test.js` 扩展到 10 个用例（+2）：锁定 `_setAttrIfChanged` 相同值跳过 / null 不抛错；
- 手动验证：DFV 打开 + 游戏 idle 时 GPU 占用应进一步降至 < 20%。

**累计效果（v1.55.1 + v1.55.2）**：DFV 打开时 GPU 从基线 ~75% → v1.55.1 ~44% → v1.55.2 预期 < 20%。

---

## 15. HUD 常驻 CSS 动画 GPU 合成瘦身 (v1.55.3)

**问题**：DFV v1.55.2 优化后，GPU 实测 ~29.8% / CPU 26.1%（基线 75%/59% 累计降 −60%）。剩余成本主要来自**主样式表 `web/public/styles/main.css` 里的 HUD 常驻无限循环动画**（不在 DFV 自身，但 DFV 打开后整张页面合成压力仍存在）。

**根因**：经全局扫描所有 `animation: ... infinite`，确认 2 个 HUD 常驻无限动画用了 GPU 最昂贵的 keyframe 形式（与 §1.1 第 2 点警告完全对应）：

| 选择器 | 旧 keyframe 内插值 | 挂载条件 |
|---|---|---|
| `.stress-meter__pulse` | `transform: scale(0.86 → 1.18) + opacity` | **HUD 常驻**（应力计 avatar 周围的脉冲圈） |
| `.best-strategy-badge--hard` | `box-shadow: 0 0 8px → 14px` ×2 段 | **Hard 模式 HUD 常驻**（v1.55 §4.13 新加） |

`transform: scale` 在 keyframe 内会让浏览器每帧重新栅格化合成层；`box-shadow` 在 keyframe 内更贵，**每帧都要重新计算和栅格化阴影区域**——是 GPU 最不友好的 keyframe 形式之一。

**已落地（`web/public/styles/main.css` v1.55.3）**：

| 改动 | 旧实现 | 新实现 | 收益 |
|---|---|---|---|
| **`@keyframes stress-meter-breath`** | `transform: scale(...) + opacity` | **opacity-only**（脉冲圈保持原尺寸，只 fade in/out） | composite-only 属性，浏览器只在合成层做，无需重栅格化 |
| **`.best-strategy-badge--hard` + `@keyframes hardBadgeFlicker`** | 直接在元素上做 box-shadow 关键帧插值 | 主元素 `box-shadow` 静态；新增 `::after` 伪元素叠一层 `box-shadow` 光晕，通过 opacity 动画呈现"呼吸感" | box-shadow 不再 keyframe 内插值，opacity 是 composite-only |

**视觉调整**：

- 应力计脉冲圈不再缩放，但 fade in/out 仍保留"呼吸"语义；
- Hard 徽章保留呼吸光晕（伪元素 ::after），但主元素阴影固定不再闪烁——hard 标识的视觉强度仍由"橙色渐变 + 静态阴影"承担。

**全局扫描结论**：其余 `animation: ... infinite` 均为事件型挂载（如 `revivePulse` 复活倒计时、`celebrate-rays` 庆祝弹窗、`hint-aim-pulse` 技能瞄准），非常驻；`backdrop-filter` 仅在 `game-over-card` / `reward-badge` / `score-reward-badge` 三处事件型元素上（动画 8s forwards，跑完即停）。

**累计效果（v1.55.1 + v1.55.2 + v1.55.3）**：

| 阶段 | DFV 打开 + 游戏 idle GPU | CPU |
|---|---|---|
| 基线 | ~75% | ~59% |
| v1.55.1 | ~44%（−41%） | ~44% |
| v1.55.2 | ~30%（−32%） | ~26% |
| **v1.55.3 后预期** | **< 18%** | **< 20%** |

### CSS 动画 GPU 合成代价对照表（项目沉淀经验）

| keyframe 内插值的属性 | GPU 成本 | 建议 |
|---|---|---|
| `opacity` | 最低（composite-only） | ✅ 优先使用 |
| `transform: translate / scale / rotate` | 中（需重新栅格化层） | ⚠️ 短时事件型可用；常驻动画避免 |
| `filter: drop-shadow / blur` | 高（独立 GPU layer + 每帧重计算） | ❌ 避免；改用静态阴影 + opacity 伪元素 |
| `box-shadow` | 极高（每帧重新栅格化阴影区域） | ❌ 避免；改用伪元素叠加 + opacity |
| `mix-blend-mode` | 极高（强制 stacking context + 跨层合成） | ❌ 避免；改用 opacity / 多层 overlay 模拟 |
| `backdrop-filter` | 极高（每帧对底下所有像素做模糊合成） | ❌ 避免；改用半透明背景色 |

---

## 16. HUD 顶栏布局与配色精修 (v1.55.4)

### 背景

v1.55.3 完成 GPU 合成瘦身后，用户反馈 HUD 顶栏仍存在 **视觉层面** 的体验问题（与性能正交，但仍属"顶栏专项打磨"的延续）：

1. **EASY/HARD 难度徽章孤悬**：徽章独占 `stat-box--best` 的网格第 3 行（`align-self: center + margin-top`），导致它单独漂在 "最佳 7420" 下方，与左侧 stat 群、右侧主题/按钮群完全脱节；
2. **EASY 亮翠绿配色冲突**：旧版 `linear-gradient(#34d399 → #059669) + 白字` 在暗色 HUD（`html[data-ui-theme="dark"]`）下饱和度过高，喧宾夺主，弱化了"最佳分"才是核心信息的视觉层级；
3. **左 stat / 右 actions 之间被硬竖线切断**：`.score-theme-row .stat-box + .stat-box::before` 用 `var(--text-primary) 14%` 在主题选择框前也画了一条硬隔线，与"主题+快捷按钮"本身已自带的圆角边框语义重复。

### 落地（`web/public/styles/main.css`）

**1) 徽章定位：grid overlay 取代独占行**

```css
.score-theme-row .stat-box--best .best-strategy-badge {
    grid-row: 2;          /* 与 stat-value 同行 */
    grid-column: 1;
    justify-self: end;
    align-self: end;
    margin: 0 -6px -2px 0;/* 微出 box 边界，与 7420 立体数字"叠靠"，形成紧凑视觉对 */
}
```

> `.stat-box--best` 已是 `display: grid; grid-template-rows: auto minmax(0,1fr) auto`，
> 我们仅让徽章占第 2 行的右下角格子；不动 HTML 顺序、不影响 `best-gap` subline 的占位与对齐。

**2) EASY 配色：低饱和度薄荷 + 深森林文字**

```css
.best-strategy-badge--easy {
    background: linear-gradient(180deg, color-mix(in srgb, #a7f3d0 92%, #fff), #6ee7b7);
    color: #065f46;
    border: 1px solid color-mix(in srgb, #059669 28%, transparent);
}
/* Dark UI：浅薄荷在暗背景上会"漂浮"，改用深色 chip */
html[data-ui-theme="dark"] .best-strategy-badge--easy {
    background: linear-gradient(180deg,
        color-mix(in srgb, #10b981 35%, #0f172a),
        color-mix(in srgb, #059669 28%, #0f172a));
    color: #a7f3d0;
}
```

**3) HARD 保留 §4.13 烟火语义但收敛饱和度**

起始色由 `#fb923c` 改为更柔的 `#fdba74`，呼吸动画仍用 `::after + opacity` keyframe（composite-only，保留 §15 优化）。

**4) 分隔线柔化 + 主题框前去硬线**

```css
.score-theme-row .stat-box + .stat-box::before {
    background: color-mix(in srgb, var(--accent-color, #38bdf8) 18%, transparent);
    opacity: 0.55;
    top: 24%; bottom: 24%;  /* 上下各内缩 2pp，竖线更短更精致 */
}
.score-theme-row .stat-box + .header-skin::before { display: none; }
```

### 体验收益

| 项 | 旧版 | 新版 |
|---|---|---|
| EASY 徽章位置 | 7420 下方孤悬 | 7420 右下角"7420 EASY"紧凑视觉对 |
| EASY 配色 | 亮翠绿/白字（暗 HUD 喧宾夺主） | 浅薄荷/深森林（亮）或深色 chip（暗），含蓄稳健 |
| 主题框左侧隔线 | 14% 黑硬线 | 不画线（与圆角边框分组语义不重复） |
| stat 列间隔线 | 14% 黑 | 18% accent × 0.55 opacity，更柔和精致 |
| GPU 成本 | — | 0（仍是静态属性 / composite-only animation） |

### 与既有规约的对齐

- §15 CSS 动画 GPU 合成代价对照表：本次不引入新的 keyframe 内 expensive 属性，HARD 呼吸仍走 `::after + opacity`。
- §4.13《最佳分追逐策略》：保留 EASY/HARD 难度档差异化语义（颜色 / 描边对比度），仅调饱和度让"最佳分主信息"重新成为视觉焦点。
- `data-ui-theme` 双套色板规约（`web/src/skins.js`）：EASY 徽章主动适配暗色 UI，避免亮薄荷在 "沙漠绿洲" 等 `uiDark=true` 主题下漂浮。

---
## 17. celebrate toast 常驻动画泄漏与 backdrop-filter 清理 (v1.55.5)

### 背景

v1.55.3 完成 HUD CSS 动画 GPU 合成瘦身后，仍观测到 Chrome GPU 长期占用 ~21%（Activity Monitor）。经审计定位到两类隐藏热点：

**热点 A：13+ 调用方共用 `#easter-egg-toast[data-tier="celebrate"]`，但仅 5 个清理 `data-tier`**

| 调用方 | 文件 | 是否 `delete dataset.tier` |
|---|---|---|
| 易彩蛋（Konami） | `web/src/easterEggs.js` | ✅ 是 |
| 首次解锁皮肤 | `web/src/effects/firstUnlockCelebration.js` | ✅ 是 |
| 极限成就解锁 | `web/src/achievements/extremeAchievements.js` | ✅ 是 |
| 连登勋章 | `web/src/checkin/loginStreak.js` | ✅ 是 |
| 赛季宝箱 | `web/src/rewards/seasonChest.js` | ✅ 是 |
| 段位升级 | `web/src/progression/rankSystem.js` | ❌ 否 |
| 月度里程碑 | `web/src/checkin/monthlyMilestone.js` | ❌ 否 |
| 皮肤碎片解锁 | `web/src/progression/skinFragments.js` | ❌ 否 |
| wow moments | `web/src/onboarding/wowMoments.js` | ❌ 否 |
| 今日招牌菜 | `web/src/daily/dailyDish.js` | ❌ 否 |
| 复盘里程碑 | `web/src/social/replayAlbum.js` | ❌ 否 |
| 首胜加成 | `web/src/daily/firstWinBoost.js` | ❌ 否 |

7 个未清理方触发后，`data-tier="celebrate"` 永久挂在 DOM 上，CSS 选择器持续命中下面 3 个 infinite 动画：

1. `celebrate-rays` — 10s linear infinite rotate（大尺寸 conic-gradient ::before 持续旋转 + `filter: blur(3px)`）
2. `celebrate-icon-pulse` — 1.4s scale + rotate transform，每帧重新栅格化
3. `celebrate-title-shimmer` — 2.4s **`filter: drop-shadow` 在 keyframe 内插值**（§15 黑名单最贵动画形式之一）

即使 toast 不可见（无 `.is-visible`），动画仍在跑 → 长期 GPU 浪费。

**热点 B：两个高频徽章常驻 `backdrop-filter: blur`**

- `.float-daily-reward`：`backdrop-filter: blur(12px)` × 8s（每次得分奖励触发）
- `.score-reward-badge`：`backdrop-filter: blur(10px)` × 8s

每帧对底层所有像素做高斯模糊合成（§15 极高成本），盘面/粒子还在动时尤其昂贵。

**热点 C：`#skin-transition-overlay` 常驻 `will-change`**

`will-change: opacity, background` 在元素上始终挂着 → 浏览器长期为它保留独立合成层。但皮肤切换是稀有事件（1-2 次/局）。

### 落地（`web/public/styles/main.css`）

**1) celebrate 动画 gate 到 `.is-visible`（CSS-only，覆盖所有 13+ 调用方）**

```css
#easter-egg-toast[data-tier="celebrate"]::before {
    animation: celebrate-rays 10s linear infinite;
    animation-play-state: paused;     /* 默认暂停 */
}
#easter-egg-toast[data-tier="celebrate"].is-visible::before {
    animation-play-state: running;    /* 仅可见期间运行 */
}
/* 同样处理 celebrate-icon-pulse 与 celebrate-title-shimmer */
```

> 不改 7 个未清理 JS 调用方（保护未来新增 celebrate toast 也自动安全）。
> `prefers-reduced-motion: reduce` 兜底中已 `animation:none`，与本修复正交。

**2) 移除 reward 徽章 `backdrop-filter:blur`，改为不透明背景模拟玻璃感**

```css
.float-daily-reward, .score-reward-badge {
    /* 旧：linear-gradient 半透明 + backdrop-filter: blur(10/12px) */
    /* 新：完全不透明深色底 + 内描边 inset + 外阴影模拟"金色玻璃" */
    background: linear-gradient(180deg, rgba(40,50,56,.96), rgba(22,28,32,.96));
    box-shadow:
        0 8px 18px rgba(0, 0, 0, 0.22),
        0 0 16px rgba(255, 209, 102, 0.22),
        0 1px 0 rgba(255, 209, 102, 0.14) inset;
}
```

**3) `#skin-transition-overlay` will-change 仅在转场期间挂载**

```css
#skin-transition-overlay { /* 常驻不再写 will-change */ }
#skin-transition-overlay.is-running { will-change: opacity, background; }
```

### 预期收益

| 项 | 旧版 GPU 占用 | 新版 GPU 占用 |
|---|---|---|
| celebrate-rays（toast 隐藏后） | 持续旋转 360° + blur(3px) 合成 | 0（paused） |
| celebrate-icon-pulse（toast 隐藏后） | 1.4s scale+rotate 持续 | 0（paused） |
| celebrate-title-shimmer（toast 隐藏后） | 2.4s drop-shadow keyframe（§15 黑名单） | 0（paused） |
| 每次奖励徽章浮起 | 8s 全屏 blur 合成 × 高斯模糊半径 10-12px | 0（静态阴影） |
| 皮肤切换 overlay | 常驻独立合成层 | 仅 0.6s 转场期间 |

| 阶段 | GPU% | CPU% |
|---|---|---|
| v1.55.3 后实测 | ~21.5% | ~22.2% |
| **v1.55.5 后预期** | **< 14%** | **< 16%** |

### 排查方法学（项目沉淀）

GPU 高占用调查清单（按命中顺序，命中即修）：

1. **`@keyframes` 内 `filter` / `box-shadow` / `mix-blend-mode`** — §15 黑名单，必须改用 `::after + opacity` 替代
2. **`backdrop-filter: blur(>=6px)`** 且持续时间 > 1s — 每帧全屏模糊合成，改用不透明背景或 `box-shadow` 模拟玻璃感
3. **`animation: ... infinite`** 在 toast/popup 上 — 检查 toast 隐藏机制是否能彻底停止 animation（不可见 ≠ 停止）；建议默认 `animation-play-state: paused` + `.is-visible` 时 `running`
4. **常驻 `will-change`** 在事件态元素上 — will-change 长期保留合成层资源，应改为事件类切换
5. **`transform` 在 keyframe 内** — 中等成本，常驻 HUD 元素应改为 `opacity-only`（§15 表）

---

## 8. 相关文档

- [宝箱与钱包](../product/CHEST_AND_WALLET.md)（与钱包、定时器无直接冲突，独立阅读）
- [测试指南](./TESTING.md)
- [商业化运营指南](../platform/MONETIZATION_GUIDE.md#v112-新增模块入口与设计意图变更说明)
