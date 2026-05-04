# 商业化策略定制指南

> 配套：[`MONETIZATION.md`](./MONETIZATION.md)（商业化权威入口）
> 适用范围：当前 `web/src/monetization/strategy/` 分层架构、`commercialModel` 配置和训练面板。
> 历史重构过程不作为当前事实来源；以代码、测试和 `MONETIZATION.md` 为准。

本文档只说明如何定制策略：调阈值、改规则、新增动作和配置发布。系统全景、模型公式、API 和运维边界统一维护在 [`MONETIZATION.md`](./MONETIZATION.md)，避免两份文档重复描述同一套架构。

---

## 1. 分层架构

```
┌────────────────────────────────────────────────────────────────┐
│ L4 UI 注入：commercialInsight.js · monPanel.js                  │
│   读取 L1+L2，附加 cursor:help 提示，渲染分群面板与训练面板      │
├────────────────────────────────────────────────────────────────┤
│ L3 业务模块：adTrigger · iapAdapter · pushNotifications · …     │
│   通过 shouldTriggerRule(id, ctx) 询问 L2，自身只负责执行         │
├────────────────────────────────────────────────────────────────┤
│ L2 决策引擎：strategy/strategyEngine.js                         │
│   纯函数 evaluate(ctx) → ranked actions[] + whyLines[]          │
│   零副作用：不读 storage、不发请求、不操作 DOM                   │
├────────────────────────────────────────────────────────────────┤
│ L1 集中配置：strategy/strategyConfig.js                         │
│   segments / segmentWeights / thresholds / frequency / products │
│   / copy / rules[]      ← 唯一可变数据源                         │
└────────────────────────────────────────────────────────────────┘
                                 ▲
                                 │ setStrategyConfig(patch)
                                 │
                       后端 mon_model_config / 运营脚本 / A-B 实验
```

每一层只依赖下层，不反向耦合。

---

## 2. 三种定制粒度

按改动复杂度从小到大：

| 粒度 | 适用场景 | 改动文件 | 是否需重启 |
|------|---------|---------|----------|
| **A. 调阈值/权重** | 调整分群门槛、广告频次 | 训练面板 → 模型配置 | 否（实时生效） |
| **B. 改文案/规则** | 修改 why/effect、新增/禁用规则 | `strategyConfig.js` 的 `rules[]` | 否（热更新） |
| **C. 自定义动作类型** | 新增推送渠道 / 联运皮肤 | 新建文件 + `registerStrategyRule` | 需热加载 |

---

## 3. 粒度 A：调阈值/权重

### 3.1 通过训练面板（推荐）

1. 点击玩家画像面板右上角 **⚙** 按钮，或右下角 📊 浮窗
2. 切到「模型配置」标签页
3. 调动滑块，**鼠标悬停** 在标签上即可看到字段含义、影响范围（cursor:help）
4. 点击「保存配置」 → 写入 `mon_model_config` 表 → 1 小时内全用户生效

### 3.2 通过代码

```js
import { setStrategyConfig } from './web/src/monetization/strategy/index.js';

setStrategyConfig({
    segmentWeights: {
        best_score_norm:   0.50,    // 提升「高分玩家」权重
        total_games_norm:  0.25,
        session_time_norm: 0.25,
    },
    thresholds: {
        frustrationRescue: 4,        // 提前介入救济
        activityLow:       0.40,     // 推送门槛抬高
    },
});
```

`setStrategyConfig()` 走深合并：传入字段覆盖，未传字段保留。`rules` 与 `segments` 数组遵循「传则替换」语义。

---

## 4. 粒度 B：改文案/规则

### 4.1 修改默认规则文案

打开 `web/src/monetization/strategy/strategyConfig.js`，找到 `DEFAULT_STRATEGY_CONFIG.rules` 数组：

```js
{
    id: 'dolphin_default_weekly',
    segments: ['dolphin'],
    action: { type: 'iap', product: 'weekly_pass' },
    priority: 'medium',
    why:    'Dolphin 用户对周期低价付费接受度高',
    effect: '首月留存 +22%，向月卡转化铺路',
},
```

直接改 `why` / `effect` / `priority` 即可。重启 Vite Dev Server 后生效。

### 4.2 新增一条规则（不动主仓库）

适合 A-B 实验或第三方插件场景：

```js
import { registerStrategyRule } from './web/src/monetization/strategy/index.js';

registerStrategyRule({
    id: 'whale_annual_pass_late_session',
    segments: ['whale'],
    when: ({ realtime }) => realtime.sessionPhase === 'late',
    action: { type: 'iap', product: 'annual_pass' },
    priority: 'high',
    why:    '深度会话晚期付费意愿高',
    effect: '年卡 LTV 比月卡 +210%',
});
```

同 id 重复注册会**整体替换**，便于热更新。

### 4.3 删除/禁用规则

```js
import { unregisterStrategyRule } from './web/src/monetization/strategy/index.js';
unregisterStrategyRule('minnow_interstitial_on_game_over');  // 完全静默插屏
```

或临时禁用：在规则的 `when` 中返回 `false` 即可而无需删除。

### 4.4 规则字段速查

| 字段 | 必填 | 说明 |
|------|-----|------|
| `id` | ✅ | 唯一标识，写入 `strategy_log.strategy` |
| `segments` | ✗ | 限定分群（缺省=全分群） |
| `when` | ✗ | `(ctx) => boolean`；ctx 含 persona、realtime、config |
| `action` | ✅ | `{ type, product?, format?, trigger? }` |
| `priority` | ✗ | `'high'/'medium'/'low'`，影响曝光排序 |
| `why` | ✗ | 静态触发原因文案 |
| `effect` | ✗ | 静态预期效果文案 |
| `explain` | ✗ | `(ctx) => { why?, effect? }`，动态文案，覆盖静态字段 |

---

## 5. 粒度 C：自定义动作类型

### 5.1 注册新类型的图标和标签

```js
import { setStrategyConfig, registerStrategyRule } from './web/src/monetization/strategy/index.js';

setStrategyConfig({
    copy: {
        actionType: {
            email: { icon: '✉️', label: 'EDM 召回' },
        },
    },
});
```

### 5.2 新增执行模块

```js
// web/src/monetization/emailTrigger.js
import { on } from './MonetizationBus.js';
import { shouldTriggerRule } from './strategy/index.js';
import { _getState } from './personalization.js';

export function initEmailTrigger() {
    on('game_over', () => {
        const state = _getState();
        const ctx = {
            persona:  { ...state, segment: state.segment },
            realtime: state.realtimeSignals,
        };
        if (shouldTriggerRule('reactivation_email_d3', ctx)) {
            void sendReactivationEmail(state.userId);
        }
    });
}
```

### 5.3 注册规则与执行模块

```js
registerStrategyRule({
    id: 'reactivation_email_d3',
    segments: ['minnow', 'dolphin'],
    when: ({ persona }) => persona.activityScore < 0.20,
    action: { type: 'email', template: 'reactivation_d3' },
    priority: 'low',
    why:    '沉默 3 天 + 历史 D7 留存目标',
    effect: '行业 EDM 召回率约 3-5%',
});

// main.js 或独立 bootstrap
import { initEmailTrigger } from './monetization/emailTrigger.js';
initEmailTrigger();
```

### 5.4 在面板里显示新类型

新动作类型自动在「玩家画像 → 商业化策略」与「训练面板 → 用户画像」中渲染卡片。如果想自定义说明，注册 cursor:help：

```js
import { registerHelp } from './web/src/monetization/strategy/index.js';
registerHelp('rule.reactivation_email_d3',
    '沉默 3 天用户邮件召回 — 仅在持续低活时触发\n'
  + '与 push 通道互斥，避免同时打扰');
```

---

## 6. 面板 cursor:help 提示

所有可定制项都标注了 `class="mon-help"` + `title` 详细说明。鼠标悬停即可查看：

| 区域 | 字段 | 提示 key |
|------|------|---------|
| 玩家画像 → 商业化策略 | 6 个信号格 | `signal.{key}` |
| 玩家画像 → 商业化策略 | 策略卡片 | `rule.title` |
| 玩家画像 → 商业化策略 | 模型训练面板入口 ⚙ | `panel.entry` |
| 训练面板 → 总览 | 6 个 KPI 卡 | `kpi.{key}` |
| 训练面板 → 总览 | 分群分布条 | `segment.{whale/dolphin/minnow}` |
| 训练面板 → 模型配置 | 3 个权重滑块 | `weight.{best_score_norm/...}` |
| 训练面板 → 模型配置 | 4 个阈值滑块 | `threshold.{frustrationRescue/...}` |
| 训练面板 → 功能开关 | 10 个 Feature Flag | `flag.{key}` |

完整列表：调用 `listHelpKeys()` 或查看 `web/src/monetization/strategy/strategyHelp.js`。

新增可定制项时**必须**在 `HELP_TEXTS` 中登记，强制开发者写明含义与影响。

---

## 7. 与服务端 mon_model_config 的协同

后端通过 `PUT /api/mon/model/config` 写入 `mon_model_config` 表的字段会通过下列链路自动注入到前端：

```
PUT /api/mon/model/config
       │
       ▼
SQLite mon_model_config
       │
       ▼ (下次 fetchPersonaFromServer 时连同画像下发)
GET /api/mon/user-profile  → response.model_config
       │
       ▼
personalization.js → setStrategyConfig(model_config)
       │
       ▼
strategyConfig._config（内存实时生效）
```

后端只需在 user-profile 响应里附带 `model_config: {...}`，前端自动接管。**无需重启**。

---

## 8. 测试

新策略子系统所有逻辑都是纯函数，单元测试方便：

```js
import { describe, it, expect } from 'vitest';
import { evaluate, setStrategyConfig, resetStrategyConfig } from
    '../web/src/monetization/strategy/index.js';

describe('strategyEngine', () => {
    it('Whale 用户在挫败时同时触发月卡 + 提示包', () => {
        resetStrategyConfig();
        const result = evaluate({
            persona:  { segment: 'whale', whaleScore: 0.7, activityScore: 0.8 },
            realtime: { frustration: 6, hadNearMiss: false },
        });
        const products = result.actions
            .filter(a => a.action.type === 'iap')
            .map(a => a.action.product);
        expect(products).toContain('monthly_pass');
        expect(products).toContain('hint_pack_5');
    });
});
```

---

## 9. 检查清单

定制商业化策略前的安全检查（避免线上回归）：

- [ ] 改动是否走 `setStrategyConfig` / `registerStrategyRule` 而非直接修改默认值？
- [ ] 新增字段是否在 `HELP_TEXTS` 中登记 cursor:help？
- [ ] 新增规则的 `id` 是否唯一？是否在 `mon_strategy_log` 中能正确写入？
- [ ] 改阈值后是否手动 `reclassifyFromConfig()` 触发分群重计算？
- [ ] 跑过 `npx vitest run tests/monetization.test.js` 全绿？
- [ ] 在训练面板「用户画像」标签页验证策略卡片符合预期？
- [ ] 真机试运行：玩 5~10 局，观察策略卡片是否随实时信号变化？

---

## 10. 关联文档

| 文档 | 作用 |
|------|------|
| [`MONETIZATION.md`](./MONETIZATION.md) | 系统全景、API 参考、SQL 表结构 |
| [`COMMERCIAL_OPERATIONS.md`](./COMMERCIAL_OPERATIONS.md) | 运营操作手册 |
| `web/src/monetization/strategy/strategyConfig.js` | 默认配置源码（含字段注释） |
| `web/src/monetization/strategy/strategyHelp.js` | cursor:help 文案中心 |
| `tests/monetization.test.js` | personalization + 策略引擎测试 |
