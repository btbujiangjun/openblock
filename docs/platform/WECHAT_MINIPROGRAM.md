# 微信小程序适配说明

**发布与审核全流程**（账号、上传、提审、上线、回滚）见 **[WECHAT_RELEASE.md](./WECHAT_RELEASE.md)**。

## 1. 概述

`miniprogram/` 目录是 Open Block 的**微信小程序适配版本**，与 `web/` 共享核心游戏逻辑，
但 UI 层、存储、网络和渲染全部适配了微信小程序平台。

### 设计原则

- **逻辑复用**：棋盘规则、形状数据、得分计算、RL 特征等从 `web/src/` 自动同步
- **平台隔离**：所有浏览器 API（DOM、Canvas、localStorage、fetch）通过 `adapters/` 桥接
- **零 npm 依赖**：纯小程序原生开发，不依赖任何第三方包

## 2. 目录结构

```
miniprogram/
├── app.js                    # 小程序入口
├── app.json                  # 全局配置（页面路由、窗口样式）
├── app.wxss                  # 全局样式（CSS 变量定义）
├── envConfig.js              # 环境配置（替代 Vite import.meta.env）
├── project.config.json       # 微信开发者工具项目配置
├── sitemap.json              # 搜索收录
│
├── adapters/                 # ★ 平台适配层
│   ├── storage.js            # localStorage → wx.setStorageSync
│   ├── network.js            # fetch → wx.request（Promise 封装）
│   └── platform.js           # 屏幕尺寸、振动反馈、Toast 等
│
├── core/                     # ★ 从 web/src 自动同步的纯逻辑（ES→CJS）+ 小程序手写对齐层
│   ├── grid.js               # 棋盘与消行
│   ├── shapes.js             # 形状数据
│   ├── gameRules.js          # 游戏规则（来自 shared/game_rules.json）
│   ├── config.js             # 策略配置（已适配小程序存储）
│   ├── difficulty.js          # 动态难度
│   ├── adaptiveSpawn.js      # 自适应出块
│   ├── hintEngine.js         # 提示引擎
│   ├── bonusScoring.js       # 同色/同 icon bonus 计分与检测（手写对齐）
│   ├── skins.js              # Web 皮肤核心字段（36 款，脚本同步；详见 docs/SKINS_CATALOG.md）
│   ├── levelManager.js       # 关卡目标/星级/失败判定
│   ├── levelPack.js          # 20 关关卡包（CJS）
│   ├── game_rules.json       # 共享规则数据
│   ├── shapes.json           # 共享形状数据
│   └── bot/                  # RL / Bot 逻辑
│       ├── blockSpawn.js
│       ├── simulator.js
│       ├── features.js
│       └── gameEnvironment.js
│
├── utils/                    # ★ 小程序专用工具
│   ├── renderer.js           # Canvas 2D 渲染器（画棋盘、方块、幽灵）
│   └── gameController.js     # 游戏控制器（纯逻辑，不操作 UI）
│
└── pages/
    ├── index/                # 主菜单页
    │   ├── index.wxml
    │   ├── index.wxss
    │   └── index.js
    └── game/                 # 游戏页面
        ├── game.wxml         # Canvas 棋盘 + Dock 候选块 + 结算弹窗
        ├── game.wxss
        ├── game.js           # Touch 拖拽放置 + Canvas 重绘
        └── game.json
```

## 3. 快速开始

### 3.1 前置条件

- [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)（最新稳定版）
- 已注册微信小程序（或使用测试号）

### 3.2 初始化

```bash
# 1. 同步核心逻辑（从 web/src → miniprogram/core）
bash scripts/sync-core.sh

# 2. （可选）配置后端 API
# 编辑 miniprogram/envConfig.js，填入后端地址

# 3. 用微信开发者工具打开 miniprogram/ 目录
```

### 3.3 在微信开发者工具中

1. 选择「导入项目」
2. 目录选择 `miniprogram/`
3. AppID 填写你的小程序 ID（或选择测试号）
4. 点击「确定」→ 自动编译 → 预览

## 4. 架构说明

### 4.1 模块复用策略

```
┌─────────────────────────────────────────────┐
│                 shared/                      │
│   game_rules.json   shapes.json              │
└──────────┬──────────────────┬───────────────┘
           │                  │
     ┌─────▼─────┐    ┌──────▼──────┐
     │  web/src   │    │ miniprogram │
     │ (ES Module)│    │ (CommonJS)  │
     │            │    │             │
     │ grid.js ───┼────► core/grid.js│
     │ shapes.js ─┼────► core/shapes │
     │ config.js ─┼──X─► core/config │ ← 需适配 storage/env
     │ renderer ──┼──X─► utils/render│ ← 完全重写
     │ game.js ───┼──X─► gameControl │ ← 完全重写
     └────────────┘    └─────────────┘

     ─── = 自动同步（sync-core.sh）
     ─X─ = 手写适配
```

### 4.2 适配层映射

| Web API | 小程序 API | 适配文件 |
|---------|-----------|---------|
| `localStorage.getItem` | `wx.getStorageSync` | `adapters/storage.js` |
| `localStorage.setItem` | `wx.setStorageSync` | `adapters/storage.js` |
| `fetch(url, opts)` | `wx.request(opts)` | `adapters/network.js` |
| `import.meta.env.VITE_*` | `require('./envConfig')` | `envConfig.js` |
| `document.createElement` | WXML 模板 | 各 page 的 `.wxml` |
| `canvas.getContext('2d')` | `Canvas.getContext('2d')` | `utils/renderer.js` |
| `requestAnimationFrame` | `canvas.requestAnimationFrame` | `pages/game/game.js` |
| `navigator.vibrate` | `wx.vibrateShort` | `adapters/platform.js` |
| `window.innerWidth` | `wx.getWindowInfo()` | `adapters/platform.js` |

### 4.3 渲染方案

游戏棋盘使用**小程序 Canvas 2D**（非旧版 `wx.createCanvasContext`），
通过 `<canvas type="2d">` 组件获取原生 Canvas 实例。

渲染流程：
```
touch 事件 → 计算网格坐标 → controller.place() → 更新状态 → renderer.drawGrid() → Canvas 刷新
```

当前小程序渲染层已对齐 Web 端主要棋盘体验：

- `blockIcons`：从 `core/skins.js` 读取，并在棋盘/候选块 Canvas 中绘制 emoji 图标。
- 消行动画链：`setClearCells` 闪白、`triggerComboFlash`、`triggerPerfectFlash`、`triggerDoubleWave`、`triggerBonusMatchFlash`、`addBonusLineBurst` 粒子与 `setShake` 震屏。
- 顶栏：得分 / 步数 / 消行 / 最佳使用三行栅格，`bestGap` 通过 `wx.setStorageSync` 记录的 `openblock_best_<strategyId>` 计算。

### 4.4 操作方式

- **拖拽放置**：长按 dock 候选块 → 拖到棋盘上 → 松手放置
- **幽灵预览**：拖拽时在合法位置显示半透明预览
- **振动反馈**：消行时触发短振动

## 5. 同步核心逻辑

### 自动同步

```bash
bash scripts/sync-core.sh
```

### 与 Web 对齐的手写层（发布前建议 diff）

| 能力 | Web | 小程序 |
|------|-----|--------|
| 整行/列同色 bonus 加分 | `web/src/game.js`（`computeClearScore`） | `miniprogram/core/bonusScoring.js` + `utils/gameController.js` |
| 同色 bonus 粒子 | `web/src/renderer.js`（`addBonusLineBurst` 等） | `miniprogram/utils/renderer.js` + `pages/game/game.js`（`requestAnimationFrame`） |
| 顶栏三行栅格 / 最佳与分差 | `web/index.html` + `main.css` | `pages/game/game.wxml` + `game.wxss`；最佳分 `wx.setStorageSync` 键名 `openblock_best_<strategyId>` |
| 皮肤 `blockIcons` / 颜色 / 网格字段 | `web/src/skins.js` | `miniprogram/core/skins.js`；用 `scripts/sync-miniprogram-skins.cjs` 从 Web 同步 36 款（详见 [SKINS_CATALOG.md](../product/SKINS_CATALOG.md)） |
| 关卡模式 | `web/src/level/levelManager.js` + `levelPack.js` | `miniprogram/core/levelManager.js` + `levelPack.js`；菜单页可选 20 关 |
| 出块保命策略 | `web/src/bot/blockSpawn.js` + `adaptiveSpawn.js` | `miniprogram/core/bot/blockSpawn.js` + `adaptiveSpawn.js`；危险态严格可解性与无消行救援态同步 |

### 自动同步脚本行为

该脚本执行以下操作：
1. 复制 `shared/game_rules.json` 和 `shared/shapes.json` 到 `core/`
2. 复制 10 个纯逻辑 JS 文件到 `core/`
3. 自动将 `export/import` 转换为 `module.exports/require`
4. 修正 JSON 文件引用路径

### 何时需要重新同步

- 修改了 `web/src/grid.js`、`shapes.js` 等核心逻辑
- 修改了 `shared/game_rules.json`（策略、得分、形状权重）
- 新增了 bot/RL 特征或模拟器改动
- 修改了 `web/src/skins.js` 中皮肤核心字段时，运行：
  ```bash
  node scripts/sync-miniprogram-skins.cjs
  ```
  该脚本会同步 `id/name/blockColors/blockIcons/gridOuter/gridCell/gridGap/blockInset/blockRadius/blockStyle/clearFlash` 到 `miniprogram/core/skins.js`。

### 不需要同步的

- `web/src/renderer.js` → 小程序版在 `utils/renderer.js`
- `web/src/game.js` → 小程序版在 `utils/gameController.js` + `pages/game/game.js`
- `web/src/skins.js` → 通过 `scripts/sync-miniprogram-skins.cjs` 同步核心渲染字段，UI CSS 变量仍由小程序样式自行管理
- 所有 DOM 操作的 UI 模块

### 小程序关卡模式

`miniprogram/core/levelPack.js` 当前包含 Web 同款 20 关，菜单页通过 picker 选择关卡后以 `mode=level&levelId=Lxx` 进入 `pages/game/game`。

关卡目标字段兼容两种格式：

| Web 关卡字段 | 小程序解释 |
|--------------|------------|
| `objective.type = 'score'` + `target` | 达到目标分数通关 |
| `objective.type = 'clear'` + `target` | 累计消行达到目标通关 |
| `objective.type = 'survival'` + `minRounds` | 出块轮数达到目标通关 |
| `maxRounds` / `maxPlacements` | 超限失败 |
| `starThresholds` | 1/2/3 星门槛 |

## 6. 后端连接（可选）

如果需要连接 Flask 后端进行 RL 训练：

### 6.1 配置

编辑 `miniprogram/envConfig.js`：
```javascript
module.exports = {
  apiBaseUrl: 'https://your-server.com',
  syncBackend: false,
  usePytorchRl: true,
};
```

### 6.2 域名白名单

在微信公众平台 → 开发管理 → 服务器域名中添加：
- request 合法域名：`https://your-server.com`

### 6.3 网络请求

所有后端请求通过 `adapters/network.js` 的 `request()` / `postJson()` 函数发出，
内部使用 `wx.request`，自动处理 JSON 序列化/反序列化。

## 7. 扩展指南

### 7.1 添加皮肤

在 `utils/renderer.js` 中的 `DEFAULT_SKIN` 或新建皮肤数据文件：
```javascript
const CYBER_SKIN = {
  blockColors: ['#00E8C8', '#F52885', ...],
  gridOuter: '#0e0424',
  gridCell: '#18103A',
  blockStyle: 'neon',
  ...
};
renderer.setSkin(CYBER_SKIN);
```

### 7.2 添加分享功能

在 `pages/game/game.js` 中添加：
```javascript
onShareAppMessage() {
  return {
    title: `Open Block - 我拿了 ${this.data.score} 分！`,
    path: '/pages/index/index',
  };
},
```

### 7.3 添加排行榜

使用微信小程序云开发或自有后端：
```javascript
// 游戏结束时提交分数
const { postJson } = require('../../adapters/network');
postJson('/api/leaderboard', { score: this.data.score, openId: '...' });
```

### 7.4 添加 RL Bot 对战

复用 `core/bot/` 中的模拟器和特征提取：
```javascript
const { OpenBlockSimulator } = require('../../core/bot/simulator');
const { buildDecisionBatch } = require('../../core/bot/features');
// 本地推理或调用后端 /api/rl/select_action
```

## 8. 已知限制

| 限制 | 原因 | 解决方案 |
|------|------|---------|
| 无 RL 本地训练 | 小程序不支持 PyTorch / WebGL | 连接后端 API 训练 |
| 无回放系统 | DOM 面板不可用 | 未来可用小程序 Canvas 实现 |
| Canvas 性能 | 小程序 Canvas 2D 性能弱于浏览器 | 减少重绘频率 + 局部重绘 |
| 旧版微信 | Canvas 2D 需基础库 ≥ 2.9.0 | `app.json` 中设置最低版本 |

## 9. 文件大小估算

| 部分 | 估计大小 |
|------|---------|
| core/ 纯逻辑 | ~80 KB |
| adapters/ | ~3 KB |
| utils/ | ~8 KB |
| pages/ WXML+WXSS+JS | ~12 KB |
| JSON 数据 | ~15 KB |
| **总计** | **~118 KB** |

远小于微信小程序 2MB 主包限制。
