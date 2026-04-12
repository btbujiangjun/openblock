/**
 * 实时游戏策略顾问
 *
 * 根据玩家画像 (PlayerProfile) + 棋盘状态 + 自适应出块 insight，
 * 生成 1~3 条「当前最该做什么」的个性化策略建议，
 * 每条包含 { icon, title, detail, priority, category }。
 *
 * category 枚举：
 *   survival   — 保命：填充高 / 恢复模式
 *   clear      — 消行：连击 / 差一点
 *   build      — 构型：堆叠 / 留缺口
 *   pace       — 节奏：放慢 / 加速
 *   explore    — 探索：新手引导 / 新鲜感
 */

/**
 * @typedef {Object} StrategyTip
 * @property {string} icon
 * @property {string} title   短标题（≤6 字）
 * @property {string} detail  一句话说明
 * @property {number} priority 0~1 越高越紧急
 * @property {string} category
 */

/**
 * @param {import('./playerProfile.js').PlayerProfile} profile
 * @param {object} [insight] _lastAdaptiveInsight
 * @param {object} [gridInfo] { fillRatio, maxHeight, holesCount }
 * @returns {StrategyTip[]} 按 priority 降序排列的策略建议（最多 3 条）
 */
export function generateStrategyTips(profile, insight, gridInfo) {
    /** @type {StrategyTip[]} */
    const tips = [];

    const flow = profile.flowState;
    const skill = profile.skillLevel;
    const m = profile.metrics;
    const mom = profile.momentum;
    const fr = profile.frustrationLevel;
    const session = profile.sessionPhase;
    const fd = profile.flowDeviation;
    const fill = gridInfo?.fillRatio ?? insight?.boardFill ?? 0;
    const holes = gridInfo?.holesCount ?? 0;
    const maxH = gridInfo?.maxHeight ?? 0;

    /* ── 1. 生存优先 ── */
    if (fill > 0.75) {
        tips.push({
            icon: '🚨', title: '紧急清行',
            detail: `棋盘填充 ${(fill * 100).toFixed(0)}%，优先放置能完成整行的块，避免继续堆高。`,
            priority: 0.95, category: 'survival'
        });
    } else if (fill > 0.6) {
        tips.push({
            icon: '⚠️', title: '控制高度',
            detail: '棋盘偏满，放块时优先选择能降低最高列或填补空洞的位置。',
            priority: 0.7, category: 'survival'
        });
    }

    if (profile.needsRecovery) {
        tips.push({
            icon: '🛟', title: '恢复模式',
            detail: '系统已切换到恢复出块，利用小块 / 长条尽快消行腾出空间。',
            priority: 0.88, category: 'survival'
        });
    }

    /* ── 2. 空洞管理 ── */
    if (holes > 3) {
        tips.push({
            icon: '🕳️', title: '填补空洞',
            detail: `当前 ${holes} 个空洞，优先将块放入凹陷处而非平铺顶部。`,
            priority: 0.72, category: 'build'
        });
    }

    /* ── 3. 连击策略 ── */
    if (profile.recentComboStreak >= 2) {
        tips.push({
            icon: '🔥', title: '保持连击',
            detail: `已连续 ${profile.recentComboStreak} 次多行消除！关注接近满行的区域，延续连击获得高分。`,
            priority: 0.8, category: 'clear'
        });
    } else if (profile.hadRecentNearMiss) {
        tips.push({
            icon: '⚡', title: '差一步消行',
            detail: '上一步非常接近消行，这轮出块更友好，抓住机会填满缺口。',
            priority: 0.75, category: 'clear'
        });
    }

    /* ── 4. 挫败缓解 ── */
    if (fr >= 4) {
        tips.push({
            icon: '💪', title: '别急，稳住',
            detail: `连续 ${fr} 步未消行，系统已降低难度。先找最容易消的行，一步步恢复节奏。`,
            priority: 0.82, category: 'pace'
        });
    }

    /* ── 5. 心流方向 ── */
    if (flow === 'bored' && tips.length < 3) {
        tips.push({
            icon: '🎯', title: '提升挑战',
            detail: '当前操作轻松，尝试构建多行同消（3行+）或预留 combo 结构，获取更高分。',
            priority: 0.5, category: 'build'
        });
    } else if (flow === 'anxious' && !tips.find(t => t.category === 'survival') && tips.length < 3) {
        tips.push({
            icon: '🧘', title: '放慢节奏',
            detail: '检测到决策压力偏大，不必着急——多观察候选块与缺口的匹配关系再落子。',
            priority: 0.65, category: 'pace'
        });
    }

    /* ── 6. 认知负荷 ── */
    if (m.thinkMs > 8000 && profile.cognitiveLoad > 0.6 && tips.length < 3) {
        tips.push({
            icon: '🧩', title: '简化决策',
            detail: '思考时间较长，建议先放最明确的块，减少同时权衡的选项数。',
            priority: 0.55, category: 'pace'
        });
    }

    /* ── 7. 动量下降 ── */
    if (mom < -0.4 && tips.length < 3) {
        tips.push({
            icon: '📉', title: '调整策略',
            detail: '近期消行率下降，考虑改变堆叠策略——留出一列做长条消行通道。',
            priority: 0.6, category: 'build'
        });
    }

    /* ── 8. 构型建议 ── */
    if (fill < 0.3 && skill > 0.5 && tips.length < 3) {
        tips.push({
            icon: '🏗️', title: '规划堆叠',
            detail: '棋盘空间充裕，可以有意留出 1~2 列通道，为后续长条消行和 combo 做准备。',
            priority: 0.4, category: 'build'
        });
    }

    /* ── 9. 新手引导 ── */
    if (profile.isInOnboarding) {
        tips.length = 0;
        tips.push({
            icon: '✨', title: '欢迎新手',
            detail: '先熟悉拖拽放块：贴齐边缘、从底部铺路，尽量少留空洞，便于后续整理盘面。',
            priority: 1, category: 'explore'
        });
        tips.push({
            icon: '💡', title: '对齐边缘',
            detail: '初期建议沿棋盘底部和侧边放块，尽量不留空洞，更容易消行。',
            priority: 0.9, category: 'explore'
        });
    } else if (profile.isNewPlayer && tips.length < 3) {
        tips.push({
            icon: '💡', title: '新手提示',
            detail: '尽量从底部开始整齐堆叠，避免中间留空。点击「求助」可查看推荐落子。',
            priority: 0.45, category: 'explore'
        });
    }

    /* ── 10. 会话疲劳 ── */
    if (session === 'late' && mom < -0.2 && tips.length < 3) {
        tips.push({
            icon: '☕', title: '注意休息',
            detail: '游戏时间较长且状态有所下滑，适当休息能恢复专注力。',
            priority: 0.35, category: 'pace'
        });
    }

    /* ── 兜底 ── */
    if (tips.length === 0) {
        tips.push({
            icon: '✅', title: '状态良好',
            detail: '当前节奏与能力匹配，保持专注，继续当前打法即可。',
            priority: 0.3, category: 'pace'
        });
    }

    tips.sort((a, b) => b.priority - a.priority);
    return tips.slice(0, 3);
}
