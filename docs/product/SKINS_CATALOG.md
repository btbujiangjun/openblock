# OpenBlock 皮肤目录


> 代码位置：`web/src/skins.js`、`miniprogram/core/skins.js`、`scripts/sync-miniprogram-skins.cjs`
> 关联：[`WECHAT_MINIPROGRAM.md`](../platform/WECHAT_MINIPROGRAM.md)（小程序皮肤同步）、`web/src/themes/`（渲染管线）

---

## 一、总览

OpenBlock 提供 **42 款** 主题皮肤，覆盖 4 大维度：

- **明暗底**：33 款深色 + 9 款浅色（`dawn` / `pets` / `farm` / `desert` / `zen` / `cafe` / `garden` / `doodle` / `nordic`）
- **是否携带 emoji icon**：**35 款带 icon**（每款 8 枚）+ **7 款纯配色皮肤**（`classic` / `titanium` / `sunset` / `sakura` / `apple` / `nordic` / `zodiac`）
- **blockStyle 渲染管线**：`glossy / metal / glass / cartoon / neon / jelly / flat / pixel8 / bevel3d` 共 9 种
- **全局 icon 唯一性**：35 × 8 = **280 个 emoji 全部互不重复**（强约束 / 自动校验）
- **主题↔背景一致性**：盘面/页面背景的色相必须服务于皮肤主题叙事，而不仅仅是 icon 的反差衬底（详见 §二.4 与 §四各小节）
- **小程序手机端渲染**：`miniprogram/core/skins.js` 会在同步字段基础上叠加白色系盘面、方块对比度约束、主题水印和 `zh-CN` / `en` 皮肤名 i18n，以适配触屏手机的可读性。

总皮肤矩阵：

| 大类 | 数量 | 皮肤 ID |
|---|---|---|
| 基础经典 | 2 | `classic` `titanium` |
| 暗色科技 | 2 | `aurora` `neonCity` |
| 自然元素 | 2 | `ocean` `sunset` |
| 日系美学 | 2 | `sakura` `koi` |
| 休闲甜系 | 1 | `candy` |
| 卡通复古 | 2 | `toon` `pixel8` |
| 浅色系 | 1 | `dawn` |
| 生活意象 | 4 | `food` `music` `pets` `universe` |
| 奇幻神话 | 4 | `fantasy` `fairy` `greece` `demon` |
| 冒险史前 | 1 | `jurassic` |
| 文化主题 | 4 | `industrial` `forbidden` `mahjong` `boardgame` |
| 生活扩展 | 7 | `sports` `outdoor` `vehicles` `forest` `pirate` `farm` `desert` |
| 东方美学 | 1 | `zen` |
| 治愈休闲 | 2 | `cafe` `garden` |
| 创意教育 | 1 | `doodle` |
| 科幻未来 | 1 | `cyberpunk` |
| 北欧极简 | 1 | `nordic` |
| 节日庆典 | 1 | `fiesta` |
| 星座占卜 | 1 | `zodiac` |
| 极简设备 | 1 | `apple` |

合计 **42** 款。默认皮肤为 `titanium`（钛晶矩阵），由 `DEFAULT_SKIN_ID` 常量控制；玩家选择持久化至 `localStorage.openblock_skin`。

**已下线与迁移**（`REMOVED_SKIN_ALIASES`，读档时自动改写）：`cyber`→`neonCity`，`macaroon`→`dawn`，`neural`→`neonCity`，`lava`→`sunset`，`bubbly`→`ocean`（v10.33，icon 精华并入 ocean），`beast`→`forest`（v10.33，猛兽 icon 融入荒野秘境）。

---

## 二、设计原则（三大铁律）

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

35 款带 icon 皮肤的 280 个 emoji **全集互斥**（cross-skin uniqueness）。

- 同一 emoji **绝不重复出现**在两个皮肤中
- 由 `node -e "..."` 一行脚本可一键校验（见 §六.2）
- 已有规避案例：
  - jurassic 用 🐉（翼龙）→ forbidden 用 🐲（龙颜）：不同 codepoint
  - food 用 🥑/🍣，candy 用 🍩/🧁：完全错开
  - pets 用 🐰，fairy 用 🧚：宠物 vs 精灵分明

### 2.4 主题↔背景一致性铁律

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

#### 2.4.1 全量审计结果（42 款）

依照本铁律对全部皮肤逐一审计，分为 3 类：

**A. 已合理保留（28 款）**：背景色相已直接服务于主题叙事，无需调整：

`classic`（皇家蓝休闲消除盘） · `titanium`（钛冷蓝） · `aurora`（北极冰蓝） · `neonCity`（都市夜近黑） · `ocean`（深海蓝） · `koi`（深水蓝） · `toon`（漫画聚光紫） · `pixel8`（街机厅黑） · `dawn`（晨光奶油） · `food`（餐厅暖棕） · `music`（演出暗紫） · `pets`（家居米黄） · `universe`（深空近黑） · `industrial`（焦煤铸铁） · `forbidden`（玄朱朱红） · `sports`（草绿球场） · `outdoor`（黎明山谷蓝） · `vehicles`（机库灰混凝土） · `forest`（苔藓深绿） · `pirate`（深海舷板） · `farm`（浅春绿牧草） · `desert`（浅沙金） · `mahjong`（茶馆绿呢+实木暖灯） · `boardgame`（赌场红丝绒+绿呢+酒红）

**B. 主题强化与重做**：

`farm`：卡其沙→浅春绿；`desert`：深蓝夜→浅沙金。

**C. 暗色皮肤主题色相注入**（8 款）：

| 皮肤 | 旧 cssBg | 新 cssBg | 推移方向 |
|---|---|---|---|
| `sunset` 琥珀流光 | `#0E0610` | `#1A0810` | 纯黑紫红 → 玫瑰胭脂暮霭（点出琥珀宝石暖晕） |
| `sakura` 樱花飞雪 | `#100608` | `#1A0810` | 纯黑红 → 胭脂粉紫夜（夜樱粉光） |
| `candy`  糖果甜心 | `#120420` | `#1A0628` | 通用紫黑 → 莓果糖果橱（甜系深莓紫） |
| `fantasy` 魔幻秘境 | `#040210` | `#0A0420` | 纯黑 → 水晶秘境紫（魔法紫晕） |
| `fairy` 花仙梦境 | `#0C0618` | `#150A24` | 通用紫 → 玫瑰薰衣紫（花园梦幻调） |
| `greece` 希腊神话 | `#050508` | `#020812` | 中性黑 → 深爱琴海蓝（地中海夜空） |
| `demon` 恶魔冥界 | `#060210` | `#0E0408` | 通用紫 → 深血赤褐（地狱血火） |
| `jurassic` 恐龙世界 | `#060C02` | `#0A1408` | 纯黑绿 → 深森林绿（侏罗丛林） |

> 推移原则：**保持总明度（仍为暗底，方块亮度不损失）+ 注入主题色相**。

#### 2.4.2 主题内 8 色差异度铁律

每款带 icon 皮肤内部的 8 个 `blockColors` 必须在 HSL 距离矩阵中两两 ≥ 2.0，否则同一主题不同 icon 会因色块近似而难以辨识。

判定方式：

```
dist(A, B) = √( 0.02·dh² + 0.05·ds² + 0.10·dl² )   // dh ∈ [0,180]，色相差权重最低、明度差权重最高
```

阈值约定：

- `minD ≥ 4.0`：理想区间，色相 / 饱和度 / 明度均拉开
- `minD ∈ [2.0, 4.0]`：可接受（视觉可分辨，但同色族）
- `minD < 2.0`：**视觉混淆**，必须修正
- 设计意图同族系列（如 `titanium` 钛冷蓝 8 阶渐变 / `industrial` 铜锡渐变 / `neonCity` 霓虹同调）属于刻意设计的"色阶皮肤"，免除该铁律

全量审计：在 42 款皮肤中识别出 8 款带 icon 皮肤的 `minD < 2.0` 视觉混淆案例并全部修正，最终所有带 icon 的 35 款皮肤的 minD ≥ 2.0：

| 皮肤 | icon | 旧色 | 新色 | minD 提升 | 设计依据 |
|---|---|---|---|---|---|
| `pets`       | 🐭 鼠     | `#C02820`（与 🐰 红 `#B82020` 同色族） | `#5A2880` 深紫 | 0.69 → 3.10 | 与 🦎 蓝 / 🐹 品红错开 |
| `desert`     | 🌅 朝霞   | `#1A6878`（与 🏺 陶青 `#185878` 同色族） | `#6F2890` 暮霞紫 | 1.48 → 2.17 | 朝霞紫粉色调 |
| `farm`       | 🌽 玉米   | `#B82038`（与 🐄 朱红 `#B02838` 同色族） | `#8C5028` 烤玉米棕 | 1.69 → 2.33 | 自然玉米褐棕 |
| `koi`        | 🪷 莲花   | `#3A9EC8`（与 🏮 红灯笼蓝 `#38A8B8` 同色族） | `#4070D8` 深royal蓝 | 1.95 → 3.50 | 莲花池深蓝调 |
| `food`       | 🍔 汉堡   | `#D87040`（与 🌮 暖橙 `#E09050` 同色族） | `#B05028` 烤肉锈棕 | 2.03 → 2.81 | 汉堡牛肉色 |
| `industrial` | ⚒️ 锤镐 + ⛓️ 锁链 | `#D4A848` (与 ⚙️ 黄铜) + `#B07840` (与 🔩 紫铜) | `#3A4048` 深铸铁灰 + `#5C2820` 暗锈链红 | 1.06 → 2.69 | 黑铁锤镐 + 锁链氧化锈 |
| `toon`       | 🦘 袋鼠   | `#FF6098`（与 🐼 #FF5570 同粉色族） | `#B85828` 袋鼠毛棕 | 1.78 → 3.37 | 澳洲袋鼠本色 |
| `beast`      | **整组重做** | 原色板与 icons 索引错位（`#40A0D8` 注 🦈 但实际为 🐻），且 🐯/🐆 共占近蓝族 | 🐺 钢蓝灰 / 🦏 深红 / 🐯 深天蓝 / 🦁 深紫 / 🐗 林绿 / 🦅 鎏金 / 🐆 苔绿 / 🐻 棕熊本色 | 1.78 → 5.62 | 8 色全互补 + icon 严格对齐 |

#### 2.4.3 带 icon 皮肤的 blockStyle 铁律

带 emoji icon 的皮肤在方块表面会绘制中心 emoji（位置 ~50% / 53%，字号约方块宽 56%，因此 **emoji 顶部约在方块 25% 处**）。**立体反光材质**（glossy / glass / jelly / metal）的高光层与 icon 在视觉中心发生冲突：

- `glossy`：左上角白色三角光斑 (12%-38%) + 顶部 50% 渐变 → 三角穿过 emoji 头顶
- `glass`：顶部 58% 强白渐变 → emoji 上半部分被白光"洗白"
- `jelly`：左上角椭圆光斑 (26%/22%) + 径向高光 (32%/50%) → 高光散射糊化 emoji
- `metal`：7-stop 拉丝渐变中心亮带 (42%-54%) → **金属亮带横穿 emoji 中心**，最严重

带 emoji icon 的皮肤在方块表面会绘制中心 emoji。`cartoon` 风格在 `web/src/renderer.js` 中实现为**哑光磨砂瓷砖质感**——去除所有水晶反光层：

| 元素 | cartoon 渲染参数 |
|---|---|
| 主色渐变 | lighten 12% → color → darken 8%（极轻立体） |
| 顶部白光层 | **无** |
| 左上角光斑 | **无** |
| 底部暗角 | 0.10 (78%-100%) |
| 亮内描边 | 0.28 |
| 暗外描边 | 0.30（边界清晰） |
| emoji 阴影 | **双层 0.34 + 0.20**（增强可读性） |

效果：方块有渐变 + 暗角带来的极轻立体感，表面**无强反光**，emoji **100% 清晰可读**。

`neon` 风格带 icon 时跳过顶部白光层（仅 music 一款受益）。

**铁律**：`blockIcons` 存在时，`blockStyle` 必须从以下 4 种 icon 友好风格中选择：

| Style | 高光位置 | 与 emoji 中心冲突 | 适用场景 |
|---|---|---|---|---|
| `cartoon` ★默认 | 无白光、无光斑，仅极轻渐变 | **无** | 几乎所有带 icon 皮肤 |
| `neon` | 带 icon 时跳过顶部白光，仅霓虹边框 | **无** | 赛博/电音/霓虹主题 |
| `flat` | 单色 + 一道暗边 | **无** | 极简风格皮肤 |
| `pixel8` | 边缘 14% 像素带 | 边缘略干扰 | 8-bit 复古主题 |

最终 42 款皮肤 blockStyle 分布：

| blockStyle | 数量 | 皮肤 |
|---|---|---|
| `cartoon` | 18 | toon, dawn, food, pets, outdoor, vehicles, farm, boardgame, cafe, garden, doodle, fiesta 等 |
| `glossy` | 8 | candy, pixel8, greece, jurassic, sports, forest, desert, forbidden |
| `glass` | 7 | aurora, ocean, fairy, koi, demon, universe, zodiac |
| `neon` | 3 | neonCity, music, cyberpunk |
| `flat` | 2 | zen, nordic |
| `metal` | 2 | titanium, industrial |
| `bevel3d` | 1 | classic |
| `jelly` | 0 | （bubbly 已下线） |
| `pixel8` | 1 | pixel8 |

> `dawn` 虽无 `blockIcons`，但浅色盘面下 `glossy` 的高光、灰边和棋盘线容易显脏，已改为 `cartoon`，并用 `gridGap:0 + 低 alpha gridLine` 替代粗格缝。

#### 2.4.4 品牌字标 icon 点缀规则

`OPEN BLOCK` 像素字标中的装饰 emoji 不应额外占用实心像素块，否则会出现“icon 旁粘一颗方块”的错觉：

- `O` 顶行保留 `c=1` 挖空位承载 `🎮`，并用 CSS `translateX(46%)` 做半格右移。
- `B` 顶行去掉 `c=1` 实心块，`c=0` 挖空位承载 `🏆`，并用 CSS `translateX(92%)` 做一格级右移。
- 位图结构负责删除多余像素，CSS 只做亚格微调；不要通过负 margin 或额外绝对定位修补。

##### 渲染层降饱和：方块色 S × 0.55

`blockColors` 的原始饱和度在 57-72%，与中心 emoji 的彩色发生「色冲突」，emoji 看起来"陷"在饱和色块里。在 `web/src/renderer.js` 中通过 `desaturateColor(hex, factor)` HSL 工具函数，在 `paintBlockCell` 入口对带 icon 皮肤的方块色统一应用 **`S × 0.55`** 降饱和：

| 性质 | 处理 |
|---|---|
| 色相 H | **完全保留**（每款皮肤的色相设计不变）|
| 饱和度 S | **× 0.55**（57-72% → 31-40%，哑光彩质感）|
| 明度 L | **完全保留**（明暗反差不变）|
| WCAG 对比度 | **不降反升**（明度不变 + 饱和度 → 灰，平均 +0.3 ~ +0.5）|
| skins.js 配置 | **完全不动**（仅渲染层处理，不破坏精心调校的色相）|

实测 desert 皮肤 8 个 blockColor 的降饱和效果：

| icon | 原色 | 原 S | → 哑光色 | 新 S | vs gridCell |
|---|---|---|---|---|---|
| 🦂 | `#B02030` | 69% | `#904049` | 38% | 5.40 |
| 🪨 | `#4830B0` | 57% | `#5A4D93` | 31% | 5.58 |
| 🏜️ | `#1A6048` | 57% | `#2A5043` | 32% | 7.00 |
| 🐫 | `#1A4070` | 62% | `#2D425D` | 34% | 7.95 |
| 🌵 | `#6F1858` | 64% | `#5B2C4F` | 35% | 8.49 |
| 🌅 | `#6F2890` | 57% | `#663F79` | 31% | 6.38 |
| 🛕 | `#5C0F38` | 72% | `#4B2037` | 40% | 10.43 |
| 🏺 | `#185878` | 67% | `#2E5162` | 37% | 6.59 |

实现关键点：

- `originalColor` 在 `paintBlockCell` 入口保留，传给 `_paintIcon` 的 `colorIdx = blockColors.indexOf(...)` 索引查找——确保 emoji 仍能正确对应原始色 → icon 的映射
- 仅当 `skin.blockIcons && skin.blockIcons.length` 时启用降饱和；不带 icon 的 7 款纯配色皮肤保留原始高饱和（继续使用水晶反光质感讲主题）
- 不影响 `clearFlash` / 其他特效色（这些直接读 `skin.clearFlash`，不经 `paintBlockCell`）

#### 2.4.5 浅色皮肤视觉舒适度

浅色皮肤的 `cssBg` 需要同时控制 **明度** 和 **饱和度**：

- 明度（HSL L）：建议 **75-90%**（避免过暗如灰底，亦避免过亮如纯白）
- **饱和度（HSL S）：建议 ≤ 25%**（超过 30% 即显浓郁，超过 40% 强烈刺激）
- 主题色相**仅通过 cssVars 的小面积 accent 传达**（按钮/边框/h1），cssBg 和 gridCell 退化为「带一点点色调的近骨白」；这种「大面积近中性 + 小面积主题色」是浅色 UI 视觉舒适度的核心原则
- gridOuter 可保留中等饱和度（S<25%）以提供盘面边框的"哑光主题色"层次

| 皮肤 | cssBg | 饱和度 | 明度 |
|---|---|---|---|---|
| `farm` | `#E6E7DC` | S~19% (骨白带绿) | L 88% |
| `desert` | `#DAD2C4` | S~23% (浅米中性) | L 81% |

- blockColors 全部保留深饱和宝石色用于明暗反差
- **WCAG 对比度验证**（blockColors vs gridCell 实际渲染场景）：
  - farm **4.85** (🐔 `#1A6E9F` vs `#EFF0EA`) ≥ 4.5 ✓
  - desert **5.26** (🦂 `#B02030` vs `#E8E2D6`) ≥ 4.5 ✓
- text-primary vs cssBg 对比度：farm 13.85、desert 11.70，远超 7:1 AAA

---

## 三、字段定义参考

每款皮肤的数据结构（见 `web/src/skins.js` 中 `Skin` typedef）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `id` | string | 唯一标识，写入 localStorage |
| `name` | string | 显示名（含 emoji 前缀） |
| `blockColors` | string[8] | 8 色方块底色（HEX） |
| `blockIcons?` | string[8] | 可选 8 个 emoji（与 blockColors 一一对应） |
| `boardWatermark?` | { icons, opacity, scale? } | 棋盘背景水印；浅色盘面宜用小中尺寸 `scale≈0.24-0.32` + 较高但不过曝的 `opacity≈0.10-0.13`，避免巨型低透明图案糊成色块 |
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
| `glossy` | 通用主流 | 顶部高光 + 底部阴影 | sports |
| `bevel3d` | 立体浮雕（v10.32 新增） | 四向梯形斜切边 + 中心面 + 顶部柔光（**无内/外描边**，避免线框切断方块） | classic（休闲消除截图风格） |
| `metal` | 金属质感 | 横向金属反光带 | titanium, industrial, vehicles |
| `glass` | 玻璃 / 半透 | 边缘高光 + 模糊 | aurora, ocean, fantasy, pirate |
| `neon` | 霓虹荧光 | 强光晕 + 外发光 | neonCity, music |
| `cartoon` | 卡通 | 厚实描边 + 平涂 | toon, pets, farm |
| `jelly` | 果冻 | 圆润 + 弹性形变 | —（bubbly 已下线） |
| `flat` | 平涂 | 无渐变纯色 | zen, nordic |
| `pixel8` | 像素 | 8-bit 锯齿 | （glossy 替代实现） |

---

## 四、皮肤分类详解

### 4.1 基础经典（2 款）

#### `classic` ✨ 极简经典（纯配色）

- **定位**：休闲消除积木的标志性高饱和八色 + 中性深灰盘面
- **配色**（8 色）：`#3F6DD8` `#4FB8E8` `#52BC4B` `#FFC428` `#F5851E` `#A848E0` `#65C4F0` `#E84D5C`
- **盘面**：`gridOuter:#1C2630` / `gridCell:#2E3E50` / `cssBg:#141C24`（中性深灰）
- **风格**：`bevel3d` · `radius=4` · `gap=1`

#### `titanium` 💎 钛晶凝光（默认，纯配色）

- **定位**：蓝灰金属质感，极深冷色盘面烘托金属光泽
- **配色**：`#6AAEE8` `#94BDDF` `#78B8EB` `#A8CCF0` `#88D0F0` `#7DBAE2` `#B4D8EC` `#8DB6D8`（蓝灰渐变 8 阶）
- **盘面**：`gridOuter:#0A1020` / `gridCell:#182030` / `cssBg:#080C18`
- **风格**：`metal` · `radius=5` · `gap=1`

### 4.2 暗色科技（2 款）

#### `aurora` 🌌 冰川极光

- 冰川极光玻璃感，深海蓝底（整合 frost / arctic 极地）
- **icon**：`🦌 🐧 🐋 ❄️ 🌌 🐻‍❄️ 🦭 🏔️`
- 配色（按 icon 序）：`#5AD8CC` `#8070F0` `#AA90FA` `#38D89E` `#28D8F0` `#8590F8` `#C488FC` `#60C8FF`
- 风格：`glass` · `radius=6`

#### `neonCity` 🌃 霓虹都市（盘面参考款）

- RGB 霓虹灯光压近黑底
- **icon**：`🌆 🚥 🚇 🎆 🏨 🚖 🌉 🛤️`（都市夜景八件套）
- 配色：`#FF2DAA` `#9B72FF` `#00E5FF` `#76FF03` `#FFAB40` `#FF4081` `#448AFF` `#18FFFF`
- 风格：`neon` · `cssBg:#080C16`

### 4.3 自然元素（2 款）

#### `ocean` 🌊 深海幽域

- **icon**：`🐙 🦞 🐡 🐬 🐚 🐳 🦈 🐢`（深海生物 + 融合原 bubbly 的 🐬🐢）
- 配色：`#00C8F0` `#0098C8` `#48D4E4` `#90F0FF` `#00E4C0` `#FFB347` `#FF7878` `#20E8FF`
- 风格：`glass` · `radius=6` · `cssBg:#020A14`
- **专属符号**：🪸🐚 独占深海

#### `sunset` 🌅 琥珀流光（纯配色）

- **定位**：暖色宝石谱（珊瑚 / 焰橙 / 琥珀 / 鎏金 / 玫瑰 / 朱砂 / 紫晶 / 蜜桃）
- **配色**（8 色）：`#FF6A50` `#FF8E3A` `#FFB230` `#FFD638` `#FF7090` `#E04098` `#A858DC` `#FFAE6A`
- **盘面**：`gridOuter:#241019` / `gridCell:#341628` / `cssBg:#1A0810`（玫瑰暮霭）
- **风格**：`glass` · `radius=7`


### 4.4 日系美学（2 款）

#### `sakura` 🌸 樱花飞雪（纯配色）

- 夜樱场景——胭脂粉紫夜底，粉红/翠绿/金黄方块如花瓣飘落
- 配色：`#FF4490` `#FF2870` `#FFB0D8` `#78D860` `#78B8F0` `#CC60E8` `#FFBA30` `#58D890`
- 盘面：`gridOuter:#241018` / `gridCell:#321628` / `cssBg:#1A0810`（胭脂粉紫夜）
- 风格：`glass` · `radius=8`

#### `koi` 🎏 锦鲤跃龙

- **icon**：`🎋 🌊 🪷 ⛩️ 🐟 🏮 🎐 🎏`（锦鲤池 + 日式风物）
- 配色：`#FF5040` `#F07828` `#F0C820` `#3A9EC8` `#E880A8` `#38A8B8` `#F05888` `#D0A858`
- 风格：`glass` · `radius=9` · `cssBg:#020A14`
- **专属符号**：🎋🪷⛩️🏮🎐🎏 全日式独占

### 4.5 休闲甜系（1 款）

#### `candy` 🍭 糖果甜心

- **icon**：`🍪 🎀 🍫 🍰 🍩 🍬 🍭 🧁`（纯糖果甜点）
- 配色：`#FF4466` `#FF8820` `#FFD020` `#44E848` `#22AAFF` `#CC66FF` `#FF44BB` `#22E8CC`
- 盘面：`gridOuter:#22082A` / `gridCell:#321048` / `cssBg:#1A0628`（深莓糖果橱）
- 风格：`glossy` · `radius=8`

### 4.6 卡通复古（2 款）

#### `toon` 🎨 卡通乐园

- **icon**：`🐼 🐨 🐘 🦒 🦛 🦔 🦘 🦄`（动物园明星）
- 配色：`#FF5570` `#FF7F11` `#FFD600` `#00C853` `#5590FF` `#DD60FF` `#B85828` `#00BCD4`
  （🦘 `#FF6098` → `#B85828` 袋鼠毛棕，避免与 🐼 同粉色族）
- 风格：`cartoon` · `radius=10` · `cssBg:#1A1040`

#### `pixel8` 🕹️ 街机格斗

- **icon**：`💣 🪙 🥊 🎮 👊 🍄 🕹️ 👾`（NES/SNK 街机）
- 配色：`#FF2050` `#1E78FF` `#00C030` `#F8C000` `#CC00CC` `#00B8C8` `#FF5800` `#90E000`
- 风格：`glossy` · `radius=4`（像素风方角）

### 4.7 浅色系（1 款）

> 浅色盘面要求方块用深色饱和块（WCAG 对比 ≥ 4.5），与暗色系完全互补。

#### `dawn` ☀️ 晨光微曦

- **定位**：清晨暖米盘面 + 清爽糖果色积木。
- **icon**：`🐝 🌱 🍯 🦗 🐞 🌿 🪹 🐓`（清晨田野八件套）
- **配色**：`#E06E62` `#5A92D6` `#D8A84E` `#55A873` `#8D75CE` `#42A7A8` `#D46282` `#6B7DDD`。
- **盘面**：`gridOuter:#F1E3C5` / `gridCell:#FFF3D8` / `gridLine:rgba(130,96,48,0.13)` / `gridGap:0` / `cssBg:#F7F0DC`。浅色盘面不使用格缝制造粗线，只保留低对比单像素网格。
- **水印**：`🌄 🌻 🕊️ 🍃`，`opacity:0.12`、`scale:0.28`。参考暗色皮肤的重复主题水印模式，但浅色盘面需提高透明度并缩小尺寸，确保可识别且不干扰落子。
- **风格**：`cartoon` · `blockInset=3` · `radius=7`。不用 `glossy`，避免浅底下高光和灰边显脏。

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
- **icon**：`🧙 🧝 🧞 💫 🗝️ 📿 🪬 🪩`（魔法奇幻八件套）
- 配色：`#CC48FF` `#5080F0` `#18B848` `#E82020` `#E8B820` `#20B0D8` `#E020A0` `#9060E0`
- 盘面：`gridOuter:#0E0428` / `gridCell:#1A0838` / `cssBg:#0A0420`（水晶秘境紫）
- 风格：`cartoon`

#### `fairy` 🧚 花仙梦境

- **icon**：`🌻 🦋 🌹 🍃 🪄 🌷 🌈 🧚`（花仙系专属）
- 配色：`#D060F0` `#F060A0` `#60A0F8` `#F07060` `#F040A0` `#9B72F0` `#F09040` `#40D0E8`
- 盘面：`gridOuter:#1F0E2C` / `gridCell:#2C1640` / `cssBg:#150A24`（玫瑰薰衣紫）
- 风格：`glass` · `radius=9`

#### `greece` 🏛️ 希腊神话

- **icon**：`🔱 ☀️ 🍷 🦚 ⚡ 🏹 💘 🦉`（奥林匹斯诸神图腾）
- 配色：`#E8C030` `#4898E8` `#90C040` `#F07828` `#90B8D8` `#D050E8` `#20A8B8` `#7860E0`
- 盘面：`gridOuter:#040A18` / `gridCell:#0A1228` / `cssBg:#020812`（深爱琴海蓝）
- 风格：`glossy`

#### `demon` 😈 恶魔冥界

- **icon**：`👁️ ⚔️ 💀 🕷️ 🦇 👹 ☠️ 😈`（冥府八符）
- 配色：`#F03030` `#F0A020` `#CC40FF` `#FF5030` `#E8A0D8` `#9870D8` `#E03060` `#20D848`
- 盘面：`gridOuter:#160408` / `gridCell:#280A12` / `cssBg:#0E0408`（地狱血赤褐）
- 风格：`glass`

### 4.10 冒险史前（1 款）

#### `jurassic` 🦕 恐龙世界

- **icon**：`🥚 🌋 🦕 🦴 🐉 🦖 🐊 🐍`（史前爬行类 + 化石 + 火山）
- 配色：`#50C030` `#F05030` `#9060F0` `#A8D840` `#80B850` `#30A8B8` `#D0A030` `#F0C840`
- 盘面：`gridOuter:#0E1A06` / `gridCell:#1A2A0E` / `cssBg:#0A1408`（深森林绿）
- 风格：`glossy` · K-Pg 灭绝叙事（🌋 火山）

### 4.11 文化主题（4 款）

#### `industrial` ⚙️ 古典工业

- 维多利亚 / 蒸汽朋克：黄铜紫铜 + 铁锈钢蓝 + 铸铁灰
- **icon**：`⚙️ 🔧 🔩 🛠️ ⛓️ 🚂 🏭 ⚒️`（蒸汽朋克八件套）
- 配色：`#D49640` `#C04030` `#B86838` `#4F9080` `#5C2820` `#B89060` `#6878A0` `#3A4048`
  （⛓️ `#B07840` → `#5C2820` 暗锈链红；⚒️ `#D4A848` → `#3A4048` 深铸铁灰）
- 风格：`metal` · 焦煤铸铁底


#### `forbidden` 👑 北京皇城

- 紫禁城 / 故宫：朱红宫墙 + 龙袍金 + 翡翠 + 青花蓝
- **icon**：`🐲 👑 🪭 🧧 🥮 🀄 📜 🍵`（紫禁城八件套）
- 配色：`#C8222C` `#1B7E5C` `#1F4FA0` `#D8CCB0` `#E8B83C` `#2E7088` `#B8732C` `#E84068`
- 风格：`glossy` · 玄朱深底
- **细节**：`🐲` 龙颜 ≠ jurassic 的 `🐉` 翼龙（不同 codepoint）

#### `mahjong` 🀅 麻将牌局

- 中式国粹 · 绿呢牌桌叙事：风牌全集 + 三元绿（發） + 数牌三家「一」代表
- **icon**：`🀀 🀁 🀂 🀃 🀅 🀇 🀙 🀐`（东南西北 + 發 + 一万 / 一筒 / 一索）
- **配色**（取自传统中国色）：
  - `#20B888` 翠青（🀀 东方青龙）
  - `#D03030` 朱红（🀁 南方朱雀）
  - `#6E7C8C` 银灰（🀂 西方白虎）
  - `#4F4F60` 玄墨（🀃 北方玄武）
  - `#1F8060` 翡翠（🀅 三元发财）
  - `#D49438` 鎏金（🀇 一万红字）
  - `#2A60B8` 青花（🀙 一筒五彩）
  - `#708030` 苍竹（🀐 一索绿竹）
- 盘面：`gridOuter:#0E2018` / `gridCell:#143028` / `cssBg:#0A1812`（麻将桌深绿呢）
- 风格：`glossy` · `radius=6` · 牌身瓷面光泽
- **设计要点**：
  - 与 `forbidden`（皇家器物）完全错位 → 麻将是市井牌桌叙事
  - `🀄` 红中已让给 `forbidden` 独占，本皮肤改用 `🀅` 發牌取代
  - 8 牌覆盖三家数牌（万/筒/索）「一」代表 + 风牌全集，最具辨识度
  - 牌身象牙色对所有 8 色 blockColor 维持 WCAG ≥ 4.5
- **HD 模式 emoji 换装**：**全量 34 个皮肤**都注入 **5 件** hdIcons（= 默认锚点数 5），每个皮肤主题强相关 emoji，**全局 170 件唯一**且不与任何皮肤的基础 icons 重叠。

  hdIcons 数量**统一为 5 件**，使盘面 5 个水印 emoji**两两不同**。

  mahjong 的 hdIcons 是 **`['🎲', '🀐', '🀙', '🀇', '🀄']`**：
  - `🎲` 骰子 — 摇骰开局的灵魂道具
  - `🀐` 一索 — 幺鸡 / 港粤"打雀"的雀
  - `🀙` 一筒 — 筒子门「一」头牌代表
  - `🀇` 一万 — 万子门「一」头牌代表
  - `🀄` 红中 — 麻将精神图腾，配齐"骰⇒索⇒筒⇒万⇒字"完整国粹叙事

  **亮度 / scale / 运动模式与所有皮肤完全一致**：仅替换 emoji，继承基础 opacity 0.10、走默认 5 锚点 + 默认 scale + 同一 segment 时长，与所有皮肤共享同一漂浮节奏（Catmull-Rom spline 滑动窗口 + 换皮不换轨契约）。

  配置见 `web/src/skins.js → mahjong.boardWatermark.{ icons, opacity, hdIcons }`。

  **「换皮不换轨」契约**：`drift.key` 公式去掉 `skin.id` —— 所有同 5 锚点皮肤（mahjong / sakura / aurora / pixel8 等）共享**同一漂浮时间线**，切换皮肤时 icon 继续从当前位置漂浮、不重置回锚点，仅 emoji 字符替换。这从代码层面保证了"麻将水印的运动轨迹 ≡ 其他皮肤水印的运动轨迹"。

#### `boardgame` ♠️ 扑克博弈

- 扑克博弈赌场场景：4 花色 + 大王 + 花札 + 老虎机 + 骰子 = 8 件套
- 与 `mahjong`（中式国粹纯麻将）形成姊妹皮肤
- **icon**：`♠️ ♥️ ♦️ ♣️ 🃏 🎴 🎰 🎲`
  - **扑克核心 5 件**（emoji 字形）
    - ♠️ 黑桃 · ♥️ 红心 · ♦️ 方片 · ♣️ 梅花（4 花色实心）
    - 🃏 大王（彩色小丑卡，百搭）
  - **博弈场景 3 件**（emoji 字形，扩展到"扑克博弈"赌场场景）
    - 🎴 花札（红色和风牌，与扑克同属"牌"类，日式茶会牌局）
    - 🎰 老虎机（多色赌场标志，扑克博弈的赌场环境）
    - 🎲 骰子（白底立体黑点，赌博博弈的核心元素）
- **配色**（沿用赌场金/翡翠/天蓝/冷银/酒红 + 重制后 3 项以匹配新 emoji）：
  - `#D49830` 鎏金（♠️ 黑实心↔金底，最经典 poker 反差）
  - `#1F8060` 翡翠绿（♥️ 红实心↔绿，红绿互补）
  - `#2860B0` 深天蓝（♦️ 红钻石↔蓝，红蓝互补）
  - `#98A8B8` 冷银（♣️ 黑三叶↔银，高对比金属感）
  - `#5C2030` 酒红（🃏 彩色小丑↔深酒红宫廷）
  - `#3D6048` 松针绿（🎴 和风红牌↔松枝绿底，日式茶会牌局意境）
  - `#4F3088` 暗紫（🎰 多色赌场↔紫色霓虹夜场）
  - `#3E3E50` 玄墨（🎲 白点骰↔近黑底，最大明度反差让骰点跳出）
- 盘面：`gridOuter:#1A0810` / `gridCell:#142818` / `cssBg:#0E0410`（红丝绒边 + 绿呢 + 酒红底）
- 风格：`cartoon` · `radius=7` · 卡牌瓷面光泽
- **设计要点**：
  - **emoji 标准的现实约束**：真正具有"饱满彩色 emoji 字形"的扑克元素只有 5 个 — `♠️ ♥️ ♦️ ♣️ 🃏`（4 花色 + 大王），其余扑克牌字符（小王 🃟 / 牌背 🂠 / A K Q J 字符牌 🂡-🃞）都是 Unicode 文本字符，cell 缩放后会渲染为"白底小卡 + 内部纤细花色字母"，与 emoji 在风格 / 饱满度 / 辨识度上无法对齐
  - **v10.17.10 取舍**：用户要求"参考前 5 个 icon 换用其他扑克牌 icon，优先彩色、辨识度高"，因此放宽到「**扑克博弈赌场场景**」语境（与主题名"扑克博弈"完全贯通），8 个 icon 全部为彩色饱满 emoji，风格统一
  - **博弈场景 3 件的语义贯通**：🎴 花札（牌）→ 🎰 老虎机（赌场）→ 🎲 骰子（赌博）—— 三件器物分别对应"另一种牌 / 赌场环境 / 赌博工具"，与前 5 张扑克牌共同呈现完整的扑克博弈赌场全景
  - 与 `mahjong`（纯绿呢牌桌）背景叙事完全错位：本款用「红丝绒边 + 绿呢台 + 酒红氛围」复合背景，体现赌场而非传统茶馆
  - `accent-color` 取鎏金 `#D49830`，呼应赌场金筹码

### 4.12 生活扩展（7 款，v10 新增 6 款 + v10.17.4 新增 outdoor）

#### `sports` ⚽ 运动竞技

- 八大球类全家福 + 草绿球场底
- **icon**：`⚽ 🏀 ⚾ 🎾 🏐 🏈 🥎 🏆`
- 配色：`#4F9050` `#2858B0` `#C04848` `#905028` `#2090C8` `#587830` `#6038A0` `#C82838`
- 风格：`glossy` · `radius=8` · `cssBg:#06100A`
- **设计要点**：每球落在与其品牌色互补的背景（橙篮球↔深蓝、黄网球↔赤土、白排球↔泳池蓝）

#### `outdoor` 🥾 户外运动

- 山野 / 水域 / 雪道全谱系户外活动 + 黎明前山谷深蓝底
- **icon**：`🥾 ⛺ 🧗 🚴 🏄 🏂 🛶 🎣`
- 配色：`#3878B8` `#3E7848` `#7E6048` `#E0B040` `#E08858` `#4FA8C8` `#2A8888` `#7068A8`
- 风格：`cartoon` · `radius=7` · `gridOuter:#0A1420` / `gridCell:#101C2C` / `cssBg:#06101C`
- **设计要点**：
  - 8 件套涵盖「山地（🥾🧗）+ 林地（⛺）+ 公路（🚴）+ 水域（🏄🛶🎣）+ 雪道（🏂）」全场景
  - 与 `sports`（球类竞技 / 室内场馆）/ `forest`（静态林木）/ `vehicles`（机动交通）完全错位 —— 主打「人类亲身参与的户外动态运动」
  - 配色取自然元素互补：天空蓝 / 草绿 / 岩棕 / 警示黄 / 落日珊瑚 / 冰川青 / 湖青 / 晨曦紫
  - 背景叙事：远山深蓝灰（gridOuter）→ 山谷晨雾蓝（gridCell）→ 黎明前深蓝（cssBg），三层递进烘托清晨户外活动出发氛围
  - `accent-color` 取冰川青蓝 `#4FA8C8`，贯穿冲浪 / 滑雪 / 天空叙事
  - **专属符号**：🥾⛺🧗🚴🏄🏂🛶🎣 全部新增（覆盖率检验：8 个 emoji 在原 26 款带 icon 皮肤中均未出现）

#### `vehicles` 🏎️ 极速引擎

- 八大现代载具（避开 `industrial` 的 🚂 蒸汽火车）
- **icon**：`🏎️ ✈️ 🚀 🚁 🚢 🛵 🚗 🚌`
- 配色：`#8090A0` `#2860C8` `#E84020` `#3E7E40` `#1E70A8` `#E8C828` `#5080A8` `#6840B0`
- 风格：`cartoon` · `radius=5` · 机库深灰底

#### `forest` 🌳 荒野秘境

- 树木 / 落叶 / 麦穗 / 鸟巢 + 融合猛兽元素（狼 / 鹰 / 熊），v10.33 合并原 `beast` 皮肤精华
- **icon**：`🌳 🌲 🐺 🍁 🦅 🌾 🐻 🪺`
- 配色：`#8B5828` `#D87838` `#6878A0` `#4F8048` `#D4A028` `#B0386D` `#7C5028` `#5090C8`
- 风格：`glossy` · `radius=7` · 苔藓深绿底
- **专属符号**：🐺🦅🐻 来自原 `beast`，🪺 独占（避开 fairy 的 🍃、food 的 🥑）

#### `pirate` ⚓ 海盗航行

- 罗盘 / 宝藏 / 鹦鹉 / 海图（大航海八件套）
- **icon**：`⚓ 🏴‍☠️ 🪝 🦜 ⛵ 🗺️ 🧭 💎`
- 配色：`#B02020` `#D8C4A0` `#2A6890` `#6E4828` `#14406F` `#2E6F45` `#8C2858` `#C8923C`
- 风格：`glass` · `radius=6` · 深海舷板底
- **专属符号**：⚓🏴‍☠️🪝🦜⛵🗺️🧭💎 全部新增

#### `farm` 🐄 田园农场（浅色）

- 家畜 + 蔬果，**骨白带绿底 + 哑光草边**（浅色饱和度上限收紧到 ≤ 25%）
- **icon**：`🐄 🐖 🐑 🐔 🐣 🌽 🥕 🍎`
- 配色：`#B02838` `#1A488F` `#2A6028` `#1A6E9F` `#8E2070` `#8C5028` `#5C2818` `#4830B0`
- 风格：`cartoon` · `radius=9` · `gridOuter:#7A8868` / `gridCell:#EFF0EA` / `cssBg:#E6E7DC`（骨白带绿底）
- **设计要点**：
  - 骨白带绿底 + 深饱和方块（WCAG vs gridCell **4.85** ≥ 4.5）
  - 🐑 深苔绿（不与浅绿底同色族）；🥕 深棕（避免「绿底+深绿萝卜」糊作一团）
  - 与 `pets` 浅卡其家宠 / `food` 暗烹饪 / `toon` 紫底动物园完全错位


#### `desert` 🐫 沙漠绿洲

- 骆驼 / 仙人掌 / 古寺 / 赤陶罐，**浅米中性底 + 深饱和宝石色块**
- **icon**：`🐫 🦂 🌵 🏜️ 🪨 🏺 🛕 🌅`
- 配色：`#1A4070` `#B02030` `#6F1858` `#1A6048` `#4830B0` `#185878` `#5C0F38` `#6F2890`
- 风格：`glossy` · `radius=7` · `gridOuter:#786E50` / `gridCell:#E8E2D6` / `cssBg:#DAD2C4`（浅米中性底）
- **设计要点**：
  - 8 色 blockColor 覆盖蓝/红/紫/绿四象限的深饱和色，保证浅米底上 WCAG vs gridCell **5.26** ≥ 4.5
  - `uiDark: false`，配套提供完整 `cssVars`（深字 + 沙铜 accent）
- **专属符号**：🐫🦂🌵🏜️🪨🏺🛕🌅 全部新增

### 4.13 东方美学（1 款，v10.33 新增）

#### `zen` 🍵 禅意山水

- 水墨东方美学，古刹 / 竹林 / 白鸽 / 灯盏 / 冥想
- **icon**：`🏯 🎍 🕊️ 🪔 🧘 🎑 🪘 🫖`
- 风格：`flat` · `uiDark: false`
- **专属符号**：🏯🎍🕊️🪔🧘🪘🫖 全部新增

### 4.14 治愈休闲（2 款，v10.33 新增）

#### `cafe` ☕ 午后咖啡

- 暖棕书吧治愈系，咖啡 / 书籍 / 烛光 / 绿植
- **icon**：`☕ 📖 🧋 🪴 🕯️ 🥐 🎵 📝`
- 风格：`cartoon` · `uiDark: false`
- **专属符号**：☕📖🧋🕯️🥐📝 全部新增

#### `garden` 🌼 花园时光

- 园艺花草（长辈友好），花卉 / 蜗牛 / 毛毛虫 / 水桶
- **icon**：`🌼 🏵️ 🪻 🐌 🐛 🪣 🌸 🍀`
- 风格：`cartoon` · `uiDark: false`
- **专属符号**：🌼🐌🐛🪣🍀 全部新增

### 4.15 创意教育（1 款，v10.33 新增）

#### `doodle` ✏️ 涂鸦课堂

- 彩笔画板（儿童友好），铅笔 / 三角尺 / 直尺 / 画笔
- **icon**：`✏️ 📐 📏 🎨 🖍️ 📚 🔬 🎓`
- 风格：`cartoon` · `uiDark: false`
- **专属符号**：✏️📐📏🖍️🔬🎓 全部新增

### 4.16 科幻未来（1 款，v10.33 新增）

#### `cyberpunk` 🤖 赛博朋克

- 电路板 AI 矩阵，机器人 / 电脑 / 插头 / 卫星
- **icon**：`🤖 💻 🔌 📡 🧬 📊 🔋 💾`
- 风格：`neon` · `uiDark: true`
- **专属符号**：🤖💻🔌📡🧬📊🔋💾 全部新增

### 4.17 北欧极简（1 款，v10.33 新增，纯配色）

#### `nordic` 🏔️ 北欧极简（纯配色）

- 斯堪的纳维亚极简纯配色，无 blockIcons
- 风格：`flat` · `uiDark: false`

### 4.18 节日庆典（1 款，v10.33 新增）

#### `fiesta` 🎉 欢庆嘉年

- 派对节日庆典，彩带 / 气球 / 皮纳塔 / 礼物
- **icon**：`🎉 🎊 🎈 🪅 🥳 🎁 🧨 🎪`
- 风格：`cartoon` · `uiDark: true`
- **专属符号**：🎉🎊🎈🪅🥳🎁🧨🎪 全部新增

### 4.19 星座占卜（1 款，v10.33 新增，纯配色）

#### `zodiac` ♈ 星座物语（纯配色）

- 星座深色纯配色，无 blockIcons
- 风格：`glass` · `uiDark: true`

---

## 五、icon 全局唯一性矩阵

### 5.1 35 款带 icon 皮肤完整 emoji 列表（共 280 个）

| 皮肤 | 8 个 icon |
|---|---|
| `aurora` | 🦌 🐧 🐋 ❄️ 🌌 🐻‍❄️ 🦭 🏔️ |
| `neonCity` | 🌆 🚥 🚇 🎆 🏨 🚖 🌉 🛤️ |
| `ocean` | 🐙 🦞 🐡 🐬 🐚 🐳 🦈 🐢 |
| `koi` | 🎋 🌊 🪷 ⛩️ 🐟 🏮 🎐 🎏 |
| `candy` | 🍪 🎀 🍫 🍰 🍩 🍬 🍭 🧁 |
| `toon` | 🐼 🐨 🐘 🦒 🦛 🦔 🦘 🦄 |
| `pixel8` | 💣 🪙 🥊 🎮 👊 🍄 🕹️ 👾 |
| `dawn` | 🐝 🌱 🍯 🦗 🐞 🌿 🪹 🐓 |
| `food` | 🥑 🍣 🍞 🍕 🌮 🍔 🥩 🍜 |
| `music` | 🎤 🎹 🎧 🎺 🥁 🎸 🎷 🎻 |
| `pets` | 🐰 🐠 🐦 🐱 🦎 🐹 🐭 🐶 |
| `universe` | 🛸 🌍 🔭 🌙 ⭐ 🪐 ☄️ 🌠 |
| `fantasy` | 🧙 🧝 🧞 💫 🗝️ 📿 🪬 🪩 |
| `greece` | 🔱 ☀️ 🍷 🦚 ⚡ 🏹 💘 🦉 |
| `demon` | 👁️ ⚔️ 💀 🕷️ 🦇 👹 ☠️ 😈 |
| `jurassic` | 🥚 🌋 🦕 🦴 🐉 🦖 🐊 🐍 |
| `fairy` | 🌻 🦋 🌹 🍃 🪄 🌷 🌈 🧚 |
| `industrial` | ⚙️ 🔧 🔩 🛠️ ⛓️ 🚂 🏭 ⚒️ |
| `forbidden` | 🐲 👑 🪭 🧧 🥮 🀄 📜 🍵 |
| `mahjong` | 🀀 🀁 🀂 🀃 🀅 🀇 🀙 🀐 |
| `boardgame` | ♠️ ♥️ ♦️ ♣️ 🃏 🎴 🎰 🎲 |
| `sports` | ⚽ 🏀 ⚾ 🎾 🏐 🏈 🥎 🏆 |
| `outdoor` | 🥾 ⛺ 🧗 🚴 🏄 🏂 🛶 🎣 |
| `vehicles` | 🏎️ ✈️ 🚀 🚁 🚢 🛵 🚗 🚌 |
| `forest` | 🌳 🌲 🐺 🍁 🦅 🌾 🐻 🪺 |
| `pirate` | ⚓ 🏴‍☠️ 🪝 🦜 ⛵ 🗺️ 🧭 💎 |
| `farm` | 🐄 🐖 🐑 🐔 🐣 🌽 🥕 🍎 |
| `desert` | 🐫 🦂 🌵 🏜️ 🪨 🏺 🛕 🌅 |
| `zen` | 🏯 🎍 🕊️ 🪔 🧘 🎑 🪘 🫖 |
| `cafe` | ☕ 📖 🧋 🪴 🕯️ 🥐 🎵 📝 |
| `garden` | 🌼 🏵️ 🪻 🐌 🐛 🪣 🌸 🍀 |
| `doodle` | ✏️ 📐 📏 🎨 🖍️ 📚 🔬 🎓 |
| `cyberpunk` | 🤖 💻 🔌 📡 🧬 📊 🔋 💾 |
| `fiesta` | 🎉 🎊 🎈 🪅 🥳 🎁 🧨 🎪 |

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
# 期望输出：总皮肤: 42 带 icon: 35 icon 总数: 280 重复: 0
```

### 5.3 emoji 主题域覆盖图谱

| 主题域 | 已用皮肤 | 备注 |
|---|---|---|
| 极地动物 | aurora | 🐻‍❄️🦭🦌🐧 独占 |
| 深海生物 | ocean | 🐙🦞🐡🐬🐚🐳🦈🐢（融合原 bubbly 的 🐬🐢） |
| 家庭萌宠 | pets | 🐰🐱🐶🐹🐭 浅底独占 |
| 动物园明星 | toon | 🐼🐨🐘🦒🦛🦔🦘🦄 |
| 荒野秘境 | forest | 🌳🌲🐺🍁🦅🌾🐻🪺（融合原 beast 的 🐺🦅🐻） |
| 史前爬行 | jurassic | 🦕🦖🐊🐍🐉🌋🥚🦴 |
| 农场家畜 | farm | 🐄🐖🐑🐔🐣 |
| 沙漠生物 | desert | 🐫🦂 |
| 花卉精灵 | fairy | 🌻🌹🌷🍃🦋 |
| 蔬果食材 | food + farm | 🥑🍕🍣🍔 vs 🌽🥕🍎 错位 |
| 甜点糖果 | candy | 🍪🎀🍫🍰🍩🍬🍭🧁 |
| 乐器 | music | 🎤🎹🎧🎺🥁🎸🎷🎻 |
| 街机/8-bit | pixel8 | 💣🪙🥊🎮🕹️👾 |
| 球类运动 | sports | ⚽🏀⚾🎾🏐🏈🥎🏆 |
| 户外运动 | outdoor | 🥾⛺🧗🚴🏄🏂🛶🎣（山地/林地/公路/水域/雪道全谱系）|
| 现代交通 | vehicles | 🏎️✈️🚀🚁🚢🛵🚗🚌 |
| 工业机械 | industrial | ⚙️🔧🔩🛠️⛓️🚂🏭⚒️ |
| 大航海 | pirate | ⚓🏴‍☠️🪝🦜⛵🗺️🧭💎 |
| 紫禁城 | forbidden | 🐲👑🪭🧧🥮🀄📜🍵 |
| 中式麻将 | mahjong | 🀀🀁🀂🀃🀅🀇🀙🀐 （🀄 让给 forbidden） |
| 扑克博弈 | boardgame | ♠️♥️♦️♣️🃏🎴🎰🎲（赌场全场景） |
| 日本意象 | koi | 🎋🌊🪷⛩️🏮🎐🎏 |
| 希腊神话 | greece | 🔱⚡🏹🦚🦉💘🍷☀️ |
| 冥府恶魔 | demon | 👁️⚔️💀🕷️🦇👹☠️😈 |
| 天体宇宙 | universe | 🛸🌍🔭🌙⭐🪐☄️🌠 |
| 都市夜景 | neonCity | 🌆🚥🚇🎆🏨🚖🌉🛤️ |
| 清晨田野 | dawn | 🐝🌱🍯🦗🐞🌿🪹🐓 |
| 魔法奇幻 | fantasy | 🧙🧝🧞💫🗝️📿🪬🪩 |
| 水墨东方 | zen | 🏯🎍🕊️🪔🧘🎑🪘🫖（v10.33 新增） |
| 咖啡书吧 | cafe | ☕📖🧋🪴🕯️🥐🎵📝（v10.33 新增） |
| 花园园艺 | garden | 🌼🏵️🪻🐌🐛🪣🌸🍀（v10.33 新增） |
| 涂鸦文具 | doodle | ✏️📐📏🎨🖍️📚🔬🎓（v10.33 新增） |
| 赛博科技 | cyberpunk | 🤖💻🔌📡🧬📊🔋💾（v10.33 新增） |
| 派对庆典 | fiesta | 🎉🎊🎈🪅🥳🎁🧨🎪（v10.33 新增） |

**未来可扩展空白象限**（保留池）：

- **童话奇幻人物** 🧙🧛🧜🧝🧞🧟🦹🦸（适合 mythic / wizard 主题）
- **军事兵器** 🗡️🛡️🔫💥🛰️（适合 warfare 主题）
- **赛车竞速符号** 🏁🚥🏆🎽（部分已被 sports/vehicles 占用）
- **季节天气** 🌞🌧️🌨️⛅🌪️🌦️（部分受 universe/aurora 限制）

---

## 六、同步与变更管理

### 6.1 Web ↔ 小程序同步

`web/src/skins.js` 是 **唯一事实源**。`scripts/sync-miniprogram-skins.cjs` 脚本以 sandbox VM 加载 ESM 源、抽取 `SKINS` 对象、JSON 序列化后写入 `miniprogram/core/skins.js`。

```bash
node scripts/sync-miniprogram-skins.cjs
# 输出：Synced 42 skins to miniprogram/core/skins.js
```

> **注意**：小程序 skins.js 是 CommonJS（`require`/`module.exports`），ESLint 会因 ESM-only 配置报 `no-undef`。这是预期行为，不算错误。

### 6.2 自动化校验流水线

每次新增 / 修改皮肤后必须执行：

```bash
# 1. icon 唯一性
node -e "..."  # 见 §五.2

# 2. ESLint
npx eslint web/src/skins.js

# 3. 单元测试（皮肤渲染、配色、序列化）
npx vitest run

# 4. miniprogram 同步
node scripts/sync-miniprogram-skins.cjs
```

---

## 七、新增皮肤实操指南

### 7.1 新增皮肤的 6 步标准流程

1. **占位明确主题域**：在 §五.3 找到尚未覆盖的 emoji 主题域，避免与现有 24 款重叠
2. **抽 8 个 emoji**：保证每个 emoji 视觉特征清晰（不要选过于细小或与现有皮肤近似的 emoji）
3. **设计 8 色配色**：每个 emoji 的主色 → 计算其互补 / 反差色作为 blockColor
4. **选择 blockStyle**：根据主题质感选 glossy / metal / glass / neon / cartoon / jelly 之一
5. **设计盘面深浅**：决定 uiDark = true / false，配套设计 gridOuter / gridCell / cssBg / cssVars
6. **同步 + 校验**：跑 §六.2 全套流水线

### 7.2 模板代码（复制即用）

```js
yourSkinId: {
    id: 'yourSkinId',
    name: '🎨 主题名称',
    boardWatermark: { icons: ['🎨', '🖼️'], opacity: 0.08 },
    // 设计说明：
    //   - 主题域：xxx（避开 §五.3 已覆盖域）
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

## 八、关联文件索引

| 文件 | 作用 |
|---|---|
| `web/src/skins.js` | 全部 42 款定义（唯一事实源） |
| `miniprogram/core/skins.js` | 自动同步产物（不要手改） |
| `scripts/sync-miniprogram-skins.cjs` | Web → 小程序同步脚本 |
| `web/src/themes/` | blockStyle 渲染管线（glossy/metal/...） |
| `web/public/styles/main.css` | CSS 变量系统、皮肤热切换样式 |
| `web/src/skinSelector.js` | 皮肤切换 UI |
| `tests/skins.test.js`（如有） | 单元测试 |
| [`WECHAT_MINIPROGRAM.md`](../platform/WECHAT_MINIPROGRAM.md) | 小程序皮肤同步策略 |

---

## 九、FAQ

**Q1：能否禁用某款皮肤？**
A：从 `SKINS` 对象删除即可，但若 `localStorage.openblock_skin` 仍指向被删 ID，会自动回退到 `DEFAULT_SKIN_ID = 'titanium'`。

**Q2：blockIcons 可以少于 8 个吗？**
A：可以为 0（纯配色皮肤如 `classic` / `titanium` / `sunset` / `sakura` / `apple` / `nordic` / `zodiac`），但若提供则必须正好 8 个，与 `blockColors` 一一对应。

**Q3：皮肤切换时为什么有些 CSS 变量会被清掉？**
A：见 `applySkinToDocument()` —— 浅色皮肤切换时会先 `removeProperty(THEME_VAR_KEYS)`，再设置新值；深色皮肤会以 `UI_DARK_BASE` 为基准合并 `cssVars`。这保证浅 → 暗 / 暗 → 浅 切换不残留旧值。

**Q4：emoji 在不同字体下渲染不一致怎么办？**
A：移动端、Mac、Win 各家厂商 emoji 字形差异确实存在。设计时用 **emoji 主色调**（不是某厂商的特定渲染）作为反差判据，例如 🍕 都被各家画成红+黄+绿三色，那就以「暖色为主」为依据。皮肤上线前应在 iOS / Android / Win / Mac 全平台抽测。

**Q5：可以只在小程序里启用某款皮肤、Web 不启用吗？**
A：不行。`scripts/sync-miniprogram-skins.cjs` 是单向同步，小程序皮肤完全镜像 Web。如需平台差异化可在 sync 脚本中加白名单过滤。

---

## 十、方块 emoji 全量池：利用情况与表意匹配

> 代码事实源：`web/src/skins.js`  
> 硬约束：**35 款带 `blockIcons` × 8 = 280 枚 emoji，跨皮肤全局互斥**。

### 9.1 全量利用情况

| 指标 | 值 |
|------|-----|
| 带 icon 皮肤数 | 35 |
| 方块 emoji 总数 | **280**（35 × 8，利用率 100%，无闲置槽位） |
| 纯配色皮肤 | 7（classic / titanium / sunset / sakura / apple / nordic / zodiac） |

每一枚 emoji **恰好出现一次**，因此所谓「全局重新匹配」在工程上等价于：**在 280 枚之间做重 partition**，不能凭空「多加一枚」而不替换掉另一枚。

### 9.2 主题 ↔ icon 表意：评价维度

| 维度 | 含义 |
|------|------|
| **直示性** | 玩家不看注释能否联想到皮肤名 |
| **叙事自洽** | 8 格是否同一画面（同一活动 / 同一地理 / 同一文化符号系统） |
| **独占合法性** | 麻将牌面 / 扑克花色等 **必须与玩法符号同源**，不可为了「更好看」换成通用 emoji |

据此：
- **麻将 `mahjong`、扑克 `boardgame`**：直示性封顶；**禁止**与别的皮肤互换牌字符。
- **球类 `sports`、乐器 `music`、料理 `food`/甜点 `candy`**：已与品类强绑定，**优先不动**。
- **弱表意高风险区**：水族乐园类、跨地理交通工具、抽象主题下线后的科技感由 `neonCity` 霓虹承接。

### 9.3 已落地的语义加固

在 **不破坏 280 互斥** 前提下，对表意偏离最大的两处做了替换：

- **`vehicles`（极速引擎）**：🚥 红绿灯 → 🚗 轿车（路面机动车，直示性更好）；`blockColors` 第 7 色改为通勤蓝灰系。
- **`bubbly`（元气泡泡）**：🦩 火烈鸟 → 🦦 水獭，🌿 草本 → 🏖️ 沙滩（强化浅海度假叙事）。

### 9.4 保冻结皮肤

以下皮肤 **8 格与主题已高度同构**，全局重排收益极低：`ocean`、`forest`、`farm`、`desert`、`pirate`、`industrial`、`demon`、`fairy`、`pets`、`toon`、`jurassic`、`universe`、`aurora`、`koi`、`greece`、`mahjong`、`boardgame`、`sports`、`music`、`food`、`candy`、`pixel8`、`forbidden`、`zen`、`cafe`、`garden`、`doodle`、`cyberpunk`、`fiesta` 等。

### 9.5 校验命令

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
# 期望：dup=0；icon 总数 280
```

---

> 文档维护人：算法 / UI / 皮肤组
> 更新建议：每次新增 / 修改 / 删除皮肤后，**同步更新本文档 §一总览、§四详解、§五.1 矩阵、§七**。
