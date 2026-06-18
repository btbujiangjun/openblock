#!/usr/bin/env node
/**
 * sync-cocos-engine.mjs
 *
 * 把 web/src 中「引擎无关纯逻辑闭包」（与 sync-core.sh 同名单）生成到
 * cocos/assets/scripts/engine/，保持 ESM，使 Cocos 客户端复用与 web 完全同源的
 * 真实出块算法（bot/blockSpawn.generateDockShapes + adaptiveSpawn + boardTopology …），
 * 而非手写副本。
 *
 * 规则：
 *  - 数据真源 shared/*.json → 生成 engine/shapesData.js / gameRulesData.js（export default）。
 *  - config.js（浏览器耦合）→ 生成极简 shim（仅 getStrategy / STRATEGIES，引擎唯一所需）。
 *  - config/platformProfile.js → 原样复制（纯逻辑，typeof 守卫）。
 *  - 对未分发到 cocos 的子系统（monetization/ retention/ lifecycle/）的 import →
 *    自动生成「具名导出返回 null 的函数 + 空命名空间」桩，配合调用点既有 ?./if/try 守卫软失败。
 *
 * 用法：node scripts/sync-cocos-engine.mjs [--verify]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'web', 'src');
const SHARED = path.join(ROOT, 'shared');
const OUT = path.join(ROOT, 'cocos', 'assets', 'scripts', 'engine');

const verify = process.argv.includes('--verify');

/** 与 scripts/sync-core.sh 一致的纯逻辑文件名单（cocos 复用同一闭包）。 */
const FILES = [
    'lib/seededRng.js',
    'lib/math.js',
    'lib/logger.js',
    'lib/dateUtils.js',
    'lib/storageAdapter.js',
    'lib/decisionTable.js',
    /* V2 V5：新增的轻量纯工具，cocos 端 adaptiveSpawn / analytics 都依赖 */
    'lib/analyticsStore.js',
    'lib/loggerBatchSink.js',
    'grid.js',
    'shapes.js',
    'gameRules.js',
    'difficulty.js',
    'boardTopology.js',
    'spatialPlanning.js',
    'segmentation.js',
    'playerAbilityModel.js',
    'adaptiveSpawn.js',
    'playerProfile.js',
    'spawnStepDifficulty.js',
    'difficultyRelativity.js',
    'playerLatentAbility.js',
    'bot/constructiveSpawn.js',
    'bot/spawnSanitize.js',
    'bot/alignedPick.js',
    'bot/specialInjection.js',
    'bot/spawnTargets.js',
    'bot/spawnGeometry.js',
    'bot/spawnPriors.js',
    'bot/pbCurve.js',
    'bot/liveGeometrySignals.js',
    'bot/delightTuning.js',
    'bot/blockSpawn.js',
    'spawn/commitSpawnContext.js',
    'spawn/warmRun.js',
    'spawn/peog.js',
    'tuning/v2/clientPolicyV2.js',
    'config/platformProfile.js',
    'lifecycle/lifecycleStressCapMap.js',
    'retention/runOverRunArc.js',
    'retention/playerMaturity.js',
    'retention/churnPredictor.js',
    'retention/winbackProtection.js',
    'retention/difficultyPredictor.js',
    'retention/goalSystem.js',
    'retention/vipSystem.js',
    'retention/firstPurchaseFunnel.js',
    'retention/dailyChallengePlaybook.js',
    'retention/playerLifecycleDashboard.js',
    'retention/campaignManager.js',
    'retention/winbackTiers.js',
    'lifecycle/lifecycleSignals.js',
    'monetization/featureFlags.js',
    'monetization/MonetizationBus.js',
    'monetization/analyticsTracker.js',
    // inc8-A payments：核心付费/排行/通行证/挑战/任务/弹窗（直接 sync mirror）
    'monetization/paymentManager.js',
    'monetization/paymentPredictionModel.js',
    'monetization/leaderboard.js',
    'monetization/seasonPass.js',
    'monetization/weeklyChallenge.js',
    'monetization/dailyTasks.js',
    'monetization/offerToast.js',
    // inc8-B push：本地与远程推送通道
    'monetization/pushNotificationManager.js',
    'monetization/pushNotificationSystem.js',
    'monetization/pushNotifications.js',
    // inc8-C abtest：实验分流与远程配置
    'monetization/abTestManager.js',
    'monetization/experimentPlatform.js',
    'monetization/remoteConfigManager.js',
    // inc8-D social：邀请/回放分享/分享卡/社交排行
    'monetization/inviteRewardSystem.js',
    'monetization/replayShare.js',
    'monetization/shareCardGenerator.js',
    'monetization/socialLeaderboard.js',
    'channelAttribution.js',
    'monetization/ltvPredictor.js',
    'monetization/commercialFeatureSnapshot.js',
    'retention/retentionManager.js',
    'retention/levelProgression.js',
    'level/levelPack.js',
    'lifecycle/lifecycleOrchestrator.js',
    'pbGrowthTracker.js',
    'evaluation/gridAdapter.js',
    'evaluation/placementQuality.js',
    'evaluation/roundQuality.js',
    'evaluation/sessionEvaluator.js',
    'evaluation/runToRunEvaluator.js',
  'evaluation/evaluationLedger.js',
  'evaluation/evaluationHost.js',
  'clearScoring.js',
  'onboarding/newbieVillageCore.js',
  'effects/skinPremiumCore.js',
  'effects/appearanceModeCore.js',
];
const COPY_SET = new Set(FILES);

const GEN_HEADER = (src) =>
    `/* 自动生成 —— 请勿手改。源：${src}\n * 重新生成：node scripts/sync-cocos-engine.mjs（npm run sync:cocos-core 已包含）\n */\n`;

const writes = [];
function emit(rel, content) {
    writes.push([rel, content]);
}

/* ---- 1. 数据模块（shared → engine，export default） ---- */
function genData() {
    const shapes = JSON.parse(fs.readFileSync(path.join(SHARED, 'shapes.json'), 'utf8'));
    const rules = JSON.parse(fs.readFileSync(path.join(SHARED, 'game_rules.json'), 'utf8'));
    emit('shapesData.js', GEN_HEADER('shared/shapes.json') + 'export default ' + JSON.stringify(shapes, null, 2) + ';\n');
    emit('gameRulesData.js', GEN_HEADER('shared/game_rules.json') + 'export default ' + JSON.stringify(rules, null, 2) + ';\n');
}

/* ---- 2. config shim（引擎仅需 getStrategy / STRATEGIES） ---- */
function genConfigShim() {
    emit(
        'config.js',
        GEN_HEADER('web/src/config.js（精简：去浏览器耦合，仅保留引擎所需）') +
            "import { buildDefaultStrategiesMap } from './gameRules.js';\n\n" +
            'const DEFAULT_STRATEGIES = buildDefaultStrategiesMap();\n' +
            'export const STRATEGIES = DEFAULT_STRATEGIES;\n' +
            'export function getStrategy(id) {\n' +
            '    return DEFAULT_STRATEGIES[id] || DEFAULT_STRATEGIES.normal;\n' +
            '}\n' +
            '/* analyticsTracker / ltvPredictor 等同步模块需要的 config 导出：\n' +
            ' * Cocos 端无后端 API / SQLite 客户端数据库，返回安全默认值。 */\n' +
            'export function getApiBaseUrl() { return ""; }\n' +
            'export function isSqliteClientDatabase() { return false; }\n',
    );
}

/* ---- 3. 复制 FILES + 重写 shared json import + 收集外部依赖 ---- */
const importRe = /import\s+(?:([A-Za-z_$][\w$]*)\s*,\s*)?(?:\{([^}]*)\}|\*\s+as\s+([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*))?\s*from\s*['"]([^'"]+)['"]/g;
const sideEffectRe = /import\s*['"]([^'"]+)['"]/g;

/** target rel path (under engine, posix) → { named:Set, default:bool } */
const stubs = new Map();

function depthPrefix(rel) {
    const d = rel.split('/').length - 1;
    return d === 0 ? './' : '../'.repeat(d);
}

function rewriteShared(content, rel) {
    const pfx = depthPrefix(rel);
    return content
        .replace(/(['"])(?:\.\.\/)*shared\/shapes\.json\1/g, `'${pfx}shapesData.js'`)
        .replace(/(['"])(?:\.\.\/)*shared\/game_rules\.json\1/g, `'${pfx}gameRulesData.js'`);
}

function resolveRel(fromRel, spec) {
    if (!spec.startsWith('.')) return null;
    const dir = path.posix.dirname(fromRel);
    let p = path.posix.normalize(path.posix.join(dir, spec));
    if (!p.endsWith('.js')) p += '.js';
    return p;
}

function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

function scanForStubs(rawContent, rel) {
    const content = stripComments(rawContent);
    // 第一遍：解析 import，登记 alias → 目标桩。
    /** local alias (default / ns / 重命名) → target rel */
    const aliasToTarget = new Map();
    let m;
    importRe.lastIndex = 0;
    while ((m = importRe.exec(content))) {
        const def = m[1];
        const named = m[2];
        const ns = m[3];
        const bareDefault = m[4];
        const spec = m[5];
        const target = resolveRel(rel, spec);
        if (!target) continue;
        if (COPY_SET.has(target)) continue;
        if (['shapesData.js', 'gameRulesData.js', 'config.js'].includes(target)) continue;
        const entry = stubs.get(target) || { named: new Set(), default: false };
        if (def) { entry.default = true; aliasToTarget.set(def, target); }
        if (bareDefault) { entry.default = true; aliasToTarget.set(bareDefault, target); }
        if (ns) { entry.default = true; aliasToTarget.set(ns, target); }
        if (named) {
            for (const part of named.split(',')) {
                const name = part.trim().split(/\s+as\s+/)[0].trim();
                if (name) entry.named.add(name);
            }
        }
        stubs.set(target, entry);
    }
    sideEffectRe.lastIndex = 0;
    while ((m = sideEffectRe.exec(content))) {
        const target = resolveRel(rel, m[1]);
        if (target && !COPY_SET.has(target) && !stubs.has(target) &&
            !['shapesData.js', 'gameRulesData.js', 'config.js'].includes(target)) {
            stubs.set(target, { named: new Set(), default: false });
        }
    }
    // 第二遍：扫描 `<alias>.<member>` 模式，把成员补到对应桩的 named 集合里。
    // 这是关键修复 —— `import * as X from './stub.mjs'` 后用 `X.foo` 访问时，Rollup 会
    // 在打包阶段告警「'foo' is not exported by ...」，导致构建日志里持续出现成排告警。
    // 之前只对 `import { foo }` 形态收集，对 namespace 成员访问完全无感知。
    if (aliasToTarget.size > 0) {
        const memberRe = /([A-Za-z_$][\w$]*)\s*\??\.\s*([A-Za-z_$][\w$]*)/g;
        let mm;
        while ((mm = memberRe.exec(content))) {
            const alias = mm[1];
            const member = mm[2];
            const target = aliasToTarget.get(alias);
            if (!target) continue;
            // 跳过 JS 内建属性（default/length 等）以免污染桩。
            if (member === 'default' || member === 'length' || member === 'name' || member === 'prototype') continue;
            const entry = stubs.get(target);
            if (entry) entry.named.add(member);
        }
    }
}

function copyFiles() {
    for (const rel of FILES) {
        const srcFile = path.join(SRC, rel);
        if (!fs.existsSync(srcFile)) {
            console.error(`[sync-cocos-engine] MISSING source: web/src/${rel}`);
            process.exit(1);
        }
        let content = fs.readFileSync(srcFile, 'utf8');
        content = rewriteShared(content, rel);
        scanForStubs(content, rel);
        emit(rel, GEN_HEADER(`web/src/${rel}`) + content);
    }
}

/* ---- 4. 生成桩 ---- */

/**
 * 手写桩：对于需要返回非 null 默认值的模块，在此提供自定义实现。
 * key = 相对路径（posix，.js 后缀），value = 文件内容字符串。
 * 不在此表中的桩仍自动生成"全部返回 null"的空桩。
 */
const CUSTOM_STUBS = new Map();

/* monetization/commercialModel.js —— 规则模型桩：lifecycleOrchestrator 通过 _safe() 调用
 * getCommercialChurnRisk01，桩返回 null 安全降级为双路投票。
 * 全量同步需拉入 strategy/ + calibration/ + ml/ + quality/ 子系统，不值得。 */
CUSTOM_STUBS.set('monetization/commercialModel.js', `${GEN_HEADER('monetization/commercialModel（Cocos 桩：规则模型需 strategy/ml 子系统）')}
export function buildCommercialModelVector() { return null; }
export function getCommercialChurnRisk01() { return null; }
export function shouldAllowMonetizationAction() { return true; }
`);

/* monetization/adTrigger.js —— 广告触发桩：lifecycleOrchestrator 通过 _safe() 调用
 * getAdFreqSnapshot，桩返回 null 安全。全量同步需广告/IAP/弹窗协调器。 */
CUSTOM_STUBS.set('monetization/adTrigger.js', `${GEN_HEADER('monetization/adTrigger（Cocos 桩：广告触发需 adAdapter/iapAdapter/popupCoordinator）')}
export function getAdGuardrailState() { return null; }
export function initAdTrigger() { return null; }
export function getAdFreqSnapshot() { return null; }
`);

/* inc8-A payments 间接依赖桩 —— 为 payments 系列模块提供「形状契合」的安全 no-op，
 * 避免 getWallet() / getCohortManager() / isPurchased() 在 Cocos 端 crash。
 * 真实实现留给后续 inc8-A-deps PR（若需要本地钱包/IAP 链路再 sync 源文件）。 */

CUSTOM_STUBS.set('skills/wallet.js', `${GEN_HEADER('skills/wallet（Cocos 桩：钱包 no-op，addBalance 静默）')}
const _noopWallet = {
    addBalance() { return 0; },
    getBalance() { return 0; },
    spend() { return false; },
    has() { return false; },
};
export function getWallet() { return _noopWallet; }
`);

CUSTOM_STUBS.set('monetization/cohortManager.js', `${GEN_HEADER('monetization/cohortManager（Cocos 桩：cohort 标记返回空集）')}
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
`);

CUSTOM_STUBS.set('monetization/iapAdapter.js', `${GEN_HEADER('monetization/iapAdapter（Cocos 桩：IAP 查询恒为未购买）')}
export function isPurchased() { return false; }
export function getOwnedProducts() { return []; }
export function purchase() { return Promise.resolve({ ok: false, reason: 'stub' }); }
// lifecycleOrchestrator 经 _safe() 回退 null，stub 端必须显式导出避免 rollup parse error。
export function getLifetimeSpend() { return null; }
`);

CUSTOM_STUBS.set('monetization/personalization.js', `${GEN_HEADER('monetization/personalization（Cocos 桩：个性化推荐返回空）')}
export function getPersonalizedOffer() { return null; }
export function recordOfferShown() {}
export function recordOfferAccepted() {}
// lifecycleOrchestrator 直接 named import 这两个，桩端必须显式 export 否则 rollup 中断打包。
export function getCommercialModelContext() { return null; }
export function updateRealtimeSignals() {}
`);

/* inc8-B/C/D 间接依赖桩 —— push/abtest/social 模块对 progression / retentionAnalyzer /
 * i18n / bestScoreBuckets / adAdapter / strategy 的引用，全部用安全 no-op 桩兜底。 */

CUSTOM_STUBS.set('progression.js', `${GEN_HEADER('progression（Cocos 桩：进度持久化 no-op，loadProgress 返回空对象供解构）')}
export function loadProgress() { return {}; }
export function saveProgress() {}
export function applyGameEndProgression() { return null; }
export function computeXpGain() { return 0; }
export function getLevelFromTotalXp() { return 1; }
export function getLevelProgress() { return { level: 1, progress: 0 }; }
export function invalidateProgressCache() {}
export function isSkinUnlocked() { return false; }
export function resetSkinUnlockProvider() {}
export function setSkinUnlockProvider() {}
export function titleForLevel() { return ''; }
`);

CUSTOM_STUBS.set('monetization/retentionAnalyzer.js', `${GEN_HEADER('monetization/retentionAnalyzer（Cocos 桩：lifecycle 查询返回未知，触发 push 降级）')}
const _noopAnalyzer = {
    getUserLifecycle() { return { stage: 'unknown', score: 0 }; },
    recordEvent() {},
    snapshot() { return {}; },
};
export function getRetentionAnalyzer() { return _noopAnalyzer; }
export function initRetentionAnalyzer() {}
export function _resetRetentionAnalyzerForTests() {}
`);

CUSTOM_STUBS.set('i18n/i18n.js', `${GEN_HEADER('i18n（Cocos 桩：翻译恒返回 key 自身，分享文案走原文）')}
export function t(key) { return String(key ?? ''); }
export function setLocale() {}
export function getLocale() { return 'en'; }
`);

CUSTOM_STUBS.set('bestScoreBuckets.js', `${GEN_HEADER('bestScoreBuckets（Cocos 桩：排行榜分桶返回空集，socialLeaderboard 安全降级）')}
export function bucketForScore() { return 'unknown'; }
export function getBucketStats() { return {}; }
export function recordScoreForBucketing() {}
// socialLeaderboard.mjs 顶部 named import getAllBestByStrategy 用于 PB 风险修复；
// 桩端必须显式 export 否则 rollup MISSING_EXPORT 中断 JS 打包（→ APK 黑屏）。
export function getAllBestByStrategy() { return {}; }
`);

CUSTOM_STUBS.set('monetization/adAdapter.js', `${GEN_HEADER('monetization/adAdapter（Cocos 桩：广告适配器 no-op，iapAdapter 间接依赖）')}
export function showRewardedAd() { return Promise.resolve({ ok: false, reason: 'stub' }); }
export function showInterstitialAd() { return Promise.resolve(false); }
export function preloadAds() {}
export function getAdAvailability() { return { rewarded: false, interstitial: false }; }
`);

CUSTOM_STUBS.set('monetization/strategy/index.js', `${GEN_HEADER('monetization/strategy/index（Cocos 桩：策略入口空骨架，personalization 间接依赖）')}
export function selectStrategy() { return null; }
export function listStrategies() { return []; }
export default {};
`);

function genStubs() {
    for (const [target, info] of stubs) {
        const custom = CUSTOM_STUBS.get(target);
        if (custom) {
            emit(target, custom);
            continue;
        }
        let body = GEN_HEADER(`软依赖桩（cocos 不分发该子系统）：原 web/src/${target}`);
        for (const name of info.named) {
            body += `export function ${name}() { return null; }\n`;
        }
        if (info.default || info.named.size === 0) {
            body += 'export default {};\n';
        }
        emit(target, body);
    }
}

/* ---- run ---- */
genData();
genConfigShim();
copyFiles();
genStubs();

/* ---- 输出为 .mjs（Cocos Creator 将 .js 视为 CommonJS 并套 cjs-interop 导致打包失败；
 *      .mjs/.ts 才按 ESM 处理）。重命名输出并把相对 import 的 .js 后缀改写为 .mjs。 ---- */
function toMjs(rel) {
    return rel.replace(/\.js$/, '.mjs');
}
function rewriteSpecifiersToMjs(content) {
    return content
        .replace(/(from\s*['"])(\.\.?\/[^'"]*?)\.js(['"])/g, '$1$2.mjs$3')
        .replace(/(import\s*['"])(\.\.?\/[^'"]*?)\.js(['"])/g, '$1$2.mjs$3');
}
const mjsWrites = writes.map(([rel, content]) => [toMjs(rel), rewriteSpecifiersToMjs(content)]);

let outOfDate = 0;
for (const [rel, content] of mjsWrites) {
    const target = path.join(OUT, rel);
    if (verify) {
        const cur = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
        if (cur !== content) {
            console.error(`[sync-cocos-engine] OUT OF DATE: ${rel}`);
            outOfDate++;
        }
        continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

if (verify) {
    if (outOfDate) {
        console.error(`[sync-cocos-engine] ${outOfDate} file(s) stale — run npm run sync:cocos-core`);
        process.exit(1);
    }
    console.log('[sync-cocos-engine] OK (up to date)');
} else {
    console.log(`[sync-cocos-engine] wrote ${mjsWrites.length} .mjs files to engine/ (stubs: ${stubs.size})`);
}
