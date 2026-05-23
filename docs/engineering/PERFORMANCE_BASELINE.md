# 性能基线与回归检测

> **适用角色**：算法 / 平台工程师、测试 / QA、release 把关人。
> **何时阅读**：改动 `grid.js` / `adaptiveSpawn.js` / `blockSpawn.js` / `boardTopology.js` / `playerProfile.js` / `renderer.js` 等"性能敏感模块"之后；准备发版之前。
> **不解决什么**：本文不讲"为什么 OpenBlock 性能这么定"，只讲"已经定下来的基线如何不被无声打破"。性能设计原则见 [`PERFORMANCE.md`](./PERFORMANCE.md)。

---

## 0. 一句话总览

本仓库通过 **CPU 自动 + GPU 手动** 两套基线保护性能不被无声退化：

| 维度 | 基线文件 | 采集方式 | 检测命令 |
|---|---|---|---|
| **CPU（计算）** | `tests/perf-baseline.json` | Node 端 `vite ssrLoadModule` 自动 | `npm run perf:check` |
| **GPU（渲染）** | `tests/perf-baseline-gpu.json` | 浏览器 `window.__perfOverlay.startProfile(10)` 手动 | `npm run perf:check:gpu` |

两条管线相互补充：CPU 基线可进 CI/release 自动门；GPU 基线手动维护，发版前本地校对。

代码入口：

```
scripts/perf-bench-cli.mjs        # CPU bench runner（输出 JSON）
scripts/perf-check.mjs            # CPU 基线对比（fail 时退出 1）
scripts/perf-check-gpu.mjs        # GPU 基线对比（读 lastCapture 与 expectations）
tests/perf.bench.js               # 交互式 vitest bench 版（与 perf-bench-cli 同口径）
web/src/monitoring/perfOverlay.js # 浏览器内 perf HUD + startProfile(secs) 录制
```

---

## 1. CPU 基线（自动化）

### 1.1 何时关心

每次改动以下任一区域时：

- `web/src/grid.js` —— 棋盘操作核心
- `web/src/adaptiveSpawn.js` —— 自适应策略
- `web/src/bot/blockSpawn.js` —— 出块算法
- `web/src/boardTopology.js` —— 拓扑分析
- `web/src/playerProfile.js` —— 玩家画像
- `web/src/stressAmbience.js` —— 压力派生

### 1.2 跑 bench

控制台交互式（带 hz / p99 / rme%）：

```bash
npm run perf:bench
```

机器可读 JSON（用于基线 / CI）：

```bash
npm run perf:bench:cli              # 默认 time=800ms, warmup=150ms
node scripts/perf-bench-cli.mjs --json --time 1200
node scripts/perf-bench-cli.mjs --filter generateDockShapes
```

输出 schema（schemaVersion=1）：

```json
{
  "meta": {
    "schemaVersion": 1,
    "capturedAt": "2026-05-23T14:22:56.450Z",
    "nodeVersion": "v25.9.0",
    "platform": "darwin", "arch": "arm64", "cpuCount": 10,
    "timeMs": 800, "warmupMs": 150
  },
  "results": [
    {
      "name": "blockSpawn.generateDockShapes(fill=0.55)",
      "samples": 533, "meanMs": 1.27, "p50Ms": 1.25, "p95Ms": 2.63,
      "p99Ms": 2.89, "minMs": 0.98, "maxMs": 7.90,
      "hz": 787.4, "rmePct": 2.19, "warmupCount": 67
    }
  ]
}
```

### 1.3 更新基线

只在你做了**有意的、已验证收益**的优化后才更新：

```bash
npm run perf:baseline
git add tests/perf-baseline.json
git commit -m "perf: update CPU baseline after <change-summary>"
```

PR 描述必须说明：

- 哪个场景从 X ms 变到 Y ms（贴 `npm run perf:check` 输出表）
- 为什么（算法重写 / 数据结构换型 / 删冗余路径）
- 视觉/行为有没有变化（应该没有；如果有，需要在 PR 里单独证明 visually OK）

### 1.4 回归检测

提交 PR 前本地跑：

```bash
npm run perf:check
```

阈值（在 `scripts/perf-check.mjs` 顶部声明、易于修改）：

| 路径类型 | warn | fail |
|---|---|---|
| 微秒级 (p50 < 0.01ms) | +40% | +80% |
| 毫秒级 (p50 ≥ 0.01ms) | +15% | +30% |

微秒级容忍更高是因为 V8 JIT / GC 在亚 μs 时间尺度上会放大噪声，硬卡 15% 会被 CI 频繁误伤。`--strict` 把 warn 当 fail 处理：

```bash
node scripts/perf-check.mjs --strict
```

退出码：

- `0` = 全 OK 或仅 warn
- `1` = 至少一个 fail（或 `--strict` 下有 warn）
- `2` = 基线加载失败

### 1.5 集成到 release 流程

`npm run release:check` 当前包含 `lint && test && build`。**性能基线门禁默认不进自动门**，因为：

- 不同机器 CPU 性能差异远大于阈值
- macOS Thermal Pressure / CPU 频率调度等都会影响数字
- 误伤一次比放过一次更让团队失去对工具的信任

建议在 release tag 之前**手动**跑一次：

```bash
npm run release:check && npm run perf:check
```

如果你的 CI runner 稳定且想自动门禁，扩 `release:check:web`：

```json
"release:check:web": "npm run lint && npm test && npm run build && npm run perf:check"
```

### 1.6 添加新场景

编辑 `scripts/perf-bench-cli.mjs`（CI/JSON 路径）**和** `tests/perf.bench.js`（交互式调优路径）：两个文件**保持同步**。模板：

```js
results.push(runBench('module.functionName(scenario)', () => {
    functionName(...preparedInputs);
}));
```

新增后跑 `npm run perf:baseline` 重生成基线，提交时附 `tests/perf-baseline.json` diff。

---

## 2. GPU/渲染基线（手动）

### 2.1 为什么是手动

`window.requestAnimationFrame`、CSS 合成层、`PerformanceObserver{type:'longtask'}` 都依赖真实浏览器主线程；jsdom / Node 测不到。我们采取"采集容易 + 对比简单"的折衷：浏览器跑一次 → 复制 JSON → 粘到基线文件。

### 2.2 完整采集流程

**Step 1**　启动 dev server

```bash
npm run dev:3000
```

**Step 2**　打开浏览器

访问 `http://localhost:3000`。**强制刷新**（Cmd+Shift+R）一次，确保最新 `perfOverlay.js` 加载。

**Step 3**　进入 scenario A：`idle-no-dfv`

- 不要打开 DFV（确认 DFV 按钮未亮）
- 等 5 秒（让首屏 init + 各种 timer 平稳）
- 打开 DevTools Console，跑：

```js
window.__perfOverlay.open();
await window.__perfOverlay.startProfile(10);
```

10s 后 console 会打印 `[perfOverlay] copy as JSON:` 后跟完整 JSON。

**Step 4**　粘贴到基线

打开 `tests/perf-baseline-gpu.json`，把 `scenarios["idle-no-dfv"].lastCapture` 字段从 `null` 改成上一步复制的 JSON 对象。

**Step 5**　重复 scenario B / C

- **`idle-dfv-open`**：打开 DFV → `startProfile(10)` → 粘
- **`active-drag-combo`**：打开 DFV → 慢拖几块触发连消 → 期间运行 `startProfile(10)` → 粘

**Step 6**　校对

```bash
npm run perf:check:gpu
```

读基线里每个 scenario 的 `lastCapture` 与 `expectations` 对比，逐项 OK / FAIL。缺采集的 scenario 显示 [skip]，不算失败（CI 不卡死）。

### 2.3 GPU 基线 schema

```json
{
  "schemaVersion": 1,
  "description": "...",
  "scenarios": {
    "<scenario-name>": {
      "description": "场景含义",
      "expectations": {
        "fpsWindow.p50Fps": ">= 55",
        "longtask.countInWindow": "<= 8",
        "longtask.maxMs": "<= 80"
      },
      "lastCapture": { /* startProfile 输出 */ },
      "lastCaptureNotes": "采集环境备忘（机器、Chrome 版本、DPR 等）"
    }
  }
}
```

支持的运算符：`>=`、`>`、`<=`、`<`、`=`。`lastCapture` 里所有点路径都可在 expectations 用（如 `countersTotal.game.render`、`layers.canvasCount`、`fpsAllTime.meanFps`）。

### 2.4 何时更新 expectations

如果你优化了某个真实卡顿场景，确实把 p50 从 35fps 提到 50fps：

1. 把 `lastCapture` 更新到新的 capture
2. 把 `expectations.fpsWindow.p50Fps` 收紧到 `>= 45`（留 5fps 余量）
3. 把 `lastCaptureNotes` 记上"采集机器 + Chrome 版本 + DPR"
4. PR 描述里解释收益来源

### 2.5 perfOverlay 工具集

`perfOverlay` 是一个**默认不挂载、不计时**的开发面板，通过 `?perf=1` 或 Alt+P 启用。完整 API：

```js
window.__perfOverlay.open();           // 显示 HUD
window.__perfOverlay.close();          // 关闭 HUD
window.__perfOverlay.toggle();         // 切换
window.__perfOverlay.snapshot();       // 取当前指标快照（不录制）
window.__perfOverlay.startProfile(10); // 录 10s 后返回 + 打 JSON
window.__perfOverlay._lastProfile;     // 上一次 startProfile 结果
```

HUD 显示四类指标：

- **fps**: mean / p50 / p95 / worst（4Hz 更新）
- **longtask**: count / max / total（PerformanceObserver{type:'longtask'}）
- **业务计数器**: `game.render` / `markDirty` / `renderer.clear` / `ambient fx` / `watermark` 每秒次数
- **合成层启发式**: DOM nodes / canvas / filter|transform / big shadow / backdrop-filter / will-change

### 2.6 GPU 基线的"非门禁"语义

GPU 基线**不**进 release:check 自动门，因为：

- 不同机器 GPU 性能差异远大于 CPU
- 浏览器版本 / 驱动 / 插件都会影响数字
- 同一浏览器在不同时间状态（散热、电源、其他 tab）也会变

它的角色：**开发者在 PR 前 / 发版前的人肉校对工具**。配合 [`PERFORMANCE.md`](./PERFORMANCE.md) 既有的设计规约（避免大半径 box-shadow、无限 keyframe、后台 tab 持续 rAF 等），一起防止 GPU 退化。

---

## 3. 日常迭代怎么用

### 3.1 写代码前

```bash
npm run perf:bench         # 看看当前热点排序
```

### 3.2 写代码中

```bash
npm run perf:bench         # 反复跑某个场景看 hz 变化
# 或：
node scripts/perf-bench-cli.mjs --filter generateDockShapes --time 1200
```

### 3.3 写完准备 PR

```bash
npm run perf:check         # 自动对比 CPU 基线
# 如果是有意优化：
npm run perf:baseline
git add tests/perf-baseline.json
git commit -m "perf: update CPU baseline after <change>"
```

### 3.4 发版前

```bash
npm run release:check                            # lint + test + build
npm run perf:check                               # 手动顺一遍 CPU 基线
# 浏览器跑 startProfile + 粘到 perf-baseline-gpu.json
npm run perf:check:gpu                           # 校对 GPU 基线
```

---

## 4. 历史趋势

不在仓库里单独维护 history 表，靠 git 自然存：

```bash
git log --all --oneline tests/perf-baseline.json
git show HEAD~5:tests/perf-baseline.json \
  | jq '.results[] | select(.name=="blockSpawn.generateDockShapes(fill=0.55)") | .p50Ms'
```

---

## 5. 当前基线状态（参考）

> 仅作示意，实际以仓库内 `tests/perf-baseline.json` 为准。

| 场景 | p50 (ms) | hz |
|---|---|---|
| `derivePbCurve` | 0.0001 | 17M+ |
| `getStressAmbience` | 0.0001 | 16M+ |
| `resolveAdaptiveStrategy(normal,mid)` | 0.004 | 161K |
| `Grid.clone` | 0.0002 | 3.7M |
| `Grid.bestExactFit` | 0.0005 | 2.0M |
| `Grid.bestMonoFlushPotential` | 0.0005 | 1.8M |
| `boardTopology.analyzeBoardTopology` | 0.016 | 47K |
| `PlayerProfile.recordPlace` | 0.0003 | 3.4M |
| `generateDockShapes(fill=0.35)` | 0.21 | 1.3K |
| `generateDockShapes(fill=0.55)` | 1.25 | 0.5K |
| `generateDockShapes(fill=0.70)` | 0.15 | 4.8K |

注意 `fill=0.55` 是 worst case（合法位多 + attempt loop 重试多），bench 显示是 fill=0.70 的 ~8x。这是 v1.55.11 已知的优化方向。

---

## 6. 已知噪声源

- **`PlayerProfile.recordPlace(true,3)` rme% 偶尔到 9%**：路径里有 V8 deopt 触发点（多态对象写）。如果你的 PR 里它单点 ±25% 但其他场景都 OK，先重跑确认是噪声。
- **Vite SSR 加载约 8s**：每次 `npm run perf:check` 大概 30s（8s 加载 + 22s × 21 场景 bench）。可接受。
- **GPU 端 dpr/视口/电源状态影响显著**：同一台 Mac 接 / 不接电源、外接显示器拔 / 插，FPS 可能 ±10%。`lastCaptureNotes` 字段就是记这些上下文用的。

---

## 7. 已落地的 GPU 优化（v1.55.10 - v1.55.13）

按时间倒序，每条都通过 `tests/*` 回归保护。**实测 sakura 皮肤 GPU 从 ~59% → 34.8%（-41%）**（Mac Retina + Chrome，DFV 关闭、常规对局状态）：

| 版本 | 优化 | 实测收益 | 测试覆盖 |
|---|---|---|---|
| **v1.55.13** | **离散粒子皮肤改 DOM transform**：sakura/forest/ocean/fairy/universe 5 款皮肤的环境粒子从 Canvas2D 迁到 DOM (`<div class="ambient-particle">`)。**关键**：所有粒子共用 `.ambient-particles-host` 一个合成层（容器 `transform: translateZ(0)`，子粒子**不**挂 `will-change`），避免 5 粒子 = 5 个新合成层。配合 v1.55.12 fxCanvas 在 sakura 下也能下沉 | **~56.8% → 34.8%（-39%）** | `tests/ambientDom.test.js` |
| v1.55.12 | **fxCanvas 闲置时下沉合成层**：根据 particles / clearCells / flashes / ambient motion 综合判断 fxCanvas 是否需要显示；不需要时 `display:none` 让 Chrome 回收合成层 | -5~10%（非环境皮肤静置时）| `tests/fxCanvasIdleHide.test.js` |
| v1.55.11 | **`Grid.bestExactFit/bestMonoFlushPotential/bestMonoFlushBuildup` 去 Set 化**：用 Uint8Array + 坐标算术替换 `new Set("x,y")` 字符串 hash 查询 | 3-5× per-helper 加速；`generateDockShapes(fill=0.35)` 从 0.79ms → 0.36ms | bench: `perf:check` |
| v1.55.10 | **stress-meter-breath 限制为 tense/intense**：低压时静态光晕，不持续 60Hz 合成；`html[data-visibility="hidden"]` 时全局 `animation-play-state: paused` | 后台 tab GPU ≈ 0 | 视觉验证 |

### 教训摘要（写给后续优化者）

1. **`will-change` 是双刃剑**：单个元素加 `will-change: transform` 让浏览器把它 promote 成独立合成层。**N 个小元素各自 promote = N 个新合成层**，合成成本可能比 1 个大 layer 更高。正确做法：把动画聚合到一个父容器，**只在容器上 promote**，子元素复用其合成层。
2. **`<canvas>` 元素永久占用一个合成层**，即使透明无内容。需要的时候 `display:none` 让 Chrome 回收。
3. **`renderEdgeFalloff()` 这类已废弃的 API**：保留代码不 free，要么彻底删除、要么用条件 gate 跳过。
4. **靠图省事的"经验直觉"做 GPU 优化经常踩坑**：必须用 `window.__perfOverlay.diagnoseGpu()` + 活动监视器实测验证，不能光看代码推理。
5. **"主动提层"几乎都是负优化**（v1.55.16 实测教训）：
   - 在已经有 `box-shadow` / `position: fixed` 的元素上加 `transform: translateZ(0)` → GPU 不降反升（实测 +11pp）
   - 在容器上加 `contain: layout style` → 触发新合成层 promotion，反而增成本
   - 原因：现代 Chrome 已经有非常成熟的合成层启发式，**手动 hint 经常打乱它的判断**
   - **铁律：不要"主动提层"。只有"主动降层"（display:none、移除 will-change、改用静态属性）才大概率是优化。**
   - 唯一确定有效的"主动提层"：动画路径的 `will-change: transform`（如 v1.55.13 `.ambient-particles-host`）—— 且必须用 `:has()` gate 避免空 host 也占层。

### 调试工具速查

```js
// 在 DevTools Console 跑（dev / 生产都可用）
window.__perfOverlay.diagnoseGpu()
//   → ambient.renderMode（dom/canvas）、fxCanvasDisplay（visible/none）、
//     suspectLayers（promoters / bigShadows / backdrop-filter 计数）

window.__perfOverlay.open()            // 显示实时 HUD
window.__perfOverlay.startProfile(10)  // 10s 录制 → JSON
```

---

## 8. 相关文档

- [前端性能优化说明](./PERFORMANCE.md) —— 性能设计原则 / 已落地的优化清单
- [测试指南](./TESTING.md) —— 单测、契约、回归
- [二次开发指南](./DEV_GUIDE.md) —— 改 spawn / profile / renderer 的标准流程
- [自适应出块](../algorithms/ADAPTIVE_SPAWN.md) —— `resolveAdaptiveStrategy` 内部 9 层流水线
- [出块三层架构](../algorithms/SPAWN_ALGORITHM.md) —— `generateDockShapes` 实际职责
