/* 自动生成 —— 请勿手改。源：web/src/config.js（精简：去浏览器耦合，仅保留引擎所需）
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */
import { buildDefaultStrategiesMap } from './gameRules.mjs';

const DEFAULT_STRATEGIES = buildDefaultStrategiesMap();
export const STRATEGIES = DEFAULT_STRATEGIES;
export function getStrategy(id) {
    return DEFAULT_STRATEGIES[id] || DEFAULT_STRATEGIES.normal;
}
/* analyticsTracker / ltvPredictor 等同步模块需要的 config 导出：
 * Cocos 端无后端 API / SQLite 客户端数据库，返回安全默认值。 */
export function getApiBaseUrl() { return ""; }
export function isSqliteClientDatabase() { return false; }
