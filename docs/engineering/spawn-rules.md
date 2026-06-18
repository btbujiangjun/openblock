<!-- 自动生成；请勿手改。源：scripts/gen-dsl-rules-doc.mjs -->

# Spawn Rules DSL 一览

本文件由 `scripts/gen-dsl-rules-doc.mjs` 自动生成，扫描 1 个源文件，
共 **8** 条规则。

> 修改规则元数据后请重新运行 `node scripts/gen-dsl-rules-doc.mjs`；
> CI 会用 `--check` 模式验证文档同步。

## BASE_RULES_DSL（8 条）

源：`web/src/spawn/baseRulesDsl.js`

| Priority | ID | Since | Owner | A/B Key | Comment |
|---:|---|---|---|---|---|
|700|`near-miss`|PP5|gameplay||profile.hadRecentNearMiss → cg ≥ eng.nearMissClearGuarantee (默认 2)|
|600|`frustration`|PP5|gameplay||frustrationLevel ≥ frustThreshold → cg ≥ 2 + sp = -0.3 (非幂等覆盖)|
|500|`needs-recovery`|PP5|gameplay||profile.needsRecovery → cg ≥ 2 + sp = -0.5 (覆盖更负值，与原码同)|
|400|`bored`|PP5|gameplay||flow === bored → diversityBoost = eng.noveltyDiversityBoost ?? 0.15|
|300|`onboarding`|PP5|gameplay||profile.isInOnboarding → cg ≥ 2 + sp = -0.4|
|200|`late-momentum`|PP5|gameplay||sessionPhase=late & momentum < -0.3 → cg ≥ 1 + sp ≤ -0.2|
|150|`rounds-since-clear`|PP5|gameplay||rsc ≥ 2 → cg ≥ 2; rsc ≥ 4 → 进一步 cg ≥ 3 + sp ≤ -0.35|
|100|`holes-clear-guarantee`|NN-F3.1|gameplay|`holesV1`|PoC：与 adaptiveSpawn._applySpawnHintsHolesRule 完全等价。|

---

总规则数：**8**

