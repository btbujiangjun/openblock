import {
  BarChart,
  Card,
  CardBody,
  CardHeader,
  Callout,
  Code,
  Divider,
  Grid,
  H1,
  H2,
  H3,
  LineChart,
  Pill,
  Row,
  Stack,
  Stat,
  Table,
  Text,
  useHostTheme,
} from "cursor/canvas";

const summaryStats = [
  { value: "222", label: "历史局数" },
  { value: "13,347", label: "实时状态帧" },
  { value: "4,496", label: "反应样本帧" },
  { value: "2", label: "用户数" },
];

const metricRows = [
  ["stress", "压力输出", "-0.20", "0.00", "0.45", "0.82", "中位数很低，但尾部可达高压；历史版本混合，需看分量而非只看终值"],
  ["boardFill", "板面占用", "0.00", "0.28", "0.53", "0.58", "高板面帧不多，但进入后很容易和挫败共振"],
  ["cognitiveLoad", "认知负荷", "0.21", "0.30", "1.00", "1.00", "高负荷帧占比高，是焦虑状态的主解释变量"],
  ["frustration", "连续未消行", "0", "0", "3", "5", "p95 已到强救济区；应关注低消行到挫败的转化速度"],
  ["thinkMs", "平均思考时间", "2531ms", "3000ms", "4479ms", "5095ms", "包含观察、选块、拖动；不能替代纯反应"],
  ["pickToPlaceMs", "纯反应时间", "1011ms", "1442ms", "1978ms", "2164ms", "适合做轻量尾部信号；900/2200 更接近真实分布"],
  ["clearRate", "近期消行率", "0.13", "0.30", "0.47", "0.50", "与 stress 正相关，主要反映系统对顺局玩家加挑战"],
  ["missRate", "失误率", "0.00", "0.07", "0.10", "0.13", "与 stress 负相关，说明失误救济链已在降压"],
];

const conditionShare = [
  { label: "高负荷 >=0.6", value: 32.6 },
  { label: "低消行 <0.25", value: 18.2 },
  { label: "焦虑状态", value: 11.5 },
  { label: "高挫败 >=4", value: 9.3 },
  { label: "无聊状态", value: 7.1 },
  { label: "高板面 >=0.58", value: 4.9 },
  { label: "慢反应 >2200ms", value: 1.4 },
  { label: "快反应 <900ms", value: 1.3 },
];

const stressCorr = [
  { label: "boardFill", value: 0.519 },
  { label: "skill", value: 0.453 },
  { label: "clearRate", value: 0.433 },
  { label: "flowDeviation", value: 0.36 },
  { label: "cognitiveLoad", value: 0.205 },
  { label: "thinkMs", value: 0.098 },
  { label: "pickToPlaceMs", value: 0.055 },
  { label: "frustration", value: 0.048 },
  { label: "missRate", value: -0.208 },
];

const componentRows = [
  ["lifecycleBandAdjust", "100.0%", "0.150", "-0.150", "稳定降压底座；可能掩盖局内短周期信号"],
  ["scoreStress", "91.4%", "0.106", "+0.106", "分数推进是最大加压源"],
  ["feedbackBias", "91.6%", "0.057", "+0.053", "闭环反馈长期偏正，可能偏向加压"],
  ["smoothingAdjust", "81.3%", "0.052", "-0.025", "平滑器在大量帧里抵消波动"],
  ["skillAdjust", "100.0%", "0.043", "+0.041", "能力高时持续加挑战"],
  ["friendlyBoardRelief", "24.7%", "0.043", "-0.043", "板面友好救济已承担主要局面降压"],
  ["flowAdjust", "81.0%", "0.040", "+0.020", "心流调节偏加压，需关注 bored 判定"],
  ["pacingAdjust", "37.1%", "0.019", "+0.005", "节奏张弛相对温和"],
  ["frustrationRelief", "7.7%", "0.014", "-0.014", "触发较少，但一旦触发强度明确"],
  ["reactionAdjust", "0.0%", "0.000", "0.000", "历史帧旧值未重算；新阈值模拟约 8.3% 会触发"],
];

const relationRows = [
  ["高板面 -> 高挫败", "P(高挫败 | 高板面)=40.0%", "基线高挫败=9.3%", "板面风险不是单独问题，常伴随连续未消行；需要提前救济而不是等 frustration>=4"],
  ["低消行 -> 高挫败", "P(高挫败 | 低消行)=33.9%", "基线高挫败=9.3%", "低消行是挫败链的早期信号；适合前置 clearGuarantee / friendlyBoardRelief"],
  ["焦虑 -> 高负荷", "P(高负荷 | 焦虑)=72.3%", "基线高负荷=32.6%", "焦虑更像认知负荷共振，不只是 stress 标量过高"],
  ["高负荷 -> 慢反应", "P(慢反应 | 高负荷)=3.3%", "基线慢反应=1.4%", "慢反应能补充高负荷，但样本稀疏，不应成为主判据"],
  ["无聊 -> 快反应", "P(快反应 | 无聊)=1.2%", "基线快反应=1.3%", "快反应与 bored 不强绑定，快端加压应保持弱信号"],
];

const reactionPercentiles = {
  categories: ["p10", "p25", "p50", "p75", "p90", "p95"],
  series: [{ name: "pickToPlaceMs", data: [1011, 1203, 1442, 1710, 1978, 2164], tone: "info" as const }],
};

const recommendations = [
  {
    title: "反应调保持轻量，但改强度曲线",
    problem: "900/2200 阈值能覆盖约 8.3% 有效 reaction 样本，但当前公式用阈值本身做分母，尾部强度很小，700ms 也只有约 +0.011。",
    action: "保留入口阈值 900/2200；新增饱和区间，例如 fastFullMs=500、slowFullMs=3200，让极端快/慢更接近 ±0.05，中等尾部仍保持弱调节。",
  },
  {
    title: "低消行前置救济",
    problem: "低消行帧占 18.2%，其中 33.9% 已进入高挫败，说明 frustration>=4 才强救济偏晚。",
    action: "当 clearRate<0.25 且 boardFill>=0.45 持续 2 到 3 帧时，提前抬 clearGuarantee 或降低复杂块权重，避免拖到 frustrationRelief 才介入。",
  },
  {
    title: "高板面与高挫败合流处理",
    problem: "高板面只占 4.9%，但其中 40.0% 同时高挫败，是死局感最强的组合。",
    action: "为 boardFill>=0.58 && frustration>=3 增加复合救济：优先提高 firstMoveFreedom、降低 holeIncrement、增加可消行席位，而不是只降 stress。",
  },
  {
    title: "焦虑优先做认知减负",
    problem: "72.3% 的 anxious 帧同时 cognitiveLoad>=0.6，说明玩家主要卡在决策负担，而不是单纯压力数值。",
    action: "anxious + 高负荷时降低候选块形状复杂度和解空间约束强度；同时在 UI 解释里把该类标记为“决策负担高”而非泛化为“焦虑”。",
  },
  {
    title: "校准 feedbackBias 的长期偏正",
    problem: "feedbackBias 非零率 91.6%，均值 +0.053，长期偏加压，可能与 lifecycleBandAdjust 的常驻降压互相抵消。",
    action: "增加 feedbackBias 的零点漂移监控；若一局内正偏持续超过 70% 帧，降低其上限或引入会话内去均值。",
  },
];

function MetricNote({ children }: { children: string }) {
  const theme = useHostTheme();
  return (
    <div style={{ padding: 10, background: theme.fill.tertiary, border: `1px solid ${theme.stroke.tertiary}`, borderRadius: 8 }}>
      <Text size="small" tone="secondary" style={{ margin: 0 }}>{children}</Text>
    </div>
  );
}

export default function RealtimeStateHistoryAnalysis() {
  const theme = useHostTheme();
  return (
    <Stack gap={18} style={{ padding: 20 }}>
      <Stack gap={8}>
        <H1>用户实时状态历史序列分析</H1>
        <Text tone="secondary">
          Source: <Code>openblock.db</Code> / <Code>move_sequences.frames[*].ps</Code>。样本来自本地历史回放，包含多个历史算法版本；因此“已存 stressBreakdown”用于回放事实分析，“新 reactionAdjust”用当前 900/2200 阈值做模拟判断。
        </Text>
        <Row gap={8} wrap>
          <Pill tone="info" active>物理含义</Pill>
          <Pill tone="neutral">互操作关系</Pill>
          <Pill tone="warning">调参建议</Pill>
        </Row>
      </Stack>

      <Grid columns={4} gap={12}>
        {summaryStats.map((s) => <Stat key={s.label} value={s.value} label={s.label} />)}
      </Grid>

      <Callout tone="warning" title="主结论">
        历史序列显示，stress 的主要驱动不是单一“焦虑/反应慢”，而是分数推进、板面占用、技能估计和消行表现共同作用；真正需要优化的是几条复合链：低消行到高挫败、高板面到死局感、焦虑到认知负荷，以及 reactionAdjust 的触发强度曲线。
      </Callout>

      <Grid columns="1.2fr 1fr" gap={14} align="start">
        <Card>
          <CardHeader>关键指标分布</CardHeader>
          <CardBody>
            <Table
              headers={["指标", "含义", "p10", "p50", "p90", "p95", "解读"]}
              rows={metricRows}
              columnAlign={["left", "left", "right", "right", "right", "right", "left"]}
              striped
            />
          </CardBody>
        </Card>

        <Stack gap={12}>
          <Card>
            <CardHeader>状态触发占比</CardHeader>
            <CardBody>
              <BarChart
                categories={conditionShare.map((d) => d.label)}
                series={[{ name: "帧占比", data: conditionShare.map((d) => d.value), tone: "info" }]}
                horizontal
                valueSuffix="%"
                height={260}
              />
              <Text size="small" tone="tertiary">
                Axis: X=帧占比(%)，Y=状态条件。Source: move_sequences.frames[*].ps，n=13,347。
              </Text>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>反应时间分位数</CardHeader>
            <CardBody>
              <LineChart
                categories={reactionPercentiles.categories}
                series={reactionPercentiles.series}
                valueSuffix="ms"
                height={180}
              />
              <Text size="small" tone="tertiary">
                Axis: X=分位点，Y=pickToPlaceMs(ms)。p95≈2164ms，支持 slowMs=2200；p10≈1011ms，支持 fastMs 放在 900 附近。
              </Text>
            </CardBody>
          </Card>
        </Stack>
      </Grid>

      <H2>互操作关系</H2>
      <Grid columns="1fr 1fr" gap={14} align="start">
        <Card>
          <CardHeader>与 stress 的相关性</CardHeader>
          <CardBody>
            <BarChart
              categories={stressCorr.map((d) => d.label)}
              series={[{ name: "Pearson r", data: stressCorr.map((d) => d.value), tone: "neutral" }]}
              valueSuffix=""
              height={250}
            />
            <Text size="small" tone="tertiary">
              Axis: X=指标，Y=Pearson r。正值表示同向，负值表示救济或反向关系。Source: 历史实时状态帧。
            </Text>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>关键共现链</CardHeader>
          <CardBody>
            <Table
              headers={["链路", "条件概率", "基线", "解释"]}
              rows={relationRows}
              striped
            />
          </CardBody>
        </Card>
      </Grid>

      <H2>stress 分量贡献</H2>
      <Grid columns="1fr 1fr" gap={14} align="start">
        <Card>
          <CardHeader>主要分量强度</CardHeader>
          <CardBody>
            <BarChart
              categories={componentRows.slice(0, 8).map((r) => r[0])}
              series={[{ name: "mean(|adjust|)", data: componentRows.slice(0, 8).map((r) => Number(r[2])), tone: "warning" }]}
              height={240}
            />
            <Text size="small" tone="tertiary">
              Axis: X=stress 分量，Y=平均绝对贡献(raw stress)。Source: 已存 stressBreakdown，n=4,559。
            </Text>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>分量明细</CardHeader>
          <CardBody>
            <Table
              headers={["分量", "非零率", "meanAbs", "mean", "判断"]}
              rows={componentRows}
              columnAlign={["left", "right", "right", "right", "left"]}
              striped
            />
          </CardBody>
        </Card>
      </Grid>

      <H2>优化建议</H2>
      <Stack gap={12}>
        {recommendations.map((r, index) => (
          <Card key={r.title}>
            <CardHeader trailing={<Pill size="sm" tone={index === 0 ? "warning" : "info"}>{index === 0 ? "优先" : "建议"}</Pill>}>
              {r.title}
            </CardHeader>
            <CardBody>
              <Grid columns="1fr 1fr" gap={12}>
                <MetricNote>{r.problem}</MetricNote>
                <MetricNote>{r.action}</MetricNote>
              </Grid>
            </CardBody>
          </Card>
        ))}
      </Stack>

      <Divider />
      <Text size="small" tone="tertiary">
        读法提示：本画布中的 stress 相关值来自历史回放保存的字段，可能混合不同算法版本。用于判断方向和链路比用于绝对阈值更可靠；涉及新阈值的 reactionAdjust 已单独用当前配置模拟。
      </Text>
    </Stack>
  );
}
