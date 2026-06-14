import {
  Stack,
  Row,
  Grid,
  H1,
  H2,
  Text,
  Code,
  Pill,
  Stat,
  Callout,
  Divider,
  Table,
  CollapsibleSection,
  useHostTheme,
  useCanvasState,
} from "cursor/canvas";

type Status = "full" | "partial" | "none";

type Metric = {
  name: string;
  status: Status;
  impl: string; // 系统对应实现 / 文件:行号
  meaning: string; // 物理含义
  caliber: string; // 计算口径异同
  usage: string; // 潜在使用场景
};

type Dimension = {
  group: string;
  rows: Metric[];
};

const STATUS_LABEL: Record<Status, string> = {
  full: "已实现",
  partial: "部分对齐",
  none: "未实现",
};

function StatusPill({ status }: { status: Status }) {
  const tone = status === "full" ? "success" : status === "partial" ? "warning" : "neutral";
  return (
    <Pill tone={tone as "success" | "warning" | "neutral"} active={status !== "none"} size="sm">
      {STATUS_LABEL[status]}
    </Pill>
  );
}

function MetricTable({ rows }: { rows: Metric[] }) {
  return (
    <Table
      headers={["指标", "状态", "系统对应实现", "计算口径 · 异同", "使用场景"]}
      columnAlign={["left", "center", "left", "left", "left"]}
      striped
      rows={rows.map((m) => [
        <Stack gap={2} key={m.name}>
          <Code>{m.name}</Code>
          <Text size="small" tone="tertiary">
            {m.meaning}
          </Text>
        </Stack>,
        <StatusPill status={m.status} key="s" />,
        <Text size="small" tone="secondary" key="i">
          {m.impl}
        </Text>,
        <Text size="small" tone="secondary" key="c">
          {m.caliber}
        </Text>,
        <Text size="small" tone="tertiary" key="u">
          {m.usage}
        </Text>,
      ])}
    />
  );
}

// ─────────────────────────── 客观难度 ───────────────────────────
const OBJECTIVE: Dimension[] = [
  {
    group: "牌面结构",
    rows: [
      {
        name: "init_complexity",
        status: "partial",
        impl: "boardDifficulty（adaptiveSpawn.js:471 / spawnModel.js:257）",
        meaning: "牌面混乱度基线",
        caliber: "系统无『原始复杂度矩阵』，用 clamp01(fill + holePressure×0.8) 折算；非矩阵裁剪而是 fill+空洞合成",
        usage: "出块 stress 推导、模型特征",
      },
      {
        name: "holes_cnt",
        status: "full",
        impl: "boardTopology.js（holes/isolatedHoles/enclosedVoidCells）",
        meaning: "空洞数量",
        caliber: "系统拆三套口径：不可覆盖格 / 4-邻全填孤洞 / ≤5 格小空腔；比单一定义更细",
        usage: "holePressure、DFS hole 增量、UI 画像",
      },
      {
        name: "contiguous_regions",
        status: "partial",
        impl: "boardTopology.js:296（BFS 内联，无导出函数）",
        meaning: "连续空白连通块数",
        caliber: "系统只对 size≤5 的小空腔计数（enclosedVoidCells），未导出全盘 region 计数",
        usage: "小腔判定，未用于碎片化难度评分",
      },
      {
        name: "blocks_cnt",
        status: "full",
        impl: "occupiedCount / grid.getFillRatio()（grid.js:1091）",
        meaning: "已占用格子数",
        caliber: "口径一致：非空格计数；系统主用 fillRatio（占比）而非绝对数",
        usage: "boardFill 实时水位、能力模型输入",
      },
      {
        name: "concave_corners",
        status: "partial",
        impl: "wells（boardTopology.js:248）+ enclosedVoidCells（L 型小凹陷）",
        meaning: "凹角 / 陷阱位",
        caliber: "系统无『凹角』独立计数；用单格夹缝 wells + 小凹陷近似",
        usage: "wells 进入拓扑特征，未单列陷阱指标",
      },
      {
        name: "avg_init_complexity",
        status: "none",
        impl: "—",
        meaning: "题目跨记录复杂度均值",
        caliber: "系统是实时单局信号，无 puzzle_id 跨记录聚合维度",
        usage: "（缺）题目级稳定难度画像",
      },
      {
        name: "avg_holes",
        status: "none",
        impl: "近似 meanEndFillRatio（blockSpawn.js:512，轮内候选）",
        meaning: "题目稳定离散度",
        caliber: "系统只有 DFS 叶子轮内均值，非跨记录题目均值",
        usage: "（缺）题目级离散度",
      },
      {
        name: "avg_regions",
        status: "none",
        impl: "—",
        meaning: "空间分布稳定度",
        caliber: "缺 region 聚合，也缺题目级均值",
        usage: "（缺）",
      },
      {
        name: "avg_occupied",
        status: "none",
        impl: "—",
        meaning: "稳定已占用水位",
        caliber: "有实时 fillRatio，无题目跨记录均值",
        usage: "（缺）题目级水位",
      },
    ],
  },
  {
    group: "方块组合",
    rows: [
      {
        name: "cell_count",
        status: "full",
        impl: "shapeCellCount（blockSpawn.js:205）",
        meaning: "单块格子数",
        caliber: "口径一致：遍历 shape 矩阵计 1",
        usage: "出块权重、bulky 判定、RL 镜像",
      },
      {
        name: "is_killer",
        status: "none",
        impl: "—（无 killer 标识符）",
        meaning: "致命形状",
        caliber: "系统无『致命块』标签；仅 validateSpawnTriplet 拒绝低机动性候选",
        usage: "（缺）核心难度抓手",
      },
      {
        name: "is_long_bar",
        status: "partial",
        impl: "getShapeCategory='lines'（shapes.js:82）",
        meaning: "长条形状",
        caliber: "语义相反：系统把 lines 视为最低复杂度(0.15) 偏易，而非『易制造死局』",
        usage: "品类复杂度加权（方向相反需注意）",
      },
      {
        name: "shape_family",
        status: "full",
        impl: "getShapeCategory + categoryComplexity（7 类）",
        meaning: "形状家族",
        caliber: "口径一致：lines/rects/squares/t/l/j/z 七类映射",
        usage: "多样性、出块复杂度目标",
      },
      {
        name: "flexibility_score",
        status: "partial",
        impl: "countLegalPlacements / countValidPlacements",
        meaning: "放置灵活性 0~1",
        caliber: "系统用『合法落点绝对数』，未归一到 0~1；actionFreedom=legal/64 最接近归一",
        usage: "机动性加权、d_step 难度",
      },
      {
        name: "combo_total_cells",
        status: "partial",
        impl: "bulkyCells（blockSpawn.js:2581）/ totalCells（spawnExperiments）",
        meaning: "三块总格子",
        caliber: "命名不同但口径同：三块 cell 之和；系统更常用终态 meanEndFillRatio 表达填充压力",
        usage: "偏小块切换、生存/压力评分",
      },
      {
        name: "combo_killer_cnt",
        status: "none",
        impl: "—",
        meaning: "三块致命块数",
        caliber: "依赖 is_killer，系统缺该基础",
        usage: "（缺）理论难度核心",
      },
      {
        name: "combo_long_bar_cnt",
        status: "none",
        impl: "—",
        meaning: "三块长条数",
        caliber: "依赖 is_long_bar 计数，系统缺",
        usage: "（缺）行列刚性约束强度",
      },
      {
        name: "is_homogeneous_family",
        status: "partial",
        impl: "catPenalty / effectiveDiversity（反同质惩罚）",
        meaning: "三块同家族",
        caliber: "系统是『反同质降权』而非正向同质标签；categoryDiversity 取去重数",
        usage: "多样性出块；可反推同质布尔",
      },
      {
        name: "min_flexibility",
        status: "partial",
        impl: "firstMoveFreedom（blockSpawn.js:661）",
        meaning: "三块最僵硬者自由度（短板）",
        caliber: "短板逻辑一致：取三块合法落点最小值；只是未归一",
        usage: "瓶颈自由度，已用于出块校验",
      },
    ],
  },
  {
    group: "空间约束",
    rows: [
      {
        name: "scd_score",
        status: "none",
        impl: "近似 spatialPressure（adaptiveSpawn.js:639）",
        meaning: "空间约束密度",
        caliber: "系统 spatialPressure 由 stress/board 综合驱动，非纯几何 总格/(64−已占)；缺该比值",
        usage: "（缺）几何紧张度可直接补",
      },
      {
        name: "scd_level",
        status: "partial",
        impl: "endFillRatio 档 / solutionDifficulty 档（game_rules.json）",
        meaning: "充裕/紧张/稀缺",
        caliber: "系统多套档位（通透/适中/压迫/窒息；宽松/紧张/极限），无统一三档",
        usage: "出块档位、文案；需收敛口径",
      },
      {
        name: "scd_range",
        status: "none",
        impl: "—",
        meaning: "算法内 scd 跨度",
        caliber: "依赖 scd_score + 算法聚合，二者均缺",
        usage: "（缺）算法空间跨度",
      },
    ],
  },
];

// ─────────────────────────── 表现难度 ───────────────────────────
const PERFORMANCE: Dimension[] = [
  {
    group: "时间成本",
    rows: [
      {
        name: "time_think_in_seconds",
        status: "full",
        impl: "thinkMs（playerProfile.js:236）",
        meaning: "纯思考时长",
        caliber: "口径一致（单位毫秒）：上一动作→落子间隔，剔除 AFK(>15s)",
        usage: "认知负荷、stress 微调、复盘",
      },
      {
        name: "time_diff_in_seconds",
        status: "partial",
        impl: "durationMs（game.js:3608）",
        meaning: "单局总耗时",
        caliber: "系统是局/会话总时长，未分解『思考+操作+消除动画』",
        usage: "会话摘要、留存",
      },
      {
        name: "time_action_in_seconds",
        status: "partial",
        impl: "pickToPlaceMs（playerProfile.js:239）",
        meaning: "纯操作时长",
        caliber: "系统口径=握块→落子，含定位决策；无独立『拖拽段』计时",
        usage: "反应时长、reactionAdjust",
      },
      {
        name: "global_avg_think_time",
        status: "none",
        impl: "—",
        meaning: "题目全局认知水位",
        caliber: "系统是滑窗/会话均值，无题目跨算法聚合",
        usage: "（缺）题目级基线",
      },
      {
        name: "algo_avg_think_time",
        status: "none",
        impl: "—",
        meaning: "单算法思考均值",
        caliber: "缺『算法分组』聚合维度（spawn 策略存在但未按 think 聚合）",
        usage: "（缺）剥离算法干扰",
      },
    ],
  },
  {
    group: "操作效率",
    rows: [
      {
        name: "block_step_cnt",
        status: "full",
        impl: "gameStats.placements / countPlaceStepsInFrames",
        meaning: "放置步数",
        caliber: "语义一致；但系统未按『每 3 块一轮』切分步数",
        usage: "效率、持久化、复盘",
      },
      {
        name: "is_exact_match",
        status: "none",
        impl: "—",
        meaning: "是否匹配设计最优解",
        caliber: "系统无玩家落点 vs 设计/最优路径的逐步比对（无 design_position）",
        usage: "（缺）惩罚/偏离族全部依赖此基础",
      },
      {
        name: "global_avg_steps / algo_avg_steps",
        status: "none",
        impl: "—",
        meaning: "步数聚合",
        caliber: "缺题目级 / 算法级聚合",
        usage: "（缺）",
      },
      {
        name: "step4_plus_rate",
        status: "none",
        impl: "近似 struggleSignals（playerProfile.js:731）",
        meaning: "挣扎信号（≥4 步占比）",
        caliber: "系统挣扎是多规则阈值命中，非『单轮步数≥4』计数；无回退/重试统计",
        usage: "（缺）可由步数计数补",
      },
      {
        name: "exact_match_rate",
        status: "none",
        impl: "—",
        meaning: "走最优路径概率",
        caliber: "依赖 is_exact_match",
        usage: "（缺）核心『诱导歧途』指标",
      },
    ],
  },
  {
    group: "结果质量",
    rows: [
      {
        name: "blast_cnt",
        status: "full",
        impl: "linesCleared（game.js:2855）",
        meaning: "本次消除行数",
        caliber: "口径一致：grid.checkLines().count",
        usage: "即时反馈、combo、计分",
      },
      {
        name: "is_clean_screen",
        status: "full",
        impl: "perfectClearRate（playerProfile.js:494）",
        meaning: "是否清屏",
        caliber: "口径一致：落子后 boardFill===0",
        usage: "perfect_hunter 风格、爽感事件",
      },
      {
        name: "revive_cnt",
        status: "full",
        impl: "ReviveManager._usedCount（revive.js）",
        meaning: "复活次数",
        caliber: "已实现，但生产默认关闭（main.js enabled:false）",
        usage: "失败压力（需开启才有数据）",
      },
      {
        name: "revive_show_cnt",
        status: "partial",
        impl: "revive-overlay 展示（无独立指标）",
        meaning: "复活提示展示数",
        caliber: "系统展示为 UI overlay，未单列 show 计数",
        usage: "（缺）濒死频率敏感量",
      },
      {
        name: "global_avg_blast / algo_avg_blast",
        status: "none",
        impl: "—",
        meaning: "爽感产出聚合",
        caliber: "有步级 lines，缺题目/算法聚合",
        usage: "（缺）策略爽感对比",
      },
      {
        name: "no_blast_rate",
        status: "full",
        impl: "frustrationLevel / longestNoClear",
        meaning: "零消除占比",
        caliber: "系统用连续未消行计数 + 最长无消序列，语义等价",
        usage: "垃圾时间、frustration 减压",
      },
      {
        name: "multi_blast_rate",
        status: "full",
        impl: "multiClearRate（playerProfile.js:491）",
        meaning: "多消占比",
        caliber: "口径一致：消行步中 lines≥2 占比",
        usage: "高阶策略成功标志",
      },
      {
        name: "clean_screen_rate",
        status: "full",
        impl: "perfectClearRate",
        meaning: "清屏频率",
        caliber: "口径一致",
        usage: "爽感、风格分群",
      },
      {
        name: "revive_rate",
        status: "partial",
        impl: "logBehavior reviveCount（revive.js:283）",
        meaning: "已死一次占比",
        caliber: "有行为日志，无 rate 聚合字段；且默认关闭",
        usage: "（缺 rate）失败压力",
      },
      {
        name: "struggle_rate",
        status: "partial",
        impl: "flowState struggleSignals",
        meaning: "挣扎频率",
        caliber: "系统是即时心流态，非基于 revive_show 的占比",
        usage: "心流调节；口径不同",
      },
    ],
  },
  {
    group: "惩罚与偏离",
    rows: [
      {
        name: "think_exact_match / think_deviated",
        status: "none",
        impl: "—",
        meaning: "最优/偏离思考基线",
        caliber: "依赖 is_exact_match 分组，系统缺",
        usage: "（缺）",
      },
      {
        name: "steps_exact / steps_deviated",
        status: "none",
        impl: "—",
        meaning: "最优/偏离操作成本",
        caliber: "依赖 is_exact_match 分组",
        usage: "（缺）",
      },
      {
        name: "blast_exact / blast_deviated",
        status: "none",
        impl: "—",
        meaning: "最优/偏离消除效率",
        caliber: "依赖 is_exact_match 分组",
        usage: "（缺）",
      },
      {
        name: "think_punish_index",
        status: "none",
        impl: "近似 momentum frustration penalty",
        meaning: "偏离最优解时间代价倍数",
        caliber: "系统仅在 frustration≥3 给 momentum 负向惩罚，语义不同",
        usage: "（缺）认知陷阱核心",
      },
      {
        name: "max_punish_index",
        status: "none",
        impl: "—",
        meaning: "题目认知陷阱深度上限",
        caliber: "依赖 punish_index + 算法聚合",
        usage: "（缺）",
      },
    ],
  },
  {
    group: "综合评分 · 标签 · 离散度",
    rows: [
      {
        name: "composite_difficulty_score",
        status: "none",
        impl: "近似 skillLevel / cognitiveLoad（玩家能力侧）",
        meaning: "全局统一难度坐标",
        caliber: "系统综合分是『玩家能力/心流』，非题目难度坐标；RL composite 与此无关",
        usage: "（缺）跨算法难度比较",
      },
      {
        name: "difficulty_sub_label（五档）",
        status: "none",
        impl: "UI 3 档 / skillBand 4 档 / difficultyPredictor 4 档",
        meaning: "极简/简单/标准/困难/极限",
        caliber: "系统无该五档表现难度标签，多套 3~4 档并存且语境不同",
        usage: "（缺）统一难度分级",
      },
      {
        name: "punishment_label",
        status: "none",
        impl: "—",
        meaning: "宽容/中等/致命型",
        caliber: "依赖 max_punish_index",
        usage: "（缺）",
      },
      {
        name: "chain_label",
        status: "none",
        impl: "近似 maxCombo（game.js:2858）",
        meaning: "0~3 级策略深度分层",
        caliber: "系统 maxCombo 是单次最大消行，非『消行×步数』四档分层",
        usage: "（缺）策略深度表现",
      },
      {
        name: "think_cv",
        status: "none",
        impl: "近似 cognitiveLoad（thinkMs 方差归一）",
        meaning: "思考变异系数",
        caliber: "系统用 thinkMs 方差/阈值，非 STDDEV/AVG；profileAuditMath 有 stddev 可算",
        usage: "（缺 cv）算法稳定性",
      },
      {
        name: "think_range",
        status: "none",
        impl: "—",
        meaning: "绝对耗时跨度",
        caliber: "缺 max−min 聚合",
        usage: "（缺）",
      },
      {
        name: "algo_score_spread / killer_range / scd_cv",
        status: "none",
        impl: "—",
        meaning: "复合难度/杀手/scd 跨度",
        caliber: "全部依赖『算法分组聚合』+ 对应基础指标（composite/killer/scd），系统均缺",
        usage: "（缺）算法间难度跨度诊断",
      },
    ],
  },
];

function DimensionList({ dims, openFirst }: { dims: Dimension[]; openFirst: boolean }) {
  return (
    <Stack gap={4}>
      {dims.map((d, i) => {
        const full = d.rows.filter((r) => r.status === "full").length;
        const partial = d.rows.filter((r) => r.status === "partial").length;
        const none = d.rows.filter((r) => r.status === "none").length;
        return (
          <CollapsibleSection
            key={d.group}
            title={d.group}
            count={d.rows.length}
            defaultOpen={openFirst && i === 0}
            trailing={
              <Row gap={6}>
                <Text size="small" tone="tertiary">
                  全 {full} · 部分 {partial} · 缺 {none}
                </Text>
              </Row>
            }
          >
            <MetricTable rows={d.rows} />
          </CollapsibleSection>
        );
      })}
    </Stack>
  );
}

export default function DifficultyMetricsGapAnalysis() {
  const theme = useHostTheme();
  const [tab, setTab] = useCanvasState<"objective" | "performance">("tab", "objective");

  const objCount = OBJECTIVE.reduce((a, d) => a + d.rows.length, 0);
  const perfCount = PERFORMANCE.reduce((a, d) => a + d.rows.length, 0);
  const allRows = [...OBJECTIVE, ...PERFORMANCE].flatMap((d) => d.rows);
  const full = allRows.filter((r) => r.status === "full").length;
  const partial = allRows.filter((r) => r.status === "partial").length;
  const none = allRows.filter((r) => r.status === "none").length;

  const dims = tab === "objective" ? OBJECTIVE : PERFORMANCE;

  return (
    <Stack gap={20} style={{ padding: 24, maxWidth: 1180 }}>
      <Stack gap={6}>
        <H1>难度指标 · 提案 vs 系统现状对照</H1>
        <Text tone="secondary">
          对照你提出的 {allRows.length} 个难度指标与 OpenBlock 代码库已采用指标，按维度标注{" "}
          <Text weight="semibold" as="span">
            物理含义 · 计算口径异同 · 使用场景
          </Text>
          。来源：仓库静态检索（web/src 出块/画像链路 + rl_pytorch + backend）。
        </Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value={allRows.length} label="提案指标总数" />
        <Stat value={full} label="已实现（口径基本一致）" tone="success" />
        <Stat value={partial} label="部分对齐（命名/口径不同）" tone="warning" />
        <Stat value={none} label="未实现（系统缺口）" tone="danger" />
      </Grid>

      <Callout tone="warning" title="前提修正：本项目没有『题目（puzzle_id）』概念">
        <Text size="small">
          无尽模式盘面连续演化，<Code>(盘面 × 候选三块)</Code> 几乎不复现，无法按 <Code>puzzle_id</Code> 跨记录聚合。难度最小单元应是
          <Text weight="semibold" as="span">出块决策（spawn step）</Text>，难度由确定性特征<Text weight="semibold" as="span">逐步算出</Text>；跨记录稳定性改用
          <Text weight="semibold" as="span">难度特征分桶</Text>聚合。详见{" "}
          <Text>[出块决策难度细化](/Users/admin/Documents/work/opensource/openblock/docs/algorithms/SPAWN_STEP_DIFFICULTY.md)</Text>。
        </Text>
      </Callout>

      <Callout tone="info" title="三条结构性差异（决定大量指标落『未实现』）">
        <Stack gap={6}>
          <Text size="small">
            1. <Text weight="semibold" as="span">缺统一单步难度分 + 落库</Text>：系统已有分散的单步难度原语（<Code>boardDifficulty</Code> / DFS 解法指标 / v2 <Code>d_step</Code>），但未 consolidate 成「本次出块内在难度分」并落库，故 <Code>avg_*</Code> / <Code>global_*</Code> / <Code>algo_*</Code> 无法分析；<Code>*_range</Code> / <Code>*_cv</Code> 实为算法产出难度分布的离散度，本可直接算，只缺落库。
          </Text>
          <Text size="small">
            2. <Text weight="semibold" as="span">缺『设计最优解』基线</Text>：系统从不记录每步的设计/最优落点，故 <Code>is_exact_match</Code> 及其派生的整个
            <Text weight="semibold" as="span">惩罚与偏离族</Text>（think/steps/blast_exact·deviated、punish_index）全部无法计算。
          </Text>
          <Text size="small">
            3. <Text weight="semibold" as="span">视角不同</Text>：系统几何度量服务<Text weight="semibold" as="span">出块算法</Text>（spatialPressure/boardDifficulty 由 stress 驱动），体验度量服务<Text weight="semibold" as="span">玩家能力/心流</Text>（skillLevel/cognitiveLoad）；而提案是<Text weight="semibold" as="span">单步难度坐标</Text>，目标不重合。
          </Text>
        </Stack>
      </Callout>

      <Row gap={8} align="center">
        <Pill active={tab === "objective"} onClick={() => setTab("objective")}>
          ① 客观难度（{objCount}）
        </Pill>
        <Pill active={tab === "performance"} onClick={() => setTab("performance")}>
          ② 表现难度（{perfCount}）
        </Pill>
        <Text size="small" tone="tertiary" style={{ marginLeft: 8 }}>
          点击维度行展开明细表
        </Text>
      </Row>

      <Divider />

      <H2 style={{ color: theme.accent.primary }}>
        {tab === "objective" ? "① 客观难度指标" : "② 表现难度指标"}
      </H2>
      <DimensionList dims={dims} openFirst />

      <Divider />

      <H2>建议补齐落点（按性价比）</H2>
      <Table
        headers={["缺口", "最小落点", "可复用现成件", "价值"]}
        columnAlign={["left", "left", "left", "left"]}
        rows={[
          [
            <Code key="1">scd_score</Code>,
            <Text size="small" key="1b">在 boardTopology 增 combo_total_cells/(64−occupied) 比值</Text>,
            <Text size="small" tone="secondary" key="1c">shapeCellCount + occupiedCount 已有</Text>,
            <Text size="small" tone="tertiary" key="1d">纯几何、零依赖，可直接做空间档位</Text>,
          ],
          [
            <Code key="2">is_killer / is_long_bar</Code>,
            <Text size="small" key="2b">基于 cell_count + category + flexibility 定义布尔规则</Text>,
            <Text size="small" tone="secondary" key="2c">getShapeCategory + countLegalPlacements</Text>,
            <Text size="small" tone="tertiary" key="2d">解锁 combo_killer_cnt 等核心难度抓手</Text>,
          ],
          [
            <Code key="3">is_exact_match</Code>,
            <Text size="small" key="3b">moveSequence place 帧写入推荐格，落子时比对</Text>,
            <Text size="small" tone="secondary" key="3c">hintEngine/bot 已能算最优落点</Text>,
            <Text size="small" tone="tertiary" key="3d">解锁整个惩罚与偏离族 + punish_index</Text>,
          ],
          [
            <Code key="4">think_cv / *_range</Code>,
            <Text size="small" key="4b">在 buildReplayAnalysis 对序列加 stddev/mean、max−min</Text>,
            <Text size="small" tone="secondary" key="4c">profileAuditMath stddev 已有</Text>,
            <Text size="small" tone="tertiary" key="4d">离散度诊断，改动小</Text>,
          ],
          [
            <Code key="5">难度分桶聚合</Code>,
            <Text size="small" key="5b">先把单步难度分写入 spawn 帧，离线按『难度桶 × algo』汇总（无需 puzzle_id）</Text>,
            <Text size="small" tone="secondary" key="5c">scripts/tune-realtime-state.mjs 模式</Text>,
            <Text size="small" tone="tertiary" key="5d">还原『算法内难度分化』判定 + avg/global/algo</Text>,
          ],
        ]}
      />
    </Stack>
  );
}
