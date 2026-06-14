import {
    Stack,
    Grid,
    Row,
    Spacer,
    H1,
    H2,
    H3,
    Text,
    Code,
    Card,
    CardHeader,
    CardBody,
    Table,
    Stat,
    Callout,
    Pill,
    Divider,
    useHostTheme,
} from "cursor/canvas";

/* ============================================================
 * OpenBlock 全局策略 · 优劣势对比
 * 视角：全用户群体商业产品运营 + 策略设计
 * 基准：2026 休闲/益智品类 LiveOps 与变现最佳实践
 * ============================================================ */

export default function GlobalStrategyProsCons() {
    return (
        <Stack gap={24} style={{ maxWidth: 1180, margin: "0 auto", padding: "8px 4px 48px" }}>
            <Header />
            <Scorecard />
            <Positioning />
            <Flywheel />
            <MaturityMatrix />
            <Strengths />
            <Weaknesses />
            <IndustryBenchmark />
            <Tensions />
            <MasterChecklist />
            <SourceFooter />
        </Stack>
    );
}

/* ---------- 顶部 ---------- */
function Header() {
    return (
        <Stack gap={10}>
            <Row align="center" gap={10} wrap>
                <H1 style={{ margin: 0 }}>OpenBlock 全局策略 · 优劣势对比</H1>
                <Spacer />
                <Pill size="sm">买量飞轮视角</Pill>
                <Pill size="sm">运营视角</Pill>
                <Pill size="sm">策略设计视角</Pill>
            </Row>
            <Text tone="secondary">
                把 OpenBlock 当作「全用户群体商业产品」来审视：它在 <Text weight="semibold">玩法体验与策略设计</Text> 上达到研究/准生产级水准，但在 <Text weight="semibold">商业化落地与 LiveOps 运营</Text> 上仍是「架构预留 + 规则 MVP + 零真实收入」。两端成熟度严重不对称，是当前最核心的结构性问题。
            </Text>
        </Stack>
    );
}

/* ---------- 评分概览 ---------- */
function Scorecard() {
    return (
        <Grid columns={4} gap={16}>
            <Stat value="4.6 / 5" label="策略设计成熟度" tone="success" />
            <Stat value="4.5 / 5" label="工程 / 多端契约" tone="success" />
            <Stat value="2.1 / 5" label="商业运营成熟度" tone="warning" />
            <Stat value="0" label="真实收入能力（当前 Stub）" tone="danger" />
        </Grid>
    );
}

/* ---------- 定位 ---------- */
function Positioning() {
    return (
        <Stack gap={10}>
            <H2 style={{ margin: 0 }}>一句话定位</H2>
            <Callout tone="info" title="它是什么">
                以「再差一点点就能刷新自己」的 <Text weight="semibold">个人最佳分（PB）追逐</Text> 为唯一长期主线的开源自适应方块益智平台；同时是可四端部署（Web / 微信小程序 / Capacitor 移动端 / Cocos）、可研究（PPO/MCTS/生成式出块）、可定制（<Code>game_rules.json</Code> 单一数据源 + 事件总线商业化）的参考实现。
            </Callout>
            <Callout tone="warning" title="对商业产品意味着什么">
                单玩家、无尽、无社交竞争的「纯个人成就」主线，天然 <Text weight="semibold">擅长留住非付费者、却缺乏强付费驱动</Text>。2026 头部休闲产品的收入主要来自「完成动机 + 社交/竞争动机」双轮，OpenBlock 目前只点亮了前者。
            </Callout>
        </Stack>
    );
}

/* ---------- 增长闭环飞轮 ---------- */
function Flywheel() {
    const theme = useHostTheme();
    const stages: {
        n: string;
        title: string;
        role: string;
        health: string;
        tone: "success" | "warning" | "danger";
        cap: string;
        gap: string;
    }[] = [
        {
            n: "①",
            title: "发行 / 买量 (UA)",
            role: "把钱变成用户",
            health: "基建半成品",
            tone: "warning",
            cap: "归因字段（UTM/gclid/fbclid）已落库；ltvPredictor 有规则版 CPI 出价建议",
            gap: "无 MMP 对接、无渠道/素材级 Cohort LTV、无 ROAS 看板、出价无真实回流校准",
        },
        {
            n: "②",
            title: "游戏体验 / 承接 (Retention)",
            role: "把用户变成留存",
            health: "强（最大资产）",
            tone: "success",
            cap: "自适应难度、心流、PB 追逐、Warm Run 新手保护、winback",
            gap: "买量 vs 自然用户未分流承接；FTUE 漏斗未度量；首局冷启动未专项优化",
        },
        {
            n: "③",
            title: "商业化 / 再投放 (Monetization)",
            role: "把留存变成现金再投放",
            health: "断裂（零真实收入）",
            tone: "danger",
            cap: "总线/护栏/SKU/分群/季票齐备",
            gap: "无真实 SDK/验单 → 无真实 LTV → 飞轮无法闭合；付费数据未回流建模",
        },
    ];
    return (
        <Stack gap={12}>
            <H2 style={{ margin: 0 }}>增长闭环：发行(买量) → 承接 → 变现 → 再投放</H2>
            <Callout tone="neutral" title="飞轮判据：LTV > CPI（ROAS > 1）">
                可规模化增长是自我强化的闭环——<Text weight="semibold">投放→归因→按 LTV 出价 → 新用户 → 承接留存 → 变现产生现金 → 用利润放大买量</Text>。能转的前提是「真实 LTV / CPI &gt; 1」<Text weight="semibold">且每一环可度量、可归因、可回流校准</Text>。
            </Callout>
            <Grid columns={3} gap={14}>
                {stages.map((s) => {
                    const c = s.tone === "success" ? theme.accent.primary
                        : s.tone === "warning" ? theme.text.secondary
                            : theme.text.primary;
                    return (
                        <div key={s.n} style={{
                            border: `1px solid ${theme.stroke.tertiary}`,
                            borderRadius: 8,
                            padding: 14,
                        }}>
                            <Stack gap={8}>
                                <Row gap={8} align="center">
                                    <Text weight="bold" style={{ color: c, fontSize: 18 }}>{s.n}</Text>
                                    <Text weight="semibold">{s.title}</Text>
                                </Row>
                                <Text size="small" tone="tertiary">{s.role}</Text>
                                <Row><Pill size="sm">{s.health}</Pill></Row>
                                <Divider />
                                <Text size="small" tone="secondary"><b>能力：</b>{s.cap}</Text>
                                <Text size="small" tone="secondary"><b>缺口：</b>{s.gap}</Text>
                            </Stack>
                        </div>
                    );
                })}
            </Grid>
            <Callout tone="danger" title="闭环断点：飞轮当前是一条「断头路」">
                飞轮在 <Text weight="semibold">③ 与 ① 两端同时断裂</Text>，强项 ② 被浪费：变现是 Stub（无真实 LTV）→ 买量无 ROAS 度量（盲投）→ 付费数据未回流（出价无法校准）→ 优秀承接<Text weight="semibold">接不住钱、也复投不了</Text>。优先级应是「先接通首尾让飞轮转一圈，再优化转速」，而非继续加深中段。
            </Callout>
        </Stack>
    );
}

/* ---------- 完整改进清单（全量 · 去重 · 排期） ---------- */
const CHECKLIST: { cat: string; rows: [string, string, string, string, string, string][] }[] = [
    {
        cat: "① 发行 / 买量（UA）",
        rows: [
            ["UA-1", "接入 MMP 归因（AppsFlyer/Adjust）", "P0", "外部", "账号+SDK", "外部依赖"],
            ["UA-2", "渠道 × 素材级 Cohort LTV（/api/ops/cohort-ltv）", "P1", "3d", "③真实收入", "规划中"],
            ["UA-3", "ROAS 看板（LTV/CPI）", "P1", "2d", "UA-2 + 花费导入", "规划中"],
            ["UA-4", "出价建议接入真实回流校准（bidRecommendation）", "P1", "2d", "真实回收", "部分"],
            ["UA-5", "素材维度 ROI 聚合（utm_content）", "P2", "2d", "—", "部分"],
        ],
    },
    {
        cat: "② 游戏体验 / 承接（Retention）",
        rows: [
            ["RT-1", "买量 vs 自然用户分流承接（按 utm_source 加强首会话 Warm Run）", "P1", "2d", "归因", "规划中"],
            ["RT-2", "FTUE 漏斗度量（开局→首消→首局结束→次日回访）", "P1", "2d", "—", "规划中"],
            ["RT-3", "冷启动首局体验专项（必出可解高爽感开局 + 即时正反馈）", "P1", "3d", "—", "部分"],
            ["RT-4", "分渠道留存切片进 /ops 看板", "P2", "1d", "—", "部分"],
        ],
    },
    {
        cat: "③ 商业化 / 再投放（Monetization）",
        rows: [
            ["MO-1", "真实广告 SDK（AdMob/AppLovin）", "P0", "3d", "账号", "外部依赖"],
            ["MO-2", "真实 IAP + 服务端密码学验单（Stripe/微信/支付宝 + Webhook）", "P0", "5d", "账号", "外部依赖"],
            ["MO-3", "ARPDAU / 真实 LTV 口径（/api/ops/dashboard）", "P0", "2d", "MO-1/2", "部分"],
            ["MO-4", "付费数据回流建模（totalSpend → maturity，闭合第④步）", "P1", "1d", "MO-3", "规划中"],
            ["MO-5", "「移除广告/订阅」服务端确权（令牌校验防篡改）", "P1", "2d", "—", "规划中"],
        ],
    },
    {
        cat: "④ 数据闭环 / 看板 / 实验",
        rows: [
            ["DA-1", "北极星 SQL 落地（6 项 PB 指标 + 爽感覆盖率）", "P1", "4d", "—", "规划中"],
            ["DA-2", "A/B uplift 统计（置信区间，非纯计数）", "P2", "2d", "—", "规划中"],
            ["DA-3", "护栏指标自动告警 / 自动暂停实验", "P2", "2d", "—", "部分"],
            ["DA-4", "埋点质量监控（丢失率 / 延迟告警）", "P2", "2d", "—", "规划中"],
            ["DA-5", "双 A/B 系统合并策略（abTest vs experiment_configs）", "P2", "1d", "—", "约定"],
        ],
    },
    {
        cat: "⑤ 分群 / 画像一致性",
        rows: [
            ["SG-1", "统一分群 SSOT（whale/segment5/cohort/VIP 收敛一套）", "P1", "3d", "—", "规划中"],
            ["SG-2", "VIP tier ↔ adTrigger T-tier 对齐 + 权益自动联动", "P1", "1d", "—", "缺陷"],
            ["SG-3", "服务端画像 + 跨设备同步", "P2", "5d", "—", "规划中"],
        ],
    },
    {
        cat: "⑥ LiveOps / 留存 Meta",
        rows: [
            ["LO-1", "运营活动日历 + 配置化下发（campaignManager / CMS UI）", "P2", "5d", "—", "部分"],
            ["LO-2", "goalSystem 持久化 + 每日刷新 + 接入主循环", "P2", "3d", "—", "规划中"],
            ["LO-3", "retentionManager 接入 game loop", "P2", "1d", "—", "部分"],
            ["LO-4", "召回分层（3/7/14/30 天）+ 回归礼包", "P2", "3d", "—", "部分"],
            ["LO-5", "小程序 lifecycle 对齐 Web", "P2", "3d", "—", "文档"],
        ],
    },
    {
        cat: "⑦ 社交 / 竞争循环",
        rows: [
            ["SO-1", "真排行榜 UI（全服 / 好友 / 周榜）", "P2", "3d", "接口已有", "部分"],
            ["SO-2", "分享入口 + ref 邀请奖励（拉动 K 因子）", "P2", "2d", "replayShare 已有", "部分"],
            ["SO-3", "好友 PB 对比 / 挑战", "P2", "3d", "SO-2", "规划中"],
        ],
    },
    {
        cat: "⑧ 模型 / ML（兑现或止损）",
        rows: [
            ["ML-1", "ZILN LTV / MTL / bandit 灰度 A/B 放量或显式封存", "P2", "5d", "DA-2", "部分(flag off)"],
            ["ML-2", "SpawnPolicyNet / L2 policies.json 部署同步（git 已删，部署风险）", "P1", "1d", "—", "部分"],
        ],
    },
    {
        cat: "⑨ 策略设计 / 体验健康",
        rows: [
            ["EX-1", "降复杂度 / 调参治理（profileAudit session-arc 违反 67%）", "P2", "5d", "—", "部分"],
            ["EX-2", "感知操控守卫（喂分透明度 + 平台分化审视）", "P3", "2d", "—", "设计"],
            ["EX-3", "维度/契约 CI 校验（GAME_EVENTS、四端 hash 同步）", "P2", "2d", "—", "部分"],
        ],
    },
    {
        cat: "⑩ 合规 / 安全（上线必备）",
        rows: [
            ["CS-1", "服务端权威分数（回放重算，防作弊）", "P1", "5d", "—", "规划中"],
            ["CS-2", "行为上报鉴权（Token / 签名）", "P1", "1d", "—", "规划中"],
            ["CS-3", "隐私同意 CMP UI + 未成年人策略", "P1", "3d", "—", "部分"],
            ["CS-4", "订单对账 / 退款 Webhook", "P1", "3d", "MO-2", "规划中"],
        ],
    },
];

function statusTone(s: string): "success" | "warning" | "danger" | "info" | undefined {
    if (s.startsWith("部分") || s === "缺陷") return "warning";
    if (s === "外部依赖") return "info";
    if (s === "规划中") return "danger";
    return undefined;
}

function MasterChecklist() {
    return (
        <Stack gap={14}>
            <H2 style={{ margin: 0 }}>完整改进清单（全量 · 去重 · 排期）</H2>
            <Text tone="secondary" size="small">
                跨「买量飞轮 + 策略设计 + 运营」三视角去重后的 39 项。优先级 P0（阻塞，必须先做）→ P3（长期）。人日为粗估；<Code>外部</Code>=需账号/SDK/合同。状态：<Code>部分</Code>=有骨架待补，<Code>规划中</Code>=仓库尚无可验收实现，<Code>缺陷</Code>=已接线但有 bug。详见 <Code>docs/operations/COMMERCIAL_OPERATIONS.md §零</Code>。
            </Text>
            <Grid columns={4} gap={16}>
                <Stat value="6" label="P0 阻塞项" tone="danger" />
                <Stat value="15" label="P1 关键项" tone="warning" />
                <Stat value="17" label="P2 增强项" tone="info" />
                <Stat value="≈ 105 人日" label="总估工（不含外部对接）" />
            </Grid>
            {CHECKLIST.map((group) => (
                <div key={group.cat}>
                    <Stack gap={6}>
                        <H3 style={{ margin: "4px 0 0" }}>{group.cat}</H3>
                        <Table
                            headers={["ID", "改进动作", "优先级", "人日", "依赖", "状态"]}
                            columnAlign={["left", "left", "center", "center", "left", "center"]}
                            rowTone={group.rows.map((r) => statusTone(r[5]))}
                            rows={group.rows}
                            striped
                        />
                    </Stack>
                </div>
            ))}
            <Callout tone="info" title="最小可行闭合路径（MVP Loop）：先让飞轮转一圈">
                MO-1 真实广告 → MO-2 真实 IAP+验单 → MO-3 ARPDAU/真实 LTV → MO-4 付费回流 → UA-2 Cohort LTV → UA-3 ROAS 看板 → UA-4 出价校准 → 按 ROAS 放大买量 ↺。<Text weight="semibold">飞轮闭合前，任何「加大买量」都是 ROAS 不可知的高风险动作——先接通度量与变现，再谈规模。</Text>
            </Callout>
            <Callout tone="warning" title="三阶段实施节奏（建议）">
                <Text size="small"><b>第一阶段（≈2 周）真实变现+度量</b>：MO-1~4、UA-1、DA-1、CS-2/CS-4。 <b>第二阶段（≈1 月）闭环度量+一致性</b>：UA-2/3/4、RT-1~4、SG-1/2、ML-2、CS-1/3。 <b>第三阶段（季度）规模化运营</b>：LO-1~5、SO-1~3、ML-1、DA-2~5、EX-1~3、SG-3。</Text>
            </Callout>
        </Stack>
    );
}

/* ---------- 维度成熟度矩阵（核心内容） ---------- */
function MaturityMatrix() {
    const rows: any[][] = [
        ["核心玩法 + 可解释 DDA", "策略设计", "5.0", "静态关卡或 1–2 全局参数", "远超行业"],
        ["玩家建模（心流/能力/情绪）", "策略设计", "5.0", "多数无玩家模型", "远超行业"],
        ["出块 PCG（构造式 + 可解性硬约束）", "策略设计", "5.0", "随机表 / 简单权重", "远超行业"],
        ["RL / 生成式模型研究栈", "策略设计", "4.5", "黑盒 A/B 或无", "研究领先，线上未放量"],
        ["多端同构 + 跨语言契约测试", "工程", "4.5", "单端为主", "领先"],
        ["生命周期 × 成熟度分层（S×M）", "运营", "3.5", "RFM / cohort 分群", "设计强、落地弱"],
        ["分群 / 画像体系", "运营", "3.0", "服务端统一画像", "四套并行、易不一致、纯本地"],
        ["变现决策（广告 / IAP 频控护栏）", "运营", "2.5", "Hybrid IAA+IAP 标配", "规则护栏好，但 Stub / 无服务端"],
        ["留存 Meta / Quest 持久化", "运营", "2.0", "无限收集 / 通行证", "内存态、未接主循环"],
        ["数据闭环 / 归因 / 北极星看板", "运营", "2.0", "数仓 + 实验平台", "本地 analytics，SQL 未落地"],
        ["LiveOps 活动日历", "运营", "1.5", "15–25 活动/月、72h 窗口", "无统一日历，季票/周挑战分散"],
        ["社交 / 竞争循环", "运营", "1.0", "排行榜 + 公会 + PvP", "stub / 仅文案"],
        ["真实变现接入与收入", "运营", "0.5", "真实 SDK + 验单", "零真实收入"],
    ];

    const tone: ("success" | "warning" | "danger" | undefined)[] = rows.map((r) => {
        const score = parseFloat(r[2] as string);
        if (score >= 4) return "success";
        if (score >= 2.5) return "warning";
        return "danger";
    });

    return (
        <Stack gap={10}>
            <H2 style={{ margin: 0 }}>维度成熟度评分（对照 2026 行业基准）</H2>
            <Text tone="secondary" size="small">
                评分 0–5，按代码实现 + 文档落地综合判定。来源：本仓 <Code>web/src</Code> 源码探查 + <Code>docs/</Code> 文档 + 行业基准。绿=领先，黄=可用但有缺口，红=薄弱/缺失。
            </Text>
            <Table
                headers={["能力维度", "视角", "成熟度", "行业基准做法", "判定"]}
                columnAlign={["left", "left", "center", "left", "left"]}
                rowTone={tone}
                rows={rows}
                striped
            />
        </Stack>
    );
}

/* ---------- 优势 ---------- */
function Strengths() {
    return (
        <Stack gap={12}>
            <H2 style={{ margin: 0 }}>核心优势</H2>
            <Grid columns={2} gap={16}>
                <Card>
                    <CardHeader trailing={<Pill size="sm">策略设计</Pill>}>体验与算法纵深</CardHeader>
                    <CardBody>
                        <Stack gap={8}>
                            <Bullet>
                                <b>17+ 信号 stress + 10 档 profile + PB 双 S 曲线</b>：难度由心流三态、连战弧线、个人百分位共同驱动，而非绝对里程碑，老玩家同分更难——隐蔽 DDA 做到了「数值层」。
                            </Bullet>
                            <Bullet>
                                <b>构造式出块（非纯随机）</b>：<Code>findCompleterShapes / findSetupShapes / findPerfectClearTriplet</Code> 主动「制造」清行机会，叠加高 fill 序贯可解 DFS，公平性与爽感兼顾。
                            </Bullet>
                            <Bullet>
                                <b>玩家三层建模 + 6 维能力向量</b>：步级 EMA / 局级趋势 / 长期基线，外加 playstyle 五分类——同类休闲产品罕见。
                            </Bullet>
                            <Bullet>
                                <b>可解释性栈</b>：<Code>stressBreakdown</Code> / <Code>spawnIntent</Code> / 玩家洞察面板 / 信号透视仪，调参与归因可追踪。
                            </Bullet>
                            <Bullet>
                                <b>五模型正交分工</b>：规则轨默认、神经轨可选且失败自动回退、L2 参数寻优、RL 独立验证——研究与生产解耦。
                            </Bullet>
                        </Stack>
                    </CardBody>
                </Card>
                <Card>
                    <CardHeader trailing={<Pill size="sm">运营视角</Pill>}>体验友好型的运营骨架</CardHeader>
                    <CardBody>
                        <Stack gap={8}>
                            <Bullet>
                                <b>体验优先的广告护栏</b>：心流中硬拦插屏、认知疲劳跳过、<Code>LTV 护盾</Code>对高价值用户 70% 跳插屏、前 3 局豁免——「卖缓解而非卖压力」的理念已写进代码。
                            </Bullet>
                            <Bullet>
                                <b>生命周期 × 成熟度 25 格</b>：新手/回流/核心同盘不同压力 cap，配合 Warm Run、局间 RoR、PEOG 早期超越守卫，分层运营颗粒度细。
                            </Bullet>
                            <Bullet>
                                <b>零侵入事件总线 + Feature Flag</b>：商业化可热插拔、可一键关闭，合规与 demo 友好；多目标 <Code>CommercialModelVector</Code> 预留 ML 替换位。
                            </Bullet>
                            <Bullet>
                                <b>三源流失融合 + 会话编排</b>：predictor / maturity / commercial 加权投票，<Code>onSessionStart/End</Code> 钩子驱动 winback、首充时机。
                            </Bullet>
                            <Bullet>
                                <b>明确的北极星与护栏设计</b>：D1≥45% / D7≥20% / 爽感覆盖≥75%，且「提升一项不得显著拖累其余」。
                            </Bullet>
                        </Stack>
                    </CardBody>
                </Card>
            </Grid>
        </Stack>
    );
}

/* ---------- 劣势 / 缺口 ---------- */
function Weaknesses() {
    const rows: any[][] = [
        [
            "零真实收入",
            "运营",
            <>广告/IAP 默认 <Code>false</Code> + <Code>stubMode</Code>，IAP 仅 localStorage 模拟、<b>无服务端验单</b>，可篡改。</>,
            "致命",
        ],
        [
            "无 LiveOps 活动日历",
            "运营",
            <>行业标配 15–25 活动/月、72h 窗口；本项目季票/周挑战分散、无统一 seasonal calendar 与服务端调度。</>,
            "高",
        ],
        [
            "缺社交 / 竞争循环",
            "策略+运营",
            <>排行榜受 flag 控制、<Code>vipLeaderboard</Code> 返回硬编码、公会/好友仅 stub——失去最强付费驱动「比拼/炫耀」。</>,
            "高",
        ],
        [
            "分群体系四套并行",
            "运营",
            <>whale/dolphin/minnow、segment5(A–E)、cohort 花费分群、VIP 分各自为政，<Code>adTrigger</Code> 期望 T-tier 与 <Code>vip0–5</Code> 可能不匹配。</>,
            "中",
        ],
        [
            "画像与进度纯本地",
            "运营",
            <>几乎全 localStorage，无跨设备同步；<Code>goalSystem</Code> 内存态、刷新即丢，<Code>retentionManager</Code> 未接入主 game loop。</>,
            "中",
        ],
        [
            "ML「建而未用」",
            "策略+运营",
            <>ZILN LTV / 多任务编码 / LinUCB bandit / 校准器均已实现但 flag 默认 off，线上决策仍是加权线性规则。</>,
            "中",
        ],
        [
            "北极星 SQL / 看板未落地",
            "运营",
            <>6 项 PB 北极星与爽感覆盖率仅在文档，<Code>server.py</Code>/<Code>opsDashboard</Code> 未实现，无法数据驱动决策。</>,
            "中",
        ],
        [
            "付费数据未回流建模",
            "运营",
            <>编排层 <Code>updateMaturity</Code> 仍传 <Code>totalSpend=0</Code>，ValueScore 长期偏低，LTV 无真实付费校准。</>,
            "中",
        ],
        [
            "过度工程 / 调参爆炸",
            "策略设计",
            <>stress 20+ 分量、state 204 维、PB 子机制 8+；文档自承 <Code>profileAudit</Code> 曾 67% 局违反 session-arc 设计，维护与 onboarding 成本高。</>,
            "中",
        ],
        [
            "感知操控风险",
            "策略设计",
            <>Warm Run + expertEarlyBoost + 构造满足 + 平台分化喂分（Android 彩蛋概率更高）可能被敏感玩家识别为「算法喂分」。</>,
            "低-中",
        ],
    ];

    const tone: ("danger" | "warning" | "info" | undefined)[] = rows.map((r) => {
        const sev = r[3] as string;
        if (sev === "致命" || sev === "高") return "danger";
        if (sev.startsWith("中")) return "warning";
        return "info";
    });

    return (
        <Stack gap={10}>
            <H2 style={{ margin: 0 }}>关键缺口与风险</H2>
            <Table
                headers={["缺口", "视角", "说明", "严重度"]}
                columnAlign={["left", "left", "left", "center"]}
                rowTone={tone}
                rows={rows}
                striped
            />
        </Stack>
    );
}

/* ---------- 行业基准对照 ---------- */
function IndustryBenchmark() {
    const rows: any[][] = [
        [
            "Hybrid IAA + IAP（2026 不可妥协）",
            <>架构已就绪（总线/护栏/SKU 目录），但<b>未接真实 SDK</b>、IAP 无验单</>,
            "部分",
        ],
        [
            "LiveOps 活动日历 15–25/月，72h 窗口",
            <>无统一日历；季票/周挑战/每日任务分散且部分仅 Android</>,
            "缺失",
        ],
        [
            "流失预测提前 48–72h → 个性化高价值礼包",
            <>三源规则融合已有 churnRisk，但<b>无服务端调度</b>，<Code>getChurnIntervention</Code> 无生产调用</>,
            "部分",
        ],
        [
            "隐蔽 DDA、卖缓解而非卖压力",
            <><b>已超额达成</b>：多信号 stress + 心流互抑 + 救济链 + 体验型广告护栏</>,
            "达成",
        ],
        [
            "双动机：完成（completion）+ 社交竞争",
            <>仅完成动机（PB 追逐 + 收集）；社交/竞争为 stub</>,
            "缺失",
        ],
        [
            "Webshop D2C 绕开 30% 平台抽成",
            <>无直购商店；仅平台内 SKU 与折扣矩阵</>,
            "缺失",
        ],
        [
            "Remote Config 热调参，免发版",
            <><b>达成</b>：<Code>game_rules.json</Code> 单源 + remote_config + 四端 sync 契约</>,
            "达成",
        ],
        [
            "颗粒度指标（APS、D7）而非粗转化率",
            <>玩家侧指标丰富（PB 破纪录率/停留/爽感），但运营 KPI SQL 未落地</>,
            "部分",
        ],
    ];

    const tone: ("success" | "warning" | "danger" | undefined)[] = rows.map((r) => {
        const s = r[2] as string;
        if (s === "达成") return "success";
        if (s === "部分") return "warning";
        return "danger";
    });

    return (
        <Stack gap={10}>
            <H2 style={{ margin: 0 }}>2026 行业最佳实践对照</H2>
            <Text tone="secondary" size="small">
                基准来源：Game Growth Advisor / Naavik / Adrian Crook 等 2026 休闲-益智 LiveOps 与变现研究综述。
            </Text>
            <Table
                headers={["行业最佳实践", "OpenBlock 现状", "覆盖度"]}
                columnAlign={["left", "left", "center"]}
                rowTone={tone}
                rows={rows}
                striped
            />
        </Stack>
    );
}

/* ---------- 核心战略张力 ---------- */
function Tensions() {
    const theme = useHostTheme();
    const items: { n: string; title: string; body: any }[] = [
        {
            n: "01",
            title: "个人成就主线 vs 双动机变现",
            body: (
                <>PB 追逐对「留存非付费者」极优，却天然缺少社交/竞争这一最强付费杠杆——<b>变现天花板被产品哲学锁死</b>。</>
            ),
        },
        {
            n: "02",
            title: "研发极重 vs 运营极轻",
            body: (
                <>玩法/RL/多端投入巨大（state 204、五模型、跨语言契约），变现/LiveOps/看板却停在 stub——<b>资源配置与商业目标错位</b>。</>
            ),
        },
        {
            n: "03",
            title: "隐蔽 DDA vs 公平可解释",
            body: (
                <>喂分式构造满足 + 平台分化的彩蛋概率，与「公平随机」「可解释」存在张力，过度则反噬信任。</>
            ),
        },
        {
            n: "04",
            title: "本地画像 vs 跨端运营",
            body: (
                <>localStorage 画像无法支撑真正的服务端 cohort live ops、跨设备购买与统一归因。</>
            ),
        },
        {
            n: "05",
            title: "ML 脚手架齐全 vs 默认线性规则",
            body: (
                <>ZILN/MTL/bandit「建而未用」，既增维护面又未兑现增益，需「灰度放量或显式封存」二选一。</>
            ),
        },
    ];
    return (
        <Stack gap={12}>
            <H2 style={{ margin: 0 }}>核心战略张力</H2>
            <Grid columns={2} gap={14}>
                {items.map((it) => (
                    <div key={it.n} style={{
                        border: `1px solid ${theme.stroke.tertiary}`,
                        borderRadius: 8,
                        padding: 14,
                    }}>
                        <Row gap={12} align="start">
                            <Text weight="bold" style={{ color: theme.accent.primary, fontSize: 18, lineHeight: "20px" }}>{it.n}</Text>
                            <Stack gap={4}>
                                <Text weight="semibold">{it.title}</Text>
                                <Text tone="secondary" size="small">{it.body}</Text>
                            </Stack>
                        </Row>
                    </div>
                ))}
            </Grid>
        </Stack>
    );
}

/* ---------- 小组件 ---------- */
function Bullet({ children }: { children: any }) {
    const theme = useHostTheme();
    return (
        <Row gap={8} align="start">
            <span style={{
                width: 5, height: 5, borderRadius: 5,
                background: theme.accent.primary, marginTop: 7, flex: "0 0 auto",
            }} />
            <Text size="small" tone="secondary" style={{ flex: 1 }}>{children}</Text>
        </Row>
    );
}

function SourceFooter() {
    return (
        <Stack gap={6}>
            <Divider />
            <Text size="small" tone="tertiary">
                依据：本仓 <Code>web/src</Code> 源码（monetization / retention / lifecycle / adaptiveSpawn / bot / spawnModel）+ <Code>docs/</Code>（BEST_SCORE_CHASE_STRATEGY、EXPERIENCE_DESIGN_FOUNDATIONS、PLAYER_LIFECYCLE_MATURITY_BLUEPRINT、MONETIZATION、COMMERCIAL_OPERATIONS、MODEL_SYSTEMS_FOUR_MODELS）+ 2026 行业 LiveOps/变现研究综述。评分为代码实现与文档落地的综合判断，非财务审计。
            </Text>
        </Stack>
    );
}
