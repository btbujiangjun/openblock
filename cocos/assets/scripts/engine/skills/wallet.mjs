/* 自动生成 —— 请勿手改。源：skills/wallet（Cocos 桩：钱包 no-op，addBalance 静默）
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */

const _noopWallet = {
    addBalance() { return 0; },
    getBalance() { return 0; },
    spend() { return false; },
    has() { return false; },
};
export function getWallet() { return _noopWallet; }
