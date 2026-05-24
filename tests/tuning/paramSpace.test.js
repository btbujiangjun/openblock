/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
    PARAM_SPACE_V1,
    PARAM_KEYS,
    defaultTheta,
    normalizeParam,
    denormalizeParam,
    thetaToVector,
    vectorToTheta,
    validateTheta,
    projectToValidTheta,
    getParamSpaceDim,
} from '../../web/src/tuning/paramSpace.js';

describe('paramSpace — 空间定义', () => {
    it('维度数为 14', () => {
        expect(getParamSpaceDim()).toBe(14);
        expect(PARAM_KEYS).toHaveLength(14);
    });

    it('所有参数都有 type / default', () => {
        for (const key of PARAM_KEYS) {
            const spec = PARAM_SPACE_V1[key];
            expect(spec).toHaveProperty('type');
            expect(spec).toHaveProperty('default');
            expect(['float', 'int', 'choice']).toContain(spec.type);
        }
    });

    it('default 值在合法区间内', () => {
        for (const key of PARAM_KEYS) {
            const spec = PARAM_SPACE_V1[key];
            if (spec.type === 'choice') {
                expect(spec.choices).toContain(spec.default);
            } else {
                expect(spec.default).toBeGreaterThanOrEqual(spec.low);
                expect(spec.default).toBeLessThanOrEqual(spec.high);
            }
        }
    });

    it('defaultTheta 返回所有 14 个字段', () => {
        const theta = defaultTheta();
        expect(Object.keys(theta).sort()).toEqual(PARAM_KEYS.slice().sort());
    });
});

describe('paramSpace — 归一化', () => {
    it('low 边界 → 0', () => {
        expect(normalizeParam('personalizationStrength', 0.05)).toBe(0);
        expect(normalizeParam('surpriseCooldown', 4)).toBe(0);
    });

    it('high 边界 → 1', () => {
        expect(normalizeParam('personalizationStrength', 0.18)).toBe(1);
        expect(normalizeParam('surpriseCooldown', 10)).toBe(1);
    });

    it('中点 → ~0.5', () => {
        expect(normalizeParam('personalizationStrength', 0.115)).toBeCloseTo(0.5, 5);
    });

    it('choice 类型: 索引映射', () => {
        // maxEvaluatedTriplets choices=[32, 48, 64, 80, 96, 128] (6 个)
        expect(normalizeParam('maxEvaluatedTriplets', 32)).toBe(0);
        expect(normalizeParam('maxEvaluatedTriplets', 128)).toBe(1);
        expect(normalizeParam('maxEvaluatedTriplets', 64)).toBeCloseTo(2 / 5, 5);
        expect(normalizeParam('maxEvaluatedTriplets', 80)).toBeCloseTo(3 / 5, 5);
    });

    it('未知 key 抛错', () => {
        expect(() => normalizeParam('unknownParam', 0.5)).toThrow();
    });

    it('choice 类型非法值抛错', () => {
        expect(() => normalizeParam('maxEvaluatedTriplets', 100)).toThrow();
    });
});

describe('paramSpace — 反归一化', () => {
    it('0 → low', () => {
        expect(denormalizeParam('personalizationStrength', 0)).toBeCloseTo(0.05, 6);
    });

    it('1 → high', () => {
        expect(denormalizeParam('personalizationStrength', 1)).toBeCloseTo(0.18, 6);
    });

    it('钳制 [0, 1] 外的输入', () => {
        expect(denormalizeParam('personalizationStrength', -0.5)).toBeCloseTo(0.05, 6);
        expect(denormalizeParam('personalizationStrength', 1.5)).toBeCloseTo(0.18, 6);
    });

    it('int 类型: 输出整数', () => {
        const v = denormalizeParam('surpriseCooldown', 0.5);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(4);
        expect(v).toBeLessThanOrEqual(10);
    });

    it('choice 类型: 输出离散选项', () => {
        const v = denormalizeParam('maxEvaluatedTriplets', 0.3);
        expect([32, 48, 64, 80, 96, 128]).toContain(v);
    });

    it('归一化-反归一化往返误差小', () => {
        for (const key of PARAM_KEYS) {
            const spec = PARAM_SPACE_V1[key];
            if (spec.type === 'choice') {
                for (const choice of spec.choices) {
                    const u = normalizeParam(key, choice);
                    expect(denormalizeParam(key, u)).toBe(choice);
                }
            } else {
                const samples = [spec.low, spec.high, spec.default];
                for (const v of samples) {
                    const u = normalizeParam(key, v);
                    const back = denormalizeParam(key, u);
                    if (spec.type === 'int') {
                        expect(back).toBe(Math.round(v));
                    } else {
                        expect(back).toBeCloseTo(v, 6);
                    }
                }
            }
        }
    });
});

describe('paramSpace — 向量转换', () => {
    it('thetaToVector 输出长度为 14', () => {
        const theta = defaultTheta();
        const v = thetaToVector(theta);
        expect(v).toHaveLength(14);
        for (const x of v) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(1);
        }
    });

    it('vectorToTheta 是 thetaToVector 的逆', () => {
        const theta = defaultTheta();
        const v = thetaToVector(theta);
        const back = vectorToTheta(v);
        for (const key of PARAM_KEYS) {
            const spec = PARAM_SPACE_V1[key];
            if (spec.type === 'int' || spec.type === 'choice') {
                expect(back[key]).toBe(theta[key]);
            } else {
                expect(back[key]).toBeCloseTo(theta[key], 5);
            }
        }
    });

    it('vectorToTheta 拒绝错误长度', () => {
        expect(() => vectorToTheta([0.1, 0.2])).toThrow();
    });
});

describe('paramSpace — validateTheta', () => {
    it('default theta 通过', () => {
        const r = validateTheta(defaultTheta());
        expect(r.ok).toBe(true);
        expect(r.errors).toHaveLength(0);
    });

    it('缺失字段', () => {
        const theta = defaultTheta();
        delete theta.temperature;
        const r = validateTheta(theta);
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('temperature'))).toBe(true);
    });

    it('越界值', () => {
        const theta = { ...defaultTheta(), personalizationStrength: 0.5 };
        const r = validateTheta(theta);
        expect(r.ok).toBe(false);
        expect(r.errors.some((e) => e.includes('personalizationStrength'))).toBe(true);
    });

    it('int 字段非整数', () => {
        const theta = { ...defaultTheta(), surpriseCooldown: 5.7 };
        const r = validateTheta(theta);
        expect(r.ok).toBe(false);
    });

    it('choice 字段非法值', () => {
        const theta = { ...defaultTheta(), maxEvaluatedTriplets: 50 };  // 50 不在 choices
        const r = validateTheta(theta);
        expect(r.ok).toBe(false);
    });

    it('null / 非对象', () => {
        expect(validateTheta(null).ok).toBe(false);
        expect(validateTheta(undefined).ok).toBe(false);
        expect(validateTheta('hello').ok).toBe(false);
    });
});

describe('paramSpace — projectToValidTheta', () => {
    it('合法 theta 不变', () => {
        const theta = defaultTheta();
        expect(projectToValidTheta(theta)).toEqual(theta);
    });

    it('越界值被钳到边界', () => {
        const theta = { ...defaultTheta(), personalizationStrength: 0.5, temperature: -0.1 };
        const projected = projectToValidTheta(theta);
        expect(projected.personalizationStrength).toBe(0.18);
        expect(projected.temperature).toBe(0.03);
    });

    it('choice 字段投影到最近合法值', () => {
        const theta = { ...defaultTheta(), maxEvaluatedTriplets: 50 };
        const projected = projectToValidTheta(theta);
        expect([32, 48, 64, 80, 96, 128]).toContain(projected.maxEvaluatedTriplets);
        expect(projected.maxEvaluatedTriplets).toBe(48); // 50 最近的合法值
    });

    it('NaN / undefined 投影到 default', () => {
        const theta = { ...defaultTheta(), personalizationStrength: NaN };
        const projected = projectToValidTheta(theta);
        expect(projected.personalizationStrength).toBe(0.10);  // default
    });

    it('投影后 validateTheta 通过', () => {
        const messy = {
            personalizationStrength: 999,
            temperature: -5,
            surpriseBudgetGain: 0.07,
            surpriseCooldown: 5.7,
            maxEvaluatedTriplets: 100,  // 100 不在 choices,会被投影到 96
            ssp_brakeCoef: 0.10,
            sp_tensionCoef: 0.10,
            sp_brakeCoef: 0.15,
            payoff_brakeCoef: 0.15,
            clearOpp_brakeCoef: 0.10,
            tensionCenter: 0.82,
            tensionSlope: 0.08,
            brakeCenter: 1.05,
            brakeSlope: 0.06,
        };
        const projected = projectToValidTheta(messy);
        expect(validateTheta(projected).ok).toBe(true);
    });
});
