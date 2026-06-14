import {
  Stack,
  Row,
  Grid,
  H1,
  H2,
  H3,
  Text,
  Code,
  Pill,
  Stat,
  Table,
  Card,
  CardHeader,
  CardBody,
  Callout,
  Divider,
  type PillTone,
  type TableRowTone,
} from "cursor/canvas";

type Verdict = "have" | "partial" | "adopt" | "caution";

const VERDICT_META: Record<Verdict, { label: string; tone: PillTone; row?: TableRowTone }> = {
  have: { label: "已实现", tone: "success" },
  partial: { label: "部分 / 代理", tone: "info" },
  adopt: { label: "新·建议引入", tone: "warning", row: "warning" },
  caution: { label: "谨慎 / 不适用", tone: "neutral" },
};

function VBadge({ v }: { v: Verdict }) {
  const m = VERDICT_META[v];
  return (
    <Pill tone={m.tone} active={v === "have" || v === "adopt"} size="sm">
      {m.label}
    </Pill>
  );
}

type MetricRow = {
  dim: string;
  name: string;
  v: Verdict;
  note: string;
};

const OBJECTIVE: MetricRow[] = [
  { dim: "牌面结构", name: "init_complexity / avg_init_complexity", v: "caution", note: "原『复杂度矩阵值』是外部不透明输入；系统用 boardDifficulty=clamp01(fill+holePressure·0.8) 等价替代，无需照搬。" },
  { dim: "牌面结构", name: "holes_cnt / avg_holes", v: "have", note: "countUnfillableCells（coverable 口径，比传统列高更准）已是 RL state[15] + 势函数项。可顺手随 spawnMeta 落库便于分桶。" },
  { dim: "牌面结构", name: "contiguous_regions / avg_regions", v: "adopt", note: "空白连通块数=空间碎片化，当前无显式指标。与 holes/scd 互补的几何难度强信号。落 spawnStepDifficulty(离线) + 可选进 state。" },
  { dim: "牌面结构", name: "blocks_cnt / avg_occupied", v: "have", note: "occupiedCount(filled)，scd 分母与 fillRatio 已用。" },
  { dim: "牌面结构", name: "concave_corners 凹角", v: "adopt", note: "陷阱位温床；现仅有 exactFit / wells / columnHeightVariance 代理。与刚落地的『吸附(edge_exposure)』约束天然互补——凹角正是吸附目标。建议显式化。" },
  { dim: "方块组合", name: "cell_count", v: "have", note: "shapeCellCount。" },
  { dim: "方块组合", name: "is_killer / is_long_bar", v: "have", note: "P1 isKillerShape / isLongBar，口径已显式定义（解决长条 lines 家族的语义冲突）。" },
  { dim: "方块组合", name: "shape_family", v: "have", note: "familyOf / getShapeCategory。" },
  { dim: "方块组合", name: "flexibility_score", v: "have", note: "per-shape countLegal；作为 min_flexibility 进难度合成。口径与提案一致。" },
  { dim: "方块组合", name: "combo_total_cells", v: "have", note: "classifyTriplet + 进 state(comboCellsNorm idx43)。" },
  { dim: "方块组合", name: "combo_killer_cnt", v: "have", note: "核心。classifyTriplet + 进 state(comboKillerNorm idx44)。" },
  { dim: "方块组合", name: "combo_long_bar_cnt", v: "have", note: "classifyTriplet + 进 state(comboLongBarNorm idx45)。" },
  { dim: "方块组合", name: "is_homogeneous_family", v: "caution", note: "已计算，但作为『难度』信号存疑（同质三块常更易）。建议仅作单调性/疲劳的体验指标，不计入难度合成。" },
  { dim: "方块组合", name: "min_flexibility", v: "have", note: "短板理论；classifyTriplet.minFlexibility，进离线合成 flex 项。" },
  { dim: "空间约束", name: "scd_score / scd_level", v: "have", note: "P0 scdScore / scdLevel(ample/tight/scarce)；scdNorm 已进 state(idx42)。" },
  { dim: "空间约束", name: "scd_range", v: "adopt", note: "零成本：aggregate-step-difficulty.mjs 已有 algoScoreSpread，顺手加 MAX-MIN(scd_score)。" },
];

const PERF: MetricRow[] = [
  { dim: "时间成本", name: "time_think_in_seconds", v: "have", note: "thinkMs（ps.metrics）。" },
  { dim: "时间成本", name: "time_diff / time_action", v: "partial", note: "有 thinkMs；总耗时/纯操作拆分取决于埋点，需确认 frames 是否记录动作时长。" },
  { dim: "时间成本", name: "global_avg / algo_avg_think_time", v: "partial", note: "需去题目化：把『题目均值』换成『难度桶 × 算法』均值；aggregator 已按算法聚合 thinkMs，补桶维即可。" },
  { dim: "操作效率", name: "block_step_cnt", v: "partial", note: "audit 脚本可重建落点派生步数；但『试探/回退』步数需埋点是否记录无效拖拽。" },
  { dim: "操作效率", name: "is_exact_match", v: "have", note: "P5（代理口径）：本项目无作者『设计最优解』→ 用贪心最优代理比对。口径差异须标注。" },
  { dim: "操作效率", name: "step4_plus_rate", v: "adopt", note: "挣扎信号，价值高；依赖 block_step_cnt 埋点完善后按桶×算法聚合。" },
  { dim: "操作效率", name: "exact_match_rate", v: "have", note: "P5 audit-exact-match.mjs（代理口径）。" },
  { dim: "结果质量", name: "blast_cnt", v: "have", note: "每步消行数（move frames）。" },
  { dim: "结果质量", name: "is_clean_screen", v: "partial", note: "清屏=perfectClear，features/effectLayer 已有；可落库后聚合。" },
  { dim: "结果质量", name: "revive_cnt / revive_show_cnt", v: "adopt", note: "revive.js 已存在；接入埋点后算 revive_rate / struggle_rate（濒死/失败压力，体验归因价值高）。" },
  { dim: "结果质量", name: "no_blast / multi_blast / clean_screen_rate", v: "adopt", note: "爽感/正反馈分布。建议在 aggregator 按『难度桶 × 算法』产出，定位垃圾时间与高阶策略成功率。" },
  { dim: "惩罚偏离", name: "think/steps/blast _exact vs _deviated", v: "have", note: "P5 audit 偏离族已实现。" },
  { dim: "惩罚偏离", name: "think_punish_index", v: "have", note: "核心（代理口径）。P5 已出。" },
  { dim: "惩罚偏离", name: "max_punish_index", v: "adopt", note: "各算法 think_punish_index 的 MAX = 该步型『认知陷阱深度上限』。audit 脚本顺手聚合。" },
  { dim: "综合评分", name: "composite_difficulty_score", v: "adopt", note: "我们有 stepDifficulty(纯客观单步分)；提案的 composite 混入表现(think/match/punish/revive)。建议作为离线『表现加权难度』与客观分并存——严禁进 reward/state（否则策略会钻表现指标空子）。" },
  { dim: "标签分类", name: "difficulty_sub_label 五档", v: "have", note: "已有客观档 bucket(trivial/easy/standard/hard/extreme)。提案是『表现档』(think 分位+revive+punish)，可补离线表现档标签。" },
  { dim: "标签分类", name: "punishment_label 宽容/中等/致命", v: "adopt", note: "基于 max_punish_index 三档；audit 脚本顺手出。识别反直觉陷阱题。" },
  { dim: "标签分类", name: "chain_label 0~3 并行/单消/多消/清屏", v: "adopt", note: "blast×step 的策略深度分层（表现侧标签），看板价值高。" },
  { dim: "离散度", name: "think_cv / think_range", v: "have", note: "P3 buildReplayAnalysis.metrics。" },
  { dim: "离散度", name: "algo_score_spread", v: "have", note: "aggregate-step-difficulty.mjs.algoScoreSpread。" },
  { dim: "离散度", name: "killer_range", v: "adopt", note: "零成本：aggregator 加 MAX-MIN(combo_killer_cnt)。" },
  { dim: "离散度", name: "scd_cv", v: "adopt", note: "零成本：aggregator 加 STDDEV/AVG(scd_score)。" },
];

function MetricTable({ data }: { data: MetricRow[] }) {
  return (
    <Table
      striped
      stickyHeader
      headers={["维度", "指标", "当前状态", "落点 / 改造建议"]}
      columnAlign={["left", "left", "left", "left"]}
      rowTone={data.map((r) => VERDICT_META[r.v].row)}
      rows={data.map((r) => [
        <Text size="small" tone="secondary">{r.dim}</Text>,
        <Code>{r.name}</Code>,
        <VBadge v={r.v} />,
        <Text size="small">{r.note}</Text>,
      ])}
    />
  );
}

type Pick = { title: string; why: string; where: string };

const TOP_PICKS: Pick[] = [
  {
    title: "contiguous_regions + concave_corners",
    why: "唯二真正新增的客观几何信号：空白碎片化 + 陷阱凹角。与 holes/scd 互补，且与刚落地的『吸附(edge_exposure)』约束同源——凹角即吸附目标。",
    where: "boardTopology / fast_grid 计算 → spawnStepDifficulty 落库；可选进 state(标量段)。",
  },
  {
    title: "max_punish_index + punishment_label",
    why: "把 P5 的 think_punish_index 升一层：陷阱深度上限 + 宽容/中等/致命三档，直接定位『反直觉』步型。",
    where: "scripts/audit-exact-match.mjs 顺手聚合输出（零新管线）。",
  },
  {
    title: "表现加权 composite + chain_label（离线）",
    why: "客观单步分之外，补一条『玩家实际体验难度』坐标用于跨算法比较与看板分层。",
    where: "离线聚合层；硬约束：不得进 reward / RL state，避免策略钻表现指标空子。",
  },
  {
    title: "爽感/濒死分布（no_blast / multi_blast / clean_screen / revive / struggle rate）",
    why: "把『难度』从几何延伸到体验：零消除=垃圾时间、险胜=复活率。归因算法体验质量。",
    where: "aggregator 按『难度桶 × 算法』；revive 需接入埋点。",
  },
  {
    title: "aggregator 零成本三件套：scd_cv / scd_range / killer_range",
    why: "离散度/跨度诊断，几行聚合即可，立即提升算法间难度可比性。",
    where: "scripts/aggregate-step-difficulty.mjs。",
  },
];

export default function DifficultyMetricsBorrowAssessment() {
  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 1180 }}>
      <Stack gap={8}>
        <H1>难度指标借鉴价值评估</H1>
        <Text tone="secondary">
          对照客观难度 + 表现难度指标目录与 OpenBlock 当前实现（P0–P5 落地后），判定每项的借鉴价值与落点。
          来源：用户提供的指标目录 vs 仓库实测（spawnStepDifficulty / moveSequence / aggregate-step-difficulty / audit-exact-match）。
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="≈24" label="已实现 / 已覆盖" tone="success" />
        <Stat value="11" label="建议新增（高 ROI）" tone="warning" />
        <Stat value="puzzle 聚合" label="须去题目化改造" tone="info" />
        <Stat value="4" label="谨慎 / 不照搬" />
      </Grid>

      <Callout tone="warning" title="最大约束：本项目无『题目(puzzle)』概念">
        <Stack gap={4}>
          <Text size="small">
            目录里所有 <Code>同一 puzzle_id 跨记录均值</Code> 的主指标，须改为 <Text weight="semibold">『spawn-step 难度桶 × 算法』</Text> 聚合（难度最小单元=当前盘面×本轮三块）。
          </Text>
          <Text size="small">
            <Code>is_exact_match</Code> 依赖『设计/最优落点』，但本项目无作者解 → 只能用 <Text weight="semibold">贪心最优代理</Text>（P5 已如此实现）；解读时须标注口径差异，不能当『绝对最优偏离』。
          </Text>
          <Text size="small">
            <Code>composite_difficulty_score</Code> 及表现类指标 <Text weight="semibold">严禁进实时 reward / RL state</Text>——会让策略钻表现指标空子；仅用于离线归因与看板。
          </Text>
        </Stack>
      </Callout>

      <Stack gap={10}>
        <Row gap={8} align="center">
          <H2>① 客观难度指标</H2>
          <Pill tone="success" size="sm" active>多数已实现</Pill>
        </Row>
        <MetricTable data={OBJECTIVE} />
      </Stack>

      <Stack gap={10}>
        <Row gap={8} align="center">
          <H2>② 表现难度指标</H2>
          <Pill tone="warning" size="sm" active>新增空间最大</Pill>
        </Row>
        <MetricTable data={PERF} />
      </Stack>

      <Stack gap={12}>
        <H2>建议优先引入（Top picks）</H2>
        <Grid columns={2} gap={12}>
          {TOP_PICKS.map((p, i) => (
            <Card key={i}>
              <CardHeader trailing={<Pill tone="warning" size="sm" active>{`P${i}`}</Pill>}>
                {p.title}
              </CardHeader>
              <CardBody>
                <Stack gap={6}>
                  <Text size="small">{p.why}</Text>
                  <Divider />
                  <Text size="small" tone="secondary">落点：{p.where}</Text>
                </Stack>
              </CardBody>
            </Card>
          ))}
        </Grid>
      </Stack>

      <Stack gap={12}>
        <H2>已充分覆盖 vs 谨慎不照搬</H2>
        <Grid columns={2} gap={16}>
          <Stack gap={6}>
            <H3>已充分覆盖（口径常优于提案）</H3>
            <Text size="small" tone="secondary">
              <Code>scd_score/level</Code>、<Code>combo_*</Code>(killer/longbar/cells/homogeneous)、
              <Code>is_killer/is_long_bar/shape_family</Code>、<Code>min_flexibility</Code>、
              <Code>holes_cnt</Code>、<Code>is_exact_match/exact_match_rate</Code>、
              <Code>think_punish_index</Code>+偏离族、<Code>think_cv/think_range</Code>、
              <Code>algo_score_spread</Code>、客观档 difficulty bucket。
            </Text>
          </Stack>
          <Stack gap={6}>
            <H3>谨慎 / 不照搬</H3>
            <Text size="small" tone="secondary">
              <Code>init_complexity</Code> 矩阵值（外部不透明，已有 boardDifficulty 等价）；
              <Code>is_homogeneous_family</Code> 当难度信号存疑（同质常更易，宜作疲劳/体验指标）；
              <Code>*_exact_match</Code> 的『设计最优解』在本项目无作者解，只能贪心代理；
              表现类 composite/label 不得进 reward 与 state。
            </Text>
          </Stack>
        </Grid>
      </Stack>
    </Stack>
  );
}
