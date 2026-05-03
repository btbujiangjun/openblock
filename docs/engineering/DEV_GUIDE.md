# 二次开发指南

> 本文档面向希望在 OpenBlock 基础上进行定制开发的工程师。  
> 前置阅读：[ARCHITECTURE.md](../../ARCHITECTURE.md) · [STRATEGY_GUIDE.md](./STRATEGY_GUIDE.md) · 改界面文案/语言请读 [I18N.md](./I18N.md)

---

## 目录

1. [开发环境搭建](#1-开发环境搭建)
2. [新增商业化模块](#2-新增商业化模块)
3. [接入真实广告 SDK](#3-接入真实广告-sdk)
4. [接入真实 IAP SDK](#4-接入真实-iap-sdk)
5. [新增 Feature Flag](#5-新增-feature-flag)
6. [后端蓝图扩展](#6-后端蓝图扩展)
7. [自定义 RL 奖励函数](#7-自定义-rl-奖励函数)
8. [自定义课程学习](#8-自定义课程学习)
9. [扩展玩家画像信号](#9-扩展玩家画像信号)
10. [微信小程序适配](#10-微信小程序适配)
11. [测试指南](#11-测试指南)
12. [常见问题](#12-常见问题)

---

## 1. 开发环境搭建

### 基础安装

```bash
git clone https://github.com/your-org/openblock.git
cd openblock

# 前端
npm install

# 后端
pip install -r requirements.txt      # 基础（Flask + SQLite）
pip install -r requirements-rl.txt   # 可选（RL 训练）

# 环境配置
cp .env.example .env
# 编辑 .env 中的端口、API 地址等
```

### 开发模式

```bash
# 双进程模式（推荐）
npm run dev      # 终端 1：Vite，含热更新
npm run server   # 终端 2：Flask，含 auto-reload

# 文档中心
open http://localhost:3000/docs.html   # 通过 Vite 代理
open http://localhost:5000/docs        # 直接访问 Flask
```

### 目录约定

| 用途 | 位置 | 说明 |
|------|------|------|
| 新商业化模块 | `web/src/monetization/myModule.js` | 通过 MonetizationBus 驱动 |
| 新后端路由 | 新建 `my_backend.py` + Blueprint | 在 `server.py` 注册 |
| 新配置参数 | `shared/game_rules.json` | 前后端共享 |
| 新功能开关 | `web/src/monetization/featureFlags.js` | `FLAG_DEFAULTS` |
| 界面多语言 | `web/src/i18n/`（详见 [I18N.md](./I18N.md)） | 扁平键、`zh-CN` 回退、`AVAILABLE_LOCALES` |
| 新 RL 特征 | `web/src/bot/features.js` + `rl_pytorch/features.py` | 需保持同步 |

---

## 2. 新增商业化模块

商业化模块通过 `MonetizationBus` 订阅游戏事件，**完全不修改游戏核心代码**。

### 最小模板

```js
// web/src/monetization/myModule.js

/**
 * 我的商业化模块
 *
 * @module myModule
 * @description 在游戏结束时触发自定义逻辑
 */

import { on } from './MonetizationBus.js';
import { getFlag } from './featureFlags.js';

// 模块内部状态
let _initialized = false;

/**
 * 初始化模块
 * @returns {() => void} 清理函数（调用后停止所有订阅）
 */
export function initMyModule() {
    // Feature Flag 门控
    if (!getFlag('myModule')) return () => {};
    if (_initialized) return () => {};
    _initialized = true;

    // 订阅游戏事件
    const unsubGameOver = on('game_over', ({ data, game }) => {
        const { finalScore, totalClears } = data ?? {};
        console.log('[MyModule] Game over, score:', finalScore);
        // 在这里实现你的业务逻辑
    });

    const unsubNoCllear = on('no_clear', ({ data, game }) => {
        // 玩家放置方块但未消行时触发
    });

    // 返回清理函数
    return () => {
        unsubGameOver();
        unsubNoCllear();
        _initialized = false;
    };
}
```

### 注册到初始化流程

在 `web/src/monetization/index.js` 的 `initMonetization` 函数中添加：

```js
// 1. 引入新模块
import { initMyModule } from './myModule.js';

// 2. 在 initMonetization 中调用
export function initMonetization(game) {
    // ... 现有代码 ...

    // 添加你的模块（将清理函数加入 _cleanups）
    const myModuleCleanup = initMyModule();
    if (myModuleCleanup) _cleanups.push(myModuleCleanup);
}
```

### 可订阅的游戏事件

| 事件名 | 触发时机 | payload.data 包含 |
|--------|---------|------------------|
| `game_over` | 游戏结束 | `finalScore`, `totalClears`, `duration` |
| `no_clear` | 放置但未消行 | `boardFill`, `placement` |
| `spawn_blocks` | 新一轮出块 | `shapes`, `adaptiveInsight` |
| `place_block` | 每次放置方块 | `shape`, `position`, `cleared` |
| `game_start` | 游戏开始 | `strategy`, `userId` |
| `combo` | 触发连击 | `comboCount`, `linesCleared` |
| `achievement_unlock` | 解锁成就 | `achievementId` |

> 完整事件列表：`web/src/config.js` 中的 `GAME_EVENTS` 常量。

---

## 3. 接入真实广告 SDK

### AdMob 示例

```js
// web/src/main.js 或初始化文件

import { setAdProvider } from './monetization/adAdapter.js';
import { setFlag } from './monetization/featureFlags.js';

// 接入 AdMob（以 Google IMA SDK 为例）
function initRealAds() {
    setAdProvider({
        /**
         * 展示激励视频广告
         * @param {string} reason 触发原因
         * @returns {Promise<{ rewarded: boolean }>}
         */
        showRewarded: async (reason) => {
            return new Promise((resolve) => {
                // 使用真实 SDK
                AdMob.showRewarded({
                    adUnitId: 'ca-app-pub-xxx/yyy',
                    onRewarded: () => resolve({ rewarded: true }),
                    onDismissed: () => resolve({ rewarded: false }),
                    onFailed: () => resolve({ rewarded: false }),
                });
            });
        },

        /**
         * 展示插屏广告
         * @returns {Promise<void>}
         */
        showInterstitial: async () => {
            return new Promise((resolve) => {
                AdMob.showInterstitial({
                    adUnitId: 'ca-app-pub-xxx/zzz',
                    onDismissed: resolve,
                    onFailed: resolve,
                });
            });
        },
    });

    // 关闭 Stub 模式，开启广告
    setFlag('stubMode', false);
    setFlag('adsRewarded', true);
    setFlag('adsInterstitial', true);
}

// 在游戏初始化后调用
initRealAds();
```

### AppLovin MAX 示例

```js
setAdProvider({
    showRewarded: async (reason) => {
        return new Promise((resolve) => {
            AppLovinMAX.showRewardedAd('ad-unit-id', {
                onAdRevenuePaid: () => {},
                onAdHidden: (adInfo) => resolve({ rewarded: adInfo.isRewarded }),
                onAdLoadFailed: () => resolve({ rewarded: false }),
            });
        });
    },
    showInterstitial: async () => {
        return new Promise((resolve) => {
            AppLovinMAX.showInterstitialAd('ad-unit-id', {
                onAdHidden: resolve,
                onAdLoadFailed: resolve,
            });
        });
    },
});
```

---

## 4. 接入真实 IAP SDK

```js
// web/src/main.js

import { setIapProvider } from './monetization/iapAdapter.js';

setIapProvider({
    /**
     * 发起购买
     * @param {string} productId 产品ID（'remove_ads' | 'starter_pack' | 'weekly_pass' | 'monthly_pass'）
     * @returns {Promise<{ success: boolean, receipt?: string }>}
     */
    purchase: async (productId) => {
        try {
            const result = await YourIAPSDK.purchase(productId);
            return { success: true, receipt: result.receipt };
        } catch (e) {
            return { success: false };
        }
    },

    /**
     * 恢复已购项目
     * @returns {Promise<string[]>} 已购 productId 列表
     */
    restore: async () => {
        const purchases = await YourIAPSDK.restorePurchases();
        return purchases.map(p => p.productId);
    },

    /**
     * 检查是否已购
     * @param {string} productId
     * @returns {boolean}
     */
    isPurchased: (productId) => {
        return YourIAPSDK.hasPurchase(productId);
    },
});
```

---

## 5. 新增 Feature Flag

在 `web/src/monetization/featureFlags.js` 的 `FLAG_DEFAULTS` 中添加：

```js
export const FLAG_DEFAULTS = {
    // ... 现有 flags ...

    /** 我的新功能（默认关闭，需显式开启） */
    myNewFeature: false,
};
```

然后在你的模块中使用：

```js
import { getFlag } from './featureFlags.js';

if (getFlag('myNewFeature')) {
    // 功能逻辑
}
```

用户/开发者可通过以下方式开关：

```js
// 代码方式
import { setFlag } from './monetization/featureFlags.js';
setFlag('myNewFeature', true);

// 或通过训练面板 UI（monPanel.js 会自动展示所有 flags）
// 访问右下角「商业化训练面板」→「功能开关」标签
```

---

## 6. 后端蓝图扩展

推荐将新后端功能封装为 Flask Blueprint，在 `server.py` 末尾注册：

```python
# my_backend.py

from flask import Blueprint, request, jsonify
import sqlite3
from pathlib import Path

def create_my_blueprint() -> Blueprint:
    bp = Blueprint('my', __name__)

    @bp.route('/api/my/data', methods=['GET'])
    def my_data():
        """查询我的数据。"""
        user_id = request.args.get('user_id')
        if not user_id:
            return jsonify({'error': 'user_id required'}), 400

        db_path = Path(__file__).parent / 'openblock.db'
        with sqlite3.connect(str(db_path)) as db:
            db.row_factory = sqlite3.Row
            rows = db.execute(
                'SELECT * FROM my_table WHERE user_id = ? LIMIT 100',
                (user_id,)
            ).fetchall()

        return jsonify([dict(r) for r in rows])

    return bp


def init_my_db():
    """初始化数据库表（幂等）。"""
    db_path = Path(__file__).parent / 'openblock.db'
    with sqlite3.connect(str(db_path)) as db:
        db.execute('''
            CREATE TABLE IF NOT EXISTS my_table (
                id      INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT    NOT NULL,
                data    TEXT    NOT NULL,
                ts      INTEGER DEFAULT (strftime('%s','now'))
            )
        ''')
        db.commit()
```

在 `server.py` 注册：

```python
# server.py 末尾（init_db() 调用之后）

try:
    from my_backend import create_my_blueprint, init_my_db
    app.register_blueprint(create_my_blueprint())
    with app.app_context():
        init_my_db()
except Exception as e:
    print('My API (/api/my/*) 未启用:', e)
```

---

## 7. 自定义 RL 奖励函数

在 `shared/game_rules.json` 中修改 `RL_REWARD_SHAPING` 节点，无需修改 Python 代码：

```json
{
  "RL_REWARD_SHAPING": {
    "clearReward": 1.0,
    "multiClearBonus": 0.5,
    "comboBonus": 0.3,
    "gameOverPenalty": -2.0,
    "winBonus": 35,
    "stuckPenalty": -8.0,
    "potentialShaping": {
      "enabled": true,
      "coef": 0.8,
      "heightPenalty": 0.1
    },
    "outcome_mix": 0.5
  }
}
```

若需要更复杂的奖励逻辑（如自定义奖励函数），在 `rl_pytorch/game_rules.py` 中扩展：

```python
# rl_pytorch/game_rules.py

def custom_reward(state: dict, action: dict, next_state: dict) -> float:
    """自定义奖励函数示例。"""
    base = RL_REWARD_SHAPING.get('clearReward', 1.0) * next_state['clears']

    # 添加自定义奖励项
    if next_state.get('combo', 0) >= 3:
        base += 0.5  # 超长连击额外奖励

    return base
```

---

## 8. 自定义课程学习

在 `shared/game_rules.json` 中配置课程参数：

```json
{
  "rlCurriculum": {
    "comment": "胜利门槛从 start 线性爬升到 winScoreThreshold，历时 rampEpisodes 局",
    "enabled": true,
    "winThresholdStart": 40,
    "winThresholdEnd": 220,
    "rampEpisodes": 40000
  }
}
```

动态课程（根据胜率调整）：需修改 `rl_pytorch/game_rules.py` 的 `rl_win_threshold_for_episode()` 函数。

---

## 9. 扩展玩家画像信号

在 `web/src/playerProfile.js` 的 `PlayerProfile` 类中添加新的信号 getter：

```js
// web/src/playerProfile.js

/**
 * 自定义信号：玩家是否处于「冲分模式」
 * 判断依据：近 5 步清行率 > 80%
 * @returns {boolean}
 */
get isScoringMode() {
    const recent = this._moves.slice(-5);
    if (recent.length < 5) return false;
    const clearRate = recent.filter(m => m.cleared).length / recent.length;
    return clearRate > 0.8;
}
```

然后在 `adaptiveSpawn.js` 中使用此信号（参考现有的 `frustrationRelief` 逻辑）：

```js
// web/src/adaptiveSpawn.js

// 在 stress 计算部分添加
const scoringBonus = profile.isScoringMode ? 0.1 : 0;  // 冲分模式加压
stress += scoringBonus;
```

如需在个性化引擎中展示，在 `personalization.js` 的 `updateRealtimeSignals` 中添加：

```js
export function updateRealtimeSignals(profile) {
    if (!profile) return;
    _state.realtimeSignals = {
        // ... 现有信号 ...
        isScoringMode: profile.isScoringMode ?? false,  // 新增
    };
}
```

---

## 10. 微信小程序适配

小程序核心逻辑与 Web 版共享（`miniprogram/core/` 镜像自 `web/src/`）。**提审与正式发布流程**见 [WECHAT_RELEASE.md](../platform/WECHAT_RELEASE.md)。

适配新功能步骤：
1. 在 `web/src/` 开发并测试功能
2. 将相关逻辑复制到 `miniprogram/core/`（或通过 `sync-core.sh` 同步）
3. 使用 `miniprogram/adapters/` 中的适配器替换 Web API（`localStorage` → Storage API 等）

常用同步命令：

```bash
# 核心规则/出块/难度/提示/RL 逻辑
bash scripts/sync-core.sh

# Web 皮肤核心字段（含 blockIcons）→ 小程序
node scripts/sync-miniprogram-skins.cjs
```

同步后建议至少检查：

```bash
node --check miniprogram/core/adaptiveSpawn.js
node --check miniprogram/core/bot/blockSpawn.js
node --check miniprogram/core/skins.js
node --check miniprogram/pages/game/game.js
```

当前小程序已对齐的 Web 能力包括：36 款皮肤（其中 26 款带 `blockIcons`，全局 208 个 emoji 唯一）、20 关关卡包、同色/同 icon bonus 计分、完整消行动画链，以及出块危险态保命策略。皮肤详情见 [SKINS_CATALOG.md](../product/SKINS_CATALOG.md)。

适配器接口参见 [WECHAT_MINIPROGRAM.md](../platform/WECHAT_MINIPROGRAM.md)。

---

## 11. 测试指南

### 运行测试

```bash
npm test                              # 全量测试
npm test -- tests/monetization.test.js  # 单文件
npm test -- --reporter=verbose       # 详细输出
npm run lint                         # 代码检查
```

### 测试商业化模块

```js
// tests/monetization.test.js

import { describe, it, expect, beforeEach, vi } from 'vitest';

// 必须在最顶层 mock localStorage（在 import 之前）
const _mockLS = (() => {
    let store = {};
    return {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { store = {}; },
    };
})();
vi.stubGlobal('localStorage', _mockLS);

import { initMyModule } from '../web/src/monetization/myModule.js';
import MonetizationBus from '../web/src/monetization/MonetizationBus.js';

describe('MyModule', () => {
    beforeEach(() => {
        _mockLS.clear();
        MonetizationBus._clearAllHandlers();
    });

    it('should react to game_over event', () => {
        const cleanup = initMyModule();
        let triggered = false;

        // 模拟游戏结束
        MonetizationBus.emit('game_over', { finalScore: 100 });
        expect(triggered).toBe(true);

        cleanup();
    });
});
```

### Mock 网络请求

```js
// 在测试中 mock fetch
global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ segment: 'dolphin', whaleScore: 0.45 }),
});
```

---

## 12. 常见问题

### Q: 修改了 `game_rules.json`，为什么前端没有生效？

A: Vite 不会自动 HMR JSON 文件。请手动刷新页面，或重启 `npm run dev`。

### Q: 如何在商业化模块中访问当前游戏状态？

A: 通过 `MonetizationBus` 回调的 `game` 参数，或使用 `getGame()` 获取当前附加的 game 实例：

```js
import { getGame } from './MonetizationBus.js';

const game = getGame();
const profile = game?.playerProfile;
```

### Q: Feature Flag 修改后没有效果？

A: 确认模块已在 `featureFlags.js` 的 `FLAG_DEFAULTS` 中注册，且模块初始化在 `getFlag()` 检查之后。

### Q: 如何调试 MonetizationBus 事件？

A: 添加全局监听：

```js
import { on } from './monetization/MonetizationBus.js';
on('*', ({ eventType, data }) => console.log('[Bus Debug]', eventType, data));
// 注意：'*' 通配符需要修改 MonetizationBus.emit 支持，或手动订阅所有事件类型
```

### Q: 后端蓝图注册失败？

A: 检查 `server.py` 末尾的 try/except 块输出，常见原因：
- 导入路径错误（确保新文件在项目根目录）
- Python 依赖缺失（查看 `requirements.txt`）
- SQLite 初始化失败（检查文件权限）；库表设计与用途见 [SQLITE_SCHEMA.md](./SQLITE_SCHEMA.md)

---

更多问题请通过 [GitHub Issues](https://github.com/btbujiangjun/openblock/issues) 或 [Discussions](https://github.com/btbujiangjun/openblock/discussions) 提交。
