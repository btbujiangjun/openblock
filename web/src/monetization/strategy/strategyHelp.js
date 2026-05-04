/**
 * 商业化策略 cursor:help 文案中心（L3 - 解释层）
 *
 * 集中管理所有面板字段的「鼠标悬停说明」文案，UI 渲染时通过 helpAttrs(key) 一次性
 * 注入 `class="mon-help"` + `title="…"` + `aria-describedby` 三件套。
 *
 * 设计理由：
 *   - 把「字段含义 / 计算公式 / 调参影响」从 UI 代码里抽离，便于本地化与运营修改
 *   - 单一来源也供文档生成（docs/MONETIZATION_CUSTOMIZATION.md 中的字段表）
 *   - 任何新增可定制项必须先在此处登记，强制让作者写明含义与影响
 */

import { getStrategyConfig } from './strategyConfig.js';

/**
 * 静态文案表（与运行时配置无关的解释）。
 * 字段命名约定：
 *   - signal.*       面板信号格
 *   - weight.*       分群权重滑块
 *   - threshold.*    阈值滑块
 *   - model.*        CommercialModelVector 字段
 *   - flag.*         Feature Flag 开关
 *   - product.*      IAP 产品卡
 *   - rule.*         策略规则卡
 *   - kpi.*          总览面板 KPI 卡
 *   - segment.*      分群徽标
 *
 * 文案行 1 = 简介；行 2+ = 计算公式 / 调参影响 / 阈值含义。
 */
export const HELP_TEXTS = {
    // ── 信号格（玩家画像面板 6 项） ───────────────────────────────────────────
    'signal.segment':
        '分群（whale/dolphin/minnow）— 据 whale_score 自动计算\n'
        + '阈值：≥0.6→Whale；0.3-0.6→Dolphin；<0.3→Minnow\n'
        + '调整在「模型配置」标签页 → 分群权重滑块',
    'signal.activity':
        '活跃度 — 近 7 日活跃评分（0~100%）\n'
        + '高 ≥70%：粘性强，IAP 转化窗口良好\n'
        + '中 35-70%：可推连签提醒，D7 +15%\n'
        + '低 <35%：触发唤回推送',
    'signal.skill':
        '技能等级 — 消行率 EMA（指数移动平均）\n'
        + '高手 ≥80% → 高难皮肤 / 挑战模式\n'
        + '中级 55-80% → 赛季通行证效果佳\n'
        + '新手 <55% → 每日任务 + 提示包',
    'signal.frustration':
        '挫败感 — 当前连续未消行次数\n'
        + '≥5：触发救济广告 / 提示包 IAP\n'
        + '3-4：接近阈值，准备介入\n'
        + '阈值可在「模型配置」中修改',
    'signal.nearMiss':
        '近失 — 填充率 >60% 但未消行 = 一次"近失"\n'
        + '⚡ 实时触发：当前局已检测到\n'
        + '历史近失率：用于判断是否偏好激励视频\n'
        + '近失节点展示激励广告，转化率 +40%',
    'signal.flow':
        '心流状态 — 据挑战与能力匹配度自动判定\n'
        + '心流中 → 抑制插屏广告（流失率峰值）\n'
        + '略无聊 → 可展示皮肤 / 新内容预告\n'
        + '略焦虑 → 激励广告 / 提示包转化率↑',

    // ── 权重滑块（模型配置） ──────────────────────────────────────────────────
    'weight.best_score_norm':
        '最高分权重（w0）— whale_score = w0×bestScoreNorm + w1×totalGamesNorm + w2×sessionTimeNorm\n'
        + '提高 w0 会让「高分玩家」更易被划入 Whale，从而推送 IAP\n'
        + '默认 0.40，建议三权重总和 ≤ 1.0',
    'weight.total_games_norm':
        '总局数权重（w1）— 反映用户「玩多少」\n'
        + '提高 w1 会让「重度玩家」更易升 Whale\n'
        + '默认 0.30，建议三权重总和 ≤ 1.0',
    'weight.session_time_norm':
        '时长权重（w2）— 反映用户「单局时长」\n'
        + '提高 w2 会让「沉浸型玩家」更易升 Whale\n'
        + '默认 0.30，建议三权重总和 ≤ 1.0',

    // ── 阈值滑块 ──────────────────────────────────────────────────────────────
    'threshold.frustrationRescue':
        '挫败感救济阈值（次）— 连续未消行达到此值时触发救济广告 / 提示包\n'
        + '调小：更早介入但易打断；调大：留更多空间给玩家自救\n'
        + '默认 5 次',
    'threshold.maxRewardedPerGame':
        '每局激励视频上限（次）— 单局内最多展示几次激励广告\n'
        + '叠加日上限 12 次和 90 秒冷却共同作用\n'
        + '默认 3 次',
    'threshold.showStarterPackHours':
        '新手礼包时效（小时）— 仅前 N 小时内展示新手礼包\n'
        + '调短：营造稀缺感提升转化；调长：覆盖更多用户\n'
        + '默认 24 小时',
    'threshold.showWeeklyPassAfterGames':
        '周卡触发局数（局）— 累计完成 N 局后开始展示周卡\n'
        + '默认 5 局，避免新手期就推付费',

    // ── 商业化模型字段 ───────────────────────────────────────────────────────
    'model.payerScore':
        '付费潜力分 — 融合 whale_score、LTV、活跃、技能和分群奖励\n'
        + '用于 IAP 优先级与付费用户插屏保护；权重在 commercialModel.payerScoreWeights 配置',
    'model.iapPropensity':
        'IAP 倾向 — 当前上下文展示内购 offer 的适合度\n'
        + '受付费潜力、挫败、心流、LTV 置信和广告疲劳共同影响',
    'model.rewardedAdPropensity':
        '激励广告倾向 — 当前展示 rewarded ad 的适合度\n'
        + '近失、挫败和低疲劳会抬高；高疲劳进入护栏抑制',
    'model.interstitialPropensity':
        '插屏广告倾向 — 仅用于自然断点，且必须通过心流/付费/流失/疲劳护栏\n'
        + '心流中默认抑制，避免打断体验',
    'model.churnRisk':
        '流失风险 — 低活跃、焦虑、连续挫败和广告疲劳会抬高\n'
        + '高风险时策略转向救援、任务或轻提示',
    'model.adFatigueRisk':
        '广告疲劳风险 — 由体验分、日激励次数和日插屏次数归一化得到\n'
        + '高于护栏阈值会降频或全部抑制广告',
    'model.guardrail':
        '模型护栏 — protectPayer / suppressInterstitial / suppressRewarded / suppressAll\n'
        + '这是广告触发前的最后一层体验保护，不替代硬频控',

    // ── Feature Flags（功能开关） ─────────────────────────────────────────────
    'flag.adsRewarded':       '激励视频广告 — 关闭后所有 rewarded 触发器静默',
    'flag.adsInterstitial':   '插屏广告 — 仅游戏结束时展示，受日上限/冷却约束',
    'flag.iap':               'IAP 内购 — 关闭后所有付费弹窗静默',
    'flag.dailyTasks':        '每日任务 — UTC 00:00 刷新 3 个任务',
    'flag.leaderboard':       '在线排行榜 — 每日榜，本地去重防刷',
    'flag.skinUnlock':        '皮肤等级解锁 — 据进度/IAP 决定可用皮肤',
    'flag.seasonPass':        '赛季通行证 — 30 天周期，免费 / 付费双轨',
    'flag.pushNotifications': 'Web Push 通知 — 需用户手动授权',
    'flag.replayShare':       '回放分享按钮 — 游戏结束后注入',
    'flag.stubMode':          '存根模式 — 广告/IAP 用模拟弹窗代替真实 SDK（开发用）',

    // ── 总览 KPI 卡 ───────────────────────────────────────────────────────────
    'kpi.total_users':         '注册用户数 — user_stats 表全量计数',
    'kpi.dau_7d':              '7 日 DAU — 近 7 天有 session 的去重用户数',
    'kpi.games_7d':            '7 日完成局数 — sessions 表 completed=1 计数',
    'kpi.avg_score_30d':       '30 日均分 — 用于横向对比赛季难度',
    'kpi.avg_session_30d':     '30 日均时长（分钟）— 评估「黏性」核心指标',
    'kpi.lb_participants':     '今日榜参与人数 — mon_daily_scores 去重 user_id',

    // ── 分群分布 ──────────────────────────────────────────────────────────────
    'segment.whale':   'Whale（高价值）— whale_score ≥ 0.6\n主推 IAP / 月卡，屏蔽插屏',
    'segment.dolphin': 'Dolphin（中等）— 0.3 ≤ score < 0.6\n激励广告 + 周卡，连签推送',
    'segment.minnow':  'Minnow（轻度）— score < 0.3\n插屏广告 + 新手礼包，每日任务',

    // ── 策略卡 ────────────────────────────────────────────────────────────────
    'rule.title':
        '策略卡片 — 由分群 × 实时信号查矩阵得出\n'
        + '⚡ 触发中：当前实时信号命中规则\n'
        + '优先级影响曝光顺序（高 > 中 > 低）',

    // ── 模型训练面板入口 ──────────────────────────────────────────────────────
    'panel.entry':
        '商业化模型训练面板 — 实时调整分群权重 / 阈值 / 功能开关\n'
        + '点击展开 4 个标签页：总览、用户画像、模型配置、功能开关\n'
        + '配置改动 PUT 到后端 mon_model_config，1 小时内全用户生效',
};

/**
 * 获取一个 key 的帮助文案。
 * @param {string} key       例如 'signal.frustration'
 * @param {string} [fallback] 找不到时的兜底
 */
export function getHelpText(key, fallback = '') {
    return HELP_TEXTS[key] ?? fallback;
}

/**
 * 返回可直接拼接到 HTML 标签上的 attribute 字符串。
 *
 * @example
 *   `<div ${helpAttrs('signal.frustration')}>挫败感</div>`
 *   ↓
 *   `<div class="mon-help" title="挫败感 — ..." data-help-key="signal.frustration">`
 */
export function helpAttrs(key, extraClass = '') {
    const text = getHelpText(key);
    if (!text) return '';
    const cls = ['mon-help', extraClass].filter(Boolean).join(' ');
    const safeTitle = String(text).replace(/"/g, '&quot;');
    return `class="${cls}" title="${safeTitle}" data-help-key="${key}"`;
}

/**
 * 把一个 DOM 节点标记为 cursor:help（用于 JS 创建的元素）。
 */
export function markHelp(el, key) {
    if (!el) return el;
    const text = getHelpText(key);
    if (!text) return el;
    el.classList.add('mon-help');
    el.title = text;
    el.dataset.helpKey = key;
    return el;
}

/**
 * 注册一个新 key（供插件扩展）。
 */
export function registerHelp(key, text) {
    HELP_TEXTS[key] = text;
}

/**
 * 列出所有已登记的 key（供文档生成 / 调试）。
 */
export function listHelpKeys() {
    return Object.keys(HELP_TEXTS).sort();
}

/**
 * 把当前 strategyConfig 与 HELP_TEXTS 合并，生成一份「字段-默认值-说明」表。
 * 用于 docs/MONETIZATION_CUSTOMIZATION.md 自动生成或调试输出。
 */
export function dumpConfigSchema() {
    const cfg = getStrategyConfig();
    const rows = [];

    for (const [k, v] of Object.entries(cfg.segmentWeights ?? {})) {
        rows.push({ key: `weight.${k}`, value: v, help: HELP_TEXTS[`weight.${k}`] ?? '' });
    }
    for (const [k, v] of Object.entries(cfg.thresholds ?? {})) {
        rows.push({ key: `threshold.${k}`, value: v, help: HELP_TEXTS[`threshold.${k}`] ?? '' });
    }
    for (const key of [
        'payerScore',
        'iapPropensity',
        'rewardedAdPropensity',
        'interstitialPropensity',
        'churnRisk',
        'adFatigueRisk',
        'guardrail',
    ]) {
        rows.push({ key: `model.${key}`, value: cfg.commercialModel?.version ?? '', help: HELP_TEXTS[`model.${key}`] ?? '' });
    }
    for (const seg of cfg.segments ?? []) {
        rows.push({
            key: `segment.${seg.id}`,
            value: seg.minWhaleScore,
            help: HELP_TEXTS[`segment.${seg.id}`] ?? '',
        });
    }
    return rows;
}
