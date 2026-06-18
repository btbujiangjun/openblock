# AA5 dynamic leafCap 灰度周报 · week-1（FF2 占位）

> **状态**：占位草稿。EE2 阶段 1 上线后 T+7 天由 owner 填写真实数据。
> 模板请参考 `aa5-week-template.md`，决策依据见 `AA5_PHASE1_MONITORING.md`。

---

## 元信息

| 项 | 值 |
|---|---|
| 周次 | `week-1` |
| 监控窗口起 | `TBD — EE2 上线后第一个完整 UTC 日 00:00` |
| 监控窗口止 | `监控窗口起 + 7 天` |
| 灰度配置 | `enabled=true, percent=5, salt=dyn-cap-v1` |
| 当前阶段 | `阶段 1（5% 灰度）` |
| 填写人 | `TBD` |
| 上一周次 | （无） |

---

## 占位说明

本文件先以**占位 placeholder** 形式建立，确保：

1. 文件路径已就位（`docs/engineering/changelog/aa5-week-1.md`），
   PR 链接、issue 引用、grafana 注释可以预先指向。
2. Week-1 → week-N 的目录结构在 git 历史中可见，未来扫码可追溯。
3. EE2 commit 74e809e 已把生产灰度打开，**当数据回来时**只需复制
   `aa5-week-template.md` 内容覆盖本文件即可，无需再造结构。

## 行动项（owner）

- [ ] T+7 天后：从 Grafana 取 5 维度数据填入本文件
- [ ] 决策：进阶段 2（percent=25）/ 保持 / 回滚
- [ ] 同步决策结果到 `shared/game_rules.json` 并新建 PR
- [ ] 创建 `aa5-week-2.md` 占位（若决策为"保持/进阶段 2"）

## 相关

- 监控周报模板：`docs/engineering/changelog/aa5-week-template.md`
- 决策表：`docs/engineering/AA5_PHASE1_MONITORING.md`
- 灰度方案：`docs/engineering/DYNAMIC_LEAFCAP_AB_PLAN.md`
- 配置入口：`shared/game_rules.json` `rollout.dynamicLeafCap`
