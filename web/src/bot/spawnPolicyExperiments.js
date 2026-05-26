/**
 * SpawnPolicyRules 实验轨角色化入口（thin re-export shim）。
 *
 * 本文件作为 ./spawnExperiments.js 的角色化别名出口，让命名规范
 * （详见 docs/algorithms/SPAWN_OVERVIEW.md）贯通到 import 路径层。
 *
 * 权威实现仍在 ./spawnExperiments.js；新代码请优先用本文件路径：
 *
 *   import { SPAWN_POLICY_RULES, SPAWN_POLICY_RULES_P1, SPAWN_POLICY_RULES_P2 } from './spawnPolicyExperiments.js';  // ✅ 推荐
 *
 * 旧路径（继续可用，向后兼容）：
 *
 *   import { SPAWN_GENERATOR_BASELINE, SPAWN_GENERATOR_TRIPLET_P1 } from './spawnExperiments.js';                    // ⚠ 旧路径
 *
 * 注：字符串字面值（'baseline' / 'triplet-p1' / 'budget-p2'）是 DB / 评估输出契约，
 * 不在本次命名升级范围内，永远保持。
 */
export * from './spawnExperiments.js';
