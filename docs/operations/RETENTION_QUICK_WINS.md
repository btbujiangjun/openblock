# 留存优化快赢清单（精确到文件 / 函数 / 行号）

> **定位**：[留存信号跨平台分析](./RETENTION_SIGNALS_CROSS_PLATFORM.md) 是策略层；本文是**工程落地层**——精确到要改哪个文件、哪个函数、哪一行，改动前后什么样、配套测试怎么写、上线护栏指标是什么。
>
> **使用方式**：按 § 序号领取任务；每个 § 是一个独立 PR，可平行实施。
>
> **代码基准**：v1.60.44（提交 `7c5913d`）
>
> **实施状态**：✅ §1–§10 已全部完成（v1.60.45，2129 个回归测试通过）。本文保留作为
> 设计依据 + 验证清单——线上数据回流后按 §6 验证方法回写 A/B 结果。

---

## 优化点速查表

| # | 标题 | 平台 | 工作量 | 文件 | 难度 | 阻塞依赖 |
|---|---|---|---|---|---|---|
| **§1** | platformProfile 基础设施 | 共性 | 0.5d | 新建 1 文件 | ★☆☆ | 无（其余 §2–§4 依赖） |
| **§2** | `MONO_FLUSH_PICK_PROBABILITY` 平台化 | Android | 0.5d | `blockSpawn.js` | ★☆☆ | §1 |
| **§3** | `multiClearBonus` Android 抬高 | Android | 0.5d | `adaptiveSpawn.js` | ★☆☆ | §1 |
| **§4** | `REVIVE_LIMIT` 平台化 | Android | 0.5d | `revive.js` | ★☆☆ | §1 |
| **§5** | `roundsSinceLastDelight` 追踪 + intent 规则 | 共性 | 1.5d | `playerProfile.js` + `intentResolver.js` + `game.js` | ★★☆ | 无 |
| **§6** | 复活后强 `forceReliefIntent` | 共性 | 0.5d | `revive.js` + `game.js` | ★☆☆ | §5（共用 forceReliefIntent 通路） |
| **§7** | PB 突破后次级目标 | 共性 | 1d | `bestScoreBuckets.js` + `game.js` | ★★☆ | 无 |
| **§8** | "爽感覆盖率" 看板指标 | 共性 | 1d | `server.py` + `opsDashboard.js` | ★★☆ | §5 |
| **§9** | iOS 广告分层（按完播率分桶） | iOS | 1d | `strategyConfig.js` | ★★☆ | §1 |
| **§10** | Android 每日 3 次高分挑战 | Android | 2d | 新建 `dailyChallengePlaybook.js` | ★★★ | §1 |

总工作量约 **9 人日**。强烈建议从 §1 → §2/§3/§4 串行（共享基础设施），其他可并行。

---

## §1. 基础设施：`platformProfile` 单源平台判定

**问题**：当前 `web/src/` 全局无平台判定函数，无法实现"按平台分发参数"。

**新建文件**：`web/src/config/platformProfile.js`

```javascript
/**
 * platformProfile.js — 单源平台判定（Web / iOS / Android / WeChat）。
 *
 * 设计原则：
 *   - 单源：所有需要按平台分发的配置（出块、复活、商业化）都从这里读
 *   - 静态：一次启动只判定一次，缓存为 module-level const，避免运行时反复查询
 *   - 渐进：浏览器侧用 navigator.userAgent；Capacitor 壳里覆盖为 'ios'/'android'；
 *           小程序侧引入时硬编码 'wechat'
 *
 * 取值：
 *   - 'ios'      — iOS WebView（Safari / Capacitor iOS）
 *   - 'android'  — Android WebView（Chrome / Capacitor Android）
 *   - 'wechat'   — 微信小程序（小程序入口注入）
 *   - 'web'      — 桌面浏览器 / 未识别
 */

let _cached = null;

function _detect() {
    if (typeof globalThis !== 'undefined' && globalThis.__OPENBLOCK_PLATFORM__) {
        // 小程序 / Capacitor 壳启动时显式注入
        return String(globalThis.__OPENBLOCK_PLATFORM__);
    }
    if (typeof navigator === 'undefined' || !navigator.userAgent) return 'web';
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (/MicroMessenger/i.test(ua)) return 'wechat';
    return 'web';
}

/** 平台 id（'ios' | 'android' | 'wechat' | 'web'）。 */
export function getPlatform() {
    if (_cached === null) _cached = _detect();
    return _cached;
}

/** 仅供测试用：强制覆写平台缓存（生产代码勿用）。 */
export function _setPlatformForTest(p) { _cached = p; }

/**
 * 平台化配置查询：传入 { ios, android, wechat, web, default } map，
 * 返回当前平台对应值；未命中返回 default 或 undefined。
 *
 * @example
 *   const monoFlushRate = pickByPlatform({
 *       ios: 0.033, android: 0.050, wechat: 0.050, default: 0.033
 *   });
 */
export function pickByPlatform(map) {
    const p = getPlatform();
    if (map[p] !== undefined) return map[p];
    return map.default;
}
```

**测试**：新建 `tests/platformProfile.test.js`

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { getPlatform, pickByPlatform, _setPlatformForTest } from '../web/src/config/platformProfile.js';

describe('platformProfile', () => {
    beforeEach(() => { _setPlatformForTest(null); });

    it('UA = iPhone → ios', () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit' },
            configurable: true,
        });
        expect(getPlatform()).toBe('ios');
    });

    it('UA = Android → android', () => {
        Object.defineProperty(globalThis, 'navigator', {
            value: { userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit' },
            configurable: true,
        });
        expect(getPlatform()).toBe('android');
    });

    it('__OPENBLOCK_PLATFORM__ override 优先', () => {
        globalThis.__OPENBLOCK_PLATFORM__ = 'wechat';
        expect(getPlatform()).toBe('wechat');
        delete globalThis.__OPENBLOCK_PLATFORM__;
    });

    it('pickByPlatform 命中 + 回落 default', () => {
        _setPlatformForTest('android');
        expect(pickByPlatform({ ios: 'a', android: 'b', default: 'c' })).toBe('b');
        expect(pickByPlatform({ ios: 'a', default: 'c' })).toBe('c');
    });
});
```

**小程序壳同步**：`miniprogram/app.js` 启动前注入 `globalThis.__OPENBLOCK_PLATFORM__ = 'wechat'`。

**护栏**：`tests/platformProfile.test.js` 4/4 通过 + UA fallback 行为不变。

---

## §2. `MONO_FLUSH_PICK_PROBABILITY` 平台化（Android Combo 爽感加强）

**问题**：Android 多消 r=0.205 是 iOS（0.089）的 2.3 倍，但 monoFlush 概率全平台同档 0.033。

**改动文件**：`web/src/bot/blockSpawn.js`

**改动前**（line 145）：

```javascript
const MONO_FLUSH_PICK_PROBABILITY = 0.033;
```

**改动后**：

```javascript
import { pickByPlatform } from '../config/platformProfile.js';

/**
 * v1.60.45：按平台分发 monoFlush 命中概率。
 *
 * 数据依据（docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §2.2）：
 *   Android 爽感时刻 r 平均比 iOS 高 1.5-2.3 倍，monoFlush 作为视觉爽感
 *   彩蛋应在 Android 抬高，iOS 维持稀缺。
 */
const MONO_FLUSH_PICK_PROBABILITY = pickByPlatform({
    ios:     0.033,  // 维持 v1.60.34 稀缺彩蛋设定
    android: 0.050,  // +50%，与 r 倍数差异对齐
    wechat:  0.050,  // 与 Android 同档
    web:     0.040,  // 折中
    default: 0.033,
});
```

**配套测试更新**（`tests/blockSpawn.test.js`）：

- 新增分组 `v1.60.45 — MONO_FLUSH_PICK_PROBABILITY 平台化`
- 4 个测试：iOS / Android / WeChat / web 各跑 100 次 strong scenario，验证命中率落在 [基础值 ±2%] 区间
- 已有 monoFlush 命中率测试（v1.60.30 等）保持原阈值（默认走 web/iOS 档）

**护栏**：
- 全部既有 monoFlush 测试不动改前后差异（默认平台档 = 0.033，不变）
- 新增 Android 档命中率 ≥ 5% / 单 dock 1 块限制不被破坏

---

## §3. `multiClearBonus` Android 抬高

**问题**：multiClearBonus 全平台同公式，Android 上爽感时刻边际价值显著更高。

**改动文件**：`web/src/adaptiveSpawn.js`

**改动前**（line 1719-1722）：

```javascript
let multiClearBonus = Math.max(
    deriveMultiClearBonus(ctx, _boardFill ?? 0),
    delight.multiClearBoost
);
```

**改动后**：

```javascript
import { pickByPlatform } from '../config/platformProfile.js';

let multiClearBonus = Math.max(
    deriveMultiClearBonus(ctx, _boardFill ?? 0),
    delight.multiClearBoost
);
/* v1.60.45：Android 多消 r=0.205（iOS 0.089）→ 抬高底值确保多消时刻可达。
 * 数据依据 docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §2.2 / §4.2。
 * 仅抬底，不上限（避免无限叠加）。 */
const platformFloor = pickByPlatform({
    ios:     0,      // 维持现状
    android: 0.15,   // 抬底 → 即使其他信号为 0 也保证一定的多消鼓励
    wechat:  0.15,
    default: 0,
});
multiClearBonus = Math.max(multiClearBonus, platformFloor);
```

**护栏**：
- iOS 档：默认行为完全不变（测试不动）
- Android 档：multiClearBonus 最低值 ≥ 0.15；上限仍受现有 max 限制（约 0.50）
- 新增 1 个测试：Android 档下"中性意图 + 无 nearMiss"场景，multiClearBonus 应 ≥ 0.15

---

## §4. `REVIVE_LIMIT` Android 提至 2

**问题**：Android 触发复活 r=+0.173 单调正相关，但 `REVIVE_LIMIT=1` 全平台同档，浪费了线性留存抓手。

**改动文件**：`web/src/revive.js`

**改动前**（line 31-32）：

```javascript
const REVIVE_LIMIT_DEFAULT = 1;   // 每局最多复活次数
const REVIVE_CLEAR_CELLS   = 12;  // 复活时清除的格子数
```

**改动后**：

```javascript
import { pickByPlatform } from './config/platformProfile.js';

/* v1.60.45：复活次数按平台分发。
 *
 * Android（r=+0.173 单调正相关）：放宽至 2，每局最多 2 次复活；
 * iOS（r≈0 非线性 U 型）：维持 1，避免反向劣化（数据：docs/operations/
 * RETENTION_SIGNALS_CROSS_PLATFORM.md §2.1 / §4.3）。 */
const REVIVE_LIMIT_DEFAULT = pickByPlatform({
    android: 2,
    wechat:  2,
    default: 1,   // iOS / web 维持现状
});
const REVIVE_CLEAR_CELLS   = 12;
```

**风险与护栏**：
- 风险 1：广告价值稀释 → 监控 Android 广告 ARPDAU，不显著下降 ≥ 95% 置信
- 风险 2：游戏时长拉长但留存未提升（伪信号）→ A/B 14 天验证 D1/D7 留存差
- 测试：`tests/revive.test.js`（若不存在则新建）验证 Android 档下连续触发 2 次复活后第 3 次走原 `_handleNoMoves`

---

## §5. `roundsSinceLastDelight` 追踪 + 强 relief 兜底

**问题**：adaptiveSpawn 输出爽感候选但对玩家"是否真触爽"无闭环。

### 5.1 PlayerProfile 新字段

**改动文件**：`web/src/playerProfile.js`

**插入位置**（line ~115，`_consecutiveNonClears = 0` 之后）：

```javascript
/* v1.60.45：爽感覆盖率追踪。
 *
 * roundsSinceLastDelight：自上次"爽感时刻"（multiClear≥2 / pcClear /
 * comboHigh≥4 / monoFlush 命中）以来的轮数。超过阈值（Android 5 / iOS 7）
 * 时 intentResolver 强制 forceReliefIntent=true，保证爽感可达性 ≥ 90%。
 * 数据依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.5。 */
this._roundsSinceLastDelight = 0;
```

**新增 API**（在 recordSpawn 附近）：

```javascript
/** 爽感时刻触发时调用：清零计数器。由 game.js 在消行/Combo 事件中 hook。 */
recordDelight(kind /* 'multiClear' | 'pcClear' | 'comboHigh' | 'monoFlush' */) {
    this._roundsSinceLastDelight = 0;
    this._lastDelightKind = kind;
    this._lastDelightTs = Date.now();
}

/** 每轮 spawn 时调用：计数器 +1。由 game.js 在 _spawnDock 入口 hook。 */
tickRoundForDelight() {
    this._roundsSinceLastDelight = (this._roundsSinceLastDelight ?? 0) + 1;
}

/** 当前是否处于爽感饥渴状态（用于 intentResolver 强 relief）。 */
isDelightStarved() {
    const platform = (typeof getPlatform === 'function') ? getPlatform() : 'web';
    const threshold = platform === 'android' || platform === 'wechat' ? 5 : 7;
    return (this._roundsSinceLastDelight ?? 0) >= threshold;
}
```

（import `getPlatform` 加在文件顶部）

### 5.2 intentResolver 新规则

**改动文件**：`web/src/derivation/intentResolver.js`

**在 INTENT_RULES 数组中插入**（line 98 之后，priority 100 与 90 之间）：

```javascript
{
    id: 'relief',
    priority: 100,
    /* ... 现有 ... */
},
{
    /* v1.60.45：爽感饥渴 → 强制 relief。
     * 与"playerDistress 主动救济"语义不同：前者基于挫败信号，
     * 后者基于"长期无爽感"的运营观测——同档优先级（介于 relief 与 engage 之间），
     * 一旦触发同样走 relief 分支让 adaptiveSpawn 偏好多消/小块。 */
    id: 'delight_starved',
    priority: 95,
    guard: (s) => !!s.delightStarved,
    reason: () => 'delightStarved=true（爽感饥渴：连续 N 轮无 multiClear/pcClear/monoFlush）',
},
{
    id: 'engage',
    priority: 90,
    /* ... 现有 ... */
},
```

### 5.3 输入字段流动

**改动文件**：`web/src/derivation/selectors.js`（或 adaptiveSpawn 入参组装处）

确保 `delightStarved: playerProfile.isDelightStarved()` 写入 intent inputs。

### 5.4 game.js hook

**改动文件**：`web/src/game.js`

- `_spawnDock()` 入口调用 `playerProfile.tickRoundForDelight()`
- 消行处理中（约 `processClear`）按 `lines >= 2` / `isPerfectClear` / `comboCount >= 4` / `monoFlushHit` 调用 `playerProfile.recordDelight(kind)`

**测试**：新增 `tests/playerProfileDelight.test.js`

- 5 轮无爽感 → `isDelightStarved()` Android 档应 true
- 7 轮无爽感 → iOS 档应 true
- recordDelight 后清零
- `delight_starved` 规则触发后 winnerIntent === 'relief'

---

## §6. 复活后强制 `forceReliefIntent`（避免"复活了立刻再死"）

**问题**：复活只清空 12 格，下一局仍走原 spawn，玩家很快再次死局——浪费复活机会。

**改动文件**：`web/src/revive.js`

**插入位置**（_performRevive 成功后，约 line 130-160 区间）：

```javascript
_performRevive(method) {
    // ... 现有清除 12 格逻辑 ...

    /* v1.60.45：复活成功 → 标记下一局 spawn 走强 relief。
     * 数据依据：复活成功 r≈0 表明"复活后体验未传导到留存"，可能是
     * 复活后局面仍差很快再死。下一轮强 relief 给玩家"喘息"机会。 */
    if (this._game) {
        this._game._postReviveBoost = {
            forceReliefIntent: true,
            clearGuarantee: 3,
            ttlRounds: 2,  // 持续 2 轮，避免长期影响
        };
    }
}
```

**改动文件**：`web/src/game.js`（_spawnDock 或 _spawnContext 组装处）

**插入**：

```javascript
/* v1.60.45：复活后救济（TTL 2 轮） */
if (this._postReviveBoost && this._postReviveBoost.ttlRounds > 0) {
    spawnHints.forceReliefIntent = true;
    spawnHints.clearGuarantee = Math.max(spawnHints.clearGuarantee ?? 1, this._postReviveBoost.clearGuarantee);
    this._postReviveBoost.ttlRounds--;
    if (this._postReviveBoost.ttlRounds <= 0) this._postReviveBoost = null;
}
```

**测试**：`tests/revive.test.js` 增加 "复活后下一局 spawnHints.forceReliefIntent === true 且 clearGuarantee >= 3"。

---

## §7. PB 突破后次级目标卡片（同局保护 → 跨局保护）

**问题**：v1.56 + v1.60.37 只覆盖**同局**末段救济；数据显示 PB 后 D3-D15 流失加剧（iOS r=-0.126 → -0.128）。

### 7.1 bestScoreBuckets 扩展

**改动文件**：`web/src/bestScoreBuckets.js`

**新增 API**（文件末尾）：

```javascript
const PB_BREAK_TS_KEY = 'openblock_pb_break_ts_v1';

/**
 * v1.60.45：记录最近一次 PB 突破时间戳，供跨局保护链 / D3-D7 push 召回判定。
 * @param {number} score 突破分数
 */
export function notePbBreak(score) {
    _safeWriteJson(PB_BREAK_TS_KEY, {
        ts: Date.now(),
        score,
    });
}

/**
 * 距上次 PB 突破的天数（用于 winback push 触发判定）。
 * @returns {number|null} null 表示从未突破
 */
export function daysSinceLastPbBreak() {
    const rec = _safeReadJson(PB_BREAK_TS_KEY);
    if (!rec || !rec.ts) return null;
    return (Date.now() - rec.ts) / 86400000;
}

/**
 * v1.60.45：基于当前 PB + 玩家历史生成"次级目标"列表，供 UI 展示。
 * 避免玩家因"我已破 PB 了"产生终结感——给出"还有挑战"叙事。
 *
 * @param {number} currentPb 当前难度档 PB
 * @returns {Array<{ id: string, label: string, target: number }>}
 */
export function getNextChallenges(currentPb) {
    if (!Number.isFinite(currentPb) || currentPb <= 0) return [];
    return [
        { id: 'pb_110', label: `挑战 ${Math.round(currentPb * 1.1)} 分`,
          target: Math.round(currentPb * 1.1) },
        { id: 'weekly_pb', label: '本周新高', target: getPeriodBest('weekly') || 0 },
        { id: 'pc_pb', label: '完美清屏 PB', target: 0 /* TODO 引入 pcClearBest */ },
    ].filter(c => c.target > 0 || c.id === 'pc_pb');
}
```

### 7.2 game.js 触发点

**改动文件**：`web/src/game.js`（PB 检测处，搜索 `recordBestByStrategy` 调用点）

**插入**：

```javascript
if (newPb) {
    recordBestByStrategy(this.currentStrategy, this.score);
    notePbBreak(this.score);  // v1.60.45
    // 下一局开局展示次级目标
    this._showNextChallengesOnNextStart = true;
}
```

**新局开始时**：

```javascript
start() {
    // ... 现有 ...
    if (this._showNextChallengesOnNextStart) {
        const challenges = getNextChallenges(getBestByStrategy(this.currentStrategy));
        this._renderChallengeCards(challenges);  // 新增 UI 渲染
        this._showNextChallengesOnNextStart = false;
    }
}
```

**测试**：`tests/bestScoreBuckets.test.js` 增加 notePbBreak + daysSinceLastPbBreak + getNextChallenges 三组用例。

---

## §8. 看板新增「爽感覆盖率」KPI

**问题**：`/ops` 看板缺爽感覆盖率指标，无法验证 §3 / §5 落地效果。

### 8.1 后端 SQL

**改动文件**：`server.py`（`ops_dashboard` 端点）

**新增字段**：

```python
# v1.60.45：爽感覆盖率 — 7 日内触发任一爽感时刻的 DAU 占比
delight_cur = conn.execute("""
    SELECT COUNT(DISTINCT user_id) AS delight_users,
           (SELECT COUNT(DISTINCT user_id) FROM behaviors WHERE ts > ?) AS total_users
    FROM behaviors
    WHERE ts > ?
      AND event IN ('multi_clear', 'perfect_clear', 'combo_high', 'mono_flush')
""", (cutoff_7d, cutoff_7d)).fetchone()

delight_coverage_rate = (
    delight_cur['delight_users'] / delight_cur['total_users']
    if delight_cur['total_users'] else 0
)

result['coreMetrics']['delightCoverageRate'] = round(delight_coverage_rate, 4)
result['coreMetrics']['delightCoverageThreshold'] = 0.75  # 目标线
```

### 8.2 前端展示

**改动文件**：`web/src/opsDashboard.js`

**新增卡片**：

```javascript
{
    label: '爽感覆盖率（7日）',
    value: pct(metrics.delightCoverageRate),
    hint: `目标 ≥ ${pct(metrics.delightCoverageThreshold)}（multiClear/pcClear/comboHigh/monoFlush 任一触发）`,
    tone: metrics.delightCoverageRate >= metrics.delightCoverageThreshold ? 'success' : 'warning',
}
```

### 8.3 打点埋点

**改动文件**：`web/src/game.js`（消行处理 / Combo 处理）

```javascript
// v1.60.45：爽感事件打点（与 playerProfile.recordDelight 同步）
if (lines >= 2) analytics.track('multi_clear', { lines });
if (isPerfectClear) analytics.track('perfect_clear');
if (comboCount >= 4) analytics.track('combo_high', { comboCount });
if (monoFlushHit) analytics.track('mono_flush');
```

**测试**：`tests/opsDashboard.test.js` 增加新字段存在性 + 类型 check。

---

## §9. iOS 广告分层（按完播率分桶）

**问题**：iOS 广告完播 r=0.349（最强单一信号），但当前 trigger 权重无完播率分层。

**改动文件**：`web/src/monetization/strategy/strategyConfig.js`

**新增 segments**（在 segments 配置段）：

```javascript
segments: {
    // ... 现有 whale / dolphin / minnow / churn_risk ...

    /* v1.60.45：iOS 广告完播率分层（仅 iOS 生效，Android 走默认）。
     * 数据依据：iOS 广告完播 r=0.349（最强单一信号），D15 仍 0.310。
     * 完播率分层让运营按"真实变现意愿"差异化触发。 */
    ios_ad_completer_high: {
        rule: (player) => getPlatform() === 'ios'
            && (player.adCompletionRateD7 ?? 0) >= 0.80,
        label: 'iOS 高完播玩家（≥80%）',
    },
    ios_ad_completer_low: {
        rule: (player) => getPlatform() === 'ios'
            && (player.adCompletionRateD7 ?? 0) > 0
            && (player.adCompletionRateD7 ?? 0) < 0.30,
        label: 'iOS 低完播玩家（<30%）',
    },
},
```

**新增 rules**：

```javascript
rules: [
    // ... 现有 ...

    /* v1.60.45：iOS 高完播玩家——更多激励广告暴露 */
    {
        id: 'ios_high_completer_more_rewarded',
        segments: ['ios_ad_completer_high'],
        action: { type: 'ads', format: 'rewarded', frequencyBoost: 1.5 },
        priority: 'high',
        why: 'iOS 高完播玩家广告价值高，频次抬升 50% 不影响留存',
        effect: 'IAA ARPDAU +20-30%',
    },
    /* v1.60.45：iOS 低完播玩家——减少打扰，转 IAP 软营销 */
    {
        id: 'ios_low_completer_iap_pivot',
        segments: ['ios_ad_completer_low'],
        action: { type: 'iap', product: 'starter_pack', priority: 'medium' },
        priority: 'medium',
        why: 'iOS 低完播玩家广告价值低，转 IAP 软营销避免留存伤害',
        effect: 'IAP 转化 +5-10%，广告退订率 −15%',
    },
],
```

**配套数据来源**：`adCompletionRateD7` 字段需要打点 → 后端聚合 → `/api/strategy` 接口下发。

**护栏**：A/B 14 天，iOS 高完播组 ARPDAU 与 D7 留存双显著正向；低完播组留存正向且广告退订率不上升。

---

## §10. Android 每日 3 次高分挑战任务（频次激励模型）

**问题**：Android 达到高分 r=0.276（最强）+ 区分度仅 21%（弱），是"普遍可达、越多越好"的频次激励模型。

**新建文件**：`web/src/retention/dailyChallengePlaybook.js`

```javascript
/**
 * dailyChallengePlaybook.js — v1.60.45 Android 每日高分挑战。
 *
 * 数据依据：docs/operations/RETENTION_SIGNALS_CROSS_PLATFORM.md §4.7
 *   Android 达到高分 r=0.276 强正、区分度 21% 弱 → 普遍可达频次激励特征。
 *   iOS 不引入（稀缺爽感模型不应被频次稀释）。
 *
 * 任务规则：
 *   - 高分阈值 = playerProfile.getHighScoreMedian() × 0.95（个人化避免门槛过高）
 *   - 每日 3 次完成解锁组合奖励：金币 200 / 皮肤试用 1 / 复活机会 +1
 *   - 累计 7 天解锁周礼包
 *
 * 触发：lifecycle 事件 'high-score-reached'（>= 个人 P50）。
 */

import { getPlatform } from '../config/platformProfile.js';

const STORAGE_KEY = 'openblock_daily_challenge_v1';

const DAILY_TARGET = 3;
const WEEKLY_TARGET = 21; // 3 × 7

function _today() { return new Date().toISOString().slice(0, 10); }

function _read() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : { date: _today(), count: 0, weekStart: _today(), weekCount: 0 };
    } catch { return { date: _today(), count: 0, weekStart: _today(), weekCount: 0 }; }
}

function _write(obj) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(obj)); } catch {}
}

/** 仅 Android / wechat 启用，其他平台 noop（避免污染 iOS 稀缺爽感）。 */
export function isEnabled() {
    const p = getPlatform();
    return p === 'android' || p === 'wechat';
}

/** 高分事件触发；返回 { dailyDone, weeklyDone, reward } */
export function noteHighScore() {
    if (!isEnabled()) return null;
    const today = _today();
    const state = _read();

    // 日重置
    if (state.date !== today) {
        state.date = today;
        state.count = 0;
    }
    // 周重置
    const weekAge = (Date.now() - new Date(state.weekStart).getTime()) / 86400000;
    if (weekAge >= 7) {
        state.weekStart = today;
        state.weekCount = 0;
    }

    state.count++;
    state.weekCount++;
    _write(state);

    const dailyDone = state.count === DAILY_TARGET;
    const weeklyDone = state.weekCount === WEEKLY_TARGET;

    return {
        dailyDone,
        weeklyDone,
        reward: dailyDone ? { coins: 200, skinTrial: 1, reviveBonus: 1 } : null,
        weeklyReward: weeklyDone ? { coins: 2000, skinUnlock: 1 } : null,
    };
}

export function getProgress() {
    if (!isEnabled()) return null;
    const state = _read();
    return {
        daily: { count: state.count, target: DAILY_TARGET },
        weekly: { count: state.weekCount, target: WEEKLY_TARGET },
    };
}
```

**game.js 接入**：

```javascript
// 玩家达到个人 P50 高分时
const dchallenge = noteHighScore();
if (dchallenge?.reward) {
    this._showDailyChallengeReward(dchallenge.reward);
}
```

**测试**：新建 `tests/dailyChallengePlaybook.test.js`

- iOS 平台 isEnabled() === false
- Android 3 次触发 → dailyDone, reward 非空
- 跨日自动重置
- 跨周自动重置

---

## 实施次序建议

```
Week 1（基础设施 + 快赢）
├─ §1 platformProfile（必做，其他依赖）         [0.5d]
├─ §2 monoFlush 平台化                          [0.5d]
├─ §3 multiClearBonus Android 抬高              [0.5d]
└─ §4 REVIVE_LIMIT Android 提至 2               [0.5d]

Week 2（爽感闭环 + 复活救济）
├─ §5 roundsSinceLastDelight 追踪                [1.5d]
├─ §6 复活后强 relief                            [0.5d]
└─ §7 PB 突破后次级目标                          [1d]

Week 3（数据回流 + 平台精细化）
├─ §8 爽感覆盖率看板 KPI                         [1d]
├─ §9 iOS 广告分层                               [1d]
└─ §10 Android 每日高分挑战                      [2d]
```

每周末做一次 A/B 切流验证，14 天后回收数据迭代。

---

## 不在本清单的事项（明确不做）

| 事项 | 原因 |
|---|---|
| iOS 复活漏斗扩张 | 数据显示 iOS 复活非线性 U 型，需先分桶研究避免反向劣化 |
| Android 广告分层 | 广告 r 长期衰减至 0.216，分层投入边际收益低 |
| iOS 每日高分挑战 | iOS 稀缺爽感模型，频次任务会稀释爽感价值 |
| Android PRS 复合评分 | 6 个强信号已能单独驱动运营，先看 §3/§4/§7/§10 效果再评估 |
| 基础指标改造（绝对次数→比率） | 打点 schema 改造大，归入 v1.62 季度 |

---

## 数据回流验证清单

每个 § 上线后必须能在 `/ops` 看板看到对应变化：

| § | 验证字段 | 验证维度 |
|---|---|---|
| §2 | `chosen.reason='special-monoFlush'` 出现率 | 按 platform 切片，Android 应 ≥ 5% |
| §3 | `spawnHints.multiClearBonus ≥ 0.15` 比例 | Android 100% / iOS 0% |
| §4 | "复活成功次数" 在 Android 包均值 | 提升 ≥ 30%（基线待回收） |
| §5 | `delightCoverageRate` 7 日值 | 全平台 ≥ 75% |
| §6 | 复活后下一局 `reason='special-relief'` 出现率 | 接近 100% |
| §7 | PB 突破事件 / 下一局展示次级目标比率 | 接近 100% |
| §8 | 看板 `delightCoverageRate` 字段 | 字段存在且非 null |
| §9 | iOS 高完播组 IAA ARPDAU | 14 天后 +20-30% |
| §10 | Android `dailyChallenge.dailyDone` 触发 | 7 日内 ≥ 30% Android DAU |

---

## 文档关系

| 上游 | 关系 |
|---|---|
| [留存信号跨平台分析](./RETENTION_SIGNALS_CROSS_PLATFORM.md) | 提供数据洞察与策略层方案；本文是其工程落地清单 |
| [自适应出块 §10.7](../algorithms/ADAPTIVE_SPAWN.md#107-形状池扩展v1600--v16044独立库事件注入系统) | v1.60.44 三类触发分级；§2/§3 在此基础上做平台分发 |
| [生命周期蓝图](./PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) | §0 北极星与护栏；新增"爽感覆盖率"为次级 KPI |
