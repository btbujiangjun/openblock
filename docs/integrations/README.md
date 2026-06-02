# Integrations Docs

第三方集成与企业扩展文档。

## 总——企业扩展

- [企业扩展 API](./ENTERPRISE_EXTENSIONS.md) —— `backend/enterprise_extensions.py` 全部端点（远程配置/支付stub/实验/运营/分析/合规）、SQLite表（`iap_orders`/`experiment_configs`/`ad_impressions`等）、环境变量、Flask集成点

## 分——广告与支付集成

- [广告与 IAP 真实接入清单](./ADS_IAP_SETUP.md) —— 广告网络（AdMob/AppLovin/Unity Ads）+ 支付（Stripe/微信/支付宝）分步集成指南：SDK加载→provider stub→webhook服务端验证→订阅生命周期，**硬规则：仅服务端授权 entitlement**

适合后端/DevOps工程师、商业化运营角色使用。
