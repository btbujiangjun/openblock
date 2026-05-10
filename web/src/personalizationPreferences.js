/**
 * 全球化个性化偏好边界。
 *
 * 只保存用户明示开关，不保存年龄、性别、种族、宗教、健康、收入、精确位置等敏感属性。
 * 策略层可读取这些开关决定是否消费行为画像；地区/语言只能作为聚合实验上下文。
 */

const STORAGE_KEY = 'openblock_personalization_prefs_v1';

export const DEFAULT_PERSONALIZATION_PREFS = Object.freeze({
    enabled: true,
    difficulty: true,
    hints: true,
    visuals: true,
    ads: false,
    explain: true,
});

export function loadPersonalizationPreferences() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return { ...DEFAULT_PERSONALIZATION_PREFS };
        const parsed = JSON.parse(raw);
        return sanitizePersonalizationPreferences(parsed);
    } catch {
        return { ...DEFAULT_PERSONALIZATION_PREFS };
    }
}

export function savePersonalizationPreferences(prefs) {
    const clean = sanitizePersonalizationPreferences(prefs);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
    } catch { /* private mode */ }
    return clean;
}

export function sanitizePersonalizationPreferences(prefs = {}) {
    const clean = { ...DEFAULT_PERSONALIZATION_PREFS };
    for (const key of Object.keys(clean)) {
        if (typeof prefs[key] === 'boolean') clean[key] = prefs[key];
    }
    return clean;
}

export function personalizationDataBoundary() {
    return {
        allowedForPersonalization: [
            '实时行为',
            '明示偏好',
            '设备性能',
            '语言/地区设置',
        ],
        researchOnly: [
            '年龄段',
            '性别',
            '国家/地区',
            '文化背景',
            '支付区间',
        ],
        neverUseForIndividualTargeting: [
            '种族',
            '民族',
            '宗教',
            '健康',
            '未成年人状态',
            '精确位置',
            '收入推断',
        ],
    };
}
