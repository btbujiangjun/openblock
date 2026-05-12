# Block Blast 商业化运营指南

本文档记录了游戏商业化运行所需的配置、功能和最佳实践。

## 目录

1. [商业化架构概览](#商业化架构概览)
2. [PWA 离线支持](#pwa-离线支持)
3. [广告系统](#广告系统)
4. [IAP 内购系统](#iap-内购系统)
5. [签到与每日任务](#签到与每日任务)
6. [战绩分享](#战绩分享)
7. [运营指标](#运营指标)
8. [v1.12 新增模块入口与设计意图（变更说明）](#v112-新增模块入口与设计意图变更说明)

---

## 商业化架构概览

```
┌─────────────────────────────────────────────────────────┐
│                    商业化框架                            │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ AdDecisionEngine│  │ CommercialModel             │  │
│  │ 广告决策统一入口  │  │ 商业化向量计算              │  │
│  └────────┬────────┘  └──────────────┬──────────────┘  │
│           │                          │                 │
│  ┌────────▼──────────────────────────▼──────────────┐   │
│  │           MonetizationBus (事件总线)            │   │
│  │  game_over | clear | no_moves | spawn_blocks    │   │
│  └────────┬─────────────────────────────────┬───────┘   │
│           │                                 │           │
│    ┌──────▼──────┐              ┌───────────▼────────┐ │
│    │ adAdapter   │              │ iapAdapter         │ │
│    │ 广告适配器   │              │ 支付适配器          │ │
│    └─────────────┘              └────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## PWA 离线支持

### 功能说明

- **Service Worker 缓存策略**：
  - 静态资源：`Stale-While-Revalidate`（快速响应，后台更新）
  - API 数据：`Network First`（优先最新，失败回退缓存）
  - HTML 页面：`Network First`
- **IndexedDB 离线队列**：离线时缓存行为数据，联网后自动同步
- **PWA 完整支持**：添加到主屏幕、快捷方式、分享目标

### 缓存策略详情

| 资源类型 | 策略 | 缓存时间 |
|----------|------|----------|
| 静态资源 (JS/CSS/图片) | Stale-While-Revalidate | 7 天 |
| API GET 请求 | Network First | 5 分钟 |
| API POST/PUT 请求 | Network First + 离线队列 | - |
| HTML 页面 | Network First | 0（不缓存） |

### 配置清单

| 文件 | 说明 |
|------|------|
| `web/public/manifest.json` | PWA 清单配置（含快捷方式） |
| `web/public/sw.js` | Service Worker 脚本 |
| `web/src/offlineBehaviorQueue.js` | IndexedDB 离线行为队列 |
| `web/src/offlineManager.js` | 离线能力统一管理 |
| `web/assets/images/icon-192.svg` | 192px 图标 |
| `web/assets/images/icon-512.svg` | 512px 图标 |

### 使用方法

**初始化：**
```javascript
import { initOfflineManager, logBehavior, getOfflineStatus } from './offlineManager.js';

// 初始化离线能力
await initOfflineManager();

// 记录行为（自动处理离线）
await logBehavior('place', { x: 3, y: 4 }, gridState);

// 获取离线状态
const status = await getOfflineStatus();
// { pending: 5, online: true, isOffline: false }
```

**网络状态监听：**
```javascript
import { onNetworkStatusChange } from './offlineManager.js';

const unsubscribe = onNetworkStatusChange((isOnline) => {
  console.log('网络状态:', isOnline ? '在线' : '离线');
});

// 取消监听
unsubscribe();
```

**PWA 安装：**
```javascript
// 监听安装提示
window.addEventListener('pwa-install-ready', (e) => {
  // 显示自定义安装按钮
});

// 触发安装
if (window.pwaInstall) {
  await window.pwaInstall();
}
```

### 启用方式

确保 `index.html` 中已引入：

```html
<link rel="manifest" href="./manifest.json">
<meta name="theme-color" content="#5B9BD5">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="/assets/images/icon-192.svg">
```

Service Worker 会在页面加载时自动注册。

---

## 广告系统

### 广告决策引擎 (AdDecisionEngine)

统一入口，整合商业模型向量，智能决定是否展示广告。

**使用示例：**

```javascript
import { getAdDecisionEngine, AD_SCENES } from './monetization/ad/adDecisionEngine.js';

// 初始化
const adEngine = getAdDecisionEngine();
adEngine.init();

// 游戏结束时请求广告
const result = await adEngine.requestAd(AD_SCENES.GAME_OVER);
if (result.allowed) {
  // 显示广告
}

// 获取广告状态（UI 显示用）
const status = adEngine.getAdStatus();
console.log('剩余激励广告:', status.rewardedRemaining);
```

### 场景化触发

| 场景 | 触发条件 | 推荐广告类型 |
|------|----------|--------------|
| GAME_OVER | 游戏结束 | 根据付费倾向 |
| NO_MOVES | 无步数可用 | 激励广告（给玩家额外机会） |
| STAMINA_EMPTY | 体力不足 | 激励广告 |
| DAILY_REWARD | 每日奖励 | 激励广告 |

### 频率控制

- 每日激励广告上限：12 次
- 每日插屏广告上限：6 次
- 最小间隔：60 秒

---

## IAP 内购系统

### 产品目录

| SKU | 名称 | 价格 | 类型 |
|-----|------|------|------|
| remove_ads | 移除广告 | ¥18 | 一次性 |
| hint_pack_5 | 提示包×5 | ¥6 | 消耗品 |
| weekly_pass | 周卡 | ¥12 | 订阅(7天) |
| monthly_pass | 月卡 | ¥28 | 订阅(30天) |
| annual_pass | 年度通行证 | ¥88 | 订阅(365天) |
| starter_pack | 新手礼包 | ¥3 | 首购限定 |

### 使用示例

```javascript
import { purchase, PRODUCTS, isPurchased, canPurchaseStarterPack } from './monetization/iapAdapter.js';
import { getPaymentManager, initPaymentManager } from './monetization/paymentManager.js';

// 初始化支付管理器
initPaymentManager();

// 检查是否已购买
if (isPurchased('remove_ads')) {
  console.log('已移除广告');
}

// 检查新手礼包是否可购买
if (canPurchaseStarterPack()) {
  console.log('可购买新手礼包');
}

// 发起购买
const result = await purchase('monthly_pass');
if (result.success) {
  console.log('购买成功');
}

// 获取支付状态（包括优惠信息）
const pm = getPaymentManager();
const status = pm.getPaymentStatus();
console.log('可用优惠:', status.offers);
```

### 后端 API

```
POST /api/payment/verify    - 验证支付
GET  /api/payments          - 获取购买历史
```

---

## 签到与每日任务

### 签到系统

7日签到日历，每日首次进入游戏自动弹窗。

**奖励配置：**
- 第1天：+1 提示券
- 第2天：+1 提示 +1 撤销
- 第3天：+2 提示
- 第4天：+1 炸弹
- 第5天：+2 提示 +2 撤销
- 第6天：+1 彩虹
- 第7天：+2 提示 +1 炸弹 +1 彩虹 + 24h限定皮肤试穿券

### 每日任务

3个任务每日刷新，完成获得 XP 和道具奖励。

**任务配置：**
- 消行5次：+30 XP + 1 提示券
- 完成1局：+20 XP
- 一次消3行：+40 XP + 2 提示券

---

## 战绩分享

游戏结束后可分享成绩到社交平台。

```javascript
import { shareGameResult } from './monetization/replayShare.js';

// 分享当前成绩
await shareGameResult(score);
```

支持：
- Web Share API（移动端）
- 复制到剪贴板（回退方案）

---

## 运营指标

### 核心指标监控

| 指标 | 计算方式 | 目标值 |
|------|----------|--------|
| DAU | 日活跃用户 | - |
| 次日留存 | 次日回访用户/新增 | >40% |
| 付费率 | 付费用户/活跃用户 | >5% |
| ARPDAU | 日收入/日活 | >¥0.5 |
| 广告展示率 | 广告展示次数/游戏局数 | <30% |
| 激励广告完播率 | 看完次数/展示次数 | >80% |

### 商业化向量

`commercialModel.js` 输出的关键指标：

- **payerScore**: 付费倾向评分 (0-1)
- **churnRisk**: 流失风险 (0-1)
- **adFatigueRisk**: 广告疲劳度 (0-1)
- **recommendedAction**: 推荐商业化动作

---

## 快速部署检查清单

- [x] PWA manifest 和 service worker 已部署
- [x] 离线行为队列已配置 (IndexedDB)
- [x] PWA 图标已生成 (192px, 512px)
- [x] 广告决策引擎已实现 (AdDecisionEngine)
- [x] IAP 支付链路已完善（首充/限时优惠）
- [x] A/B 测试框架已实现
- [x] 用户分群系统 (CohortManager) 已实现
- [x] 远程配置下发 (RemoteConfigManager) 已实现
- [x] 指标埋点与漏斗分析 (AnalyticsTracker) 已实现
- [x] 实验平台统一入口 (ExperimentPlatform) 已实现
- [x] 运营数据分析面板已实现
- [x] 推送通知系统已实现 (PushNotificationSystem)
- [x] 推送内容模板已实现
- [x] 推送效果追踪已实现
- [x] 新手引导系统已实现
- [x] 战绩分享卡片已实现
- [x] 社交排行榜已实现
- [x] 邀请奖励体系已实现
- [ ] 签到/每日任务功能已启用
- [ ] 真实广告 SDK 已接入
- [ ] 真实支付 SDK 已接入
- [ ] 社交登录集成 (Google/Facebook/Apple)
- [ ] 推送服务器配置 (VAPID)

---

## 扩展开发

### 添加新广告位

1. 在 `adDecisionEngine.js` 的 `AD_SCENES` 添加新场景
2. 在 `_checkSceneSpecific` 添加场景逻辑
3. 在游戏流程中调用 `requestAd(scene)`

### 添加新产品

1. 在 `iapAdapter.js` 的 `PRODUCTS` 添加产品定义
2. 在 `_applyPurchase` 添加发放逻辑
3. （可选）在 `server.py` 添加服务端验证

### 自定义商业化模型

修改 `commercialModel.js` 中的权重配置：

```javascript
const cfg = {
  ltvConfidence: { high: 0.9, medium: 0.6, low: 0.25 },
  payerScoreWeights: { whaleScore: 0.34, ltvScore: 0.28, ... },
  actionThresholds: { iapRecommend: 0.68, rewardedRecommend: 0.55 }
};
```

---

## A/B 测试框架

### 功能说明

用户分组实验，支持远程配置下发，指标追踪。

### 内置实验

| 实验 | 说明 | 变体 |
|------|------|------|
| ad_frequency | 广告展示频率 | 对照/低频/高频 |
| difficulty_curve | 难度曲线 | 标准/简单/困难 |
| first_purchase_offer | 首充优惠 | 5折/3折 |
| checkin_rewards | 签到奖励 | 标准/丰厚 |
| skin_unlock | 皮肤解锁 | 标准/简单 |

### 使用方法

```javascript
import { getABTestManager, initABTest } from './monetization/abTestManager.js';

// 初始化
await initABTest(userId);

// 获取实验变体
const abTest = getABTestManager();
const variant = abTest.getVariant('ad_frequency');
console.log('我的分组:', variant.variant, variant.config);

// 记录指标
abTest.recordMetric('ad_frequency', 'adRevenue', 1.5);
```

---

## 运营数据分析

### 功能说明

实时指标、漏斗分析、趋势图表。

### 使用方法

```javascript
import { getAnalyticsDashboard, initAnalyticsDashboard } from './monetization/analyticsDashboard.js';

// 初始化
initAnalyticsDashboard();

// 获取核心指标
const dashboard = getAnalyticsDashboard();
const metrics = dashboard.getCoreMetrics();
console.log('总游戏数:', metrics.totalGames);
console.log('总收入:', metrics.revenue);

// 获取漏斗数据
const funnel = dashboard.getFunnelData();
console.log('转化率:', funnel.playToClear);

// 获取趋势
const trends = dashboard.getTrendData(7);

// 生成报告
const report = dashboard.generateReport();
```

---

## 推送通知

### 功能说明

事件触发通知、定时提醒、流失预警。

### 支持的触发类型

- `DAILY_BONUS` - 每日奖励提醒
- `STREAK_REMINDER` - 连签提醒
- `CHURN_WARNING` - 流失预警
- `FIRST_PURCHASE` - 首充优惠
- `LIMITED_OFFER` - 限时优惠
- `RETURNING_USER` - 回归用户

### 使用方法

```javascript
import { getPushNotificationManager, initPushNotificationManager } from './monetization/pushNotificationManager.js';

// 初始化
await initPushNotificationManager();

// 触发事件
const push = getPushNotificationManager();
push.triggerEvent('limited_offer_available', {
  title: '限时折扣！',
  body: '月卡5折优惠'
});
```

---

## 新手引导

### 功能说明

多阶段引导、进度保存、奖励发放。

### 引导步骤

1. welcome - 欢迎页
2. drag_intro - 拖拽操作介绍
3. place_first - 首次放置
4. clear_intro - 消除介绍
5. clear_first - 首次消除
6. multi_line - 多行消除
7. difficulty - 难度选择
8. complete - 引导完成

### 使用方法

```javascript
import { getFTUEManager, initFTUE } from './onboarding/ftueManager.js';

// 初始化
initFTUE();

const ftue = getFTUEManager();

// 检查是否需要引导
if (ftue.shouldStartFTUE()) {
  const step = ftue.startFTUE();
  console.log('引导开始:', step.title);
}

// 游戏事件触发步骤完成
ftue.completeStep('place_first');

// 获取状态
const status = ftue.getStatus();
console.log('进度:', status.progress);
```

---

## 社交与分享

### 战绩分享卡片

生成精美的游戏结果分享图片。

```javascript
import { getShareCardGenerator, CARD_TEMPLATES } from './monetization/shareCardGenerator.js';

const generator = getShareCardGenerator();

// 生成游戏结束卡片
const cardData = await generator.generateGameOverCard({
  score: 1500,
  bestScore: 1200,
  clears: 25,
  maxCombo: 4,
  strategy: 'Normal',
  date: new Date().toLocaleDateString()
});

// 生成分享链接
const shareLink = generator.generateShareLink({
  score: 1500,
  clears: 25,
  combo: 4
});

// 导出为图片文件
generator.exportAsFile(cardData, 'my-score.png');
```

### 排行榜系统

支持好友榜、全球榜、周榜等多种排行榜。

```javascript
import { getSocialLeaderboard, initLeaderboard, LEADERBOARD_TYPES } from './monetization/socialLeaderboard.js';

// 初始化
initLeaderboard(userId);

const leaderboard = getSocialLeaderboard();

// 获取全球排行榜
const globalRanking = await leaderboard.getLeaderboard(LEADERBOARD_TYPES.GLOBAL);

// 获取好友排行榜
const friendsRanking = await leaderboard.getLeaderboard(LEADERBOARD_TYPES.FRIENDS);

// 提交分数
await leaderboard.submitScore(score, { clears, combo });

// 获取我的排名
const myRank = await leaderboard.getMyRank(LEADERBOARD_TYPES.GLOBAL);

// 添加好友
await leaderboard.addFriend(friendCode);

// 生成我的分享码
const shareCode = leaderboard.generateShareCode();
```

### 邀请奖励体系

邀请好友获得奖励，被邀请者也有奖励。

```javascript
import { getInviteRewardSystem, initInviteSystem, INVITE_REWARDS } from './monetization/inviteRewardSystem.js';

// 初始化
initInviteSystem(userId);

const invite = getInviteRewardSystem();

// 生成分享链接
const shareLink = invite.generateShareLink();

// 生成分享文案
const shareText = invite.generateShareText();

// 分享到社交平台
await invite.shareToSocial('twitter');

// 获取邀请状态
const status = invite.getInviteStatus();
console.log('邀请码:', status.inviteCode);
console.log('邀请人数:', status.inviteCount);

// 获取进度
const progress = invite.getProgress();
console.log('进度:', progress.current, '/', progress.target);
```

**奖励机制：**

| 邀请人数 | 奖励 |
|----------|------|
| 首次邀请 | 5 提示 + 100 金币 + 50 XP |
| 每次邀请 | 2 提示 + 50 金币 + 20 XP |
| 5 人 | 额外 5 提示 + 100 金币 |
| 10 人 | 额外 10 提示 + 200 金币 |
| 20 人 | 额外 20 提示 + 500 金币 |
| 50 人 | 额外 50 提示 + 1000 金币 |

被邀请者获得：3 提示 + 50 金币 + 30 XP

---

## A/B 测试基础设施

### 统一入口 (ExperimentPlatform)

整合用户分群、远程配置、指标追踪和 A/B 测试的统一平台。

```javascript
import { getExperimentPlatform, initExperimentPlatform } from './monetization/experimentPlatform.js';

// 初始化（传入用户 ID）
await initExperimentPlatform(userId);

// 获取平台实例
const platform = getExperimentPlatform();
```

### 1. 用户分群 (CohortManager)

用户属性自动跟踪和动态分群。

```javascript
import { getCohortManager, initCohortManager, COHORT_RULES } from './monetization/cohortManager.js';

// 初始化
initCohortManager(userId);

const cohort = getCohortManager();

// 同步用户属性（从其他系统）
cohort.syncFromSystem();

// 获取用户分群
const cohorts = cohort.getCohorts();
console.log('所属分群:', cohorts); // ['new_user', 'high_score']

// 检查特定分群
if (cohort.inCohort('whale')) {
  console.log('鲸鱼用户');
}

// 获取用户属性
const properties = cohort.getUserProperties();
console.log('用户属性:', properties);
```

**内置分群规则：**

| ID | 名称 | 条件 |
|----|------|------|
| new_user | 新用户 | 注册 7 天内 |
| active_user | 活跃用户 | 7 天登录 ≥ 3 次 |
| whale | 鲸鱼用户 | 累计消费 ≥ 100 元 |
| dolphin | 海豚用户 | 累计消费 20-100 元 |
| minnow | 小鱼用户 | 累计消费 < 20 元 |
| high_score | 高分玩家 | 最高分 ≥ 1000 |
| churn_risk | 流失风险 | 7 天未登录或高风险 |

### 2. 远程配置 (RemoteConfigManager)

Feature Flags 控制和远程配置下发。

```javascript
import { getRemoteConfigManager, initRemoteConfig, FEATURE_FLAGS } from './monetization/remoteConfigManager.js';

// 初始化
await initRemoteConfig();

const config = getRemoteConfigManager();

// 获取 Feature Flag
const adsEnabled = config.getFeatureFlag(FEATURE_FLAGS.ADS_INTERSTITIAL);
console.log('插屏广告:', adsEnabled ? '开启' : '关闭');

// 获取配置项
const adFrequency = config.getConfig('monetization.adFrequency.rewardedPerGame');
console.log('激励广告频率:', adFrequency);

// 本地覆盖（调试用）
config.setFeatureFlag(FEATURE_FLAGS.ADS_INTERSTITIAL, false);

// 灰度发布检查
const inRollout = config.isInRollout('new_feature', userId);
console.log('是否在灰度范围内:', inRollout);

// 获取完整配置
const fullConfig = config.getFullConfig();
```

**支持的 Feature Flags：**

- adsRewarded / adsInterstitial - 广告开关
- iap - 内购开关
- dailyTasks / leaderboard - 功能开关
- pushNotifications - 推送通知
- insightPanel / rlPanel - 面板开关

### 3. 指标埋点与漏斗分析

完整的事件追踪和漏斗分析系统。

```javascript
import { getAnalyticsTracker, initAnalyticsTracker, ANALYTICS_EVENTS, ANALYTICS_FUNNELS } from './monetization/analyticsTracker.js';

// 初始化
initAnalyticsTracker(userId);

const analytics = getAnalyticsTracker();

// 追踪事件
analytics.trackEvent('place_block', { x: 3, y: 4 });
analytics.trackEvent('clear_lines', { lines: 2, score: 40 });

// 获取漏斗分析
const onboardingFunnel = analytics.getFunnelAnalysis('onboarding');
console.log('引导完成率:', onboardingFunnel.overallConversion);

// 获取事件统计
const eventStats = analytics.getEventStats(7 * 24 * 60 * 60 * 1000);
console.log('7天事件统计:', eventStats);

// 获取会话统计
const sessionStats = analytics.getSessionStats();
console.log('平均会话时长:', sessionStats.avgSessionDuration);

// 获取用户旅程
const journey = analytics.getUserJourney(20);
console.log('最近20个事件:', journey);
```

**预定义漏斗：**

| ID | 名称 | 步骤 |
|----|------|------|
| onboarding | 新手引导 | 打开→开始→放置→消除→完成 |
| purchase | 付费转化 | 游戏→商店→选择→支付→完成 |
| ad_watch | 激励广告 | 触发→展示→点击→完成 |
| invite | 邀请流程 | 查看→点击→分享→注册→完成 |
| retention | 留存流程 | D1→D3→D7→D14→D30 |

### 4. 完整实验平台使用

```javascript
import { getExperimentPlatform, initExperimentPlatform } from './monetization/experimentPlatform.js';

// 初始化
await initExperimentPlatform(userId);

const platform = getExperimentPlatform();

// 1. 追踪事件
platform.track('game_end', { score: 1500, clears: 20 });

// 2. 获取实验配置
const variant = platform.getExperimentConfig('ad_frequency');
console.log('广告实验分组:', variant);

// 3. 获取 Feature Flag
if (platform.getFeatureFlag('newSkinUnlock')) {
  console.log('新皮肤功能已开启');
}

// 4. 获取用户分群
const cohorts = platform.getUserCohorts();
console.log('用户分群:', cohorts);

// 5. 获取漏斗分析
const funnel = platform.getFunnelAnalysis('onboarding');
console.log('引导转化率:', funnel.overallConversion);

// 6. 记录实验指标
platform.trackExperimentMetric('ad_frequency', 'revenue', 1.5);

// 7. 获取完整报告
const report = platform.getFullReport();
console.log('完整报告:', report);
```

### 后端 API 需求

```
GET  /api/config?version=1.0.0    - 获取远程配置
POST /api/cohorts                 - 同步用户分群
POST /api/analytics/events        - 批量上报事件
GET  /api/ab-tests?user_id=xxx    - 获取实验配置
POST /api/ab-tests/metrics        - 上报实验指标
```

---

## 运营数据分析平台

### 统一入口 (AnalyticsPlatform)

整合实时数据大屏、留存分析、转化预测的统一分析平台。

```javascript
import { getAnalyticsPlatform, initAnalyticsPlatform } from './monetization/analyticsPlatform.js';

// 初始化
initAnalyticsPlatform(userId);

// 获取平台实例
const analytics = getAnalyticsPlatform();
```

### 1. 实时数据大屏 (RealTimeDashboard)

实时核心指标展示和告警。

```javascript
import { getRealTimeDashboard, initRealTimeDashboard } from './monetization/realTimeDashboard.js';

// 初始化
initRealTimeDashboard();

const dashboard = getRealTimeDashboard();

// 获取当前指标
const metrics = dashboard.getCurrentMetrics();
console.log('用户指标:', metrics.user);
console.log('收入指标:', metrics.revenue);

// 获取汇总卡片
const cards = dashboard.getSummaryCards();
console.log('关键指标:', cards.map(c => `${c.title}: ${c.value}`));

// 获取历史趋势
const trend = dashboard.getHistoricalData(30);
console.log('30天趋势:', trend);

// 获取告警
const alerts = dashboard.getAlerts();
console.log('告警列表:', alerts);

// 注册实时更新监听
dashboard.onUpdate((metrics) => {
    console.log('数据更新:', metrics.timestamp);
});
```

**刷新配置：**
- 刷新间隔：10秒
- 最多数据点：60
- 支持的告警阈值可配置

### 2. 用户留存与转化漏斗 (RetentionAnalyzer)

用户留存率计算和转化漏斗分析。

```javascript
import { getRetentionAnalyzer, initRetentionAnalyzer } from './monetization/retentionAnalyzer.js';

// 初始化
initRetentionAnalyzer();

const retention = getRetentionAnalyzer();

// 记录用户会话（每次打开应用时调用）
retention.recordSession(userId);

// 获取留存率
const d1Rate = retention.getRetentionRate(1);
console.log('次日留存:', d1Rate.rate, '%');

// 获取所有留存率
const allRates = retention.getAllRetentionRates();
console.log('留存率:', allRates);

// 获取转化数据
const conversions = retention.getConversionData();
console.log('转化数据:', conversions);

// 获取预设漏斗
const funnels = retention.getPresetFunnels();
console.log('付费漏斗:', funnels.monetization);
console.log('活跃漏斗:', funnels.engagement);

// 获取用户生命周期阶段
const lifecycle = retention.getUserLifecycle(userId);
console.log('用户阶段:', lifecycle); // new/active/engaged/at_risk/dormant/churned

// 获取完整分析报告
const report = retention.getReport();
console.log('分析报告:', report);
```

**留存周期：**
- 1天、3天、7天、14天、30天、60天、90天

**预设漏斗：**
| 漏斗 | 步骤 |
|------|------|
| monetization | 注册→游戏→商店→选择→购买 |
| engagement | 打开→开始→完成→分享 |
| retention | D1→D3→D7→D14→D30 |

### 3. 付费转化预测模型 (PaymentPredictionModel)

基于用户特征的付费倾向预测。

```javascript
import { getPaymentPredictionModel, initPaymentPredictionModel } from './monetization/paymentPredictionModel.js';

// 初始化
initPaymentPredictionModel();

const model = getPaymentPredictionModel();

// 预测付费倾向
const prediction = model.predict();
console.log('预测分数:', prediction.score);
console.log('意向分段:', prediction.band);
console.log('建议动作:', prediction.action);

// 获取预测解释
const explanation = model.getExplanation();
console.log('正向因素:', explanation.positiveFactors);
console.log('负向因素:', explanation.negativeFactors);
console.log('建议:', explanation.recommendation);

// 获取用户价值预估
const userValue = model.getUserValue();
console.log('预估LTV:', userValue.ltv);
console.log('置信度:', userValue.confidence);
```

**特征权重：**

| 特征 | 权重 | 转换方式 |
|------|------|----------|
| is_whale | 0.15 | binary |
| games_played | 0.12 | log |
| daily_streak | 0.10 | linear |
| daily_active | 0.10 | linear |
| shop_visits | 0.08 | linear |
| user_level | 0.08 | linear |
| is_dolphin | 0.08 | binary |
| ... | ... | ... |

**付费分段：**
| 分数 | 分段 | 颜色 | 建议动作 |
|------|------|------|----------|
| ≥0.7 | 高意向 | 绿色 | 推送优惠 |
| ≥0.5 | 中等意向 | 橙色 | 引导体验 |
| ≥0.3 | 低意向 | 红色 | 持续观察 |
| <0.3 | 无意向 | 灰色 | 培养关系 |

### 4. 完整分析平台使用

```javascript
import { getAnalyticsPlatform, initAnalyticsPlatform } from './monetization/analyticsPlatform.js';

// 初始化
initAnalyticsPlatform(userId);

const analytics = getAnalyticsPlatform();

// 追踪事件（自动记录转化）
analytics.track('game_end', { score: 1500, clears: 20 });
analytics.track('iap_purchase', { product: 'monthly_pass', price: 28 });

// 获取完整报告
const report = analytics.getFullReport();
console.log('实时指标:', report.realtime);
console.log('留存分析:', report.retention);
console.log('转化预测:', report.prediction);

// 获取关键指标摘要
const keyMetrics = analytics.getKeyMetrics();
console.log('核心指标:', keyMetrics);

// 获取所有告警
const allAlerts = analytics.getAlerts();
console.log('告警列表:', allAlerts);

// 导出数据
const exportData = analytics.exportData();
console.log('导出数据:', exportData);
```

---

## 增强版新手引导系统 (EnhancedFTUE)

四阶段递进式引导：操作 → 策略 → 变现 → 社交

```javascript
import { getEnhancedFTUE, initEnhancedFTUE } from './onboarding/enhancedFTUE.js';

// 初始化
initEnhancedFTUE(userId);

const ftue = getEnhancedFTUE();
```

### 1. 四阶段递进设计

| 阶段 | 目标 | 时长 | 核心内容 |
|------|------|------|----------|
| operation | 基础操作 | 1-3关 | 方块放置、消除机制、游戏目标 |
| strategy | 策略思维 | 4-7关 | 连消、空间规划、优先级决策 |
| monetization | 付费引导 | 8-10关 | 道具解锁、优惠提示、商店初体验 |
| social | 社交互动 | 11-12关 | 分享炫耀、邀请好友、排行榜 |

### 2. 阶段管理

```javascript
// 获取当前阶段
const currentStage = ftue.getCurrentStage();
console.log('当前阶段:', currentStage); // operation/strategy/monetization/social

// 获取阶段进度
const progress = ftue.getStageProgress();
console.log('进度:', progress.current, '/', progress.total);

// 检查阶段完成
if (ftue.isStageComplete('operation')) {
    console.log('操作阶段已完成');
}

// 跳过当前阶段（谨慎使用）
ftue.skipCurrentStage();
```

### 3. 任务与触发

```javascript
// 获取当前任务
const task = ftue.getCurrentTask();
console.log('任务:', task.title);
console.log('指引:', task.guide);

// 完成任务
ftue.completeTask(task.id);

// 获取阶段任务列表
const tasks = ftue.getTasksForStage('monetization');
console.log('变现阶段任务:', tasks);

// 任务触发器示例
gameBlock.on('placed', () => ftue.checkTaskTrigger('block_placed'));
gameBlock.on('cleared', () => ftue.checkTaskTrigger('block_cleared'));
shop.on('opened', () => ftue.checkTaskTrigger('shop_opened'));
```

### 4. 奖励系统

```javascript
// 获取阶段奖励
const rewards = ftue.getStageRewards('operation');
console.log('操作阶段奖励:', rewards);

// 领取奖励
ftue.claimReward(rewards[0].id);

// 获取总奖励进度
const totalProgress = ftue.getTotalRewardProgress();
console.log('总进度:', totalProgress.completed, '/', totalProgress.total);

// 奖励类型
const rewardTypes = {
    coin: '金币',
    gem: '钻石',
    item: '道具',
    skin: '皮肤',
    vip: 'VIP体验'
};
```

### 5. 引导覆盖层

```javascript
// 显示引导覆盖层
ftue.showOverlay('tutorial', {
    target: '#game-board',
    message: '将方块拖放到空白位置',
    position: 'bottom'
});

// 高亮元素
ftue.highlightElement('#place-button', '点击放置方块');

// 隐藏引导层
ftue.hideOverlay();
```

### 6. 事件监听

```javascript
// 监听阶段变化
ftue.onStageChange((stage) => {
    console.log('进入新阶段:', stage);
    // 触发对应动画/音效
});

// 监听任务完成
ftue.onTaskComplete((task) => {
    console.log('任务完成:', task.id);
    // 显示完成动画
});

// 监听阶段完成
ftue.onStageComplete((stage) => {
    console.log('阶段完成:', stage);
    // 显示阶段奖励
    ftue.showStageRewardPopup(stage);
});
```

### 7. 与原有 FTUE 集成

```javascript
// 初始化时检查是否需要引导
if (ftue.shouldStartFTUE()) {
    ftue.startFTUE();
}

// 与原有 ftueManager 互补使用
import { getFTUEManager } from './onboarding/ftueManager.js';

const legacyFTUE = getFTUEManager();
if (legacyFTUE.shouldStartFTUE()) {
    // 原有基础引导
    legacyFTUE.startFTUE();
} else if (ftue.shouldStartFTUE()) {
    // 增强版进阶引导
    ftue.startFTUE();
}
```

### 8. 完整使用流程

```javascript
// 初始化
initEnhancedFTUE(userId);

const ftue = getEnhancedFTUE();

// 启动引导
if (ftue.shouldStartFTUE()) {
    const firstTask = ftue.startFTUE();
    ftue.showOverlay('tutorial', firstTask.guide);
}

// 游戏过程中检查触发
gameEvents.on('block_placed', () => ftue.checkTaskTrigger('block_placed'));
gameEvents.on('combo', () => ftue.checkTaskTrigger('combo'));
gameEvents.on('item_used', () => ftue.checkTaskTrigger('item_used'));
gameEvents.on('shop_opened', () => ftue.checkTaskTrigger('shop_opened'));

// 监听完成
ftue.onStageComplete((stage) => {
    showRewardAnimation(stage);
    if (stage === 'monetization') {
        // 弹出首充优惠
        paymentManager.showFirstPurchaseOffer();
    }
});

// 获取引导状态
const status = ftue.getStatus();
console.log('FTUE状态:', status);
// { isActive: true, currentStage: 'strategy', progress: 45 }
```

---

## 推送与召回系统

### 增强版推送通知系统 (PushNotificationSystem)

事件触发推送、内容模板化、效果追踪一体化系统。

```javascript
import { getPushNotificationSystem, initPushNotificationSystem, PUSH_TRIGGER_EVENTS } from './monetization/pushNotificationSystem.js';

// 初始化
initPushNotificationSystem();

const pushSystem = getPushNotificationSystem();
```

### 1. 事件触发推送

自动响应用户行为和系统事件。

```javascript
// 游戏完成时触发
pushSystem.trigger(PUSH_TRIGGER_EVENTS.GAME_COMPLETE, {
    score: 1500,
    bestScore: 1200
});

// 成就解锁时触发
pushSystem.trigger(PUSH_TRIGGER_EVENTS.ACHIEVEMENT_UNLOCK, {
    achievementName: '消除大师'
});

// 流失预警
pushSystem.trigger(PUSH_TRIGGER_EVENTS.CHURN_WARNING, {
    userId: userId,
    days: 3
});

// 限时优惠
pushSystem.trigger(PUSH_TRIGGER_EVENTS.LIMITED_OFFER, {
    offerName: '周卡5折',
    hours: 12
});
```

**触发事件类型：**

| 事件 | 触发场景 |
|------|----------|
| GAME_COMPLETE | 游戏结束时 |
| HIGH_SCORE | 打破纪录时 |
| ACHIEVEMENT_UNLOCK | 成就解锁时 |
| STREAK_MILESTONE | 连续登录里程碑 |
| CHURN_WARNING | 流失风险检测 |
| INACTIVE_3_DAYS | 3天未活跃 |
| INACTIVE_7_DAYS | 7天未活跃 |
| DAILY_BONUS | 每日奖励 |
| WEEKLY_REWARD | 周奖励 |
| LIMITED_OFFER | 限时优惠 |
| NEW_SKIN | 新皮肤上架 |
| FIRST_PURCHASE_WINDOW | 首充窗口 |
| SUBSCRIPTION_EXPIRE | 订阅过期 |
| RETURNING_USER | 回归用户 |

### 2. 推送内容模板

基于模板自动生成内容，支持变量替换。

```javascript
// 模板会自动填充变量
// 例如：{{bestScore}}, {{streak}}, {{hours}}, {{discount}}
```

**内置模板示例：**

```javascript
{
    title: '🎉 打破纪录！',
    body: '你创造了新的最高分：{{score}} 分！',
    icon: '🏆',
    actions: [
        { id: 'share', title: '炫耀一下' },
        { id: 'challenge', title: '发起挑战' }
    ]
}
```

### 3. 推送效果追踪

追踪推送的点击和转化。

```javascript
// 获取推送历史
const history = pushSystem.getHistory(20);
console.log('最近推送:', history);

// 获取推送统计
const stats = pushSystem.getStats();
console.log('总推送:', stats.total);
console.log('点击率:', stats.clickRate);
console.log('转化率:', stats.conversionRate);

// 追踪转化
pushSystem.trackConversion(PUSH_TRIGGER_EVENTS.LIMITED_OFFER, 'purchase');
```

**统计指标：**
- total: 总推送数
- sent: 成功发送
- clicked: 被点击
- converted: 成功转化
- clickRate: 点击率
- conversionRate: 转化率

### 4. 智能调度

定时推送和智能建议。

```javascript
// 调度延迟推送
pushSystem.schedulePush(
    PUSH_TRIGGER_EVENTS.DAILY_BONUS,
    3600000, // 1小时后
    {}
);

// 获取智能建议
const suggestions = pushSystem.getSmartSuggestions();
console.log('建议推送:', suggestions.map(s => s.eventType));

// 获取待执行任务
const scheduled = pushSystem.getScheduledTasks();
console.log('待推送:', scheduled.length);
```

### 5. 完整使用示例

```javascript
// 初始化
initPushNotificationSystem();

const push = getPushNotificationSystem();

// 触发推送
push.trigger(PUSH_TRIGGER_EVENTS.GAME_COMPLETE, {
    score: 1500,
    bestScore: 1200
});

// 监听通知点击（用户进入应用）
if (Notification.permission === 'granted') {
    // 点击统计自动追踪
}

// 获取效果分析
const stats = push.getStats();
console.log('推送效果:', stats);

// 获取智能建议（基于用户行为）
const suggestions = push.getSmartSuggestions();
if (suggestions.length > 0) {
    // 执行智能推送
    const next = suggestions[0];
    push.trigger(next.eventType, next.context);
}
```

---

## 难度曲线与留存系统

### 概述

整合 ML 难度预测、关卡进度、目标系统，提供完整的留存优化方案。

```javascript
import { initRetentionManager, getRetentionManager } from './retention/retentionManager.js';

initRetentionManager(userId);
const retention = getRetentionManager();
```

---

### ML 难度预测模型 (DifficultyPredictor)

基于玩家行为信号动态预测最佳难度等级。

```javascript
import { initDifficultyPredictor, predictDifficulty, recordGameResult } from './retention/difficultyPredictor.js';

// 初始化
initDifficultyPredictor();

// 预测推荐难度
const prediction = predictDifficulty(playerProfile);
console.log('推荐难度:', prediction.recommended);
console.log('置信度:', prediction.confidence);
console.log('特征:', prediction.features);

// 记录游戏结果（用于模型学习）
recordGameResult({
    score: 1500,
    clears: 20,
    achieved: true
});
```

**特征维度：**

| 类别 | 特征 | 权重 | 转换方式 |
|------|------|------|----------|
| performance | avgScore, avgClears, winRate | 0.15~0.18 | log/linear |
| behavior | avgPlacementTime, quickDecisionRate | 0.05~0.06 | linear |
| temporal | sessionsToday, daysSinceInstall | 0.04~0.08 | log |
| contextual | consecutiveFails, flowState | -0.12~0.10 | linear/categorical |

**输出等级：**

| 分数范围 | 难度等级 |
|----------|----------|
| 0~0.25 | easy |
| 0.25~0.5 | normal |
| 0.5~0.75 | hard |
| 0.75~1 | expert |

**启发式安全网（v1.12 修订）：**

加权分仅是基线；`applyHeuristics` 会按以下优先级覆写，确保玩家挣扎时**一定**能拿到更友好的难度：

| 触发条件 | 调整 | 说明 |
|----------|------|------|
| `consecutiveFails ≥ 3` | -0.15 | 连续失败软阈值 |
| `consecutiveFails ≥ 5` | -0.25（叠加 ≥3 时取较大者） | 连续失败硬阈值 |
| `consecutiveFails ≥ 7` | -0.35 | 兜底降难度 |
| `flowState === 'anxious'` | `min(score, 0.5) - 0.1` | 焦虑情绪强制压低且封顶 0.4 |
| `isInOnboarding` | `min(score, 0.3)` | 新手期保护 |
| `needsRecovery` | `min(score, 0.4)` | 复活/恢复期 |
| `playstyle === 'survival'` | `min(score, 0.5)` | 求生型上限 |
| `playstyle === 'perfect_hunter'` | `max(score, 0.6)` | 清屏型下限 |
| 夜间（`timeOfDay > 0.8`） | +0.05 | **仅在未触发任何安全网时**生效 |

> 修复：旧版本中夜间 +0.05 可能直接抵消 `consecutiveFails` 惩罚。新版加入 `inSafetyNet` 互斥，
> 保证 `{consecutiveFails: 5, flowState: 'anxious'}` 等典型挣扎场景在任何时段都返回 `< 0.5` 的难度评分。
> 对应回归测试见 `tests/retention.test.js > should handle consecutive failures`。

---

### 目标系统 (GoalSystem)

短期目标（单局可达）与长期目标（跨局累积）。

```javascript
import { initGoalSystem, getGoalSystem } from './retention/goalSystem.js';

const goalSystem = getGoalSystem();

// 初始化
goalSystem.init();

// 更新游戏进度
goalSystem.updateProgress({
    score: 1500,
    clears: 20,
    achieved: true
});

// 检查长期目标完成
const newlyCompleted = goalSystem.checkGoals();
console.log('新完成目标:', newlyCompleted);

// 生成短期目标
const shortTerm = goalSystem.generateShortTerm(gameStats);
console.log('短期目标:', shortTerm);

// 领取奖励
const reward = goalSystem.claimReward('complete_5_levels');
console.log('奖励:', reward);

// 获取进度摘要
const summary = goalSystem.getSummary();
console.log('总进度:', summary);
```

**短期目标类型：**

| 类型 | 阈值 | 说明 |
|------|------|------|
| score | 100, 250, 500, 1000, 2000, 5000 | 得分里程碑 |
| clear | 3, 5, 10, 15, 25, 50 | 消行里程碑 |
| survival | 10, 20, 30, 50, 75, 100 | 存活轮数 |
| combo | 3, 5, 10, 15, 20, 30 | 连消里程碑 |

**长期目标分类：**

| 分类 | 示例 | 奖励 |
|------|------|------|
| progression | 完成 5/10/20 关 | 100~500 币 + 10~50 钻 |
| collection | 累计 10K/50K/100K 分 | 500~2000 币 + 50~200 钻 |
| streak | 连续 3/7/30 天登录 | 100~1000 币 + 10~100 钻 |
| mastery | 完成 hard/expert 关卡 | 500~1000 币 + 50~100 钻 |

---

### 关卡进度系统 (LevelProgression)

关卡包、章节解锁、星级收集。

```javascript
import { initLevelProgression, getLevelProgression } from './retention/levelProgression.js';

const progression = getLevelProgression();

// 初始化
initLevelProgression();

// 获取当前关卡
const current = progression.getCurrentLevel();
console.log('当前关卡:', current);

// 开始关卡
const level = progression.startLevel('L06');
console.log('关卡配置:', level);

// 完成关卡
const result = progression.completeLevel('L06', {
    stars: 3,
    achieved: true,
    score: 1500,
    clears: 25
});
console.log('星级:', result.stars);
console.log('下一关:', result.nextLevel);

// 获取关卡状态
const status = progression.getLevelStatus('L10');
console.log('状态:', status.isUnlocked, status.stars);

// 获取章节进度
const chapters = progression.getChapters();
chapters.forEach(c => {
    console.log(`${c.icon} ${c.name}: ${c.completedCount}/${c.totalLevels}`);
});

// 获取总进度
const summary = progression.getSummary();
console.log('总进度:', summary);
```

**章节配置：**

| 章节 | 关卡 | 解锁条件 |
|------|------|----------|
| 新手入门 (🌱) | L01~L05 | 默认解锁 |
| 进阶之路 (📈) | L06~L12 | 完成 5 关 |
| 高手挑战 (🏔️) | L13~L20 | 完成 12 关 |

---

### 统一留存管理器 (RetentionManager)

整合所有模块的统一 API。

```javascript
// 初始化
initRetentionManager(userId);
const retention = getRetentionManager();

// 游戏结束后调用
const afterGame = retention.afterGameEnd({
    score: 1500,
    clears: 20,
    achieved: true,
    perfectClears: false
});
console.log('完成目标:', afterGame.completedGoals);

// 获取难度建议
const diffRec = retention.getDifficultyRecommendation(playerProfile);
console.log('推荐:', diffRec.recommended);

// 获取活跃目标
const goals = retention.getActiveGoals();
console.log('短期目标:', goals.shortTerm);
console.log('长期目标:', goals.longTerm);

// 获取留存洞察
const insights = retention.getRetentionInsights();
console.log('留存趋势:', insights.retention.trend);
console.log('关卡进度:', insights.levelProgress);
console.log('建议:', insights.recommendations);

// 关卡操作
retention.startLevel('L06');
retention.completeLevel('L06', { stars: 2, achieved: true, score: 800, clears: 15 });
```

**留存洞察输出：**

```javascript
{
    retention: { trend: 'improving', improvement: 0.15 },
    levelProgress: { completed: 8, total: 20, percent: '40.0' },
    stars: { current: 15, max: 60, percent: '25.0' },
    goals: { active: 5, completed: 2 },
    recommendations: [
        { type: 'retention', priority: 'high', message: '玩家表现下滑，建议降低难度' },
        { type: 'progression', priority: 'medium', message: '关卡进度较慢，建议增加激励' }
    ]
}
```

---

### 与现有系统集成

**与 adaptiveSpawn 集成：**

```javascript
// 在游戏开始时获取难度建议
const prediction = getDifficultyPredictor().predict(playerProfile);
const strategyId = prediction.recommended;

// 传递给自适应出块
const strategy = resolveAdaptiveStrategy(strategyId, profile, score, runStreak, boardFill, spawnCtx);
```

**与 levelManager 集成：**

```javascript
// 关卡模式使用进度系统
if (gameMode === 'level') {
    const progression = getLevelProgression();
    const level = progression.startLevel(levelId);
    const levelManager = new LevelManager(level);
}
```

**与 analytics 集成：**

```javascript
// 追踪留存指标
const insights = getRetentionManager().getRetentionInsights();
analytics.track('retention_insight', {
    trend: insights.retention.trend,
    levelProgress: insights.levelProgress.percent,
    stars: insights.stars.current
});
```

---

## 社交玩法系统

### 概述

整合多人游戏、好友系统、公会系统的统一社交平台。

```javascript
import { initSocialManager, getSocialManager } from './social/socialManager.js';

initSocialManager(userId);
const social = getSocialManager();
```

---

### 多人游戏模式 (MultiplayerGame)

支持竞技、合作、挑战三种模式。

```javascript
import { getMultiplayerGame, GAME_MODES, PLAYER_STATES } from './social/multiplayerGame.js';

const mp = getMultiplayerGame();
```

**1. 模式设置**

```javascript
// 竞技模式（1v1~4 人比分数）
mp.setMode(GAME_MODES.COMPETITIVE);

// 合作模式（双人协作挑战）
mp.setMode(GAME_MODES.COOPERATIVE);

// 挑战模式（限时任务，最多 8 人）
mp.setMode(GAME_MODES.CHALLENGE);

// 获取当前模式
console.log('当前模式:', mp.getCurrentMode());
```

**2. 玩家管理**

```javascript
// 加入游戏
mp.joinGame('player_2', 'Player 2');

// 离开游戏
mp.leaveGame('player_2');

// 准备就绪
mp.setReady(_userId);

// 开始游戏（所有玩家准备后自动开始）
// mp.startGame();

// 获取玩家列表
const players = mp.getPlayers();
console.log('玩家:', players.map(p => p.name));
```

**3. 分数同步**

```javascript
// 更新本地分数
mp.updateScore(score, clears);

// 监听分数更新
mp.on('score_updated', (data) => {
    console.log('玩家:', data.playerId, '分数:', data.score);
});

// 结束游戏并获取结果
const results = mp.finishGame();
console.log('结果:', results);
```

**4. 游戏结果**

```javascript
// 竞技模式结果
{
    mode: 'competitive',
    winner: { id: 'player_1', name: 'Player 1', score: 1500 },
    rankings: [
        { id: 'player_1', name: 'Player 1', score: 1500, rank: 1 },
        { id: 'player_2', name: 'Player 2', score: 1200, rank: 2 }
    ],
    localRank: 1,
    isWinner: true
}

// 合作模式结果
{
    mode: 'cooperative',
    totalScore: 3000,
    totalClears: 45,
    rating: 'A'  // S/A/B/C/D
}
```

**状态机：** waiting → ready → playing → finished

---

### 好友系统 (FriendSystem)

好友管理、状态追踪、对战系统。

```javascript
import { getFriendSystem, FRIEND_STATES, BATTLE_STATES } from './social/friendSystem.js';

const friends = getFriendSystem();
```

**1. 好友管理**

```javascript
// 添加好友
friends.addFriend('friend_123', 'Friend Name');

// 删除好友
friends.removeFriend('friend_123');

// 检查是否为好友
if (friends.isFriend('friend_123')) {
    console.log('是好友');
}

// 获取好友列表
const friendList = friends.getFriends();
console.log('好友数:', friendList.length);

// 获取好友信息
const friend = friends.getFriend('friend_123');
```

**2. 好友请求**

```javascript
// 发送好友请求
friends.sendFriendRequest('user_456', 'Hello!');

// 获取待处理请求
const requests = friends.getFriendRequests();
console.log('请求数:', requests.length);

// 响应请求
friends.respondToFriendRequest(requestId, true); // 接受
friends.respondToFriendRequest(requestId, false); // 拒绝
```

**3. 好友对战**

```javascript
// 发送对战邀请
const invite = friends.inviteToBattle('friend_123');
console.log('邀请状态:', invite.state);

// 接受邀请
friends.acceptBattleInvite();

// 拒绝邀请
friends.declineBattleInvite();

// 开始对战
friends.startBattle();

// 结束对战
const result = friends.finishBattle({
    myScore: 1500,
    friendScore: 1200
});
console.log('胜负:', result.won);
```

**4. 对战历史**

```javascript
// 获取历史记录
const history = friends.getBattleHistory(10);
history.forEach(b => {
    console.log(`vs ${b.friendName}: ${b.myScore} vs ${b.friendScore}, 胜: ${b.won}`);
});

// 获取好友战绩
const stats = friends.getFriendStats('friend_123');
console.log('战绩:', stats.battleCount, '胜率:', stats.winRate);
```

---

### 公会系统 (GuildSystem)

公会创建、成员管理、任务活动。

```javascript
import { getGuildSystem, GUILD_ROLES, GUILD_STATES } from './social/guildSystem.js';

const guild = getGuildSystem();
```

**1. 公会创建与管理**

```javascript
// 创建公会
const newGuild = guild.createGuild('Block Masters', 'BM', 'Welcome!');
console.log('公会:', newGuild.name, '标签:', newGuild.tag);

// 搜索公会
const results = guild.searchGuilds('Block');
console.log('搜索结果:', results);

// 申请加入
guild.applyToGuild('guild_123');

// 加入公会
guild.joinGuild(guildData);

// 离开公会
guild.leaveGuild();
```

**2. 成员管理**

```javascript
// 获取公会信息
const myGuild = guild.getGuild();
console.log('公会名:', myGuild.name, '等级:', myGuild.level);

// 获取成员列表
const members = guild.getMembers();
console.log('成员数:', members.length);

// 我的角色
const myRole = guild.getMyRole();
console.log('角色:', myRole); // leader/officer/member/recruit

// 任命职位（仅会长）
if (myRole === GUILD_ROLES.LEADER) {
    guild.setMemberRole('user_123', GUILD_ROLES.OFFICER);
}

// 踢出成员（仅会长/官员）
guild.kickMember('user_123');
```

**3. 贡献系统**

```javascript
// 贡献资源
guild.contribute(100);
console.log('贡献度:', guild.getMyMember()?.contribution);

// 贡献榜
const leaderboard = guild.getLeaderboard();
leaderboard.forEach((m, i) => {
    console.log(`${i+1}. ${m.name}: ${m.contribution}`);
});
```

**4. 公告与活动**

```javascript
// 发布公告（仅官员）
guild.postAnnouncement('本周公会赛即将开始！');

// 获取公告
const announcements = guild.getGuild()?.announcements;

// 添加活动记录
guild.addActivity({
    type: 'weekly_quest',
    data: { score: 500 }
});
```

**5. 公会设置**

```javascript
// 更新设置（仅会长）
guild.updateSettings({
    requireApproval: true,
    minLevel: 5,
    public: false
});
```

**职位权限：**

| 职位 | 邀请 | 踢人 | 任命 | 发公告 | 修改设置 |
|------|------|------|------|--------|----------|
| 会长 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 官员 | ✓ | ✓ | ✗ | ✓ | ✗ |
| 成员 | ✗ | ✗ | ✗ | ✗ | ✗ |
| 新人 | ✗ | ✗ | ✗ | ✗ | ✗ |

---

### 统一社交管理器 (SocialManager)

整合所有社交功能。

```javascript
import { getSocialManager } from './social/socialManager.js';

const social = getSocialManager();

// 初始化
social.init(userId);

// 快速开始匹配
const mp = social.startCompetitiveMatch();
const mp = social.startCoopMatch();
const mp = social.startChallenge();

// 好友对战
social.inviteFriend('friend_123');
social.acceptInvite();
social.declineInvite();

// 公会操作
social.createGuild('My Guild', 'MG', 'Description');
social.joinGuild('guild_123');

// 获取社交概览
const summary = social.getSocialSummary();
console.log('好友:', summary.friendCount);
console.log('在线:', summary.onlineFriends);
console.log('公会:', summary.guildName);

// 获取活跃事件
const events = social.getActiveEvents();
events.forEach(e => console.log('事件:', e.type));
```

---

### 与现有系统集成

**与排行榜集成：**

```javascript
const leaderboard = getSocialLeaderboard();

// 获取好友排行榜
const friendsRank = leaderboard.getTop(LEADERBOARD_TYPES.FRIENDS, 10);

// 获取全球排行榜
const globalRank = leaderboard.getTop(LEADERBOARD_TYPES.GLOBAL, 10);

// 提交分数
leaderboard.submitScore(1500, 'weekly');

// 获取排名
const myRank = leaderboard.getRank('weekly');
console.log('我的排名:', myRank);
```

**与 analytics 集成：**

```javascript
const social = getSocialManager();

analytics.track('social_action', {
    type: 'friend_battle',
    result: 'win'
});

analytics.track('guild_activity', {
    action: 'contribute',
    amount: 100
});
```

---

## 后端架构优化

### 微服务架构

```
services/
├── user_service/       # 用户服务
│   ├── app.py         # Flask 应用
│   └── models.py     # 数据模型
├── game_service/      # 游戏服务
│   ├── app.py         # Flask 应用
│   └── models.py      # 数据模型
├── analytics_service/ # 分析服务
│   ├── app.py         # Flask 应用
│   └── models.py      # 数据模型
└── common/           # 公共模块
    ├── config.py     # 配置管理
    ├── database.py   # 数据库连接
    ├── models.py     # 基础模型
    ├── exceptions.py # 异常定义
    ├── logging.py    # 日志配置
    └── cdn.py        # CDN 配置
```

---

### 服务配置

**环境变量：**

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=openblock
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# CDN
CDN_ENABLED=false
CDN_BASE_URL=https://cdn.openblock.example.com

# 服务
USE_POSTGRES=false
USE_REDIS=false
```

---

### 1. 用户服务 (User Service)

端口：8001

负责用户认证、个人资料、好友关系管理。

```python
from services import create_user_service

app = create_user_service()
```

**API 端点：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/users | 创建用户 |
| GET | /api/users/:id | 获取用户 |
| PUT | /api/users/:id | 更新用户 |
| GET | /api/users/:id/profile | 获取资料 |
| PUT | /api/users/:id/profile | 更新资料 |
| POST | /api/auth/login | 登录 |
| POST | /api/auth/logout | 登出 |
| POST | /api/auth/refresh | 刷新令牌 |

---

### 2. 游戏服务 (Game Service)

端口：8002

负责游戏会话、排行榜、成就、关卡进度。

```python
from services import create_game_service

app = create_game_service()
```

**API 端点：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/games | 开始游戏 |
| PUT | /api/games/:id | 更新游戏状态 |
| POST | /api/games/:id/end | 结束游戏 |
| GET | /api/leaderboards | 获取排行榜 |
| GET | /api/leaderboards/:user/rank | 获取用户排名 |
| GET | /api/achievements/:user | 获取成就 |
| GET | /api/levels/:user | 获取关卡进度 |

**Redis 排行榜：**

```python
# 更新排行榜
update_leaderboard(user_id, score, mode='global', period='weekly')

# 获取排行榜
leaderboard = get_leaderboard(mode='global', period='weekly', limit=100)
```

---

### 3. 分析服务 (Analytics Service)

端口：8003

负责事件追踪、留存分析、转化漏斗、收入统计。

```python
from services import create_analytics_service

app = create_analytics_service()
```

**API 端点：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/analytics/events | 追踪事件 |
| GET | /api/analytics/events | 获取事件 |
| GET | /api/analytics/realtime | 实时统计 |
| GET | /api/analytics/retention | 留存数据 |
| GET | /api/analytics/funnels | 转化漏斗 |
| GET | /api/analytics/cohorts | 用户群组 |
| GET | /api/analytics/revenue | 收入统计 |

---

### 4. CDN 静态资源

```python
from services.common.cdn import get_cdn_url, get_versioned_cdn_url

# 获取 CDN URL
asset_url = get_cdn_url('/assets/image.png')

# 获取版本化 URL
versioned_url = get_versioned_cdn_url('/assets/bundle.js', '1.0.0')
```

**配置：**

```bash
CDN_ENABLED=true
CDN_BASE_URL=https://cdn.example.com
CDN_ASSETS_PATH=/assets
```

---

### 5. Docker 部署

```bash
cd services
docker-compose up -d
```

**服务端口映射：**

| 服务 | 端口 |
|------|------|
| PostgreSQL | 5432 |
| Redis | 6379 |
| User Service | 8001 |
| Game Service | 8002 |
| Analytics Service | 8003 |
| API Gateway | 8000 |

---

### 6. 数据库迁移

```bash
# 初始化 PostgreSQL 数据库
python services/migrations/init_db.py
```

**创建的数据表：**

- users, user_profiles, friend_relationships, sessions
- game_sessions, leaderboards, achievements, level_progress
- analytics_events, user_activities, revenue

---

### 与现有单体后端集成

```python
# 渐进式迁移策略
# 1. 新功能使用微服务
# 2. 原有功能保持 Flask单体
# 3. 逐步迁移数据库到 PostgreSQL

# 使用示例
from services.common import get_redis_client, get_postgres_db

# Redis 缓存
redis = get_redis_client()
redis.set('cache_key', 'value', ex=3600)

# PostgreSQL 查询
db = get_postgres_db()
result = db.execute_one('SELECT * FROM users WHERE id = %s', (user_id,))
```

---

## 监控与报警系统

### 概述

整合前端错误监控、服务端指标、异常检测的完整监控体系。

---

### 1. 前端错误监控 (ErrorTracker)

自动捕获 JS 错误，支持 Sentry 兼容协议。

```javascript
import { getErrorTracker, ERROR_LEVELS, ERROR_CATEGORIES } from './monitoring/errorTracker.js';

const tracker = getErrorTracker();

// 初始化
tracker.init({
    dsn: 'https://xxx@sentry.io/project',
    environment: 'production',
    release: '1.0.0',
    sampleRate: 1.0,
    ignoreErrors: ['ResizeObserver']
});

// 捕获错误
try {
    riskyOperation();
} catch (e) {
    tracker.captureException(e, { extra: 'context' });
}

// 手动上报
tracker.captureMessage('User clicked invalid button', 'warning');

// 添加行为轨迹
tracker.addBreadcrumb({
    category: 'ui',
    message: 'Button clicked',
    data: { buttonId: 'submit' }
});

// 设置用户
tracker.setUser(userId, { plan: 'premium' });

// 获取错误统计
const stats = tracker.getStats();
console.log('总错误:', stats.total);
console.log('按级别:', stats.byLevel);
```

**API 端点：** `POST /api/monitoring/errors`

---

### 2. 性能监控 (PerformanceMonitor)

页面加载、FPS、交互延迟监控。

```javascript
import { getPerformanceMonitor } from './monitoring/performanceMonitor.js';

const perf = getPerformanceMonitor();

// 初始化
perf.init({
    sampleRate: 0.5,
    fpsThreshold: 30,
    slowClickThreshold: 200
});

// 获取性能摘要
const summary = perf.getSummary();
console.log('FCP:', summary.fcp, 'ms');
console.log('LCP:', summary.lcp, 'ms');
console.log('FPS:', summary.fps);
console.log('慢点击:', summary.slowClicks);

// 获取 FPS 统计
const fps = perf.getFpsStats();
console.log('当前:', fps.current, 'avg:', fps.average);
```

---

### 3. 服务端指标 (MetricsCollector)

Prometheus 兼容指标收集。

```python
from services import get_metrics_collector, record_request, record_game_event, record_revenue

collector = get_metrics_collector()

# 计数器
collector.increment('http_requests_total', {'method': 'GET', 'status': '200'})
collector.increment('game_events_total', {'event_type': 'game_start'})

# 仪表盘
collector.set_gauge('active_users', 150)

# 直方图
collector.observe('http_request_duration_seconds', 0.523)

# 获取指标
metrics = collector.get_json()
```

**API 端点：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /metrics | Prometheus 格式 |
| GET | /metrics/json | JSON 格式 |

---

### 4. 异常检测 (AnomalyDetector)

基于统计的实时异常检测。

```python
from services import AnomalyDetector, get_alert_manager

detector = AnomalyDetector(window_size=100, threshold=3.0)

# 添加数据点
result = detector.add(value)
if result:
    print(f"异常检测: {result['severity']}")

# 获取统计
stats = detector.get_stats()
print('均值:', stats['mean'], '标准差:', stats['std'])

# 获取历史告警
alerts = detector.get_alerts(since=time.time() - 3600)
```

**检测的指标：**

- response_time: 响应时间
- error_rate: 错误率
- active_users: 活跃用户
- revenue: 收入
- queue_size: 队列大小

---

### 5. 告警系统 (AlertManager)

多渠道告警通知。

```python
from services import get_alert_manager, create_alert

alert_manager = get_alert_manager()

# 创建告警
alert = create_alert(
    title='High Error Rate',
    message='Error rate exceeded 5%',
    severity='warning',
    source='anomaly_detection'
)

# 获取告警
alerts = alert_manager.get_alerts(
    severity='warning',
    resolved=False,
    limit=50
)

# 确认告警
alert_manager.acknowledge_alert(alert_id)

# 解决告警
alert_manager.resolve_alert(alert_id)

# 获取统计
counts = alert_manager.get_counts()
```

**告警级别：** critical, error, warning, info

**API 端点：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /alerts | 获取告警列表 |
| POST | /alerts | 创建告警 |
| POST | /alerts/:id/acknowledge | 确认 |
| POST | /alerts/:id/resolve | 解决 |
| GET | /alerts/summary | 告警摘要 |

---

### 6. 监控服务

端口：8004

```bash
# 独立运行
python services/monitoring/app.py
```

**完整 API：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /health | 健康检查 |
| GET | /metrics | Prometheus 指标 |
| GET | /metrics/json | JSON 指标 |
| POST | /monitoring/errors | 前端错误 |
| POST | /monitoring/events | 游戏事件 |
| POST | /monitoring/anomaly/:name | 异常检测 |
| GET | /monitoring/anomaly/:name/stats | 异常统计 |
| GET | /alerts | 告警列表 |
| GET | /alerts/summary | 告警摘要 |

---

### 7. Docker 部署

监控服务已集成到 docker-compose：

```bash
cd services
docker-compose up -d
```

| 服务 | 端口 |
|------|------|
| Monitoring Service | 8004 |

---

## 安全防护系统

### 概述

完整的安全防护体系：请求签名、频率限制、支付验签、数据加密。

---

### 1. 请求签名 (RequestSigner)

防请求篡改，HMAC-SHA256 签名。

```python
from services.security import RequestSigner, verify_request_signature, create_signed_request

signer = RequestSigner(secret_key='your_secret')

# 创建签名
signature = signer.sign('POST', '/api/games', body={'score': 1500})
print('签名:', signature)

# 验证签名
valid, error = verify_request_signature(
    signature='1700000000.xxx',
    method='POST',
    path='/api/games',
    body={'score': 1500}
)
print('有效:', valid, '错误:', error)

# 创建签名请求
request = create_signed_request('POST', '/api/games', body={'score': 1500})
print('请求:', request)
```

**生成格式：** `{timestamp}.{signature}`

**有效期：** 5 分钟

**Flask 中间件：**

```python
from services.security import create_signature_middleware

middleware = create_signature_middleware(secret_key='your_secret')
# app.after_request(middleware)
```

---

### 2. 频率限制 (RateLimiter)

Token bucket 算法，支持自定义限制和封禁。

```python
from services.security import RateLimiter, check_rate_limit, get_rate_limit_info

limiter = RateLimiter()

# 设置自定义限制
limiter.set_limit('game_api', RateLimitConfig(requests=100, window=60))

# 检查限制
allowed, info = limiter.check('user_123', 'game_api')
if not allowed:
    print('限制:', info['retry_after'])

# 封禁用户
limiter.block('user_123', duration=300)

# 获取统计
stats = limiter.get_stats('user_123', 'game_api')
print('允许:', stats['allowed'], '拒绝:', stats['denied'])
```

**预设限制：**

| 键 | 请求数 | 窗口(秒) |
|-----|--------|----------|
| default | 100 | 60 |
| api | 1000 | 60 |
| auth | 10 | 60 |
| payment | 20 | 60 |
| game | 200 | 60 |

**Flask 中间件：**

```python
from services.security import create_rate_limit_middleware

middleware = create_rate_limit_middleware('api')
# app.before_request(middleware)
```

---

### 3. 支付回调验签 (PaymentVerifier)

验证支付回调签名，支持多种支付提供商。

```python
from services.security import PaymentVerifier, verify_payment_callback

verifier = PaymentVerifier(secret_key='payment_secret')

# 完整验证
valid, error, payment_info = verifier.verify_callback(
    data={
        'order_id': 'order_123',
        'amount': 9.99,
        'status': 'success',
        'timestamp': 1700000000
    },
    signature='xxx',
    provider='custom',
    check_timestamp=True,
    check_amount=9.99,
    check_status=['success', 'completed']
)

print('有效:', valid)
if payment_info:
    print('订单:', payment_info['order_id'])
```

**验证项：**
- HMAC 签名
- 时间戳（默认 1 小时）
- 金额
- 订单 ID
- 支付状态

**支持提供商：** apple, google, stripe, custom

**Flask 中间件：**

```python
from services.security import create_payment_verification_middleware

middleware = create_payment_verification_middleware()
# app.before_request(middleware)
```

---

### 4. 数据加密 (DataEncryptor)

AES-GCM 加密，支持 dict/str/list。

```python
from services.security import DataEncryptor, encrypt_sensitive_data, decrypt_sensitive_data

encryptor = DataEncryptor(key='your_key')

# 加密
encrypted = encryptor.encrypt({'card': '4111111111111111'})
print('加密:', encrypted[:50] + '...')

# 解密
decrypted = encryptor.encrypt(encrypted)
print('解密:', decrypted)

# 便捷函数
encrypted = encrypt_sensitive_data({'password': 'secret'})
decrypted = decrypt_sensitive_data(encrypted)
```

**其他工具：**

```python
from services.security import TokenGenerator, PasswordHasher, DataMasker

# Token 生成
token = TokenGenerator.generate_token(32)
api_key = TokenGenerator.generate_api_key()
hashed = TokenGenerator.hash_token(token)

# 密码哈希
hashed = PasswordHasher.hash_password('password123')
valid = PasswordHasher.verify_password('password123', hashed)

# 数据脱敏
masked_email = DataMasker.mask_email('user@example.com')  # u***@example.com
masked_phone = DataMasker.mask_phone('1234567890')  # ******7890
masked_card = DataMasker.mask_card('4111111111111111')  # ************1111
masked = DataMasker.mask_dict({'email': 'test@test.com', 'password': 'secret'})
```

---

### 5. 环境变量

```bash
# 签名
API_SECRET_KEY=your_api_secret

# 支付
PAYMENT_SECRET_KEY=your_payment_secret

# 加密
ENCRYPTION_KEY=your_encryption_key_32byte
```

---

## v1.12 新增模块入口与设计意图（变更说明）

> 本节梳理本次合入的商业化/留存/社交/FTUE 模块的 **设计契约** 与 **关键 bug 修复**，便于后续接入与排错。

### 1. `monetization/index.js` — 按需加载主入口

**入口契约：** 业务代码只需 `initMonetization(game)` 与 `shutdownMonetization()`。

**实现要点：**

- `LAZY_MODULES` 是“受 feature flag 控制的模块清单”，`initMonetization` **会按声明顺序串行**调用 `_loadModule + _invokeInit`。
- `_invokeInit` 优先匹配 `init<Name>`（如 `initAdAdapter`），找不到再回退 `init`；`adTrigger` / `commercialInsight` 会自动注入 `game` 实例。
- 模块若导出 `shutdown`，会被收集到 `_cleanups`，在 `shutdownMonetization()` 中统一调用，支持热插拔。
- `injectMonStyles` **改为静态导入**（`./styles.js`）。早期版本误用了未定义的全局符号，导致 `_initCoreModules()` 在严格模式下抛 `ReferenceError`，已删除该死函数。

**修复对照：**

| 旧症状 | 根因 | 新行为 |
|--------|------|--------|
| `ReferenceError: injectMonStyles is not defined` | `_initCoreModules` 内调用未导入的全局符号 | 顶部 `import { injectMonStyles } from './styles.js'`，`initMonetization` 第一步同步注入样式 |
| `LAZY_MODULES` 与 `_loadModule` 完全死代码 | `initMonetization` 自己硬编码每个模块 | 重构为统一驱动 `LAZY_MODULES`，新增模块只需追加一行配置 |

### 2. `monetization/ad/adDecisionEngine.js` — 广告决策引擎

**入口契约：** `getAdDecisionEngine().requestAd(scene, context)` 返回 `{ allowed, adType, reason, vector }`。

**关键修复（运算符优先级）：**

```javascript
// ❌ 旧代码：?? 优先级低于 <，等价于 (a < b) ?? c
if (vector.payerScore < thresholds.lowPayerTask ?? 0.35) { ... }

// ✅ 新代码：保护默认阈值不被布尔短路吞掉
if (vector.payerScore < (thresholds.lowPayerTask ?? 0.35)) { ... }
```

涉及 4 处比较：`lowPayerTask` / `protectPayerScore` / `rewardedRecommend` / `interstitialRecommend`。
旧实现下 `thresholds.*` 一旦缺省，整个比较直接基于 `undefined`，导致高付费玩家被错误地判定为可展示插屏。

**导出：** `AD_TYPES` / `AD_SCENES` 通过统一的 `export { AD_TYPES, AD_SCENES };` 单次导出，避免与文件顶部 `const` 声明冲突。

### 3. `onboarding/enhancedFTUE.js` — 增强版新手引导

**入口契约：** `initEnhancedFTUE()` + `getEnhancedFTUE()`，对外消费 `FTUE_STAGES` / `FTUE_STEPS_V2` / `CONVERSION_GOALS` 三个常量。

**修复：** 之前把 `FTUE_STAGES` 与 `FTUE_STEPS_V2` 同时在声明处 `export const` 又在文件末再次 `export {}`，触发 “Duplicate export” 解析错误。
新版只在末尾补出 `CONVERSION_GOALS` 的 named export。

> 注：本模块仅持有“引导阶段元数据”。真正调用 `applyGameEndProgression` 与 `getFeatureFlag` 的副作用集中在 `ftueManager.js`，因此 enhancedFTUE 不再依赖这两个工具。

### 4. `monetization/realTimeDashboard.js`、`monetization/retentionAnalyzer.js`、`monetization/paymentManager.js` 等

**设计原则：**

- 这些模块**默认离线运行**，所有未来要接服务端的位置都用 `// 后续接入...` 注释占位，避免在未启用时也强行 `import` 后端配置（曾导致 `getApiBaseUrl` 在未配置环境下报 `no-undef`）。
- `analyticsTracker._trySyncEvent(_event)` 等参数前缀 `_` 用于声明“接口预留参数”，符合本仓库 ESLint 约定 (`argsIgnorePattern: '^_'`)。

### 5. ESLint 策略（`eslint.config.js`）

`no-empty` 调整为 `{ allowEmptyCatch: true }`：商业化/社交/推送等模块大量使用 `try { ... } catch {}` 来吞掉非关键 IO 错误（`localStorage`、analytics 上报、推送注册等）。该例外**仅适用于 catch 块**，普通 `if {}` / `while {}` 仍按默认规则报错。

### 6. 验证清单

执行下面三条命令应同时通过（lint **0 errors**；674/674 tests pass；vite 构建产物完成）：

```bash
npm run lint
npm test
npm run build
```

---

## v1.13 玩家生命周期与成熟度系统

> 本节记录玩家生命周期管理、成熟度划分、流失预警和分层运营的核心模块。

### 1. 玩家成熟度模型 (`retention/playerMaturity.js`)

**功能：** 基于玩家行为数据计算成熟度等级 L1-L4，为分层运营提供依据。

**成熟度分级：**

| 等级 | 名称 | 特征 | 占比 |
|------|------|------|------|
| L1 | 探索者 | 完成 FTUE，未形成习惯 | 40-50% |
| L2 | 爱好者 | 每日登录，有活跃任务 | 25-30% |
| L3 | 资深玩家 | 深度参与，追求段位/收藏 | 15-20% |
| L4 | 核心玩家 | 高活跃度，高付费贡献 | 5-10% |

**核心接口：**

```javascript
import { calculateMaturityScore, getMaturityLevel, getPlayerMaturity, updateMaturity } from './retention/playerMaturity.js';

// 计算成熟度分数 (0-100)
const score = calculateMaturityScore(playerData);

// 获取成熟度等级
const level = getMaturityLevel(score); // 'L1' | 'L2' | 'L3' | 'L4'

// 更新成熟度数据
const result = updateMaturity({
    sessionCount: 10,
    totalScore: 5000,
    maxLevel: 15,
    totalSpend: 100,
    adsWatched: 20
});

// 获取成熟度洞察
import { getMaturityInsights, getRecommendedActions } from './retention/playerMaturity.js';
const insights = getMaturityInsights();
// { level, score, scoreTrend, sessionTrend, churnRisk, totalSessions, ... }
```

### 2. 生命周期阶段判定 (`retention/playerLifecycleDashboard.js`)

**功能：** 基于天数和游戏局数判定玩家所处生命周期阶段。

**阶段定义：**

| 阶段 | 天数 | 局数 | 核心策略 |
|------|------|------|----------|
| onboarding | D0-D3 | ≤10 | 新手引导与首日体验 |
| exploration | D4-D14 | ≤50 | 玩法探索与习惯养成 |
| growth | D15-D30 | ≤200 | 深度参与与付费转化 |
| stability | D31-D90 | ≤500 | 长期价值维护 |
| veteran | D90+ | >500 | 核心价值与生态贡献 |

**核心接口：**

```javascript
import { getPlayerLifecycleStage, getLifecycleConfig, getLifecycleDashboardData, shouldTriggerIntervention } from './retention/playerLifecycleDashboard.js';

// 获取玩家阶段
const stage = getPlayerLifecycleStage({ daysSinceInstall: 7, totalSessions: 30 }); // 'exploration'

// 获取完整 dashboard 数据
const data = getLifecycleDashboardData(playerData);
// { stage, stageName, stageColor, maturityLevel, churnRisk, recommendedActions, ... }

// 检查是否需要干预
const triggers = shouldTriggerIntervention(playerData);
// [{ type: 'churn_prevention', priority: 'high', reason: '...' }, ...]
```

### 3. 流失预警模型 (`retention/churnPredictor.js`)

**功能：** 基于玩家行为趋势预测流失风险，提供早期干预触发点。

**风险等级：**

| 风险等级 | 风险值区间 | 干预策略 |
|----------|------------|----------|
| stable | 0-14% | 常规保持 |
| low | 15-29% | 温和唤醒 |
| medium | 30-49% | 定向激励 |
| high | 50-69% | 强力召回 |
| critical | 70-100% | 紧急干预 |

**核心接口：**

```javascript
import { recordSessionMetrics, getChurnPrediction, shouldSendChurnAlert, getChurnIntervention } from './retention/churnPredictor.js';

// 记录会话指标
recordSessionMetrics({
    sessionCount: 5,
    avgScore: 200,
    avgDuration: 180,
    engagement: 0.6
});

// 获取流失预测
const prediction = getChurnPrediction();
// { risk: 45, level: 'medium', trend: 5, isWorsening: true, ... }

// 检查是否需要发送告警
const alert = shouldSendChurnAlert({ stage: 'exploration' });
// { shouldAlert: true, priority: 'high', reason: '...' }

// 获取干预内容
const intervention = getChurnIntervention({ stage: 'exploration' });
// { type: '激励召回', reward: [...], message: '...' }
```

### 4. 智能难度适配 (`retention/difficultyAdapter.js`)

**功能：** 基于玩家成熟度和流失风险动态调整游戏难度。

**适配策略：**

- L1 玩家：stressOffset -15, 启用挫败感减压
- L2 玩家：stressOffset -5, 适度减压
- L3 玩家：stressOffset 0, 标准难度
- L4 玩家：stressOffset +5, 提升挑战

**核心接口：**

```javascript
import { getDifficultyAdapterConfig, adjustStressForPlayer, shouldTriggerFrustrationRelief, getDifficultyRecommendation } from './retention/difficultyAdapter.js';

// 获取难度适配配置
const config = getDifficultyAdapterConfig();
// { stressOffset, maxStress, enableFrustrationRelief, enableBeginnerBonus, recommendedProfile, churnRisk, ... }

// 调整基础压力值
const result = adjustStressForPlayer(50);
// { stress: 35, config: {...}, reason: '新手保护-快速成功' }

// 检查是否触发挫败感减压
const relief = shouldTriggerFrustrationRelief(consecutiveNoClear, playerScore);
// { shouldTrigger: true, action: { type: 'hint', params: { count: 1 } }, reason: '...' }

// 获取难度推荐
const recommendation = getDifficultyRecommendation();
// { recommendedProfile, stressAdjustment, warnings: [...], metadata: {...} }
```

### 5. 社交引入节点 (`retention/socialIntroTrigger.js`)

**功能：** 在玩家生命周期关键节点引入社交功能。

**触发节点：**

| 社交动作 | 触发阶段 | 阈值 | 奖励 |
|----------|----------|------|------|
| add_friend | exploration | 10局/5天 | 提示券 x1 |
| share_replay | exploration | 15局/7天 | 金币 x50 |
| join_guild | growth | 30局/14天 | 金币 x100 |
| challenge_friend | growth | 50局/21天 | 胜利奖励翻倍 |
| invite_friend | stability | 100局/30天 | 限定皮肤碎片 x5 |

**核心接口：**

```javascript
import { checkSocialIntroTrigger, triggerSocialIntro, completeSocialIntro, getSocialProgress } from './retention/socialIntroTrigger.js';

// 检查是否触发社交引导
const check = checkSocialIntroTrigger(gameCount, daysSinceInstall);
// { shouldTrigger: true, nextIntro: { id: 'add_friend', config: {...} }, availableIntros: [...] }

// 触发社交引导
triggerSocialIntro('add_friend');
// { success: true, introId, message, reward, location }

// 完成社交引导
completeSocialIntro('add_friend', { friendId: 'user_123' });
// { success: true, introId, reward: [...], completionBonus: ... }

// 获取社交进度
const progress = getSocialProgress();
// { completed: 2, total: 5, progress: 40, friendCount: 3, hasGuild: true, milestones: [...] }
```

### 6. 付费初体验漏斗 (`retention/firstPurchaseFunnel.js`)

**功能：** 追踪玩家付费转化路径，优化首充转化率。

**漏斗阶段：**

```
awareness (认知) → interest (兴趣) → consideration (考虑) → purchase (购买) → retention (复购)
```

**首充优惠：**

| 礼包 | 价格 | 触发条件 | 包含内容 |
|------|------|----------|----------|
| starter | ¥1 | 3-14天, 10-100局 | 提示券x10, 金币x100, VIP3天 |
| value | ¥6 | 7-30天, 30-200局 | 提示券x30, 金币x500, 炸弹x5, VIP7天 |
| premium | ¥30 | 14-60天, 50-300局 | 提示券x100, 金币x2000, 彩虹x10, VIP30天 |

**核心接口：**

```javascript
import { trackFunnelEvent, recordPurchase, getRecommendedOffer, getFunnelAnalytics } from './retention/firstPurchaseFunnel.js';

// 追踪漏斗事件
trackFunnelEvent('view_shop');
trackFunnelEvent('click_product');
trackFunnelEvent('start_checkout');
// { currentStage: 'consideration', stageName: '考虑' }

// 记录购买
recordPurchase({ productId: 'starter_pack', price: 1 });
// { id, productId, price, isFirst: true }

// 获取推荐优惠
const offer = getRecommendedOffer(daysSinceInstall, totalGames);
// { available: true, offer: {...}, reason: '...' }

// 获取漏斗分析
const analytics = getFunnelAnalytics();
// { currentStage, stageConversion: {...}, conversionRate: 15, firstPurchasePrice: 1, ... }
```

### 7. VIP体系 (`retention/vipSystem.js`)

**功能：** 为核心玩家提供专属VIP权益，提升长期价值。

**VIP等级：**

| 等级 | 名称 | 累计分数 | 专属权益 |
|------|------|----------|----------|
| VIP0 | 普通玩家 | 0 | 无 |
| VIP1 | VIP1 | ≥1000 | 移除插屏广告, 1.2倍每日奖励 |
| VIP2 | VIP2 | ≥5000 | 移除所有广告, 1.5倍奖励, 7天道具保护 |
| VIP3 | VIP3 | ≥20000 | 专属商店, 优先客服 |
| VIP4 | VIP4 | ≥50000 | 测试版优先体验, 自定义头像 |
| VIP5 | VIP5 | ≥100000 | 专属名字颜色, 专属客服频道 |

**核心接口：**

```javascript
import { updateVipScore, getVipStatus, getVipBenefits, canAccessVipFeature } from './retention/vipSystem.js';

// 更新VIP分数
const result = updateVipScore(5000);
// { currentLevel: 'vip2', levelName: 'VIP2', badge: 'silver', leveledUp: true, previousLevel: 'vip1' }

// 获取VIP状态
const status = getVipStatus();
// { currentLevel, levelName, badge, lifetimeScore, nextLevel: {...}, progress, benefits: [...] }

// 获取当前等级权益
const benefits = getVipBenefits();
// [{ type: 'ad_removal', value: 'all', description: '移除所有广告', active: true }, ...]

// 检查功能访问权限
const access = canAccessVipFeature('exclusive_shop');
// { allowed: true, value: true } 或 { allowed: false, required: 'vip2' }
```

### 8. 统一留存管理器 (`retention/retentionManager.js`)

**功能：** 整合所有留存模块，提供统一API。

```javascript
import { initRetentionManager, getRetentionManager } from './retention/retentionManager.js';

// 初始化
initRetentionManager(userId);

// 获取管理器
const retention = getRetentionManager();

// 游戏结束后更新
const result = retention.afterGameEnd({
    score: 500,
    clears: 10,
    achieved: ['first_clear'],
    perfectClears: 2
});
// { completedGoals: [...], canClaim: true }

// 获取难度推荐
const difficulty = retention.getDifficultyRecommendation(playerProfile);

// 获取活跃目标
const goals = retention.getActiveGoals();
// { shortTerm: [...], longTerm: [...] }

// 获取关卡进度
const level = retention.getLevelSummary();
```

### 测试验证

执行所有留存相关测试：

```bash
npm test -- tests/playerMaturity.test.js tests/playerLifecycleDashboard.test.js tests/churnPredictor.test.js tests/difficultyAdapter.test.js tests/socialIntroTrigger.test.js tests/firstPurchaseFunnel.test.js tests/vipSystem.test.js
```

应通过 **82 tests**。

### 与《玩家生命周期与成熟度运营蓝图》双分制的关系

v1.13 引入的是 **单分制成熟度** `MaturityScore`（落在 L1–L4），同时承担"分群"与"运营决策权重"两个职责。后续的
[玩家生命周期与成熟度运营蓝图](../operations/PLAYER_LIFECYCLE_MATURITY_BLUEPRINT.md) 在不破坏 v1.13 接口的
前提下，把这两个职责拆分为：

- **`SkillScore`**（驱动 M0–M4 成熟度 band）：只看玩法行为信号（盘面熟练、决策质量、消行成就等），**不掺入付费 / 广告**。
- **`ValueScore`**（驱动报价、频控、IAA↔IAP 切换）：只看商业化信号（IAP 总额、广告曝光、留存稳定度），**不参与 band 判定**。
- **`MatureIndex = α·SkillScore + (1-α)·ValueScore`**（决策可观测）：用于报表/同屏标签的统一索引。

向后兼容契约（已被 `tests/playerMaturity.test.js` 锁定）：

| v1.13 接口 | 蓝图后行为 |
|------------|-----------|
| `calculateMaturityScore(playerData)` | 等价 `calculateSkillScore(playerData)`，旧调用方无感 |
| `getMaturityLevel(score)` 返回 `'L1'..'L4'` | 不变；新增 `getMaturityBand(score)` 返回 `'M0'..'M4'`（M0 ≈ 未达 L1，其他与 L1–L4 一一对应） |
| `getPlayerMaturity()` | 字段在 v1.13 基础上**新增** `skillScore` / `valueScore` / `matureIndex` / `band` 4 项；旧字段全部保留 |
| i18n key `maturity.L1`–`L4` | 不变；如需 M-band 文案另起 `maturity.M0`–`M4`（默认未提供，由策略层自定义） |

**因此本章节的 5 个模块（`churnPredictor` / `difficultyAdapter` / `firstPurchaseFunnel` / `socialIntroTrigger` /
`vipSystem`）继续以 v1.13 单分制接口工作即可**；如需用 ValueScore 做付费分层（例如 VIP 入口的"高价值核心"识别），
直接读取 `getPlayerMaturity().valueScore` 不需要改动现有判断分支。

---

文档版本：1.13.0
更新日期：2026-05-12