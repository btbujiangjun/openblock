import { Card, CardBody, CardHeader, Divider, Grid, H1, H2, H3, Pill, Stack, Stat, Table, Text } from 'cursor/canvas';

const rows = [
  ['AlphaZero', '双人完美信息', 'MCTS + policy/value + visit CE + eval gate', '已具备一部分', 'visit_pi CE、EvalGate、MCTS 可选；但仍是 PPO 混合训练，不是纯 AZ policy iteration'],
  ['MuZero', '未知规则/Atari', '学习 dynamics/reward/value/policy 供搜索', '低优先', 'OpenBlock 有精确 simulator；更适合把 spawn 随机性做 chance model，而非完整 MuZero'],
  ['Ranked Reward R2', '单人稀疏分数', '滑动窗口分位奖励，把单人任务变成相对自博弈', '已实现', '已加 p50→p70 爬坡；后续关注绝对分与 ranked 指标是否背离'],
  ['Single-player MCTS / SameGame', '单人 puzzle', '单人 value normalization、max backup、policy-guided search', '高度相关', '当前缺少明确的单人 Q/value normalization，这是分数上探的关键缺口'],
  ['Expert Iteration', '搜索专家 + 网络学生', '搜索生成更强标签，网络蒸馏，再反哺搜索', '高度相关', '当前 q/visit 蒸馏是 ExIt-lite；应加入 replay buffer 和蒸馏退火'],
  ['Gumbel AlphaZero', '少模拟高效搜索', '无放回采样 + Q policy improvement，少量 sim 仍有效', '高性价比', '适合 OpenBlock 每步动作多、预算有限；可替代部分 root visit 逻辑'],
  ['Policy/Search Distillation', '工程化搜索蒸馏', '把 MCTS/beam 分布压进快速策略', '已部分实现', '需要 teacher 质量监控、entropy/margin、分阶段降低蒸馏权重'],
  ['Dreamer / World Models', '视觉/未知动态任务', '学习 latent world model 并 imagination RL', '中低优先', '完整世界模型不划算；可借鉴 reward/value transform 与随机出块建模'],
];

const roadmap = [
  ['1', '单人搜索值归一化', '对 beam/MCTS Q 做 per-state z-score/rank/softmax 温度校准', '减少 teacher/value 标度错位，提升高分段信号'],
  ['2', 'ExIt 化训练缓存', '保留 search-improved targets，按困难/高分/失败前状态重放', '提升样本效率，不只依赖最新 batch'],
  ['3', 'Gumbel root improvement', '根节点采样 top actions 后做小预算 Q 评估', '少模拟下提升 root policy target 质量'],
  ['4', 'Chance-aware dock refill', 'dock 放完前后加入 spawn predictor 或多样本期望', '降低对“已知当前三块”的过拟合'],
  ['5', 'Bonus-aware 表示升级', '从颜色摘要进到行列同色进度/颜色平面', '提高同色 bonus 命中率和 600+ 上限'],
  ['6', '稳健评估套件', '固定 seed、分位数、bonus率、死亡前 leaf_count、gate A/B', '避免指标好看但真实分不涨'],
];

export default function RlSelfPlayLiteratureComparison() {
  return (
    <Stack gap={18}>
      <Stack gap={6}>
        <H1>Self-Play RL Literature Comparison</H1>
        <Text tone="secondary">OpenBlock RL 与游戏自博弈论文/算法的横向对照。</Text>
      </Stack>

      <Grid columns={4} gap={12}>
        <Stat value="8" label="algorithm families reviewed" />
        <Stat value="3" label="already partially implemented" tone="success" />
        <Stat value="2" label="highest leverage gaps" tone="warning" />
        <Stat value="1" label="low priority family" />
      </Grid>

      <Card>
        <CardHeader title="Main Takeaway" trailing={<Pill tone="warning">single-player scoring</Pill>} />
        <CardBody>
          <Text>
            OpenBlock 已经接近 AlphaZero/Expert Iteration 的轻量工程版本：
            有搜索 teacher、visit/Q 蒸馏、Ranked Reward 和 EvalGate。真正的差距在单人分数游戏特有的
            value/Q 归一化、随机出块建模、困难样本重放，以及 bonus-aware 表示。
          </Text>
        </CardBody>
      </Card>

      <H2>Algorithm Fit</H2>
      <Table
        headers={['Family', 'Best for', 'Core idea', 'Fit', 'OpenBlock comparison']}
        rows={rows}
        rowTone={[undefined, undefined, 'success', 'warning', 'warning', 'warning', 'success', undefined]}
      />

      <Divider />

      <Grid columns={2} gap={16}>
        <Stack gap={8}>
          <H3>What To Borrow Now</H3>
          <Text>Borrow from Single-player MCTS: normalize unbounded scores and treat search values as lower-bound style improvements.</Text>
          <Text>Borrow from ExIt: make search labels a reusable training dataset, not only a transient batch signal.</Text>
          <Text>Borrow from Gumbel AlphaZero: improve root action selection under small simulation budgets.</Text>
        </Stack>
        <Stack gap={8}>
          <H3>What To Avoid For Now</H3>
          <Text>Full MuZero/Dreamer is likely overkill because OpenBlock has an exact simulator and low-dimensional structured state.</Text>
          <Text>Pure AlphaZero replacement may be too expensive; keep PPO, but reduce teacher dominance over time.</Text>
        </Stack>
      </Grid>

      <H2>Recommended Roadmap</H2>
      <Table
        headers={['Priority', 'Optimization', 'Implementation', 'Expected effect']}
        rows={roadmap}
        rowTone={['warning', 'warning', undefined, undefined, undefined, undefined]}
      />
    </Stack>
  );
}
