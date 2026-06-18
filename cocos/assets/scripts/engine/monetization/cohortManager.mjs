/* 自动生成 —— 请勿手改。源：monetization/cohortManager（Cocos 桩：cohort 标记返回空集）
 * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）
 */

// experimentPlatform.mjs 顶部 named import initCohortManager，cocos 桩必须 export 否则 rollup 中断。
export function initCohortManager() {}
const _noopCohort = {
    init() {},
    syncFromSystem() {},
    getCohorts() { return []; },
    hasCohort() { return false; },
    addCohort() {},
};
export function getCohortManager() { return _noopCohort; }
export function initCohortFromUser() {}
