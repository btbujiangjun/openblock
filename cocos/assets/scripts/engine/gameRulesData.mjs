/* 自动生成 —— 请勿手改。源：shared/game_rules.json
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
export default {
  "schemaVersion": 1,
  "description": "玩法与 RL 观测的单一数据源：改难度/得分/棋盘参数只改本文件；改特征维度需同步实现 observationEncoder 并重训模型。",
  "winScoreThreshold": 220,
  "rlCurriculum": {
    "comment": "胜利门槛课程·三模式（mode 字段控制，互斥）：linear=固定线性 ramp（v8 默认，需手工调 winThresholdEnd）；adaptive=v11 闭环（rlRewardShaping.adaptiveCurriculum 提供四档反馈，仍受 winThresholdEnd 上限制约）；quantile=v11.2 分位数自适应（不设 End，winThreshold=EMA(percentile(recent_scores, p))，模型能力变强 → 阈值自动同步上升，win_rate 数学上恒等于 1-p/100）。环境变量 RL_CURRICULUM_MODE 可覆盖；RL_CURRICULUM=0 总闸关闭。winScoreThreshold（顶层）仍是 220，作为产品端「胜利」标识与浏览器推理时的固定阈值，不与 RL 训练时的课程门槛混用。",
    "enabled": true,
    "mode": "quantile",
    "winThresholdStart": 40,
    "winThresholdEnd": 600,
    "rampEpisodes": 40000,
    "difficultyBucket": {
      "comment": "v12 难度桶课程（与 quantile/adaptive 正交）：训练时按 episode 进度逐步放宽允许的 spawnStepDifficulty 桶；simulator._spawn_dock 自博弈采样若超出当前桶上限则重抽（最多 retryCap 次）。bucketRamp 给出每阶段的 scd 上限（与 spawn_step_difficulty.py DIFFICULTY_BUCKETS 对齐：trivial<0.2/easy<0.4/standard<0.6/hard<0.8/extreme=1）。RL_DIFFICULTY_CURRICULUM=0 关闭。",
      "enabled": true,
      "stages": [
        {
          "untilEpisode": 4000,
          "maxScd": 0.4
        },
        {
          "untilEpisode": 12000,
          "maxScd": 0.6
        },
        {
          "untilEpisode": 30000,
          "maxScd": 0.8
        },
        {
          "untilEpisode": 0,
          "maxScd": 1
        }
      ],
      "retryCap": 6
    },
    "quantile": {
      "comment": "v11.2 分位数模式参数。p=70 → 目标 win_rate=30%（比 v11 的 50% 更保守，保证稳定训练信号）。windowEpisodes=500 平衡响应速度与抖动。emaAlpha=0.05 ≈ 14 局衰减一半，抑制单局极值影响。bootstrap 期（前 100 局）使用 winThresholdStart=40 同值。floor/ceil 是兜底夹紧，正常不会触发。",
      "p": 70,
      "windowEpisodes": 500,
      "emaAlpha": 0.05,
      "bootstrapEpisodes": 100,
      "bootstrapThreshold": 40,
      "floor": 40,
      "ceil": 9999
    }
  },
  "browserRlTraining": {
    "comment": "浏览器 LinearAgent REINFORCE 超参与温度日程（含 PyTorch 在线路径每局采样温度）。仅 web/src/bot/trainer.js 读取；改 JSON 无需改代码常量。entropyCoef=0 退化为纯策略梯度。",
    "gamma": 0.99,
    "maxGradNorm": 5,
    "policyLr": 0.02,
    "valueLr": 0.05,
    "entropyCoef": 0.02,
    "temperatureLocal": {
      "comment": "trainSelfPlay 本地循环：temp = max(min, start - episodeIndex * decayPerEpisode)",
      "start": 1,
      "min": 0.4,
      "decayPerEpisode": 0.0015
    },
    "temperatureBackend": {
      "comment": "useBackend 时按服务端已累计局数 globalEp 衰减。min 从 0.35→0.45：高 ep 后温度长期贴底会让残局（合法落点少）采样过度确定化、整批熵骤降到 ~0.6 又回弹（熵深谷）；抬高下限维持残局探索、软化熵深谷。",
      "start": 1,
      "min": 0.45,
      "decayPerGlobalEpisode": 0.002
    }
  },
  "clearScoring": {
    "comment": "人工主局、浏览器无头模拟器、Python RL 训练/评估共用的消行计分参数。修改这里必须同步验证 clearScoring / simulator 测试。",
    "iconBonusLineMult": 5,
    "perfectClearMult": 10,
    "comboMultiplier": {
      "comment": "连击得分倍数 —— combo 采用「带 grace 窗口的 chain 模型」（粉色爱心 ♥N 提示）：清线启动 combo（_comboCount=1），随后任意 0~gracePlacements-1 步未清线都不打断；当连续 ≥gracePlacements 步未清线时 combo 进入「待断」态，下次清线重置为 1。公式：mult = clamp(1 + max(0, comboCount - activationCount + 1) × stepBonus, 1, maxMultiplier)。当前 grace=3 / activation=3 / step=1 / max=4 → 缓冲 2 步、♥3 ×2 / ♥4 ×3 / ♥5+ ×4（cap），用户在徽章上能真切看到「×N 跟着连消增长」。旧值 max=2 会让 ♥3 起立刻封顶 ×2 而后永远不再变化（视觉与计分均「死掉」），已废弃。grace=1 即退化为「严格连击」（与旧 _clearStreak 同义）。enabled=false 或配置缺失即关闭加成与爱心徽章。activationStreak 是 activationCount 的向后兼容别名。与 perfectClearMult / iconBonusLineMult 串行累乘：clearScore = (baseScore + iconBonusScore) × perfectMult × comboMult。",
      "enabled": true,
      "gracePlacements": 3,
      "activationCount": 3,
      "activationStreak": 3,
      "stepBonus": 1,
      "maxMultiplier": 4
    }
  },
  "rlBonusScoring": {
    "comment": "RL / PyTorch 无头局与主局计分对齐：整线加分判定与 dock 染色软偏置共用同一套「可见规则」（detectBonusLines / monoNearFullLine）。为避免 JS/Python 读取皮肤实现不一致，RL 只读取本节点 blockIcons；为空时按同色判定，不从玩家当前皮肤或 canonical 皮肤回退。",
    "useGameplayBonusRules": true,
    "blockIcons": null
  },
  "defaultStrategyId": "normal",
  "bestScoreSanity": {
    "comment": "v1.55 §4.10 异常分守卫：单局 score > previousBest × multiplier 时进入审核态：仅更新内存 bestScore，不写后端持久化。previousBest < minBase 时跳过守卫（新玩家锚点不足）。",
    "enabled": true,
    "multiplier": 5,
    "minBase": 50
  },
  "dynamicDifficulty": {
    "comment": "网页对局：在玩家所选难度基础上，局内随分数升高将出块分布向「困难」靠拢；计分仍用所选难度的 scoring。v1.13 起 scoreStress 在 ctx.bestScore>0 时按个人百分位映射，避免一次冲过末档后压力锁死。v1.56.6 §5.α.9 P1-C1：percentileMaxOver 从 0.2 → 0.5，让 D4 段（score > best）scoreStress 在 pct ∈ (1.0, 1.5] 仍能继续递增，与 pbOvershootBoost 协同形成'超 PB 越来越难'的完整曲线（旧 0.2 让 pct>1.2 时 stress 早饱和）。",
    "enabled": true,
    "milestones": [
      0,
      45,
      90,
      135,
      180
    ],
    "spawnStress": [
      0,
      0.18,
      0.38,
      0.58,
      0.78
    ],
    "scoreFloor": 180,
    "percentileDecayThreshold": 0.5,
    "percentileDecayFactor": 0.4,
    "percentileMaxOver": 0.5,
    "pbProgress": {
      "comment": "难度进度坐标（effectivePB）—— 主线 S 曲线 r=score/PB 不动，仅用同一条单调连续变换修两端 corner：新手 PB<noviceFloor 时抬到下限（避免几十分就被推入挑战区→早熟挫败）；高手 PB>expertSoftCap 时按 eff=softCap+scale·ln(1+(pb-softCap)/scale) 对数软压缩（缩短前期无聊铺垫，更快进挑战区，越高压得越狠且单调无跳变）。仅作用于出块难度坐标；纪录追逐（derivePbCurve/challengeBoost/破纪录庆祝/overshoot）仍用真实 PB，两坐标解耦。配置移除即退化为旧 max(personalBest, scoreFloor) 行为。",
      "noviceFloor": 240,
      "expertSoftCap": 1200,
      "expertScale": 600
    }
  },
  "runDifficulty": {
    "comment": "连战（菜单「再来一局」链）：v1.68 起支持两种曲线，curve='linear'（旧默认，向后兼容）或 'humped'（驼峰，配合 PR2 RunOverRunArc）。humped 曲线让难度先升后降：第 2-3 局达峰（黄金窗口）、第 5 局后转为 breather（强制喘息），由 Candy Crush/RMH 2025 'retention always wins' 原则驱动。stressBonusByStreak[i] / fillBonusByStreak[i] 索引 i = min(runStreak, length-1)，越界裁剪到末档。回主菜单重置；空闲 resetOnIdleMs 后下一局当冷启动局（仅记日志，不强制重置 runStreak，保留旧行为兼容）。",
    "enabled": true,
    "curve": "humped",
    "maxStreak": 6,
    "fillBonusPerGame": 0.01,
    "spawnStressBonusPerGame": 0.045,
    "stressBonusByStreak": [
      0,
      0.03,
      0.05,
      0.05,
      0.02,
      -0.05,
      -0.1
    ],
    "fillBonusByStreak": [
      0,
      0.01,
      0.02,
      0.02,
      0.01,
      -0.01,
      -0.03
    ],
    "breatherAfter": 5,
    "resetOnIdleMs": 1800000
  },
  "runOverRunArc": {
    "comment": "v1.68 局间难度弧线（Run-over-Run Arc）阈值配置；空字段回落 runOverRunArc.js 的 DEFAULT_ARC_THRESHOLDS。详细派生规则与可视化见 docs/algorithms/RUN_OVER_RUN_DIFFICULTY.md。",
    "enabled": true,
    "openerIdleMs": 1800000,
    "openerMaxDailyIndex": 1,
    "momentumMin": 2,
    "momentumMax": 3,
    "peakMin": 4,
    "peakMax": 5,
    "fatigueMinIndex": 6,
    "fatigueLossStreak": 3,
    "fatigueLossRatio": 0.6,
    "rageRestartMs": 60000,
    "rageMinChainLen": 2,
    "rageLowScoreRatio": 0.3,
    "resetOnIdleMs": 1800000,
    "lifecycleCapModifier": {
      "comment": "Arc → (capScale, adjustDelta) 乘性 modifier，应用在 lifecycleStressCapMap 已有 cap/adjust 之上。capScale ∈ [0.5, 1.2]、adjustDelta ∈ [-0.15, 0.10]；缺失或非法时按 1.0 / 0 处理（即不调制）。",
      "opener": {
        "capScale": 0.85,
        "adjustDelta": -0.05
      },
      "momentum": {
        "capScale": 1,
        "adjustDelta": 0
      },
      "peak": {
        "capScale": 1,
        "adjustDelta": 0
      },
      "fatigue": {
        "capScale": 0.8,
        "adjustDelta": -0.1
      },
      "cooldown": {
        "capScale": 0.7,
        "adjustDelta": -0.15
      }
    }
  },
  "placementEvaluation": {
    "comment": "v1.69 单步放块质量评估（per-move）。详见 docs/algorithms/PLACEMENT_QUALITY.md。weights 5 维和恒等于 1；throttle 在开局极松场景跳过枚举，避免 µs 级开销在中老局累计。badness 阈值控制 'created_hole / top_stacking / wasted_payoff' 标签触发。",
    "enabled": true,
    "weights": {
      "contact": 0.2,
      "tidiness": 0.2,
      "holeSafety": 0.3,
      "payoff": 0.2,
      "unlocking": 0.1
    },
    "throttle": {
      "skipWhenFillBelow": 0.25,
      "skipWhenCandidatesAbove": 500
    },
    "badness": {
      "createdHoleDelta": 2,
      "topStackingHeightDelta": 2,
      "wastedPayoffNearFullLines": 2
    }
  },
  "roundEvaluation": {
    "comment": "v1.69 一轮（三块 triplet）放块质量评估。components 5 维和恒等于 1；regretBlend 控制 order/path/payoff 三类 regret 在 totalRoundRegret 中的占比；salvage/forcedBad 阈值是公平性门控：bestRoundAbs < forcedBadThreshold 直接归类 'forced_bad'，不计玩家头上。",
    "enabled": true,
    "weights": {
      "solutionUsage": 0.25,
      "pathQuality": 0.25,
      "payoffRealized": 0.2,
      "endFlatness": 0.15,
      "continuity": 0.15
    },
    "regretBlend": {
      "order": 0.4,
      "path": 0.4,
      "payoff": 0.2
    },
    "thresholds": {
      "salvageThreshold": 0.5,
      "forcedBadThreshold": 0.4,
      "optimalRegret": 0.05,
      "classifyDominantDelta": 0.15
    }
  },
  "sessionEvaluation": {
    "comment": "v1.69 单局评估聚合。详见 docs/algorithms/SESSION_EVALUATION.md。guard 三个标志位（rageQuit / topOutBeforeFlow / flowStarvation）用作灰度回滚的兜底告警源。",
    "enabled": true,
    "guard": {
      "rageQuitDurationMs": 30000,
      "rageQuitScoreRatio": 0.3,
      "topOutMeanStressMax": 0.3,
      "flowStarvationRatioMin": 0.15
    }
  },
  "evaluationRuntime": {
    "comment": "v1.69 evaluation 端侧运行时开关。Web=Phase 1（全套）/ 小程序=Phase 1 / Cocos=Phase 1（仅 spawn+gameOver，per-place 受限）。设 enabled=false 可整体停用 evaluation 上报，不影响主玩法。perPlaceSampling=1 表示每步都评估；可降到 0.5 在低端机做采样降本。",
    "enabled": true,
    "perPlaceSampling": 1,
    "platforms": {
      "web": {
        "enabled": true,
        "perPlace": true,
        "perRound": true,
        "session": true,
        "ror": true
      },
      "miniprogram": {
        "enabled": true,
        "perPlace": true,
        "perRound": true,
        "session": true,
        "ror": true
      },
      "cocos": {
        "enabled": true,
        "perPlace": false,
        "perRound": false,
        "session": true,
        "ror": true
      }
    },
    "rlOutcomeSchema": {
      "comment": "v1.69 RL outcome 向量契约版本号。当 OUTCOME_DIM / 字段顺序改动时 bump version；dataset.py 与端侧 evaluation 上报均需引用同一版本。",
      "version": "v1.69.0",
      "outcomeDim": 15,
      "outcomeDimLegacy": 7,
      "psSnapshotVersionMin": 4
    }
  },
  "adaptiveSpawn": {
    "comment": "自适应出块系统：综合玩家实时能力画像（技能水平、心流状态、节奏相位、挫败感、差一点效应、新手标识）动态选择出块权重档位 + spawnHints，维持心流体验、延长停留时间。",
    "enabled": true,
    "profileWindow": 15,
    "smoothingFactor": 0.15,
    "fastConvergenceWindow": 5,
    "fastConvergenceAlpha": 0.35,
    "pbChase": {
      "comment": "v1.56.2 认知一致性守卫 + v1.56.4 三原则下的算法完整闭环。minBestScoreForIntenseFeedback=200 对应'玩家已掌握基本玩法'；低于此阈值所有 PB 段差异化算法全部 bypass。overshoot=D4 超 PB 持续加压（防分数膨胀）；farRamp=远段分级减压（极远更激进）；pbGrowthThrottle=PB 增长率过快时主动加压（不只 bypass）。",
      "minBestScoreForIntenseFeedback": 200,
      "overshoot": {
        "comment": "v1.56.4 §5.α.8 D4 超 PB 持续加压 —— challengeBoost cap=0.15 在 pct≥1.0 后饱和，与'超 PB 高强度加压防分数膨胀'原则冲突。本机制在 D4 段（score > bestScore）按对数曲线追加 pbOvershootBoost: maxBoost · log10(1 + slope·overshoot)，其中 overshoot = score/best - 1。pct=1.0→0 / pct=1.25→~0.08 / pct=1.50→~0.12 / pct=2.0→~0.16，stress cap 提高到 capStress。配套 spawnHints 收紧：multiClearBonus 上限 / sizePreference 上移 / clearGuarantee 下移。受 minBestScoreForIntenseFeedback / postPbRelease / recovery 等同源 bypass 约束。v1.56.6 §5.α.9 P0：bypassOccupancyDamping / bypassFlowPayoffCap / smoothMaxStepUp 三组豁免，让 D4 段加压在'盘面空 / flow+payoff / 单帧上扬'三种场景下不再被消解。v1.57.1 P2：orderBoostInD4HighStress（默认 0.25）—— D4 段 + stress 已经高位（≥ orderHighStressMin，默认 0.85，即 norm ≈ 0.875）时给 orderRigor 注入额外强 boost，把 maxValidPerms 真正压到 tight=2，让'顺序刚性'也彻底锁死。与 orderBoostInD4 互补：弱场景（仅 overshoot 触发）走 orderBoostInD4=0.08；强场景（overshoot + 高 stress 双重）走本字段。",
        "enabled": true,
        "maxBoost": 0.16,
        "slope": 5,
        "capStress": 0.9,
        "multiClearBonusCap": 0.18,
        "sizePreferenceShift": 0.12,
        "clearGuaranteeShift": -1,
        "orderBoostInD4": 0.08,
        "orderBoostInD4HighStress": 0.25,
        "orderHighStressMin": 0.85,
        "bypassOccupancyDamping": true,
        "bypassFlowPayoffCap": true,
        "smoothMaxStepUp": 0.25
      },
      "farRamp": {
        "comment": "v1.56.4 §5.α.8 远段分级减压 —— v1.56 原版 farFromPBBoost 把 pct∈[0,0.30) 一档处理，pct=0.05（极远，畏难最强）与 pct=0.29（边缘，即将进 D1）相同强度，与'让玩家有信心进入挑战 PB 模式'原则有信息流失。extremeThreshold=0.15 把 D0 切成两档：极远段额外抬 multiClearBonus floor 与 iconBonusTarget floor，让初期更易兑现奖励；边缘段维持原 floor。",
        "enabled": true,
        "extremeThreshold": 0.15,
        "extremeMultiClearBonusFloor": 0.55,
        "extremeIconBonusTargetFloor": 0.4,
        "extremeSizePreferenceShift": -0.18
      },
      "pbGrowthThrottle": {
        "comment": "v1.56.4 §5.α.8 PB 增长率反向加压 —— v1.56 原版 pbGrowthFast 仅触发 farFromPBBoost bypass='pb_growth_throttled'（被动节流）。本机制升级为'主动制动'：pbGrowthFast=true 时把 challengeBoost cap 从 0.15 临时上调到 0.15+capDelta，让 D2/D3 段提前进入更强加压。与 overshoot 协同防止 PB 在短时间内连续膨胀（7d 内 ≥10% 增长视为'过快'）。",
        "enabled": true,
        "challengeBoostCapDelta": 0.05
      },
      "challengeBoost": {
        "comment": "v1.56.6 §5.α.9 P2：challengeBoost cap 配置化 —— v1.55 硬编码 0.15 在 D3 段（pct=0.95）只产生 0.113 增量，相对 scoreStress 0.76 基础值仅 +17%，加压偏弱。默认 cap 上调到 0.18，让 D2/D3 段的'决战感'更可感。运营可基于看板曲线调整。配套 pbGrowthThrottle.challengeBoostCapDelta 触发时进一步上抬到 0.23。",
        "baseCap": 0.18
      },
      "postPbReleaseWindow": {
        "comment": "v1.56.6 §5.α.9 P2：破 PB 释放窗口配置化 —— v1.55 硬编码 3 spawn（约 5~10s）偏短，玩家'破纪录爽感'通常持续 10~20s 就被 D4 加压机制接管，体感'突兀变难'。默认 5 spawn，运营可调。与 overshoot bypass 链对齐：释放期内 pbOvershootBoost / pbExtremeOrderBoost / D4 spawnHints 收紧全部 bypass。",
        "spawns": 5,
        "stressReleaseFactor": 0.7,
        "clearGuaranteeBoost": 1
      },
      "expertEarlyBoost": {
        "comment": "高手早期得分机会加速 —— 与 dynamicDifficulty.pbProgress（effectivePB 压缩）配套：压缩在「难度坐标」上让高手更快进挑战区，本机制在「得分机会」维度让其早期盘面多产出多消/清屏/续消，使真实分数上升更快、更早穿过铺垫区（分数玩家自己打出来，非系统改进度）。仅对 bestScore≥expertThreshold 的高手，按 effectivePB 定义的早期相位 rDifficulty<earlyRampUntil 触发；与 farFromPBBoost（按 raw pct<0.30 对所有玩家送爽）互补，覆盖其顾不到的 raw 30%~挑战区真空。救济优先：warmup/recovery/nearMiss/postPbRelease 让位。仅作用于 spawnHints，纪录线不受影响。移除或 enabled=false 即关闭。expertThreshold 建议与 dynamicDifficulty.pbProgress.expertSoftCap 对齐。",
        "enabled": true,
        "expertThreshold": 1200,
        "earlyRampUntil": 0.45,
        "multiClearBonusFloor": 0.5,
        "perfectClearBoostFloor": 0.5,
        "clearGuaranteeBoost": 1
      }
    },
    "difficultyTuning": {
      "comment": "玩家选择难度的显式偏置。stressBias 拉开 profile 档位；clearGuaranteeDelta/sizePreferenceDelta/multiClearBonusDelta 直接进入 spawnHints；solutionStressDelta 仅用于解法数量区间选择，让困难模式更早进入低解空间过滤。",
      "easy": {
        "stressBias": -0.22,
        "clearGuaranteeDelta": 1,
        "sizePreferenceDelta": -0.22,
        "multiClearBonusDelta": 0.05,
        "solutionStressDelta": -0.14,
        "orderRigorBoost": 0
      },
      "normal": {
        "stressBias": 0,
        "clearGuaranteeDelta": 0,
        "sizePreferenceDelta": 0,
        "multiClearBonusDelta": 0,
        "solutionStressDelta": 0,
        "orderRigorBoost": 0
      },
      "hard": {
        "stressBias": 0.22,
        "clearGuaranteeDelta": -1,
        "sizePreferenceDelta": 0.24,
        "multiClearBonusDelta": -0.08,
        "solutionStressDelta": 0.18,
        "minStress": 0.18,
        "orderRigorBoost": 0.3
      }
    },
    "profiles": [
      {
        "id": "onboarding",
        "label": "新手引导",
        "stress": -0.2,
        "comment": "首局前 5 轮出块：极高线条/矩形权重，最小化不规则块，让新手建立信心和基本操作习惯",
        "shapeWeights": {
          "lines": 3.18,
          "rects": 2.2,
          "squares": 1.8,
          "tshapes": 0.45,
          "zshapes": 0.35,
          "lshapes": 0.53,
          "jshapes": 0.45
        }
      },
      {
        "id": "recovery",
        "label": "紧急救场",
        "stress": -0.1,
        "comment": "板面接近满时触发：大量线条便于消行自救，不规则块降到最低",
        "shapeWeights": {
          "lines": 2.95,
          "rects": 2,
          "squares": 1.3,
          "tshapes": 0.6,
          "zshapes": 0.5,
          "lshapes": 0.68,
          "jshapes": 0.6
        }
      },
      {
        "id": "comfort",
        "label": "舒适体验",
        "stress": 0,
        "comment": "低技能/挫败后恢复信心：消行友好块为主，偶尔引入简单不规则块",
        "shapeWeights": {
          "lines": 2.65,
          "rects": 1.85,
          "squares": 1.6,
          "tshapes": 0.75,
          "zshapes": 0.65,
          "lshapes": 0.83,
          "jshapes": 0.75
        }
      },
      {
        "id": "momentum",
        "label": "连击催化",
        "stress": 0.1,
        "comment": "combo 后或节奏释放期：偏向能串联消行的块型（线条+小矩形），催化连击正反馈",
        "shapeWeights": {
          "lines": 2.55,
          "rects": 1.75,
          "squares": 1.55,
          "tshapes": 0.85,
          "zshapes": 0.78,
          "lshapes": 0.9,
          "jshapes": 0.82
        }
      },
      {
        "id": "guided",
        "label": "引导成长",
        "stress": 0.2,
        "comment": "中低技能稳步成长：逐步引入更多不规则块，保持可控挑战",
        "shapeWeights": {
          "lines": 2.45,
          "rects": 1.7,
          "squares": 1.5,
          "tshapes": 0.95,
          "zshapes": 0.88,
          "lshapes": 1,
          "jshapes": 0.92
        }
      },
      {
        "id": "breathing",
        "label": "节奏呼吸",
        "stress": 0.3,
        "comment": "紧张周期后的释放窗口：略低于标准难度，给玩家喘息空间",
        "shapeWeights": {
          "lines": 2.3,
          "rects": 1.65,
          "squares": 1.45,
          "tshapes": 1,
          "zshapes": 0.95,
          "lshapes": 1.08,
          "jshapes": 1
        }
      },
      {
        "id": "balanced",
        "label": "均衡标准",
        "stress": 0.4,
        "comment": "心流核心区：与 normal 策略一致，各类块型均衡出现",
        "shapeWeights": {
          "lines": 2.15,
          "rects": 1.55,
          "squares": 1.35,
          "tshapes": 1.12,
          "zshapes": 1.12,
          "lshapes": 1.2,
          "jshapes": 1.12
        }
      },
      {
        "id": "variety",
        "label": "新鲜变化",
        "stress": 0.5,
        "comment": "防止审美疲劳：刻意拉平权重增加形状多样性，给中等玩家带来新鲜感",
        "shapeWeights": {
          "lines": 2,
          "rects": 1.5,
          "squares": 1.4,
          "tshapes": 1.2,
          "zshapes": 1.18,
          "lshapes": 1.23,
          "jshapes": 1.15
        }
      },
      {
        "id": "challenge",
        "label": "进阶挑战",
        "stress": 0.65,
        "comment": "中高手区间：不规则块明显增多，需要更多空间规划能力",
        "shapeWeights": {
          "lines": 1.85,
          "rects": 1.4,
          "squares": 1.5,
          "tshapes": 1.3,
          "zshapes": 1.3,
          "lshapes": 1.33,
          "jshapes": 1.25
        }
      },
      {
        "id": "intense",
        "label": "极限考验",
        "stress": 0.85,
        "comment": "高手专属：T/Z/L/J 权重超过线条，最大化空间规划压力",
        "shapeWeights": {
          "lines": 1.58,
          "rects": 1.3,
          "squares": 1.55,
          "tshapes": 1.42,
          "zshapes": 1.48,
          "lshapes": 1.46,
          "jshapes": 1.38
        }
      }
    ],
    "pacing": {
      "comment": "节奏张弛：每 cycleLength 轮出块为一个周期，前 tensionPhases 轮略加压，后面轮次释放。参考音乐副歌-间奏结构。v1.62.8：加 deadzoneEnabled=true + deadzoneFrames=2 —— pacing 刚切相的前 2 帧 pacingAdjust=0（让玩家先感受新节奏再叠加 ±0.12），把 pacingAdjust 平均绝对值从 ≈0.08 降到 ≈0.04，stress 主导分量从『50% 局是 pacingAdjust』下降。",
      "enabled": true,
      "cycleLength": 5,
      "tensionPhases": 3,
      "tensionBonus": 0.04,
      "releaseBonus": -0.12,
      "deadzoneEnabled": true,
      "deadzoneFrames": 2
    },
    "sessionArcCfg": {
      "comment": "v1.62.5 优化建议 #3：peak 段加压补全半圆弧。profileAudit 巡检显示 session-arc-warm-to-cool 67% 违规——sessionArc 全程为负、peak 段 sessionArcAdjust=0 没有正向输出。peakBoostEnabled=true + peakBoost=0.05 让 mid-session（momentum 在 [-0.2, 0.3] 区间）的中段获得轻微加压，形成『开头负→中段正→收官略负』的标准半圆弧。",
      "peakBoostEnabled": true,
      "peakBoost": 0.05
    },
    "spawnIntentCfg": {
      "comment": "v1.62.5 优化建议 #5：spawnIntent 滞回。v1.62.7 加 harvestStickyMode 后违规率仍 80%。v1.62.8 加 dwellFrames（最小停留帧数）—— 真实根因是多状态间小幅高频抖动（maintain↔flow↔engage↔harvest），仅靠边界扩展无法抑制。dwellFrames=3 表示进入某 intent 后 3 帧内不允许再切（relief/pressure 紧急路径除外）；强制系统消化完上次决策。预期把违规率从 80% 降到 ≤30%。可调 0 禁用、5+ 更激进。",
      "hysteresisEnabled": true,
      "sprintExpand": 0.05,
      "sprintShrink": 0.05,
      "reliefMargin": 0.05,
      "harvestStickyMode": true,
      "dwellFrames": 3
    },
    "engagement": {
      "comment": "参与度信号：首局保护、挫败回弹、差一点放大、新鲜感注入。",
      "firstSessionSpawns": 5,
      "firstSessionStressOverride": -0.15,
      "frustrationThreshold": 4,
      "frustrationRelief": -0.18,
      "nearMissStressBonus": -0.1,
      "nearMissClearGuarantee": 2,
      "noveltyDiversityBoost": 0.15,
      "farFromPBBoost": {
        "comment": "v1.56 §2.1 远征送爽：当 score < pctThreshold·bestScore（默认 D0 远征段 pct<0.30）且无救济/瓶颈/warmup/postPbRelease/pbGrowthFast 时，对 spawnHints 注入 clearGuarantee+1、multiClearBonus 抬升、iconBonusTarget 抬升、sizePreference 偏小，降低中长局开局畏难情绪。pbGrowthFast 由 game.js 上游通过最近 N 次 PB 增长率计算后透传到 ctx，默认未启用即不触发。详见 docs/player/BEST_SCORE_CHASE_STRATEGY.md §5.α v1.56。",
        "enabled": true,
        "pctThreshold": 0.3,
        "clearGuaranteeBoost": 1,
        "multiClearBonusFloor": 0.45,
        "iconBonusTargetFloor": 0.3,
        "sizePreferenceShift": -0.12
      }
    },
    "nearMissPlaceFeedback": {
      "comment": "落子未消行时的几何近失 toast（game.js）。v1.50.1 收紧：仅在玩家体感很差时出现（高挫败 / anxious 心流叠加挫败 / 强 stress 救济）；clearRate/动量任一为正即抑制；单局最多 1 次、落子间隔 12、冷却 30s、前 12 次落子不出。",
      "enabled": true,
      "minLineFill": 0.875,
      "minFrustrationLevel": 4,
      "minFrustrationWhenAnxious": 2,
      "maxPerSession": 1,
      "minPlacementsBetween": 12,
      "cooldownMs": 30000,
      "minPlacementsBeforeFirst": 12,
      "healthyClearRate": 0.3,
      "healthyMomentum": 0.05
    },
    "feedback": {
      "comment": "闭环反馈（敏感版）：更短窗口、更高 alpha、更慢衰减，bias 变化更易在面板/stress 上体现；仍钳制在 biasClamp。",
      "horizon": 3,
      "expected": 1,
      "alpha": 0.055,
      "decay": 0.93,
      "biasClamp": 0.22
    },
    "signals": {
      "comment": "stress 合成信号的开关与缩放；enabled=false 时该信号不参与，scale 用于 A/B 或回放校准。v1.62.5 优化建议 #1：__normalizeBudget 把所有非豁免 *Adjust 分量统一钳制到 ±N，防止 pacingAdjust 等强势分量长期主导（巡检显示 67% 局 pacingAdjust 单独占主导，自适应未充分介入）。豁免列表见 adaptiveSpawn.js _NORMALIZE_EXEMPT（difficultyBias / challengeBoost / 救济类信号本就需要更大幅度）。",
      "__normalizeBudget": 0.05,
      "scoreStress": {
        "enabled": true,
        "scale": 1
      },
      "runStreakStress": {
        "enabled": true,
        "scale": 1
      },
      "difficultyBias": {
        "enabled": true,
        "scale": 1
      },
      "skillAdjust": {
        "enabled": true,
        "scale": 1
      },
      "flowAdjust": {
        "enabled": true,
        "scale": 1
      },
      "pacingAdjust": {
        "enabled": true,
        "scale": 1
      },
      "recoveryAdjust": {
        "enabled": true,
        "scale": 1
      },
      "frustrationRelief": {
        "enabled": true,
        "scale": 1
      },
      "comboAdjust": {
        "enabled": true,
        "scale": 1
      },
      "nearMissAdjust": {
        "enabled": true,
        "scale": 1
      },
      "feedbackBias": {
        "enabled": true,
        "scale": 1
      },
      "trendAdjust": {
        "enabled": true,
        "scale": 1
      },
      "sessionArcAdjust": {
        "enabled": true,
        "scale": 1
      },
      "endSessionDistress": {
        "enabled": true,
        "scale": 1
      },
      "holeReliefAdjust": {
        "enabled": true,
        "scale": 1
      },
      "boardRiskReliefAdjust": {
        "enabled": true,
        "scale": 1
      },
      "abilityRiskAdjust": {
        "enabled": true,
        "scale": 1
      },
      "delightStressAdjust": {
        "enabled": true,
        "scale": 1
      },
      "friendlyBoardRelief": {
        "enabled": true,
        "scale": 1
      },
      "bottleneckRelief": {
        "enabled": true,
        "scale": 1
      },
      "motivationStressAdjust": {
        "enabled": true,
        "scale": 1
      },
      "accessibilityStressAdjust": {
        "enabled": true,
        "scale": 1
      },
      "returningWarmupAdjust": {
        "enabled": true,
        "scale": 1
      }
    },
    "stressSmoothing": {
      "comment": "对最终 stress 做轻量滞后，避免普通状态跳变；救场/近失/挫败等减压信号立即生效。",
      "enabled": true,
      "alpha": 0.4,
      "maxStepUp": 0.18,
      "maxStepDown": 0.28,
      "immediateReliefBoardRisk": 0.72
    },
    "friendlyBoard": {
      "comment": "v1.13 友好盘面救济：盘面 holes=0 + 临消行/多消候选/清屏机会充沛 + 节奏处于 payoff 时，注入一笔减压让拟人化压力表与玩家直觉同向。",
      "minNearFullLines": 2,
      "minMultiClearCandidates": 2,
      "requirePayoff": true,
      "baseRelief": -0.12,
      "maxRelief": -0.18
    },
    "flowPayoffStressCap": 0.79,
    "flowPayoffMaxBoardRisk": 0.5,
    "spawnTargets": {
      "comment": "将一维 stress 投影为多轴出块目标，避免仅通过方块复杂度消费压力。",
      "frustrationReliefThreshold": 5
    },
    "sprintIntent": {
      "comment": "v1.57.1 P3 spawnIntent 'sprint' 中间档配置：旧版 spawnIntent 在 stress=0.55 处一脚跨进 'pressure'（hints 套装翻盘），玩家会有'突然变难'的台阶感。'sprint' 充当 maintain → pressure 的过渡带（stress∈[minStress, maxStress)），hints 为'中等偏紧'：clearGuarantee 维持 1、sizePreference +0.10（略大块）、multiClearBonus 中等。bypass 链：救济 / 召回 / 收获 / 加压期优先级更高，sprint 仅在 stress 落入区间且无其他主导意图时触发。",
      "enabled": true,
      "minStress": 0.45,
      "maxStress": 0.55,
      "sizePreferenceShift": 0.1,
      "multiClearBonusFloor": 0.4
    },
    "delight": {
      "comment": "爽感兑现层：根据玩家能力、心流、动量、恢复需求和盘面机会，实时提高多消/清屏候选概率；高手无聊时略加压并给 payoff，焦虑/恢复时降压但保留清线爽点。",
      "highSkillThreshold": 0.62,
      "boredSkillStressBoost": 0.07,
      "anxiousReliefStress": 0.08,
      "baseMultiClearBoost": 0.22,
      "highSkillMultiBoost": 0.22,
      "momentumMultiBoost": 0.16,
      "opportunityMultiBoost": 0.3,
      "flowPayoffBoost": 0.14,
      "reliefMultiBoost": 0.2,
      "frustrationReliefThreshold": 5
    },
    "afk": {
      "comment": "AFK 检测：thinkMs 超过 thresholdMs 的操作排除出 metrics，避免离开/后台干扰能力估计。",
      "thresholdMs": 15000
    },
    "topologyDifficulty": {
      "comment": "盘面拓扑难度：holes 使用“所有形状都无法覆盖的空格”口径，代表真实可修复性下降；一方面按 holeFillEquivalent 折算为额外占用压力参与难度评估（同填充率下 holes 越多越难），另一方面进入 board pressure 并以救援方式降低过度出块压力、提高消行保障。v1.30 起新增 bottleneck* 系列：跨 dock 周期记录候选块 firstMoveFreedom 的最低点（trough），≤阈值时注入 bottleneckRelief 负向 stress 并抬高 clearGuarantee/偏小块。v1.32 起新增 orderRigor* 系列：当玩家高压且具备承受力时，要求三连块 6 种排列里仅 ≤N 种可解（默认 N=2），强制玩家做「先 X 再 Y 最后 Z」的顺序规划，是 Yerkes-Dodson 上限的精细加压器。",
      "holePressureMax": 8,
      "holeFillEquivalent": 0.8,
      "holeReliefStress": -0.16,
      "boardRiskReliefStress": -0.1,
      "holeClearGuaranteeAt": 2,
      "holeSizePreference": -0.22,
      "bottleneckTroughThreshold": 2,
      "bottleneckReliefMax": -0.12,
      "bottleneckClearGuaranteeAt": 2,
      "bottleneckSizePreferenceDelta": -0.18,
      "orderRigorEnabled": true,
      "orderRigorStressThreshold": 0.55,
      "orderRigorStressSmoothness": 0.08,
      "orderRigorScale": 1.6,
      "orderRigorSkillScale": 0.2,
      "orderRigorMaxPermsTight": 2,
      "orderRigorMaxPermsLoose": 4,
      "orderRigorActivationFill": 0.5,
      "orderRigorMaxHolesAllow": 3,
      "phaseFreq": {
        "comment": "v1.66 达成率提升：按 stress 划分压力阶段（low/mid/high，单一真相=raw stress + boardFill，不依赖晚到的 spawnIntent），分别强化两条既有策略的『达成率』而非新增机制——低压强化清屏（只在 pcSetup≥1∨nearFullLines≥1 机会已存在时抬 clearGuarantee + 抬 nearFullDelta 下限做跨轮造势），高压强化顺序方块（orderRigor 加 boost + 抬 solutionBudget 修截断静默失效 + MaxPerms 下限护栏 + 大块预加权提高拒绝采样命中率）。所有调整均为 Math.max/加和单调上抬，enabled=false 时与旧行为逐字段等价。highOrderBudget 仅在高压传给 evaluateTripletSolutions，避免高 fill 截断导致顺序过滤被跳过。",
        "enabled": true,
        "lowStressMax": 0.4,
        "highStressMin": 0.55,
        "lowClearGuaranteeAt": 2,
        "lowNearFullDeltaMin": 1,
        "highOrderBoost": 0.2,
        "highOrderMaxPermsFloor": 2,
        "highOrderSolutionBudget": 16000,
        "highPoolLargeCells": 6,
        "highPoolBoost": 0.6,
        "lowPoolClearBoost": 0.4
      }
    },
    "constructiveSpawn": {
      "comment": "v1.67 构造式出块（有界·概率式保难度）：在固定 40 形状词表内补两层构造能力，解决选择式『clearCandidates 为空时无法重塑盘面』的达成率瓶颈。C1 逆向缺口→形状补全检索（补全块存在但采样错过时，按概率强制占 clearSeat）；C2 先铺后清 1 步前瞻造势（无单形状可补全时，放 setup 形状制造可补全的近满线，跨 dock 续接）。全部概率式触发（概率<1）+ 冷却（连续 N dock 不重复强供）防『系统喂解』脚本感，未命中全量回退现有采样。相位门控复用 spawnHints.pressurePhase（low/mid/high）。enabled=false 时与旧行为逐字段等价。实现见 web/src/bot/constructiveSpawn.js + blockSpawn.js 构造预扫描。",
      "enabled": true,
      "maxEmpty": 2,
      "pCompleterLow": 0.7,
      "pCompleterMid": 0.35,
      "pSetupLow": 0.5,
      "pOrderHigh": 0.4,
      "maxConstructedPerDock": 1,
      "cooldownDocks": 2,
      "lookaheadDepth": 1,
      "completerBudget": 4000,
      "setupBudget": 6000,
      "setupPerShapePlacementCap": 40
    },
    "spawnStepDifficulty": {
      "comment": "单步出块难度（spawn step difficulty）统一分。无尽模式无『题目』概念，难度最小单元是『当前盘面 × 本轮候选三块』，由确定性特征逐步算出。本块把分散的原语（boardDifficulty / DFS solutionMetrics / 几何 scd）consolidate 成 0~1 难度分 + 5 档桶（trivial/easy/standard/hard/extreme），随 spawn 帧 spawnMeta.stepDifficulty 落库，供离线『难度桶 × 算法』聚合与 RL 数据集标注。实现见 web/src/spawnStepDifficulty.js，Python 镜像 rl_pytorch/spawn_step_difficulty.py。详见 docs/algorithms/ALGORITHMS_SPAWN.md §14.二。",
      "enabled": true,
      "boardSize": 8,
      "scdAmple": 0.3,
      "scdTight": 0.5,
      "scdSaturation": 0.6,
      "killerMinCells": 5,
      "killerMaxPlacements": 6,
      "longBarMinLength": 4,
      "solutionAbundant": 24,
      "flexibilityFree": 24,
      "comboCellsNorm": 15,
      "rlStateFeatureComment": "spawnStepDifficultyFeatures 暴露 4 维（scdNorm/comboCellsNorm/comboKillerNorm/comboLongBarNorm）正式拼入 RL 落子 state（→187）。另 blockSpawn 在 stepDifficulty 落库对象上附挂客观几何 contiguousRegions/concaveCorners（来自 boardTopology），供 aggregate-step-difficulty.mjs 按难度桶聚合。",
      "weights": {
        "scd": 0.3,
        "board": 0.2,
        "flexibility": 0.2,
        "solution": 0.15,
        "killer": 0.15
      }
    },
    "flowZone": {
      "comment": "心流参数：多维阈值判定心流状态 + 连续 F(t)=|boardPressure/skillLevel−1| 量化偏移度，各 adjust 随 F(t) 放大。",
      "thinkTimeLowMs": 1200,
      "thinkTimeHighMs": 10000,
      "thinkTimeVarianceHigh": 8000000,
      "clearRateIdeal": 0.32,
      "clearRateTolerance": 0.12,
      "missRateWorry": 0.28,
      "recoveryFillThreshold": 0.82,
      "recoveryDuration": 4,
      "skillAdjustScale": 0.3,
      "flowBoredAdjust": 0.08,
      "flowAnxiousAdjust": -0.12,
      "recoveryAdjust": -0.2,
      "comboRewardAdjust": 0.05,
      "flowSoftEdge_comment": "v1.62.8：flowAdjust 软边界。原行为只在 flow ∈ {bored, anxious} 时输出，neutral 区域硬置 0，与 flowDeviation 出现断层 → flowAdjust-tracks-flowDeviation 巡检 40% 违规。softEdgeEnabled=true 时，neutral 状态下 |flowDeviation| ≥ softEdgeMin 仍按 0.5× baseStep 线性外推，让 flowAdjust 连续跟踪 flowDeviation 方向。",
      "softEdgeEnabled": true,
      "softEdgeMin": 0.05,
      "softEdgeMax": 0.2
    },
    "reactionAdjust": {
      "comment": "v1.46『反应』指标 → stress 微调：startDrag→落子的纯执行段（pickToPlaceMs）落入快/慢尾部区间时，对 stress 施加 ±maxAdjust 的轻微偏移；中段（fast~slow 之间）零作用。阈值按本地回放有效样本分布校准：p5≈929ms、p50≈1447ms、p95≈2140ms，因此 fastMs=900、slowMs=2200；fastFullMs/slowFullMs 定义饱和区，让极端快/慢反应能真正接近 ±maxAdjust。仅当 reactionSamples ≥ minSamples 时启用，避免冷启动单点噪声；钳值刻意比 flowAdjust 小一个量级，作为现有信号的一个轻量补充而非主导项。",
      "enabled": true,
      "minSamples": 3,
      "fastMs": 900,
      "fastFullMs": 500,
      "slowMs": 2200,
      "slowFullMs": 3200,
      "maxAdjust": 0.05
    },
    "realtimeStateTuning": {
      "comment": "基于历史实时状态序列的复合早期救济：低消行+中高板面提前防挫败，高板面+挫败处理死局感合流，anxious+高认知负荷降低决策复杂度；同时在困境中削弱长期偏正的 feedbackBias。",
      "preFrustrationRelief": {
        "enabled": true,
        "clearRateMax": 0.25,
        "boardFillMin": 0.45,
        "maxRelief": 0.06
      },
      "boardFrustrationRelief": {
        "enabled": true,
        "boardFillMin": 0.58,
        "frustrationMin": 3,
        "maxRelief": 0.12
      },
      "decisionLoadRelief": {
        "enabled": true,
        "cognitiveLoadMin": 0.6,
        "maxRelief": 0.07
      },
      "feedbackBiasDamping": {
        "enabled": true,
        "factor": 0.5,
        "maxDamping": 0.08
      }
    },
    "solutionDifficulty": {
      "comment": "v9 新增·解法数量难度调控：在三连块通过 sequentiallySolvable 校验后，再用 DFS 估算 6 种放置顺序累计的「完整解叶子数」（截断到 leafCap），并按 stress 从 ranges 中挑选区间软过滤。stress 越高 → max 越小（解空间更窄、需精算）；stress 低 → 抬高 min（保证宽松度）。budget 用于截断 DFS 入栈次数以防爆炸；activationFill 以下不评估（性能门控）。truncated=true 时不参与过滤。v1.57.1 P1：在 0.35→0.6 之间补 '渐紧' 一档（minStress=0.5, max=64），让中段 stress 也有可感知难度差，消除 0.55 跨阈值前的'无感区'。v1.57.2：新增 holeIncrement.ranges——在解空间宽度之外引入'空洞强迫度'第二维度（详见 holeIncrement.comment）。",
      "enabled": true,
      "activationFill": 0.45,
      "leafCap": 64,
      "budget": 8000,
      "ranges": [
        {
          "minStress": -1,
          "label": "宽松",
          "min": 8,
          "max": null
        },
        {
          "minStress": 0,
          "label": "舒适",
          "min": 4,
          "max": null
        },
        {
          "minStress": 0.35,
          "label": "标准",
          "min": 2,
          "max": null
        },
        {
          "minStress": 0.5,
          "label": "渐紧",
          "min": 1,
          "max": 64
        },
        {
          "minStress": 0.6,
          "label": "紧张",
          "min": 1,
          "max": 32
        },
        {
          "minStress": 0.8,
          "label": "极限",
          "min": 1,
          "max": 12
        }
      ],
      "holeIncrement": {
        "comment": "v1.57.2 stress→新空洞难度（与 ranges 解空间宽度形成双轴）：DFS 在每个完整解叶子节点用'孤立空格'口径（四面非空围住的空格，必须用 1×1 才能填的'漏洞'，O(n²×4)≈256 ops，DFS 内反复调用仍可忽略）计算新空洞数 = 终末盘面 isolated holes − 初始 isolated holes（max(0,·) 避免消行净降产生负值）；取 6 种顺序的全部解中 min 值作为 minHoleIncrement（候选'最干净放置路径'的新空洞数）。按 stress 选 ranges 中的 { minIncrement, maxIncrement } 软过滤：低 stress 段 maxIncrement 强约束（必须存在干净解，space 越大越好玩）；高 stress 段 minIncrement 强约束（玩家被迫接受至少 N 个新空洞，'无论怎么放都会脏'的玩家心智压力）。仅在 earlyAttempt（attempt < ratio·limit）阶段硬过滤，宽松失败时 fallback 到无 hole 过滤以保证 spawn 不失败。activationFill 复用 solutionDifficulty.activationFill；truncated=true 跳过过滤。设计上不选 stacking-style（Tetris 风格）——OpenBlock 无重力，'被上方堵住'语义不成立；也不选 countUnfillableCells（O(shapes × n²) 太重）。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "干净",
            "minIncrement": null,
            "maxIncrement": 0
          },
          {
            "minStress": 0.35,
            "label": "宽容",
            "minIncrement": null,
            "maxIncrement": 1
          },
          {
            "minStress": 0.5,
            "label": "渐紧",
            "minIncrement": null,
            "maxIncrement": 2
          },
          {
            "minStress": 0.6,
            "label": "紧张",
            "minIncrement": 1,
            "maxIncrement": null
          },
          {
            "minStress": 0.8,
            "label": "极限",
            "minIncrement": 2,
            "maxIncrement": null
          }
        ]
      },
      "maxHoleIncrement": {
        "comment": "v1.57.3 ① — 最差解新空洞数（'专注度税'上界）。DFS 叶子追踪每个解的 isolated-holes delta，accum.maxHoleIncrement = 所有解中最脏路径的新空洞数。stress 高时 min 约束（拒绝'放哪都干净'的轻松候选——玩家随便放也不脏 = 缺少专注训练）；与 holeIncrement 形成对偶——min 是'最佳情况脏度'、max 是'最差情况脏度'。max 单独高 = '只有专心放才干净'的有希望紧张感，是 PB 挑战段最想要的体感。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "宽松",
            "min": null,
            "max": null
          },
          {
            "minStress": 0.5,
            "label": "渐紧",
            "min": null,
            "max": 4
          },
          {
            "minStress": 0.6,
            "label": "陷阱",
            "min": 1,
            "max": null
          },
          {
            "minStress": 0.8,
            "label": "高陷阱",
            "min": 2,
            "max": null
          }
        ]
      },
      "holeIncrementGap": {
        "comment": "v1.57.3 ⑨ — 专注度税差距 = maxHoleIncrement − minHoleIncrement。差距大 = '最优解干净但有陷阱'（专心放则过、走神则崩）；差距小 = 'min ≈ max'，候选要么都干净要么都脏，没有专注训练空间。高 stress 时 min 约束（强制差距大），让 D3/D4 段成为'专注度考验'。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "宽松",
            "min": null,
            "max": null
          },
          {
            "minStress": 0.6,
            "label": "考验",
            "min": 2,
            "max": null
          },
          {
            "minStress": 0.8,
            "label": "高考验",
            "min": 3,
            "max": null
          }
        ]
      },
      "endFillRatio": {
        "comment": "v1.57.3 ② — 终末填充率（三块下完后盘面占用率均值，0~1）。stress 高时 min 强约束（偏好'放完后盘面更满'的候选，玩家感受到'剩余决策窗口正在收窄'的窒息感）；stress 低时 max 强约束（保证放完仍有空间，玩家感受'通透'）。与 solutionRange / holeIncrement 正交——fillRatio 是空间剩余，hole 是漏洞。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "通透",
            "min": null,
            "max": 0.45
          },
          {
            "minStress": 0.35,
            "label": "适中",
            "min": null,
            "max": 0.6
          },
          {
            "minStress": 0.6,
            "label": "压迫",
            "min": 0.5,
            "max": null
          },
          {
            "minStress": 0.85,
            "label": "窒息",
            "min": 0.65,
            "max": null
          }
        ]
      },
      "nearFullDelta": {
        "comment": "v1.57.3 ③ — 近满行/列变化（放完后 nearFullLines 增量均值）。rhythm payoff 期 / 低 stress 偏好 min ≥ 1（'放完后多了一条快满'，玩家感受消行希望）；D4 高 stress 偏好 max ≤ 0（'放完后近满线变少'，消耗消行机会，防止 PB 通过近满膨胀）。这是把 rhythmPhase 节奏感**直接注入 spawn 算法**的关键钩子（旧版 rhythm 只影响 hints 权重）。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "送消",
            "min": 0.5,
            "max": null
          },
          {
            "minStress": 0.35,
            "label": "中性",
            "min": null,
            "max": null
          },
          {
            "minStress": 0.7,
            "label": "保守",
            "min": null,
            "max": 0.5
          },
          {
            "minStress": 0.85,
            "label": "消耗",
            "min": null,
            "max": -0.5
          }
        ]
      },
      "firstMoveSurvivor": {
        "comment": "v1.57.3 ④ — 第一步存活率（第 1 块所有合法位置中触达完整解的子树占比，0~1）。endless 类游戏的核心难度感——'第一手放错就全完'。stress 高时 max 强约束（survivor ≤ 0.6 → 玩家必须想清楚再放第一手）；stress 低时 min 强约束（survivor ≥ 0.5 → 大部分位置都安全，'放心试'）。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "宽容",
            "min": 0.6,
            "max": null
          },
          {
            "minStress": 0.35,
            "label": "中性",
            "min": null,
            "max": null
          },
          {
            "minStress": 0.7,
            "label": "代价",
            "min": null,
            "max": 0.7
          },
          {
            "minStress": 0.85,
            "label": "高代价",
            "min": null,
            "max": 0.5
          }
        ]
      },
      "solutionDiversity": {
        "comment": "v1.57.3 ⑤ — 解的真正差异度（perPermCounts 的变异系数 CV = std/mean）。CV 高 = 不同顺序的解数差异大（'有些顺序顺、有些顺序卡'，玩家需找顺）；CV 低 = 各顺序均衡（'放哪种顺序都差不多'，看似宽松但解相似度高）。stress 高时 max 强约束（拒绝高 CV 的'看起来宽松但解都一样'陷阱）。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "宽松",
            "min": null,
            "max": null
          },
          {
            "minStress": 0.6,
            "label": "均衡",
            "min": null,
            "max": 1.2
          }
        ]
      },
      "endFlatness": {
        "comment": "v1.57.3 ⑥ — 终末平整度（放完后列高方差均值）。OpenBlock 无重力但仍用列高方差代理'盘面凹凸度'。stress 高时 min 强约束（盘面更乱，审美焦虑）；stress 低时 max 强约束（保持齐整，玩家感受'秩序'）。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "整齐",
            "min": null,
            "max": 2
          },
          {
            "minStress": 0.5,
            "label": "适中",
            "min": null,
            "max": 4.5
          },
          {
            "minStress": 0.8,
            "label": "凌乱",
            "min": 3,
            "max": null
          }
        ]
      },
      "endDangerColumns": {
        "comment": "v1.57.3 ⑦ — 终末危险列数（放完后列高 ≥ dangerHeight=6 的列数均值，0~8）。爆顶预警维度——OpenBlock 接近 game over 的客观信号。stress 高时 min 强约束（让 D4 段持续面对'眼看就要顶死'的紧迫感）；stress 极低时 max 强约束（避免新手段落入危险列）。activationFill ≥ 0.45 才有意义。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "安全",
            "min": null,
            "max": 2
          },
          {
            "minStress": 0.5,
            "label": "中性",
            "min": null,
            "max": null
          },
          {
            "minStress": 0.8,
            "label": "预警",
            "min": 1,
            "max": null
          },
          {
            "minStress": 0.9,
            "label": "临界",
            "min": 2,
            "max": null
          }
        ]
      },
      "visualClutter": {
        "comment": "v1.57.3 ⑧ — 视觉杂乱 delta（放完后相邻 cell 颜色不同的边数 - 开局基线）。审美焦虑维度——花花绿绿的盘面让玩家心理压力上升；整齐成片的颜色块给人'有序'安全感。stress 高时 min 强约束（鼓励高 clutter 的候选）；低 stress 时 max 强约束（偏好'颜色聚团'的候选，减少视觉负担）。",
        "enabled": true,
        "ranges": [
          {
            "minStress": -1,
            "label": "聚团",
            "min": null,
            "max": 2
          },
          {
            "minStress": 0.5,
            "label": "适中",
            "min": null,
            "max": null
          },
          {
            "minStress": 0.8,
            "label": "繁杂",
            "min": 2,
            "max": null
          }
        ]
      }
    },
    "globalPersonalization": {
      "comment": "全球化个性化边界：只消费实时行为、明示偏好、设备负担和语言/地区上下文；敏感属性只允许聚合研究，不进入个体级策略。motivationIntent 描述中长期动机，spawnIntent 仍描述本轮出块意图。",
      "enabled": true,
      "sensitiveAttributesForIndividualTargeting": false,
      "allowedSignals": [
        "behavior",
        "preferences",
        "device",
        "languageRegionContext"
      ],
      "motivationIntents": [
        "competence",
        "challenge",
        "relaxation",
        "collection",
        "social",
        "balanced"
      ],
      "socialFairChallengeDisablesPersonalization": true
    }
  },
  "playerAbilityModel": {
    "comment": "AbilityVector 规则模型配置。所有权重与阈值集中在此，避免 playerAbilityModel.js / adaptiveSpawn.js 直接写模型魔术数字；仅影响真人路径的能力展示、回放快照和自适应减压。v2 增量（2026-05）：引入反应/多消/清屏/速度/锁死/新鲜度，并允许各指标使用独立时间窗口。",
    "version": 2,
    "calibrationNote": "所有 *_Max / *_Min 阈值当前是基于产品体感的初始猜测；建议运营离线跑 sql/move_sequences + live_sessions 求各信号的 P10/P50/P90，再回填这里使全玩家分布大致 N(0.5, 0.15)，避免 6 个 pill 同时压在 60-80 中段失去判别力。",
    "bands": {
      "riskHigh": 0.72,
      "riskMid": 0.42,
      "skillExpert": 0.78,
      "skillAdvanced": 0.58,
      "skillDeveloping": 0.36
    },
    "windows": {
      "comment": "v2：每个能力指标使用各自合适长度的滑动窗口（由 PlayerProfile.metricsForWindow 实现）。控制看短窗体现手感变化、消行看中窗等待机会积累、规划走瞬时；不同窗口避免单一 _window 同时迟钝又过敏。",
      "control": 8,
      "clearEfficiency": 16,
      "skillBlend": 12
    },
    "baseline": {
      "skillMinConfidence": 0.35,
      "skillBlendScale": 0.35,
      "riskMinConfidence": 0.45,
      "riskBlend": 0.25
    },
    "control": {
      "missRateMax": 0.3,
      "afkMax": 3,
      "apmMax": 18,
      "reactionFastMs": 350,
      "reactionSlowMs": 2200,
      "reactionMinSamples": 3,
      "weights": {
        "miss": 0.34,
        "cognitiveLoad": 0.22,
        "afk": 0.13,
        "apm": 0.15,
        "reaction": 0.16
      }
    },
    "clearEfficiency": {
      "clearRateMax": 0.55,
      "comboRateMax": 0.45,
      "avgLinesMax": 2.5,
      "multiClearRateMax": 0.5,
      "perfectClearRateMax": 0.15,
      "weights": {
        "clearRate": 0.4,
        "comboRate": 0.18,
        "avgLines": 0.14,
        "multiClear": 0.18,
        "perfectClear": 0.1
      }
    },
    "boardPlanning": {
      "holeMax": 8,
      "fillPenaltyStart": 0.58,
      "fillPenaltySpan": 0.36,
      "mobilityMax": 200,
      "closeLinesMax": 6,
      "fallbackMobilityScore": 0.55,
      "weights": {
        "holes": 0.36,
        "fill": 0.22,
        "mobility": 0.22,
        "nearClear": 0.2
      }
    },
    "risk": {
      "frustrationMax": 5,
      "roundsSinceClearMax": 4,
      "boardFillVelocityMax": 0.18,
      "firstMoveFreedomSafe": 8,
      "weights": {
        "boardFill": 0.26,
        "holes": 0.22,
        "frustration": 0.14,
        "roundsSinceClear": 0.1,
        "control": 0.1,
        "boardFillVelocity": 0.1,
        "lockRisk": 0.08
      }
    },
    "riskTolerance": {
      "nearMissBonus": 0.18,
      "recoveryPenalty": -0.15,
      "comboRateMax": 0.5,
      "weights": {
        "boardFill": 0.35,
        "comboRate": 0.22,
        "clearEfficiency": 0.2
      }
    },
    "confidence": {
      "profileWeight": 0.55,
      "lifetimePlacementsMax": 200,
      "lifetimePlacementsWeight": 0.25,
      "gamePlacementsMax": 20,
      "gamePlacementsWeight": 0.1,
      "recencyWeight": 0.1,
      "recencyHalfLifeDays": 14
    },
    "explain": {
      "clearEfficiencyHigh": 0.72,
      "clearEfficiencyLow": 0.35,
      "boardPlanningHigh": 0.7,
      "boardPlanningLow": 0.38,
      "controlLow": 0.42,
      "riskHigh": 0.7
    },
    "adaptiveSpawnRiskAdjust": {
      "minConfidence": 0.25,
      "riskThreshold": 0.62,
      "stressRelief": -0.08
    }
  },
  "rlTrainingStrategyId": "normal",
  "rlTraining": {
    "comment": "RL 训练随机采样策略 ID（顺序须与 featureEncoding.strategyIds one-hot 一致）；推理时以界面所选 difficulty 编码进 state。",
    "strategyIds": [
      "easy",
      "normal",
      "hard"
    ]
  },
  "rlRewardShaping": {
    "comment": "v6 优化奖励：增大势函数系数与终局信号，降低 outcome 混合比例让 V 学会逐步评估。",
    "smoothWinBonus": {
      "comment": "v11.2 方案 B（opt-in，默认 off）：把 sparse winBonus 替换为 tanh((score - target)/span)·winBonus 平滑过渡，target 取近 N 局 score 中位数，span 取 IQR。解决 V 头在阈值附近难拟合（Lv 高位震荡）的问题。⚠️ 启用会改变奖励量级，建议从头训或长 warmup；与 quantile 课程正交可叠加。RL_SMOOTH_WIN_BONUS=1/0 可热切换。",
      "enabled": false,
      "windowEpisodes": 500,
      "targetPercentile": 50,
      "spanLowPercentile": 25,
      "spanHighPercentile": 75,
      "bootstrapEpisodes": 200,
      "bootstrapTarget": 100,
      "bootstrapSpan": 60,
      "spanFloor": 5,
      "saturationClip": 1.5
    },
    "rndCuriosity": {
      "comment": "v11.2 方案 C（opt-in，默认 off）：Random Network Distillation 内在动机（Burda 2018, arXiv:1810.12894）。双 MLP（target 冻结 + predictor 学习），r_intrinsic = β·||target(s) - predictor(s)||²，鼓励访问新颖 state。解决高 ep 后探索退化（entropy→0、score 停滞）问题。⚠️ 启用会引入额外网络与 β 调参；触发条件未到时启用可能干扰已收敛策略。即使 enabled=false 也会定期打印触发条件评估 alert。RL_RND=1/0 可热切换。",
      "enabled": false,
      "stateDim": 201,
      "hiddenDim": 64,
      "outputDim": 32,
      "beta": 0.1,
      "learningRate": 0.0001,
      "updateEverySteps": 1,
      "normalizeIntrinsic": true,
      "gradClip": 5,
      "minEpisode": 50000,
      "scoreSlopeWindow": 5000,
      "scoreSlopeThreshold": 0.001,
      "entropyCollapseThreshold": 0.2,
      "expectedScoreAtCollapse": null,
      "scoreCollapseRatio": 0.8,
      "triggerCheckEvery": 2000
    },
    "winBonus": 35,
    "stuckPenalty": -8,
    "holeAuxLossCoef": 0.12,
    "holeAuxTargetMax": 16,
    "clearPredLossCoef": 0.15,
    "topologyAuxLossCoef": 0.08,
    "topologyAuxDim": 10,
    "spawnDiffAux": {
      "comment": "v12 单步出块难度辅助监督：让 trunk 显式预测当前 dock 的 4 维 spawnStepDifficulty 子向量（与 RL state 同源 spawn_step_difficulty_features），强化对难度分布的归纳偏置。target 取当前 dock 一手计算，不依赖未来块（无泄漏）。",
      "enabled": true,
      "coef": 0.05,
      "dim": 4
    },
    "evalFeedbackShaping": {
      "comment": "v12 评估反馈进 ΔΦ 塑形：把局内累计的 regret / forced_bad / salvage 信号转为势函数项（Ng 1999 不改变最优策略）。当 closeRound 信号可得时叠加；自博弈侧用 simulator 的近似口径（regret = best_reward - chosen_reward / norm，forced_bad = last_round_unfillable_holes_increase）。与 _pb_reward 离线权重同量级以对齐口径。",
      "enabled": true,
      "coef": 0.6,
      "regretWeight": -0.1,
      "optimalityWeight": 0.05,
      "forcedBadWeight": -0.08,
      "salvageWeight": 0.04,
      "regretNorm": 8
    },
    "conditionToken": {
      "comment": "v12 风格族 token：把出块算法的 RoR arc / spawnIntent 作为可控条件 token 注入 state（不是真实玩家观测，仅自博弈训练时按概率采样让 Bot 学一族策略；推理时显式指定）。enabled=false → 全零，state 维度仍然占位以保证 SSOT 不漂移。",
      "enabled": true,
      "arcs": [
        "opener",
        "momentum",
        "peak",
        "fatigue",
        "cooldown"
      ],
      "intents": [
        "relief",
        "engage",
        "pressure",
        "flow",
        "harvest",
        "maintain"
      ],
      "samplingProb": 0.6
    },
    "bonusClearAux": {
      "comment": "bonus/color-clear 辅助头：预测本步是否触发同 icon/同色 bonus line，帮助价值网络学习高分清线结构；旧 checkpoint 通过 strict=false 兼容新增头。",
      "enabled": true,
      "coef": 0.08
    },
    "boardQualityLossCoef": 0.55,
    "feasibilityLossCoef": 0.3,
    "survivalLossCoef": 0.28,
    "potentialShaping": {
      "comment": "势函数奖励塑形：r_shaped += coef * (Φ(s') − Φ(s))。v6 增大系数以提供更强逐步信号。adhesionWeight 为『放置块吸附』软约束：惩罚占用区朝向界内空格的暴露边（墙边不计→贴墙=吸附），鼓励落子尽量与边或其他方块贴合；为势函数项故不改变最优策略，且中间贴块放置同样受益、只软性抑制孤立悬空。负值，|值|越大吸附越强。",
      "enabled": true,
      "coef": 0.8,
      "holeWeight": -0.4,
      "transitionWeight": -0.08,
      "wellWeight": -0.15,
      "closeToFullWeight": 0.35,
      "mobilityWeight": 0.12,
      "adhesionWeight": -0.12
    },
    "outcomeValueMix": {
      "comment": "v6 混合价值目标：mix=0.5 → V 从 GAE returns 学逐步评估 + outcome 提供稳定锚点。v9.2 默认用 log1p(score)/log1p(threshold) 并放宽 clip，避免 400-500 分段 score/threshold 过早饱和。",
      "enabled": true,
      "mix": 0.5,
      "targetMode": "log",
      "maxValue": 3
    },
    "qDistillation": {
      "comment": "Q 分布蒸馏（v7 新增）：策略头额外学习 lookahead / beam / MCTS 搜索目标的 softmax 分布，向 AlphaZero 的「策略学搜索目标」靠拢。v9.3 加入单状态 Q 归一化与系数退火，前期跟强 teacher，后期避免过度锁死搜索偏差。",
      "enabled": true,
      "coef": 0.2,
      "tau": 0.85,
      "normalize": "zscore",
      "minStd": 0.25,
      "annealEndCoef": 0.08,
      "annealEpisodes": 60000
    },
    "visitPiDistillation": {
      "comment": "v9.1：MCTS 访问分布 visit_pi 直接 CE 蒸馏，区别于 beam/qDistillation 的 Q softmax；更贴近 AlphaZero 的策略目标。v9.3 同步退火，避免中后期策略只复制早期搜索分布。",
      "enabled": true,
      "coef": 0.15,
      "tau": 1,
      "annealEndCoef": 0.06,
      "annealEpisodes": 60000
    },
    "beam2ply": {
      "comment": "三块组合 2-ply beam（v7 新增）：Q_2ply(s,a1)=r1+γ·max_a2[r2+γ·V(s'')]，当 dock 剩余块≥2时激活，捕捉跨块放置协同效应。topK 控制二层展开的动作数（降低开销）。",
      "enabled": true,
      "topK": 15,
      "maxActions": 100
    },
    "evalGate": {
      "comment": "评估门控（v7 新增，参考 AlphaZero 第三步）：每 everyEpisodes 局，在同 seed 下配对评估候选与基线。rule=win 时按严格赢率判定，rule=nonloss 时按不输率判定；都要求平均分差非负。v10 输出 policy-only 与 policy+search 双评估，并按固定 seed bucket 记录分数差。",
      "enabled": true,
      "everyEpisodes": 2500,
      "nGames": 64,
      "winRatio": 0.55,
      "rule": "win",
      "rounds": 2,
      "dualEval": true
    },
    "rankedReward": {
      "comment": "v9 单人自博弈 Ranked Reward：维护滚动分数窗口，将当前局得分转成历史分位终局奖励，缓解 400-500 分平台期。只加到终局步，不改变局内环境；环境变量 RL_RANKED_* 可覆盖。",
      "enabled": true,
      "window": 2048,
      "warmup": 128,
      "targetPercentile": 0.5,
      "targetPercentileEnd": 0.7,
      "rampEpisodes": 30000,
      "deadband": 0.04,
      "bonusScale": 14,
      "penaltyScale": 6,
      "maxAbs": 16
    },
    "adaptiveCurriculum": {
      "comment": "自适应课程（v8 引入，v11 闭环化）：根据滑动胜率四档反应——wr ≥ target+accelBand 加速；wr ∈ [target-holdBand, target+accelBand) 正常；wr ∈ [target-lowWinRateBand, target-holdBand) 暂停；wr < target-lowWinRateBand 主动回退（虚拟局数 -stepDown × checkEvery）；wr < target-severeWinRateBand 触发 severe rollback（virtual_ep × severeRollbackFactor）。注意：v8 旧版只升不降，v11 起 stepDown 默认 1.0 实现真闭环。借鉴 search-contempt 论文 §4.2 (arXiv:2504.07757)。enabled=false 使用原固定线性爬坡，可被 RL_ADAPTIVE_CURRICULUM=0 强制关闭。",
      "enabled": true,
      "window": 200,
      "targetWinRate": 0.5,
      "stepUp": 2,
      "stepDown": 1,
      "checkEvery": 50,
      "accelBand": 0.1,
      "holdBand": 0.1,
      "lowWinRateBand": 0.2,
      "severeWinRateBand": 0.4,
      "minVirtualEp": 0,
      "rollbackOnSevereDrop": true,
      "severeRollbackFactor": 0.5,
      "minSamplesForAction": 10
    },
    "beam3ply": {
      "comment": "三块全排列 3-ply beam（v8 新增）：Q_3ply = r1+γ·max_{a2}[r2+γ·max_{a3}[r3+γ·V(s''')]]。仅在 dock 未放置块数≥3 时激活。v10 起支持 riskAdaptive：高填充、低 mobility、低 leaf count 时动态提高 topK/topK2/maxActions。",
      "enabled": true,
      "topK": 8,
      "topK2": 3,
      "maxActions": 60,
      "maxActions2": 30,
      "riskAdaptive": true,
      "riskFill": 0.56,
      "riskMobility": 18,
      "riskLeafCount": 1,
      "riskMaxMultiplier": 1.8,
      "riskTopKMax": 24,
      "riskTopK2Max": 8,
      "riskMaxActionsMax": 140,
      "riskMaxActions2Max": 80
    },
    "searchReplay": {
      "comment": "v9.3 困难样本 replay：缓存高分未通关、尾局可行性差或低 mobility 的 self-play 局，训练时抽样重放，提升 search teacher 样本利用率。minPriority 略降以便弱策略期仍能填满缓冲区。",
      "enabled": true,
      "maxEpisodes": 256,
      "sampleRatio": 0.5,
      "maxSamples": 8,
      "keepPerBatch": 4,
      "minPriority": 1
    },
    "lightMCTS": {
      "comment": "轻量 UCT-MCTS：visit_pi + Q 代理作为 teacher，配合 visitPiDistillation。默认开启 moderate sims；采集更慢但显著缓解「短局无 teacher」。训练前可设环境变量 RL_MCTS=0 强制关闭改回纯 beam。",
      "enabled": true,
      "numSimulations": 12,
      "cPuct": 1.5,
      "maxDepth": 8,
      "evalBatchSize": 8,
      "evalBatchSizeComment": "v8.2：批量叶子节点评估的并发模拟数（8~32）。n_simulations≥50 时自动切换批量模式。",
      "zobristCacheSize": 5000,
      "zobristCacheSizeComment": "v8.2：Zobrist hash 跨局本地节点缓存上限（节点数）。0=禁用。",
      "sharedZobristSlots": 8192,
      "sharedZobristSlotsComment": "v8.3：跨进程共享转置表槽位数（每槽 8 字节）。8192=64KB，65536=512KB。多 worker 时自动启用。",
      "adaptiveSims": true,
      "adaptiveSimsComment": "v8.3：渐进式模拟次数开关。true=先跑 minSims，top1/top2 比≥confidence 后提前停止。",
      "minSims": 10,
      "confidence": 3,
      "riskAdaptive": true,
      "riskFill": 0.58,
      "riskMobility": 16,
      "riskMaxMultiplier": 2,
      "maxSimulations": 40
    },
    "trainingPresets": {
      "comment": "三档训练预设：performance（最快吞吐，弱 teacher）/ balanced（默认，速度与质量折中）/ quality（慢但 teacher 信号最强）。面板切换后覆盖 lightMCTS / beam3ply / beam2ply 的运行时参数，不修改本文件持久值。",
      "performance": {
        "label": "⚡ 性能",
        "description": "最高吞吐 · 弱 teacher 信号",
        "mcts": {
          "enabled": false
        },
        "beam3ply": {
          "enabled": false
        },
        "beam2ply": {
          "enabled": true,
          "topK": 8,
          "maxActions": 50
        },
        "feasibilityNodeBudget": 80,
        "riskNodeBudget": 60
      },
      "balanced": {
        "label": "⚖️ 平衡",
        "description": "速度与质量折中",
        "mcts": {
          "enabled": true,
          "numSimulations": 12,
          "maxSimulations": 40,
          "adaptiveSims": true
        },
        "beam3ply": {
          "enabled": true,
          "topK": 8,
          "topK2": 3,
          "maxActions": 60,
          "maxActions2": 30
        },
        "beam2ply": {
          "enabled": true,
          "topK": 15,
          "maxActions": 100
        },
        "feasibilityNodeBudget": 200,
        "riskNodeBudget": 150
      },
      "quality": {
        "label": "🎯 效果",
        "description": "最强 teacher 信号 · 训练较慢",
        "mcts": {
          "enabled": true,
          "numSimulations": 24,
          "maxSimulations": 80,
          "adaptiveSims": true
        },
        "beam3ply": {
          "enabled": true,
          "topK": 12,
          "topK2": 4,
          "maxActions": 100,
          "maxActions2": 50
        },
        "beam2ply": {
          "enabled": true,
          "topK": 15,
          "maxActions": 100
        },
        "feasibilityNodeBudget": 1200,
        "riskNodeBudget": 600
      }
    }
  },
  "featureEncoding": {
    "comment": "state = 62 维标量（25 结构 + 19 颜色 + 4 单步难度 + 3 策略 one-hot + 5 arc one-hot + 6 intent one-hot）+ 64 棋盘 + 75 dock = 201；action = 15；phi = 216。策略维顺序见 strategyIds；arc/intent 顺序见 rlRewardShaping.conditionToken（顺序变更需重训）。Python 训练环境出块默认走 Node worker（scripts/rl-spawn-worker.mjs）与线上一致；RL_SPAWN_ONLINE=0 回退 block_spawn.py。改维度须同步 features 并重训。",
    "maxGridWidth": 8,
    "dockMaskSide": 5,
    "strategyIds": [
      "easy",
      "normal",
      "hard"
    ],
    "strategyDim": 3,
    "conditionArcDim": 5,
    "conditionIntentDim": 6,
    "stateScalarDim": 62,
    "colorCount": 8,
    "gridSpatialDim": 64,
    "dockSpatialDim": 75,
    "stateDim": 201,
    "actionDim": 15,
    "phiDim": 216,
    "dockSlots": 3,
    "almostFullLineRatio": 0.78,
    "actionNorm": {
      "maxBlockIndex": 3,
      "shapeSpan": 5,
      "maxCells": 10,
      "maxClearsHint": 5,
      "maxHoles": 16,
      "maxTransitions": 64,
      "maxWellDepth": 24,
      "maxMobility": 192,
      "maxAdjacent": 20,
      "maxEmptyRegions": 16,
      "maxConcaveCorners": 32,
      "nearFullThreshold": 0.75
    }
  },
  "strategies": {
    "easy": {
      "id": "easy",
      "name": "Easy",
      "fillRatio": 0,
      "scoring": {
        "singleLine": 20,
        "multiLine": 60,
        "combo": 100
      },
      "shapeWeights": {
        "lines": 2.3,
        "rects": 1.65,
        "squares": 1.45,
        "tshapes": 1.05,
        "zshapes": 1.05,
        "lshapes": 1.13,
        "jshapes": 1.05
      },
      "gridWidth": 8,
      "gridHeight": 8,
      "colorCount": 8
    },
    "normal": {
      "id": "normal",
      "name": "Normal",
      "fillRatio": 0.18,
      "scoring": {
        "singleLine": 20,
        "multiLine": 60,
        "combo": 100
      },
      "shapeWeights": {
        "lines": 2.15,
        "rects": 1.55,
        "squares": 1.35,
        "tshapes": 1.12,
        "zshapes": 1.12,
        "lshapes": 1.2,
        "jshapes": 1.12
      },
      "gridWidth": 8,
      "gridHeight": 8,
      "colorCount": 8
    },
    "hard": {
      "id": "hard",
      "name": "Hard",
      "fillRatio": 0.32,
      "scoring": {
        "singleLine": 20,
        "multiLine": 60,
        "combo": 100
      },
      "shapeWeights": {
        "lines": 2.05,
        "rects": 1.55,
        "squares": 1.42,
        "tshapes": 1.18,
        "zshapes": 1.18,
        "lshapes": 1.26,
        "jshapes": 1.18
      },
      "gridWidth": 8,
      "gridHeight": 8,
      "colorCount": 8
    }
  }
};
