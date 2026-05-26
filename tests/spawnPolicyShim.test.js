/**
 * SpawnPolicy / SpawnParam 角色化入口 thin re-export shim 烟雾测试。
 *
 * 验证：
 *   - web/src/spawnPolicyNet.js                  → 转发 web/src/spawnModel.js
 *   - web/src/bot/spawnPolicyExperiments.js      → 转发 web/src/bot/spawnExperiments.js
 *
 * 详见 docs/algorithms/SPAWN_OVERVIEW.md 与本仓库 PR 链路 PR-3。
 */
import { describe, it, expect } from 'vitest';

import * as net from '../web/src/spawnPolicyNet.js';
import * as netOrig from '../web/src/spawnModel.js';
import * as exp from '../web/src/bot/spawnPolicyExperiments.js';
import * as expOrig from '../web/src/bot/spawnExperiments.js';

describe('SpawnPolicyNet shim (web/src/spawnPolicyNet.js)', () => {
    it('角色化函数可用', () => {
        expect(typeof net.getSpawnPolicyMode).toBe('function');
        expect(typeof net.setSpawnPolicyMode).toBe('function');
    });

    it('模式字符串常量稳定（localStorage 持久化契约）', () => {
        expect(net.SPAWN_MODE_RULE).toBe('rule');
        expect(net.SPAWN_MODE_MODEL_V3).toBe('model-v3');
    });

    it('旧名称 alias 仍可用（向后兼容）', () => {
        expect(typeof net.getSpawnMode).toBe('function');
        expect(typeof net.setSpawnMode).toBe('function');
    });

    it('shim 与权威实现指向同一对象', () => {
        expect(net.getSpawnMode).toBe(netOrig.getSpawnMode);
        expect(net.SHAPE_VOCAB).toBe(netOrig.SHAPE_VOCAB);
        expect(net.SHAPE_VOCAB).toHaveLength(40);
    });
});

describe('SpawnPolicyRules experiments shim (web/src/bot/spawnPolicyExperiments.js)', () => {
    it('角色化常量值与字符串契约一致', () => {
        expect(exp.SPAWN_POLICY_RULES).toBe('baseline');
        expect(exp.SPAWN_POLICY_RULES_P1).toBe('triplet-p1');
        expect(exp.SPAWN_POLICY_RULES_P2).toBe('budget-p2');
        expect(exp.SPAWN_POLICY_RULES_MODES).toEqual([
            'baseline',
            'triplet-p1',
            'budget-p2',
        ]);
    });

    it('旧名称 alias 仍可用（向后兼容）', () => {
        expect(exp.SPAWN_GENERATOR_BASELINE).toBe('baseline');
        expect(exp.SPAWN_GENERATOR_TRIPLET_P1).toBe('triplet-p1');
        expect(exp.SPAWN_GENERATOR_BUDGET_P2).toBe('budget-p2');
    });

    it('shim 与权威实现指向同一对象', () => {
        expect(exp.SPAWN_GENERATOR_BASELINE).toBe(expOrig.SPAWN_GENERATOR_BASELINE);
        expect(exp.SPAWN_GENERATOR_MODES).toBe(expOrig.SPAWN_GENERATOR_MODES);
    });
});
