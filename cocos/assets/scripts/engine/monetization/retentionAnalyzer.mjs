/* 自动生成 —— 请勿手改。源：monetization/retentionAnalyzer（Cocos 桩：lifecycle 查询返回未知，触发 push 降级）
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */

const _noopAnalyzer = {
    getUserLifecycle() { return { stage: 'unknown', score: 0 }; },
    recordEvent() {},
    snapshot() { return {}; },
};
export function getRetentionAnalyzer() { return _noopAnalyzer; }
export function initRetentionAnalyzer() {}
export function _resetRetentionAnalyzerForTests() {}
