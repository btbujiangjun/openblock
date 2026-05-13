/**
 * 个性化商业化引擎（v2 重构）
 *
 * 重构要点（相对 v1）：
 *   - 分群判定 / 阈值 / 策略矩阵 / 文案 全部交给 strategy/ 子系统（L1 配置 + L2 引擎）
 *   - 本文件仅负责「数据汇聚」：缓存、网络拉取、实时信号转写、UI 视图组装
 *   - 业务模块（adTrigger / iapAdapter / commercialInsight）从此处获取 insight 视图
 *
 * 数据流：
 *   后端 /api/mon/user-profile  ──┐
 *                                ├─→ persona（持久画像）─┐
 *   PlayerProfile（实时） ──→ realtime（实时信号）─────┤
 *                                                     ▼
 *                                            strategyEngine.evaluate()
 *                                                     │
 *                                            getCommercialInsight()
 *                                                     │
 *                                            UI 渲染 / 业务触发
 *
 * 与 strategyConfig 的关系：
 *   - 后端 mon_model_config 的 segmentWeights/thresholds 字段在 fetchPersonaFromServer
 *     成功后通过 setStrategyConfig() 注入策略子系统，实现「后端单源管理」
 */

import { getApiBaseUrl } from '../config.js';
import {
    getStrategyConfig,
    setStrategyConfig,
    classifySegment,
    getSegmentDef,
    evaluate,
    buildWhyLines,
} from './strategy/index.js';

const CACHE_KEY = 'openblock_mon_persona_v1';
const CACHE_TTL_MS = 60 * 60 * 1000;

/** @type {PersonaState} */
let _state = _loadCache() ?? _defaultState();

/** @typedef {{ segment: string, whaleScore: number, activityScore: number, skillScore: number,
 *   frustrationAvg: number, nearMissRate: number, serverActions: object[]|null,
 *   serverExplain: string, realtimeSignals: object, lastFetchMs: number }} PersonaState */

function _defaultState() {
    return {
        segment: 'minnow',
        whaleScore: 0,
        activityScore: 0,
        skillScore: 0,
        frustrationAvg: 0,
        nearMissRate: 0,
        serverActions: null,
        serverExplain: '尚未获取个性化数据',
        realtimeSignals: {},
        lastFetchMs: 0,
    };
}

function _loadCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const obj = JSON.parse(raw);
        if (Date.now() - (obj.lastFetchMs || 0) > CACHE_TTL_MS) return null;
        return obj;
    } catch { return null; }
}

function _saveCache(state) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(state)); }
    catch { /* quota */ }
}

function _apiBase() {
    return getApiBaseUrl().replace(/\/+$/, '');
}

/**
 * 从后端拉取并更新个性化画像。
 * 同时把后端 mon_model_config 中可热更字段同步到本地策略配置。
 *
 * @param {string} userId
 * @param {boolean} [force] 忽略客户端缓存强制请求
 */
export async function fetchPersonaFromServer(userId, force = false) {
    if (!userId) return;
    if (!force && Date.now() - _state.lastFetchMs < CACHE_TTL_MS) return;
    try {
        const url = `${_apiBase()}/api/mon/user-profile/${encodeURIComponent(userId)}`;
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();

        // 1. 更新画像状态
        _state = {
            segment:        data.segment        ?? 'minnow',
            whaleScore:     data.whale_score     ?? 0,
            activityScore:  data.activity_score  ?? 0,
            skillScore:     data.skill_score     ?? 0,
            frustrationAvg: data.frustration_avg ?? 0,
            nearMissRate:   data.near_miss_rate  ?? 0,
            serverActions:  data.strategy?.actions ?? null,
            serverExplain:  data.strategy?.explain ?? '',
            realtimeSignals: _state.realtimeSignals,
            lastFetchMs:    Date.now(),
        };

        // 2. 后端如果同步下发了 model 配置（A/B 实验），写入策略子系统
        if (data.model_config && typeof data.model_config === 'object') {
            try { setStrategyConfig(data.model_config); }
            catch (err) { console.warn('[personalization] setStrategyConfig from server failed:', err); }
        }

        _saveCache(_state);
    } catch { /* 网络不可用时沿用缓存 */ }
}

/**
 * 用 PlayerProfile 实时信号更新 realtimeSignals（每次出块后调用）。
 *
 * v1.16 起接收 `extras.spawnIntent`：让商业化策略文案与出块意图同源（避免出现
 * 出块给的是 4 个单格 relief 块、而文案仍说"悄悄加点料维持新鲜感"的认知冲突）。
 *
 * @param {import('../playerProfile.js').PlayerProfile} profile
 * @param {{ spawnIntent?: string|null }} [extras]
 */
export function updateRealtimeSignals(profile, extras = {}) {
    if (!profile) return;
    _state.realtimeSignals = {
        frustration:   profile.frustrationLevel,
        skill:         profile.skillLevel,
        flowState:     profile.flowState,
        hadNearMiss:   profile.hadRecentNearMiss,
        sessionPhase:  profile.sessionPhase,
        momentum:      profile.momentum,
        playstyle:     profile.playstyle,
        segment5:      profile.segment5,
        confidence:    profile.confidence,
        skillLabel:    _skillLabel(profile.skillLevel),
        spawnIntent:   extras.spawnIntent ?? _state.realtimeSignals?.spawnIntent ?? null,
    };
}

/** 技能等级文字标签 */
function _skillLabel(v) {
    if (v >= 0.8) return '高手';
    if (v >= 0.55) return '中级';
    if (v >= 0.3) return '新手';
    return '入门';
}

/** 把内部状态拼装成 evaluate() 入参 */
function _buildEvalContext() {
    return {
        persona: {
            segment:        _state.segment,
            whaleScore:     _state.whaleScore,
            activityScore:  _state.activityScore,
            skillScore:     _state.skillScore,
            frustrationAvg: _state.frustrationAvg,
            nearMissRate:   _state.nearMissRate,
        },
        realtime: { ..._state.realtimeSignals },
        config:   getStrategyConfig(),
    };
}

/** 返回商业化模型化层的纯数据输入，不触发网络请求。 */
export function getCommercialModelContext() {
    const ctx = _buildEvalContext();
    return {
        persona: { ...ctx.persona },
        realtime: { ...ctx.realtime },
        config: ctx.config,
    };
}

/* v1.49.x P1-4：按"操作风格"维度补一层 abilitySegment，与既有 5 段商业分群正交。
 *
 *   - prudent     谨慎型：boardPlanning 高、riskLevel 低、missRate 低、反应中等
 *                 → 适合"高客单 / 长线"商品（年卡 / 月卡）
 *   - speed       速度型：反应极快（pickToPlaceMs 低）、思考短、控制中等
 *                 → 适合"快节奏激励"（连胜任务、快闪礼包）
 *   - strategic   策略型：boardPlanning 极高、confidence 高、thinkMs 长
 *                 → 适合"成就向"内容（赛季通行证、精英排行榜）
 *   - impulsive   冲动型：boardPlanning 低、missRate 高、reaction 短但控制差
 *                 → 适合"小额冲动消费"（道具补给 / 提示包）
 *   - balanced    其他：默认兜底；不主动推荐特定商品。
 *
 * 输入是已经计算好的 abilityVector + metrics 快照，函数纯计算无副作用。
 */
export function getAbilitySegment(ability, metrics = {}) {
    if (!ability || typeof ability !== 'object') return 'balanced';
    const planning = Number(ability.boardPlanning ?? 0);
    const control = Number(ability.controlScore ?? 0);
    const confidence = Number(ability.confidence ?? 0);
    const risk = Number(ability.riskLevel ?? 0);
    const skill = Number(ability.skillScore ?? 0);
    const reactionMs = Number(metrics.pickToPlaceMs ?? 0);
    const thinkMs = Number(metrics.thinkMs ?? 0);
    const miss = Number(metrics.missRate ?? 0);
    const samples = Number(metrics.samples ?? 0);

    /* 样本量不足时不打 segment（balanced 兜底）—— 避免冷启动期错配。 */
    if (samples < 8) return 'balanced';

    if (planning >= 0.65 && confidence >= 0.6 && thinkMs >= 2200) return 'strategic';
    if (planning >= 0.55 && risk <= 0.4 && miss <= 0.1) return 'prudent';
    if (reactionMs > 0 && reactionMs <= 900 && control >= 0.55) return 'speed';
    if ((planning <= 0.35 && miss >= 0.18) || (control <= 0.35 && reactionMs > 0 && reactionMs <= 1200)) {
        return 'impulsive';
    }
    /* 兜底：高技能 -> strategic，低技能 -> impulsive，否则 balanced。 */
    if (skill >= 0.7) return 'strategic';
    if (skill <= 0.3) return 'impulsive';
    return 'balanced';
}

const ABILITY_SEGMENT_LABEL = {
    prudent:   { icon: '🧮', label: '谨慎型', color: '#34d399' },
    speed:     { icon: '⚡', label: '速度型', color: '#facc15' },
    strategic: { icon: '🏆', label: '策略型', color: '#a78bfa' },
    impulsive: { icon: '🎲', label: '冲动型', color: '#fb7185' },
    balanced:  { icon: '⚖️', label: '均衡型', color: '#94a3b8' },
};

export function getAbilitySegmentMeta(segmentKey) {
    return ABILITY_SEGMENT_LABEL[segmentKey] || ABILITY_SEGMENT_LABEL.balanced;
}

/**
 * 返回当前个性化洞察（供面板渲染）。
 * 结构契约（保持向后兼容）：
 *   {
 *     segment, segmentLabel, segmentColor, segmentIcon,
 *     signals[]:  { key, label, value, sub, color, tooltip },
 *     actions[]:  { icon, label, product, priority, active, why, effect, format, trigger },
 *     explain:    string,
 *     whyLines[]: string[]
 *   }
 */
export function getCommercialInsight() {
    const config = getStrategyConfig();
    const evalCtx = _buildEvalContext();
    const meta = getSegmentDef(_state.segment);

    // 1. 信号格 — 6 项（与原版 key/value 完全对应，文案改读 strategyConfig.thresholds）
    const signals = _buildSignalCards(evalCtx, meta, config);

    // 2. 策略动作卡片
    const evaluated = _state.serverActions?.length
        ? _renderServerActions(_state.serverActions, evalCtx, config)
        : evaluate(evalCtx).actions;
    const actions = evaluated.map(e => _toUiCard(e, config));

    // 3. 推理摘要
    const whyLines = buildWhyLines(evalCtx);

    /* v1.49.x P1-4：abilitySegment 默认 balanced；上游（commercialInsight / lifecycleAwareOffers）
     * 在调用前把 ability + metrics 写进 _state 以增量丰富 insight。 */
    const abilitySegment = _state.abilitySegment || 'balanced';
    const abilitySegmentMeta = getAbilitySegmentMeta(abilitySegment);

    return {
        segment:       _state.segment,
        segmentLabel:  meta.label,
        segmentColor:  meta.color,
        segmentIcon:   meta.icon,
        abilitySegment,
        abilitySegmentLabel: abilitySegmentMeta.label,
        abilitySegmentIcon:  abilitySegmentMeta.icon,
        abilitySegmentColor: abilitySegmentMeta.color,
        signals,
        actions,
        explain:       _state.serverExplain ?? '',
        whyLines,
    };
}

/**
 * v1.49.x P1-4：把当前玩家的 ability + metrics 转为 abilitySegment 写入 _state，
 * 让下次 getCommercialInsight 输出 abilitySegment 字段。
 *
 * @param {object} ability     来自 buildPlayerAbilityVector
 * @param {object} metrics     PlayerProfile.metrics 快照
 */
export function updateAbilitySegment(ability, metrics) {
    _state.abilitySegment = getAbilitySegment(ability, metrics);
}

// ── 信号卡片渲染 ──────────────────────────────────────────────────────────────
function _buildSignalCards(evalCtx, segMeta, config) {
    const { persona: s, realtime: rt } = evalCtx;
    const t = config.thresholds ?? {};
    const sw = config.segmentWeights ?? {};

    return [
        {
            key: 'segment',
            label: '用户分群',
            value: `${segMeta.icon} ${segMeta.label}`,
            sub:   `鲸鱼分 ${(s.whaleScore * 100).toFixed(0)}%`,
            color: segMeta.color,
            tooltip:
                `分群（鲸鱼分 ${(s.whaleScore * 100).toFixed(0)}% = ` +
                `最高分×${sw.best_score_norm}+局数×${sw.total_games_norm}+时长×${sw.session_time_norm}）\n` +
                `Whale≥${((config.segments?.find(x=>x.id==='whale')?.minWhaleScore ?? 0.6) * 100).toFixed(0)}%→IAP/月卡优先，屏蔽插屏\n` +
                `Dolphin/Minnow 据 segments 阈值划分`,
        },
        {
            key: 'activity',
            label: '活跃度',
            value: _barLevel(s.activityScore, t),
            sub:   `近 7 天活跃评分 ${(s.activityScore * 100).toFixed(0)}%`,
            color: _levelColor(s.activityScore, t),
            tooltip:
                `近 7 日活跃评分 ${(s.activityScore * 100).toFixed(0)}%\n` +
                `高≥${((t.activityHigh ?? 0.7) * 100).toFixed(0)}%→粘性强，IAP 窗口好\n` +
                `中→推连签提醒，D7+15%\n` +
                `低<${((t.activityLow ?? 0.35) * 100).toFixed(0)}%→触发唤回推送`,
        },
        {
            key: 'skill',
            label: '技能',
            value: rt.skillLabel ?? _skillLabel(s.skillScore),
            sub:   `技能分 ${(s.skillScore * 100).toFixed(0)}%`,
            color: '#10b981',
            tooltip:
                `技能分 ${(s.skillScore * 100).toFixed(0)}%（消行率 EMA）\n` +
                `高手≥80%→高难皮肤/挑战模式\n` +
                `中级 55-80%→赛季通行证效果佳\n` +
                `新手<55%→每日任务+提示包`,
        },
        {
            key: 'frustration',
            label: '挫败感',
            value: _frustLabel(rt.frustration ?? s.frustrationAvg),
            sub:   `连续未消行 ${rt.frustration ?? '—'} 次`,
            color: _frustColor(rt.frustration ?? s.frustrationAvg, t),
            tooltip:
                `连续未消行 ${rt.frustration ?? 0} 次\n` +
                `≥${t.frustrationRescue ?? 5}次→触发救济广告/提示包 IAP\n` +
                `${t.frustrationWarning ?? 3}-${(t.frustrationRescue ?? 5) - 1}次→接近阈值，准备介入\n` +
                `0-2次→正常节奏`,
        },
        {
            key: 'nearMiss',
            label: '近失率',
            value: `${(s.nearMissRate * 100).toFixed(0)}%`,
            sub:   rt.hadNearMiss ? '⚡ 刚刚触发近失' : '近期未触发',
            color: rt.hadNearMiss ? '#f59e0b' : '#9ca3af',
            tooltip:
                `填充率>60%未消行=近失（当前：${rt.hadNearMiss ? '⚡已触发' : '未触发'}）\n` +
                `历史近失率：${(s.nearMissRate * 100).toFixed(0)}%\n` +
                `近失时展示激励广告转化率 +40%`,
        },
        {
            key: 'flow',
            label: '心流',
            value: _flowLabel(rt.flowState, config),
            sub:   rt.flowState === 'flow' ? '请勿打断广告' : '可触发商业策略',
            color: rt.flowState === 'flow' ? '#10b981' : '#6b7280',
            tooltip:
                `心流状态：${_flowLabel(rt.flowState, config)}\n` +
                `心流中→抑制插屏（流失率峰值）\n` +
                `略无聊→展示皮肤/新内容\n` +
                `略焦虑→激励广告/提示包转化率↑`,
        },
    ];
}

function _barLevel(v, t) {
    if (v >= (t.activityHigh ?? 0.7)) return '高';
    if (v >= (t.activityLow  ?? 0.35)) return '中';
    return '低';
}

function _levelColor(v, t) {
    if (v >= (t.activityHigh ?? 0.7)) return '#10b981';
    if (v >= (t.activityLow  ?? 0.35)) return '#f59e0b';
    return '#ef4444';
}

function _frustLabel(v) {
    const n = Number(v ?? 0);
    if (n <= 0) return '无';
    if (n <= 2) return '轻微';
    if (n <= 4) return '中等';
    return '较高';
}

function _frustColor(v, t) {
    const n = Number(v ?? 0);
    if (n >= (t.frustrationRescue ?? 5)) return '#ef4444';
    if (n >= (t.frustrationWarning ?? 3)) return '#f59e0b';
    if (n <= 0) return '#10b981';
    return '#f59e0b';
}

function _flowLabel(state, config) {
    const meta = (config.copy?.flow ?? {})[state];
    return meta?.label ?? '—';
}

// ── 服务端动作 → 引擎评估桥接 ─────────────────────────────────────────────────
/**
 * 当后端返回了显式 strategy.actions（A/B 实验或人工调度）时，将它们映射到本地
 * 规则矩阵以复用 why/effect 文案。匹配键：(action.type, action.product 或 action.format)。
 */
function _renderServerActions(serverActions, evalCtx, config) {
    const rules = config.rules ?? [];
    return serverActions.map(act => {
        // 在本地规则中找一条 action 字段最接近的（type + product/format 同时匹配优先）
        const match = rules.find(r => {
            if (r.action?.type !== act.type) return false;
            if (act.product && r.action.product !== act.product) return false;
            if (act.format  && r.action.format  !== act.format)  return false;
            return true;
        }) ?? rules.find(r => r.action?.type === act.type);

        if (match) {
            // 借用 evaluate() 的渲染逻辑：直接调用 explain（如果有）
            let why = match.why ?? '';
            let effect = match.effect ?? '';
            if (typeof match.explain === 'function') {
                try {
                    const dyn = match.explain(evalCtx) ?? {};
                    if (dyn.why) why = dyn.why;
                    if (dyn.effect) effect = dyn.effect;
                } catch { /* ignore */ }
            }
            return {
                ruleId: match.id,
                action: { ...match.action, ...act },
                priority: act.priority ?? match.priority ?? 'medium',
                why, effect,
                active: _isActiveByAction(act, evalCtx, config),
            };
        }

        // 无匹配规则 → 兜底文案
        return {
            ruleId: `server.${act.type}.${act.product ?? act.format ?? 'unknown'}`,
            action: act,
            priority: act.priority ?? 'medium',
            why: '', effect: '',
            active: _isActiveByAction(act, evalCtx, config),
        };
    });
}

function _isActiveByAction(act, evalCtx, config) {
    const t = config.thresholds ?? {};
    const rt = evalCtx.realtime;
    if (act.type === 'ads' && act.format === 'rewarded' && rt.hadNearMiss) return true;
    if (act.type === 'ads' && act.trigger === 'game_over') return true;
    if (act.type === 'iap' && Number(rt.frustration ?? 0) >= (t.frustrationIapHint ?? 4)) return true;
    return false;
}

// ── 引擎结果 → UI 卡片视图 ────────────────────────────────────────────────────
function _toUiCard(evaluated, config) {
    const a = evaluated.action ?? {};
    const typeMeta = (config.copy?.actionType ?? {})[a.type] ?? { icon: '💡', label: '策略' };
    const productMeta = config.products?.[a.product];
    const productLabel = productMeta?.label ?? a.product ?? a.format ?? '—';

    return {
        ruleId:  evaluated.ruleId,
        icon:    typeMeta.icon,
        label:   typeMeta.label,
        product: productLabel,
        priority: evaluated.priority,
        active:   evaluated.active,
        format:   a.format,
        trigger:  a.trigger,
        why:      evaluated.why,
        effect:   evaluated.effect,
    };
}

// ── 兼容旧 API（被 commercialInsight 与测试引用） ─────────────────────────────

/**
 * 生成策略推理摘要（bullet 列表）— 向后兼容入口。
 * 内部转发到 strategyEngine.buildWhyLines。
 *
 * @param {object} state  _state 当前快照（接受旧调用方传入快照）
 * @returns {string[]}
 */
export function buildCommercialWhyLines(state) {
    const s = state ?? _state;
    return buildWhyLines({
        persona: {
            segment:        s.segment,
            whaleScore:     s.whaleScore,
            activityScore:  s.activityScore,
            skillScore:     s.skillScore,
            frustrationAvg: s.frustrationAvg,
            nearMissRate:   s.nearMissRate,
        },
        realtime: { ...(s.realtimeSignals ?? {}) },
        config:   getStrategyConfig(),
    });
}

/** 返回当前缓存的分群（轻量查询，不触发网络请求） */
export function getCurrentSegment() {
    return _state.segment;
}

/** 据当前 whaleScore 重新分群（在配置阈值变更时手动触发） */
export function reclassifyFromConfig() {
    _state.segment = classifySegment(_state.whaleScore);
    return _state.segment;
}

/** 返回完整状态（测试用） */
export function _getState() { return _state; }

/** 重置为默认（测试用） */
export function _resetState() { _state = _defaultState(); }
