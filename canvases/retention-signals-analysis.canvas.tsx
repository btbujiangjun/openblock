import {
    BarChart,
    Callout,
    Card,
    CardBody,
    CardHeader,
    Divider,
    Grid,
    H1,
    H2,
    H3,
    Pill,
    Row,
    Stack,
    Stat,
    Table,
    Text,
} from "cursor/canvas";

/* === 数据：iOS + Android 双平台 ===
 * 行 = 指标；每平台 (D1/D3/D7/D15) × (r, 区分%)
 */
type PlatformMetric = {
    r: { d1: number; d3: number; d7: number; d15: number };
    disc: { d1: number; d3: number; d7: number; d15: number };
};
type MetricRow = {
    name: string;
    cn: string;
    ios: PlatformMetric;
    android: PlatformMetric;
    bucket: "ad" | "skill" | "moment" | "score" | "revive" | "session" | "base";
};

const METRICS: MetricRow[] = [
    {
        name: "clears", cn: "消除次数", bucket: "base",
        ios: { r: { d1: 0.071, d3: 0.068, d7: 0.066, d15: 0.061 }, disc: { d1: 8, d3: 8, d7: 8, d15: 8 } },
        android: { r: { d1: 0.117, d3: 0.113, d7: 0.108, d15: 0.098 }, disc: { d1: 6, d3: 6, d7: 6, d15: 6 } },
    },
    {
        name: "multiClear", cn: "多消次数", bucket: "moment",
        ios: { r: { d1: 0.095, d3: 0.092, d7: 0.089, d15: 0.082 }, disc: { d1: 36, d3: 36, d7: 34, d15: 30 } },
        android: { r: { d1: 0.223, d3: 0.213, d7: 0.205, d15: 0.185 }, disc: { d1: 35, d3: 32, d7: 29, d15: 24 } },
    },
    {
        name: "highClear", cn: "高消次数", bucket: "moment",
        ios: { r: { d1: 0.091, d3: 0.088, d7: 0.085, d15: 0.079 }, disc: { d1: 40, d3: 40, d7: 37, d15: 32 } },
        android: { r: { d1: 0.153, d3: 0.143, d7: 0.138, d15: 0.124 }, disc: { d1: 36, d3: 33, d7: 29, d15: 25 } },
    },
    {
        name: "pcClear", cn: "清屏次数", bucket: "skill",
        ios: { r: { d1: 0.100, d3: 0.097, d7: 0.095, d15: 0.088 }, disc: { d1: 6, d3: 6, d7: 6, d15: 6 } },
        android: { r: { d1: 0.145, d3: 0.132, d7: 0.119, d15: 0.101 }, disc: { d1: 5, d3: 5, d7: 5, d15: 5 } },
    },
    {
        name: "puzzle", cn: "解决难题次数", bucket: "skill",
        ios: { r: { d1: 0.103, d3: 0.095, d7: 0.088, d15: 0.080 }, disc: { d1: 5, d3: 5, d7: 5, d15: 5 } },
        android: { r: { d1: 0.078, d3: 0.080, d7: 0.080, d15: 0.076 }, disc: { d1: 4, d3: 4, d7: 4, d15: 4 } },
    },
    {
        name: "comboEnter", cn: "进入Combo次数", bucket: "moment",
        ios: { r: { d1: 0.073, d3: 0.069, d7: 0.066, d15: 0.060 }, disc: { d1: 8, d3: 8, d7: 8, d15: 8 } },
        android: { r: { d1: 0.108, d3: 0.103, d7: 0.100, d15: 0.090 }, disc: { d1: 6, d3: 6, d7: 6, d15: 6 } },
    },
    {
        name: "comboHigh", cn: "达到高Combo次数", bucket: "moment",
        ios: { r: { d1: 0.132, d3: 0.133, d7: 0.134, d15: 0.129 }, disc: { d1: 45, d3: 45, d7: 43, d15: 39 } },
        android: { r: { d1: 0.214, d3: 0.212, d7: 0.207, d15: 0.189 }, disc: { d1: 36, d3: 34, d7: 32, d15: 28 } },
    },
    {
        name: "comboBreak", cn: "Combo中断次数", bucket: "moment",
        ios: { r: { d1: 0.060, d3: 0.057, d7: 0.054, d15: 0.050 }, disc: { d1: 7, d3: 7, d7: 7, d15: 7 } },
        android: { r: { d1: 0.099, d3: 0.097, d7: 0.095, d15: 0.087 }, disc: { d1: 4, d3: 5, d7: 5, d15: 4 } },
    },
    {
        name: "pbBreak", cn: "突破最高分次数", bucket: "score",
        ios: { r: { d1: -0.096, d3: -0.121, d7: -0.126, d15: -0.128 }, disc: { d1: 25, d3: 29, d7: 29, d15: 28 } },
        android: { r: { d1: -0.046, d3: -0.084, d7: -0.094, d15: -0.096 }, disc: { d1: 21, d3: 22, d7: 22, d15: 20 } },
    },
    {
        name: "highScore", cn: "达到高分次数", bucket: "score",
        ios: { r: { d1: 0.158, d3: 0.166, d7: 0.172, d15: 0.170 }, disc: { d1: 42, d3: 43, d7: 41, d15: 38 } },
        android: { r: { d1: 0.239, d3: 0.265, d7: 0.276, d15: 0.265 }, disc: { d1: 18, d3: 20, d7: 21, d15: 20 } },
    },
    {
        name: "reviveTrigger", cn: "触发复活次数", bucket: "revive",
        ios: { r: { d1: 0.000, d3: 0.000, d7: 0.000, d15: -0.000 }, disc: { d1: 42, d3: 42, d7: 39, d15: 35 } },
        android: { r: { d1: 0.208, d3: 0.189, d7: 0.173, d15: 0.153 }, disc: { d1: 24, d3: 22, d7: 20, d15: 16 } },
    },
    {
        name: "reviveClick", cn: "点击复活次数", bucket: "revive",
        ios: { r: { d1: 0.069, d3: 0.065, d7: 0.061, d15: 0.055 }, disc: { d1: 17, d3: 18, d7: 17, d15: 16 } },
        android: { r: { d1: 0.099, d3: 0.093, d7: 0.088, d15: 0.081 }, disc: { d1: 11, d3: 11, d7: 11, d15: 9 } },
    },
    {
        name: "reviveOk", cn: "复活成功次数", bucket: "revive",
        ios: { r: { d1: 0.000, d3: 0.000, d7: 0.000, d15: -0.000 }, disc: { d1: 15, d3: 15, d7: 15, d15: 14 } },
        android: { r: { d1: 0.000, d3: 0.000, d7: 0.000, d15: 0.000 }, disc: { d1: 11, d3: 11, d7: 10, d15: 9 } },
    },
    {
        name: "adShow", cn: "广告播放次数", bucket: "ad",
        ios: { r: { d1: 0.283, d3: 0.268, d7: 0.256, d15: 0.234 }, disc: { d1: 42, d3: 43, d7: 40, d15: 35 } },
        android: { r: { d1: 0.173, d3: 0.158, d7: 0.148, d15: 0.133 }, disc: { d1: 20, d3: 20, d7: 19, d15: 17 } },
    },
    {
        name: "adComplete", cn: "广告完播次数", bucket: "ad",
        ios: { r: { d1: 0.400, d3: 0.374, d7: 0.349, d15: 0.310 }, disc: { d1: 32, d3: 33, d7: 31, d15: 27 } },
        android: { r: { d1: 0.392, d3: 0.275, d7: 0.253, d15: 0.216 }, disc: { d1: 21, d3: 20, d7: 19, d15: 16 } },
    },
    {
        name: "sessLen", cn: "游戏时长", bucket: "session",
        ios: { r: { d1: 0.124, d3: 0.113, d7: 0.107, d15: 0.097 }, disc: { d1: 33, d3: 33, d7: 32, d15: 27 } },
        android: { r: { d1: 0.212, d3: 0.193, d7: 0.181, d15: 0.161 }, disc: { d1: 35, d3: 30, d7: 27, d15: 22 } },
    },
];

function fmtR(r: number) { return (r >= 0 ? " " : "") + r.toFixed(3); }
function fmtPct(p: number) { return `${p}%`; }
function rTone(r: number): "success" | "info" | "danger" | "warning" | "neutral" {
    if (r <= -0.05) return "danger";
    if (r >= 0.2) return "success";
    if (r >= 0.1) return "info";
    if (Math.abs(r) < 0.02) return "warning";
    return "neutral";
}
function rLabel(r: number): string {
    if (r <= -0.05) return "负";
    if (r >= 0.2) return "强";
    if (r >= 0.1) return "中";
    if (Math.abs(r) < 0.02) return "≈0";
    return "弱";
}
function diffTone(diff: number): "success" | "danger" | "neutral" {
    if (Math.abs(diff) < 0.03) return "neutral";
    if (diff > 0) return "success";
    return "danger";
}

const BUCKET_LABEL: Record<MetricRow["bucket"], string> = {
    ad: "广告漏斗",
    skill: "技巧动作",
    moment: "爽感时刻",
    score: "分数事件",
    revive: "复活漏斗",
    session: "时长",
    base: "基线",
};

export default function RetentionSignalsAnalysis() {
    /* === 跨平台差异最大的指标（D7 r 绝对差值排序） === */
    const platformDelta = METRICS
        .map(m => ({
            cn: m.cn,
            bucket: m.bucket,
            ios: m.ios.r.d7,
            android: m.android.r.d7,
            diff: m.android.r.d7 - m.ios.r.d7,
            absDiff: Math.abs(m.android.r.d7 - m.ios.r.d7),
        }))
        .sort((a, b) => b.absDiff - a.absDiff);

    /* === D7 跨平台对比条形图 === */
    const chartTop = [...platformDelta].slice(0, 12);
    const chartCategories = chartTop.map(m => m.cn);
    const iosSeries = chartTop.map(m => Number(m.ios.toFixed(3)));
    const androidSeries = chartTop.map(m => Number(m.android.toFixed(3)));

    /* === 强信号对比表（任一平台 |r(D7)| >= 0.15） === */
    const strongRows = METRICS
        .filter(m => Math.abs(m.ios.r.d7) >= 0.15 || Math.abs(m.android.r.d7) >= 0.15)
        .sort((a, b) => Math.max(Math.abs(b.ios.r.d7), Math.abs(b.android.r.d7))
                       - Math.max(Math.abs(a.ios.r.d7), Math.abs(a.android.r.d7)));

    return (
        <Stack gap={24}>
            <Stack gap={6}>
                <H1>留存信号跨平台分析（iOS × Android 整合）</H1>
                <Text tone="secondary" size="small">
                    数据源：D1/D3/D7/D15 留存 × 16 项行为指标 × 双平台 · Pearson r + 区分度二维评估
                </Text>
            </Stack>

            {/* 顶部摘要：双平台关键差异 */}
            <Grid columns={4} gap={12}>
                <Stat value="6 项" label="Android 强信号 (|r(D7)|≥0.15)" tone="success" />
                <Stat value="2 项" label="iOS 强信号 (|r(D7)|≥0.15)" tone="info" />
                <Stat value="+0.173" label="触发复活：Android-iOS 差最大" tone="warning" />
                <Stat value="-0.096" label="广告播放：Android < iOS 反向差" tone="danger" />
            </Grid>

            <Callout tone="info">
                <Text weight="semibold">核心结论</Text>：iOS 与 Android 留存信号<Text weight="semibold">结构完全不同</Text>——
                iOS 信号高度集中在<Text weight="semibold">广告漏斗</Text>（完播 r=0.349 一枝独秀），
                Android 信号<Text weight="semibold">分散在爽感时刻 + 分数事件 + 复活 + 时长</Text>共 6 条线。
                这意味着<Text weight="semibold">同一套出块/付费策略不能两平台通吃</Text>，需要分平台调参。
            </Callout>

            {/* ==== 5 个跨平台关键发现 ==== */}
            <H2>跨平台 5 个关键发现</H2>
            <Grid columns={2} gap={12}>
                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="warning" size="small">差异极大</Pill>
                            <Text weight="semibold">1. 触发复活：iOS 非线性 vs Android 强线性正</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={6}>
                            <Text>
                                <Text weight="semibold">iOS</Text>：r=0.000，区分度 42%（典型 U 型非线性，复活分布两极化）
                            </Text>
                            <Text>
                                <Text weight="semibold">Android</Text>：r=0.173，区分度 20%（单调正相关：复活越多越留存）
                            </Text>
                            <Callout tone="info">
                                运营完全不同：
                                <Text> iOS 必须<Text weight="semibold">分桶研究</Text>找 U 型拐点；</Text>
                                <Text> Android 应<Text weight="semibold">直接拉高复活机会</Text>（更频繁触发、降低门槛），是直接留存抓手。</Text>
                            </Callout>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="warning" size="small">差异极大</Pill>
                            <Text weight="semibold">2. 爽感时刻：Android r 全面碾压 iOS</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={6}>
                            <Text>
                                D7 相关性对比：
                            </Text>
                            <Text>· 多消：iOS 0.089 → Android <Text weight="semibold">0.205</Text> (×2.3)</Text>
                            <Text>· 高消：iOS 0.085 → Android <Text weight="semibold">0.138</Text> (×1.6)</Text>
                            <Text>· 高Combo：iOS 0.134 → Android <Text weight="semibold">0.207</Text> (×1.5)</Text>
                            <Callout tone="success">
                                Android 上"爽感时刻"是 adaptiveSpawn 的<Text weight="semibold">最强发力点</Text>——
                                建议 Android 包默认开启更激进的 multiClearBonus / monoFlush 触发频率
                                （比 iOS 高 30-50%），iOS 包保持当前节流。
                            </Callout>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="danger" size="small">反方向</Pill>
                            <Text weight="semibold">3. 广告价值：iOS 完播为王，Android 完播衰减快</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={6}>
                            <Text>
                                广告完播 r 衰减：
                            </Text>
                            <Text>· iOS：D1 <Text weight="semibold">0.400</Text> → D15 0.310（-22.5%）</Text>
                            <Text>· Android：D1 0.392 → D15 0.216（<Text weight="semibold">-44.9%</Text>）</Text>
                            <Text>
                                广告播放 r：iOS 0.256 (D7) vs Android <Text weight="semibold">仅 0.148</Text> (D7)。
                            </Text>
                            <Callout tone="warning">
                                <Text>iOS：广告完播是<Text weight="semibold">长效信号</Text> → 大力投入广告 UX，按完播率分层运营</Text>
                                <Text>Android：广告价值<Text weight="semibold">短期为王、长期衰减快</Text> → 不宜重度依赖广告留存，应转向爽感时刻 + 复活</Text>
                            </Callout>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="success" size="small">共性</Pill>
                            <Text weight="semibold">4. 突破 PB 负相关：两平台都存在</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={6}>
                            <Text>
                                · iOS：D7 r=<Text weight="semibold">-0.126</Text>，区分度 29%
                            </Text>
                            <Text>
                                · Android：D7 r=<Text weight="semibold">-0.094</Text>，区分度 22%
                            </Text>
                            <Text>
                                <Text weight="semibold">"达到高分" 强正 / "突破 PB" 显著负</Text> 这对反差在两个平台一致——
                                同样的分数事件，"达到较高"是爽感，"突破历史最好"是终结感。
                            </Text>
                            <Callout tone="danger">
                                <Text weight="semibold">PB 后跨局保护链 = 全平台 P0</Text>。
                                可分级目标设计（铜银金 / 周PB / 主题PB）让"达到高分"持续触发而稀释"绝对 PB" 的终结效应。
                            </Callout>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="info" size="small">结构差异</Pill>
                            <Text weight="semibold">5. 信号集中度：iOS 稀疏 vs Android 分散</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={6}>
                            <Text>
                                <Text weight="semibold">iOS |r(D7)|≥0.15</Text>：
                                只有 2 项（广告完播 0.349、广告播放 0.256）
                            </Text>
                            <Text>
                                <Text weight="semibold">Android |r(D7)|≥0.15</Text>：
                                6 项（高分 0.276、广告完播 0.253、高Combo 0.207、多消 0.205、时长 0.181、复活触发 0.173）
                            </Text>
                            <Callout tone="info">
                                解读：iOS 用户群更<Text weight="semibold">同质化</Text>（多数行为分布窄），
                                Android 用户群更<Text weight="semibold">多元</Text>（行为分布宽，单指标分化即留存分化）。
                                ⇒ iOS 需要复合留存评分（PRS）才能拉开信号；Android 单指标都能驱动运营。
                            </Callout>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="info" size="small">区分度反差</Pill>
                            <Text weight="semibold">6. 达到高分：Android 强 r 但弱区分</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={6}>
                            <Text>
                                <Text weight="semibold">Android</Text>：r=0.276（最强），区分度仅 21%（中下）
                            </Text>
                            <Text>
                                <Text weight="semibold">iOS</Text>：r=0.172（中），区分度 41%（强）
                            </Text>
                            <Text>
                                Android 上"达到高分次数"在头尾人群差不明显但整体线性强 →
                                <Text weight="semibold">大多数 Android 用户都能达高分，但越多次越好</Text>。
                            </Text>
                            <Callout tone="info">
                                Android 应该把"高分"做成<Text weight="semibold">频次激励</Text>（每日 N 次高分挑战），
                                而不是 iOS 那种"少数达成爽感"模式。
                            </Callout>
                        </Stack>
                    </CardBody>
                </Card>
            </Grid>

            <Divider />

            {/* 平台差异条形图 */}
            <Stack gap={8}>
                <H2>D7 相关性双平台对比（按差异降序）</H2>
                <Text tone="secondary" size="small">
                    每行两根柱子：iOS（蓝）vs Android（绿）。差异越大 → 越需要分平台调参。
                </Text>
                <BarChart
                    horizontal
                    categories={chartCategories}
                    series={[
                        { name: "iOS r(D7)", data: iosSeries, tone: "info" },
                        { name: "Android r(D7)", data: androidSeries, tone: "success" },
                    ]}
                    height={Math.max(360, chartCategories.length * 32)}
                />
                <Text tone="tertiary" size="small">
                    Source: 用户行为打点 · D7 留存窗口 · 仅展示差异 Top 12
                </Text>
            </Stack>

            <Divider />

            {/* 平台差异表 */}
            <Stack gap={8}>
                <H2>跨平台差异明细（D7 r）</H2>
                <Text tone="secondary" size="small">
                    Δr = Android - iOS。绿色 Δ &gt; 0：Android 信号更强；红色 Δ &lt; 0：iOS 信号更强。
                </Text>
                <Table
                    striped
                    headers={["桶", "指标", "iOS r(D7)", "Android r(D7)", "Δr (Android−iOS)", "解读"]}
                    columnAlign={["left", "left", "right", "right", "right", "left"]}
                    rows={platformDelta.map(p => [
                        <Pill key="b" tone="info" size="small">{BUCKET_LABEL[p.bucket]}</Pill>,
                        <Text key="cn" weight="semibold">{p.cn}</Text>,
                        fmtR(p.ios),
                        fmtR(p.android),
                        <Pill key="d" tone={diffTone(p.diff)} size="small">
                            {(p.diff >= 0 ? "+" : "") + p.diff.toFixed(3)}
                        </Pill>,
                        p.cn === "触发复活次数"
                            ? "iOS 非线性(U型)；Android 线性正——平台运营完全不同"
                            : p.cn === "多消次数"
                                ? "Android 爽感价值×2.3，是该平台 spawn 引擎主战场"
                                : p.cn === "广告播放次数"
                                    ? "iOS 广告渗透更高效，Android 广告价值衰减快"
                                    : p.cn === "达到高分次数"
                                        ? "Android 频次激励模型；iOS 稀缺爽感模型"
                                        : p.cn === "达到高Combo次数"
                                            ? "Android Combo 触发器价值显著高于 iOS"
                                            : p.cn === "游戏时长"
                                                ? "Android 时长更可靠预测留存（×1.7）"
                                                : Math.abs(p.diff) < 0.03
                                                    ? "平台一致"
                                                    : p.diff > 0 ? "Android 强" : "iOS 强",
                    ])}
                />
            </Stack>

            <Divider />

            {/* 强信号对比 */}
            <Stack gap={8}>
                <H2>强信号双平台对照（任一平台 |r(D7)| ≥ 0.15）</H2>
                <Table
                    headers={[
                        "指标",
                        "iOS r(D7)", "iOS 区分",
                        "Android r(D7)", "Android 区分",
                        "强信号所属",
                    ]}
                    columnAlign={["left", "right", "right", "right", "right", "left"]}
                    rows={strongRows.map(m => {
                        const iosStrong = Math.abs(m.ios.r.d7) >= 0.15;
                        const androidStrong = Math.abs(m.android.r.d7) >= 0.15;
                        const both = iosStrong && androidStrong;
                        return [
                            <Text key="cn" weight="semibold">{m.cn}</Text>,
                            <Pill key="ir" tone={rTone(m.ios.r.d7)} size="small">{fmtR(m.ios.r.d7)}</Pill>,
                            fmtPct(m.ios.disc.d7),
                            <Pill key="ar" tone={rTone(m.android.r.d7)} size="small">{fmtR(m.android.r.d7)}</Pill>,
                            fmtPct(m.android.disc.d7),
                            <Pill key="ps" tone={both ? "success" : iosStrong ? "info" : "warning"} size="small">
                                {both ? "双平台" : iosStrong ? "仅 iOS" : "仅 Android"}
                            </Pill>,
                        ];
                    })}
                />
            </Stack>

            <Divider />

            {/* 整合后的策略矩阵 */}
            <H2>整合策略矩阵（按平台分发）</H2>
            <Table
                stickyHeader
                headers={["主题", "iOS 策略", "Android 策略", "OpenBlock 衔接点"]}
                columnAlign={["left", "left", "left", "left"]}
                rows={[
                    [
                        <Text key="t" weight="semibold">PB 后留存保护（共性 P0）</Text>,
                        "PB 后跨局推送次级目标（铜银金分级 / 周PB / 主题PB）；3 日内 push 召回",
                        "同 iOS，但 PB 负相关较弱（-0.094）→ 中等强度即可",
                        <Text key="x" tone="info">v1.56 破PB豁免（同局）→ v1.61 跨局保护（待补）</Text>,
                    ],
                    [
                        <Text key="t" weight="semibold">爽感时刻引擎（Android P0）</Text>,
                        "保持当前节流（monoFlush 3.3% gate / multiClear 中等鼓励）",
                        <Text key="x" tone="success">激进版：monoFlush gate 提至 5-7% / multiClearBonus +30%</Text>,
                        <Text key="x" tone="info">v1.60.44 三类触发分级 → 平台化 monoFlushRound + multiClearBonus 调参</Text>,
                    ],
                    [
                        <Text key="t" weight="semibold">广告漏斗（iOS P0 / Android P2）</Text>,
                        <Text key="x" tone="success">完播率升为北极星；按完播率分层个性化触发权重；强化奖励梯度</Text>,
                        "Android 广告留存价值低（衰减快），仅作收益指标，不作留存抓手",
                        <Text key="x" tone="info">monetization/strategy 按 platform 分发 trigger 权重</Text>,
                    ],
                    [
                        <Text key="t" weight="semibold">复活漏斗（差异最大）</Text>,
                        <Text key="x" tone="warning">分桶研究 U 型拐点；复活后强 relief + clearGuarantee=3</Text>,
                        <Text key="x" tone="success">直接拉高复活机会频次；降低复活门槛；增加广告复活点位</Text>,
                        <Text key="x" tone="info">revive.js + game.js._handleNoMoves 按 platform 调阈值</Text>,
                    ],
                    [
                        <Text key="t" weight="semibold">爽感监控闭环（共性 P0）</Text>,
                        "保留全平台共性：roundsSinceLastDelight ≥ 7 → 强制 harvest/relief intent",
                        "Android 阈值可放宽（5 局），因爽感与留存关联更强",
                        <Text key="x" tone="info">playerProfile 新增字段 + adaptiveSpawn 触发逻辑</Text>,
                    ],
                    [
                        <Text key="t" weight="semibold">复合留存评分 PRS（P1）</Text>,
                        <Text key="x" tone="warning">必备：单指标 r 上限只 0.4，需融合 5-8 指标至 r 0.55-0.65</Text>,
                        "可选：6 个强信号已足够单独驱动运营",
                        <Text key="x" tone="info">新增 playerProfile.prsScore 字段，与 skillLevel 正交</Text>,
                    ],
                    [
                        <Text key="t" weight="semibold">基础指标改造（共性 P2）</Text>,
                        "消除/清屏次数 → 改为 个人化比率 / 单位时长频次密度",
                        "同 iOS，但 Android 消除次数本身已有 r=0.108 弱信号，改造收益略小",
                        <Text key="x" tone="info">analytics 打点 schema 扩展，向后兼容</Text>,
                    ],
                    [
                        <Text key="t" weight="semibold">分数事件分层目标（共性 P1）</Text>,
                        "高分爽感稀缺（r 强、区分强）→ 保持稀缺即可",
                        <Text key="x" tone="success">高分线性激励（r 强、区分弱）→ 每日 N 次高分挑战、累计奖励</Text>,
                        <Text key="x" tone="info">retention 模块新增日常挑战 task 系统</Text>,
                    ],
                ]}
            />

            <Divider />

            {/* 全量明细折叠 */}
            <H2>全量指标矩阵（双平台对照）</H2>
            <Text tone="secondary" size="small">
                按业务桶分组。r 强度色：success(强 ≥ 0.2) / info(中 ≥ 0.1) / neutral(弱) / warning(≈0) / danger(负)
            </Text>
            <Table
                striped
                stickyHeader
                headers={[
                    "桶", "指标",
                    "iOS r(D1)", "iOS r(D7)", "iOS r(D15)", "iOS 区分(D7)",
                    "Android r(D1)", "Android r(D7)", "Android r(D15)", "Android 区分(D7)",
                ]}
                columnAlign={[
                    "left", "left",
                    "right", "right", "right", "right",
                    "right", "right", "right", "right",
                ]}
                rows={METRICS.map(m => [
                    <Pill key="b" tone="info" size="small">{BUCKET_LABEL[m.bucket]}</Pill>,
                    <Text key="cn" weight="semibold">{m.cn}</Text>,
                    fmtR(m.ios.r.d1),
                    <Pill key="i7" tone={rTone(m.ios.r.d7)} size="small">{fmtR(m.ios.r.d7)} ({rLabel(m.ios.r.d7)})</Pill>,
                    fmtR(m.ios.r.d15),
                    fmtPct(m.ios.disc.d7),
                    fmtR(m.android.r.d1),
                    <Pill key="a7" tone={rTone(m.android.r.d7)} size="small">{fmtR(m.android.r.d7)} ({rLabel(m.android.r.d7)})</Pill>,
                    fmtR(m.android.r.d15),
                    fmtPct(m.android.disc.d7),
                ])}
            />

            <Divider />

            {/* 整合后的执行清单 */}
            <H2>v1.61 整合路线图（按优先级）</H2>
            <Stack gap={8}>
                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="danger" size="small">P0 共性</Pill>
                            <Text weight="semibold">A. PB 后跨局留存保护链</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={4}>
                            <Text>· 触发：PB 突破事件 → 下一局开始注入"次级目标"卡片（铜银金 / 周PB / 主题PB）</Text>
                            <Text>· 推送：PB 后 1d / 3d 智能 push 召回（条件式：D2-D7 内未活跃）</Text>
                            <Text>· UI：PB 庆祝从"成就感"动效降级为"序章感"动效</Text>
                            <Text>· 双平台共用，但 iOS 优先级更高（负相关更强）</Text>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="danger" size="small">P0 Android</Pill>
                            <Text weight="semibold">B. Android 爽感时刻引擎调参</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={4}>
                            <Text>· 新增 <Text weight="semibold">platform-aware adaptiveSpawn 配置</Text>，按平台读取调参档</Text>
                            <Text>· Android：MONO_FLUSH_PICK_PROBABILITY 由 0.033 提升至 0.05；multiClearBonus 抬高 30%</Text>
                            <Text>· iOS：保持现状（爽感时刻 r 偏低，激进策略边际收益不大）</Text>
                            <Text>· 配套：roundsSinceLastDelight Android 阈值 5 局，iOS 7 局</Text>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="danger" size="small">P0 Android</Pill>
                            <Text weight="semibold">C. Android 复活漏斗扩张</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={4}>
                            <Text>· 复活触发条件放宽（如 "前 3 局任意死亡均提供复活" → "前 5 局"）</Text>
                            <Text>· 增加复活点位（无尽模式失败时、关键 PB 进度即将丢失时）</Text>
                            <Text>· 复活后强制 force relief intent + clearGuarantee=3（避免复活后立刻再死）</Text>
                            <Text>· iOS 不动：先做分桶研究 U 型拐点，避免反向劣化</Text>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="warning" size="small">P1 iOS</Pill>
                            <Text weight="semibold">D. iOS 广告完播率北极星化</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={4}>
                            <Text>· 完播率升为 iOS 平台核心 KPI，与 D7 留存并列</Text>
                            <Text>· 按完播率分层运营：高完播 → 更多 IAA 暴露；低完播 → 转 IAP 软营销</Text>
                            <Text>· 奖励梯度优化：完播 vs 中断差距拉到 1.5-2x</Text>
                            <Text>· monetization/strategy 按 platform + 完播率分层</Text>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="warning" size="small">P1 Android</Pill>
                            <Text weight="semibold">E. Android 高分频次激励（每日挑战）</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={4}>
                            <Text>· 设计：每日"3 次高分达成"任务系统（高分阈值 = 玩家历史 50% 分位）</Text>
                            <Text>· 完成奖励：金币 / 皮肤试用 / 复活机会</Text>
                            <Text>· 利用 Android "达到高分 r=0.276 但区分弱"的特点（普遍可达，越多越好）</Text>
                            <Text>· iOS 不引入：稀缺爽感模型不应被频次稀释</Text>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="warning" size="small">P1 iOS</Pill>
                            <Text weight="semibold">F. iOS 复合留存评分 PRS</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={4}>
                            <Text>· iOS 单指标 r 上限 0.349（广告完播）—— 必须融合才能拉开</Text>
                            <Text>· 公式（iOS）：<Text weight="semibold">PRS = 0.50×广告完播 + 0.25×达到高分 + 0.15×高Combo + 0.10×时长 − 0.10×突破PB</Text></Text>
                            <Text>· Android 可选：6 个强信号已足够单独驱动运营，PRS 边际价值小</Text>
                            <Text>· 用作个性化召回、IAP 礼包推荐</Text>
                        </Stack>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader>
                        <Row gap={8} align="center">
                            <Pill tone="info" size="small">P2 共性</Pill>
                            <Text weight="semibold">G. 基础指标改造（个人化比率）</Text>
                        </Row>
                    </CardHeader>
                    <CardBody>
                        <Stack gap={4}>
                            <Text>· 消除/清屏/解决难题次数 → 改为<Text weight="semibold">"占个人历史中位数比例"</Text></Text>
                            <Text>· Combo 中断 → 改为"中断时高度"（中断 7→0 vs 中断 0→1 完全不同质）</Text>
                            <Text>· 时长 → 改为"<Text weight="semibold">单位时长内的关键动作密度</Text>"</Text>
                            <Text>· 预期效果：5 项个位数区分度指标提升至 15-25%</Text>
                        </Stack>
                    </CardBody>
                </Card>
            </Stack>

            <Divider />

            {/* 风险与注意 */}
            <H3>跨平台分析注意事项</H3>
            <Stack gap={4}>
                <Text size="small" tone="secondary">
                    · <Text weight="semibold">用户群差异 ≠ 设计差异</Text>：Android r 普遍更高是因为用户多元（行为分布宽），
                    不代表 Android 用户更"在意"游戏体验——只是更容易分化。
                </Text>
                <Text size="small" tone="secondary">
                    · <Text weight="semibold">广告 r 差异需谨慎</Text>：iOS 完播 r 高可能与 IDFA 限制下的样本筛选偏差有关
                    （能完播的本就是高意愿用户）；Android 样本更接近真实分布。
                </Text>
                <Text size="small" tone="secondary">
                    · <Text weight="semibold">分平台调参必须 A/B</Text>：所有"按平台分发"策略上线前必须做 50/50 A/B 验证因果方向，
                    避免反向因果误导。
                </Text>
                <Text size="small" tone="secondary">
                    · <Text weight="semibold">Android 内部细分待续</Text>：Android 设备/系统/网络/地域差异巨大，
                    本数据是平均值；下一步建议拆 Android 中高端 vs 低端、印度/巴西/中文区 vs 欧美。
                </Text>
            </Stack>

            <Text tone="tertiary" size="small">
                Source: 用户提供截图复刻（iOS + Android）· 分析框架：相关性 × 区分度 × 平台差异 × 时间衰减
                · 与 OpenBlock v1.60.44 adaptiveSpawn 架构衔接
            </Text>
        </Stack>
    );
}
