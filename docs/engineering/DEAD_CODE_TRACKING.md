# Dead Code Tracking — Unused Export 扫描台账

> 自动化扫描结果，**不等于真正死代码**：仍需 case-by-case 评审。
> 入口型函数（`init*` / `open*` / `start*` / `get*Instance`）可能被 HTML 模板 /
> 主入口 main.js / 动态 `import()` / 字符串拼接的 module 名引用，搜索抓不到。

## 扫描方法（可复现）

```bash
# 全仓 export 提取 + 反向查找
python3 scripts/scan-unused-exports.py  # 或参考 git log b9bb200..HEAD 中的命令
```

规则：
- 遍历 `web/src/**/*.js` 中每个 `export function|const|class X`
- 在 `web/src + tests + cocos/assets/scripts + miniprogram/core + scripts` 全文搜 `\bX\b`
- 排除自身定义文件
- 排除 `__*` / `^[A-Z_]+$` / 含 `VERSION|SCHEMA|DEFAULT` 的常量（多为公开 schema）

## 当前快照（2026-06-18，HEAD ≈ U5）

- 总 export：**1402**（U5 收窄 3 项；其余 65 差异主要来自其他清理 commit / 文件变动）
- 全仓零引用：**73**（STRICT 模式，已排除入口型 init*/get*Instance/open*/start* 等）
- LOOSE 模式（不排除入口型）历史值：~149

## 扫描命令

```bash
node scripts/scan-unused-exports.mjs           # 文本报告（LOOSE）
node scripts/scan-unused-exports.mjs --strict  # STRICT（排除入口型，更高置信度）
node scripts/scan-unused-exports.mjs --json    # 机器可读 JSON

# X5：基线对比模式
npm run scan:dead-code                     # 对比 docs/engineering/dead-code-baseline.json
npm run scan:dead-code:write-baseline      # 更新基线（清理后或大重构后）
node scripts/scan-unused-exports.mjs --strict \
    --baseline docs/engineering/dead-code-baseline.json --fail-on-new
                                           # CI 守门：新增即 exit 1
```

## X5：Weekly CI Job（自动跟踪新增/解决）

- 工作流：`.github/workflows/weekly-dead-code.yml`
- 触发：每周一 UTC 02:00（北京时间周一 10:00）；可 `workflow_dispatch` 手动触发
- 行为：扫描 → 对比基线 → 有 added/removed 时在 `dead-code` label 的 Issue 评论增量
- 手动触发可选 `update_baseline=true`：扫描后自动提交新基线到 main
  （供大型清理后一次性 rebaseline）

**基线**：`docs/engineering/dead-code-baseline.json`（71 项 @ X5 立项时）。
基线文件 *是* 跟踪源——只增不减意味着新代码引入死代码，须 owner 评审。

## 分类与处置建议

### A. 高置信度可删（本会话遗留 / 明确无人用）

| 文件 | export | 备注 | 处置 |
|---|---|---|---|
| `web/src/lib/storageAdapter.js` | `safeRemoveKey` | 本会话新增但未被任何调用点使用 | **已删除**（commit `5c69d4f`） |
| `web/src/audit/profileAuditMath.js` | `finiteNumbers` | STRICT 扫零外部引用；仅同文件 mean/median/stddev 使用 | **改为内部函数**（U5） |
| `web/src/coordination/unifiedSignals.js` | `invalidateUnifiedSignalsCache` | STRICT 扫零引用；缓存现靠 key 变化自动失效 | **整段删除**（U5） |
| `web/src/bot/spawnEvaluation.js` | `scoreEvaluationRow` | STRICT 扫零外部引用；仅同文件 deriveOptimizerScore 使用 | **改为内部函数**（U5） |
| `web/src/monetization/commercialModel.js` | `_resetCommercialModelCacheForTests` | `_*ForTests` 命名说明只服务测试，但测试已不调用 | **整段删除**（V3） |
| `web/src/retention/socialIntroTrigger.js` | `invalidateSocialIntroCache` | 同 unifiedSignals 模式，cache 靠 ttl 失效 | **整段删除**（V3） |

### B. 保留 + 加 PUBLIC API 豁免注释（V3 评审）

以下 export 0 业务调用但属合理对外/调试 hook，加 `// PUBLIC API:` 注释长期保留：
- `monetization/lifecycleAwareOffers.js`: `isLifecycleAwareOffersAttached`
- `monetization/lifecycleOutreach.js`: `isLifecycleOutreachAttached`
- `monetization/experiment/experimentUnified.js`: `refreshPausedExperiments`
- `monetization/lifecycleExperiments.js`: `listLifecycleExperiments`

> 扫描脚本未来可识别 `// PUBLIC API:` 注释自动豁免；当前先手动维护台账。

### B. 中置信度（需人工确认是否为对外/调试入口）

按目录归类（共 58 文件 / 101 项）：

#### bot / spawn 决策
- `bot/spawnEvaluation.js`: `scoreEvaluationRow`, `computeGoalSubscores`, `buildEvaluationInsights`
- `bot/spawnExperiments.js`: `SPAWN_POLICY_RULES_P1`, `SPAWN_POLICY_RULES_P2`, `derivePreferenceVector`, `deriveExperienceBudget`
- `bot/trainer.js`: `resolveBrowserRlTrainingConfig`, `reinforceUpdate`
- `bot/pytorchBackend.js`: `evalGreedyRemote`
- `spawnModel.js`: `startPersonalize`, `proposeShapes`

#### monetization / 商业化
- `monetization/adProviders.js`: `createAppLovinProvider`
- `monetization/analyticsDashboard.js`: `getAnalyticsDashboard`, `initAnalyticsDashboard`
- `monetization/analyticsPlatform.js`: `getAnalyticsPlatform`, `initAnalyticsPlatform`
- `monetization/commercialInsight.js`: `initCommercialInsight`
- `monetization/commercialModel.js`: `_resetCommercialModelCacheForTests`
- `monetization/experiment/experimentUnified.js`: `refreshPausedExperiments`
- `monetization/iapAdapter.js`: `setIapProvider`, `canPurchaseStarterPack`, `getLimitedTimeRemaining`, `createLimitedTimeOffer`
- `monetization/index.js`: `shutdownMonetization`
- `monetization/lifecycleAwareOffers.js`: `isLifecycleAwareOffersAttached`
- `monetization/lifecycleExperiments.js`: `listLifecycleExperiments`
- `monetization/lifecycleOutreach.js`: `isLifecycleOutreachAttached`
- `monetization/ml/contextualBandit.js`: `flushBandit`
- `monetization/monPanel.js`: `refreshMonPanel`
- `monetization/personalization.js`: `reclassifyFromConfig`
- `monetization/quality/distributionDriftMonitor.js`: `getDriftMeta`, `flushDrift`

#### onboarding / 引导
- `onboarding/enhancedFTUE.js`: `FTUE_STEPS_V2`, `getEnhancedFTUE`, `initEnhancedFTUE`
- `onboarding/ftueManager.js`: `getFTUEManager`, `initFTUE`
- `onboarding/newbieVillage.js`: `startNewbieVillage`
- `retention/ftueFunnel.js`: `getFunnelProgress`

#### social / 社交
- `social/asyncPkStub.js`: `initAsyncPkStub`
- `social/friendSystem.js`: `getFriendSystemInstance`
- `social/guildSystem.js`: `getGuildSystemInstance`
- `social/leaderboardScreen.js`: `openLeaderboardScreen`
- `social/multiplayerGame.js`: `getMultiplayerGameInstance`
- `social/replayAlbum.js`: `openAlbum`
- `social/replayAlbumStub.js`: `initReplayAlbumStub`
- `social/socialManager.js`: `initSocialManager`, `getSocialManager`, `getSocialManagerInstance`

#### 工具 / 调试 / UI
- `achievements/extremeAchievements.js`: `getUnlockedAchievements`
- `analyticsBridge.js`: `mirrorAnalyticsEvent`
- `audit/profileAuditMath.js`: `finiteNumbers`
- `boardTexture.js`: `paintXuanPaperTexture`
- `checkin/loginStreak.js`: `getMedals`
- `coordination/unifiedSignals.js`: `invalidateUnifiedSignalsCache`
- `cssVariableManager.js`: `CSSVariableManager`, `getCSSVariableManager`
- `decisionFlowViz.js`: `toggleDecisionFlowViz`, `getDecisionFlowViz`
- `derivation/selectors.js`: `selectInsight`
- `effects/haptics.js`: `impactLight`, `impactMedium`, `impactHeavy`, `notificationSuccess`
- `intentLexicon.js`: `getIntentEntry`, `getOutOfGameTaskCopy`, `getLexiconSnapshot`
- `moduleLazyLoader.js`: `lazyLoadModule`, `preloadModules`, `loadModulesForScene`, `getModuleStats`, `clearModuleCache`
- `monitoring/errorTracker.js`: `getErrorTracker`, `getErrorTrackerInstance`
- `monitoring/performanceMonitor.js`: `getPerformanceMonitor`, `getPerformanceMonitorInstance`
- `offlineBehaviorQueue.js`: `queueBehaviors`, `getQueueCount`, `clearSynced`
- `offlineManager.js`: `initOfflineManager`, `onNetworkStatusChange`, `getOfflineStatus`, `forceSync`, `shutdownOfflineManager`, `initPWAInstall`
- `offlineStateCache.js`: `readSpawnSignals`, `clearSpawnSignals`, `describeSpawnSignals`
- `optimizedParticles.js`: `OptimizedParticleSystem`
- `performanceOptimizer.js`: `PerformanceOptimizer`
- `personalizationPreferences.js`: `loadPersonalizationPreferences`, `savePersonalizationPreferences`, `sanitizePersonalizationPreferences`, `personalizationDataBoundary`
- `playerAnalyticsApp.js`: `initPlayerAnalyticsApp`
- `playerInsightPanel.js`: `setInsightPanelCollapsed`
- `privacy/consentManager.js`: `showConsentBanner`
- `profileAuditApp.js`: `initProfileAuditApp`
- `retention/socialIntroTrigger.js`: `getSocialIntroData`, `invalidateSocialIntroCache`
- `scoreAnimator.js`: `stopScoreAnimation`

## 处置流程建议

逐目录由该业务 owner 评审：
1. **真死代码** → 单文件级 PR 删除（注意删除时同步检查 sync manifest）
2. **对外 API / 调试 hook** → 文件头加 `// PUBLIC API: 用于 <场景>` 注释，永久豁免
3. **Lazy load 入口** → 加 `// LAZY ENTRY: 由 moduleLazyLoader 动态拉起` 注释豁免
4. **HTML 模板用** → 全仓搜 `'<name>'` / `"<name>"` 字符串验证后注释豁免

## 自动化追踪

> 目标：维持 unused export 数量不增长。
> 将扫描脚本作为 CI 软警告（不阻塞），每周一次产出 diff 报告。
