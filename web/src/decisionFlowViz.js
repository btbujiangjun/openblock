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

/* eslint-disable no-magic-numbers */

import { SIGNAL_LABELS, summarizeContributors } from './stressMeter.js';
import { t } from './i18n/i18n.js';

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
const SIGNAL_NODES = [
    { key: 'skill',      i18nKey: 'dfv.signal.skill',     label: '技能',   readPath: ['profile', 'skillLevel'],          range: [0, 1] },
    { key: 'momentum',   i18nKey: 'dfv.signal.momentum',  label: '动量',   readPath: ['profile', 'momentum'],            range: [-1, 1], signed: true },
    { key: 'frust',      i18nKey: 'dfv.signal.frust',     label: '挫败',   readPath: ['profile', 'frustrationLevel'],    range: [0, 8],  format: 'int' },
    { key: 'flow',       i18nKey: 'dfv.signal.flow',      label: '心流',   readPath: ['profile', 'flowState'],           type: 'enum',
      enumColors: { bored: '#fbbf24', flow: '#10b981', anxious: '#ef4444' } },
    { key: 'session',    i18nKey: 'dfv.signal.session',   label: '阶段',   readPath: ['profile', 'sessionPhase'],        type: 'enum',
      enumColors: { early: '#60a5fa', peak: '#10b981', late: '#f97316' } },
    { key: 'load',       i18nKey: 'dfv.signal.load',      label: '负荷',   readPath: ['profile', 'cognitiveLoad'],       range: [0, 1] },
    { key: 'clearRate',  i18nKey: 'dfv.signal.clearRate', label: '消行率', readPath: ['profile', 'metrics', 'clearRate'], range: [0, 0.55] },
    { key: 'boardFill',  i18nKey: 'dfv.signal.boardFill', label: '占盘',   readPath: ['profile', 'boardFill'],            range: [0, 1] },
    { key: 'combo',      i18nKey: 'dfv.signal.combo',     label: '连击',   readPath: ['profile', 'recentComboStreak'],    range: [0, 6],  format: 'int' },
    { key: 'missRate',   i18nKey: 'dfv.signal.missRate',  label: '失放率', readPath: ['profile', 'metrics', 'missRate'],  range: [0, 0.4] },
];

/** 决策输出节点定义（右列）spawnIntent 颜色映射（与 stressMeter 叙事同口径） */
const SPAWN_INTENT_COLOR = {
    relief:   '#22d3ee',
    engage:   '#a78bfa',
    flow:     '#10b981',
    maintain: '#94a3b8',
    pressure: '#f59e0b',
    harvest:  '#f472b6',
};

/** 中文意图说明（hover / 详情区显示） */
const SPAWN_INTENT_DESC = {
    relief:   '救济节奏',
    engage:   '挑战参与',
    flow:     '维持心流',
    maintain: '保持节奏',
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

function _dfvFingerprint(insight, profile) {
    if (!insight && !profile) return 'empty';
    const i = insight || {};
    const p = profile || {};
    const b = i.stressBreakdown || {};
    const h = i.spawnHints || {};
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
    ];
    for (const k of Object.keys(b)) parts.push(`${k}:${round(b[k])}`);
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
            footRelief:   _ti('dfv.foot.relief', '救济'),
            footPressure: _ti('dfv.foot.pressure', '加压'),
            footPulseHint:_ti('dfv.foot.pulseHint', '脉冲=新 spawn'),
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
                <div class="dfv-body">
                    <div class="dfv-stage" id="dfv-stage">
                        <canvas class="dfv-particles" id="dfv-particles"></canvas>
                        <svg class="dfv-svg" id="dfv-svg" xmlns="http://www.w3.org/2000/svg"
                             viewBox="0 0 360 480" preserveAspectRatio="xMidYMid meet"></svg>
                    </div>
                    <div class="dfv-details" id="dfv-details">
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
                            <ul class="dfv-list dfv-list--two-col" id="dfv-shape-list"></ul>
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
                    <span class="dfv-legend dfv-legend--ver">v1.54.0</span>
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

        this._resizeCanvas();
        new ResizeObserver(() => this._resizeCanvas()).observe(host.querySelector('#dfv-stage'));

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
        };
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
            const w = rect.width, h = rect.height;
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
            row.innerHTML = `
                <span class="dfv-spark-label" style="color:${s.color}" title="${s.label}">${cn}</span>
                <svg class="dfv-spark-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 18" preserveAspectRatio="none">
                    <path class="dfv-spark-path" fill="none" stroke="${s.color}" stroke-width="1.4" stroke-linejoin="round" d=""></path>
                    <line class="dfv-spark-zero" x1="0" x2="240" y1="9" y2="9" stroke="rgba(148,163,184,0.18)" stroke-dasharray="2 3"></line>
                </svg>
                <span class="dfv-spark-value" style="color:${s.color}">—</span>
            `;
            container.appendChild(row);
            this._sparkEls.set(s.key, {
                path:  row.querySelector('.dfv-spark-path'),
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
            if (len === 0) { _setAttrIfChanged(ref.path, 'd', ''); ref.value.textContent = '—'; continue; }

            const [lo, hi] = s.range;
            const span = Math.max(1e-6, hi - lo);
            const W = 240, H = 18;
            let d = '';
            let lastValid = NaN;
            for (let i = 0; i < len; i++) {
                const v = buf[(start + i) % n];
                if (!Number.isFinite(v)) continue;
                const x = (i / Math.max(1, len - 1)) * W;
                const norm = _clamp((v - lo) / span, 0, 1);
                const y = H - norm * H;
                d += (d ? ' L' : 'M') + x.toFixed(1) + ',' + y.toFixed(1);
                lastValid = v;
            }
            _setAttrIfChanged(ref.path, 'd', d);
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
        const signalX = W * 0.18;
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
        const edgeMarginY = Math.max(44, H * 0.12);
        const stressY = edgeMarginY + stressR;      // 压力上边距与意图下边距保持一致

        const intentX = centerX;
        const intentY = H - edgeMarginY - intentR;

        /* 1) 左列：玩家信号节点（垂直均匀分布 10 个，半径自适应） */
        SIGNAL_NODES.forEach((sig, i) => {
            const y = H * 0.06 + (H * 0.88) * (i / Math.max(1, leftN - 1));
            this._geom.set(sig.key, { x: signalX, y, r });
            this._addSignalNode(sig.key, _ti(sig.i18nKey, sig.label), r);
        });

        /* 2) 中央：stress 球（垂直居中） */
        this._geom.set('stress', { x: stressX, y: stressY, r: stressR });
        this._addStressBall();

        /* 3) 中央偏下：spawnIntent 六边形（与 stress 同 x，纵向拉开） */
        this._geom.set('spawnIntent', { x: intentX, y: intentY, r: intentR });
        this._addSpawnIntentNode();

        /* 3.5) 压力 -> 策略分量 -> 意图（常驻）：去文本化，改为多分量图形链路 */
        {
            const p0 = { x: stressX, y: stressY + stressR * 0.60 };
            const p2 = { x: intentX, y: intentY - intentR * 0.62 };
            const p1 = { x: stressX, y: (p0.y + p2.y) / 2 };
            const trunkD = bezierPath(p0, p1, p2);
            const trunkBase = this._svgEl('path', {
                d: trunkD, fill: 'none', stroke: '#64748b', 'stroke-width': 1.1, 'stroke-opacity': 0.38,
                'stroke-linecap': 'round', class: 'dfv-strategy-link dfv-strategy-link--base',
            });
            const trunkHalo = this._svgEl('path', {
                d: trunkD, fill: 'none', stroke: '#22d3ee', 'stroke-width': 2.6, 'stroke-opacity': 0.08,
                'stroke-linecap': 'round', class: 'dfv-strategy-link dfv-strategy-link--halo',
            });
            const trunkFlow = this._svgEl('path', {
                d: trunkD, fill: 'none', stroke: '#e2f7ff', 'stroke-width': 1.3, 'stroke-opacity': 0.30,
                'stroke-linecap': 'round', 'stroke-dasharray': '4.8 10.8', 'stroke-dashoffset': '0',
                class: 'dfv-strategy-link dfv-strategy-link--flow',
            });
            const midY = (stressY + intentY) / 2;
            const rowCenterX = stressX;
            const comps = STRATEGY_COMPONENT_DEFS.map((def, idx) => {
                const rel = idx - centerIdx;
                const x = rowCenterX + rel * span;
                const y = midY;
                const n = { x, y };
                const dOut = bezierPath(
                    p0,
                    { x: n.x, y: p0.y + (n.y - p0.y) * 0.50 },
                    n,
                );
                const dIn = bezierPath(
                    n,
                    { x: n.x, y: n.y + (p2.y - n.y) * 0.50 },
                    p2,
                );
                const outBase = this._svgEl('path', {
                    d: dOut, fill: 'none', stroke: '#475569', 'stroke-width': 0.95, 'stroke-opacity': 0.28,
                    'stroke-linecap': 'round', class: 'dfv-strategy-branch dfv-strategy-link',
                });
                const outHalo = this._svgEl('path', {
                    d: dOut, fill: 'none', stroke: def.color, 'stroke-width': 2.0, 'stroke-opacity': 0.0,
                    'stroke-linecap': 'round', class: 'dfv-strategy-branch dfv-strategy-link--halo',
                });
                const outFlow = this._svgEl('path', {
                    d: dOut, fill: 'none', stroke: '#fff', 'stroke-width': 0.95, 'stroke-opacity': 0.0,
                    'stroke-linecap': 'round', 'stroke-dasharray': '4 8', 'stroke-dashoffset': '0',
                    class: 'dfv-strategy-branch dfv-strategy-link--flow',
                });
                const inBase = this._svgEl('path', {
                    d: dIn, fill: 'none', stroke: '#475569', 'stroke-width': 0.95, 'stroke-opacity': 0.24,
                    'stroke-linecap': 'round', class: 'dfv-strategy-branch dfv-strategy-link',
                });
                const inHalo = this._svgEl('path', {
                    d: dIn, fill: 'none', stroke: def.color, 'stroke-width': 1.8, 'stroke-opacity': 0.0,
                    'stroke-linecap': 'round', class: 'dfv-strategy-branch dfv-strategy-link--halo',
                });
                const inFlow = this._svgEl('path', {
                    d: dIn, fill: 'none', stroke: '#fff', 'stroke-width': 0.9, 'stroke-opacity': 0.0,
                    'stroke-linecap': 'round', 'stroke-dasharray': '3.2 9.2', 'stroke-dashoffset': '0',
                    class: 'dfv-strategy-branch dfv-strategy-link--flow',
                });
                const group = this._svgEl('g', { class: 'dfv-strategy-node', 'data-key': def.key });
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
                return {
                    ...def,
                    pos: n,
                    baseR,
                    node,
                    inner,
                    glow,
                    spec,
                    valueText,
                    out: { base: outBase, halo: outHalo, flow: outFlow },
                    inbound: { base: inBase, halo: inHalo, flow: inFlow },
                };
            });
            this._strategyLinkEl = { trunk: { base: trunkBase, halo: trunkHalo, flow: trunkFlow }, comps };
        }

        /* 4) 中央灯环（pulse 时显形）— 跟随 stress 球几何 */
        const ring = this._svgEl('circle', {
            cx: stressX, cy: stressY, r: stressR,
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
        const stressGeom = { x: stressX, y: stressY, r: stressR };
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

    _addSignalNode(key, label, r) {
        const g = this._geom.get(key);
        const group = this._svgEl('g', { class: 'dfv-node dfv-node--signal', 'data-key': key });
        this._svgEl('circle', {
            cx: g.x, cy: g.y, r: r + 2.4, fill: 'rgba(56,189,248,0.08)', stroke: 'none',
        }, group);
        const core = this._svgEl('circle', {
            cx: g.x, cy: g.y, r, fill: '#1e293b', stroke: '#475569', 'stroke-width': 1.5,
        }, group);
        const labelText = this._svgEl('text', { x: g.x - r - 6, y: g.y + 4, 'text-anchor': 'end', class: 'dfv-node-label' }, group);
        labelText.textContent = label;
        const valueText = this._svgEl('text', {
            x: g.x, y: g.y + 4, 'text-anchor': 'middle', class: 'dfv-node-value',
        }, group);
        valueText.textContent = '—';
        this._nodeEls.set(key, { group, core, valueText });
    }

    _addStressBall() {
        const g = this._geom.get('stress');
        const group = this._svgEl('g', { class: 'dfv-node dfv-node--stress', 'data-key': 'stress' });
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
        const group = this._svgEl('g', { class: 'dfv-node dfv-node--intent', 'data-key': 'spawnIntent' });
        this._svgEl('circle', {
            cx: g.x, cy: g.y, r: (g.r + 8).toFixed(1), fill: 'none',
            stroke: 'rgba(148,163,184,0.25)', 'stroke-width': 1.2, class: 'dfv-intent-orbit',
        }, group);
        const hex = this._svgEl('circle', {
            cx: g.x, cy: g.y, r: g.r, fill: '#1e293b', stroke: '#94a3b8', 'stroke-width': 2, class: 'dfv-intent-core',
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
         * 只保留 Canvas 粒子动画推进与 sparkline 采样。 */
        const fp = _dfvFingerprint(insight, profile);
        const dataChanged = fp !== this._lastFingerprint;
        if (dataChanged) {
            this._lastFingerprint = fp;
            this._lastActiveAt = performance.now();
        }
        const hasActiveParticles = this._particles.length > 0;
        const inSpawnPulseWindow = performance.now() < this._stressPulseUntil + 80;

        if (dataChanged || inSpawnPulseWindow) {
            /* 1) 左列信号节点 */
            SIGNAL_NODES.forEach((sig) => this._renderSignalNode(sig, ctx));
            /* 2) 中央 stress 球 */
            this._renderStressBall(insight);
            /* 3) spawnIntent 节点 */
            this._renderSpawnIntent(insight);
            /* 3.5) 压力 -> 出块策略（左侧算法呈现） */
            this._renderStressToStrategy(insight);
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
            clearRate: Number(profile.metrics?.clearRate) || 0,
            boardFill: liveBoardFill,
            frust: Number(profile.frustrationLevel) || 0,
        });
        this._frameCount++;
        /* 30fps 下每 2 帧渲染一次 ≈ 15Hz，已经够丝滑；idle 档（6fps）每帧都画 */
        if (this._frameCount % 2 === 0 || !hasActiveParticles) this._renderSparks();

        /* 7) HTML 详情区：数据变化时即刻；否则每 12 帧（active≈0.4s / idle≈2s）兜底刷一次 */
        if (dataChanged || this._frameCount % 12 === 0) this._renderDetails(insight, profile);
    }

    _triggerSpawnPulse(insight) {
        this._stressPulseUntil = performance.now() + 400;
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

        /* v1.51.6：纵向布局新增"决策传导"粒子流：每次 spawn 后从 stress 球发射 3~5 条
         * 粒子，沿带 jitter 的 bezier 曲线流向意图六边形，颜色用 intent 颜色，让"压力 →
         * 出块意图"的因果关系一眼可见。控制点偏移让多条粒子形成弧形喷射，动效更立体。 */
        if (intentGeom && stressGeom) {
            const intent = insight?.spawnHints?.spawnIntent ?? insight?.spawnIntent ?? 'maintain';
            const intentColor = SPAWN_INTENT_COLOR[intent] || '#a78bfa';
            const dy = intentGeom.y - stressGeom.y;
            for (let i = 0; i < 5; i++) {
                const jitter = (Math.random() - 0.5) * Math.max(40, dy * 0.45);
                this._particles.push({
                    p0: { x: stressGeom.x, y: stressGeom.y + stressGeom.r * 0.6 },
                    p1: { x: stressGeom.x + jitter, y: stressGeom.y + dy * 0.55 },
                    p2: { x: intentGeom.x, y: intentGeom.y - intentGeom.r * 0.6 },
                    t: -i * 0.06 - 0.05,
                    dur: 0.85 + Math.random() * 0.35,
                    color: intentColor,
                    size: 2.6 + Math.random() * 1.6,
                });
            }
        }

        if (this._particles.length > DFV_PARTICLE_CAP) {
            this._particles.splice(0, this._particles.length - DFV_PARTICLE_CAP);
        }
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
        if (sig.type === 'enum') {
            this._setFitText(ref.valueText, String(raw ?? '—'));
            const color = (raw && sig.enumColors?.[raw]) || '#475569';
            _setAttrIfChanged(ref.core, 'fill', color);
            _setAttrIfChanged(ref.core, 'stroke', _shadeColor(color, -20));
            return;
        }
        if (!Number.isFinite(raw)) {
            this._setFitText(ref.valueText, '—');
            return;
        }
        const [lo, hi] = sig.range || [0, 1];
        // signed 信号（如 momentum）用 |value|/max 衡量"强度"，色阶仍走 0~1
        const norm = sig.signed
            ? Math.abs(raw) / Math.max(Math.abs(lo), Math.abs(hi), 1e-6)
            : (raw - lo) / Math.max(1e-6, hi - lo);
        const sm = approach(this._smooth.get(sig.key) ?? norm, norm, 0.18);
        this._smooth.set(sig.key, sm);
        const color = heatColor(_clamp(sm, 0, 1));
        _setAttrIfChanged(ref.core, 'fill', color);
        _setAttrIfChanged(ref.core, 'stroke', _shadeColor(color, -25));
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
        if (intent) {
            const p0 = { x: n.x, y: n.y };
            const p2 = { x: intent.x, y: intent.y - intent.r * 0.5 };
            const p1 = { x: (p0.x + p2.x) * 0.5 + (Math.random() - 0.5) * 18, y: (p0.y + p2.y) * 0.5 + (Math.random() - 0.5) * 14 };
            this._particles.push({
                p0, p1, p2, t: -0.03, dur: 0.22 + Math.random() * 0.16, color: c2, size: 2.0 + Math.random() * 1.4,
            });
            this._particles.push({
                p0, p1: { x: p1.x + (Math.random() - 0.5) * 10, y: p1.y + (Math.random() - 0.5) * 10 }, p2,
                t: -0.05, dur: 0.24 + Math.random() * 0.16, color: c1, size: 1.7 + Math.random() * 1.1,
            });
        }
    }

    _renderStressBall(insight) {
        if (!this._stressBall) return;
        const target = Number.isFinite(insight?.stress) ? insight.stress : 0;
        const sm = approach(this._smooth.get('stress') ?? target, target, 0.12);
        this._smooth.set('stress', sm);
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
        const intent = insight?.spawnHints?.spawnIntent ?? insight?.spawnIntent ?? '—';
        this._intentEl.valueText.textContent = intent;
        const color = SPAWN_INTENT_COLOR[intent] || '#94a3b8';
        this._intentEl.hex.setAttribute('fill', color);
        this._intentEl.hex.setAttribute('stroke', _shadeColor(color, -20));
        if (this._curIntent !== intent) {
            this._curIntent = intent;
            this._intentEl.group.classList.remove('dfv-intent-flash');
            void this._intentEl.group.getBoundingClientRect();
            this._intentEl.group.classList.add('dfv-intent-flash');
        }
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

            _setAttrIfChanged(comp.out.base, 'stroke', comp.color);
            _setAttrIfChanged(comp.out.base, 'stroke-width', width.toFixed(2));
            _setAttrIfChanged(comp.out.base, 'stroke-opacity', alpha.toFixed(2));
            _setAttrIfChanged(comp.out.halo, 'stroke', comp.color);
            _setAttrIfChanged(comp.out.halo, 'stroke-width', (width * 2.1).toFixed(2));
            _setAttrIfChanged(comp.out.halo, 'stroke-opacity', (alpha * 0.42).toFixed(2));
            _setAttrIfChanged(comp.out.flow, 'stroke-width', Math.max(0.9, width * 0.5).toFixed(2));
            _setAttrIfChanged(comp.out.flow, 'stroke-opacity', (0.14 + compPower * 0.62).toFixed(2));
            _setAttrIfChanged(comp.out.flow, 'stroke-dashoffset', ((this._edgeFlowPhase + idx * 19) * flowSpeed * -0.14).toFixed(1));

            _setAttrIfChanged(comp.inbound.base, 'stroke', comp.color);
            _setAttrIfChanged(comp.inbound.base, 'stroke-width', Math.max(0.8, width * 0.82).toFixed(2));
            _setAttrIfChanged(comp.inbound.base, 'stroke-opacity', (alpha * 0.78).toFixed(2));
            _setAttrIfChanged(comp.inbound.halo, 'stroke', comp.color);
            _setAttrIfChanged(comp.inbound.halo, 'stroke-width', Math.max(1.7, width * 1.7).toFixed(2));
            _setAttrIfChanged(comp.inbound.halo, 'stroke-opacity', Math.min(0.48, alpha * 0.38).toFixed(2));
            _setAttrIfChanged(comp.inbound.flow, 'stroke-width', Math.max(0.85, width * 0.45).toFixed(2));
            _setAttrIfChanged(comp.inbound.flow, 'stroke-opacity', (0.12 + compPower * 0.56).toFixed(2));
            _setAttrIfChanged(comp.inbound.flow, 'stroke-dashoffset', ((this._edgeFlowPhase + idx * 29) * flowSpeed * -0.12).toFixed(1));
        });
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
        const personalizationApplied = !!insight?.personalizationApplied;
        const winbackActive = !!hints?.winbackProtectionActive;
        const milestoneHit = !!insight?.scoreMilestoneHit;
        const afkEngage = !!insight?.afkEngageActive;
        const onboarding = !!profile?.isInOnboarding;

        let reasonKey = 'dfv.reason.default';
        let reasonFb = '常规决策';
        if (forceReliefIntent) {
            reasonKey = lateCollapse ? 'dfv.reason.lateCollapse' : 'dfv.reason.frustHigh';
            reasonFb = lateCollapse ? '末段崩盘 → 强制 relief' : '高挫败 → 强制 relief';
        } else if (intent === 'pressure') { reasonKey = 'dfv.reason.pressure'; reasonFb = '动量良好，可加压'; }
        else if (intent === 'engage')   { reasonKey = 'dfv.reason.engage';   reasonFb = '焦虑/挫败叠加 → 介入引导'; }
        else if (intent === 'flow')     { reasonKey = 'dfv.reason.flow';     reasonFb = '心流稳定 → 维持'; }
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

        /* —— Decision flags（v1.51.4：i18n） —— */
        const flags = [
            ['dfv.flag.forceRelief',     '强制救济',  forceReliefIntent,         'neg'],
            ['dfv.flag.lateCollapse',    '末段崩盘',  endSessionDistressActive,  'neg'],
            ['dfv.flag.frustCritical',   '挫败临界',  frustrationCritical,       'neg'],
            ['dfv.flag.onboarding',      '新手保护',  onboarding,                'pos'],
            ['dfv.flag.milestone',       '里程碑',    milestoneHit,              'pos'],
            ['dfv.flag.afkEngage',       'AFK 介入',  afkEngage,                 'pos'],
            ['dfv.flag.winback',         '回流保护',  winbackActive,             'pos'],
            ['dfv.flag.personalization', '个性化',    personalizationApplied,    'neutral'],
        ];
        const emptyTxt = _ti('dfv.foot.empty', '—');
        els.flags.innerHTML = flags.map(([k, fb, on, kind]) => {
            const cls = on ? `dfv-flag dfv-flag--on dfv-flag--${kind}` : 'dfv-flag';
            return `<span class="${cls}">${_ti(k, fb)}</span>`;
        }).join('');

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
        els.hints.innerHTML = hintEntries.length === 0
            ? `<li class="dfv-list-empty">${emptyTxt}</li>`
            : hintEntries.map(([k, v]) => {
                const label = _ti(`dfv.hint.${k}`, HINT_CN[k] || k);
                let dispV;
                if (typeof v === 'number') dispV = v.toFixed(2);
                else if (HINT_VALUE_NS[k]) dispV = _ti(`dfv.val.${HINT_VALUE_NS[k]}.${v}`, String(v));
                else dispV = String(v);
                return `<li><span class="dfv-li-key" title="${k}">${label}</span><span class="dfv-li-val">${dispV}</span></li>`;
            }).join('');
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
    width: min(540px, calc(100vw - 20px));
    max-height: min(80vh, 680px);
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

/* —— 主体：左 SVG / 右 HTML 详情 —— */
/* v1.51.5：右栏固定窄宽（保障左侧 SVG 完整展示）。
 * grid 用 "minmax(0, 1fr) 240px" —— 左栏吃所有剩余宽度，右栏永远 240，
 * 即便屏幕宽到 1200px 也不会让右栏吃掉中央空间，左侧 stress 球与意图六边形不会再撞。 */
.dfv-body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 220px;
    gap: 6px;
    padding: 5px 8px 5px;
    flex: 1 1 auto;
    min-height: 0;
}
.dfv-stage {
    position: relative;
    min-height: 270px;
    border-radius: 10px;
    background:
        radial-gradient(circle at 68% 52%, rgba(56, 189, 248, 0.16), rgba(56, 189, 248, 0.03) 24%, transparent 62%),
        radial-gradient(circle at 22% 24%, rgba(34, 211, 238, 0.10), transparent 45%),
        linear-gradient(180deg, rgba(15, 23, 42, 0.26), rgba(2, 6, 23, 0.50));
    box-shadow:
        inset 0 0 0 1px rgba(56, 189, 248, 0.10),
        inset 0 0 44px rgba(56, 189, 248, 0.08);
}
.dfv-particles { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.dfv-svg { position: absolute; inset: 0; width: 100%; height: 100%; }

.dfv-details {
    overflow-y: auto;
    overflow-x: hidden;
    padding-right: 2px;
    display: flex; flex-direction: column; gap: 3px;
    font-size: 9.5px;
}
.dfv-details::-webkit-scrollbar { width: 4px; }
.dfv-details::-webkit-scrollbar-thumb { background: rgba(148,163,184,0.3); border-radius: 2px; }

/* v1.51.5 极致紧凑：右栏固定 240px → label/value 字号 9px、行高 16px；
 * section padding/title 也压缩，让 6 个 section 在 max-height 内不溢出。 */
.dfv-section {
    background: rgba(15, 23, 42, 0.55);
    border: 1px solid rgba(56, 189, 248, 0.10);
    border-radius: 5px;
    padding: 3px 6px 4px;
}
.dfv-sec-title {
    font-size: 9.5px; font-weight: 700; color: #7dd3fc; letter-spacing: 0.04em;
    margin: 0 0 2px;
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

/* —— sparkline 时间序列条（v1.51.3 紧凑：参考 .replay-series-cell 18px 行高） —— */
.dfv-sparks {
    padding: 4px 8px 4px;
    border-top: 1px solid rgba(56, 189, 248, 0.18);
    background: rgba(2, 6, 23, 0.5);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
    gap: 1px 8px;
}
.dfv-spark-row {
    display: grid;
    /* v1.51.8: label 从 2.6em → 3.4em，容纳 3 字「消行率 / 失放率」不被 ellipsis 截断 */
    grid-template-columns: 3.4em 1fr 2.8em;
    align-items: center; gap: 4px;
    height: 18px;
    font-size: 10px;
}
.dfv-spark-label {
    font-weight: 700; letter-spacing: 0.02em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dfv-spark-svg { width: 100%; height: 14px; display: block; border-radius: 3px;
    background: color-mix(in srgb, #fff 3%, transparent);
}
.dfv-spark-value {
    text-align: right; font-family: ui-monospace, 'SF Mono', monospace;
    font-weight: 700; font-size: 10px;
    font-variant-numeric: tabular-nums;
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
.dfv-svg .dfv-node--signal circle { transition: fill .18s, stroke .18s; }
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
    .dfv-stage { min-height: 240px; }
    .dfv-list--two-col { grid-template-columns: 1fr; }
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
