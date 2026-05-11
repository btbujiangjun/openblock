# 微信小程序适配说明

**发布与审核全流程**（账号、上传、提审、上线、回滚）见 **[WECHAT_RELEASE.md](./WECHAT_RELEASE.md)**。

## 1. 当前定位

`miniprogram/` 是 Open Block 的微信小程序玩家端轻量版本，只包含：

- 游戏主体功能：主菜单、难度选择、棋盘、候选块拖拽、消行计分、最佳分、本地重开。
- 皮肤：复用 Web 端核心皮肤字段，支持颜色、图标、白色系手机盘面和主题水印。
- 语言设置：主菜单和游戏页内置简体中文 / English，本地存储选择；皮肤名也随语言切换。
- 音效反馈：程序化生成短音效，主菜单与游戏页共享同一音效开关。

小程序包不包含模型训练、RL 自博弈、模型状态监控、训练看板、后端同步或运营监控入口。

## 2. 目录结构

```text
miniprogram/
├── app.js
├── app.json
├── app.wxss
├── project.config.json
├── sitemap.json
├── adapters/
│   ├── platform.js
│   ├── storage.js
│   └── storageShim.js
├── core/
│   ├── bonusScoring.js
│   ├── adaptiveSpawn.js
│   ├── boardTopology.js
│   ├── config.js
│   ├── difficulty.js
│   ├── gameRulesData.js
│   ├── gameRules.js
│   ├── grid.js
│   ├── i18n.js
│   ├── playerAbilityModel.js
│   ├── playerProfile.js
│   ├── shapes.js
│   ├── shapesData.js
│   ├── skins.js
│   └── bot/
│       └── blockSpawn.js
├── utils/
│   ├── audioFx.js
│   ├── gameController.js
│   ├── mahjongTileIcon.js
│   └── renderer.js
└── pages/
    ├── index/
    └── game/
```

## 3. 运行与预览

1. 安装并打开 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 选择「导入项目」，目录选择 `miniprogram/`。
3. AppID 填写正式小程序 ID，或选择测试号。
4. 编译后点击「预览」生成二维码。

仓库内 `project.config.json` 当前未写入正式 AppID；如果本机未配置微信开发者工具 CLI 或未登录，命令行无法直接生成预览二维码。

## 4. 功能边界

| 保留 | 说明 |
|------|------|
| 核心玩法 | 8x8 棋盘、三块 dock、拖拽放置、智能释放、消行、同色/同 icon bonus、清屏/连消/大爆炸特效 |
| 出块 | `core/adaptiveSpawn.js` + `core/bot/blockSpawn.js`，同步 Web 规则轨自适应策略与可玩性 guard；不包含 `model-v3` 和诊断面板 |
| 玩家画像 | `core/playerProfile.js` 与 Web 同源，`utils/gameController.js` 串接 `recordNewGame / recordSpawn / recordPlace / recordSessionEnd / save`；持久化经 `adapters/storageShim.js` 桥到 `wx.*StorageSync` |
| 难度 | 简单、普通、挑战三档，来自 `core/gameRulesData.js` |
| 皮肤 | `core/skins.js`，34 套皮肤经过手机端白色盘面、方块对比度和主题水印优化 |
| 语言 | `core/i18n.js`，本地存储键 `openblock_lang`；包含皮肤名 `zh-CN` / `en` 翻译 |
| 音效 | `utils/audioFx.js`，运行时合成 WAV；主菜单与游戏页共享 `openblock_audiofx_v1` |
| 本地数据 | 最佳分、皮肤、语言、音效偏好使用 `wx.*StorageSync` |

| 不包含 | 说明 |
|--------|------|
| RL 训练 | 不包含 feature encoder、self-play simulator、training environment、curriculum |
| 模型状态 | 不包含 `/api/rl/status`、模型 checkpoint 状态或训练日志 |
| 监控看板 | 不包含算法/运营/商业化状态监控页 |
| 后端同步 | 不包含 `envConfig.js`、`network.js`、API Base URL 或 Flask 同步入口 |
| 关卡实验 | 当前小程序只保留无尽游戏主体，不包含关卡包和星级目标 |

## 5. 维护说明

皮肤字段变化时运行：

```bash
node scripts/sync-miniprogram-skins.cjs
```

玩法策略或形状变化时，小程序不再直接携带 JSON 文件，而是使用 CommonJS 数据模块：

- `core/gameRulesData.js`：来自 `shared/game_rules.json` 的玩家端裁剪数据。
- `core/shapesData.js`：来自 `shared/shapes.json` 的形状数据。
- `core/adaptiveSpawn.js` / `core/bot/blockSpawn.js`：由 `scripts/sync-core.sh` 从 Web 规则轨纯逻辑生成；同步时排除生成式模型、训练环境和面板。
- `core/playerProfile.js`：同样由 `scripts/sync-core.sh` 同步，原 `localStorage` 调用通过 `adapters/storageShim.js` 在 `app.js onLaunch` 阶段安装的 `globalThis.localStorage` 垫片落到 `wx.*StorageSync`，无需逐字段改写。

不要直接复制完整 `shared/game_rules.json` 到小程序包内，因为其中包含 RL 训练、特征编码和看板相关元数据；直接 `require` JSON 也可能在微信开发工具中被解析为 `.json.js` 并造成模块加载问题。

核心玩法同步脚本：

```bash
bash scripts/sync-core.sh
```

该脚本会生成 `gameRulesData.js` / `shapesData.js`，并把 Web 端纯逻辑模块转换为小程序可用的 CommonJS 形式。

## 6. 验证

小程序核心改动至少运行：

```bash
node --check miniprogram/pages/game/game.js
node --check miniprogram/utils/renderer.js
npm test -- tests/miniprogramCore.test.js
```

`tests/miniprogramCore.test.js` 覆盖计分口径、启发式出块 guard、34 套皮肤手机端可读性、主题水印和皮肤名 i18n。
