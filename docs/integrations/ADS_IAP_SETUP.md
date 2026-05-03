# 广告与 IAP 真实接入清单

> 代码侧已提供 `setAdProvider` / `setIapProvider` 与 `/api/payment/verify` 占位；以下为对接第三方时的标准步骤（需自行开通商户与广告账号）。

## 激励视频 / 插屏（IAA）

1. 注册 AdMob / AppLovin MAX / Unity Ads 等，创建广告位 ID。  
2. 在 `web/index.html` 或构建流程中加载官方 SDK 脚本（遵守 CSP）。  
3. 于入口脚本调用 `setAdProvider({ showRewarded, showInterstitial })`，在回调内可额外上报收益至 `/api/enterprise/ad-impression`。  
4. 生产环境将 `featureFlags` 中 `stubMode` 设为 `false`，并按受众配置 `adsRewarded` / `adsInterstitial`。  
5. 配置聚合平台瀑布与竞价，监控填充率与 eCPM（运营看板 + 自建查询 `ad_impressions`）。

## IAP（Stripe 示例）

1. 创建 Stripe 产品与 Price，前端用 Checkout 或 Payment Element。  
2. `setIapProvider` 的 `purchase` 内完成收银台并拿到 `session_id` / `payment_intent`。  
3. **Webhook** 送达服务端后校验签名，再写入 `iap_orders`（或扩展 `/api/payment/verify` 校验逻辑）。  
4. 切勿仅信任浏览器回调；**权益发放以服务端校验为准**。  

## 国内微信 / 支付宝

1. 开通微信支付商户、支付宝开放平台应用。  
2. 小程序路径见 `docs/platform/WECHAT_MINIPROGRAM.md`。  
3. 服务端需保存商户订单号与用户 `openid` 映射，并对账。

## 订阅周期

- 订阅类订单在 `/api/payment/verify` 请求体中填写 `expires_at`（Unix 秒）；前端 `iapAdapter` 已在 Stub 路径写入近似过期时间。
