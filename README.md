# OpenBlock

> 开源网页方块益智游戏 · 自适应出块引擎 · 强化学习训练平台 · 可插拔商业化框架

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org)
[![Python](https://img.shields.io/badge/Python-3.10%2B-blue)](https://python.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

[English](#english) · [中文说明](#中文说明) · [文档中心](docs/README.md) · [架构文档](ARCHITECTURE.md) · [二次开发](./docs/engineering/DEV_GUIDE.md)

---

## English

### What is OpenBlock?

OpenBlock is an open-source block-puzzle game (inspired by 1010!/Block Blast) built as a **research and customization platform**. Beyond the game itself, it provides:

- **Adaptive Spawn Engine** — 10-signal stress fusion drives real-time difficulty adjustment
- **Reinforcement Learning Pipeline** — browser-based linear agent + PyTorch/MLX residual network training
- **Pluggable Monetization Framework** — event-bus-driven IAA/IAP modules with hot-swap adapters
- **Player Insight System** — real-time skill/flow/frustration profiling with commercial segmentation
- **SQLite Analytics Backend** — session, behavior, score, and replay persistence via Flask API

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Vite + ESM)                    │
│                                                                 │
│  ┌──────────┐  ┌───────────────┐  ┌──────────────────────────┐  │
│  │  Game    │  │ Player System │  │   Spawn Engine           │  │
│  │ game.js  │→ │ playerProfile │→ │ adaptiveSpawn.js         │  │
│  │ grid.js  │  │ progression   │  │ blockSpawn.js            │  │
│  │ renderer │  │ insightPanel  │  │ spawnModel.js            │  │
│  └────┬─────┘  └───────────────┘  └──────────────────────────┘  │
│       │                                                         │
│       ▼  logBehavior (non-invasive hook)                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              MonetizationBus (Event Hub)                │    │
│  │  on('game_over'|'no_clear'|'spawn_blocks'|...)          │    │
│  └──────┬────────┬──────────┬──────────┬───────────────────┘    │
│         │        │          │          │                         │
│    adTrigger  iapAdapter  dailyTasks  personalization           │
│    seasonPass leaderboard replayShare commercialInsight         │
│         │                                                        │
│    featureFlags (localStorage, hot-toggle)                      │
└────────────────────────┬────────────────────────────────────────┘
                         │ REST API
┌────────────────────────▼────────────────────────────────────────┐
│                     Backend (Flask + SQLite)                     │
│  /api/session  /api/behavior  /api/score  /api/stats            │
│  /api/mon/*    /api/rl/*      /api/spawn-model/*  /docs/*       │
│  monetization_backend.py  rl_backend.py  server.py              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Extension Points

| Point | Interface | Guide |
|-------|-----------|-------|
| **Ad SDK** | `setAdProvider({showRewarded, showInterstitial})` | [Strategy Guide](./docs/engineering/STRATEGY_GUIDE.md#4-广告策略定制-ad-sdk) |
| **IAP SDK** | `setIapProvider({purchase, restore, isPurchased})` | [Strategy Guide](./docs/engineering/STRATEGY_GUIDE.md#5-iap-策略定制-iap-sdk) |
| **Spawn Strategy** | `game_rules.json` + `spawnHints` hooks | [Strategy Guide](./docs/engineering/STRATEGY_GUIDE.md#1-出块策略定制) |
| **Monetization Module** | `MonetizationBus.on()` + feature flag | [Dev Guide](./docs/engineering/DEV_GUIDE.md#2-新增商业化模块) |
| **RL Reward** | `RL_REWARD_SHAPING` in `game_rules.json` | [Dev Guide](./docs/engineering/DEV_GUIDE.md#7-自定义-rl-奖励函数) |
| **Difficulty Mode** | `difficultyBias` + `adaptiveSpawn.profiles` | [Strategy Guide](./docs/engineering/STRATEGY_GUIDE.md#3-难度模式定制) |

### Quick Start

**Prerequisites**: Node.js 18+, Python 3.10+

```bash
# Clone and install
git clone https://github.com/your-org/openblock.git
cd openblock
npm install
pip install -r requirements.txt

# Development (two terminals)
npm run dev      # Vite dev server → http://localhost:3000
npm run server   # Flask API      → http://localhost:5000

# Or configure via .env
cp .env.example .env
```

**Game only** (no backend required):
```bash
npm run dev
# Visit http://localhost:3000 — runs fully in browser
```

**With RL training**:
```bash
pip install -r requirements-rl.txt
npm run server:rl   # Flask + RL routes + auto-checkpoint
```

### Documentation

| Document | Description |
|----------|-------------|
| [docs/README.md](docs/README.md) | Documentation center with role-based paths for product, algorithm, architecture, operations, testing |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System layers, module boundaries, data flows |
| [docs/DOMAIN_KNOWLEDGE.md](./docs/domain/DOMAIN_KNOWLEDGE.md) | Game mechanics, flow theory, player psychology, RL and monetization concepts |
| [docs/ALGORITHMS_HANDBOOK.md](./docs/algorithms/ALGORITHMS_HANDBOOK.md) | Unified algorithm and model handbook |
| [docs/DEV_GUIDE.md](./docs/engineering/DEV_GUIDE.md) | Adding modules, extending strategies, integrating SDKs |
| [docs/TESTING.md](./docs/engineering/TESTING.md) | Test strategy, regression matrix, validation commands |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to contribute |

---

## 中文说明

### 项目简介

OpenBlock 是一个开源网页方块益智游戏（类 1010!/Block Blast），同时也是一个**研究与定制平台**，提供：

- **自适应出块引擎** — 10 维信号融合实时调节难度（心流、挫败、节奏、技能等）
- **强化学习训练平台** — 浏览器内线性 Agent + PyTorch/MLX 残差网络双轨训练
- **可插拔商业化框架** — 基于事件总线的 IAA/IAP 模块，广告/支付 SDK 热插拔
- **玩家洞察系统** — 实时技能/心流/挫败画像 + Whale/Dolphin/Minnow 商业分群
- **SQLite 分析后端** — 会话、行为、得分、回放全链路 Flask API 持久化

### 功能特点

**游戏核心**
- 8×8 网格，拖拽放置三连块，整行/列消除得分
- 三档难度（Easy / Normal / Hard）+ 自适应难度调节
- 实时玩家画像面板（技能、心流、节奏、挫败、近失）
- 落子建议（StrategyAdvisor + HintEngine）

**出块引擎**
- 三层架构：规则约束（Layer 1）→ 体验优化（Layer 2）→ 局内弧线（Layer 3）
- 10 信号 stress 融合：分数压力 / 连胜加成 / 技能调节 / 心流 / 节奏 / 恢复 / 挫败救济 / Combo 奖励 / 趋势 / 置信门控
- 可选 SpawnTransformer 模型推理（行为数据驱动）

**RL 训练**
- 浏览器端：线性 REINFORCE + 价值基线，实时看板
- PyTorch 端：残差双塔网络（DockBoardAttention + 直接监督头），MPS/CUDA/CPU
- MLX 端：Apple Silicon 原生加速
- 课程学习：`winThresholdStart=40 → 220`，40k 局爬坡

**商业化（可选，默认 Stub 模式）**
- 激励视频 / 插屏广告（SDK 热插拔）
- IAP 内购（月卡/周卡/礼包，Stub 可测试）
- 每日任务 / 排行榜 / 赛季通行证 / Web Push / 回放分享
- 个性化引擎：Whale/Dolphin/Minnow 分群 + 实时信号 → 策略推荐

### 目录结构

```
openblock/
├── web/                    # 前端（Vite + ESM）
│   ├── src/
│   │   ├── game.js         # 游戏主控制器
│   │   ├── grid.js         # 棋盘逻辑
│   │   ├── playerProfile.js# 玩家能力画像
│   │   ├── adaptiveSpawn.js# 自适应出块引擎
│   │   ├── bot/            # RL 自博弈（浏览器端）
│   │   └── monetization/   # 商业化模块（可插拔）
│   └── public/             # 静态资源
├── rl_pytorch/             # PyTorch RL 训练
├── rl_mlx/                 # MLX RL 训练（Apple Silicon）
├── shared/                 # 共享配置（game_rules.json, shapes.json）
├── miniprogram/            # 微信小程序适配
├── docs/                   # 技术文档（在线：/docs）
│   ├── README.md           # 文档中心：角色导航、权威地图、维护规范
│   ├── engineering/        # 工程指南、测试、i18n、策略定制
│   ├── domain/             # 领域知识、品类与竞品研究
│   ├── product/            # 玩法、计分、难度、皮肤与留存
│   ├── player/             # 玩家画像、面板参数、实时策略
│   ├── algorithms/         # 出块、RL、玩家模型、商业化算法
│   ├── operations/         # 商业化与运营
│   ├── platform/           # 小程序适配与发布
│   └── archive/            # 历史方案归档
├── ARCHITECTURE.md         # 系统架构
├── CONTRIBUTING.md         # 贡献指南
├── server.py               # Flask 后端
└── .env.example            # 环境配置模板
```

### 快速上手

```bash
# 克隆并安装
git clone https://github.com/your-org/openblock.git
cd openblock
npm install
pip install -r requirements.txt

# 开发模式（双终端）
npm run dev      # Vite 开发服务器 → http://localhost:3000
npm run server   # Flask API      → http://localhost:5000

# 仅玩游戏（无需后端）
npm run dev   # 全部功能在浏览器内运行

# 含 RL 训练
pip install -r requirements-rl.txt
npm run server:rl
```

### 配置说明

复制 `.env.example` 为 `.env`，主要配置项：

| 变量 | 默认 | 说明 |
|------|------|------|
| `VITE_PORT` | `3000` | Vite 开发服务器端口 |
| `OPENBLOCK_API_ORIGIN` | `http://localhost:5000` | 后端 API 地址 |
| `OPENBLOCK_DB_PATH` | `./openblock.db` | SQLite 数据库路径 |
| `RL_CHECKPOINT_SAVE` | `rl_checkpoints/bb_policy.pt` | RL checkpoint 路径 |
| `RL_DEVICE` | `auto` | 训练设备（auto/mps/cuda/cpu） |

### 二次开发

详细指南见 [docs/DEV_GUIDE.md](./docs/engineering/DEV_GUIDE.md)，快速参考：

```js
// 接入真实广告 SDK
import { setAdProvider } from './web/src/monetization/adAdapter.js';
setAdProvider({
    showRewarded: (reason) => AdMob.showRewarded(reason),
    showInterstitial: () => AdMob.showInterstitial(),
});

// 新增商业化模块
import { on } from './web/src/monetization/MonetizationBus.js';
on('game_over', ({ data, game }) => {
    // 在游戏结束时触发自定义逻辑，无需修改 game.js
});

// 自定义出块策略
// 修改 shared/game_rules.json 中的 adaptiveSpawn.profiles
// 即可调整 stress → 形状权重映射，无需修改引擎代码
```

### 贡献

欢迎 PR 和 Issue！请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。

### 开源协议

MIT License — 详见 [LICENSE](LICENSE)
