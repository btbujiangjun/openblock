/**
 * 商业化策略集中配置（L1 - 配置层）
 *
 * 设计目标：所有策略相关「数据」集中于此，业务模块（adTrigger / iapAdapter / personalization
 * / monPanel）通过 getStrategyConfig() 间接读取，避免硬编码。
 *
 * 定制化方式（自下而上 3 种）：
 *   1. 直接修改 DEFAULT_STRATEGY_CONFIG 字面量（项目内调优）
 *   2. 调用 setStrategyConfig({...})  进行深合并热更新（运营/A-B 测试）
 *   3. 调用 registerStrategyRule(rule) 追加单条规则（插件式扩展）
 *
 * 与服务端 mon_model_config 的关系：
 *   后端 PUT /api/mon/model/config 写入字段会被 personalization.js 拉回后通过
 *   setStrategyConfig() 注入此对象，实现「配置后台单源管理 + 前端实时生效」。
 *
 * 命名约定：
 *   - segments[]：用户分群定义（whale/dolphin/minnow…可扩展）
 *   - signals[]：实时信号字段（与 PlayerProfile 字段一一对应）
 *   - rules[]：决策规则（when 条件 → then 动作 + why/effect 文案）
 *   - products{}：IAP 产品目录（id → 名称 + 价格 + 类型）
 *   - frequency{}：广告频控（每日/每局上限 + 冷却时间）
 *   - copy{}：分群标签 / 优先级标签等通用文案
 */

// ── 工具：深合并（仅对纯对象递归合并；数组按 patch 整体替换以保留语义） ─────
function _isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function _deepMerge(base, patch) {
    if (!_isPlainObject(patch)) return patch;
    const out = { ...base };
    for (const [k, v] of Object.entries(patch)) {
        if (_isPlainObject(v) && _isPlainObject(base?.[k])) {
            out[k] = _deepMerge(base[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

// ── L1.1：默认配置 ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} StrategyRule
 * @property {string} id 规则唯一标识符（用于 strategy_log）
 * @property {string[]} [segments] 命中分群（缺省=全分群）
 * @property {(ctx: object) => boolean} [when] 自定义条件（ctx.realtime + ctx.persona）
 * @property {{ type: string, [key: string]: any }} action 触发动作（type=ads/iap/push/task）
 * @property {'high'|'medium'|'low'} [priority] 优先级
 * @property {string} [why] 命中原因（默认值，可被 whyResolver 覆盖）
 * @property {string} [effect] 预期效果
 * @property {(ctx: object) => { why?: string, effect?: string }} [explain] 动态文案
 */

export const DEFAULT_STRATEGY_CONFIG = {
    /** 配置 schema 版本，破坏式变更需递增 */
    version: 1,

    // ── 分群定义 ──────────────────────────────────────────────────────────────
    segments: [
        { id: 'whale',   label: 'Whale 高价值', icon: '🐋', color: '#f59e0b', minWhaleScore: 0.60 },
        { id: 'dolphin', label: 'Dolphin 中等', icon: '🐬', color: '#3b82f6', minWhaleScore: 0.30 },
        { id: 'minnow',  label: 'Minnow 轻度',  icon: '🐟', color: '#6b7280', minWhaleScore: 0.00 },
    ],

    /** 鲸鱼分加权（与后端 mon_model_config.segmentWeights 镜像） */
    segmentWeights: {
        best_score_norm:   0.40,
        total_games_norm:  0.30,
        session_time_norm: 0.30,
    },

    /** 各信号归一化分母（用于把原始指标拉到 [0,1]） */
    signalNorms: {
        bestScore:      2000,   // 最高分 ≥ 2000 视为满分
        totalGames:     50,     // 50 局视为满
        avgSessionSec:  600,    // 10 分钟视为满
        nearMissRate:   1.0,    // 已是 [0,1]
        recent7dGames:  7,      // 7 日 7 局视为活跃满
    },

    // ── 实时信号阈值 ──────────────────────────────────────────────────────────
    thresholds: {
        /** 连续未消行 → 救济广告/提示包 */
        frustrationRescue:    5,
        /** 连续未消行 → IAP 卡片高亮（提前 1 步引导） */
        frustrationIapHint:   4,
        /** 接近阈值预警 */
        frustrationWarning:   3,
        /** 活跃度低分阈值（< 触发推送唤回） */
        activityLow:          0.35,
        /** 活跃度高分阈值（≥ IAP 转化窗口良好） */
        activityHigh:         0.70,
        /** 历史近失率高分阈值（> 偏好激励视频） */
        nearMissRateHigh:     0.30,
    },

    // ── 广告频控（与 adTrigger.js 中 AD_CONFIG 镜像） ─────────────────────────
    frequency: {
        rewarded: {
            maxPerGame: 3,
            maxPerDay:  12,
            cooldownMs: 90_000,
        },
        interstitial: {
            maxPerDay:  6,
            cooldownMs: 180_000,
            minSessionsBeforeFirst: 3,
        },
        /** 广告体验分阈值：低于此值进入「休养期」抑制广告 */
        experienceRecoveryBelow: 60,
    },

    // ── IAP 产品目录（与 iapAdapter.js PRODUCTS 镜像，仅展示用） ──────────────
    products: {
        remove_ads:   { label: '移除广告',         price: '¥18',  type: 'one_time' },
        hint_pack_5:  { label: '提示包×5',        price: '¥6',   type: 'consumable' },
        weekly_pass:  { label: '周卡通行证',       price: '¥12',  type: 'subscription' },
        monthly_pass: { label: '月卡通行证',       price: '¥28',  type: 'subscription' },
        annual_pass:  { label: '年度通行证',       price: '¥88',  type: 'subscription' },
        starter_pack: { label: '🎁 新手礼包',     price: '¥3',   type: 'one_time' },
        weekly_pass_discount: { label: '⚡ 限时周卡', price: '¥8', type: 'limited_time' },
    },

    // ── 通用文案 ──────────────────────────────────────────────────────────────
    copy: {
        priority:   { high: '🔴高', medium: '🟡中', low: '⚪低' },
        actionType: {
            ads:  { icon: '📢', label: '广告策略' },
            iap:  { icon: '💳', label: 'IAP 推荐' },
            push: { icon: '🔔', label: '推送策略' },
            task: { icon: '✅', label: '任务激励' },
            skin: { icon: '🎨', label: '皮肤推荐' },
        },
        flow: {
            flow:    { label: '心流中', advice: '请勿打断广告' },
            bored:   { label: '略无聊', advice: '可触发商业策略' },
            anxious: { label: '略焦虑', advice: '激励广告/提示包接受度↑' },
        },
    },

    // ── 决策规则矩阵 ──────────────────────────────────────────────────────────
    /**
     * 规则按数组顺序评估；每条命中后产出一个 action 卡片。
     * 优先级（priority）影响渲染顺序与曝光决策；when=undefined 表示分群默认动作。
     */
    rules: [
        // ── Whale ────────────────────────────────────────────────────────────
        {
            id: 'whale_default_monthly',
            segments: ['whale'],
            action: { type: 'iap', product: 'monthly_pass' },
            priority: 'high',
            why:    'Whale 用户付费意愿强',
            effect: 'LTV 约为周卡 3.8×',
        },
        {
            id: 'whale_no_interstitial',
            segments: ['whale'],
            action: { type: 'ads', format: 'none' },
            priority: 'high',
            why:    'Whale 用户广告容忍度低，流失成本 > 广告收益',
            effect: '屏蔽插屏广告，保留 LTV',
        },
        {
            id: 'whale_hint_pack_on_frustration',
            segments: ['whale'],
            when: ({ realtime, config }) =>
                Number(realtime.frustration ?? 0) >= (config.thresholds?.frustrationRescue ?? 5),
            action: { type: 'iap', product: 'hint_pack_5' },
            priority: 'high',
            explain: ({ realtime }) => ({
                why:    `未消行 ${realtime.frustration} 次，提示需求明确`,
                effect: '降低即时流失率约 18%',
            }),
        },

        // ── Dolphin ──────────────────────────────────────────────────────────
        {
            id: 'dolphin_default_weekly',
            segments: ['dolphin'],
            action: { type: 'iap', product: 'weekly_pass' },
            priority: 'medium',
            why:    'Dolphin 用户对周期低价付费接受度高',
            effect: '首月留存 +22%，向月卡转化铺路',
        },
        {
            id: 'dolphin_rewarded_near_miss',
            segments: ['dolphin'],
            when: ({ realtime }) => Boolean(realtime.hadNearMiss),
            action: { type: 'ads', format: 'rewarded', trigger: 'near_miss' },
            priority: 'high',
            why:    '⚡ 近失：玩家主动性最强',
            effect: '近失节点转化率 +40%',
        },
        {
            id: 'dolphin_push_on_low_activity',
            segments: ['dolphin'],
            when: ({ persona, config }) =>
                persona.activityScore < (config.thresholds?.activityLow ?? 0.35),
            action: { type: 'push', trigger: 'streak_reminder' },
            priority: 'medium',
            why:    '近 7 日活跃度下降',
            effect: 'D7 留存 +15%',
        },

        // ── Minnow ───────────────────────────────────────────────────────────
        {
            id: 'minnow_interstitial_on_game_over',
            segments: ['minnow'],
            action: { type: 'ads', format: 'interstitial', trigger: 'game_over' },
            priority: 'medium',
            why:    '游戏结束是天然断点',
            effect: 'eCPM 最高，留存影响 <2%',
        },
        {
            id: 'minnow_starter_pack_on_frustration',
            segments: ['minnow'],
            when: ({ realtime, config }) =>
                Number(realtime.frustration ?? 0) >= (config.thresholds?.frustrationRescue ?? 5),
            action: { type: 'iap', product: 'starter_pack' },
            priority: 'high',
            explain: ({ realtime }) => ({
                why:    `未消行 ${realtime.frustration} 次，挫败临界是首购最佳窗口`,
                effect: '首次付费转化率 +35%',
            }),
        },
        {
            id: 'minnow_daily_tasks',
            segments: ['minnow'],
            action: { type: 'task', trigger: 'daily_quest' },
            priority: 'low',
            why:    '轻度用户需要短期目标锚定',
            effect: 'D1 留存 +28%，积累付费转化积分',
        },
    ],
};

// ── L1.2：运行时实例（浅复制 + rules 单独保留以兼容函数字段） ───────────────

function _cloneConfig(cfg) {
    return {
        ...cfg,
        segments:       cfg.segments?.map(s => ({ ...s })) ?? [],
        segmentWeights: { ...cfg.segmentWeights },
        signalNorms:    { ...cfg.signalNorms },
        thresholds:     { ...cfg.thresholds },
        frequency:      JSON.parse(JSON.stringify(cfg.frequency ?? {})),
        products:       JSON.parse(JSON.stringify(cfg.products ?? {})),
        copy:           JSON.parse(JSON.stringify(cfg.copy ?? {})),
        rules:          (cfg.rules ?? []).map(r => ({ ...r })),
    };
}

let _config = _cloneConfig(DEFAULT_STRATEGY_CONFIG);

// ── L1.3：公开 API ────────────────────────────────────────────────────────────

/** 获取当前策略配置（只读引用，请勿直接修改） */
export function getStrategyConfig() {
    return _config;
}

/**
 * 深合并 patch 到当前配置（顶层与已知子对象按字段合并；数组整体替换）。
 * 对于 rules 数组：传入 patch.rules 会**整体替换**；如需追加请用 registerStrategyRule。
 *
 * @param {Partial<typeof DEFAULT_STRATEGY_CONFIG>} patch
 * @returns {typeof DEFAULT_STRATEGY_CONFIG} 合并后的快照
 */
export function setStrategyConfig(patch) {
    if (!_isPlainObject(patch)) return _config;
    _config = {
        ..._config,
        ...patch,
        segmentWeights: _deepMerge(_config.segmentWeights, patch.segmentWeights),
        signalNorms:    _deepMerge(_config.signalNorms,    patch.signalNorms),
        thresholds:     _deepMerge(_config.thresholds,     patch.thresholds),
        frequency:      _deepMerge(_config.frequency,      patch.frequency),
        products:       _deepMerge(_config.products,       patch.products),
        copy:           _deepMerge(_config.copy,           patch.copy),
        // segments / rules 遵循「传则替换」语义
        segments: Array.isArray(patch.segments) ? patch.segments : _config.segments,
        rules:    Array.isArray(patch.rules)    ? patch.rules    : _config.rules,
    };
    return _config;
}

/** 重置为默认（测试 / 一键复位用） */
export function resetStrategyConfig() {
    _config = _cloneConfig(DEFAULT_STRATEGY_CONFIG);
    return _config;
}

/**
 * 追加一条规则（插件式扩展，不影响内置规则顺序）。
 * 同 id 规则会被整体替换。
 * @param {StrategyRule} rule
 */
export function registerStrategyRule(rule) {
    if (!rule || !rule.id || !rule.action) {
        throw new Error('[strategyConfig] rule must have id and action');
    }
    const idx = _config.rules.findIndex(r => r.id === rule.id);
    if (idx >= 0) _config.rules.splice(idx, 1, rule);
    else _config.rules.push(rule);
    return rule;
}

/** 删除一条规则 */
export function unregisterStrategyRule(id) {
    const idx = _config.rules.findIndex(r => r.id === id);
    if (idx >= 0) _config.rules.splice(idx, 1);
}

/** 查找分群定义 */
export function getSegmentDef(segmentId) {
    return _config.segments.find(s => s.id === segmentId)
        ?? _config.segments[_config.segments.length - 1];
}

/** 根据 whaleScore 推断分群（替代原来散落各处的硬编码阈值判断） */
export function classifySegment(whaleScore) {
    const score = Number(whaleScore ?? 0);
    // segments 列表按 minWhaleScore 降序匹配
    const sorted = [..._config.segments].sort(
        (a, b) => (b.minWhaleScore ?? 0) - (a.minWhaleScore ?? 0)
    );
    return sorted.find(s => score >= (s.minWhaleScore ?? 0))?.id
        ?? _config.segments[_config.segments.length - 1].id;
}
