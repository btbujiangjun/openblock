/* 自动生成 —— 请勿手改。源：bestScoreBuckets（Cocos 桩：排行榜分桶返回空集，socialLeaderboard 安全降级）
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */

export function bucketForScore() { return 'unknown'; }
export function getBucketStats() { return {}; }
export function recordScoreForBucketing() {}
// socialLeaderboard.mjs 顶部 named import getAllBestByStrategy 用于 PB 风险修复；
// 桩端必须显式 export 否则 rollup MISSING_EXPORT 中断 JS 打包（→ APK 黑屏）。
export function getAllBestByStrategy() { return {}; }
