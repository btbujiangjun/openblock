/**
 * RL / 模型出块接缝（Phase P2）。
 *
 * 默认不启用（flag rlSpawn=false）→ 走与 web 同源的规则引擎 generateDockShapes。
 * 注入 SpawnPolicy 且开启 rlSpawn 时，引擎出块前先让策略决定一份候选；返回 null 则回退引擎。
 * 另提供 SpawnContextProvider：把玩家画像（skill/momentum/frustration 等）合并进 spawnContext，
 * 实现 web `game.js._spawnContext` 的逐步下沉，无需改动 engineSpawn 调用方。
 */
import { Grid } from './grid';
import { DockBlock } from './types';

export type SpawnPolicy = (grid: Grid, ctx: Record<string, unknown>) => DockBlock[] | null;
export type SpawnContextProvider = () => Record<string, unknown>;

let _policy: SpawnPolicy | null = null;
let _ctxProvider: SpawnContextProvider | null = null;

export function setSpawnModel(policy: SpawnPolicy | null): void {
    _policy = policy;
}

export function getSpawnModel(): SpawnPolicy | null {
    return _policy;
}

export function setSpawnContextProvider(fn: SpawnContextProvider | null): void {
    _ctxProvider = fn;
}

export function getSpawnContextExtra(): Record<string, unknown> {
    if (!_ctxProvider) return {};
    try { return _ctxProvider() || {}; } catch { return {}; }
}
