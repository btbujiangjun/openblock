/**
 * 目标 S 曲线 — JS 版本 (与 Python target_curve.py 严格一致)。
 *
 * 用途:
 *   - 看板可视化对比 "目标 D(r) vs 模型预测"
 *   - B.3 详情区显示采样曲线相对目标偏离
 *
 * 跨语言一致性: 任何修改都要同步到 rl_pytorch/spawn_tuning_v2/target_curve.py
 *               + 对应测试 tests/spawn_tuning_v2/test_target_curve.py
 *                       + tests/tuning/v2/targetSCurve.test.js
 */

// ─────────── 常量 (与 Python 端 1:1 对应) ───────────
//
// v2.3: r_max 1.5→2.0; brake 段拓宽 + 端点重缩放 logistic; overshoot decay 加陡
//       目的: ① 视觉平滑 ② 让 r=1.5 时 D 接近 1.0
// v2.4: 低 r 阶段整体下移, 中段端点小幅下调, 保持早期更轻且整体单调平滑
// v2.5: 参考红线形态: 低 r 长平台 + 延后启动 + 接近 PB 前后快速上冲
// v2.6: 红线约束 r=1 时 D≈0.9, 且 r=1 两侧斜率陡峭

export const CURVE_N_BINS = 20;
export const CURVE_R_MAX = 2.0;

export const SEG_GENTLE_END = 0.45;
export const SEG_MID_END = 0.65;
export const SEG_BRAKE_END = 1.15;

export const D_BASE = 0.10;
export const D_GENTLE_END = 0.11;
export const D_MID_END = 0.18;
export const D_BRAKE_END = 0.98;
export const D_CAP = 1.00;

export const BRAKE_SIGMOID_K = 10.5;
export const OVERSHOOT_DECAY = 6.0;

// ─────────── v1.68（PR3）arc-aware 形变常量 ───────────
//
// 把"局间 RunOverRunArc"作为乘性形变层叠加在基线 S 曲线之上。每档 arc 给
// (dScale, dShift, brakeShift) 三元组：
//   dScale     ：基线 D 的乘性因子（≤1 整体压低）
//   dShift     ：在 dScale 之后的加性偏移
//   brakeShift ：brake 段拐点 r 的右移量（让"接近 PB 才感到压力"语义生效）
//
// 与 Python rl_pytorch/spawn_tuning_v2/target_curve.py 的 ARC_MODIFIERS 1:1 对齐；
// 任何修改必须同步更新两端 + 跨语言测试。

/** @typedef {'opener'|'momentum'|'peak'|'fatigue'|'cooldown'} RunOverRunArc */

export const ARC_MODIFIERS = Object.freeze({
    opener:   { dScale: 0.90, dShift:  0.00, brakeShift: 0.00 },
    momentum: { dScale: 1.00, dShift:  0.00, brakeShift: 0.00 },
    peak:     { dScale: 1.00, dShift:  0.00, brakeShift: 0.00 },
    fatigue:  { dScale: 0.85, dShift: -0.03, brakeShift: 0.15 },
    cooldown: { dScale: 0.75, dShift: -0.05, brakeShift: 0.20 },
});

const _IDENTITY_MOD = { dScale: 1, dShift: 0, brakeShift: 0 };

/**
 * 取出某档 arc 的修饰；未知 arc 返回恒等修饰（向后兼容）。
 * @param {RunOverRunArc|null|undefined} arc
 * @returns {{dScale:number, dShift:number, brakeShift:number}}
 */
export function getArcModifier(arc) {
    if (!arc) return _IDENTITY_MOD;
    return ARC_MODIFIERS[arc] || _IDENTITY_MOD;
}


function _brakeSmoothAt(r, midEnd, brakeEnd) {
    // 重缩放的 logistic sigmoid: 在 [midEnd, brakeEnd] 上端点严格 0/1
    const t = (r - midEnd) / (brakeEnd - midEnd);
    const k = BRAKE_SIGMOID_K;
    const raw = 1 / (1 + Math.exp(-k * (t - 0.5)));
    const s0 = 1 / (1 + Math.exp(k * 0.5));
    const s1 = 1 / (1 + Math.exp(-k * 0.5));
    return (raw - s0) / (s1 - s0);
}


/**
 * 基线 D 曲线（不带 arc 形变）；v1.68 之前为 targetSCurve 的唯一实现。
 * 内部为 arc-aware 版本提供"无 brakeShift"路径，避免每次调用都走完整管线。
 * @param {number} r
 * @returns {number}
 */
function _targetSCurveBase(r) {
    r = Math.max(0, Math.min(CURVE_R_MAX, Number(r) || 0));
    if (r < SEG_GENTLE_END) {
        const slope = (D_GENTLE_END - D_BASE) / SEG_GENTLE_END;
        return D_BASE + slope * r;
    }
    if (r < SEG_MID_END) {
        const slope = (D_MID_END - D_GENTLE_END) / (SEG_MID_END - SEG_GENTLE_END);
        return D_GENTLE_END + slope * (r - SEG_GENTLE_END);
    }
    if (r < SEG_BRAKE_END) {
        const s = _brakeSmoothAt(r, SEG_MID_END, SEG_BRAKE_END);
        return D_MID_END + s * (D_BRAKE_END - D_MID_END);
    }
    // 超越段: 指数收敛
    const extra = D_CAP - D_BRAKE_END;
    return D_BRAKE_END + extra * (1 - Math.exp(-OVERSHOOT_DECAY * (r - SEG_BRAKE_END)));
}


/**
 * 计算单点目标难度 D(r) ∈ [0, 1]。
 *
 * v1.68 保持完全的语义稳定：对原 targetSCurve(r) 的调用方完全透明，不会因
 * RunOverRunArc 注入而产生静默漂移；调用方需要 arc 行为时显式走 targetSCurveByArc。
 *
 * @param {number} r - 归一化进度 = score / PB
 * @returns {number} - 难度 ∈ [D_BASE, D_CAP]
 */
export function targetSCurve(r) {
    return _targetSCurveBase(r);
}


/**
 * v1.68 arc-aware 形变 D 曲线。
 *
 * 把基线 S 曲线套上 (dScale, dShift, brakeShift) 三参数：
 *   1. brakeShift 把 SEG_MID_END / SEG_BRAKE_END 同步右移，让 fatigue/cooldown
 *      下"接近 PB 才感到压力"语义生效；左侧 gentle 段端点保持不变，brake 段
 *      被压缩在更窄的 r 区间内，斜率自然变陡（与设计意图一致）。
 *   2. dScale 乘性压低输出（fatigue ×0.85 / cooldown ×0.75）。
 *   3. dShift 加性下移并最终 clip 到 [0, D_CAP]。
 *
 * 出现 brakeEnd > CURVE_R_MAX 时直接 clip 到 CURVE_R_MAX，并把 overshoot 起点
 * 平移到 brakeEnd（让顶部依旧收敛到 D_CAP·dScale + dShift）。
 *
 * 跨语言契约：与 Python target_curve.py 的 target_S_curve_by_arc 严格一致。
 *
 * @param {number} r
 * @param {RunOverRunArc|null|undefined} arc
 * @returns {number}
 */
export function targetSCurveByArc(r, arc) {
    const mod = getArcModifier(arc);
    if (mod === _IDENTITY_MOD || (mod.dScale === 1 && mod.dShift === 0 && mod.brakeShift === 0)) {
        return _targetSCurveBase(r);
    }
    r = Math.max(0, Math.min(CURVE_R_MAX, Number(r) || 0));
    const midEnd = Math.min(CURVE_R_MAX, SEG_MID_END + mod.brakeShift);
    const brakeEnd = Math.min(CURVE_R_MAX, SEG_BRAKE_END + mod.brakeShift);

    let d;
    if (r < SEG_GENTLE_END) {
        const slope = (D_GENTLE_END - D_BASE) / SEG_GENTLE_END;
        d = D_BASE + slope * r;
    } else if (r < midEnd) {
        const slope = (D_MID_END - D_GENTLE_END) / Math.max(1e-9, midEnd - SEG_GENTLE_END);
        d = D_GENTLE_END + slope * (r - SEG_GENTLE_END);
    } else if (r < brakeEnd) {
        const s = _brakeSmoothAt(r, midEnd, brakeEnd);
        d = D_MID_END + s * (D_BRAKE_END - D_MID_END);
    } else {
        const extra = D_CAP - D_BRAKE_END;
        d = D_BRAKE_END + extra * (1 - Math.exp(-OVERSHOOT_DECAY * (r - brakeEnd)));
    }
    /* 乘性 + 加性形变后 clip 到 [0, D_CAP]，保证下游消费端语义不变。 */
    const out = d * mod.dScale + mod.dShift;
    return Math.max(0, Math.min(D_CAP, out));
}


// ═════════════════════════════════════════════════════════════════════
// v3.2 多曲线 (multi-head): 难度 D 之外的爽感 E(r) 与挫败 F(r)。
// 与 Python rl_pytorch/spawn_tuning_v2/target_curve.py 的 target_E/F 1:1 对齐。
// ═════════════════════════════════════════════════════════════════════

export const E_BASE = 0.20;
export const E_PEAK = 0.40;
export const E_BUMP_CENTER = 1.00;
export const E_BUMP_WIDTH = 0.40;

export const F_BASE = 0.08;
export const F_RISE = 0.22;
export const F_CAP = 0.30;
export const F_RISE_START = 0.80;
export const F_RISE_END = 1.60;

function _smoothstep01(t) {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
}

/** 爽感目标 E(r) ∈ [E_BASE, E_PEAK]: 基线 + PB 处高斯凸起。 */
export function targetECurve(r) {
    r = Math.max(0, Math.min(CURVE_R_MAX, Number(r) || 0));
    const bump = Math.exp(-(((r - E_BUMP_CENTER) / E_BUMP_WIDTH) ** 2));
    return E_BASE + (E_PEAK - E_BASE) * bump;
}

/** 挫败目标 F(r) ∈ [F_BASE, F_CAP]: 低基线 + 缓升, 硬 clip 到 cap。 */
export function targetFCurve(r) {
    r = Math.max(0, Math.min(CURVE_R_MAX, Number(r) || 0));
    const t = (r - F_RISE_START) / Math.max(1e-9, F_RISE_END - F_RISE_START);
    return Math.min(F_CAP, F_BASE + F_RISE * _smoothstep01(t));
}

/** E(r) 离散化为目标向量 (bin 中点取值)。 */
export function targetEVector(nBins = CURVE_N_BINS, rMax = CURVE_R_MAX) {
    const width = rMax / nBins;
    const out = new Array(nBins);
    for (let i = 0; i < nBins; i++) out[i] = targetECurve((i + 0.5) * width);
    return out;
}

/** F(r) 离散化为目标向量 (bin 中点取值)。 */
export function targetFVector(nBins = CURVE_N_BINS, rMax = CURVE_R_MAX) {
    const width = rMax / nBins;
    const out = new Array(nBins);
    for (let i = 0; i < nBins; i++) out[i] = targetFCurve((i + 0.5) * width);
    return out;
}


/**
 * 返回 d_curve 离散化后的目标向量。
 * @param {number} [nBins=20]
 * @param {number} [rMax=2.0]
 * @returns {number[]}
 */
export function targetCurveVector(nBins = CURVE_N_BINS, rMax = CURVE_R_MAX) {
    if (nBins <= 0) throw new Error('nBins must be positive');
    const width = rMax / nBins;
    const out = new Array(nBins);
    for (let i = 0; i < nBins; i++) {
        out[i] = targetSCurve((i + 0.5) * width);
    }
    return out;
}


/**
 * r → bin index 映射 ([0, nBins-1])。
 */
export function rToBin(r, nBins = CURVE_N_BINS, rMax = CURVE_R_MAX) {
    r = Math.max(0, Number(r) || 0);
    const width = rMax / nBins;
    const idx = Math.floor(r / width);
    return Math.min(idx, nBins - 1);
}


/**
 * 验证单调非降。
 */
export function isMonotonicNonDecreasing(curve, tol = 1e-6) {
    for (let i = 1; i < curve.length; i++) {
        if (curve[i] < curve[i - 1] - tol) return false;
    }
    return true;
}


/**
 * 元信息 (用于 dashboard / 调试)。
 */
export function getTargetMetadata() {
    return {
        version: 'v2.6.0',
        n_bins: CURVE_N_BINS,
        r_max: CURVE_R_MAX,
        segments: [
            { name: 'gentle', r_range: [0.0, SEG_GENTLE_END], d_range: [D_BASE, D_GENTLE_END] },
            { name: 'mid', r_range: [SEG_GENTLE_END, SEG_MID_END], d_range: [D_GENTLE_END, D_MID_END] },
            { name: 'brake', r_range: [SEG_MID_END, SEG_BRAKE_END], d_range: [D_MID_END, D_BRAKE_END] },
            { name: 'overshoot', r_range: [SEG_BRAKE_END, CURVE_R_MAX], d_range: [D_BRAKE_END, D_CAP] },
        ],
    };
}
