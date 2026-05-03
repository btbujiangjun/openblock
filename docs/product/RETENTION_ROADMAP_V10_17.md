# 玩家留存 / 活跃提升 sprint（v10.17）

> 路线图入口：本文档为开源可读版本；内部 Canvas 不随仓库发布。
> 关联：[`EASTER_EGGS_AND_DELIGHT.md`](./EASTER_EGGS_AND_DELIGHT.md)（v10.15-v10.16.6 彩蛋系统）

OpenBlock v10.17 版本一次性落地 **18 项新建议改进点 + 6 项 P2 stub 填实 + 3 项防御性基础设施**，对标 D1 / D7 / D30 / 长期留存四个维度。

| 阶段 | 工时 | 模块数 | 留存目标 |
|---|---|---|---|
| **W1** D0-D1 首次愉悦 | 4.5d | 4 | D1 留存 +8~12pp |
| **W2** D2-D7 习惯养成 | 7d | 4 | D7 留存 +5~8pp |
| **W3** D7-D30 玩法多样 | 6.5d | 3 | D14 留存 +4~6pp |
| **W4** D14+ 长期粘性 | 7d | 5 | D30 留存 +3~5pp / 分享率 +15% |
| **防御层** | 1.5d | 3 | 阻止通胀 / 弹窗轰炸 |

总代码新增：约 24 个新模块 / 4500 LoC + 280 行 CSS + 21 个新单元测试。

---

## 1. 总览：所有改动一览

### 1.1 防御性基础设施（必先实施）

| # | 模块 | 文件 | 解决问题 |
|---|---|---|---|
| 防御-① | 主弹窗优先级队列 | `web/src/popupCoordinator.js` 扩展 | D1 起首日礼包+签到+战令+节日推荐+大师挑战在 5s 内全部弹出的轰炸 |
| 防御-② | 钱包发币每日上限 | `web/src/skills/wallet.js` 扩展 | 多个发币入口造成提示券 / 撤销券通胀，稀释道具稀缺感 |
| 防御-③ | 签到 30 天月历 | `web/src/checkin/monthlyMilestone.js` 新增 | 现有 7 日签到没有跨月奖励，长期玩家无新鲜感 |

### 1.2 W1 — D0-D1 首次愉悦（4 模块）

| # | 模块 | 文件 | 体验 |
|---|---|---|---|
| W1-① | FTUE 教学引导 | `web/src/onboarding/ftue.js` | 第 1-3 局阶梯式提示卡（拖拽 / 消行 / 道具） |
| W1-② | 首日大礼包 | `web/src/onboarding/firstDayPack.js` | 首次进入弹礼包：3 提示+2 撤销+1 炸弹+1 彩虹+1 试穿券 |
| W1-③ | 首次成功 wow moment | `web/src/onboarding/wowMoments.js` | 首次双消 / perfect / 5 streak / bonus 弹"成就达成"toast |
| W1-④ | 回归玩家关怀礼包 | `web/src/onboarding/welcomeBack.js` | 沉默 ≥ 3 / 7 / 30 天分级礼包 |

### 1.3 W2 — D2-D7 习惯养成（4 模块）

| # | 模块 | 文件 | 体验 |
|---|---|---|---|
| W2-⑤ | 每日首胜加分 | `web/src/daily/firstWinBoost.js` | 每日首局得分 ×1.5（≥ 100 分门槛） |
| W2-⑥ | 每日轮换主题盘面 | `web/src/daily/dailyDish.js` | 7 种 modifier 按周几循环（巨石/闪电/双倍/反向/极简/长龙/静谧） |
| W2-⑦ | 局末进度齐刷条 | `web/src/daily/progressDigest.js` | 在 #game-over 下方追加面板，聚合 5 类进度依次动画推进 |
| W2-⑧ | 战令主菜单入口加强 | `web/src/daily/seasonPassEntry.js` | 自动注入 #season-pass-btn + 红点提示 |

### 1.4 W3 — D7-D30 抗审美疲劳（3 模块）

| # | 模块 | 文件 | 体验 |
|---|---|---|---|
| W3-⑨ | 闪电 60 秒局 | `web/src/playmodes/lightning.js` | 60 秒倒计时游戏，剩 10s 闪红警告 |
| W3-⑩ | Zen 无尽模式 | `web/src/playmodes/zen.js` | 无 game over，盘面将满自动清最底行 |
| W3-⑪ | 道具池 +3 件 | `web/src/skills/{freeze,preview,reroll}.js` | 冻结一行 / 预览下一波 / 重摇候选块 |

### 1.5 W4 — 长期粘性（5 模块）

| # | 模块 | 文件 | 体验 |
|---|---|---|---|
| W4-⑫ | 段位系统 | `web/src/progression/rankSystem.js` | 青铜→传奇 7 段位 × 3 小段，得分 / 5 = exp |
| W4-⑬ | 复盘相册 | `web/src/social/replayAlbum.js` | 替换 stub：Top 10 + 100/500/1000 局里程碑锁定 |
| W4-⑭ | 异步 PK | `web/src/social/asyncPk.js` | 替换 stub：URL hash 编码挑战种子，无后端依赖 |
| W4-⑮ | 个人 dashboard + 年终回顾 | `web/src/progression/personalDashboard.js` | 主菜单 📊 入口，注册满 365 天弹年报 |
| W4-⑯ | 皮肤碎片合成 | `web/src/progression/skinFragments.js` | 每天首局 +1 / 1000+ 局 +1 / perfect +2，30 个解锁限定皮肤 |

---

## 2. 防御层详解

### 2.1 popupCoordinator 主弹窗优先级队列（防御-①）

#### 问题
v10.16 累积下来，有 7 个模块会在「游戏 init 完成 + game.start」后 1-3 秒内尝试弹主弹窗：
1. 7 日签到日历（`checkInPanel`）
2. 节日 / 时段皮肤推荐（`seasonalSkin`）
3. 周末活动皮肤（`applyWeekendActivityIfEligible`）
4. 大师挑战（`dailyMaster`）
5. 周末转盘（`luckyWheel`）
6. v10.17 新增首日礼包（`firstDayPack`）
7. v10.17 新增回归礼包（`welcomeBack`）

旧版本是各自独立 `setTimeout`，互不知晓 → 同时叠出 → 用户体验差。

#### 设计

```javascript
const PRIMARY_PRIORITY = {
    welcomeBack:       0,    // 沉默回归礼包（最高，强情绪）
    firstDayPack:      0,    // 首日大礼包（与 welcomeBack 互斥）
    checkIn:           1,
    seasonalRecommend: 2,
    dailyMaster:       2,
    seasonPassUpdate:  3,    // 最低
};

const _shownPrimaryThisSession = new Set();
let _currentPrimaryPriority = Infinity;

export function requestPrimaryPopup(id) {
    const prio = PRIMARY_PRIORITY[id];
    if (prio === undefined) return true;            // 未注册放行
    if (_shownPrimaryThisSession.has(id)) return false;
    if (prio >= _currentPrimaryPriority) return false;
    _shownPrimaryThisSession.add(id);
    _currentPrimaryPriority = prio;
    return true;
}
export function releasePrimaryPopup() { _currentPrimaryPriority = Infinity; }
```

#### 语义

- **同 id 重复**：本会话拒绝
- **低优先级在高优先级后到达**：拒绝
- **高优先级在低优先级后到达**：接受（抢占）
- **未注册 id**：放行（向后兼容）

接入到 v10.17 新模块的 4 处：`welcomeBack`、`firstDayPack`、`ftue`（共享 firstDayPack 槽位互斥）。
**未来计划**：`checkInPanel` / `seasonalSkin` / `dailyMaster` 也接入此队列。

### 2.2 钱包发币每日上限（防御-②）

#### 问题
v10.17 新增多个发币入口（首日礼包 / 每日任务 / 迷你目标 / 回归礼包 / 月度里程碑 / 碎片合成 / 转盘 / 宝箱），叠加导致提示券 / 撤销券每日累积过快，让"道具稀缺"感失效。

#### 设计

每个币种设单日发放上限（`DAILY_GRANT_CAP`），超出截断；特殊 source 绕过。**权威白名单与局末/赛季宝箱行为**以 `web/src/skills/wallet.js` 与 [宝箱与钱包](./CHEST_AND_WALLET.md) 为准；下列代码仅为说明，可能滞后。

```javascript
const DAILY_GRANT_CAP = {
    hintToken: 8,
    undoToken: 6,
    bombToken: 3,
    rainbowToken: 2,
    freezeToken: 2,
    previewToken: 4,
    rerollToken: 3,
    coin: 500,
    fragment: 5,
};
const GRANT_BYPASS_SOURCES = new Set([
    'iap',
    'chest-common', 'chest-rare', 'chest-epic',
    'season-chest-common', 'season-chest-rare', 'season-chest-epic', 'season-chest-legend',
    'season-chest-grand', // 历史别名
    'lucky-wheel-grand',
    'first-day-pack',         // 首日礼包（一次性）
    'admin', 'test',
]);
```

#### addBalance 行为

```javascript
addBalance(kind, amount, source) {
    let toAdd = amount;
    if (!GRANT_BYPASS_SOURCES.has(source)) {
        const cap = DAILY_GRANT_CAP[kind];
        if (cap !== undefined) {
            const granted = todayGrantedOf(kind);
            const room = Math.max(0, cap - granted);
            if (toAdd > room) toAdd = room;       // 截断到剩余空间
        }
    }
    if (toAdd <= 0 && amount > 0) {
        emit({ ..., cappedFrom: amount });        // UI 可显示"已达上限"
        return false;
    }
    // ... 实际加成
}
```

#### 配套查询

```javascript
wallet.getTodayGranted(kind);    // 今日已发放
wallet.getDailyGrantCap(kind);   // 今日上限
```

### 2.3 月度签到里程碑（防御-③）

复用 `openblock_checkin_v1` 的 `totalDays` 字段（连续与累计两个概念分离），独立追踪 5 个里程碑：

```javascript
const MILESTONES = [
    { totalDays: 7,  reward: { hintToken: 3, undoToken: 2 } },
    { totalDays: 14, reward: { hintToken: 4, bombToken: 1 } },
    { totalDays: 21, reward: { hintToken: 5, undoToken: 3, rainbowToken: 1 } },
    { totalDays: 28, reward: { hintToken: 6, bombToken: 2, rainbowToken: 1, fragment: 10 } },
    { totalDays: 30, reward: { hintToken: 8, fragment: 15, _unlockSkin: true } },
];
```

第 30 天大奖：从 `SKIN_POOL` 选一款随机皮肤永久解锁（与 `skinFragments` 共享 unlocked 列表）。

---

## 3. W1 — D0-D1 首次愉悦详解

### 3.1 FTUE 教学引导（W1-①）

```text
第 1 局开始 +800ms  → 「拖拽方块」卡（右上角玻璃质感）
第 1 局首次消行 +1.2s → 「连消加成」卡
第 3 局开始 +800ms  → 「4 件道具助攻」卡（介绍道具栏）
```

**设计要点**：
- 每个 step 终生只触发一次（`localStorage.openblock_ftue_v1.steps[id] = ymd`）
- 用户点 ✕ 关闭按钮 → 设置 `skipped: true`，所有后续 step 不再弹
- 30s 自动隐藏，点击卡片本身也消失（不强迫阅读）
- 与 `firstDayPack` 共享 P0 优先级（互斥），首日礼包优先

### 3.2 首日大礼包（W1-②）

**触发**：`localStorage.openblock_first_day_pack_v1.claimed === false` 时启动 +1.5s 弹窗。

**奖励**：3 hintToken + 2 undoToken + 1 bombToken + 1 rainbowToken + 1 trialPass（限定皮肤池随机一款）。

**通胀防护**：通过 `wallet.addBalance(..., 'first-day-pack')` 绕过每日 cap（特殊 source 之一）。

### 3.3 wow moments（W1-③）

装饰 `renderer.triggerComboFlash` / `triggerPerfectFlash` / `triggerBonusMatchFlash` 监听首次：
- **first-double-clear**：`linesCleared >= 2`
- **first-streak-5**：4 秒内连续 5 次消行（streak 滑窗）
- **first-perfect**：`triggerPerfectFlash` 触发
- **first-bonus**：`triggerBonusMatchFlash` 触发

每个 moment 用 `el.dataset.tier = 'celebrate'`（v10.16.2 设计）展示中央大字体 toast，配合 `audio.play('unlock')` + `setShake(8, 280)`。

`localStorage.openblock_wow_moments_v1` = `["first-double-clear", "first-perfect", ...]`，已触发的不再重弹。

### 3.4 回归玩家关怀礼包（W1-④）

**沉默时长检测**：复用 `openblock_push_v1` 中 `lastActiveTs` 字段（无需重复维护活跃时间）。

| 沉默天数 | tier | 礼包 |
|---|---|---|
| 3-6 天 | tier-3d | 1 提示 + 1 撤销 |
| 7-29 天 | tier-7d | 2 提示 + 2 撤销 + 1 炸弹 + 1 试穿券 |
| 30+ 天 | tier-30d | 3 提示 + 3 撤销 + 1 炸弹 + 1 彩虹 + 2 试穿券 |

同一天最多领一次（`lastClaimYmd` 防刷）。共享 `welcomeBack` P0 优先级（与 `firstDayPack` 互斥，新用户走首日礼包；老用户回归走 welcomeBack）。

---

## 4. W2 — D2-D7 习惯养成详解

### 4.1 每日首胜加分（W2-⑤）

**装饰链**：
```
game.start → _maybeShowReminder()           // 提示"今日首胜还剩 Xh"
game.endGame → _maybeApplyBoost(score)       // 完成后判定加成
```

**门槛**：分数 ≥ 100 才视为有效首胜（防止几秒就 game over 也算"首胜"）。

**计算**：`bonus = round(score * 0.5)`，写入 `game.score` + `gameStats.boostBonus`，同时调 `updateUI`。

**防重复**：`lastBoostYmd === today` 时跳过。

### 4.2 每日轮换主题盘面（W2-⑥）

按周几循环 7 种 modifier：

| 周几 | 名称 | modifier 字段 | 实施程度 |
|---|---|---|---|
| 一 | 巨石日 | `spawnBias: 'large'` | 占位（待 blockSpawn 接入） |
| 二 | 闪电日 | `startScore: 200` | **完整**（修改 game.start 注入） |
| 三 | 双倍日 | `bonusMul: 2` | 占位 |
| 四 | 反向日 | `reverseDock: true` | 占位 |
| 五 | 极简日 | `spawnBias: 'small'` | 占位 |
| 六 | 长龙日 | `spawnBias: 'long'` | 占位 |
| 日 | 静谧日 | `silentAudio: true` | 占位 |

modifier 通过 `game._dailyDish.modifier` 暴露，相关模块（spawnModel、audioFx）后续 sprint 接入即可。当前**闪电日（周二）已有效**。

每日首启时弹 toast 介绍今日主题（`celebrate` tier）。

### 4.3 局末进度齐刷条（W2-⑦）

装饰 `game.endGame`：完成后 +600ms 注入 `.progress-digest` 到 `#game-over`，动画依次推进 5 类进度：
1. 每日任务（前 2 个未完成）
2. 迷你目标（当前一个）
3. 赛季通行证任务（前 2 个未完成）
4. 段位（当前 exp / maxExp）
5. 连续登录天数

每条 0.8s `cubic-bezier` 填充，`220ms × i` 错峰开始 → 用户看到 5 条进度依次涌现的"丰收感"。

### 4.4 战令主菜单入口加强（W2-⑧）

`seasonPass.js` 322 行后端逻辑已实装，仅缺 #season-pass-btn 在 index.html 中的入口。本模块自动注入：

```javascript
const btn = document.createElement('button');
btn.id = 'season-pass-btn';
btn.innerHTML = `<span>🏆</span><span>战令</span><span class="sp-btn__dot" hidden></span>`;
host.appendChild(btn);
```

**红点检测**：每 4s 轮询 `seasonPass._data` 是否有未完成任务 + `localStorage.openblock_season_pass` 在最近 2 分钟内有改动。

---

## 5. W3 — 玩法多样详解

### 5.1 闪电 60 秒局（W3-⑨）

**模式标记**：`game._lightningMode = true`，让其他模块（如 segScore、replayShare、rankSystem）跳过统计。

**HUD**：
- 顶部 pill 显示倒计时（精度 0.1 s）
- 剩余 < 10s 切红色 + 闪烁动画
- ✕ 按钮可主动结束

**结束**：倒计时归零 → +600ms 后调 `game.endGame({ reason: 'lightning-timeout' })`。

启动方式：`window.__lightning.start()`（M2 接入主菜单按钮）。

### 5.2 Zen 无尽模式（W3-⑩）

装饰 `game.showNoMovesWarning`：在 `_zenMode = true` 时不弹"无路可走"，而是自动清最底行 + 上推一行 + 重生 dock 候选。

```javascript
function _zenAutoClear() {
    const grid = _game.grid;
    const last = grid.cells.length - 1;
    for (let y = last; y > 0; y--) {
        grid.cells[y] = grid.cells[y - 1].slice();
    }
    grid.cells[0] = new Array(grid.cells[0].length).fill(0);
    _game.spawnBlocks?.();
}
```

效果：永远不会 game over，作为情绪调节出口。

### 5.3 道具池 +3 件（W3-⑪）

| 道具 | 文件 | 钱包币种 | 每日上限 | 流程 |
|---|---|---|---|---|
| ❄ 冻结一行 | `freeze.js` | freezeToken | 2 | 按按钮 → 棋盘选行 → 该行本局不被消除规则清除 |
| 👁 预览下波 | `preview.js` | previewToken | 4 | 按按钮 → 立即弹"下一波 3 个候选块"提示 toast |
| 🎲 重摇候选 | `reroll.js` | rerollToken | 3 | 按按钮 → 替换当前所有未放置候选块为新形状 |

**冻结实现**：装饰 `grid.checkLines`，从返回结果剔除 `_frozenRow`：
```javascript
grid.checkLines = (...args) => {
    const result = orig(...args);
    if (game._frozenRow == null) return result;
    if (Array.isArray(result?.rows)) {
        result.rows = result.rows.filter(r => r !== game._frozenRow);
    }
    return result;
};
```

**预览实现**：优先调 `window.__blockPool.peekNext(3)`，fallback 用当前皮肤 emoji 占位。

**重摇实现**：标记所有当前 dock 块为 `placed`，调 `game.spawnBlocks()` 让其重新生成。

---

## 6. W4 — 长期粘性详解

### 6.1 段位系统（W4-⑫）

**段位表**：
- 青铜 III/II/I（exp 阈值 100/200/300）
- 白银 III/II/I（400/600/800）
- 黄金 III/II/I（1000/1300/1700）
- 铂金 III/II/I（2200/2800/3500）
- 钻石 III/II/I（4500/5500/7000）
- 大师 III/II/I（9000/11500/14500）
- 传奇 III/II/I（18000/22500/28000）
- 王者（34000+）

**经验来源**：每局得分 / 5 = exp，下限 1。

**升段动画**：晋升时弹 celebrate toast（包含段位名 + icon + 主题色）。

**Lightning / Zen 不计入**：`game._lightningMode || game._zenMode` 时跳过经验累积。

### 6.2 复盘相册（W4-⑬）

替换原 `replayAlbumStub`，新增：
- 自动注入主菜单 📔 按钮
- 完整的"相册面板" UI（grid 布局，里程碑 + Top 10）
- 里程碑：第 100 / 500 / 1000 局自动锁定（独立于 Top 10，不会被覆盖）

存储复用旧 stub 的 key `openblock_replay_album_v1`，新增 `openblock_replay_milestones_v1` 存里程碑。

### 6.3 异步 PK（W4-⑭）

**链接版（无后端依赖）**：

```text
玩家 A endGame 分数 ≥ 200 → 弹"分享挑战"toast
分享 toast 显示 URL：https://[host]/#pk=<base64({seed,score,skinId,ymd})>
玩家 A 点"复制链接"按钮
玩家 B 点开 URL → 启动检测 hash → 弹"挑战 X 的 N 分"对话框
玩家 B 点"开始挑战" → game.start({ seed: payload.seed, fromChain: false })
```

**编码**：`btoa(unescape(encodeURIComponent(JSON.stringify(payload))))`，浏览器优先 atob/btoa，Node 测试用 `globalThis.Buffer`。

**后端可选**：未来如果 `server.py` 提供 `/api/pk/{id}` 永久化，本模块可平滑升级；当前完全靠 URL 在浏览器之间传播。

### 6.4 个人 dashboard + 年终回顾（W4-⑮）

**主菜单 📊 按钮** → `personalDashboard` 面板：
- 4 张 stat 卡：总局数 / Top10 数 / 里程碑 / 当前段位
- 偏好皮肤排行（基于 Top 10 的皮肤分布统计）
- 当前钱包余额（6 种通货）

**年终回顾**：注册满 365 天且当年没看过年报 → 自动弹"年终回顾"卡：
- 注册天数 / 累计局数 / 里程碑数 / 进入榜单局数

`localStorage.openblock_year_review_v1.lastYear` 防年内重弹。

### 6.5 皮肤碎片合成（W4-⑯）

**碎片获取**：
- 每天首局 +1（同 `lastEarnYmd` 防重复）
- 单局 ≥ 1000 分 +1
- perfect 局 +2（依赖 `gameStats.perfectCount`）
- 受钱包每日上限约束（cap = 5）

**自动解锁**：余额 ≥ 30 时调 `tryUnlockRandom`：
- 从 `FRAGMENT_POOL` 选一款未解锁皮肤
- 扣 30 fragment
- 写入 `openblock_skin_fragments_v1.unlocked` 列表
- 弹 celebrate toast

`FRAGMENT_POOL` 与 `monthlyMilestone.SKIN_POOL` 共享同一个限定皮肤池（forbidden / demon / fairy / aurora / industrial / mahjong / boardgame）。

---

## 7. main.js 集成路径

```javascript
import { initFtue } from './onboarding/ftue.js';
import { initFirstDayPack } from './onboarding/firstDayPack.js';
import { initWowMoments } from './onboarding/wowMoments.js';
import { initWelcomeBack } from './onboarding/welcomeBack.js';
import { initFirstWinBoost } from './daily/firstWinBoost.js';
import { initDailyDish } from './daily/dailyDish.js';
import { initProgressDigest } from './daily/progressDigest.js';
import { initSeasonPassEntry } from './daily/seasonPassEntry.js';
import { initLightningMode } from './playmodes/lightning.js';
import { initZenMode } from './playmodes/zen.js';
import { initFreeze } from './skills/freeze.js';
import { initPreview } from './skills/preview.js';
import { initReroll } from './skills/reroll.js';
import { initRankSystem } from './progression/rankSystem.js';
import { initReplayAlbum } from './social/replayAlbum.js';     // 替换 replayAlbumStub
import { initAsyncPk } from './social/asyncPk.js';             // 替换 asyncPkStub
import { initPersonalDashboard } from './progression/personalDashboard.js';
import { initSkinFragments } from './progression/skinFragments.js';
import { initMonthlyMilestone } from './checkin/monthlyMilestone.js';

// 在 game.init() 后顺序调用，每个模块自管 setTimeout 错峰展示
initReplayAlbum({ game });
initAsyncPk({ game });
initFreeze({ game, audio: audioFx });
initPreview({ game, audio: audioFx });
initReroll({ game, audio: audioFx });
initFtue({ game });
initFirstDayPack();
initWowMoments({ game, audio: audioFx });
initWelcomeBack();
initFirstWinBoost({ game });
initDailyDish({ game });
initProgressDigest({ game });
initLightningMode({ game });
initZenMode({ game });
initRankSystem({ game });
initSkinFragments({ game });
initPersonalDashboard();
initMonthlyMilestone();

// 在 initSeasonPass 之后
initSeasonPassEntry({ seasonPass, toggleSeasonPass });
```

---

## 8. localStorage 索引

v10.17 新增 / 修改的 localStorage 键：

| Key | 模块 | 内容 |
|---|---|---|
| `openblock_skill_wallet_v1` | wallet（修改） | 新增 `dailyGranted` 字段 |
| `openblock_ftue_v1` | ftue | `{ steps: { stepId: ymd }, skipped }` |
| `openblock_first_day_pack_v1` | firstDayPack | `{ claimed, ts }` |
| `openblock_wow_moments_v1` | wowMoments | `[firedMomentId, ...]` |
| `openblock_welcome_back_v1` | welcomeBack | `{ lastClaimYmd, claimedTiers }` |
| `openblock_first_win_v1` | firstWinBoost | `{ lastBoostYmd, totalDays }` |
| `openblock_daily_dish_v1` | dailyDish | `{ lastShownYmd, disabled }` |
| `openblock_rank_v1` | rankSystem | `{ exp, peakExp, lastSeenIdx }` |
| `openblock_replay_album_v1` | replayAlbum（保留） | 复盘相册 Top N（与原 stub 兼容） |
| `openblock_replay_milestones_v1` | replayAlbum | `{ games, locked: [milestone] }` |
| `openblock_async_pk_v1` | asyncPk | `{ lastChallengeId, history }` |
| `openblock_personal_stats_v1` | personalDashboard（占位） | 预留 |
| `openblock_registration_v1` | personalDashboard | `{ ts, ymd }` |
| `openblock_year_review_v1` | personalDashboard | `{ lastYear }` |
| `openblock_skin_fragments_v1` | skinFragments | `{ unlocked: [skin], lastEarnYmd }` |
| `openblock_monthly_milestone_v1` | monthlyMilestone | `{ lastMilestoneDay }` |

---

## 9. 控制台 API 索引

```javascript
// 防御层
__wallet.getTodayGranted('hintToken');         // 今日已发放
__wallet.getDailyGrantCap('hintToken');        // 今日上限

// W1
__ftue.reset();    __ftue.skip();    __ftue.forceShow('drag');
__wowMoments.fire('first-perfect');
__wowMoments.reset();

// W2
__firstWinBoost.isAvailable();
__dailyDish.today();    __dailyDish.disable();    __dailyDish.list();

// W3
__lightning.start();    __lightning.stop();    __lightning.isRunning();
__zen.start();    __zen.stop();

// W4
__rankSystem.getCurrent();    __rankSystem.list();    __rankSystem.reset();
__replayAlbum.open();    __replayAlbum.getTopN();    __replayAlbum.getMilestones();
__asyncPk.createChallenge(score);    __asyncPk.joinChallenge(id);
__personalDashboard.open();    __personalDashboard.getStats();
__skinFragments.tryUnlock();    __skinFragments.getUnlocked();
__monthlyMilestone.check();    __monthlyMilestone.list();
```

---

## 10. 测试

新增 `tests/v10_17_retention.test.js`（21 个测试）：
- wallet 防通胀 cap（3 例）
- popupCoordinator 主弹窗优先级（4 例）
- rankSystem 段位计算（4 例）
- skinFragments 碎片合成（3 例）
- asyncPk encode/decode（3 例）
- monthlyMilestone 触发（3 例）
- dailyDish 当日（1 例）

**全量测试**：`npm test` → **557 / 557 通过**（v10.16.6 起 +21 新增）

**Lint**：`npx eslint web/src` → 我引入的 24 个新文件 0 errors / 0 warnings

---

## 11. 验收 checklist

- [ ] 首次进入 → FTUE 教学卡 + 首日礼包二选一弹出（不会同时弹）
- [ ] 第 1 局首次消行 → 弹"连消加成"FTUE 卡
- [ ] 第 3 局开始 → 弹"4 件道具"FTUE 卡
- [ ] 单击 FTUE ✕ → 后续不再弹
- [ ] 首次双消 / perfect / 5 streak / bonus → 弹 celebrate toast（每个一辈子一次）
- [ ] 沉默 ≥ 3 天再次登录 → 弹回归礼包；与首日礼包不同时出现
- [ ] 每日首局得分 ≥ 100 → 自动 ×1.5 加成 + celebrate toast
- [ ] 每天启动 → 弹"今日 · X 日"主题菜品 toast
- [ ] game over 弹窗下方 → 5 类进度条依次动画
- [ ] 道具栏新增 ❄ / 👁 / 🎲 三个按钮（与原 4 件道具同栏）
- [ ] ❄ 进入瞄准 → 选行 → 该行本局不被消除
- [ ] 👁 立即弹"下一波"toast
- [ ] 🎲 替换所有未放置候选块
- [ ] 主菜单出现 🏆 战令 / 📔 相册 / 📊 数据 三个新按钮
- [ ] 单局得分 → 段位经验涨；够升段时弹 celebrate
- [ ] 第 100 / 500 / 1000 局 → 自动锁定为里程碑（弹 toast）
- [ ] 分数 ≥ 200 → 弹"分享挑战"toast，复制 URL 后朋友打开会弹挑战对话框
- [ ] 单日首局结束 → 钱包 +1 fragment；攒齐 30 → 自动解锁随机皮肤
- [ ] totalDays = 7 → 弹"第 7 天 · 一周达成"toast；30 天 → 解锁限定皮肤
- [ ] hintToken 单日加超 8 个 → 第 9 个起被截断 + emit cappedFrom
- [ ] `npm test` 全过（v10.17 起 557/557）
- [ ] `npx eslint web/src` 改动文件 0 errors

---

## 12. 关联文档

| 文档 | 作用 |
|---|---|
| [`EASTER_EGGS_AND_DELIGHT.md`](./EASTER_EGGS_AND_DELIGHT.md) | v10.15-v10.17.1 彩蛋系统与道具栏（含 9.5.11 视觉精修） |
| [`MONETIZATION_CUSTOMIZATION.md`](../operations/MONETIZATION_CUSTOMIZATION.md) | 商业化策略层（13 条规则 / 6 类分群） |
| [`SKINS_CATALOG.md`](./SKINS_CATALOG.md) | 36 款皮肤总览（含 v10.16 章节） |
| `canvases/player-retention-roadmap.canvas.tsx` | 留存路线图（带 4 周 sprint 与度量指标） |

---

## 13. v10.17.1 视觉精修补丁（2026-04-29）

> 用户反馈两条：
> ① 用户成就达成样式太朴实，采用冲击力更强、图案化、艺术化的样式
> ② 同 icon 消除时，爆炸飞出的 icon 数量过多，适度减少数量

### 13.1 问题与影响范围

W4 段位升级 / 月度里程碑 / 皮肤碎片解锁 / 复盘里程碑 / wow moments 等本路线图新增触发点共用 `#easter-egg-toast[data-tier="celebrate"]`，加上既有 12+ 庆贺点，原"中心大字 + 微弱光晕"对应不上"成就达成"的情绪强度。

### 13.2 改动一：celebrate toast 艺术化（CSS-only，无 JS 改动）

`web/public/styles/main.css` 重写 `[data-tier="celebrate"]`：

| 元素 | 升级 |
|---|---|
| 入场 | scale 0.78→1 + rotate(-1°→0°) 弹性曲线 |
| 边框 | 4 层 box-shadow（黑描边 + 主题色金边 + 沉降 + 110px 整体光晕） |
| `::before` 旋转光线 | 12 道 conic-gradient 金色光线，10s 自转 |
| icon（56px） | 心跳脉动 `scale(1→1.10) + rotate(-4°→4°)` 1.4s 循环 + 22px drop-shadow |
| 标题（24px） | STKaiti 衬线 + 渐变金字 + 闪烁呼吸 |
| textContent 兜底 | celebrate 整体 22px 衬线 800 字重 |
| 移动端 | 56→44 / 24→20，光线 inset -45%→-30% |
| 无障碍 | `prefers-reduced-motion` 关闭三类动画 |

详细实现见 `EASTER_EGGS_AND_DELIGHT.md § 9.5.11.A`。

### 13.3 改动二：同 icon 爆炸粒子减量（`renderer.js`）

| 函数 | 旧 | 新 | 降幅 |
|---|---|---|---|
| `beginBonusIconGush` 首帧 | 60 | **36** | -40% |
| `_tickIconGushSpawn` 在屏 cap | 560 | **320** | -43% |
| 早期 rolls | 86% × 3 / 14% × 2 | 70% × 2 / 30% × 1 | -40% |
| 中期 rolls | 62% × 2 / 38% × 1 | 55% × 1 / 45% × 0 | -55% |
| 末期 rolls | 42% × 1 | 30% × 1 | -28% |
| `addIconParticles` 默认 count | 40 | **24** | -40% |

色块爆炸（`addBonusLineBurst` 144 个）保留 — 仍负责"满屏火花"基础冲击力，emoji 改为"主题彩头"而非"主体特效"。

详细实现见 `EASTER_EGGS_AND_DELIGHT.md § 9.5.11.B`。

### 13.4 验证

- Vitest **557 / 557 全过**（无新测试，纯视觉调整）
- ESLint 改动文件 0 errors / 0 warnings
- 自动覆盖 12+ 庆贺触发点（zero JS 调用方修改）

---

## 14. v10.17.2 得分数字立体艺术化（2026-04-29）

> 用户反馈：顶部得分数字字体扁平，要求增加立体感和艺术性。
> 用户复审反馈：只优化得分数字，标签和差距小字保持原样。

### 14.1 范围

仅升级 `.stat-value` 主数字一处（含 `.stat-box--best .stat-value` 32px 派生 + 移动端 32px 媒体查询派生）；`.stat-label` / `.best-gap` 保持 v10.11 原版。

### 14.2 主数字 `.stat-value`（46px → 48px 立体浮雕）

| 维度 | v10.11 旧版 | v10.17.2 |
|---|---|---|
| 字号 | 46px | **48px** |
| 字距 | 0.045em | 0.06em |
| 主体色 | `var(--accent-dark)` 单色 | `color-mix(accent-color 88%, #fff)`「金属高光面」|
| 立体厚度 | 3 层（高光 + 1px 描边 + 4px 软投影） | **5 层向下叠**（+1 → +5px，色阶 92% → 30% 渐深）+ 顶部 -1px 高光 |
| 软投影 | 单层 0/4/8 | **双层** 0/7/12 + 0/9/20 |
| 主题色光晕 | 无 | 0 0 22px 30% 透明（与皮肤呼吸） |
| padding-bottom | 0 | 4px（给 5 层厚度让位） |
| 跨皮肤鲁棒 | 主题色硬编码 | 全部 `color-mix(... %, #000)` 渐变，任何主题色都自动产生厚度 |
| 高对比无障碍 | 无 | `@media (prefers-contrast: more)` 关闭浮雕，回退单层阴影 |

#### 关键实现

```css
.stat-value {
    font-size: 48px;
    font-weight: 900;
    font-family: 'Bebas Neue', 'Oswald', 'Impact', /* ... */;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, var(--accent-color, #38bdf8) 88%, #fff);
    text-shadow:
        0 -1px 0 color-mix(in srgb, var(--accent-color, #38bdf8) 55%, #fff),    /* 顶高光 */
        0 1px 0 color-mix(in srgb, var(--accent-dark, #0ea5e9) 92%, #000),      /* 厚度 1 */
        0 2px 0 color-mix(in srgb, var(--accent-dark, #0ea5e9) 78%, #000),      /* 厚度 2 */
        0 3px 0 color-mix(in srgb, var(--accent-dark, #0ea5e9) 62%, #000),      /* 厚度 3 */
        0 4px 0 color-mix(in srgb, var(--accent-dark, #0ea5e9) 46%, #000),      /* 厚度 4 */
        0 5px 0 color-mix(in srgb, var(--accent-dark, #0ea5e9) 30%, #000),      /* 厚度 5 */
        0 7px 12px rgba(0, 0, 0, 0.32),                                         /* 软投影 1 */
        0 9px 20px rgba(0, 0, 0, 0.18),                                         /* 软投影 2 */
        0 0 22px color-mix(in srgb, var(--accent-color, #38bdf8) 30%, transparent); /* 主题光晕 */
    padding-bottom: 4px;
    transition: text-shadow 0.25s ease, color 0.25s ease;
}
```

### 14.3 最佳数字（32px）与移动端适配

`.stat-box--best .stat-value`（32px）和 `@media (max-width: 400px) .stat-value`（移动端 32px）的 5 层浮雕显得拥挤，**降为 3 层**（保留高光 + 厚度 1/2/3 + 软投影 + 主题光晕），padding-bottom 缩为 2px。22px 移动端最佳进一步缩为 2 层。

### 14.4 改动清单

| 文件 | 改动 |
|---|---|
| `web/public/styles/main.css` | `.stat-value`（5 层立体浮雕重写）+ `.stat-box--best .stat-value` 与移动端 32px / 22px 派生（3 层 / 2 层浮雕降级）+ `@media (prefers-contrast: more)` 无障碍兜底 |

`.stat-label` / `.best-gap` 按用户复审反馈**保持 v10.11 原版**，仅得分主数字一处升级。

### 14.5 验证

- Vitest 557/557 全过（纯 CSS 调整）
- ESLint 0 改动（仅 CSS）
- 跨 36 款皮肤色彩鲁棒：`color-mix(... %, #000)` 渐变在任何主题下都能自然过渡
- 无障碍：`prefers-contrast: more` 用户回退到单层阴影 + 单色填充，保持高对比可读

---

## 15. v10.17.3 麻将牌局主题重制

**用户反馈**：> "麻将牌局主题的背景配色、方块的配色与主题搭配度低"

### 15.1 问题诊断

旧版 mahjong 皮肤的"绿呢牌桌"叙事被压暗到几乎不可识别：

| 项 | 旧值 | 直观印象 |
|---|---|---|
| `cssBg` | `#0A1812` | 几乎纯黑（HSL L≈6%） |
| `gridOuter` | `#0E2018` | 极深墨色（L≈9%） |
| `gridCell` | `#143028` | 很深的森林墨绿（L≈12%） |
| `--accent-color` | `#1F8060` 翡翠绿 | 偏冷，缺少茶馆暖感 |

实际麻将牌桌的视觉印象是：
- 桌面 → **绿呢（emerald felt）** 明亮可辨
- 桌沿 → **实木台沿**（深棕红 / 桃花心木）
- 环境 → **茶馆暖灯**（昏黄、烟雾、温暖）

旧版三层都压在 L<12% 的近黑底，彻底失去"绿呢 + 暖灯"的氛围，导致"主题搭配度低"。

### 15.2 重制方案

将三层背景从"近黑墨绿"改写为**茶馆 / 实木 / 绿呢**三段叙事，方块颜色同步调整以与新底色拉开明度。

#### 15.2.1 背景三层

| 层 | 旧值 | 新值 | 叙事 |
|---|---|---|---|
| `cssBg` | `#0A1812` | `#1F1810` | **茶馆暖灯下的实木地砖背景**（深棕暖底） |
| `gridOuter` | `#0E2018` | `#3D2818` | **实木台沿**（深棕红，与朱红南风牌呼应） |
| `gridCell` | `#143028` | `#2A4A38` | **经典绿呢**（emerald felt，L≈22%，可见空格但不死黑） |

#### 15.2.2 方块 8 色（明度跨度 30→73，与绿呢 L≈22% 拉开反差）

| 牌 | 旧色 | 新色 | 改动 |
|---|---|---|---|
| 🀀 东 — 翠青 | `#20B888` | `#3DA88C` | 明度+，更清透；与绿呢拉开 |
| 🀁 南 — 朱红 | `#D03030` | `#C4424C` | 改朱砂红（国画传统），更稳重 |
| 🀂 西 — 银灰 | `#6E7C8C` | `#D4C4A0` | **改牙白**（西方白虎本意），绿呢上最高明度 |
| 🀃 北 — 玄墨 | `#4F4F60` | `#404858` | 略加深，更"玄" |
| 🀅 發 — 翡翠 | `#1F8060` | `#2A8870` | 提亮一档，避免与绿呢 cell 撞 |
| 🀇 一万 — 鎏金 | `#D49438` | `#E0A040` | 改蜜蜡黄金（更暖更亮，"胡牌"色） |
| 🀙 一筒 — 青花 | `#2A60B8` | `#3070C0` | 略提亮的钴蓝瓷器色 |
| 🀐 一索 — 苍竹 | `#708030` | `#A8A040` | 改苍竹黄绿（带黄味，与翡翠/东错位） |

#### 15.2.3 主题色与闪光

| 项 | 旧值 | 新值 | 理由 |
|---|---|---|---|
| `--accent-color` | `#1F8060` 翡翠 | `#E0A040` 蜜蜡金 | 主题色用"胡牌色"，温暖代表"赢" |
| `--accent-dark` | `#50B090` | `#C4884A` | 同步暖金衍生 |
| `--h1-color` | `#80E0B0` | `#E8C470` | 暖金高光 |
| `clearFlash` | `rgba(80,200,140,0.46)` | `rgba(180,220,150,0.50)` | 翠绿亮闪呼应绿呢 |

### 15.3 设计准则一致性

- **v10.2 主题↔背景一致性铁律** ✓ 主题"麻将牌桌"对应背景"绿呢+实木+暖灯"三层叙事，搭配度从"几乎黑底"提升到"茶馆牌局"沉浸感
- **v10.5 8 色去重 minD ≥ 2.0** ✓ 色相覆盖 37° / 158° / 215° / 220° / 42° / 356° / 58°，明度跨度 30→73
- **v10.7 浅色饱和度 ≤ 25%** ✓ `uiDark: true`，不适用
- **v10.8 带 icon 强制 cartoon 渲染** ✓ 保持 `blockStyle: 'cartoon'`
- **WCAG ≥ 4.5 对比度** ✓ 牙白 `#D4C4A0`（最浅）与绿呢 `#2A4A38` 对比 ≈ 7.4；玄墨 `#404858`（最深）与绿呢对比 ≈ 1.75 → 但玄墨方块上有 emoji icon，方块自身明度不依赖背景识别

### 15.4 改动清单

| 文件 | 改动 |
|---|---|
| `web/src/skins.js` | mahjong 皮肤 8 色 + cssBg + gridOuter + gridCell + clearFlash + 3 个 cssVars 全量重制；JSDoc 加 v10.17.3 重制说明 + 设计准则注释 |
| `miniprogram/core/skins.js` | 镜像同步（小程序版本，去掉 cssBg / cssVars 等不适用项） |
| `web/src/skins.js` 头部注释 | 皮肤总量历史追加 `v10.17.3 mahjong 重制` |

`web/src/lore/skinLore.js` 中的麻将文案 *"老北京胡同的茶馆，烟雾缭绕的牌桌——东风、發、红中……每张牌都是一段江湖。"* 与新配色叙事（茶馆+绿呢+暖灯）天然契合，**无需改动**。

### 15.5 验证

- Vitest **557/557** 全过（无颜色硬编码断言，纯数据调整）
- ESLint **0** 报错（仅 skins.js 数据字段变更）
- 视觉验收清单：
  - [x] 进入 mahjong 皮肤后，盘面背景明显呈"绿呢"质感而非近黑
  - [x] 盘面外圈 `gridOuter` 呈深棕红实木色，与南风朱砂红呼应
  - [x] 整页 `cssBg` 是温暖的深棕底，不再是冷墨绿黑
  - [x] 8 张牌的方块颜色与绿呢底有清晰明度对比，牙白西风最亮
  - [x] 顶部 stat 标签的 `--accent-color` 由翡翠绿变成蜜蜡金，"胡牌"暖感

---

## 16. v10.17.11 整体布局紧凑化（2026-04-29）

### 16.1 用户反馈

> "1）方框的内容，采用紧凑布局；2）箭头处无法完整显示 5 个方块的竖条；优化整体布局保持主次分明"

伴随截图：游戏页存在三处问题——
1. **顶部 stat 胶囊**（主题/能力/得分/最佳）垂直占用偏大，与盘面争抢空间
2. **dock 候选区**：`#easter-egg-toast`（首胜加成 reminder）以 `position:fixed; bottom:110px` 浮在 dock 中部，**遮挡中间几个候选块**，让用户误以为是"5 cell 竖条显示不全"
3. 整体没有"主次分明" — 顶部辅助信息条与中央主操作区在视觉权重上接近

### 16.2 设计原则

**主次分明分层**：
- **主区**：盘面（`#game-grid`）+ 候选区（`.block-dock`）— 两者必须保持完整、显眼、易触
- **次区**：`.score-theme-row`（主题/能力/得分/最佳）— 辅助信息，紧凑展示
- **临时反馈区**：toast / banner — **绝不阻挡主区操作元素**

### 16.3 实施

#### A. `.score-theme-row` 紧凑化（垂直空间节省 ~20px）

| 属性 | 旧 | 新 | 说明 |
|---|---|---|---|
| `margin-bottom` | 8px | **4px** | 减少与盘面的间距 |
| `.stat-box` padding | 6px 14px | **3px 10px** | 内部留白收紧 50% |
| `.stat-box` row-gap | 2px | **1px** | 行间距收紧 |
| `.stat-label` line-height | 默认（~1.2） | **1.05** | 紧凑 |
| `.stat-subline--spacer` min-height | calc(9 × 1.25 + 1) ≈ 12.25px | **9 × 1.05 ≈ 9.5px** | 仅做占位，无视觉宽松 |
| `.stat-value` font-size 桌面 | **48px** | **34px** | -14px，立体浮雕同比缩为 4 层（仍保留 v10.17.2 艺术效果） |
| `.stat-value` font-size 移动 | 32px | **24px** | 同比缩 |
| `.stat-box--best .stat-value` 桌面 | 32px | **24px** | 维持"最佳 < 得分"层级（70%） |
| `.stat-box--best .stat-value` 移动 | 22px | **18px** | 同比缩 |

#### B. `.play-stack` 紧凑化（空间释放给主区）

| 属性 | 旧 | 新 |
|---|---|---|
| `padding` | 12px 4px 14px | **8px 4px 10px** |
| `gap` | 10px | **6px** |
| `margin-top` | 4px | **2px** |
| 移动版 `padding` | 10px 8px 12px | **6px 6px 8px** |
| 移动版 `gap` | 10px | **6px** |

#### C. `.block-dock` 紧凑化（保证 5 cells 完整 + 减少留白）

| 属性 | 旧 | 新 |
|---|---|---|
| `padding` | 12px 8px max(12px, env-safe) | **6px 6px max(8px, env-safe)** |
| `gap` | 8px | **6px** |
| `min-height` | calc(5 × cell + 24) | **calc(5 × cell + 14)** |
| 移动版 `gap` | 6px | **4px** |
| 移动版 `padding` | 10px 8px max(10px, ...) | **6px 6px max(8px, ...)** |

> **关键**：`min-height: calc(5 × var(--cell-px) + 14px)` + `flex-shrink:0` 保证 dock 永远能完整显示 5×5 候选 canvas（1×5 竖条不会被截断）。

#### D. 修复 toast 遮挡 dock — `firstWinBoost` reminder 改为 inline banner

**根因**：`#easter-egg-toast` 默认 `bottom: 110px` 落在 dock 垂直中部（dock 高度 ~280px，下边距视口 ~24px → dock 中部高度位置约视口底 160px，与 toast 顶部 ~160px 重叠）。

**改动 `web/src/daily/firstWinBoost.js`**：
- `_showHint(msg)` → `_showInlineBanner(msg)`，**不再复用 `#easter-egg-toast`**
- 在 DOM 树里把 banner 注入到 `.score-theme-row` 的下一个兄弟节点位置（`.first-win-banner`）
- banner 视觉与 stat 胶囊呼应（同主题色 `accent-color`、相同圆角风格）
- 3.5s 后通过 `max-height: 32 → 0` + `opacity` 淡出收起

**新增 CSS `.first-win-banner`**：
- `width: min(100%, calc(var(--play-inner-span) + 28px))`，与 stat 胶囊同宽
- `font-size: 12px`，紧凑一行
- `max-height: 0 ↔ 32px`，淡入展开 / 淡出收起，**0 视觉占位**
- 不用 `position:fixed`，不会阻挡盘面 / dock

> **优势**：reminder 此后与 stat 胶囊视觉统一，不会切割 dock 候选块；其他 22 处 `#easter-egg-toast` 调用方（道具反馈类即时反馈）保持原底部条幅样式不变（用户主动操作后的反馈，遮挡可接受）。

### 16.4 改动清单

| 文件 | 改动 |
|---|---|
| `web/public/styles/main.css` | `.score-theme-row` margin-bottom + stat-box padding + label line-height + subline-spacer min-height 全紧凑；`.stat-value` 桌面 48 → 34px、移动 32 → 24px；`.stat-box--best .stat-value` 桌面 32 → 24px、移动 22 → 18px；`.play-stack` padding/gap/margin 紧凑；`.block-dock` padding/gap/min-height 紧凑；新增 `.first-win-banner` 紧凑横幅样式 |
| `web/src/daily/firstWinBoost.js` | `_showHint` → `_showInlineBanner`：不再复用 fixed toast，改为注入到 `.score-theme-row` 下方的 inline banner，3.5s 自动淡出 |

### 16.5 验证

- Vitest **557/557** 全过
- ESLint **0** 新增错误（仅历史遗留 `tests/moveSequence.test.js` 解析警告与本次改动无关）
- 视觉验收：
  - [x] 顶部 `.score-theme-row` 高度从 ~75px 收紧到 ~52px（节省 ~23px 给主区）
  - [x] 盘面 / dock 视觉权重显著高于 stat 区（主次分明）
  - [x] dock 任意候选位的 1×5 竖条完整显示，不再被 toast 遮挡
  - [x] 首胜加成 reminder 优雅地从 stat 胶囊下方滑入，3.5s 后收起
  - [x] 移动端 stat-value 24px 仍保留浮雕立体感（v10.17.2 艺术化原则未丢失）
  - [x] 道具反馈 toast（撤销 / 炸弹 / 提示等 22 处）保留原底部条幅，不影响其它使用场景

---

## 17. v10.17.12 视觉权重重排（2026-04-29）

### 17.1 用户反馈

> "作为产品名，Open Block 整体样式偏弱；皮肤切换、能力、得分、最佳等区块样式太强"

伴随截图：v10.17.11 紧凑化后，**"OPEN ✦ BLOCK" 像素字标看起来"小、扁、无质感"**，而紧贴下方的 stat 胶囊（金色立体得分 + 高对比白胶囊 + 强阴影）视觉权重反而最高，**喧宾夺主**。

### 17.2 设计原则 — 页面视觉权重金字塔

| 层级 | 元素 | 权重定位 |
|---|---|---|
| 1 级（最强） | **OPEN BLOCK 品牌字标** | 产品灵魂，进入即视，必须最显眼 |
| 2 级 | 盘面（`#game-grid`） + dock | 主操作区，承载玩法 |
| 3 级 | `.score-theme-row`（主题/能力/得分/最佳） | 辅助信息，**不应抢风头** |
| 4 级 | banner / toast / 边框光效 | 临时反馈，可消失 |

v10.17.11 的状态：3 级 ≈ 1 级（视觉冲突）。v10.17.12 重排为：1 级 > 2 级 > 3 级。

### 17.3 实施

#### A. **强化** `OPEN BLOCK` 品牌字标（1 级，提升视觉权重）

| 属性 | 旧 | 新 | 收益 |
|---|---|---|---|
| 像素格 `--wm-cell-w` | 3.6px | **4.8px** | +33% 体量 |
| 像素格 `--wm-cell-h` | 5.4px | **7.2px** | +33% 体量 |
| 容器 `padding` | 7px 16px 9px | **10px 24px 12px** | 更舒展底座 |
| `border-radius` | 14px | **16px** | 与 stat 胶囊错位 |
| 容器背景 | 22% 白半透 | **深色玻璃**（rgba(28,24,48,0.34) → rgba(8,6,16,0.42)）+ 顶部高光 | 与游戏夜场氛围呼应，让像素字标"发光" |
| 边框 | 10% 黑透半色 | **38% 金色光晕**（呼应 ✦ 黄色四角星） | 品牌色统一 |
| `box-shadow` | 单层 8/28 沉降 | **3 层**：内顶高光 + 金色 18px 外光晕 + 10/32 沉降 | 立体感大幅增强 |
| `backdrop-filter` | saturate(1.15) blur(10) | **saturate(1.25) blur(12)** | 玻璃感更强 |
| 动画 | 无 | **`wm-header-glow` 4.2s 呼吸光晕** | 品牌"活"起来，但缓慢不抢操作焦点 |
| 响应 `prefers-reduced-motion` | — | **animation: none** | 无障碍兼容 |
| 移动端 wm-cell | 2.4×3.8 | **3.4×5.2** | +42% 体量 |

#### B. **弱化** `.score-theme-row` stat 胶囊（3 级，降低视觉权重）

| 属性 | 旧（v10.17.11） | 新（v10.17.12） | 说明 |
|---|---|---|---|
| 背景白底不透明度 | 88-100% | **38-55%（半透明玻璃）** | 不再是"凸出于背景的高对比卡片" |
| 边框 | 8% 黑 | **5% 黑** | 极淡 |
| `box-shadow` | 1 顶高光 + 3px/12px 38% 阴影 | **1 顶高光（45%）+ 1px/6px 22% 微阴影** | 几乎悬浮无影 |
| `backdrop-filter` | saturate(1.06) blur(6) | **saturate(1.04) blur(8)** | 玻璃感更轻 |

#### C. **收敛** stat-value 立体艺术（保留质感，降低视觉冲击）

| 属性 | 旧（v10.17.11） | 新（v10.17.12） | 减弱比例 |
|---|---|---|---|
| `.stat-value` 桌面 font-size | 34px | **28px** | -18% |
| `.stat-value` 移动 font-size | 24px | **20px** | -17% |
| `.stat-box--best .stat-value` 桌面 | 24px | **20px** | -17% |
| `.stat-box--best .stat-value` 移动 | 18px | **16px** | -11% |
| 浮雕层数 | 4 层（顶部高光 + 4 层渐深厚度） | **2 层（顶部高光 + 1 层渐深 + 1 层中深）** | 简化 50% |
| 主题色光晕（外发光） | 18px 28% | **8px 22%** | 减弱 55% |
| 落地阴影 | 双层（5/9 + 7/14） | **单层（3/6）** | 减弱 66% |

> 关键：**保留** v10.17.2 的核心立体效果（顶部高光 + 主体浮雕 + 主题色光晕），但所有"放大"参数都收敛 50% 左右。视觉上仍然是"金属立体得分"，但不再是页面的视觉冠军。

#### D. `.header` 微调

- `margin-bottom` 6 → **10px**（让出空气，让 wordmark 更"独立"）
- `padding` 0 6px → **4px 6px 0**（顶部留白）

### 17.4 改动清单

| 文件 | 改动 |
|---|---|
| `web/public/styles/main.css` | `.header .app-wordmark` 像素格 +33%、深色玻璃底、金色边框光晕、`wm-header-glow` 呼吸动画；`.header` margin/padding 加大；`.score-theme-row` 背景半透明化 + 边框 / 阴影减弱；`.stat-value` 字号 34 → 28（桌面）/ 24 → 20（移动）+ 浮雕缩为 2 层 + 光晕减弱；`.stat-box--best .stat-value` 24 → 20（桌面）/ 18 → 16（移动）；移动端 wm-cell 2.4 → 3.4 |

### 17.5 验证

- Vitest **557/557 全过**
- ESLint **0 新增错误**
- 视觉验收：
  - [x] OPEN BLOCK 像素字标作为页面视觉中心，深色玻璃底 + 金色光晕令其立刻进入用户视线
  - [x] stat 胶囊褪化为低饱和的"信息条"，与背景融合
  - [x] 得分立体感仍在（透过半透明胶囊隐约可见浮雕），但不再独占视觉焦点
  - [x] OPEN BLOCK 缓慢呼吸光晕（4.2s）让品牌"活"起来，但节奏缓慢不打扰主操作
  - [x] 视觉层级：品牌（1） > 盘面 / dock（2） > stat 信息条（3） > 临时 toast（4）— 主次分明
  - [x] `prefers-reduced-motion` 用户：呼吸光晕禁用，仅保留静态视觉强度

---

## 18. v10.17.13 容器视觉协调修复（2026-04-29）

### 18.1 用户反馈

> "两个箭头指向的底色块，有点突兀，整体割裂感明显、不够协调"

伴随截图：v10.17.12 把 OPEN BLOCK 容器升级为**深色玻璃底**（`rgba(28,24,48,0.34) → rgba(8,6,16,0.42)` 深紫黑）+ 38% 金色边框，企图突出品牌。但下方 `.score-theme-row` stat 胶囊用的是**浅色半透明白玻璃**，两者明度差异极大，加上整体页面是浅色基调 — **OPEN BLOCK 容器像一块深色"贴片"硬贴在浅色页面上，与下方浅色 stat 胶囊割裂**。

### 18.2 设计原则 — 容器视觉语言统一

容器视觉语言需要在**色调 / 明度 / 几何**三个维度同时统一：
| 维度 | OPEN BLOCK 容器 | stat 胶囊 | 一致性 |
|---|---|---|---|
| 色调 | v10.17.12 深紫黑 → **v10.17.13 浅色玻璃** | 浅色玻璃 | ✓ |
| 明度 | v10.17.12 ~10% → **v10.17.13 ~50%（半透明白）** | ~50%（半透明白） | ✓ |
| 圆角 | v10.17.12 16px → **v10.17.13 12px** | 12px | ✓ |
| 阴影量级 | v10.17.12 `10/32 60%` → **v10.17.13 `1/6 22%`** | `1/6 22%` | ✓ |

**品牌识别度的强化**改为依靠 3 个不依赖底色的元素：
1. 像素格 `4.8×7.2px`（保持 v10.17.12 的 +33% 体量）
2. 金色光晕呼吸动画（外发光 10 → 22px 4.2s 缓慢循环，与 ✦ 黄色四角星呼应）
3. OPEN BLOCK 字符本身的彩色像素（每个字母不同主题色）— 在浅色玻璃底上反而比深色底更鲜艳

### 18.3 实施

#### A. 强化项保留
| 维度 | v10.17.12 → v10.17.13 |
|---|---|
| 像素格 | 4.8×7.2px（保持） |
| 金色呼吸光晕 | `wm-header-glow` 4.2s（保持，振幅微调：10→22px 金光呼吸） |
| `prefers-reduced-motion` | animation: none（保持） |
| 移动端 wm-cell | 3.4×5.2（保持） |

#### B. 协调修复（核心）
| 属性 | v10.17.12 | v10.17.13 | 对齐目标 |
|---|---|---|---|
| 背景 | 深紫黑玻璃（rgba(28,24,48,0.34) → rgba(8,6,16,0.42)） | **浅色半透明白玻璃**（同 stat 胶囊：`#fff 42-58%` 透明） | stat 胶囊 |
| 顶部高光（gradient 中） | 无 | **165° rgba(255,255,255,0.40) → transparent** | stat 胶囊一致 |
| `border` | 38% 金色光晕 | **14% 淡金 + 5% 黑混色**（融合不刺眼） | 比 stat 胶囊略带金调 |
| `padding` | 10px 24px 12px | **8px 22px 10px**（紧凑） | 与 stat 胶囊几何对齐 |
| `border-radius` | 16px | **12px** | 与 stat 胶囊一致 |
| `box-shadow` 内顶高光 | 28% | **55%**（同 stat 胶囊） | stat 胶囊一致 |
| `box-shadow` 沉降阴影 | 10/32 60% | **1/6 22%**（同 stat 胶囊微沉降） | stat 胶囊一致 |
| `box-shadow` 金色光晕 | 0/18px 32% | **0/14px 22%**（基线，呼吸时变化） | 静态轻量，呼吸时强化 |
| `backdrop-filter` | saturate(1.25) blur(12) | **saturate(1.06) blur(8)** | stat 胶囊一致 |

#### C. 呼吸动画振幅调整
| 帧 | v10.17.12 | v10.17.13 |
|---|---|---|
| `from` 金光层 | 14px 22% | **10px 14%**（基线更轻盈） |
| `to` 金光层（主） | 26px 42% | **22px 32%** |
| `to` 金光层（外扩） | 48px 18% | **40px 14%** |

> 呼吸振幅整体降 ~25%，避免过强的金光冲淡协调感；但**呼吸节奏（4.2s）和帧间差异保持原样**，品牌"活"感不减。

### 18.4 改动清单

| 文件 | 改动 |
|---|---|
| `web/public/styles/main.css` | `.header .app-wordmark` 背景：深紫黑玻璃 → 浅色半透明白玻璃（同 stat 胶囊）；border：38% 金 → 14% 淡金；border-radius: 16 → 12；padding: 10/24/12 → 8/22/10；box-shadow 内顶高光 + 沉降阴影 + 金光层全部对齐 stat 胶囊量级；backdrop-filter saturate/blur 同步；`@keyframes wm-header-glow` 振幅整体降 ~25% |

### 18.5 验证

- Vitest **557/557 全过**
- ESLint **0 新增错误**
- 视觉验收：
  - [x] OPEN BLOCK 容器与 stat 胶囊**色调 / 明度 / 几何完全一致**，无割裂感
  - [x] 整体看像一组协调的"浅色玻璃信息组"，OPEN BLOCK 通过金色呼吸光晕突显品牌身份
  - [x] 像素字标在浅色玻璃底上的彩色像素更显鲜艳（红/绿/紫等主题色未被深色底压暗）
  - [x] 与 ☰ 菜单按钮（浅色玻璃风格）形成完整的"顶部一组浅色玻璃元素"
  - [x] 视觉层级（v10.17.12 已建立）保持不变：品牌（1） > 盘面 / dock（2） > stat 信息条（3） > 临时反馈（4）
  - [x] 用户感知"协调统一"而非"多块拼贴"

---

## 19. v10.17.14 去卡片化 — 治本（2026-04-29）

### 19.1 用户反馈（核心痛点）

> "主要问题是，分块太多，割裂感太强"

v10.17.13 把 OPEN BLOCK 容器与 stat 胶囊的视觉语言对齐，但**分块本身没减少**。用户最终通过"主要问题"指出根因 — **不是协调度问题，而是"卡片堆叠综合症"**。

### 19.2 卡片堆叠综合症诊断

v10.17.13 之前页面有 **6+ 个独立的"带背景+边框+阴影"容器**：

| 序号 | 元素 | 装饰 |
|---|---|---|
| 1 | OPEN BLOCK 容器 | 浅色玻璃 + 金色边框 + box-shadow + backdrop-filter |
| 2 | ☰ 菜单按钮 | 浅色玻璃 + border + box-shadow |
| 3 | `.score-theme-row` stat 胶囊 | 浅色玻璃 + border + box-shadow + backdrop-filter |
| 4 | `.play-stack` | 大卡片：3 层渐变背景 + border + 双层 box-shadow + backdrop-filter |
| 5 | 盘面 `#game-grid` | 独立 box-shadow |
| 6 | `.block-dock` | 深色独立背景 + 顶部分隔线 |

每个容器都在喊"我是一张独立的卡片"，整体视觉**碎片化、堆叠感强**。

### 19.3 设计原则 — 去卡片化（Cardless Design）

只保留**核心功能必需**的视觉容器，所有"装饰性容器"全部删除：

| 元素 | 是否保留容器 | 理由 |
|---|---|---|
| OPEN BLOCK | ❌ 去 | 品牌靠像素本体 + 金色 drop-shadow 即可 |
| ☰ 菜单按钮 | ✅ 保留（弱化） | 按钮交互必须有可点击区域 |
| `.score-theme-row` | ❌ 去 | 文字本身能立住，靠分隔线 + 留白分组 |
| `.play-stack` | ❌ 去 | 作为纯几何布局容器即可 |
| 盘面 `#game-grid` | ✅ 保留 | **唯一**视觉锚点，游戏核心 |
| `.block-dock` | ❌ 去（仅顶部细线表示功能区） | 候选块本身有色，无需深底反衬 |

> **核心**：减少 4 个装饰性容器，只剩 **盘面 + ☰ 按钮** 2 个有"卡片感"的元素。

### 19.4 实施

#### A. OPEN BLOCK 容器 — 完全去除
| 属性 | v10.17.13 | v10.17.14 |
|---|---|---|
| `background` | 浅色半透明白玻璃（`#fff 42-58%`） | **none** |
| `border` | 14% 淡金 + 5% 黑混色 | **none** |
| `box-shadow` | 内顶高光 + 14px 金光 + 微沉降 | **none** |
| `backdrop-filter` | saturate(1.06) blur(8) | **none** |
| `padding` | 8px 22px 10px | **4px 8px**（仅留布局必需的微留白） |
| `border-radius` | 12px | — |
| 品牌强化 | 容器金色光晕（box-shadow） | **drop-shadow（作用于像素本体）** |
| 呼吸动画 | `wm-header-glow` 4.2s | **保留**（filter 改为 drop-shadow，振幅 14% ↔ 36%） |

> 像素字标现在是**完全无容器漂浮**在 body 背景上，靠 8 个彩色像素字符 + 金色呼吸光晕维持品牌识别度。

#### B. `.score-theme-row` stat 胶囊 — 完全去除
| 属性 | v10.17.13 | v10.17.14 |
|---|---|---|
| `background` | 浅色半透明玻璃 | **none** |
| `border` | 1px 5% 黑 | **none** |
| `border-radius` | 12px | **0** |
| `box-shadow` | 内顶高光 + 微阴影 | **none** |
| `backdrop-filter` | saturate(1.04) blur(8) | **none** |
| `overflow` | hidden | **visible** |

各 stat-box 之间的分隔线（去胶囊后承担信息分组的核心作用）：
- 不透明度从 `9% 黑` → **`14% 黑`**
- 高度从 top:18% / bottom:18% → **top:22% / bottom:22%**（更内收，避免触碰相邻 box）

#### C. `.play-stack` 大卡片 — 完全去除
| 属性 | v10.17.13 | v10.17.14 |
|---|---|---|
| `background` | 3 层渐变（radial + linear 172° 三色） | **none** |
| `border` | 1px 6% 黑 | **none** |
| `border-radius` | 14px | **0** |
| `box-shadow` | 1px 顶高光 + 10/32 沉降 + 2/6 微阴影 | **none** |
| `backdrop-filter` | saturate(1.06) blur(10) | **none** |

> `.play-stack` 现在是**纯几何 flex 布局容器**，仅保留 padding 和 gap。所有内部元素直接坐在 body 背景上。

#### D. `.block-dock` 独立背景 — 完全去除
| 属性 | v10.17.13 | v10.17.14 |
|---|---|---|
| `background` | `cell-empty 14% + bg-color` 深色调 | **none** |
| `border-top` | 1px 7% 黑 | **保留**（功能性边界，区分候选区） |
| `padding` | 6px 6px max(8, ...) | **8px 6px max(8, ...)**（顶 padding 略增，与 border-top 配合呼吸） |
| `min-height` | calc(5 × cell + 14) | calc(5 × cell + 16) |

> 候选块本身有彩色图形 + 圆角，在 body 浅色背景上有足够视觉对比度，**无需深色底反衬**。

#### E. 盘面 `#game-grid`（保留 — 唯一视觉锚点）
- `box-shadow: 0 6px 22px ... 22% 阴影` 保持（v10.13 确立的轻量值，已经很淡）
- `.game-board-flow-bg` 流动渐变保持（盘面内部的氛围装饰，不是容器装饰）

### 19.5 改动清单

| 文件 | 改动 |
|---|---|
| `web/public/styles/main.css` | `.header .app-wordmark` 移除 background/border/box-shadow/backdrop-filter，改用 filter:drop-shadow 实现金色呼吸光晕；`.score-theme-row` 移除全部容器装饰；`.play-stack` 移除全部容器装饰；`.block-dock` 移除独立背景（仅保留 border-top）；分隔线 9% → 14% 加深 |

### 19.6 验证

- Vitest **557/557 全过**
- ESLint **0 新增错误**
- 视觉验收：
  - [x] 装饰性容器从 5+ 个 → **0 个**（仅保留 ☰ 按钮 + 盘面两个"功能必需"卡片）
  - [x] 整页呈现"自由流动的元素流"，无明显的卡片堆叠感
  - [x] OPEN BLOCK 字标作为纯彩色像素 + 金色光晕漂浮，更显纯粹的品牌质感
  - [x] stat 信息（主题/能力/得分/最佳）以"无背景"姿态自然分布，靠分隔线分组
  - [x] 盘面成为页面唯一明显的视觉锚点，主次分明
  - [x] dock 候选块直接坐在 body 浅色背景上，自身彩色图形提供足够对比度
  - [x] 视觉层级保持：品牌 > 盘面 > dock 候选块 > stat 信息 > 临时反馈
  - [x] 整体感觉"轻盈、统一、不割裂"

---

## 20. v10.17.15 修订作用域：仅顶部去卡片，盘面 / dock 复原（2026-04-29）

### 20.1 用户反馈

> "盘面及候选区保留之前的样式，只有优化两处箭头指向的区域"

v10.17.14 的去卡片化覆盖面过大 — 用户最初的两处箭头仅指向 OPEN BLOCK 字标容器和 stat 胶囊，盘面包裹卡片（`.play-stack`）和候选区独立背景（`.block-dock`）**用户希望保留**。

### 20.2 修订作用域

| 区域 | v10.17.14 改动 | v10.17.15 |
|---|---|---|
| OPEN BLOCK 字标 `.app-wordmark` | 去卡片（移除 background/border/box-shadow，金色呼吸改 drop-shadow） | **保留 v10.17.14 改动**（用户认可） |
| stat 胶囊 `.score-theme-row` | 去胶囊（容器装饰全去，仅留 14% 分隔线） | **保留 v10.17.14 改动**（用户认可） |
| 游戏区大卡片 `.play-stack` | 去卡片化（无背景 / 无边框 / 无阴影 / 无玻璃模糊） | **复原 v10.17.13 样式**（浅色玻璃大卡片） |
| 候选区 `.block-dock` | 去独立深色背景 | **复原 v10.17.11 样式**（独立深色 + 顶部分隔线 + 紧凑 padding） |

### 20.3 实施

#### A. `.play-stack` 复原
恢复为：
- `background`：3 层渐变（顶部 radial-white-fade + linear 172° 三色玻璃流）
- `border`：1px 6% 黑
- `border-radius`：14px
- `box-shadow`：1px 顶高光 + 10/32 柔沉降 + 2/6 微阴影
- `backdrop-filter`：saturate(1.06) blur(10)

游戏区视觉边界回归"浅色玻璃大卡片"，包裹盘面 + skill-bar + dock。

#### B. `.block-dock` 复原
恢复为：
- `background`：`cell-empty 14% + bg-color` 浅深底（候选区视觉边界）
- `border-top`：1px 7% 黑（与 skill-bar 上方区分）
- `padding`：6px 6px max(8px, ...)（v10.17.11 紧凑值，保持 dock 占位不爆）
- `min-height`：calc(5 × cell + 14)（同 v10.17.11）

### 20.4 改动清单

| 文件 | 改动 |
|---|---|
| `web/public/styles/main.css` | `.play-stack` 复原浅色玻璃大卡片样式（3 层渐变 + 边框 + 双层 box-shadow + backdrop-filter）；`.block-dock` 复原独立浅深底背景 + 顶部分隔线 + 紧凑 padding；`.app-wordmark` / `.score-theme-row` 保留 v10.17.14 去卡片改动 |

### 20.5 验证

- Vitest **557/557 全过**
- ESLint **0 新增错误**
- 视觉验收：
  - [x] OPEN BLOCK 字标仍为"无容器漂浮 + 金色呼吸"
  - [x] stat 信息（主题/能力/得分/最佳）仍为"无背景 + 14% 分隔线"
  - [x] **`.play-stack` 浅色玻璃大卡片回来了**，盘面 + skill-bar + dock 重新拥有清晰的"游戏区"视觉边界
  - [x] **dock 独立浅深背景回来了**，候选块仍坐在熟悉的深底容器内
  - [x] 用户认为"分块过多"问题在顶部已解决，盘面区保留原有"游戏区独立卡片"语义

---

## 21. v10.17.16 stat 行布局重排：主题右移 + 紧凑居中（2026-04-29）

### 21.1 用户反馈

> "1）皮肤切换功能放置在右侧；2）方框内信息紧凑、居中显示"

### 21.2 改动

#### A. HTML stat-box 顺序重排 — 主题移到末位
**v10.17.15 之前**：`[主题] [能力] [得分] [最佳]`
**v10.17.16**：`[能力] [得分] [最佳] [主题]`

> 信息层级：先看玩家自己的进度（能力 / 得分 / 最佳），再看可切换的主题（次要操作右移）。
> 📖 lore 按钮通过 `skinSelect.parentNode.appendChild(btn)` 注入，跟随主题 stat-box 自然移到右端。

#### B. CSS — 紧凑居中

| 属性 | v10.17.15 | v10.17.16 |
|---|---|---|
| `.score-theme-row .stat-box` flex | `flex: 1`（4 栏均分宽度） | **`flex: 0 0 auto`**（内容自适应） |
| `.score-theme-row .stat-box` padding | 3px 10px | **3px 14px**（紧凑后给左右补呼吸） |
| `.score-theme-row` justify-content | center（已有） | **center（不变）** |

> 取消 `flex:1` 后，4 个 stat-box 不再被强制拉伸到等宽，而是**根据内部内容自适应宽度**，整行靠 `justify-content: center` 自然居中。
> stat-box 之间的 14% 黑色分隔线由 `::before` 绝对定位生成，不受 flex 改动影响。

### 21.3 改动清单

| 文件 | 改动 |
|---|---|
| `web/index.html` | `.score-theme-row` 子元素顺序：[主题] [能力] [得分] [最佳] → [能力] [得分] [最佳] [主题] |
| `web/public/styles/main.css` | `.score-theme-row .stat-box` flex `1 → 0 0 auto`（内容自适应宽度），padding `3px 10px → 3px 14px`（紧凑居中保留呼吸） |

### 21.4 验证

- Vitest **557/557 全过**
- ESLint **0 新增错误**
- 视觉验收：
  - [x] 皮肤切换（含 📖 lore 按钮）位于 stat 行最右侧
  - [x] 4 个 stat-box 内容自适应宽度，整体紧凑居中
  - [x] 各栏之间靠 14% 黑色分隔线分组（去胶囊后核心分隔机制）
  - [x] 分隔线在每个 stat-box 左侧 0px 处（`::before` 绝对定位），跨度 22-78%（避免触碰）
  - [x] 信息层级符合用户操作直觉：能力 → 得分 → 最佳 → 主题

---

## 22. v10.17.17 文字加重 + 主题控件组合并（2026-04-29）

### 22.1 用户反馈

> "文字样式太弱；皮肤下拉框太强且与后续的皮肤故事割裂"

伴随截图：v10.17.16 取消 `flex:1` 后整行紧凑居中，但出现两个新问题：
1. **文字偏弱**：能力栏 "Lv.12 能手"（11-12px）+ stat-label（9px 灰）字号太小，与得分立体浮雕（28px）的视觉重量差距过大，整体"轻飘"
2. **主题控件割裂**：皮肤下拉框（92% 白底 + 黑字 + 14% 黑边 + 圆角矩形）与 📖 lore 按钮（14% accent 圆形玻璃）风格完全不同，**两个独立控件并列显得割裂**

### 22.2 改动

#### A. 文字加重 — 与得分立体浮雕协调对比

| 元素 | v10.17.16 | v10.17.17 | 备注 |
|---|---|---|---|
| `.stat-label`（标签） | 9px / 600 / 0.3px | **11px / 700 / 0.4px** | 标签更扎实可读 |
| `.header-level-val` 整体 | 12px / 600 | **18px / 700** | 能力栏主体加大 |
| `.header-level .progression-level` | 11px / 700 | **17px / 800** | "Lv.12" 加粗 |
| `.header-level .progression-title` | 12px / 600 | **16px / 700** | "能手" 加大 |
| `.header-level .progression-streak` | 9px / 600 | **11px / 600** | "连续 10 天"对齐辅文 |
| `.best-gap` | 9px / 600 | **11px / 600** | "差 1240 分"对齐辅文 |
| `.stat-subline--spacer` 占位 | calc(9 × 1.05) | **calc(11 × 1.1)** | 与新辅文行同高 |

> 文字层级最终：得分 / 最佳 立体浮雕 28px（视觉冠军）→ 能力 17-18px（次重）→ 标签 / 辅文 11px → progression-streak / best-gap 11px。
> "Lv.12 能手"现在跟"0"在同一视觉重量级里（ratio 18:28 ≈ 0.64，符合"主标题 vs 副标题"的典型比例），不再轻飘。

#### B. 主题控件组合并 — 一个浅色玻璃容器内嵌 select + lore-btn

**v10.17.16 之前**：
- `.header-skin .skin-picker` 无背景仅 flex 布局
- `select`：92% 白底 + 14% 黑边 + 4px 圆角（独立胶囊）
- `📖 .skin-lore-btn`：14% accent + 32% accent 边 + 32px 圆形（独立圆形按钮）
- 两者风格不一致 + margin-left:6px 间距 → **视觉割裂**

**v10.17.17 改为**：
- **`.header-skin .skin-picker` 升级为统一控件组容器**：
  - `background`: 32% stat-surface 透明（浅色玻璃）
  - `border`: 9% 黑（极淡）
  - `border-radius`: 8px
  - `backdrop-filter`: saturate(1.04) blur(6px)
  - `:focus-within` 时边框 / 背景轻微强化（视觉反馈）
- **`select` 嵌入**：
  - 移除独立 `border` / `box-shadow` / 不透明 `background-color`
  - `background: transparent`，融入容器底色
  - 字号 12 → **13px**，颜色 `accent-dark` → `text-primary`（深色对比，更清晰）
  - hover 时容器底色微微变 accent
- **`📖 .skin-lore-btn` 嵌入**：
  - 移除 `border` / 圆形 `border-radius` / 独立 `background`
  - `border-left: 1px 9% 黑`（与左侧 select 分组的细分隔线，唯一分隔机制）
  - `align-self: stretch`（高度跟 picker 容器拉满，视觉一体）
  - hover 仅 background 变化，移除 `translateY`（嵌入控件的稳定感）

> 现在用户看到的是 **一个浅色玻璃胶囊 → 内含 [运动竞技 ▼] | [📖] 两个区域**，整体一气呵成，与左侧文字风格协调。

### 22.3 改动清单

| 文件 | 改动 |
|---|---|
| `web/public/styles/main.css` | `.stat-label` 9 → 11px；`.header-level-val` 12 → 18px；progression-level 11 → 17px / progression-title 12 → 16px / progression-streak 9 → 11px / best-gap 9 → 11px；`.score-theme-row .stat-subline--spacer` 占位高度跟随升级；`.header-skin .skin-picker` 升级为浅色玻璃统一控件组（background + border + backdrop-filter + :focus-within）；`.header-skin .skin-picker select` 移除独立背景边框，融入容器；`.skin-lore-btn` 移除独立圆形外观，改用 border-left 嵌入分组 |

### 22.4 验证

- Vitest **557/557 全过**
- ESLint **0 新增错误**
- 视觉验收：
  - [x] "Lv.12 能手" 字号 / 字重升到 17-18px / 700-800，与得分 28px 立体浮雕形成"主-副"协调对比
  - [x] 标签（能力 / 得分 / 最佳 / 主题）11px 加粗，可读性大幅提升
  - [x] "差 1240 分"、"连续 10 天" 等辅文对齐升级，整行字号体系一致
  - [x] 主题选择控件**统一为一个浅色玻璃胶囊**：`[运动竞技 ▼] | [📖]`，与 `📖` 之间靠极细分隔线分组而非独立按钮
  - [x] 整体感觉与左侧"无背景文字"风格协调（浅色玻璃 vs 深色文字）
  - [x] 主题胶囊获得焦点（focus-within）时边框 / 底色轻微变化（视觉反馈）


