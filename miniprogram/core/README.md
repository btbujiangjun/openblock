# core/ — 从 web/src 复用的纯逻辑模块

本目录的文件由构建脚本 `scripts/sync-core.sh` 从 `web/src/` 自动同步而来。

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

## 手动操作

如果不使用构建脚本，手动将上述文件复制到 `core/` 并执行以下替换：

1. `export function X` → `function X` + 文件末尾 `module.exports = { X }`
2. `export class X` → `class X` + 文件末尾 `module.exports = { X }`
3. `export const X` → `const X` + 文件末尾 `module.exports = { X }`
4. `import { A } from './B.js'` → `const { A } = require('./B')`
5. `import DATA from '../shared/X.json'` → `const DATA = require('../../shared/X.json')`
6. `import.meta.env.VITE_XXX` → `require('../envConfig').xxx`
7. `localStorage` → `require('../adapters/storage')`
