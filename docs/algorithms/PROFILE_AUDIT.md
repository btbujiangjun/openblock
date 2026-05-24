# 玩家画像指标自评估与自我优化

> 目标：把"画像指标的口径和算法是否健康"从主观体感变成可重复跑的可执行检查，
> 让任何一局回放都能给出**结构化报告 + 优化建议**，与 SPAWN_EVALUATION 形成姊妹工具。

## 1. 一句话概览

```
move_sequences.frames
   │
   ▼
collectReplayMetricsSeries / densifySeries   ←  REPLAY_METRICS 24 项指标按 idx 密致化
   │
   ▼
profileAudit 四层评估（A→D）
   ├── A 单指标质量：coverage / 冷启动 / 越界 / 抖动 / 基础统计
   ├── B 指标对关系：Pearson + Spearman，识别冗余对
   ├── C 时序行为：趋势 / 自相关 / 首半 vs 末半均值差
   └── D 自适应链路：stress 主导分量 / 闭环反馈滞后相关 / spawnIntent 切换频率
        │
        ▼
profileAuditContracts.eval  ←  9 条"业务约定即代码"契约
        │
        ▼
profileAuditHints.buildHints → { error / warn / info, code, msg, metrics }
        │
        ▼
summarizeHealthScore → 健康分 0-100
```

## 2. 工具入口

### CLI

```bash
# 单局 frames JSON
npm run profile:audit -- --frames .cursor-stress-logs/session-456.json --pretty

# 多局聚合（JSON 内容是 [{frames:[...]}, ...]）
npm run profile:audit -- --sessions runs/all.json --out .cursor-stress-logs/audit.json

# 直连 SQLite（需要 `npm i -D better-sqlite3`）
npm run profile:audit -- --sqlite .cursor-data/openblock.db --session-id 42 --pretty

# 近 N 天聚合（扫近 7 天所有 session，输出违规率排行 + 健康分分布）
npm run profile:audit -- --sqlite .cursor-data/openblock.db --db-recent 7 --pretty

# 对照分析：current vs baseline，触发 REGRESSION_/IMPROVEMENT_ hints
npm run profile:audit -- --frames new.json --baseline old.json --pretty --ci

# CI 模式：单局有 error / 聚合有 topRegressions 时退出码 2
npm run profile:audit -- --frames runs/last.json --ci
```

输出说明：
- 默认输出 JSON 到 stdout
- `--out` 写入 JSON 文件
- `--pretty` 额外打印"健康分 + Top 12 hint"摘要到 stderr，JSON 仍走 stdout（可管道）
- `--ci` 报告中存在 `severity=error` 时退出码 `2`，便于 CI 拉警

### 库引用

```js
import { auditProfile, aggregateAuditReports } from './web/src/audit/profileAudit.js';

const report = auditProfile(frames);   // 或多局 [{ frames }, ...]
console.log(report.healthScore);
for (const h of report.hints) {
    console.log(`[${h.severity}] ${h.code}: ${h.msg}`);
}

// 对照分析
const report2 = auditProfile(currentFrames, { baseline: baselineFrames });
console.log(report2.comparison.healthScoreDelta);  // 例如 -23
// 触发 REGRESSION_CONTRACT / IMPROVEMENT_CONTRACT / HEALTH_SCORE_REGRESSION 等额外 hints

// 跨局聚合
const agg = aggregateAuditReports([report1, report2, report3]);
console.log(agg.topRegressions);    // 违规率 ≥ 25% 的契约（≥3 局）
console.log(agg.hintCounts);         // 最频繁 hint Top
```

### Web 可视化页

启动开发服务后访问：

```
http://localhost:3000/profile-audit.html
```

或从首页菜单进入「🩺 画像指标自评估」。功能：

| Tab | 用途 |
|---|---|
| **单局 Audit** | 选 session → Worker 跑 audit → 渲染契约/hint/链路 → 一键上传到 SQLite |
| **对照分析** | 选 current + baseline 两个 session → 双 audit → 高亮 REGRESSION/IMPROVEMENT 契约 |
| **聚合视图** | GET `/api/profile-audit/recent?days=N` → 违规率排行 + 健康分分布 + hint 频次 + stress 主导分布 |

页面用 Worker（`web/src/profileAudit.worker.js`）跑 audit，不阻塞主线程；Worker 不可用时退回主线程同步跑。

### 服务端 API

`server.py` 提供 5 个端点（audit 计算仍在客户端，server 只做存储 + 聚合）：

| 方法 | 路径 | 用途 |
|---|---|---|
| `POST` | `/api/profile-audit/<session_id>` | 客户端跑完上传报告 |
| `GET` | `/api/profile-audit/<session_id>` | 读取已缓存的报告 |
| `DELETE` | `/api/profile-audit/<session_id>` | 删除缓存（调试用） |
| `GET` | `/api/profile-audit/sessions?user_id=&limit=100&days=` | 列出可 audit 的 session 元数据（不含 frames），标注 `hasAudit` 让 UI 区分已跑/未跑；省略 `user_id` 需 `OPENBLOCK_DB_DEBUG=1` |
| `GET` | `/api/profile-audit/recent?user_id=&days=7&limit=200` | 跨局聚合：违规率排行 / 健康分分布 / hint 频次 / stress 主导分布 |

存储表 `profile_audits`（见 server.py `_migrate_schema`）：

```sql
CREATE TABLE profile_audits (
    session_id INTEGER PRIMARY KEY,
    user_id TEXT,
    schema INTEGER NOT NULL,
    health_score INTEGER,
    passed_contracts INTEGER,
    failed_contracts INTEGER,
    hint_errors INTEGER,
    hint_warns INTEGER,
    hint_infos INTEGER,
    report TEXT NOT NULL,           -- 完整 audit report JSON
    updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);
CREATE INDEX idx_profile_audits_user_updated ON profile_audits(user_id, updated_at DESC);
CREATE INDEX idx_profile_audits_health ON profile_audits(health_score);
```

索引列允许 `/recent` 端点不解析 `report TEXT` 也能做基础排序。

### 设计取舍：为什么 server.py 不直接计算 audit？

audit 逻辑唯一来源在 `web/src/audit/profileAudit.js`（JS 库），server.py 不复刻：

| 选项 | 取舍 |
|---|---|
| ✅ 客户端跑 + server 存（采用） | 单源真理；规则演进无双源同步成本；Web/CLI/server 共用同一份契约 |
| ❌ server.py 子进程调 Node CLI | vite SSR 启动太慢（几秒），不适合实时 API |
| ❌ server.py 用 Python 复刻 audit 逻辑 | 双源维护成本高（契约/hint 变更要改两遍） |

## 3. 四层评估

### A — 单指标质量

对每个 REPLAY_METRICS 指标独立体检：

| 字段 | 含义 | 触发的 hint |
|---|---|---|
| `coverage` | 有效采样数 / 总帧数 | `COVERAGE_TOO_LOW`（< 10%）/ `COVERAGE_LOW`（< 30%） |
| `stats` | min / max / mean / median / stddev | （供其他层使用，不直接 hint） |
| `jitter` | `medianAbsDiff` + `maxAbsDiff` | `METRIC_JITTERY`（rel jitter > 1.0）/ `METRIC_NOISY`（> 0.5） |
| `outOfRange` | 越界帧数 + 首次越界 idx | `OUT_OF_RANGE`（按 rate 分级） |
| `trendSlope` / `trendHalvesDiff` / `autocorrLag1` | 时序方向感（供 C 层叠加） | — |

**范围约束**集中在 `profileAudit.js` 的 `DEFAULT_RANGE_BY_KEY`，覆盖 24 项指标的预期边界（如 `boardFill ∈ [0,1]`、`stress ∈ [0,1]`）。新增指标若有强范围请补充进来。

### B — 指标对关系

在白名单（默认 16 个核心指标）内两两计算 Pearson + Spearman 相关系数。

- **低方差跳过**：任一序列 `stddev < 1e-6`（≈常量）直接跳过，避免浮点误差被误算成 ±1。跳过对计入 `summary.skippedPairsLowVar` 便于审计。
- **排序输出**：按 |r| 降序，便于扫"最强相关 / 最强冗余"。

触发 hint：
- `REDUNDANT_PAIR`（|r| ≥ 0.97）：信息几乎重复，建议合并或舍弃其一
- `CORRELATED_PAIR`（|r| ≥ 0.92）：中度相关，建模时注意共线性

### C — 时序行为

由 A 层产生的 `trendSlope` / `halvesMeanDiff` / `autocorrLag1` 配合契约层使用。例如 `skill-not-drift-too-fast` 契约就是用 `halvesMeanDiff` 实现的。

### D — 自适应链路

把"指标 → 决策"的因果链做穿透检查：

| 链路 | 评估方式 | 触发的 hint |
|---|---|---|
| `stressDominator` | 7 个 stress 分量的 ΣabsContrib 占比，找最大主导 | `STRESS_SINGLE_DOMINATOR`（≥ 90%）/ `STRESS_DOMINATED`（≥ 75%） |
| `intentSwitches` | 一局内 `spawnIntent` 切换次数 | `INTENT_THRASHING`（≥ 30）/ `INTENT_FREQUENT`（≥ 12） |
| `feedbackLagCorr` | `feedbackBias[t]` 与 `stress[t+3]` 的 Pearson | `FEEDBACK_LAG_WEAK`（|r| < 0.05） |

## 4. 预期关系契约（profileAuditContracts.js）

这是本系统的**核心**：把"业务约定"从口口相传的注释固化成可执行规则。每条契约：

```js
{
  id: 'clearRate-vs-boardFill',
  desc: '消行率上升时板面应下降（消行清空了空间）',
  source: 'REPLAY_METRICS.tooltip.clearRate / boardFill',
  metrics: ['clearRate', 'boardFill'],
  eval: (series) => { ... return { passed, evidence, reason, details }; }
}
```

当前 12 条契约：

| ID | 类型 | 描述 |
|---|---|---|
| `clearRate-vs-boardFill` | 反向 | 消行率↑ ↔ 板面↓ |
| `frustration-vs-momentum` | 反向 | 未消行步数↑ ↔ 动量↓ |
| `stress-equals-sum-breakdown` | 求和 | **v1.62.6 修正**：对比 `rawStress vs Σ(stressBreakdown.*)`（之前 v1.62.1 错对比 `stress vs Σ`，但 `stress = clamp(rawStress)` 物理上不等于 Σ，导致真实数据残差 7+）|
| `stress-is-clamped-rawStress` | 范围 | **v1.62.6 新增**：顶层 stress ≈ clamp(rawStress, 0, 1)，验证 normalize/clamp 链路 |
| `flowAdjust-tracks-flowDeviation` | 相关 | flowAdjust 跟随 flowDeviation 方向（|r| ≥ 0.2） |
| `feedbackBias-leads-stress` | 滞后 | feedbackBias[t] 与 stress[t+3] 同向相关（r ≥ 0.05） |
| `score-monotone-increasing` | 单调 | score 累积量永不下降 |
| `boardFill-bounded-0-1` | 范围 | boardFill ∈ [0, 1] |
| `session-arc-warm-to-cool` | 弧形 | sessionArcAdjust：开头负 → 中段正 → 收官略负；**v1.62.3：长 session（≥150 帧）或持续救济（≥30% 帧）自动豁免**，避免误报 |
| `skill-not-drift-too-fast` | 漂移 | skill 单局首末半段均值差 \|Δ\| < 0.4 |
| `spawn-intent-no-thrashing` | 稳定性 | **v1.62.3 新增**：spawnIntent 切换率 ≤ 10%（每 10 帧最多 1 次切换） |
| `feedback-loop-effective` | 闭环 | **v1.62.5 新增（优化建议 #7）**：spawnIntent='relief' 后 5 帧内 clearRate 应显著上升，验证"系统救济玩家"链路有效；样本不足跳过 |

**扩展原则**：新增契约只需在 `CONTRACTS` 数组追加一项，不需要动主入口。`applicableContracts(series)` 会自动跳过本局指标缺失的契约，避免"假阳通过"。

## 5. Hints 与健康分

`profileAuditHints.buildHints(audit)` 把四层结果翻译为带严重度的 hint 列表。

### 严重度分级
- `error` 扣 12 分：契约违规 / 覆盖率 < 10% / 越界率 ≥ 5%
- `warn` 扣 4 分：覆盖率 < 30% / 冗余对 / METRIC_JITTERY / STRESS_SINGLE_DOMINATOR / INTENT_THRASHING / 冷启动 ≥ 50%
- `info` 扣 1 分：相关对 / METRIC_NOISY / STRESS_DOMINATED / 冷启动 ≥ 25%

### 健康分
`summarizeHealthScore(hints)` 从 100 扣分得分；可作为报告头一眼判断"指标体系健康度"的合成指标，下限 0、上限 100。

阈值集中在 `DEFAULT_THRESHOLDS`，调用方可通过 `auditProfile(input, { thresholds: { ... } })` 局部覆盖。

## 6. 报告结构

```json
{
  "schema": 1,
  "generatedAt": 1735690000000,
  "metrics": {
    "clearRate": {
      "key": "clearRate", "label": "消行率", "group": "ability",
      "count": 85, "coverage": 1.0,
      "stats": { "min": 0.33, "max": 1.0, "mean": 0.53, "median": 0.50, "stddev": 0.12 },
      "jitter": { "medianAbsDiff": 0.10, "maxAbsDiff": 0.50 },
      "trendSlope": -0.001, "trendHalvesDiff": -0.03, "autocorrLag1": 0.41,
      "outOfRange": { "count": 0, "firstIdx": null },
      "range": { "min": 0, "max": 1 }
    }
  },
  "pairs": [
    { "a": "stress", "b": "boardFill", "pearson": 0.62, "spearman": 0.58, "n": 85 }
  ],
  "contracts": [
    { "id": "clearRate-vs-boardFill", "desc": "...", "metrics": [...],
      "passed": true, "evidence": 0.62, "reason": "反向步占比 0.62（≥0.2 视为通过）" }
  ],
  "linkages": {
    "stressDominator": { "key": "difficultyBias", "shareOfAbs": 0.41, "breakdown": {...} },
    "intentSwitches": 2,
    "feedbackHasData": true,
    "feedbackLagCorr": 0.18
  },
  "summary": {
    "totalFrames": 85, "sessionsCount": 1,
    "passedContracts": 8, "failedContracts": 1,
    "coldFrames": 3, "coldFramesRatio": 0.035,
    "skippedPairsLowVar": 12
  },
  "hints": [
    { "severity": "error", "code": "CONTRACT_VIOLATION", "contract": "session-arc-warm-to-cool",
      "metrics": ["sessionArcAdjust"],
      "msg": "契约「sessionArcAdjust 整局轨迹应近似半圆弧」未通过：..." },
    ...
  ],
  "healthScore": 84
}
```

## 7. 与其他工具的关系

| 工具 | 关注 | 数据来源 |
|---|---|---|
| **profileAudit** | 玩家画像指标的口径与算法健康度（本工具） | `move_sequences.frames`（单局/多局） |
| `buildReplayAnalysis` | 单局复盘评价（写入 `move_sequences.analysis`） | `frames` + `gameStats` |
| `SPAWN_EVALUATION` | 出块算法在 bot 玩家下的指标（noMoveRate / clearInterval ...） | 无头模拟器跑大量 bot 局 |

三者互补：
- `buildReplayAnalysis` 回答"这局玩家玩得怎么样？"（**评价玩家**）
- `profileAudit` 回答"我们的指标体系本身可信吗？"（**评价指标**）
- `SPAWN_EVALUATION` 回答"出块算法在多种玩家分布下表现如何？"（**评价算法**）

## 8. 扩展指南

### 加一条契约
在 `profileAuditContracts.CONTRACTS` 追加：

```js
{
  id: 'thinkMs-bounded-30s',
  desc: 'thinkMs 单步不应超过 30 秒（AFK 应已被排除）',
  source: 'PlayerProfile.recordPlace AFK 处理',
  metrics: ['thinkMs'],
  eval: (s) => {
    const xs = s.thinkMs.filter(Number.isFinite);
    const violations = xs.filter((x) => x > 30000).length;
    return {
      passed: violations === 0,
      evidence: violations,
      reason: violations === 0 ? '全部在 30s 内' : `${violations} 帧超过 30s`,
    };
  },
}
```

### 调整阈值
```js
const report = auditProfile(frames, {
  thresholds: {
    coverage: { error: 0.05, warn: 0.20 },  // 更宽松
    stressDominator: { warn: 0.85, error: 0.95 },
  },
});
```

### 自定义两两扫描白名单
```js
const report = auditProfile(frames, {
  pairScanKeys: ['stress', 'skill', 'flowDeviation'],  // 只关心这 3 项的两两相关
});
```

## 9. 对照分析（v1.62+）

新增模式：`auditProfile(currentFrames, { baseline: baselineFrames })`

适用场景：
- 灰度 release 前的回归卡口：旧版本对一段真实回放跑一次 audit 当 baseline，新版本同一段回放再跑一次，若 `comparison` 里出现 `regressed` 契约 → 阻止发布
- A/B 测试两个版本各自的 frames，看哪些契约稳定通过、哪些抖

返回的额外字段 `comparison`：

```json
{
  "healthScoreDelta": -23,
  "contracts": [
    {
      "id": "score-monotone-increasing",
      "currentPassed": false, "baselinePassed": true,
      "regressed": true, "improved": false,
      "currentEvidence": 1, "baselineEvidence": 0
    }
  ],
  "coverage": {
    "pickToPlaceMs": { "current": 0.0, "baseline": 0.85, "delta": -0.85 }
  },
  "linkages": {
    "stressDominatorChanged": true,
    "stressDominator": { "current": "flowAdjust", "baseline": "difficultyBias" },
    "intentSwitchesDelta": 4,
    "feedbackLagCorrDelta": -0.12
  },
  "baselineSummary": { "totalFrames": 80, "passedContracts": 8, "failedContracts": 1 }
}
```

新增的 hint codes：

| code | severity | 触发条件 |
|---|---|---|
| `REGRESSION_CONTRACT` | error | baseline 通过、current 失败 |
| `IMPROVEMENT_CONTRACT` | info | baseline 失败、current 通过 |
| `COVERAGE_REGRESSION` | warn | 某指标 coverage 下降 ≥ 15 pp |
| `HEALTH_SCORE_REGRESSION` | error | 健康分下降 ≥ 10 |
| `STRESS_DOMINATOR_CHANGED` | info | stress 主导分量切换到另一个 key |

## 10. 跨局聚合（aggregateAuditReports）

`aggregateAuditReports([report1, report2, ...])` 输出：

```json
{
  "sessionsCount": 25,
  "framesTotal": 2150,
  "healthScore": { "count": 25, "min": 42, "max": 96, "mean": 78.3, "p10": 56, "p50": 80, "p90": 92 },
  "contractStats": [
    { "id": "skill-not-drift-too-fast", "appeared": 25, "failed": 11, "violationRate": 0.44, "desc": "..." }
  ],
  "topRegressions": [/* contractStats 中 violationRate ≥ 0.25 且 appeared ≥ 3 的项 */],
  "hintCounts": [
    { "code": "CONTRACT_VIOLATION", "count": 18, "severity": "error" }
  ],
  "stressDominatorCounts": [
    { "key": "difficultyBias", "count": 16, "share": 0.64 }
  ]
}
```

用途：
- **每日体检**：定时跑 `npm run profile:audit -- --sqlite ... --db-recent 1 --pretty`，把"高违规率契约"推到 Slack/Linear。
- **代码 review 数据支撑**：哪条契约连续多天违规率高 → 立项排查。
- **stress 多样性巡检**：若 `difficultyBias` 长期占 ≥80% → 自适应未充分介入，需要调参。

## 11. 已落地范围

- 共享评估模块：`web/src/audit/profileAudit.js` + `profileAuditMath.js` + `profileAuditContracts.js` + `profileAuditHints.js`
- CLI 入口：`scripts/audit-profile.mjs`（含 `--baseline` / `--db-recent` / 聚合模式）
- 服务端：`server.py` `/api/profile-audit/*` 4 个端点 + `profile_audits` 表
- Web 可视化：`web/profile-audit.html` + `web/src/profileAuditApp.js` + `web/src/profileAudit.worker.js`
- 回归测试：
  - `tests/profileAudit.test.js`（56 用例覆盖工具 / 契约 / hint / 对照 / 聚合 / 端到端）
  - `tests/server_profile_audit_test.py`（6 用例覆盖 POST/GET/DELETE/recent/隔离/边界）
- 文档：本文件
- 首页菜单：「🩺 画像指标自评估」入口

### 工作流示例

```bash
# 1. 玩家完成一局后，前端自动跑 audit 并 POST 上传：
#    profileAuditApp.js 的"上传到 SQLite"按钮 → /api/profile-audit/<session_id>

# 2. 每日定时巡检（cron）：
npm run profile:audit -- --sqlite openblock.db --db-recent 1 --pretty --ci
#    退出码 2 → 当天有高违规率契约，触发告警

# 3. 灰度发布前回归：
npm run profile:audit -- \
  --sqlite openblock.db --session-id 9999 \
  --baseline runs/baseline-2026-05-20.json \
  --ci
#    退出码 2 → REGRESSION_CONTRACT 触发，阻断发布

# 4. 设计师在 web 页面看跨局聚合：
#    访问 /profile-audit.html → 聚合视图 → 看违规率排行
```

## 12. 闭环：「遍历 → 自评 → 汇总 → 优化代码」（v1.62.2+）

提供两条路径，按场景选择：

### 路径 A：Web 页面手动触发（推荐 · v1.62.3+）

打开 `/profile-audit.html` → 「聚合视图（近 N 天）」tab → 点 **🤖 一键自动巡检**：

- 浏览器侧自动跑：扫候选 session → 逐局 `auditProfile`（Worker）→ POST 上传 → 拉聚合 → `summarizeOptimizationActions` 翻译为优化建议
- 进度实时在 status bar 显示（`🔄 [12/45] #6668 audit 中…`）
- 完成后页面顶部直接渲染**按 P1→P5 分组的可展开 actions 清单**，每条 action 点开就能看到：
  - 客观证据（"3/4 局触发"）
  - 可能根因
  - 具体改哪个文件、做什么操作
  - 预期收益
- 适合运营 / 设计师 / 开发者交互式排查，不用记命令

### 路径 B：CLI 批量（适合 CI / cron）

`npm run profile:auto-audit` 把同一套逻辑做成命令行，能输出 Markdown 报告便于归档：

```bash
# 扫近 30 天所有未 audit session、不上传，输出 Markdown 报告到本地
npm run profile:auto-audit -- \
  --sqlite .cursor-data/openblock.db \
  --days 30 \
  --pretty \
  --out .cursor-stress-logs/audit-$(date +%Y%m%d).md

# 同时上传到 server.py 持久化（让 Web 页面聚合视图能用）
npm run profile:auto-audit -- \
  --sqlite .cursor-data/openblock.db \
  --days 30 \
  --upload http://localhost:5050 \
  --pretty

# CI/cron 用：有 P1 action 时退出码 2
npm run profile:auto-audit -- --sqlite db.sqlite --pretty --ci
```

### `summarizeOptimizationActions(aggregate)` 输出结构

```json
{
  "priority": 1,                                    // 1=最高，5=最低
  "code": "ADAPTIVE_OUTPUT_INSTABILITY",            // 稳定标识
  "category": "linkage",                            // contract / metric-coverage / metric-noise / linkage / meta
  "title": "stress 主导单一 + spawnIntent 抖动（自适应系统输出不稳定）",
  "evidence": "STRESS_SINGLE_DOMINATOR 在 6 局触发；INTENT_THRASHING 在 5 局触发；主导分量 Top: pacingAdjust (80%)",
  "affected": ["stress", "spawnIntent", "pacingAdjust"],
  "rootCauseHints": [
    "pacingAdjust 长期占主导 → 其他分量被掩盖",
    "spawnIntent 阈值无滞回，pacingAdjust 在边界附近震荡 → intent 高频切换",
    "flowAdjust / reactionAdjust 等弱信号被强信号淹没"
  ],
  "suggestedActions": [
    "1. web/src/adaptiveSpawn.js：给 spawnIntent 派生加滞回（hysteresis），如 stress 跨阈值 ±0.02 才切换",
    "2. 检查主导分量的计算公式，是否取值范围过大压制其他分量",
    "3. 如果是 difficultyBias 主导：说明本局窗口内自适应未介入，正常；其他分量主导：需要把信号取值收敛"
  ],
  "effort": "medium",
  "expectedBenefit": "改善玩家体感连贯性（不会感受到出块策略频繁切换）"
}
```

### Action 类别一览

| category | 触发条件 | 典型 action |
|---|---|---|
| `contract` | 单条契约违规率 ≥ 25% 且 ≥ 3 局 | 10 条契约各有定制 rootCauseHints + suggestedActions |
| `metric-coverage` | COVERAGE_LOW 累计 ≥ 30% 局，或高频 REDUNDANT_PAIR | 调 PS 写入时机 / 合并冗余指标 |
| `metric-noise` | METRIC_JITTERY / METRIC_NOISY 累计 ≥ 50% 局 | UI 加 EMA 开关 / audit 加 _smoothBeforeStats 选项 |
| `linkage` | STRESS_SINGLE_DOMINATOR + INTENT_THRASHING 联动，或单分量 ≥ 50% 局主导 | spawnIntent 加滞回；分量值域收敛 |
| `meta` | 健康分中位数 < 60，或**旧版本 audit 报告残留 ≥ 1 局** | 强制重跑刷新；处理 P1-2 contract action |

### v1.62.5 战略优化（7 条建议落地）

按"风险分层 + opt-in 默认关闭"策略落地了对画像系统的 7 条优化建议：

| # | 改动 | 风险 | 启用方式 |
|---|---|---|---|
| #4 | `playerProfile.momentum` getter 加 frustration 负向 penalty | 低 | **已默认启用**（frustration ≥3 自动生效） |
| #2 | 新增 `web/src/audit/metricRelationships.js`，已知关系豁免 + UI lineage 提示 | 无（仅审计 + UI） | **默认启用** |
| #6 | `auditProfile` 输出新增 `linkages.profileMeta = { intentStability, stressBalance, signalConsistency }` | 无 | **默认启用** |
| #1 | `applySignal` 增加 `signals.__normalizeBudget` 全局值域钳制 | 中 → 经测试稳定 | **已默认启用**（`game_rules.adaptiveSpawn.signals.__normalizeBudget = 0.05`） |
| #3 | `sessionArcAdjust` 增加 peak 段加压（半圆弧补全） | 中 → 经测试稳定 | **已默认启用**（`adaptiveSpawn.sessionArcCfg.peakBoostEnabled = true`） |
| #5 | `deriveSpawnIntent` 增加 hysteresis 参数 + game.js 集成 `prevSpawnIntent` 透传 | 中 → 经测试稳定 | **已默认启用**（`adaptiveSpawn.spawnIntentCfg.hysteresisEnabled = true`） |
| #7 | audit 新增 `feedback-loop-effective` 契约 | 无 | **默认启用** |

每条改动都有完整单测覆盖（2322 个测试全过），无回归。

### v1.62.5 默认值汇总（`shared/game_rules.json`）

```jsonc
"adaptiveSpawn": {
  "signals": {
    "__normalizeBudget": 0.05    // #1：所有非豁免 *Adjust 钳制到 ±0.05
  },
  "sessionArcCfg": {              // #3
    "peakBoostEnabled": true,
    "peakBoost": 0.05
  },
  "spawnIntentCfg": {             // #5
    "hysteresisEnabled": true,
    "sprintExpand": 0.02,
    "sprintShrink": 0.02,
    "reliefMargin": 0.02
  }
}
```

**`_NORMALIZE_EXEMPT` 列表**（不受 `__normalizeBudget` 限制的"宏调"信号）：
`difficultyBias / challengeBoost / scoreStress / runStreakStress / skillAdjust / friendlyBoardRelief / recoveryAdjust / frustrationRelief / nearMissAdjust / returningWarmupAdjust / lifecycleCapAdjust / lifecycleBandAdjust / onboardingStressOverrideAdjust / endSessionDistress / boardRiskReliefAdjust / delightStressAdjust / motivationStressAdjust / accessibilityStressAdjust / bottleneckRelief`

要做 A/B 对照时，把对应 `enabled / __normalizeBudget` 改为 `false / null` 即可临时关闭。

### Engine Version 自动检测（v1.62.4+）

audit 报告嵌入 `engineVersion` 元数据（如 `1.62.4`）。聚合时：
- 任何报告版本与当前不一致 → 触发 **STALE_AUDIT_REPORTS** P1 action
- 聚合视图顶部显示警告 banner + "🔢 引擎版本一致性" 表
- 用户在「🤖 一键自动巡检」点 **↻ 强制重跑** 即可刷新

**为什么不自动重跑过期版本**：检测过期版本需要 GET 每条 report 拿 `engineVersion`，N 次请求拖慢交互；让 action + banner 显式提示，由用户决定是否触发 force 重跑，更可控。

### 闭环工作流

```
玩家完成对局
   │
   ├─→ 客户端 audit + POST 上传到 SQLite（profileAuditApp.js）
   │
   └─→ 定时 cron：profile:auto-audit
           │
           ├─→ 扫所有未 audit 的 session（drop history-already-audited）
           ├─→ 跑 auditProfile + POST 持久化
           ├─→ 拉所有历史 audit 报告做 aggregate
           ├─→ summarizeOptimizationActions → 翻译为可执行 action 清单
           │
           └─→ 输出 Markdown 报告（按优先级排序）
                   │
                   └─→ 开发者读 P1/P2 action → 改 web/src/* 代码 → 提 PR
                           │
                           └─→ 下次 cron 跑时对照分析（baseline）→ 触发 IMPROVEMENT_CONTRACT
```

这套流水线把"工具 + 流程 + 文档"压缩成一个 npm 命令；运营/开发只需读最终的 Markdown 建议清单，无需手工跑多次 audit / 切换 CLI 参数。
