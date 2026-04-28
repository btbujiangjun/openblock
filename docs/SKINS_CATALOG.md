# OpenBlock 皮肤目录（34 款全集）

> 版本: v10.2 | 更新: 2026-04-28
> 代码位置：`web/src/skins.js`、`miniprogram/core/skins.js`、`scripts/sync-miniprogram-skins.cjs`
> 关联：`docs/WECHAT_MINIPROGRAM.md`（小程序皮肤同步）、`web/src/themes/`（渲染管线）

---

## 1. 总览

OpenBlock 提供 **34 款** 主题皮肤，覆盖 4 大维度：

- **明暗底**：29 款深色 + 5 款浅色（`dawn` / `macaroon` / `pets` / `farm` / `desert`）
- **是否携带 emoji icon**：24 款带 icon（每款 8 枚）+ 10 款纯配色
- **blockStyle 渲染管线**：`glossy / metal / glass / cartoon / neon / jelly / flat / pixel8` 共 8 种
- **全局 icon 唯一性**：24 × 8 = **192 个 emoji 全部互不重复**（强约束 / 自动校验）
- **主题↔背景一致性**（v10.1 引入 / v10.2 全量推广至 34 款）：盘面/页面背景的色相必须服务于皮肤主题叙事，而不仅仅是 icon 的反差衬底（详见 §2.4 与 §4 各小节）

总皮肤矩阵：

| 大类 | 数量 | 皮肤 ID |
|---|---|---|
| 基础经典 | 2 | `classic` `titanium` |
| 暗色科技 | 3 | `cyber` `aurora` `neonCity` |
| 自然元素 | 3 | `ocean` `sunset` `lava` |
| 日系美学 | 2 | `sakura` `koi` |
| 休闲甜系 | 2 | `candy` `bubbly` |
| 卡通复古 | 2 | `toon` `pixel8` |
| 浅色系 | 2 | `dawn` `macaroon` |
| 生活意象 | 4 | `food` `music` `pets` `universe` |
| 奇幻神话 | 4 | `fantasy` `fairy` `greece` `demon` |
| 冒险史前 | 2 | `beast` `jurassic` |
| 文化主题 | 2 | `industrial` `forbidden` |
| 生活扩展 | 6 | `sports` `vehicles` `forest` `pirate` `farm` `desert` |

合计 **34** 款。默认皮肤为 `titanium`（钛晶矩阵），由 `DEFAULT_SKIN_ID` 常量控制；玩家选择持久化至 `localStorage.openblock_skin`。

---

## 2. 设计原则（三大铁律）

### 2.1 明度反差铁律

**任意 emoji 主色与 blockColor 的明度差 ≥ Δ40 / 灰度 ≥ 50%**。

例如：

- 银/灰 emoji（⚙️ 🔧 🔩 ⚓）→ 必须落在中高明度暖色背景（黄铜金、铁锈红、暗金黄）
- 暖色 emoji（🍕 🌹 🦁）→ 必须落在冷色或对比强背景（蓝/绿/紫）
- 黑色 emoji（🐼 🏴‍☠️）→ 必须落在中亮度饱和色（粉、米白、海蓝）

> 失败案例（已修正）：早期 fairy 把 8 种粉/紫色 icon 全配粉紫底，导致一片糊。整改后引入黄/绿对比色块。

### 2.2 色相互补铁律

8 个色块必须分布在色相环至少 4 象限，且与 emoji 主色形成 **互补 / 对比 / 撞色** 之一：

| 反差类型 | 配色组合 | 视觉效果 |
|---|---|---|
| 互补反差（Complementary） | 红 ↔ 绿 / 蓝 ↔ 橙 / 黄 ↔ 紫 | 最强烈眼花，适合 candy/sports |
| 冷暖反差（Temperature） | 暖色 ↔ 冷色 | 平衡张力，适合 forbidden/desert |
| 明度反差（Luminance） | 暗 emoji ↔ 亮底；亮 emoji ↔ 暗底 | 最稳妥识别度，适合 forest/koi |

### 2.3 主题专属铁律

24 款带 icon 皮肤的 192 个 emoji **全集互斥**（cross-skin uniqueness）。

- 同一 emoji **绝不重复出现**在两个皮肤中
- 由 `node -e "..."` 一行脚本可一键校验（见 §6.2）
- 已有规避案例：
  - jurassic 用 🐉（翼龙）→ forbidden 用 🐲（龙颜）：不同 codepoint
  - food 用 🥑/🍣，candy 用 🍩/🧁：完全错开
  - pets 用 🐰，fairy 用 🧚：宠物 vs 精灵分明

### 2.4 主题↔背景一致性铁律（v10.1 引入 · v10.2 全量推广）

**盘面 / 页面背景的色相必须服务于皮肤主题叙事**，而不仅仅是「icon 的反差衬底」。

具体含义：

- icon 决定皮肤的「专属符号」
- blockColor 决定每枚 icon 的「立牌色彩」
- **背景三件套（`gridOuter` / `gridCell` / `cssBg`）共同决定皮肤的「叙事环境」**

例如：

| 主题 | ✗ 仅看反差的错误背景 | ✓ 主题叙事正确的背景 |
|---|---|---|
| 农场草地 | 卡其沙黄底（沙漠味） | 浅春绿牧草底 |
| 沙漠绿洲 | 深蓝夜空底（深海/星空味） | 浅沙金主调底 |
| 紫禁城 | 中性深灰（普通暗色） | 玄朱深底（朱红宫墙） |
| 工业革命 | 蓝灰金属（赛博味） | 焦煤铸铁底（炉火 + 铁屑） |

**判断检查表**（设计/审核时通用）：

1. 闭眼想象皮肤主题，第一时间浮现的「环境色」是什么？该色应作 cssBg 的色相基准
2. `cssBg` 与 icon 主题域**是否构成同一画面**（`farm` 草地 / `desert` 沙漠 / `forest` 林冠）
3. 浅色皮肤的 `cssBg` **不应仅与同类浅色皮肤撞色族**（避免 4 款都是 cream/khaki）

#### 2.4.1 v10.2 全量审计结果（34 款）

依照本铁律对全部皮肤逐一审计，分为 3 类：

**A. 已合理保留（26 款）**：背景色相已直接服务于主题叙事，无需调整：

`classic`（中性灰盘） · `titanium`（钛冷蓝） · `cyber`（赛博暗紫黑） · `aurora`（北极冰蓝） · `neonCity`（都市夜近黑） · `ocean`（深海蓝） · `lava`（焦炭黑） · `koi`（深水蓝） · `bubbly`（深紫海） · `toon`（漫画聚光紫） · `pixel8`（街机厅黑） · `dawn`（晨光奶油） · `macaroon`（甜点暖白） · `food`（餐厅暖棕） · `music`（演出暗紫） · `pets`（家居米黄） · `universe`（深空近黑） · `beast`（荒野焦土） · `industrial`（焦煤铸铁） · `forbidden`（玄朱朱红） · `sports`（草绿球场） · `vehicles`（机库灰混凝土） · `forest`（苔藓深绿） · `pirate`（深海舷板） · `farm`（浅春绿牧草） · `desert`（浅沙金）

**B. v10.1 已重做（2 款）**：`farm` 卡其沙→浅春绿；`desert` 深蓝夜→浅沙金。

**C. v10.2 主题强化（8 款）**：原本仅做了「极暗中性反差衬底」、未充分讲故事的暗色皮肤，全部推移到带有主题色相的暗色调：

| 皮肤 | 旧 cssBg | 新 cssBg | 推移方向 |
|---|---|---|---|
| `sunset` 暮色日落 | `#0E0610` | `#1A0810` | 纯黑紫红 → 玫瑰胭脂暮霭（点出黄昏暖意） |
| `sakura` 樱花飞雪 | `#100608` | `#1A0810` | 纯黑红 → 胭脂粉紫夜（夜樱粉光） |
| `candy`  糖果甜心 | `#120420` | `#1A0628` | 通用紫黑 → 莓果糖果橱（甜系深莓紫） |
| `fantasy` 魔幻秘境 | `#040210` | `#0A0420` | 纯黑 → 水晶秘境紫（魔法紫晕） |
| `fairy` 花仙梦境 | `#0C0618` | `#150A24` | 通用紫 → 玫瑰薰衣紫（花园梦幻调） |
| `greece` 希腊神话 | `#050508` | `#020812` | 中性黑 → 深爱琴海蓝（地中海夜空） |
| `demon` 恶魔冥界 | `#060210` | `#0E0408` | 通用紫 → 深血赤褐（地狱血火） |
| `jurassic` 恐龙世界 | `#060C02` | `#0A1408` | 纯黑绿 → 深森林绿（侏罗丛林） |

> 推移原则：**保持总明度（仍为暗底，方块亮度不损失）+ 注入主题色相**。
> 校验：所有 8 款的 blockColor 在新 cssBg 上仍维持 ≥ 4.5 的 WCAG 对比度，467 项 vitest 全过。

---

## 3. 字段定义参考

每款皮肤的数据结构（见 `web/src/skins.js` 中 `Skin` typedef）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | 唯一标识，写入 localStorage |
| `name` | string | 显示名（含 emoji 前缀） |
| `blockColors` | string[8] | 8 色方块底色（HEX） |
| `blockIcons?` | string[8] | 可选 8 个 emoji（与 blockColors 一一对应） |
| `boardWatermark?` | { icons, opacity, scale? } | 棋盘背景水印 |
| `gridOuter` | string | 棋盘外层背景（边框） |
| `gridCell` | string | 空格颜色（深色可见空格） |
| `gridGap` | number | 格子间距（px） |
| `blockInset` | number | 方块内缩（px） |
| `blockRadius` | number | 方块圆角（px） |
| `blockStyle` | enum | 8 种渲染风格之一 |
| `cellStyle?` | `'sunken'` | 空格凹陷效果 |
| `clearFlash` | string | 消行闪光色（rgba） |
| `cssBg?` | string | 整页背景色 |
| `uiDark?` | boolean | 是否深色 UI（启用 `UI_DARK_BASE`） |
| `cssVars?` | Record<string,string> | 自定义 CSS 变量覆盖 |

### 3.1 `blockStyle` 渲染管线对照

| 风格 | 用途 | 视觉签名 | 示例皮肤 |
|---|---|---|---|
| `glossy` | 通用主流 | 顶部高光 + 底部阴影 | classic, sunset, sports |
| `metal` | 金属质感 | 横向金属反光带 | titanium, industrial, vehicles |
| `glass` | 玻璃 / 半透 | 边缘高光 + 模糊 | aurora, ocean, fantasy, pirate |
| `neon` | 霓虹荧光 | 强光晕 + 外发光 | cyber, neonCity, music |
| `cartoon` | 卡通 | 厚实描边 + 平涂 | toon, pets, farm |
| `jelly` | 果冻 | 圆润 + 弹性形变 | bubbly |
| `flat` | 平涂 | 无渐变纯色 | macaroon |
| `pixel8` | 像素 | 8-bit 锯齿 | （glossy 替代实现） |

---

## 4. 皮肤分类详解

### 4.1 基础经典（2 款）

#### `classic` ✨ 极简经典

- **定位**：高饱和经典积木配色，深色中性盘面
- **配色**（8 色）：`#80D455` `#5BB8F8` `#FF9840` `#FFD820` `#80A8FF` `#FF7868` `#FF98C0` `#C8A8FF`
- **盘面**：`gridOuter:#1C2630` / `gridCell:#2E3E50` / `cssBg:#141C24`
- **风格**：`glossy` · `radius=5` · `gap=1`
- **icon**：—（纯配色）

#### `titanium` 💎 钛晶矩阵（默认）

- **定位**：蓝灰金属质感，极深冷色盘面烘托金属光泽
- **配色**：`#6AAEE8` `#94BDDF` `#78B8EB` `#A8CCF0` `#88D0F0` `#7DBAE2` `#B4D8EC` `#8DB6D8`（蓝灰渐变 8 阶）
- **盘面**：`gridOuter:#0A1020` / `gridCell:#182030` / `cssBg:#080C18`
- **风格**：`metal` · `radius=5` · `gap=1`
- **icon**：—

### 4.2 暗色科技（3 款）

#### `cyber` ⚡ 赛博朋克

- 高压电光 + 宇宙粒子，极暗底色（整合 cosmos 星域）
- 配色：`#00E8C8` `#F52885` `#B060F0` `#50CCF0` `#3B82F6` `#EC4899` `#10F5A8` `#FF2070`
- 风格：`neon` · `cssBg:#04010E`

#### `aurora` 🌌 冰川极光

- 冰川极光玻璃感，深海蓝底（整合 frost / arctic 极地）
- **icon**：`🦌 🐧 🐋 ❄️ 🌌 🐻‍❄️ 🦭 🏔️`
- 配色（按 icon 序）：`#5AD8CC` `#8070F0` `#AA90FA` `#38D89E` `#28D8F0` `#8590F8` `#C488FC` `#60C8FF`
- 风格：`glass` · `radius=6`

#### `neonCity` 🌃 霓虹都市（盘面参考款）

- RGB 霓虹灯光压近黑底（整合 midnight 午夜）
- 配色：`#FF2DAA` `#9B72FF` `#00E5FF` `#76FF03` `#FFAB40` `#FF4081` `#448AFF` `#18FFFF`
- 风格：`neon` · `cssBg:#080C16`

### 4.3 自然元素（3 款）

#### `ocean` 🌊 深海幽域

- **icon**：`🐙 🦞 🐡 🪸 🐚 🐳 🦈 🦑`（深海生物 + 珊瑚贝壳）
- 配色：`#00C8F0` `#0098C8` `#48D4E4` `#90F0FF` `#00E4C0` `#FFB347` `#FF7878` `#20E8FF`
- 风格：`glass` · `radius=6` · `cssBg:#020A14`
- **专属符号**：🪸🐚 独占深海

#### `sunset` 🌅 暮色日落

- 黄金 / 橙红 / 玫瑰紫暖色系，暮光胭脂底（**v10.2 主题强化**）
- 配色：`#FF7761` `#FF9A56` `#FFCC5C` `#88D8B0` `#8098CF` `#D478CA` `#FF8FA0` `#FFB870`
- 盘面：`gridOuter:#241019` / `gridCell:#341628` / `cssBg:#1A0810`（玫瑰暮霭）
- 风格：`glossy`

#### `lava` 🔥 熔岩炽焰

- 火红 / 橙黄熔浆，焦炭暗底
- 配色：`#FF4040` `#FF6830` `#FF9020` `#FFB818` `#E84040` `#FF3868` `#FF7848` `#FFA830`
- 风格：`glossy` · `radius=4`（接近瓷砖感）

### 4.4 日系美学（2 款）

#### `sakura` 🌸 樱花飞雪

- 夜樱场景——胭脂粉紫夜底，粉红/翠绿/金黄方块如花瓣飘落（**v10.2 主题强化**）
- 配色：`#FF4490` `#FF2870` `#FFB0D8` `#78D860` `#78B8F0` `#CC60E8` `#FFBA30` `#58D890`
- 盘面：`gridOuter:#241018` / `gridCell:#321628` / `cssBg:#1A0810`（夜樱粉光）
- 风格：`glass` · `radius=8`

#### `koi` 🎏 锦鲤跃龙

- **icon**：`🎋 🌊 🪷 ⛩️ 🐟 🏮 🎐 🎏`（锦鲤池 + 日式风物）
- 配色：`#FF5040` `#F07828` `#F0C820` `#3A9EC8` `#E880A8` `#38A8B8` `#F05888` `#D0A858`
- 风格：`glass` · `radius=9` · `cssBg:#020A14`
- **专属符号**：🎋🪷⛩️🏮🎐🎏 全日式独占

### 4.5 休闲甜系（2 款）

#### `candy` 🍭 糖果甜心

- **icon**：`🍪 🎀 🍫 🍰 🍩 🍬 🍭 🧁`（纯糖果甜点）
- 配色：`#FF4466` `#FF8820` `#FFD020` `#44E848` `#22AAFF` `#CC66FF` `#FF44BB` `#22E8CC`
- 盘面：`gridOuter:#22082A` / `gridCell:#321048` / `cssBg:#1A0628`（深莓糖果橱，**v10.2 主题强化**）
- 风格：`glossy` · `radius=8`

#### `bubbly` 🫧 元气泡泡

- **icon**：`🐬 🦩 🪼 🌿 🦀 🐢 🫧 🦐`（萌系水族 + 果冻气泡）
- 配色：`#FF72BB` `#4898F8` `#42C442` `#FFAA18` `#22C87A` `#E060FF` `#FF8848` `#12C4E8`
- 风格：`jelly` · `radius=14`（最圆润果冻感）

### 4.6 卡通复古（2 款）

#### `toon` 🎨 卡通乐园

- **icon**：`🐼 🐨 🐘 🦒 🦛 🦔 🦘 🦄`（动物园明星）
- 配色：`#FF5570` `#FF7F11` `#FFD600` `#00C853` `#5590FF` `#DD60FF` `#FF6098` `#00BCD4`
- 风格：`cartoon` · `radius=10` · `cssBg:#1A1040`

#### `pixel8` 🕹️ 街机格斗

- **icon**：`💣 🪙 🥊 🎮 👊 🍄 🕹️ 👾`（NES/SNK 街机）
- 配色：`#FF2050` `#1E78FF` `#00C030` `#F8C000` `#CC00CC` `#00B8C8` `#FF5800` `#90E000`
- 风格：`glossy` · `radius=4`（像素风方角）

### 4.7 浅色系（2 款）

> 浅色盘面要求方块用深色饱和块（WCAG 对比 ≥ 4.5），与暗色系完全互补。

#### `dawn` ☀️ 晨光微曦

- 暖奶油盘面 + 高饱和冷暖交替积木
- 配色：`#B02000` `#0050C0` `#A85800` `#187030` `#8010B0` `#006868` `#C01040` `#4020C8`
- 盘面：`gridOuter:#8A7040` / `gridCell:#F8F0E0` / `cssBg:#F0E8D4`

#### `macaroon` 🍬 法式马卡

- 哑光平涂 + 暖白盘面，饱和甜点色
- 配色：`#C01860` `#0058C0` `#B06000` `#1A7830` `#8020C0` `#007860` `#C02020` `#5828B0`
- 风格：`flat`（唯一平涂皮肤）

### 4.8 生活意象（4 款）

#### `food` 🍕 美食盛宴

- **icon**：`🥑 🍣 🍞 🍕 🌮 🍔 🥩 🍜`（八国主食轮转）
- 配色：`#FF5040` `#F09020` `#F8D020` `#60B830` `#E09050` `#D87040` `#F05878` `#C068F0`
- 风格：`glossy`

#### `music` 🎵 音乐律动

- **icon**：`🎤 🎹 🎧 🎺 🥁 🎸 🎷 🎻`（八件乐器）
- 配色：`#FF3060` `#FF9020` `#FFE820` `#40E840` `#3088FF` `#E040FF` `#FF60A0` `#40E8E8`
- 风格：`neon` · `cssBg:#08040F`

#### `pets` 🐾 萌宠天地（浅色）

- **icon**：`🐰 🐠 🐦 🐱 🦎 🐹 🐭 🐶`（家庭小宠）
- 配色：`#B82020` `#A05800` `#7A6000` `#187020` `#1050B8` `#901078` `#C02820` `#006060`
- 盘面：`gridOuter:#C0B090` / `gridCell:#F5EDDC`（浅奶油）

#### `universe` 🪐 宇宙星际

- **icon**：`🛸 🌍 🔭 🌙 ⭐ 🪐 ☄️ 🌠`（八大天体）
- 配色：`#E84020` `#F09030` `#D8C820` `#3898D0` `#D040D0` `#20B0C0` `#D88020` `#9070F0`
- 风格：`glass` · `radius=8`

### 4.9 奇幻神话（4 款）

#### `fantasy` 🔮 魔幻秘境

- 紫水晶/蓝宝石/祖母绿/红宝石宝石矿物配色
- 配色：`#CC48FF` `#5080F0` `#18B848` `#E82020` `#E8B820` `#20B0D8` `#E020A0` `#9060E0`
- 盘面：`gridOuter:#0E0428` / `gridCell:#1A0838` / `cssBg:#0A0420`（水晶秘境紫，**v10.2 主题强化**）
- 风格：`glass`

#### `fairy` 🧚 花仙梦境

- **icon**：`🌻 🦋 🌹 🍃 🪄 🌷 🌈 🧚`（花仙系专属）
- 配色：`#D060F0` `#F060A0` `#60A0F8` `#F07060` `#F040A0` `#9B72F0` `#F09040` `#40D0E8`
- 盘面：`gridOuter:#1F0E2C` / `gridCell:#2C1640` / `cssBg:#150A24`（玫瑰薰衣紫，**v10.2 主题强化**）
- 风格：`glass` · `radius=9`

#### `greece` 🏛️ 希腊神话

- **icon**：`🔱 ☀️ 🍷 🦚 ⚡ 🏹 💘 🦉`（奥林匹斯诸神图腾）
- 配色：`#E8C030` `#4898E8` `#90C040` `#F07828` `#90B8D8` `#D050E8` `#20A8B8` `#7860E0`
- 盘面：`gridOuter:#040A18` / `gridCell:#0A1228` / `cssBg:#020812`（深爱琴海蓝，**v10.2 主题强化**）
- 风格：`glossy`

#### `demon` 😈 恶魔冥界

- **icon**：`👁️ ⚔️ 💀 🕷️ 🦇 👹 ☠️ 😈`（冥府八符）
- 配色：`#F03030` `#F0A020` `#CC40FF` `#FF5030` `#E8A0D8` `#9870D8` `#E03060` `#20D848`
- 盘面：`gridOuter:#160408` / `gridCell:#280A12` / `cssBg:#0E0408`（地狱血赤褐，**v10.2 主题强化**）
- 风格：`glass`

### 4.10 冒险史前（2 款）

#### `beast` 🗺️ 冒险奇境

- **icon**：`🐺 🦏 🐯 🦁 🐗 🦅 🐆 🐻`（陆地猛兽八连）
- 配色：`#F0A820` `#F07030` `#5090D8` `#B0B8C8` `#D08830` `#E08050` `#A0A8A8` `#40A0D8`
- 风格：`glossy`

#### `jurassic` 🦕 恐龙世界

- **icon**：`🥚 🌋 🦕 🦴 🐉 🦖 🐊 🐍`（史前爬行类 + 化石 + 火山）
- 配色：`#50C030` `#F05030` `#9060F0` `#A8D840` `#80B850` `#30A8B8` `#D0A030` `#F0C840`
- 盘面：`gridOuter:#0E1A06` / `gridCell:#1A2A0E` / `cssBg:#0A1408`（深森林绿，**v10.2 主题强化**）
- 风格：`glossy` · K-Pg 灭绝叙事（🌋 火山）

### 4.11 文化主题（2 款，v9 新增）

#### `industrial` ⚙️ 古典工业

- 维多利亚 / 蒸汽朋克：黄铜紫铜 + 铁锈钢蓝
- **icon**：`⚙️ 🔧 🔩 🛠️ ⛓️ 🚂 🏭 ⚒️`（蒸汽朋克八件套）
- 配色：`#D49640` `#C04030` `#B86838` `#4F9080` `#B07840` `#B89060` `#6878A0` `#D4A848`
- 风格：`metal` · 焦煤铸铁底

#### `forbidden` 👑 北京皇城

- 紫禁城 / 故宫：朱红宫墙 + 龙袍金 + 翡翠 + 青花蓝
- **icon**：`🐲 👑 🪭 🧧 🥮 🀄 📜 🍵`（紫禁城八件套）
- 配色：`#C8222C` `#1B7E5C` `#1F4FA0` `#D8CCB0` `#E8B83C` `#2E7088` `#B8732C` `#E84068`
- 风格：`glossy` · 玄朱深底
- **细节**：`🐲` 龙颜 ≠ jurassic 的 `🐉` 翼龙（不同 codepoint）

### 4.12 生活扩展（6 款，v10 新增）

#### `sports` ⚽ 运动竞技

- 八大球类全家福 + 草绿球场底
- **icon**：`⚽ 🏀 ⚾ 🎾 🏐 🏈 🥎 🏆`
- 配色：`#4F9050` `#2858B0` `#C04848` `#905028` `#2090C8` `#587830` `#6038A0` `#C82838`
- 风格：`glossy` · `radius=8` · `cssBg:#06100A`
- **设计要点**：每球落在与其品牌色互补的背景（橙篮球↔深蓝、黄网球↔赤土、白排球↔泳池蓝）

#### `vehicles` 🏎️ 极速引擎

- 八大现代交通（避开 `industrial` 的 🚂 蒸汽火车）
- **icon**：`🏎️ ✈️ 🚀 🚁 🚢 🛵 🚥 🚌`
- 配色：`#8090A0` `#2860C8` `#E84020` `#3E7E40` `#1E70A8` `#E8C828` `#404858` `#6840B0`
- 风格：`metal` · `radius=5` · 机库深灰底

#### `forest` 🌳 山林秘境

- 树木 / 落叶 / 麦穗 / 木桩 / 鸟巢
- **icon**：`🌳 🌲 🌴 🍁 🍂 🌾 🪵 🪺`
- 配色：`#8B5828` `#D87838` `#D4A848` `#4F8048` `#2A6038` `#B0386D` `#38A878` `#5090C8`
- 风格：`glossy` · `radius=7` · 苔藓深绿底
- **专属符号**：🪵🪺 独占（避开 fairy 的 🍃、food 的 🥑）

#### `pirate` ⚓ 海盗航行

- 罗盘 / 宝藏 / 鹦鹉 / 海图（大航海八件套）
- **icon**：`⚓ 🏴‍☠️ 🪝 🦜 ⛵ 🗺️ 🧭 💎`
- 配色：`#B02020` `#D8C4A0` `#2A6890` `#6E4828` `#14406F` `#2E6F45` `#8C2858` `#C8923C`
- 风格：`glass` · `radius=6` · 深海舷板底
- **专属符号**：⚓🏴‍☠️🪝🦜⛵🗺️🧭💎 全部新增

#### `farm` 🐄 田园农场（浅色）

- 家畜 + 蔬果，**浅春绿牧草底 + 深木栏边框**（v10.1：主题一致性升级，原浅卡其底已弃用）
- **icon**：`🐄 🐖 🐑 🐔 🐣 🌽 🥕 🍎`
- 配色：`#B02838` `#1A488F` `#2A6028` `#1A6E9F` `#8E2070` `#B82038` `#5C2818` `#4830B0`
- 风格：`cartoon` · `radius=9` · `gridOuter:#5C8C42` / `gridCell:#E8F2D8` / `cssBg:#D0E5B0`
- **设计要点**：
  - 浅春绿底 + 深饱和方块（WCAG ≥ 4.5）
  - 🐑 改深苔绿（不与浅绿底同色族）；🥕 改深棕（避免「绿底+深绿萝卜」糊作一团）
  - 与 `pets` 浅卡其家宠 / `food` 暗烹饪 / `toon` 紫底动物园完全错位

#### `desert` 🐫 沙漠绿洲（v10.1：浅色化主题升级）

- 骆驼 / 仙人掌 / 古寺 / 赤陶罐，**浅沙金主调 + 深饱和宝石色块**
- **icon**：`🐫 🦂 🌵 🏜️ 🪨 🏺 🛕 🌅`
- 配色：`#1A4070` `#B02030` `#6F1858` `#1A6048` `#4830B0` `#185878` `#5C0F38` `#1A6878`
- 风格：`glossy` · `radius=7` · `gridOuter:#A88838` / `gridCell:#F0E0B0` / `cssBg:#E8C878`
- **设计要点**：
  - **从深色（夜空蓝）转为浅色（沙金）**：让「沙漠」叙事直接通过 page bg 传达
  - 8 色 blockColor 全部重做，覆盖蓝/红/紫/绿四象限的深饱和色，保证浅沙底上 WCAG ≥ 4.5
  - `uiDark: false`，配套提供完整 `cssVars`（深字 + 沙金 accent）
- **专属符号**：🐫🦂🌵🏜️🪨🏺🛕🌅 全部新增

---

## 5. icon 全局唯一性矩阵

### 5.1 24 款带 icon 皮肤完整 emoji 列表（共 192 个）

| 皮肤 | 8 个 icon |
|---|---|
| `aurora` | 🦌 🐧 🐋 ❄️ 🌌 🐻‍❄️ 🦭 🏔️ |
| `ocean` | 🐙 🦞 🐡 🪸 🐚 🐳 🦈 🦑 |
| `koi` | 🎋 🌊 🪷 ⛩️ 🐟 🏮 🎐 🎏 |
| `candy` | 🍪 🎀 🍫 🍰 🍩 🍬 🍭 🧁 |
| `bubbly` | 🐬 🦩 🪼 🌿 🦀 🐢 🫧 🦐 |
| `toon` | 🐼 🐨 🐘 🦒 🦛 🦔 🦘 🦄 |
| `pixel8` | 💣 🪙 🥊 🎮 👊 🍄 🕹️ 👾 |
| `food` | 🥑 🍣 🍞 🍕 🌮 🍔 🥩 🍜 |
| `music` | 🎤 🎹 🎧 🎺 🥁 🎸 🎷 🎻 |
| `pets` | 🐰 🐠 🐦 🐱 🦎 🐹 🐭 🐶 |
| `universe` | 🛸 🌍 🔭 🌙 ⭐ 🪐 ☄️ 🌠 |
| `beast` | 🐺 🦏 🐯 🦁 🐗 🦅 🐆 🐻 |
| `greece` | 🔱 ☀️ 🍷 🦚 ⚡ 🏹 💘 🦉 |
| `demon` | 👁️ ⚔️ 💀 🕷️ 🦇 👹 ☠️ 😈 |
| `jurassic` | 🥚 🌋 🦕 🦴 🐉 🦖 🐊 🐍 |
| `fairy` | 🌻 🦋 🌹 🍃 🪄 🌷 🌈 🧚 |
| `industrial` | ⚙️ 🔧 🔩 🛠️ ⛓️ 🚂 🏭 ⚒️ |
| `forbidden` | 🐲 👑 🪭 🧧 🥮 🀄 📜 🍵 |
| `sports` | ⚽ 🏀 ⚾ 🎾 🏐 🏈 🥎 🏆 |
| `vehicles` | 🏎️ ✈️ 🚀 🚁 🚢 🛵 🚥 🚌 |
| `forest` | 🌳 🌲 🌴 🍁 🍂 🌾 🪵 🪺 |
| `pirate` | ⚓ 🏴‍☠️ 🪝 🦜 ⛵ 🗺️ 🧭 💎 |
| `farm` | 🐄 🐖 🐑 🐔 🐣 🌽 🥕 🍎 |
| `desert` | 🐫 🦂 🌵 🏜️ 🪨 🏺 🛕 🌅 |

### 5.2 一键校验脚本

```bash
node -e "
const { SKINS } = require('./web/src/skins.js');
const used = new Map();
let dup = 0;
for (const [id, s] of Object.entries(SKINS)) {
  if (!s.blockIcons) continue;
  for (const ic of s.blockIcons) {
    if (used.has(ic)) { console.log('DUP:', ic, used.get(ic), '↔', id); dup++; }
    else used.set(ic, id);
  }
}
console.log('总皮肤:', Object.keys(SKINS).length, '带 icon:',
  [...new Set([...used.values()])].length, 'icon 总数:', used.size, '重复:', dup);
"
# 期望输出：总皮肤: 34 带 icon: 24 icon 总数: 192 重复: 0
```

### 5.3 emoji 主题域覆盖图谱

| 主题域 | 已用皮肤 | 备注 |
|---|---|---|
| 极地动物 | aurora | 🐻‍❄️🦭🦌🐧 独占 |
| 深海生物 | ocean | 🪸🐚🐳🦈 独占 |
| 萌系水族 | bubbly | 🐬🦩🪼🦀🐢🦐 与 ocean 错位 |
| 家庭萌宠 | pets | 🐰🐱🐶🐹🐭 浅底独占 |
| 动物园明星 | toon | 🐼🐨🐘🦒🦛🦔🦘🦄 |
| 陆地猛兽 | beast | 🐺🦏🐯🦁🐗🦅🐆🐻 |
| 史前爬行 | jurassic | 🦕🦖🐊🐍🐉🌋🥚🦴 |
| 农场家畜 | farm | 🐄🐖🐑🐔🐣 |
| 沙漠生物 | desert | 🐫🦂 |
| 树木植被 | forest | 🌳🌲🌴🍁🍂🪵🪺 |
| 花卉精灵 | fairy | 🌻🌹🌷🍃🦋 |
| 蔬果食材 | food + farm | 🥑🍕🍣🍔 vs 🌽🥕🍎 错位 |
| 甜点糖果 | candy | 🍪🎀🍫🍰🍩🍬🍭🧁 |
| 乐器 | music | 🎤🎹🎧🎺🥁🎸🎷🎻 |
| 街机/8-bit | pixel8 | 💣🪙🥊🎮🕹️👾 |
| 球类运动 | sports | ⚽🏀⚾🎾🏐🏈🥎🏆 |
| 现代交通 | vehicles | 🏎️✈️🚀🚁🚢🛵🚥🚌 |
| 工业机械 | industrial | ⚙️🔧🔩🛠️⛓️🚂🏭⚒️ |
| 大航海 | pirate | ⚓🏴‍☠️🪝🦜⛵🗺️🧭💎 |
| 紫禁城 | forbidden | 🐲👑🪭🧧🥮🀄📜🍵 |
| 日本意象 | koi | 🎋🌊🪷⛩️🏮🎐🎏 |
| 希腊神话 | greece | 🔱⚡🏹🦚🦉💘🍷☀️ |
| 冥府恶魔 | demon | 👁️⚔️💀🕷️🦇👹☠️😈 |
| 天体宇宙 | universe | 🛸🌍🔭🌙⭐🪐☄️🌠 |

**未来可扩展空白象限**（保留池）：

- **童话奇幻人物** 🧙🧛🧜🧝🧞🧟🦹🦸（适合 mythic / wizard 主题）
- **军事兵器** 🗡️🛡️🔫💥🛰️（适合 warfare 主题）
- **办公学习** 📚📖✏️📝📐📏🗓️🎓（适合 academy 校园主题）
- **节日庆典** 🎄🎃🎆🎇🪔🥳🎁（适合 festival 主题）
- **赛车竞速符号** 🏁🚥🏆🎽（部分已被 sports/vehicles 占用）
- **季节天气** 🌞🌧️🌨️⛅🌪️🌦️（部分受 universe/aurora 限制）

---

## 6. 同步与变更管理

### 6.1 Web ↔ 小程序同步

`web/src/skins.js` 是 **唯一事实源**。`scripts/sync-miniprogram-skins.cjs` 脚本以 sandbox VM 加载 ESM 源、抽取 `SKINS` 对象、JSON 序列化后写入 `miniprogram/core/skins.js`。

```bash
node scripts/sync-miniprogram-skins.cjs
# 输出：Synced 34 skins to miniprogram/core/skins.js
```

> **注意**：小程序 skins.js 是 CommonJS（`require`/`module.exports`），ESLint 会因 ESM-only 配置报 `no-undef`。这是预期行为，不算错误。

### 6.2 自动化校验流水线

每次新增 / 修改皮肤后必须执行：

```bash
# 1. icon 唯一性
node -e "..."  # 见 §5.2

# 2. ESLint
npx eslint web/src/skins.js

# 3. 单元测试（皮肤渲染、配色、序列化）
npx vitest run

# 4. miniprogram 同步
node scripts/sync-miniprogram-skins.cjs
```

### 6.3 变更历史

| 版本 | 日期 | 变更 |
|---|---|---|
| v1 | — | 初始 8 款基础皮肤 |
| v3 | — | 合并 cosmos/frost/midnight/pastel/retro/jungle 为 cyber/aurora/neonCity/candy/pixel8/toon |
| v3.1 | — | 移除 sage/terra/wood/cozy（4 款低对比皮肤） |
| v5 | — | 新增 dawn/macaroon 浅色双子 |
| v6 | — | 新增 food/music/pets/universe（生活意象 4 款） |
| v7 | — | 新增 beast/greece/demon/jurassic/fairy（奇幻冒险 5 款） |
| v8 | — | 全局 icon 配色优化（icon ↔ blockColor 反差强化） |
| **v9** | **2026-04-27** | **新增 industrial（古典工业）+ forbidden（北京皇城）** |
| **v10** | **2026-04-28** | **新增 sports / vehicles / forest / pirate / farm / desert（生活扩展 6 款）** |
| **v10.1** | **2026-04-28** | **主题↔背景一致性升级（§2.4 新增第四铁律）：farm 卡其沙黄→浅春绿牧草；desert 深蓝夜空→浅沙金主调（含 uiDark 转浅色 + 8 色 blockColor 全部重做）；浅色皮肤 4 → 5 款** |
| **v10.2** | **2026-04-28** | **主题↔背景一致性铁律全量推广至 34 款：8 款暗色皮肤的 cssBg/gridOuter/gridCell 注入主题色相（sunset 玫瑰胭脂、sakura 胭脂粉紫、candy 莓果橱、fantasy 水晶秘境紫、fairy 玫瑰薰衣、greece 爱琴海蓝、demon 血赤褐、jurassic 深森林绿），其余 26 款逐一审计后保留** |

---

## 7. 新增皮肤实操指南

### 7.1 新增皮肤的 6 步标准流程

1. **占位明确主题域**：在 §5.3 找到尚未覆盖的 emoji 主题域，避免与现有 24 款重叠
2. **抽 8 个 emoji**：保证每个 emoji 视觉特征清晰（不要选过于细小或与现有皮肤近似的 emoji）
3. **设计 8 色配色**：每个 emoji 的主色 → 计算其互补 / 反差色作为 blockColor
4. **选择 blockStyle**：根据主题质感选 glossy / metal / glass / neon / cartoon / jelly 之一
5. **设计盘面深浅**：决定 uiDark = true / false，配套设计 gridOuter / gridCell / cssBg / cssVars
6. **同步 + 校验**：跑 §6.2 全套流水线

### 7.2 模板代码（复制即用）

```js
yourSkinId: {
    id: 'yourSkinId',
    name: '🎨 主题名称',
    boardWatermark: { icons: ['🎨', '🖼️'], opacity: 0.08 },
    // 设计说明：
    //   - 主题域：xxx（避开 §5.3 已覆盖域）
    //   - 反差策略：xxx ↔ xxx 互补 / 冷暖
    blockIcons: ['🅰️', '🅱️', '...', '🎯'],
    blockColors: [
        '#XXXXXX', // 🅰️ 含义（emoji 色↔背景色反差类型）
        // ...
    ],
    gridOuter:   '#0X0X0X',
    gridCell:    '#1X1X1X',
    gridGap:     1,
    blockInset:  2,
    blockRadius: 6,
    blockStyle:  'glossy', // glossy/metal/glass/neon/cartoon/jelly/flat
    clearFlash:  'rgba(R,G,B,A)',
    cssBg:       '#0X0X0X',
    uiDark:      true,
    cssVars: {
        '--accent-color': '#XXXXXX',
        '--accent-dark':  '#XXXXXX',
        '--h1-color':     '#XXXXXX'
    }
},
```

### 7.3 浅色皮肤特别注意

设浅色盘面时（如 `dawn` / `macaroon` / `pets` / `farm`）：

- `uiDark` 设为 **false**（不会启用 `UI_DARK_BASE`）
- `blockColors` 必须用 **深色饱和色**（明度 ≤ 50%，WCAG 对比 ≥ 4.5）
- `cssVars` 必须显式提供：`--text-primary`（深字）/`--text-secondary`/`--accent-color`/`--shadow`/`--h1-color`/`--stat-surface`/`--stat-label-color`/`--select-bg`/`--select-border`

否则会回退到深色 UI 默认值，导致字看不清。

---

## 8. 关联文件索引

| 文件 | 作用 |
|---|---|
| `web/src/skins.js` | 全部 34 款定义（唯一事实源） |
| `miniprogram/core/skins.js` | 自动同步产物（不要手改） |
| `scripts/sync-miniprogram-skins.cjs` | Web → 小程序同步脚本 |
| `web/src/themes/` | blockStyle 渲染管线（glossy/metal/...） |
| `web/public/styles/main.css` | CSS 变量系统、皮肤热切换样式 |
| `web/src/skinSelector.js` | 皮肤切换 UI |
| `tests/skins.test.js`（如有） | 单元测试 |
| `docs/WECHAT_MINIPROGRAM.md` | 小程序皮肤同步策略 |

---

## 9. FAQ

**Q1：能否禁用某款皮肤？**
A：从 `SKINS` 对象删除即可，但若 `localStorage.openblock_skin` 仍指向被删 ID，会自动回退到 `DEFAULT_SKIN_ID = 'titanium'`。

**Q2：blockIcons 可以少于 8 个吗？**
A：可以为 0（纯配色皮肤如 `classic` / `titanium`），但若提供则必须正好 8 个，与 `blockColors` 一一对应。

**Q3：皮肤切换时为什么有些 CSS 变量会被清掉？**
A：见 `applySkinToDocument()` —— 浅色皮肤切换时会先 `removeProperty(THEME_VAR_KEYS)`，再设置新值；深色皮肤会以 `UI_DARK_BASE` 为基准合并 `cssVars`。这保证浅 → 暗 / 暗 → 浅 切换不残留旧值。

**Q4：emoji 在不同字体下渲染不一致怎么办？**
A：移动端、Mac、Win 各家厂商 emoji 字形差异确实存在。设计时用 **emoji 主色调**（不是某厂商的特定渲染）作为反差判据，例如 🍕 都被各家画成红+黄+绿三色，那就以「暖色为主」为依据。皮肤上线前应在 iOS / Android / Win / Mac 全平台抽测。

**Q5：可以只在小程序里启用某款皮肤、Web 不启用吗？**
A：不行。`scripts/sync-miniprogram-skins.cjs` 是单向同步，小程序皮肤完全镜像 Web。如需平台差异化可在 sync 脚本中加白名单过滤。

---

> 文档维护人：算法 / UI / 皮肤组
> 更新建议：每次新增 / 修改 / 删除皮肤后，**同步更新本文档 §1 总览、§4 详解、§5.1 矩阵、§6.3 历史**。
