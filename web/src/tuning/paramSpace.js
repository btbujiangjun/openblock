/**
 * 寻参参数空间定义 + 归一化工具。
 *
 * 设计依据：docs/algorithms/SPAWN_AUTO_TUNING.md §4
 *
 * 设计取舍：
 *   - 14 维参数空间分两层: A 层 (UI 可调) + B 层 (PB 调制系数,代码硬编码移上来)
 *   - 类型分 3 种: float / int / choice (类别)
 *   - 归一化到 [0, 1] 用于 LHS / NN 输入; 反归一化用于实际 spawnEvaluation 调用
 */

/**
 * v1 参数空间 (14 维)。
 * 每项: { type, low, high }  或  { type: 'choice', choices: [...] }
 * 修改默认值需经评审 (会影响线上行为)。
 */
export const PARAM_SPACE_V1 = Object.freeze({
    // ── A. P2 模型参数 (5) - 已暴露在 spawn-eval UI ────────────────────
    personalizationStrength: Object.freeze({
        type: 'float', low: 0.05, high: 0.18, default: 0.10,
        desc: '根据玩家偏好向量微调四类预算; PB 前夕建议低',
    }),
    temperature: Object.freeze({
        type: 'float', low: 0.03, high: 0.08, default: 0.04,
        desc: '在 Top 合法组合中加入 softmax 受控随机',
    }),
    surpriseBudgetGain: Object.freeze({
        type: 'float', low: 0.05, high: 0.10, default: 0.08,
        desc: '低频惊喜事件倾向: 同花/清屏铺垫/品类变化',
    }),
    surpriseCooldown: Object.freeze({
        type: 'int', low: 4, high: 10, default: 6,
        desc: '惊喜预算冷却轮次; 越大越克制',
    }),
    maxEvaluatedTriplets: Object.freeze({
        type: 'choice', choices: [32, 48, 64, 80, 96, 128], default: 80,
        desc: 'P1/P2 每次出块最多扫描的三块组合数; 影响算力 vs 质量权衡',
    }),

    // ── B. spawnTargets PB 调制系数 (5) - 当前 adaptiveSpawn.js 硬编码 ──
    ssp_brakeCoef: Object.freeze({
        type: 'float', low: 0.08, high: 0.16, default: 0.12,
        desc: 'solutionSpacePressure 在 pbBrake 段的加成 (默认 0.12)',
    }),
    sp_tensionCoef: Object.freeze({
        type: 'float', low: 0.08, high: 0.16, default: 0.12,
        desc: 'spatialPressure 在 pbTension 段的加成',
    }),
    sp_brakeCoef: Object.freeze({
        type: 'float', low: 0.12, high: 0.20, default: 0.16,
        desc: 'spatialPressure 在 pbBrake 段的加成 (反膨胀主力)',
    }),
    payoff_brakeCoef: Object.freeze({
        type: 'float', low: 0.10, high: 0.22, default: 0.16,
        desc: 'payoffIntensity 在 pbBrake 段的衰减 (核心刹车)',
    }),
    clearOpp_brakeCoef: Object.freeze({
        type: 'float', low: 0.06, high: 0.14, default: 0.10,
        desc: 'clearOpportunity 在 pbBrake 段的衰减',
    }),

    // ── C. PB 曲线形状 (4) - v1.5 启用,v1 保持默认 ─────────────────────
    tensionCenter: Object.freeze({
        type: 'float', low: 0.78, high: 0.86, default: 0.82,
        desc: 'pbTension sigmoid 中心 (越小越早起拉力)',
    }),
    tensionSlope: Object.freeze({
        type: 'float', low: 0.06, high: 0.12, default: 0.08,
        desc: 'pbTension sigmoid 斜率 (越小越陡)',
    }),
    brakeCenter: Object.freeze({
        type: 'float', low: 1.02, high: 1.10, default: 1.05,
        desc: 'pbBrake sigmoid 中心 (越小越早刹车)',
    }),
    brakeSlope: Object.freeze({
        type: 'float', low: 0.04, high: 0.08, default: 0.06,
        desc: 'pbBrake sigmoid 斜率',
    }),
});

/**
 * 参数维度顺序 (用于 LHS / NN 输入向量的固定列序)。
 * 不要随意改顺序,否则旧 sample 数据会错位。
 */
export const PARAM_KEYS = Object.freeze(Object.keys(PARAM_SPACE_V1));

/**
 * 默认 θ - 所有维度取 default 值。
 */
export function defaultTheta() {
    const theta = {};
    for (const key of PARAM_KEYS) {
        theta[key] = PARAM_SPACE_V1[key].default;
    }
    return theta;
}

/**
 * 把单个参数值归一化到 [0, 1]。
 * - float: (v - low) / (high - low)
 * - int: 同 float
 * - choice: index / (choices.length - 1)
 *
 * @param {string} key
 * @param {number} value
 * @returns {number} ∈ [0, 1]
 */
export function normalizeParam(key, value) {
    const spec = PARAM_SPACE_V1[key];
    if (!spec) throw new Error(`unknown param: ${key}`);
    if (spec.type === 'choice') {
        const idx = spec.choices.indexOf(value);
        if (idx < 0) throw new Error(`invalid choice for ${key}: ${value}`);
        if (spec.choices.length <= 1) return 0;
        return idx / (spec.choices.length - 1);
    }
    if (spec.high === spec.low) return 0;
    return (Number(value) - spec.low) / (spec.high - spec.low);
}

/**
 * 把 [0, 1] 归一化值反归一化为实际参数值。
 *
 * @param {string} key
 * @param {number} u ∈ [0, 1]
 * @returns {number}
 */
export function denormalizeParam(key, u) {
    const spec = PARAM_SPACE_V1[key];
    if (!spec) throw new Error(`unknown param: ${key}`);
    const clamped = Math.max(0, Math.min(1, Number(u) || 0));
    if (spec.type === 'choice') {
        const idx = Math.round(clamped * (spec.choices.length - 1));
        return spec.choices[idx];
    }
    const value = spec.low + clamped * (spec.high - spec.low);
    if (spec.type === 'int') return Math.round(value);
    return value;
}

/**
 * 把整个 θ (key-value 对象) 归一化为 [0, 1]^14 向量。
 * 输出按 PARAM_KEYS 顺序。
 *
 * @param {object} theta
 * @returns {number[]}
 */
export function thetaToVector(theta) {
    return PARAM_KEYS.map((key) => normalizeParam(key, theta[key]));
}

/**
 * 把 [0, 1]^14 向量反归一化为 θ key-value 对象。
 *
 * @param {number[]} vector
 * @returns {object}
 */
export function vectorToTheta(vector) {
    if (!Array.isArray(vector) || vector.length !== PARAM_KEYS.length) {
        throw new Error(`vectorToTheta: expected length ${PARAM_KEYS.length}, got ${vector?.length}`);
    }
    const theta = {};
    PARAM_KEYS.forEach((key, i) => {
        theta[key] = denormalizeParam(key, vector[i]);
    });
    return theta;
}

/**
 * 验证 θ 所有字段都在合法区间内 (用于 sampleStore 写入前防御)。
 *
 * @param {object} theta
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateTheta(theta) {
    if (!theta || typeof theta !== 'object') {
        return { ok: false, errors: ['theta is not an object'] };
    }
    const errors = [];
    for (const key of PARAM_KEYS) {
        const spec = PARAM_SPACE_V1[key];
        const v = theta[key];
        if (v == null) {
            errors.push(`missing: ${key}`);
            continue;
        }
        if (spec.type === 'choice') {
            if (!spec.choices.includes(v)) {
                errors.push(`${key}=${v} not in choices [${spec.choices.join(',')}]`);
            }
        } else {
            const num = Number(v);
            if (!Number.isFinite(num)) {
                errors.push(`${key}=${v} not a finite number`);
            } else if (num < spec.low - 1e-9 || num > spec.high + 1e-9) {
                errors.push(`${key}=${num} outside [${spec.low}, ${spec.high}]`);
            } else if (spec.type === 'int' && Math.round(num) !== num) {
                errors.push(`${key}=${num} not an integer`);
            }
        }
    }
    return { ok: errors.length === 0, errors };
}

/**
 * 把归一化的 θ 投影到合法空间 (clamp + 离散值取整)。
 * 用于梯度上升 / NN 输出后的"投影回 box constraint"。
 *
 * @param {object} theta
 * @returns {object}
 */
export function projectToValidTheta(theta) {
    const out = {};
    for (const key of PARAM_KEYS) {
        const spec = PARAM_SPACE_V1[key];
        const raw = Number(theta[key]);
        if (spec.type === 'choice') {
            // 选最近的合法值
            const idx = Math.round(normalizeParam(key, spec.default) * (spec.choices.length - 1));
            let best = spec.choices[idx];
            let bestDist = Math.abs(raw - best);
            for (const c of spec.choices) {
                const d = Math.abs(raw - c);
                if (d < bestDist) {
                    best = c;
                    bestDist = d;
                }
            }
            out[key] = best;
        } else {
            const clamped = Math.max(spec.low, Math.min(spec.high, Number.isFinite(raw) ? raw : spec.default));
            out[key] = spec.type === 'int' ? Math.round(clamped) : clamped;
        }
    }
    return out;
}

/**
 * 参数空间维度数 (常量,但留接口便于扩展).
 */
export function getParamSpaceDim() {
    return PARAM_KEYS.length;
}
