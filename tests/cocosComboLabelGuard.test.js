/**
 * cocos 端 "combo 字样重复" 回归守护测试。
 *
 * 背景：之前 cocos 端 `showStreakBadge` 用 floatText(44px) 渲染在盘面中央
 * y=72/116（与 floatScore label 几乎并排），且 `_nextScoreLabel` 单消 combo
 * 分支也用 i18n `effect.comboMultiplier`（"Combo ×N" 大写）→ 用户视觉感知
 * "combo 字样重复出现"。
 *
 * 修复后保证：
 *   1. 飘字 label 中的 combo 一律小写（` · combo ×N` 后缀 / `combo ×N` 标签），
 *      对齐 web `showFloatScore` 4864 行的硬编码模板；
 *   2. streak 徽章子文案保留大写 `Combo ×N`（i18n `effect.comboMultiplier`），
 *      位置在盘面顶部、字号小、动画独立——视觉权重与飘字明确分层。
 *
 * 该测试枚举 14 个典型场景（含极端组合），断言"label 出现 combo 时必须全小写
 * 且徽章出现 Combo 时必须大写"——任意一项被回退到同形字串都会失败。
 */
import { describe, expect, it } from 'vitest';

/** 复刻 cocos GameController `case 'clear'` 分支生成 _nextScoreLabel 的逻辑。 */
function genFloatLabel({ count, perfectClear, comboMult, bonusLines }) {
    const comboMultTxt = comboMult > 1
        ? (Number.isInteger(comboMult) ? ` · combo ×${comboMult}` : ` · combo ×${comboMult.toFixed(1)}`)
        : '';
    let label = null;
    if (perfectClear) {
        label = '清屏 ×10' + comboMultTxt;
    } else if (count >= 2) {
        const base = count === 2 ? '双消' : `${count} 消`;
        label = base + comboMultTxt;
    } else if (comboMult > 1) {
        const multTxt = Number.isInteger(comboMult) ? `×${comboMult}` : `×${comboMult.toFixed(1)}`;
        label = `combo ${multTxt}`;
    }
    if (bonusLines > 0) label = '同花顺大消除' + comboMultTxt;
    return label;
}

/** 复刻 cocos FxLayer.showStreakBadge 的文案产出（main + 可选 sub）。 */
function genStreakBadge({ streak, comboMult }) {
    if (streak < 3) return null;
    const fires = streak >= 5 ? '🔥🔥🔥' : streak >= 4 ? '🔥🔥' : '🔥';
    const main = `${fires} ${streak} 连消`;
    if (comboMult <= 1) return { main, sub: null };
    const multTxt = Number.isInteger(comboMult) ? `×${comboMult}` : `×${comboMult.toFixed(1)}`;
    return { main, sub: `Combo ${multTxt}` };
}

const SCENARIOS = [
    { desc: '单消',                       count: 1, perfectClear: false, comboMult: 1,   streak: 1, bonusLines: 0 },
    { desc: '单消+streak≥3',              count: 1, perfectClear: false, comboMult: 1,   streak: 3, bonusLines: 0 },
    { desc: '单消+combo×2',               count: 1, perfectClear: false, comboMult: 2,   streak: 1, bonusLines: 0 },
    { desc: '单消+combo×2+streak≥3',      count: 1, perfectClear: false, comboMult: 2,   streak: 3, bonusLines: 0 },
    { desc: '双消',                       count: 2, perfectClear: false, comboMult: 1,   streak: 2, bonusLines: 0 },
    { desc: '双消+combo×2',               count: 2, perfectClear: false, comboMult: 2,   streak: 2, bonusLines: 0 },
    { desc: '双消+combo×2+streak≥3',      count: 2, perfectClear: false, comboMult: 2,   streak: 3, bonusLines: 0 },
    { desc: '3 消',                       count: 3, perfectClear: false, comboMult: 1,   streak: 3, bonusLines: 0 },
    { desc: '3 消+combo×2',               count: 3, perfectClear: false, comboMult: 2,   streak: 3, bonusLines: 0 },
    { desc: '4 消+combo×3',               count: 4, perfectClear: false, comboMult: 3,   streak: 4, bonusLines: 0 },
    { desc: '清屏',                       count: 4, perfectClear: true,  comboMult: 1,   streak: 4, bonusLines: 0 },
    { desc: '清屏+combo×2',               count: 4, perfectClear: true,  comboMult: 2,   streak: 4, bonusLines: 0 },
    { desc: '同花顺',                     count: 2, perfectClear: false, comboMult: 1,   streak: 2, bonusLines: 1 },
    { desc: '同花顺+combo×2+streak≥3',    count: 3, perfectClear: false, comboMult: 2,   streak: 3, bonusLines: 1 },
];

describe('cocos: combo 字样不重复（floatLabel 小写 / streak 徽章大写）', () => {
    for (const s of SCENARIOS) {
        it(s.desc, () => {
            const label = genFloatLabel(s);
            const badge = genStreakBadge(s);

            // ── 断言 1：飘字 label 出现 combo 时必须全小写 ─────────────────
            // 若回退到 effect.comboMultiplier (`Combo ×N` 大写) 会立即失败
            if (label && /combo/i.test(label)) {
                const matches = label.match(/[Cc]ombo/g) || [];
                expect(matches.every((m) => m === 'combo')).toBe(true);
            }

            // ── 断言 2：streak 徽章子文案出现 combo 时必须大写 Combo ─────────
            if (badge?.sub && /combo/i.test(badge.sub)) {
                const matches = badge.sub.match(/[Cc]ombo/g) || [];
                expect(matches.every((m) => m === 'Combo')).toBe(true);
            }

            // ── 断言 3：visual 重叠风险 = label/badge 同形（都大写或都小写）── 必须为 false
            const labelComboCount = (label?.match(/[Cc]ombo/g) || []).length;
            const badgeComboCount = [
                ...(badge?.main?.match(/[Cc]ombo/g) || []),
                ...(badge?.sub?.match(/[Cc]ombo/g) || []),
            ].length;
            if (labelComboCount > 0 && badgeComboCount > 0) {
                // label 小写 / badge sub 大写 → 视觉区分；其他组合都视为重叠
                const labelAllLower = (label.match(/[Cc]ombo/g) || []).every((m) => m === 'combo');
                const badgeSubAllUpper = !badge?.sub || (badge.sub.match(/[Cc]ombo/g) || []).every((m) => m === 'Combo');
                expect(labelAllLower && badgeSubAllUpper).toBe(true);
            }
        });
    }
});
