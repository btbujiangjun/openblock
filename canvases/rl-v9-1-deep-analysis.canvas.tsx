import { Card, CardBody, CardHeader, Divider, Grid, H1, H2, H3, Pill, Stack, Stat, Table, Text } from 'cursor/canvas';

const p0Rows = [
  ['P0', '颜色信息缺失', '状态只编码占用和形状，不编码棋盘/候选块颜色；同色整线 bonus 无法被策略稳定预判。', '新增颜色通道或行列同色摘要，重训对比 bonus 率与 avg score。'],
  ['P0', 'EvalGate 语义过松', 'winRatio=0.55 当前实现是 candidate >= baseline * 0.55，不是候选超过基线 55% 或配对胜率 55%。', '改用配对分差/配对胜率/置信区间作为晋级依据。'],
  ['P1', '价值目标高分段饱和', 'score/threshold clip 到 2；400-500 分接近上限，value 对更高分的辨别变钝。', '试 log-score target 或更高上限，并消融 outcomeValueMix。'],
  ['P1', 'feasibility 监督过弱', '只判断每块各自有位置，不判断是否存在三块顺序可全部放完。', '加入三块 DFS 可解叶子数或序贯可行性辅助头。'],
  ['P1', '3-ply r3 打包脆弱', '用 STATE_FEATURE_DIM 首行存 r3_arr；第三层合法动作数超过 162 时有异常风险。', '改成独立 r3 list 与 ns3 batch，避免隐式维度耦合。'],
];

const experimentRows = [
  ['A', '只修评估', 'EvalGate 改配对分差；离线同 seed 比 candidate/base。', '排除“日志 PASS 但棋力没涨”。'],
  ['B', '颜色特征消融', '占用特征 + 颜色摘要 vs 多通道颜色 one-hot。', '验证同色 bonus 是否是 400+ 天花板主因。'],
  ['C', '价值目标消融', 'outcomeMix 0.3/0.5/0.7，score clip 2/4/log。', '看 p90/p95 是否先于 avg100 抬升。'],
  ['D', 'teacher 可靠性', '2-ply、3-ply、MCTS 50 sims 分别训练；记录 teacher entropy、top1 margin。', '区分搜索弱、蒸馏弱、策略吸收弱。'],
  ['E', '序贯可行性', '现 feasibility vs DFS leaf count 辅助头。', '降低“各块都能放但顺序死局”的误导。'],
];

export default function RlV91DeepAnalysis() {
  return (
    <Stack gap={18}>
      <Stack gap={6}>
        <H1>RL v9.1 Deep Analysis</H1>
        <Text tone="secondary">400-500 分平台期的下一轮根因排序与实验路线。</Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="2" label="P0 blocking risks" tone="danger" />
        <Stat value="3" label="P1 implementation/modeling risks" tone="warning" />
        <Stat value="5" label="next experiments" />
        <Stat value="1" label="highest-leverage feature change" tone="success" />
      </Grid>

      <Card>
        <CardHeader
          title="Main Diagnosis"
          trailing={<Pill tone="danger">feature observability</Pill>}
        />
        <CardBody>
          <Text>
            当前代码已经补强了 ranked reward、3-ply teacher、visit_pi 蒸馏和配对 seed，
            但更深层的瓶颈是策略观测不到颜色 bonus，评估门控又可能过松，
            因而训练指标改善未必等价于真实得分突破。
          </Text>
        </CardBody>
      </Card>

      <H2>Risk Register</H2>
      <Table
        headers={['Level', 'Risk', 'Why it matters', 'Next action']}
        rows={p0Rows}
        rowTone={['danger', 'danger', 'warning', 'warning', 'warning']}
      />

      <Divider />

      <Grid columns={2} gap={16}>
        <Stack gap={8}>
          <H3>Industry Alignment</H3>
          <Text>
            单人 puzzle 的 AlphaZero-like 方法通常需要 Ranked Reward、policy-guided MCTS、
            value normalization，以及把 visit counts 作为直接策略目标。
          </Text>
          <Text>
            OpenBlock 已覆盖 ranked reward 和 visit_pi，但还缺少单人分数任务里的价值归一化校准，
            以及对颜色 bonus 和序贯可行性的可观测表示。
          </Text>
        </Stack>
        <Stack gap={8}>
          <H3>Metric Trap</H3>
          <Text>
            `qdst`、`vpi`、`rr` 下降或转正，只表示模型更贴近 teacher 或历史分位，
            不保证绝对分数提升。下一轮需要用同 seed 配对分差、p90/p95、bonus 率和死局前序贯可解性一起看。
          </Text>
        </Stack>
      </Grid>

      <H2>Experiment Plan</H2>
      <Table
        headers={['Order', 'Experiment', 'Change', 'Decision signal']}
        rows={experimentRows}
        rowTone={['danger', 'warning', undefined, undefined, undefined]}
      />
    </Stack>
  );
}
