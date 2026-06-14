import { Card, CardBody, CardHeader, Divider, Grid, H1, H2, H3, Pill, Row, Stack, Stat, Table, Text, useHostTheme } from 'cursor/canvas';

const methodRows = [
  ['AlphaZero / neural MCTS', 'Policy-value network + search-improved target', 'Excellent for discrete planning; expensive but sample efficient'],
  ['Ranked Reward', 'Use percentile rank as self-play reward for single-agent tasks', 'Good for score plateau; turns 400-500 into relative ladder'],
  ['Beam search + Q distillation', 'Use shallow search to create supervised policy targets', 'Best first fit for OpenBlock three-piece turns'],
  ['Offline imitation / DAgger', 'Train from solver/beam traces, then improve online', 'Fast bootstrap; reduces random-policy cold start'],
  ['Hybrid offline-online RL', 'Replay strong trajectories and continue PPO/AWAC-like tuning', 'Stabilizes updates while preserving exploration'],
];

const roadmapRows = [
  ['P0', 'Three-piece beam teacher', 'Enumerate 3-piece sequences with pruning; train policy on search distribution', 'Breaks short-horizon plateau'],
  ['P1', 'Ranked reward ladder', 'Reward = current score percentile vs rolling buffer at same curriculum', 'Makes 400-500 no longer a flat signal'],
  ['P2', 'Value target split', 'Learn survival, next-round mobility, score potential, and outcome separately', 'Reduces noisy advantage'],
  ['P3', 'Hard-state replay', 'Oversample high-fill, high-regret, near-death states', 'Learns decisions that decide high scores'],
  ['P4', 'Eval gate', 'Only promote checkpoints beating baseline on fixed seeds', 'Prevents regressions from noisy PPO'],
];

const diagnosisRows = [
  ['Short horizon', 'Single action choice ignores remaining dock pieces', '2-ply/3-ply beam target'],
  ['Sparse high-value events', 'Multi-clear and bonus are rare, score gradient weak', 'Ranked reward + curriculum buckets'],
  ['Value noise', 'GAE depends on imperfect V; plateau makes advantage small', 'Auxiliary heads and search labels'],
  ['Distribution gap', 'Training spawn differs from adaptive player-facing spawn', 'Evaluate on fixed seed suites and stress buckets'],
  ['Throughput limit', 'All legal actions and simulations are expensive', 'Cache action features; beam prune top-K'],
];

export default function RLSelfPlayRoadmap() {
  const theme = useHostTheme();
  const accentStyle = { color: theme.accentForeground };

  return (
    <Stack gap={18}>
      <H1>OpenBlock RL Self-Play Improvement Roadmap</H1>
      <Text>
        Diagnosis: the 400-500 score plateau is less a network-size problem and more a search-target,
        credit-assignment, and curriculum problem. OpenBlock is a single-player three-piece planning
        puzzle, so the strongest next move is to train from search-improved decisions rather than pure
        policy-gradient rollouts.
      </Text>

      <Grid columns={4} gap={12}>
        <Stat value="8x8" label="board" />
        <Stat value="3" label="dock pieces per round" />
        <Stat value="30-80" label="typical legal actions" />
        <Stat value="P0" label="search teacher first" tone="warning" />
      </Grid>

      <Divider />

      <H2>Industry Patterns Mapped To OpenBlock</H2>
      <Table
        headers={['Method', 'Core idea', 'OpenBlock fit']}
        rows={methodRows}
      />

      <Grid columns={2} gap={16}>
        <Stack gap={10}>
          <H2>Plateau Diagnosis</H2>
          <Table
            headers={['Cause', 'Why it hurts', 'Best response']}
            rows={diagnosisRows}
          />
        </Stack>

        <Card>
          <CardHeader>
            <Row gap={8} align="center">
              <H3>Recommended Training Loop</H3>
              <Pill tone="info">Search-augmented</Pill>
            </Row>
          </CardHeader>
          <CardBody>
            <Stack gap={8}>
              <Text><span style={accentStyle}>1.</span> Generate fixed and random seeds across fill/stress buckets.</Text>
              <Text><span style={accentStyle}>2.</span> For each state, run 2-ply or 3-ply beam over remaining dock pieces.</Text>
              <Text><span style={accentStyle}>3.</span> Convert beam scores into a soft target distribution for policy distillation.</Text>
              <Text><span style={accentStyle}>4.</span> Train PPO with auxiliary heads, but anchor policy updates to search labels.</Text>
              <Text><span style={accentStyle}>5.</span> Promote only checkpoints that beat baseline on seed suites.</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>Implementation Priority</H2>
      <Table
        headers={['Priority', 'Change', 'What to do', 'Expected effect']}
        rows={roadmapRows}
      />
    </Stack>
  );
}
