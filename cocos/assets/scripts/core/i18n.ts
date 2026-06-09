/**
 * i18n —— 引擎无关多语言框架（Phase P0）。
 *
 * 与 web `i18n/i18n.js` 同构的极简实现：`t(key, params)` + 运行期 `setLocale`。
 * 字典内置 zh-CN / en，可通过 `registerLocale` 注入更多语言（裁剪 web locales 即可）。
 * 不依赖 DOM；语言探测优先 `globalThis.__OPENBLOCK_LOCALE__`，否则 navigator/wx，兜底 zh-CN。
 */

export type LocaleId = string;
export type Dict = Record<string, string>;

const DICTS: Record<LocaleId, Dict> = {
    'zh-CN': {
        'hud.score': '得分 {n}',
        'hud.best': '最佳 {n}',
        'hud.coins': '🪙 {n}',
        'hud.gameover': '游戏结束 · 点击重开',
        'gameover.title': '游戏结束',
        'gameover.newbest': '🏆 新纪录！',
        'gameover.encourage': '棋盘填满，再来一局！',
        'gameover.xpGain': '+{n} 经验',
        'game.summary.title': '本局战报',
        'game.summary.clears': '消行',
        'game.summary.clearsValue': '{n} 行',
        'game.summary.maxCombo': '最高连击',
        'game.summary.hitRate': '命中率',
        'game.summary.duration': '用时',
        'game.menu': '菜单',
        'game.actions.replay': '回放',
        'btn.again': '🔄 再来一局',
        'hud.combo': '{n} 连!',
        'hud.perfect': '完美清屏!',
        'hud.timeleft': '⏱ {n}s',
        'skill.hint': '提示',
        'skill.undo': '撤销',
        'skill.bomb': '炸弹',
        'skill.rainbow': '彩虹',
        'skill.freeze': '冻结',
        'skill.reroll': '换一批',
        'skill.preview': '预览',
        'skill.aim': '瞄准',
        'skill.bombHint': '💣 点击盘面引爆',
        'revive.title': '继续游戏？',
        'revive.ad': '📺 看广告复活',
        'revive.coins': '🪙 {n} 复活',
        'revive.giveup': '放弃',
        'revive.done': '✨ 已复活',
        'btn.skin': '皮肤',
        'btn.daily': '每日',
        'btn.mode': '模式',
        'btn.share': '分享',
        'btn.close': '关闭',
        'btn.claim': '领取',
        'btn.ok': '确定',
        'menu.start': '开始游戏',
        'menu.continue': '继续游戏',
        'menu.tagline': '轻松摆放 · 消行得分',
        'menu.home': '主菜单',
        'companion.title': '我的伙伴',
        'companion.level': 'Lv.{n}',
        'companion.bond': '亲密度 {cur}/{max}',
        'companion.bondMax': '亲密度已满',
        'companion.feed': '🍖 喂食 (+{n})',
        'companion.fed': '今天已喂过啦',
        'companion.levelup': '伙伴升级! Lv.{n}',
        'lore.title': '皮肤图鉴',
        'lore.prev': '‹ 上一款',
        'lore.next': '下一款 ›',
        'lore.use': '✦ 使用此皮肤',
        'lore.using': '✓ 当前使用中',
        'lore.page': '主题 {cur}/{total}',
        'btn.lore': '图鉴',
        'btn.replay': '回放',
        'replay.title': '对局回放',
        'replay.empty': '还没有回放记录',
        'replay.play': '▶ 播放',
        'replay.pause': '⏸ 暂停',
        'replay.prev': '‹ 上一步',
        'replay.next': '下一步 ›',
        'replay.step': '第 {cur}/{total} 步 · {score} 分',
        'replay.item': '{score} 分 · {mode} · {moves} 步',
        'mode.classic': '经典',
        'mode.zen': '禅模式',
        'mode.lightning': '闪电',
        'mode.classic.desc': '标准无尽',
        'mode.zen.desc': '不会失败，放松摆放',
        'mode.lightning.desc': '60 秒冲分',
        'chest.title': '结算宝箱',
        'chest.open': '开启',
        'chest.adDouble': '📺 看广告翻倍',
        'chest.reward': '获得 🪙 {n}',
        'chest.claim': '领取到钱包',
        'chest.common': '普通宝箱',
        'chest.rare': '稀有宝箱',
        'chest.epic': '史诗宝箱',
        'chest.hint': '点击下方按钮或空白处关闭，奖励将发放至钱包',
        'chest.item.hint': '+{n} 提示券',
        'chest.item.undo': '+{n} 撤销',
        'chest.item.bomb': '+{n} 炸弹',
        'chest.item.rainbow': '+{n} 彩虹',
        'chest.item.freeze': '+{n} 冻结',
        'chest.item.preview': '+{n} 预览',
        'chest.item.reroll': '+{n} 换一批',
        'chest.item.coin': '+{n} 金币',
        'chest.item.trial': '{h}h 随机试穿',
        'chest.item.trialNamed': '{h}h 试穿 {name}',
        'gameover.xp': '本局经验 +{n}',
        'wheel.title': '幸运转盘',
        'wheel.spin': '免费转',
        'wheel.adSpin': '📺 看广告再转',
        'reward.luckyWheel.spinning': '抽奖中…',
        'reward.luckyWheel.usedToday': '今日已抽',
        'level.up': '升级! Lv.{n}',
        'level.label': 'Lv.{n}',
        'ach.unlocked': '成就达成：{name}',
        'season.title': '赛季通行证',
        'season.tier': '第 {n} 阶',
        'daily.checkin': '签到',
        'daily.streak': '连签 {n} 天',
        'daily.firstwin': '首胜加成 ×{n}',
        'daily.milestone': '月度里程碑',
        'daily.dish': '今日菜单',
        'welcome.back': '欢迎回来！离线 {n} 天',
        'welcome.gift': '回归礼包',
        'rank.title': '排行榜',
        'rank.you': '你',
        'rank.empty': '今日暂无记录，快来上榜！',
        'mission.title': '任务',
        'mission.inProgress': '进行中',
        'mission.claimed': '已领',
        'share.text': '我在 OpenBlock 拿到了 {n} 分，来挑战！',
        'share.started': '📤 已打开分享',
        'share.copied': '📋 分享文案已复制',
        'share.unavailable': '⚠️ 当前平台暂不支持分享',
        'hud.caption.power': '能力',
        'hud.caption.score': '得分',
        'hud.caption.best': '最佳',
        'hud.caption.theme': '主题',
        'progress.rank.novice': '新手',
        'progress.rank.apprentice': '学徒',
        'progress.rank.adept': '行家',
        'progress.rank.expert': '专家',
        'progress.rank.master': '大师',
        'progress.rank.legend': '传奇',
        'progress.streakDays': '连续 {n} 天',
        'meta.title': '每日 / 赛季',
        'meta.todayMissions': '今日任务',
        'skin.title': '🎨 选择皮肤',
        'tutorial.title': '欢迎来到 OpenBlock',
        'tutorial.line1': '· 从底部候选区拖动方块到棋盘',
        'tutorial.line2': '· 填满整行或整列即可消除得分',
        'tutorial.line3': '· 同色整行/列有额外加成',
        'tutorial.line4': '· 用金币施放技能：提示/撤销/炸弹/彩虹/冻结',
        'tutorial.start': '开始游戏',
        'freeze.on': '❄️ 冻结',
        'freeze.triggered': '❄️ 触发冻结',
        'skill.needCoins': '🪙 金币不足',
        'skill.needToken': '🎒 道具不足',
        'storage.failed': '⚠️ 存档写入失败',
        'cloud.queued': '☁️ 已暂存，待联网同步',
        'visualfx.on': '✨ 视觉特效：开',
        'visualfx.off': '✦ 视觉特效：关',
        'effect.double': '双消',
        'effect.multi': '{n} 消',
        'effect.perfectFloat': '清屏 ×10',
        'effect.newRecord': '🏆 刷新最佳！',
        'effect.nearMiss': '再一格就消行 🎯',
        // 与 web 主端 i18n key 对齐：纯文案不带 emoji（emoji 由调用方独立拼接）。
        'effect.nearMissPlace': '再一格就消行',
        'effect.streak': '🔥 {n} 连消',
        // 与 web 主端 i18n key 对齐：飘字标签 / 同花顺 / streak 徽章 / combo 倍数
        'effect.perfectClear': '清屏',
        'effect.doubleClear': '双消',
        'effect.multiClear': '{n} 消',
        'effect.iconBonus': '同花顺大消除',
        'effect.streakCombo': '{fires} {n} 连消',
        'effect.comboMultiplier': 'Combo {mult}',
        'hud.bestGap': '差 {n} 分',
        'hud.bestOver': '本局 +{n}',
        'hud.comboHeart': '♥ ×{n}',
        'checkin.title': '每日签到',
        'checkin.sub': '连续打卡 {n} 天',
        'checkin.day': '第 {n} 天',
        'checkin.grandTag': '🎁 24h 试穿',
        'checkin.claimToday': '领取今日奖励',
        'checkin.claimed': '今日已签',
        'season.daysReward': '免费',
        'season.premiumReward': '高级',
        'season.points': '积分 {n}',
        'season.progress': 'Lv.{cur} → Lv.{next}',
        'season.xpProgress': 'XP {cur}/{next}',
        'season.claimAll': '一键领取',
        'season.buyPremium': '💎 升级高级通行证',
        'season.taskDone': '赛季任务完成：{label}',
        'season.taskReward': '奖励：{reward}',
        'season.premiumOn': '💎 高级通行证已解锁',
        'season.locked': '🔒 未解锁',
        'season.maxed': '已满级',
        'seasonChest.common': '普通季终宝箱',
        'seasonChest.rare': '稀有季终宝箱',
        'seasonChest.epic': '史诗季终宝箱',
        'seasonChest.legend': '传说季终宝箱',
        'seasonChest.unlocked': '🏆 {label} 已解锁',
        'toast.wheelReady': '🎰 今日免费转盘可领取',
        'toast.wheelAction': '去抽',
        'toast.milestone': '🗓️ 月度里程碑达成 · 🪙 +{n}',
        'toast.weekendTrial': '🎉 周末活动 — {name} 试穿 48h',
        'toast.birthday': '🎂 生日快乐！专属糖果已送达',
        'toast.seasonalRecommend': '{msg}',
        'toast.seasonalAction': '切换',
        'toast.firstDayPack': '🎁 首日礼包已送达 · 🪙 +{n}',
        'toast.welcomeBack': '👋 欢迎回来！离线 {days} 天 · 🪙 +{gift}',
        'toast.checkinReminder': '📅 今日还没签到哦',
        'toast.ftueDrag': '👆 从底部拖动方块到棋盘',
        'toast.ftueClear': '✨ 填满整行或整列即可消除得分',
        'menu.dailyMaster': '🏅 每日大师题',
        'dailyMaster.alreadyPlayed': '🏅 今日大师题已完成',
        'dailyMaster.toastSeed': '🏅 每日大师题 · 今日种子 {seed}',
        'dailyMaster.toastComplete': '🏅 大师题完成 · {score} 分',
        'churn.critical': '🎁 想念你了！专属回归礼包已送达 · 快来继续吧',
        'churn.high': '💝 回归惊喜已送达 · 继续游戏更有奖励',
        'churn.medium': '✨ 新内容已上线 · 今日好礼已备好',
    },
    en: {
        'hud.score': 'Score {n}',
        'hud.best': 'Best {n}',
        'hud.coins': '🪙 {n}',
        'hud.gameover': 'Game Over · Tap to restart',
        'gameover.title': 'Game Over',
        'gameover.newbest': '🏆 New Best!',
        'gameover.encourage': 'Board full — play again!',
        'gameover.xpGain': '+{n} XP',
        'game.summary.title': 'This Round',
        'game.summary.clears': 'Lines',
        'game.summary.clearsValue': '{n}',
        'game.summary.maxCombo': 'Max Combo',
        'game.summary.hitRate': 'Accuracy',
        'game.summary.duration': 'Time',
        'game.menu': 'Menu',
        'game.actions.replay': 'Replay',
        'btn.again': '🔄 Play Again',
        'hud.combo': '{n} Combo!',
        'hud.perfect': 'Perfect Clear!',
        'hud.timeleft': '⏱ {n}s',
        'skill.hint': 'Hint',
        'skill.undo': 'Undo',
        'skill.bomb': 'Bomb',
        'skill.rainbow': 'Rainbow',
        'skill.freeze': 'Freeze',
        'skill.reroll': 'Reroll',
        'skill.preview': 'Preview',
        'skill.aim': 'Aim',
        'skill.bombHint': '💣 Tap board to blast',
        'revive.title': 'Continue?',
        'revive.ad': '📺 Revive by Ad',
        'revive.coins': '🪙 {n} Revive',
        'revive.giveup': 'Give up',
        'revive.done': '✨ Revived',
        'btn.skin': 'Skin',
        'btn.daily': 'Daily',
        'btn.mode': 'Mode',
        'btn.share': 'Share',
        'btn.close': 'Close',
        'btn.claim': 'Claim',
        'btn.ok': 'OK',
        'menu.start': 'Play',
        'menu.continue': 'Continue',
        'menu.tagline': 'Drag, place, clear lines',
        'menu.home': 'Menu',
        'companion.title': 'My Buddy',
        'companion.level': 'Lv.{n}',
        'companion.bond': 'Bond {cur}/{max}',
        'companion.bondMax': 'Bond maxed',
        'companion.feed': '🍖 Feed (+{n})',
        'companion.fed': 'Already fed today',
        'companion.levelup': 'Buddy leveled up! Lv.{n}',
        'lore.title': 'Skin Codex',
        'lore.prev': '‹ Prev',
        'lore.next': 'Next ›',
        'lore.use': '✦ Use this skin',
        'lore.using': '✓ In use',
        'lore.page': 'Theme {cur}/{total}',
        'btn.lore': 'Codex',
        'btn.replay': 'Replay',
        'replay.title': 'Replays',
        'replay.empty': 'No replays yet',
        'replay.play': '▶ Play',
        'replay.pause': '⏸ Pause',
        'replay.prev': '‹ Prev',
        'replay.next': 'Next ›',
        'replay.step': 'Step {cur}/{total} · {score} pts',
        'replay.item': '{score} pts · {mode} · {moves} moves',
        'mode.classic': 'Classic',
        'mode.zen': 'Zen',
        'mode.lightning': 'Lightning',
        'mode.classic.desc': 'Standard endless',
        'mode.zen.desc': 'No fail, relax',
        'mode.lightning.desc': '60s score rush',
        'chest.title': 'Reward Chest',
        'chest.open': 'Open',
        'chest.adDouble': '📺 Double by Ad',
        'chest.reward': 'Got 🪙 {n}',
        'chest.claim': 'Claim to Wallet',
        'chest.common': 'Common Chest',
        'chest.rare': 'Rare Chest',
        'chest.epic': 'Epic Chest',
        'chest.hint': 'Tap the button or background to close — reward will be added to your wallet',
        'chest.item.hint': '+{n} Hint',
        'chest.item.undo': '+{n} Undo',
        'chest.item.bomb': '+{n} Bomb',
        'chest.item.rainbow': '+{n} Rainbow',
        'chest.item.freeze': '+{n} Freeze',
        'chest.item.preview': '+{n} Preview',
        'chest.item.reroll': '+{n} Reroll',
        'chest.item.coin': '+{n} Coins',
        'chest.item.trial': '{h}h random trial',
        'chest.item.trialNamed': '{h}h trial: {name}',
        'gameover.xp': 'XP +{n}',
        'wheel.title': 'Lucky Wheel',
        'wheel.spin': 'Free Spin',
        'wheel.adSpin': '📺 Spin by Ad',
        'reward.luckyWheel.spinning': 'Spinning…',
        'reward.luckyWheel.usedToday': 'Spun today',
        'level.up': 'Level Up! Lv.{n}',
        'level.label': 'Lv.{n}',
        'ach.unlocked': 'Achievement: {name}',
        'season.title': 'Season Pass',
        'season.tier': 'Tier {n}',
        'daily.checkin': 'Check in',
        'daily.streak': '{n}-day streak',
        'daily.firstwin': 'First win ×{n}',
        'daily.milestone': 'Monthly milestone',
        'daily.dish': "Today's Menu",
        'welcome.back': 'Welcome back! {n} days away',
        'welcome.gift': 'Comeback gift',
        'rank.title': 'Leaderboard',
        'rank.you': 'You',
        'rank.empty': 'No records yet. Be the first!',
        'mission.title': 'Missions',
        'mission.inProgress': 'In progress',
        'mission.claimed': 'Claimed',
        'share.text': 'I scored {n} on OpenBlock, beat me!',
        'share.started': '📤 Share opened',
        'share.copied': '📋 Share text copied',
        'share.unavailable': '⚠️ Sharing unavailable',
        'hud.caption.power': 'Power',
        'hud.caption.score': 'Score',
        'hud.caption.best': 'Best',
        'hud.caption.theme': 'Theme',
        'progress.rank.novice': 'Novice',
        'progress.rank.apprentice': 'Apprentice',
        'progress.rank.adept': 'Adept',
        'progress.rank.expert': 'Expert',
        'progress.rank.master': 'Master',
        'progress.rank.legend': 'Legend',
        'progress.streakDays': '{n}-day streak',
        'meta.title': 'Daily / Season',
        'meta.todayMissions': "Today's Missions",
        'skin.title': '🎨 Choose Skin',
        'tutorial.title': 'Welcome to OpenBlock',
        'tutorial.line1': '· Drag blocks from the dock onto the board',
        'tutorial.line2': '· Fill a full row or column to clear it',
        'tutorial.line3': '· Same-color rows/cols grant extra bonus',
        'tutorial.line4': '· Spend coins on skills: hint / undo / bomb / rainbow / freeze',
        'tutorial.start': 'Start',
        'freeze.on': '❄️ Freeze',
        'freeze.triggered': '❄️ Freeze triggered',
        'skill.needCoins': '🪙 Not enough coins',
        'skill.needToken': '🎒 Not enough items',
        'storage.failed': '⚠️ Save failed',
        'cloud.queued': '☁️ Queued, will sync when online',
        'visualfx.on': '✨ Visual FX: On',
        'visualfx.off': '✦ Visual FX: Off',
        'effect.double': 'Double',
        'effect.multi': '{n} Lines',
        'effect.perfectFloat': 'Clear ×10',
        'effect.newRecord': '🏆 New Best!',
        'effect.nearMiss': 'One more cell! 🎯',
        'effect.nearMissPlace': 'One more to clear',
        'effect.streak': '🔥 {n} streak',
        // Mirror web主端 keys (kept alongside short aliases for backwards compatibility).
        'effect.perfectClear': 'Perfect Clear',
        'effect.doubleClear': 'Double',
        'effect.multiClear': '{n} Lines',
        'effect.iconBonus': 'Same-Color Combo',
        'effect.streakCombo': '{fires} {n} streak',
        'effect.comboMultiplier': 'Combo {mult}',
        'hud.bestGap': '{n} to best',
        'hud.bestOver': '+{n} this run',
        'hud.comboHeart': '♥ ×{n}',
        'checkin.title': 'Daily Check-in',
        'checkin.sub': '{n}-day streak',
        'checkin.day': 'Day {n}',
        'checkin.grandTag': '🎁 24h trial',
        'checkin.claimToday': 'Claim today',
        'checkin.claimed': 'Checked in',
        'season.daysReward': 'Free',
        'season.premiumReward': 'Premium',
        'season.points': 'Points {n}',
        'season.progress': 'Lv.{cur} → Lv.{next}',
        'season.xpProgress': 'XP {cur}/{next}',
        'season.claimAll': 'Claim All',
        'season.buyPremium': '💎 Upgrade Premium',
        'season.taskDone': 'Season task done: {label}',
        'season.taskReward': 'Reward: {reward}',
        'season.premiumOn': '💎 Premium unlocked',
        'season.locked': '🔒 Locked',
        'season.maxed': 'Maxed',
        'seasonChest.common': 'Common Season Chest',
        'seasonChest.rare': 'Rare Season Chest',
        'seasonChest.epic': 'Epic Season Chest',
        'seasonChest.legend': 'Legend Season Chest',
        'seasonChest.unlocked': '🏆 {label} unlocked',
        'toast.wheelReady': '🎰 Free spin available today',
        'toast.wheelAction': 'Spin',
        'toast.milestone': '🗓️ Monthly milestone · 🪙 +{n}',
        'toast.weekendTrial': '🎉 Weekend event — {name} trial 48h',
        'toast.birthday': '🎂 Happy birthday! Special candy delivered',
        'toast.seasonalRecommend': '{msg}',
        'toast.seasonalAction': 'Switch',
        'toast.firstDayPack': '🎁 First-day pack delivered · 🪙 +{n}',
        'toast.welcomeBack': '👋 Welcome back! {days} days away · 🪙 +{gift}',
        'toast.checkinReminder': "📅 You haven't checked in today",
        'toast.ftueDrag': '👆 Drag blocks from the dock onto the board',
        'toast.ftueClear': '✨ Fill a full row or column to clear and score',
        'menu.dailyMaster': '🏅 Daily Master',
        'dailyMaster.alreadyPlayed': "🏅 Today's Daily Master is done",
        'dailyMaster.toastSeed': '🏅 Daily Master · seed {seed}',
        'dailyMaster.toastComplete': '🏅 Daily Master done · {score} pts',
        'churn.critical': '🎁 We missed you! A comeback pack is here · jump back in',
        'churn.high': '💝 Welcome-back surprise delivered · more rewards await',
        'churn.medium': '✨ New content is live · today\'s gift is ready',
    },
};

let _locale: LocaleId = 'zh-CN';

/** 持久化语言偏好 hook：由壳工程在 initLocale 之前注入读/写函数。
 *  cocos/web 端用 `Storage.get('locale')` / `Storage.set('locale', id)`；
 *  无 hook 时纯按浏览器/微信侦测，与历史行为一致。 */
let _readPersistedLocale: (() => string | null) | null = null;
let _writePersistedLocale: ((id: string) => void) | null = null;
export function configureLocalePersistence(read: () => string | null, write: (id: string) => void): void {
    _readPersistedLocale = read;
    _writePersistedLocale = write;
}

function detect(): LocaleId {
    const g = globalThis as unknown as {
        __OPENBLOCK_LOCALE__?: string;
        navigator?: { language?: string };
        wx?: { getSystemInfoSync?: () => { language?: string } };
    };
    if (_readPersistedLocale) {
        try {
            const saved = _readPersistedLocale();
            if (saved && DICTS[saved]) return saved;
        } catch { /* ignore */ }
    }
    let raw = g.__OPENBLOCK_LOCALE__;
    if (!raw && g.wx?.getSystemInfoSync) {
        try { raw = g.wx.getSystemInfoSync().language; } catch { /* ignore */ }
    }
    if (!raw && g.navigator?.language) raw = g.navigator.language;
    if (!raw) return 'zh-CN';
    const low = raw.toLowerCase();
    if (low.startsWith('zh')) return 'zh-CN';
    if (DICTS[raw]) return raw;
    const short = low.split('-')[0];
    if (DICTS[short]) return short;
    return 'en';
}

export function initLocale(): LocaleId {
    _locale = detect();
    return _locale;
}

type LocaleListener = (id: LocaleId) => void;
const _localeListeners: LocaleListener[] = [];

/** 注册语言变化回调；返回反注册函数。供 UI 层（HUD/MainMenu/Hud captions）在切换语言后即时刷新。 */
export function onLocaleChange(fn: LocaleListener): () => void {
    _localeListeners.push(fn);
    return () => {
        const i = _localeListeners.indexOf(fn);
        if (i >= 0) _localeListeners.splice(i, 1);
    };
}

export function setLocale(id: LocaleId): void {
    if (!DICTS[id]) return;
    if (_locale === id) return;
    _locale = id;
    if (_writePersistedLocale) {
        try { _writePersistedLocale(id); } catch { /* ignore */ }
    }
    for (const fn of _localeListeners.slice()) {
        try { fn(id); } catch { /* swallow listener errors to not break siblings */ }
    }
}

export function getLocale(): LocaleId {
    return _locale;
}

export function registerLocale(id: LocaleId, dict: Dict): void {
    DICTS[id] = { ...(DICTS[id] || {}), ...dict };
}

export function availableLocales(): LocaleId[] {
    return Object.keys(DICTS);
}

/** 翻译 + {param} 插值；缺 key 时回退到 zh-CN，再回退到 key 本身。 */
export function t(key: string, params?: Record<string, string | number>): string {
    const dict = DICTS[_locale] || DICTS['zh-CN'];
    let s = dict[key] ?? DICTS['zh-CN'][key] ?? key;
    if (params) {
        for (const k of Object.keys(params)) {
            s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(params[k]));
        }
    }
    return s;
}
