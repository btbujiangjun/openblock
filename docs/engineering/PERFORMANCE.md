# 前端性能优化说明（v10.18）

本文记录已落地的性能策略与扩展点，**不改变模块边界**：核心玩法仍在 `game.js` / `renderer.js`，懒加载仅推迟非首屏面板的脚本下载。

## 1. 渲染合并（`game.js`）

- **`markDirty()`**：只置 `_renderDirty`，通过 **`requestAnimationFrame`** 在同一帧内最多执行一次 **`render()`**；无 `rAF` 的环境（极少数测试）退化为立即 `render()`。
- **`flushRender()`**：取消待执行的 rAF 并**同步**调用 `render()`，供 `init()` 等需要首帧立绘的路径（与原先直接 `render()` 等价）。
- **`_getPreviewClearCells()`**：对拖拽「预览消行」的 `previewClearOutcome` 按 **色 + 落点 + shape 指纹** 缓存，避免同一次悬浮内重复 DFS。

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
