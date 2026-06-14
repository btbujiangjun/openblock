import {
  Button, Card, CardBody, CardHeader,
  CollapsibleSection,
  Code, Divider, Grid, H1, H2, H3,
  Pill, Row, Spacer, Stack, Stat, Table, Text,
  useCanvasState, useHostTheme,
} from 'cursor/canvas';

// ─── Signal database (code-verified) ────────────────────────────────────────

type Layer = 1 | 2 | 3;
type Category =
  | '盘面几何' | '玩家状态' | '跨轮上下文' | '局间历史'
  | '能力向量(AbilityVector)' | 'Stress分量·基础' | 'Stress分量·后置调制'
  | '出块意图(IntentRules)' | 'SpawnHints' | 'SpawnTargets'
  | '形状评分' | '形状选拔' | '约束验证' | '输出';

type Signal = {
  id: string; name: string; layer: Layer; cat: Category;
  semantic: string; formula: string; range: string; source: string;
  consumers: string[]; priority?: number; sign?: '+' | '-' | '±' | '?';
  note?: string;
};

// ── L1: Raw Signals ──────────────────────────────────────────────────────────
const L1: Signal[] = [
  // 盘面几何
  { id:'fill', name:'fill / fillRatio', layer:1, cat:'盘面几何', sign:'?',
    semantic:'盘面填充率：已落子格数占总格数的比例，是几乎所有二层信号的分母',
    formula:'Σ occupied_cells / (grid.size²)\n= 已落子格数 / 64  (8×8 网格)',
    range:'[0, 1]  0=空盘  1=满盘  典型游戏区间 0.30–0.75',
    source:'grid.getFillRatio()  (renderer.js)',
    consumers:['scoreStress baseline','boardRisk','roomForHoles','sizePreference','recoveryAdjust gate'] },
  { id:'holes', name:'enclosedVoidCells / holes', layer:1, cat:'盘面几何', sign:'-',
    semantic:'拓扑空腔数（被四邻全封堵的空格），代表盘面"脏度"，越高玩家越压抑',
    formula:'analyzeBoardTopology(grid).enclosedVoidCells\nBFS 从空格出发；四邻全被占 → 计入孔\n跳过 skipSpecialCells=true 时忽略事件注入块',
    range:'[0, 64]  典型值 0–8  >8 几乎死局',
    source:'boardTopology.js :: analyzeBoardTopology()',
    consumers:['holeReliefAdjust','boardRisk','holePressure','notAlreadyFullOfHoles(_tryInjectSpecial)'] },
  { id:'nearFullLines', name:'nearFullLines', layer:1, cat:'盘面几何', sign:'+',
    semantic:'差 1–2 格满行/满列数，代表"消行机会密度"，越高越容易触发消行',
    formula:'rows (filled≥size-2) + cols (filled≥size-2)',
    range:'[0, 16]  8行+8列  典型值 0–4',
    source:'analyzeBoardTopology() → nearFullLines',
    consumers:['harvest guard (≥2触发)','clearGuarantee boost','nearFullForIntent'] },
  { id:'pcSetup', name:'pcSetup', layer:1, cat:'盘面几何', sign:'+',
    semantic:'清屏机会评分：0=无机会 1=接近清屏 2=可立即清屏',
    formula:'analyzePerfectClearSetup(grid):\n  fill>0.45 && holes<3 && nearFull≥1 → 1\n  fill>0.60 && holes<2 && nearFull≥2 → 2',
    range:'{0, 1, 2}',
    source:'boardTopology.js :: analyzePerfectClearSetup()',
    consumers:['pcSetupForIntent','hasClearSetup(L2注入)','clearGuarantee++'] },
  { id:'mobility', name:'mobility', layer:1, cat:'盘面几何', sign:'+',
    semantic:'当前 dock 块的合法落点总数：衡量玩家有多少"可操作空间"',
    formula:'Σ validPlacements(block_i) for i in [0,2]',
    range:'[0, 192]  典型值 20–80',
    source:'blockSpawn.js :: computeCandidatePlacementMetric()',
    consumers:['AbilityVector.boardPlanning','bottleneckRelief gate','minMobility约束(L3)'] },
  { id:'close1', name:'close1 / close2', layer:1, cat:'盘面几何', sign:'+',
    semantic:'差 1 格/差 2 格满行的列数：比 nearFullLines 更精细的消行机会梯度',
    formula:'close1 = rows/cols (filled = size-1)\nclose2 = rows/cols (filled = size-2)',
    range:'[0, 16]',
    source:'analyzeBoardTopology() → close1 / close2',
    consumers:['AbilityVector.boardPlanning (closeLines=close1+close2)','clearGuarantee 精细 boost'] },
  { id:'multiClearCands', name:'multiClearCandidates', layer:1, cat:'盘面几何', sign:'+',
    semantic:'dock 三块中能同时消 ≥2 行/列的块数（几何上可多消的候选数）',
    formula:'count(dock blocks where _bestMultiClearPotential(grid,shape) ≥ 2)',
    range:'[0, 3]',
    source:'blockSpawn.js :: _bestMultiClearPotential()',
    consumers:['multiClearBonus','spawnHints.clearGuarantee','farFromPBBoost opportunity'] },

  // 玩家状态
  { id:'skillLevel', name:'skillLevel', layer:1, cat:'玩家状态', sign:'?',
    semantic:'玩家综合能力水平（局内 5 维加权 EMA），是 AbilityVector 的基础输入',
    formula:'blend(smoothSkill, historicalSkill, confidence)\nsmoothSkill = EMA(α=0.30) over 落子步\nhistoricalSkill = sessionHistory 近 30 局均值',
    range:'[0, 1]  0=纯新手  1=顶级高手',
    source:'playerProfile.js :: get skillLevel()',
    consumers:['skillAdjust','AbilityVector.skillScore','delight_starved threshold'] },
  { id:'flowState', name:'flowState', layer:1, cat:'玩家状态', sign:'?',
    semantic:'心流三态：bored(无聊)/flow(投入)/anxious(焦虑)——挑战与技能的动态平衡',
    formula:'F(t) = |boardPressure/skillLevel − 1|\nbored:   F<0.15 且 momentum≥-0.15\nflow:    0.15≤F≤0.30 且 momentum正常\nanxious: F>0.30 || momentum<-0.35',
    range:"'bored' | 'flow' | 'anxious'",
    source:'playerProfile.js :: get flowState()',
    consumers:['flowAdjust','pacingAdjust 参考','DFV flow chip'] },
  { id:'flowDeviation', name:'flowDeviation', layer:1, cat:'玩家状态', sign:'?',
    semantic:'心流偏离强度：F(t) 偏离"健康区间"的幅度，放大 flowAdjust 效果',
    formula:'flowDeviation = max(0, F(t) - 0.15)  if anxious/bored\n             = 0              if flow',
    range:'[0, 1+]',
    source:'playerProfile.js :: get flowDeviation()',
    consumers:['flowAdjust × min(2, 1+flowDeviation)'] },
  { id:'momentum', name:'momentum', layer:1, cat:'玩家状态', sign:'?',
    semantic:'近 12 步得分趋势：正数=上升 负数=下降，绝对值代表趋势强度',
    formula:'sign_weighted_sum(recent12_score_deltas)\n× confidence_scale(samples/12)\n样本<12 时向 0 收缩，避免极端抖动',
    range:'[-1, 1]  典型 |momentum| 0.2–0.6',
    source:'playerProfile.js :: get momentum()',
    consumers:['flowAdjust','pacingAdjust','sessionArcAdjust','endSessionDistress','flowState判断'] },
  { id:'frustrationLevel', name:'frustrationLevel', layer:1, cat:'玩家状态', sign:'-',
    semantic:'挫败累积计数：连续失误/无消行的指数衰减计数',
    formula:'每轮无消行 → +1\n每次消行 → × 0.5 衰减\nfrustrationCritical = level ≥ threshold(default=4)',
    range:'[0, ∞)  典型值 0–6',
    source:'playerProfile.js :: frustrationLevel',
    consumers:['frustrationRelief(−0.18)','forceReliefIntent(frustrationCritical)','challengeBoostBypass','bottleneckRelief折半'] },
  { id:'pickToPlaceMs', name:'pickToPlaceMs', layer:1, cat:'玩家状态', sign:'?',
    semantic:'选块→落子操作耗时（ms），反映操作流畅度和决策负荷',
    formula:'落子时间戳 − startDrag时间戳\nEMA(α=0.25) 平滑；样本≥3 才启用(reactionSamples)',
    range:'[0, ∞)  快速<350ms  缓慢>4500ms',
    source:'game.js :: _recordPickToPlace()  → profile.metrics.pickToPlaceMs',
    consumers:['reactionAdjust','AbilityVector.controlScore'] },
  { id:'missRate', name:'missRate', layer:1, cat:'玩家状态', sign:'-',
    semantic:'失误率：拖块但未成功放置的比例（放弃 / 放到无效位置）',
    formula:'missCount / totalDragAttempts  (短窗口 8步)',
    range:'[0, 1]',
    source:'playerProfile.js :: metrics.missRate',
    consumers:['AbilityVector.controlScore(negated)'] },
  { id:'cognitiveLoad', name:'cognitiveLoad', layer:1, cat:'玩家状态', sign:'-',
    semantic:'认知负荷估计：卡顿/长思考+失误率综合指数',
    formula:'blend(thinkTime_norm, missRate, afkRate)\nnorm 到 [0,1]',
    range:'[0, 1]  0=轻松  1=超载',
    source:'playerProfile.js :: cognitiveLoad',
    consumers:['AbilityVector.controlScore(negated)','accessibilityStressAdjust gate'] },
  { id:'hadRecentNearMiss', name:'hadRecentNearMiss', layer:1, cat:'玩家状态', sign:'-',
    semantic:'差一点效应：上轮 getMaxLineFill()≥0.875 且体感差（挫败≥4 或 anxious）',
    formula:'Grid.getMaxLineFill()≥0.875\n  && (frustrationLevel≥4 || (anxious && frustration≥2))\n  && clearRate<0.30 && momentum≤0\n  && !withinCooldown(12steps, 30s)',
    range:'boolean',
    source:'nearMissPlaceFeedback.js → profile.hadRecentNearMiss',
    consumers:['nearMissAdjust(−0.10)','reactionAdjust suppressor'] },
  { id:'needsRecovery', name:'needsRecovery', layer:1, cat:'玩家状态', sign:'-',
    semantic:'存活救援标志：填充率极高（>0.82）时强制触发，防止死局',
    formula:'boardFill > 0.82  (endSessionDistressActive gate)',
    range:'boolean',
    source:'playerProfile.js :: needsRecovery  ←  boardFill阈值',
    consumers:['recoveryAdjust(−0.20)','forceReliefIntent','challengeBoostBypass','bottleneckRelief折半'] },
  { id:'recentComboStreak', name:'recentComboStreak', layer:1, cat:'玩家状态', sign:'+',
    semantic:'近期连击链：连续每轮消行的轮数（最近窗口内）',
    formula:'count(consecutive clear rounds in recent window)',
    range:'[0, ∞)  ≥2 触发 comboAdjust',
    source:'playerProfile.js :: recentComboStreak',
    consumers:['comboAdjust(+0.05)','delightTuning.comboBoost'] },
  { id:'sessionPhase', name:'sessionPhase', layer:1, cat:'玩家状态', sign:'?',
    semantic:'当前会话阶段：warmup(前几轮)/active(中段)/late(后段)/cooldown',
    formula:'基于 totalRounds + momentum：\n  warmup:   totalRounds<5\n  late:     totalRounds>median && momentum<-0.2\n  cooldown: late && momentum<-0.35',
    range:"'warmup'|'active'|'late'|'cooldown'",
    source:'playerProfile.js :: sessionPhase',
    consumers:['sessionArcAdjust','endSessionDistress','deriveSessionArc()'] },
  { id:'trend', name:'trend', layer:1, cat:'玩家状态', sign:'?',
    semantic:'长周期进步/退步趋势：近 N 局 PB 相对变化斜率',
    formula:'linear_slope(recent_sessions.maxScore) / bestScore',
    range:'[-1, 1]',
    source:'playerProfile.js :: trend',
    consumers:['trendAdjust = trend × trendScale(0.08) × confidence'] },
  { id:'feedbackBias', name:'feedbackBias', layer:1, cat:'玩家状态', sign:'?',
    semantic:'闭环反馈偏移：玩家对当前难度的主观满意度调整量',
    formula:'personalization 模块输出的个性化偏移量',
    range:'[-0.1, 0.1]',
    source:'playerProfile.js :: feedbackBias',
    consumers:['stressBreakdown.feedbackBias (直接加入 stress Σ)'] },

  // 跨轮上下文
  { id:'roundsSinceSpecial', name:'roundsSinceSpecial', layer:1, cat:'跨轮上下文', sign:'+',
    semantic:'距上次特殊小块注入已过轮数（节流计数）',
    formula:'每轮 _commitSpawn 时 +1\n_tryInjectSpecial 命中后归 0',
    range:'[0, ∞)  注入门槛 ≥5',
    source:'game.js :: _spawnContext.roundsSinceSpecial',
    consumers:['_tryInjectSpecial gate','monoFlushRound throttle'] },
  { id:'comboChain', name:'comboChain', layer:1, cat:'跨轮上下文', sign:'+',
    semantic:'当前连击链长度：连续每轮消行的轮数（本局内，不跨局）',
    formula:'本轮消行 → +1；本轮未消行 → 归 0',
    range:'[0, ∞)  典型值 0–5',
    source:'game.js :: _spawnContext.comboChain',
    consumers:['delightTuning.comboBoost','multiClearBonus加成'] },
  { id:'monoFlushRound', name:'monoFlushRound', layer:1, cat:'跨轮上下文', sign:'?',
    semantic:'本轮是否允许同花顺彩蛋注入（每轮抽签节流令牌）',
    formula:'rng() < MONO_FLUSH_PICK_PROBABILITY\n  iOS/Web: 0.033  Android/Wechat: 0.050\n每轮 spawnBlocks 入口抽签一次',
    range:'boolean  ≈3–5% 命中率',
    source:'game.js :: _spawnContext.monoFlushRound',
    consumers:['_tryInjectSpecial :: allowMonoFlushLabel','Stage1 aScore monoFlush门'] },
  { id:'bottleneckTrough', name:'bottleneckTrough', layer:1, cat:'跨轮上下文', sign:'-',
    semantic:'当前 dock 最低合法落点数（瓶颈自由度谷值）：刻画"被迫接受唯一解"的压迫感',
    formula:'min(validPlacements_i) for i in dock blocks\n每次落子后滚动更新；_commitSpawn 时重置',
    range:'[0, 64]  ≤2 触发 bottleneckRelief',
    source:'game.js :: _updateBottleneckSignal() → _spawnContext.bottleneckTrough',
    consumers:['bottleneckRelief(max−0.12)','hasBottleneckSignal','challengeBoostBypass'] },
  { id:'totalRounds', name:'totalRounds', layer:1, cat:'跨轮上下文', sign:'+',
    semantic:'本局已完成的回合数（每次 _commitSpawn 时 +1）',
    formula:'_spawnContext.totalRounds, 初始 0',
    range:'[0, ∞)',
    source:'game.js :: _spawnContext.totalRounds',
    consumers:['sessionArc判定','warmup gate(>5才结束)','_tryInjectSpecial warmup保护'] },
  { id:'postPbReleaseActive', name:'postPbReleaseActive', layer:1, cat:'跨轮上下文', sign:'-',
    semantic:'破纪录释放窗口期：破 PB 后 N 轮内禁用 challengeBoost，给玩家"我赢了"的喘息',
    formula:'score > bestScore && roundsAfterPb < pbReleaseTtl(default=3)',
    range:'boolean',
    source:'game.js :: _spawnContext.postPbReleaseActive',
    consumers:['challengeBoostBypass (post_pb_release)','postPbReleaseStressAdjust(−0.07)'] },
  { id:'scoreMilestone', name:'scoreMilestone', layer:1, cat:'跨轮上下文', sign:'+',
    semantic:'刚跨局内分数里程碑（25%/50%/75%/100% bestScore 节点）',
    formula:'checkScoreMilestone(score, prevMilestone, milestones, bestScore)\n里程碑 = [best×0.25, ×0.50, ×0.75, ×1.00, ×1.10, ×1.25]',
    range:'boolean',
    source:'adaptiveSpawn.js :: checkScoreMilestone()',
    consumers:['blockSpawn Stage2 milestone乘子 ×1.3','clearGuarantee+1'] },

  // 局间历史
  { id:'bestScore', name:'bestScore', layer:1, cat:'局间历史', sign:'?',
    semantic:'历史最佳分（跨局持久化），所有 PB 追击计算的基准，也是 scoreStress 分母',
    formula:'max(all game scores)\n持久化到 localStorage → openblock_best_score',
    range:'[0, ∞)  新玩家=0',
    source:'game.js :: game.bestScore',
    consumers:['scoreStress','pbDistanceClose(≥best×0.80)','pbChasePressureActive','pbExtremeOrderBoost'] },
  { id:'daysSinceInstall', name:'daysSinceInstall', layer:1, cat:'局间历史', sign:'?',
    semantic:'安装天数：生命周期阶段 S0–S4 的主要时间维度',
    formula:'(now - firstSessionTs) / 86400000  (整天)\n首次 playerProfile 写入日期作锚点',
    range:'[0, ∞) 天',
    source:'playerProfile.js :: _daysSinceInstall',
    consumers:['getPlayerLifecycleStageDetail','stageCode S0–S4','lifecycleStressCap'] },
  { id:'totalSessions', name:'totalSessions / lifetimeGames', layer:1, cat:'局间历史', sign:'?',
    semantic:'终身总局数：与 daysSinceInstall 用 AND 门判定生命周期阶段（防高频玩家被锁在 S0）',
    formula:'_lifetimeGames，每局末 +1\n写入 playerProfile localStorage',
    range:'[0, ∞) 局',
    source:'playerProfile.js :: _lifetimeGames',
    consumers:['LIFECYCLE_THRESHOLDS AND门','maturity SkillScore.avgSessionCount'] },
  { id:'daysSinceLastActive', name:'daysSinceLastActive', layer:1, cat:'局间历史', sign:'-',
    semantic:'距上次活跃天数：≥7 天触发 S4 回流阶段，激活 winback 保护包',
    formula:'(now - lastActiveTs) / 86400000',
    range:'[0, ∞) 天',
    source:'playerProfile.js :: _daysSinceLastActive',
    consumers:['isWinbackCandidate(≥7天)','S4 stageCode','winbackPreset.stressCap=0.60'] },
  { id:'sessionHistory', name:'sessionHistory[]', layer:1, cat:'局间历史', sign:'?',
    semantic:'近 30 局会话摘要数组：每局的 score/clearRate/duration/ts 等，是长周期信号的原料',
    formula:'每局末 push {score, clearRate, duration, ts, ...}\ncap=30，超出从头部弹出',
    range:'Array<{score,clearRate,...}>  length∈[0,30]',
    source:'playerProfile.js :: _sessionHistory',
    consumers:['historicalSkill','trend','maturity SkillScore各维度'] },
  { id:'runStreak', name:'runStreak', layer:1, cat:'局间历史', sign:'+',
    semantic:'连续开局次数（不点返回菜单）：影响 sessionArc 和 abovePb 激励路径',
    formula:'局末 +1；点"返回菜单"归 0',
    range:'[0, ∞)  典型值 1–20',
    source:'game.js :: game.runStreak',
    consumers:['runStreakStress','sessionArc','abovePb(runStreak≥2)'] },
  { id:'maturSkillScore', name:'maturitySkillScore (跨局)', layer:1, cat:'局间历史', sign:'?',
    semantic:'跨局 SkillScore（M-band 依据）：7 维局间画像，按天 EMA，与局内 AbilityVector.skillScore 完全独立',
    formula:'SkillScore = round(Σ _norm(field, max) × weight × 100)\n  avgSessionCount(max=10) × 0.1875\n  sessionDuration(max=300s) × 0.125\n  returnFrequency(max=7/week) × 0.1875\n  featureAdoption(0-1) × 0.125\n  maxLevel(max=50) × 0.125\n  totalScore(max=100000) × 0.125\n  achievementCount(max=30) × 0.125',
    range:'[0, 100]  →M0(<40) M1(40-59) M2(60-79) M3(80-89) M4(≥90)',
    source:'playerMaturity.js :: calculateSkillScore()  每局 onSessionEnd 写盘',
    consumers:['getMaturityBand()','LIFECYCLE_STRESS_CAP_MAP[stage·band]','lifecycleCapAdjust'] },
];

// ── L2: Derived Signals ──────────────────────────────────────────────────────
const L2: Signal[] = [
  // AbilityVector
  { id:'av_skill', name:'AbilityVector.skillScore', layer:2, cat:'能力向量(AbilityVector)', sign:'?',
    semantic:'局内综合能力分（5维加权），每步 EMA 刷新（≠ 跨局 maturity SkillScore）',
    formula:'baseSkill = profile.skillLevel\n若 modelBaseline.confidence≥0.35:\n  blend = baseSkill×(1-conf×0.35) + baseline.skillScore×conf×0.35\n否则直接用 baseSkill',
    range:'[0, 1]',
    source:'playerAbilityModel.js :: buildPlayerAbilityVector()',
    consumers:['skillAdjust = (skillScore-0.5)×0.30×confGate','difficultyTuning'] },
  { id:'av_control', name:'AbilityVector.controlScore', layer:2, cat:'能力向量(AbilityVector)', sign:'?',
    semantic:'操作稳定性（v2）：失误率 + 认知负荷 + AFK + APM + 反应速度的综合',
    formula:'weights (game_rules.json):\n  missRate_inv × w.missRate(0.30)\n+ cognitiveLoad_inv × w.cognitive(0.25)\n+ afk_inv × w.afk(0.20)\n+ apm_norm × w.apm(0.10)\n+ reaction_norm × w.reaction(0.15)\nnorm: pickToPlaceMs→[0,1] (fast=350ms→1, slow=4500ms→0)',
    range:'[0, 1]',
    source:'playerAbilityModel.js',
    consumers:['AbilityVector.skillScore blend','UI 能力指标面板'] },
  { id:'av_clear', name:'AbilityVector.clearEfficiency', layer:2, cat:'能力向量(AbilityVector)', sign:'?',
    semantic:'消行效率（v2）：消行率 + 多消深度 + 清屏稀缺事件',
    formula:'clearRate × w.clearRate(0.40)\n+ comboRate × w.comboRate(0.20)\n+ multiClearRate × w.multiClear(0.25)\n+ perfectClearRate × w.perfectClear(0.15)',
    range:'[0, 1]',
    source:'playerAbilityModel.js (clearMetrics window=16)',
    consumers:['AbilityVector.skillScore blend','UI 面板'] },
  { id:'av_planning', name:'AbilityVector.boardPlanning', layer:2, cat:'能力向量(AbilityVector)', sign:'?',
    semantic:'盘面规划能力：空洞控制 + 可落位 + 近满线机会',
    formula:'holes_inv_norm × w.holes(0.30)\n+ mobility_norm × w.mobility(0.30)\n+ closeLines_norm × w.closeLines(0.25)\n+ boardFill_inv × w.fillInverse(0.15)',
    range:'[0, 1]',
    source:'playerAbilityModel.js',
    consumers:['AbilityVector.skillScore blend','abilityRiskAdjust gate'] },
  { id:'av_risk', name:'AbilityVector.riskLevel', layer:2, cat:'能力向量(AbilityVector)', sign:'-',
    semantic:'短期死局风险（v2）：填充(线性) + 空洞 + 挫败 + 未消行 + 控制 + 填充速度 + dock锁死',
    formula:'liveRisk = clamp(\n  boardFill × riskW.fill(0.26)          ← 线性，非fill²\n+ holePenalty × riskW.holes(0.22)       ← holePenalty=min(1,holes/8)\n+ min(1,frustration/5) × riskW.frust(0.14) ← 挫败而非未消行\n+ min(1,roundsSinceClear/4) × riskW.noClears(0.10)\n+ (1-controlScore) × riskW.control(0.10)\n+ fillVelocityScore × riskW.velocity(0.10)\n+ lockRiskScore × riskW.lockRisk(0.08))\n若baseline.confidence≥0.45:\n  riskLevel = liveRisk×0.75 + baseline.riskLevel×0.25',
    range:'[0, 1]  >0.62 触发 abilityRiskAdjust',
    source:'playerAbilityModel.js :: liveRisk (line 321-329)',
    consumers:['boardRisk derivation','abilityRiskAdjust(max -0.08)','recoveryAdjust gate'] },
  { id:'av_conf', name:'AbilityVector.confidence', layer:2, cat:'能力向量(AbilityVector)', sign:'+',
    semantic:'数据置信度（v2）：样本量 + 局间活跃度 + 长草衰减',
    formula:'sampleConf = min(1, lifetimePlacements/50)\nsessionConf = min(1, sessionHistory.length/10)\nrecencyDecay = exp(-daysSinceLastActive/14)\nconfidence = (sampleConf×0.4 + sessionConf×0.3 + recencyDecay×0.3)',
    range:'[0, 1]',
    source:'playerAbilityModel.js (confidenceCfg)',
    consumers:['confGate = 0.4+0.6×conf (收窄低置信 skillAdjust)','trendAdjust × conf'] },

  // Stress 基础分量 (stressBreakdown Σ)
  { id:'scoreStress', name:'scoreStress', layer:2, cat:'Stress分量·基础', sign:'+',
    semantic:'分数压力：当前分数相对 PB 百分位的 S 形映射，是 stress 最大贡献项',
    formula:'getSpawnStressFromScore(score, {bestScore})\n  pct = score/bestScore  若 bestScore>0\n  S形映射:\n    pct≤0.30 → 0\n    0.30–1.00 → 线性升至 0.78\n    1.00+ → 接近上限\n  新玩家(best=0) → log(score) 默认曲线',
    range:'[-0.2, 0.78]  最大单项贡献',
    source:'adaptiveSpawn.js :: getSpawnStressFromScore()',
    consumers:['stress Σ','stressBreakdown.scoreStress'] },
  { id:'runStreakStress', name:'runStreakStress', layer:2, cat:'Stress分量·基础', sign:'+',
    semantic:'连战加压：连续开局越多轻微增加 stress（模拟"闯关人"状态）',
    formula:'getRunDifficultyModifiers(runStreak).stressBonus\n  runStreak=1→0  2→0.02  5→0.06  10+→0.10',
    range:'[0, 0.10]',
    source:'adaptiveSpawn.js :: getRunDifficultyModifiers()',
    consumers:['stress Σ'] },
  { id:'difficultyBias', name:'difficultyBias', layer:2, cat:'Stress分量·基础', sign:'?',
    semantic:'玩家选择难度的基线偏移：easy(-0.22) normal(0) hard(+0.22)',
    formula:"baseStrategyId='easy' → -0.22\n'normal' → 0.00\n'hard' → +0.22\n可由 game_rules difficultyTuning 覆写",
    range:'[-0.22, +0.22]',
    source:'adaptiveSpawn.js :: difficultyBias',
    consumers:['stress Σ（最大固定偏移项）'] },
  { id:'skillAdjust', name:'skillAdjust', layer:2, cat:'Stress分量·基础', sign:'?',
    semantic:'技能调节：实际能力偏离中位时修正 stress（高手→加压/新手→减压）',
    formula:'(skillScore - 0.5) × fz.skillAdjustScale(0.30) × confGate\nconfGate = 0.4 + 0.6×confidence\n高手(1.0,conf=1): +0.15  新手(0.0,conf=1): -0.15',
    range:'[-0.15, +0.15]',
    source:'adaptiveSpawn.js :: skillAdjust',
    consumers:['stress Σ'] },
  { id:'flowAdjust', name:'flowAdjust', layer:2, cat:'Stress分量·基础', sign:'?',
    semantic:'心流调节：bored→加压 anxious→减压（注意：bored是正值，anxious是负值）',
    formula:"bored:   +fz.flowBoredAdjust(0.08)  × min(2,1+flowDeviation)\nflow:    0\nanxious: +fz.flowAnxiousAdjust(-0.12) × min(2,1+flowDeviation)\n注意：flowBoredAdjust默认+0.08(加压), flowAnxiousAdjust默认-0.12(减压)",
    range:'[-0.24, +0.16]  (含偏离放大)',
    source:'adaptiveSpawn.js :: flowAdjust',
    consumers:['stress Σ'] },
  { id:'reactionAdjust', name:'reactionAdjust', layer:2, cat:'Stress分量·基础', sign:'?',
    semantic:'反应速度微调：过快→轻微加压 过慢→轻微减压（弱信号，≤±0.05）',
    formula:"reactionMs < fastMs(350ms):\n  +maxAdjust(0.05) × (fastMs-ms)/fastMs\nreactionMs > slowMs(4500ms):\n  -maxAdjust(0.05) × (ms-slowMs)/slowMs\n中间段: 0\n若nearMissAdjust<-0.05 且reactionAdjust<0 → 强制0（让位强信号）",
    range:'[-0.05, +0.05]',
    source:'adaptiveSpawn.js :: reactionAdjust (v1.46)',
    consumers:['stress Σ'] },
  { id:'pacingAdjust', name:'pacingAdjust', layer:2, cat:'Stress分量·基础', sign:'?',
    semantic:'节奏张弛：release 相位减压、tension 相位加压',
    formula:"pacingPhase='release' → pacing.releaseBonus(-0.12)\n         ='tension' → pacing.tensionBonus(+0.04)",
    range:'[-0.12, +0.04]',
    source:'adaptiveSpawn.js :: pacingAdjust',
    consumers:['stress Σ'] },
  { id:'recoveryAdjust', name:'recoveryAdjust', layer:2, cat:'Stress分量·基础', sign:'-',
    semantic:'存活保障：needsRecovery=true（boardFill>0.82）时强制大幅减压',
    formula:'needsRecovery → fz.recoveryAdjust(-0.20)\n否则 0',
    range:'[-0.20, 0]',
    source:'adaptiveSpawn.js :: recoveryAdjust',
    consumers:['stress Σ','playerDistress Σ'] },
  { id:'frustRelief', name:'frustrationRelief', layer:2, cat:'Stress分量·基础', sign:'-',
    semantic:'挫败救济：连续挫败达到阈值时大幅减压，防止玩家放弃',
    formula:'frustrationLevel ≥ frustThreshold(default=4)\n  → eng.frustrationRelief(-0.18)',
    range:'[-0.18, 0]',
    source:'adaptiveSpawn.js :: frustRelief',
    consumers:['stress Σ','playerDistress Σ'] },
  { id:'comboAdjust', name:'comboAdjust', layer:2, cat:'Stress分量·基础', sign:'+',
    semantic:'连击奖励：连续消行时轻微加压（玩家状态好，可承受更多挑战）',
    formula:'recentComboStreak ≥ 2 → fz.comboRewardAdjust(+0.05)',
    range:'[0, +0.05]',
    source:'adaptiveSpawn.js :: comboAdjust',
    consumers:['stress Σ'] },
  { id:'nearMissAdjust', name:'nearMissAdjust', layer:2, cat:'Stress分量·基础', sign:'-',
    semantic:'差一点效应：上轮差点消行时减压，触发"再来一次"心理',
    formula:'hadRecentNearMiss → eng.nearMissStressBonus(-0.10)',
    range:'[-0.10, 0]',
    source:'adaptiveSpawn.js :: nearMissAdjust',
    consumers:['stress Σ','playerDistress Σ','reactionAdjust suppressor'] },
  { id:'trendAdjust', name:'trendAdjust', layer:2, cat:'Stress分量·基础', sign:'?',
    semantic:'长周期进步趋势调节：进步中→轻微加压 退步中→轻微减压',
    formula:'trend × fz.trendAdjustScale(0.08) × confidence',
    range:'[-0.08, +0.08]  (低置信时更小)',
    source:'adaptiveSpawn.js :: trendAdjust',
    consumers:['stress Σ'] },
  { id:'sessionArcAdjust', name:'sessionArcAdjust', layer:2, cat:'Stress分量·基础', sign:'?',
    semantic:'会话弧线调节：warmup 减压 cooldown（下行动量）进一步减压',
    formula:"arc='warmup' → -0.08\narc='cooldown' && momentum<-0.2:\n  excess=min(0.4,|momentum|-0.2)\n  → -(0.05 + excess×0.375)  范围[-0.05,-0.20]",
    range:'[-0.20, 0]',
    source:'adaptiveSpawn.js :: sessionArcAdjust (v1.51)',
    consumers:['stress Σ'] },
  { id:'endSessionDistress', name:'endSessionDistress', layer:2, cat:'Stress分量·基础', sign:'-',
    semantic:'末段崩盘救济：late 阶段 + 强下行动量时的独立减压脉冲（区别于 arc 调节）',
    formula:"sessionPhase='late' && momentum≤-0.30:\n  slope=min(0.30,|momentum|-0.30)\n  distress=-(0.05+slope×0.50)  max clip -0.25\n  若frustration≥4 再 -0.06",
    range:'[-0.25, 0]  最大单项负减压',
    source:'adaptiveSpawn.js :: endSessionDistress (v1.51)',
    consumers:['stress Σ','forceReliefIntent激活源之一','playerDistress Σ'] },
  { id:'holeReliefAdjust', name:'holeReliefAdjust', layer:2, cat:'Stress分量·基础', sign:'-',
    semantic:'空洞减压：holePressure（空洞压力比）越高越减压',
    formula:'holePressure = holes / topoCfg.holePressureMax(8)\nholeReliefAdjust = holePressure × topo.holeReliefStress(-0.16)',
    range:'[-0.16, 0]',
    source:'adaptiveSpawn.js :: holeReliefAdjust',
    consumers:['stress Σ','playerDistress Σ'] },
  { id:'boardRiskReliefAdj', name:'boardRiskReliefAdjust', layer:2, cat:'Stress分量·基础', sign:'-',
    semantic:'综合盘面风险减压：boardRisk 越高越减压（保护玩家不被烂棋状态叠压）',
    formula:'boardRisk = deriveBoardRisk(fill, holePressure, riskLevel)\nboardRiskReliefAdjust = boardRisk × topo.boardRiskReliefStress(-0.10)',
    range:'[-0.10, 0]',
    source:'adaptiveSpawn.js :: boardRiskReliefAdjust',
    consumers:['stress Σ','playerDistress Σ'] },
  { id:'abilityRiskAdj', name:'abilityRiskAdjust', layer:2, cat:'Stress分量·基础', sign:'-',
    semantic:'能力风险减压：riskLevel 极高且置信充足时额外减压（进 stress Σ，但不进 playerDistress）',
    formula:'confidence≥0.25 && riskLevel≥0.62:\n  abilityRiskAdjust = -0.08 × min(1,(riskLevel-0.62)/0.38)',
    range:'[-0.08, 0]',
    source:'adaptiveSpawn.js :: abilityRiskAdjust',
    note:'⚠ 只进入 stress Σ，不在 playerDistress 聚合中（playerDistress 只含 recovery/frustration/nearMiss/hole/boardRisk/bottleneck/endSession 七项）',
    consumers:['stress Σ (仅此，不进 playerDistress Σ)'] },
  { id:'friendlyBoardRelief', name:'friendlyBoardRelief', layer:2, cat:'Stress分量·基础', sign:'-',
    semantic:'友好盘面减压：盘面干净(无孔)+消行机会充沛+节奏 payoff 时减压，避免"快乐盘"显示高压',
    formula:'deriveFriendlyBoardRelief(ctx, fill, holes, rhythmPhase, cfg):\n触发条件（全部满足）:\n  ① holes === 0          ← 无孔（注意：不是 holes>2）\n  ② nearFullLines ≥ 2    ← 近满线充沛（不是 <2）\n  ③ multiClearCands≥2 || pcSetup≥1\n  ④ rhythmPhase === "payoff"\nopportunity = min(1, nearFull/4 + multiClear/4 + pcSetup×0.3)\ncleanBoard = 1 - fill\nintensity = clamp(0.4+0.6×(opportunity×0.7+cleanBoard×0.3))\nrelief = baseRelief(-0.12) + (maxRelief(-0.18)-baseRelief) × intensity',
    range:'[-0.18, -0.12]  条件不满足时为 0',
    source:'adaptiveSpawn.js :: deriveFriendlyBoardRelief() (line 377-398)',
    note:'⚠ 只进 stress Σ，不进 playerDistress 聚合（playerDistress 仅含 7 项）。challengeBoost 同帧时互抑×0.42',
    consumers:['stress Σ (仅此，不进 playerDistress Σ)','challengeBoost×0.42互抑','bottleneckRelief折半判定'] },
  { id:'bottleneckRelief', name:'bottleneckRelief', layer:2, cat:'Stress分量·基础', sign:'-',
    semantic:'瓶颈低谷救济：当前 dock 最低落点极少时减压（动态补充静态盘面信号）',
    formula:'hasBottleneckSignal(trough≤threshold=2 && samples>0):\n  sev=(threshold-trough)/threshold\n  relief=bottleneckReliefMax(-0.12) × min(1,0.4+0.6×sev)\nfriendlyBoardRelief<-0.10 → ×0.5  (互抑)\nneedsRecovery or frustration≥threshold → ×0.5',
    range:'[-0.12, 0]  (互抑后 max -0.06)',
    source:'adaptiveSpawn.js :: bottleneckRelief (v1.30)',
    consumers:['stress Σ','playerDistress Σ','hasBottleneckSignal→challengeBoostBypass'] },
  { id:'motivationStressAdj', name:'motivationStressAdjust', layer:2, cat:'Stress分量·基础', sign:'?',
    semantic:'动机意图调节：challenge 型玩家轻微加压；relaxation/competence 型减压',
    formula:"motivationIntent='challenge' && skill≥0.68 && risk≤0.48 → +0.045\n='relaxation'|'competence' → -0.045\n='balanced' → 0",
    range:'[-0.045, +0.045]',
    source:'adaptiveSpawn.js :: motivationStressAdjust',
    consumers:['stress Σ'] },
  { id:'delightStressAdj', name:'delightStressAdjust', layer:2, cat:'Stress分量·基础', sign:'?',
    semantic:'爽感偏置：当前爽感模式对 stress 的额外调整',
    formula:'deriveDelightTuning(profile, ctx, fill, cfg).stressAdjust\n爽感缺失 → 负值  爽感充足 → 轻微正值',
    range:'[-0.08, +0.04]',
    source:'adaptiveSpawn.js :: delight.stressAdjust',
    consumers:['stress Σ'] },

  // Stress 后置调制
  { id:'lifecycleCapAdj', name:'lifecycleCapAdjust + bandAdjust', layer:2, cat:'Stress分量·后置调制', sign:'?',
    semantic:'S×M 矩阵双步调制：cap 截断 + adj 偏移（在 rawStress 之后、smoothing 之前）',
    formula:'stageCode = S0~S4 (daysSinceInstall×totalSessions×recency)\nband = M0~M4 (maturitySkillScore阈值映射)\nconfig = LIFECYCLE_STRESS_CAP_MAP[stage·band]\nif stress>cap: stress=cap (lifecycleCapAdjust=cap-stress)\nstress += config.adjust (lifecycleBandAdjust)\nS3·M4: cap=0.88 adj=+0.12 (最高)  S0·M0: cap=0.50 adj=-0.15 (最低)',
    range:'cap[0.50~0.88]  adj[-0.15~+0.12]',
    source:'lifecycleStressCapMap.js :: getLifecycleStressCap() (v1.50抽取)',
    consumers:['stress (硬上限+偏移)','stressBreakdown.lifecycleStage/Band/CapAdjust'] },
  { id:'onboardingOverride', name:'onboardingStressOverride', layer:2, cat:'Stress分量·后置调制', sign:'-',
    semantic:'新手保护硬覆写：isInOnboarding=true 时强制 stress≤-0.15',
    formula:'isInOnboarding(lifetimePlacements<20 && sessionHistory.length<3):\n  stress=min(stress, firstSessionStressOverride=-0.15)',
    range:'stress 被截至 ≤ -0.15',
    source:'adaptiveSpawn.js :: isInOnboarding override (v1.13)',
    consumers:['stress 硬覆写','bottleneckRelief强制零'] },
  { id:'winbackStressCap', name:'winbackStressCapAdjust', layer:2, cat:'Stress分量·后置调制', sign:'-',
    semantic:'回流保护：daysSinceLastActive≥7 的玩家前 3 局 stress 额外 cap=0.60',
    formula:'winbackPreset=getActiveWinbackPreset()\nif winbackPreset.stressCap: stress=min(stress, 0.60)',
    range:'stress 截至 ≤ 0.60 (若 S4 cap>0.60 则生效)',
    source:'adaptiveSpawn.js :: winbackPreset (v1.48)',
    consumers:['stress cap叠加','clearGuarantee+1','sizePreference偏负'] },
  { id:'pbChasePressure', name:'pbChasePressureActive', layer:2, cat:'Stress分量·后置调制', sign:'+',
    semantic:'PB 追击压力激活（v1.61）：score 接近/超越 PB 时加压意图高于普通救济',
    formula:'isBClassChallenge(score≥best×0.80且bypass均通过)\n&& !forceReliefIntent\n&& fill<0.72\n&& !isInOnboarding',
    range:'boolean',
    source:'adaptiveSpawn.js :: pbChasePressureActive (v1.61)',
    consumers:["deriveSpawnIntent → 'pressure' (priority=102)","intentResolver pb_chase_pressure rule"] },
  { id:'challengeBoost', name:'challengeBoost', layer:2, cat:'Stress分量·后置调制', sign:'+',
    semantic:'B 类高分挑战：score 接近 PB 时 stress 数值增量',
    formula:'isBClassChallenge:\n  boost=min(baseCap=0.18, (score/best-0.80)×0.75)\n  若friendlyBoardRelief<-0.09: boost×=0.42 (互抑)\n  stress=min(0.85, stress+boost)\npbGrowthFast=true: baseCap+capDelta(0.03)',
    range:'[0, +0.18]',
    source:'adaptiveSpawn.js :: challengeBoost (v1.29+v1.56)',
    consumers:['stress Σ+','pressure intent guard','challengeBoostBypass记录'] },
  { id:'pbOvershootBoost', name:'pbOvershootBoost', layer:2, cat:'Stress分量·后置调制', sign:'+',
    semantic:'超 PB 持续加压（D4 段）：score 已超过 PB 后对数放大加压',
    formula:'score>bestScore 且 非release/recovery/bottleneck/warmup:\n  overshoot=(score-best)/best\n  boost=maxBoost×log10(1+slope×overshoot)/log10(1+slope)\n  stress=min(capStress=0.90, stress+boost)',
    range:'[0, ~0.16]',
    source:'adaptiveSpawn.js :: pbOvershootBoost (v1.56 §5.α.8)',
    consumers:['stress Σ+','occupancyDamping bypass'] },
  { id:'pbExtremeOrder', name:'pbExtremeOrderBoost', layer:2, cat:'Stress分量·后置调制', sign:'+',
    semantic:'D3 决战段顺序刚性提升：score∈[95%,100%) PB 时增加 orderRigor',
    formula:'isBClassChallenge && pct∈[0.95,1.0)\n&& !release/recovery/bottleneck/warmup\n&& bestScore≥minBestScoreForIntenseFeedback(200):\n  pbExtremeOrderBoost → orderRigor',
    range:'orderRigor加成量',
    source:'adaptiveSpawn.js :: pbExtremeOrderBoost (v1.56)',
    consumers:['orderRigor→L3 orderMaxValidPerms','约束验证刚性'] },
  { id:'postPbStressAdj', name:'postPbReleaseStressAdjust', layer:2, cat:'Stress分量·后置调制', sign:'-',
    semantic:'破 PB 后释放窗口减压：破纪录后 3 局内给玩家喘息',
    formula:'postPbReleaseActive=true:\n  stress += postPbReleaseStressAdjust(-0.07 default)',
    range:'[-0.07, 0]',
    source:'adaptiveSpawn.js :: postPbReleaseStressAdjust',
    consumers:['stress'] },
  { id:'occupancyDamp', name:'occupancyDamping', layer:2, cat:'Stress分量·后置调制', sign:'-',
    semantic:'占用率衰减：高填充时压制 stress 防止死局（D4 段豁免避免消解 pbOvershootBoost）',
    formula:'fill 超过阈值时 damped=stress×(1-dampRate)\noccupancyDamping = damped-stress\nD4豁免: pbOvershootActive=true 时跳过',
    range:'[-0.15, 0]',
    source:'adaptiveSpawn.js :: occupancyDamping (v1.16+v1.56)',
    consumers:['stress'] },
  { id:'playerDistress', name:'playerDistress (精确7项聚合)', layer:2, cat:'Stress分量·后置调制', sign:'-',
    semantic:'玩家总痛苦度：精确7个减压分量的代数和（注意：friendlyBoardRelief 和 abilityRiskAdjust 不在内）',
    formula:'playerDistress =\n  recoveryAdjust           // needsRecovery → -0.20\n+ frustrationRelief        // frust≥4 → -0.18\n+ nearMissAdjust           // hadRecentNearMiss → -0.10\n+ holeReliefAdjust         // holePressure×-0.16\n+ boardRiskReliefAdjust    // boardRisk×-0.10\n+ bottleneckRelief         // trough≤2 → max -0.12\n+ endSessionDistress       // late+momentum↓ → max -0.25\n───────── (共7项，不含 friendlyBoardRelief/abilityRiskAdjust)\n若 playerDistress < -0.10 → spawnIntent="relief" (priority=100)',
    range:'[-1, 0]  < -0.10 触发 relief intent',
    source:'adaptiveSpawn.js :: playerDistress (line 2279–2287)',
    note:'⚠ friendlyBoardRelief 和 abilityRiskAdjust 只进 stress Σ，不在此聚合中',
    consumers:["deriveSpawnIntent relief guard (playerDistress < -0.10)","stressBreakdown.playerDistress"] },
  { id:'normalizedStress', name:'normalizedStress (对外展示)', layer:2, cat:'Stress分量·后置调制', sign:'?',
    semantic:'外部展示的 stress 值：将内部 [-0.2, 1.0] 映射到 [0, 1]，DFV 面板和 playerInsightPanel 显示此值',
    formula:'normalizedStress = clamp01((finalStress + STRESS_NORM_OFFSET) / STRESS_NORM_SCALE)\nSTRESS_NORM_OFFSET = 0.2\nSTRESS_NORM_SCALE = 1.2\n例: finalStress=-0.20 → 0.00  finalStress=0 → 0.167  finalStress=1.0 → 1.00',
    range:'[0, 1]',
    source:'adaptiveSpawn.js :: normalizeStress() (line 99-104)',
    consumers:['DFV stressBar','playerInsightPanel stress显示','_lastAdaptiveInsight._adaptiveStress'] },

  // Intent Rules (priority-sorted)
  { id:'i_pbchase', name:'pb_chase_pressure', layer:2, cat:'出块意图(IntentRules)', priority:102,
    semantic:'PB 追击加压（v1.61）：接近/超越 PB 时强制 pressure，阻断普通救济',
    formula:'guard: pbChasePressureActive === true\nspawnIntent → "pressure"',
    range:"'pressure'", source:'intentResolver.js',
    consumers:['spawnIntent=pressure','_tryInjectSpecial pressureSignal (制造空洞)'] },
  { id:'i_relief', name:'relief', layer:2, cat:'出块意图(IntentRules)', priority:100,
    semantic:'挫败救济：玩家总痛苦度超阈值，出减压块（清屏/消行/完美卡入/同花顺）',
    formula:"guard: playerDistress<-0.10 || delightMode='relief' || forceReliefIntent",
    range:"'relief'", source:'intentResolver.js',
    consumers:['spawnIntent=relief','_tryInjectSpecial isReliefPhase (清屏/exactFit/monoFlush/multiClear)'] },
  { id:'i_delight', name:'delight_starved', layer:2, cat:'出块意图(IntentRules)', priority:95,
    semantic:'爽感饥渴：连续 N 轮无 multiClear/pcClear/monoFlush → 强制出爽感块',
    formula:'guard: profile.isDelightStarved()\n  Android/Wechat: N=5轮  iOS/Web: N=7轮',
    range:"'relief'", source:'intentResolver.js',
    consumers:['spawnIntent=relief (delight路径)'] },
  { id:'i_engage', name:'engage', layer:2, cat:'出块意图(IntentRules)', priority:90,
    semantic:'AFK 召回：玩家长时间无操作但状态尚可时，投放视觉刺激块',
    formula:'guard: afkEngageActive === true\nafkEngageActive: 操作间隔 > afkThreshold 且 flowState=bored',
    range:"'engage'", source:'intentResolver.js',
    consumers:['spawnHints.engageBoost'] },
  { id:'i_harvest', name:'harvest', layer:2, cat:'出块意图(IntentRules)', priority:80,
    semantic:'收割机会：盘面有现成消行/清屏机会，优先投放配合块',
    formula:'guard: nearFullLines≥2 || (pcSetup≥1 && boardFill≥0.45)',
    range:"'harvest'", source:'intentResolver.js',
    consumers:['clearGuarantee++','multiClearBonus↑'] },
  { id:'i_pressure', name:'pressure', layer:2, cat:'出块意图(IntentRules)', priority:70,
    semantic:'B 类挑战（低优先级）：challengeBoost>0 时加大难度（被 pb_chase_pressure 覆盖）',
    formula:"guard: challengeBoost>0 || (delightMode='challenge_payoff' && stress≥0.55)",
    range:"'pressure'", source:'intentResolver.js',
    consumers:['_tryInjectSpecial pressureSignal'] },
  { id:'i_sprint', name:'sprint', layer:2, cat:'出块意图(IntentRules)', priority:60,
    semantic:'渐紧过渡带：stress ∈ [0.45, 0.55) 中间态，缓步提高难度',
    formula:'guard: sprintEnabled && stress∈[sprintMin=0.45, sprintMax=0.55)',
    range:"'sprint'", source:'intentResolver.js',
    consumers:['sizePreference+0.10','multiClearBonus floor=0.40','_tryInjectSpecial pressureSignal'] },
  { id:'i_flow', name:'flow', layer:2, cat:'出块意图(IntentRules)', priority:50,
    semantic:'心流释放：流动奖励窗口（delightMode=flow_payoff 或 rhythmPhase=payoff）',
    formula:"guard: delightMode='flow_payoff' || rhythmPhase='payoff'",
    range:"'flow'", source:'intentResolver.js',
    consumers:['flowPayoffCap(stress上限)','delightTuning 爽感释放'] },
  { id:'i_maintain', name:'maintain', layer:2, cat:'出块意图(IntentRules)', priority:0,
    semantic:'中性维持：所有规则未触发时的默认状态',
    formula:'guard: () => true  // fallback',
    range:"'maintain'", source:'intentResolver.js',
    consumers:['shapeWeights 中性档'] },

  // SpawnHints
  { id:'clearGuarantee', name:'clearGuarantee', layer:2, cat:'SpawnHints', sign:'?',
    semantic:'消行槽位保证数：Stage1 至少为 N 个槽位选消行候选',
    formula:'base = max(0, floor(stress×3-1))\nharvest/relief: +1  pressure: -1  monoFlushRound: -1 (让位monoFlush)\nwinback: +1  scoreMilestone: +1  bottleneckSignal: +1\nclamp [0, 2]',
    range:'[0, 2]',
    source:'adaptiveSpawn.js :: deriveSpawnHints() clearGuarantee',
    consumers:['Stage1 clearSeats 选拔数'] },
  { id:'sizePreference', name:'sizePreference', layer:2, cat:'SpawnHints', sign:'?',
    semantic:'形状大小偏向：负值偏小块 正值偏大块',
    formula:'base = -0.30×(1-stress) + stressAdjust\nrelief: -0.4  sprint: +0.10  pressure: +0.30\nwinback: 负向调整  bottleneckSignal: 偏小',
    range:'[-1, +1]',
    source:'adaptiveSpawn.js :: sizePreference',
    consumers:['M5/M6/M7 sizeWeight 乘子(Stage2)'] },
  { id:'multiClearBonus', name:'multiClearBonus', layer:2, cat:'SpawnHints', sign:'?',
    semantic:'多消鼓励系数：多消候选块在 Stage2 的权重倍增',
    formula:'base = 0.30×(1+stress)\n+ comboBoost(comboChain) + clearStreakBoost\n+ delight.multiClearBoost\nAndroid/Wechat 平台下限 0.15',
    range:'[0, 1.0+]',
    source:'adaptiveSpawn.js :: deriveMultiClearBonus()',
    consumers:['M8 multiClear 乘子(Stage2)'] },
  { id:'rhythmPhase', name:'rhythmPhase', layer:2, cat:'SpawnHints', sign:'?',
    semantic:'节奏相位：build(搭建期)/payoff(收割期)/neutral(中性)',
    formula:"deriveRhythmPhase(profile, ctx, fill):\n  nearFull≥2 && clearRate>0.15 → 'payoff'\n  fill<0.30 → 'build'\n  otherwise → 'neutral'",
    range:"'build'|'payoff'|'neutral'",
    source:'adaptiveSpawn.js :: deriveRhythmPhase()',
    consumers:['flow intent guard','M17 rhythmPhase 乘子','pacingAdjust参考'] },
  { id:'sessionArc', name:'sessionArc', layer:2, cat:'SpawnHints', sign:'?',
    semantic:'会话弧线阶段：warmup/peak/cooldown，影响形状复杂度曲线',
    formula:"deriveSessionArc(totalRounds, sessionPhase):\n  totalRounds<5 → 'warmup'\n  sessionPhase='late' → 'cooldown'\n  otherwise → 'peak'",
    range:"'warmup'|'peak'|'cooldown'",
    source:'adaptiveSpawn.js :: deriveSessionArc()',
    consumers:['sessionArcAdjust','M18 sessionArc 乘子'] },
  { id:'orderRigor', name:'orderRigor', layer:2, cat:'SpawnHints', sign:'+',
    semantic:'顺序刚性：stress 越高要求玩家越精确地按顺序放置三块',
    formula:'0.35 + 0.65×stress²\n+ pbExtremeOrderBoost (D3 段额外)\n+ pbOvershootOrderBoost (D4 段额外)\norderMaxValidPerms = max(1, round((1-orderRigor)×8))',
    range:'[0.35, 1.0+]  orderMaxValidPerms[1,8]',
    source:'adaptiveSpawn.js :: orderRigor (v1.56)',
    consumers:['L3 硬约束: 顺序可解性验证'] },
];

// ── L3: Pipeline ──────────────────────────────────────────────────────────────
const L3: Signal[] = [
  { id:'l3_score', name:'Stage 0: 形状评分 (scored[])', layer:3, cat:'形状评分',
    semantic:'对全量形状池评 9 维分，生成 scored[] 供后续选拔',
    formula:'gapFills:     减少封闭空洞数\nmultiClear:   消行数 (≥1)\nexactFit:     几何 100% 嵌入 (0 or 1)\npcPotential:  清屏潜力 (0/1/2)\nmonoFlush:    同花顺线数\nholeReduce:   空洞减少量\nsolutionSpace: 解法空间密度\nplacements:   可落位数\ncategory:     形状品类 (S/M/L)',
    range:'scored[] 数组',
    source:'blockSpawn.js :: scoreShape()',
    consumers:['clearCandidates','Stage1/Stage2 权重','_tryInjectSpecial scored参数'] },
  { id:'l3_aScore', name:'Stage 1a: aScore 排序', layer:3, cat:'形状选拔',
    semantic:'14 维综合得分，用于 clearCandidates 降序排列，决定谁优先进 clearSeats',
    formula:'pcPotential×20 + monoFlush×12 + multiClear×8\n+ exactFit×4 + gapFills×1.5\n+ holeReduce×1 + solutionSpace×0.5\n+ placements×0.2 + ...\n单 monoFlush 预算守卫: 全局≤1 个 monoFlush 块',
    range:'aScore ∈ [0, ∞)',
    source:'blockSpawn.js :: generateDockShapes() Stage1 clearCandidates sort',
    consumers:['clearCandidates 降序','clearSeats 选拔'] },
  { id:'l3_seats', name:'Stage 1b: clearSeats 优先选拔', layer:3, cat:'形状选拔',
    semantic:'按 clearGuarantee 保证消行槽位，4 级优先级链',
    formula:'clearSeats = min(clearGuarantee, 2)\n优先级链:\n  1. monoFlushBudget>0 → monoFlush 块\n  2. pcPotential≥1 → 清屏候选\n  3. multiClear≥1 → 多消候选\n  4. 其他 clearCandidates',
    range:'选拔 0–2 个块进 chosen[]',
    source:'blockSpawn.js :: Stage1 clearSeats',
    consumers:['chosen[] 前 N 个','Stage2 补齐剩余'] },
  { id:'l3_weighted', name:'Stage 2: 33 维加权补齐', layer:3, cat:'形状选拔',
    semantic:'33 个权重乘子对候选池加权，随机抽样补齐到 3 块',
    formula:'M1:  minMobility (机动性基准)\nM2:  pcPotential 清屏\nM3:  multiClear 多消\nM4:  monoFlush 同花顺\nM5-M7: sizePreference 大小偏向 (S/M/L类)\nM8:  multiClearBonus 多消系数\nM9-M12: 规划/空洞/精确卡入/消行\nM13-M16: blockCategory/novelty/diversity\nM17-M22: 节奏/弧线/Combo/连消/近满\nM23-M28: PB 追击 / 里程碑 / 破纪录\nM29-M33: 个性化 / 可达性',
    range:'加权随机抽样',
    source:'blockSpawn.js :: generateDockShapes() Stage2 weighted pool',
    consumers:['chosen[] 补齐','硬约束验证'] },
  { id:'l3_fallback', name:'Stage 3: 兜底 (fallback)', layer:3, cat:'形状选拔',
    semantic:'Stage2 失败（候选池为空）时退化为规则形状池随机选',
    formula:'getRegularShapes() 过滤后随机选\n不含特殊形状（L2级注入才能出特殊块）',
    range:'3 块',
    source:'blockSpawn.js :: fallback path',
    consumers:['chosen[] 兜底'] },
  { id:'l3_constraint', name:'Stage 4: 17 项硬约束验证', layer:3, cat:'约束验证',
    semantic:'验证 3 块组合的合法性，失败则重抽 Stage2（最多 22 次重试）',
    formula:'① minMobility: 每块≥5 个合法落点\n② 顺序可解性: 任意排列中≥1个有效顺序\n③ 解法数量≤orderMaxValidPerms (stress越高越严)\n④ 空洞增量≤maxHoleAdd\n⑤-⑬ 9 维目标区间检查 (fill/clear/holes/...)\n⑭ farFromPB 段不允许纯加压组合\n⑮ 品类多样性 (不连续3块同品类)\n⑯ size多样性 (不连续3块同size)\n⑰ orderRigor: 顺序约束刚性验证',
    range:'通过→输出  失败→重抽 Stage2\n最多 22 次重试',
    source:'blockSpawn.js :: validateGroupConstraints()',
    consumers:['最终 chosen[]','diagnostics.constraintRetries'] },
  { id:'l3_inject', name:'Stage 5: 特殊注入 (_tryInjectSpecial)', layer:3, cat:'约束验证',
    semantic:'按意图替换一块弱候选为特殊形状；每轮最多注入 1 块',
    formula:'门槛: roundsSinceSpecial≥5 && totalRounds>5\nrelief 阶段 (isReliefPhase):\n  pcSetup≥1 → 清屏救援块  [最强]\n  exactFit → 完美卡入块\n  monoFlush (需monoFlushRound) → 同花顺块\n  multiClear (chosenHasMultiClear=false) → 消行块 [低优]\npressure 阶段 (isPressureIntent):\n  fill<0.45 && holes<4 → 制造空洞块\nroundsSinceSpecial → 0  (命中后归零)',
    range:'替换 0–1 块',
    source:'blockSpawn.js :: _tryInjectSpecial() (v1.60.44重构)',
    consumers:['chosen[replaced]','reliefTrigger / pressureSignal diagnostics'] },
  { id:'l3_output', name:'Stage 6: 最终输出', layer:3, cat:'输出',
    semantic:'Fisher-Yates 洗牌 + chosenMeta 诊断快照，写入 game.dockBlocks',
    formula:'Fisher-Yates shuffle(chosen)\nchosenMeta: [{id,source,reason,monoFlush,pcPotential,aScore,...}]\ndiagnostics: {constraintRetries,injected,reliefTrigger,pressureSignal,...}\n写 offlineStateCache 快照',
    range:'3 块有序候选',
    source:'blockSpawn.js :: generateDockShapes() 输出段',
    consumers:['game.dockBlocks','DFV 出块标注','offlineStateCache.writeSpawnSignals'] },
];

const ALL_SIGNALS: Signal[] = [...L1, ...L2, ...L3];

// ─── Category colors ─────────────────────────────────────────────────────────
const CAT_COLOR: Record<string, string> = {
  '盘面几何':'#4f8ef7','玩家状态':'#e87c3e','跨轮上下文':'#9b7ae8','局间历史':'#48b06b',
  '能力向量(AbilityVector)':'#e85c7a',
  'Stress分量·基础':'#b07a38','Stress分量·后置调制':'#c07a20',
  '出块意图(IntentRules)':'#38a8b0','SpawnHints':'#7ab038',
  '形状评分':'#9060c8','形状选拔':'#e85c9b','约束验证':'#c07a38','输出':'#607070',
};

const LAYER_COLOR: Record<Layer, string> = { 1:'#4f8ef7', 2:'#c07a38', 3:'#48b06b' };

function LayerBadge({ layer }: { layer: Layer }) {
  return (
    <span style={{ fontSize:10, fontWeight:700, padding:'2px 7px', borderRadius:3,
      color:'#fff', background: LAYER_COLOR[layer] }}>L{layer}</span>
  );
}

function PriBadge({ p }: { p: number }) {
  const c = p>=102?'#e85c7a':p>=100?'#e87c3e':p>=80?'#b07a38':p>=60?'#9b7ae8':'#607070';
  return <span style={{ fontSize:10, fontWeight:700, color:c, padding:'1px 5px',
    border:`1px solid ${c}`, borderRadius:3 }}>P{p}</span>;
}

function SignBadge({ s }: { s: '+'|'-'|'±'|'?' }) {
  const cl = { '+':'#48b06b', '-':'#e85c7a', '±':'#b07a38', '?':'#607070' }[s];
  return <span style={{ fontSize:9, fontWeight:700, color:cl, minWidth:12,textAlign:'center' }}>{s}</span>;
}

function SignalCard({ sig, sel, onClick }: { sig:Signal; sel:boolean; onClick:()=>void }) {
  const theme = useHostTheme();
  const cc = CAT_COLOR[sig.cat] ?? '#607070';
  return (
    <div onClick={onClick} style={{ cursor:'pointer', padding:'8px 10px', borderRadius:5,
      border:`1px solid ${sel?theme.accent.primary:theme.stroke.secondary}`,
      background: sel?theme.fill.secondary:theme.bg.elevated }}>
      <Row gap={5} align="center">
        <LayerBadge layer={sig.layer}/>
        <div style={{ width:7,height:7,borderRadius:'50%',background:cc,flexShrink:0 }}/>
        <Text size="small" style={{ fontWeight:600,fontFamily:'monospace',flex:1,overflow:'hidden',
          textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{sig.name}</Text>
        {sig.priority!==undefined && <PriBadge p={sig.priority}/>}
        {sig.sign && <SignBadge s={sig.sign}/>}
      </Row>
      <Text size="small" tone="secondary" style={{ marginTop:3,lineHeight:1.4 }}>
        {sig.semantic.slice(0,72)}{sig.semantic.length>72?'…':''}
      </Text>
    </div>
  );
}

function Detail({ sig }: { sig: Signal|null }) {
  const theme = useHostTheme();
  if (!sig) return (
    <div style={{ padding:32,textAlign:'center' }}>
      <Text tone="tertiary" size="small">选择信号查看详情</Text>
    </div>
  );
  const cc = CAT_COLOR[sig.cat] ?? '#607070';
  return (
    <Stack gap={12}>
      <Row gap={8} align="center">
        <LayerBadge layer={sig.layer}/>
        <div style={{ width:9,height:9,borderRadius:'50%',background:cc }}/>
        <Text size="small" tone="tertiary" style={{ flex:1 }}>{sig.cat}</Text>
        {sig.priority!==undefined && <PriBadge p={sig.priority}/>}
        {sig.sign && <><Text size="small" tone="tertiary">stress 方向：</Text><SignBadge s={sig.sign}/></>}
      </Row>
      <H3>{sig.name}</H3>
      <Divider/>
      <Stack gap={5}>
        <Text size="small" style={{ fontWeight:600,color:theme.accent.primary }}>语义含义</Text>
        <Text size="small" style={{ lineHeight:1.6 }}>{sig.semantic}</Text>
      </Stack>
      <Stack gap={5}>
        <Text size="small" style={{ fontWeight:600,color:theme.accent.primary }}>计算口径（代码事实）</Text>
        <Code style={{ fontSize:11,whiteSpace:'pre-wrap',lineHeight:1.6 }}>{sig.formula}</Code>
      </Stack>
      <Stack gap={5}>
        <Text size="small" style={{ fontWeight:600,color:theme.accent.primary }}>取值范围</Text>
        <Code style={{ fontSize:11 }}>{sig.range}</Code>
      </Stack>
      <Stack gap={5}>
        <Text size="small" style={{ fontWeight:600,color:theme.accent.primary }}>代码来源</Text>
        <Code style={{ fontSize:11 }}>{sig.source}</Code>
      </Stack>
      <Stack gap={5}>
        <Text size="small" style={{ fontWeight:600,color:theme.accent.primary }}>
          下游消费方 ({sig.consumers.length})
        </Text>
        {sig.consumers.map((c,i)=>(
          <Row key={i} gap={6} align="center">
            <div style={{ width:4,height:4,borderRadius:'50%',background:cc,flexShrink:0 }}/>
            <Code style={{ fontSize:10 }}>{c}</Code>
          </Row>
        ))}
      </Stack>
      {sig.note && (
        <Stack gap={5}>
          <Text size="small" style={{ fontWeight:600,color:'#b07a38' }}>注意</Text>
          <Text size="small" tone="secondary">{sig.note}</Text>
        </Stack>
      )}
    </Stack>
  );
}

function IntentTab() {
  const intents = ALL_SIGNALS.filter(s=>s.cat==='出块意图(IntentRules)')
    .sort((a,b)=>(b.priority??0)-(a.priority??0));
  return (
    <Stack gap={14}>
      <Row gap={12} align="center">
        <Stack gap={2}>
          <Text style={{ fontWeight:600 }}>Intent 优先级矩阵</Text>
          <Text size="small" tone="secondary">
            9 条规则按 priority 降序执行，高优先级 guard 通过则覆盖所有低优先级规则。
            forceReliefIntent(临终/高挫败)=true 时优先于 pb_chase_pressure。
          </Text>
        </Stack>
      </Row>
      <Table
        stickyHeader striped
        headers={['P','规则 ID','spawnIntent','guard 触发条件（代码口径）','设计语义']}
        rows={intents.map(s=>[
          <PriBadge key={s.id} p={s.priority!}/>,
          <Code key={s.id} style={{ fontSize:11 }}>{s.name}</Code>,
          <Code key={s.id} style={{ fontSize:10 }}>{s.range}</Code>,
          <Text key={s.id} size="small" style={{ fontFamily:'monospace',whiteSpace:'pre-wrap',lineHeight:1.5,fontSize:10 }}>{s.formula}</Text>,
          <Text key={s.id} size="small" style={{ lineHeight:1.5 }}>{s.semantic}</Text>,
        ])}
        rowTone={intents.map(s=>s.name==='pb_chase_pressure'?'danger':s.name==='relief'?'warning':s.name==='harvest'?'info':undefined)}
        columnAlign={['center','left','left','left','left']}
      />
      <Text tone="tertiary" size="small">红=pb_chase_pressure(v1.61新增) · 橙=relief · 蓝=harvest · playerDistress=Σ(减压分量)</Text>
    </Stack>
  );
}

function StressTab() {
  const theme = useHostTheme();
  const base = ALL_SIGNALS.filter(s=>s.cat==='Stress分量·基础');
  const post = ALL_SIGNALS.filter(s=>s.cat==='Stress分量·后置调制');
  return (
    <Stack gap={16}>
      <Text tone="secondary" size="small">
        stress = Σ(基础分量) → rawStress → 后置调制 → finalStress [−0.2, 1.0] →
        interpolateProfileWeights(stress) → shapeWeights (10档难度) → spawnHints → L3 管道
      </Text>
      <H3>基础分量（直接 Σ 进 rawStress）</H3>
      <Table striped stickyHeader
        headers={['信号','符号','范围','触发条件']}
        rows={base.map(s=>[
          <Code key={s.id} style={{ fontSize:10 }}>{s.name}</Code>,
          <SignBadge key={s.id} s={s.sign??'?'}/>,
          <Code key={s.id} style={{ fontSize:10 }}>{s.range}</Code>,
          <Text key={s.id} size="small" style={{ lineHeight:1.5 }}>{s.semantic.slice(0,60)}…</Text>,
        ])}
        rowTone={base.map(s=>s.sign==='-'?'info':s.sign==='+'?undefined:undefined)}
        columnAlign={['left','center','left','left']}
      />
      <Divider/>
      <H3>后置调制（rawStress → finalStress，不进 Σ）</H3>
      <Table striped stickyHeader
        headers={['信号','作用','范围']}
        rows={post.map(s=>[
          <Code key={s.id} style={{ fontSize:10 }}>{s.name}</Code>,
          <Text key={s.id} size="small" style={{ lineHeight:1.5 }}>{s.semantic.slice(0,80)}…</Text>,
          <Code key={s.id} style={{ fontSize:10 }}>{s.range}</Code>,
        ])}
        columnAlign={['left','left','left']}
      />
      <Text tone="tertiary" size="small">
        stress 计算顺序：基础Σ(S1-S24) → rawStress → lifecycleCap/adj → onboardingOverride →
        winbackCap → challengeBoost → pbOvershootBoost → clamp[-0.2,1] →
        occupancyDamping → smoothing → minStressFloor → flowPayoffCap → finalStress
        → normalizeStress((s+0.2)/1.2) → [0,1] 对外展示
      </Text>
      <Text tone="tertiary" size="small">
        playerDistress(7项) = recoveryAdj + frustRelief + nearMissAdj + holeRelief +
        boardRiskRelief + bottleneckRelief + endSessionDistress（不含 friendlyBoardRelief / abilityRiskAdj）
      </Text>
    </Stack>
  );
}

function FlowTab() {
  return (
    <Stack gap={16}>
      <Text tone="secondary" size="small">
        L1(原始信号) → L2(派生信号) → L3(选拔管道) 三层依赖链路
      </Text>
      <Table striped stickyHeader
        headers={['L1 原始信号（代码来源）','计算转换','L2 派生信号','下游 L3 影响']}
        rows={[
          ['fill (grid.getFillRatio())','scoreStress S形映射','scoreStress','stress Σ → shapeWeights档位 → Stage2 M1-M4'],
          ['score + bestScore','pct=score/best → S形','scoreStress + challengeBoost','stress Σ → pbChasePressureActive → spawnIntent=pressure'],
          ['skillLevel (EMA) + confidence','blend→skillScore → (s-0.5)×0.30×confGate','skillAdjust','stress Σ → difficulty'],
          ['flowState + flowDeviation','flowBored=+0.08×(1+dev) flowAnxious=-0.12×(1+dev)','flowAdjust (注: bored=正值加压)','stress Σ'],
          ['frustrationLevel + needsRecovery','≥threshold → -0.18 needsRecovery → -0.20','frustRelief + recoveryAdjust','playerDistress Σ → relief intent → _tryInjectSpecial isReliefPhase'],
          ['bottleneckTrough + samples','sev=(threshold-trough)/threshold → relief×(0.4+0.6×sev)','bottleneckRelief (-0.12)','playerDistress → hasBottleneckSignal → challengeBoostBypass'],
          ['hadRecentNearMiss','→ -0.10','nearMissAdjust','playerDistress → reactionAdjust让位'],
          ['holes + fill','holePressure=holes/8 → ×-0.16','holeReliefAdjust','playerDistress Σ → stage判定'],
          ['daysSinceInstall + totalSessions (AND)','LIFECYCLE_THRESHOLDS → stageCode S0~S4','lifecycleStage','LIFECYCLE_STRESS_CAP_MAP → cap/adjust → stress后置调制'],
          ['maturitySkillScore (跨局7维EMA)','阈值分段 M0~M4','maturity band','LIFECYCLE_STRESS_CAP_MAP[S·M] → stress cap(0.50~0.88)/adj(-0.15~+0.12)'],
          ['daysSinceLastActive','≥7天 → isWinbackCandidate=true','S4 stageCode','winbackPreset cap=0.60 + clearGuarantee+1 + sizePreference偏负'],
          ['pcSetup + nearFullLines','pcSetup≥1&&fill≥0.45||nearFull≥2 → harvestable','harvest intent guard','clearGuarantee++ → Stage1 clearSeats多一个槽'],
          ['roundsSinceSpecial + monoFlushRound','≥5且抽签命中','monoFlushSignal','_tryInjectSpecial monoFlush注入门'],
          ['pickToPlaceMs (EMA)','<350ms→+0.05  >4500ms→-0.05','reactionAdjust (弱信号)','stress Σ (bored快反应→加压 anxious慢→减压)'],
          ['comboChain + recentComboStreak','≥2→+0.05','comboAdjust','stress Σ + multiClearBonus加成'],
        ]}
        columnAlign={['left','left','left','left']}
      />
    </Stack>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export default function SpawnSignalExplorer() {
  const theme = useHostTheme();
  const [tab, setTab] = useCanvasState<'explorer'|'intent'|'stress'|'flow'>('tab2','explorer');
  const [selId, setSelId] = useCanvasState<string|null>('sel2', null);
  const [fLayer, setFLayer] = useCanvasState<Layer|0>('fl2', 0);
  const [fCat, setFCat] = useCanvasState<string>('fc2', '');
  const [search, setSearch] = useCanvasState<string>('q2', '');

  const sel = selId ? ALL_SIGNALS.find(s=>s.id===selId)??null : null;
  const cats = [...new Set(ALL_SIGNALS.map(s=>s.cat))];

  const filtered = ALL_SIGNALS.filter(s=>{
    if (fLayer!==0 && s.layer!==fLayer) return false;
    if (fCat && s.cat!==fCat) return false;
    if (search) {
      const q=search.toLowerCase();
      return s.name.toLowerCase().includes(q)||s.semantic.toLowerCase().includes(q)||s.cat.toLowerCase().includes(q)||s.formula.toLowerCase().includes(q);
    }
    return true;
  });

  const counts = { l1:L1.length, l2:L2.length, l3:L3.length };

  return (
    <Stack gap={0} style={{ minHeight:'100vh', background:theme.bg.editor }}>
      {/* Header */}
      <div style={{ padding:'14px 20px', borderBottom:`1px solid ${theme.stroke.secondary}` }}>
        <Row gap={14} align="center">
          <Stack gap={2} style={{ flex:1 }}>
            <H1>出块算法信号分析工具（代码核查版）</H1>
            <Text tone="tertiary" size="small">
              以 adaptiveSpawn.js / blockSpawn.js / playerAbilityModel.js 为事实依据 · 完整还原采集口径与计算逻辑
            </Text>
          </Stack>
          <Grid columns={3} gap={8}>
            <Stat value={String(counts.l1)} label="L1 原始信号"/>
            <Stat value={String(counts.l2)} label="L2 派生信号"/>
            <Stat value={String(counts.l3)} label="L3 管道阶段"/>
          </Grid>
        </Row>
        <Row gap={8} style={{ marginTop:10 }}>
          {[{k:'explorer',l:'信号浏览器'},{k:'intent',l:'Intent 优先级矩阵'},{k:'stress',l:'Stress 分量全表'},{k:'flow',l:'完整链路图'}].map(t=>(
            <Button key={t.k} variant={tab===t.k?'primary':'ghost'} onClick={()=>setTab(t.k as any)}>{t.l}</Button>
          ))}
        </Row>
      </div>

      {/* Tabs */}
      {tab==='intent' && <div style={{ padding:20 }}><IntentTab/></div>}
      {tab==='stress' && <div style={{ padding:20 }}><StressTab/></div>}
      {tab==='flow' && <div style={{ padding:20 }}><FlowTab/></div>}

      {tab==='explorer' && (
        <div style={{ display:'flex',flex:1,overflow:'hidden' }}>
          {/* Sidebar */}
          <div style={{ width:165,flexShrink:0,padding:'10px 8px',
            borderRight:`1px solid ${theme.stroke.secondary}`,overflowY:'auto' }}>
            <Stack gap={8}>
              <Text size="small" style={{ fontWeight:600 }}>层次</Text>
              {([['全部',0],['L1 原始',1],['L2 派生',2],['L3 管道',3]] as const).map(([label,l])=>(
                <Button key={l} variant={fLayer===l?'primary':'ghost'}
                  onClick={()=>{setFLayer(l as any);setSelId(null);}}
                  style={{ justifyContent:'flex-start',fontSize:11 }}>
                  {label}
                </Button>
              ))}
              <Divider/>
              <Text size="small" style={{ fontWeight:600 }}>分类</Text>
              <Button variant={fCat===''?'primary':'ghost'}
                onClick={()=>{setFCat('');setSelId(null);}}
                style={{ justifyContent:'flex-start',fontSize:11 }}>全部</Button>
              {cats.map(cat=>{
                const cc=CAT_COLOR[cat]??'#607070';
                return (
                  <Button key={cat} variant={fCat===cat?'primary':'ghost'}
                    onClick={()=>{setFCat(cat);setSelId(null);}}
                    style={{ justifyContent:'flex-start',fontSize:11 }}>
                    <Row gap={5} align="center">
                      <div style={{ width:7,height:7,borderRadius:'50%',background:cc }}/>
                      <span style={{ overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap' }}>{cat}</span>
                    </Row>
                  </Button>
                );
              })}
            </Stack>
          </div>

          {/* Signal list */}
          <div style={{ flex:1,padding:'10px 12px',overflowY:'auto' }}>
            <Stack gap={8}>
              <Row gap={8} align="center">
                <input placeholder="搜索名称 / 语义 / 公式..."
                  value={search} onChange={e=>setSearch((e.target as HTMLInputElement).value)}
                  style={{ flex:1,padding:'5px 10px',fontSize:12,borderRadius:5,
                    border:`1px solid ${theme.stroke.secondary}`,
                    background:theme.bg.elevated,color:theme.text.primary,outline:'none' }}/>
                <Text tone="tertiary" size="small">{filtered.length}</Text>
              </Row>
              {([1,2,3] as Layer[]).map(l=>{
                const sigs=filtered.filter(s=>s.layer===l);
                if (sigs.length===0) return null;
                const label={1:'L1 原始信号',2:'L2 派生信号',3:'L3 输出管道'}[l];
                return (
                  <CollapsibleSection key={l} title={label} count={sigs.length}
                    trailing={<LayerBadge layer={l}/>}>
                    <Stack gap={5} style={{ paddingTop:5 }}>
                      {sigs.map(sig=>(
                        <SignalCard key={sig.id} sig={sig} sel={selId===sig.id}
                          onClick={()=>setSelId(sig.id===selId?null:sig.id)}/>
                      ))}
                    </Stack>
                  </CollapsibleSection>
                );
              })}
            </Stack>
          </div>

          {/* Detail */}
          <div style={{ width:340,flexShrink:0,padding:'12px 14px',
            borderLeft:`1px solid ${theme.stroke.secondary}`,overflowY:'auto',
            background:theme.bg.elevated }}>
            <Detail sig={sel}/>
          </div>
        </div>
      )}
    </Stack>
  );
}
