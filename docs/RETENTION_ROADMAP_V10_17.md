# 玩家留存 / 活跃提升 sprint（v10.17）

> 路线图入口：[`canvases/player-retention-roadmap.canvas.tsx`](../.cursor/projects/Users-admin-Documents-work-opensource-openblock/canvases/player-retention-roadmap.canvas.tsx)
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

每个币种设单日发放上限（`DAILY_GRANT_CAP`），超出截断；特殊 source 绕过。

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
    'iap', 'season-chest-grand', 'lucky-wheel-grand',
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
| [`EASTER_EGGS_AND_DELIGHT.md`](./EASTER_EGGS_AND_DELIGHT.md) | v10.15-v10.16.6 彩蛋系统与道具栏 |
| [`MONETIZATION_CUSTOMIZATION.md`](./MONETIZATION_CUSTOMIZATION.md) | 商业化策略层（13 条规则 / 6 类分群） |
| [`SKINS_CATALOG.md`](./SKINS_CATALOG.md) | 36 款皮肤总览（含 v10.16 章节） |
| `canvases/player-retention-roadmap.canvas.tsx` | 留存路线图（带 4 周 sprint 与度量指标） |
