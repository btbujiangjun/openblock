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


function _brakeSmooth(r) {
    // 重缩放的 logistic sigmoid: 在 [SEG_MID_END, SEG_BRAKE_END] 上端点严格 0/1
    const t = (r - SEG_MID_END) / (SEG_BRAKE_END - SEG_MID_END);
    const k = BRAKE_SIGMOID_K;
    const raw = 1 / (1 + Math.exp(-k * (t - 0.5)));
    const s0 = 1 / (1 + Math.exp(k * 0.5));
    const s1 = 1 / (1 + Math.exp(-k * 0.5));
    return (raw - s0) / (s1 - s0);
}


/**
 * 计算单点目标难度 D(r) ∈ [0, 1]。
 * @param {number} r - 归一化进度 = score / PB
 * @returns {number} - 难度 ∈ [D_BASE, D_CAP]
 */
export function targetSCurve(r) {
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
        const s = _brakeSmooth(r);
        return D_MID_END + s * (D_BRAKE_END - D_MID_END);
    }
    // 超越段: 指数收敛
    const extra = D_CAP - D_BRAKE_END;
    return D_BRAKE_END + extra * (1 - Math.exp(-OVERSHOOT_DECAY * (r - SEG_BRAKE_END)));
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
