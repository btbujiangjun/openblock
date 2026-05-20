/**
 * decisionFlowViz.js — v1.51.2 决策数据流实时可视化（增强版）
 *
 * 把"玩家信号 → stress 分解贡献 → 决策输出"三段管道用 SVG（连接线/节点）
 * + Canvas（粒子光流）+ HTML 详情区 + 时间序列 sparkline 渲染成炫酷可视面板。
 *
 * v1.51.2 升级（用户反馈：截图 shapeWeights 文字溢出 / 信息密度不够）：
 *   1. **支持整面板拖动**（head 区按住拖）—— 一旦拖动转为自由 left/top 像素并 clamp 到视口。
 *   2. **优化显示**：宽 580 / 双栏 grid（左 SVG 信号 + 右 HTML 详情区，避免 SVG 文字溢出）。
 *   3. **数据实时搜集**：每帧采样 5 个核心 metric → ring buffer 240 点 → 底部 sparkline 折线条。
 *   4. **更多信号**：原 7 节点 → 10 节点（增 boardFill / comboChain / missRate）。
 *   5. **更多决策信息**：Top contributors / Decision flags / Hints（clearGuarantee 等）/ Reason 推导。
 *   6. **入口迁移**：从 #skill-bar 移到 #sound-effects-toggle 之后（与快捷开关簇同列）。
 *
 * 数据源（全部从 game.js 现有字段读取，零侵入）：
 *   - playerProfile.{skillLevel, momentum, frustrationLevel, flowState, sessionPhase,
 *                    cognitiveLoad, recentComboStreak}, metrics.{clearRate, missRate}
 *   - grid.getFillRatio()
 *   - _lastAdaptiveInsight.{stress, stressBreakdown, spawnIntent, spawnHints,
 *                           shapeWeightsTop, spawnTargets, ...}
 *
 * 性能：
 *   - 关闭态完全 hidden + 取消 RAF；零开销
 *   - 打开态 RAF ~60fps，但 SVG 节点/边 DOM 数量 ≤ 36，Canvas 粒子 ≤ 80（cap）
 *   - HTML 详情区每 6 帧重排一次（10Hz），sparkline 每 3 帧（20Hz），避免每帧 reflow
 */

import { summarizeContributors } from './stressMeter.js';
import { getShapeById } from './shapes.js';
import { t } from './i18n/i18n.js';
/* v1.58 §rewire：派生层 SSOT 接入。Chip override 状态从硬编码 (intent==='relief')
 * 改走表驱动 isSignalOverridden，新增 intent/signal 无需再改 DFV 渲染代码。
 *
 * v1.58.3 升级：chip 渲染从手写 flags 数组改走 deriveChipsFromCtx + buildChipCtxFromInsight，
 * 让 DFV chip on 函数与 CHIP_DEFS 表唯一同源——未来新增 chip 只改 CHIP_DEFS 不改 DFV。
 * 每个 chip 高亮时 title 自动写 reason + 数值，治理"灯亮但无来源"。
 * conflicts 数组渲染在 chip 区底部一行，承认跨维度信号冲突。 */
import { resolveIntent as _dfvResolveIntent, isSignalOverridden as _dfvIsSignalOverridden } from './derivation/intentResolver.js';
import {
    deriveChipsFromCtx as _dfvDeriveChips,
    buildChipCtxFromInsight as _dfvBuildChipCtx,
    deriveConflicts as _dfvDeriveConflicts,
} from './derivation/presentationReducer.js';
/* v1.59.6：DFV 右栏"决策动态"段集成 2 个 algorithmDynamicsCard 模块——
 *   §B 压力归因（stress 分量竖排排序条目，归因型可读 fix）
 *   §C 响应灵敏度（玩家信号 vs 算法响应 Pearson 粗估）
 * v1.59.6 删除 §A 意图时间线：信息密度低、占用右栏空间且切换次数已在出块意图段统计。 */
import {
    renderStressBreakdownStack as _dfvRenderStressStack,
    renderResponseSensitivityCard as _dfvRenderSens,
} from './algorithmDynamicsCard.js';

/**
 * v1.51.4：i18n key 取值帮助函数。失败 / 缺译时回退到 fallback 中文文案。
 * t(key) 在 key 不存在时返回 key 本身——靠这个判断是否回退。
 */
function _ti(key, fallbackText) {
    const v = t(key);
    return (v && v !== key) ? v : fallbackText;
}

const HOST_ID = 'decision-flow-viz';
const STYLE_ID = 'decision-flow-viz-styles';
const TOGGLE_BTN_ID = 'decision-flow-viz-btn';

/** 玩家信号节点定义（左列，10 个）
 *  - i18nKey：本地化 key；缺译时回退 label。
 *  - range：热力色阶归一化区间；type='enum' 用 enumColors 直接配色。
 *  - format 控制数值展示（默认 toFixed(2) / 整数）。 */
/* v1.59.8 baseColor：每个信号节点的身份色，永远显示——
 *   - 加载时 / 数据缺失时：fill 用 baseColor + 低 alpha，stroke 用 baseColor 全色，
 *     辅以 idle 呼吸动画 让节点"待机但活着"，避免一片灰
 *   - 有数据时：fill 仍用 baseColor，opacity 由信号强度 [0,1] 驱动（0.45..1.0）
 *   - enum 节点（flow/session）维持 enumColors 状态切色（已是身份/状态色） */
const SIGNAL_NODES = [
    { key: 'skill',      i18nKey: 'dfv.signal.skill',     label: '技能',   readPath: ['profile', 'skillLevel'],          range: [0, 1], baseColor: '#facc15' },
    { key: 'momentum',   i18nKey: 'dfv.signal.momentum',  label: '动量',   readPath: ['profile', 'momentum'],            range: [-1, 1], signed: true, baseColor: '#fb923c' },
    { key: 'frust',      i18nKey: 'dfv.signal.frust',     label: '挫败',   readPath: ['profile', 'frustrationLevel'],    range: [0, 8],  format: 'int', baseColor: '#ef4444' },
    { key: 'flow',       i18nKey: 'dfv.signal.flow',      label: '心流',   readPath: ['profile', 'flowState'],           type: 'enum',
      enumColors: { bored: '#fbbf24', flow: '#10b981', anxious: '#ef4444' }, baseColor: '#10b981' },
    { key: 'session',    i18nKey: 'dfv.signal.session',   label: '阶段',   readPath: ['profile', 'sessionPhase'],        type: 'enum',
      enumColors: { early: '#60a5fa', peak: '#10b981', late: '#f97316' }, baseColor: '#60a5fa' },
    { key: 'load',       i18nKey: 'dfv.signal.load',      label: '负荷',   readPath: ['profile', 'cognitiveLoad'],       range: [0, 1], baseColor: '#a78bfa' },
    { key: 'clearRate',  i18nKey: 'dfv.signal.clearRate', label: '消行率', readPath: ['profile', 'metrics', 'clearRate'], range: [0, 0.55], baseColor: '#34d399' },
    { key: 'boardFill',  i18nKey: 'dfv.signal.boardFill', label: '占盘',   readPath: ['profile', 'boardFill'],            range: [0, 1], baseColor: '#22d3ee' },
    { key: 'combo',      i18nKey: 'dfv.signal.combo',     label: '连击',   readPath: ['profile', 'recentComboStreak'],    range: [0, 6],  format: 'int', baseColor: '#f472b6' },
    { key: 'missRate',   i18nKey: 'dfv.signal.missRate',  label: '失放率', readPath: ['profile', 'metrics', 'missRate'],  range: [0, 0.4], baseColor: '#f87171' },
];

/**
 * v1.60.17：节点 SVG <title> tip 文案集（hover 时浏览器原生 tooltip 显示）。
 *
 * 用户反馈"所有节点应有 cursor:help 提示"，配合 CSS 后必须每个节点真有 <title> 才不会
 * "光标变了但 hover 一片空白"。本字典覆盖 5 类节点共 24 个：
 *   - 信号 10：来源数据 + 取值范围
 *   - 策略 5：含义 + 算法消费方式
 *   - 目标 6：deriveSpawnTargets 公式语义
 *   - 调度 4：已在 SCHEDULE_PARAM_DEFS.tip（v1.60.12）
 *   - 意图 1 / 压力球 1：高层语义
 * 内容均 ≤60 字，避免遮挡正文。后续可扩展为含当前实时值（_render*Node 中更新 textContent）。
 */
const SIGNAL_TIP = {
    skill:     '技能（profile.skillLevel）— 玩家技能水平 [0,1]，影响形状复杂度、解空压力等目标层',
    momentum:  '动量（profile.momentum）— 近期消行节奏 [-1,1]，负值触发 clearGuarantee 救济',
    frust:     '挫败（profile.frustrationLevel）— 累计未消轮次 [0,8]，高值触发减压注入',
    flow:      '心流（profile.flowState）— bored/flow/anxious 三态，驱动 orderRigor / diversityBoost',
    session:   '阶段（profile.sessionPhase）— early/peak/late，影响 novelty / iconBonusTarget',
    load:      '负荷（profile.cognitiveLoad）— 同时活跃约束数 [0,1]，high → 收紧 sizePreference',
    clearRate: '消行率（metrics.clearRate）— 最近 N 步消行频率 [0,0.55]',
    boardFill: '占盘（profile.boardFill）— 当前实时填充率 [0,1]，主导加压/减压判定',
    combo:     '连击（recentComboStreak）— 最近连击次数 [0,6]，驱动 comboChain 派生节点',
    missRate:  '失放率（metrics.missRate）— 最近 N 步未消行频率 [0,0.4]，高值升 clearGuarantee',
};

const STRATEGY_TIP = {
    clearGuarantee: '保消（clearGuarantee 0-3）— 三连块中至少 N 个能即时消行；frust/momentum/missRate 多路 Math.max 拉高',
    sizePreference: '尺寸（sizePreference -1~1）— 偏小块/偏大块；frust/load 高时压低（偏小），sprint 时抬高（偏大）',
    orderRigor:     '刚性（orderRigor 0-1）— 严格按 placement order；bored/load/frust 多路调节',
    diversityBoost: '多样（diversityBoost 0-1）— 鼓励三连块品类多样；bored/load/missRate 拉高',
    comboChain:     '连击（comboChain 0-1）— deriveComboChain 读 lastClearCount + recentComboStreak，技能稳定时强化',
};

const TARGET_TIP = {
    shapeComplexity:       '形状复杂度（shapeComplexity）= stress×0.75 + boredHighSkill×0.25 − riskRelief×0.45',
    solutionSpacePressure: '解空间压力（solutionSpacePressure）= stress×0.7 + complexity×0.25 − boardRisk×0.55 − recoveryNeed×0.35',
    clearOpportunity:      '消行机会（clearOpportunity）= recoveryNeed×0.55 + payoffOpp×0.45 − stress×0.18',
    spatialPressure:       '空间压力（spatialPressure）= stress×0.65 + boardDifficulty×0.25 − boardRisk×0.5 − recoveryNeed×0.3',
    payoffIntensity:       '兑现强度（payoffIntensity）= delight.multiClearBoost×0.45 + payoffOpp×0.4 + max(0,momentum)×0.15',
    novelty:               '新奇度（novelty）= (bored?0.45:0) + stress×0.25 + session/80 − recoveryNeed×0.2',
};

const STRESS_TIP = '压力（stress）— delight + 5 派生分量加权合成 [0,1]，DFV 中央球大小映射；hover 决策动态可见 breakdown';
const INTENT_TIP = '意图（spawnIntent）— intentResolver 根据 stress + 5 hints + delight + sessionArc 选出 harvest/relief/engage/flow/sprint/pressure/maintain 之一';

/** 决策输出节点定义（右列）spawnIntent 颜色映射（与 stressMeter 叙事同口径） */
const SPAWN_INTENT_COLOR = {
    relief:   '#22d3ee',
    engage:   '#a78bfa',
    flow:     '#10b981',
    maintain: '#94a3b8',
    /* v1.57.1 P3：sprint 颜色介于 flow（#10b981 翠绿）和 pressure（#f59e0b 橙）之间，
     * 用青绿（#0ea5e9 → 偏向 flow 一侧的渐变中点）表达"渐紧但未压"的过渡感。
     * 在 DFV 球状图中与 flow/pressure 在视觉上形成颜色梯度（绿→青→橙）。 */
    sprint:   '#0ea5e9',
    pressure: '#f59e0b',
    harvest:  '#f472b6',
};

/** 中文意图说明（hover / 详情区显示） */
const SPAWN_INTENT_DESC = {
    relief:   '救济节奏',
    engage:   '挑战参与',
    flow:     '维持心流',
    maintain: '保持节奏',
    sprint:   '渐紧过渡',
    pressure: '提升压力',
    harvest:  '收获机会',
};

/** v1.51.3：shape category 中文映射（与 shared/shapes.json categoryOrder 对齐） */
const SHAPE_CATEGORY_CN = {
    lines:   '长条',
    rects:   '矩形',
    squares: '方块',
    tshapes: 'T 形',
    zshapes: 'Z 形',
    lshapes: 'L 形',
    jshapes: 'J 形',
};

/**
 * v1.59.17：shape category 视觉色（与 STRATEGY_COMPONENT_DEFS / SPAWN_TARGET_DEFS 色系协调），
 * 供阶段③ 3 chosen shape 节点按 category 染色。每色尽量与同 category 的形状语义对应：
 *   lines（长条）  → 青蓝（cyan）：直线流畅感
 *   rects（矩形）  → 紫
 *   squares（方块）→ 黄：稳定感
 *   tshapes（T）   → 粉
 *   zshapes（Z）   → 橙：弯折锋利
 *   lshapes（L）   → 绿
 *   jshapes（J）   → 红
 */
const SHAPE_CATEGORY_COLOR = {
    lines:   '#22d3ee',
    rects:   '#a78bfa',
    squares: '#fcd34d',
    tshapes: '#f472b6',
    zshapes: '#fb923c',
    lshapes: '#10b981',
    jshapes: '#ef4444',
};

/**
 * v1.59.18：blockSpawn diagnostics.chosen[].reason 标签的完整中文映射。
 *
 * **代码事实**：blockSpawn.js 在 chosen 字段只会写入以下 4 种 reason 之一
 * （详见 web/src/bot/blockSpawn.js L1076/L1245/L1254/L1556）：
 *   - 'clear'         主路径：消行候选优先（pcSetup<1）
 *   - 'perfectClear'  主路径：清屏候选优先（pcSetup>=1）
 *   - 'weighted'      主路径：weighted pool 加权抽选
 *   - 'fallback'      兜底：主路径失败时降级
 *
 * v1.59.17 之前字典含 multiClear/holeReduce/gapFills/pcPotential 等都是误写——
 * blockSpawn 从不会写这些字串到 chosen.reason，造成 'clear' 漏配进而被
 * _summarizeReason() 走 slice(0,4) 截成 'clea'（用户反馈"出块文字显示不全"根因）。
 *
 * 完整中文用 3~4 字，节点上方居中显示。
 */
const SPAWN_REASON_CN = {
    clear:        '送消行',
    perfectClear: '送清屏',
    monoFlush:    '送同花',          /* v1.60.29：主路径同花顺彩蛋 */
    weighted:     '综合选',
    fallback:     '兜底块',
    'special-relief':    '送减压',
    'special-pressure':  '送加压',
    'special-monoFlush': '送同花',   /* L2 注入路径，同义同色 */
};

/**
 * v1.59.18：blockSpawn reason 的详细解释（tooltip + 底部 legend 共用，~12-30 字）。
 * v1.59.19：标签语义直白化（用户反馈"主消行/加权选"看不懂）—— SPAWN_REASON_CN 改为
 * 含动作的"送消行/送清屏/综合选/兜底块"，并在 dfv-foot legend 一次性展示 4 种 reason 解释。
 */
const SPAWN_REASON_TIP = {
    clear:        '送消行：本块放下后能直接消 1+ 行（消行候选优先路径）',
    perfectClear: '送清屏：本块能促成全盘清空（perfectClear 候选优先路径，特殊块·100%优先）',
    monoFlush:    '送同花：本块可凑同花顺消除——放下后整行/列同 icon，触发 ×5 倍 iconBonus 大奖（特殊块·25%彩蛋节流）',
    weighted:     '综合选：5 hints + 6 targets + 4 schedule 多维加权抽选（主流路径）',
    fallback:     '兜底块：主路径 22 次重试都不满足存活约束，降级使用（少见）',
    'special-relief':    '送减压：reliefSignal 触发（清盘准备/高填补缝/有空洞），从独立池注入 1x2/1x3/L 块',
    'special-pressure':  '送加压：pressureSignal 触发（pressure/sprint 意图 + 低 fill + 少空洞），从独立池注入 diag-2/3 散点块',
    'special-monoFlush': '送同花：盘面有近满同色 line（empty≤2 且预填全同 icon），从独立池注入方向匹配的 1x2/2x1 → 补满即触发 ×5 倍 iconBonus',
};

/** v1.51.3：spawnTargets 6 个目标维度的中文标签（adaptiveSpawn.js 中定义） */
const SPAWN_TARGET_CN = {
    shapeComplexity:      '形状复杂度',
    solutionSpacePressure:'解空间压力',
    clearOpportunity:     '消行机会',
    spatialPressure:      '空间压力',
    payoffIntensity:      '兑现强度',
    novelty:              '新奇度',
};

/** v1.51.3：spawnHints 关键调度参数中文标签 */
const HINT_CN = {
    clearGuarantee:  '保消档',
    sizePreference:  '尺寸偏好',
    orderRigor:      '顺序刚性',
    diversityBoost:  '多样性',
    comboChain:      '连击链',
    pacingPhase:     '松紧期',
    rhythmPhase:     '节奏相位',
    sessionArc:      '会话弧线',
    delightMode:     '愉悦模式',
    multiClearBonus: '多消加成',
    perfectClearBoost:'清屏加成',
    iconBonusTarget: '同色 bonus',
    motivationIntent:'动机',
    behaviorSegment: '行为分组',
};

/** 压力驱动策略分量（基于 adaptiveSpawn spawnHints 实际字段） */
const STRATEGY_COMPONENT_DEFS = [
    { key: 'clearGuarantee', label: '保消', color: '#22d3ee', norm: (v) => Number.isFinite(v) ? _clamp(v / 3, 0, 1) : 0.2, display: (v) => Number.isFinite(v) ? v.toFixed(2) : '—' },
    { key: 'sizePreference', label: '尺寸', color: '#a78bfa', norm: (v) => Number.isFinite(v) ? Math.min(1, Math.abs(v)) : 0.15, display: (v) => Number.isFinite(v) ? v.toFixed(2) : '—' },
    { key: 'orderRigor', label: '刚性', color: '#f59e0b', norm: (v) => Number.isFinite(v) ? _clamp(v, 0, 1) : 0.1, display: (v) => Number.isFinite(v) ? v.toFixed(2) : '—' },
    { key: 'diversityBoost', label: '多样', color: '#10b981', norm: (v) => Number.isFinite(v) ? _clamp(v, 0, 1) : 0.08, display: (v) => Number.isFinite(v) ? v.toFixed(2) : '—' },
    { key: 'comboChain', label: '连击', color: '#38bdf8', norm: (v) => Number.isFinite(v) ? _clamp(v, 0, 1) : 0.08, display: (v) => Number.isFinite(v) ? v.toFixed(2) : '—' },
];
const STRATEGY_COMPONENT_KEYS = new Set(STRATEGY_COMPONENT_DEFS.map((d) => d.key));

/**
 * v1.59.13：每个策略分量的"主驱动信号"集合，**按代码事实**取自 adaptiveSpawn.js 中
 * 该 hint 实际读取的 ctx/profile 字段（L1706-2130 + L445-475 deriveComboChain）。
 *
 * 用途：在 DFV 球状图为每个分量节点向其 driver 信号节点画弱虚线，让用户**看见**
 * "5 分量 也是从信号集派生的"（v1.59.12 漏画导致 5 分量视觉孤立，描述与实际不符）。
 *
 * 取舍：源码 50+ Math.max 路径无法逐一可视化，只保留每分量 3-4 个"高显著度"驱动信号，
 * 让连线密度在可读范围（5 × 3.5 ≈ 17 条），且每根都对应真实代码路径。
 *
 * 不变式：本映射的每个 (hint, signalKey) 对，都必须能在 adaptiveSpawn.js 中找到至少
 * 一条 if-branch 同时读取 signalKey 对应的 ctx 字段并改写 hint（由文档治理保证）。
 */
const HINT_DRIVER_SIGNALS = {
    /* clearGuarantee 在 hadRecentNearMiss / frustrationLevel / needsRecovery / momentum 负值 /
     * recentMisses / cognitiveLoad 等场景被 Math.max 拉高 → 挫败/动量/失放率/负荷 4 路。 */
    clearGuarantee: ['frust', 'momentum', 'missRate', 'load'],
    /* sizePreference 在 frustration / needsRecovery / topo onset / boardLoad 等场景被 Math.min 压低 →
     * 挫败/动量/负荷 3 路。 */
    sizePreference: ['frust', 'momentum', 'load'],
    /* orderRigor 在 flowState='bored' 五重 bypass、frustration、cognitiveLoad 等场景被 reset/调整 →
     * 心流/负荷/挫败 3 路。 */
    orderRigor: ['flow', 'load', 'frust'],
    /* diversityBoost 在 flow='bored'、cognitiveLoad、missRate 等场景被 Math.max 拉高 →
     * 心流/负荷/失放率 3 路。 */
    diversityBoost: ['flow', 'load', 'missRate'],
    /* comboChain = deriveComboChain(ctx, profile) 读 lastClearCount + recentComboStreak，
     * 经验上还受 skill / momentum 隐含影响（streak 形成依赖技能稳定与正动量）→ 连击/技能/动量 3 路。 */
    comboChain: ['combo', 'skill', 'momentum'],
};

/**
 * v1.59.13：spawnIntent 的"主驱动信号"集合，按代码事实取自 intentResolver.js INTENT_RULES。
 *
 * 各 intent 的 guard 读取字段：
 *   relief:   playerDistress（由 frustrationLevel 派生）/ delightMode / forceReliefIntent  → frust
 *   harvest:  geometry.boardFill / nearFullLines / pcSetup                                  → boardFill
 *   pressure: challengeBoost / delightMode / stress（自身派生，跳过）                       → boardFill(高填充触发)
 *   sprint:   stress（自身派生，跳过）+ sprintCfg                                          → (无外部信号)
 *   flow:     delightMode='flow_payoff' / rhythmPhase（由 flowState 派生）                  → flow
 *   maintain: 兜底
 *
 * 简化为：意图 ← 挫败 / 占盘 / 心流 / 阶段 / 动量 5 路（覆盖主要触发场景的底层信号）。
 */
const INTENT_DRIVER_SIGNALS = ['frust', 'boardFill', 'flow', 'session', 'momentum'];

/**
 * v1.59.15：spawnTargets 6 维的定义（与 SPAWN_TARGET_CN 同源 + 颜色 + 归一化）。
 *
 * 6 维目标向量由 `adaptiveSpawn.deriveSpawnTargets(stress, profile, ctx, fill, boardRisk, delight)`
 * 输出（L404-432），是"5 分量 + delight 调度"之后、`spawnHints` 内的另一层向量化目标，
 * 供 blockSpawn 在评估候选形状时做加权打分。
 */
const SPAWN_TARGET_DEFS = [
    { key: 'shapeComplexity',       label: '复杂', color: '#f87171', baseColor: '#f87171' },
    { key: 'solutionSpacePressure', label: '解空', color: '#fb923c', baseColor: '#fb923c' },
    { key: 'clearOpportunity',      label: '消机', color: '#22d3ee', baseColor: '#22d3ee' },
    { key: 'spatialPressure',       label: '空间', color: '#a78bfa', baseColor: '#a78bfa' },
    { key: 'payoffIntensity',       label: '兑现', color: '#10b981', baseColor: '#10b981' },
    { key: 'novelty',               label: '新奇', color: '#f472b6', baseColor: '#f472b6' },
];

/**
 * v1.59.15：spawnTargets 6 维的"主驱动信号"集合，按 adaptiveSpawn.deriveSpawnTargets 实际公式：
 *   shapeComplexity = stress01*0.75 + boredHighSkill(skill,flow)*0.25 - riskRelief(frust)*0.45
 *   solutionSpacePressure = stress01*0.7 + shapeComplexity*0.25 - boardRisk(load)*0.55 - recoveryNeed(frust)*0.35
 *   clearOpportunity = recoveryNeed(frust)*0.55 + payoffOpportunity(boardFill,nearFull)*0.45 - stress01*0.18
 *   spatialPressure = stress01*0.65 + boardDifficulty(boardFill)*0.25 - boardRisk(load)*0.5 - recoveryNeed(frust)*0.3
 *   payoffIntensity = delight.multiClearBoost*0.45 + payoffOpportunity(boardFill)*0.4 + max(0,momentum)*0.15
 *   novelty = (flow==='bored'?0.45:0) + stress01*0.25 + totalRounds(session)/80 - recoveryNeed(frust)*0.2
 *
 * 每维取 2-3 个最显著驱动信号，保持画面密度可读。
 */
const SPAWN_TARGET_DRIVER_SIGNALS = {
    shapeComplexity:       ['skill', 'frust'],
    solutionSpacePressure: ['frust', 'load'],
    clearOpportunity:      ['frust', 'boardFill'],
    spatialPressure:       ['boardFill', 'load'],
    payoffIntensity:       ['momentum', 'boardFill'],
    novelty:               ['flow', 'session'],
};

/**
 * v1.59.15：调度参数 4 个的定义（multiClear/multiLine/perfectClear/iconBonus），与 HINT_CN 同源。
 *
 * 这是 spawnHints 顶层的"调度强化"参数，由独立 derive 函数计算：
 *   multiClearBonus   = deriveMultiClearBonus(ctx, fill)   L459-478（max delight.multiClearBoost）
 *   multiLineTarget   = deriveMultiLineTarget(ctx, fill)   L528-540
 *   perfectClearBoost = delight.perfectClearBoost          L～1660（由 deriveDelightTuning 派生）
 *   iconBonusTarget   = motivation/behavior 驱动           L～1900
 */
const SCHEDULE_PARAM_DEFS = [
    /* v1.60.12：调度节点 tip 字段——SVG <title> 用，说明语义 + "何时被点亮"，
     * 解决用户反馈"调度层信号用上了吗？图标指标什么意思"——按 driver_node_paths.schedule
     * 路径，schedule 仅当本轮 chosen 主因 ∈ {multiClear, pcPotential} 才会被 union 高亮覆盖；
     * 同色 bonus 影响 dock **颜色**（不影响形状评分），不通过 chosen.topDriver 暴露，所以
     * 在 union 模式下基本始终暗。iconBonusTarget label 从误导的"图标"改为"同色"。 */
    { key: 'multiClearBonus',   label: '多消', color: '#fcd34d', baseColor: '#fcd34d', norm: (v) => _clampSafe(v, 0, 1),     display: (v) => Number.isFinite(v) ? v.toFixed(2) : '—',
      tip: '多消加成 — 提升 multiClear≥2 候选权重；本轮 chosen 主因含「可消N行（N≥2）」时点亮' },
    { key: 'multiLineTarget',   label: '多线', color: '#fb923c', baseColor: '#fb923c', norm: (v) => _clampSafe(v / 2, 0, 1), display: (v) => Number.isFinite(v) ? v.toFixed(0) : '—',
      tip: '多线目标 — 期望同时消除的行/列数；与多消加成同源，跟随 chosen 「可消N行（N≥2）」点亮' },
    { key: 'perfectClearBoost', label: '清屏', color: '#c084fc', baseColor: '#c084fc', norm: (v) => _clampSafe(v, 0, 1),     display: (v) => Number.isFinite(v) ? v.toFixed(2) : '—',
      tip: '清屏加成 — 提升 pcPotential 候选权重；本轮 chosen 主因「可清屏」时点亮' },
    { key: 'iconBonusTarget',   label: '同色', color: '#ec4899', baseColor: '#ec4899', norm: (v) => _clampSafe(v, 0, 1),     display: (v) => Number.isFinite(v) ? v.toFixed(2) : '—',
      tip: '同色/同 icon bonus — 影响 dock **颜色权重**（非形状），让 dock 颜色更易补齐近满行列；颜色路径不通过 chosen 主因暴露，union 高亮下通常保持暗（设计正确）' },
];

/**
 * v1.59.15：4 调度参数的"主驱动信号"集合，按 adaptiveSpawn.js 实际派生：
 *   multiClearBonus   ← ctx.{roundsSinceClear, nearFullLines, pcSetup} + fill         → boardFill + clearRate
 *   multiLineTarget   ← ctx.{pcSetup, nearFullLines, lastClearCount} + fill           → boardFill + combo
 *   perfectClearBoost ← deriveDelightTuning(skill, momentum, flow, pacing, frust)     → skill + flow
 *   iconBonusTarget   ← motivationIntent + behaviorSegment（与 session/playstyle 相关）→ session + skill
 */
const SCHEDULE_PARAM_DRIVER_SIGNALS = {
    multiClearBonus:   ['boardFill', 'clearRate'],
    multiLineTarget:   ['boardFill', 'combo'],
    perfectClearBoost: ['skill', 'flow'],
    iconBonusTarget:   ['session', 'skill'],
};

/**
 * v1.59.21 方案 C / v1.60.13 补 relief/pressure：driver → 派生节点路径映射（反向追溯高亮）。
 *
 * 给定 chosen.topDriver.key（由 blockSpawn._estimateTopDriver 输出 或 _tryInjectSpecial
 * 注入路径直接赋值），返回该 driver 应该指向的"派生节点 keys 集合"。Hover chosen 节点时，
 * DFV 反向高亮这些派生节点 + 它们的上游信号节点（通过 HINT_DRIVER_SIGNALS /
 * SPAWN_TARGET_DRIVER_SIGNALS / SCHEDULE_PARAM_DRIVER_SIGNALS / INTENT_DRIVER_SIGNALS
 * 自动扩展），其余节点淡出到 0.22 opacity，让玩家看到"信号 → 派生 → 此 chosen"的因果链。
 *
 * 映射依据：driver key 实际产出位置 ↔ 真实代码路径所消费的 hint / target / schedule 字段。
 *
 * **常规 scoreShape 路径**（_estimateTopDriver 输出）：
 *   pcPotential   → scoreShape ×18 perfectClearBoost & intent（送清屏路径走 intent gate）
 *   multiClear    → scoreShape ×2.0-2.7 multiClearBonus + multiLineTarget
 *   gapFills      → scoreShape ×nearFullFactor strategy.clearGuarantee + target.clearOpportunity
 *   holeReduce    → scoreShape ×0.4 strategy.clearGuarantee + target.spatialPressure
 *   mobility      → scoreShape placements 加权 + strategy.diversityBoost + target.solutionSpacePressure/novelty
 *   shapeWeight   → scoreShape weight 主乘项 strategy.sizePreference + target.shapeComplexity
 *   balanced      → 无单一主因 → 全 5 派生层 + 全信号微亮（'*'）
 *   fallback      → 主路径不通 → 仅 chosen 自身高亮（空集）
 *
 * **_tryInjectSpecial 注入路径**（v1.60.13 新增）：
 *   relief        → 减压注入（intent='relief'）。代码事实（blockSpawn.js line 1139-1180+1329）：
 *                   触发条件读 pcSetup / nearFullLines / fill+holesSignal、replace slot 选最低分槽，
 *                   slot 偏向把 shape 换成小直线/L角形以"送消行 + 同色 bonus 兜底"。
 *                   消费派生节点：
 *                     strategy.clearGuarantee  ←  减压本质是保消 + 救济
 *                     strategy.sizePreference  ←  减压偏小块（slot 换成 1x2/l3）
 *                     target.clearOpportunity  ←  near-full 救济触发条件
 *                     schedule.multiClearBonus ←  送消行加成
 *                     schedule.iconBonusTarget ←  同色 bonus 让 dock 颜色补齐
 *                     intent: true             ←  intent='relief'
 *   pressure      → 加压注入（intent='pressure' / 'sprint'）。代码事实（同 _tryInjectSpecial）：
 *                   触发条件读 stress + intent + fill 中段，slot 换成 diag-3a/diag-2 等造孤岛形。
 *                   消费派生节点：
 *                     strategy.sizePreference   ←  加压偏复杂/大块
 *                     strategy.diversityBoost   ←  鼓励多样形态
 *                     target.spatialPressure    ←  加压空间难度
 *                     target.shapeComplexity    ←  加压偏复杂
 *                     target.solutionSpacePressure ←  缩窄解空间
 *                     schedule.multiLineTarget  ←  更高多线目标
 *                     intent: true              ←  intent='pressure' / 'sprint'
 *
 * **不变式**：每个 driver key 在本表里必须有显式条目（即使为空），否则会 fallback 到
 * balanced（全亮 5 层），让"原本应精确点亮 2-3 节点"的 driver 视觉信息量稀释。新增
 * driver key 须同步本表 + tests/decisionFlowVizDriverPaths.test.js 覆盖。
 */
const DRIVER_NODE_PATHS = {
    pcPotential: { strategy: [],                                 targets: [],                                                              schedule: ['perfectClearBoost'],                       intent: true },
    multiClear:  { strategy: [],                                 targets: [],                                                              schedule: ['multiClearBonus', 'multiLineTarget'],      intent: false },
    gapFills:    { strategy: ['clearGuarantee'],                 targets: ['clearOpportunity'],                                            schedule: [],                                          intent: false },
    holeReduce:  { strategy: ['clearGuarantee'],                 targets: ['spatialPressure'],                                             schedule: [],                                          intent: false },
    mobility:    { strategy: ['diversityBoost'],                 targets: ['solutionSpacePressure', 'novelty'],                            schedule: [],                                          intent: false },
    shapeWeight: { strategy: ['sizePreference'],                 targets: ['shapeComplexity'],                                             schedule: [],                                          intent: false },
    balanced:    { strategy: '*',                                targets: '*',                                                             schedule: '*',                                         intent: true },
    fallback:    { strategy: [],                                 targets: [],                                                              schedule: [],                                          intent: false },
    /* v1.60.13：_tryInjectSpecial 注入路径的两个硬编码 driver key */
    relief:      { strategy: ['clearGuarantee', 'sizePreference'],         targets: ['clearOpportunity'],                                  schedule: ['multiClearBonus', 'iconBonusTarget'],      intent: true },
    pressure:    { strategy: ['sizePreference', 'diversityBoost'],         targets: ['spatialPressure', 'shapeComplexity', 'solutionSpacePressure'], schedule: ['multiLineTarget'],                 intent: true },
    /* v1.60.18：exactFit 完美卡入路径——shape 几何精确嵌入凹槽。
     * 真实因果链：盘面拓扑提供凹槽（spatialPressure 派生） + 形状契合（shapeComplexity）+
     * 局部紧凑（sizePreference 偏紧凑块），不消行也是局部最优决策。 */
    exactFit:    { strategy: ['sizePreference'],                            targets: ['spatialPressure', 'shapeComplexity'],                schedule: [],                                          intent: false },
    /* v1.60.19：monoFlush 同花顺消除路径——shape 能补满已填同 icon 行/列。
     * 真实因果链：盘面拓扑提供"已填同色近满 line"（clearOpportunity 派生）+
     * 调度参数 iconBonusTarget 强化（×5 倍 iconBonus 得分）+ 染色阶段
     * monoNearFullLineColorWeights 双向锁定颜色匹配。 */
    monoFlush:   { strategy: ['clearGuarantee'],                            targets: ['clearOpportunity'],                                  schedule: ['iconBonusTarget'],                         intent: false },
};

/* v1.59.15：内部安全 clamp（与 _clamp 同语义，常量定义时 _clamp 尚未引入作用域，用本地副本） */
function _clampSafe(v, lo, hi) {
    if (!Number.isFinite(v)) return lo;
    return Math.max(lo, Math.min(hi, v));
}

/**
 * v1.59.17：把 shape id（如 'L_horizontal' / 'rect_2x3' / 'T_up'）压缩为 ≤3 字节点显示文本。
 *
 * 规则（优先级）：
 *   1. 'rect_2x3' / 'rect_2x4' 等 → 'R23' / 'R24'（取尺寸数字）
 *   2. 'L_horizontal' / 'T_up' 等 → 取首字母 + 方向首字符（'Lh' / 'Tu'）
 *   3. 默认 → id 前 3 字大写
 */
/**
 * v1.59.18：shape id → 可读紧凑简写（≤4 字符，节点下方居中显示）。
 *
 * 代码事实：shared/shapes.json 实际 id 命名规律：
 *   - lines:   '1x4' / '4x1' / '1x5' / '5x1'                   → '1×4' '4×1' '1×5' '5×1'
 *   - rects:   '2x3' / '3x2'                                   → '2×3' '3×2'
 *   - squares: '2x2' / '3x3'                                   → '2×2' '3×3'
 *   - tshapes: 't-up' / 't-down' / 't-left' / 't-right'        → 'T↑' 'T↓' 'T←' 'T→'
 *   - zshapes: 'z-h' / 'z-h2' / 'z-v' / 'z-v2'                 → 'Z横' 'Z横2' 'Z竖' 'Z竖2'
 *   - lshapes: 'l-1'..'l-4' / 'l5-a' / 'l5-b'                  → 'L1'..'L4' 'L5a' 'L5b'
 *   - jshapes: 'j-1'..'j-4'                                    → 'J1'..'J4'
 *
 * 完整简写（保留方向/序号/尺寸）让玩家一眼能在 mini grid 缩略图 + 简写之间互相确认。
 */
/**
 * v1.59.18：在 chosen 节点核心位置绘制 shape 的 5×5 mini grid 缩略图（关键解释手段）。
 *
 * - 输入 shape.data 是 H×W 0/1 二维矩阵，最大可达 5×5（如 1×5/5×1 直线、l5-a/l5-b 等）
 * - 输出在 (cx, cy) 为中心的 mini grid，cell 边长按 baseR 自适应缩放，整体居中
 * - cell=1：彩色填充（category color），cell=0：暗灰描边占位（便于看出原 shape bbox）
 * - DOM 复用：用 .innerHTML='' 清空旧 grid，然后批量 append（每帧 ≤25 个 rect，开销极小）
 *
 * 这是 v1.59.18 用户反馈"出块结果缺乏解释，无法理解"的核心修复 —— 之前 'L1' / 'T↑'
 * 等文字简写信息密度太低，玩家无法在 0.3 秒内识别"这是什么形状"。mini grid 把
 * shape.data 直接画出来，与 dock 上玩家实际看到的块视觉一致，理解成本降到接近 0。
 *
 * @param {SVGGElement|null} gridG - 容器 g（buildScene 已创建，data-cx/data-cy 含中心点）
 * @param {{data: number[][]}|null} shape - getShapeById 返回的 shape 对象；null 则清空
 * @param {number} baseR - chosen 节点半径（决定 mini grid 整体尺寸）
 * @param {string} color - cell=1 的填充色（按 category 取）
 */
function _renderChosenMiniGrid(gridG, shape, baseR, color) {
    if (!gridG) return;
    while (gridG.firstChild) gridG.removeChild(gridG.firstChild);
    if (!shape?.data?.length) return;
    const cx = Number(gridG.getAttribute('data-cx')) || 0;
    const cy = Number(gridG.getAttribute('data-cy')) || 0;
    const data = shape.data;
    const h = data.length;
    const w = Math.max(...data.map(r => r.length));
    /* 整体框边长：baseR * 1.5（适配 r=15..19） */
    const frame = baseR * 1.45;
    const cell = frame / Math.max(h, w, 5) * 0.95;
    const gridW = cell * w;
    const gridH = cell * h;
    const startX = cx - gridW / 2;
    const startY = cy - gridH / 2;
    const ns = 'http://www.w3.org/2000/svg';
    const filled = color || '#7dd3fc';
    const darkFill = _hexToRgba(filled, 0.85);
    for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
            const v = data[r][c];
            const rect = document.createElementNS(ns, 'rect');
            rect.setAttribute('x', (startX + c * cell + 0.4).toFixed(2));
            rect.setAttribute('y', (startY + r * cell + 0.4).toFixed(2));
            rect.setAttribute('width', (cell - 0.8).toFixed(2));
            rect.setAttribute('height', (cell - 0.8).toFixed(2));
            rect.setAttribute('rx', '0.6');
            if (v) {
                rect.setAttribute('fill', darkFill);
                rect.setAttribute('stroke', filled);
                rect.setAttribute('stroke-width', '0.5');
            } else {
                rect.setAttribute('fill', 'rgba(148,163,184,0.05)');
                rect.setAttribute('stroke', 'rgba(148,163,184,0.18)');
                rect.setAttribute('stroke-width', '0.4');
                rect.setAttribute('stroke-dasharray', '0.6 0.6');
            }
            gridG.appendChild(rect);
        }
    }
}

/** v1.59.18：hex (#rrggbb) → rgba 字符串，用于 mini grid cell 半透明填充 */
function _hexToRgba(hex, alpha) {
    if (typeof hex !== 'string' || !hex.startsWith('#') || hex.length < 7) {
        return `rgba(125,211,252,${alpha})`;
    }
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
}

function _summarizeShapeId(id) {
    if (typeof id !== 'string' || !id) return '—';
    const sizeMatch = id.match(/^(\d)x(\d)$/i);
    if (sizeMatch) return `${sizeMatch[1]}×${sizeMatch[2]}`;
    const tDir = id.match(/^t-(up|down|left|right)$/i);
    if (tDir) {
        const map = { up: '↑', down: '↓', left: '←', right: '→' };
        return `T${map[tDir[1].toLowerCase()] || '?'}`;
    }
    /* v1.60.0 新形状：斜线 diag-2a/b / diag-3a/b → "⤢2↗/⤢3↘"（≤3 字符可读） */
    const diag = id.match(/^diag-(\d)([ab])$/i);
    if (diag) {
        const arrow = diag[2].toLowerCase() === 'a' ? '↗' : '↘';
        return `⤢${diag[1]}${arrow}`;
    }
    /* v1.60.0 新形状：3 格 L 角 l3-a/b/c/d → "L3↘/L3↙/L3↗/L3↖" */
    const l3 = id.match(/^l3-([abcd])$/i);
    if (l3) {
        const arrowMap = { a: '↘', b: '↙', c: '↗', d: '↖' };
        return `L3${arrowMap[l3[1].toLowerCase()] || '?'}`;
    }
    const zVar = id.match(/^z-(h|v)(2?)$/i);
    if (zVar) return `Z${zVar[1].toLowerCase() === 'h' ? '横' : '竖'}${zVar[2] || ''}`;
    const ljShort = id.match(/^([lj])-(\d)$/i);
    if (ljShort) return `${ljShort[1].toUpperCase()}${ljShort[2]}`;
    const lj5 = id.match(/^([lj])5-([ab])$/i);
    if (lj5) return `${lj5[1].toUpperCase()}5${lj5[2].toLowerCase()}`;
    return id.length <= 4 ? id : id.slice(0, 4);
}

/**
 * v1.59.18：把 blockSpawn diagnostics.chosen[].reason 翻译为完整中文标签
 * （节点上方居中显示，≤4 字）。未命中字典时退回原始字串（截断 4 字符）。
 *
 * v1.59.17 旧版有 split('+').slice(0,4) 截断逻辑——已废弃，因为 blockSpawn 写入
 * 的 reason 不含 '+' 复合形式（详见 SPAWN_REASON_CN 字典 JSDoc）。
 */
function _summarizeReason(reason) {
    if (typeof reason !== 'string' || !reason) return '';
    if (SPAWN_REASON_CN[reason]) {
        /* v1.60.29：特殊块（清屏/同花）reason 前加 ★ 强化体感，让玩家一眼识别 */
        const cn = SPAWN_REASON_CN[reason];
        const isSpecial = reason === 'perfectClear' || reason === 'monoFlush'
                       || reason === 'special-monoFlush';
        return isSpecial ? `★${cn}` : cn;
    }
    return reason.length <= 4 ? reason : reason.slice(0, 4);
}

/** v1.51.3：sparkline 中文标签（5 路时间序列） */
const SPARK_LABEL_CN = {
    stress:    '压力',
    momentum:  '动量',
    clearRate: '消行率',
    boardFill: '占盘',
    frust:     '挫败',
};

/** stressBreakdown key → 视觉左列锚定的源节点 key（粗略归类） */
const BREAKDOWN_TO_SOURCE = {
    scoreStress: 'session',
    runStreakStress: 'session',
    difficultyBias: 'skill',
    skillAdjust: 'skill',
    flowAdjust: 'flow',
    reactionAdjust: 'load',
    pacingAdjust: 'session',
    recoveryAdjust: 'frust',
    frustrationRelief: 'frust',
    comboAdjust: 'combo',
    nearMissAdjust: 'clearRate',
    feedbackBias: 'momentum',
    trendAdjust: 'momentum',
    sessionArcAdjust: 'session',
    endSessionDistress: 'momentum',
    challengeBoost: 'session',
    holeReliefAdjust: 'boardFill',
    boardRiskReliefAdjust: 'boardFill',
    abilityRiskAdjust: 'skill',
    lifecycleCapAdjust: 'session',
    lifecycleBandAdjust: 'session',
    onboardingStressOverrideAdjust: 'session',
    winbackStressCapAdjust: 'session',
    clampAdjust: 'session',
    smoothingAdjust: 'session',
    minStressFloorAdjust: 'skill',
    flowPayoffCapAdjust: 'flow',
    delightStressAdjust: 'flow',
    friendlyBoardRelief: 'frust',
    bottleneckRelief: 'load',
    motivationStressAdjust: 'session',
    accessibilityStressAdjust: 'load',
    returningWarmupAdjust: 'session',
    /* v1.55 §4.9：postPbRelease 是 score 主线信号，源节点归 'session' */
    postPbReleaseStressAdjust: 'session',
};

/** sparkline 时间序列：每帧采样这些字段 */
const SPARK_SERIES = [
    /* v1.55.17：stress 对外归一化为 [0, 1]（详见 adaptiveSpawn.js normalizeStress JSDoc） */
    { key: 'stress',     label: 'stress',    color: '#22d3ee', range: [0, 1.0],    format: (v) => v.toFixed(2) },
    { key: 'momentum',   label: 'momentum',  color: '#a78bfa', range: [-1, 1],     format: (v) => v.toFixed(2) },
    { key: 'clearRate',  label: 'clearRate', color: '#10b981', range: [0, 0.6],    format: (v) => v.toFixed(2) },
    { key: 'boardFill',  label: 'boardFill', color: '#fbbf24', range: [0, 1],      format: (v) => v.toFixed(2) },
    { key: 'frust',      label: 'frust',     color: '#ef4444', range: [0, 8],      format: (v) => Math.round(v).toString() },
];
const SPARK_BUFFER_LEN = 240;

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  色阶 / 缓动 / 几何工具                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** 蓝 → 绿 → 黄 → 红热力色阶；t ∈ [0,1]。 */
function heatColor(t) {
    const c = Math.max(0, Math.min(1, t));
    if (c < 0.33) return _lerpRGB([56, 189, 248], [16, 185, 129], c / 0.33);
    if (c < 0.66) return _lerpRGB([16, 185, 129], [251, 191, 36], (c - 0.33) / 0.33);
    return _lerpRGB([251, 191, 36], [239, 68, 68], (c - 0.66) / 0.34);
}

function _lerpRGB(a, b, t) {
    const r = Math.round(a[0] + (b[0] - a[0]) * t);
    const g = Math.round(a[1] + (b[1] - a[1]) * t);
    const bl = Math.round(a[2] + (b[2] - a[2]) * t);
    return `rgb(${r},${g},${bl})`;
}

function approach(curr, target, decay = 0.18) {
    if (!Number.isFinite(curr)) return target;
    return curr + (target - curr) * decay;
}

function bezierPoint(p0, p1, p2, t) {
    const u = 1 - t;
    return {
        x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    };
}

function bezierPath(p0, p1, p2) {
    return `M${p0.x.toFixed(1)},${p0.y.toFixed(1)} Q${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
}

function _readDeep(obj, path) {
    let cur = obj;
    for (const k of path) {
        if (cur == null) return null;
        cur = cur[k];
    }
    return cur;
}

function _shadeColor(rgbStr, percent) {
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(rgbStr);
    if (!m) return rgbStr;
    const f = (v) => Math.max(0, Math.min(255, Math.round(+v * (1 + percent / 100))));
    return `rgb(${f(m[1])},${f(m[2])},${f(m[3])})`;
}

function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* ═══════════════════════════════════════════════════════════════════════════ */
/*  主类                                                                         */
/* ═══════════════════════════════════════════════════════════════════════════ */

/* v1.55.1 专项性能优化（DFV）：
 *
 * 历史问题：打开决策数据流面板时 Chrome Helper GPU 占用飙到 ~75% / CPU ~60%，
 * 原因是 _loop() 用 rAF 直驱 ~60fps、每帧重写所有 SVG attribute、Canvas 粒子
 * 每个 trail 都 fill shadowBlur=12、_edgeFlowPhase 持续推进让所有 stroke-dashoffset
 * 永不静止、卡片背景 backdrop-filter:blur(10px) 让浏览器对底下棋盘 canvas 持续合成。
 *
 * 本次优化（不改产品语义）：
 *   - rAF 三档自适应频率（active 30fps / idle 6fps / paused 0），见 _scheduleNext
 *   - 数据指纹去抖（DfvInsightFingerprint），相同指纹的 tick 跳过 SVG 重渲染
 *   - _edgeFlowPhase 仅在 active（有粒子或新数据）时推进，idle 静止
 *   - Canvas 粒子去 shadowBlur，trail 5→3，上限 96→64，粒子缓存预渲染贴图
 *   - 折叠态（.dfv-collapsed）/ tab 隐藏 / DFV 被遮挡时彻底暂停主循环
 *   - 卡片 backdrop-filter 去除（与 docs/engineering/PERFORMANCE.md §1.1 规约一致）
 */
const DFV_FPS_ACTIVE = 30;
const DFV_FPS_IDLE = 6;
const DFV_FRAME_MS_ACTIVE = 1000 / DFV_FPS_ACTIVE;
const DFV_FRAME_MS_IDLE = 1000 / DFV_FPS_IDLE;
const DFV_IDLE_AFTER_MS = 1200;   // 距上次 active 信号超过这段时间，转入 idle
const DFV_PARTICLE_CAP = 64;       // 96 → 64
const DFV_TRAIL_COUNT = 3;         // 5 → 3

/**
 * 计算 insight 关键字段的低成本指纹；用于跳过相同数据的 SVG 重写。
 * 取整后拼接，可避免浮点噪声引起的伪变化。
 * @param {any} insight
 * @param {any} profile
 * @returns {string}
 */
/**
 * v1.55.2 SVG attribute 差异写入 helper：
 *
 * SVG `setAttribute` 即便值与现值相同，浏览器仍会把该节点标 dirty 进入下一帧的
 * style recalc / layout 流水线（在大量节点频繁更新场景下成本不可忽视）。在 DFV
 * active 30fps 持续推流时，多数 attribute 帧间不变，差异写入可显著降低 DOM 工作量。
 *
 * 实现：用 WeakMap 给每个 SVG element 挂一个 attribute → lastValue 字典；
 * 写入前先比较，相同则跳过。
 */
const _dfvAttrCache = new WeakMap();
function _setAttrIfChanged(el, key, value) {
    if (!el) return;
    const str = typeof value === 'string' ? value : String(value);
    let dict = _dfvAttrCache.get(el);
    if (!dict) {
        dict = Object.create(null);
        _dfvAttrCache.set(el, dict);
    }
    if (dict[key] === str) return;
    dict[key] = str;
    el.setAttribute(key, str);
}

/**
 * v1.57.5 §A/F：DFV 渲染去抖指纹。
 *
 * 历史 bug（用户截图复现）：
 *   - 左侧"占盘"信号节点显示 0.40（spawn 决策时的快照），
 *   - 底部"占盘"sparkline 同时显示 0.69（实时 grid fill），
 *   - "消行率"同样两处不一致（— vs 0.31）。
 *
 * 根因：旧指纹只看 insight + profile 的"决策侧"字段（stress / intent /
 * breakdown / momentum / frust / flowState / sessionPhase），漏算了 liveBoardFill
 * 与 liveClearRate 这两个"实时几何"信号。玩家落子后 grid.fill 从 0.40 变到 0.69，
 * 但 stress / spawnIntent 等 dock 周期内不变，指纹不变 → 左侧节点被去抖跳过刷新；
 * 而 sparkline 每 tick 都采样+渲染，导致两处数字脱节。
 *
 * 修复：把 liveBoardFill / liveClearRate 也纳入指纹（同样按 0.01 量化），
 * 让任一实时几何变化都触发节点重绘，与 sparkline 同源同步。
 *
 * @param {object} insight  game._lastAdaptiveInsight 决策快照
 * @param {object} profile  game.playerProfile
 * @param {object} [live]   实时几何快照（v1.57.5 新增）：{ boardFill, clearRate }
 */
function _dfvFingerprint(insight, profile, live) {
    if (!insight && !profile && !live) return 'empty';
    const i = insight || {};
    const p = profile || {};
    const b = i.stressBreakdown || {};
    const h = i.spawnHints || {};
    const lv = live || {};
    /* 关键字段：stress 0.01、intent / hints 标志、breakdown 各项取 0.01 */
    const round = (v) => Number.isFinite(v) ? Math.round(v * 100) : 'x';
    const parts = [
        round(i.stress),
        h.spawnIntent ?? i.spawnIntent ?? '',
        i.scoreMilestoneHit ? 1 : 0,
        i.afkEngageActive ? 1 : 0,
        h.winbackProtectionActive ? 1 : 0,
        round(p.momentum),
        round(p.frustrationLevel),
        p.flowState ?? '',
        p.sessionPhase ?? '',
        // v1.57.5 §A/F：实时几何信号纳入指纹，确保左列节点与底部 sparkline 同源刷新
        `live.fill:${round(lv.boardFill)}`,
        `live.cr:${round(lv.clearRate)}`,
    ];
    for (const k of Object.keys(b)) parts.push(`${k}:${round(b[k])}`);
    /* v1.59.17：阶段③ chosen 纳入指纹——blockSpawn 重新 spawn 后 chosen[] 变化（id/reason），
     * 即便 stress/intent 未变化（极少见但发生），DFV 也应重渲染 chosen 节点行。 */
    const diag = i.spawnDiagnostics;
    if (diag && Array.isArray(diag.chosen)) {
        for (let k = 0; k < diag.chosen.length; k++) {
            const c = diag.chosen[k];
            parts.push(`c${k}:${c?.id ?? ''}|${c?.reason ?? ''}`);
        }
        parts.push(`atk:${diag.attempt ?? 0}`);
    }
    return parts.join('|');
}

class DecisionFlowViz {
    constructor() {
        this._game = null;
        this._host = null;
        this._card = null;
        this._svg = null;
        this._canvas = null;
        this._ctx2d = null;
        this._open = false;
        this._rafId = 0;
        this._frameCount = 0;
        this._lastSpawnRoundSeen = null;
        this._particles = [];
        this._strategyFlashState = new Map();
        /* v1.59.14：派生依赖虚线（信号→5分量、信号→intent）的 SVG ref，spawn pulse 时短闪强化 */
        this._hintDeriveLinks = [];
        this._intentDeriveLinks = [];
        this._deriveFlashTimer = 0;
        /* v1.59.15：spawnTargets 6 维 + 4 调度参数节点 SVG ref */
        this._spawnTargetEls = [];
        this._scheduleParamEls = [];
        /* v1.59.17：阶段③ 3 chosen shape 节点 + attempt badge SVG ref */
        this._chosenShapeEls = [];
        this._spawnAttemptBadge = null;
        this._lastChosenSig = '';

        /* v1.55.1 调度状态 */
        this._lastTickAt = 0;
        this._lastActiveAt = 0;           // 最近一次"有变化"的时间，用于 active→idle 转档
        this._lastFingerprint = '';        // 上一次 tick 的 insight 指纹
        this._collapsed = false;           // 折叠态
        this._docHidden = false;           // 标签页隐藏
        this._stageVisible = true;         // IntersectionObserver 监测的 DFV 可见性
        this._visibilityHandler = null;
        this._intersectionObserver = null;
        this._particleSprites = new Map(); // 预渲染粒子贴图缓存（color → Canvas）

        /** SVG 节点引用 */
        this._nodeEls = new Map();
        this._edgeEls = new Map();
        this._geom = new Map();
        this._smooth = new Map();
        this._stressBall = null;
        this._stressPulseUntil = 0;
        this._intentEl = null;
        this._curIntent = null;
        this._edgeFlowPhase = 0;
        this._strategyLinkEl = null;

        /** SVG stage 尺寸 */
        this._w = 360;
        this._h = 480;

        /** 时间序列 buffer：key → Float32Array（ring，长度 SPARK_BUFFER_LEN，未填位置为 NaN） */
        this._series = new Map();
        this._seriesIdx = 0;
        this._sparkEls = new Map();

        /** HTML 详情区 ref */
        this._detailEls = null;

        /** 拖拽状态 */
        this._drag = { active: false, dx: 0, dy: 0, freed: false };
        /** 缩放状态（右下角拖拽） */
        this._resize = { active: false, sx: 0, sy: 0, sw: 0, sh: 0 };
    }

    init(game) {
        this._game = game;
        this._injectStyles();
        this._injectToggleButton();
        this._injectKeyShortcut();
    }

    /* ── 入口：toggle / show / hide ─────────────────────────────── */

    toggle() {
        if (this._open) this.hide(); else this.show();
    }

    show() {
        if (this._open) return;
        if (!this._host) this._build();
        this._host.classList.add('dfv-open');
        document.getElementById(TOGGLE_BTN_ID)?.classList.add('is-active');
        this._open = true;
        this._lastSpawnRoundSeen = null;
        this._frameCount = 0;
        this._lastTickAt = 0;
        this._lastActiveAt = performance.now();
        this._lastFingerprint = '';
        this._installVisibilityHooks();
        this._scheduleNext(0);
    }

    hide() {
        if (!this._open) return;
        this._open = false;
        if (this._host) this._host.classList.remove('dfv-open');
        document.getElementById(TOGGLE_BTN_ID)?.classList.remove('is-active');
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = 0;
        this._particles.length = 0;
        this._strategyFlashState.clear();
        this._uninstallVisibilityHooks();
    }

    /* ── v1.55.1 三档调度 ──────────────────────────────────────────
     *
     *   - paused: 折叠 / tab 隐藏 / DFV 被遮挡 → 不再 rAF
     *   - active: 有粒子 / 最近 1.2s 内数据指纹变化 → 30fps
     *   - idle:   其余情况 → 6fps（DFV 数据回合制刷新，6fps 足够展示）
     *
     * 用 rAF 嵌套 + setTimeout 节流：rAF 触发"下一个屏幕帧再决定要不要 tick"，
     * 避免后台标签页里的 setTimeout 精度退化与 cache miss。
     */
    _isPaused() {
        return this._collapsed || this._docHidden || !this._stageVisible;
    }

    _scheduleNext(frameMs) {
        if (!this._open) return;
        if (this._isPaused()) {
            this._rafId = 0;
            return;
        }
        const tick = () => {
            this._rafId = 0;
            if (!this._open || this._isPaused()) return;
            this._tick();
            const hasActiveParticles = this._particles.length > 0;
            const recentChange = (performance.now() - this._lastActiveAt) < DFV_IDLE_AFTER_MS;
            const next = (hasActiveParticles || recentChange) ? DFV_FRAME_MS_ACTIVE : DFV_FRAME_MS_IDLE;
            this._scheduleNext(next);
        };
        if (frameMs <= 0) {
            this._rafId = requestAnimationFrame(tick);
        } else {
            // setTimeout 决定"下一次 tick 最早何时发生"，rAF 让其对齐屏幕刷新
            setTimeout(() => {
                if (!this._open || this._isPaused()) return;
                this._rafId = requestAnimationFrame(tick);
            }, frameMs);
        }
    }

    _installVisibilityHooks() {
        if (typeof document !== 'undefined' && !this._visibilityHandler) {
            this._visibilityHandler = () => {
                this._docHidden = document.visibilityState === 'hidden';
                if (!this._docHidden && this._open) {
                    this._lastActiveAt = performance.now();
                    if (!this._rafId) this._scheduleNext(0);
                }
            };
            this._docHidden = document.visibilityState === 'hidden';
            document.addEventListener('visibilitychange', this._visibilityHandler);
        }
        if (typeof IntersectionObserver !== 'undefined' && this._host && !this._intersectionObserver) {
            this._intersectionObserver = new IntersectionObserver((entries) => {
                for (const entry of entries) {
                    this._stageVisible = entry.intersectionRatio > 0.02;
                }
                if (this._stageVisible && this._open && !this._rafId) {
                    this._lastActiveAt = performance.now();
                    this._scheduleNext(0);
                }
            }, { threshold: [0, 0.02, 0.5] });
            this._intersectionObserver.observe(this._host);
        }
    }

    _uninstallVisibilityHooks() {
        if (this._visibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this._visibilityHandler);
            this._visibilityHandler = null;
        }
        if (this._intersectionObserver) {
            this._intersectionObserver.disconnect();
            this._intersectionObserver = null;
        }
    }

    /* ── 入口按钮 + 快捷键 ──────────────────────────────────────── */

    _injectToggleButton() {
        if (typeof document === 'undefined') return;
        if (document.getElementById(TOGGLE_BTN_ID)) return;

        /* v1.51.2：入口从 #skill-bar 迁到 #sound-effects-toggle 之后，与
         * ✨/🖼/🔊 等快捷开关同列；纯分析工具不属于"游戏内技能"语义。
         * Fallback：找不到时退到 #skill-bar，保证功能可达。 */
        const soundBtn = document.getElementById('sound-effects-toggle');
        const btn = document.createElement('button');
        btn.id = TOGGLE_BTN_ID;
        btn.type = 'button';
        btn.title = _ti('dfv.toggleTitle', '决策数据流 — 实时观察玩家信号 → 压力 → 出块决策（Shift+D）');
        btn.setAttribute('aria-label', _ti('dfv.aria', '决策数据流面板'));
        /* v1.55.14（用户反馈"📊 图标太土"）→
         * v1.55.15（用户二次反馈"表情不清，换为透视、分析主题的 icon"）：
         *
         * 旧版 3 节点 + 流线在 14px 尺寸下糊成"两个点 + 一根线"（节点 r=2.4 与 stroke=2
         * 接近），辨识度低。换为「放大镜 + 内嵌折线」的经典"透视分析"图标：
         *   - 外圆（放大镜镜头）+ 右下手柄 = 立刻读出"放大 / 观察"语义；
         *   - 镜头内嵌一条 4 点折线 = "数据趋势 / 分析对象"；
         *   - 笔画 stroke-width=2 + 折线内嵌略细 1.6 形成主次层次；
         *   - 与"决策数据流"调试面板的功能定位（透视玩家信号→决策链路）天然契合。
         * 同步更新 .dfv-head-icon 保持按钮 & 面板头部图标一致（见 _injectHost）。 */
        btn.innerHTML = ''
            + '<svg class="dfv-btn-icon" viewBox="0 0 24 24" width="15" height="15" '
            + 'fill="none" stroke="currentColor" stroke-width="2" '
            + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
            + '<circle cx="10" cy="10" r="6.5" />'
            + '<path d="M15 15 L20 20" stroke-width="2.4" />'
            + '<polyline points="6.5,12 9,9.5 11,11 13.5,8" stroke-width="1.5" opacity="0.9" />'
            + '</svg>';
        btn.addEventListener('click', () => this.toggle());

        if (soundBtn?.parentNode) {
            btn.className = 'feedback-toggle-btn feedback-toggle-btn--decision-flow';
            soundBtn.insertAdjacentElement('afterend', btn);
            return;
        }
        const skillBar = document.getElementById('skill-bar');
        if (skillBar) {
            btn.className = 'skill-btn skill-btn--decision-flow';
            skillBar.appendChild(btn);
            return;
        }
        // 极端 fallback：挂到 body 右上角
        btn.className = 'feedback-toggle-btn feedback-toggle-btn--decision-flow dfv-floating-btn';
        document.body.appendChild(btn);
    }

    _injectKeyShortcut() {
        if (typeof window === 'undefined') return;
        window.addEventListener('keydown', (ev) => {
            if (ev.shiftKey && (ev.key === 'D' || ev.key === 'd') && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
                ev.preventDefault();
                this.toggle();
            }
        });
    }

    /* ── DOM / SVG 构建 ─────────────────────────────────────────── */

    _build() {
        const host = document.createElement('div');
        host.id = HOST_ID;
        host.className = 'dfv-host';
        const T = {
            title:        _ti('dfv.title', '决策数据流'),
            dragHint:     _ti('dfv.dragHint', '按住拖动整个面板'),
            collapse:     _ti('dfv.collapseTitle', '折叠/展开'),
            close:        _ti('dfv.closeTitle', '关闭（Shift+D）'),
            pulseWaiting: _ti('dfv.pulseWaiting', '待 spawn'),
            secIntent:    _ti('dfv.sec.intent', '出块意图'),
            secContrib:   _ti('dfv.sec.contrib', '压力贡献'),
            secContribSub:_ti('dfv.sec.contribSub', '前 4 项'),
            secFlags:     _ti('dfv.sec.flags', '决策标志'),
            secShapes:    _ti('dfv.sec.shapes', '形状权重'),
            secShapesSub: _ti('dfv.sec.shapesSub', '前 5 项 · 概率'),
            secTargets:   _ti('dfv.sec.targets', '出块目标'),
            secTargetsSub:_ti('dfv.sec.targetsSub', '前 6 项'),
            secHints:     _ti('dfv.sec.hints', '调度提示'),
            secHintsSub:  _ti('dfv.sec.hintsSub', '调度参数'),
            secDynamics:  _ti('dfv.sec.dynamics', '决策动态'),
            secDynamicsSub: _ti('dfv.sec.dynamicsSub', '归因 · 灵敏度'),
            flowNavAria:  _ti('dfv.flowNav.aria', '算法决策流水线：信号 → 压力 → 策略 → 意图'),
            flowStepSignal: _ti('dfv.flowStep.signal', '信号'),
            flowStepStress: _ti('dfv.flowStep.stress', '压力'),
            flowStepStrategy: _ti('dfv.flowStep.strategy', '策略'),
            flowStepIntent: _ti('dfv.flowStep.intent', '意图'),
            flowStepSignalTip: _ti('dfv.flowStep.signalTip', '10 个玩家信号节点（左列）：技能 / 动量 / 心流 / 阶段 / 占盘 / 消行率 等'),
            flowStepStressTip: _ti('dfv.flowStep.stressTip', '17+ 信号经 adaptiveSpawn 聚合为单一 stress（中央球，[0,1] 归一化）'),
            flowStepStrategyTip: _ti('dfv.flowStep.strategyTip', 'stress + 上下文分解为 5 个策略分量：保消 / 尺寸 / 刚性 / 多样 / 连击'),
            flowStepIntentTip: _ti('dfv.flowStep.intentTip', 'resolveIntent 综合策略选定本帧出块意图：harvest / relief / engage / flow / sprint / pressure / maintain'),
            footRelief:   _ti('dfv.foot.relief', '救济'),
            footPressure: _ti('dfv.foot.pressure', '加压'),
            footPulseHint:_ti('dfv.foot.pulseHint', '脉冲=新 spawn'),
            footCovaryHint:_ti('dfv.foot.covaryHint', '虚线=派生共变·非因果'),
            empty:        _ti('dfv.foot.empty', '—'),
        };
        host.innerHTML = `
            <div class="dfv-card" id="dfv-card">
                <div class="dfv-head" id="dfv-head" title="${T.dragHint}">
                    <div class="dfv-head-title">
                        <span class="dfv-head-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" width="15" height="15"
                                 fill="none" stroke="currentColor" stroke-width="2"
                                 stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="10" cy="10" r="6.5" />
                                <path d="M15 15 L20 20" stroke-width="2.4" />
                                <polyline points="6.5,12 9,9.5 11,11 13.5,8" stroke-width="1.5" opacity="0.9" />
                            </svg>
                        </span>
                        <span>${T.title}</span>
                    </div>
                    <div class="dfv-head-meta">
                        <span class="dfv-head-pulse" id="dfv-pulse-tag">${T.pulseWaiting}</span>
                        <button type="button" class="dfv-iconbtn dfv-collapse" aria-label="${T.collapse}" title="${T.collapse}">⇔</button>
                        <button type="button" class="dfv-iconbtn dfv-close" aria-label="${T.close}" title="${T.close}">×</button>
                    </div>
                </div>
                <!-- v1.59.20：决策摘要叙事条（A+B 组合的 B 部分）。
                     将左侧球状图的视觉链路"压力→派生→3 块"翻译成一句自然语言，
                     消除"看图看不懂"的认知 gap：
                       · stress 档：低压/中压/高压（含 stressLevel%）
                       · intent 档：缓冲/护场/平稳/送清屏... 等当前驱动意图
                       · 偏好：5 hints 中权重最高的 1-2 项（如长条 33%、临消行 0.34）
                       · 3 块主因：每块 topDriver.label（与 chosen 节点"因·XXX"小字一致）
                     该叙事条与 chosen 节点的"主因小字"形成"全局摘要 + 局部细节"双层解释。 -->
                <div class="dfv-decision-summary" id="dfv-decision-summary"
                     title="决策摘要：用一句话解释当前出块决策的算法依据（stress + intent + 偏好 → 3 块主因）">
                    <span class="dfv-summary-empty">${T.summaryEmpty ?? '等待首次出块…'}</span>
                </div>
                <div class="dfv-body">
                    <div class="dfv-stage dfv-stage--burst" id="dfv-stage">
                        <!-- v1.59.2：DFV 整体重构为「左视觉炸裂 / 右文本聚合」双轨——
                             左侧（dfv-stage）：纯视觉表演，球状图独占整个 stage，背景能量场呼吸、stress
                             多层辉光、spawn 辐射波纹、意图弹跳，让"信号→压力→决策"的动态过程一眼可感知；
                             右侧（dfv-details）：所有文本/数值/列表集中聚合，顶部新增「决策动态」区段（意图
                             时间线 / stress 分量堆叠 / 响应灵敏度），将时间维度、归因、灵敏度同屏可读。
                             v1.59.3：stage 顶部新增 4 阶段流程导航 overlay（dfv-flow-nav），把"信号→压力
                             →策略→意图"的算法决策流水线显式标注到球状图上方，让"过程"成为肉眼可读的认知锚。 -->
                        <canvas class="dfv-particles" id="dfv-particles"></canvas>
                        <svg class="dfv-svg" id="dfv-svg" xmlns="http://www.w3.org/2000/svg"
                             viewBox="0 0 360 320" preserveAspectRatio="xMidYMid meet"></svg>
                        <div class="dfv-stage-aura" id="dfv-stage-aura" aria-hidden="true"></div>
                        <div class="dfv-stage-shock" id="dfv-stage-shock" aria-hidden="true"></div>
                        <!-- v1.59.11 按源码事实修正：
                             旧版"信号→压力→策略→意图"是视觉叙事编排，与源码事实不符——
                             stress / spawnHints 5 向量 / spawnIntent 是 adaptiveSpawn 单次调用
                             的 3 个并列输出（兄弟节点），都从底层信号派生，彼此之间无因果传递：
                               · clearGuarantee 由 30+ Math.max 路径累加，从不读 stress
                               · resolveIntent 7 规则只读 distress/geometry/delight/stress，从不读 5 向量
                             因此 nav 步序号重映射为「1 信号 → 2 派生（① 压力 ∥ ② 策略 ∥ ③ 意图）」，
                             用 ∥ 分隔表达并列同源，避免误读为串行决策链。 -->
                        <div class="dfv-flow-nav" id="dfv-flow-nav" aria-label="${T.flowNavAria ?? '算法决策结构：信号 → 派生（压力 ∥ 策略 ∥ 目标 ∥ 调度 ∥ 意图 五者并列同源）'}">
                            <!-- v1.60.7：删除阶段编号 "1"（修复"1→①…⑤→3"数字逻辑断层），
                                 阶段感靠 ▶ 与颜色已足够表达；"信号"作为名词独立站住。 -->
                            <span class="dfv-flow-step dfv-flow-step--signal" data-step="signal" title="${T.flowStepSignalTip ?? '阶段 1 · 信号：17+ 玩家信号底层因果输入'}">
                                <span class="dfv-flow-step__name">${T.flowStepSignal ?? '信号'}</span>
                            </span>
                            <span class="dfv-flow-arrow" aria-hidden="true">▶</span>
                            <span class="dfv-flow-step dfv-flow-step--stress" data-step="stress" title="${T.flowStepStressTip ?? '派生①：stressBreakdown 12+ 分量加权 + normalize（① ② ③ ④ ⑤ 5 派生同源并列，彼此无因果传递）'}">
                                <span class="dfv-flow-step__num">①</span><span class="dfv-flow-step__name">${T.flowStepStress ?? '压力'}</span>
                            </span>
                            <span class="dfv-flow-step dfv-flow-step--strategy" data-step="strategy" title="${T.flowStepStrategyTip ?? '派生②：spawnHints 5 向量 — 30+ 独立路径并发累加，不读 stress'}">
                                <span class="dfv-flow-step__num">②</span><span class="dfv-flow-step__name">${T.flowStepStrategy ?? '策略'}</span>
                            </span>
                            <span class="dfv-flow-step dfv-flow-step--target" data-step="target" title="${T.flowStepTargetTip ?? '派生③：spawnTargets 6 维 — deriveSpawnTargets(stress, profile, ctx, fill, boardRisk, delight) 输出'}">
                                <span class="dfv-flow-step__num">③</span><span class="dfv-flow-step__name">${T.flowStepTarget ?? '目标'}</span>
                            </span>
                            <span class="dfv-flow-step dfv-flow-step--schedule" data-step="schedule" title="${T.flowStepScheduleTip ?? '派生④：多消/多线/清屏/同色 4 调度参数 — 各自独立 derive 函数。注：仅当本轮 chosen 主因 ∈ {可消N行（N≥2）/可清屏} 才会被 union 反向高亮覆盖；同色 bonus 影响 dock 颜色（非形状），通常保持暗'}">
                                <span class="dfv-flow-step__num">④</span><span class="dfv-flow-step__name">${T.flowStepSchedule ?? '调度'}</span>
                            </span>
                            <span class="dfv-flow-step dfv-flow-step--intent" data-step="intent" title="${T.flowStepIntentTip ?? '派生⑤：resolveIntent 7 规则 — 直接读 distress/geometry/delight/stress，不读 5 向量'}">
                                <span class="dfv-flow-step__num">⑤</span><span class="dfv-flow-step__name">${T.flowStepIntent ?? '意图'}</span>
                            </span>
                            <span class="dfv-flow-arrow" aria-hidden="true">▶</span>
                            <!-- v1.60.7：同 signal，删 "3" 编号 -->
                            <span class="dfv-flow-step dfv-flow-step--spawn" data-step="spawn" title="${T.flowStepSpawnTip ?? '阶段 3 · 出块（blockSpawn.generateDockShapes）：3 子层（拓扑/局内/局间）+ 22 次抽样软过滤 → 3 chosen shape'}">
                                <span class="dfv-flow-step__name">${T.flowStepSpawn ?? '出块'}</span>
                            </span>
                        </div>
                    </div>
                    <div class="dfv-details" id="dfv-details">
                        <div class="dfv-section dfv-section--dynamics">
                            <div class="dfv-sec-title">${T.secDynamics ?? '决策动态'} <span class="dfv-sec-sub">${T.secDynamicsSub ?? '时间线 · 归因 · 灵敏度'}</span></div>
                            <div class="dfv-dynamics-host" id="dfv-dynamics-host"></div>
                        </div>
                        <div class="dfv-section dfv-section--intent">
                            <div class="dfv-sec-title">${T.secIntent} <span class="dfv-sec-sub" id="dfv-intent-reason">${T.empty}</span></div>
                            <div class="dfv-intent-card">
                                <span class="dfv-intent-pill" id="dfv-intent-pill">${T.empty}</span>
                                <span class="dfv-intent-cn" id="dfv-intent-cn">${T.empty}</span>
                            </div>
                        </div>
                        <div class="dfv-section">
                            <div class="dfv-sec-title">${T.secContrib} <span class="dfv-sec-sub">${T.secContribSub}</span></div>
                            <ul class="dfv-list dfv-list--two-col" id="dfv-contrib-list"></ul>
                        </div>
                        <div class="dfv-section">
                            <div class="dfv-sec-title">${T.secFlags}</div>
                            <div class="dfv-flags" id="dfv-flags"></div>
                        </div>
                        <div class="dfv-section">
                            <div class="dfv-sec-title">${T.secShapes} <span class="dfv-sec-sub">${T.secShapesSub}</span></div>
                            <ul class="dfv-list dfv-list--three-col" id="dfv-shape-list"></ul>
                        </div>
                        <div class="dfv-section">
                            <div class="dfv-sec-title">${T.secTargets} <span class="dfv-sec-sub">${T.secTargetsSub}</span></div>
                            <ul class="dfv-list dfv-list--two-col" id="dfv-target-list"></ul>
                        </div>
                        <div class="dfv-section">
                            <div class="dfv-sec-title">${T.secHints} <span class="dfv-sec-sub">${T.secHintsSub}</span></div>
                            <ul class="dfv-list dfv-list--two-col" id="dfv-hints-list"></ul>
                        </div>
                    </div>
                </div>
                <div class="dfv-sparks" id="dfv-sparks"></div>
                <div class="dfv-foot">
                    <span class="dfv-legend"><span class="dfv-dot dfv-dot--neg"></span>${T.footRelief}</span>
                    <span class="dfv-legend"><span class="dfv-dot dfv-dot--pos"></span>${T.footPressure}</span>
                    <span class="dfv-legend">${T.footPulseHint}</span>
                    <span class="dfv-legend dfv-legend--covary" title="${T.footCovaryHint ?? '虚线=派生共变·非因果'}：纵轴 stress / 5 向量 / intent 是 adaptiveSpawn 的 3 个并列输出，从同一底层信号集派生，彼此之间无直接读取——虚线连线表达共时共变，非因果传递"><span class="dfv-dot dfv-dot--covary"></span>${T.footCovaryHint ?? '虚线=派生共变·非因果'}</span>
                    <span class="dfv-legend dfv-legend--ver">v1.60.34</span>
                </div>
                <div class="dfv-foot dfv-foot--reason" title="出块行 3 个 chosen 节点上方的 reason 标签含义（hover 各项查看完整解释）">
                    <span class="dfv-legend dfv-legend--reason-title">出块原因：</span>
                    <span class="dfv-legend dfv-legend--reason" title="${SPAWN_REASON_TIP.clear}"><span class="dfv-reason-tag" style="color:#22d3ee">送消行</span>直接消行</span>
                    <span class="dfv-legend dfv-legend--reason" title="${SPAWN_REASON_TIP.perfectClear}"><span class="dfv-reason-tag" style="color:#fbbf24">★送清屏</span>清零盘面</span>
                    <span class="dfv-legend dfv-legend--reason" title="${SPAWN_REASON_TIP.monoFlush}"><span class="dfv-reason-tag" style="color:#f0abfc">★送同花</span>×5大奖</span>
                    <span class="dfv-legend dfv-legend--reason" title="${SPAWN_REASON_TIP.weighted}"><span class="dfv-reason-tag" style="color:#a78bfa">综合选</span>多维加权</span>
                    <span class="dfv-legend dfv-legend--reason" title="${SPAWN_REASON_TIP.fallback}"><span class="dfv-reason-tag" style="color:#94a3b8">兜底块</span>主路径降级</span>
                </div>
                <div class="dfv-resize-handle" id="dfv-resize-handle" title="拖拽缩放"></div>
            </div>
        `;
        document.body.appendChild(host);
        this._host = host;
        this._card = host.querySelector('#dfv-card');
        this._svg = host.querySelector('#dfv-svg');
        this._canvas = host.querySelector('#dfv-particles');
        this._ctx2d = this._canvas.getContext('2d');
        this._pulseTag = host.querySelector('#dfv-pulse-tag');

        host.querySelector('.dfv-close').addEventListener('click', () => this.hide());
        host.querySelector('.dfv-collapse').addEventListener('click', () => {
            this._host.classList.toggle('dfv-collapsed');
            this._collapsed = this._host.classList.contains('dfv-collapsed');
            requestAnimationFrame(() => this._resizeCanvas());
            /* v1.55.1：折叠态彻底暂停 rAF；恢复时立刻 tick 一次取最新数据 */
            if (this._collapsed) {
                if (this._rafId) cancelAnimationFrame(this._rafId);
                this._rafId = 0;
            } else if (this._open && !this._rafId) {
                this._lastActiveAt = performance.now();
                this._scheduleNext(0);
            }
        });

        this._buildSparks(host.querySelector('#dfv-sparks'));
        this._cacheDetailEls(host);
        this._bindDrag(host.querySelector('#dfv-head'));
        this._bindResize(host.querySelector('#dfv-resize-handle'));

        /* v1.59.2：球状图重新独占整个 .dfv-stage（取消上下双区），ResizeObserver 监听整 stage；
         * 决策动态层（timeline / stack / sens）整体迁至右侧 .dfv-details 顶部，由
         * #dfv-dynamics-host 承载，与下方各 section 一致的紧凑节奏。 */
        this._resizeCanvas();
        new ResizeObserver(() => this._resizeCanvas()).observe(host.querySelector('#dfv-stage'));

        this._dynamicsHost = host.querySelector('#dfv-dynamics-host');
        this._stageEl = host.querySelector('#dfv-stage');
        this._stageShock = host.querySelector('#dfv-stage-shock');
        this._buildScene();
    }

    _cacheDetailEls(host) {
        this._detailEls = {
            intentPill: host.querySelector('#dfv-intent-pill'),
            intentCn:   host.querySelector('#dfv-intent-cn'),
            intentReason: host.querySelector('#dfv-intent-reason'),
            contrib:    host.querySelector('#dfv-contrib-list'),
            flags:      host.querySelector('#dfv-flags'),
            shape:      host.querySelector('#dfv-shape-list'),
            target:     host.querySelector('#dfv-target-list'),
            hints:      host.querySelector('#dfv-hints-list'),
            /* v1.59.20：顶部决策摘要叙事条（A+B 的 B 部分） */
            summary:    host.querySelector('#dfv-decision-summary'),
        };

        /* v1.60.6 抖动修复：mount 时即预创建 driver badge 占位（visibility:hidden），
         * 让 .dfv-decision-summary 的 flex-wrap 状态从一开始就稳定——首次 hover 不
         * 再触发"1 行→2 行"的高度跳动；后续 hover/unhover 仅切换 visibility，零 reflow。
         * badge 文本预填占位（visibility:hidden 用户看不见），让 layout 计算稳定。 */
        if (this._detailEls.summary && !this._summaryBadgeEl) {
            const badge = document.createElement('span');
            badge.className = 'dfv-summary-driver-badge';
            badge.style.color = '#fde68a';
            badge.style.visibility = 'hidden';
            badge.textContent = '追溯：—';
            this._detailEls.summary.appendChild(badge);
            this._summaryBadgeEl = badge;
        }
    }

    _resizeCanvas() {
        if (!this._canvas) return;
        const stage = this._canvas.parentElement;
        const rect = stage.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this._canvas.width = Math.max(1, rect.width * dpr);
        this._canvas.height = Math.max(1, rect.height * dpr);
        this._canvas.style.width = `${rect.width}px`;
        this._canvas.style.height = `${rect.height}px`;
        this._ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._w = rect.width;
        this._h = rect.height;
        this._svg.setAttribute('viewBox', `0 0 ${this._w.toFixed(0)} ${this._h.toFixed(0)}`);
        if (this._open) this._buildScene();
    }

    /* ── 拖拽（v1.51.2 新增） ───────────────────────────────────── */

    _bindDrag(handle) {
        if (!handle) return;
        const onDown = (ev) => {
            // 点击的是按钮则不进入拖拽
            const tgt = ev.target;
            if (tgt && tgt.closest && tgt.closest('button')) return;

            const isTouch = ev.type === 'touchstart';
            const point = isTouch ? ev.touches[0] : ev;
            const rect = this._card.getBoundingClientRect();
            this._drag.active = true;
            this._drag.dx = point.clientX - rect.left;
            this._drag.dy = point.clientY - rect.top;
            this._card.classList.add('dfv-card--dragging');
            ev.preventDefault();
            // 切换为自由 left/top（脱离 transform 居中）
            if (!this._drag.freed) {
                this._card.style.transform = 'none';
                this._card.style.top = `${rect.top}px`;
                this._card.style.left = `${rect.left}px`;
                this._drag.freed = true;
            }
        };
        const onMove = (ev) => {
            if (!this._drag.active) return;
            const isTouch = ev.type === 'touchmove';
            const point = isTouch ? ev.touches[0] : ev;
            const rect = this._card.getBoundingClientRect();
            const w = rect.width;
            // clamp 到可视范围内（保留 head 至少 36px 可见）
            const maxLeft = window.innerWidth - 60;
            const maxTop = window.innerHeight - 36;
            const left = _clamp(point.clientX - this._drag.dx, -w + 60, maxLeft);
            const top = _clamp(point.clientY - this._drag.dy, 0, maxTop);
            this._card.style.left = `${left}px`;
            this._card.style.top = `${top}px`;
            ev.preventDefault();
        };
        const onUp = () => {
            if (!this._drag.active) return;
            this._drag.active = false;
            this._card.classList.remove('dfv-card--dragging');
        };
        handle.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        handle.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
        window.addEventListener('touchcancel', onUp);
    }

    _bindResize(handle) {
        if (!handle) return;
        const minW = 480;
        const maxW = 980;
        const minH = 380;
        const maxH = 920;

        const ensureFreed = () => {
            if (this._drag.freed) return;
            const rect = this._card.getBoundingClientRect();
            this._card.style.transform = 'none';
            this._card.style.top = `${rect.top}px`;
            this._card.style.left = `${rect.left}px`;
            this._drag.freed = true;
        };

        const onDown = (ev) => {
            const isTouch = ev.type === 'touchstart';
            const point = isTouch ? ev.touches[0] : ev;
            const rect = this._card.getBoundingClientRect();
            ensureFreed();
            this._resize.active = true;
            this._resize.sx = point.clientX;
            this._resize.sy = point.clientY;
            this._resize.sw = rect.width;
            this._resize.sh = rect.height;
            this._card.classList.add('dfv-card--resizing');
            ev.preventDefault();
            ev.stopPropagation();
        };
        const onMove = (ev) => {
            if (!this._resize.active) return;
            const isTouch = ev.type === 'touchmove';
            const point = isTouch ? ev.touches[0] : ev;
            const dx = point.clientX - this._resize.sx;
            const dy = point.clientY - this._resize.sy;
            const rect = this._card.getBoundingClientRect();
            const viewportW = Math.max(minW, window.innerWidth - rect.left - 8);
            const viewportH = Math.max(minH, window.innerHeight - rect.top - 8);
            const nextW = _clamp(this._resize.sw + dx, minW, Math.min(maxW, viewportW));
            const nextH = _clamp(this._resize.sh + dy, minH, Math.min(maxH, viewportH));
            this._card.style.width = `${nextW}px`;
            this._card.style.height = `${nextH}px`;
            this._resizeCanvas();
            ev.preventDefault();
        };
        const onUp = () => {
            if (!this._resize.active) return;
            this._resize.active = false;
            this._card.classList.remove('dfv-card--resizing');
        };
        handle.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        handle.addEventListener('touchstart', onDown, { passive: false });
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onUp);
        window.addEventListener('touchcancel', onUp);
    }

    /* ── 时间序列 sparkline ────────────────────────────────────── */

    _buildSparks(container) {
        if (!container) return;
        container.innerHTML = '';
        for (const s of SPARK_SERIES) {
            const buf = new Float32Array(SPARK_BUFFER_LEN);
            for (let i = 0; i < buf.length; i++) buf[i] = NaN;
            this._series.set(s.key, buf);
            const row = document.createElement('div');
            row.className = 'dfv-spark-row';
            const cn = _ti(`dfv.spark.${s.key}`, SPARK_LABEL_CN[s.key] || s.label);
            /* v1.59.8 spark 动效增强——
             *   stroke 1.4 → 1.8 加粗让线条更醒目；
             *   末点 pulsing 圆点（dfv-spark-dot）跟随最新采样，CSS animation 让脉动可见；
             *   背景 fillline（dfv-spark-fill）半透明区域强化"趋势带"视觉，比纯线条更有动感 */
            row.innerHTML = `
                <span class="dfv-spark-label" style="color:${s.color}" title="${s.label}">${cn}</span>
                <svg class="dfv-spark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 18" preserveAspectRatio="none">
                    <line class="dfv-spark-zero" x1="0" x2="240" y1="9" y2="9" stroke="rgba(148,163,184,0.18)" stroke-dasharray="2 3"></line>
                    <path class="dfv-spark-fill" fill="${s.color}" fill-opacity="0.14" stroke="none" d=""></path>
                    <path class="dfv-spark-path" fill="none" stroke="${s.color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" d=""></path>
                    <circle class="dfv-spark-dot" cx="-9" cy="9" r="2.2" fill="${s.color}" style="--dot-color:${s.color}"></circle>
                </svg>
                <span class="dfv-spark-value" style="color:${s.color}">—</span>
            `;
            container.appendChild(row);
            this._sparkEls.set(s.key, {
                path:  row.querySelector('.dfv-spark-path'),
                fill:  row.querySelector('.dfv-spark-fill'),
                dot:   row.querySelector('.dfv-spark-dot'),
                value: row.querySelector('.dfv-spark-value'),
            });
        }
    }

    _sampleSeries(snap) {
        const idx = this._seriesIdx % SPARK_BUFFER_LEN;
        for (const s of SPARK_SERIES) {
            const buf = this._series.get(s.key);
            const v = snap[s.key];
            buf[idx] = Number.isFinite(v) ? v : NaN;
        }
        this._seriesIdx++;
    }

    _renderSparks() {
        for (const s of SPARK_SERIES) {
            const buf = this._series.get(s.key);
            const ref = this._sparkEls.get(s.key);
            if (!buf || !ref) continue;
            const n = SPARK_BUFFER_LEN;
            const start = this._seriesIdx >= n ? this._seriesIdx - n : 0;
            const len = Math.min(this._seriesIdx, n);
            if (len === 0) {
                _setAttrIfChanged(ref.path, 'd', '');
                if (ref.fill) _setAttrIfChanged(ref.fill, 'd', '');
                if (ref.dot) { _setAttrIfChanged(ref.dot, 'cx', '-9'); ref.dot.classList.add('dfv-spark-dot--idle'); }
                ref.value.textContent = '—';
                continue;
            }

            const [lo, hi] = s.range;
            const span = Math.max(1e-6, hi - lo);
            const W = 240, H = 18;
            let d = '';
            let lastValid = NaN;
            let lastX = -9, lastY = H / 2;
            let firstX = 0;
            let firstSet = false;
            for (let i = 0; i < len; i++) {
                const v = buf[(start + i) % n];
                if (!Number.isFinite(v)) continue;
                const x = (i / Math.max(1, len - 1)) * W;
                const norm = _clamp((v - lo) / span, 0, 1);
                const y = H - norm * H;
                d += (d ? ' L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
                lastValid = v;
                lastX = x; lastY = y;
                if (!firstSet) { firstX = x; firstSet = true; }
            }
            _setAttrIfChanged(ref.path, 'd', d);
            /* v1.59.8：fill area path——从最后一点向 baseline 拉 L 闭合，让"趋势带"半透明色填充 */
            if (ref.fill && d) {
                const fillD = `${d} L${lastX.toFixed(1)},${H} L${firstX.toFixed(1)},${H} Z`;
                _setAttrIfChanged(ref.fill, 'd', fillD);
            }
            /* v1.59.8：末点圆点跟随最新采样位置，CSS pulsing 让"实时"可见 */
            if (ref.dot) {
                _setAttrIfChanged(ref.dot, 'cx', lastX.toFixed(1));
                _setAttrIfChanged(ref.dot, 'cy', lastY.toFixed(1));
                ref.dot.classList.remove('dfv-spark-dot--idle');
            }
            const valTxt = Number.isFinite(lastValid) ? s.format(lastValid) : '—';
            if (ref.value.textContent !== valTxt) ref.value.textContent = valTxt;
        }
    }

    /* ── 场景构建：节点 + 边 ─────────────────────────────────────── */

    _buildScene() {
        const svg = this._svg;
        if (!svg) return;
        svg.innerHTML = '';
        this._nodeEls.clear();
        this._edgeEls.clear();
        this._geom.clear();
        this._strategyLinkEl = null;
        /* v1.59.14：buildScene 重建时清空派生虚线 ref（旧 SVG 节点已被 innerHTML='' 清除） */
        this._hintDeriveLinks = [];
        this._intentDeriveLinks = [];
        /* v1.59.15：清空 spawnTargets / 调度参数节点 ref */
        this._spawnTargetEls = [];
        this._scheduleParamEls = [];
        /* v1.59.17：清空阶段③ chosen ref + dirty 指纹（buildScene 重建 SVG 节点后必须强制下次重渲染，
         * 否则 _renderChosenShapes 的 dirty check 会跳过首次填充，UI 显示 '—' 占位永远不更新） */
        this._chosenShapeEls = [];
        this._spawnAttemptBadge = null;
        this._lastChosenSig = '';
        /* v1.60.14：_buildScene 重建 DOM 后必须同步重置 union 高亮状态——否则 _applyHlSet 会按
         * 旧 _driverHlSet 进行 diff，对"上次高亮但新 DOM 还没创建"的 id 调 _toggleDriverHl(id, false)
         * 找到的是 null（DOM 被 innerHTML='' 销毁）→ no-op，导致新 DOM 永远不被加 .dfv-driver-hl
         * （prev 集合"以为"它们已经亮着，next 仍含此 id 时被跳过 add）。 */
        this._driverHlSet = new Set();
        if (this._svg) this._svg.classList.remove('dfv-svg--driver-mode');

        const W = this._w, H = this._h;
        /* v1.51.7：压力 + 意图"右锚定纵向排列"，进一步拉大与信号节点 / 彼此 的距离。
         *
         * - 压力球 + 意图六边形：x 锚定到 SVG 区右侧（留 24px 内边距），让横向粒子
         *   轨迹（信号→压力）的长度最大化；
         * - 压力球：垂直居中（H × 0.50）；
         * - 意图六边形：与压力同 x、放在压力下方 H × 0.90 处，硬保证两者中心距离
         *   ≥ stressR + intentR + 60px（v1.51.6 的 36 → 60，纵向 +24px）；
         * - 半径按左栏宽度自适应；溢出保护：右锚定不能让球贴边（min 24px），
         *   底部不能让六边形溢出（min intentR + 4px）。 */
        const nodeR = Math.min(24, Math.max(17, (W - 80) * 0.128));
        const stressR = nodeR;
        const intentR = nodeR;
        /* v1.59.3：signalX 从 W*0.18 → max(58, W*0.20)，让 label "失放率" 等 3 字 label
         * 在窄栏（W ≈ 260px 默认 540 卡宽时）也不会贴 viewBox 左边——label x = signalX - r - 6，
         * 需 signalX ≥ r + 6 + labelWidth(≈30px) ≈ 51px 才安全。 */
        const signalX = Math.max(58, W * 0.20);
        const leftN = SIGNAL_NODES.length;
        const r = leftN <= 8 ? 19 : 15;

        const PAD_RIGHT = 24;
        const rightAnchorX = W - Math.max(stressR, intentR) - PAD_RIGHT;
        // 仍要保留与信号节点的最小间距（≥ 球半径 × 3，避免视觉拥堵）
        const minCenterX = signalX + Math.max(stressR, intentR) * 3;
        const compR = r;
        const nDefs = STRATEGY_COMPONENT_DEFS.length;
        const centerIdx = (nDefs - 1) / 2;
        const compMargin = compR + 8;
        const span = Math.max(compR * 2.12, Math.min(34, stressR * 1.36));
        const axisMin = Math.max(minCenterX, compMargin + centerIdx * span);
        const axisMax = Math.min(rightAnchorX - 18, W - compMargin - centerIdx * span);
        const targetX = W * 0.74;
        const centerX = _clamp(targetX, axisMin, axisMax);
        const stressX = centerX;
        /* v1.59.3：顶部给 .dfv-flow-nav overlay 让位（4 阶段流程导航条 + padding）。
         * v1.59.7：flowNavReserve 28 → 32（nav 实际高 = top 6 + padding 6 + chip 内容
         * ~20 ≈ 32px），且下方 sigTop 还需额外预留节点半径 r 避免"圆顶遮挡 nav"。
         * v1.59.12：旧版 stressY/intentY 局部变量已被新的 stressYNew/intentYNew 三等分布局替代
         * （见下方"3 派生节点垂直三等分"逻辑），此处仅保留 intentX。 */
        const flowNavReserve = 32;
        const edgeMarginY = Math.max(44, H * 0.12) + flowNavReserve * 0.5;
        void edgeMarginY;

        const intentX = centerX;

        /* 1) 左列：玩家信号节点（v1.59.6 自适应撑满全高 / v1.59.7 修 nav 遮挡）。
         *    v1.59.5 固定 gap=clamp(28,36) 中心对齐让 R10 截图 stage 下方大量空白；
         *    v1.59.6 改回"sigSpan/9 撑满全高"——leftN=10 节点平均铺满 sigTop..sigBottom；
         *    v1.59.7 修复"技能节点圆顶遮挡 nav"——sigTop 必须额外预留节点半径 r 而非
         *    flowNavReserve+6，否则第一个节点圆心 y=sigTop 时圆顶 y=sigTop-r 进入 nav 区。 */
        const sigTop = flowNavReserve + r + 4;
        const sigBottom = H - 22 - r;
        const sigSpanRaw = Math.max(40, sigBottom - sigTop);
        const sigGap = Math.min(80, sigSpanRaw / Math.max(1, leftN - 1));
        const sigUsedH = sigGap * (leftN - 1);
        const sigBaseY = sigTop + ((sigBottom - sigTop) - sigUsedH) / 2;
        SIGNAL_NODES.forEach((sig, i) => {
            const y = sigBaseY + sigGap * i;
            this._geom.set(sig.key, { x: signalX, y, r });
            this._addSignalNode(sig.key, _ti(sig.i18nKey, sig.label), r);
        });

        /* v1.59.12 几何彻底重排：3 派生节点垂直三等分，明示「并列同源」非「串联因果」——
         * v1.59.15 扩展到 5 派生层（按 adaptiveSpawn 完整对外字段）
         * v1.59.17 末端补阶段 3（blockSpawn 3 chosen shape）—— 6 层布局，按 1/8 步长分布：
         *   1.0/8 ← stress 球（派生①）
         *   2.3/8 ← 5 核心分量（派生②.a：spawnHints 5 核心）
         *   3.4/8 ← 6 spawnTargets（派生②.b：spawnHints.spawnTargets 6 维目标向量）
         *   4.4/8 ← 4 调度参数（派生②.c：multiClearBonus/multiLineTarget/perfectClearBoost/iconBonusTarget）
         *   5.5/8 ← intent 球（派生③）
         *   7.0/8 ← 3 chosen shape（阶段③出块：blockSpawn.generateDockShapes 末端输出）
         *
         * 阶段 2 的 5 派生节点是"并列同源"（信号扇形派生），阶段 3 的 3 chosen shape 是
         * **真因果消费**（intent + hints + spawnTargets + 调度 全部输入 blockSpawn → 输出 3 shape）。
         * 视觉上：5 派生层用虚线扇形（共变·非因果），intent→3 chosen 用实色（真因果传递）。 */
        const derivedTop = sigTop + 2;
        const derivedBottom = sigBottom - 2;
        const derivedSpan = Math.max(220, derivedBottom - derivedTop);
        const stressYNew      = derivedTop + derivedSpan * (1.0 / 8);
        const strategyY       = derivedTop + derivedSpan * (2.3 / 8);
        const spawnTargetsY   = derivedTop + derivedSpan * (3.4 / 8);
        const scheduleParamsY = derivedTop + derivedSpan * (4.4 / 8);
        const intentYNew      = derivedTop + derivedSpan * (5.5 / 8);
        const spawnChosenY    = derivedTop + derivedSpan * (7.0 / 8);

        /* 2) 派生①：stress 球（顶部 1/8） */
        this._geom.set('stress', { x: stressX, y: stressYNew, r: stressR });
        this._addStressBall();

        /* 3) 派生③：spawnIntent 六边形（5.5/8） */
        this._geom.set('spawnIntent', { x: intentX, y: intentYNew, r: intentR });
        this._addSpawnIntentNode();

        /* 3.5) 派生②：5 个策略分量（横排，独立节点）+ 派生依赖虚线。
         *
         * v1.59.12 删除 stress→5分量、5分量→intent 的串联连线（错误的因果暗示）。
         * v1.59.13 补画"信号 → 5 分量"派生依赖虚线（HINT_DRIVER_SIGNALS 映射），
         *   让用户视觉上看到"5 分量也是从信号集派生"。这些虚线：
         *     - 弱色 (rgba(148,163,184,0.18))、1px、dasharray '2 3'，不参与 spawn pulse 强化
         *     - 与"信号→stress"的真贡献边（橙/青实色）形成视觉对比：实=贡献量化，虚=依赖暗示
         *     - 用 svg.insertBefore 放到最底层，被节点圆形遮盖，画面不显凌乱 */
        {
            const rowCenterX = stressX;
            const comps = STRATEGY_COMPONENT_DEFS.map((def, idx) => {
                const rel = idx - centerIdx;
                const x = rowCenterX + rel * span;
                const y = strategyY;
                const n = { x, y };

                /* v1.59.13：先画"信号 → 该分量"派生依赖虚线（最底层）
                 * v1.59.16：每节点存 deriveLinks 引用，_render* 时按 intensity 驱动 opacity/width */
                const drivers = HINT_DRIVER_SIGNALS[def.key] || [];
                const compDeriveLinks = [];
                for (const sigKey of drivers) {
                    const src = this._geom.get(sigKey);
                    if (!src) continue;
                    const ctrlX = (src.x + x) / 2;
                    const ctrlY = (src.y + y) / 2 + (y - src.y) * 0.18;
                    const d = bezierPath(src, { x: ctrlX, y: ctrlY }, n);
                    const link = this._svgEl('path', {
                        d, fill: 'none',
                        stroke: def.color, 'stroke-width': 0.8, 'stroke-opacity': 0.22,
                        'stroke-linecap': 'round', 'stroke-dasharray': '2 3',
                        class: 'dfv-derive-link dfv-derive-link--hint',
                    });
                    svg.insertBefore(link, svg.firstChild);
                    this._hintDeriveLinks.push({ el: link, color: def.color });
                    compDeriveLinks.push({ el: link });
                }

                const group = this._svgEl('g', { class: 'dfv-strategy-node', 'data-key': def.key });
                this._attachNodeTitle(group, STRATEGY_TIP[def.key]);
                const baseR = compR;
                const glow = this._svgEl('circle', {
                    cx: x, cy: y, r: baseR + 3.2, fill: `${def.color}22`, stroke: 'none', class: 'dfv-strategy-node-glow',
                }, group);
                const node = this._svgEl('circle', {
                    cx: x, cy: y, r: baseR, fill: 'rgba(15,23,42,0.90)', stroke: `${def.color}cc`,
                    'stroke-width': 1.2, class: 'dfv-strategy-node-core',
                }, group);
                const inner = this._svgEl('circle', {
                    cx: x, cy: y, r: (baseR * 0.58).toFixed(1), fill: 'rgba(255,255,255,0.12)', class: 'dfv-strategy-node-inner',
                }, group);
                const spec = this._svgEl('ellipse', {
                    cx: (x - 3.0).toFixed(1), cy: (y - 3.4).toFixed(1), rx: '2.6', ry: '1.6',
                    fill: 'rgba(255,255,255,0.45)', class: 'dfv-strategy-node-spec',
                }, group);
                const labelText = this._svgEl('text', {
                    x, y: y - baseR - 2.8, 'text-anchor': 'middle', class: 'dfv-strategy-node-label',
                }, group);
                labelText.textContent = def.label;
                const valueText = this._svgEl('text', {
                    x, y: y + 4.3, 'text-anchor': 'middle', class: 'dfv-strategy-node-value',
                }, group);
                valueText.textContent = '—';
                /* v1.59.12：out/inbound 字段保留为 null，下游 _renderStressToStrategy 已加 null-safe 守卫 */
                return {
                    ...def,
                    pos: n,
                    baseR,
                    node,
                    inner,
                    glow,
                    spec,
                    valueText,
                    deriveLinks: compDeriveLinks,
                    out: null,
                    inbound: null,
                };
            });
            this._strategyLinkEl = { trunk: null, comps };
        }

        /* 3.6) v1.59.15 派生②.b：spawnTargets 6 维目标向量（紧凑横排）+ 派生依赖虚线。
         *
         * 数据源：insight.spawnHints.spawnTargets.{shapeComplexity, solutionSpacePressure,
         *   clearOpportunity, spatialPressure, payoffIntensity, novelty}
         * 派生函数：adaptiveSpawn.deriveSpawnTargets(stress, profile, ctx, fill, boardRisk, delight)
         *
         * 节点尺寸 r=10（比 5 核心分量 r=15 略小），与 5 核心分量形成视觉层级。 */
        {
            const stN = SPAWN_TARGET_DEFS.length;
            const stCenterIdx = (stN - 1) / 2;
            const stR = Math.max(8, Math.min(12, compR - 4));
            const stSpan = Math.max(stR * 2.05, Math.min(28, span * 0.74));
            const stCenterX = stressX;
            this._spawnTargetEls = SPAWN_TARGET_DEFS.map((def, idx) => {
                const rel = idx - stCenterIdx;
                const x = stCenterX + rel * stSpan;
                const y = spawnTargetsY;
                const n = { x, y };

                const drivers = SPAWN_TARGET_DRIVER_SIGNALS[def.key] || [];
                const targetDeriveLinks = [];
                for (const sigKey of drivers) {
                    const src = this._geom.get(sigKey);
                    if (!src) continue;
                    const ctrlX = (src.x + x) / 2;
                    const ctrlY = (src.y + y) / 2 + (y - src.y) * 0.14;
                    const d = bezierPath(src, { x: ctrlX, y: ctrlY }, n);
                    const link = this._svgEl('path', {
                        d, fill: 'none',
                        stroke: def.color, 'stroke-width': 0.7, 'stroke-opacity': 0.18,
                        'stroke-linecap': 'round', 'stroke-dasharray': '2 3',
                        class: 'dfv-derive-link dfv-derive-link--target',
                    });
                    svg.insertBefore(link, svg.firstChild);
                    this._hintDeriveLinks.push({ el: link, color: def.color });
                    targetDeriveLinks.push({ el: link });
                }

                const group = this._svgEl('g', { class: 'dfv-target-node', 'data-key': def.key });
                this._attachNodeTitle(group, TARGET_TIP[def.key]);
                const glow = this._svgEl('circle', {
                    cx: x, cy: y, r: stR + 2.4, fill: `${def.color}22`, stroke: 'none', class: 'dfv-target-node-glow',
                }, group);
                const node = this._svgEl('circle', {
                    cx: x, cy: y, r: stR, fill: 'rgba(15,23,42,0.88)', stroke: `${def.color}cc`,
                    'stroke-width': 1.0, class: 'dfv-target-node-core',
                }, group);
                const labelText = this._svgEl('text', {
                    x, y: y - stR - 2.0, 'text-anchor': 'middle', class: 'dfv-target-node-label',
                }, group);
                labelText.textContent = def.label;
                const valueText = this._svgEl('text', {
                    x, y: y + 3.2, 'text-anchor': 'middle', class: 'dfv-target-node-value',
                }, group);
                valueText.textContent = '—';
                this._geom.set(`target:${def.key}`, { x, y, r: stR });
                return { ...def, pos: n, baseR: stR, node, glow, valueText, deriveLinks: targetDeriveLinks };
            });
        }

        /* 3.7) v1.59.15 派生②.c：4 调度参数（紧凑横排）+ 派生依赖虚线。
         *
         * 数据源：insight.spawnHints.{multiClearBonus, multiLineTarget, perfectClearBoost, iconBonusTarget}
         * 各自由独立 derive 函数计算（详见 SCHEDULE_PARAM_DRIVER_SIGNALS 注释）。 */
        {
            const spN = SCHEDULE_PARAM_DEFS.length;
            const spCenterIdx = (spN - 1) / 2;
            const spR = Math.max(8, Math.min(12, compR - 4));
            const spSpan = Math.max(spR * 2.4, Math.min(36, span * 0.92));
            const spCenterX = stressX;
            this._scheduleParamEls = SCHEDULE_PARAM_DEFS.map((def, idx) => {
                const rel = idx - spCenterIdx;
                const x = spCenterX + rel * spSpan;
                const y = scheduleParamsY;
                const n = { x, y };

                const drivers = SCHEDULE_PARAM_DRIVER_SIGNALS[def.key] || [];
                const schedDeriveLinks = [];
                for (const sigKey of drivers) {
                    const src = this._geom.get(sigKey);
                    if (!src) continue;
                    const ctrlX = (src.x + x) / 2;
                    const ctrlY = (src.y + y) / 2 + (y - src.y) * 0.10;
                    const d = bezierPath(src, { x: ctrlX, y: ctrlY }, n);
                    const link = this._svgEl('path', {
                        d, fill: 'none',
                        stroke: def.color, 'stroke-width': 0.7, 'stroke-opacity': 0.18,
                        'stroke-linecap': 'round', 'stroke-dasharray': '2 3',
                        class: 'dfv-derive-link dfv-derive-link--schedule',
                    });
                    svg.insertBefore(link, svg.firstChild);
                    this._hintDeriveLinks.push({ el: link, color: def.color });
                    schedDeriveLinks.push({ el: link });
                }

                const group = this._svgEl('g', { class: 'dfv-schedule-node', 'data-key': def.key });
                /* v1.60.12：SVG <title> 提示 — hover 调度节点看到语义 + "何时被点亮"
                 * v1.60.17：统一用 _attachNodeTitle helper（保证 title 是 group 第一个子元素，
                 *           Safari/旧 WebView SVG spec 严格兼容） */
                this._attachNodeTitle(group, def.tip);
                const glow = this._svgEl('circle', {
                    cx: x, cy: y, r: spR + 2.4, fill: `${def.color}22`, stroke: 'none', class: 'dfv-schedule-node-glow',
                }, group);
                const node = this._svgEl('circle', {
                    cx: x, cy: y, r: spR, fill: 'rgba(15,23,42,0.88)', stroke: `${def.color}cc`,
                    'stroke-width': 1.0, class: 'dfv-schedule-node-core',
                }, group);
                const labelText = this._svgEl('text', {
                    x, y: y - spR - 2.0, 'text-anchor': 'middle', class: 'dfv-schedule-node-label',
                }, group);
                labelText.textContent = def.label;
                const valueText = this._svgEl('text', {
                    x, y: y + 3.2, 'text-anchor': 'middle', class: 'dfv-schedule-node-value',
                }, group);
                valueText.textContent = '—';
                this._geom.set(`schedule:${def.key}`, { x, y, r: spR });
                return { ...def, pos: n, baseR: spR, node, glow, valueText, deriveLinks: schedDeriveLinks };
            });
        }

        /* 3.8) v1.59.13：派生依赖虚线"信号 → intent"。
         *
         * 按 INTENT_RULES.guard 实际读取的底层字段映射（intentResolver.js L86-164）：
         *   relief ← frust（playerDistress 由 frustrationLevel 派生）
         *   harvest ← boardFill（geometry）
         *   flow ← flow（rhythmPhase 由 flowState 派生）
         *   sprint/pressure 主要受 stress 自身约束（跳过——stress 本就并列派生）
         * 简化为 5 信号 → intent 的弱虚线集合，与"信号→分量"同视觉语言（dasharray '2 3'）。 */
        {
            const intentColor = '#a78bfa';
            const intentGeom = this._geom.get('spawnIntent');
            if (intentGeom) {
                const inX = intentGeom.x;
                const inY = intentGeom.y;
                for (const sigKey of INTENT_DRIVER_SIGNALS) {
                    const src = this._geom.get(sigKey);
                    if (!src) continue;
                    const ctrlX = (src.x + inX) / 2;
                    const ctrlY = (src.y + inY) / 2 + (inY - src.y) * 0.10;
                    const d = bezierPath(src, { x: ctrlX, y: ctrlY }, { x: inX, y: inY - intentR * 0.55 });
                    const link = this._svgEl('path', {
                        d, fill: 'none',
                        stroke: intentColor, 'stroke-width': 0.8, 'stroke-opacity': 0.22,
                        'stroke-linecap': 'round', 'stroke-dasharray': '2 3',
                        class: 'dfv-derive-link dfv-derive-link--intent',
                    });
                    svg.insertBefore(link, svg.firstChild);
                    this._intentDeriveLinks.push({ el: link, color: intentColor });
                }
                /* v1.59.16：intent 节点的 deriveLinks 用整个 _intentDeriveLinks（intent 球只有一个） */
            }
        }

        /* 3.9) v1.59.18 阶段③ 出块（blockSpawn）—— 3 chosen shape 节点行 + 4 派生层多源派生虚线。
         *
         * 数据源：insight.spawnDiagnostics.chosen[]（来自 blockSpawn.getLastSpawnDiagnostics()）
         *   每个 chosen = { id, category, reason }；reason ∈ {'clear','perfectClear','weighted','fallback'}
         *
         * **v1.59.17 → v1.59.18 关键修正**：
         *   旧版仅 intent → 3 chosen 拉 cyan 实色 bezier，暗示"intent 单独决定 shape"——
         *   这与代码事实矛盾：blockSpawn.generateDockShapes 综合使用 5 hints + 6 targets +
         *   4 schedule + intent 多维输入打分（详见 blockSpawn.js scoreShape）。
         *   新版撤掉单源实色线，改为从 **4 个派生层"行中央代表点"分别拉 1 条细虚线** 到
         *   每个 chosen 节点（共 4×3=12 条弱虚线），视觉表达"多源融合派生"。
         *   与 5 派生层接收"信号多源派生虚线"的视觉语言对称。
         *
         * 节点本体增强：
         *   - 半径 r=17（放大以容纳 5×5 mini grid 形状缩略图）
         *   - 核心圆 → 替换为 SVG nested group：mini 5×5 grid 直接绘出 shape.data，
         *     玩家一眼能识别"3×3 方块 / L1 / T↑..."而非仅靠文字猜
         *   - 上方居中：完整中文 reason（"主消行/完美消行/加权选/兜底"）
         *   - 下方居中：紧凑可读 id 简写（"3×3" / "L1" / "T↑"）
         *   - SVG <title> tooltip：hover 显示原始 id + reason 完整解释（SPAWN_REASON_TIP） */
        {
            const chosenN = 3;
            const chosenCenterIdx = (chosenN - 1) / 2;
            const chosenR = Math.max(15, Math.min(19, compR + 2));
            const chosenSpan = Math.max(chosenR * 3.2, Math.min(72, span * 1.85));
            const chosenCenterX = stressX;

            /* 4 派生层 → chosen 的多源虚线源点（每层"行中央"代表点） */
            const upstreamLayers = [
                { x: stressX, y: strategyY,       color: '#22d3ee', name: 'strategy' },
                { x: stressX, y: spawnTargetsY,   color: '#a78bfa', name: 'targets' },
                { x: stressX, y: scheduleParamsY, color: '#fbbf24', name: 'schedule' },
                { x: intentX, y: intentYNew,     color: '#7dd3fc', name: 'intent' },
            ];

            this._chosenShapeEls = [];
            this._chosenDeriveLinks = [];
            for (let idx = 0; idx < chosenN; idx++) {
                const rel = idx - chosenCenterIdx;
                const x = chosenCenterX + rel * chosenSpan;
                const y = spawnChosenY;
                const n = { x, y };

                /* 4 派生层 → 该 chosen 的多源派生虚线（弱色、最底层，与"信号→派生"虚线语言对称） */
                const incoming = [];
                for (const layer of upstreamLayers) {
                    const ctrlX = (layer.x + x) / 2 + rel * 18;
                    const ctrlY = (layer.y + y) / 2 + (y - layer.y) * 0.18;
                    const d = bezierPath({ x: layer.x, y: layer.y }, { x: ctrlX, y: ctrlY }, { x, y: y - chosenR * 0.85 });
                    const link = this._svgEl('path', {
                        d, fill: 'none',
                        stroke: layer.color, 'stroke-width': 0.7, 'stroke-opacity': 0.18,
                        'stroke-linecap': 'round', 'stroke-dasharray': '2 3',
                        class: `dfv-derive-link dfv-derive-link--chosen dfv-derive-link--chosen-${layer.name}`,
                        'data-to-chosen': idx,
                        'data-source-layer': layer.name,
                    });
                    svg.insertBefore(link, svg.firstChild);
                    /* v1.59.21 方案 C：toChosenIdx + source 记入 link，方便 hover 反向追溯时按
                     * (chosen idx, source layer) 二维索引精准点亮"驱动该 chosen 的具体派生层 → chosen 那一条虚线"。 */
                    incoming.push({ el: link, color: layer.color, source: layer.name, toChosenIdx: idx });
                }
                this._chosenDeriveLinks.push(...incoming);

                /* chosen shape 节点本体 */
                const group = this._svgEl('g', { class: 'dfv-chosen-node', 'data-idx': idx });
                /* v1.59.21 方案 C：hover 反向高亮——根据 chosen[idx].topDriver.key 追溯到驱动派生节点
                 * + 上游信号节点，其余节点淡出。让玩家主动探索时看到完整"信号→派生→此 chosen"因果链。
                 * 使用 SVG mouseenter/mouseleave（pointerenter 在 Safari/旧 WebView 兼容性略弱）。 */
                group.addEventListener('mouseenter', () => this._setDriverHighlight(idx));
                group.addEventListener('mouseleave', () => this._clearDriverHighlight());

                /* SVG <title> tooltip：原生浏览器 hover 提示，无需自建 tooltip 系统 */
                const titleEl = this._svgEl('title', {}, group);
                titleEl.textContent = '—';

                const glow = this._svgEl('circle', {
                    cx: x, cy: y, r: chosenR + 3.0, fill: 'rgba(125,211,252,0.12)', stroke: 'none',
                    class: 'dfv-chosen-node-glow',
                }, group);
                const bg = this._svgEl('circle', {
                    cx: x, cy: y, r: chosenR, fill: 'rgba(15,23,42,0.92)',
                    stroke: 'rgba(125,211,252,0.55)', 'stroke-width': 1.1,
                    class: 'dfv-chosen-node-bg',
                }, group);

                /* mini 5×5 grid 容器（v1.59.18 关键解释手段：一眼可见 shape）。
                 * 每 cell rect 由 _renderChosenShapes 动态创建/复用，初始空 group。 */
                const gridG = this._svgEl('g', {
                    class: 'dfv-chosen-node-grid',
                    'data-cx': x.toFixed(1), 'data-cy': y.toFixed(1),
                }, group);

                /* 上方居中：完整 reason 中文 */
                const reasonText = this._svgEl('text', {
                    x, y: y - chosenR - 4, 'text-anchor': 'middle',
                    class: 'dfv-chosen-node-reason',
                }, group);
                reasonText.textContent = '';

                /* 下方居中：紧凑 id 简写 */
                const idText = this._svgEl('text', {
                    x, y: y + chosenR + 9, 'text-anchor': 'middle',
                    class: 'dfv-chosen-node-id',
                }, group);
                idText.textContent = '—';

                /* v1.59.20：再下一行常驻"因·XXX"主驱动因子小字（gap 解释关键）。
                 * blockSpawn._estimateTopDriver 已在 chosenMeta 写入 topDriver = { key, label }，
                 * 让玩家不需 hover 就能在 DFV 直接看到"为什么是这块"（消行候选只是路径
                 * 分类，"因·可消2行 / 因·机动高 / 因·长条权重 33%"才是真正的选中理由）。 */
                const driverText = this._svgEl('text', {
                    x, y: y + chosenR + 18, 'text-anchor': 'middle',
                    class: 'dfv-chosen-node-driver',
                }, group);
                driverText.textContent = '';

                /* v1.60.6 缺口 #4：⚡ 事件注入 badge —— chosenMeta.original/originalMeta/injectedAt
                 * 存在时显示在 chosen 节点右上角。relief 子类用青色 ⚡，pressure 用橙色 ⚡，
                 * 鼠标悬停 group 时 SVG <title> 已带"原 X → 替换为 Y（因 …）"完整 audit。
                 * 默认 display:none，仅注入时显式 setAttribute('display','inline')，无注入零渲染开销。 */
                const injectBadge = this._svgEl('text', {
                    x: x + chosenR - 1, y: y - chosenR + 4,
                    'text-anchor': 'middle',
                    class: 'dfv-chosen-node-inject-badge',
                    display: 'none',
                }, group);
                injectBadge.textContent = '⚡';

                /* v1.60.21：⧈ 双胞胎/三胞胎 badge —— chosenMeta.duplicateGroup 存在时显示在
                 * chosen 节点左上角（与 ⚡ 注入 badge 互不挤位）。replica 紫色实心、main 紫色描边。 */
                const dupBadge = this._svgEl('text', {
                    x: x - chosenR + 1, y: y - chosenR + 4,
                    'text-anchor': 'middle',
                    class: 'dfv-chosen-node-dup-badge',
                    display: 'none',
                }, group);
                dupBadge.textContent = '⧈';

                this._geom.set(`chosen:${idx}`, { x, y, r: chosenR });
                this._chosenShapeEls.push({
                    idx, pos: n, baseR: chosenR, bg, glow, gridG, idText, reasonText, driverText, titleEl,
                    injectBadge, dupBadge,
                    incoming,
                });
            }

            /* 阶段 3 信息条：attempt / solutionRejects 总数（chosen 行右侧 mini badge） */
            const lastChosenX = chosenCenterX + (chosenN - 1 - chosenCenterIdx) * chosenSpan;
            const attemptText = this._svgEl('text', {
                x: lastChosenX + chosenR + 14,
                y: spawnChosenY + 2,
                'text-anchor': 'start',
                class: 'dfv-spawn-attempt-badge',
            });
            attemptText.textContent = '';
            this._spawnAttemptBadge = attemptText;
        }

        /* 4) 中央灯环（pulse 时显形）— 跟随 stress 球几何（v1.59.12 用新 stressYNew） */
        const ring = this._svgEl('circle', {
            cx: stressX, cy: stressYNew, r: stressR,
            fill: 'none', stroke: 'transparent', 'stroke-width': 2,
            class: 'dfv-stress-ring',
        });
        svg.appendChild(ring);
        this._stressRing = ring;
        this._stressBaseR = stressR;

        /* v1.51.8：为每个 SIGNAL_NODE 预创建 baseline 连线（始终可见，弱灰），
         * 让 10 个信号节点都"挂上"压力球，避免「无贡献时连线消失」的体验断点。
         * `_renderContributionEdges` 在 baseline 上原地强化（颜色 / 粗细 / 不透明度）。
         * 边按 source key 聚合（多个 breakdown 字段映射同一 source 时累加）。 */
        const stressGeom = { x: stressX, y: stressYNew, r: stressR };
        for (const sig of SIGNAL_NODES) {
            const src = this._geom.get(sig.key);
            if (!src) continue;
            const ctrl = { x: (src.x + stressGeom.x) / 2, y: (src.y + stressGeom.y) / 2 - 25 };
            const d = bezierPath(src, ctrl, stressGeom);
            const path = this._svgEl('path', {
                d, fill: 'none',
                stroke: '#475569', 'stroke-width': 0.7, 'stroke-opacity': 0.28,
                'stroke-linecap': 'round', class: 'dfv-edge dfv-edge--baseline',
            });
            const halo = this._svgEl('path', {
                d, fill: 'none',
                stroke: '#475569', 'stroke-width': 2.2, 'stroke-opacity': 0,
                'stroke-linecap': 'round', class: 'dfv-edge dfv-edge--halo',
            });
            const flow = this._svgEl('path', {
                d, fill: 'none',
                stroke: '#475569', 'stroke-width': 1.2, 'stroke-opacity': 0,
                'stroke-linecap': 'round', class: 'dfv-edge dfv-edge--flow',
            });
            svg.insertBefore(path, svg.firstChild);
            svg.insertBefore(halo, svg.firstChild);
            svg.insertBefore(flow, svg.firstChild);
            this._edgeEls.set(sig.key, { path, halo, flow });
        }
    }

    _svgEl(tag, attrs = {}, parent = null) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const k in attrs) {
            if (k === 'class') el.setAttribute('class', attrs[k]);
            else if (attrs[k] != null) el.setAttribute(k, attrs[k]);
        }
        (parent || this._svg).appendChild(el);
        return el;
    }

    /**
     * v1.60.17：给节点 group 附加 SVG <title> 子元素（浏览器原生 hover tooltip）。
     * 配合 CSS cursor:help 让"哪些节点可 hover"和"hover 看到什么"语义一致，避免
     * "光标变化但 hover 一片空白"的负面体验。
     *
     * @param {SVGGElement} group  节点 group 容器
     * @param {string}      text   tip 文案（空字符串/undefined 静默跳过）
     */
    _attachNodeTitle(group, text) {
        if (!group || !text) return;
        /* title 作为 group 第一个子元素插入 —— SVG spec 要求 <title> 是 group 的第一个直接
         * 子元素，否则部分浏览器 hover 不触发 tooltip（如 Safari）。 */
        const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        titleEl.textContent = text;
        group.insertBefore(titleEl, group.firstChild);
    }

    _addSignalNode(key, label, r) {
        const g = this._geom.get(key);
        const sigDef = SIGNAL_NODES.find((s) => s.key === key);
        const baseColor = sigDef?.baseColor || '#7dd3fc';
        const group = this._svgEl('g', {
            class: 'dfv-node dfv-node--signal dfv-node--idle',
            'data-key': key,
            style: `--node-base:${baseColor}`,
        });
        this._attachNodeTitle(group, SIGNAL_TIP[key]);
        /* v1.59.8：外光环用 baseColor 而非通用 cyan，让"身份色"在 idle 时也可读 */
        this._svgEl('circle', {
            cx: g.x, cy: g.y, r: r + 2.4, fill: `${baseColor}1f`, stroke: 'none',
            class: 'dfv-node-aura',
        }, group);
        /* v1.59.8：核心 fill 直接用 baseColor（idle 时由 CSS opacity 弱化），
         * stroke 用 baseColor 加深，永远显示身份——避免"初始全灰"。 */
        const core = this._svgEl('circle', {
            cx: g.x, cy: g.y, r, fill: baseColor, stroke: _shadeColor(baseColor, -28), 'stroke-width': 1.5,
            class: 'dfv-node-core',
        }, group);
        const labelText = this._svgEl('text', { x: g.x - r - 6, y: g.y + 4, 'text-anchor': 'end', class: 'dfv-node-label' }, group);
        labelText.textContent = label;
        const valueText = this._svgEl('text', {
            x: g.x, y: g.y + 4, 'text-anchor': 'middle', class: 'dfv-node-value',
        }, group);
        valueText.textContent = '—';
        this._nodeEls.set(key, { group, core, valueText, baseColor });
    }

    _addStressBall() {
        const g = this._geom.get('stress');
        const group = this._svgEl('g', { class: 'dfv-node dfv-node--stress', 'data-key': 'stress' });
        this._attachNodeTitle(group, STRESS_TIP);
        this._svgEl('circle', {
            cx: g.x, cy: g.y, r: g.r + 12, fill: 'rgba(56,189,248,0.06)', class: 'dfv-stress-glow-outer',
        }, group);
        this._svgEl('circle', {
            cx: g.x, cy: g.y, r: g.r + 6, fill: 'rgba(56,189,248,0.10)', class: 'dfv-stress-glow-mid',
        }, group);
        const core = this._svgEl('circle', {
            cx: g.x, cy: g.y, r: g.r, fill: '#38bdf8', stroke: '#fff', 'stroke-width': 2, class: 'dfv-stress-core',
        }, group);
        const inner = this._svgEl('circle', {
            cx: g.x, cy: g.y, r: (g.r * 0.58).toFixed(1), fill: 'rgba(255,255,255,0.12)', class: 'dfv-stress-core-inner',
        }, group);
        const spec = this._svgEl('ellipse', {
            cx: (g.x - g.r * 0.22).toFixed(1),
            cy: (g.y - g.r * 0.25).toFixed(1),
            rx: (g.r * 0.22).toFixed(1),
            ry: (g.r * 0.12).toFixed(1),
            fill: 'rgba(255,255,255,0.30)',
            class: 'dfv-stress-spec',
        }, group);
        const labelText = this._svgEl('text', { x: g.x, y: g.y - 6, 'text-anchor': 'middle', class: 'dfv-stress-label' }, group);
        labelText.textContent = _ti('dfv.stress', '压力');
        const valueText = this._svgEl('text', { x: g.x, y: g.y + 14, 'text-anchor': 'middle', class: 'dfv-stress-value' }, group);
        valueText.textContent = '0.00';
        this._stressBall = { group, core, inner, spec, valueText };
    }

    _addSpawnIntentNode() {
        const g = this._geom.get('spawnIntent');
        /* v1.59.8：intent 默认身份色用 maintain 的中性紫色（#a78bfa），让"意图节点"
         * 在初始/无数据时也能识别，不再退化为深灰。具体 intent 值来时 _renderSpawnIntent
         * 再切换到 SPAWN_INTENT_COLOR[intent]。 */
        const baseColor = '#a78bfa';
        const group = this._svgEl('g', {
            class: 'dfv-node dfv-node--intent dfv-node--idle',
            'data-key': 'spawnIntent',
            style: `--node-base:${baseColor}`,
        });
        this._attachNodeTitle(group, INTENT_TIP);
        this._svgEl('circle', {
            cx: g.x, cy: g.y, r: (g.r + 8).toFixed(1), fill: 'none',
            stroke: `${baseColor}40`, 'stroke-width': 1.2, class: 'dfv-intent-orbit',
        }, group);
        const hex = this._svgEl('circle', {
            cx: g.x, cy: g.y, r: g.r, fill: baseColor, stroke: _shadeColor(baseColor, -25),
            'stroke-width': 2, 'fill-opacity': 0.55, class: 'dfv-intent-core',
        }, group);
        const labelText = this._svgEl('text', { x: g.x, y: g.y - 4, 'text-anchor': 'middle', class: 'dfv-intent-label' }, group);
        labelText.textContent = _ti('dfv.intent', '意图');
        const valueText = this._svgEl('text', {
            x: g.x, y: g.y + 12, 'text-anchor': 'middle',
            class: 'dfv-intent-value',
        }, group);
        valueText.textContent = '—';
        this._intentEl = { group, hex, valueText };
    }

    /* ── 主循环：每帧拉数据 + 缓动 + 重绘 ─────────────────────────── */

    _loop() {
        /* v1.55.1 留作向后兼容（早期外部调用入口）；推荐通过 _scheduleNext 驱动。 */
        if (!this._open) return;
        this._tick();
        if (!this._rafId) this._scheduleNext(0);
    }

    _tick() {
        const game = this._game;
        if (!game) return;
        const profile = game.playerProfile;
        const insight = game._lastAdaptiveInsight;
        if (!profile) {
            this._renderEmpty();
            return;
        }

        // 当前盘面 fill（每帧实时拿）
        const liveBoardFill = (() => {
            try { return game.grid?.getFillRatio?.() ?? 0; } catch { return 0; }
        })();

        const ctx = {
            profile: {
                skillLevel: profile.skillLevel,
                momentum: profile.momentum,
                frustrationLevel: profile.frustrationLevel,
                flowState: profile.flowState,
                sessionPhase: profile.sessionPhase,
                cognitiveLoad: profile.cognitiveLoad,
                recentComboStreak: profile.recentComboStreak ?? 0,
                boardFill: liveBoardFill,
                metrics: profile.metrics ?? {},
            },
            insight: insight || {},
        };

        /* spawn 脉冲 */
        const round = profile.spawnRoundIndex;
        if (Number.isFinite(round) && round !== this._lastSpawnRoundSeen) {
            if (this._lastSpawnRoundSeen !== null && insight) this._triggerSpawnPulse(insight);
            this._lastSpawnRoundSeen = round;
            this._lastActiveAt = performance.now();
            if (this._pulseTag) this._pulseTag.textContent = `R${round}`;
        }

        /* v1.55.1 数据指纹去抖：相同指纹时跳过 SVG 重写（节点 / stress 球 / intent / 边 / 策略），
         * 只保留 Canvas 粒子动画推进与 sparkline 采样。
         *
         * v1.57.5 §A/F：把 liveBoardFill / liveClearRate 也喂进指纹——旧指纹只看
         * insight/profile 决策侧字段，会让玩家落子后的"占盘 0.40 vs 0.69"双显 bug
         * （左侧节点被去抖跳过、底部 sparkline 实时刷新）。同样修复消行率双显。 */
        const liveClearRate = Number(profile.metrics?.clearRate) || 0;
        const fp = _dfvFingerprint(insight, profile, { boardFill: liveBoardFill, clearRate: liveClearRate });
        const dataChanged = fp !== this._lastFingerprint;
        if (dataChanged) {
            this._lastFingerprint = fp;
            this._lastActiveAt = performance.now();
        }
        const hasActiveParticles = this._particles.length > 0;
        const inSpawnPulseWindow = performance.now() < this._stressPulseUntil + 80;

        /* v1.59.19：左侧 SVG 节点也加"每 12 帧兜底刷新"（active≈0.4s / idle≈2s 一次）—— 与右侧
         * details 渲染节流保持一致（详见下方 L2077 _renderDetails 调用）。历史 v1.55.1 引入指纹
         * 去抖时仅护城 SVG 节点（dataChanged 才渲染），不护城右侧详情。这会在以下场景产生 bug：
         *   - 新开局后 DFV 已打开但首次 _tick 时 insight 还未写入 → 节点全 '—'，fingerprint
         *     = 'empty' 被记入 _lastFingerprint；之后 _captureAdaptiveInsight 才写入完整数据，
         *     若数据指纹与上一局结束时巧合相同（极少但发生），节点永远停在 '—'。
         *   - 用户截图：右侧"形状权重 33.1%/22.6%/15.6%、出块目标 0.30/0.11/0.09、压力贡献
         *     会话弧线 -0.080、调度提示 维持心流"全部有值，但左侧 10 信号 + 5 hints + 6 targets
         *     + 4 schedule + intent + 3 chosen 节点全 '—'——左右数据源同源却显示不一致。
         * 修复后左侧节点与右侧详情同频兜底，保证 ≤2 秒内必有一次重渲染消除 '—' 残留。 */
        const renderTick = dataChanged || inSpawnPulseWindow || (this._frameCount % 12 === 0);

        if (renderTick) {
            /* 1) 左列信号节点 */
            SIGNAL_NODES.forEach((sig) => this._renderSignalNode(sig, ctx));
            /* 2) 中央 stress 球 */
            this._renderStressBall(insight);
            /* 3) spawnIntent 节点 */
            this._renderSpawnIntent(insight);
            /* 3.5) 压力 -> 出块策略（左侧算法呈现） */
            this._renderStressToStrategy(insight);
            /* 3.6) v1.59.15：spawnTargets 6 维目标向量 */
            this._renderSpawnTargets(insight);
            /* 3.7) v1.59.15：4 调度参数（multiClear/multiLine/perfectClear/iconBonus） */
            this._renderScheduleParams(insight);
            /* 3.8) v1.59.17：阶段③ 出块（blockSpawn 3 chosen shape + attempt + solutionRejects） */
            this._renderChosenShapes(insight);
            /* 4) stressBreakdown 贡献边 */
            this._renderContributionEdges(insight);
        }

        /* v1.55.1 _edgeFlowPhase 仅在 active 时推进，idle（无粒子 + 无数据变化）时静止，
         * 避免无意义的 stroke-dashoffset 更新触发 SVG 重合成。 */
        if (hasActiveParticles || dataChanged || inSpawnPulseWindow) {
            this._edgeFlowPhase = (this._edgeFlowPhase + 1.25) % 10000;
        }

        /* 5) Canvas 粒子（有粒子时绘制；无粒子时只 clear 一次） */
        this._renderParticles();

        /* 6) sparkline 采样 + 渲染：active 档 30fps 时全部走，idle 档自然降到 6fps */
        const stressVal = Number.isFinite(insight?.stress) ? insight.stress : NaN;
        this._sampleSeries({
            stress: stressVal,
            momentum: Number(profile.momentum) || 0,
            clearRate: liveClearRate,
            boardFill: liveBoardFill,
            frust: Number(profile.frustrationLevel) || 0,
        });
        this._frameCount++;
        /* 30fps 下每 2 帧渲染一次 ≈ 15Hz，已经够丝滑；idle 档（6fps）每帧都画 */
        if (this._frameCount % 2 === 0 || !hasActiveParticles) this._renderSparks();

        /* 7) HTML 详情区：数据变化时即刻；否则每 12 帧（active≈0.4s / idle≈2s）兜底刷一次 */
        if (dataChanged || this._frameCount % 12 === 0) this._renderDetails(insight, profile);

        /* 8) v1.59：决策动态层（左侧球状图下方）——
         *   §A 意图时间线（spawn round 聚合 chip 链 + 切换原因）
         *   §B stress 分量正负堆叠（左负-右正水平条 + sum_pos/|sum_neg|/net）
         *   §C 响应灵敏度三灯（玩家信号 vs 算法响应 Pearson 粗估）
         * 数据来源与右侧 details 同源（insight / profile / game._insightLiveHistory），
         * 共用 _frameCount % 12 节流节奏。 */
        if (dataChanged || this._frameCount % 12 === 0) this._renderDynamicsLayer(insight, profile);
    }

    /**
     * v1.59.6：渲染右栏决策动态段——精简为 2 个模块：
     *   §B 压力归因（stress 分量竖排排序条目）
     *   §C 响应灵敏度（玩家信号 vs 算法响应 Pearson 粗估）
     *
     * v1.59.6 删除 §A 意图时间线：实际使用中 N 轮意图 chip 链信息密度低，
     * 切换次数已统计在右栏 "出块意图" 段，时间线本身不提供新增 insight，
     * 且占用右栏垂直空间挤占其他段（一删立刻让 7 段无需滚动）。
     *
     * 数据要求：game._insightLiveHistory 必须存在（panel 在 _appendLiveInsightSample
     * 中写入）。若 panel 未初始化或 history 为空，模块各自降级为 empty 提示，不抛错。
     */
    _renderDynamicsLayer(insight, profile) {
        if (!this._dynamicsHost) return;
        const history = Array.isArray(this._game?._insightLiveHistory)
            ? this._game._insightLiveHistory : [];
        const stackHtml = _dfvRenderStressStack(insight);
        const sensHtml = _dfvRenderSens(history, 12);
        this._dynamicsHost.innerHTML = `${stackHtml}${sensHtml}`;
        void profile; // 当前模块未直接用 profile（保留签名以便后续扩展）
    }

    _triggerSpawnPulse(insight) {
        this._stressPulseUntil = performance.now() + 400;
        /* v1.59.2：spawn 时触发全栏一次 shock 动画（径向扩散光环），强化"信号→决策"的炸裂感。
         * 通过 class toggle 触发 CSS keyframe，0.62s 后清除——比 setTimeout 更"可视"地表达
         * 出"算法刚做出一次决策"的瞬时事件。 */
        if (this._stageEl) {
            this._stageEl.classList.remove('dfv-stage--shock');
            void this._stageEl.getBoundingClientRect();
            this._stageEl.classList.add('dfv-stage--shock');
            if (this._shockTimer) clearTimeout(this._shockTimer);
            this._shockTimer = setTimeout(() => {
                this._stageEl?.classList.remove('dfv-stage--shock');
                this._shockTimer = 0;
            }, 660);
        }
        const breakdown = insight.stressBreakdown || {};
        const stressGeom = this._geom.get('stress');
        const intentGeom = this._geom.get('spawnIntent');
        for (const key of Object.keys(breakdown)) {
            const v = breakdown[key];
            if (!Number.isFinite(v) || Math.abs(v) < 0.01) continue;
            const srcKey = BREAKDOWN_TO_SOURCE[key] || 'skill';
            const srcGeom = this._geom.get(srcKey);
            if (!srcGeom) continue;
            const ctrl = { x: (srcGeom.x + stressGeom.x) / 2, y: (srcGeom.y + stressGeom.y) / 2 - 50 + Math.random() * 30 };
            const count = Math.min(3, Math.max(1, Math.round(Math.abs(v) * 25)));
            for (let i = 0; i < count; i++) {
                this._particles.push({
                    p0: { x: srcGeom.x, y: srcGeom.y },
                    p1: ctrl,
                    p2: { x: stressGeom.x, y: stressGeom.y },
                    t: -i * 0.08,
                    dur: 0.9 + Math.random() * 0.4,
                    color: v >= 0 ? '#fb923c' : '#22d3ee',
                    size: 2.4 + Math.random() * 1.5,
                });
            }
        }

        /* v1.59.14 删除"压力→意图"粒子流（v1.51.6 遗留误叙事）。
         *
         * 旧版（v1.51.6）每次 spawn 时从 stress 球向 intent 喷 5 颗粒子，视觉上传递
         * "压力驱动了意图"的因果关系。但按代码事实（intentResolver.js INTENT_RULES）：
         *   - relief (100) 读 playerDistress，不读 stress
         *   - harvest (80) 读 geometry，不读 stress
         *   - flow (50) 读 delightMode/rhythmPhase，不读 stress
         *   - pressure/sprint 把 stress 当 guard 阈值（数值判断），不是因果传递
         *   - stress 与 intent 是 adaptiveSpawn 单次调用的**并列输出**
         * 这条粒子流违反 v1.59.11~13 已确立的"3 派生并列同源"叙事，必须删除。
         *
         * 替代：spawn 时从信号集向 intent 喷粒子（与"信号→stress"对称），但因 intent 派生
         * 依赖虚线已常驻可见，pulse 时只需让虚线短暂高亮即可——见 _triggerIntentPulse。 */
        if (intentGeom && stressGeom) {
            this._triggerIntentDeriveFlash(insight, intentGeom);
        }

        /* v1.59.2：辐射炸裂——以 stress 球为中心向四周喷出 8 颗短寿命粒子，配合 .dfv-stage--shock
         * 震波形成"算法刚做决策"的爆裂感。距离短、寿命快（0.32~0.5s），不会污染稳态画面。 */
        if (stressGeom) {
            const intent = insight?.spawnHints?.spawnIntent ?? insight?.spawnIntent ?? 'maintain';
            const burstColor = SPAWN_INTENT_COLOR[intent] || '#a78bfa';
            const burstN = 8;
            for (let i = 0; i < burstN; i++) {
                const ang = (Math.PI * 2 * i) / burstN + (Math.random() - 0.5) * 0.4;
                const dist = 26 + Math.random() * 24;
                const x1 = stressGeom.x + Math.cos(ang) * dist;
                const y1 = stressGeom.y + Math.sin(ang) * dist;
                this._particles.push({
                    p0: { x: stressGeom.x, y: stressGeom.y },
                    p1: { x: stressGeom.x + Math.cos(ang) * dist * 0.5, y: stressGeom.y + Math.sin(ang) * dist * 0.5 },
                    p2: { x: x1, y: y1 },
                    t: -i * 0.012,
                    dur: 0.32 + Math.random() * 0.18,
                    color: i % 2 ? burstColor : '#ffffff',
                    size: 2.8 + Math.random() * 1.8,
                });
            }
        }

        if (this._particles.length > DFV_PARTICLE_CAP) {
            this._particles.splice(0, this._particles.length - DFV_PARTICLE_CAP);
        }
    }

    /**
     * v1.59.14：spawn pulse 时让"信号→5分量"+"信号→intent"的派生虚线短暂高亮，
     * 与"信号→stress"实色粒子流形成**3 派生同步从信号集派生**的视觉对称。
     *
     * 替代 v1.51.6 错误的"stress→intent"粒子流（违反 INTENT_RULES 代码事实——
     * relief/harvest/flow 等 intent guard 完全不读 stress，stress 与 intent 是并列输出）。
     *
     * @param {object} _insight - 兼容签名（当前未读取，留作后续 intent-specific 高亮）
     * @param {{x:number,y:number,r:number}} _intentGeom - 兼容签名（当前未读取）
     */
    _triggerIntentDeriveFlash(_insight, _intentGeom) {
        const links = [...this._hintDeriveLinks, ...this._intentDeriveLinks];
        if (!links.length) return;
        for (const { el } of links) {
            _setAttrIfChanged(el, 'stroke-opacity', '0.78');
            _setAttrIfChanged(el, 'stroke-width', '1.6');
        }
        if (this._deriveFlashTimer) clearTimeout(this._deriveFlashTimer);
        this._deriveFlashTimer = setTimeout(() => {
            for (const { el } of links) {
                _setAttrIfChanged(el, 'stroke-opacity', '0.22');
                _setAttrIfChanged(el, 'stroke-width', '0.8');
            }
            this._deriveFlashTimer = 0;
        }, 520);
    }

    _renderEmpty() {
        for (const sig of SIGNAL_NODES) {
            const ref = this._nodeEls.get(sig.key);
            if (ref) ref.valueText.textContent = '—';
        }
        if (this._stressBall) this._stressBall.valueText.textContent = '—';
        if (this._intentEl) this._intentEl.valueText.textContent = '—';
    }

    _renderSignalNode(sig, ctx) {
        const ref = this._nodeEls.get(sig.key);
        if (!ref) return;
        const raw = _readDeep(ctx, sig.readPath);
        const group = ref.group;
        const baseColor = ref.baseColor || sig.baseColor || '#7dd3fc';
        /* v1.59.8 节点身份色策略：
         *   - enum 节点：fill 用 enumColors[state]，未命中时回退 baseColor，**离开 idle**
         *   - 数值节点·无数据：fill 保持 baseColor，CSS 类 .dfv-node--idle 让 opacity 0.45 + 呼吸
         *   - 数值节点·有数据：fill 保持 baseColor，**离开 idle**，opacity 由强度 [0.55..1.0] 驱动
         *   永不退化为灰，永远可识别"这是哪个信号"。 */
        if (sig.type === 'enum') {
            this._setFitText(ref.valueText, String(raw ?? '—'));
            const hasState = raw != null;
            const color = (hasState && sig.enumColors?.[raw]) || baseColor;
            _setAttrIfChanged(ref.core, 'fill', color);
            _setAttrIfChanged(ref.core, 'stroke', _shadeColor(color, -25));
            if (hasState) group.classList.remove('dfv-node--idle');
            else group.classList.add('dfv-node--idle');
            return;
        }
        if (!Number.isFinite(raw)) {
            this._setFitText(ref.valueText, '—');
            group.classList.add('dfv-node--idle');
            return;
        }
        const [lo, hi] = sig.range || [0, 1];
        // signed 信号（如 momentum）用 |value|/max 衡量"强度"
        const norm = sig.signed
            ? Math.abs(raw) / Math.max(Math.abs(lo), Math.abs(hi), 1e-6)
            : (raw - lo) / Math.max(1e-6, hi - lo);
        const sm = approach(this._smooth.get(sig.key) ?? norm, norm, 0.18);
        this._smooth.set(sig.key, sm);
        /* 强度由 fill-opacity 驱动（0.55~1.0），fill 始终 = baseColor 保身份 */
        const op = (0.55 + 0.45 * _clamp(sm, 0, 1)).toFixed(2);
        _setAttrIfChanged(ref.core, 'fill', baseColor);
        _setAttrIfChanged(ref.core, 'stroke', _shadeColor(baseColor, -28));
        _setAttrIfChanged(ref.core, 'fill-opacity', op);
        group.classList.remove('dfv-node--idle');
        const text = sig.format === 'int'
            ? String(Math.round(raw))
            : (Math.abs(raw) < 10 && !Number.isInteger(raw) ? raw.toFixed(2) : String(raw));
        this._setFitText(ref.valueText, text);
    }

    _setFitText(el, text) {
        if (!el) return;
        const s = String(text ?? '—');
        /* v1.55.2：text node 也做差异更新，避免相同字符串重复触发布局/重绘 */
        if (el.textContent !== s) el.textContent = s;
    }

    _triggerStrategyArc(comp, power, intentColor = '#ffffff') {
        if (!comp?.pos) return;
        const now = performance.now();
        const state = this._strategyFlashState.get(comp.key) || { armed: true, last: 0 };
        if (power < 0.64) {
            state.armed = true;
            this._strategyFlashState.set(comp.key, state);
            return;
        }
        if (!state.armed || power < 0.84 || (now - state.last) < 280) {
            this._strategyFlashState.set(comp.key, state);
            return;
        }
        state.armed = false;
        state.last = now;
        this._strategyFlashState.set(comp.key, state);

        const n = comp.pos;
        const intent = this._geom.get('spawnIntent');
        const c1 = comp.color || '#7dd3fc';
        const c2 = intentColor || '#ffffff';
        for (let i = 0; i < 4; i++) {
            const a = (Math.PI * 2 * i) / 4 + Math.random() * 0.35;
            const r = 7 + Math.random() * 8;
            const p0 = { x: n.x + Math.cos(a) * r * 0.45, y: n.y + Math.sin(a) * r * 0.45 };
            const p2 = { x: n.x + Math.cos(a) * r, y: n.y + Math.sin(a) * r };
            const p1 = { x: (p0.x + p2.x) * 0.5 + (Math.random() - 0.5) * 6, y: (p0.y + p2.y) * 0.5 + (Math.random() - 0.5) * 6 };
            this._particles.push({
                p0, p1, p2, t: -i * 0.02, dur: 0.16 + Math.random() * 0.14,
                color: i % 2 ? c1 : '#ffffff', size: 1.8 + Math.random() * 1.1,
            });
        }
        /* v1.59.12：删除"5 分量 → intent"粒子流——源码上 5 向量与 intent 是并列派生兄弟，
         * 不存在"分量爆发→intent 接收"的因果传递。粒子流只保留分量节点本地的"周围扩散"
         * 表达"该分量本帧高位"，不再向 intent 喷射。 */
        void intent; void c2;
    }

    _renderStressBall(insight) {
        if (!this._stressBall) return;
        const target = Number.isFinite(insight?.stress) ? insight.stress : 0;
        const sm = approach(this._smooth.get('stress') ?? target, target, 0.12);
        this._smooth.set('stress', sm);
        /* v1.59.2：stress > 0.72 时给左栏挂 .dfv-stage--high-stress（边缘红光呼吸）；阈值
         * 与 stressMeter 高位提示同源（避免视觉冲突）。差分 toggle 防止每帧刷动画。 */
        if (this._stageEl) {
            const high = sm > 0.72;
            const cur = this._stageEl.classList.contains('dfv-stage--high-stress');
            if (high && !cur) this._stageEl.classList.add('dfv-stage--high-stress');
            else if (!high && cur) this._stageEl.classList.remove('dfv-stage--high-stress');
        }
        /* v1.55.17：insight.stress 已为 [0, 1] norm 域（layered._adaptiveStress 出口
         * 已 normalizeStress；详见 web/src/adaptiveSpawn.js 顶部 JSDoc），直接 clamp
         * 喂入 heatColor，移除历史的 `(sm + 0.3) / 1.3` 二次仿射。 */
        const color = heatColor(_clamp(sm, 0, 1));
        this._stressBall.core.setAttribute('fill', color);
        this._stressBall.valueText.textContent = sm.toFixed(2);
        const now = performance.now();
        if (now < this._stressPulseUntil && this._stressRing) {
            const k = 1 - (this._stressPulseUntil - now) / 400;
            const baseR = this._stressBaseR ?? 36;
            const r = baseR + k * (baseR * 0.7);
            const op = 1 - k;
            this._stressRing.setAttribute('r', r.toFixed(1));
            this._stressRing.setAttribute('stroke', color);
            this._stressRing.setAttribute('stroke-opacity', op.toFixed(2));
        } else if (this._stressRing) {
            this._stressRing.setAttribute('stroke-opacity', '0');
        }
        if (this._stressBall.inner) {
            this._stressBall.inner.setAttribute('fill', `${_shadeColor(color, 35).replace('rgb(', 'rgba(').replace(')', ',0.28)')}`);
        }
    }

    _renderSpawnIntent(insight) {
        if (!this._intentEl) return;
        const rawIntent = insight?.spawnHints?.spawnIntent ?? insight?.spawnIntent;
        const intent = rawIntent ?? '—';
        this._intentEl.valueText.textContent = intent;
        /* v1.59.8：有 intent 时移除 idle 类，fill-opacity 拉满；
         * 无 intent 时保持 idle（baseColor 紫色 + 弱 alpha 呼吸），不退化为灰。 */
        if (rawIntent) {
            const color = SPAWN_INTENT_COLOR[intent] || '#94a3b8';
            this._intentEl.hex.setAttribute('fill', color);
            this._intentEl.hex.setAttribute('stroke', _shadeColor(color, -20));
            _setAttrIfChanged(this._intentEl.hex, 'fill-opacity', '1');
            this._intentEl.group.classList.remove('dfv-node--idle');
        } else {
            this._intentEl.group.classList.add('dfv-node--idle');
        }
        if (this._curIntent !== intent) {
            this._curIntent = intent;
            this._intentEl.group.classList.remove('dfv-intent-flash');
            void this._intentEl.group.getBoundingClientRect();
            this._intentEl.group.classList.add('dfv-intent-flash');
        }
        /* v1.59.16：intent 派生虚线按"是否有明确 intent + 非 maintain"驱动强度。
         * 'maintain' = 默认中性兜底（priority=0），强度=0；其他 intent = 1。 */
        const intentIntensity = rawIntent && rawIntent !== 'maintain' ? 1 : 0;
        this._renderDeriveLinks(this._intentDeriveLinks, intentIntensity);
    }

    _renderStressToStrategy(insight) {
        const ref = this._strategyLinkEl;
        if (!ref) return;
        const hints = insight?.spawnHints || {};
        const intent = hints.spawnIntent ?? insight?.spawnIntent ?? 'maintain';
        const intentColor = SPAWN_INTENT_COLOR[intent] || '#94a3b8';
        /* v1.55.17：stress 已为 [0, 1] norm 域，移除二次仿射，直接 clamp */
        const stress = Number.isFinite(insight?.stress) ? Number(insight.stress) : 0;
        const stress01 = _clamp(stress, 0, 1);
        const metrics = {};
        for (const def of STRATEGY_COMPONENT_DEFS) {
            const raw = Number(hints[def.key]);
            metrics[def.key] = {
                value: Number.isFinite(raw) ? raw : NaN,
                norm: def.norm(raw),
                text: def.display(raw),
            };
        }
        const strategy01 = _clamp(
            (metrics.clearGuarantee?.norm ?? 0.2) * 0.30
            + (metrics.sizePreference?.norm ?? 0.15) * 0.22
            + (metrics.orderRigor?.norm ?? 0.1) * 0.22
            + (metrics.diversityBoost?.norm ?? 0.08) * 0.13
            + (metrics.comboChain?.norm ?? 0.08) * 0.13,
            0, 1,
        );
        const intensity = _clamp(stress01 * 0.56 + strategy01 * 0.44, 0, 1);

        if (ref.trunk) {
            _setAttrIfChanged(ref.trunk.base, 'stroke', _shadeColor(intentColor, -15));
            _setAttrIfChanged(ref.trunk.base, 'stroke-width', (0.9 + intensity * 1.25).toFixed(2));
            _setAttrIfChanged(ref.trunk.base, 'stroke-opacity', (0.26 + intensity * 0.33).toFixed(2));
            _setAttrIfChanged(ref.trunk.halo, 'stroke', intentColor);
            _setAttrIfChanged(ref.trunk.halo, 'stroke-opacity', (0.06 + intensity * 0.24).toFixed(2));
            _setAttrIfChanged(ref.trunk.halo, 'stroke-width', (2.2 + intensity * 1.9).toFixed(2));
            _setAttrIfChanged(ref.trunk.flow, 'stroke-opacity', (0.14 + intensity * 0.30).toFixed(2));
            _setAttrIfChanged(ref.trunk.flow, 'stroke-width', (0.95 + intensity * 0.55).toFixed(2));
            _setAttrIfChanged(ref.trunk.flow, 'stroke-dasharray', `${(4.8 - intensity * 1.2).toFixed(1)} ${(10.6 - intensity * 2.0).toFixed(1)}`);
            _setAttrIfChanged(ref.trunk.flow, 'stroke-dashoffset', ((this._edgeFlowPhase * (0.85 + intensity * 2.2)) * -0.72).toFixed(1));
        }

        (ref.comps || []).forEach((comp, idx) => {
            const m = metrics[comp.key] || { value: NaN, norm: 0, text: '—' };
            const compPower = _clamp(stress01 * 0.42 + m.norm * 0.58, 0, 1);
            const width = 0.85 + compPower * 1.75;
            const alpha = 0.20 + compPower * 0.55;
            const flowSpeed = 0.9 + compPower * 3.3;
            const glow = _shadeColor(comp.color, 16);

            _setAttrIfChanged(comp.node, 'fill', `${glow.replace('rgb(', 'rgba(').replace(')', ',0.42)')}`);
            _setAttrIfChanged(comp.node, 'stroke', `${comp.color}${compPower > 0.68 ? 'ff' : 'cc'}`);
            if (comp.inner) _setAttrIfChanged(comp.inner, 'fill', `${glow.replace('rgb(', 'rgba(').replace(')', ',0.20)')}`);
            if (comp.glow) _setAttrIfChanged(comp.glow, 'fill', `${comp.color}${compPower > 0.55 ? '2f' : '1b'}`);
            if (comp.spec) _setAttrIfChanged(comp.spec, 'opacity', (0.45 + compPower * 0.4).toFixed(2));
            this._setFitText(comp.valueText, m.text);
            _setAttrIfChanged(comp.node, 'r', comp.baseR.toFixed(2));
            if (comp.inner) _setAttrIfChanged(comp.inner, 'r', (comp.baseR * 0.58).toFixed(2));
            if (comp.glow) _setAttrIfChanged(comp.glow, 'r', (comp.baseR + 3.2 + compPower * 1.2).toFixed(2));
            this._triggerStrategyArc(comp, compPower, intentColor);

            /* v1.59.16：5 核心分量派生虚线按 compPower 强化（与 stress 边强度逻辑同步） */
            this._renderDeriveLinks(comp.deriveLinks, compPower);

            /* v1.59.12：out/inbound 连线已删除（5 分量与 stress/intent 视觉孤立），
             * 仅在仍保留时执行（向后兼容意外重启场景）。 */
            if (comp.out) {
                _setAttrIfChanged(comp.out.base, 'stroke', comp.color);
                _setAttrIfChanged(comp.out.base, 'stroke-width', width.toFixed(2));
                _setAttrIfChanged(comp.out.base, 'stroke-opacity', alpha.toFixed(2));
                _setAttrIfChanged(comp.out.halo, 'stroke', comp.color);
                _setAttrIfChanged(comp.out.halo, 'stroke-width', (width * 2.1).toFixed(2));
                _setAttrIfChanged(comp.out.halo, 'stroke-opacity', (alpha * 0.42).toFixed(2));
                _setAttrIfChanged(comp.out.flow, 'stroke-width', Math.max(0.9, width * 0.5).toFixed(2));
                _setAttrIfChanged(comp.out.flow, 'stroke-opacity', (0.14 + compPower * 0.62).toFixed(2));
                _setAttrIfChanged(comp.out.flow, 'stroke-dashoffset', ((this._edgeFlowPhase + idx * 19) * flowSpeed * -0.14).toFixed(1));
            }

            if (comp.inbound) {
                _setAttrIfChanged(comp.inbound.base, 'stroke', comp.color);
                _setAttrIfChanged(comp.inbound.base, 'stroke-width', Math.max(0.8, width * 0.82).toFixed(2));
                _setAttrIfChanged(comp.inbound.base, 'stroke-opacity', (alpha * 0.78).toFixed(2));
                _setAttrIfChanged(comp.inbound.halo, 'stroke', comp.color);
                _setAttrIfChanged(comp.inbound.halo, 'stroke-width', Math.max(1.7, width * 1.7).toFixed(2));
                _setAttrIfChanged(comp.inbound.halo, 'stroke-opacity', Math.min(0.48, alpha * 0.38).toFixed(2));
                _setAttrIfChanged(comp.inbound.flow, 'stroke-width', Math.max(0.85, width * 0.45).toFixed(2));
                _setAttrIfChanged(comp.inbound.flow, 'stroke-opacity', (0.12 + compPower * 0.56).toFixed(2));
                _setAttrIfChanged(comp.inbound.flow, 'stroke-dashoffset', ((this._edgeFlowPhase + idx * 29) * flowSpeed * -0.12).toFixed(1));
            }
        });
    }

    /**
     * v1.59.15：渲染 spawnTargets 6 维目标向量节点（数据来自 insight.spawnHints.spawnTargets）。
     *
     * 视觉规则：
     * - value 数值实时更新（保留 2 位小数）
     * - fill-opacity 由 value 强度（0..1）线性映射 0.5..1.0，强度越高节点越实
     * - glow 半径随 value 微胀（强度高时 +1.5px）
     */
    _renderSpawnTargets(insight) {
        if (!this._spawnTargetEls?.length) return;
        const targets = insight?.spawnHints?.spawnTargets || {};
        for (const t of this._spawnTargetEls) {
            const raw = Number(targets[t.key]);
            const value = Number.isFinite(raw) ? raw : NaN;
            const intensity = Number.isFinite(value) ? _clamp(value, 0, 1) : 0;
            const fillOpacity = (0.5 + intensity * 0.5).toFixed(2);
            const text = Number.isFinite(value) ? value.toFixed(2) : '—';
            _setAttrIfChanged(t.node, 'fill', t.color);
            _setAttrIfChanged(t.node, 'fill-opacity', fillOpacity);
            _setAttrIfChanged(t.node, 'stroke', `${t.color}${intensity > 0.5 ? 'ff' : 'cc'}`);
            if (t.glow) _setAttrIfChanged(t.glow, 'r', (t.baseR + 2.4 + intensity * 1.5).toFixed(2));
            if (t.valueText.textContent !== text) t.valueText.textContent = text;
            /* v1.59.16：派生虚线按 intensity 强化（与 stress 边强度逻辑同步，让 5 派生层视觉一致） */
            this._renderDeriveLinks(t.deriveLinks, intensity);
        }
    }

    /**
     * v1.59.15：渲染 4 调度参数节点（数据来自 insight.spawnHints 顶层 4 字段）。
     *
     * 视觉规则：与 _renderSpawnTargets 同语言，强度 norm 由各 def.norm() 自定义（multiLineTarget 是
     * 0..2 整数，需 /2 归一化；其余是 0..1 实数）。
     */
    _renderScheduleParams(insight) {
        if (!this._scheduleParamEls?.length) return;
        const hints = insight?.spawnHints || {};
        for (const p of this._scheduleParamEls) {
            const raw = Number(hints[p.key]);
            const value = Number.isFinite(raw) ? raw : NaN;
            const intensity = p.norm(value);
            const fillOpacity = (0.5 + intensity * 0.5).toFixed(2);
            const text = p.display(value);
            _setAttrIfChanged(p.node, 'fill', p.color);
            _setAttrIfChanged(p.node, 'fill-opacity', fillOpacity);
            _setAttrIfChanged(p.node, 'stroke', `${p.color}${intensity > 0.5 ? 'ff' : 'cc'}`);
            if (p.glow) _setAttrIfChanged(p.glow, 'r', (p.baseR + 2.4 + intensity * 1.5).toFixed(2));
            if (p.valueText.textContent !== text) p.valueText.textContent = text;
            /* v1.59.16：派生虚线按 intensity 强化 */
            this._renderDeriveLinks(p.deriveLinks, intensity);
        }
    }

    /**
     * v1.59.17：渲染阶段③ 3 chosen shape 节点 + attempt/solutionRejects badge。
     *
     * 数据源：insight.spawnDiagnostics.chosen[] = [{ id, category, reason }, ...]
     *        insight.spawnDiagnostics.attempt（0..22，22 = 兜底）
     *        insight.spawnDiagnostics.solutionRejects = { tooFew, tooMany, holeIncrement, orderTooLoose, ... }
     *
     * 视觉规则：
     *   - 每个 chosen 节点：category 色填充 + id 缩写居中 + reason 短标签下方
     *   - intent → chosen 实色 bezier 强度由 attempt 反向驱动（attempt 低 = 算法轻松 = 边变粗）
     *   - attempt badge: 显示 "尝试 N/22" + solutionRejects 总数（弱字）
     */
    _renderChosenShapes(insight) {
        if (!this._chosenShapeEls?.length) return;
        const diag = insight?.spawnDiagnostics || {};
        const chosen = Array.isArray(diag.chosen) ? diag.chosen : [];
        const attempt = Number.isFinite(diag.attempt) ? diag.attempt : 0;
        const attemptNorm = _clamp(1 - attempt / 22, 0, 1);
        /* v1.59.21 方案 C：缓存 attemptNorm + insight，供 hover 反向高亮模式 mouseleave 后恢复 */
        this._lastAttemptNorm = attemptNorm;
        this._lastInsight = insight;

        /* v1.60.6 缺口 #4：sig 包含 injectedAt / original.id，让 ⚡ badge 出现/消失能触发重渲。
         * v1.60.14：sig 加入 topDriver.key —— 即使 chosen shape id / reason 完全相同，driver 切换
         * （例如 multiClear=2 → gapFills=2，reason 都是 "clear"）也必须刷新 union baseline。
         * 历史上 driver-mode union 在罕见的"同 shape 不同 driver"切换下停留在旧 path 不更新。 */
        const sig = chosen.map((c) => `${c?.id ?? '-'}|${c?.reason ?? '-'}|${c?.topDriver?.key ?? '-'}|${c?.original?.id ?? '-'}|${c?.injectedAt ?? '-'}|${c?.duplicateGroup ?? '-'}|${c?.duplicateRole ?? '-'}`).join('||') + `#${attempt}`;
        const dirty = this._lastChosenSig !== sig;
        if (!dirty) {
            this._renderChosenCausalLinks(attemptNorm);
            /* v1.60.14：dirty=false 守护 union baseline —— 防止外部时机（窗口 resize / 折叠展开 /
             * 暂存 mouseleave rAF 被取消等）让 dfv-svg--driver-mode class 丢失。检测到丢失
             * 立即重渲染 union（_applyHlSet 内部 diff，集合相同时 0 个 DOM 操作，零成本）。 */
            if (this._svg && !this._svg.classList.contains('dfv-svg--driver-mode')) {
                this._renderUnionHighlight();
            }
            return;
        }
        this._lastChosenSig = sig;

        for (let i = 0; i < this._chosenShapeEls.length; i++) {
            const slot = this._chosenShapeEls[i];
            const meta = chosen[i] || null;
            if (!meta) {
                /* 空 slot：底色暗、grid 清空、文字 '—' */
                _setAttrIfChanged(slot.bg, 'stroke', 'rgba(148,163,184,0.35)');
                _setAttrIfChanged(slot.bg, 'fill', 'rgba(15,23,42,0.6)');
                if (slot.glow) _setAttrIfChanged(slot.glow, 'fill', 'rgba(148,163,184,0.08)');
                _renderChosenMiniGrid(slot.gridG, null, slot.baseR, '#94a3b8');
                if (slot.idText.textContent !== '—') slot.idText.textContent = '—';
                if (slot.reasonText.textContent !== '') slot.reasonText.textContent = '';
                if (slot.driverText && slot.driverText.textContent !== '') slot.driverText.textContent = '';
                if (slot.titleEl && slot.titleEl.textContent !== '等待出块') slot.titleEl.textContent = '等待出块';
                /* v1.60.6 缺口 #4：空 slot 同时隐藏 ⚡ badge */
                if (slot.injectBadge) _setAttrIfChanged(slot.injectBadge, 'display', 'none');
                /* v1.60.21：空 slot 同时隐藏 ⧈ dup badge */
                if (slot.dupBadge) _setAttrIfChanged(slot.dupBadge, 'display', 'none');
                continue;
            }
            const color = SHAPE_CATEGORY_COLOR[meta.category] || '#7dd3fc';
            const idShort = _summarizeShapeId(meta.id);
            const reasonShort = _summarizeReason(meta.reason);
            /* v1.59.20：从 blockSpawn._estimateTopDriver 透传过来的主驱动因子
             * v1.60.10：移除 "因·" 前缀，直接显示 driver.label —— 视觉冗余精简，
             * 上方 reasonShort（"送消行/综合选"）已隐含因果，标签自身是名词短语已自解释。 */
            const driverLabel = meta.topDriver?.label || '';

            /* v1.60.29：特殊块（清屏/同花）节点描边升级为对应金/紫色，让玩家一眼识别"惊喜机会"。
             *   pcPotential / perfectClear → 金色 #fbbf24
             *   monoFlush / special-monoFlush → 紫粉色 #f0abfc
             *   其他 → 形状品类色（原色）*/
            const isPcSpecial = meta.reason === 'perfectClear';
            const isMonoSpecial = meta.reason === 'monoFlush' || meta.reason === 'special-monoFlush';
            const nodeColor = isPcSpecial ? '#fbbf24'
                             : isMonoSpecial ? '#f0abfc'
                             : color;
            const strokeWidth = (isPcSpecial || isMonoSpecial) ? 2.5 : 1.5;

            /* 节点背景：彩色描边 + 暗底（让 mini grid 高对比可读） */
            _setAttrIfChanged(slot.bg, 'stroke', nodeColor);
            _setAttrIfChanged(slot.bg, 'stroke-opacity', '0.92');
            _setAttrIfChanged(slot.bg, 'stroke-width', String(strokeWidth));
            _setAttrIfChanged(slot.bg, 'fill', 'rgba(15,23,42,0.88)');
            if (slot.glow) {
                /* 特殊块辉光更浓（30→55），强化"机会块"体感 */
                _setAttrIfChanged(slot.glow, 'fill', `${nodeColor}${(isPcSpecial || isMonoSpecial) ? '55' : '30'}`);
            }

            /* mini 5×5 grid：直接绘出 shape.data，让玩家一眼识别 */
            const shape = getShapeById(meta.id);
            _renderChosenMiniGrid(slot.gridG, shape, slot.baseR, color);

            if (slot.idText.textContent !== idShort) slot.idText.textContent = idShort;
            if (slot.reasonText.textContent !== reasonShort) slot.reasonText.textContent = reasonShort;
            /* v1.60.29：reason badge 文字颜色 — 特殊块用金/紫，其他保持青色（默认） */
            if (slot.reasonText) {
                const reasonFill = isPcSpecial ? '#fbbf24' : isMonoSpecial ? '#f0abfc' : '#67e8f9';
                _setAttrIfChanged(slot.reasonText, 'fill', reasonFill);
            }
            if (slot.driverText && slot.driverText.textContent !== driverLabel) {
                slot.driverText.textContent = driverLabel;
            }

            /* v1.60.6 缺口 #4：⚡ 事件注入 badge ——
             * meta.original / meta.injectedAt 由 blockSpawn._tryInjectSpecial 写入。
             * 显示规则：
             *   subType=relief   → 青色 ⚡，stroke 轻微辉光，tooltip "⚡减压注入 原 X → 当前"
             *   subType=pressure → 橙色 ⚡，tooltip "⚡加压注入 原 X → 当前"
             *   无 original      → 隐藏
             * 颜色用 fill 覆盖，避免改 CSS 类抖动。 */
            const isInjected = !!meta.original;
            /* v1.60.9：tooltip 展开 spawnCtx 五字段快照，让玩家点击 ⚡ 即懂"为什么这块出现"
             * spawnCtx 来自 _tryInjectSpecial 注入决策那一刻：
             *   fill         注入时盘面填充率（与 v1.60.7 fill 下限对照）
             *   pcSetup      0/1/2 几何清盘准备度
             *   holesSignal  enclosedVoidCells（v1.60.6 缺口 #5 后玩家心智口径）
             *   totalRounds  本局已 spawn 轮数（与 v1.60.7 warmup gate 对照）
             *   intent       hints.spawnIntent（与 Step 1 priority 矩阵对照）
             */
            const sc = meta.spawnCtx;
            const spawnCtxLine = isInjected && sc
                ? `\n触发上下文：fill=${typeof sc.fill === 'number' ? sc.fill.toFixed(2) : '-'} · pcSetup=${sc.pcSetup ?? '-'} · holes=${sc.holesSignal ?? '-'} · 轮次=${sc.totalRounds ?? '-'} · intent=${sc.intent ?? '-'}`
                : '';
            /* v1.60.23：monoFlush 子类细化文案——明确告知"为了凑同花顺"。 */
            const subTypeLabel = meta.subType === 'pressure'
                ? '加压'
                : (meta.subType === 'monoFlush' ? '同花顺' : '减压');
            const monoFlushExtra = (meta.subType === 'monoFlush' && sc?.monoFlushLines?.length)
                ? `\n  ↳ 命中近满同色 line：${sc.monoFlushLines.map(l => `${l.type === 'row' ? '行' : '列'}${l.idx}(差${l.empty}格)`).join('、')}`
                : '';
            const injectExtra = isInjected
                ? `\n⚡事件注入：原 ${_summarizeShapeId(meta.original?.id || '?')} → 替换为 ${idShort}（${subTypeLabel}信号触发，slot #${meta.injectedAt ?? '?'}）${spawnCtxLine}${monoFlushExtra}`
                : '';

            /* v1.60.21：⧈ 双胞胎/三胞胎 dup badge — meta.duplicateGroup ∈ {'dup2','dup3'} 时显示 */
            const dupGroup = meta.duplicateGroup;
            const dupRole = meta.duplicateRole;
            const isDup = dupGroup === 'dup2' || dupGroup === 'dup3';
            const dupExtra = isDup
                ? `\n⧈ ${dupGroup === 'dup3' ? '三胞胎' : '双胞胎'}·新奇注入（${dupRole === 'main' ? '主块' : '复制'}）：高/极度 novelty 阈值触发；单局累积 ≤ 3 次、轮次间隔 > 10`
                : '';

            /* tooltip：完整 id + 完整 reason 解释 + 主驱动因子 + 注入审计 */
            const tip = SPAWN_REASON_TIP[meta.reason] || meta.reason || '';
            /* v1.60.15 / v1.60.16：driver 语义释义—— "可消N行" 是 multiClear 真模拟（保证消行），
             * "补N缺/近满补1" 是 gapFills 加权差缺分（不保证消行）。避免重蹈
             * v1.59.20 "可消1行" 文案误导玩家以为 gapFills=1 就能消行的覆辙。 */
            const driverKey = meta.topDriver?.key || '';
            const DRIVER_SEMANTIC = {
                pcPotential: 'previewClearOutcome 真模拟，本块放下可清空全盘',
                monoFlush:   'bestMonoFlushPotential 真模拟（v1.60.26 严格定义），本块放下后会触发：消行（line 满）+ 全 line 同 icon —— 即立即触发 ×5 倍 iconBonus 得分（同花顺大消除）',
                multiClear:  'bestMultiClearPotential 真模拟，本块放下可同时消 N 条行/列',
                exactFit:    'bestExactFit 真模拟（v1.60.18），本块几何精确嵌入凹槽（外周邻居 ≥85% 被填/边界）；不一定消行，但锁住凹槽 → 不制造新空洞 + 不缩窄解空间',
                gapFills:    'countGapFills 加权差缺分（差1×3、差2×2、差3-4×1），**不保证放下能消行**；近满补1 = 仅命中差3-4格弱gap',
                holeReduce:  'bestHoleReduction 真模拟，本块可消除 N 个已存在空洞',
                mobility:    '合法落点 ≥30，自由度高（无强消行/清屏价值）',
                shapeWeight: 'shape category 在 weights 中占比 ≥20% 且为榜首',
                balanced:    '无单一主因，多维加权综合选出（综合选 reason）',
                relief:      '_tryInjectSpecial 减压注入（独立池事件，硬编码 driver）',
                pressure:    '_tryInjectSpecial 加压注入（独立池事件，硬编码 driver）',
                fallback:    '主路径 22 次重试都不过约束，降级使用',
            };
            const driverSemantic = DRIVER_SEMANTIC[driverKey] ? `\n  ↳ ${DRIVER_SEMANTIC[driverKey]}` : '';
            const driverFull = meta.topDriver?.label ? `\n主因：${meta.topDriver.label}（${driverKey}）${driverSemantic}` : '';
            const titleStr = `${meta.id || '?'} · ${tip}${driverFull}${injectExtra}${dupExtra}`;
            if (slot.titleEl && slot.titleEl.textContent !== titleStr) {
                slot.titleEl.textContent = titleStr;
            }

            if (slot.injectBadge) {
                if (isInjected) {
                    /* v1.60.23：subType 三态着色——
                     *   monoFlush → 紫粉色（与 monoFlush driver 节点配色家族保持识别度）
                     *   pressure  → 橙色
                     *   relief    → 青色 */
                    let badgeColor = '#67e8f9';
                    if (meta.subType === 'pressure') badgeColor = '#fb923c';
                    else if (meta.subType === 'monoFlush') badgeColor = '#f0abfc';
                    _setAttrIfChanged(slot.injectBadge, 'display', 'inline');
                    _setAttrIfChanged(slot.injectBadge, 'fill', badgeColor);
                } else {
                    _setAttrIfChanged(slot.injectBadge, 'display', 'none');
                }
            }
            /* v1.60.21：⧈ dup badge —— main 紫色描边、replica 紫色实心。
             * dup3 比 dup2 颜色更亮（视觉强化"全场极致新奇"）。 */
            if (slot.dupBadge) {
                if (isDup) {
                    const dupColor = dupGroup === 'dup3' ? '#c084fc' : '#a78bfa';
                    _setAttrIfChanged(slot.dupBadge, 'display', 'inline');
                    _setAttrIfChanged(slot.dupBadge, 'fill', dupColor);
                    _setAttrIfChanged(slot.dupBadge, 'fill-opacity', dupRole === 'main' ? '0.35' : '1.0');
                } else {
                    _setAttrIfChanged(slot.dupBadge, 'display', 'none');
                }
            }
        }

        this._renderChosenCausalLinks(attemptNorm);

        /* attempt badge：弱字显示尝试次数 + softReject 总数 */
        if (this._spawnAttemptBadge) {
            const rejects = diag.solutionRejects || {};
            let totalRej = 0;
            for (const k of Object.keys(rejects)) {
                const v = Number(rejects[k]);
                if (Number.isFinite(v)) totalRej += v;
            }
            const badgeText = attempt > 0
                ? (totalRej > 0 ? `尝试${attempt}·拒${totalRej}` : `尝试${attempt}`)
                : '';
            if (this._spawnAttemptBadge.textContent !== badgeText) {
                this._spawnAttemptBadge.textContent = badgeText;
            }
        }

        /* v1.60.11：每次 chosen 数据刷新后，重置 union baseline 高亮 —— 3 chosen 各自
         * driver 路径的并集，让玩家不必 hover 就能看到"哪些信号/派生节点驱动了这 3 块"。
         * hover 期间若被覆盖会立即回到 hover 视图（mouseenter 重触发 _setDriverHighlight）。 */
        this._renderUnionHighlight();
    }

    /**
     * v1.59.18：4 派生层 → 3 chosen 的多源派生虚线强度按 attemptNorm 驱动。
     * attempt 低（算法易找到合法组合 → 上游信号清晰）→ 虚线变亮变粗；
     * attempt 高（算法挣扎 → 上游信号矛盾或盘面紧绷）→ 虚线变暗变细。
     *
     * v1.59.17 旧 intent→chosen 实色双层（base+halo）已撤销，改为 12 条派生虚线统一控制。
     */
    _renderChosenCausalLinks(attemptNorm) {
        if (!this._chosenDeriveLinks?.length) return;
        const alpha = (0.16 + attemptNorm * 0.34).toFixed(2);
        const width = (0.7 + attemptNorm * 0.7).toFixed(2);
        for (const link of this._chosenDeriveLinks) {
            _setAttrIfChanged(link.el, 'stroke-opacity', alpha);
            _setAttrIfChanged(link.el, 'stroke-width', width);
        }
    }

    /**
     * v1.59.21 方案 C：hover chosen[idx] 时反向追溯高亮——根据 topDriver.key 在 DRIVER_NODE_PATHS
     * 中查到驱动它的"派生节点 keys 集合"，再通过 HINT_DRIVER_SIGNALS / SPAWN_TARGET_DRIVER_SIGNALS
     * / SCHEDULE_PARAM_DRIVER_SIGNALS / INTENT_DRIVER_SIGNALS 扩展到上游信号节点集合。
     *
     * v1.59.22 防抖动重构：
     *   - 旧版抖动根因：chosen[A]→chosen[B] 切换时 mouseleave 立刻 clear → mouseenter 立刻 set，
     *     SVG 在同一帧内 remove + add `.dfv-svg--driver-mode`，触发 29+ 节点反向 opacity transition
     *     互相打断，肉眼可见"闪一下又暗下去"。
     *   - 修复 1：clear 延迟到下一 rAF 执行；mouseenter 同帧到达时 cancelAnimationFrame，SVG 保持
     *     driver-mode，仅 diff 增删 `.dfv-driver-hl` 子节点（切换节点视觉完全平滑）。
     *   - 修复 2：去掉 `filter: saturate() drop-shadow()`（合成层重光栅化代价高），改用纯
     *     opacity + stroke 区分。
     *   - 修复 3：决策摘要徽章用独立 DOM append/remove，不再 innerHTML 全树重写。
     *   - 修复 4：内部维护 `_driverHlSet`（id 集合），diff add/remove 而非全清重设。
     *
     * 视觉效果：
     *   - SVG 整体加 .dfv-svg--driver-mode → 全节点 opacity 0.22（CSS 控制）
     *   - 高亮信号节点 + 派生节点 + 此 chosen 节点 → opacity 1 + 描边加粗变金 (.dfv-driver-hl)
     *   - 高亮派生层 → 该 chosen 入向虚线亮化（属性级 stroke-opacity 0.92）
     *   - 顶部 .dfv-decision-summary 末尾 append 金色徽章「追溯：因·XXX」
     */
    /**
     * v1.60.11：抽出"由 (driver, idx) 计算 hl set + 各 layer keys"的纯函数，
     * 供 _setDriverHighlight（hover 单 chosen）和 _renderUnionHighlight（默认 3 chosen 并集）共用。
     *
     * 返回结构：
     *   {
     *     hlSet:        Set<string>          带 ns 前缀的 id 集合 ("signal:xxx" / "strategy:xxx" / ...)
     *     strategyKeys: string[]
     *     targetKeys:   string[]
     *     scheduleKeys: string[]
     *     intentOn:     boolean
     *     isWildcard:   boolean              path.strategy === '*'
     *   }
     */
    _computeHlForDriver(driver, idx) {
        const path = DRIVER_NODE_PATHS[driver.key] || DRIVER_NODE_PATHS.balanced;
        const pickAll = (defs, sel) => sel === '*' ? defs.map(d => d.key) : (Array.isArray(sel) ? sel : []);

        const strategyKeys = pickAll(STRATEGY_COMPONENT_DEFS, path.strategy);
        const targetKeys   = pickAll(SPAWN_TARGET_DEFS, path.targets);
        const scheduleKeys = pickAll(SCHEDULE_PARAM_DEFS, path.schedule);
        const intentOn     = !!path.intent;
        const isWildcard   = path.strategy === '*';

        const signalSet = new Set();
        for (const k of strategyKeys) (HINT_DRIVER_SIGNALS[k] || []).forEach(s => signalSet.add(s));
        for (const k of targetKeys)   (SPAWN_TARGET_DRIVER_SIGNALS[k] || []).forEach(s => signalSet.add(s));
        for (const k of scheduleKeys) (SCHEDULE_PARAM_DRIVER_SIGNALS[k] || []).forEach(s => signalSet.add(s));
        if (intentOn) INTENT_DRIVER_SIGNALS.forEach(s => signalSet.add(s));
        if (isWildcard) SIGNAL_NODES.forEach(s => signalSet.add(s.key));

        const hlSet = new Set();
        for (const sig of signalSet) hlSet.add(`signal:${sig}`);
        for (const k of strategyKeys) hlSet.add(`strategy:${k}`);
        for (const k of targetKeys) hlSet.add(`target:${k}`);
        for (const k of scheduleKeys) hlSet.add(`schedule:${k}`);
        if (intentOn) hlSet.add('intent:_');
        if (idx != null) hlSet.add(`chosen:${idx}`);

        return { hlSet, strategyKeys, targetKeys, scheduleKeys, intentOn, isWildcard };
    }

    /**
     * v1.60.11：默认（无 hover）以 3 chosen 各自 driver 的并集高亮上游路径。
     * 让玩家不必 hover 就能看到"哪些信号/派生节点驱动了这 3 块"。
     *
     * 入向虚线：每条 link 看自己 toChosenIdx 对应的 driver 是否覆盖该 layer，
     * 用稍弱透明度（0.55）区分于 hover 单 chosen 的强亮（0.92），避免视觉过载。
     */
    _renderUnionHighlight() {
        if (!this._svg) return;
        const chosen = this._lastInsight?.spawnDiagnostics?.chosen;
        if (!Array.isArray(chosen) || chosen.length === 0) {
            this._applyHlSet(new Set());
            this._svg.classList.remove('dfv-svg--driver-mode');
            return;
        }

        /* 聚合各 chosen 的 hl 集合 + 记录每个 idx 的 layer 覆盖（供入向虚线判断） */
        const unionSet = new Set();
        const perIdx = []; /* [{strategyKeys, targetKeys, scheduleKeys, intentOn, isWildcard}, ...] */
        let anyDriver = false;
        for (let idx = 0; idx < chosen.length; idx++) {
            const driver = chosen[idx]?.topDriver;
            if (!driver) { perIdx.push(null); continue; }
            anyDriver = true;
            const info = this._computeHlForDriver(driver, idx);
            for (const id of info.hlSet) unionSet.add(id);
            perIdx.push(info);
        }

        if (!anyDriver) {
            this._applyHlSet(new Set());
            this._svg.classList.remove('dfv-svg--driver-mode');
            return;
        }

        this._svg.classList.add('dfv-svg--driver-mode');
        this._applyHlSet(unionSet);

        /* 入向虚线：每条 link 看自己 toChosenIdx 对应的 driver 是否覆盖该 layer */
        for (const link of (this._chosenDeriveLinks || [])) {
            const info = perIdx[link.toChosenIdx];
            let active = false;
            if (info) {
                const layer = link.source;
                if (layer === 'strategy' && info.strategyKeys.length > 0) active = true;
                else if (layer === 'targets' && info.targetKeys.length > 0) active = true;
                else if (layer === 'schedule' && info.scheduleKeys.length > 0) active = true;
                else if (layer === 'intent' && info.intentOn) active = true;
                else if (info.isWildcard) active = true;
            }
            /* union 状态稍弱（0.55 / 1.0），hover 状态强亮（0.92 / 1.6）—— 视觉层级区分 */
            _setAttrIfChanged(link.el, 'stroke-opacity', active ? '0.55' : '0.08');
            _setAttrIfChanged(link.el, 'stroke-width', active ? '1.0' : '0.4');
        }
    }

    /**
     * v1.60.11：通用 hl set 应用（diff add/remove），_setDriverHighlight + _renderUnionHighlight 共用。
     */
    _applyHlSet(next) {
        const prev = this._driverHlSet || new Set();
        for (const id of prev) {
            if (!next.has(id)) this._toggleDriverHl(id, false);
        }
        for (const id of next) {
            if (!prev.has(id)) this._toggleDriverHl(id, true);
        }
        this._driverHlSet = next;
    }

    _setDriverHighlight(idx) {
        const chosen = this._lastInsight?.spawnDiagnostics?.chosen;
        const meta = Array.isArray(chosen) ? chosen[idx] : null;
        const driver = meta?.topDriver;
        if (!driver || !this._svg) return;

        /* v1.59.22：取消可能 schedule 的 clear，保证 chosen[A→B] 切换时 SVG 不退出 driver-mode */
        if (this._driverClearRaf != null) {
            cancelAnimationFrame(this._driverClearRaf);
            this._driverClearRaf = null;
        }

        const info = this._computeHlForDriver(driver, idx);
        this._svg.classList.add('dfv-svg--driver-mode');
        this._applyHlSet(info.hlSet);

        /* 入向虚线：仅当前 chosen 的入向被驱动层亮化，其他全 chosen 的入向虚线统一弱化 */
        for (const link of (this._chosenDeriveLinks || [])) {
            let active = false;
            if (link.toChosenIdx === idx) {
                const layer = link.source;
                if (layer === 'strategy' && info.strategyKeys.length > 0) active = true;
                else if (layer === 'targets' && info.targetKeys.length > 0) active = true;
                else if (layer === 'schedule' && info.scheduleKeys.length > 0) active = true;
                else if (layer === 'intent' && info.intentOn) active = true;
                else if (info.isWildcard) active = true;
            }
            _setAttrIfChanged(link.el, 'stroke-opacity', active ? '0.92' : '0.05');
            _setAttrIfChanged(link.el, 'stroke-width', active ? '1.6' : '0.4');
        }

        this._updateDriverBadge(driver);
    }

    /**
     * v1.59.22：单节点 hl class 增删的 toggle 工具。
     * id 形如 "signal:frust" / "strategy:clearGuarantee" / "target:novelty" /
     * "schedule:perfectClearBoost" / "intent:_" / "chosen:1"。
     */
    _toggleDriverHl(id, on) {
        if (!this._svg) return;
        const colon = id.indexOf(':');
        if (colon < 0) return;
        const ns = id.slice(0, colon);
        const key = id.slice(colon + 1);
        let el = null;
        switch (ns) {
            case 'signal':   el = this._svg.querySelector(`.dfv-node--signal[data-key="${key}"]`); break;
            case 'strategy': el = this._svg.querySelector(`.dfv-strategy-node[data-key="${key}"]`); break;
            case 'target':   el = this._svg.querySelector(`.dfv-target-node[data-key="${key}"]`); break;
            case 'schedule': el = this._svg.querySelector(`.dfv-schedule-node[data-key="${key}"]`); break;
            case 'intent':   el = this._intentEl?.group || null; break;
            case 'chosen':   el = this._svg.querySelector(`.dfv-chosen-node[data-idx="${key}"]`); break;
        }
        if (!el) return;
        if (on) el.classList.add('dfv-driver-hl');
        else el.classList.remove('dfv-driver-hl');
    }

    _clearDriverHighlight() {
        /* v1.59.22：延迟到下一帧执行，让 chosen[A]→chosen[B] 切换时 mouseenter 能取消 clear。
         * v1.60.11：不再彻底清空，而是回到"3 chosen 并集"baseline——
         *   用户反馈"默认应为三个候选块的并集"，让 mouseleave 回到 union 视图而非"全亮无高亮"。 */
        if (this._driverClearRaf != null) return;
        this._driverClearRaf = requestAnimationFrame(() => {
            this._driverClearRaf = null;
            if (!this._svg) return;
            this._removeDriverBadge();
            /* 回退到 union baseline（保持 driver-mode + 3 chosen 并集高亮） */
            this._renderUnionHighlight();
        });
    }

    /**
     * v1.59.22：决策摘要徽章用独立 DOM 节点 append / textContent 更新，
     * 替代旧版 `innerHTML = savedHtml + tag` 子树重写（重写会触发整个 .dfv-decision-summary
     * 布局重算，且 box-shadow 呼吸动画在重建中重启 → 视觉闪烁）。
     */
    /**
     * v1.60.6 抖动修复：徽章永久驻留 DOM（首次 hover 创建后不再 remove），
     * 通过 visibility 切换显隐——避免 append/remove 引起 .dfv-decision-summary
     * `flex-wrap` 状态变化（1 行 ↔ 2 行）导致整个浮层高度跳动。
     *
     * 同时 CSS 侧给 .dfv-summary-driver-badge 设 `min-width: 180px`，让不同 chosen
     * 节点之间 hover 切换（driver 文字长度差异）时 summary wrap 状态也保持稳定。
     */
    _updateDriverBadge(driver) {
        const host = this._detailEls?.summary;
        if (!host || !driver) return;
        /* v1.60.10：去掉"因·"冗余前缀，"追溯：xxx" 已表达因果关系 */
        const text = `追溯：${driver.label}（${driver.key}）`;
        if (!this._summaryBadgeEl) {
            const badge = document.createElement('span');
            badge.className = 'dfv-summary-driver-badge';
            badge.style.color = '#fde68a';
            badge.style.visibility = 'hidden';
            host.appendChild(badge);
            this._summaryBadgeEl = badge;
        }
        if (this._summaryBadgeEl.textContent !== text) {
            this._summaryBadgeEl.textContent = text;
        }
        if (this._summaryBadgeEl.style.visibility !== 'visible') {
            this._summaryBadgeEl.style.visibility = 'visible';
        }
    }

    _removeDriverBadge() {
        /* v1.60.6：不再 remove 节点，仅 visibility:hidden —— layout 一致避免抖动。
         * badge 节点保留在 host 里，下次 hover 时直接复用。 */
        if (this._summaryBadgeEl && this._summaryBadgeEl.style.visibility !== 'hidden') {
            this._summaryBadgeEl.style.visibility = 'hidden';
        }
    }

    /**
     * v1.59.16：派生依赖虚线（信号→派生节点）按目标节点 intensity（0..1）驱动 opacity/width，
     * 让 5 派生层视觉一致——强度高时虚线变实变粗，与"信号→stress"实色边强度逻辑同步。
     *
     * @param {Array<{el: SVGPathElement}>} links - 该派生节点的入边虚线集合
     * @param {number} intensity - 派生节点当前归一化强度 [0, 1]
     */
    _renderDeriveLinks(links, intensity) {
        if (!links?.length) return;
        const inten = _clamp(Number.isFinite(intensity) ? intensity : 0, 0, 1);
        /* opacity 0.18..0.68（强度高时虚线"显形"），width 0.7..1.6（视觉粗细同 stress 边强化曲线） */
        const alpha = (0.18 + inten * 0.50).toFixed(2);
        const width = (0.7 + inten * 0.9).toFixed(2);
        for (const { el } of links) {
            _setAttrIfChanged(el, 'stroke-opacity', alpha);
            _setAttrIfChanged(el, 'stroke-width', width);
        }
    }

    /**
     * v1.51.8：在 baseline 连线上原地强化（不再 add/remove），按 source 聚合多 breakdown 字段。
     *
     * 行为：
     * - 每个 SIGNAL_NODE 在 _buildScene 时已预创建一条弱灰 baseline 边；
     * - 本方法收集 stressBreakdown，按 source key 累加（sum 决定符号 / 颜色，sum 与 maxAbs
     *   决定粗细）；
     * - 有贡献：边强化为橙（净加压）/ 青（净救济），width / alpha 按 |sum| 缩放；
     * - 无贡献：恢复弱灰 baseline，让 missRate 等"暂时未贡献"的节点仍保持视觉关联。
     */
    _renderContributionEdges(insight) {
        const breakdown = insight?.stressBreakdown || {};
        const bySource = new Map();
        for (const key of Object.keys(breakdown)) {
            const v = breakdown[key];
            if (!Number.isFinite(v) || Math.abs(v) < 0.01) continue;
            const srcKey = BREAKDOWN_TO_SOURCE[key];
            if (!srcKey) continue;
            const cur = bySource.get(srcKey) || { sum: 0, maxAbs: 0 };
            cur.sum += v;
            cur.maxAbs = Math.max(cur.maxAbs, Math.abs(v));
            bySource.set(srcKey, cur);
        }
        /* v1.59.4：把"贡献中"信号节点 toggle .dfv-node--active class——
         * 让用户一眼看到"这一帧算法被哪些信号驱动"（节点外圈发光 / 其他节点暗淡）。
         * 这是"决策过程"可视化的关键——节点不再只是被动展示数值，而是表达"是否参与"。 */
        for (const [srcKey, ref] of this._nodeEls) {
            if (!ref?.group) continue;
            const agg = bySource.get(srcKey);
            const isActive = agg && agg.maxAbs >= 0.01;
            const cur = ref.group.classList.contains('dfv-node--active');
            if (isActive && !cur) ref.group.classList.add('dfv-node--active');
            else if (!isActive && cur) ref.group.classList.remove('dfv-node--active');
        }
        let edgeIdx = 0;
        for (const [srcKey, edge] of this._edgeEls) {
            if (!edge?.path) continue;
            const agg = bySource.get(srcKey);
            if (agg && agg.maxAbs >= 0.01) {
                const stroke = agg.sum >= 0 ? '#fb923c' : '#22d3ee';
                // 用 maxAbs 决定 width（避免 sum 抵消导致细线），alpha 同理
                const width = Math.min(6, Math.max(0.9, agg.maxAbs * 14));
                const alpha = Math.min(0.9, 0.32 + agg.maxAbs * 1.4);
                _setAttrIfChanged(edge.path, 'stroke', stroke);
                _setAttrIfChanged(edge.path, 'stroke-width', width.toFixed(2));
                _setAttrIfChanged(edge.path, 'stroke-opacity', alpha.toFixed(2));
                edge.path.classList.add('dfv-edge--active');
                edge.path.classList.remove('dfv-edge--baseline');
                if (edge.halo) {
                    _setAttrIfChanged(edge.halo, 'stroke', stroke);
                    _setAttrIfChanged(edge.halo, 'stroke-width', (width * 2.35).toFixed(2));
                    _setAttrIfChanged(edge.halo, 'stroke-opacity', Math.min(0.5, alpha * 0.55).toFixed(2));
                }
                if (edge.flow) {
                    const dashA = Math.max(4, 10 - agg.maxAbs * 18);
                    const dashB = Math.max(4, 16 - agg.maxAbs * 14);
                    const speed = 1.8 + agg.maxAbs * 42;
                    _setAttrIfChanged(edge.flow, 'stroke', '#ffffff');
                    _setAttrIfChanged(edge.flow, 'stroke-width', Math.max(1.2, width * 0.46).toFixed(2));
                    _setAttrIfChanged(edge.flow, 'stroke-opacity', Math.min(0.85, 0.26 + alpha * 0.9).toFixed(2));
                    _setAttrIfChanged(edge.flow, 'stroke-dasharray', `${dashA.toFixed(1)} ${dashB.toFixed(1)}`);
                    _setAttrIfChanged(edge.flow, 'stroke-dashoffset', ((this._edgeFlowPhase + edgeIdx * 17) * speed * -0.1).toFixed(1));
                }
            } else {
                /* v1.55.2：baseline 不再做 idle sin 波，固定静态值——
                 *  idle wave 在没有真实数据贡献时持续推 _edgeFlowPhase，触发所有 stroke-opacity
                 *  / dashoffset 重写，恰恰是 v1.55.1 已经在 _tick 里阻断 phase 推进的设计意图。
                 *  这里也保持静态，确保 idle baseline 不引入任何动效。 */
                _setAttrIfChanged(edge.path, 'stroke', '#64748b');
                _setAttrIfChanged(edge.path, 'stroke-width', '0.85');
                _setAttrIfChanged(edge.path, 'stroke-opacity', '0.32');
                edge.path.classList.add('dfv-edge--baseline');
                edge.path.classList.remove('dfv-edge--active');
                if (edge.halo) {
                    _setAttrIfChanged(edge.halo, 'stroke', '#7dd3fc');
                    _setAttrIfChanged(edge.halo, 'stroke-width', '1.8');
                    _setAttrIfChanged(edge.halo, 'stroke-opacity', '0.06');
                }
                if (edge.flow) {
                    _setAttrIfChanged(edge.flow, 'stroke', '#7dd3fc');
                    _setAttrIfChanged(edge.flow, 'stroke-width', '0.9');
                    _setAttrIfChanged(edge.flow, 'stroke-opacity', '0.16');
                    _setAttrIfChanged(edge.flow, 'stroke-dasharray', '3.0 12.0');
                    _setAttrIfChanged(edge.flow, 'stroke-dashoffset', '0');
                }
            }
            edgeIdx++;
        }
    }

    /**
     * v1.55.1：粒子绘制专项优化。
     *
     * 历史实现痛点：
     *   - 每个粒子叠 5 层 trail 用 ctx.fill，每帧约 96×5=480 次 Path/fill；
     *   - 主点用 ctx.shadowBlur=12 模拟发光，shadowBlur 是 GPU 高成本操作（每帧粒子总数倍数级）；
     *   - 帧率与主 rAF 一致（~60fps），即便没有粒子也每帧 clear 整张 canvas。
     *
     * 新实现：
     *   - 用预渲染的"发光圆形精灵"贴图（offscreen canvas，按 color 缓存）+ drawImage 替代 shadowBlur；
     *   - trail 5 层 → 3 层，每条贝塞尔总绘制次数从 6 降到 4；
     *   - 无活跃粒子 + 上一帧已 clear 过时，跳过 clearRect 不重画；
     *   - 粒子上限 96 → 64，降低 spawn pulse 峰值压力。
     */
    _renderParticles() {
        const ctx = this._ctx2d;
        if (!ctx) return;
        const hasParticles = this._particles.length > 0;
        if (!hasParticles) {
            if (!this._canvasCleared) {
                ctx.clearRect(0, 0, this._w, this._h);
                this._canvasCleared = true;
            }
            return;
        }
        ctx.clearRect(0, 0, this._w, this._h);
        this._canvasCleared = false;
        const dt = 1 / 30; // tick 频率上限 30fps
        const alive = [];
        const prevComposite = ctx.globalCompositeOperation;
        ctx.globalCompositeOperation = 'lighter';
        for (const p of this._particles) {
            p.t += dt / p.dur;
            if (p.t < 0) { alive.push(p); continue; }
            if (p.t > 1) continue;
            const pt = bezierPoint(p.p0, p.p1, p.p2, Math.min(1, p.t));
            const sprite = this._getParticleSprite(p.color);
            const spriteR = sprite ? sprite.width / 2 : 0;
            const TRAIL = DFV_TRAIL_COUNT;
            for (let i = 0; i < TRAIL; i++) {
                const tt = Math.max(0, p.t - i * 0.028);
                const tp = bezierPoint(p.p0, p.p1, p.p2, tt);
                const r = Math.max(1.2, p.size * (1 - i / TRAIL));
                const scale = r / Math.max(1, spriteR);
                ctx.globalAlpha = (1 - i / TRAIL) * 0.78;
                const w = sprite.width * scale, h = sprite.height * scale;
                ctx.drawImage(sprite, tp.x - w / 2, tp.y - h / 2, w, h);
            }
            /* 主点：用更大的精灵代替 shadowBlur 高斯发光 */
            ctx.globalAlpha = 1;
            const headR = p.size * 1.4;
            const headScale = headR / Math.max(1, spriteR);
            const hw = sprite.width * headScale, hh = sprite.height * headScale;
            ctx.drawImage(sprite, pt.x - hw / 2, pt.y - hh / 2, hw, hh);
            alive.push(p);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = prevComposite;
        this._particles = alive;
    }

    /**
     * v1.55.1：预渲染发光粒子精灵（按 color 缓存到 offscreen canvas），
     * 把昂贵的 shadowBlur 摊到首次创建。
     * @param {string} color
     * @returns {HTMLCanvasElement|null}
     */
    _getParticleSprite(color) {
        if (this._particleSprites.has(color)) return this._particleSprites.get(color);
        if (typeof document === 'undefined') return null;
        const size = 24; // sprite 总尺寸；中心实心半径 ~3px
        const c = document.createElement('canvas');
        c.width = size;
        c.height = size;
        const cx = c.getContext('2d');
        if (!cx) return null;
        const cxr = size / 2;
        const grad = cx.createRadialGradient(cxr, cxr, 0, cxr, cxr, cxr);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.30, color);
        const transparent = color.startsWith('#')
            ? color + '00'
            : color.replace(/rgba?\(([^)]+)\)/, (_, parts) => `rgba(${parts.split(',').slice(0, 3).join(',')},0)`);
        grad.addColorStop(1, transparent);
        cx.fillStyle = grad;
        cx.fillRect(0, 0, size, size);
        this._particleSprites.set(color, c);
        return c;
    }

    /* ── HTML 详情区渲染（每 6 帧）──────────────────────────────── */

    _renderDetails(insight, profile) {
        const els = this._detailEls;
        if (!els) return;
        const hints = insight?.spawnHints || {};
        const intent = hints.spawnIntent ?? insight?.spawnIntent ?? '—';
        const intentColor = SPAWN_INTENT_COLOR[intent] || '#94a3b8';

        /* —— 意图卡片 + Reason 推导（v1.51.4：i18n） —— */
        els.intentPill.textContent = intent;
        els.intentPill.style.background = `${intentColor}22`;
        els.intentPill.style.color = intentColor;
        els.intentPill.style.borderColor = `${intentColor}66`;
        els.intentCn.textContent = _ti(`dfv.intent.${intent}`, SPAWN_INTENT_DESC[intent] || '');

        const sessionPhase = profile?.sessionPhase;
        const momentum = Number(profile?.momentum) || 0;
        const frust = Number(profile?.frustrationLevel) || 0;
        const endSessionDistressActive = sessionPhase === 'late' && momentum <= -0.30;
        const frustrationCritical = frust >= 5;
        const forceReliefIntent = endSessionDistressActive || frustrationCritical;
        const lateCollapse = endSessionDistressActive;
        /* v1.58.3 起：chip 渲染走 deriveChipsFromCtx + buildChipCtxFromInsight，
         * 之前手写的 personalizationApplied / winbackActive / milestoneHit / afkEngage / onboarding
         * 临时变量不再被 flags 渲染消费，已删除——CHIP_DEFS 在 reducer 内统一派生。 */

        let reasonKey = 'dfv.reason.default';
        let reasonFb = '常规决策';
        if (forceReliefIntent) {
            reasonKey = lateCollapse ? 'dfv.reason.lateCollapse' : 'dfv.reason.frustHigh';
            reasonFb = lateCollapse ? '末段崩盘 → 强制 relief' : '高挫败 → 强制 relief';
        } else if (intent === 'pressure') { reasonKey = 'dfv.reason.pressure'; reasonFb = '动量良好，可加压'; }
        else if (intent === 'engage')   { reasonKey = 'dfv.reason.engage';   reasonFb = '焦虑/挫败叠加 → 介入引导'; }
        else if (intent === 'flow')     { reasonKey = 'dfv.reason.flow';     reasonFb = '心流稳定 → 维持'; }
        else if (intent === 'sprint')   { reasonKey = 'dfv.reason.sprint';   reasonFb = 'stress 进入 [0.45, 0.55) 渐紧过渡带（v1.57.1 P3）'; }
        else if (intent === 'harvest')  { reasonKey = 'dfv.reason.harvest';  reasonFb = '盘面具备消行机会'; }
        els.intentReason.textContent = _ti(reasonKey, reasonFb);

        /* —— stress contributors top 4 ——
         * v1.51.3：改用 stressMeter.summarizeContributors 复用其 skip 集合，
         * 屏蔽 bottleneckSamples / orderMaxValidPerms 等非 stress 分量，
         * 修复截图里"贡献 +6.000 / +2.000"的串扰 bug。 */
        const breakdown = insight?.stressBreakdown || {};
        const contribs = summarizeContributors(breakdown, 4);
        const _emptyContrib = _ti('dfv.foot.empty', '—');
        els.contrib.innerHTML = contribs.length === 0
            ? `<li class="dfv-list-empty">${_emptyContrib}</li>`
            : contribs.map(({ key, value, label }) => {
                const sign = value >= 0 ? '+' : '';
                const cls = value >= 0 ? 'dfv-li--pos' : 'dfv-li--neg';
                /* v1.51.9：contrib label 改走 dfv.contrib.* i18n，stressMeter 中文做 fallback */
                const i18nLabel = _ti(`dfv.contrib.${key}`, label);
                return `<li class="${cls}"><span class="dfv-li-key" title="${key}">${i18nLabel}</span><span class="dfv-li-val">${sign}${value.toFixed(3)}</span></li>`;
            }).join('');

        /* —— Decision flags（v1.51.4 i18n / v1.57.5 §D 覆盖降级 / v1.58 §rewire 派生层化）——
         *
         * 历史 bug（用户截图）：spawnIntent='relief' 时 'AFK 介入' chip 仍高亮，
         * 但实际 afkEngage 被 relief 优先级覆盖。v1.57.5 §D 用硬编码
         * `(intent === 'relief') && afkEngage` 修复，但新增 intent / 信号要再写副本。
         *
         * v1.58 §rewire：把硬编码替换为 `derivation/intentResolver.isSignalOverridden`
         * —— 优先级矩阵从 INTENT_RULES 表查询，新增 intent/signal 自动获得覆盖判定。
         * 行为完全等价（contractTest + property 锁定）；overridden 仍接 CSS 半透明 + 删除线。 */
        const _intentResolved = (insight?._intentInputs)
            ? _dfvResolveIntent({
                ...insight._intentInputs,
                geometry: {
                    nearFullLines: insight.spawnDiagnostics?.layer1?.nearFullLines ?? 0,
                    pcSetup: insight.spawnDiagnostics?.layer1?.pcSetup ?? 0,
                    boardFill: insight.spawnDiagnostics?.layer1?.fill ?? 0,
                },
            })
            : null;
        /* v1.58.3：chip 渲染走 deriveChipsFromCtx + buildChipCtxFromInsight，
         * chip on 函数从 CHIP_DEFS 表唯一派生（与 reducer 同源）。
         * 每个 chip 高亮时 title 自动写"触发源：...具体数值..."。 */
        const chipCtx = _dfvBuildChipCtx(insight, profile);
        const chips = _intentResolved
            ? _dfvDeriveChips(chipCtx, _intentResolved)
            : _dfvDeriveChips(chipCtx, { intent: intent || 'maintain', overrides: new Set() });
        const emptyTxt = _ti('dfv.foot.empty', '—');
        const chipHtml = chips.map((c) => {
            const onCls = c.on ? `dfv-flag--on dfv-flag--${c.kind}` : '';
            const overCls = c.overridden ? ' dfv-flag--overridden' : '';
            const titleAttr = c.title ? ` title="${c.title.replace(/"/g, '&quot;')}"` : '';
            const label = _ti(`dfv.flag.${c.id}`, c.label);
            return `<span class="dfv-flag ${onCls}${overCls}"${titleAttr}>${label}</span>`;
        }).join('');

        /* v1.58.3 conflicts：跨维度信号冲突一行可视化（chip 区下方一行） */
        const conflicts = _intentResolved
            ? _dfvDeriveConflicts(chipCtx, _intentResolved)
            : [];
        let conflictsHtml = '';
        if (conflicts.length > 0) {
            const tip = conflicts.map((c) => c.tip).join(' / ');
            const safeTip = tip.replace(/"/g, '&quot;');
            conflictsHtml = `<div class="dfv-conflicts" title="${safeTip}">⚠ 本帧识别到 ${conflicts.length} 处跨维度信号冲突（hover 看详情）</div>`;
        }
        els.flags.innerHTML = chipHtml + conflictsHtml;

        /* —— shapeWeights top 5（v1.51.4：i18n + 用 category 字段） —— */
        const shapes = Array.isArray(insight?.shapeWeightsTop) ? insight.shapeWeightsTop.slice(0, 5) : [];
        els.shape.innerHTML = shapes.length === 0
            ? `<li class="dfv-list-empty">${emptyTxt}</li>`
            : shapes.map((it) => {
                const cat = it?.category ?? it?.shape ?? it?.id ?? '?';
                const label = _ti(`dfv.shape.${cat}`, SHAPE_CATEGORY_CN[cat] || cat);
                const prob = Number.isFinite(it?.probability) ? (it.probability * 100).toFixed(1) + '%' : emptyTxt;
                const w = Number.isFinite(it?.weight) ? it.weight.toFixed(2) : emptyTxt;
                return `<li><span class="dfv-li-key" title="${cat} · weight ${w}">${label}</span><span class="dfv-li-val">${prob}</span></li>`;
            }).join('');

        /* —— spawnTargets top 6（v1.51.4：i18n + 2 列） —— */
        const tg = insight?.spawnTargets || {};
        const tEntries = Object.entries(tg)
            .filter(([, v]) => Number.isFinite(v) && Math.abs(v) > 0.005)
            .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
            .slice(0, 6);
        els.target.innerHTML = tEntries.length === 0
            ? `<li class="dfv-list-empty">${emptyTxt}</li>`
            : tEntries.map(([k, v]) => {
                const label = _ti(`dfv.target.${k}`, SPAWN_TARGET_CN[k] || k);
                return `<li><span class="dfv-li-key" title="${k}">${label}</span><span class="dfv-li-val">${(+v).toFixed(2)}</span></li>`;
            }).join('');

        /* —— spawnHints（关键调度参数；v1.51.4：i18n） —— */
        const hintEntries = [
            ['clearGuarantee', hints.clearGuarantee],
            ['sizePreference', hints.sizePreference],
            ['orderRigor',     hints.orderRigor],
            ['diversityBoost', hints.diversityBoost],
            ['comboChain',     hints.comboChain],
            ['pacingPhase',    profile?.pacingPhase],
            ['rhythmPhase',    hints.rhythmPhase],
            ['sessionArc',     hints.sessionArc],
            ['delightMode',    hints.delightMode],
        ].filter(([k, v]) => !STRATEGY_COMPONENT_KEYS.has(k) && v != null && v !== '');
        /* v1.51.9：hint 的 key → i18n 中文标签；value 若为 enum string，亦走 dfv.val.<ns>.<v>
         * 翻译，让「松紧期 / 节奏相位 / 会话弧线 / 愉悦模式」显示中文枚举（如 紧绷 / 兑现 / 巅峰）。 */
        const HINT_VALUE_NS = {
            pacingPhase: 'pacing',
            rhythmPhase: 'rhythm',
            sessionArc:  'arc',
            delightMode: 'delight',
        };
        /* v1.57.5 §E：在 hints 列表顶部插入"主导意图锚"
         *
         * 历史 bug（用户截图）：调香提示列同时高亮"策展紧 / 节奏档位 / 兑现 / 会话强结
         * / 慢节奏感 / 心流·兑现"等 6+ 项语义独立的 hint 枚举，玩家无法理解"系统到底
         * 在做什么"——这些 chip 是 spawn 决策的多维度独立投射，不是 7 个独立决策。
         *
         * 修复：在列表第一项插入高亮的"主导意图"标签（与 dfv.reason.* 同源 i18n），
         * 让玩家明白下面的 hints 是这个主导意图下的"各维度状态描述"，而不是 7 个并列决定。
         * 与 dfv-li-anchor 样式配套，颜色随 intent 变化（同 SPAWN_INTENT_COLOR 色板）。 */
        const intentForAnchor = intent || 'maintain';
        const intentLabel = _ti(`dfv.intent.${intentForAnchor}`, SPAWN_INTENT_DESC[intentForAnchor] || intentForAnchor);
        const intentAnchorTitle = _ti('dfv.hint.anchorTitle', '下方调香项是当前主导意图下的多维度状态描述，不是 N 个并列决定');
        const intentAnchorLabel = _ti('dfv.hint.anchorLabel', '当前主导意图');
        const anchorColor = SPAWN_INTENT_COLOR[intentForAnchor] || '#94a3b8';
        const anchorHtml = `<li class="dfv-li-anchor" title="${intentAnchorTitle}" style="--anchor-color:${anchorColor}">`
            + `<span class="dfv-li-key">${intentAnchorLabel}</span>`
            + `<span class="dfv-li-val dfv-li-anchor-val">${intentLabel}</span></li>`;
        const hintItemsHtml = hintEntries.length === 0
            ? `<li class="dfv-list-empty">${emptyTxt}</li>`
            : hintEntries.map(([k, v]) => {
                const label = _ti(`dfv.hint.${k}`, HINT_CN[k] || k);
                let dispV;
                if (typeof v === 'number') dispV = v.toFixed(2);
                else if (HINT_VALUE_NS[k]) dispV = _ti(`dfv.val.${HINT_VALUE_NS[k]}.${v}`, String(v));
                else dispV = String(v);
                return `<li><span class="dfv-li-key" title="${k}">${label}</span><span class="dfv-li-val">${dispV}</span></li>`;
            }).join('');
        els.hints.innerHTML = anchorHtml + hintItemsHtml;

        /* v1.59.20：A+B 组合的 B 部分——顶部"决策摘要"叙事条。
         * 用一句自然语言把"压力 → 意图 → 偏好 → 3 块"翻译给玩家，与左侧球状图
         * 形成"视觉链路 + 文字叙事"双层解释，彻底消除"看图不懂"的认知 gap。 */
        if (els.summary) {
            this._renderDecisionSummary(els.summary, insight, profile, intent);
        }
    }

    /**
     * v1.59.20：渲染顶部"决策摘要"叙事条。
     *
     * 模板：[stress 档·N%] · [intent 中文]：[偏好 top1-2] → [3 块 topDriver 简写]
     * 例：
     *   "高压·82% · harvest（送消行）：临消行 0.34 / 长条 33% → 可消2行 · 可清屏 · 综合"
     *   "中压·48% · maintain（维持）：机动性 0.6 / 多消 0.3 → 可消1行 · 机动高 · L形权重 28%"
     *
     * 数据来源（与 chosen 节点 topDriver 同源，保证一致性）：
     *   - stress: insight.stressLevel
     *   - intent: insight.spawnHints.spawnIntent + SPAWN_INTENT_DESC
     *   - 偏好 top1-2: insight.spawnHints 五向量 + shapeWeights top1（取数值最大的非 0 项）
     *   - 3 块 topDriver: insight.spawnDiagnostics.chosen[].topDriver.label
     */
    _renderDecisionSummary(host, insight, profile, intent) {
        if (!host || !insight) return;
        const stressLv = Number.isFinite(insight.stressLevel) ? insight.stressLevel : null;
        const diag = insight.spawnDiagnostics;
        const chosen = Array.isArray(diag?.chosen) ? diag.chosen : [];
        if (stressLv == null && chosen.length === 0) {
            host.innerHTML = `<span class="dfv-summary-empty">${_ti('dfv.summary.empty', '等待首次出块…')}</span>`;
            return;
        }

        /* —— 1) stress 档（低/中/高 + 百分比） —— */
        let stressBand = '—', stressColor = '#94a3b8';
        if (stressLv != null) {
            if (stressLv < 0.35) { stressBand = _ti('dfv.summary.stress.low', '低压'); stressColor = '#34d399'; }
            else if (stressLv < 0.65) { stressBand = _ti('dfv.summary.stress.mid', '中压'); stressColor = '#fbbf24'; }
            else { stressBand = _ti('dfv.summary.stress.high', '高压'); stressColor = '#f87171'; }
        }
        const stressTxt = stressLv != null
            ? `<span class="dfv-summary-seg dfv-summary-seg--stress" style="color:${stressColor}">${stressBand} · ${Math.round(stressLv * 100)}%</span>`
            : '';

        /* —— 2) intent 档（intent + 中文描述） —— */
        const intentColor = SPAWN_INTENT_COLOR[intent] || '#94a3b8';
        const intentCn = _ti(`dfv.intent.${intent}`, SPAWN_INTENT_DESC[intent] || intent);
        const intentTxt = intent
            ? `<span class="dfv-summary-seg dfv-summary-seg--intent" style="color:${intentColor}">${intent}（${intentCn}）</span>`
            : '';

        /* —— 3) 偏好 top1-2（spawnHints 五向量 + shapeWeights top1） ——
         *   覆盖最易解释的 5 个核心 hint，按数值排序取 top1，再加 shapeWeights top1，最多 2 项。 */
        const hints = insight.spawnHints || {};
        const hintCandidates = [
            ['clearGuarantee', hints.clearGuarantee, '临消行'],
            ['sizePreference', hints.sizePreference, '尺寸偏好'],
            ['orderRigor',     hints.orderRigor,     '次序约束'],
            ['diversityBoost', hints.diversityBoost, '多样'],
            ['comboChain',     hints.comboChain,     '连击'],
        ].filter(([, v]) => Number.isFinite(v) && Math.abs(v) >= 0.05)
         .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
        const prefParts = [];
        if (hintCandidates[0]) {
            const [, v, cn] = hintCandidates[0];
            prefParts.push(`${cn} ${v.toFixed(2)}`);
        }
        const topShape = Array.isArray(insight.shapeWeightsTop) && insight.shapeWeightsTop[0];
        if (topShape && Number.isFinite(topShape.probability)) {
            const cat = topShape.category ?? topShape.shape ?? topShape.id;
            const catCn = _ti(`dfv.shape.${cat}`, SHAPE_CATEGORY_CN[cat] || cat);
            prefParts.push(`${catCn} ${(topShape.probability * 100).toFixed(0)}%`);
        }
        const prefTxt = prefParts.length > 0
            ? `<span class="dfv-summary-seg dfv-summary-seg--pref">${prefParts.join(' / ')}</span>`
            : '';

        /* —— 4) 3 块 topDriver 简写（与 chosen 节点"因·XXX"小字一致） —— */
        const driverParts = chosen.slice(0, 3).map(c => {
            const label = c?.topDriver?.label || '综合';
            return label;
        });
        const driverTxt = driverParts.length > 0
            ? `<span class="dfv-summary-seg dfv-summary-seg--drivers">${driverParts.join(' · ')}</span>`
            : '';

        const sep = '<span class="dfv-summary-sep">·</span>';
        const arrow = '<span class="dfv-summary-arrow">→</span>';
        const segs = [];
        if (stressTxt) segs.push(stressTxt);
        if (intentTxt) segs.push(intentTxt);
        if (prefTxt) segs.push(prefTxt);
        const left = segs.join(sep);
        const html = driverTxt ? `${left} ${arrow} ${driverTxt}` : left;
        const tip = `决策摘要：[${stressBand} ${stressLv != null ? Math.round(stressLv * 100) + '%' : ''}] 触发 [${intent || '—'}] 意图，` +
            `结合偏好 [${prefParts.join(' / ') || '—'}]，最终选出 3 块（主因：${driverParts.join(' · ') || '—'}）。\n` +
            `数据源：insight.stressLevel / spawnHints.spawnIntent / shapeWeightsTop / spawnDiagnostics.chosen[].topDriver`;
        if (host.dataset.lastHtml !== html) {
            host.innerHTML = html;
            host.setAttribute('title', tip);
            host.dataset.lastHtml = html;
        }
    }

    /* ── 样式注入 ──────────────────────────────────────────────── */

    _injectStyles() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
.dfv-host {
    /* v1.51.2 浮窗：可拖动；root 不拦截盘面交互（pointer-events:none），卡片自身重启用。 */
    position: fixed; inset: 0; z-index: 9700;
    display: none; opacity: 0;
    pointer-events: none;
    transition: opacity .22s ease;
}
.dfv-host.dfv-open { display: block; opacity: 1; }

.dfv-card {
    pointer-events: auto;
    position: fixed;
    top: 50%;
    left: max(12px, env(safe-area-inset-left, 0px));
    transform: translateY(-50%);
    /* v1.59.6：默认宽 640 / max-height 820 → min(92vh, 900px)。
     * v1.59.3 已扩容到 640 / 820；v1.59.6 进一步上调 max-height 让 7 段 details 在
     * 默认状态下不出现滚动条（决策动态删除意图时间线后段高已减 ~30px，配合 max-height
     * 微调到 900px 可在主流分辨率完整放下）。 */
    width: min(640px, calc(100vw - 20px));
    max-height: min(92vh, 900px);
    /* v1.55.1：背景从 0.94 上拉到 0.97，配合移除 backdrop-filter（详见 docs/engineering/PERFORMANCE.md §1.1）。
     * 旧版 backdrop-filter:blur(10px) 会让浏览器对底下棋盘 canvas 持续合成模糊，
     * 是 DFV 打开时 GPU 飙到 ~75% 的主要原因之一。 */
    background: linear-gradient(160deg, rgba(15, 23, 42, 0.97), rgba(2, 6, 23, 0.97));
    border: 1px solid rgba(56, 189, 248, 0.32);
    border-radius: 14px;
    box-shadow:
        0 16px 40px rgba(2, 6, 23, 0.55),
        0 0 0 1px rgba(56, 189, 248, 0.18),
        0 0 60px rgba(56, 189, 248, 0.16) inset;
    color: #e2e8f0;
    display: flex; flex-direction: column;
    overflow: hidden;
    transition: width .22s ease, height .22s ease, max-height .22s ease;
}
.dfv-card--dragging {
    transition: none;
    cursor: grabbing !important;
    box-shadow:
        0 24px 56px rgba(2, 6, 23, 0.7),
        0 0 0 1px rgba(56, 189, 248, 0.28),
        0 0 80px rgba(56, 189, 248, 0.22) inset;
}

/* 折叠态：仅显示头部 + sparkline + 脚 */
.dfv-host.dfv-collapsed .dfv-card { width: 300px; max-height: none; height: auto !important; }
.dfv-host.dfv-collapsed .dfv-body { display: none; }

.dfv-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid rgba(56, 189, 248, 0.18);
    background: linear-gradient(90deg, rgba(56, 189, 248, 0.08), transparent);
    cursor: grab;
    user-select: none;
}
.dfv-head:active { cursor: grabbing; }
.dfv-head-title { display: flex; align-items: center; gap: 7px; font-weight: 700; font-size: 12px; }
/* v1.55.2：去掉 drop-shadow，emoji 自身辨识度已经足够 */
.dfv-head-icon { font-size: 16px; }
.dfv-head-meta { display: flex; align-items: center; gap: 8px; }
.dfv-head-pulse {
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 10px; padding: 2px 6px; border-radius: 8px;
    background: rgba(56, 189, 248, 0.16); color: #38bdf8; font-weight: 700;
    letter-spacing: 0.04em;
}
.dfv-iconbtn {
    background: transparent; border: 1px solid rgba(148, 163, 184, 0.4);
    color: #cbd5e1; width: 22px; height: 22px; border-radius: 11px;
    font-size: 14px; line-height: 1; cursor: pointer; padding: 0;
    transition: background .15s, border-color .15s;
    display: inline-flex; align-items: center; justify-content: center;
}
.dfv-close:hover { background: rgba(239, 68, 68, 0.18); border-color: rgba(239, 68, 68, 0.6); color: #fca5a5; }
.dfv-collapse:hover { background: rgba(56, 189, 248, 0.18); border-color: rgba(56, 189, 248, 0.6); color: #7dd3fc; }

/* —— 主体：左视觉炸裂 / 右文本聚合 ——
 * v1.59.2：DFV 整体重构。
 * - 左栏（.dfv-stage）：球状图独占整 stage，叠加背景能量场呼吸 / stress 多层辉光 /
 *   spawn 辐射波纹 / 意图弹跳，让"信号→压力→决策"动态过程具备视觉冲击力（"炸裂样式"）。
 * - 右栏（.dfv-details）：所有文本/数值/列表/灵敏度信息集中聚合；顶部新增「决策动态」区段
 *   承载 3 个 adc-* 模块（意图时间线 / stress 分量堆叠 / 响应灵敏度），与下方各 section
 *   节奏一致。
 * - grid 从 1fr|220px → 1fr|260px：右栏扩容 40px 容纳额外区段而不挤压左侧球状图。 */
.dfv-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 260px;
    gap: 6px;
    padding: 5px 8px 5px;
    flex: 1 1 auto;
    min-height: 0;
}
/* —— 左栏：球状图独占 + 炸裂视觉层 —— */
.dfv-stage {
    position: relative;
    min-height: 320px;
    border-radius: 12px;
    overflow: hidden;
    isolation: isolate;
    background:
        radial-gradient(circle at 68% 52%, rgba(56, 189, 248, 0.18), rgba(56, 189, 248, 0.03) 26%, transparent 64%),
        radial-gradient(circle at 22% 24%, rgba(34, 211, 238, 0.12), transparent 48%),
        radial-gradient(circle at 78% 84%, rgba(168, 85, 247, 0.10), transparent 52%),
        linear-gradient(180deg, rgba(15, 23, 42, 0.30), rgba(2, 6, 23, 0.62));
    box-shadow:
        inset 0 0 0 1px rgba(56, 189, 248, 0.14),
        inset 0 0 56px rgba(56, 189, 248, 0.10);
}
/* 背景能量场：缓慢呼吸 + 旋转的径向光斑，让左栏始终有"在运转"的感觉 */
.dfv-stage-aura {
    position: absolute; inset: -10%;
    pointer-events: none;
    z-index: 0;
    background:
        radial-gradient(closest-side at 50% 50%, rgba(56, 189, 248, 0.22), rgba(56, 189, 248, 0) 70%),
        conic-gradient(from 0deg at 50% 50%,
            rgba(56, 189, 248, 0.0) 0deg,
            rgba(56, 189, 248, 0.12) 60deg,
            rgba(168, 85, 247, 0.0) 120deg,
            rgba(251, 146, 60, 0.10) 200deg,
            rgba(34, 211, 238, 0.0) 280deg,
            rgba(56, 189, 248, 0.0) 360deg);
    filter: blur(28px);
    mix-blend-mode: screen;
    opacity: 0.6;
    animation: dfvAuraSpin 26s linear infinite, dfvAuraBreath 6.5s ease-in-out infinite;
}
@keyframes dfvAuraSpin { to { transform: rotate(360deg); } }
@keyframes dfvAuraBreath {
    0%,100% { opacity: 0.45; }
    50%     { opacity: 0.75; }
}
/* spawn 时触发的全屏震波（JS 通过 toggle .dfv-stage--shock 触发一次 0.6s 动画） */
.dfv-stage-shock {
    position: absolute; inset: 0;
    pointer-events: none;
    z-index: 1;
    opacity: 0;
    background:
        radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.20), rgba(255, 255, 255, 0) 30%),
        radial-gradient(circle at 50% 50%, rgba(56, 189, 248, 0.32), rgba(56, 189, 248, 0) 55%);
    mix-blend-mode: screen;
}
.dfv-stage--shock .dfv-stage-shock {
    animation: dfvShock 0.62s cubic-bezier(0.16, 1, 0.3, 1) 1;
}
@keyframes dfvShock {
    0%   { opacity: 0.85; transform: scale(0.55); filter: blur(0px); }
    60%  { opacity: 0.40; transform: scale(1.10); filter: blur(2px); }
    100% { opacity: 0;    transform: scale(1.35); filter: blur(8px); }
}
/* high-stress: 高压时左栏边缘脉动红光（CSS 跟随 .dfv-stage--high-stress） */
.dfv-stage--high-stress {
    box-shadow:
        inset 0 0 0 1px rgba(251, 113, 133, 0.30),
        inset 0 0 60px rgba(251, 113, 133, 0.22),
        0 0 28px rgba(251, 113, 133, 0.18);
    animation: dfvHighStressPulse 1.4s ease-in-out infinite;
}
@keyframes dfvHighStressPulse {
    0%,100% { box-shadow: inset 0 0 0 1px rgba(251, 113, 133, 0.30), inset 0 0 60px rgba(251, 113, 133, 0.18), 0 0 24px rgba(251, 113, 133, 0.14); }
    50%     { box-shadow: inset 0 0 0 1px rgba(251, 113, 133, 0.55), inset 0 0 80px rgba(251, 113, 133, 0.32), 0 0 40px rgba(251, 113, 133, 0.28); }
}
.dfv-particles { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 3; }
.dfv-svg { position: absolute; inset: 0; width: 100%; height: 100%; z-index: 2; }

/* —— 4 阶段流程导航：信号 → 压力 → 策略 → 意图 ——
 * v1.59.3：absolute 浮在 stage 顶部（不参与 SVG 布局），让"决策过程"成为视觉锚。
 * 当 stress 球高压（.dfv-stage--high-stress）时 step 2 高亮；spawn 时整条 nav 闪一下
 * （.dfv-stage--shock 触发 nav 短暂提亮），把"算法刚做出一次决策"的反馈直接连到流程上。 */
.dfv-flow-nav {
    position: absolute;
    top: 6px; left: 8px; right: 8px;
    z-index: 4;
    display: flex; align-items: center; justify-content: center;
    /* v1.60.6 → v1.60.7：进一步紧缩。删 1/3 阶段编号后名词独立站住，
     * gap 2px / padding 2px 6px，nav 总宽降到 ~290px，580px 浮层有充足余量。 */
    flex-wrap: wrap;
    gap: 2px;
    padding: 2px 6px;
    border-radius: 999px;
    background: linear-gradient(90deg,
        rgba(96, 165, 250, 0.14) 0%,
        rgba(34, 211, 238, 0.14) 33%,
        rgba(168, 85, 247, 0.14) 66%,
        rgba(244, 114, 182, 0.14) 100%);
    border: 1px solid rgba(56, 189, 248, 0.22);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
    pointer-events: auto;
    font-size: 9px;
    color: #e2e8f0;
    user-select: none;
}
.dfv-flow-step {
    display: inline-flex; align-items: center; gap: 2px;
    padding: 1px 5px;
    border-radius: 999px;
    background: rgba(2, 6, 23, 0.45);
    border: 1px solid rgba(148, 163, 184, 0.20);
    line-height: 1.35;
    white-space: nowrap;
    transition: transform .18s ease, background .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.dfv-flow-step__num {
    display: inline-flex; align-items: center; justify-content: center;
    /* v1.60.7：单字符 Unicode 圈数字 ① ②...，宽度收到 12px 内（约等于 1em） */
    min-width: 12px; height: 12px;
    padding: 0 1px;
    border-radius: 6px;
    background: rgba(56, 189, 248, 0.20);
    color: #7dd3fc;
    font-size: 8px;
    font-weight: 700;
    font-family: ui-monospace, 'SF Mono', monospace;
    line-height: 1;
}
.dfv-flow-step__name { font-weight: 600; letter-spacing: 0.02em; }
/* v1.60.7：signal / spawn 两个"名词锚点" step 加微弱视觉强调，
 * 让玩家在缺少 "1" / "3" 编号情况下仍能感知"流程起点 / 终点"。 */
.dfv-flow-step--signal .dfv-flow-step__name,
.dfv-flow-step--spawn .dfv-flow-step__name {
    font-size: 9.5px;
    letter-spacing: 0.05em;
}
/* v1.60.6 已删除 ∥ 分隔符（".dfv-flow-parallel"），派生 5 项纯靠颜色 + 收紧的 gap 表达"并列同源"；
 * "并列同源"语义改放进 .dfv-flow-step--stress 的 title hover 提示里，避免侵占横向空间。 */
.dfv-flow-step--signal   { border-color: rgba(96, 165, 250, 0.40); }
.dfv-flow-step--signal   .dfv-flow-step__num { background: rgba(96, 165, 250, 0.24); color: #93c5fd; }
.dfv-flow-step--stress   { border-color: rgba(34, 211, 238, 0.40); }
.dfv-flow-step--stress   .dfv-flow-step__num { background: rgba(34, 211, 238, 0.24); color: #67e8f9; }
.dfv-flow-step--strategy { border-color: rgba(168, 85, 247, 0.40); }
.dfv-flow-step--strategy .dfv-flow-step__num { background: rgba(168, 85, 247, 0.24); color: #c4b5fd; }
/* v1.59.15：spawnTargets / 调度参数两个新派生步 */
.dfv-flow-step--target   { border-color: rgba(16, 185, 129, 0.40); }
.dfv-flow-step--target   .dfv-flow-step__num { background: rgba(16, 185, 129, 0.24); color: #6ee7b7; }
.dfv-flow-step--schedule { border-color: rgba(252, 211, 77, 0.40); }
.dfv-flow-step--schedule .dfv-flow-step__num { background: rgba(252, 211, 77, 0.22); color: #fde68a; }
.dfv-flow-step--intent   { border-color: rgba(244, 114, 182, 0.40); }
.dfv-flow-step--intent   .dfv-flow-step__num { background: rgba(244, 114, 182, 0.24); color: #f9a8d4; }
/* v1.59.17：阶段 3 出块——末端 spawn（blockSpawn → 3 chosen shape），用青绿亮色突出"实际产出" */
.dfv-flow-step--spawn    { border-color: rgba(125, 211, 252, 0.55); background: rgba(14, 165, 233, 0.10); }
.dfv-flow-step--spawn    .dfv-flow-step__num { background: rgba(125, 211, 252, 0.34); color: #e0f2fe; }
.dfv-flow-arrow {
    color: rgba(148, 163, 184, 0.55);
    font-size: 8px;
    transform: translateY(-0.5px);
}
/* spawn 时 nav 整条提亮一次，把决策事件传导到流程导航 */
.dfv-stage--shock .dfv-flow-nav {
    animation: dfvFlowNavPulse 0.62s ease-out 1;
}
@keyframes dfvFlowNavPulse {
    0%   { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0.55), inset 0 0 24px rgba(56, 189, 248, 0.42); }
    100% { box-shadow: 0 0 0 0 rgba(255, 255, 255, 0),    inset 0 0 0    rgba(56, 189, 248, 0); }
}
/* 高压时压力 step 持续提亮 */
.dfv-stage--high-stress .dfv-flow-step--stress {
    background: rgba(251, 113, 133, 0.22);
    border-color: rgba(251, 113, 133, 0.65);
    box-shadow: 0 0 10px rgba(251, 113, 133, 0.35);
}
.dfv-stage--high-stress .dfv-flow-step--stress .dfv-flow-step__num {
    background: rgba(251, 113, 133, 0.55);
    color: #fff;
}

/* —— 右栏顶部「决策动态」区段：v1.59.6 简为 2 模块（压力归因 + 响应灵敏度） ——
 * 删除了意图时间线 + adc-timeline-* CSS 覆盖；右栏总高 ~减 30px，配合 max-height 900 让 7 段
 * 默认无需滚动。 */
.dfv-section--dynamics { padding: 2px 6px 4px; }
.dfv-dynamics-host {
    display: flex; flex-direction: column; gap: 3px;
    font-size: 9.5px; color: #cbd5e1;
}
.dfv-dynamics-host .adc-row-label {
    color: #7dd3fc; font-size: 8.5px; letter-spacing: 0.06em; font-weight: 700;
    text-transform: uppercase;
}
.dfv-dynamics-host .adc-muted { color: #64748b; font-size: 8.5px; }
.dfv-dynamics-host .adc-stack,
.dfv-dynamics-host .adc-sens { font-size: 9px; gap: 2px; }
.dfv-dynamics-host .adc-stack--empty,
.dfv-dynamics-host .adc-sens--empty {
    padding: 2px 4px; color: #64748b; font-size: 8.5px; text-align: left; font-style: italic;
}
/* 压力归因（竖排排序条目）紧凑化：在右栏 260px 下 top-4 双栏布局每行 ~14px */
.dfv-dynamics-host .adc-stack__head { padding: 0; }
.dfv-dynamics-host .adc-stack__cols { gap: 3px; }
.dfv-dynamics-host .adc-stack-block { padding: 2px 4px 2px; gap: 0; }
.dfv-dynamics-host .adc-stack-block__head { font-size: 8px; margin-bottom: 0; }
.dfv-dynamics-host .adc-stack-block__sum { font-size: 8px; }
.dfv-dynamics-host .adc-stack-item {
    grid-template-columns: minmax(0, 1fr) 24px 28px;
    gap: 3px;
    font-size: 8px;
    padding: 0;
    line-height: 1.2;
}
.dfv-dynamics-host .adc-stack-item__label { font-size: 8px; }
.dfv-dynamics-host .adc-stack-item__val { font-size: 8px; }
.dfv-dynamics-host .adc-stack-item__bar { height: 3px; }
.dfv-dynamics-host .adc-stack__summary { font-size: 8.5px; gap: 4px; }
/* 响应灵敏度紧凑化 */
.dfv-dynamics-host .adc-sens__head { padding: 0; }
.dfv-dynamics-host .adc-sens__subtitle { font-size: 7.5px; margin-left: 4px; }
.dfv-dynamics-host .adc-sens__hint { font-size: 8px; color: #94a3b8; }
.dfv-dynamics-host .adc-sens-row {
    grid-template-columns: 100px 38px 1fr;
    padding: 1px 4px; font-size: 8px;
    min-height: 14px;
}
.dfv-dynamics-host .adc-sens-pair { font-size: 8px; }
.dfv-dynamics-host .adc-sens-r { font-size: 8.5px; }
.dfv-dynamics-host .adc-sens-verdict { font-size: 8px; line-height: 1.2; }

.dfv-details {
    /* v1.59.6：默认 overflow:hidden，仅当极矮高度（如手机折叠态）才出滚动条；
     * 主流分辨率下 7 段配合 max-height 900 完整放下，绝不触发滚动。 */
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 2px;
    display: flex; flex-direction: column; gap: 2px;
    font-size: 9.5px;
}
.dfv-details::-webkit-scrollbar { width: 3px; }
.dfv-details::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.3); border-radius: 2px; }

/* v1.59.6 极致紧凑：section padding 3-6-4 → 2-5-3，title margin 0-0-2 → 0-0-1，
 * 让 7 段（决策动态 + 6 段）在 max-height 900px 下默认不出滚动。 */
.dfv-section {
    background: rgba(15, 23, 42, 0.55);
    border: 1px solid rgba(56, 189, 248, 0.10);
    border-radius: 5px;
    padding: 2px 5px 3px;
}
.dfv-sec-title {
    font-size: 9.5px; font-weight: 700; color: #7dd3fc; letter-spacing: 0.04em;
    margin: 0 0 1px;
    padding-bottom: 1px;
    border-bottom: 1px dashed rgba(56, 189, 248, 0.15);
    display: flex; justify-content: space-between; align-items: baseline; gap: 6px;
    line-height: 1.15;
}
.dfv-sec-sub { font-size: 8.5px; color: #94a3b8; font-weight: 500; letter-spacing: 0; text-transform: none; }

.dfv-intent-card {
    display: flex; align-items: center; gap: 6px; min-height: 16px;
}
.dfv-intent-pill {
    padding: 0 7px; border-radius: 999px;
    border: 1px solid rgba(148,163,184,0.35);
    font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 10px; font-weight: 800; letter-spacing: 0.04em;
    line-height: 1.6;
}
.dfv-intent-cn { color: #cbd5e1; font-size: 10px; }

/* —— 列表行：行高 16px / 字号 9px —— */
.dfv-list {
    list-style: none; margin: 0; padding: 0;
    display: flex; flex-direction: column; gap: 0;
}
/* v1.51.4：固定 2 列网格（2 × N）。窄屏（≤640px）下面再 fallback 到 1 列。 */
.dfv-list--two-col {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0 6px;
}
/* v1.59.7：3 列网格——形状权重 5 项排 3+2 两行，比 2 列 (3+2) 更紧凑 */
.dfv-list--three-col {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0 4px;
}
.dfv-list li {
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 0 4px;
    height: 16px;
    padding: 0 3px;
    border-radius: 3px;
    font-size: 9px;
    line-height: 1;
}
.dfv-list li + li { margin-top: 1px; }
.dfv-list li:hover { background: rgba(56, 189, 248, 0.06); }
.dfv-list-empty { opacity: 0.5; justify-content: center !important; font-style: italic; }
.dfv-li-key {
    color: #cbd5e1;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0;
}
.dfv-li-val {
    color: #fff; font-family: ui-monospace, 'SF Mono', monospace;
    font-size: 9px; font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
}
.dfv-list .dfv-li--pos .dfv-li-val { color: #fb923c; }
.dfv-list .dfv-li--neg .dfv-li-val { color: #22d3ee; }

.dfv-flags {
    display: flex; flex-wrap: wrap; gap: 2px;
}
.dfv-flag {
    font-size: 8.5px; padding: 1px 5px; border-radius: 999px;
    color: #64748b;
    background: rgba(2, 6, 23, 0.5);
    border: 1px solid rgba(100, 116, 139, 0.25);
    font-weight: 600;
    line-height: 1.4;
}
.dfv-flag--on { color: #fff; }
.dfv-flag--on.dfv-flag--neg {
    background: rgba(239, 68, 68, 0.18); border-color: rgba(239, 68, 68, 0.55); color: #fca5a5;
}
.dfv-flag--on.dfv-flag--pos {
    background: rgba(34, 197, 94, 0.18); border-color: rgba(34, 197, 94, 0.55); color: #86efac;
}
.dfv-flag--on.dfv-flag--neutral {
    background: rgba(96, 165, 250, 0.18); border-color: rgba(96, 165, 250, 0.55); color: #93c5fd;
}
/* v1.57.5 §D：被更高优先级意图覆盖的 chip——半透明 + 删除线，告诉玩家
 * "信号激活但本帧未生效"，避免把 chip 高亮误解为系统在做这件事。 */
.dfv-flag--overridden {
    opacity: 0.5;
    text-decoration: line-through;
    text-decoration-thickness: 1px;
    text-decoration-color: rgba(255, 255, 255, 0.45);
}
/* v1.58.3：跨维度信号冲突行——显式承认 flowState vs intent 等独立信号源对掐，
 * 比假装一致更可信。颜色用 amber（warn 而非 error），位置紧贴 chip 区下方。 */
.dfv-conflicts {
    margin-top: 4px;
    padding: 2px 6px;
    border-radius: 4px;
    background: rgba(245, 158, 11, 0.10);
    border: 1px solid rgba(245, 158, 11, 0.30);
    color: #fcd34d;
    font-size: 8.5px;
    line-height: 1.4;
    font-weight: 500;
    cursor: help;
}
/* v1.57.5 §E：调香提示顶部"主导意图锚"——给下方多 chip 提供视觉锚点，
 * 让玩家理解"下方各 hint 是这个意图下的多维状态"，而非 N 个并列决定。
 * 颜色随 intent 变化（inline --anchor-color 由 SPAWN_INTENT_COLOR 注入）。 */
.dfv-li-anchor {
    background: rgba(15, 23, 42, 0.78);
    border-left: 3px solid var(--anchor-color, #94a3b8);
    border-radius: 4px;
    padding: 3px 7px;
    margin-bottom: 3px;
    font-weight: 700;
    font-size: 10px;
    color: #e2e8f0;
    display: flex;
    justify-content: space-between;
    align-items: center;
}
.dfv-li-anchor .dfv-li-key { color: #94a3b8; font-size: 9px; font-weight: 600; }
.dfv-li-anchor-val {
    color: var(--anchor-color, #e2e8f0);
    font-size: 11px;
    letter-spacing: 0.3px;
}

/* —— sparkline 时间序列条（v1.51.3 紧凑：参考 .replay-series-cell 18px 行高） ——
 * v1.60.6 布局简化：强制 5 等列 repeat(5, minmax(0,1fr))，5 路 sparkline 默认单行；
 *   极窄面板（< 520px）通过 media query 降级 3 列，再窄到 < 380 才 2 列，避免出现 4+1 的 "4 顶满+1 孤行" 丑布局。 */
.dfv-sparks {
    padding: 4px 8px 4px;
    border-top: 1px solid rgba(56, 189, 248, 0.18);
    background: rgba(2, 6, 23, 0.5);
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 1px 6px;
}
.dfv-spark-row {
    display: grid;
    /* v1.60.10: 标签 2.6em→3.0em（容纳 3 字「消行率」无截断），
     * 数值 2.2em→2.8em（容纳 5 字符 "-0.05" / "0.30" 等宽完整显示），
     * sparkline 路径列 1fr 自然收缩 —— 用户反馈"线条过长、数字显示不全"修复。
     * min-width:0 让 1fr 列正确收缩，避免内部 SVG 撑爆 grid cell。 */
    grid-template-columns: 3.0em minmax(0, 1fr) 2.8em;
    align-items: center; gap: 4px;
    height: 18px;
    font-size: 10px;
    min-width: 0;
}
.dfv-spark-label {
    font-weight: 700; letter-spacing: 0.02em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfv-spark-svg {
    width: 100%; height: 14px; display: block; border-radius: 3px;
    background: color-mix(in srgb, #fff 3%, transparent);
    min-width: 0;
}
/* v1.59.8 → v1.60.6：sparkline 末点脉动圆点 + 趋势带呼吸 + 折线加粗 ——
 *   - dot 半径 2.0/3.0 → 2.6/4.2（视觉冲击 +50%）+ 双层 drop-shadow 加强光晕
 *   - dot 切位置 transition 0.18s → 0.32s ease-out（让"末点跳到新值"更跟手、更有惯性）
 *   - dot pulse 节奏 1.1s → 0.85s（更急促，"实时心跳"感）
 *   - fill 区域加 dfvSparkFillBreathe（opacity 0.10↔0.22 呼吸）—— 整条曲线"呼吸"
 *   - path stroke-width 1.8 → 2.1，更醒目；transition 用 cubic-bezier 强化"弹入"感 */
.dfv-spark-dot {
    transition: cx 0.32s cubic-bezier(0.2, 0.7, 0.2, 1), cy 0.32s cubic-bezier(0.2, 0.7, 0.2, 1);
    filter: drop-shadow(0 0 3px var(--dot-color, currentColor))
            drop-shadow(0 0 6px color-mix(in srgb, var(--dot-color, currentColor) 60%, transparent));
    animation: dfvSparkDotPulse 0.85s ease-in-out infinite;
}
.dfv-spark-dot--idle { animation: none; opacity: 0.32; filter: none; }
@keyframes dfvSparkDotPulse {
    0%,100% { r: 2.6; opacity: 1; }
    50%     { r: 4.2; opacity: 0.45; }
}
.dfv-spark-fill {
    transition: d 0.32s cubic-bezier(0.2, 0.7, 0.2, 1);
    animation: dfvSparkFillBreathe 2.4s ease-in-out infinite;
}
@keyframes dfvSparkFillBreathe {
    0%,100% { fill-opacity: 0.10; }
    50%     { fill-opacity: 0.24; }
}
.dfv-spark-path {
    transition: d 0.32s cubic-bezier(0.2, 0.7, 0.2, 1);
    stroke-width: 2.1;
    /* path 自身不做"扫光"（dasharray 会让大部分曲线隐藏，看不全趋势）；
     * 数据流动感全部交给 dot pulse + fill breathe + 弹性 transition 三重叠加。 */
}
@media (prefers-reduced-motion: reduce) {
    .dfv-spark-dot,
    .dfv-spark-fill { animation: none; }
}
.dfv-spark-value {
    text-align: right; font-family: ui-monospace, 'SF Mono', monospace;
    font-weight: 700; font-size: 10px;
    font-variant-numeric: tabular-nums;
    overflow: hidden;
}

/* v1.60.6：极窄面板降级 —— 5 列 → 3 列 → 2 列，避免 sparkline 短到只剩 dot */
@media (max-width: 520px) {
    .dfv-sparks { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 380px) {
    .dfv-sparks { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

/* —— 脚部图例 —— */
.dfv-foot {
    display: flex; gap: 10px; padding: 5px 10px;
    border-top: 1px solid rgba(56, 189, 248, 0.18);
    background: rgba(15, 23, 42, 0.6);
    font-size: 9px; color: #94a3b8;
    align-items: center;
}
.dfv-legend { display: inline-flex; align-items: center; gap: 6px; }
.dfv-legend--ver { margin-left: auto; opacity: 0.65; font-family: ui-monospace, 'SF Mono', monospace; }
.dfv-dot { width: 8px; height: 8px; border-radius: 50%; }
.dfv-dot--neg { background: #22d3ee; box-shadow: 0 0 8px #22d3ee; }
.dfv-dot--pos { background: #fb923c; box-shadow: 0 0 8px #fb923c; }
/* v1.59.11：共变图例点——用与纵轴 covary 虚线同色（slate-gray）+ 虚线边 */
.dfv-dot--covary { background: transparent; border: 1px dashed #94a3b8; box-shadow: none; }
.dfv-legend--covary { cursor: help; }
/* v1.59.19：出块原因图例（chosen 节点上方"送消行/送清屏/综合选/兜底块"语义说明）—— 一次性展示，
 * 避免玩家逐个 hover 才知道含义。每条 reason 名用 SHAPE_CATEGORY_COLOR 协调色高亮。 */
.dfv-foot--reason {
    border-top: 1px dashed rgba(56, 189, 248, 0.12);
    flex-wrap: nowrap;             /* v1.60.32：删除描述文字后强制不换行，5 个 badge 紧凑一行 */
    gap: 8px;
    padding: 4px 10px 5px;
    font-size: 8.4px; color: #cbd5e1;
    white-space: nowrap;
    overflow: hidden;
}
.dfv-legend--reason { cursor: help; gap: 4px; }
.dfv-legend--reason-title { opacity: 0.7; }
.dfv-reason-tag {
    font-weight: 700;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(15,23,42,0.6);
    border: 1px solid currentColor;
    font-size: 8.6px;
    letter-spacing: 0.02em;
}

/* v1.59.20：顶部决策摘要叙事条（A+B 组合的 B 部分） */
.dfv-decision-summary {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    padding: 6px 12px 7px;
    border-bottom: 1px solid rgba(56, 189, 248, 0.10);
    background: linear-gradient(180deg, rgba(15,23,42,0.45), rgba(15,23,42,0.18));
    font-size: 10.5px;
    line-height: 1.35;
    color: #e2e8f0;
    cursor: help;
    user-select: text;
}
.dfv-summary-empty { color: #64748b; font-style: italic; font-size: 10px; }
.dfv-summary-seg {
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
}
.dfv-summary-seg--stress { font-weight: 700; }
.dfv-summary-seg--intent { font-weight: 700; }
.dfv-summary-seg--pref { color: #cbd5e1; opacity: 0.85; }
.dfv-summary-seg--drivers {
    font-weight: 700;
    color: #93c5fd;
    padding: 1px 6px;
    border-radius: 3px;
    background: rgba(59,130,246,0.10);
    border: 1px solid rgba(147,197,253,0.30);
}
.dfv-summary-sep { color: #475569; opacity: 0.6; padding: 0 1px; }
.dfv-summary-arrow {
    color: #38bdf8;
    font-weight: 700;
    padding: 0 2px;
    animation: dfvSummaryArrow 2.4s ease-in-out infinite;
}
@keyframes dfvSummaryArrow {
    0%, 100% { opacity: 0.55; transform: translateX(0); }
    50%      { opacity: 1;    transform: translateX(2px); }
}

/* —— SVG 内部样式 —— */
.dfv-svg .dfv-node-label { font-size: 10px; fill: #cbd5e1; font-weight: 600; }
.dfv-svg .dfv-node-value {
    font-size: 8.4px;
    fill: #fff;
    font-weight: 700;
    font-family: ui-monospace, 'SF Mono', monospace;
    paint-order: stroke;
    stroke: rgba(2, 6, 23, 0.72);
    stroke-width: 1.6px;
}
.dfv-svg .dfv-stress-label { font-size: 7.6px; fill: #fff; font-weight: 700; letter-spacing: 0.12em; opacity: 0.8; }
.dfv-svg .dfv-stress-value { font-size: 12px; fill: #fff; font-weight: 800; font-family: ui-monospace, 'SF Mono', monospace; }
.dfv-svg .dfv-intent-label { font-size: 7.8px; fill: #f1f5f9; font-weight: 700; letter-spacing: 0.12em; opacity: 0.85; }
.dfv-svg .dfv-intent-value { font-size: 10.5px; fill: #fff; font-weight: 800; font-family: ui-monospace, 'SF Mono', monospace; }
/* v1.55.2 GPU 合成层瘦身（接续 v1.55.1）：
 *
 * 旧版 SVG 用了 11+ 处 filter: drop-shadow/blur、2 处 mix-blend-mode: screen、
 * 以及无限循环的 @keyframes dfv-node-breathe（transform: scale 永不停止）。
 * 与 docs/engineering/PERFORMANCE.md §1.1 明确指出的"无限 transform/filter 动画
 * 永不停止合成"高度相符，是 DFV v1.55.1 优化后 GPU 仍维持 ~44% 的主因。
 *
 * 本轮：
 *   - 移除 dfv-node-breathe 无限呼吸动画（核心 core 永远缩放 1.0）；
 *   - 全部 SVG filter:drop-shadow/blur 移除，发光改由"已绘的 glow 圆环 + 半透明 fill"承担；
 *   - 移除两处 mix-blend-mode: screen，避免强制 stacking context 跨层合成；
 *   - transition 时间统一收到 0.18s 或更低，并去掉对 attribute 变化最频繁的 width/dashoffset transition；
 *   - intent-flash 还是 .55s 一次性闪烁动画，保留（仅 spawn pulse 时触发，非常驻）。
 */
.dfv-svg .dfv-edge { transition: stroke .18s; }
.dfv-svg .dfv-edge--baseline { stroke-dasharray: 4 4; }
.dfv-svg .dfv-edge--active   { stroke-dasharray: none; }
.dfv-svg .dfv-edge--halo {
    /* halo 仍存在，但靠原 SVG stroke-width + 半透色 emulate 发光，不再用 filter:blur */
    opacity: 0.65;
}
.dfv-svg .dfv-edge--flow {
    opacity: 0.95;
}
.dfv-svg .dfv-stress-glow-outer,
.dfv-svg .dfv-stress-glow-mid { opacity: 0.78; }
.dfv-svg .dfv-stress-core { transition: fill .18s; }
.dfv-svg .dfv-stress-core-inner { transition: fill .18s; }
.dfv-svg .dfv-stress-spec { opacity: 0.9; }
.dfv-svg .dfv-stress-ring { transition: r .12s linear; }
.dfv-svg .dfv-node--intent circle { transition: fill .18s, stroke .18s; }
.dfv-svg .dfv-intent-orbit { opacity: 0.35; }
.dfv-svg .dfv-intent-flash circle { animation: dfv-flash .55s ease-out; }
@keyframes dfv-flash {
    0%   { opacity: 0.45; }
    100% { opacity: 1; }
}
.dfv-svg .dfv-node--signal circle { transition: fill .18s, stroke .18s, fill-opacity .22s, opacity .22s; }
/* v1.59.8：节点身份色策略——核心 fill 始终 = baseColor，强度由 fill-opacity 驱动
 *   - 数据中：节点本身 opacity:1，fill-opacity 由 _renderSignalNode 设到 0.55..1.0
 *   - idle（无数据 / 加载初）：dfv-node--idle 让 fill-opacity 限 0.35 + 1.8s 缓慢呼吸，
 *     视觉上"待机但有身份色"，绝不退化为灰
 *   - active（贡献中）：保持 v1.59.4 外圈彩光呼吸 + opacity 1 高亮 */
.dfv-svg .dfv-node--signal { opacity: 1; transition: opacity .22s ease; }
.dfv-svg .dfv-node--idle .dfv-node-core,
.dfv-svg .dfv-node--idle .dfv-intent-core {
    fill-opacity: 0.35 !important;
    animation: dfvNodeIdleBreath 1.8s ease-in-out infinite;
}
@keyframes dfvNodeIdleBreath {
    0%,100% { fill-opacity: 0.30; }
    50%     { fill-opacity: 0.55; }
}
.dfv-svg .dfv-node--signal.dfv-node--active > circle.dfv-node-aura {
    fill: var(--node-base, rgba(56, 189, 248, 0.32));
    fill-opacity: 0.55;
    animation: dfvNodeActiveBreath 1.4s ease-in-out infinite;
}
@keyframes dfvNodeActiveBreath {
    0%,100% { fill-opacity: 0.85; transform: scale(1); }
    50%     { fill-opacity: 0.45; transform: scale(1.08); }
}
.dfv-svg .dfv-node--signal.dfv-node--active > circle.dfv-node-aura {
    transform-origin: center;
    transform-box: fill-box;
}
.dfv-svg .dfv-strategy-link { transition: stroke .18s; }
.dfv-svg .dfv-strategy-branch { transition: stroke .18s; }
.dfv-svg .dfv-strategy-link--halo { opacity: 0.55; }
.dfv-svg .dfv-strategy-link--flow { opacity: 0.95; }
.dfv-svg .dfv-strategy-node-glow {
    opacity: 0.45;
    transition: fill .18s, opacity .18s;
}
.dfv-svg .dfv-strategy-node-core {
    transition: fill .18s, stroke .18s;
}
.dfv-svg .dfv-strategy-node-inner { transition: fill .18s; }
.dfv-svg .dfv-strategy-node-spec { transition: opacity .18s; }
.dfv-svg .dfv-strategy-node-label {
    fill: #e2e8f0;
    font-size: 6.9px;
    font-weight: 700;
    letter-spacing: 0.02em;
    paint-order: stroke;
    stroke: rgba(2,6,23,0.88);
    stroke-width: 1.8px;
    text-shadow: 0 0 5px rgba(2,6,23,0.85);
}
.dfv-svg .dfv-strategy-node-value {
    fill: #ffffff;
    font-size: 7.3px;
    font-weight: 700;
    letter-spacing: 0.02em;
    font-family: ui-monospace, 'SF Mono', monospace;
    paint-order: stroke;
    stroke: rgba(2,6,23,0.80);
    stroke-width: 1.6px;
}
/* v1.59.15: spawnTargets 6 维 + 4 调度参数 mini 节点（比 5 核心分量稍小） */
.dfv-svg .dfv-target-node-core, .dfv-svg .dfv-schedule-node-core {
    transition: fill .18s, stroke .18s, fill-opacity .18s;
}
.dfv-svg .dfv-target-node-glow, .dfv-svg .dfv-schedule-node-glow { transition: r .18s, fill .18s; }
.dfv-svg .dfv-target-node-label, .dfv-svg .dfv-schedule-node-label {
    fill: #cbd5e1;
    font-size: 6.0px;
    font-weight: 700;
    letter-spacing: 0.01em;
    paint-order: stroke;
    stroke: rgba(2,6,23,0.88);
    stroke-width: 1.4px;
    text-shadow: 0 0 4px rgba(2,6,23,0.80);
}
.dfv-svg .dfv-target-node-value, .dfv-svg .dfv-schedule-node-value {
    fill: #ffffff;
    font-size: 6.4px;
    font-weight: 700;
    letter-spacing: 0.02em;
    font-family: ui-monospace, 'SF Mono', monospace;
    paint-order: stroke;
    stroke: rgba(2,6,23,0.78);
    stroke-width: 1.3px;
}
/* v1.59.17：阶段③ chosen shape 节点（intent→chosen 实色因果连线 + chosen 节点本体 + reason 标签） */
/* v1.59.18：chosen 节点新结构（mini grid + 上 reason / 下 id）
 * v1.59.22：transition 缩短 .35s → .15s——chosen 切换时入向虚线亮/灭更跟手，
 * 减少 hover 切换 chosen 节点期间"虚线慢淡入淡出"的视觉拖尾感。 */
.dfv-svg .dfv-derive-link--chosen { transition: stroke-opacity .15s, stroke-width .15s; }
/* v1.60.17：所有可 hover 节点统一 cursor:help —— 用户反馈"节点都有 SVG <title> tooltip
 * 但鼠标光标无任何提示，看不出哪些节点可 hover"。覆盖 5 类节点：
 *   .dfv-node            （信号 10 节点 + 压力球 + 意图节点的 g 容器，全用此 base class）
 *   .dfv-strategy-node   （策略派生 5 节点）
 *   .dfv-target-node     （目标派生 6 节点）
 *   .dfv-schedule-node   （调度派生 4 节点）
 *   .dfv-chosen-node     （chosen 3 节点）
 * 以及 HUB 的 .dfv-flow-step（HTML span，6 个阶段步骤都有 title）。
 * cursor:help 是 CSS 标准光标语义—"该元素有附加帮助说明"，hover 时浏览器原生显示 <title>。 */
.dfv-svg .dfv-node,
.dfv-svg .dfv-strategy-node,
.dfv-svg .dfv-target-node,
.dfv-svg .dfv-schedule-node,
.dfv-svg .dfv-chosen-node,
.dfv-flow-step { cursor: help; }
.dfv-svg .dfv-chosen-node-bg { transition: stroke .25s, stroke-opacity .25s, fill .25s; }
.dfv-svg .dfv-chosen-node-glow { transition: fill .25s; }
.dfv-svg .dfv-chosen-node-grid rect { transition: fill .25s, stroke .25s; }
.dfv-svg .dfv-chosen-node-id {
    fill: #f1f5f9;
    font-size: 8.4px;
    font-weight: 800;
    letter-spacing: 0.02em;
    font-family: ui-monospace, 'SF Mono', monospace;
    paint-order: stroke;
    stroke: rgba(2,6,23,0.92);
    stroke-width: 1.8px;
}
.dfv-svg .dfv-chosen-node-reason {
    fill: #fcd34d;
    font-size: 8.2px;
    font-weight: 700;
    letter-spacing: 0.04em;
    paint-order: stroke;
    stroke: rgba(2,6,23,0.92);
    stroke-width: 1.8px;
}
/* v1.59.21 方案 C：hover chosen 节点时反向追溯高亮——SVG 整体进入"driver-mode"，
 * 非追溯节点淡化，被驱动路径上的节点 (.dfv-driver-hl) 保持 1.0 + 描边加粗变金。
 *
 * v1.59.22 防抖动重构：
 *   - 去除 filter:saturate / drop-shadow：filter 会强制合成层重光栅化（GPU 重负载），
 *     29+ 节点同时切换 filter 在 4K 屏 / 低配 GPU 上会引发明显帧抖。改用纯 opacity + stroke。
 *   - transition 缩短到 .12s（从 .22s）：切换 chosen 节点更跟手，且配合 _clearDriverHighlight
 *     的 rAF 延迟设计（同帧 mouseenter 会取消 clear），SVG 保持 driver-mode 不抖动。
 *   - 非追溯派生节点 opacity 从 0.18 提升到 0.22：保留更多位置感知，焦点对比度仍足够。 */
.dfv-svg.dfv-svg--driver-mode .dfv-node,
.dfv-svg.dfv-svg--driver-mode .dfv-strategy-node,
.dfv-svg.dfv-svg--driver-mode .dfv-target-node,
.dfv-svg.dfv-svg--driver-mode .dfv-schedule-node,
.dfv-svg.dfv-svg--driver-mode .dfv-chosen-node {
    transition: opacity .12s ease;
    opacity: 0.22;
}
.dfv-svg.dfv-svg--driver-mode .dfv-derive-link,
.dfv-svg.dfv-svg--driver-mode .dfv-edge {
    transition: opacity .12s ease;
    opacity: 0.10;
}
.dfv-svg.dfv-svg--driver-mode .dfv-driver-hl {
    opacity: 1 !important;
}
.dfv-svg.dfv-svg--driver-mode .dfv-driver-hl .dfv-node-core,
.dfv-svg.dfv-svg--driver-mode .dfv-driver-hl .dfv-strategy-node-core,
.dfv-svg.dfv-svg--driver-mode .dfv-driver-hl .dfv-target-node-core,
.dfv-svg.dfv-svg--driver-mode .dfv-driver-hl .dfv-schedule-node-core,
.dfv-svg.dfv-svg--driver-mode .dfv-driver-hl .dfv-chosen-node-bg,
.dfv-svg.dfv-svg--driver-mode .dfv-driver-hl .dfv-intent-core {
    transition: stroke-width .12s ease, stroke .12s ease;
    stroke-width: 2.6 !important;
    stroke: #fde68a !important;
}
/* 当前 chosen 的入向追溯虚线 (JS 已设 stroke-opacity=0.92) 在 driver-mode 下保持高亮 */
.dfv-svg.dfv-svg--driver-mode .dfv-derive-link--chosen[stroke-opacity="0.92"] {
    opacity: 1;
}

/* v1.60.6 缺口 #4：⚡ 事件注入 badge —— relief 青、pressure 橙（fill 在 JS 侧动态设）。
 * pulse 动画：8% 亮度循环呼吸，让玩家眼角余光也能捕捉到"这块是事件注入的"。 */
.dfv-svg .dfv-chosen-node-inject-badge {
    font-size: 11px;
    font-weight: 700;
    paint-order: stroke fill;
    stroke: rgba(15, 23, 42, 0.92);
    stroke-width: 2.4;
    stroke-linejoin: round;
    pointer-events: none;
    animation: dfvInjectPulse 1.6s ease-in-out infinite;
}
@keyframes dfvInjectPulse {
    0%, 100% { opacity: 0.95; }
    50%      { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
    .dfv-svg .dfv-chosen-node-inject-badge { animation: none; }
}

/* v1.60.21：⧈ 双胞胎/三胞胎 badge —— 与 ⚡ 注入 badge 共用样式但置于左上角，
 * 紫色配色区分（dup3 比 dup2 更亮）。replica fill-opacity=1.0 实心；main 0.35 描边。 */
.dfv-svg .dfv-chosen-node-dup-badge {
    font-size: 11px;
    font-weight: 700;
    paint-order: stroke fill;
    stroke: rgba(15, 23, 42, 0.92);
    stroke-width: 2.4;
    stroke-linejoin: round;
    pointer-events: none;
    animation: dfvInjectPulse 1.6s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
    .dfv-svg .dfv-chosen-node-dup-badge { animation: none; }
}

/* v1.59.21 方案 C：决策摘要在 hover 反向高亮期间动态显示"追溯：因·XXX"小徽章。
 * v1.60.6 抖动修复：
 *   - 改为永久驻留 DOM（JS 用 visibility 切换显隐），不再 append/remove
 *   - min-width 180px 让不同 chosen 节点 hover 切换时 summary wrap 状态稳定
 *   - display inline-block 让 min-width 生效（flex item 内 inline 默认忽略 min-width）
 *   - box-sizing 确保 padding 不引发额外宽度抖动 */
.dfv-summary-driver-badge {
    display: inline-block;
    box-sizing: border-box;
    min-width: 180px;
    text-align: center;
    font-weight: 700;
    padding: 1px 6px;
    margin-left: 6px;
    border-radius: 3px;
    background: rgba(253,224,71,0.12);
    border: 1px solid rgba(253,224,71,0.45);
    letter-spacing: 0.02em;
    animation: dfvDriverBadgeBlink 1.2s ease-in-out infinite;
}
@keyframes dfvDriverBadgeBlink {
    0%, 100% { box-shadow: 0 0 0 0 rgba(253,224,71,0.5); }
    50%      { box-shadow: 0 0 6px 1px rgba(253,224,71,0.7); }
}
@media (prefers-reduced-motion: reduce) {
    .dfv-summary-driver-badge { animation: none; }
}

/* v1.59.20：chosen 节点底部第三行"因·XXX"主驱动因子小字
 * （消除"为什么是这块"的认知 gap，常驻显示不依赖 hover） */
.dfv-svg .dfv-chosen-node-driver {
    fill: #93c5fd;
    font-size: 7.0px;
    font-weight: 600;
    letter-spacing: 0.04em;
    paint-order: stroke;
    stroke: rgba(2,6,23,0.92);
    stroke-width: 1.5px;
    opacity: 0.92;
}
.dfv-svg .dfv-spawn-attempt-badge {
    fill: #94a3b8;
    font-size: 6.0px;
    font-weight: 600;
    letter-spacing: 0.02em;
    paint-order: stroke;
    stroke: rgba(2,6,23,0.80);
    stroke-width: 1.2px;
}
.dfv-card--resizing { user-select: none; }
.dfv-resize-handle {
    position: absolute;
    right: 4px;
    bottom: 4px;
    width: 16px;
    height: 16px;
    border-right: 2px solid rgba(125, 211, 252, 0.7);
    border-bottom: 2px solid rgba(125, 211, 252, 0.7);
    border-bottom-right-radius: 6px;
    opacity: 0.72;
    cursor: nwse-resize;
    pointer-events: auto;
    z-index: 2;
}
.dfv-resize-handle:hover {
    opacity: 1;
    box-shadow: 0 0 8px rgba(56,189,248,0.45);
}

/* —— 入口按钮（融入快捷开关簇） ——
 * v1.55.6：旧版独立蓝紫渐变底色与其他 feedback-toggle-btn 的统一深色不一致。
 * v1.55.7：激活态 / 非激活态由 main.css 统一规则（.is-active 接管）。
 * v1.55.8：删除非激活态的细描边——所有"非激活态"按钮在 main.css 已统一浅灰，
 *   DFV 关闭时与其他按钮完全融为一体；hover 时由 main.css 给一次蓝紫渐变预览
 *   ("这是 DFV 入口")，避免抢视觉的同时保留可发现性。 */
.dfv-floating-btn {
    position: fixed; right: 12px; top: 12px; z-index: 9698;
}

/* —— 旧入口（fallback）的 skill-bar 风格 —— */
.skill-btn--decision-flow {
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.22), rgba(168, 85, 247, 0.22));
    border-color: rgba(56, 189, 248, 0.35);
    color: #e0f2fe;
}
.skill-btn--decision-flow:hover {
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.34), rgba(168, 85, 247, 0.34));
    box-shadow: 0 0 12px rgba(56, 189, 248, 0.45);
}

/* 窄屏：拼成单列；list 也回退单列 */
@media (max-width: 640px) {
    .dfv-card { width: calc(100vw - 16px); max-height: 88vh; left: 8px; }
    .dfv-body { grid-template-columns: 1fr; }
    .dfv-stage { min-height: 280px; }
    .dfv-list--two-col { grid-template-columns: 1fr; }
    .dfv-list--three-col { grid-template-columns: repeat(2, 1fr); }
}
`;
        document.head.appendChild(style);
    }
}

let _instance = null;

/**
 * v1.55.1：测试 hook。仅给 tests/decisionFlowViz.test.js 用，不在生产路径调用。
 */
export const __dfvTestables = {
    fingerprint: _dfvFingerprint,
    DFV_FPS_ACTIVE,
    DFV_FPS_IDLE,
    DFV_PARTICLE_CAP,
    DFV_TRAIL_COUNT,
    setAttrIfChanged: _setAttrIfChanged,
    createInstance: () => new DecisionFlowViz(),
    /* v1.60.13：暴露 driver 路径表 + 派生节点定义给 tests/decisionFlowVizDriverPaths.test.js，
     * 用于锁定"每个 chosenMeta.topDriver.key 都有显式 path"等不变式，防止以后回归。 */
    DRIVER_NODE_PATHS,
    STRATEGY_COMPONENT_DEFS,
    SPAWN_TARGET_DEFS,
    SCHEDULE_PARAM_DEFS,
};

export function initDecisionFlowViz(game) {
    if (_instance) return _instance;
    _instance = new DecisionFlowViz();
    _instance.init(game);
    return _instance;
}

export function toggleDecisionFlowViz() {
    _instance?.toggle();
}

export function getDecisionFlowViz() {
    return _instance;
}
