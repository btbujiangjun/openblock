# 商业运营改进分析（Commercial Operations Review）

> 版本：1.0 · 日期：2026-04-21  
> 视角：商业运营（Growth / Monetization Operations）  
> 前置文档：[MONETIZATION.md](./MONETIZATION.md)（v3）、[COMPETITOR_USER_ANALYSIS.md](../domain/COMPETITOR_USER_ANALYSIS.md)

**逐项落地状态（61 条）**见 [COMMERCIAL_IMPROVEMENTS_CHECKLIST.md](./COMMERCIAL_IMPROVEMENTS_CHECKLIST.md)（含 API、代码路径与「脚手架/已实现」标注）。

---

## 导言：当前商业化能力评估

Open Block 已建立完整的商业化**基础设施**（IAA Stub、IAP Stub、分群引擎、赛季通行证、LTV 预测），但从**商业运营视角**看，仍存在两类根本性缺口：

1. **变现能力停留在 Stub（模拟）层**：真实 SDK 未接入，没有产生分毫真实收入
2. **运营闭环断裂**：缺少数据看板、A/B 测试、活动系统等运营必需工具——即使接入真实 SDK，也无法科学地调优和增长

以下按优先级分层列出所有改进点，并给出具体方案。

---

## 目录

1. [P0 · 真实变现接入（立即阻塞）](#1-p0--真实变现接入)
2. [P1 · 运营数据看板（关键决策工具）](#2-p1--运营数据看板)
3. [P2 · A/B 测试框架（科学调优）](#3-p2--ab-测试框架)
4. [P3 · 价格体系与 IAP 漏斗优化](#4-p3--价格体系与-iap-漏斗优化)
5. [P4 · 广告频控与体验平衡](#5-p4--广告频控与体验平衡)
6. [P5 · 运营活动系统（动态内容）](#6-p5--运营活动系统)
7. [P6 · 社交传播与病毒系数](#7-p6--社交传播与病毒系数)
8. [P7 · 用户召回体系完善](#8-p7--用户召回体系完善)
9. [优先级矩阵总览](#9-优先级矩阵总览)
10. [KPI 基线定义](#10-kpi-基线定义)

---

## 1. P0 · 真实变现接入

**现状**：`adAdapter.js`、`iapAdapter.js` 均处于 `stubMode=true`，所有广告展示为弹窗模拟，IAP 为确认框模拟。**不产生任何真实收入**。

### 1.1 广告 SDK 接入

#### 接入路径建议（优先级排序）

| 平台 | SDK | 适用场景 | eCPM 均值（休闲） |
|------|-----|---------|----------------|
| **Google AdMob** | `window.adsbygoogle` / AdMob Web Beta | PWA / Web 首选 | ¥8–20 |
| **AppLovin MAX** | MAX Web SDK | 竞价（Bidding）最优 | ¥12–35 |
| **Unity Ads** | Unity Web Monetization | 休闲游戏生态匹配 | ¥10–28 |
| **Meta Audience Network** | FAN Web | 社交定向精准 | ¥15–40 |

#### 接入改造点（最小侵入性）

`adAdapter.js` 的 `setAdProvider(provider)` 接口已预留，真实接入只需：

```javascript
// 接入 AdMob（示例）
import { setAdProvider } from './adAdapter.js';

setAdProvider({
    showRewarded: async (reason) => {
        return new Promise(resolve => {
            googletag.pubads()... // 真实 AdMob 调用
            resolve({ rewarded: true });
        });
    },
    showInterstitial: async () => {
        // 真实插屏调用
    }
});
```

**待办**：
- [ ] 申请 AdMob 账号，生成广告单元 ID
- [ ] 在 `index.html` 引入 AdMob Web SDK
- [ ] 在 `featureFlags.js` 将 `stubMode: true` 改为生产环境 `false`

### 1.2 IAP 支付接入

#### 支付渠道建议

| 渠道 | 适用 | 手续费 | 开发工作量 |
|------|------|--------|----------|
| **Stripe Web** | PC/PWA 全平台 | 2.9% + ¥0.3 | 低（已有接口） |
| **微信支付 JS-SDK** | 国内微信内置浏览器 | 0.6% | 中 |
| **支付宝 JSAPI** | 国内支付宝内置 | 0.6% | 中 |
| **Apple IAP** | iOS Safari PWA | 30% | 高（需 App Store 账号） |

**待办**：
- [ ] Stripe 账号 → 生成 Publishable Key
- [ ] `iapAdapter.js` 中的 `setIapProvider` 注入真实 Stripe 流程
- [ ] 服务端 `server.py` 新增 `/api/payment/verify` 对账接口（防刷单）
- [ ] 国内用户判断：根据 IP/语言识别后切换支付宝/微信

---

## 2. P1 · 运营数据看板

**现状**：`monPanel.js` 提供了「商业化模型训练面板」，但面向**技术人员**，展示的是分群信号、模型参数等。运营人员需要的是**业务指标看板**。

**缺口**：没有任何运营向的指标仪表盘（留存率、ARPDAU、转化漏斗、分群趋势）。

### 2.1 需要的关键指标

#### 留存层

| 指标 | 定义 | 目标基线 | 数据来源 |
|------|------|---------|---------|
| **D1 留存** | 次日再游率 | ≥40% | `sessions` 表 |
| **D7 留存** | 第7天再游率 | ≥20% | `sessions` 表 |
| **D30 留存** | 第30天再游率 | ≥8% | `sessions` 表 |
| **Session 长度** | 平均单次游戏时长 | ≥4 分钟 | `sessions.duration` |
| **每日局数** | 用户日均游戏局数 | ≥3 局 | `sessions` 表 |

#### 变现层

| 指标 | 定义 | 目标基线 | 数据来源 |
|------|------|---------|---------|
| **ARPDAU** | 每日活跃用户平均收入 | ≥¥0.15 | 广告收益 + IAP |
| **广告 Fill Rate** | 广告请求填充率 | ≥85% | `adAdapter` 埋点 |
| **激励视频 CVR** | 看完广告/弹出率 | ≥75% | `adTrigger` 埋点 |
| **IAP 首购率** | 付费玩家/活跃用户 | ≥1.5% | `iapAdapter` 埋点 |
| **LTV_30d 实际值** | 真实 vs 预测误差 | <20% 误差 | 收益对账 |

#### 用户层

| 指标 | 定义 | 目标 |
|------|------|------|
| **分群分布** | A/B/C/D/E 各占比 | D 类占比 >8% |
| **段位流失** | 各分群 7 日未游率 | C 类 <15% |
| **局间任务完成率** | miniGoals 完成/生成 | >55% |
| **小目标触发转化** | 看广告兑换/任务完成 | >30% |

### 2.2 看板技术方案

**建议**：在 `server.py` 中新增 `/api/ops/dashboard` 聚合接口，在 `docs.html` 侧边栏增加「运营看板」入口，复用现有 Bootstrap 风格。

```python
# server.py 新增 /api/ops/dashboard
@app.route('/api/ops/dashboard', methods=['GET'])
def ops_dashboard():
    """运营看板聚合接口（按日期范围）"""
    days = int(request.args.get('days', 7))
    # 留存、局数、分群分布、任务完成率等
    ...
```

**待办**：
- [ ] `server.py` 新增 `/api/ops/dashboard` 聚合查询（留存/ARPDAU/分群趋势）
- [ ] 在 `web/docs/` 目录新建 `ops-dashboard.html` 运营看板页
- [ ] `docs.html` 侧边栏增加「运营看板」快捷入口

---

## 3. P2 · A/B 测试框架

**现状**：所有商业化参数（广告频率、IAP 价格、弹出时机）均为单一值，无法验证优化假设。

**问题**：没有 A/B 测试能力，等于在盲目猜测最优参数。

### 3.1 需要 A/B 测试的关键变量

| 测试变量 | 实验组设置 | 对照组 | 核心指标 |
|---------|----------|--------|---------|
| 广告弹出时机 | 游戏结束后 3s | 立即弹 | 广告 CVR、次日留存 |
| 激励广告触发条件 | 连续 3 次无消 | 连续 5 次 | 激励广告曝光/次 |
| IAP 首购价格 | ¥6 入门包 | ¥12 入门包 | IAP CVR、ARPU |
| 复活弹窗倒计时 | 4 秒 | 8 秒 | 复活转化率 |
| 小目标难度 | easy 档 n×0.8 | 原始 n | 任务完成率、留存 |

### 3.2 轻量 A/B 框架设计

```javascript
// web/src/abTest.js（新建）
const AB_SALT = 'openblock_ab_v1';

/**
 * 根据用户 ID 和实验名稳定分桶
 * @param {string} userId
 * @param {string} experiment  实验名
 * @param {number} buckets     分桶数（默认2）
 * @returns {number} 0 ~ buckets-1
 */
export function getBucket(userId, experiment, buckets = 2) {
    // 简单哈希确保同一用户在同一实验中恒定分桶
    const hash = [...`${AB_SALT}:${experiment}:${userId}`]
        .reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
    return hash % buckets;
}

/**
 * 获取实验组参数
 * @param {string} experiment  实验名
 * @param {Array}  variants    各桶的参数值
 */
export function getVariant(userId, experiment, variants) {
    const bucket = getBucket(userId, experiment, variants.length);
    return variants[bucket];
}
```

**待办**：
- [ ] 新建 `web/src/abTest.js`（哈希分桶，无后端依赖）
- [ ] 对「复活倒计时」、「小目标难度」、「广告触发阈值」接入 A/B 分桶
- [ ] `server.py` 新增 `/api/ab/report` 接收实验数据，存入 `ab_events` 表
- [ ] 1 周后对比各组核心指标，选择胜出方案

---

## 4. P3 · 价格体系与 IAP 漏斗优化

**现状**：`iapAdapter.js` 中有 4 个固定产品（移除广告 ¥18、提示包 ¥6、周卡 ¥12、月卡 ¥30），缺乏**首购引导**和**动态礼包**设计。

### 4.1 价格体系缺口

#### 当前产品目录问题

| 问题 | 说明 | 影响 |
|------|------|------|
| 无入门钩子 | 最低 ¥6，对新用户仍有摩擦 | 首购率低 |
| 无限时礼包 | 无折扣感/紧迫感 | 冲动购买无触发 |
| 无年卡/终身 | 订阅只有周卡/月卡 | C 类鲸鱼无长期产品 |
| 价格固定 | 所有用户同一价格 | D 类高价值用户未被充分挖掘 |

#### 建议补充的产品

```javascript
// 补充到 iapAdapter.js PRODUCTS
starter_pack: {
    id: 'starter_pack',
    name: '新手礼包',
    desc: '提示 ×3 + 皮肤 1 款（仅首购可用）',
    price: '¥3',            // 低门槛首购引导
    priceNum: 3,
    type: 'one_time',
    firstPurchaseOnly: true,
},
weekly_pass_discount: {
    id: 'weekly_pass_discount',
    name: '限时周卡（7折）',
    desc: '7天每日奖励翻倍，限时特惠',
    price: '¥8',            // ¥12→¥8 折扣版
    priceNum: 8,
    type: 'limited_time',
    expireHours: 48,        // 48h 倒计时
},
annual_pass: {
    id: 'annual_pass',
    name: '年度通行证',
    desc: '365天每日奖励 + 全皮肤 + 去广告',
    price: '¥88',
    priceNum: 88,
    type: 'subscription',
    period: 'yearly',
},
```

### 4.2 IAP 转化漏斗优化

```
曝光（弹出 IAP 界面）
    → 查看商品详情
        → 点击购买
            → 完成支付
                → 首购
```

**各环节优化点**：

| 漏斗节点 | 当前问题 | 改进方案 |
|---------|---------|---------|
| 曝光时机 | 只在游戏结束/复活触发 | 增加「好局完成后」主动推荐（损失厌恶低时更易接受） |
| 产品展示 | 列表平铺，无视觉层次 | 使用「推荐标签」突出高转化产品，热门商品置顶 |
| 购买障碍 | 没有「已有其他用户购买」社交证明 | 增加购买人数显示（虚拟或真实） |
| 首购后续 | 无留存钩子 | 首购后7天推送「回归礼包」（续费折扣） |

**待办**：
- [ ] `iapAdapter.js` 增加 `starter_pack`、`weekly_pass_discount`、`annual_pass`
- [ ] 新建 IAP 展示 UI（分层卡片，高亮「推荐」商品）
- [ ] 接入首购特判逻辑（`firstPurchaseOnly` 标记）
- [ ] 限时礼包倒计时组件

---

## 5. P4 · 广告频控与体验平衡

**现状**：`adTrigger.js` 中有 `MAX_REWARDED_PER_GAME = 3` 的单局上限，但没有：
- 跨局全局频控（每日上限）
- 广告冷却时间（相邻两次的最小间隔）
- 付费用户自动跳过（已有 `isAdsRemoved` 标记，但插屏无差异化）

### 5.1 广告频控参数建议

```javascript
// adTrigger.js 缺失的控制参数
const AD_CONFIG = {
    rewarded: {
        maxPerGame: 3,       // 单局上限（现有）
        maxPerDay: 12,       // 日上限（缺失）
        cooldownMs: 90_000,  // 两次之间最短间隔 90s（缺失）
    },
    interstitial: {
        minSessionsBeforeFirst: 3,  // 新用户前3局不弹（缺失）
        cooldownMs: 180_000,        // 3分钟间隔（缺失）
        skipForPaidUsers: true,     // 付费用户跳过（缺失）
    },
    banner: {
        enabled: false,    // 暂不开启 Banner（eCPM 低，影响布局）
    }
};
```

### 5.2 广告体验评分（Ad Experience Score）

建议引入「广告体验分」自动评估：

```
体验分 = 100
    - (本日激励视频次数 - 8) × 5   [超出8次扣分]
    - (本日插屏次数 - 4) × 10      [超出4次重罚]
    + 看完率 × 10                  [用户主动看加分]
```

若体验分 < 60，触发「休养期」（48h 内降低广告频率），防止流失。

**待办**：
- [ ] `adTrigger.js` 增加日上限计数器（`localStorage` 跨局持久）
- [ ] 增加冷却时间（`lastAdTs` 记录上次展示时间戳）
- [ ] 插屏：新用户前 3 局豁免 + 付费用户静默跳过
- [ ] 实现广告体验分评估，自动触发「休养期」

---

## 6. P5 · 运营活动系统

**现状**：赛季通行证的任务和奖励完全**硬编码**在 `seasonPass.js`（`CURRENT_SEASON` 对象），无法通过服务端动态下发活动内容。

**问题**：
- 节庆活动（春节皮肤、周年庆限时模式）需要**上线改代码**才能生效
- A/B 测试不同活动内容无法实施
- 多地区差异化运营无法支持

### 6.1 运营活动配置化方案

```
┌──────────────────────────────────────────────────┐
│              运营活动管理（后端）                    │
│  /api/ops/campaign                               │
│  ├─ 当前活动列表（id, type, startTs, endTs）      │
│  ├─ 活动内容（任务、奖励、UI皮肤、特效）            │
│  └─ 分群定向（target: ['C', 'D'] 只对C/D推送）    │
└────────────────────────────┬─────────────────────┘
                             │ 下发（启动时 fetch）
┌────────────────────────────▼─────────────────────┐
│              前端活动系统（新建）                   │
│  campaignManager.js                              │
│  ├─ fetchCampaigns()    拉取当前有效活动            │
│  ├─ isActive(id)        判断活动是否对本用户生效     │
│  └─ renderBanner(id)    渲染活动入口横幅            │
└──────────────────────────────────────────────────┘
```

#### 活动类型设计

| 活动类型 | 触发场景 | 示例 |
|---------|---------|------|
| `seasonal_skin` | 节日期间 | 春节皮肤（红色方块主题）限时解锁 |
| `double_xp` | 周末 | 周末双倍赛季积分 |
| `flash_sale` | 运营需要 | 月卡48小时7折 |
| `milestone_challenge` | 里程碑激活 | 累计消除1000行送皮肤 |
| `recall_gift` | 7日未登录用户 | 「回来就送」限时道具包 |

**待办**：
- [ ] `server.py` 新增 `/api/ops/campaign` 接口（活动 CRUD）
- [ ] 新建 `web/src/campaignManager.js`（活动拉取、渲染、分群过滤）
- [ ] `seasonPass.js` 的任务配置改为从服务端读取（fallback 本地硬编码）
- [ ] 数据库新增 `campaigns` 表

---

## 7. P6 · 社交传播与病毒系数

**现状**：`replayShare.js` 和 `leaderboard.js` 已存在，但：
- 回放分享：**无 UI 入口**（未集成到游戏结算界面）
- 排行榜：**只有自己的历史**（无多用户对比）
- 无任何邀请机制（口碑传播路径断裂）

**影响**：K 因子（Viral Coefficient）= 0，所有新用户依赖买量，CAC 居高不下。

### 7.1 社交传播改进路径

#### 分享机制（低成本，高 ROI）

```
游戏结算界面
  → 「分享成绩」按钮
      → Web Share API（手机）/ 复制链接（PC）
          → 带 UTM 参数的分享链接（?utm_source=share&utm_medium=friend&ref=userId）
              → 新用户安装后，分享者获得奖励（激励循环）
```

| 分享内容 | 实现方式 | 病毒潜力 |
|---------|---------|---------|
| 成绩截图 | `canvas.toBlob()` + Web Share API | 中 |
| 对战挑战 | 「挑战我的 {score} 分」链接 | 高 |
| 回放片段 | Canvas 录制 GIF（已有 `replayShare.js`） | 高 |

#### 排行榜改造

```
现状：本地存储（无多用户）
目标：
  ├─ 全服排行（现有 /api/leaderboard 接口，但 UI 未展示）
  ├─ 好友排行（基于分享链接引入的关联用户）
  └─ 周榜（每周重置，提供持续竞争动机）
```

**待办**：
- [ ] 游戏结算界面增加「分享」按钮（Web Share API + fallback 复制链接）
- [ ] 分享链接携带 `ref=userId` 参数，`channelAttribution.js` 解析后发放邀请奖励
- [ ] `leaderboard.js` 接入 `/api/leaderboard` 接口，渲染多用户排行榜 UI
- [ ] 增加周榜（服务端按周区间聚合分数）

---

## 8. P7 · 用户召回体系完善

**现状**：`pushNotification.js` 实现了 Web Push 框架，但：
- 召回条件仅有「沉默 24h」一种
- 消息文案分群差异化有限
- 无「回归礼包」触达（用户回来没有钩子）

### 8.1 召回分层设计

| 沉默时长 | 分群 | 触达方式 | 内容 |
|---------|------|---------|------|
| 24h | 所有 | Web Push | 「你的连续积分记录还在等你」 |
| 3天 | A/B | Web Push | 「3天没玩了！今天的小目标还没完成」 |
| 7天 | C/D | Web Push + 回归礼包 | 「久违了！回归专属礼包已备好」 |
| 14天 | C/D | 邮件（若已登录） | 「你还记得自己的最高分吗？」+ 新内容介绍 |
| 30天 | 所有 | 渠道再营销（DSP） | 程序化广告触达（需 UUID 上传 DMP） |

### 8.2 回归礼包设计

```javascript
// 新增：回归礼包（沉默 7 天后回来的用户）
recall_gift: {
    id: 'recall_gift',
    name: '回归礼包',
    desc: '欢迎回来！提示 ×3 + 本周免费赛季积分 ×50',
    condition: 'silence_7d',   // 7天未登录
    expires: 48,               // 领取后有效48h
    free: true,                // 免费，不需要付费
}
```

**待办**：
- [ ] `pushNotification.js` 增加 3 天、7 天分层触达
- [ ] 新增「回归礼包」逻辑（沉默 7 天后首次开局弹出）
- [ ] `server.py` 新增 `/api/recall-gift/claim` 接口防止重复领取

---

## 9. 优先级矩阵总览

```
投入产出比
  高 │ P0 真实变现接入  ──────────────── P2 A/B 测试框架
     │ (能产生收入)         (低成本验证假设)
     │
  中 │ P3 价格体系优化  P6 社交传播      P5 活动系统
     │ (提升 ARPU)    (降低 CAC)        (内容持续性)
     │
  低 │ P1 运营看板      P4 广告频控      P7 召回体系
     │ (辅助决策)      (体验保障)        (长期留存)
     └─────────────────────────────────────────────
       短期（2周）        中期（1月）       长期（季度）
                          实施周期
```

### 分阶段实施路线图

#### 第一阶段（2 周）—— 真实变现

| 任务 | 负责模块 | 工作量 |
|------|---------|--------|
| AdMob Web SDK 接入 | `adAdapter.js` | 3天 |
| Stripe 支付接入 | `iapAdapter.js` + `server.py` | 3天 |
| `featureFlags` 生产配置 | `featureFlags.js` | 0.5天 |
| 支付验签接口 | `server.py /api/payment/verify` | 1天 |

#### 第二阶段（1 个月）—— 运营工具

| 任务 | 负责模块 | 工作量 |
|------|---------|--------|
| 运营数据看板 | `server.py` + `ops-dashboard.html` | 5天 |
| A/B 测试框架 | `abTest.js` | 2天 |
| IAP 漏斗优化 | `iapAdapter.js` + UI | 3天 |
| 广告频控完善 | `adTrigger.js` | 2天 |

#### 第三阶段（季度）—— 规模化运营

| 任务 | 负责模块 | 工作量 |
|------|---------|--------|
| 活动配置化系统 | `campaignManager.js` + `server.py` | 7天 |
| 社交分享 + 排行榜 | `replayShare.js` + `leaderboard.js` | 5天 |
| 召回体系分层 | `pushNotification.js` + `server.py` | 4天 |
| DSP 再营销对接 | 外部对接 | 外包 |

---

## 10. KPI 基线定义

### 变现健康度指标

| 指标 | 冷启动目标（1月） | 成熟目标（6月） |
|------|------------|------------|
| ARPDAU | ¥0.05 | ¥0.20 |
| IAP 首购率 | 0.5% | 2.0% |
| 激励视频完播率 | 60% | 80% |
| 日均激励视频曝光/用户 | 4次 | 10次 |
| LTV_30d（D 类） | ¥3 | ¥12 |

### 留存健康度指标

| 指标 | 基线（当前） | 目标 |
|------|----------|------|
| D1 留存 | — | 40% |
| D7 留存 | — | 20% |
| 小目标完成率 | — | 55% |
| 赛季任务参与率 | — | 35% |
| 召回 Push 点开率 | — | 12% |

### 传播效率指标

| 指标 | 目标 |
|------|------|
| K 因子（病毒系数） | ≥0.15（每10位用户带1.5位新用户） |
| 分享率 | ≥8%（结算界面触达率） |
| 邀请转化率 | ≥25%（点开链接→安装） |

---

## 附录：商业运营 vs 已实现技术能力对照

| 运营需求 | 现有技术能力 | 状态 |
|---------|-----------|------|
| 真实广告收入 | `adAdapter.js` Stub 完备 | ❌ 无真实 SDK 接入（需申请 AdMob 账号） |
| 真实 IAP 收入 | `iapAdapter.js` Stub 完备 | ❌ 无真实支付接入（需 Stripe/微信支付） |
| 动态活动下发 | `seasonPass.js` 硬编码 | ❌ 无配置化系统（P5 待实现） |
| 病毒传播 | `replayShare.js` 有代码，无 UI | ⚠️ 有基础，无入口（P6 待实现） |
| 分层召回 | `pushNotification.js` 单层 | ⚠️ 有框架，缺分层（P7 待实现） |
| 运营数据看板 | `/api/ops/dashboard` + `ops-dashboard.html` | ✅ 已实现 |
| A/B 测试框架 | `abTest.js`（5个内置实验，哈希分桶） | ✅ 已实现（测试 13/13 通过） |
| IAP 首购引导 | `starter_pack`(¥3) + `weekly_pass_discount` + `annual_pass` | ✅ 已实现 |
| 广告频控完善 | 日上限/冷却时间/新用户豁免/体验分 | ✅ 已实现（测试 22/22 通过） |
| LTV 预测 | `ltvPredictor.js` 完整 | ✅ 已实现（规则引擎） |
| 用户五分群 | `playerProfile.segment5` | ✅ 已实现 |
| 赛季通行证 | `seasonPass.js` + 服务端同步 | ✅ 已实现 |
| 局间小目标 | `miniGoals.js` | ✅ 已实现 |
| B 类进阶难度 | `adaptiveSpawn.js` 挑战档 | ✅ 已实现 |

## 第一轮代码落地总结

### ✅ P2：A/B 测试框架（`web/src/abTest.js`）

**设计**：哈希分桶（userId × 实验名 → bucket），纯客户端确定，无后端依赖。

**5 个内置实验**：

| 实验名 | 对照组 | 实验组 | 核心指标 |
|--------|--------|--------|---------|
| `interstitial_delay` | 立即展示 | 延迟 3s | 广告 CVR、D1 留存 |
| `rewarded_threshold` | 连续 5 次未消行 | 连续 3 次 | 激励曝光次/用户 |
| `iap_starter_price` | ¥6 | ¥3 | IAP 首购率 |
| `revive_countdown` | 8 秒 | 4 秒 | 复活转化率 |
| `minigoal_difficulty` | 原始 n | n×0.8 | 任务完成率 |

**运营工具**：`forceVariant(exp, bucket)` 可强制 QA 指定变体；`debugReport(userId)` 查看所有实验状态。

**后端接入**：`/api/ab/report` 接收转化事件，`/api/ab/results` 汇总实验结果。

---

### ✅ P3：IAP 价格体系补全（`iapAdapter.js`）

新增 3 款产品：

| 产品 | 价格 | 类型 | 特点 |
|------|------|------|------|
| `starter_pack` | ¥3 | 首购限定 | 低门槛首购引导（`firstPurchaseOnly=true`） |
| `weekly_pass_discount` | ¥8 | 限时折扣 | 48h 倒计时（`expireHours=48`） |
| `annual_pass` | ¥88 | 年度订阅 | 365天+全皮肤+永久去广告 |

新增工具函数：`canPurchaseStarterPack()`、`getLimitedTimeRemaining()`、`createLimitedTimeOffer()`。

---

### ✅ P4：广告频控完善（`adTrigger.js v2`）

| 控制维度 | 旧版 | 新版 |
|---------|------|------|
| 单局激励上限 | 3次 | 3次 |
| **日激励上限** | ❌ | 12次/天 |
| **激励冷却** | ❌ | 90s |
| **日插屏上限** | ❌ | 6次/天 |
| **插屏冷却** | ❌ | 180s |
| **新用户豁免** | ❌ | 前3局不展示插屏 |
| **付费用户静默** | 部分 | 月卡/年卡/annual_pass 完整豁免 |
| **广告体验分** | ❌ | 自动计算，<60 触发休养期 |
| **A/B 接入** | ❌ | 插屏延迟/激励阈值 A/B 分桶 |

---

### ✅ P1：运营看板（`/ops` 路由 + `ops-dashboard.html`）

访问 `http://localhost:5000/ops` 查看：

- **活跃度卡片**：DAU / 人均局数 / 平均时长
- **留存率表**：D1/D7 留存 + 目标基线对比
- **用户分群分布**：A/B/C/D/E 五分群占比可视化
- **DAU 趋势图**：按天柱状图（支持 1/7/30 天切换）
- **Top10 分数排行**
- **A/B 实验结果汇总**：各实验各桶转化事件数对比

---

*本文档面向商业运营视角，技术实现细节参见 [MONETIZATION.md](./MONETIZATION.md)*
