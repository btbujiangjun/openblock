# OpenBlock · Cocos Creator 客户端

与现有 **web 内核并行存在**的 Cocos Creator (TypeScript) 客户端。Web 端完全保留不动；
本目录是一套独立工程，复用同一份「引擎无关核心逻辑」（`assets/scripts/core`），
渲染/输入/平台层用 Cocos 重写。

## 运行（2 步，无需美术资源）

1. 用 **Cocos Creator 3.8.x** 打开本 `cocos/` 目录（首次打开会自动生成 `library/ temp/ settings/`）。
2. 双击打开已内置的场景 **`assets/scene/Game.scene`**（已配好 `Canvas + Camera`，并在 `Game`
   节点挂好 `Bootstrap`），点运行即可玩：盘面、候选区、拖拽放置、消行、计分、技能、结算/复活/转盘…

> 该场景已绑定 `Bootstrap`（通过脚本固定 uuid，见 `Bootstrap.ts.meta`）。若想自己搭：
> 新建场景 → `Canvas` 下建空节点 `Game` → 挂 `assets/scripts/game/Bootstrap.ts` → 运行。

> 全部 UI 由代码生成（`Graphics` + `Label`），不依赖任何图片/预制，便于先跑通核心循环，
> 美术资源在 Phase 2 再逐步替换。

## 目录结构

```
cocos/
├─ assets/scene/Game.scene  # 内置可直接运行的场景（Canvas+Camera+Bootstrap 已配好）
├─ assets/scripts/
│  ├─ core/                 # Phase 0：引擎无关核心（可被 web/小程序复用）
│  │  ├─ rng.ts             # 可复现 PRNG（移植 seededRng）
│  │  ├─ types.ts           # 共享类型
│  │  ├─ config.ts          # 计分/规则常量
│  │  ├─ shapesData.ts      # 40 形状数据（移植 shapesData）
│  │  ├─ shapes.ts          # 形状池 API（移植 shapes）
│  │  ├─ grid.ts            # 棋盘逻辑（移植 grid 核心子集）
│  │  ├─ scoring.ts         # 消行计分 + dock 颜色偏置（移植 bonusScoring）
│  │  ├─ skins.ts           # 皮肤/调色板（精简子集）
│  │  ├─ spawn.ts           # 出块策略（加权 + 同花偏置 + 可玩兜底）
│  │  ├─ economy.ts         # 钱包/虚拟货币
│  │  ├─ skills.ts          # 技能定义 + hint 纯逻辑
│  │  ├─ meta.ts            # 签到/任务/赛季
│  │  ├─ gameModel.ts       # 去 DOM 内核（事件 + undo/bomb/rainbow/freeze/存档）
│  │  └─ index.ts           # 统一出口
│  └─ game/                 # Cocos 表现/输入/平台层
│     ├─ Bootstrap.ts       # 代码优先启动器（构建整局）
│     ├─ GameController.ts  # 核心循环编排 + 拖拽 + 技能 + 存档
│     ├─ BoardView.ts / DockView.ts / Hud.ts
│     ├─ effects/           # LineClearFx / FxLayer（粒子+飘字）/ ScreenShake
│     ├─ audio/AudioManager.ts    # 程序化音效（WebAudio 合成）
│     ├─ skills/SkillBar.ts       # 技能栏（金币/选中态）
│     ├─ ui/               # TextButton / MetaPanel（签到任务）/ Tutorial（引导）
│     ├─ skin/palette.ts
│     └─ platform/          # Storage / Monetization / Haptics / Platform
│        ├─ CloudSave.ts          # 云存档接口（本地兜底）
│        └─ wechat/WechatAdapters.ts  # 微信广告/IAP 适配
├─ ROADMAP.md               # Phase 0→4 迁移映射与状态
└─ BUILD.md                 # Web / 微信小游戏 / 原生 导出指南
```

## 设计要点

- **唯一真源**：所有玩法规则只在 `core/` 实现一次；`GameModel` 以事件
  （`place / clear / score / dock / gameover`）对外广播，渲染端只负责画。
- **零资源可跑**：先保证「核心循环可玩」，再叠加美术/特效/音频。
- **平台无关**：`Storage` / `Monetization` / `AudioManager` 用接口隔离各端实现。

详见 [ROADMAP.md](./ROADMAP.md)。
