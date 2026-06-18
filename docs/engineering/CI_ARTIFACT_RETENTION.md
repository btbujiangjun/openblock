# CI Artifact Retention 规范（v1.71 II4）

GitHub Actions 默认 artifact 保留 90 天。本仓库显式声明 `retention-days`
便于审计、避免回滚 default 后无声变更，并按用途分级。

## 规则

| 类别 | retention-days | 理由 |
|---|---:|---|
| **趋势 / 基线**：benchmark report、benchmark baseline JSON、dead-code report | **90** | 跨季度回溯、版本对比、回归长尾排查 |
| **诊断 artifact**：coverage（web/python）、build log | **30** | 短期诊断已足；超 30 天通常已被新数据覆盖 |
| **调试转储**：sandbox / dump | **7** | 单次事件级，事件关闭即可删 |

## 当前工作流声明状态

| Workflow | Artifact | 当前 retention | 类别 |
|---|---|---:|---|
| `ci.yml` | `web-coverage` | 30 | diagnostic |
| `ci.yml` | `perf-report` | 90 | trend |
| `ci.yml` | `python-coverage` | 30 | diagnostic |
| `weekly-dead-code.yml` | `benchmark-report-week-<N>` | 90 | trend |
| `benchmark-trend-rolling.yml` | `benchmark-trend-week-<N>` | 90 | trend |

（HH3 `reporting_outbox` 上报为客户端运行时 → Grafana metric，**不**经由 CI artifact 路径。）

## 添加新工作流时

1. 必须显式声明 `retention-days`，不要依赖 default
2. 按上表分级，新类别先在本表登记
3. CI lint（II4 待加）会校验 `upload-artifact` 步骤必须有 `retention-days`

## 历史

- v1.71 II4：统一规范，补齐 ci.yml 3 处缺失声明
- v1.71 DD5：weekly-dead-code 上传 benchmark report，retention 90
- v1.71 HH5：benchmark-trend-rolling 上传 baseline，retention 90
