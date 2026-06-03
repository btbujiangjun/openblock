# Integrations Docs

第三方集成与企业扩展说明。

## 总——企业扩展

- [企业扩展 API](./ENTERPRISE_EXTENSIONS.md) —— `backend/enterprise_extensions.py` 全部端点（远程配置/支付 stub/实验/运营/分析/合规）、SQLite 表（`iap_orders`/`experiment_configs`/`ad_impressions` 等）、环境变量与 Flask 集成点

## 分——广告与支付集成

- [广告与 IAP 真实接入清单](./ADS_IAP_SETUP.md) —— 广告网络（AdMob/AppLovin/Unity Ads）与支付（Stripe/微信/支付宝）分步集成指南：SDK 加载 → provider stub → webhook 服务端验证 → 订阅生命周期，**硬规则：仅服务端授权 entitlement**

面向后端/DevOps 工程师与商业化运营团队。
