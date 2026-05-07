/**
 * 侧栏与关键 UI 的 emoji 图标本（单一语义来源，避免同图标多义）。
 * 修改时请同步 index.html 中对应的 aria-hidden 节点。
 *
 * 与 strategyAdvisor 提示卡：`✨` 仅用于「生成式」；新手欢迎用 👋；
 * 训练「损失」用 📉；对局内「策略转向」用 🧭，避免与侧栏混淆。
 */
export const UI_ICONS = {
    /** 玩家画像主标题 */
    profileTitle: '👤',
    /** 能力指标：多档计量、滑动窗口统计 */
    abilityMetrics: '🎚️',
    /** 实时状态：遥测/在线曲线 */
    liveState: '📡',
    /** 实时策略：目标与建议 */
    liveStrategy: '🎯',
    /** 策略解释：文字说明 */
    strategyExplain: '💬',
    /** 出块算法（总开关区块） */
    spawnAlgorithmSection: '⚙️',
    /** 启发式：显式启发式/条文式引擎（非生成式） */
    ruleAlgorithm: '📖',
    /** 生成式：序列模型 */
    generativeRecommend: '✨',
    /** 模型训练 */
    modelTraining: '🏋️',
    /** RL 机器人面板主标题 */
    rlRobot: '🦾',
    /** RL 统计与操作 */
    rlStatsAndActions: '📋',
    /** 训练损失 */
    trainingLoss: '📉',
    /** 训练进展日志 */
    trainingEpisodeLog: '📜',
    /** 训练看板主标题：汇总图表 */
    trainingDashboard: '📊',
    /** 看板摘要与工具 */
    dashboardSummaryTools: '🧰',
    /** 训练指标 */
    trainingCurve: '📈',
    /** 模型回退到规则 */
    spawnFallback: '🔄',
};
