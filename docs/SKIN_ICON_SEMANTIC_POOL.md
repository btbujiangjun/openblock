# 方块 emoji 全量池：利用情况与表意匹配说明（v10.33）

> 代码事实源：`web/src/skins.js`  
> 硬约束：**27 款带 `blockIcons` × 8 = 216 枚 emoji，跨皮肤全局互斥**（与 §5 校验脚本一致）。

---

## 1. 全量利用情况

| 指标 | 值 |
|------|-----|
| 带 icon 皮肤数 | 27 |
| 方块 emoji 总数 | **216**（利用率 100%，无闲置槽位） |
| 无 icon 皮肤 | 8（纯配色阶梯 / 深色浅色叙事） |

每一枚 emoji **恰好出现一次**，因此所谓「全局重新匹配」在工程上等价于：**在 216 枚之间做重partition**，不能凭空「多加一枚」而不替换掉另一枚。

---

## 2. 主题 ↔ icon 表意：评价维度

为避免「只有字面物才算高分」，建议同时看三维：

| 维度 | 含义 |
|------|------|
| **直示性** | 玩家不看注释能否联想到皮肤名 |
| **叙事自洽** | 8 格是否同一画面（同一活动 / 同一地理 / 同一文化符号系统） |
| **独占合法性** | 麻将牌面 / 扑克花色等 **必须与玩法符号同源**，不可为了「更好看」换成通用 emoji |

据此：

- **麻将 `mahjong`、扑克 `boardgame`**：直示性封顶；**禁止**与别的皮肤互换牌字符。
- **球类 `sports`、乐器 `music`、料理 `food`/甜点 `candy`**：已与品类强绑定，**优先不动**。
- **弱表意高风险区**（历史上易出现「凑八格」）：水族乐园类 **并列深海 `ocean`**、跨地理 **交通工具**、抽象主题下线后留下的 **科技感由 `neonCity` 霓虹承接**。

---

## 3. 本轮已落地的语义加固（可校验）

在 **不破坏 216 互斥** 前提下，对 **表意偏离最大** 的两处做了替换：

### 3.1 `vehicles`（极速引擎）

| 原 | 新 | 理由 |
|----|-----|------|
| 🚥 红绿灯 | **🚗 轿车** | 红绿灯属 **道路设施**，与「载具本体」弱相关；轿车与 🚌🛵 同属 **路面机动车**，直示性更好。 |

配套：`blockColors` 第 7 色改为通勤蓝灰系，与车身意象一致。

### 3.2 `bubbly`（元气泡泡）

| 原 | 新 | 理由 |
|----|-----|------|
| 🦩 火烈鸟 | **🦦 水獭** | 火烈鸟偏 **水岸/湿地**，与浅海果冻气泡叙事不够贴；水獭强化 **浅水、萌系、亲水**。 |
| 🌿 草本植物 | **🏖️ 沙滩** | 草本偏陆地植被；沙滩与浅海、度假气泡同属 **海滨休闲** 画面。 |

配套：`skinLore` 文案改为浅海 + 沙滩 + 气泡一体叙事。

---

## 4. 尚未改动但建议「保冻结」的皮肤（避免无效抖动）

以下皮肤 **8 格与主题已高度同构**，全局重排收益极低、回归成本高：

- `ocean`、`forest`、`farm`、`desert`、`pirate`、`industrial`、`demon`、`fairy`、`pets`、`toon`、`beast`、`jurassic`、`universe`、`aurora`、`koi`、`greece`、`mahjong`、`boardgame`、`sports`、`music`、`food`、`candy`、`pixel8`、`forbidden` 等。

若未来要做 **更大规模互换**，建议按 **主题簇**（哺乳/爬行、东亚风物、桌面博弈……）在簇内置换，并跑一次 **HSL minD** 与 **WCAG** 回归。

---

## 5. 校验命令（提交前必跑）

```bash
node -e "
const { SKINS } = require('./web/src/skins.js');
const used = new Map(); let dup = 0;
for (const [id,s] of Object.entries(SKINS)) {
  if (!s.blockIcons) continue;
  for (const ic of s.blockIcons) {
    if (used.has(ic)) { console.log('DUP', ic, used.get(ic), id); dup++; }
    else used.set(ic, id);
  }
}
console.log(Object.keys(SKINS).length, 'skins,', used.size, 'icons, dup=', dup);
"
# 期望：dup=0；icon 总数 216
```

---

## 6. 变更记录

| 版本 | 说明 |
|------|------|
| v10.33 | 文档建立；`vehicles` 🚥→🚗、`bubbly` 🦩→🦦 🌿→🏖️；`skinLore.bubbly` 同步 |
