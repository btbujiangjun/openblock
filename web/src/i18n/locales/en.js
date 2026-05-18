/**
 * English UI strings
 * @type {Record<string, string>}
 */
export default {
    'meta.title': 'Open Block',
    'meta.description': 'Open Block — spatial rhythm puzzle',

    'ui.stat.ability': 'Level',
    'ui.stat.score': 'Score',
    'ui.stat.best': 'Best',
    'ui.stat.theme': 'Theme',
    'ui.skin.pickTheme': 'Choose board theme',
    'ui.header.backMenu': 'Back to menu',
    'ui.aria.playerLevel': 'Player level',
    'ui.aria.boardTheme': 'Board theme',
    'ui.aria.playArea': 'Play area',
    'ui.aria.gameGrid': 'Game grid',
    'ui.aria.skillBar': 'Skills',
    'ui.aria.quickToolbar': 'Back to menu',
    'ui.skill.hint': '💡 AI hint — analyze the board for best placement',
    'ui.skill.seasonPass': '🏆 Battle pass — tasks and rewards',
    'ui.skill.restart': '🔁 Restart — start this round over',
    'ui.skill.newGame': '🎮 New game — back to main menu',

    'menu.start': 'Play',
    'menu.replay': 'Replays',
    'menu.replayAlbum': 'Replay album',
    'menu.editor': 'Level editor',
    'menu.docs': 'Docs',
    'menu.personalData': 'Wallet · stats',
    'menu.ops': 'Ops dashboard',
    'menu.localeLabel': 'Language',
    'menu.localeAria': 'Interface language',
    'menu.dailyMaster': 'Daily Master',
    'menu.dbDebug': 'DB debug',

    'dbDebug.title': '🗄 SQLite debug',
    'dbDebug.tableLabel': 'Table',
    'dbDebug.limitLabel': 'Row limit',
    'dbDebug.back': '← Menu',
    'dbDebug.warn': 'DB debug is on by default; set OPENBLOCK_DB_DEBUG=0 on public hosts. Arbitrary SQL is allowed.',
    'dbDebug.sqlHint': 'Pick a table above, then use «Query selected table» for default SELECT * … LIMIT (no SQL needed). For writes, type one SQL statement below and tap «Execute SQL».',
    'dbDebug.querySelectedTable': 'Query selected table',
    'dbDebug.sqlPlaceholder': 'Optional: custom SELECT / UPDATE / INSERT / DELETE…',
    'dbDebug.run': 'Execute SQL',
    'dbDebug.refreshTables': 'Refresh tables',
    'dbDebug.schema': 'Insert PRAGMA schema',
    'dbDebug.clearResult': 'Clear results',
    'dbDebug.resultPlaceholder': 'Results appear here.',
    'dbDebug.running': 'Running…',
    'dbDebug.needTableOrSql': 'Enter SQL, or pick a table and use «Query selected table».',
    'dbDebug.needSelectTable': 'Select a table in the dropdown above first.',
    'dbDebug.rowCount': '{{n}} rows (this page).',
    'dbDebug.mutateOk': 'Done: {{n}} rows affected; lastrowid={{id}}',
    'dbDebug.tablesLoading': 'Loading catalog…',
    'dbDebug.tablesEmpty': '(no user tables/views)',
    'dbDebug.tablesError': '(catalog load failed)',
    'dbDebug.tablesErrorHint': 'Reason:',
    'dbDebug.optionTable': '{{name}} · table',
    'dbDebug.optionView': '{{name}} · view',

    'dailyMaster.alreadyPlayed': 'Already played today — come back tomorrow',
    'dailyMaster.toastSeed': '🏅 Daily Master · seed {{seed}}',
    'dailyMaster.toastComplete': 'Daily Master complete · score {{score}}',

    'game.over.endless': 'Game over',
    'game.over.levelClear': 'Level clear',
    'game.over.levelFail': 'Level failed',
    'game.retry': 'Play again',
    'game.menu': 'Menu',
    'game.xpGained': '+{{n}} XP',
    'game.xpLevelUp': 'to Lv.{{level}}',
    'game.summary.title': 'Summary',
    'game.summary.clears': 'Clears',
    'game.summary.clearsValue': '{{n}} rows',
    'game.summary.maxCombo': 'Max Combo',
    'game.summary.hitRate': 'Hit Rate',
    'game.summary.duration': 'Time',
    'game.actions.poster': 'Poster',
    'game.actions.share': 'Share',
    'game.actions.replay': 'Replay',
    'game.actions.posterAria': 'Generate score poster',
    'game.actions.shareAria': 'Share this run',
    'game.actions.replayAria': 'Watch this round\'s replay',
    'game.replay.noFrames': 'Not enough frames to replay this round',

    'share.poster.callToPlay': 'PLAY NOW',
    'share.poster.hookHeadline': 'Can you beat {{score}} pts?',
    'share.poster.hookSubline': 'Scan to challenge — instant play, no install',
    'share.poster.scanToPk': 'Scan · Start Now',
    'share.poster.scoreLabel': 'Final Score',
    'share.poster.scorePts': 'pts',
    'share.poster.shareTitle': 'OpenBlock Run',
    'share.poster.shareText': 'Come play OpenBlock!',
    'share.poster.stamp': 'OPEN BLOCK · ENDLESS ARENA · MMXXVI',

    'progress.rank.novice': 'Novice',
    'progress.rank.apprentice': 'Apprentice',
    'progress.rank.adept': 'Adept',
    'progress.rank.expert': 'Expert',
    'progress.rank.master': 'Master',
    'progress.rank.legend': 'Legend',
    'progress.streakDays': '{{n}} days streak',
    /* v1.56.3 §5.α.7 Strategy-hidden principle —
     *
     * All best-gap / best.over / endGame.nearMiss strings are unified as plain
     * factual statements ("{{gap}} pts short" / "+{{over}} pts"). The earlier
     * coaching-style and emotionally charged variants ("About to break your record!",
     * "Sprint zone!", "Legend mode", "so close to a new record") are deprecated.
     *
     * Rationale: the far-PB relief / near-PB pressure / over-PB harder-pressure
     * strategy is **executed silently in the algorithm layer** (farFromPBBoost /
     * challengeBoost / pbExtremeOrderBoost / effect amplitude modulation). Players
     * perceive it through **block-feel, effect intensity, and HUD color states**
     * (best-gap--close / --chase / --over), NOT through text that announces
     * "system entered sprint mode" or "switched to order-rigor mode".
     *
     * Five-band (D0~D4) differentiation now lives entirely in CSS classes and
     * algorithm hints — text stays factual.
     *
     * Old keys retained as @deprecated for i18n platform grey-rollback. */
    'best.gap': '{{gap}} pts short',
    'best.gap.neutral': '{{gap}} pts short',
    /** @deprecated v1.57.3 §5.α.14: D0 segment now uses best.gap.neutral to avoid
     *   visual duplication with the main HUD's #best-score. Key kept for rollback. */
    'best.gap.far': '{{gap}} pts short',
    /* v1.56.7: '+N pts' was ambiguous (over what baseline?) when combined with
     * 'Score 210 / Best 210 / +190 pts' — players couldn't reconcile the three
     * numbers. New copy 'Run +N' anchors the comparison to "this run's starting PB"
     * so 210 - 190 = 20 (run-start baseline) becomes mentally inferable. */
    'best.over.neutral': 'Run +{{over}}',
    'endGame.nearMiss': '{{gap}} pts short',
    /** @deprecated v1.56.3: coaching/emotional variants downgraded to factual */
    'best.gap.victory': '{{gap}} pts short',
    /** @deprecated v1.56.3 */
    'best.gap.close': '{{gap}} pts short',
    /** @deprecated v1.56.1 */
    'best.gap.far.alt1': 'Steady pace — two more runs will close the gap',
    /** @deprecated v1.56.1 */
    'best.gap.far.alt2': 'Last PB {{best}} · stack the bottom two rows first',
    /** @deprecated v1.56.3 */
    'best.gap.follow': '{{gap}} pts short',
    /** @deprecated v1.56.3 */
    'best.gap.chase': '{{gap}} pts short',
    /** @deprecated v1.56.3 */
    'best.over.toNext10': '+{{over}} pts',
    /** @deprecated v1.56.3 */
    'best.over.toNext25': '+{{over}} pts',
    /** @deprecated v1.56.3 */
    'best.over.legend': '+{{over}} pts',
    /** @deprecated v1.56.3: endGame.nearMiss.D2 / D3 merged into endGame.nearMiss */
    'endGame.nearMiss.D3': '{{gap}} pts short',
    /** @deprecated v1.56.3 */
    'endGame.nearMiss.D2': '{{gap}} pts short',
    /* v1.56 §4.4 / v1.56.3 toned-down: factual count, no fireworks emoji
     * (effect.newRecord already provides the single celebratory anchor). */
    'pbStreak.badge': '{{n}}× PB',
    /* @deprecated v1.55.11: in-run milestone / tie-best toasts are no longer rendered
     * (user feedback: keep only "new record" fireworks as the single emotional anchor).
     * These three keys are retained for i18n platform rollback compatibility; existence is
     * still asserted by i18n tests, but the game UI never consumes them anymore. */
    'effect.scoreMilestone': 'Score broke {{score}}!',
    'effect.scoreMilestonePct': '{{pct}}% of your best',
    'effect.tieBest': '🏁 Tied your best!',
    /* Placement didn't clear: a row/column is one cell from full — morale boost only, rate-limited */
    'effect.nearMissPlace': 'One more to clear',
    /* No moves left, game over imminent */
    'effect.noMovesEnd': "Board's full — try again!",
    /* @deprecated since v1.49; use effect.scoreMilestone */
    'effect.milestoneHit': 'Milestone!',
    'effect.perfectClear': 'Perfect Clear',
    'effect.multiClear': '{{n}}x Clear',
    'effect.doubleClear': 'Double Clear',
    'effect.iconBonus': 'Royal Flush Clear',
    'effect.newRecord': '🏆 New Record!',
    /* v1.55 §4.6: in-run subsequent PB breaks; first break still uses newRecord. */
    'effect.newRecord.second': 'Again +{{delta}}',
    'effect.streakCombo': '{{fires}} {{n}} Combo',
    'effect.achievementUnlocked': '🏆 Achievement Unlocked!',
    'effect.runStreakHint': 'Run streak #{{n}}: tighter board, harder spawns (back to menu to reset)',
    'effect.levelFailHintWithStreak': 'Failed {{n}} times in a row · {{hint}}',
    'effect.levelFailHint.1': 'Place smaller blocks first to leave room for bigger ones',
    'effect.levelFailHint.2': 'Clear corners and edges first to keep the center flexible',
    'effect.levelFailHint.3': 'Park L/T-shaped pieces along the edges',
    'effect.levelFailHint.4': 'Keeping the board tidy beats chasing multi-line clears',

    'toast.copied': 'Copied ✓',
    'toast.shareLinkCopied': '📋 Share link copied to clipboard',
    'toast.adClaim': 'Claim Reward',

    'skill.undo.empty': '↩ Nothing to undo',
    'skill.undo.payFail': '⚠ Charge failed, please retry',
    'skill.undo.fail': '⚠ Undo failed, please retry',
    'skill.undo.ok': '↩ Undid the last move',
    'skill.bomb.unavailable': '💣 Bomb unavailable',
    'skill.bomb.empty': '💣 Out of bombs — complete tasks or open chests to earn more',
    'skill.bomb.aim': '💣 Tap any cell to drop a bomb (ESC to cancel)',
    'skill.bomb.shortage': '💣 Out of bombs',
    'skill.bomb.emptyCell': '💣 Empty area — pick a cell with a block',
    'skill.bomb.payFail': '⚠ Charge failed, please retry',
    'skill.freeze.usedThisRun': '❄ Already frozen this run',
    'skill.freeze.unavailable': '❄ Freeze unavailable',
    'skill.freeze.empty': '❄ Out of freeze tokens',
    'skill.freeze.aim': '❄ Tap any row to freeze it (ESC to cancel)',
    'skill.freeze.payFail': '⚠ Charge failed',
    'skill.freeze.ok': '❄ Row {{row}} frozen — protected for this run',
    'skill.preview.empty': '👁 Out of preview tokens',
    'skill.preview.payFail': '⚠ Charge failed',
    'skill.reroll.unavailable': '🎲 Reroll unavailable',
    'skill.reroll.empty': '🎲 Out of reroll tokens',
    'skill.reroll.fail': '⚠ Reroll failed',
    'skill.reroll.payFail': '⚠ Charge failed',
    'skill.reroll.ok': '🎲 Dock rerolled',

    'reward.luckyWheel.spinning': 'Spinning…',
    'reward.luckyWheel.usedToday': 'Spun today',
    'reward.extremeAchievement': '{{icon}} Achievement: {{label}}',
    'reward.loginStreakUnlocked': '{{icon}} {{label}} unlocked',
    'reward.seasonChestUnlocked': '🏆 {{label}} unlocked',
    'reward.birthdayCandy': '🎂 Happy birthday! Candy skin trial 24h + 5 hints + 1 rainbow',

    'skin.name.classic': '✨ Minimal Classic',
    'skin.name.titanium': '💎 Titanium Matrix',
    'skin.name.aurora': '🌌 Glacier Aurora',
    'skin.name.neonCity': '🌃 Neon City',
    'skin.name.ocean': '🌊 Deep Ocean',
    'skin.name.sunset': '🌅 Amber Crystal',
    'skin.name.sakura': '🌸 Sakura Snow',
    'skin.name.koi': '🎏 Koi Rising',
    'skin.name.candy': '🍭 Candy Sweet',
    'skin.name.bubbly': '🫧 Bubbly Pop',
    'skin.name.toon': '🎨 Cartoon Park',
    'skin.name.pixel8': '👾 Arcade Brawl',
    'skin.name.dawn': '☀️ Dawn Light',
    'skin.name.food': '🍕 Food Feast',
    'skin.name.music': '🎹 Music Beat',
    'skin.name.pets': '🐶 Cute Pets',
    'skin.name.universe': '🪐 Cosmic Space',
    'skin.name.fantasy': '🔮 Mystic Realm',
    'skin.name.beast': '🗺️ Beast Quest',
    'skin.name.greece': '🏛️ Greek Myth',
    'skin.name.demon': '😈 Demon Realm',
    'skin.name.jurassic': '🦕 Jurassic World',
    'skin.name.fairy': '🧚 Fairy Dream',
    'skin.name.industrial': '🏭 Industrial Age',
    'skin.name.forbidden': '👑 Forbidden City',
    'skin.name.mahjong': '🀄 Mahjong Table',
    'skin.name.boardgame': '🃏 Poker & Cards',
    'skin.name.sports': '⚽ Sports Arena',
    'skin.name.outdoor': '🥾 Outdoor Trail',
    'skin.name.vehicles': '🏎️ Speed Engines',
    'skin.name.forest': '🌳 Forest Trail',
    'skin.name.pirate': '🦜 Pirate Voyage',
    'skin.name.farm': '🐄 Farm Life',
    'skin.name.desert': '🐫 Desert Oasis',

    'boot.fileProtocol': 'Game script did not load. Run npm run dev from the project root and open the local URL shown in the terminal; do not open the HTML via file://.',

    // ============ Player Lifecycle & Maturity System ============
    // Maturity Levels
    'maturity.L1': 'Explorer',
    'maturity.L2': 'Enthusiast',
    'maturity.L3': 'Veteran',
    'maturity.L4': 'Core Player',

    // Lifecycle Stages
    'lifecycle.onboarding': 'Onboarding',
    'lifecycle.exploration': 'Exploration',
    'lifecycle.growth': 'Growth',
    'lifecycle.stability': 'Stability',
    'lifecycle.veteran': 'Veteran',

    // Churn Warning
    'churn.risk.stable': 'Stable',
    'churn.risk.low': 'Low Risk',
    'churn.risk.medium': 'Medium Risk',
    'churn.risk.high': 'High Risk',
    'churn.risk.critical': 'Critical',
    'churn.alert.title': 'Welcome Back!',
    'churn.alert.message': 'You have an exclusive welcome gift waiting!',
    'churn.alert.cta': 'Claim Now',

    // Social Intro
    'social.intro.addFriend': 'Add friends to play together - more fun!',
    'social.intro.joinGuild': 'Join a guild and grow with like-minded players!',
    'social.intro.challengeFriend': 'Challenge your friends and prove your skills!',
    'social.intro.shareReplay': 'Share your amazing plays and attract fans!',
    'social.intro.inviteFriend': 'Invite friends and earn rewards!',
    'social.progress.completed': 'Completed',
    'social.progress.milestone': 'Achievement Milestone',

    // VIP System
    'vip.level.0': 'Regular',
    'vip.level.1': 'VIP1',
    'vip.level.2': 'VIP2',
    'vip.level.3': 'VIP3',
    'vip.level.4': 'VIP4',
    'vip.level.5': 'VIP5',
    'vip.badge.bronze': 'Bronze',
    'vip.badge.silver': 'Silver',
    'vip.badge.gold': 'Gold',
    'vip.badge.platinum': 'Platinum',
    'vip.badge.diamond': 'Diamond',
    'vip.benefit.adRemoval': 'Ad Removal',
    'vip.benefit.dailyBonus': 'Daily Bonus',
    'vip.benefit.expireProtection': 'Item Protection',
    'vip.benefit.exclusiveShop': 'Exclusive Shop',
    'vip.benefit.prioritySupport': 'Priority Support',
    'vip.benefit.betaAccess': 'Beta Access',
    'vip.benefit.customAvatar': 'Custom Avatar',
    'vip.benefit.nameColor': 'Name Color',
    'vip.benefit.dedicatedChannel': 'Dedicated Support',

    // Purchase Funnel
    'purchase.funnel.awareness': 'Awareness',
    'purchase.funnel.interest': 'Interest',
    'purchase.funnel.consideration': 'Consideration',
    'purchase.funnel.purchase': 'Purchase',
    'purchase.funnel.retention': 'Repurchase',
    'purchase.firstOffer.starter': 'First Purchase',
    'purchase.firstOffer.value': 'Value Pack',
    'purchase.firstOffer.premium': 'Premium Pack',

    // Difficulty
    'difficulty.beginner': 'Beginner',
    'difficulty.easy': 'Easy',
    'difficulty.normal': 'Normal',
    'difficulty.hard': 'Hard',
    'difficulty.expert': 'Expert',
    'difficulty.reason.churnPrevention': 'Churn Prevention - Easing Difficulty',
    'difficulty.reason.beginnerBonus': 'Beginner Protection - Quick Success',
    'difficulty.reason.onboarding': 'Onboarding - Gentle Difficulty',
    'difficulty.reason.corePlayer': 'Core Player - Increased Challenge',

    // Game Over
    'game.over.newBest': 'New Record!',
    'game.over.bestScore': 'Best',
    'game.over.crown': '🏆',
    'game.over.combo': '{{n}} Combo',
    'game.over.perfect': 'Perfect!',

    // Intervention
    'intervention.tutorial': 'Tutorial',
    'intervention.firstPack': 'First Day Pack',
    'intervention.difficulty': 'Adjust Difficulty',
    'intervention.quickWin': 'Quick Success',
    'intervention.dailyTask': 'Daily Tasks',
    'intervention.socialIntro': 'Social Features',
    'intervention.firstPurchase': 'First Purchase',
    'intervention.guildInvite': 'Join Guild',
    'intervention.rankPush': 'Rank Push',
    'intervention.vipBadge': 'VIP Badge',

    // Decision Flow Viz panel (v1.51.4) — dev/design analytics tool. Other locales fall back to zh-CN.
    'dfv.title': 'Decision Flow',
    /* v1.55.14: drop emoji prefix (button now uses inline SVG; tooltip stays text-only) */
    'dfv.toggleTitle': 'Decision Flow — live signals → stress → spawn intent (Shift+D)',
    'dfv.aria': 'Decision Flow panel',
    'dfv.dragHint': 'Drag to move the panel',
    'dfv.collapseTitle': 'Collapse / Expand',
    'dfv.closeTitle': 'Close (Shift+D)',
    'dfv.pulseWaiting': 'awaiting spawn',
    'dfv.stress': 'STRESS',
    'dfv.intent': 'INTENT',

    // Signal nodes
    'dfv.signal.skill': 'skill',
    'dfv.signal.momentum': 'momentum',
    'dfv.signal.frust': 'frust',
    'dfv.signal.flow': 'flow',
    'dfv.signal.session': 'phase',
    'dfv.signal.load': 'load',
    'dfv.signal.clearRate': 'clearRate',
    'dfv.signal.boardFill': 'boardFill',
    'dfv.signal.combo': 'combo',
    'dfv.signal.missRate': 'missRate',

    // Section titles
    'dfv.sec.intent': 'Spawn Intent',
    'dfv.sec.contrib': 'Stress Contributors',
    'dfv.sec.flags': 'Decision Flags',
    'dfv.sec.shapes': 'Shape Weights',
    'dfv.sec.targets': 'Spawn Targets',
    'dfv.sec.hints': 'Spawn Hints',
    'dfv.sec.contribSub': 'top 4',
    'dfv.sec.shapesSub': 'top 5 · prob',
    'dfv.sec.targetsSub': 'top 6',
    'dfv.sec.hintsSub': 'scheduling',
    'dfv.sec.dynamics': 'Decision Dynamics',
    'dfv.sec.dynamicsSub': 'attribution · sensitivity',
    'dfv.flowNav.aria': 'Algorithm structure: Signals → Derived (Stress ∥ Strategy ∥ Targets ∥ Schedule ∥ Intent — five parallel siblings)',
    'dfv.flowStep.signal': 'Signals',
    'dfv.flowStep.stress': 'Stress',
    'dfv.flowStep.strategy': 'Strategy',
    'dfv.flowStep.target': 'Targets',
    'dfv.flowStep.schedule': 'Schedule',
    'dfv.flowStep.intent': 'Intent',
    'dfv.flowStep.signalTip': '17+ player signals (profile + ctx + ability + delight) — underlying causal inputs',
    'dfv.flowStep.stressTip': 'Derived ①: 12+ stressBreakdown components weighted + normalized (adaptiveSpawn.js) — single scalar [0,1]',
    'dfv.flowStep.strategyTip': 'Derived ②: spawnHints 5-vector (clearGuarantee/size/rigor/diversity/combo) — 30+ Math.max/min independent paths, does NOT read stress',
    'dfv.flowStep.targetTip': 'Derived ③: spawnTargets 6-dim (complexity/solSpace/clearOpp/spatial/payoff/novelty) — deriveSpawnTargets(stress, profile, ctx, fill, boardRisk, delight)',
    'dfv.flowStep.scheduleTip': 'Derived ④: 4 schedule params (multiClear/multiLine/perfectClear/iconBonus boost) — each via independent derive function',
    'dfv.flowStep.intentTip': 'Derived ⑤: resolveIntent 7 priority rules (intentResolver.js) — reads distress/geometry/delight/stress directly, NOT the 5-vector. All five parallel siblings from signals',
    'dfv.flowStep.spawn': 'Spawn',
    'dfv.flowStep.spawnTip': 'Stage ③ Spawn (blockSpawn.generateDockShapes): consumes all Stage ② outputs → 3 sub-layers (Layer1 topology+anti-deadlock+9 target* soft-filter / Layer2 combo+memory+rhythm / Layer3 arc+milestone) → 22 sampling attempts → 3 chosen shapes (what player actually sees)',

    // Intent CN-equivalent (English short)
    'dfv.intent.relief': 'Relief',
    'dfv.intent.engage': 'Engage',
    'dfv.intent.flow': 'Flow',
    'dfv.intent.maintain': 'Maintain',
    /* v1.57.1 P3: sprint mid-tier (stress ∈ [0.45, 0.55) transition band), smooths
     * the cross-threshold "sudden harder" cliff at 0.55. Copy stays neutral. */
    'dfv.intent.sprint': 'Sprint',
    'dfv.intent.pressure': 'Pressure',
    'dfv.intent.harvest': 'Harvest',

    // Reason
    'dfv.reason.default': 'standard',
    'dfv.reason.lateCollapse': 'late collapse → forced relief',
    'dfv.reason.frustHigh': 'high frustration → forced relief',
    'dfv.reason.pressure': 'good momentum → can pressure',
    'dfv.reason.engage': 'anxious + frustration → engage',
    'dfv.reason.flow': 'flow stable → maintain',
    /* v1.57.1 P3: sprint trigger reason (DFV dev panel only) */
    'dfv.reason.sprint': 'stress ∈ [0.45, 0.55) — gradual ramp',
    'dfv.reason.harvest': 'board has clear opportunity',

    // Decision flag chips
    'dfv.flag.forceRelief': 'Forced Relief',
    'dfv.flag.lateCollapse': 'Late Collapse',
    'dfv.flag.frustCritical': 'Frust Critical',
    'dfv.flag.onboarding': 'Onboarding',
    'dfv.flag.milestone': 'Milestone',
    'dfv.flag.afkEngage': 'AFK Engage',
    'dfv.flag.winback': 'Winback',
    'dfv.flag.personalization': 'Personalized',
    /* v1.58.3: 4 new diagnostic chips + conflicts row */
    'dfv.flag.endSessionStress': 'End-Session Stress',
    'dfv.flag.lifecycleLateAccel': 'Lifecycle Late-Accel',
    'dfv.flag.playerDistressFloor': 'Distress Floor',
    'dfv.flag.delightModeRelief': 'Delight Relief',
    'dfv.conflicts.label': 'cross-dimension signal conflicts',

    // Shape category
    'dfv.shape.lines': 'Lines',
    'dfv.shape.rects': 'Rects',
    'dfv.shape.squares': 'Squares',
    'dfv.shape.tshapes': 'T-shapes',
    'dfv.shape.zshapes': 'Z-shapes',
    'dfv.shape.lshapes': 'L-shapes',
    'dfv.shape.jshapes': 'J-shapes',

    // spawnTargets 6
    'dfv.target.shapeComplexity': 'shape complexity',
    'dfv.target.solutionSpacePressure': 'solution-space pressure',
    'dfv.target.clearOpportunity': 'clear opportunity',
    'dfv.target.spatialPressure': 'spatial pressure',
    'dfv.target.payoffIntensity': 'payoff intensity',
    'dfv.target.novelty': 'novelty',

    // spawnHints
    'dfv.hint.clearGuarantee': 'clear guarantee',
    'dfv.hint.sizePreference': 'size preference',
    'dfv.hint.orderRigor': 'order rigor',
    'dfv.hint.diversityBoost': 'diversity boost',
    'dfv.hint.comboChain': 'combo chain',
    'dfv.hint.pacingPhase': 'pacing phase',
    'dfv.hint.rhythmPhase': 'rhythm phase',
    'dfv.hint.sessionArc': 'session arc',
    'dfv.hint.delightMode': 'delight mode',
    'dfv.hint.multiClearBonus': 'multi-clear bonus',
    'dfv.hint.perfectClearBoost': 'perfect-clear boost',
    'dfv.hint.iconBonusTarget': 'icon bonus',

    // Sparkline labels
    'dfv.spark.stress': 'stress',
    'dfv.spark.momentum': 'momentum',
    'dfv.spark.clearRate': 'clearRate',
    'dfv.spark.boardFill': 'boardFill',
    'dfv.spark.frust': 'frust',

    // Footer
    'dfv.foot.relief': 'relief',
    'dfv.foot.pressure': 'pressure',
    'dfv.foot.pulseHint': 'pulse = new spawn',
    'dfv.foot.covaryHint': 'dashed = derived covariance · NOT causal',
    'dfv.foot.empty': '—',

    // v1.51.9: Stress contributors (mirror of stressMeter.SIGNAL_LABELS)
    'dfv.contrib.scoreStress':           'score band',
    'dfv.contrib.runStreakStress':       'run streak',
    'dfv.contrib.difficultyBias':        'difficulty mode',
    'dfv.contrib.skillAdjust':           'skill',
    'dfv.contrib.flowAdjust':            'flow',
    'dfv.contrib.pacingAdjust':          'pacing',
    'dfv.contrib.recoveryAdjust':        'recovery',
    'dfv.contrib.frustrationRelief':     'frustration relief',
    'dfv.contrib.comboAdjust':           'combo',
    'dfv.contrib.nearMissAdjust':        'near miss',
    'dfv.contrib.feedbackBias':          'feedback bias',
    'dfv.contrib.trendAdjust':           'trend',
    'dfv.contrib.sessionArcAdjust':      'session arc',
    'dfv.contrib.endSessionDistress':    'late distress',
    'dfv.contrib.holeReliefAdjust':      'hole relief',
    'dfv.contrib.boardRiskReliefAdjust': 'board risk',
    'dfv.contrib.abilityRiskAdjust':     'ability risk',
    'dfv.contrib.delightStressAdjust':   'milestone',
    'dfv.contrib.challengeBoost':        'B-tier challenge',
    'dfv.contrib.postPbReleaseStressAdjust': 'PB release',
    'dfv.contrib.friendlyBoardRelief':   'friendly board',
    'dfv.contrib.bottleneckRelief':      'bottleneck',
    'dfv.contrib.motivationStressAdjust':'motivation',
    'dfv.contrib.accessibilityStressAdjust': 'a11y load',
    'dfv.contrib.returningWarmupAdjust': 'returning warmup',
    'dfv.contrib.flowPayoffCap':         'flow cap',
    'dfv.contrib.occupancyDamping':      'occupancy damping',
    'dfv.contrib.reactionAdjust':        'reaction load',

    // v1.51.9: spawnHints enum values
    'dfv.val.pacing.tension':      'tension',
    'dfv.val.pacing.release':      'release',
    'dfv.val.pacing.recovery':     'recovery',
    'dfv.val.pacing.normal':       'normal',
    'dfv.val.pacing.neutral':      'neutral',
    'dfv.val.rhythm.setup':        'setup',
    'dfv.val.rhythm.tension':      'tension',
    'dfv.val.rhythm.payoff':       'payoff',
    'dfv.val.rhythm.release':      'release',
    'dfv.val.rhythm.neutral':      'neutral',
    'dfv.val.arc.warmup':          'warmup',
    'dfv.val.arc.rising':          'rising',
    'dfv.val.arc.peak':            'peak',
    'dfv.val.arc.plateau':         'plateau',
    'dfv.val.arc.cooldown':        'cooldown',
    'dfv.val.delight.relief':          'relief',
    'dfv.val.delight.flow':            'flow',
    'dfv.val.delight.flow_payoff':     'flow · payoff',
    'dfv.val.delight.challenge_payoff':'challenge · payoff',
    'dfv.val.delight.celebration':     'celebration',
    'dfv.val.delight.baseline':        'baseline',
    'dfv.val.delight.off':             'off',
};
