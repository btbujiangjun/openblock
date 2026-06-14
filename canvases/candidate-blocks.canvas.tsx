import {
  Stack,
  H1,
  H2,
  Grid,
  Stat,
  Card,
  CardHeader,
  CardBody,
  Table,
  Text,
  Pill,
  Row,
  Divider,
  PieChart,
  BarChart,
  useHostTheme,
} from 'cursor/canvas';

type Shape = {
  id: string;
  name: string;
  category: string;
  data: number[][];
};

const SHAPES: Shape[] = [
  { id: '1x4', name: '1×4', category: 'lines', data: [[1, 1, 1, 1]] },
  { id: '4x1', name: '4×1', category: 'lines', data: [[1], [1], [1], [1]] },
  { id: '1x5', name: '1×5', category: 'lines', data: [[1, 1, 1, 1, 1]] },
  { id: '5x1', name: '5×1', category: 'lines', data: [[1], [1], [1], [1], [1]] },
  { id: '2x3', name: '2×3', category: 'rects', data: [[1, 1, 1], [1, 1, 1]] },
  { id: '3x2', name: '3×2', category: 'rects', data: [[1, 1], [1, 1], [1, 1]] },
  { id: '2x2', name: '2×2', category: 'squares', data: [[1, 1], [1, 1]] },
  { id: '3x3', name: '3×3', category: 'squares', data: [[1, 1, 1], [1, 1, 1], [1, 1, 1]] },
  { id: 't-up', name: 'T 上', category: 'tshapes', data: [[1, 1, 1], [0, 1, 0]] },
  { id: 't-down', name: 'T 下', category: 'tshapes', data: [[0, 1, 0], [1, 1, 1]] },
  { id: 't-left', name: 'T 左', category: 'tshapes', data: [[0, 1], [1, 1], [0, 1]] },
  { id: 't-right', name: 'T 右', category: 'tshapes', data: [[1, 0], [1, 1], [1, 0]] },
  { id: 'z-h', name: 'Z 横', category: 'zshapes', data: [[1, 1, 0], [0, 1, 1]] },
  { id: 'z-h2', name: 'Z 横 2', category: 'zshapes', data: [[0, 1, 1], [1, 1, 0]] },
  { id: 'z-v', name: 'Z 竖', category: 'zshapes', data: [[0, 1], [1, 1], [1, 0]] },
  { id: 'z-v2', name: 'Z 竖 2', category: 'zshapes', data: [[1, 0], [1, 1], [0, 1]] },
  { id: 'l-1', name: 'L 1', category: 'lshapes', data: [[1, 0], [1, 0], [1, 1]] },
  { id: 'l-2', name: 'L 2', category: 'lshapes', data: [[1, 1, 1], [1, 0, 0]] },
  { id: 'l-3', name: 'L 3', category: 'lshapes', data: [[1, 1], [0, 1], [0, 1]] },
  { id: 'l-4', name: 'L 4', category: 'lshapes', data: [[0, 0, 1], [1, 1, 1]] },
  { id: 'l5-a', name: 'L5 0°', category: 'lshapes', data: [[1, 1, 1], [1, 0, 0], [1, 0, 0]] },
  { id: 'l5-b', name: 'L5 90°', category: 'lshapes', data: [[1, 1, 1], [0, 0, 1], [0, 0, 1]] },
  { id: 'l5-c', name: 'L5 180°', category: 'lshapes', data: [[1, 0, 0], [1, 0, 0], [1, 1, 1]] },
  { id: 'l5-d', name: 'L5 270°', category: 'lshapes', data: [[0, 0, 1], [0, 0, 1], [1, 1, 1]] },
  { id: 'j-1', name: 'J 1', category: 'jshapes', data: [[0, 1], [0, 1], [1, 1]] },
  { id: 'j-2', name: 'J 2', category: 'jshapes', data: [[1, 0, 0], [1, 1, 1]] },
  { id: 'j-3', name: 'J 3', category: 'jshapes', data: [[1, 1], [1, 0], [1, 0]] },
  { id: 'j-4', name: 'J 4', category: 'jshapes', data: [[1, 1, 1], [0, 0, 1]] },
];

const CAT_LABEL: Record<string, string> = {
  lines: '线条',
  rects: '矩形',
  squares: '方块',
  tshapes: 'T 形',
  zshapes: 'Z 形',
  lshapes: 'L 形',
  jshapes: 'J 形',
};

const CAT_ORDER = ['lines', 'rects', 'squares', 'tshapes', 'zshapes', 'lshapes', 'jshapes'];

type WeightProfile = {
  id: string;
  label: string;
  stress: number;
  comment: string;
  weights: Record<string, number>;
};

const ADAPTIVE_PROFILES: WeightProfile[] = [
  { id: 'onboarding', label: '新手引导', stress: -0.2, comment: '首局前 5 轮，最大化线条/矩形让新手建立信心', weights: { lines: 3.18, rects: 2.2, squares: 1.8, tshapes: 0.45, zshapes: 0.35, lshapes: 0.53, jshapes: 0.45 } },
  { id: 'recovery', label: '紧急救场', stress: -0.1, comment: '板面接近满时触发，大量线条便于消行自救', weights: { lines: 2.95, rects: 2.0, squares: 1.3, tshapes: 0.6, zshapes: 0.5, lshapes: 0.68, jshapes: 0.6 } },
  { id: 'comfort', label: '舒适体验', stress: 0.0, comment: '低技能/挫败后恢复信心', weights: { lines: 2.65, rects: 1.85, squares: 1.6, tshapes: 0.75, zshapes: 0.65, lshapes: 0.83, jshapes: 0.75 } },
  { id: 'momentum', label: '连击催化', stress: 0.1, comment: 'combo 后或节奏释放期，催化连击正反馈', weights: { lines: 2.55, rects: 1.75, squares: 1.55, tshapes: 0.85, zshapes: 0.78, lshapes: 0.9, jshapes: 0.82 } },
  { id: 'guided', label: '引导成长', stress: 0.2, comment: '中低技能稳步成长', weights: { lines: 2.45, rects: 1.7, squares: 1.5, tshapes: 0.95, zshapes: 0.88, lshapes: 1.0, jshapes: 0.92 } },
  { id: 'breathing', label: '节奏呼吸', stress: 0.3, comment: '紧张周期后的释放窗口', weights: { lines: 2.3, rects: 1.65, squares: 1.45, tshapes: 1.0, zshapes: 0.95, lshapes: 1.08, jshapes: 1.0 } },
  { id: 'balanced', label: '均衡标准', stress: 0.4, comment: '心流核心区，与 normal 策略一致', weights: { lines: 2.15, rects: 1.55, squares: 1.35, tshapes: 1.12, zshapes: 1.12, lshapes: 1.2, jshapes: 1.12 } },
  { id: 'variety', label: '新鲜变化', stress: 0.5, comment: '防止审美疲劳，增加形状多样性', weights: { lines: 2.0, rects: 1.5, squares: 1.4, tshapes: 1.2, zshapes: 1.18, lshapes: 1.23, jshapes: 1.15 } },
  { id: 'challenge', label: '进阶挑战', stress: 0.65, comment: '不规则块明显增多', weights: { lines: 1.85, rects: 1.4, squares: 1.5, tshapes: 1.3, zshapes: 1.3, lshapes: 1.33, jshapes: 1.25 } },
  { id: 'intense', label: '极限考验', stress: 0.85, comment: '高手专属，T/Z/L/J 权重超过线条', weights: { lines: 1.58, rects: 1.3, squares: 1.55, tshapes: 1.42, zshapes: 1.48, lshapes: 1.46, jshapes: 1.38 } },
];

const DIFFICULTY_PROFILES: WeightProfile[] = [
  { id: 'easy', label: 'Easy', stress: 0, comment: '入门难度', weights: { lines: 2.30, rects: 1.65, squares: 1.45, tshapes: 1.05, zshapes: 1.05, lshapes: 1.13, jshapes: 1.05 } },
  { id: 'normal', label: 'Normal', stress: 0, comment: '标准难度（默认）', weights: { lines: 2.15, rects: 1.55, squares: 1.35, tshapes: 1.12, zshapes: 1.12, lshapes: 1.20, jshapes: 1.12 } },
  { id: 'hard', label: 'Hard', stress: 0, comment: '高难度', weights: { lines: 2.05, rects: 1.55, squares: 1.42, tshapes: 1.18, zshapes: 1.18, lshapes: 1.26, jshapes: 1.18 } },
];

function shapeCells(data: number[][]): number {
  let n = 0;
  for (const row of data) for (const v of row) if (v) n++;
  return n;
}

function shapeDims(data: number[][]): string {
  return `${data[0].length}×${data.length}`;
}

function categoryTotals(weights: Record<string, number>) {
  const counts: Record<string, number> = { lines: 4, rects: 2, squares: 2, tshapes: 4, zshapes: 4, lshapes: 8, jshapes: 4 };
  let total = 0;
  const byCat: Record<string, number> = {};
  for (const cat of CAT_ORDER) {
    byCat[cat] = (weights[cat] ?? 1) * counts[cat];
    total += byCat[cat];
  }
  return { byCat, total };
}

function shapeProb(shape: Shape, weights: Record<string, number>): number {
  const { total } = categoryTotals(weights);
  const w = weights[shape.category] ?? 1;
  return w / total;
}

function categoryShare(cat: string, weights: Record<string, number>): number {
  const { byCat, total } = categoryTotals(weights);
  return byCat[cat] / total;
}

function pct(x: number, digits = 2): string {
  return `${(x * 100).toFixed(digits)}%`;
}

function ShapeViz({ data, scale = 7 }: { data: number[][]; scale?: number }) {
  const { tokens: t } = useHostTheme();
  const cols = Math.max(...data.map((r) => r.length));
  return (
    <div
      style={{
        display: 'inline-grid',
        gridTemplateColumns: `repeat(${cols}, ${scale}px)`,
        gridAutoRows: `${scale}px`,
        gap: 1,
      }}
    >
      {data.flatMap((row, y) =>
        row.map((v, x) => (
          <div
            key={`${x}-${y}`}
            style={{
              width: scale,
              height: scale,
              background: v ? t.accent.primary : 'transparent',
              borderRadius: 1,
            }}
          />
        ))
      )}
    </div>
  );
}

function CategorySwatch({ cat }: { cat: string }) {
  const { tokens: t } = useHostTheme();
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 500,
        color: t.text.secondary,
        background: t.fill.tertiary,
        border: `1px solid ${t.stroke.tertiary}`,
        whiteSpace: 'nowrap',
      }}
    >
      {CAT_LABEL[cat] ?? cat}
    </span>
  );
}

export default function CandidateBlocks() {
  const { tokens: t } = useHostTheme();

  const normalWeights = DIFFICULTY_PROFILES.find((p) => p.id === 'normal')!.weights;
  const easyWeights = DIFFICULTY_PROFILES.find((p) => p.id === 'easy')!.weights;
  const hardWeights = DIFFICULTY_PROFILES.find((p) => p.id === 'hard')!.weights;

  const totalShapes = SHAPES.length;
  const totalCells = SHAPES.reduce((s, sh) => s + shapeCells(sh.data), 0);
  const avgCells = totalCells / totalShapes;

  const pieData = CAT_ORDER.map((cat) => ({
    label: CAT_LABEL[cat],
    value: Number((categoryShare(cat, normalWeights) * 100).toFixed(2)),
  }));

  const sortedByProb = [...SHAPES]
    .map((s) => ({ ...s, p: shapeProb(s, normalWeights) }))
    .sort((a, b) => b.p - a.p);

  const barCategories = sortedByProb.map((s) => s.id);
  const barSeries = [
    {
      name: 'Normal',
      data: sortedByProb.map((s) => Number((s.p * 100).toFixed(2))),
    },
  ];

  const shapeRows = SHAPES.map((s) => {
    const pE = shapeProb(s, easyWeights);
    const pN = shapeProb(s, normalWeights);
    const pH = shapeProb(s, hardWeights);
    return [
      <span style={{ fontFamily: 'ui-monospace, SFMono-Regular, monospace', fontSize: 12, color: t.text.secondary }}>
        {s.id}
      </span>,
      <ShapeViz data={s.data} scale={7} />,
      <CategorySwatch cat={s.category} />,
      <span style={{ color: t.text.secondary, fontSize: 12 }}>{shapeDims(s.data)}</span>,
      <span style={{ color: t.text.secondary, fontSize: 12 }}>{shapeCells(s.data)}</span>,
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{pct(pE)}</span>,
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: t.accent.primary, fontWeight: 600 }}>
        {pct(pN)}
      </span>,
      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{pct(pH)}</span>,
    ];
  });

  const allProfiles: WeightProfile[] = [...ADAPTIVE_PROFILES, ...DIFFICULTY_PROFILES];

  const matrixRows = allProfiles.map((p) => {
    const total = categoryTotals(p.weights).total;
    return [
      <span style={{ fontWeight: 600, fontSize: 12 }}>{p.label}</span>,
      <span style={{ color: t.text.tertiary, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
        {p.stress.toFixed(2)}
      </span>,
      ...CAT_ORDER.map((cat) => {
        const w = p.weights[cat];
        const share = categoryShare(cat, p.weights);
        return (
          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
            <span style={{ fontWeight: 500 }}>{w.toFixed(2)}</span>
            <span style={{ color: t.text.quaternary, marginLeft: 4, fontSize: 11 }}>
              {(share * 100).toFixed(0)}%
            </span>
          </span>
        );
      }),
      <span style={{ color: t.text.tertiary, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
        {total.toFixed(1)}
      </span>,
    ];
  });

  const dynamicFactors = [
    {
      layer: 'Layer 1',
      name: '完美清屏',
      mult: '×12.0',
      desc: '该块放置后可直接清空全盘（最高优先级）',
    },
    { layer: 'Layer 1', name: '清屏准备', mult: '×1〜7', desc: '盘面接近清空时，gap 填充块大幅加权' },
    { layer: 'Layer 1', name: '多消潜力', mult: '×1.6〜2.7', desc: 'multiClear ≥ 2 时指数加权' },
    { layer: 'Layer 1', name: '机动性', mult: '×log(1+P)', desc: '合法落点越多权重越高（fill 越高越敏感）' },
    { layer: 'Layer 1', name: '空洞修复', mult: '×1〜2', desc: 'fill > 0.5 且能减少空洞的块' },
    { layer: 'Layer 1', name: '临消行加成', mult: '×1〜3', desc: 'nearFullLines × 2.0' },
    { layer: 'Layer 2', name: 'Combo 链', mult: '×1〜1.8', desc: '连击活跃时偏好消行块' },
    { layer: 'Layer 2', name: '节奏 payoff', mult: '×1.7', desc: '收获相位放大 gap 填充块' },
    { layer: 'Layer 2', name: 'Size 偏好', mult: '×0.5〜2.5', desc: '高填充偏小块、热身偏大块' },
    { layer: 'Layer 2', name: '类别多样性', mult: '×0.2〜1', desc: '同轮重复类别 + 跨轮记忆衰减' },
    { layer: 'Layer 3', name: 'ClearGuarantee', mult: '×1.6〜2.1', desc: '强制保证 N 个消行块（hint）' },
    { layer: 'Layer 3', name: '里程碑', mult: '×1.3', desc: '刚跨分数门槛时偏好消行块' },
  ];

  const factorRows = dynamicFactors.map((f) => [
    <Pill size="sm" tone={f.layer === 'Layer 1' ? 'info' : f.layer === 'Layer 2' ? 'success' : 'warning'}>
      {f.layer}
    </Pill>,
    <span style={{ fontSize: 12, fontWeight: 500 }}>{f.name}</span>,
    <span
      style={{
        fontFamily: 'ui-monospace, monospace',
        fontSize: 12,
        color: t.accent.primary,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {f.mult}
    </span>,
    <span style={{ fontSize: 12, color: t.text.secondary }}>{f.desc}</span>,
  ]);

  return (
    <Stack gap={20}>
      <Stack gap={6}>
        <H1>候选块概率图鉴</H1>
        <Text tone="secondary">
          OpenBlock 的候选块从 <Text weight="semibold">28 个形状</Text> 池中按类别权重抽样。基础概率由
          <Text weight="semibold">类别权重 × 类别成员数</Text> 决定；运行时再叠加 12+ 个动态因子（清屏、多消、机动性、节奏、玩家画像）形成最终选择。
        </Text>
      </Stack>

      <Grid columns={4} gap={16}>
        <Stat value={totalShapes} label="候选形状总数" />
        <Stat value={CAT_ORDER.length} label="形状类别" />
        <Stat value={avgCells.toFixed(1)} label="平均单元数" />
        <Stat value={ADAPTIVE_PROFILES.length} label="自适应难度档位" />
      </Grid>

      <Divider />

      <Stack gap={12}>
        <H2>类别占比 (Normal 难度)</H2>
        <Text tone="secondary" size="small">
          单格抽样中各类别的概率分布。L 形池含 8 个成员，权重 1.20 时合计占比 25.6%，位居第一。
        </Text>
        <Grid columns="1fr 1fr" gap={20}>
          <PieChart data={pieData} donut size={260} />
          <Table
            headers={['类别', '权重 w', '成员数', 'w × n', '占比']}
            columnAlign={['left', 'right', 'right', 'right', 'right']}
            rows={CAT_ORDER.map((cat) => {
              const w = normalWeights[cat];
              const n = { lines: 4, rects: 2, squares: 2, tshapes: 4, zshapes: 4, lshapes: 8, jshapes: 4 }[cat]!;
              const share = categoryShare(cat, normalWeights);
              return [
                CAT_LABEL[cat],
                w.toFixed(2),
                n,
                (w * n).toFixed(2),
                <span style={{ color: t.accent.primary, fontWeight: 600 }}>{pct(share)}</span>,
              ];
            })}
          />
        </Grid>
      </Stack>

      <Stack gap={12}>
        <H2>单形状概率 (Normal 难度)</H2>
        <Text tone="secondary" size="small">
          基础概率 = 类别权重 / Σ(权重 × 类别成员数)。L 形虽然类别权重低于线条/矩形，但单个 L 形仍只有 3.21% — 多成员稀释了每个具体形状的概率。
        </Text>
        <BarChart categories={barCategories} series={barSeries} valueSuffix="%" height={260} />
      </Stack>

      <Card>
        <CardHeader trailing={<Pill size="sm" tone="info">28 个形状</Pill>}>候选块完整图鉴</CardHeader>
        <CardBody style={{ padding: 0 }}>
          <Table
            headers={['ID', '形状', '类别', '尺寸', '单元', 'P(Easy)', 'P(Normal)', 'P(Hard)']}
            columnAlign={['left', 'left', 'left', 'right', 'right', 'right', 'right', 'right']}
            rows={shapeRows}
            stickyHeader
            framed={false}
            striped
          />
        </CardBody>
      </Card>

      <Stack gap={12}>
        <H2>类别权重档位矩阵</H2>
        <Text tone="secondary" size="small">
          自适应引擎根据玩家压力 (stress ∈ [-0.2, 0.85]) 在 10 档 profile 间插值出实时权重；菜单难度 Easy / Normal / Hard 提供静态基线。每格显示「权重值 / 占比%」。
        </Text>
        <Table
          headers={['档位', 'stress', ...CAT_ORDER.map((c) => CAT_LABEL[c]), 'Σ 总权']}
          columnAlign={['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']}
          rows={matrixRows}
          striped
          rowTone={[
            ...ADAPTIVE_PROFILES.map((p) =>
              p.id === 'onboarding' ? 'info' : p.id === 'recovery' ? 'warning' : p.id === 'intense' ? 'danger' : undefined
            ),
            'success',
            'success',
            'success',
          ]}
        />
      </Stack>

      <Stack gap={12}>
        <H2>实际抽取的修正层</H2>
        <Text tone="secondary" size="small">
          基础类别概率只是起点。<Text weight="semibold">generateDockShapes</Text>（web/src/bot/blockSpawn.js）会对每个具体形状再叠加以下修正，最终概率与盘面状态、玩家画像、节奏强相关。
        </Text>
        <Table
          headers={['层级', '因子', '倍率', '触发条件']}
          columnAlign={['left', 'left', 'right', 'left']}
          rows={factorRows}
          striped
        />
      </Stack>

      <Card>
        <CardHeader>抽样算法（伪代码）</CardHeader>
        <CardBody>
          <Stack gap={6}>
            <Text size="small" tone="secondary">
              核心循环位于 <Text weight="semibold">blockSpawn.js</Text> 的 <Text weight="semibold">generateDockShapes()</Text>，伪代码：
            </Text>
            <pre
              style={{
                margin: 0,
                padding: 12,
                background: t.fill.quaternary,
                border: `1px solid ${t.stroke.tertiary}`,
                borderRadius: 6,
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                fontSize: 12,
                lineHeight: 1.55,
                color: t.text.primary,
                overflow: 'auto',
              }}
            >
{`for shape in allShapes:
    base   = strategy.weights[shape.category]    // 类别权重
    w      = base
    w     *= 1 + log1p(legalPlacements) * (.35 + fill*.55)    // Layer1 机动性
    w     *= 1 + holeReduction * .4                            // Layer1 空洞修复
    w     *= s.pcPotential==2 ? 12 : 1                         // Layer1 完美清屏
    w     *= 1 + multiClear * (.6 + multiClearBonus*.6)        // Layer1 多消
    w     *= 1 + nearFullFactor * 2                            // Layer1 临消行
    w     *= 1 + comboChain * .8                               // Layer2 连击
    w     *= rhythmPhase=='payoff' && gapFill>0 ? 1.7 : 1     // Layer2 节奏
    w     *= sizePref<0 ? smallBoost : largeBoost              // Layer2 尺寸
    w     *= max(.2, 1 - divBoost*usedCategoryCount)           // Layer2 多样性
    w     *= clearCount<clearTarget && gapFill>0 ? 1.6 : 1    // Layer3 保消
    w     *= scoreMilestone && gapFill>0 ? 1.3 : 1            // Layer3 里程碑
    pool.push({ shape, w })

triplet = []
for slot in range(3):
    pick = weightedSample(pool excluding triplet)
    triplet.push(pick)

if not tripletSequentiallySolvable(triplet):
    retry (max 22 attempts)
return shuffle(triplet)`}
            </pre>
            <Text size="small" tone="tertiary">
              22 次重试用于满足「sequentiallySolvable」校验：保证三连块按某种顺序放完仍有解，避免不公平死局。
            </Text>
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
