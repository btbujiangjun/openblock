/**
 * 实时游戏策略顾问（三层架构同步）
 *
 * 根据玩家画像 (PlayerProfile) + 棋盘状态 + 自适应出块 insight，
 * 生成 1~3 条「当前最该做什么」的个性化策略建议。
 *
 * category 枚举：
 *   survival   — 保命：填充高 / 恢复模式
 *   clear      — 消行：连击 / 差一点 / 多消
 *   build      — 构型：堆叠 / 留缺口
 *   pace       — 节奏：放慢 / 加速 / 节奏呼吸
 *   explore    — 探索：新手引导 / 新鲜感
 *   combo      — 连击链：combo 催化 / 里程碑
 *   lifecycle  — 生命周期：S/M 标签驱动的长期策略
 *
 * Layer 同步：
 *   insight.spawnHints.rhythmPhase   → 节奏建议
 *   insight.spawnHints.comboChain    → combo 链建议
 *   insight.spawnHints.sessionArc    → session 弧线建议
 *   insight.spawnDiagnostics         → 盘面拓扑建议
 *   S/M 标签（lifecyclePlaybook）     → 长期策略建议
 */

import { getLifecycleMaturitySnapshot } from './retention/playerLifecycleDashboard.js';

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
 * @param {object} [gridInfo] { fillRatio, maxHeight, holesCount,
 *   liveTopology?, liveMultiClearCandidates?, liveSolutionMetrics? }
 *   v1.20：`liveTopology` 与 `liveMultiClearCandidates` 由 panel 注入，
 *   表示"当前盘面"几何，**优先**于 `insight.spawnDiagnostics.layer1`（spawn 时
 *   快照）。否则在玩家放过 1~3 块后会出现「策略卡说有 4 多消、面板说 0」的撞墙。
 *   `liveSolutionMetrics`：{ solutionCount, firstMoveFreedom } 可落子数之和与瓶颈最少落子位（与 insight 同源）。
 * @returns {StrategyTip[]} 按 priority 降序排列的策略建议（最多 3 条）
 */

/**
 * v1.29：若 top3 全是 survival，尝试用后续条目中「足够优先」的非 survival 替换三者最弱一条，
 * 避免长期只看到保命卡（不替换 ≥0.94 的救急档）。
 * @param {StrategyTip[]} sortedDesc priority 已降序
 * @param {number} max
 */
function applyTipCategoryDiversity(sortedDesc, max = 3) {
    if (sortedDesc.length <= max) return sortedDesc.slice(0, max);
    const top = sortedDesc.slice(0, max);
    if (!top.every((t) => t.category === 'survival')) return top;
    const minPri = Math.min(...top.map((t) => t.priority));
    if (minPri >= 0.94) return top;
    const alt = sortedDesc.slice(max).reduce((best, t) => {
        if (t.category === 'survival') return best;
        if (!best || t.priority > best.priority) return t;
        return best;
    }, null);
    if (!alt) return top;
    const threshold = Math.max(0.58, minPri - 0.15);
    if (alt.priority < threshold) return top;
    const minIdx = top.reduce((mi, t, i) => (t.priority < top[mi].priority ? i : mi), 0);
    const out = [...top];
    out[minIdx] = alt;
    out.sort((a, b) => b.priority - a.priority);
    return out.slice(0, max);
}

export function generateStrategyTips(profile, insight, gridInfo) {
    /** @type {StrategyTip[]} */
    const tips = [];

    const flow = profile.flowState;
    const skill = profile.skillLevel;
    const m = profile.metrics;
    const mom = profile.momentum;
    const fr = profile.frustrationLevel;
    const session = profile.sessionPhase;
    const fill = gridInfo?.fillRatio ?? insight?.boardFill ?? 0;
    const holes = gridInfo?.holesCount ?? 0;

    const hints = insight?.spawnHints || {};
    const diag = insight?.spawnDiagnostics;
    /* v1.20：live 优先（spawn 快照只作回退）—— 解决 "卡说 4 多消、面板 0" 撞墙。
     * 这里只声明覆盖项；下方多消机会卡 / 瓶颈块卡按需读取 _liveNearFull /
     * _liveMultiClearCands 而不再直接走 diag.layer1。 */
    const _liveTopo = gridInfo?.liveTopology;
    const _liveNearFull = Number.isFinite(_liveTopo?.nearFullLines)
        ? _liveTopo.nearFullLines
        : (diag?.layer1?.nearFullLines ?? 0);
    const _liveMultiClearCands = Number.isFinite(gridInfo?.liveMultiClearCandidates)
        ? gridInfo.liveMultiClearCandidates
        : (diag?.layer1?.multiClearCandidates ?? 0);

    /* ── 0. S/M 标签与生命周期策略 ──
     * v1.32：基于 PLAYER_LIFECYCLE_MATURITY_BLUEPRINT，把 S（生命周期阶段）× M（成熟度）
     * 标签融入策略解释，让玩家理解当前出块背后的长期运营意图。
     *
     * 策略映射表：
     *   S0·M0：新手保护期 → 友好出块 + 快速成功体验
     *   S1·M0：探索期新手 → 瓶颈引导 + 安全网
     *   S1·M1：探索期成长 → 轻度挑战 + 任务密度
     *   S1·M2：探索期熟练 → 周循环种子
     *   S2·M0：成长期新手 → 友好出块 + 首购预热
     *   S2·M1：成长期成长 → 周挑战主推 + 首购礼包
     *   S2·M2：成长期熟练 → 限时挑战 + 层级礼包
     *   S2·M3：成长期资深 → 段位冲刺 + 排行榜推送
     *   S3·M1：稳定期成长 → 里程碑晋升
     *   S3·M2：稳定期熟练 → 赛季目标 + 层级升级
     *   S3·M3：稳定期资深 → 排行榜推送 + 社区邀请
     *   S3·M4：稳定期核心 → VIP 特权
     *   S4·M0：回流期新手 → 保护局 + 高价值小奖励
     *   S4·M1：回流期成长 → 保护局 + 首购召回
     *   S4·M2：回流期熟练 → 回流挑战 + 召回礼包
     *   S4·M3：回流期资深 → 回流挑战 + 赛季重置
     *   S4·M4：回流期核心 → VIP 召回包
     */
    let lifecycleTip = null;
    try {
        const snap = getLifecycleMaturitySnapshot({
            daysSinceInstall: profile?._daysSinceInstall ?? 0,
            totalSessions: profile?._totalSessions ?? profile?.lifetimeGames ?? 0,
            daysSinceLastActive: profile?._daysSinceLastActive ?? 0,
        });
        const stage = snap?.stageCode ?? 'S0';
        const band = snap?.band ?? 'M0';
        const key = `${stage}·${band}`;

        const lifecycleStrategyMap = {
            'S0·M0': { icon: '🌱', title: '新手保护', detail: '出块已优化为友好模式，快速建立消行节奏，体验成就感。', priority: 0.92 },
            'S1·M0': { icon: '🎯', title: '瓶颈引导', detail: '遇到困难时系统会减压；先熟悉基础操作和消行规律。', priority: 0.85 },
            'S1·M1': { icon: '⚡', title: '适度挑战', detail: '出块难度逐渐提升，尝试构建多行同消获得更高分。', priority: 0.80 },
            'S1·M2': { icon: '🏆', title: '周循环', detail: '解锁周挑战资格，出块开始引入更有节奏感的压力波动。', priority: 0.75 },
            'S2·M0': { icon: '🌱', title: '友好过渡', detail: '出块偏友好，帮助建立信心，逐步适应游戏节奏。', priority: 0.85 },
            'S2·M1': { icon: '📋', title: '任务驱动', detail: '每日任务已激活，完成目标可获得额外奖励，关注任务进度。', priority: 0.78 },
            'S2·M2': { icon: '⏱️', title: '限时挑战', detail: '系统推送限时挑战，完成可加速成长；尝试连续消行获得高分。', priority: 0.72 },
            'S2·M3': { icon: '📈', title: '冲刺段位', detail: '接近段位提升阈值，出块挑战加大，专注构型争取连消。', priority: 0.68 },
            'S3·M1': { icon: '🎖️', title: '里程碑', detail: '接近成熟度晋升，达成目标解锁新功能和特权。', priority: 0.70 },
            'S3·M2': { icon: '🎯', title: '赛季目标', detail: '赛季目标进行中，完成可获得限定奖励，关注排行榜位置。', priority: 0.65 },
            'S3·M3': { icon: '👑', title: '排行榜冲刺', detail: '当前处于高段位竞争，出块难度达峰值；专注长期规划。', priority: 0.60 },
            'S3·M4': { icon: '💎', title: 'VIP 特权', detail: '核心玩家特权激活，享专属内容和加速通道；感谢支持！', priority: 0.55 },
            'S4·M0': { icon: '🛡️', title: '回归保护', detail: '久别回归，系统提供保护局和友好出块，慢慢找回手感。', priority: 0.90 },
            'S4·M1': { icon: '🎁', title: '召回礼包', detail: '首购优惠进行中，完成任务可获得超值道具。', priority: 0.82 },
            'S4·M2': { icon: '🔥', title: '回流挑战', detail: '回归挑战已激活，短时间内达成目标可获额外奖励。', priority: 0.75 },
            'S4·M3': { icon: '🔄', title: '赛季重置', detail: '新赛季开始，重置排行榜位置；抓住机会冲击新高。', priority: 0.70 },
            'S4·M4': { icon: '👑', title: 'VIP 召回', detail: '核心玩家回归礼包待领取，专属特权已备好，欢迎回来！', priority: 0.65 },
        };

        const mapped = lifecycleStrategyMap[key];
        if (mapped) {
            lifecycleTip = {
                icon: mapped.icon,
                title: mapped.title,
                detail: mapped.detail,
                priority: mapped.priority,
                category: 'lifecycle',
                stage,
                band,
            };
        }
    } catch { /* lifecycle 数据缺失不应阻塞策略建议 */ }

    /* ── 1. 生存优先 (Layer 1) ── */
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

    /* ── 2. 空洞管理 (Layer 1: 拓扑感知) ── */
    if (holes > 3) {
        tips.push({
            icon: '🕳️', title: '填补空洞',
            detail: `当前 ${holes} 个空洞，优先将块放入凹陷处而非平铺顶部。`,
            priority: 0.72, category: 'build'
        });
    }

    /* ── 2b. 多消潜力提示 (Layer 1) ──
     * v1.18：按"是否真的存在多消候选"分两种文案，避免在 nearFullLines=3
     * 但 multiClearCands<2 的盘面上仍鼓动玩家"同时完成多行 / 争取大分"
     * （物理上做不到）。
     * v1.20：`nearFullLines` / `multiClearCandidates` 改读 live，避免
     * spawn 后玩家已经清掉 1~2 行 / 已经放掉多消候选块、但本卡仍按 spawn 时
     * 快照报"4 个多消放置"的撞墙（与 panel 「多消候选 0」pill 对不上）。
     * 回退仍然是 diag.layer1（live 不可用时由 _liveNearFull/_liveMultiClearCands 兜底）。
     */
    if (_liveNearFull >= 3 && tips.length < 3) {
        if (_liveMultiClearCands >= 2) {
            tips.push({
                icon: '🎯', title: '多消机会',
                detail: `有 ${_liveNearFull} 条接近满行 + ${_liveMultiClearCands} 个多消放置，选择能同时完成多行的位置，争取大分。`,
                priority: 0.78, category: 'clear'
            });
        } else {
            tips.push({
                icon: '✂️', title: '逐条清理',
                detail: `有 ${_liveNearFull} 条接近满行，但暂无多消组合——先把最容易消的那条清掉，缓解压力再说。`,
                priority: 0.7, category: 'clear'
            });
        }
    }

    /* ── 2c. 瓶颈块预警：最少合法落子位过少（展示口径：各未放置候选可落位之和 + 瓶颈最少值）── */
    const sm = gridInfo?.liveSolutionMetrics ?? diag?.layer1?.solutionMetrics;
    const minPl = Number.isFinite(sm?.firstMoveFreedom) ? sm.firstMoveFreedom : null;
    const sumPl = Number.isFinite(sm?.solutionCount) ? sm.solutionCount : null;
    if (minPl != null
        && minPl <= 2
        && fill >= 0.4
        && tips.length < 3) {
        const sumHint = sumPl != null ? `合计可落位 ${sumPl}，` : '';
        tips.push({
            icon: '⏳', title: '瓶颈块',
            detail: `候选块中最少合法落位仅 ${minPl}；${sumHint}先下可放位最少的那块。`,
            priority: 0.86, category: 'survival'
        });
    }

    /* ── 3. 连击策略 (Layer 2: combo 链) ── */
    if (hints.comboChain > 0.5 || profile.recentComboStreak >= 2) {
        tips.push({
            icon: '🔥', title: '延续连击',
            detail: `${profile.recentComboStreak >= 2 ? `已连续 ${profile.recentComboStreak} 次消除！` : 'Combo 链活跃！'}出块已催化消行块，抓住机会延续连击。`,
            priority: 0.82, category: 'combo'
        });
    } else if (profile.hadRecentNearMiss) {
        tips.push({
            icon: '⚡', title: '差一步消行',
            detail: '上一步非常接近消行，这轮出块更友好，抓住机会填满缺口。',
            priority: 0.75, category: 'clear'
        });
    }

    /* ── 4. 节奏呼吸 (Layer 2: rhythmPhase) ──
     * v1.23：「收获期」卡加 live 几何 mutex —— rhythmPhase 是 spawn 时锁定的快照，
     * spawn 后玩家落了块（消了 / 没消），live 几何已经变化（multiClearCands→0、
     * nearFullLines→0），此时仍说「积极消除拿分」是空头建议。截图复现：spawn 决策
     * 多消 0.95 + 多线×2 + 目标保消 3，但 live 多消候选 0、近满 0，dock 是 4 块
     * volleyball L 形，根本无从兑现。v1.20 已经给「多消机会/逐条清理/瓶颈块」3 张卡
     * 加了 live 几何 mutex，这里补上「收获期」卡。
     * 当 live 几何不再支持兑现时，文案降级为「收获期·待兑现」，告诉玩家：
     * spawn 时锁定了收获节奏，但当前 dock 与盘面没对上，先稳住手等下次 spawn。 */
    if (hints.rhythmPhase === 'payoff' && tips.length < 3 && !tips.find(t => t.category === 'combo')) {
        const _liveCanHarvest = _liveMultiClearCands >= 1 || _liveNearFull >= 2;
        tips.push({
            icon: '💎',
            title: _liveCanHarvest ? '收获期' : '收获期·待兑现',
            detail: _liveCanHarvest
                ? '当前处于节奏"收获"阶段，出块偏向消行友好，积极消除拿分。'
                : '上一次 spawn 锁定了"收获"节奏，但当前 dock 与盘面暂时没对上消行机会，先稳住手等下次 spawn 兑现。',
            priority: 0.6, category: 'pace'
        });
    } else if (hints.rhythmPhase === 'setup' && tips.length < 3 && fill < 0.5) {
        tips.push({
            icon: '🏗️', title: '搭建期',
            detail: '当前处于节奏"搭建"阶段，稳定堆叠、预留消行通道，为下一波爆发做准备。',
            priority: 0.45, category: 'build'
        });
    }

    /* ── 5. 挫败缓解 ── */
    if (fr >= 4) {
        tips.push({
            icon: '💪', title: '别急，稳住',
            detail: `连续 ${fr} 步未消行，系统已降低难度。先找最容易消的行，一步步恢复节奏。`,
            priority: 0.82, category: 'pace'
        });
    }

    /* ── 6. 心流方向 ──
     * v1.17：与「收获期」卡互斥。当 rhythmPhase==='payoff' 时已建议玩家"积极消除"，
     * 此时再叠"提升挑战 → 多行同消（3行+）"会让玩家在同一面板看到两条互相拉扯的目标
     *（一个让 TA 现在兑现、一个让 TA 蓄力搭建）。同理盘面太稀（fill < 0.18，
     * 多线候选物理上接近 0）时也不再推 3 行+ 的目标，避免空头建议。
     */
    const harvestNow = hints.rhythmPhase === 'payoff'
        || hints.spawnIntent === 'harvest';
    if (flow === 'bored' && tips.length < 3 && !harvestNow && fill >= 0.18) {
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

    /* ── 7. 认知负荷 ── */
    if (m.thinkMs > 8000 && profile.cognitiveLoad > 0.6 && tips.length < 3) {
        tips.push({
            icon: '🧩', title: '简化决策',
            detail: '思考时间较长，建议先放最明确的块，减少同时权衡的选项数。',
            priority: 0.55, category: 'pace'
        });
    }

    /* ── 8. 动量下降 ── */
    if (mom < -0.4 && tips.length < 3) {
        tips.push({
            icon: '🧭', title: '调整策略',
            detail: '近期消行率下降，考虑改变堆叠策略——留出一列做长条消行通道。',
            priority: 0.6, category: 'build'
        });
    }

    /* ── 9. Layer 3: session 弧线 ── */
    if (hints.sessionArc === 'warmup' && tips.length < 3) {
        tips.push({
            icon: '🌅', title: '热身阶段',
            detail: '本局刚开始，出块已优化为友好模式，先找感觉、建立节奏。',
            priority: 0.4, category: 'explore'
        });
    } else if (hints.sessionArc === 'cooldown' && tips.length < 3) {
        tips.push({
            icon: '🌙', title: '收官阶段',
            detail: '游戏进入后期，出块已适当放缓，集中精力争取最后得分。',
            priority: 0.4, category: 'pace'
        });
    }

    /* ── 10. Layer 3: 里程碑庆祝 ── */
    if (hints.scoreMilestone && tips.length < 3) {
        tips.push({
            icon: '🎉', title: '里程碑达成',
            detail: '恭喜达到新分数里程碑！这轮出块特别友好，享受消除的快感吧。',
            priority: 0.85, category: 'combo'
        });
    }

    /* ── 11. 构型建议 ──
     * v1.22：与「收获期」/ harvest 意图互斥（沿用 6 节 harvestNow 概念）。
     * 旧版只看 fill<0.3 && skill>0.5 → 在 rhythmPhase='payoff' 同帧出现时
     *   • 💎 收获期：「积极消除享分」（要求当下兑现）
     *   • 🏗️ 规划堆叠：「留出 1~2 列通道为后续做准备」（要求蓄力搭建）
     * 两条卡叙事方向相反、玩家被拉扯。harvestNow 时跳过此卡，只在「搭建/中性」
     * 阶段给"留通道"的长期建议；fill<0.3 时盘面充裕本就允许下一轮再出。 */
    if (fill < 0.3 && skill > 0.5 && !harvestNow && tips.length < 3) {
        tips.push({
            icon: '🏗️', title: '规划堆叠',
            detail: '棋盘空间充裕，可以有意留出 1~2 列通道，为后续长条消行和 combo 做准备。',
            priority: 0.4, category: 'build'
        });
    }

    /* ── 12. 新手引导 ── */
    if (profile.isInOnboarding) {
        tips.length = 0;
        tips.push({
            icon: '👋', title: '欢迎新手',
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

    /* ── 13. 会话疲劳 ── */
    if (session === 'late' && mom < -0.2 && tips.length < 3) {
        tips.push({
            icon: '☕', title: '注意休息',
            detail: '游戏时间较长且状态有所下滑，适当休息能恢复专注力。',
            priority: 0.35, category: 'pace'
        });
    }

    /* ── 14. S/M 生命周期策略 ──
     * v1.32：基于 lifecyclePlaybook 的 S×M 矩阵，展示当前出块策略背后的长期运营意图。
     * 非新手玩家均可看到；优先级略低于生存/连击类建议，但高于构型/节奏类建议。
     */
    if (lifecycleTip && tips.length < 4) {
        tips.push(lifecycleTip);
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
    return applyTipCategoryDiversity(tips, 3);
}
