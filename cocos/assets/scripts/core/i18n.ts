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
        'wheel.title': '幸运转盘',
        'wheel.spin': '免费转',
        'wheel.adSpin': '📺 看广告再转',
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
        'mission.title': '任务',
        'share.text': '我在 OpenBlock 拿到了 {n} 分，来挑战！',
    },
    en: {
        'hud.score': 'Score {n}',
        'hud.best': 'Best {n}',
        'hud.coins': '🪙 {n}',
        'hud.gameover': 'Game Over · Tap to restart',
        'gameover.title': 'Game Over',
        'gameover.newbest': '🏆 New Best!',
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
        'wheel.title': 'Lucky Wheel',
        'wheel.spin': 'Free Spin',
        'wheel.adSpin': '📺 Spin by Ad',
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
        'mission.title': 'Missions',
        'share.text': 'I scored {n} on OpenBlock, beat me!',
    },
};

let _locale: LocaleId = 'zh-CN';

function detect(): LocaleId {
    const g = globalThis as unknown as {
        __OPENBLOCK_LOCALE__?: string;
        navigator?: { language?: string };
        wx?: { getSystemInfoSync?: () => { language?: string } };
    };
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

export function setLocale(id: LocaleId): void {
    if (DICTS[id]) _locale = id;
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
