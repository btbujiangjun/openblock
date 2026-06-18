# ADR-008: adaptiveSpawn 规则 DSL（{when, apply} 数组化）

**Status**: Proposed（NN-F3 路线图）
**Date**: 2026-06-19

## Context

`adaptiveSpawn.js` 现有 3905 行，含 ~50 条 `if (cond) { ... }` 规则。
LL2 / JJ2 / MM2 已抽 ~15 个 `_applySpawnHintsXxxRule` helper，但规则间
关系仍以代码顺序隐式表达，运营/算法工程师难以快速调权重 / 加新规则。

## Decision（Proposed）

把规则改成 declarative 数组：

```js
const SPAWN_RULES = [
  {
    id: 'risk-relief-A',
    when: (ctx) => ctx.bottleneck && ctx.fillRatio > 0.7,
    apply: (s, ctx) => ({ ...s, clearGuarantee: Math.max(s.clearGuarantee, 2) }),
    priority: 100,
    /* 元数据：让 A/B 测试可单独开关 */
    abTestKey: 'rrA',
  },
  // ...
];
```

执行：
```js
const sorted = SPAWN_RULES.toSorted((a, b) => b.priority - a.priority);
for (const r of sorted) {
  if (r.when(ctx)) s = r.apply(s, ctx);
}
```

## 收益

1. **规则可读**：100 条规则元数据一目了然
2. **可单独 A/B 开关**：通过 `disabled: ['rrA']` config 即可关
3. **规则元数据**：可加 `since: 'v1.65'` / `owner: 'gameplay'` / `comment`
4. **自动文档化**：脚本扫规则数组生成"规则一览表" wiki

## 风险

1. **执行顺序对结果敏感**：现有代码顺序隐式编码语义，改 sort 可能破坏
   - 缓解：spawnGolden 18 测试守护；分阶段迁移（每次 5-10 规则）
2. **闭包 `when` 性能**：每帧 50 次 function call
   - 缓解：V8 inline 没问题；profile 后再 micro-bench
3. **DSL meta-config**：要决定字段（priority 数值规则？或显式 DAG）
   - 缓解：先用 priority 数字，未来需要再升 DAG

## 实施路线（NN-F3.x）

| 子任务 | 描述 |
|---|---|
| F3.1 | DSL runtime + 1 条规则迁移 PoC |
| F3.2 | spawnGolden 跑 PoC 零回归 |
| F3.3 | 迁移 baseRules 7 条规则 |
| F3.4 | 迁移 riskRelief 5 条规则 |
| F3.5 | 迁移其余规则 |
| F3.6 | 旧 helper 删除 + 文档自动生成脚本 |

总估时 ~3 周。**前置依赖**：NN-F2（remote config）落地后，DSL 才能
体现"运营改 JSON 增减规则"价值。

## Revisit Trigger

- NN-F2 落地（前置）
- spawn 规则数 > 100（人脑维护困难）
- 算法工程师明确反馈"加规则不知道改哪"
