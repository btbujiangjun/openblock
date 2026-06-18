/**
 * @vitest-environment jsdom
 *
 * spawnBudget 配置化（重构方案阶段 5.1）：
 *   shared/game_rules.json::spawnBudget 已抽取 8 个出块预算/relief 常量；
 *   源码用 `JSON.x ?? 历史默认` 兜底，保证 JSON 段缺失时行为不变。
 *
 * 本测试锁定两件事：
 *   1. 当前 game_rules.json 的 spawnBudget 值与"历史硬默认"逐字段一致
 *      → 切换到 JSON 驱动后不会引入悄无声息的数值漂移。
 *   2. 三个被导出消费的 relief 常量等于 JSON 中的对应值。
 */
import { describe, it, expect } from 'vitest';
import { GAME_RULES } from '../web/src/gameRules.js';
import {
    RELIEF_FILL_FLOOR_URGENT,
    RELIEF_FILL_FLOOR_MILD,
    RELIEF_HOLE_FILL_MIN,
} from '../web/src/bot/blockSpawn.js';

describe('spawnBudget 配置抽取（零行为变化保证）', () => {
    const sb = GAME_RULES.spawnBudget;

    it('shared/game_rules.json 含 spawnBudget 段', () => {
        expect(sb).toBeTypeOf('object');
        expect(sb).not.toBeNull();
    });

    it('JSON 中的预算字段等于历史硬默认值（防漂移）', () => {
        expect(sb.maxSpawnAttempts).toBe(22);
        expect(sb.fillSurvivabilityOn).toBe(0.52);
        expect(sb.surviveSearchBudget).toBe(14000);
        expect(sb.criticalFill).toBe(0.68);
        expect(sb.solutionLeafCapDefault).toBe(64);
        expect(sb.solutionBudgetDefault).toBe(8000);
        expect(sb.solutionFilterAttemptRatio).toBe(0.6);
        expect(sb.reliefFillFloorUrgent).toBe(0.25);
        expect(sb.reliefFillFloorMild).toBe(0.35);
        expect(sb.reliefHoleFillMin).toBe(2);
    });

    it('导出的 relief 常量等于 JSON 驱动值', () => {
        expect(RELIEF_FILL_FLOOR_URGENT).toBe(sb.reliefFillFloorUrgent);
        expect(RELIEF_FILL_FLOOR_MILD).toBe(sb.reliefFillFloorMild);
        expect(RELIEF_HOLE_FILL_MIN).toBe(sb.reliefHoleFillMin);
    });
});
