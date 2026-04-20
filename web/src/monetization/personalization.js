/**
 * 个性化商业化引擎（OPT-09 行为序列驱动个性化）
 *
 * 职责：
 *   1. 从后端 /api/mon/user-profile/<userId> 拉取基于 SQLite 行为数据的商业画像
 *   2. 结合 PlayerProfile 实时信号（frustration、skill、nearMiss、flowState）更新策略
 *   3. 对外暴露 getCommercialInsight() 供面板渲染
 *   4. 将分群结果注入 adTrigger / iapAdapter / dailyTasks 的决策路径
 *
 * 分群定义：
 *   whale    — 高价值：最高分高、局数多、时长长 → 主推 IAP、不打广告
 *   dolphin  — 中等：适度活跃 → 激励广告 + 周卡
 *   minnow   — 轻度：新用户或低活 → 插屏广告 + 新手礼包
 *
 * 信号优先级（高 → 低）：
 *   frustration ≥ 5 → 救济广告/提示包
 *   nearMiss        → 激励广告钩子
 *   flowState=flow  → 不打断（抑制广告）
 *   activityScore低 → 推送唤回
 */

import { getApiBaseUrl } from '../config.js';
import { getFlag } from './featureFlags.js';

const CACHE_KEY = 'openblock_mon_persona_v1';
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 小时

/** @type {PersonaState} */
let _state = _loadCache() ?? _defaultState();

/** @typedef {{ segment: string, whaleScore: number, activityScore: number, skillScore: number,
 *   frustrationAvg: number, nearMissRate: number, strategy: object,
 *   realtimeSignals: object, lastFetchMs: number }} PersonaState */

function _defaultState() {
    return {
        segment: 'minnow',
        whaleScore: 0,
        activityScore: 0,
        skillScore: 0,
        frustrationAvg: 0,
        nearMissRate: 0,
        strategy: { actions: [], explain: '尚未获取个性化数据' },
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
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(state));
    } catch { /* quota */ }
}

function _apiBase() {
    return getApiBaseUrl().replace(/\/+$/, '');
}

/**
 * 从后端拉取并更新个性化画像。
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
        _state = {
            segment:        data.segment        ?? 'minnow',
            whaleScore:     data.whale_score     ?? 0,
            activityScore:  data.activity_score  ?? 0,
            skillScore:     data.skill_score     ?? 0,
            frustrationAvg: data.frustration_avg ?? 0,
            nearMissRate:   data.near_miss_rate  ?? 0,
            strategy:       data.strategy        ?? { actions: [], explain: '' },
            realtimeSignals: _state.realtimeSignals,
            lastFetchMs:    Date.now(),
        };
        _saveCache(_state);
    } catch { /* 网络不可用时沿用缓存 */ }
}

/**
 * 用 PlayerProfile 实时信号更新 realtimeSignals（每次出块后调用）。
 * @param {import('../playerProfile.js').PlayerProfile} profile
 */
export function updateRealtimeSignals(profile) {
    if (!profile) return;
    _state.realtimeSignals = {
        frustration:   profile.frustrationLevel,
        skill:         profile.skillLevel,
        flowState:     profile.flowState,
        hadNearMiss:   profile.hadRecentNearMiss,
        sessionPhase:  profile.sessionPhase,
        momentum:      profile.momentum,
        skillLabel:    _skillLabel(profile.skillLevel),
    };
}

/** 技能等级文字标签 */
function _skillLabel(v) {
    if (v >= 0.8) return '高手';
    if (v >= 0.55) return '中级';
    if (v >= 0.3) return '新手';
    return '入门';
}

/**
 * 返回当前个性化洞察（供面板渲染）。
 * @returns {{ segment: string, segmentLabel: string, segmentColor: string,
 *   signals: object[], strategy: object[], explain: string }}
 */
export function getCommercialInsight() {
    const s = _state;
    const rt = s.realtimeSignals;

    const segmentMeta = {
        whale:   { label: 'Whale 高价值', color: '#f59e0b', icon: '🐋' },
        dolphin: { label: 'Dolphin 中等', color: '#3b82f6', icon: '🐬' },
        minnow:  { label: 'Minnow 轻度',  color: '#6b7280', icon: '🐟' },
    };
    const meta = segmentMeta[s.segment] ?? segmentMeta.minnow;

    // — 信号展示卡片（6 个，3×2 布局）—
    const signals = [
        {
            key: 'segment',
            label: '用户分群',
            value: `${meta.icon} ${meta.label}`,
            sub:   `鲸鱼分 ${(s.whaleScore * 100).toFixed(0)}%`,
            color: meta.color,
            tooltip: `分群（鲸鱼分 ${(s.whaleScore * 100).toFixed(0)}% = 最高分×0.4+局数×0.3+时长×0.3）\n` +
                `Whale≥60%→IAP/月卡优先，屏蔽插屏\n` +
                `Dolphin 30-60%→激励广告+周卡\n` +
                `Minnow<30%→插屏广告+新手礼包`,
        },
        {
            key: 'activity',
            label: '活跃度',
            value: _barLevel(s.activityScore),
            sub:   `近 7 天活跃评分 ${(s.activityScore * 100).toFixed(0)}%`,
            color: _levelColor(s.activityScore),
            tooltip: `近 7 日活跃评分 ${(s.activityScore * 100).toFixed(0)}%\n` +
                `高≥70%→粘性强，IAP 窗口好\n` +
                `中 35-70%→推连签提醒，D7+15%\n` +
                `低<35%→触发唤回推送`,
        },
        {
            key: 'skill',
            label: '技能',
            value: rt.skillLabel ?? _skillLabel(s.skillScore),
            sub:   `技能分 ${(s.skillScore * 100).toFixed(0)}%`,
            color: '#10b981',
            tooltip: `技能分 ${(s.skillScore * 100).toFixed(0)}%（消行率 EMA）\n` +
                `高手≥80%→高难皮肤/挑战模式\n` +
                `中级 55-80%→赛季通行证效果佳\n` +
                `新手<55%→每日任务+提示包`,
        },
        {
            key: 'frustration',
            label: '挫败感',
            value: _frustLabel(rt.frustration ?? s.frustrationAvg),
            sub:   `连续未消行 ${rt.frustration ?? '—'} 次`,
            color: _frustColor(rt.frustration ?? s.frustrationAvg),
            tooltip: `连续未消行 ${rt.frustration ?? 0} 次\n` +
                `≥5次→触发救济广告/提示包 IAP\n` +
                `3-4次→接近阈值，准备介入\n` +
                `0-2次→正常节奏`,
        },
        {
            key: 'nearMiss',
            label: '近失率',
            value: `${(s.nearMissRate * 100).toFixed(0)}%`,
            sub:   rt.hadNearMiss ? '⚡ 刚刚触发近失' : '近期未触发',
            color: rt.hadNearMiss ? '#f59e0b' : '#9ca3af',
            tooltip: `填充率>60%未消行=近失（当前：${rt.hadNearMiss ? '⚡已触发' : '未触发'}）\n` +
                `历史近失率：${(s.nearMissRate * 100).toFixed(0)}%\n` +
                `近失时展示激励广告转化率 +40%`,
        },
        {
            key: 'flow',
            label: '心流',
            value: _flowLabel(rt.flowState),
            sub:   rt.flowState === 'flow' ? '请勿打断广告' : '可触发商业策略',
            color: rt.flowState === 'flow' ? '#10b981' : '#6b7280',
            tooltip: `心流状态：${_flowLabel(rt.flowState)}\n` +
                `心流中→抑制插屏（流失率峰值）\n` +
                `略无聊→展示皮肤/新内容\n` +
                `略焦虑→激励广告/提示包转化率↑`,
        },
    ];

    // — 策略推荐卡片 —
    const actions = (s.strategy?.actions ?? []).map(a => _actionToCard(a, rt));
    const explain = s.strategy?.explain ?? '';

    // — 推理摘要 bullets（风格参考 playerInsightPanel._buildWhyLines）—
    const whyLines = buildCommercialWhyLines(s);

    return { segment: s.segment, segmentLabel: meta.label, segmentColor: meta.color,
             segmentIcon: meta.icon, signals, actions, explain, whyLines };
}

function _barLevel(v) {
    if (v >= 0.7) return '高';
    if (v >= 0.35) return '中';
    return '低';
}

function _levelColor(v) {
    if (v >= 0.7) return '#10b981';
    if (v >= 0.35) return '#f59e0b';
    return '#ef4444';
}

function _frustLabel(v) {
    const n = Number(v ?? 0);
    if (n <= 0) return '无';
    if (n <= 2) return '轻微';
    if (n <= 4) return '中等';
    return '较高';
}

function _frustColor(v) {
    const n = Number(v ?? 0);
    if (n <= 0) return '#10b981';
    if (n <= 2) return '#f59e0b';
    return '#ef4444';
}

function _flowLabel(state) {
    return { flow: '心流中', bored: '略无聊', anxious: '略焦虑' }[state] ?? '—';
}

function _actionToCard(action, rt) {
    const typeMap = {
        ads:  { icon: '📢', label: '广告策略' },
        iap:  { icon: '💳', label: 'IAP 推荐' },
        push: { icon: '🔔', label: '推送策略' },
        task: { icon: '✅', label: '任务激励' },
    };
    const meta = typeMap[action.type] ?? { icon: '💡', label: '策略' };
    const productLabels = {
        monthly_pass: '月卡通行证',
        weekly_pass:  '周卡通行证',
        starter_pack: '新手礼包',
        hint_pack_5:  '提示包×5',
    };

    // 实时信号触发标记
    let active = false;
    if (action.type === 'ads' && action.format === 'rewarded' && rt.hadNearMiss) active = true;
    if (action.type === 'ads' && action.trigger === 'game_over') active = true;
    if (action.type === 'iap' && rt.frustration >= 4) active = true;

    // 每条策略的 why（触发原因）+ effect（预期效果）
    const { why, effect } = _actionExplain(action, rt);

    return {
        icon:    meta.icon,
        label:   meta.label,
        product: productLabels[action.product] ?? action.product ?? action.format ?? '—',
        priority: action.priority ?? 'medium',
        active,
        format:  action.format,
        trigger: action.trigger,
        why,
        effect,
    };
}

/** 根据动作类型 + 实时信号生成 why / effect 文案 */
function _actionExplain(action, rt) {
    const frust = Number(rt.frustration ?? 0);
    const nm    = rt.hadNearMiss;

    if (action.type === 'iap') {
        if (action.product === 'monthly_pass') {
            return {
                why:    'Whale 用户付费意愿强',
                effect: 'LTV 约为周卡 3.8×',
            };
        }
        if (action.product === 'weekly_pass') {
            return {
                why:    'Dolphin 用户对周期低价付费接受度高',
                effect: '首月留存 +22%，向月卡转化铺路',
            };
        }
        if (action.product === 'starter_pack') {
            return {
                why:    frust >= 4
                    ? `未消行 ${frust} 次，挫败临界是首购窗口`
                    : '新用户限时礼包降低首付门槛',
                effect: '首次付费转化率比常规 IAP +35%',
            };
        }
        if (action.product === 'hint_pack_5') {
            return {
                why:    `未消行 ${frust} 次，提示需求明确`,
                effect: '降低即时流失率约 18%',
            };
        }
    }

    if (action.type === 'ads') {
        if (action.format === 'rewarded') {
            return {
                why:    nm
                    ? '⚡ 近失：玩家主动性最强'
                    : frust >= 3
                        ? `挫败感 ${frust} 次，"救济"广告接受度高`
                        : '奖励与游戏需求对齐',
                effect: '近失节点转化率 +40%',
            };
        }
        if (action.format === 'interstitial') {
            return {
                why:    '游戏结束是天然断点',
                effect: 'eCPM 最高，留存影响 <2%',
            };
        }
        if (action.format === 'none') {
            return {
                why:    'Whale 用户广告容忍度低，流失成本 > 广告收益',
                effect: '屏蔽广告，保留 LTV，推 IAP 变现',
            };
        }
    }

    if (action.type === 'push') {
        return {
            why:    '近 7 日活跃度下降',
            effect: 'D7 留存 +15%',
        };
    }

    if (action.type === 'task') {
        return {
            why:    '轻度用户需要短期目标锚定',
            effect: 'D1 留存 +28%，积累付费转化积分',
        };
    }

    return { why: '', effect: '' };
}

/**
 * 生成策略推理摘要（bullet 列表），风格参考 playerInsightPanel._buildWhyLines。
 * @param {object} state  _state 当前快照
 * @returns {string[]}
 */
export function buildCommercialWhyLines(state) {
    const s   = state;
    const rt  = s.realtimeSignals ?? {};
    const lines = [];

    // 分群依据
    const segLabel = { whale: 'Whale', dolphin: 'Dolphin', minnow: 'Minnow' }[s.segment] ?? s.segment;
    lines.push(`分群 ${segLabel}：鲸鱼分 ${(s.whaleScore * 100).toFixed(0)}%（最高分×0.4 + 局数×0.3 + 时长×0.3）`);

    // 活跃度
    if (s.activityScore >= 0.7) {
        lines.push(`活跃度高（${(s.activityScore * 100).toFixed(0)}%）→ IAP 转化窗口良好`);
    } else if (s.activityScore < 0.35) {
        lines.push(`活跃度低（${(s.activityScore * 100).toFixed(0)}%）→ 触发唤回推送，D7 +15%`);
    }

    // 挫败感
    const frust = Number(rt.frustration ?? 0);
    if (frust >= 5) {
        lines.push(`未消行 ${frust} 次 → 已达救济阈值，激励广告/提示包转化率最高`);
    } else if (frust >= 3) {
        lines.push(`未消行 ${frust} 次 → 接近阈值，准备触发救济策略`);
    }

    // 近失
    if (rt.hadNearMiss) {
        lines.push('⚡ 近失触发 → 激励广告转化率 +40%，立即展示最佳');
    } else if (s.nearMissRate > 0.3) {
        lines.push(`历史近失率 ${(s.nearMissRate * 100).toFixed(0)}% → 激励广告收益优于插屏`);
    }

    // 心流
    if (rt.flowState === 'flow') {
        lines.push('心流中 → 抑制插屏广告，流失率峰值');
    } else if (rt.flowState === 'anxious') {
        lines.push('略焦虑 → 激励广告/提示包接受度↑');
    } else if (rt.flowState === 'bored') {
        lines.push('略无聊 → 展示皮肤/新内容预告引导付费');
    }

    // 晋升路径
    if (s.segment === 'minnow' && s.whaleScore > 0.15) {
        const gap = (0.30 - s.whaleScore);
        lines.push(`距晋升 Dolphin 差 ${(gap * 100).toFixed(0)} 分 → 再玩 ${Math.ceil(gap / 0.006)} 局可触发`);
    } else if (s.segment === 'dolphin' && s.whaleScore > 0.45) {
        const gap = (0.60 - s.whaleScore);
        lines.push(`距晋升 Whale 差 ${(gap * 100).toFixed(0)} 分 → 提升最高分或时长`);
    }

    return lines;
}

/** 返回当前缓存的分群（轻量查询，不触发网络请求） */
export function getCurrentSegment() {
    return _state.segment;
}

/** 返回完整状态（测试用） */
export function _getState() {
    return _state;
}

/** 重置为默认（测试用） */
export function _resetState() {
    _state = _defaultState();
}
