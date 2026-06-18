/* 自动生成 —— 请勿手改。源：monetization/iapAdapter（Cocos 桩：IAP 查询恒为未购买）
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */

export function isPurchased() { return false; }
export function getOwnedProducts() { return []; }
export function purchase() { return Promise.resolve({ ok: false, reason: 'stub' }); }
// lifecycleOrchestrator 经 _safe() 回退 null，stub 端必须显式导出避免 rollup parse error。
export function getLifetimeSpend() { return null; }
