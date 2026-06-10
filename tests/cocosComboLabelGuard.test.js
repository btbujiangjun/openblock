/**
 * cocos 端 "combo 字样重复" 回归守护测试。
 *
 * 背景（迭代 2）：
 *   v1 修复把 cocos 飘字 label 统一改成小写 `· combo ×N`、streak 徽章保留大写 `Combo ×N`，
 *   字号一大一小、位置一上一中，意图靠"字号 + 锚位"区分。线上反馈：当前 combo 规则
 *   `activationCount=3 / stepBonus=1 / maxMultiplier=2` 决定一旦触发倍数就**封顶 ×2**，
 *   于是同一次消行同时出现：
 *     - 盘面中央飘字 label：`双消 · combo ×2`（小字）
 *     - 盘面顶部徽章子文：`Combo ×2`（大字）
 *   用户感知为"消行动效大小两份 combo，且永远 ×2"。
 *
 * 当前策略（v2）：
 *   - 飘字 label **完全不含 combo 字样**（保留消行档位文案：`双消 / N 消 / 清屏 ×10 /
 *     同花顺大消除`），单消 + comboMult>1 也不再以 `combo ×N` 作为 label —— 飘字侧
 *     此时只显示 `+N`，combo 状态完全交给 HUD 心形 + 顶部徽章表达。
 *   - streak 徽章（≥3 连且 comboMult>1）保留大写 `Combo ×N` 子文案 —— 是 combo 倍数
 *     在画面上的唯一文字呈现，与飘字字面零重叠。
 *
 * 该测试枚举 14 个典型场景（含极端组合），断言：
 *   1. 飘字 label **永远不出现** `combo` 字样（大写小写皆禁止）；
 *   2. streak 徽章子文案出现 combo 时必须大写 `Combo`；
 *   3. 飘字 label 与徽章不会同时出现 combo 字样（飘字侧应为 0 次）。
 */
import { describe, expect, it } from 'vitest';

/** 复刻 cocos GameController `case 'clear'` 分支生成 _nextScoreLabel 的逻辑（v2）。 */
function genFloatLabel({ count, perfectClear, bonusLines }) {
    let label = null;
    if (perfectClear) {
        label = '清屏 ×10';
    } else if (count >= 2) {
        label = count === 2 ? '双消' : `${count} 消`;
    }
    // 单消 + comboMult>1：v2 不再生成 label（飘字只剩 +N，combo 由徽章/HUD 表达）。
    if (bonusLines > 0) label = '同花顺大消除';
    return label;
}

/** 复刻 cocos FxLayer.showStreakBadge 的文案产出（main + 可选 sub）。
 *  v1.66+：倍数格式统一为 `N×`（数字在前 × 在后），i18n 模板 `effect.comboMultiplier`
 *  形如 `Combo {mult}×`，调用方只传数字。全端（web/cocos/miniprogram）同口径。 */
function genStreakBadge({ streak, comboMult }) {
    if (streak < 3) return null;
    const fires = streak >= 5 ? '🔥🔥🔥' : streak >= 4 ? '🔥🔥' : '🔥';
    const main = `${fires} ${streak} 连消`;
    if (comboMult <= 1) return { main, sub: null };
    const multTxt = Number.isInteger(comboMult) ? `${comboMult}` : comboMult.toFixed(1);
    return { main, sub: `Combo ${multTxt}×` };
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

describe('cocos: combo 字样不重复（飘字 label 不含 combo / 徽章独占 Combo ×N）', () => {
    for (const s of SCENARIOS) {
        it(s.desc, () => {
            const label = genFloatLabel(s);
            const badge = genStreakBadge(s);

            // ── 断言 1：飘字 label 永远不含 combo 字样（大小写皆禁止）─────────────
            if (label) {
                expect(/combo/i.test(label)).toBe(false);
            }

            // ── 断言 2：streak 徽章子文案出现 combo 时必须大写 Combo ─────────
            if (badge?.sub && /combo/i.test(badge.sub)) {
                const matches = badge.sub.match(/[Cc]ombo/g) || [];
                expect(matches.every((m) => m === 'Combo')).toBe(true);
            }

            // ── 断言 3：飘字与徽章不同时出现 combo 字样（飘字侧必须为 0）──────
            const labelComboCount = (label?.match(/[Cc]ombo/g) || []).length;
            expect(labelComboCount).toBe(0);
        });
    }
});
