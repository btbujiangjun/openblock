# 宝箱与钱包（局末 / 赛季 / 防通胀）

本文描述网页端 **局末宝箱**、**赛季进阶宝箱** 与 **`wallet.js` 钱包** 的发放顺序、存储键、与每日上限的关系，便于产品、测试与二次开发对齐行为。

## 存储一览

| 键 | 模块 | 内容 |
|----|------|------|
| `openblock_chest_state_v1` | `endGameChest.js` | `gamesSinceChest`、`totalChests`、未兑现时的 `pendingChest` |
| `openblock_season_chest_v1` | `seasonChest.js` | 各阶梯是否已解锁 `{ common, rare, epic, legend }` |
| `openblock_skill_wallet_v1` | `wallet.js` | 余额、`dailyConsumed` / `dailyGranted`、试穿列表 |

## 局末宝箱（`web/src/rewards/endGameChest.js`）

- **挂载**：`main.js` 调用 `initEndGameChest({ game })`，包装 `game.endGame`。
- **触发概率**：基础 5%；本局 `score ≥ 800` 时 +5%；连续 12 局未触发则本局 **100% 保底**。
- **发放顺序（v10.18+）**：命中后先将 `{ tier, reward }` 写入 `pendingChest`，**弹出浮层**；用户点击 **「领取到钱包」** 或点击遮罩关闭时，才执行 `_grantReward` 入账，并清除 `pendingChest`。
- **自动兑现**：任意后续局结算时会先尝试兑现上一局未操作的 `pendingChest`（避免关页/未点导致丢奖励）。
- **冷启动页**：`initEndGameChest` 末尾会调用一次兑现，处理刷新前未确认的待领。
- **与结算卡叠层**：若 `#game-over.active`，则通过 `MutationObserver` 延迟到结算卡关闭后再弹层（见文件内注释）。

## 赛季进阶宝箱（`web/src/rewards/seasonChest.js`）

- **依据**：`progression.js` → `loadProgress().totalXp`。
- **轮询**：初始化时检查一次，之后每 **30s** `_checkOnce`。
- **发放顺序**：仅当 `xp` 达到阶梯且未记录该档时：**先 `_grantAndNotify` 入钱包**，再写入 `claimed` 并保存（避免「已标记领取但入账失败」的不一致）。
- **提示**：toast 使用与彩蛋共用的轻量 DOM id（见 `seasonChest.js`）。

## 钱包与每日上限（`web/src/skills/wallet.js`）

- **入账**：`addBalance(kind, amount, source)`。对多数 `source` 适用 **`DAILY_GRANT_CAP`**（按自然日累计发放量，防通胀）。
- **绕过 cap 的来源**：`GRANT_BYPASS_SOURCES` 中的来源 **不占用** 当日 cap，包括：
  - `iap`、`first-day-pack`、`admin`、`test`
  - 局末宝箱：`chest-common`、`chest-rare`、`chest-epic`
  - 赛季宝箱：`season-chest-common` … `season-chest-legend`（及历史别名 `season-chest-grand`）
  - 转盘大奖：`lucky-wheel-grand`
- **消耗**：`spend(kind, amount, reason)` — 先扣当日免费配额（若有），再扣库存。

## 测试与排错建议

1. **局末宝箱未弹层但下局道具变多**：可能为延迟兑现或自动兑现，属预期。
2. **赛季已 toast 但余额不对**：查控制台与 `addBalance` 返回值；确认 `source` 是否在 bypass 列表（避免被 cap 截断）。
3. **改奖励数值**：同步改 `TIER_REWARDS` / `TIERS` 与本文档表格描述（若有）。

## 相关文档

- [留存路线图（归档）](../archive/product/RETENTION_ROADMAP_V10_17.md)（宝箱在留存中的定位）
- [玩家生命周期与成熟度蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)（当前权威留存模型）
- [彩蛋与惊喜](./EASTER_EGGS_AND_DELIGHT.md)（体验节奏交叉参考）
