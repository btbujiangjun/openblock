# 前端性能优化说明（v10.18）

本文记录已落地的性能策略与扩展点，**不改变模块边界**：核心玩法仍在 `game.js` / `renderer.js`，懒加载仅推迟非首屏面板的脚本下载。

## 1. 渲染合并（`game.js`）

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
- **已接入**：`api.js`（`startSync` 周期 flush + **回到前台时补一次** `flushBehaviors`）、`easterEggs.js`、`seasonChest.js`、`seasonPassEntry.js`、`rlPanel.js`（训练曲线轮询）、`spawnModelPanel.js`（层参数刷新与训练轮询）。

## 5. 首屏后懒加载（`main.js` + `initDeferredPanels.js`）

- **`game.init()` 成功之后** `await import('./initDeferredPanels.js')`，再 **`initDeferredPanels({ game })`**。
- **仍保留在首包路径**（`init` 失败也可用的功能）：`initReplayUI`、`initPlayerInsightPanel` 等（见 `main.js` 注释）。
- **延迟 chunk**：RL 面板、Spawn 实验室、关卡编辑器、回放专辑、个人仪表盘、赛季通行证及战令入口红点。

## 6. 验证

- 单元测试：`tests/progression.test.js`（`saveProgress` 后 `loadProgress` 与内存缓存一致；该文件对 `localStorage` 使用内存 mock，避免部分 Node 环境带无效 `--localstorage-file` 时 jsdom 持久化抛错）、`tests/adaptiveSpawn.test.js`（与当前节奏相位行为一致）。
- 提交前：`npm test`、`npm run build`；手动确认 RL 面板、关卡编辑器、赛季入口、回放专辑在首局后可正常打开。

## 7. 相关文档

- [宝箱与钱包](../product/CHEST_AND_WALLET.md)（与钱包、定时器无直接冲突，独立阅读）
- [测试指南](./TESTING.md)
