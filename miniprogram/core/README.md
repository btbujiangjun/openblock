# core/ — 从 web/src 复用的纯逻辑模块

本目录的文件由构建脚本 `scripts/sync-core.sh` 从 `web/src/` 自动同步而来。

另有一类文件属于“小程序手写对齐层”：它们不是 `sync-core.sh` 的输出，但会对齐 Web 端能力（例如皮肤、关卡、bonus 计分与动画触发）。这类文件需要在相关 Web 能力变更后人工检查或运行专用同步脚本。

## 同步规则

| 源文件 (web/src/) | 目标 (miniprogram/core/) | 改动 |
|---|---|---|
| `grid.js` | `grid.js` | `export class` → `module.exports` |
| `shapes.js` | `shapes.js` | 同上 + JSON import 改 require |
| `gameRules.js` | `gameRules.js` | 同上 |
| `config.js` | `config.js` | `import.meta.env` → `require('../envConfig')` + `localStorage` → `require('../adapters/storage')` |
| `difficulty.js` | `difficulty.js` | ES → CJS |
| `adaptiveSpawn.js` | `adaptiveSpawn.js` | ES → CJS |
| `hintEngine.js` | `hintEngine.js` | ES → CJS |
| `bot/blockSpawn.js` | `bot/blockSpawn.js` | ES → CJS |
| `bot/simulator.js` | `bot/simulator.js` | ES → CJS |
| `bot/features.js` | `bot/features.js` | ES → CJS |
| `bot/gameEnvironment.js` | `bot/gameEnvironment.js` | ES → CJS |

以下文件**不**由 `sync-core.sh` 同步，需与 Web 行为对齐时人工对照维护：

| 说明 | 路径 |
|------|------|
| 消行同色 bonus 加分（与 `web/src/game.js` 中 `computeClearScore` 等一致） | `bonusScoring.js` |
| 皮肤核心渲染字段（26 款；含 `blockIcons`） | `skins.js`（由 `scripts/sync-miniprogram-skins.cjs` 生成） |
| 关卡目标/星级/失败判定 | `levelManager.js` |
| Web 同款 20 关关卡包（CJS 版） | `levelPack.js` |

## 常用同步命令

```bash
# 同步共享规则、形状、出块/难度/提示/RL 纯逻辑
bash scripts/sync-core.sh

# 同步 web/src/skins.js 的核心皮肤字段到小程序
node scripts/sync-miniprogram-skins.cjs
```

`sync-core.sh` 会覆盖 `adaptiveSpawn.js`、`bot/blockSpawn.js` 等文件；若 Web 端刚修过出块算法，先运行脚本，再确认小程序端语法：

```bash
node --check miniprogram/core/adaptiveSpawn.js
node --check miniprogram/core/bot/blockSpawn.js
```

## 手动操作

如果不使用构建脚本，手动将上述文件复制到 `core/` 并执行以下替换：

1. `export function X` → `function X` + 文件末尾 `module.exports = { X }`
2. `export class X` → `class X` + 文件末尾 `module.exports = { X }`
3. `export const X` → `const X` + 文件末尾 `module.exports = { X }`
4. `import { A } from './B.js'` → `const { A } = require('./B')`
5. `import DATA from '../shared/X.json'` → `const DATA = require('../../shared/X.json')`
6. `import.meta.env.VITE_XXX` → `require('../envConfig').xxx`
7. `localStorage` → `require('../adapters/storage')`
