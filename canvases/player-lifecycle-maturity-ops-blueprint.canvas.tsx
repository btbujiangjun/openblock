import { Card, CardBody, CardHeader, Divider, Grid, H1, H2, H3, Pill, Row, Stack, Stat, Table, Text } from 'cursor/canvas';

export default function PlayerLifecycleMaturityOpsBlueprint() {
  return (
    <Stack gap={20}>
      <H1>OpenBlock 玩家生命周期与成熟度运营蓝图</H1>
      <Text>
        目标：从“规则驱动的局内策略系统”升级为“生命周期驱动的产品+运营闭环”，统一留存、成长、商业化与召回策略。
      </Text>

      <Grid columns={4} gap={12}>
        <Stat label="核心北极星" value="D30 留存" />
        <Stat label="增长护栏" value="D1 ≥ 45%" tone="success" />
        <Stat label="习惯护栏" value="D7 ≥ 20%" tone="warning" />
        <Stat label="商业化护栏" value="IAP + IAA 双轮" tone="info" />
      </Grid>

      <Divider />

      <H2>一、生命周期 × 成熟度双轴定义</H2>
      <Text>
        生命周期回答“玩家当前在哪个阶段”，成熟度回答“玩家当前会不会玩、愿不愿深玩、愿不愿付费”。两个维度必须解耦建模，再在运营策略层合并。
      </Text>

      <Card>
        <CardHeader title="A 轴：生命周期（行为时序）" />
        <CardBody>
          <Table
            headers={["阶段", "判定窗口", "主目标", "主风险", "策略重心"]}
            rows={[
              ["S0 新入场", "D0-D1 / 首 3 局", "完成 FTUE + 首次爽点", "教程流失", "减阻、快反馈、首局胜任感"],
              ["S1 激活", "D2-D7 / 4-20 局", "形成重复回访", "玩法单薄感", "每日目标、轻任务、首批元进度"],
              ["S2 习惯", "D8-D30 / 20-120 局", "周节奏与事件参与", "中期疲劳", "周循环活动、社交轻触达、分段难度"],
              ["S3 稳定", "D31-D90 / 120-400 局", "提升 LTV 与长期价值", "内容消耗快", "分层 LiveOps、赛季驱动、个性化报价"],
              ["S4 回流", "近 7/14/30 天未活跃", "重启动机与回归路径", "高折损召回", "高价值奖励、低打扰频控、回流引导"]
            ]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="B 轴：成熟度（能力与价值）" />
        <CardBody>
          <Table
            headers={["等级", "能力特征", "行为特征", "价值特征", "应对策略"]}
            rows={[
              ["M0 新手", "首手自由度波动大，误放率高", "会话短，撤销/提示依赖高", "尚无稳定付费/广告偏好", "强引导 + 低惩罚 + 首日保护"],
              ["M1 成长", "基础策略形成，连消稳定", "回访频率上升", "开始看激励广告", "任务驱动 + 技能教学 + 轻付费试探"],
              ["M2 熟练", "可规划 2-3 步，压力应对稳定", "周活稳定，活动参与", "广告/IAP 开始分化", "难度分层 + 活动分层 + 报价分层"],
              ["M3 资深", "复杂局面可控，追求效率", "高频参与排行榜/挑战", "中高 ARPPU 或高广告价值", "高挑战内容 + 竞争机制 + 赛季目标"],
              ["M4 核心", "策略深度高，容错需求低", "长期稳定在线", "高 LTV + 高社交扩散", "VIP权益 + 专属内容 + 社区共创"]
            ]}
          />
        </CardBody>
      </Card>

      <Divider />

      <H2>二、指标体系（可直接埋点落地）</H2>
      <Grid columns={2} gap={12}>
        <Card>
          <CardHeader title="生命周期指标（Stage KPI）" />
          <CardBody>
            <Table
              headers={["指标", "定义", "目标用途"]}
              rows={[
                ["D1/D3/D7/D14/D30", "分 cohort 回访率", "识别阶段性流失断点"],
                ["FTUE 完成率", "ftue_complete / ftue_start", "定位新手引导摩擦"],
                ["首局爽点率", "首局发生 clear_lines 或 perfect_clear", "验证首日正反馈"],
                ["活跃天占比", "ActiveDays7 / 7, ActiveDays30 / 30", "衡量习惯形成"],
                ["回流 7 日留存", "回流后 7 天仍活跃比例", "验证召回质量"],
                ["事件参与率", "参与活动人数 / 活跃人数", "检验 LiveOps 吸引力"]
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="成熟度指标（Maturity KPI）" />
          <CardBody>
            <Table
              headers={["指标", "定义", "映射模块"]}
              rows={[
                ["首手瓶颈中位数", "P50(firstMoveFreedom) 按 7 天窗口", "game.js + blockSpawn.js"],
                ["策略执行率", "建议动作触发后 3 步内兑现率", "strategyAdvisor + replay"],
                ["压力恢复时间", "stress > 0.65 到回落 < 0.45 的步数", "adaptiveSpawn + stressMeter"],
                ["容错依赖比", "undo/hint 使用次数 / 总局数", "skills + analyticsTracker"],
                ["操作效率", "每局 clears / placements", "analyticsTracker"],
                ["价值成熟度", "IAA 倾向 + IAP 倾向 + 付费深度", "adAdapter + purchase funnel"]
              ]}
            />
          </CardBody>
        </Card>
      </Grid>

      <Divider />

      <H2>三、当前项目现状诊断（基于代码）</H2>
      <Table
        headers={["模块", "现状", "风险", "优先级"]}
        rows={[
          ["retention/playerMaturity.js", "已有 L1-L4 评分框架", "权重固定、阈值硬编码，且混入 adExposure 导致成熟度偏商业化", "P0"],
          ["retention/playerLifecycleDashboard.js", "已有阶段定义与干预建议", "阶段判定使用 days/session 的 OR，易错分阶段", "P0"],
          ["monetization/retentionAnalyzer.js", "覆盖留存/漏斗/生命周期接口", "cohort 计算与漏斗 uniqueUsers 逻辑不严谨，趋势含随机模拟值", "P0"],
          ["web 局内策略链路", "stress + spawnIntent + firstMoveFreedom 已非常强", "与生命周期运营层映射不足，难做精细分群运营", "P1"],
          ["realTimeDashboard", "有实时汇总卡", "缺生命周期分群视角与实验看板", "P1"],
          ["CRM/触达策略", "有推送与召回模块", "缺频控、内容实验、分层模板编排", "P1"]
        ]}
        rowTone={["warning", "warning", "critical", "info", "info", "warning"]}
      />

      <Divider />

      <H2>四、可落地优化清单（按 90 天执行）</H2>

      <Card>
        <CardHeader title="0-30 天：先把度量做对（Measurement First）" trailing={<Pill tone="critical">P0</Pill>} />
        <CardBody>
          <Stack gap={8}>
            <Text>1) 重构成熟度评分为“双分制”：SkillScore（策略能力）与 ValueScore（商业价值）分开计算，再映射综合 MatureIndex。</Text>
            <Text>2) 生命周期改为“门槛 + 置信”判定：days/session/recency 三条件加权，替代当前单一 OR 判定。</Text>
            <Text>3) 修正 retentionAnalyzer 的 cohort 与 funnel 口径，所有转化统一按 uniqueUsers 与 cohortDate 计算。</Text>
            <Text>4) 在 analyticsTracker 增加关键事件：ftue_step_complete、intent_exposed、intent_followed、bottleneck_hit、recovery_success。</Text>
            <Text>5) 在 playerInsightPanel 输出 lifecycleStage + maturityBand，让局内策略与运营标签同屏可见。</Text>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="31-60 天：把分层运营跑起来（Segmented LiveOps）" trailing={<Pill tone="warning">P1</Pill>} />
        <CardBody>
          <Stack gap={8}>
            <Text>1) 建立“阶段 × 成熟度”策略矩阵（如 S1-M0、S2-M2、S4-M1）并绑定默认干预脚本。</Text>
            <Text>2) 建立召回实验框架：奖励强度（低/中/高）× 文案语气（挑战/收益/社交）× 触达时机（24h/72h/7d）。</Text>
            <Text>3) 建立玩法保真实验：对高风险段只动 clearGuarantee/sizePreference，不动核心手感，防“过度保姆化”。</Text>
            <Text>4) 为 M2+ 人群上线周循环活动：72 小时挑战 + 12-24 小时空窗，避免活动疲劳。</Text>
            <Text>5) 在 dashboard 增加分群看板：按 stage/maturity 看 D1-D30、ARPU、ad fatigue、churn 变化。</Text>
          </Stack>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="61-90 天：形成增长飞轮（Product + Ops Flywheel）" trailing={<Pill tone="success">P2</Pill>} />
        <CardBody>
          <Stack gap={8}>
            <Text>1) 建立“成熟度晋升任务”：从 M0→M1→M2 设计可解释里程碑（首个多消、连续 3 天回访、首个活动完成）。</Text>
            <Text>2) 形成混合变现分层：M0-M1 以 IAA 为主，M2-M4 强化 IAP 价值包与赛季权益。</Text>
            <Text>3) 建立 Winback 专区：回流玩家前 3 局使用回归保护参数集（stress cap、提示券、恢复奖励）。</Text>
            <Text>4) 建立“故事线运营”：spawnIntent 与运营文案统一词典，保证系统意图与触达话术一致。</Text>
            <Text>5) 形成周会机制：只看 8 个核心指标 + 3 个实验结论，避免报表过载。</Text>
          </Stack>
        </CardBody>
      </Card>

      <Divider />

      <H2>五、建议立即启动的 8 个实验</H2>
      <Table
        headers={["实验", "目标人群", "核心假设", "成功指标"]}
        rows={[
          ["E1 首日爽点加速", "S0-M0", "首局 90 秒内看到一次高价值反馈可显著抬升 D1", "D1、FTUE 完成率"],
          ["E2 瓶颈预警提示", "S1-M0/M1", "firstMoveFreedom <= 2 时给出轻提示可降低早期流失", "D3、失败后次局开启率"],
          ["E3 周活动节律", "S2-M1/M2", "72h 活动+空窗比连续活动更优", "活动参与率、D14"],
          ["E4 挑战包分层", "S2/S3-M2+", "按成熟度给挑战任务可提升留存且不伤满意度", "D30、NPS 替代指标"],
          ["E5 回流三局保护", "S4 全体", "回流首 3 局减压可提升回流 7 日留存", "回流7日留存"],
          ["E6 广告疲劳频控", "IAA 高曝光人群", "按 ad fatigue 动态限频可减少流失", "次日回访、IAA ARPDAU"],
          ["E7 首充时机模型", "S1/S2-M1", "在首次高峰体验后 1-2 局推首充包转化更高", "首充转化率"],
          ["E8 Intent 文案统一", "全体", "spawnIntent 与运营文案一致可提升策略理解与接受度", "建议执行率、会话时长"]
        ]}
      />

      <Divider />

      <H3>行业参考（用于口径对齐）</H3>
      <Stack gap={6}>
        <Text>• Teak 生命周期分层（New/Core/Risk/Lapsed/Dormant/Resurrected）</Text>
        <Text>• Solsten 对 D1/D7/D30 驱动因素拆解与常见基准（D1 40-50%，D7 20%，D30 10%）</Text>
        <Text>• GameAnalytics LiveOps 分析框架：Acquisition / Retention / Monetization 三柱 + 实验闭环</Text>
      </Stack>

      <Row gap={8}>
        <Pill tone="info">可执行优先级：P0 先修口径</Pill>
        <Pill tone="warning">先指标后运营</Pill>
        <Pill tone="success">90 天形成闭环</Pill>
      </Row>
    </Stack>
  );
}
