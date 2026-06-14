import { Card, CardBody, CardHeader, Divider, Grid, H1, H2, H3, Pill, Row, Stack, Stat, Table, Text } from 'cursor/canvas';

const bottlenecks = [
  ['Replay 目标新鲜度', '中高', '旧轨迹不再进 PPO 是正确的，但 value 的 GAE 半边、ranked reward、teacher Q 仍可能来自旧分布。', 'Replay 改成 outcome-only value，或对 replay 的 ranked reward 重新计算。'],
  ['Teacher 覆盖率', '高', '默认仍是 3-ply beam；MCTS riskAdaptive 只有启用 MCTS 才生效。早期探索步也没有 teacher 监督。', '为 beam 增加风险自适应宽度，并允许早期动作只蒸馏不强制采样。'],
  ['目标尺度监控', '中', 'Q zscore+minStd 已防噪声尖锐化，但目前没有记录 target entropy / top1 margin。', '训练日志加入 teacher entropy、Q std、top1-top2 margin。'],
  ['评估口径', '中', 'EvalGate 是纯 policy 贪心；如果实际 bot 推理带 lookahead，门控可能低估候选。', '增加 policy-only 与 policy+search 两套评估指标。'],
  ['颜色奖励归因', '中', '颜色特征已加入，但奖励/aux 没有单独预测同色清除潜力。', '增加 bonus-line auxiliary 或 color-clear head。'],
];

const experiments = [
  ['E1', 'Replay outcome-only', '把 replay 的 value target 改为纯 outcome，禁用 replay GAE 与旧 ranked reward。', '降低 off-policy value 噪声，稳定吸收困难局。', '低'],
  ['E2', 'Beam risk adaptive', '在高填充/低 mobility 局面动态提高 3-ply topK/topK2。', '默认配置即可生效，比 MCTS 成本更可控。', '中'],
  ['E3', 'Teacher metrics', '记录 Q std、target entropy、visit entropy、teacher coverage。', '先判断 teacher 是太尖、太平，还是覆盖不足。', '低'],
  ['E4', 'Gate dual eval', 'EvalGate 同时输出 raw policy 与 policy+search 指标。', '避免好策略因评估口径错位被误判。', '中'],
  ['E5', 'Bonus auxiliary', '预测下一步/两步是否存在同色整线 bonus 机会。', '把颜色特征转成可学习的中间目标。', '中高'],
];

const signalMap = [
  ['PPO policy', '只吃当前 batch', '保持 on-policy，避免 replay ratio 偏差。'],
  ['Value loss', '当前 batch + replay', '建议 replay 切 outcome-only，减少旧轨迹 GAE 偏差。'],
  ['Q distillation', '当前 batch + replay', '适合 replay，但要监控 teacher entropy 与 stale teacher 年龄。'],
  ['visit_pi distillation', 'MCTS batch + replay', '默认 MCTS 关闭，短期不是主要贡献源。'],
  ['Ranked Reward', '当前 batch 终局步', '不建议直接重放旧 ranked reward，应按当前历史窗口刷新或只用于 on-policy。'],
];

export default function RLV93ScoreBreakthroughAnalysis() {
  return (
    <Stack gap={20}>
      <H1>RL v9.3 提分深度分析</H1>
      <Text tone="secondary">
        结论：当前改造已经把“搜索 teacher 能力”接入训练，下一阶段瓶颈会转向 teacher 样本是否新鲜、默认 beam 是否足够强、以及评估指标是否衡量真实部署能力。
      </Text>

      <Grid columns={4} gap={12}>
        <Stat value="5" label="主要瓶颈" tone="warning" />
        <Stat value="2" label="最高优先实验" tone="info" />
        <Stat value="低" label="下一步实现风险" tone="success" />
        <Stat value="中" label="预期算力增量" tone="warning" />
      </Grid>

      <Divider />

      <H2>当前判断</H2>
      <Grid columns="1.1fr 1fr" gap={16}>
        <Card>
          <CardHeader trailing={<Pill tone="success" size="sm">已改善</Pill>}>训练信号分工</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>Replay 样本已从 PPO policy ratio 中剥离，方向正确。</Text>
              <Text>Q 归一化加入 minStd 后，近似平局动作不再被 zscore 过度尖锐化。</Text>
              <Text>EvalGate 多 rounds 降低了 seed 偶然性，但也提高评估成本。</Text>
            </Stack>
          </CardBody>
        </Card>

        <Card>
          <CardHeader trailing={<Pill tone="warning" size="sm">仍需验证</Pill>}>最可能卡分的点</CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text>默认 MCTS 关闭，因此 riskAdaptive MCTS 不是日常训练的主要收益来源。</Text>
              <Text>Replay 仍可能携带旧 ranked reward 和旧 teacher Q，样本价值会随训练推进衰减。</Text>
              <Text>颜色特征已可观测，但缺少显式 bonus 规划监督。</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <H2>瓶颈矩阵</H2>
      <Table
        headers={['瓶颈', '优先级', '原因', '建议']}
        rows={bottlenecks}
        rowTone={['warning', 'warning', 'info', undefined, undefined]}
        striped
      />

      <H2>训练信号拆解</H2>
      <Table
        headers={['信号', '应参与样本', '分析']}
        rows={signalMap}
        rowTone={['success', 'warning', 'info', undefined, 'warning']}
        striped
      />

      <H2>下一批实验优先级</H2>
      <Table
        headers={['ID', '实验', '改动', '预期收益', '风险']}
        rows={experiments}
        rowTone={['success', 'warning', 'info', undefined, undefined]}
        striped
      />

      <Divider />

      <H2>建议的下一步</H2>
      <H3>优先实现 E1 + E3</H3>
      <Text>
        先把 replay value 改成 outcome-only，并增加 teacher entropy / Q std / replay steps 的日志。这样可以用最小代码风险确认：当前平台期到底是 teacher 太弱、蒸馏目标太噪，还是 replay 样本变旧。
      </Text>
      <Row gap={8} wrap>
        <Pill active tone="success">低风险</Pill>
        <Pill active tone="info">直接提升可观测性</Pill>
        <Pill active tone="warning">为 beam/MCTS 调参提供依据</Pill>
      </Row>
    </Stack>
  );
}
