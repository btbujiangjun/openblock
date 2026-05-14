# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — `ALGORITHM_ARCHITECTURE_DIAGRAMS.md` 9 张图全部渲染失败 / 法棍布局

**用户反馈**：浏览器在文档门户中渲染算法架构图时多张报错
`render timeout after 15000ms (检查 Console: ELK 是否加载成功)`，且即使
渲染成功的图也呈现"竖直法棍"形态（宽 < 高，需要纵向滚动数屏才能看完）。

**根因诊断**（本地 `mmdc` 复现 + viewBox 测量）：

1. **algo-01（视图 B）强制 `layout: elk`**：浏览器从 jsdelivr/esm.sh 加载
   `@mermaid-js/layout-elk` 时 CDN 抖动叠加 ELK 自身算法耗时，触发 15s
   超时。本地 mmdc 也要 16-20s。
2. **algo-02 用 `switch` 作节点 ID + classDef 同名**：`switch` 是 JS 保留字，
   mermaid 11 lexer 在分支语法歧义时进入潜在死循环（本地 mmdc 也卡到被
   90s perl harness kill）。
3. **algo-03 用 `IN` 作 subgraph ID + 节点标签含括号 `()`/竖线 `|`**：
   类似根因，`|` 在 mermaid 边标签里有特殊语义，与 `[]` 节点混用引发
   解析歧义，浏览器静默卡死直到 15s 超时。
4. **9 张图统一是 `flowchart TB` + 嵌套 `subgraph direction LR/TB`**：
   mermaid 11 dagre 对嵌套 direction 的支持不可靠，结果是数据流向纵向、
   每个 subgraph 自身又是 TB → 整体宽高比 0.18-0.53（视图 B 0.28、
   图 4 0.18、图 7 0.53）。

**测量数据（修复前 9 张本地 mmdc viewBox）**：

| 图 | 类型 | viewBox | 宽高比 |
|---|---|---|---|
| algo-01 视图 B | flowchart TB + ELK | 559 × 2026 | 0.28 法棍 |
| algo-02 出块双轨 | flowchart TB | 90s 超时 | — |
| algo-03 SpawnV3 | flowchart TB | 90s 超时 | — |
| algo-04 RL 训练 | flowchart TB | 811 × 2221 | 0.37 法棍 |
| algo-05 玩家画像 | flowchart TB | 404 × 2208 | 0.18 极纵 |
| algo-06 商业化决策 | flowchart TB | 1286 × 1546 | 0.83 |
| algo-07 ML scaffold | flowchart TB | 2550 × 1111 | 2.30 |
| algo-08 决策管线 | flowchart TB | 1030 × 1948 | 0.53 法棍 |
| algo-09 生命周期 | flowchart TB | 1558 × 1127 | 1.38 |

**修复策略**（按 `SYSTEM_ARCHITECTURE_DIAGRAMS.md` 视图 B 的成功模板分类）：

| 类型 | 适用图 | 渲染方案 |
|---|---|---|
| 结构图（无复杂内部流向） | algo-01 / 03 / 05 / 09 | mermaid 11 `block-beta` 网格（不依赖 ELK CDN，箭头流向用文字补述） |
| 流水线 / 决策图（有真流向） | algo-02 / 04 / 06 / 07 / 08 | `flowchart LR`（横向主轴），subgraph 内 `direction TB`，避免嵌套 direction 歧义；节点 ID 重命名（去掉 `switch` / `IN` 等关键字与括号嵌套标签） |

**测量数据（修复后 9 张本地 mmdc viewBox）**：

| 图 | 渲染方案 | viewBox | 宽高比 |
|---|---|---|---|
| algo-01 视图 B | block-beta | 1057 × 347 | **3.05** ✓ |
| algo-02 出块双轨 | flowchart LR | 2079 × 482 | 4.31 |
| algo-03 SpawnV3 | block-beta | 1026 × 347 | **2.96** ✓ |
| algo-04 RL 训练 | flowchart LR | 2893 × 484 | 5.97 |
| algo-05 玩家画像 | block-beta | 1093 × 274 | **3.99** ✓ |
| algo-06 商业化决策 | flowchart LR | 2519 × 472 | 5.34 |
| algo-07 ML scaffold | flowchart LR | 3194 × 806 | **3.96** ✓ |
| algo-08 决策管线 | flowchart LR | 2129 × 792 | **2.69** ✓ |
| algo-09 生命周期 | block-beta | 1013 × 397 | **2.55** ✓ |

9/9 全部从"法棍纵向（0.18-0.99）"翻转到"横向紧凑（2.55-5.97）"，
浏览器中容器宽 1200px → 图高 200-470px，一屏可见无需滚动；点击放大
（lightbox）可在原始 viewBox 下逐节点查看细节。

**lessons learned（与 SYSTEM 文档已记录的经验一致）**：

1. **mermaid 节点 / subgraph ID 严禁使用 JS / SQL 保留字**（`switch`、`IN`、
   `case`、`for`、`from`、`select` 等），否则 lexer 静默卡死无错误信息。
2. **节点标签里避免裸括号 `(...)` 和竖线 `|`**：即使在 `["..."]` 引号包裹
   下也可能引发解析歧义（mermaid lexer 多次回退）；用 `<br/>` 折行或换
   ASCII 友好符号（`·` / `_` / `→`）。
3. **嵌套 `subgraph direction LR/TB` 不可靠**：mermaid 11 dagre 经常忽略
   inner direction，结果总是被外层方向覆盖。可靠做法：
   - 结构图（无内部箭头）→ `block-beta` 网格（精确控制 columns）
   - 流水线图（有箭头）→ 主图 `flowchart LR`，subgraph 内不嵌套 direction
4. **强制 `layout: elk` 是浏览器超时的高危项**：ELK CDN 加载（esm.sh /
   jsdelivr）+ ELK 算法本身都不快，`docs.html` 已设 15s 硬超时。
   能用 `block-beta` 替代时优先 `block-beta`。
5. **block-beta 不支持箭头但可补救**：流向 / 反馈环写在图下方"流向 /
   反馈环"小节文字补述；垂直堆叠的层本身已隐含主流向。

### Changed — 文档资产参考图统一切换到 PNG（无损）

将文档中三张设计参考图（业务架构 / 系统全栈分层 / 算法架构）的引用
从 `.jpg` 全部改为已存在的 `.png` 版本，规避 JPEG 压缩在文字密集
架构图上的细节损失（边框毛刺、小字模糊）。文件本身未新增，仅替换
markdown 引用路径。

**替换 6 处引用（均指向已落盘的 PNG）：**

| 文档 | 资产引用 |
|---|---|
| `README.md` | `docs/architecture/assets/business-architecture.png` |
| `docs/README.md` | `./architecture/assets/business-architecture.png` |
| `docs/architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md` | `./assets/business-architecture.png` |
| `docs/architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md` | `./assets/architecture-overview.png` |
| `docs/algorithms/README.md` | `./assets/algorithm-architecture.png` |
| `docs/algorithms/ALGORITHM_ARCHITECTURE_DIAGRAMS.md` | `./assets/algorithm-architecture.png` |

**回归验证：**

- `file -b` 三个 PNG 均为真实 `PNG image data`，扩展名/MIME 一致。
- `curl -I` 三条 URL 均返回 `200 image/png`，Content-Length 与磁盘文件
  字节数 1:1 对齐（1.57 MB / 1.65 MB / 1.35 MB），未触发 `_resolveDocPath`
  路径 bug 或缓存陈旧响应。
- `rg "!\[[^\]]*\]\([^)]+\.(jpg|jpeg)\)"` 在 `docs/` + `README.md` 已无残留。

**已删除冗余 .jpg 文件：** `business-architecture.jpg` / `architecture-overview.jpg`
/ `algorithm-architecture.jpg` 已从 `assets/` 目录移除（共回收 ~503 KB
磁盘空间）。无任何文档/代码/HTML/JS 仍引用这些 jpg 路径；同步更新
`server.py` 注释与 `ALGORITHM_ARCHITECTURE_DIAGRAMS.md` 元信息描述
中的扩展名示例。注：本 CHANGELOG 早期条目（"新增 ... .jpg"、"重命名
PNG → JPG 修 MIME"等）属历史事实记录，刻意保留未改写。

### Changed — 图 2 / 3 / 4 / 5 / 6 全部对齐"视图 B + 图 1"的 4:3 横向紧凑风格

完成 `SYSTEM_ARCHITECTURE_DIAGRAMS.md` 全部 6 张主图的紧凑化重构，配合
此前已优化的视图 B + 图 1，整文档共 **11 张 mermaid 图**，**10/11 进入
4:3 横向紧凑区间（宽高比 1.3-2.5）**，唯一例外 6.2 是流水线本质 TB 图
（已加注释指引用户回看 6.1 的横向构成视图）。

按内容性质分两类处理：

**A. 拆为「构成（block-beta）+ 数据流（flowchart）」双视图**
（适用于"组件多、关系多"的复合图）：

| 原图 | 新视图 | 类型 | viewBox | 宽高比 |
|---|---|---|---|---|
| 图 2 L3 Domain Services | 2.1 组件构成 | block-beta | 1105 × 690 | **1.60** ✓ |
|  | 2.2 关键协作 | flowchart LR | 1190 × 506 | **2.35** ✓ |
| 图 5 后端路由 + 数据 | 5.1 路由+表+微服务 | block-beta | 1044 × 627 | **1.66** ✓ |
|  | 5.2 路由 → 表映射 | flowchart LR | 1068 × 670 | **1.59** ✓ |
| 图 6 四端同步 + 部署 | 6.1 四端 + 部署形态 | block-beta | 821 × 346 | **2.37** ✓ |
|  | 6.2 同步流水线 | flowchart TB | 688 × 870 | 0.79 ⓘ |

**B. 保留单图 flowchart，但优化布局参数 + 颜色染色**
（适用于"核心是箭头/数据流"的图）：

| 图 | 优化点 | viewBox | 宽高比 |
|---|---|---|---|
| 图 3 MonetizationBus | 三栏 LR（发布方｜总线｜订阅方）+ 事件名按家族压缩 | 1212 × 638 | **1.90** ✓ |
| 图 4 出块+RL 双轨 | TB→LR + RL/spawn 分组 + 子系统配色 | 1769 × 1226 | **1.44** ✓ |

**关键工程经验**（沉淀到 docs 内注释，供后续维护参考）：

1. **嵌套 subgraph 的 `direction LR` 不可靠**：dagre 经常无视该提示，
   把节点排成 N×M 网格而非单行；ELK 也有同样问题。如需"严格的水平
   网格布局"，**首选 mermaid 11 的 `block-beta`**（`columns N` 精确
   控制每行列数，所见即所得）。
2. **block-beta 不支持箭头**：含数据流/调用关系的图必须辅以独立的
   小型 flowchart 子图，色块编码与构成图严格对齐以便交叉对照。
3. **多 subgraph 横向排列技巧**：dagre 默认会把没有跨 subgraph 边的
   多个 subgraph 上下堆，需要在两个 subgraph 间加一条 invisible edge
   `~~~`（如 5.2 的 `tMon ~~~ nginx`）才能强制 LR。
4. **block-beta 标题与节点重叠**：`block:ID["title"]:N` 自带标题在
   mermaid 当前版本会与子节点文字重叠；改用"独立 1 列彩色标题单元
   + 6 列内容子 block"的结构（视图 B / 1.1 / 2.1 / 5.1 / 6.1 同款）。

### Changed — 图 1 "宏观分层（C4 容器视图）" 拆为 1.1/1.2 双视图，对齐视图 B 的 block-beta 4:3 风格

- **背景**：原图 1 用 `flowchart TB` + 5 个 subgraph + 大量 REST 箭头，
  在浏览器实际渲染时同样会被自动布局算法挤成接近正方形、边交叉严重，
  与刚优化好的视图 B 风格不一致。
- **方案**：拆为两张独立的紧凑视图，各自用最适合的 mermaid 语法：
  - **1.1 容器构成（block-beta）**：5 大容器组（客户端 / 前端五层 /
    后端 / RL 训练 / 微服务）按视图 B 同款"左 1 列彩色标题 + 右 6 列
    节点群"的网格布局；实测 viewBox `1037 × 511`，宽高比 **2.03**，
    比 4:3 还要更横向，一屏可视所有容器。
  - **1.2 关键数据流（flowchart LR）**：把原图里 9 条核心 REST / 文件
    依赖箭头独立画出（block-beta 不支持箭头），节点配色与 1.1 一致：
    紫色=前端层 / 绿色=后端 / 粉色=RL / 灰色=微服务，便于与 1.1 对照
    阅读；实测 viewBox `857 × 488`，宽高比 1.76。
- **保留信息**：所有原图 1 的容器和箭头都迁移到了 1.1 + 1.2，无丢失。

### Changed — 视图 B "紧凑概念图" 改用 `block-beta` 网格，强制 4:3 横向

- **现象**：原 `flowchart TB` + 嵌套 `subgraph direction LR` + `layout: elk`
  方案在浏览器实际渲染时，ELK 经常无视 `direction LR` 提示，把每层节点
  挤成 2×N 竖向网格（"法棍布局"），用户截图：客户端 4 个节点变成 2 列 4 行、
  应用编排层 6 个节点变成 2 列 3 行，整体宽高比接近 1:1，无法一屏可视。
- **根因**：mermaid 当前对 ELK 嵌套 subgraph 的 `direction` 透传不稳；
  自动布局算法的"美学优化"会无视 LR 提示把节点重新打散。试过的 dagre +
  invisible edges (`~~~`) 强制水平串联也无效（dagre 同样按自己的算法
  排版），实测 viewBox 1080×1100，仍接近 1:1。
- **方案**：换用 mermaid 11 的 **`block-beta`** 网格语法。它不走自动
  布局算法，`columns N` 精确指定每行列数，所见即所得：
  - 总 grid `columns 7`：左 1 列层标题 + 右 6 列节点群
  - 每层用独立的 `block:Lx:6 columns M` 嵌套，强制 M 个节点单行横排
  - 层标题改用独立单元格（避免 block-beta 自带标题渲染 bug 与节点
    重叠），用 `classDef titleXxx` 染深色 + 白字，作为视觉锚点
- **实测尺寸**：viewBox `953 × 727`，宽高比 1.31，**正好 4:3**；7 层 ×
  3-6 列横排，整体一屏可视，桌面/移动端皆可读。

### Fixed — 文档门户内部 .md 链接砍目录前缀，导致跳转后整页破图

**真根因**（用户在错误占位条点"运行诊断"截图后定位）：
失败 URL 为 `http://localhost:5000/docs/asset/assets/business-architecture.jpg`，
**path 缺中间的 `architecture/` 目录段**。回溯到 `web/public/docs.html` 的
`fixRenderedContent()` 第 3c 段处理内部 `.md` 链接的代码：

```js
const filename = filePart.split('/').pop(); // 只取文件名 — BUG
```

它把 `../algorithms/ALGORITHMS_RL.md` 砍成 `ALGORITHMS_RL.md`，于是只要
用户从文档 A 点链接进文档 B（B 在子目录），`_current` 就丢了目录前缀，
后续 B 文档里所有 `./assets/x.jpg` 全部拼成 `/docs/asset/assets/x.jpg`
（缺中间目录）→ 整页破图。该 bug 影响 `docs/` 下所有非根目录的文档。

**修复**：

1. **新增 `_resolveDocPath(currentDir, href)`**：基于当前文档目录正确解析
   相对路径，把 `../algorithms/X.md` resolve 为 `algorithms/X.md`，把
   `./Y.md` resolve 为 `<currentDir>/Y.md`，把根目录传 `''` 时透传裸文件名。
   实现用纯 split/stack（不引入虚假 origin），8 条单测全过：
   - `('architecture', '../algorithms/X.md')` → `'algorithms/X.md'`
   - `('architecture', './LIFECYCLE.md')` → `'architecture/LIFECYCLE.md'`
   - `('algorithms/sub', '../../architecture/foo.md')` → `'architecture/foo.md'`
   - `('architecture', '../README.md')` → `'README.md'` 等
2. **重写 3c 链接处理**：用 `_resolveDocPath` 替代 `split('/').pop()`，
   `data-file` / `openDoc()` 都拿到完整 docs 内路径。
3. **新增 `_findDocByBasename` + `openDoc` 入口兜底**：如果传入的是
   裸 filename（历史 hash / 旧书签 / 第三方链接），自动从 `_categories`
   反查完整路径，并在 console 提示 `[docs] resolved bare filename …`。
   这样即便出现新的回归，旧 hash 也不会再触发整页破图。
4. **错误占位条增强诊断**（同步落地）：失败时显示明文 URL、page origin、
   API_BASE，并提供"运行诊断"按钮，会用 fetch 测同 origin + 候选 :5000，
   把状态码 / Content-Type / 响应头 / 前 8 字节魔术头贴回页面，无需
   开发者工具即可上报根因（本次诊断输出就是用它定位到的）。

### Added — 文档图片端到端"系统化"修复套件

针对用户反馈"图片加载问题在多次后端修复后仍出现破图"的现象，做一轮端到端
治理，把"服务端正常 / 浏览器仍破图"这类排障盲区彻底消除。

- **新增** [`tools/diagram-render/audit_docs_images.py`](tools/diagram-render/audit_docs_images.py)：
  跨 docs/ 全量扫描 markdown 图片引用，逐项验证：
  1. 物理文件存在性（杜绝引用孤儿）；
  2. 扩展名 vs 真实魔术头一致（防御 `architecture-overview.png` 那类
     "扩展名 PNG，实际 JPEG" 的 MIME 不一致问题）；
  3. `/docs/asset/<path>` HTTP 路由可达（默认 `:5000`，可经
     `OPENBLOCK_API_BASE` 切换）；
  4. HTTP `Content-Type` 与扩展名预期吻合；
  非零退出码便于接入 CI / pre-commit。
  当前基线：扫描 95 个 markdown，4 个唯一图片 URL，全绿。
- **改造** `web/public/docs.html` 中 markdown `<img>` 后处理流程：
  - 加 `onerror` 自动 **cache-busting 重试**（追加 `?_t=Date.now()`），
    彻底绕开浏览器缓存的历史失败响应；
  - 重试仍失败则把 `<img>` 替换成醒目错误占位条（`.img-load-error`），
    显示 alt 文案 + "直接访问 →"链接，让用户能一键复现并截图上报，
    取代以往无信息的"破图占位符"；
  - 同步在 console 打印 `[docs] image retry with cache-bust:` /
    `[docs] image load failed:` 诊断信息。
- **修补** `vite.config.js` + `web/vite.config.js` 代理规则：
  补 `/docs/asset` → Flask 后端。先前只代理 `/docs/list` `/docs/raw`，
  导致从 vite dev server 打开门户时，markdown 内嵌图片会被 vite 的
  SPA fallback 吃掉返回 HTML，浏览器尝试把 HTML 当 image 解析 → 破图。
  此次根治后无论 Flask 单跑还是 vite + Flask 联跑，行为一致。

### Changed — `/docs/asset` 接入 ETag 协商缓存，避免历史失败响应被钉死

- 背景：上一条 fix 中，`architecture-overview.png` 因扩展名/MIME 不一致
  触发浏览器拒绝渲染；即便文件已修，浏览器仍会在原 `Cache-Control:
  max-age=300` 的 5 分钟窗口内复用那条失败响应，导致用户必须 hard
  reload 才能看到新图。`business-architecture.jpg` 同一区块的破图截图
  即由该缓存效应导致。
- 改动（`server.py:docs_asset`）：
  1. 计算 ETag = `W/"{mtime}-{size}"`，文件被替换/重命名/扩展名修正时
     ETag 立即变化；
  2. 把 `Cache-Control` 从 `public, max-age=300` 改为
     `public, max-age=60, must-revalidate`，缩短零网络命中窗口，强制
     每次回源做 `If-None-Match` 协商；
  3. 命中 ETag 直接返回 `304 Not Modified`（无 body，省带宽），未命中
     则正常 200 全量响应。
- 验证：
  - 第一次请求：`200 OK` + `ETag: W/"1778749266-154837"` +
    `Cache-Control: public, max-age=60, must-revalidate`；
  - 携带相同 ETag 二请求：`304 Not Modified`，无 body；
  - 携带陈旧 ETag：`200 OK` 全量重发；
  - `architecture-overview.jpg`（重命名后）独立 ETag = `W/"...178159"`，
    与 `business-architecture.jpg` 互不污染。

### Fixed — `SYSTEM_ARCHITECTURE_DIAGRAMS.md` 设计参考图加载失败

- 现象：`docs/architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md` 的"视图 A：设计
  参考图"在文档门户中无法显示，控制台报 MIME / 解码相关警告。
- 根因：`docs/architecture/assets/architecture-overview.png` **实际是 JPEG
  数据**（来源截图工具默认导出 JPEG 并被错误命名为 `.png`）。Flask
  `/docs/asset/<path>` 路由按扩展名将 `Content-Type` 写为 `image/png`，与
  二进制流不一致，触发 Chrome 等浏览器的 MIME 强校验拒绝渲染。
- 修复：
  1. 物理重命名 `architecture-overview.png` → `architecture-overview.jpg`，
     使扩展名与真实 JPEG 数据匹配；
  2. 同步更新 `docs/architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md` 的图片
     引用与 `server.py` 路由示例注释；
  3. 全 `docs/` 资源目录批量复核扩展名/MIME 一致性，确认仅此一例越界。
- 验证：
  - 旧路径 `/docs/asset/architecture/assets/architecture-overview.png` →
    HTTP 404（符合预期，避免缓存命中错误 MIME）；
  - 新路径 `/docs/asset/architecture/assets/architecture-overview.jpg` →
    HTTP 200，`Content-Type: image/jpeg`，`Content-Length: 178159`；
  - `file(1)` 复检：四个 docs/ 资源全部 ext / 实际 MIME 一致。

### Added — 算法架构图与可复用生成 Prompt

- 新增 [`docs/algorithms/ALGORITHM_ARCHITECTURE_DIAGRAMS.md`](docs/algorithms/ALGORITHM_ARCHITECTURE_DIAGRAMS.md)：
  以**资深算法设计师**视角重新组织算法栈视图，1 张总览图 + 8 张算法子图：
  - **总览图**：信号采集（玩家画像 / 能力 / 生命周期信号 / 特征快照）→ 算法
    核心（出块双轨 / Gameplay RL / 商业化模型 / Lifecycle 编排）→ 决策与
    策略（规则引擎 / 频控 / Policy 包装 / 留存触点）→ 训练与监控（PyTorch /
    SpawnV3 trainer / drift / quality）四层 + 4 条算法侧设计原则。
  - **图 1**：出块双轨决策架构（启发式 12 信号 → adaptiveStress → 10 档
    profile vs 生成式 buildContext → V3 predict → fallback；硬切换 + 统一
    护栏）。
  - **图 2**：SpawnTransformerV3 网络与推理流（TransformerEncoder + LoRA +
    autoregressive joint + feasibility head + 温度 0.8 / topK 8）。
  - **图 3**：Gameplay RL 训练栈（PPO + GAE + ConvSharedPolicyValueNet +
    DockBoardAttention + 5 多任务辅助头 + EvalGate）。
  - **图 4**：玩家画像与能力评估（Bayes 快收敛 + EWMA 0.85 + EWLS trend +
    segment5 + AbilityVector v2 五维）。
  - **图 5**：商业化核心决策（线性加权 + abilityBias ±0.12-0.18 + 5 段
    guardrail 链 + recommendedAction 阈值）。
  - **图 6**：商业化 ML scaffolding 栈（calibration / explorer ε=0.05 /
    LinUCB α=0.5 / ZILN / Survival / MTL / drift KL>0.10 / quality）。
  - **图 7**：决策与执行管线（strategyEngine + adTrigger 多窗 cap + LTV
    shield + commercialPolicy + adInsertionRL）。
  - **图 8**：生命周期信号 → 编排 → 策略（churn 三源 blend 0.45/0.35/0.20
    + engagement 公式 + winback 7d / 复购 7d / churn_high）。
  - **scaffolding 诚实标注**：calibration / explorer / bandit / ZILN / MTL
    / survival / adInsertionRL 全部用虚线 + `flag:` 边标签标注 opt-in，
    不画成已稳定上线。
- 新增 [`docs/algorithms/ALGORITHM_DIAGRAM_PROMPT.md`](docs/algorithms/ALGORITHM_DIAGRAM_PROMPT.md)：
  可复用的"喂给大模型即生成完整算法架构图集合"的 prompt 模板，事实包覆盖
  10 节（信号采集 / 出块双轨 / Gameplay RL / 商业化核心 / 商业化 ML
  scaffolding / 决策与执行 / 生命周期 / 后端辅助 / 跨模块协同 / 上线路径
  速查），含全部模型默认值与阈值；输出规格含 1 总览图 + 8 子图、Mermaid
  编码约定（推荐 ELK 布局）、禁止红线（不画 scaffolding 为已稳定 / 不
  混淆 SpawnV3 与 Gameplay RL）、自检清单。
- `server.py` 在「算法与模型」分类登记两份新文档；`docs/README.md`「跨
  模块架构契约」补充算法架构图与算法 prompt 行；算法工程师角色入门链路
  增加算法架构图为第一站；`docs/algorithms/README.md` 新增「一图入门」
  小节作为算法目录的快速入口。
- 算法总览图离线渲染产物：`docs/algorithms/assets/algorithms-overview.png`
  （ELK 布局，~340KB），与系统架构总览的 `architecture-overview.png` 对齐
  策略，使 `ALGORITHM_ARCHITECTURE_DIAGRAMS.md` 在 GitHub / 不支持 Mermaid
  的阅读器中也可直出总览；门户与 mermaid.live 仍按下方源码块实时重渲染。
- 新增渲染工具链 `tools/diagram-render/`：`extract_mermaid.py`
  抽取 markdown 中的 ` ```mermaid ` 块到 `work/algo-NN.mmd` 并写入
  `algo-manifest.json`（记录每块 start/end 行号）；`puppeteer.json`
  把 puppeteer 指向本机 `/Applications/Google Chrome.app`，避免 mmdc
  下载 chromium；`mermaid.config.json` 统一字体（PingFang SC / 微软雅黑
  fallback）与 flowchart 默认配置。`work/algo-01.svg ~ algo-09.svg`
  为本轮通过 `npx @mermaid-js/mermaid-cli mmdc` 离线渲染的全部 9 张图，
  仅作工程产物保留，不入文档主链路。

### Added — 算法架构图（六层 + 七子模型设计参考稿）

- 新增 `docs/algorithms/assets/algorithm-architecture.jpg`（1024×768 ·
  176 KB）：OpenBlock 算法栈的"设计参考稿"，覆盖六层结构（① 数据输入
  / ② 核心模型 / ③ 决策输出 / ④ 训练与优化 / ⑤ 支撑 / ⑥ 反馈闭环），
  把核心模型层的 7 个具名子模型（PlayerProfile · AbilityVector ·
  CommercialPolicy · AdTrigger · AdInsertionRL · LifecycleOrchestrator
  · ActionOutcomeMetrics）围绕"融合决策引擎"展开，并把"奖励信号
  （收益 / 留存 / 满意度 / 风险 / 生态健康）"作为训练层的多目标优化
  底座单独画一行。
- `docs/algorithms/ALGORITHM_ARCHITECTURE_DIAGRAMS.md` 总览区从单视图
  扩为双视图：
  - **视图 A：设计参考图**（新 hero 图）—— 评审 / 培训 / 对外宣讲
    使用，附 6 行表把每层映射到代码模块与权威文档（SQLITE_SCHEMA /
    ALGORITHMS_HANDBOOK / MODEL_SYSTEMS_FOUR_MODELS / ALGORITHMS_RL /
    PROJECT / OBSERVABILITY / LIFECYCLE_DATA_STRATEGY_LAYERING）。
  - **视图 B：紧凑概念图**（既有 ELK PNG + Mermaid）—— 与下方 8 张
    展开图保持同一节点 / 边粒度，便于逐图深入。
  - 文档头 `定位` / `范围` / `生成方式` 同步扩到双视图描述；阅读顺序
    表同步说明视图 A / 视图 B 各回答什么问题。
  - 在视图 A 表后追加"诚实标注"提示：图中"七大子模型"覆盖**已稳定**
    与 **opt-in scaffolding** 两类（calibration / explorer ε / LinUCB
    / MTL / ZILN / survival / drift 等以 baseline 入库 + flag 默认 OFF），
    具体见下方 8 张展开图。
- `docs/algorithms/README.md`「一图入门」章节顶部嵌入新 hero 图 +
  双视图说明；`docs/README.md` 算法工程师角色入门链路与跨模块架构
  契约表行同步改为「设计参考 + 紧凑概念图 + 8 子图」。

### Added — 业务架构图（产品最高层视图）

- 新增 `docs/architecture/assets/business-architecture.jpg`（1024×558 ·
  155 KB）：OpenBlock 作为 **"游戏 + AI + RL + 商业化"** 开源平台的最高层
  产品视图——四支柱 🎮 Games Engine / 🧠 Adaptive Spawning AI / 🤖
  Reinforce Learning Trainer / 💰 Monetization Framework，由 🗄️ Shared
  Data Source 串成 🔁 Unified Ecosystem 正反馈闭环。
- 三处入口同步嵌入（hero 位置）：
  1. **根 `README.md`**：在中英文导航行下方插入 hero 图 + 中英文双语
     "业务架构总览"段落，作为新人扫到项目的第一眼视觉，引向系统架构图
     与算法架构图。
  2. **`docs/README.md`**（文档中心）：在「如何阅读」之前插入 hero 图 +
     "一图入门"段落，配合下方角色导航形成"先看图 → 再按角色找文档"
     的双层入口。
  3. **`docs/architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md`**：新增「业务
     架构总览：四支柱 + 统一生态」章节，置于"全栈分层"技术总览之上，
     用一张表把每个支柱与对应的技术展开图、权威算法 / 商业化 / 平台
     文档一一对应起来；同步把阅读顺序表加 1 行、文档头 `定位` /
     `范围` 同步扩到三层（业务 → 全栈 → 6 子图）。
- `docs/README.md` 跨模块架构契约表中"系统架构图"行同步改为"业务架构 +
  全栈分层 + 6 子图"，让一行说清三视图全貌。

### Added — 系统架构图与可复用生成 Prompt

- 新增 [`docs/architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md`](docs/architecture/SYSTEM_ARCHITECTURE_DIAGRAMS.md)：
  - **总览图**置于文档最前，含两种视图：
    - 视图 A：`docs/architecture/assets/architecture-overview.png` 设计参考稿
      （6 层 × 模块卡 + 层内约束 + 底部 6 条全局原则带），评审 / 培训 / 对外
      宣讲时使用。
    - 视图 B：紧凑 Mermaid 概念图（一屏可视），层内只保留模块标题，原"层内
      约束 / 设计原则"文案下沉到下方两个解读表，避免单图过宽过高。
    - 布局：嵌套 subgraph 中 `direction LR` 在 mermaid 默认 dagre 渲染器下
      不可靠（实际表现为各层被挤成单列、整体呈斜向阶梯），改用 **ELK 渲染器**
      （通过 mermaid YAML 前置 `config: layout: elk` 启用，仅作用于本图）；
      `web/public/docs.html` 异步加载 `@mermaid-js/layout-elk@0.2/+esm`
      并 `registerLayoutLoaders`，加载失败静默回退默认渲染器。
  - 6 张 Mermaid 展开图覆盖容器视图、L3 组件、MonetizationBus 事件总线、
    出块 / RL 双轨、后端路由 + 持久化、四端同步与部署拓扑；每张图节点数
    控制在 12–25 之间，前后置问题陈述与解读。
- 新增 [`docs/architecture/ARCHITECTURE_DIAGRAM_PROMPT.md`](docs/architecture/ARCHITECTURE_DIAGRAM_PROMPT.md)：
  可复用的"喂给大模型即生成完整架构图集合"的 prompt 模板，包含事实包、
  设计原则、输出规格、Mermaid 编码约定、禁止红线与自检清单。
- `web/public/docs.html` 文档门户接入 `mermaid@11`：拦截 ` ```mermaid `
  代码块、转 `<div class="mermaid-pending">` 占位，异步等待 `window.mermaid`
  就绪后渲染为 SVG；含失败回退与代码原文展示。
- 文档图片资源管线：`server.py` 新增 `/docs/asset/<path>` 路由派发 `docs/`
  下图片（仅允许 png/jpg/jpeg/gif/webp/svg，含路径穿越与扩展名校验）；
  `web/public/docs.html` `fixRenderedContent` 把 markdown 中相对图片路径
  （如 `./assets/x.png`）按当前文档目录改写到该路由。这样同一份 markdown
  在 GitHub 上按相对路径直出，在文档门户内通过路由透出。
- 文档门户图片 / Mermaid 点击放大（Lightbox）：`web/public/docs.html` 新增
  全屏遮罩浏览器，解决静态 PNG 截图（如 `architecture-overview.png` /
  `algorithms-overview.png`）随容器宽自适应缩放后看不清细节、Mermaid SVG
  在窄屏被压缩到不可读的问题。
  - 触发：所有 markdown `<img>` 自动加 `.zoomable` + click handler；mermaid
    渲染完成后给 SVG 加同样 click handler。
  - 工具栏：`⤢` 适应屏幕 / `1:1` 原始尺寸 / `−`/`＋` 缩放 / `↗` 新标签打开
    原图 / `✕` 关闭；右上角实时显示当前缩放百分比。
  - 缩放采用 **resize-by-width** 而非 `transform: scale`：layout 与 visual
    同步，stage 用 `display: grid; place-items: center` + `overflow: auto`，
    放大后超出屏幕仍可正常滚动到全部内容（transform-scale 在居中布局下会
    截断左侧溢出）。
  - 交互：拖拽平移（`mousedown` + `mousemove` 改 `scrollLeft/Top`）/
    `Ctrl|⌘ + 滚轮` 缩放 / 双击切换 fit↔1:1 / 键盘 `Esc` 关 / `0|F` fit /
    `1` 1:1 / `+|-` 缩放。
  - SVG 路径：清掉 mermaid 设的 `max-width:100%` 内联 style，确保按
    `viewBox` 放大无损；PNG 路径：测量 `naturalWidth/Height` 后按 fit 比例
    展开。
- `server.py` 架构契约分类登记两份新文档；`docs/README.md` 跨模块架构契约
  表同步增加两行。

### Changed — 文档中心结构重构（去除中间态表述、对齐代码事实）

- 把 sprint / 路线图类文档移入 `docs/archive/`：
  - RL 版本分析：`docs/archive/algorithms/RL_V9_1_DEEP_ANALYSIS.md` /
    `RL_V9_3_SCORE_BREAKTHROUGH_ANALYSIS.md` / `RL_SELF_PLAY_ROADMAP.md` /
    `RL_TRAINING_OPTIMIZATION.md` / `RL_BROWSER_OPTIMIZATION.md`
  - product 路线图：`docs/archive/product/PLAYER_RETENTION_ROADMAP.md` /
    `EASTER_EGGS_ROADMAP.md` / `RETENTION_ROADMAP_V10_17.md`
- 重写：`docs/algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md`（"v1.49.x 评审" → 稳定的"商业化模型架构设计"）；
  `docs/architecture/MONETIZATION_EVENT_BUS_CONTRACT.md`（按真实 emit 点重写）；
  `docs/operations/COMMERCIAL_STRATEGY_REVIEW.md`（"路线图 + 实施成果" → "商业化系统综合报告"）；
  `docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md`（"90 天 P0/P1 任务清单" → "系统能力与运营接入点"）；
  `docs/operations/COMMERCIAL_IMPROVEMENTS_CHECKLIST.md`（"61 项对照实现" → "能力对照表"）
- 修正 `docs/algorithms/ALGORITHMS_MONETIZATION.md` 与代码事实不一致的章节：
  默认规则矩阵（实际为 `whale_default_monthly` / `dolphin_default_weekly` 等 9 条）、
  排序键去掉不存在的 `ruleId ASC`、§6.2 标题 "5 个分组" → "6 个分组"、
  `_activityCoeff` / `_skillCoeff` 伪代码补齐 `trend` 与 `seg` 局部变量、
  §9 广告频次按 `AD_CONFIG`（rewarded `maxPerGame:3 / maxPerDay:12 / cooldownMs:90s`，interstitial `maxPerDay:6 / cooldownMs:180s`）、
  §13.6 频次表去掉不存在的 `native` 行、
  §15 收缩为算法层扩展模块索引（详细设计指向 `COMMERCIAL_MODEL_DESIGN_REVIEW.md`）

### Added (v1.49.x — 商业化模型算法层一揽子改造：snapshot / calibration / MTL / bandit / drift)

**背景**：商业化策略 Phase 1–4 落地后，对 `commercialModel` 做了一次**算法工程师视角**的建模评审（详见 `docs/algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md`），识别四个核心问题：propensity 打分不是真实概率（缺 calibration）、4 个 head 强耦合（无 MTL）、训练标签自我闭环（selection bias）、权重静态不自适应分布。本轮按 P0–P3 共 14 项实装可注入的 ML scaffolding，所有改造默认 **opt-in / 向后兼容**，feature flag 灰度。

**P0 — 观测能力（无 ROI 无法决策）**

| 项 | 模块 | 关键改动 |
|---|---|---|
| snapshot | `commercialFeatureSnapshot.js`（新文件） | 25 维统一特征 schema（versioned + frozen）；解决训练-推理 skew；`featureSnapshotDigest` 32-bit FNV-1a 哈希用于 outcome attribution |
| P0-1 | `calibration/propensityCalibrator.js`（新文件） | isotonic regression + Platt scaling 推理 + identity fallback；`setCalibrationBundle({...})` 让线下训练好的校准表通过 RemoteConfig 热更；commercialModel.vector 输出 `calibrated` 字段 |
| P0-2 | `quality/modelQualityMonitor.js`（新文件） | 滑动缓冲 max 2000 样本/task；输出 PR-AUC / Brier / log-loss / hit-rate@10；同时报 raw vs calibrated 对照；24h 报告窗 |
| P0-3 | `quality/actionOutcomeMatrix.js`（新文件） | 推荐 action × 实际 outcome 矩阵；30min attribution 窗 + snapshotDigest 精确匹配；MonetizationBus 自动接线（`purchase_completed` / `ad_complete` / `lifecycle:session_end`） |

**P1 — 减少建模偏差**

| 项 | 模块 | 关键改动 |
|---|---|---|
| P1-1 | `explorer/epsilonGreedyExplorer.js`（新文件） | ε-greedy 包装器（默认 ε=0.05）+ IPS propensity 标签；用户级冷却（每小时 ≤6 次探索） |
| P1-2 | `ml/multiTaskEncoder.js`（新文件） | shared linear encoder W ∈ ℝ^(16×25) + b → ReLU → 4 个 sigmoid head（iap/rewarded/interstitial/churn）；默认 identity encoder + uniform head；`setMultiTaskWeights()` 接受线下 PyTorch 训练参数 |
| P1-3 | `lifecycle/lifecycleSignals.js` | `setChurnBlendWeights({...})` 接口：unifiedRisk 三腿权重可注入（按线下 PR-AUC 比例归一），自动 normalize 到和=1；旧 `CHURN_BLEND_WEIGHTS` 名字保留 Proxy 兼容 |

**P2 — 模型升级**

| 项 | 模块 | 关键改动 |
|---|---|---|
| P2-1 | `ml/zilnLtvModel.js`（新文件） | Zero-Inflated Lognormal LTV 推理：`E[LTV30 \| x] = (1 - p_zero) · exp(μ + σ²/2)`；`toLegacyLtvShape` 提供 drop-in 替换 ltvPredictor 的接口 |
| P2-2 | `ml/priceElasticityModel.js`（新文件） | DML demand curve scaffolding：`σ(logit(baseline_p) + α·(-d) + β·d²)`；`recommendDiscount({stageCode, riskBucket, basePrice})` argmax_d expected_revenue |
| P2-3 | `quality/distributionDriftMonitor.js`（新文件） | per-feature 10-bin 直方图；`KL(p_live ‖ p_train)` 报告：> 0.10 = high drift（建议重训练），> 0.25 = critical（建议下线） |

**P3 — 探索方向**

| 项 | 模块 | 关键改动 |
|---|---|---|
| P3-1 | `ml/contextualBandit.js`（新文件） + flag `adInsertionBandit` | LinUCB 在线学习（Li et al. 2010）：`A_a += xx^T, b_a += r·x`；`UCB = θ^T x + α·√(x^T A^{-1} x)`；`buildBanditPolicyForAdInsertion()` 注入 adInsertionRL |
| P3-2 | `ml/survivalPushTiming.js`（新文件） | Cox 比例风险推理：`S(t \| x) ≈ S_0(t)^{exp(β^T x)}`；`recommendPushTime({features, threshold=0.7, horizon=21})` 找最早跌破 threshold 的天数 |

**工程层**

| 改造 | 关键改动 |
|---|---|
| `commercialModel.getCommercialChurnRisk01` 缓存 | 50ms TTL；同一 ctx 重复调用直接复用，避免 _abilityBias / snapshot / calibration 算两次 |
| `adInsertionRL` features 双视图 | `state.features`（array）+ `state.featuresByKey`（dict）；导出 `FEATURE_KEYS` 索引语义；下游消除"魔术索引 11=churnRisk" |
| `commercialPolicy.decideAndRecord`（新文件） | 推理 → 探索包装 → outcomeMatrix 记录"三合一"入口；commercialModel + explorer + AOM 不再各调各的 |

**Feature flags 默认值**：`commercialModelQualityRecording=true / actionOutcomeMatrix=true / distributionDriftMonitoring=true`，`commercialCalibration=false / explorerEpsilonGreedy=false / multiTaskEncoder=false / adInsertionBandit=false`（observation-first，决策路径需金丝雀验证后再放量）。

**测试覆盖**：13 个新测试文件、约 80 个 cases。`tests/commercialFeatureSnapshot.test.js` / `propensityCalibrator.test.js` / `modelQualityMonitor.test.js` / `actionOutcomeMatrix.test.js` / `epsilonGreedyExplorer.test.js` / `multiTaskEncoder.test.js` / `churnBlendWeights.test.js` / `zilnLtvModel.test.js` / `priceElasticityModel.test.js` / `distributionDriftMonitor.test.js` / `contextualBandit.test.js` / `survivalPushTiming.test.js` / `commercialPolicy.test.js`。本轮全量回归 88 测试文件 / 1306 用例 全绿、lint 0 errors。

**文档**：新增 `docs/algorithms/COMMERCIAL_MODEL_DESIGN_REVIEW.md`（商业化模型架构设计：模型本质、推理流水线、训练-推理契约、公式集合）；`docs/algorithms/ALGORITHMS_MONETIZATION.md` 第 15 章作为算法层扩展模块索引；`docs/architecture/MONETIZATION_EVENT_BUS_CONTRACT.md` 按真实 emit 点重写事件全集与订阅方索引；`docs/operations/COMMERCIAL_STRATEGY_REVIEW.md` 重写为商业化系统综合报告；`docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md` 从 90 天清单改写为能力 / 接入点对照表。

### Added (v1.49.x — 商业化策略改进 Phase 1–4 完整落地)

**背景**：基于"新玩家信号 + 长期行为"对当前商业化系统的综合分析（详见 `docs/operations/COMMERCIAL_STRATEGY_REVIEW.md`），识别出 P0–P3 共 21 个改进项，分四个 Phase 落地。

**Phase 1 — 数据管道 / 关键修复（P0）**

| 项 | 模块 | 关键改动 |
|---|---|---|
| P0-1 | `iapAdapter.js` / `lifecycleAwareOffers.js` | 统一付费事件 `purchase_completed`；接到 firstPurchaseFunnel + vipSystem.updateVipScore + analyticsTracker 三路；emit `lifecycle:first_purchase` 供 UI 订阅 |
| P0-2 | `lifecycleOrchestrator.onSessionEnd` | 调 `commercialModel.getCommercialChurnRisk01` 把"商业体感"那条腿补齐，`unifiedRisk` 从此前的双腿（churnPredictor + maturity）变成事件 + 技能 + 体感三腿投票 |
| P0-3 | `playerInsightPanel.js` | 修 `p?.profile?.daysSinceInstall` 笔误（p 自身就是 PlayerProfile） |
| P0-4 | `lifecycleOrchestrator.onSessionEnd` | 真正调 `updateMaturity`，让 `getMaturityInsights()` 不再永远返回首装 L1/M0 默认值 |
| P0-5 | `remoteConfigManager.js` | 修 `getApiBaseUrl` import 路径（`./cohortManager.js` → `../config.js`） |
| P0-6 | `paymentManager.LIMITED_OFFERS` | 补 `winback_user`：≥7 天未活跃自动激活 50% 折扣回流券 |
| P0-7 | `monetization/offerToast.js`（新文件） | 订阅 `lifecycle:offer_available` / `first_purchase` / `churn_high`，最小 UI Toast 接线，cooldown=24h（in-memory + localStorage 双保险） |

**Phase 2 — 信号增益（P1）**

| 项 | 模块 | 关键改动 |
|---|---|---|
| P1-1 | `commercialModel.js` + flag `abilityCommercial` | `buildCommercialModelVector` 引入 `_abilityBias`：`planning / confidence / clearEff / risk / skill` 五项各以 0.5 为中心做线性微调（系数 0.08–0.18，总修正幅度约 ±0.15），让 IAP/激励/插屏/流失四路 propensity 反映真实玩家能力 |
| P1-2 | `adTrigger.js` | 新增 flow / cognitiveFatigue 两条护栏：心流中或反应已退化到 baseline×1.5 时硬阻拦插屏（rewarded 在 cognitiveFatigue 时也跳过）；导出 `getAdGuardrailState` |
| P1-3 | `paymentManager.js` + flag `dynamicPricing` | 新 `DYNAMIC_PRICING_MATRIX` 与 `getDynamicPricingBonus`：按 `stage × unifiedRisk01` 给最多 +20% 折扣；`calculateDiscountedPrice` 接受 `lifecycleHints` 注入 |
| P1-4 | `personalization.js` | 新增 `getAbilitySegment`（prudent/speed/strategic/impulsive/balanced）+ `getAbilitySegmentMeta`，写入 `getCommercialInsight` |
| P1-5 | `progression.isSkinUnlocked` + flag `skinUnlockBridge` | 通过 `setSkinUnlockProvider` 注入 `skinUnlock.isSkinUnlocked`，避免两套等级解锁不一致 |

**Phase 3 — 结构清理（P2）**

| 项 | 模块 | 关键改动 |
|---|---|---|
| P2-1 | `seasonPass.js` | UI 任务系统调用 `addMonSeasonXp`，与 `monetization/seasonPass.js` 的 tier XP 实时同步 |
| P2-2 | `monetization/lifecycleOutreach.js`（新文件） | 把孤儿模块 `pushNotificationSystem` / `shareCardGenerator` 接到 lifecycle 事件流：`churn_high → CHURN_WARNING push`、`first_purchase → 庆祝 push + 分享卡`、`offer_available → LIMITED_OFFER push` |
| P2-3 | `ad/adDecisionEngine.js` + flag `adDecisionEngine` | 修 import 路径（漏 `../`）；`adAdapter.loadAd` 改用真实 API `showRewardedAd / showInterstitialAd`；`adTrigger.on('game_over')` 在 flag=on 时委托决策 |
| P2-4 | `adaptiveSpawn.js` / `strategyAdvisor.js` / `playerInsightPanel.js` | 优先调 `getCachedLifecycleSnapshot`（300ms TTL），同帧内三处共用一份 snapshot；snapshot stage 与直读不一致时仍以直读为准（兼容 `_daysSinceInstall` 私有字段 mock） |
| P2-5 | `adAdapter.js` | `showRewardedAd` / `showInterstitialAd` 全程 emit `ad_show` / `ad_complete` 到 MonetizationBus + analyticsTracker，让 `funnels.AD_WATCH` 真正有数据 |

**Phase 4 — 智能化（P3）**

| 项 | 模块 | 关键改动 |
|---|---|---|
| P3-1 | `winbackProtection.evaluateEarlyWinbackSignal` | confidence < 0.30 + frustration ≥ 0.55（或 missRate ≥ 0.40）→ 提前 emit `lifecycle:early_winback` + `lifecycle:offer_available`，无需等待 7 天；`setEarlyWinbackPolicy` 预留 RL 注入面 |
| P3-2 | `monetization/ad/adInsertionRL.js`（新文件） + flag `adInsertionRL` | RL scaffolding：`buildAdInsertionState` 状态特征（4 体感 + 3 生命周期 + 3 频率 + 5 commercial vector + N scenes one-hot）、`computeAdInsertionReward` 奖励函数、`selectAdInsertionAction` 策略接口（默认规则版 = `_selectBestAdType`，可热替换） |
| P3-3 | `firstPurchaseFunnel.evaluateFirstPurchaseTimingSignal` + flag `firstPurchaseTiming` | confidence ≥ 0.55 + flow ≥ 0.50 + frustration ≤ 0.40 + 命中推荐 offer 窗口时主动 emit `lifecycle:offer_available { type: 'first_purchase_window' }` |
| P3-4 | `adTrigger._isLtvShielded` + flag `ltvAdShield` | VIP T2+ 或 lifetimeSpend ≥ 50 的玩家：插屏 70% 概率主动跳过；rewarded 不受影响；`getAdGuardrailState` 暴露 `ltvShielded` 字段 |

**Feature flags 默认值**：`abilityCommercial=true / dynamicPricing=true / skinUnlockBridge=true / lifecycleOfferToast=true / firstPurchaseTiming=true / ltvAdShield=true`，`adDecisionEngine=false / adInsertionRL=false`（金丝雀）。

**测试覆盖**：新增 `tests/lifecycleOutreach.test.js`、`tests/adAdapterEvents.test.js`、`tests/winbackEarlySignal.test.js`、`tests/adInsertionRL.test.js`、`tests/firstPurchaseTiming.test.js`，并扩充 `tests/lifecycleSignals.test.js` / `tests/commercialModel.test.js` / `tests/adTrigger.test.js` / `tests/paymentManagerDynamicPricing.test.js` / `tests/abilitySegment.test.js` / `tests/progression.test.js`。

**事件契约扩展**：MonetizationBus 新增 `purchase_completed` / `ad_show` / `ad_complete` / `lifecycle:early_winback`；`lifecycle:offer_available` 新增 `type: 'early_winback' | 'first_purchase_window'` 子类。详见 `docs/architecture/MONETIZATION_EVENT_BUS_CONTRACT.md`。

### Fixed (v1.49.x — 回放时得分未同步更新；瞬移分数 DOM 永远停在旧值)

**用户报告**："回放时得分未同步更新"。打开本局结算 → 回放，HUD `#score` 始终停留在打开回放前的旧值，无论拖动滑块到任何帧或自动播放，分数都不变（盘面、待选块、画像面板都正常切换）。

**根因**：`game.applyReplayFrameIndex(idx)` 与 `game.syncFromSimulator(sim)` 两条"瞬移分数"路径，为了**压制 HUD 滚动 / `+N` 飘字**（拖时间轴时狂闪），把 `_lastDisplayedScore` 与 `this.score` **同时**设为目标分数后再调 `updateUI()`：

```js
// applyReplayFrameIndex（旧）
this._lastDisplayedScore = st.score;
this.score = st.score;
this.updateUI();
```

但 `updateUI()` 里更新 `#score` DOM 的两个分支只覆盖了：

```js
// updateUI（旧）— 两路都进不去
if (this._lastDisplayedScore == null) {
    scoreEl.textContent = String(this.score);          // 重开局首帧
} else if (this._lastDisplayedScore !== this.score) {
    animateHudScoreChange(scoreEl, this.score, ...);   // 实机加分
}
```

`_lastDisplayedScore === this.score` 时**两个分支都进不去** → DOM 永远停在打开回放之前的值（如上一局结束时的 1280），用户感知到"回放时得分未同步"。RL 演示路径 `syncFromSimulator` 同样受影响。

**修复**：把分数 DOM 同步逻辑抽成 `scoreAnimator.js` 的 named export `syncHudScoreElement(element, score, lastDisplayedScore)`，新增第三个 **`'sync'` 兜底分支**——当 `lastDisplayedScore === score` 但 `element.textContent !== String(score)` 时直接 textContent 写入（无动画，符合"瞬移"语义）：

| 分支 | 触发条件 | 行为 |
|---|---|---|
| `'no-element'` | `element == null` | 无副作用，返回标志 |
| `'init'` | `lastDisplayedScore == null` | 直接 textContent（重开局首帧 / RAF cold start） |
| `'animate'` | `lastDisplayedScore !== score` | 走 `animateHudScoreChange`：滚动 + `+N` 飘字 + burst |
| **`'sync'`** | **`lastDisplayedScore === score` 且 DOM 文本陈旧** | **直接 textContent（修复回放 / RL 瞬移）** |
| `'noop'` | `lastDisplayedScore === score` 且 DOM 文本已对齐 | 不写 DOM（性能不变） |

实机加分 / 重开局首帧 / 同值不写 DOM 三种现有行为完全不变。

**实施**：

- `web/src/scoreAnimator.js`：新增 `syncHudScoreElement` 与 4 分支决策表 docstring。
- `web/src/game.js`：
  - `updateUI()` 里的 `#score` 块从 4 行 if/else 简化为 `syncHudScoreElement(scoreEl, this.score, this._lastDisplayedScore)`。
  - `applyReplayFrameIndex` 与 `syncFromSimulator` 注释更新，说明 DOM 同步由 `'sync'` 兜底分支负责。
  - 移除不再需要的 `animateHudScoreChange` 直接 import（仍由 `syncHudScoreElement` 内部使用）。

**单测**（`tests/scoreAnimator.test.js` 新增 `syncHudScoreElement — 回放/RL 瞬移分数 DOM 同步决策器（v1.49.x）` describe 块，**8 项**）：

- `element == null/undefined` → `'no-element'` 不抛错
- `lastDisplayedScore == null`（重开局首帧）→ `'init'` + 直接 textContent，无动画 / 无飘字
- `lastDisplayedScore !== score`（实机加分）→ `'animate'` + 触发滚动 + `+N` 飘字 + burst class
- **回放跳帧**（`last == score` 但 DOM 文本陈旧 '1280' → 目标 0）→ `'sync'` + DOM 写入 '0'，**无 burst / 无飘字**（核心修复用例）
- 回放滑块连续拖动 3 帧（240 → 1280 → 60，全程 `last == score`）→ 每帧都进 `'sync'`，全程零 burst / 零飘字
- 同值同 DOM（`updateUI` 反复调）→ `'noop'`，DOM 不写，无副作用
- RL `syncFromSimulator`（`last == score` DOM '420' → 目标 850）→ 与回放路径同走 `'sync'`
- 边界：回放第 0 帧分数恰好 == 上一局 HUD 残留 → `'noop'`（不画蛇添足）

全量 **1164/1164 passed**（原 1156 + 新 8）。

### Added (v1.49 — 盘面水印漂浮三次重写 + 麻将皮肤 HD"emoji 换装")

两件事在同一版本内多次迭代，本节记录最终方案。

#### A. 漂浮算法三次重写：从 dt-ease → smootherstep → Catmull-Rom spline

**演进路径**：

1. **旧实现「dt-ease 增量」** `new = old + (target-old) * (1 - exp(-dt/τ))`。
   8.3 FPS 上 RAF/setTimeout 调度漂移导致 `dt` 在 16-240ms 范围跳变 → ease 推进比例跳变 → 视觉"前快后慢"的不规律抖动。

2. **中间方案「wall-time + smootherstep 段插值」**：位置 = `lerp(prev, target, smootherstep(t))`，`t = (now-startTs)/dur`。彻底消除了 dt 抖动（位置变成 wall-time 的纯函数），但 smootherstep 在 t=0/1 处 `f'=0`（C² 性质带来的副作用） → icon 在段头尾接近静止；段头尾的"几乎静止 + 高频 wobble"让人感觉到"原地小幅抖"。

3. **当前方案「Catmull-Rom spline 滑动窗口」**：每个 icon 维护 4 个 waypoint `[p0, p1, p2, p3]`，当前段在 `p1 → p2` 之间，用 `catmullRom(p0, p1, p2, p3, t)` 插值。Catmull-Rom 在段端点切线为 `(p2-p0)/2` 和 `(p3-p1)/2` —— 速度 C¹ 连续且**不为零**，icon 持续在动；轨迹由相邻 waypoint 几何决定的自然弯曲（像浮萍随波）替代了原 wobble，不再需要任何高频抖动。段结束时数组 shift：`[p0,p1,p2,p3] → [p1,p2,p3,新随机 target]`，前段 t=1 切线 = `(p3-p1)/2` 与新段 t=0 切线 = `(p2'-p0')/2 = (p3-p1)/2` 严格相等，**速度天然连续**。

**保留的核心特性**：位置 = wall-time 的纯解析函数 → dt 抖动只影响"何时取样"而不影响"取样值"，帧率从 8.3 FPS 升到 60 FPS 也只改变取样稠密度，曲线本身完全相同。

**节奏参数变化**：

- segment 时长：14–24s → **8–14s**（spline 端点恒速 → 段切换更频繁但无停顿瑕疵，整体感觉"持续在飘"而非"段段缓动"）
- 高频 wobble：**已删除**（Catmull-Rom 自然弯曲足够）
- waypoint 振幅 / 帧率：保持不变（span × 14–24% / ~8.3 FPS）

**「换皮不换轨」契约**（v1.49 修订）：`drift.key` 公式从 `${skinId}:${W}x${H}:${basePtsLen}` 简化为 `${W}x${H}:${basePtsLen}`，**不再包含 skin.id**。这样所有同 5 锚点皮肤（即绝大多数皮肤，包括 mahjong / sakura / aurora / pixel8 等）共享同一漂浮时间线 —— 切换皮肤时 icon 继续从当前位置漂浮、不重置回锚点，仅 `fillText` 的 emoji 字符替换。这从代码层面保证了"麻将水印的运动轨迹 ≡ 其他皮肤水印的运动轨迹"，而不仅仅是"算法相同"。仅当 basePts.length 变化（皮肤覆盖了 hdAnchors 数量）或盘面尺寸 W×H 变化时才重建 waypoint。

**实施**：

- `web/src/renderer.js`：
  - 删除 `WATERMARK_PHASE_SPEED_MIN/MAX` / `WATERMARK_WOBBLE_RATIO` / `_randomWatermarkPhaseSpeed()`。
  - 删除 `smootherstep` 命名导出（中间方案的 helper，不再需要）。
  - 新增 `catmullRom(p0,p1,p2,p3,t)` 命名导出（uniform Catmull-Rom，τ=0.5）。
  - 重写 `_watermarkDrift` 数据结构：`{ key, waypoints[], startTs[], durationMs[] }`，每个 icon 维护 4 个 waypoint 的滑动窗口。
  - 重写 `_watermarkPointsForFrame`：从"读 wall-time + smootherstep 段插值 + wobble 叠加"简化为"读 wall-time + Catmull-Rom 段插值"，删除 wobble 路径。
  - segment 常量 14000/24000 → 8000/14000。
  - `drift.key` 移除 `skin.id` 前缀，实现"换皮不换轨"。

#### B. 全量 34 个皮肤 HD"emoji 换装"（5 件套终版，盘面 5 个水印两两不同）

mahjong 是 v1.49 首批接入的皮肤；终版扩展为**全量 34 个皮肤都注入 hdIcons**。

**v4 关键修复（"水印图片不得重复"）**：v3 的 hdIcons 数量 = 基础 icons 数量（多为 2-4 件），但默认锚点数是 5，渲染按 `icons[i % length]` 取值 → 当 `length < 5` 时必然出现重复 emoji（mahjong 2 件套在 5 锚点上 i%2 循环 → 锚点 0/2/4 = 🎲, 锚点 1/3 = 🀐 → **3 个 🎲 + 2 个 🀐**，用户截图证实"图片重复"）。v4 把所有皮肤的 hdIcons 数量统一抬到 **5 件 = 默认锚点数**，使 `icons[i % 5] = icons[i]` 在 5 个锚点上**两两不同**。每个皮肤 5 件主题强相关 emoji，**全局 170 件 emoji 唯一**且不与任何皮肤的基础 icons 重叠。HD 模式仅替换 emoji，**不引入 hdOpacity / hdScale / hdAnchors**——所有皮肤共享默认 5 锚点 + 默认 scale + 同一 segment 时长，与"换皮不换轨"契约（§A）配合形成完整产品体感。

**全量设计表**（170 个 hdIcons emoji，全局唯一）：

| id | 主题 | 基础 icons | hdIcons (5 件) |
|---|---|---|---|
| classic | ✨ 极简经典 | 🎮 ⭐ | 🕹️ 🎯 🏁 🎴 🎟️ |
| titanium | 💎 钛晶矩阵 | 💠 🔷 | 🔶 🔺 🟧 🟩 🟦 |
| aurora | 🌌 冰川极光 | 🐧 🐻‍❄️ ❄️ 🌌 | 🧊 ☃️ ⛷️ 🌨️ 🏂 |
| neonCity | 🌃 霓虹都市 | 🌃 🏙️ | 🌆 🚖 🏨 🚇 🚥 |
| ocean | 🌊 深海幽域 | 🦈 🐠 | 🐳 🐙 🐬 🐢 🦑 |
| sunset | 🌅 琥珀流光 | 🌅 🔆 | 🌇 🌞 🍹 🥥 🐚 |
| sakura | 🌸 樱花飞雪 | 🌸 🌺 | 🌷 🌹 🌼 💐 🪷 |
| koi | 🎏 锦鲤跃龙 | 🎏 🐟 | 🐉 🌊 🦞 🦀 ⛩️ |
| candy | 🍭 糖果甜心 | 🍭 🍬 | 🍦 🧁 🍫 🍪 🎂 |
| bubbly | 🫧 元气泡泡 | 🫧 🐡 | 🥤 🪀 🧋 🪩 💫 |
| toon | 🎨 卡通乐园 | 🎪 🎠 | 🤡 🎈 🪅 🎭 🤖 |
| pixel8 | 👾 街机格斗 | 👾 🎮 🍄 🥊 | 🪙 🏯 ⚔️ 🛡️ 🗡️ |
| dawn | ☀️ 晨光微曦 | 🌄 🌻 🕊️ 🍃 | 🐝 🦋 🌾 🍯 🌱 |
| food | 🍕 美食盛宴 | 🍕 🍔 | 🍣 🍩 🥐 🌮 🥗 |
| music | 🎹 音乐律动 | 🎹 🎸 | 🎷 🥁 🎺 🎻 🎤 |
| pets | 🐶 萌宠天地 | 🐶 🐾 | 🐱 🐰 🐹 🐤 🦊 |
| universe | 🪐 宇宙星空 | 🪐 ⭐ | 🚀 🛸 🌠 ☄️ 🌑 |
| fantasy | 🔮 魔法奇境 | 🔮 ✨ | 🧙 🪄 🧝 🧞 🪬 |
| beast | 🦁 野兽王国 | 🦁 🐯 | 🐆 🐺 🐘 🦏 🦒 |
| greece | 🏛️ 希腊神话 | 🏛️ ⚡ | 🦉 🏺 🗿 🏹 🐎 |
| demon | 😈 暗黑魔界 | 😈 💀 | 👻 🦇 🕷️ 🕸️ 👹 |
| jurassic | 🦕 侏罗纪 | 🦕 🦖 | 🦴 🌋 🥚 🪨 🦎 |
| fairy | 🧚 童话森林 | 🧚 🌸 | 🦌 🐿️ 🪺 🍂 🌰 |
| industrial | 🏭 蒸汽工业 | 🏭 ⚙️ | 🔩 🛠️ ⚒️ 🪛 ⛏️ |
| forbidden | 👑 紫禁城 | 👑 🐲 | 🪭 🧧 🏮 🥢 🍵 |
| **mahjong** | 🀄 麻将牌局 | 🀅 🀀 | 🎲 🀐 🀙 🀇 🀄 |
| boardgame | ♠️ 扑克博弈 | 🃏 ♠️ | 🎰 ♟️ ♣️ ♥️ ♦️ |
| sports | ⚽ 运动竞技 | ⚽ 🏆 | 🏀 🥇 🏐 🏈 ⚾ |
| outdoor | 🥾 户外运动 | 🥾 ⛺ | 🏔️ 🧗 🎒 🧭 🪃 |
| vehicles | 🏎️ 极速引擎 | 🏎️ ✈️ | 🚂 🚁 🚤 🛵 🚜 |
| forest | 🌳 山林秘境 | 🌳 🍁 | 🌲 🐻 🐗 🦔 🍇 |
| pirate | 🦜 海盗航行 | 🦜 🏴‍☠️ | ⚓ 🗺️ 💰 🛶 🚣 |
| farm | 🐄 田园农场 | 🐄 🌽 | 🐔 🥕 🐑 🐖 🥬 |
| desert | 🐫 沙漠绿洲 | 🐫 🌵 | 🦂 🌴 🏜️ 🐍 🌶️ |

总计：34 皮肤 × 5 = **170 个 hdIcons emoji，全部互异，全部不与 74 个基础 icons 重叠**。

**约束（由 `tests/mahjongHdWatermark.test.js` §4 全量 describe 块强制）**：

1. 所有 34 个皮肤都必须声明 hdIcons
2. **每个皮肤 hdIcons 数量 = 5（默认锚点数，盘面 5 个水印两两不同，杜绝"图片重复"）**
3. 每个皮肤 hdIcons 与该皮肤基础 icons 不重叠（HD 必须真正"换装"）
4. 全局 hdIcons emoji 唯一（任意两个皮肤的 hdIcons 不交，34×5=170 全互异）
5. hdIcons emoji 不在任何皮肤的基础 icons 全集里（避免与基础水印混淆）
6. 所有皮肤都不引入 hdOpacity / hdScale / hdAnchors（仅替换 emoji）
7. 小程序 hdIcons 与 web 完全一致（防止 sync 脚本漏改）

**字符细节**：注意 `🐉`（dragon `U+1F409`，koi）vs `🐲`（dragon-face `U+1F432`，forbidden 基础）是不同 codepoint；`🐻‍❄️`（polar-bear ZWJ sequence，aurora 基础）vs `🐻`（bear `U+1F43B`，forest hd）是不同 sequence；`🌳`（deciduous-tree，forest 基础）vs `🌲`（evergreen-tree，forest hd）vs `🌴`（palm-tree，desert hd）vs `🌱`（seedling，dawn hd）四种树木 emoji 完全互异；`🐱`（cat-face，pets）vs `🐈`（cat 普通形，未用）；这些是 Unicode 上的合法区分点，已通过约束 4/5 的逐字符校验。

**麻将皮肤的特殊回退记录**（v1.49 麻将专属四次演进，详见 `mahjong` describe 块）：

| 版本 | 方案 | 回退原因 |
|------|------|---------|
| v1 | 6 件套 + 自定义 6 锚点（六侧分布） | 破坏与其他皮肤一致的"5 锚点漂浮节奏" |
| v2 | 3 件套 + `hdOpacity 0.13`（vs 其他皮肤最高 dawn 0.12） | 亮度高于所有皮肤 |
| v3 | 2 件套 + 仅覆盖 hdIcons | 5 锚点 i%2 循环 → 3 个 🎲 重复（用户截图证实） |
| **v4 当前** | **5 件套（=锚点数）+ 仅覆盖 hdIcons** | 盘面 5 个水印 emoji 两两不同；亮度 / scale / 锚点 / 节奏全部继承基础值，与所有皮肤完全对齐 |

**渲染契约**（`boardWatermark` 新增 4 个可选字段，对所有皮肤开放）：

- `hdIcons: string[]` —— HD 模式覆盖的 emoji 数组；`qualityMode='high'` 时生效，其他画质保持基础 `icons` 控制开销。**强烈建议 `hdIcons.length === 5`**（= 默认锚点数，保证盘面 5 个位置 emoji 两两不同；< 5 时 i % length 循环必出现重复）。
- `hdOpacity: number` —— HD 模式不透明度（覆盖基础 `opacity`）；**所有皮肤 v4 都不引入此覆盖**，沿用基础值。
- `hdScale: number` —— HD 模式 emoji 占盘面短边比例（覆盖基础 `scale`）；**所有皮肤 v4 都不引入此覆盖**，沿用默认 0.24。
- `hdAnchors: Array<[xRatio, yRatio]>` —— HD 模式锚点（覆盖默认 5 锚点）；**所有皮肤 v4 都不引入此覆盖**，与所有皮肤共享默认 5 锚点。

任一 `hd*` 字段缺失自动回退到对应基础字段；`hdIcons` 缺失则整个 HD 套装不启用，其他皮肤完全不受影响。

**实施清单**：

- `web/src/skins.js`：34 个皮肤 boardWatermark 全量注入 `hdIcons`（每个皮肤 5 件，mahjong 已有 v1/v2/v3/v4 完整注释）。
- `web/src/renderer.js`：`_renderBoardWatermark` 重写支持 HD 字段切换；新增常量 `DEFAULT_WATERMARK_ANCHOR_RATIOS`。
- `scripts/sync-miniprogram-skins.cjs`：`BOARD_WATERMARKS` 全量同步 5 件套 `hdIcons`，与 web 端逐字符一致。
- `miniprogram/utils/renderer.js`：`_renderBoardWatermark` 同步 HD 字段切换逻辑（小程序仍是静态绘制，不涉及 spline 漂浮）；注释更新明确"小程序不参与 web 端 Catmull-Rom 漂浮"。
- `miniprogram/core/skins.js`：由 sync 脚本自动重新生成（34 个皮肤镜像同步）。

#### 单测（v4 终版共 25 项 + 19 项漂浮 = 44 项 HD 相关）

- `tests/watermarkDriftMotion.test.js`（19 项，未变）：catmullRom 数学性质 / 滑动窗口段交界 C¹ 连续 / 段端点速度非零 / wall-time 取样与 dt 解耦 / 「换皮不换轨」契约。
- `tests/mahjongHdWatermark.test.js`（25 项 v4 终版）：
  - **§1 mahjong 专属约束**（4 项）：`hdIcons === ['🎲', '🀐', '🀙', '🀇', '🀄']`（5 件套）+ `length === 5`；`hdOpacity / hdScale / hdAnchors === undefined`（v4 关键约束）。
  - **§2 小程序双端一致**（4 项）：mahjong sync 后字段完全相同。
  - **§3 `_renderBoardWatermark` 行为**（6 项）：HD/balanced/low 切换 + 缺失字段 fallback。
  - **§4 mahjong vs boardgame 姊妹皮肤错位**（2 项）：mahjong HD 含 ≥ 4 张麻将牌 + 1 颗骰子；boardgame HD 与 mahjong 全异。
  - **§5 全量 34 皮肤约束**（9 项 = 7 约束 + 1 计数 + 1 snapshot）：所有 34 个皮肤都有 hdIcons / **数量 = 5（v4 关键，杜绝图片重复）** / hdIcons 与基础 icons 不重叠 / 全局 hdIcons emoji 唯一（170 件） / hdIcons emoji 不在任何皮肤的基础 icons 全集里 / 所有皮肤都不引入 hd*Opacity/Scale/Anchors / 小程序双端 hdIcons 完全一致 / snapshot 锁定 v4 完整设计表。
- 全量 **1156/1156 passed**。

**未来扩展**

- 新增皮肤时必须同时为其设计 **5 件** hdIcons（`tests/mahjongHdWatermark.test.js` §5 约束 1+2 会强制失败）；推荐姿势：**只覆盖 `hdIcons`**，其他字段全部继承基础值，与所有皮肤共享漂浮节奏。
- 设计 hdIcons 时需避开已有 74 + 170 = 244 个 emoji（全部基础 icons + 已有 hdIcons），约束 4/5 会自动校验。
- 只有运动模式确实需要差异化（如 `pixel8` 想要 8-bit 像素跳格运动）才覆盖 `hdAnchors`；此时 hdIcons.length 必须改为 = `hdAnchors.length` 才能继续维持"图片不重复"，需同步放宽约束 6 / 改写约束 2 并补充对应单测。
- 若在不同 segment 时长 / 振幅之间做小幅 A/B（不同皮肤性格映射），调 `WATERMARK_SEGMENT_MIN/MAX_MS` 和 `WATERMARK_TARGET_AMP_*` 即可，spline 数学契约不变。

### Added (v1.48 — 生命周期 / 成熟度策略架构重构：数据层 + 编排层 + 策略层)

围绕"用户成熟度 / 生命周期对策略的影响"专题分析（详见 [`docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md` §统一数据层](docs/operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md)），把此前散落在 4 套"成熟度家族"和 3 套"流失风险"中的孤岛信号，重构为**底层统一数据层 + 上层业务策略层**的三段式架构，并把 6 个"已实装但生产代码无任何调用方"的 retention / 商业化模块真正接到主流程。

**新增架构：数据层 / 编排层 / 策略层**

- **数据层** `web/src/lifecycle/lifecycleSignals.js`（新文件）
  - `getUnifiedLifecycleSnapshot(profile, opts)` —— 把 `playerLifecycleDashboard.getLifecycleMaturitySnapshot` / `playerMaturity.getMaturityInsights` / `winbackProtection.getWinbackStatus` / `PlayerProfile.lifecyclePayload` 4 套信号一次性打包成稳定契约 `{ install, onboarding, returning, stage, maturity, churn, segment }`，所有上层（出块 / 商业化 / UI / 推送）只从这一处取数。
  - `getUnifiedChurnRisk(...)` —— 三套互不归一的 churnRisk（`commercialModel` 0..1 / `churnPredictor` 0..100 / `playerMaturity` 离散标签）按权重投票（0.45 / 0.35 / 0.20）合成单一 `unifiedRisk ∈ [0,1]` + 5 档枚举，并保留每个来源的明细供 UI 调试。任一来源缺失自动重算权重，不归零。
  - `getCachedLifecycleSnapshot` / `invalidateLifecycleSnapshotCache` —— 300ms TTL 缓存，避免同帧内 adaptiveSpawn / strategyAdvisor / playerInsightPanel 重复 localStorage 读取。
  - 纯函数：不写 localStorage、不发事件、不修改 profile。
- **编排层** `web/src/lifecycle/lifecycleOrchestrator.js`（新文件）
  - `onSessionStart(profile)` —— 在 `game.startGame()` 中调用：检测 winback 触发条件（≥7 天未活跃 + 未在保护期）→ 自动激活；通过 `MonetizationBus` 广播 `lifecycle:session_start` 事件。
  - `onSessionEnd(profile, sessionResult)` —— 在 `game.endGame()` 内 `recordSessionEnd` 之后调用：
    1. 把会话指标（score / duration / placements / misses / engagement）写入 `churnPredictor.recordSessionMetrics`（**P0-A**：此前生产代码无任何写入点，整套流失风险评估退化为常量）。
    2. 调 `winbackProtection.consumeProtectedRound`，达到 `PROTECTED_ROUNDS=3` 后自动退出（**P0-B**：此前 winback 模块 100% 孤立，回流玩家无任何保护）。
    3. 计算 `shouldTriggerIntervention`，命中则广播 `lifecycle:intervention` 事件，让推送 / 弹窗 / 任务系统订阅（**P0-C**：此前 dashboard 干预 API 与商业化总线无任何连接）。
    4. 失效 lifecycleSignals 缓存。
  - `getActiveWinbackPreset()` —— 给 `adaptiveSpawn` 的薄包装，避免 spawn 层直接 import retention 模块（保持单向依赖：spawn → lifecycle 编排层 → retention）。
  - `setLifecycleOrchestrationEnabled(bool)` —— 全局开关，便于灰度 / 单测关闭。
- **策略层** `web/src/monetization/lifecycleAwareOffers.js`（新文件）
  - 订阅 `lifecycle:session_start` —— 根据 stage / band / 沉默天数触发首充漏斗 / 复购 / `winback_user` offer，把 `firstPurchaseFunnel.getRecommendedOffer` + `paymentManager.triggerOffer` 接入主流程；命中后 emit `lifecycle:offer_available` 让弹窗 / banner / 推送订阅。
  - 订阅 `lifecycle:session_end` —— 把本局得分累加到 `vipSystem.updateVipScore`（**此前 VIP 等级永远是初始 V0**）；`unifiedRisk ≥ 0.5` 时 emit `lifecycle:churn_high`。
  - 订阅 `purchase_completed` —— 把购买记录回写 `firstPurchaseFunnel.recordPurchase`，让首充→复购窗口推进。
  - 通过 `monetization/index.js` 在 `initMonetization` 后期 attach；与 `commercialModel` 互补：前者管"现在能不能弹"，后者管"会话结束后该不该送优惠券"。

**P0 接线（修复"全瘫"链路）**

- **P0-A**：`web/src/game.js → endGame()` 在 `recordSessionEnd` 之后调用 `onSessionEnd(profile, sessionResult)`。流失风险评估从此有数据。
- **P0-B**：`web/src/game.js → startGame()` 在 `recordNewGame` 之后调用 `onSessionStart(profile)`；`adaptiveSpawn.js` 把 `getActiveWinbackPreset()` 融入 `stress` cap 与 `spawnHints.{clearGuarantee, sizePreference}`，并把 `winbackProtectionActive: true` 写入 spawnHints + 私有诊断 `_winbackPreset`，方便 panel / 回放追踪"为何这一帧 stress 被压低"。
- **P0-C**：通过 `MonetizationBus` 的 `lifecycle:intervention` 事件解耦——dashboard 只产出 trigger 列表，订阅方决定如何呈现（推送 / 弹窗 / 任务奖励）。

**P1 阶段定义统一 + 死键修复**

- **`web/src/retention/difficultyAdapter.js`**：`_inferStage` 改为委托给 `playerLifecycleDashboard.getPlayerLifecycleStage`（AND 门）。旧 OR 实现会让"高频玩家（days=2, sessions=100）锁在 onboarding"、"长草玩家（days=60, sessions=8）推到 stability"——与 dashboard 完全相反；两套阶段并存导致同一玩家在 difficultyAdapter 与 adaptiveSpawn 被打成不同档，stress 调整互相抵消。保留 try/catch 兜底以 AND 门复刻，绝不回到旧 OR 语义。
- **`web/src/retention/playerMaturity.js`**：`getMaturityBand(skillScore)` 重写——独立于 L→M 表，按 SkillScore 阈值映射 `≥90→M4 / ≥80→M3 / ≥60→M2 / ≥40→M1 / 其它→M0`。此前 `MATURITY_BAND_MAP.L4='M3'`，导致 `lifecycleStressCapMap` 里所有 `S*·M4` 键永远是死键。新增 `M_BAND_THRESHOLDS` 常量。

**P2 商业化接 firstPurchaseFunnel + vipSystem + 三套 churnRisk 归一**

- 见上"策略层"`lifecycleAwareOffers.js`。三套 churnRisk 归一通过 `getUnifiedChurnRisk` 在数据层完成；商业化层只看 `snapshot.churn.unifiedRisk`，避免再次决策"信哪一套"。

**P3 API 兼容修复**

- **`web/src/playerAbilityModel.js`** 末尾新增 `getPlayerAbilityModel()` facade、`getPersona / getRealtimeState / getLTV` named exports。此前 `monetization/ad/adDecisionEngine.js`、`pushNotificationManager.js`、`paymentPredictionModel.js`、`analyticsDashboard.js` 4 个模块 import `getPlayerAbilityModel` 期望 `{ getPersona, getRealtimeState, getLTV }` 形态，但本文件从未导出该函数 → 4 个 import 在生产中要么 ReferenceError 被外层 try 吞、要么对应模块整体未启动。新适配器代理到 `personalization.getCommercialModelContext` + `ltvPredictor.getLTVEstimate`，任何字段缺失都返回稳定空骨架。

**`PlayerProfile` 三个统一 getter（v1.48 数据层裸字段）**

- `daysSinceInstall` —— 来自新增 `_installTs`（首次构造时为 now，`fromJSON` 兼容旧记录回填到最早 `sessionHistory[0].ts` / `savedAt` / now）。
- `totalSessions` —— `max(_totalLifetimeGames, _sessionHistory.length)`，与 `lifetimeGames` 区别详见 docstring。
- `daysSinceLastActive` —— 基于 `lastActiveTs`；`=0` 视作"今天活跃"，避免冷启动玩家被误判长草触发 winback。
- `lifecyclePayload` —— 三大裸字段一次性打包，所有 retention 模块（`getLifecycleMaturitySnapshot` / `getPlayerLifecycleStage` / `evaluateWinbackTrigger`）只用这一个 payload。
- `toJSON` / `fromJSON` 持久化 `installTs`。

**单测**

- `tests/lifecycleSignals.test.js`（新文件，19 项）：覆盖数据层字段完整性、三套 churnRisk 归一、PlayerProfile 三个统一 getter、orchestrator 接线（churn 写入 / winback 自动激活 / 保护轮自动退出 / 总线 emit / 全局开关）、lifecycleAwareOffers 总线订阅、`getMaturityBand` 死键修复。
- `tests/playerMaturity.test.js`：更新断言匹配新 `getMaturityBand(95)='M4'`、`getMaturityBand(85)='M3'` 行为，并显式覆盖 100 分边界。
- 全量 1112/1112 passed（原 1093 + 新增 19）。

**架构图（最终单向依赖）**

```
PlayerProfile + retention/* (源数据)
        ↓
lifecycle/lifecycleSignals.js (数据层：定义 / 归一 / 缓存)
        ↓
lifecycle/lifecycleOrchestrator.js (编排层：会话钩子 / 总线发送)
        ↓                       ↓                      ↓
adaptiveSpawn.js        lifecycleAwareOffers.js   pushNotificationManager.js
(出块策略层)            (商业化策略层)             (运营策略层)
```

详见新增的 [`docs/architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md`](docs/architecture/LIFECYCLE_DATA_STRATEGY_LAYERING.md)（架构专题）。

### Changed (v1.47 — 玩家能力指标 v2：7 项升级)
针对 v1 6 个 pill 的三个共性问题（信号冗余、信号闲置、阈值刻舟）做的一次性体检，对应用户提出的 7 项优化建议（按 P0/P1/P2/P3 排序）。
详细推导与公式见 [`docs/algorithms/ALGORITHMS_PLAYER_MODEL.md §13.7`](docs/algorithms/ALGORITHMS_PLAYER_MODEL.md)。
- **P0-1：`controlScore` 接入「反应」(`pickToPlaceMs`)**——v1.46 投入的"激活→落子"耗时
  终于进入闭环。`reactionScore = 1 - clamp((pickToPlaceMs - 350) / (2200 - 350))`，反应
  样本不足（< 3）时反应项不参与、其它四项权重按比例归一，避免冷启动伪精确。权重重平衡
  `miss 0.34 / cog 0.22 / afk 0.13 / apm 0.15 / reaction 0.16`，apmMax 14→18。
- **P0-2：`clearEfficiency` 接入多消深度 + 清屏稀缺事件**——把"消行密度"(clearRate)、
  "连消密度"(comboRate)、"单次行数"(avgLines)、**"多消深度"**(multiClearRate, lines≥2 占比)、
  **"清屏稀缺事件"**(perfectClearRate, fill→0 占比) 解耦为 5 项独立权重 0.40 / 0.18 / 0.14 / 0.18 / 0.10，
  让"光会拼单消"与"会做多消大爆发"的玩家显著拉开。
- **P1-3：`riskLevel` 接入填充加速度 + dock 锁死概率**——把"静态满"和"急速变满"、
  "还能落子"和"dock 全锁死"区分开。`boardFillVelocity` = 最近 5 步 fill 增量均值（仅取正向），
  `lockRisk = 1 - clamp(firstMoveFreedom/8)`。权重重平衡，新增两项各占 0.10 / 0.08。
  PlayerProfile 新增 `boardFillVelocity(N)` 方法；playerInsightPanel 调 `buildPlayerAbilityVector`
  时注入 `firstMoveFreedom`。
- **P1-4：`confidence` 接入近期活跃衰减**——`recencyDecay = exp(-days_since_last_active / 14)`，
  长草玩家 `lifetimePlacements` 仍很大但 30 天没玩 → recencyDecay≈0.117 → confidence 显著下降，
  让模型基线融合自动退化为"先信实时数据"。`profileWeight 0.65→0.55`、`lifetimePlacementsMax 80→200`，
  腾出 0.10 给 recencyDecay。PlayerProfile 暴露 `lastActiveTs` getter。
- **P2-5：阈值校准框架**——`shared/game_rules.json → playerAbilityModel.calibrationNote` 标注
  所有 `*_Max` 当前是基于产品体感的初始值，附 SQL 模板让运营离线跑 `move_sequences` 求
  P10/P50/P90 后回填，使全玩家分布大致 N(0.5, 0.15)，6 个 pill 不再压在中段失去判别力。
- **P2-6：各能力指标使用独立时间窗口**——`PlayerProfile.metricsForWindow(N)` 是 v2 新增 API，
  让 `controlScore` 看 8 步短窗（手感变化）、`clearEfficiency` 看 16 步中窗（机会积累）、
  `boardPlanning` 走瞬时（拓扑），不再被单一 `_window` 同时迟钝又过敏。窗口长度集中在
  `playerAbilityModel.windows`，AbilityVector 输出新增 `windows` 字段供调试与训练。
- **P3-7：UI 视觉分组 + 雷达 hover**——`ABILITY_METRIC_ROWS` 每行带 `tone`：
  能力/操作/消行/规划=positive 强势配色、风险=negative 红色基调（越低越安全）、
  置信=neutral 灰色基调（数据元）。hover 任意 pill 弹出 6 维 SVG 雷达浮层；风险轴在
  SVG 内被翻转为 `1-risk`，让"向外=好"的语义在所有 6 个轴上一致，玩家一眼看出强项 / 短板形状。
- **`AbilityVector.version` 1→2**：消费方（spawnModel / churnPredictor / 回放面板）能感知字段集合扩展；
  `vector.features` 新增 `reactionScore / pickToPlaceMs / multiClearRate / perfectClearRate /
  boardFillVelocity / lockRisk / recencyDecay / avgLines` 子分项，供 hover tooltip 与训练特征列。
- **小程序同步**：`miniprogram/core/gameRulesData.js` 同步 v2 全部配置；小程序端 ability vector
  自动随 shared 模型生效（无 JS 改动需要）。
- **测试**：`tests/playerAbilityModel.test.js` 新增 9 个 v2 专项测试用例（反应快/慢、多消、
  清屏、攀升风险、锁死、长草、向后兼容、独立窗口）。1093/1093 全绿。
- **文档**：`docs/algorithms/ALGORITHMS_PLAYER_MODEL.md` 新增 §13.7（v2 7 项升级）+ 重写 §15.6
  参数表 + 13.1 输出字段表加 `windows` / `features` 行 + 校准说明。

### Changed (v1.46.2 — 玩家洞察面板·指标网格紧凑布局)
- **`.replay-series-cell` 行高 22→18 px、`.series-spark-wrap` 14→14 px**：标签 / sparkline /
  数值在 18 px 行内更贴合（9 px 字体配合 `line-height:1`，留 4.5 px 上下气流），
  24 行指标节省 ~96 px 垂直空间。
- **`.replay-series-grid` 行 gap 2→1 px**：再省 ~24 px。
- **`.replay-series-group-head` 上下间距收紧** `margin: 6/1 → 3/0`、`padding: 1/2 → 0/1`、
  首组 `margin-top: 2 → 0`：5 个组头共节省 ~25 px。
- **`.replay-series-cell` 列宽 `3.2em / 1fr / 3.2em` → `2.8em / 1fr / 3em`**：
  标签 / 数值各让出 0.4em / 0.2em 给 sparkline，曲线变更宽，趋势更易读。
- **`.insight-state-row.insight-state-series` 容器内边距** `4/6/5 → 3/6/3`、
  `margin-top: 2 → 0`，再省 ~5 px。
- 总计：玩家洞察面板的实时指标网格区在不裁切任何信息的前提下垂直空间紧凑 ~150 px，
  让"盘面 6 / 玩家·能力 5 / 玩家·状态 4 / 系统·决策 2 / 系统·压力分量 7"全部 24 条曲线
  在常规视口下不需要滚动也能纵览。

### Changed (v1.46.1 — HUD 分数 burst 时长延长 + 飘字位置上移)
- **`HUD_SCORE_CONFIG.duration*` / `HUD_BURST_DURATION` 全档延长**：按玩家反馈调整——
  - 滚动：base 280→520 / per-log 90→180 / max 700→**1200 ms**（`+5` 约 630 ms、`+50` 约 1000 ms、`+500` 触顶 1200 ms）
  - 脉冲：small 360→**540** / medium 520→**800** / large 700→**1100 ms**，与滚动节奏相称、可看清
- **`+N` 飘字锚点从"分数中心"上移到"分数顶端再上 8 px"**：把 `top: rect.top + rect.height/2`
  改为 `top: rect.top - floatAnchorGapPx` + `translate(-50%, -100%)`——飘字底部对齐分数上沿，
  全程不与分数文字重叠，玩家可以同时看到滚动中的分数与飘字 `+N`。
- 相应：`floatRiseDistance` 28→44 px、`scoreFloatRise` 时长 900→1300 ms、
  小程序 wxss `scoreBurst*` keyframes 时长全部对齐。
- 单测同步：`hudDurationFor` 上限从 700→1200，新增"大 delta 时长 ≥ 小 delta × 1.5"用例。

### Added
- **v1.46 落子得分滚动 + 强化反馈**：把过去"分数瞬切"改为"按 delta 分档的滚动 + 脉冲 + 飘字 +N"，让玩家每次落子得分都能强感知。
  - Web HUD（`#score`）：`scoreAnimator.animateHudScoreChange` 在 `Game.updateUI` 里读上次显示值算 delta：
    - delta=0 / 减分 / 重开局 → 直接写入，不做反向动画（避免误反馈）
    - delta>0 → 启动 RAF 滚动（`animateValueOnElement`，easeOutExpo，自适应时长 280–700 ms）+ 按档位挂 `score-burst--small/medium/large`（scale 1.12 / 1.22 / 1.32 + 高亮 + 大档变金色 #fde047）+ 在分数元素上方飘 `+N` 字样上浮淡出。
    - 滚动被新一轮打断 → 用"当前帧值"作为新起点，不归零回拨（连消帧间连续）。
    - `prefers-reduced-motion` 用户：跳过滚动，仍发轻量 burst + 飘字（保留可感知反馈、避免眩晕）。
  - 小程序 HUD：`_onStateChange` 算 delta 后写入 `scoreBurstClass` 触发 wxss 同款 keyframes（scale + 颜色脉冲 + 大档金色光晕）；既有 `_showFloatScore` 飘字保留为消行专属强化。setData 节奏不变，避免逐帧滚动的开销。
  - RL 演示 / 回放跳帧路径：把 `_lastDisplayedScore` 与 `score` 同步赋值，跳帧不触发 burst（拖时间轴不会狂闪）。
  - 测试：`tests/scoreAnimator.test.js`（17 例）覆盖 `hudBurstTier` 三档分类、`hudDurationFor` 单调与上限钳制、`animateHudScoreChange` delta 各分支的 DOM 副作用、`animateValueOnElement` cancel/防御性。
- **v1.46 触屏拖拽·小幅手势即可落子（pointer ballistics 触屏化）**：把鼠标既有的"低速 1:1 / 高速放大"速度感知曲线下沉给触屏，配合"起手 boost + 释放容错放宽"，让玩家小幅拖动就能完成 dock→盘面→落子的完整链路。
  - 速度感知曲线（核心）：`web/src/dragPointerCurve.js → computeStepGain` 由 `velocityFactor + effectiveGain` 两个纯函数组合，覆盖鼠标 / 触屏共用。两端只是参数取值不同：
    - 鼠标：`MIN=1.0 / MAX=1.32 / SLOW=0.30 / FAST=1.50 px·ms⁻¹`（精细对位不变）
    - 触屏：`MIN=1.05 / MAX=1.7 / SLOW=0.10 / FAST=0.80 px·ms⁻¹`（指尖滑动慢、距离长，阈值整体下移、上限提高）
  - 起手 boost：`CONFIG.DRAG_TOUCH_BOOST_CELLS = 1.4`，触屏 `Game.startDrag` / 小程序 `onDockTouchStart` 在抓起候选块时给 `_extraOffset.y` 一次性向上偏移 ≈1.4 格，把"dock→盘面下缘"这段固定物理距离免掉。
  - 累计偏移上限：`DRAG_GAIN_MAX_OFFSET_CELLS` 3.0 → 6.0，避免快速一甩被钳住。
  - 释放容错半径：`PLACE_RELEASE_SNAP_RADIUS` 3 → 4 格（hover 半径仍为 2 保持预览精度）。
  - 小程序端同源同参 inline 复用：`miniprogram/pages/game/game.js → _touchControlPoint`（速度感知）+ `onDockTouchStart`（起手 boost）+ 顶部常量。
  - 测试：`tests/dragPointerCurve.test.js`（18 例）覆盖阈值边界、单调性、NaN/Infinity 回退、触屏 vs 鼠标省力差。

- **签到与里程碑服务端持久化（SQLite）**：在 `VITE_USE_SQLITE_DB=true` 时，每日签到、连登勋章、月度里程碑与 `openblock_skin_fragments_v1`（永久解锁列表、`lastEarnYmd` 等）通过 `GET/PUT /api/checkin-bundle` 与表 `user_checkin_bundle` 整包同步；换设备或清缓存后可在登录同一 `user_id` 时从服务端恢复（仍保留 localStorage 作为运行时缓存）。钱包（含 fragment 余额）继续走既有 `/api/wallet`。
- **v1.46 思考-反应双轨度量**：新增「反应」指标 `pickToPlaceMs`（startDrag → 落子的纯执行段，剔除观察 / 选块 / 等系统出块），与现有「思考」`thinkMs` 双轨呈现。
  - 录入：`PlayerProfile.recordPickup()`（由 `Game.startDrag` 入口调用）；`recordPlace/Miss` 与 `_pickupAt` 相减写入该 move。
  - 输出：`metrics.pickToPlaceMs / reactionSamples`、`PlayerStateSnapshot.metrics.pickToPlaceMs`、`REPLAY_METRICS.pickToPlaceMs`（面板 sparkline，紫蓝色 `#818cf8`，点击放大可看物理含义与曲线分析）。
  - 反馈链：纳入 `adaptiveSpawn → stressBreakdown.reactionAdjust`（钳值 ±0.05）—— 反应过快 → +stress 倾向 bored 加压；反应过慢 → −stress 倾向 anxious 减压；中段健康区 0；与 `nearMissAdjust` 同向时让位。门槛：`reactionSamples ≥ minSamples`（默认 3）才参与，避免冷启动 / 程序化路径噪声。
  - 配置：`shared/game_rules.json → adaptiveSpawn.reactionAdjust`（`enabled / minSamples / fastMs / slowMs / maxAdjust`），并同步 `miniprogram/core/gameRulesData.js` 镜像。
  - 文档：`docs/engineering/GOLDEN_EVENTS.md`（v1.2）、`docs/algorithms/ADAPTIVE_SPAWN.md`（信号表 + 数据录入接口）、`docs/player/STRATEGY_EXPERIENCE_MODEL.md`（v1.46 双轨章节）、`docs/player/REALTIME_STRATEGY.md`（事件 / metrics 表）。
- **v1.46 玩家洞察面板·几何指标曲线化 + 分组布局**：把原本只在 spawn 决策快照下方 pill 区显示的「平整 / 首手」升级为时间序列曲线，并把 sparkline 网格按"描述主体"分 5 组布局（盘面 / 玩家·能力 / 玩家·状态 / 系统·决策 / 系统·压力分量）。
  - `_spawnGeoForSnapshot()` 与 `buildPlayerStateSnapshot.spawnGeo` 新增 `flatness / firstMoveFreedom`，随 ps 一并入回放与 SQLite。
  - `REPLAY_METRICS` 新增 `flatness / firstMoveFreedom / reactionAdjust` 三条曲线；`topologyHoles / tripletSolutionCount` 由 `spawn` 组迁回 `game` 组（与盘面同主体）。
  - 修复 `_buildLiveSnapshotForSeries` 漏写 `pickToPlaceMs / reactionSamples / flatness / firstMoveFreedom`，导致实时面板对应曲线显示「—」的问题。
  - 面板分组小标题样式：`web/public/styles/main.css → .replay-series-group-head`；分组定义：`web/src/playerInsightPanel.js → METRIC_LAYOUT_GROUPS`（live + replay 路径共用）。
  - 决策快照下方 pill 区移除「平整 / 首手」重复显示（曲线已覆盖），保留"近满 / 多消候选 / 清屏候选 / 区间"等纯候选判定信号。

### Changed (v1.28 — ValidPerms Accuracy + Copy Simplification)
- **`evaluateTripletSolutions` 修复 `validPerms` 低估**：
  旧逻辑在 `solutionCount` 触发 `leafCap` 后直接停止遍历排列，导致 `validPerms` 可能被低估。
  新逻辑将“解法计数（受 cap 限制）”与“合法序判定（6 个排列独立可解性）”解耦：
  - `solutionCount/perPermCounts` 仍受 `leafCap` 控制，避免指数爆炸；
  - `validPerms` 即使在 `capped=true` 时也继续逐排列判定，避免误报“瓶颈块”。
- **文案精简与口径明确**：
  - `strategyAdvisor`「瓶颈块」提示改为短句；
  - `playerInsightPanel` 中 `解法数量/合法序` tooltip 明确为“本轮生成时”快照，减少与实时盘面的语义混淆。
- **测试补充**：`tests/blockSpawn.test.js` 新增用例，覆盖“`leafCap=1` 时 `validPerms` 仍可完整统计”。

### Changed (v1.26 — AdaptiveSpawn Live Geometry Override)
- **`adaptiveSpawn` 在决策前接入 live 几何覆盖（nearFull/multiClear）**：
  为减少“策略卡按 live+dock、而 adaptiveSpawn 仍读旧 ctx 快照”的时序偏差，新增
  `_mergeLiveGeometrySignals(ctx)`：
  - 当 `spawnContext._gridRef` 存在时，先用 `analyzeBoardTopology(grid)` 重算
    `nearFullLines`
  - `multiClearCandidates` 优先按 `_dockShapePool` 统计（若不可用回退全形状库）
  - 再覆盖进本轮 `ctx` 参与 `spawnIntent` / `rhythmPhase` / `multiClearBonus` /
    `multiLineTarget` 等判定
- **`game.js` 调用 `resolveAdaptiveStrategy` 时注入 `_gridRef` 与 `_dockShapePool`**
  （不污染持久 `_spawnContext`，仅单次调用上下文生效）。
- 新增测试：`tests/adaptiveSpawn.test.js` 覆盖“陈旧快照=0，但 live 网格具备 nearFull/multiClear”
  时仍可正确走 `spawnIntent='harvest'`。

### Changed (v1.25 — Multi-Clear Candidate Must Match Current Dock)
- **`playerInsightPanel` 的 `liveMultiClearCandidates` 改为 dock 优先统计**：
  旧版按 `getAllShapes()` 全形状库统计“可多消块种数”，会出现“策略提示有多消机会，
  但当前候选三块（dock）根本打不中”的体感偏差。新版优先只统计 `game.dockBlocks`
  中未放置块（玩家当下真能用的 3 块）里可达 `multiClear>=2` 的数量；仅在 dock 不可用
  时回退全形状库（兼容开局/测试桩）。这样「多消候选 N」pill 与策略建议均与当前候选块一致。

### Changed (v1.24 — Flow Narrative Phase Variants)
- **`stressMeter.SPAWN_INTENT_NARRATIVE.flow` 拆按 rhythmPhase 选变体表**：
  旧版 `flow` 文案硬编码"心流稳定，节奏进入收获期，准备享受多消快感。"，但 spawnIntent='flow'
  的触发条件是 `delight.mode === 'flow_payoff' || rhythmPhase === 'payoff'`——
  `delight.mode='flow_payoff'` 在 R1 空盘 + flow=flow + skill≥0.55 时也会成立，此时实际
  `rhythmPhase` 因 v1.21 的 `nearGeom` mutex 会 fall through 到 `'setup'`。结果三方对立
  （截图复现）：
  - story："心流稳定，**节奏进入收获期**…"
  - spawn 决策 pill：「节奏 **搭建**」+「意图 心流」
  - strategyAdvisor 卡：🏗️ **搭建期** + "稳定堆叠、预留消行通道"
  
  修复：新增 `FLOW_NARRATIVE_BY_PHASE` 变体表（payoff / setup / neutral 各一句），
  `buildStoryLine` 遇 `spawnIntent='flow'` 时按当前 `rhythmPhase` 选变体；rhythmPhase
  缺失时兜底 `SPAWN_INTENT_NARRATIVE.flow`（已去掉"收获期"硬编码改为通用文案
  "心流稳定，系统继续维持流畅的出块节奏。"）。其他 intent 仍走单一映射。
  新增 5 条 buildStoryLine 单测（setup/payoff/neutral 变体 + 兼容 + 不影响其他 intent）。

### Changed (v1.23 — Story Priority + Live-Geometry Harvest Card)
- **`stressMeter.buildStoryLine`：spawnIntent 永远优先（不再被 frust/recovery 绕过）**：
  v1.16 把 spawnIntent 设为最高优先级，但 gating 条件 `frust > -0.08 && recovery > -0.08`
  让 frustRelief 触发时绕过 `SPAWN_INTENT_NARRATIVE.relief`（"盘面通透又是兑现窗口…"），
  退回老严厉文案"检测到挫败感偏高"。v1.18 stressMeter label/vibe 已诚实化为
  「放松（救济中）」+「系统正在为你减压」，story 仍是"挫败感偏高"——同一面板三方拉扯
  （截图复现：label 友好 + vibe 友好 + story 严厉）。
  
  改为：`boardRisk ≥ 0.6` 仍让"保活"叙事抢占（极端硬信号），其余情况下 spawnIntent
  存在就直接用 `SPAWN_INTENT_NARRATIVE`。老严厉文案降级为"spawnIntent 缺失（pv=2 早期
  回放）的兼容兜底"。新增 4 条 buildStoryLine 单测覆盖优先级 + 兼容路径。
- **`strategyAdvisor`「💎 收获期」卡加 live 几何 mutex + 待兑现变体**：
  rhythmPhase 是 spawn 时锁定的快照，spawn 后玩家落了块（消了 / 没消），live 几何
  已经变化（multiClearCands→0、nearFullLines→0），此时仍说「积极消除拿分」是空头建议
  （截图复现：spawn 决策 多消 0.95 + 多线×2 + 目标保消 3，但 live 多消候选 0、近满 0，
  dock 是 4 块 volleyball L 形，根本无从兑现）。v1.20 已经给「多消机会/逐条清理/瓶颈块」
  3 张卡都加了 live 几何 mutex，本次补上「收获期」卡。
  
  当 `_liveMultiClearCands < 1 && _liveNearFull < 2` 时切诚实变体「💎 收获期·待兑现」+
  文案"上一次 spawn 锁定了'收获'节奏，但当前 dock 与盘面暂时没对上消行机会，先稳住手等
  下次 spawn 兑现。"；live 几何支持时仍出原「💎 收获期」卡。新增 4 条单测覆盖（live=0 切
  待兑现 / live=2 仍出原文案 / nearFull≥2 任一条满足即可 / 旧 panel 无 live 注入回退）。

### Changed (v1.22 — Card Mutex (Build vs Harvest) + Sparkline Help Decoder)
- **`strategyAdvisor`「规划堆叠」卡加 `harvestNow` 互斥**：
  v1.17 已为「提升挑战」卡加了 `harvestNow = (rhythmPhase==='payoff' || spawnIntent==='harvest')`
  的互斥（避免与「收获期」卡叙事拉扯），但同文件第 11 张「构型建议 → 规划堆叠」卡
  仍只看 `fill<0.3 && skill>0.5`，导致线上截图复现：rhythmPhase=payoff + 板面 30% +
  skill 78% 时一帧出现两张方向相反的卡——
  - 💎 收获期：「积极消除享分」（要求当下兑现）
  - 🏗️ 规划堆叠：「留出 1~2 列通道为后续做准备」（要求蓄力搭建）
  
  修复同样加 `&& !harvestNow` 闸，`payoff` / `harvest` 时跳过此卡，搭建/中性期仍
  保留长期建议。新增 3 条互斥单测（payoff 抑制 / harvest 单独抑制 / neutral 仍可触发）。
- **REPLAY_METRICS 19 条 sparkline tooltip 全量补「📈 看图」解读段**：
  原 tooltip 只解释"是什么"（指标定义），不解释"曲线怎么读"。新增统一的 `📈 看图：…` 段，
  说明：典型范围、上行/下行/平台/拐点的含义、与哪条相邻曲线互相印证、什么读数对应
  哪种 strategyAdvisor 卡 / spawnIntent 切换。覆盖：得分 / 技能 / 板面 / 消行率 / 压力 /
  F(t) / 动量 / 未消行 / 负荷 / 失误 / 思考 / 闭环 + 6 条 stress 分量（难度 / 心流 /
  松紧 / 救济 / 会话 / **挑战**）。
- **「挑战」(challengeBoost) sparkline tooltip 显式说明触发条件**：
  玩家常因看到曲线长期为 0 而怀疑指标失效。新 tooltip 写明：
  > 触发条件 `score ≥ bestScore × 0.8` 且 `stress < 0.7`，公式
  > `min(0.15, (score/best - 0.8) × 0.75)`。在到达 80% 阈值前曲线恒为 0 是预期；
  > 从 0 抬到正值说明你正在冲击新高、系统要把节奏推到"决赛圈"。同时会把
  > spawnIntent 切到 pressure。本局最佳为 0 时（首局）也恒为 0。
  
  机制本身（adaptiveSpawn.js:615-622 + v1.20 5 条单测）已健壮，本次只补叙事层。

### Changed (v1.21 — Phase Coherence + Snapshot Marker + Borderline Damping)
- **`adaptiveSpawn.deriveRhythmPhase`：`'setup'` 与 `'harvest'` 互斥兜底**：
  v1.17 加 `canPromoteToPayoff` 时只堵了 `'neutral'→'payoff'` 的提升路径，没堵
  `'setup'` 在有几何时被错误返回。线上截图复现：`pacingPhase='tension' &&
  roundsSinceClear=0 && nearFullLines>=2` 同时满足时 → 一帧出现 pill「节奏 搭建」+
  「意图 兑现」+ stress story「投放促清形状」+ strategyAdvisor「搭建期 稳定堆叠
  留通道」对立叙事。修复给 `'setup'` 分支加 `&& !nearGeom`：紧张期开头若几何
  已经支持兑现就 fall through 到 `'neutral'`、由后续 `canPromoteToPayoff` 升 `'payoff'`，
  与 `spawnIntent='harvest'` 同口径。
- **`playerInsightPanel._buildWhyLines(insight, profile)`：纯 live 量改 live 优先**：
  v1.20 已经把 pill 的 F(t) / 闭环反馈改 live，但策略解释段（`_buildWhyLines`）还在
  用 `insight.flowDeviation` / `insight.feedbackBias` / `insight.flowState`（spawn 快照），
  造成"sparkline F(t)=0.82 / pill 0.82 / 解释 0.78"三态打架。改为双参签名，
  纯 live 量优先 `profile.*`，spawn 决策类（spawnIntent / spawnHints / stressBreakdown / 
  strategyId / difficultyBias）继续读 `insight.*`。
- **`playerInsightPanel`：spawn 决策 pill 之前插入「📷 R{n} spawn 决策」marker**：
  spawn 决策类 pill（意图/目标保消/尺寸/多样/节奏/弧线/连击/多消/多线×/形状权重）
  与上方 live pill（压力/F(t)/闭环反馈/占用/救济通路）和下方 live 几何 pill
  （多消候选/近满/空洞/平整/解法/合法序）混排，玩家分不清"spawn 决策快照"与
  "live 实时状态"，于是看到「意图 兑现 + 多消候选 0」会误判为撞墙。
  插入虚线边框的 marker pill，hover tooltip 解释"spawn 后保持不变直到下次 spawn"，
  视觉上把两组分开。CSS 新增 `.insight-weight--snapshot`。
- **`playerProfile.flowState`：borderline 去抖**：旧版 `fd > 0.5 && clearRate > 0.4` 在
  玩家停留在阈值附近时会因 micro-sample 抖动反复在 'bored' / 'flow' 翻面，造成同帧
  snapshot=bored / live=flow 对不上。两条阈值各加 5% 缓冲（`fd > 0.55 && clearRate > 0.42`），
  borderline 默认 fall through 到 'flow'，单向偏好心流。

### Tests (v1.21)
- **`tests/adaptiveSpawn.test.js`** ：新增 2 条 v1.21 互斥测试
  （tension+roundsSinceClear=0+nearFullLines≥2 → 不再 setup；同条件无几何 → 仍 setup）。
- **`tests/playerProfile.test.js`** ：新增 1 条 borderline 去抖测试
  （fd≈0.52 + clearRate=0.41 紧贴旧阈值上方 → 不再 bored，fall through 到 flow）。
- v1.20 基线 766 → v1.21 **769** 测试，全绿；lint / build / bundle 预算通过

### Changed (v1.20 — Live/Snapshot Alignment + Label Decoupling)
- **`strategyAdvisor`：多消机会卡 / 瓶颈块卡改读 live 几何（替代 spawn 快照）**：
  v1.18 引入 `nearFullLines` / `multiClearCandidates` 双卡分流后，仍走 `diag.layer1.*`
  即 spawn 时快照。玩家在 spawn 后放过 1~3 块、几何已变（清掉了一行 / 已经放完
  多消候选块）时，策略卡仍按"4 个多消放置 + 3 接近满行"叙述，而面板 pill
  「多消候选 N」走 live 算 0，两者撞墙。
  v1.20 让 `playerInsightPanel` 把 `liveTopology` + `liveMultiClearCandidates` 注入
  `gridInfo`，`strategyAdvisor` 优先读 live、回退 snapshot；`_liveNearFull` /
  `_liveMultiClearCands` 两个变量统一卡内引用，避免再次混用。
- **`playerInsightPanel`：F(t) / 闭环反馈 pill 改读 PlayerProfile live**：
  原本 `F(t) <pill>` 读 `ins.flowDeviation`（spawn 时快照）、左侧 sparkline 末点读
  `profile.flowDeviation`（live），同一帧出现 0.59 vs 0.47 的 0.12 量级偏差。
  v1.20 起两侧统一读 PlayerProfile.live；spawn 决策类字段（`spawnIntent` / 
  `multiClearBonus` 等）仍读 `ins.*` 维持 spawn 时一致。
- **`moveSequence`：sparkline `pacingAdjust` 标签 「节奏」→「松紧」**：
  v1.17 把 `pacingPhase` UI 标签解耦成「Session 张弛」，但 sparkline 还在用
  「节奏」展示 `pacingAdjust`，结果与右侧 `spawnHints.rhythmPhase` pill「节奏 收获」
  再次撞名（两者一个是相位枚举、一个是数值偏移）。本次改为「松紧」，并在
  `stressMeter.SIGNAL_LABELS.pacingAdjust` 同步更名 + tooltip 说明二者区别。

### Tests (v1.20)
- **`tests/adaptiveSpawn.test.js`** ：填补 `challengeBoost` 触发 4 条件单测覆盖
  （v1.19 之前 0 测试）—— 不触发（`score < 0.8 * bestScore`、`bestScore = 0`）+
  触发幅度（`min(0.15, (ratio-0.8) * 0.75)` 公式校验）+ `spawnIntent='pressure'`
  联动；共 **5** 条新增。
- v1.19 基线 761 → v1.20 **766** 测试，全绿；lint / build / bundle 预算通过

### Changed (v1.19 — Geometry-Honest Spawn Bias)
- **`adaptiveSpawn`：`multiClearBonus` / `multiLineTarget` 几何兜底（v1.17 cg 兜底姊妹补丁）**：
  在所有偏好规则之后加一道软封顶 —— 当
  ① 当前盘面 `multiClearCandidates < 1`
  ② `nearFullLines < 2`（连"清一条剩两条"都做不到）
  ③ 不是真 perfect-clear 窗口（`pcSetup ≥ 1` 但 `fill < PC_SETUP_MIN_FILL` 是噪声）
  ④ 不在 warmup 阶段，且未触发 AFK engage
  四条同时成立时，把 `multiClearBonus` 软封顶到 0.4、`multiLineTarget` 归 0。
  避免出现 `playstyle='multi_clear'`、`pcSetup` 噪声、或 v10.x 偏好继承等
  路径把 bonus 顶到 0.65～0.75，但盘面物理上根本不可能多消，导致 dock 里
  全是长条 + 玩家落地后只能触发单行消除，「明显多消导向」与现实脱钩。
  **保留对 cg 兜底的语义对称**：cg 是「承诺」必须可兑现，warmup/AFK 也要兜底；
  multiClearBonus/multiLineTarget 是「偏好」可以前瞻，warmup/AFK 显式豁免。
- **`playerInsightPanel`：救济 pill 自动化为 top-N 负贡献（替代 v1.18 硬编码三件套）**：
  v1.18 把 `frustrationRelief` / `recoveryAdjust` / `nearMissAdjust` 三个分量直接 pill 化，
  解决了"为什么 stress 这么低"的可解释性问题，但只覆盖 3 条救济。当 `spawnIntent='relief'`
  来自 `delight.mode` / `flowAdjust` / `pacingAdjust` / `friendlyBoardRelief` 等其他
  减压源时，三件套全为 0，玩家依然看不出谁在救济。
  改为复用 `stressMeter.summarizeContributors`，从 `stressBreakdown` 自动挑出当前帧
  贡献最大的 **top 2 负向分量**（绝对值 ≥ 0.04），标签 + tooltip 直接复用 `SIGNAL_LABELS`，
  覆盖所有 17 条救济/加压通路。

### Tests (v1.19)
- **`tests/adaptiveSpawn.test.js`** ：新增 5 个 v1.19 兜底用例（`playstyle=multi_clear` 无几何 → 兜底；
  `nearFullLines ≥ 2` 不触发；`multiClearCandidates ≥ 1` 不触发；warmup 豁免；低 fill + pcSetup=1 噪声触发）。
  并把 `multiLineTarget is 2 when pcSetup>=1` 的 fill 从 0.4 提到 0.5（≥ PC_SETUP_MIN_FILL 的真窗口）。
- **`tests/playstyle.test.js`** ：把 `perfect_hunter` / `multi_clear` 两个 multiClearBonus 期望
  补上 `nearFullLines: 2` 上下文 —— 玩家偏好不应单独把 bonus 顶到 0.85/0.65，需要盘面真有兑现机会。
- v1.18 基线 756 → v1.19 **761** 测试，全绿；lint / build / bundle 预算通过

### Added (v1.18 — Narrative Granularity)
- **`stressMeter.getStressDisplay(stress, spawnIntent)` —— 救济变体头像/文案**：
  当 `spawnIntent==='relief'` 且 stress 已被压到 ≤ −0.05（落入 calm 档）时，
  原本的「😌 放松 / 盘面整洁，心情舒缓」改为 **「🤗 放松（救济中）/
  系统正在为你减压…」**。解决"😌 放松"+"挫败感偏高"叙事撞车的问题，
  让玩家理解"我现在轻松，是因为系统正在帮我"。easy/flow 等中性档不切，
  避免过度提示。
- **`strategyAdvisor`：瓶颈块预警卡（v1.18）**：当 `solutionMetrics.validPerms ≤ 2`
  且 `fill ≥ 0.4`（解法度量已激活）时，弹「⏳ 瓶颈块」卡（priority 0.86），
  提醒玩家"先放可放置位最少的那块、别再贪连击"。文案带出 `firstMoveFreedom`
  辅助定位瓶颈。
- **`playerInsightPanel`：救济三分量 pill**：把 `stressBreakdown.frustrationRelief
  / recoveryAdjust / nearMissAdjust` 直接以紧凑 pill 形式（`挫败救济 −0.12 /
  恢复 −0.08 / 近失 −0.04`）暴露给玩家，不必再从故事线里倒推"现在 stress 是
  被哪条救济压下去的"。仅在分量 |v| ≥ 0.02 时显示，避免噪声铺屏。

### Changed (v1.18 — Narrative Granularity)
- **`strategyAdvisor` 多消机会卡分两文案** —— 旧版只要 `nearFullLines ≥ 3` 就
  鼓动"选择能同时完成多行的位置 / 争取大分"，但盘面 `multiClearCandidates < 2`
  时物理上无法多消。现在按几何兜底分两条：
  - `multiClearCands ≥ 2` → 沿用「🎯 多消机会」原文案 + 拼接候选数
  - `multiClearCands < 2` → 改为「✂️ 逐条清理：暂无多消组合，先把最容易消的
    那条清掉，缓解压力」
- **`PlayerProfile.flowState` 复合挣扎检测** —— 旧版要求 `F(t) ≥ 0.25` 才进入
  方向判定，会漏掉「思考 4 秒 + 失误 13% + 板面 58% + 消行率 25%」这种**单一阈值
  都没踩穿、但多个弱信号同时成立**的挣扎场景。新增前置判定：
  ```js
  const struggleSignals =
    (m.missRate > 0.10 ? 1 : 0)
    + (m.thinkMs > thinkTimeStruggleMs (3500) ? 1 : 0)
    + (m.clearRate < 0.30 ? 1 : 0)
    + (avgFill > 0.55 && m.clearRate < 0.40 ? 1 : 0);
  if (struggleSignals >= 3) return 'anxious';
  ```
  阈值刻意宽松，每条都是"轻度负面"，必须 ≥3 条同时成立才生效，避免误报。
  新增可调键 `flowZone.thinkTimeStruggleMs`（默认 3500ms）。

### Tests (v1.18)
- `tests/stressMeter.test.js` (+5)：`getStressDisplay` 在 calm + relief 时切变体；
  easy / flow 区不切；其它意图沿用基础档；未提供 intent 沿用基础档。
- `tests/strategyAdvisor.test.js` (+5)：多消机会 ↔ 逐条清理 分支；
  validPerms ≤ 2 + fill ≥ 0.4 弹「瓶颈块」高优先级卡；validPerms 充裕不弹；
  fill < 0.4 不报（避免冷启动误报）。
- `tests/playerProfile.test.js` (+2)：复合挣扎四信号 ≥3 → anxious；
  单一信号成立 → 不升 anxious。
- v1.17 基线 744 → v1.18 **756** 测试，全绿；lint / build / bundle 预算通过
  （index 231 KB / meta 325 KB / rl 72 KB）。

### Changed (v1.17 — Pressure-Strategy Coherence Patch)
- **`playerInsightPanel`：拆开"节奏相位"双重含义** —— v1.16 之前 UI 上同时
  存在两条都叫「节奏相位」的文案：紧凑 pill `节奏 收获` 来自
  `spawnHints.rhythmPhase`（setup/payoff/neutral，per-spawn），策略解释段
  `节奏相位：紧张期` 来自 `PlayerProfile.pacingPhase`（tension/release，
  session 周期内的张弛位置）。同名异义会被玩家视为系统自相矛盾。
  - `_pacingExplain()` 与 `TOOLTIP.pacing` 改写为 **「Session 张弛」** 专指
    `pacingPhase`；`spawnHints.rhythmPhase` 保留 `节奏相位` 的称谓。
- **`adaptiveSpawn`：harvest / payoff 几何兜底** —— `pcSetup ≥ 1` 在低占用
  盘面（如 17% 散布）经常是噪声，但旧逻辑会无条件把 `spawnIntent='harvest'` /
  `rhythmPhase='payoff'` 拉满，于是 stressMeter 报「密集消行机会」、出块
  推 1×4 长条、strategyAdvisor 弹「收获期」，**而盘面其实根本没有任何近满
  行**。
  - 新增模块常量 `PC_SETUP_MIN_FILL = 0.45`。
  - `spawnIntent='harvest'` 现在要求 `nearFullLines ≥ 2` **或**
    `(pcSetup ≥ 1 && fill ≥ PC_SETUP_MIN_FILL)`。
  - `deriveRhythmPhase` 与主路径 `pcSetup ≥ 1` 分支同口径门控。
  - `delight.mode='challenge_payoff'/'flow_payoff'`、`playstyle='multi_clear'`、
    `afkEngage` 等"基于玩家状态"的 `payoff` 升级现在统一通过
    `canPromoteToPayoff = nearFullLines ≥ 1 || multiClearCands ≥ 1 ||
    (pcSetup ≥ 1 && fill ≥ PC_SETUP_MIN_FILL)` 兜底，避免出块偏向
    与 UI 叙事在空盘面上撒谎。
- **`adaptiveSpawn`：clearGuarantee 物理可行性兜底** —— `cg=3` 由 `warmup wb=1` /
  `roundsSinceClear ≥ 4` 顶上来时承诺"本轮强制 ≥3 块能立刻消行"。但若
  `multiClearCandidates < 2 && nearFullLines < 2`，盘面物理上无法兑现这条
  承诺，UI pill 「目标保消 3」即变成空头支票。新增最终兜底：当 `cg ≥ 3`
  且盘面无几何支撑时回钳到 `2`，仍保持友好出块语义但不撒谎。
- **`strategyAdvisor`：收获期 ↔ 提升挑战 互斥** —— 同面板上同时出现
  「💎 收获期：积极消除拿分」与「🚀 提升挑战：构建 3 行+ 同消」两条
  互相拉扯的目标（一个让玩家"现在兑现"，一个让玩家"蓄力搭建"）。
  当 `rhythmPhase==='payoff'` 或 `spawnIntent==='harvest'` 时不再追加
  「提升挑战」卡。同时盘面太稀（`fill < 0.18`）也不再推「3 行+」目标，
  因为多线候选物理上接近 0。

### Tests (v1.17)
- `tests/adaptiveSpawn.test.js` (+6)：低占用 + pcSetup=1 不再触发 harvest /
  rhythmPhase=payoff；高占用 + pcSetup=1 仍 harvest；nearFullLines=2 单独触发
  harvest；warmup 起手在空盘面 cg 兜底回钳 ≤2；multiClearCandidates ≥2 时
  cg=3 维持；cross-game warmup 测试样本补 `nearFullLines: 2`。
- `tests/strategyAdvisor.test.js` (+4，新文件)：rhythmPhase=payoff 时不出
  「提升挑战」；rhythmPhase=neutral + 中等占用仍出该卡；fill<0.18 抑制；
  spawnIntent=harvest 单独也能抑制。
- v1.16 基线 734 → v1.17 **744** 测试，全绿；lint / build / bundle 预算通过
  （index 231 KB / meta 323 KB / rl 72 KB）。

### Added (v1.16 — Pressure-Strategy Coherence)
- **`web/src/boardTopology.detectNearClears(grid, opts)`**: 「近完整行/列」检测的
  单一来源（返回 `{ rows, cols, nearFullLines, close1, close2 }`）。
  `analyzeBoardTopology` 与 `bot/blockSpawn.analyzePerfectClearSetup`
  现在共享同一实现，避免「近满 N」与 `pcSetup`/`multiClearCandidates`
  在不同视图下走调（这是 v1.15 之前 stress=0.89 + 多消候选=0 + 闭环=+0.190
  三者互相矛盾的根因）。
- **`adaptiveSpawn._stressBreakdown.occupancyDamping`**: 在 stress clamp
  之后、smoothing 之前对正向 stress 乘 `clamp(boardFill/0.5, 0.4, 1.0)`。
  低占用盘面（如 fill=0.39）的伪高压由 0.89 → ~0.69，进入 `tense` 而非
  `intense`。负向 stress（救济）不被衰减。
- **`spawnHints.spawnIntent` 枚举**：`relief / engage / pressure / flow /
  harvest / maintain` —— 出块意图的单一对外口径。`stressMeter.buildStoryLine`、
  `monetization/personalization.updateRealtimeSignals`、回放标签都读这同
  一字段，不再各自推断；同时通过 `_lastAdaptiveInsight.spawnIntent` 暴露
  给 panel。
- **AFK 召回路径 (`engage`)**: `adaptiveSpawn` 在 `profile.metrics.afkCount ≥ 1`
  且 `stress < 0.55`、无救济触发时，主动提升 `clearGuarantee≥2 / multiClearBonus≥0.6 /
  multiLineTarget≥1 / diversityBoost≥0.15` 并把 rhythmPhase 从 `neutral`
  切到 `payoff`，给玩家「显著正反馈 + 可见目标」而非纯泄压。
- **`stressMeter.SPAWN_INTENT_NARRATIVE`**: spawnIntent → 玩家叙事的单一映射，
  `buildStoryLine` 优先取该映射；只在 `boardRisk≥0.6` 或挫败/恢复主导时被覆盖。
- **`playerInsightPanel` 新增「意图」pill**：直接显示当前 spawnIntent；
  「闭环」改名为「闭环反馈」并刷新 tooltip，明确强调它衡量「近期奖励是否
  高于预期」，与「近满 N / 多消候选」无关。

### Changed (v1.16 — Pressure-Strategy Coherence)
- **`PlayerProfile.momentum` 加噪声衰减**：在样本置信度之外再乘 `noiseDamping =
  clamp(1 - (var_old + var_new), 0.5, 1)`（伯努利方差噪声）。两半区
  接近 50/50 时 momentum 被收窄到原值的 0.5，避免「我状态稳定，UI 却显示
  动量 +1」。文档同时澄清 momentum **完全基于消行率**而非分数增量。
- **`monetization/personalization.updateRealtimeSignals(profile, extras?)`**：
  新增第二参数 `extras.spawnIntent`，由 `commercialInsight` 在 `spawn_blocks`
  事件中传入，实现策略文案与出块意图同源。

### Tests (v1.16)
- **`tests/boardTopology.test.js` (新增 6)**：detectNearClears 空盘 / close1 /
  close2 / requireFillable / 与 analyzeBoardTopology 一致 / maxEmpty。
- **`tests/adaptiveSpawn.test.js` (新增 8)**：occupancyDamping 衰减 /
  救济场景不衰减 / harvest intent / relief intent / AFK engage 提升 hints /
  AFK engage 让位 relief / momentum 噪声衰减 / spawnIntent 始终落入合法枚举。
- **总测试数**：720 → **734**（全部通过）。

### Added (v1.15)
- **Observability — metrics**: `services/common/metrics.py` (Prometheus
  Flask exporter); auto-attached to user / game / analytics services;
  monitoring service keeps its bespoke `/metrics`. Per-app
  `CollectorRegistry` so multiple apps in one process don't collide.
  Standard latency buckets (5ms..30s).
- **Observability — tracing**: `services/common/tracing.py` (OpenTelemetry
  SDK + Flask + requests + SQLAlchemy auto-instrumentation). Default
  is no-op; ship via OTLP/HTTP by setting
  `OTEL_EXPORTER_OTLP_ENDPOINT`.
- **API documentation**: `services/user_service/openapi.py` (apispec +
  marshmallow). Spec at `GET /openapi.json`, Swagger UI at `GET /docs`.
  Routes carry YAML docstrings; reusable schemas in
  `components/schemas`.
- **Database layer**: `services/common/orm.py` (SQLAlchemy 2.0 base +
  engine factory + `session_scope` helper).
  `services/user_service/orm_models.py` (`UserOrm`, `SessionOrm`).
  `services/user_service/sql_repository.py` (`SqlUserRepository`) — same
  interface as `_MemoryRepo`, plug-in via `USE_POSTGRES=true`.
- **Alembic**: `services/alembic.ini`, `services/migrations/env.py`,
  baseline revision `e0ef3caf345f` covering `users` + `user_sessions`.
  CI fails on schema drift via the `alembic-check` job.
- **k8s manifests**: `k8s/base/{namespace,configmap,secret,user,game,analytics,monitoring,ingress}`.
  All deployments use non-root, read-only-rootfs, `cap_drop=ALL`,
  seccomp `RuntimeDefault`, HPA on user + game.
- **Helm chart**: `k8s/helm/openblock/` with `values.yaml`, templated
  Deployment / Service / HPA / ConfigMap / Ingress.
- **nginx hardening**: `services/nginx.conf` rewritten with
  per-route `limit_req` zones (auth/payment/api), security headers,
  per-upstream circuit breaker (`max_fails`/`fail_timeout`), JSON
  access log, `auth_request` subrequest hook to `/api/auth/verify`,
  TLS termination block scaffolded behind `# tls` markers.
- **Web bundle splitting**: `vite.config.js` `manualChunks` cuts the
  main `index.js` from 500 KB → 230 KB (-54%). New chunks: `meta`
  (player insights, monetization, panels) and `rl` (bot training).
  Enforced by `scripts/check-bundle-size.mjs` in CI.
- **Tests**: `services/tests/test_metrics.py`, `test_tracing.py`,
  `test_openapi.py`, `test_sql_repository.py`. Total 69 services tests
  passing.
- **CI**: `bundle-size` step in the web job, `alembic-check` job
  (autogenerate diff must be empty).
- **Docs**: `docs/operations/OBSERVABILITY.md`,
  `docs/operations/K8S_DEPLOYMENT.md`. Updated `DEPLOYMENT.md`,
  `ARCHITECTURE.md`.
- **Dependencies** (`services/requirements.txt`): `alembic`,
  `prometheus-flask-exporter`, OpenTelemetry stack
  (`opentelemetry-api`, `opentelemetry-sdk`,
  `opentelemetry-instrumentation-{flask,requests,sqlalchemy}`,
  `opentelemetry-exporter-otlp-proto-http`), `apispec`,
  `apispec-webframeworks`, `marshmallow`.

### Added (v1.14)
- **services/Dockerfile.{user,game,analytics,monitoring}**: production-grade
  container images using `python:3.11-slim`, non-root `app` user, and
  HEALTHCHECK against `/health`.
- **services/.env.services.example**: template for the secrets that
  `services/docker-compose.yml` now requires (all `${VAR:?...}` style).
- **services/security/jwt_tokens.py**: JWT (PyJWT) issuance + verification
  with refresh rotation, pluggable `RevocationStore` and required claims.
- **services/security/password.py**: Argon2id password hashing module
  (`PasswordHasher.hash` / `verify` / `needs_rehash`) with OWASP defaults.
- **services/security/rate_limit.py**: pluggable `RateLimitBackend` API
  with `InMemoryBackend` (dev) and `RedisBackend` (production, atomic Lua).
- **services/tests/**: pytest suites for encryption, password, JWT,
  payment, rate limit and the user-service Flask app (in-memory repo).
- **.github/dependabot.yml**: weekly updates for npm, pip, Docker and
  GitHub Actions.
- **CI**: new `python-services` (pytest + pip-audit), `npm-audit`,
  `docker-compose-config` jobs in `.github/workflows/ci.yml`.
- **SECURITY.md**, **CHANGELOG.md**, **CODE_OF_CONDUCT.md**,
  **.github/CODEOWNERS**, PR / Issue templates.
- **docs/operations/SECURITY_HARDENING.md** and
  **docs/operations/DEPLOYMENT.md** describing the v1.14 production posture.

### Changed
- **services/security/encryption.py**: replaced XOR + Base64 obfuscation
  with **Fernet** (AES-128-CBC + HMAC-SHA256). The previous scheme is
  retained as `LegacyXorEncryptor` for one-shot migration only and its
  `encrypt()` is disabled.
- **services/security/payment.py**: removed the silent fall-back to a
  hard-coded `payment_secret`. `PaymentVerifier` now raises
  `PaymentConfigError` if `PAYMENT_SECRET_KEY` is missing or shorter than
  32 chars.
- **services/user_service/app.py**: rewritten on top of Argon2id +
  JWTs. `/api/auth/login` now actually verifies passwords and returns a
  JWT pair; `/api/auth/refresh` rotates refresh tokens and revokes the
  old one; `/api/auth/verify` exposes a token-introspection endpoint for
  the gateway.
- **services/docker-compose.yml**: every credential is sourced from
  `.env`, Postgres + Redis publish through configurable host ports, and
  Redis now requires `--requirepass`. `depends_on` waits on healthchecks.
- **server.py**: CORS now defaults to a tight allow-list (vite dev
  origins) and is configurable via `OPENBLOCK_ALLOWED_ORIGINS`. The
  `/api/db-debug/*` endpoints default to **disabled**; set
  `OPENBLOCK_DB_DEBUG=1` to opt in for local debugging.
- **requirements.txt** + **services/requirements.txt**: pinned versions
  for `argon2-cffi`, `cryptography`, `PyJWT`, `redis`, `structlog`,
  `prometheus-client`, `sentry-sdk[flask]`.

### Security
- **CVE class fixed**: insecure default secret in payment callback
  verification (forgeable callbacks).
- **CVE class fixed**: weak password hashing (sha256, no salt).
- **CVE class fixed**: opaque random tokens replaced with revocable JWTs.
- **CVE class fixed**: wildcard CORS replaced with allow-list.
- **CVE class fixed**: SQLite debug API exposed by default.
- **Hardening**: encryption requires explicit key; in-memory rate limit
  emits a warning so operators notice in multi-replica deployments.
