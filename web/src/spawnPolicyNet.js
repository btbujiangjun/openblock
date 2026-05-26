/**
 * SpawnPolicyNet 角色化入口（thin re-export shim）。
 *
 * 本文件作为 ./spawnModel.js 的角色化别名出口，让命名规范
 * （详见 docs/algorithms/SPAWN_OVERVIEW.md）贯通到 import 路径层。
 *
 * 权威实现仍在 ./spawnModel.js；新代码请优先用本文件路径：
 *
 *   import { SpawnPolicyNet, getSpawnPolicyMode, setSpawnPolicyMode } from './spawnPolicyNet.js';  // ✅ 推荐
 *
 * 旧路径（继续可用，向后兼容）：
 *
 *   import { getSpawnMode, setSpawnMode } from './spawnModel.js';                                  // ⚠ 旧路径
 *
 * 当外部引用全部切换到本文件后，./spawnModel.js 可降级为内部实现私有模块。
 * 当前阶段两条路径并存，无任何行为差异。
 */
export * from './spawnModel.js';
